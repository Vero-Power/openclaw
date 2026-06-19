# Sentinel Phase C.1 — Company + Research Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the external-context observer's hardcoded geography with two runtime-built context blobs: (1) live company snapshot from Firestore and (2) recent-research summary from sentinel.db.

**Architecture:** Two new modules under `src/sentinel/observers/external-context/`. `company-context.ts` reads `coperniq_projects` + `coperniq_work_orders` via a narrow `CompanyContextFirestoreLike` port and returns a plain-text blob. `recent-research.ts` reads last 7 days of `external-context` rows from `sentinel.db` and returns a bulleted-list blob. The observer's `observe()` calls both in `Promise.all`, splices outputs into the system prompt template, then proceeds as before. `ExternalContextObserverDeps.db` becomes required (was optional). Two new optional `companyContextFn` / `recentResearchFn` overrides for tests.

**Tech Stack:** TypeScript, `@google-cloud/firestore` (already in deps), `better-sqlite3` (already in deps), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-19-sentinel-phase-c1-company-and-research-context-design.md`

---

## File structure

| File                                                                | Responsibility                                                                                                  |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/sentinel/observers/external-context/company-context.ts`        | NEW. Port + `buildCompanyContext(deps)` + `createDefaultCompanyContextClient(creds)`.                           |
| `src/sentinel/observers/external-context/recent-research.ts`        | NEW. `buildRecentResearchContext(db, windowMs, options?)`.                                                      |
| `src/sentinel/observers/external-context.ts`                        | UPDATED. Extended deps; observer body builds context before research; system prompt template uses placeholders. |
| `tests/sentinel/observers/external-context/company-context.test.ts` | NEW. Fake `CompanyContextFirestoreLike`.                                                                        |
| `tests/sentinel/observers/external-context/recent-research.test.ts` | NEW. In-memory sentinel.db.                                                                                     |
| `tests/sentinel/observers/external-context.test.ts`                 | UPDATED. New tests for the wiring.                                                                              |

---

## Verified facts (carried from spec + earlier Firestore inspection)

- `coperniq_projects` doc shape includes `state` (2-letter code like "TX"), `status` (e.g., "ACTIVE"), `workflowName` (e.g., "Vero - Texas Workflow"), `value` (number).
- Current dataset: 224 total projects, 222 in TX, 2 in UT. 155 ACTIVE, 51 CANCELLED, 16 ON_HOLD, 2 COMPLETED. Total pipeline $11.2M.
- `coperniq_work_orders` doc shape includes `status` (e.g., "completed", "assigned", "waiting", "review").
- Firestore auth: same `firebase-adminsdk-fbsvc` JSON key path that the coperniq observer uses. Already authorized for these collections.
- `sentinel.db` `observations` schema: `id, source, topic, timestamp, summary, data (JSON string), metrics (JSON string), created_at`. The external-context observations have `confidence` and `published_at` inside `data` (set by Task 2 of Phase C).

---

## Task 1: Module `recent-research.ts` (no I/O, easiest first)

**Files:**

- Create: `/Users/vero/openclaw/src/sentinel/observers/external-context/recent-research.ts`
- Create: `/Users/vero/openclaw/tests/sentinel/observers/external-context/recent-research.test.ts`

- [ ] **Step 1: Write failing tests**

Create `/Users/vero/openclaw/tests/sentinel/observers/external-context/recent-research.test.ts`:

```typescript
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { openSentinelDb } from "../../../../src/sentinel/db.js";
import { buildRecentResearchContext } from "../../../../src/sentinel/observers/external-context/recent-research.js";

function tmpDb(): string {
  return join(tmpdir(), `sentinel-rr-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function cleanup(path: string): void {
  for (const suffix of ["", "-shm", "-wal"]) {
    const f = `${path}${suffix}`;
    if (existsSync(f)) unlinkSync(f);
  }
}

function seed(
  db: DatabaseType,
  rows: Array<{ summary: string; confidence: string; published_at: string | null; ageMs: number }>,
): void {
  const stmt = db.prepare(
    `INSERT INTO observations (source, topic, timestamp, summary, data, metrics, created_at) VALUES (?,?,?,?,?,?,?)`,
  );
  for (const r of rows) {
    const ts = Date.now() - r.ageMs;
    stmt.run(
      "external-context",
      "external:solar",
      ts,
      r.summary,
      JSON.stringify({
        confidence: r.confidence,
        published_at: r.published_at,
        cited_urls: [],
        trace: [],
      }),
      JSON.stringify({}),
      ts,
    );
  }
}

