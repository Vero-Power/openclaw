# JR Triage v2 — Autonomous Workflow Orchestrator with Human-in-the-Loop Approval

**Date:** 2026-06-06
**Author:** Kaleb Lundquist (kaleb.lundquist@blytzpay.com), with brainstorming assist from Claude.
**Status:** Design approved by user, awaiting implementation plan.
**Replaces:** Section 2 ("Triage Pipeline Repair") of `specs/2026-05-27-openclaw-cleanup-clawbot-optimization-design.md`.
**Phase:** Phase 3 of the OpenClaw cleanup + clawbot optimization roadmap.

---

## 1. Goal

Restore and upgrade JR's triage pipeline so the clawbot acts as Vero's **ultimate decision maker** for operator requests in Slack: classify the request, gather context, compose an optimal multi-step plan from a vetted action catalog, present the plan for human approval, execute step-by-step with live progress, and learn from feedback over time via a curated playbook library.

The old triage system (removed from openclaw source around 2026-04-27) is gone; the Trash retains compiled artifacts (`.d.ts` only) at `~/.Trash/dist/plugin-sdk/slack/triage/`. We reimplement in TypeScript from scratch in `src/triage/`, gated behind the existing `OPENCLAW_TRIAGE_REIMPL=1` feature flag.

## 2. Design decisions (from brainstorming, 2026-06-06)

| #   | Decision                                                                                          | Rationale                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Scope = domain-expert recommendations + workflow orchestration                                    | User wants JR to read requests, pick optimal multi-step actions, execute them. Not routing or pure approval gating.        |
| Q2  | Plan-first, explicit approval                                                                     | Many catalog actions hit external systems (customer email, GCP). Plan visibility + approval is non-negotiable.             |
| Q3  | Triage fires only on classifier-detected tasks                                                    | Avoid making people approve "hi JR." Cheap Flash classifier upstream.                                                      |
| Q4  | Catalog gates writes; reads are unrestricted                                                      | JR can freely investigate (web search, file reads, gcloud, Slack history) but only acts via registered catalog.            |
| Q5  | Approval via natural language                                                                     | Plain "yes" / "go" / "approve" / "do it". No buttons, no slash commands.                                                   |
| Q6  | Anyone in conversation can approve (for now)                                                      | Low-friction default; can tighten to requester+IDENTITY chain later.                                                       |
| Q7  | On step failure: retry once, then escalate with descriptive report                                | Absorb transient infra glitches; halt on persistent failure with full diagnostic context.                                  |
| Q8  | Plan edits = free-form NLU + diff display                                                         | User says "actually use project 43" → JR replans and shows what changed (strikethroughs + new). Up to 5 edits per session. |
| Q9  | Execution narration = single live-edit message + separate final summary                           | One `progress_ts` edited as each step completes; one `summary_ts` posted at end as durable record.                         |
| Q10 | Memory = curated playbooks only (no broad RAG yet)                                                | Playbooks promoted via positive feedback. Avoids self-confirming bias of pure RAG.                                         |
| Q11 | Feedback collection = reactions + NLU thread replies                                              | 🟢 / 🟡 / 🔴 reactions plus free-form thread feedback. Anyone can give it.                                                 |
| Q12 | Classifier ambiguity → default to triage                                                          | Better to over-triage than miss real tasks. User can break out into chat mode.                                             |
| Q13 | Subagents for research, JR himself for actions                                                    | Parallel Flash research subagents → aggregated context → JR composes + executes plan.                                      |
| Q14 | Full action catalog on day one                                                                    | All 6 gcf functions + Slack ops + GitHub ops + Coperniq direct + IDENTITY-chain notifies + filing + bash escape hatch.     |
| Q15 | No off-limits categories (yet)                                                                    | JR plans everything; handoff to humans is just a step in the plan.                                                         |
| Q16 | Playbook fast-path = skip research + approval still required, unless playbook marked `auto: true` | Speed for known patterns, safety for novel ones. Curator decides `auto` per playbook at promotion time.                    |

## 3. Architecture

### 3.1 Pipeline overview

