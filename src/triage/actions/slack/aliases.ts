/**
 * Alias → Slack user ID map.
 *
 * Serves two callers:
 *   1. Planner prompt — first-name keys resolve "DM ridge" → { user_id: "U..." }.
 *   2. Oracle people-directory — email keys map Firestore project owners/salesReps
 *      to their Slack ID so high-confidence recommendations can DM them.
 *
 * First-name entries resolved 2026-06-09 via Slack `users.list`.
 * Email entries resolved 2026-06-19 via Slack `users.lookupByEmail` for
 * the veropwr.com emails that appeared in the first Oracle smoke.
 */
export const SLACK_USER_ALIASES: Record<string, string> = {
  // First-name shortcuts (planner)
  kaleb: "U07KRVD2867", // Kaleb Lundquist (primary operator)
  ridge: "U096S2FQTUZ", // Ridge Payne
  jordan: "U0AAVS535AB", // Jordan Evans
  sam: "U0AB51A9J9H", // Sam LeSueur

  // Email-keyed entries (oracle DM routing).
  // Only people who should actually receive Oracle DMs go here. The oracle
  // still generates per-person markdown files for everyone with assignees
  // in Firestore — DMs are the opt-in surface.
  "daxton@veropwr.com": "U0AB9B36PM4", // Daxton Dillon
  "clay@veropwr.com": "U0ABF0QGM0C", // Clay Neser
};
