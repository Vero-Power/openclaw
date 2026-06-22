import { homedir } from "node:os";
import { join } from "node:path";
import { completeSimple, getEnvApiKey, getModel, type TextContent } from "@mariozechner/pi-ai";
import type { Database as DatabaseType } from "better-sqlite3";
import { openSentinelDb } from "../../sentinel/db.js";
import type { EmbeddingService } from "../../sentinel/embeddings/service.js";
import type { SpawnTaskInput } from "../../sentinel/followup-processor.js";
import type { Recommendation } from "../../sentinel/oracle/store.js";
import type { SlackClientLike } from "../../triage/actions/index.js";
import { SLACK_USER_ALIASES } from "../../triage/actions/slack/aliases.js";
import {
  Classifier,
  Planner,
  Executor,
  SessionStore,
  openTriageDb,
  bootstrapActionCatalog,
  parseApprovalReply,
  handleChatMessage,
} from "../../triage/index.js";
import type { LlmClient } from "../../triage/llm-client.js";
import type { Plan } from "../../triage/types.js";
import type { SlackMessageEvent } from "../types.js";
import type { SlackMonitorContext } from "./context.js";
import {
  ConversationContextBuilder,
  convoContextEnabled,
  type ConversationContext,
} from "./conversation-context.js";
import { fileAndProcessFollowup, followupsEnabled } from "./followup-bridge.js";

function isTextBlock(block: { type: string }): block is TextContent {
  return block.type === "text";
}

const llmClient: LlmClient = {
  complete: async (prompt: string, opts?: { model?: string; temperature?: number }) => {
    const modelId = opts?.model === "gemini-flash" ? "gemini-2.5-flash" : "gemini-2.5-pro";
    const model = getModel("google", modelId);
    const apiKey = getEnvApiKey("google") ?? "";
    const res = await completeSimple(
      model,
      {
        messages: [
          {
            role: "user",
            content: prompt,
            timestamp: Date.now(),
          },
        ],
      },
      {
        apiKey,
        temperature: opts?.temperature ?? 0,
        maxTokens: 4096,
      },
    );
    return res.content
      .filter(isTextBlock)
      .map((b) => b.text)
      .join("");
  },
};

// Lazy singletons — only initialize when triage actually fires.
// Module-level eager init would crash the gateway when the feature flag is off.
let lazyDb: ReturnType<typeof openTriageDb> | null = null;
let lazyStore: SessionStore | null = null;
let lazyRegistry: ReturnType<typeof bootstrapActionCatalog> | null = null;
let lazyClassifier: Classifier | null = null;
let lazyPlanner: Planner | null = null;
let lazyContextBuilder: ConversationContextBuilder | null = null;

const STALE_SESSION_IDLE_MS = 30 * 60 * 1000; // 30 minutes

function getStore(): SessionStore {
  if (!lazyStore) {
    lazyDb = openTriageDb(join(homedir(), ".openclaw/triage.db"));
    lazyStore = new SessionStore(lazyDb);
  }
  return lazyStore;
}

function getRegistry(
  slackClient?: SlackClientLike,
  botToken?: string,
): ReturnType<typeof bootstrapActionCatalog> {
  if (!lazyRegistry) {
    lazyRegistry = bootstrapActionCatalog({ slackClient, botToken });
  }
  return lazyRegistry;
}

function getClassifier(): Classifier {
  if (!lazyClassifier) {
    lazyClassifier = new Classifier(llmClient);
  }
  return lazyClassifier;
}

function getPlanner(): Planner {
  if (!lazyPlanner) {
    lazyPlanner = new Planner(llmClient, getRegistry(), { userAliases: SLACK_USER_ALIASES });
  }
  return lazyPlanner;
}

// F3 Oracle — set once by the provider after createSentinel resolves. The chat
// handler short-circuits on action-recommendation intent when this is wired.
type OracleSurface = {
  recommendForUser(slackUserId: string): Promise<Recommendation[]>;
};
let oracleSurface: OracleSurface | null = null;
export function setTriageOracle(o: OracleSurface): void {
  oracleSurface = o;
}

