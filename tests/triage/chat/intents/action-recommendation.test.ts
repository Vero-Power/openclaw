import { describe, it, expect } from "vitest";
import type { Recommendation } from "../../../../src/sentinel/oracle/store.js";
import {
  detectActionRecommendationIntent,
  formatRecommendationsReply,
} from "../../../../src/triage/chat/intents/action-recommendation.js";

function rec(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: overrides.id ?? "r1",
    title: overrides.title ?? "Default",
    rationale: overrides.rationale ?? "default rationale",
    evidence: overrides.evidence ?? [],
    assignee_email: overrides.assignee_email ?? "k@x.com",
    assignee_slack_id: overrides.assignee_slack_id ?? "UKALEB",
    scope: overrides.scope ?? "ops",
    urgency: overrides.urgency ?? "medium",
    confidence: overrides.confidence ?? "medium",
    generated_at: 1,
  };
}

describe("detectActionRecommendationIntent", () => {
  it("matches common variants case-insensitively", () => {
    expect(detectActionRecommendationIntent("what should I do today?")).toBe(true);
    expect(detectActionRecommendationIntent("Whats on my plate")).toBe(true);
    expect(detectActionRecommendationIntent("give me priorities")).toBe(true);
    expect(detectActionRecommendationIntent("any oracle wisdom?")).toBe(true);
    expect(detectActionRecommendationIntent("what's important")).toBe(true);
  });

  it("does not match unrelated messages", () => {
    expect(detectActionRecommendationIntent("hello")).toBe(false);
    expect(detectActionRecommendationIntent("send a slack to ridge")).toBe(false);
    expect(detectActionRecommendationIntent("did you finish that?")).toBe(false);
  });
});

describe("formatRecommendationsReply", () => {
  it("formats top 3-5 recommendations with urgency tags", () => {
    const recs = [
      rec({ title: "Thing A", urgency: "high", rationale: "Reason A" }),
      rec({ title: "Thing B", urgency: "medium", rationale: "Reason B" }),
      rec({ title: "Thing C", urgency: "low", rationale: "Reason C" }),
    ];
    const reply = formatRecommendationsReply(recs);
    expect(reply).toContain("Thing A");
    expect(reply).toContain("Thing B");
    expect(reply).toContain("Thing C");
    expect(reply).toContain("[high]");
    expect(reply).toContain("[medium]");
    expect(reply).toContain("[low]");
    expect(reply).toContain("Reason A");
  });

  it("caps to top 5 when more provided", () => {
    const recs = Array.from({ length: 8 }, (_, i) =>
      rec({ id: `r${i}`, title: `Title ${i}`, urgency: "medium" }),
    );
    const reply = formatRecommendationsReply(recs);
    const matches = reply.match(/Title \d+/g) ?? [];
    expect(matches.length).toBeLessThanOrEqual(5);
  });

  it("emits the empty-state message when no recommendations", () => {
    expect(formatRecommendationsReply([])).toContain("Nothing on your plate");
  });
});
