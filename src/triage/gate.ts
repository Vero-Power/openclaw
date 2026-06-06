export interface GateInput {
  user: string;
  bot_id: string | undefined;
  channel: string;
  text: string;
  jr_user_id: string;
  allowed_channels: string[];
}

export interface GateResult {
  eligible: boolean;
  reason?: string;
}

export function slackMessageGate(input: GateInput): GateResult {
  if (process.env.OPENCLAW_TRIAGE_REIMPL !== "1") {
    return { eligible: false, reason: "feature flag OPENCLAW_TRIAGE_REIMPL not set" };
  }
  if (input.bot_id) {
    return { eligible: false, reason: "bot message" };
  }
  if (input.user === input.jr_user_id) {
    return { eligible: false, reason: "self (JR) message" };
  }
  if (!input.allowed_channels.includes("*") && !input.allowed_channels.includes(input.channel)) {
    return { eligible: false, reason: `channel ${input.channel} not in allowlist` };
  }
  return { eligible: true };
}
