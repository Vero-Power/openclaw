import { describe, it, expect, beforeEach, vi } from "vitest";
import { firestoreCollectionsAction } from "../../../../src/triage/actions/firestore/collections.js";
import { firestoreCountAction } from "../../../../src/triage/actions/firestore/count.js";
import { firestoreDeleteAction } from "../../../../src/triage/actions/firestore/delete.js";
import { firestoreGetAction } from "../../../../src/triage/actions/firestore/get.js";
import { firestoreKeysAction } from "../../../../src/triage/actions/firestore/keys.js";
import { firestoreQueryAction } from "../../../../src/triage/actions/firestore/query.js";
import { firestoreSetAction } from "../../../../src/triage/actions/firestore/set.js";
import { setFirestoreForTest } from "../../../../src/triage/actions/firestore/shared.js";
import type { ActionContext } from "../../../../src/triage/actions/types.js";

const ctx = (): ActionContext => ({
  request_id: "test-req",
  slack_post: async () => ({ ts: "t" }),
  slack_edit: async () => {},
  logger: { info: () => {}, error: () => {}, warn: () => {} },
});

function makeMockDb(overrides: Partial<Record<string, unknown>> = {}) {
  return overrides as unknown as Parameters<typeof setFirestoreForTest>[0];
}

describe("firestore action metadata", () => {
  it.each([
    [firestoreCollectionsAction, "firestoreCollections", false, true],
    [firestoreKeysAction, "firestoreKeys", false, true],
    [firestoreGetAction, "firestoreGet", false, true],
    [firestoreQueryAction, "firestoreQuery", false, true],
    [firestoreCountAction, "firestoreCount", false, true],
    [firestoreSetAction, "firestoreSet", true, false],
    [firestoreDeleteAction, "firestoreDelete", true, true],
  ])("%s declares correct metadata", (action, name, external, idem) => {
    expect(action.name).toBe(name);
    expect(action.external_effect).toBe(external);
    expect(action.idempotent).toBe(idem);
  });
});

describe("firestoreCollections", () => {
  beforeEach(() => setFirestoreForTest(null));

  it("returns sorted collections with counts", async () => {
    const listCollections = vi.fn(async () => [
      { id: "beta", count: () => ({ get: async () => ({ data: () => ({ count: 5 }) }) }) },
      { id: "alpha", count: () => ({ get: async () => ({ data: () => ({ count: 10 }) }) }) },
    ]);
    setFirestoreForTest(makeMockDb({ listCollections }));
    const r = await firestoreCollectionsAction.invoke({}, ctx());
    expect(r.total_collections).toBe(2);
    expect(r.total_docs).toBe(15);
    expect(r.collections.map((c) => c.id)).toEqual(["alpha", "beta"]);
  });
});

describe("firestoreKeys", () => {
  beforeEach(() => setFirestoreForTest(null));

  it("samples documents and aggregates field types", async () => {
    const docs = [
      { id: "doc1", data: () => ({ name: "x", age: 1 }) },
      { id: "doc2", data: () => ({ name: "y", active: true }) },
    ];
    const collection = () => ({
      limit: () => ({ get: async () => ({ empty: false, docs }) }),
    });
    setFirestoreForTest(makeMockDb({ collection }));
    const r = await firestoreKeysAction.invoke({ collection: "x", sample_size: 3 }, ctx());
    expect(r.collection).toBe("x");
    expect(r.field_count).toBe(3);
    expect(r.fields.map((f) => f.name)).toEqual(["active", "age", "name"]);
    expect(r.sample_ids).toEqual(["doc1", "doc2"]);
  });

  it("reports empty:true when collection has no docs", async () => {
    const collection = () => ({
      limit: () => ({ get: async () => ({ empty: true, docs: [] }) }),
    });
    setFirestoreForTest(makeMockDb({ collection }));
    const r = await firestoreKeysAction.invoke({ collection: "x", sample_size: 3 }, ctx());
    expect(r.empty).toBe(true);
    expect(r.field_count).toBe(0);
  });
});

