import type { LlmClient } from "./llm-client.js";
import { ClassifierOutputSchema, type ClassifierOutput } from "./types.js";

const LOW_CONFIDENCE_THRESHOLD = 0.5;

const SYSTEM_PROMPT = `You classify Slack messages for JR, an autonomous workflow bot at Vero.

Return JSON only, no markdown fences:
{ "is_task": boolean, "confidence": number 0-1, "suggested_category": string optional }

is_task = true when the user is asking JR to DO something multi-step (run a process, gather info, send a message, fire an automation). is_task = false ONLY when the message is pure chitchat with no actionable ask ("hi", "thanks", "lol", "good morning").

When in doubt, prefer is_task=true. The user can drop back into chat mode.

Examples:
"hey JR" → {"is_task": false, "confidence": 0.95}
"can you ingest the latest Coperniq data?" → {"is_task": true, "confidence": 0.95, "suggested_category": "ops"}
"what's up?" → {"is_task": false, "confidence": 0.9}
"check on project 42" → {"is_task": true, "confidence": 0.85, "suggested_category": "research"}
"???" → {"is_task": true, "confidence": 0.3} (ambiguous; default to triage)
`;

export class Classifier {
  constructor(private llm: LlmClient) {}

  async classify(message: string): Promise<ClassifierOutput> {
    const prompt = `${SYSTEM_PROMPT}\n\nMessage: ${JSON.stringify(message)}\n\nJSON:`;
    let raw: string;
    try {
      raw = await this.llm.complete(prompt, { model: "gemini-flash", temperature: 0 });
    } catch {
      return { is_task: true, confidence: 0 };
    }
    let parsed: ClassifierOutput;
    try {
      const stripped = raw.trim().replace(/^```(?:json)?\n?|\n?```$/g, "");
      parsed = ClassifierOutputSchema.parse(JSON.parse(stripped));
    } catch {
      return { is_task: true, confidence: 0 };
    }
    // Q12 — low confidence flips to is_task=true
    if (parsed.confidence < LOW_CONFIDENCE_THRESHOLD) {
      return { ...parsed, is_task: true };
    }
    return parsed;
  }
}
