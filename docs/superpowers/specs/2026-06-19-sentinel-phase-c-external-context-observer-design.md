# Sentinel Phase C — External-Context Observer Design

**Date:** 2026-06-19
**Status:** Approved
**Builds on:** `docs/superpowers/specs/2026-06-08-sentinel-jr-design.md` (Phase C item: `observers/external-context`) and the observer-port pattern established by `coperniq` (2026-06-12) and `gcp-functions` (2026-06-17).

## Problem & scope

The Sentinel cycle observes Vero's internal state (Slack channels, Coperniq Firestore, Cloud Function logs, JR's own DB) and stable solar-industry background knowledge from the LLM's training data (`industry-context` observer, every observation tagged _"BACKGROUND CONTEXT (not real-time)"_). It has **no view of real-time external developments** — policy changes, supplier news, weather/grid events, competitor moves — that affect Vero's business decisions over a 24-72h horizon.

This spec adds an `external-context` observer that runs an agentic research loop each Sentinel cycle, using Gemini's built-in `google_search` tool, with a token + turn + depth budget that keeps cost bounded.

`industry-context` continues to ship as-is. Both observers will run in parallel — one for stable background, one for fresh signal.

## Decisions made during brainstorming

- **Source: Gemini with Google Search grounding.** Multi-turn tool use. Real-time results, broad coverage, no feed maintenance. Auth piggybacks on existing `GEMINI_API_KEY`.
- **The observer can dive deeper.** When the LLM finds something material, it can fire follow-up searches on that topic instead of stopping at a single shallow pass.
- **Budget: token cap + max turns + max same-topic dives.** Hard caps: 6 tool-use turns, 30k tokens consumed, 3 dive levels per topic. LLM gets the budget in the system prompt and can self-stop early.
- **Output: 3-5 flat observations + dive trace in data.** Same row shape as other observers so the synthesizer/curator/reporter consume them generically. The full research trace lives in `observation.data` for audit but isn't fed back into the synthesizer prompt.
- **SDK seam: direct `@google/genai` client.** Bypass the existing single-shot `LlmClient.complete()` interface. Multi-turn tool use needs native function-call iteration, which `complete()` doesn't expose.

## Data source facts

- Auth: `GEMINI_API_KEY` env var (already in `~/.openclaw/.env`).
- New dep: `@google/genai` (current stable line: `^1.x`).
- Gemini model: `gemini-2.5-flash` (fast + cheap + supports `google_search` tool).
- Tool config: `{ tools: [{ google_search: {} }] }` — Gemini handles the search execution natively, returning grounding metadata (URLs, snippets) attached to model responses.
- No new IAM grants. The Gemini API key authenticates directly to the Generative Language API.

## Component

**File:** `src/sentinel/observers/external-context.ts` — `createExternalContextObserver(deps): Observer`, `name: "external-context"`. Registered in `src/sentinel/index.ts` alongside the other observers. No new feature flag — the master `OPENCLAW_SENTINEL_ENABLED` gate covers it.

**Deps (DI for tests):**

```ts
export interface ExternalContextObserverDeps {
  db?: DatabaseType;
  getResearcher?: () => Promise<Researcher>;
  researcherFactory?: () => Promise<Researcher> | Researcher;
}
```

`db` is optional in this observer's signature (the observer does not write to it directly and does not read prior observations for deltas; the runner handles the row insert). The other two are the same test-seam pattern as coperniq/gcp-functions: `getResearcher` for per-call override (tests), `researcherFactory` for lazy-cached real client.

## Narrow port — `Researcher`

```ts
export interface ExternalFinding {
  summary: string; // concise headline (≤ 200 chars)
  relevance_note: string; // why this matters to Vero (≤ 400 chars)
  cited_urls: string[]; // grounding-citation URLs (deduped)
  confidence: "low" | "medium" | "high";
  published_at: string | null; // approximate ISO date of underlying signal if known
}

export interface ResearchTraceEntry {
  turn: number; // 1-indexed
  action: "search" | "dive" | "finalize";
  query?: string; // for "search" / "dive"
  summary_of_findings?: string; // ≤ 300 chars
}

export interface ResearchResult {
  findings: ExternalFinding[]; // 0..5
  trace: ResearchTraceEntry[];
}

export interface ResearchBudget {
  maxTurns: number;
  maxTokens: number;
  maxDivesPerTopic: number;
}

export interface Researcher {
  research(opts: { systemPrompt: string; budget: ResearchBudget }): Promise<ResearchResult>;
}
```

The observer body is small: build prompt → call `researcher.research(...)` → map findings to observations. The Gemini-specific tool-call loop lives in `defaultResearcherFactory` (an adapter), which is exercised only by manual smoke (no live Gemini in tests).

## Per-cycle behavior

`observe(_since)` (`since` is unused — this observer always queries the most-recent-public-info, no watermark):

