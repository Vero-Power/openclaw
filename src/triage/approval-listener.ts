export type ApprovalSignal =
  | { kind: "approve" }
  | { kind: "cancel" }
  | { kind: "edit"; edit_text: string }
  | { kind: "ignore" };

const APPROVE_REGEX = /^(yes|y|go|do it|approve|run it|proceed|send it|✅|👍|👍🏼|👍🏻|👍🏽|👍🏾|👍🏿)$/i;
const CANCEL_REGEX = /^(no|n|stop|cancel|abort|nvm|nm|🛑|❌)$/i;

export function parseApprovalReply(raw: string): ApprovalSignal {
  const text = raw.trim();
  if (text.length === 0) {
    return { kind: "ignore" };
  }
  if (APPROVE_REGEX.test(text)) {
    return { kind: "approve" };
  }
  if (CANCEL_REGEX.test(text)) {
    return { kind: "cancel" };
  }
  return { kind: "edit", edit_text: text };
}
