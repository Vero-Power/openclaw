import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { openSentinelDb } from "../../../src/sentinel/db.js";
import { OracleStore, type Recommendation } from "../../../src/sentinel/oracle/store.js";

function tmpDb(): string {
  return join(tmpdir(), `sentinel-os-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function cleanup(path: string): void {
  for (const suffix of ["", "-shm", "-wal"]) {
    const f = `${path}${suffix}`;
    if (existsSync(f)) {
      unlinkSync(f);
    }
  }
}

function rec(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: overrides.id ?? "rec-1",
    title: overrides.title ?? "Default title",
    rationale: overrides.rationale ?? "default rationale",
    evidence: overrides.evidence ?? ["obs:42"],
    assignee_email: overrides.assignee_email ?? "kaleb@example.com",
    assignee_slack_id: overrides.assignee_slack_id ?? "UKALEB",
    scope: overrides.scope ?? "ops",
    urgency: overrides.urgency ?? "medium",
    confidence: overrides.confidence ?? "medium",
    generated_at: overrides.generated_at ?? Date.now(),
  };
}

describe("OracleStore", () => {
  let dbPath: string;
  let db: DatabaseType;
  let store: OracleStore;

  beforeEach(() => {
    dbPath = tmpDb();
    db = openSentinelDb(dbPath);
    store = new OracleStore(db);
  });

  afterEach(() => {
    db.close();
    cleanup(dbPath);
  });

  it("upsertAll inserts new recs with first_seen_at = last_seen_at", () => {
    const r = rec({ id: "a" });
    store.upsertAll([r]);
    const row = db
      .prepare("SELECT first_seen_at, last_seen_at FROM oracle_recommendations WHERE id=?")
      .get("a") as { first_seen_at: number; last_seen_at: number };
    expect(row.first_seen_at).toBe(row.last_seen_at);
  });

  it("upsertAll on existing id keeps first_seen_at and bumps last_seen_at", async () => {
    const r1 = rec({ id: "a", generated_at: 1000 });
    store.upsertAll([r1]);
    const before = db
      .prepare("SELECT first_seen_at FROM oracle_recommendations WHERE id=?")
      .get("a") as { first_seen_at: number };
    // Sleep a beat so Date.now() advances
    await new Promise((r) => setTimeout(r, 10));
    const r2 = rec({ id: "a", generated_at: 5000 });
    store.upsertAll([r2]);
    const after = db
      .prepare("SELECT first_seen_at, last_seen_at FROM oracle_recommendations WHERE id=?")
      .get("a") as { first_seen_at: number; last_seen_at: number };
    expect(after.first_seen_at).toBe(before.first_seen_at);
    expect(after.last_seen_at).toBeGreaterThan(before.first_seen_at);
  });

  it("diffNewForAssignee returns only recs whose id is NOT in oracle_dms_sent for that assignee", () => {
    const r1 = rec({ id: "a", assignee_email: "kaleb@example.com" });
    const r2 = rec({ id: "b", assignee_email: "kaleb@example.com" });
    const r3 = rec({ id: "c", assignee_email: "ridge@example.com" });
    store.upsertAll([r1, r2, r3]);
    store.markDMsSent([{ rec_id: "a", assignee_email: "kaleb@example.com" }]);
    const kalebNew = store.diffNewForAssignee("kaleb@example.com");
    expect(kalebNew.map((r) => r.id)).toEqual(["b"]);
    const ridgeNew = store.diffNewForAssignee("ridge@example.com");
    expect(ridgeNew.map((r) => r.id)).toEqual(["c"]);
  });

  it("queryAllForAssignee returns recs sorted urgency-DESC", () => {
    const now = Date.now();
    store.upsertAll([
      rec({ id: "low1", urgency: "low", assignee_email: "k@x.com", generated_at: now }),
      rec({ id: "high1", urgency: "high", assignee_email: "k@x.com", generated_at: now }),
      rec({ id: "med1", urgency: "medium", assignee_email: "k@x.com", generated_at: now }),
    ]);
    const list = store.queryAllForAssignee("k@x.com");
    expect(list.map((r) => r.id)).toEqual(["high1", "med1", "low1"]);
  });

  it("markDMsSent is idempotent", () => {
    store.upsertAll([rec({ id: "a", assignee_email: "k@x.com" })]);
    store.markDMsSent([{ rec_id: "a", assignee_email: "k@x.com" }]);
    expect(() => store.markDMsSent([{ rec_id: "a", assignee_email: "k@x.com" }])).not.toThrow();
    const count = db.prepare("SELECT COUNT(*) AS c FROM oracle_dms_sent").get() as { c: number };
    expect(count.c).toBe(1);
  });
});
