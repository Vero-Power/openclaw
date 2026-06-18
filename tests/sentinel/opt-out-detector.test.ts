import { describe, it, expect } from "vitest";
import { detectOptOut } from "../../src/sentinel/opt-out-detector.js";

describe("detectOptOut", () => {
  it("matches 'stop asking'", () => {
    const result = detectOptOut("Please stop asking me about this.");
    expect(result.matched).toBe(true);
    expect(result.phrase).toBe("stop asking");
  });

  it("matches 'leave me alone'", () => {
    const result = detectOptOut("Just leave me alone already.");
    expect(result.matched).toBe(true);
    expect(result.phrase).toBe("leave me alone");
  });

  it("matches 'no more questions'", () => {
    const result = detectOptOut("No more questions from you!");
    expect(result.matched).toBe(true);
    expect(result.phrase).toBe("no more questions/asking");
  });

  it("matches 'no more asking'", () => {
    const result = detectOptOut("I want no more asking.");
    expect(result.matched).toBe(true);
    expect(result.phrase).toBe("no more questions/asking");
  });

  it("matches 'unsubscribe'", () => {
    const result = detectOptOut("unsubscribe me from this");
    expect(result.matched).toBe(true);
    expect(result.phrase).toBe("unsubscribe");
  });

  it("matches 'don't ask'", () => {
    const result = detectOptOut("Don't ask me again.");
    expect(result.matched).toBe(true);
    expect(result.phrase).toBe("don't ask/bother");
  });

  it("matches 'dont bother' (without apostrophe)", () => {
    const result = detectOptOut("dont bother me with this");
    expect(result.matched).toBe(true);
    expect(result.phrase).toBe("don't ask/bother");
  });

  it("is case-insensitive", () => {
    expect(detectOptOut("STOP ASKING").matched).toBe(true);
    expect(detectOptOut("LEAVE ME ALONE").matched).toBe(true);
  });

  it("returns matched=false for a normal reply", () => {
    const result = detectOptOut("Sure, I'll look into that next week.");
    expect(result.matched).toBe(false);
    expect(result.phrase).toBeUndefined();
  });

  it("returns matched=false for empty string", () => {
    const result = detectOptOut("");
    expect(result.matched).toBe(false);
  });

  it("does not match partial words that are not opt-out signals", () => {
    // 'ask' alone should not match — the pattern requires 'don't ask' or 'stop asking'
    const result = detectOptOut("I'd like to ask you something.");
    expect(result.matched).toBe(false);
  });
});
