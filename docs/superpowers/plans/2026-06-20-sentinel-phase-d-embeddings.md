# Sentinel Phase D — Embedding Semantic Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed observations, insights, and oracle_recommendations using Gemini `text-embedding-004` and expose a `findSimilar()` helper so the oracle can do semantic dedup (and any future module can do similarity queries).

**Architecture:** A standalone `EmbeddingService` wraps the Gemini SDK + a BLOB-per-row storage schema + in-memory cosine indexes. Service constructs synchronously by loading all existing embeddings into per-table `Map`s; new writes go through `embedAndStore`. Oracle integration partitions per-cycle LLM recs into merge-into-existing (cosine ≥ 0.85 within 14 days) vs fresh-insert. One backfill script seeds existing rows once.

**Tech Stack:** TypeScript, `better-sqlite3`, `@google/genai` (already a dep), Float32Array.

**Branch:** Continue on `cleanup/phase-6-sentinel-jr-phase-a` (PR #8 already in flight; embeddings layer onto the same branch since it builds on Phase D.1 Oracle).

**Spec:** `docs/superpowers/specs/2026-06-19-sentinel-phase-d-embeddings-design.md`

---

## Task 1: Blob codec (Float32Array ↔ Buffer)

**Files:**

- Create: `src/sentinel/embeddings/blob-codec.ts`
- Test: `tests/sentinel/embeddings/blob-codec.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/sentinel/embeddings/blob-codec.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  encodeEmbedding,
  decodeEmbedding,
  EMBEDDING_DIM,
} from "../../../src/sentinel/embeddings/blob-codec.js";

describe("blob-codec", () => {
  it("EMBEDDING_DIM is 768", () => {
    expect(EMBEDDING_DIM).toBe(768);
  });

  it("round-trips a Float32Array of length 768 byte-for-byte", () => {
    const original = new Float32Array(EMBEDDING_DIM);
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      original[i] = i * 0.001 - 0.5;
    }
    const buf = encodeEmbedding(original);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBe(EMBEDDING_DIM * 4);
    const restored = decodeEmbedding(buf);
    expect(restored).toBeInstanceOf(Float32Array);
    expect(restored.length).toBe(EMBEDDING_DIM);
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      expect(restored[i]).toBe(original[i]);
    }
  });

  it("rejects encode of a wrong-length vector", () => {
    const bad = new Float32Array(512);
    expect(() => encodeEmbedding(bad)).toThrow(/length/);
  });

  it("rejects decode of a wrong-length buffer", () => {
    const bad = Buffer.alloc(EMBEDDING_DIM * 4 - 4); // off by one float
    expect(() => decodeEmbedding(bad)).toThrow(/length/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/sentinel/embeddings/blob-codec.test.ts`
Expected: FAIL — file `src/sentinel/embeddings/blob-codec.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/sentinel/embeddings/blob-codec.ts`:

```ts
export const EMBEDDING_DIM = 768;

export function encodeEmbedding(v: Float32Array): Buffer {
  if (v.length !== EMBEDDING_DIM) {
    throw new Error(
      `encodeEmbedding: expected Float32Array of length ${EMBEDDING_DIM}, got ${v.length}`,
    );
  }
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

export function decodeEmbedding(buf: Buffer): Float32Array {
  if (buf.length !== EMBEDDING_DIM * 4) {
    throw new Error(
      `decodeEmbedding: expected buffer of length ${EMBEDDING_DIM * 4}, got ${buf.length}`,
    );
  }
  // Copy into a fresh ArrayBuffer so the Float32Array isn't aliased to the
  // pooled Node Buffer slab (which may be reused under us by downstream code).
  const ab = new ArrayBuffer(buf.length);
  Buffer.from(ab).set(buf);
  return new Float32Array(ab);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/sentinel/embeddings/blob-codec.test.ts`
Expected: PASS — 4/4 tests green.

- [ ] **Step 5: Commit**

```bash
cd /Users/vero/openclaw
git add src/sentinel/embeddings/blob-codec.ts tests/sentinel/embeddings/blob-codec.test.ts
git commit -m "feat(sentinel): embedding blob codec (Float32Array ↔ Buffer)

768-dim Float32Array round-trips through Buffer for SQLite BLOB storage.
Defensive: copies into a fresh ArrayBuffer on decode so the returned
Float32Array isn't aliased to a Node Buffer slab that may be reused
under us by downstream code. Validates length on both encode and decode."
```

---

## Task 2: Cosine similarity

**Files:**

- Create: `src/sentinel/embeddings/cosine.ts`
- Test: `tests/sentinel/embeddings/cosine.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/sentinel/embeddings/cosine.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { cosineSimilarity } from "../../../src/sentinel/embeddings/cosine.js";

describe("cosineSimilarity", () => {
  it("returns 1 for identical unit vectors", () => {
    const a = new Float32Array([1, 0, 0]);
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 6);
  });

  it("returns 0 for orthogonal vectors", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 6);
  });

  it("returns -1 for opposite vectors", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([-1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 6);
  });

  it("ranks similar vectors above dissimilar ones", () => {
    const a = new Float32Array([1, 0, 0]);
    const close = new Float32Array([0.9, 0.1, 0]);
    const far = new Float32Array([0.1, 0.9, 0]);
    expect(cosineSimilarity(a, close)).toBeGreaterThan(cosineSimilarity(a, far));
  });

  it("returns 0 when either input has zero magnitude", () => {
    const z = new Float32Array([0, 0, 0]);
    const a = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(z, a)).toBe(0);
    expect(cosineSimilarity(a, z)).toBe(0);
  });

  it("throws on length mismatch", () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([1, 0, 0]);
    expect(() => cosineSimilarity(a, b)).toThrow(/length/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/sentinel/embeddings/cosine.test.ts`
Expected: FAIL — file does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `src/sentinel/embeddings/cosine.ts`:

```ts
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`cosineSimilarity: length mismatch (${a.length} vs ${b.length})`);
  }
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    magA += x * x;
    magB += y * y;
  }
  if (magA === 0 || magB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/sentinel/embeddings/cosine.test.ts`
Expected: PASS — 6/6 tests green.

- [ ] **Step 5: Commit**

```bash
cd /Users/vero/openclaw
git add src/sentinel/embeddings/cosine.ts tests/sentinel/embeddings/cosine.test.ts
git commit -m "feat(sentinel): cosine similarity for embedding vectors

Standard dot-product / magnitude formula. Returns 0 when either input
has zero magnitude (degenerate but valid). Length-mismatch throws —
caller is always either comparing two 768-dim vectors or has a bug."
```

---

## Task 3: Schema migration (add embedding column to insights + oracle_recommendations)

**Files:**

- Modify: `src/sentinel/db.ts` (SCHEMA_SQL + post-exec ALTER block in `openSentinelDb`)
- Test: `tests/sentinel/embeddings/schema.test.ts`

Context: `observations` already has the `embedding BLOB` column in the live DB and in `SCHEMA_SQL`. `insights` and `oracle_recommendations` need both: (a) the column added to `SCHEMA_SQL` for fresh installs, and (b) an idempotent `ALTER TABLE ... ADD COLUMN` for the existing live DB (where the table was created before this column).

- [ ] **Step 1: Write the failing test**

Create `tests/sentinel/embeddings/schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { openSentinelDb } from "../../../src/sentinel/db.js";

describe("sentinel schema — embedding columns", () => {
  it("fresh install has embedding BLOB on all three target tables", () => {
    const db = openSentinelDb(":memory:");
    try {
      const obsCols = db.prepare("PRAGMA table_info(observations)").all() as Array<{
        name: string;
        type: string;
      }>;
      const insCols = db.prepare("PRAGMA table_info(insights)").all() as Array<{
        name: string;
        type: string;
      }>;
      const recCols = db.prepare("PRAGMA table_info(oracle_recommendations)").all() as Array<{
        name: string;
        type: string;
      }>;
      expect(obsCols.find((c) => c.name === "embedding")?.type).toBe("BLOB");
      expect(insCols.find((c) => c.name === "embedding")?.type).toBe("BLOB");
      expect(recCols.find((c) => c.name === "embedding")?.type).toBe("BLOB");
    } finally {
      db.close();
    }
  });

  it("running openSentinelDb twice on the same path is idempotent (no duplicate-column error)", () => {
    const path = `/tmp/sentinel-schema-test-${Date.now()}.db`;
    let db1: ReturnType<typeof openSentinelDb> | null = null;
    let db2: ReturnType<typeof openSentinelDb> | null = null;
    try {
      db1 = openSentinelDb(path);
      db1.close();
      // Re-open: ALTER TABLE statements should swallow "duplicate column" cleanly.
      db2 = openSentinelDb(path);
      const recCols = db2.prepare("PRAGMA table_info(oracle_recommendations)").all() as Array<{
        name: string;
      }>;
      expect(recCols.find((c) => c.name === "embedding")).toBeDefined();
    } finally {
      if (db2?.open) db2.close();
      if (db1?.open) db1.close();
      try {
        require("node:fs").unlinkSync(path);
      } catch {
        /* ignore */
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/sentinel/embeddings/schema.test.ts`
Expected: FAIL — `insights` and `oracle_recommendations` do not have the `embedding` column.

- [ ] **Step 3: Modify `src/sentinel/db.ts`**

In `SCHEMA_SQL`, add `embedding BLOB` to the `insights` CREATE TABLE (after `filed_to`):

```
CREATE TABLE IF NOT EXISTS insights (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  category        TEXT NOT NULL,
  summary         TEXT NOT NULL,
  evidence        TEXT NOT NULL,
  derived_from    TEXT,
  confidence      REAL,
  generated_at    INTEGER NOT NULL,
  superseded_by   INTEGER REFERENCES insights(id),
  filed_to        TEXT,
  embedding       BLOB
);
```

In `SCHEMA_SQL`, add `embedding BLOB` to the `oracle_recommendations` CREATE TABLE (after `dismissed_at`):

```
CREATE TABLE IF NOT EXISTS oracle_recommendations (
  id                TEXT PRIMARY KEY,
  assignee_email    TEXT NOT NULL,
  assignee_slack_id TEXT,
  title             TEXT NOT NULL,
  rationale         TEXT NOT NULL,
  evidence          TEXT NOT NULL,
  scope             TEXT NOT NULL,
  urgency           TEXT NOT NULL,
  confidence        TEXT NOT NULL,
  data              TEXT NOT NULL,
  first_seen_at     INTEGER NOT NULL,
  last_seen_at      INTEGER NOT NULL,
  dismissed_at      INTEGER,
  embedding         BLOB
);
```

After `db.exec(SCHEMA_SQL)` in `openSentinelDb`, insert this idempotent migration block (lines 163-164 area):

```ts
db.exec(SCHEMA_SQL);

// Idempotent ALTER TABLE migrations for installs that pre-date these
// columns. SQLite has no IF NOT EXISTS for ADD COLUMN; we swallow the
// "duplicate column name" error so re-running on a fresh schema is a no-op.
for (const table of ["observations", "insights", "oracle_recommendations"]) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN embedding BLOB`);
  } catch (err) {
    const msg = (err as Error).message;
    if (!/duplicate column name: embedding/.test(msg)) {
      throw err;
    }
  }
}

