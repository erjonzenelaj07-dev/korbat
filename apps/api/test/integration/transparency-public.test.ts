import { sql } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import Redis from "ioredis";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PublicFacts, PublicTransparency, RECIPIENT_RULES } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth } from "../../src/auth";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig, type Config } from "../../src/config";
import type { AppEnv } from "../../src/env";
import { MemoryMailer } from "../../src/mail/memory";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { createSocial } from "../../src/social";
import { createTransparency, sketchKeys, type Transparency } from "../../src/transparency";

/**
 * The public routes, the recipients' count on the real Valkey and the transparency job (3d design, sections 7.5, 7.6,
 * 7.14 and 10.6; Task 4; invariants 22 and 23). The app is the real one with the auth, social and transparency modules,
 * wired as index.ts wires them (auth.onSeen); its clock stands in 2009, so every sketch, salt and month it writes is of a
 * time nothing else in the test database or the test's Valkey database holds, and the test deletes what it wrote.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the public routes, the recipients' count and the transparency job (3d Task 4)", () => {
  let config: Config;
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  let redis: Redis;
  let app: ReturnType<typeof createApp>;
  let transparency: Transparency;
  let resolved = 0;
  /** The modules' clock: a May morning of 2009, which a test moves. */
  let clock = new Date("2009-05-17T10:00:00.000Z");
  const YEAR = 2008;
  const logger = pino({ level: "silent" });

  function build(overrides: Partial<Config> = {}) {
    const settings = { ...config, ...overrides };
    const auth = createAuth({
      config: settings,
      logger,
      authDb,
      kv: new MemoryKv(),
      mailer: new MemoryMailer(),
      profiles: createProfileStore(apiDb),
      turnstile: { verify: async () => true },
      breachChecker: { isBreached: async () => false },
    });
    const module = createTransparency({ apiDb, redis, config: settings, logger, now: () => clock });
    auth.onSeen(module.forAuth);
    // The session's resolution, counted: the public routes must never reach it.
    const resolveSession: MiddlewareHandler<AppEnv> = (c, next) => {
      resolved++;
      return auth.resolveSession(c, next);
    };
    const social = createSocial({ apiDb, rateLimitStore: new MemoryStore(), logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth() });
    return { module, app: createApp({ config: settings, logger, rateLimitStore: new MemoryStore(), healthChecks: {}, auth: { ...auth, resolveSession }, social, transparency: module }) };
  }

  /** Every key of the three patterns the count writes. */
  const countKeys = async () => (await Promise.all(["mau:in:*", "mau:out:*", "mau:salt:*"].map((pattern) => redis.keys(pattern)))).flat().sort();
  const removeKeys = async () => {
    const keys = await countKeys();
    if (keys.length > 0) await redis.del(...keys);
  };
  const removeYear = (year: number) => migrateDb.execute(sql`delete from public.transparency_editions where year = ${year}`);
  const removeMonths = () => migrateDb.execute(sql`delete from public.recipient_months where month < '2010-01-01'::date`);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 200));

  beforeAll(async () => {
    config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 1 });
    redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
    ({ app, module: transparency } = build());
    await removeKeys();
  });
  afterAll(async () => {
    await removeKeys();
    await removeYear(YEAR);
    await removeMonths();
    redis.disconnect();
    await Promise.all([closeDb(apiDb), closeDb(authDb), closeDb(migrateDb)]);
  });

  const carried = { cookie: "korbat_session=abc; __Host-korbat_session=def", authorization: `Bearer kb1_${"a".repeat(43)}` };

  test("GET /api/public/facts names every tool off, answers no-cache, and never reaches the session's resolution", async () => {
    resolved = 0;
    const res = await app.request("/api/public/facts", { headers: carried });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    const facts = PublicFacts.parse(await res.json());
    expect([facts.r1.state, facts.match.state, facts.edge.on, facts.witness.on, facts.recipientsSignedOut]).toEqual(["off", "off", false, false, true]);
    expect(resolved).toBe(0);
    // A server with the test adapter at the edge on a closed site, and signed-out readers not counted, says so.
    const other = build({ EDGE_PURGE: "test", APP_SITE: "closed", RECIPIENTS_SIGNED_OUT: "off" }).app;
    expect(PublicFacts.parse(await (await other.request("/api/public/facts")).json())).toMatchObject({ edge: { on: true, test: true }, recipientsSignedOut: false });
  });

  test("GET /api/public/transparency answers every year's editions with their older versions, public for an hour, and reads no session", async () => {
    const empty = await app.request("/api/public/transparency");
    expect(empty.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(PublicTransparency.parse(await empty.json()).editions.filter((edition) => edition.year === YEAR)).toEqual([]);
    try {
      await migrateDb.execute(sql`select public.edition_publish(${YEAR}::int, 'first')`);
      await migrateDb.execute(sql`select public.edition_publish(${YEAR}::int, 'correction')`);
      resolved = 0;
      const res = await app.request("/api/public/transparency", { headers: carried });
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
      const answer = PublicTransparency.parse(await res.json());
      const edition = answer.editions.find((entry) => entry.year === YEAR)!;
      const today = new Date().toISOString().slice(0, 10);
      expect({ version: edition.version, reason: edition.reason, publishedOn: edition.publishedOn, older: edition.older.map((older) => [older.version, older.reason, older.replacedOn]) }).toEqual({
        version: 2,
        reason: "correction",
        publishedOn: today,
        older: [[1, "first", today]],
      });
      expect(resolved).toBe(0);
      // Nothing in it names a person, a post or a decision's day.
      expect(JSON.stringify(answer)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-|@|decidedAt|chainSeq/);
    } finally {
      await removeYear(YEAR);
    }
  });

  test("both routes stand behind the global limit, as every route of the app does", async () => {
    const store = new MemoryStore();
    const auth = createAuth({ config, logger, authDb, kv: new MemoryKv(), mailer: new MemoryMailer(), profiles: createProfileStore(apiDb), turnstile: { verify: async () => true }, breachChecker: { isBreached: async () => false } });
    const limited = createApp({ config, logger, rateLimitStore: store, healthChecks: {}, auth, transparency });
    let last = 0;
    for (let n = 0; n < 301; n++) last = (await limited.request(n % 2 === 0 ? "/api/public/facts" : "/api/public/transparency")).status;
    expect(last).toBe(429);
  });

  test("a signed-out read of a public route feeds the day's sketch under the day's salt in Valkey, and nothing else is kept; each key has its time to live", async () => {
    await removeKeys();
    for (const path of ["/api/timeline/latest", "/api/timeline/explore", "/api/health", "/api/public/facts"]) await app.request(path, { headers: { "user-agent": "Mozilla/5.0 Firefox/140.0" } });
    await app.request("/api/timeline/latest", { headers: { "user-agent": "Googlebot/2.1" } });
    await settle();
    expect(await countKeys()).toEqual(["mau:out:2009-05-17", "mau:salt:2009-05-17"]);
    expect(await redis.pfcount("mau:out:2009-05-17")).toBe(1);
    expect(await redis.type("mau:out:2009-05-17")).toBe("string");
    const saltTtl = await redis.ttl("mau:salt:2009-05-17");
    expect(saltTtl).toBeGreaterThan(RECIPIENT_RULES.saltHours * 3600 - 60);
    expect(saltTtl).toBeLessThanOrEqual(RECIPIENT_RULES.saltHours * 3600);
    const sketchTtl = await redis.ttl("mau:out:2009-05-17");
    expect(sketchTtl).toBeGreaterThan(RECIPIENT_RULES.sketchDays * 86_400 - 60);
    expect(sketchTtl).toBeLessThanOrEqual(RECIPIENT_RULES.sketchDays * 86_400);
    expect((await redis.getBuffer("mau:salt:2009-05-17"))?.length).toBe(32);
    // The salt is in no table: no column of the public schema holds its value.
    const salt = (await redis.getBuffer("mau:salt:2009-05-17"))!.toString("hex");
    const [found] = await migrateDb.execute<{ n: number }>(sql`select count(*)::int as n from public.audit_log where metadata::text like ${`%${salt}%`}`);
    expect(found!.n).toBe(0);
  });

  test("with RECIPIENTS_SIGNED_OUT off nothing of a signed-out reader is kept; and a Valkey that fails never fails a request", async () => {
    await removeKeys();
    const off = build({ RECIPIENTS_SIGNED_OUT: "off" }).app;
    expect((await off.request("/api/timeline/latest")).status).toBe(200);
    await settle();
    expect(await countKeys()).toEqual([]);
    const broken = new Redis("redis://127.0.0.1:1/0", { maxRetriesPerRequest: 0, lazyConnect: true, enableOfflineQueue: false, retryStrategy: () => null });
    broken.on("error", () => undefined);
    const auth = createAuth({ config, logger, authDb, kv: new MemoryKv(), mailer: new MemoryMailer(), profiles: createProfileStore(apiDb) });
    const failing = createTransparency({ apiDb, redis: broken, config, logger, now: () => clock });
    auth.onSeen(failing.forAuth);
    const failingApp = createApp({ config, logger, rateLimitStore: new MemoryStore(), healthChecks: {}, auth, social: createSocial({ apiDb, rateLimitStore: new MemoryStore(), logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth() }), transparency: failing });
    const res = await failingApp.request("/api/timeline/latest");
    expect(res.status).toBe(200);
    await settle();
    broken.disconnect();
  });

  test("the job's round closes the month before: two numbers stored, the month's keys deleted; once a day after the dispatch hour it publishes what edition is due", async () => {
    await removeKeys();
    await removeMonths();
    // April 2009: two accounts seen, one reader on two days.
    const accounts = ["a1b2c3d4-0000-4000-8000-0000000000a1", "a1b2c3d4-0000-4000-8000-0000000000a2"];
    clock = new Date("2009-04-03T09:00:00.000Z");
    for (const account of accounts) transparency.forAuth.seen(account);
    transparency.forAuth.seenSignedOut("203.0.113.9", "Mozilla/5.0 Firefox/140.0", "/api/timeline/latest");
    clock = new Date("2009-04-04T09:00:00.000Z");
    transparency.forAuth.seenSignedOut("203.0.113.9", "Mozilla/5.0 Firefox/140.0", "/api/timeline/latest");
    await settle();
    expect(await countKeys()).toEqual(["mau:in:2009-04", "mau:out:2009-04-03", "mau:out:2009-04-04", "mau:salt:2009-04-03", "mau:salt:2009-04-04"]);

    // The first of May, before the dispatch hour: the month closes; no edition is asked for yet.
    clock = new Date(Date.UTC(2009, 4, 1, config.MODERATION_DISPATCH_HOUR - 1, 30));
    try {
      const first = await transparency.round();
      expect(first).toEqual({ months: ["2009-04"], editions: null });
      const [row] = await migrateDb.execute<{ month: string; signed_in: number; signed_out_days: number; method: number; fresh: boolean }>(
        sql`select month::text, signed_in, signed_out_days, method, computed_at > now() - interval '1 minute' as fresh from public.recipient_months where month = '2009-04-01'::date`,
      );
      expect({ ...row }).toEqual({ month: "2009-04-01", signed_in: 2, signed_out_days: 2, method: RECIPIENT_RULES.method, fresh: true });
      expect((await countKeys()).filter((key) => !key.startsWith("mau:salt:"))).toEqual([]);
      expect(await redis.exists(sketchKeys.month("2009-04"))).toBe(0);

      // After the dispatch hour: the last closed year's edition (2008) is due and published once, by the API's role.
      clock = new Date(Date.UTC(2009, 4, 1, config.MODERATION_DISPATCH_HOUR, 5));
      const second = await transparency.round();
      expect(second).toEqual({ months: [], editions: [{ year: YEAR, version: 1 }] });
      const [audit] = await migrateDb.execute<{ action: string; target_id: string }>(sql`select action, target_id from public.audit_log where chain_seq = (select seq from public.audit_head where id = 1)`);
      expect({ ...audit }).toEqual({ action: "edition_published", target_id: `${YEAR}.1` });
      // Later the same day: nothing more. The next day: asked again, and nothing new is written.
      clock = new Date(Date.UTC(2009, 4, 1, 23, 0));
      expect(await transparency.round()).toEqual({ months: [], editions: null });
      clock = new Date(Date.UTC(2009, 4, 2, config.MODERATION_DISPATCH_HOUR, 5));
      expect(await transparency.round()).toEqual({ months: [], editions: [] });
    } finally {
      clock = new Date("2009-05-17T10:00:00.000Z");
      await removeYear(YEAR);
      await removeMonths();
      await removeKeys();
    }
  });
});
