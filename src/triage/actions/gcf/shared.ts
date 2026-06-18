import { execFileSync } from "node:child_process";

export interface GcfInvokeResult {
  status: number;
  body: string;
}

export interface GcfInvokeOptions {
  method?: "GET" | "POST";
  query?: Record<string, string>;
  body?: unknown;
  ingestSecret?: string;
}

/**
 * Invoke a Gen 2 Cloud Run function as the clawbot SA via gcloud impersonation.
 * Never reads or writes credential files; uses ADC + iam.serviceAccountTokenCreator.
 */
export async function invokeGcf(
  url: string,
  serviceAccount: string,
  opts: GcfInvokeOptions = {},
): Promise<GcfInvokeResult> {
  const token = execFileSync(
    "gcloud",
    [
      "auth",
      "print-identity-token",
      `--impersonate-service-account=${serviceAccount}`,
      `--audiences=${url}`,
    ],
    { encoding: "utf-8" },
  ).trim();

  const queryString = opts.query ? "?" + new URLSearchParams(opts.query).toString() : "";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  if (opts.ingestSecret) {
    headers["X-Ingest-Secret"] = opts.ingestSecret;
  }

  const res = await fetch(url + queryString, {
    method: opts.method ?? "POST",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  const body = await res.text();
  return { status: res.status, body };
}