connections.set(path, db);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/sentinel/embeddings/schema.test.ts`
Expected: PASS — both tests green.

Also run the full sentinel test suite to confirm no regression:

Run: `cd /Users/vero/openclaw && npm test -- --run tests/sentinel/ 2>&1 | tail -10`
Expected: All tests pass (Phase D.1 oracle tests + everything else).

- [ ] **Step 5: Commit**

```bash
cd /Users/vero/openclaw
git add src/sentinel/db.ts tests/sentinel/embeddings/schema.test.ts
git commit -m "feat(sentinel): embedding BLOB column on insights + oracle_recommendations

Adds the column to SCHEMA_SQL for fresh installs and runs an idempotent
ALTER TABLE block after db.exec for existing installs. Swallows the
'duplicate column name' error so re-runs on a fresh schema are no-ops.

observations already had the column; included in the ALTER loop for
symmetry — the error swallowing handles the already-exists case."
```

---

## Task 4: Gemini embedding adapter

**Files:**

- Create: `src/sentinel/embeddings/gemini-adapter.ts`
- Test: `tests/sentinel/embeddings/gemini-adapter.test.ts`

Context: Wraps `@google/genai` `embedContent` call. Returns a `Float32Array(768)`. Test seam — the service consumes the `GeminiEmbeddingAdapter` interface, not this concrete class.

- [ ] **Step 1: Write the failing test**

Create `tests/sentinel/embeddings/gemini-adapter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createGeminiAdapterFromClient } from "../../../src/sentinel/embeddings/gemini-adapter.js";

