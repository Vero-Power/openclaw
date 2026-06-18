import type { Database as DatabaseType } from "better-sqlite3";
import { z } from "zod";
import type { LlmClient } from "../triage/llm-client.js";
import { OpportunityScopeSchema } from "./types.js";

const MonetizeOutputSchema = z.object({
  opportunities: z.array(
    z.object({
      title: z.string(),
      scope: OpportunityScopeSchema,
      summary: z.string(),
      evidence: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

const NUMBER_PATTERN = /\d/;

const SYSTEM_PROMPT = `You are JR's monetize engine — a business analyst whose only job is to find ways Vero can make more money or operate more efficiently.

Given the full set of insights and observations from the past week, propose the top 5 revenue opportunities AND top 5 efficiency wins.

Each opportunity MUST:
- Have a concrete title
- Be tagged "ops-efficiency" OR "strategic-revenue"
- Cite a SPECIFIC NUMBER from the observations as evidence (no "feels like" / "seems")
- Include a one-sentence summary of why this matters

Return JSON only, no markdown fences:
{ "opportunities": [ { "title", "scope", "summary", "evidence", "confidence": 0..1 } ] }

If nothing actionable surfaces, return { "opportunities": [] }.`;

export interface MonetizerDeps {
  llm: LlmClient;
  db: DatabaseType;
}

export class Monetizer {
  constructor(private deps: MonetizerDeps) {}

  async proposeWeekly(): Promise<void> {
    const weekStart = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const insights = this.deps.db
      .prepare(
        `SELECT category, summary, evidence, confidence FROM insights
         WHERE generated_at >= ? ORDER BY confidence DESC`,
      )
      .all(weekStart) as Array<{
      category: string;
      summary: string;
      evidence: string;
      confidence: number;
    }>;

    if (insights.length === 0) {
      return;
    }

    const insightLines = insights
      .map(
        (i, idx) =>
          `[${idx + 1}] (${i.category}, conf ${i.confidence.toFixed(2)}) ${i.summary} — ${i.evidence}`,
      )
      .join("\n");
    const prompt = `${SYSTEM_PROMPT}\n\nInsights from the past 7 days:\n${insightLines}\n\nJSON:`;

    let raw: string;
    try {
      raw = await this.deps.llm.complete(prompt, { model: "gemini-pro", temperature: 0.4 });
    } catch {
      return;
    }

    let parsed: z.infer<typeof MonetizeOutputSchema>;
    try {
      const stripped = raw.trim().replace(/^```(?:json)?\n?|\n?```$/g, "");
      parsed = MonetizeOutputSchema.parse(JSON.parse(stripped));
    } catch {
      return;
    }

    const insertStmt = this.deps.db.prepare(
      `INSERT INTO opportunities (title, scope, summary, evidence, proposed_at, confidence, status)
       VALUES (?, ?, ?, ?, ?, ?, 'proposed')`,
    );
    const now = Date.now();
    for (const opp of parsed.opportunities) {
      if (!NUMBER_PATTERN.test(opp.evidence)) {
        continue;
      }
      insertStmt.run(opp.title, opp.scope, opp.summary, opp.evidence, now, opp.confidence);
    }
  }
}
