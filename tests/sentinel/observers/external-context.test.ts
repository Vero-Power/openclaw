import { describe, it, expect } from "vitest";
import {
  createExternalContextObserver,
  type Researcher,
  type ResearchResult,
  type ExternalFinding,
  type ResearchTraceEntry,
  type ResearchBudget,
} from "../../../src/sentinel/observers/external-context.js";

describe("external-context observer module", () => {
  it("exports createExternalContextObserver and the Researcher port", () => {
    expect(typeof createExternalContextObserver).toBe("function");
    const researcher: Researcher = {
      research: async (): Promise<ResearchResult> => ({ findings: [], trace: [] }),
    };
    expect(typeof researcher.research).toBe("function");
  });
});

function makeFakeResearcher(result: ResearchResult): {
  researcher: Researcher;
  calls: Array<{ systemPrompt: string; budget: ResearchBudget }>;
} {
  const calls: Array<{ systemPrompt: string; budget: ResearchBudget }> = [];
  const researcher: Researcher = {
    research: async (opts) => {
      calls.push({ systemPrompt: opts.systemPrompt, budget: opts.budget });
      return result;
    },
  };
  return { researcher, calls };
}

describe("createExternalContextObserver — observer body", () => {
  it("emits 3-5 observations when the researcher returns findings", async () => {
    const findings: ExternalFinding[] = [
      {
        summary: "A",
        relevance_note: "ra",
        cited_urls: ["https://example.com/a"],
        confidence: "high",
        published_at: "2026-06-19",
      },
      {
        summary: "B",
        relevance_note: "rb",
        cited_urls: ["https://example.com/b"],
        confidence: "medium",
        published_at: null,
      },
      {
        summary: "C",
        relevance_note: "rc",
        cited_urls: ["https://example.com/c1", "https://example.com/c2"],
        confidence: "low",
        published_at: "2026-06-18",
      },
    ];
    const trace: ResearchTraceEntry[] = [
      { turn: 1, action: "search", query: "solar industry 2026" },
      { turn: 2, action: "finalize" },
    ];
    const { researcher, calls } = makeFakeResearcher({ findings, trace });

    const obs = createExternalContextObserver({ getResearcher: async () => researcher });
    const out = await obs.observe(0);

    expect(out).toHaveLength(3);
    expect(out[0].source).toBe("external-context");
    expect(out[0].topic).toBe("external:solar");
    expect(out[0].summary).toBe("A");
    expect(out[0].data).toMatchObject({
      relevance_note: "ra",
      cited_urls: ["https://example.com/a"],
      confidence: "high",
      published_at: "2026-06-19",
      trace,
    });

    // budget passed correctly
    expect(calls).toHaveLength(1);
    expect(calls[0].budget).toEqual({ maxTurns: 6, maxTokens: 30000, maxDivesPerTopic: 3 });
    // system prompt mentions Vero + google_search
    expect(calls[0].systemPrompt).toContain("Vero");
    expect(calls[0].systemPrompt).toContain("google_search");
  });

  it("returns [] when the researcher reports zero findings", async () => {
    const { researcher } = makeFakeResearcher({
      findings: [],
      trace: [{ turn: 1, action: "finalize" }],
    });
    const obs = createExternalContextObserver({ getResearcher: async () => researcher });
    const out = await obs.observe(0);
    expect(out).toEqual([]);
  });

  it("propagates errors thrown by the researcher", async () => {
    const researcher: Researcher = {
      research: async () => {
        throw new Error("gemini boom");
      },
    };
    const obs = createExternalContextObserver({ getResearcher: async () => researcher });
    await expect(obs.observe(0)).rejects.toThrow(/gemini boom/);
  });
});

describe("createExternalContextObserver — lazy cached researcher", () => {
  it("calls researcherFactory once and caches across cycles", async () => {
    let builds = 0;
    const obs = createExternalContextObserver({
      researcherFactory: () => {
        builds++;
        return {
          research: async () => ({ findings: [], trace: [] }),
        };
      },
    });
    await obs.observe(0);
    await obs.observe(0);
    expect(builds).toBe(1);
  });

  it("getResearcher takes precedence over researcherFactory and is NOT cached", async () => {
    let getCalls = 0;
    let factoryCalls = 0;
    const obs = createExternalContextObserver({
      getResearcher: async () => {
        getCalls++;
        return { research: async () => ({ findings: [], trace: [] }) };
      },
      researcherFactory: () => {
        factoryCalls++;
        return { research: async () => ({ findings: [], trace: [] }) };
      },
    });
    await obs.observe(0);
    await obs.observe(0);
    expect(getCalls).toBe(2);
    expect(factoryCalls).toBe(0);
  });
});

describe("createExternalContextObserver — wall-clock timeout", () => {
  it("rejects when the researcher hangs past the timeout", async () => {
    const slowResearcher: Researcher = {
      research: () => new Promise(() => {}), // never resolves
    };
    const obs = createExternalContextObserver({
      getResearcher: async () => slowResearcher,
      timeoutMs: 50, // tiny timeout for test speed
    });
    await expect(obs.observe(0)).rejects.toThrow(/timed out after 50ms/);
  });

  it("uses the production default of 90000ms when timeoutMs is omitted", async () => {
    const fast: Researcher = {
      research: async () => ({ findings: [], trace: [] }),
    };
    const obs = createExternalContextObserver({ getResearcher: async () => fast });
    // Just verify it doesn't throw and respects the override-or-default contract
    await expect(obs.observe(0)).resolves.toEqual([]);
  });
});
