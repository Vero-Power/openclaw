# Sentinel JR — Continuously-Learning Second Brain Design

**Date:** 2026-06-08
**Author:** Kaleb Lundquist (kaleb.lundquist@blytzpay.com), with design assist from Claude.
**Status:** Design approved by user, awaiting implementation plan.
**Builds on:** `docs/superpowers/specs/2026-06-06-jr-triage-v2-design.md` (Triage v2 ships first; Sentinel feeds it).
**Phase:** Phase 6 of the OpenClaw clawbot roadmap (Phase 4/5 deferred or absorbed; see Section 9).

---

## 1. Goal

Transform JR's heartbeat from a no-op into the engine of a **continuously-learning second brain** that:

1. Observes Vero's operational state every 2 hours from a broad set of in-bounds sources.
2. Accumulates a structured, navigable knowledge library that grows denser and smarter over time.
3. Proactively engages Vero employees in real conversations to fill knowledge gaps.
4. Synthesizes accumulated knowledge into concrete, data-grounded revenue and efficiency ideas.
5. Feeds back into the Triage v2 pipeline so triage decisions get faster and smarter over time.

JR stops being a reactive Slack bot and becomes an embedded researcher whose only job is to make Vero more profitable.

## 2. Design decisions (from brainstorming, 2026-06-08)

| #   | Decision                                                                                                                  | Rationale                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| S1  | JR observes as broadly as in-bounds sources allow                                                                         | More signal = denser knowledge = better synthesis                                            |
| S2  | Privacy: P1 — operational only (no email content, no DMs unless addressed to JR, no PII/financial)                        | IT-SEC-001 compliance + trust building before P2 expansion                                   |
| S3  | Cadence: every 2 hours                                                                                                    | Frequent enough to catch operational shifts, rare enough to not spam team or burn LLM tokens |
| S4  | Storage: SQLite working memory + JR-owned markdown library                                                                | DB for queryable working memory; library for human-readable knowledge graph                  |
| S5  | Library location: `~/.openclaw/jr-library/` (JR-owned, fluid structure)                                                   | JR can create new top-level folders as new domains emerge                                    |
| S6  | Engagement scope: R1 + R2 — anyone at Vero                                                                                | Maximum learning surface; smart topic-based routing inside that scope                        |
| S7  | Engagement etiquette: free-flowing multi-turn conversations, no softening preamble, colleague tone                        | JR earns trust by being useful, not by sounding deferential                                  |
| S8  | Synthesis must be quantitatively rigorous                                                                                 | Numbers > vibes — every claim backed by a measurable signal                                  |
| S9  | Output: M2 (weekly digest DM to Kaleb) + M4 (strategic → Ridge)                                                           | Right person for the right scope of opportunity                                              |
| S10 | Feedback to triage: F4 (read-only context now → playbook auto-propose later → decision augmentation as synthesis matures) | Triage gets faster the more JR knows                                                         |

## 3. Architecture

### 3.1 Pipeline overview

```
Every 2 hours:

L1 OBSERVE      → parallel fan-out across in-bounds sources
   ↓             (quantitative + qualitative observations captured)
L2 STORE        → sentinel.db tables (observations, conversations,
   ↓             insights, opportunities, people_profiles, reports, opt_outs)
L3 SYNTHESIZE   → LLM pass over recent observations + library context
   ↓             outputs: patterns, anomalies, friction, opportunities
                 (each insight MUST cite quantitative evidence where data exists)
L4 CURATE       → JR decides where each insight belongs in the library,
   ↓             updates / creates .md files, creates new top-level folders
                 as new topics emerge, auto-regenerates INDEX.md
L5 REPORT       → daily summaries (file), weekly digests (file + DM Kaleb),
   ↓             weekly "ideas" creative pass (file + DM Kaleb,
                 escalate big strategic to Ridge)
L6 INQUIRE      → identify knowledge gaps, formulate questions,
   ↓             pick the right person, DM them naturally,
                 capture multi-turn responses into library
L7 MONETIZE     → creative engine on full accumulated knowledge:
                 ranked revenue + efficiency ideas grounded in data
                 → ops/efficiency surface to Kaleb (M2)
                 → strategic surface to Ridge (M4)

Feedback to Triage v2 (F4):
  - Planner reads library + sentinel.db before producing plans (now)
  - Repeated patterns auto-propose playbooks for human approval (after playbooks ship)
  - "What should I do today" queries surface prioritized insights (later)
```

