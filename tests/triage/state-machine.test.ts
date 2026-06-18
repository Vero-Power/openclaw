import { describe, it, expect } from "vitest";
import { canTransition, nextStates } from "../../src/triage/state-machine.js";

describe("triage state machine", () => {
  it("PENDING_CLASSIFY → CLASSIFIED is valid", () => {
    expect(canTransition("PENDING_CLASSIFY", "CLASSIFIED")).toBe(true);
  });

  it("CLASSIFIED → PLAYBOOK_MATCHED is valid (fast-path)", () => {
    expect(canTransition("CLASSIFIED", "PLAYBOOK_MATCHED")).toBe(true);
  });

  it("CLASSIFIED → RESEARCHING is valid (slow-path)", () => {
    expect(canTransition("CLASSIFIED", "RESEARCHING")).toBe(true);
  });

  it("PLANNING → AWAITING_APPROVAL is valid", () => {
    expect(canTransition("PLANNING", "AWAITING_APPROVAL")).toBe(true);
  });

  it("AWAITING_APPROVAL → EDITING is valid (replan)", () => {
    expect(canTransition("AWAITING_APPROVAL", "EDITING")).toBe(true);
  });

  it("EDITING → AWAITING_APPROVAL is valid (back to approval after replan)", () => {
    expect(canTransition("EDITING", "AWAITING_APPROVAL")).toBe(true);
  });

  it("AWAITING_APPROVAL → EXECUTING is valid", () => {
    expect(canTransition("AWAITING_APPROVAL", "EXECUTING")).toBe(true);
  });

  it("EXECUTING → COMPLETE is valid", () => {
    expect(canTransition("EXECUTING", "COMPLETE")).toBe(true);
  });

  it("EXECUTING → FAILED_AT_STEP is valid", () => {
    expect(canTransition("EXECUTING", "FAILED_AT_STEP")).toBe(true);
  });

  it("COMPLETE → AWAITING_APPROVAL is INVALID (no going back)", () => {
    expect(canTransition("COMPLETE", "AWAITING_APPROVAL")).toBe(false);
  });

  it("any state → CANCELLED is valid", () => {
    expect(canTransition("PENDING_CLASSIFY", "CANCELLED")).toBe(true);
    expect(canTransition("AWAITING_APPROVAL", "CANCELLED")).toBe(true);
    expect(canTransition("EXECUTING", "CANCELLED")).toBe(true);
  });

  it("any non-terminal state → ABANDONED is valid (idle timeout)", () => {
    expect(canTransition("AWAITING_APPROVAL", "ABANDONED")).toBe(true);
    expect(canTransition("COMPLETE", "ABANDONED")).toBe(false);
  });

  it("nextStates returns the valid successors", () => {
    const next = nextStates("CLASSIFIED");
    expect(next).toContain("PLAYBOOK_MATCHED");
    expect(next).toContain("RESEARCHING");
    expect(next).toContain("CANCELLED");
  });
});
