import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { handleConversationReply } from "../../src/sentinel/conversation-handler.js";
import { ConversationStore } from "../../src/sentinel/conversation-store.js";
import { openSentinelDb } from "../../src/sentinel/db.js";
import type { LlmClient } from "../../src/triage/llm-client.js";

function tmpDbPath(): string {
  return join(tmpdir(), `sentinel-hcr-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function cleanup(path: string): void {
  for (const suffix of ["", "-shm", "-wal"]) {
    const full = `${path}${suffix}`;
    if (existsSync(full)) {
      unlinkSync(full);
    }
  }
}

function makeEvent(
  overrides: Partial<{ user: string; channel: string; text: string; ts: string }> = {},
) {
  return {
    user: "U_ALICE",
    channel: "D_CH1",
    text: "Here is my answer",
    ts: String(Date.now() / 1000),
    ...overrides,
  };
}

const ctx = { botUserId: "U_JR" };

describe("handleConversationReply", () => {
  let dbPath: string;
  let db: DatabaseType;
  let store: ConversationStore;
  let posted: Array<{ channel: string; text: string }>;
  let postMessage: (channel: string, text: string) => Promise<void>;

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = openSentinelDb(dbPath);
    store = new ConversationStore(db);
    posted = [];
    postMessage = vi.fn(async (channel: string, text: string) => {
      posted.push({ channel, text });
    });
  });

  afterEach(() => {
    db.close();
    cleanup(dbPath);
  });

  it("returns false when there is no open conversation for the person", async () => {
    const llm: LlmClient = { complete: vi.fn(async () => "{}") };
    const result = await handleConversationReply(makeEvent({ user: "U_NOBODY" }), ctx, {
      store,
      llm,
      db,
      postMessage,
    });
    expect(result).toBe(false);
    expect(posted).toHaveLength(0);
  });

  it("returns true and calls LLM when there is an active conversation", async () => {
    store.open({
      person_user_id: "U_ALICE",
      channel: "D_CH1",
      topic: "BOM workflow",
      opening_message: "What happens after BOM quote?",
    });

    const completeFn = vi.fn(async () =>
      JSON.stringify({ action: "ask_followup", question: "Do you ever skip projects?" }),
    );
    const llm: LlmClient = { complete: completeFn };

    const result = await handleConversationReply(makeEvent(), ctx, {
      store,
      llm,
      db,
      postMessage,
    });
    expect(result).toBe(true);
    expect(completeFn).toHaveBeenCalledOnce();
  });

  it("ask_followup: posts next question and conversation stays open", async () => {
    store.open({
      person_user_id: "U_ALICE",
      channel: "D_CH1",
      topic: "BOM workflow",
      opening_message: "What happens after BOM quote?",
    });

    const llm: LlmClient = {
      complete: vi.fn(async () =>
        JSON.stringify({ action: "ask_followup", question: "Do you ever skip projects?" }),
      ),
    };

    await handleConversationReply(makeEvent({ text: "We manually trigger the email." }), ctx, {
      store,
      llm,
      db,
      postMessage,
    });

    expect(posted).toHaveLength(1);
    expect(posted[0]?.text).toBe("Do you ever skip projects?");
    expect(posted[0]?.channel).toBe("D_CH1");

    // Conversation must still be open
    const open = store.findOpenForPerson("U_ALICE");
    expect(open?.state).toBe("open");
    // Turns: [jr opening, person reply, jr followup]
    expect(open?.turns).toHaveLength(3);
    expect(open?.turns[2]?.sender).toBe("jr");
    expect(open?.turns[2]?.text).toBe("Do you ever skip projects?");
  });

  it("close_with_thanks: marks conversation closed and stores takeaway", async () => {
    store.open({
      person_user_id: "U_ALICE",
      channel: "D_CH1",
      topic: "BOM workflow",
      opening_message: "What happens after BOM quote?",
    });

    const llm: LlmClient = {
      complete: vi.fn(async () =>
        JSON.stringify({
          action: "close_with_thanks",
          wrapup: "Got it — the BOM trigger is always manual. Thanks!",
        }),
      ),
    };

    await handleConversationReply(makeEvent({ text: "It's always a manual step, yes." }), ctx, {
      store,
      llm,
      db,
      postMessage,
    });

    expect(posted).toHaveLength(1);
    expect(posted[0]?.text).toContain("BOM trigger");

    // Conversation must be closed
    const row = db
      .prepare("SELECT state, takeaway FROM conversations WHERE person_user_id = 'U_ALICE'")
      .get() as { state: string; takeaway: string };
    expect(row.state).toBe("closed");
    expect(row.takeaway).toBe("Got it — the BOM trigger is always manual. Thanks!");

    // findOpenForPerson must return null
    expect(store.findOpenForPerson("U_ALICE")).toBeNull();
  });

  it("escalate: closes conversation, stores summary, DMs Kaleb", async () => {
    store.open({
      person_user_id: "U_ALICE",
      channel: "D_CH1",
      topic: "install delay",
      opening_message: "What's causing the install delay?",
    });

    const llm: LlmClient = {
      complete: vi.fn(async () =>
        JSON.stringify({
          action: "escalate",
          summary: "Critical: permits are stuck and 15 projects are blocked.",
        }),
      ),
    };

    await handleConversationReply(
      makeEvent({ text: "Permits are stuck, 15 projects blocked." }),
      ctx,
      {
        store,
        llm,
        db,
        postMessage,
        kalebUserId: "U_KALEB",
      },
    );

    // Conversation closed
    const row = db
      .prepare("SELECT state, takeaway FROM conversations WHERE person_user_id = 'U_ALICE'")
      .get() as { state: string; takeaway: string };
    expect(row.state).toBe("closed");
    expect(row.takeaway).toContain("permits");

    // Escalation DM sent to Kaleb
    expect(posted).toHaveLength(1);
    expect(posted[0]?.channel).toBe("U_KALEB");
    expect(posted[0]?.text).toContain("install delay");
    expect(posted[0]?.text).toContain("permits");
  });

  it("opt-out detected: inserts opt_out row, marks state=opt-out, posts ack", async () => {
    store.open({
      person_user_id: "U_ALICE",
      channel: "D_CH1",
      topic: "BOM workflow",
      opening_message: "What happens after BOM quote?",
    });

    const completeFn = vi.fn(async () => "{}");
    const llm: LlmClient = { complete: completeFn };

    await handleConversationReply(makeEvent({ text: "Stop asking me, I'm busy." }), ctx, {
      store,
      llm,
      db,
      postMessage,
    });

    // opt_outs row inserted
    const optRow = db
      .prepare("SELECT scope, reason FROM opt_outs WHERE person_user_id = 'U_ALICE'")
      .get() as { scope: string; reason: string };
    expect(optRow).toBeTruthy();
    expect(optRow.scope).toBe("global");
    expect(optRow.reason).toContain("Stop asking");

    // conversation marked opt-out
    const convRow = db
      .prepare("SELECT state FROM conversations WHERE person_user_id = 'U_ALICE'")
      .get() as { state: string };
    expect(convRow.state).toBe("opt-out");

    // ack posted
    expect(posted).toHaveLength(1);
    expect(posted[0]?.text).toContain("stop");

    // LLM must NOT have been called
    expect(completeFn).not.toHaveBeenCalled();
  });

  it("LLM throw: conversation stays open, no crash", async () => {
    store.open({
      person_user_id: "U_ALICE",
      channel: "D_CH1",
      topic: "test",
      opening_message: "Question?",
    });

    const llm: LlmClient = {
      complete: vi.fn(async () => {
        throw new Error("LLM unavailable");
      }),
    };

    // Should not throw
    const result = await handleConversationReply(makeEvent(), ctx, {
      store,
      llm,
      db,
      postMessage,
    });

    expect(result).toBe(true);
    // Conversation still open
    expect(store.findOpenForPerson("U_ALICE")?.state).toBe("open");
    // No message posted
    expect(posted).toHaveLength(0);
  });

  it("LLM returning invalid JSON: conversation stays open, no crash", async () => {
    store.open({
      person_user_id: "U_ALICE",
      channel: "D_CH1",
      topic: "test",
      opening_message: "Question?",
    });

    const llm: LlmClient = {
      complete: vi.fn(async () => "not valid json at all {{"),
    };

    const result = await handleConversationReply(makeEvent(), ctx, {
      store,
      llm,
      db,
      postMessage,
    });

    expect(result).toBe(true);
    expect(store.findOpenForPerson("U_ALICE")?.state).toBe("open");
    expect(posted).toHaveLength(0);
  });
});
