import type { Database as DatabaseType } from "better-sqlite3";
import { z } from "zod";
import type { LlmClient } from "../triage/llm-client.js";
import type { ConversationStore } from "./conversation-store.js";
import type { FollowupKind, FollowupSource } from "./followup-store.js";
import { detectOptOut } from "./opt-out-detector.js";
import type { ChannelNameResolver } from "./slack-resolvers.js";

export interface ConversationReplyEvent {
  user: string;
  channel: string;
  text: string;
  ts: string;
}

export interface ConversationReplyCtx {
  botUserId: string;
}

export interface FileFollowupInput {
  kind: FollowupKind;
  payload: Record<string, unknown>;
  source: FollowupSource;
  sourceRef: string;
  requesterUserId: string;
}

export interface ConversationReplyDeps {
  store: ConversationStore;
  llm: LlmClient;
  db: DatabaseType;
  postMessage: (channel: string, text: string) => Promise<void>;
  kalebUserId?: string;
  channelResolver?: ChannelNameResolver;
  fileFollowup?: (input: FileFollowupInput) => Promise<void>;
  userAliases?: Record<string, string>;
}

async function enrichTurns(
  turns: Array<{ sender: string; text: string }>,
  resolver?: ChannelNameResolver,
): Promise<Array<{ sender: string; text: string }>> {
  if (!resolver) {
    return turns;
  }
  return Promise.all(turns.map(async (t) => ({ ...t, text: await resolver.enrichText(t.text) })));
}

const LlmDecisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ask_followup"), question: z.string() }),
  z.object({ action: z.literal("close_with_thanks"), wrapup: z.string() }),
  z.object({
    action: z.literal("escalate"),
    summary: z.string(),
  }),
  z.object({
    action: z.literal("file_followup"),
    kind: z.enum(["dm_person", "note", "task"]),
    payload: z.record(z.string(), z.unknown()),
    reply_text: z.string(),
    takeaway: z.string(),
  }),
]);

type LlmDecision = z.infer<typeof LlmDecisionSchema>;

const DECISION_SYSTEM_PROMPT_BASE = `You are JR, a second-brain assistant embedded at Vero. You are mid-conversation with a Vero employee, trying to fill knowledge gaps.

Given the conversation history and the latest reply, decide what to do next:

- If the reply is informative but leaves an important open question: return {"action":"ask_followup","question":"<next question>"}
- If you have enough context and the conversation can wrap up: return {"action":"close_with_thanks","wrapup":"<brief thank-you that names the key thing you learned>"}
- If the reply reveals something urgent (broken process, incident, blocker) that Kaleb should know: return {"action":"escalate","summary":"<concise escalation summary>"}`;

function buildFollowupPromptBlock(userAliases: Record<string, string> | undefined): string {
  // Aliases land verbatim inside the prompt — drop anything that could smuggle instructions.
  const aliasList = Object.keys(userAliases ?? {})
    .filter((a) => /^[a-z0-9_.-]+$/i.test(a))
    .join(", ");
  const kinds = aliasList ? `"dm_person"|"note"|"task"` : `"note"|"task"`;
  const dmShape = aliasList
    ? `\n  - dm_person: {"target_alias":"<one of: ${aliasList}>","topic":"...","question_text":"<the question to DM them>","context":"<one-line handoff, e.g. 'Kaleb pointed me your way about X'>"}`
    : "";
  const dmRule = aliasList
    ? `\n  For dm_person, the target_alias MUST be one of: ${aliasList}. If the person they name is not in that list, use kind "note" instead.`
    : "";
  return `
- If the person asks you to do something later — message someone else ("ask Ridge"), look into something, or perform a task — return:
  {"action":"file_followup","kind":${kinds},"payload":{...},"reply_text":"<honest reply that says you've queued it>","takeaway":"<what you learned + what was queued>"}
  Payload shapes:${dmShape}
  - note: {"text":"<what to surface in the daily report>"}
  - task: {"task_text":"<the task in plain words>","context":"<brief background>"}${dmRule}

HONESTY RULE: Never claim you WILL do something in the future. Either file_followup now (then reply_text says "I've queued it") or say you can't. Promises without a filed follow-up are forbidden.`;
}

