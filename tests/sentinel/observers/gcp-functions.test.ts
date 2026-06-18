import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { openSentinelDb } from "../../../src/sentinel/db.js";
import {
  createGcpFunctionsObserver,
  type LogEntry,
  type LoggingLike,
} from "../../../src/sentinel/observers/gcp-functions.js";

describe("gcp-functions observer module", () => {
  it("exports createGcpFunctionsObserver and the LoggingLike type", () => {
    expect(typeof createGcpFunctionsObserver).toBe("function");
    const client: LoggingLike = {
      listFunctionEntries: async () => [],
    };
    expect(typeof client.listFunctionEntries).toBe("function");
  });
});

function tmpSentinelDb(): string {
  return join(tmpdir(), `sentinel-gcpfn-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function cleanupDb(path: string): void {
  for (const suffix of ["", "-shm", "-wal"]) {
    const f = `${path}${suffix}`;
    if (existsSync(f)) {
      unlinkSync(f);
    }
  }
}

function makeFakeClient(entriesByFunction: Record<string, LogEntry[]> = {}): LoggingLike {
  return {
    listFunctionEntries: async (serviceName: string) => entriesByFunction[serviceName] ?? [],
  };
}

describe("createGcpFunctionsObserver — first-run tally", () => {
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

  it("emits one observation with per-function invocations + errors", async () => {
    const client = makeFakeClient({
      bomQuoteNotifier: [
        { timestamp: "2026-06-17T20:30:00Z", severity: "INFO", text: "ok" },
        { timestamp: "2026-06-17T20:31:00Z", severity: "INFO", text: "ok" },
        { timestamp: "2026-06-17T20:32:00Z", severity: "ERROR", text: "boom" },
      ],
      ghlFirestoreIngest: [
        { timestamp: "2026-06-17T20:45:00Z", severity: "CRITICAL", text: "ouch" },
      ],
    });

    const obs = createGcpFunctionsObserver({ db, getClient: async () => client });
    const out = await obs.observe(0);

    expect(out).toHaveLength(1);
    const o = out[0];
    expect(o.source).toBe("gcp-functions");
    expect(o.topic).toBe("gcp-functions");
    expect(o.metrics).toMatchObject({
      invocations_total: 4,
      errors_total: 2,
      bomquotenotifier_invocations: 3,
      bomquotenotifier_errors: 1,
      ghlfirestoreingest_invocations: 1,
      ghlfirestoreingest_errors: 1,
      finaldesignsender_invocations: 0,
      finaldesignsender_errors: 0,
    });
    const metricKeys = Object.keys(o.metrics ?? {});
    expect(metricKeys.some((k) => k.startsWith("delta_"))).toBe(false);
  });

  it("data.functions preserves the hard-coded function order", async () => {
    const obs = createGcpFunctionsObserver({ db, getClient: async () => makeFakeClient() });
    const out = await obs.observe(0);
    const data = out[0].data as { functions: Array<{ name: string }> };
    expect(data.functions.map((f) => f.name)).toEqual([
      "bomQuoteNotifier",
      "finalDesignSender",
      "signedDesignPlansetReview",
      "coperniqFirestoreIngest",
      "ghlFirestoreIngest",
      "slackFirestoreIngest",
    ]);
  });

  it("calls listFunctionEntries once per function with the same sinceIso", async () => {
    const calls: Array<{ name: string; sinceIso: string }> = [];
    const client: LoggingLike = {
      listFunctionEntries: async (name, sinceIso) => {
        calls.push({ name, sinceIso });
        return [];
      },
    };
    const obs = createGcpFunctionsObserver({ db, getClient: async () => client });
    await obs.observe(0);
    expect(calls).toHaveLength(6);
    const uniqueSinceIsos = new Set(calls.map((c) => c.sinceIso));
    expect(uniqueSinceIsos.size).toBe(1);
    const sinceMs = Date.parse([...uniqueSinceIsos][0]);
    const expectedMs = Date.now() - 2 * 60 * 60 * 1000;
    expect(Math.abs(sinceMs - expectedMs)).toBeLessThan(5000);
  });
});

describe("createGcpFunctionsObserver — last_invocation_at + last_error", () => {
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

  it("picks the newest entry by timestamp for last_invocation_at", async () => {
    const client = makeFakeClient({
      bomQuoteNotifier: [
        { timestamp: "2026-06-17T20:30:00Z", severity: "INFO", text: "old" },
        { timestamp: "2026-06-17T20:45:00Z", severity: "INFO", text: "newest" },
        { timestamp: "2026-06-17T20:35:00Z", severity: "INFO", text: "middle" },
      ],
    });
    const obs = createGcpFunctionsObserver({ db, getClient: async () => client });
    const out = await obs.observe(0);
    const data = out[0].data as {
      functions: Array<{ name: string; last_invocation_at: string | null }>;
    };
    const bom = data.functions.find((f) => f.name === "bomQuoteNotifier");
    expect(bom?.last_invocation_at).toBe("2026-06-17T20:45:00Z");
  });

  it("last_invocation_at is null when no entries", async () => {
    const obs = createGcpFunctionsObserver({ db, getClient: async () => makeFakeClient() });
    const out = await obs.observe(0);
    const data = out[0].data as { functions: Array<{ last_invocation_at: string | null }> };
    expect(data.functions.every((f) => f.last_invocation_at === null)).toBe(true);
  });

  it("last_error picks the newest error-severity entry, truncated to 300 chars", async () => {
    const longText = "X".repeat(500);
    const client = makeFakeClient({
      bomQuoteNotifier: [
        { timestamp: "2026-06-17T20:30:00Z", severity: "ERROR", text: "old err" },
        { timestamp: "2026-06-17T20:45:00Z", severity: "ERROR", text: longText },
        { timestamp: "2026-06-17T20:50:00Z", severity: "INFO", text: "not an error" },
      ],
    });
    const obs = createGcpFunctionsObserver({ db, getClient: async () => client });
    const out = await obs.observe(0);
    const data = out[0].data as {
      functions: Array<{ name: string; last_error: { ts: string; text: string } | null }>;
    };
    const bom = data.functions.find((f) => f.name === "bomQuoteNotifier");
    expect(bom?.last_error?.ts).toBe("2026-06-17T20:45:00Z");
    expect(bom?.last_error?.text).toHaveLength(300);
    expect(bom?.last_error?.text).toMatch(/^X+$/);
  });

  it("last_error is null when no error-severity entries", async () => {
    const client = makeFakeClient({
      bomQuoteNotifier: [
        { timestamp: "2026-06-17T20:30:00Z", severity: "INFO", text: "ok" },
        { timestamp: "2026-06-17T20:31:00Z", severity: "WARNING", text: "yellow" },
      ],
    });
    const obs = createGcpFunctionsObserver({ db, getClient: async () => client });
    const out = await obs.observe(0);
    const data = out[0].data as { functions: Array<{ name: string; last_error: unknown }> };
    const bom = data.functions.find((f) => f.name === "bomQuoteNotifier");
    expect(bom?.last_error).toBeNull();
  });
});
