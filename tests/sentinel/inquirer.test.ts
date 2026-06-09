import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { openSentinelDb } from "../../src/sentinel/db.js";
import { Inquirer } from "../../src/sentinel/inquirer.js";
import { ensureLibrarySkeleton } from "../../src/sentinel/library.js";
import type { LlmClient } from "../../src/triage/llm-client.js";

let libPath: string;
let dbPath: string;

describe("Inquirer (manual-review mode)", () => {
  beforeEach(() => {
    libPath = mkdtempSync(join(tmpdir(), "jr-library-inq-"));
    dbPath = join(libPath, "sentinel.db");
    ensureLibrarySkeleton(libPath);
  });
  afterEach(() => {
    rmSync(libPath, { recursive: true, force: true });
  });

  it("generates a question for a knowledge gap and files it to review queue", async () => {
    const db = openSentinelDb(dbPath);
    const now = Date.now();
    db.prepare(
      "INSERT INTO insights (category, summary, evidence, derived_from, confidence, generated_at) VALUES (?,?,?,?,?,?)",
    ).run("friction", "BOM workflow unclear", "2 sessions stuck", "[]", 0.4, now);

    const llm: LlmClient = {
      complete: vi.fn(async () =>
        JSON.stringify({
          questions: [
            {
              target_user_id: "U_KALEB",
              topic: "BOM workflow",
              question_text:
                "What's the manual step you do between Coperniq BOM Quote Requested and pinging Greentech?",
              rationale: "Insight 1: BOM workflow has friction (2 stuck sessions)",
            },
          ],
        }),
      ),
    };
    const inq = new Inquirer({ llm, db, libPath });
    const result = await inq.formulateQuestions();
    expect(result.questionsFiled).toBe(1);
    const queuePath = join(libPath, "reports/inquiry-queue.md");
    expect(existsSync(queuePath)).toBe(true);
    const content = readFileSync(queuePath, "utf-8");
    expect(content).toContain("BOM workflow");
    expect(content).toContain("U_KALEB");
    db.close();
  });

  it("does not send any DM in Phase A (manual-review mode)", async () => {
    const db = openSentinelDb(dbPath);
    const dmCalls: Array<{ user: string; text: string }> = [];
    const llm: LlmClient = {
      complete: vi.fn(async () =>
        JSON.stringify({
          questions: [
            {
              target_user_id: "U_X",
              topic: "test",
              question_text: "test?",
              rationale: "test",
            },
          ],
        }),
      ),
    };
    const inq = new Inquirer({
      llm,
      db,
      libPath,
      dmUser: async (user, text) => {
        dmCalls.push({ user, text });
      },
    });
    await inq.formulateQuestions();
    expect(dmCalls).toHaveLength(0);
    db.close();
  });

  it("respects opt_outs — skips users with global opt-out", async () => {
    const db = openSentinelDb(dbPath);
    // Need at least one low-confidence insight so formulateQuestions doesn't early-return
    db.prepare(
      "INSERT INTO insights (category, summary, evidence, derived_from, confidence, generated_at) VALUES (?,?,?,?,?,?)",
    ).run("friction", "test gap", "1 session", "[]", 0.3, Date.now());
    db.prepare("INSERT INTO opt_outs (person_user_id, scope, added_at) VALUES (?, ?, ?)").run(
      "U_OPTED_OUT",
      "global",
      Date.now(),
    );
    const llm: LlmClient = {
      complete: vi.fn(async () =>
        JSON.stringify({
          questions: [
            {
              target_user_id: "U_OPTED_OUT",
              topic: "anything",
              question_text: "Question?",
              rationale: "test",
            },
            {
              target_user_id: "U_OK",
              topic: "anything",
              question_text: "Other?",
              rationale: "test",
            },
          ],
        }),
      ),
    };
    const inq = new Inquirer({ llm, db, libPath });
    const result = await inq.formulateQuestions();
    expect(result.questionsFiled).toBe(1);
    const content = readFileSync(join(libPath, "reports/inquiry-queue.md"), "utf-8");
    expect(content).not.toContain("U_OPTED_OUT");
    expect(content).toContain("U_OK");
    db.close();
  });
});
