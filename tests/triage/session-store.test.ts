import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openTriageDb } from "../../src/triage/db.js";
import { SessionStore } from "../../src/triage/session-store.js";

const TEST_DB = join(tmpdir(), `triage-store-test-${Date.now()}.db`);

describe("SessionStore", () => {
  let store: SessionStore;

  beforeEach(() => {
    const db = openTriageDb(TEST_DB);
    store = new SessionStore(db);
  });

  afterEach(() => {
    if (existsSync(TEST_DB)) {
      unlinkSync(TEST_DB);
    }
  });

  it("creates a new session with PENDING_CLASSIFY state", () => {
    const session = store.create({
      channel: "C123",
      thread_ts: "T456",
      requester_user_id: "U789",
      requester_message: "do the thing",
    });
    expect(session.request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(session.state).toBe("PENDING_CLASSIFY");
    expect(session.plan_history).toEqual([]);
  });

  it("retrieves a session by request_id", () => {
    const created = store.create({
      channel: "C123",
      thread_ts: "T456",
      requester_user_id: "U789",
      requester_message: "do the thing",
    });
    const fetched = store.get(created.request_id);
    expect(fetched?.requester_message).toBe("do the thing");
  });

  it("updates a session state with valid transition", () => {
    const s = store.create({
      channel: "C",
      thread_ts: "T",
      requester_user_id: "U",
      requester_message: "msg",
    });
    store.transition(s.request_id, "CLASSIFIED");
    const updated = store.get(s.request_id);
    expect(updated?.state).toBe("CLASSIFIED");
  });

  it("rejects an invalid state transition", () => {
    const s = store.create({
      channel: "C",
      thread_ts: "T",
      requester_user_id: "U",
      requester_message: "msg",
    });
    expect(() => store.transition(s.request_id, "EXECUTING")).toThrow(
      /invalid transition: PENDING_CLASSIFY → EXECUTING/,
    );
  });

  it("finds active session by channel+thread", () => {
    const s = store.create({
      channel: "C1",
      thread_ts: "T1",
      requester_user_id: "U",
      requester_message: "msg",
    });
    const active = store.findActive("C1", "T1");
    expect(active?.request_id).toBe(s.request_id);
  });

  it("returns null for findActive when only terminal sessions exist", () => {
    const s = store.create({
      channel: "C2",
      thread_ts: "T2",
      requester_user_id: "U",
      requester_message: "msg",
    });
    store.transition(s.request_id, "CLASSIFIED");
    store.transition(s.request_id, "CANCELLED");
    expect(store.findActive("C2", "T2")).toBeNull();
  });

  // ── F2: expireStale ──────────────────────────────────────────────────────

  it("expireStale returns 0 when no sessions are stale", () => {
    store.create({
      channel: "C",
      thread_ts: "T",
      requester_user_id: "U",
      requester_message: "fresh",
    });
    // maxIdleMs = 1ms but updated_at is just now, so nothing should expire
    // Use a 10-year window to guarantee nothing is stale
    const count = store.expireStale(10 * 365 * 24 * 60 * 60 * 1000);
    expect(count).toBe(0);
  });

  it("expireStale transitions a stale non-terminal session to ABANDONED", () => {
    const s = store.create({
      channel: "C3",
      thread_ts: "T3",
      requester_user_id: "U",
      requester_message: "stuck",
    });
    store.transition(s.request_id, "CLASSIFIED");
    store.transition(s.request_id, "PLANNING");

    // Backdate updated_at by 31 minutes to simulate a stuck PLANNING session
    const db = openTriageDb(TEST_DB);
    const staleTs = Date.now() - 31 * 60 * 1000;
    db.prepare("UPDATE triage_sessions SET updated_at = ? WHERE request_id = ?").run(
      staleTs,
      s.request_id,
    );

    const count = store.expireStale(30 * 60 * 1000);
    expect(count).toBe(1);

    const updated = store.get(s.request_id);
    expect(updated?.state).toBe("ABANDONED");
  });

  it("expireStale does not touch terminal sessions (COMPLETE, CANCELLED, ABANDONED, FAILED_AT_STEP)", () => {
    const sessions = [
      store.create({
        channel: "C",
        thread_ts: "t1",
        requester_user_id: "U",
        requester_message: "a",
      }),
      store.create({
        channel: "C",
        thread_ts: "t2",
        requester_user_id: "U",
        requester_message: "b",
      }),
      store.create({
        channel: "C",
        thread_ts: "t3",
        requester_user_id: "U",
        requester_message: "c",
      }),
    ];
    // Bring each to a terminal state
    store.transition(sessions[0].request_id, "CLASSIFIED");
    store.transition(sessions[0].request_id, "PLANNING");
    store.transition(sessions[0].request_id, "AWAITING_APPROVAL");
    store.transition(sessions[0].request_id, "EXECUTING");
    store.transition(sessions[0].request_id, "COMPLETE");

    store.transition(sessions[1].request_id, "CANCELLED");

    store.transition(sessions[2].request_id, "CLASSIFIED");
    store.transition(sessions[2].request_id, "PLANNING");
    store.transition(sessions[2].request_id, "AWAITING_APPROVAL");
    store.transition(sessions[2].request_id, "EXECUTING");
    store.transition(sessions[2].request_id, "FAILED_AT_STEP");

    // Backdate all three
    const db = openTriageDb(TEST_DB);
    const staleTs = Date.now() - 31 * 60 * 1000;
    for (const s of sessions) {
      db.prepare("UPDATE triage_sessions SET updated_at = ? WHERE request_id = ?").run(
        staleTs,
        s.request_id,
      );
    }

    const count = store.expireStale(30 * 60 * 1000);
    expect(count).toBe(0);

    // States must be unchanged
    expect(store.get(sessions[0].request_id)?.state).toBe("COMPLETE");
    expect(store.get(sessions[1].request_id)?.state).toBe("CANCELLED");
    expect(store.get(sessions[2].request_id)?.state).toBe("FAILED_AT_STEP");
  });

  it("expireStale expires multiple stale sessions in a single call", () => {
    const s1 = store.create({
      channel: "C",
      thread_ts: "tx1",
      requester_user_id: "U",
      requester_message: "x",
    });
    const s2 = store.create({
      channel: "C",
      thread_ts: "tx2",
      requester_user_id: "U",
      requester_message: "y",
    });
    store.transition(s1.request_id, "CLASSIFIED");
    store.transition(s1.request_id, "PLANNING");
    store.transition(s2.request_id, "CLASSIFIED");
    store.transition(s2.request_id, "PLANNING");
    store.transition(s2.request_id, "AWAITING_APPROVAL");

    const db = openTriageDb(TEST_DB);
    const staleTs = Date.now() - 31 * 60 * 1000;
    db.prepare("UPDATE triage_sessions SET updated_at = ?").run(staleTs);

    const count = store.expireStale(30 * 60 * 1000);
    expect(count).toBe(2);
    expect(store.get(s1.request_id)?.state).toBe("ABANDONED");
    expect(store.get(s2.request_id)?.state).toBe("ABANDONED");
  });
});
