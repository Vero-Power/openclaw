import { describe, it, expect, vi } from "vitest";
import { createReplyInThreadAction } from "../../../../src/triage/actions/slack/reply-in-thread.js";
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

describe("reply_in_thread action", () => {
  it("declares correct metadata", () => {
    const action = createReplyInThreadAction({ client: makeClient(), token: "xoxb-fake" });
    expect(action.name).toBe("reply_in_thread");
    expect(action.external_effect).toBe(true);
    expect(action.idempotent).toBe(false);
  });

  it("validates args — rejects missing thread_ts", () => {
    const action = createReplyInThreadAction({ client: makeClient(), token: "xoxb-fake" });
    expect(() => action.args_schema.parse({ channel: "C0123", text: "hello" })).toThrow();
  });

  it("passes thread_ts through to postMessage", async () => {
    const postFn = vi.fn(async () => ({ ok: true, ts: "12345.678" }));
    const openFn = vi.fn(async () => ({ ok: true, channel: { id: "D_UNUSED" } }));
    const client: SlackClientLike = {
      chat: { postMessage: postFn },
      conversations: { open: openFn },
    };
    const action = createReplyInThreadAction({ client, token: "xoxb-test" });

    const result = await action.invoke(
      { channel: "C0123456789", thread_ts: "1700000000.123456", text: "got it!" },
      fakeCtx(),
    );

    expect(postFn).toHaveBeenCalledWith({
      token: "xoxb-test",
      channel: "C0123456789",
      thread_ts: "1700000000.123456",
      text: "got it!",
    });
    expect(openFn).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });

  it("validates args — rejects empty channel", () => {
    const action = createReplyInThreadAction({ client: makeClient(), token: "xoxb-fake" });
    expect(() =>
      action.args_schema.parse({ channel: "", thread_ts: "1700000000.1", text: "hi" }),
    ).toThrow();
  });
});
