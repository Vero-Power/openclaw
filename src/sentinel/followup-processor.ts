import type { Database as DatabaseType } from "better-sqlite3";
import { z } from "zod";
import type { ConversationStore } from "./conversation-store.js";
import type { FollowupRow, FollowupStore } from "./followup-store.js";
import type { ChannelNameResolver } from "./slack-resolvers.js";

const DmPersonPayloadSchema = z.object({
  target_alias: z.string(),
  topic: z.string(),
  question_text: z.string(),
  context: z.string().optional(),
});

const TaskPayloadSchema = z.object({
  task_text: z.string(),
  context: z.string().optional(),
});

export interface SpawnTaskInput {
  taskText: string;
  context?: string;
  requesterUserId: string;
}

export interface FollowupProcessorDeps {
  store: FollowupStore;
  db: DatabaseType;
  conversationStore: ConversationStore;
  userAliases: Record<string, string>;
  dmUser?: (userId: string, text: string) => Promise<void>;
  channelResolver?: ChannelNameResolver;
  spawnTask?: (input: SpawnTaskInput) => Promise<void>;
}

export class FollowupProcessor {
  constructor(private deps: FollowupProcessorDeps) {}

  async processPending(): Promise<{ processed: number }> {
    const pending = this.deps.store.listPending();
    let processed = 0;
    for (const row of pending) {
      if (await this.claimAndProcess(row)) {
        processed += 1;
      }
    }
    return { processed };
  }

  // Processes a single just-filed row so chat replies don't stall behind a backlog;
  // the sentinel cycle drains the rest.
  async processById(id: number): Promise<void> {
    const row = this.deps.store.get(id);
    if (!row || row.status !== "pending") {
      return;
    }
    await this.claimAndProcess(row);
  }

  // Atomically claims the row before dispatch so the sentinel cycle and a chat-filed
  // processById can never both send the same DM. Non-terminal outcomes (collision,
  // missing dep) release the claim so the row retries with attempts unchanged.
  private async claimAndProcess(row: FollowupRow): Promise<boolean> {
    if (!this.deps.store.claim(row.id)) {
      return false;
    }
    try {
      const handled = await this.processOne(row);
      if (!handled) {
        this.deps.store.release(row.id);
      }
      return handled;
    } catch (err) {
      this.deps.store.recordFailure(row.id, (err as Error).message);
      return false;
    }
  }

  // Returns true when the row reached a terminal status; false when it stays pending
  // (collision or missing dep — retried on the next sentinel cycle).
  private async processOne(row: FollowupRow): Promise<boolean> {
    if (row.kind === "note") {
      this.deps.store.markDone(row.id);
      return true;
    }

    if (row.kind === "dm_person") {
      const parsed = DmPersonPayloadSchema.safeParse(row.payload);
      if (!parsed.success) {
        this.deps.store.markSkipped(row.id, "malformed dm_person payload");
        return true;
      }
      const alias = parsed.data.target_alias.toLowerCase();
      const targetUserId = this.deps.userAliases[alias];
      if (!targetUserId) {
        this.deps.store.markSkipped(row.id, `unknown alias: ${alias}`);
        return true;
      }
      const optedOut = this.deps.db
        .prepare(`SELECT 1 FROM opt_outs WHERE scope = 'global' AND person_user_id = ?`)
        .get(targetUserId);
      if (optedOut) {
        this.deps.store.markSkipped(row.id, `target opted out: ${alias}`);
        return true;
      }
      if (this.deps.conversationStore.findOpenForPerson(targetUserId)) {
        // Collision: one open conversation per person. Stays pending for the next cycle.
        return false;
      }
      if (!this.deps.dmUser) {
        return false;
      }
      const rawText = parsed.data.context
        ? `${parsed.data.context}\n\n${parsed.data.question_text}`
        : parsed.data.question_text;
      const text = this.deps.channelResolver
        ? await this.deps.channelResolver.enrichText(rawText)
        : rawText;
      await this.deps.dmUser(targetUserId, text);
      this.deps.conversationStore.open({
        person_user_id: targetUserId,
        channel: targetUserId,
        topic: parsed.data.topic,
        opening_message: text,
      });
      this.deps.store.markDone(row.id);
      return true;
    }

    const parsed = TaskPayloadSchema.safeParse(row.payload);
    if (!parsed.success) {
      this.deps.store.markSkipped(row.id, "malformed task payload");
      return true;
    }
    if (!row.requester_user_id) {
      this.deps.store.markSkipped(row.id, "task followup has no requester");
      return true;
    }
    if (!this.deps.spawnTask) {
      return false;
    }
    await this.deps.spawnTask({
      taskText: parsed.data.task_text,
      context: parsed.data.context,
      requesterUserId: row.requester_user_id,
    });
    this.deps.store.markDone(row.id);
    return true;
  }
}
