/**
 * Human-readable name → Slack user ID map.
 * Injected into the planner prompt so the LLM can resolve "DM ridge"
 * to { user_id: "U..." } without asking the operator.
 *
 * Resolved via Slack `users.list` API on 2026-06-09.
 */
export const SLACK_USER_ALIASES: Record<string, string> = {
  kaleb: "U07KRVD2867", // Kaleb Lundquist (primary operator)
  ridge: "U096S2FQTUZ", // Ridge Payne
  jordan: "U0AAVS535AB", // Jordan Evans
  sam: "U0AB51A9J9H", // Sam LeSueur
};
