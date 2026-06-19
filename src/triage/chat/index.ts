import { readFileSync } from "node:fs";
import type { Recommendation } from "../../sentinel/oracle/store.js";
import type { LlmClient } from "../llm-client.js";
import {
  detectActionRecommendationIntent,
  formatRecommendationsReply,
} from "./intents/action-recommendation.js";
import { Reasoner } from "./reasoner.js";
import { Responder } from "./responder.js";

let cachedPersona: string | null = null;
function loadPersona(): string {
  if (cachedPersona) {
    return cachedPersona;
  }
  try {
    cachedPersona = readFileSync("/Users/vero/openclaw/SOUL.md", "utf-8");
  } catch {
    cachedPersona = "You are JR, a Slack bot. Be terse and helpful.";
  }
  return cachedPersona;
}

export interface ChatHandlerDeps {
  llm: LlmClient;
  slackPost: (params: { channel: string; thread_ts?: string; text: string }) => Promise<void>;
  // Files one follow-up; resolves to a short human description ("queued a DM to ridge
  // about X") or null when filing failed. Presence of this dep enables follow-ups.
  fileFollowup?: (f: {
    kind: "dm_person" | "note" | "task";
    payload: Record<string, unknown>;
  }) => Promise<string | null>;
  followupAliases?: string[];
  // F3 Oracle: when present and the message matches the action-recommendation
  // intent, the handler short-circuits — bypasses reasoner/responder and
  // replies directly from oracle recommendations for the requesting user.
  oracle?: {
    recommendForUser(slackUserId: string): Promise<Recommendation[]>;
  };
}

export async function handleChatMessage(
  input: {
    userMessage: string;
    channel: string;
    threadTs?: string;
    isDm: boolean;
    convoContext?: { full: string; history: string };
    requesterUserId?: string;
  },
  deps: ChatHandlerDeps,
): Promise<void> {
  // F3 Oracle — pattern-match for action-recommendation intent. If matched and
  // an oracle is wired, short-circuit before the reasoner/responder path.
  if (deps.oracle && input.requesterUserId && detectActionRecommendationIntent(input.userMessage)) {
    try {
      const recs = await deps.oracle.recommendForUser(input.requesterUserId);
      await deps.slackPost({
        channel: input.channel,
        thread_ts: input.isDm ? undefined : input.threadTs,
        text: formatRecommendationsReply(recs),
      });
      return;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[chat] oracle recommendForUser failed:", (err as Error).message);
      // fall through to the normal reasoner/responder path
    }
  }

  const reasoner = new Reasoner(deps.llm);
  const responder = new Responder(deps.llm);

  const reasoned = await reasoner.reason({
    userMessage: input.userMessage,
    contextBlock: input.convoContext?.full,
    followups: deps.fileFollowup ? { knownAliases: deps.followupAliases ?? [] } : undefined,
  });

  const queuedActions: string[] = [];
  let failedToQueue = false;
  if (deps.fileFollowup && reasoned.followups && reasoned.followups.length > 0) {
    const fileFollowup = deps.fileFollowup;
    for (const f of reasoned.followups) {
      try {
        const description = await fileFollowup({ kind: f.kind, payload: f.payload });
        if (description) {
          queuedActions.push(description);
        } else {
          failedToQueue = true;
        }
      } catch {
        failedToQueue = true;
      }
    }
  }

  const reply = await responder.respond({
    userMessage: input.userMessage,
    findings: reasoned.findings,
    persona: loadPersona(),
    queuedActions,
    failedToQueue,
    conversationHistory: input.convoContext?.history,
  });

  await deps.slackPost({
    channel: input.channel,
    thread_ts: input.isDm ? undefined : input.threadTs,
    text: reply,
  });
}

export { Reasoner, Responder };
