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
  const aliasList = Object.keys(userAliases ?? {}).join(", ") || "(none)";
  return `
- If the person asks you to do something later — message someone else ("ask Ridge"), look into something, or perform a task — return:
  {"action":"file_followup","kind":"dm_person"|"note"|"task","payload":{...},"reply_text":"<honest reply that says you've queued it>","takeaway":"<what you learned + what was queued>"}
  Payload shapes:
  - dm_person: {"target_alias":"<one of: ${aliasList}>","topic":"...","question_text":"<the question to DM them>","context":"<one-line handoff, e.g. 'Kaleb pointed me your way about X'>"}
  - note: {"text":"<what to surface in the daily report>"}
  - task: {"task_text":"<the task in plain words>","context":"<brief background>"}
  For dm_person, the target_alias MUST be one of: ${aliasList}. If the person they name is not in that list, use kind "note" instead.

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
 * Handle an incoming DM reply. Returns true if the message was consumed by an active
 * conversation (caller should stop processing). Returns false if no conversation is open
 * for this person.
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

  // Append the person's reply to the conversation
  deps.store.appendTurn(conversation.id, {
    sender: "person",
    text: event.text,
    ts: replyTs,
  });

  // Check for opt-out signal
  const optOutResult = detectOptOut(event.text);
  if (optOutResult.matched) {
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
    const reply = deps.channelResolver
      ? await deps.channelResolver.enrichText(decision.reply_text)
      : decision.reply_text;
    await deps.postMessage(event.channel, reply);
    deps.store.appendTurn(conversation.id, {
      sender: "jr",
      text: decision.reply_text,
      ts: Date.now(),
    });
    deps.store.close(conversation.id, "closed", decision.takeaway);
    if (deps.fileFollowup) {
      await deps.fileFollowup({
        kind: decision.kind,
        payload: decision.payload,
        source: "conversation",
        sourceRef: String(conversation.id),
        requesterUserId: event.user,
      });
    }
  }

  return true;
}