describe("buildRecentResearchContext", () => {
  let dbPath: string;
  let db: DatabaseType;

  beforeEach(() => {
    dbPath = tmpDb();
    db = openSentinelDb(dbPath);
  });

  afterEach(() => {
    db.close();
    cleanup(dbPath);
  });

  it("returns empty-state blob when no prior research rows exist", () => {
    const out = buildRecentResearchContext(db, 7 * 24 * 60 * 60 * 1000);
    expect(out).toContain("No prior research");
    expect(out).toContain("RECENT RESEARCH");
  });

  it("formats rows newest-first with confidence + published_at", () => {
    seed(db, [
      {
        summary: "Old finding",
        confidence: "low",
        published_at: "2026-06-12",
        ageMs: 5 * 24 * 60 * 60 * 1000,
      },
      {
        summary: "Newer finding",
        confidence: "high",
        published_at: "2026-06-19",
        ageMs: 1 * 60 * 60 * 1000,
      },
    ]);
    const out = buildRecentResearchContext(db, 7 * 24 * 60 * 60 * 1000);
    expect(out).toContain("Newer finding");
    expect(out).toContain("Old finding");
    expect(out).toContain("confidence: high");
    expect(out).toContain("published: 2026-06-19");
    const newerIdx = out.indexOf("Newer finding");
    const olderIdx = out.indexOf("Old finding");
    expect(newerIdx).toBeLessThan(olderIdx);
  });

  it("excludes rows older than the window", () => {
    seed(db, [
      {
        summary: "In window",
        confidence: "medium",
        published_at: "2026-06-18",
        ageMs: 1 * 60 * 60 * 1000,
      },
      {
        summary: "Out of window",
        confidence: "medium",
        published_at: "2026-05-01",
        ageMs: 30 * 24 * 60 * 60 * 1000,
      },
    ]);
    const out = buildRecentResearchContext(db, 7 * 24 * 60 * 60 * 1000);
    expect(out).toContain("In window");
    expect(out).not.toContain("Out of window");
  });

  it("caps results at maxEntries", () => {
    const rows = [];
    for (let i = 0; i < 25; i++) {
      rows.push({
        summary: `Finding ${i}`,
        confidence: "medium",
        published_at: null,
        ageMs: i * 1000,
      });
    }
    seed(db, rows);
    const out = buildRecentResearchContext(db, 7 * 24 * 60 * 60 * 1000, { maxEntries: 5 });
    const matches = out.match(/Finding \d+/g) ?? [];
    expect(matches.length).toBe(5);
  });

  it("handles missing confidence / published_at gracefully", () => {
    db.prepare(
      `INSERT INTO observations (source, topic, timestamp, summary, data, metrics, created_at) VALUES (?,?,?,?,?,?,?)`,
    ).run(
      "external-context",
      "external:solar",
      Date.now(),
      "Sparse data finding",
      JSON.stringify({ cited_urls: [], trace: [] }), // no confidence, no published_at
      JSON.stringify({}),
      Date.now(),
    );
    const out = buildRecentResearchContext(db, 7 * 24 * 60 * 60 * 1000);
    expect(out).toContain("Sparse data finding");
    expect(out).toContain("confidence: unknown");
    expect(out).toContain("published: unknown");
  });
});
```

- [ ] **Step 2: Run tests to verify FAIL**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/external-context/recent-research.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `recent-research.ts`**

Create `/Users/vero/openclaw/src/sentinel/observers/external-context/recent-research.ts`:

```typescript
import type { Database as DatabaseType } from "better-sqlite3";

const DEFAULT_MAX_ENTRIES = 20;

export interface RecentResearchOptions {
  maxEntries?: number;
}

