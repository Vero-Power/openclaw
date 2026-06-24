# Chat-v2 RAG Context

**Date:** 2026-06-22
**Status:** Approved (design phase)
**Builds on:** Phase D embeddings (`docs/superpowers/specs/2026-06-19-sentinel-phase-d-embeddings-design.md`) — this spec is the first general-purpose consumer of the `EmbeddingService.findSimilar` helper outside the oracle's dedup path.

## Problem & scope

When a user DMs JR, the reasoner/responder pair runs against a system prompt that has the persona + conversation history but no grounding in JR's accumulated knowledge. A question like _"what's been going on with the cancellation rate?"_ gets an answer that ignores the synthesizer's existing insight (_"22% cancellation rate, root cause unknown"_) and the oracle's existing recommendation (_"Investigate cancellation rate root causes"_) — JR can't cite or build on what JR already knows.

This spec adds a small RAG layer: embed the user message, pull the top-k most semantically similar rows from `insights` + `oracle_recommendations`, and splice them as plain text into the existing `contextBlock` the reasoner already accepts. No schema change, no new tables, no new auth.

## Decisions made during brainstorming

- **Insights + oracle_recommendations only.** Observations (~1700 rows) are mostly low-signal raw events (channel silence, weather forecasts, gcp-functions execution counts) that would dilute the prompt. Insights are the synthesizer's already-distilled output; oracle_recs are explicit "things to consider." If recall turns out to be insufficient, the helper supports widening to observations later without an architectural change.
- **Top-k split: 3 insights + 2 oracle_recs.** Keeps the prompt addition under ~500 tokens at typical row sizes.
- **Threshold 0.5 cosine.** Drops noise without being so strict it returns empty on most queries. Tuneable as a constant; revisit after a week of live usage.
- **Single integration point in the chat handler.** Reasoner + responder stay untouched. RAG context is concatenated into the existing `contextBlock` the reasoner already accepts.
- **Augmentative, never blocking.** If embedding or DB lookup fails, fall back to whatever context already existed; never throw to the caller.

## Component architecture

### File structure

| File                                    | Responsibility                                                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `src/triage/chat/rag-context.ts`        | NEW. Builds the RAG context block for one user message. Pure module; no Slack/IO side effects.                   |
| `src/triage/chat/index.ts`              | Modified. Wires `embeddings` + `sentinelDb` into `ChatHandlerDeps`; calls `buildRagContext` before the reasoner. |
| `src/slack/monitor/triage-bridge.ts`    | Modified. Passes the live `EmbeddingService` + sentinel DB through to the chat handler.                          |
| `tests/triage/chat/rag-context.test.ts` | NEW. Unit tests for threshold filter, k cap, format, mixed-table ordering, empty result.                         |
| `tests/triage/chat/index.test.ts`       | Updated. New test confirms the reasoner receives RAG-augmented contextBlock when deps are wired.                 |

### Module: `rag-context.ts`

**Public surface:**

```ts
import type { Database as DatabaseType } from "better-sqlite3";
import type { EmbeddingService } from "../../sentinel/embeddings/service.js";

export interface RagContextDeps {
  embeddings: EmbeddingService;
  db: DatabaseType;
}

/**
 * Build a plain-text "Relevant knowledge from JR's memory" block by pulling
 * the top-k most semantically similar rows from insights + oracle_recommendations
 * against the user's message. Returns the empty string when no hits clear the
 * cosine threshold.
 *
 * Augmentative-only: any failure (embed, DB, decode) logs a warn and returns
 * the empty string so the caller can continue with whatever context already
 * existed.
 */
export async function buildRagContext(message: string, deps: RagContextDeps): Promise<string>;
```

**Constants (file-local):**

```ts
const RAG_THRESHOLD = 0.5;
const RAG_K_INSIGHTS = 3;
const RAG_K_ORACLE = 2;
```

**Flow:**

1. Issue `findSimilar({ table: "insights", text: message, k: RAG_K_INSIGHTS })` and `findSimilar({ table: "oracle_recommendations", text: message, k: RAG_K_ORACLE })` in parallel (`Promise.all`).
2. Filter each hit list by `similarity >= RAG_THRESHOLD`.
3. If both filtered lists are empty, return `""`.
4. Resolve hit ids to row data via two queries:
   - `SELECT id, category, summary, confidence FROM insights WHERE id IN (?, ?, ?)`
   - `SELECT id, scope, title, urgency FROM oracle_recommendations WHERE id IN (?, ?)`
5. Format as bullets in this order (insights first, then oracle):
   ```
   Relevant knowledge from JR's memory:
   - [insight | category=operations, conf=0.85] 22% project cancellation rate, root cause unknown
   - [insight | category=signal, conf=0.92] ITC expiration creates TPO opportunity for Vero
   - [oracle rec | urgency=high] Investigate cancellation rate root causes
   ```
6. Return the formatted string.

**Error handling:** Each `findSimilar` call is wrapped in its own `try/catch` so a failure on one table doesn't lose the other table's hits — the surviving table's hits still render. The function body is also wrapped in an outer `try/catch` as a final safety net (covers DB SELECT failures, format errors, anything missed). On any unrecoverable error, `console.warn` with the message and return `""`. The chat handler treats empty-string as "no augmentation" — the user still gets a reply.

### Chat handler wiring (`src/triage/chat/index.ts`)

Extend `ChatHandlerDeps`:

