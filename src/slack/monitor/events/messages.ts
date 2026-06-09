import type { SlackEventMiddlewareArgs } from "@slack/bolt";
import { danger } from "../../../globals.js";
import { enqueueSystemEvent } from "../../../infra/system-events.js";
import type {
  ConversationReplyEvent,
  ConversationReplyCtx,
  ConversationReplyDeps,
} from "../../../sentinel/conversation-handler.js";
import { handleConversationReply } from "../../../sentinel/conversation-handler.js";
import { slackMessageGate } from "../../../triage/gate.js";
import type { SlackMessageEvent } from "../../types.js";
import { resolveSlackChannelLabel } from "../channel-config.js";
import type { SlackMonitorContext } from "../context.js";
import type { SlackMessageHandler } from "../message-handler.js";
import { runTriagePipeline, handleThreadReplyForActiveTriage } from "../triage-bridge.js";
import type {
  SlackMessageChangedEvent,
  SlackMessageDeletedEvent,
  SlackThreadBroadcastEvent,
} from "../types.js";

export function registerSlackMessageEvents(params: {
  ctx: SlackMonitorContext;
  handleSlackMessage: SlackMessageHandler;
  conversationReplyDeps?: ConversationReplyDeps;
}) {
  const { ctx, handleSlackMessage, conversationReplyDeps } = params;

  const resolveSlackChannelSystemEventTarget = async (channelId: string | undefined) => {
    const channelInfo = channelId ? await ctx.resolveChannelName(channelId) : {};
    const channelType = channelInfo?.type;
    if (
      !ctx.isChannelAllowed({
        channelId,
        channelName: channelInfo?.name,
        channelType,
      })
    ) {
      return null;
    }

    const label = resolveSlackChannelLabel({
      channelId,
      channelName: channelInfo?.name,
    });
    const sessionKey = ctx.resolveSlackSystemEventSessionKey({
      channelId,
      channelType,
    });

    return { channelInfo, channelType, label, sessionKey };
  };

  ctx.app.event("message", async ({ event, body }: SlackEventMiddlewareArgs<"message">) => {
    try {
      if (ctx.shouldDropMismatchedSlackEvent(body)) {
        return;
      }

      const message = event as SlackMessageEvent;
      ctx.runtime.log(
        `[DIAG msg-handler] ts=${message.ts ?? "?"} subtype=${message.subtype ?? "none"} channel=${message.channel} user=${message.user ?? "?"} text="${(message.text ?? "").slice(0, 40)}"`,
      );
      if (message.subtype === "message_changed") {
        const changed = event as SlackMessageChangedEvent;
        const channelId = changed.channel;
        const target = await resolveSlackChannelSystemEventTarget(channelId);
        if (!target) {
          return;
        }
        const messageId = changed.message?.ts ?? changed.previous_message?.ts;
        enqueueSystemEvent(`Slack message edited in ${target.label}.`, {
          sessionKey: target.sessionKey,
          contextKey: `slack:message:changed:${channelId ?? "unknown"}:${messageId ?? changed.event_ts ?? "unknown"}`,
        });
        return;
      }
      if (message.subtype === "message_deleted") {
        const deleted = event as SlackMessageDeletedEvent;
        const channelId = deleted.channel;
        const target = await resolveSlackChannelSystemEventTarget(channelId);
        if (!target) {
          return;
        }
        enqueueSystemEvent(`Slack message deleted in ${target.label}.`, {
          sessionKey: target.sessionKey,
          contextKey: `slack:message:deleted:${channelId ?? "unknown"}:${deleted.deleted_ts ?? deleted.event_ts ?? "unknown"}`,
        });
        return;
      }
      if (message.subtype === "thread_broadcast") {
        const thread = event as SlackThreadBroadcastEvent;
        const channelId = thread.channel;
        const target = await resolveSlackChannelSystemEventTarget(channelId);
        if (!target) {
          return;
        }
        const messageId = thread.message?.ts ?? thread.event_ts;
        enqueueSystemEvent(`Slack thread reply broadcast in ${target.label}.`, {
          sessionKey: target.sessionKey,
          contextKey: `slack:thread:broadcast:${channelId ?? "unknown"}:${messageId ?? "unknown"}`,
        });
        return;
      }

      // Conversation reply routing: check for an active sentinel inquiry conversation for this
      // person BEFORE the triage gate. This ensures a person replying to JR's DM is handled
      // as a conversation reply rather than being re-triaged as a new task.
      if (
        conversationReplyDeps &&
        message.user &&
        message.channel?.startsWith("D") &&
        !message.subtype
      ) {
        const replyEvent: ConversationReplyEvent = {
          user: message.user,
          channel: message.channel,
          text: message.text ?? "",
          ts: message.ts ?? String(Date.now() / 1000),
        };
        const replyCtx: ConversationReplyCtx = { botUserId: ctx.botUserId };
        const consumed = await handleConversationReply(replyEvent, replyCtx, conversationReplyDeps);
        if (consumed) {
          return;
        }
      }

      // TODO(Task 6): triage gate — guarded by OPENCLAW_TRIAGE_REIMPL=1 feature flag
      if (message.thread_ts && message.thread_ts !== message.ts) {
        // Thread reply: check for active triage approval signal first.
        // If the handler consumed the message (returned true), stop here — do NOT
        // fall through to the gate, which would create a duplicate triage session.
        const consumed = await handleThreadReplyForActiveTriage(message, ctx);
        if (consumed) {
          return;
        }
      }
      const gateResult = slackMessageGate({
        user: message.user ?? "",
        bot_id: message.bot_id,
        channel: message.channel,
        text: message.text ?? "",
        jr_user_id: ctx.botUserId,
        allowed_channels: ["*"],
      });
      if (gateResult.eligible) {
        await runTriagePipeline(message, ctx);
        return;
      }

      await handleSlackMessage(message, { source: "message" });
    } catch (err) {
      ctx.runtime.error?.(danger(`slack handler failed: ${String(err)}`));
    }
  });
}
