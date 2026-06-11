import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach } from "vitest";
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

  it("creates all 8 tables on first open", () => {
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
    db.close();
  });

  it("is idempotent — re-opening doesn't error", () => {
    const db1 = openSentinelDb(TEST_DB);
    db1.close();
    const db2 = openSentinelDb(TEST_DB);
    expect(db2).toBeTruthy();
    db2.close();
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
