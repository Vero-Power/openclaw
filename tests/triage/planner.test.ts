import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir as os_tmpdir } from "node:os";
import { join as path_join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { openSentinelDb } from "../../src/sentinel/db.js";
import { ActionRegistry } from "../../src/triage/actions/registry.js";
import type { CatalogAction } from "../../src/triage/actions/types.js";
import type { LlmClient } from "../../src/triage/llm-client.js";
import { Planner } from "../../src/triage/planner.js";
import type { Plan } from "../../src/triage/types.js";

function buildRegistry(): ActionRegistry {
  const reg = new ActionRegistry();
  const ingest: CatalogAction<{}, {}> = {
    name: "coperniqFirestoreIngest",
    description: "Sync Coperniq → Firestore.",
    args_schema: z.object({}).strict(),
    idempotent: true,
    external_effect: false,
    invoke: async () => ({}),
  };
  reg.register(ingest);
  return reg;
}

const fakeLlm = (response: string): LlmClient => ({
  complete: vi.fn(async () => response),
});

describe("Planner", () => {
  it("parses a valid JSON plan", async () => {
    const llm = fakeLlm(
      JSON.stringify({
        summary: "Refresh Coperniq cache",
        confidence: 0.9,
        steps: [{ action: "coperniqFirestoreIngest", args: {}, rationale: "user asked" }],
      }),
    );
    const p = new Planner(llm, buildRegistry());
    const plan = await p.plan("refresh the Coperniq cache");
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].action).toBe("coperniqFirestoreIngest");
    expect(plan.confidence).toBe(0.9);
  });

  it("rejects a plan that references an unknown action", async () => {
    const llm = fakeLlm(
      JSON.stringify({
        summary: "Do stuff",
        confidence: 0.9,
        steps: [{ action: "doesnt_exist", args: {} }],
      }),
    );
    const p = new Planner(llm, buildRegistry());
    await expect(p.plan("do stuff")).rejects.toThrow(/unknown action.*doesnt_exist/);
  });

  it("rejects a plan with args that fail the action's schema", async () => {
    const reg = new ActionRegistry();
    const strict: CatalogAction<{ x: number }, {}> = {
      name: "strict_one",
      description: "needs number x",
      args_schema: z.object({ x: z.number() }),
      idempotent: true,
      external_effect: false,
      invoke: async () => ({}),
    };
    reg.register(strict);
    const llm = fakeLlm(
      JSON.stringify({
        summary: "wrong arg",
        confidence: 0.9,
        steps: [{ action: "strict_one", args: { x: "not a number" } }],
      }),
    );
    const p = new Planner(llm, reg);
    await expect(p.plan("do strict")).rejects.toThrow(/invalid args/i);
  });

  it("replans with edit_text and previous plan", async () => {
    const prev: Plan = {
      summary: "initial",
      confidence: 0.8,
      steps: [{ action: "coperniqFirestoreIngest", args: {} }],
    };
    const llm = fakeLlm(
      JSON.stringify({
        summary: "Revised: just ingest, no extras",
        confidence: 0.9,
        steps: [{ action: "coperniqFirestoreIngest", args: {} }],
      }),
    );
    const p = new Planner(llm, buildRegistry());
    const updated = await p.replan("refresh coperniq", prev, "skip any extras");
    expect(updated.summary).toContain("Revised");
  });
});

describe("Planner — sentinel context injection (F1)", () => {
  it("includes sentinel insights in the planner prompt when provided", async () => {
    const tmpDir = mkdtempSync(path_join(os_tmpdir(), "sent-f1-"));
    const sentDbPath = path_join(tmpDir, "sentinel.db");
    const sentDb = openSentinelDb(sentDbPath);
    sentDb
      .prepare(
        "INSERT INTO insights (category, summary, evidence, derived_from, confidence, generated_at) VALUES (?,?,?,?,?,?)",
      )
      .run("pattern", "BOM volume up 23% WoW", "62 vs 50", "[]", 0.85, Date.now());

    let capturedPrompt = "";
    const llm = {
      complete: vi.fn(async (p: string) => {
        capturedPrompt = p;
        return JSON.stringify({
          summary: "test",
          confidence: 0.9,
          steps: [{ action: "coperniqFirestoreIngest", args: {} }],
        });
      }),
    };
    const p = new Planner(llm as LlmClient, buildRegistry(), { sentinelDb: sentDb });
    await p.plan("refresh coperniq");
    expect(capturedPrompt).toContain("Sentinel context");
    expect(capturedPrompt).toContain("BOM volume up 23%");

    sentDb.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("works with no sentinel context (existing behavior preserved)", async () => {
    const llm = {
      complete: vi.fn(async () =>
        JSON.stringify({
          summary: "test",
          confidence: 0.9,
          steps: [{ action: "coperniqFirestoreIngest", args: {} }],
        }),
      ),
    };
    const p = new Planner(llm as LlmClient, buildRegistry());
    const plan = await p.plan("refresh coperniq");
    expect(plan.steps).toHaveLength(1);
  });
});
