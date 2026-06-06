import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
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
