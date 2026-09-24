import pino from "pino";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MemoryJobLock, createJob } from "../src/lib/jobs";

const log = pino({ level: "silent" });

describe("job lock", () => {
  test("one holder at a time; refresh and release only for the holder; an expired hold is free", async () => {
    let t = 1_000;
    const lock = new MemoryJobLock(() => t);
    expect(await lock.acquire("k", "a", 100)).toBe(true);
    expect(await lock.acquire("k", "b", 100)).toBe(false);
    await lock.release("k", "b");
    expect(await lock.acquire("k", "b", 100)).toBe(false);
    t += 60;
    await lock.refresh("k", "a", 100);
    t += 60;
    expect(await lock.acquire("k", "b", 100)).toBe(false);
    t += 60;
    expect(await lock.acquire("k", "b", 100)).toBe(true);
    await lock.release("k", "b");
    expect(await lock.acquire("k", "c", 100)).toBe(true);
  });
});

describe("jobs", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("a round runs under the lock, is skipped while another instance holds it, and releases it afterwards", async () => {
    const lock = new MemoryJobLock(() => Date.now());
    let runs = 0;
    const job = createJob({ name: "t", intervalMs: 1_000, lockTtlMs: 10_000, lock, log, run: async () => void runs++ });
    await lock.acquire("job:t", "other", 10_000);
    expect(await job.round()).toBe("skipped");
    expect(runs).toBe(0);
    await lock.release("job:t", "other");
    expect(await job.round()).toBe("ran");
    expect(runs).toBe(1);
    expect(await lock.acquire("job:t", "other", 10_000)).toBe(true);
  });

  test("a slow round keeps refreshing the lock and a second call in the meantime is busy", async () => {
    const lock = new MemoryJobLock(() => Date.now());
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const job = createJob({ name: "slow", intervalMs: 1_000, lockTtlMs: 1_000, lock, log, run: () => gate });
    const first = job.round();
    await vi.advanceTimersByTimeAsync(1);
    expect(await job.round()).toBe("busy");
    await vi.advanceTimersByTimeAsync(2_500);
    expect(await lock.acquire("job:slow", "other", 1_000)).toBe(false);
    release();
    expect(await first).toBe("ran");
    expect(await lock.acquire("job:slow", "other", 1_000)).toBe(true);
  });

  test("the timer waits between rounds, never overlaps them, and stops on request", async () => {
    const lock = new MemoryJobLock(() => Date.now());
    let running = 0;
    let overlaps = 0;
    let runs = 0;
    const run = async () => {
      if (running > 0) overlaps++;
      running++;
      runs++;
      await new Promise((resolve) => setTimeout(resolve, 300));
      running--;
    };
    const stop = createJob({ name: "timer", intervalMs: 100, lockTtlMs: 1_000, lock, log, run }).start();
    await vi.advanceTimersByTimeAsync(2_050);
    expect(runs).toBe(5);
    expect(overlaps).toBe(0);
    stop();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(runs).toBe(5);
  });
});
