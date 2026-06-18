# Sentinel Phase B — Coperniq Observer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `coperniq` observer that reads project/work-order summaries from Firestore each Sentinel cycle, computes deltas against the prior observation, and emits one observation into `sentinel.db`.

**Architecture:** New file `src/sentinel/observers/coperniq.ts` exporting `createCoperniqObserver(deps)`. Auth via **Application Default Credentials + service-account impersonation** (already wired on the Mac mini; the observer code touches no credentials). One-shot watermark skip via `coperniq_sync_meta/latest.lastSyncAt`. Count grouping over `coperniq_projects` and `coperniq_work_orders`. Changed-doc detail via `where("updatedAt", ">", sinceIso)`. Delta math against the observer's own most recent prior observation read from `sentinel.db`. Registered in `src/sentinel/index.ts` next to the other observers.

**Tech Stack:** TypeScript, `@google-cloud/firestore`, `better-sqlite3`, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-12-sentinel-phase-b-coperniq-observer-design.md`

---

## File structure

| File                                        | Responsibility                                                                                           |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/sentinel/observers/coperniq.ts`        | `createCoperniqObserver(deps)` and the `FirestoreLike` port. Single file — small, focused. No auth code. |
| `tests/sentinel/observers/coperniq.test.ts` | Unit tests with a fake `FirestoreLike` client via DI. No live Firestore.                                 |
| `src/sentinel/index.ts`                     | Register the new observer alongside the others. One-line change.                                         |
| `package.json`                              | Adds `@google-cloud/firestore` dependency (Task 1 — already shipped).                                    |

---

## Verified data-source facts (carried from spec)

- Firestore project: `openclaw-mail-bridge`.
- Collections: `coperniq_projects` (~214 docs, field `status`), `coperniq_work_orders` (~2,768 docs, field `status`).
- Doc timestamps: `updatedAt` is stored as **ISO string** (verified in `/Users/vero/coperniq-ingest/vendor/coperniq-sync-firestore.ts` — all `updatedAt: string`).
- Watermark doc: `coperniq_sync_meta/latest`, with `lastSyncAt: string` (ISO) (verified line 1195 of same file).
- Auth (revised 2026-06-17): **ADC + service-account impersonation** on the Mac mini. `~/.config/gcloud/application_default_credentials.json` (user `jr@veropwr.com`) impersonates `clawbot-openclaw-invoker@openclaw-mail-bridge.iam.gserviceaccount.com`, which holds `roles/datastore.user`, `roles/logging.viewer`, and per-service `run.invoker`. `@google-cloud/firestore` discovers this with zero configuration. End-to-end verified 2026-06-17 against `_health/adc-check`.

---

## Task 1: Add Firestore dependency and define types

**Files:**

- Modify: `/Users/vero/openclaw/package.json`
- Create: `/Users/vero/openclaw/src/sentinel/observers/coperniq.ts`
- Create: `/Users/vero/openclaw/tests/sentinel/observers/coperniq.test.ts`

- [ ] **Step 1: Install dependency**

Run:

```bash
cd /Users/vero/openclaw && pnpm add @google-cloud/firestore
```

Expected: package.json gains `"@google-cloud/firestore"`, pnpm-lock.yaml updated.

- [ ] **Step 2: Write failing import test**

Create `/Users/vero/openclaw/tests/sentinel/observers/coperniq.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  createCoperniqObserver,
  type FirestoreLike,
  type FirestoreCredentials,
} from "../../../src/sentinel/observers/coperniq.js";

describe("coperniq observer module", () => {
  it("exports createCoperniqObserver and the public types", () => {
    expect(typeof createCoperniqObserver).toBe("function");
    const _creds: FirestoreCredentials = { client_email: "x", private_key: "y", project_id: "z" };
    const _client: FirestoreLike = {
      getSyncMeta: async () => null,
      listProjectStatuses: async () => [],
      listWorkOrderStatuses: async () => [],
      listChangedProjects: async () => [],
      listChangedWorkOrders: async () => [],
    };
    expect(_creds.client_email).toBe("x");
    expect(typeof _client.getSyncMeta).toBe("function");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run:

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/coperniq.test.ts
```

Expected: FAIL — cannot import from `../../../src/sentinel/observers/coperniq.js` (file does not exist).

- [ ] **Step 4: Create the observer file with types only**

Create `/Users/vero/openclaw/src/sentinel/observers/coperniq.ts`:

```typescript
import type { Database as DatabaseType } from "better-sqlite3";
import type { Observer } from "../observer.js";
import type { Observation } from "../types.js";

export interface FirestoreCredentials {
  client_email: string;
  private_key: string;
  project_id: string;
}

export interface ProjectStatusRow {
  id: string;
  status: string | null;
  updatedAt?: string;
  title?: string;
}

export interface WorkOrderStatusRow {
  id: string;
  status: string | null;
  updatedAt?: string;
  title?: string;
}

export interface SyncMeta {
  lastSyncAt: string;
}

export interface FirestoreLike {
  getSyncMeta(): Promise<SyncMeta | null>;
  listProjectStatuses(): Promise<ProjectStatusRow[]>;
  listWorkOrderStatuses(): Promise<WorkOrderStatusRow[]>;
  listChangedProjects(sinceIso: string, limit: number): Promise<ProjectStatusRow[]>;
  listChangedWorkOrders(sinceIso: string, limit: number): Promise<WorkOrderStatusRow[]>;
}

export interface CoperniqObserverDeps {
  db: DatabaseType;
  getClient?: () => Promise<FirestoreLike>;
}

export function createCoperniqObserver(_deps: CoperniqObserverDeps): Observer {
  return {
    name: "coperniq",
    async observe(_since: number): Promise<Omit<Observation, "id" | "created_at">[]> {
      return [];
    },
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run:

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/coperniq.test.ts
```

Expected: PASS (1/1).

- [ ] **Step 6: Commit**

