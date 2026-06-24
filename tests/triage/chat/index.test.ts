import { describe, expect, it, vi } from "vitest";
import { openSentinelDb } from "../../../src/sentinel/db.js";
import { encodeEmbedding } from "../../../src/sentinel/embeddings/blob-codec.js";
import type { GeminiEmbeddingAdapter } from "../../../src/sentinel/embeddings/gemini-adapter.js";
import { createEmbeddingService } from "../../../src/sentinel/embeddings/service.js";
import { handleChatMessage } from "../../../src/triage/chat/index.js";
import type { ChatHandlerDeps } from "../../../src/triage/chat/index.js";
import type { LlmClient } from "../../../src/triage/llm-client.js";

function makeStubLlm(reasonerJson: string, responderJson: string): LlmClient {
  let callCount = 0;
  return {
    complete: async () => {
      callCount += 1;
      return callCount === 1 ? reasonerJson : responderJson;
    },
  };
}

describe("handleChatMessage", () => {
  it("calls slackPost exactly once with the responder reply", async () => {
    const reasonerResponse = JSON.stringify({ findings: "User greeting.", confidence: 0.9 });
    const responderResponse = JSON.stringify({ reply: "Hey there!" });
    const llm = makeStubLlm(reasonerResponse, responderResponse);

    const posts: Array<{ channel: string; thread_ts?: string; text: string }> = [];
    const deps: ChatHandlerDeps = {
      llm,
      slackPost: async (params) => {
        posts.push(params);
      },
    };

    await handleChatMessage({ userMessage: "hey", channel: "C123", isDm: true }, deps);

    expect(posts).toHaveLength(1);
    expect(posts[0].text).toBe("Hey there!");
    expect(posts[0].channel).toBe("C123");
  });

  it("does NOT set thread_ts for DM channels", async () => {
    const llm = makeStubLlm(
      JSON.stringify({ findings: "dm chat", confidence: 0.8 }),
      JSON.stringify({ reply: "sure" }),
    );
    const posts: Array<{ channel: string; thread_ts?: string; text: string }> = [];
    const deps: ChatHandlerDeps = {
      llm,
      slackPost: async (params) => {
        posts.push(params);
      },
    };

    await handleChatMessage(
      { userMessage: "hi", channel: "D999", isDm: true, threadTs: "999.000" },
      deps,
    );

    expect(posts[0].thread_ts).toBeUndefined();
  });

  it("sets thread_ts for channel mentions", async () => {
    const llm = makeStubLlm(
      JSON.stringify({ findings: "channel mention", confidence: 0.85 }),
      JSON.stringify({ reply: "on it" }),
    );
    const posts: Array<{ channel: string; thread_ts?: string; text: string }> = [];
    const deps: ChatHandlerDeps = {
      llm,
      slackPost: async (params) => {
        posts.push(params);
      },
    };

    await handleChatMessage(
      { userMessage: "hey JR", channel: "C456", isDm: false, threadTs: "111.222" },
      deps,
    );

    expect(posts[0].thread_ts).toBe("111.222");
  });

  it("still posts when reasoner fails (fallback findings)", async () => {
    let callCount = 0;
    const llm: LlmClient = {
      complete: async () => {
        callCount += 1;
        if (callCount === 1) {
          throw new Error("reasoner down");
        }
        return JSON.stringify({ reply: "fallback reply" });
      },
    };
    const posts: Array<{ channel: string; thread_ts?: string; text: string }> = [];
    const deps: ChatHandlerDeps = {
      llm,
      slackPost: async (params) => {
        posts.push(params);
      },
    };

    await handleChatMessage(
      { userMessage: "hi", channel: "C789", isDm: false, threadTs: "ts1" },
      deps,
    );

    expect(posts).toHaveLength(1);
    expect(posts[0].text).toBe("fallback reply");
  });

  it("posts a fallback text when responder also fails", async () => {
    const llm: LlmClient = {
      complete: async () => {
        throw new Error("both down");
      },
    };
    const posts: Array<{ channel: string; thread_ts?: string; text: string }> = [];
    const deps: ChatHandlerDeps = {
      llm,
      slackPost: async (params) => {
        posts.push(params);
      },
    };

    await handleChatMessage(
      { userMessage: "hi", channel: "C000", isDm: false, threadTs: "ts2" },
      deps,
    );

    expect(posts).toHaveLength(1);
    expect(posts[0].text).toContain("trouble");
  });

  it("passes convoContext.full to the reasoner and .history to the responder", async () => {
    const calls: string[] = [];
    const complete = vi.fn().mockImplementation(async (prompt: string) => {
      calls.push(prompt);
      return calls.length === 1 ? '{"findings": "f", "confidence": 0.9}' : '{"reply": "ok"}';
    });
    const slackPost = vi.fn().mockResolvedValue(undefined);
    await handleChatMessage(
      {
        userMessage: "did you send it?",
        channel: "D1",
        isDm: true,
        convoContext: { full: "FULL-BLOCK-MARKER", history: "HISTORY-ONLY-MARKER" },
      },
      { llm: { complete }, slackPost },
    );
    expect(calls[0]).toContain("FULL-BLOCK-MARKER"); // reasoner gets full
    expect(calls[1]).toContain("HISTORY-ONLY-MARKER"); // responder gets history
    expect(calls[1]).not.toContain("FULL-BLOCK-MARKER");
  });
});

