import { z } from "zod";
import type { LlmClient } from "../llm-client.js";

const FollowupItemSchema = z.object({
  kind: z.enum(["dm_person", "note", "task"]),
  payload: z.record(z.string(), z.unknown()),
});
export type ReasonerFollowup = z.infer<typeof FollowupItemSchema>;

const ReasonerOutputSchema = z.object({
  findings: z.string(),
  confidence: z.number().min(0).max(1),
  followups: z.array(FollowupItemSchema).optional(),
});
export type ReasonerOutput = z.infer<typeof ReasonerOutputSchema>;

const SYSTEM_PROMPT = `You are JR's private reasoner. You think about what the user is asking and what JR should say back, but YOUR output is never shown to the user.

Given a user message in JR's Slack DM or channel mention, produce a JSON analysis:
{ "findings": "brief paragraph of what the user means and what an ideal response should cover", "confidence": 0-1 }

Be terse. The responder will read your findings and produce the actual reply.

HARD RULE — NEVER FABRICATE DATA. If the user is asking for SPECIFIC data — a record by id, a count, a list, fields of a collection, "show me X", "pull up Y" — and that data is NOT in the conversation context, your findings MUST explicitly say so. Example findings: "User asked for project 737955 but no data is in context. JR routed this to chat mode instead of a data action. JR must say honestly that the lookup didn't run and offer to retry — must NOT invent fields, values, names, or placeholder data like 'Jane Doe' / '123 Main St' / 'Central Park Renovation'." The honest response ("I couldn't fetch that — want me to try again?") is required when the data layer wasn't reached.

Return JSON only, no markdown fences.`;

function buildFollowupBlock(knownAliases: string[]): string {
  // Aliases land verbatim inside the prompt — drop anything that could smuggle instructions.
  const aliasList = knownAliases.filter((a) => /^[a-z0-9_.-]+$/i.test(a)).join(", ");
  const kinds = aliasList ? `"dm_person"|"note"|"task"` : `"note"|"task"`;
  const dmShape = aliasList
    ? `\n  - dm_person: {"target_alias":"<one of: ${aliasList}>","topic":"...","question_text":"<the question to DM them>","context":"<one-line handoff>"}`
    : "";
  const dmRule = aliasList
    ? `\nFor dm_person the target_alias MUST be one of: ${aliasList} — if the named person is not listed, use kind "note" instead.`
    : "";
  return `

FOLLOW-UPS: If the user asks JR to do something later — message another person ("ask Ridge about X"), look into something and report back, or perform a task — add a "followups" array to your JSON:
"followups": [ { "kind": ${kinds}, "payload": {...} } ]
Payload shapes:${dmShape}
  - note: {"text":"<what to surface in JR's daily report>"}
  - task: {"task_text":"<the task in plain words>","context":"<brief background>"}${dmRule}
Only file follow-ups the user actually asked for. Omit the array when there are none.

HONESTY RULE: JR must never promise future actions without a filed follow-up. If the user asks for one, file it.`;
}

export class Reasoner {
  constructor(private llm: LlmClient) {}

  async reason(input: {
    userMessage: string;
    contextBlock?: string;
    followups?: { knownAliases: string[] };
  }): Promise<ReasonerOutput> {
    const followupBlock = input.followups ? buildFollowupBlock(input.followups.knownAliases) : "";
    const prompt = `${SYSTEM_PROMPT}${followupBlock}\n\nConversation context:\n${input.contextBlock || "(none)"}\n\nUser message: ${JSON.stringify(input.userMessage)}\n\nJSON:`;
    let raw: string;
    try {
      raw = await this.llm.complete(prompt, { model: "gemini-pro", temperature: 0 });
    } catch {
      return {
        findings: "(reasoner unavailable; responder should give a brief honest reply)",
        confidence: 0,
      };
    }
    try {
      const stripped = raw.trim().replace(/^```(?:json)?\n?|\n?```$/g, "");
      return ReasonerOutputSchema.parse(JSON.parse(stripped));
    } catch {
      return { findings: "(reasoner output unparseable)", confidence: 0 };
    }
  }
}
