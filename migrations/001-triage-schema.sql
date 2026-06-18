CREATE TABLE IF NOT EXISTS triage_sessions (
  request_id          TEXT PRIMARY KEY,
  channel             TEXT NOT NULL,
  thread_ts           TEXT NOT NULL,
  requester_user_id   TEXT NOT NULL,
  requester_message   TEXT NOT NULL,
  progress_ts         TEXT,
  summary_ts          TEXT,
  state               TEXT NOT NULL,
  classifier_output   TEXT,
  research_bundle     TEXT,
  playbook_id         TEXT,
  plan_history        TEXT,
  final_plan          TEXT,
  execution_log       TEXT,
  failed_at_step      INTEGER,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_triage_sessions_channel_thread
  ON triage_sessions(channel, thread_ts);
CREATE INDEX IF NOT EXISTS idx_triage_sessions_state
  ON triage_sessions(state);

CREATE TABLE IF NOT EXISTS triage_queue (
  queue_position      INTEGER PRIMARY KEY AUTOINCREMENT,
  channel             TEXT NOT NULL,
  thread_ts           TEXT NOT NULL,
  request_id          TEXT NOT NULL REFERENCES triage_sessions(request_id),
  queued_at           INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_triage_queue_channel_thread
  ON triage_queue(channel, thread_ts, queue_position);

CREATE TABLE IF NOT EXISTS action_invocations (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id          TEXT NOT NULL REFERENCES triage_sessions(request_id),
  step_idx            INTEGER NOT NULL,
  action              TEXT NOT NULL,
  args                TEXT,
  result_status       TEXT NOT NULL,
  result_body         TEXT,
  duration_ms         INTEGER,
  acted_by            TEXT NOT NULL DEFAULT 'jr',
  invoked_at          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_action_invocations_request
  ON action_invocations(request_id, step_idx);

CREATE TABLE IF NOT EXISTS playbooks (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  description         TEXT,
  match_examples      TEXT,
  match_embeddings    BLOB,
  plan_template       TEXT,
  auto                INTEGER NOT NULL DEFAULT 0,
  promoted_from       TEXT REFERENCES triage_sessions(request_id),
  promoted_by         TEXT,
  created_at          INTEGER NOT NULL,
  last_used_at        INTEGER,
  use_count           INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS feedback (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id          TEXT NOT NULL REFERENCES triage_sessions(request_id),
  user_id             TEXT NOT NULL,
  kind                TEXT NOT NULL,
  content             TEXT,
  correction_data     TEXT,
  created_at          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_feedback_request
  ON feedback(request_id);
