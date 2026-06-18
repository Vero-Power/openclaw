import { describe, it, expect } from "vitest";
import {
  createGcpFunctionsObserver,
  type LoggingLike,
} from "../../../src/sentinel/observers/gcp-functions.js";

describe("gcp-functions observer module", () => {
  it("exports createGcpFunctionsObserver and the LoggingLike type", () => {
    expect(typeof createGcpFunctionsObserver).toBe("function");
    const client: LoggingLike = {
      listFunctionEntries: async () => [],
    };
    expect(typeof client.listFunctionEntries).toBe("function");
  });
});
