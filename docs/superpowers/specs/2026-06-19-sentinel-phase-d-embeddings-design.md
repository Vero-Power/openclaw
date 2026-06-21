# Sentinel Phase D — Embedding semantic search

**Date:** 2026-06-19
**Status:** Approved (design phase)
**Builds on:** Phase D.1 (F3 Oracle, `docs/superpowers/specs/2026-06-19-sentinel-phase-d-f3-oracle-design.md`) — this spec replaces the oracle's byte-identical dedup with semantic dedup and exposes a general-purpose similarity helper for any downstream consumer.

## Problem & scope

JR's `sentinel.db` now holds three tables that grow with every cycle:

- `observations` (~1,488 rows): per-observer raw findings.
- `insights` (~257 rows): synthesized signal across observations.
- `oracle_recommendations` (6 rows; new): proactive action recommendations.

Today these tables are queried only by timestamp + literal key. That has two visible failure modes:

1. **Oracle re-surfaces "the same action" repeatedly.** Today's `stableId(title, evidence)` hashes only byte-identical inputs. The LLM re-wording the title ("Investigate the 22% cancellation rate" vs "Reduce project cancellations") produces a new `id`, a new "fresh" rec, and a fresh DM — even though semantically it's the same action.
2. **No way to ask "have we seen this before?"** Inquirer cycles, chat-v2 responses, and future observers all want to pull _related_ prior context for any text input. There's no helper for that today.

This spec adds an `EmbeddingService` that powers both:

- Semantic dedup for the oracle (consumer #1, shipped in this PR).
- A generic `findSimilar({ table, text, k, sinceMs? })` helper any module can adopt without further design work.

## Decisions made during brainstorming

- **Model: Gemini `text-embedding-004`.** 768 dims, ~$0.025/1M input tokens, reuses the existing Google auth path. No new credential, no new provider.
- **Storage: SQLite BLOB column per table.** Holds raw bytes of `Float32Array(768)` (3072 bytes/row). No sqlite-vec or external vector DB.
- **Search: brute-force cosine in-memory.** Service loads all embeddings into `Map<id, Float32Array>` at startup; per-query iteration is sub-ms at current scale and stays acceptable to ~100k rows. Revisit when crossed.
- **Embed inline on insert, retry on failure.** Embedding failures don't block row insertion. A nightly task re-embeds rows where `embedding IS NULL`.
- **One v1 consumer (oracle dedup); helper is general.** Inquirer / chat-v2 / cross-observer adoption is left to follow-up tickets — we don't pre-design integrations we haven't seen real demand for.
- **Backfill is one-shot, idempotent.** Re-runs only touch rows still missing embeddings.

## Component architecture

### File structure

| File                                        | Responsibility                                                                                                                                                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/sentinel/embeddings/service.ts`        | NEW. `EmbeddingService` class — wraps Gemini, owns the in-memory indexes, exposes `embed()` + `findSimilar()`.                                                                                                                       |
| `src/sentinel/embeddings/gemini-adapter.ts` | NEW. Thin adapter: text → `Float32Array(768)`. Test seam.                                                                                                                                                                            |
| `src/sentinel/embeddings/cosine.ts`         | NEW. Pure function: cosine similarity between two `Float32Array`s. Trivially unit-testable.                                                                                                                                          |
| `src/sentinel/embeddings/blob-codec.ts`     | NEW. `Float32Array ↔ Buffer` encode/decode. Trivially unit-testable.                                                                                                                                                                 |
| `src/sentinel/db.ts`                        | Modified. After `db.exec(SCHEMA_SQL)` in `openSentinelDb`, run three `ALTER TABLE ... ADD COLUMN embedding BLOB` statements (each wrapped in try/catch that swallows SQLite's "duplicate column name" error — idempotent migration). |
| `src/sentinel/oracle.ts`                    | Modified. `upsertAll()` consults `findSimilar` and merges into the existing row when cosine ≥ threshold within the window.                                                                                                           |
| `src/sentinel/oracle/store.ts`              | Modified. New `mergeInto(existingId, newRec)` method (updates `last_seen_at` + evidence union, keeps `first_seen_at`).                                                                                                               |
| `scripts/embed-backfill.ts`                 | NEW. One-shot CLI. Walks each table, embeds `WHERE embedding IS NULL` rows in batches of 100, writes blobs.                                                                                                                          |
| `tests/sentinel/embeddings/*.test.ts`       | NEW. Cover `cosine`, `blob-codec`, service insert/lookup/threshold paths with a fake embedder.                                                                                                                                       |
| `tests/sentinel/oracle.test.ts`             | Updated. Test the dedup-merge path (same-title rewording maps to existing rec).                                                                                                                                                      |

### Public surface

```ts
// service.ts
export interface FindSimilarOpts {
  table: "observations" | "insights" | "oracle_recommendations";
  text: string;
  k: number;
  sinceMs?: number; // optional cutoff against table's timestamp column
}

export interface SimilarRow {
  id: string | number; // observations/insights use int, oracle uses text — caller knows
  similarity: number; // cosine in [0, 1] (clamped from [-1, 1])
  // No row data here — caller does its own SELECT by id. Keeps the helper narrow.
}

export interface EmbeddingService {
  embed(text: string): Promise<Float32Array>;
  findSimilar(opts: FindSimilarOpts): Promise<SimilarRow[]>;
  /** Embed a row inline and persist. Idempotent — no-op if row already has an embedding. */
  embedAndStore(table: FindSimilarOpts["table"], id: string | number, text: string): Promise<void>;
}

