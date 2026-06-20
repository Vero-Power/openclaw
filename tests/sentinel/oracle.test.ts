import { existsSync, unlinkSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { openSentinelDb } from "../../src/sentinel/db.js";
import type { GeminiEmbeddingAdapter } from "../../src/sentinel/embeddings/gemini-adapter.js";
import { createEmbeddingService } from "../../src/sentinel/embeddings/service.js";
import type { CompanyContextFirestoreLike } from "../../src/sentinel/observers/external-context/company-context.js";
import { createOracle } from "../../src/sentinel/oracle.js";
import type { LlmClient } from "../../src/triage/llm-client.js";

function tmpDb(): string {
  return join(tmpdir(), `oracle-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function cleanupDb(path: string): void {
  for (const suffix of ["", "-shm", "-wal"]) {
    const f = `${path}${suffix}`;
    if (existsSync(f)) {
      unlinkSync(f);
    }
  }
}

function makeFirestoreFake(): CompanyContextFirestoreLike {
  return {
    countProjectsByField: async (field) => {
      if (field === "state") {
        return { TX: 222, UT: 2 };
      }
      if (field === "status") {
        return { ACTIVE: 155, CANCELLED: 51 };
      }
      return {};
    },
    sumProjectValue: async () => 8_000_000,
    countWorkOrdersByStatus: async () => ({ assigned: 283 }),
    listProjectAssignees: async () => [
      { owner_email: "kaleb@example.com", sales_rep_email: null },
      { owner_email: "ridge@example.com", sales_rep_email: null },
    ],
  };
}

const stubEmbeddings = {
  embed: async () => new Float32Array(768),
  findSimilar: async () => [],
  embedAndStore: async () => undefined,
};

const FAKE_LLM_JSON = JSON.stringify({
  recommendations: [
    {
      title: "Check on stuck TX projects",
      rationale: "5 ON_HOLD projects worth $200k",
      evidence_observation_ids: [42],
      evidence_insight_ids: [],
      assignee_email: "kaleb@example.com",
      scope: "ops",
      urgency: "high",
      confidence: "high",
    },
    {
      title: "Reach out to Ridge re: Texas competitor bankruptcies",
      rationale: "Sunnova + PosiGen filed Ch11",
      evidence_observation_ids: [],
      evidence_insight_ids: [198],
      assignee_email: "ridge@example.com",
      scope: "strategic",
      urgency: "medium",
      confidence: "high",
    },
  ],
});

describe("createOracle — recommendAll", () => {
  let dbPath: string;
  let db: DatabaseType;
  let libPath: string;

  beforeEach(() => {
    dbPath = tmpDb();
    db = openSentinelDb(dbPath);
    libPath = join(tmpdir(), `oracle-lib-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(libPath, { recursive: true });
  });

  afterEach(() => {
    db.close();
    cleanupDb(dbPath);
    if (existsSync(libPath)) {
      rmSync(libPath, { recursive: true, force: true });
    }
  });

  it("calls the LLM once and returns parsed recommendations with stable IDs", async () => {
    let llmCalls = 0;
    const oracle = createOracle({
      db,
      libPath,
      userAliases: { "kaleb@example.com": "UKALEB", "ridge@example.com": "URIDGE" },
      firestoreClient: makeFirestoreFake(),
      embeddings: stubEmbeddings,
      llm: {
        complete: async () => {
          llmCalls++;
          return FAKE_LLM_JSON;
        },
      },
    });

    const recs = await oracle.recommendAll();
    expect(llmCalls).toBe(1);
    expect(recs).toHaveLength(2);
    expect(recs[0].assignee_email).toBe("kaleb@example.com");
    expect(recs[0].assignee_slack_id).toBe("UKALEB");
    expect(recs[1].assignee_slack_id).toBe("URIDGE");
    expect(typeof recs[0].id).toBe("string");
    expect(recs[0].id.length).toBeGreaterThan(8);
    // same input → same ID
    const again = await oracle.recommendAll();
    expect(again[0].id).toBe(recs[0].id);
  });

  it("drops recommendations referencing unknown assignee emails", async () => {
    const oracle = createOracle({
      db,
      libPath,
      userAliases: {},
      firestoreClient: makeFirestoreFake(),
      embeddings: stubEmbeddings,
      llm: {
        complete: async () =>
          JSON.stringify({
            recommendations: [
              {
                title: "Valid",
                rationale: "x",
                evidence_observation_ids: [1],
                evidence_insight_ids: [],
                assignee_email: "kaleb@example.com",
                scope: "ops",
                urgency: "low",
                confidence: "low",
              },
              {
                title: "Invalid assignee",
                rationale: "x",
                evidence_observation_ids: [1],
                evidence_insight_ids: [],
                assignee_email: "stranger@example.com",
                scope: "ops",
                urgency: "low",
                confidence: "low",
              },
            ],
          }),
      },
    });
    const recs = await oracle.recommendAll();
    expect(recs).toHaveLength(1);
    expect(recs[0].assignee_email).toBe("kaleb@example.com");
  });

  it("throws on malformed LLM JSON", async () => {
    const oracle = createOracle({
      db,
      libPath,
      userAliases: {},
      firestoreClient: makeFirestoreFake(),
      embeddings: stubEmbeddings,
      llm: { complete: async () => "not json" },
    });
    await expect(oracle.recommendAll()).rejects.toThrow();
  });

  it("recommendForUser filters to that user's slack_id", async () => {
    const oracle = createOracle({
      db,
      libPath,
      userAliases: { "kaleb@example.com": "UKALEB", "ridge@example.com": "URIDGE" },
      firestoreClient: makeFirestoreFake(),
      embeddings: stubEmbeddings,
      llm: { complete: async () => FAKE_LLM_JSON },
    });
    const ridgeRecs = await oracle.recommendForUser("URIDGE");
    expect(ridgeRecs).toHaveLength(1);
    expect(ridgeRecs[0].assignee_email).toBe("ridge@example.com");
  });
});

