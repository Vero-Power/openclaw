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

export function createExternalContextObserver(_deps: ExternalContextObserverDeps): Observer {
  return {
    name: "external-context",
    async observe(_since: number): Promise<Omit<Observation, "id" | "created_at">[]> {
      return [];
    },
  };
}