export interface EmbeddingServiceDeps {
  db: DatabaseType;
  adapter: GeminiEmbeddingAdapter;
}

export function createEmbeddingService(deps: EmbeddingServiceDeps): EmbeddingService;
```

### Module: `gemini-adapter.ts`

```ts
export interface GeminiEmbeddingAdapter {
  embed(text: string): Promise<Float32Array>;
}
export function createDefaultGeminiAdapter(): GeminiEmbeddingAdapter;
```

Calls `genai.embedContent({ model: "text-embedding-004", content: { parts: [{ text }] } })`. Auth via `GOOGLE_APPLICATION_CREDENTIALS` (same path used by `external-context.ts` and `company-context.ts`). Returns a normalized 768-dim `Float32Array`.

### Module: `cosine.ts`

```ts
export function cosineSimilarity(a: Float32Array, b: Float32Array): number;
```

Standard formula. Assumes equal length (asserts in dev, no-asserts in prod).

### Module: `blob-codec.ts`

```ts
export function encodeEmbedding(v: Float32Array): Buffer; // length-768
export function decodeEmbedding(buf: Buffer): Float32Array;
```

Direct view over the underlying `ArrayBuffer`. No JSON, no base64.

### Module: `service.ts`

State:

```ts
// One index per table. Keyed by primary key.
private indexes: {
  observations: Map<number, Float32Array>;
  insights: Map<number, Float32Array>;
  oracle_recommendations: Map<string, Float32Array>;
};
```

**Construction:** for each table, one SELECT pulls `(id, embedding, timestamp_col)` for every row where `embedding IS NOT NULL`. The decoded `Float32Array` lands in `indexes[table]` keyed by id, and the row's timestamp lands in a parallel `Map<id, number>` (used by `findSimilar`'s `sinceMs` filter to avoid a per-call SELECT). Timestamp columns: `observations.timestamp`, `insights.generated_at`, `oracle_recommendations.last_seen_at`.

**`embed(text)`:** delegates to adapter. No caching at this layer.

**`embedAndStore(table, id, text)`:**

1. If `indexes[table].has(id)` → return (no-op; row already embedded).
2. `const v = await adapter.embed(text)`.
3. `UPDATE <table> SET embedding = ? WHERE id = ?` with the encoded blob.
4. Update the in-memory index.
5. If step 2 throws, log a warning and return — the row stays in the DB unembedded. Nightly backfill retries.

**`findSimilar({ table, text, k, sinceMs })`:**

1. `const target = await this.embed(text)`.
2. Iterate `indexes[table]`. For each entry, compute cosine sim with `target`.
3. If `sinceMs` set, JOIN with the table's timestamp column to skip rows outside the window. (We hold timestamps in a parallel `Map<id, number>` populated alongside embeddings — avoids a per-call SELECT.)
4. Sort by similarity DESC, return top `k` as `SimilarRow[]`.

### Oracle dedup integration

Constants in `oracle.ts`:

```ts
const ORACLE_DEDUP_THRESHOLD = 0.85;
const ORACLE_DEDUP_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
```

`recommendAll()` now needs the embedding service in deps:

```ts
export interface OracleDeps {
  // ...existing fields...
  embeddings: EmbeddingService;
}
```

Per-rec flow in `recommendAll()`:

1. Compute `Float32Array` for `${rec.title}\n${rec.rationale}`.
2. Call `embeddings.findSimilar({ table: "oracle_recommendations", text, k: 3, sinceMs: ORACLE_DEDUP_WINDOW_MS })`.
3. If top hit has `similarity >= ORACLE_DEDUP_THRESHOLD`, mark this rec as a duplicate of `existingId`.

Per-cycle flow in `runCycle()`:

1. Generate recs (above).
2. For duplicates: call `store.mergeInto(existingId, newRec)` — update `last_seen_at = Date.now()`, union the `evidence` set (parsed-then-re-stringified), DO NOT touch `first_seen_at`.
3. For fresh recs: insert via existing `store.upsertAll()` path, then `embeddings.embedAndStore("oracle_recommendations", id, text)`.

Net effect: a re-worded version of an existing action no longer counts as new. `diffNewForAssignee()` continues to drive DM gating off `oracle_dms_sent` — semantic merges don't re-DM.

### Schema migration

`openSentinelDb` today runs `db.exec(SCHEMA_SQL)` which is pure `CREATE TABLE IF NOT EXISTS`. That pattern doesn't add columns to existing tables, so for each of the three target tables we run an `ALTER TABLE <table> ADD COLUMN embedding BLOB` after the SCHEMA_SQL exec, each wrapped in a `try/catch` that swallows SQLite's `SQLITE_ERROR: duplicate column name: embedding`. First run adds the column; subsequent runs are no-ops. New installs already have the column via the eventual SCHEMA_SQL update.

Future SCHEMA_SQL refresh (separate task): add `embedding BLOB` to the three `CREATE TABLE IF NOT EXISTS` blocks so fresh installs don't need the ALTERs. Both patterns coexist safely.

### Backfill script

`scripts/embed-backfill.ts`:

```ts
// Usage: node scripts/embed-backfill.ts [--dry-run]
// Embeds every row with embedding IS NULL across the three tables.
```

Per table:

1. `SELECT id, <text-col> FROM <table> WHERE embedding IS NULL ORDER BY id ASC LIMIT 100`.
2. For each row: call adapter, UPDATE blob.
3. Continue until no rows match. Print row count per table at the end.

Text column per table:

- `observations.summary`
- `insights.summary`
- `oracle_recommendations` — embed `${title}\n${rationale}` (composed at query time, no schema change).

Failure of a single row → log + skip (it'll get retried on the next run). Failure of the adapter (auth error, network down) → exit with non-zero and surface the error.

## Per-cycle behavior changes

`createSentinel` constructs the embedding service synchronously alongside the existing DB-bound dependencies (the service hydrates its indexes from a single SELECT per table — no async I/O needed). It's then handed to the lazy `getOracle()` builder so the oracle can call `findSimilar` and `embedAndStore` per recommendation. No new per-cycle calls beyond what each consumer makes — oracle adds ~5 embedding calls per cycle (one per recommendation; cheap).

## Cost / latency

- Embedding inference: ~$0.025/1M input tokens. Per oracle rec: ~100 tokens → $0.0000025. Per cycle: trivial.
- Backfill one-time: 1,488 + 257 + 6 ≈ 1,751 rows × ~500 tokens avg = ~876k tokens ≈ $0.022.
- Memory: 1,751 rows × 3 KB = ~5.3 MB at current size; ~300 MB at 100k rows (still fine).
- `findSimilar` latency: ~2 μs per cosine sim × 1,488 obs = ~3 ms cold. Acceptable.

## Error handling

- Adapter failure during cycle: row inserts without embedding; warning logged; nightly retry. Oracle falls back to byte-hash dedup for that one rec.
- Migration failure: boot aborts. Same as existing migrations.
- Backfill interruption (SIGINT, crash): safe to resume — pre-existing blobs are skipped.
- Mismatched dim (model upgrade later): blob-codec validates length on decode; logs+skip mismatched rows so a stale model rollout doesn't poison the index.

## Testing

- **`cosine.test.ts`**: known vectors (unit basis, orthogonal pairs, identity).
- **`blob-codec.test.ts`**: round-trip a `Float32Array(768)`, byte length === 3072, decode validates length.
- **`service.test.ts`**: fake adapter returning deterministic vectors. Covers boot-time index hydration, `embedAndStore` idempotency, `findSimilar` ranking + threshold + `sinceMs` cutoff + null-embedding rows excluded.
- **`oracle.test.ts` updates**: a rewording of a stored rec routes to merge (existing row's `last_seen_at` advances, `first_seen_at` unchanged, evidence is unioned). A genuinely different rec routes to insert. Threshold-edge test (just under threshold = insert; at threshold = merge).
- **Live integration test** (env-gated): hits real Gemini once with two known-similar texts and asserts cosine ≥ 0.7. Skipped in CI.

## Out of scope for v1

- sqlite-vec / hnswlib (revisit at 50k+ rows).
- Hybrid keyword + vector retrieval.
- Embedding `conversations`, `followups`, `people_profiles` (add as adopters appear).
- Inquirer / chat-v2 RAG (helper is ready; integrations are follow-up tickets).
- Re-embedding on edits — we don't currently edit row text, but if that changes the affected row gets nulled-and-re-embedded by the nightly retry.
- Cross-encoder re-ranking.
- Embedding model upgrade flow (manual: null all embeddings, re-run backfill).

## Acceptance criteria

1. Schema migration runs idempotently; existing rows unaffected.
2. `scripts/embed-backfill.ts` populates all three tables; re-running is a no-op.
3. Oracle cycle: a re-worded version of an existing rec maps to the existing row instead of creating a new one (manually verifiable via `sqlite3 sentinel.db "SELECT id, title, first_seen_at, last_seen_at FROM oracle_recommendations"` showing stable IDs across cycles).
4. `findSimilar` returns ranked results matching obvious test queries against backfilled observations.
5. Adapter failure during a cycle does not block the rest of the cycle.
6. All existing tests stay green; new tests pass.

## Security notes (IT-SEC-001)

- No new credentials. Gemini embedding uses the same `GOOGLE_APPLICATION_CREDENTIALS` already in `~/.openclaw/.env`.
- Embedding endpoint is the same Vertex AI / Generative Language API host already authorized for the LLM client. No new API enablement required.
- No new outbound destinations.

## Open questions

None at design time. Threshold (`0.85`) and window (`14d`) are tuneable constants; revisit after one week of live cycles.
