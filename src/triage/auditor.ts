import { z } from "zod";
import type { LlmClient } from "./llm-client.js";
import { serializeBundleForPrompt, type ResearchBundle } from "./research-bundle.js";
import type { Plan, PlanStep } from "./types.js";

const MAX_FOLLOWUP_STEPS = 3;

const AdditionalStepSchema = z.object({
  action: z.string(),
  args: z.record(z.string(), z.unknown()),
  rationale: z.string().optional(),
});

const AuditResponseSchema = z.object({
  sufficient: z.boolean(),
  rationale: z.string(),
  additional_steps: z.array(AdditionalStepSchema).optional(),
});

export interface AuditInput {
  question: string;
  plan: Plan;
  bundle: ResearchBundle;
}

export interface AuditOutput {
  sufficient: boolean;
  rationale: string;
  additional_steps?: PlanStep[];
}

export interface AuditorDeps {
  llm: LlmClient;
  knownActions: Set<string>;
}

function buildPrompt(input: AuditInput): string {
  return `You are JR's research auditor. Decide if JR can give a good answer to the user from what's been gathered, or whether more lookups are needed.

User question: ${JSON.stringify(input.question)}

Plan JR ran:
${JSON.stringify(input.plan, null, 2)}

Results gathered:
${serializeBundleForPrompt(input.bundle)}

Decide:
- sufficient=true if JR can answer well from what's here
- sufficient=false if there's an obvious gap (e.g., user asked for active projects, JR got the count but not the list)

If sufficient=false, propose up to 3 additional_steps using the same Firestore action catalog (firestoreCollections, firestoreKeys, firestoreGet, firestoreQuery, firestoreCount). DO NOT propose actions outside this catalog.

Return JSON only:
{ "sufficient": bool, "rationale": "short why", "additional_steps"?: [ { "action": "...", "args": { ... } } ] }`;
}

export class Auditor {
  constructor(private deps: AuditorDeps) {}

  async audit(input: AuditInput): Promise<AuditOutput> {
    let raw: string;
    try {
      raw = await this.deps.llm.complete(buildPrompt(input), {
        model: "gemini-flash",
        temperature: 0.1,
      });
    } catch (err) {
      return {
        sufficient: true,
        rationale: `audit failed; degraded to one-shot: ${(err as Error).message}`,
      };
    }

    let parsed: z.infer<typeof AuditResponseSchema>;
    try {
      const stripped = raw.trim().replace(/^```(?:json)?\n?|\n?```$/g, "");
      parsed = AuditResponseSchema.parse(JSON.parse(stripped));
    } catch {
      return {
        sufficient: true,
        rationale: "audit returned malformed JSON; degraded to one-shot",
      };
    }

    if (parsed.sufficient) {
      return { sufficient: true, rationale: parsed.rationale };
    }

    const filtered = (parsed.additional_steps ?? [])
      .filter((s) => this.deps.knownActions.has(s.action))
      .slice(0, MAX_FOLLOWUP_STEPS)
      .map((s) => ({ action: s.action, args: s.args, rationale: s.rationale }));

    return {
      sufficient: false,
      rationale: parsed.rationale,
      additional_steps: filtered,
    };
  }
}
