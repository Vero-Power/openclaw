/**
 * Thin abstraction over Slack post/edit so the executor and tests can share
 * the same interface. Real implementation wires to the existing slack client
 * in src/slack/client.ts when Task 6 lands.
 */
export interface SlackBridge {
  post(text: string): Promise<{ ts: string }>;
  edit(ts: string, text: string): Promise<void>;
}
