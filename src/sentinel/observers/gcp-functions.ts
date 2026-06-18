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

interface PriorFunction {
  name: string;
  invocations: number;
  errors: number;
}

interface PriorObservation {
  functions: PriorFunction[];
}

function readPriorObservation(db: DatabaseType): PriorObservation | null {
  const row = db
    .prepare(
      `SELECT data FROM observations WHERE source = 'gcp-functions' ORDER BY id DESC LIMIT 1`,
    )
    .get() as { data: string | null } | undefined;
  if (!row?.data) {
    return null;
  }
  try {
    const parsed = JSON.parse(row.data) as Partial<PriorObservation>;
    if (!Array.isArray(parsed.functions)) {
      return null;
    }
    return {
      functions: parsed.functions
        .filter(
          (f): f is PriorFunction =>
            typeof f === "object" &&
            f !== null &&
            typeof f.name === "string" &&
            typeof f.invocations === "number" &&
            typeof f.errors === "number",
        )
        .map((f) => ({ name: f.name, invocations: f.invocations, errors: f.errors })),
    };
  } catch {
    return null;
  }
}

function composeSummary(opts: {
  functionCount: number;
  invocationsTotal: number;
  errorsTotal: number;
  functions: Array<{ name: string; errors: number }>;
}): string {
  const head = `${opts.functionCount} functions: ${opts.invocationsTotal} invocations, ${opts.errorsTotal} errors`;
  if (opts.errorsTotal === 0) {
    return `${head}. Window: 2h.`;
  }
  const topErrors = opts.functions
    .filter((f) => f.errors > 0)
    .toSorted((a, b) => b.errors - a.errors)
    .slice(0, 4)
    .map((f) => `${f.name} ${f.errors}`)
    .join(", ");
  return `${head} (${topErrors}). Window: 2h.`;
}

function computeDeltas(
  current: Array<{ name: string; invocations: number; errors: number }>,
  prior: PriorObservation,
): Record<string, number> {
  const priorByName = new Map(prior.functions.map((f) => [f.name, f]));
  const out: Record<string, number> = {};
  for (const f of current) {
    const p = priorByName.get(f.name);
    if (!p) {
      continue;
    }
    const slug = slugify(f.name);
    const dInv = f.invocations - p.invocations;
    const dErr = f.errors - p.errors;
    if (dInv !== 0) {
      out[`delta_${slug}_invocations`] = dInv;
    }
    if (dErr !== 0) {
      out[`delta_${slug}_errors`] = dErr;
    }
  }
  return out;
}

const GCP_FUNCTIONS_PROJECT_ID = "openclaw-mail-bridge";

async function defaultClientFactoryAsync(): Promise<LoggingLike> {
  const { Logging } = await import("@google-cloud/logging");
  const logging = new Logging({ projectId: GCP_FUNCTIONS_PROJECT_ID });

  return {
    async listFunctionEntries(serviceName: string, sinceIso: string): Promise<LogEntry[]> {
      const filter =
        `((resource.type="cloud_run_revision" AND resource.labels.service_name="${serviceName}") ` +
        `OR (resource.type="cloud_function" AND resource.labels.function_name="${serviceName}")) ` +
        `AND timestamp >= "${sinceIso}"`;
      const [entries] = await logging.getEntries({
        filter,
        orderBy: "timestamp desc",
        pageSize: 1000,
      });
      return entries.map((e) => {
        const meta = (e.metadata ?? {}) as {
          timestamp?: string | { seconds?: number | string; nanos?: number };
          severity?: string;
        };
        let timestamp: string;
        if (typeof meta.timestamp === "string") {
          timestamp = meta.timestamp;
        } else if (
          meta.timestamp &&
          typeof meta.timestamp === "object" &&
          "seconds" in meta.timestamp
        ) {
          const seconds = Number(meta.timestamp.seconds ?? 0);
          const nanos = meta.timestamp.nanos ?? 0;
          timestamp = new Date(seconds * 1000 + Math.floor(nanos / 1_000_000)).toISOString();
        } else {
          timestamp = new Date().toISOString();
        }
        const severity = meta.severity ?? "DEFAULT";
        const raw = (e as { data?: unknown }).data;
        const text = typeof raw === "string" ? raw : JSON.stringify(raw ?? {});
        return { timestamp, severity, text };
      });
    },
  };
}

export function createGcpFunctionsObserver(deps: GcpFunctionsObserverDeps): Observer {
  let cachedClient: LoggingLike | null = null;

  async function resolveClient(): Promise<LoggingLike> {
    if (deps.getClient) {
      return deps.getClient();
    }
    if (cachedClient) {
      return cachedClient;
    }
    const factory = deps.clientFactory ?? defaultClientFactoryAsync;
    cachedClient = await factory();
    return cachedClient;
  }

  return {
    name: "gcp-functions",
    async observe(_since: number): Promise<Omit<Observation, "id" | "created_at">[]> {
      const client = await resolveClient();

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

      const prior = readPriorObservation(deps.db);
      if (prior) {
        Object.assign(metrics, computeDeltas(functions, prior));
      }

      return [
        {
          source: "gcp-functions",
          topic: "gcp-functions",
          timestamp: now,
          summary: composeSummary({
            functionCount: functions.length,
            invocationsTotal: invocations_total,
            errorsTotal: errors_total,
            functions: functions.map((f) => ({ name: f.name, errors: f.errors })),
          }),
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
