import { z } from "zod";
import type { LlmClient } from "../../triage/llm-client.js";
import type { Observer } from "../observer.js";
import type { Observation } from "../types.js";

export interface IndustryContextObserverDeps {
  llm: LlmClient;
}

/**
 * Surfaces solar / clean-energy background context from the LLM's training knowledge.
 *
 * IMPORTANT: This observer does NOT fetch live data. Every observation summary is
 * prefixed with "BACKGROUND CONTEXT (not real-time)" so downstream consumers
 * (synthesizer, curator, humans) know these are training-knowledge signals, not
 * breaking news. The synthesizer and reporter must NOT present these as current
 * news items without that caveat.
 */
export function createIndustryContextObserver(deps: IndustryContextObserverDeps): Observer {
  return {
    name: "industry-context",

    async observe(_since: number): Promise<Omit<Observation, "id" | "created_at">[]> {
      const prompt = `List 3-5 broad solar industry topics or trends from your background knowledge that are likely relevant to a US residential solar installer's business decisions right now.

Return a JSON array only (no markdown fences). Each element:
{
  "summary": "<one-sentence topic>",
  "relevance_note": "<why this matters to a US installer>",
  "date_hint": "<approximate time period if known, optional>"
}

We treat these as "background context, not breaking news" downstream. Do not invent specifics; stick to topics your training data actually covers.`;

      let raw: string;
      try {
        raw = await deps.llm.complete(prompt, { model: "gemini-flash-lite", temperature: 0 });
      } catch {
        return [];
      }

      let items: z.infer<typeof IndustryTopicArraySchema>;
      try {
        const stripped = raw.trim().replace(/^```(?:json)?\n?|\n?```$/g, "");
        items = IndustryTopicArraySchema.parse(JSON.parse(stripped));
      } catch {
        return [];
      }

      const now = Date.now();
      return items.map((item) => {
        const summaryText = item.date_hint ? `${item.summary} (${item.date_hint})` : item.summary;
        return {
          source: "industry-context",
          topic: "industry:solar",
          timestamp: now,
          summary: `BACKGROUND CONTEXT (not real-time): ${summaryText}`,
          data: {
            relevance_note: item.relevance_note,
            date_hint: item.date_hint ?? null,
          },
        };
      });
    },
  };
}

// ---- Schema ----

const IndustryTopicSchema = z.object({
  summary: z.string(),
  relevance_note: z.string(),
  date_hint: z.string().optional(),
});

const IndustryTopicArraySchema = z.array(IndustryTopicSchema).min(1).max(10);
