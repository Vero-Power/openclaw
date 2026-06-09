import { z } from "zod";
import type { LlmClient } from "../triage/llm-client.js";
import { InsightCategorySchema, type Insight, type Observation } from "./types.js";

const SynthOutputSchema = z.object({
  insights: z.array(
    z.object({
      category: InsightCategorySchema,
      summary: z.string(),
      evidence: z.string(),
      derived_from: z.array(z.number()),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

const SYSTEM_PROMPT = `You are JR's private synthesizer. Given a batch of operational observations, extract insights.

Insight categories:
- pattern   — a recurring behavior or trend
- anomaly   — a deviation from normal
- friction  — a pain point worth fixing
- opportunity — a way to make Vero more money OR more efficient

Every insight MUST include quantitative evidence — at least one specific number sourced from the observation metrics. Insights based on "feels like" / "seems" / "appears" without a number are rejected.

Return JSON only, no markdown fences:
{ "insights": [ { "category": ..., "summary": ..., "evidence": ..., "derived_from": [ids], "confidence": 0..1 } ] }

If nothing notable was observed, return { "insights": [] }.`;

const NUMBER_PATTERN = /\d/;

export class Synthesizer {
  constructor(private llm: LlmClient) {}

  async synthesize(observations: Observation[]): Promise<Omit<Insight, "id" | "filed_to">[]> {
    if (observations.length === 0) {
      return [];
    }

    const obsLines = observations
      .map(
        (o) =>
          `[${o.id}] source=${o.source} topic=${o.topic ?? "?"} ts=${new Date(
            o.timestamp,
          ).toISOString()} summary="${o.summary}" metrics=${JSON.stringify(o.metrics ?? {})}`,
      )
      .join("\n");

    const prompt = `${SYSTEM_PROMPT}\n\nObservations:\n${obsLines}\n\nJSON:`;

    let raw: string;
    try {
      raw = await this.llm.complete(prompt, { model: "gemini-pro", temperature: 0 });
    } catch {
      return [];
    }

    let parsed: z.infer<typeof SynthOutputSchema>;
    try {
      const stripped = raw.trim().replace(/^```(?:json)?\n?|\n?```$/g, "");
      parsed = SynthOutputSchema.parse(JSON.parse(stripped));
    } catch {
      return [];
    }

    const now = Date.now();
    const validInsights: Omit<Insight, "id" | "filed_to">[] = [];
    for (const ins of parsed.insights) {
      // Quantitative-rigor gate: evidence must contain at least one digit
      if (!NUMBER_PATTERN.test(ins.evidence)) {
        continue;
      }
      validInsights.push({ ...ins, generated_at: now, filed_to: null });
    }
    return validInsights;
  }
}