export function buildRecentResearchContext(
  db: DatabaseType,
  windowMs: number,
  options: RecentResearchOptions = {},
): string {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const sinceMs = Date.now() - windowMs;
  const rows = db
    .prepare(
      `SELECT summary,
              json_extract(data, '$.confidence') AS confidence,
              json_extract(data, '$.published_at') AS published_at
       FROM observations
       WHERE source = 'external-context'
         AND timestamp > ?
       ORDER BY timestamp DESC
       LIMIT ?`,
    )
    .all(sinceMs, maxEntries) as Array<{
    summary: string;
    confidence: string | null;
    published_at: string | null;
  }>;

  if (rows.length === 0) {
    return "RECENT RESEARCH (last 7 days): No prior research available.";
  }

  const lines = rows.map((r) => {
    const conf = r.confidence ?? "unknown";
    const pub = r.published_at ?? "unknown";
    return `- "${r.summary}" (confidence: ${conf}, published: ${pub})`;
  });

  return `RECENT RESEARCH (last 7 days — what JR has already covered):\n${lines.join("\n")}`;
}
```

- [ ] **Step 4: Run tests to verify PASS**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/external-context/recent-research.test.ts
```

Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
cd /Users/vero/openclaw && git add src/sentinel/observers/external-context/recent-research.ts tests/sentinel/observers/external-context/recent-research.test.ts && git commit -m "$(cat <<'EOF'
feat(sentinel): external-context recent-research builder

Reads up to 20 external-context observations from sentinel.db within
a configurable window (default 7d) and formats them as a bulleted
list with confidence + published_at for inclusion in the observer's
system prompt. Empty state returns a "no prior research" sentinel.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Module `company-context.ts` (Firestore reader)

**Files:**

- Create: `/Users/vero/openclaw/src/sentinel/observers/external-context/company-context.ts`
- Create: `/Users/vero/openclaw/tests/sentinel/observers/external-context/company-context.test.ts`

- [ ] **Step 1: Write failing tests**

Create `/Users/vero/openclaw/tests/sentinel/observers/external-context/company-context.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  buildCompanyContext,
  type CompanyContextFirestoreLike,
} from "../../../../src/sentinel/observers/external-context/company-context.js";

function makeFakeClient(
  overrides: Partial<CompanyContextFirestoreLike> = {},
): CompanyContextFirestoreLike {
  return {
    countProjectsByField: overrides.countProjectsByField ?? (async () => ({})),
    sumProjectValue: overrides.sumProjectValue ?? (async () => 0),
    countWorkOrdersByStatus: overrides.countWorkOrdersByStatus ?? (async () => ({})),
  };
}

describe("buildCompanyContext", () => {
  it("formats a multi-state snapshot with status mix and pipeline value", async () => {
    const client = makeFakeClient({
      countProjectsByField: async (field) => {
        if (field === "state") return { TX: 222, UT: 2 };
        if (field === "status") return { ACTIVE: 155, CANCELLED: 51, ON_HOLD: 16, COMPLETED: 2 };
        if (field === "workflowName") return { "Vero - Texas Workflow": 224 };
        return {};
      },
      sumProjectValue: async () => 8_700_000,
      countWorkOrdersByStatus: async () => ({
        completed: 2313,
        assigned: 283,
        waiting: 266,
        review: 18,
      }),
    });

    const out = await buildCompanyContext({ client });

    expect(out).toContain("COMPANY SNAPSHOT");
    expect(out).toContain("224 projects");
    expect(out).toContain("TX (222");
    expect(out).toContain("UT (2");
    expect(out).toContain("ACTIVE");
    expect(out).toContain("CANCELLED");
    expect(out).toContain("$8,700,000");
    expect(out).toContain("Vero - Texas Workflow");
    expect(out).toContain("283 currently assigned");
  });

  it("emits a minimal blob when there are zero projects", async () => {
    const client = makeFakeClient(); // all defaults return empty
    const out = await buildCompanyContext({ client });
    expect(out).toContain("COMPANY SNAPSHOT");
    expect(out).toContain("No project data");
  });

  it("propagates errors from the Firestore client", async () => {
    const client = makeFakeClient({
      countProjectsByField: async () => {
        throw new Error("firestore down");
      },
    });
    await expect(buildCompanyContext({ client })).rejects.toThrow(/firestore down/);
  });

  it("sorts states by descending count", async () => {
    const client = makeFakeClient({
      countProjectsByField: async (field) => {
        if (field === "state") return { CA: 5, TX: 100, NY: 20 };
        return {};
      },
    });
    const out = await buildCompanyContext({ client });
    const txIdx = out.indexOf("TX");
    const nyIdx = out.indexOf("NY");
    const caIdx = out.indexOf("CA");
    expect(txIdx).toBeLessThan(nyIdx);
    expect(nyIdx).toBeLessThan(caIdx);
  });
});
```

