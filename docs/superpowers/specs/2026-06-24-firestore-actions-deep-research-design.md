# Firestore actions + deep-research bundle

**Date:** 2026-06-24
**Status:** Approved (design phase)
**Builds on:**

- PR #11 (chat-v2 RAG): proved the response path can ground on retrieved data
- PR #12 (salvage): shipped the planner playbook + classifier bias that ASSUME these actions exist; live evidence today showed `unknown action in plan: firestoreKeys` failing every data-shaped DM
- PR #13 + #14 (RAG widening + threshold tune): added observations as a third RAG source

## Problem & scope

Three observable failures today motivated this spec:

1. **The planner generates plans that reference Firestore actions that don't exist.** Live log from a DM: `[triage] planner error — cancelling session ... unknown action in plan: firestoreKeys`. Every data-shaped question falls through to a generic chat reply.
2. **Even when JR succeeds at fetching data through other paths, the executor truncates every action result to 200 characters before the responder sees it.** A `firestoreQuery` returning 5 docs reaches the responder as a 200-char JSON fragment — context loss before the reply is composed.
3. **`research_bundle` column already exists in `triage_sessions` but nothing populates it.** The slot was designed for exactly this; it's been dead code.

This spec builds the 5 read-only Firestore actions, wires the research bundle to accumulate full results, and adds a single-pass-with-audit-loop so JR can decide whether the gathered data is enough or whether to dig deeper before responding.

**Out of scope for v1:**

- Write actions (`firestoreSet`, `firestoreDelete`) — separate PR with explicit approval flow
- Iterative replanning beyond one audit follow-up round
- Streaming intermediate findings ("looking at vero_projects…") to the user
- Cross-collection joins beyond what users compose by chaining queries

## Decisions made during brainstorming

- **Read-only first.** 5 actions: `Collections`, `Keys`, `Get`, `Query`, `Count`. Writes ship in a follow-up PR with approval/rollback semantics.
- **Single-pass with one audit follow-up.** Not full iterative replanning — bounded to one extra round to keep cost + latency predictable.
- **Full results into a research bundle, not just per-step excerpts.** The current 200-char excerpt path stays (powers the `execution_log` for debugging), but a parallel `research_bundle` captures full action results and feeds the responder.
- **`_display` convention from PR #12** is reused. Each action returns `{ <full result fields>, _display: "<markdown summary>" }`. Executor reads `_display` for excerpts; bundle stores the raw result.
- **No auth model change.** Reuses the existing `GOOGLE_APPLICATION_CREDENTIALS` Firebase admin SA (already has `roles/datastore.user`). No new credential, no IT-SEC-001 trigger.
- **Bounded bundle.** Cap total bundle size at 50KB; oversized query results truncated to top N + a "truncated, full count: M" marker so the responder knows what was elided.

## Component architecture

### File structure

| File                                          | Responsibility                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `src/triage/actions/firestore/client.ts`      | NEW. Lazy-construct Firestore client from `GOOGLE_APPLICATION_CREDENTIALS`. Test seam.                        |
| `src/triage/actions/firestore/collections.ts` | NEW. `firestoreCollections` action — list root collections.                                                   |
| `src/triage/actions/firestore/keys.ts`        | NEW. `firestoreKeys` action — sample N docs, return union of field names.                                     |
| `src/triage/actions/firestore/get.ts`         | NEW. `firestoreGet` action — fetch single doc by id.                                                          |
| `src/triage/actions/firestore/query.ts`       | NEW. `firestoreQuery` action — filter + order + limit.                                                        |
| `src/triage/actions/firestore/count.ts`       | NEW. `firestoreCount` action — count docs with optional where.                                                |
| `src/triage/actions/firestore/format.ts`      | NEW. Shared `_display` formatters (truncation, schema rendering, doc rendering).                              |
| `src/triage/actions/index.ts`                 | Modified. Register the 5 new actions.                                                                         |
| `src/triage/research-bundle.ts`               | NEW. Type + helpers for the bundle (append, cap-by-size, serialize).                                          |
| `src/triage/executor.ts`                      | Modified. Append full results to bundle alongside existing excerpt logic.                                     |
| `src/triage/session-store.ts`                 | Modified. Persist bundle to `research_bundle` column; load on read.                                           |
| `src/triage/auditor.ts`                       | NEW. LLM-backed module: `audit({ question, plan, bundle }) → { sufficient, additional_steps? }`.              |
| `src/slack/monitor/triage-bridge.ts`          | Modified. After Executor first pass, call Auditor; if needed, run additional steps; pass bundle to responder. |
| `src/triage/chat/responder.ts`                | Modified. Accept research bundle; render it into the responder prompt so the LLM sees full data.              |
| `tests/triage/actions/firestore/*.test.ts`    | NEW. Per-action unit tests with fake Firestore client.                                                        |
| `tests/triage/research-bundle.test.ts`        | NEW. Append, cap-by-size, serialize round-trip.                                                               |
| `tests/triage/auditor.test.ts`                | NEW. Sufficient / insufficient paths, malformed LLM response, timeout.                                        |

