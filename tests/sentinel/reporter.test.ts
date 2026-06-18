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

  it("daily summary includes a Follow-ups section when followups exist today", async () => {
    const db = openSentinelDb(dbPath);
    const now = Date.now();
    db.prepare(
      `INSERT INTO followups (kind, payload, status, source, created_at)
       VALUES ('note', ?, 'done', 'chat', ?)`,
    ).run(JSON.stringify({ text: "check forecast sync" }), now);
    db.prepare(
      `INSERT INTO followups (kind, payload, status, source, last_error, created_at)
       VALUES ('dm_person', ?, 'skipped', 'conversation', 'unknown alias: priya', ?)`,
    ).run(JSON.stringify({ target_alias: "priya", topic: "t", question_text: "q" }), now);
    const reporter = new Reporter({ db, libPath });
    const result = await reporter.writeDailySummary();
    const content = readFileSync(join(libPath, result.filedTo), "utf-8");
    expect(content).toContain("## Follow-ups (2)");
    expect(content).toContain("check forecast sync");
    expect(content).toContain("skipped");
    expect(content).toContain("unknown alias: priya");
    db.close();
  });

  it("daily summary omits Follow-ups section when none exist", async () => {
    const db = openSentinelDb(dbPath);
    const reporter = new Reporter({ db, libPath });
    const result = await reporter.writeDailySummary();
    const content = readFileSync(join(libPath, result.filedTo), "utf-8");
    expect(content).not.toContain("## Follow-ups");
    db.close();
  });
});

describe("Reporter — weekly + ideas", () => {
  beforeEach(() => {
    libPath = mkdtempSync(join(tmpdir(), "jr-library-wk-"));
    dbPath = join(libPath, "sentinel.db");
    ensureLibrarySkeleton(libPath);
  });
  afterEach(() => {
    rmSync(libPath, { recursive: true, force: true });
  });

  it("writeWeeklyDigest writes a markdown file + DMs Kaleb", async () => {
    const db = openSentinelDb(dbPath);
    const now = Date.now();
    db.prepare(
      "INSERT INTO insights (category, summary, evidence, derived_from, confidence, generated_at) VALUES (?,?,?,?,?,?)",
    ).run("pattern", "P1", "evidence 1", "[]", 0.9, now);
    db.prepare(
      "INSERT INTO insights (category, summary, evidence, derived_from, confidence, generated_at) VALUES (?,?,?,?,?,?)",
    ).run("opportunity", "O1", "evidence 2", "[]", 0.7, now);

    const dmCalls: Array<{ user: string; text: string }> = [];
    const reporter = new Reporter({
      db,
      libPath,
      dmUser: async (user, text) => {
        dmCalls.push({ user, text });
      },
      kalebUserId: "U_KALEB",
      ridgeUserId: "U_RIDGE",
    });
    const result = await reporter.writeWeeklyDigest();
    expect(result.filedTo).toContain("reports/weekly/");
    expect(dmCalls).toHaveLength(1);
    expect(dmCalls[0].user).toBe("U_KALEB");
    expect(dmCalls[0].text).toContain("Weekly digest");
    db.close();
  });

  it("writeIdeasReport DMs Kaleb always, DMs Ridge for high-confidence strategic ideas", async () => {
    const db = openSentinelDb(dbPath);
    const now = Date.now();
    db.prepare(
      "INSERT INTO opportunities (title, scope, summary, evidence, proposed_at, confidence, status) VALUES (?,?,?,?,?,?,?)",
    ).run("Ops idea", "ops-efficiency", "Save 10h/week", "10h", now, 0.8, "proposed");
    db.prepare(
      "INSERT INTO opportunities (title, scope, summary, evidence, proposed_at, confidence, status) VALUES (?,?,?,?,?,?,?)",
    ).run("Strategic idea", "strategic-revenue", "Expand into X", "$50k/yr", now, 0.85, "proposed");

    const dmCalls: Array<{ user: string; text: string }> = [];
    const reporter = new Reporter({
      db,
      libPath,
      dmUser: async (user, text) => {
        dmCalls.push({ user, text });
      },
      kalebUserId: "U_KALEB",
      ridgeUserId: "U_RIDGE",
    });
    await reporter.writeIdeasReport();
    const kalebDM = dmCalls.find((d) => d.user === "U_KALEB");
    const ridgeDM = dmCalls.find((d) => d.user === "U_RIDGE");
    expect(kalebDM).toBeTruthy();
    expect(kalebDM?.text).toContain("Ops idea");
    expect(ridgeDM).toBeTruthy();
    expect(ridgeDM?.text).toContain("Strategic idea");
    db.close();
  });
});
