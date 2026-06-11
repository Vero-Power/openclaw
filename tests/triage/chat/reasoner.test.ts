import { describe, it, expect, vi } from "vitest";
import { Reasoner } from "../../../src/triage/chat/reasoner.js";
import type { LlmClient } from "../../../src/triage/llm-client.js";

function makeStubLlm(response: string): LlmClient {
  return {
    complete: async () => response,
  };
}

describe("Reasoner", () => {
  it("parses a valid JSON response", async () => {
    const stub = makeStubLlm(
      JSON.stringify({ findings: "User is saying hello.", confidence: 0.9 }),
    );
    const reasoner = new Reasoner(stub);
    const result = await reasoner.reason({ userMessage: "hey" });
    expect(result.findings).toBe("User is saying hello.");
    expect(result.confidence).toBe(0.9);
  });

  it("strips markdown fences before parsing", async () => {
    const stub = makeStubLlm(
      "```json\n" + JSON.stringify({ findings: "Asking for status.", confidence: 0.8 }) + "\n```",
    );
    const reasoner = new Reasoner(stub);
    const result = await reasoner.reason({ userMessage: "what's the status?" });
    expect(result.findings).toBe("Asking for status.");
    expect(result.confidence).toBe(0.8);
  });

  it("returns fallback on unparseable LLM output", async () => {
    const stub = makeStubLlm("not json at all");
    const reasoner = new Reasoner(stub);
    const result = await reasoner.reason({ userMessage: "whatever" });
    expect(result.findings).toContain("unparseable");
    expect(result.confidence).toBe(0);
  });

  it("returns fallback when LLM throws", async () => {
    const stub: LlmClient = {
      complete: async () => {
        throw new Error("network error");
      },
    };
    const reasoner = new Reasoner(stub);
    const result = await reasoner.reason({ userMessage: "hi" });
    expect(result.findings).toContain("unavailable");
    expect(result.confidence).toBe(0);
  });

  it("includes the context block in the prompt when provided", async () => {
    const complete = vi.fn().mockResolvedValue('{"findings": "f", "confidence": 0.9}');
    const reasoner = new Reasoner({ complete });
    await reasoner.reason({
      userMessage: "did you send it?",
      contextBlock: "JR: I've queued a message to Ridge.",
    });
    expect(complete.mock.calls[0][0]).toContain("I've queued a message to Ridge.");
  });

  it("renders (none) when no context block", async () => {
    const complete = vi.fn().mockResolvedValue('{"findings": "f", "confidence": 0.9}');
    const reasoner = new Reasoner({ complete });
    await reasoner.reason({ userMessage: "hello" });
    expect(complete.mock.calls[0][0]).toContain("(none)");
  });
});
