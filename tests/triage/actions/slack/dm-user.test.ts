import { describe, it, expect, vi } from "vitest";
import { createDmUserAction } from "../../../../src/triage/actions/slack/dm-user.js";
import type { SlackClientLike } from "../../../../src/triage/actions/slack/types.js";
import type { ActionContext } from "../../../../src/triage/actions/types.js";

function makeClient(channelId = "D_TEST_CHANNEL"): SlackClientLike {
  return {
    chat: {
      postMessage: vi.fn(async () => ({ ok: true, ts: "12345.678" })),
    },
    conversations: {
      open: vi.fn(async () => ({ ok: true, channel: { id: channelId } })),
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

describe("dm_user action", () => {
  it("declares correct metadata", () => {
    const client = makeClient();
    const action = createDmUserAction({ client, token: "xoxb-fake" });
    expect(action.name).toBe("dm_user");
    expect(action.external_effect).toBe(true);
    expect(action.idempotent).toBe(false);
  });

  it("validates args — rejects missing user_id", () => {
    const action = createDmUserAction({ client: makeClient(), token: "xoxb-fake" });
    expect(() => action.args_schema.parse({ text: "hello" })).toThrow();
  });

  it("validates args — rejects empty user_id", () => {
    const action = createDmUserAction({ client: makeClient(), token: "xoxb-fake" });
    expect(() => action.args_schema.parse({ user_id: "", text: "hello" })).toThrow();
  });

  it("opens a DM channel then posts the message", async () => {
    const openFn = vi.fn(async () => ({ ok: true, channel: { id: "D_OPENED" } }));
    const postFn = vi.fn(async () => ({ ok: true, ts: "12345.678" }));
    const client: SlackClientLike = {
      chat: { postMessage: postFn },
      conversations: { open: openFn },
    };
    const action = createDmUserAction({ client, token: "xoxb-test" });

    const result = await action.invoke({ user_id: "U07KRVD2867", text: "hey there" }, fakeCtx());

    expect(openFn).toHaveBeenCalledWith({
      token: "xoxb-test",
      users: "U07KRVD2867",
    });
    expect(postFn).toHaveBeenCalledWith({
      token: "xoxb-test",
      channel: "D_OPENED",
      text: "hey there",
    });
    expect(result).toEqual({ ok: true });
  });

  it("throws when conversations.open returns no channel id", async () => {
    const badClient: SlackClientLike = {
      chat: { postMessage: vi.fn(async () => ({ ok: true })) },
      conversations: { open: vi.fn(async () => ({ ok: false, channel: undefined })) },
    };
    const action = createDmUserAction({ client: badClient, token: "xoxb-test" });
    await expect(action.invoke({ user_id: "U_BAD", text: "oops" }, fakeCtx())).rejects.toThrow(
      /could not open DM channel/,
    );
  });
});
