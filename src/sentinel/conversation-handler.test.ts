import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import type { LlmClient } from "../triage/llm-client.js";
import {
  handleConversationReply,
  type ConversationReplyCtx,
  type ConversationReplyDeps,
} from "./conversation-handler.js";
import { ConversationStore } from "./conversation-store.js";

const USER = "U07KRVD2867";
const CTX: ConversationReplyCtx = { botUserId: "BJR" };
const TWO_HOURS = 2 * 60 * 60 * 1000;

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_user_id TEXT NOT NULL, channel TEXT NOT NULL, thread_ts TEXT,
      topic TEXT NOT NULL, opening_message TEXT NOT NULL, state TEXT NOT NULL,
      turns TEXT, opened_at INTEGER NOT NULL, last_turn_at INTEGER,
      closed_at INTEGER, takeaway TEXT
    );
    CREATE TABLE opt_outs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, person_user_id TEXT NOT NULL,
      scope TEXT NOT NULL, added_at INTEGER NOT NULL, reason TEXT
    );
  `);
  return db;
}

// LLM that fails loudly — the stale and opt-out paths must never call it.
const neverLlm = {
  complete: vi.fn(async () => {
    throw new Error("LLM should not be called on stale/opt-out paths");
  }),
} as unknown as LlmClient;

function makeDeps(db: Database.Database, store: ConversationStore): ConversationReplyDeps {
  return { store, llm: neverLlm, db, postMessage: vi.fn(async () => {}) };
}

function nowTs(): string {
  return String(Date.now() / 1000);
}

/** Insert an open conversation whose only turn (JR's question) is `ageMs` old. */
function insertStaleOpen(db: Database.Database, ageMs: number): number {
  const openedAt = Date.now() - ageMs;
  const turns = JSON.stringify([
    { sender: "jr", text: "Are #jr-time and #vero-management still in use?", ts: openedAt },
  ]);
  const r = db
    .prepare(
      `INSERT INTO conversations
         (person_user_id, channel, topic, opening_message, state, turns, opened_at, last_turn_at)
       VALUES (?, ?, ?, ?, 'open', ?, ?, ?)`,
    )
    .run(
      USER,
      USER,
      "Inactive Slack channels",
      "Are #jr-time still used?",
      turns,
      openedAt,
      openedAt,
    );
  return Number(r.lastInsertRowid);
}

describe("handleConversationReply — staleness vs opt-out", () => {
  it("honors an opt-out even when the conversation has gone stale", async () => {
    const db = makeDb();
    const store = new ConversationStore(db);
    const id = insertStaleOpen(db, TWO_HOURS);
    const deps = makeDeps(db, store);

    const consumed = await handleConversationReply(
      { user: USER, channel: USER, text: "please stop asking me about this", ts: nowTs() },
      CTX,
      deps,
    );

    expect(consumed).toBe(true);
    const optOuts = db.prepare("SELECT * FROM opt_outs WHERE person_user_id = ?").all(USER);
    expect(optOuts).toHaveLength(1);
    const conv = db.prepare("SELECT state FROM conversations WHERE id = ?").get(id) as {
      state: string;
    };
    expect(conv.state).toBe("opt-out");
    expect(deps.postMessage).toHaveBeenCalledWith(USER, expect.stringContaining("I'll stop"));
  });

  it("preserves a late non-opt-out reply before dropping the stale conversation", async () => {
    const db = makeDb();
    const store = new ConversationStore(db);
    const id = insertStaleOpen(db, TWO_HOURS);
    const deps = makeDeps(db, store);

    const consumed = await handleConversationReply(
      { user: USER, channel: USER, text: "yeah we still use them daily", ts: nowTs() },
      CTX,
      deps,
    );

    // Routed to triage as a fresh task (not absorbed by the dead inquiry)...
    expect(consumed).toBe(false);
    const row = db.prepare("SELECT state, turns FROM conversations WHERE id = ?").get(id) as {
      state: string;
      turns: string;
    };
    expect(row.state).toBe("dropped");
    // ...but the reply is preserved on the conversation for recall.
    const turns = JSON.parse(row.turns) as Array<{ sender: string; text: string }>;
    expect(turns.some((t) => t.sender === "person" && t.text.includes("still use them"))).toBe(
      true,
    );
  });

  it("still honors opt-out on a fresh (non-stale) conversation", async () => {
    const db = makeDb();
    const store = new ConversationStore(db);
    store.open({ person_user_id: USER, channel: USER, topic: "X", opening_message: "Q?" });
    const deps = makeDeps(db, store);

    const consumed = await handleConversationReply(
      { user: USER, channel: USER, text: "stop asking, thanks", ts: nowTs() },
      CTX,
      deps,
    );

    expect(consumed).toBe(true);
    const count = db.prepare("SELECT COUNT(*) AS c FROM opt_outs").get() as { c: number };
    expect(count.c).toBe(1);
  });

  it("returns false when there is no open conversation", async () => {
    const db = makeDb();
    const store = new ConversationStore(db);
    const deps = makeDeps(db, store);

    const consumed = await handleConversationReply(
      { user: USER, channel: USER, text: "random message", ts: nowTs() },
      CTX,
      deps,
    );

    expect(consumed).toBe(false);
  });
});
