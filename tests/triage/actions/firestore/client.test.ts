import { describe, it, expect } from "vitest";
import {
  createFirestoreClientFromAdmin,
  type FirestoreLike,
} from "../../../../src/triage/actions/firestore/client.js";

describe("firestore/client", () => {
  it("createFirestoreClientFromAdmin maps the admin Firestore methods onto FirestoreLike", () => {
    const fakeAdminFirestore = {
      listCollections: async () => [{ id: "vero_projects" }, { id: "coperniq_projects" }],
      collection: (name: string) => ({
        doc: (id: string) => ({ id, ref: `${name}/${id}` }),
        get: async () => ({ docs: [], size: 0 }),
        count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
      }),
    };
    const client = createFirestoreClientFromAdmin(fakeAdminFirestore as never);
    expect(typeof client.listCollections).toBe("function");
    expect(typeof client.collection).toBe("function");
  });

  it("FirestoreLike interface compiles with the documented method set", () => {
    // Type-only assertion via a no-op fake — proves the interface surface
    const fake: FirestoreLike = {
      listCollections: async () => [],
      collection: (_: string) => ({
        doc: (_id: string) => ({
          get: async () => ({ exists: false, id: _id, data: () => undefined }),
        }),
        get: async () => ({ docs: [] }),
        where: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => ({
                get: async () => ({ docs: [] }),
                count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
              }),
            }),
          }),
        }),
        orderBy: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }),
        limit: () => ({ get: async () => ({ docs: [] }) }),
        count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
      }),
    };
    expect(fake).toBeDefined();
  });
});
