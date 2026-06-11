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
