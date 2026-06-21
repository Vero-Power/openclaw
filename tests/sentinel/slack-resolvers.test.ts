import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ChannelNameResolver,
  type ConversationsInfoClient,
} from "../../src/sentinel/slack-resolvers.js";

type InfoFn = (args: { channel: string }) => Promise<{
  ok: boolean;
  channel?: { id?: string; name?: string; is_archived?: boolean };
  error?: string;
}>;

function makeClient(handler: InfoFn): { client: ConversationsInfoClient; infoSpy: InfoFn } {
  const infoSpy = vi.fn(handler);
  const client: ConversationsInfoClient = {
    conversations: { info: infoSpy },
  };
  return { client, infoSpy };
}

describe("ChannelNameResolver", () => {
  describe("resolve()", () => {
    it("resolves a channel name on first call", async () => {
      const { client, infoSpy } = makeClient(async ({ channel }) => ({
        ok: true,
        channel: { id: channel, name: "general" },
      }));
      const resolver = new ChannelNameResolver(client);
      const name = await resolver.resolve("C01234ABCD");
      expect(name).toBe("general");
      expect(infoSpy).toHaveBeenCalledOnce();
    });

    it("caches result — second call does not hit the client", async () => {
      const { client, infoSpy } = makeClient(async ({ channel }) => ({
        ok: true,
        channel: { id: channel, name: "engineering" },
      }));
      const resolver = new ChannelNameResolver(client);
      await resolver.resolve("C01234ABCD");
      const name = await resolver.resolve("C01234ABCD");
      expect(name).toBe("engineering");
      expect(infoSpy).toHaveBeenCalledOnce();
    });

    it("caches null when API returns not_found", async () => {
      const { client, infoSpy } = makeClient(async () => ({
        ok: false,
        error: "channel_not_found",
      }));
      const resolver = new ChannelNameResolver(client);
      const first = await resolver.resolve("C09999ZZZZ");
      const second = await resolver.resolve("C09999ZZZZ");
      expect(first).toBeNull();
      expect(second).toBeNull();
      // Should only have called API once even though result was null
      expect(infoSpy).toHaveBeenCalledOnce();
    });

    it("handles client.conversations.info throwing — returns null and caches null", async () => {
      const { client, infoSpy } = makeClient(async () => {
        throw new Error("network error");
      });
      const resolver = new ChannelNameResolver(client);
      const first = await resolver.resolve("C08888AAAA");
      const second = await resolver.resolve("C08888AAAA");
      expect(first).toBeNull();
      expect(second).toBeNull();
      // Only one throw — second call uses cache
      expect(infoSpy).toHaveBeenCalledOnce();
    });
  });

  describe("enrichText()", () => {
    let client: ConversationsInfoClient;
    let infoSpy: InfoFn;
    let resolver: ChannelNameResolver;

    beforeEach(() => {
      const made = makeClient(async ({ channel }) => {
        if (channel === "C0AT0FZTN85") {
          return { ok: true, channel: { id: channel, name: "team-alerts" } };
        }
        if (channel === "C0ASFTRALH5") {
          return { ok: true, channel: { id: channel, name: "deployments" } };
        }
        return { ok: false, error: "channel_not_found" };
      });
      client = made.client;
      infoSpy = made.infoSpy;
      resolver = new ChannelNameResolver(client);
    });

    it("replaces bare CXXX tokens with <#CXXX|name>", async () => {
      const result = await resolver.enrichText("Check C0AT0FZTN85 for alerts");
      expect(result).toBe("Check <#C0AT0FZTN85|team-alerts> for alerts");
    });

    it("leaves text unchanged when no channel IDs present", async () => {
      const text = "No channel references here, just regular text";
      const result = await resolver.enrichText(text);
      expect(result).toBe(text);
      expect(infoSpy).not.toHaveBeenCalled();
    });

    it("falls back to <#CXXX> when resolver returns null", async () => {
      const result = await resolver.enrichText("See C0UNKNOWNID for details");
      expect(result).toBe("See <#C0UNKNOWNID> for details");
    });

    it("handles mixed #CXXX and <#CXXX> syntax in same text", async () => {
      const text = "See #C0AT0FZTN85 and <#C0ASFTRALH5> for info";
      const result = await resolver.enrichText(text);
      expect(result).toBe("See <#C0AT0FZTN85|team-alerts> and <#C0ASFTRALH5|deployments> for info");
    });
  });

  describe("enrichTextForPrompt()", () => {
    let resolver: ChannelNameResolver;

    beforeEach(() => {
      const made = makeClient(async ({ channel }) => {
        if (channel === "C0AT0FZTN85") {
          return { ok: true, channel: { id: channel, name: "team-alerts" } };
        }
        return { ok: false, error: "channel_not_found" };
      });
      resolver = new ChannelNameResolver(made.client);
    });

    it("replaces known channel IDs with #name", async () => {
      const result = await resolver.enrichTextForPrompt("Check C0AT0FZTN85 for alerts");
      expect(result).toBe("Check #team-alerts for alerts");
    });

    it("describes unknown channel IDs concretely instead of leaving raw IDs", async () => {
      const result = await resolver.enrichTextForPrompt("See C0UNKNOWNID for details");
      expect(result).toBe("See unnamed-channel-C0UNKNOWNID (bot has no access) for details");
    });

    it("mixes known + unknown in a single pass", async () => {
      const result = await resolver.enrichTextForPrompt(
        "Activity in C0AT0FZTN85 and C0PRIVATEAA dropped",
      );
      expect(result).toBe(
        "Activity in #team-alerts and unnamed-channel-C0PRIVATEAA (bot has no access) dropped",
      );
    });
  });
});
