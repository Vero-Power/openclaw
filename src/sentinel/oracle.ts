import { createHash } from "node:crypto";
import type { Database as DatabaseType } from "better-sqlite3";
import type { LlmClient } from "../triage/llm-client.js";
import { buildCompanyContext } from "./observers/external-context/company-context.js";
import type { CompanyContextFirestoreLike } from "./observers/external-context/company-context.js";
import { writePerPersonFile } from "./oracle/file-writer.js";
import { buildPeopleDirectory } from "./oracle/people-directory.js";
import type { PersonDirectoryEntry } from "./oracle/people-directory.js";
import { OracleStore, type Recommendation } from "./oracle/store.js";

export type { Recommendation } from "./oracle/store.js";

export interface OracleDeps {
  db: DatabaseType;
  llm: LlmClient;
  libPath: string;
  firestoreClient: CompanyContextFirestoreLike;
  userAliases: Record<string, string>;
  dmUser?: (slackUserId: string, text: string) => Promise<void>;
}

export interface Oracle {
  recommendAll(): Promise<Recommendation[]>;
  recommendForUser(slackUserId: string): Promise<Recommendation[]>;
  runCycle(): Promise<{
    recommendations: Recommendation[];
    filesWritten: string[];
    dmsSent: Array<{ assignee_email: string; rec_ids: string[] }>;
  }>;
}

const MAX_DMS_PER_ASSIGNEE_PER_CYCLE = 5;

function stableId(title: string, evidence: string[]): string {
  const sorted = evidence.toSorted();
  return createHash("sha1")
    .update(`${title}|${sorted.join(",")}`)
    .digest("hex")
    .slice(0, 16);
}

function buildPrompt(
  companyContext: string,
  directory: PersonDirectoryEntry[],
  observationSnippets: string[],
  insightSnippets: string[],
): string {
  const directoryJson = JSON.stringify(
    directory.map((d) => ({
      email: d.email,
      display_name: d.display_name,
      source: d.source,
      evidence_count: d.evidence_count,
      notes: d.notes,
    })),
    null,
    2,
  );

  return `You are JR's Oracle. Generate prioritized action recommendations for Vero's team based on the company state and recent observations.

CONTEXT:

1. Company snapshot:
${companyContext}

2. People directory (you MUST pick assignee_email from this list):
${directoryJson}

3. Recent observations (last 48h, top by recency):
${observationSnippets.length > 0 ? observationSnippets.map((s) => `- ${s}`).join("\n") : "(none yet)"}

4. Recent insights (last 14 days, top by confidence):
${insightSnippets.length > 0 ? insightSnippets.map((s) => `- ${s}`).join("\n") : "(none yet)"}

OUTPUT — JSON object only, no markdown fences:
{
  "recommendations": [
    {
      "title": "<short imperative action, <= 100 chars>",
      "rationale": "<1-3 sentence why-this-matters>",
      "evidence_observation_ids": [int, ...],
      "evidence_insight_ids": [int, ...],
      "assignee_email": "<MUST be one of the directory emails>",
      "scope": "ops" | "tactical" | "strategic",
      "urgency": "low" | "medium" | "high",
      "confidence": "low" | "medium" | "high"
    }
  ]
}

Constraints:
- 5-8 recommendations total. Pick the highest-signal ones.
- Distribute across assignees - don't dump everything on one person.
- Cite evidence; recommendations without any evidence are not acceptable.
- Stick to assignees from the directory; if no good match exists, do not invent.
- Keep rationale to 1-2 short sentences.
- Emit an empty array if there is truly nothing actionable.
- Return only the JSON object. No preamble, no markdown fences, no trailing prose.`;
}

function queryObservations(db: DatabaseType, sinceMs: number, limit: number): string[] {
  const rows = db
    .prepare(
      `SELECT id, source, topic, summary FROM observations
       WHERE timestamp > ? ORDER BY timestamp DESC LIMIT ?`,
    )
    .all(sinceMs, limit) as Array<{
    id: number;
    source: string;
    topic: string | null;
    summary: string;
  }>;
  return rows.map((r) => `[obs:${r.id}] (${r.source}${r.topic ? "/" + r.topic : ""}) ${r.summary}`);
}

function queryInsights(db: DatabaseType, sinceMs: number, limit: number): string[] {
  const rows = db
    .prepare(
      `SELECT id, category, summary, confidence FROM insights
       WHERE generated_at > ? ORDER BY confidence DESC, generated_at DESC LIMIT ?`,
    )
    .all(sinceMs, limit) as Array<{
    id: number;
    category: string;
    summary: string;
    confidence: number;
  }>;
  return rows.map(
    (r) => `[insight:${r.id}] (${r.category}, conf=${r.confidence.toFixed(2)}) ${r.summary}`,
  );
}

interface RawLlmRecommendation {
  title?: unknown;
  rationale?: unknown;
  evidence_observation_ids?: unknown;
  evidence_insight_ids?: unknown;
  assignee_email?: unknown;
  scope?: unknown;
  urgency?: unknown;
  confidence?: unknown;
}

function isValidScope(value: unknown): value is Recommendation["scope"] {
  return value === "ops" || value === "tactical" || value === "strategic";
}

