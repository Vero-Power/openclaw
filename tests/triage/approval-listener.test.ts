import { describe, it, expect } from "vitest";
import { parseApprovalReply } from "../../src/triage/approval-listener.js";

describe("parseApprovalReply", () => {
  it("recognizes approve patterns", () => {
    expect(parseApprovalReply("yes").kind).toBe("approve");
    expect(parseApprovalReply("Go").kind).toBe("approve");
    expect(parseApprovalReply("approve").kind).toBe("approve");
    expect(parseApprovalReply("do it").kind).toBe("approve");
    expect(parseApprovalReply("run it").kind).toBe("approve");
    expect(parseApprovalReply("✅").kind).toBe("approve");
    expect(parseApprovalReply("send it").kind).toBe("approve");
    expect(parseApprovalReply("proceed").kind).toBe("approve");
  });

  it("recognizes cancel patterns", () => {
    expect(parseApprovalReply("no").kind).toBe("cancel");
    expect(parseApprovalReply("stop").kind).toBe("cancel");
    expect(parseApprovalReply("cancel").kind).toBe("cancel");
    expect(parseApprovalReply("abort").kind).toBe("cancel");
    expect(parseApprovalReply("nvm").kind).toBe("cancel");
    expect(parseApprovalReply("🛑").kind).toBe("cancel");
  });

  it("treats anything else as edit (free-form replan trigger)", () => {
    const out = parseApprovalReply("actually use project 43 not 42");
    expect(out.kind).toBe("edit");
    expect(out.edit_text).toBe("actually use project 43 not 42");
  });

  it("ignores empty strings", () => {
    expect(parseApprovalReply("").kind).toBe("ignore");
    expect(parseApprovalReply("   ").kind).toBe("ignore");
  });
});
