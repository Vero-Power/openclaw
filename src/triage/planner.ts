import type { Database as DatabaseType } from "better-sqlite3";
import type { ActionRegistry } from "./actions/registry.js";
import type { LlmClient } from "./llm-client.js";
import { PlanSchema, type Plan } from "./types.js";

const SYSTEM_PROMPT_HEADER = `You are JR's planner. Given a user request and the action catalog below, produce a JSON plan.

The plan is a sequential list of catalog actions. ONLY use actions in the catalog. Validate that args match each action's schema (you'll see args described in the catalog). If the catalog can't satisfy the request, propose a plan whose final step is a notify_* action to escalate.

Return JSON only:
{
  "summary": "one-sentence what this plan does",
  "confidence": number 0-1 — your confidence the plan answers the request,
  "steps": [{ "action": "action_name", "args": {...}, "rationale": "why this step" }]
}

No markdown fences, no prose.`;

export interface PlannerOptions {
  sentinelDb?: DatabaseType;
  userAliases?: Record<string, string>;
}

export class Planner {
  private sentinelDb: DatabaseType | null;
  private userAliases: Record<string, string>;

  constructor(
    private llm: LlmClient,
    private registry: ActionRegistry,
    options?: PlannerOptions,
  ) {
    this.sentinelDb = options?.sentinelDb ?? null;
    this.userAliases = options?.userAliases ?? {};
  }

  async plan(message: string): Promise<Plan> {
    const catalog = this.registry.serializeForPrompt();
    const sentinelBlock = this.buildSentinelContext();
    const aliasBlock = this.buildAliasBlock();
    const prompt = `${SYSTEM_PROMPT_HEADER}\n\n${catalog}\n${aliasBlock}${sentinelBlock}\nUser request: ${JSON.stringify(message)}\n\nJSON:`;
    const raw = await this.llm.complete(prompt, { model: "gemini-pro", temperature: 0 });
    return this.parseAndValidate(raw);
  }

  async replan(message: string, previous: Plan, edit_text: string): Promise<Plan> {
    const catalog = this.registry.serializeForPrompt();
    const sentinelBlock = this.buildSentinelContext();
    const aliasBlock = this.buildAliasBlock();
    const prompt = `${SYSTEM_PROMPT_HEADER}\n\n${catalog}\n${aliasBlock}${sentinelBlock}\nUser request: ${JSON.stringify(message)}\n\nPrevious plan:\n${JSON.stringify(previous, null, 2)}\n\nUser edit: ${JSON.stringify(edit_text)}\n\nProduce the REVISED plan as JSON:`;
    const raw = await this.llm.complete(prompt, { model: "gemini-pro", temperature: 0 });
    return this.parseAndValidate(raw);
  }

  private buildAliasBlock(): string {
    const entries = Object.entries(this.userAliases);
    if (entries.length === 0) {
      return "";
    }
    const lines = entries.map(([name, id]) => `- ${name} → ${id}`);
    return `\nKnown user aliases (use these IDs when the user names a person):\n${lines.join("\n")}\n`;
  }

  private buildSentinelContext(): string {
    if (!this.sentinelDb) {
      return "";
    }
    try {
      const recent = this.sentinelDb
        .prepare(
          `SELECT category, summary, evidence, confidence FROM insights
           ORDER BY generated_at DESC LIMIT 5`,
        )
        .all() as Array<{
        category: string;
        summary: string;
        evidence: string;
        confidence: number;
      }>;
      if (recent.length === 0) {
        return "";
      }
      const lines = recent.map(
        (i) => `- ${i.category} (conf ${i.confidence.toFixed(2)}): ${i.summary} — ${i.evidence}`,
      );
      return `\nSentinel context (recent insights for situational awareness):\n${lines.join("\n")}\n`;
    } catch {
      return "";
    }
  }

  private parseAndValidate(raw: string): Plan {
    const stripped = raw.trim().replace(/^```(?:json)?\n?|\n?```$/g, "");
    const plan = PlanSchema.parse(JSON.parse(stripped));
    // Verify each step references a registered action with valid args
    for (const step of plan.steps) {
      const action = this.registry.get(step.action);
      if (!action) {
        throw new Error(`unknown action in plan: ${step.action}`);
      }
      try {
        action.args_schema.parse(step.args);
      } catch (err) {
        throw new Error(`invalid args for ${step.action}: ${(err as Error).message}`, {
          cause: err,
        });
      }
    }
    return plan;
  }

  /**
   * Render a markdown diff between two plans for the EDITING state Slack update.
   * Strikethrough removed/changed steps; inline new ones.
   */
  renderDiff(previous: Plan, next: Plan): string {
    const lines: string[] = [`**Plan updated**\n`, `_${next.summary}_\n`];
    const maxLen = Math.max(previous.steps.length, next.steps.length);
    for (let i = 0; i < maxLen; i++) {
      const prev = previous.steps[i];
      const cur = next.steps[i];
      if (
        prev &&
        cur &&
        prev.action === cur.action &&
        JSON.stringify(prev.args) === JSON.stringify(cur.args)
      ) {
        lines.push(`${i + 1}. \`${cur.action}\` ${JSON.stringify(cur.args)}`);
      } else {
        if (prev) {
          lines.push(`~~${i + 1}. \`${prev.action}\` ${JSON.stringify(prev.args)}~~`);
        }
        if (cur) {
          lines.push(`**${i + 1}.** \`${cur.action}\` ${JSON.stringify(cur.args)}`);
        }
      }
    }
    return lines.join("\n");
  }
}
