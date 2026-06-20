import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { openSentinelDb } from "../../src/sentinel/db.js";

const TEST_DB = join(tmpdir(), `sentinel-test-${Date.now()}.db`);

describe("sentinel db", () => {
  afterEach(() => {
    if (existsSync(TEST_DB)) {
      unlinkSync(TEST_DB);
    }
    if (existsSync(`${TEST_DB}-shm`)) {
      unlinkSync(`${TEST_DB}-shm`);
    }
    if (existsSync(`${TEST_DB}-wal`)) {
      unlinkSync(`${TEST_DB}-wal`);
    }
  });

  it("creates all 9 tables on first open", () => {
    const db = openSentinelDb(TEST_DB);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain("observations");
    expect(names).toContain("insights");
    expect(names).toContain("conversations");
    expect(names).toContain("people_profiles");
    expect(names).toContain("opt_outs");
    expect(names).toContain("opportunities");
    expect(names).toContain("reports");
    expect(names).toContain("observer_watermarks");
    expect(names).toContain("followups");
    db.close();
  });

  it("is idempotent — re-opening doesn't error", () => {
    const db1 = openSentinelDb(TEST_DB);
    db1.close();
    const db2 = openSentinelDb(TEST_DB);
    expect(db2).toBeTruthy();
    db2.close();
  });

  it("reuses one connection per path while open, reopens after close", () => {
    const db1 = openSentinelDb(TEST_DB);
    const db2 = openSentinelDb(TEST_DB);
    expect(db2).toBe(db1);
    db1.close();
    const db3 = openSentinelDb(TEST_DB);
    expect(db3).not.toBe(db1);
    db3.close();
  });

  it("inserts an observation row", () => {
    const db = openSentinelDb(TEST_DB);
    const now = Date.now();
    db.prepare(
      `INSERT INTO observations (source, topic, timestamp, summary, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run("self", "triage", now, "5 sessions completed today", now);
    const row = db.prepare("SELECT source, summary FROM observations LIMIT 1").get() as {
      source: string;
      summary: string;
    };
    expect(row.source).toBe("self");
    expect(row.summary).toBe("5 sessions completed today");
    db.close();
  });

  it("creates the followups table with expected columns", () => {
    const db = openSentinelDb(TEST_DB);
    const cols = db.prepare(`PRAGMA table_info(followups)`).all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toEqual([
      "id",
      "kind",
      "payload",
      "status",
      "source",
      "source_ref",
      "requester_user_id",
      "created_at",
      "processed_at",
      "attempts",
      "last_error",
    ]);
    db.close();
  });
});

describe("openSentinelDb — oracle tables migration", () => {
  let dbPath: string;
  let db: DatabaseType;

  beforeEach(() => {
    dbPath = join(
      tmpdir(),
      `sentinel-oracle-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    db = openSentinelDb(dbPath);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-shm", "-wal"]) {
      const f = `${dbPath}${suffix}`;
      if (existsSync(f)) {
        unlinkSync(f);
      }
    }
  });

  it("creates oracle_recommendations table with all required columns", () => {
    const cols = db.prepare("PRAGMA table_info(oracle_recommendations)").all() as Array<{
      name: string;
      type: string;
    }>;
    const names = cols.map((c) => c.name).toSorted();
    expect(names).toEqual([
      "assignee_email",
      "assignee_slack_id",
      "confidence",
      "data",
      "dismissed_at",
      "embedding",
      "evidence",
      "first_seen_at",
      "id",
      "last_seen_at",
      "rationale",
      "scope",
      "title",
      "urgency",
    ]);
  });

  it("creates the assignee+last_seen_at index", () => {
    const indexes = db.prepare("PRAGMA index_list(oracle_recommendations)").all() as Array<{
      name: string;
    }>;
    const names = indexes.map((i) => i.name);
    expect(names).toContain("oracle_recommendations_assignee");
  });

  it("creates oracle_dms_sent table with composite primary key", () => {
    const cols = db.prepare("PRAGMA table_info(oracle_dms_sent)").all() as Array<{
      name: string;
      pk: number;
    }>;
    const pkCols = cols
      .filter((c) => c.pk > 0)
      .map((c) => c.name)
      .toSorted();
    expect(pkCols).toEqual(["assignee_email", "rec_id"]);
  });
});
