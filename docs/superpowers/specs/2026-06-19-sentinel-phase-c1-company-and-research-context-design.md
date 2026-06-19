# Sentinel Phase C.1 — Company + Research Context for external-context observer

**Date:** 2026-06-19
**Status:** Approved
**Builds on:** `docs/superpowers/specs/2026-06-19-sentinel-phase-c-external-context-observer-design.md` (Phase C ships the basic Gemini researcher; C.1 grounds it in real company data and search history).

## Problem & scope

The Phase C observer just shipped with **hardcoded geography in the system prompt** (`"Vero — a US residential solar installer operating in Colorado, Texas, and Arizona"`). The first live smoke proved this was wrong: actual Firestore data shows Vero is essentially Texas-only (222 of 224 projects). Three of eight Gemini search queries were wasted on Colorado and Arizona — geographies Vero doesn't serve — and Texas-specific signal got under-weighted.

Beyond the geography fix, the observer has no memory of its prior research. Each cycle starts from scratch and may re-surface the same broad topics (ITC expiration, federal policy) every two hours instead of diving deeper into specific developments.

**This spec adds two pre-search context-building steps to the observer:**

1. **Company snapshot** — read `coperniq_projects` + `coperniq_work_orders` from Firestore each cycle and produce a 1-2 paragraph plain-text blob describing Vero's actual current state (geography, pipeline value, status mix, recent activity).
2. **Recent-research summary** — read the last 7 days of `external-context` observations from `sentinel.db` and produce a bulleted list of finding summaries + confidence labels so the model knows where it's already been.

Both feed into the system prompt at runtime. The hardcoded state list goes away; geography emerges from the company snapshot.

## Decisions made during brainstorming

- **Drop hardcoded geography.** Replace with company-snapshot-derived signal.
- **Firestore is the source of truth for company state.** Same JSON key + same project as the Coperniq observer; no new auth.
- **Past-search awareness lets the model dive instead of repeat.** Pull from `sentinel.db` `observations` where `source='external-context'`.
- **Per-cycle refresh.** Both context blobs rebuild every cycle (cheap; data drifts).
- **Module split for testability.** Each builder gets its own file with unit tests using injected fakes.

## Component architecture

### File structure

| File                                                                | Responsibility                                                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/sentinel/observers/external-context.ts`                        | Main observer. Now builds context before calling researcher. Extended deps.                                  |
| `src/sentinel/observers/external-context/company-context.ts`        | NEW. `buildCompanyContext(client): Promise<string>`. Reads Firestore aggregates, formats as plain-text blob. |
| `src/sentinel/observers/external-context/recent-research.ts`        | NEW. `buildRecentResearchContext(db, windowMs): string`. Reads sentinel.db, formats as bulleted list.        |
| `tests/sentinel/observers/external-context/company-context.test.ts` | NEW. Unit tests with fake Firestore client.                                                                  |
| `tests/sentinel/observers/external-context/recent-research.test.ts` | NEW. Unit tests with in-memory sentinel.db seeded with prior observations.                                   |
| `tests/sentinel/observers/external-context.test.ts`                 | Updated. New tests for the wiring (observer calls both builders, splices their output into the prompt).      |

### Module `company-context.ts`

**Port (test seam):**

```ts
export interface CompanyContextFirestoreLike {
  // Returns aggregate counts for projects, keyed by the field name we
  // group by. Implementations can either iterate docs and aggregate
  // in-memory (default) or use Firestore aggregation queries.
  countProjectsByField(field: "state" | "status" | "workflowName"): Promise<Record<string, number>>;
  sumProjectValue(filter: { status?: string }): Promise<number>;
  countWorkOrdersByStatus(): Promise<Record<string, number>>;
}

export interface CompanyContextDeps {
  client: CompanyContextFirestoreLike;
}

export async function buildCompanyContext(deps: CompanyContextDeps): Promise<string>;
```

**Default factory:** `createDefaultCompanyContextClient()` builds a `CompanyContextFirestoreLike` from `@google-cloud/firestore` — already in deps from Phase B. Reuses the same SDK + same JSON key path as the coperniq observer.

**Output format (example):**

```
COMPANY SNAPSHOT (live data from Firestore):
Vero is a residential solar installer with 224 projects in Coperniq.
Geography: Texas (222 projects, 99.1%); Utah (2 projects).
Active pipeline: 155 projects, $8.7M total value.
Status mix: 155 ACTIVE, 51 CANCELLED, 16 ON_HOLD, 2 COMPLETED.
Sole workflow: "Vero - Texas Workflow".
Active work orders: 2313 completed lifetime, 283 currently assigned, 266 waiting, 18 in review.
```

**Aggregation strategy:** Use Firestore's native `.aggregate()` for counts where possible; fall back to `.select().get()` + in-memory tally if aggregation queries aren't available for `state`/`workflowName` group-bys (they require composite indexes). For pipeline value, iterate the small set of ACTIVE projects (~155 docs) — trivial.

**Empty / error states:**

- Firestore unreachable → throw. Observer's runner catches, watermark doesn't advance, next cycle retries.
- Zero projects → emit a minimal blob: `"COMPANY SNAPSHOT: No project data available."` Don't throw.

### Module `recent-research.ts`

**Function signature:**

```ts
export function buildRecentResearchContext(
  db: DatabaseType,
  windowMs: number,
  options?: { maxEntries?: number },
): string;
```

**Logic:**

```sql
SELECT summary,
       json_extract(data, '$.confidence') AS confidence,
       json_extract(data, '$.published_at') AS published_at,
       timestamp
