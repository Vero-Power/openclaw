import { homedir } from "node:os";
import { join } from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import { SLACK_USER_ALIASES } from "../triage/actions/slack/aliases.js";
import type { LlmClient } from "../triage/llm-client.js";
import { ConversationStore } from "./conversation-store.js";
import { Curator } from "./curator.js";
import { openSentinelDb } from "./db.js";
import { FollowupProcessor, type SpawnTaskInput } from "./followup-processor.js";
import { FollowupStore } from "./followup-store.js";
import { Inquirer } from "./inquirer.js";
import { ensureLibrarySkeleton, regenerateIndex } from "./library.js";
import { Monetizer } from "./monetizer.js";
import { runObservers } from "./observer-runner.js";
import { ObserverRegistry } from "./observer.js";
import { createCoperniqObserver } from "./observers/coperniq.js";
import { createIndustryContextObserver } from "./observers/industry-context.js";
import { createLaunchAgentsObserver } from "./observers/launchagents.js";
import { createSelfObserver } from "./observers/self.js";
import { createSlackChannelsObserver } from "./observers/slack-channels.js";
import { createWeatherObserver } from "./observers/weather.js";
import { Reporter } from "./reporter.js";
import { SentinelScheduler } from "./scheduler.js";
import { ChannelNameResolver } from "./slack-resolvers.js";
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
      info(args: { channel: string }): Promise<{
        ok: boolean;
        channel?: { id?: string; name?: string; is_archived?: boolean };
        error?: string;
      }>;
    };
  };
  allowedSlackChannels: string[];
  triageDbPath: string;
  kalebUserId?: string;
  ridgeUserId?: string;
  dmUser?: (userId: string, text: string) => Promise<void>;
  libPath?: string;
  sentinelDbPath?: string;
  spawnTask?: (input: SpawnTaskInput) => Promise<void>;
}

export interface Sentinel {
  scheduler: SentinelScheduler;
  db: DatabaseType;
  conversationStore: ConversationStore;
  channelResolver: ChannelNameResolver;
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
  registry.register(createWeatherObserver());
  registry.register(createCoperniqObserver({ db }));
  registry.register(createIndustryContextObserver({ llm: deps.llm }));

  const conversationStore = new ConversationStore(db);
  const channelResolver = new ChannelNameResolver(deps.slackClient);
  const followupStore = new FollowupStore(db);
  const followupProcessor = new FollowupProcessor({
    store: followupStore,
    db,
    conversationStore,
    userAliases: SLACK_USER_ALIASES,
    dmUser: deps.dmUser,
    channelResolver,
    spawnTask: deps.spawnTask,
  });

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
    userAliases: SLACK_USER_ALIASES,
    dmUser: deps.dmUser,
    conversationStore,
    channelResolver,
  });

  let lastDailyReportDate: string | null = null;
  let lastWeeklyReportWeek: number | null = null;
  let lastIdeasReportWeek: number | null = null;

  async function runCycleOnce(): Promise<void> {
    // 0. Expire stale conversations (idle > 3 days → dropped)
    conversationStore.expireStale(3 * 24 * 60 * 60 * 1000);

    // 0.5 Drain pending follow-ups (collisions from earlier cycles, transient failures)
    if (process.env.OPENCLAW_FOLLOWUPS === "1") {
      await followupProcessor.processPending();
    }

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

  return { scheduler, db, conversationStore, channelResolver, runCycleOnce };
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
export { ChannelNameResolver } from "./slack-resolvers.js";
export type { ConversationsInfoClient } from "./slack-resolvers.js";
