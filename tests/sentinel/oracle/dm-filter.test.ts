import { describe, it, expect } from "vitest";
import {
  hasActionableEvidence,
  isDuplicateOfRecent,
  titleSimilarity,
} from "../../../src/sentinel/oracle/dm-filter.js";
import type { Recommendation } from "../../../src/sentinel/oracle/store.js";

function rec(overrides: Partial<Recommendation>): Recommendation {
  return {
    id: "r1",
    title: "Default",
    rationale: "default rationale",
    evidence: [],
    assignee_email: "x@example.com",
    assignee_slack_id: null,
    scope: "ops",
    urgency: "medium",
    confidence: "medium",
    generated_at: 0,
    ...overrides,
  };
}

describe("titleSimilarity", () => {
  it("returns 1.0 for identical titles after normalization", () => {
    expect(titleSimilarity("Initiate TDLR registration", "Initiate TDLR registration")).toBe(1);
  });

  it("catches the real-world TDLR / SB 1036 dupe family", () => {
    // These were all sent to Daxton within 5 days — gate 1's job to collapse.
    const titles = [
      "Initiate TDLR registration for Texas operations",
      "Complete Texas SB 1036 salesperson registration",
      "Ensure compliance with Texas SB 1036 registration",
      "Review and prepare for new Texas Residential Solar Retailer Regulatory Act (SB 1036)",
      "Ensure compliance with Texas TDLR regulations by September 1, 2026",
    ];
    // The two SB 1036 titles must dedupe (Dice ≥ 0.3); the TDLR ones share
    // {tdlr, texas, registration} family terms and should also dedupe.
    expect(titleSimilarity(titles[1], titles[2])).toBeGreaterThanOrEqual(0.3);
    expect(titleSimilarity(titles[0], titles[4])).toBeGreaterThanOrEqual(0.3);
  });

  it("returns ~0 for unrelated titles", () => {
    expect(
      titleSimilarity(
        "Investigate high project cancellation rate",
        "Develop strategy for battery storage integration",
      ),
    ).toBeLessThan(0.2);
  });

  it("returns 0 when either side has no significant tokens", () => {
    expect(titleSimilarity("", "anything")).toBe(0);
    expect(titleSimilarity("the and of", "battery storage strategy")).toBe(0);
  });
});

describe("isDuplicateOfRecent", () => {
  it("returns true when a near-duplicate exists in the recent list", () => {
    const recent = ["Initiate TDLR registration for Texas operations"];
    expect(isDuplicateOfRecent("Complete Texas SB 1036 salesperson registration", recent)).toBe(
      true,
    );
  });

  it("returns false when nothing similar was recently sent", () => {
    const recent = ["Investigate high project cancellation rate"];
    expect(isDuplicateOfRecent("Develop battery storage strategy", recent)).toBe(false);
  });

  it("returns false on empty recent list", () => {
    expect(isDuplicateOfRecent("Anything", [])).toBe(false);
  });
});

describe("hasActionableEvidence", () => {
  it("accepts a Vero-specific quantitative claim", () => {
    const r = rec({
      title: "Investigate & reduce high project cancellation rate",
      rationale: "A 22% project cancellation rate indicates significant operational inefficiency.",
    });
    expect(hasActionableEvidence(r).ok).toBe(true);
  });

  it("accepts a rec with a hard deadline (date)", () => {
    const r = rec({
      title: "Complete Texas SB 1036 salesperson registration",
      rationale:
        "All salespersons and the company must register by September 1, 2026, to comply with new Texas consumer protection laws.",
    });
    expect(hasActionableEvidence(r).ok).toBe(true);
  });

  it("rejects a consultant-shape industry-news rec with no numbers", () => {
    const r = rec({
      title: "Standardize solar-plus-storage offerings for the Texas market",
      rationale:
        "The Texas market has decisively shifted to solar-plus-storage, presenting an opportunity to leverage ERCOT's DRRS.",
    });
    const result = hasActionableEvidence(r);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/quantitative/);
  });

  it("rejects an industry-news rec that has a number but no Vero anchor or date", () => {
    const r = rec({
      title: "Mitigate rising costs from tariffs",
      rationale:
        "Anti-dumping tariffs of up to 15% are reshaping global supply chains for solar components.",
    });
    const result = hasActionableEvidence(r);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/industry-news|anchor/);
  });

  it("uses joined evidence strings when rationale is thin", () => {
    const r = rec({
      title: "Boost installs",
      rationale: "TBD",
      evidence: ["2 completed projects this quarter", "0 work orders"],
    });
    expect(hasActionableEvidence(r).ok).toBe(true);
  });
});
