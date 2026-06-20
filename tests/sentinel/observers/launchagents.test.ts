import { describe, it, expect } from "vitest";
import { createLaunchAgentsObserver } from "../../../src/sentinel/observers/launchagents.js";

describe("launchagents observer", () => {
  it("emits only dormant labels when any openclaw job is idle", async () => {
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
    expect(r.metrics?.dormant).toBe(1);
    expect(r.data?.dormantLabels).toEqual(["ai.openclaw.coperniq-sync"]);
    expect(r.summary).toContain("1 of 3");
    expect(r.summary).toContain("ai.openclaw.coperniq-sync");
    expect(r.summary).not.toContain("com.openclaw.agent");
  });

  it("emits nothing when every matching job is running", async () => {
    const fakeOutput = `PID	Status	Label
1234	0	com.openclaw.agent
5678	0	com.veropwr.openclaw.dashboard-refresh
`;
    const obs = createLaunchAgentsObserver({
      execCommand: async () => fakeOutput,
      filterPrefix: "openclaw",
    });
    const results = await obs.observe(0);
    expect(results).toHaveLength(0);
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