describe("firestoreGet", () => {
  beforeEach(() => setFirestoreForTest(null));

  it("returns doc:null for missing docs", async () => {
    const fakeClient = {
      listCollections: async () => [],
      collection: () => ({
        doc: () => ({ get: async () => ({ exists: false, id: "missing", data: () => undefined }) }),
        where: () => ({}),
        orderBy: () => ({}),
        count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
        limit: () => ({ get: async () => ({ docs: [] }) }),
        get: async () => ({ docs: [] }),
      }),
    };
    const r = await firestoreGetAction.invoke({ collection: "x", id: "missing" }, {
      ...ctx(),
      firestoreClientOverride: fakeClient,
    } as unknown as ActionContext);
    expect(r.doc).toBeNull();
    // eslint-disable-next-line no-underscore-dangle
    expect(typeof r._display).toBe("string");
  });

  it("returns doc data when exists", async () => {
    const fakeClient = {
      listCollections: async () => [],
      collection: () => ({
        doc: () => ({
          get: async () => ({
            exists: true,
            id: "abc",
            data: () => ({ name: "alice", age: 30, secret: "shh" }),
          }),
        }),
        where: () => ({}),
        orderBy: () => ({}),
        count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
        limit: () => ({ get: async () => ({ docs: [] }) }),
        get: async () => ({ docs: [] }),
      }),
    };
    const r = await firestoreGetAction.invoke({ collection: "users", id: "abc" }, {
      ...ctx(),
      firestoreClientOverride: fakeClient,
    } as unknown as ActionContext);
    // eslint-disable-next-line no-underscore-dangle
    expect(r.doc?._id).toBe("abc");
    expect(r.doc?.name).toBe("alice");
  });

  it("requires collection and id", async () => {
    const fakeClient = {
      listCollections: async () => [],
      collection: () => ({ doc: () => ({}) }),
    };
    // @ts-expect-error testing validation
    await expect(
      firestoreGetAction.invoke(
        { collection: "" },
        { ...ctx(), firestoreClientOverride: fakeClient },
      ),
    ).rejects.toThrow();
  });
});

describe("firestoreQuery", () => {
  beforeEach(() => setFirestoreForTest(null));

  it("applies where, orderBy, limit and projects fields", async () => {
    const where = vi.fn().mockReturnThis();
    const orderBy = vi.fn().mockReturnThis();
    const limit = vi.fn().mockReturnThis();
    const get = vi.fn(async () => ({
      docs: [
        { id: "1", data: () => ({ status: "open", priority: 9 }) },
        { id: "2", data: () => ({ status: "open", priority: 5 }) },
      ],
    }));
    const q: Record<string, unknown> = { where, orderBy, limit, get };
    where.mockReturnValue(q);
    orderBy.mockReturnValue(q);
    limit.mockReturnValue(q);
    const collection = vi.fn(() => q);
    setFirestoreForTest(makeMockDb({ collection }));

    const r = await firestoreQueryAction.invoke(
      {
        collection: "x",
        where: [{ field: "status", op: "==", value: "open" }],
        order_by: { field: "priority", direction: "desc" },
        limit: 5,
        fields: ["_id", "priority"],
      },
      ctx(),
    );
    expect(r.count).toBe(2);
    expect(r.docs[0]).toEqual({ _id: "1", priority: 9 });
    expect(r.docs[1]).toEqual({ _id: "2", priority: 5 });
    expect(where).toHaveBeenCalledWith("status", "==", "open");
    expect(orderBy).toHaveBeenCalledWith("priority", "desc");
    expect(limit).toHaveBeenCalledWith(5);
  });
});

