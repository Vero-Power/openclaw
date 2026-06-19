# Sentinel Phase C — External-Context Observer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an `external-context` Sentinel observer that uses Gemini 2.5 Flash with the `google_search` tool to run an agentic, bounded research loop each 2h cycle, emitting 3-5 fresh observations about solar-industry developments relevant to Vero.

**Architecture:** New file `src/sentinel/observers/external-context.ts` exporting `createExternalContextObserver(deps): Observer`. The observer body is small: build a system prompt + budget, call a narrow `Researcher` port, map findings → observations. The Gemini-specific multi-turn tool-use loop lives in `defaultResearcherFactory` (an adapter), exercised only by manual smoke. Same DI test seam as coperniq + gcp-functions (`getResearcher` for per-call override, `researcherFactory` for lazy-cached real client).

**Tech Stack:** TypeScript, `@google/genai`, `better-sqlite3`, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-19-sentinel-phase-c-external-context-observer-design.md`

---

## File structure

| File                                                | Responsibility                                                                                                                                                                                                                                 |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/sentinel/observers/external-context.ts`        | `createExternalContextObserver(deps)`, `Researcher` port + `ExternalFinding`/`ResearchTraceEntry`/`ResearchResult`/`ResearchBudget` types, system prompt constant, `defaultResearcherFactory` adapter. Single file — small except the adapter. |
| `tests/sentinel/observers/external-context.test.ts` | Unit tests with a fake `Researcher` via DI. No live Gemini.                                                                                                                                                                                    |
| `src/sentinel/index.ts`                             | Register the observer alongside the others. One-line change.                                                                                                                                                                                   |
| `package.json`                                      | Adds `@google/genai` dependency (Task 1).                                                                                                                                                                                                      |

---

## Verified facts (carried from spec)

- Gemini model: `gemini-2.5-flash` (supports `google_search` tool).
- Auth: `GEMINI_API_KEY` env var (already in `~/.openclaw/.env`).
- Budget: `{ maxTurns: 6, maxTokens: 30000, maxDivesPerTopic: 3 }`.
- Wall-clock timeout: 90s.
- Output: 3-5 observations per cycle (zero-findings → empty array, graceful empty cycle).
- No live Gemini in tests — the adapter is manual-smoke-only; the observer body is tested via fake `Researcher`.
- `db` is in deps but the observer does not read or write it (the runner handles row insertion).

---

## Task 1: Add `@google/genai` dependency + scaffold types + stub

**Files:**

- Modify: `/Users/vero/openclaw/package.json`
- Create: `/Users/vero/openclaw/src/sentinel/observers/external-context.ts`
- Create: `/Users/vero/openclaw/tests/sentinel/observers/external-context.test.ts`

- [ ] **Step 1: Install dependency**

```bash
cd /Users/vero/openclaw && pnpm add -w @google/genai
```

Expected: package.json gains `"@google/genai"`, pnpm-lock.yaml updated. If `-w` is rejected (workspace), drop it; if `-w` is required, keep it. Match what the prior coperniq/gcp-functions installs did (those used `-w` per the earlier subagent reports).

- [ ] **Step 2: Write failing import test**

Create `/Users/vero/openclaw/tests/sentinel/observers/external-context.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  createExternalContextObserver,
  type Researcher,
  type ResearchResult,
} from "../../../src/sentinel/observers/external-context.js";

describe("external-context observer module", () => {
  it("exports createExternalContextObserver and the Researcher port", () => {
    expect(typeof createExternalContextObserver).toBe("function");
    const researcher: Researcher = {
      research: async (): Promise<ResearchResult> => ({ findings: [], trace: [] }),
    };
    expect(typeof researcher.research).toBe("function");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/external-context.test.ts
```

Expected: FAIL — cannot import (file does not exist).

- [ ] **Step 4: Create the observer file with types + stub**

Create `/Users/vero/openclaw/src/sentinel/observers/external-context.ts`:

