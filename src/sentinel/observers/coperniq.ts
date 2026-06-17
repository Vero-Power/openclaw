import type { Database as DatabaseType } from "better-sqlite3";
import type { Observer } from "../observer.js";
import type { Observation } from "../types.js";

export interface FirestoreCredentials {
  client_email: string;
  private_key: string;
  project_id: string;
}

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

export function createCoperniqObserver(_deps: CoperniqObserverDeps): Observer {
  return {
    name: "coperniq",
    async observe(_since: number): Promise<Omit<Observation, "id" | "created_at">[]> {
      return [];
    },
  };
}
