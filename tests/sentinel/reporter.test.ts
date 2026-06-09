import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openSentinelDb } from "../../src/sentinel/db.js";
import { ensureLibrarySkeleton } from "../../src/sentinel/library.js";
import { Reporter } from "../../src/sentinel/reporter.js";

let libPath: string;
let dbPath: string;

describe("Reporter", () => {
  beforeEach(() => {
    libPath = mkdtempSync(join(tmpdir(), "jr-library-rpt-"));
    dbPath = join(libPath, "sentinel.db");
    ensureLibrarySkeleton(libPath);
  });
  afterEach(() => {
    rmSync(libPath, { recursive: true, force: true });
  });

  it("writeDailySummary produces a markdown file with the day's observations + insights", async () => {
    const db = openSentinelDb(dbPath);
    const today = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    db.prepare(
      "INSERT INTO observations (source, topic, timestamp, summary, metrics, created_at) VALUES (?,?,?,?,?,?)",
    ).run("self", "triage", now, "5 sessions completed", JSON.stringify({ count: 5 }), now);
    db.prepare(
      "INSERT INTO insights (category, summary, evidence, derived_from, confidence, generated_at) VALUES (?,?,?,?,?,?)",
    ).run("pattern", "Pattern A", "based on 5 things", "[1]", 0.8, now);

    const reporter = new Reporter({ db, libPath });
    const result = await reporter.writeDailySummary();
    expect(result.filedTo).toContain("reports/daily/");
    expect(result.filedTo).toContain(today);
    const content = readFileSync(join(libPath, result.filedTo), "utf-8");
    expect(content).toContain("Pattern A");
    expect(content).toContain("5 sessions completed");

    // Also recorded in reports table
    const row = db.prepare("SELECT kind, filed_to FROM reports WHERE kind = ?").get("daily") as {
      kind: string;
      filed_to: string;
    };
    expect(row.kind).toBe("daily");
    expect(row.filed_to).toBe(result.filedTo);
    db.close();
  });

  it("writeDailySummary handles empty days gracefully", async () => {
    const db = openSentinelDb(dbPath);
    const reporter = new Reporter({ db, libPath });
    const result = await reporter.writeDailySummary();
    expect(existsSync(join(libPath, result.filedTo))).toBe(true);
    const content = readFileSync(join(libPath, result.filedTo), "utf-8");
    expect(content.toLowerCase()).toContain("quiet day");
    db.close();
  });
});
