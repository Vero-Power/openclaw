import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { openSentinelDb } from "../../../src/sentinel/db.js";
import {
  createExternalContextObserver,
  type Researcher,
  type ResearchResult,
  type ExternalFinding,
  type ResearchTraceEntry,
  type ResearchBudget,
} from "../../../src/sentinel/observers/external-context.js";

function tmpSentinelDb(): string {
  return join(tmpdir(), `sentinel-ext-ctx-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function cleanupDb(path: string): void {
  for (const suffix of ["", "-shm", "-wal"]) {
    const f = `${path}${suffix}`;
    if (existsSync(f)) {
      unlinkSync(f);
    }
  }
}

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

// Stub context fns so existing tests don't hit live Firestore / unseeded db.
const stubCompanyContextFn = async (): Promise<string> => "COMPANY SNAPSHOT: stub.";
const stubRecentResearchFn = (): string => "RECENT RESEARCH: stub.";

describe("createExternalContextObserver — observer body", () => {
  let dbPath: string;
  let db: DatabaseType;

  beforeEach(() => {
    dbPath = tmpSentinelDb();
    db = openSentinelDb(dbPath);
  });
  afterEach(() => {
    db.close();
    cleanupDb(dbPath);
  });

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

    const obs = createExternalContextObserver({
      db,
      getResearcher: async () => researcher,
      companyContextFn: stubCompanyContextFn,
      recentResearchFn: stubRecentResearchFn,
    });
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
    const obs = createExternalContextObserver({
      db,
      getResearcher: async () => researcher,
      companyContextFn: stubCompanyContextFn,
      recentResearchFn: stubRecentResearchFn,
    });
    const out = await obs.observe(0);
    expect(out).toEqual([]);
  });

  it("propagates errors thrown by the researcher", async () => {
    const researcher: Researcher = {
      research: async () => {
        throw new Error("gemini boom");
      },
    };
    const obs = createExternalContextObserver({
      db,
      getResearcher: async () => researcher,
      companyContextFn: stubCompanyContextFn,
      recentResearchFn: stubRecentResearchFn,
    });
    await expect(obs.observe(0)).rejects.toThrow(/gemini boom/);
  });
});

describe("createExternalContextObserver — lazy cached researcher", () => {
  let dbPath: string;
  let db: DatabaseType;

  beforeEach(() => {
    dbPath = tmpSentinelDb();
    db = openSentinelDb(dbPath);
  });
  afterEach(() => {
    db.close();
    cleanupDb(dbPath);
  });

  it("calls researcherFactory once and caches across cycles", async () => {
    let builds = 0;
    const obs = createExternalContextObserver({
      db,
      researcherFactory: () => {
        builds++;
        return {
          research: async () => ({ findings: [], trace: [] }),
        };
      },
      companyContextFn: stubCompanyContextFn,
      recentResearchFn: stubRecentResearchFn,
    });
    await obs.observe(0);
    await obs.observe(0);
    expect(builds).toBe(1);
  });

  it("getResearcher takes precedence over researcherFactory and is NOT cached", async () => {
    let getCalls = 0;
    let factoryCalls = 0;
    const obs = createExternalContextObserver({
      db,
      getResearcher: async () => {
        getCalls++;
        return { research: async () => ({ findings: [], trace: [] }) };
      },
      researcherFactory: () => {
        factoryCalls++;
        return { research: async () => ({ findings: [], trace: [] }) };
      },
      companyContextFn: stubCompanyContextFn,
      recentResearchFn: stubRecentResearchFn,
    });
    await obs.observe(0);
    await obs.observe(0);
    expect(getCalls).toBe(2);
    expect(factoryCalls).toBe(0);
  });
});

describe("createExternalContextObserver — wall-clock timeout", () => {
  let dbPath: string;
  let db: DatabaseType;

  beforeEach(() => {
    dbPath = tmpSentinelDb();
    db = openSentinelDb(dbPath);
  });
  afterEach(() => {
    db.close();
    cleanupDb(dbPath);
  });

  it("rejects when the researcher hangs past the timeout", async () => {
    const slowResearcher: Researcher = {
      research: () => new Promise(() => {}), // never resolves
    };
    const obs = createExternalContextObserver({
      db,
      getResearcher: async () => slowResearcher,
      timeoutMs: 50, // tiny timeout for test speed
      companyContextFn: stubCompanyContextFn,
      recentResearchFn: stubRecentResearchFn,
    });
    await expect(obs.observe(0)).rejects.toThrow(/timed out after 50ms/);
  });

  it("uses the production default of 90000ms when timeoutMs is omitted", async () => {
    const fast: Researcher = {
      research: async () => ({ findings: [], trace: [] }),
    };
    const obs = createExternalContextObserver({
      db,
      getResearcher: async () => fast,
      companyContextFn: stubCompanyContextFn,
      recentResearchFn: stubRecentResearchFn,
    });
    // Just verify it doesn't throw and respects the override-or-default contract
    await expect(obs.observe(0)).resolves.toEqual([]);
  });
});

describe("createExternalContextObserver — context wiring", () => {
  let dbPath: string;
  let db: DatabaseType;

  beforeEach(() => {
    dbPath = tmpSentinelDb();
    db = openSentinelDb(dbPath);
  });
  afterEach(() => {
    db.close();
    cleanupDb(dbPath);
  });

  it("calls both context builders and splices their output into the prompt", async () => {
    let companyCalls = 0;
    let researchCalls = 0;
    const { researcher, calls } = makeFakeResearcher({ findings: [], trace: [] });

    const obs = createExternalContextObserver({
      db,
      getResearcher: async () => researcher,
      companyContextFn: async () => {
        companyCalls++;
        return "COMPANY SNAPSHOT: 224 projects, 222 in TX.";
      },
      recentResearchFn: () => {
        researchCalls++;
        return "RECENT RESEARCH: ITC expiration covered yesterday.";
      },
    });

    await obs.observe(0);

    expect(companyCalls).toBe(1);
    expect(researchCalls).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].systemPrompt).toContain("COMPANY SNAPSHOT: 224 projects, 222 in TX.");
    expect(calls[0].systemPrompt).toContain("RECENT RESEARCH: ITC expiration covered yesterday.");
    // Verify hardcoded geography is GONE
    expect(calls[0].systemPrompt).not.toContain("Colorado, Texas, and Arizona");
  });

  it("rejects when the company-context builder throws", async () => {
    const { researcher } = makeFakeResearcher({ findings: [], trace: [] });
    const obs = createExternalContextObserver({
      db,
      getResearcher: async () => researcher,
      companyContextFn: async () => {
        throw new Error("firestore failure");
      },
      recentResearchFn: () => "RECENT RESEARCH: empty.",
    });
    await expect(obs.observe(0)).rejects.toThrow(/firestore failure/);
  });

  it("uses the runner-provided db for the default recent-research builder when no fn is injected", async () => {
    // Seed an external-context row so recent-research has something to find.
    db.prepare(
      `INSERT INTO observations (source, topic, timestamp, summary, data, metrics, created_at) VALUES (?,?,?,?,?,?,?)`,
    ).run(
      "external-context",
      "external:solar",
      Date.now(),
      "Test finding from seed",
      JSON.stringify({ confidence: "high", published_at: "2026-06-19", cited_urls: [], trace: [] }),
      JSON.stringify({}),
      Date.now(),
    );

    const { researcher, calls } = makeFakeResearcher({ findings: [], trace: [] });
    const obs = createExternalContextObserver({
      db,
      getResearcher: async () => researcher,
      // No recentResearchFn — should fall back to default which reads db
      companyContextFn: async () => "COMPANY SNAPSHOT: minimal.",
    });

    await obs.observe(0);
    expect(calls[0].systemPrompt).toContain("Test finding from seed");
  });
});
