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
import { encodeEmbedding } from "../src/sentinel/embeddings/blob-codec.js";
import { createDefaultGeminiAdapter } from "../src/sentinel/embeddings/gemini-adapter.js";

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
    textBuilder: (row) => {
      const summary = row.summary;
      return typeof summary === "string" ? summary : "";
    },
  },
  {
    table: "insights",
    idColumn: "id",
    selectCols: "id, summary",
    textBuilder: (row) => {
      const summary = row.summary;
      return typeof summary === "string" ? summary : "";
    },
  },
  {
    table: "oracle_recommendations",
    idColumn: "id",
    selectCols: "id, title, rationale",
    textBuilder: (row) => {
      const title = typeof row.title === "string" ? row.title : "";
      const rationale = typeof row.rationale === "string" ? row.rationale : "";
      return `${title}\n${rationale}`;
    },
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
          const rowId = String(row[spec.idColumn]);
          console.error(`[backfill] ${spec.table}#${rowId}: ${(err as Error).message}`);
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
