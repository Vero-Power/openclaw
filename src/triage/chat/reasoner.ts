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
    recentThread?: string[];
    followups?: { knownAliases: string[] };
  }): Promise<ReasonerOutput> {
    const threadContext = (input.recentThread ?? [])
      .slice(-5)
      .map((t, i) => `[turn ${i + 1}] ${t}`)
      .join("\n");
    const followupBlock = input.followups ? buildFollowupBlock(input.followups.knownAliases) : "";
    const prompt = `${SYSTEM_PROMPT}${followupBlock}\n\nRecent thread:\n${threadContext || "(none)"}\n\nUser message: ${JSON.stringify(input.userMessage)}\n\nJSON:`;
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