- [ ] **Step 2: Run tests to verify FAIL**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/external-context/company-context.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `company-context.ts`**

Create `/Users/vero/openclaw/src/sentinel/observers/external-context/company-context.ts`:

```typescript
export interface CompanyContextFirestoreLike {
  countProjectsByField(field: "state" | "status" | "workflowName"): Promise<Record<string, number>>;
  sumProjectValue(filter: { status?: string }): Promise<number>;
  countWorkOrdersByStatus(): Promise<Record<string, number>>;
}

export interface CompanyContextDeps {
  client: CompanyContextFirestoreLike;
}

function formatCounts(counts: Record<string, number>, separator: string): string {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => `${key} (${count})`)
    .join(separator);
}

function formatStates(states: Record<string, number>, total: number): string {
  return Object.entries(states)
    .sort((a, b) => b[1] - a[1])
    .map(([state, count]) => {
      const pct = total > 0 ? ` ${((count / total) * 100).toFixed(1)}%` : "";
      return `${state} (${count}${pct})`;
    })
    .join(", ");
}

export async function buildCompanyContext(deps: CompanyContextDeps): Promise<string> {
  const [states, statuses, workflows, activeValue, woStatuses] = await Promise.all([
    deps.client.countProjectsByField("state"),
    deps.client.countProjectsByField("status"),
    deps.client.countProjectsByField("workflowName"),
    deps.client.sumProjectValue({ status: "ACTIVE" }),
    deps.client.countWorkOrdersByStatus(),
  ]);

  const totalProjects = Object.values(statuses).reduce((a, b) => a + b, 0);

  if (totalProjects === 0) {
    return "COMPANY SNAPSHOT (live data from Firestore): No project data available.";
  }

  const activeCount = statuses.ACTIVE ?? 0;
  const formattedValue = `$${Math.round(activeValue).toLocaleString("en-US")}`;
  const geographyLine = formatStates(states, totalProjects);
  const statusLine = formatCounts(statuses, ", ");
  const workflowLine = formatCounts(workflows, ", ");
  const woAssigned = woStatuses.assigned ?? 0;
  const woWaiting = woStatuses.waiting ?? 0;
  const woReview = woStatuses.review ?? 0;
  const woCompleted = woStatuses.completed ?? 0;

  return [
    "COMPANY SNAPSHOT (live data from Firestore):",
    `Vero is a residential solar installer with ${totalProjects} projects in Coperniq.`,
    `Geography: ${geographyLine}.`,
    `Active pipeline: ${activeCount} projects, ${formattedValue} total value.`,
    `Status mix: ${statusLine}.`,
    `Workflows: ${workflowLine}.`,
    `Work orders: ${woCompleted} completed lifetime, ${woAssigned} currently assigned, ${woWaiting} waiting, ${woReview} in review.`,
  ].join("\n");
}
```

- [ ] **Step 4: Run tests to verify PASS**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/external-context/company-context.test.ts
```

Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
cd /Users/vero/openclaw && git add src/sentinel/observers/external-context/company-context.ts tests/sentinel/observers/external-context/company-context.test.ts && git commit -m "$(cat <<'EOF'
feat(sentinel): external-context company-context builder

Aggregates coperniq_projects + coperniq_work_orders via a narrow
CompanyContextFirestoreLike port and formats a plain-text snapshot
blob (geography, status mix, pipeline value, workflow names, WO mix)
for inclusion in the observer's system prompt.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Default `CompanyContextFirestoreLike` adapter

**Files:**

- Modify: `/Users/vero/openclaw/src/sentinel/observers/external-context/company-context.ts`

No new unit tests — the adapter requires a live Firestore. Tests inject fakes; manual smoke verifies in Task 5.

- [ ] **Step 1: Add `createDefaultCompanyContextClient` adapter**

Append to `/Users/vero/openclaw/src/sentinel/observers/external-context/company-context.ts`:

```typescript
const COMPANY_CONTEXT_PROJECT_ID = "openclaw-mail-bridge";

