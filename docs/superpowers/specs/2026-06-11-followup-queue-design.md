# JR Follow-up Queue Design (Fix B — no false promises)

**Date:** 2026-06-11
**Status:** Approved by Kaleb (brainstorm 2026-06-11)
**Feature flag:** `OPENCLAW_FOLLOWUPS=1`

## Problem

JR makes promises he cannot keep. Observed live (sentinel conversation #2): Kaleb said
"Ask Ridge… Slack him" and JR replied "Thanks! I'll reach out to Ridge on Slack…" then
closed the conversation. No mechanism existed to actually reach out — the promise was a
dead end.

## Goal

When a conversation or chat asks JR to do something later (message another person, look
into something, run a task), JR files a **follow-up** that is actually executed — and his
replies only claim what was really queued.

## Architecture

A `followups` table in sentinel.db + a `FollowupProcessor`. Follow-ups are created from
two surfaces (sentinel conversation-handler, chat-v2 reasoner), processed **immediately
on creation**, and any rows still `pending` (target busy, transient failure) are drained
by the 2-hour sentinel cycle. 3 attempts max → `failed`, surfaced in the daily report.

### Data model

```sql
CREATE TABLE IF NOT EXISTS followups (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  kind              TEXT NOT NULL,            -- 'dm_person' | 'note' | 'task'
  payload           TEXT NOT NULL,            -- JSON, kind-specific
  status            TEXT NOT NULL DEFAULT 'pending',  -- 'pending'|'done'|'failed'|'skipped'
  source            TEXT NOT NULL,            -- 'conversation' | 'chat'
  source_ref        TEXT,                     -- conversation id, or channel/ts
  requester_user_id TEXT,                     -- who asked JR (approver for 'task')
  created_at        INTEGER NOT NULL,
  processed_at      INTEGER,
  attempts          INTEGER NOT NULL DEFAULT 0,
  last_error        TEXT
);
CREATE INDEX IF NOT EXISTS idx_followups_status ON followups(status);
```

Payload shapes:

- `dm_person`: `{ "target_alias": "ridge", "topic": "...", "question_text": "...", "context": "Kaleb pointed me your way about ..." }`
- `note`: `{ "text": "..." }`
- `task`: `{ "task_text": "...", "context": "..." }`

### Creation surface 1 — sentinel conversation-handler

`LlmDecisionSchema` gains a fourth variant:

```ts
z.object({
  action: z.literal("file_followup"),
  kind: z.enum(["dm_person", "note", "task"]),
  payload: z.record(z.string(), z.unknown()),
  reply_text: z.string(), // honest reply: "I've queued a message to Ridge"
  takeaway: z.string(), // conversation close takeaway
});
```

Behavior: post `reply_text`, append turn, close the conversation with `takeaway`, insert
the followup row, then trigger immediate processing.

### Creation surface 2 — chat-v2 reasoner

`ReasonerOutputSchema` gains an optional array:

```ts
followups: z.array(
  z.object({
    kind: z.enum(["dm_person", "note", "task"]),
    payload: z.record(z.string(), z.unknown()),
  }),
).optional();
```

The chat pipeline files the rows BEFORE the responder runs, and the responder prompt is
told exactly what was queued so the visible reply is accurate. If filing fails, the
responder is told nothing was queued (no false claims).

### FollowupProcessor

`processPending()` loads `status='pending'` rows ordered by `created_at` and dispatches
by kind:

- **dm_person** — resolve `target_alias` via `SLACK_USER_ALIASES` (unknown alias →
  `skipped`). Check global opt-outs (opted out → `skipped`). Check
  `ConversationStore.findOpenForPerson` (busy → stays `pending`, retried next cycle —
  this is the collision queue). Otherwise open a tracked conversation and DM the target
  with `context + question_text` (channel-name enriched via `ChannelNameResolver`).
- **note** — mark `done` immediately. The daily report adds a "Follow-ups noted" section
  listing notes from that day.
- **task** — spawn a triage session through the existing pipeline with `task_text` as the
  task. The plan is DM'd to `requester_user_id` for natural-language approval — same
  classifier → planner → approval → executor flow, same guards. (If the triage bridge is
  unavailable, stays `pending`.)

Any thrown error: increment `attempts`, store `last_error`; `attempts >= 3` → `failed`.
Failed follow-ups appear in the daily report.

### Honesty rule (both prompts)

Add to the conversation-handler decision prompt and the chat-v2 reasoner/responder
prompts:

> Never claim you WILL do something in the future. Either file a follow-up now (then say
> "I've queued it") or say you can't do it. Promises without a filed follow-up are
> forbidden.

### Wiring

- `createSentinel` builds the `FollowupProcessor` and exposes it; step in `runCycleOnce`
  (after conversation expiry) calls `processPending()`.
- `triage-bridge` passes a `fileFollowup` callback into the chat-v2 pipeline and the
  conversation-handler deps, which inserts + immediately processes.
- Everything gated on `OPENCLAW_FOLLOWUPS=1`; flag off → schema still created, creation
  surfaces omit the new prompt text and ignore followup outputs.

## Error handling

- LLM emits unknown kind / malformed payload → row never created; reply falls back to
  honest "I can't queue that."
- dm_person target invalid or opted out → `skipped` (visible in daily report).
- Processing crash → retry up to 3, then `failed` + daily report.

## Testing

- FollowupStore CRUD + status transitions.
- Processor per kind: dm_person happy path (opens conversation, DMs), collision stays
  pending, unknown alias skipped, opt-out skipped; note → report; task → triage session
  spawned with requester as approver.
- Ridge regression: conversation reply "Ask Ridge, Slack him" → LLM `file_followup`
  decision → row created → processor DMs Ridge alias and opens tracked conversation.
- Chat-v2: reasoner emits followups → filed before responder; responder told what was
  queued.
- Honesty: filing failure → responder context says nothing queued.

## Out of scope

- Unattended (approval-free) task execution.
- New action kinds beyond the three above (additive later).
- Embeddings / prioritization of the queue.
