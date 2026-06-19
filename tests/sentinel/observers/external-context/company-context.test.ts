import { describe, it, expect } from "vitest";
import {
  buildCompanyContext,
  type CompanyContextFirestoreLike,
} from "../../../../src/sentinel/observers/external-context/company-context.js";

function makeFakeClient(
  overrides: Partial<CompanyContextFirestoreLike> = {},
): CompanyContextFirestoreLike {
  return {
    countProjectsByField: overrides.countProjectsByField ?? (async () => ({})),
    sumProjectValue: overrides.sumProjectValue ?? (async () => 0),
    countWorkOrdersByStatus: overrides.countWorkOrdersByStatus ?? (async () => ({})),
  };
}

describe("buildCompanyContext", () => {
  it("formats a multi-state snapshot with status mix and pipeline value", async () => {
    const client = makeFakeClient({
      countProjectsByField: async (field) => {
        if (field === "state") {
          return { TX: 222, UT: 2 };
        }
        if (field === "status") {
          return { ACTIVE: 155, CANCELLED: 51, ON_HOLD: 16, COMPLETED: 2 };
        }
        if (field === "workflowName") {
          return { "Vero - Texas Workflow": 224 };
        }
        return {};
      },
      sumProjectValue: async () => 8_700_000,
      countWorkOrdersByStatus: async () => ({
        completed: 2313,
        assigned: 283,
        waiting: 266,
        review: 18,
      }),
    });

    const out = await buildCompanyContext({ client });

    expect(out).toContain("COMPANY SNAPSHOT");
    expect(out).toContain("224 projects");
    expect(out).toContain("TX (222");
    expect(out).toContain("UT (2");
    expect(out).toContain("ACTIVE");
    expect(out).toContain("CANCELLED");
    expect(out).toContain("$8,700,000");
    expect(out).toContain("Vero - Texas Workflow");
    expect(out).toContain("283 currently assigned");
  });

  it("emits a minimal blob when there are zero projects", async () => {
    const client = makeFakeClient(); // all defaults return empty
    const out = await buildCompanyContext({ client });
    expect(out).toContain("COMPANY SNAPSHOT");
    expect(out).toContain("No project data");
  });

  it("propagates errors from the Firestore client", async () => {
    const client = makeFakeClient({
      countProjectsByField: async () => {
        throw new Error("firestore down");
      },
    });
    await expect(buildCompanyContext({ client })).rejects.toThrow(/firestore down/);
  });

  it("sorts states by descending count", async () => {
    const client = makeFakeClient({
      countProjectsByField: async (field) => {
        if (field === "state") {
          return { CA: 5, TX: 100, NY: 20 };
        }
        return {};
      },
    });
    const out = await buildCompanyContext({ client });
    // Use "STATE (" to disambiguate from coincidental substrings (e.g. "NY" in "COMPANY").
    const txIdx = out.indexOf("TX (");
    const nyIdx = out.indexOf("NY (");
    const caIdx = out.indexOf("CA (");
    expect(txIdx).toBeLessThan(nyIdx);
    expect(nyIdx).toBeLessThan(caIdx);
  });
});