1. Build the **system prompt**: see § System prompt content below.
2. Build the **budget**: `{ maxTurns: 6, maxTokens: 30000, maxDivesPerTopic: 3 }`.
3. Call `researcher.research({ systemPrompt, budget })`. Inside the adapter:
   - Initialize Gemini 2.5 Flash with `tools: [{ google_search: {} }]`.
   - Run multi-turn loop:
     - Send conversation history (system + user-turn messages + prior assistant/tool responses).
     - Parse model reply. If it includes a tool call (`google_search`), execute it (Gemini grounding runs the search and returns metadata + snippets) and append the tool result to history.
     - If model returns a final answer (no tool call), parse it as JSON of shape `{ findings: ExternalFinding[] }`.
     - Increment turn counter and token counter on each round-trip.
     - If `turn > budget.maxTurns` OR `tokens > budget.maxTokens` → break loop and use whatever findings are best-effort-parseable from the last assistant message (or empty if none).
     - Track topic labels: the LLM is asked to tag each search with a topic in its reasoning; same-topic dives count toward `maxDivesPerTopic`. Enforcement is soft (system prompt asks it not to exceed) — we don't reject calls.
4. If `findings.length === 0` → return `[]`. Runner advances watermark; no row written. Graceful empty cycle.
5. Else map each finding to an Observation:

   ```ts
   {
     source: "external-context",
     topic: "external:solar",
     timestamp: Date.now(),
     summary: finding.summary,
     data: {
       relevance_note: finding.relevance_note,
       cited_urls: finding.cited_urls,
       confidence: finding.confidence,
       published_at: finding.published_at,
       trace: researchResult.trace,
     },
     // no metrics for this observer
   }
   ```

## System prompt content

```
You are a solar industry analyst monitoring real-time developments that
affect Vero — a US residential solar installer operating in Colorado,
Texas, and Arizona.

What matters to Vero:
- Federal/state solar policy: ITC, NEM, state incentives, permitting changes
- Supply chain: panel/inverter/battery vendor news, tariffs, lead-time shifts
- Weather/grid: extreme-weather forecasts, grid outages, peak-demand events
- Competition: large-installer news, M&A, pricing moves
- Customer signals: financing, interest rates, electricity price trends

Use the google_search tool to find developments from the last 24-72 hours.
When you find something material, dive deeper (search again with a more
specific query). Stop early when you've covered the key signals.

Budget: max 6 tool-use turns, max 30k tokens total, max 3 dives per topic.
Track turns silently; you'll be cut off at the cap.

When done, return a JSON object only (no markdown fences):
{
  "findings": [
    {
      "summary": "<headline, ≤ 200 chars>",
      "relevance_note": "<why this matters to Vero, ≤ 400 chars>",
      "cited_urls": ["<url>", ...],
      "confidence": "low" | "medium" | "high",
      "published_at": "<ISO date or null>"
    },
    ... (3-5 entries; emit 0 if nothing meaningful was found)
  ]
}
```

## Error handling

- Any Gemini API error → throw → `runObservers` catches per-observer, records the error, does not advance watermark, next cycle retries.
- Budget exhausted with zero findings → return `[]`. Empty cycles are valid.
- Malformed final JSON → throw (defect signal; we want to know).
- Observer wall-clock timeout: 90s. Implemented via `Promise.race` against a timer. Timeout → throw with `"external-context observer timed out after 90s"`.

## Security notes (IT-SEC-001)

- `GEMINI_API_KEY` already lives in `~/.openclaw/.env` (no key file on disk; environment-loaded).
- Google Search via Gemini grounding does not leak any Vero-private data — the LLM constructs queries from the system prompt and its own reasoning. We do not pass Vero-specific identifiers (customer names, project IDs, etc.) into search queries.
- All grounding citation URLs land in `observation.data.cited_urls` (public web URLs). No PII risk.
- The full research trace lives in `observation.data.trace`. `sentinel.db` is local-only on the Mac mini.

## Testing

- **Unit** (`tests/sentinel/observers/external-context.test.ts`): fake `Researcher` injected via DI. Cover:
  - Findings → observations mapping (3-5 findings → 3-5 rows, all with the right shape).
  - Zero findings → `[]` (graceful empty cycle, no row).
  - Each observation carries `source: "external-context"`, `topic: "external:solar"`, full `data` block including `trace`.
  - `cited_urls` propagated unchanged.
  - The observer wires `systemPrompt` and `budget` into `researcher.research(...)` correctly.
  - `researcherFactory` is called once and cached across two `observe(0)` calls.
  - Observer throws when `researcher.research` throws.
- **No live Gemini in tests.** The default `@google/genai`-backed adapter is exercised only by manual smoke.
- **Manual smoke (rollout):** one observation cycle on the Mac mini. Verify:
  - 3-5 `external-context` rows landed in `sentinel.db` with sensible summaries.
  - `data.cited_urls` contains real web URLs.
  - `data.trace` shows ≤ 6 turns and zero same-topic dives beyond 3.

## Out of scope

- Cross-cycle deduplication (synthesizer handles; if a story persists for days the observer may re-surface it — that's signal, not noise).
- User-configurable topic list (curated in the system prompt for v1).
- Source-quality scoring beyond Gemini's grounding (LLM rates `confidence`, that's enough).
- gmail-watcher integration (Phase B3, deferred pending CEO sign-off).
- Replacing `industry-context` (parallel, not replacement).
- Extending `LlmClient` to expose tool use (scope creep; direct SDK in observer is enough).
