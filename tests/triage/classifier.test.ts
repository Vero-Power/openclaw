import { describe, it, expect, vi } from "vitest";
import { Classifier } from "../../src/triage/classifier.js";
import type { LlmClient } from "../../src/triage/llm-client.js";

const fakeLlm = (response: string): LlmClient => ({
  complete: vi.fn(async () => response),
});

describe("Classifier", () => {
  it("parses a valid JSON response into ClassifierOutput", async () => {
    const llm = fakeLlm(
      JSON.stringify({ is_task: true, confidence: 0.9, suggested_category: "ops" }),
    );
    const c = new Classifier(llm);
    const out = await c.classify("can you run the BOM notifier for project 42?");
    expect(out.is_task).toBe(true);
    expect(out.confidence).toBe(0.9);
    expect(out.suggested_category).toBe("ops");
  });

  it("defaults to is_task=true on low-confidence parse (per Q12)", async () => {
    const llm = fakeLlm(JSON.stringify({ is_task: false, confidence: 0.3 }));
    const c = new Classifier(llm);
    const out = await c.classify("hmm?");
    expect(out.is_task).toBe(true); // low confidence → flip to task
    expect(out.confidence).toBe(0.3);
  });

  it("defaults to is_task=true on malformed LLM output", async () => {
    const llm = fakeLlm("not json at all");
    const c = new Classifier(llm);
    const out = await c.classify("ok then");
    expect(out.is_task).toBe(true); // unparseable → safe default
    expect(out.confidence).toBe(0); // signal that parsing failed
  });

  it("respects high-confidence not-task as chitchat", async () => {
    const llm = fakeLlm(JSON.stringify({ is_task: false, confidence: 0.95 }));
    const c = new Classifier(llm);
    const out = await c.classify("hi");
    expect(out.is_task).toBe(false);
    expect(out.confidence).toBe(0.95);
  });
});
