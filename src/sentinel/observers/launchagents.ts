import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Observer } from "../observer.js";
import type { Observation } from "../types.js";

const execFileP = promisify(execFile);

export interface LaunchAgentsObserverDeps {
  filterPrefix: string;
  execCommand?: () => Promise<string>;
}

export function createLaunchAgentsObserver(deps: LaunchAgentsObserverDeps): Observer {
  const exec =
    deps.execCommand ??
    (async () => {
      const { stdout } = await execFileP("launchctl", ["list"]);
      return stdout;
    });

  return {
    name: "launchagents",
    async observe(_since: number): Promise<Omit<Observation, "id" | "created_at">[]> {
      let output: string;
      try {
        output = await exec();
      } catch {
        return [];
      }
      const lines = output.split("\n").filter((l) => l.includes(deps.filterPrefix));
      let running = 0;
      let dormant = 0;
      const labels: string[] = [];
      for (const line of lines) {
        // launchctl list lines: PID  Status  Label  — tab-separated
        const cols = line.split(/\s+/).filter(Boolean);
        if (cols.length < 3) {
          continue;
        }
        const pid = cols[0];
        labels.push(cols[2]);
        if (pid === "-") {
          dormant++;
        } else {
          running++;
        }
      }
      const total = running + dormant;
      if (total === 0) {
        return [];
      }
      return [
        {
          source: "launchagents",
          topic: "openclaw-jobs",
          timestamp: Date.now(),
          summary: `${total} openclaw LaunchAgent jobs (${running} running, ${dormant} dormant): ${labels.join(", ")}`,
          metrics: { total, running, dormant },
          data: { labels },
        },
      ];
    },
  };
}
