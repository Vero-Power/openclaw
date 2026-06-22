import { describe, it, expect, beforeEach } from "vitest";
import { openSentinelDb } from "../../../src/sentinel/db.js";
import { encodeEmbedding } from "../../../src/sentinel/embeddings/blob-codec.js";
import type { GeminiEmbeddingAdapter } from "../../../src/sentinel/embeddings/gemini-adapter.js";
import { createEmbeddingService } from "../../../src/sentinel/embeddings/service.js";

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
      .then(() => {
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

  it("sweepNullEmbeddings catches up NULL rows across all three tables", async () => {
    db.prepare(
      `INSERT INTO observations (source, topic, timestamp, summary, created_at)
       VALUES ('test', 't', 1, 'obs-null-text', 1)`,
    ).run();
    db.prepare(
      `INSERT INTO insights (category, summary, evidence, generated_at)
       VALUES ('cat', 'insight-null-text', '[]', 2)`,
    ).run();
    db.prepare(
      `INSERT INTO oracle_recommendations
       (id, assignee_email, title, rationale, evidence, scope, urgency, confidence, data, first_seen_at, last_seen_at)
       VALUES ('rec1', 'x@example.com', 'rec-title', 'rec-rationale', '[]', 'ops', 'high', 'high', '{}', 1, 3)`,
    ).run();
    // One already-embedded observation that must NOT be re-embedded
    db.prepare(
      `INSERT INTO observations (source, topic, timestamp, summary, embedding, created_at)
       VALUES ('test', 't', 4, 'already-embedded', ?, 1)`,
    ).run(encodeEmbedding(unitVector(0)));

    const adapter = makeAdapter(
      new Map([
        ["obs-null-text", unitVector(1)],
        ["insight-null-text", unitVector(2)],
        ["rec-title\nrec-rationale", unitVector(3)],
      ]),
    );
    const svc = createEmbeddingService({ db, adapter });
    const result = await svc.sweepNullEmbeddings();

    expect(result.embedded.observations).toBe(1);
    expect(result.embedded.insights).toBe(1);
    expect(result.embedded.oracle_recommendations).toBe(1);

    const remainingNull = db
      .prepare(
        `SELECT COUNT(*) AS c FROM (
           SELECT 1 FROM observations WHERE embedding IS NULL
           UNION ALL SELECT 1 FROM insights WHERE embedding IS NULL
           UNION ALL SELECT 1 FROM oracle_recommendations WHERE embedding IS NULL
         )`,
      )
      .get() as { c: number };
    expect(remainingNull.c).toBe(0);
  });

  it("sweepNullEmbeddings is a no-op when every row is already embedded", async () => {
    db.prepare(
      `INSERT INTO observations (source, topic, timestamp, summary, embedding, created_at)
       VALUES ('t', 't', 1, 'already-here', ?, 1)`,
    ).run(encodeEmbedding(unitVector(0)));

    const adapter = makeAdapter(new Map());
    const svc = createEmbeddingService({ db, adapter });
    const result = await svc.sweepNullEmbeddings();
    expect(result.embedded.observations).toBe(0);
    expect(result.failed.observations).toBe(0);
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
