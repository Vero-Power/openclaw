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

  // Email-keyed entries (oracle DM routing)
  "daxton@veropwr.com": "U0AB9B36PM4", // Daxton Dillon
  "zachary.burton@veropwr.com": "U0AD1KCM5LG", // Zachary Burton
  "thomas.morrow@veropwr.com": "U0AC5MH81A4", // Thomas Morrow
  "junrey@veropwr.com": "U0ANZHCH360", // Junrey Sullano
  "clay@veropwr.com": "U0ABF0QGM0C", // Clay Neser
};