### Action surface

Every action implements the existing `Action` interface with typed args + result. Each result is `{ <data>, _display: string }`. `_display` is what the executor stores as the per-step excerpt; `<data>` (without `_display` stripped) goes into the bundle.

| Action                 | Args                                                      | Result                                                          |
| ---------------------- | --------------------------------------------------------- | --------------------------------------------------------------- |
| `firestoreCollections` | `{}`                                                      | `{ collections: string[], _display }`                           |
| `firestoreKeys`        | `{ collection, sample?: number = 5 }`                     | `{ collection, keys: string[], sample_docs: Doc[], _display }`  |
| `firestoreGet`         | `{ collection, id }`                                      | `{ collection, id, doc: Doc \| null, _display }`                |
| `firestoreQuery`       | `{ collection, where?: WhereClause[], orderBy?, limit? }` | `{ collection, docs: Doc[], total_returned: number, _display }` |
| `firestoreCount`       | `{ collection, where?: WhereClause[] }`                   | `{ collection, count: number, _display }`                       |

Where:

```ts
type WhereClause = {
  field: string;
  op: "==" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "array-contains";
  value: unknown;
};
type OrderBy = { field: string; direction?: "asc" | "desc" };
type Doc = { _id: string } & Record<string, unknown>;
```

`firestoreQuery` enforces `limit <= 50` to prevent runaway result sets. If the user explicitly needs more, they chain multiple queries.

### Research bundle

```ts
// src/triage/research-bundle.ts
export interface BundleEntry {
  step_idx: number;
  action: string;
  args: Record<string, unknown>;
  status: "success" | "error";
  result?: unknown; // full action result, _display stripped
  error?: string;
  invoked_at: number;
}

export interface ResearchBundle {
  entries: BundleEntry[];
  truncated: boolean;
  total_bytes: number;
}

export function appendEntry(bundle: ResearchBundle, entry: BundleEntry): ResearchBundle;
export function serializeForPrompt(bundle: ResearchBundle): string;
```

**Size cap:** if appending an entry would push `total_bytes > 50_000`, the result field gets replaced with a marker: `{ "_truncated": true, "summary": "<first 500 chars + ellipsis>" }`, `bundle.truncated = true`, and we move on. Better partial context than blocking the cycle.

**Persistence:** `session-store.ts` saves `bundle` as JSON in `research_bundle` column at session completion. The column is large-ish text; no schema change needed (already exists as TEXT).

### Auditor

```ts
// src/triage/auditor.ts
export interface AuditInput {
  question: string;     // user's original message
  plan: Plan;           // what we executed
  bundle: ResearchBundle;
}
export interface AuditOutput {
  sufficient: boolean;
  rationale: string;    // why sufficient/insufficient (for logging + debugging)
  additional_steps?: Step[]; // up to 3 extra steps to run if insufficient
}
export class Auditor {
  constructor(private deps: { llm: LlmClient });
  async audit(input: AuditInput): Promise<AuditOutput>;
}
```

System prompt asks Gemini Flash:

```
You're JR's research auditor. The user asked: <question>.
JR ran this plan: <plan>.
Results so far: <bundle.serializeForPrompt()>.

Decide:
- Can JR answer the user well from what's here? (sufficient: true)
- Or are there obvious gaps? (sufficient: false + propose up to 3 more steps using the same action catalog)

Return JSON: { "sufficient": bool, "rationale": "<short why>", "additional_steps"?: [...] }
```

**Cost:** one Flash call per data-shaped DM, ~$0.0001. Trivial.

**Latency:** Flash is fast (~1-3s). Adds modest tail latency but pays for itself in answer quality.

**Failure modes:**

- LLM throws → catch, log warn, return `{ sufficient: true, rationale: "audit failed; degraded to one-shot" }`. Never block the response.
- LLM returns malformed JSON → same as throw.
- LLM proposes a step using an unknown action → drop that step before re-executing.

### Audit-replan loop (in triage-bridge)

Pseudo-code:

