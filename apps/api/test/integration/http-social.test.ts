import { randomBytes, randomUUID } from "node:crypto";
import pino from "pino";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { EngagementResponse, ErrorEnvelope, FlowResponse, MeResponse, PostPage, PostView, ProfilePage, ProfileView, ThreadResponse, TimelinePage } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth } from "../../src/auth";
import { randomToken } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { createSocial } from "../../src/social";
import { DAY_MS } from "../../src/social/tiers";
import { Browser } from "./http-client";
import { importCounts } from "./imports-harness";
import { liftRowForTest, suspendRowForTest } from "./moderation-fixtures";

type App = ReturnType<typeof createApp>;

/**
 * The social endpoints through the real app: 1a sign-up for the accounts, cookie sessions with CSRF,
 * and a clock the tests move so accounts can age past the new-account tier.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: posting and feed over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let migrateDb: Db;
  let app: App;
  /** 3b Task 6: the import tables' rows before the file's first test. */
  let importRows: Record<string, number>;
  const mailer = new MemoryMailer();
  let offsetMs = 0;
  let tick = 0;
  /** Strictly increasing even within one millisecond, so list order never depends on a tie-breaker. */
  const now = () => new Date(Date.now() + offsetMs + ++tick);

  beforeAll(async () => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    // 3e: only the migrator writes a suspension into a profile row, as the ledger's standing_apply does.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 1 });
    const rateLimitStore = new MemoryStore(() => now().getTime());
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
    const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth(), now });
    app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, social });
    importRows = await importCounts(apiDb);
  });
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(apiDb), closeDb(migrateDb)]);
  });

  /** A signed-in, onboarded web account. Accounts are as old as the clock offset says. */
  async function signUp() {
    const b = new Browser(app, config.APP_ORIGIN);
    const email = `social-${randomUUID()}@korbat.local`;
    const handle = `s${randomBytes(4).toString("hex")}`;
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(start.status).toBe(200);
    const { flowId } = FlowResponse.parse(await start.json());
    expect((await b.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } })).status).toBe(200);
    expect((await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).status).toBe(200);
    expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: `User ${handle}` } })).status).toBe(200);
    return { b, handle };
  }

  const json = async (res: Response) => res.json() as Promise<unknown>;
  const errorCode = async (res: Response) => ErrorEnvelope.parse(await res.json()).error.code;
  const post = async (b: Browser, body: string, extra: Record<string, string> = {}) => {
    const res = await b.fetch("/api/posts", { json: { body, ...extra } });
    expect(res.status).toBe(201);
    return PostView.parse(await res.json());
  };

  test("posting, replying, quoting, reading a thread, and reading signed out", async () => {
    offsetMs = 3 * DAY_MS;
    const ada = await signUp();
    const root = await post(ada.b, "  hello\r\n\r\n\r\nworld  ");
    expect(root.body).toBe("hello\n\nworld");
    expect(root.author.handle).toBe(ada.handle);
    expect(root.viewer).toEqual({ liked: false, reposted: false, bookmarked: false });
    const reply = await post(ada.b, "a reply", { replyToId: root.id });
    expect(reply.replyTo).toEqual({ id: root.id, authorHandle: ada.handle });
    const quote = await post(ada.b, "a quote", { quoteOfId: root.id });
    expect(quote.quoteOf).toMatchObject({ id: root.id, body: "hello\n\nworld", quoteOf: null });

    const signedOut = await app.request(`/api/posts/${root.id}`);
    expect(signedOut.status).toBe(200);
    const view = PostView.parse(await signedOut.json());
    expect(view.viewer).toBeUndefined();
    expect(view.counts).toEqual({ likes: 0, reposts: 0, replies: 1, quotes: 1 });

    const thread = ThreadResponse.parse(await json(await app.request(`/api/posts/${reply.id}/thread`)));
    expect(thread.ancestors.map((a) => a.id)).toEqual([root.id]);
    expect(thread.post.id).toBe(reply.id);
    const both = await ada.b.fetch("/api/posts", { json: { body: "x", replyToId: root.id, quoteOfId: root.id } });
    expect(both.status).toBe(400);
    expect(await errorCode(both)).toBe("invalid_request");
  });

  test("follows, timelines, profiles and the follower lists", async () => {
    offsetMs = 3 * DAY_MS;
    const [ada, bob] = [await signUp(), await signUp()];
    const b1 = await post(bob.b, "from bob");
    expect(await json(await ada.b.fetch(`/api/profiles/${bob.handle}/follow`, { method: "POST" }))).toEqual({ following: true, followerCount: 1 });
    const a1 = await post(ada.b, "from ada");
    const repost = EngagementResponse.parse(await json(await bob.b.fetch(`/api/posts/${a1.id}/repost`, { method: "POST" })));
    expect(repost.counts.reposts).toBe(1);

    const feed = TimelinePage.parse(await json(await ada.b.fetch("/api/timeline/following")));
    expect(feed.items.map((i) => (i.kind === "repost" ? `repost:${i.post.id}:${i.repostedBy.handle}` : `post:${i.post.id}`))).toEqual([
      `repost:${a1.id}:${bob.handle}`,
      `post:${a1.id}`,
      `post:${b1.id}`,
    ]);
    const latest = TimelinePage.parse(await json(await app.request("/api/timeline/latest?limit=50")));
    expect(latest.items.map((i) => i.post.id)).toEqual(expect.arrayContaining([a1.id, b1.id]));
    expect(latest.items.every((i) => i.kind === "post")).toBe(true);

    const profile = ProfileView.parse(await json(await ada.b.fetch(`/api/profiles/@${bob.handle.toUpperCase()}`)));
    expect(profile.handle).toBe(bob.handle);
    expect(profile.counts).toEqual({ posts: 1, followers: 1, following: 0 });
    expect(profile.viewer).toEqual({ following: true, followedBy: false, blocked: false, muted: false });
    expect(ProfileView.parse(await json(await app.request(`/api/profiles/${bob.handle}`))).viewer).toBeUndefined();

    const followersPage = ProfilePage.parse(await json(await bob.b.fetch(`/api/profiles/${bob.handle}/followers`)));
    expect(followersPage.items.map((i) => [i.handle, i.viewerFollows])).toEqual([[ada.handle, false]]);
    expect((await app.request(`/api/profiles/${bob.handle}/followers`)).status).toBe(401);
    const bobPosts = TimelinePage.parse(await json(await app.request(`/api/profiles/${bob.handle}/posts`)));
    expect(bobPosts.items.map((i) => i.kind)).toEqual(["repost", "post"]);
    expect((await ada.b.fetch(`/api/profiles/${bob.handle}/follow`, { method: "DELETE" })).status).toBe(200);
    expect(ProfileView.parse(await json(await app.request(`/api/profiles/${bob.handle}`))).counts.followers).toBe(0);
  });

  test("likes, reposts and bookmarks with their private lists", async () => {
    offsetMs = 3 * DAY_MS;
    const [ada, bob] = [await signUp(), await signUp()];
    const target = await post(ada.b, "engage me");
    expect(EngagementResponse.parse(await json(await bob.b.fetch(`/api/posts/${target.id}/like`, { method: "POST" })))).toEqual({
      counts: { likes: 1, reposts: 0, replies: 0, quotes: 0 },
      viewer: { liked: true, reposted: false, bookmarked: false },
    });
    expect(EngagementResponse.parse(await json(await bob.b.fetch(`/api/posts/${target.id}/like`, { method: "POST" }))).counts.likes).toBe(1);
    expect(EngagementResponse.parse(await json(await bob.b.fetch(`/api/posts/${target.id}/bookmark`, { method: "POST" }))).viewer.bookmarked).toBe(true);
    expect(PostPage.parse(await json(await bob.b.fetch("/api/me/likes"))).items.map((p) => p.id)).toEqual([target.id]);
    expect(PostPage.parse(await json(await bob.b.fetch("/api/me/bookmarks"))).items.map((p) => p.id)).toEqual([target.id]);
    expect(PostPage.parse(await json(await ada.b.fetch("/api/me/likes"))).items).toEqual([]);
    expect(EngagementResponse.parse(await json(await bob.b.fetch(`/api/posts/${target.id}/like`, { method: "DELETE" }))).counts.likes).toBe(0);
    expect((await app.request("/api/me/likes")).status).toBe(401);
    expect((await app.request("/api/me/bookmarks")).status).toBe(401);
  });

  test("blocks are directional in their errors, hide profiles both ways, and are listed for the blocker", async () => {
    offsetMs = 3 * DAY_MS;
    const [ada, bob] = [await signUp(), await signUp()];
    const adaPost = await post(ada.b, "ada's post");
    expect(await json(await ada.b.fetch(`/api/profiles/${bob.handle}/block`, { method: "POST" }))).toEqual({ blocked: true });

    const bobSeesAda = await bob.b.fetch(`/api/profiles/${ada.handle}`);
    expect(bobSeesAda.status).toBe(404);
    expect((await bob.b.fetch(`/api/posts/${adaPost.id}`)).status).toBe(404);
    const bobFollows = await bob.b.fetch(`/api/profiles/${ada.handle}/follow`, { method: "POST" });
    expect(bobFollows.status).toBe(404);
    const bobLikes = await bob.b.fetch(`/api/posts/${adaPost.id}/like`, { method: "POST" });
    expect(bobLikes.status).toBe(404);
    const bobReplies = await bob.b.fetch("/api/posts", { json: { body: "reply", replyToId: adaPost.id } });
    expect(await errorCode(bobReplies)).toBe("post_unavailable");

    expect((await ada.b.fetch(`/api/profiles/${bob.handle}`)).status).toBe(404);
    const adaFollows = await ada.b.fetch(`/api/profiles/${bob.handle}/follow`, { method: "POST" });
    expect(adaFollows.status).toBe(403);
    expect(await errorCode(adaFollows)).toBe("blocked");
    expect(ProfilePage.parse(await json(await ada.b.fetch("/api/me/blocks"))).items.map((i) => i.handle)).toEqual([bob.handle]);
    expect((await app.request(`/api/profiles/${ada.handle}`)).status).toBe(200);

    expect(await json(await ada.b.fetch(`/api/profiles/${bob.handle}/block`, { method: "DELETE" }))).toEqual({ blocked: false });
    expect((await bob.b.fetch(`/api/profiles/${ada.handle}`)).status).toBe(200);
    expect(ProfilePage.parse(await json(await ada.b.fetch("/api/me/blocks"))).items).toEqual([]);
  });

  test("mutes are silent and hide the muted account from timelines only", async () => {
    offsetMs = 3 * DAY_MS;
    const [ada, bob] = [await signUp(), await signUp()];
    await ada.b.fetch(`/api/profiles/${bob.handle}/follow`, { method: "POST" });
    const b1 = await post(bob.b, "muted soon");
    expect(await json(await ada.b.fetch(`/api/profiles/${bob.handle}/mute`, { method: "POST" }))).toEqual({ muted: true });
    expect(TimelinePage.parse(await json(await ada.b.fetch("/api/timeline/following"))).items).toEqual([]);
    expect(TimelinePage.parse(await json(await ada.b.fetch(`/api/profiles/${bob.handle}/posts`))).items.map((i) => i.post.id)).toEqual([b1.id]);
    expect(ProfileView.parse(await json(await bob.b.fetch(`/api/profiles/${ada.handle}`))).viewer?.followedBy).toBe(true);
    expect(ProfilePage.parse(await json(await ada.b.fetch("/api/me/mutes"))).items.map((i) => i.handle)).toEqual([bob.handle]);
    expect(await json(await ada.b.fetch(`/api/profiles/${bob.handle}/mute`, { method: "DELETE" }))).toEqual({ muted: false });
    expect(TimelinePage.parse(await json(await ada.b.fetch("/api/timeline/following"))).items.map((i) => i.post.id)).toEqual([b1.id]);
  });

  test("new accounts get the low tier with Retry-After, and the tier lifts as the account ages", async () => {
    offsetMs = 0;
    const young = await signUp();
    for (let i = 0; i < 5; i++) await post(young.b, `post ${i}`);
    const sixth = await young.b.fetch("/api/posts", { json: { body: "one too many" } });
    expect(sixth.status).toBe(429);
    expect(await errorCode(sixth)).toBe("rate_limited");
    expect(Number(sixth.headers.get("retry-after"))).toBeGreaterThan(0);
    const own = TimelinePage.parse(await json(await young.b.fetch("/api/timeline/following"))).items[0]!.post;
    expect((await young.b.fetch("/api/posts", { json: { body: "replies have their own window", replyToId: own.id } })).status).toBe(201);
    const repost = await young.b.fetch(`/api/posts/${own.id}/repost`, { method: "POST" });
    expect(repost.status).toBe(403);
    expect(await errorCode(repost)).toBe("account_too_new");
    const quote = await young.b.fetch("/api/posts", { json: { body: "quote", quoteOfId: own.id } });
    expect(await errorCode(quote)).toBe("account_too_new");

    offsetMs = 3 * DAY_MS;
    expect((await young.b.fetch("/api/posts", { json: { body: "established now" } })).status).toBe(201);
    expect((await young.b.fetch(`/api/posts/${own.id}/repost`, { method: "POST" })).status).toBe(200);
  });

  test("deleting: the author gets 204, others 403, and the tombstone stays in threads", async () => {
    offsetMs = 3 * DAY_MS;
    const [ada, bob] = [await signUp(), await signUp()];
    const root = await post(ada.b, "root");
    const reply = await post(bob.b, "reply", { replyToId: root.id });
    const notAuthor = await bob.b.fetch(`/api/posts/${root.id}`, { method: "DELETE" });
    expect(notAuthor.status).toBe(403);
    expect(await errorCode(notAuthor)).toBe("not_author");
    expect((await ada.b.fetch(`/api/posts/${root.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await ada.b.fetch(`/api/posts/${root.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await app.request(`/api/posts/${root.id}`)).status).toBe(404);
    const thread = ThreadResponse.parse(await json(await app.request(`/api/posts/${reply.id}/thread`)));
    expect(thread.ancestors).toEqual([{ id: root.id, deleted: true }]);
    expect(TimelinePage.parse(await json(await app.request(`/api/profiles/${ada.handle}/posts`))).items).toEqual([]);
  });

  test("3e: while an account's suspension runs, its post, like, repost, bookmark and follow answer 403 account_suspended with no detail; undoing, deleting, blocking and muting answer as ever", async () => {
    offsetMs = 3 * DAY_MS;
    const [ada, bob] = await Promise.all([signUp(), signUp()]);
    const theirs = await post(bob.b, "bob's post");
    const own = await post(ada.b, "ada's post");
    expect((await ada.b.fetch(`/api/posts/${theirs.id}/like`, { method: "POST" })).status).toBe(200);
    expect((await ada.b.fetch(`/api/profiles/${bob.handle}/follow`, { method: "POST" })).status).toBe(200);
    const [row] = await apiDb.execute<{ id: string }>(sql`select id from profiles where handle = ${ada.handle}`);
    await suspendRowForTest(migrateDb, row!.id);
    const refused = async (res: Response) => {
      expect(res.status).toBe(403);
      const body = ErrorEnvelope.parse(await res.json());
      expect(body.error.code).toBe("account_suspended");
      expect(body.error.details).toBeUndefined();
    };
    await refused(await ada.b.fetch("/api/posts", { json: { body: "while suspended" } }));
    await refused(await ada.b.fetch("/api/posts", { json: { body: "a reply", replyToId: theirs.id } }));
    for (const kind of ["repost", "bookmark"]) await refused(await ada.b.fetch(`/api/posts/${theirs.id}/${kind}`, { method: "POST" }));
    // Already following bob makes no difference: the follow's lock statement refuses before anything is written.
    await refused(await ada.b.fetch(`/api/profiles/${bob.handle}/follow`, { method: "POST" }));
    expect((await ada.b.fetch(`/api/posts/${theirs.id}/like`, { method: "DELETE" })).status).toBe(200);
    expect((await ada.b.fetch(`/api/profiles/${bob.handle}/follow`, { method: "DELETE" })).status).toBe(200);
    expect((await ada.b.fetch(`/api/profiles/${bob.handle}/mute`, { method: "POST" })).status).toBe(200);
    expect((await ada.b.fetch(`/api/posts/${own.id}`, { method: "DELETE" })).status).toBe(204);
    // What others do toward it is unchanged.
    expect((await bob.b.fetch(`/api/profiles/${ada.handle}/follow`, { method: "POST" })).status).toBe(200);
    // An app built without the moderation module answers /api/me's standing null.
    expect(MeResponse.parse(await (await ada.b.fetch("/api/me")).json()).standing).toBeNull();
    await liftRowForTest(migrateDb, row!.id);
    expect((await ada.b.fetch("/api/posts", { json: { body: "after" } })).status).toBe(201);
  });

  test("cursors page the Latest timeline and malformed ones are refused", async () => {
    offsetMs = 3 * DAY_MS;
    const ada = await signUp();
    const made = [];
    for (let i = 0; i < 3; i++) made.push((await post(ada.b, `page ${i}`)).id);
    const first = TimelinePage.parse(await json(await app.request("/api/timeline/latest?limit=2")));
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = TimelinePage.parse(await json(await app.request(`/api/timeline/latest?limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`)));
    expect(second.items.map((i) => i.post.id)).not.toEqual(first.items.map((i) => i.post.id));
    const bad = await app.request("/api/timeline/latest?cursor=not-a-cursor");
    expect(bad.status).toBe(400);
    expect(await errorCode(bad)).toBe("invalid_request");
    expect((await app.request("/api/profiles/no_such_handle_xyz")).status).toBe(404);
  });

  // 3b Task 6 (design, sections 9.2 and 10.6): the profile's Imported tab, public as its Posts tab is.
  test("the Imported tab: an account's imported top-level posts, newest archive date first, each labelled with its day, signed out too; in no timeline and no Posts or Replies tab; the profile says it has one", async () => {
    offsetMs = 3 * DAY_MS;
    const ada = await signUp();
    const native = await post(ada.b, "a post written on korbat");
    const adaId = native.author.id;
    expect(ProfileView.parse(await json(await app.request(`/api/profiles/${ada.handle}`))).hasImported).toBe(false);
    const job = randomUUID();
    const [first, second, reply]: string[] = [randomUUID(), randomUUID(), randomUUID()];
    // As the migrator, as a publishing import writes them: a post of January 2019, one of May shortened on import, and the
    // account's own reply to the first.
    await migrateDb.execute(sql`
      insert into import_jobs (id, owner_id, source, status, declared_bytes, received_bytes, uploaded_at, scanned_at, confirmed_at, ended_at, choice, stated_at, posts_published)
      values (${job}::uuid, ${adaId}::uuid, 'x', 'done', 10, 10, now(), now(), now(), now(),
              ${JSON.stringify({ from: null, to: null, replies: false, warnings: false, protected: false, images: false, long: "shorten" })}::jsonb, now(), 3)`);
    await migrateDb.execute(sql`
      insert into posts (id, author_id, body, reply_to_id, created_at, import_job_id, import_source, original_created_at, import_shortened, import_key)
      values (${first}::uuid, ${adaId}::uuid, 'from the archive, January', null, now(), ${job}::uuid, 'x', '2019-01-02T23:30:00Z', false, ${randomBytes(32)}::bytea),
             (${second}::uuid, ${adaId}::uuid, 'from the archive, May', null, now(), ${job}::uuid, 'x', '2019-05-06T00:30:00Z', true, ${randomBytes(32)}::bytea),
             (${reply}::uuid, ${adaId}::uuid, 'and a reply of the thread', ${first}::uuid, now(), ${job}::uuid, 'x', '2019-01-03T08:00:00Z', false, ${randomBytes(32)}::bytea)`);
    try {
      const tab = PostPage.parse(await json(await app.request(`/api/profiles/${ada.handle}/imported`)));
      expect(tab.items.map((item) => item.id)).toEqual([second, first]);
      // The archive's day in UTC, never its second.
      expect(tab.items.map((item) => item.imported)).toEqual([
        { source: "x", at: "2019-05-06", shortened: true },
        { source: "x", at: "2019-01-02", shortened: false },
      ]);
      expect(JSON.stringify(tab)).not.toContain("23:30");
      expect(PostPage.parse(await json(await ada.b.fetch(`/api/profiles/${ada.handle}/imported`))).items.map((item) => item.id)).toEqual([second, first]);
      expect(ProfileView.parse(await json(await app.request(`/api/profiles/${ada.handle}`))).hasImported).toBe(true);
      // A native post carries no label and is not on the tab; the imported ones are on no other list.
      expect(native.imported).toBeNull();
      const posts = TimelinePage.parse(await json(await app.request(`/api/profiles/${ada.handle}/posts?limit=50`)));
      expect(posts.items.map((item) => item.post.id)).toEqual([native.id]);
      const replies = PostPage.parse(await json(await app.request(`/api/profiles/${ada.handle}/replies?limit=50`)));
      expect(replies.items.map((item) => item.id)).not.toContain(reply);
      const latest = TimelinePage.parse(await json(await app.request("/api/timeline/latest?limit=50")));
      expect(latest.items.map((item) => item.post.id).filter((id) => [first, second, reply].includes(id))).toEqual([]);
      const own = TimelinePage.parse(await json(await ada.b.fetch("/api/timeline/following?limit=50")));
      expect(own.items.map((item) => item.post.id).filter((id) => [first, second, reply].includes(id))).toEqual([]);
      // The reply is on its post's page, with its own label.
      const read = ThreadResponse.parse(await json(await app.request(`/api/posts/${first}/thread`)));
      expect(read.replies.items.map((item) => [item.id, item.imported?.at])).toEqual([[reply, "2019-01-03"]]);
      expect((await app.request(`/api/profiles/no_such_handle_xyz/imported`)).status).toBe(404);
    } finally {
      await migrateDb.execute(sql`delete from posts where import_job_id = ${job}::uuid`);
      await migrateDb.execute(sql`delete from import_jobs where id = ${job}::uuid`);
    }
  });

  // 3f (design, section 7.12; invariant 19): the status of a post's page, which Caddy asks for /post/*, follows what a
  // signed-out read of the post answers: 204 while it is public, 404 once its author deleted it, with no body either way.
  test("a post's status is 204 while a signed-out read shows it, and 404 once its author deleted it", async () => {
    offsetMs = 3 * DAY_MS;
    const ada = await signUp();
    const made = await post(ada.b, "a post whose page is checked");
    const asked = await app.request(`/api/posts/${made.id}/status`);
    expect([asked.status, await asked.text()]).toEqual([204, ""]);
    expect((await app.request(`/api/posts/${made.id}`)).status).toBe(200);
    expect((await ada.b.fetch(`/api/posts/${made.id}`, { method: "DELETE" })).status).toBe(204);
    const gone = await app.request(`/api/posts/${made.id}/status`);
    expect([gone.status, await gone.text()]).toEqual([404, ""]);
    expect((await app.request(`/api/posts/${made.id}`)).status).toBe(404);
  });

  test("3b Task 6: this file left no import row behind", async () => {
    expect(await importCounts(apiDb)).toEqual(importRows);
  });
});
