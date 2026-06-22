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
  return Array.from({ length: n }, () => "?").join(", ");
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
        if (!row) {
          continue;
        }
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
        if (!row) {
          continue;
        }
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
