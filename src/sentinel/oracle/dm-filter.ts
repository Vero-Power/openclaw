import type { Recommendation } from "./store.js";

// Title-similarity dedupe (gate 1) — avoid spamming an assignee with multiple
// near-duplicate recommendations within a window. Compares titles using the
// Dice coefficient on normalized tokens (Sørensen–Dice = 2|A∩B|/(|A|+|B|),
// more forgiving than Jaccard for longer titles). Threshold 0.3 catches the
// real "TDLR registration" / "SB 1036 compliance" dupe family without
// collapsing legitimately distinct recs that happen to share one word.

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "with",
  "new",
  "&",
]);

function tokenize(title: string): Set<string> {
  const words = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return new Set(words);
}

export function titleSimilarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const t of ta) {
    if (tb.has(t)) {
      intersection++;
    }
  }
  return (2 * intersection) / (ta.size + tb.size);
}

export const TITLE_SIMILARITY_THRESHOLD = 0.3;

export function isDuplicateOfRecent(
  newTitle: string,
  recentTitles: string[],
  threshold: number = TITLE_SIMILARITY_THRESHOLD,
): boolean {
  for (const t of recentTitles) {
    if (titleSimilarity(newTitle, t) >= threshold) {
      return true;
    }
  }
  return false;
}

// Vero-specific evidence gate (gate 2) — keep the DM channel for recs that
// reference our own data; route industry-news / consultant-shape recs to
// the per-person file only (still visible, just not interrupting).
//
// Heuristic: rationale + joined evidence must contain BOTH (a) at least one
// digit (a number, percentage, dollar amount, or date) AND (b) at least one
// Vero-specific anchor term OR a hard date pattern. The anchor list is small
// and bias-toward-recall — false-positives here are fine; the cost of a
// missed legitimate DM is higher than the cost of one extra DM.

const VERO_ANCHORS = [
  "project",
  "work order",
  "workorder",
  "triage",
  "install",
  "cancellation",
  "coperniq",
  "vero",
  "pipeline",
  "lead",
  "deal",
  "permit",
  "ahj",
  "system size",
  "kw",
  "commission",
  "payout",
  "tdlr",
  "sb 1036",
  "sb 1202",
  "registration deadline",
];

const DATE_PATTERN =
  /\b(20\d{2}|jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(tember)?|oct(ober)?|nov(ember)?|dec(ember)?)\b/i;

function recText(rec: Recommendation): string {
  const evidenceText = Array.isArray(rec.evidence) ? rec.evidence.join(" ") : "";
  return `${rec.title} ${rec.rationale} ${evidenceText}`.toLowerCase();
}

export interface EvidenceQuality {
  ok: boolean;
  reason?: string;
}

export function hasActionableEvidence(rec: Recommendation): EvidenceQuality {
  const text = recText(rec);
  const hasDigit = /\d/.test(text);
  if (!hasDigit) {
    return { ok: false, reason: "no quantitative claim (no digits in title/rationale/evidence)" };
  }
  const hasAnchor = VERO_ANCHORS.some((a) => text.includes(a));
  const hasDate = DATE_PATTERN.test(text);
  if (!hasAnchor && !hasDate) {
    return {
      ok: false,
      reason: "no Vero-specific anchor and no hard date — looks like industry-news",
    };
  }
  return { ok: true };
}
