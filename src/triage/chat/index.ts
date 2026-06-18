import { readFileSync } from "node:fs";
import type { LlmClient } from "../llm-client.js";
import { Reasoner } from "./reasoner.js";
import { Responder } from "./responder.js";

let cachedPersona: string | null = null;
function loadPersona(): string {
  if (cachedPersona) {
    return cachedPersona;
  }
  try {
    cachedPersona = readFileSync("/Users/vero/openclaw/SOUL.md", "utf-8");
  } catch {
    cachedPersona = "You are JR, a Slack bot. Be terse and helpful.";
  }
  return cachedPersona;
}

export interface ChatHandlerDeps {
  llm: LlmClient;
  slackPost: (params: { channel: string; thread_ts?: string; text: string }) => Promise<void>;
}

export async function handleChatMessage(
  input: {
    userMessage: string;
    channel: string;
    threadTs?: string;
    isDm: boolean;
    recentThread?: string[];
  },
  deps: ChatHandlerDeps,
): Promise<void> {
  const reasoner = new Reasoner(deps.llm);
  const responder = new Responder(deps.llm);

  const reasoned = await reasoner.reason({
    userMessage: input.userMessage,
    recentThread: input.recentThread,
  });
  const reply = await responder.respond({
    userMessage: input.userMessage,
    findings: reasoned.findings,
    persona: loadPersona(),
  });

  await deps.slackPost({
    channel: input.channel,
    thread_ts: input.isDm ? undefined : input.threadTs,
    text: reply,
  });
}

export { Reasoner, Responder };
