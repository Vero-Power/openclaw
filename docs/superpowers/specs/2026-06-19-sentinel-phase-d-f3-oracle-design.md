# Sentinel Phase D.1 — F3 Oracle (action recommendations) Design

**Date:** 2026-06-19
**Status:** Approved
**Builds on:** `docs/superpowers/specs/2026-06-08-sentinel-jr-design.md` (Phase D, F3) and the external-context observer's company-context pattern (2026-06-19).

## Problem & scope

JR has been accumulating high-quality observational signal — 1,472 observations across 8 sources, 252 synthesized insights, 25KB+ curated markdown library, live Firestore project data. None of it gets translated into "what should we actually do today" recommendations. Humans (Kaleb, Ridge, the team) have to dig through the library themselves to extract action.

This spec adds the F3 "Oracle" — a recommendation engine that turns JR's accumulated knowledge into ranked, attributed action items.

**Two entry points, one engine:**

1. **Reactive (Slack chat).** A user DMs JR something like _"what should I do today"_ / _"give me priorities"_ / _"any oracle wisdom"_. The chat handler classifier detects the intent, calls the oracle, and replies with the requester's top actions.

2. **Proactive (every Sentinel cycle).** The Sentinel cycle runs the oracle, writes per-person recommendation markdown files into the library, and DMs people only when they have new high-confidence actions since last cycle.

V1 is recommendation-only — JR does not auto-execute. Humans decide.

## Decisions made during brainstorming

- **Both entries ship together** (reactive + proactive).
- **Per-person markdown files + DM-on-fresh-actions only.** No global file; no every-cycle DM spam.
- **Dynamic people directory** — derived from Firestore project owners/salesReps + `~/.openclaw/jr-library/people/*.md` files. No hardcoded role map. Directory rebuilds every cycle as data grows.
- **Every Sentinel cycle (every 2h).** The DM gate (only NEW high-confidence actions) handles the spam concern; people only get pinged when there's something materially new.
- **Recommendation-only.** No self-execution in v1.

## Architecture

### Module layout

```
src/sentinel/oracle.ts                       — Factory, types, core recommendActions()
src/sentinel/oracle/people-directory.ts      — Dynamic assignee pool from Firestore + library
src/sentinel/oracle/llm-prompt.ts            — System prompt + JSON schema for LLM output
src/sentinel/oracle/store.ts                 — sentinel.db: persisted recommendations + DM-sent tracking
src/sentinel/oracle/file-writer.ts           — Per-person markdown files into the library
src/triage/chat/intents/action-recommendation.ts  — Chat-handler intent + response formatter
```

Plus per-module tests in `tests/sentinel/oracle/` and `tests/triage/chat/intents/`.

### Core engine: `createOracle(deps): Oracle`

**Public surface:**

```ts
export interface Recommendation {
  id: string; // stable hash of title + evidence IDs (idempotent across cycles)
  title: string; // e.g., "Reach out to 3 high-value TX projects in ON_HOLD"
  rationale: string; // why this matters (1-3 sentences)
  evidence: string[]; // observation/insight IDs referenced
  assignee_email: string; // resolved from the dynamic directory
  assignee_slack_id: string | null; // null if no Slack alias known
  scope: "ops" | "tactical" | "strategic";
  urgency: "low" | "medium" | "high";
  confidence: "low" | "medium" | "high";
  generated_at: number;
}

export interface OracleDeps {
  db: DatabaseType;
  llm: LlmClient;
  libPath: string;
  firestoreClient?: CompanyContextFirestoreLike; // reuses Phase C.1 port
  firestoreClientFactory?: () => Promise<CompanyContextFirestoreLike>;
  userAliases: Record<string, string>; // email → slack-id (reuses SLACK_USER_ALIASES)
}

export interface Oracle {
  // Core engine - returns recommendations for all known assignees, idempotent
  recommendAll(): Promise<Recommendation[]>;

  // Reactive convenience - filter recommendAll() output to one person
  recommendForUser(slackUserId: string): Promise<Recommendation[]>;
}
```

### Dynamic people directory

`src/sentinel/oracle/people-directory.ts` exports:

```ts
export interface PersonDirectoryEntry {
  email: string;
  slack_id: string | null;
  display_name: string | null;
  source: "firestore_owner" | "firestore_sales_rep" | "library_profile";
  evidence_count: number; // how many projects/library mentions
  notes: string | null; // free-text from library/*.md frontmatter if any
}

export async function buildPeopleDirectory(deps: {
  firestoreClient: CompanyContextFirestoreLike;
  libPath: string;
  userAliases: Record<string, string>;
}): Promise<PersonDirectoryEntry[]>;
```

**Sources (merged, deduped by email):**

1. Firestore: distinct `owner.email` + `salesRep.email` across `coperniq_projects` (already accessible via the C.1 client; we extend the port with one new method or iterate raw docs).
2. Library: scan `<libPath>/people/*.md` files. Parse YAML frontmatter for `email`, `display_name`, `notes`. JR has been curating these via the inquirer.
3. Email→Slack ID translation via `userAliases` map (the existing `SLACK_USER_ALIASES`).

