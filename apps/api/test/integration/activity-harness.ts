import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import pino from "pino";
import { expect } from "vitest";
import { ActivityPage, ActivitySettings, ErrorEnvelope, FlowResponse, MeResponse, PostView, type ActivityEntry } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createAccount } from "../../src/account";
import { createActivity } from "../../src/activity";
import { createApp } from "../../src/app";
import { createAuth } from "../../src/auth";
import { randomToken } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createModeration } from "../../src/moderation";
import { createProfileStore } from "../../src/profiles/store";
import { createSocial, socialForModeration } from "../../src/social";
import { Browser } from "./http-client";
import { casesMedia, removeFixtures, rowCounts } from "./moderation-fixtures";

/** 2d's three tables (migration 0049_activity), which every activity suite leaves as it found them. */
export const ACTIVITY_TABLES = ["activity_items", "activity_state", "post_mentions"];

/** One account of a suite: its browser with a signed-in, onboarded session, its id and its handle. */
export interface Member {
  b: Browser;
  id: string;
  handle: string;
}

export interface ActivityHarnessOptions {
  /** Entries a page of Activity holds; ACTIVITY_PAGE_SIZE unless a suite lowers it to page through few entries. */
  pageSize?: number;
}

/**
 * The real app for the activity suites (2d design, section 12.3): the auth, social, moderation, account and activity
 * modules built as the server builds them, on the test database, with an in-memory limit store and mailer. `signUp`
 * makes an account over HTTP and ages its profile as only the migrator may (three days unless said, so quoting and the
 * age rule of `older` pass). Every account it made, and what hangs on it, goes with `close` (removeFixtures), so a suite
 * leaves 2d's tables as it found them; `counts` reads them for a suite's own last test.
 */
