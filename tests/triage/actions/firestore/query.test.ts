import { describe, it, expect, vi } from "vitest";
import { firestoreQueryAction } from "../../../../src/triage/actions/firestore/query.js";
import type { ActionContext } from "../../../../src/triage/actions/types.js";

function ctx(override: object): ActionContext {
  return {
    request_id: "req-1",
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...override,
  } as ActionContext;
}

function makeQuery(
  received: { where: unknown[]; orderBy: unknown[]; limit: number | null },
  docs: Array<{ id: string; data: () => Record<string, unknown> }>,
) {
  const q: {
    where: (f: string, op: string, v: unknown) => typeof q;
    orderBy: (f: string, d?: string) => typeof q;
    limit: (n: number) => typeof q;
    get: () => Promise<{ docs: typeof docs }>;
    count: () => { get: () => Promise<{ data: () => { count: number } }> };
  } = {
    where(f, op, v) {
      received.where.push({ field: f, op, value: v });
      return q;
    },
    orderBy(f, d) {
      received.orderBy.push({ field: f, direction: d ?? "asc" });
      return q;
    },
    limit(n) {
      received.limit = n;
      return q;
    },
    get: async () => ({ docs }),
    count: () => ({ get: async () => ({ data: () => ({ count: docs.length }) }) }),
  };
  return q;
}

describe("firestoreQuery", () => {
  it("applies where + orderBy + limit and returns mapped docs", async () => {
    const received = {
      where: [] as unknown[],
      orderBy: [] as unknown[],
      limit: null as number | null,
    };
    const docs = [
      { id: "a", data: () => ({ name: "A", value: 1 }) },
      { id: "b", data: () => ({ name: "B", value: 2 }) },
    ];
    const fakeClient = {
      listCollections: async () => [],
      collection: () => makeQuery(received, docs),
    };
    const r = await firestoreQueryAction.invoke(
      {
        collection: "vero_projects",
        where: [{ field: "status", op: "==", value: "active" }],
        orderBy: { field: "value", direction: "desc" },
        limit: 5,
      },
      ctx({ firestoreClientOverride: fakeClient }),
    );
    expect(received.where).toEqual([{ field: "status", op: "==", value: "active" }]);
    expect(received.orderBy).toEqual([{ field: "value", direction: "desc" }]);
    expect(received.limit).toBe(5);
    expect(r.docs).toEqual([
      { _id: "a", name: "A", value: 1 },
      { _id: "b", name: "B", value: 2 },
    ]);
    expect(r.total_returned).toBe(2);
    // eslint-disable-next-line no-underscore-dangle
    expect(r._display).toContain("vero_projects");
    // eslint-disable-next-line no-underscore-dangle
    expect(r._display).toContain("2 docs");
  });

  it("clamps limit to 50", async () => {
    const received = {
      where: [] as unknown[],
      orderBy: [] as unknown[],
      limit: null as number | null,
    };
    const fakeClient = {
      listCollections: async () => [],
      collection: () => makeQuery(received, []),
    };
    await firestoreQueryAction.invoke(
      { collection: "x", limit: 200 },
      ctx({ firestoreClientOverride: fakeClient }),
    );
    expect(received.limit).toBe(50);
  });

  it("defaults limit to 10 when omitted", async () => {
    const received = {
      where: [] as unknown[],
      orderBy: [] as unknown[],
      limit: null as number | null,
    };
    const fakeClient = {
      listCollections: async () => [],
      collection: () => makeQuery(received, []),
    };
    await firestoreQueryAction.invoke(
      { collection: "x" },
      ctx({ firestoreClientOverride: fakeClient }),
    );
    expect(received.limit).toBe(10);
  });
});
