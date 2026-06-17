import { describe, it, expect } from "vitest";
import {
  createCoperniqObserver,
  type FirestoreLike,
} from "../../../src/sentinel/observers/coperniq.js";

describe("coperniq observer module", () => {
  it("exports createCoperniqObserver and the FirestoreLike type", () => {
    expect(typeof createCoperniqObserver).toBe("function");
    const client: FirestoreLike = {
      getSyncMeta: async () => null,
      listProjectStatuses: async () => [],
      listWorkOrderStatuses: async () => [],
      listChangedProjects: async () => [],
      listChangedWorkOrders: async () => [],
    };
    expect(typeof client.getSyncMeta).toBe("function");
  });
});
