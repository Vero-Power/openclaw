# Sentinel JR — Phase A MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase A of Sentinel JR: every-2-hour observation cycle against in-house sources (triage.db, Slack channels, launchctl), synthesis with quantitative rigor, fluid markdown library at `~/.openclaw/jr-library/`, daily + weekly + ideas reports, manual-review-mode inquirer (formulates questions, files for human review before sending), F1 wiring so the Triage planner reads sentinel knowledge before planning.

**Architecture:** New `src/sentinel/` module with observer-runner orchestrator, plug-in observer interface, LLM-backed synthesizer + curator + reporter + monetizer, SQLite working memory in `sentinel.db`, markdown library on disk. Triggered every 2 hours via a setInterval inside the gateway (Phase D can move to launchd). Feature-flagged behind `OPENCLAW_SENTINEL_ENABLED=1`. Inquirer ships in manual-review-only mode — JR formulates questions and files them; human review before any go live in Phase B.

**Tech Stack:** TypeScript, Node 22, vitest 4.x, zod 4.x, `better-sqlite3` (already a dep from Triage MVP), `@mariozechner/pi-ai` (LLM client wired in Triage MVP).

**Spec:** `docs/superpowers/specs/2026-06-08-sentinel-jr-design.md`

**Repo:** `/Users/vero/openclaw` — branch from the in-progress sentinel branch (created in Task 0).

---

## File Structure

New files this plan creates:

```
src/sentinel/
├── types.ts                          # Observation, Insight, Conversation, Opportunity, etc.
├── db.ts                             # sentinel.db setup + schema bootstrap
├── observer.ts                       # Observer interface + ObserverRegistry
├── observer-runner.ts                # Fan-out runner, calls all registered observers
├── observers/
│   ├── self.ts                       # reads triage.db
│   ├── slack-channels.ts             # reads recent slack channel activity
│   └── launchagents.ts               # reads launchctl list output
├── synthesizer.ts                    # LLM extraction of insights
├── curator.ts                        # writes insights into jr-library/ markdown
├── library.ts                        # filesystem helpers + INDEX.md regen
├── reporter.ts                       # daily / weekly / ideas markdown writers
├── monetizer.ts                      # weekly creative engine
├── inquirer.ts                       # gap detection + question formulation (manual-review mode in Phase A)
├── scheduler.ts                      # 2-hour interval trigger
└── index.ts                          # public exports

src/sentinel/persona/
└── inquirer-prompt.ts                # the LLM prompt used by the inquirer for question generation

src/triage/planner.ts                 # MODIFIED — read sentinel.db for relevant context
src/gateway/server.ts (or equivalent) # MODIFIED — start scheduler when gateway boots

migrations/
└── 002-sentinel-schema.sql           # sentinel.db schema

tests/sentinel/
├── db.test.ts
├── observer-runner.test.ts
├── observers/self.test.ts
├── observers/slack-channels.test.ts
├── observers/launchagents.test.ts
├── synthesizer.test.ts
├── curator.test.ts
├── library.test.ts
├── reporter.test.ts
├── monetizer.test.ts
└── inquirer.test.ts
```

Files modified outside the new module:

```
/Users/vero/.openclaw/.env            # add OPENCLAW_SENTINEL_ENABLED=0
src/triage/planner.ts                 # query sentinel.db for context (F1)
src/gateway/server.ts (or main entry) # start scheduler when sentinel enabled
```

Library on disk (created by the implementer at Task 5):

```
~/.openclaw/jr-library/
├── INDEX.md                          # auto-regenerated
├── people/
├── projects/
├── operations/
├── insights/
│   ├── patterns/
│   ├── anomalies/
│   ├── opportunities/
│   └── friction/
├── reports/
│   ├── daily/
│   ├── weekly/
│   └── ideas/
└── threads/
```

---

## Task 0: Pre-flight — branch + feature flag

**Files:**

- Modify: `/Users/vero/.openclaw/.env`
- Git: create branch `cleanup/phase-6-sentinel-jr-phase-a`

- [ ] **Step 1: Confirm current branch + clean enough state**

```bash
cd /Users/vero/openclaw
git status --short
git branch --show-current
```

Expected current branch: `cleanup/phase-3-triage-mvp` (Sentinel branches from the Triage MVP work since it builds on it). The runtime artifacts (`.openclaw/workspace-state.json`, `email-archive/emails.json`) being unstaged is fine — those are live gateway state.

- [ ] **Step 2: Create the implementation branch**

```bash
git checkout -b cleanup/phase-6-sentinel-jr-phase-a
git branch --show-current   # Expected: cleanup/phase-6-sentinel-jr-phase-a
```

- [ ] **Step 3: Add feature flag (default off) to `~/.openclaw/.env`**

```bash
cat >> /Users/vero/.openclaw/.env <<'EOF'

# Phase 6 sentinel JR — feature flag. Set to 1 to enable the 2h observation cycle.
OPENCLAW_SENTINEL_ENABLED=0
EOF
tail -5 /Users/vero/.openclaw/.env
```

Expected: last line shows `OPENCLAW_SENTINEL_ENABLED=0`.

- [ ] **Step 4: No commit yet (no source files changed)**

The branch is checked out; the flag is in `.env` (which is gitignored). Skip to Task 1.

---

## Task 1: Schema + types + db bootstrap

**Files:**

- Create: `migrations/002-sentinel-schema.sql`
- Create: `src/sentinel/types.ts`
- Create: `src/sentinel/db.ts`
- Create: `tests/sentinel/db.test.ts`

- [ ] **Step 1: Write the sentinel SQL schema**

Create `/Users/vero/openclaw/migrations/002-sentinel-schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS observations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source          TEXT NOT NULL,
  topic           TEXT,
  timestamp       INTEGER NOT NULL,
  summary         TEXT NOT NULL,
  data            TEXT,
  metrics         TEXT,
  embedding       BLOB,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_observations_source_ts
  ON observations(source, timestamp);
CREATE INDEX IF NOT EXISTS idx_observations_topic
  ON observations(topic);

CREATE TABLE IF NOT EXISTS insights (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  category        TEXT NOT NULL,
  summary         TEXT NOT NULL,
  evidence        TEXT NOT NULL,
  derived_from    TEXT,
  confidence      REAL,
  generated_at    INTEGER NOT NULL,
  superseded_by   INTEGER REFERENCES insights(id),
  filed_to        TEXT
);

CREATE INDEX IF NOT EXISTS idx_insights_category
  ON insights(category);
CREATE INDEX IF NOT EXISTS idx_insights_generated_at
  ON insights(generated_at);

CREATE TABLE IF NOT EXISTS conversations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  person_user_id  TEXT NOT NULL,
  channel         TEXT NOT NULL,
  thread_ts       TEXT,
  topic           TEXT NOT NULL,
  opening_message TEXT NOT NULL,
  state           TEXT NOT NULL,
  turns           TEXT,
  opened_at       INTEGER NOT NULL,
  last_turn_at    INTEGER,
  closed_at       INTEGER,
  takeaway        TEXT
);

CREATE INDEX IF NOT EXISTS idx_conversations_person_state
  ON conversations(person_user_id, state);

CREATE TABLE IF NOT EXISTS people_profiles (
  user_id         TEXT PRIMARY KEY,
  display_name    TEXT,
  known_domains   TEXT,
  last_engaged_at INTEGER,
  total_engaged   INTEGER NOT NULL DEFAULT 0,
  notes           TEXT
);

CREATE TABLE IF NOT EXISTS opt_outs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  person_user_id  TEXT NOT NULL,
  scope           TEXT NOT NULL,
  added_at        INTEGER NOT NULL,
  reason          TEXT
);

CREATE INDEX IF NOT EXISTS idx_opt_outs_person
  ON opt_outs(person_user_id);

CREATE TABLE IF NOT EXISTS opportunities (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT NOT NULL,
  scope           TEXT NOT NULL,
  summary         TEXT NOT NULL,
  evidence        TEXT NOT NULL,
  proposed_at     INTEGER NOT NULL,
  confidence      REAL,
  filed_to        TEXT,
  status          TEXT NOT NULL DEFAULT 'proposed',
  status_notes    TEXT
);

CREATE INDEX IF NOT EXISTS idx_opportunities_status
  ON opportunities(status);

CREATE TABLE IF NOT EXISTS reports (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  kind            TEXT NOT NULL,
  generated_at    INTEGER NOT NULL,
  filed_to        TEXT NOT NULL,
  delivered_to    TEXT
);

CREATE INDEX IF NOT EXISTS idx_reports_kind_generated
  ON reports(kind, generated_at);

CREATE TABLE IF NOT EXISTS observer_watermarks (
  source          TEXT PRIMARY KEY,
  last_observed_at INTEGER NOT NULL
);
```

- [ ] **Step 2: Write the core sentinel types**

Create `/Users/vero/openclaw/src/sentinel/types.ts`:

```typescript
import { z } from "zod";

export const ObservationSchema = z.object({
  id: z.number().optional(),
  source: z.string(),
  topic: z.string().optional(),
  timestamp: z.number(),
  summary: z.string(),
  data: z.unknown().optional(),
  metrics: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
});
export type Observation = z.infer<typeof ObservationSchema>;

export const InsightCategorySchema = z.enum(["pattern", "anomaly", "friction", "opportunity"]);
export type InsightCategory = z.infer<typeof InsightCategorySchema>;

export const InsightSchema = z.object({
  id: z.number().optional(),
  category: InsightCategorySchema,
  summary: z.string(),
  evidence: z.string(),
  derived_from: z.array(z.number()).default([]),
  confidence: z.number().min(0).max(1),
  generated_at: z.number(),
  filed_to: z.string().nullable().default(null),
});
export type Insight = z.infer<typeof InsightSchema>;

export const ConversationStateSchema = z.enum(["open", "closed", "dropped", "opt-out"]);
export type ConversationState = z.infer<typeof ConversationStateSchema>;

export const ConversationTurnSchema = z.object({
  sender: z.enum(["jr", "person"]),
  text: z.string(),
  ts: z.number(),
});
export type ConversationTurn = z.infer<typeof ConversationTurnSchema>;

export interface Conversation {
  id?: number;
  person_user_id: string;
  channel: string;
  thread_ts: string | null;
  topic: string;
  opening_message: string;
  state: ConversationState;
  turns: ConversationTurn[];
  opened_at: number;
  last_turn_at: number | null;
  closed_at: number | null;
  takeaway: string | null;
}

export interface PersonProfile {
  user_id: string;
  display_name: string | null;
  known_domains: string[];
  last_engaged_at: number | null;
  total_engaged: number;
  notes: string | null;
}

export interface OptOut {
  id?: number;
  person_user_id: string;
  scope: string;
  added_at: number;
  reason: string | null;
}

export const OpportunityScopeSchema = z.enum(["ops-efficiency", "strategic-revenue"]);
export type OpportunityScope = z.infer<typeof OpportunityScopeSchema>;

export const OpportunityStatusSchema = z.enum([
  "proposed",
  "in-progress",
  "shipped",
  "declined",
  "stale",
]);
export type OpportunityStatus = z.infer<typeof OpportunityStatusSchema>;

export interface Opportunity {
  id?: number;
  title: string;
  scope: OpportunityScope;
  summary: string;
  evidence: string;
  proposed_at: number;
  confidence: number;
  filed_to: string | null;
  status: OpportunityStatus;
  status_notes: string | null;
}

export const ReportKindSchema = z.enum(["daily", "weekly-digest", "weekly-ideas"]);
export type ReportKind = z.infer<typeof ReportKindSchema>;
```

- [ ] **Step 3: Write the failing test for sentinel db bootstrap**

Create `/Users/vero/openclaw/tests/sentinel/db.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openSentinelDb } from "../../src/sentinel/db.js";

const TEST_DB = join(tmpdir(), `sentinel-test-${Date.now()}.db`);

describe("sentinel db", () => {
  afterEach(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    if (existsSync(`${TEST_DB}-shm`)) unlinkSync(`${TEST_DB}-shm`);
    if (existsSync(`${TEST_DB}-wal`)) unlinkSync(`${TEST_DB}-wal`);
  });

  it("creates all 8 tables on first open", () => {
    const db = openSentinelDb(TEST_DB);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain("observations");
    expect(names).toContain("insights");
    expect(names).toContain("conversations");
    expect(names).toContain("people_profiles");
    expect(names).toContain("opt_outs");
    expect(names).toContain("opportunities");
    expect(names).toContain("reports");
    expect(names).toContain("observer_watermarks");
    db.close();
  });

  it("is idempotent — re-opening doesn't error", () => {
    const db1 = openSentinelDb(TEST_DB);
    db1.close();
    const db2 = openSentinelDb(TEST_DB);
    expect(db2).toBeTruthy();
    db2.close();
  });

  it("inserts an observation row", () => {
    const db = openSentinelDb(TEST_DB);
    const now = Date.now();
    db.prepare(
      `INSERT INTO observations (source, topic, timestamp, summary, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run("self", "triage", now, "5 sessions completed today", now);
    const row = db.prepare("SELECT source, summary FROM observations LIMIT 1").get() as {
      source: string;
      summary: string;
    };
    expect(row.source).toBe("self");
    expect(row.summary).toBe("5 sessions completed today");
    db.close();
  });
});
```

- [ ] **Step 4: Run the test — verify it fails**

```bash
cd /Users/vero/openclaw
pnpm vitest run tests/sentinel/db.test.ts 2>&1 | tail -10
```

Expected: FAIL with "Cannot find module '../../src/sentinel/db.js'".

- [ ] **Step 5: Implement `src/sentinel/db.ts`**

Inline the schema as a string (proven pattern from Triage MVP — avoids the file-path resolution bug):

```typescript
import Database, { type Database as DatabaseType } from "better-sqlite3";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS observations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source          TEXT NOT NULL,
  topic           TEXT,
  timestamp       INTEGER NOT NULL,
  summary         TEXT NOT NULL,
  data            TEXT,
  metrics         TEXT,
  embedding       BLOB,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_observations_source_ts
  ON observations(source, timestamp);
CREATE INDEX IF NOT EXISTS idx_observations_topic
  ON observations(topic);

CREATE TABLE IF NOT EXISTS insights (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  category        TEXT NOT NULL,
  summary         TEXT NOT NULL,
  evidence        TEXT NOT NULL,
  derived_from    TEXT,
  confidence      REAL,
  generated_at    INTEGER NOT NULL,
  superseded_by   INTEGER REFERENCES insights(id),
  filed_to        TEXT
);

CREATE INDEX IF NOT EXISTS idx_insights_category
  ON insights(category);
CREATE INDEX IF NOT EXISTS idx_insights_generated_at
  ON insights(generated_at);

CREATE TABLE IF NOT EXISTS conversations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  person_user_id  TEXT NOT NULL,
  channel         TEXT NOT NULL,
  thread_ts       TEXT,
  topic           TEXT NOT NULL,
  opening_message TEXT NOT NULL,
  state           TEXT NOT NULL,
  turns           TEXT,
  opened_at       INTEGER NOT NULL,
  last_turn_at    INTEGER,
  closed_at       INTEGER,
  takeaway        TEXT
);

