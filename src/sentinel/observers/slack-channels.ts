import type { Observer } from "../observer.js";
import type { Observation } from "../types.js";

interface SlackHistoryResp {
  ok: boolean;
  messages?: Array<{ user?: string; text?: string; ts?: string }>;
}

interface SlackClientLike {
  conversations: {
    history(args: { channel: string; oldest?: string; limit?: number }): Promise<SlackHistoryResp>;
  };
}

export interface SlackChannelsObserverDeps {
  client: SlackClientLike;
  allowedChannels: string[];
}

export function createSlackChannelsObserver(deps: SlackChannelsObserverDeps): Observer {
  return {
    name: "slack-channels",
    async observe(since: number): Promise<Omit<Observation, "id" | "created_at">[]> {
      const now = Date.now();
      const oldestEpoch = (since / 1000).toFixed(6);
      const results: Omit<Observation, "id" | "created_at">[] = [];

      const tasks = deps.allowedChannels.map(async (channel) => {
        try {
          const resp = await deps.client.conversations.history({
            channel,
            oldest: oldestEpoch,
            limit: 200,
          });
          const msgs = resp.messages ?? [];
          const messageCount = msgs.length;
          const senders = new Set<string>();
          for (const m of msgs) {
            if (m.user) {
              senders.add(m.user);
            }
          }
          results.push({
            source: "slack-channels",
            topic: `channel:${channel}`,
            timestamp: now,
            summary: `${messageCount} messages from ${senders.size} unique senders in ${channel} since ${new Date(since).toISOString()}`,
            metrics: {
              message_count: messageCount,
              unique_senders: senders.size,
            },
            data: { channel },
          });
        } catch {
          // Skip on error, observer-runner handles the broader error path
        }
      });

      await Promise.all(tasks);
      return results;
    },
  };
}
