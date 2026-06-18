import type { Database as DatabaseType } from "better-sqlite3";
import type { Observer } from "../observer.js";
import type { Observation } from "../types.js";

export interface LogEntry {
  timestamp: string;
  severity: string;
  text: string;
}

export interface LoggingLike {
  listFunctionEntries(serviceName: string, sinceIso: string): Promise<LogEntry[]>;
}

export interface GcpFunctionsObserverDeps {
  db: DatabaseType;
  getClient?: () => Promise<LoggingLike>;
  clientFactory?: () => Promise<LoggingLike> | LoggingLike;
}

export const GCP_FUNCTIONS = [
  "bomQuoteNotifier",
  "finalDesignSender",
  "signedDesignPlansetReview",
  "coperniqFirestoreIngest",
  "ghlFirestoreIngest",
  "slackFirestoreIngest",
] as const;

const WINDOW_MS = 2 * 60 * 60 * 1000;
const ERROR_SEVERITIES = new Set(["ERROR", "CRITICAL", "ALERT", "EMERGENCY"]);
const LAST_ERROR_MAX_LEN = 300;

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "unknown"
  );
}

function countEntries(entries: LogEntry[]): { invocations: number; errors: number } {
  let errors = 0;
  for (const e of entries) {
    if (ERROR_SEVERITIES.has(e.severity)) {
      errors++;
    }
  }
  return { invocations: entries.length, errors };
}

function extractFunctionDetail(entries: LogEntry[]): {
  last_invocation_at: string | null;
  last_error: { ts: string; text: string } | null;
} {
  let newestTs: string | null = null;
  let newestErrorTs: string | null = null;
  let newestErrorText: string | null = null;
  for (const e of entries) {
    if (newestTs === null || e.timestamp.localeCompare(newestTs) > 0) {
      newestTs = e.timestamp;
    }
    if (ERROR_SEVERITIES.has(e.severity)) {
      if (newestErrorTs === null || e.timestamp.localeCompare(newestErrorTs) > 0) {
        newestErrorTs = e.timestamp;
        newestErrorText = e.text;
      }
    }
  }
  return {
    last_invocation_at: newestTs,
    last_error:
      newestErrorTs !== null && newestErrorText !== null
        ? { ts: newestErrorTs, text: newestErrorText.slice(0, LAST_ERROR_MAX_LEN) }
        : null,
  };
}

export function createGcpFunctionsObserver(deps: GcpFunctionsObserverDeps): Observer {
  return {
    name: "gcp-functions",
    async observe(_since: number): Promise<Omit<Observation, "id" | "created_at">[]> {
      const getClient =
        deps.getClient ??
        (async () => {
          throw new Error("default Logging client not yet wired (see Task 6 in plan)");
        });
      const client = await getClient();

      const now = Date.now();
      const windowStartIso = new Date(now - WINDOW_MS).toISOString();
      const windowEndIso = new Date(now).toISOString();

      const entriesByFunction = await Promise.all(
        GCP_FUNCTIONS.map(async (name) => ({
          name,
          entries: await client.listFunctionEntries(name, windowStartIso),
        })),
      );

      const functions = entriesByFunction.map(({ name, entries }) => {
        const { invocations, errors } = countEntries(entries);
        const detail = extractFunctionDetail(entries);
        return {
          name,
          invocations,
          errors,
          last_invocation_at: detail.last_invocation_at,
          last_error: detail.last_error,
        };
      });

      const invocations_total = functions.reduce((acc, f) => acc + f.invocations, 0);
      const errors_total = functions.reduce((acc, f) => acc + f.errors, 0);

      const metrics: Record<string, number> = {
        invocations_total,
        errors_total,
      };
      for (const f of functions) {
        const slug = slugify(f.name);
        metrics[`${slug}_invocations`] = f.invocations;
        metrics[`${slug}_errors`] = f.errors;
      }

      return [
        {
          source: "gcp-functions",
          topic: "gcp-functions",
          timestamp: now,
          summary: `${functions.length} functions: ${invocations_total} invocations, ${errors_total} errors. Window: 2h.`,
          data: {
            windowStartIso,
            windowEndIso,
            functions,
          },
          metrics,
        },
      ];
    },
  };
}
