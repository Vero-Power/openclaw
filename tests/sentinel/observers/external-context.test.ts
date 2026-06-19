import { describe, it, expect } from "vitest";
import {
  createExternalContextObserver,
  type Researcher,
  type ResearchResult,
} from "../../../src/sentinel/observers/external-context.js";

describe("external-context observer module", () => {
  it("exports createExternalContextObserver and the Researcher port", () => {
    expect(typeof createExternalContextObserver).toBe("function");
    const researcher: Researcher = {
      research: async (): Promise<ResearchResult> => ({ findings: [], trace: [] }),
    };
    expect(typeof researcher.research).toBe("function");
  });
});
