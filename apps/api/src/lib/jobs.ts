import { randomBytes } from "node:crypto";
import type Redis from "ioredis";
import type { Logger } from "pino";

/**
 * A lock the API instances share, held by a token while a job round runs. The server builds it on
 * Redis; tests use the in-memory one. A key is also used as a plain marker (`acquire` and let it
 * expire) for work that must not repeat within a window.
 */
export interface JobLock {
  /** True when the key was free and is now held by `token` for `ttlMs`. */
  acquire(key: string, token: string, ttlMs: number): Promise<boolean>;
  /** Extends the hold, only while `token` still holds the key. */
  refresh(key: string, token: string, ttlMs: number): Promise<void>;
  /** Releases the key, only while `token` holds it. */
  release(key: string, token: string): Promise<void>;
}

const RELEASE = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";
const REFRESH = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) else return 0 end";

export function redisJobLock(redis: Redis): JobLock {
  return {
    acquire: async (key, token, ttlMs) => (await redis.set(key, token, "PX", ttlMs, "NX")) === "OK",
    async refresh(key, token, ttlMs) {
      await redis.eval(REFRESH, 1, key, token, ttlMs);
    },
    async release(key, token) {
      await redis.eval(RELEASE, 1, key, token);
    },
  };
}

/** The same rules in one process, for tests. The clock is injectable. */
export class MemoryJobLock implements JobLock {
  private readonly held = new Map<string, { token: string; until: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  private holder(key: string) {
    const entry = this.held.get(key);
    if (entry && entry.until <= this.now()) this.held.delete(key);
    return this.held.get(key);
  }

  async acquire(key: string, token: string, ttlMs: number) {
    if (this.holder(key)) return false;
    this.held.set(key, { token, until: this.now() + ttlMs });
    return true;
  }

  async refresh(key: string, token: string, ttlMs: number) {
    const entry = this.holder(key);
    if (entry?.token === token) entry.until = this.now() + ttlMs;
  }

  async release(key: string, token: string) {
    if (this.holder(key)?.token === token) this.held.delete(key);
  }
}

export interface JobOptions {
  name: string;
  /** Time between the end of one round and the start of the next. */
  intervalMs: number;
  /** How long the lock outlives a crash; refreshed every half of it while a round runs. */
  lockTtlMs: number;
  lock: JobLock;
  log: Logger;
  run: () => Promise<unknown>;
}

export type RoundOutcome = "ran" | "skipped" | "busy";

/**
 * Runs `run` under the lock `job:<name>`. Rounds never overlap: another instance holding the lock
 * means `skipped`, a round still in flight in this process means `busy`, and the timer only starts
 * the next wait once a round has ended. The lock is refreshed while the round runs, so a slow round
 * neither loses it nor lets a second instance start.
 */
export function createJob(options: JobOptions) {
  const key = `job:${options.name}`;
  let inFlight = false;

  async function round(): Promise<RoundOutcome> {
    if (inFlight) return "busy";
    const token = randomBytes(16).toString("hex");
    if (!(await options.lock.acquire(key, token, options.lockTtlMs))) return "skipped";
    inFlight = true;
    const refresh = setInterval(() => {
      void options.lock.refresh(key, token, options.lockTtlMs).catch((err: unknown) => options.log.warn({ err, job: options.name }, "job: could not refresh the lock"));
    }, options.lockTtlMs / 2);
    try {
      await options.run();
      return "ran";
    } finally {
      clearInterval(refresh);
      inFlight = false;
      await options.lock.release(key, token).catch((err: unknown) => options.log.warn({ err, job: options.name }, "job: could not release the lock"));
    }
  }

  /** Starts the timer and returns the function that stops it. A round in flight finishes. */
  function start(): () => void {
    let stopped = false;
    let timer: NodeJS.Timeout | undefined;
    const schedule = () => {
      if (stopped) return;
      timer = setTimeout(() => {
        void round()
          .catch((err: unknown) => options.log.error({ err, job: options.name }, "job: round failed"))
          .finally(schedule);
      }, options.intervalMs);
      timer.unref();
    };
    schedule();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }

  return { round, start };
}