```bash
cd /Users/vero/openclaw && git add package.json pnpm-lock.yaml src/sentinel/observers/coperniq.ts tests/sentinel/observers/coperniq.test.ts && git commit -m "$(cat <<'EOF'
feat(sentinel): scaffold coperniq observer module

Adds @google-cloud/firestore dep, exports types and stub createCoperniqObserver
that returns no observations. Subsequent tasks fill in keychain credential
loading, watermark skip, count grouping, deltas, and changed-doc detail.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Drop the unused `FirestoreCredentials` type (ADC pivot)

**Context:** The original draft planned an in-process Keychain credential reader. On 2026-06-17 ADC + service-account impersonation was wired on this Mac, so the observer never sees credentials. Task 1 already shipped a `FirestoreCredentials` exported type — now dead code. Remove it and the related test bindings.

**Files:**

- Modify: `/Users/vero/openclaw/src/sentinel/observers/coperniq.ts`
- Modify: `/Users/vero/openclaw/tests/sentinel/observers/coperniq.test.ts`

- [ ] **Step 1: Remove `FirestoreCredentials` export from the observer**

In `/Users/vero/openclaw/src/sentinel/observers/coperniq.ts`, delete the entire `export interface FirestoreCredentials { … }` block. Leave every other export untouched.

- [ ] **Step 2: Update the test to stop importing the removed type**

In `/Users/vero/openclaw/tests/sentinel/observers/coperniq.test.ts`:

- Remove `type FirestoreCredentials` from the `import { … } from "../../../src/sentinel/observers/coperniq.js"` list.
- Delete the local `creds` construction line and the `creds.client_email` assertion. Keep the rest of the smoke test (factory existence + `FirestoreLike` shape) intact.

The resulting test body should look like:

```typescript
import { describe, it, expect } from "vitest";
import {
  createCoperniqObserver,
  type FirestoreLike,
} from "../../../src/sentinel/observers/coperniq.js";

describe("coperniq observer module", () => {
  it("exports createCoperniqObserver and the FirestoreLike type", () => {
    expect(typeof createCoperniqObserver).toBe("function");
    const client: FirestoreLike = {
      getSyncMeta: async () => null,
      listProjectStatuses: async () => [],
      listWorkOrderStatuses: async () => [],
      listChangedProjects: async () => [],
      listChangedWorkOrders: async () => [],
    };
    expect(typeof client.getSyncMeta).toBe("function");
  });
});
```

- [ ] **Step 3: Run the test**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/coperniq.test.ts
```

Expected: PASS (1/1).

- [ ] **Step 4: Commit**

```bash
cd /Users/vero/openclaw && git add src/sentinel/observers/coperniq.ts tests/sentinel/observers/coperniq.test.ts && git commit -m "$(cat <<'EOF'
refactor(sentinel): drop unused FirestoreCredentials from coperniq observer

Auth is handled by Application Default Credentials + service-account
impersonation (wired 2026-06-17). The observer code never sees credentials,
so the previously-exported FirestoreCredentials type was dead weight.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Watermark skip behavior

**Files:**

- Modify: `/Users/vero/openclaw/src/sentinel/observers/coperniq.ts`
- Modify: `/Users/vero/openclaw/tests/sentinel/observers/coperniq.test.ts`

- [ ] **Step 1: Write failing test — when lastSyncAt matches prior observation, observer returns []**

Append to `tests/sentinel/observers/coperniq.test.ts`:

```typescript
import Database from "better-sqlite3";
import { openSentinelDb } from "../../../src/sentinel/db.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, unlinkSync } from "node:fs";

