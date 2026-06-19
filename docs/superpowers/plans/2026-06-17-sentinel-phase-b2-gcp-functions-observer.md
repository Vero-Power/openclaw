# Sentinel Phase B2 — GCP Functions Observer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `gcp-functions` observer that reads Cloud Logging entries for the six deployed openclaw GCFs each 2h cycle, tallies invocations + errors per function, captures the most recent error excerpt, and emits one observation into `sentinel.db` with deltas vs the prior observation.

**Architecture:** New file `src/sentinel/observers/gcp-functions.ts` exporting `createGcpFunctionsObserver(deps): Observer`. Same DI shape as the coperniq observer: `{ db, getClient?, clientFactory? }`. Auth via Application Default Credentials + service-account impersonation (already wired; the impersonated SA holds `roles/logging.viewer`). New dep `@google-cloud/logging`. Lazy cached client built only once per observer instance.

**Tech Stack:** TypeScript, `@google-cloud/logging`, `better-sqlite3`, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-17-sentinel-phase-b2-gcp-functions-observer-design.md`

---

## File structure

| File                                             | Responsibility                                                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `src/sentinel/observers/gcp-functions.ts`        | `createGcpFunctionsObserver(deps)` plus `LoggingLike`/`LogEntry` port. Single file — small, focused. |
| `tests/sentinel/observers/gcp-functions.test.ts` | Unit tests with a fake `LoggingLike` via DI. No live Cloud Logging.                                  |
| `src/sentinel/index.ts`                          | Register the new observer alongside the others. One-line change.                                     |
| `package.json`                                   | Adds `@google-cloud/logging` dependency (Task 1).                                                    |

---

## Verified facts (carried from spec)

- GCP project: `openclaw-mail-bridge`.
- Six target functions (hard-coded constant in observer): `bomQuoteNotifier`, `finalDesignSender`, `signedDesignPlansetReview`, `coperniqFirestoreIngest`, `ghlFirestoreIngest`, `slackFirestoreIngest`.
- Window: fixed 2h, computed as `new Date(Date.now() - 2*60*60*1000).toISOString()`.
- Auth: ADC + impersonation, already verified end-to-end on the Mac mini (`GOOGLE_APPLICATION_CREDENTIALS` is disabled in `~/.openclaw/.env`).
- Severity buckets: error set = `{"ERROR", "CRITICAL", "ALERT", "EMERGENCY"}`.
- `last_error` text truncated at 300 chars.

---

## Task 1: Add Logging dependency and scaffold types + stub

**Files:**

- Modify: `/Users/vero/openclaw/package.json`
- Create: `/Users/vero/openclaw/src/sentinel/observers/gcp-functions.ts`
- Create: `/Users/vero/openclaw/tests/sentinel/observers/gcp-functions.test.ts`

- [ ] **Step 1: Install dependency**

```bash
cd /Users/vero/openclaw && pnpm add @google-cloud/logging
```

Expected: package.json gains `"@google-cloud/logging"`, pnpm-lock.yaml updated.

- [ ] **Step 2: Write failing import test**

Create `/Users/vero/openclaw/tests/sentinel/observers/gcp-functions.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  createGcpFunctionsObserver,
  type LoggingLike,
} from "../../../src/sentinel/observers/gcp-functions.js";

