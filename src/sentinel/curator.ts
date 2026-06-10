import { existsSync, mkdirSync, appendFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { LlmClient } from "../triage/llm-client.js";
import type { Insight } from "./types.js";

const RouteOutputSchema = z.object({
  relPath: z.string(),
});

const ROUTER_PROMPT_HEADER = `You are JR's library curator. Given an insight + the current library folder structure + EXISTING files in the candidate target folder, decide where the insight belongs.

Output JSON: { "relPath": "insights/patterns/<slug>.md" }

CRITICAL — prefer appending to an existing file over creating a new one.
- If any existing file in the target folder is on the SAME topic (matches the insight's subject), use its path. Multiple insights on the same topic should ACCUMULATE in one file, not proliferate as near-duplicates.
- Only propose a new slug when the insight is on a genuinely new topic that doesn't fit any existing file.

Rules for the path:
- pattern → insights/patterns/<slug>.md
- anomaly → insights/anomalies/<slug>.md
- friction → insights/friction/<slug>.md
- opportunity → insights/opportunities/<slug>.md
- people-related → people/<person-slug>.md
- project-related → projects/<project-slug>.md
- operations-related → operations/<topic-slug>.md
- thread-related → threads/<channel>/<topic-slug>.md
- new top-level folder is OK if no existing folder fits and the topic is clearly recurring

Slug rules: kebab-case, lowercase, descriptive, ≤ 50 chars. Stable across cycles (don't reshuffle word order to avoid the dedup check).

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

function categoryFolder(category: string): string {
  // Map insight category → subfolder name.
  if (category === "opportunity") {
    return "insights/opportunities";
  }
  if (category === "pattern" || category === "anomaly" || category === "friction") {
    return `insights/${category}s`;
  }
  return "insights/uncategorised";
}

function listExistingMarkdown(libPath: string, folder: string): string[] {
  const fullDir = join(libPath, folder);
  if (!existsSync(fullDir)) {
    return [];
  }
  try {
    return readdirSync(fullDir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith(".md"))
      .map((d) => d.name);
  } catch {
    return [];
  }
}

export class Curator {
  constructor(private llm: LlmClient) {}

  async fileInsight(
    insight: Omit<Insight, "id" | "filed_to">,
    libPath: string,
  ): Promise<{ filedTo: string }> {
    const candidateFolder = categoryFolder(insight.category);
    const existingFiles = listExistingMarkdown(libPath, candidateFolder);
    const existingBlock =
      existingFiles.length > 0
        ? `\n\nExisting files in ${candidateFolder}/ (prefer reusing one if it matches the insight's topic):\n${existingFiles.map((f) => `- ${candidateFolder}/${f}`).join("\n")}`
        : "";

    const prompt = `${ROUTER_PROMPT_HEADER}${existingBlock}\n\nInsight:\n  category: ${insight.category}\n  summary: ${insight.summary}\n  evidence: ${insight.evidence}\n  confidence: ${insight.confidence}\n\nJSON:`;

    let relPath: string;
    try {
      const raw = await this.llm.complete(prompt, { model: "gemini-flash", temperature: 0 });
      const stripped = raw.trim().replace(/^```(?:json)?\n?|\n?```$/g, "");
      const parsed = RouteOutputSchema.parse(JSON.parse(stripped));
      relPath = parsed.relPath;
    } catch {
      // Fallback to a deterministic path
      relPath = `${candidateFolder}/${slugify(insight.summary)}.md`;
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
