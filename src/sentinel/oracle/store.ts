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

  recentDMdTitles(assigneeEmail: string, sinceMs: number): string[] {
    const rows = this.db
      .prepare(
        `SELECT r.title FROM oracle_dms_sent s
         JOIN oracle_recommendations r ON r.id = s.rec_id
         WHERE s.assignee_email = ? AND s.sent_at >= ?
         ORDER BY s.sent_at DESC`,
      )
      .all(assigneeEmail, sinceMs) as Array<{ title: string }>;
    return rows.map((r) => r.title);
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

  mergeInto(existingId: string, incoming: Recommendation): void {
    const row = this.db
      .prepare("SELECT data, evidence FROM oracle_recommendations WHERE id = ?")
      .get(existingId) as { data: string; evidence: string } | undefined;
    if (!row) {
      return;
    }
    let existingEvidence: string[];
    try {
      const parsed = JSON.parse(row.evidence) as unknown;
      existingEvidence = Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      existingEvidence = [];
    }
    const union = Array.from(new Set([...existingEvidence, ...incoming.evidence]));

    // The `data` column holds the full serialized Recommendation, which
    // is what queryAllForAssignee + diffNewForAssignee read back. Keep
    // it in sync with the canonical evidence union — otherwise downstream
    // consumers see stale evidence on merged rows.
    let mergedData: Recommendation;
    try {
      const parsedData = JSON.parse(row.data) as Recommendation;
      mergedData = { ...parsedData, evidence: union };
    } catch {
      mergedData = { ...incoming, evidence: union };
    }

    this.db
      .prepare(
        `UPDATE oracle_recommendations
         SET last_seen_at = ?, evidence = ?, data = ?
         WHERE id = ?`,
      )
      .run(incoming.generated_at, JSON.stringify(union), JSON.stringify(mergedData), existingId);
  }
}
