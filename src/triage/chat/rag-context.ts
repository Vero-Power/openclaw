import type { Database as DatabaseType } from "better-sqlite3";
import type { EmbeddingService, SimilarRow } from "../../sentinel/embeddings/service.js";

export interface RagContextDeps {
  embeddings: EmbeddingService;
  db: DatabaseType;
}

const RAG_THRESHOLD = 0.5;
// Slightly higher bar for observations — they're the noisiest source
// (channel silence pings, weather forecasts, raw GCF execution counts).
// Original v1 picked 0.65 defensively, but live smoke (PR #13 follow-up)
// showed legit topical insights for the same query clustered at 0.55-0.58,
// meaning 0.65 was filtering observations in the SAME similarity band as
// the curated sources. 0.55 keeps a small lift over the curated 0.5
// without gating out genuine matches.
const RAG_OBS_THRESHOLD = 0.55;
const RAG_K_INSIGHTS = 3;
const RAG_K_ORACLE = 2;
const RAG_K_OBS = 3;
// Observations get a recency window — older raw events go stale fast.
// Insights + oracle don't get one because they're already curated.
const RAG_OBS_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

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

interface ObservationRow {
  id: number;
  source: string;
  topic: string | null;
  summary: string;
}

async function findSimilarSafe(
  embeddings: EmbeddingService,
  table: "insights" | "oracle_recommendations" | "observations",
  message: string,
  k: number,
  threshold: number,
  sinceMs?: number,
): Promise<SimilarRow[]> {
  try {
    const opts: Parameters<EmbeddingService["findSimilar"]>[0] = { table, text: message, k };
    if (sinceMs !== undefined) {
      opts.sinceMs = sinceMs;
    }
    const hits = await embeddings.findSimilar(opts);
    return hits.filter((h) => h.similarity >= threshold);
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
    const obsSinceMs = Date.now() - RAG_OBS_WINDOW_MS;
    const [insightHits, oracleHits, obsHits] = await Promise.all([
      findSimilarSafe(deps.embeddings, "insights", message, RAG_K_INSIGHTS, RAG_THRESHOLD),
      findSimilarSafe(
        deps.embeddings,
        "oracle_recommendations",
        message,
        RAG_K_ORACLE,
        RAG_THRESHOLD,
      ),
      findSimilarSafe(
        deps.embeddings,
        "observations",
        message,
        RAG_K_OBS,
        RAG_OBS_THRESHOLD,
        obsSinceMs,
      ),
    ]);

    if (insightHits.length === 0 && oracleHits.length === 0 && obsHits.length === 0) {
      return "";
    }

    // Production visibility: success path is otherwise silent. Logging hit
    // counts + top similarity makes it trivial to confirm RAG is grounding
    // live replies (instead of guessing from reply content alone).
    const topInsight = insightHits[0]?.similarity ?? 0;
    const topOracle = oracleHits[0]?.similarity ?? 0;
    const topObs = obsHits[0]?.similarity ?? 0;
    // eslint-disable-next-line no-console
    console.log(
      `[rag-context] insights=${insightHits.length}(top=${topInsight.toFixed(2)}) oracle=${oracleHits.length}(top=${topOracle.toFixed(2)}) obs=${obsHits.length}(top=${topObs.toFixed(2)})`,
    );

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

    if (obsHits.length > 0) {
      const ids = obsHits.map((h) => h.id as number);
      const rows = deps.db
        .prepare(
          `SELECT id, source, topic, summary
           FROM observations WHERE id IN (${placeholders(ids.length)})`,
        )
        .all(...ids) as ObservationRow[];
      const byId = new Map(rows.map((r) => [r.id, r]));
      for (const hit of obsHits) {
        const row = byId.get(hit.id as number);
        if (!row) {
          continue;
        }
        const topicSuffix = row.topic ? `/${row.topic}` : "";
        lines.push(`- [observation | source=${row.source}${topicSuffix}] ${row.summary}`);
      }
    }

    return lines.join("\n");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[rag-context] build failed: ${(err as Error).message}`);
    return "";
  }
}