function buildDecisionPrompt(
  topic: string,
  turns: Array<{ sender: string; text: string }>,
  followupBlock: string,
): string {
  const history = turns.map((t) => `${t.sender === "jr" ? "JR" : "Person"}: ${t.text}`).join("\n");
  const systemPrompt = `${DECISION_SYSTEM_PROMPT_BASE}${followupBlock}

Return JSON only. One action. Colleague tone — no preamble.`;
  return `${systemPrompt}\n\nTopic: ${topic}\n\nConversation so far:\n${history}\n\nJSON decision:`;
}

async function decideLlm(
  llm: LlmClient,
  topic: string,
  turns: Array<{ sender: string; text: string }>,
  followupBlock: string,
): Promise<LlmDecision> {
  const prompt = buildDecisionPrompt(topic, turns, followupBlock);
  const raw = await llm.complete(prompt, { model: "gemini-flash", temperature: 0.3 });
  const stripped = raw.trim().replace(/^```(?:json)?\n?|\n?```$/g, "");
  return LlmDecisionSchema.parse(JSON.parse(stripped));
}

/**
 * Inline staleness threshold for open conversations. Measures time since the
 * PERSON's last turn — JR's own follow-up questions don't reset the clock. If the
 * person never replied, falls back to opened_at.
 *
 * The sentinel cycle's periodic `expireStale` runs every ~2h with the same
 * semantics; this inline check catches conversations going stale between sweeps so
 * an incoming DM gets routed to triage as a fresh task instead of being absorbed
 * by a long-dead inquiry.
 *
 * Override with OPENCLAW_CONVO_INLINE_STALE_HOURS (defaults to 1).
 */
function inlineStaleMs(): number {
  const raw = process.env.OPENCLAW_CONVO_INLINE_STALE_HOURS;
  const hours = raw ? Number(raw) : NaN;
  const valid = Number.isFinite(hours) && hours > 0 ? hours : 1;
  return valid * 60 * 60 * 1000;
}

function lastPersonTurnTs(turns: Array<{ sender: string; ts: number }>): number | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].sender === "person") {
      return turns[i].ts;
    }
  }
  return null;
}

/**
 * Handle an incoming DM reply. Returns true if the message was consumed by an active
 * conversation (caller should stop processing). Returns false if no open conversation
 * exists, OR if the open conversation is stale enough that the message should be
 * treated as a fresh task and routed to triage instead.
 */
