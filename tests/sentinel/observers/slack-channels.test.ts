import { describe, it, expect, vi } from "vitest";
import { createSlackChannelsObserver } from "../../../src/sentinel/observers/slack-channels.js";

describe("slack-channels observer", () => {
  it("emits one observation per channel with message count metric", async () => {
    const fakeClient = {
      conversations: {
        history: vi.fn(async ({ channel: _channel }: { channel: string }) => ({
          ok: true,
          messages: [
            { user: "U1", text: "hi", ts: "1.0" },
            { user: "U2", text: "bye", ts: "2.0" },
            { user: "U1", text: "wait", ts: "3.0" },
          ],
        })),
      },
    };
    const obs = createSlackChannelsObserver({
      client: fakeClient as never,
      allowedChannels: ["C111", "C222"],
    });
    const results = await obs.observe(Date.now() - 60 * 60 * 1000);
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.metrics?.message_count).toBe(3);
      expect(r.metrics?.unique_senders).toBe(2);
    }
  });

  it("skips channels that error and reports the rest", async () => {
    const fakeClient = {
      conversations: {
        history: vi.fn(async ({ channel }: { channel: string }) => {
          if (channel === "C_BAD") {
            throw new Error("not in channel");
          }
          return { ok: true, messages: [{ user: "U1", text: "hi", ts: "1.0" }] };
        }),
      },
    };
    const obs = createSlackChannelsObserver({
      client: fakeClient as never,
      allowedChannels: ["C_BAD", "C_OK"],
    });
    const results = await obs.observe(0);
    expect(results).toHaveLength(1);
    expect(results[0].topic).toContain("C_OK");
  });
});
