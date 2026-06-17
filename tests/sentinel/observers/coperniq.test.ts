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