describe("gcp-functions observer module", () => {
  it("exports createGcpFunctionsObserver and the LoggingLike type", () => {
    expect(typeof createGcpFunctionsObserver).toBe("function");
    const client: LoggingLike = {
      listFunctionEntries: async () => [],
    };
    expect(typeof client.listFunctionEntries).toBe("function");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/gcp-functions.test.ts
```

Expected: FAIL — cannot import (file does not exist).

- [ ] **Step 4: Create the observer file with types + stub**

Create `/Users/vero/openclaw/src/sentinel/observers/gcp-functions.ts`:

```typescript
import type { Database as DatabaseType } from "better-sqlite3";
import type { Observer } from "../observer.js";
import type { Observation } from "../types.js";

export interface LogEntry {
  timestamp: string;
  severity: string;
  text: string;
}

export interface LoggingLike {
  listFunctionEntries(serviceName: string, sinceIso: string): Promise<LogEntry[]>;
}

export interface GcpFunctionsObserverDeps {
  db: DatabaseType;
  getClient?: () => Promise<LoggingLike>;
  clientFactory?: () => Promise<LoggingLike> | LoggingLike;
}

export const GCP_FUNCTIONS = [
  "bomQuoteNotifier",
  "finalDesignSender",
  "signedDesignPlansetReview",
  "coperniqFirestoreIngest",
  "ghlFirestoreIngest",
  "slackFirestoreIngest",
] as const;

export function createGcpFunctionsObserver(_deps: GcpFunctionsObserverDeps): Observer {
  return {
    name: "gcp-functions",
    async observe(_since: number): Promise<Omit<Observation, "id" | "created_at">[]> {
      return [];
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/gcp-functions.test.ts
```

Expected: PASS (1/1).

- [ ] **Step 6: Commit**

```bash
cd /Users/vero/openclaw && git add package.json pnpm-lock.yaml src/sentinel/observers/gcp-functions.ts tests/sentinel/observers/gcp-functions.test.ts && git commit -m "$(cat <<'EOF'
feat(sentinel): scaffold gcp-functions observer module

Adds @google-cloud/logging dep, exports LoggingLike port, GCP_FUNCTIONS
constant (six openclaw GCFs), and a stub createGcpFunctionsObserver that
returns no observations. Subsequent tasks fill in tallying, deltas,
summary composition, and the default ADC Logging client factory.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: First-run tally — invocations + errors per function

**Files:**

- Modify: `/Users/vero/openclaw/src/sentinel/observers/gcp-functions.ts`
- Modify: `/Users/vero/openclaw/tests/sentinel/observers/gcp-functions.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/sentinel/observers/gcp-functions.test.ts`. First add these imports to the top imports block (alongside existing):

```typescript
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import { afterEach, beforeEach } from "vitest";
import { openSentinelDb } from "../../../src/sentinel/db.js";
```

Then append helpers + describe at the bottom:

```typescript
function tmpSentinelDb(): string {
  return join(tmpdir(), `sentinel-gcpfn-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function cleanupDb(path: string): void {
  for (const suffix of ["", "-shm", "-wal"]) {
    const f = `${path}${suffix}`;
    if (existsSync(f)) unlinkSync(f);
  }
}

function makeFakeClient(entriesByFunction: Record<string, LogEntry[]> = {}): LoggingLike {
  return {
    listFunctionEntries: async (serviceName: string) => entriesByFunction[serviceName] ?? [],
  };
}

describe("createGcpFunctionsObserver — first-run tally", () => {
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

  it("emits one observation with per-function invocations + errors", async () => {
    const client = makeFakeClient({
      bomQuoteNotifier: [
        { timestamp: "2026-06-17T20:30:00Z", severity: "INFO", text: "ok" },
        { timestamp: "2026-06-17T20:31:00Z", severity: "INFO", text: "ok" },
        { timestamp: "2026-06-17T20:32:00Z", severity: "ERROR", text: "boom" },
      ],
      ghlFirestoreIngest: [
        { timestamp: "2026-06-17T20:45:00Z", severity: "CRITICAL", text: "ouch" },
      ],
    });

    const obs = createGcpFunctionsObserver({ db, getClient: async () => client });
    const out = await obs.observe(0);

    expect(out).toHaveLength(1);
    const o = out[0];
    expect(o.source).toBe("gcp-functions");
    expect(o.topic).toBe("gcp-functions");
    expect(o.metrics).toMatchObject({
      invocations_total: 4,
      errors_total: 2,
      bomquotenotifier_invocations: 3,
      bomquotenotifier_errors: 1,
      ghlfirestoreingest_invocations: 1,
      ghlfirestoreingest_errors: 1,
      finaldesignsender_invocations: 0,
      finaldesignsender_errors: 0,
    });
    const metricKeys = Object.keys(o.metrics ?? {});
    expect(metricKeys.some((k) => k.startsWith("delta_"))).toBe(false);
  });

  it("data.functions preserves the hard-coded function order", async () => {
    const obs = createGcpFunctionsObserver({ db, getClient: async () => makeFakeClient() });
    const out = await obs.observe(0);
    const data = out[0].data as { functions: Array<{ name: string }> };
    expect(data.functions.map((f) => f.name)).toEqual([
      "bomQuoteNotifier",
      "finalDesignSender",
      "signedDesignPlansetReview",
      "coperniqFirestoreIngest",
      "ghlFirestoreIngest",
      "slackFirestoreIngest",
    ]);
  });

  it("calls listFunctionEntries once per function with the same sinceIso", async () => {
    const calls: Array<{ name: string; sinceIso: string }> = [];
    const client: LoggingLike = {
      listFunctionEntries: async (name, sinceIso) => {
        calls.push({ name, sinceIso });
        return [];
      },
    };
    const obs = createGcpFunctionsObserver({ db, getClient: async () => client });
    await obs.observe(0);
    expect(calls).toHaveLength(6);
    const uniqueSinceIsos = new Set(calls.map((c) => c.sinceIso));
    expect(uniqueSinceIsos.size).toBe(1);
    // sinceIso is ~2h before now (with a small tolerance)
    const sinceMs = Date.parse([...uniqueSinceIsos][0]);
    const expectedMs = Date.now() - 2 * 60 * 60 * 1000;
    expect(Math.abs(sinceMs - expectedMs)).toBeLessThan(5000);
  });
});
```

- [ ] **Step 2: Run tests to verify FAIL**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/gcp-functions.test.ts
```

Expected: FAIL — observer returns `[]` instead of an observation.

- [ ] **Step 3: Implement tally + observation assembly**

In `/Users/vero/openclaw/src/sentinel/observers/gcp-functions.ts`, add module-level constant + helpers above `createGcpFunctionsObserver`:

```typescript
const WINDOW_MS = 2 * 60 * 60 * 1000;
const ERROR_SEVERITIES = new Set(["ERROR", "CRITICAL", "ALERT", "EMERGENCY"]);

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "unknown"
  );
}

function countEntries(entries: LogEntry[]): { invocations: number; errors: number } {
  let errors = 0;
  for (const e of entries) {
    if (ERROR_SEVERITIES.has(e.severity)) {
      errors++;
    }
  }
  return { invocations: entries.length, errors };
}
```

Replace `createGcpFunctionsObserver` body:

```typescript
export function createGcpFunctionsObserver(deps: GcpFunctionsObserverDeps): Observer {
  return {
    name: "gcp-functions",
    async observe(_since: number): Promise<Omit<Observation, "id" | "created_at">[]> {
      const getClient =
        deps.getClient ??
        (async () => {
          throw new Error("default Logging client not yet wired (see Task 7 in plan)");
        });
      const client = await getClient();

      const now = Date.now();
      const windowStartIso = new Date(now - WINDOW_MS).toISOString();
      const windowEndIso = new Date(now).toISOString();

      const entriesByFunction = await Promise.all(
        GCP_FUNCTIONS.map(async (name) => ({
          name,
          entries: await client.listFunctionEntries(name, windowStartIso),
        })),
      );

      const functions = entriesByFunction.map(({ name, entries }) => {
        const { invocations, errors } = countEntries(entries);
        return {
          name,
          invocations,
          errors,
          last_invocation_at: null as string | null,
          last_error: null as { ts: string; text: string } | null,
        };
      });

      const invocations_total = functions.reduce((acc, f) => acc + f.invocations, 0);
      const errors_total = functions.reduce((acc, f) => acc + f.errors, 0);

      const metrics: Record<string, number> = {
        invocations_total,
        errors_total,
      };
      for (const f of functions) {
        const slug = slugify(f.name);
        metrics[`${slug}_invocations`] = f.invocations;
        metrics[`${slug}_errors`] = f.errors;
      }

      return [
        {
          source: "gcp-functions",
          topic: "gcp-functions",
          timestamp: now,
          summary: `${functions.length} functions: ${invocations_total} invocations, ${errors_total} errors. Window: 2h.`,
          data: {
            windowStartIso,
            windowEndIso,
            functions,
          },
          metrics,
        },
      ];
    },
  };
}
```

- [ ] **Step 4: Run tests to verify PASS**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/gcp-functions.test.ts
```

Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
cd /Users/vero/openclaw && git add src/sentinel/observers/gcp-functions.ts tests/sentinel/observers/gcp-functions.test.ts && git commit -m "$(cat <<'EOF'
feat(sentinel): gcp-functions first-run tally — invocations + errors

For each of the six openclaw GCFs, queries Cloud Logging entries via the
injected client over a fixed 2h window, counts invocations and errors
(severity in ERROR/CRITICAL/ALERT/EMERGENCY), and emits one observation
with per-function metrics + a stable function ordering in data.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: last_invocation_at + last_error excerpt (300-char truncation)

**Files:**

- Modify: `/Users/vero/openclaw/src/sentinel/observers/gcp-functions.ts`
- Modify: `/Users/vero/openclaw/tests/sentinel/observers/gcp-functions.test.ts`

- [ ] **Step 1: Write failing tests**

Append:

```typescript
describe("createGcpFunctionsObserver — last_invocation_at + last_error", () => {
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

  it("picks the newest entry by timestamp for last_invocation_at", async () => {
    const client = makeFakeClient({
      bomQuoteNotifier: [
        { timestamp: "2026-06-17T20:30:00Z", severity: "INFO", text: "old" },
        { timestamp: "2026-06-17T20:45:00Z", severity: "INFO", text: "newest" },
        { timestamp: "2026-06-17T20:35:00Z", severity: "INFO", text: "middle" },
      ],
    });
    const obs = createGcpFunctionsObserver({ db, getClient: async () => client });
    const out = await obs.observe(0);
    const data = out[0].data as {
      functions: Array<{ name: string; last_invocation_at: string | null }>;
    };
    const bom = data.functions.find((f) => f.name === "bomQuoteNotifier");
    expect(bom?.last_invocation_at).toBe("2026-06-17T20:45:00Z");
  });

  it("last_invocation_at is null when no entries", async () => {
    const obs = createGcpFunctionsObserver({ db, getClient: async () => makeFakeClient() });
    const out = await obs.observe(0);
    const data = out[0].data as { functions: Array<{ last_invocation_at: string | null }> };
    expect(data.functions.every((f) => f.last_invocation_at === null)).toBe(true);
  });

  it("last_error picks the newest error-severity entry, truncated to 300 chars", async () => {
    const longText = "X".repeat(500);
    const client = makeFakeClient({
      bomQuoteNotifier: [
        { timestamp: "2026-06-17T20:30:00Z", severity: "ERROR", text: "old err" },
        { timestamp: "2026-06-17T20:45:00Z", severity: "ERROR", text: longText },
        { timestamp: "2026-06-17T20:50:00Z", severity: "INFO", text: "not an error" },
      ],
    });
    const obs = createGcpFunctionsObserver({ db, getClient: async () => client });
    const out = await obs.observe(0);
    const data = out[0].data as {
      functions: Array<{ name: string; last_error: { ts: string; text: string } | null }>;
    };
    const bom = data.functions.find((f) => f.name === "bomQuoteNotifier");
    expect(bom?.last_error?.ts).toBe("2026-06-17T20:45:00Z");
    expect(bom?.last_error?.text).toHaveLength(300);
    expect(bom?.last_error?.text).toMatch(/^X+$/);
  });

  it("last_error is null when no error-severity entries", async () => {
    const client = makeFakeClient({
      bomQuoteNotifier: [
        { timestamp: "2026-06-17T20:30:00Z", severity: "INFO", text: "ok" },
        { timestamp: "2026-06-17T20:31:00Z", severity: "WARNING", text: "yellow" },
      ],
    });
    const obs = createGcpFunctionsObserver({ db, getClient: async () => client });
    const out = await obs.observe(0);
    const data = out[0].data as { functions: Array<{ name: string; last_error: unknown }> };
    const bom = data.functions.find((f) => f.name === "bomQuoteNotifier");
    expect(bom?.last_error).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify FAIL**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/gcp-functions.test.ts
```

Expected: FAIL — `last_invocation_at` and `last_error` are still `null` placeholders.

- [ ] **Step 3: Implement last_invocation_at + last_error extraction**

Add module-level helper in `/Users/vero/openclaw/src/sentinel/observers/gcp-functions.ts`:

```typescript
const LAST_ERROR_MAX_LEN = 300;

function extractFunctionDetail(entries: LogEntry[]): {
  last_invocation_at: string | null;
  last_error: { ts: string; text: string } | null;
} {
  let newestTs: string | null = null;
  let newestErrorTs: string | null = null;
  let newestErrorText: string | null = null;
  for (const e of entries) {
    if (newestTs === null || e.timestamp.localeCompare(newestTs) > 0) {
      newestTs = e.timestamp;
    }
    if (ERROR_SEVERITIES.has(e.severity)) {
      if (newestErrorTs === null || e.timestamp.localeCompare(newestErrorTs) > 0) {
        newestErrorTs = e.timestamp;
        newestErrorText = e.text;
      }
    }
  }
  return {
    last_invocation_at: newestTs,
    last_error:
      newestErrorTs !== null && newestErrorText !== null
        ? { ts: newestErrorTs, text: newestErrorText.slice(0, LAST_ERROR_MAX_LEN) }
        : null,
  };
}
```

Update `observe()` to populate `last_invocation_at` + `last_error` per function. Replace the `functions = entriesByFunction.map(...)` block:

```typescript
const functions = entriesByFunction.map(({ name, entries }) => {
  const { invocations, errors } = countEntries(entries);
  const detail = extractFunctionDetail(entries);
  return {
    name,
    invocations,
    errors,
    last_invocation_at: detail.last_invocation_at,
    last_error: detail.last_error,
  };
});
```

- [ ] **Step 4: Run tests to verify PASS**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/gcp-functions.test.ts
```

Expected: PASS (8/8).

- [ ] **Step 5: Commit**

```bash
cd /Users/vero/openclaw && git add src/sentinel/observers/gcp-functions.ts tests/sentinel/observers/gcp-functions.test.ts && git commit -m "$(cat <<'EOF'
feat(sentinel): gcp-functions last_invocation_at + last_error excerpt

Per-function: newest entry's timestamp -> last_invocation_at; newest
error-severity entry's text truncated at 300 chars -> last_error.
Uses lex comparison on ISO timestamps for newest-wins (Slack-ts pattern).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Delta math vs prior observation

**Files:**

- Modify: `/Users/vero/openclaw/src/sentinel/observers/gcp-functions.ts`
- Modify: `/Users/vero/openclaw/tests/sentinel/observers/gcp-functions.test.ts`

- [ ] **Step 1: Write failing tests**

Append:

```typescript
describe("createGcpFunctionsObserver — deltas", () => {
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

  it("emits nonzero delta metrics vs the most recent prior gcp-functions observation", async () => {
    // Seed prior: bom 5 inv / 1 err; ghl 2 inv / 0 err.
    db.prepare(
      `INSERT INTO observations (source, topic, timestamp, summary, data, metrics, created_at) VALUES (?,?,?,?,?,?,?)`,
    ).run(
      "gcp-functions",
      "gcp-functions",
      Date.now() - 7_200_000,
      "prior",
      JSON.stringify({
        functions: [
          { name: "bomQuoteNotifier", invocations: 5, errors: 1 },
          { name: "ghlFirestoreIngest", invocations: 2, errors: 0 },
        ],
      }),
      JSON.stringify({}),
      Date.now() - 7_200_000,
    );

    const client = makeFakeClient({
      bomQuoteNotifier: [
        { timestamp: "2026-06-17T20:30:00Z", severity: "INFO", text: "ok" },
        { timestamp: "2026-06-17T20:31:00Z", severity: "INFO", text: "ok" },
        { timestamp: "2026-06-17T20:32:00Z", severity: "INFO", text: "ok" },
        { timestamp: "2026-06-17T20:33:00Z", severity: "ERROR", text: "boom" },
      ],
      ghlFirestoreIngest: [
        { timestamp: "2026-06-17T20:45:00Z", severity: "ERROR", text: "x" },
        { timestamp: "2026-06-17T20:46:00Z", severity: "ERROR", text: "y" },
      ],
    });

    const obs = createGcpFunctionsObserver({ db, getClient: async () => client });
    const out = await obs.observe(0);
    const m = out[0].metrics ?? {};

    // bom: 5 -> 4 invocations (-1), 1 -> 1 errors (no delta)
    expect(m.delta_bomquotenotifier_invocations).toBe(-1);
    expect(m.delta_bomquotenotifier_errors).toBeUndefined();
    // ghl: 2 -> 2 invocations (no delta), 0 -> 2 errors (+2)
    expect(m.delta_ghlfirestoreingest_invocations).toBeUndefined();
    expect(m.delta_ghlfirestoreingest_errors).toBe(2);
  });

  it("first run (no prior observation) has no delta keys", async () => {
    const client = makeFakeClient({
      bomQuoteNotifier: [{ timestamp: "2026-06-17T20:30:00Z", severity: "INFO", text: "ok" }],
    });
    const obs = createGcpFunctionsObserver({ db, getClient: async () => client });
    const out = await obs.observe(0);
    const metricKeys = Object.keys(out[0].metrics ?? {});
    expect(metricKeys.some((k) => k.startsWith("delta_"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify FAIL**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/gcp-functions.test.ts
```

Expected: FAIL — observer doesn't compute deltas yet.

- [ ] **Step 3: Implement delta math**

Add module-level helper in `/Users/vero/openclaw/src/sentinel/observers/gcp-functions.ts`:

```typescript
interface PriorFunction {
  name: string;
  invocations: number;
  errors: number;
}

interface PriorObservation {
  functions: PriorFunction[];
}

function readPriorObservation(db: DatabaseType): PriorObservation | null {
  const row = db
    .prepare(
      `SELECT data FROM observations WHERE source = 'gcp-functions' ORDER BY id DESC LIMIT 1`,
    )
    .get() as { data: string | null } | undefined;
  if (!row?.data) {
    return null;
  }
  try {
    const parsed = JSON.parse(row.data) as Partial<PriorObservation>;
    if (!Array.isArray(parsed.functions)) {
      return null;
    }
    return {
      functions: parsed.functions
        .filter(
          (f): f is PriorFunction =>
            typeof f === "object" &&
            f !== null &&
            typeof (f as PriorFunction).name === "string" &&
            typeof (f as PriorFunction).invocations === "number" &&
            typeof (f as PriorFunction).errors === "number",
        )
        .map((f) => ({ name: f.name, invocations: f.invocations, errors: f.errors })),
    };
  } catch {
    return null;
  }
}

function computeDeltas(
  current: Array<{ name: string; invocations: number; errors: number }>,
  prior: PriorObservation,
): Record<string, number> {
  const priorByName = new Map(prior.functions.map((f) => [f.name, f]));
  const out: Record<string, number> = {};
  for (const f of current) {
    const p = priorByName.get(f.name);
    if (!p) {
      continue;
    }
    const slug = slugify(f.name);
    const dInv = f.invocations - p.invocations;
    const dErr = f.errors - p.errors;
    if (dInv !== 0) {
      out[`delta_${slug}_invocations`] = dInv;
    }
    if (dErr !== 0) {
      out[`delta_${slug}_errors`] = dErr;
    }
  }
  return out;
}
```

In `observe()`, after `metrics` is built and before the `return`:

```typescript
const prior = readPriorObservation(deps.db);
if (prior) {
  Object.assign(metrics, computeDeltas(functions, prior));
}
```

- [ ] **Step 4: Run tests to verify PASS**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/gcp-functions.test.ts
```

Expected: PASS (10/10).

- [ ] **Step 5: Commit**

```bash
cd /Users/vero/openclaw && git add src/sentinel/observers/gcp-functions.ts tests/sentinel/observers/gcp-functions.test.ts && git commit -m "$(cat <<'EOF'
feat(sentinel): gcp-functions deltas vs prior observation

Reads the most recent gcp-functions observation from sentinel.db, matches
on function name, and emits nonzero delta_<slug>_invocations /
delta_<slug>_errors metrics. Disappeared/new function names safely no-op
(no shared key, no delta).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Summary text composition + error-propagation tests

**Files:**

- Modify: `/Users/vero/openclaw/src/sentinel/observers/gcp-functions.ts`
- Modify: `/Users/vero/openclaw/tests/sentinel/observers/gcp-functions.test.ts`

- [ ] **Step 1: Write failing tests**

Append:

```typescript
describe("createGcpFunctionsObserver — summary text", () => {
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

  it("zero-errors summary", async () => {
    const client = makeFakeClient({
      bomQuoteNotifier: [
        { timestamp: "2026-06-17T20:30:00Z", severity: "INFO", text: "ok" },
        { timestamp: "2026-06-17T20:31:00Z", severity: "INFO", text: "ok" },
      ],
    });
    const obs = createGcpFunctionsObserver({ db, getClient: async () => client });
    const out = await obs.observe(0);
    expect(out[0].summary).toBe("6 functions: 2 invocations, 0 errors. Window: 2h.");
  });

  it("with-errors summary ranks top contributors by error count", async () => {
    const client = makeFakeClient({
      bomQuoteNotifier: [
        { timestamp: "2026-06-17T20:30:00Z", severity: "ERROR", text: "a" },
        { timestamp: "2026-06-17T20:31:00Z", severity: "ERROR", text: "b" },
      ],
      ghlFirestoreIngest: [{ timestamp: "2026-06-17T20:45:00Z", severity: "ERROR", text: "c" }],
      slackFirestoreIngest: [{ timestamp: "2026-06-17T20:50:00Z", severity: "INFO", text: "ok" }],
    });
    const obs = createGcpFunctionsObserver({ db, getClient: async () => client });
    const out = await obs.observe(0);
    expect(out[0].summary).toMatch(/^6 functions: 4 invocations, 3 errors /);
    expect(out[0].summary).toContain("bomQuoteNotifier 2");
    expect(out[0].summary).toContain("ghlFirestoreIngest 1");
    // Ranking: bom (2) before ghl (1)
    const bomIdx = out[0].summary.indexOf("bomQuoteNotifier");
    const ghlIdx = out[0].summary.indexOf("ghlFirestoreIngest");
    expect(bomIdx).toBeLessThan(ghlIdx);
  });
});

describe("createGcpFunctionsObserver — error propagation", () => {
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

  it("throws when getClient throws", async () => {
    const obs = createGcpFunctionsObserver({
      db,
      getClient: async () => {
        throw new Error("client init failed");
      },
    });
    await expect(obs.observe(0)).rejects.toThrow(/client init failed/);
  });

  it("throws when any per-function call throws", async () => {
    const client: LoggingLike = {
      listFunctionEntries: async (name) => {
        if (name === "ghlFirestoreIngest") {
          throw new Error("logging boom");
        }
        return [];
      },
    };
    const obs = createGcpFunctionsObserver({ db, getClient: async () => client });
    await expect(obs.observe(0)).rejects.toThrow(/logging boom/);
  });
});
```

- [ ] **Step 2: Run tests to verify FAIL**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/gcp-functions.test.ts
```

Expected: FAIL — current summary is the simple fixed-form string. Error-propagation tests already pass (rejection cascades naturally).

- [ ] **Step 3: Implement summary composer**

Add module-level helper in `/Users/vero/openclaw/src/sentinel/observers/gcp-functions.ts`:

```typescript
function composeSummary(opts: {
  functionCount: number;
  invocationsTotal: number;
  errorsTotal: number;
  functions: Array<{ name: string; errors: number }>;
}): string {
  const head = `${opts.functionCount} functions: ${opts.invocationsTotal} invocations, ${opts.errorsTotal} errors`;
  if (opts.errorsTotal === 0) {
    return `${head}. Window: 2h.`;
  }
  const topErrors = opts.functions
    .filter((f) => f.errors > 0)
    .toSorted((a, b) => b.errors - a.errors)
    .slice(0, 4)
    .map((f) => `${f.name} ${f.errors}`)
    .join(", ");
  return `${head} (${topErrors}). Window: 2h.`;
}
```

Replace the inline `summary:` line in the returned observation with:

```typescript
          summary: composeSummary({
            functionCount: functions.length,
            invocationsTotal: invocations_total,
            errorsTotal: errors_total,
            functions: functions.map((f) => ({ name: f.name, errors: f.errors })),
          }),
```

- [ ] **Step 4: Run tests to verify PASS**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/gcp-functions.test.ts
```

Expected: PASS (14/14).

- [ ] **Step 5: Commit**

```bash
cd /Users/vero/openclaw && git add src/sentinel/observers/gcp-functions.ts tests/sentinel/observers/gcp-functions.test.ts && git commit -m "$(cat <<'EOF'
feat(sentinel): gcp-functions summary text + error propagation tests

Zero-errors variant reads "N functions: I invocations, 0 errors. Window: 2h."
With-errors variant appends a top-4 ranked phrase by error count.
Error tests pin the contract: getClient throws and per-function throws
both propagate cleanly so runObservers can record and retry.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Default Cloud Logging client via ADC

**Files:**

- Modify: `/Users/vero/openclaw/src/sentinel/observers/gcp-functions.ts`
- Modify: `/Users/vero/openclaw/tests/sentinel/observers/gcp-functions.test.ts`

- [ ] **Step 1: Write failing test for lazy cached default client**

Append:

```typescript
describe("createGcpFunctionsObserver — default Logging client", () => {
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

  it("calls clientFactory once and caches the client across cycles", async () => {
    let clientBuilds = 0;
    const obs = createGcpFunctionsObserver({
      db,
      clientFactory: () => {
        clientBuilds++;
        return makeFakeClient();
      },
    });
    await obs.observe(0);
    await obs.observe(0);
    expect(clientBuilds).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify FAIL**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/gcp-functions.test.ts
```

Expected: FAIL — `clientFactory` isn't wired yet; the observer's `getClient` fallback throws.

- [ ] **Step 3: Implement default ADC client factory + lazy cache**

In `/Users/vero/openclaw/src/sentinel/observers/gcp-functions.ts`, add module-level constant + default factory above `createGcpFunctionsObserver`:

```typescript
const GCP_FUNCTIONS_PROJECT_ID = "openclaw-mail-bridge";

async function defaultClientFactoryAsync(): Promise<LoggingLike> {
  const { Logging } = await import("@google-cloud/logging");
  const logging = new Logging({ projectId: GCP_FUNCTIONS_PROJECT_ID });

  return {
    async listFunctionEntries(serviceName: string, sinceIso: string): Promise<LogEntry[]> {
      const filter =
        `((resource.type="cloud_run_revision" AND resource.labels.service_name="${serviceName}") ` +
        `OR (resource.type="cloud_function" AND resource.labels.function_name="${serviceName}")) ` +
        `AND timestamp >= "${sinceIso}"`;
      const [entries] = await logging.getEntries({
        filter,
        orderBy: "timestamp desc",
        pageSize: 1000,
      });
      return entries.map((e) => {
        const meta = (e.metadata ?? {}) as {
          timestamp?: string | { seconds?: number | string; nanos?: number };
          severity?: string;
        };
        let timestamp: string;
        if (typeof meta.timestamp === "string") {
          timestamp = meta.timestamp;
        } else if (
          meta.timestamp &&
          typeof meta.timestamp === "object" &&
          "seconds" in meta.timestamp
        ) {
          const seconds = Number(meta.timestamp.seconds ?? 0);
          const nanos = Number(meta.timestamp.nanos ?? 0);
          timestamp = new Date(seconds * 1000 + Math.floor(nanos / 1_000_000)).toISOString();
        } else {
          timestamp = new Date().toISOString();
        }
        const severity = meta.severity ?? "DEFAULT";
        const raw = (e as { data?: unknown }).data;
        const text = typeof raw === "string" ? raw : JSON.stringify(raw ?? {});
        return { timestamp, severity, text };
      });
    },
  };
}
```

Replace `createGcpFunctionsObserver` to use the lazy cached pattern (mirroring coperniq). Keep the existing `observe()` body — only the resolver wraps it:

```typescript
export function createGcpFunctionsObserver(deps: GcpFunctionsObserverDeps): Observer {
  let cachedClient: LoggingLike | null = null;

  async function resolveClient(): Promise<LoggingLike> {
    if (deps.getClient) {
      return deps.getClient();
    }
    if (cachedClient) {
      return cachedClient;
    }
    const factory = deps.clientFactory ?? defaultClientFactoryAsync;
    cachedClient = await factory();
    return cachedClient;
  }

  return {
    name: "gcp-functions",
    async observe(_since: number): Promise<Omit<Observation, "id" | "created_at">[]> {
      const client = await resolveClient();
      // ... existing observe body from Task 5 (window, parallel fetch, tally,
      //     detail, deltas, summary, return) — replacing the old `await getClient()` call
    },
  };
}
```

(Move the rest of the existing `observe()` body inside the new function, dropping the old `const getClient = … throw …` placeholder.)

- [ ] **Step 4: Run tests to verify PASS**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/gcp-functions.test.ts
```

Expected: PASS (15/15).

- [ ] **Step 5: Commit**

```bash
cd /Users/vero/openclaw && git add src/sentinel/observers/gcp-functions.ts tests/sentinel/observers/gcp-functions.test.ts && git commit -m "$(cat <<'EOF'
feat(sentinel): default Cloud Logging client via ADC + impersonation

Lazy, cached @google-cloud/logging client (projectId only) on first
observe(); SDK resolves credentials via ADC + service-account impersonation
already wired on this Mac. Adapter union-filters Gen 2 (cloud_run_revision)
and Gen 1 (cloud_function) resource types so the same observer covers all
six openclaw GCFs regardless of deployment generation. clientFactory is
injectable for tests; getClient remains supported as a full override.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Register the observer in `createSentinel`

**Files:**

- Modify: `/Users/vero/openclaw/src/sentinel/index.ts`

No new unit test — the per-observer tests already cover the observer in isolation. Registration is verified by the typecheck and the full sentinel suite.

- [ ] **Step 1: Register the observer**

Edit `/Users/vero/openclaw/src/sentinel/index.ts`:

Add to the import block (alphabetical with other observer imports):

```typescript
import { createGcpFunctionsObserver } from "./observers/gcp-functions.js";
```

Inside `createSentinel`, after the existing `registry.register(createCoperniqObserver({ db }));` line (the coperniq registration shipped in the prior PR):

```typescript
registry.register(createGcpFunctionsObserver({ db }));
```

- [ ] **Step 2: Verify typecheck + sentinel suite**

```bash
cd /Users/vero/openclaw && pnpm tsgo && pnpm vitest run tests/sentinel
```

Expected: typecheck passes (only pre-existing errors in `src/sentinel/synthesizer.ts:75` and `src/gateway/server.chat.*` remain). Full sentinel suite passes, no regressions.

- [ ] **Step 3: Manual instantiation smoke (no live Logging)**

```bash
cd /Users/vero/openclaw && node --import tsx -e "
import('./src/sentinel/observers/gcp-functions.js').then(async (m) => {
  const { openSentinelDb } = await import('./src/sentinel/db.js');
  const db = openSentinelDb(':memory:');
  const obs = m.createGcpFunctionsObserver({
    db,
    getClient: async () => ({ listFunctionEntries: async () => [] }),
  });
  const out = await obs.observe(0);
  console.log('observer name:', obs.name);
  console.log('emitted:', JSON.stringify(out, null, 2));
});
"
```

Expected: prints `observer name: gcp-functions` and a single observation with `invocations_total: 0, errors_total: 0` and six entries in `data.functions` (all zeros).

- [ ] **Step 4: Commit**

```bash
cd /Users/vero/openclaw && git add src/sentinel/index.ts && git commit -m "$(cat <<'EOF'
feat(sentinel): register gcp-functions observer in createSentinel

Wires createGcpFunctionsObserver({ db }) into ObserverRegistry alongside
coperniq and the Phase A observers. Production uses the default ADC +
impersonation factory; no flag change.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Live smoke on the Mac mini (manual, gated)

**Files:** none (operational verification — no code changes)

Operator-driven. Do not run autonomously.

- [ ] **Step 1: Set `OPENCLAW_SENTINEL_BOOT_CYCLE=1` in `~/.openclaw/.env`** (then revert to 0 after this step).

- [ ] **Step 2: Restart JR**

```bash
launchctl kickstart -k gui/$(id -u)/com.openclaw.agent
```

Wait for `[sentinel] boot-cycle complete` in `/Users/vero/openclaw.log`.

- [ ] **Step 3: Query sentinel.db for the new gcp-functions observation**

```bash
sqlite3 ~/.openclaw/sentinel.db "SELECT timestamp, summary, json_extract(metrics,'$.invocations_total'), json_extract(metrics,'$.errors_total') FROM observations WHERE source='gcp-functions' ORDER BY id DESC LIMIT 1;"
```

Expected: one row with sensible totals. Cross-check against `gcloud logging read` for the same 2h window if numbers look surprising.

- [ ] **Step 4: Restore `OPENCLAW_SENTINEL_BOOT_CYCLE=0`** in `~/.openclaw/.env` so future restarts behave normally.

- [ ] **Step 5: No commit — verification only.**

---

## Spec coverage check

- Component + registration → Tasks 1, 7.
- `LoggingLike` port → Task 1.
- Per-function invocations + errors with severity-set classification → Tasks 1, 2.
- `last_invocation_at` (newest by ts) + `last_error` (newest error-severity, 300-char truncation) → Task 3.
- Delta math vs prior observation → Task 4.
- Summary text (zero-errors variant + top-4 ranked) → Task 5.
- Default ADC Cloud Logging client with Gen 1 + Gen 2 filter union → Task 6.
- Error propagation (throw → runObservers retries) → Task 5 (tests) + Task 7 (relies on existing runner catch).
- No live Cloud Logging in tests → all unit tests use injected `LoggingLike`.
- Manual smoke → Task 8.

## Out of scope (per spec)

- `gmail-watcher` observer (Phase B3, requires Gmail auth setup).
- Per-function latency percentiles, cold-start metrics.
- PII redaction of `last_error` text (mitigation: 300-char truncation + local-only DB).
- Auto-discovery of new GCFs.