function tmpSentinelDb(): string {
  return join(
    tmpdir(),
    `sentinel-coperniq-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
}

function cleanup(path: string): void {
  for (const suffix of ["", "-shm", "-wal"]) {
    const f = `${path}${suffix}`;
    if (existsSync(f)) unlinkSync(f);
  }
}

function makeFakeClient(overrides: Partial<FirestoreLike> = {}): FirestoreLike {
  return {
    getSyncMeta: overrides.getSyncMeta ?? (async () => null),
    listProjectStatuses: overrides.listProjectStatuses ?? (async () => []),
    listWorkOrderStatuses: overrides.listWorkOrderStatuses ?? (async () => []),
    listChangedProjects: overrides.listChangedProjects ?? (async () => []),
    listChangedWorkOrders: overrides.listChangedWorkOrders ?? (async () => []),
  };
}

describe("createCoperniqObserver — watermark skip", () => {
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    dbPath = tmpSentinelDb();
    db = openSentinelDb(dbPath);
  });

  afterEach(() => {
    db.close();
    cleanup(dbPath);
  });

  it("returns [] when lastSyncAt matches the prior observation's lastSyncAt", async () => {
    const lastSyncAt = "2026-06-17T12:00:00.000Z";
    // seed a prior observation
    db.prepare(
      `INSERT INTO observations (source, topic, timestamp, summary, data, metrics, created_at) VALUES (?,?,?,?,?,?,?)`,
    ).run(
      "coperniq",
      "coperniq-ops",
      Date.now() - 60_000,
      "prior",
      JSON.stringify({ lastSyncAt, projectStatusCounts: {}, woStatusCounts: {} }),
      JSON.stringify({ projects_total: 0, work_orders_total: 0 }),
      Date.now() - 60_000,
    );

    let metaRead = 0;
    let collectionsRead = 0;
    const client = makeFakeClient({
      getSyncMeta: async () => {
        metaRead++;
        return { lastSyncAt };
      },
      listProjectStatuses: async () => {
        collectionsRead++;
        return [];
      },
      listWorkOrderStatuses: async () => {
        collectionsRead++;
        return [];
      },
    });

    const obs = createCoperniqObserver({ db, getClient: async () => client });
    const out = await obs.observe(0);

    expect(out).toEqual([]);
    expect(metaRead).toBe(1); // proves we actually checked the watermark
    expect(collectionsRead).toBe(0); // proves we skipped before reading collections
  });
});
```

(Also add the missing top imports to the test file:)

```typescript
import { beforeEach, afterEach } from "vitest";
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/coperniq.test.ts
```

Expected: FAIL — `metaRead` is 0 because the current stub never calls the client.

- [ ] **Step 3: Implement watermark skip**

Replace the stubbed `createCoperniqObserver` in `src/sentinel/observers/coperniq.ts`:

```typescript
interface PriorObservation {
  lastSyncAt: string | null;
  projectStatusCounts: Record<string, number>;
  woStatusCounts: Record<string, number>;
}

function readPriorObservation(db: DatabaseType): PriorObservation | null {
  const row = db
    .prepare(`SELECT data FROM observations WHERE source = 'coperniq' ORDER BY id DESC LIMIT 1`)
    .get() as { data: string | null } | undefined;
  if (!row?.data) return null;
  try {
    const parsed = JSON.parse(row.data) as Partial<PriorObservation>;
    return {
      lastSyncAt: parsed.lastSyncAt ?? null,
      projectStatusCounts: parsed.projectStatusCounts ?? {},
      woStatusCounts: parsed.woStatusCounts ?? {},
    };
  } catch {
    return null;
  }
}

export function createCoperniqObserver(deps: CoperniqObserverDeps): Observer {
  return {
    name: "coperniq",
    async observe(_since: number): Promise<Omit<Observation, "id" | "created_at">[]> {
      const getClient =
        deps.getClient ??
        (async () => {
          throw new Error("default Firestore client not yet wired (see Task 8 in plan)");
        });
      const client = await getClient();
      const meta = await client.getSyncMeta();
      const prior = readPriorObservation(deps.db);

      if (meta && prior && meta.lastSyncAt === prior.lastSyncAt) {
        return []; // watermark skip — no new ingest since last cycle
      }

      // Subsequent tasks: read collections, compute deltas, emit observation
      return [];
    },
  };
}
```

- [ ] **Step 4: Run all observer tests**

Run:

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/coperniq.test.ts
```

Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
cd /Users/vero/openclaw && git add src/sentinel/observers/coperniq.ts tests/sentinel/observers/coperniq.test.ts && git commit -m "$(cat <<'EOF'
feat(sentinel): coperniq watermark skip — no-op when lastSyncAt unchanged

Reads the most recent coperniq observation from sentinel.db and the current
coperniq_sync_meta/latest.lastSyncAt. If they match, observe() returns []
without reading the projects/work_orders collections.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: First-run snapshot — counts with no deltas

**Files:**

- Modify: `/Users/vero/openclaw/src/sentinel/observers/coperniq.ts`
- Modify: `/Users/vero/openclaw/tests/sentinel/observers/coperniq.test.ts`

- [ ] **Step 1: Write failing test — no prior observation → emits single observation with counts**

Append:

```typescript
describe("createCoperniqObserver — first-run snapshot", () => {
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    dbPath = tmpSentinelDb();
    db = openSentinelDb(dbPath);
  });

  afterEach(() => {
    db.close();
    cleanup(dbPath);
  });

  it("emits one observation with counts when there is no prior observation", async () => {
    const client = makeFakeClient({
      getSyncMeta: async () => ({ lastSyncAt: "2026-06-17T12:00:00.000Z" }),
      listProjectStatuses: async () => [
        { id: "p1", status: "in_progress" },
        { id: "p2", status: "in_progress" },
        { id: "p3", status: "complete" },
      ],
      listWorkOrderStatuses: async () => [
        { id: "w1", status: "assigned" },
        { id: "w2", status: "done" },
        { id: "w3", status: "done" },
        { id: "w4", status: "done" },
      ],
    });

    const obs = createCoperniqObserver({ db, getClient: async () => client });
    const out = await obs.observe(0);

    expect(out).toHaveLength(1);
    const o = out[0];
    expect(o.source).toBe("coperniq");
    expect(o.topic).toBe("coperniq-ops");
    expect(o.metrics).toMatchObject({
      projects_total: 3,
      work_orders_total: 4,
      project_status_in_progress: 2,
      project_status_complete: 1,
      wo_status_assigned: 1,
      wo_status_done: 3,
    });
    // First run: no delta metrics
    const metricKeys = Object.keys(o.metrics ?? {});
    expect(metricKeys.some((k) => k.startsWith("delta_"))).toBe(false);
    // data carries the full count maps + lastSyncAt
    expect(o.data).toMatchObject({
      lastSyncAt: "2026-06-17T12:00:00.000Z",
      projectStatusCounts: { in_progress: 2, complete: 1 },
      woStatusCounts: { assigned: 1, done: 3 },
    });
  });

  it("treats null/undefined status as 'unknown'", async () => {
    const client = makeFakeClient({
      getSyncMeta: async () => ({ lastSyncAt: "2026-06-17T12:00:00.000Z" }),
      listProjectStatuses: async () => [
        { id: "p1", status: null },
        { id: "p2", status: "complete" },
      ],
      listWorkOrderStatuses: async () => [],
    });
    const obs = createCoperniqObserver({ db, getClient: async () => client });
    const out = await obs.observe(0);
    expect(out[0].metrics).toMatchObject({
      project_status_unknown: 1,
      project_status_complete: 1,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/coperniq.test.ts
```

Expected: FAIL — observer returns `[]` instead of an observation.

- [ ] **Step 3: Implement count grouping and observation assembly**

Replace the trailing `return []` in `observe` and add helpers in `src/sentinel/observers/coperniq.ts`:

```typescript
function slugifyStatus(s: string | null | undefined): string {
  const raw = (s ?? "unknown").toString().trim() || "unknown";
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "unknown"
  );
}

function tallyByStatus(rows: Array<{ status: string | null }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const key = slugifyStatus(r.status);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function flattenCounts(prefix: string, counts: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(counts)) {
    out[`${prefix}_${k}`] = v;
  }
  return out;
}
```

Replace the body of `observe` after the watermark-skip block with:

```typescript
const projectRows = await client.listProjectStatuses();
const woRows = await client.listWorkOrderStatuses();

const projectStatusCounts = tallyByStatus(projectRows);
const woStatusCounts = tallyByStatus(woRows);

const metrics: Record<string, number> = {
  projects_total: projectRows.length,
  work_orders_total: woRows.length,
  ...flattenCounts("project_status", projectStatusCounts),
  ...flattenCounts("wo_status", woStatusCounts),
};

return [
  {
    source: "coperniq",
    topic: "coperniq-ops",
    timestamp: Date.now(),
    summary: `${projectRows.length} projects, ${woRows.length} work orders.`,
    data: {
      lastSyncAt: meta?.lastSyncAt ?? null,
      projectStatusCounts,
      woStatusCounts,
      changedProjects: [],
      changedWorkOrders: [],
    },
    metrics,
  },
];
```

- [ ] **Step 4: Run all observer tests**

Run:

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/coperniq.test.ts
```

Expected: PASS (8/8).

- [ ] **Step 5: Commit**

```bash
cd /Users/vero/openclaw && git add src/sentinel/observers/coperniq.ts tests/sentinel/observers/coperniq.test.ts && git commit -m "$(cat <<'EOF'
feat(sentinel): coperniq first-run snapshot — project + WO counts

Reads coperniq_projects and coperniq_work_orders via the injected client,
groups by status (slugified, null → 'unknown'), and emits one observation
with totals and per-status counts in metrics + raw maps in data.lastSyncAt
captured for next cycle's watermark comparison.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Delta math against prior observation

**Files:**

- Modify: `/Users/vero/openclaw/src/sentinel/observers/coperniq.ts`
- Modify: `/Users/vero/openclaw/tests/sentinel/observers/coperniq.test.ts`

- [ ] **Step 1: Write failing test — deltas appear when a prior observation exists with different counts**

Append:

```typescript
describe("createCoperniqObserver — deltas", () => {
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    dbPath = tmpSentinelDb();
    db = openSentinelDb(dbPath);
  });

  afterEach(() => {
    db.close();
    cleanup(dbPath);
  });

  it("emits delta metrics relative to the most recent prior observation", async () => {
    // seed prior: 2 in_progress, 1 complete projects; 5 assigned, 10 done WOs
    db.prepare(
      `INSERT INTO observations (source, topic, timestamp, summary, data, metrics, created_at) VALUES (?,?,?,?,?,?,?)`,
    ).run(
      "coperniq",
      "coperniq-ops",
      Date.now() - 7200_000,
      "prior",
      JSON.stringify({
        lastSyncAt: "2026-06-17T10:00:00.000Z",
        projectStatusCounts: { in_progress: 2, complete: 1 },
        woStatusCounts: { assigned: 5, done: 10 },
      }),
      JSON.stringify({}),
      Date.now() - 7200_000,
    );

    // current: 1 in_progress, 2 complete projects; 3 assigned, 12 done WOs (one new WO status appears: review:1)
    const client = makeFakeClient({
      getSyncMeta: async () => ({ lastSyncAt: "2026-06-17T12:00:00.000Z" }),
      listProjectStatuses: async () => [
        { id: "p1", status: "in_progress" },
        { id: "p2", status: "complete" },
        { id: "p3", status: "complete" },
      ],
      listWorkOrderStatuses: async () => [
        ...Array.from({ length: 3 }, (_, i) => ({ id: `a${i}`, status: "assigned" })),
        ...Array.from({ length: 12 }, (_, i) => ({ id: `d${i}`, status: "done" })),
        { id: "r1", status: "review" },
      ],
    });

    const obs = createCoperniqObserver({ db, getClient: async () => client });
    const out = await obs.observe(0);
    expect(out).toHaveLength(1);

    const m = out[0].metrics ?? {};
    // project deltas: in_progress 2→1 (-1), complete 1→2 (+1)
    expect(m.delta_project_status_in_progress).toBe(-1);
    expect(m.delta_project_status_complete).toBe(1);
    // wo deltas: assigned 5→3 (-2), done 10→12 (+2), review 0→1 (+1)
    expect(m.delta_wo_status_assigned).toBe(-2);
    expect(m.delta_wo_status_done).toBe(2);
    expect(m.delta_wo_status_review).toBe(1);
  });

  it("does not include zero-delta keys", async () => {
    db.prepare(
      `INSERT INTO observations (source, topic, timestamp, summary, data, metrics, created_at) VALUES (?,?,?,?,?,?,?)`,
    ).run(
      "coperniq",
      "coperniq-ops",
      Date.now() - 1000,
      "prior",
      JSON.stringify({
        lastSyncAt: "2026-06-17T10:00:00.000Z",
        projectStatusCounts: { in_progress: 2 },
        woStatusCounts: { done: 5 },
      }),
      JSON.stringify({}),
      Date.now() - 1000,
    );

    const client = makeFakeClient({
      getSyncMeta: async () => ({ lastSyncAt: "2026-06-17T12:00:00.000Z" }),
      listProjectStatuses: async () => [
        { id: "p1", status: "in_progress" },
        { id: "p2", status: "in_progress" },
      ],
      listWorkOrderStatuses: async () =>
        Array.from({ length: 5 }, (_, i) => ({ id: `d${i}`, status: "done" })),
    });

    const obs = createCoperniqObserver({ db, getClient: async () => client });
    const out = await obs.observe(0);
    const metricKeys = Object.keys(out[0].metrics ?? {});
    expect(metricKeys.some((k) => k.startsWith("delta_"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/coperniq.test.ts
```

Expected: FAIL — observer doesn't yet compute deltas; `delta_*` keys are undefined.

- [ ] **Step 3: Implement delta math**

Add helper to `src/sentinel/observers/coperniq.ts`:

```typescript
function computeDeltas(
  prefix: string,
  current: Record<string, number>,
  prior: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  const keys = new Set([...Object.keys(current), ...Object.keys(prior)]);
  for (const k of keys) {
    const delta = (current[k] ?? 0) - (prior[k] ?? 0);
    if (delta !== 0) {
      out[`delta_${prefix}_${k}`] = delta;
    }
  }
  return out;
}
```

In the `observe` body, after constructing `metrics` and before the `return`, weave in deltas when a prior exists:

```typescript
if (prior) {
  Object.assign(
    metrics,
    computeDeltas("project_status", projectStatusCounts, prior.projectStatusCounts),
    computeDeltas("wo_status", woStatusCounts, prior.woStatusCounts),
  );
}
```

- [ ] **Step 4: Run all observer tests**

Run:

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/coperniq.test.ts
```

Expected: PASS (10/10).

- [ ] **Step 5: Commit**

```bash
cd /Users/vero/openclaw && git add src/sentinel/observers/coperniq.ts tests/sentinel/observers/coperniq.test.ts && git commit -m "$(cat <<'EOF'
feat(sentinel): coperniq deltas vs prior observation

Compares current per-status counts against the most recent prior coperniq
observation read from sentinel.db. Emits nonzero deltas only as
delta_project_status_<slug> / delta_wo_status_<slug> metrics.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Changed-doc detail (capped at 50 each)

**Files:**

- Modify: `/Users/vero/openclaw/src/sentinel/observers/coperniq.ts`
- Modify: `/Users/vero/openclaw/tests/sentinel/observers/coperniq.test.ts`

- [ ] **Step 1: Write failing test — changed docs captured into `data`, capped at 50 per collection**

Append:

```typescript
describe("createCoperniqObserver — changed-doc detail", () => {
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    dbPath = tmpSentinelDb();
    db = openSentinelDb(dbPath);
  });

  afterEach(() => {
    db.close();
    cleanup(dbPath);
  });

  it("queries listChangedProjects/WorkOrders with sinceIso derived from `since` arg, cap 50", async () => {
    const sinceMs = Date.UTC(2026, 5, 16, 0, 0, 0); // 2026-06-16T00:00:00.000Z
    let projectQueryArgs: { sinceIso: string; limit: number } | null = null;
    let woQueryArgs: { sinceIso: string; limit: number } | null = null;

    const client = makeFakeClient({
      getSyncMeta: async () => ({ lastSyncAt: "2026-06-17T12:00:00.000Z" }),
      listProjectStatuses: async () => [],
      listWorkOrderStatuses: async () => [],
      listChangedProjects: async (sinceIso, limit) => {
        projectQueryArgs = { sinceIso, limit };
        return [
          { id: "p1", status: "complete", title: "Doe roof" },
          { id: "p2", status: "in_progress", title: "Smith roof" },
        ];
      },
      listChangedWorkOrders: async (sinceIso, limit) => {
        woQueryArgs = { sinceIso, limit };
        return [{ id: "w1", status: "done", title: "Install crew dispatch" }];
      },
    });

    const obs = createCoperniqObserver({ db, getClient: async () => client });
    const out = await obs.observe(sinceMs);

    expect(projectQueryArgs).toEqual({ sinceIso: "2026-06-16T00:00:00.000Z", limit: 50 });
    expect(woQueryArgs).toEqual({ sinceIso: "2026-06-16T00:00:00.000Z", limit: 50 });

    const data = out[0].data as { changedProjects: unknown[]; changedWorkOrders: unknown[] };
    expect(data.changedProjects).toHaveLength(2);
    expect(data.changedWorkOrders).toHaveLength(1);
    expect(out[0].metrics).toMatchObject({ projects_changed: 2, wos_changed: 1 });
  });

  it("does not call listChanged* when since=0 (first observation ever)", async () => {
    let called = false;
    const client = makeFakeClient({
      getSyncMeta: async () => ({ lastSyncAt: "2026-06-17T12:00:00.000Z" }),
      listProjectStatuses: async () => [],
      listWorkOrderStatuses: async () => [],
      listChangedProjects: async () => {
        called = true;
        return [];
      },
      listChangedWorkOrders: async () => {
        called = true;
        return [];
      },
    });
    const obs = createCoperniqObserver({ db, getClient: async () => client });
    const out = await obs.observe(0);
    expect(called).toBe(false);
    expect(out[0].metrics).toMatchObject({ projects_changed: 0, wos_changed: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/coperniq.test.ts
```

Expected: FAIL — observer never invokes `listChangedProjects`/`listChangedWorkOrders`; data has empty arrays.

- [ ] **Step 3: Implement changed-doc fetch**

In `src/sentinel/observers/coperniq.ts`, add the fetch + skip-when-since-zero logic to `observe` (after counts and before `metrics` assembly):

```typescript
let changedProjects: ProjectStatusRow[] = [];
let changedWorkOrders: WorkOrderStatusRow[] = [];
if (_since > 0) {
  const sinceIso = new Date(_since).toISOString();
  changedProjects = await client.listChangedProjects(sinceIso, 50);
  changedWorkOrders = await client.listChangedWorkOrders(sinceIso, 50);
}
```

Rename the parameter `_since` to `since` (drop the leading underscore — now used).

Update the metrics object to include the counts:

```typescript
const metrics: Record<string, number> = {
  projects_total: projectRows.length,
  work_orders_total: woRows.length,
  projects_changed: changedProjects.length,
  wos_changed: changedWorkOrders.length,
  ...flattenCounts("project_status", projectStatusCounts),
  ...flattenCounts("wo_status", woStatusCounts),
};
```

And update the `data` block in the returned observation:

```typescript
          data: {
            lastSyncAt: meta?.lastSyncAt ?? null,
            projectStatusCounts,
            woStatusCounts,
            changedProjects,
            changedWorkOrders,
          },
```

- [ ] **Step 4: Run all observer tests**

Run:

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/coperniq.test.ts
```

Expected: PASS (12/12).

- [ ] **Step 5: Commit**

```bash
cd /Users/vero/openclaw && git add src/sentinel/observers/coperniq.ts tests/sentinel/observers/coperniq.test.ts && git commit -m "$(cat <<'EOF'
feat(sentinel): coperniq changed-doc detail capture (cap 50)

When the runner-supplied since>0, queries listChangedProjects and
listChangedWorkOrders with limit=50 each, capturing changed-doc rows
into observation.data. since=0 (first-ever observation) skips the
queries; counts surface as projects_changed / wos_changed metrics.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Summary text composition and error propagation

**Files:**

- Modify: `/Users/vero/openclaw/src/sentinel/observers/coperniq.ts`
- Modify: `/Users/vero/openclaw/tests/sentinel/observers/coperniq.test.ts`

- [ ] **Step 1: Write failing tests for summary format and for thrown errors**

Append:

```typescript
describe("createCoperniqObserver — summary text", () => {
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    dbPath = tmpSentinelDb();
    db = openSentinelDb(dbPath);
  });
  afterEach(() => {
    db.close();
    cleanup(dbPath);
  });

  it("composes a human-readable summary with totals and a delta phrase when deltas exist", async () => {
    db.prepare(
      `INSERT INTO observations (source, topic, timestamp, summary, data, metrics, created_at) VALUES (?,?,?,?,?,?,?)`,
    ).run(
      "coperniq",
      "coperniq-ops",
      Date.now() - 1000,
      "prior",
      JSON.stringify({
        lastSyncAt: "2026-06-17T10:00:00.000Z",
        projectStatusCounts: { in_progress: 2 },
        woStatusCounts: { done: 10, assigned: 5 },
      }),
      JSON.stringify({}),
      Date.now() - 1000,
    );

    const client = makeFakeClient({
      getSyncMeta: async () => ({ lastSyncAt: "2026-06-17T12:00:00.000Z" }),
      listProjectStatuses: async () => [
        { id: "p1", status: "in_progress" },
        { id: "p2", status: "in_progress" },
        { id: "p3", status: "complete" },
      ],
      listWorkOrderStatuses: async () => [
        ...Array.from({ length: 12 }, (_, i) => ({ id: `d${i}`, status: "done" })),
        ...Array.from({ length: 3 }, (_, i) => ({ id: `a${i}`, status: "assigned" })),
      ],
    });

    const obs = createCoperniqObserver({ db, getClient: async () => client });
    const out = await obs.observe(0);

    expect(out[0].summary).toContain("3 projects");
    expect(out[0].summary).toContain("15 work orders");
    // delta phrase mentions at least one nonzero change
    expect(out[0].summary).toMatch(/(\+|−|-)\d+/);
  });

  it("first-run summary has no delta phrase", async () => {
    const client = makeFakeClient({
      getSyncMeta: async () => ({ lastSyncAt: "2026-06-17T12:00:00.000Z" }),
      listProjectStatuses: async () => [{ id: "p1", status: "complete" }],
      listWorkOrderStatuses: async () => [],
    });
    const obs = createCoperniqObserver({ db, getClient: async () => client });
    const out = await obs.observe(0);
    expect(out[0].summary).toMatch(/^1 project/);
    expect(out[0].summary).not.toMatch(/since last/i);
  });
});

describe("createCoperniqObserver — error propagation", () => {
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    dbPath = tmpSentinelDb();
    db = openSentinelDb(dbPath);
  });
  afterEach(() => {
    db.close();
    cleanup(dbPath);
  });

  it("throws when getClient throws (keychain unreadable)", async () => {
    const obs = createCoperniqObserver({
      db,
      getClient: async () => {
        throw new Error("keychain unavailable");
      },
    });
    await expect(obs.observe(0)).rejects.toThrow(/keychain unavailable/);
  });

  it("throws when a collection read throws", async () => {
    const obs = createCoperniqObserver({
      db,
      getClient: async () =>
        makeFakeClient({
          getSyncMeta: async () => ({ lastSyncAt: "x" }),
          listProjectStatuses: async () => {
            throw new Error("firestore boom");
          },
        }),
    });
    await expect(obs.observe(0)).rejects.toThrow(/firestore boom/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/coperniq.test.ts
```

Expected: FAIL — current summary is `"N projects, M work orders."` and contains no delta phrase. Error tests likely pass already (because `await client.foo()` already throws).

- [ ] **Step 3: Implement summary composition**

Add helper to `src/sentinel/observers/coperniq.ts`:

```typescript
function pluralize(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function composeSummary(opts: {
  projectsTotal: number;
  woTotal: number;
  projectsChanged: number;
  wosChanged: number;
  deltas: Record<string, number>;
  isFirstRun: boolean;
}): string {
  const head = `${pluralize(opts.projectsTotal, "project")}, ${pluralize(opts.woTotal, "work order")}.`;
  if (opts.isFirstRun) return head;
  const nonzero = Object.entries(opts.deltas)
    .filter(([, v]) => v !== 0)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 4)
    .map(([k, v]) => {
      const sign = v > 0 ? "+" : "−"; // U+2212 to read cleanly in Slack
      const label = k.replace(/^delta_(project|wo)_status_/, "");
      return `${sign}${Math.abs(v)} ${label}`;
    });
  const changedPhrase = `${opts.projectsChanged} projects and ${opts.wosChanged} work orders changed since last sync`;
  if (nonzero.length === 0) {
    return `${head} ${changedPhrase}.`;
  }
  return `${head} ${changedPhrase} (${nonzero.join(", ")}).`;
}
```

Replace the inline `summary:` line in the returned observation with:

```typescript
          summary: composeSummary({
            projectsTotal: projectRows.length,
            woTotal: woRows.length,
            projectsChanged: changedProjects.length,
            wosChanged: changedWorkOrders.length,
            deltas: Object.fromEntries(
              Object.entries(metrics).filter(([k]) => k.startsWith("delta_")),
            ) as Record<string, number>,
            isFirstRun: prior === null,
          }),
```

- [ ] **Step 4: Run all observer tests**

Run:

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/coperniq.test.ts
```

Expected: PASS (16/16).

- [ ] **Step 5: Commit**

```bash
cd /Users/vero/openclaw && git add src/sentinel/observers/coperniq.ts tests/sentinel/observers/coperniq.test.ts && git commit -m "$(cat <<'EOF'
feat(sentinel): coperniq summary text + error propagation tests

Summary mentions totals plus a delta phrase ranked by absolute change
(top 4). First-run summary has no delta phrase. Tests cover client
errors (keychain unavailable, collection read failure) propagating to
the runner — runObservers' per-observer catch handles them.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Default Firestore client (lazy, cached) via ADC

**Context:** Auth is ADC + impersonation, already wired on the Mac mini. The observer constructs a `Firestore` client with only `projectId` — the SDK reads `~/.config/gcloud/application_default_credentials.json` and impersonates the configured SA. No credential code in the observer.

**Files:**

- Modify: `/Users/vero/openclaw/src/sentinel/observers/coperniq.ts`
- Modify: `/Users/vero/openclaw/tests/sentinel/observers/coperniq.test.ts`

- [ ] **Step 1: Write failing test — lazy default client + caching across cycles**

Append:

```typescript
describe("createCoperniqObserver — default Firestore client", () => {
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    dbPath = tmpSentinelDb();
    db = openSentinelDb(dbPath);
  });
  afterEach(() => {
    db.close();
    cleanup(dbPath);
  });

  it("calls the supplied clientFactory exactly once and caches the client across cycles", async () => {
    let clientBuilds = 0;

    const obs = createCoperniqObserver({
      db,
      clientFactory: () => {
        clientBuilds++;
        return makeFakeClient({
          getSyncMeta: async () => ({ lastSyncAt: "2026-06-17T12:00:00.000Z" }),
          listProjectStatuses: async () => [],
          listWorkOrderStatuses: async () => [],
        });
      },
    });

    await obs.observe(0);
    await obs.observe(0);
    expect(clientBuilds).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/coperniq.test.ts
```

Expected: FAIL — `clientFactory` is not in `CoperniqObserverDeps`.

- [ ] **Step 3: Extend deps + implement default ADC client factory**

In `src/sentinel/observers/coperniq.ts`:

Replace `CoperniqObserverDeps`:

```typescript
export interface CoperniqObserverDeps {
  db: DatabaseType;
  getClient?: () => Promise<FirestoreLike>;
  clientFactory?: () => Promise<FirestoreLike> | FirestoreLike;
}
```

Add the default ADC factory:

```typescript
const COPERNIQ_FIRESTORE_PROJECT_ID = "openclaw-mail-bridge";

async function defaultClientFactoryAsync(): Promise<FirestoreLike> {
  const { Firestore } = await import("@google-cloud/firestore");
  const fs = new Firestore({ projectId: COPERNIQ_FIRESTORE_PROJECT_ID });

  return {
    async getSyncMeta() {
      const doc = await fs.collection("coperniq_sync_meta").doc("latest").get();
      const data = doc.data();
      if (!data || typeof data.lastSyncAt !== "string") return null;
      return { lastSyncAt: data.lastSyncAt };
    },
    async listProjectStatuses() {
      const snap = await fs.collection("coperniq_projects").select("status").get();
      return snap.docs.map((d) => ({
        id: d.id,
        status: (d.get("status") as string | null) ?? null,
      }));
    },
    async listWorkOrderStatuses() {
      const snap = await fs.collection("coperniq_work_orders").select("status").get();
      return snap.docs.map((d) => ({
        id: d.id,
        status: (d.get("status") as string | null) ?? null,
      }));
    },
    async listChangedProjects(sinceIso, limit) {
      const snap = await fs
        .collection("coperniq_projects")
        .where("updatedAt", ">", sinceIso)
        .limit(limit)
        .get();
      return snap.docs.map((d) => ({
        id: d.id,
        status: (d.get("status") as string | null) ?? null,
        updatedAt: d.get("updatedAt") as string | undefined,
        title: d.get("title") as string | undefined,
      }));
    },
    async listChangedWorkOrders(sinceIso, limit) {
      const snap = await fs
        .collection("coperniq_work_orders")
        .where("updatedAt", ">", sinceIso)
        .limit(limit)
        .get();
      return snap.docs.map((d) => ({
        id: d.id,
        status: (d.get("status") as string | null) ?? null,
        updatedAt: d.get("updatedAt") as string | undefined,
        title: d.get("title") as string | undefined,
      }));
    },
  };
}
```

Replace `createCoperniqObserver` to use the lazy cached default:

```typescript
export function createCoperniqObserver(deps: CoperniqObserverDeps): Observer {
  let cachedClient: FirestoreLike | null = null;

  async function resolveClient(): Promise<FirestoreLike> {
    if (deps.getClient) return deps.getClient();
    if (cachedClient) return cachedClient;
    const factory = deps.clientFactory ?? defaultClientFactoryAsync;
    cachedClient = await factory();
    return cachedClient;
  }

  return {
    name: "coperniq",
    async observe(since: number): Promise<Omit<Observation, "id" | "created_at">[]> {
      const client = await resolveClient();
      // ... existing observe body (watermark check, counts, deltas, summary, return)
    },
  };
}
```

(Move all the existing `observe` logic into this new body, replacing the previous direct `getClient` call.)

- [ ] **Step 4: Run all observer tests**

Run:

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/coperniq.test.ts
```

Expected: PASS (test count: previous total + 1).

- [ ] **Step 5: Commit**

```bash
cd /Users/vero/openclaw && git add src/sentinel/observers/coperniq.ts tests/sentinel/observers/coperniq.test.ts && git commit -m "$(cat <<'EOF'
feat(sentinel): default Firestore client via ADC + impersonation

Lazy, cached @google-cloud/firestore client (projectId only) on first
observe(); the Google SDK resolves credentials via ADC + service-account
impersonation already wired on this Mac. clientFactory is injectable for
tests; getClient remains supported as a full override. No credential
material in the observer process.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Register the observer in `createSentinel`

**Files:**

- Modify: `/Users/vero/openclaw/src/sentinel/index.ts`

No new unit test — the per-observer tests already cover the observer in isolation, and `createSentinel` has no dedicated test harness to extend without scaffolding one. Registration is verified by Step 4's manual instantiation smoke and the typecheck in Step 3.

- [ ] **Step 1: Register the observer in `src/sentinel/index.ts`**

Edit the import block (alphabetical, alongside the other observer imports):

```typescript
import { createCoperniqObserver } from "./observers/coperniq.js";
```

Inside `createSentinel`, after the existing `registry.register(createWeatherObserver())` line:

```typescript
registry.register(createCoperniqObserver({ db }));
```

- [ ] **Step 2: Verify the build and full sentinel test suite pass**

Run:

```bash
cd /Users/vero/openclaw && pnpm typecheck && pnpm vitest run tests/sentinel
```

Expected: typecheck PASS; sentinel tests PASS (no regressions).

- [ ] **Step 3: Manual instantiation smoke (no live Firestore)**

Run:

```bash
cd /Users/vero/openclaw && node --import tsx -e "
import('./src/sentinel/observers/coperniq.js').then(async (m) => {
  const Database = (await import('better-sqlite3')).default;
  const { openSentinelDb } = await import('./src/sentinel/db.js');
  const db = openSentinelDb(':memory:');
  const obs = m.createCoperniqObserver({
    db,
    getClient: async () => ({
      getSyncMeta: async () => ({ lastSyncAt: 'x' }),
      listProjectStatuses: async () => [],
      listWorkOrderStatuses: async () => [],
      listChangedProjects: async () => [],
      listChangedWorkOrders: async () => [],
    }),
  });
  const out = await obs.observe(0);
  console.log('observer name:', obs.name);
  console.log('emitted:', JSON.stringify(out, null, 2));
});
"
```

Expected output includes `observer name: coperniq` and a single observation object.

- [ ] **Step 4: Commit**

```bash
cd /Users/vero/openclaw && git add src/sentinel/index.ts && git commit -m "$(cat <<'EOF'
feat(sentinel): register coperniq observer in createSentinel

Wires createCoperniqObserver({ db }) into ObserverRegistry alongside the
other Phase A observers. No flag change — covered by the existing master
OPENCLAW_SENTINEL_ENABLED gate.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Live smoke on the Mac mini (manual, gated)

**Files:** none (operational verification — no code changes)

This is operator-driven verification before declaring the feature shipped. Do not run autonomously.

- [ ] **Step 1: Trigger one Sentinel cycle and inspect the observation**

(ADC is already verified end-to-end on this Mac as of 2026-06-17 — `@google-cloud/firestore` round-tripped a `_health/adc-check` write→read→delete with no env-var or key-path configuration. No further auth precheck needed.)

Restart the agent so the new build is loaded:

```bash
launchctl kickstart -k gui/$(id -u)/com.openclaw.agent
```

Wait for the next 2h tick (or use `OPENCLAW_SENTINEL_BOOT_CYCLE=1` if a one-shot helper exists; see `~/.openclaw/.env`).

- [ ] **Step 2: Query sentinel.db for the new observation**

```bash
sqlite3 ~/.openclaw/sentinel.db "SELECT timestamp, summary, json_extract(metrics, '$.projects_total'), json_extract(metrics, '$.work_orders_total') FROM observations WHERE source='coperniq' ORDER BY id DESC LIMIT 3;"
```

Expected: at least one row whose totals match the latest `coperniq_sync_meta/latest.counts` (within the sync window).

- [ ] **Step 3: Verify subsequent cycles skip when no new ingest**

After two more 2h ticks without an intervening sync, expect zero new coperniq observations in `sentinel.db`. Then trigger a sync (`launchctl kickstart -k gui/$(id -u)/ai.openclaw.coperniq-sync` if applicable) and verify the next Sentinel cycle emits a fresh observation.

- [ ] **Step 4: No commit — this task is verification only.**

---

## Spec coverage check

- Component file & registration → Tasks 1, 9.
- Auth via ADC + impersonation (no in-process credentials) → Task 8 (default client). Task 2 cleans up the FirestoreCredentials leftover from Task 1.
- Watermark skip on lastSyncAt → Task 3.
- Count grouping over projects + work_orders → Task 4.
- Delta math vs prior observation → Task 5.
- Changed-doc detail with `where updatedAt > since`, cap 50 → Task 6.
- Summary text with totals + delta phrase → Task 7.
- Error propagation (throw, runner catches) → Task 7 (tests) + Task 9 (relies on existing `runObservers` catch).
- No live Firestore in tests → all unit tests use injected client.
- IT-SEC-001 scope note: `roles/datastore.user` on the impersonated SA is project-wide _read+write_. Acceptable because `openclaw-mail-bridge` is a JR-only project; documented in the spec.
- Manual smoke on Mac mini → Task 10.

## Out of scope (per spec)

- `gcp-functions` and `gmail-watcher` observers — Phase B2, separate plan.
- Synthesizer/curator/reporter/inquirer/monetizer changes — they consume observations generically; no edits.
- Retiring local `coperniq-sync` LaunchAgent — used by the grading pipeline; leave alone.
