import { existsSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import { z } from "zod";
import type { LlmClient } from "../triage/llm-client.js";
import type { ConversationStore } from "./conversation-store.js";

const QuestionsOutputSchema = z.object({
  questions: z.array(
    z.object({
      target_user_id: z.string(),
      topic: z.string(),
      question_text: z.string(),
      rationale: z.string(),
    }),
  ),
});

const SYSTEM_PROMPT = `You are JR's private inquirer. Look at recent low-confidence insights and identify knowledge gaps where asking a specific person at Vero would help.

For each gap, propose: who to ask (Slack user id), what topic, the actual question text (colleague tone, no preamble — get to the point), and your rationale.

Return JSON only:
{ "questions": [ { "target_user_id", "topic", "question_text", "rationale" } ] }

Max 5 questions per cycle. If no gaps justify an inquiry, return { "questions": [] }.`;

export interface InquirerDeps {
  llm: LlmClient;
  db: DatabaseType;
  libPath: string;
  // Phase B: used when OPENCLAW_INQUIRER_LIVE=1
  dmUser?: (userId: string, text: string) => Promise<void>;
  // Phase B: ConversationStore for opening tracked conversations
  conversationStore?: ConversationStore;
}

export interface InquirerResult {
  questionsFiled: number;
}

export class Inquirer {
  constructor(private deps: InquirerDeps) {}

  async formulateQuestions(): Promise<InquirerResult> {
    const lowConfInsights = this.deps.db
      .prepare(
        `SELECT id, category, summary, evidence, confidence FROM insights
         WHERE confidence < 0.5 ORDER BY generated_at DESC LIMIT 10`,
      )
      .all() as Array<{
      id: number;
      category: string;
      summary: string;
      evidence: string;
      confidence: number;
    }>;

    if (lowConfInsights.length === 0) {
      return { questionsFiled: 0 };
    }

    const insightLines = lowConfInsights
      .map(
        (i) =>
          `[insight ${i.id}] (${i.category}, conf ${i.confidence.toFixed(2)}) ${i.summary} — ${i.evidence}`,
      )
      .join("\n");
    const prompt = `${SYSTEM_PROMPT}\n\nLow-confidence insights:\n${insightLines}\n\nJSON:`;

    let raw: string;
    try {
      raw = await this.deps.llm.complete(prompt, { model: "gemini-pro", temperature: 0.3 });
    } catch {
      return { questionsFiled: 0 };
    }
    let parsed: z.infer<typeof QuestionsOutputSchema>;
    try {
      const stripped = raw.trim().replace(/^```(?:json)?\n?|\n?```$/g, "");
      parsed = QuestionsOutputSchema.parse(JSON.parse(stripped));
    } catch {
      return { questionsFiled: 0 };
    }

    // Filter against global opt-outs
    const optedOut = new Set(
      (
        this.deps.db
          .prepare("SELECT person_user_id FROM opt_outs WHERE scope = 'global'")
          .all() as Array<{
          person_user_id: string;
        }>
      ).map((r) => r.person_user_id),
    );

    const eligible = parsed.questions.filter((q) => !optedOut.has(q.target_user_id));

    const queuePath = join(this.deps.libPath, "reports/inquiry-queue.md");
    const now = new Date().toISOString();
    const block = `## Cycle ${now}\n\n${eligible
      .map(
        (q, idx) =>
          `### Q${idx + 1} — ${q.topic}\n\n**Target:** \`${q.target_user_id}\`\n\n**Question:** ${q.question_text}\n\n**Rationale:** ${q.rationale}\n`,
      )
      .join("\n")}\n`;

    if (existsSync(queuePath)) {
      appendFileSync(queuePath, block);
    } else {
      writeFileSync(
        queuePath,
        `---\ntitle: Inquiry review queue\nsummary: Phase A — JR's formulated questions awaiting human review\ntags: [inquiry, review]\n---\n\n# Inquiry Review Queue\n\n_Phase A is manual-review mode. JR formulates questions; humans review here before any go live._\n\n${block}`,
      );
    }

    // Phase B live mode: when OPENCLAW_INQUIRER_LIVE=1 AND dmUser + conversationStore are
    // provided, open a tracked conversation and DM the person instead of queuing.
    const liveMode =
      process.env.OPENCLAW_INQUIRER_LIVE === "1" &&
      this.deps.dmUser !== undefined &&
      this.deps.conversationStore !== undefined;

    if (liveMode) {
      for (const q of eligible) {
        // Enforce: only one open conversation per person at a time
        const existing = this.deps.conversationStore!.findOpenForPerson(q.target_user_id);
        if (existing) {
          continue;
        }
        this.deps.conversationStore!.open({
          person_user_id: q.target_user_id,
          channel: q.target_user_id, // DM channel = user id in Slack
          topic: q.topic,
          opening_message: q.question_text,
        });
        await this.deps.dmUser!(q.target_user_id, q.question_text);
      }
    }

    return { questionsFiled: eligible.length };
  }
}
