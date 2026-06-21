import Database, { type Database as DatabaseType } from "better-sqlite3";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS observations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source          TEXT NOT NULL,
  topic           TEXT,
  timestamp       INTEGER NOT NULL,
  summary         TEXT NOT NULL,
  data            TEXT,
  metrics         TEXT,
  embedding       BLOB,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_observations_source_ts
  ON observations(source, timestamp);
CREATE INDEX IF NOT EXISTS idx_observations_topic
  ON observations(topic);

CREATE TABLE IF NOT EXISTS insights (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  category        TEXT NOT NULL,
  summary         TEXT NOT NULL,
  evidence        TEXT NOT NULL,
  derived_from    TEXT,
  confidence      REAL,
  generated_at    INTEGER NOT NULL,
  superseded_by   INTEGER REFERENCES insights(id),
  filed_to        TEXT,
  embedding       BLOB
);

CREATE INDEX IF NOT EXISTS idx_insights_category
  ON insights(category);
CREATE INDEX IF NOT EXISTS idx_insights_generated_at
  ON insights(generated_at);

CREATE TABLE IF NOT EXISTS conversations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  person_user_id  TEXT NOT NULL,
  channel         TEXT NOT NULL,
  thread_ts       TEXT,
  topic           TEXT NOT NULL,
  opening_message TEXT NOT NULL,
  state           TEXT NOT NULL,
  turns           TEXT,
  opened_at       INTEGER NOT NULL,
  last_turn_at    INTEGER,
  closed_at       INTEGER,
  takeaway        TEXT
);

CREATE INDEX IF NOT EXISTS idx_conversations_person_state
  ON conversations(person_user_id, state);

CREATE TABLE IF NOT EXISTS people_profiles (
  user_id         TEXT PRIMARY KEY,
  display_name    TEXT,
  known_domains   TEXT,
  last_engaged_at INTEGER,
  total_engaged   INTEGER NOT NULL DEFAULT 0,
  notes           TEXT
);

CREATE TABLE IF NOT EXISTS opt_outs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  person_user_id  TEXT NOT NULL,
  scope           TEXT NOT NULL,
  added_at        INTEGER NOT NULL,
  reason          TEXT
);

CREATE INDEX IF NOT EXISTS idx_opt_outs_person
  ON opt_outs(person_user_id);

CREATE TABLE IF NOT EXISTS opportunities (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT NOT NULL,
  scope           TEXT NOT NULL,
  summary         TEXT NOT NULL,
  evidence        TEXT NOT NULL,
  proposed_at     INTEGER NOT NULL,
  confidence      REAL,
  filed_to        TEXT,
  status          TEXT NOT NULL DEFAULT 'proposed',
  status_notes    TEXT
);

CREATE INDEX IF NOT EXISTS idx_opportunities_status
  ON opportunities(status);

CREATE TABLE IF NOT EXISTS reports (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  kind            TEXT NOT NULL,
  generated_at    INTEGER NOT NULL,
  filed_to        TEXT NOT NULL,
  delivered_to    TEXT
);

CREATE INDEX IF NOT EXISTS idx_reports_kind_generated
  ON reports(kind, generated_at);

CREATE TABLE IF NOT EXISTS observer_watermarks (
  source          TEXT PRIMARY KEY,
  last_observed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS followups (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  kind              TEXT NOT NULL,
  payload           TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  source            TEXT NOT NULL,
  source_ref        TEXT,
  requester_user_id TEXT,
  created_at        INTEGER NOT NULL,
  processed_at      INTEGER,
  attempts          INTEGER NOT NULL DEFAULT 0,
  last_error        TEXT
);

CREATE INDEX IF NOT EXISTS idx_followups_status ON followups(status);

CREATE TABLE IF NOT EXISTS oracle_recommendations (
  id                TEXT PRIMARY KEY,
  assignee_email    TEXT NOT NULL,
  assignee_slack_id TEXT,
  title             TEXT NOT NULL,
  rationale         TEXT NOT NULL,
  evidence          TEXT NOT NULL,
  scope             TEXT NOT NULL,
  urgency           TEXT NOT NULL,
  confidence        TEXT NOT NULL,
  data              TEXT NOT NULL,
  first_seen_at     INTEGER NOT NULL,
  last_seen_at      INTEGER NOT NULL,
  dismissed_at      INTEGER,
  embedding         BLOB
);

CREATE INDEX IF NOT EXISTS oracle_recommendations_assignee
  ON oracle_recommendations(assignee_email, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS oracle_dms_sent (
  rec_id          TEXT NOT NULL,
  assignee_email  TEXT NOT NULL,
  sent_at         INTEGER NOT NULL,
  PRIMARY KEY (rec_id, assignee_email)
);
`;

// One connection per path: several subsystems (sentinel cycle, followup bridge)
// open the same sentinel.db in one process and must not diverge.
const connections = new Map<string, DatabaseType>();

export function openSentinelDb(path: string): DatabaseType {
  const cached = connections.get(path);
  if (cached?.open) {
    return cached;
  }
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);

  // Idempotent ALTER TABLE migrations for installs that pre-date these
  // columns. SQLite has no IF NOT EXISTS for ADD COLUMN; we swallow the
  // "duplicate column name" error so re-running on a fresh schema is a no-op.
  for (const table of ["observations", "insights", "oracle_recommendations"]) {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN embedding BLOB`);
    } catch (err) {
      const msg = (err as Error).message;
      if (!/duplicate column name: embedding/.test(msg)) {
        throw err;
      }
    }
  }

  connections.set(path, db);
  return db;
}
