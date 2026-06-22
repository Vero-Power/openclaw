import type { Database as DatabaseType, Statement } from "better-sqlite3";
import type { Conversation, ConversationState, ConversationTurn } from "./types.js";

export interface OpenConversationParams {
  person_user_id: string;
  channel: string;
  topic: string;
  opening_message: string;
}

interface ConversationRow {
  id: number;
  person_user_id: string;
  channel: string;
  thread_ts: string | null;
  topic: string;
  opening_message: string;
  state: string;
  turns: string | null;
  opened_at: number;
  last_turn_at: number | null;
  closed_at: number | null;
  takeaway: string | null;
}

function rowToConversation(row: ConversationRow): Conversation & { id: number } {
  return {
    id: row.id,
    person_user_id: row.person_user_id,
    channel: row.channel,
    thread_ts: row.thread_ts,
    topic: row.topic,
    opening_message: row.opening_message,
    state: row.state as ConversationState,
    turns: row.turns ? (JSON.parse(row.turns) as ConversationTurn[]) : [],
    opened_at: row.opened_at,
    last_turn_at: row.last_turn_at,
    closed_at: row.closed_at,
    takeaway: row.takeaway,
  };
}

export class ConversationStore {
  private readonly stmtInsert: Statement;
  private readonly stmtFindOpen: Statement;
  private readonly stmtGetById: Statement;
  private readonly stmtFindRecentForPerson: Statement;
  private readonly stmtUpdateTurns: Statement;
  private readonly stmtClose: Statement;
  private readonly stmtExpireStale: Statement;

  constructor(private readonly db: DatabaseType) {
    this.stmtInsert = db.prepare(`
      INSERT INTO conversations
        (person_user_id, channel, topic, opening_message, state, turns, opened_at, last_turn_at)
      VALUES (?, ?, ?, ?, 'open', ?, ?, ?)
    `);

    this.stmtFindOpen = db.prepare(`
      SELECT * FROM conversations
      WHERE person_user_id = ? AND state = 'open'
      ORDER BY opened_at DESC
      LIMIT 1
    `);

    this.stmtGetById = db.prepare(`
      SELECT * FROM conversations WHERE id = ?
    `);

    this.stmtFindRecentForPerson = db.prepare(`
      SELECT * FROM conversations
      WHERE person_user_id = ?
        AND COALESCE(closed_at, opened_at) >= ?
      ORDER BY COALESCE(closed_at, opened_at) DESC
      LIMIT ?
    `);

    this.stmtUpdateTurns = db.prepare(`
      UPDATE conversations
      SET turns = ?, last_turn_at = ?
      WHERE id = ?
    `);

    this.stmtClose = db.prepare(`
      UPDATE conversations
      SET state = ?, closed_at = ?, takeaway = COALESCE(?, takeaway)
      WHERE id = ?
    `);

    this.stmtExpireStale = db.prepare(`
      UPDATE conversations
      SET state = 'dropped', closed_at = ?
      WHERE state = 'open' AND last_turn_at < ?
    `);
  }

  open(params: OpenConversationParams): Conversation & { id: number } {
    const now = Date.now();
    const openingTurn: ConversationTurn = { sender: "jr", text: params.opening_message, ts: now };
    const turns = JSON.stringify([openingTurn]);

    const result = this.stmtInsert.run(
      params.person_user_id,
      params.channel,
      params.topic,
      params.opening_message,
      turns,
      now,
      now,
    );

    const row = this.stmtGetById.get(result.lastInsertRowid) as ConversationRow;
    return rowToConversation(row);
  }

  findOpenForPerson(personUserId: string): (Conversation & { id: number }) | null {
    const row = this.stmtFindOpen.get(personUserId) as ConversationRow | undefined;
    if (!row) {
      return null;
    }
    return rowToConversation(row);
  }

  /**
   * Return up to `limit` conversations for this person (any state) whose most
   * recent activity (close timestamp if closed, otherwise opening timestamp)
   * is within the past `withinMs`. Ordered newest first. Used by the inquirer
   * cooldown to skip re-asking about a topic the person was recently asked.
   */
  findRecentForPerson(
    personUserId: string,
    withinMs: number,
    limit = 5,
  ): Array<Conversation & { id: number }> {
    const since = Date.now() - withinMs;
    const rows = this.stmtFindRecentForPerson.all(personUserId, since, limit) as ConversationRow[];
    return rows.map(rowToConversation);
  }

  appendTurn(id: number, turn: ConversationTurn): void {
    const row = this.stmtGetById.get(id) as ConversationRow | undefined;
    if (!row) {
      return;
    }
    const existing: ConversationTurn[] = row.turns
      ? (JSON.parse(row.turns) as ConversationTurn[])
      : [];
    existing.push(turn);
    this.stmtUpdateTurns.run(JSON.stringify(existing), turn.ts, id);
  }

  close(id: number, state: Exclude<ConversationState, "open">, takeaway?: string): void {
    const now = Date.now();
    this.stmtClose.run(state, now, takeaway ?? null, id);
  }

  /**
   * Mark open conversations with no turn activity in the last `maxIdleMs` milliseconds as
   * 'dropped'. Returns the count of rows updated.
   */
  expireStale(maxIdleMs: number): number {
    const cutoff = Date.now() - maxIdleMs;
    const result = this.stmtExpireStale.run(Date.now(), cutoff);
    return result.changes;
  }
}
