# Sentinel Phase D.1 — F3 Oracle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Oracle — a recommendation engine that turns JR's accumulated observations + insights + library + Firestore data into ranked, attributed action items, surfaced both reactively (Slack DM) and proactively (per-cycle per-person markdown + DM-on-new).

**Architecture:** New module hierarchy under `src/sentinel/oracle/`. Five sub-modules (people-directory, store, file-writer, llm-prompt, main factory) compose into one `Oracle` interface. Triage chat handler gains a new intent (`action_recommendation`) that calls the oracle. Sentinel `runCycleOnce()` gains a final step that runs the oracle every 2h. Two new tables in `sentinel.db` (`oracle_recommendations` + `oracle_dms_sent`) with stable-id idempotency for cross-cycle dedup. Dynamic people directory from Firestore project owners + `library/people/*.md` files — no static role map.

**Tech Stack:** TypeScript, `@google-cloud/firestore` (already in deps), `better-sqlite3` (already in deps), `@google/genai` via the existing `LlmClient` wrapper, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-19-sentinel-phase-d-f3-oracle-design.md`

---

## File structure

| File                                                         | Responsibility                                                                                                                                                  |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/sentinel/db.ts`                                         | UPDATE. Add two `CREATE TABLE IF NOT EXISTS` statements in `openSentinelDb` for `oracle_recommendations` + `oracle_dms_sent`.                                   |
| `src/sentinel/observers/external-context/company-context.ts` | UPDATE. Extend `CompanyContextFirestoreLike` port with one new method `listProjectAssignees()`. Extend `createDefaultCompanyContextClient` adapter accordingly. |
| `src/sentinel/oracle/people-directory.ts`                    | NEW. Build people directory from Firestore + library files.                                                                                                     |
| `src/sentinel/oracle/store.ts`                               | NEW. sentinel.db ops: upsert, diff, DM-sent tracking.                                                                                                           |
| `src/sentinel/oracle/file-writer.ts`                         | NEW. Per-person markdown file rendering into the library.                                                                                                       |
| `src/sentinel/oracle.ts`                                     | NEW. Factory + `Oracle` interface + LLM call orchestration (includes inline prompt builder).                                                                    |
| `src/triage/chat/intents/action-recommendation.ts`           | NEW. Chat-handler intent + response formatter.                                                                                                                  |
| `src/sentinel/index.ts`                                      | UPDATE. Construct oracle, call from `runCycleOnce()`.                                                                                                           |
| `src/triage/chat/index.ts`                                   | UPDATE. Wire the new intent into the chat handler.                                                                                                              |

Tests live in `tests/sentinel/oracle/`, `tests/triage/chat/intents/`, and additions to existing test files.

---

## Verified facts

- `sentinel.db` schema migrations live in `src/sentinel/db.ts` inside `openSentinelDb`. `better-sqlite3` runs them via `db.exec()`. Existing pattern uses `CREATE TABLE IF NOT EXISTS …`.
- `~/.openclaw/jr-library/people/` directory exists today (empty currently per the inspection earlier in this session, but the inquirer + curator populate it over time).
- `coperniq_projects` has `owner: { email, firstName, lastName, ... }` and `salesRep: { email, ... }` per the earlier Firestore inspection.
- `SLACK_USER_ALIASES` lives at `src/triage/actions/slack/aliases.ts` and is already passed through several systems (`FollowupProcessor`, `Inquirer`).
- The `LlmClient` interface is single-shot text in/text out. Oracle uses it directly via Gemini Flash (cheap).

---

## Task 1: Schema migration — two new tables in sentinel.db

**Files:**

- Modify: `/Users/vero/openclaw/src/sentinel/db.ts`
- Modify (or add): `/Users/vero/openclaw/tests/sentinel/db.test.ts` (or wherever the schema tests live)

- [ ] **Step 1: Write failing test for new tables**

In the existing sentinel db test file (locate via `ls tests/sentinel/db*`), add tests:

```typescript
describe("openSentinelDb — oracle tables migration", () => {
  let dbPath: string;
  let db: DatabaseType;

  beforeEach(() => {
    dbPath = join(
      tmpdir(),
      `sentinel-oracle-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    db = openSentinelDb(dbPath);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-shm", "-wal"]) {
      const f = `${dbPath}${suffix}`;
      if (existsSync(f)) unlinkSync(f);
    }
  });

  it("creates oracle_recommendations table with all required columns", () => {
    const cols = db.prepare("PRAGMA table_info(oracle_recommendations)").all() as Array<{
      name: string;
      type: string;
    }>;
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual([
      "assignee_email",
      "assignee_slack_id",
      "confidence",
      "data",
      "dismissed_at",
      "evidence",
      "first_seen_at",
      "id",
      "last_seen_at",
      "rationale",
      "scope",
      "title",
      "urgency",
    ]);
  });

  it("creates the assignee+last_seen_at index", () => {
    const indexes = db.prepare("PRAGMA index_list(oracle_recommendations)").all() as Array<{
      name: string;
    }>;
    const names = indexes.map((i) => i.name);
    expect(names).toContain("oracle_recommendations_assignee");
  });

  it("creates oracle_dms_sent table with composite primary key", () => {
    const cols = db.prepare("PRAGMA table_info(oracle_dms_sent)").all() as Array<{
      name: string;
      pk: number;
    }>;
    const pkCols = cols
      .filter((c) => c.pk > 0)
      .map((c) => c.name)
      .sort();
    expect(pkCols).toEqual(["assignee_email", "rec_id"]);
  });
});
```

If the file doesn't exist yet, create `/Users/vero/openclaw/tests/sentinel/db.oracle.test.ts` with the standard import block from a sibling test file plus these tests.

- [ ] **Step 2: Run tests to verify FAIL**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/db
```

Expected: FAIL — tables don't exist yet.

- [ ] **Step 3: Add migrations to `openSentinelDb`**

Edit `/Users/vero/openclaw/src/sentinel/db.ts`. After the existing `CREATE TABLE` statements inside `openSentinelDb`, add:

