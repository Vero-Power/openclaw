import { describe, expect, it } from "vitest";
import { filterMutedQuestions, isQuestionMuted, type TopicMute } from "./topic-mutes.js";

const KALEB = "U07KRVD2867";
const RIDGE = "U096S2FQTUZ";

function q(topic: string, question_text: string, target_user_id = KALEB) {
  return { topic, question_text, target_user_id };
}

describe("isQuestionMuted", () => {
  it("mutes a question whose topic contains a muted keyword for that person", () => {
    const mutes: TopicMute[] = [{ person_user_id: KALEB, keyword: "jr-time" }];
    expect(
      isQuestionMuted(
        q("Inactive Slack channels", "Are #jr-time and #vero-management still in use?"),
        mutes,
      ),
    ).toBe(true);
  });

  it("matches against the question text, not just the topic", () => {
    const mutes: TopicMute[] = [{ person_user_id: KALEB, keyword: "vero-management" }];
    expect(
      isQuestionMuted(q("Slack channel cleanup", "Can #vero-management be archived?"), mutes),
    ).toBe(true);
  });

  it("is case-insensitive", () => {
    const mutes: TopicMute[] = [{ person_user_id: KALEB, keyword: "JR-Time" }];
    expect(isQuestionMuted(q("Purpose of #JR-TIME channel", "what is it for"), mutes)).toBe(true);
  });

  it("does NOT mute an unrelated question", () => {
    const mutes: TopicMute[] = [{ person_user_id: KALEB, keyword: "jr-time" }];
    expect(
      isQuestionMuted(q("OpenClaw job status", "Are 6 of 9 jobs dormant expected?"), mutes),
    ).toBe(false);
  });

  it("a person-scoped mute does NOT apply to a different target", () => {
    const mutes: TopicMute[] = [{ person_user_id: KALEB, keyword: "jr-time" }];
    expect(
      isQuestionMuted(q("Inactive Slack channels", "Is #jr-time still used?", RIDGE), mutes),
    ).toBe(false);
  });

  it("a global mute (null person) applies to every target", () => {
    const mutes: TopicMute[] = [{ person_user_id: null, keyword: "jr-time" }];
    expect(
      isQuestionMuted(q("Inactive Slack channels", "Is #jr-time still used?", RIDGE), mutes),
    ).toBe(true);
  });

  it("ignores empty-keyword rows (never mutes everything)", () => {
    const mutes: TopicMute[] = [{ person_user_id: KALEB, keyword: "" }];
    expect(isQuestionMuted(q("anything", "anything at all"), mutes)).toBe(false);
  });
});

describe("filterMutedQuestions", () => {
  it("drops muted questions and keeps the rest", () => {
    const mutes: TopicMute[] = [{ person_user_id: KALEB, keyword: "jr-time" }];
    const questions = [
      q("Inactive Slack channels", "Are #jr-time and #vero-management still in use?"),
      q("OpenClaw job status", "Are 6 of 9 jobs dormant expected?"),
    ];
    const kept = filterMutedQuestions(questions, mutes);
    expect(kept).toHaveLength(1);
    expect(kept[0].topic).toBe("OpenClaw job status");
  });
});