function unitVector(i: number): Float32Array {
  const v = new Float32Array(768);
  v[i] = 1;
  return v;
}

describe("handleChatMessage — RAG context", () => {
  it("prepends RAG block to contextBlock when embeddings + sentinelDb wired", async () => {
    const db = openSentinelDb(`:memory:?id=${Math.random()}`);
    db.prepare(
      `INSERT INTO insights (category, summary, evidence, generated_at, confidence, embedding)
       VALUES ('operations', 'cancellation rate at 22%', '[]', 1, 0.85, ?)`,
    ).run(encodeEmbedding(unitVector(0)));

    const adapter: GeminiEmbeddingAdapter = {
      async embed() {
        return unitVector(0);
      },
    };
    const embeddings = createEmbeddingService({ db, adapter });

    const capturedPrompts: string[] = [];
    const llm: LlmClient = {
      complete: vi.fn(async (prompt: string) => {
        capturedPrompts.push(prompt);
        // Reasoner response — empty findings, no followups
        if (prompt.includes("Conversation context:")) {
          return JSON.stringify({ findings: "none", confidence: 0.5, followups: [] });
        }
        // Responder response
        return "got it";
      }),
    };

    const slackPosts: Array<{ channel: string; text: string }> = [];
    await handleChatMessage(
      {
        userMessage: "what's going on with cancellations?",
        channel: "D12345",
        isDm: true,
      },
      {
        llm,
        slackPost: async (p) => {
          slackPosts.push({ channel: p.channel, text: p.text });
        },
        embeddings,
        sentinelDb: db,
      },
    );

    expect(slackPosts).toHaveLength(1);
    // Reasoner prompt (first LLM call) should include the RAG block
    const reasonerPrompt = capturedPrompts[0] ?? "";
    expect(reasonerPrompt).toContain("Relevant knowledge from JR's memory:");
    expect(reasonerPrompt).toContain("cancellation rate at 22%");
  });

  it("works without embeddings/sentinelDb — falls back to normal flow", async () => {
    const llm: LlmClient = {
      complete: vi.fn(async (prompt: string) => {
        if (prompt.includes("Conversation context:")) {
          return JSON.stringify({ findings: [], followups: [] });
        }
        return "no context reply";
      }),
    };

    const slackPosts: Array<{ channel: string; text: string }> = [];
    await handleChatMessage(
      { userMessage: "hi", channel: "D12345", isDm: true },
      {
        llm,
        slackPost: async (p) => {
          slackPosts.push({ channel: p.channel, text: p.text });
        },
      },
    );

    expect(slackPosts).toHaveLength(1);
  });
});
