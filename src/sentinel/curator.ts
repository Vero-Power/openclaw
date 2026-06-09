import { existsSync, mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { LlmClient } from "../triage/llm-client.js";
import type { Insight } from "./types.js";

const RouteOutputSchema = z.object({
  relPath: z.string(),
});

const ROUTER_PROMPT = `You are JR's library curator. Given an insight + the current library folder structure, decide where the insight should be filed.

Output JSON: { "relPath": "insights/patterns/<slug>.md" }

Rules:
- pattern → insights/patterns/<slug>.md
- anomaly → insights/anomalies/<slug>.md
- friction → insights/friction/<slug>.md
- opportunity → insights/opportunities/<slug>.md
- people-related → people/<person-slug>.md
- project-related → projects/<project-slug>.md
- operations-related → operations/<topic-slug>.md
- thread-related → threads/<channel>/<topic-slug>.md
- new top-level folder is OK if no existing folder fits and the topic is clearly recurring

Slug rules: kebab-case, lowercase, descriptive, ≤ 50 chars.

No markdown fences. JSON only.`;

function slugify(text: string, max = 50): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, max) || "untitled"
  );
}

export class Curator {
  constructor(private llm: LlmClient) {}

  async fileInsight(
    insight: Omit<Insight, "id" | "filed_to">,
    libPath: string,
  ): Promise<{ filedTo: string }> {
    const prompt = `${ROUTER_PROMPT}\n\nInsight:\n  category: ${insight.category}\n  summary: ${insight.summary}\n  evidence: ${insight.evidence}\n  confidence: ${insight.confidence}\n\nJSON:`;

    let relPath: string;
    try {
      const raw = await this.llm.complete(prompt, { model: "gemini-flash", temperature: 0 });
      const stripped = raw.trim().replace(/^```(?:json)?\n?|\n?```$/g, "");
      const parsed = RouteOutputSchema.parse(JSON.parse(stripped));
      relPath = parsed.relPath;
    } catch {
      // Fallback to a deterministic path
      const folder = insight.category === "opportunity" ? "opportunities" : `${insight.category}s`;
      relPath = `insights/${folder}/${slugify(insight.summary)}.md`;
    }

    // Sanitize the path — strip any leading slashes, normalize separators
    relPath = relPath.replace(/^\/+/, "").replace(/\\/g, "/");

    const fullPath = join(libPath, relPath);
    mkdirSync(dirname(fullPath), { recursive: true });

    const fmBlock = `---\ntitle: ${insight.summary.slice(0, 80)}\nsummary: ${insight.summary.slice(0, 150)}\ntags: [${insight.category}]\n---\n\n`;
    const sectionDate = new Date(insight.generated_at).toISOString().slice(0, 10);
    const section = `## ${sectionDate}\n\n**${insight.summary}**\n\n_Confidence: ${insight.confidence.toFixed(2)}_\n\n${insight.evidence}\n\n_Derived from observations: ${insight.derived_from.join(", ") || "(none)"}_\n\n`;

    if (existsSync(fullPath)) {
      appendFileSync(fullPath, section);
    } else {
      writeFileSync(fullPath, fmBlock + section);
    }

    return { filedTo: relPath };
  }
}
