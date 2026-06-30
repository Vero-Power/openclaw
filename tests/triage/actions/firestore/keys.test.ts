import { describe, it, expect, vi } from "vitest";
import { firestoreKeysAction } from "../../../../src/triage/actions/firestore/keys.js";
import type { ActionContext } from "../../../../src/triage/actions/types.js";

function ctx(override: object): ActionContext {
  return {
    request_id: "req-1",
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...override,
  } as ActionContext;
}

describe("firestoreKeys", () => {
  it("samples docs and returns the union of field names + sample bodies", async () => {
    const docs = [
      { id: "a", data: () => ({ name: "A", status: "active" }) },
      { id: "b", data: () => ({ name: "B", value: 100 }) },
    ];
    const fakeClient = {
      listCollections: async () => [],
      collection: () => ({
        doc: () => ({ get: async () => ({ exists: false, id: "", data: () => undefined }) }),
        where: () => ({}),
        orderBy: () => ({}),
        count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
        limit: (_: number) => ({ get: async () => ({ docs }) }),
        get: async () => ({ docs }),
      }),
    };
    const result = await firestoreKeysAction.invoke(
      { collection: "vero_projects" },
      ctx({ firestoreClientOverride: fakeClient }),
    );
    expect(result.collection).toBe("vero_projects");
    expect(new Set(result.keys)).toEqual(new Set(["name", "status", "value"]));
    expect(result.sample_docs).toHaveLength(2);
    expect((result.sample_docs[0] as Record<string, unknown>)["_id"]).toBe("a");
    expect((result as Record<string, unknown>)["_display"]).toContain("vero_projects");
    expect((result as Record<string, unknown>)["_display"]).toContain("name");
  });

  it("respects the sample arg (default 5)", async () => {
    let receivedLimit = -1;
    const fakeClient = {
      listCollections: async () => [],
      collection: () => ({
        doc: () => ({ get: async () => ({ exists: false, id: "", data: () => undefined }) }),
        where: () => ({}),
        orderBy: () => ({}),
        count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
        limit: (n: number) => {
          receivedLimit = n;
          return { get: async () => ({ docs: [] }) };
        },
        get: async () => ({ docs: [] }),
      }),
    };
    await firestoreKeysAction.invoke(
      { collection: "x", sample: 10 },
      ctx({ firestoreClientOverride: fakeClient }),
    );
    expect(receivedLimit).toBe(10);
  });
});