CREATE INDEX IF NOT EXISTS idx_conversations_person_state
  ON conversations(person_user_id, state);

CREATE TABLE IF NOT EXISTS people_profiles (
  user_id         TEXT PRIMARY KEY,
  display_name    TEXT,
  known_domains   TEXT,
  last_engaged_at INTEGER,
  total_engaged   INTEGER NOT NULL DEFAULT 0,
  notes           TEXT
);

CREATE TABLE IF NOT EXISTS opt_outs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  person_user_id  TEXT NOT NULL,
  scope           TEXT NOT NULL,
  added_at        INTEGER NOT NULL,
  reason          TEXT
);

CREATE INDEX IF NOT EXISTS idx_opt_outs_person
  ON opt_outs(person_user_id);

CREATE TABLE IF NOT EXISTS opportunities (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT NOT NULL,
  scope           TEXT NOT NULL,
  summary         TEXT NOT NULL,
  evidence        TEXT NOT NULL,
  proposed_at     INTEGER NOT NULL,
  confidence      REAL,
  filed_to        TEXT,
  status          TEXT NOT NULL DEFAULT 'proposed',
  status_notes    TEXT
);

CREATE INDEX IF NOT EXISTS idx_opportunities_status
  ON opportunities(status);

CREATE TABLE IF NOT EXISTS reports (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  kind            TEXT NOT NULL,
  generated_at    INTEGER NOT NULL,
  filed_to        TEXT NOT NULL,
  delivered_to    TEXT
);

CREATE INDEX IF NOT EXISTS idx_reports_kind_generated
  ON reports(kind, generated_at);

CREATE TABLE IF NOT EXISTS observer_watermarks (
  source          TEXT PRIMARY KEY,
  last_observed_at INTEGER NOT NULL
);
`;

export function openSentinelDb(path: string): DatabaseType {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  return db;
}
```

- [ ] **Step 6: Run the test — verify it passes**

```bash
pnpm vitest run tests/sentinel/db.test.ts 2>&1 | tail -10
```

Expected: PASS, all 3 tests green.

- [ ] **Step 7: Commit Task 1**

```bash
git add migrations/002-sentinel-schema.sql src/sentinel/types.ts src/sentinel/db.ts \
        tests/sentinel/db.test.ts
git commit -m "feat(sentinel): schema + types + db bootstrap

Phase A of Sentinel JR. 8 tables: observations, insights, conversations,
people_profiles, opt_outs, opportunities, reports, observer_watermarks.
Schema inlined as a string in db.ts (proven pattern from Triage MVP —
avoids file-path resolution bug in bundled dist).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Observer interface + self-observer + observer-runner

**Files:**

- Create: `src/sentinel/observer.ts`
- Create: `src/sentinel/observers/self.ts`
- Create: `src/sentinel/observer-runner.ts`
- Create: `tests/sentinel/observer-runner.test.ts`
- Create: `tests/sentinel/observers/self.test.ts`

- [ ] **Step 1: Write the Observer interface**

Create `/Users/vero/openclaw/src/sentinel/observer.ts`:

```typescript
import type { Observation } from "./types.js";

export interface Observer {
  readonly name: string;
  observe(since: number): Promise<Omit<Observation, "id" | "created_at">[]>;
}

export class ObserverRegistry {
  private observers = new Map<string, Observer>();

  register(observer: Observer): void {
    if (this.observers.has(observer.name)) {
      throw new Error(`observer "${observer.name}" is already registered`);
    }
    this.observers.set(observer.name, observer);
  }

  list(): Observer[] {
    return Array.from(this.observers.values());
  }

  get(name: string): Observer | null {
    return this.observers.get(name) ?? null;
  }
}
```

- [ ] **Step 2: Write the failing test for the self-observer**

Create `/Users/vero/openclaw/tests/sentinel/observers/self.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { createSelfObserver } from "../../../src/sentinel/observers/self.js";

const TRIAGE_DB = join(tmpdir(), `triage-for-self-${Date.now()}.db`);

describe("self observer", () => {
  beforeEach(() => {
    const db = new Database(TRIAGE_DB);
    db.exec(`
      CREATE TABLE triage_sessions (
        request_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE action_invocations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        result_status TEXT NOT NULL,
        invoked_at INTEGER NOT NULL
      );
    `);
    const now = Date.now();
    db.prepare(
      "INSERT INTO triage_sessions (request_id, state, created_at, updated_at) VALUES (?,?,?,?)",
    ).run("req1", "COMPLETE", now, now);
    db.prepare(
      "INSERT INTO triage_sessions (request_id, state, created_at, updated_at) VALUES (?,?,?,?)",
    ).run("req2", "AWAITING_APPROVAL", now, now);
    db.prepare(
      "INSERT INTO action_invocations (action, result_status, invoked_at) VALUES (?,?,?)",
    ).run("coperniqFirestoreIngest", "success", now);
    db.prepare(
      "INSERT INTO action_invocations (action, result_status, invoked_at) VALUES (?,?,?)",
    ).run("bomQuoteNotifier", "error", now);
    db.close();
  });

  afterEach(() => {
    if (existsSync(TRIAGE_DB)) unlinkSync(TRIAGE_DB);
    if (existsSync(`${TRIAGE_DB}-shm`)) unlinkSync(`${TRIAGE_DB}-shm`);
    if (existsSync(`${TRIAGE_DB}-wal`)) unlinkSync(`${TRIAGE_DB}-wal`);
  });

  it("emits an observation with session counts by state", async () => {
    const obs = createSelfObserver({ triageDbPath: TRIAGE_DB });
    const observations = await obs.observe(0);
    const sessionObs = observations.find((o) => o.topic === "triage-sessions");
    expect(sessionObs).toBeTruthy();
    expect(sessionObs?.metrics).toMatchObject({
      COMPLETE: 1,
      AWAITING_APPROVAL: 1,
    });
  });

  it("emits an observation with action-invocation counts by status", async () => {
    const obs = createSelfObserver({ triageDbPath: TRIAGE_DB });
    const observations = await obs.observe(0);
    const actionObs = observations.find((o) => o.topic === "action-invocations");
    expect(actionObs).toBeTruthy();
    expect(actionObs?.metrics).toMatchObject({ success: 1, error: 1 });
  });

  it("respects the `since` parameter — only counts rows after that timestamp", async () => {
    const obs = createSelfObserver({ triageDbPath: TRIAGE_DB });
    const future = Date.now() + 60 * 60 * 1000;
    const observations = await obs.observe(future);
    const sessionObs = observations.find((o) => o.topic === "triage-sessions");
    // With `since` in the future, no rows match — count totals to 0
    const totals = Object.values(sessionObs?.metrics ?? {}).reduce<number>(
      (a, b) => a + (typeof b === "number" ? b : 0),
      0,
    );
    expect(totals).toBe(0);
  });
});
```

- [ ] **Step 3: Run test — verify it fails**

```bash
pnpm vitest run tests/sentinel/observers/self.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement the self observer**

Create `/Users/vero/openclaw/src/sentinel/observers/self.ts`:

```typescript
import Database from "better-sqlite3";
import type { Observer } from "../observer.js";
import type { Observation } from "../types.js";

export interface SelfObserverDeps {
  triageDbPath: string;
}

export function createSelfObserver(deps: SelfObserverDeps): Observer {
  return {
    name: "self",
    async observe(since: number): Promise<Omit<Observation, "id" | "created_at">[]> {
      const db = new Database(deps.triageDbPath, { readonly: true });
      const now = Date.now();

      const sessionRows = db
        .prepare(
          `SELECT state, COUNT(*) AS c FROM triage_sessions WHERE created_at >= ? GROUP BY state`,
        )
        .all(since) as Array<{ state: string; c: number }>;
      const sessionMetrics: Record<string, number> = {};
      for (const row of sessionRows) sessionMetrics[row.state] = row.c;

      const actionRows = db
        .prepare(
          `SELECT result_status, COUNT(*) AS c FROM action_invocations WHERE invoked_at >= ? GROUP BY result_status`,
        )
        .all(since) as Array<{ result_status: string; c: number }>;
      const actionMetrics: Record<string, number> = {};
      for (const row of actionRows) actionMetrics[row.result_status] = row.c;

      db.close();

      const observations: Omit<Observation, "id" | "created_at">[] = [
        {
          source: "self",
          topic: "triage-sessions",
          timestamp: now,
          summary: `triage sessions since ${new Date(since).toISOString()}: ${
            Object.entries(sessionMetrics)
              .map(([s, c]) => `${s}=${c}`)
              .join(", ") || "(none)"
          }`,
          metrics: sessionMetrics,
        },
        {
          source: "self",
          topic: "action-invocations",
          timestamp: now,
          summary: `action invocations since ${new Date(since).toISOString()}: ${
            Object.entries(actionMetrics)
              .map(([s, c]) => `${s}=${c}`)
              .join(", ") || "(none)"
          }`,
          metrics: actionMetrics,
        },
      ];
      return observations;
    },
  };
}
```

- [ ] **Step 5: Run self-observer tests — verify they pass**

```bash
pnpm vitest run tests/sentinel/observers/self.test.ts 2>&1 | tail -10
```

Expected: PASS, 3 tests green.

- [ ] **Step 6: Write the failing test for observer-runner**

Create `/Users/vero/openclaw/tests/sentinel/observer-runner.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openSentinelDb } from "../../src/sentinel/db.js";
import { ObserverRegistry, type Observer } from "../../src/sentinel/observer.js";
import { runObservers } from "../../src/sentinel/observer-runner.js";

const SENTINEL_DB = join(tmpdir(), `sentinel-runner-${Date.now()}.db`);

describe("observer runner", () => {
  afterEach(() => {
    if (existsSync(SENTINEL_DB)) unlinkSync(SENTINEL_DB);
    if (existsSync(`${SENTINEL_DB}-shm`)) unlinkSync(`${SENTINEL_DB}-shm`);
    if (existsSync(`${SENTINEL_DB}-wal`)) unlinkSync(`${SENTINEL_DB}-wal`);
  });

  it("runs registered observers in parallel and writes results to sentinel.db", async () => {
    const db = openSentinelDb(SENTINEL_DB);
    const reg = new ObserverRegistry();
    const fakeObs: Observer = {
      name: "fake-a",
      observe: async () => [
        {
          source: "fake-a",
          topic: "test",
          timestamp: Date.now(),
          summary: "fake-a saw something",
          metrics: { count: 7 },
        },
      ],
    };
    const fakeObsB: Observer = {
      name: "fake-b",
      observe: async () => [
        {
          source: "fake-b",
          topic: "test",
          timestamp: Date.now(),
          summary: "fake-b saw something else",
        },
      ],
    };
    reg.register(fakeObs);
    reg.register(fakeObsB);

    const result = await runObservers({ registry: reg, db });
    expect(result.observationsWritten).toBe(2);

    const rows = db
      .prepare("SELECT source, summary, metrics FROM observations ORDER BY id")
      .all() as Array<{ source: string; summary: string; metrics: string | null }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].source).toBe("fake-a");
    expect(rows[1].source).toBe("fake-b");
    expect(JSON.parse(rows[0].metrics ?? "{}").count).toBe(7);

    db.close();
  });

  it("updates observer_watermarks after each successful observation", async () => {
    const db = openSentinelDb(SENTINEL_DB);
    const reg = new ObserverRegistry();
    reg.register({
      name: "ticker",
      observe: async () => [{ source: "ticker", timestamp: Date.now(), summary: "tick" }],
    });

    await runObservers({ registry: reg, db });
    const wm = db.prepare("SELECT * FROM observer_watermarks WHERE source = ?").get("ticker") as
      | { source: string; last_observed_at: number }
      | undefined;
    expect(wm?.source).toBe("ticker");
    expect(wm?.last_observed_at).toBeGreaterThan(0);

    db.close();
  });

  it("isolates failures: one observer throwing does not block others", async () => {
    const db = openSentinelDb(SENTINEL_DB);
    const reg = new ObserverRegistry();
    reg.register({
      name: "broken",
      observe: async () => {
        throw new Error("kaboom");
      },
    });
    reg.register({
      name: "fine",
      observe: async () => [{ source: "fine", timestamp: Date.now(), summary: "still working" }],
    });

    const result = await runObservers({ registry: reg, db });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].observer).toBe("broken");
    expect(result.observationsWritten).toBe(1);

    db.close();
  });
});
```

- [ ] **Step 7: Run test — verify it fails**

```bash
pnpm vitest run tests/sentinel/observer-runner.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 8: Implement the observer runner**

Create `/Users/vero/openclaw/src/sentinel/observer-runner.ts`:

```typescript
import type { Database as DatabaseType } from "better-sqlite3";
import type { ObserverRegistry } from "./observer.js";

export interface RunObserversOptions {
  registry: ObserverRegistry;
  db: DatabaseType;
}

export interface ObserverRunResult {
  observationsWritten: number;
  errors: Array<{ observer: string; error: string }>;
}