```
Slack event
   ↓
slackMessageGate    (filter: bots, self, channel allowlist, OPENCLAW_TRIAGE_REIMPL flag)
   ↓
classifier          (Flash: is_task? confidence? playbook_match?)
   ↓
   ├──── (playbook match high confidence) ────→ skip to planner with template
   ↓
researcher          (parallel Flash subagents, reads only)
   ↓
planner             (Pro: research bundle + catalog → ordered plan)
   ↓
Slack: post progress_ts with plan, await approval
   ↓
   ├── edit:    replan + diff, repost in progress_ts (loop, max 5)
   ├── cancel:  mark CANCELLED, no execution
   ↓
executor            (sequential steps, live-edit progress_ts, single retry on fail)
   ↓
Slack: post summary_ts with final result
   ↓
evalCollector       (reactions + NLU feedback → triage.db; 🟢 → playbook candidate)
```

### 3.2 Components

Seven discrete modules in `src/triage/`, each with a focused responsibility and a clear interface so any one can be swapped or mocked:

**1. `slackMessageGate`** (`src/triage/gate.ts`)

- Input: raw Slack `event_callback` payload.
- Filters: bot messages, JR's own posts, irrelevant channels (uses existing channel allowlist in `openclaw.json`), `OPENCLAW_TRIAGE_REIMPL` feature flag.
- Output: `{eligible: bool, reason?: string}`.
- Equivalent of the old `whitelist.d.ts`, extended for channel allowlist.

**2. `classifier`** (`src/triage/classifier.ts`)

- LLM: Gemini Flash (single call, JSON output).
- Input: cleaned user message + minimal Slack context (channel kind, requester id, thread context, any active session in this thread).
- Output: `{is_task: bool, confidence: number, suggested_category?: string, playbook_match?: {playbook_id, confidence}}`.
- Defaults to `is_task: true` on low confidence (Q12).

**3. `researcher`** (`src/triage/researcher.ts`)

- Skipped entirely on playbook fast-path (Q16).
- Otherwise composes a list of parallel research subagents (Flash, one focused read task each: "fetch WO list for project N from Coperniq", "pull recent Slack history for #ops-channel", etc.).
- Output: aggregated context object handed to the planner.

**4. `planner`** (`src/triage/planner.ts`)

- LLM: JR's primary model (currently Gemini Pro).
- Input: original message + research bundle (or playbook template, if fast-path) + serialized action catalog.
- Output: ordered list of catalog actions with validated args + a self-rated confidence score for the whole plan.
- Also handles **replan** for Q8 edit + diff: takes prev plan + edit text, generates new plan, diffs them.

**5. `executor`** (`src/triage/executor.ts`)

- Input: approved plan + session state.
- Runs steps sequentially.
- Manages the `progress_ts` Slack message: live-edits status line on each step transition (Q9).
- Retry-once-then-escalate policy (Q7); on persistent failure, formats descriptive error report with: step idx, action+args, error code+body excerpt, remaining steps, suggested likely cause.
- Writes immutable rows to `action_invocations` table.

**6. `evalCollector`** (`src/triage/eval-collector.ts`)

- Long-lived listener on JR's `summary_ts` messages (or `progress_ts` for failed sessions).
- Captures reactions (🟢 / 🟡 / 🔴) and NLU-parsed thread replies.
- NLU classification patterns:
  - `nlu_positive`: "good call", "perfect", "nice", "well done" → records positive feedback.
  - `nlu_negative`: "bad", "wrong", "off" without specifics → records negative feedback.
  - `nlu_correction`: "wrong, the WO was Review not Assigned" → records negative + extracts structured correction into `correction_data`.
  - `nlu_promote`: "save this", "save this as a playbook", "make this a playbook", "save the pattern" → triggers immediate playbook promotion.
- Promotion path: either 🟢 reaction OR `nlu_promote` signal writes a new row to `playbooks` directly (no separate candidates table). `promoted_by` = user_id of the reactor or NLU-feedback author. `auto` defaults to `false`; flipping it to `true` is a manual operation out of MVP scope (Phase 3.5 will add a curator UI/CLI).

**7. `playbookStore`** (`src/triage/playbook-store.ts`)

- Read API: semantic search via embeddings (Gemini embedding model) over `playbooks.match_examples`. Called by `classifier`.
- Write API: promote-from-triage + manual curation entry point.
- Storage: SQLite tables in `~/.openclaw/triage.db`.
- Per-playbook `auto` flag (Q16): if `auto = true` and match confidence high, executor proceeds without approval.

### 3.3 Session state machine

A triage session lives in `triage_sessions` and transitions through:

```
PENDING_CLASSIFY → CLASSIFIED → (RESEARCHING ⇢ PLANNING) | (PLAYBOOK_MATCHED)
                                        ↓
                                  AWAITING_APPROVAL ⇄ EDITING ↺
                                        ↓
                                   EXECUTING (step N of M)
                                        ↓
                              FAILED_AT_STEP_N | COMPLETE | CANCELLED
                                        ↓
                                  AWAITING_EVAL ↺ (open-ended)
```

