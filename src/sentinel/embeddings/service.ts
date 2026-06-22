import type { Database as DatabaseType } from "better-sqlite3";
import { decodeEmbedding, encodeEmbedding } from "./blob-codec.js";
import { cosineSimilarity } from "./cosine.js";
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

export interface SweepResult {
  embedded: Record<EmbeddedTable, number>;
  failed: Record<EmbeddedTable, number>;
}

export interface EmbeddingService {
  embed(text: string): Promise<Float32Array>;
  findSimilar(opts: FindSimilarOpts): Promise<SimilarRow[]>;
  embedAndStore(table: EmbeddedTable, id: string | number, text: string): Promise<void>;
  /**
   * Sweep all three tables for rows where embedding IS NULL and embed them.
   * Idempotent — re-running only touches still-NULL rows. Returns per-table
   * counts so the caller can log how much catch-up happened.
   *
   * Intended to run once a day from the sentinel cycle as a safety net
   * for any inline-embed call that failed (transient API error, etc.).
   */
  sweepNullEmbeddings(): Promise<SweepResult>;
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

  async function sweepNullEmbeddings(): Promise<SweepResult> {
    const embedded: Record<EmbeddedTable, number> = {
      observations: 0,
      insights: 0,
      oracle_recommendations: 0,
    };
    const failed: Record<EmbeddedTable, number> = {
      observations: 0,
      insights: 0,
      oracle_recommendations: 0,
    };
    for (const cfg of Object.values(TABLE_CONFIGS)) {
      const textCols = TEXT_COLUMNS[cfg.table];
      const rows = deps.db
        .prepare(
          `SELECT ${cfg.idColumn} AS id, ${textCols.join(", ")} FROM ${cfg.table}
           WHERE embedding IS NULL`,
        )
        .all() as Array<Record<string, unknown>>;
      for (const row of rows) {
        const id = row.id as string | number;
        const text = TEXT_BUILDERS[cfg.table](row);
        if (!text.trim()) {
          continue;
        }
        const sizeBefore = indexes[cfg.table].embeddings.size;
        await embedAndStore(cfg.table, id, text);
        if (indexes[cfg.table].embeddings.size > sizeBefore) {
          embedded[cfg.table]++;
        } else {
          failed[cfg.table]++;
        }
      }
    }
    return { embedded, failed };
  }

  return { embed, findSimilar, embedAndStore, sweepNullEmbeddings };
}

// Text-composition rules per table, kept centralized so the sweep
// matches the inline embed paths.
const TEXT_COLUMNS: Record<EmbeddedTable, string[]> = {
  observations: ["summary"],
  insights: ["summary"],
  oracle_recommendations: ["title", "rationale"],
};

function asText(v: unknown): string {
  return typeof v === "string" ? v : "";
}

const TEXT_BUILDERS: Record<EmbeddedTable, (row: Record<string, unknown>) => string> = {
  observations: (r) => asText(r.summary),
  insights: (r) => asText(r.summary),
  oracle_recommendations: (r) => `${asText(r.title)}\n${asText(r.rationale)}`,
};
