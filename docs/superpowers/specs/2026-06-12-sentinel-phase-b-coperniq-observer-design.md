# Sentinel Phase B — Coperniq Observer Design

**Date:** 2026-06-12
**Status:** Approved
**Builds on:** `docs/superpowers/specs/2026-06-08-sentinel-jr-design.md` (Phase B item: `observers/coperniq`)

## Problem & scope

The Sentinel cycle (live, `OPENCLAW_SENTINEL_ENABLED=1`) observes only in-house sources (self, slack-channels, launchagents, weather, industry-context). It has no view of Vero's operational core: Coperniq projects and work orders. Phase B per the original spec adds `coperniq`, `gcp-functions`, and `gmail-watcher` observers; **this spec covers the Coperniq observer only** (chosen as the first slice — highest value, no expired-ADC prerequisite). gcp-functions and gmail-watcher follow as a separate Phase B2 spec once gcloud ADC is refreshed.

## Decisions made during brainstorming

- **Source of truth is Firestore, not the local snapshot cache.** Kaleb: Coperniq data is ingested into Firestore (`coperniqFirestoreIngest` GCF) every couple of hours; JR should read that, not `~/.openclaw/cache/coperniq/`.
- **Signals: counts + deltas.** Project counts by stage, WO counts by status, and what changed since the last cycle. No rule-based stall detection — judgment calls stay in the synthesizer.
- **Approach: Firestore client SDK in-process via ADC + service-account impersonation** (revised 2026-06-17). Original draft assumed a Keychain-stored SA JSON; replaced by ADC. No credential bytes ever live in the observer process — the Google SDK auto-discovers the impersonation chain via `~/.config/gcloud/application_default_credentials.json`.

## Data source facts (verified 2026-06-12)

- Firestore lives in GCP project `openclaw-mail-bridge`. Ingest source vendored at `/Users/vero/coperniq-ingest/vendor/coperniq-sync-firestore.ts`.
- Collections are prefixed `coperniq_` — relevant here: `coperniq_projects` (~214 docs, field `status`), `coperniq_work_orders` (~2,768 docs, fields `status`, `isCompleted`, `completedAt`), both with `createdAt`/`updatedAt`.
- Sync watermark doc: `coperniq_sync_meta/latest` with `lastSyncAt`, `elapsedSeconds`, doc counts.
- Credential (revised 2026-06-17): **ADC** at `~/.config/gcloud/application_default_credentials.json` — user `jr@veropwr.com` impersonating `clawbot-openclaw-invoker@openclaw-mail-bridge.iam.gserviceaccount.com`. The impersonated SA holds `roles/datastore.user`, `roles/logging.viewer`, and per-service `run.invoker` on this project. No SA key JSON on disk. Google client libraries auto-impersonate via ADC with zero env-var or key-path configuration.

## Component

**File:** `src/sentinel/observers/coperniq.ts` — `createCoperniqObserver(deps): Observer`, `name: "coperniq"`. Registered in `src/sentinel/index.ts` with the other observers. No new feature flag — the master `OPENCLAW_SENTINEL_ENABLED` gate covers it; rollback is reverting the registration.

**Deps (DI for tests):**

- `db` — sentinel SQLite handle, used to read the observer's own most recent observation (for count-delta math and the stored `lastSyncAt`).
- `getClient?: () => Promise<FirestoreLike>` — test seam. Default implementation (lazy, cached after first success): `new Firestore({ projectId: "openclaw-mail-bridge" })` via `@google-cloud/firestore`. The SDK auto-discovers ADC and the impersonation chain; the observer code does not touch credentials at all.

## Per-cycle behavior

`observe(since)` where `since` is the runner-provided watermark (last successful observation time):

1. Read `coperniq_sync_meta/latest`. If `lastSyncAt` equals the value stored in the previous coperniq observation's `data` → return `[]` (no new ingest; no further Firestore reads this cycle).
2. `coperniq_projects`: read all docs with `.select("status")` → count map per stage.
3. `coperniq_work_orders`: read all docs with `.select("status")` → count map per status.
4. Changed-doc detail: `where("updatedAt", ">", since)` on both collections, `limit(50)` each, capturing id, title, current status. (`updatedAt` storage type — ISO string vs Firestore Timestamp — to be verified against the vendored ingest source during implementation planning; the query comparand must match.)
5. Deltas: diff current count maps against the previous observation's stored maps (first run: no deltas, snapshot only).

**Output: one observation**

- `source: "coperniq"`, `topic: "coperniq-ops"`, `timestamp: Date.now()`
- `summary`: 1–2 human-readable sentences, e.g. _"214 projects, 2,768 WOs. Since last sync: 3 projects advanced stage, 12 WOs completed (+12 done, −9 assigned)."_
- `metrics`: flattened numbers — `projects_total`, `work_orders_total`, `project_status_<slug>` per stage, `wo_status_<slug>` per status, `projects_changed`, `wos_changed`, plus per-status deltas (`delta_project_status_<slug>`, `delta_wo_status_<slug>` — nonzero only)
- `data`: `{ lastSyncAt, projectStatusCounts, woStatusCounts, changedProjects, changedWorkOrders }`

## Error handling

- Watermark skip (no new sync) → `[]`, quiet.
- Real failures — ADC unavailable (e.g., ADC file missing or impersonation rejected), any Firestore error — **throw**. `runObservers` already catches per-observer, records `{observer, error}` in the run result, and does not advance the watermark, so the next 2h cycle retries naturally. No partial observations are written.

## Security notes (IT-SEC-001)

- **No credential bytes on disk or in memory inside the observer.** Auth is ADC + service-account impersonation on the Mac mini. The Google SDK reads `~/.config/gcloud/application_default_credentials.json` and impersonates `clawbot-openclaw-invoker@openclaw-mail-bridge.iam.gserviceaccount.com`. Source identity: user `jr@veropwr.com`.
- **Scope flag (for the record):** the impersonated SA holds `roles/datastore.user` — project-wide _read+write_. Fine here because `openclaw-mail-bridge` only hosts JR's data. If a future observer ever needs to read a shared Firestore, the right pattern is a gateway Cloud Function with narrow scopes, not a wider SA role on this caller.

## Testing

- **Unit** (`tests/sentinel/observers/coperniq.test.ts`): fake `FirestoreLike` client via DI. Cover: watermark skip returns `[]` without collection reads; count grouping; delta math against a seeded prior observation; first-run (no prior observation) emits snapshot without deltas; changed-doc capture and 50-doc cap; throw on Firestore failure.
- **No live Firestore and no credential code in tests.**
- **Manual smoke (rollout):** one observation cycle on the Mac mini verifying that a coperniq observation lands in `sentinel.db` with sane numbers vs `coperniq_sync_meta` counts. ADC is already verified end-to-end on this machine (`@google-cloud/firestore` round-tripped a `_health/adc-check` write→read→delete on 2026-06-17).

## Out of scope

- `gcp-functions` and `gmail-watcher` observers (Phase B2, after ADC refresh).
- Financial summaries (the `invoices` collection is empty; revisit when populated).
- Stall/overdue detection rules (synthesizer's job).
- Changes to synthesizer, curator, reporter, inquirer — they consume observations generically.
- Decommissioning the local `coperniq-sync` cache/LaunchAgent (used by other consumers, e.g. the grading pipeline).
