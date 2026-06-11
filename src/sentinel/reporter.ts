import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";

export interface ReporterDeps {
  db: DatabaseType;
  libPath: string;
  dmUser?: (userId: string, text: string) => Promise<void>;
  kalebUserId?: string;
  ridgeUserId?: string;
}

export interface ReportResult {
  filedTo: string;
}

function isoWeekNumber(d: Date): { year: number; week: number } {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: date.getUTCFullYear(), week };
}

export class Reporter {
  constructor(private deps: ReporterDeps) {}

  async writeDailySummary(): Promise<ReportResult> {
    const today = new Date();
    const yyyyMmDd = today.toISOString().slice(0, 10);
    // Parse as UTC midnight to match the UTC date string from toISOString.
    // Local-timezone parse would mismatch when local time is on a different
    // calendar day than UTC (e.g. tests running after 6pm MDT).
    const startOfDay = Date.parse(yyyyMmDd + "T00:00:00.000Z");
    const endOfDay = startOfDay + 24 * 60 * 60 * 1000;

    const observations = this.deps.db
      .prepare(
        `SELECT source, topic, summary, metrics FROM observations
         WHERE timestamp >= ? AND timestamp < ?
         ORDER BY timestamp ASC`,
      )
      .all(startOfDay, endOfDay) as Array<{
      source: string;
      topic: string | null;
      summary: string;
      metrics: string | null;
    }>;

    const insights = this.deps.db
      .prepare(
        `SELECT category, summary, evidence, confidence FROM insights
         WHERE generated_at >= ? AND generated_at < ?
         ORDER BY generated_at ASC`,
      )
      .all(startOfDay, endOfDay) as Array<{
      category: string;
      summary: string;
      evidence: string;
      confidence: number;
    }>;

    const lines: string[] = [
      `---`,
      `title: Daily summary ${yyyyMmDd}`,
      `summary: ${insights.length} insights, ${observations.length} observations`,
      `tags: [report, daily]`,
      `---`,
      ``,
      `# Daily Summary — ${yyyyMmDd}`,
      ``,
    ];

    if (observations.length === 0 && insights.length === 0) {
      lines.push("_Quiet day. No observations or insights recorded._", "");
    } else {
      lines.push(`## Insights (${insights.length})`, "");
      if (insights.length === 0) {
        lines.push("_(none synthesized today)_", "");
      } else {
        for (const ins of insights) {
          lines.push(`### ${ins.category.toUpperCase()} — ${ins.summary}`, "");
          lines.push(`_Confidence ${ins.confidence.toFixed(2)}_`, "");
          lines.push(ins.evidence, "");
        }
      }
      lines.push(`## Observations (${observations.length})`, "");
      for (const obs of observations) {
        const metricsLine = obs.metrics ? ` _metrics: ${obs.metrics}_` : "";
        lines.push(`- **${obs.source}** (${obs.topic ?? "?"}): ${obs.summary}${metricsLine}`);
      }
      lines.push("");
    }

    const followups = this.deps.db
      .prepare(
        `SELECT kind, payload, status, last_error FROM followups
         WHERE created_at >= ? AND created_at < ? ORDER BY created_at ASC`,
      )
      .all(startOfDay, endOfDay) as Array<{
      kind: string;
      payload: string;
      status: string;
      last_error: string | null;
    }>;

    if (followups.length > 0) {
      lines.push(`## Follow-ups (${followups.length})`, "");
      for (const f of followups) {
        let desc = f.payload;
        try {
          const p = JSON.parse(f.payload) as Record<string, unknown>;
          if (typeof p.text === "string") {
            desc = p.text;
          } else if (typeof p.question_text === "string") {
            desc = p.question_text;
          } else if (typeof p.task_text === "string") {
            desc = p.task_text;
          }
        } catch {
          // keep raw payload
        }
        const errSuffix = f.last_error ? ` — ${f.last_error}` : "";
        lines.push(`- **${f.kind}** [${f.status}]: ${desc}${errSuffix}`);
      }
      lines.push("");
    }

    const relPath = join("reports/daily", `${yyyyMmDd}.md`);
    this.writeFile(relPath, lines.join("\n"));
    this.recordReport("daily", relPath);
    return { filedTo: relPath };
  }

