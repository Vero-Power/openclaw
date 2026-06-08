import { describe, it, expect } from "vitest";
import { Responder } from "../../../src/triage/chat/responder.js";
import type { LlmClient } from "../../../src/triage/llm-client.js";

function makeStubLlm(response: string): LlmClient {
  return {
    complete: async () => response,
  };
}

describe("Responder", () => {
  it("returns trimmed reply from valid JSON", async () => {
    const stub = makeStubLlm(JSON.stringify({ reply: "  Hey, what's up?  " }));
    const responder = new Responder(stub);
    const result = await responder.respond({
      userMessage: "hey",
      findings: "User is greeting.",
      persona: "Be terse.",
    });
    expect(result).toBe("Hey, what's up?");
  });

  it("strips markdown fences before parsing", async () => {
    const stub = makeStubLlm("```json\n" + JSON.stringify({ reply: "Sure thing." }) + "\n```");
    const responder = new Responder(stub);
    const result = await responder.respond({
      userMessage: "can you help?",
      findings: "User wants help.",
      persona: "Be helpful.",
    });
    expect(result).toBe("Sure thing.");
  });

  it("returns fallback string on unparseable output", async () => {
    const stub = makeStubLlm("this is not json");
    const responder = new Responder(stub);
    const result = await responder.respond({
      userMessage: "hi",
      findings: "greeting",
      persona: "terse",
    });
    expect(result).toContain("formatting");
  });

  it("returns fallback string when LLM throws", async () => {
    const stub: LlmClient = {
      complete: async () => {
        throw new Error("timeout");
      },
    };
    const responder = new Responder(stub);
    const result = await responder.respond({
      userMessage: "hi",
      findings: "greeting",
      persona: "terse",
    });
    expect(result).toContain("trouble");
  });

  it("passes the correct model option", async () => {
    const seenOpts: Array<{ model?: string; temperature?: number }> = [];
    const stub: LlmClient = {
      complete: async (_prompt, opts) => {
        if (opts) {
          seenOpts.push(opts);
        }
        return JSON.stringify({ reply: "ok" });
      },
    };
    const responder = new Responder(stub);
    await responder.respond({ userMessage: "hi", findings: "greeting", persona: "terse" });
    expect(seenOpts[0]?.model).toBe("gemini-flash");
    expect(seenOpts[0]?.temperature).toBe(0.5);
  });
});