```typescript
db.exec(`
    CREATE TABLE IF NOT EXISTS oracle_recommendations (
      id TEXT PRIMARY KEY,
      assignee_email TEXT NOT NULL,
      assignee_slack_id TEXT,
      title TEXT NOT NULL,
      rationale TEXT NOT NULL,
      evidence TEXT NOT NULL,
      scope TEXT NOT NULL,
      urgency TEXT NOT NULL,
      confidence TEXT NOT NULL,
      data TEXT NOT NULL,
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      dismissed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS oracle_recommendations_assignee
      ON oracle_recommendations(assignee_email, last_seen_at DESC);

    CREATE TABLE IF NOT EXISTS oracle_dms_sent (
      rec_id TEXT NOT NULL,
      assignee_email TEXT NOT NULL,
      sent_at INTEGER NOT NULL,
      PRIMARY KEY (rec_id, assignee_email)
    );
  `);
```

- [ ] **Step 4: Run tests to verify PASS**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/db
```

Expected: PASS (the 3 new tests + any pre-existing schema tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/vero/openclaw && git add src/sentinel/db.ts tests/sentinel/db.oracle.test.ts && git commit -m "$(cat <<'EOF'
feat(sentinel): oracle_recommendations + oracle_dms_sent schema

Adds two new tables to sentinel.db for the Oracle (Phase D.1):
- oracle_recommendations: stable-id idempotent action items with
  first_seen_at/last_seen_at for cross-cycle dedup.
- oracle_dms_sent: tracks which recommendations have been DM'd to
  which assignee, preventing re-notification on the same rec.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: People directory module (extends Firestore port + library scan)

**Files:**

- Modify: `/Users/vero/openclaw/src/sentinel/observers/external-context/company-context.ts` (extend port + default adapter)
- Create: `/Users/vero/openclaw/src/sentinel/oracle/people-directory.ts`
- Create: `/Users/vero/openclaw/tests/sentinel/oracle/people-directory.test.ts`

- [ ] **Step 1: Extend the Firestore port + adapter**

Edit `/Users/vero/openclaw/src/sentinel/observers/external-context/company-context.ts`:

Add to `CompanyContextFirestoreLike`:

```typescript
export interface CompanyContextFirestoreLike {
  countProjectsByField(field: "state" | "status" | "workflowName"): Promise<Record<string, number>>;
  sumProjectValue(filter: { status?: string }): Promise<number>;
  countWorkOrdersByStatus(): Promise<Record<string, number>>;
  // NEW:
  listProjectAssignees(): Promise<
    Array<{ owner_email: string | null; sales_rep_email: string | null }>
  >;
}
```

Update `createDefaultCompanyContextClient` to implement it. Inside the returned object, add:

```typescript
    async listProjectAssignees() {
      const snap = await fs.collection("coperniq_projects").select("owner", "salesRep").get();
      return snap.docs.map((doc) => {
        const owner = doc.get("owner") as { email?: string } | undefined;
        const salesRep = doc.get("salesRep") as { email?: string } | undefined;
        return {
          owner_email: owner?.email ?? null,
          sales_rep_email: salesRep?.email ?? null,
        };
      });
    },
```

- [ ] **Step 2: Update existing company-context tests to include the new method on the fake**

In `tests/sentinel/observers/external-context/company-context.test.ts`, update the `makeFakeClient` helper:

```typescript
function makeFakeClient(
  overrides: Partial<CompanyContextFirestoreLike> = {},
): CompanyContextFirestoreLike {
  return {
    countProjectsByField: overrides.countProjectsByField ?? (async () => ({})),
    sumProjectValue: overrides.sumProjectValue ?? (async () => 0),
    countWorkOrdersByStatus: overrides.countWorkOrdersByStatus ?? (async () => ({})),
    listProjectAssignees: overrides.listProjectAssignees ?? (async () => []),
  };
}
```

Run existing company-context tests to confirm they still pass:

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/observers/external-context/company-context.test.ts
```

Expected: 4/4 pass.

- [ ] **Step 3: Write failing tests for people-directory**

Create `/Users/vero/openclaw/tests/sentinel/oracle/people-directory.test.ts`:

```typescript
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import type { CompanyContextFirestoreLike } from "../../../src/sentinel/observers/external-context/company-context.js";
import { buildPeopleDirectory } from "../../../src/sentinel/oracle/people-directory.js";

function tmpLib(): string {
  return join(tmpdir(), `jr-lib-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function makeFirestoreFake(
  overrides: Partial<CompanyContextFirestoreLike> = {},
): CompanyContextFirestoreLike {
  return {
    countProjectsByField: overrides.countProjectsByField ?? (async () => ({})),
    sumProjectValue: overrides.sumProjectValue ?? (async () => 0),
    countWorkOrdersByStatus: overrides.countWorkOrdersByStatus ?? (async () => ({})),
    listProjectAssignees: overrides.listProjectAssignees ?? (async () => []),
  };
}

describe("buildPeopleDirectory", () => {
  let libPath: string;
  beforeEach(() => {
    libPath = tmpLib();
    mkdirSync(join(libPath, "people"), { recursive: true });
  });
  afterEach(() => {
    if (existsSync(libPath)) rmSync(libPath, { recursive: true, force: true });
  });

  it("returns Firestore-derived assignees with evidence_count aggregating across projects", async () => {
    const client = makeFirestoreFake({
      listProjectAssignees: async () => [
        { owner_email: "ridge@veropwr.com", sales_rep_email: "thomas.morrow@veropwr.com" },
        { owner_email: "ridge@veropwr.com", sales_rep_email: "thomas.morrow@veropwr.com" },
        { owner_email: "ridge@veropwr.com", sales_rep_email: null },
      ],
    });
    const dir = await buildPeopleDirectory({
      firestoreClient: client,
      libPath,
      userAliases: { "ridge@veropwr.com": "URIDGE", "thomas.morrow@veropwr.com": "UTHOMAS" },
    });
    const ridge = dir.find((e) => e.email === "ridge@veropwr.com");
    expect(ridge).toBeDefined();
    expect(ridge?.evidence_count).toBe(3);
    expect(ridge?.slack_id).toBe("URIDGE");
    const thomas = dir.find((e) => e.email === "thomas.morrow@veropwr.com");
    expect(thomas?.evidence_count).toBe(2);
    expect(thomas?.slack_id).toBe("UTHOMAS");
  });

  it("returns library-derived entries from people/*.md frontmatter", async () => {
    writeFileSync(
      join(libPath, "people", "kaleb-lundquist.md"),
      `---\nemail: kaleb.lundquist@blytzpay.com\ndisplay_name: Kaleb Lundquist\nnotes: ops point of contact\n---\n\n# Kaleb\nSome notes.\n`,
    );
    const client = makeFirestoreFake();
    const dir = await buildPeopleDirectory({
      firestoreClient: client,
      libPath,
      userAliases: { "kaleb.lundquist@blytzpay.com": "UKALEB" },
    });
    const kaleb = dir.find((e) => e.email === "kaleb.lundquist@blytzpay.com");
    expect(kaleb).toBeDefined();
    expect(kaleb?.display_name).toBe("Kaleb Lundquist");
    expect(kaleb?.notes).toBe("ops point of contact");
    expect(kaleb?.slack_id).toBe("UKALEB");
    expect(kaleb?.source).toBe("library_profile");
  });

  it("merges Firestore + library entries deduped by email, library notes win", async () => {
    writeFileSync(
      join(libPath, "people", "ridge.md"),
      `---\nemail: ridge@veropwr.com\nnotes: CEO, prefers strategic context\n---\n`,
    );
    const client = makeFirestoreFake({
      listProjectAssignees: async () => [
        { owner_email: "ridge@veropwr.com", sales_rep_email: null },
        { owner_email: "ridge@veropwr.com", sales_rep_email: null },
      ],
    });
    const dir = await buildPeopleDirectory({
      firestoreClient: client,
      libPath,
      userAliases: { "ridge@veropwr.com": "URIDGE" },
    });
    expect(dir).toHaveLength(1);
    const r = dir[0];
    expect(r.email).toBe("ridge@veropwr.com");
    expect(r.evidence_count).toBe(2);
    expect(r.notes).toBe("CEO, prefers strategic context");
  });

  it("returns null slack_id when alias map has no match", async () => {
    const client = makeFirestoreFake({
      listProjectAssignees: async () => [
        { owner_email: "unknown@veropwr.com", sales_rep_email: null },
      ],
    });
    const dir = await buildPeopleDirectory({ firestoreClient: client, libPath, userAliases: {} });
    expect(dir[0].slack_id).toBeNull();
  });

  it("skips entries with null/empty email", async () => {
    const client = makeFirestoreFake({
      listProjectAssignees: async () => [
        { owner_email: null, sales_rep_email: null },
        { owner_email: "real@veropwr.com", sales_rep_email: null },
      ],
    });
    const dir = await buildPeopleDirectory({ firestoreClient: client, libPath, userAliases: {} });
    expect(dir).toHaveLength(1);
    expect(dir[0].email).toBe("real@veropwr.com");
  });
});
```

- [ ] **Step 4: Run tests to verify FAIL**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/oracle/people-directory.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 5: Implement `people-directory.ts`**

Create `/Users/vero/openclaw/src/sentinel/oracle/people-directory.ts`:

```typescript
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { CompanyContextFirestoreLike } from "../observers/external-context/company-context.js";

export interface PersonDirectoryEntry {
  email: string;
  slack_id: string | null;
  display_name: string | null;
  source: "firestore_owner" | "firestore_sales_rep" | "library_profile";
  evidence_count: number;
  notes: string | null;
}

export interface BuildPeopleDirectoryDeps {
  firestoreClient: CompanyContextFirestoreLike;
  libPath: string;
  userAliases: Record<string, string>;
}

interface LibraryProfile {
  email: string;
  display_name: string | null;
  notes: string | null;
}

function parseLibraryProfiles(libPath: string): LibraryProfile[] {
  const peopleDir = join(libPath, "people");
  if (!existsSync(peopleDir)) {
    return [];
  }
  const entries = readdirSync(peopleDir).filter((f) => f.endsWith(".md"));
  const out: LibraryProfile[] = [];
  for (const file of entries) {
    let content: string;
    try {
      content = readFileSync(join(peopleDir, file), "utf8");
    } catch {
      continue;
    }
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) {
      continue;
    }
    const frontmatter = match[1];
    const emailMatch = frontmatter.match(/^email:\s*(.+)$/m);
    if (!emailMatch) {
      continue;
    }
    const email = emailMatch[1].trim();
    if (!email) {
      continue;
    }
    const displayMatch = frontmatter.match(/^display_name:\s*(.+)$/m);
    const notesMatch = frontmatter.match(/^notes:\s*(.+)$/m);
    out.push({
      email,
      display_name: displayMatch ? displayMatch[1].trim() : null,
      notes: notesMatch ? notesMatch[1].trim() : null,
    });
  }
  return out;
}

