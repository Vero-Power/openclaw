import { existsSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import { z } from "zod";
import type { LlmClient } from "../triage/llm-client.js";
import type { ConversationStore } from "./conversation-store.js";
import type { ChannelNameResolver } from "./slack-resolvers.js";

const INQUIRER_COOLDOWN_MS = 48 * 60 * 60 * 1000;
const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "to",
  "and",
  "or",
  "in",
  "on",
  "at",
  "for",
  "with",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "by",
  "as",
  "from",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "do",
  "does",
  "did",
]);

function tokenize(topic: string): Set<string> {
  return new Set(
    topic
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1 && !STOPWORDS.has(w)),
  );
}

function topicsAreSimilar(a: string, b: string): boolean {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) {
    return false;
  }
  let intersect = 0;
  for (const t of ta) {
    if (tb.has(t)) {
      intersect++;
    }
  }
  // Overlap coefficient: |A ∩ B| / min(|A|, |B|). More tolerant than Jaccard
  // when one topic is a reworded subset of the other ("Inactive Slack
  // channels" vs "Silent Slack channels archival" — share slack+channels,
  // overlap = 2/3 = 0.67). Threshold 0.6 catches obvious dups, rejects
  // generic two-word overlaps like "Slack workflow" / "Slack integration".
  const smaller = Math.min(ta.size, tb.size);
  return intersect / smaller >= 0.6;
}

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

const SYSTEM_PROMPT_HEADER = `You are JR's private inquirer. Look at recent low-confidence insights and identify knowledge gaps where asking a specific person at Vero would help.

For each gap, propose: who to ask (Slack user id), what topic, the actual question text (colleague tone, no preamble — get to the point), and your rationale.

CRITICAL — you may ONLY target users from the "Known team members" list below. The list is the complete set of people you can DM. If no listed user is appropriate for a question, SKIP that question (do not file it). DO NOT invent Slack user IDs. DO NOT invent role names for people you have never seen named. Questions that target unlisted IDs will be rejected as hallucinations.

Return JSON only:
{ "questions": [ { "target_user_id", "topic", "question_text", "rationale" } ] }

Max 5 questions per cycle. If no gaps justify an inquiry to a listed user, return { "questions": [] }.`;

export interface InquirerDeps {
  llm: LlmClient;
  db: DatabaseType;
  libPath: string;
  // Real workspace users JR may target. Map alias → Slack user ID.
  // Required to prevent hallucinated user IDs in the queue / live DMs.
  userAliases: Record<string, string>;
  // Phase B: used when OPENCLAW_INQUIRER_LIVE=1
  dmUser?: (userId: string, text: string) => Promise<void>;
  // Phase B: ConversationStore for opening tracked conversations
  conversationStore?: ConversationStore;
  // Optional resolver — enriches question_text before writing to queue / DM
  channelResolver?: ChannelNameResolver;
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

    const aliasLines = Object.entries(this.deps.userAliases)
      .map(([alias, id]) => `- ${alias} (${id})`)
      .join("\n");
    const aliasBlock =
      aliasLines.length > 0
        ? `\n\nKnown team members (target only these IDs):\n${aliasLines}`
        : "\n\nKnown team members: (none configured — return empty questions)";

    const prompt = `${SYSTEM_PROMPT_HEADER}${aliasBlock}\n\nLow-confidence insights:\n${insightLines}\n\nJSON:`;

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

    // Filter against the known-user allow-list. Reject any target_user_id the
    // LLM invented that isn't in the userAliases map values. This is the
    // anti-hallucination gate that protects Phase B live-mode from DMing
    // made-up or randomly-guessed user IDs.
    const allowedUserIds = new Set(Object.values(this.deps.userAliases));

    const eligible = parsed.questions.filter(
      (q) => allowedUserIds.has(q.target_user_id) && !optedOut.has(q.target_user_id),
    );

    // Enrich question texts for display (queue file + DM). Raw text is kept in
    // the conversation store so raw IDs are preserved in the DB.
    const enrichedTexts: string[] = await Promise.all(
      eligible.map((q) =>
        this.deps.channelResolver
          ? this.deps.channelResolver.enrichText(q.question_text)
          : Promise.resolve(q.question_text),
      ),
    );

    const queuePath = join(this.deps.libPath, "reports/inquiry-queue.md");
    const now = new Date().toISOString();
    const block = `## Cycle ${now}\n\n${eligible
      .map(
        (q, idx) =>
          `### Q${idx + 1} — ${q.topic}\n\n**Target:** \`${q.target_user_id}\`\n\n**Question:** ${enrichedTexts[idx] ?? q.question_text}\n\n**Rationale:** ${q.rationale}\n`,
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
      for (let idx = 0; idx < eligible.length; idx++) {
        const q = eligible[idx];
        if (!q) {
          continue;
        }
        // Enforce: only one open conversation per person at a time
        const existing = this.deps.conversationStore!.findOpenForPerson(q.target_user_id);
        if (existing) {
          continue;
        }
        // Topic cooldown: if we already asked this person a similar question
        // in the last 48h (regardless of how that conversation ended), skip.
        // Stops the every-2h re-DM spam when a user doesn't reply and the
        // conversation auto-drops, only to be re-asked next cycle.
        const recent = this.deps.conversationStore!.findRecentForPerson(
          q.target_user_id,
          INQUIRER_COOLDOWN_MS,
        );
        if (recent.some((r) => topicsAreSimilar(r.topic, q.topic))) {
          continue;
        }
        this.deps.conversationStore!.open({
          person_user_id: q.target_user_id,
          channel: q.target_user_id, // DM channel = user id in Slack
          topic: q.topic,
          opening_message: q.question_text,
        });
        await this.deps.dmUser!(q.target_user_id, enrichedTexts[idx] ?? q.question_text);
      }
    }

    return { questionsFiled: eligible.length };
  }
}
