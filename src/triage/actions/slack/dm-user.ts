import { z } from "zod";
import type { CatalogAction } from "../types.js";
import type { SlackMessageDeps } from "./types.js";

const ArgsSchema = z.object({
  user_id: z.string().min(1).describe("Slack user ID, e.g. U07KRVD2867"),
  text: z.string().min(1).describe("Message text to send"),
});

type Args = z.infer<typeof ArgsSchema>;

export function createDmUserAction(deps: SlackMessageDeps): CatalogAction<Args, { ok: boolean }> {
  return {
    name: "dm_user",
    description: "Send a direct message to a specific Slack user by their user ID.",
    args_schema: ArgsSchema,
    idempotent: false,
    external_effect: true,
    invoke: async (args, ctx) => {
      ctx.logger.info("dm_user: opening DM channel", {
        request_id: ctx.request_id,
        user_id: args.user_id,
      });
      const opened = await deps.client.conversations.open({
        token: deps.token,
        users: args.user_id,
      });
      const channelId = opened.channel?.id;
      if (!channelId) {
        throw new Error(`dm_user: could not open DM channel for user ${args.user_id}`);
      }
      await deps.client.chat.postMessage({
        token: deps.token,
        channel: channelId,
        text: args.text,
      });
      ctx.logger.info("dm_user: sent", { request_id: ctx.request_id, user_id: args.user_id });
      return { ok: true };
    },
  };
}