export async function buildPeopleDirectory(
  deps: BuildPeopleDirectoryDeps,
): Promise<PersonDirectoryEntry[]> {
  const byEmail = new Map<string, PersonDirectoryEntry>();

  const assignees = await deps.firestoreClient.listProjectAssignees();
  for (const row of assignees) {
    if (row.owner_email) {
      const email = row.owner_email;
      const existing = byEmail.get(email);
      if (existing) {
        existing.evidence_count++;
      } else {
        byEmail.set(email, {
          email,
          slack_id: deps.userAliases[email] ?? null,
          display_name: null,
          source: "firestore_owner",
          evidence_count: 1,
          notes: null,
        });
      }
    }
    if (row.sales_rep_email) {
      const email = row.sales_rep_email;
      const existing = byEmail.get(email);
      if (existing) {
        existing.evidence_count++;
      } else {
        byEmail.set(email, {
          email,
          slack_id: deps.userAliases[email] ?? null,
          display_name: null,
          source: "firestore_sales_rep",
          evidence_count: 1,
          notes: null,
        });
      }
    }
  }

  const profiles = parseLibraryProfiles(deps.libPath);
  for (const profile of profiles) {
    const existing = byEmail.get(profile.email);
    if (existing) {
      existing.display_name = profile.display_name ?? existing.display_name;
      existing.notes = profile.notes ?? existing.notes;
    } else {
      byEmail.set(profile.email, {
        email: profile.email,
        slack_id: deps.userAliases[profile.email] ?? null,
        display_name: profile.display_name,
        source: "library_profile",
        evidence_count: 0,
        notes: profile.notes,
      });
    }
  }

  return Array.from(byEmail.values());
}
```

- [ ] **Step 6: Run all tests**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/oracle/people-directory.test.ts tests/sentinel/observers/external-context/company-context.test.ts
```

Expected: PASS (5 new + 4 existing = 9).

- [ ] **Step 7: Commit**

```bash
cd /Users/vero/openclaw && git add src/sentinel/observers/external-context/company-context.ts src/sentinel/oracle/people-directory.ts tests/sentinel/observers/external-context/company-context.test.ts tests/sentinel/oracle/people-directory.test.ts && git commit -m "$(cat <<'EOF'
feat(sentinel): oracle people-directory + extend Firestore port

Adds dynamic people directory builder that merges three sources:
Firestore project owners + sales reps (via new listProjectAssignees
method on the CompanyContextFirestoreLike port) and library people
profile markdown frontmatter. Deduped by email; evidence_count
aggregates across projects; library notes/display_name win on merge.
Slack ID resolved via the existing SLACK_USER_ALIASES map.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Store module (sentinel.db ops + diff logic)

**Files:**

- Create: `/Users/vero/openclaw/src/sentinel/oracle/store.ts`
- Create: `/Users/vero/openclaw/tests/sentinel/oracle/store.test.ts`

- [ ] **Step 1: Write failing tests**

Create `/Users/vero/openclaw/tests/sentinel/oracle/store.test.ts`:

```typescript
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { openSentinelDb } from "../../../src/sentinel/db.js";
import { OracleStore, type Recommendation } from "../../../src/sentinel/oracle/store.js";