export async function createDefaultCompanyContextClient(): Promise<CompanyContextFirestoreLike> {
  const { Firestore } = await import("@google-cloud/firestore");
  const fs = new Firestore({ projectId: COMPANY_CONTEXT_PROJECT_ID });

  return {
    async countProjectsByField(field) {
      const snap = await fs.collection("coperniq_projects").select(field).get();
      const out: Record<string, number> = {};
      for (const doc of snap.docs) {
        const value = doc.get(field) as string | null | undefined;
        const key = value ?? "(unknown)";
        out[key] = (out[key] ?? 0) + 1;
      }
      return out;
    },
    async sumProjectValue(filter) {
      let q = fs
        .collection("coperniq_projects")
        .select("value", "status") as FirebaseFirestore.Query;
      if (filter.status) {
        q = q.where("status", "==", filter.status);
      }
      const snap = await q.get();
      let total = 0;
      for (const doc of snap.docs) {
        const v = doc.get("value");
        if (typeof v === "number") {
          total += v;
        }
      }
      return total;
    },
    async countWorkOrdersByStatus() {
      const snap = await fs.collection("coperniq_work_orders").select("status").get();
      const out: Record<string, number> = {};
      for (const doc of snap.docs) {
        const status = (doc.get("status") as string | null | undefined) ?? "(unknown)";
        out[status] = (out[status] ?? 0) + 1;
      }
      return out;
    },
  };
}
```

The import path `FirebaseFirestore.Query` is the namespace type the SDK exposes. If TypeScript complains, replace with `unknown` cast: `let q: unknown = fs.collection(...); ...; const snap = await (q as { get: () => Promise<{ docs: Array<{ get: (k: string) => unknown }> }> }).get();`. Either way, the runtime behavior is the same.

- [ ] **Step 2: Typecheck**

```bash
cd /Users/vero/openclaw && pnpm tsgo 2>&1 | grep -E "company-context|external-context/" || echo "no relevant errors"
```

Expected: no errors in the new module. If `FirebaseFirestore.Query` doesn't typecheck, swap for the `unknown` workaround above.

- [ ] **Step 3: Re-run all observer tests**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/external-context
```

Expected: 9 tests pass (5 recent-research + 4 company-context). The new adapter is dormant under tests.

- [ ] **Step 4: Commit**

```bash
cd /Users/vero/openclaw && git add src/sentinel/observers/external-context/company-context.ts && git commit -m "$(cat <<'EOF'
feat(sentinel): default Firestore adapter for company-context builder

Lazy-built @google-cloud/firestore reader that iterates coperniq_projects
and coperniq_work_orders to produce aggregate counts. Reuses the
firebase-adminsdk-fbsvc JSON key already in deployment. Tests inject
fakes; this adapter is exercised only by manual smoke.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wire context builders into the observer

**Files:**

- Modify: `/Users/vero/openclaw/src/sentinel/observers/external-context.ts`
- Modify: `/Users/vero/openclaw/tests/sentinel/observers/external-context.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `/Users/vero/openclaw/tests/sentinel/observers/external-context.test.ts`:

```typescript
describe("createExternalContextObserver — context wiring", () => {
  let dbPath: string;
  let db: DatabaseType;

  beforeEach(() => {
    dbPath = tmpSentinelDb();
    db = openSentinelDb(dbPath);
  });
  afterEach(() => {
    db.close();
    cleanupDb(dbPath);
  });

  it("calls both context builders and splices their output into the prompt", async () => {
    let companyCalls = 0;
    let researchCalls = 0;
    const { researcher, calls } = makeFakeResearcher({ findings: [], trace: [] });

    const obs = createExternalContextObserver({
      db,
      getResearcher: async () => researcher,
      companyContextFn: async () => {
        companyCalls++;
        return "COMPANY SNAPSHOT: 224 projects, 222 in TX.";
      },
      recentResearchFn: () => {
        researchCalls++;
        return "RECENT RESEARCH: ITC expiration covered yesterday.";
      },
    });

    await obs.observe(0);

    expect(companyCalls).toBe(1);
    expect(researchCalls).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].systemPrompt).toContain("COMPANY SNAPSHOT: 224 projects, 222 in TX.");
    expect(calls[0].systemPrompt).toContain("RECENT RESEARCH: ITC expiration covered yesterday.");
    // Verify hardcoded geography is GONE
    expect(calls[0].systemPrompt).not.toContain("Colorado, Texas, and Arizona");
  });

  it("rejects when the company-context builder throws", async () => {
    const { researcher } = makeFakeResearcher({ findings: [], trace: [] });
    const obs = createExternalContextObserver({
      db,
      getResearcher: async () => researcher,
      companyContextFn: async () => {
        throw new Error("firestore failure");
      },
      recentResearchFn: () => "RECENT RESEARCH: empty.",
    });
    await expect(obs.observe(0)).rejects.toThrow(/firestore failure/);
  });

  it("uses the runner-provided db for the default recent-research builder when no fn is injected", async () => {
    // Seed an external-context row so recent-research has something to find.
    db.prepare(
      `INSERT INTO observations (source, topic, timestamp, summary, data, metrics, created_at) VALUES (?,?,?,?,?,?,?)`,
    ).run(
      "external-context",
      "external:solar",
      Date.now(),
      "Test finding from seed",
      JSON.stringify({ confidence: "high", published_at: "2026-06-19", cited_urls: [], trace: [] }),
      JSON.stringify({}),
      Date.now(),
    );

    const { researcher, calls } = makeFakeResearcher({ findings: [], trace: [] });
    const obs = createExternalContextObserver({
      db,
      getResearcher: async () => researcher,
      // No recentResearchFn — should fall back to default which reads db
      companyContextFn: async () => "COMPANY SNAPSHOT: minimal.",
    });

    await obs.observe(0);
    expect(calls[0].systemPrompt).toContain("Test finding from seed");
  });
});
```