### 3.2 Components

Seven modules in `src/sentinel/`, each with one clear responsibility:

**1. `observer-runner`** (`src/sentinel/observer-runner.ts`)

- Triggers every 2 hours.
- Runs all registered observers in parallel (fan-out).
- Writes resulting observations to `sentinel.db` and updates per-source last-observed-at watermarks.

**2. `observers/*`** (one file per source)

- `observers/self.ts` — query triage.db: session counts by state, action invocations by status, classifier outcomes, recent failures.
- `observers/slack-channels.ts` — fetch last N hours of activity per allowed channel: message counts, sender mix, topic clusters via cheap LLM.
- `observers/coperniq.ts` (Phase B, after gcloud) — query WO statuses, project counts by stage, financial summaries (aggregate only).
- `observers/gcp-functions.ts` (Phase B) — query Cloud Function logs/metrics for invocation counts + error rates.
- `observers/launchagents.ts` — `launchctl list | grep openclaw` parse for sibling job health.
- `observers/external-context.ts` (Phase C) — solar industry headlines via web search; weather forecast (affects install scheduling).
- Each observer implements a common interface: `observe(since: number): Promise<Observation[]>`.

**3. `synthesizer`** (`src/sentinel/synthesizer.ts`)

- Triggered after observation completes.
- Pulls last cycle's observations + library context for relevant topics.
- LLM call (Pro for quality on a non-time-critical task) to extract: patterns, anomalies, friction, opportunities.
- Strict output schema: each insight has `summary`, `category`, `confidence`, `evidence` (with quantitative metrics), `derived_from` (observation IDs).
- Writes insights to `sentinel.db`.

**4. `curator`** (`src/sentinel/curator.ts`)

- After synthesis, decides where each new piece of knowledge belongs.
- Reads current library structure (`INDEX.md` + folder scan).
- For each insight or noteworthy observation:
  - Identify candidate target file (existing `.md`) or candidate new file.
  - If no good existing home and a new pattern is emerging, propose new folder.
  - Edits target file (append section, deduplicate, preserve human edits).
  - Updates INDEX.md.
- Output: changes summary fed to reporter.

**5. `reporter`** (`src/sentinel/reporter.ts`)

- Daily: writes `reports/daily/YYYY-MM-DD.md` summarizing the day's observations + key insights.
- Weekly: writes `reports/weekly/WXX-YYYY.md` digest + DMs to Kaleb (M2).
- Weekly creative pass: writes `reports/ideas/WXX-YYYY-ideas.md` (M2/M4 routing — see §3.6).

**6. `inquirer`** (`src/sentinel/inquirer.ts`)

