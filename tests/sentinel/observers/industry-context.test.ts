import { describe, it, expect, vi } from "vitest";
import { createIndustryContextObserver } from "../../../src/sentinel/observers/industry-context.js";
import type { LlmClient } from "../../../src/triage/llm-client.js";

const VALID_LLM_RESPONSE = JSON.stringify([
  {
    summary: "ITC extension uncertainty",
    relevance_note: "Affects customer financing decisions for Q3 installs",
    date_hint: "2026",
  },
  {
    summary: "Panel tariff increase on Chinese imports",
    relevance_note: "Could raise equipment costs 10-15% for US installers",
    date_hint: "2026",
  },
  {
    summary: "IRS Form 5695 processing backlog",
    relevance_note: "Customers experiencing delayed tax credit refunds",
  },
]);

function makeLlm(response: string): LlmClient {
  return {
    complete: vi.fn().mockResolvedValue(response),
  };
}

describe("industry-context observer", () => {
  it("emits one observation per topic with BACKGROUND CONTEXT prefix", async () => {
    const llm = makeLlm(VALID_LLM_RESPONSE);
    const obs = createIndustryContextObserver({ llm });
    const results = await obs.observe(0);

    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.source).toBe("industry-context");
      expect(r.topic).toBe("industry:solar");
      expect(r.summary.startsWith("BACKGROUND CONTEXT (not real-time)")).toBe(true);
    }
    // Spot check first item content is present
    expect(results[0].summary).toContain("ITC extension");
  });

  it("returns empty array when LLM throws", async () => {
    const llm: LlmClient = {
      complete: vi.fn().mockRejectedValue(new Error("model unavailable")),
    };
    const obs = createIndustryContextObserver({ llm });
    const results = await obs.observe(0);
    expect(results).toHaveLength(0);
  });

  it("returns empty array on malformed JSON from LLM", async () => {
    const llm = makeLlm("this is not json at all");
    const obs = createIndustryContextObserver({ llm });
    const results = await obs.observe(0);
    expect(results).toHaveLength(0);
  });

  it("strips markdown fences before parsing", async () => {
    const fenced = "```json\n" + VALID_LLM_RESPONSE + "\n```";
    const llm = makeLlm(fenced);
    const obs = createIndustryContextObserver({ llm });
    const results = await obs.observe(0);
    expect(results).toHaveLength(3);
  });
});