- [ ] **Step 2: Run tests to verify FAIL**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/external-context.test.ts
```

Expected: FAIL — `companyContextFn` and `recentResearchFn` aren't yet in `ExternalContextObserverDeps`; the observer doesn't yet splice their output.

- [ ] **Step 3: Update the observer**

Edit `/Users/vero/openclaw/src/sentinel/observers/external-context.ts`:

1. Add imports at the top:

```typescript
import {
  buildCompanyContext,
  createDefaultCompanyContextClient,
} from "./external-context/company-context.js";
import { buildRecentResearchContext } from "./external-context/recent-research.js";
```

2. Update `ExternalContextObserverDeps`:

```typescript
export interface ExternalContextObserverDeps {
  db: DatabaseType; // CHANGED: now required
  getResearcher?: () => Promise<Researcher>;
  researcherFactory?: () => Promise<Researcher> | Researcher;
  timeoutMs?: number;
  companyContextFn?: () => Promise<string>;
  recentResearchFn?: () => string;
}
```

3. Add module-level constants alongside the existing ones:

```typescript
const RECENT_RESEARCH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
```

4. Replace the hardcoded `SYSTEM_PROMPT` constant. Rename to `SYSTEM_PROMPT_TEMPLATE` (or replace inline) and build dynamically inside `observe()`. The template becomes a function that takes the two context blobs:

```typescript
function buildSystemPrompt(companyContext: string, recentResearch: string): string {
  return `You are a solar industry analyst working for Vero.

${companyContext}

${recentResearch}

Use the google_search tool to find developments affecting Vero NOW. Prioritize signal relevant to the company's actual operating geography from the snapshot above. Don't re-search topics in the recent-research list unless there is a material update. Federal/national signal is fine when broadly relevant.

What categories matter:
- Federal/state solar policy: ITC, NEM, state incentives, permitting
- Supply chain: panel/inverter/battery vendor news, tariffs, lead times
- Weather/grid: extreme-weather forecasts, ERCOT events, grid outages
- Competition: large-installer news, M&A, pricing
- Customer signals: financing rates, electricity prices

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
}
```

Remove the now-unused `SYSTEM_PROMPT` constant entirely.

5. Update `observe()` to build context before research:

```typescript
    async observe(_since: number): Promise<Omit<Observation, "id" | "created_at">[]> {
      const researcher = await resolveResearcher();
      const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

      const companyContextFn =
        deps.companyContextFn ??
        (async () => {
          const client = await createDefaultCompanyContextClient();
          return buildCompanyContext({ client });
        });
      const recentResearchFn =
        deps.recentResearchFn ?? (() => buildRecentResearchContext(deps.db, RECENT_RESEARCH_WINDOW_MS));

      const [companyContext, recentResearch] = await Promise.all([
        companyContextFn(),
        Promise.resolve(recentResearchFn()),
      ]);

      const systemPrompt = buildSystemPrompt(companyContext, recentResearch);

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
          researcher.research({ systemPrompt, budget: DEFAULT_BUDGET }),
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
```

The existing tests from earlier Phase C tasks need to be updated because they previously asserted the `systemPrompt` contained "Vero" and "google_search" — those substrings will still be present in the new template, so those assertions still pass. The "passes systemPrompt correctly" test from Task 2 will need its assertion updated since the prompt now contains "{company_context}" / "{recent_research}" placeholders replaced at runtime, not the original `Colorado, Texas, and Arizona` literal.

**Action:** Find any assertion in `external-context.test.ts` that references "Colorado", "Texas", or "Arizona" inside the original hardcoded prompt and either remove or update to test the new dynamic-prompt shape. The Task 2 test asserts `calls[0].systemPrompt).toContain("Vero")` and `toContain("google_search")` — both still apply.

- [ ] **Step 4: Run all observer tests**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/external-context.test.ts tests/sentinel/observers/external-context
```

Expected: All observer tests pass (8 prior + 3 new = 11 for the main test file; 5 + 4 = 9 for the submodule tests; 20 total).

- [ ] **Step 5: Verify typecheck + full sentinel suite**

```bash
cd /Users/vero/openclaw && pnpm tsgo 2>&1 | grep -E "external-context" || echo "no errors"
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel
```

Expected: typecheck clean for external-context files. Full sentinel suite passes (no regressions).

- [ ] **Step 6: Commit**

```bash
cd /Users/vero/openclaw && git add src/sentinel/observers/external-context.ts tests/sentinel/observers/external-context.test.ts && git commit -m "$(cat <<'EOF'
feat(sentinel): external-context observer wires company + research context

Drops the hardcoded "Colorado, Texas, and Arizona" geography. Builds
the system prompt at runtime from two new context blobs: company
snapshot from live Firestore data (via createDefaultCompanyContextClient
when no fn is injected) and recent-research summary from sentinel.db
(last 7 days). Promise.all parallelizes both builders. ExternalContextObserverDeps.db
is now required (was optional). companyContextFn / recentResearchFn
are injectable test seams.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Live smoke on the Mac mini (manual, gated)

**Files:** none (operational verification — no code changes)

Same pattern as Phase C Task 7. Operator-driven; do not run autonomously.

- [ ] **Step 1: Set `OPENCLAW_SENTINEL_BOOT_CYCLE=1`** in `~/.openclaw/.env`.

- [ ] **Step 2: Restart JR**

```bash
launchctl kickstart -k gui/$(id -u)/com.openclaw.agent
```

Wait for `[sentinel] boot-cycle complete` in `/Users/vero/openclaw.log`.

- [ ] **Step 3: Query the new external-context observations**

```bash
sqlite3 ~/.openclaw/sentinel.db "SELECT id, datetime(timestamp/1000,'unixepoch','localtime') AS ts, summary FROM observations WHERE source='external-context' ORDER BY id DESC LIMIT 8;"
```

Expected: 3-5 new rows. Inspect summaries — they should now lean Texas-heavy (no more Colorado / Arizona false positives unless there's genuine signal that affects national markets and therefore Vero).

- [ ] **Step 4: Inspect the trace to confirm searches are Texas-skewed**

```bash
sqlite3 ~/.openclaw/sentinel.db "SELECT json_extract(data,'$.trace') FROM observations WHERE source='external-context' ORDER BY id DESC LIMIT 1;" | python3 -m json.tool
```

Expected: queries reference Texas, ERCOT, or national signal. No queries for Colorado / Arizona unless those states are present in `coperniq_projects.state`.

- [ ] **Step 5: Restore `OPENCLAW_SENTINEL_BOOT_CYCLE=0`** in `~/.openclaw/.env`.

- [ ] **Step 6: No commit — verification only.**

---

## Spec coverage check

- `buildRecentResearchContext` (sentinel.db reader) → Task 1.
- `buildCompanyContext` (Firestore reader + formatter) → Task 2.
- `createDefaultCompanyContextClient` (Firestore adapter, manual-smoke-only) → Task 3.
- Observer wiring (extended deps, builders called, system-prompt templating, hardcoded geography removed) → Task 4.
- Manual smoke → Task 5.

## Out of scope (per spec)

- Embedding-based dedup of recent research.
- Configurable research-history window via env var.
- Schema changes to `observations`.
- Updating other observers to use a "company snapshot" pattern.
