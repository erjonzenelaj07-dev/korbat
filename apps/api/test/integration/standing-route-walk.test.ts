import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { ErrorEnvelope, FlowResponse, MeResponse, PostView, UploadResponse } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createAccount } from "../../src/account";
import { createApp } from "../../src/app";
import { createAuth } from "../../src/auth";
import { randomToken } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { DEV_CODE, devProvider } from "../../src/auth/verify/dev";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { createMedia } from "../../src/media";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createModeration } from "../../src/moderation";
import { createProfileStore } from "../../src/profiles/store";
import { createSocial, enforceWriteLimit, socialForModeration } from "../../src/social";
import { Browser } from "./http-client";
import { BYTES } from "./media-harness";
import { closeDecisions, decideForTest, suspendForTest, terminateForTest } from "./moderation-decide";
import { releaseForTest, removeFixtures, rowCounts } from "./moderation-fixtures";

// The suspension is a real, confirmed decision (a staff key's enrolment and sign-in, then two step-ups), and the walk
// calls every write route of the app once: slow on a loaded machine.
vi.setConfig({ testTimeout: 240_000 });

type App = ReturnType<typeof createApp>;

/**
 * What a suspended or terminated account gets from each write route of the app (3e design, section 7.3): refused with 403
 * account_suspended, or its ordinary answer, whatever that is for the request the walk sends. A route that only reads is
 * allowed and is not listed; the staff console's routes are untouched (no staff account can hold a measure of 3e). The walk
 * below is driven from the app's own route table and fails on a write route this table does not list, so a route added
 * later fails until someone has decided what a suspended account gets from it.
 */
export const SUSPENDED_WRITES: Record<string, "refused" | "allowed"> = {
  "POST /api/posts": "refused",
  "DELETE /api/posts/:id": "allowed",
  "POST /api/posts/:id/like": "refused",
  "POST /api/posts/:id/repost": "refused",
  "POST /api/posts/:id/bookmark": "refused",
  "DELETE /api/posts/:id/like": "allowed",
  "DELETE /api/posts/:id/repost": "allowed",
  "DELETE /api/posts/:id/bookmark": "allowed",
  "POST /api/profiles/:handle/follow": "refused",
  "DELETE /api/profiles/:handle/follow": "allowed",
  "POST /api/profiles/:handle/block": "allowed",
  "DELETE /api/profiles/:handle/block": "allowed",
  "POST /api/profiles/:handle/mute": "allowed",
  "DELETE /api/profiles/:handle/mute": "allowed",
  "PATCH /api/me/profile": "refused",
  "POST /api/me/handle": "refused",
  "POST /api/me/explore": "allowed",
  "DELETE /api/me/explore": "allowed",
  "POST /api/media": "refused",
  "DELETE /api/media/:id": "allowed",
  "POST /api/auth/badge/start": "refused",
  "POST /api/auth/badge/verify": "refused",
  "DELETE /api/auth/badge": "allowed",
  "POST /api/auth/onboarding/handle": "allowed",
  "POST /api/auth/email/start": "allowed",
  "POST /api/auth/email/verify": "allowed",
  "POST /api/auth/signup/complete": "allowed",
  "POST /api/auth/password/signin": "allowed",
  "POST /api/auth/password/set": "allowed",
  "POST /api/auth/passkey/signin/options": "allowed",
  "POST /api/auth/passkey/signin/verify": "allowed",
  "POST /api/auth/passkeys/register/options": "allowed",
  "POST /api/auth/passkeys/register/verify": "allowed",
  "PATCH /api/auth/passkeys/:id": "allowed",
  "DELETE /api/auth/passkeys/:id": "allowed",
  "POST /api/auth/passkeys/:id/not-mine": "allowed",
  "POST /api/auth/passkeys/remove-link": "allowed",
  "POST /api/auth/mfa/verify": "allowed",
  "POST /api/auth/mfa/totp/setup": "allowed",
  "POST /api/auth/mfa/totp/confirm": "allowed",
  "POST /api/auth/mfa/totp/disable": "allowed",
  "POST /api/auth/mfa/recovery-codes/regenerate": "allowed",
  "POST /api/auth/reauth": "allowed",
  "POST /api/auth/reauth/email/start": "allowed",
  "POST /api/auth/reauth/passkey/options": "allowed",
  "POST /api/auth/email/change/start": "allowed",
  "POST /api/auth/email/change/verify": "allowed",
  "POST /api/auth/email/revert": "allowed",
  "POST /api/auth/not-me": "allowed",
  "DELETE /api/auth/sessions/:id": "allowed",
  "POST /api/auth/sessions/revoke-all": "allowed",
  "POST /api/auth/signout": "allowed",
  "POST /api/account/delete/start": "allowed",
  "POST /api/account/delete/confirm": "allowed",
  "POST /api/account/export": "allowed",
  // Signed in, a report under a rule is refused; a notice of illegality is taken (the walk sends both).
  "POST /api/notices": "refused",
  "POST /api/notices/status": "allowed",
  "POST /api/notices/contact": "allowed",
  "POST /api/notices/reexamine": "allowed",
  "POST /api/moderation/decisions/:id/appeal": "allowed",
  // 3e Task 4: the reply is the hearing, and is never suspended.
  "POST /api/moderation/decisions/:id/reply": "allowed",
  // 3d Task 6 (section 7.10): asking for a person to look at a program's decision is redress, never suspended.
  "POST /api/moderation/decisions/:id/objection": "allowed",
  // 3d Task 7 (section 9.5): the objection to a refused upload is redress too, never suspended.
  "POST /api/moderation/uploads/:refusal/objection": "allowed",
  "POST /api/moderation/items/:item/reexamine": "allowed",
  "POST /api/moderation/report-mail/resume": "allowed",
};

