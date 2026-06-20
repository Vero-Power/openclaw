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
      let total = 0;
      const dormantLabels: string[] = [];
      for (const line of lines) {
        // launchctl list lines: PID  Status  Label  — tab-separated
        const cols = line.split(/\s+/).filter(Boolean);
        if (cols.length < 3) {
          continue;
        }
        total++;
        if (cols[0] === "-") {
          dormantLabels.push(cols[2]);
        }
      }
      if (dormantLabels.length === 0) {
        return [];
      }
      return [
        {
          source: "launchagents",
          topic: "openclaw-jobs-dormant",
          timestamp: Date.now(),
          summary: `${dormantLabels.length} of ${total} openclaw LaunchAgent jobs are dormant: ${dormantLabels.join(", ")}`,
          metrics: { total, dormant: dormantLabels.length },
          data: { dormantLabels },
        },
      ];
    },
  };
}
