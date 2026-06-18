import { describe, it, expect, vi } from "vitest";
import { Synthesizer } from "../../src/sentinel/synthesizer.js";
import type { Observation } from "../../src/sentinel/types.js";
import type { LlmClient } from "../../src/triage/llm-client.js";

const fakeLlm = (response: string): LlmClient => ({
  complete: vi.fn(async () => response),
});

describe("Synthesizer", () => {
  it("parses a valid LLM response into insights", async () => {
    const llm = fakeLlm(
      JSON.stringify({
        insights: [
          {
            category: "pattern",
            summary: "BOM volume up 23% WoW",
            evidence: "62 BOMs this week vs 50 last week per `action-invocations` metric",
            derived_from: [1, 2],
            confidence: 0.85,
          },
        ],
      }),
    );
    const s = new Synthesizer(llm);
    const observations: Observation[] = [
      {
        id: 1,
        source: "self",
        topic: "action-invocations",
        timestamp: Date.now(),
        summary: "62 bomQuoteNotifier invocations this week",
        metrics: { count: 62 },
      },
      {
        id: 2,
        source: "self",
        topic: "action-invocations",
        timestamp: Date.now() - 7 * 24 * 60 * 60 * 1000,
        summary: "50 bomQuoteNotifier invocations last week",
        metrics: { count: 50 },
      },
    ];
    const insights = await s.synthesize(observations);
    expect(insights).toHaveLength(1);
    expect(insights[0].category).toBe("pattern");
    expect(insights[0].evidence).toContain("62");
  });

  it("rejects insights missing quantitative evidence", async () => {
    const llm = fakeLlm(
      JSON.stringify({
        insights: [
          {
            category: "pattern",
            summary: "Things seem busy",
            evidence: "feels like a lot of activity",
            derived_from: [1],
            confidence: 0.6,
          },
        ],
      }),
    );
    const s = new Synthesizer(llm);
    const observations: Observation[] = [
      { id: 1, source: "self", timestamp: Date.now(), summary: "stuff", metrics: { count: 5 } },
    ];
    const insights = await s.synthesize(observations);
    expect(insights).toHaveLength(0); // vibes-only insight got filtered
  });

  it("returns empty array on malformed LLM output", async () => {
    const llm = fakeLlm("not json");
    const s = new Synthesizer(llm);
    const insights = await s.synthesize([]);
    expect(insights).toHaveLength(0);
  });

  it("returns empty array on LLM throw", async () => {
    const llm: LlmClient = {
      complete: async () => {
        throw new Error("rate limited");
      },
    };
    const s = new Synthesizer(llm);
    const insights = await s.synthesize([]);
    expect(insights).toHaveLength(0);
  });
});
