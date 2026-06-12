# Sentinel Phase B — Coperniq Observer Design

**Date:** 2026-06-12
**Status:** Approved
**Builds on:** `docs/superpowers/specs/2026-06-08-sentinel-jr-design.md` (Phase B item: `observers/coperniq`)

## Problem & scope

The Sentinel cycle (live, `OPENCLAW_SENTINEL_ENABLED=1`) observes only in-house sources (self, slack-channels, launchagents, weather, industry-context). It has no view of Vero's operational core: Coperniq projects and work orders. Phase B per the original spec adds `coperniq`, `gcp-functions`, and `gmail-watcher` observers; **this spec covers the Coperniq observer only** (chosen as the first slice — highest value, no expired-ADC prerequisite). gcp-functions and gmail-watcher follow as a separate Phase B2 spec once gcloud ADC is refreshed.

## Decisions made during brainstorming

- **Source of truth is Firestore, not the local snapshot cache.** Kaleb: Coperniq data is ingested into Firestore (`coperniqFirestoreIngest` GCF) every couple of hours; JR should read that, not `~/.openclaw/cache/coperniq/`.
- **Signals: counts + deltas.** Project counts by stage, WO counts by status, and what changed since the last cycle. No rule-based stall detection — judgment calls stay in the synthesizer.
- **Approach: Firestore client SDK in-process with Keychain credential** (over hand-rolled REST auth or a server-side summary GCF).

## Data source facts (verified 2026-06-12)

- Firestore lives in GCP project `openclaw-mail-bridge`. Ingest source vendored at `/Users/vero/coperniq-ingest/vendor/coperniq-sync-firestore.ts`.
- Collections are prefixed `coperniq_` — relevant here: `coperniq_projects` (~214 docs, field `status`), `coperniq_work_orders` (~2,768 docs, fields `status`, `isCompleted`, `completedAt`), both with `createdAt`/`updatedAt`.
- Sync watermark doc: `coperniq_sync_meta/latest` with `lastSyncAt`, `elapsedSeconds`, doc counts.
- Credential: login Keychain item `openclaw-firestore-key` (from the 2026-05-28 Phase 2 keychain migration) holds a **hex-encoded** service-account JSON for `openclaw-mail-bridge@appspot.gserviceaccount.com`.

## Component

**File:** `src/sentinel/observers/coperniq.ts` — `createCoperniqObserver(deps): Observer`, `name: "coperniq"`. Registered in `src/sentinel/index.ts` with the other observers. No new feature flag — the master `OPENCLAW_SENTINEL_ENABLED` gate covers it; rollback is reverting the registration.

**Deps (DI for tests):**

- `db` — sentinel SQLite handle, used to read the observer's own most recent observation (for count-delta math and the stored `lastSyncAt`).
- `getClient?: () => Promise<FirestoreLike>` — test seam. Default implementation (lazy, cached after first success):
  1. `execFile("security", ["find-generic-password", "-w", "-s", "openclaw-firestore-key"])`
  2. hex-decode → `JSON.parse` → `{ client_email, private_key, project_id }`
  3. `new Firestore({ projectId, credentials: { client_email, private_key } })` via new dependency `@google-cloud/firestore`.

Key material lives only in process memory — never written to disk, env, or logs.

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
- Real failures — Keychain item missing/unreadable, hex/JSON decode failure, any Firestore error — **throw**. `runObservers` already catches per-observer, records `{observer, error}` in the run result, and does not advance the watermark, so the next 2h cycle retries naturally. No partial observations are written.

## Security notes (IT-SEC-001)

- Credential read in-process from Keychain; no plaintext key on disk; never logged.
- **Scope flag:** `openclaw-mail-bridge@appspot.gserviceaccount.com` is the App Engine default SA — much broader than the read-only Firestore access this observer needs. Follow-up (not blocking this build): mint a dedicated SA with `roles/datastore.viewer`, store it in the same Keychain pattern, and retire the broad key from this path.

## Testing

- **Unit** (`tests/sentinel/observers/coperniq.test.ts`): fake Firestore client + fake keychain reader via DI. Cover: watermark skip returns `[]` without collection reads; count grouping; delta math against a seeded prior observation; first-run (no prior observation) emits snapshot without deltas; changed-doc capture and 50-doc cap; hex decode of the keychain payload; throw on keychain failure; throw on Firestore failure.
- **No live Firestore in tests.**
- **Manual smoke (rollout):** one observation cycle on the Mac mini verifying (a) the Keychain read works non-interactively from the LaunchAgent context, and (b) a coperniq observation lands in sentinel.db with sane numbers vs `coperniq_sync_meta` counts.

## Out of scope

- `gcp-functions` and `gmail-watcher` observers (Phase B2, after ADC refresh).
- Financial summaries (the `invoices` collection is empty; revisit when populated).
- Stall/overdue detection rules (synthesizer's job).
- Changes to synthesizer, curator, reporter, inquirer — they consume observations generically.
- Decommissioning the local `coperniq-sync` cache/LaunchAgent (used by other consumers, e.g. the grading pipeline).