Entries are deduped by `email`. When the same person appears in multiple sources, the entry merges (`evidence_count` aggregates, `notes` from library wins if present).

### Per-cycle flow (proactive)

In `runCycleOnce()` (`src/sentinel/index.ts`), after the existing curate + inquirer steps:

1. `const recs = await oracle.recommendAll()` — single LLM call internally.
2. `oracle.persistAndDiff(recs)` — upsert into `oracle_recommendations` table; compute the diff vs prior cycle's set.
3. `oracle.writePerPersonFiles(recs, libPath)` — full rewrite of `~/.openclaw/jr-library/recommendations/<slug>.md` per assignee.
4. `oracle.maybeNotify(diff)` — for each assignee with at least one NEW (id never seen before) high-confidence (`confidence === "high"`) recommendation, DM them a short message summarizing the NEW items (cap 5 per DM). Record sent IDs in `oracle_dms_sent` to prevent re-notification on the same recommendation.

### Per-cycle flow (reactive)

The triage classifier learns one new intent: `action_recommendation`. Trigger phrases (case-insensitive substring match in `src/triage/chat/intents/action-recommendation.ts`):

- "what should i do"
- "what's on my plate" / "whats on my plate"
- "give me priorities"
- "oracle wisdom"
- "what's important"

When the chat handler detects the intent:

1. Resolve requester via `slack_user_id`.
2. `const myRecs = await oracle.recommendForUser(slack_user_id)`.
3. Format top 3-5 as a Slack reply: each action becomes a bullet with title + 1-line rationale + urgency tag.
4. If no recommendations match (or requester unknown), reply with a friendly "nothing on your plate right now" message.

### LLM call shape

ONE Gemini Flash call per cycle. Prompt structure:

```
SYSTEM: You are JR's Oracle. Generate prioritized action recommendations
        for Vero's team based on the company state and recent observations.

CONTEXT:
1. {company_context_blob}                     ← from the Phase C.1 builder
2. {people_directory_json}                    ← from buildPeopleDirectory()
3. Recent observations (last 48h, top by relevance):
   {top_50_observations_as_bullets}
4. Recent insights (last 14 days, top by confidence):
   {top_20_insights_as_bullets}

OUTPUT JSON ONLY:
{
  "recommendations": [
    {
      "title": "...",
      "rationale": "...",
      "evidence_observation_ids": [int, ...],
      "evidence_insight_ids": [int, ...],
      "assignee_email": "...",   // MUST be one of the directory emails
      "scope": "ops" | "tactical" | "strategic",
      "urgency": "low" | "medium" | "high",
      "confidence": "low" | "medium" | "high"
    }
  ]
}

Constraints:
- 5-15 recommendations total
- Distribute across assignees - don't dump everything on one person
- Cite evidence; recommendations without evidence are not acceptable
- Stick to assignees from the directory; if no match, do not invent
```

Budget: one Gemini call per cycle, ~5-10k context, ~1-2k output. At Flash pricing ~$0.001/call × 12 cycles/day = ~$0.012/day. Negligible.

### Storage

New table in sentinel.db (migrated via `openSentinelDb`):

```sql
CREATE TABLE IF NOT EXISTS oracle_recommendations (
  id TEXT PRIMARY KEY,
  assignee_email TEXT NOT NULL,
  assignee_slack_id TEXT,
  title TEXT NOT NULL,
  rationale TEXT NOT NULL,
  evidence TEXT NOT NULL,      -- JSON array
  scope TEXT NOT NULL,
  urgency TEXT NOT NULL,
  confidence TEXT NOT NULL,
  data TEXT NOT NULL,          -- full Recommendation JSON
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  dismissed_at INTEGER         -- nullable
);
CREATE INDEX IF NOT EXISTS oracle_recommendations_assignee
  ON oracle_recommendations(assignee_email, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS oracle_dms_sent (
  rec_id TEXT NOT NULL,
  assignee_email TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (rec_id, assignee_email)
);
```

The `id` is a stable hash of `(title + sorted(evidence))` so re-generating the same logical action across cycles produces the same row — `last_seen_at` is bumped instead of inserting a duplicate. `dismissed_at` is a v2 hook for "I did this" feedback.

### File output format

`~/.openclaw/jr-library/recommendations/<slug>.md`:

```markdown
---
title: Recommendations for Kaleb Lundquist
generated_at: 2026-06-19T20:14:00.000Z
cycle_id: 7821
total_actions: 4
---

# What's on your plate

_Generated by JR Oracle on Friday, June 19, 2026 at 2:14 PM MDT_

## High urgency

### Reach out to 3 high-value TX projects stuck in ON_HOLD

Three Texas projects worth $245k combined are blocked >14 days...

- **Confidence:** high
- **Scope:** ops
- **Evidence:** [observation 1432], [insight 198]

### ...

## Medium urgency

### ...

## Low urgency

### ...

---

_DM'd on first appearance only. To dismiss an action, [v2 mechanism TBD]._
```