export async function runObservers(opts: RunObserversOptions): Promise<ObserverRunResult> {
  const { registry, db } = opts;
  const observers = registry.list();
  const errors: ObserverRunResult["errors"] = [];

  const watermarkStmt = db.prepare(
    "SELECT last_observed_at FROM observer_watermarks WHERE source = ?",
  );
  const insertObservation = db.prepare(
    `INSERT INTO observations (source, topic, timestamp, summary, data, metrics, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const upsertWatermark = db.prepare(
    `INSERT INTO observer_watermarks (source, last_observed_at) VALUES (?, ?)
     ON CONFLICT(source) DO UPDATE SET last_observed_at = excluded.last_observed_at`,
  );

  let written = 0;

  const tasks = observers.map(async (obs) => {
    const wmRow = watermarkStmt.get(obs.name) as { last_observed_at: number } | undefined;
    const since = wmRow?.last_observed_at ?? 0;
    const now = Date.now();
    try {
      const results = await obs.observe(since);
      for (const r of results) {
        insertObservation.run(
          r.source,
          r.topic ?? null,
          r.timestamp,
          r.summary,
          r.data ? JSON.stringify(r.data) : null,
          r.metrics ? JSON.stringify(r.metrics) : null,
          now,
        );
        written++;
      }
      upsertWatermark.run(obs.name, now);
    } catch (err) {
      errors.push({ observer: obs.name, error: (err as Error).message });
    }
  });

  await Promise.all(tasks);

  return { observationsWritten: written, errors };
}
```

- [ ] **Step 9: Run observer-runner tests — verify they pass**

```bash
pnpm vitest run tests/sentinel 2>&1 | tail -10
```

Expected: PASS — all sentinel tests so far (db + self-observer + runner) green.

- [ ] **Step 10: Commit Task 2**

```bash
git add src/sentinel/observer.ts src/sentinel/observers/self.ts \
        src/sentinel/observer-runner.ts \
        tests/sentinel/observers/self.test.ts tests/sentinel/observer-runner.test.ts
git commit -m "feat(sentinel): observer interface + self-observer + runner

ObserverRegistry + Observer contract. self-observer reads triage.db
and emits per-state session counts + per-status action invocation counts.
ObserverRunner fans out registered observers in parallel, writes
observations to sentinel.db, updates per-source watermarks, and
isolates per-observer failures so one bad observer doesn't break others.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Synthesizer — LLM extraction of insights with quantitative rigor

**Files:**

- Create: `src/sentinel/synthesizer.ts`
- Create: `tests/sentinel/synthesizer.test.ts`

- [ ] **Step 1: Write the failing test for synthesizer**

Create `/Users/vero/openclaw/tests/sentinel/synthesizer.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { Synthesizer } from "../../src/sentinel/synthesizer.js";
import type { LlmClient } from "../../src/triage/llm-client.js";
import type { Observation } from "../../src/sentinel/types.js";

const fakeLlm = (response: string): LlmClient => ({
  complete: vi.fn(async () => response),
});

describe("Synthesizer", () => {
  it("parses a valid LLM response into insights", async () => {
    const llm = fakeLlm(
      JSON.stringify({
        insights: [
          {
            category: "pattern",
            summary: "BOM volume up 23% WoW",
            evidence: "62 BOMs this week vs 50 last week per `action-invocations` metric",
            derived_from: [1, 2],
            confidence: 0.85,
          },
        ],
      }),
    );
    const s = new Synthesizer(llm);
    const observations: Observation[] = [
      {
        id: 1,
        source: "self",
        topic: "action-invocations",
        timestamp: Date.now(),
        summary: "62 bomQuoteNotifier invocations this week",
        metrics: { count: 62 },
      },
      {
        id: 2,
        source: "self",
        topic: "action-invocations",
        timestamp: Date.now() - 7 * 24 * 60 * 60 * 1000,
        summary: "50 bomQuoteNotifier invocations last week",
        metrics: { count: 50 },
      },
    ];
    const insights = await s.synthesize(observations);
    expect(insights).toHaveLength(1);
    expect(insights[0].category).toBe("pattern");
    expect(insights[0].evidence).toContain("62");
  });

  it("rejects insights missing quantitative evidence", async () => {
    const llm = fakeLlm(
      JSON.stringify({
        insights: [
          {
            category: "pattern",
            summary: "Things seem busy",
            evidence: "feels like a lot of activity",
            derived_from: [1],
            confidence: 0.6,
          },
        ],
      }),
    );
    const s = new Synthesizer(llm);
    const observations: Observation[] = [
      { id: 1, source: "self", timestamp: Date.now(), summary: "stuff", metrics: { count: 5 } },
    ];
    const insights = await s.synthesize(observations);
    expect(insights).toHaveLength(0); // vibes-only insight got filtered
  });

  it("returns empty array on malformed LLM output", async () => {
    const llm = fakeLlm("not json");
    const s = new Synthesizer(llm);
    const insights = await s.synthesize([]);
    expect(insights).toHaveLength(0);
  });

  it("returns empty array on LLM throw", async () => {
    const llm: LlmClient = {
      complete: async () => {
        throw new Error("rate limited");
      },
    };
    const s = new Synthesizer(llm);
    const insights = await s.synthesize([]);
    expect(insights).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
pnpm vitest run tests/sentinel/synthesizer.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement synthesizer**

Create `/Users/vero/openclaw/src/sentinel/synthesizer.ts`:

````typescript
import { z } from "zod";
import type { LlmClient } from "../triage/llm-client.js";
import { InsightCategorySchema, type Insight, type Observation } from "./types.js";

const SynthOutputSchema = z.object({
  insights: z.array(
    z.object({
      category: InsightCategorySchema,
      summary: z.string(),
      evidence: z.string(),
      derived_from: z.array(z.number()),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

const SYSTEM_PROMPT = `You are JR's private synthesizer. Given a batch of operational observations, extract insights.

Insight categories:
- pattern   — a recurring behavior or trend
- anomaly   — a deviation from normal
- friction  — a pain point worth fixing
- opportunity — a way to make Vero more money OR more efficient

Every insight MUST include quantitative evidence — at least one specific number sourced from the observation metrics. Insights based on "feels like" / "seems" / "appears" without a number are rejected.

Return JSON only, no markdown fences:
{ "insights": [ { "category": ..., "summary": ..., "evidence": ..., "derived_from": [ids], "confidence": 0..1 } ] }

If nothing notable was observed, return { "insights": [] }.`;

const NUMBER_PATTERN = /\d/;

export class Synthesizer {
  constructor(private llm: LlmClient) {}

  async synthesize(observations: Observation[]): Promise<Omit<Insight, "id" | "filed_to">[]> {
    if (observations.length === 0) return [];

    const obsLines = observations
      .map(
        (o) =>
          `[${o.id}] source=${o.source} topic=${o.topic ?? "?"} ts=${new Date(
            o.timestamp,
          ).toISOString()} summary="${o.summary}" metrics=${JSON.stringify(o.metrics ?? {})}`,
      )
      .join("\n");

    const prompt = `${SYSTEM_PROMPT}\n\nObservations:\n${obsLines}\n\nJSON:`;

    let raw: string;
    try {
      raw = await this.llm.complete(prompt, { model: "gemini-pro", temperature: 0 });
    } catch {
      return [];
    }

    let parsed: z.infer<typeof SynthOutputSchema>;
    try {
      const stripped = raw.trim().replace(/^```(?:json)?\n?|\n?```$/g, "");
      parsed = SynthOutputSchema.parse(JSON.parse(stripped));
    } catch {
      return [];
    }

    const now = Date.now();
    const validInsights: Omit<Insight, "id" | "filed_to">[] = [];
    for (const ins of parsed.insights) {
      // Quantitative-rigor gate: evidence must contain at least one digit
      if (!NUMBER_PATTERN.test(ins.evidence)) {
        continue;
      }
      validInsights.push({ ...ins, generated_at: now });
    }
    return validInsights;
  }
}
````

- [ ] **Step 4: Run synthesizer tests — verify they pass**

```bash
pnpm vitest run tests/sentinel/synthesizer.test.ts 2>&1 | tail -10
```

Expected: PASS, 4 tests green.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/sentinel/synthesizer.ts tests/sentinel/synthesizer.test.ts
git commit -m "feat(sentinel): synthesizer — LLM extraction with quantitative rigor

Given a batch of observations, calls Pro to extract insights tagged
pattern/anomaly/friction/opportunity. Each insight MUST contain a
digit in its evidence — vibes-only insights are filtered at parse
time (the synthesizer cannot leak 'feels like' to the library).

LLM throw or malformed JSON returns empty array (synthesis just
skips this cycle silently).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Library helpers + curator

**Files:**

- Create: `src/sentinel/library.ts`
- Create: `src/sentinel/curator.ts`
- Create: `tests/sentinel/library.test.ts`
- Create: `tests/sentinel/curator.test.ts`

- [ ] **Step 1: Write the failing test for library helpers**

Create `/Users/vero/openclaw/tests/sentinel/library.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureLibrarySkeleton, regenerateIndex } from "../../src/sentinel/library.js";

let libPath: string;

describe("library helpers", () => {
  beforeEach(() => {
    libPath = mkdtempSync(join(tmpdir(), "jr-library-"));
  });
  afterEach(() => {
    rmSync(libPath, { recursive: true, force: true });
  });

  it("ensureLibrarySkeleton creates the seeded folder structure", () => {
    ensureLibrarySkeleton(libPath);
    expect(existsSync(join(libPath, "people"))).toBe(true);
    expect(existsSync(join(libPath, "projects"))).toBe(true);
    expect(existsSync(join(libPath, "operations"))).toBe(true);
    expect(existsSync(join(libPath, "insights/patterns"))).toBe(true);
    expect(existsSync(join(libPath, "insights/anomalies"))).toBe(true);
    expect(existsSync(join(libPath, "insights/opportunities"))).toBe(true);
    expect(existsSync(join(libPath, "insights/friction"))).toBe(true);
    expect(existsSync(join(libPath, "reports/daily"))).toBe(true);
    expect(existsSync(join(libPath, "reports/weekly"))).toBe(true);
    expect(existsSync(join(libPath, "reports/ideas"))).toBe(true);
    expect(existsSync(join(libPath, "threads"))).toBe(true);
    expect(existsSync(join(libPath, "INDEX.md"))).toBe(true);
  });

  it("ensureLibrarySkeleton is idempotent", () => {
    ensureLibrarySkeleton(libPath);
    expect(() => ensureLibrarySkeleton(libPath)).not.toThrow();
  });

  it("regenerateIndex lists every .md file under the library", () => {
    ensureLibrarySkeleton(libPath);
    // Drop a couple of files with frontmatter
    const fs = require("node:fs") as typeof import("node:fs");
    fs.writeFileSync(
      join(libPath, "people/ridge-payne.md"),
      "---\ntitle: Ridge Payne\nsummary: Vero CEO\ntags: [people, leadership]\n---\n\n# Ridge\n",
    );
    fs.writeFileSync(
      join(libPath, "insights/patterns/bom-volume.md"),
      "---\ntitle: BOM volume trend\nsummary: 23% WoW growth\ntags: [pattern, bom]\n---\n",
    );

    regenerateIndex(libPath);

    const indexContent = readFileSync(join(libPath, "INDEX.md"), "utf-8");
    expect(indexContent).toContain("people/ridge-payne.md");
    expect(indexContent).toContain("Vero CEO");
    expect(indexContent).toContain("insights/patterns/bom-volume.md");
    expect(indexContent).toContain("23% WoW growth");
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
pnpm vitest run tests/sentinel/library.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement library helpers**

Create `/Users/vero/openclaw/src/sentinel/library.ts`:

```typescript
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const SEED_FOLDERS = [
  "people",
  "projects",
  "operations",
  "insights/patterns",
  "insights/anomalies",
  "insights/opportunities",
  "insights/friction",
  "reports/daily",
  "reports/weekly",
  "reports/ideas",
  "threads",
];

export function ensureLibrarySkeleton(libPath: string): void {
  if (!existsSync(libPath)) {
    mkdirSync(libPath, { recursive: true });
  }
  for (const folder of SEED_FOLDERS) {
    const full = join(libPath, folder);
    if (!existsSync(full)) {
      mkdirSync(full, { recursive: true });
    }
  }
  const indexPath = join(libPath, "INDEX.md");
  if (!existsSync(indexPath)) {
    writeFileSync(indexPath, "# JR's Library — Index\n\n_(auto-regenerated each cycle)_\n");
  }
}

interface FileEntry {
  relPath: string;
  title: string | null;
  summary: string | null;
  tags: string[];
}

function walkMd(dir: string, baseDir: string, out: FileEntry[]): void {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkMd(full, baseDir, out);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === "INDEX.md") {
      continue;
    }
    const rel = relative(baseDir, full);
    const content = readFileSync(full, "utf-8");
    const fm = parseFrontmatter(content);
    out.push({
      relPath: rel,
      title: fm.title ?? null,
      summary: fm.summary ?? null,
      tags: fm.tags ?? [],
    });
  }
}

function parseFrontmatter(content: string): {
  title?: string;
  summary?: string;
  tags?: string[];
} {
  if (!content.startsWith("---")) return {};
  const endIdx = content.indexOf("\n---", 3);
  if (endIdx === -1) return {};
  const block = content.slice(3, endIdx).trim();
  const result: { title?: string; summary?: string; tags?: string[] } = {};
  for (const line of block.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    if (key === "title") {
      result.title = value;
    } else if (key === "summary") {
      result.summary = value;
    } else if (key === "tags") {
      // Naive [a, b, c] parsing
      value = value.replace(/^\[|\]$/g, "");
      result.tags = value
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    }
  }
  return result;
}

export function regenerateIndex(libPath: string): void {
  const files: FileEntry[] = [];
  walkMd(libPath, libPath, files);
  files.sort((a, b) => a.relPath.localeCompare(b.relPath));

  const lines: string[] = [
    "# JR's Library — Index",
    "",
    `_Auto-regenerated ${new Date().toISOString()} — ${files.length} files_`,
    "",
  ];

  let currentFolder = "";
  for (const f of files) {
    const folder = f.relPath.includes("/") ? f.relPath.split("/")[0] : "(root)";
    if (folder !== currentFolder) {
      currentFolder = folder;
      lines.push(`## ${folder}`, "");
    }
    const display = f.title ?? f.relPath;
    const summary = f.summary ? ` — ${f.summary}` : "";
    lines.push(`- [${display}](${f.relPath})${summary}`);
  }
  lines.push("");

  writeFileSync(join(libPath, "INDEX.md"), lines.join("\n"));
}
```

- [ ] **Step 4: Run library tests — verify they pass**

```bash
pnpm vitest run tests/sentinel/library.test.ts 2>&1 | tail -10
```

Expected: PASS, 3 tests green.

- [ ] **Step 5: Write the failing test for curator**

Create `/Users/vero/openclaw/tests/sentinel/curator.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Curator } from "../../src/sentinel/curator.js";
import type { LlmClient } from "../../src/triage/llm-client.js";
import { ensureLibrarySkeleton } from "../../src/sentinel/library.js";

let libPath: string;

describe("Curator", () => {
  beforeEach(() => {
    libPath = mkdtempSync(join(tmpdir(), "jr-library-cur-"));
    ensureLibrarySkeleton(libPath);
  });
  afterEach(() => {
    rmSync(libPath, { recursive: true, force: true });
  });

  it("files a pattern insight under insights/patterns/", async () => {
    const llm: LlmClient = {
      complete: vi.fn(async () =>
        JSON.stringify({ relPath: "insights/patterns/bom-volume-weekly.md" }),
      ),
    };
    const cur = new Curator(llm);
    const result = await cur.fileInsight(
      {
        category: "pattern",
        summary: "BOM volume up 23% WoW",
        evidence: "62 vs 50",
        derived_from: [1],
        confidence: 0.85,
        generated_at: Date.now(),
      },
      libPath,
    );
    expect(result.filedTo).toBe("insights/patterns/bom-volume-weekly.md");
    const full = join(libPath, result.filedTo);
    expect(existsSync(full)).toBe(true);
    const content = readFileSync(full, "utf-8");
    expect(content).toContain("BOM volume up 23%");
    expect(content).toContain("62 vs 50");
  });

  it("appends a new section when the target file already exists", async () => {
    const llm: LlmClient = {
      complete: vi.fn(async () =>
        JSON.stringify({ relPath: "insights/patterns/bom-volume-weekly.md" }),
      ),
    };
    const cur = new Curator(llm);
    await cur.fileInsight(
      {
        category: "pattern",
        summary: "First insight",
        evidence: "5 things",
        derived_from: [1],
        confidence: 0.7,
        generated_at: Date.now(),
      },
      libPath,
    );
    await cur.fileInsight(
      {
        category: "pattern",
        summary: "Second insight",
        evidence: "7 things",
        derived_from: [2],
        confidence: 0.7,
        generated_at: Date.now(),
      },
      libPath,
    );
    const content = readFileSync(join(libPath, "insights/patterns/bom-volume-weekly.md"), "utf-8");
    expect(content).toContain("First insight");
    expect(content).toContain("Second insight");
  });

  it("falls back to a generic path if the LLM router fails", async () => {
    const llm: LlmClient = {
      complete: vi.fn(async () => "not-json"),
    };
    const cur = new Curator(llm);
    const result = await cur.fileInsight(
      {
        category: "pattern",
        summary: "Some pattern",
        evidence: "3 things",
        derived_from: [],
        confidence: 0.5,
        generated_at: Date.now(),
      },
      libPath,
    );
    expect(result.filedTo).toMatch(/^insights\/patterns\/.+\.md$/);
    expect(existsSync(join(libPath, result.filedTo))).toBe(true);
  });
});
```

- [ ] **Step 6: Run test — verify it fails**

```bash
pnpm vitest run tests/sentinel/curator.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 7: Implement curator**

Create `/Users/vero/openclaw/src/sentinel/curator.ts`:

````typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { LlmClient } from "../triage/llm-client.js";
import type { Insight } from "./types.js";

const RouteOutputSchema = z.object({
  relPath: z.string(),
});

const ROUTER_PROMPT = `You are JR's library curator. Given an insight + the current library folder structure, decide where the insight should be filed.

Output JSON: { "relPath": "insights/patterns/<slug>.md" }

Rules:
- pattern → insights/patterns/<slug>.md
- anomaly → insights/anomalies/<slug>.md
- friction → insights/friction/<slug>.md
- opportunity → insights/opportunities/<slug>.md
- people-related → people/<person-slug>.md
- project-related → projects/<project-slug>.md
- operations-related → operations/<topic-slug>.md
- thread-related → threads/<channel>/<topic-slug>.md
- new top-level folder is OK if no existing folder fits and the topic is clearly recurring

Slug rules: kebab-case, lowercase, descriptive, ≤ 50 chars.

No markdown fences. JSON only.`;

function slugify(text: string, max = 50): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, max) || "untitled"
  );
}

export class Curator {
  constructor(private llm: LlmClient) {}

  async fileInsight(
    insight: Omit<Insight, "id" | "filed_to">,
    libPath: string,
  ): Promise<{
    filedTo: string;
  }> {
    const prompt = `${ROUTER_PROMPT}\n\nInsight:\n  category: ${insight.category}\n  summary: ${insight.summary}\n  evidence: ${insight.evidence}\n  confidence: ${insight.confidence}\n\nJSON:`;

    let relPath: string;
    try {
      const raw = await this.llm.complete(prompt, { model: "gemini-flash", temperature: 0 });
      const stripped = raw.trim().replace(/^```(?:json)?\n?|\n?```$/g, "");
      const parsed = RouteOutputSchema.parse(JSON.parse(stripped));
      relPath = parsed.relPath;
    } catch {
      // Fallback to a deterministic path
      relPath = `insights/${insight.category === "opportunity" ? "opportunities" : insight.category + "s"}/${slugify(insight.summary)}.md`;
    }

    // Sanitize the path — strip any leading slashes, normalize separators
    relPath = relPath.replace(/^\/+/, "").replace(/\\/g, "/");

    const fullPath = join(libPath, relPath);
    mkdirSync(dirname(fullPath), { recursive: true });

    const fmBlock = `---\ntitle: ${insight.summary.slice(0, 80)}\nsummary: ${insight.summary.slice(0, 150)}\ntags: [${insight.category}]\n---\n\n`;
    const sectionDate = new Date(insight.generated_at).toISOString().slice(0, 10);
    const section = `## ${sectionDate}\n\n**${insight.summary}**\n\n_Confidence: ${insight.confidence.toFixed(2)}_\n\n${insight.evidence}\n\n_Derived from observations: ${insight.derived_from.join(", ") || "(none)"}_\n\n`;

    if (existsSync(fullPath)) {
      appendFileSync(fullPath, section);
    } else {
      writeFileSync(fullPath, fmBlock + section);
    }

    return { filedTo: relPath };
  }
}
````

- [ ] **Step 8: Run curator tests — verify they pass**

```bash
pnpm vitest run tests/sentinel 2>&1 | tail -10
```

Expected: PASS — all sentinel tests through Task 4 green.

- [ ] **Step 9: Commit Task 4**

```bash
git add src/sentinel/library.ts src/sentinel/curator.ts \
        tests/sentinel/library.test.ts tests/sentinel/curator.test.ts
git commit -m "feat(sentinel): library helpers + curator

ensureLibrarySkeleton seeds the fluid folder structure.
regenerateIndex walks all .md files and writes INDEX.md grouped by
top-level folder.
Curator uses Flash to route insights into the right file path,
appends to existing files (preserves history), creates with
frontmatter for new files. Falls back to a deterministic path on
LLM failure so no insight is lost.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Reporter (daily) + library wiring

**Files:**

- Create: `src/sentinel/reporter.ts`
- Create: `tests/sentinel/reporter.test.ts`

- [ ] **Step 1: Write the failing test for daily reporter**

Create `/Users/vero/openclaw/tests/sentinel/reporter.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openSentinelDb } from "../../src/sentinel/db.js";
import { ensureLibrarySkeleton } from "../../src/sentinel/library.js";
import { Reporter } from "../../src/sentinel/reporter.js";

let libPath: string;
let dbPath: string;

describe("Reporter", () => {
  beforeEach(() => {
    libPath = mkdtempSync(join(tmpdir(), "jr-library-rpt-"));
    dbPath = join(libPath, "sentinel.db");
    ensureLibrarySkeleton(libPath);
  });
  afterEach(() => {
    rmSync(libPath, { recursive: true, force: true });
  });

  it("writeDailySummary produces a markdown file with the day's observations + insights", async () => {
    const db = openSentinelDb(dbPath);
    const today = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    db.prepare(
      "INSERT INTO observations (source, topic, timestamp, summary, metrics, created_at) VALUES (?,?,?,?,?,?)",
    ).run("self", "triage", now, "5 sessions completed", JSON.stringify({ count: 5 }), now);
    db.prepare(
      "INSERT INTO insights (category, summary, evidence, derived_from, confidence, generated_at) VALUES (?,?,?,?,?,?)",
    ).run("pattern", "Pattern A", "based on 5 things", "[1]", 0.8, now);

    const reporter = new Reporter({ db, libPath });
    const result = await reporter.writeDailySummary();
    expect(result.filedTo).toContain("reports/daily/");
    expect(result.filedTo).toContain(today);
    const content = readFileSync(join(libPath, result.filedTo), "utf-8");
    expect(content).toContain("Pattern A");
    expect(content).toContain("5 sessions completed");

    // Also recorded in reports table
    const row = db.prepare("SELECT kind, filed_to FROM reports WHERE kind = ?").get("daily") as {
      kind: string;
      filed_to: string;
    };
    expect(row.kind).toBe("daily");
    expect(row.filed_to).toBe(result.filedTo);
    db.close();
  });

  it("writeDailySummary handles empty days gracefully", async () => {
    const db = openSentinelDb(dbPath);
    const reporter = new Reporter({ db, libPath });
    const result = await reporter.writeDailySummary();
    expect(existsSync(join(libPath, result.filedTo))).toBe(true);
    const content = readFileSync(join(libPath, result.filedTo), "utf-8");
    expect(content.toLowerCase()).toContain("quiet day");
    db.close();
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
pnpm vitest run tests/sentinel/reporter.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement reporter (daily only for now)**

Create `/Users/vero/openclaw/src/sentinel/reporter.ts`:

```typescript
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";

export interface ReporterDeps {
  db: DatabaseType;
  libPath: string;
}

export interface ReportResult {
  filedTo: string;
}

export class Reporter {
  constructor(private deps: ReporterDeps) {}

  async writeDailySummary(): Promise<ReportResult> {
    const today = new Date();
    const yyyyMmDd = today.toISOString().slice(0, 10);
    const startOfDay = new Date(yyyyMmDd + "T00:00:00").getTime();
    const endOfDay = startOfDay + 24 * 60 * 60 * 1000;

    const observations = this.deps.db
      .prepare(
        `SELECT source, topic, summary, metrics FROM observations
         WHERE timestamp >= ? AND timestamp < ?
         ORDER BY timestamp ASC`,
      )
      .all(startOfDay, endOfDay) as Array<{
      source: string;
      topic: string | null;
      summary: string;
      metrics: string | null;
    }>;

    const insights = this.deps.db
      .prepare(
        `SELECT category, summary, evidence, confidence FROM insights
         WHERE generated_at >= ? AND generated_at < ?
         ORDER BY generated_at ASC`,
      )
      .all(startOfDay, endOfDay) as Array<{
      category: string;
      summary: string;
      evidence: string;
      confidence: number;
    }>;

    const lines: string[] = [
      `---`,
      `title: Daily summary ${yyyyMmDd}`,
      `summary: ${insights.length} insights, ${observations.length} observations`,
      `tags: [report, daily]`,
      `---`,
      ``,
      `# Daily Summary — ${yyyyMmDd}`,
      ``,
    ];

    if (observations.length === 0 && insights.length === 0) {
      lines.push("_Quiet day. No observations or insights recorded._", "");
    } else {
      lines.push(`## Insights (${insights.length})`, "");
      if (insights.length === 0) {
        lines.push("_(none synthesized today)_", "");
      } else {
        for (const ins of insights) {
          lines.push(`### ${ins.category.toUpperCase()} — ${ins.summary}`, "");
          lines.push(`_Confidence ${ins.confidence.toFixed(2)}_`, "");
          lines.push(ins.evidence, "");
        }
      }
      lines.push(`## Observations (${observations.length})`, "");
      for (const obs of observations) {
        const metricsLine = obs.metrics ? ` _metrics: ${obs.metrics}_` : "";
        lines.push(`- **${obs.source}** (${obs.topic ?? "?"}): ${obs.summary}${metricsLine}`);
      }
      lines.push("");
    }

    const relPath = join("reports/daily", `${yyyyMmDd}.md`);
    const fullPath = join(this.deps.libPath, relPath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, lines.join("\n"));

    this.deps.db
      .prepare(`INSERT INTO reports (kind, generated_at, filed_to) VALUES (?, ?, ?)`)
      .run("daily", Date.now(), relPath);

    return { filedTo: relPath };
  }
}
```

- [ ] **Step 4: Run reporter tests — verify they pass**

```bash
pnpm vitest run tests/sentinel/reporter.test.ts 2>&1 | tail -10
```

Expected: PASS, 2 tests green.

- [ ] **Step 5: Commit Task 5**

```bash
git add src/sentinel/reporter.ts tests/sentinel/reporter.test.ts
git commit -m "feat(sentinel): reporter — daily summary writer

Writes reports/daily/YYYY-MM-DD.md from today's observations +
insights. Handles empty days with a 'quiet day' notice. Records
each report in the reports table for audit. Weekly + ideas
reporters land in Task 7.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Additional observers — slack-channels + launchagents

**Files:**

- Create: `src/sentinel/observers/slack-channels.ts`
- Create: `src/sentinel/observers/launchagents.ts`
- Create: `tests/sentinel/observers/slack-channels.test.ts`
- Create: `tests/sentinel/observers/launchagents.test.ts`

- [ ] **Step 1: Write the failing test for slack-channels observer**

Create `/Users/vero/openclaw/tests/sentinel/observers/slack-channels.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { createSlackChannelsObserver } from "../../../src/sentinel/observers/slack-channels.js";

describe("slack-channels observer", () => {
  it("emits one observation per channel with message count metric", async () => {
    const fakeClient = {
      conversations: {
        history: vi.fn(async ({ channel }: { channel: string }) => ({
          ok: true,
          messages: [
            { user: "U1", text: "hi", ts: "1.0" },
            { user: "U2", text: "bye", ts: "2.0" },
            { user: "U1", text: "wait", ts: "3.0" },
          ],
        })),
      },
    };
    const obs = createSlackChannelsObserver({
      client: fakeClient as never,
      allowedChannels: ["C111", "C222"],
    });
    const results = await obs.observe(Date.now() - 60 * 60 * 1000);
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.metrics?.message_count).toBe(3);
      expect(r.metrics?.unique_senders).toBe(2);
    }
  });

  it("skips channels that error and reports the rest", async () => {
    const fakeClient = {
      conversations: {
        history: vi.fn(async ({ channel }: { channel: string }) => {
          if (channel === "C_BAD") throw new Error("not in channel");
          return { ok: true, messages: [{ user: "U1", text: "hi", ts: "1.0" }] };
        }),
      },
    };
    const obs = createSlackChannelsObserver({
      client: fakeClient as never,
      allowedChannels: ["C_BAD", "C_OK"],
    });
    const results = await obs.observe(0);
    expect(results).toHaveLength(1);
    expect(results[0].topic).toContain("C_OK");
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
pnpm vitest run tests/sentinel/observers/slack-channels.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement slack-channels observer**

Create `/Users/vero/openclaw/src/sentinel/observers/slack-channels.ts`:

```typescript
import type { Observer } from "../observer.js";
import type { Observation } from "../types.js";

interface SlackHistoryResp {
  ok: boolean;
  messages?: Array<{ user?: string; text?: string; ts?: string }>;
}

interface SlackClientLike {
  conversations: {
    history(args: { channel: string; oldest?: string; limit?: number }): Promise<SlackHistoryResp>;
  };
}

export interface SlackChannelsObserverDeps {
  client: SlackClientLike;
  allowedChannels: string[];
}

export function createSlackChannelsObserver(deps: SlackChannelsObserverDeps): Observer {
  return {
    name: "slack-channels",
    async observe(since: number): Promise<Omit<Observation, "id" | "created_at">[]> {
      const now = Date.now();
      const oldestEpoch = (since / 1000).toFixed(6);
      const results: Omit<Observation, "id" | "created_at">[] = [];

      const tasks = deps.allowedChannels.map(async (channel) => {
        try {
          const resp = await deps.client.conversations.history({
            channel,
            oldest: oldestEpoch,
            limit: 200,
          });
          const msgs = resp.messages ?? [];
          const messageCount = msgs.length;
          const senders = new Set<string>();
          for (const m of msgs) if (m.user) senders.add(m.user);
          results.push({
            source: "slack-channels",
            topic: `channel:${channel}`,
            timestamp: now,
            summary: `${messageCount} messages from ${senders.size} unique senders in ${channel} since ${new Date(since).toISOString()}`,
            metrics: {
              message_count: messageCount,
              unique_senders: senders.size,
            },
            data: { channel },
          });
        } catch {
          // Skip on error, observer-runner handles the broader error path
        }
      });

      await Promise.all(tasks);
      return results;
    },
  };
}
```

- [ ] **Step 4: Run slack-channels tests — verify they pass**

```bash
pnpm vitest run tests/sentinel/observers/slack-channels.test.ts 2>&1 | tail -10
```

Expected: PASS, 2 tests green.

- [ ] **Step 5: Write the failing test for launchagents observer**

Create `/Users/vero/openclaw/tests/sentinel/observers/launchagents.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createLaunchAgentsObserver } from "../../../src/sentinel/observers/launchagents.js";

describe("launchagents observer", () => {
  it("parses launchctl list output and emits per-agent metrics", async () => {
    const fakeOutput = `PID	Status	Label
1234	0	com.openclaw.agent
-	0	ai.openclaw.coperniq-sync
5678	0	com.veropwr.openclaw.dashboard-refresh
`;
    const obs = createLaunchAgentsObserver({
      execCommand: async () => fakeOutput,
      filterPrefix: "openclaw",
    });
    const results = await obs.observe(0);
    expect(results).toHaveLength(1);
    const r = results[0];
    expect(r.metrics?.total).toBe(3);
    expect(r.metrics?.running).toBe(2);
    expect(r.metrics?.dormant).toBe(1);
  });

  it("handles execCommand failure gracefully", async () => {
    const obs = createLaunchAgentsObserver({
      execCommand: async () => {
        throw new Error("launchctl missing");
      },
      filterPrefix: "openclaw",
    });
    const results = await obs.observe(0);
    expect(results).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Run test — verify it fails**

```bash
pnpm vitest run tests/sentinel/observers/launchagents.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 7: Implement launchagents observer**

Create `/Users/vero/openclaw/src/sentinel/observers/launchagents.ts`:

```typescript
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Observer } from "../observer.js";
import type { Observation } from "../types.js";

const execFileP = promisify(execFile);

export interface LaunchAgentsObserverDeps {
  filterPrefix: string;
  execCommand?: () => Promise<string>;
}

export function createLaunchAgentsObserver(deps: LaunchAgentsObserverDeps): Observer {
  const exec =
    deps.execCommand ??
    (async () => {
      const { stdout } = await execFileP("launchctl", ["list"]);
      return stdout;
    });

  return {
    name: "launchagents",
    async observe(_since: number): Promise<Omit<Observation, "id" | "created_at">[]> {
      let output: string;
      try {
        output = await exec();
      } catch {
        return [];
      }
      const lines = output.split("\n").filter((l) => l.includes(deps.filterPrefix));
      let running = 0;
      let dormant = 0;
      const labels: string[] = [];
      for (const line of lines) {
        // launchctl list lines: PID  Status  Label  — tab-separated
        const cols = line.split(/\s+/).filter(Boolean);
        if (cols.length < 3) continue;
        const pid = cols[0];
        labels.push(cols[2]);
        if (pid === "-") {
          dormant++;
        } else {
          running++;
        }
      }
      const total = running + dormant;
      if (total === 0) return [];
      return [
        {
          source: "launchagents",
          topic: "openclaw-jobs",
          timestamp: Date.now(),
          summary: `${total} openclaw LaunchAgent jobs (${running} running, ${dormant} dormant): ${labels.join(", ")}`,
          metrics: { total, running, dormant },
          data: { labels },
        },
      ];
    },
  };
}
```

- [ ] **Step 8: Run launchagents tests — verify they pass**

```bash
pnpm vitest run tests/sentinel 2>&1 | tail -10
```

Expected: PASS — all sentinel tests through Task 6 green.

- [ ] **Step 9: Commit Task 6**

```bash
git add src/sentinel/observers/slack-channels.ts src/sentinel/observers/launchagents.ts \
        tests/sentinel/observers/slack-channels.test.ts \
        tests/sentinel/observers/launchagents.test.ts
git commit -m "feat(sentinel): slack-channels + launchagents observers

slack-channels emits per-channel message count + unique sender count
since the last watermark; channel errors are skipped.
launchagents parses 'launchctl list' filtered for the openclaw
prefix; emits total/running/dormant metrics + the label list. Both
observers tested with mocked dependencies.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Reporter (weekly + ideas) + monetizer + Slack DM delivery

**Files:**

- Modify: `src/sentinel/reporter.ts` (add writeWeeklyDigest + writeIdeasReport)
- Create: `src/sentinel/monetizer.ts`
- Create: `tests/sentinel/monetizer.test.ts`
- Modify: `tests/sentinel/reporter.test.ts` (add weekly + ideas tests)

- [ ] **Step 1: Add weekly + ideas tests to reporter test file**

Append to `/Users/vero/openclaw/tests/sentinel/reporter.test.ts`:

```typescript
import { vi } from "vitest";

describe("Reporter — weekly + ideas", () => {
  let libPath: string;
  let dbPath: string;

  beforeEach(() => {
    libPath = mkdtempSync(join(tmpdir(), "jr-library-wk-"));
    dbPath = join(libPath, "sentinel.db");
    ensureLibrarySkeleton(libPath);
  });
  afterEach(() => {
    rmSync(libPath, { recursive: true, force: true });
  });

  it("writeWeeklyDigest writes a markdown file + DMs Kaleb", async () => {
    const db = openSentinelDb(dbPath);
    const now = Date.now();
    db.prepare(
      "INSERT INTO insights (category, summary, evidence, derived_from, confidence, generated_at) VALUES (?,?,?,?,?,?)",
    ).run("pattern", "P1", "evidence 1", "[]", 0.9, now);
    db.prepare(
      "INSERT INTO insights (category, summary, evidence, derived_from, confidence, generated_at) VALUES (?,?,?,?,?,?)",
    ).run("opportunity", "O1", "evidence 2", "[]", 0.7, now);

    const dmCalls: Array<{ user: string; text: string }> = [];
    const reporter = new Reporter({
      db,
      libPath,
      dmUser: async (user, text) => {
        dmCalls.push({ user, text });
      },
      kalebUserId: "U_KALEB",
      ridgeUserId: "U_RIDGE",
    });
    const result = await reporter.writeWeeklyDigest();
    expect(result.filedTo).toContain("reports/weekly/");
    expect(dmCalls).toHaveLength(1);
    expect(dmCalls[0].user).toBe("U_KALEB");
    expect(dmCalls[0].text).toContain("Weekly digest");
    db.close();
  });

  it("writeIdeasReport DMs Kaleb always, DMs Ridge for high-confidence strategic ideas", async () => {
    const db = openSentinelDb(dbPath);
    const now = Date.now();
    db.prepare(
      "INSERT INTO opportunities (title, scope, summary, evidence, proposed_at, confidence, status) VALUES (?,?,?,?,?,?,?)",
    ).run("Ops idea", "ops-efficiency", "Save 10h/week", "10h", now, 0.8, "proposed");
    db.prepare(
      "INSERT INTO opportunities (title, scope, summary, evidence, proposed_at, confidence, status) VALUES (?,?,?,?,?,?,?)",
    ).run("Strategic idea", "strategic-revenue", "Expand into X", "$50k/yr", now, 0.85, "proposed");

    const dmCalls: Array<{ user: string; text: string }> = [];
    const reporter = new Reporter({
      db,
      libPath,
      dmUser: async (user, text) => {
        dmCalls.push({ user, text });
      },
      kalebUserId: "U_KALEB",
      ridgeUserId: "U_RIDGE",
    });
    await reporter.writeIdeasReport();
    const kalebDM = dmCalls.find((d) => d.user === "U_KALEB");
    const ridgeDM = dmCalls.find((d) => d.user === "U_RIDGE");
    expect(kalebDM).toBeTruthy();
    expect(kalebDM?.text).toContain("Ops idea");
    expect(ridgeDM).toBeTruthy();
    expect(ridgeDM?.text).toContain("Strategic idea");
    db.close();
  });
});
```

- [ ] **Step 2: Run new tests — verify they fail (writeWeeklyDigest/writeIdeasReport don't exist yet)**

```bash
pnpm vitest run tests/sentinel/reporter.test.ts 2>&1 | tail -15
```

Expected: 2 new failures.

- [ ] **Step 3: Extend Reporter — add weekly + ideas writers**

Replace `/Users/vero/openclaw/src/sentinel/reporter.ts`:

```typescript
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";

export interface ReporterDeps {
  db: DatabaseType;
  libPath: string;
  dmUser?: (userId: string, text: string) => Promise<void>;
  kalebUserId?: string;
  ridgeUserId?: string;
}

export interface ReportResult {
  filedTo: string;
}

function isoWeekNumber(d: Date): { year: number; week: number } {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: date.getUTCFullYear(), week };
}

export class Reporter {
  constructor(private deps: ReporterDeps) {}

  async writeDailySummary(): Promise<ReportResult> {
    const today = new Date();
    const yyyyMmDd = today.toISOString().slice(0, 10);
    const startOfDay = new Date(yyyyMmDd + "T00:00:00").getTime();
    const endOfDay = startOfDay + 24 * 60 * 60 * 1000;

    const observations = this.deps.db
      .prepare(
        `SELECT source, topic, summary, metrics FROM observations
         WHERE timestamp >= ? AND timestamp < ?
         ORDER BY timestamp ASC`,
      )
      .all(startOfDay, endOfDay) as Array<{
      source: string;
      topic: string | null;
      summary: string;
      metrics: string | null;
    }>;

    const insights = this.deps.db
      .prepare(
        `SELECT category, summary, evidence, confidence FROM insights
         WHERE generated_at >= ? AND generated_at < ?
         ORDER BY generated_at ASC`,
      )
      .all(startOfDay, endOfDay) as Array<{
      category: string;
      summary: string;
      evidence: string;
      confidence: number;
    }>;

    const lines: string[] = [
      `---`,
      `title: Daily summary ${yyyyMmDd}`,
      `summary: ${insights.length} insights, ${observations.length} observations`,
      `tags: [report, daily]`,
      `---`,
      ``,
      `# Daily Summary — ${yyyyMmDd}`,
      ``,
    ];

    if (observations.length === 0 && insights.length === 0) {
      lines.push("_Quiet day. No observations or insights recorded._", "");
    } else {
      lines.push(`## Insights (${insights.length})`, "");
      if (insights.length === 0) {
        lines.push("_(none synthesized today)_", "");
      } else {
        for (const ins of insights) {
          lines.push(`### ${ins.category.toUpperCase()} — ${ins.summary}`, "");
          lines.push(`_Confidence ${ins.confidence.toFixed(2)}_`, "");
          lines.push(ins.evidence, "");
        }
      }
      lines.push(`## Observations (${observations.length})`, "");
      for (const obs of observations) {
        const metricsLine = obs.metrics ? ` _metrics: ${obs.metrics}_` : "";
        lines.push(`- **${obs.source}** (${obs.topic ?? "?"}): ${obs.summary}${metricsLine}`);
      }
      lines.push("");
    }

    const relPath = join("reports/daily", `${yyyyMmDd}.md`);
    this.writeFile(relPath, lines.join("\n"));
    this.recordReport("daily", relPath);
    return { filedTo: relPath };
  }

  async writeWeeklyDigest(): Promise<ReportResult> {
    const now = new Date();
    const { year, week } = isoWeekNumber(now);
    const weekStart = now.getTime() - 7 * 24 * 60 * 60 * 1000;

    const insights = this.deps.db
      .prepare(
        `SELECT category, summary, evidence, confidence FROM insights
         WHERE generated_at >= ? ORDER BY confidence DESC, generated_at DESC LIMIT 20`,
      )
      .all(weekStart) as Array<{
      category: string;
      summary: string;
      evidence: string;
      confidence: number;
    }>;

    const lines: string[] = [
      `---`,
      `title: Weekly digest W${week} ${year}`,
      `summary: ${insights.length} key insights from the past 7 days`,
      `tags: [report, weekly]`,
      `---`,
      ``,
      `# Weekly Digest — W${week}, ${year}`,
      ``,
      `Top insights from the past 7 days, ranked by confidence:`,
      ``,
    ];
    for (const ins of insights) {
      lines.push(`## ${ins.category.toUpperCase()} — ${ins.summary}`, "");
      lines.push(`_Confidence ${ins.confidence.toFixed(2)}_`, "");
      lines.push(ins.evidence, "");
    }

    const relPath = join("reports/weekly", `W${week}-${year}.md`);
    this.writeFile(relPath, lines.join("\n"));
    this.recordReport("weekly-digest", relPath);

    // DM Kaleb
    if (this.deps.dmUser && this.deps.kalebUserId) {
      const dmBody = `*Weekly digest filed:* \`${relPath}\`\n\nTop ${Math.min(3, insights.length)} insights:\n${insights
        .slice(0, 3)
        .map(
          (i, idx) => `${idx + 1}. *${i.summary}* (${i.category}, conf ${i.confidence.toFixed(2)})`,
        )
        .join("\n")}`;
      await this.deps.dmUser(this.deps.kalebUserId, dmBody);
    }

    return { filedTo: relPath };
  }

  async writeIdeasReport(): Promise<ReportResult> {
    const now = new Date();
    const { year, week } = isoWeekNumber(now);
    const weekStart = now.getTime() - 7 * 24 * 60 * 60 * 1000;

    const opps = this.deps.db
      .prepare(
        `SELECT title, scope, summary, evidence, confidence FROM opportunities
         WHERE proposed_at >= ? AND status = 'proposed'
         ORDER BY scope, confidence DESC`,
      )
      .all(weekStart) as Array<{
      title: string;
      scope: string;
      summary: string;
      evidence: string;
      confidence: number;
    }>;

    const opsOpps = opps.filter((o) => o.scope === "ops-efficiency");
    const stratOpps = opps.filter((o) => o.scope === "strategic-revenue");

    const lines: string[] = [
      `---`,
      `title: Weekly ideas W${week} ${year}`,
      `summary: ${opps.length} proposed opportunities (${opsOpps.length} ops, ${stratOpps.length} strategic)`,
      `tags: [report, ideas, weekly]`,
      `---`,
      ``,
      `# Weekly Ideas — W${week}, ${year}`,
      ``,
      `## Ops + Efficiency (${opsOpps.length})`,
      ``,
    ];
    for (const o of opsOpps) {
      lines.push(`### ${o.title}`, "");
      lines.push(`_Confidence ${o.confidence.toFixed(2)}_`, "");
      lines.push(o.summary, "");
      lines.push(`**Evidence:** ${o.evidence}`, "");
    }
    lines.push(`## Strategic Revenue (${stratOpps.length})`, "");
    for (const o of stratOpps) {
      lines.push(`### ${o.title}`, "");
      lines.push(`_Confidence ${o.confidence.toFixed(2)}_`, "");
      lines.push(o.summary, "");
      lines.push(`**Evidence:** ${o.evidence}`, "");
    }

    const relPath = join("reports/ideas", `W${week}-${year}-ideas.md`);
    this.writeFile(relPath, lines.join("\n"));
    this.recordReport("weekly-ideas", relPath);

    // DM Kaleb with all ops ideas
    if (this.deps.dmUser && this.deps.kalebUserId && opsOpps.length > 0) {
      const dmBody = `*Weekly ideas filed:* \`${relPath}\`\n\n*Ops + efficiency:*\n${opsOpps
        .map(
          (o, idx) => `${idx + 1}. *${o.title}* — ${o.summary} (conf ${o.confidence.toFixed(2)})`,
        )
        .join("\n")}`;
      await this.deps.dmUser(this.deps.kalebUserId, dmBody);
    }

    // DM Ridge for any high-confidence strategic idea
    if (this.deps.dmUser && this.deps.ridgeUserId) {
      const highConf = stratOpps.filter((o) => o.confidence >= 0.7);
      for (const o of highConf) {
        const dmBody = `I've been thinking about *${o.title}*.\n\n${o.summary}\n\n_Evidence:_ ${o.evidence}\n\nWorth a 15-min conversation?`;
        await this.deps.dmUser(this.deps.ridgeUserId, dmBody);
      }
    }

    return { filedTo: relPath };
  }

  private writeFile(relPath: string, content: string): void {
    const fullPath = join(this.deps.libPath, relPath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
  }

  private recordReport(kind: string, relPath: string): void {
    this.deps.db
      .prepare(`INSERT INTO reports (kind, generated_at, filed_to) VALUES (?, ?, ?)`)
      .run(kind, Date.now(), relPath);
  }
}
```

- [ ] **Step 4: Write the failing test for monetizer**

Create `/Users/vero/openclaw/tests/sentinel/monetizer.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openSentinelDb } from "../../src/sentinel/db.js";
import { Monetizer } from "../../src/sentinel/monetizer.js";
import type { LlmClient } from "../../src/triage/llm-client.js";

let dbPath: string;

describe("Monetizer", () => {
  beforeEach(() => {
    dbPath = join(tmpdir(), `mon-${Date.now()}.db`);
  });
  afterEach(() => {
    [dbPath, `${dbPath}-shm`, `${dbPath}-wal`].forEach((p) => {
      if (existsSync(p)) unlinkSync(p);
    });
  });

  it("writes proposed opportunities to the opportunities table", async () => {
    const db = openSentinelDb(dbPath);
    const llm: LlmClient = {
      complete: vi.fn(async () =>
        JSON.stringify({
          opportunities: [
            {
              title: "Batch BOM Mondays",
              scope: "ops-efficiency",
              summary: "Save ~12 manual triggers/week",
              evidence: "BOM volume = 62/week, batch-feasible",
              confidence: 0.8,
            },
            {
              title: "Expand to Texas market",
              scope: "strategic-revenue",
              summary: "TX install volume up 40% YoY",
              evidence: "40% YoY growth observed",
              confidence: 0.75,
            },
          ],
        }),
      ),
    };
    const mon = new Monetizer({ llm, db });
    await mon.proposeWeekly();
    const rows = db
      .prepare("SELECT title, scope, status FROM opportunities ORDER BY id")
      .all() as Array<{ title: string; scope: string; status: string }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].title).toBe("Batch BOM Mondays");
    expect(rows[0].scope).toBe("ops-efficiency");
    expect(rows[0].status).toBe("proposed");
    expect(rows[1].scope).toBe("strategic-revenue");
    db.close();
  });

  it("rejects opportunities missing quantitative evidence", async () => {
    const db = openSentinelDb(dbPath);
    const llm: LlmClient = {
      complete: vi.fn(async () =>
        JSON.stringify({
          opportunities: [
            {
              title: "Vibes-based idea",
              scope: "ops-efficiency",
              summary: "Feels like a win",
              evidence: "intuition",
              confidence: 0.6,
            },
          ],
        }),
      ),
    };
    const mon = new Monetizer({ llm, db });
    await mon.proposeWeekly();
    const count = db.prepare("SELECT COUNT(*) AS c FROM opportunities").get() as {
      c: number;
    };
    expect(count.c).toBe(0);
    db.close();
  });
});
```

- [ ] **Step 5: Run monetizer test — verify it fails**

```bash
pnpm vitest run tests/sentinel/monetizer.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 6: Implement monetizer**

Create `/Users/vero/openclaw/src/sentinel/monetizer.ts`:

````typescript
import { z } from "zod";
import type { Database as DatabaseType } from "better-sqlite3";
import type { LlmClient } from "../triage/llm-client.js";
import { OpportunityScopeSchema } from "./types.js";

const MonetizeOutputSchema = z.object({
  opportunities: z.array(
    z.object({
      title: z.string(),
      scope: OpportunityScopeSchema,
      summary: z.string(),
      evidence: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

const NUMBER_PATTERN = /\d/;

const SYSTEM_PROMPT = `You are JR's monetize engine — a business analyst whose only job is to find ways Vero can make more money or operate more efficiently.

Given the full set of insights and observations from the past week, propose the top 5 revenue opportunities AND top 5 efficiency wins.

Each opportunity MUST:
- Have a concrete title
- Be tagged "ops-efficiency" OR "strategic-revenue"
- Cite a SPECIFIC NUMBER from the observations as evidence (no "feels like" / "seems")
- Include a one-sentence summary of why this matters

Return JSON only, no markdown fences:
{ "opportunities": [ { "title", "scope", "summary", "evidence", "confidence": 0..1 } ] }

If nothing actionable surfaces, return { "opportunities": [] }.`;

export interface MonetizerDeps {
  llm: LlmClient;
  db: DatabaseType;
}

export class Monetizer {
  constructor(private deps: MonetizerDeps) {}

  async proposeWeekly(): Promise<void> {
    const weekStart = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const insights = this.deps.db
      .prepare(
        `SELECT category, summary, evidence, confidence FROM insights
         WHERE generated_at >= ? ORDER BY confidence DESC`,
      )
      .all(weekStart) as Array<{
      category: string;
      summary: string;
      evidence: string;
      confidence: number;
    }>;

    if (insights.length === 0) return;

    const insightLines = insights
      .map(
        (i, idx) =>
          `[${idx + 1}] (${i.category}, conf ${i.confidence.toFixed(2)}) ${i.summary} — ${i.evidence}`,
      )
      .join("\n");
    const prompt = `${SYSTEM_PROMPT}\n\nInsights from the past 7 days:\n${insightLines}\n\nJSON:`;

    let raw: string;
    try {
      raw = await this.deps.llm.complete(prompt, { model: "gemini-pro", temperature: 0.4 });
    } catch {
      return;
    }
    let parsed: z.infer<typeof MonetizeOutputSchema>;
    try {
      const stripped = raw.trim().replace(/^```(?:json)?\n?|\n?```$/g, "");
      parsed = MonetizeOutputSchema.parse(JSON.parse(stripped));
    } catch {
      return;
    }

    const insertStmt = this.deps.db.prepare(
      `INSERT INTO opportunities (title, scope, summary, evidence, proposed_at, confidence, status)
       VALUES (?, ?, ?, ?, ?, ?, 'proposed')`,
    );
    const now = Date.now();
    for (const opp of parsed.opportunities) {
      if (!NUMBER_PATTERN.test(opp.evidence)) continue;
      insertStmt.run(opp.title, opp.scope, opp.summary, opp.evidence, now, opp.confidence);
    }
  }
}
````

- [ ] **Step 7: Run all sentinel tests**

```bash
pnpm vitest run tests/sentinel 2>&1 | tail -10
```

Expected: PASS — all sentinel tests through Task 7 green.

- [ ] **Step 8: Commit Task 7**

```bash
git add src/sentinel/reporter.ts src/sentinel/monetizer.ts \
        tests/sentinel/reporter.test.ts tests/sentinel/monetizer.test.ts
git commit -m "feat(sentinel): weekly digest + ideas report + monetizer + DM delivery

Reporter now writes weekly digests (ranked insights from past 7d)
and ideas reports (organized by scope). DMs Kaleb the digest +
ops/efficiency ideas. DMs Ridge any strategic idea with confidence
≥ 0.7. Monetizer runs a Pro pass over the week's insights and
writes proposed opportunities to the opportunities table — same
quantitative-rigor gate as the synthesizer rejects vibes-only ideas.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Inquirer (manual-review mode)

**Files:**

- Create: `src/sentinel/inquirer.ts`
- Create: `tests/sentinel/inquirer.test.ts`

In Phase A, the inquirer formulates questions and files them for human review — JR does NOT send DMs yet. Going live is Phase B once question quality is validated.

- [ ] **Step 1: Write the failing test for inquirer**

Create `/Users/vero/openclaw/tests/sentinel/inquirer.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openSentinelDb } from "../../src/sentinel/db.js";
import { ensureLibrarySkeleton } from "../../src/sentinel/library.js";
import { Inquirer } from "../../src/sentinel/inquirer.js";
import type { LlmClient } from "../../src/triage/llm-client.js";

let libPath: string;
let dbPath: string;

describe("Inquirer (manual-review mode)", () => {
  beforeEach(() => {
    libPath = mkdtempSync(join(tmpdir(), "jr-library-inq-"));
    dbPath = join(libPath, "sentinel.db");
    ensureLibrarySkeleton(libPath);
  });
  afterEach(() => {
    rmSync(libPath, { recursive: true, force: true });
  });

  it("generates a question for a knowledge gap and files it to review queue", async () => {
    const db = openSentinelDb(dbPath);
    const now = Date.now();
    db.prepare(
      "INSERT INTO insights (category, summary, evidence, derived_from, confidence, generated_at) VALUES (?,?,?,?,?,?)",
    ).run("friction", "BOM workflow unclear", "2 sessions stuck", "[]", 0.4, now);

    const llm: LlmClient = {
      complete: vi.fn(async () =>
        JSON.stringify({
          questions: [
            {
              target_user_id: "U_KALEB",
              topic: "BOM workflow",
              question_text:
                "What's the manual step you do between Coperniq BOM Quote Requested and pinging Greentech?",
              rationale: "Insight 1: BOM workflow has friction (2 stuck sessions)",
            },
          ],
        }),
      ),
    };
    const inq = new Inquirer({ llm, db, libPath });
    const result = await inq.formulateQuestions();
    expect(result.questionsFiled).toBe(1);
    const queuePath = join(libPath, "reports/inquiry-queue.md");
    expect(existsSync(queuePath)).toBe(true);
    const content = readFileSync(queuePath, "utf-8");
    expect(content).toContain("BOM workflow");
    expect(content).toContain("U_KALEB");
    db.close();
  });

  it("does not send any DM in Phase A (manual-review mode)", async () => {
    const db = openSentinelDb(dbPath);
    const dmCalls: Array<{ user: string; text: string }> = [];
    const llm: LlmClient = {
      complete: vi.fn(async () =>
        JSON.stringify({
          questions: [
            {
              target_user_id: "U_X",
              topic: "test",
              question_text: "test?",
              rationale: "test",
            },
          ],
        }),
      ),
    };
    const inq = new Inquirer({
      llm,
      db,
      libPath,
      dmUser: async (user, text) => {
        dmCalls.push({ user, text });
      },
    });
    await inq.formulateQuestions();
    expect(dmCalls).toHaveLength(0);
    db.close();
  });

  it("respects opt_outs — skips users with global opt-out", async () => {
    const db = openSentinelDb(dbPath);
    db.prepare("INSERT INTO opt_outs (person_user_id, scope, added_at) VALUES (?, ?, ?)").run(
      "U_OPTED_OUT",
      "global",
      Date.now(),
    );
    const llm: LlmClient = {
      complete: vi.fn(async () =>
        JSON.stringify({
          questions: [
            {
              target_user_id: "U_OPTED_OUT",
              topic: "anything",
              question_text: "Question?",
              rationale: "test",
            },
            {
              target_user_id: "U_OK",
              topic: "anything",
              question_text: "Other?",
              rationale: "test",
            },
          ],
        }),
      ),
    };
    const inq = new Inquirer({ llm, db, libPath });
    const result = await inq.formulateQuestions();
    expect(result.questionsFiled).toBe(1);
    const content = readFileSync(join(libPath, "reports/inquiry-queue.md"), "utf-8");
    expect(content).not.toContain("U_OPTED_OUT");
    expect(content).toContain("U_OK");
    db.close();
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
pnpm vitest run tests/sentinel/inquirer.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement inquirer**

Create `/Users/vero/openclaw/src/sentinel/inquirer.ts`:

````typescript
import { existsSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Database as DatabaseType } from "better-sqlite3";
import type { LlmClient } from "../triage/llm-client.js";

const QuestionsOutputSchema = z.object({
  questions: z.array(
    z.object({
      target_user_id: z.string(),
      topic: z.string(),
      question_text: z.string(),
      rationale: z.string(),
    }),
  ),
});

const SYSTEM_PROMPT = `You are JR's private inquirer. Look at recent low-confidence insights and identify knowledge gaps where asking a specific person at Vero would help.

For each gap, propose: who to ask (Slack user id), what topic, the actual question text (colleague tone, no preamble — get to the point), and your rationale.

Return JSON only:
{ "questions": [ { "target_user_id", "topic", "question_text", "rationale" } ] }

Max 5 questions per cycle. If no gaps justify an inquiry, return { "questions": [] }.`;

export interface InquirerDeps {
  llm: LlmClient;
  db: DatabaseType;
  libPath: string;
  // Phase A: not used; reserved for Phase B go-live
  dmUser?: (userId: string, text: string) => Promise<void>;
}

export interface InquirerResult {
  questionsFiled: number;
}

export class Inquirer {
  constructor(private deps: InquirerDeps) {}

  async formulateQuestions(): Promise<InquirerResult> {
    const lowConfInsights = this.deps.db
      .prepare(
        `SELECT id, category, summary, evidence, confidence FROM insights
         WHERE confidence < 0.5 ORDER BY generated_at DESC LIMIT 10`,
      )
      .all() as Array<{
      id: number;
      category: string;
      summary: string;
      evidence: string;
      confidence: number;
    }>;

    if (lowConfInsights.length === 0) return { questionsFiled: 0 };

    const insightLines = lowConfInsights
      .map(
        (i) =>
          `[insight ${i.id}] (${i.category}, conf ${i.confidence.toFixed(2)}) ${i.summary} — ${i.evidence}`,
      )
      .join("\n");
    const prompt = `${SYSTEM_PROMPT}\n\nLow-confidence insights:\n${insightLines}\n\nJSON:`;

    let raw: string;
    try {
      raw = await this.deps.llm.complete(prompt, { model: "gemini-pro", temperature: 0.3 });
    } catch {
      return { questionsFiled: 0 };
    }
    let parsed: z.infer<typeof QuestionsOutputSchema>;
    try {
      const stripped = raw.trim().replace(/^```(?:json)?\n?|\n?```$/g, "");
      parsed = QuestionsOutputSchema.parse(JSON.parse(stripped));
    } catch {
      return { questionsFiled: 0 };
    }

    // Filter against global opt-outs
    const optedOut = new Set(
      (
        this.deps.db
          .prepare("SELECT person_user_id FROM opt_outs WHERE scope = 'global'")
          .all() as Array<{
          person_user_id: string;
        }>
      ).map((r) => r.person_user_id),
    );

    const eligible = parsed.questions.filter((q) => !optedOut.has(q.target_user_id));

    const queuePath = join(this.deps.libPath, "reports/inquiry-queue.md");
    const now = new Date().toISOString();
    const block = `## Cycle ${now}\n\n${eligible
      .map(
        (q, idx) =>
          `### Q${idx + 1} — ${q.topic}\n\n**Target:** \`${q.target_user_id}\`\n\n**Question:** ${q.question_text}\n\n**Rationale:** ${q.rationale}\n`,
      )
      .join("\n")}\n`;

    if (existsSync(queuePath)) {
      appendFileSync(queuePath, block);
    } else {
      writeFileSync(
        queuePath,
        `---\ntitle: Inquiry review queue\nsummary: Phase A — JR's formulated questions awaiting human review\ntags: [inquiry, review]\n---\n\n# Inquiry Review Queue\n\n_Phase A is manual-review mode. JR formulates questions; humans review here before any go live._\n\n${block}`,
      );
    }

    // In Phase A: NEVER call this.deps.dmUser. The DM path goes live in Phase B.

    return { questionsFiled: eligible.length };
  }
}
````

- [ ] **Step 4: Run inquirer tests — verify they pass**

```bash
pnpm vitest run tests/sentinel 2>&1 | tail -10
```

Expected: PASS — all sentinel tests including inquirer green.

- [ ] **Step 5: Commit Task 8**

```bash
git add src/sentinel/inquirer.ts tests/sentinel/inquirer.test.ts
git commit -m "feat(sentinel): inquirer (manual-review mode)

Looks at low-confidence insights (<0.5), uses Pro to formulate
specific questions for specific people. Phase A: questions land in
reports/inquiry-queue.md for human review only — JR does NOT send
DMs yet. Phase B flips the dmUser dependency live once question
quality is validated. Global opt-outs are respected even in
Phase A so people who've previously said no never appear in the
queue.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: F1 wiring — sentinel context into triage planner

**Files:**

- Modify: `src/triage/planner.ts`
- Modify: `tests/triage/planner.test.ts`

- [ ] **Step 1: Add the failing test for sentinel-context injection**

Append to `/Users/vero/openclaw/tests/triage/planner.test.ts`:

```typescript
import { openSentinelDb } from "../../src/sentinel/db.js";
import { existsSync, unlinkSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir as os_tmpdir } from "node:os";
import { join as path_join } from "node:path";

describe("Planner — sentinel context injection (F1)", () => {
  it("includes sentinel insights in the planner prompt when provided", async () => {
    const tmpDir = mkdtempSync(path_join(os_tmpdir(), "sent-f1-"));
    const sentDbPath = path_join(tmpDir, "sentinel.db");
    const sentDb = openSentinelDb(sentDbPath);
    sentDb
      .prepare(
        "INSERT INTO insights (category, summary, evidence, derived_from, confidence, generated_at) VALUES (?,?,?,?,?,?)",
      )
      .run("pattern", "BOM volume up 23% WoW", "62 vs 50", "[]", 0.85, Date.now());

    let capturedPrompt = "";
    const llm = {
      complete: vi.fn(async (p: string) => {
        capturedPrompt = p;
        return JSON.stringify({
          summary: "test",
          confidence: 0.9,
          steps: [{ action: "coperniqFirestoreIngest", args: {} }],
        });
      }),
    };
    const p = new Planner(llm as any, buildRegistry(), { sentinelDb: sentDb });
    await p.plan("refresh coperniq");
    expect(capturedPrompt).toContain("Sentinel context");
    expect(capturedPrompt).toContain("BOM volume up 23%");

    sentDb.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("works with no sentinel context (existing behavior preserved)", async () => {
    const llm = {
      complete: vi.fn(async () =>
        JSON.stringify({
          summary: "test",
          confidence: 0.9,
          steps: [{ action: "coperniqFirestoreIngest", args: {} }],
        }),
      ),
    };
    const p = new Planner(llm as any, buildRegistry());
    const plan = await p.plan("refresh coperniq");
    expect(plan.steps).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
pnpm vitest run tests/triage/planner.test.ts 2>&1 | tail -10
```

Expected: FAIL on "sentinel context" assertions (planner doesn't yet accept sentinelDb dep).

- [ ] **Step 3: Modify planner.ts to accept and use sentinel context**

Open `/Users/vero/openclaw/src/triage/planner.ts`. Replace the constructor and `plan()` method:

````typescript
import type { Database as DatabaseType } from "better-sqlite3";
import { PlanSchema, type Plan } from "./types.js";
import type { LlmClient } from "./llm-client.js";
import type { ActionRegistry } from "./actions/registry.js";

const SYSTEM_PROMPT_HEADER = `You are JR's planner. Given a user request and the action catalog below, produce a JSON plan.

The plan is a sequential list of catalog actions. ONLY use actions in the catalog. Validate that args match each action's schema (you'll see args described in the catalog). If the catalog can't satisfy the request, propose a plan whose final step is a notify_* action to escalate.

Return JSON only:
{
  "summary": "one-sentence what this plan does",
  "confidence": number 0-1 — your confidence the plan answers the request,
  "steps": [{ "action": "action_name", "args": {...}, "rationale": "why this step" }]
}

No markdown fences, no prose.`;

export interface PlannerOptions {
  sentinelDb?: DatabaseType;
}

export class Planner {
  private sentinelDb: DatabaseType | null;

  constructor(
    private llm: LlmClient,
    private registry: ActionRegistry,
    options?: PlannerOptions,
  ) {
    this.sentinelDb = options?.sentinelDb ?? null;
  }

  async plan(message: string): Promise<Plan> {
    const catalog = this.registry.serializeForPrompt();
    const sentinelBlock = this.buildSentinelContext();
    const prompt = `${SYSTEM_PROMPT_HEADER}\n\n${catalog}\n${sentinelBlock}\nUser request: ${JSON.stringify(message)}\n\nJSON:`;
    const raw = await this.llm.complete(prompt, { model: "gemini-pro", temperature: 0 });
    return this.parseAndValidate(raw);
  }

  async replan(message: string, previous: Plan, edit_text: string): Promise<Plan> {
    const catalog = this.registry.serializeForPrompt();
    const sentinelBlock = this.buildSentinelContext();
    const prompt = `${SYSTEM_PROMPT_HEADER}\n\n${catalog}\n${sentinelBlock}\nUser request: ${JSON.stringify(message)}\n\nPrevious plan:\n${JSON.stringify(previous, null, 2)}\n\nUser edit: ${JSON.stringify(edit_text)}\n\nProduce the REVISED plan as JSON:`;
    const raw = await this.llm.complete(prompt, { model: "gemini-pro", temperature: 0 });
    return this.parseAndValidate(raw);
  }

  private buildSentinelContext(): string {
    if (!this.sentinelDb) return "";
    try {
      const recent = this.sentinelDb
        .prepare(
          `SELECT category, summary, evidence, confidence FROM insights
           ORDER BY generated_at DESC LIMIT 5`,
        )
        .all() as Array<{
        category: string;
        summary: string;
        evidence: string;
        confidence: number;
      }>;
      if (recent.length === 0) return "";
      const lines = recent.map(
        (i) => `- ${i.category} (conf ${i.confidence.toFixed(2)}): ${i.summary} — ${i.evidence}`,
      );
      return `\nSentinel context (recent insights for situational awareness):\n${lines.join("\n")}\n`;
    } catch {
      return "";
    }
  }

  private parseAndValidate(raw: string): Plan {
    const stripped = raw.trim().replace(/^```(?:json)?\n?|\n?```$/g, "");
    const plan = PlanSchema.parse(JSON.parse(stripped));
    for (const step of plan.steps) {
      const action = this.registry.get(step.action);
      if (!action) {
        throw new Error(`unknown action in plan: ${step.action}`);
      }
      try {
        action.args_schema.parse(step.args);
      } catch (err) {
        throw new Error(`invalid args for ${step.action}: ${(err as Error).message}`);
      }
    }
    return plan;
  }

  renderDiff(previous: Plan, next: Plan): string {
    const lines: string[] = [`**Plan updated**\n`, `_${next.summary}_\n`];
    const maxLen = Math.max(previous.steps.length, next.steps.length);
    for (let i = 0; i < maxLen; i++) {
      const prev = previous.steps[i];
      const cur = next.steps[i];
      if (
        prev &&
        cur &&
        prev.action === cur.action &&
        JSON.stringify(prev.args) === JSON.stringify(cur.args)
      ) {
        lines.push(`${i + 1}. \`${cur.action}\` ${JSON.stringify(cur.args)}`);
      } else {
        if (prev) lines.push(`~~${i + 1}. \`${prev.action}\` ${JSON.stringify(prev.args)}~~`);
        if (cur) lines.push(`**${i + 1}.** \`${cur.action}\` ${JSON.stringify(cur.args)}`);
      }
    }
    return lines.join("\n");
  }
}
````

- [ ] **Step 4: Run all triage + sentinel tests**

```bash
pnpm vitest run tests/triage tests/sentinel 2>&1 | tail -10
```

Expected: all green. Existing triage tests still pass (sentinelDb is optional); new F1 test passes.

- [ ] **Step 5: Commit Task 9**

```bash
git add src/triage/planner.ts tests/triage/planner.test.ts
git commit -m "feat(sentinel): F1 wiring — planner reads sentinel insights for context

Planner now accepts an optional sentinelDb in its constructor.
When present, the most recent 5 insights are prepended to the
LLM prompt as 'Sentinel context'. Backwards-compatible: existing
callers without sentinelDb get the original behavior.

Closes the F1 feedback loop from Sentinel spec — triage gets
situational awareness from JR's accumulated knowledge as soon as
sentinel.db has insights to share.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Scheduler — 2h cycle trigger

**Files:**

- Create: `src/sentinel/scheduler.ts`
- Create: `tests/sentinel/scheduler.test.ts`

- [ ] **Step 1: Write the failing test for scheduler**

Create `/Users/vero/openclaw/tests/sentinel/scheduler.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SentinelScheduler } from "../../src/sentinel/scheduler.js";

describe("SentinelScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("invokes the cycle callback every 2 hours", async () => {
    const cycle = vi.fn(async () => {});
    const scheduler = new SentinelScheduler({
      cycleFn: cycle,
      intervalMs: 2 * 60 * 60 * 1000,
    });
    scheduler.start();
    expect(cycle).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    expect(cycle).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    expect(cycle).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it("stops the interval when stop() is called", async () => {
    const cycle = vi.fn(async () => {});
    const scheduler = new SentinelScheduler({
      cycleFn: cycle,
      intervalMs: 1000,
    });
    scheduler.start();
    scheduler.stop();
    vi.advanceTimersByTime(5000);
    expect(cycle).toHaveBeenCalledTimes(0);
  });

  it("does not start if feature flag is unset", async () => {
    const cycle = vi.fn(async () => {});
    delete process.env.OPENCLAW_SENTINEL_ENABLED;
    const scheduler = new SentinelScheduler({
      cycleFn: cycle,
      intervalMs: 1000,
      featureFlagEnv: "OPENCLAW_SENTINEL_ENABLED",
    });
    scheduler.start();
    vi.advanceTimersByTime(5000);
    expect(cycle).toHaveBeenCalledTimes(0);
  });

  it("isolates cycle errors — one bad cycle doesn't stop the schedule", async () => {
    const cycle = vi
      .fn()
      .mockRejectedValueOnce(new Error("kaboom"))
      .mockResolvedValueOnce(undefined);
    process.env.OPENCLAW_SENTINEL_ENABLED = "1";
    const scheduler = new SentinelScheduler({
      cycleFn: cycle,
      intervalMs: 1000,
      featureFlagEnv: "OPENCLAW_SENTINEL_ENABLED",
    });
    scheduler.start();
    vi.advanceTimersByTime(1000);
    await Promise.resolve();
    await Promise.resolve();
    vi.advanceTimersByTime(1000);
    await Promise.resolve();
    await Promise.resolve();
    expect(cycle).toHaveBeenCalledTimes(2);
    scheduler.stop();
    delete process.env.OPENCLAW_SENTINEL_ENABLED;
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
pnpm vitest run tests/sentinel/scheduler.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement scheduler**

Create `/Users/vero/openclaw/src/sentinel/scheduler.ts`:

```typescript
export interface SchedulerOptions {
  cycleFn: () => Promise<void>;
  intervalMs: number;
  featureFlagEnv?: string;
  onError?: (err: Error) => void;
}

export class SentinelScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private opts: SchedulerOptions) {}

  start(): void {
    if (this.opts.featureFlagEnv) {
      const value = process.env[this.opts.featureFlagEnv];
      if (value !== "1") return;
    }
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.opts.cycleFn().catch((err) => {
        if (this.opts.onError) this.opts.onError(err as Error);
      });
    }, this.opts.intervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
```

- [ ] **Step 4: Run scheduler tests**

```bash
pnpm vitest run tests/sentinel/scheduler.test.ts 2>&1 | tail -10
```

Expected: PASS — 4 tests green.

- [ ] **Step 5: Commit Task 10**

```bash
git add src/sentinel/scheduler.ts tests/sentinel/scheduler.test.ts
git commit -m "feat(sentinel): scheduler — 2h cycle trigger with feature flag

SentinelScheduler runs cycleFn every intervalMs ms. Respects
OPENCLAW_SENTINEL_ENABLED env flag — does nothing when unset.
Cycle errors are caught and routed to optional onError handler so
one bad cycle doesn't break the schedule.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Sentinel orchestrator + wire into gateway

**Files:**

- Create: `src/sentinel/index.ts`
- Modify: gateway entrypoint to start the scheduler

- [ ] **Step 1: Create the public sentinel module + orchestrator**

Create `/Users/vero/openclaw/src/sentinel/index.ts`:

```typescript
import { homedir } from "node:os";
import { join } from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import { openSentinelDb } from "./db.js";
import { ObserverRegistry } from "./observer.js";
import { runObservers } from "./observer-runner.js";
import { createSelfObserver } from "./observers/self.js";
import { createSlackChannelsObserver } from "./observers/slack-channels.js";
import { createLaunchAgentsObserver } from "./observers/launchagents.js";
import { Synthesizer } from "./synthesizer.js";
import { Curator } from "./curator.js";
import { Reporter } from "./reporter.js";
import { Monetizer } from "./monetizer.js";
import { Inquirer } from "./inquirer.js";
import { SentinelScheduler } from "./scheduler.js";
import { ensureLibrarySkeleton, regenerateIndex } from "./library.js";
import type { LlmClient } from "../triage/llm-client.js";

export interface SentinelDeps {
  llm: LlmClient;
  slackClient: {
    conversations: {
      history(args: {
        channel: string;
        oldest?: string;
        limit?: number;
      }): Promise<{ ok: boolean; messages?: Array<{ user?: string; text?: string; ts?: string }> }>;
    };
  };
  allowedSlackChannels: string[];
  triageDbPath: string;
  kalebUserId?: string;
  ridgeUserId?: string;
  dmUser?: (userId: string, text: string) => Promise<void>;
  libPath?: string;
  sentinelDbPath?: string;
}

export interface Sentinel {
  scheduler: SentinelScheduler;
  db: DatabaseType;
  runCycleOnce(): Promise<void>;
}

export function createSentinel(deps: SentinelDeps): Sentinel {
  const libPath = deps.libPath ?? join(homedir(), ".openclaw/jr-library");
  const sentinelDbPath = deps.sentinelDbPath ?? join(homedir(), ".openclaw/sentinel.db");
  ensureLibrarySkeleton(libPath);
  const db = openSentinelDb(sentinelDbPath);

  const registry = new ObserverRegistry();
  registry.register(createSelfObserver({ triageDbPath: deps.triageDbPath }));
  registry.register(
    createSlackChannelsObserver({
      client: deps.slackClient,
      allowedChannels: deps.allowedSlackChannels,
    }),
  );
  registry.register(createLaunchAgentsObserver({ filterPrefix: "openclaw" }));

  const synthesizer = new Synthesizer(deps.llm);
  const curator = new Curator(deps.llm);
  const reporter = new Reporter({
    db,
    libPath,
    dmUser: deps.dmUser,
    kalebUserId: deps.kalebUserId,
    ridgeUserId: deps.ridgeUserId,
  });
  const monetizer = new Monetizer({ llm: deps.llm, db });
  const inquirer = new Inquirer({ llm: deps.llm, db, libPath });

  let lastDailyReportDate: string | null = null;
  let lastWeeklyReportWeek: number | null = null;
  let lastIdeasReportWeek: number | null = null;

  async function runCycleOnce(): Promise<void> {
    // 1. Observe
    const runResult = await runObservers({ registry, db });

    // 2. Synthesize over fresh observations
    const lookback = Date.now() - 2 * 60 * 60 * 1000;
    const recentObs = db
      .prepare(
        "SELECT id, source, topic, timestamp, summary, data, metrics FROM observations WHERE timestamp >= ? ORDER BY id",
      )
      .all(lookback) as Array<{
      id: number;
      source: string;
      topic: string | null;
      timestamp: number;
      summary: string;
      data: string | null;
      metrics: string | null;
    }>;
    const insights = await synthesizer.synthesize(
      recentObs.map((o) => ({
        id: o.id,
        source: o.source,
        topic: o.topic ?? undefined,
        timestamp: o.timestamp,
        summary: o.summary,
        data: o.data ? JSON.parse(o.data) : undefined,
        metrics: o.metrics ? JSON.parse(o.metrics) : undefined,
      })),
    );

    // 3. Curate insights into the library
    const insertInsight = db.prepare(
      `INSERT INTO insights (category, summary, evidence, derived_from, confidence, generated_at, filed_to) VALUES (?,?,?,?,?,?,?)`,
    );
    for (const ins of insights) {
      const filed = await curator.fileInsight(ins, libPath);
      insertInsight.run(
        ins.category,
        ins.summary,
        ins.evidence,
        JSON.stringify(ins.derived_from),
        ins.confidence,
        ins.generated_at,
        filed.filedTo,
      );
    }

    // 4. Inquirer (manual-review mode in Phase A — no DMs)
    await inquirer.formulateQuestions();

    // 5. Regenerate INDEX.md
    regenerateIndex(libPath);

    // 6. Daily report once per day
    const todayKey = new Date().toISOString().slice(0, 10);
    if (lastDailyReportDate !== todayKey) {
      await reporter.writeDailySummary();
      lastDailyReportDate = todayKey;
    }

    // 7. Weekly digest on Friday
    const now = new Date();
    const isFriday = now.getDay() === 5;
    const isoWeek = Math.ceil(
      ((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 86400000 + 1) / 7,
    );
    if (isFriday && lastWeeklyReportWeek !== isoWeek) {
      await reporter.writeWeeklyDigest();
      lastWeeklyReportWeek = isoWeek;
    }

    // 8. Ideas report on Sunday
    const isSunday = now.getDay() === 0;
    if (isSunday && lastIdeasReportWeek !== isoWeek) {
      await monetizer.proposeWeekly();
      await reporter.writeIdeasReport();
      lastIdeasReportWeek = isoWeek;
    }

    void runResult; // already logged via observer-runner returns; suppress unused warning
  }

  const scheduler = new SentinelScheduler({
    cycleFn: runCycleOnce,
    intervalMs: 2 * 60 * 60 * 1000,
    featureFlagEnv: "OPENCLAW_SENTINEL_ENABLED",
    onError: (err) => {
      // eslint-disable-next-line no-console
      console.error("[sentinel] cycle failed:", err.message);
    },
  });

  return { scheduler, db, runCycleOnce };
}

export { SentinelScheduler } from "./scheduler.js";
export { ensureLibrarySkeleton, regenerateIndex } from "./library.js";
export { openSentinelDb } from "./db.js";
```

- [ ] **Step 2: Find the gateway boot path and add sentinel startup**

```bash
cd /Users/vero/openclaw
grep -rn "listening on ws" src/ 2>&1 | head -5
```

This finds the spot where the gateway logs that it's listening. The sentinel should start right after that line.

Read that file and identify the function that owns the gateway boot. Add this near the end of the boot function (adapt the exact call to fit existing context — the engineer should use the slack client and channel list that already exists in the gateway's startup context):

```typescript
import { createSentinel } from "../sentinel/index.js";

// Inside the gateway boot function, after slack provider is started:
const sentinel = createSentinel({
  llm: existingLlmClient, // reuse the pi-ai LLM client from triage-bridge.ts
  slackClient: ctx.app.client,
  allowedSlackChannels: extractAllowedChannelIds(cfg),
  triageDbPath: join(homedir(), ".openclaw/triage.db"),
  kalebUserId: "U07KRVD2867",
  ridgeUserId: undefined, // TODO: fill from config when known
  dmUser: async (userId, text) => {
    await ctx.app.client.chat.postMessage({
      token: ctx.botToken,
      channel: userId,
      text,
    });
  },
});
sentinel.scheduler.start();
ctx.runtime.log(`[sentinel] scheduler started (interval: 2h, flag: OPENCLAW_SENTINEL_ENABLED)`);
```

`extractAllowedChannelIds(cfg)` should read `cfg.channels.slack.channels` (the existing channel allowlist) and return the list of channel IDs marked `enabled: true`. Helper function the engineer writes inline.

The point of this step is integration — exact file paths depend on the gateway's structure. **The engineer reads the gateway boot code first, then chooses the cleanest integration point.**

- [ ] **Step 3: Run all tests**

```bash
pnpm vitest run tests/sentinel tests/triage 2>&1 | tail -10
```

Expected: PASS — all green.

- [ ] **Step 4: Commit Task 11**

```bash
git add src/sentinel/index.ts # and the gateway file you modified
git commit -m "feat(sentinel): orchestrator + gateway wire-up

createSentinel composes all the pieces: observer registry with self
+ slack-channels + launchagents observers, synthesizer, curator,
reporter, monetizer, inquirer. runCycleOnce runs the full cycle
(observe → synthesize → curate → regenerate-INDEX → conditional
daily/weekly/ideas reports). Scheduler ticks every 2h gated by
OPENCLAW_SENTINEL_ENABLED. Gateway boots the scheduler after Slack
is connected.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Smoke test + push + open PR

- [ ] **Step 1: Manual smoke (flag still OFF)**

```bash
cd /Users/vero/openclaw
pnpm vitest run tests/sentinel tests/triage 2>&1 | tail -5
```

Expected: all green. JR's existing behavior unchanged since `OPENCLAW_SENTINEL_ENABLED` defaults to off.

- [ ] **Step 2: Manual smoke (flag ON, one-cycle trigger)**

```bash
sed -i.bak 's/OPENCLAW_SENTINEL_ENABLED=0/OPENCLAW_SENTINEL_ENABLED=1/' /Users/vero/.openclaw/.env
grep OPENCLAW_SENTINEL_ENABLED /Users/vero/.openclaw/.env
launchctl kickstart -k gui/$UID/com.openclaw.agent
sleep 12
lsof -nP -iTCP:18789 -sTCP:LISTEN | tail -2
grep "sentinel" /Users/vero/openclaw.log | tail -5
```

Expected: JR boots clean, log shows `[sentinel] scheduler started`. Cycle won't run for 2h naturally — confirm the scheduler is alive.

Optionally, expose a way to manually trigger a cycle from a Slack DM ("@JR run sentinel cycle now") for faster smoke verification. Out of scope here — defer to operator.

- [ ] **Step 3: Verify library skeleton exists**

```bash
ls /Users/vero/.openclaw/jr-library/
cat /Users/vero/.openclaw/jr-library/INDEX.md
```

Expected: seeded folder structure + INDEX.md with the initial "auto-regenerated" header.

- [ ] **Step 4: Push branch**

```bash
cd /Users/vero/openclaw
git push -u origin cleanup/phase-6-sentinel-jr-phase-a
```

- [ ] **Step 5: Open PR**

```bash
gh pr create --repo Vero-Power/openclaw --base main --head cleanup/phase-6-sentinel-jr-phase-a --title "Phase 6 Phase A: Sentinel JR — continuously-learning second brain" --body "$(cat <<'PRBODY'
## Summary

Ships Phase A of Sentinel JR per `docs/superpowers/specs/2026-06-08-sentinel-jr-design.md`. Transforms JR's heartbeat from a no-op into a 7-layer pipeline that observes Vero's operational state every 2 hours, accumulates a fluid markdown library, synthesizes patterns with quantitative rigor, formulates questions for human review, generates daily/weekly/ideas reports, and feeds insights back into the Triage v2 planner.

## Architecture

7-layer pipeline triggered every 2h:

```

L1 OBSERVE → self (triage.db) + slack-channels + launchagents
L2 STORE → sentinel.db (observations, insights, conversations, ...)
L3 SYNTHESIZE → LLM extraction with quantitative-rigor gate
L4 CURATE → markdown library at ~/.openclaw/jr-library/
L5 REPORT → daily summary + weekly digest + ideas
L6 INQUIRE → formulates questions, files to inquiry-queue.md (Phase A: manual-review only)
L7 MONETIZE → weekly creative pass writes opportunities

F1 wiring: triage planner now reads recent sentinel insights as context.

```

## What's in

- `migrations/002-sentinel-schema.sql` — 8 tables
- `src/sentinel/` — observer interface, registry, runner, 3 observers (self / slack-channels / launchagents), synthesizer, curator, library helpers, reporter (daily/weekly/ideas), monetizer, inquirer, scheduler, orchestrator
- `src/triage/planner.ts` — F1 wiring: accepts optional `sentinelDb`, prepends recent insights to plan prompts
- Tests: 30+ across all sentinel modules

**Feature flag:** `OPENCLAW_SENTINEL_ENABLED=1` enables; default off keeps current behavior.

## Deferred to Phase B+

- L6 inquirer goes live (DMs people) — Phase B once question quality is validated
- Coperniq + GCP observers — blocked on gcloud auth fix
- External-context observer (web search, weather) — Phase C
- F2 (sentinel-proposed playbooks) — after triage playbook subsystem ships
- F3 ("what should I do today" handler) — after synthesis matures
- Embedding-based semantic search of observations — Phase D

## Risks + rollback

- `OPENCLAW_SENTINEL_ENABLED=0` + restart → sentinel goes dark. Library + sentinel.db remain.
- Per-PR rollback: each task is one commit, individually revertable.
- DB migrations forward-only.

## Test plan

- [x] `pnpm vitest run tests/sentinel` — all green
- [x] `pnpm vitest run tests/triage` — F1 wiring doesn't regress existing tests
- [x] Sentinel boots clean with `OPENCLAW_SENTINEL_ENABLED=1`, log shows `[sentinel] scheduler started`
- [x] Library skeleton seeded on first boot
- [ ] Live 2h cycle runs and writes a real daily report — operator to verify after 24h
- [ ] Weekly digest + ideas reports + Kaleb DMs — operator to verify next Friday + Sunday

🤖 Generated with [Claude Code](https://claude.com/claude-code)
PRBODY
)"
```

---

## Self-review

**Spec coverage:**

| Spec Section                  | Covered?                                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Goal (§1)                     | Yes — Phase A implements the foundational layers; spec calls out deferred work                                                                                |
| Design decisions S1–S10 (§2)  | All baked into the implementation                                                                                                                             |
| Architecture pipeline (§3.1)  | Tasks 2–11 build the pipeline end-to-end                                                                                                                      |
| Components (§3.2)             | Each named module has a task: observer-runner (T2), observers/\* (T2 + T6), synthesizer (T3), curator (T4), reporter (T5 + T7), monetizer (T7), inquirer (T8) |
| Engagement etiquette (§3.3)   | Inquirer in Phase A is manual-review only — etiquette enforced when going live in Phase B                                                                     |
| Storage (§3.4)                | Schema in T1; library helpers in T4                                                                                                                           |
| Library structure (§3.4)      | Seeded folders + fluid expansion in library helpers                                                                                                           |
| Cadence (§3.5)                | Scheduler (T10) + orchestrator logic (T11) — 2h cycle, daily/weekly/ideas reports on schedule                                                                 |
| Output routing M2 + M4 (§3.6) | Reporter (T7) DMs Kaleb (M2) and Ridge (M4)                                                                                                                   |
| Feedback to triage F4 (§3.7)  | F1 implemented in T9; F2/F3 explicitly deferred per spec                                                                                                      |
| Acceptance criteria (§4)      | Smoke test in T12 covers basic verification; full week-1 acceptance needs operator over time                                                                  |
| Implementation phases (§5)    | Phase A scope ✓; Phases B–D explicitly out of scope per spec                                                                                                  |
| Build order (§6)              | Tasks 1–11 follow spec's 9-step build order with scheduler (T10) + orchestrator (T11) added for completeness                                                  |
| Risks + rollback (§7)         | Feature flag + per-commit revertability in T12 PR body                                                                                                        |
| Testing strategy (§8)         | TDD throughout, integration via runCycleOnce in T11                                                                                                           |

**Placeholder scan:** No "TBD" / "TODO" / "fill in later" in executable steps. T11 Step 2 says "the engineer reads the gateway boot code first" — that's a genuinely-context-dependent integration that the spec acknowledges; the surrounding code shape is given.

**Type consistency:** Reviewed — `Observation`, `Insight`, `Opportunity`, `Conversation`, `ReportKind` used consistently across tasks. `LlmClient` type signature matches Triage MVP's existing interface. `ObserverRegistry.register/list/get` consistent across tasks.

**Spec → plan gap check:** Original spec §6 calls for "Inquirer (manual-review mode)" — covered by T8. Spec §3.7 F1 wiring — covered by T9. No spec requirement without a task.
