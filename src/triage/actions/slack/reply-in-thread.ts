import { z } from "zod";
import type { CatalogAction } from "../types.js";
import type { SlackMessageDeps } from "./types.js";

const ArgsSchema = z.object({
  channel: z.string().min(1).describe("Slack channel ID where the thread lives"),
  thread_ts: z.string().min(1).describe("Timestamp of the parent message to reply under"),
  text: z.string().min(1).describe("Message text to post as a reply"),
});

type Args = z.infer<typeof ArgsSchema>;

export function createReplyInThreadAction(
  deps: SlackMessageDeps,
): CatalogAction<Args, { ok: boolean }> {
  return {
    name: "reply_in_thread",
    description: "Reply in a specific Slack thread.",
    args_schema: ArgsSchema,
    idempotent: false,
    external_effect: true,
    invoke: async (args, ctx) => {
      ctx.logger.info("reply_in_thread: posting reply", {
        request_id: ctx.request_id,
        channel: args.channel,
        thread_ts: args.thread_ts,
      });
      await deps.client.chat.postMessage({
        token: deps.token,
        channel: args.channel,
        thread_ts: args.thread_ts,
        text: args.text,
      });
      ctx.logger.info("reply_in_thread: sent", {
        request_id: ctx.request_id,
        channel: args.channel,
      });
      return { ok: true };
    },
  };
}
