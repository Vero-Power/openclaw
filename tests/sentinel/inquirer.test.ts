import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ConversationStore } from "../../src/sentinel/conversation-store.js";
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

describe("Inquirer (Phase B live mode — OPENCLAW_INQUIRER_LIVE=1)", () => {
  let libPath: string;
  let dbPath: string;

  beforeEach(() => {
    libPath = mkdtempSync(join(tmpdir(), "jr-library-inq-live-"));
    dbPath = join(libPath, "sentinel.db");
    ensureLibrarySkeleton(libPath);
  });
  afterEach(() => {
    rmSync(libPath, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("sends DM and opens conversation when OPENCLAW_INQUIRER_LIVE=1 and deps provided", async () => {
    vi.stubEnv("OPENCLAW_INQUIRER_LIVE", "1");

    const db = openSentinelDb(dbPath);
    db.prepare(
      "INSERT INTO insights (category, summary, evidence, derived_from, confidence, generated_at) VALUES (?,?,?,?,?,?)",
    ).run("friction", "BOM workflow unclear", "2 sessions stuck", "[]", 0.4, Date.now());

    const dmCalls: Array<{ user: string; text: string }> = [];
    const conversationStore = new ConversationStore(db);
    const llm: LlmClient = {
      complete: vi.fn(async () =>
        JSON.stringify({
          questions: [
            {
              target_user_id: "U_KALEB",
              topic: "BOM workflow",
              question_text: "What triggers the manual step after BOM quote?",
              rationale: "Low confidence on BOM flow",
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
      conversationStore,
    });

    const result = await inq.formulateQuestions();
    expect(result.questionsFiled).toBe(1);

    // DM must have been sent
    expect(dmCalls).toHaveLength(1);
    expect(dmCalls[0]?.user).toBe("U_KALEB");
    expect(dmCalls[0]?.text).toBe("What triggers the manual step after BOM quote?");

    // Conversation must be open in the store
    const open = conversationStore.findOpenForPerson("U_KALEB");
    expect(open).not.toBeNull();
    expect(open?.state).toBe("open");
    expect(open?.topic).toBe("BOM workflow");
    expect(open?.turns).toHaveLength(1);
    expect(open?.turns[0]?.sender).toBe("jr");

    db.close();
  });

  it("does not open a second conversation when one is already open", async () => {
    vi.stubEnv("OPENCLAW_INQUIRER_LIVE", "1");

    const db = openSentinelDb(dbPath);
    db.prepare(
      "INSERT INTO insights (category, summary, evidence, derived_from, confidence, generated_at) VALUES (?,?,?,?,?,?)",
    ).run("friction", "gap", "evidence", "[]", 0.4, Date.now());

    const dmCalls: Array<{ user: string; text: string }> = [];
    const conversationStore = new ConversationStore(db);

    // Pre-open a conversation for U_KALEB
    conversationStore.open({
      person_user_id: "U_KALEB",
      channel: "U_KALEB",
      topic: "prior topic",
      opening_message: "Prior question?",
    });

    const llm: LlmClient = {
      complete: vi.fn(async () =>
        JSON.stringify({
          questions: [
            {
              target_user_id: "U_KALEB",
              topic: "new topic",
              question_text: "New question?",
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
      conversationStore,
    });

    await inq.formulateQuestions();

    // No new DM should have been sent
    expect(dmCalls).toHaveLength(0);

    // Still only one open conversation
    const rows = db
      .prepare(
        "SELECT COUNT(*) as cnt FROM conversations WHERE person_user_id = 'U_KALEB' AND state = 'open'",
      )
      .get() as { cnt: number };
    expect(rows.cnt).toBe(1);

    db.close();
  });

  it("still writes to queue file even in live mode (queue-first behavior)", async () => {
    vi.stubEnv("OPENCLAW_INQUIRER_LIVE", "1");

    const db = openSentinelDb(dbPath);
    db.prepare(
      "INSERT INTO insights (category, summary, evidence, derived_from, confidence, generated_at) VALUES (?,?,?,?,?,?)",
    ).run("friction", "gap", "evidence", "[]", 0.4, Date.now());

    const conversationStore = new ConversationStore(db);
    const llm: LlmClient = {
      complete: vi.fn(async () =>
        JSON.stringify({
          questions: [
            {
              target_user_id: "U_ALICE",
              topic: "workflow",
              question_text: "How does it work?",
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
      dmUser: vi.fn(async () => {}),
      conversationStore,
    });

    await inq.formulateQuestions();

    const queuePath = join(libPath, "reports/inquiry-queue.md");
    expect(existsSync(queuePath)).toBe(true);
    const content = readFileSync(queuePath, "utf-8");
    expect(content).toContain("U_ALICE");

    db.close();
  });

  it("falls back to Phase A when flag is unset even if conversationStore is provided", async () => {
    // Flag not set — default off
    const db = openSentinelDb(dbPath);
    db.prepare(
      "INSERT INTO insights (category, summary, evidence, derived_from, confidence, generated_at) VALUES (?,?,?,?,?,?)",
    ).run("friction", "gap", "evidence", "[]", 0.4, Date.now());

    const dmCalls: Array<{ user: string; text: string }> = [];
    const conversationStore = new ConversationStore(db);
    const llm: LlmClient = {
      complete: vi.fn(async () =>
        JSON.stringify({
          questions: [
            {
              target_user_id: "U_TEST",
              topic: "test",
              question_text: "Test?",
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
      conversationStore,
    });

    await inq.formulateQuestions();

    // No DM without flag
    expect(dmCalls).toHaveLength(0);
    // No conversation opened
    expect(conversationStore.findOpenForPerson("U_TEST")).toBeNull();

    db.close();
  });
});
