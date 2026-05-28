# OpenClaw Cleanup + Clawbot Optimization — Design

**Date:** 2026-05-27
**Author:** Kaleb Lundquist (kaleb.lundquist@blytzpay.com), with Claude (Opus 4.7)
**Scope:** Repo prune + clawbot (JR) optimization on the Vero fork of `openclaw/openclaw`
**Strategy chosen:** Strategy 2 — Cleanup + Triage Repair + Prompt Sharpening
**Priority order:** Performance (A), Reliability (B), Cleaner agent behavior (C), Maintainability (E). Cost (D) not in scope.

## Context

`/Users/vero/openclaw` is a divergent fork of upstream `openclaw/openclaw` (v2026.2.19). The fork has heavily customized personality files (SOUL.md, IDENTITY.md, etc.), added Vero-specific cloud functions and skills, and disabled various upstream features (morning reports, heartbeat). The fork is **not** synced back to upstream; new work ships to a fork repo on Kaleb's GitHub.

The bot the user calls "clawbot" runs as `packages/clawdbot/` — a compat shim that forwards to the `openclaw` runtime. JR is the personality layered on top via root-level personality markdown files. Clawbot's only active channel is **Slack**; iMessage (native macOS) and Telegram are future additions.

Yesterday's session (2026-05-26) surfaced a broken triage pipeline (env vars `OPENCLAW_TRIAGE_DM=1` and `OPENCLAW_TRIAGE_SLACK_ALL=1` no longer drive the expected "triaging → thinking → message" Slack UX). Investigation found triage modules were removed from openclaw source around April 27, leaving the env-var flags pointing to absent code paths. The May 21 backup (`dist.may21.bak/`) and macOS Trash retain the prior implementation.

Yesterday also surfaced a Blytz IT-SEC-001 violation: a GCP service account key (`openclaw-firestore-key.json`) sitting in plaintext on disk. User moved the file but moving alone does not satisfy IT-SEC-001 — the key must be revoked and migrated to 1Password Infrastructure vault or GCP Secret Manager. This spec includes the formal close-out.

## Goals (in priority order)

- **A. Performance** — measurable cold-start reduction; faster Slack response latency.
- **B. Reliability** — restore the broken triage pipeline; reduce crash/restart noise.
- **C. Cleaner agent behavior** — JR less noisy in Slack; sharper persona; regression-tested silence behavior.
- **E. Maintainability** — single canonical config location; reproducible deploys; faster onboarding for future contributors (and future-Kaleb).

## Non-Goals

- Cost optimization (token spend). Not currently a pain point.
- Full clawdbot runtime rebuild (Strategy 3). Deferred until after this spec stabilizes.
- Upstream contribution. All work ships to the Vero fork on GitHub; no PRs to `openclaw/openclaw`.
- Reviving native iOS/Android/macOS apps. They're being deleted; recovery via the `pre-cleanup-snapshot` tag if ever needed.

## Section 1 — Cleanup Execution

### Deletion targets