export async function activityHarness(options: ActivityHarnessOptions = {}) {
  const config = loadConfig();
  const logger = pino({ level: "silent" });
  const authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
  const apiDb = createDb(config.DATABASE_URL_API, { max: 6 });
  const migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
  const mailer = new MemoryMailer();
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
  });
  const moderation = createModeration({ apiDb, auth: auth.forModeration, social: socialForModeration(apiDb), media: casesMedia(apiDb), requireSession: auth.requireSession, rateLimitStore, config, logger });
  const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth(), moderation: moderation.forSocial });
  const activity = createActivity({ apiDb, social: social.forActivity, moderation: moderation.forActivity, rateLimitStore, requireSession: auth.requireSession, logger, pageSize: options.pageSize });
  const account = createAccount({
    auth: auth.forAccount,
    social: social.forAccount,
    media: { purgeOwner: async () => [], requestDeletion: async () => undefined, exportImages: async () => [], exportAvatar: async () => null },
    moderation: moderation.forAccount,
    activity: activity.forAccount,
    requireSession: auth.requireSession,
    requireFreshAuth: auth.requireFreshAuth(),
    requireStrongFreshAuth: auth.requireStrongFreshAuth(),
    rateLimitStore,
    logger,
  });
  const app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, social, moderation, account, activity });
  const made: string[] = [];
  const before = await rowCounts(apiDb, ACTIVITY_TABLES);

  /** Sets the profile's age in hours, as only the migrator may. */
  const age = (id: string, hours: number) => migrateDb.execute(sql`update profiles set created_at = now() - make_interval(secs => ${hours * 3_600}) where id = ${id}::uuid`);

  /** A signed-in, onboarded web account, its profile `ageHours` old (three days unless said). */
  async function signUp(ageHours = 72): Promise<Member> {
    const b = new Browser(app, config.APP_ORIGIN);
    const email = `activity-${randomUUID()}@korbat.local`;
    const handle = `a${randomBytes(5).toString("hex")}`;
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    const { flowId } = FlowResponse.parse(await start.json());
    expect((await b.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } })).status).toBe(200);
    expect((await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).status).toBe(200);
    expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: `User ${handle}` } })).status).toBe(200);
    const id = MeResponse.parse(await (await b.fetch("/api/me")).json()).user.id;
    made.push(id);
    await age(id, ageHours);
    return { b, id, handle };
  }

  /** Posts as `m` and answers the view; `extra` names a reply's parent or a quote's post, or hides the counts. */
  async function post(m: Member, body: string, extra: { replyToId?: string; quoteOfId?: string; hideCounts?: boolean } = {}): Promise<PostView> {
    const res = await m.b.fetch("/api/posts", { json: { body, ...extra } });
    expect(res.status, await res.clone().text()).toBe(201);
    return PostView.parse(await res.json());
  }

  /** A relation from `m` to `other` over HTTP, and its answer's status. */
  const relate = async (m: Member, other: Member, what: "follow" | "block" | "mute", on = true) => (await m.b.fetch(`/api/profiles/${other.handle}/${what}`, { method: on ? "POST" : "DELETE" })).status;

  /** One page of `m`'s Activity, checked against the contract. */
  async function page(m: Member, query: { tab?: "all" | "conversations"; cursor?: string } = {}): Promise<ActivityPage> {
    const params = new URLSearchParams();
    if (query.tab) params.set("tab", query.tab);
    if (query.cursor) params.set("cursor", query.cursor);
    const res = await m.b.fetch(`/api/activity${params.size > 0 ? `?${params}` : ""}`);
    expect(res.status, await res.clone().text()).toBe(200);
    return ActivityPage.parse(await res.json());
  }

  /** Every page of `m`'s Activity, followed cursor by cursor. */
  async function all(m: Member, tab: "all" | "conversations" = "all"): Promise<ActivityEntry[]> {
    const items: ActivityEntry[] = [];
    let cursor: string | undefined;
    for (let n = 0; n < 50; n++) {
      const got = await page(m, { tab, cursor });
      items.push(...got.items);
      if (got.nextCursor === null) return items;
      cursor = got.nextCursor;
    }
    throw new Error("Activity did not end in fifty pages");
  }

  /** What a list says, entry by entry: a post entry's kind and post, a group's day and accounts, a notice's kind and id. */
  const summary = (items: readonly ActivityEntry[]) =>
    items.map((entry) =>
      entry.type === "post" ? `${entry.kind}:${entry.post.id}` : entry.type === "follows" ? `follows:${entry.key.slice(2)}:${entry.count}:${entry.actors.map((a) => a.handle).join(",")}` : `${entry.kind}:${entry.id}`,
    );

  /** `m`'s rules, set over HTTP. */
  async function settings(m: Member, rules: Partial<ActivitySettings>): Promise<ActivitySettings> {
    const current = ActivitySettings.parse(await (await m.b.fetch("/api/activity/settings")).json());
    const res = await m.b.fetch("/api/activity/settings", { method: "PUT", json: { ...current, ...rules } });
    expect(res.status, await res.clone().text()).toBe(200);
    return ActivitySettings.parse(await res.json());
  }

  /** The error code of a refused answer. */
  const code = async (res: Response) => ErrorEnvelope.parse(await res.json()).error.code;

  /** The entries of `recipient` as stored, oldest first: kind, actor and post. */
  const stored = async (recipientId: string) =>
    (
      await migrateDb.execute<{ kind: string; actor_id: string; post_id: string | null }>(
        sql`select kind::text as kind, actor_id, post_id from activity_items where recipient_id = ${recipientId}::uuid order by created_at, id`,
      )
    ).map((row) => ({ kind: row.kind, actor: row.actor_id, post: row.post_id }));

  return {
    config,
    app,
    apiDb,
    migrateDb,
    social,
    activity,
    moderation,
    made,
    age,
    signUp,
    post,
    relate,
    page,
    all,
    summary,
    settings,
    code,
    stored,
    /** 2d's tables as they stand now. */
    counts: () => rowCounts(apiDb, ACTIVITY_TABLES),
    /** What they held before the suite's first test. */
    before,
    /** Removes every account the suite made, with what hangs on them, and closes the pools. */
    async close(): Promise<void> {
      try {
        await removeFixtures(migrateDb, made.splice(0));
      } finally {
        await Promise.all([closeDb(authDb), closeDb(apiDb), closeDb(migrateDb)]);
      }
    },
    /** Removes the accounts made so far, for a suite's last test that holds the tables to what they were. */
    async removeMade(): Promise<void> {
      await removeFixtures(migrateDb, made.splice(0));
    },
  };
}

export type ActivityHarness = Awaited<ReturnType<typeof activityHarness>>;