Each non-terminal state has a 30-minute idle timeout → state `ABANDONED` and JR posts "Closing this out, no approval received."

### 3.4 Slack interaction model

Three `ts` slots per session:

- `requester_ts` — the original user message.
- `progress_ts` — JR's first reply; edited in place through the whole session ("🔍 Researching…" → "📋 Plan: …" → "▶ Executing…" → "✅ Done." or "❌ Cancelled").
- `summary_ts` — JR's second message at completion; durable record. Eval reactions/replies attach here. (Failed sessions have no `summary_ts`; eval attaches to `progress_ts`.)

Result: 1–2 JR messages per triage, regardless of step count.

**Approval/edit/cancel listener** runs on the requester's thread. Detection order:

1. Reactions on `progress_ts`: 👍 → approve, 🛑 → cancel.
2. Thread reply: regex pass first
   - `^(yes|go|do it|approve|✅|👍|run it|proceed|send it)$` → approve
   - `^(no|stop|cancel|abort|🛑|nvm|nm)$` → cancel
3. Regex miss → Flash NLU pass: positive_approve / negative_cancel / edit_freeform.
4. Anything else → ignore (no spurious cancellations from normal thread chatter).

**Edit flow**: `planner.replan(original_message, previous_plan, edit_text)` returns new plan. JR updates `progress_ts` with a diff: previous plan strikethrough + new plan inline. Loops up to 5 edits before JR says "let's start fresh."

**Concurrent triages**: per (`channel`, `thread_ts`), queue (FIFO via `triage_queue`). Across different threads/DMs, run in parallel.

### 3.5 Persistence: `triage.db` schema

**`triage_sessions`** — one row per session.

```
request_id          TEXT PRIMARY KEY      -- uuid
channel             TEXT NOT NULL
thread_ts           TEXT NOT NULL
requester_user_id   TEXT NOT NULL
requester_message   TEXT NOT NULL
progress_ts         TEXT
summary_ts          TEXT
state               TEXT NOT NULL         -- enum: see 3.3
classifier_output   JSON
research_bundle     JSON                  -- aggregated; truncated to N kb if huge
playbook_id         TEXT                  -- FK → playbooks.id if fast-path hit
plan_history        JSON                  -- [{plan, edit_text, ts}] — original + each replan
final_plan          JSON
execution_log       JSON                  -- per-step: {step_idx, action, args, status, started_at, ended_at, result_excerpt, retried?}
failed_at_step      INTEGER
created_at          TIMESTAMP
updated_at          TIMESTAMP
```

**`triage_queue`** — per-thread queue for concurrent triages in the same thread.

```
queue_position      INTEGER
channel             TEXT
thread_ts           TEXT
request_id          TEXT FK → triage_sessions
queued_at           TIMESTAMP
```

**`playbooks`** — curated patterns.

```
id                  TEXT PRIMARY KEY      -- slug (e.g., "bom-check-by-project")
title               TEXT
description         TEXT
match_examples      JSON                  -- 3–5 example user messages
match_embeddings    BLOB                  -- precomputed embeddings for fast search
plan_template       JSON                  -- ordered actions with arg placeholders ({{project_id}}, etc.)
auto                BOOLEAN DEFAULT 0     -- Q16: =1 only if curator marked autonomous at promotion
promoted_from       TEXT                  -- FK → triage_sessions
promoted_by         TEXT                  -- user_id of reactor or NLU-feedback author who triggered promotion
created_at          TIMESTAMP
last_used_at        TIMESTAMP
use_count           INTEGER DEFAULT 0
```

**`feedback`** — eval signals.

```
id                  INTEGER PRIMARY KEY
request_id          TEXT FK → triage_sessions
user_id             TEXT
kind                TEXT                  -- 'reaction_green' | 'reaction_yellow' | 'reaction_red' | 'nlu_positive' | 'nlu_negative' | 'nlu_correction' | 'nlu_promote'
content             TEXT                  -- raw reply text for NLU kinds
correction_data     JSON                  -- structured correction if extractable
created_at          TIMESTAMP
```

**`action_invocations`** — immutable audit log.