export async function handleConversationReply(
  event: ConversationReplyEvent,
  _ctx: ConversationReplyCtx,
  deps: ConversationReplyDeps,
): Promise<boolean> {
  const conversation = deps.store.findOpenForPerson(event.user);
  if (!conversation) {
    return false;
  }

  const replyTs = Number(event.ts) * 1000 || Date.now();

  // Opt-out ALWAYS wins, BEFORE the staleness check. A "stop asking me" that
  // arrives more than an hour after JR's question must still be honored —
  // otherwise the staleness drop below silently swallows the signal (routing
  // the message to triage as a fresh task) and JR keeps pestering the person
  // about a topic they've explicitly closed.
  const optOutResult = detectOptOut(event.text);
  if (optOutResult.matched) {
    deps.store.appendTurn(conversation.id, { sender: "person", text: event.text, ts: replyTs });
    deps.db
      .prepare(
        `INSERT INTO opt_outs (person_user_id, scope, added_at, reason)
         VALUES (?, 'global', ?, ?)`,
      )
      .run(event.user, Date.now(), event.text);

    deps.store.close(conversation.id, "opt-out");

    await deps.postMessage(event.channel, "Got it — I'll stop. Sorry to bother you.");
    return true;
  }

  // Inline staleness check — measure time since the PERSON's last reply.
  // JR's follow-up turns don't reset the clock; only the human's responses do.
  // If the person never replied, fall back to opened_at.
  const baseline = lastPersonTurnTs(conversation.turns) ?? conversation.opened_at;
  if (Date.now() - baseline > inlineStaleMs()) {
    // Preserve the late reply on the (now closed) conversation for recall
    // before dropping it, then let the caller route it to triage as a fresh
    // task. Without the append, the human's words were lost entirely.
    deps.store.appendTurn(conversation.id, { sender: "person", text: event.text, ts: replyTs });
    deps.store.close(
      conversation.id,
      "dropped",
      "Auto-closed on next DM: 1h since the person's last reply (or since open). Turns preserved for recall.",
    );
    return false;
  }

  // Append the person's reply to the conversation
  deps.store.appendTurn(conversation.id, {
    sender: "person",
    text: event.text,
    ts: replyTs,
  });

  // Build current turns for LLM
  const updatedConversation = deps.store.findOpenForPerson(event.user);
  const turns = updatedConversation?.turns ?? conversation.turns;

  const followupBlock = deps.fileFollowup ? buildFollowupPromptBlock(deps.userAliases) : "";

  let decision: LlmDecision;
  try {
    const enrichedTurns = await enrichTurns(turns, deps.channelResolver);
    decision = await decideLlm(deps.llm, conversation.topic, enrichedTurns, followupBlock);
  } catch {
    // LLM error: leave conversation open, don't crash
    return true;
  }

  if (decision.action === "ask_followup") {
    const followupTs = Date.now();
    const question = deps.channelResolver
      ? await deps.channelResolver.enrichText(decision.question)
      : decision.question;
    await deps.postMessage(event.channel, question);
    deps.store.appendTurn(conversation.id, {
      sender: "jr",
      text: decision.question,
      ts: followupTs,
    });
    // conversation stays open
  } else if (decision.action === "close_with_thanks") {
    const wrapup = deps.channelResolver
      ? await deps.channelResolver.enrichText(decision.wrapup)
      : decision.wrapup;
    await deps.postMessage(event.channel, wrapup);
    deps.store.appendTurn(conversation.id, {
      sender: "jr",
      text: decision.wrapup,
      ts: Date.now(),
    });
    deps.store.close(conversation.id, "closed", decision.wrapup);
  } else if (decision.action === "escalate") {
    deps.store.close(conversation.id, "closed", decision.summary);
    if (deps.kalebUserId) {
      const rawMsg = `[Escalation from JR inquiry — topic: ${conversation.topic}]\n\n${decision.summary}`;
      const msg = deps.channelResolver ? await deps.channelResolver.enrichText(rawMsg) : rawMsg;
      await deps.postMessage(deps.kalebUserId, msg);
    }
  } else if (decision.action === "file_followup") {
    // File BEFORE replying so reply_text ("I've queued it") is never a false claim.
    // No filing dep (flag off) counts as not filed — the LLM can emit this action
    // unprompted, and replying with reply_text would be the false promise this
    // feature exists to prevent.
    let filed = Boolean(deps.fileFollowup);
    if (deps.fileFollowup) {
      try {
        await deps.fileFollowup({
          kind: decision.kind,
          payload: decision.payload,
          source: "conversation",
          sourceRef: String(conversation.id),
          requesterUserId: event.user,
        });
      } catch (err) {
        filed = false;
        // eslint-disable-next-line no-console
        console.error("[sentinel] fileFollowup failed:", (err as Error).message);
      }
    }
    const replyText = filed
      ? decision.reply_text
      : "I tried to queue that follow-up but it failed on my end, so I can't promise it right now.";
    const reply = deps.channelResolver
      ? await deps.channelResolver.enrichText(replyText)
      : replyText;
    await deps.postMessage(event.channel, reply);
    deps.store.appendTurn(conversation.id, {
      sender: "jr",
      text: replyText,
      ts: Date.now(),
    });
    deps.store.close(conversation.id, "closed", decision.takeaway);
  }

  return true;
}
