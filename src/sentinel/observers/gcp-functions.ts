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

export function createGcpFunctionsObserver(_deps: GcpFunctionsObserverDeps): Observer {
  return {
    name: "gcp-functions",
    async observe(_since: number): Promise<Omit<Observation, "id" | "created_at">[]> {
      return [];
    },
  };
}
