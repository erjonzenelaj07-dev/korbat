import pino from "pino";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { EXPLORE_V1 } from "@korbat/contracts";
import { MemoryJobLock, type JobLock } from "../../src/lib/jobs";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { WITHOUT_MEDIA, type SocialDeps } from "../../src/social/context";
import { createExploreJob, startExplore } from "../../src/social/explore";
import type { ExploreRefresh, SocialRepo } from "../../src/social/repo";

const MINUTE = 60_000;
/** The refresh interval of the published formula: five minutes. */
const INTERVAL = EXPLORE_V1.refreshMinutes * MINUTE;

interface LogLine {
  level: number;
  msg: string;
  [field: string]: unknown;
}

/**
 * The Explore job on a fake repository, under fake timers: each round takes the next answer from a queue (an Error is
 * thrown, an empty queue answers skipped) and records the time it was asked to rank as of. The logger keeps every line
 * without the time, pid and hostname, so a line holds only its level, its message and what the job logged. The lock
 * records the key and hold time of every acquisition.
 */
function harness() {
  const answers: (ExploreRefresh | Error)[] = [];
  const asked: number[] = [];
  const lines: LogLine[] = [];
  const holds: { key: string; ttlMs: number }[] = [];
  const repo = {
    async refreshExplore(asOf: Date): Promise<ExploreRefresh> {
      asked.push(asOf.getTime());
      const answer = answers.shift() ?? { skipped: true };
      if (answer instanceof Error) throw answer;
      return answer;
    },
  } satisfies Pick<SocialRepo, "refreshExplore">;
  const deps: SocialDeps = {
    repo: repo as unknown as SocialRepo,
    media: WITHOUT_MEDIA,
    limits: new MemoryStore(() => Date.now()),
    log: pino({ level: "info", base: null, timestamp: false }, { write: (line: string) => void lines.push(JSON.parse(line) as LogLine) }),
    now: () => new Date(),
  };
  const memory = new MemoryJobLock(() => Date.now());
  const lock: JobLock = {
    acquire: (key, token, ttlMs) => (holds.push({ key, ttlMs }), memory.acquire(key, token, ttlMs)),
    refresh: (key, token, ttlMs) => memory.refresh(key, token, ttlMs),
    release: (key, token) => memory.release(key, token),
  };
  return { deps, answers, asked, lines, holds, lock };
}

const ranked = (generation: number): ExploreRefresh => ({ skipped: false, generation, candidates: 10 + generation, items: generation, tookMs: 100 + generation });

describe("the Explore job", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("starts with a round at once, then runs one every five minutes, each ranking as of its own time, until stopped", async () => {
    const h = harness();
    const start = Date.now();
    const stop = startExplore(h.deps, h.lock);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.asked).toEqual([start]);
    await vi.advanceTimersByTimeAsync(INTERVAL - 1);
    expect(h.asked).toEqual([start]);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.asked).toEqual([start, start + INTERVAL]);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(h.asked).toEqual([start, start + INTERVAL, start + 2 * INTERVAL]);
    stop();
    await vi.advanceTimersByTimeAsync(3 * INTERVAL);
    expect(h.asked).toHaveLength(3);
  });

  test("every round holds the shared lock job:explore-refresh for five minutes, and skips while another instance holds it", async () => {
    const h = harness();
    const job = createExploreJob(h.deps, h.lock);
    expect(await job.round()).toBe("ran");
    expect(h.holds).toEqual([{ key: "job:explore-refresh", ttlMs: INTERVAL }]);
    await h.lock.acquire("job:explore-refresh", "another instance", INTERVAL);
    expect(await job.round()).toBe("skipped");
    expect(h.asked).toHaveLength(1);
    await h.lock.release("job:explore-refresh", "another instance");
    expect(await job.round()).toBe("ran");
    expect(h.asked).toHaveLength(2);
  });

  test("a round that ranks logs one line with exactly its generation, candidates, items and milliseconds; a skipped round logs nothing", async () => {
    const h = harness();
    h.answers.push(ranked(7), { skipped: true });
    const job = createExploreJob(h.deps, h.lock);
    expect(await job.round()).toBe("ran");
    expect(h.lines).toEqual([{ level: 30, msg: "explore: ranking refreshed", generation: 7, candidates: 17, items: 7, tookMs: 107 }]);
    expect(await job.round()).toBe("ran");
    expect(h.asked).toHaveLength(2);
    expect(h.lines).toHaveLength(1);
  });

  test("a failed round at start is logged as the timer logs one, and the timer runs on; so does a failed timer round", async () => {
    const h = harness();
    h.answers.push(new Error("the database is unreachable"), ranked(1), new Error("the statement timed out"), ranked(2));
    const stop = startExplore(h.deps, h.lock);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.asked).toHaveLength(1);
    expect(h.lines).toEqual([
      expect.objectContaining({ level: 50, msg: "job: round failed", job: "explore-refresh", err: expect.objectContaining({ message: "the database is unreachable" }) }),
    ]);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(h.asked).toHaveLength(2);
    expect(h.lines.slice(1)).toEqual([{ level: 30, msg: "explore: ranking refreshed", generation: 1, candidates: 11, items: 1, tookMs: 101 }]);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(h.lines.slice(2)).toEqual([
      expect.objectContaining({ level: 50, msg: "job: round failed", job: "explore-refresh", err: expect.objectContaining({ message: "the statement timed out" }) }),
    ]);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(h.asked).toHaveLength(4);
    expect(h.lines.slice(3)).toEqual([{ level: 30, msg: "explore: ranking refreshed", generation: 2, candidates: 12, items: 2, tookMs: 102 }]);
    stop();
  });
});