```ts
const result = await executor.execute(session.request_id); // initial plan
const bundle = await sessionStore.getBundle(session.request_id);
const audit = await auditor.audit({ question: event.text, plan: session.final_plan, bundle });
if (!audit.sufficient && audit.additional_steps && audit.additional_steps.length > 0) {
  const followupPlan = { ...session.final_plan, steps: audit.additional_steps };
  await executor.executeAdditional(session.request_id, followupPlan); // appends to bundle
  // bundle now has both rounds' worth of data
}
const bundleFinal = await sessionStore.getBundle(session.request_id);
await respondViaChat(event, ctx, convoContext, { researchBundle: bundleFinal });
```

The existing `routeToChat` already wires the chat handler; we just pass the bundle through as an additional field on the handler's input. The chat handler then forwards it into the responder.

### Responder integration

`Responder.respond()` gains an optional `researchBundle` input. When present, the responder prompt gets an extra block:

```
You also have JR's research results from this turn (these are the SOURCE OF TRUTH — do not invent fields, do not fabricate values, cite the bundle):

<bundle.serializeForPrompt()>
```

The anti-hallucination guard from PR #12 already covers "no fake data" — this just gives the LLM the actual data to draw from.

## Data flow (revised)

```
User DM
  → Classifier (is_task=true)
  → Planner (multi-step plan referencing firestoreKeys/Query/Count/...)
  → Executor (initial run)
    ├─ per-step _display → execution_log (existing path, 200-char excerpts)
    └─ per-step full result → research_bundle (NEW path, capped at 50KB)
  → Auditor (sufficient? → yes → done, no → propose up to 3 more steps)
  → [If insufficient] Executor.executeAdditional (appends to bundle)
  → routeToChat with researchBundle
  → Reasoner (existing flow, sees bundle via context)
  → Responder (sees full bundle, grounds reply on real values)
```

## Cost / latency per data-shaped DM

- 5 Firestore reads (worst case): ~50ms total (Firestore is fast)
- 1 Auditor Flash call: ~1-3s
- Existing reasoner + responder: ~5-15s (unchanged)
- Total added: ~1-3s and ~$0.0001-$0.001 per DM

Acceptable trade for going from "JR generates a generic chat reply because the plan failed" to "JR returns real data from Firestore."

## Security notes (IT-SEC-001)

- No new credentials. Reuses `GOOGLE_APPLICATION_CREDENTIALS` (firebase-adminsdk SA) already wired for sentinel + oracle.
- **Read-only:** the actions never call `.set()`, `.update()`, `.delete()`, `.add()`. Even though the SA has write permissions, the action code path doesn't expose them.
- **Permission boundary:** any collection accessible to the SA is queryable by JR. No collection allowlist in v1 — assumes the SA's role boundary is the security boundary. If a later phase needs tighter scoping (e.g., "don't let JR read PII collections"), it goes into a separate `firestoreAllowlist` config; explicit follow-up.
- Bundle persisted to `triage_sessions.research_bundle` lives only in `~/.openclaw/sentinel.db` (local SQLite, same trust boundary as the existing `data` columns).

## Testing

- **Per-action unit tests** with a fake `Firestore` client returning canned data. Cover: success path, empty result, bad-arg validation, error wrapping.
- **research-bundle.test.ts**: append, cap-by-size truncation marker, serialize-for-prompt format.
- **auditor.test.ts**: sufficient verdict, insufficient with valid additional_steps, malformed JSON degrades to sufficient=true, unknown-action step filtered out.
- **End-to-end triage test**: stub planner + auditor + Firestore. Verify the bundle accumulates across initial + additional rounds and the responder receives the full bundle.
- **Live smoke (operator-gated):** DM JR a data-shaped question, watch for: planner generates a Firestore plan, executor runs without "unknown action" errors, auditor decides sufficient/insufficient, responder cites specific Firestore values in the reply.

## Acceptance criteria

1. The 5 read-only Firestore actions exist + register in the catalog + each has passing unit tests.
2. `research_bundle` column populated with full action results after any triage session that executed at least one action.
3. Auditor runs after initial executor pass; logs `[auditor] sufficient=true|false (rationale)` for observability.
4. When auditor returns `sufficient=false` with valid `additional_steps`, those steps execute and their results join the bundle before responder runs.
5. Responder prompt contains the full bundle (no truncation to per-step excerpts).
6. Live smoke: DM JR _"how many open work orders do we have?"_ — get back an actual count from Firestore, not "I'd need to look that up — want me to try?"

## Open questions

None at design time. Bundle size cap (50KB), audit follow-up cap (1 round, ≤3 steps), and query limit (50 docs) are tuneable file-local constants — revisit after a week of live usage.
