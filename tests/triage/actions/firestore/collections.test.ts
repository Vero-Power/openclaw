import { describe, it, expect, vi } from "vitest";
import { firestoreCollectionsAction } from "../../../../src/triage/actions/firestore/collections.js";
import type { ActionContext } from "../../../../src/triage/actions/types.js";

function ctx(overrides: Partial<ActionContext> = {}): ActionContext {
  return {
    request_id: "req-1",
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  } as ActionContext;
}

describe("firestoreCollections", () => {
  it("returns the list of root collections with a _display string", async () => {
    const fakeClient = {
      listCollections: async () => [{ id: "vero_projects" }, { id: "coperniq_projects" }],
      collection: () => {
        throw new Error("not used");
      },
    };
    const result = await firestoreCollectionsAction.invoke(
      {},
      ctx({ firestoreClientOverride: fakeClient } as Partial<ActionContext> as ActionContext),
    );
    expect(result.collections).toEqual(["coperniq_projects", "vero_projects"]);
    // eslint-disable-next-line no-underscore-dangle
    const display = (result as { _display: string })._display;
    expect(display).toContain("2 collections");
    expect(display).toContain("vero_projects");
  });

  it("handles empty result", async () => {
    const fakeClient = {
      listCollections: async () => [],
      collection: () => {
        throw new Error("not used");
      },
    };
    const result = await firestoreCollectionsAction.invoke(
      {},
      ctx({ firestoreClientOverride: fakeClient } as Partial<ActionContext> as ActionContext),
    );
    expect(result.collections).toEqual([]);
    // eslint-disable-next-line no-underscore-dangle
    const display = (result as { _display: string })._display;
    expect(display).toContain("No collections");
  });
});
