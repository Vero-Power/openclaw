export interface SchedulerOptions {
  cycleFn: () => Promise<void>;
  intervalMs: number;
  featureFlagEnv?: string;
  onError?: (err: Error) => void;
}

export class SentinelScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private opts: SchedulerOptions) {}

  start(): void {
    if (this.opts.featureFlagEnv) {
      const value = process.env[this.opts.featureFlagEnv];
      if (value !== "1") {
        return;
      }
    }
    if (this.timer !== null) {
      return;
    }
    this.timer = setInterval(() => {
      void this.opts.cycleFn().catch((err) => {
        if (this.opts.onError) {
          this.opts.onError(err as Error);
        }
      });
    }, this.opts.intervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