```
id                  INTEGER PRIMARY KEY
request_id          TEXT FK → triage_sessions
step_idx            INTEGER
action              TEXT
args                JSON
result_status       TEXT                  -- 'success' | 'error' | 'retried_success' | 'retried_error'
result_body         TEXT                  -- truncated to N kb
duration_ms         INTEGER
acted_by            TEXT                  -- 'jr' for now
invoked_at          TIMESTAMP
```

**Retention**: `triage_sessions`, `feedback`, `playbooks` kept indefinitely. `triage_queue` cleared on terminal state. `action_invocations` never deleted (IT-SEC-001 audit trail).

### 3.6 Action catalog interface

`src/triage/actions/types.ts`:

```ts
export interface CatalogAction<TArgs, TResult> {
  name: string; // e.g., "bomQuoteNotifier"
  description: string; // for the planner's serialized prompt
  args_schema: z.ZodSchema<TArgs>; // validated before invoke
  idempotent: boolean; // affects retry policy
  external_effect: boolean; // surfaces in plan UI with ⚠️
  estimated_duration_ms?: number; // hint for progress UI
  invoke(args: TArgs, ctx: ActionContext): Promise<TResult>;
}

export interface ActionContext {
  request_id: string;
  slack_post(text: string): Promise<{ ts: string }>;
  slack_edit(ts: string, text: string): Promise<void>;
  logger: Logger;
}
```

Actions self-register at gateway startup via `actionCatalog.register(action)`.

Day-one registrations (Q14):

- **gcf functions (6)**: `bomQuoteNotifier`, `coperniqFirestoreIngest`, `finalDesignSender`, `ghlFirestoreIngest`, `signedDesignPlansetReview`, `slackFirestoreIngest`. All marked `external_effect: true` (except the firestoreingest variants which are `false`).
- **Slack ops**: `post_message`, `update_message`, `add_reaction`, `pin_message`, `start_thread`, `dm_user`.
- **GitHub ops**: `create_issue`, `comment_on_pr`, `close_issue`, `assign_issue`.
- **Coperniq direct API**: `update_wo_status`, `assign_project_to_user`, `add_project_note`.
- **IDENTITY-chain notify**: `notify_kaleb_dm`, `notify_ridge_dm`, `notify_jordan_dm`, `notify_sam_dm`.
- **Filing**: `file_to_obsidian`, `save_playbook`, `log_decision`.
- **Bash escape hatch**: `run_bash(cmd, working_dir)` — heavily logged, marked `external_effect: true`.

Planner LLM receives a compact prompt-friendly serialization of the registered catalog ("Available actions: …, with arg schemas …, external_effect actions marked with ⚠️").

## 4. Acceptance criteria

Carried forward + extended from the original spec (Section 2):

- `OPENCLAW_TRIAGE_REIMPL=1` enables triage v2; `=0` cleanly disables (no errors, no behavior change in Slack).
- `OPENCLAW_TRIAGE_DM=1` triages DMs to JR (subject to classifier task detection).
- `OPENCLAW_TRIAGE_SLACK_ALL=1` triages @-mentions in all channels (subject to classifier).
- Triage of a task-classified message produces:
  - A `progress_ts` message that live-edits through `🔍 Researching` → `📋 Plan: …` → `▶ Executing` → terminal state.
  - On `COMPLETE`, a `summary_ts` follow-up message.
- Plan editing via natural language ("actually use project 43") produces a diffed re-plan in `progress_ts`.
- Approval via natural language ("yes" / "go") proceeds to execution.
- Step failure with single retry success → execution continues silently (one `retried_success` row in `action_invocations`).
- Persistent step failure → JR posts descriptive escalation in thread, session state `FAILED_AT_STEP_N`, no further execution.
- 🟢 reaction on `summary_ts` writes a `reaction_green` row in `feedback` and queues the session as a playbook candidate.
- Playbook with `auto: true` and high-confidence match runs without approval gate.

## 5. Implementation phases

### 5.1 Phase 3 (this spec) — MVP

| Component          | MVP scope                                           | Deferred to 3.5+                                      |
| ------------------ | --------------------------------------------------- | ----------------------------------------------------- |
| `slackMessageGate` | Channel allowlist + bot-self filter + feature flag  | Per-channel triage policy granularity                 |
| `classifier`       | Flash 1-shot, regex pre-filter for cancel/approve   | Per-user calibration, learned thresholds              |
| `researcher`       | Flash subagents, parallel fan-out                   | Subagent memory, cross-session research cache         |
| `planner`          | Pro 1-shot, JSON output, free-form edit + diff      | Multi-turn negotiation, conditional/branching plans   |
| `executor`         | Sequential steps, retry-once-escalate, live-edit    | Parallel-safe step grouping, partial rollback         |
| `evalCollector`    | Reactions + NLU regex feedback; promote to playbook | Auto-eval via second LLM (self-bias risk)             |
| `playbookStore`    | SQLite + Gemini embedding semantic search           | Versioning, playbook composition                      |
| Action catalog     | All Q14 day-one actions                             | Coperniq advanced API, additional filing destinations |

