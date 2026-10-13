import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { ErrorEnvelope, ExplorePage, ExploreSettingResponse, ExploreStatus, ExportFormat, FlowResponse, MeResponse } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createAccount } from "../../src/account";
import { createApp } from "../../src/app";
import { createAuth, type Auth } from "../../src/auth";
import { randomToken } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import type { MediaForAccount } from "../../src/media";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { createSocial, type Social } from "../../src/social";
import { HOUR, MINUTE, accounts, after, approvedPost, before, listed, pageIds, rank, spans } from "./explore-fixtures";
import { Browser } from "./http-client";
import { closeDecisions, decideForTest, leavesNoModerationRows } from "./moderation-decide";
import { liftRowForTest, suspendRowForTest } from "./moderation-fixtures";
import { newPost } from "./social-fixtures";

type App = ReturnType<typeof createApp>;

/**
 * This suite's past (see explore-fixtures.ts): the social module's clock and its rankings run in 2023, each test in a span
 * of its own. The auth module keeps the real clock, so sessions are fresh and the export's freshness check passes; the
 * accounts that sign up are therefore younger than their posts, which only an engaging account's age would matter for.
 */
const EPOCH = Date.UTC(2023, 0, 1);

/**
 * Explore's routes through the real app: 1a sign-up for the accounts that read, cookie sessions with CSRF, the social
 * module on this database with the clock the tests set, and the account module for the export, whose images these
 * accounts do not have.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: Explore over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let auth: Auth;
  let social: Social;
  let app: App;
  const mailer = new MemoryMailer();
  let clock = new Date(EPOCH);
  const nextAsOf = spans(EPOCH);

  beforeAll(() => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    const rateLimitStore = new MemoryStore();
    auth = createAuth({
      config,
      logger,
      authDb,
      kv: new MemoryKv(),
      mailer,
      profiles: createProfileStore(apiDb),
      turnstile: { verify: async () => true },
      breachChecker: { isBreached: async () => false },
    });
    social = createSocial({
      apiDb,
      rateLimitStore,
      logger,
      requireSession: auth.requireSession,
      requireFreshAuth: auth.requireFreshAuth(),
      events: { append: auth.appendEvent },
      now: () => clock,
    });
    const noImages: MediaForAccount = { purgeOwner: async () => [], requestDeletion: async () => undefined, exportImages: async () => [] };
    const account = createAccount({
      auth: auth.forAccount,
      social: social.forAccount,
      media: noImages,
      requireSession: auth.requireSession,
      requireFreshAuth: auth.requireFreshAuth(),
      requireStrongFreshAuth: auth.requireStrongFreshAuth(),
      rateLimitStore,
      logger,
    });
    app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, social, account });
  });
  afterAll(async () => {
    await closeDecisions();
    await Promise.all([closeDb(authDb), closeDb(apiDb)]);
  });
  // Every test starts without any ranking (the cascade empties explore_items) and reads the generations its own rounds answer.
  beforeEach(async () => {
    await apiDb.execute(sql`delete from explore_runs`);
  });

  /** A signed-in web account, onboarded unless told otherwise. */
  async function signUp(onboard = true) {
    const b = new Browser(app, config.APP_ORIGIN);
    const email = `explore-${randomUUID()}@korbat.local`;
    const handle = `e${randomBytes(4).toString("hex")}`;
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(start.status).toBe(200);
    const { flowId } = FlowResponse.parse(await start.json());
    expect((await b.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } })).status).toBe(200);
    expect((await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).status).toBe(200);
    if (onboard) expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: `User ${handle}` } })).status).toBe(200);
    const me = MeResponse.parse(await (await b.fetch("/api/me")).json());
    return { b, handle, userId: me.user.id };
  }

  const errorOf = async (res: Response) => ErrorEnvelope.parse(await res.json()).error;
  const eventTypes = async (userId: string) => (await auth.deps.repo.recentEvents(userId)).map((event) => event.type);

  /** An Explore page through the app, signed out unless a browser is given, checked against the contract and the header every answer carries. */
  async function explore(query: string, b?: Browser): Promise<ExplorePage> {
    const path = `/api/timeline/explore${query}`;
    const res = b ? await b.fetch(path) : await app.request(path);
    expect(res.status, path).toBe(200);
    expect(res.headers.get("cache-control"), path).toBe("no-store");
    return ExplorePage.parse(await res.json());
  }

  /** `n` posts by as many authors, each liked by the same three accounts at one time, and the ranking of them in order. */
  async function ranked(asOf: Date, n: number): Promise<string[]> {
    const authors = await accounts(apiDb, asOf, n);
    const fans = await accounts(apiDb, asOf, 3);
    for (const author of authors) await approvedPost(social.deps.repo, author, before(asOf, 2 * HOUR), fans, before(asOf, HOUR));
    const order = await listed(apiDb, (await rank(social.deps.repo, asOf)).generation);
    expect(order).toHaveLength(n);
    return order;
  }

  test("signed out: one page of at most 20 posts whatever the limit asks, no cursor, the sign-in prompt while more follow, and the ranking's time", async () => {
    const asOf = nextAsOf();
    const order = await ranked(asOf, 21);
    clock = after(asOf, MINUTE);
    const computedAt = asOf.toISOString();

    for (const query of ["?limit=50", "", "?limit=20"]) {
      const page = await explore(query);
      expect(pageIds(page), query).toEqual(order.slice(0, 20));
      expect(page, query).toMatchObject({ nextCursor: null, computedAt, signInForMore: true });
    }
    const five = await explore("?limit=5");
    expect(pageIds(five)).toEqual(order.slice(0, 5));
    expect(five).toMatchObject({ nextCursor: null, computedAt, signInForMore: true });

    // A signed-in reader is not capped, and has a cursor rather than a prompt when more follow.
    const reader = await signUp();
    const all = await explore("?limit=50", reader.b);
    expect(pageIds(all)).toEqual(order);
    expect(all).toMatchObject({ nextCursor: null, computedAt, signInForMore: false });

    // The extra row that decides the prompt is read through the same filters as the page: with the first post withheld,
    // the twenty left are all there is.
    await decideForTest(apiDb, order[0]!, "withheld");
    const rest = await explore("?limit=50");
    expect(pageIds(rest)).toEqual(order.slice(1));
    expect(rest).toMatchObject({ nextCursor: null, computedAt, signInForMore: false });
    // The withheld state comes from a real, confirmed decision: a staff key's enrolment, a sign-in, a step-up and the decision.
  }, 30_000);

  test("a signed-out request with a cursor is refused with 401 before anything is read; signed in, the cursor pages on, and every answer is no-store", async () => {
    const asOf = nextAsOf();
    const order = await ranked(asOf, 5);
    clock = after(asOf, MINUTE);
    const reader = await signUp();
    const first = await explore("?limit=2", reader.b);
    expect(pageIds(first)).toEqual(order.slice(0, 2));
    expect(first).toMatchObject({ computedAt: asOf.toISOString(), signInForMore: false });
    const cursor = encodeURIComponent(first.nextCursor!);

    // Any cursor, a real one or not, asks for more than the first page, which needs an account.
    for (const query of [`?cursor=${cursor}`, `?limit=2&cursor=${cursor}`, "?cursor=not-a-cursor"]) {
      const refused = await app.request(`/api/timeline/explore${query}`);
      expect(refused.status, query).toBe(401);
      expect(refused.headers.get("cache-control"), query).toBe("no-store");
      expect(await errorOf(refused), query).toMatchObject({ code: "unauthenticated", message: "Sign in to see more of Explore." });
    }

    const second = await explore(`?limit=2&cursor=${cursor}`, reader.b);
    const third = await explore(`?limit=2&cursor=${encodeURIComponent(second.nextCursor!)}`, reader.b);
    expect([...pageIds(first), ...pageIds(second), ...pageIds(third)]).toEqual(order);
    expect(third).toMatchObject({ nextCursor: null, computedAt: asOf.toISOString(), signInForMore: false });
    // Signed in, a cursor that is not one is the request's fault, not a reason to sign in.
    const bad = await reader.b.fetch("/api/timeline/explore?cursor=not-a-cursor");
    expect(bad.status).toBe(400);
    expect((await errorOf(bad)).code).toBe("invalid_request");
  });

  test("the status route answers the post's author only: not_found for anyone else and for an unknown post, 401 signed out", async () => {
    const asOf = nextAsOf();
    const [ada, bob] = [await signUp(), await signUp()];
    const fans = await accounts(apiDb, asOf, 3);
    const inExplore = await approvedPost(social.deps.repo, { id: ada.userId }, before(asOf, 2 * HOUR), fans, before(asOf, HOUR));
    const quiet = await newPost(social.deps.repo, ada.userId, before(asOf, 2 * HOUR));
    await rank(social.deps.repo, asOf);
    clock = after(asOf, MINUTE);
    const computedAt = asOf.toISOString();
    const statusPath = (id: string) => `/api/posts/${id}/explore`;

    const answered = await ada.b.fetch(statusPath(inExplore));
    expect(answered.status).toBe(200);
    expect(answered.headers.get("cache-control")).toBe("no-store");
    const body = (await answered.json()) as Record<string, unknown>;
    expect(ExploreStatus.parse(body)).toEqual({ status: "listed", computedAt });
    // The reason and the ranking's time, and nothing else: no count, no score.
    expect(Object.keys(body).sort()).toEqual(["computedAt", "status"]);
    expect(await (await ada.b.fetch(statusPath(quiet))).json()).toEqual({ status: "below_threshold", computedAt });

    for (const id of [inExplore, quiet]) {
      const other = await bob.b.fetch(statusPath(id));
      expect(other.status).toBe(404);
      expect((await errorOf(other)).code).toBe("not_found");
      const signedOut = await app.request(statusPath(id));
      expect(signedOut.status).toBe(401);
      expect((await errorOf(signedOut)).code).toBe("unauthenticated");
    }
    const unknown = await ada.b.fetch(statusPath(randomUUID()));
    expect(unknown.status).toBe(404);
    expect((await errorOf(unknown)).code).toBe("not_found");
    expect((await ada.b.fetch(statusPath("not-a-post"))).status).toBe(400);
  });

  test("a suspended author (3e): the status route answers suspended, and the page and the author's chip leave the listed post at the next read, before any round", async () => {
    const asOf = nextAsOf();
    const ada = await signUp();
    const fans = await accounts(apiDb, asOf, 3);
    const id = await approvedPost(social.deps.repo, { id: ada.userId }, before(asOf, 2 * HOUR), fans, before(asOf, HOUR));
    await rank(social.deps.repo, asOf);
    clock = after(asOf, MINUTE);
    const computedAt = asOf.toISOString();
    const statusOf = async () => ExploreStatus.parse(await (await ada.b.fetch(`/api/posts/${id}/explore`)).json());
    const chip = async () => ((await (await ada.b.fetch(`/api/posts/${id}`)).json()) as { inExplore?: boolean }).inExplore;
    expect(await statusOf()).toEqual({ status: "listed", computedAt });
    expect(pageIds(await explore(""))).toEqual([id]);
    expect(await chip()).toBe(true);
    const migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 1 });
    try {
      // Suspended from a minute ago by the database's clock, which the reads judge by; the ranking of 2023 judged the
      // author at its own time and listed the post. The status is a read, which a suspended account may make.
      await suspendRowForTest(migrateDb, ada.userId);
      expect(await statusOf()).toEqual({ status: "suspended", computedAt });
      expect(pageIds(await explore(""))).toEqual([]);
      expect(pageIds(await explore("", ada.b))).toEqual([]);
      expect(await chip()).toBeUndefined();
    } finally {
      await liftRowForTest(migrateDb, ada.userId);
      await closeDb(migrateDb);
    }
    // Lifted, the post is back at the next read: the ranking still holds it.
    expect(pageIds(await explore(""))).toEqual([id]);
    expect(await statusOf()).toEqual({ status: "listed", computedAt });
    expect(await chip()).toBe(true);
  });

  test("POST turns the Explore switch on and DELETE off, for an onboarded session and without an event; /api/me reads it, and a listed post leaves at the next read", async () => {
    const asOf = nextAsOf();
    const ada = await signUp();
    const fans = await accounts(apiDb, asOf, 3);
    const id = await approvedPost(social.deps.repo, { id: ada.userId }, before(asOf, 2 * HOUR), fans, before(asOf, HOUR));
    await rank(social.deps.repo, asOf);
    clock = after(asOf, MINUTE);
    const me = async () => MeResponse.parse(await (await ada.b.fetch("/api/me")).json()).profile!;
    const turn = async (method: "POST" | "DELETE") => {
      const res = await ada.b.fetch("/api/me/explore", { method });
      expect(res.status, method).toBe(200);
      return ExploreSettingResponse.parse(await res.json());
    };
    expect((await me()).showInExplore).toBe(true);
    expect(pageIds(await explore(""))).toEqual([id]);
    const events = await eventTypes(ada.userId);

    expect(await turn("DELETE")).toEqual({ showInExplore: false });
    expect((await me()).showInExplore).toBe(false);
    // At the next read, before any further round.
    expect(pageIds(await explore(""))).toEqual([]);
    expect(await turn("DELETE")).toEqual({ showInExplore: false });
    expect(await turn("POST")).toEqual({ showInExplore: true });
    expect((await me()).showInExplore).toBe(true);
    expect(await turn("POST")).toEqual({ showInExplore: true });
    // No event records the switch.
    expect(await eventTypes(ada.userId)).toEqual(events);
    // The switch is the author's own: the public profile never shows it.
    const profile = (await (await app.request(`/api/profiles/${ada.handle}`)).json()) as Record<string, unknown>;
    expect(profile.id).toBe(ada.userId);
    expect(profile).not.toHaveProperty("showInExplore");

    const early = await signUp(false);
    for (const method of ["POST", "DELETE"]) {
      const anonymous = await app.request("/api/me/explore", { method });
      expect(anonymous.status, method).toBe(401);
      expect((await errorOf(anonymous)).code, method).toBe("unauthenticated");
      const notOnboarded = await early.b.fetch("/api/me/explore", { method });
      expect(notOnboarded.status, method).toBe(403);
      expect((await errorOf(notOnboarded)).code, method).toBe("onboarding_required");
    }
  });

  test("the data export carries the Explore switch as it stands", async () => {
    const [on, off] = [await signUp(), await signUp()];
    expect((await off.b.fetch("/api/me/explore", { method: "DELETE" })).status).toBe(200);
    const exported = async (b: Browser) => {
      const res = await b.fetch("/api/account/export", { method: "POST" });
      expect(res.status).toBe(200);
      return ExportFormat.parse(JSON.parse(strFromU8(unzipSync(new Uint8Array(await res.arrayBuffer()))["export.json"]!)));
    };
    expect((await exported(on.b)).profile).toMatchObject({ handle: on.handle, showInExplore: true });
    expect((await exported(off.b)).profile).toMatchObject({ handle: off.handle, showInExplore: false });
  });

  leavesNoModerationRows(() => apiDb);
});
