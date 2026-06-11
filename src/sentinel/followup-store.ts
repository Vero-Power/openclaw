import type { Database as DatabaseType } from "better-sqlite3";

export type FollowupKind = "dm_person" | "note" | "task";
export type FollowupStatus = "pending" | "done" | "failed" | "skipped";
export type FollowupSource = "conversation" | "chat";

export interface FollowupRow {
  id: number;
  kind: FollowupKind;
  payload: Record<string, unknown>;
  status: FollowupStatus;
  source: FollowupSource;
  source_ref: string | null;
  requester_user_id: string | null;
  created_at: number;
  processed_at: number | null;
  attempts: number;
  last_error: string | null;
}

export interface InsertFollowupParams {
  kind: FollowupKind;
  payload: Record<string, unknown>;
  source: FollowupSource;
  sourceRef?: string;
  requesterUserId?: string;
}

const MAX_ATTEMPTS = 3;

interface RawRow extends Omit<FollowupRow, "payload"> {
  payload: string;
}

function hydrate(raw: RawRow): FollowupRow {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(raw.payload) as Record<string, unknown>;
  } catch {
    payload = {};
  }
  return { ...raw, payload };
}

export class FollowupStore {
  constructor(private db: DatabaseType) {}

  insert(params: InsertFollowupParams): number {
    const result = this.db
      .prepare(
        `INSERT INTO followups (kind, payload, status, source, source_ref, requester_user_id, created_at)
         VALUES (?, ?, 'pending', ?, ?, ?, ?)`,
      )
      .run(
        params.kind,
        JSON.stringify(params.payload),
        params.source,
        params.sourceRef ?? null,
        params.requesterUserId ?? null,
        Date.now(),
      );
    return Number(result.lastInsertRowid);
  }

  get(id: number): FollowupRow | null {
    const raw = this.db.prepare(`SELECT * FROM followups WHERE id = ?`).get(id) as
      | RawRow
      | undefined;
    return raw ? hydrate(raw) : null;
  }

  listPending(): FollowupRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM followups WHERE status = 'pending' ORDER BY created_at ASC, id ASC`)
      .all() as RawRow[];
    return rows.map(hydrate);
  }

  listCreatedBetween(startMs: number, endMs: number): FollowupRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM followups WHERE created_at >= ? AND created_at < ? ORDER BY created_at ASC`,
      )
      .all(startMs, endMs) as RawRow[];
    return rows.map(hydrate);
  }

  markDone(id: number): void {
    this.db
      .prepare(`UPDATE followups SET status = 'done', processed_at = ? WHERE id = ?`)
      .run(Date.now(), id);
  }

  markSkipped(id: number, reason: string): void {
    this.db
      .prepare(
        `UPDATE followups SET status = 'skipped', processed_at = ?, last_error = ? WHERE id = ?`,
      )
      .run(Date.now(), reason, id);
  }

  recordFailure(id: number, error: string): void {
    this.db
      .prepare(
        `UPDATE followups
         SET attempts = attempts + 1,
             last_error = ?,
             status = CASE WHEN attempts + 1 >= ${MAX_ATTEMPTS} THEN 'failed' ELSE 'pending' END,
             processed_at = CASE WHEN attempts + 1 >= ${MAX_ATTEMPTS} THEN ? ELSE processed_at END
         WHERE id = ?`,
      )
      .run(error, Date.now(), id);
  }
}
