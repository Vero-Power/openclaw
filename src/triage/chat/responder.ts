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
    const stripped = raw.trim().replace(/^```(?:json)?\n?|\n?```$/g, "");
    // Try the strict JSON path first
    try {
      const parsed = ResponderOutputSchema.parse(JSON.parse(stripped));
      return parsed.reply.trim();
    } catch {
      // Salvage path: LLM returned plain text instead of {reply: "..."}. As long
      // as it's a reasonable Slack message length, use it directly. Better to
      // surface the model's actual words than the "trouble formatting" fallback.
      const cleaned = stripped.replace(/^["']|["']$/g, "").trim();
      if (cleaned.length > 0 && cleaned.length <= 4000 && !cleaned.startsWith("{")) {
        return cleaned;
      }
      return "Sorry — I had trouble formatting my response.";
    }
  }
}
