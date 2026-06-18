# Sentinel Phase B2 — GCP Functions Observer Design

**Date:** 2026-06-17
**Status:** Approved
**Builds on:** `docs/superpowers/specs/2026-06-08-sentinel-jr-design.md` (Phase B item: `observers/gcp-functions`) and `docs/superpowers/specs/2026-06-12-sentinel-phase-b-coperniq-observer-design.md` (auth + observer-port pattern).

## Problem & scope

The Sentinel cycle (live, `OPENCLAW_SENTINEL_ENABLED=1`) observes JR's own DB, Slack channels, LaunchAgents, weather, industry context, and now Coperniq Firestore. It has no view of the **Cloud Functions that do the actual operational work**: BOM quote notifications, final-design sends, signed-design plan-set review, and the Firestore ingest sweeps. When one of those silently fails (PERMISSION_DENIED, 5xx, timeout), JR has no signal until a human notices.

**This spec covers the `gcp-functions` observer only.** `gmail-watcher` is deferred to Phase B3 because Gmail API access requires domain-wide delegation or user OAuth — a separate auth setup we haven't done.

## Decisions made during brainstorming

- **Scope:** `gcp-functions` only this round (`gmail-watcher` → Phase B3).
- **API:** Cloud Logging only. The impersonated SA already has `roles/logging.viewer`; no new IAM grants needed. Logs carry the error text, not just the count — which is what the synthesizer actually needs to reason about failures.
- **Targets:** all six deployed openclaw GCFs (`bomQuoteNotifier`, `finalDesignSender`, `signedDesignPlansetReview`, `coperniqFirestoreIngest`, `ghlFirestoreIngest`, `slackFirestoreIngest`). Hard-coded list; easy to extend.
- **Window:** last 2 hours, fixed. Matches the Sentinel cadence — each cycle covers exactly the interval since the last one with no gap or overlap.
- **Signals per function:** `invocation_count`, `error_count`, `last_invocation_at`, `last_error` (300-char excerpt of the newest ERROR-level entry), plus deltas vs prior observation.

## Component

**File:** `src/sentinel/observers/gcp-functions.ts` — `createGcpFunctionsObserver(deps): Observer`, `name: "gcp-functions"`. Registered in `src/sentinel/index.ts` alongside the other observers. No new feature flag — the master `OPENCLAW_SENTINEL_ENABLED` gate covers it.

**Deps (DI for tests):**

