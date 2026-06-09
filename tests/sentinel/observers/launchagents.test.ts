import { describe, it, expect } from "vitest";
import { createLaunchAgentsObserver } from "../../../src/sentinel/observers/launchagents.js";

describe("launchagents observer", () => {
  it("parses launchctl list output and emits per-agent metrics", async () => {
    const fakeOutput = `PID	Status	Label
1234	0	com.openclaw.agent
-	0	ai.openclaw.coperniq-sync
5678	0	com.veropwr.openclaw.dashboard-refresh
`;
    const obs = createLaunchAgentsObserver({
      execCommand: async () => fakeOutput,
      filterPrefix: "openclaw",
    });
    const results = await obs.observe(0);
    expect(results).toHaveLength(1);
    const r = results[0];
    expect(r.metrics?.total).toBe(3);
    expect(r.metrics?.running).toBe(2);
    expect(r.metrics?.dormant).toBe(1);
  });

  it("handles execCommand failure gracefully", async () => {
    const obs = createLaunchAgentsObserver({
      execCommand: async () => {
        throw new Error("launchctl missing");
      },
      filterPrefix: "openclaw",
    });
    const results = await obs.observe(0);
    expect(results).toHaveLength(0);
  });
});
