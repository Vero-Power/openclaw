export interface OptOutDetectorResult {
  matched: boolean;
  phrase?: string;
}

const OPT_OUT_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /stop asking/i, label: "stop asking" },
  { pattern: /leave me alone/i, label: "leave me alone" },
  { pattern: /no more (questions|asking)/i, label: "no more questions/asking" },
  { pattern: /unsubscribe/i, label: "unsubscribe" },
  { pattern: /don'?t (ask|bother)/i, label: "don't ask/bother" },
];

export function detectOptOut(text: string): OptOutDetectorResult {
  for (const { pattern, label } of OPT_OUT_PATTERNS) {
    if (pattern.test(text)) {
      return { matched: true, phrase: label };
    }
  }
  return { matched: false };
}