// Chat RAG — set once by the provider after createSentinel resolves. When
// wired, the chat handler prepends retrieved insights + oracle recs to the
// reasoner's contextBlock.
type ChatRagDeps = {
  embeddings: EmbeddingService;
  db: DatabaseType;
};
let chatRagDeps: ChatRagDeps | null = null;
export function setChatRagDeps(d: ChatRagDeps): void {
  chatRagDeps = d;
}

function getContextBuilder(ctx: SlackMonitorContext): ConversationContextBuilder {
  if (!lazyContextBuilder) {
    lazyContextBuilder = new ConversationContextBuilder({
      client: {
        conversations: {
          history: (args) => ctx.app.client.conversations.history(args),
          replies: (args) => ctx.app.client.conversations.replies(args),
        },
      },
      botToken: ctx.botToken,
      botUserId: ctx.botUserId,
      resolveUserName: (userId) => ctx.resolveUserName(userId),
      db: openSentinelDb(join(homedir(), ".openclaw/sentinel.db")),
    });
  }
  return lazyContextBuilder;
}

const EMPTY_CONTEXT: ConversationContext = { full: "", history: "" };

async function buildConvoContext(
  event: SlackMessageEvent,
  ctx: SlackMonitorContext,
): Promise<ConversationContext> {
  if (!convoContextEnabled()) {
    return EMPTY_CONTEXT;
  }
  try {
    return await getContextBuilder(ctx).build({
      channel: event.channel,
      threadTs: event.thread_ts,
      userId: event.user ?? "",
      excludeTs: event.ts,
    });
  } catch (err) {
    ctx.runtime.log(`[context] build failed: ${String(err)}`);
    return EMPTY_CONTEXT;
  }
}

/**
 * @returns true always — either the triage pipeline consumed the message (plan posted, awaiting
 *          approval) or chat-v2 handled it (reasoner+responder reply posted). Never falls through.
 */
export async function runTriagePipeline(
  event: SlackMessageEvent,
  ctx: SlackMonitorContext,
): Promise<boolean> {
  const expired = getStore().expireStale(STALE_SESSION_IDLE_MS);
  if (expired > 0) {
    ctx.runtime.log(`[triage] expired ${expired} stale session(s) to ABANDONED`);
  }

  const session = getStore().create({
    channel: event.channel,
    thread_ts: event.thread_ts ?? event.ts ?? event.event_ts ?? "",
    requester_user_id: event.user ?? "",
    requester_message: event.text ?? "",
  });

  const convoContext = await buildConvoContext(event, ctx);
  const c = await getClassifier().classify(event.text ?? "", convoContext.full || undefined);
  getStore().setClassifierOutput(session.request_id, c);
  getStore().transition(session.request_id, "CLASSIFIED");

  if (!c.is_task) {
    // Not a task — cancel the session and route to chat-v2 (reasoner + responder)
    getStore().transition(session.request_id, "CANCELLED");
    await routeToChat(event, ctx, convoContext);
    return true;
  }

  getStore().transition(session.request_id, "PLANNING");

  // Seed the registry with the live Slack client on first call (no-op on subsequent calls
  // because getRegistry() memoises after the first invocation).
  getRegistry(ctx.app.client as SlackClientLike, ctx.botToken);

  let plan: Plan;
  try {
    plan = await getPlanner().plan(event.text ?? "", convoContext.full || undefined);
  } catch (planErr) {
    // F-A: planner failed (e.g. produced an unknown action, invalid args, unparseable JSON).
    // Cancel the session and fall through to chat-v2 so the user gets a coherent response.
    ctx.runtime.log(
      `[triage] planner error — cancelling session ${session.request_id} and falling back to chat-v2: ${String(planErr)}`,
    );
    getStore().transition(session.request_id, "CANCELLED");
    await routeToChat(event, ctx, convoContext);
    return true;
  }

  // Empty-plan fallthrough: planner emitted no steps because no catalog action fit.
  // The request is informational — route to chat-v2 to answer from JR's knowledge.
  if (plan.steps.length === 0) {
    ctx.runtime.log(
      `[triage] empty plan from planner — request is informational, falling back to chat-v2 for session ${session.request_id}`,
    );
    getStore().transition(session.request_id, "CANCELLED");
    await routeToChat(event, ctx, convoContext);
    return true;
  }

  getStore().setFinalPlan(session.request_id, plan);
  getStore().appendPlanHistory(session.request_id, { plan, edit_text: null, ts: Date.now() });

  const planText = renderPlanForApproval(plan);
  const posted = await ctx.app.client.chat.postMessage({
    token: ctx.botToken,
    channel: event.channel,
    thread_ts: event.thread_ts ?? event.ts,
    text: planText,
  });
  getStore().updateProgressTs(session.request_id, posted.ts ?? "");
  getStore().transition(session.request_id, "AWAITING_APPROVAL");
  return true;
}