  async writeWeeklyDigest(): Promise<ReportResult> {
    const now = new Date();
    const { year, week } = isoWeekNumber(now);
    const weekStart = now.getTime() - 7 * 24 * 60 * 60 * 1000;

    const insights = this.deps.db
      .prepare(
        `SELECT category, summary, evidence, confidence FROM insights
         WHERE generated_at >= ? ORDER BY confidence DESC, generated_at DESC LIMIT 20`,
      )
      .all(weekStart) as Array<{
      category: string;
      summary: string;
      evidence: string;
      confidence: number;
    }>;

    const lines: string[] = [
      `---`,
      `title: Weekly digest W${week} ${year}`,
      `summary: ${insights.length} key insights from the past 7 days`,
      `tags: [report, weekly]`,
      `---`,
      ``,
      `# Weekly Digest — W${week}, ${year}`,
      ``,
      `Top insights from the past 7 days, ranked by confidence:`,
      ``,
    ];
    for (const ins of insights) {
      lines.push(`## ${ins.category.toUpperCase()} — ${ins.summary}`, "");
      lines.push(`_Confidence ${ins.confidence.toFixed(2)}_`, "");
      lines.push(ins.evidence, "");
    }

    const relPath = join("reports/weekly", `W${week}-${year}.md`);
    this.writeFile(relPath, lines.join("\n"));
    this.recordReport("weekly-digest", relPath);

    // DM Kaleb with top 3
    if (this.deps.dmUser && this.deps.kalebUserId) {
      const dmBody = `*Weekly digest filed:* \`${relPath}\`\n\nTop ${Math.min(3, insights.length)} insights:\n${insights
        .slice(0, 3)
        .map(
          (i, idx) => `${idx + 1}. *${i.summary}* (${i.category}, conf ${i.confidence.toFixed(2)})`,
        )
        .join("\n")}`;
      await this.deps.dmUser(this.deps.kalebUserId, dmBody);
    }

    return { filedTo: relPath };
  }

  async writeIdeasReport(): Promise<ReportResult> {
    const now = new Date();
    const { year, week } = isoWeekNumber(now);
    const weekStart = now.getTime() - 7 * 24 * 60 * 60 * 1000;

    const opps = this.deps.db
      .prepare(
        `SELECT title, scope, summary, evidence, confidence FROM opportunities
         WHERE proposed_at >= ? AND status = 'proposed'
         ORDER BY scope, confidence DESC`,
      )
      .all(weekStart) as Array<{
      title: string;
      scope: string;
      summary: string;
      evidence: string;
      confidence: number;
    }>;

    const opsOpps = opps.filter((o) => o.scope === "ops-efficiency");
    const stratOpps = opps.filter((o) => o.scope === "strategic-revenue");

    const lines: string[] = [
      `---`,
      `title: Weekly ideas W${week} ${year}`,
      `summary: ${opps.length} proposed opportunities (${opsOpps.length} ops, ${stratOpps.length} strategic)`,
      `tags: [report, ideas, weekly]`,
      `---`,
      ``,
      `# Weekly Ideas — W${week}, ${year}`,
      ``,
      `## Ops + Efficiency (${opsOpps.length})`,
      ``,
    ];
    for (const o of opsOpps) {
      lines.push(`### ${o.title}`, "");
      lines.push(`_Confidence ${o.confidence.toFixed(2)}_`, "");
      lines.push(o.summary, "");
      lines.push(`**Evidence:** ${o.evidence}`, "");
    }
    lines.push(`## Strategic Revenue (${stratOpps.length})`, "");
    for (const o of stratOpps) {
      lines.push(`### ${o.title}`, "");
      lines.push(`_Confidence ${o.confidence.toFixed(2)}_`, "");
      lines.push(o.summary, "");
      lines.push(`**Evidence:** ${o.evidence}`, "");
    }

    const relPath = join("reports/ideas", `W${week}-${year}-ideas.md`);
    this.writeFile(relPath, lines.join("\n"));
    this.recordReport("weekly-ideas", relPath);

    // DM Kaleb with all ops ideas
    if (this.deps.dmUser && this.deps.kalebUserId && opsOpps.length > 0) {
      const dmBody = `*Weekly ideas filed:* \`${relPath}\`\n\n*Ops + efficiency:*\n${opsOpps
        .map(
          (o, idx) => `${idx + 1}. *${o.title}* — ${o.summary} (conf ${o.confidence.toFixed(2)})`,
        )
        .join("\n")}`;
      await this.deps.dmUser(this.deps.kalebUserId, dmBody);
    }

    // DM Ridge for any high-confidence strategic idea
    if (this.deps.dmUser && this.deps.ridgeUserId) {
      const highConf = stratOpps.filter((o) => o.confidence >= 0.7);
      for (const o of highConf) {
        const dmBody = `I've been thinking about *${o.title}*.\n\n${o.summary}\n\n_Evidence:_ ${o.evidence}\n\nWorth a 15-min conversation?`;
        await this.deps.dmUser(this.deps.ridgeUserId, dmBody);
      }
    }

    return { filedTo: relPath };
  }

  private writeFile(relPath: string, content: string): void {
    const fullPath = join(this.deps.libPath, relPath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
  }

  private recordReport(kind: string, relPath: string): void {
    this.deps.db
      .prepare(`INSERT INTO reports (kind, generated_at, filed_to) VALUES (?, ?, ?)`)
      .run(kind, Date.now(), relPath);
  }
}
