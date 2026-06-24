import { readFileSync } from "node:fs";
import type { Database as DatabaseType } from "better-sqlite3";
import type { EmbeddingService } from "../../sentinel/embeddings/service.js";
import type { Recommendation } from "../../sentinel/oracle/store.js";
import type { LlmClient } from "../llm-client.js";
import type { ResearchBundle } from "../research-bundle.js";
import {
  detectActionRecommendationIntent,
  formatRecommendationsReply,
} from "./intents/action-recommendation.js";
import { buildRagContext } from "./rag-context.js";
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
  // RAG context: when BOTH present, the handler builds a "Relevant knowledge
  // from JR's memory" block and prepends it to the reasoner's contextBlock.
  // Either missing → behavior unchanged.
  embeddings?: EmbeddingService;
  sentinelDb?: DatabaseType;
}

export async function handleChatMessage(
  input: {
    userMessage: string;
    channel: string;
    threadTs?: string;
    isDm: boolean;
    convoContext?: { full: string; history: string };
    requesterUserId?: string;
    researchBundle?: ResearchBundle;
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

  // RAG augmentation: pull semantically similar insights + oracle recs and
  // prepend to the reasoner's contextBlock. Augmentative-only — any failure
  // returns empty string and we proceed with the original context.
  let augmentedContext = input.convoContext?.full;
  if (deps.embeddings && deps.sentinelDb) {
    const ragBlock = await buildRagContext(input.userMessage, {
      embeddings: deps.embeddings,
      db: deps.sentinelDb,
    });
    if (ragBlock) {
      augmentedContext = augmentedContext ? `${ragBlock}\n\n${augmentedContext}` : ragBlock;
    }
  }

  const reasoned = await reasoner.reason({
    userMessage: input.userMessage,
    contextBlock: augmentedContext,
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
    researchBundle: input.researchBundle,
  });

  await deps.slackPost({
    channel: input.channel,
    thread_ts: input.isDm ? undefined : input.threadTs,
    text: reply,
  });
}

export { Reasoner, Responder };
