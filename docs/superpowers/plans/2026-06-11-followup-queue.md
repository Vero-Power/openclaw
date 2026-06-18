# Follow-up Queue Implementation Plan (Fix B — no false promises)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When anyone asks JR to do something later (DM another person, look into something, run a task), JR files a real follow-up that gets executed — and his replies only claim what was actually queued.

**Architecture:** New `followups` table in sentinel.db + `FollowupStore` + `FollowupProcessor`. Two creation surfaces: the sentinel conversation-handler (new `file_followup` LLM decision) and chat-v2 (reasoner emits optional `followups` array, filed before the responder runs). Processing fires immediately on creation; the 2h sentinel cycle drains anything still pending. `task` kind spawns a triage session (plan DM'd to the requester for approval). All gated on `OPENCLAW_FOLLOWUPS=1`.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), better-sqlite3, zod, vitest. Repo: `/Users/vero/openclaw`, branch `cleanup/phase-6-sentinel-jr-phase-a`. Spec: `docs/superpowers/specs/2026-06-11-followup-queue-design.md`.

**Conventions (pre-commit hook enforces):** oxlint — always use `{ }` for if-bodies (curly), no `any`, no empty-object type `{}`, import sort (node builtins → packages → relative, alphabetical). Run `npx vitest run <file>` for tests.

---

### Task 1: `followups` table in sentinel schema

**Files:**

- Modify: `src/sentinel/db.ts` (append to `SCHEMA_SQL`, before the closing backtick after `observer_watermarks`)
- Test: `tests/sentinel/db.test.ts`

- [ ] **Step 1: Write the failing test**

Append to the existing `describe` block in `tests/sentinel/db.test.ts` (follow the file's existing tmp-db helper pattern):

```ts
it("creates the followups table with expected columns", () => {
  db = openSentinelDb(dbPath);
  const cols = db.prepare(`PRAGMA table_info(followups)`).all() as Array<{ name: string }>;
  const names = cols.map((c) => c.name);
  expect(names).toEqual([
    "id",
    "kind",
    "payload",
    "status",
    "source",
    "source_ref",
    "requester_user_id",
    "created_at",
    "processed_at",
    "attempts",
    "last_error",
  ]);
});
```

(Adapt `db`/`dbPath` variable names to the file's existing fixtures — read the file first.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sentinel/db.test.ts`
Expected: FAIL — `followups` table has no columns.

- [ ] **Step 3: Add the table to SCHEMA_SQL**

In `src/sentinel/db.ts`, after the `observer_watermarks` CREATE TABLE (line ~106), add inside the `SCHEMA_SQL` template string:

```sql
CREATE TABLE IF NOT EXISTS followups (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  kind              TEXT NOT NULL,
  payload           TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  source            TEXT NOT NULL,
  source_ref        TEXT,
  requester_user_id TEXT,
  created_at        INTEGER NOT NULL,
  processed_at      INTEGER,
  attempts          INTEGER NOT NULL DEFAULT 0,
  last_error        TEXT
);

CREATE INDEX IF NOT EXISTS idx_followups_status ON followups(status);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sentinel/db.test.ts` — Expected: PASS (existing tests too — `CREATE TABLE IF NOT EXISTS` is migration-safe for the live db).

- [ ] **Step 5: Commit**

```bash
git add src/sentinel/db.ts tests/sentinel/db.test.ts
git commit -m "feat(sentinel): followups table schema"
```

---

### Task 2: FollowupStore

**Files:**

- Create: `src/sentinel/followup-store.ts`
- Test: `tests/sentinel/followup-store.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/sentinel/followup-store.test.ts`:

```ts
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openSentinelDb } from "../../src/sentinel/db.js";
import { FollowupStore } from "../../src/sentinel/followup-store.js";

function tmpDbPath(): string {
  return join(tmpdir(), `sentinel-fus-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function cleanup(path: string): void {
  for (const suffix of ["", "-shm", "-wal"]) {
    const full = `${path}${suffix}`;
    if (existsSync(full)) {
      unlinkSync(full);
    }
  }
}

describe("FollowupStore", () => {
  let dbPath: string;
  let db: DatabaseType;
  let store: FollowupStore;

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = openSentinelDb(dbPath);
    store = new FollowupStore(db);
  });

  afterEach(() => {
    db.close();
    cleanup(dbPath);
  });

  it("inserts and reads back a followup with parsed payload", () => {
    const id = store.insert({
      kind: "dm_person",
      payload: { target_alias: "ridge", topic: "solar", question_text: "Q?" },
      source: "conversation",
      sourceRef: "42",
      requesterUserId: "U_KALEB",
    });
    const row = store.get(id);
    expect(row).not.toBeNull();
    expect(row!.kind).toBe("dm_person");
    expect(row!.status).toBe("pending");
    expect(row!.payload).toEqual({ target_alias: "ridge", topic: "solar", question_text: "Q?" });
    expect(row!.source).toBe("conversation");
    expect(row!.source_ref).toBe("42");
    expect(row!.requester_user_id).toBe("U_KALEB");
    expect(row!.attempts).toBe(0);
  });

  it("listPending returns only pending rows, oldest first", () => {
    const a = store.insert({ kind: "note", payload: { text: "a" }, source: "chat" });
    const b = store.insert({ kind: "note", payload: { text: "b" }, source: "chat" });
    store.markDone(a);
    const pending = store.listPending();
    expect(pending.map((r) => r.id)).toEqual([b]);
  });

  it("markDone / markSkipped stamp status and processed_at", () => {
    const a = store.insert({ kind: "note", payload: { text: "a" }, source: "chat" });
    const b = store.insert({ kind: "note", payload: { text: "b" }, source: "chat" });
    store.markDone(a);
    store.markSkipped(b, "opted out");
    expect(store.get(a)!.status).toBe("done");
    expect(store.get(a)!.processed_at).not.toBeNull();
    expect(store.get(b)!.status).toBe("skipped");
    expect(store.get(b)!.last_error).toBe("opted out");
  });

  it("recordFailure increments attempts and fails at 3", () => {
    const id = store.insert({ kind: "task", payload: { task_text: "x" }, source: "chat" });
    store.recordFailure(id, "boom 1");
    expect(store.get(id)!.status).toBe("pending");
    expect(store.get(id)!.attempts).toBe(1);
    store.recordFailure(id, "boom 2");
    expect(store.get(id)!.status).toBe("pending");
    store.recordFailure(id, "boom 3");
    const row = store.get(id)!;
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(3);
    expect(row.last_error).toBe("boom 3");
    expect(store.listPending()).toHaveLength(0);
  });

  it("listCreatedBetween returns rows in window regardless of status", () => {
    const id = store.insert({ kind: "note", payload: { text: "a" }, source: "chat" });
    store.markDone(id);
    const now = Date.now();
    expect(store.listCreatedBetween(now - 60_000, now + 60_000)).toHaveLength(1);
    expect(store.listCreatedBetween(now + 60_000, now + 120_000)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/sentinel/followup-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement FollowupStore**

Create `src/sentinel/followup-store.ts`:

```ts
import type { Database as DatabaseType } from "better-sqlite3";

export type FollowupKind = "dm_person" | "note" | "task";
export type FollowupStatus = "pending" | "done" | "failed" | "skipped";
export type FollowupSource = "conversation" | "chat";

export interface FollowupRow {
  id: number;
  kind: FollowupKind;
  payload: Record<string, unknown>;
  status: FollowupStatus;
  source: FollowupSource;
  source_ref: string | null;
  requester_user_id: string | null;
  created_at: number;
  processed_at: number | null;
  attempts: number;
  last_error: string | null;
}

export interface InsertFollowupParams {
  kind: FollowupKind;
  payload: Record<string, unknown>;
  source: FollowupSource;
  sourceRef?: string;
  requesterUserId?: string;
}

const MAX_ATTEMPTS = 3;

interface RawRow extends Omit<FollowupRow, "payload"> {
  payload: string;
}

function hydrate(raw: RawRow): FollowupRow {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(raw.payload) as Record<string, unknown>;
  } catch {
    payload = {};
  }
  return { ...raw, payload };
}

export class FollowupStore {
  constructor(private db: DatabaseType) {}

  insert(params: InsertFollowupParams): number {
    const result = this.db
      .prepare(
        `INSERT INTO followups (kind, payload, status, source, source_ref, requester_user_id, created_at)
         VALUES (?, ?, 'pending', ?, ?, ?, ?)`,
      )
      .run(
        params.kind,
        JSON.stringify(params.payload),
        params.source,
        params.sourceRef ?? null,
        params.requesterUserId ?? null,
        Date.now(),
      );
    return Number(result.lastInsertRowid);
  }

  get(id: number): FollowupRow | null {
    const raw = this.db.prepare(`SELECT * FROM followups WHERE id = ?`).get(id) as
      | RawRow
      | undefined;
    return raw ? hydrate(raw) : null;
  }

  listPending(): FollowupRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM followups WHERE status = 'pending' ORDER BY created_at ASC, id ASC`)
      .all() as RawRow[];
    return rows.map(hydrate);
  }

  listCreatedBetween(startMs: number, endMs: number): FollowupRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM followups WHERE created_at >= ? AND created_at < ? ORDER BY created_at ASC`,
      )
      .all(startMs, endMs) as RawRow[];
    return rows.map(hydrate);
  }

  markDone(id: number): void {
    this.db
      .prepare(`UPDATE followups SET status = 'done', processed_at = ? WHERE id = ?`)
      .run(Date.now(), id);
  }

  markSkipped(id: number, reason: string): void {
    this.db
      .prepare(
        `UPDATE followups SET status = 'skipped', processed_at = ?, last_error = ? WHERE id = ?`,
      )
      .run(Date.now(), reason, id);
  }

  recordFailure(id: number, error: string): void {
    this.db
      .prepare(
        `UPDATE followups
         SET attempts = attempts + 1,
             last_error = ?,
             status = CASE WHEN attempts + 1 >= ${MAX_ATTEMPTS} THEN 'failed' ELSE 'pending' END,
             processed_at = CASE WHEN attempts + 1 >= ${MAX_ATTEMPTS} THEN ? ELSE processed_at END
         WHERE id = ?`,
      )
      .run(error, Date.now(), id);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/sentinel/followup-store.test.ts` — Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add src/sentinel/followup-store.ts tests/sentinel/followup-store.test.ts
git commit -m "feat(sentinel): FollowupStore for the follow-up queue"
```

---

### Task 3: FollowupProcessor

**Files:**

- Create: `src/sentinel/followup-processor.ts`
- Test: `tests/sentinel/followup-processor.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/sentinel/followup-processor.test.ts`:

```ts
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ConversationStore } from "../../src/sentinel/conversation-store.js";
import { openSentinelDb } from "../../src/sentinel/db.js";
import { FollowupProcessor } from "../../src/sentinel/followup-processor.js";
import { FollowupStore } from "../../src/sentinel/followup-store.js";

function tmpDbPath(): string {
  return join(tmpdir(), `sentinel-fup-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function cleanup(path: string): void {
  for (const suffix of ["", "-shm", "-wal"]) {
    const full = `${path}${suffix}`;
    if (existsSync(full)) {
      unlinkSync(full);
    }
  }
}

const ALIASES = { ridge: "U_RIDGE", kaleb: "U_KALEB" };

describe("FollowupProcessor", () => {
  let dbPath: string;
  let db: DatabaseType;
  let store: FollowupStore;
  let conversationStore: ConversationStore;
  let dmUser: ReturnType<typeof vi.fn>;
  let spawnTask: ReturnType<typeof vi.fn>;
  let processor: FollowupProcessor;

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = openSentinelDb(dbPath);
    store = new FollowupStore(db);
    conversationStore = new ConversationStore(db);
    dmUser = vi.fn().mockResolvedValue(undefined);
    spawnTask = vi.fn().mockResolvedValue(undefined);
    processor = new FollowupProcessor({
      store,
      db,
      conversationStore,
      userAliases: ALIASES,
      dmUser,
      spawnTask,
    });
  });

  afterEach(() => {
    db.close();
    cleanup(dbPath);
  });

  it("dm_person: opens a tracked conversation and DMs the target", async () => {
    const id = store.insert({
      kind: "dm_person",
      payload: {
        target_alias: "ridge",
        topic: "project phoenix",
        question_text: "What's the latest?",
        context: "Kaleb pointed me your way.",
      },
      source: "conversation",
      requesterUserId: "U_KALEB",
    });
    await processor.processPending();
    expect(store.get(id)!.status).toBe("done");
    expect(dmUser).toHaveBeenCalledTimes(1);
    expect(dmUser.mock.calls[0][0]).toBe("U_RIDGE");
    expect(dmUser.mock.calls[0][1]).toContain("Kaleb pointed me your way.");
    expect(dmUser.mock.calls[0][1]).toContain("What's the latest?");
    expect(conversationStore.findOpenForPerson("U_RIDGE")).not.toBeNull();
  });

  it("dm_person: unknown alias is skipped", async () => {
    const id = store.insert({
      kind: "dm_person",
      payload: { target_alias: "priya", topic: "t", question_text: "q" },
      source: "conversation",
    });
    await processor.processPending();
    expect(store.get(id)!.status).toBe("skipped");
    expect(dmUser).not.toHaveBeenCalled();
  });

  it("dm_person: opted-out target is skipped", async () => {
    db.prepare(
      `INSERT INTO opt_outs (person_user_id, scope, added_at, reason) VALUES ('U_RIDGE','global',?, 'no')`,
    ).run(Date.now());
    const id = store.insert({
      kind: "dm_person",
      payload: { target_alias: "ridge", topic: "t", question_text: "q" },
      source: "conversation",
    });
    await processor.processPending();
    expect(store.get(id)!.status).toBe("skipped");
    expect(dmUser).not.toHaveBeenCalled();
  });

  it("dm_person: target with open conversation stays pending (collision queue)", async () => {
    conversationStore.open({
      person_user_id: "U_RIDGE",
      channel: "U_RIDGE",
      topic: "existing",
      opening_message: "hi",
    });
    const id = store.insert({
      kind: "dm_person",
      payload: { target_alias: "ridge", topic: "t", question_text: "q" },
      source: "conversation",
    });
    await processor.processPending();
    expect(store.get(id)!.status).toBe("pending");
    expect(store.get(id)!.attempts).toBe(0);
    expect(dmUser).not.toHaveBeenCalled();
  });

  it("note: marked done immediately", async () => {
    const id = store.insert({ kind: "note", payload: { text: "check X" }, source: "chat" });
    await processor.processPending();
    expect(store.get(id)!.status).toBe("done");
  });

  it("task: spawns triage task with requester and marks done", async () => {
    const id = store.insert({
      kind: "task",
      payload: { task_text: "archive #old-channel", context: "asked in DM" },
      source: "chat",
      requesterUserId: "U_KALEB",
    });
    await processor.processPending();
    expect(spawnTask).toHaveBeenCalledWith({
      taskText: "archive #old-channel",
      context: "asked in DM",
      requesterUserId: "U_KALEB",
    });
    expect(store.get(id)!.status).toBe("done");
  });

  it("task: missing requester is skipped", async () => {
    const id = store.insert({ kind: "task", payload: { task_text: "x" }, source: "chat" });
    await processor.processPending();
    expect(store.get(id)!.status).toBe("skipped");
    expect(spawnTask).not.toHaveBeenCalled();
  });

  it("thrown error records failure; third failure marks failed", async () => {
    dmUser.mockRejectedValue(new Error("slack down"));
    const id = store.insert({
      kind: "dm_person",
      payload: { target_alias: "ridge", topic: "t", question_text: "q" },
      source: "conversation",
    });
    await processor.processPending();
    expect(store.get(id)!.status).toBe("pending");
    expect(store.get(id)!.attempts).toBe(1);
    await processor.processPending();
    await processor.processPending();
    expect(store.get(id)!.status).toBe("failed");
    expect(store.get(id)!.last_error).toContain("slack down");
  });

  it("malformed dm_person payload is skipped, not retried", async () => {
    const id = store.insert({ kind: "dm_person", payload: { nope: true }, source: "chat" });
    await processor.processPending();
    expect(store.get(id)!.status).toBe("skipped");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/sentinel/followup-processor.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement FollowupProcessor**

Create `src/sentinel/followup-processor.ts`:

```ts
import type { Database as DatabaseType } from "better-sqlite3";
import { z } from "zod";
import type { ConversationStore } from "./conversation-store.js";
import type { FollowupRow, FollowupStore } from "./followup-store.js";
import type { ChannelNameResolver } from "./slack-resolvers.js";

const DmPersonPayloadSchema = z.object({
  target_alias: z.string(),
  topic: z.string(),
  question_text: z.string(),
  context: z.string().optional(),
});

const NotePayloadSchema = z.object({ text: z.string() });

const TaskPayloadSchema = z.object({
  task_text: z.string(),
  context: z.string().optional(),
});

export interface SpawnTaskInput {
  taskText: string;
  context?: string;
  requesterUserId: string;
}

export interface FollowupProcessorDeps {
  store: FollowupStore;
  db: DatabaseType;
  conversationStore: ConversationStore;
  userAliases: Record<string, string>;
  dmUser?: (userId: string, text: string) => Promise<void>;
  channelResolver?: ChannelNameResolver;
  spawnTask?: (input: SpawnTaskInput) => Promise<void>;
}

export class FollowupProcessor {
  constructor(private deps: FollowupProcessorDeps) {}

  async processPending(): Promise<{ processed: number }> {
    const pending = this.deps.store.listPending();
    let processed = 0;
    for (const row of pending) {
      try {
        const handled = await this.processOne(row);
        if (handled) {
          processed += 1;
        }
      } catch (err) {
        this.deps.store.recordFailure(row.id, (err as Error).message);
      }
    }
    return { processed };
  }

  // Returns true when the row reached a terminal status; false when it stays pending
  // (collision or missing dep — retried on the next sentinel cycle).
  private async processOne(row: FollowupRow): Promise<boolean> {
    if (row.kind === "note") {
      this.deps.store.markDone(row.id);
      return true;
    }

    if (row.kind === "dm_person") {
      const parsed = DmPersonPayloadSchema.safeParse(row.payload);
      if (!parsed.success) {
        this.deps.store.markSkipped(row.id, "malformed dm_person payload");
        return true;
      }
      const alias = parsed.data.target_alias.toLowerCase();
      const targetUserId = this.deps.userAliases[alias];
      if (!targetUserId) {
        this.deps.store.markSkipped(row.id, `unknown alias: ${alias}`);
        return true;
      }
      const optedOut = this.deps.db
        .prepare(`SELECT 1 FROM opt_outs WHERE scope = 'global' AND person_user_id = ?`)
        .get(targetUserId);
      if (optedOut) {
        this.deps.store.markSkipped(row.id, `target opted out: ${alias}`);
        return true;
      }
      if (this.deps.conversationStore.findOpenForPerson(targetUserId)) {
        // Collision: one open conversation per person. Stays pending for the next cycle.
        return false;
      }
      if (!this.deps.dmUser) {
        return false;
      }
      const rawText = parsed.data.context
        ? `${parsed.data.context}\n\n${parsed.data.question_text}`
        : parsed.data.question_text;
      const text = this.deps.channelResolver
        ? await this.deps.channelResolver.enrichText(rawText)
        : rawText;
      this.deps.conversationStore.open({
        person_user_id: targetUserId,
        channel: targetUserId,
        topic: parsed.data.topic,
        opening_message: rawText,
      });
      await this.deps.dmUser(targetUserId, text);
      this.deps.store.markDone(row.id);
      return true;
    }

    // kind === "task"
    const parsed = TaskPayloadSchema.safeParse(row.payload);
    if (!parsed.success) {
      this.deps.store.markSkipped(row.id, "malformed task payload");
      return true;
    }
    if (!row.requester_user_id) {
      this.deps.store.markSkipped(row.id, "task followup has no requester");
      return true;
    }
    if (!this.deps.spawnTask) {
      return false;
    }
    await this.deps.spawnTask({
      taskText: parsed.data.task_text,
      context: parsed.data.context,
      requesterUserId: row.requester_user_id,
    });
    this.deps.store.markDone(row.id);
    return true;
  }
}

export { NotePayloadSchema };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/sentinel/followup-processor.test.ts` — Expected: PASS (9/9).

- [ ] **Step 5: Commit**

```bash
git add src/sentinel/followup-processor.ts tests/sentinel/followup-processor.test.ts
git commit -m "feat(sentinel): FollowupProcessor — dm_person/note/task dispatch with retries"
```

---

### Task 4: `file_followup` decision in the conversation-handler

**Files:**

- Modify: `src/sentinel/conversation-handler.ts`
- Test: `tests/sentinel/conversation-handler.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `tests/sentinel/conversation-handler.test.ts` (reuse the file's existing fixtures — `makeEvent`, store/db setup, mock LLM pattern):

```ts
describe("file_followup decision", () => {
  // inside, reuse the same beforeEach/afterEach fixtures as the surrounding tests

  it("Ridge regression: redirect files a dm_person followup, replies honestly, closes", async () => {
    const conv = store.open({
      person_user_id: "U_ALICE",
      channel: "D_CH1",
      topic: "project phoenix status",
      opening_message: "What's the status?",
    });
    const llm: LlmClient = {
      complete: vi.fn().mockResolvedValue(
        JSON.stringify({
          action: "file_followup",
          kind: "dm_person",
          payload: {
            target_alias: "ridge",
            topic: "project phoenix status",
            question_text: "What's the latest on project phoenix?",
            context: "Kaleb pointed me your way.",
          },
          reply_text: "Got it — I've queued a message to Ridge.",
          takeaway: "Alice redirected to Ridge; followup queued.",
        }),
      ),
    };
    const postMessage = vi.fn().mockResolvedValue(undefined);
    const fileFollowup = vi.fn().mockResolvedValue(undefined);
    const consumed = await handleConversationReply(
      makeEvent({ text: "Ask Ridge. Slack him." }),
      { botUserId: "U_JR" },
      { store, llm, db, postMessage, fileFollowup, userAliases: { ridge: "U_RIDGE" } },
    );
    expect(consumed).toBe(true);
    expect(postMessage).toHaveBeenCalledWith("D_CH1", "Got it — I've queued a message to Ridge.");
    expect(fileFollowup).toHaveBeenCalledWith({
      kind: "dm_person",
      payload: {
        target_alias: "ridge",
        topic: "project phoenix status",
        question_text: "What's the latest on project phoenix?",
        context: "Kaleb pointed me your way.",
      },
      source: "conversation",
      sourceRef: String(conv.id),
      requesterUserId: "U_ALICE",
    });
    expect(store.findOpenForPerson("U_ALICE")).toBeNull();
  });

  it("prompt includes followup instructions and aliases only when fileFollowup dep present", async () => {
    store.open({
      person_user_id: "U_ALICE",
      channel: "D_CH1",
      topic: "t",
      opening_message: "m",
    });
    const complete = vi
      .fn()
      .mockResolvedValue(JSON.stringify({ action: "close_with_thanks", wrapup: "thanks" }));
    const llm: LlmClient = { complete };
    await handleConversationReply(
      makeEvent(),
      { botUserId: "U_JR" },
      {
        store,
        llm,
        db,
        postMessage: vi.fn().mockResolvedValue(undefined),
        fileFollowup: vi.fn().mockResolvedValue(undefined),
        userAliases: { ridge: "U_RIDGE" },
      },
    );
    expect(complete.mock.calls[0][0]).toContain("file_followup");
    expect(complete.mock.calls[0][0]).toContain("ridge");
    expect(complete.mock.calls[0][0]).toContain("Never claim you WILL do something");
  });

  it("prompt omits followup instructions when fileFollowup dep absent", async () => {
    store.open({
      person_user_id: "U_ALICE",
      channel: "D_CH1",
      topic: "t",
      opening_message: "m",
    });
    const complete = vi
      .fn()
      .mockResolvedValue(JSON.stringify({ action: "close_with_thanks", wrapup: "thanks" }));
    await handleConversationReply(
      makeEvent(),
      { botUserId: "U_JR" },
      { store, llm: { complete }, db, postMessage: vi.fn().mockResolvedValue(undefined) },
    );
    expect(complete.mock.calls[0][0]).not.toContain("file_followup");
  });

  it("file_followup decision without dep still replies and closes (no crash)", async () => {
    store.open({
      person_user_id: "U_ALICE",
      channel: "D_CH1",
      topic: "t",
      opening_message: "m",
    });
    const llm: LlmClient = {
      complete: vi.fn().mockResolvedValue(
        JSON.stringify({
          action: "file_followup",
          kind: "note",
          payload: { text: "x" },
          reply_text: "Noted.",
          takeaway: "tk",
        }),
      ),
    };
    const postMessage = vi.fn().mockResolvedValue(undefined);
    const consumed = await handleConversationReply(
      makeEvent(),
      { botUserId: "U_JR" },
      { store, llm, db, postMessage },
    );
    expect(consumed).toBe(true);
    expect(postMessage).toHaveBeenCalledWith("D_CH1", "Noted.");
    expect(store.findOpenForPerson("U_ALICE")).toBeNull();
  });
});
```

(Adjust `store.open(...)` return usage to the actual `ConversationStore.open` return type — it returns the conversation with `id`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/sentinel/conversation-handler.test.ts`
Expected: FAIL — schema rejects `file_followup`, deps lack `fileFollowup`/`userAliases`.

- [ ] **Step 3: Implement**

In `src/sentinel/conversation-handler.ts`:

3a. Add import at top (after the ConversationStore import):

```ts
import type { FollowupKind, FollowupSource } from "./followup-store.js";
```

3b. Extend `ConversationReplyDeps`:

```ts
export interface FileFollowupInput {
  kind: FollowupKind;
  payload: Record<string, unknown>;
  source: FollowupSource;
  sourceRef: string;
  requesterUserId: string;
}

export interface ConversationReplyDeps {
  store: ConversationStore;
  llm: LlmClient;
  db: DatabaseType;
  postMessage: (channel: string, text: string) => Promise<void>;
  kalebUserId?: string;
  channelResolver?: ChannelNameResolver;
  fileFollowup?: (input: FileFollowupInput) => Promise<void>;
  userAliases?: Record<string, string>;
}
```

3c. Extend `LlmDecisionSchema` with a fourth variant:

```ts
const LlmDecisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ask_followup"), question: z.string() }),
  z.object({ action: z.literal("close_with_thanks"), wrapup: z.string() }),
  z.object({
    action: z.literal("escalate"),
    summary: z.string(),
  }),
  z.object({
    action: z.literal("file_followup"),
    kind: z.enum(["dm_person", "note", "task"]),
    payload: z.record(z.string(), z.unknown()),
    reply_text: z.string(),
    takeaway: z.string(),
  }),
]);
```

3d. Add the followup prompt block and thread it through `buildDecisionPrompt`/`decideLlm` (new `followupBlock` parameter):

```ts
function buildFollowupPromptBlock(userAliases: Record<string, string> | undefined): string {
  const aliasList = Object.keys(userAliases ?? {}).join(", ") || "(none)";
  return `
- If the person asks you to do something later — message someone else ("ask Ridge"), look into something, or perform a task — return:
  {"action":"file_followup","kind":"dm_person"|"note"|"task","payload":{...},"reply_text":"<honest reply that says you've queued it>","takeaway":"<what you learned + what was queued>"}
  Payload shapes:
  - dm_person: {"target_alias":"<one of: ${aliasList}>","topic":"...","question_text":"<the question to DM them>","context":"<one-line handoff, e.g. 'Kaleb pointed me your way about X'>"}
  - note: {"text":"<what to surface in the daily report>"}
  - task: {"task_text":"<the task in plain words>","context":"<brief background>"}
  For dm_person, the target_alias MUST be one of: ${aliasList}. If the person they name is not in that list, use kind "note" instead.

HONESTY RULE: Never claim you WILL do something in the future. Either file_followup now (then reply_text says "I've queued it") or say you can't. Promises without a filed follow-up are forbidden.`;
}
```

In `buildDecisionPrompt(topic, turns, followupBlock)`: insert `followupBlock` between the three existing action bullets and "Return JSON only" (i.e. append to `DECISION_SYSTEM_PROMPT` body). In `decideLlm(llm, topic, turns, followupBlock)` pass it through. In `handleConversationReply`, compute:

```ts
const followupBlock = deps.fileFollowup ? buildFollowupPromptBlock(deps.userAliases) : "";
```

and pass to `decideLlm`.

3e. Handle the new decision after the `escalate` branch:

```ts
} else if (decision.action === "file_followup") {
  const reply = deps.channelResolver
    ? await deps.channelResolver.enrichText(decision.reply_text)
    : decision.reply_text;
  await deps.postMessage(event.channel, reply);
  deps.store.appendTurn(conversation.id, {
    sender: "jr",
    text: decision.reply_text,
    ts: Date.now(),
  });
  deps.store.close(conversation.id, "closed", decision.takeaway);
  if (deps.fileFollowup) {
    await deps.fileFollowup({
      kind: decision.kind,
      payload: decision.payload,
      source: "conversation",
      sourceRef: String(conversation.id),
      requesterUserId: event.user,
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/sentinel/conversation-handler.test.ts` — Expected: PASS (all existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/sentinel/conversation-handler.ts tests/sentinel/conversation-handler.test.ts
git commit -m "feat(sentinel): file_followup decision + honesty rule in conversation handler"
```

---

### Task 5: chat-v2 follow-up filing (reasoner → file → responder)

**Files:**

- Modify: `src/triage/chat/reasoner.ts`
- Modify: `src/triage/chat/responder.ts`
- Modify: `src/triage/chat/index.ts`
- Test: `tests/triage/chat-followups.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `tests/triage/chat-followups.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { handleChatMessage } from "../../src/triage/chat/index.js";
import { Reasoner } from "../../src/triage/chat/reasoner.js";
import type { LlmClient } from "../../src/triage/llm-client.js";

describe("chat-v2 follow-up filing", () => {
  it("reasoner parses optional followups array", async () => {
    const llm: LlmClient = {
      complete: vi.fn().mockResolvedValue(
        JSON.stringify({
          findings: "user wants ridge asked",
          confidence: 0.9,
          followups: [
            {
              kind: "dm_person",
              payload: { target_alias: "ridge", topic: "t", question_text: "q" },
            },
          ],
        }),
      ),
    };
    const out = await new Reasoner(llm).reason({
      userMessage: "ask ridge about t",
      followups: { enabled: true, knownAliases: ["ridge", "kaleb"] },
    });
    expect(out.followups).toHaveLength(1);
    expect(out.followups![0].kind).toBe("dm_person");
  });

  it("reasoner prompt includes followup instructions only when enabled", async () => {
    const complete = vi.fn().mockResolvedValue(JSON.stringify({ findings: "f", confidence: 0.5 }));
    const llm: LlmClient = { complete };
    await new Reasoner(llm).reason({
      userMessage: "hi",
      followups: { enabled: true, knownAliases: ["ridge"] },
    });
    expect(complete.mock.calls[0][0]).toContain("followups");
    expect(complete.mock.calls[0][0]).toContain("ridge");
    complete.mockClear();
    await new Reasoner(llm).reason({ userMessage: "hi" });
    expect(complete.mock.calls[0][0]).not.toContain('"followups"');
  });

  it("handleChatMessage files followups before responding and tells the responder", async () => {
    const calls: string[] = [];
    const llm: LlmClient = {
      complete: vi.fn().mockImplementation((prompt: string) => {
        if (prompt.includes("private reasoner")) {
          calls.push("reasoner");
          return Promise.resolve(
            JSON.stringify({
              findings: "wants ridge asked",
              confidence: 0.9,
              followups: [
                {
                  kind: "dm_person",
                  payload: { target_alias: "ridge", topic: "t", question_text: "q" },
                },
              ],
            }),
          );
        }
        calls.push("responder");
        expect(prompt).toContain("queued a DM to ridge");
        return Promise.resolve(JSON.stringify({ reply: "Queued a message to Ridge." }));
      }),
    };
    const fileFollowup = vi.fn().mockImplementation(() => {
      calls.push("file");
      return Promise.resolve("queued a DM to ridge about t");
    });
    const slackPost = vi.fn().mockResolvedValue(undefined);
    await handleChatMessage(
      { userMessage: "ask ridge about t", channel: "D1", isDm: true, requesterUserId: "U_K" },
      { llm, slackPost, fileFollowup, followupAliases: ["ridge"] },
    );
    expect(calls).toEqual(["reasoner", "file", "responder"]);
    expect(fileFollowup).toHaveBeenCalledWith({
      kind: "dm_person",
      payload: { target_alias: "ridge", topic: "t", question_text: "q" },
    });
    expect(slackPost).toHaveBeenCalledWith({
      channel: "D1",
      thread_ts: undefined,
      text: "Queued a message to Ridge.",
    });
  });

  it("filing failure → responder told nothing was queued", async () => {
    const llm: LlmClient = {
      complete: vi.fn().mockImplementation((prompt: string) => {
        if (prompt.includes("private reasoner")) {
          return Promise.resolve(
            JSON.stringify({
              findings: "f",
              confidence: 0.9,
              followups: [{ kind: "note", payload: { text: "x" } }],
            }),
          );
        }
        expect(prompt).toContain("NOTHING was queued");
        return Promise.resolve(JSON.stringify({ reply: "Couldn't queue that." }));
      }),
    };
    const fileFollowup = vi.fn().mockResolvedValue(null);
    const slackPost = vi.fn().mockResolvedValue(undefined);
    await handleChatMessage(
      { userMessage: "remember x", channel: "D1", isDm: true, requesterUserId: "U_K" },
      { llm, slackPost, fileFollowup, followupAliases: [] },
    );
    expect(slackPost).toHaveBeenCalled();
  });

  it("no fileFollowup dep → reasoner not asked for followups, nothing filed", async () => {
    const complete = vi.fn().mockImplementation((prompt: string) => {
      if (prompt.includes("private reasoner")) {
        expect(prompt).not.toContain('"followups"');
        return Promise.resolve(JSON.stringify({ findings: "f", confidence: 0.5 }));
      }
      return Promise.resolve(JSON.stringify({ reply: "hi" }));
    });
    const slackPost = vi.fn().mockResolvedValue(undefined);
    await handleChatMessage(
      { userMessage: "hi", channel: "D1", isDm: true },
      { llm: { complete }, slackPost },
    );
    expect(slackPost).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/triage/chat-followups.test.ts`
Expected: FAIL — `followups` input/output not supported.

- [ ] **Step 3: Implement reasoner changes**

In `src/triage/chat/reasoner.ts`, replace the schema and class:

````ts
import { z } from "zod";
import type { LlmClient } from "../llm-client.js";

const FollowupItemSchema = z.object({
  kind: z.enum(["dm_person", "note", "task"]),
  payload: z.record(z.string(), z.unknown()),
});
export type ReasonerFollowup = z.infer<typeof FollowupItemSchema>;

const ReasonerOutputSchema = z.object({
  findings: z.string(),
  confidence: z.number().min(0).max(1),
  followups: z.array(FollowupItemSchema).optional(),
});
export type ReasonerOutput = z.infer<typeof ReasonerOutputSchema>;

const SYSTEM_PROMPT = `You are JR's private reasoner. You think about what the user is asking and what JR should say back, but YOUR output is never shown to the user.

Given a user message in JR's Slack DM or channel mention, produce a JSON analysis:
{ "findings": "brief paragraph of what the user means and what an ideal response should cover", "confidence": 0-1 }

Be terse. The responder will read your findings and produce the actual reply.

Return JSON only, no markdown fences.`;

function buildFollowupBlock(knownAliases: string[]): string {
  const aliasList = knownAliases.join(", ") || "(none)";
  return `

FOLLOW-UPS: If the user asks JR to do something later — message another person ("ask Ridge about X"), look into something and report back, or perform a task — add a "followups" array to your JSON:
"followups": [ { "kind": "dm_person"|"note"|"task", "payload": {...} } ]
Payload shapes:
- dm_person: {"target_alias":"<one of: ${aliasList}>","topic":"...","question_text":"<the question to DM them>","context":"<one-line handoff>"}
- note: {"text":"<what to surface in JR's daily report>"}
- task: {"task_text":"<the task in plain words>","context":"<brief background>"}
For dm_person the target_alias MUST be one of: ${aliasList} — if the named person is not listed, use kind "note" instead.
Only file follow-ups the user actually asked for. Omit the array when there are none.

HONESTY RULE: JR must never promise future actions without a filed follow-up. If the user asks for one, file it.`;
}

export class Reasoner {
  constructor(private llm: LlmClient) {}

  async reason(input: {
    userMessage: string;
    recentThread?: string[];
    followups?: { enabled: boolean; knownAliases: string[] };
  }): Promise<ReasonerOutput> {
    const threadContext = (input.recentThread ?? [])
      .slice(-5)
      .map((t, i) => `[turn ${i + 1}] ${t}`)
      .join("\n");
    const followupBlock = input.followups?.enabled
      ? buildFollowupBlock(input.followups.knownAliases)
      : "";
    const prompt = `${SYSTEM_PROMPT}${followupBlock}\n\nRecent thread:\n${threadContext || "(none)"}\n\nUser message: ${JSON.stringify(input.userMessage)}\n\nJSON:`;
    let raw: string;
    try {
      raw = await this.llm.complete(prompt, { model: "gemini-pro", temperature: 0 });
    } catch {
      return {
        findings: "(reasoner unavailable; responder should give a brief honest reply)",
        confidence: 0,
      };
    }
    try {
      const stripped = raw.trim().replace(/^```(?:json)?\n?|\n?```$/g, "");
      return ReasonerOutputSchema.parse(JSON.parse(stripped));
    } catch {
      return { findings: "(reasoner output unparseable)", confidence: 0 };
    }
  }
}
````

- [ ] **Step 4: Implement responder changes**

In `src/triage/chat/responder.ts`, change `respond`'s input and prompt. New signature:

```ts
async respond(input: {
  userMessage: string;
  findings: string;
  persona: string;
  queuedActions?: string[];
  failedToQueue?: boolean;
}): Promise<string> {
```

Insert immediately after the `Findings: ${input.findings}` line in the prompt template:

```ts
const queuedBlock =
  input.queuedActions && input.queuedActions.length > 0
    ? `\nFollow-ups ALREADY QUEUED on the user's behalf (mention them accurately — they WILL happen):\n${input.queuedActions.map((a) => `- ${a}`).join("\n")}\n`
    : input.failedToQueue
      ? `\nIMPORTANT: the user asked for a follow-up but NOTHING was queued (filing failed). Say so honestly — do NOT claim anything was queued or promise future action.\n`
      : "";
```

and interpolate `${queuedBlock}` into the prompt right after the Findings line. Also add to the OUTPUT FORMAT rules list:

```
- Never promise future actions beyond the queued follow-ups listed above.
```

- [ ] **Step 5: Implement chat index wiring**

In `src/triage/chat/index.ts`, replace `ChatHandlerDeps` and `handleChatMessage`:

```ts
export interface ChatHandlerDeps {
  llm: LlmClient;
  slackPost: (params: { channel: string; thread_ts?: string; text: string }) => Promise<void>;
  // Files one follow-up; resolves to a short human description ("queued a DM to ridge
  // about X") or null when filing failed. Presence of this dep enables follow-ups.
  fileFollowup?: (f: {
    kind: "dm_person" | "note" | "task";
    payload: Record<string, unknown>;
  }) => Promise<string | null>;
  followupAliases?: string[];
}

export async function handleChatMessage(
  input: {
    userMessage: string;
    channel: string;
    threadTs?: string;
    isDm: boolean;
    recentThread?: string[];
    requesterUserId?: string;
  },
  deps: ChatHandlerDeps,
): Promise<void> {
  const reasoner = new Reasoner(deps.llm);
  const responder = new Responder(deps.llm);

  const followupsEnabled = deps.fileFollowup !== undefined;
  const reasoned = await reasoner.reason({
    userMessage: input.userMessage,
    recentThread: input.recentThread,
    followups: followupsEnabled
      ? { enabled: true, knownAliases: deps.followupAliases ?? [] }
      : undefined,
  });

  const queuedActions: string[] = [];
  let failedToQueue = false;
  if (followupsEnabled && reasoned.followups && reasoned.followups.length > 0) {
    for (const f of reasoned.followups) {
      try {
        const description = await deps.fileFollowup!({ kind: f.kind, payload: f.payload });
        if (description) {
          queuedActions.push(description);
        } else {
          failedToQueue = true;
        }
      } catch {
        failedToQueue = true;
      }
    }
  }

  const reply = await responder.respond({
    userMessage: input.userMessage,
    findings: reasoned.findings,
    persona: loadPersona(),
    queuedActions,
    failedToQueue,
  });

  await deps.slackPost({
    channel: input.channel,
    thread_ts: input.isDm ? undefined : input.threadTs,
    text: reply,
  });
}
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/triage/chat-followups.test.ts tests/triage` — Expected: all PASS (new file 5/5, no regressions in existing chat tests).

- [ ] **Step 7: Commit**

```bash
git add src/triage/chat/reasoner.ts src/triage/chat/responder.ts src/triage/chat/index.ts tests/triage/chat-followups.test.ts
git commit -m "feat(chat): reasoner files follow-ups; responder only claims what was queued"
```

---

### Task 6: Daily report "Follow-ups" section

**Files:**

- Modify: `src/sentinel/reporter.ts`
- Test: `tests/sentinel/reporter.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/sentinel/reporter.test.ts` (reuse existing fixtures — db, libPath, Reporter construction):

```ts
it("daily summary includes a Follow-ups section when followups exist today", async () => {
  db.prepare(
    `INSERT INTO followups (kind, payload, status, source, created_at)
     VALUES ('note', '{"text":"check forecast sync"}', 'done', 'chat', ?)`,
  ).run(Date.now());
  db.prepare(
    `INSERT INTO followups (kind, payload, status, source, last_error, created_at)
     VALUES ('dm_person', '{"target_alias":"priya","topic":"t","question_text":"q"}', 'skipped', 'conversation', 'unknown alias: priya', ?)`,
  ).run(Date.now());
  const result = await reporter.writeDailySummary();
  const content = readFileSync(join(libPath, result.filedTo), "utf-8");
  expect(content).toContain("## Follow-ups (2)");
  expect(content).toContain("check forecast sync");
  expect(content).toContain("skipped");
  expect(content).toContain("unknown alias: priya");
});

it("daily summary omits Follow-ups section when none exist", async () => {
  const result = await reporter.writeDailySummary();
  const content = readFileSync(join(libPath, result.filedTo), "utf-8");
  expect(content).not.toContain("## Follow-ups");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/sentinel/reporter.test.ts` — Expected: FAIL on the new tests.

- [ ] **Step 3: Implement**

In `src/sentinel/reporter.ts` `writeDailySummary()`, after the observations push block (after line ~94, before the `relPath` line), add:

```ts
const followups = this.deps.db
  .prepare(
    `SELECT kind, payload, status, last_error FROM followups
     WHERE created_at >= ? AND created_at < ? ORDER BY created_at ASC`,
  )
  .all(startOfDay, endOfDay) as Array<{
  kind: string;
  payload: string;
  status: string;
  last_error: string | null;
}>;

if (followups.length > 0) {
  lines.push(`## Follow-ups (${followups.length})`, "");
  for (const f of followups) {
    let desc = f.payload;
    try {
      const p = JSON.parse(f.payload) as Record<string, unknown>;
      desc = String(p.text ?? p.question_text ?? p.task_text ?? f.payload);
    } catch {
      // keep raw payload
    }
    const errSuffix = f.last_error ? ` — ${f.last_error}` : "";
    lines.push(`- **${f.kind}** [${f.status}]: ${desc}${errSuffix}`);
  }
  lines.push("");
}
```

Note: this section must be OUTSIDE the `if (observations.length === 0 && insights.length === 0)` else-branch — followups should appear even on a quiet day. Place it after that whole if/else block.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/sentinel/reporter.test.ts` — Expected: PASS (all existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/sentinel/reporter.ts tests/sentinel/reporter.test.ts
git commit -m "feat(sentinel): daily report Follow-ups section"
```

---

### Task 7: Live wiring — bridge, triage-bridge refactor, sentinel cycle, provider

No new unit tests in this task (it is glue over already-tested parts); the full suite must stay green and `npm run build` must pass.

**Files:**

- Create: `src/slack/monitor/followup-bridge.ts`
- Modify: `src/slack/monitor/triage-bridge.ts`
- Modify: `src/sentinel/index.ts`
- Modify: `src/slack/monitor/provider.ts`

- [ ] **Step 1: Create the followup bridge**

Create `src/slack/monitor/followup-bridge.ts`:

```ts
import { homedir } from "node:os";
import { join } from "node:path";
import { ConversationStore } from "../../sentinel/conversation-store.js";
import { openSentinelDb } from "../../sentinel/db.js";
import { FollowupProcessor, type SpawnTaskInput } from "../../sentinel/followup-processor.js";
import { FollowupStore, type InsertFollowupParams } from "../../sentinel/followup-store.js";
import { ChannelNameResolver } from "../../sentinel/slack-resolvers.js";
import { SLACK_USER_ALIASES } from "../../triage/actions/slack/aliases.js";
import { spawnFollowupTask } from "./triage-bridge.js";
import type { SlackMonitorContext } from "./context.js";

export function followupsEnabled(): boolean {
  return process.env.OPENCLAW_FOLLOWUPS === "1";
}

interface FollowupEngine {
  store: FollowupStore;
  processor: FollowupProcessor;
}

// Lazy singleton — only initialize when a follow-up actually gets filed.
let lazyEngine: FollowupEngine | null = null;

export function getFollowupEngine(ctx: SlackMonitorContext): FollowupEngine {
  if (!lazyEngine) {
    const db = openSentinelDb(join(homedir(), ".openclaw/sentinel.db"));
    const store = new FollowupStore(db);
    const conversationStore = new ConversationStore(db);
    const channelResolver = new ChannelNameResolver(
      ctx.app.client as ConstructorParameters<typeof ChannelNameResolver>[0],
    );
    const processor = new FollowupProcessor({
      store,
      db,
      conversationStore,
      userAliases: SLACK_USER_ALIASES,
      dmUser: async (userId: string, text: string) => {
        await ctx.app.client.chat.postMessage({ token: ctx.botToken, channel: userId, text });
      },
      channelResolver,
      spawnTask: (input: SpawnTaskInput) => spawnFollowupTask(input, ctx),
    });
    lazyEngine = { store, processor };
  }
  return lazyEngine;
}

// Files a follow-up and triggers immediate processing. Returns a short human
// description for the responder, or null on failure (caller must stay honest).
export async function fileAndProcessFollowup(
  ctx: SlackMonitorContext,
  params: InsertFollowupParams,
): Promise<string | null> {
  try {
    const { store, processor } = getFollowupEngine(ctx);
    const id = store.insert(params);
    await processor.processPending();
    const row = store.get(id);
    if (!row || row.status === "skipped" || row.status === "failed") {
      return null;
    }
    return describeFollowup(params);
  } catch (err) {
    ctx.runtime.log(`[followups] filing failed: ${String(err)}`);
    return null;
  }
}

function describeFollowup(params: InsertFollowupParams): string {
  if (params.kind === "dm_person") {
    const alias = String(params.payload.target_alias ?? "?");
    const topic = String(params.payload.topic ?? "?");
    return `queued a DM to ${alias} about ${topic}`;
  }
  if (params.kind === "note") {
    return `noted for the daily report: ${String(params.payload.text ?? "?")}`;
  }
  return `queued a task — the requester will get a plan to approve: ${String(params.payload.task_text ?? "?")}`;
}
```

(If `ctx.runtime.log` is not optional-safe, match the call style used in triage-bridge. Verify the `ChannelNameResolver` constructor parameter type — if the cast above fights oxlint/tsc, type it the same way `provider.ts:290` does.)

- [ ] **Step 2: Add `spawnFollowupTask` to triage-bridge and DRY the chat fallback**

In `src/slack/monitor/triage-bridge.ts`:

2a. Extract the thrice-duplicated chat-v2 block into one helper and route through the followup bridge (import `fileAndProcessFollowup`, `followupsEnabled` from `./followup-bridge.js`; import `SpawnTaskInput` type from `../../sentinel/followup-processor.js`):

```ts
async function routeToChat(event: SlackMessageEvent, ctx: SlackMonitorContext): Promise<void> {
  const isDm = event.channel?.startsWith("D") ?? false;
  await handleChatMessage(
    {
      userMessage: event.text ?? "",
      channel: event.channel,
      threadTs: event.thread_ts ?? event.ts,
      isDm,
      requesterUserId: event.user,
    },
    {
      llm: llmClient,
      slackPost: async (params) => {
        await ctx.app.client.chat.postMessage({
          token: ctx.botToken,
          channel: params.channel,
          thread_ts: params.thread_ts,
          text: params.text,
        });
      },
      ...(followupsEnabled()
        ? {
            fileFollowup: (f: {
              kind: "dm_person" | "note" | "task";
              payload: Record<string, unknown>;
            }) =>
              fileAndProcessFollowup(ctx, {
                kind: f.kind,
                payload: f.payload,
                source: "chat",
                sourceRef: `${event.channel}:${event.ts ?? ""}`,
                requesterUserId: event.user,
              }),
            followupAliases: Object.keys(SLACK_USER_ALIASES),
          }
        : {}),
    },
  );
}
```

Replace all three inline `handleChatMessage(...)` call sites (is_task=false at ~line 124, planner-error at ~line 163, empty-plan at ~line 193) with `await routeToChat(event, ctx);` keeping each branch's existing logging/transitions.

2b. Add `spawnFollowupTask` (export) at the bottom of triage-bridge:

```ts
/**
 * Spawn a triage session for a queued `task` follow-up. Opens a DM with the requester,
 * posts an anchor message, then runs the normal triage pipeline with the anchor ts as
 * the thread root — so plan approval ("yes" in the thread) reuses the existing
 * handleThreadReplyForActiveTriage flow unchanged.
 */
export async function spawnFollowupTask(
  input: SpawnTaskInput,
  ctx: SlackMonitorContext,
): Promise<void> {
  const opened = await ctx.app.client.conversations.open({
    token: ctx.botToken,
    users: input.requesterUserId,
  });
  const channel = (opened as { channel?: { id?: string } }).channel?.id;
  if (!channel) {
    throw new Error(`could not open DM with ${input.requesterUserId}`);
  }
  const introText = `Following up on your earlier request${input.context ? ` (${input.context})` : ""}: *${input.taskText}*\nWorking on a plan — I'll post it in this thread.`;
  const intro = await ctx.app.client.chat.postMessage({
    token: ctx.botToken,
    channel,
    text: introText,
  });
  const syntheticEvent = {
    type: "message",
    channel,
    user: input.requesterUserId,
    text: input.taskText,
    ts: intro.ts ?? String(Date.now() / 1000),
  } as SlackMessageEvent;
  await runTriagePipeline(syntheticEvent, ctx);
}
```

NOTE — import cycle: followup-bridge imports triage-bridge (for `spawnFollowupTask`) and triage-bridge imports followup-bridge (for `fileAndProcessFollowup`). ESM handles this cycle fine because all cross-references happen inside functions at call time, not at module-evaluation time. If oxlint's `import/no-cycle` rule (if enabled) rejects it, break the cycle by moving `spawnFollowupTask` into followup-bridge and exporting `runTriagePipeline` usage via a setter — but try the simple version first.

- [ ] **Step 3: Drain pending follow-ups in the sentinel cycle**

In `src/sentinel/index.ts`:

3a. Imports:

```ts
import { FollowupProcessor, type SpawnTaskInput } from "./followup-processor.js";
import { FollowupStore } from "./followup-store.js";
```

3b. `SentinelDeps` gains:

```ts
spawnTask?: (input: SpawnTaskInput) => Promise<void>;
```

3c. In `createSentinel`, after `const channelResolver = ...` (line ~76):

```ts
const followupStore = new FollowupStore(db);
const followupProcessor = new FollowupProcessor({
  store: followupStore,
  db,
  conversationStore,
  userAliases: SLACK_USER_ALIASES,
  dmUser: deps.dmUser,
  channelResolver,
  spawnTask: deps.spawnTask,
});
```

3d. In `runCycleOnce`, after step 0 (`conversationStore.expireStale(...)`):

```ts
// 0.5 Drain pending follow-ups (collisions from earlier cycles, transient failures)
if (process.env.OPENCLAW_FOLLOWUPS === "1") {
  await followupProcessor.processPending();
}
```

- [ ] **Step 4: Wire provider.ts**

In `src/slack/monitor/provider.ts`:

4a. `conversationReplyDeps` (line ~291) gains followup deps. The deps object is built before `ctx` — check whether `ctx` is already defined at that point (it is used at line 302); if `ctx` exists before line 291, add:

```ts
import { fileAndProcessFollowup, followupsEnabled } from "./followup-bridge.js";
import { SLACK_USER_ALIASES } from "../../triage/actions/slack/aliases.js";
```

```ts
const conversationReplyDeps = {
  store: conversationStore,
  llm: sentinelLlmClient,
  db: sentinelDb,
  postMessage: async (channel: string, text: string) => {
    await app.client.chat.postMessage({ token: botToken, channel, text });
  },
  kalebUserId: "U07KRVD2867",
  channelResolver,
  ...(followupsEnabled()
    ? {
        fileFollowup: async (input: Parameters<typeof fileAndProcessFollowup>[1]) => {
          await fileAndProcessFollowup(ctx, input);
        },
        userAliases: SLACK_USER_ALIASES,
      }
    : {}),
};
```

(If `ctx` is defined AFTER line 291, capture lazily: `fileFollowup: async (input) => { await fileAndProcessFollowup(ctxRef!, input); }` with a `let ctxRef` assigned when ctx is created — or move the deps construction below ctx creation. Check the actual order first. Note the type: conversation-handler's `fileFollowup` returns `Promise<void>` while `fileAndProcessFollowup` returns `Promise<string | null>` — the wrapper above discards the return value.)

4b. `createSentinel` call (line ~435) gains:

```ts
import { spawnFollowupTask } from "./triage-bridge.js";
```

```ts
const sentinel = createSentinel({
  // ...existing deps...
  spawnTask: (input) => spawnFollowupTask(input, ctx),
});
```

- [ ] **Step 5: Full test suite + build**

```bash
npx vitest run
npm run build
```

Expected: all tests pass (192 existing + ~20 new), build clean. Fix any oxlint complaints (curly braces, import sort) before committing.

- [ ] **Step 6: Commit**

```bash
git add src/slack/monitor/followup-bridge.ts src/slack/monitor/triage-bridge.ts src/sentinel/index.ts src/slack/monitor/provider.ts
git commit -m "feat(followups): live wiring — bridge, immediate processing, sentinel drain, task spawning"
```

---

### Task 8: Flag on, restart, live smoke test

- [ ] **Step 1: Enable the flag**

Append to `~/.openclaw/.env`:

```bash
echo 'OPENCLAW_FOLLOWUPS=1' >> ~/.openclaw/.env
```

- [ ] **Step 2: Restart JR**

```bash
launchctl kickstart -k gui/$(id -u)/com.openclaw.agent
sleep 8 && tail -30 ~/.openclaw/logs/gateway.log
```

Expected: gateway up, "slack socket mode connected", no crash. (Log path: use whatever path previous restarts in this repo used — check `~/openclaw-run.sh` if unsure.)

- [ ] **Step 3: Live smoke (requires Kaleb)**

Ask Kaleb to DM JR: "Can you ask Ridge what the latest is on the commission forecast?" Expected:

1. JR replies claiming a queued DM (not a bare promise).
2. Ridge receives a DM referencing the handoff.
3. `sqlite3 ~/.openclaw/sentinel.db "SELECT id,kind,status FROM followups ORDER BY id DESC LIMIT 3;"` shows a `dm_person` row with status `done`.

- [ ] **Step 4: Report results to Kaleb and stop**

---

## Self-Review (completed)

- **Spec coverage:** schema (T1), store (T2), processor incl. all three kinds + collision/skip/retry (T3), conversation surface + honesty (T4), chat surface + honesty + filing-failure path (T5), daily report (T6), wiring + immediate processing + cycle drain + task spawning + flag gating (T7), live verification (T8). Ridge regression test in T4. ✓
- **Placeholder scan:** none. ✓
- **Type consistency:** `FollowupKind`/`FollowupSource`/`InsertFollowupParams`/`SpawnTaskInput` defined in T2/T3 and imported consistently in T4/T5/T7; conversation-handler `fileFollowup` returns `void`, chat `fileFollowup` returns `string | null` (different surfaces, both wired in T7 accordingly). ✓
