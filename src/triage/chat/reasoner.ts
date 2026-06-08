import { z } from "zod";
import type { LlmClient } from "../llm-client.js";

const ReasonerOutputSchema = z.object({
  findings: z.string(),
  confidence: z.number().min(0).max(1),
});
export type ReasonerOutput = z.infer<typeof ReasonerOutputSchema>;

const SYSTEM_PROMPT = `You are JR's private reasoner. You think about what the user is asking and what JR should say back, but YOUR output is never shown to the user.

Given a user message in JR's Slack DM or channel mention, produce a JSON analysis:
{ "findings": "brief paragraph of what the user means and what an ideal response should cover", "confidence": 0-1 }

Be terse. The responder will read your findings and produce the actual reply.

Return JSON only, no markdown fences.`;

export class Reasoner {
  constructor(private llm: LlmClient) {}

  async reason(input: { userMessage: string; recentThread?: string[] }): Promise<ReasonerOutput> {
    const threadContext = (input.recentThread ?? [])
      .slice(-5)
      .map((t, i) => `[turn ${i + 1}] ${t}`)
      .join("\n");
    const prompt = `${SYSTEM_PROMPT}\n\nRecent thread:\n${threadContext || "(none)"}\n\nUser message: ${JSON.stringify(input.userMessage)}\n\nJSON:`;
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