FROM observations
WHERE source = 'external-context'
  AND timestamp > ?
ORDER BY timestamp DESC
LIMIT ?
```

Default `maxEntries` = 20. Default `windowMs` = 7 days.

**Output format (example):**

```
RECENT RESEARCH (last 7 days — what JR has already covered):
- "Federal ITC expiration → 2026 market contraction" (confidence: high, published: 2026-06-19)
- "Texas grid reliability after ERCOT summer 2025 events" (confidence: medium, published: 2026-06-17)
- "Tesla Powerwall pricing update Q2 2026" (confidence: high, published: 2026-06-15)
- ... (capped at 20 entries)
```

**Empty state:** If zero rows match (first run / fresh DB / new install), emit `"RECENT RESEARCH: No prior research in the last 7 days."` Don't throw.

### Updated observer wiring

`ExternalContextObserverDeps` extended:

```ts
export interface ExternalContextObserverDeps {
  db: DatabaseType; // CHANGED: now required (was optional)
  getResearcher?: () => Promise<Researcher>;
  researcherFactory?: () => Promise<Researcher> | Researcher;
  timeoutMs?: number;
  // New context builders. Defaults wire to Firestore + sentinel.db.
  companyContextFn?: () => Promise<string>;
  recentResearchFn?: () => string;
}
```

The two new optional functions are the test seams. Production defaults instantiate the real builders against the live Firestore + the runner-provided `db`.

`observe()` flow:

1. Build company context (`await deps.companyContextFn?.()` or default).
2. Build recent-research context (`deps.recentResearchFn?.()` or default).
3. Splice both into the system prompt template.
4. Call `researcher.research({ systemPrompt, budget })` as before.
5. Map findings to observations.

### Updated system prompt template

```
You are a solar industry analyst working for Vero.

{company_context_blob}

{recent_research_blob}

Use google_search to find developments affecting Vero NOW. Prioritize
signal relevant to the company's actual operating geography from the
snapshot above (Texas is the primary focus today; expand if the snapshot
shows other states). Don't re-search topics in the recent-research list
unless there is a material update. Federal/national signal is fine when
broadly relevant.

What categories matter:
- Federal/state solar policy: ITC, NEM, state incentives, permitting
- Supply chain: panel/inverter/battery vendor news, tariffs, lead times
- Weather/grid: extreme-weather forecasts, ERCOT events, grid outages
- Competition: large-installer news, M&A, pricing
- Customer signals: financing rates, electricity prices

Budget: max 6 tool-use turns, max 30k tokens total, max 3 dives per topic.

When done, return a JSON object only (no markdown fences):
{
  "findings": [
    { "summary": "...", "relevance_note": "...", "cited_urls": [...], "confidence": "low" | "medium" | "high", "published_at": "ISO or null" }
  ]
}
```

The geography clause is **derived from the snapshot at prompt-construction time**, not hardcoded. The example above is what today's data produces; tomorrow's snapshot drives a different prompt.

## Per-cycle behavior

`observe(_since)`:

1. Resolve researcher (lazy-cached, unchanged).
2. Resolve company-context builder + recent-research builder. Default factories use the same Firestore JSON key and the runner-provided `db`.
3. Call both builders in parallel (`Promise.all`). Either throws → observer throws → runner catches.
4. Splice both outputs into the system prompt template (string interpolation).
5. Race the `researcher.research()` call against the 90s timeout (unchanged).
6. Map findings to observations (unchanged).

## Cost / latency

- Company-context Firestore reads: ~4 aggregate queries per cycle (~$0.001 in reads at current Firestore pricing).
- Recent-research SQLite read: free, local, <10ms.
- System prompt grows by ~500-1000 tokens (company context + research history). Gemini input pricing is ~$0.000075/1k input tokens for Flash 2.5; trivial.
- Overall per-cycle cost: still well under $0.05.

## Error handling

- Firestore failure during context build → throw, runner retries next cycle.
- sentinel.db read failure (highly unlikely; local SQLite) → log warning, return empty `"RECENT RESEARCH: ..."` blob, continue. Don't fail the whole observer over a local-DB hiccup.
- Both context builders run in `Promise.all` — first throw aborts both. Acceptable for v1.

## Testing

- **`company-context.test.ts`**: fake `CompanyContextFirestoreLike` with canned aggregate responses. Cover: typical data, single state, multi-state, zero-projects edge case, throw-on-firestore-failure.
- **`recent-research.test.ts`**: in-memory sentinel.db seeded with N prior observations. Cover: typical day, window cutoff (older entries excluded), `maxEntries` cap, zero entries, malformed data field defaults gracefully.
- **`external-context.test.ts` updates**: new tests that the observer:
  1. Calls `companyContextFn` and `recentResearchFn` on every `observe()`.
  2. Splices both outputs into the system prompt (asserted via fake `Researcher` capturing the prompt string).
  3. If the company-context fn throws, the observer throws (no degraded mode for this).
- All existing tests stay green. No live Firestore in tests.
- **Manual smoke (gated):** run a boot cycle; verify the new `external-context` rows mention Texas explicitly and don't search Colorado/Arizona.

## Out of scope

- Embedding-based dedup of recent research (just-string-match is enough for v1).
- Cross-observer context (company snapshot doesn't read coperniq's own observation history; it reads raw Firestore).
- Configurable research-history window via env var (default 7 days is fine; revisit if it doesn't fit usage).
- Schema changes to `observations` table.
- Updating other observers to use a "company snapshot" pattern (`coperniq`, `gcp-functions`, etc. don't need it; their data IS the company state).
