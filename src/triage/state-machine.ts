import type { TriageState } from "./types.js";

const TRANSITIONS: Record<TriageState, ReadonlySet<TriageState>> = {
  PENDING_CLASSIFY: new Set(["CLASSIFIED", "CANCELLED", "ABANDONED"]),
  CLASSIFIED: new Set(["RESEARCHING", "PLAYBOOK_MATCHED", "PLANNING", "CANCELLED", "ABANDONED"]),
  RESEARCHING: new Set(["PLANNING", "CANCELLED", "ABANDONED"]),
  PLANNING: new Set(["AWAITING_APPROVAL", "CANCELLED", "ABANDONED"]),
  PLAYBOOK_MATCHED: new Set(["AWAITING_APPROVAL", "EXECUTING", "CANCELLED", "ABANDONED"]),
  AWAITING_APPROVAL: new Set(["EDITING", "EXECUTING", "CANCELLED", "ABANDONED"]),
  EDITING: new Set(["AWAITING_APPROVAL", "CANCELLED", "ABANDONED"]),
  EXECUTING: new Set(["COMPLETE", "FAILED_AT_STEP", "CANCELLED"]),
  FAILED_AT_STEP: new Set(["CANCELLED"]),
  COMPLETE: new Set(["EXECUTING"]),
  CANCELLED: new Set([]),
  ABANDONED: new Set([]),
};

export function canTransition(from: TriageState, to: TriageState): boolean {
  return TRANSITIONS[from].has(to);
}

export function nextStates(from: TriageState): TriageState[] {
  return Array.from(TRANSITIONS[from]);
}

export function isTerminal(state: TriageState): boolean {
  return TRANSITIONS[state].size === 0;
}
