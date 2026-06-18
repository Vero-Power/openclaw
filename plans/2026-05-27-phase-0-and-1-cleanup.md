# Phase 0 + Phase 1: OpenClaw Repo Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Snapshot the current state (pristine HEAD + WIP), then prune the Vero fork of openclaw down to what JR/clawbot actually needs (Slack + future iMessage/Telegram), move `cloud-functions/` to a sibling repo, repair `package.json` after script deletions, reinstall deps, and verify JR still boots and behaves correctly in Slack.

**Architecture:** Two-snapshot rollback pattern (pristine + post-WIP), phased deletion with one logical commit per batch, verification gates between phases, JR smoke test as final acceptance criterion. All work on the Vero fork (`origin`), never upstream.

**Tech Stack:** pnpm workspaces, Node 22, TypeScript, vitest, git tags.

**Spec:** `specs/2026-05-27-openclaw-cleanup-clawbot-optimization-design.md`

**Repo:** `/Users/vero/openclaw`

---

## Phase 0 — Snapshot

### Task 0.1: Verify clean baseline state

**Files:** None modified. Read-only audit.

- [ ] **Step 1: Verify working directory and branch**

```bash
cd /Users/vero/openclaw
pwd                      # Expected: /Users/vero/openclaw
git branch --show-current # Expected: main
git rev-parse HEAD       # Note the commit SHA for later
```

- [ ] **Step 2: Confirm WIP magnitude matches expectations**

```bash
git status --short | wc -l   # Expected: around 178
git status --short | grep '^ M' | wc -l   # Modified count
git status --short | grep '^ D' | wc -l   # Deleted count
git status --short | grep '^??' | wc -l   # Untracked count
```

Expected ballpark: ~175 deleted, ~5 modified, ~5 untracked. If wildly different, **STOP and ask the user** — the working tree may have changed since planning.

- [ ] **Step 3: Confirm tags don't already exist**

```bash
git tag --list 'pre-cleanup-snapshot-pristine' 'vero-fork-baseline-pre-phase1'
# Expected: empty output. If either tag exists, ask user before overwriting.
```

- [ ] **Step 4: Record TypeScript baseline error count**

```bash
pnpm tsgo --noEmit 2>&1 | tee /tmp/tsgo-baseline.txt | tail -5
# Count errors:
grep -cE "^\S.*: error TS[0-9]+:" /tmp/tsgo-baseline.txt 2>/dev/null || echo 0
```

Note this number — call it `TS_BASELINE`. Every verification gate in Phase 1 must show error count ≤ `TS_BASELINE`. New errors introduced by cleanup must be fixed; pre-existing errors are tolerated.

If `tsgo` is unavailable (e.g., not installed), record `TS_BASELINE=skipped` and skip all `pnpm tsgo` verification gates in Phase 1.

---

### Task 0.2: Stash WIP and tag pristine snapshot

**Files:** None deleted. Git operations only.

- [ ] **Step 1: Stash all WIP including untracked**

```bash
git stash push -u -m "pre-cleanup WIP $(date +%Y-%m-%d-%H%M)"
```

Expected: `Saved working directory and index state On main: pre-cleanup WIP 2026-05-27-...`

- [ ] **Step 2: Verify working tree is clean**

```bash
git status --short   # Expected: empty output
```

- [ ] **Step 3: Tag pristine snapshot**

```bash
git tag -a pre-cleanup-snapshot-pristine -m "Pristine HEAD before any cleanup. Vero fork at 2026.2.19 baseline."
git tag --list 'pre-cleanup-snapshot-pristine'   # Expected: pre-cleanup-snapshot-pristine
```

---

### Task 0.3: Restore WIP from stash

**Files:** Working tree returns to pre-stash state.

- [ ] **Step 1: Pop the stash**

```bash
git stash pop
```

Expected: working tree shows all 178 changes again.

- [ ] **Step 2: Verify all changes restored**

```bash
git status --short | wc -l   # Expected: matches Task 0.1 Step 2 count
```

If count differs, the stash was lossy — **STOP and investigate**.

---

### Task 0.4: Commit WIP in logical chunks

**Goal:** Group the 178 changes into 3-4 thematic commits so history is readable. Do NOT use `git add -A` — too risky for accidentally including secrets.

