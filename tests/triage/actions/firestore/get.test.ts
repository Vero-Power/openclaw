import { describe, it, expect, vi } from "vitest";
import { firestoreGetAction } from "../../../../src/triage/actions/firestore/get.js";
import type { ActionContext } from "../../../../src/triage/actions/types.js";

function ctx(override: object): ActionContext {
  return {
    request_id: "req-1",
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...override,
  } as ActionContext;
}

describe("firestoreGet", () => {
  it("returns the doc when present", async () => {
    const fakeClient = {
      listCollections: async () => [],
      collection: (_: string) => ({
        doc: (id: string) => ({
          get: async () => ({
            id,
            exists: true,
            data: () => ({ name: "Site A", status: "active" }),
          }),
        }),
        where: () => ({}),
        orderBy: () => ({}),
        count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
        limit: () => ({ get: async () => ({ docs: [] }) }),
        get: async () => ({ docs: [] }),
      }),
    };
    const r = await firestoreGetAction.invoke(
      { collection: "vero_projects", id: "abc" },
      ctx({ firestoreClientOverride: fakeClient }),
    );
    expect(r.doc).toEqual({ _id: "abc", name: "Site A", status: "active" });
    // eslint-disable-next-line no-underscore-dangle
    expect(r._display).toContain("Site A");
  });

  it("returns null when missing", async () => {
    const fakeClient = {
      listCollections: async () => [],
      collection: () => ({
        doc: (id: string) => ({ get: async () => ({ id, exists: false, data: () => undefined }) }),
        where: () => ({}),
        orderBy: () => ({}),
        count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
        limit: () => ({ get: async () => ({ docs: [] }) }),
        get: async () => ({ docs: [] }),
      }),
    };
    const r = await firestoreGetAction.invoke(
      { collection: "vero_projects", id: "missing" },
      ctx({ firestoreClientOverride: fakeClient }),
    );
    expect(r.doc).toBeNull();
    // eslint-disable-next-line no-underscore-dangle
    expect(r._display).toContain("not found");
  });
});