### 5.2 Build order within Phase 3

Each numbered step lands as a separate PR. Step 1 ships the type contracts first so later PRs implement against fixed interfaces.

1. **Restore foundation.** Recover `.d.ts` files from `~/.Trash/dist/plugin-sdk/slack/triage/` as TypeScript scaffolding. Seed `src/triage/types.ts`. Fix `openclaw-run.sh` from `openclaw start` → `openclaw gateway run` (resolves current crash loop).
2. **`actionCatalog` + day-one actions registered.** Without a catalog, nothing else has anywhere to go. Consolidates the in-conversation `gcf` skill work into proper catalog actions.
3. **`executor` + `progress_ts` lifecycle.** Testable against hand-coded plan; no LLM needed. Proves Slack live-edit + state machine.
4. **`planner` + `classifier`.** Wire the LLM front end. End-to-end without research, playbooks, or eval.
5. **`researcher`.** Adds parallel reads.
6. **`playbookStore` + match path.** Adds fast-path. Schema first, manual seed data, then promotion path.
7. **`evalCollector`.** Closes the loop.

### 5.3 Pre-requisites blocking Phase 3 launch

- **Crash loop fix** (`openclaw-run.sh` → `openclaw gateway run`). Ships in Step 1.
- **IT-SEC-001 close-out (Phase 2)** — plaintext `GOOGLE_APPLICATION_CREDENTIALS` JSON key surfaced in conversation today. Triage v2 expands JR's external-action footprint; doing that with an unrevoked plaintext key worsens compliance posture. Should ship in parallel with Phase 3 Steps 1–2.
- **Feature flag `OPENCLAW_TRIAGE_REIMPL=1`** added to `~/.openclaw/.env`. Gate checks flag — unset → triage skipped entirely (existing behavior preserved).

### 5.4 Deferred (Phase 3.5+, separate specs)

- RAG over past triages (Q10) — supplements but does not replace playbooks.
- Auto-eval via second LLM (Q11 C-variant).
- Plan-aware subagent dispatch (Q13 D-variant) where planner annotates per-step "self" vs "subagent".
- Off-limits categories + tiered confidence handoff (Q15 D-variant) when JR's action footprint grows.
- Conditional / branching plans (planner output as a small DAG instead of linear).
- DM digest for eval users (Q11 B-variant).

## 6. Risk and rollback

- **Per-PR rollback**: `git revert <sha>`. Each build-order step is independently revertable.
- **Runtime rollback**: `unset OPENCLAW_TRIAGE_REIMPL` in `~/.openclaw/.env`, restart gateway. Triage path goes dark; JR behaves as he does today.
- **Catalog hot-disable**: per-action allowlist in `openclaw.json` (`triage.disabled_actions: ["finalDesignSender", …]`) lets ops yank a misbehaving action without code change.
- **DB migrations**: forward-only, no destructive schema changes. Old rows stay readable.
- **Audit trail**: `action_invocations` is append-only, never deleted. Every plan, every step, every retry, every failure is recoverable from the DB.

## 7. Testing strategy

- **Unit**: each component has tests with a mocked LLM (returning fixed JSON per scenario).
- **`executor`**: tested against a fake action catalog with pure-function actions — proves the state machine independent of LLM behavior.
- **Integration**: mocked Slack events flow through `slackMessageGate` → `classifier` → … → `executor`, asserting on `triage.db` final state.
- **Manual smoke** in real Slack as the final acceptance gate per Phase 3 PR.

## 8. Open questions deferred to implementation

The following are intentionally not pinned in this spec; they will be resolved during build:

- Exact embedding model for playbook semantic search (Gemini embedding model name + dimensionality).
- Concrete prompt templates for `classifier` and `planner` (TBD during Step 4 of build order).
- Specific argument schemas for each catalog action (per-action, during Step 2).
- Idle-timeout duration tuning (default 30 min may be too long for impatient operators).
- Whether `progress_ts` should display research subagent progress in real time or only post-aggregation. (Current design: post-aggregation, to avoid noise.)

---

**End of spec.**