| Category | Items | Notes |
|---|---|---|
| Native apps | `apps/android/`, `apps/ios/`, `apps/macos/`, `apps/shared/`, `Swabble/` | Self-contained Swift/Kotlin; no `src/` imports |
| Dead backup | `dist.may21.bak/` (29M, 714 files) | Pure dead weight |
| Empty | `Openclaw-Vero-Tools/` | Empty dir |
| Web UI | `ui/` | Slack-only bot has no web UI need |
| Upstream docs | `docs/` (incl. zh-CN mirror) | Move spec to `specs/` first |
| Channels not in use (21 extensions) | `bluebubbles`, `discord`, `feishu`, `googlechat`, `irc`, `line`, `matrix`, `mattermost`, `msteams`, `nextcloud-talk`, `nostr`, `open-prose`, `phone-control`, `signal`, `talk-voice`, `tlon`, `twitch`, `voice-call`, `whatsapp`, `zalo`, `zalouser` | Plugin loader auto-discovers; no static deps |
| Helpers / unused providers (4 extensions) | `shared` (only used by deleted extensions' tests), `qwen-portal-auth`, `minimax-portal-auth`, `copilot-proxy` | JR uses Gemini, not Qwen/MiniMax/Copilot |
| Flagged extensions (2) | `lobster`, `device-pair`, `diagnostics-otel` | User opted to delete all three |
| Skills not in keep list (~39) | All `skills/*` except: `slack`, `reply-in-slack`, `coperniq-employee-automation`, `coperniq-ops-monitoring`, `coperniq.io`, `clawhub`, `jr-commands`, `vero-tools`, `performance-grading`, `gh-issues`, `github`, `notion`, `obsidian`, `claude-code`, `coding-agent`, `summarize`, `model-usage`, `session-logs`, `skill-creator`, `gemini`, `imsg`, `canvas`. Includes deleted-channel skill variants (`bluebubbles`, `discord`, `voice-call`, `openai-whisper`, `openai-whisper-api`) and personal-utility skills (`sonoscli`, `spotify-player`, `food-order`, `things-mac`, `apple-notes`, `apple-reminders`, `bear-notes`, `weather`, `gog`, `songsee`, `openhue`, `gifgrep`, `tmux`, `goplaces`, `oracle`, `ordercli`, `wacli`, `blucli`, `eightctl`, `himalaya`, `peekaboo`, `camsnap`, `video-frames`, `nano-banana-pro`, `nano-pdf`, `openai-image-gen`, `1password`, `trello`, `blogwatcher`, `mcporter`, `sherpa-onnx-tts`, `sag`). | Auto-discovered; safe to delete |

### Keep (locked in)

- **Extensions (9):** `slack`, `imessage`, `telegram`, `memory-core`, `memory-lancedb`, `thread-ownership`, `llm-task`, `google-gemini-cli-auth`, `google-antigravity-auth`
- **Skills (~18 work-relevant):** `slack`, `reply-in-slack`, `coperniq-employee-automation`, `coperniq-ops-monitoring`, `coperniq.io`, `clawhub`, `jr-commands`, `vero-tools`, `performance-grading`, `gh-issues`, `github`, `notion`, `obsidian`, `claude-code`, `coding-agent`, `summarize`, `model-usage`, `session-logs`, `skill-creator`, plus `gemini`, `imsg` (native macOS), `canvas`
- **Runtime data:** `memory/`, `state/`, `email-archive/`
- **Canvas:** `vendor/a2ui/` and `src/canvas-host/` (user wants Canvas)
- **Sibling bots:** `packages/clawdbot/` (the shim), `packages/moltbot/` (presumed keep — confirm)

### Move out (not delete)

- `cloud-functions/` → new sibling repo `vero-cloud-functions` (5 functions: `bom-quote-notifier`, `coperniq-ingest`, `slack-ingest`, `final-design-sender`, `signed-design-planset-review`). Initialize as fresh git repo; verify deploys work from new location before removing from openclaw.

### Config tendrils to unwind

- `package.json`: remove scripts `android:*` (4), `ios:*` (4), `mac:*` (3), `format:swift`, `lint:swift`, `protocol:check`, `protocol:gen:swift`, `docs:*` (4), `check:docs`, `lint:docs*` (2).
- `vitest.config.ts`: drop `apps/macos/**` exclusions.
- `.gitignore`: remove ~15 lines of Swift/Android/iOS build-artifact ignores.
- `.github/dependabot.yml`: remove 3 entries (macos, MoltbotKit, android).
- `.github/workflows/ci.yml`: remove Swift/Android CI jobs.
- `.swiftlint.yml`, `.swiftformat`, `.pre-commit-config.yaml`: delete or scrub.
- `scripts/ios-configure-signing.sh`, `scripts/package-mac-app.sh`, `scripts/restart-mac.sh`, `scripts/protocol-gen-swift.ts`: delete.
- `src/compat/legacy-names.ts`: drop `MACOS_APP_SOURCES_DIR` constant.
- `SECURITY.md`, `CONTRIBUTING.md`: remove native-app references (small edits).
- `pnpm-workspace.yaml`: drop deleted-extension and deleted-package entries.

### Order of execution

1. Snapshot branch `pre-cleanup-snapshot`; tag baseline.
2. Move `cloud-functions/` to new sibling repo; verify; delete from openclaw.
3. Delete `dist.may21.bak/`.
4. Delete native apps + unwind config tendrils (single PR).
5. Delete unused extensions in logical batches (channels, helpers, providers).
6. Delete unused skills (single commit — auto-discovered, no tendrils).
7. Delete `ui/`, `docs/`, `Openclaw-Vero-Tools/` + scrub docs scripts.
8. `rm -rf node_modules pnpm-lock.yaml && pnpm install` → expect 2GB → ~500-800MB.
9. `pnpm build` + smoke test (boot, Slack DM, side-channel silence).

### Verification gates

- After step 4: `pnpm tsgo` passes.
- After step 5: `pnpm build` produces working `dist/`.
- After step 8: JR boots, connects to Slack, responds to a DM, ignores a side-channel message.

## Section 2 — Triage Pipeline Repair

### Diagnostic steps (before committing to repair path)

1. **Confirm runtime origin.** `which openclaw` + `npm ls -g openclaw`. If JR runs from a global install rather than this local repo, a fix here is inert until a new version is shipped.
2. **Diff backup vs current.** Extract the 5 missing triage files from `dist.may21.bak/` and the macOS Trash. Identify the API contract: triage entrypoint, handler signatures, Slack popup envelope shape.
3. **Check upstream provenance.** Grep upstream `openclaw/openclaw` git log for "triage" to determine *why* it was removed (replacement? safety? abandoned experiment?). Avoid rebuilding something deliberately killed.

### Repair path (chosen): 2b — reimplement in TypeScript

Write triage handlers fresh in `src/`, honoring the `OPENCLAW_TRIAGE_DM` and `OPENCLAW_TRIAGE_SLACK_ALL` env-var contract. Ship behind feature flag `OPENCLAW_TRIAGE_REIMPL=1`. Promote to default-on after soak.

Alternatives considered:
- **2a (restore-from-backup)** — paste compiled JS into `dist/`. Fast but unmaintainable; TS source still absent.
- **2c (extract as plugin)** — make triage an extension under `extensions/triage/`. Cleanest, but adds plugin-loader work; deferred as a future refactor.

### Acceptance criteria

- `OPENCLAW_TRIAGE_DM=1` produces the "triaging…" Slack ephemeral on incoming DM.
- Intermediate "thinking…" update appears during model reasoning.
- Final assistant message replaces the in-progress chain.
- Same behavior for channel messages with `OPENCLAW_TRIAGE_SLACK_ALL=1`.
- Feature flag `OPENCLAW_TRIAGE_REIMPL=0` cleanly disables without errors.

## Section 3 — JR Prompt Sharpening

### Personality file consolidation

Current set (8 files at repo root): `SOUL.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md`, `VISION.md`, `HEARTBEAT.md`, `SECURITY.md`, `AGENTS.md`.

Target set (5):
- `SOUL.md` — character only (vibe, tone, voice).
- `IDENTITY.md` — operating authority chain (Ridge Payne, Kaleb Lundquist, Jordan Evans).
- `USER.md` — user-context (people, team, company facts).
- `MEMORY.md` — pointer/index to memory backend, not narrative content.
- `SECURITY.md` — safety rules.

Delete or merge: `VISION.md`, `HEARTBEAT.md` (heartbeat disabled yesterday), `AGENTS.md` (if redundant).

### Slack reply gate (code-side, not just prompt)

Add a deterministic pre-LLM gate in `extensions/slack/`:

```
should_respond(message) =
   is_dm                               OR
   is_thread_jr_participates_in        OR
   contains_at_mention_jr              OR
   contains_jr_name_regex              OR
   (contains_question_phrase AND nearby_jr_reference)
```

If `false`, skip model invocation entirely. Drops cost and tightens behavior. Logs decisions for future tuning.

### Regression tests

Vitest cases asserting:
- Side-chat in a JR-present channel → no model invocation.
- DM → model invoked.
- @mention → model invoked.
- Follow-up in active thread → model invoked.
- Unrelated chatter post-JR-message → no model invocation.

### Prompt size measurement

Add a tiny script (`scripts/measure-prompt.ts`) that prints token counts of the assembled persona stack. Target: ≤2K tokens for `SOUL.md` + `IDENTITY.md` + `USER.md` combined.

### Acceptance criteria

- All silence/response regression tests pass in CI.
- Persona-stack token count ≤2K (measured before and after).
- 24h Slack soak test: JR ignores ≥95% of unaddressed messages.
- Personality files reduced from 8 → 5.

### Risk

Rewriting `SOUL.md` changes JR's voice. Diff requires Kaleb sign-off before merge — character is personal.

## Section 4 — Cold-Start & Lazy Loading

### Optimization moves

1. **Manifest cache.** Write `.openclaw/cache/manifest.json` at boot with parsed plugin + skill metadata; validate against mtimes on subsequent boots; skip parse if unchanged. Estimated win: 50-200ms cold start.
2. **Per-request skill gating.** Cheap classifier decides whether `<available_skills>` belongs in the system prompt. For pure conversational replies (acks, greetings, short DMs), skip injection. Estimated win: ~40% token reduction on short replies.
3. **Persona stack pre-warm.** Load `SOUL.md` + `IDENTITY.md` + `USER.md` into memory on first request; re-read only on file change.

### Out of scope (intentionally)

- Bun runtime swap.
- Lazy plugin loading (extensions need to register handlers at boot).
- Memory/SQLite-layer tuning (already fast enough).

### Acceptance criteria

- Cold-start time benchmarked before and after; target: ≥30% reduction.
- Tokens per acknowledgment reply: ≥40% reduction.
- Manifest cache survives reboot; busts correctly on file edits (tested).

### Risk

Per-request skill gating is heuristic. JR could skip a skill it should have used. Mitigation: log every "skipped skills injection" decision; default to "include" when uncertain; tune over time.

## Section 5 — Unified Config & IT-SEC-001 Close-Out

### Current config sprawl

- `.zshenv` — env vars (`OPENCLAW_TRIAGE_DM`, model aliases).
- `~/Library/LaunchAgents/*.plist` — launchd entries with API credentials in plaintext. **IT-SEC-001 violation.**
- `~/.openclaw/` — global dotfiles.
- `.openclaw/` (in repo) — per-project config.
- Repo root — personality files.
- Scattered `.env` files (unknown extent).
- Moved firestore key file (still on disk in plaintext after relocation).

### Target canonical layout

| Settings type | Location | Why |
|---|---|---|
| Runtime secrets | **1Password Infrastructure vault**, fetched via `op read` at startup | IT-SEC-001 compliant |
| Non-secret config | Single `.openclaw/config.toml` (committed) | Versioned, reviewable |
| Per-machine overrides | `~/.openclaw/local.toml` (gitignored) | Dev/prod parity |
| Personality | Repo root markdown (unchanged) | Already correct |
| Launchd plist | `~/Library/LaunchAgents/ai.openclaw.gateway.plist` calling a wrapper script that `op read`s secrets, then execs openclaw. **No `EnvironmentVariables` with secrets.** | IT-SEC-001 compliant |

### Execution

1. Inventory pass — grep filesystem for all current config touchpoints; produce a "before" map.
2. Provision 1Password Infrastructure vault items for: Slack bot token, Slack app token, Gemini API creds, Firestore service account, plus any others surfaced in step 1.
3. Write `op` wrapper script that hydrates secrets into process env.
4. Rewrite launchd plist to use the wrapper script.
5. Move non-secret env vars into `.openclaw/config.toml`.
6. **Secure deletion of plaintext copies:** `shred -u` the moved firestore key; scrub `.zshenv` of credentials; clear shell history references.
7. **Notify Sam Poulson in #security** same-day. Formal close-out of yesterday's IT-SEC-001 incident.

### Acceptance criteria

- `grep -r` across `$HOME` for known secret prefixes returns zero plaintext matches outside 1Password.
- `openclaw doctor` (or equivalent) confirms all required secrets resolve at runtime.
- Cold-machine boot succeeds using only 1Password + canonical config files.
- Config paths documented in repo README, one place.
- Sam acknowledges incident close-out in #security.

### Risk

Requires `op` CLI installed and signed-in on every machine that runs clawbot. If the 1Password daemon is locked, bot fails to start. Mitigation: clear error message instructing the user to `op signin`; document the unlock workflow in repo README.

### Compliance note

Blytz IT-SEC-001 (2026-05-22), Sec. "INCIDENT" — credential exposure requires immediate revocation and same-business-day notification. Yesterday's exposure is not fully closed until: (1) the key is revoked in GCP IAM, (2) the plaintext copy is securely deleted, (3) Sam is notified. This section formalizes that close-out as part of Phase 2.

## Section 6 — Rollout

### Phase sequence (each phase = its own PR to the Vero fork)

- **Phase 0 — Snapshot.** Branch `pre-cleanup-snapshot` from current `main`; commit/stash WIP; tag `vero-fork-2026.2.19-baseline`. Rollback point.
- **Phase 1 — Cleanup (Section 1).** Execute deletion in prescribed order, one logical commit per batch, single PR with full prune. Reinstall deps, rebuild, smoke test, merge.
- **Phase 2 — Config consolidation + IT-SEC-001 close-out (Section 5).** Provision 1Password items, rewrite launchd plist, migrate env vars, shred old plaintext, notify Sam. Config and tooling only — no behavior changes.
- **Phase 3 — Triage repair (Section 2).** Diagnostic pass, then reimplement in TS behind `OPENCLAW_TRIAGE_REIMPL=1`. Soak test. Flip default on.
- **Phase 4 — JR prompt sharpening (Section 3).** Personality file audit/consolidation, Slack reply gate, regression tests. Tag persona `jr-persona-v2`.
- **Phase 5 — Cold-start optimization (Section 4).** Manifest cache, per-request skill gating, persona pre-warm. Includes benchmark script committed in this phase.

### Verification gates between phases

- Each phase: JR boots, connects to Slack, answers a test DM, ignores a side-channel message.
- After Phase 2: `grep -r` for plaintext secrets returns empty.
- After Phase 5: benchmark shows ≥30% cold-start reduction from baseline.

### Branch strategy

- All work on the Vero fork (`origin`), never upstream `openclaw/openclaw`.
- `main` stays clean; each phase merges via PR with descriptive title.
- Tags after each phase: `vero-fork-cleanup`, `vero-fork-config-secured`, `vero-fork-triage-restored`, `vero-fork-persona-v2`, `vero-fork-coldstart-v1`.

### Rollback plan

- Phase fails → revert PR; JR returns to last-known-good tag.
- Catastrophic failure → reset to `pre-cleanup-snapshot`.

### Estimated effort

- **Phase 1 + 2 (urgent):** ~3-5 working days. Cleanup itself + compliance close-out.
- **Phase 3-5 (paced):** ~1-2 working weeks total. Phases are independent enough to interleave with other work.

## Open Questions / Confirm Before Phase 1

- **`packages/moltbot/`** — keep or also drop? It's a sibling bot package; not actively discussed. Assume keep unless told otherwise.
- **Upstream sync intent** — when (if ever) do we want to cherry-pick from `openclaw/openclaw`? Affects how aggressively we should preserve upstream file layout where possible.
- **`docs/`** — confirmed nuke; any docs Kaleb wants to preserve before deletion (e.g., personal notes embedded in upstream docs)?
- **CI** — `.github/workflows/ci.yml` currently runs Swift/Android/macOS jobs against deleted dirs. Trim to TypeScript-only CI as part of Phase 1.
