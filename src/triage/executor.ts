import type { ActionRegistry } from "./actions/registry.js";
import type { SessionStore } from "./session-store.js";
import type { SlackBridge } from "./slack-bridge.js";
import type { Plan, PlanStep, ExecutionLogEntry } from "./types.js";

export interface ExecutorDeps {
  store: SessionStore;
  registry: ActionRegistry;
  slack: SlackBridge;
}

/**
 * Action results may set a `_display` field with pre-formatted Slack markdown.
 * When present, we use it verbatim as the excerpt (no JSON noise, no truncation).
 * Falls back to the historical 200-char JSON excerpt for actions that haven't
 * adopted the convention.
 */
function pickExcerpt(r: unknown): string {
  if (r && typeof r === "object" && "_display" in r) {
    const d = (r as Record<string, unknown>)["_display"];
    if (typeof d === "string" && d.length > 0) {
      return d;
    }
  }
  return JSON.stringify(r).slice(0, 200);
}

export class Executor {
  constructor(private deps: ExecutorDeps) {}

  async run(request_id: string): Promise<void> {
    const session = this.deps.store.get(request_id);
    if (!session) {
      throw new Error(`session ${request_id} not found`);
    }
    if (session.state !== "EXECUTING") {
      throw new Error(`expected EXECUTING, got ${session.state}`);
    }
    if (!session.final_plan) {
      throw new Error("session has no final plan");
    }
    if (!session.progress_ts) {
      throw new Error("session has no progress_ts");
    }

    const plan = session.final_plan;
    const slack_post = async (text: string) => this.deps.slack.post(text);
    const slack_edit = async (ts: string, text: string) => this.deps.slack.edit(ts, text);

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      await slack_edit(session.progress_ts, this.renderProgress(plan, i, "running"));

      const entry: ExecutionLogEntry = {
        step_idx: i,
        action: step.action,
        args: step.args,
        status: "running",
        started_at: Date.now(),
        ended_at: null,
        result_excerpt: null,
        retried: false,
      };
      this.deps.store.appendExecutionLog(request_id, entry);

      const result = await this.executeStepWithRetry(step, request_id, {
        slack_post,
        slack_edit,
      });
      entry.ended_at = Date.now();
      entry.status = result.status;
      entry.result_excerpt = result.excerpt;
      entry.retried = result.retried;

      // Overwrite the latest log entry with the final status
      const cur = this.deps.store.get(request_id)!;
      cur.execution_log[cur.execution_log.length - 1] = entry;
      this.deps.store.setExecutionLog(request_id, cur.execution_log);

      if (result.status === "retried_error" || result.status === "error") {
        await this.failSession(request_id, i, result.excerpt, plan);
        return;
      }
    }

    await this.completeSession(request_id, plan);
  }

  private async executeStepWithRetry(
    step: PlanStep,
    request_id: string,
    ctxExt: { slack_post: SlackBridge["post"]; slack_edit: SlackBridge["edit"] },
  ): Promise<{ status: ExecutionLogEntry["status"]; excerpt: string; retried: boolean }> {
    const ctx = {
      request_id,
      slack_post: ctxExt.slack_post,
      slack_edit: ctxExt.slack_edit,
      logger: {
        info: (msg: string, meta?: Record<string, unknown>) => console.info(msg, meta),
        error: (msg: string, meta?: Record<string, unknown>) => console.error(msg, meta),
        warn: (msg: string, meta?: Record<string, unknown>) => console.warn(msg, meta),
      },
    };

    try {
      const r = await this.deps.registry.invoke(step.action, step.args, ctx);
      return {
        status: "success",
        excerpt: pickExcerpt(r),
        retried: false,
      };
    } catch (err1) {
      try {
        const r = await this.deps.registry.invoke(step.action, step.args, ctx);
        return {
          status: "retried_success",
          excerpt: pickExcerpt(r),
          retried: true,
        };
      } catch (err2) {
        return {
          status: "retried_error",
          excerpt: `${(err1 as Error).message} | retry: ${(err2 as Error).message}`,
          retried: true,
        };
      }
    }
  }

  private async failSession(
    request_id: string,
    step_idx: number,
    error_excerpt: string,
    plan: Plan,
  ): Promise<void> {
    const session = this.deps.store.get(request_id)!;
    if (session.progress_ts) {
      const text = this.renderFailure(plan, step_idx, error_excerpt);
      await this.deps.slack.edit(session.progress_ts, text);
    }
    this.deps.store.transition(request_id, "FAILED_AT_STEP");
    this.deps.store.setFailedAtStep(request_id, step_idx);
  }

  private async completeSession(request_id: string, plan: Plan): Promise<void> {
    const session = this.deps.store.get(request_id)!;
    if (session.progress_ts) {
      await this.deps.slack.edit(
        session.progress_ts,
        this.renderProgress(plan, plan.steps.length, "complete"),
      );
    }
    this.deps.store.transition(request_id, "COMPLETE");

    const summaryText = this.renderSummary(plan, session.execution_log);
    const posted = await this.deps.slack.post(summaryText);
    this.deps.store.updateSummaryTs(request_id, posted.ts);
  }

  private renderProgress(plan: Plan, current_step: number, mode: "running" | "complete"): string {
    const lines: string[] = [];
    lines.push(mode === "complete" ? "Done." : "Executing...");
    plan.steps.forEach((s, i) => {
      const icon = i < current_step ? "v" : i === current_step && mode !== "complete" ? ">" : ".";
      lines.push(`${icon} ${i + 1}. ${s.action}`);
    });
    return lines.join("\n");
  }

  private renderFailure(plan: Plan, step_idx: number, error_excerpt: string): string {
    const remaining = plan.steps.length - step_idx - 1;
    const lines = [
      `Failed at step ${step_idx + 1}: \`${plan.steps[step_idx].action}\``,
      "",
      "Error:",
      "```",
      error_excerpt,
      "```",
      "",
      `Args:`,
      "```json",
      JSON.stringify(plan.steps[step_idx].args, null, 2),
      "```",
      "",
      `${remaining} step${remaining === 1 ? "" : "s"} pending (not executed).`,
      "",
      "Retried once before escalating. Reply here to retry, or cancel.",
    ];
    return lines.join("\n");
  }

  private renderSummary(plan: Plan, log: ExecutionLogEntry[]): string {
    const lines = [`Done. ${plan.steps.length}/${plan.steps.length} steps.`, ""];
    plan.steps.forEach((s, i) => {
      const entry = log[i];
      const retried = entry?.retried ? " (retried)" : "";
      lines.push(
        `${i + 1}. \`${s.action}\`${retried} -> ${entry?.result_excerpt ?? "(no excerpt)"}`,
      );
    });
    return lines.join("\n");
  }
}
