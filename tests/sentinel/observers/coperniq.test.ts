import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { openSentinelDb } from "../../../src/sentinel/db.js";
import {
  createCoperniqObserver,
  type FirestoreLike,
} from "../../../src/sentinel/observers/coperniq.js";

describe("coperniq observer module", () => {
  it("exports createCoperniqObserver and the FirestoreLike type", () => {
    expect(typeof createCoperniqObserver).toBe("function");
    const client: FirestoreLike = {
      getSyncMeta: async () => null,
      listProjectStatuses: async () => [],
      listWorkOrderStatuses: async () => [],
      listChangedProjects: async () => [],
      listChangedWorkOrders: async () => [],
    };
    expect(typeof client.getSyncMeta).toBe("function");
  });
});

function tmpSentinelDb(): string {
  return join(
    tmpdir(),
    `sentinel-coperniq-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
}

function cleanupDb(path: string): void {
  for (const suffix of ["", "-shm", "-wal"]) {
    const f = `${path}${suffix}`;
    if (existsSync(f)) {
      unlinkSync(f);
    }
  }
}

function makeFakeClient(overrides: Partial<FirestoreLike> = {}): FirestoreLike {
  return {
    getSyncMeta: overrides.getSyncMeta ?? (async () => null),
    listProjectStatuses: overrides.listProjectStatuses ?? (async () => []),
    listWorkOrderStatuses: overrides.listWorkOrderStatuses ?? (async () => []),
    listChangedProjects: overrides.listChangedProjects ?? (async () => []),
    listChangedWorkOrders: overrides.listChangedWorkOrders ?? (async () => []),
  };
}

describe("createCoperniqObserver — watermark skip", () => {
  let dbPath: string;
  let db: DatabaseType;

  beforeEach(() => {
    dbPath = tmpSentinelDb();
    db = openSentinelDb(dbPath);
  });

  afterEach(() => {
    db.close();
    cleanupDb(dbPath);
  });

  it("returns [] when lastSyncAt matches the prior observation's lastSyncAt", async () => {
    const lastSyncAt = "2026-06-17T12:00:00.000Z";
    db.prepare(
      `INSERT INTO observations (source, topic, timestamp, summary, data, metrics, created_at) VALUES (?,?,?,?,?,?,?)`,
    ).run(
      "coperniq",
      "coperniq-ops",
      Date.now() - 60_000,
      "prior",
      JSON.stringify({ lastSyncAt, projectStatusCounts: {}, woStatusCounts: {} }),
      JSON.stringify({ projects_total: 0, work_orders_total: 0 }),
      Date.now() - 60_000,
    );

    let metaRead = 0;
    let collectionsRead = 0;
    const client = makeFakeClient({
      getSyncMeta: async () => {
        metaRead++;
        return { lastSyncAt };
      },
      listProjectStatuses: async () => {
        collectionsRead++;
        return [];
      },
      listWorkOrderStatuses: async () => {
        collectionsRead++;
        return [];
      },
    });

    const obs = createCoperniqObserver({ db, getClient: async () => client });
    const out = await obs.observe(0);

    expect(out).toEqual([]);
    expect(metaRead).toBe(1);
    expect(collectionsRead).toBe(0);
  });
});

describe("createCoperniqObserver — first-run snapshot", () => {
  let dbPath: string;
  let db: DatabaseType;

  beforeEach(() => {
    dbPath = tmpSentinelDb();
    db = openSentinelDb(dbPath);
  });

  afterEach(() => {
    db.close();
    cleanupDb(dbPath);
  });

  it("emits one observation with counts when there is no prior observation", async () => {
    const client = makeFakeClient({
      getSyncMeta: async () => ({ lastSyncAt: "2026-06-17T12:00:00.000Z" }),
      listProjectStatuses: async () => [
        { id: "p1", status: "in_progress" },
        { id: "p2", status: "in_progress" },
        { id: "p3", status: "complete" },
      ],
      listWorkOrderStatuses: async () => [
        { id: "w1", status: "assigned" },
        { id: "w2", status: "done" },
        { id: "w3", status: "done" },
        { id: "w4", status: "done" },
      ],
    });

    const obs = createCoperniqObserver({ db, getClient: async () => client });
    const out = await obs.observe(0);

    expect(out).toHaveLength(1);
    const o = out[0];
    expect(o.source).toBe("coperniq");
    expect(o.topic).toBe("coperniq-ops");
    expect(o.metrics).toMatchObject({
      projects_total: 3,
      work_orders_total: 4,
      project_status_in_progress: 2,
      project_status_complete: 1,
      wo_status_assigned: 1,
      wo_status_done: 3,
    });
    const metricKeys = Object.keys(o.metrics ?? {});
    expect(metricKeys.some((k) => k.startsWith("delta_"))).toBe(false);
    expect(o.data).toMatchObject({
      lastSyncAt: "2026-06-17T12:00:00.000Z",
      projectStatusCounts: { in_progress: 2, complete: 1 },
      woStatusCounts: { assigned: 1, done: 3 },
    });
  });

  it("treats null status as 'unknown'", async () => {
    const client = makeFakeClient({
      getSyncMeta: async () => ({ lastSyncAt: "2026-06-17T12:00:00.000Z" }),
      listProjectStatuses: async () => [
        { id: "p1", status: null },
        { id: "p2", status: "complete" },
      ],
      listWorkOrderStatuses: async () => [],
    });
    const obs = createCoperniqObserver({ db, getClient: async () => client });
    const out = await obs.observe(0);
    expect(out[0].metrics).toMatchObject({
      project_status_unknown: 1,
      project_status_complete: 1,
    });
  });
});

describe("createCoperniqObserver — deltas", () => {
  let dbPath: string;
  let db: DatabaseType;

  beforeEach(() => {
    dbPath = tmpSentinelDb();
    db = openSentinelDb(dbPath);
  });

  afterEach(() => {
    db.close();
    cleanupDb(dbPath);
  });

  it("emits delta metrics relative to the most recent prior observation", async () => {
    // prior: 2 in_progress, 1 complete projects; 5 assigned, 10 done WOs
    db.prepare(
      `INSERT INTO observations (source, topic, timestamp, summary, data, metrics, created_at) VALUES (?,?,?,?,?,?,?)`,
    ).run(
      "coperniq",
      "coperniq-ops",
      Date.now() - 7_200_000,
      "prior",
      JSON.stringify({
        lastSyncAt: "2026-06-17T10:00:00.000Z",
        projectStatusCounts: { in_progress: 2, complete: 1 },
        woStatusCounts: { assigned: 5, done: 10 },
      }),
      JSON.stringify({}),
      Date.now() - 7_200_000,
    );

    // current: 1 in_progress, 2 complete projects; 3 assigned, 12 done, 1 review WOs
    const client = makeFakeClient({
      getSyncMeta: async () => ({ lastSyncAt: "2026-06-17T12:00:00.000Z" }),
      listProjectStatuses: async () => [
        { id: "p1", status: "in_progress" },
        { id: "p2", status: "complete" },
        { id: "p3", status: "complete" },
      ],
      listWorkOrderStatuses: async () => [
        ...Array.from({ length: 3 }, (_, i) => ({ id: `a${i}`, status: "assigned" })),
        ...Array.from({ length: 12 }, (_, i) => ({ id: `d${i}`, status: "done" })),
        { id: "r1", status: "review" },
      ],
    });

    const obs = createCoperniqObserver({ db, getClient: async () => client });
    const out = await obs.observe(0);
    expect(out).toHaveLength(1);

    const m = out[0].metrics ?? {};
    // project deltas
    expect(m.delta_project_status_in_progress).toBe(-1);
    expect(m.delta_project_status_complete).toBe(1);
    // wo deltas
    expect(m.delta_wo_status_assigned).toBe(-2);
    expect(m.delta_wo_status_done).toBe(2);
    expect(m.delta_wo_status_review).toBe(1);
  });

  it("does not include zero-delta keys", async () => {
    db.prepare(
      `INSERT INTO observations (source, topic, timestamp, summary, data, metrics, created_at) VALUES (?,?,?,?,?,?,?)`,
    ).run(
      "coperniq",
      "coperniq-ops",
      Date.now() - 1000,
      "prior",
      JSON.stringify({
        lastSyncAt: "2026-06-17T10:00:00.000Z",
        projectStatusCounts: { in_progress: 2 },
        woStatusCounts: { done: 5 },
      }),
      JSON.stringify({}),
      Date.now() - 1000,
    );

    const client = makeFakeClient({
      getSyncMeta: async () => ({ lastSyncAt: "2026-06-17T12:00:00.000Z" }),
      listProjectStatuses: async () => [
        { id: "p1", status: "in_progress" },
        { id: "p2", status: "in_progress" },
      ],
      listWorkOrderStatuses: async () =>
        Array.from({ length: 5 }, (_, i) => ({ id: `d${i}`, status: "done" })),
    });

    const obs = createCoperniqObserver({ db, getClient: async () => client });
    const out = await obs.observe(0);
    const metricKeys = Object.keys(out[0].metrics ?? {});
    expect(metricKeys.some((k) => k.startsWith("delta_"))).toBe(false);
  });
});

describe("createCoperniqObserver — changed-doc detail", () => {
  let dbPath: string;
  let db: DatabaseType;

  beforeEach(() => {
    dbPath = tmpSentinelDb();
    db = openSentinelDb(dbPath);
  });

  afterEach(() => {
    db.close();
    cleanupDb(dbPath);
  });

  it("queries listChangedProjects/WorkOrders with sinceIso derived from `since`, cap 50", async () => {
    const sinceMs = Date.UTC(2026, 5, 16, 0, 0, 0); // 2026-06-16T00:00:00.000Z
    let projectQueryArgs: { sinceIso: string; limit: number } | null = null;
    let woQueryArgs: { sinceIso: string; limit: number } | null = null;

    const client = makeFakeClient({
      getSyncMeta: async () => ({ lastSyncAt: "2026-06-17T12:00:00.000Z" }),
      listProjectStatuses: async () => [],
      listWorkOrderStatuses: async () => [],
      listChangedProjects: async (sinceIso, limit) => {
        projectQueryArgs = { sinceIso, limit };
        return [
          { id: "p1", status: "complete", title: "Doe roof" },
          { id: "p2", status: "in_progress", title: "Smith roof" },
        ];
      },
      listChangedWorkOrders: async (sinceIso, limit) => {
        woQueryArgs = { sinceIso, limit };
        return [{ id: "w1", status: "done", title: "Install crew dispatch" }];
      },
    });

    const obs = createCoperniqObserver({ db, getClient: async () => client });
    const out = await obs.observe(sinceMs);

    expect(projectQueryArgs).toEqual({ sinceIso: "2026-06-16T00:00:00.000Z", limit: 50 });
    expect(woQueryArgs).toEqual({ sinceIso: "2026-06-16T00:00:00.000Z", limit: 50 });

    const data = out[0].data as { changedProjects: unknown[]; changedWorkOrders: unknown[] };
    expect(data.changedProjects).toHaveLength(2);
    expect(data.changedWorkOrders).toHaveLength(1);
    expect(out[0].metrics).toMatchObject({ projects_changed: 2, wos_changed: 1 });
  });

  it("does not call listChanged* when since=0 (first observation ever)", async () => {
    let called = false;
    const client = makeFakeClient({
      getSyncMeta: async () => ({ lastSyncAt: "2026-06-17T12:00:00.000Z" }),
      listProjectStatuses: async () => [],
      listWorkOrderStatuses: async () => [],
      listChangedProjects: async () => {
        called = true;
        return [];
      },
      listChangedWorkOrders: async () => {
        called = true;
        return [];
      },
    });
    const obs = createCoperniqObserver({ db, getClient: async () => client });
    const out = await obs.observe(0);
    expect(called).toBe(false);
    expect(out[0].metrics).toMatchObject({ projects_changed: 0, wos_changed: 0 });
  });
});
