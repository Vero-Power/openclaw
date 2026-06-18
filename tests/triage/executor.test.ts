import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";
import { ActionRegistry } from "../../src/triage/actions/registry.js";
import type { CatalogAction } from "../../src/triage/actions/types.js";
import { openTriageDb } from "../../src/triage/db.js";
import { Executor } from "../../src/triage/executor.js";
import { SessionStore } from "../../src/triage/session-store.js";
import type { Plan } from "../../src/triage/types.js";

const TEST_DB = join(tmpdir(), `triage-exec-test-${Date.now()}.db`);

describe("Executor", () => {
  let store: SessionStore;
  let reg: ActionRegistry;
  let slackEdits: string[];
  let slackPosts: string[];

  beforeEach(() => {
    if (existsSync(TEST_DB)) {
      unlinkSync(TEST_DB);
    }
    const db = openTriageDb(TEST_DB);
    store = new SessionStore(db);
    reg = new ActionRegistry();
    slackEdits = [];
    slackPosts = [];

    const okAction: CatalogAction<{ x: number }, { y: number }> = {
      name: "double",
      description: "double x",
      args_schema: z.object({ x: z.number() }),
      idempotent: true,
      external_effect: false,
      invoke: async (args) => ({ y: args.x * 2 }),
    };
    const flakyAction: CatalogAction<Record<string, never>, { ok: true }> = {
      name: "flaky",
      description: "fails on first call, succeeds on retry",
      args_schema: z.object({}).strict(),
      idempotent: true,
      external_effect: false,
      invoke: vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({ ok: true }),
    };
    const brokenAction: CatalogAction<Record<string, never>, never> = {
      name: "broken",
      description: "always fails",
      args_schema: z.object({}).strict(),
      idempotent: true,
      external_effect: false,
      invoke: async () => {
        throw new Error("nope");
      },
    };
    reg.register(okAction);
    reg.register(flakyAction);
    reg.register(brokenAction);
  });

  function bridge() {
    return {
      post: async (text: string) => {
        slackPosts.push(text);
        return { ts: `T${slackPosts.length}` };
      },
      edit: async (_ts: string, text: string) => {
        slackEdits.push(text);
      },
    };
  }

  it("runs a single-step plan to COMPLETE, posting summary", async () => {
    const session = store.create({
      channel: "C",
      thread_ts: "T",
      requester_user_id: "U",
      requester_message: "double 5",
    });
    store.updateProgressTs(session.request_id, "P1");
    store.transition(session.request_id, "CLASSIFIED");
    store.transition(session.request_id, "PLANNING");
    store.transition(session.request_id, "AWAITING_APPROVAL");

    const plan: Plan = {
      steps: [{ action: "double", args: { x: 5 }, rationale: "test" }],
      confidence: 1,
      summary: "double 5",
    };
    store.setFinalPlan(session.request_id, plan);
    store.transition(session.request_id, "EXECUTING");

    const exec = new Executor({ store, registry: reg, slack: bridge() });
    await exec.run(session.request_id);

    const finalSession = store.get(session.request_id)!;
    expect(finalSession.state).toBe("COMPLETE");
    expect(finalSession.execution_log).toHaveLength(1);
    expect(finalSession.execution_log[0].status).toBe("success");
    expect(finalSession.summary_ts).toBeTruthy();
    expect(slackPosts).toHaveLength(1); // final summary
    expect(slackEdits.length).toBeGreaterThan(0); // live status edits
  });

  it("retries a flaky step once and continues to COMPLETE", async () => {
    const session = store.create({
      channel: "C",
      thread_ts: "T",
      requester_user_id: "U",
      requester_message: "flake",
    });
    store.updateProgressTs(session.request_id, "P1");
    store.transition(session.request_id, "CLASSIFIED");
    store.transition(session.request_id, "PLANNING");
    store.transition(session.request_id, "AWAITING_APPROVAL");
    store.setFinalPlan(session.request_id, {
      steps: [{ action: "flaky", args: {} }],
      confidence: 1,
      summary: "test flaky",
    });
    store.transition(session.request_id, "EXECUTING");

    const exec = new Executor({ store, registry: reg, slack: bridge() });
    await exec.run(session.request_id);

    const final = store.get(session.request_id)!;
    expect(final.state).toBe("COMPLETE");
    expect(final.execution_log[0].status).toBe("retried_success");
    expect(final.execution_log[0].retried).toBe(true);
  });

  it("escalates to FAILED_AT_STEP after one retry, posting descriptive error", async () => {
    const session = store.create({
      channel: "C",
      thread_ts: "T",
      requester_user_id: "U",
      requester_message: "broken",
    });
    store.updateProgressTs(session.request_id, "P1");
    store.transition(session.request_id, "CLASSIFIED");
    store.transition(session.request_id, "PLANNING");
    store.transition(session.request_id, "AWAITING_APPROVAL");
    store.setFinalPlan(session.request_id, {
      steps: [
        { action: "double", args: { x: 1 } },
        { action: "broken", args: {} },
        { action: "double", args: { x: 2 } },
      ],
      confidence: 1,
      summary: "will fail at step 2",
    });
    store.transition(session.request_id, "EXECUTING");

    const exec = new Executor({ store, registry: reg, slack: bridge() });
    await exec.run(session.request_id);

    const final = store.get(session.request_id)!;
    expect(final.state).toBe("FAILED_AT_STEP");
    expect(final.failed_at_step).toBe(1); // 0-indexed
    expect(final.execution_log).toHaveLength(2); // step 0 succeeded, step 1 failed
    expect(final.execution_log[1].status).toBe("retried_error");
    expect(final.summary_ts).toBeNull(); // no summary on failure
    // Verify final edit mentions failure
    expect(slackEdits[slackEdits.length - 1]).toMatch(/failed|error|nope/i);
  });
});