function tmpDb(): string {
  return join(tmpdir(), `sentinel-os-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function cleanup(path: string): void {
  for (const suffix of ["", "-shm", "-wal"]) {
    const f = `${path}${suffix}`;
    if (existsSync(f)) unlinkSync(f);
  }
}

function rec(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: overrides.id ?? "rec-1",
    title: overrides.title ?? "Default title",
    rationale: overrides.rationale ?? "default rationale",
    evidence: overrides.evidence ?? ["obs:42"],
    assignee_email: overrides.assignee_email ?? "kaleb@example.com",
    assignee_slack_id: overrides.assignee_slack_id ?? "UKALEB",
    scope: overrides.scope ?? "ops",
    urgency: overrides.urgency ?? "medium",
    confidence: overrides.confidence ?? "medium",
    generated_at: overrides.generated_at ?? Date.now(),
  };
}

describe("OracleStore", () => {
  let dbPath: string;
  let db: DatabaseType;
  let store: OracleStore;

  beforeEach(() => {
    dbPath = tmpDb();
    db = openSentinelDb(dbPath);
    store = new OracleStore(db);
  });

  afterEach(() => {
    db.close();
    cleanup(dbPath);
  });

  it("upsertAll inserts new recs with first_seen_at = last_seen_at", () => {
    const r = rec({ id: "a" });
    store.upsertAll([r]);
    const row = db
      .prepare("SELECT first_seen_at, last_seen_at FROM oracle_recommendations WHERE id=?")
      .get("a") as { first_seen_at: number; last_seen_at: number };
    expect(row.first_seen_at).toBe(row.last_seen_at);
  });

  it("upsertAll on existing id keeps first_seen_at and bumps last_seen_at", () => {
    const r1 = rec({ id: "a", generated_at: 1000 });
    store.upsertAll([r1]);
    const before = db
      .prepare("SELECT first_seen_at FROM oracle_recommendations WHERE id=?")
      .get("a") as { first_seen_at: number };
    const r2 = rec({ id: "a", generated_at: 5000 });
    store.upsertAll([r2]);
    const after = db
      .prepare("SELECT first_seen_at, last_seen_at FROM oracle_recommendations WHERE id=?")
      .get("a") as { first_seen_at: number; last_seen_at: number };
    expect(after.first_seen_at).toBe(before.first_seen_at);
    expect(after.last_seen_at).toBeGreaterThan(before.first_seen_at);
  });

  it("diffNewForAssignee returns only recs whose id is NOT in oracle_dms_sent for that assignee", () => {
    const r1 = rec({ id: "a", assignee_email: "kaleb@example.com" });
    const r2 = rec({ id: "b", assignee_email: "kaleb@example.com" });
    const r3 = rec({ id: "c", assignee_email: "ridge@example.com" });
    store.upsertAll([r1, r2, r3]);
    store.markDMsSent([{ rec_id: "a", assignee_email: "kaleb@example.com" }]);
    const kalebNew = store.diffNewForAssignee("kaleb@example.com");
    expect(kalebNew.map((r) => r.id)).toEqual(["b"]);
    const ridgeNew = store.diffNewForAssignee("ridge@example.com");
    expect(ridgeNew.map((r) => r.id)).toEqual(["c"]);
  });

  it("queryAllForAssignee returns recs sorted urgency-DESC then last_seen_at-DESC", () => {
    const now = Date.now();
    store.upsertAll([
      rec({ id: "low1", urgency: "low", assignee_email: "k@x.com", generated_at: now }),
      rec({ id: "high1", urgency: "high", assignee_email: "k@x.com", generated_at: now }),
      rec({ id: "med1", urgency: "medium", assignee_email: "k@x.com", generated_at: now }),
    ]);
    const list = store.queryAllForAssignee("k@x.com");
    expect(list.map((r) => r.id)).toEqual(["high1", "med1", "low1"]);
  });

  it("markDMsSent is idempotent", () => {
    store.upsertAll([rec({ id: "a", assignee_email: "k@x.com" })]);
    store.markDMsSent([{ rec_id: "a", assignee_email: "k@x.com" }]);
    expect(() => store.markDMsSent([{ rec_id: "a", assignee_email: "k@x.com" }])).not.toThrow();
    const count = db.prepare("SELECT COUNT(*) AS c FROM oracle_dms_sent").get() as { c: number };
    expect(count.c).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify FAIL**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/oracle/store.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `store.ts`**

Create `/Users/vero/openclaw/src/sentinel/oracle/store.ts`:

```typescript
import type { Database as DatabaseType } from "better-sqlite3";

export interface Recommendation {
  id: string;
  title: string;
  rationale: string;
  evidence: string[];
  assignee_email: string;
  assignee_slack_id: string | null;
  scope: "ops" | "tactical" | "strategic";
  urgency: "low" | "medium" | "high";
  confidence: "low" | "medium" | "high";
  generated_at: number;
}

const URGENCY_RANK: Record<Recommendation["urgency"], number> = {
  high: 3,
  medium: 2,
  low: 1,
};

export class OracleStore {
  constructor(private readonly db: DatabaseType) {}

  upsertAll(recs: Recommendation[]): void {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO oracle_recommendations
        (id, assignee_email, assignee_slack_id, title, rationale, evidence,
         scope, urgency, confidence, data, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        assignee_email = excluded.assignee_email,
        assignee_slack_id = excluded.assignee_slack_id,
        title = excluded.title,
        rationale = excluded.rationale,
        evidence = excluded.evidence,
        scope = excluded.scope,
        urgency = excluded.urgency,
        confidence = excluded.confidence,
        data = excluded.data,
        last_seen_at = excluded.last_seen_at
    `);
    const insertMany = this.db.transaction((rows: Recommendation[]) => {
      for (const r of rows) {
        stmt.run(
          r.id,
          r.assignee_email,
          r.assignee_slack_id,
          r.title,
          r.rationale,
          JSON.stringify(r.evidence),
          r.scope,
          r.urgency,
          r.confidence,
          JSON.stringify(r),
          now,
          now,
        );
      }
    });
    insertMany(recs);
  }

  diffNewForAssignee(assigneeEmail: string): Recommendation[] {
    const rows = this.db
      .prepare(
        `SELECT data FROM oracle_recommendations r
         WHERE r.assignee_email = ?
           AND NOT EXISTS (
             SELECT 1 FROM oracle_dms_sent s
             WHERE s.rec_id = r.id AND s.assignee_email = r.assignee_email
           )
         ORDER BY r.last_seen_at DESC`,
      )
      .all(assigneeEmail) as Array<{ data: string }>;
    return rows.map((row) => JSON.parse(row.data) as Recommendation);
  }

  queryAllForAssignee(assigneeEmail: string): Recommendation[] {
    const rows = this.db
      .prepare(
        `SELECT data FROM oracle_recommendations
         WHERE assignee_email = ?
         ORDER BY last_seen_at DESC`,
      )
      .all(assigneeEmail) as Array<{ data: string }>;
    const list = rows.map((row) => JSON.parse(row.data) as Recommendation);
    return list.sort((a, b) => URGENCY_RANK[b.urgency] - URGENCY_RANK[a.urgency]);
  }

  markDMsSent(entries: Array<{ rec_id: string; assignee_email: string }>): void {
    const now = Date.now();
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO oracle_dms_sent (rec_id, assignee_email, sent_at) VALUES (?, ?, ?)`,
    );
    const insertMany = this.db.transaction((rows: typeof entries) => {
      for (const e of rows) {
        stmt.run(e.rec_id, e.assignee_email, now);
      }
    });
    insertMany(entries);
  }
}
```

- [ ] **Step 4: Run tests to verify PASS**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/oracle/store.test.ts
```

Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
cd /Users/vero/openclaw && git add src/sentinel/oracle/store.ts tests/sentinel/oracle/store.test.ts && git commit -m "$(cat <<'EOF'
feat(sentinel): oracle store — upsert, diff, DM-sent tracking

OracleStore wraps the two new sentinel.db tables. upsertAll uses
INSERT...ON CONFLICT to keep first_seen_at stable while bumping
last_seen_at on recurring recommendations (idempotent across cycles).
diffNewForAssignee returns recs not yet DM'd; queryAllForAssignee
returns recs urgency-sorted for the per-person file. markDMsSent is
idempotent via INSERT OR IGNORE.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: File-writer module

**Files:**

- Create: `/Users/vero/openclaw/src/sentinel/oracle/file-writer.ts`
- Create: `/Users/vero/openclaw/tests/sentinel/oracle/file-writer.test.ts`

- [ ] **Step 1: Write failing tests**

Create `/Users/vero/openclaw/tests/sentinel/oracle/file-writer.test.ts`:

```typescript
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { writePerPersonFile, slugForEmail } from "../../../src/sentinel/oracle/file-writer.js";
import type { Recommendation } from "../../../src/sentinel/oracle/store.js";

function rec(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: overrides.id ?? "r1",
    title: overrides.title ?? "Do the thing",
    rationale: overrides.rationale ?? "because",
    evidence: overrides.evidence ?? [],
    assignee_email: overrides.assignee_email ?? "kaleb@example.com",
    assignee_slack_id: overrides.assignee_slack_id ?? null,
    scope: overrides.scope ?? "ops",
    urgency: overrides.urgency ?? "medium",
    confidence: overrides.confidence ?? "medium",
    generated_at: overrides.generated_at ?? 1_700_000_000_000,
  };
}

describe("slugForEmail", () => {
  it("returns the local-part lowercased and non-alphanumerics replaced with dashes", () => {
    expect(slugForEmail("Kaleb.Lundquist@blytzpay.com")).toBe("kaleb-lundquist");
    expect(slugForEmail("ridge@veropwr.com")).toBe("ridge");
    expect(slugForEmail("thomas_morrow@veropwr.com")).toBe("thomas-morrow");
  });
});

describe("writePerPersonFile", () => {
  let libPath: string;

  beforeEach(() => {
    libPath = join(tmpdir(), `jr-lib-fw-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(libPath, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(libPath)) rmSync(libPath, { recursive: true, force: true });
  });

  it("writes a file at recommendations/<slug>.md with YAML frontmatter + sections by urgency", () => {
    const recs = [
      rec({ id: "h1", title: "High thing", urgency: "high" }),
      rec({ id: "m1", title: "Medium thing", urgency: "medium" }),
      rec({ id: "l1", title: "Low thing", urgency: "low" }),
    ];
    const path = writePerPersonFile(libPath, "kaleb@example.com", recs);
    expect(path).toBe(join(libPath, "recommendations", "kaleb.md"));
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, "utf8");
    expect(content).toContain("---");
    expect(content).toContain("total_actions: 3");
    expect(content).toContain("## High urgency");
    expect(content).toContain("## Medium urgency");
    expect(content).toContain("## Low urgency");
    expect(content).toContain("High thing");
    expect(content).toContain("Medium thing");
    expect(content).toContain("Low thing");
    // High should appear before low
    expect(content.indexOf("High thing")).toBeLessThan(content.indexOf("Low thing"));
  });

  it("renders an empty-state file when recs is empty", () => {
    const path = writePerPersonFile(libPath, "nobody@example.com", []);
    const content = readFileSync(path, "utf8");
    expect(content).toContain("total_actions: 0");
    expect(content).toContain("Nothing on your plate");
  });

  it("creates the recommendations directory if missing", () => {
    const recsDir = join(libPath, "recommendations");
    expect(existsSync(recsDir)).toBe(false);
    writePerPersonFile(libPath, "kaleb@example.com", [rec()]);
    expect(existsSync(recsDir)).toBe(true);
  });

  it("is idempotent — full rewrite, second call replaces the first", () => {
    writePerPersonFile(libPath, "kaleb@example.com", [rec({ id: "x", title: "Old action" })]);
    writePerPersonFile(libPath, "kaleb@example.com", [rec({ id: "y", title: "New action" })]);
    const content = readFileSync(join(libPath, "recommendations", "kaleb.md"), "utf8");
    expect(content).not.toContain("Old action");
    expect(content).toContain("New action");
  });
});
```

- [ ] **Step 2: Run tests to verify FAIL**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/oracle/file-writer.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `file-writer.ts`**

Create `/Users/vero/openclaw/src/sentinel/oracle/file-writer.ts`:

```typescript
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Recommendation } from "./store.js";

export function slugForEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function urgencyHeader(urgency: Recommendation["urgency"]): string {
  return urgency.charAt(0).toUpperCase() + urgency.slice(1) + " urgency";
}