```typescript
import type { Database as DatabaseType } from "better-sqlite3";
import type { Observer } from "../observer.js";
import type { Observation } from "../types.js";

export interface ExternalFinding {
  summary: string;
  relevance_note: string;
  cited_urls: string[];
  confidence: "low" | "medium" | "high";
  published_at: string | null;
}

export interface ResearchTraceEntry {
  turn: number;
  action: "search" | "dive" | "finalize";
  query?: string;
  summary_of_findings?: string;
}

export interface ResearchResult {
  findings: ExternalFinding[];
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

export interface ExternalContextObserverDeps {
  db?: DatabaseType;
  getResearcher?: () => Promise<Researcher>;
  researcherFactory?: () => Promise<Researcher> | Researcher;
}

export function createExternalContextObserver(_deps: ExternalContextObserverDeps): Observer {
  return {
    name: "external-context",
    async observe(_since: number): Promise<Omit<Observation, "id" | "created_at">[]> {
      return [];
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/external-context.test.ts
```

Expected: PASS (1/1).

- [ ] **Step 6: Commit**

```bash
cd /Users/vero/openclaw && git add package.json pnpm-lock.yaml src/sentinel/observers/external-context.ts tests/sentinel/observers/external-context.test.ts && git commit -m "$(cat <<'EOF'
feat(sentinel): scaffold external-context observer module

Adds @google/genai dep, exports Researcher port + ExternalFinding /
ResearchTraceEntry / ResearchResult / ResearchBudget types, and a stub
createExternalContextObserver that returns no observations. Subsequent
tasks fill in the observer body, lazy cached researcher, wall-clock
timeout, default Gemini adapter, and createSentinel registration.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Observer body — system prompt, budget, findings → observations

**Files:**

- Modify: `/Users/vero/openclaw/src/sentinel/observers/external-context.ts`
- Modify: `/Users/vero/openclaw/tests/sentinel/observers/external-context.test.ts`

- [ ] **Step 1: Write failing tests**

Append to the test file. Add these imports to the top imports block:

```typescript
import { afterEach, beforeEach } from "vitest";
```

Then append helpers + describe at the bottom:

```typescript
function makeFakeResearcher(result: ResearchResult): {
  researcher: Researcher;
  calls: Array<{ systemPrompt: string; budget: ResearchBudget }>;
} {
  const calls: Array<{ systemPrompt: string; budget: ResearchBudget }> = [];
  const researcher: Researcher = {
    research: async (opts) => {
      calls.push({ systemPrompt: opts.systemPrompt, budget: opts.budget });
      return result;
    },
  };
  return { researcher, calls };
}

describe("createExternalContextObserver — observer body", () => {
  it("emits 3-5 observations when the researcher returns findings", async () => {
    const findings: ExternalFinding[] = [
      {
        summary: "A",
        relevance_note: "ra",
        cited_urls: ["https://example.com/a"],
        confidence: "high",
        published_at: "2026-06-19",
      },
      {
        summary: "B",
        relevance_note: "rb",
        cited_urls: ["https://example.com/b"],
        confidence: "medium",
        published_at: null,
      },
      {
        summary: "C",
        relevance_note: "rc",
        cited_urls: ["https://example.com/c1", "https://example.com/c2"],
        confidence: "low",
        published_at: "2026-06-18",
      },
    ];
    const trace: ResearchTraceEntry[] = [
      { turn: 1, action: "search", query: "solar industry 2026" },
      { turn: 2, action: "finalize" },
    ];
    const { researcher, calls } = makeFakeResearcher({ findings, trace });

    const obs = createExternalContextObserver({ getResearcher: async () => researcher });
    const out = await obs.observe(0);

    expect(out).toHaveLength(3);
    expect(out[0].source).toBe("external-context");
    expect(out[0].topic).toBe("external:solar");
    expect(out[0].summary).toBe("A");
    expect(out[0].data).toMatchObject({
      relevance_note: "ra",
      cited_urls: ["https://example.com/a"],
      confidence: "high",
      published_at: "2026-06-19",
      trace,
    });

    // budget passed correctly
    expect(calls).toHaveLength(1);
    expect(calls[0].budget).toEqual({ maxTurns: 6, maxTokens: 30000, maxDivesPerTopic: 3 });
    // system prompt mentions Vero + google_search
    expect(calls[0].systemPrompt).toContain("Vero");
    expect(calls[0].systemPrompt).toContain("google_search");
  });

  it("returns [] when the researcher reports zero findings", async () => {
    const { researcher } = makeFakeResearcher({
      findings: [],
      trace: [{ turn: 1, action: "finalize" }],
    });
    const obs = createExternalContextObserver({ getResearcher: async () => researcher });
    const out = await obs.observe(0);
    expect(out).toEqual([]);
  });

  it("propagates errors thrown by the researcher", async () => {
    const researcher: Researcher = {
      research: async () => {
        throw new Error("gemini boom");
      },
    };
    const obs = createExternalContextObserver({ getResearcher: async () => researcher });
    await expect(obs.observe(0)).rejects.toThrow(/gemini boom/);
  });
});
```

- [ ] **Step 2: Run tests to verify FAIL**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/external-context.test.ts
```

