import type { Database as DatabaseType } from "better-sqlite3";

export interface Recommendation {
  id: string;
  title: string;
  rationale: string;
  evidence: string[];
  assignee_email: string;
  assignee_slack_id: string | null;
  scope: "ops" | "tactical" | "strategic";
  urgency: "low" | "medium" | "high";
  confidence: "low" | "medium" | "high";
  generated_at: number;
}

const URGENCY_RANK: Record<Recommendation["urgency"], number> = {
  high: 3,
  medium: 2,
  low: 1,
};

export class OracleStore {
  constructor(private readonly db: DatabaseType) {}

  upsertAll(recs: Recommendation[]): void {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO oracle_recommendations
        (id, assignee_email, assignee_slack_id, title, rationale, evidence,
         scope, urgency, confidence, data, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        assignee_email = excluded.assignee_email,
        assignee_slack_id = excluded.assignee_slack_id,
        title = excluded.title,
        rationale = excluded.rationale,
        evidence = excluded.evidence,
        scope = excluded.scope,
        urgency = excluded.urgency,
        confidence = excluded.confidence,
        data = excluded.data,
        last_seen_at = excluded.last_seen_at
    `);
    const insertMany = this.db.transaction((rows: Recommendation[]) => {
      for (const r of rows) {
        stmt.run(
          r.id,
          r.assignee_email,
          r.assignee_slack_id,
          r.title,
          r.rationale,
          JSON.stringify(r.evidence),
          r.scope,
          r.urgency,
          r.confidence,
          JSON.stringify(r),
          now,
          now,
        );
      }
    });
    insertMany(recs);
  }

  diffNewForAssignee(assigneeEmail: string): Recommendation[] {
    const rows = this.db
      .prepare(
        `SELECT data FROM oracle_recommendations r
         WHERE r.assignee_email = ?
           AND NOT EXISTS (
             SELECT 1 FROM oracle_dms_sent s
             WHERE s.rec_id = r.id AND s.assignee_email = r.assignee_email
           )
         ORDER BY r.last_seen_at DESC`,
      )
      .all(assigneeEmail) as Array<{ data: string }>;
    return rows.map((row) => JSON.parse(row.data) as Recommendation);
  }

  queryAllForAssignee(assigneeEmail: string): Recommendation[] {
    const rows = this.db
      .prepare(
        `SELECT data FROM oracle_recommendations
         WHERE assignee_email = ?
         ORDER BY last_seen_at DESC`,
      )
      .all(assigneeEmail) as Array<{ data: string }>;
    const list = rows.map((row) => JSON.parse(row.data) as Recommendation);
    return list.toSorted((a, b) => URGENCY_RANK[b.urgency] - URGENCY_RANK[a.urgency]);
  }

  markDMsSent(entries: Array<{ rec_id: string; assignee_email: string }>): void {
    const now = Date.now();
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO oracle_dms_sent (rec_id, assignee_email, sent_at) VALUES (?, ?, ?)`,
    );
    const insertMany = this.db.transaction((rows: typeof entries) => {
      for (const e of rows) {
        stmt.run(e.rec_id, e.assignee_email, now);
      }
    });
    insertMany(entries);
  }
}
