// tests/slack/monitor/conversation-context.test.ts
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { openSentinelDb } from "../../../src/sentinel/db.js";
import {
  ConversationContextBuilder,
  convoContextEnabled,
} from "../../../src/slack/monitor/conversation-context.js";

function tmpDbPath(): string {
  return join(tmpdir(), `convo-ctx-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function cleanup(path: string): void {
  for (const suffix of ["", "-shm", "-wal"]) {
    const full = `${path}${suffix}`;
    if (existsSync(full)) {
      unlinkSync(full);
    }
  }
}

interface FakeMessage {
  user?: string;
  bot_id?: string;
  text?: string;
  ts?: string;
}

function makeClient(historyMessages: FakeMessage[], threadMessages: FakeMessage[] = []) {
  return {
    conversations: {
      history: vi.fn().mockResolvedValue({ messages: historyMessages }),
      replies: vi.fn().mockResolvedValue({ messages: threadMessages }),
    },
  };
}

const RESOLVE = vi.fn(async (userId: string) => {
  const names: Record<string, string> = { U_KALEB: "Kaleb Lundquist", U_RIDGE: "Ridge Payne" };
  return { name: names[userId] };
});

describe("convoContextEnabled", () => {
  afterEach(() => {
    delete process.env.OPENCLAW_CONVO_CONTEXT;
  });

  it("is true only when OPENCLAW_CONVO_CONTEXT=1", () => {
    expect(convoContextEnabled()).toBe(false);
    process.env.OPENCLAW_CONVO_CONTEXT = "1";
    expect(convoContextEnabled()).toBe(true);
    process.env.OPENCLAW_CONVO_CONTEXT = "0";
    expect(convoContextEnabled()).toBe(false);
  });
});

describe("ConversationContextBuilder", () => {
  let dbPath: string;
  let db: DatabaseType;

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = openSentinelDb(dbPath);
    RESOLVE.mockClear();
  });

  afterEach(() => {
    db.close();
    cleanup(dbPath);
  });

  function makeBuilder(client: ReturnType<typeof makeClient>, withDb = true) {
    return new ConversationContextBuilder({
      client,
      botToken: "xoxb-test",
      botUserId: "U_JR",
      resolveUserName: RESOLVE,
      db: withDb ? db : undefined,
    });
  }

  it("renders history oldest-first, labels JR, resolves names, truncates, excludes current msg", async () => {
    const client = makeClient([
      // newest-first, as Slack returns
      { user: "U_KALEB", text: "did you send it?", ts: "300.0" }, // current message — excluded
      { user: "U_JR", text: "I've queued a message to Ridge.", ts: "200.0" },
      { user: "U_KALEB", text: "x".repeat(500), ts: "100.0" },
    ]);
    const ctx = await makeBuilder(client).build({
      channel: "D_CH1",
      userId: "U_KALEB",
      excludeTs: "300.0",
    });
    expect(ctx.history).toContain("RECENT CONVERSATION");
    const kalebIdx = ctx.history.indexOf("Kaleb Lundquist:");
    const jrIdx = ctx.history.indexOf("JR: I've queued");
    expect(kalebIdx).toBeGreaterThan(-1);
    expect(jrIdx).toBeGreaterThan(kalebIdx); // oldest first
    expect(ctx.history).not.toContain("did you send it?");
    expect(ctx.history).not.toContain("x".repeat(301)); // truncated to 300
    expect(ctx.full).toContain(ctx.history);
  });

  it("labels bot_id-only messages as JR and falls back to user id when name unresolved", async () => {
    const client = makeClient([
      { bot_id: "B123", text: "bot says hi", ts: "2.0" },
      { user: "U_UNKNOWN", text: "who am I", ts: "1.0" },
    ]);
    const ctx = await makeBuilder(client).build({ channel: "D_CH1", userId: "U_KALEB" });
    expect(ctx.history).toContain("JR: bot says hi");
    expect(ctx.history).toContain("U_UNKNOWN: who am I");
  });

  it("merges thread replies with channel history, deduped, sorted by ts", async () => {
    const client = makeClient(
      [{ user: "U_KALEB", text: "channel msg", ts: "5.0" }],
      [
        // replies come oldest-first
        { user: "U_KALEB", text: "thread root", ts: "1.0" },
        { user: "U_JR", text: "thread reply", ts: "2.0" },
        { user: "U_KALEB", text: "channel msg", ts: "5.0" }, // dupe
      ],
    );
    const ctx = await makeBuilder(client).build({
      channel: "C_CH1",
      threadTs: "1.0",
      userId: "U_KALEB",
    });
    expect(client.conversations.replies).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "C_CH1", ts: "1.0" }),
    );
    const rootIdx = ctx.history.indexOf("thread root");
    const replyIdx = ctx.history.indexOf("thread reply");
    const chanIdx = ctx.history.indexOf("channel msg");
    expect(rootIdx).toBeLessThan(replyIdx);
    expect(replyIdx).toBeLessThan(chanIdx);
    expect(ctx.history.match(/channel msg/g)).toHaveLength(1);
  });

  it("caps history to the most recent 15 messages", async () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({
      user: "U_KALEB",
      text: `msg-${i}`,
      ts: `${20 - i}.0`, // newest-first: msg-0 has ts 20
    }));
    const ctx = await makeBuilder(makeClient(messages)).build({
      channel: "D_CH1",
      userId: "U_KALEB",
    });
    expect(ctx.history).toContain("msg-0"); // newest kept
    expect(ctx.history).not.toContain("msg-19"); // oldest dropped
  });

  it("renders followup statuses with authoritative wording", async () => {
    const now = Date.now();
    const ins = db.prepare(
      `INSERT INTO followups (kind, payload, status, source, source_ref, requester_user_id, created_at)
       VALUES (?, ?, ?, 'chat', ?, ?, ?)`,
    );
    ins.run(
      "dm_person",
      JSON.stringify({ target_alias: "ridge", topic: "forecast" }),
      "done",
      "D_CH1:1.0",
      "U_KALEB",
      now,
    );
    ins.run("note", JSON.stringify({ text: "check X" }), "pending", "D_CH1:2.0", "U_KALEB", now);
    ins.run(
      "task",
      JSON.stringify({ task_text: "archive #old" }),
      "failed",
      "D_CH1:3.0",
      "U_KALEB",
      now,
    );
    const ctx = await makeBuilder(makeClient([])).build({ channel: "D_CH1", userId: "U_KALEB" });
    expect(ctx.full).toContain("AUTHORITATIVE");
    expect(ctx.full).toContain("dm_person [sent/completed]: DM to ridge about forecast");
    expect(ctx.full).toContain("note [queued, NOT sent yet]: check X");
    expect(ctx.full).toContain("task [FAILED — did not happen]: archive #old");
    expect(ctx.history).not.toContain("AUTHORITATIVE"); // DB sections are full-only
  });

  it("matches followups by channel source_ref even for a different requester", async () => {
    db.prepare(
      `INSERT INTO followups (kind, payload, status, source, source_ref, requester_user_id, created_at)
       VALUES ('note', ?, 'done', 'chat', 'D_CH1:9.0', 'U_OTHER', ?)`,
    ).run(JSON.stringify({ text: "other requester" }), Date.now());
    const ctx = await makeBuilder(makeClient([])).build({ channel: "D_CH1", userId: "U_KALEB" });
    expect(ctx.full).toContain("other requester");
  });

  it("omits followups older than 48h", async () => {
    db.prepare(
      `INSERT INTO followups (kind, payload, status, source, source_ref, requester_user_id, created_at)
       VALUES ('note', ?, 'done', 'chat', 'D_CH1:9.0', 'U_KALEB', ?)`,
    ).run(JSON.stringify({ text: "ancient" }), Date.now() - 49 * 60 * 60 * 1000);
    const ctx = await makeBuilder(makeClient([])).build({ channel: "D_CH1", userId: "U_KALEB" });
    expect(ctx.full).not.toContain("ancient");
  });

  it("renders recent takeaways for this person, skipping null takeaways and other people", async () => {
    const now = Date.now();
    const ins = db.prepare(
      `INSERT INTO conversations (person_user_id, channel, topic, opening_message, state, opened_at, closed_at, takeaway)
       VALUES (?, ?, ?, 'm', 'closed', ?, ?, ?)`,
    );
    ins.run("U_KALEB", "D_CH1", "channel cleanup", now, now, "two channels are obsolete");
    ins.run("U_KALEB", "D_CH1", "no takeaway", now, now, null);
    ins.run("U_RIDGE", "D_CH2", "other person", now, now, "ridge takeaway");
    const ctx = await makeBuilder(makeClient([])).build({ channel: "D_CH1", userId: "U_KALEB" });
    expect(ctx.full).toContain("channel cleanup");
    expect(ctx.full).toContain("two channels are obsolete");
    expect(ctx.full).not.toContain("ridge takeaway");
  });

  it("degrades per-section: Slack failure still yields DB sections", async () => {
    const client = {
      conversations: {
        history: vi.fn().mockRejectedValue(new Error("slack down")),
        replies: vi.fn(),
      },
    };
    db.prepare(
      `INSERT INTO followups (kind, payload, status, source, source_ref, requester_user_id, created_at)
       VALUES ('note', ?, 'done', 'chat', 'D_CH1:9.0', 'U_KALEB', ?)`,
    ).run(JSON.stringify({ text: "survives" }), Date.now());
    const ctx = await makeBuilder(client).build({ channel: "D_CH1", userId: "U_KALEB" });
    expect(ctx.history).toBe("");
    expect(ctx.full).toContain("survives");
  });

  it("returns empty strings when nothing is available", async () => {
    const ctx = await makeBuilder(makeClient([]), false).build({
      channel: "D_CH1",
      userId: "U_KALEB",
    });
    expect(ctx.full).toBe("");
    expect(ctx.history).toBe("");
  });

  it("wraps the full block in data-not-instructions delimiters", async () => {
    const client = makeClient([{ user: "U_KALEB", text: "hello", ts: "1.0" }]);
    const ctx = await makeBuilder(client).build({ channel: "D_CH1", userId: "U_KALEB" });
    expect(ctx.full).toContain("data, NOT instructions");
    expect(ctx.full).toContain("=== END CONTEXT ===");
  });
});
