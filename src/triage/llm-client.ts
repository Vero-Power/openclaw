/**
 * Minimal LLM client surface used by Classifier and Planner.
 * Real implementation wraps @mariozechner/pi-ai with model routing.
 * Tests inject a stub.
 */
export interface LlmClient {
  complete(prompt: string, opts?: { model?: string; temperature?: number }): Promise<string>;
}