/**
 * Handle a Slack thread reply that may be an approval signal for an active triage session.
 *
 * Returns true if the message was consumed (caller should NOT fall through to re-triage).
 * Returns false if there is no active session for this thread (caller may proceed normally).
 */
export async function handleThreadReplyForActiveTriage(
  event: SlackMessageEvent,
  ctx: SlackMonitorContext,
): Promise<boolean> {
  const expired = getStore().expireStale(STALE_SESSION_IDLE_MS);
  if (expired > 0) {
    ctx.runtime.log(`[triage] expired ${expired} stale session(s) to ABANDONED`);
  }

  const thread_ts = event.thread_ts;
  if (!thread_ts) {
    return false;
  }

  const active = getStore().findActive(event.channel, thread_ts);
  if (!active) {
    return false;
  }
  if (active.state !== "AWAITING_APPROVAL") {
    // Session is active but not yet waiting for approval (e.g. still PLANNING).
    // Swallow the message silently so the re-triage gate does not see it.
    ctx.runtime.log(
      `[triage] thread reply ignored — session ${active.request_id} is in ${active.state}, not AWAITING_APPROVAL`,
    );
    return true;
  }

  const signal = parseApprovalReply(event.text ?? "");

  if (signal.kind === "approve") {
    getStore().transition(active.request_id, "EXECUTING");
    const slackBridge = {
      post: async (text: string) => {
        const r = await ctx.app.client.chat.postMessage({
          token: ctx.botToken,
          channel: event.channel,
          thread_ts,
          text,
        });
        return { ts: r.ts ?? "" };
      },
      edit: async (ts: string, text: string) => {
        await ctx.app.client.chat.update({
          token: ctx.botToken,
          channel: event.channel,
          ts,
          text,
        });
      },
    };
    const exec = new Executor({
      store: getStore(),
      registry: getRegistry(ctx.app.client as SlackClientLike, ctx.botToken),
      slack: slackBridge,
    });
    await exec.run(active.request_id);
  } else if (signal.kind === "cancel") {
    getStore().transition(active.request_id, "CANCELLED");
    await ctx.app.client.chat.postMessage({
      token: ctx.botToken,
      channel: event.channel,
      thread_ts,
      text: "Cancelled. Nothing executed.",
    });
  } else if (signal.kind === "edit") {
    getStore().transition(active.request_id, "EDITING");
    const convoContext = await buildConvoContext(event, ctx);
    const newPlan = await getPlanner().replan(
      active.requester_message,
      active.final_plan!,
      signal.edit_text,
      convoContext.full || undefined,
    );
    const diff = getPlanner().renderDiff(active.final_plan!, newPlan);
    if (active.progress_ts) {
      await ctx.app.client.chat.update({
        token: ctx.botToken,
        channel: event.channel,
        ts: active.progress_ts,
        text: `${diff}\n\nReply **yes** to approve the revision, or describe another edit.`,
      });
    }
    getStore().setFinalPlan(active.request_id, newPlan);
    getStore().appendPlanHistory(active.request_id, {
      plan: newPlan,
      edit_text: signal.edit_text,
      ts: Date.now(),
    });
    getStore().transition(active.request_id, "AWAITING_APPROVAL");
  }
  // signal.kind === "ignore" → still consumed (the thread belongs to active triage)
  return true;
}

