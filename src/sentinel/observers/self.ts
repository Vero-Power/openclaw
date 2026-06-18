import Database from "better-sqlite3";
import type { Observer } from "../observer.js";
import type { Observation } from "../types.js";

export interface SelfObserverDeps {
  triageDbPath: string;
}

export function createSelfObserver(deps: SelfObserverDeps): Observer {
  return {
    name: "self",
    async observe(since: number): Promise<Omit<Observation, "id" | "created_at">[]> {
      const db = new Database(deps.triageDbPath, { readonly: true });
      const now = Date.now();

      const sessionRows = db
        .prepare(
          `SELECT state, COUNT(*) AS c FROM triage_sessions WHERE created_at >= ? GROUP BY state`,
        )
        .all(since) as Array<{ state: string; c: number }>;
      const sessionMetrics: Record<string, number> = {};
      for (const row of sessionRows) {
        sessionMetrics[row.state] = row.c;
      }

      const actionRows = db
        .prepare(
          `SELECT result_status, COUNT(*) AS c FROM action_invocations WHERE invoked_at >= ? GROUP BY result_status`,
        )
        .all(since) as Array<{ result_status: string; c: number }>;
      const actionMetrics: Record<string, number> = {};
      for (const row of actionRows) {
        actionMetrics[row.result_status] = row.c;
      }

      db.close();

      const observations: Omit<Observation, "id" | "created_at">[] = [
        {
          source: "self",
          topic: "triage-sessions",
          timestamp: now,
          summary: `triage sessions since ${new Date(since).toISOString()}: ${
            Object.entries(sessionMetrics)
              .map(([s, c]) => `${s}=${c}`)
              .join(", ") || "(none)"
          }`,
          metrics: sessionMetrics,
        },
        {
          source: "self",
          topic: "action-invocations",
          timestamp: now,
          summary: `action invocations since ${new Date(since).toISOString()}: ${
            Object.entries(actionMetrics)
              .map(([s, c]) => `${s}=${c}`)
              .join(", ") || "(none)"
          }`,
          metrics: actionMetrics,
        },
      ];
      return observations;
    },
  };
}
