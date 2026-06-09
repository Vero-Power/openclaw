import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ConversationStore } from "../../src/sentinel/conversation-store.js";
import { openSentinelDb } from "../../src/sentinel/db.js";

function tmpDbPath(): string {
  return join(tmpdir(), `sentinel-conv-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function cleanup(path: string): void {
  for (const suffix of ["", "-shm", "-wal"]) {
    const full = `${path}${suffix}`;
    if (existsSync(full)) {
      unlinkSync(full);
    }
  }
}

describe("ConversationStore", () => {
  let dbPath: string;
  let db: DatabaseType;
  let store: ConversationStore;

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = openSentinelDb(dbPath);
    store = new ConversationStore(db);
  });

  afterEach(() => {
    db.close();
    cleanup(dbPath);
  });

  describe("open()", () => {
    it("creates a row with state=open and an initial JR turn", () => {
      const conv = store.open({
        person_user_id: "U_ALICE",
        channel: "D_CH1",
        topic: "BOM workflow",
        opening_message: "Hey, what happens after you trigger the BOM quote?",
      });

      expect(conv.id).toBeGreaterThan(0);
      expect(conv.state).toBe("open");
      expect(conv.person_user_id).toBe("U_ALICE");
      expect(conv.channel).toBe("D_CH1");
      expect(conv.topic).toBe("BOM workflow");
      expect(conv.opening_message).toBe("Hey, what happens after you trigger the BOM quote?");
      expect(conv.turns).toHaveLength(1);
      expect(conv.turns[0]?.sender).toBe("jr");
      expect(conv.turns[0]?.text).toBe("Hey, what happens after you trigger the BOM quote?");
      expect(conv.turns[0]?.ts).toBeGreaterThan(0);
      expect(conv.closed_at).toBeNull();
      expect(conv.takeaway).toBeNull();
    });

    it("sets opened_at and last_turn_at to current time", () => {
      const before = Date.now();
      const conv = store.open({
        person_user_id: "U_BOB",
        channel: "D_CH2",
        topic: "install flow",
        opening_message: "Hi",
      });
      const after = Date.now();

      expect(conv.opened_at).toBeGreaterThanOrEqual(before);
      expect(conv.opened_at).toBeLessThanOrEqual(after);
      expect(conv.last_turn_at).toBeGreaterThanOrEqual(before);
      expect(conv.last_turn_at).toBeLessThanOrEqual(after);
    });
  });

  describe("findOpenForPerson()", () => {
    it("returns null when there is no open conversation", () => {
      const result = store.findOpenForPerson("U_NOBODY");
      expect(result).toBeNull();
    });

    it("returns the open conversation when one exists", () => {
      store.open({
        person_user_id: "U_CAROL",
        channel: "D_CH3",
        topic: "payroll timing",
        opening_message: "Question about payroll...",
      });

      const found = store.findOpenForPerson("U_CAROL");
      expect(found).not.toBeNull();
      expect(found?.state).toBe("open");
      expect(found?.person_user_id).toBe("U_CAROL");
    });

    it("returns null after conversation is closed", () => {
      const conv = store.open({
        person_user_id: "U_DAVE",
        channel: "D_CH4",
        topic: "test",
        opening_message: "Hi",
      });

      store.close(conv.id, "closed");

      const found = store.findOpenForPerson("U_DAVE");
      expect(found).toBeNull();
    });
  });

  describe("appendTurn()", () => {
    it("appends a new turn and updates last_turn_at", () => {
      const conv = store.open({
        person_user_id: "U_EVE",
        channel: "D_CH5",
        topic: "test",
        opening_message: "First question",
      });

      const before = Date.now();
      store.appendTurn(conv.id, { sender: "person", text: "My answer here", ts: before });

      const updated = store.findOpenForPerson("U_EVE");
      expect(updated?.turns).toHaveLength(2);
      expect(updated?.turns[1]?.sender).toBe("person");
      expect(updated?.turns[1]?.text).toBe("My answer here");
      expect(updated?.last_turn_at).toBe(before);
    });

    it("appends multiple turns in order", () => {
      const conv = store.open({
        person_user_id: "U_FRANK",
        channel: "D_CH6",
        topic: "multi-turn",
        opening_message: "Q1",
      });

      store.appendTurn(conv.id, { sender: "person", text: "A1", ts: 1000 });
      store.appendTurn(conv.id, { sender: "jr", text: "Q2", ts: 2000 });
      store.appendTurn(conv.id, { sender: "person", text: "A2", ts: 3000 });

      const updated = store.findOpenForPerson("U_FRANK");
      expect(updated?.turns).toHaveLength(4);
      expect(updated?.turns.map((t) => t.text)).toEqual(["Q1", "A1", "Q2", "A2"]);
    });

    it("does nothing when id does not exist", () => {
      // Should not throw
      expect(() => {
        store.appendTurn(99999, { sender: "person", text: "ghost", ts: Date.now() });
      }).not.toThrow();
    });
  });

  describe("close()", () => {
    it("transitions state to closed and sets closed_at", () => {
      const conv = store.open({
        person_user_id: "U_GRACE",
        channel: "D_CH7",
        topic: "test",
        opening_message: "Hi",
      });

      store.close(conv.id, "closed");

      const row = db
        .prepare("SELECT state, closed_at, takeaway FROM conversations WHERE id = ?")
        .get(conv.id) as { state: string; closed_at: number; takeaway: string | null };

      expect(row.state).toBe("closed");
      expect(row.closed_at).toBeGreaterThan(0);
      expect(row.takeaway).toBeNull();
    });

    it("sets takeaway when provided", () => {
      const conv = store.open({
        person_user_id: "U_HANK",
        channel: "D_CH8",
        topic: "test",
        opening_message: "Hi",
      });

      store.close(conv.id, "closed", "Learned that BOM trigger is manual");

      const row = db.prepare("SELECT takeaway FROM conversations WHERE id = ?").get(conv.id) as {
        takeaway: string;
      };

      expect(row.takeaway).toBe("Learned that BOM trigger is manual");
    });

    it("can transition to opt-out state", () => {
      const conv = store.open({
        person_user_id: "U_IVY",
        channel: "D_CH9",
        topic: "test",
        opening_message: "Hi",
      });

      store.close(conv.id, "opt-out");

      const row = db.prepare("SELECT state FROM conversations WHERE id = ?").get(conv.id) as {
        state: string;
      };

      expect(row.state).toBe("opt-out");
    });

    it("can transition to dropped state", () => {
      const conv = store.open({
        person_user_id: "U_JACK",
        channel: "D_CH10",
        topic: "test",
        opening_message: "Hi",
      });

      store.close(conv.id, "dropped");

      const row = db.prepare("SELECT state FROM conversations WHERE id = ?").get(conv.id) as {
        state: string;
      };

      expect(row.state).toBe("dropped");
    });
  });

  describe("expireStale()", () => {
    it("returns 0 when there are no conversations", () => {
      const count = store.expireStale(3 * 24 * 60 * 60 * 1000);
      expect(count).toBe(0);
    });

    it("marks open conversations idle > maxIdleMs as dropped", () => {
      // Insert a conversation with last_turn_at 4 days ago
      const fourDaysAgo = Date.now() - 4 * 24 * 60 * 60 * 1000;
      db.prepare(`
        INSERT INTO conversations
          (person_user_id, channel, topic, opening_message, state, turns, opened_at, last_turn_at)
        VALUES ('U_OLD', 'D_OLD', 'test', 'Hi', 'open', '[]', ?, ?)
      `).run(fourDaysAgo, fourDaysAgo);

      const count = store.expireStale(3 * 24 * 60 * 60 * 1000);
      expect(count).toBe(1);

      const row = db
        .prepare("SELECT state FROM conversations WHERE person_user_id = 'U_OLD'")
        .get() as { state: string };
      expect(row.state).toBe("dropped");
    });

    it("does not touch conversations that are still active", () => {
      store.open({
        person_user_id: "U_FRESH",
        channel: "D_FRESH",
        topic: "recent",
        opening_message: "Just asked",
      });

      const count = store.expireStale(3 * 24 * 60 * 60 * 1000);
      expect(count).toBe(0);

      const found = store.findOpenForPerson("U_FRESH");
      expect(found?.state).toBe("open");
    });

    it("does not touch terminal-state rows (closed, dropped, opt-out)", () => {
      const pastTime = Date.now() - 10 * 24 * 60 * 60 * 1000;

      for (const state of ["closed", "dropped", "opt-out"]) {
        db.prepare(`
          INSERT INTO conversations
            (person_user_id, channel, topic, opening_message, state, turns, opened_at, last_turn_at, closed_at)
          VALUES (?, 'D_TERM', 'test', 'Hi', ?, '[]', ?, ?, ?)
        `).run(`U_TERM_${state}`, state, pastTime, pastTime, pastTime);
      }

      const count = store.expireStale(3 * 24 * 60 * 60 * 1000);
      expect(count).toBe(0);
    });
  });
});
