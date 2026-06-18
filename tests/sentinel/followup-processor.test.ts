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

  it("dm_person: missing dmUser dep stays pending without counting an attempt", async () => {
    const noDmProcessor = new FollowupProcessor({
      store,
      db,
      conversationStore,
      userAliases: ALIASES,
      spawnTask,
    });
    const id = store.insert({
      kind: "dm_person",
      payload: { target_alias: "ridge", topic: "t", question_text: "q" },
      source: "conversation",
    });
    await noDmProcessor.processPending();
    expect(store.get(id)!.status).toBe("pending");
    expect(store.get(id)!.attempts).toBe(0);
  });

  it("processById processes only the targeted row", async () => {
    const a = store.insert({ kind: "note", payload: { text: "a" }, source: "chat" });
    const b = store.insert({ kind: "note", payload: { text: "b" }, source: "chat" });
    await processor.processById(b);
    expect(store.get(b)!.status).toBe("done");
    expect(store.get(a)!.status).toBe("pending");
  });

  it("processById records failure on a thrown error", async () => {
    dmUser.mockRejectedValue(new Error("slack down"));
    const id = store.insert({
      kind: "dm_person",
      payload: { target_alias: "ridge", topic: "t", question_text: "q" },
      source: "conversation",
    });
    await processor.processById(id);
    expect(store.get(id)!.attempts).toBe(1);
    expect(store.get(id)!.last_error).toContain("slack down");
  });

  it("concurrent processById and processPending never double-DM the same row", async () => {
    let resolveDm!: () => void;
    dmUser.mockImplementation(() => new Promise<void>((res) => (resolveDm = res)));
    const id = store.insert({
      kind: "dm_person",
      payload: { target_alias: "ridge", topic: "t", question_text: "q" },
      source: "conversation",
    });
    const inFlight = processor.processById(id);
    expect(store.get(id)!.status).toBe("in_flight");
    await processor.processPending();
    expect(dmUser).toHaveBeenCalledTimes(1);
    resolveDm();
    await inFlight;
    expect(store.get(id)!.status).toBe("done");
  });

  it("collision releases the claim so the row stays claimable", async () => {
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
    expect(store.claim(id)).toBe(true);
  });

  it("malformed dm_person payload is skipped, not retried", async () => {
    const id = store.insert({ kind: "dm_person", payload: { nope: true }, source: "chat" });
    await processor.processPending();
    expect(store.get(id)!.status).toBe("skipped");
  });
});
