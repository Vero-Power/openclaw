import type { Database as DatabaseType } from "better-sqlite3";
import type { Observer } from "../observer.js";
import type { Observation } from "../types.js";
import {
  buildCompanyContext,
  createDefaultCompanyContextClient,
} from "./external-context/company-context.js";
import { buildRecentResearchContext } from "./external-context/recent-research.js";

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
  db: DatabaseType;
  getResearcher?: () => Promise<Researcher>;
  researcherFactory?: () => Promise<Researcher> | Researcher;
  timeoutMs?: number;
  companyContextFn?: () => Promise<string>;
  recentResearchFn?: () => string;
}

const DEFAULT_BUDGET: ResearchBudget = {
  maxTurns: 6,
  maxTokens: 30000,
  maxDivesPerTopic: 3,
};

const DEFAULT_TIMEOUT_MS = 90_000;

const RECENT_RESEARCH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const GEMINI_MODEL = "gemini-2.5-flash";

async function defaultResearcherFactory(): Promise<Researcher> {
  const { GoogleGenAI } = await import("@google/genai");
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not set; cannot construct default external-context Researcher");
  }
  const client = new GoogleGenAI({ apiKey });

  return {
    async research(opts): Promise<ResearchResult> {
      const trace: ResearchTraceEntry[] = [];
      let tokensConsumed = 0;
      let turn = 0;

      const tools = [{ googleSearch: {} }];

      // Multi-turn loop. Gemini handles google_search execution natively;
      // we just send the conversation history and read back the model's reply.
      // Conversation starts with the system prompt as the first user turn
      // (Gemini doesn't have a separate system role for this SDK shape).
      type Content = { role: "user" | "model"; parts: Array<{ text: string }> };
      const history: Content[] = [{ role: "user", parts: [{ text: opts.systemPrompt }] }];

      let finalText: string | null = null;
      while (turn < opts.budget.maxTurns && tokensConsumed < opts.budget.maxTokens) {
        turn++;
        const response = await client.models.generateContent({
          model: GEMINI_MODEL,
          contents: history,
          config: { tools },
        });

        const usage = response.usageMetadata;
        if (usage) {
          tokensConsumed += usage.totalTokenCount ?? 0;
        }

        const candidate = response.candidates?.[0];
        const text =
          candidate?.content?.parts
            ?.map((p) =>
              typeof p === "object" && p !== null && "text" in p
                ? ((p as { text?: string }).text ?? "")
                : "",
            )
            .join("") ?? "";

        // Capture grounding queries if present
        const groundingQueries = candidate?.groundingMetadata?.webSearchQueries ?? [];
        if (groundingQueries.length > 0) {
          for (const q of groundingQueries) {
            trace.push({ turn, action: "search", query: q });
          }
        }

        // Treat any text that contains a JSON object with a top-level "findings"
        // array as the final answer.
        const finalMatch = text.match(/\{[\s\S]*"findings"[\s\S]*\}/);
        if (finalMatch) {
          finalText = finalMatch[0];
          trace.push({ turn, action: "finalize" });
          break;
        }

        // Otherwise treat the model reply as an intermediate "summary of findings"
        // step and append to history so the loop continues. (Gemini already
        // ran the search natively; we just feed the model's text back.)
        if (text.trim().length > 0) {
          history.push({ role: "model", parts: [{ text }] });
          // Nudge the model to either dive or finalize.
          history.push({
            role: "user",
            parts: [
              {
                text: "Continue. Either issue another targeted google_search query if you found something material to dive into, or return your final JSON findings now.",
              },
            ],
          });
        } else {
          // No text at all — stop to avoid infinite loop.
          break;
        }
      }

      if (!finalText) {
        // Budget exhausted before final JSON. Return empty findings; trace records what happened.
        return { findings: [], trace };
      }

      let parsed: { findings: ExternalFinding[] };
      try {
        parsed = JSON.parse(finalText) as { findings: ExternalFinding[] };
      } catch {
        throw new Error("external-context: final JSON could not be parsed");
      }

      if (!Array.isArray(parsed.findings)) {
        throw new Error("external-context: final JSON missing findings array");
      }

      return { findings: parsed.findings, trace };
    },
  };
}

function buildSystemPrompt(companyContext: string, recentResearch: string): string {
  return `You are a solar industry analyst working for Vero.

${companyContext}

${recentResearch}

Use the google_search tool to find developments affecting Vero NOW. Prioritize signal relevant to the company's actual operating geography from the snapshot above. Don't re-search topics in the recent-research list unless there is a material update. Federal/national signal is fine when broadly relevant.

What categories matter:
- Federal/state solar policy: ITC, NEM, state incentives, permitting
- Supply chain: panel/inverter/battery vendor news, tariffs, lead times
- Weather/grid: extreme-weather forecasts, ERCOT events, grid outages
- Competition: large-installer news, M&A, pricing
- Customer signals: financing rates, electricity prices

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
}

export function createExternalContextObserver(deps: ExternalContextObserverDeps): Observer {
  let cachedResearcher: Researcher | null = null;

  async function resolveResearcher(): Promise<Researcher> {
    if (deps.getResearcher) {
      return deps.getResearcher();
    }
    if (cachedResearcher) {
      return cachedResearcher;
    }
    const factory = deps.researcherFactory ?? defaultResearcherFactory;
    cachedResearcher = await factory();
    return cachedResearcher;
  }

  return {
    name: "external-context",
    async observe(_since: number): Promise<Omit<Observation, "id" | "created_at">[]> {
      const researcher = await resolveResearcher();
      const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

      const companyContextFn =
        deps.companyContextFn ??
        (async () => {
          const client = await createDefaultCompanyContextClient();
          return buildCompanyContext({ client });
        });
      const recentResearchFn =
        deps.recentResearchFn ??
        (() => buildRecentResearchContext(deps.db, RECENT_RESEARCH_WINDOW_MS));

      const [companyContext, recentResearch] = await Promise.all([
        companyContextFn(),
        Promise.resolve(recentResearchFn()),
      ]);

      const systemPrompt = buildSystemPrompt(companyContext, recentResearch);

      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`external-context observer timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      });

      let result: ResearchResult;
      try {
        result = await Promise.race([
          researcher.research({ systemPrompt, budget: DEFAULT_BUDGET }),
          timeoutPromise,
        ]);
      } finally {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
      }

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