```ts
export interface ChatHandlerDeps {
  // ...existing fields unchanged...
  // RAG context: when both deps present, the handler builds a "Relevant knowledge
  // from JR's memory" block and prepends it to the contextBlock the reasoner uses.
  embeddings?: EmbeddingService;
  sentinelDb?: DatabaseType;
}
```

In `handleChatMessage`, after the oracle short-circuit and before `reasoner.reason()`:

```ts
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
```

The reasoner's existing prompt template already includes `Conversation context:\n${input.contextBlock || "(none)"}` — the RAG block rides that channel verbatim. No prompt-template change required.

### Slack monitor wiring (`src/slack/monitor/triage-bridge.ts`)

The triage bridge is where the chat handler's deps get assembled per incoming Slack message. It already has access to `sentinelDb` and the `EmbeddingService` indirectly through `sentinel.oracle` (set via the existing module-level setter pattern). Add a second setter for the embedding service + DB, called from `slack/monitor/provider.ts` after `createSentinel` resolves:

```ts
// triage-bridge.ts
let chatRagDeps: { embeddings: EmbeddingService; db: DatabaseType } | null = null;
export function setChatRagDeps(d: { embeddings: EmbeddingService; db: DatabaseType }): void {
  chatRagDeps = d;
}
```

The bridge then includes `embeddings` + `sentinelDb` in the `ChatHandlerDeps` object it constructs, matching the existing `oracleSurface` pattern. No new singleton refactor.

### Per-message behavior

Per inbound DM:

1. Existing oracle-intent short-circuit fires first; if matched, RAG is skipped.
2. Otherwise: `buildRagContext(userMessage, { embeddings, db })`.
3. If returned block non-empty, prepend to `convoContext.full`.
4. Reasoner runs against the augmented context.
5. Responder runs as before.

Net latency added per message: one Gemini embedding call (~150–250ms) + two in-memory cosine searches (<5ms) + two SELECTs by id (sub-ms). Acceptable for an interactive chat.

## Cost / latency

- Gemini embedding: one call per inbound DM. At ~150 tokens average per message and Gemini `text-embedding-001` pricing, this is well under $0.0001 per message.
- In-memory cosine: the existing `EmbeddingService` hydrates indexes at sentinel-cycle start; per-call this is brute-force iteration (~3000 rows currently, sub-ms).
- Per-message overhead under 300ms total.

## Error handling

- Embed throws → `buildRagContext` returns `""`, handler proceeds with original context.
- DB SELECT throws → outer try/catch returns `""`.
- One of the two `findSimilar` calls throws → caught by per-call inner try/catch; the surviving table's hits still render.
- No-hits path (everything below threshold) → returns `""`, no degradation in handler.

## Testing

- **`rag-context.test.ts`** with in-memory `sentinel.db` seeded with known insight + oracle rows + fake `EmbeddingService` returning predetermined vectors:
  - Threshold filter excludes a row at cosine 0.49, includes at 0.51.
  - K cap: with 5 insights all above threshold, only 3 are returned.
  - Mixed-table ordering: insights first, then oracle_recs.
  - Empty-result path: returns `""` when no hits clear the threshold.
  - Format correctness: bullet format includes category/scope/urgency/confidence as documented.
  - Failure swallowing: when the embed adapter throws, returns `""` (not throws).
  - Partial failure: when insights findSimilar throws but oracle doesn't (or vice versa), the surviving hits still render.

- **`chat/index.test.ts` update:**
  - When `embeddings` + `sentinelDb` are wired, the reasoner's `contextBlock` contains the RAG block.
  - When deps are absent, the chat handler still works (reasoner gets the original `convoContext.full`).
  - Oracle short-circuit still bypasses RAG.

- **Manual smoke (gated; not part of test suite):** DM JR a question about a topic JR has insights on (e.g., "what's going on with cancellation rate?"); confirm the reply references the existing insight rather than producing a generic answer.

## Out of scope (v1)

- Observations table (option B/C from brainstorming). The helper supports it; we just don't pull from it yet.
- Hybrid lexical + vector retrieval.
- Cross-encoder reranking.
- Token-budget management for RAG context (today at ~500 tokens we're well under any model's input cap; revisit at 10x).
- Caching per-message embeddings (cheap enough not to bother v1).
- Threshold/k tuning UI / env var (constants are module-local; promote to env if real tuning is needed).
- Surfacing RAG context to the user (e.g., "here's what I'm drawing on"). The reply itself is the surface.

## Acceptance criteria

1. New `rag-context.ts` module ships with unit tests; all green.
2. Chat handler accepts the new optional deps without breaking existing tests.
3. When deps are wired and JR is asked about a topic with a high-confidence existing insight, the reply visibly references that insight (manual smoke).
4. When deps are NOT wired (tests, future callers), the chat handler behaves identically to today.
5. Embedding or DB failures during RAG construction do not propagate to the user — the reply still goes out.

## Security notes (IT-SEC-001)

- No new credentials. Reuses `EmbeddingService` which already binds `GEMINI_API_KEY` lazily.
- No new outbound destinations.
- The user message is embedded via Gemini — same provider as existing oracle / external-context flows. No new data egress surface.

## Open questions

None at design time. Threshold (0.5), k split (3+2), and table set (insights + oracle_recs) are all tuneable file-local constants. Revisit after a week of live usage if recall feels off.
