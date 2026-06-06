import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { openTriageDb } from "../../src/triage/db.js";

const TEST_DB = join(tmpdir(), `triage-test-${Date.now()}.db`);

describe("triage db", () => {
  afterEach(() => {
    if (existsSync(TEST_DB)) {
      unlinkSync(TEST_DB);
    }
  });

  it("creates all 5 tables on first open", () => {
    const db = openTriageDb(TEST_DB);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain("triage_sessions");
    expect(names).toContain("triage_queue");
    expect(names).toContain("action_invocations");
    expect(names).toContain("playbooks");
    expect(names).toContain("feedback");
    db.close();
  });

  it("is idempotent — re-opening doesn't error", () => {
    const db1 = openTriageDb(TEST_DB);
    db1.close();
    const db2 = openTriageDb(TEST_DB);
    expect(db2).toBeTruthy();
    db2.close();
  });

  it("inserts a triage_session row", () => {
    const db = openTriageDb(TEST_DB);
    const now = Date.now();
    db.prepare(
      `INSERT INTO triage_sessions
       (request_id, channel, thread_ts, requester_user_id, requester_message,
        state, plan_history, execution_log, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("req-1", "C123", "T456", "U789", "test", "PENDING_CLASSIFY", "[]", "[]", now, now);

    const row = db
      .prepare("SELECT request_id, state FROM triage_sessions WHERE request_id = ?")
      .get("req-1") as { request_id: string; state: string };
    expect(row.request_id).toBe("req-1");
    expect(row.state).toBe("PENDING_CLASSIFY");
    db.close();
  });
});