function renderAction(r: Recommendation): string {
  const lines: string[] = [];
  lines.push(`### ${r.title}`);
  lines.push("");
  lines.push(r.rationale);
  lines.push("");
  lines.push(`- **Confidence:** ${r.confidence}`);
  lines.push(`- **Scope:** ${r.scope}`);
  if (r.evidence.length > 0) {
    lines.push(`- **Evidence:** ${r.evidence.join(", ")}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function writePerPersonFile(
  libPath: string,
  assigneeEmail: string,
  recs: Recommendation[],
): string {
  const recsDir = join(libPath, "recommendations");
  mkdirSync(recsDir, { recursive: true });
  const slug = slugForEmail(assigneeEmail);
  const path = join(recsDir, `${slug}.md`);

  const now = new Date().toISOString();
  const total = recs.length;

  const lines: string[] = [];
  lines.push("---");
  lines.push(`title: Recommendations for ${assigneeEmail}`);
  lines.push(`generated_at: ${now}`);
  lines.push(`total_actions: ${total}`);
  lines.push("---");
  lines.push("");

  if (total === 0) {
    lines.push("# What's on your plate");
    lines.push("");
    lines.push("_Nothing on your plate right now._");
    writeFileSync(path, lines.join("\n"));
    return path;
  }

  lines.push("# What's on your plate");
  lines.push("");
  lines.push(`_Generated by JR Oracle._`);
  lines.push("");

  for (const urgency of ["high", "medium", "low"] as const) {
    const group = recs.filter((r) => r.urgency === urgency);
    if (group.length === 0) {
      continue;
    }
    lines.push(`## ${urgencyHeader(urgency)}`);
    lines.push("");
    for (const r of group) {
      lines.push(renderAction(r));
    }
  }

  writeFileSync(path, lines.join("\n"));
  return path;
}
```

- [ ] **Step 4: Run tests to verify PASS**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/oracle/file-writer.test.ts
```

Expected: PASS (5/5: slugForEmail + 4 writer tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/vero/openclaw && git add src/sentinel/oracle/file-writer.ts tests/sentinel/oracle/file-writer.test.ts && git commit -m "$(cat <<'EOF'
feat(sentinel): oracle file-writer — per-person markdown rendering

writePerPersonFile groups recommendations by urgency (High → Medium →
Low), emits YAML frontmatter (title, generated_at, total_actions), and
full-rewrites the destination file at recommendations/<slug>.md.
slugForEmail derives "kaleb" from "Kaleb.Lundquist@blytzpay.com".
Empty-state path emits a "Nothing on your plate" file so the structure
exists even before signal arrives.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Oracle main module — LLM call + orchestration

**Files:**

- Create: `/Users/vero/openclaw/src/sentinel/oracle.ts`
- Create: `/Users/vero/openclaw/tests/sentinel/oracle.test.ts`

The main module ties everything together. It calls the LLM ONCE per `recommendAll()` invocation, parses the output, generates stable IDs, returns the recommendations.

- [ ] **Step 1: Write failing tests**

Create `/Users/vero/openclaw/tests/sentinel/oracle.test.ts`:

```typescript
import { existsSync, unlinkSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { openSentinelDb } from "../../src/sentinel/db.js";
import { createOracle } from "../../src/sentinel/oracle.js";
import type { CompanyContextFirestoreLike } from "../../src/sentinel/observers/external-context/company-context.js";

function tmpDb(): string {
  return join(tmpdir(), `oracle-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function cleanupDb(path: string): void {
  for (const suffix of ["", "-shm", "-wal"]) {
    const f = `${path}${suffix}`;
    if (existsSync(f)) unlinkSync(f);
  }
}

function makeFirestoreFake(): CompanyContextFirestoreLike {
  return {
    countProjectsByField: async (field) => {
      if (field === "state") return { TX: 222, UT: 2 };
      if (field === "status") return { ACTIVE: 155, CANCELLED: 51 };
      return {};
    },
    sumProjectValue: async () => 8_000_000,
    countWorkOrdersByStatus: async () => ({ assigned: 283 }),
    listProjectAssignees: async () => [
      { owner_email: "kaleb@example.com", sales_rep_email: null },
      { owner_email: "ridge@example.com", sales_rep_email: null },
    ],
  };
}

const FAKE_LLM_JSON = JSON.stringify({
  recommendations: [
    {
      title: "Check on stuck TX projects",
      rationale: "5 ON_HOLD projects worth $200k",
      evidence_observation_ids: [42],
      evidence_insight_ids: [],
      assignee_email: "kaleb@example.com",
      scope: "ops",
      urgency: "high",
      confidence: "high",
    },
    {
      title: "Reach out to Ridge re: Texas competitor bankruptcies",
      rationale: "Sunnova + PosiGen filed Ch11",
      evidence_observation_ids: [],
      evidence_insight_ids: [198],
      assignee_email: "ridge@example.com",
      scope: "strategic",
      urgency: "medium",
      confidence: "high",
    },
  ],
});

describe("createOracle — recommendAll", () => {
  let dbPath: string;
  let db: DatabaseType;
  let libPath: string;

  beforeEach(() => {
    dbPath = tmpDb();
    db = openSentinelDb(dbPath);
    libPath = join(tmpdir(), `oracle-lib-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(libPath, { recursive: true });
  });

  afterEach(() => {
    db.close();
    cleanupDb(dbPath);
    if (existsSync(libPath)) rmSync(libPath, { recursive: true, force: true });
  });

  it("calls the LLM once and returns parsed recommendations with stable IDs", async () => {
    let llmCalls = 0;
    const oracle = createOracle({
      db,
      libPath,
      userAliases: { "kaleb@example.com": "UKALEB", "ridge@example.com": "URIDGE" },
      firestoreClient: makeFirestoreFake(),
      llm: {
        complete: async () => {
          llmCalls++;
          return FAKE_LLM_JSON;
        },
      },
    });

    const recs = await oracle.recommendAll();
    expect(llmCalls).toBe(1);
    expect(recs).toHaveLength(2);
    expect(recs[0].assignee_email).toBe("kaleb@example.com");
    expect(recs[0].assignee_slack_id).toBe("UKALEB");
    expect(recs[1].assignee_slack_id).toBe("URIDGE");
    // stable ID: hash of title + sorted evidence
    expect(typeof recs[0].id).toBe("string");
    expect(recs[0].id.length).toBeGreaterThan(8);
    // same input → same ID
    const again = await oracle.recommendAll();
    expect(again[0].id).toBe(recs[0].id);
  });

  it("drops recommendations referencing unknown assignee emails", async () => {
    const oracle = createOracle({
      db,
      libPath,
      userAliases: {},
      firestoreClient: makeFirestoreFake(),
      llm: {
        complete: async () =>
          JSON.stringify({
            recommendations: [
              {
                title: "Valid",
                rationale: "x",
                evidence_observation_ids: [],
                evidence_insight_ids: [],
                assignee_email: "kaleb@example.com",
                scope: "ops",
                urgency: "low",
                confidence: "low",
              },
              {
                title: "Invalid assignee",
                rationale: "x",
                evidence_observation_ids: [],
                evidence_insight_ids: [],
                assignee_email: "stranger@example.com",
                scope: "ops",
                urgency: "low",
                confidence: "low",
              },
            ],
          }),
      },
    });
    const recs = await oracle.recommendAll();
    expect(recs).toHaveLength(1);
    expect(recs[0].assignee_email).toBe("kaleb@example.com");
  });

  it("throws on malformed LLM JSON", async () => {
    const oracle = createOracle({
      db,
      libPath,
      userAliases: {},
      firestoreClient: makeFirestoreFake(),
      llm: { complete: async () => "not json" },
    });
    await expect(oracle.recommendAll()).rejects.toThrow();
  });

  it("recommendForUser filters to that user's slack_id", async () => {
    const oracle = createOracle({
      db,
      libPath,
      userAliases: { "kaleb@example.com": "UKALEB", "ridge@example.com": "URIDGE" },
      firestoreClient: makeFirestoreFake(),
      llm: { complete: async () => FAKE_LLM_JSON },
    });
    const ridgeRecs = await oracle.recommendForUser("URIDGE");
    expect(ridgeRecs).toHaveLength(1);
    expect(ridgeRecs[0].assignee_email).toBe("ridge@example.com");
  });
});
```

- [ ] **Step 2: Run tests to verify FAIL**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/oracle.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `oracle.ts`**

Create `/Users/vero/openclaw/src/sentinel/oracle.ts`:

````typescript
import { createHash } from "node:crypto";
import type { Database as DatabaseType } from "better-sqlite3";
import type { LlmClient } from "../triage/llm-client.js";
import { buildCompanyContext } from "./observers/external-context/company-context.js";
import type { CompanyContextFirestoreLike } from "./observers/external-context/company-context.js";
import { writePerPersonFile } from "./oracle/file-writer.js";
import { buildPeopleDirectory } from "./oracle/people-directory.js";
import type { PersonDirectoryEntry } from "./oracle/people-directory.js";
import { OracleStore, type Recommendation } from "./oracle/store.js";

export type { Recommendation } from "./oracle/store.js";

export interface OracleDeps {
  db: DatabaseType;
  llm: LlmClient;
  libPath: string;
  firestoreClient: CompanyContextFirestoreLike;
  userAliases: Record<string, string>;
  dmUser?: (slackUserId: string, text: string) => Promise<void>;
}

export interface Oracle {
  recommendAll(): Promise<Recommendation[]>;
  recommendForUser(slackUserId: string): Promise<Recommendation[]>;
  runCycle(): Promise<{
    recommendations: Recommendation[];
    filesWritten: string[];
    dmsSent: Array<{ assignee_email: string; rec_ids: string[] }>;
  }>;
}

const MAX_DMS_PER_ASSIGNEE_PER_CYCLE = 5;

function stableId(title: string, evidence: string[]): string {
  const sorted = [...evidence].sort();
  return createHash("sha1")
    .update(`${title}|${sorted.join(",")}`)
    .digest("hex")
    .slice(0, 16);
}

function buildPrompt(
  companyContext: string,
  directory: PersonDirectoryEntry[],
  observationSnippets: string[],
  insightSnippets: string[],
): string {
  const directoryJson = JSON.stringify(
    directory.map((d) => ({
      email: d.email,
      display_name: d.display_name,
      source: d.source,
      evidence_count: d.evidence_count,
      notes: d.notes,
    })),
    null,
    2,
  );

  return `You are JR's Oracle. Generate prioritized action recommendations for Vero's team based on the company state and recent observations.

CONTEXT:

1. Company snapshot:
${companyContext}

2. People directory (you MUST pick assignee_email from this list):
${directoryJson}

3. Recent observations (last 48h, top by recency):
${observationSnippets.length > 0 ? observationSnippets.map((s) => `- ${s}`).join("\n") : "(none yet)"}

4. Recent insights (last 14 days, top by confidence):
${insightSnippets.length > 0 ? insightSnippets.map((s) => `- ${s}`).join("\n") : "(none yet)"}

OUTPUT — JSON object only, no markdown fences:
{
  "recommendations": [
    {
      "title": "<short imperative action, <= 100 chars>",
      "rationale": "<1-3 sentence why-this-matters>",
      "evidence_observation_ids": [int, ...],
      "evidence_insight_ids": [int, ...],
      "assignee_email": "<MUST be one of the directory emails>",
      "scope": "ops" | "tactical" | "strategic",
      "urgency": "low" | "medium" | "high",
      "confidence": "low" | "medium" | "high"
    }
  ]
}

Constraints:
- 5-15 recommendations total.
- Distribute across assignees - don't dump everything on one person.
- Cite evidence; recommendations without any evidence are not acceptable.
- Stick to assignees from the directory; if no good match exists, do not invent.
- Emit an empty array if there is truly nothing actionable.`;
}

function queryObservations(db: DatabaseType, sinceMs: number, limit: number): string[] {
  const rows = db
    .prepare(
      `SELECT id, source, topic, summary FROM observations
       WHERE timestamp > ? ORDER BY timestamp DESC LIMIT ?`,
    )
    .all(sinceMs, limit) as Array<{
    id: number;
    source: string;
    topic: string | null;
    summary: string;
  }>;
  return rows.map((r) => `[obs:${r.id}] (${r.source}${r.topic ? "/" + r.topic : ""}) ${r.summary}`);
}

function queryInsights(db: DatabaseType, sinceMs: number, limit: number): string[] {
  const rows = db
    .prepare(
      `SELECT id, category, summary, confidence FROM insights
       WHERE generated_at > ? ORDER BY confidence DESC, generated_at DESC LIMIT ?`,
    )
    .all(sinceMs, limit) as Array<{
    id: number;
    category: string;
    summary: string;
    confidence: number;
  }>;
  return rows.map(
    (r) => `[insight:${r.id}] (${r.category}, conf=${r.confidence.toFixed(2)}) ${r.summary}`,
  );
}

interface RawLlmRecommendation {
  title?: unknown;
  rationale?: unknown;
  evidence_observation_ids?: unknown;
  evidence_insight_ids?: unknown;
  assignee_email?: unknown;
  scope?: unknown;
  urgency?: unknown;
  confidence?: unknown;
}

function isValidScope(value: unknown): value is Recommendation["scope"] {
  return value === "ops" || value === "tactical" || value === "strategic";
}

function isValidLevel(value: unknown): value is Recommendation["urgency"] {
  return value === "low" || value === "medium" || value === "high";
}

function parseEvidence(obs: unknown, ins: unknown): string[] {
  const out: string[] = [];
  if (Array.isArray(obs)) {
    for (const id of obs) {
      if (typeof id === "number") out.push(`obs:${id}`);
    }
  }
  if (Array.isArray(ins)) {
    for (const id of ins) {
      if (typeof id === "number") out.push(`insight:${id}`);
    }
  }
  return out;
}

export function createOracle(deps: OracleDeps): Oracle {
  const store = new OracleStore(deps.db);

  async function callLlm(): Promise<Recommendation[]> {
    const [companyContext, directory] = await Promise.all([
      buildCompanyContext({ client: deps.firestoreClient }),
      buildPeopleDirectory({
        firestoreClient: deps.firestoreClient,
        libPath: deps.libPath,
        userAliases: deps.userAliases,
      }),
    ]);

    const observationSnippets = queryObservations(deps.db, Date.now() - 48 * 60 * 60 * 1000, 50);
    const insightSnippets = queryInsights(deps.db, Date.now() - 14 * 24 * 60 * 60 * 1000, 20);

    const prompt = buildPrompt(companyContext, directory, observationSnippets, insightSnippets);
    const raw = await deps.llm.complete(prompt, { model: "gemini-2.5-flash", temperature: 0.2 });

    const stripped = raw.trim().replace(/^```(?:json)?\n?|\n?```$/g, "");
    const parsed = JSON.parse(stripped) as { recommendations?: RawLlmRecommendation[] };
    if (!Array.isArray(parsed.recommendations)) {
      throw new Error("oracle: LLM response missing 'recommendations' array");
    }

    const directoryEmails = new Set(directory.map((d) => d.email));
    const slackByEmail = new Map(directory.map((d) => [d.email, d.slack_id]));
    const now = Date.now();
    const out: Recommendation[] = [];

    for (const raw of parsed.recommendations) {
      if (
        typeof raw.title !== "string" ||
        typeof raw.rationale !== "string" ||
        typeof raw.assignee_email !== "string"
      ) {
        continue;
      }
      if (!directoryEmails.has(raw.assignee_email)) {
        continue;
      }
      if (!isValidScope(raw.scope) || !isValidLevel(raw.urgency) || !isValidLevel(raw.confidence)) {
        continue;
      }
      const evidence = parseEvidence(raw.evidence_observation_ids, raw.evidence_insight_ids);
      if (evidence.length === 0) {
        continue;
      }
      out.push({
        id: stableId(raw.title, evidence),
        title: raw.title,
        rationale: raw.rationale,
        evidence,
        assignee_email: raw.assignee_email,
        assignee_slack_id: slackByEmail.get(raw.assignee_email) ?? null,
        scope: raw.scope,
        urgency: raw.urgency,
        confidence: raw.confidence,
        generated_at: now,
      });
    }

    return out;
  }

  return {
    async recommendAll() {
      return callLlm();
    },

    async recommendForUser(slackUserId: string) {
      const all = await callLlm();
      return all.filter((r) => r.assignee_slack_id === slackUserId);
    },

    async runCycle() {
      const recs = await callLlm();
      store.upsertAll(recs);

      const filesWritten: string[] = [];
      const assigneeEmails = Array.from(new Set(recs.map((r) => r.assignee_email)));
      for (const email of assigneeEmails) {
        const list = store.queryAllForAssignee(email);
        const path = writePerPersonFile(deps.libPath, email, list);
        filesWritten.push(path);
      }

      const dmsSent: Array<{ assignee_email: string; rec_ids: string[] }> = [];
      if (deps.dmUser) {
        for (const email of assigneeEmails) {
          const slackId = recs.find((r) => r.assignee_email === email)?.assignee_slack_id ?? null;
          if (!slackId) continue;
          const newRecs = store.diffNewForAssignee(email).filter((r) => r.confidence === "high");
          if (newRecs.length === 0) continue;
          const toDM = newRecs.slice(0, MAX_DMS_PER_ASSIGNEE_PER_CYCLE);
          const bullets = toDM.map((r) => `• ${r.title}`).join("\n");
          const extra =
            newRecs.length > MAX_DMS_PER_ASSIGNEE_PER_CYCLE
              ? `\n_…and ${newRecs.length - MAX_DMS_PER_ASSIGNEE_PER_CYCLE} more in your file._`
              : "";
          try {
            await deps.dmUser(slackId, `Oracle: new on your plate\n\n${bullets}${extra}`);
            store.markDMsSent(toDM.map((r) => ({ rec_id: r.id, assignee_email: email })));
            dmsSent.push({ assignee_email: email, rec_ids: toDM.map((r) => r.id) });
          } catch {
            // DM failure — leave entries un-sent so next cycle retries
          }
        }
      }

      return { recommendations: recs, filesWritten, dmsSent };
    },
  };
}
````

- [ ] **Step 4: Run tests to verify PASS**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel/oracle.test.ts
```

Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
cd /Users/vero/openclaw && git add src/sentinel/oracle.ts tests/sentinel/oracle.test.ts && git commit -m "$(cat <<'EOF'
feat(sentinel): oracle main module — LLM call + cycle orchestration

createOracle ties together people-directory + store + file-writer +
inline prompt builder. recommendAll() runs the LLM once, validates
against the directory (drops unknown assignees), computes stable IDs
(hash of title + sorted evidence) for cross-cycle dedup. recommendForUser
filters by slack id. runCycle() upserts to the store, writes per-person
files, and DMs assignees about new high-confidence recommendations
(capped at 5 per assignee per cycle, idempotent via oracle_dms_sent).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Chat handler intent — action-recommendation

**Files:**

- Create: `/Users/vero/openclaw/src/triage/chat/intents/action-recommendation.ts`
- Create: `/Users/vero/openclaw/tests/triage/chat/intents/action-recommendation.test.ts`

This task adds the reactive entry. The chat handler gains a pattern-matched intent that calls the oracle's `recommendForUser` and formats the response.

Before writing tests, **inspect the existing chat handler architecture** to determine the integration point. Look at `src/triage/chat/index.ts` and the existing intent files (if any). Adapt the wiring approach accordingly.

- [ ] **Step 1: Inspect the existing chat handler**

```bash
cd /Users/vero/openclaw && ls src/triage/chat/ && echo "---" && grep -n "intent\|classifier" src/triage/chat/index.ts | head -20
```

- [ ] **Step 2: Write failing tests**

The exact test shape depends on what you find in Step 1. The contract to test (assuming pattern-match style):

- `detectActionRecommendationIntent(message: string): boolean` — true for "what should i do today" / "what's on my plate" / "give me priorities" / "oracle wisdom" / "what's important" (case-insensitive substring); false for unrelated messages like "hello" or "send a slack to ridge".
- `formatRecommendationsReply(recs: Recommendation[]): string` — emits a Slack-friendly bullet list with title + urgency tag + 1-line rationale. Empty list → "Nothing on your plate right now."

Create `/Users/vero/openclaw/tests/triage/chat/intents/action-recommendation.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  detectActionRecommendationIntent,
  formatRecommendationsReply,
} from "../../../../src/triage/chat/intents/action-recommendation.js";
import type { Recommendation } from "../../../../src/sentinel/oracle/store.js";

function rec(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: overrides.id ?? "r1",
    title: overrides.title ?? "Default",
    rationale: overrides.rationale ?? "default rationale",
    evidence: overrides.evidence ?? [],
    assignee_email: overrides.assignee_email ?? "k@x.com",
    assignee_slack_id: overrides.assignee_slack_id ?? "UKALEB",
    scope: overrides.scope ?? "ops",
    urgency: overrides.urgency ?? "medium",
    confidence: overrides.confidence ?? "medium",
    generated_at: 1,
  };
}

describe("detectActionRecommendationIntent", () => {
  it("matches common variants case-insensitively", () => {
    expect(detectActionRecommendationIntent("what should I do today?")).toBe(true);
    expect(detectActionRecommendationIntent("Whats on my plate")).toBe(true);
    expect(detectActionRecommendationIntent("give me priorities")).toBe(true);
    expect(detectActionRecommendationIntent("any oracle wisdom?")).toBe(true);
    expect(detectActionRecommendationIntent("what's important")).toBe(true);
  });

  it("does not match unrelated messages", () => {
    expect(detectActionRecommendationIntent("hello")).toBe(false);
    expect(detectActionRecommendationIntent("send a slack to ridge")).toBe(false);
    expect(detectActionRecommendationIntent("did you finish that?")).toBe(false);
  });
});

describe("formatRecommendationsReply", () => {
  it("formats top 3-5 recommendations with urgency tags", () => {
    const recs = [
      rec({ title: "Thing A", urgency: "high", rationale: "Reason A" }),
      rec({ title: "Thing B", urgency: "medium", rationale: "Reason B" }),
      rec({ title: "Thing C", urgency: "low", rationale: "Reason C" }),
    ];
    const reply = formatRecommendationsReply(recs);
    expect(reply).toContain("Thing A");
    expect(reply).toContain("Thing B");
    expect(reply).toContain("Thing C");
    expect(reply).toContain("[high]");
    expect(reply).toContain("[medium]");
    expect(reply).toContain("[low]");
    expect(reply).toContain("Reason A");
  });

  it("caps to top 5 when more provided", () => {
    const recs = Array.from({ length: 8 }, (_, i) =>
      rec({ id: `r${i}`, title: `Title ${i}`, urgency: "medium" }),
    );
    const reply = formatRecommendationsReply(recs);
    const matches = reply.match(/Title \d+/g) ?? [];
    expect(matches.length).toBeLessThanOrEqual(5);
  });

  it("emits the empty-state message when no recommendations", () => {
    expect(formatRecommendationsReply([])).toContain("Nothing on your plate");
  });
});
```

- [ ] **Step 3: Run tests to verify FAIL**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/triage/chat/intents/action-recommendation.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement `action-recommendation.ts`**

Create `/Users/vero/openclaw/src/triage/chat/intents/action-recommendation.ts`:

```typescript
import type { Recommendation } from "../../../sentinel/oracle/store.js";

const TRIGGER_PHRASES = [
  "what should i do",
  "whats on my plate",
  "what's on my plate",
  "give me priorities",
  "oracle wisdom",
  "whats important",
  "what's important",
];

const URGENCY_RANK: Record<Recommendation["urgency"], number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const MAX_REPLY_ITEMS = 5;

export function detectActionRecommendationIntent(message: string): boolean {
  const lower = message.toLowerCase();
  return TRIGGER_PHRASES.some((p) => lower.includes(p));
}

export function formatRecommendationsReply(recs: Recommendation[]): string {
  if (recs.length === 0) {
    return "Nothing on your plate right now. I'll keep watching.";
  }
  const sorted = [...recs]
    .sort((a, b) => URGENCY_RANK[b.urgency] - URGENCY_RANK[a.urgency])
    .slice(0, MAX_REPLY_ITEMS);
  const lines = sorted.map((r) => `• *${r.title}* [${r.urgency}]\n  ${r.rationale}`);
  return `Top of your plate:\n\n${lines.join("\n\n")}`;
}
```

- [ ] **Step 5: Run tests to verify PASS**

```bash
cd /Users/vero/openclaw && pnpm vitest run tests/triage/chat/intents/action-recommendation.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/vero/openclaw && git add src/triage/chat/intents/action-recommendation.ts tests/triage/chat/intents/action-recommendation.test.ts && git commit -m "$(cat <<'EOF'
feat(triage): action-recommendation chat intent

Pattern-matches common Slack phrasings for "what should I do" and friends
(case-insensitive substring). formatRecommendationsReply emits a Slack-
friendly bullet list (top 5 by urgency) with title + urgency tag + 1-line
rationale. Empty list returns the "nothing on your plate" sentinel.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Wire oracle into Sentinel cycle + chat handler

**Files:**

- Modify: `/Users/vero/openclaw/src/sentinel/index.ts`
- Modify: `/Users/vero/openclaw/src/triage/chat/index.ts` (or equivalent integration point — verify in Step 1)

This task is the integration. Confirm the integration points before editing.

- [ ] **Step 1: Inspect integration points**

```bash
cd /Users/vero/openclaw && grep -n "runCycleOnce\|inquirer\.\|monetizer\." src/sentinel/index.ts | head -20 && echo "---" && grep -n "routeToChat\|handleChatMessage" src/triage/chat/index.ts src/slack/monitor/triage-bridge.ts 2>/dev/null | head -10
```

The Sentinel cycle integration point: in `runCycleOnce()`, after the inquirer step (`await inquirer.formulateQuestions();`), call `await oracle.runCycle()`. Construct the oracle alongside other sentinel components in `createSentinel`.

The chat integration point depends on what you find. If the chat handler has an intent-routing layer, add `detectActionRecommendationIntent` to its switch/case. If it doesn't, prepend an early-return check at the top of the chat handler that, when matched, calls `oracle.recommendForUser(userId)` and replies via the existing reply mechanism, then short-circuits.

- [ ] **Step 2: Wire oracle into `createSentinel`**

In `/Users/vero/openclaw/src/sentinel/index.ts`:

Add imports:

```typescript
import { createOracle, type Oracle } from "./oracle.js";
import { createDefaultCompanyContextClient } from "./observers/external-context/company-context.js";
```

Construct the oracle in `createSentinel`, after the inquirer:

```typescript
const firestoreClient = await createDefaultCompanyContextClient();
const oracle = createOracle({
  db,
  llm: deps.llm,
  libPath,
  firestoreClient,
  userAliases: SLACK_USER_ALIASES,
  dmUser: deps.dmUser,
});
```

The above is an `await` — `createSentinel` is already async-compatible (or needs to become so). If `createSentinel` is sync, lift this into a lazy getter that constructs the oracle on first cycle use.

In `runCycleOnce()`, after `await inquirer.formulateQuestions();`:

```typescript
// F3 Oracle — generate and persist per-person recommendations, DM on new high-confidence
try {
  await oracle.runCycle();
} catch (err) {
  // eslint-disable-next-line no-console
  console.error("[sentinel] oracle cycle failed:", (err as Error).message);
}
```

- [ ] **Step 3: Wire chat intent**

This step depends on what `src/triage/chat/index.ts` looks like. The pattern: when a user message arrives, check `detectActionRecommendationIntent(message.text)` early; if true, call `oracle.recommendForUser(message.user)` and reply with `formatRecommendationsReply(recs)`, then return without falling through to the normal classifier.

Use whatever existing test harness is in place to verify the chat integration. If there isn't one, manual testing in the live smoke (Task 8) is acceptable for v1.

- [ ] **Step 4: Verify typecheck + full sentinel suite**

```bash
cd /Users/vero/openclaw && pnpm tsgo 2>&1 | grep -E "oracle|sentinel/index|triage/chat" || echo "no relevant errors"
cd /Users/vero/openclaw && pnpm vitest run tests/sentinel tests/triage
```

Expected: typecheck clean for new files. Sentinel + triage suites pass.

- [ ] **Step 5: Manual instantiation smoke (no live LLM)**

```bash
cd /Users/vero/openclaw && node --import tsx -e "
import('./src/sentinel/oracle.js').then(async (m) => {
  const Database = (await import('better-sqlite3')).default;
  const { openSentinelDb } = await import('./src/sentinel/db.js');
  const db = openSentinelDb(':memory:');
  const oracle = m.createOracle({
    db,
    llm: { complete: async () => JSON.stringify({ recommendations: [] }) },
    libPath: '/tmp/jr-lib-smoke',
    firestoreClient: {
      countProjectsByField: async () => ({}),
      sumProjectValue: async () => 0,
      countWorkOrdersByStatus: async () => ({}),
      listProjectAssignees: async () => [],
    },
    userAliases: {},
  });
  const recs = await oracle.recommendAll();
  console.log('recommendAll returned', recs.length, 'recommendations');
});
"
```

Expected: `recommendAll returned 0 recommendations`.

- [ ] **Step 6: Commit**

```bash
cd /Users/vero/openclaw && git add src/sentinel/index.ts src/triage/chat/index.ts && git commit -m "$(cat <<'EOF'
feat(sentinel,triage): wire F3 Oracle into cycle + chat handler

- createSentinel constructs Oracle alongside the other sentinel
  subsystems. runCycleOnce() calls oracle.runCycle() after the inquirer
  step (guarded with try/catch; cycle continues on oracle failure).
- Chat handler short-circuits to the oracle when an action-recommendation
  intent is detected; replies with formatRecommendationsReply().

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Live smoke (manual, gated)

**Files:** none (operational verification).

Operator-driven; do not run autonomously.

- [ ] **Step 1: Set `OPENCLAW_SENTINEL_BOOT_CYCLE=1`** in `~/.openclaw/.env`.

- [ ] **Step 2: Restart JR**

```bash
launchctl kickstart -k gui/$(id -u)/com.openclaw.agent
```

Wait for `[sentinel] boot-cycle complete` in `/Users/vero/openclaw.log`.

- [ ] **Step 3: Verify the per-person files**

```bash
ls -la ~/.openclaw/jr-library/recommendations/
cat ~/.openclaw/jr-library/recommendations/*.md | head -100
```

Expected: at least one per-person file with YAML frontmatter and urgency-grouped action sections.

- [ ] **Step 4: Verify the database**

```bash
sqlite3 ~/.openclaw/sentinel.db "SELECT COUNT(*) AS recs FROM oracle_recommendations;"
sqlite3 ~/.openclaw/sentinel.db "SELECT assignee_email, urgency, title FROM oracle_recommendations ORDER BY last_seen_at DESC LIMIT 10;"
```

Expected: 5-15 rows. Assignees match real Vero emails (ridge@veropwr.com / thomas.morrow@veropwr.com / kaleb.lundquist@blytzpay.com / etc.).

- [ ] **Step 5: Verify DM behavior**

If any rec was high-confidence and the assignee has a Slack alias, the assignee should have received exactly one DM with the new items. Confirm by asking Kaleb (or watching #openclaw-debug) whether he got the DM.

- [ ] **Step 6: Reactive entry test**

DM JR (as Kaleb): "What should I do today?" — JR should reply with the top 3-5 recs assigned to UKALEB.

- [ ] **Step 7: Restore `OPENCLAW_SENTINEL_BOOT_CYCLE=0`**.

- [ ] **Step 8: No commit — verification only.**

---

## Spec coverage check

- Schema migration (oracle_recommendations + oracle_dms_sent) → Task 1.
- Dynamic people directory (Firestore + library, no static map) → Task 2.
- Store (upsert idempotency, diff, DM-sent tracking) → Task 3.
- File writer (per-person markdown, urgency-grouped, empty-state) → Task 4.
- Oracle main module (LLM call, stable ID, validation against directory, runCycle orchestration) → Task 5.
- Chat handler intent (reactive entry) → Task 6.
- Sentinel cycle wiring + chat handler integration → Task 7.
- Manual smoke → Task 8.

## Out of scope (per spec)

- Embedding-based filtering (Phase D.2 if useful).
- Self-execution / auto-action.
- User feedback loop (dismissal, "good rec" / "bad rec").
- Cross-cycle ranking learning beyond simple "new ID" diff.
- Static role map for non-project ops.