Per-person `<slug>` is `assignee_email.split("@")[0].toLowerCase().replace(/[^a-z0-9]+/g,"-")`.

### DM threshold logic

A recommendation triggers a DM **only if** all of:

- `confidence === "high"`
- `id` has never appeared in `oracle_dms_sent` for this assignee
- `assignee_slack_id !== null` (we can actually DM them)

Cap: max 5 new high-confidence DM items per assignee per cycle. If more exist, the message says _"X new on your plate this cycle — more in your file."_

## Per-cycle behavior

`oracle.recommendAll()`:

1. Build people directory (Firestore + library).
2. Read `company_context` (from Phase C.1 builder).
3. Query last 48h of observations (limit 50, sorted by recency).
4. Query last 14 days of insights (limit 20, sorted by confidence DESC, then recency).
5. Build prompt, call Gemini Flash.
6. Parse JSON output, validate against people directory (drop unknowns), generate stable `id` per rec.
7. Return the `Recommendation[]`.

`oracle.persistAndDiff(recs)`:

1. For each rec: `INSERT OR REPLACE` into `oracle_recommendations` with current `last_seen_at`. On first insert, `first_seen_at = last_seen_at`.
2. Return a diff structure: `{ new_high_confidence_per_assignee: Map<email, Recommendation[]> }`.

`oracle.writePerPersonFiles(recs, libPath)`:

1. Group by `assignee_email`.
2. For each assignee, full-rewrite their `<slug>.md` file with current actions sorted urgency-DESC.

`oracle.maybeNotify(diff)`:

1. For each assignee with new high-confidence recs:
   - Filter out ones already in `oracle_dms_sent`.
   - Cap remaining at 5.
   - If non-empty: DM the user (via the `dmUser` dep) with a short message + link to their file.
   - Record sent IDs in `oracle_dms_sent`.

### Error handling

- Firestore failure → people directory builder throws → oracle throws → runner catches per-cycle, no row write, next cycle retries.
- LLM failure → throw → runner catches.
- Malformed LLM JSON → throw with the parse error; runner catches.
- Recommendations referencing unknown assignee emails → dropped silently (LLM follow-the-instructions failure; recover gracefully).
- `dmUser` is missing → log warning, still write files but skip DMs.

## Security notes (IT-SEC-001)

- Reuses existing Firestore credential (firebase-adminsdk-fbsvc JSON key path) and Gemini API key. No new secrets.
- DMs are to internal Vero employees only (assignee_slack_id is sourced from the existing `SLACK_USER_ALIASES` — a closed allow-list).
- Recommendation text passes through Gemini Flash. No PII shipped — observation summaries are already curated (no raw customer data in the synthesizer pipeline).
- The `oracle_recommendations` table is local-only (sentinel.db on the Mac mini).

## Testing

- **`people-directory.test.ts`**: fake `CompanyContextFirestoreLike` (extended with new method) + temp library directory with sample `people/*.md` files. Cover: Firestore-only path, library-only path, merge dedup by email, slack-id lookup via alias map, evidence_count aggregation.
- **`oracle.test.ts`**: fake LLM + seeded sentinel.db + fake people directory. Cover: prompt construction, JSON parse, unknown-assignee drop, stable `id` hashing, recommendAll → recommendForUser filter.
- **`oracle/store.test.ts`**: in-memory sentinel.db. Cover: upsert idempotency, diff computation, DM-sent tracking, max-5 cap.
- **`oracle/file-writer.test.ts`**: temp library directory. Cover: slug generation, full rewrite, urgency sorting, frontmatter shape.
- **`action-recommendation.test.ts`**: integration into chat handler with fake oracle. Cover: intent detection, response formatting, "nothing on your plate" fallback.
- **No live LLM, no live Firestore, no live Slack in tests.**
- **Manual smoke (gated):** one boot cycle. Verify per-person files appear in the library; if any rec is high-confidence new, verify Kaleb (and/or Ridge) gets a DM.

## Out of scope (v1, deferred)

- Embedding-based filtering of observations/insights into the LLM prompt (Phase D.2 if useful).
- Self-execution / auto-action.
- User feedback loop ("good rec" / "bad rec" / dismissal).
- Cross-cycle ranking learning beyond simple "new ID" diff.
- Recommendation snoozing or scheduling ("remind me about this in 3 days").
- Surfacing recommendations through Slack interactive components (buttons to dismiss/snooze).
- Static role map for non-project ops (deferred per user direction — dynamic people directory is the v1 approach; static map can join later if directory proves too sparse).

## Acceptance criteria

After 1 cycle:

- `oracle_recommendations` table has 5-15 rows.
- `~/.openclaw/jr-library/recommendations/` directory exists with ≥1 per-person file.
- If any rec is `confidence: "high"` and the assignee has a Slack alias, that person gets exactly ONE DM.

After 2 cycles (no signal change):

- No new DMs (because `oracle_dms_sent` blocks re-notification).
- Per-person files are still up to date (full rewrite each cycle).
- `oracle_recommendations.last_seen_at` advances for recurring recs.

A reactive Slack DM "what should I do today" returns a top-3-5 list scoped to the requester.
