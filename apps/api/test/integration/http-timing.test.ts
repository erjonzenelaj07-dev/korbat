import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import Redis from "ioredis";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth, redisKv, type Auth } from "../../src/auth";
import { randomToken } from "../../src/auth/crypto";
import { hashPassword } from "../../src/auth/passwords";
import { loadConfig, type Config } from "../../src/config";
import { smtpMailer } from "../../src/mail/smtp";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { Browser } from "./http-client";

const ROUNDS = 20;
const MAX_MEDIAN_DIFFERENCE_MS = 50;
const PASSWORD = "correct horse battery staple";

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * Whether an email has an account must not show in response times (1a spec, section 10). Known and
 * unknown requests alternate, each from its own client address, so rate limits and drift affect both
 * sides alike.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: response timing does not reveal accounts", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let redis: Redis;
  let auth: Auth;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
    redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
    auth = createAuth({
      config,
      logger,
      authDb,
      kv: redisKv(redis, `korbat:test:${randomUUID()}:`),
      mailer: smtpMailer(config.SMTP_URL, config.MAIL_FROM),
      profiles: createProfileStore(apiDb),
      turnstile: { verify: async () => true },
      breachChecker: { isBreached: async () => false },
    });
    app = createApp({ config, logger, rateLimitStore: new MemoryStore(), healthChecks: {}, auth });
  });
  afterAll(async () => {
    await Promise.allSettled([closeDb(authDb), closeDb(apiDb), redis.quit()]);
  });

  const newEmail = (prefix: string) => `${prefix}-${randomUUID()}@korbat.local`;

  async function knownAccounts(passwordHash: string | null): Promise<string[]> {
    const emails: string[] = [];
    for (let i = 0; i <= ROUNDS; i++) {
      const email = newEmail("timing-known");
      const user = await auth.deps.repo.createUser({ email, termsVersion: config.TERMS_VERSION, now: new Date() });
      if (passwordHash) await auth.deps.repo.setPasswordHash(user.id, passwordHash, new Date());
      emails.push(email);
    }
    return emails;
  }

  /** Runs one warm-up pair, then ROUNDS alternating pairs; returns the median of each side. */
  async function compare(send: (email: string) => Promise<Response>, known: string[], expectedStatus: number) {
    const timed = async (email: string) => {
      const started = performance.now();
      const res = await send(email);
      await res.arrayBuffer();
      expect(res.status).toBe(expectedStatus);
      return performance.now() - started;
    };
    await timed(known[ROUNDS]!);
    await timed(newEmail("timing-warmup"));
    const knownMs: number[] = [];
    const unknownMs: number[] = [];
    for (let i = 0; i < ROUNDS; i++) {
      knownMs.push(await timed(known[i]!));
      unknownMs.push(await timed(newEmail("timing-unknown")));
    }
    return { known: median(knownMs), unknown: median(unknownMs) };
  }

  test("email/start: known and unknown emails differ by less than 50 ms on the median of 20 requests", { timeout: 120_000 }, async () => {
    const known = await knownAccounts(null);
    const result = await compare(
      (email) => new Browser(app, config.APP_ORIGIN).fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } }),
      known,
      200,
    );
    expect(Math.abs(result.known - result.unknown), `median known ${result.known.toFixed(1)} ms, unknown ${result.unknown.toFixed(1)} ms`).toBeLessThan(MAX_MEDIAN_DIFFERENCE_MS);
  });

  test("password/signin: known and unknown emails differ by less than 50 ms on the median of 20 requests", { timeout: 120_000 }, async () => {
    const known = await knownAccounts(await hashPassword(PASSWORD));
    const result = await compare(
      (email) =>
        new Browser(app, config.APP_ORIGIN).fetch("/api/auth/password/signin", {
          json: { email, password: "not the right password", turnstileToken: "ok", deviceId: randomToken(), platform: "web" },
        }),
      known,
      401,
    );
    expect(Math.abs(result.known - result.unknown), `median known ${result.known.toFixed(1)} ms, unknown ${result.unknown.toFixed(1)} ms`).toBeLessThan(MAX_MEDIAN_DIFFERENCE_MS);
  });
});
