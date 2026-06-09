import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
    if (existsSync(TRIAGE_DB)) {
      unlinkSync(TRIAGE_DB);
    }
    if (existsSync(`${TRIAGE_DB}-shm`)) {
      unlinkSync(`${TRIAGE_DB}-shm`);
    }
    if (existsSync(`${TRIAGE_DB}-wal`)) {
      unlinkSync(`${TRIAGE_DB}-wal`);
    }
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
