import type { Recommendation } from "../../../sentinel/oracle/store.js";

const TRIGGER_PHRASES = [
  "what should i do",
  "whats on my plate",
  "what's on my plate",
  "give me priorities",
  "oracle wisdom",
  "whats important",
  "what's important",
];

const URGENCY_RANK: Record<Recommendation["urgency"], number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const MAX_REPLY_ITEMS = 5;

export function detectActionRecommendationIntent(message: string): boolean {
  const lower = message.toLowerCase();
  return TRIGGER_PHRASES.some((p) => lower.includes(p));
}

export function formatRecommendationsReply(recs: Recommendation[]): string {
  if (recs.length === 0) {
    return "Nothing on your plate right now. I'll keep watching.";
  }
  const sorted = [...recs]
    .toSorted((a, b) => URGENCY_RANK[b.urgency] - URGENCY_RANK[a.urgency])
    .slice(0, MAX_REPLY_ITEMS);
  const lines = sorted.map((r) => `• *${r.title}* [${r.urgency}]\n  ${r.rationale}`);
  return `Top of your plate:\n\n${lines.join("\n\n")}`;
}
