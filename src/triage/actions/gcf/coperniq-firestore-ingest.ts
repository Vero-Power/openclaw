import { z } from "zod";
import type { CatalogAction } from "../types.js";
import { invokeGcf, type GcfInvokeResult } from "./shared.js";

const ArgsSchema = z.object({}).strict();
type Args = z.infer<typeof ArgsSchema>;

export const coperniqFirestoreIngestAction: CatalogAction<Args, GcfInvokeResult> = {
  name: "coperniqFirestoreIngest",
  description:
    "Pull latest Coperniq data into Firestore. Idempotent sweep. Use when operator wants to refresh local Coperniq cache.",
  args_schema: ArgsSchema,
  idempotent: true,
  external_effect: false,
  estimated_duration_ms: 15000,
  invoke: async (_args, ctx) => {
    const url = process.env.GCF_COPERNIQ_INGEST_URL;
    const sa = process.env.GCP_CLAWBOT_INVOKER_SA;
    if (!url) {
      throw new Error("GCF_COPERNIQ_INGEST_URL not set in env");
    }
    if (!sa) {
      throw new Error("GCP_CLAWBOT_INVOKER_SA not set in env");
    }

    // DI hook for tests — ctx may carry a gcfInvokeOverride injected by the test harness
    const invoker =
      (ctx as unknown as { gcfInvokeOverride?: typeof invokeGcf }).gcfInvokeOverride ?? invokeGcf;

    ctx.logger.info("firing coperniqFirestoreIngest", { url, request_id: ctx.request_id });
    const result = await invoker(url, sa, { method: "POST", body: {} });
    ctx.logger.info("coperniqFirestoreIngest result", {
      status: result.status,
      body_excerpt: result.body.slice(0, 200),
    });
    return result;
  },
};
