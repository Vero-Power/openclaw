import { describe, it, expect, vi } from "vitest";
import { coperniqFirestoreIngestAction } from "../../../../src/triage/actions/gcf/coperniq-firestore-ingest.js";
import type { GcfInvokeResult } from "../../../../src/triage/actions/gcf/shared.js";
import type { ActionContext } from "../../../../src/triage/actions/types.js";

interface TestContext extends ActionContext {
  gcfInvokeOverride?: (
    url: string,
    sa: string,
    opts: Record<string, unknown>,
  ) => Promise<GcfInvokeResult>;
}

describe("coperniqFirestoreIngest action", () => {
  it("declares correct metadata", () => {
    expect(coperniqFirestoreIngestAction.name).toBe("coperniqFirestoreIngest");
    expect(coperniqFirestoreIngestAction.idempotent).toBe(true);
    expect(coperniqFirestoreIngestAction.external_effect).toBe(false);
  });

  it("rejects empty args object validation", () => {
    // No required args — empty object should validate successfully.
    expect(() => coperniqFirestoreIngestAction.args_schema.parse({})).not.toThrow();
  });

  it("invokes via the gcf shared helper with the right URL env var", async () => {
    const mockInvoke = vi.fn(async () => ({ status: 200, body: '{"ok":true}' }));
    process.env.GCF_COPERNIQ_INGEST_URL = "https://test.example/coperniq";
    process.env.GCP_CLAWBOT_INVOKER_SA = "test-sa@example.iam";

    const ctx: TestContext = {
      request_id: "test",
      slack_post: async () => ({ ts: "t" }),
      slack_edit: async () => {},
      logger: {
        info: (_msg: string, _meta?: Record<string, unknown>) => {},
        error: (_msg: string, _meta?: Record<string, unknown>) => {},
        warn: (_msg: string, _meta?: Record<string, unknown>) => {},
      },
      // Override the gcf invoker via DI for testing
      gcfInvokeOverride: mockInvoke,
    };

    const result = await coperniqFirestoreIngestAction.invoke({}, ctx);

    expect(mockInvoke).toHaveBeenCalledWith(
      "https://test.example/coperniq",
      "test-sa@example.iam",
      expect.any(Object),
    );
    expect(result).toEqual({ status: 200, body: '{"ok":true}' });
  });
});
