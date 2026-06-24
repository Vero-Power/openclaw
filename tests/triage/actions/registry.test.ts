import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";
import { ActionRegistry, bootstrapActionCatalog } from "../../../src/triage/actions/index.js";
import type { SlackClientLike } from "../../../src/triage/actions/slack/types.js";
import type { CatalogAction } from "../../../src/triage/actions/types.js";

const echoAction: CatalogAction<{ msg: string }, { echoed: string }> = {
  name: "echo",
  description: "Echo a message back.",
  args_schema: z.object({ msg: z.string() }),
  idempotent: true,
  external_effect: false,
  invoke: async (args) => ({ echoed: args.msg }),
};

const sendAction: CatalogAction<{ to: string }, { sent: boolean }> = {
  name: "send_email",
  description: "Send an email.",
  args_schema: z.object({ to: z.string().email() }),
  idempotent: false,
  external_effect: true,
  invoke: async () => ({ sent: true }),
};

describe("ActionRegistry", () => {
  let reg: ActionRegistry;

  beforeEach(() => {
    reg = new ActionRegistry();
  });

  it("registers and looks up an action by name", () => {
    reg.register(echoAction);
    expect(reg.get("echo")?.name).toBe("echo");
  });

  it("rejects duplicate registration", () => {
    reg.register(echoAction);
    expect(() => reg.register(echoAction)).toThrow(/already registered/);
  });

  it("returns null for unknown action", () => {
    expect(reg.get("nonexistent")).toBeNull();
  });

  it("validates args via the schema before invoke", async () => {
    reg.register(sendAction);
    await expect(reg.invoke("send_email", { to: "not-an-email" }, fakeCtx())).rejects.toThrow(
      /Invalid/,
    );
  });

  it("invokes the action with valid args", async () => {
    reg.register(echoAction);
    const result = await reg.invoke("echo", { msg: "hi" }, fakeCtx());
    expect(result).toEqual({ echoed: "hi" });
  });

  it("serializes registered actions for the planner prompt", () => {
    reg.register(echoAction);
    reg.register(sendAction);
    const serialized = reg.serializeForPrompt();
    expect(serialized).toContain("echo");
    expect(serialized).toContain("Echo a message back.");
    expect(serialized).toContain("send_email");
    expect(serialized).toContain("⚠️"); // marks external_effect
  });
});

function fakeCtx() {
  return {
    request_id: "test",
    slack_post: async () => ({ ts: "t" }),
    slack_edit: async () => {},
    logger: {
      info: (_msg: string, _meta?: Record<string, unknown>) => {},
      error: (_msg: string, _meta?: Record<string, unknown>) => {},
      warn: (_msg: string, _meta?: Record<string, unknown>) => {},
    },
  };
}

function makeSlackClient(): SlackClientLike {
  return {
    chat: { postMessage: vi.fn(async () => ({ ok: true })) },
    conversations: { open: vi.fn(async () => ({ ok: true, channel: { id: "D_FAKE" } })) },
  };
}

describe("bootstrapActionCatalog", () => {
  const BASE_ACTIONS = [
    "coperniqFirestoreIngest",
    "firestoreCollections",
    "firestoreKeys",
    "firestoreGet",
    "firestoreQuery",
    "firestoreCount",
  ];

  it("with no deps registers the base action set", () => {
    const reg = bootstrapActionCatalog();
    const names = reg.list().map((a) => a.name);
    expect(names).toEqual(expect.arrayContaining(BASE_ACTIONS));
    expect(names).toHaveLength(BASE_ACTIONS.length);
  });

  it("with empty deps object registers the base action set", () => {
    const reg = bootstrapActionCatalog({});
    const names = reg.list().map((a) => a.name);
    expect(names).toEqual(expect.arrayContaining(BASE_ACTIONS));
    expect(names).toHaveLength(BASE_ACTIONS.length);
  });

  it("with slackClient but no botToken does not register Slack actions", () => {
    const reg = bootstrapActionCatalog({ slackClient: makeSlackClient() });
    const names = reg.list().map((a) => a.name);
    expect(names).toEqual(expect.arrayContaining(BASE_ACTIONS));
    expect(names).toHaveLength(BASE_ACTIONS.length);
  });

  it("with both slackClient and botToken registers base + Slack actions", () => {
    const reg = bootstrapActionCatalog({ slackClient: makeSlackClient(), botToken: "xoxb-fake" });
    const names = reg.list().map((a) => a.name);
    for (const n of BASE_ACTIONS) {
      expect(names).toContain(n);
    }
    expect(names).toContain("dm_user");
    expect(names).toContain("post_to_channel");
    expect(names).toContain("reply_in_thread");
    expect(names).toHaveLength(BASE_ACTIONS.length + 3);
  });
});
