/**
 * Human-readable name → Slack user ID map.
 * Operators fill in real IDs here (or via future config-driven override).
 * These are injected into the planner prompt so the LLM can resolve
 * "DM ridge" to { user_id: "U..." } without asking the operator.
 */
export const SLACK_USER_ALIASES: Record<string, string> = {
  kaleb: "U07KRVD2867",
  // Ridge, Jordan, Sam — operator to fill in real IDs
  // ridge: "U...",
  // jordan: "U...",
  // sam: "U...",
};
