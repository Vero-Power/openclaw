import { describe, it, expect, vi } from "vitest";
import { createPostToChannelAction } from "../../../../src/triage/actions/slack/post-to-channel.js";
import type { SlackClientLike } from "../../../../src/triage/actions/slack/types.js";
import type { ActionContext } from "../../../../src/triage/actions/types.js";

function makeClient(): SlackClientLike {
  return {
    chat: {
      postMessage: vi.fn(async () => ({ ok: true, ts: "12345.678" })),
    },
    conversations: {
      open: vi.fn(async () => ({ ok: true, channel: { id: "D_UNUSED" } })),
    },
  };
}

function fakeCtx(): ActionContext {
  return {
    request_id: "test-req",
    slack_post: async () => ({ ts: "t" }),
    slack_edit: async () => {},
    logger: {
      info: (_msg: string, _meta?: Record<string, unknown>) => {},
      error: (_msg: string, _meta?: Record<string, unknown>) => {},
      warn: (_msg: string, _meta?: Record<string, unknown>) => {},
    },
  };
}

describe("post_to_channel action", () => {
  it("declares correct metadata", () => {
    const action = createPostToChannelAction({ client: makeClient(), token: "xoxb-fake" });
    expect(action.name).toBe("post_to_channel");
    expect(action.external_effect).toBe(true);
    expect(action.idempotent).toBe(false);
  });

  it("validates args — rejects missing channel_id", () => {
    const action = createPostToChannelAction({ client: makeClient(), token: "xoxb-fake" });
    expect(() => action.args_schema.parse({ text: "hello" })).toThrow();
  });

  it("validates args — rejects empty text", () => {
    const action = createPostToChannelAction({ client: makeClient(), token: "xoxb-fake" });
    expect(() => action.args_schema.parse({ channel_id: "C0123", text: "" })).toThrow();
  });

  it("posts the message directly to the given channel_id", async () => {
    const postFn = vi.fn(async () => ({ ok: true, ts: "12345.678" }));
    const openFn = vi.fn(async () => ({ ok: true, channel: { id: "D_UNUSED" } }));
    const client: SlackClientLike = {
      chat: { postMessage: postFn },
      conversations: { open: openFn },
    };
    const action = createPostToChannelAction({ client, token: "xoxb-test" });

    const result = await action.invoke(
      { channel_id: "C0123456789", text: "announcement!" },
      fakeCtx(),
    );

    expect(postFn).toHaveBeenCalledWith({
      token: "xoxb-test",
      channel: "C0123456789",
      text: "announcement!",
    });
    expect(openFn).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });
});
