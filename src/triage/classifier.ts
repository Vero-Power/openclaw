import type { LlmClient } from "./llm-client.js";
import { ClassifierOutputSchema, type ClassifierOutput } from "./types.js";

const LOW_CONFIDENCE_THRESHOLD = 0.5;

const SYSTEM_PROMPT = `You classify Slack messages for JR, an autonomous workflow bot at Vero.

Return JSON only, no markdown fences:
{ "is_task": boolean, "confidence": number 0-1, "suggested_category": string optional }

is_task = true when the user is asking JR to DO something that requires touching an external system or sending a real message: run a workflow, fire an automation, send a Slack DM/post, hit a Cloud Function, update a record, schedule something. The hallmark is "action that changes the world or queries a live external system."

is_task = false when the message is:
  • chitchat / social ("hi", "thanks", "lol", "good morning")
  • a knowledge or opinion question JR can answer from his own memory ("what do you know about X", "explain Y", "what do you think about Z", "tell me about ...", "how does ... work")
  • a request for JR's analysis or reasoning that doesn't require external action ("does this look right", "what are the tradeoffs of ...")

When in doubt between chat and task, prefer is_task=false IF the request is clearly answerable from JR's knowledge alone with no external API/Slack action needed. Only mark is_task=true when there's a concrete action JR must take in the world.

Examples:
"hey JR" → {"is_task": false, "confidence": 0.95}
"can you ingest the latest Coperniq data?" → {"is_task": true, "confidence": 0.95, "suggested_category": "ops"}
"what's up?" → {"is_task": false, "confidence": 0.9}
"what do you know about solar?" → {"is_task": false, "confidence": 0.9} (knowledge question — JR answers from memory)
"explain how triage works" → {"is_task": false, "confidence": 0.9}
"DM Ridge and tell him to run gcloud auth" → {"is_task": true, "confidence": 0.95, "suggested_category": "communication"}
"check on project 42" → {"is_task": true, "confidence": 0.85, "suggested_category": "research"} (requires a live data lookup)
"???" → {"is_task": true, "confidence": 0.3} (genuinely ambiguous; safe default)
`;

export class Classifier {
  constructor(private llm: LlmClient) {}

  async classify(message: string, context?: string): Promise<ClassifierOutput> {
    const contextBlock = context
      ? `\n\nConversation context (use it to resolve references like "that"/"it"/"him", and to recognize when the user is asking about something JR already did — status questions about past or queued actions are is_task=false, answerable from context):\n${context}\n`
      : "";
    const prompt = `${SYSTEM_PROMPT}${contextBlock}\n\nMessage: ${JSON.stringify(message)}\n\nJSON:`;
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
