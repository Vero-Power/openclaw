import { describe, it, expect, vi } from "vitest";
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

  it("salvages plain-text LLM output as the reply (not the formatting fallback)", async () => {
    const stub = makeStubLlm("this is not json");
    const responder = new Responder(stub);
    const result = await responder.respond({
      userMessage: "hi",
      findings: "greeting",
      persona: "terse",
    });
    // The salvage path uses the raw text directly so the user sees the model's
    // actual words instead of "Sorry — I had trouble formatting my response."
    expect(result).toBe("this is not json");
  });

  it("falls back to the formatting message when output looks like broken JSON", async () => {
    const stub = makeStubLlm("{ broken json fragment");
    const responder = new Responder(stub);
    const result = await responder.respond({
      userMessage: "hi",
      findings: "greeting",
      persona: "terse",
    });
    expect(result).toContain("formatting");
  });

  it("extracts reply from <final>...</final> tag-wrapped output (strips <think> reasoning)", async () => {
    const tagged =
      '<think>The user is asking about solar. Be terse.</think><final>{"reply": "Solar = sunlight → electricity. What specifically?"}</final>';
    const stub = makeStubLlm(tagged);
    const responder = new Responder(stub);
    const result = await responder.respond({
      userMessage: "what about solar?",
      findings: "knowledge question",
      persona: "terse",
    });
    expect(result).toBe("Solar = sunlight → electricity. What specifically?");
  });

  it("strips standalone <think> blocks even without <final> wrap", async () => {
    const taggedNoFinal = '<think>internal reasoning</think>\n{"reply": "Got it."}';
    const stub = makeStubLlm(taggedNoFinal);
    const responder = new Responder(stub);
    const result = await responder.respond({
      userMessage: "ok",
      findings: "ack",
      persona: "terse",
    });
    expect(result).toBe("Got it.");
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

  it("includes conversation history in the prompt when provided", async () => {
    const complete = vi.fn().mockResolvedValue('{"reply": "ok"}');
    const responder = new Responder({ complete });
    await responder.respond({
      userMessage: "did you send it?",
      findings: "f",
      persona: "p",
      conversationHistory: "JR: I've queued a message to Ridge.",
    });
    expect(complete.mock.calls[0][0]).toContain("I've queued a message to Ridge.");
    expect(complete.mock.calls[0][0]).toContain("Recent conversation");
  });

  it("omits the history block when absent", async () => {
    const complete = vi.fn().mockResolvedValue('{"reply": "ok"}');
    const responder = new Responder({ complete });
    await responder.respond({ userMessage: "hi", findings: "f", persona: "p" });
    expect(complete.mock.calls[0][0]).not.toContain("Recent conversation");
  });
});
