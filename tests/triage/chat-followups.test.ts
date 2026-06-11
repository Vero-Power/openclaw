import { describe, it, expect, vi } from "vitest";
import { handleChatMessage } from "../../src/triage/chat/index.js";
import { Reasoner } from "../../src/triage/chat/reasoner.js";
import type { LlmClient } from "../../src/triage/llm-client.js";

describe("chat-v2 follow-up filing", () => {
  it("reasoner parses optional followups array", async () => {
    const llm: LlmClient = {
      complete: vi.fn().mockResolvedValue(
        JSON.stringify({
          findings: "user wants ridge asked",
          confidence: 0.9,
          followups: [
            {
              kind: "dm_person",
              payload: { target_alias: "ridge", topic: "t", question_text: "q" },
            },
          ],
        }),
      ),
    };
    const out = await new Reasoner(llm).reason({
      userMessage: "ask ridge about t",
      followups: { enabled: true, knownAliases: ["ridge", "kaleb"] },
    });
    expect(out.followups).toHaveLength(1);
    expect(out.followups![0].kind).toBe("dm_person");
  });

  it("reasoner prompt includes followup instructions only when enabled", async () => {
    const complete = vi.fn().mockResolvedValue(JSON.stringify({ findings: "f", confidence: 0.5 }));
    const llm: LlmClient = { complete };
    await new Reasoner(llm).reason({
      userMessage: "hi",
      followups: { enabled: true, knownAliases: ["ridge"] },
    });
    expect(complete.mock.calls[0][0]).toContain("followups");
    expect(complete.mock.calls[0][0]).toContain("ridge");
    complete.mockClear();
    await new Reasoner(llm).reason({ userMessage: "hi" });
    expect(complete.mock.calls[0][0]).not.toContain('"followups"');
  });

  it("handleChatMessage files followups before responding and tells the responder", async () => {
    const calls: string[] = [];
    const llm: LlmClient = {
      complete: vi.fn().mockImplementation((prompt: string) => {
        if (prompt.includes("private reasoner")) {
          calls.push("reasoner");
          return Promise.resolve(
            JSON.stringify({
              findings: "wants ridge asked",
              confidence: 0.9,
              followups: [
                {
                  kind: "dm_person",
                  payload: { target_alias: "ridge", topic: "t", question_text: "q" },
                },
              ],
            }),
          );
        }
        calls.push("responder");
        expect(prompt).toContain("queued a DM to ridge");
        return Promise.resolve(JSON.stringify({ reply: "Queued a message to Ridge." }));
      }),
    };
    const fileFollowup = vi.fn().mockImplementation(() => {
      calls.push("file");
      return Promise.resolve("queued a DM to ridge about t");
    });
    const slackPost = vi.fn().mockResolvedValue(undefined);
    await handleChatMessage(
      { userMessage: "ask ridge about t", channel: "D1", isDm: true, requesterUserId: "U_K" },
      { llm, slackPost, fileFollowup, followupAliases: ["ridge"] },
    );
    expect(calls).toEqual(["reasoner", "file", "responder"]);
    expect(fileFollowup).toHaveBeenCalledWith({
      kind: "dm_person",
      payload: { target_alias: "ridge", topic: "t", question_text: "q" },
    });
    expect(slackPost).toHaveBeenCalledWith({
      channel: "D1",
      thread_ts: undefined,
      text: "Queued a message to Ridge.",
    });
  });

  it("filing failure → responder told nothing was queued", async () => {
    const llm: LlmClient = {
      complete: vi.fn().mockImplementation((prompt: string) => {
        if (prompt.includes("private reasoner")) {
          return Promise.resolve(
            JSON.stringify({
              findings: "f",
              confidence: 0.9,
              followups: [{ kind: "note", payload: { text: "x" } }],
            }),
          );
        }
        expect(prompt).toContain("NOTHING was queued");
        return Promise.resolve(JSON.stringify({ reply: "Couldn't queue that." }));
      }),
    };
    const fileFollowup = vi.fn().mockResolvedValue(null);
    const slackPost = vi.fn().mockResolvedValue(undefined);
    await handleChatMessage(
      { userMessage: "remember x", channel: "D1", isDm: true, requesterUserId: "U_K" },
      { llm, slackPost, fileFollowup, followupAliases: [] },
    );
    expect(slackPost).toHaveBeenCalled();
  });

  it("no fileFollowup dep → reasoner not asked for followups, nothing filed", async () => {
    const complete = vi.fn().mockImplementation((prompt: string) => {
      if (prompt.includes("private reasoner")) {
        expect(prompt).not.toContain('"followups"');
        return Promise.resolve(JSON.stringify({ findings: "f", confidence: 0.5 }));
      }
      return Promise.resolve(JSON.stringify({ reply: "hi" }));
    });
    const slackPost = vi.fn().mockResolvedValue(undefined);
    await handleChatMessage(
      { userMessage: "hi", channel: "D1", isDm: true },
      { llm: { complete }, slackPost },
    );
    expect(slackPost).toHaveBeenCalled();
  });
});