- After synthesis, scans for knowledge gaps (insights with low confidence, missing data fields, contradictions).
- For each gap, generates a question + identifies the best person to ask (uses `people_profiles` table — who-knows-what).
- Checks `opt_outs` table — skip people who've said "stop asking" globally or about specific topics.
- DMs the person directly with the question — colleague tone, no preamble. Records the conversation in `conversations` table.
- Watches for replies (lives in the Slack message handler hook). Multi-turn: follow-ups stay in the same conversation thread until the person disengages.
- When conversation ends (person doesn't reply for 3 days OR explicitly closes it), JR synthesizes the takeaways and routes them into the library.

**7. `monetizer`** (`src/sentinel/monetizer.ts`)

- Weekly, ~24 hours after the regular weekly digest.
- LLM call: full accumulated library + recent observations + recent interview answers.
- Prompt: "Given everything you know about Vero, propose the top 5 revenue ideas and top 5 efficiency wins. Each MUST cite quantitative evidence from the library. Mark each as ops-scope or strategic-scope."
- Writes `reports/ideas/WXX-YYYY-ideas.md`.
- Routing:
  - Ops/efficiency ideas → included in M2 Friday digest DM to Kaleb.
  - Strategic ideas (M4) → DM Ridge directly with a brief intro: "I've been thinking about [topic]. Here's what I see: [idea + evidence]. Worth a 15-min conversation?"

### 3.3 Engagement etiquette (L6 detail)

- **Tone:** colleague — "Hey, I'm looking at the BOM workflow. When you trigger bomQuoteNotifier, do you ever skip projects where the customer's already been emailed? Trying to figure out if that's a real pattern."
- **No softening preamble** — no "I'm a learning bot" framing. JR opens with the actual question.
- **Multi-turn:** as long as the human keeps engaging, JR stays in the conversation. Follow-ups, clarifications, tangents — all welcome.
- **Conversation end signals:**
  - 3 days of no response → JR quietly drops it, requeues for later if still relevant.
  - "Stop asking me about [topic]" → add to `opt_outs` with topic scope.
  - "Leave me alone" / "Stop asking" / similar global signal → add to `opt_outs` global.
- **NO hard rate limits.** JR uses judgment about when to ask. If the same person was just answered, JR doesn't pile on with a new question the same hour.
- **Concurrent conversations:** JR can have many open at once across different people, but only one open conversation per person at a time.

### 3.4 Storage

#### `sentinel.db` (SQLite at `~/.openclaw/sentinel.db`)

**`observations`** — every L1 capture.

```
id              INTEGER PRIMARY KEY AUTOINCREMENT
source          TEXT NOT NULL              -- 'self'|'slack-channels'|'coperniq'|...
topic           TEXT                       -- LLM-tagged or rule-tagged
timestamp       INTEGER NOT NULL
summary         TEXT NOT NULL              -- 1-2 sentence human-readable
data            TEXT                       -- JSON: raw structured fields
metrics         TEXT                       -- JSON: { metric_name → number/value }
embedding       BLOB                       -- for semantic search
created_at      INTEGER NOT NULL
```

**`insights`** — synthesis output.

```
id              INTEGER PRIMARY KEY AUTOINCREMENT
category        TEXT NOT NULL              -- 'pattern'|'anomaly'|'friction'|'opportunity'
summary         TEXT NOT NULL
evidence        TEXT NOT NULL              -- markdown with quantitative claims + observation IDs
derived_from    TEXT                       -- JSON array of observation IDs
confidence      REAL                       -- 0..1
generated_at    INTEGER NOT NULL
superseded_by   INTEGER REFERENCES insights(id)
filed_to        TEXT                       -- path in jr-library/ where this landed
```

**`conversations`** — L6 inquiry tracking.

```
id              INTEGER PRIMARY KEY AUTOINCREMENT
person_user_id  TEXT NOT NULL
channel         TEXT NOT NULL              -- usually the DM channel
thread_ts       TEXT
topic           TEXT NOT NULL
opening_message TEXT NOT NULL
state           TEXT NOT NULL              -- 'open'|'closed'|'dropped'|'opt-out'
turns           TEXT                       -- JSON: [{sender, text, ts}]
opened_at       INTEGER NOT NULL
last_turn_at    INTEGER
closed_at       INTEGER
takeaway        TEXT                       -- post-close synthesis
```

**`people_profiles`** — who knows what.

```
user_id         TEXT PRIMARY KEY
display_name    TEXT
known_domains   TEXT                       -- JSON array of topics this person owns
last_engaged_at INTEGER
total_engaged   INTEGER NOT NULL DEFAULT 0
notes           TEXT                       -- free-form context JR maintains about this person
```

**`opt_outs`** — engagement preferences.

```
id              INTEGER PRIMARY KEY AUTOINCREMENT
person_user_id  TEXT NOT NULL
scope           TEXT NOT NULL              -- 'global' | topic string
added_at        INTEGER NOT NULL
reason          TEXT                       -- person's own words, captured verbatim
```

**`opportunities`** — L7 monetize output, tracked over time.

```
id              INTEGER PRIMARY KEY AUTOINCREMENT
title           TEXT NOT NULL
scope           TEXT NOT NULL              -- 'ops-efficiency' | 'strategic-revenue'
summary         TEXT NOT NULL
evidence        TEXT NOT NULL              -- quantitative grounding
proposed_at     INTEGER NOT NULL
confidence      REAL
filed_to        TEXT                       -- path in library
status          TEXT NOT NULL              -- 'proposed' | 'in-progress' | 'shipped' | 'declined' | 'stale'
status_notes    TEXT
```

**`reports`** — audit trail.

```
id              INTEGER PRIMARY KEY AUTOINCREMENT
kind            TEXT NOT NULL              -- 'daily' | 'weekly-digest' | 'weekly-ideas'
generated_at    INTEGER NOT NULL
filed_to        TEXT NOT NULL              -- path in library
delivered_to    TEXT                       -- JSON: { kaleb_dm: ts, ridge_dm: ts, ... }
```

#### `~/.openclaw/jr-library/` — markdown library, JR-owned, fluid

Seeded structure (JR creates new top-level folders as new topics emerge):

```
jr-library/
├── INDEX.md                              # auto-maintained TOC; lists every file with one-line description
├── people/
│   ├── ridge-payne.md
│   ├── kaleb-lundquist.md
│   ├── jordan-evans.md
│   └── ...                               # one .md per recurring person — accumulated context
├── projects/
│   └── <project-id>-<slug>.md            # per Coperniq project of interest
├── operations/
│   ├── coperniq-wo-flow.md               # how the WO state machine actually works in practice
│   ├── triage-patterns.md                # observed user-triage patterns
│   └── ...
├── insights/
│   ├── patterns/                         # recurring operational patterns
│   ├── anomalies/                        # deviations from normal
│   ├── opportunities/                    # ← creative L7 revenue/efficiency ideas land here
│   └── friction/                         # observed pain points
├── reports/
│   ├── daily/YYYY-MM-DD.md
│   ├── weekly/WXX-YYYY.md
│   └── ideas/WXX-YYYY-ideas.md
└── threads/
    └── <channel-name>/<topic-slug>.md    # summaries of important Slack threads
```

**Fluid expansion rules:**

- JR can create new top-level folders when accumulated observations in a topic cross a threshold (≥5 observations on a coherent theme not fitting existing folders).
- JR proposes new top-level folders in the next weekly digest with reasoning ("Created `vendors/` because I've now logged 7 distinct interactions about Greentech and Solaria — wanted them in one place").
- JR never deletes files or folders without explicit human approval.
- INDEX.md is auto-regenerated each cycle from a filesystem scan + per-file frontmatter (each .md has `---` frontmatter with `title`, `summary`, `tags`).

### 3.5 Cadence

| Tempo                       | What happens                                                                                                                                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every 2 hours               | Observers fan out, results written to `sentinel.db`. Synthesizer runs over the new observations. Curator updates the library + INDEX.md. Inquirer scans for gaps and may open 0-N new conversations.        |
| Sub-cycle (responsive)      | When a person replies to an open inquiry conversation, the message handler routes their response into the conversations table and triggers a follow-up from the inquirer — no waiting for the next 2h tick. |
| Daily (00:00 local)         | Reporter writes `reports/daily/YYYY-MM-DD.md` summarizing the day.                                                                                                                                          |
| Weekly (Friday 09:00 local) | Reporter writes `reports/weekly/WXX-YYYY.md` digest + DMs Kaleb (M2).                                                                                                                                       |
| Weekly (Sunday 17:00 local) | Monetizer creative pass: writes `reports/ideas/WXX-YYYY-ideas.md` + DMs Kaleb the digest + DMs Ridge any strategic ideas (M4).                                                                              |

### 3.6 Output routing (M2 + M4)

- **M2 (ops + efficiency):** every Friday morning, JR DMs Kaleb: "Weekly digest is filed. Top 3 ops takeaways: ... Top 2 efficiency wins: ... Full report: [path]"
- **M4 (strategic revenue):** when an L7 idea is scoped as strategic (confidence ≥0.7 AND scope='strategic-revenue'), JR DMs Ridge: "I've been thinking about [topic]. Here's what I see: [idea + evidence]. Worth a 15-min conversation?"
- DMs include the markdown file path so humans can drill in.
- Repeated proposal cooldown: same idea (matched by embedding similarity) doesn't get re-proposed for 30 days unless status was 'declined' (in which case it stays out forever) or 'in-progress' (in which case JR provides updates on relevant new evidence).

### 3.7 Feedback loop to triage (F4)

**F1 (now — ships with Phase A):** When triage's planner builds a plan, it queries `sentinel.db` for relevant insights by topic and includes the top N in the prompt. Example: planning for "fire bomQuoteNotifier" sees insight "BOM volume up 23% WoW; backlog 12 projects" and can add reasoning.

**F2 (after triage playbook subsystem ships):** Sentinel watches for repeated triage patterns (same user, same request shape, ≥3 times in a week). Proposes a playbook with `auto: false` and DMs the user: "I've seen you triage BOM checks 5 times this week. Want me to save it as a playbook so future ones go faster?"

**F3 (after synthesis matures):** A new triage user message "what should I do today" routes to a dedicated sentinel handler that reads recent insights, prioritizes them, and returns a ranked action list as a triage plan.

## 4. Acceptance criteria

- After 1 cycle (2h): `sentinel.db` contains observations from at least the Phase A sources (self + slack-channels). `jr-library/INDEX.md` exists.
- After 1 day: `reports/daily/YYYY-MM-DD.md` filed.
- After 1 week: `reports/weekly/WXX-YYYY.md` filed AND Kaleb received the digest DM.
- After 1 week: `reports/ideas/WXX-YYYY-ideas.md` filed AND Kaleb received the M2 DM (with at least 3 ops ideas + 2 efficiency ideas) AND, if any strategic ideas at confidence ≥0.7, Ridge received M4 DM.
- L6 inquirer has opened ≥1 conversation by end of week 1 (gap-driven, not artificial).
- L6 opt-out: a test reply of "stop asking me" results in `opt_outs` entry within 1 cycle.
- F1 verification: triage planner prompts include "<sentinel_context>" block when insights exist for the topic.
- Quantitative rigor: every insight in `reports/weekly` cites at least one number sourced from `observations.metrics` or library data.

## 5. Implementation phases

### Phase A (MVP — 1 week effort)

Goal: prove the architecture end-to-end with the cheapest, in-house data sources.

- Foundation: `sentinel.db` schema, observer interface, `observer-runner`.
- Observers: `self`, `slack-channels`, `launchagents`.
- Synthesizer, curator, reporter, inquirer, monetizer — all built but Phase A inquirer only formulates questions, doesn't yet send. Manual review of first batch.
- Library skeleton seeded. INDEX.md auto-generation.
- Daily + weekly + ideas reports running on schedule.
- F1 feedback wired into triage planner.

### Phase B (post-gcloud-auth — 1 week)

- Observers: `coperniq`, `gcp-functions`, `gmail-watcher` (read-only, headers + counts only per P1).
- L6 inquirer goes live — JR starts DMing people.

### Phase C (next month)

- Observers: `external-context` (web search for solar industry, weather).
- F2 triage playbook auto-propose wired.
- L7 monetizer starts proposing strategic ideas with sufficient context to escalate to Ridge.

### Phase D (later)

- Embedding-based semantic search of observations + library.
- F3 "what should I do today" handler.
- P2 privacy expansion (with Sam sign-off).

## 6. Build order within Phase A

1. **Schema + observer interface** — sentinel.db migrations, types, observer registry.
2. **Self observer + observer-runner** — proves the cycle end-to-end with just one source.
3. **Synthesizer + curator** — proves observations → insights → library.
4. **Reporter (daily)** — proves the daily output path.
5. **Slack-channels observer + launchagents observer** — broaden the source matrix.
6. **Reporter (weekly + ideas) + monetizer + DM delivery to Kaleb** — proves the weekly cycle + DM path.
7. **Inquirer (manual-review mode)** — JR formulates questions, files them for human review before sending. Validates question quality.
8. **F1 wiring into triage planner** — closes the feedback loop.
9. **Smoke test cycle end-to-end** — manual verification.

## 7. Risks and rollback

| Risk                                    | Mitigation                                                                                                                                                                                                              |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JR pesters team with bad questions      | Phase A inquirer is manual-review only. Go live in Phase B once question quality is validated. Hard opt-outs always respected.                                                                                          |
| Synthesis produces vibes-not-numbers    | Synthesizer prompt enforces quantitative evidence in output schema; insights without metrics are rejected at parse time.                                                                                                |
| Library bloats (every cycle adds files) | Curator prefers append-to-existing over new-file; weekly digest reports new file count + flags suspicious patterns.                                                                                                     |
| Sentinel.db grows unbounded             | Observations older than 90 days get embedding + summary preserved, raw `data` field nulled. Configurable.                                                                                                               |
| Cost runs away                          | LLM calls per cycle bounded: 1 synthesizer call (Pro, ≤8k context), 1 curator call (Flash, ≤4k context), 0-N inquirer calls (Flash, only if gaps found). Daily/weekly reports: 1 Pro call each. Estimated $1-3/day max. |
| Library file conflicts with human edits | Curator preserves human-edited regions (looks for `<!-- human edit start -->` / `<!-- end -->` markers); never overwrites without merge.                                                                                |

**Runtime rollback:** new env flag `OPENCLAW_SENTINEL_ENABLED` defaults to off. When unset, observer-runner doesn't fire. Library + sentinel.db remain on disk untouched.

**Per-PR rollback:** each Phase A build step lands as a separate PR; revert individually.

## 8. Testing strategy

- **Unit:** every observer with mocked source data; synthesizer with fixed observation fixtures; curator with snapshot tests on library state.
- **Integration:** full sentinel cycle against a seeded sentinel.db + temp library directory; assert observations created, insights extracted, library updated, INDEX.md regenerated.
- **Manual smoke:** Phase A: 2 cycles, verify library evolves sensibly. Phase B: live inquirer with operator review of each question before send.

## 9. Relationship to other roadmap phases

- **Phase 3 (Triage v2):** ships first. Already shipped per PR https://github.com/Vero-Power/openclaw/pull/4.
- **Phase 3.5 (Triage follow-ups):** researcher, playbooks, evalCollector, full catalog. Some absorbed by Sentinel (F2 = sentinel-proposed playbooks; F1 = sentinel-augmented planner context).
- **Phase 4 (JR persona sharpening):** still relevant — Sentinel reuses SOUL.md / IDENTITY.md / USER.md so persona consolidation benefits it too.
- **Phase 5 (cold-start optimization):** orthogonal — applies to both Triage and Sentinel runtimes.
- **Phase 6 (this spec):** Sentinel JR.

## 10. Open questions (deferred to implementation)

- Exact embedding model for observation semantic search (Gemini's embedding-001 vs newer).
- Threshold for "promote-to-folder" (currently rule-of-thumb: ≥5 observations on a coherent theme).
- Whether sentinel's per-person `notes` field should be visible to that person on request, or stay internal. Defaulting to internal for MVP.
- How to handle the case where two open inquiry conversations with different people produce contradictory answers — currently: curator notes the contradiction in the insight evidence, JR follows up to resolve.
- Persona for L6 inquirer — uses JR's SOUL.md voice or a more business-analyst tone? Defaulting to SOUL.md voice (single consistent JR) — revisit if it feels off in practice.

---

**End of spec.**
