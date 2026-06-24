# Chat-v2 RAG Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user DMs JR, embed the message and prepend the top-k semantically-similar insights + oracle recommendations into the reasoner's existing `contextBlock` so replies cite JR's accumulated knowledge instead of producing generic answers.

**Architecture:** New pure module `src/triage/chat/rag-context.ts` exports `buildRagContext(message, deps): Promise<string>`. The chat handler in `src/triage/chat/index.ts` calls it before `reasoner.reason()` and concatenates the result onto `convoContext.full`. Reasoner + responder untouched. EmbeddingService + sentinel DB plumbed in via the same module-level setter pattern triage-bridge already uses for the oracle.

**Tech Stack:** TypeScript, `better-sqlite3`, existing `EmbeddingService` (Gemini `gemini-embedding-001` @ 768 dims).

**Branch:** New branch `feat/chat-v2-rag-context` off `main` (PR #10 just merged).

**Spec:** `docs/superpowers/specs/2026-06-22-chat-v2-rag-context-design.md`

---

## Task 1: Expose `embeddings` on the Sentinel surface

**Files:**

- Modify: `/Users/vero/openclaw/src/sentinel/index.ts`
- No test (interface-only change; covered indirectly via integration in Task 4)

Context: `createSentinel` already constructs `embeddings = createEmbeddingService(...)` as a local const at line ~89, but the returned `Sentinel` interface doesn't expose it. The chat handler (via triage-bridge) needs the service. This task just widens the public surface.

- [ ] **Step 1: Add `embeddings` to the `Sentinel` interface**

Locate (around line 60-69):

```ts
export interface Sentinel {
  scheduler: SentinelScheduler;
  db: DatabaseType;
  conversationStore: ConversationStore;
  channelResolver: ChannelNameResolver;
  runCycleOnce(): Promise<void>;
  oracle: {
    recommendForUser(slackUserId: string): Promise<Recommendation[]>;
  };
}
```

Add the `embeddings` field. Final shape:

```ts
import type { EmbeddingService } from "./embeddings/service.js";

export interface Sentinel {
  scheduler: SentinelScheduler;
  db: DatabaseType;
  conversationStore: ConversationStore;
  channelResolver: ChannelNameResolver;
  runCycleOnce(): Promise<void>;
  oracle: {
    recommendForUser(slackUserId: string): Promise<Recommendation[]>;
  };
  embeddings: EmbeddingService;
}
```

If the `EmbeddingService` type isn't already imported at the top of the file, add it. (Existing imports include `createEmbeddingService` from the same module; the type might not be imported separately.) Check around lines 1-25 of the file.

- [ ] **Step 2: Add `embeddings` to the returned object**

Locate (around line 307-319):

```ts
return {
  scheduler,
  db,
  conversationStore,
  channelResolver,
  runCycleOnce,
  oracle: {
    recommendForUser: async (slackUserId: string) => {
      const o = await getOracle();
      return o.recommendForUser(slackUserId);
    },
  },
};
```

Add `embeddings,` as a field (it's the already-constructed local const from earlier in the function):

```ts
return {
  scheduler,
  db,
  conversationStore,
  channelResolver,
  runCycleOnce,
  oracle: {
    recommendForUser: async (slackUserId: string) => {
      const o = await getOracle();
      return o.recommendForUser(slackUserId);
    },
  },
  embeddings,
};
```

- [ ] **Step 3: Verify typecheck + sentinel suite**

Run: `cd /Users/vero/openclaw && npx tsc --noEmit 2>&1 | grep -v "synthesizer.ts:75" | head -10`
Expected: No new errors. (Pre-existing `synthesizer.ts:75` error stays — ignore.)

Run: `cd /Users/vero/openclaw && npm test -- --run tests/sentinel 2>&1 | tail -5`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/vero/openclaw
git add src/sentinel/index.ts
git commit -m "feat(sentinel): expose embeddings on Sentinel public surface

The EmbeddingService is already constructed inside createSentinel.
Adding it to the returned interface so callers (chat-v2 RAG, future
adopters) can consume findSimilar without reaching into sentinel
internals or constructing a parallel service."
```

---

## Task 2: New `rag-context.ts` module + tests (TDD)

**Files:**

- Create: `/Users/vero/openclaw/src/triage/chat/rag-context.ts`
- Create: `/Users/vero/openclaw/tests/triage/chat/rag-context.test.ts`

Context: The core module. Pure (no Slack/network IO). Takes a message + the EmbeddingService + a DB connection and returns a formatted context block. Threshold filter is internal; per-call try/catch ensures partial failure doesn't lose the surviving table.

- [ ] **Step 1: Write the failing test**

Create `/Users/vero/openclaw/tests/triage/chat/rag-context.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { openSentinelDb } from "../../../src/sentinel/db.js";
import { encodeEmbedding } from "../../../src/sentinel/embeddings/blob-codec.js";
import { createEmbeddingService } from "../../../src/sentinel/embeddings/service.js";
import type { GeminiEmbeddingAdapter } from "../../../src/sentinel/embeddings/gemini-adapter.js";
import { buildRagContext } from "../../../src/triage/chat/rag-context.js";

function unitVector(i: number): Float32Array {
  const v = new Float32Array(768);
  v[i] = 1;
  return v;
}

function makeAdapter(map: Map<string, Float32Array>): GeminiEmbeddingAdapter {
  return {
    async embed(text: string): Promise<Float32Array> {
      const v = map.get(text);
      if (!v) {
        throw new Error(`adapter: no canned vector for "${text}"`);
      }
      return v;
    },
  };
}

describe("buildRagContext", () => {
  let db: ReturnType<typeof openSentinelDb>;

  beforeEach(() => {
    db = openSentinelDb(`:memory:?id=${Math.random()}`);
  });

  it("returns empty string when no rows clear the threshold", async () => {
    db.prepare(
      `INSERT INTO insights (category, summary, evidence, generated_at, confidence, embedding)
       VALUES ('ops', 'orthogonal insight', '[]', 1, 0.7, ?)`,
    ).run(encodeEmbedding(unitVector(99)));

    const adapter = makeAdapter(new Map([["query", unitVector(0)]]));
    const embeddings = createEmbeddingService({ db, adapter });

    const out = await buildRagContext("query", { embeddings, db });
    expect(out).toBe("");
  });

  it("returns formatted block when an insight clears the threshold", async () => {
    db.prepare(
      `INSERT INTO insights (category, summary, evidence, generated_at, confidence, embedding)
       VALUES ('operations', '22% project cancellation rate', '[]', 1, 0.85, ?)`,
    ).run(encodeEmbedding(unitVector(0)));

    const adapter = makeAdapter(new Map([["cancellations?", unitVector(0)]]));
    const embeddings = createEmbeddingService({ db, adapter });

    const out = await buildRagContext("cancellations?", { embeddings, db });
    expect(out).toContain("Relevant knowledge from JR's memory:");
    expect(out).toContain("[insight | category=operations, conf=0.85]");
    expect(out).toContain("22% project cancellation rate");
  });

  it("caps insights to k=3 and oracle to k=2", async () => {
    // 5 insights, all near-identical to the query vector
    for (let i = 0; i < 5; i++) {
      db.prepare(
        `INSERT INTO insights (category, summary, evidence, generated_at, confidence, embedding)
         VALUES ('ops', ?, '[]', ?, 0.5, ?)`,
      ).run(`insight ${i}`, i + 1, encodeEmbedding(unitVector(0)));
    }
    // 4 oracle recs
    for (let i = 0; i < 4; i++) {
      db.prepare(
        `INSERT INTO oracle_recommendations
         (id, assignee_email, title, rationale, evidence, scope, urgency, confidence, data, first_seen_at, last_seen_at, embedding)
         VALUES (?, 'x@example.com', ?, 'r', '[]', 'tactical', 'high', 'high', '{}', 1, ?, ?)`,
      ).run(`rec-${i}`, `rec title ${i}`, i + 1, encodeEmbedding(unitVector(0)));
    }

    const adapter = makeAdapter(new Map([["q", unitVector(0)]]));
    const embeddings = createEmbeddingService({ db, adapter });

    const out = await buildRagContext("q", { embeddings, db });
    const insightLines = out.split("\n").filter((l) => l.includes("[insight"));
    const oracleLines = out.split("\n").filter((l) => l.includes("[oracle rec"));
    expect(insightLines).toHaveLength(3);
    expect(oracleLines).toHaveLength(2);
  });

  it("orders insights before oracle recs", async () => {
    db.prepare(
      `INSERT INTO insights (category, summary, evidence, generated_at, confidence, embedding)
       VALUES ('ops', 'an insight', '[]', 1, 0.8, ?)`,
    ).run(encodeEmbedding(unitVector(0)));
    db.prepare(
      `INSERT INTO oracle_recommendations
       (id, assignee_email, title, rationale, evidence, scope, urgency, confidence, data, first_seen_at, last_seen_at, embedding)
       VALUES ('r1', 'x@example.com', 'a rec', 'r', '[]', 'tactical', 'high', 'high', '{}', 1, 1, ?)`,
    ).run(encodeEmbedding(unitVector(0)));

    const adapter = makeAdapter(new Map([["q", unitVector(0)]]));
    const embeddings = createEmbeddingService({ db, adapter });

    const out = await buildRagContext("q", { embeddings, db });
    const insightPos = out.indexOf("[insight");
    const oraclePos = out.indexOf("[oracle rec");
    expect(insightPos).toBeGreaterThan(-1);
    expect(oraclePos).toBeGreaterThan(insightPos);
  });

  it("returns empty string when adapter throws on the query embed", async () => {
    db.prepare(
      `INSERT INTO insights (category, summary, evidence, generated_at, confidence, embedding)
       VALUES ('ops', 'present row', '[]', 1, 0.7, ?)`,
    ).run(encodeEmbedding(unitVector(0)));

    const failingAdapter: GeminiEmbeddingAdapter = {
      async embed() {
        throw new Error("gemini down");
      },
    };
    const embeddings = createEmbeddingService({ db, adapter: failingAdapter });

    const out = await buildRagContext("anything", { embeddings, db });
    expect(out).toBe("");
  });

  it("oracle hits still render when insights findSimilar throws", async () => {
    db.prepare(
      `INSERT INTO oracle_recommendations
       (id, assignee_email, title, rationale, evidence, scope, urgency, confidence, data, first_seen_at, last_seen_at, embedding)
       VALUES ('r1', 'x@example.com', 'oracle survives', 'r', '[]', 'ops', 'high', 'high', '{}', 1, 1, ?)`,
    ).run(encodeEmbedding(unitVector(0)));

    // Adapter returns a valid vec for the query, but we'll wrap findSimilar
    // on insights to throw via a Proxy.
    const adapter = makeAdapter(new Map([["q", unitVector(0)]]));
    const baseEmbeddings = createEmbeddingService({ db, adapter });
    const embeddings = new Proxy(baseEmbeddings, {
      get(target, prop, receiver) {
        if (prop === "findSimilar") {
          return async (opts: { table: string; text: string; k: number }) => {
            if (opts.table === "insights") {
              throw new Error("insights search down");
            }
            return target.findSimilar(opts as never);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const out = await buildRagContext("q", { embeddings, db });
    expect(out).toContain("[oracle rec");
    expect(out).toContain("oracle survives");
    expect(out).not.toContain("[insight");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/triage/chat/rag-context.test.ts`
Expected: FAIL — module `src/triage/chat/rag-context.ts` does not exist.

- [ ] **Step 3: Write the implementation**

Create `/Users/vero/openclaw/src/triage/chat/rag-context.ts`:

```ts
import type { Database as DatabaseType } from "better-sqlite3";
import type { EmbeddingService, SimilarRow } from "../../sentinel/embeddings/service.js";

export interface RagContextDeps {
  embeddings: EmbeddingService;
  db: DatabaseType;
}

const RAG_THRESHOLD = 0.5;
const RAG_K_INSIGHTS = 3;
const RAG_K_ORACLE = 2;

interface InsightRow {
  id: number;
  category: string;
  summary: string;
  confidence: number | null;
}

interface OracleRow {
  id: string;
  scope: string;
  title: string;
  urgency: string;
}

async function findSimilarSafe(
  embeddings: EmbeddingService,
  table: "insights" | "oracle_recommendations",
  message: string,
  k: number,
): Promise<SimilarRow[]> {
  try {
    const hits = await embeddings.findSimilar({ table, text: message, k });
    return hits.filter((h) => h.similarity >= RAG_THRESHOLD);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[rag-context] findSimilar(${table}) failed: ${(err as Error).message}`);
    return [];
  }
}

function placeholders(n: number): string {
  return new Array(n).fill("?").join(", ");
}

function formatConfidence(c: number | null): string {
  return c === null ? "n/a" : c.toFixed(2);
}

export async function buildRagContext(message: string, deps: RagContextDeps): Promise<string> {
  try {
    const [insightHits, oracleHits] = await Promise.all([
      findSimilarSafe(deps.embeddings, "insights", message, RAG_K_INSIGHTS),
      findSimilarSafe(deps.embeddings, "oracle_recommendations", message, RAG_K_ORACLE),
    ]);

    if (insightHits.length === 0 && oracleHits.length === 0) {
      return "";
    }

    const lines: string[] = ["Relevant knowledge from JR's memory:"];

    if (insightHits.length > 0) {
      const ids = insightHits.map((h) => h.id as number);
      const rows = deps.db
        .prepare(
          `SELECT id, category, summary, confidence
           FROM insights WHERE id IN (${placeholders(ids.length)})`,
        )
        .all(...ids) as InsightRow[];
      // Preserve similarity-ranked order from the hits list, not DB order.
      const byId = new Map(rows.map((r) => [r.id, r]));
      for (const hit of insightHits) {
        const row = byId.get(hit.id as number);
        if (!row) continue;
        lines.push(
          `- [insight | category=${row.category}, conf=${formatConfidence(row.confidence)}] ${row.summary}`,
        );
      }
    }

    if (oracleHits.length > 0) {
      const ids = oracleHits.map((h) => h.id as string);
      const rows = deps.db
        .prepare(
          `SELECT id, scope, title, urgency
           FROM oracle_recommendations WHERE id IN (${placeholders(ids.length)})`,
        )
        .all(...ids) as OracleRow[];
      const byId = new Map(rows.map((r) => [r.id, r]));
      for (const hit of oracleHits) {
        const row = byId.get(hit.id as string);
        if (!row) continue;
        lines.push(`- [oracle rec | urgency=${row.urgency}] ${row.title}`);
      }
    }

    return lines.join("\n");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[rag-context] build failed: ${(err as Error).message}`);
    return "";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/triage/chat/rag-context.test.ts`
Expected: PASS — 6/6 tests green.

Then run the broader triage + sentinel suites for regression:

Run: `cd /Users/vero/openclaw && npm test -- --run tests/sentinel tests/triage 2>&1 | tail -5`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/vero/openclaw
git add src/triage/chat/rag-context.ts tests/triage/chat/rag-context.test.ts
git commit -m "feat(triage): rag-context module — chat-v2 grounding helper

Pure module. Embed the user message, findSimilar against insights (k=3)
and oracle_recommendations (k=2) in parallel, filter at cosine 0.5,
SELECT rows by id, render a labeled bullet block.

Per-table try/catch so a failure on one table doesn't lose the other's
hits. Outer try/catch as a safety net — any unrecoverable error returns
empty string so the caller can continue with whatever context already
existed. No exceptions ever propagate to the chat handler."
```

---

## Task 3: Wire RAG into the chat handler

**Files:**

- Modify: `/Users/vero/openclaw/src/triage/chat/index.ts`
- Modify: `/Users/vero/openclaw/tests/triage/chat/index.test.ts` (if it exists; otherwise create)

Context: Add two optional deps to `ChatHandlerDeps`, build the RAG block before `reasoner.reason()`, prepend to the existing `convoContext.full`. Oracle short-circuit still bypasses RAG.

- [ ] **Step 1: Check whether `tests/triage/chat/index.test.ts` exists**

Run: `ls /Users/vero/openclaw/tests/triage/chat/index.test.ts 2>&1`

If it does NOT exist, you'll create it in step 2. If it DOES exist, append the new test cases.

- [ ] **Step 2: Write the failing test**

Add (or create the file with) this test:

```ts
import { describe, it, expect, vi } from "vitest";
import { openSentinelDb } from "../../../src/sentinel/db.js";
import { encodeEmbedding } from "../../../src/sentinel/embeddings/blob-codec.js";
import { createEmbeddingService } from "../../../src/sentinel/embeddings/service.js";
import type { GeminiEmbeddingAdapter } from "../../../src/sentinel/embeddings/gemini-adapter.js";
import { handleChatMessage } from "../../../src/triage/chat/index.js";
import type { LlmClient } from "../../../src/triage/llm-client.js";

function unitVector(i: number): Float32Array {
  const v = new Float32Array(768);
  v[i] = 1;
  return v;
}

describe("handleChatMessage — RAG context", () => {
  it("prepends RAG block to contextBlock when embeddings + sentinelDb wired", async () => {
    const db = openSentinelDb(`:memory:?id=${Math.random()}`);
    db.prepare(
      `INSERT INTO insights (category, summary, evidence, generated_at, confidence, embedding)
       VALUES ('operations', 'cancellation rate at 22%', '[]', 1, 0.85, ?)`,
    ).run(encodeEmbedding(unitVector(0)));

    const adapter: GeminiEmbeddingAdapter = {
      async embed() {
        return unitVector(0);
      },
    };
    const embeddings = createEmbeddingService({ db, adapter });

    let capturedPrompt = "";
    const llm: LlmClient = {
      complete: vi.fn(async (prompt: string) => {
        capturedPrompt = prompt;
        // Reasoner response — empty findings, no followups
        if (prompt.includes("Conversation context:")) {
          return JSON.stringify({ findings: [], followups: [] });
        }
        // Responder response
        return "got it";
      }),
    };

    const slackPosts: Array<{ channel: string; text: string }> = [];
    await handleChatMessage(
      {
        userMessage: "what's going on with cancellations?",
        channel: "D12345",
        isDm: true,
      },
      {
        llm,
        slackPost: async (p) => {
          slackPosts.push({ channel: p.channel, text: p.text });
        },
        embeddings,
        sentinelDb: db,
      },
    );

    expect(slackPosts).toHaveLength(1);
    // Reasoner prompt should include the RAG block
    expect(capturedPrompt).toContain("Relevant knowledge from JR's memory:");
    expect(capturedPrompt).toContain("cancellation rate at 22%");
  });

  it("works without embeddings/sentinelDb — falls back to normal flow", async () => {
    const llm: LlmClient = {
      complete: vi.fn(async (prompt: string) => {
        if (prompt.includes("Conversation context:")) {
          return JSON.stringify({ findings: [], followups: [] });
        }
        return "no context reply";
      }),
    };

    const slackPosts: Array<{ channel: string; text: string }> = [];
    await handleChatMessage(
      { userMessage: "hi", channel: "D12345", isDm: true },
      {
        llm,
        slackPost: async (p) => {
          slackPosts.push({ channel: p.channel, text: p.text });
        },
      },
    );

    expect(slackPosts).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/triage/chat/index.test.ts`
Expected: FAIL — `ChatHandlerDeps` doesn't accept `embeddings` or `sentinelDb` yet; or the new test missed assertions.

- [ ] **Step 4: Modify the chat handler**

In `/Users/vero/openclaw/src/triage/chat/index.ts`:

(a) Add imports near the top of the file:

```ts
import type { Database as DatabaseType } from "better-sqlite3";
import type { EmbeddingService } from "../../sentinel/embeddings/service.js";
import { buildRagContext } from "./rag-context.js";
```

(b) Extend `ChatHandlerDeps`:

Locate the existing interface (around line 24-40) and add two optional fields:

```ts
export interface ChatHandlerDeps {
  llm: LlmClient;
  slackPost: (params: { channel: string; thread_ts?: string; text: string }) => Promise<void>;
  fileFollowup?: (f: {
    kind: "dm_person" | "note" | "task";
    payload: Record<string, unknown>;
  }) => Promise<string | null>;
  followupAliases?: string[];
  oracle?: {
    recommendForUser(slackUserId: string): Promise<Recommendation[]>;
  };
  // RAG context: when BOTH present, the handler builds a "Relevant knowledge
  // from JR's memory" block and prepends it to the reasoner's contextBlock.
  // Either missing → behavior unchanged.
  embeddings?: EmbeddingService;
  sentinelDb?: DatabaseType;
}
```

(c) Insert the RAG step. In `handleChatMessage`, after the oracle short-circuit block (currently ends around line 69) and BEFORE `const reasoner = new Reasoner(...)`, add:

Current code around lines 70-78:

```ts
const reasoner = new Reasoner(deps.llm);
const responder = new Responder(deps.llm);

const reasoned = await reasoner.reason({
  userMessage: input.userMessage,
  contextBlock: input.convoContext?.full,
  followups: deps.fileFollowup ? { knownAliases: deps.followupAliases ?? [] } : undefined,
});
```

Replace with:

```ts
const reasoner = new Reasoner(deps.llm);
const responder = new Responder(deps.llm);

// RAG augmentation: pull semantically similar insights + oracle recs and
// prepend to the reasoner's contextBlock. Augmentative-only — any failure
// returns empty string and we proceed with the original context.
let augmentedContext = input.convoContext?.full;
if (deps.embeddings && deps.sentinelDb) {
  const ragBlock = await buildRagContext(input.userMessage, {
    embeddings: deps.embeddings,
    db: deps.sentinelDb,
  });
  if (ragBlock) {
    augmentedContext = augmentedContext ? `${ragBlock}\n\n${augmentedContext}` : ragBlock;
  }
}

const reasoned = await reasoner.reason({
  userMessage: input.userMessage,
  contextBlock: augmentedContext,
  followups: deps.fileFollowup ? { knownAliases: deps.followupAliases ?? [] } : undefined,
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/triage/chat/index.test.ts`
Expected: PASS — both new tests green.

Also run the broader triage + sentinel suites for regression:

Run: `cd /Users/vero/openclaw && npm test -- --run tests/sentinel tests/triage 2>&1 | tail -5`
Expected: All pass.

Run typecheck:

Run: `cd /Users/vero/openclaw && npx tsc --noEmit 2>&1 | grep -v "synthesizer.ts:75" | head -10`
Expected: No new errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/vero/openclaw
git add src/triage/chat/index.ts tests/triage/chat/index.test.ts
git commit -m "feat(triage): chat handler builds RAG context before reasoner

ChatHandlerDeps gains optional embeddings + sentinelDb. When both are
present, handleChatMessage calls buildRagContext(userMessage) before
invoking the reasoner and prepends the result onto convoContext.full.
The reasoner's existing prompt template already includes the
contextBlock channel verbatim — no prompt-template change required.

Either dep missing → original behavior. Oracle intent short-circuit
still bypasses RAG. RAG failures (handled inside buildRagContext)
return empty string so the user always gets a reply."
```

---

## Task 4: Wire RAG deps through triage-bridge + provider

**Files:**

- Modify: `/Users/vero/openclaw/src/slack/monitor/triage-bridge.ts`
- Modify: `/Users/vero/openclaw/src/slack/monitor/provider.ts`

Context: Follow the existing `setTriageOracle` / `oracleSurface` pattern. Add a parallel setter for chat RAG deps, called from the provider after `createSentinel` resolves. The bridge's `routeToChat` (which constructs `ChatHandlerDeps` per inbound message) reads the module-level cache and spreads `embeddings + sentinelDb` into the deps object.

- [ ] **Step 1: Add the setter + cache in triage-bridge.ts**

In `/Users/vero/openclaw/src/slack/monitor/triage-bridge.ts`, locate the existing oracle-setter block (around lines 106-114):

```ts
// F3 Oracle — set once by the provider after createSentinel resolves. The chat
// handler short-circuits on action-recommendation intent when this is wired.
type OracleSurface = {
  recommendForUser(slackUserId: string): Promise<Recommendation[]>;
};
let oracleSurface: OracleSurface | null = null;
export function setTriageOracle(o: OracleSurface): void {
  oracleSurface = o;
}
```

Immediately after that block, add:

```ts
// Chat RAG — set once by the provider after createSentinel resolves. When
// wired, the chat handler prepends retrieved insights + oracle recs to the
// reasoner's contextBlock.
type ChatRagDeps = {
  embeddings: EmbeddingService;
  db: DatabaseType;
};
let chatRagDeps: ChatRagDeps | null = null;
export function setChatRagDeps(d: ChatRagDeps): void {
  chatRagDeps = d;
}
```

Add the required imports at the top of the file (next to existing imports — verify what's already imported and add only the missing pieces):

```ts
import type { Database as DatabaseType } from "better-sqlite3";
import type { EmbeddingService } from "../../sentinel/embeddings/service.js";
```

- [ ] **Step 2: Spread the RAG deps into the chat handler call**

In the same file, locate the `routeToChat` function (around line 334) and the `handleChatMessage` call inside it (around line 340). The current shape includes spreads like `...(oracleSurface ? { oracle: oracleSurface } : {})`.

Add a matching spread for the RAG deps. Find this section (around lines 358-360):

```ts
      ...(oracleSurface ? { oracle: oracleSurface } : {}),
```

Add immediately after:

```ts
      ...(chatRagDeps ? { embeddings: chatRagDeps.embeddings, sentinelDb: chatRagDeps.db } : {}),
```

- [ ] **Step 3: Wire the setter call in provider.ts**

In `/Users/vero/openclaw/src/slack/monitor/provider.ts`, locate the existing `setTriageOracle(sentinel.oracle)` call (around line 462):

```ts
setTriageOracle(sentinel.oracle);
```

Add the import at the top of provider.ts (next to the existing `setTriageOracle` import — verify what's already there and merge):

```ts
import { setChatRagDeps, setTriageOracle, spawnFollowupTask } from "./triage-bridge.js";
```

(If the existing import is already a comma-separated list including `setTriageOracle`, just add `setChatRagDeps` to that list.)

Then add a sibling call immediately after the `setTriageOracle` line:

```ts
setTriageOracle(sentinel.oracle);
setChatRagDeps({ embeddings: sentinel.embeddings, db: sentinel.db });
```

(`sentinel.embeddings` is the field added in Task 1; `sentinel.db` already exists on the surface.)

- [ ] **Step 4: Run full sentinel + triage test suites + typecheck**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/sentinel tests/triage 2>&1 | tail -5`
Expected: All pass.

Run: `cd /Users/vero/openclaw && npx tsc --noEmit 2>&1 | grep -v "synthesizer.ts:75" | head -10`
Expected: No new errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/vero/openclaw
git add src/slack/monitor/triage-bridge.ts src/slack/monitor/provider.ts
git commit -m "feat(slack): wire chat RAG deps through triage-bridge

Mirrors the existing setTriageOracle pattern: module-level cache + a
setter called once by provider.ts after createSentinel resolves. Per
inbound chat message, routeToChat spreads embeddings + sentinelDb into
the handler's deps when the setter has been called.

No-op until both setters are invoked; tests + non-production callers
that don't go through the slack provider stay unaffected."
```

---

## Task 5: Live smoke (operator-driven; do not run autonomously)

**Files:** none modified — verification only.

Context: Final acceptance step. Requires the operator to restart JR and DM a question about a topic with existing high-confidence insights, then visually confirm the reply references the insight content. Stop here and wait for the operator's authorization.

- [ ] **Step 1: Restart JR**

Operator runs:

```bash
launchctl kickstart -k gui/$(id -u)/com.openclaw.agent
sleep 8
lsof -ti:18789
```

Expected: a single PID listening on 18789 (the gateway).

- [ ] **Step 2: Pick a known insight to test against**

Operator runs:

```bash
sqlite3 -header -column ~/.openclaw/sentinel.db "SELECT id, category, substr(summary, 1, 80) AS summary, confidence FROM insights WHERE confidence > 0.7 ORDER BY generated_at DESC LIMIT 5;"
```

Pick one (e.g., "22% project cancellation rate"). Note its phrasing.

- [ ] **Step 3: DM JR a question about that topic**

Operator opens Slack, DMs JR a question phrased differently from the insight (e.g., the insight says "22% cancellation rate" — ask JR "what's been going on with cancellations recently?"). Use phrasing that wouldn't trigger the oracle action-recommendation intent (avoid "what should I do", "on my plate", etc.).

Watch for the reply.

- [ ] **Step 4: Verify the reply cites the insight content**

Expected: JR's reply references the substance of the insight (e.g., mentions "22%", "cancellation rate", or the root-cause angle). Compare to a control: previously, JR would answer generically.

- [ ] **Step 5: Verify no errors in the gateway log**

Operator runs:

```bash
grep -E "rag-context|chat.*failed" /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log | tail -10
```

Expected: empty, or only benign warnings (e.g., one-off `[rag-context] findSimilar(insights) failed` should NOT appear under normal conditions).

- [ ] **Step 6: Open the PR**

Once the smoke passes, push the branch and open a PR:

```bash
cd /Users/vero/openclaw
git push -u origin feat/chat-v2-rag-context
gh pr create --title "Chat-v2 RAG context — ground replies in JR's accumulated knowledge" --body "..."
```

(Body summarizing the spec + smoke results.)

---

## Self-review (controller did before handoff)

**Spec coverage check:**

| Spec section                                                                                    | Task   |
| ----------------------------------------------------------------------------------------------- | ------ |
| Module `rag-context.ts` (public surface, constants, flow, error handling)                       | Task 2 |
| Chat handler wiring (ChatHandlerDeps extension, RAG block prepend)                              | Task 3 |
| Slack monitor wiring (setChatRagDeps setter, provider invocation)                               | Task 4 |
| Sentinel surface exposing `embeddings` (implicit prerequisite for Task 4)                       | Task 1 |
| Test coverage: threshold, k cap, ordering, empty result, format, partial failure, total failure | Task 2 |
| Test coverage: chat handler prepends RAG, behaves unchanged without deps                        | Task 3 |
| Acceptance criteria: manual smoke confirms reply cites insight                                  | Task 5 |

**Placeholder scan:** None — every code block is complete.

**Type consistency:**

- `RagContextDeps` consistent across Tasks 2, 3.
- `EmbeddingService` import path consistent (`"../../sentinel/embeddings/service.js"`).
- `setChatRagDeps`'s argument type matches the `chatRagDeps` cache type.
- `sentinel.embeddings` field added in Task 1 is the same one consumed in Task 4.
- `ChatHandlerDeps.sentinelDb` is the `DatabaseType` shared across the codebase.

---

## Execution

**Plan complete. Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review (spec + quality) between tasks.
2. **Inline Execution** — execute tasks in this session via `superpowers:executing-plans`.
