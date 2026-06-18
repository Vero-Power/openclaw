import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { openSentinelDb } from "../../src/sentinel/db.js";
import { Monetizer } from "../../src/sentinel/monetizer.js";
import type { LlmClient } from "../../src/triage/llm-client.js";

let dbPath: string;

describe("Monetizer", () => {
  beforeEach(() => {
    dbPath = join(tmpdir(), `mon-${Date.now()}.db`);
  });
  afterEach(() => {
    [dbPath, `${dbPath}-shm`, `${dbPath}-wal`].forEach((p) => {
      if (existsSync(p)) {
        unlinkSync(p);
      }
    });
  });

  it("writes proposed opportunities to the opportunities table", async () => {
    const db = openSentinelDb(dbPath);
    const llm: LlmClient = {
      complete: vi.fn(async () =>
        JSON.stringify({
          opportunities: [
            {
              title: "Batch BOM Mondays",
              scope: "ops-efficiency",
              summary: "Save ~12 manual triggers/week",
              evidence: "BOM volume = 62/week, batch-feasible",
              confidence: 0.8,
            },
            {
              title: "Expand to Texas market",
              scope: "strategic-revenue",
              summary: "TX install volume up 40% YoY",
              evidence: "40% YoY growth observed",
              confidence: 0.75,
            },
          ],
        }),
      ),
    };

    // Seed an insight so proposeWeekly doesn't short-circuit
    const now = Date.now();
    db.prepare(
      "INSERT INTO insights (category, summary, evidence, derived_from, confidence, generated_at) VALUES (?,?,?,?,?,?)",
    ).run("pattern", "BOM trend", "62 BOMs/week processed", "[]", 0.8, now);

    const mon = new Monetizer({ llm, db });
    await mon.proposeWeekly();
    const rows = db
      .prepare("SELECT title, scope, status FROM opportunities ORDER BY id")
      .all() as Array<{ title: string; scope: string; status: string }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].title).toBe("Batch BOM Mondays");
    expect(rows[0].scope).toBe("ops-efficiency");
    expect(rows[0].status).toBe("proposed");
    expect(rows[1].scope).toBe("strategic-revenue");
    db.close();
  });

  it("rejects opportunities missing quantitative evidence", async () => {
    const db = openSentinelDb(dbPath);
    const llm: LlmClient = {
      complete: vi.fn(async () =>
        JSON.stringify({
          opportunities: [
            {
              title: "Vibes-based idea",
              scope: "ops-efficiency",
              summary: "Feels like a win",
              evidence: "intuition",
              confidence: 0.6,
            },
          ],
        }),
      ),
    };

    // Seed an insight so proposeWeekly doesn't short-circuit
    const now = Date.now();
    db.prepare(
      "INSERT INTO insights (category, summary, evidence, derived_from, confidence, generated_at) VALUES (?,?,?,?,?,?)",
    ).run("pattern", "Some trend", "5 occurrences", "[]", 0.7, now);

    const mon = new Monetizer({ llm, db });
    await mon.proposeWeekly();
    const count = db.prepare("SELECT COUNT(*) AS c FROM opportunities").get() as {
      c: number;
    };
    expect(count.c).toBe(0);
    db.close();
  });
});
