import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type Redis from "ioredis";
import type { AppEnv } from "../env";
import { errorBody } from "../lib/errors";

export interface RateLimitStore {
  /** Increments the counter for key and returns the new count plus ms until the window resets. */
  hit(key: string, windowMs: number): Promise<{ count: number; resetMs: number }>;
}

export class MemoryStore implements RateLimitStore {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly now: () => number = Date.now) {}
  async hit(key: string, windowMs: number) {
    const t = this.now();
    const b = this.buckets.get(key);
    if (!b || b.resetAt <= t) {
      this.buckets.set(key, { count: 1, resetAt: t + windowMs });
      return { count: 1, resetMs: windowMs };
    }
    b.count += 1;
    return { count: b.count, resetMs: b.resetAt - t };
  }
}

const LUA = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
return {c, ttl}
`;

type RedisWithHit = Redis & { korbatRateHit(key: string, windowMs: number): Promise<[number, number]> };

export class RedisStore implements RateLimitStore {
  private readonly redis: RedisWithHit;
  constructor(redis: Redis) {
    redis.defineCommand("korbatRateHit", { numberOfKeys: 1, lua: LUA });
    this.redis = redis as RedisWithHit;
  }
  async hit(key: string, windowMs: number) {
    const [count, ttl] = await this.redis.korbatRateHit(`rl:${key}`, windowMs);
    return { count, resetMs: ttl > 0 ? ttl : windowMs };
  }
}

export interface RateLimitOptions {
  name: string;
  store: RateLimitStore;
  limit: number;
  windowMs: number;
  key: (c: Context<AppEnv>) => string;
}

export function rateLimit(opts: RateLimitOptions) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const { count, resetMs } = await opts.store.hit(`${opts.name}:${opts.key(c)}`, opts.windowMs);
    const resetSec = Math.max(1, Math.ceil(resetMs / 1000));
    c.header("RateLimit-Limit", String(opts.limit));
    c.header("RateLimit-Remaining", String(Math.max(0, opts.limit - count)));
    c.header("RateLimit-Reset", String(resetSec));
    if (count > opts.limit) {
      c.header("Retry-After", String(resetSec));
      return c.json(errorBody("rate_limited", "Too many requests", c.get("requestId")), 429);
    }
    await next();
  });
}

/** Cloudflare sets cf-connecting-ip; Caddy forwards it. Anything else is a direct/dev connection. */
export function clientIp(c: Context<AppEnv>): string {
  return c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "direct";
}
