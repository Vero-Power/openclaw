import type { Database as DatabaseType } from "better-sqlite3";
import type { ObserverRegistry } from "./observer.js";

export interface RunObserversOptions {
  registry: ObserverRegistry;
  db: DatabaseType;
}

export interface ObserverRunResult {
  observationsWritten: number;
  errors: Array<{ observer: string; error: string }>;
}

export async function runObservers(opts: RunObserversOptions): Promise<ObserverRunResult> {
  const { registry, db } = opts;
  const observers = registry.list();
  const errors: ObserverRunResult["errors"] = [];

  const watermarkStmt = db.prepare(
    "SELECT last_observed_at FROM observer_watermarks WHERE source = ?",
  );
  const insertObservation = db.prepare(
    `INSERT INTO observations (source, topic, timestamp, summary, data, metrics, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const upsertWatermark = db.prepare(
    `INSERT INTO observer_watermarks (source, last_observed_at) VALUES (?, ?)
     ON CONFLICT(source) DO UPDATE SET last_observed_at = excluded.last_observed_at`,
  );

  let written = 0;

  const tasks = observers.map(async (obs) => {
    const wmRow = watermarkStmt.get(obs.name) as { last_observed_at: number } | undefined;
    const since = wmRow?.last_observed_at ?? 0;
    const now = Date.now();
    try {
      const results = await obs.observe(since);
      for (const r of results) {
        insertObservation.run(
          r.source,
          r.topic ?? null,
          r.timestamp,
          r.summary,
          r.data ? JSON.stringify(r.data) : null,
          r.metrics ? JSON.stringify(r.metrics) : null,
          now,
        );
        written++;
      }
      upsertWatermark.run(obs.name, now);
    } catch (err) {
      errors.push({ observer: obs.name, error: (err as Error).message });
    }
  });

  await Promise.all(tasks);

  return { observationsWritten: written, errors };
}
