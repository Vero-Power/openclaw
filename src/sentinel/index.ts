import { homedir } from "node:os";
import { join } from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import type { LlmClient } from "../triage/llm-client.js";
import { ConversationStore } from "./conversation-store.js";
import { Curator } from "./curator.js";
import { openSentinelDb } from "./db.js";
import { Inquirer } from "./inquirer.js";
import { ensureLibrarySkeleton, regenerateIndex } from "./library.js";
import { Monetizer } from "./monetizer.js";
import { runObservers } from "./observer-runner.js";
import { ObserverRegistry } from "./observer.js";
import { createLaunchAgentsObserver } from "./observers/launchagents.js";
import { createSelfObserver } from "./observers/self.js";
import { createSlackChannelsObserver } from "./observers/slack-channels.js";
import { Reporter } from "./reporter.js";
import { SentinelScheduler } from "./scheduler.js";
import { Synthesizer } from "./synthesizer.js";

export interface SentinelDeps {
  llm: LlmClient;
  slackClient: {
    conversations: {
      history(args: {
        channel: string;
        oldest?: string;
        limit?: number;
      }): Promise<{ ok: boolean; messages?: Array<{ user?: string; text?: string; ts?: string }> }>;
    };
  };
  allowedSlackChannels: string[];
  triageDbPath: string;
  kalebUserId?: string;
  ridgeUserId?: string;
  dmUser?: (userId: string, text: string) => Promise<void>;
  libPath?: string;
  sentinelDbPath?: string;
}

export interface Sentinel {
  scheduler: SentinelScheduler;
  db: DatabaseType;
  conversationStore: ConversationStore;
  runCycleOnce(): Promise<void>;
}

export function createSentinel(deps: SentinelDeps): Sentinel {
  const libPath = deps.libPath ?? join(homedir(), ".openclaw/jr-library");
  const sentinelDbPath = deps.sentinelDbPath ?? join(homedir(), ".openclaw/sentinel.db");
  ensureLibrarySkeleton(libPath);
  const db = openSentinelDb(sentinelDbPath);

  const registry = new ObserverRegistry();
  registry.register(createSelfObserver({ triageDbPath: deps.triageDbPath }));
  registry.register(
    createSlackChannelsObserver({
      client: deps.slackClient,
      allowedChannels: deps.allowedSlackChannels,
    }),
  );
  registry.register(createLaunchAgentsObserver({ filterPrefix: "openclaw" }));

  const conversationStore = new ConversationStore(db);

  const synthesizer = new Synthesizer(deps.llm);
  const curator = new Curator(deps.llm);
  const reporter = new Reporter({
    db,
    libPath,
    dmUser: deps.dmUser,
    kalebUserId: deps.kalebUserId,
    ridgeUserId: deps.ridgeUserId,
  });
  const monetizer = new Monetizer({ llm: deps.llm, db });
  const inquirer = new Inquirer({
    llm: deps.llm,
    db,
    libPath,
    dmUser: deps.dmUser,
    conversationStore,
  });

  let lastDailyReportDate: string | null = null;
  let lastWeeklyReportWeek: number | null = null;
  let lastIdeasReportWeek: number | null = null;

  async function runCycleOnce(): Promise<void> {
    // 0. Expire stale conversations (idle > 3 days → dropped)
    conversationStore.expireStale(3 * 24 * 60 * 60 * 1000);

    // 1. Observe
    const runResult = await runObservers({ registry, db });

    // 2. Synthesize over fresh observations
    const lookback = Date.now() - 2 * 60 * 60 * 1000;
    const recentObs = db
      .prepare(
        "SELECT id, source, topic, timestamp, summary, data, metrics FROM observations WHERE timestamp >= ? ORDER BY id",
      )
      .all(lookback) as Array<{
      id: number;
      source: string;
      topic: string | null;
      timestamp: number;
      summary: string;
      data: string | null;
      metrics: string | null;
    }>;
    const insights = await synthesizer.synthesize(
      recentObs.map((o) => ({
        id: o.id,
        source: o.source,
        topic: o.topic ?? undefined,
        timestamp: o.timestamp,
        summary: o.summary,
        data: o.data ? JSON.parse(o.data) : undefined,
        metrics: o.metrics ? JSON.parse(o.metrics) : undefined,
      })),
    );

    // 3. Curate insights into the library
    const insertInsight = db.prepare(
      `INSERT INTO insights (category, summary, evidence, derived_from, confidence, generated_at, filed_to) VALUES (?,?,?,?,?,?,?)`,
    );
    for (const ins of insights) {
      const filed = await curator.fileInsight(ins, libPath);
      insertInsight.run(
        ins.category,
        ins.summary,
        ins.evidence,
        JSON.stringify(ins.derived_from),
        ins.confidence,
        ins.generated_at,
        filed.filedTo,
      );
    }

    // 4. Inquirer (manual-review mode in Phase A — no DMs)
    await inquirer.formulateQuestions();

    // 5. Regenerate INDEX.md
    regenerateIndex(libPath);

    // 6. Daily report once per day
    const todayKey = new Date().toISOString().slice(0, 10);
    if (lastDailyReportDate !== todayKey) {
      await reporter.writeDailySummary();
      lastDailyReportDate = todayKey;
    }

    // 7. Weekly digest on Friday
    const now = new Date();
    const isFriday = now.getDay() === 5;
    const isoWeek = Math.ceil(
      ((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 86400000 + 1) / 7,
    );
    if (isFriday && lastWeeklyReportWeek !== isoWeek) {
      await reporter.writeWeeklyDigest();
      lastWeeklyReportWeek = isoWeek;
    }

    // 8. Ideas report on Sunday
    const isSunday = now.getDay() === 0;
    if (isSunday && lastIdeasReportWeek !== isoWeek) {
      await monetizer.proposeWeekly();
      await reporter.writeIdeasReport();
      lastIdeasReportWeek = isoWeek;
    }

    void runResult; // already logged via observer-runner returns; suppress unused warning
  }

  const scheduler = new SentinelScheduler({
    cycleFn: runCycleOnce,
    intervalMs: 2 * 60 * 60 * 1000,
    featureFlagEnv: "OPENCLAW_SENTINEL_ENABLED",
    onError: (err) => {
      // eslint-disable-next-line no-console
      console.error("[sentinel] cycle failed:", err.message);
    },
  });

  return { scheduler, db, conversationStore, runCycleOnce };
}

export { SentinelScheduler } from "./scheduler.js";
export { ensureLibrarySkeleton, regenerateIndex } from "./library.js";
export { openSentinelDb } from "./db.js";
export { ConversationStore } from "./conversation-store.js";
export { handleConversationReply } from "./conversation-handler.js";
export type {
  ConversationReplyEvent,
  ConversationReplyCtx,
  ConversationReplyDeps,
} from "./conversation-handler.js";