/** The routes that end the session: called last, so that every other route is called with it. */
const LAST = ["POST /api/auth/sessions/revoke-all", "POST /api/auth/signout"];

/** The write routes of an app's route table, as "METHOD path": every method but GET, HEAD, OPTIONS and middleware's ALL, outside the staff console. */
export function writeRoutes(app: { routes: readonly { method: string; path: string }[] }): string[] {
  const keys = app.routes.filter((route) => !["GET", "HEAD", "OPTIONS", "ALL"].includes(route.method) && route.path !== "/api/staff" && !route.path.startsWith("/api/staff/")).map((route) => `${route.method} ${route.path}`);
  return [...new Set(keys)];
}

/**
 * The route walk (3e design, section 12.2; invariant 10): the real app with every module, an account signed up over HTTP
 * and put under a measure through the decide route's own code, and then every write route of the app's route table
 * called once with that account's session. Three passes: an account suspended at once and (Task 4) one terminated at
 * once, where each route answers as section 7.3 says (403 account_suspended, or not that), and one whose announced
 * suspension has not started, where every route gives its ordinary answer.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the route walk of a suspended account", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let migrateDb: Db;
  let app: App;
  const root = mkdtempSync(path.join(tmpdir(), "korbat-route-walk-"));
  const mailer = new MemoryMailer();
  const made: string[] = [];
  let before: Record<string, number>;

  beforeAll(async () => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 6 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 1 });
    const rateLimitStore = new MemoryStore();
    const auth = createAuth({
      config,
      logger,
      authDb,
      kv: new MemoryKv(),
      mailer,
      profiles: createProfileStore(apiDb),
      turnstile: { verify: async () => true },
      breachChecker: { isBreached: async () => false },
      verify: devProvider(),
    });
    const media = createMedia({
      apiDb,
      uploadsDir: path.join(root, "uploads"),
      storeDir: path.join(root, "store"),
      formats: config.MEDIA_FORMATS,
      minFreeBytes: 0,
      logger,
      requireSession: auth.requireSession,
      resolveSession: auth.resolveSession,
      rateLimitStore,
      enforceUploadLimit: (userId, accountCreatedAt, at) => enforceWriteLimit(rateLimitStore, userId, "upload", accountCreatedAt, at),
    });
    // The store volume, which the image worker owns and the upload's free-space check reads.
    mkdirSync(path.join(root, "store"), { recursive: true });
    await media.prepare();
    const moderation = createModeration({ apiDb, auth: auth.forModeration, social: socialForModeration(apiDb), media: media.forCases, requireSession: auth.requireSession, rateLimitStore, config, logger });
    const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth(), media: media.forPosts, moderation: moderation.forSocial, events: { append: auth.appendEvent } });
    const account = createAccount({
      auth: auth.forAccount,
      social: social.forAccount,
      media: media.forAccount,
      moderation: moderation.forAccount,
      requireSession: auth.requireSession,
      requireFreshAuth: auth.requireFreshAuth(),
      requireStrongFreshAuth: auth.requireStrongFreshAuth(),
      rateLimitStore,
      logger,
    });
    app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, social, media, account, moderation });
    before = await rowCounts(apiDb);
  });
  afterAll(async () => {
    try {
      await closeDecisions();
      await removeFixtures(migrateDb, made.splice(0));
    } finally {
      rmSync(root, { recursive: true, force: true });
      await Promise.all([closeDb(authDb), closeDb(apiDb), closeDb(migrateDb)]);
    }
  }, 240_000);

  /** A signed-in, onboarded web account, its profile three days old so that no new-account tier gets in the way. */
  async function signUp() {
    const b = new Browser(app, config.APP_ORIGIN);
    const email = `walk-${randomUUID()}@korbat.local`;
    const handle = `w${randomBytes(4).toString("hex")}`;
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    const { flowId } = FlowResponse.parse(await start.json());
    expect((await b.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } })).status).toBe(200);
    expect((await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).status).toBe(200);
    expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: `User ${handle}` } })).status).toBe(200);
    const id = MeResponse.parse(await (await b.fetch("/api/me")).json()).user.id;
    made.push(id);
    await migrateDb.execute(sql`update profiles set created_at = now() - interval '3 days' where id = ${id}::uuid`);
    return { b, handle, id, email };
  }

  test("every write route of the app's route table is listed in section 7.3's table, and none is listed that the app does not have", () => {
    const routes = writeRoutes(app).sort();
    expect(routes.filter((route) => !(route in SUSPENDED_WRITES))).toEqual([]);
    expect(Object.keys(SUSPENDED_WRITES).filter((route) => !routes.includes(route))).toEqual([]);
  });

  /**
   * One pass of the walk: two accounts, Ada and Bob, each with a post and Ada liking Bob's; a badge verification Ada
   * started before the measure; (3e's review, access6) an upload of Ada's own, and Ada's report under a rule of an earlier
   * post of Bob's, decided "No breach" and released, so the walk's re-examination and deletion name real rows of hers and
   * a refusal placed after the lookup would show; then `measure` puts Ada under it and answers the decision; then every
   * write route once with Ada's session. Answers each route's answers: "refused" for 403 account_suspended, else the status.
   */
  async function walk(measure: (accountId: string) => Promise<string>) {
    const ada = await signUp();
    const bob = await signUp();
    const bobsPost = PostView.parse(await (await bob.b.fetch("/api/posts", { json: { body: "bob's post" } })).json());
    const adasPost = PostView.parse(await (await ada.b.fetch("/api/posts", { json: { body: "ada's post" } })).json());
    expect((await ada.b.fetch(`/api/posts/${bobsPost.id}/like`, { method: "POST" })).status).toBe(200);
    // A badge verification started before the measure, which its verify step then meets.
    const badge = await ada.b.fetch("/api/auth/badge/start", { json: { phone: `+4477${String(randomInt(10_000_000, 100_000_000))}` } });
    const { flowId } = FlowResponse.parse(await badge.json());
    // An upload of Ada's own, which she may delete while suspended.
    const upload = UploadResponse.parse(await (await ada.b.fetch("/api/media", { raw: { type: "image/jpeg", body: BYTES.jpeg } })).json());
    // Ada's report of another post of Bob's, answered "No breach" and released: a re-examination of it is redress.
    const reported = PostView.parse(await (await bob.b.fetch("/api/posts", { json: { body: "bob's reported post" } })).json());
    expect((await ada.b.fetch("/api/notices", { json: { ground: "rule", ruleId: "R1", targets: [{ kind: "post", id: reported.id }] } })).status).toBe(201);
    await decideForTest(apiDb, reported.id, "visible");
    const [item] = await apiDb.execute<{ id: string }>(sql`select i.id from intake_items i join intakes n on n.id = i.intake_id where n.reporter_id = ${ada.id}::uuid`);
    await releaseForTest(migrateDb, [item!.id]);
    const decisionId = await measure(ada.id);
    const state = MeResponse.parse(await (await ada.b.fetch("/api/me")).json()).standing?.measure?.state ?? null;

    type Call = { path: string; method: string; json?: unknown; raw?: { type: string; body: Uint8Array } };
    const calls: Record<string, Call[]> = {
      "POST /api/posts": [{ method: "POST", path: "/api/posts", json: { body: "while suspended" } }],
      "DELETE /api/posts/:id": [{ method: "DELETE", path: `/api/posts/${adasPost.id}` }],
      "POST /api/posts/:id/like": [{ method: "POST", path: `/api/posts/${bobsPost.id}/like` }],
      "POST /api/posts/:id/repost": [{ method: "POST", path: `/api/posts/${bobsPost.id}/repost` }],
      "POST /api/posts/:id/bookmark": [{ method: "POST", path: `/api/posts/${bobsPost.id}/bookmark` }],
      "DELETE /api/posts/:id/like": [{ method: "DELETE", path: `/api/posts/${bobsPost.id}/like` }],
      "DELETE /api/posts/:id/repost": [{ method: "DELETE", path: `/api/posts/${bobsPost.id}/repost` }],
      "DELETE /api/posts/:id/bookmark": [{ method: "DELETE", path: `/api/posts/${bobsPost.id}/bookmark` }],
      "POST /api/profiles/:handle/follow": [{ method: "POST", path: `/api/profiles/${bob.handle}/follow` }],
      "DELETE /api/profiles/:handle/follow": [{ method: "DELETE", path: `/api/profiles/${bob.handle}/follow` }],
      "POST /api/profiles/:handle/block": [{ method: "POST", path: `/api/profiles/${bob.handle}/block` }],
      "DELETE /api/profiles/:handle/block": [{ method: "DELETE", path: `/api/profiles/${bob.handle}/block` }],
      "POST /api/profiles/:handle/mute": [{ method: "POST", path: `/api/profiles/${bob.handle}/mute` }],
      "DELETE /api/profiles/:handle/mute": [{ method: "DELETE", path: `/api/profiles/${bob.handle}/mute` }],
      "PATCH /api/me/profile": [
        { method: "PATCH", path: "/api/me/profile", json: { displayName: "korbat moderation" } },
        { method: "PATCH", path: "/api/me/profile", json: { bio: "" } },
      ],
      "POST /api/me/handle": [{ method: "POST", path: "/api/me/handle", json: { handle: `w${randomBytes(4).toString("hex")}` } }],
      "POST /api/me/explore": [{ method: "POST", path: "/api/me/explore" }],
      "DELETE /api/me/explore": [{ method: "DELETE", path: "/api/me/explore" }],
      "POST /api/media": [{ method: "POST", path: "/api/media", raw: { type: "image/jpeg", body: BYTES.jpeg } }],
      "DELETE /api/media/:id": [{ method: "DELETE", path: `/api/media/${upload.id}` }],
      "POST /api/auth/badge/start": [{ method: "POST", path: "/api/auth/badge/start", json: { phone: `+4477${String(randomInt(10_000_000, 100_000_000))}` } }],
      "POST /api/auth/badge/verify": [{ method: "POST", path: "/api/auth/badge/verify", json: { flowId, code: DEV_CODE } }],
      "POST /api/notices": [
        { method: "POST", path: "/api/notices", json: { ground: "rule", ruleId: "R1", targets: [{ kind: "post", id: bobsPost.id }] } },
        { method: "POST", path: "/api/notices", json: { ground: "illegal", targets: [{ kind: "post", id: bobsPost.id }], category: "STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH", explanation: "It is a threat.", bonaFide: true } },
      ],
      "POST /api/moderation/decisions/:id/appeal": [{ method: "POST", path: `/api/moderation/decisions/${decisionId}/appeal`, json: {} }],
      "POST /api/moderation/decisions/:id/reply": [{ method: "POST", path: `/api/moderation/decisions/${decisionId}/reply`, json: { statement: "I did not mean it." } }],
      // A person's decision: the request is refused as objection_not_open, never as account_suspended.
      "POST /api/moderation/decisions/:id/objection": [{ method: "POST", path: `/api/moderation/decisions/${decisionId}/objection`, json: { text: "Please have a person look at this." } }],
      "POST /api/moderation/items/:item/reexamine": [{ method: "POST", path: `/api/moderation/items/${item!.id}/reexamine`, json: {} }],
      // A refusal the account does not have: not_found, never account_suspended (the objection itself is moderation-uploads').
      "POST /api/moderation/uploads/:refusal/objection": [{ method: "POST", path: `/api/moderation/uploads/${randomUUID()}/objection`, json: { text: "Please look again." } }],
    };
    const callsOf = (route: string): Call[] => {
      const given = calls[route];
      if (given) return given;
      // Every other route: called with its path's parameters filled in and an empty body, which is its ordinary answer here.
      const [method, template] = route.split(" ") as [string, string];
      return [{ method, path: template.replace(/:[a-z]+/g, randomUUID()), json: method === "DELETE" ? undefined : {} }];
    };
    const order = writeRoutes(app).sort((a, b) => Number(LAST.includes(a)) - Number(LAST.includes(b)));
    const answers: Record<string, string[]> = {};
    for (const route of order) {
      for (const call of callsOf(route)) {
        const res = await ada.b.fetch(call.path, { method: call.method, json: call.json, raw: call.raw });
        const code = res.status === 403 ? ErrorEnvelope.safeParse(await res.json()).data?.error.code : undefined;
        (answers[route] ??= []).push(code === "account_suspended" ? "refused" : `${res.status}`);
      }
    }
    return { ada, order, answers, state };
  }

  /** Each route answers as section 7.3's table says, and what the refusals left is as it was. */
  async function expectTable({ ada, order, answers }: Awaited<ReturnType<typeof walk>>) {
    for (const route of order) {
      const got = answers[route]!;
      if (route === "POST /api/notices") {
        // A report under a rule is refused; a notice of illegality is taken.
        expect(got, route).toEqual(["refused", "201"]);
        continue;
      }
      if (SUSPENDED_WRITES[route] === "refused") expect(got.every((answer) => answer === "refused"), `${route} answered ${got.join(", ")}`).toBe(true);
      else expect(got.some((answer) => answer === "refused"), `${route} answered ${got.join(", ")}`).toBe(false);
    }
    // What the refusals left: no visible post (its own was deleted; the one the suspension's basis removed is not shown),
    // no follow, the profile and the handle as they were, no badge.
    const [counts] = await apiDb.execute<{ posts: number; follows: number; verified: boolean; handle: string }>(
      sql`select (select count(*)::int from posts where author_id = ${ada.id}::uuid and state = 'visible') as posts,
                 (select count(*)::int from follows where follower_id = ${ada.id}::uuid) as follows,
                 (select verified_at is not null from profiles where id = ${ada.id}::uuid) as verified,
                 (select handle from profiles where id = ${ada.id}::uuid) as handle`,
    );
    expect({ ...counts! }).toEqual({ posts: 0, follows: 0, verified: false, handle: ada.handle });
  }

  test("an account suspended at once: each write route answers 403 account_suspended or its ordinary answer, as the table says, and /api/me then shows the suspension", async () => {
    const result = await walk(async (accountId) => (await suspendForTest(apiDb, accountId, { days: 7 })).decisionId);
    expect(result.state).toBe("running");
    // The reply to a suspension taken at once is late, and taken.
    expect(result.answers["POST /api/moderation/decisions/:id/reply"]).toEqual(["201"]);
    // Redress and erasure on real rows of the account's own: its released report examined again, its upload deleted.
    expect(result.answers["POST /api/moderation/items/:item/reexamine"]).toEqual(["201"]);
    expect(result.answers["DELETE /api/media/:id"]).toEqual(["204"]);
    await expectTable(result);
  });

  test("an account terminated at once: the same table, the reply taken, and /api/me shows the termination running", async () => {
    const result = await walk(async (accountId) => (await terminateForTest(apiDb, accountId)).decisionId);
    expect(result.state).toBe("running");
    expect(result.answers["POST /api/moderation/decisions/:id/reply"]).toEqual(["201"]);
    expect(result.answers["POST /api/moderation/items/:item/reexamine"]).toEqual(["201"]);
    expect(result.answers["DELETE /api/media/:id"]).toEqual(["204"]);
    await expectTable(result);
  });

  test("an account whose announced suspension has not started: every write route gives its ordinary answer, none refuses it, and its reply comes before the start", async () => {
    const result = await walk(async (accountId) => (await suspendForTest(apiDb, accountId, { announced: true })).decisionId);
    // The decisions of this file are mailed by no auth module: the notice mail's outcome is unknown, so nothing has a start.
    expect(result.state).toBe("unfixed");
    const refused = Object.entries(result.answers).filter(([, got]) => got.includes("refused"));
    expect(refused).toEqual([]);
    expect(result.answers["POST /api/moderation/decisions/:id/reply"]).toEqual(["201"]);
    const [reply] = await apiDb.execute<{ on_time: boolean }>(sql`select on_time from suspension_replies where account_id = ${result.ada.id}::uuid`);
    expect(reply?.on_time).toBe(true);
  });

  test("this file left no row behind: what it committed is removed, and the tables hold what they held before it", async () => {
    await closeDecisions();
    await removeFixtures(migrateDb, made.splice(0));
    expect(await rowCounts(apiDb)).toEqual(before);
  });
});
