import { describe, it, expect, vi } from "vitest";
import { Auditor } from "../../src/triage/auditor.js";
import type { LlmClient } from "../../src/triage/llm-client.js";
import { appendEntry, emptyBundle } from "../../src/triage/research-bundle.js";
import type { Plan } from "../../src/triage/types.js";

const PLAN: Plan = {
  steps: [{ action: "firestoreCount", args: { collection: "vero_projects" } }],
  confidence: 0.8,
  summary: "count projects",
};

const KNOWN_ACTIONS = new Set([
  "firestoreCollections",
  "firestoreKeys",
  "firestoreGet",
  "firestoreQuery",
  "firestoreCount",
]);

function bundleWithCount(): ReturnType<typeof emptyBundle> {
  return appendEntry(emptyBundle(), {
    step_idx: 0,
    action: "firestoreCount",
    args: { collection: "vero_projects" },
    status: "success",
    result: { count: 224 },
    invoked_at: 1,
  });
}

describe("Auditor", () => {
  it("returns sufficient=true when the LLM says yes", async () => {
    const llm: LlmClient = {
      complete: vi.fn(async () =>
        JSON.stringify({ sufficient: true, rationale: "count answers the question" }),
      ),
    };
    const auditor = new Auditor({ llm, knownActions: KNOWN_ACTIONS });
    const out = await auditor.audit({
      question: "how many projects do we have?",
      plan: PLAN,
      bundle: bundleWithCount(),
    });
    expect(out.sufficient).toBe(true);
    expect(out.additional_steps).toBeUndefined();
  });

  it("returns sufficient=false with valid additional_steps", async () => {
    const llm: LlmClient = {
      complete: vi.fn(async () =>
        JSON.stringify({
          sufficient: false,
          rationale: "user wants details on active projects",
          additional_steps: [
            {
              action: "firestoreQuery",
              args: {
                collection: "vero_projects",
                where: [{ field: "status", op: "==", value: "active" }],
              },
            },
          ],
        }),
      ),
    };
    const auditor = new Auditor({ llm, knownActions: KNOWN_ACTIONS });
    const out = await auditor.audit({
      question: "what are the active projects?",
      plan: PLAN,
      bundle: bundleWithCount(),
    });
    expect(out.sufficient).toBe(false);
    expect(out.additional_steps).toHaveLength(1);
    expect(out.additional_steps?.[0]?.action).toBe("firestoreQuery");
  });

  it("filters out additional_steps that reference unknown actions", async () => {
    const llm: LlmClient = {
      complete: vi.fn(async () =>
        JSON.stringify({
          sufficient: false,
          rationale: "needs more",
          additional_steps: [
            { action: "firestoreQuery", args: { collection: "x" } },
            { action: "nonExistentAction", args: {} },
          ],
        }),
      ),
    };
    const auditor = new Auditor({ llm, knownActions: KNOWN_ACTIONS });
    const out = await auditor.audit({
      question: "details please",
      plan: PLAN,
      bundle: bundleWithCount(),
    });
    expect(out.sufficient).toBe(false);
    expect(out.additional_steps).toHaveLength(1);
    expect(out.additional_steps?.[0]?.action).toBe("firestoreQuery");
  });

  it("caps additional_steps at 3 even if the LLM proposes more", async () => {
    const llm: LlmClient = {
      complete: vi.fn(async () =>
        JSON.stringify({
          sufficient: false,
          rationale: "lots more",
          additional_steps: Array.from({ length: 7 }, () => ({
            action: "firestoreQuery",
            args: { collection: "x" },
          })),
        }),
      ),
    };
    const auditor = new Auditor({ llm, knownActions: KNOWN_ACTIONS });
    const out = await auditor.audit({
      question: "?",
      plan: PLAN,
      bundle: bundleWithCount(),
    });
    expect(out.additional_steps).toHaveLength(3);
  });

  it("degrades to sufficient=true when the LLM throws", async () => {
    const llm: LlmClient = {
      complete: vi.fn(async () => {
        throw new Error("gemini down");
      }),
    };
    const auditor = new Auditor({ llm, knownActions: KNOWN_ACTIONS });
    const out = await auditor.audit({
      question: "?",
      plan: PLAN,
      bundle: bundleWithCount(),
    });
    expect(out.sufficient).toBe(true);
    expect(out.rationale).toMatch(/audit failed|degraded/);
  });

  it("degrades to sufficient=true when the LLM returns malformed JSON", async () => {
    const llm: LlmClient = {
      complete: vi.fn(async () => "not json at all"),
    };
    const auditor = new Auditor({ llm, knownActions: KNOWN_ACTIONS });
    const out = await auditor.audit({
      question: "?",
      plan: PLAN,
      bundle: bundleWithCount(),
    });
    expect(out.sufficient).toBe(true);
  });
});
