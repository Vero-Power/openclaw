import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SentinelScheduler } from "../../src/sentinel/scheduler.js";

describe("SentinelScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("invokes the cycle callback every 2 hours", async () => {
    const cycle = vi.fn(async () => {});
    const scheduler = new SentinelScheduler({
      cycleFn: cycle,
      intervalMs: 2 * 60 * 60 * 1000,
    });
    scheduler.start();
    expect(cycle).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    expect(cycle).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    expect(cycle).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it("stops the interval when stop() is called", async () => {
    const cycle = vi.fn(async () => {});
    const scheduler = new SentinelScheduler({
      cycleFn: cycle,
      intervalMs: 1000,
    });
    scheduler.start();
    scheduler.stop();
    vi.advanceTimersByTime(5000);
    expect(cycle).toHaveBeenCalledTimes(0);
  });

  it("does not start if feature flag is unset", async () => {
    const cycle = vi.fn(async () => {});
    delete process.env.OPENCLAW_SENTINEL_ENABLED;
    const scheduler = new SentinelScheduler({
      cycleFn: cycle,
      intervalMs: 1000,
      featureFlagEnv: "OPENCLAW_SENTINEL_ENABLED",
    });
    scheduler.start();
    vi.advanceTimersByTime(5000);
    expect(cycle).toHaveBeenCalledTimes(0);
  });

  it("isolates cycle errors — one bad cycle doesn't stop the schedule", async () => {
    const cycle = vi
      .fn()
      .mockRejectedValueOnce(new Error("kaboom"))
      .mockResolvedValueOnce(undefined);
    process.env.OPENCLAW_SENTINEL_ENABLED = "1";
    const scheduler = new SentinelScheduler({
      cycleFn: cycle,
      intervalMs: 1000,
      featureFlagEnv: "OPENCLAW_SENTINEL_ENABLED",
    });
    scheduler.start();
    vi.advanceTimersByTime(1000);
    await Promise.resolve();
    await Promise.resolve();
    vi.advanceTimersByTime(1000);
    await Promise.resolve();
    await Promise.resolve();
    expect(cycle).toHaveBeenCalledTimes(2);
    scheduler.stop();
    delete process.env.OPENCLAW_SENTINEL_ENABLED;
  });
});
