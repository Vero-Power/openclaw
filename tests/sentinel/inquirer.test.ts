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

// Test alias map — covers every synthetic user_id used in this file's stubs.
// Anti-hallucination filter accepts only IDs that appear as values here.
const TEST_ALIASES: Record<string, string> = {
  alice: "U_ALICE",
  kaleb: "U_KALEB",
  ok: "U_OK",
  opted_out: "U_OPTED_OUT",
  test: "U_TEST",
  x: "U_X",
};

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
    const inq = new Inquirer({ llm, db, libPath, userAliases: TEST_ALIASES });
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
      userAliases: TEST_ALIASES,
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
    const inq = new Inquirer({ llm, db, libPath, userAliases: TEST_ALIASES });
    const result = await inq.formulateQuestions();
    expect(result.questionsFiled).toBe(1);
    const content = readFileSync(join(libPath, "reports/inquiry-queue.md"), "utf-8");
    expect(content).not.toContain("U_OPTED_OUT");
    expect(content).toContain("U_OK");
    db.close();
  });

  it("rejects hallucinated user IDs — only known aliases are filed", async () => {
    const db = openSentinelDb(dbPath);
    db.prepare(
      "INSERT INTO insights (category, summary, evidence, derived_from, confidence, generated_at) VALUES (?,?,?,?,?,?)",
    ).run("friction", "test gap", "1 session", "[]", 0.3, Date.now());
    const llm: LlmClient = {
      complete: vi.fn(async () =>
        JSON.stringify({
          questions: [
            {
              // Hallucinated — not in TEST_ALIASES values
              target_user_id: "U_INVENTED_PERSON",
              topic: "anything",
              question_text: "Made-up question to a made-up person?",
              rationale: "LLM invented this user",
            },
            {
              // Real — in TEST_ALIASES values
              target_user_id: "U_KALEB",
              topic: "real",
              question_text: "Real question?",
              rationale: "U_KALEB is known",
            },
          ],
        }),
      ),
    };
    const inq = new Inquirer({ llm, db, libPath, userAliases: TEST_ALIASES });
    const result = await inq.formulateQuestions();
    // Only the legitimate question is filed; hallucinated user gets dropped
    expect(result.questionsFiled).toBe(1);
    const content = readFileSync(join(libPath, "reports/inquiry-queue.md"), "utf-8");
    expect(content).not.toContain("U_INVENTED_PERSON");
    expect(content).toContain("U_KALEB");
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
      userAliases: TEST_ALIASES,
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
      userAliases: TEST_ALIASES,
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

  it("uses semantic similarity to skip a reworded topic that token-overlap would miss", async () => {
    vi.stubEnv("OPENCLAW_INQUIRER_LIVE", "1");

    const db = openSentinelDb(dbPath);
    db.prepare(
      "INSERT INTO insights (category, summary, evidence, derived_from, confidence, generated_at) VALUES (?,?,?,?,?,?)",
    ).run("friction", "gap", "evidence", "[]", 0.4, Date.now());

    const conversationStore = new ConversationStore(db);
    const priorTopic = "Inactive Slack channels archival";
    const newTopic = "Quiet workspace channel cleanup";
    // Token-overlap of these two: tokens {inactive, slack, channels, archival}
    // vs {quiet, workspace, channel, cleanup}. Zero token intersection ⇒
    // overlap-coefficient = 0 ⇒ token fallback would let the question through.
    // We're testing that SEMANTIC similarity (cosine ≥ 0.75) catches it.
    const opened = conversationStore.open({
      person_user_id: "U_KALEB",
      channel: "U_KALEB",
      topic: priorTopic,
      opening_message: "Are those silent channels still needed?",
    });
    conversationStore.close(opened.id, "dropped");

    // Fake embeddings: any two distinct strings get vectors that are
    // 0.9-similar (above threshold) — proves the semantic path was taken
    // rather than the zero-overlap token fallback.
    const baseVec = new Float32Array(768);
    baseVec[0] = Math.cos(0.45);
    baseVec[1] = Math.sin(0.45);
    const closeVec = new Float32Array(768);
    closeVec[0] = Math.cos(0.55);
    closeVec[1] = Math.sin(0.55);
    const embeddings = {
      embed: vi.fn(async (text: string) => (text === newTopic ? baseVec : closeVec)),
      findSimilar: async () => [],
      embedAndStore: async () => undefined,
      sweepNullEmbeddings: async () => ({
        embedded: { observations: 0, insights: 0, oracle_recommendations: 0 },
        failed: { observations: 0, insights: 0, oracle_recommendations: 0 },
      }),
    };

    const dmCalls: Array<{ user: string; text: string }> = [];
    const llm: LlmClient = {
      complete: vi.fn(async () =>
        JSON.stringify({
          questions: [
            {
              target_user_id: "U_KALEB",
              topic: newTopic,
              question_text: "Can we archive those?",
              rationale: "low activity",
            },
          ],
        }),
      ),
    };

    const inq = new Inquirer({
      llm,
      db,
      libPath,
      userAliases: TEST_ALIASES,
      dmUser: async (user, text) => {
        dmCalls.push({ user, text });
      },
      conversationStore,
      embeddings,
    });

    await inq.formulateQuestions();

    // Semantic path suppressed it
    expect(dmCalls).toHaveLength(0);
    // And the embedding service was actually consulted
    expect(embeddings.embed).toHaveBeenCalled();

    db.close();
  });

  it("falls back to token-overlap when the embedding call throws", async () => {
    vi.stubEnv("OPENCLAW_INQUIRER_LIVE", "1");

    const db = openSentinelDb(dbPath);
    db.prepare(
      "INSERT INTO insights (category, summary, evidence, derived_from, confidence, generated_at) VALUES (?,?,?,?,?,?)",
    ).run("friction", "gap", "evidence", "[]", 0.4, Date.now());

    const conversationStore = new ConversationStore(db);
    // Prior topic with substantial token overlap to the new one
    const opened = conversationStore.open({
      person_user_id: "U_KALEB",
      channel: "U_KALEB",
      topic: "Inactive Slack channels",
      opening_message: "anything?",
    });
    conversationStore.close(opened.id, "dropped");

    const embeddings = {
      embed: vi.fn(async () => {
        throw new Error("gemini down");
      }),
      findSimilar: async () => [],
      embedAndStore: async () => undefined,
      sweepNullEmbeddings: async () => ({
        embedded: { observations: 0, insights: 0, oracle_recommendations: 0 },
        failed: { observations: 0, insights: 0, oracle_recommendations: 0 },
      }),
    };

    const dmCalls: Array<{ user: string; text: string }> = [];
    const llm: LlmClient = {
      complete: vi.fn(async () =>
        JSON.stringify({
          questions: [
            {
              target_user_id: "U_KALEB",
              // Same tokens as prior — token-overlap should match
              topic: "Inactive Slack channels followup",
              question_text: "Status?",
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
      userAliases: TEST_ALIASES,
      dmUser: async (user, text) => {
        dmCalls.push({ user, text });
      },
      conversationStore,
      embeddings,
    });

    await inq.formulateQuestions();

    // Embedding tried — and threw — but token-overlap suppressed the DM
    expect(embeddings.embed).toHaveBeenCalled();
    expect(dmCalls).toHaveLength(0);

    db.close();
  });

  it("skips a question when a similar-topic conversation closed in the last 48h", async () => {
    vi.stubEnv("OPENCLAW_INQUIRER_LIVE", "1");

    const db = openSentinelDb(dbPath);
    db.prepare(
      "INSERT INTO insights (category, summary, evidence, derived_from, confidence, generated_at) VALUES (?,?,?,?,?,?)",
    ).run("friction", "gap", "evidence", "[]", 0.4, Date.now());

    const conversationStore = new ConversationStore(db);

    // Prior conversation: same person, similar topic, ALREADY dropped
    // (i.e. cooldown applies to closed convos too, not just open ones).
    const opened = conversationStore.open({
      person_user_id: "U_KALEB",
      channel: "U_KALEB",
      topic: "Inactive Slack channels",
      opening_message: "Are those silent channels still needed?",
    });
    conversationStore.close(opened.id, "dropped");

    const dmCalls: Array<{ user: string; text: string }> = [];
    const llm: LlmClient = {
      complete: vi.fn(async () =>
        JSON.stringify({
          questions: [
            {
              target_user_id: "U_KALEB",
              // Phrased differently but semantically the same — token-overlap
              // ("silent", "slack", "channels") catches it.
              topic: "Silent Slack channels archival",
              question_text: "Can we archive those quiet channels?",
              rationale: "low activity",
            },
          ],
        }),
      ),
    };

    const inq = new Inquirer({
      llm,
      db,
      libPath,
      userAliases: TEST_ALIASES,
      dmUser: async (user, text) => {
        dmCalls.push({ user, text });
      },
      conversationStore,
    });

    await inq.formulateQuestions();

    // No new DM — cooldown swallowed it
    expect(dmCalls).toHaveLength(0);
    // No new conversation either
    const rows = db
      .prepare("SELECT COUNT(*) AS cnt FROM conversations WHERE person_user_id = 'U_KALEB'")
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
      userAliases: TEST_ALIASES,
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
      userAliases: TEST_ALIASES,
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