**Files modified or created (preserve):**
- `BOOTSTRAP.md` (new)
- `SOUL.md` (modified, yesterday's heartbeat-related edits)
- `HEARTBEAT.md` (modified, yesterday's disabling)
- `.openclaw/workspace-state.json` (modified, runtime state)
- `email-archive/emails.json` (modified)
- `src/slack/monitor/message-handler/dispatch.ts` (modified)
- `src/utils/provider-utils.ts` (modified)
- `cloud-functions/` (new, but will be moved out in Task 1.1)
- `dist.may21.bak/` (new, but will be deleted in Task 1.2)
- `skills/coperniq-employee-automation/` (new, in keep list)
- `specs/` (new, contains our design doc)

**Files deleted (preserve deletions):**
- All Docker / Podman / fly / render / systemd files
- All `scripts/*` files (will need partial restoration in Task 1.9)
- Top-level investigation scripts: `chester-investigation.mjs`, `count-*.mjs`, `create-customer-csv*.mjs`, `find-statuses.mjs`, `get-first-wo.mjs`, `debug-customer-csv.mjs`, `patch*.cjs`, `stats.cjs`, `test.js`, `temp_grade.js`
- Loose data files: `slack_history.json`, `solar_installation_customers.csv`, `testing_grades_report.md`, `grading-config.json`, `openclaw.podman.env`, `setup-podman.sh`
- `docs.acp.md` (loose at root)

- [ ] **Step 1: Commit infrastructure deletions (Docker/Podman/fly/render/systemd)**

```bash
git add -- \
  Dockerfile Dockerfile.sandbox Dockerfile.sandbox-browser Dockerfile.sandbox-common \
  docker-compose.yml docker-setup.sh \
  fly.private.toml fly.toml \
  render.yaml \
  setup-podman.sh openclaw.podman.env \
  scripts/docker/ scripts/e2e/ scripts/podman/ scripts/systemd/ \
  scripts/sandbox-browser-entrypoint.sh scripts/sandbox-browser-setup.sh \
  scripts/sandbox-common-setup.sh scripts/sandbox-setup.sh

git commit -m "chore: remove Docker, Podman, fly, render, systemd, sandbox infra

Vero fork is a single-machine launchd deployment. Container infra was upstream-only."
```

If `git add` rejects any path because the file doesn't exist at that path in either index or working tree, drop that argument and re-run. (Some files may already be gone from the index.)

- [ ] **Step 2: Commit deleted ad-hoc investigation scripts**

```bash
git add -- \
  chester-investigation.mjs \
  count-coperniq.mjs count-projects.mjs count-sets.sh \
  create-customer-csv-final.mjs create-customer-csv.mjs debug-customer-csv.mjs \
  find-statuses.mjs get-first-wo.mjs \
  patch.cjs patch2.cjs patch_cron.cjs patch_cron2.cjs \
  patch_customer_emails.cjs patch_emails_engineering.cjs \
  stats.cjs test.js temp_grade.js \
  slack_history.json solar_installation_customers.csv \
  testing_grades_report.md grading-config.json \
  docs.acp.md

git commit -m "chore: remove ad-hoc investigation scripts and loose data dumps

These were one-off scripts and exported CSVs from previous Coperniq/Slack
debugging sessions. Not part of the runtime."
```

- [ ] **Step 3: Commit deleted scripts/ contents**

This is the biggest chunk. Stage the entire `scripts/` directory deletions in one go.

```bash
git add scripts/
git status --short | grep '^[AD] scripts/' | head -20   # Sanity-check the stage
git commit -m "chore: remove upstream scripts/ helpers

Vero fork doesn't build from source on this machine (runs from dist/).
Build/test/release scripts will be partially restored in Task 1.9
where package.json still references them."
```

- [ ] **Step 4: Commit modifications + new files (preserve)**

```bash
git add -- \
  BOOTSTRAP.md \
  SOUL.md HEARTBEAT.md \
  .openclaw/workspace-state.json \
  email-archive/emails.json \
  src/slack/monitor/message-handler/dispatch.ts \
  src/utils/provider-utils.ts \
  skills/coperniq-employee-automation/ \
  specs/

git commit -m "feat: preserve Vero-specific source mods, personality edits, and design spec

Includes:
- SOUL.md + HEARTBEAT.md: heartbeat-related edits from 2026-05-26
- src/slack/monitor/message-handler/dispatch.ts: Slack dispatch tweaks
- src/utils/provider-utils.ts: provider util tweaks
- skills/coperniq-employee-automation: keep-list skill (was untracked)
- specs/2026-05-27-openclaw-cleanup-clawbot-optimization-design.md: this plan's spec
- BOOTSTRAP.md: bootstrap notes"
```

- [ ] **Step 5: Stage and commit the remaining untracked items intentionally**

`cloud-functions/` and `dist.may21.bak/` are untracked but will be acted on in Phase 1. Stage them now so the snapshot is complete:

```bash
git add cloud-functions/ dist.may21.bak/
git commit -m "chore: snapshot untracked cloud-functions/ and dist.may21.bak/ for traceability

Both will be removed in Phase 1 (cloud-functions moves to sibling repo,
dist.may21.bak deleted as dead backup)."
```

- [ ] **Step 6: Verify working tree is clean**

```bash
git status --short   # Expected: empty
```

If anything remains, stage and commit it under a single follow-up commit `chore: tidy stragglers from WIP snapshot`, listing what was included in the commit body.

---

### Task 0.5: Tag pre-phase1 baseline

**Files:** None. Git operations only.

- [ ] **Step 1: Tag the post-WIP HEAD**

```bash
git tag -a vero-fork-baseline-pre-phase1 -m "Vero fork after committing all pre-existing WIP, before Phase 1 deletion work begins."
git tag --list 'vero-fork-baseline-pre-phase1'   # Expected: vero-fork-baseline-pre-phase1
```

- [ ] **Step 2: Verify both rollback points exist**

```bash
git tag --list 'pre-cleanup-snapshot-pristine' 'vero-fork-baseline-pre-phase1'
# Expected: both listed
git log --oneline -8   # Should show 4-5 new commits since pristine HEAD
```

---

### Task 0.6: Create cleanup branch

**Files:** None. Git operations only.

- [ ] **Step 1: Create and check out cleanup branch**

```bash
git checkout -b cleanup/phase-1-prune
```

- [ ] **Step 2: Verify branch**

```bash
git branch --show-current   # Expected: cleanup/phase-1-prune
```

All Phase 1 commits land on this branch. `main` is untouched until the Phase 1 PR merges.

---

## Phase 1 — Cleanup Execution

### Task 1.1: Move cloud-functions to sibling repo

**Files:**
- Source: `/Users/vero/openclaw/cloud-functions/`
- Destination: `/Users/vero/vero-cloud-functions/` (new sibling repo)

- [ ] **Step 1: Verify destination doesn't already exist**

```bash
ls /Users/vero/vero-cloud-functions 2>&1
# Expected: ls: /Users/vero/vero-cloud-functions: No such file or directory
```

If it exists, **STOP and ask the user** — don't overwrite.

- [ ] **Step 2: Copy cloud-functions to new location**

```bash
cp -R /Users/vero/openclaw/cloud-functions /Users/vero/vero-cloud-functions
```

- [ ] **Step 3: Initialize as fresh git repo**

```bash
cd /Users/vero/vero-cloud-functions
git init -b main
git add .
git commit -m "init: import cloud-functions from openclaw fork

Functions migrated from openclaw monorepo to dedicated repo:
- bom-quote-notifier
- coperniq-ingest
- final-design-sender
- signed-design-planset-review
- slack-ingest"
```

- [ ] **Step 4: Verify install/syntax (deploy verification deferred to user)**

```bash
ls /Users/vero/vero-cloud-functions/   # Expected: all 5 function dirs + docs
# If each function has its own package.json, confirm they parse:
for d in /Users/vero/vero-cloud-functions/*/; do
  [ -f "$d/package.json" ] && node -e "require('$d/package.json')" 2>&1 | head -1
done
```

Note: the user is responsible for setting up the GitHub remote and deploy pipeline for this new repo. That's out of scope for this plan.

- [ ] **Step 5: Delete from openclaw and commit**

```bash
cd /Users/vero/openclaw
git rm -r cloud-functions/
git commit -m "chore: move cloud-functions to sibling repo vero-cloud-functions

5 GCP/cloud functions migrated out: bom-quote-notifier, coperniq-ingest,
final-design-sender, signed-design-planset-review, slack-ingest.
Source preserved in /Users/vero/vero-cloud-functions."
```

- [ ] **Step 6: Verification gate**

```bash
test ! -d /Users/vero/openclaw/cloud-functions && echo "✓ cloud-functions gone from openclaw"
test -d /Users/vero/vero-cloud-functions && echo "✓ cloud-functions present in sibling repo"
```

Both must echo success.

---

### Task 1.2: Delete dist.may21.bak/

**Files:**
- Delete: `/Users/vero/openclaw/dist.may21.bak/` (29M, 714 files)

- [ ] **Step 1: Confirm nothing in src/, packages/, extensions/ references the backup**

```bash
cd /Users/vero/openclaw
grep -r "dist.may21.bak" src/ packages/ extensions/ skills/ 2>&1 | head -5
# Expected: no matches
```

If matches found, **STOP and investigate** — something might depend on the backup.

- [ ] **Step 2: Delete the backup**

```bash
git rm -r dist.may21.bak/
```

- [ ] **Step 3: Verify deletion**

```bash
test ! -d dist.may21.bak && echo "✓ backup gone"
du -sh /Users/vero/openclaw   # Repo size should be ~29M smaller
```

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: delete dist.may21.bak (29M dead backup from May 21 snapshot)

The backup was retained while investigating the broken triage pipeline.
Triage repair (Phase 3) will extract any needed references from the
pristine snapshot tag instead."
```

---

### Task 1.3: Delete native apps

**Files:**
- Delete: `apps/android/`, `apps/ios/`, `apps/macos/`, `apps/shared/`, `Swabble/`

- [ ] **Step 1: Verify apps/ is self-contained (sanity check)**

```bash
cd /Users/vero/openclaw
grep -rn "apps/\(android\|ios\|macos\|shared\)\|Swabble" src/ packages/ extensions/ skills/ 2>&1 | head -10
# Expected: no matches in TypeScript/JS runtime code
# (Config tendrils in package.json/CI/etc. handled in Task 1.4)
```

- [ ] **Step 2: Delete native app directories**

```bash
git rm -r apps/android apps/ios apps/macos apps/shared Swabble/
```

- [ ] **Step 3: Verify**

```bash
ls apps/ 2>&1   # Expected: empty or no such directory
test ! -d Swabble && echo "✓ Swabble gone"
```

- [ ] **Step 4: Remove empty apps/ if it remains**

```bash
[ -d apps ] && rmdir apps 2>/dev/null
```

- [ ] **Step 5: Commit**

```bash
git commit -m "chore: delete native iOS/Android/macOS apps and Swabble Swift package

Vero fork is a Slack-only server-side bot. Native client apps are not in scope.
Config tendrils (package.json scripts, CI, dependabot, swift tooling) are
unwound in the next commit."
```

---

### Task 1.4: Unwind native-app config tendrils

**Files:**
- Modify: `package.json` (remove ~16 scripts)
- Modify: `vitest.config.ts` (drop `apps/macos/**` exclusions)
- Modify: `.gitignore` (remove Swift/Android/iOS sections)
- Modify: `.github/dependabot.yml` (remove 3 entries)
- Modify: `.github/workflows/ci.yml` (remove Swift/Android CI jobs)
- Delete: `.swiftlint.yml`, `.swiftformat`, `.pre-commit-config.yaml`
- Modify: `SECURITY.md`, `CONTRIBUTING.md` (remove native-app references)
- Modify: `src/compat/legacy-names.ts` (remove `MACOS_APP_SOURCES_DIR`)

- [ ] **Step 1: Remove native-app scripts from package.json**

Open `package.json`. Remove these script keys: `android:assemble`, `android:install`, `android:run`, `android:test`, `ios:build`, `ios:gen`, `ios:open`, `ios:run`, `mac:open`, `mac:package`, `mac:restart`, `format:swift`, `lint:swift`, `protocol:check`, `protocol:gen:swift`, `lint:all` (only references `lint:swift`), `format:all` (only references `format:swift`).

Also remove the `pnpm protocol:gen:swift` reference from any remaining script.

Verify JSON still parses:

```bash
node -e "console.log(Object.keys(require('./package.json').scripts).length)" 
# Expected: previous count minus removed scripts
```

- [ ] **Step 2: Remove apps/macos exclusions from vitest.config.ts**

Edit `vitest.config.ts`. Find the `exclude` array around line 45-46:

```ts
exclude: [
  "**/node_modules/**",
  "apps/macos/**",         // ← remove this line
  "apps/macos/.build/**",  // ← remove this line
  // ...
]
```

Save the file. Verify TypeScript still parses:

```bash
pnpm tsgo --noEmit vitest.config.ts 2>&1 | head -5
# Expected: no errors
```

- [ ] **Step 3: Remove Swift/Android sections from .gitignore**

Edit `.gitignore`. Delete all lines matching: `apps/android/`, `apps/macos/`, `apps/ios/`, `apps/shared/`, `*.xcodeproj/`, `*.xcworkspace/`, `.swiftpm/`, `.derivedData/`, `Clawdbot.xcodeproj`, `.swiftformat-cache`, lines 22-60 approximately.

Verify:

```bash
grep -n "apps/" .gitignore   # Expected: no matches
grep -n "Swift\|Xcode\|swiftpm\|xcodeproj" .gitignore   # Expected: no matches
```

- [ ] **Step 4: Remove dependabot native entries**

Edit `.github/dependabot.yml`. Remove the three entry blocks for:
- `directory: /apps/macos`
- `directory: /apps/shared/MoltbotKit`
- `directory: /apps/android`

Verify YAML still parses:

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/dependabot.yml'))" && echo "✓ YAML valid"
```

- [ ] **Step 5: Trim CI workflow**

Edit `.github/workflows/ci.yml`. Remove any job that:
- Runs `swiftlint`, `swiftformat`, `xcodebuild`, `gradle`
- Operates on `apps/macos`, `apps/ios`, `apps/android`, `apps/shared`

Verify YAML still parses:

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))" && echo "✓ YAML valid"
```

- [ ] **Step 6: Delete Swift tooling configs**

```bash
git rm .swiftlint.yml .swiftformat .pre-commit-config.yaml
```

- [ ] **Step 7: Scrub SECURITY.md and CONTRIBUTING.md**

Edit `SECURITY.md`. Remove the three lines referencing native apps (around lines 10-12):

```
- **macOS desktop app** — [openclaw/openclaw](https://github.com/openclaw/openclaw) (apps/macos)
- **iOS app** — [openclaw/openclaw](https://github.com/openclaw/openclaw) (apps/ios)
- **Android app** — [openclaw/openclaw](https://github.com/openclaw/openclaw) (apps/android)
```

Edit `CONTRIBUTING.md`. Remove any section that talks about contributing to native apps. Search-string: `apps/`.

```bash
grep -n "apps/" SECURITY.md CONTRIBUTING.md   # Expected: no matches
```

- [ ] **Step 8: Remove MACOS_APP_SOURCES_DIR from src/compat/legacy-names.ts**

Edit `src/compat/legacy-names.ts`. Delete these lines:

```ts
export const MACOS_APP_SOURCES_DIR = "apps/macos/Sources/OpenClaw" as const;

export const LEGACY_MACOS_APP_SOURCES_DIRS = [] as const;
```

Then check no other file imports them:

```bash
grep -rn "MACOS_APP_SOURCES_DIR\|LEGACY_MACOS_APP_SOURCES_DIRS" src/ packages/ extensions/ 2>&1
# Expected: no matches (or only the deleted lines if grep runs before edit)
```

If matches exist in other files, delete those references too (likely safe — the constant pointed at a directory we just deleted).

- [ ] **Step 9: Verification gate — TypeScript still compiles**

```bash
pnpm tsgo --noEmit 2>&1 | tail -20
# Expected: 0 errors
```

If errors, fix them inline. Most likely: an import of `MACOS_APP_SOURCES_DIR` left in a file — grep and remove.

- [ ] **Step 10: Commit**

```bash
git add -A package.json vitest.config.ts .gitignore .github/dependabot.yml .github/workflows/ci.yml SECURITY.md CONTRIBUTING.md src/compat/legacy-names.ts
git rm .swiftlint.yml .swiftformat .pre-commit-config.yaml 2>/dev/null || true
git commit -m "chore: unwind native-app config tendrils

- package.json: remove android/ios/mac scripts, swift lint/format, protocol:gen:swift
- vitest.config.ts: drop apps/macos exclusions
- .gitignore: remove Swift/Android/iOS sections
- .github/dependabot.yml: remove macos/MoltbotKit/android entries
- .github/workflows/ci.yml: remove Swift/Android CI jobs
- delete .swiftlint.yml, .swiftformat, .pre-commit-config.yaml
- SECURITY.md, CONTRIBUTING.md: remove native-app references
- src/compat/legacy-names.ts: remove MACOS_APP_SOURCES_DIR"
```

---

### Task 1.5: Delete unused channel extensions (21)

**Files (delete):**
`extensions/{bluebubbles,discord,feishu,googlechat,irc,line,matrix,mattermost,msteams,nextcloud-talk,nostr,open-prose,phone-control,signal,talk-voice,tlon,twitch,voice-call,whatsapp,zalo,zalouser}/`

Also: `src/line/`, `src/discord/`, `src/imessage/` are channel-specific source dirs — check before deleting (imessage stays since user wants iMessage future; line and discord channels are deleted but their src/ counterparts may carry dependency).

- [ ] **Step 1: Survey channel-specific src/ directories**

```bash
cd /Users/vero/openclaw
ls src/line src/discord src/imessage 2>&1
grep -rln "src/line\|src/discord" src/ packages/ 2>&1 | grep -v "^src/line\|^src/discord" | head -10
```

Decision: if `src/line/` and `src/discord/` are only imported by their own internal files, delete them with the matching extension. If imported elsewhere, leave them as `// TODO: stranded after channel removal` and surface to user.

- [ ] **Step 2: Delete the 21 channel extensions**

```bash
git rm -r extensions/bluebubbles extensions/discord extensions/feishu extensions/googlechat extensions/irc extensions/line extensions/matrix extensions/mattermost extensions/msteams extensions/nextcloud-talk extensions/nostr extensions/open-prose extensions/phone-control extensions/signal extensions/talk-voice extensions/tlon extensions/twitch extensions/voice-call extensions/whatsapp extensions/zalo extensions/zalouser
```

- [ ] **Step 3: Delete src/ counterparts if survey allowed**

```bash
# Only if Step 1 survey showed src/line and src/discord are isolated:
git rm -r src/line src/discord 2>/dev/null || true
# Always keep src/imessage (future channel)
```

- [ ] **Step 4: Update pnpm-workspace.yaml**

Open `pnpm-workspace.yaml`. If it lists individual extensions, remove the deleted ones. If it uses a wildcard (`extensions/*`), no edit needed.

```bash
cat pnpm-workspace.yaml
```

- [ ] **Step 5: Verification gate — TypeScript still compiles**

```bash
pnpm tsgo --noEmit 2>&1 | tail -20
# Expected: 0 errors. If errors, fix imports in src/ that pointed at deleted channels.
```

- [ ] **Step 6: Commit**

```bash
git commit -m "chore: delete 21 unused channel extensions

JR runs Slack-only; iMessage and Telegram are kept for future use.
Removed: bluebubbles, discord, feishu, googlechat, irc, line, matrix,
mattermost, msteams, nextcloud-talk, nostr, open-prose, phone-control,
signal, talk-voice, tlon, twitch, voice-call, whatsapp, zalo, zalouser."
```

---

### Task 1.6: Delete 7 helper/auth/utility extensions

**Files (delete):**
`extensions/{shared,qwen-portal-auth,minimax-portal-auth,copilot-proxy,lobster,device-pair,diagnostics-otel}/`

- [ ] **Step 1: Final reference check**

```bash
cd /Users/vero/openclaw
grep -rn "extensions/\(shared\|qwen-portal-auth\|minimax-portal-auth\|copilot-proxy\|lobster\|device-pair\|diagnostics-otel\)\|@openclaw/\(shared\|qwen-portal-auth\|minimax-portal-auth\|copilot-proxy\|lobster\|device-pair\|diagnostics-otel\)" src/ packages/ extensions/ 2>&1 | head -10
```

Expected: only matches inside the soon-to-be-deleted directories themselves. If matches in `src/` or kept extensions, **STOP and investigate**.

- [ ] **Step 2: Delete**

```bash
git rm -r extensions/shared extensions/qwen-portal-auth extensions/minimax-portal-auth extensions/copilot-proxy extensions/lobster extensions/device-pair extensions/diagnostics-otel
```

- [ ] **Step 3: Verification gate**

```bash
pnpm tsgo --noEmit 2>&1 | tail -20
# Expected: 0 errors
```

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: delete 7 helper/auth/utility extensions

- shared: only used by deleted extensions' tests
- qwen-portal-auth, minimax-portal-auth: JR uses Gemini, not Qwen/MiniMax
- copilot-proxy: GitHub Copilot provider, irrelevant for Gemini-backed JR
- lobster: workflow tool plugin, not actively invoked by JR
- device-pair: multi-device pairing, not needed for server-side bot
- diagnostics-otel: OpenTelemetry exporter, no OTLP backend configured"
```

---

### Task 1.7: Delete unused skills (~39)

**Files (delete):**
All `skills/*` directories EXCEPT the keep-list:

**Keep:** `slack`, `reply-in-slack`, `coperniq-employee-automation`, `coperniq-ops-monitoring`, `coperniq.io`, `clawhub`, `jr-commands`, `vero-tools`, `performance-grading`, `gh-issues`, `github`, `notion`, `obsidian`, `claude-code`, `coding-agent`, `summarize`, `model-usage`, `session-logs`, `skill-creator`, `gemini`, `imsg`, `canvas`.

- [ ] **Step 1: Generate delete list deterministically**

```bash
cd /Users/vero/openclaw
KEEP="slack reply-in-slack coperniq-employee-automation coperniq-ops-monitoring coperniq.io clawhub jr-commands vero-tools performance-grading gh-issues github notion obsidian claude-code coding-agent summarize model-usage session-logs skill-creator gemini imsg canvas"

# Show what will be deleted (preview, no action):
for dir in skills/*/; do
  name=$(basename "$dir")
  if ! echo " $KEEP " | grep -q " $name "; then
    echo "DELETE: $dir"
  fi
done
```

Expected: ~39 lines of `DELETE:` output. Review the list visually before proceeding.

- [ ] **Step 2: Execute deletion**

```bash
for dir in skills/*/; do
  name=$(basename "$dir")
  if ! echo " $KEEP " | grep -q " $name "; then
    git rm -r "$dir"
  fi
done
```

- [ ] **Step 3: Verify keep-list survived**

```bash
for k in $KEEP; do
  test -d "skills/$k" && echo "✓ $k" || echo "✗ MISSING: $k"
done
```

All 22 keep-list entries should show ✓. If any show ✗, **STOP and investigate** — the entry may not have existed (typo) or was accidentally deleted.

- [ ] **Step 4: Verification gate**

```bash
ls skills/ | wc -l   # Expected: 22
```

- [ ] **Step 5: Commit**

```bash
git commit -m "chore: delete ~39 unused skills from skills/

Skills are auto-discovered by the plugin loader, so deletion only removes
them from JR's <available_skills> menu. No runtime imports affected.

Kept (22): slack, reply-in-slack, coperniq-{employee-automation,
ops-monitoring,io}, clawhub, jr-commands, vero-tools, performance-grading,
gh-issues, github, notion, obsidian, claude-code, coding-agent, summarize,
model-usage, session-logs, skill-creator, gemini, imsg, canvas.

Deleted: deleted-channel skill variants (bluebubbles, discord, voice-call,
openai-whisper, openai-whisper-api) plus personal-utility skills
(sonoscli, spotify-player, food-order, things-mac, apple-notes,
apple-reminders, bear-notes, weather, gog, songsee, openhue, gifgrep,
tmux, goplaces, oracle, ordercli, wacli, blucli, eightctl, himalaya,
peekaboo, camsnap, video-frames, nano-banana-pro, nano-pdf,
openai-image-gen, 1password, trello, blogwatcher, mcporter,
sherpa-onnx-tts, sag)."
```

---

### Task 1.8: Delete ui/, docs/, Openclaw-Vero-Tools/

**Files (delete):**
- `ui/`, `docs/`, `Openclaw-Vero-Tools/`

- [ ] **Step 1: Confirm no source code references**

```bash
cd /Users/vero/openclaw
grep -rln "from '\.\./ui\|from \"\.\./ui\|require('\.\./ui'\|require(\"\.\./ui\"" src/ packages/ extensions/ 2>&1 | head -5
# Expected: no matches
grep -rn "Openclaw-Vero-Tools" src/ packages/ extensions/ skills/ 2>&1 | head -5
# Expected: no matches (empty dir anyway)
```

- [ ] **Step 2: Delete**

```bash
git rm -r ui/ docs/ Openclaw-Vero-Tools/
```

- [ ] **Step 3: Remove docs scripts from package.json**

Edit `package.json`. Remove these script keys: `docs:bin`, `docs:check-links`, `docs:dev`, `docs:list`, `check:docs`, `format:docs`, `format:docs:check`, `lint:docs`, `lint:docs:fix`.

Also remove `ui:build`, `ui:dev`, `ui:install`, and `test:ui` (they all `cd ui` or depend on `scripts/ui.js` which was deleted).

```bash
node -e "console.log(Object.keys(require('./package.json').scripts).length)"
# Expected: smaller than before
```

- [ ] **Step 4: Verification gate**

```bash
test ! -d ui && test ! -d docs && test ! -d Openclaw-Vero-Tools && echo "✓ all three gone"
```

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "chore: delete ui/, docs/, Openclaw-Vero-Tools/

- ui/: Vite web UI, not needed for Slack-only server bot
- docs/: upstream openclaw docs (incl. zh-CN mirror), not maintained by Vero fork
- Openclaw-Vero-Tools/: empty placeholder
- package.json: drop docs:*, ui:*, test:ui, check:docs, lint:docs* scripts"
```

---

### Task 1.9: Repair package.json after script deletions

**Context:** In Task 0.4 Step 3 we committed the deletion of `scripts/`. Many `package.json` scripts still reference deleted files. This task fixes that.

**Goal:** Either delete the broken script entries from `package.json` OR restore the specific scripts files needed for the keep-list build/test commands.

**Strategy:** Delete broken script entries. If you (the user) later need to rebuild from source, restore selectively from `pre-cleanup-snapshot-pristine`.

- [ ] **Step 1: Audit which package.json scripts reference deleted files**

```bash
cd /Users/vero/openclaw
node -e "
const pkg = require('./package.json');
const fs = require('fs');
const path = require('path');
for (const [name, cmd] of Object.entries(pkg.scripts)) {
  const matches = cmd.match(/scripts\/[a-zA-Z0-9._/-]+/g);
  if (!matches) continue;
  for (const m of matches) {
    if (!fs.existsSync(m)) {
      console.log(\`BROKEN: pnpm run \${name}  →  missing \${m}\`);
    }
  }
}
" 2>&1
```

Review the list. Every "BROKEN" line is a script that won't work.

- [ ] **Step 2: Delete the broken script entries from package.json**

Open `package.json`. For every script name that appeared in the BROKEN audit:
- If the script is `build`, `prepack`, `test`, `dev`, `start`, `gateway:dev*`, `gateway:watch`, `tui`, `tui:dev`, `openclaw`, `openclaw:rpc`, `moltbot:rpc`, `release:check`, `protocol:gen`, `plugins:sync`, `check`, `check:loc`, `test:fast`, `test:e2e`, `test:live`, `test:macmini`, `test:watch`, `test:coverage`, `test:voicecall:closedloop`, `test:install:*`, `test:docker:*` — **delete the entry** (we run from pre-built `dist/`, not from source).
- If you can't tell, delete it. The user can always restore from `pre-cleanup-snapshot-pristine` if they need to rebuild.

Verify JSON still parses:

```bash
node -e "JSON.parse(require('fs').readFileSync('./package.json','utf8'))" && echo "✓ valid JSON"
```

- [ ] **Step 3: Re-run the broken-scripts audit**

```bash
node -e "
const pkg = require('./package.json');
const fs = require('fs');
let broken = 0;
for (const [name, cmd] of Object.entries(pkg.scripts)) {
  const matches = cmd.match(/scripts\/[a-zA-Z0-9._/-]+/g);
  if (!matches) continue;
  for (const m of matches) {
    if (!fs.existsSync(m)) { console.log(\`STILL BROKEN: \${name} →  \${m}\`); broken++; }
  }
}
console.log(broken === 0 ? '✓ no broken script refs' : '✗ ' + broken + ' still broken');
"
```

Expected: `✓ no broken script refs`.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: prune package.json scripts referencing deleted files

Vero fork runs from pre-built dist/, not from source. Build/test/release
scripts that referenced deleted scripts/ files are removed.

To rebuild from source later, restore needed scripts from the
pre-cleanup-snapshot-pristine tag."
```

---

### Task 1.10: Reinstall dependencies

**Files:** Delete and regenerate `node_modules/` + `pnpm-lock.yaml`.

- [ ] **Step 1: Record baseline sizes**

```bash
cd /Users/vero/openclaw
du -sh node_modules pnpm-lock.yaml 2>&1
```

Note the numbers — they'll appear in the commit message.

- [ ] **Step 2: Nuke and reinstall**

```bash
rm -rf node_modules pnpm-lock.yaml
pnpm install 2>&1 | tail -20
```

Expected: `Done in ...` with no fatal errors. Warnings about peer dependencies are fine.

- [ ] **Step 3: Record new sizes**

```bash
du -sh node_modules pnpm-lock.yaml 2>&1
```

Expected: node_modules ~500-800MB (down from ~2GB). pnpm-lock.yaml smaller as well.

- [ ] **Step 4: Commit lockfile**

```bash
git add pnpm-lock.yaml
git commit -m "chore: regenerate pnpm-lock.yaml after extension/skill prune

node_modules shrunk from <before> to <after> after extension and
package deletions removed transitive dependency requirements."
```

Replace `<before>` and `<after>` with the actual measurements.

---

### Task 1.11: Build verification

**Context:** With package.json scripts pruned, the standard `pnpm build` may not exist anymore. This task validates that what remains still works.

- [ ] **Step 1: Confirm dist/ exists and is intact**

```bash
cd /Users/vero/openclaw
test -f dist/entry.js && echo "✓ dist/entry.js exists"
test -f dist/index.js && echo "✓ dist/index.js exists"
```

If either is missing, dist/ was somehow damaged during cleanup. **STOP and investigate.**

- [ ] **Step 2: Verify dist/entry.js can be loaded (syntax check)**

```bash
node --check dist/entry.js && echo "✓ dist/entry.js parses"
node --check dist/index.js && echo "✓ dist/index.js parses"
```

- [ ] **Step 3: TypeScript typecheck (if tsgo is still present in node_modules)**

```bash
pnpm tsgo --noEmit 2>&1 | tail -20
```

Expected: 0 errors. If `tsgo` is no longer available (devDep removed), skip this check and note in the smoke test that future TS edits require restoring tooling.

- [ ] **Step 4: Lint (if oxlint still present)**

```bash
pnpm lint 2>&1 | tail -20 || echo "lint command unavailable — skipped"
```

Optional. Non-blocking.

---

### Task 1.12: Smoke test JR locally

**Goal:** Boot JR, connect to Slack, send a DM, verify response. Send a side-channel message, verify silence.

- [ ] **Step 1: Identify the launch command**

```bash
cd /Users/vero/openclaw
which openclaw   # See if global install is on PATH
ls -la openclaw.mjs   # Local CLI entry
```

If the user runs JR via launchd plist, list that instead:

```bash
launchctl list | grep -i openclaw
```

- [ ] **Step 2: Stop any running JR instance (clean baseline)**

```bash
launchctl list | grep -i openclaw | awk '{print $3}' | while read label; do
  [ -n "$label" ] && launchctl unload ~/Library/LaunchAgents/${label}.plist 2>/dev/null
done

ps aux | grep -i openclaw | grep -v grep
# Expected: no openclaw processes running. If any remain, ask user before killing.
```

- [ ] **Step 3: Launch JR from local repo**

```bash
node openclaw.mjs gateway --port 18789 --verbose 2>&1 | tee /tmp/jr-smoke.log &
JR_PID=$!
echo "JR PID: $JR_PID"
sleep 5
```

Tail the log; expected to see Slack handshake success within 30 seconds.

- [ ] **Step 4: Send a Slack DM to JR**

This step is **manual** — the user must send a DM in Slack and observe the response. Example: send "hey JR, test ping" as a DM.

Expected behavior:
- JR responds (Triage popup may not appear — that's Phase 3's repair).
- The response is on-brand (grumpy, brief, useful).

If JR doesn't respond, check `/tmp/jr-smoke.log` for errors. **STOP and surface** any startup errors to the user.

- [ ] **Step 5: Send a side-channel message JR should ignore**

In a channel JR is in but not addressed to JR, post something innocuous like "thanks team!"

Expected behavior:
- JR stays silent.

If JR responds, that's a Phase 4 issue (Slack reply gate), not a Phase 1 blocker — note it but don't fail the smoke test.

- [ ] **Step 6: Stop the JR test instance**

```bash
kill $JR_PID 2>/dev/null
wait $JR_PID 2>/dev/null
```

- [ ] **Step 7: Re-load the production launchd plist (restore normal operation)**

```bash
for plist in ~/Library/LaunchAgents/*openclaw*.plist; do
  [ -f "$plist" ] && launchctl load "$plist"
done

launchctl list | grep -i openclaw
# Expected: JR process running again under launchd
```

- [ ] **Step 8: Mark smoke test result in the plan**

If smoke passed: proceed to Task 1.13. If failed: **STOP**, investigate, do not push the cleanup branch.

---

### Task 1.13: Push branch and open PR

- [ ] **Step 1: Verify branch state**

```bash
cd /Users/vero/openclaw
git log --oneline main..HEAD | wc -l   # Number of commits ahead of main
git log --oneline main..HEAD          # Review them
```

Expected: roughly 10-13 commits from Phase 0 + Phase 1.

- [ ] **Step 2: Push to fork**

```bash
git push -u origin cleanup/phase-1-prune
```

- [ ] **Step 3: Open PR (only if `gh` is configured)**

```bash
gh pr create --title "Phase 1: prune openclaw fork to Slack-only clawbot" --body "$(cat <<'EOF'
## Summary

Executes Phase 1 of the cleanup plan in
`specs/2026-05-27-openclaw-cleanup-clawbot-optimization-design.md`.

Removes everything not needed for the Slack-only clawbot (with iMessage
and Telegram preserved for future use):
- Native iOS/Android/macOS apps + Swift packages
- 21 unused channel extensions
- 7 helper/auth/utility extensions
- ~39 unused personal-utility skills
- ui/, docs/, Openclaw-Vero-Tools/
- dist.may21.bak/ (29M dead backup)
- Container infra (Docker, Podman, fly, render, systemd)
- Ad-hoc investigation scripts
- Repaired package.json scripts referencing deleted files

## Rollback

- `git reset --hard vero-fork-baseline-pre-phase1` (recommended)
- `git reset --hard pre-cleanup-snapshot-pristine` (nuclear)

## Test plan

- [x] `pnpm tsgo --noEmit` passes after each batch
- [x] `pnpm install` succeeds; node_modules shrunk significantly
- [x] dist/entry.js and dist/index.js parse
- [x] JR boots from local repo, connects to Slack
- [x] JR responds to DM
- [x] JR ignores side-channel chatter (Phase 4 will harden this further)
EOF
)"
```

If `gh` isn't configured, open the PR manually on GitHub.

- [ ] **Step 4: Final verification gate — Phase 1 complete**

```bash
echo "Phase 1 complete. Tags:"
git tag --list 'pre-cleanup-snapshot-pristine' 'vero-fork-baseline-pre-phase1'
echo "Branch:"
git branch --show-current
echo "Repo size:"
du -sh /Users/vero/openclaw
```

---

## What this plan does NOT do (deferred to later plans)

- **Phase 2** — Config consolidation + IT-SEC-001 close-out (1Password migration, launchd plist rewrite). Separate plan.
- **Phase 3** — Triage pipeline repair (env-var-driven Slack triage UX). Separate plan.
- **Phase 4** — JR prompt sharpening (personality file audit, code-side Slack reply gate, regression tests). Separate plan.
- **Phase 5** — Cold-start optimization (manifest cache, per-request skill gating, persona pre-warm). Separate plan.

Phase 2 should follow this plan immediately for compliance reasons (IT-SEC-001 incident close-out is still open).