function unitVector(i: number): Float32Array {
  const v = new Float32Array(768);
  v[i] = 1;
  return v;
}

function vecAtCosine(i: number, target: number): Float32Array {
  // Unit vector that has projection `target` onto basis e_i, with the
  // remaining magnitude split into one other component so the result
  // is unit-length and cosine(e_i, v) = target.
  const v = new Float32Array(768);
  v[i] = target;
  v[(i + 1) % 768] = Math.sqrt(1 - target * target);
  return v;
}

describe("Oracle semantic dedup", () => {
  let db: ReturnType<typeof openSentinelDb>;

  beforeEach(() => {
    db = openSentinelDb(`:memory:?id=${Math.random()}`);
  });

  function makeOracle(opts: { llmResponse: string; embedTexts: Map<string, Float32Array> }) {
    const llm: LlmClient = {
      async complete() {
        return opts.llmResponse;
      },
    };
    const adapter: GeminiEmbeddingAdapter = {
      async embed(text: string) {
        const v = opts.embedTexts.get(text);
        if (!v) {
          throw new Error(`no canned vector for: ${text}`);
        }
        return v;
      },
    };
    const firestore: CompanyContextFirestoreLike = {
      async countProjectsByField() {
        return {};
      },
      async sumProjectValue() {
        return 0;
      },
      async countWorkOrdersByStatus() {
        return {};
      },
      async listProjectAssignees() {
        return [{ owner_email: "x@example.com", sales_rep_email: null }];
      },
    };
    const embeddings = createEmbeddingService({ db, adapter });
    const oracle = createOracle({
      db,
      llm,
      libPath: "/tmp/notreal",
      firestoreClient: firestore,
      userAliases: {},
      embeddings,
    });
    return { oracle, embeddings };
  }

  it("merges a re-worded recommendation into the existing row", async () => {
    const existingTitle = "Investigate cancellation rate";
    const existingRationale = "22% projects cancelled — root cause unknown.";
    const existingEmbed = unitVector(42);

    db.prepare(
      `INSERT INTO oracle_recommendations
       (id, assignee_email, title, rationale, evidence, scope, urgency, confidence, data, first_seen_at, last_seen_at, embedding)
       VALUES ('seed1', 'x@example.com', ?, ?, ?, 'tactical', 'high', 'high', ?, 1000, 1000, ?)`,
    ).run(
      existingTitle,
      existingRationale,
      JSON.stringify(["insight:1"]),
      JSON.stringify({
        id: "seed1",
        title: existingTitle,
        rationale: existingRationale,
        evidence: ["insight:1"],
        assignee_email: "x@example.com",
        assignee_slack_id: null,
        scope: "tactical",
        urgency: "high",
        confidence: "high",
        generated_at: 1000,
      }),
      Buffer.from(existingEmbed.buffer),
    );

    const newTitle = "Reduce project cancellations";
    const newRationale = "Cancellations sit at 22% and are hurting margin.";
    const newEmbedText = `${newTitle}\n${newRationale}`;
    const llmResponse = JSON.stringify({
      recommendations: [
        {
          title: newTitle,
          rationale: newRationale,
          evidence_observation_ids: [],
          evidence_insight_ids: [9],
          assignee_email: "x@example.com",
          scope: "tactical",
          urgency: "high",
          confidence: "high",
        },
      ],
    });

    const { oracle } = makeOracle({
      llmResponse,
      embedTexts: new Map([
        [newEmbedText, vecAtCosine(42, 0.95)], // above 0.85 threshold
      ]),
    });

    // Tolerate filesystem errors from writePerPersonFile (path is /tmp/notreal)
    await oracle.runCycle().catch((err) => {
      if (/ENOENT|notreal/.test(err.message)) {
        return null;
      }
      throw err;
    });

    const rows = db
      .prepare(
        "SELECT id, first_seen_at, last_seen_at, evidence FROM oracle_recommendations ORDER BY first_seen_at",
      )
      .all() as Array<{
      id: string;
      first_seen_at: number;
      last_seen_at: number;
      evidence: string;
    }>;
    expect(rows.length).toBe(1); // merged, not inserted
    expect(rows[0].id).toBe("seed1");
    expect(rows[0].first_seen_at).toBe(1000);
    expect(rows[0].last_seen_at).toBeGreaterThan(1000);
    const evidence = JSON.parse(rows[0].evidence) as string[];
    expect(evidence).toContain("insight:1");
    expect(evidence).toContain("insight:9");
  });

  it("inserts a fresh recommendation when cosine sim is below threshold", async () => {
    db.prepare(
      `INSERT INTO oracle_recommendations
       (id, assignee_email, title, rationale, evidence, scope, urgency, confidence, data, first_seen_at, last_seen_at, embedding)
       VALUES ('seed1', 'x@example.com', 't1', 'r1', ?, 'ops', 'high', 'high', ?, 1000, 1000, ?)`,
    ).run(
      JSON.stringify(["insight:1"]),
      JSON.stringify({
        id: "seed1",
        title: "t1",
        rationale: "r1",
        evidence: ["insight:1"],
        assignee_email: "x@example.com",
        assignee_slack_id: null,
        scope: "ops",
        urgency: "high",
        confidence: "high",
        generated_at: 1000,
      }),
      Buffer.from(unitVector(42).buffer),
    );

    const newTitle = "Totally unrelated topic";
    const newRationale = "About something else entirely.";
    const newEmbedText = `${newTitle}\n${newRationale}`;
    const llmResponse = JSON.stringify({
      recommendations: [
        {
          title: newTitle,
          rationale: newRationale,
          evidence_observation_ids: [],
          evidence_insight_ids: [9],
          assignee_email: "x@example.com",
          scope: "ops",
          urgency: "medium",
          confidence: "high",
        },
      ],
    });

    const { oracle } = makeOracle({
      llmResponse,
      embedTexts: new Map([
        [newEmbedText, vecAtCosine(100, 0.5)], // far from seed
      ]),
    });

    await oracle.runCycle().catch((err) => {
      if (/ENOENT|notreal/.test(err.message)) {
        return null;
      }
      throw err;
    });

    const rows = db
      .prepare("SELECT id FROM oracle_recommendations ORDER BY first_seen_at")
      .all() as Array<{ id: string }>;
    expect(rows.length).toBe(2);
  });
});