- `db` — sentinel SQLite handle, used to read the observer's own most recent observation for delta math.
- `getClient?: () => Promise<LoggingLike>` — per-call test seam (matches coperniq's pattern).
- `clientFactory?: () => Promise<LoggingLike> | LoggingLike` — lazy, cached factory; default builds a real client via ADC.

**LoggingLike port (test seam):**

```ts
export interface LogEntry {
  timestamp: string; // ISO
  severity: string; // DEFAULT, DEBUG, INFO, NOTICE, WARNING, ERROR, CRITICAL, ALERT, EMERGENCY
  text: string; // textPayload OR JSON-stringified jsonPayload (already flattened by the adapter)
}

export interface LoggingLike {
  listFunctionEntries(serviceName: string, sinceIso: string): Promise<LogEntry[]>;
}
```

The default factory (`defaultClientFactoryAsync`) instantiates `@google-cloud/logging` with `projectId: "openclaw-mail-bridge"` and returns an adapter. The adapter implements `listFunctionEntries` with a filter that targets both Gen 2 (`cloud_run_revision`) and Gen 1 (`cloud_function`) resource types — Gen 2 covers the four newer functions, Gen 1 may still cover the older ingest functions. Returning the union via `OR` is robust to either.

Filter shape:

```
(
  resource.type="cloud_run_revision"
  AND resource.labels.service_name="<serviceName>"
) OR (
  resource.type="cloud_function"
  AND resource.labels.function_name="<serviceName>"
)
AND timestamp >= "<sinceIso>"
```

`pageSize` capped at 1,000 per function (Logging API default; sufficient for a 2h window on these functions).

## Per-cycle behavior

`observe(_since)` (the runner-supplied `since` is unused — this observer uses a fixed 2h window, not a watermark):

1. `windowStartIso = new Date(now - 2 * 60 * 60 * 1000).toISOString()`.
2. For each of the six known function names, call `client.listFunctionEntries(name, windowStartIso)`. Run the six calls in parallel via `Promise.all`.
3. Per function, compute:
   - `invocations`: count of entries.
   - `errors`: count of entries with `severity` in `{"ERROR", "CRITICAL", "ALERT", "EMERGENCY"}`.
   - `last_invocation_at`: newest entry's timestamp (or `null` if no entries).
   - `last_error`: the newest entry whose severity is in the error set, truncated to 300 chars; `null` if no errors.
4. Read the most recent prior `gcp-functions` observation from `sentinel.db` to compute deltas (same pattern as coperniq).
5. Emit one observation. (See §Output.)

## Output observation

- `source: "gcp-functions"`, `topic: "gcp-functions"`, `timestamp: Date.now()`
- `summary`: human-readable, e.g. _"6 functions: 142 invocations, 3 errors (bomQuoteNotifier 2, ghlFirestoreIngest 1). Window: 2h."_ When there are zero errors: _"6 functions: 142 invocations, 0 errors. Window: 2h."_ Top-error contributors (functions with `errors > 0`) ranked by error count, top 4. Same composer style as coperniq.
- `metrics`: flattened — `invocations_total`, `errors_total`, per-function `<slug>_invocations` and `<slug>_errors`, and (when a prior observation exists) nonzero `delta_<slug>_invocations` and `delta_<slug>_errors`. Slugification: lowercase + non-alphanumeric → `_` (e.g. `bomQuoteNotifier` → `bomquotenotifier`).
- `data`: `{ windowStartIso, windowEndIso, functions: [{ name, invocations, errors, last_invocation_at, last_error }, ...] }`. Function entries appear in the order of the hard-coded list (stable across cycles).

## Error handling

- Any `listFunctionEntries` call throws → the parallel `Promise.all` rejects → observer throws → `runObservers` catches per-observer, records the error, and does NOT advance the watermark. Next cycle retries.
- An empty window (zero entries across all six functions) emits a valid observation with `invocations_total: 0, errors_total: 0` — useful as a positive heartbeat.
- ADC unavailable → factory throws on first call → observer throws → same retry path.

## Security notes (IT-SEC-001)

- Auth via ADC + service-account impersonation (already wired). No credential bytes in the observer process.
- `roles/logging.viewer` on the impersonated SA is project-scope read — the right least-privilege level for this purpose.
- `last_error` field captures log content verbatim. Cloud Functions sometimes log request bodies — if a Coperniq webhook payload contained PII, it could land in `sentinel.db`'s `data` column. **Mitigation:** the 300-char truncation limits exposure, and `sentinel.db` is local-only. Future hardening: redact known PII patterns (emails, phone numbers) before storing. Not blocking this build.

## Testing

- **Unit** (`tests/sentinel/observers/gcp-functions.test.ts`): fake `LoggingLike` via DI. Cover:
  - Per-function tally of invocations and errors (mixed severities).
  - `last_invocation_at` picks the newest entry by timestamp.
  - `last_error` picks the newest ERROR-or-worse entry and truncates at 300 chars.
  - First run (no prior observation): no `delta_*` keys.
  - Delta math vs seeded prior observation.
  - Window calculation: `windowStartIso` is `now - 2h` and is passed to each `listFunctionEntries` call.
  - Summary text format: present-tense head + top-error ranking phrase (or zero-errors variant).
  - Throw on any per-function call failure (any one rejects → whole observe throws).
  - Stable function ordering in `data.functions` matches the hard-coded list.
- **No live Cloud Logging in tests.**
- **Manual smoke (rollout):** one observation cycle on the Mac mini verifying that a `gcp-functions` observation lands in `sentinel.db` with sane numbers (compare against `gcloud functions logs read` output for the same window). ADC is already verified end-to-end.

## Out of scope

- `gmail-watcher` observer (Phase B3, requires Gmail auth setup).
- Per-function latency percentiles (Cloud Run request logs carry duration; YAGNI until perf concerns surface).
- Cold-start counts / instance-creation metrics (Cloud Monitoring territory; not Logging).
- Filtering by ingress source (HTTP vs Pub/Sub vs scheduler) — captures all invocations regardless.
- PII redaction of `last_error` text (mitigation: 300-char truncation + local-only DB).
- Auto-discovery of new GCFs (hard-coded list; new functions get added by extending the constant).
