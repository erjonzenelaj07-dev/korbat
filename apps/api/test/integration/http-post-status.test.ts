import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import pino from "pino";
import type { MiddlewareHandler } from "hono";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
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
import { newPostRow, removeFixtures } from "./moderation-fixtures";
import { newProfile } from "./social-fixtures";

type App = ReturnType<typeof createApp>;

/**
 * The status of a post's page (3f design, sections 5 and 7.12; invariant 19, the API's part; Caddy's part is the stack's
 * smoke test). GET /api/posts/:id/status is the social module's own small router, mounted after the global limit and
 * before the session's resolution: it answers 204 exactly when the post is visible and 404 with no body otherwise (no
 * such post, a malformed id, a post its author deleted, withheld, removed or disabled), the same for every viewer, so it
 * tells nothing a signed-out read of the post does not, and never 451. It reads no session, whatever the request carries.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the status of a post's page", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let migrateDb: Db;
  let app: App;
  let resolved = 0;
  const authors: string[] = [];
  const posts: Record<string, string> = {};

  beforeAll(async () => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 1 });
    const rateLimitStore = new MemoryStore();
    const auth = createAuth({
      config,
      logger,
      authDb,
      kv: new MemoryKv(),
      mailer: new MemoryMailer(),
      profiles: createProfileStore(apiDb),
      turnstile: { verify: async () => true },
      breachChecker: { isBreached: async () => false },
    });
    // The session's resolution, counted: the status route must never reach it.
    const resolveSession: MiddlewareHandler<AppEnv> = (c, next) => {
      resolved++;
      return auth.resolveSession(c, next);
    };
    const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth() });
    app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth: { ...auth, resolveSession }, social });

    // One post in each stored state, written as the migrator, who alone sets a level and a state.
    const author = await newProfile(apiDb);
    authors.push(author.id);
    for (const state of ["visible", "deleted_by_author", "withheld", "removed", "disabled"] as const) {
      const id = await newPostRow(apiDb, author.id);
      if (state === "deleted_by_author") await migrateDb.execute(sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${id}::uuid`);
      else if (state !== "visible") await migrateDb.execute(sql`update posts set state = ${state}::post_state, moderation_level = ${state}::moderation_level where id = ${id}::uuid`);
      posts[state] = id;
    }
  });
  afterAll(async () => {
    await removeFixtures(migrateDb, authors);
    await Promise.all([closeDb(authDb), closeDb(apiDb), closeDb(migrateDb)]);
  });

  const status = (id: string, headers: Record<string, string> = {}) => app.request(`/api/posts/${id}/status`, { headers });

  test("204 with no body for a visible post, 404 with no body for every other state and for a post that does not exist", async () => {
    const visible = await status(posts.visible!);
    expect(visible.status).toBe(204);
    expect(await visible.text()).toBe("");
    for (const state of ["deleted_by_author", "withheld", "removed", "disabled"]) {
      const res = await status(posts[state]!);
      expect([state, res.status, await res.text()]).toEqual([state, 404, ""]);
    }
    const missing = await status(randomUUID());
    expect([missing.status, await missing.text()]).toEqual([404, ""]);
  });

  test("a malformed id is 404 with no body, never the validator's JSON", async () => {
    for (const id of ["not-a-uuid", "00000000-0000-0000-0000-00000000000g", encodeURIComponent("../health"), "x".repeat(300)]) {
      const res = await status(id);
      expect([id, res.status, await res.text()]).toEqual([id, 404, ""]);
    }
  });

  test("it reads no session: a cookie and a bearer token change nothing, and the session's resolution is never reached", async () => {
    resolved = 0;
    const carried = { cookie: "korbat_session=abc; __Host-korbat_session=def", authorization: `Bearer ${"a".repeat(43)}` };
    expect((await status(posts.visible!, carried)).status).toBe(204);
    expect((await status(posts.withheld!, carried)).status).toBe(404);
    expect(resolved).toBe(0);
    // The post's own read, beside it, does go through the session's resolution.
    await app.request(`/api/posts/${posts.visible!}`, { headers: carried });
    expect(resolved).toBeGreaterThan(0);
  });

  test("it answers what a signed-out read of the post answers, state by state, and never 451", async () => {
    for (const [state, id] of Object.entries(posts)) {
      const read = await app.request(`/api/posts/${id}`);
      const asked = await status(id);
      expect([state, asked.status === 204, read.status === 200]).toEqual([state, read.status === 200, asked.status === 204]);
      expect(asked.status).not.toBe(451);
    }
  });

  test("it stands behind the global limit, as every other route of the app does", async () => {
    const store = new MemoryStore();
    const limited = createApp({
      config,
      logger: pino({ level: "silent" }),
      rateLimitStore: store,
      healthChecks: {},
      auth: { ...createAuth({ config, logger: pino({ level: "silent" }), authDb, kv: new MemoryKv(), mailer: new MemoryMailer(), profiles: createProfileStore(apiDb), turnstile: { verify: async () => true }, breachChecker: { isBreached: async () => false } }) },
      social: createSocial({ apiDb, rateLimitStore: store, logger: pino({ level: "silent" }), requireSession: async (_c, next) => next(), requireFreshAuth: async (_c, next) => next() }),
    });
    let last = 0;
    for (let n = 0; n < 301; n++) last = (await limited.request(`/api/posts/${randomUUID()}/status`)).status;
    expect(last).toBe(429);
  });
});
