import { homedir } from "node:os";
import { join } from "node:path";
import { ConversationStore } from "../../sentinel/conversation-store.js";
import { openSentinelDb } from "../../sentinel/db.js";
import { FollowupProcessor, type SpawnTaskInput } from "../../sentinel/followup-processor.js";
import { FollowupStore, type InsertFollowupParams } from "../../sentinel/followup-store.js";
import { ChannelNameResolver } from "../../sentinel/slack-resolvers.js";
import { SLACK_USER_ALIASES } from "../../triage/actions/slack/aliases.js";
import type { SlackMonitorContext } from "./context.js";
import { spawnFollowupTask } from "./triage-bridge.js";

export function followupsEnabled(): boolean {
  return process.env.OPENCLAW_FOLLOWUPS === "1";
}

interface FollowupEngine {
  store: FollowupStore;
  processor: FollowupProcessor;
}

// Lazy singleton — only initialize when a follow-up actually gets filed.
let lazyEngine: FollowupEngine | null = null;

export function getFollowupEngine(ctx: SlackMonitorContext): FollowupEngine {
  if (!lazyEngine) {
    const db = openSentinelDb(join(homedir(), ".openclaw/sentinel.db"));
    const store = new FollowupStore(db);
    const conversationStore = new ConversationStore(db);
    const channelResolver = new ChannelNameResolver(ctx.app.client);
    const processor = new FollowupProcessor({
      store,
      db,
      conversationStore,
      userAliases: SLACK_USER_ALIASES,
      dmUser: async (userId: string, text: string) => {
        await ctx.app.client.chat.postMessage({ token: ctx.botToken, channel: userId, text });
      },
      channelResolver,
      spawnTask: (input: SpawnTaskInput) => spawnFollowupTask(input, ctx),
    });
    lazyEngine = { store, processor };
  }
  return lazyEngine;
}

// Files a follow-up and triggers immediate processing. Returns a short human
// description for the responder, or null on failure (caller must stay honest).
export async function fileAndProcessFollowup(
  ctx: SlackMonitorContext,
  params: InsertFollowupParams,
): Promise<string | null> {
  try {
    const { store, processor } = getFollowupEngine(ctx);
    const id = store.insert(params);
    await processor.processById(id);
    const row = store.get(id);
    if (!row || row.status === "skipped" || row.status === "failed") {
      return null;
    }
    return describeFollowup(params);
  } catch (err) {
    ctx.runtime.log(`[followups] filing failed: ${String(err)}`);
    return null;
  }
}

function payloadStr(value: unknown, fallback = "?"): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

function describeFollowup(params: InsertFollowupParams): string {
  if (params.kind === "dm_person") {
    const alias = payloadStr(params.payload.target_alias);
    const topic = payloadStr(params.payload.topic);
    return `queued a DM to ${alias} about ${topic}`;
  }
  if (params.kind === "note") {
    return `noted for the daily report: ${payloadStr(params.payload.text)}`;
  }
  return `queued a task — the requester will get a plan to approve: ${payloadStr(params.payload.task_text)}`;
}
