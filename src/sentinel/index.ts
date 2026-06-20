import { homedir } from "node:os";
import { join } from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import { SLACK_USER_ALIASES } from "../triage/actions/slack/aliases.js";
import type { LlmClient } from "../triage/llm-client.js";
import { ConversationStore } from "./conversation-store.js";
import { Curator } from "./curator.js";
import { openSentinelDb } from "./db.js";
import { createEmbeddingService } from "./embeddings/service.js";
import { FollowupProcessor, type SpawnTaskInput } from "./followup-processor.js";
import { FollowupStore } from "./followup-store.js";
import { Inquirer } from "./inquirer.js";
import { ensureLibrarySkeleton, regenerateIndex } from "./library.js";
import { Monetizer } from "./monetizer.js";
import { runObservers } from "./observer-runner.js";
import { ObserverRegistry } from "./observer.js";
import { createCoperniqObserver } from "./observers/coperniq.js";
import { createExternalContextObserver } from "./observers/external-context.js";
import { createDefaultCompanyContextClient } from "./observers/external-context/company-context.js";
import { createGcpFunctionsObserver } from "./observers/gcp-functions.js";
import { createIndustryContextObserver } from "./observers/industry-context.js";
import { createLaunchAgentsObserver } from "./observers/launchagents.js";
import { createSelfObserver } from "./observers/self.js";
import { createSlackChannelsObserver } from "./observers/slack-channels.js";
import { createWeatherObserver } from "./observers/weather.js";
import { createOracle, type Oracle, type Recommendation } from "./oracle.js";
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
  oracle: {
    recommendForUser(slackUserId: string): Promise<Recommendation[]>;
  };
}

export function createSentinel(deps: SentinelDeps): Sentinel {
  const libPath = deps.libPath ?? join(homedir(), ".openclaw/jr-library");
  const sentinelDbPath = deps.sentinelDbPath ?? join(homedir(), ".openclaw/sentinel.db");
  ensureLibrarySkeleton(libPath);
  const db = openSentinelDb(sentinelDbPath);

  // Minimal no-op adapter — Task 8 will replace this with the real Gemini
  // adapter once it wires the API key through SentinelDeps.
  const noOpAdapter = {
    embed: async (_text: string): Promise<Float32Array> => new Float32Array(768),
  };
  const embeddingService = createEmbeddingService({ db, adapter: noOpAdapter });

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
  registry.register(createGcpFunctionsObserver({ db }));
  registry.register(createExternalContextObserver({ db }));
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

  // Oracle: F3 action-recommendation engine.
  // Lazy-constructed because the default Firestore client factory is async
  // and createSentinel is sync. On first cycle, the oracle is built and cached.
  let oracleInstance: Oracle | null = null;
  async function getOracle(): Promise<Oracle> {
    if (oracleInstance) {
      return oracleInstance;
    }
    const firestoreClient = await createDefaultCompanyContextClient();
    oracleInstance = createOracle({
      db,
      llm: deps.llm,
      libPath,
      firestoreClient,
      userAliases: SLACK_USER_ALIASES,
      dmUser: deps.dmUser,
      embeddings: embeddingService,
    });
    return oracleInstance;
  }

  let lastDailyReportDate: string | null = null;
  let lastWeeklyReportWeek: number | null = null;
  let lastIdeasReportWeek: number | null = null;

  async function runCycleOnce(): Promise<void> {
    // 0. Expire stale conversations: drop when the PERSON's last reply is older
    //    than the TTL. JR's own follow-up turns don't reset the timer. Inline check
    //    in handleConversationReply uses the same rule and catches per-message
    //    staleness between sweeps.
    //    Override TTL with OPENCLAW_CONVO_STALE_HOURS (defaults to 1).
    const staleHoursRaw = process.env.OPENCLAW_CONVO_STALE_HOURS;
    const staleHours =
      Number.isFinite(Number(staleHoursRaw)) && Number(staleHoursRaw) > 0
        ? Number(staleHoursRaw)
        : 1;
    conversationStore.expireStale(staleHours * 60 * 60 * 1000);

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

    // 4.5 F3 Oracle — generate and persist per-person recommendations,
    // DM on new high-confidence actions. Guarded so a failure here does NOT
    // block the rest of the cycle (index regeneration, reports).
    try {
      const o = await getOracle();
      await o.runCycle();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[sentinel] oracle cycle failed:", (err as Error).message);
    }

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

  return {
    scheduler,
    db,
    conversationStore,
    channelResolver,
    runCycleOnce,
    oracle: {
      recommendForUser: async (slackUserId: string) => {
        const o = await getOracle();
        return o.recommendForUser(slackUserId);
      },
    },
  };
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
