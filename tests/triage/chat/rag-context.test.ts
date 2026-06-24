import { describe, it, expect, beforeEach } from "vitest";
import { openSentinelDb } from "../../../src/sentinel/db.js";
import { encodeEmbedding } from "../../../src/sentinel/embeddings/blob-codec.js";
import type { GeminiEmbeddingAdapter } from "../../../src/sentinel/embeddings/gemini-adapter.js";
import { createEmbeddingService } from "../../../src/sentinel/embeddings/service.js";
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

  it("renders observation hits below insights + oracle, with source/topic labels", async () => {
    db.prepare(
      `INSERT INTO insights (category, summary, evidence, generated_at, confidence, embedding)
       VALUES ('ops', 'an insight', '[]', 1, 0.8, ?)`,
    ).run(encodeEmbedding(unitVector(0)));
    db.prepare(
      `INSERT INTO oracle_recommendations
       (id, assignee_email, title, rationale, evidence, scope, urgency, confidence, data, first_seen_at, last_seen_at, embedding)
       VALUES ('r1', 'x@example.com', 'a rec', 'r', '[]', 'tactical', 'high', 'high', '{}', 1, 1, ?)`,
    ).run(encodeEmbedding(unitVector(0)));
    // Recent observation that should clear the OBS threshold (0.55)
    db.prepare(
      `INSERT INTO observations (source, topic, timestamp, summary, embedding, created_at)
       VALUES ('slack-channels', 'channel:CABC', ?, 'recent observation text', ?, 1)`,
    ).run(Date.now() - 1000, encodeEmbedding(unitVector(0)));

    const adapter = makeAdapter(new Map([["q", unitVector(0)]]));
    const embeddings = createEmbeddingService({ db, adapter });

    const out = await buildRagContext("q", { embeddings, db });
    const insightPos = out.indexOf("[insight");
    const oraclePos = out.indexOf("[oracle rec");
    const obsPos = out.indexOf("[observation");
    expect(insightPos).toBeGreaterThan(-1);
    expect(oraclePos).toBeGreaterThan(insightPos);
    expect(obsPos).toBeGreaterThan(oraclePos);
    expect(out).toContain("[observation | source=slack-channels/channel:CABC]");
    expect(out).toContain("recent observation text");
  });

  it("observations cap at k=3 and only clear the 0.55 obs threshold", async () => {
    // Cosine of e_0 against itself is 1.0. We pick a "below" vector at cosine
    // 0.5 against e_0 — clearly under the 0.55 obs threshold, well above
    // an orthogonal noise vector.
    const above = unitVector(0);
    const below = new Float32Array(768);
    below[0] = 0.5;
    below[1] = Math.sqrt(1 - 0.25);

    for (let i = 0; i < 5; i++) {
      db.prepare(
        `INSERT INTO observations (source, topic, timestamp, summary, embedding, created_at)
         VALUES ('test', 't', ?, ?, ?, 1)`,
      ).run(Date.now() - i * 1000, `obs above ${i}`, encodeEmbedding(above));
    }
    db.prepare(
      `INSERT INTO observations (source, topic, timestamp, summary, embedding, created_at)
       VALUES ('test', 't', ?, 'obs below threshold', ?, 1)`,
    ).run(Date.now() - 10_000, encodeEmbedding(below));

    const adapter = makeAdapter(new Map([["q", unitVector(0)]]));
    const embeddings = createEmbeddingService({ db, adapter });

    const out = await buildRagContext("q", { embeddings, db });
    const obsLines = out.split("\n").filter((l) => l.includes("[observation"));
    expect(obsLines).toHaveLength(3);
    expect(out).not.toContain("obs below threshold");
  });

  it("observations older than the 14d window are excluded even at high similarity", async () => {
    db.prepare(
      `INSERT INTO observations (source, topic, timestamp, summary, embedding, created_at)
       VALUES ('test', 't', ?, 'ancient observation', ?, 1)`,
    ).run(Date.now() - 30 * 24 * 60 * 60 * 1000, encodeEmbedding(unitVector(0)));

    const adapter = makeAdapter(new Map([["q", unitVector(0)]]));
    const embeddings = createEmbeddingService({ db, adapter });

    const out = await buildRagContext("q", { embeddings, db });
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
