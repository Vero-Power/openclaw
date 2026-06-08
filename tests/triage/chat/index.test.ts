import { describe, it, expect } from "vitest";
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
});
