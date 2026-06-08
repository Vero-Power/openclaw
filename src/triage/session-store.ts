import { randomUUID } from "node:crypto";
import type { Database as DatabaseType } from "better-sqlite3";
import { canTransition } from "./state-machine.js";
import type {
  TriageSession,
  TriageState,
  PlanHistoryEntry,
  ExecutionLogEntry,
  Plan,
  ClassifierOutput,
} from "./types.js";

export interface CreateSessionInput {
  channel: string;
  thread_ts: string;
  requester_user_id: string;
  requester_message: string;
}

const TERMINAL_STATES: ReadonlyArray<TriageState> = [
  "COMPLETE",
  "CANCELLED",
  "ABANDONED",
  "FAILED_AT_STEP",
];

export class SessionStore {
  constructor(private db: DatabaseType) {}

  create(input: CreateSessionInput): TriageSession {
    const now = Date.now();
    const request_id = randomUUID();
    const session: TriageSession = {
      request_id,
      channel: input.channel,
      thread_ts: input.thread_ts,
      requester_user_id: input.requester_user_id,
      requester_message: input.requester_message,
      progress_ts: null,
      summary_ts: null,
      state: "PENDING_CLASSIFY",
      classifier_output: null,
      research_bundle: null,
      playbook_id: null,
      plan_history: [],
      final_plan: null,
      execution_log: [],
      failed_at_step: null,
      created_at: now,
      updated_at: now,
    };
    this.db
      .prepare(
        `INSERT INTO triage_sessions
         (request_id, channel, thread_ts, requester_user_id, requester_message,
          progress_ts, summary_ts, state, classifier_output, research_bundle,
          playbook_id, plan_history, final_plan, execution_log, failed_at_step,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.request_id,
        session.channel,
        session.thread_ts,
        session.requester_user_id,
        session.requester_message,
        session.progress_ts,
        session.summary_ts,
        session.state,
        null,
        null,
        null,
        "[]",
        null,
        "[]",
        null,
        session.created_at,
        session.updated_at,
      );
    return session;
  }

  get(request_id: string): TriageSession | null {
    const row = this.db
      .prepare("SELECT * FROM triage_sessions WHERE request_id = ?")
      .get(request_id) as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }
    return this.hydrate(row);
  }

  transition(request_id: string, to: TriageState): void {
    const session = this.get(request_id);
    if (!session) {
      throw new Error(`session ${request_id} not found`);
    }
    if (!canTransition(session.state, to)) {
      throw new Error(`invalid transition: ${session.state} → ${to}`);
    }
    this.db
      .prepare("UPDATE triage_sessions SET state = ?, updated_at = ? WHERE request_id = ?")
      .run(to, Date.now(), request_id);
  }

  findActive(channel: string, thread_ts: string): TriageSession | null {
    const row = this.db
      .prepare(
        `SELECT * FROM triage_sessions
         WHERE channel = ? AND thread_ts = ?
           AND state NOT IN ('COMPLETE', 'CANCELLED', 'ABANDONED', 'FAILED_AT_STEP')
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(channel, thread_ts) as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }
    return this.hydrate(row);
  }

  /**
   * Opportunistic garbage collection: transition all non-terminal sessions that
   * have been idle for longer than `maxIdleMs` milliseconds to ABANDONED.
   *
   * Designed to run at the top of pipeline entry points — no background process
   * required. Returns the number of sessions that were expired.
   */
  expireStale(maxIdleMs: number): number {
    const cutoff = Date.now() - maxIdleMs;
    const placeholders = TERMINAL_STATES.map(() => "?").join(", ");
    const result = this.db
      .prepare(
        `UPDATE triage_sessions
         SET state = 'ABANDONED', updated_at = ?
         WHERE state NOT IN (${placeholders})
           AND updated_at < ?`,
      )
      .run(Date.now(), ...TERMINAL_STATES, cutoff);
    return result.changes;
  }

  updateProgressTs(request_id: string, progress_ts: string): void {
    this.db
      .prepare("UPDATE triage_sessions SET progress_ts = ?, updated_at = ? WHERE request_id = ?")
      .run(progress_ts, Date.now(), request_id);
  }

  updateSummaryTs(request_id: string, summary_ts: string): void {
    this.db
      .prepare("UPDATE triage_sessions SET summary_ts = ?, updated_at = ? WHERE request_id = ?")
      .run(summary_ts, Date.now(), request_id);
  }

  setClassifierOutput(request_id: string, output: ClassifierOutput): void {
    this.db
      .prepare(
        "UPDATE triage_sessions SET classifier_output = ?, updated_at = ? WHERE request_id = ?",
      )
      .run(JSON.stringify(output), Date.now(), request_id);
  }

  appendPlanHistory(request_id: string, entry: PlanHistoryEntry): void {
    const session = this.get(request_id);
    if (!session) {
      throw new Error(`session ${request_id} not found`);
    }
    const history = [...session.plan_history, entry];
    this.db
      .prepare("UPDATE triage_sessions SET plan_history = ?, updated_at = ? WHERE request_id = ?")
      .run(JSON.stringify(history), Date.now(), request_id);
  }

  setFinalPlan(request_id: string, plan: Plan): void {
    this.db
      .prepare("UPDATE triage_sessions SET final_plan = ?, updated_at = ? WHERE request_id = ?")
      .run(JSON.stringify(plan), Date.now(), request_id);
  }

  appendExecutionLog(request_id: string, entry: ExecutionLogEntry): void {
    const session = this.get(request_id);
    if (!session) {
      throw new Error(`session ${request_id} not found`);
    }
    const log = [...session.execution_log, entry];
    this.db
      .prepare("UPDATE triage_sessions SET execution_log = ?, updated_at = ? WHERE request_id = ?")
      .run(JSON.stringify(log), Date.now(), request_id);
  }

  setExecutionLog(request_id: string, log: ExecutionLogEntry[]): void {
    this.db
      .prepare("UPDATE triage_sessions SET execution_log = ?, updated_at = ? WHERE request_id = ?")
      .run(JSON.stringify(log), Date.now(), request_id);
  }

  setFailedAtStep(request_id: string, step_idx: number): void {
    this.db
      .prepare("UPDATE triage_sessions SET failed_at_step = ?, updated_at = ? WHERE request_id = ?")
      .run(step_idx, Date.now(), request_id);
  }

  private hydrate(row: Record<string, unknown>): TriageSession {
    return {
      request_id: row.request_id as string,
      channel: row.channel as string,
      thread_ts: row.thread_ts as string,
      requester_user_id: row.requester_user_id as string,
      requester_message: row.requester_message as string,
      progress_ts: (row.progress_ts as string | null) ?? null,
      summary_ts: (row.summary_ts as string | null) ?? null,
      state: row.state as TriageState,
      classifier_output: row.classifier_output ? JSON.parse(row.classifier_output as string) : null,
      research_bundle: row.research_bundle ? JSON.parse(row.research_bundle as string) : null,
      playbook_id: (row.playbook_id as string | null) ?? null,
      plan_history: JSON.parse((row.plan_history as string) ?? "[]"),
      final_plan: row.final_plan ? JSON.parse(row.final_plan as string) : null,
      execution_log: JSON.parse((row.execution_log as string) ?? "[]"),
      failed_at_step: (row.failed_at_step as number | null) ?? null,
      created_at: row.created_at as number,
      updated_at: row.updated_at as number,
    };
  }
}
