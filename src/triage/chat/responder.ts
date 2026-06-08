import { z } from "zod";
import type { LlmClient } from "../llm-client.js";

const ResponderOutputSchema = z.object({ reply: z.string() });

export class Responder {
  constructor(private llm: LlmClient) {}

  async respond(input: {
    userMessage: string;
    findings: string;
    persona: string;
  }): Promise<string> {
    const prompt = `You are JR. Your personality:\n${input.persona}\n\nA private reasoner has analyzed the user's message. Use the findings to produce ONE Slack reply.

Findings: ${input.findings}

User message: ${JSON.stringify(input.userMessage)}

Output JSON only, no markdown fences:
{ "reply": "your reply text" }

Reply must be a single Slack message. No XML tags. No multi-part responses. Stay in character.

JSON:`;
    let raw: string;
    try {
      raw = await this.llm.complete(prompt, { model: "gemini-flash", temperature: 0.5 });
    } catch {
      return "Sorry — I had trouble responding. Try again?";
    }
    try {
      const stripped = raw.trim().replace(/^```(?:json)?\n?|\n?```$/g, "");
      const parsed = ResponderOutputSchema.parse(JSON.parse(stripped));
      return parsed.reply.trim();
    } catch {
      return "Sorry — I had trouble formatting my response.";
    }
  }
}