describe("firestoreCount", () => {
  beforeEach(() => setFirestoreForTest(null));

  it("returns server-side aggregation count", async () => {
    const get = vi.fn(async () => ({ data: () => ({ count: 167 }) }));
    const count = vi.fn(() => ({ get }));
    const where = vi.fn().mockReturnThis();
    const q: Record<string, unknown> = { where, count };
    where.mockReturnValue(q);
    const collection = vi.fn(() => q);
    setFirestoreForTest(makeMockDb({ collection }));
    const r = await firestoreCountAction.invoke(
      {
        collection: "vero_funding_exceptions",
        where: [{ field: "status", op: "==", value: "open" }],
      },
      ctx(),
    );
    expect(r).toMatchObject({ collection: "vero_funding_exceptions", count: 167 });
    // eslint-disable-next-line no-underscore-dangle
    expect(typeof r._display).toBe("string");
    // eslint-disable-next-line no-underscore-dangle
    expect(r._display).toContain("167");
  });
});

describe("firestoreSet", () => {
  beforeEach(() => setFirestoreForTest(null));

  it("dry_run=true returns preview without writing", async () => {
    const set = vi.fn();
    const get = vi.fn(async () => ({ exists: false, data: () => undefined }));
    const collection = () => ({ doc: () => ({ get, set }) });
    setFirestoreForTest(makeMockDb({ collection }));
    const r = await firestoreSetAction.invoke(
      { path: "x/new", data: { ok: true }, dry_run: true, merge: false },
      ctx(),
    );
    expect(r.dry_run).toBe(true);
    expect(r.committed).toBe(false);
    expect(r.will_create).toBe(true);
    expect(set).not.toHaveBeenCalled();
  });

  it("dry_run=false actually writes", async () => {
    const set = vi.fn(async () => undefined);
    const get = vi.fn(async () => ({ exists: true, data: () => ({ old: 1 }) }));
    const collection = () => ({ doc: () => ({ get, set }) });
    setFirestoreForTest(makeMockDb({ collection }));
    const r = await firestoreSetAction.invoke(
      { path: "x/existing", data: { new: 2 }, dry_run: false, merge: true },
      ctx(),
    );
    expect(r.committed).toBe(true);
    expect(r.will_create).toBe(false);
    expect(r.mode).toBe("merge");
    expect(set).toHaveBeenCalledWith({ new: 2 }, { merge: true });
  });
});

describe("firestoreDelete", () => {
  beforeEach(() => setFirestoreForTest(null));

  it("dry_run=true returns preview without deleting", async () => {
    const del = vi.fn();
    const get = vi.fn(async () => ({ exists: true, data: () => ({ a: 1 }) }));
    const collection = () => ({ doc: () => ({ get, delete: del }) });
    setFirestoreForTest(makeMockDb({ collection }));
    const r = await firestoreDeleteAction.invoke({ path: "x/y", dry_run: true }, ctx());
    expect(r.dry_run).toBe(true);
    expect(r.committed).toBe(false);
    expect(r.existed).toBe(true);
    expect(del).not.toHaveBeenCalled();
  });

  it("noop when doc doesn't exist", async () => {
    const del = vi.fn();
    const get = vi.fn(async () => ({ exists: false, data: () => undefined }));
    const collection = () => ({ doc: () => ({ get, delete: del }) });
    setFirestoreForTest(makeMockDb({ collection }));
    const r = await firestoreDeleteAction.invoke({ path: "x/gone", dry_run: false }, ctx());
    expect(r.committed).toBe(false);
    expect(r.existed).toBe(false);
    expect(del).not.toHaveBeenCalled();
  });

  it("dry_run=false actually deletes when doc exists", async () => {
    const del = vi.fn(async () => undefined);
    const get = vi.fn(async () => ({ exists: true, data: () => ({ a: 1 }) }));
    const collection = () => ({ doc: () => ({ get, delete: del }) });
    setFirestoreForTest(makeMockDb({ collection }));
    const r = await firestoreDeleteAction.invoke({ path: "x/y", dry_run: false }, ctx());
    expect(r.committed).toBe(true);
    expect(del).toHaveBeenCalled();
  });
});
