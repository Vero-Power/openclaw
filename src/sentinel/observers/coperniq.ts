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

function slugifyStatus(s: string | null | undefined): string {
  const raw = (s ?? "unknown").trim() || "unknown";
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "unknown"
  );
}

function tallyByStatus(rows: Array<{ status: string | null }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const key = slugifyStatus(r.status);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function flattenCounts(prefix: string, counts: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(counts)) {
    out[`${prefix}_${k}`] = v;
  }
  return out;
}

function computeDeltas(
  prefix: string,
  current: Record<string, number>,
  prior: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  const keys = new Set([...Object.keys(current), ...Object.keys(prior)]);
  for (const k of keys) {
    const delta = (current[k] ?? 0) - (prior[k] ?? 0);
    if (delta !== 0) {
      out[`delta_${prefix}_${k}`] = delta;
    }
  }
  return out;
}

function pluralize(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function composeSummary(opts: {
  projectsTotal: number;
  woTotal: number;
  projectsChanged: number;
  wosChanged: number;
  deltas: Record<string, number>;
  isFirstRun: boolean;
}): string {
  const head = `${pluralize(opts.projectsTotal, "project")}, ${pluralize(opts.woTotal, "work order")}.`;
  if (opts.isFirstRun) {
    return head;
  }
  const nonzero = Object.entries(opts.deltas)
    .filter(([, v]) => v !== 0)
    .toSorted((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 4)
    .map(([k, v]) => {
      const sign = v > 0 ? "+" : "−";
      const label = k.replace(/^delta_(project|wo)_status_/, "");
      return `${sign}${Math.abs(v)} ${label}`;
    });
  const changedPhrase = `${opts.projectsChanged} projects and ${opts.wosChanged} work orders changed since last sync`;
  if (nonzero.length === 0) {
    return `${head} ${changedPhrase}.`;
  }
  return `${head} ${changedPhrase} (${nonzero.join(", ")}).`;
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
    async observe(since: number): Promise<Omit<Observation, "id" | "created_at">[]> {
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

      const projectRows = await client.listProjectStatuses();
      const woRows = await client.listWorkOrderStatuses();

      let changedProjects: ProjectStatusRow[] = [];
      let changedWorkOrders: WorkOrderStatusRow[] = [];
      if (since > 0) {
        const sinceIso = new Date(since).toISOString();
        changedProjects = await client.listChangedProjects(sinceIso, 50);
        changedWorkOrders = await client.listChangedWorkOrders(sinceIso, 50);
      }

      const projectStatusCounts = tallyByStatus(projectRows);
      const woStatusCounts = tallyByStatus(woRows);

      const metrics: Record<string, number> = {
        projects_total: projectRows.length,
        work_orders_total: woRows.length,
        projects_changed: changedProjects.length,
        wos_changed: changedWorkOrders.length,
        ...flattenCounts("project_status", projectStatusCounts),
        ...flattenCounts("wo_status", woStatusCounts),
      };

      if (prior) {
        Object.assign(
          metrics,
          computeDeltas("project_status", projectStatusCounts, prior.projectStatusCounts),
          computeDeltas("wo_status", woStatusCounts, prior.woStatusCounts),
        );
      }

      return [
        {
          source: "coperniq",
          topic: "coperniq-ops",
          timestamp: Date.now(),
          summary: composeSummary({
            projectsTotal: projectRows.length,
            woTotal: woRows.length,
            projectsChanged: changedProjects.length,
            wosChanged: changedWorkOrders.length,
            deltas: Object.fromEntries(
              Object.entries(metrics).filter(([k]) => k.startsWith("delta_")),
            ) as Record<string, number>,
            isFirstRun: prior === null,
          }),
          data: {
            lastSyncAt: meta?.lastSyncAt ?? null,
            projectStatusCounts,
            woStatusCounts,
            changedProjects,
            changedWorkOrders,
          },
          metrics,
        },
      ];
    },
  };
}