describe("gemini-adapter", () => {
  it("delegates to client.models.embedContent and returns the 768-dim vector", async () => {
    const captured: Array<{ model: string; contents: unknown }> = [];
    const fakeClient = {
      models: {
        async embedContent(req: { model: string; contents: unknown }) {
          captured.push(req);
          const values = new Array(768).fill(0).map((_, i) => i / 768);
          return { embeddings: [{ values }] };
        },
      },
    };
    const adapter = createGeminiAdapterFromClient(fakeClient as never);
    const v = await adapter.embed("hello world");
    expect(v).toBeInstanceOf(Float32Array);
    expect(v.length).toBe(768);
    expect(v[0]).toBeCloseTo(0, 6);
    expect(v[767]).toBeCloseTo(767 / 768, 6);
    expect(captured).toHaveLength(1);
    expect(captured[0].model).toBe("text-embedding-004");
  });

  it("throws when the response is missing values", async () => {
    const fakeClient = {
      models: {
        async embedContent() {
          return { embeddings: [{ values: undefined }] };
        },
      },
    };
    const adapter = createGeminiAdapterFromClient(fakeClient as never);
    await expect(adapter.embed("anything")).rejects.toThrow(/values/);
  });

  it("throws when the response vector is the wrong length", async () => {
    const fakeClient = {
      models: {
        async embedContent() {
          return { embeddings: [{ values: [1, 2, 3] }] };
        },
      },
    };
    const adapter = createGeminiAdapterFromClient(fakeClient as never);
    await expect(adapter.embed("anything")).rejects.toThrow(/expected 768/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/sentinel/embeddings/gemini-adapter.test.ts`
Expected: FAIL — file does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `src/sentinel/embeddings/gemini-adapter.ts`:

```ts
import { EMBEDDING_DIM } from "./blob-codec.js";

export interface GeminiEmbeddingAdapter {
  embed(text: string): Promise<Float32Array>;
}

// Minimum surface we need from @google/genai. Typed loosely so test fakes
// can supply just this shape without depending on the full SDK type tree.
interface MinimalGenAIClient {
  models: {
    embedContent(req: {
      model: string;
      contents: unknown;
    }): Promise<{ embeddings?: Array<{ values?: number[] }> }>;
  };
}

const EMBEDDING_MODEL = "text-embedding-004";

export function createGeminiAdapterFromClient(client: MinimalGenAIClient): GeminiEmbeddingAdapter {
  return {
    async embed(text: string): Promise<Float32Array> {
      const resp = await client.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: text,
      });
      const values = resp.embeddings?.[0]?.values;
      if (!Array.isArray(values)) {
        throw new Error("gemini-adapter: response missing embeddings[0].values");
      }
      if (values.length !== EMBEDDING_DIM) {
        throw new Error(`gemini-adapter: expected ${EMBEDDING_DIM} values, got ${values.length}`);
      }
      return Float32Array.from(values);
    },
  };
}

export async function createDefaultGeminiAdapter(): Promise<GeminiEmbeddingAdapter> {
  const { GoogleGenAI } = await import("@google/genai");
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not set; cannot construct default Gemini embedding adapter");
  }
  const client = new GoogleGenAI({ apiKey });
  return createGeminiAdapterFromClient(client as unknown as MinimalGenAIClient);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/sentinel/embeddings/gemini-adapter.test.ts`
Expected: PASS — 3/3 green.

- [ ] **Step 5: Commit**

```bash
cd /Users/vero/openclaw
git add src/sentinel/embeddings/gemini-adapter.ts tests/sentinel/embeddings/gemini-adapter.test.ts
git commit -m "feat(sentinel): Gemini text-embedding-004 adapter

Thin wrapper over @google/genai's embedContent. createGeminiAdapterFromClient
takes an injected client (test seam); createDefaultGeminiAdapter constructs
the real one from GEMINI_API_KEY — same env var the external-context
observer uses, no new credential.

Validates response shape + dimension so a model id typo doesn't silently
produce a wrong-dim vector that breaks the in-memory index later."
```

---

## Task 5: EmbeddingService (hydrates indexes, exposes embed/findSimilar/embedAndStore)

**Files:**

- Create: `src/sentinel/embeddings/service.ts`
- Test: `tests/sentinel/embeddings/service.test.ts`

Context: This is the central module that downstream consumers see. It owns three in-memory `Map`s (one per table) and a parallel timestamps map for the `sinceMs` filter. Hydration is synchronous (one SELECT per table at construction).

- [ ] **Step 1: Write the failing test**

Create `tests/sentinel/embeddings/service.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { openSentinelDb } from "../../../src/sentinel/db.js";
import { createEmbeddingService } from "../../../src/sentinel/embeddings/service.js";
import { encodeEmbedding } from "../../../src/sentinel/embeddings/blob-codec.js";
import type { GeminiEmbeddingAdapter } from "../../../src/sentinel/embeddings/gemini-adapter.js";

function unitVector(index: number, dim = 768): Float32Array {
  const v = new Float32Array(dim);
  v[index] = 1;
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

describe("EmbeddingService", () => {
  let db: ReturnType<typeof openSentinelDb>;

  beforeEach(() => {
    db = openSentinelDb(`:memory:?id=${Math.random()}`);
  });

  it("hydrates existing embeddings from the DB at construction", () => {
    db.prepare(
      `INSERT INTO observations (source, topic, timestamp, summary, embedding, created_at)
       VALUES ('test', 't', 1, 'a', ?, 1)`,
    ).run(encodeEmbedding(unitVector(0)));
    db.prepare(
      `INSERT INTO observations (source, topic, timestamp, summary, embedding, created_at)
       VALUES ('test', 't', 2, 'b', ?, 2)`,
    ).run(encodeEmbedding(unitVector(1)));

    const adapter = makeAdapter(new Map());
    const svc = createEmbeddingService({ db, adapter });

    // Internal verification: findSimilar should return both rows
    // (we use unit-basis vectors so the rank order is deterministic).
    return svc
      .findSimilar({ table: "observations", text: "a", k: 5 })
      .then((rows) => {
        // No canned vector for "a" — adapter throws — but the findSimilar
        // implementation embeds the *query* via adapter, so we need a canned
        // vector for it. We'll cover that in the next test; here we just
        // confirm the hydration completed without throwing.
      })
      .catch((err) => {
        expect(String(err.message)).toMatch(/no canned vector/);
      });
  });

  it("findSimilar embeds the query and returns ranked hits", async () => {
    db.prepare(
      `INSERT INTO observations (source, topic, timestamp, summary, embedding, created_at)
       VALUES ('test', 't', 1, 'close', ?, 1)`,
    ).run(encodeEmbedding(unitVector(0)));
    db.prepare(
      `INSERT INTO observations (source, topic, timestamp, summary, embedding, created_at)
       VALUES ('test', 't', 2, 'orthogonal', ?, 2)`,
    ).run(encodeEmbedding(unitVector(1)));

    const adapter = makeAdapter(new Map([["query", unitVector(0)]]));
    const svc = createEmbeddingService({ db, adapter });

    const hits = await svc.findSimilar({ table: "observations", text: "query", k: 5 });
    expect(hits.length).toBe(2);
    expect(hits[0].similarity).toBeCloseTo(1, 6);
    expect(hits[1].similarity).toBeCloseTo(0, 6);
    expect(hits[0].id).toBe(1);
    expect(hits[1].id).toBe(2);
  });

  it("findSimilar caps to k", async () => {
    for (let i = 0; i < 5; i++) {
      db.prepare(
        `INSERT INTO observations (source, topic, timestamp, summary, embedding, created_at)
         VALUES ('test', 't', ?, ?, ?, 1)`,
      ).run(i + 1, `row${i}`, encodeEmbedding(unitVector(i)));
    }
    const adapter = makeAdapter(new Map([["q", unitVector(0)]]));
    const svc = createEmbeddingService({ db, adapter });
    const hits = await svc.findSimilar({ table: "observations", text: "q", k: 2 });
    expect(hits.length).toBe(2);
  });

  it("findSimilar honors sinceMs cutoff against observations.timestamp", async () => {
    db.prepare(
      `INSERT INTO observations (source, topic, timestamp, summary, embedding, created_at)
       VALUES ('test', 't', ?, 'old', ?, 1)`,
    ).run(1000, encodeEmbedding(unitVector(0)));
    db.prepare(
      `INSERT INTO observations (source, topic, timestamp, summary, embedding, created_at)
       VALUES ('test', 't', ?, 'new', ?, 1)`,
    ).run(5000, encodeEmbedding(unitVector(0)));

    const adapter = makeAdapter(new Map([["q", unitVector(0)]]));
    const svc = createEmbeddingService({ db, adapter });

    const recent = await svc.findSimilar({ table: "observations", text: "q", k: 5, sinceMs: 2000 });
    expect(recent.length).toBe(1);
    expect(recent[0].id).toBe(2);
  });

  it("findSimilar excludes rows where embedding IS NULL", async () => {
    db.prepare(
      `INSERT INTO observations (source, topic, timestamp, summary, embedding, created_at)
       VALUES ('test', 't', 1, 'embedded', ?, 1)`,
    ).run(encodeEmbedding(unitVector(0)));
    db.prepare(
      `INSERT INTO observations (source, topic, timestamp, summary, embedding, created_at)
       VALUES ('test', 't', 2, 'not-embedded', NULL, 1)`,
    ).run();

    const adapter = makeAdapter(new Map([["q", unitVector(0)]]));
    const svc = createEmbeddingService({ db, adapter });
    const hits = await svc.findSimilar({ table: "observations", text: "q", k: 5 });
    expect(hits.length).toBe(1);
    expect(hits[0].id).toBe(1);
  });

  it("embedAndStore writes the blob, updates the index, is idempotent", async () => {
    db.prepare(
      `INSERT INTO observations (source, topic, timestamp, summary, created_at)
       VALUES ('test', 't', 1, 'unembedded', 1)`,
    ).run();

    const adapter = makeAdapter(new Map([["unembedded", unitVector(3)]]));
    const svc = createEmbeddingService({ db, adapter });

    await svc.embedAndStore("observations", 1, "unembedded");
    const row = db.prepare("SELECT embedding FROM observations WHERE id = 1").get() as {
      embedding: Buffer | null;
    };
    expect(row.embedding).not.toBeNull();
    expect(row.embedding!.length).toBe(768 * 4);

    // Idempotent: a second call is a no-op (would otherwise throw because
    // the adapter has only one canned entry; we re-use it but the impl
    // should short-circuit). We assert by stripping the adapter and re-calling.
    const noAdapter = makeAdapter(new Map());
    const svc2 = createEmbeddingService({ db, adapter: noAdapter });
    await expect(svc2.embedAndStore("observations", 1, "unembedded")).resolves.toBeUndefined();
  });

  it("embedAndStore swallows adapter failure and leaves the row unembedded", async () => {
    db.prepare(
      `INSERT INTO observations (source, topic, timestamp, summary, created_at)
       VALUES ('test', 't', 1, 'will-fail', 1)`,
    ).run();
    const failing: GeminiEmbeddingAdapter = {
      async embed() {
        throw new Error("boom");
      },
    };
    const svc = createEmbeddingService({ db, adapter: failing });
    await expect(svc.embedAndStore("observations", 1, "will-fail")).resolves.toBeUndefined();
    const row = db.prepare("SELECT embedding FROM observations WHERE id = 1").get() as {
      embedding: Buffer | null;
    };
    expect(row.embedding).toBeNull();
  });

  it("oracle_recommendations uses last_seen_at as the timestamp column", async () => {
    db.prepare(
      `INSERT INTO oracle_recommendations
       (id, assignee_email, title, rationale, evidence, scope, urgency, confidence, data, first_seen_at, last_seen_at, embedding)
       VALUES ('a', 'x@example.com', 't', 'r', '[]', 'ops', 'high', 'high', '{}', 1, ?, ?)`,
    ).run(1000, encodeEmbedding(unitVector(0)));
    db.prepare(
      `INSERT INTO oracle_recommendations
       (id, assignee_email, title, rationale, evidence, scope, urgency, confidence, data, first_seen_at, last_seen_at, embedding)
       VALUES ('b', 'x@example.com', 't', 'r', '[]', 'ops', 'high', 'high', '{}', 1, ?, ?)`,
    ).run(5000, encodeEmbedding(unitVector(0)));

    const adapter = makeAdapter(new Map([["q", unitVector(0)]]));
    const svc = createEmbeddingService({ db, adapter });
    const recent = await svc.findSimilar({
      table: "oracle_recommendations",
      text: "q",
      k: 5,
      sinceMs: 2000,
    });
    expect(recent.length).toBe(1);
    expect(recent[0].id).toBe("b");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/sentinel/embeddings/service.test.ts`
Expected: FAIL — `src/sentinel/embeddings/service.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `src/sentinel/embeddings/service.ts`:

```ts
import type { Database as DatabaseType } from "better-sqlite3";
import { cosineSimilarity } from "./cosine.js";
import { decodeEmbedding, encodeEmbedding } from "./blob-codec.js";
import type { GeminiEmbeddingAdapter } from "./gemini-adapter.js";

export type EmbeddedTable = "observations" | "insights" | "oracle_recommendations";

export interface FindSimilarOpts {
  table: EmbeddedTable;
  text: string;
  k: number;
  sinceMs?: number;
}

export interface SimilarRow {
  id: string | number;
  similarity: number;
}

export interface EmbeddingService {
  embed(text: string): Promise<Float32Array>;
  findSimilar(opts: FindSimilarOpts): Promise<SimilarRow[]>;
  embedAndStore(table: EmbeddedTable, id: string | number, text: string): Promise<void>;
}

export interface EmbeddingServiceDeps {
  db: DatabaseType;
  adapter: GeminiEmbeddingAdapter;
}

interface TableConfig {
  table: EmbeddedTable;
  timestampColumn: string;
  idColumn: string;
}

const TABLE_CONFIGS: Record<EmbeddedTable, TableConfig> = {
  observations: { table: "observations", timestampColumn: "timestamp", idColumn: "id" },
  insights: { table: "insights", timestampColumn: "generated_at", idColumn: "id" },
  oracle_recommendations: {
    table: "oracle_recommendations",
    timestampColumn: "last_seen_at",
    idColumn: "id",
  },
};

interface TableIndex {
  embeddings: Map<string | number, Float32Array>;
  timestamps: Map<string | number, number>;
}

export function createEmbeddingService(deps: EmbeddingServiceDeps): EmbeddingService {
  const indexes: Record<EmbeddedTable, TableIndex> = {
    observations: { embeddings: new Map(), timestamps: new Map() },
    insights: { embeddings: new Map(), timestamps: new Map() },
    oracle_recommendations: { embeddings: new Map(), timestamps: new Map() },
  };

  // Hydrate every index from the DB at construction. One SELECT per table.
  for (const cfg of Object.values(TABLE_CONFIGS)) {
    const rows = deps.db
      .prepare(
        `SELECT ${cfg.idColumn} AS id, ${cfg.timestampColumn} AS ts, embedding
         FROM ${cfg.table}
         WHERE embedding IS NOT NULL`,
      )
      .all() as Array<{ id: string | number; ts: number; embedding: Buffer }>;
    for (const r of rows) {
      try {
        const v = decodeEmbedding(r.embedding);
        indexes[cfg.table].embeddings.set(r.id, v);
        indexes[cfg.table].timestamps.set(r.id, r.ts);
      } catch {
        // Mismatched dim (probably a stale model rollout). Skip — the row
        // stays in the DB but is invisible to findSimilar until re-embedded.
      }
    }
  }

  async function embed(text: string): Promise<Float32Array> {
    return deps.adapter.embed(text);
  }

  async function findSimilar(opts: FindSimilarOpts): Promise<SimilarRow[]> {
    const idx = indexes[opts.table];
    const target = await embed(opts.text);
    const cutoff = opts.sinceMs ?? -Infinity;
    const scored: SimilarRow[] = [];
    for (const [id, v] of idx.embeddings.entries()) {
      const ts = idx.timestamps.get(id) ?? 0;
      if (ts < cutoff) {
        continue;
      }
      scored.push({ id, similarity: cosineSimilarity(target, v) });
    }
    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, opts.k);
  }

  async function embedAndStore(
    table: EmbeddedTable,
    id: string | number,
    text: string,
  ): Promise<void> {
    const idx = indexes[table];
    if (idx.embeddings.has(id)) {
      return;
    }
    let v: Float32Array;
    try {
      v = await deps.adapter.embed(text);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[embeddings] embedAndStore failed for ${table}#${id}: ${(err as Error).message}`,
      );
      return;
    }
    const cfg = TABLE_CONFIGS[table];
    deps.db
      .prepare(`UPDATE ${cfg.table} SET embedding = ? WHERE ${cfg.idColumn} = ?`)
      .run(encodeEmbedding(v), id);
    const tsRow = deps.db
      .prepare(`SELECT ${cfg.timestampColumn} AS ts FROM ${cfg.table} WHERE ${cfg.idColumn} = ?`)
      .get(id) as { ts: number } | undefined;
    idx.embeddings.set(id, v);
    if (tsRow) {
      idx.timestamps.set(id, tsRow.ts);
    }
  }

  return { embed, findSimilar, embedAndStore };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/sentinel/embeddings/service.test.ts`
Expected: PASS — all 8 tests green.

Also run the full embeddings folder + sentinel suite for regression:

Run: `cd /Users/vero/openclaw && npm test -- --run tests/sentinel/embeddings tests/sentinel/oracle 2>&1 | tail -10`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/vero/openclaw
git add src/sentinel/embeddings/service.ts tests/sentinel/embeddings/service.test.ts
git commit -m "feat(sentinel): EmbeddingService with in-memory cosine indexes

Hydrates one Map per embedded table at construction (single SELECT per
table). embed delegates to the adapter; findSimilar embeds the query
then brute-force ranks against the in-memory index with an optional
sinceMs cutoff against the table's timestamp column; embedAndStore is
idempotent and swallows adapter failures (row stays NULL until nightly
backfill retries).

Per-table config picks the right timestamp column:
- observations.timestamp
- insights.generated_at
- oracle_recommendations.last_seen_at"
```

---

## Task 6: OracleStore mergeInto method

**Files:**

- Modify: `src/sentinel/oracle/store.ts`
- Test: `tests/sentinel/oracle/store.test.ts` (may need to create — check first)

Context: The dedup integration in Task 7 needs to merge a new rec into an existing row: bump `last_seen_at`, union the `evidence` arrays, keep `first_seen_at` untouched.

- [ ] **Step 1: Read current OracleStore**

Run: `cd /Users/vero/openclaw && cat src/sentinel/oracle/store.ts`

Confirm the exact class shape and existing methods (`upsertAll`, `diffNewForAssignee`, `queryAllForAssignee`, `markDMsSent`). Note the column names and the prepared statements pattern used.

- [ ] **Step 2: Write the failing test**

If `tests/sentinel/oracle/store.test.ts` doesn't exist, create it. If it does, append the new tests below to the existing `describe` block.

Add this test (assumes the file exists with imports already wired):

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { openSentinelDb } from "../../../src/sentinel/db.js";
import { OracleStore, type Recommendation } from "../../../src/sentinel/oracle/store.js";

describe("OracleStore.mergeInto", () => {
  let db: ReturnType<typeof openSentinelDb>;

  beforeEach(() => {
    db = openSentinelDb(`:memory:?id=${Math.random()}`);
  });

  function rec(overrides: Partial<Recommendation> = {}): Recommendation {
    return {
      id: "ABC123",
      title: "default title",
      rationale: "default rationale",
      evidence: ["obs:1", "obs:2"],
      assignee_email: "x@example.com",
      assignee_slack_id: null,
      scope: "ops",
      urgency: "high",
      confidence: "high",
      generated_at: 1000,
      ...overrides,
    };
  }

  it("merges new rec into existing row: last_seen_at advances, first_seen_at preserved, evidence unioned", () => {
    const store = new OracleStore(db);
    const existing = rec({ id: "abc", evidence: ["obs:1", "obs:2"], generated_at: 1000 });
    store.upsertAll([existing]);

    const incoming = rec({
      id: "different-but-merging-into-abc",
      evidence: ["obs:2", "obs:3", "insight:7"],
      generated_at: 5000,
    });
    store.mergeInto("abc", incoming);

    const row = db
      .prepare(
        "SELECT id, first_seen_at, last_seen_at, evidence FROM oracle_recommendations WHERE id = 'abc'",
      )
      .get() as { id: string; first_seen_at: number; last_seen_at: number; evidence: string };
    expect(row.first_seen_at).toBe(1000);
    expect(row.last_seen_at).toBe(5000);
    const evidenceUnion = JSON.parse(row.evidence) as string[];
    expect(new Set(evidenceUnion)).toEqual(new Set(["obs:1", "obs:2", "obs:3", "insight:7"]));
  });

  it("is a no-op if the target id does not exist", () => {
    const store = new OracleStore(db);
    const incoming = rec({ id: "anything", generated_at: 9999 });
    expect(() => store.mergeInto("does-not-exist", incoming)).not.toThrow();
    const row = db
      .prepare("SELECT id FROM oracle_recommendations WHERE id = 'does-not-exist'")
      .get();
    expect(row).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/sentinel/oracle/store.test.ts`
Expected: FAIL — `mergeInto` does not exist on `OracleStore`.

- [ ] **Step 4: Implement `mergeInto` on `OracleStore`**

In `src/sentinel/oracle/store.ts`, add this method to the `OracleStore` class (alongside the existing methods):

```ts
  mergeInto(existingId: string, incoming: Recommendation): void {
    const row = this.db
      .prepare("SELECT evidence FROM oracle_recommendations WHERE id = ?")
      .get(existingId) as { evidence: string } | undefined;
    if (!row) {
      return;
    }
    let existingEvidence: string[];
    try {
      const parsed = JSON.parse(row.evidence) as unknown;
      existingEvidence = Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      existingEvidence = [];
    }
    const union = Array.from(new Set([...existingEvidence, ...incoming.evidence]));
    this.db
      .prepare(
        `UPDATE oracle_recommendations
         SET last_seen_at = ?, evidence = ?
         WHERE id = ?`,
      )
      .run(incoming.generated_at, JSON.stringify(union), existingId);
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/sentinel/oracle/store.test.ts`
Expected: PASS.

Also run existing oracle tests for regression:

Run: `cd /Users/vero/openclaw && npm test -- --run tests/sentinel/oracle 2>&1 | tail -10`
Expected: All green.

- [ ] **Step 6: Commit**

```bash
cd /Users/vero/openclaw
git add src/sentinel/oracle/store.ts tests/sentinel/oracle/store.test.ts
git commit -m "feat(sentinel): OracleStore.mergeInto for semantic dedup

Updates an existing recommendation row when a new semantically-similar
rec lands: advances last_seen_at, unions the evidence sets, preserves
first_seen_at. No-op when the target id doesn't exist (defensive).

Doesn't touch oracle_dms_sent — merged recs don't re-DM, which is the
whole point: same logical action shouldn't fire a fresh notification."
```

---

## Task 7: Oracle dedup integration (uses EmbeddingService + mergeInto)

**Files:**

- Modify: `src/sentinel/oracle.ts`
- Modify: `tests/sentinel/oracle.test.ts`

Context: After `callLlm()` returns the raw recs in `runCycle`, partition them: for each rec, embed `${title}\n${rationale}`, call `findSimilar` against `oracle_recommendations` (k=1, sinceMs=14d). If top hit similarity ≥ 0.85, route through `store.mergeInto(hit.id, rec)`; else insert via `store.upsertAll([rec])` and then `embeddings.embedAndStore("oracle_recommendations", rec.id, text)`.

- [ ] **Step 1: Write the failing test**

In `tests/sentinel/oracle.test.ts`, add (or replace if a similar test exists) tests covering:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { openSentinelDb } from "../../src/sentinel/db.js";
import { createOracle } from "../../src/sentinel/oracle.js";
import { OracleStore } from "../../src/sentinel/oracle/store.js";
import { createEmbeddingService } from "../../src/sentinel/embeddings/service.js";
import type { GeminiEmbeddingAdapter } from "../../src/sentinel/embeddings/gemini-adapter.js";
import type { LlmClient } from "../../src/triage/llm-client.js";
import type { CompanyContextFirestoreLike } from "../../src/sentinel/observers/external-context/company-context.js";

function unitVector(i: number): Float32Array {
  const v = new Float32Array(768);
  v[i] = 1;
  return v;
}

// 0.85 cosine between two unit-basis-style vectors: build a normalized vector
// where the projection onto unit i is exactly 0.85.
function vecAtCosine(i: number, target: number): Float32Array {
  // For a unit basis vec e_i and a candidate v with v[i] = a and v[j] = b
  // (one other component), normalized to length 1: cosine = a.
  // So set v[i] = target, v[j] = sqrt(1 - target^2).
  const v = new Float32Array(768);
  v[i] = target;
  v[(i + 1) % 768] = Math.sqrt(1 - target * target);
  return v;
}

describe("Oracle semantic dedup", () => {
  let db: ReturnType<typeof openSentinelDb>;

  beforeEach(() => {
    db = openSentinelDb(`:memory:?id=${Math.random()}`);
  });

  function makeOracle(opts: { llmResponse: string; embedTexts: Map<string, Float32Array> }) {
    const llm: LlmClient = {
      async complete() {
        return opts.llmResponse;
      },
    };
    const adapter: GeminiEmbeddingAdapter = {
      async embed(text: string) {
        const v = opts.embedTexts.get(text);
        if (!v) throw new Error(`no canned vector for: ${text}`);
        return v;
      },
    };
    const firestore: CompanyContextFirestoreLike = {
      async countProjectsByField() {
        return {};
      },
      async sumProjectValue() {
        return 0;
      },
      async countWorkOrdersByStatus() {
        return {};
      },
      async listProjectAssignees() {
        return [{ owner_email: "x@example.com", sales_rep_email: null }];
      },
    };
    const embeddings = createEmbeddingService({ db, adapter });
    const oracle = createOracle({
      db,
      llm,
      libPath: "/tmp/notreal",
      firestoreClient: firestore,
      userAliases: {},
      embeddings,
    });
    return { oracle, embeddings };
  }

  it("merges a re-worded recommendation into the existing row", async () => {
    // Seed an existing rec
    const existingTitle = "Investigate cancellation rate";
    const existingRationale = "22% projects cancelled — root cause unknown.";
    const existingEmbedText = `${existingTitle}\n${existingRationale}`;
    const existingEmbed = unitVector(42);

    db.prepare(
      `INSERT INTO oracle_recommendations
       (id, assignee_email, title, rationale, evidence, scope, urgency, confidence, data, first_seen_at, last_seen_at, embedding)
       VALUES ('seed1', 'x@example.com', ?, ?, ?, 'tactical', 'high', 'high', '{}', 1000, 1000, ?)`,
    ).run(
      existingTitle,
      existingRationale,
      JSON.stringify(["insight:1"]),
      Buffer.from(existingEmbed.buffer),
    );

    const newTitle = "Reduce project cancellations";
    const newRationale = "Cancellations sit at 22% and are hurting margin.";
    const newEmbedText = `${newTitle}\n${newRationale}`;
    const llmResponse = JSON.stringify({
      recommendations: [
        {
          title: newTitle,
          rationale: newRationale,
          evidence_observation_ids: [],
          evidence_insight_ids: [9],
          assignee_email: "x@example.com",
          scope: "tactical",
          urgency: "high",
          confidence: "high",
        },
      ],
    });

    const { oracle } = makeOracle({
      llmResponse,
      embedTexts: new Map([
        [newEmbedText, vecAtCosine(42, 0.95)], // above 0.85 threshold
      ]),
    });

    // Mock writePerPersonFile to avoid fs interaction in the test
    const result = await oracle.runCycle().catch((err) => {
      // Tolerate filesystem errors from writePerPersonFile in tests
      if (/ENOENT|notreal/.test(err.message)) return null;
      throw err;
    });

    const rows = db
      .prepare(
        "SELECT id, first_seen_at, last_seen_at, evidence FROM oracle_recommendations ORDER BY first_seen_at",
      )
      .all() as Array<{
      id: string;
      first_seen_at: number;
      last_seen_at: number;
      evidence: string;
    }>;
    expect(rows.length).toBe(1); // merged, not inserted
    expect(rows[0].id).toBe("seed1");
    expect(rows[0].first_seen_at).toBe(1000); // preserved
    expect(rows[0].last_seen_at).toBeGreaterThan(1000); // advanced
    const evidence = JSON.parse(rows[0].evidence) as string[];
    expect(evidence).toContain("insight:1");
    expect(evidence).toContain("insight:9");
  });

  it("inserts a fresh recommendation when cosine sim is below threshold", async () => {
    db.prepare(
      `INSERT INTO oracle_recommendations
       (id, assignee_email, title, rationale, evidence, scope, urgency, confidence, data, first_seen_at, last_seen_at, embedding)
       VALUES ('seed1', 'x@example.com', 't1', 'r1', ?, 'ops', 'high', 'high', '{}', 1000, 1000, ?)`,
    ).run(JSON.stringify(["insight:1"]), Buffer.from(unitVector(42).buffer));

    const newTitle = "Totally unrelated topic";
    const newRationale = "About something else entirely.";
    const newEmbedText = `${newTitle}\n${newRationale}`;
    const llmResponse = JSON.stringify({
      recommendations: [
        {
          title: newTitle,
          rationale: newRationale,
          evidence_observation_ids: [],
          evidence_insight_ids: [9],
          assignee_email: "x@example.com",
          scope: "ops",
          urgency: "medium",
          confidence: "high",
        },
      ],
    });

    const { oracle } = makeOracle({
      llmResponse,
      embedTexts: new Map([
        [newEmbedText, vecAtCosine(100, 0.5)], // below 0.85 threshold relative to seed
      ]),
    });

    await oracle.runCycle().catch((err) => {
      if (/ENOENT|notreal/.test(err.message)) return null;
      throw err;
    });

    const rows = db
      .prepare("SELECT id FROM oracle_recommendations ORDER BY first_seen_at")
      .all() as Array<{ id: string }>;
    expect(rows.length).toBe(2); // seed + new
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/sentinel/oracle.test.ts`
Expected: FAIL — `createOracle` doesn't accept `embeddings` dep yet; runCycle does byte-hash dedup, not semantic.

- [ ] **Step 3: Modify `src/sentinel/oracle.ts`**

Add to imports at the top:

```ts
import type { EmbeddedTable, EmbeddingService } from "./embeddings/service.js";
```

Add to the file constants (above `MAX_DMS_PER_ASSIGNEE_PER_CYCLE`):

```ts
const ORACLE_DEDUP_THRESHOLD = 0.85;
const ORACLE_DEDUP_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const ORACLE_TABLE: EmbeddedTable = "oracle_recommendations";
```

Add `embeddings` to `OracleDeps`:

```ts
export interface OracleDeps {
  db: DatabaseType;
  llm: LlmClient;
  libPath: string;
  firestoreClient: CompanyContextFirestoreLike;
  userAliases: Record<string, string>;
  dmUser?: (slackUserId: string, text: string) => Promise<void>;
  embeddings: EmbeddingService;
}
```

Replace the existing `async runCycle()` body (currently calls `store.upsertAll(recs)` directly) with:

```ts
    async runCycle() {
      const recs = await callLlm();

      // Partition recs into (merge-into, fresh-insert) using semantic
      // similarity against existing oracle_recommendations within the
      // dedup window.
      const merged: Array<{ existingId: string; rec: Recommendation }> = [];
      const fresh: Recommendation[] = [];
      for (const rec of recs) {
        const text = `${rec.title}\n${rec.rationale}`;
        const hits = await deps.embeddings.findSimilar({
          table: ORACLE_TABLE,
          text,
          k: 1,
          sinceMs: Date.now() - ORACLE_DEDUP_WINDOW_MS,
        });
        const top = hits[0];
        if (top && top.similarity >= ORACLE_DEDUP_THRESHOLD) {
          merged.push({ existingId: String(top.id), rec });
        } else {
          fresh.push(rec);
        }
      }

      for (const m of merged) {
        store.mergeInto(m.existingId, m.rec);
      }
      if (fresh.length > 0) {
        store.upsertAll(fresh);
      }
      // Embed any fresh rows so subsequent cycles can dedup against them.
      for (const rec of fresh) {
        const text = `${rec.title}\n${rec.rationale}`;
        await deps.embeddings.embedAndStore(ORACLE_TABLE, rec.id, text);
      }

      const filesWritten: string[] = [];
      const allAssigneeEmails = Array.from(
        new Set([...merged.map((m) => m.rec.assignee_email), ...fresh.map((r) => r.assignee_email)]),
      );
      for (const email of allAssigneeEmails) {
        const list = store.queryAllForAssignee(email);
        const path = writePerPersonFile(deps.libPath, email, list);
        filesWritten.push(path);
      }

      const dmsSent: Array<{ assignee_email: string; rec_ids: string[] }> = [];
      if (deps.dmUser) {
        for (const email of allAssigneeEmails) {
          const slackId =
            fresh.find((r) => r.assignee_email === email)?.assignee_slack_id ??
            merged.find((m) => m.rec.assignee_email === email)?.rec.assignee_slack_id ??
            null;
          if (!slackId) {
            continue;
          }
          const newRecs = store.diffNewForAssignee(email).filter((r) => r.confidence === "high");
          if (newRecs.length === 0) {
            continue;
          }
          const toDM = newRecs.slice(0, MAX_DMS_PER_ASSIGNEE_PER_CYCLE);
          const bullets = toDM.map((r) => `• ${r.title}`).join("\n");
          const extra =
            newRecs.length > MAX_DMS_PER_ASSIGNEE_PER_CYCLE
              ? `\n_…and ${newRecs.length - MAX_DMS_PER_ASSIGNEE_PER_CYCLE} more in your file._`
              : "";
          try {
            await deps.dmUser(slackId, `Oracle: new on your plate\n\n${bullets}${extra}`);
            store.markDMsSent(toDM.map((r) => ({ rec_id: r.id, assignee_email: email })));
            dmsSent.push({ assignee_email: email, rec_ids: toDM.map((r) => r.id) });
          } catch {
            // DM failure — leave entries un-sent so next cycle retries
          }
        }
      }

      return { recommendations: [...fresh, ...merged.map((m) => m.rec)], filesWritten, dmsSent };
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/sentinel/oracle.test.ts`
Expected: PASS — including the two new dedup tests + existing oracle tests.

If existing oracle tests fail because they don't supply `embeddings` in deps, update those tests to inject a minimal stub:

```ts
const stubEmbeddings = {
  embed: async () => new Float32Array(768),
  findSimilar: async () => [],
  embedAndStore: async () => undefined,
};
// ...
createOracle({ ..., embeddings: stubEmbeddings });
```

Then re-run:

Run: `cd /Users/vero/openclaw && npm test -- --run tests/sentinel 2>&1 | tail -10`
Expected: All sentinel tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/vero/openclaw
git add src/sentinel/oracle.ts tests/sentinel/oracle.test.ts
git commit -m "feat(sentinel): oracle uses semantic dedup via EmbeddingService

In runCycle, partition LLM recs into (merge, fresh) by embedding
title+rationale and looking up the top hit in oracle_recommendations
within the 14d window. Hits at cosine >= 0.85 merge into the existing
row (last_seen_at advances, evidence is unioned); misses insert fresh
and embed the new row so subsequent cycles can dedup against them.

Threshold and window are constants (ORACLE_DEDUP_THRESHOLD,
ORACLE_DEDUP_WINDOW_MS). Revisit after a week of live cycles."
```

---

## Task 8: Wire EmbeddingService into createSentinel

**Files:**

- Modify: `src/sentinel/index.ts`
- Test: existing sentinel tests (covered indirectly via oracle integration test)

Context: `createSentinel` already constructs the oracle lazily via `getOracle()`. Embedding service construction is synchronous (one SELECT per table), so we build it eagerly alongside the DB and pass it into `getOracle`.

- [ ] **Step 1: Read current `createSentinel`**

Run: `cd /Users/vero/openclaw && sed -n '1,160p' src/sentinel/index.ts`

Note the spot where `getOracle()` is defined and where its deps are assembled.

- [ ] **Step 2: Modify `src/sentinel/index.ts`**

Add to imports near the top of the file:

```ts
import { createEmbeddingService } from "./embeddings/service.js";
import { createDefaultGeminiAdapter } from "./embeddings/gemini-adapter.js";
```

In `createSentinel`, after the line that opens the DB (look for `openSentinelDb` call), add:

```ts
// Construct the embedding service eagerly — it hydrates from the same DB
// and is needed by the oracle. Adapter lazily binds to GEMINI_API_KEY on
// first use (since createDefaultGeminiAdapter is async-aware via dynamic import).
let cachedAdapter: Awaited<ReturnType<typeof createDefaultGeminiAdapter>> | null = null;
const lazyAdapter = {
  async embed(text: string): Promise<Float32Array> {
    if (!cachedAdapter) {
      cachedAdapter = await createDefaultGeminiAdapter();
    }
    return cachedAdapter.embed(text);
  },
};
const embeddings = createEmbeddingService({ db, adapter: lazyAdapter });
```

Update the `getOracle()` factory inside `createSentinel` so it passes `embeddings` into `createOracle`:

```ts
async function getOracle(): Promise<Oracle> {
  if (oracleInstance) return oracleInstance;
  const firestoreClient = await createDefaultCompanyContextClient();
  oracleInstance = createOracle({
    db,
    llm: deps.llm,
    libPath,
    firestoreClient,
    userAliases: SLACK_USER_ALIASES,
    dmUser: deps.dmUser,
    embeddings,
  });
  return oracleInstance;
}
```

- [ ] **Step 3: Run sentinel tests for regression**

Run: `cd /Users/vero/openclaw && npm test -- --run tests/sentinel 2>&1 | tail -10`
Expected: All pass.

Run typecheck:

Run: `cd /Users/vero/openclaw && npx tsc --noEmit 2>&1 | grep -v "synthesizer.ts:75" | head -20`
Expected: No new errors (the pre-existing synthesizer.ts:75 error stays).

- [ ] **Step 4: Commit**

```bash
cd /Users/vero/openclaw
git add src/sentinel/index.ts
git commit -m "feat(sentinel): wire EmbeddingService into createSentinel

Service is built eagerly (hydrates from the open DB connection) and
injected into the lazy oracle factory. Adapter wraps a lazy
GoogleGenAI import so the API key check only runs when the first
embed() is actually called — keeps construction side-effect-free."
```

---

## Task 9: Backfill script for existing rows

**Files:**

- Create: `scripts/embed-backfill.ts`
- No test (operator-run script; the underlying EmbeddingService is already covered)

Context: One-shot CLI to embed every row across the three tables where `embedding IS NULL`. Idempotent — re-runs only touch rows still missing embeddings.

- [ ] **Step 1: Create the script**

Create `scripts/embed-backfill.ts`:

```ts
#!/usr/bin/env tsx
/**
 * Backfill embeddings for existing sentinel.db rows.
 *
 * Usage: tsx scripts/embed-backfill.ts [--dry-run]
 *
 * Walks observations, insights, and oracle_recommendations, embedding
 * every row where embedding IS NULL. Idempotent: re-running only touches
 * still-NULL rows.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { openSentinelDb } from "../src/sentinel/db.js";
import { createDefaultGeminiAdapter } from "../src/sentinel/embeddings/gemini-adapter.js";
import { encodeEmbedding } from "../src/sentinel/embeddings/blob-codec.js";

const BATCH = 100;

interface BackfillSpec {
  table: "observations" | "insights" | "oracle_recommendations";
  idColumn: "id";
  textBuilder: (row: Record<string, unknown>) => string;
  selectCols: string;
}

const SPECS: BackfillSpec[] = [
  {
    table: "observations",
    idColumn: "id",
    selectCols: "id, summary",
    textBuilder: (row) => String(row.summary ?? ""),
  },
  {
    table: "insights",
    idColumn: "id",
    selectCols: "id, summary",
    textBuilder: (row) => String(row.summary ?? ""),
  },
  {
    table: "oracle_recommendations",
    idColumn: "id",
    selectCols: "id, title, rationale",
    textBuilder: (row) => `${row.title ?? ""}\n${row.rationale ?? ""}`,
  },
];

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const dbPath = process.env.SENTINEL_DB_PATH ?? join(homedir(), ".openclaw/sentinel.db");
  // eslint-disable-next-line no-console
  console.log(`[backfill] db=${dbPath} dryRun=${dryRun}`);

  const db = openSentinelDb(dbPath);
  const adapter = await createDefaultGeminiAdapter();

  for (const spec of SPECS) {
    let processed = 0;
    let failed = 0;
    while (true) {
      const rows = db
        .prepare(
          `SELECT ${spec.selectCols} FROM ${spec.table}
           WHERE embedding IS NULL
           ORDER BY ${spec.idColumn} ASC
           LIMIT ${BATCH}`,
        )
        .all() as Array<Record<string, unknown>>;
      if (rows.length === 0) {
        break;
      }
      for (const row of rows) {
        const text = spec.textBuilder(row);
        if (!text.trim()) {
          // Skip rows with empty text — leave embedding NULL.
          continue;
        }
        try {
          const vec = await adapter.embed(text);
          if (!dryRun) {
            db.prepare(`UPDATE ${spec.table} SET embedding = ? WHERE ${spec.idColumn} = ?`).run(
              encodeEmbedding(vec),
              row[spec.idColumn],
            );
          }
          processed++;
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(
            `[backfill] ${spec.table}#${row[spec.idColumn]}: ${(err as Error).message}`,
          );
          failed++;
        }
      }
      // eslint-disable-next-line no-console
      console.log(
        `[backfill] ${spec.table}: ${processed} embedded, ${failed} failed (batch of ${rows.length})`,
      );
    }
    // eslint-disable-next-line no-console
    console.log(`[backfill] ${spec.table} done: ${processed} total embedded, ${failed} failed`);
  }
  db.close();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[backfill] fatal:", err);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Sanity-check that the script compiles**

Run: `cd /Users/vero/openclaw && npx tsc --noEmit scripts/embed-backfill.ts 2>&1 | head -10`
Expected: No errors specific to this file.

- [ ] **Step 3: Dry-run the script against the live DB (read-only)**

Run: `cd /Users/vero/openclaw && tsx scripts/embed-backfill.ts --dry-run 2>&1 | tail -20`
Expected: For each table, prints "X embedded, 0 failed" where X is the count of NULL-embedding rows; nothing actually written.

- [ ] **Step 4: Commit**

```bash
cd /Users/vero/openclaw
git add scripts/embed-backfill.ts
git commit -m "feat(scripts): embed-backfill — one-shot CLI for existing rows

Walks observations, insights, and oracle_recommendations; embeds every
row where embedding IS NULL via Gemini text-embedding-004 in batches
of 100. Idempotent — safe to re-run after a crash.

Skips rows with empty text (leave NULL). --dry-run mode embeds without
writing for sizing the work.

Reads from \$SENTINEL_DB_PATH or defaults to ~/.openclaw/sentinel.db."
```

---

## Task 10: Live smoke (operator-driven; do not run autonomously)

**Files:** none modified — verification only.

Context: This is the final acceptance step. Requires running against the real Gemini API and real `sentinel.db`. Stop here and wait for the operator to authorize each step.

- [ ] **Step 1: Run the live backfill**

Operator runs:

```bash
cd /Users/vero/openclaw && tsx scripts/embed-backfill.ts 2>&1 | tail -40
```

Verify the output reports a non-zero embedded count for `observations` and `insights` (oracle_recommendations may already have everything embedded via inline writes from prior smokes).

Verify with sqlite:

```bash
sqlite3 ~/.openclaw/sentinel.db "SELECT COUNT(*) FROM observations WHERE embedding IS NOT NULL;"
sqlite3 ~/.openclaw/sentinel.db "SELECT COUNT(*) FROM observations WHERE embedding IS NULL;"
sqlite3 ~/.openclaw/sentinel.db "SELECT COUNT(*) FROM insights WHERE embedding IS NOT NULL;"
sqlite3 ~/.openclaw/sentinel.db "SELECT COUNT(*) FROM oracle_recommendations WHERE embedding IS NOT NULL;"
```

Expected: For each table, the `IS NOT NULL` count equals total rows (minus rows whose text was empty).

- [ ] **Step 2: Fire a boot cycle**

Operator sets `OPENCLAW_SENTINEL_BOOT_CYCLE=1` in `~/.openclaw/.env`, then:

```bash
launchctl kickstart -k gui/$(id -u)/com.openclaw.agent
```

Watch the log until the cycle completes:

```bash
until grep -qE "$(date +%Y-%m-%d).*(boot-cycle complete|oracle cycle failed)" /Users/vero/openclaw.log; do sleep 5; done
grep -E "$(date +%Y-%m-%d).*(boot-cycle|oracle)" /Users/vero/openclaw.log | tail -10
```

- [ ] **Step 3: Verify dedup actually fired (or didn't)**

Inspect oracle_recommendations row count before and after the cycle:

```bash
sqlite3 ~/.openclaw/sentinel.db "SELECT id, title, first_seen_at, last_seen_at FROM oracle_recommendations ORDER BY first_seen_at;"
```

Expected:

- If the LLM produces a re-worded version of an existing rec, that existing row's `last_seen_at` advances and no new row appears.
- If the LLM produces genuinely new content, a new row appears and its `embedding` column is populated.

Also verify no `[sentinel] oracle cycle failed` line for this cycle in the gateway log.

- [ ] **Step 4: Restore the boot-cycle flag**

Operator edits `~/.openclaw/.env` and sets `OPENCLAW_SENTINEL_BOOT_CYCLE=0`.

- [ ] **Step 5: Open / update the PR**

If the PR (#8) hasn't been merged yet, push the new commits to the same branch — they roll into the existing PR. If PR #8 has merged, open a new PR for the embeddings work:

```bash
cd /Users/vero/openclaw && git push origin cleanup/phase-6-sentinel-jr-phase-a
```

Then either confirm the existing PR description still reflects scope or open a new one with `gh pr create` summarizing the embeddings phase.

---

## Self-review (controller did before handoff)

**Spec coverage check:**

| Spec section                                                              | Task                |
| ------------------------------------------------------------------------- | ------------------- |
| Module: `blob-codec.ts`                                                   | Task 1              |
| Module: `cosine.ts`                                                       | Task 2              |
| Schema migration                                                          | Task 3              |
| Module: `gemini-adapter.ts`                                               | Task 4              |
| Module: `service.ts` (hydration, embed, findSimilar, embedAndStore)       | Task 5              |
| Oracle store `mergeInto`                                                  | Task 6              |
| Oracle dedup integration                                                  | Task 7              |
| Sentinel wiring                                                           | Task 8              |
| Backfill script                                                           | Task 9              |
| Acceptance criteria (manual verification)                                 | Task 10             |
| Test coverage (cosine, blob-codec, service, oracle merge, threshold edge) | Tasks 1, 2, 5, 6, 7 |

**Placeholder scan:** none — every code block is complete.

**Type consistency:**

- `EmbeddingService` shape consistent across Tasks 5, 7, 8.
- `SimilarRow.id: string | number` matches use sites (oracle uses string, observations/insights use number).
- `EmbeddedTable` type used uniformly.
- `OracleStore.mergeInto(existingId: string, incoming: Recommendation)` signature consistent.
- `ORACLE_DEDUP_THRESHOLD` / `ORACLE_DEDUP_WINDOW_MS` constants referenced only in oracle.ts.

---

## Execution

**Plan complete. Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review (spec + quality) between tasks.
2. **Inline Execution** — execute tasks in this session via `superpowers:executing-plans`.