async function routeToChat(
  event: SlackMessageEvent,
  ctx: SlackMonitorContext,
  convoContext?: ConversationContext,
): Promise<void> {
  const isDm = event.channel?.startsWith("D") ?? false;
  await handleChatMessage(
    {
      userMessage: event.text ?? "",
      channel: event.channel,
      threadTs: event.thread_ts ?? event.ts,
      isDm,
      requesterUserId: event.user,
      convoContext: convoContext && convoContext.full !== "" ? convoContext : undefined,
    },
    {
      llm: llmClient,
      slackPost: async (params) => {
        await ctx.app.client.chat.postMessage({
          token: ctx.botToken,
          channel: params.channel,
          thread_ts: params.thread_ts,
          text: params.text,
        });
      },
      ...(oracleSurface ? { oracle: oracleSurface } : {}),
      ...(chatRagDeps ? { embeddings: chatRagDeps.embeddings, sentinelDb: chatRagDeps.db } : {}),
      ...(followupsEnabled()
        ? {
            fileFollowup: (f: {
              kind: "dm_person" | "note" | "task";
              payload: Record<string, unknown>;
            }) =>
              fileAndProcessFollowup(ctx, {
                kind: f.kind,
                payload: f.payload,
                source: "chat",
                sourceRef: `${event.channel}:${event.ts ?? ""}`,
                requesterUserId: event.user,
              }),
            followupAliases: Object.keys(SLACK_USER_ALIASES),
          }
        : {}),
    },
  );
}

function renderPlanForApproval(plan: Plan): string {
  const lines = [
    `📋 *Plan:* _${plan.summary}_ (confidence ${Math.round(plan.confidence * 100)}%)`,
    "",
  ];
  plan.steps.forEach((s, i) => {
    lines.push(`${i + 1}. \`${s.action}\`${s.rationale ? ` — ${s.rationale}` : ""}`);
  });
  lines.push("", "Reply *yes* / *go* to approve, *no* / *cancel* to abort, or describe an edit.");
  return lines.join("\n");
}

/**
 * Spawn a triage session for a queued `task` follow-up. Opens a DM with the requester,
 * posts an anchor message, then runs the normal triage pipeline with the anchor ts as
 * the thread root — so plan approval ("yes" in the thread) reuses the existing
 * handleThreadReplyForActiveTriage flow unchanged.
 */
export async function spawnFollowupTask(
  input: SpawnTaskInput,
  ctx: SlackMonitorContext,
): Promise<void> {
  const opened = await ctx.app.client.conversations.open({
    token: ctx.botToken,
    users: input.requesterUserId,
  });
  const channel = (opened as { channel?: { id?: string } }).channel?.id;
  if (!channel) {
    throw new Error(`could not open DM with ${input.requesterUserId}`);
  }
  const introText = `Following up on your earlier request${input.context ? ` (${input.context})` : ""}: *${input.taskText}*\nWorking on a plan — I'll post it in this thread.`;
  const intro = await ctx.app.client.chat.postMessage({
    token: ctx.botToken,
    channel,
    text: introText,
  });
  const syntheticEvent: SlackMessageEvent = {
    type: "message",
    channel,
    user: input.requesterUserId,
    text: input.taskText,
    ts: intro.ts ?? String(Date.now() / 1000),
  };
  await runTriagePipeline(syntheticEvent, ctx);
}
