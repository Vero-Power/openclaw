import type { Database as DatabaseType } from "better-sqlite3";

const DEFAULT_MAX_ENTRIES = 20;

export interface RecentResearchOptions {
  maxEntries?: number;
}

export function buildRecentResearchContext(
  db: DatabaseType,
  windowMs: number,
  options: RecentResearchOptions = {},
): string {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const sinceMs = Date.now() - windowMs;
  const rows = db
    .prepare(
      `SELECT summary,
              json_extract(data, '$.confidence') AS confidence,
              json_extract(data, '$.published_at') AS published_at
       FROM observations
       WHERE source = 'external-context'
         AND timestamp > ?
       ORDER BY timestamp DESC
       LIMIT ?`,
    )
    .all(sinceMs, maxEntries) as Array<{
    summary: string;
    confidence: string | null;
    published_at: string | null;
  }>;

  if (rows.length === 0) {
    return "RECENT RESEARCH (last 7 days): No prior research available.";
  }

  const lines = rows.map((r) => {
    const conf = r.confidence ?? "unknown";
    const pub = r.published_at ?? "unknown";
    return `- "${r.summary}" (confidence: ${conf}, published: ${pub})`;
  });

  return `RECENT RESEARCH (last 7 days — what JR has already covered):\n${lines.join("\n")}`;
}