function isValidLevel(value: unknown): value is Recommendation["urgency"] {
  return value === "low" || value === "medium" || value === "high";
}

function parseEvidence(obs: unknown, ins: unknown): string[] {
  const out: string[] = [];
  if (Array.isArray(obs)) {
    for (const id of obs) {
      if (typeof id === "number") {
        out.push(`obs:${id}`);
      }
    }
  }
  if (Array.isArray(ins)) {
    for (const id of ins) {
      if (typeof id === "number") {
        out.push(`insight:${id}`);
      }
    }
  }
  return out;
}

export function createOracle(deps: OracleDeps): Oracle {
  const store = new OracleStore(deps.db);

  async function callLlm(): Promise<Recommendation[]> {
    const [companyContext, directory] = await Promise.all([
      buildCompanyContext({ client: deps.firestoreClient }),
      buildPeopleDirectory({
        firestoreClient: deps.firestoreClient,
        libPath: deps.libPath,
        userAliases: deps.userAliases,
      }),
    ]);

    const observationSnippets = queryObservations(deps.db, Date.now() - 48 * 60 * 60 * 1000, 50);
    const insightSnippets = queryInsights(deps.db, Date.now() - 14 * 24 * 60 * 60 * 1000, 20);

    const prompt = buildPrompt(companyContext, directory, observationSnippets, insightSnippets);
    const raw = await deps.llm.complete(prompt, { model: "gemini-flash", temperature: 0.2 });

    const stripped = raw.trim().replace(/^```(?:json)?\n?|\n?```$/g, "");
    const parsed = JSON.parse(stripped) as { recommendations?: RawLlmRecommendation[] };
    if (!Array.isArray(parsed.recommendations)) {
      throw new Error("oracle: LLM response missing 'recommendations' array");
    }

    const directoryEmails = new Set(directory.map((d) => d.email));
    const slackByEmail = new Map(directory.map((d) => [d.email, d.slack_id]));
    const now = Date.now();
    const out: Recommendation[] = [];

    for (const rawRec of parsed.recommendations) {
      if (
        typeof rawRec.title !== "string" ||
        typeof rawRec.rationale !== "string" ||
        typeof rawRec.assignee_email !== "string"
      ) {
        continue;
      }
      if (!directoryEmails.has(rawRec.assignee_email)) {
        continue;
      }
      if (
        !isValidScope(rawRec.scope) ||
        !isValidLevel(rawRec.urgency) ||
        !isValidLevel(rawRec.confidence)
      ) {
        continue;
      }
      const evidence = parseEvidence(rawRec.evidence_observation_ids, rawRec.evidence_insight_ids);
      if (evidence.length === 0) {
        continue;
      }
      out.push({
        id: stableId(rawRec.title, evidence),
        title: rawRec.title,
        rationale: rawRec.rationale,
        evidence,
        assignee_email: rawRec.assignee_email,
        assignee_slack_id: slackByEmail.get(rawRec.assignee_email) ?? null,
        scope: rawRec.scope,
        urgency: rawRec.urgency,
        confidence: rawRec.confidence,
        generated_at: now,
      });
    }

    return out;
  }

  return {
    async recommendAll() {
      return callLlm();
    },

    async recommendForUser(slackUserId: string) {
      const all = await callLlm();
      return all.filter((r) => r.assignee_slack_id === slackUserId);
    },

    async runCycle() {
      const recs = await callLlm();
      store.upsertAll(recs);

      const filesWritten: string[] = [];
      const assigneeEmails = Array.from(new Set(recs.map((r) => r.assignee_email)));
      for (const email of assigneeEmails) {
        const list = store.queryAllForAssignee(email);
        const path = writePerPersonFile(deps.libPath, email, list);
        filesWritten.push(path);
      }

      const dmsSent: Array<{ assignee_email: string; rec_ids: string[] }> = [];
      if (deps.dmUser) {
        for (const email of assigneeEmails) {
          const slackId = recs.find((r) => r.assignee_email === email)?.assignee_slack_id ?? null;
          if (!slackId) {
            continue;
          }
          const newRecs = store.diffNewForAssignee(email).filter((r) => r.confidence === "high");
          if (newRecs.length === 0) {
            continue;
          }
          const toDM = newRecs.slice(0, MAX_DMS_PER_ASSIGNEE_PER_CYCLE);
          const bullets = toDM.map((r) => `• ${r.title}`).join("\n");
          const extra =
            newRecs.length > MAX_DMS_PER_ASSIGNEE_PER_CYCLE
              ? `\n_…and ${newRecs.length - MAX_DMS_PER_ASSIGNEE_PER_CYCLE} more in your file._`
              : "";
          try {
            await deps.dmUser(slackId, `Oracle: new on your plate\n\n${bullets}${extra}`);
            store.markDMsSent(toDM.map((r) => ({ rec_id: r.id, assignee_email: email })));
            dmsSent.push({ assignee_email: email, rec_ids: toDM.map((r) => r.id) });
          } catch {
            // DM failure — leave entries un-sent so next cycle retries
          }
        }
      }

      return { recommendations: recs, filesWritten, dmsSent };
    },
  };
}
