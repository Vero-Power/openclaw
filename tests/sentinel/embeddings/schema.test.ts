import { describe, it, expect } from "vitest";
import { openSentinelDb } from "../../../src/sentinel/db.js";

describe("sentinel schema — embedding columns", () => {
  it("fresh install has embedding BLOB on all three target tables", () => {
    const db = openSentinelDb(":memory:");
    try {
      const obsCols = db.prepare("PRAGMA table_info(observations)").all() as Array<{
        name: string;
        type: string;
      }>;
      const insCols = db.prepare("PRAGMA table_info(insights)").all() as Array<{
        name: string;
        type: string;
      }>;
      const recCols = db.prepare("PRAGMA table_info(oracle_recommendations)").all() as Array<{
        name: string;
        type: string;
      }>;
      expect(obsCols.find((c) => c.name === "embedding")?.type).toBe("BLOB");
      expect(insCols.find((c) => c.name === "embedding")?.type).toBe("BLOB");
      expect(recCols.find((c) => c.name === "embedding")?.type).toBe("BLOB");
    } finally {
      db.close();
    }
  });

  it("running openSentinelDb twice on the same path is idempotent (no duplicate-column error)", () => {
    const path = `/tmp/sentinel-schema-test-${Date.now()}.db`;
    let db1: ReturnType<typeof openSentinelDb> | null = null;
    let db2: ReturnType<typeof openSentinelDb> | null = null;
    try {
      db1 = openSentinelDb(path);
      db1.close();
      // Re-open: ALTER TABLE statements should swallow "duplicate column" cleanly.
      db2 = openSentinelDb(path);
      const recCols = db2.prepare("PRAGMA table_info(oracle_recommendations)").all() as Array<{
        name: string;
      }>;
      expect(recCols.find((c) => c.name === "embedding")).toBeDefined();
    } finally {
      if (db2?.open) {
        db2.close();
      }
      if (db1?.open) {
        db1.close();
      }
      try {
        require("node:fs").unlinkSync(path);
      } catch {
        /* ignore */
      }
    }
  });
});
