import { describe, it, expect, beforeEach } from "vitest";
import { slackMessageGate } from "../../src/triage/gate.js";

describe("slackMessageGate", () => {
  beforeEach(() => {
    delete process.env.OPENCLAW_TRIAGE_REIMPL;
  });

  it("rejects when OPENCLAW_TRIAGE_REIMPL is unset", () => {
    const out = slackMessageGate({
      user: "U1",
      bot_id: undefined,
      channel: "C1",
      text: "test",
      jr_user_id: "UJR",
      allowed_channels: ["*"],
    });
    expect(out.eligible).toBe(false);
    expect(out.reason).toMatch(/feature flag/i);
  });

  it("rejects bot messages", () => {
    process.env.OPENCLAW_TRIAGE_REIMPL = "1";
    const out = slackMessageGate({
      user: "U1",
      bot_id: "B999",
      channel: "C1",
      text: "test",
      jr_user_id: "UJR",
      allowed_channels: ["*"],
    });
    expect(out.eligible).toBe(false);
    expect(out.reason).toMatch(/bot/i);
  });

  it("rejects JR's own messages", () => {
    process.env.OPENCLAW_TRIAGE_REIMPL = "1";
    const out = slackMessageGate({
      user: "UJR",
      bot_id: undefined,
      channel: "C1",
      text: "test",
      jr_user_id: "UJR",
      allowed_channels: ["*"],
    });
    expect(out.eligible).toBe(false);
    expect(out.reason).toMatch(/self/i);
  });

  it("rejects channels not in allowlist", () => {
    process.env.OPENCLAW_TRIAGE_REIMPL = "1";
    const out = slackMessageGate({
      user: "U1",
      bot_id: undefined,
      channel: "C_BLOCKED",
      text: "test",
      jr_user_id: "UJR",
      allowed_channels: ["C_OK_1", "C_OK_2"],
    });
    expect(out.eligible).toBe(false);
    expect(out.reason).toMatch(/allowlist/i);
  });

  it("accepts when all gates pass (public channel with mention)", () => {
    process.env.OPENCLAW_TRIAGE_REIMPL = "1";
    const out = slackMessageGate({
      user: "U1",
      bot_id: undefined,
      channel: "C_OK_1",
      text: "hey <@UJR> can you help",
      jr_user_id: "UJR",
      allowed_channels: ["C_OK_1"],
    });
    expect(out.eligible).toBe(true);
  });

  it("wildcard '*' allows any channel when mentioned", () => {
    process.env.OPENCLAW_TRIAGE_REIMPL = "1";
    const out = slackMessageGate({
      user: "U1",
      bot_id: undefined,
      channel: "C_ANY",
      text: "hey <@UJR> what's up",
      jr_user_id: "UJR",
      allowed_channels: ["*"],
    });
    expect(out.eligible).toBe(true);
  });

  // DM / mention gate (G1)
  it("DM channel passes without @-mention", () => {
    process.env.OPENCLAW_TRIAGE_REIMPL = "1";
    const out = slackMessageGate({
      user: "U1",
      bot_id: undefined,
      channel: "D123",
      text: "help me with something",
      jr_user_id: "UJR",
      allowed_channels: ["*"],
    });
    expect(out.eligible).toBe(true);
  });

  it("public channel rejects without @-mention", () => {
    process.env.OPENCLAW_TRIAGE_REIMPL = "1";
    const out = slackMessageGate({
      user: "U1",
      bot_id: undefined,
      channel: "C123",
      text: "just some channel noise",
      jr_user_id: "UJR",
      allowed_channels: ["*"],
    });
    expect(out.eligible).toBe(false);
    expect(out.reason).toMatch(/mention/i);
  });

  it("public channel passes with @-mention", () => {
    process.env.OPENCLAW_TRIAGE_REIMPL = "1";
    const out = slackMessageGate({
      user: "U1",
      bot_id: undefined,
      channel: "C123",
      text: "<@UJR> please triage this",
      jr_user_id: "UJR",
      allowed_channels: ["*"],
    });
    expect(out.eligible).toBe(true);
  });

  it("private channel rejects without @-mention", () => {
    process.env.OPENCLAW_TRIAGE_REIMPL = "1";
    const out = slackMessageGate({
      user: "U1",
      bot_id: undefined,
      channel: "G123",
      text: "team status update",
      jr_user_id: "UJR",
      allowed_channels: ["*"],
    });
    expect(out.eligible).toBe(false);
    expect(out.reason).toMatch(/mention/i);
  });
});
