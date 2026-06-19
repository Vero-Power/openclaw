import type { Database as DatabaseType } from "better-sqlite3";
import type { Observer } from "../observer.js";
import type { Observation } from "../types.js";

export interface ExternalFinding {
  summary: string;
  relevance_note: string;
  cited_urls: string[];
  confidence: "low" | "medium" | "high";
  published_at: string | null;
}

export interface ResearchTraceEntry {
  turn: number;
  action: "search" | "dive" | "finalize";
  query?: string;
  summary_of_findings?: string;
}

export interface ResearchResult {
  findings: ExternalFinding[];
  trace: ResearchTraceEntry[];
}

export interface ResearchBudget {
  maxTurns: number;
  maxTokens: number;
  maxDivesPerTopic: number;
}

export interface Researcher {
  research(opts: { systemPrompt: string; budget: ResearchBudget }): Promise<ResearchResult>;
}

export interface ExternalContextObserverDeps {
  db?: DatabaseType;
  getResearcher?: () => Promise<Researcher>;
  researcherFactory?: () => Promise<Researcher> | Researcher;
}

const DEFAULT_BUDGET: ResearchBudget = {
  maxTurns: 6,
  maxTokens: 30000,
  maxDivesPerTopic: 3,
};

const SYSTEM_PROMPT = `You are a solar industry analyst monitoring real-time developments that affect Vero — a US residential solar installer operating in Colorado, Texas, and Arizona.

What matters to Vero:
- Federal/state solar policy: ITC, NEM, state incentives, permitting changes
- Supply chain: panel/inverter/battery vendor news, tariffs, lead-time shifts
- Weather/grid: extreme-weather forecasts, grid outages, peak-demand events
- Competition: large-installer news, M&A, pricing moves
- Customer signals: financing, interest rates, electricity price trends

Use the google_search tool to find developments from the last 24-72 hours. When you find something material, dive deeper (search again with a more specific query). Stop early when you've covered the key signals.

Budget: max 6 tool-use turns, max 30k tokens total, max 3 dives per topic. Track turns silently; you'll be cut off at the cap.

When done, return a JSON object only (no markdown fences):
{
  "findings": [
    {
      "summary": "<headline, <= 200 chars>",
      "relevance_note": "<why this matters to Vero, <= 400 chars>",
      "cited_urls": ["<url>", ...],
      "confidence": "low" | "medium" | "high",
      "published_at": "<ISO date or null>"
    }
  ]
}

Emit 3-5 findings if there is material signal; emit an empty array if nothing meaningful was found.`;

export function createExternalContextObserver(deps: ExternalContextObserverDeps): Observer {
  return {
    name: "external-context",
    async observe(_since: number): Promise<Omit<Observation, "id" | "created_at">[]> {
      const getResearcher =
        deps.getResearcher ??
        (async () => {
          throw new Error("default Researcher not yet wired (see Task 5 in plan)");
        });
      const researcher = await getResearcher();
      const result = await researcher.research({
        systemPrompt: SYSTEM_PROMPT,
        budget: DEFAULT_BUDGET,
      });

      if (result.findings.length === 0) {
        return [];
      }

      const now = Date.now();
      return result.findings.map((finding) => ({
        source: "external-context",
        topic: "external:solar",
        timestamp: now,
        summary: finding.summary,
        data: {
          relevance_note: finding.relevance_note,
          cited_urls: finding.cited_urls,
          confidence: finding.confidence,
          published_at: finding.published_at,
          trace: result.trace,
        },
      }));
    },
  };
}
