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
});
