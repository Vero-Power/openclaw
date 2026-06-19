import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { openSentinelDb } from "../../../../src/sentinel/db.js";
import { buildRecentResearchContext } from "../../../../src/sentinel/observers/external-context/recent-research.js";

function tmpDb(): string {
  return join(tmpdir(), `sentinel-rr-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function cleanup(path: string): void {
  for (const suffix of ["", "-shm", "-wal"]) {
    const f = `${path}${suffix}`;
    if (existsSync(f)) {
      unlinkSync(f);
    }
  }
}

function seed(
  db: DatabaseType,
  rows: Array<{ summary: string; confidence: string; published_at: string | null; ageMs: number }>,
): void {
  const stmt = db.prepare(
    `INSERT INTO observations (source, topic, timestamp, summary, data, metrics, created_at) VALUES (?,?,?,?,?,?,?)`,
  );
  for (const r of rows) {
    const ts = Date.now() - r.ageMs;
    stmt.run(
      "external-context",
      "external:solar",
      ts,
      r.summary,
      JSON.stringify({
        confidence: r.confidence,
        published_at: r.published_at,
        cited_urls: [],
        trace: [],
      }),
      JSON.stringify({}),
      ts,
    );
  }
}

describe("buildRecentResearchContext", () => {
  let dbPath: string;
  let db: DatabaseType;

  beforeEach(() => {
    dbPath = tmpDb();
    db = openSentinelDb(dbPath);
  });

  afterEach(() => {
    db.close();
    cleanup(dbPath);
  });

  it("returns empty-state blob when no prior research rows exist", () => {
    const out = buildRecentResearchContext(db, 7 * 24 * 60 * 60 * 1000);
    expect(out).toContain("No prior research");
    expect(out).toContain("RECENT RESEARCH");
  });

  it("formats rows newest-first with confidence + published_at", () => {
    seed(db, [
      {
        summary: "Old finding",
        confidence: "low",
        published_at: "2026-06-12",
        ageMs: 5 * 24 * 60 * 60 * 1000,
      },
      {
        summary: "Newer finding",
        confidence: "high",
        published_at: "2026-06-19",
        ageMs: 1 * 60 * 60 * 1000,
      },
    ]);
    const out = buildRecentResearchContext(db, 7 * 24 * 60 * 60 * 1000);
    expect(out).toContain("Newer finding");
    expect(out).toContain("Old finding");
    expect(out).toContain("confidence: high");
    expect(out).toContain("published: 2026-06-19");
    const newerIdx = out.indexOf("Newer finding");
    const olderIdx = out.indexOf("Old finding");
    expect(newerIdx).toBeLessThan(olderIdx);
  });

  it("excludes rows older than the window", () => {
    seed(db, [
      {
        summary: "In window",
        confidence: "medium",
        published_at: "2026-06-18",
        ageMs: 1 * 60 * 60 * 1000,
      },
      {
        summary: "Out of window",
        confidence: "medium",
        published_at: "2026-05-01",
        ageMs: 30 * 24 * 60 * 60 * 1000,
      },
    ]);
    const out = buildRecentResearchContext(db, 7 * 24 * 60 * 60 * 1000);
    expect(out).toContain("In window");
    expect(out).not.toContain("Out of window");
  });

  it("caps results at maxEntries", () => {
    const rows = [];
    for (let i = 0; i < 25; i++) {
      rows.push({
        summary: `Finding ${i}`,
        confidence: "medium",
        published_at: null,
        ageMs: i * 1000,
      });
    }
    seed(db, rows);
    const out = buildRecentResearchContext(db, 7 * 24 * 60 * 60 * 1000, { maxEntries: 5 });
    const matches = out.match(/Finding \d+/g) ?? [];
    expect(matches.length).toBe(5);
  });

  it("handles missing confidence / published_at gracefully", () => {
    db.prepare(
      `INSERT INTO observations (source, topic, timestamp, summary, data, metrics, created_at) VALUES (?,?,?,?,?,?,?)`,
    ).run(
      "external-context",
      "external:solar",
      Date.now(),
      "Sparse data finding",
      JSON.stringify({ cited_urls: [], trace: [] }), // no confidence, no published_at
      JSON.stringify({}),
      Date.now(),
    );
    const out = buildRecentResearchContext(db, 7 * 24 * 60 * 60 * 1000);
    expect(out).toContain("Sparse data finding");
    expect(out).toContain("confidence: unknown");
    expect(out).toContain("published: unknown");
  });
});
