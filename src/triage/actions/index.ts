import { coperniqFirestoreIngestAction } from "./gcf/coperniq-firestore-ingest.js";
import { ActionRegistry } from "./registry.js";
import { createDmUserAction } from "./slack/dm-user.js";
import { createPostToChannelAction } from "./slack/post-to-channel.js";
import { createReplyInThreadAction } from "./slack/reply-in-thread.js";
import type { SlackClientLike } from "./slack/types.js";

export type { SlackClientLike } from "./slack/types.js";
export type { SlackMessageDeps } from "./slack/types.js";

/**
 * Optional deps for bootstrapping Slack messaging actions.
 * When absent (or when slackClient/botToken are not both provided)
 * the Slack messaging actions are not registered — backwards-compatible
 * with callers (e.g. Sentinel orchestrator) that have no Slack client.
 */
export interface ActionCatalogDeps {
  slackClient?: SlackClientLike;
  botToken?: string;
}

/**
 * Day-one action catalog. Other actions (remaining 5 gcf functions,
 * GitHub ops, Coperniq direct, notify shortcuts, filing, bash escape hatch)
 * are added in the follow-up plan `phase3-catalog-buildout.md`.
 */
export function bootstrapActionCatalog(deps: ActionCatalogDeps = {}): ActionRegistry {
  const reg = new ActionRegistry();
  reg.register(coperniqFirestoreIngestAction);
  if (deps.slackClient && deps.botToken) {
    const slackDeps = { client: deps.slackClient, token: deps.botToken };
    reg.register(createDmUserAction(slackDeps));
    reg.register(createPostToChannelAction(slackDeps));
    reg.register(createReplyInThreadAction(slackDeps));
  }
  return reg;
}

export { ActionRegistry } from "./registry.js";
export type { CatalogAction, ActionContext } from "./types.js";
