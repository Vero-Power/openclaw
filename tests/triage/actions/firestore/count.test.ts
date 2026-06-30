import { describe, it, expect, vi } from "vitest";
import { firestoreCountAction } from "../../../../src/triage/actions/firestore/count.js";
import type { ActionContext } from "../../../../src/triage/actions/types.js";

function ctx(override: object): ActionContext {
  return {
    request_id: "req-1",
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...override,
  } as ActionContext;
}

describe("firestoreCount", () => {
  it("returns the count from the aggregation snapshot", async () => {
    const fakeClient = {
      listCollections: async () => [],
      collection: () => ({
        doc: () => ({ get: async () => ({ exists: false, id: "", data: () => undefined }) }),
        where: () => ({
          where: () => ({}),
          orderBy: () => ({}),
          limit: () => ({}),
          get: async () => ({ docs: [] }),
          count: () => ({ get: async () => ({ data: () => ({ count: 42 }) }) }),
        }),
        orderBy: () => ({}),
        limit: () => ({}),
        get: async () => ({ docs: [] }),
        count: () => ({ get: async () => ({ data: () => ({ count: 1247 }) }) }),
      }),
    };
    const r1 = await firestoreCountAction.invoke(
      { collection: "vero_projects" },
      ctx({ firestoreClientOverride: fakeClient }),
    );
    expect(r1.count).toBe(1247);
    // eslint-disable-next-line no-underscore-dangle
    expect(r1._display).toContain("1247");

    const r2 = await firestoreCountAction.invoke(
      { collection: "vero_projects", where: [{ field: "status", op: "==", value: "active" }] },
      ctx({ firestoreClientOverride: fakeClient }),
    );
    expect(r2.count).toBe(42);
  });
});
