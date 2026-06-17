import type { Database as DatabaseType } from "better-sqlite3";
import type { Observer } from "../observer.js";
import type { Observation } from "../types.js";

export interface ProjectStatusRow {
  id: string;
  status: string | null;
  updatedAt?: string;
  title?: string;
}

export interface WorkOrderStatusRow {
  id: string;
  status: string | null;
  updatedAt?: string;
  title?: string;
}

export interface SyncMeta {
  lastSyncAt: string;
}

export interface FirestoreLike {
  getSyncMeta(): Promise<SyncMeta | null>;
  listProjectStatuses(): Promise<ProjectStatusRow[]>;
  listWorkOrderStatuses(): Promise<WorkOrderStatusRow[]>;
  listChangedProjects(sinceIso: string, limit: number): Promise<ProjectStatusRow[]>;
  listChangedWorkOrders(sinceIso: string, limit: number): Promise<WorkOrderStatusRow[]>;
}

export interface CoperniqObserverDeps {
  db: DatabaseType;
  getClient?: () => Promise<FirestoreLike>;
}

interface PriorObservation {
  lastSyncAt: string | null;
  projectStatusCounts: Record<string, number>;
  woStatusCounts: Record<string, number>;
}

function readPriorObservation(db: DatabaseType): PriorObservation | null {
  const row = db
    .prepare(`SELECT data FROM observations WHERE source = 'coperniq' ORDER BY id DESC LIMIT 1`)
    .get() as { data: string | null } | undefined;
  if (!row?.data) {
    return null;
  }
  try {
    const parsed = JSON.parse(row.data) as Partial<PriorObservation>;
    return {
      lastSyncAt: parsed.lastSyncAt ?? null,
      projectStatusCounts: parsed.projectStatusCounts ?? {},
      woStatusCounts: parsed.woStatusCounts ?? {},
    };
  } catch {
    return null;
  }
}

export function createCoperniqObserver(deps: CoperniqObserverDeps): Observer {
  return {
    name: "coperniq",
    async observe(_since: number): Promise<Omit<Observation, "id" | "created_at">[]> {
      const getClient =
        deps.getClient ??
        (async () => {
          throw new Error("default Firestore client not yet wired (see Task 8 in plan)");
        });
      const client = await getClient();
      const meta = await client.getSyncMeta();
      const prior = readPriorObservation(deps.db);

      if (meta && prior && meta.lastSyncAt === prior.lastSyncAt) {
        return [];
      }

      // Subsequent tasks (4-7) read collections, compute deltas, build summary, emit observation
      return [];
    },
  };
}
