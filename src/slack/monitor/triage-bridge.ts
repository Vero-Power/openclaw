import { homedir } from "node:os";
import { join } from "node:path";
import {
  Classifier,
  Planner,
  Executor,
  SessionStore,
  openTriageDb,
  bootstrapActionCatalog,
  parseApprovalReply,
} from "../../triage/index.js";
import type { LlmClient } from "../../triage/llm-client.js";
import type { Plan } from "../../triage/types.js";
import type { SlackMessageEvent } from "../types.js";
import type { SlackMonitorContext } from "./context.js";

// TODO(Task 7): replace this stub with a real @mariozechner/pi-ai client
const llmClient: LlmClient = {
  complete: async (_prompt: string, _opts?: { model?: string; temperature?: number }) => {
    throw new Error("LlmClient not wired — pending Task 7 pi-ai integration");
  },
};

const db = openTriageDb(join(homedir(), ".openclaw/triage.db"));
const store = new SessionStore(db);
const registry = bootstrapActionCatalog();
const classifier = new Classifier(llmClient);
const planner = new Planner(llmClient, registry);

export async function runTriagePipeline(
  event: SlackMessageEvent,
  ctx: SlackMonitorContext,
): Promise<void> {
  const session = store.create({
    channel: event.channel,
    thread_ts: event.thread_ts ?? event.ts ?? event.event_ts ?? "",
    requester_user_id: event.user ?? "",
    requester_message: event.text ?? "",
  });

  const c = await classifier.classify(event.text ?? "");
  store.setClassifierOutput(session.request_id, c);
  store.transition(session.request_id, "CLASSIFIED");

  if (!c.is_task) {
    // Not a task — cancel the session; existing chat handler should handle it upstream
    store.transition(session.request_id, "CANCELLED");
    return;
  }

  store.transition(session.request_id, "PLANNING");
  const plan = await planner.plan(event.text ?? "");
  store.setFinalPlan(session.request_id, plan);
  store.appendPlanHistory(session.request_id, { plan, edit_text: null, ts: Date.now() });

  const planText = renderPlanForApproval(plan);
  const posted = await ctx.app.client.chat.postMessage({
    token: ctx.botToken,
    channel: event.channel,
    thread_ts: event.thread_ts ?? event.ts,
    text: planText,
  });
  store.updateProgressTs(session.request_id, posted.ts ?? "");
  store.transition(session.request_id, "AWAITING_APPROVAL");
}

export async function handleThreadReplyForActiveTriage(
  event: SlackMessageEvent,
  ctx: SlackMonitorContext,
): Promise<void> {
  const thread_ts = event.thread_ts;
  if (!thread_ts) {
    return;
  }

  const active = store.findActive(event.channel, thread_ts);
  if (!active) {
    return;
  }
  if (active.state !== "AWAITING_APPROVAL") {
    return;
  }

  const signal = parseApprovalReply(event.text ?? "");

  if (signal.kind === "approve") {
    store.transition(active.request_id, "EXECUTING");
    const slackBridge = {
      post: async (text: string) => {
        const r = await ctx.app.client.chat.postMessage({
          token: ctx.botToken,
          channel: event.channel,
          thread_ts,
          text,
        });
        return { ts: r.ts ?? "" };
      },
      edit: async (ts: string, text: string) => {
        await ctx.app.client.chat.update({
          token: ctx.botToken,
          channel: event.channel,
          ts,
          text,
        });
      },
    };
    const exec = new Executor({ store, registry, slack: slackBridge });
    await exec.run(active.request_id);
  } else if (signal.kind === "cancel") {
    store.transition(active.request_id, "CANCELLED");
    await ctx.app.client.chat.postMessage({
      token: ctx.botToken,
      channel: event.channel,
      thread_ts,
      text: "Cancelled. Nothing executed.",
    });
  } else if (signal.kind === "edit") {
    store.transition(active.request_id, "EDITING");
    const newPlan = await planner.replan(
      active.requester_message,
      active.final_plan!,
      signal.edit_text,
    );
    const diff = planner.renderDiff(active.final_plan!, newPlan);
    if (active.progress_ts) {
      await ctx.app.client.chat.update({
        token: ctx.botToken,
        channel: event.channel,
        ts: active.progress_ts,
        text: `${diff}\n\nReply **yes** to approve the revision, or describe another edit.`,
      });
    }
    store.setFinalPlan(active.request_id, newPlan);
    store.appendPlanHistory(active.request_id, {
      plan: newPlan,
      edit_text: signal.edit_text,
      ts: Date.now(),
    });
    store.transition(active.request_id, "AWAITING_APPROVAL");
  }
  // signal.kind === "ignore" → no-op
}

function renderPlanForApproval(plan: Plan): string {
  const lines = [
    `📋 *Plan:* _${plan.summary}_ (confidence ${Math.round(plan.confidence * 100)}%)`,
    "",
  ];
  plan.steps.forEach((s, i) => {
    lines.push(`${i + 1}. \`${s.action}\`${s.rationale ? ` — ${s.rationale}` : ""}`);
  });
  lines.push("", "Reply *yes* / *go* to approve, *no* / *cancel* to abort, or describe an edit.");
  return lines.join("\n");
}
