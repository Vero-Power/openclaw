import { homedir } from "node:os";
import { join } from "node:path";
import { completeSimple, getEnvApiKey, getModel, type TextContent } from "@mariozechner/pi-ai";
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

const STALE_SESSION_IDLE_MS = 30 * 60 * 1000; // 30 minutes

function getStore(): SessionStore {
  if (!lazyStore) {
    lazyDb = openTriageDb(join(homedir(), ".openclaw/triage.db"));
    lazyStore = new SessionStore(lazyDb);
  }
  return lazyStore;
}

function getRegistry(): ReturnType<typeof bootstrapActionCatalog> {
  if (!lazyRegistry) {
    lazyRegistry = bootstrapActionCatalog();
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
    lazyPlanner = new Planner(llmClient, getRegistry());
  }
  return lazyPlanner;
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

  const c = await getClassifier().classify(event.text ?? "");
  getStore().setClassifierOutput(session.request_id, c);
  getStore().transition(session.request_id, "CLASSIFIED");

  if (!c.is_task) {
    // Not a task — cancel the session and route to chat-v2 (reasoner + responder)
    getStore().transition(session.request_id, "CANCELLED");
    const isDm = event.channel?.startsWith("D") ?? false;
    await handleChatMessage(
      {
        userMessage: event.text ?? "",
        channel: event.channel,
        threadTs: event.thread_ts ?? event.ts,
        isDm,
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
      },
    );
    return true;
  }

  getStore().transition(session.request_id, "PLANNING");
  const plan = await getPlanner().plan(event.text ?? "");
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
    const exec = new Executor({ store: getStore(), registry: getRegistry(), slack: slackBridge });
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
    const newPlan = await getPlanner().replan(
      active.requester_message,
      active.final_plan!,
      signal.edit_text,
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
