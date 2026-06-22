import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { openSentinelDb } from "../../src/sentinel/db.js";
import { runObservers } from "../../src/sentinel/observer-runner.js";
import { ObserverRegistry, type Observer } from "../../src/sentinel/observer.js";

const SENTINEL_DB = join(tmpdir(), `sentinel-runner-${Date.now()}.db`);

describe("observer runner", () => {
  afterEach(() => {
    if (existsSync(SENTINEL_DB)) {
      unlinkSync(SENTINEL_DB);
    }
    if (existsSync(`${SENTINEL_DB}-shm`)) {
      unlinkSync(`${SENTINEL_DB}-shm`);
    }
    if (existsSync(`${SENTINEL_DB}-wal`)) {
      unlinkSync(`${SENTINEL_DB}-wal`);
    }
  });

  it("runs registered observers in parallel and writes results to sentinel.db", async () => {
    const db = openSentinelDb(SENTINEL_DB);
    const reg = new ObserverRegistry();
    const fakeObs: Observer = {
      name: "fake-a",
      observe: async () => [
        {
          source: "fake-a",
          topic: "test",
          timestamp: Date.now(),
          summary: "fake-a saw something",
          metrics: { count: 7 },
        },
      ],
    };
    const fakeObsB: Observer = {
      name: "fake-b",
      observe: async () => [
        {
          source: "fake-b",
          topic: "test",
          timestamp: Date.now(),
          summary: "fake-b saw something else",
        },
      ],
    };
    reg.register(fakeObs);
    reg.register(fakeObsB);

    const result = await runObservers({ registry: reg, db });
    expect(result.observationsWritten).toBe(2);

    const rows = db
      .prepare("SELECT source, summary, metrics FROM observations ORDER BY id")
      .all() as Array<{ source: string; summary: string; metrics: string | null }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].source).toBe("fake-a");
    expect(rows[1].source).toBe("fake-b");
    expect(JSON.parse(rows[0].metrics ?? "{}").count).toBe(7);

    db.close();
  });

  it("updates observer_watermarks after each successful observation", async () => {
    const db = openSentinelDb(SENTINEL_DB);
    const reg = new ObserverRegistry();
    reg.register({
      name: "ticker",
      observe: async () => [{ source: "ticker", timestamp: Date.now(), summary: "tick" }],
    });

    await runObservers({ registry: reg, db });
    const wm = db.prepare("SELECT * FROM observer_watermarks WHERE source = ?").get("ticker") as
      | { source: string; last_observed_at: number }
      | undefined;
    expect(wm?.source).toBe("ticker");
    expect(wm?.last_observed_at).toBeGreaterThan(0);

    db.close();
  });

  it("embeds each inserted observation when an EmbeddingService is provided", async () => {
    const db = openSentinelDb(SENTINEL_DB);
    const reg = new ObserverRegistry();
    reg.register({
      name: "embed-me",
      observe: async () => [
        { source: "embed-me", timestamp: Date.now(), summary: "alpha" },
        { source: "embed-me", timestamp: Date.now(), summary: "beta" },
      ],
    });

    const calls: Array<{ table: string; id: string | number; text: string }> = [];
    const embeddings = {
      embed: async () => new Float32Array(768),
      findSimilar: async () => [],
      embedAndStore: async (
        table: "observations" | "insights" | "oracle_recommendations",
        id: string | number,
        text: string,
      ) => {
        calls.push({ table, id, text });
      },
    };

    const result = await runObservers({ registry: reg, db, embeddings });
    expect(result.observationsWritten).toBe(2);
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.table === "observations")).toBe(true);
    expect(calls.map((c) => c.text).toSorted()).toEqual(["alpha", "beta"]);
    // ids should be the actual lastInsertRowid values
    const ids = db.prepare("SELECT id FROM observations ORDER BY id").all() as Array<{
      id: number;
    }>;
    expect(calls.map((c) => c.id).toSorted((a, b) => Number(a) - Number(b))).toEqual(
      ids.map((r) => r.id),
    );

    db.close();
  });

  it("works without an EmbeddingService (existing callers stay compatible)", async () => {
    const db = openSentinelDb(SENTINEL_DB);
    const reg = new ObserverRegistry();
    reg.register({
      name: "plain",
      observe: async () => [{ source: "plain", timestamp: Date.now(), summary: "no embeddings" }],
    });
    const result = await runObservers({ registry: reg, db });
    expect(result.observationsWritten).toBe(1);
    db.close();
  });

  it("isolates failures: one observer throwing does not block others", async () => {
    const db = openSentinelDb(SENTINEL_DB);
    const reg = new ObserverRegistry();
    reg.register({
      name: "broken",
      observe: async () => {
        throw new Error("kaboom");
      },
    });
    reg.register({
      name: "fine",
      observe: async () => [{ source: "fine", timestamp: Date.now(), summary: "still working" }],
    });

    const result = await runObservers({ registry: reg, db });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].observer).toBe("broken");
    expect(result.observationsWritten).toBe(1);

    db.close();
  });
});
