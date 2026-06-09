import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";

export interface ReporterDeps {
  db: DatabaseType;
  libPath: string;
}

export interface ReportResult {
  filedTo: string;
}

export class Reporter {
  constructor(private deps: ReporterDeps) {}

  async writeDailySummary(): Promise<ReportResult> {
    const today = new Date();
    const yyyyMmDd = today.toISOString().slice(0, 10);
    const startOfDay = new Date(yyyyMmDd + "T00:00:00").getTime();
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

    const relPath = join("reports/daily", `${yyyyMmDd}.md`);
    const fullPath = join(this.deps.libPath, relPath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, lines.join("\n"));

    this.deps.db
      .prepare(`INSERT INTO reports (kind, generated_at, filed_to) VALUES (?, ?, ?)`)
      .run("daily", Date.now(), relPath);

    return { filedTo: relPath };
  }
}
