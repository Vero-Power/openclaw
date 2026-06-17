import { describe, it, expect } from "vitest";
import {
  createCoperniqObserver,
  type FirestoreLike,
  type FirestoreCredentials,
} from "../../../src/sentinel/observers/coperniq.js";

describe("coperniq observer module", () => {
  it("exports createCoperniqObserver and the public types", () => {
    expect(typeof createCoperniqObserver).toBe("function");
    const creds: FirestoreCredentials = { client_email: "x", private_key: "y", project_id: "z" };
    const client: FirestoreLike = {
      getSyncMeta: async () => null,
      listProjectStatuses: async () => [],
      listWorkOrderStatuses: async () => [],
      listChangedProjects: async () => [],
      listChangedWorkOrders: async () => [],
    };
    expect(creds.client_email).toBe("x");
    expect(typeof client.getSyncMeta).toBe("function");
  });
});
