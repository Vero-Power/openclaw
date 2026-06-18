import { z } from "zod";
import type { CatalogAction } from "../types.js";
import type { SlackMessageDeps } from "./types.js";

const ArgsSchema = z.object({
  channel_id: z.string().min(1).describe("Slack channel ID, e.g. C0123456789"),
  text: z.string().min(1).describe("Message text to post"),
});

type Args = z.infer<typeof ArgsSchema>;

export function createPostToChannelAction(
  deps: SlackMessageDeps,
): CatalogAction<Args, { ok: boolean }> {
  return {
    name: "post_to_channel",
    description:
      "Post a message in a specific Slack channel. Required args: { channel_id: string (Slack channel ID like 'C0AB50H2K9R'), text: string (the actual message content — compose from the operator's instruction, do NOT leave empty) }.",
    args_schema: ArgsSchema,
    idempotent: false,
    external_effect: true,
    invoke: async (args, ctx) => {
      ctx.logger.info("post_to_channel: posting", {
        request_id: ctx.request_id,
        channel_id: args.channel_id,
      });
      await deps.client.chat.postMessage({
        token: deps.token,
        channel: args.channel_id,
        text: args.text,
      });
      ctx.logger.info("post_to_channel: sent", {
        request_id: ctx.request_id,
        channel_id: args.channel_id,
      });
      return { ok: true };
    },
  };
}
