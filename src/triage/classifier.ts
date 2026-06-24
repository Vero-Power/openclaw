import type { LlmClient } from "./llm-client.js";
import { ClassifierOutputSchema, type ClassifierOutput } from "./types.js";

const LOW_CONFIDENCE_THRESHOLD = 0.85;

const SYSTEM_PROMPT = `You classify Slack messages for JR, an autonomous workflow bot at Vero.

Return JSON only, no markdown fences:
{ "is_task": boolean, "confidence": number 0-1, "suggested_category": string optional }

DEFAULT TO is_task=true. JR's job is to take action. The only is_task=false cases are pure pleasantries ("hi", "thanks", "lol", "good morning") that have no question or request in them at all.

is_task = true (the default) when the user is:
  • asking JR to DO something (run a workflow, fire an automation, send a Slack message, invoke a Cloud Function, update a record, schedule something)
  • asking ANY data-lookup question — JR has tools for Firestore (collections/keys/get/query/count/set/delete), Coperniq, GHL, Slack. If the answer requires fresh data from any of those, it is a TASK, not a knowledge question.
  • following up on something previously discussed (status questions are tasks — JR should check current state, not regurgitate prior chat)
  • asking analytic questions about real data ("how many X are open", "what's the priority", "show me", "find", "list")
  • giving ambiguous instructions — better to plan and surface options than to chat

is_task = false ONLY when the message is unambiguously social:
  • a pure greeting with no question ("hi", "hey JR", "what's up")
  • a pure acknowledgement ("thanks", "got it", "ok")
  • generic emotive reactions ("lol", "nice", "wow")

When in doubt, return is_task=true. The cost of a wasted plan is low. The cost of a missed action is the operator giving up on JR.

Examples:
"hey JR" → {"is_task": false, "confidence": 0.95}
"thanks" → {"is_task": false, "confidence": 0.9}
"can you ingest the latest Coperniq data?" → {"is_task": true, "confidence": 0.98, "suggested_category": "ops"}
"what collections exist in firestore?" → {"is_task": true, "confidence": 0.95, "suggested_category": "data_lookup"} (live data query)
"how many open funding exceptions" → {"is_task": true, "confidence": 0.95, "suggested_category": "data_lookup"}
"show me project 737955" → {"is_task": true, "confidence": 0.95, "suggested_category": "data_lookup"}
"what does coperniq_projects look like?" → {"is_task": true, "confidence": 0.9, "suggested_category": "data_lookup"} (schema inspection — JR can call firestoreKeys)
"what do you know about solar?" → {"is_task": false, "confidence": 0.9} (genuine knowledge question, no live data needed)
"DM Ridge and tell him to run gcloud auth" → {"is_task": true, "confidence": 0.98, "suggested_category": "communication"}
"check on project 42" → {"is_task": true, "confidence": 0.95, "suggested_category": "research"}
"did you do the thing I asked" → {"is_task": true, "confidence": 0.85, "suggested_category": "status"} (status questions are tasks — JR should fetch current state, not just chat about it)
"???" → {"is_task": true, "confidence": 0.5}
`;

export class Classifier {
  constructor(private llm: LlmClient) {}

  async classify(message: string, context?: string): Promise<ClassifierOutput> {
    const contextBlock = context
      ? `\n\nConversation context (use it to resolve references like "that"/"it"/"him"). Status questions about previously-queued actions are still TASKS — JR should fetch current state, not regurgitate chat history:\n${context}\n`
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