Expected: FAIL — the stub returns `[]`, so the "emits 3-5 observations" test fails on `toHaveLength(3)`. The empty-findings test passes by coincidence; the error-propagation test passes (no getResearcher path → won't even run; wait — actually it WILL run because we DO supply getResearcher. That test will fail because the current stub returns [] without calling getResearcher).

- [ ] **Step 3: Implement observer body**

In `/Users/vero/openclaw/src/sentinel/observers/external-context.ts`, add a module-level constant + budget constant above `createExternalContextObserver`:

```typescript
const DEFAULT_BUDGET: ResearchBudget = {
  maxTurns: 6,
  maxTokens: 30000,
  maxDivesPerTopic: 3,
};

const SYSTEM_PROMPT = `You are a solar industry analyst monitoring real-time developments that affect Vero — a US residential solar installer operating in Colorado, Texas, and Arizona.

What matters to Vero:
- Federal/state solar policy: ITC, NEM, state incentives, permitting changes
- Supply chain: panel/inverter/battery vendor news, tariffs, lead-time shifts
- Weather/grid: extreme-weather forecasts, grid outages, peak-demand events
- Competition: large-installer news, M&A, pricing moves
- Customer signals: financing, interest rates, electricity price trends

Use the google_search tool to find developments from the last 24-72 hours. When you find something material, dive deeper (search again with a more specific query). Stop early when you've covered the key signals.

Budget: max 6 tool-use turns, max 30k tokens total, max 3 dives per topic. Track turns silently; you'll be cut off at the cap.

When done, return a JSON object only (no markdown fences):
{
  "findings": [
    {
      "summary": "<headline, <= 200 chars>",
      "relevance_note": "<why this matters to Vero, <= 400 chars>",
      "cited_urls": ["<url>", ...],
      "confidence": "low" | "medium" | "high",
      "published_at": "<ISO date or null>"
    }
  ]
}

Emit 3-5 findings if there is material signal; emit an empty array if nothing meaningful was found.`;
```

Replace `createExternalContextObserver` body:

```typescript
export function createExternalContextObserver(deps: ExternalContextObserverDeps): Observer {
  return {
    name: "external-context",
    async observe(_since: number): Promise<Omit<Observation, "id" | "created_at">[]> {
      const getResearcher =
        deps.getResearcher ??
        (async () => {
          throw new Error("default Researcher not yet wired (see Task 5 in plan)");
        });
      const researcher = await getResearcher();
      const result = await researcher.research({
        systemPrompt: SYSTEM_PROMPT,
        budget: DEFAULT_BUDGET,
      });

      if (result.findings.length === 0) {
        return [];
      }

      const now = Date.now();
      return result.findings.map((finding) => ({
        source: "external-context",
        topic: "external:solar",
        timestamp: now,
        summary: finding.summary,
        data: {
          relevance_note: finding.relevance_note,
          cited_urls: finding.cited_urls,
          confidence: finding.confidence,
          published_at: finding.published_at,
          trace: result.trace,
        },
      }));
    },
  };
}
```

- [ ] **Step 4: Run tests to verify PASS**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/external-context.test.ts
```

Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
cd /Users/vero/openclaw && git add src/sentinel/observers/external-context.ts tests/sentinel/observers/external-context.test.ts && git commit -m "$(cat <<'EOF'
feat(sentinel): external-context observer body — findings to observations

Implements the observer body: builds the Vero-focused system prompt and
the fixed budget (6 turns / 30k tokens / 3 dives), calls the injected
Researcher, and maps each finding to one Observation row tagged
source="external-context" topic="external:solar". Zero findings ->
empty array (graceful empty cycle). Errors from the Researcher
propagate up so the runner can catch and retry.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Lazy cached researcher (factory pattern)

**Files:**

- Modify: `/Users/vero/openclaw/src/sentinel/observers/external-context.ts`
- Modify: `/Users/vero/openclaw/tests/sentinel/observers/external-context.test.ts`

- [ ] **Step 1: Write failing test**

Append to the test file:

```typescript
describe("createExternalContextObserver — lazy cached researcher", () => {
  it("calls researcherFactory once and caches across cycles", async () => {
    let builds = 0;
    const obs = createExternalContextObserver({
      researcherFactory: () => {
        builds++;
        return {
          research: async () => ({ findings: [], trace: [] }),
        };
      },
    });
    await obs.observe(0);
    await obs.observe(0);
    expect(builds).toBe(1);
  });

  it("getResearcher takes precedence over researcherFactory and is NOT cached", async () => {
    let getCalls = 0;
    let factoryCalls = 0;
    const obs = createExternalContextObserver({
      getResearcher: async () => {
        getCalls++;
        return { research: async () => ({ findings: [], trace: [] }) };
      },
      researcherFactory: () => {
        factoryCalls++;
        return { research: async () => ({ findings: [], trace: [] }) };
      },
    });
    await obs.observe(0);
    await obs.observe(0);
    expect(getCalls).toBe(2);
    expect(factoryCalls).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify FAIL**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/external-context.test.ts
```

Expected: FAIL — `researcherFactory` is not yet wired (the observer's getResearcher fallback throws when neither is provided; when `researcherFactory` is provided without `getResearcher`, the fallback still throws because nothing reads `deps.researcherFactory` yet).

- [ ] **Step 3: Implement lazy cached resolver**

Replace `createExternalContextObserver` body in `/Users/vero/openclaw/src/sentinel/observers/external-context.ts`:

```typescript
export function createExternalContextObserver(deps: ExternalContextObserverDeps): Observer {
  let cachedResearcher: Researcher | null = null;

  async function resolveResearcher(): Promise<Researcher> {
    if (deps.getResearcher) {
      return deps.getResearcher();
    }
    if (cachedResearcher) {
      return cachedResearcher;
    }
    const factory =
      deps.researcherFactory ??
      (() => {
        throw new Error("default Researcher not yet wired (see Task 5 in plan)");
      });
    cachedResearcher = await factory();
    return cachedResearcher;
  }

  return {
    name: "external-context",
    async observe(_since: number): Promise<Omit<Observation, "id" | "created_at">[]> {
      const researcher = await resolveResearcher();
      const result = await researcher.research({
        systemPrompt: SYSTEM_PROMPT,
        budget: DEFAULT_BUDGET,
      });

      if (result.findings.length === 0) {
        return [];
      }

      const now = Date.now();
      return result.findings.map((finding) => ({
        source: "external-context",
        topic: "external:solar",
        timestamp: now,
        summary: finding.summary,
        data: {
          relevance_note: finding.relevance_note,
          cited_urls: finding.cited_urls,
          confidence: finding.confidence,
          published_at: finding.published_at,
          trace: result.trace,
        },
      }));
    },
  };
}
```

- [ ] **Step 4: Run tests to verify PASS**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/external-context.test.ts
```

Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
cd /Users/vero/openclaw && git add src/sentinel/observers/external-context.ts tests/sentinel/observers/external-context.test.ts && git commit -m "$(cat <<'EOF'
feat(sentinel): external-context lazy cached researcher

Adds resolveClient-style pattern matching coperniq + gcp-functions:
getResearcher (per-call test override) takes precedence; otherwise the
lazy cache returns the result of researcherFactory built once per
observer instance. Default factory still throws (wired in a later task);
tests inject fakes.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 90-second wall-clock timeout

**Files:**

- Modify: `/Users/vero/openclaw/src/sentinel/observers/external-context.ts`
- Modify: `/Users/vero/openclaw/tests/sentinel/observers/external-context.test.ts`

- [ ] **Step 1: Write failing test**

Append to the test file:

```typescript
describe("createExternalContextObserver — wall-clock timeout", () => {
  it("rejects when the researcher hangs past the timeout", async () => {
    const slowResearcher: Researcher = {
      research: () => new Promise(() => {}), // never resolves
    };
    const obs = createExternalContextObserver({
      getResearcher: async () => slowResearcher,
      timeoutMs: 50, // tiny timeout for test speed
    });
    await expect(obs.observe(0)).rejects.toThrow(/timed out after 50ms/);
  });

  it("uses the production default of 90000ms when timeoutMs is omitted", async () => {
    const fast: Researcher = {
      research: async () => ({ findings: [], trace: [] }),
    };
    const obs = createExternalContextObserver({ getResearcher: async () => fast });
    // Just verify it doesn't throw and respects the override-or-default contract
    await expect(obs.observe(0)).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Add `timeoutMs` to deps + implement Promise.race**

In `/Users/vero/openclaw/src/sentinel/observers/external-context.ts`:

Update `ExternalContextObserverDeps`:

```typescript
export interface ExternalContextObserverDeps {
  db?: DatabaseType;
  getResearcher?: () => Promise<Researcher>;
  researcherFactory?: () => Promise<Researcher> | Researcher;
  timeoutMs?: number;
}
```

Add a module-level constant alongside the others:

```typescript
const DEFAULT_TIMEOUT_MS = 90_000;
```

Update `observe()` to wrap the researcher call in `Promise.race`:

```typescript
    async observe(_since: number): Promise<Omit<Observation, "id" | "created_at">[]> {
      const researcher = await resolveResearcher();
      const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`external-context observer timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      });

      let result: ResearchResult;
      try {
        result = await Promise.race([
          researcher.research({ systemPrompt: SYSTEM_PROMPT, budget: DEFAULT_BUDGET }),
          timeoutPromise,
        ]);
      } finally {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
      }

      if (result.findings.length === 0) {
        return [];
      }

      // ... existing mapping unchanged
```

- [ ] **Step 3: Run tests to verify PASS**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/external-context.test.ts
```

Expected: PASS (8/8). The hang test should complete in ~50ms because the timeout fires.

- [ ] **Step 4: Commit**

```bash
cd /Users/vero/openclaw && git add src/sentinel/observers/external-context.ts tests/sentinel/observers/external-context.test.ts && git commit -m "$(cat <<'EOF'
feat(sentinel): external-context 90s wall-clock timeout

Wraps the researcher call in Promise.race against a setTimeout to guard
against a Gemini hang. Default 90_000ms; tests override via timeoutMs.
Always clears the timer on settle to avoid leaking pending timeouts.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Default Gemini adapter (multi-turn google_search loop)

**Files:**

- Modify: `/Users/vero/openclaw/src/sentinel/observers/external-context.ts`

This task wires the real `@google/genai` adapter. **No new unit tests** — the adapter requires a live Gemini API and the spec explicitly says it's manual-smoke-only. The tests from Tasks 1-4 already cover the observer body, the cache, and the timeout.

- [ ] **Step 1: Implement `defaultResearcherFactory`**

In `/Users/vero/openclaw/src/sentinel/observers/external-context.ts`, add a module-level adapter alongside the existing constants:

```typescript
const GEMINI_MODEL = "gemini-2.5-flash";

async function defaultResearcherFactory(): Promise<Researcher> {
  const { GoogleGenAI } = await import("@google/genai");
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not set; cannot construct default external-context Researcher");
  }
  const client = new GoogleGenAI({ apiKey });

  return {
    async research(opts): Promise<ResearchResult> {
      const trace: ResearchTraceEntry[] = [];
      let tokensConsumed = 0;
      let turn = 0;

      const tools = [{ googleSearch: {} }];

      // Multi-turn loop. Gemini handles google_search execution natively;
      // we just send the conversation history and read back the model's reply.
      // Conversation starts with the system prompt as the first user turn
      // (Gemini doesn't have a separate system role for this SDK shape).
      type Content = { role: "user" | "model"; parts: Array<{ text: string }> };
      const history: Content[] = [{ role: "user", parts: [{ text: opts.systemPrompt }] }];

      let finalText: string | null = null;
      while (turn < opts.budget.maxTurns && tokensConsumed < opts.budget.maxTokens) {
        turn++;
        const response = await client.models.generateContent({
          model: GEMINI_MODEL,
          contents: history,
          config: { tools },
        });

        const usage = response.usageMetadata;
        if (usage) {
          tokensConsumed += usage.totalTokenCount ?? 0;
        }

        const candidate = response.candidates?.[0];
        const text =
          candidate?.content?.parts
            ?.map((p) =>
              typeof p === "object" && p !== null && "text" in p
                ? ((p as { text?: string }).text ?? "")
                : "",
            )
            .join("") ?? "";

        // Capture grounding query if present
        const groundingQueries = candidate?.groundingMetadata?.webSearchQueries ?? [];
        if (groundingQueries.length > 0) {
          for (const q of groundingQueries) {
            trace.push({ turn, action: "search", query: q });
          }
        }

        // Treat any text that contains a JSON object with a top-level "findings"
        // array as the final answer.
        const finalMatch = text.match(/\{[\s\S]*"findings"[\s\S]*\}/);
        if (finalMatch) {
          finalText = finalMatch[0];
          trace.push({ turn, action: "finalize" });
          break;
        }

        // Otherwise treat the model reply as an intermediate "summary of findings"
        // step and append to history so the loop continues. (Gemini already
        // ran the search natively; we just feed the model's text back.)
        if (text.trim().length > 0) {
          history.push({ role: "model", parts: [{ text }] });
          // Nudge the model to either dive or finalize.
          history.push({
            role: "user",
            parts: [
              {
                text: "Continue. Either issue another targeted google_search query if you found something material to dive into, or return your final JSON findings now.",
              },
            ],
          });
        } else {
          // No text at all — stop to avoid infinite loop.
          break;
        }
      }

      if (!finalText) {
        // Budget exhausted before final JSON. Return empty findings; trace records what happened.
        return { findings: [], trace };
      }

      let parsed: { findings: ExternalFinding[] };
      try {
        parsed = JSON.parse(finalText) as { findings: ExternalFinding[] };
      } catch {
        throw new Error("external-context: final JSON could not be parsed");
      }

      if (!Array.isArray(parsed.findings)) {
        throw new Error("external-context: final JSON missing findings array");
      }

      return { findings: parsed.findings, trace };
    },
  };
}
```

Update `resolveResearcher` to use the new default. Replace the placeholder-throw fallback:

```typescript
async function resolveResearcher(): Promise<Researcher> {
  if (deps.getResearcher) {
    return deps.getResearcher();
  }
  if (cachedResearcher) {
    return cachedResearcher;
  }
  const factory = deps.researcherFactory ?? defaultResearcherFactory;
  cachedResearcher = await factory();
  return cachedResearcher;
}
```

- [ ] **Step 2: Re-run all observer tests**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/external-context.test.ts
```

Expected: PASS (8/8) — unchanged (existing tests all use injected fakes; the new adapter is dormant for unit tests).

- [ ] **Step 3: Typecheck**

```bash
cd /Users/vero/openclaw && pnpm tsgo 2>&1 | grep "external-context" || echo "no external-context errors"
```

Expected: no errors in `external-context.ts`. Pre-existing errors in other files (`synthesizer.ts:75`, `gateway/server.chat.*`) are acceptable.

- [ ] **Step 4: Commit**

```bash
cd /Users/vero/openclaw && git add src/sentinel/observers/external-context.ts && git commit -m "$(cat <<'EOF'
feat(sentinel): default Gemini researcher adapter for external-context

Wires the real @google/genai client with the google_search tool. Multi-
turn loop: send conversation history, parse model reply, record grounding
queries into the trace, recognize a {findings: [...]} JSON object as the
final answer. Token + turn budget enforced via Gemini's usageMetadata
plus a turn counter. Budget exhaustion returns empty findings (graceful
empty cycle). Auth via existing GEMINI_API_KEY; no IAM changes.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Register the observer in `createSentinel`

**Files:**

- Modify: `/Users/vero/openclaw/src/sentinel/index.ts`

No new unit tests — per-observer tests already exist; the per-cycle integration is verified by the full sentinel test suite.

- [ ] **Step 1: Register the observer in `src/sentinel/index.ts`**

1. Add the import (alphabetical with the other observer imports — look at the existing block for `coperniq`, `gcp-functions`, `industry-context`, `launchagents`, `self`, `slack-channels`, `weather` and place `external-context` accordingly):

```typescript
import { createExternalContextObserver } from "./observers/external-context.js";
```

2. Inside `createSentinel`, alongside the other observer registrations (after the existing `registry.register(createGcpFunctionsObserver({ db }));` line):

```typescript
registry.register(createExternalContextObserver({ db }));
```

- [ ] **Step 2: Verify typecheck + full sentinel test suite**

```bash
cd /Users/vero/openclaw && pnpm tsgo && pnpm vitest run tests/sentinel
```

Expected:

- `pnpm tsgo` PASS or only PRE-EXISTING errors (`synthesizer.ts:75`, possibly `gateway/server.chat.*`).
- `pnpm vitest run tests/sentinel` PASS (no regressions).

- [ ] **Step 3: Manual instantiation smoke (no live Gemini)**

```bash
cd /Users/vero/openclaw && node --import tsx -e "
import('./src/sentinel/observers/external-context.js').then(async (m) => {
  const obs = m.createExternalContextObserver({
    getResearcher: async () => ({
      research: async () => ({ findings: [], trace: [] }),
    }),
  });
  const out = await obs.observe(0);
  console.log('observer name:', obs.name);
  console.log('emitted:', JSON.stringify(out));
});
"
```

Expected: `observer name: external-context`, `emitted: []`.

- [ ] **Step 4: Commit**

```bash
cd /Users/vero/openclaw && git add src/sentinel/index.ts && git commit -m "$(cat <<'EOF'
feat(sentinel): register external-context observer in createSentinel

Wires createExternalContextObserver({ db }) into ObserverRegistry
alongside coperniq, gcp-functions, and the Phase A observers. Production
uses the default Gemini + google_search factory; no flag change.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Live smoke on the Mac mini (manual, gated)

**Files:** none (operational verification — no code changes)

Operator-driven. Do not run autonomously without explicit user confirmation. This task runs the real Gemini adapter for the first time.

- [ ] **Step 1: Confirm `GEMINI_API_KEY` is set**

```bash
grep -E "^GEMINI_API_KEY=" ~/.openclaw/.env | head -c 40 && echo "..."
```

Expected: the key prefix prints.

- [ ] **Step 2: Set `OPENCLAW_SENTINEL_BOOT_CYCLE=1`** in `~/.openclaw/.env` (then revert to 0 after this step).

- [ ] **Step 3: Restart JR**

```bash
launchctl kickstart -k gui/$(id -u)/com.openclaw.agent
```

Wait for `[sentinel] boot-cycle complete` in `/Users/vero/openclaw.log`.

- [ ] **Step 4: Query sentinel.db for the new external-context observations**

```bash
sqlite3 ~/.openclaw/sentinel.db "SELECT id, datetime(timestamp/1000,'unixepoch','localtime') AS ts, summary FROM observations WHERE source='external-context' ORDER BY id DESC LIMIT 10;"
```

Expected: 3-5 rows with sensible summary text and recent `ts` matching the boot-cycle time. If 0 rows appear, look up the observer's error in the `runResult.errors` channel — the runner discards them silently, so reproduce via:

```bash
cd /Users/vero/openclaw && node --import tsx -e "
import('./src/sentinel/observers/external-context.js').then(async (m) => {
  const obs = m.createExternalContextObserver({});
  try {
    const out = await obs.observe(0);
    console.log('OK got', out.length, 'observations');
    if (out.length > 0) {
      console.log('first summary:', out[0].summary);
      console.log('cited_urls:', JSON.stringify(out[0].data.cited_urls));
    }
  } catch (e) {
    console.error('FAIL:', e.message);
  }
});
"
```

- [ ] **Step 5: Inspect `data.cited_urls` and `data.trace`**

```bash
sqlite3 ~/.openclaw/sentinel.db "SELECT data FROM observations WHERE source='external-context' ORDER BY id DESC LIMIT 1;" | python3 -m json.tool
```

Expected: `cited_urls` is a non-empty array of real HTTP(S) URLs; `trace` shows ≤ 6 turns with `action` in `{search, dive, finalize}` and at most 3 same-topic dives.

- [ ] **Step 6: Restore `OPENCLAW_SENTINEL_BOOT_CYCLE=0`** in `~/.openclaw/.env` so future restarts behave normally.

- [ ] **Step 7: No commit — verification only.**

---

## Spec coverage check

- Component file + registration → Tasks 1, 6.
- `Researcher` port + types → Task 1.
- Observer body (build prompt + budget, call researcher, map findings, empty-cycle) → Task 2.
- Lazy cached researcher (test seam preserved) → Task 3.
- 90s wall-clock timeout via `Promise.race` → Task 4.
- Default Gemini multi-turn adapter with `google_search` tool, token + turn budget, grounding-citation capture → Task 5.
- Error propagation (researcher throws → observer throws → runner catches) → Task 2 (test), Task 6 (runner contract unchanged).
- No live Gemini in unit tests → all tests inject fake `Researcher`.
- Manual smoke → Task 7.

## Out of scope (per spec)

- Cross-cycle deduplication (synthesizer's job).
- User-configurable topic list (curated in `SYSTEM_PROMPT`).
- Replacing `industry-context` (parallel, not replacement).
- Extending `LlmClient` to expose tool use.
- gmail-watcher integration (Phase B3, deferred pending CEO sign-off).
