import { existsSync, unlinkSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { openSentinelDb } from "../../src/sentinel/db.js";
import type { CompanyContextFirestoreLike } from "../../src/sentinel/observers/external-context/company-context.js";
import { createOracle } from "../../src/sentinel/oracle.js";

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
      llm: { complete: async () => FAKE_LLM_JSON },
    });
    const ridgeRecs = await oracle.recommendForUser("URIDGE");
    expect(ridgeRecs).toHaveLength(1);
    expect(ridgeRecs[0].assignee_email).toBe("ridge@example.com");
  });
});
