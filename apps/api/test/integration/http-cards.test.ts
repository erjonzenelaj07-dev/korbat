import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import pino from "pino";
import type { MiddlewareHandler } from "hono";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth } from "../../src/auth";
import { MemoryKv } from "../../src/auth/kv";
import { createCards } from "../../src/cards";
import { loadConfig, type Config } from "../../src/config";
import type { AppEnv } from "../../src/env";
import { MemoryMailer } from "../../src/mail/memory";
import { createMedia, mediaForCases } from "../../src/media";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { avatarSet } from "../../src/moderation/automated";
import { createProfileStore } from "../../src/profiles/store";
import { createSocial, enforceWriteLimit } from "../../src/social";
import { createSocialRepo } from "../../src/social/repo";
import { DAY_MS } from "../../src/social/tiers";
import { automationDeps, removeAutomation } from "./automation-fixtures";
import { mediaHarness, type MediaHarness } from "./media-harness";
import { closeDecisions, suspendForTest } from "./moderation-decide";
import { newPostRow, removeFixtures } from "./moderation-fixtures";
import { removeRecords } from "./records-fixtures";
import { newProfile } from "./social-fixtures";

type App = ReturnType<typeof createApp>;

// A suspension at once and the automated check of a picture each commit a moderator's or a program's decision: slow on a
// loaded machine.
vi.setConfig({ testTimeout: 120_000 });

/**
 * 2d Task 6 (design, sections 8.1 and 8.4; section 12.3): the share cards through the real app. GET /api/cards/post/:id
 * and GET /api/cards/profile/:handle are the cards module's router, mounted beside the status route of 3f, after the
 * global limit and before the session's resolution: 204 with the head block, base64, in Korbat-Card, or 404 with no body,
 * no-store either way, the same for everyone. Each row of 8.4: a post visible, with its author's previews off (the default,
 * a generic card) and on; its author suspended (no label); withheld, removed, disabled, deleted, erased, missing, or its
 * author deleted (404); a reply and a quote, of their own text and images; an imported post with its label first; a
 * profile live, off and on, suspended, deleted, an old handle and an unknown one. An image withheld, sealed or erased is
 * never on a card, and nor is a picture that R1's review withholds (Task 4's hold), on a profile's card or as a post's
 * fallback. The status route answers as before. And every answer of the API, an image's included, says noindex.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: share cards", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let migrateDb: Db;
  let app: App;
  let h: MediaHarness;
  let startedAt: string;
  let resolved = 0;
  const accounts: string[] = [];
  const media: string[] = [];

  beforeAll(async () => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 6 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    h = await mediaHarness(apiDb);
    startedAt = (await apiDb.execute<{ now: string }>(sql`select now()::text as now`))[0]!.now;
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
    // The session's resolution, counted: a card route must never reach it.
    const resolveSession: MiddlewareHandler<AppEnv> = (c, next) => {
      resolved++;
      return auth.resolveSession(c, next);
    };
    // The media module over the harness's two volumes, so its stand-in worker's files are the ones served.
    const mediaModule = createMedia({
      apiDb,
      uploadsDir: h.files.uploads.root,
      storeDir: h.files.store.root,
      formats: config.MEDIA_FORMATS,
      minFreeBytes: 0,
      logger,
      requireSession: auth.requireSession,
      resolveSession: auth.resolveSession,
      rateLimitStore,
      enforceUploadLimit: (userId, accountCreatedAt, at) => enforceWriteLimit(rateLimitStore, userId, "upload", accountCreatedAt, at),
    });
    const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth(), media: mediaModule.forPosts });
    const cards = createCards({ social: social.forCards, appOrigin: config.APP_ORIGIN });
    app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth: { ...auth, resolveSession }, social, media: mediaModule, cards });
  }, 240_000);
  afterAll(async () => {
    try {
      await closeDecisions();
      await removeAutomation(migrateDb, startedAt, media);
      await removeRecords(migrateDb, accounts);
      await removeFixtures(migrateDb, accounts);
    } finally {
      h.cleanup();
      await Promise.all([closeDb(authDb), closeDb(apiDb), closeDb(migrateDb)]);
    }
  });

  const origin = () => new URL(config.APP_ORIGIN).origin;
  const LF = String.fromCharCode(10);

  /** A card route's answer: its status, its body, its head block decoded (null without one), and its two headers. */
  async function card(path: string, headers: Record<string, string> = {}) {
    const res = await app.request(path, { headers });
    const header = res.headers.get("korbat-card");
    return {
      status: res.status,
      body: await res.text(),
      block: header === null ? null : Buffer.from(header, "base64").toString("utf8"),
      cache: res.headers.get("cache-control"),
      robots: res.headers.get("x-robots-tag"),
    };
  }
  const postCard = (id: string, headers?: Record<string, string>) => card(`/api/cards/post/${id}`, headers);
  const profileCard = (handle: string, headers?: Record<string, string>) => card(`/api/cards/profile/${handle}`, headers);
  /** The block's lines as [key, content], each a meta element of its own. */
  function metas(block: string | null): [string, string][] {
    if (block === null) throw new Error("no block");
    return block.split(LF).map((line) => {
      const found = /^<meta (?:name|property)="([^"]+)" content="([^"]*)" [/]>$/.exec(line);
      if (!found) throw new Error(`a line that is no meta element: ${line}`);
      return [found[1]!, found[2]!];
    });
  }
  const value = (block: string | null, key: string) => metas(block).find(([k]) => k === key)?.[1];
  const keysOf = (block: string | null) => metas(block).map(([key]) => key);
  const GENERIC_POST = ["robots", "og:site_name", "og:type", "og:url", "og:title", "twitter:card"];

  /** An account of this file, three days old, with its display name and bio. */
  async function account(displayName: string, bio = "") {
    const made = await newProfile(apiDb, { createdAt: new Date(Date.now() - 3 * DAY_MS), displayName });
    accounts.push(made.id);
    if (bio !== "") await apiDb.execute(sql`update profiles set bio = ${bio} where id = ${made.id}::uuid`);
    return made;
  }
  /** Link previews on or off, as setSharePreviews writes the column (the API role's own grant). */
  const previews = (id: string, on: boolean) => apiDb.execute(sql`update profiles set share_previews = ${on} where id = ${id}::uuid`);
  /** A picture set as the account's own, as setAvatar sets it: the harness's ready upload attached in a transaction. */
  async function pictured(id: string): Promise<string> {
    const avatar = await h.readyAvatar(id);
    media.push(avatar);
    await apiDb.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '10s'`);
      await h.deps.repo.attachAvatar(tx, id, avatar);
    });
    return avatar;
  }

  test("a visible post: the generic card while its author's previews are off (the default), the full card once on; no-store and noindex either way", async () => {
    const ada = await account("Ada Card");
    const id = await newPostRow(apiDb, ada.id, { body: "Cards are built by the API" });
    const off = await postCard(id);
    expect([off.status, off.body, off.cache, off.robots]).toEqual([204, "", "no-store", "noindex"]);
    expect(metas(off.block)).toEqual([
      ["robots", "noindex"],
      ["og:site_name", "korbat"],
      ["og:type", "website"],
      ["og:url", `${origin()}/post/${id}`],
      ["og:title", "A post on korbat"],
      ["twitter:card", "summary"],
    ]);
    expect(off.block).not.toContain(ada.handle);
    expect(off.block).not.toContain("Cards are built");
    await previews(ada.id, true);
    const on = await postCard(id);
    expect(on.status).toBe(204);
    // The time the post was written, as a signed-out read of the post gives it.
    const created = ((await (await app.request(`/api/posts/${id}`)).json()) as { createdAt: string }).createdAt;
    expect(metas(on.block)).toEqual([
      ["robots", "noindex"],
      ["og:site_name", "korbat"],
      ["og:type", "article"],
      ["og:url", `${origin()}/post/${id}`],
      ["og:title", `Ada Card (@${ada.handle})`],
      ["og:description", "Cards are built by the API"],
      ["description", "Cards are built by the API"],
      ["article:published_time", created],
      ["twitter:card", "summary"],
    ]);
  });

  test("withheld, removed, disabled, deleted, erased and missing posts get 404 with no body, as the status route answers them; a visible one 204 from both", async () => {
    const ada = await account("Ada States");
    await previews(ada.id, true);
    const posts: Record<string, string> = {};
    for (const state of ["visible", "withheld", "removed", "disabled", "deleted_by_author", "erased"] as const) {
      const id = await newPostRow(apiDb, ada.id, { body: `a post that is ${state}` });
      if (state === "deleted_by_author") await migrateDb.execute(sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${id}::uuid`);
      // An erasure, as 3c's R4 redaction leaves a post: the body blanked and the post removed.
      else if (state === "erased") await migrateDb.execute(sql`update posts set erased_at = now(), body = '', state = 'removed', moderation_level = 'removed' where id = ${id}::uuid`);
      else if (state !== "visible") await migrateDb.execute(sql`update posts set state = ${state}::post_state, moderation_level = ${state}::moderation_level where id = ${id}::uuid`);
      posts[state] = id;
    }
    posts.missing = randomUUID();
    for (const [state, id] of Object.entries(posts)) {
      const answer = await postCard(id);
      const status = await app.request(`/api/posts/${id}/status`);
      const expected = state === "visible" ? 204 : 404;
      expect([state, answer.status, status.status]).toEqual([state, expected, expected]);
      if (expected === 404) expect([state, answer.body, answer.block, answer.cache, answer.robots]).toEqual([state, "", null, "no-store", "noindex"]);
      expect(await status.text()).toBe("");
    }
  });

  test("a malformed id or handle is 404 with no body, never the validator's JSON", async () => {
    for (const path of ["/api/cards/post/not-a-uuid", `/api/cards/post/${encodeURIComponent("../health")}`, `/api/cards/post/${"x".repeat(300)}`, "/api/cards/profile/ab", "/api/cards/profile/a-b", `/api/cards/profile/${"a".repeat(21)}`, `/api/cards/profile/${encodeURIComponent("../me")}`]) {
      const answer = await card(path);
      expect([path, answer.status, answer.body, answer.block]).toEqual([path, 404, "", null]);
    }
  });

  test("a post's image is the first one shown to everyone: a withheld, a sealed and an erased image are never named; the image's own size and description", async () => {
    const ada = await account("Ada Images");
    await previews(ada.id, true);
    const { postId, mediaIds } = await h.postWithImages(ada.id, 4, "four images");
    media.push(...mediaIds);
    const [withheld, sealed, erased, shown] = mediaIds as [string, string, string, string];
    await migrateDb.execute(sql`update post_media set moderation_state = 'withheld' where id = ${withheld}::uuid`);
    await migrateDb.execute(sql`update post_media set moderation_state = 'sealed' where id = ${sealed}::uuid`);
    await migrateDb.execute(sql`update post_media set erased_at = now() where id = ${erased}::uuid`);
    const answer = await postCard(postId);
    expect(answer.status).toBe(204);
    expect(keysOf(answer.block)).toEqual(["robots", "og:site_name", "og:type", "og:url", "og:title", "og:description", "description", "og:image", "og:image:type", "og:image:width", "og:image:height", "og:image:alt", "article:published_time", "twitter:card"]);
    expect(value(answer.block, "og:image")).toBe(`${origin()}/api/media/${shown}/large.webp`);
    expect([value(answer.block, "og:image:type"), value(answer.block, "og:image:width"), value(answer.block, "og:image:height"), value(answer.block, "og:image:alt")]).toEqual(["image/webp", "2048", "1536", "image 4"]);
    expect(value(answer.block, "twitter:card")).toBe("summary_large_image");
    for (const hidden of [withheld, sealed, erased]) expect(answer.block).not.toContain(hidden);
    // Every answer of the API says noindex, an image's too.
    const file = await app.request(`/api/media/${shown}/large.webp`);
    expect([file.status, file.headers.get("x-robots-tag")]).toEqual([200, "noindex"]);
    await file.arrayBuffer();
  });

  test("a reply and a quote: each its own text and images, nothing of the parent, nothing of the quoted post", async () => {
    const [ada, grace] = [await account("Ada Replies"), await account("Grace Quoted")];
    await previews(ada.id, true);
    await previews(grace.id, true);
    const { postId: quotedId, mediaIds } = await h.postWithImages(grace.id, 1, "the quoted post's words");
    media.push(...mediaIds);
    const parent = await newPostRow(apiDb, grace.id, { body: "the parent's words" });
    const reply = await newPostRow(apiDb, ada.id, { body: "a reply of my own", replyToId: parent });
    const quote = await newPostRow(apiDb, ada.id, { body: "a quote of my own", quoteOfId: quotedId });
    const replied = await postCard(reply);
    expect(value(replied.block, "og:description")).toBe("a reply of my own");
    expect(replied.block).not.toContain(grace.handle);
    expect(replied.block).not.toContain("parent");
    const quoted = await postCard(quote);
    expect(value(quoted.block, "og:description")).toBe("a quote of my own");
    expect(keysOf(quoted.block)).not.toContain("og:image");
    expect(quoted.block).not.toContain(mediaIds[0]!);
    expect(quoted.block).not.toContain("quoted post");
  });

  test("an imported post carries its label first, with its source and the archive's day", async () => {
    const ada = await account("Ada Imports");
    await previews(ada.id, true);
    const jobId = randomUUID();
    await migrateDb.execute(sql`insert into import_jobs (id, owner_id, source, status, declared_bytes) values (${jobId}::uuid, ${ada.id}::uuid, 'mastodon', 'publishing', 1000)`);
    const postId = randomUUID();
    const result = await createSocialRepo(apiDb).publishImportedBatch(
      { id: jobId, ownerId: ada.id, source: "mastodon", cursor: 0 },
      { lines: 1, posts: [{ id: postId, parentId: null, body: "a post from elsewhere", originalCreatedAt: "2019-03-03T12:00:00Z", shortened: true, key: randomBytes(32).toString("hex"), images: [] }] },
      new Date(),
      async () => undefined,
    );
    expect(result.written).toBe(true);
    const answer = await postCard(postId);
    expect(value(answer.block, "og:description")).toBe("Imported from Mastodon, dated 3 March 2019, shortened on import. a post from elsewhere");
  });

  test("a live profile: generic while its previews are off, then its name, bio and picture; a post without an image falls back to the author's picture", async () => {
    const ada = await account("Ada Profile", "Engines and notes.");
    const off = await profileCard(ada.handle.toUpperCase());
    expect([off.status, off.body, off.cache, off.robots]).toEqual([204, "", "no-store", "noindex"]);
    expect(metas(off.block)).toEqual([
      ["robots", "noindex"],
      ["og:site_name", "korbat"],
      ["og:type", "website"],
      ["og:url", `${origin()}/u/${ada.handle}`],
      ["og:title", "A profile on korbat"],
      ["twitter:card", "summary"],
    ]);
    expect(off.block).not.toContain("Engines");
    await previews(ada.id, true);
    const bare = await profileCard(ada.handle);
    expect(metas(bare.block)).toEqual([
      ["robots", "noindex"],
      ["og:site_name", "korbat"],
      ["og:type", "profile"],
      ["og:url", `${origin()}/u/${ada.handle}`],
      ["og:title", `Ada Profile (@${ada.handle})`],
      ["og:description", "Engines and notes."],
      ["description", "Engines and notes."],
      ["profile:username", ada.handle],
      ["twitter:card", "summary"],
    ]);
    const avatar = await pictured(ada.id);
    const shown = await profileCard(ada.handle);
    expect(keysOf(shown.block)).toEqual(["robots", "og:site_name", "og:type", "og:url", "og:title", "og:description", "description", "og:image", "og:image:type", "og:image:alt", "profile:username", "twitter:card"]);
    expect([value(shown.block, "og:image"), value(shown.block, "og:image:type"), value(shown.block, "og:image:alt")]).toEqual([`${origin()}/api/media/${avatar}/large.webp`, "image/webp", `Profile picture of @${ada.handle}`]);
    const post = await postCard(await newPostRow(apiDb, ada.id, { body: "no image of its own" }));
    expect(value(post.block, "og:image")).toBe(`${origin()}/api/media/${avatar}/large.webp`);
    expect(value(post.block, "og:image:alt")).toBe(`Profile picture of @${ada.handle}`);
    expect(value(post.block, "twitter:card")).toBe("summary");
    // Never a count, the verified mark or a standing.
    await migrateDb.execute(sql`update profiles set verified_at = now(), follower_count = 4321, post_count = 8765 where id = ${ada.id}::uuid`);
    const counted = await profileCard(ada.handle);
    for (const absent of ["4321", "8765", "erified"]) expect(counted.block).not.toContain(absent);
  });

  test("a picture that R1's review withholds is on no card: not on its profile's, not as a post's fallback", async () => {
    const rex = await account("Rex Reviewed", "Under review.");
    await previews(rex.id, true);
    const avatar = await pictured(rex.id);
    const postId = await newPostRow(apiDb, rex.id, { body: "a post without an image" });
    expect(value((await profileCard(rex.handle)).block, "og:image")).toBe(`${origin()}/api/media/${avatar}/large.webp`);
    // As automation-avatar does: a score at the threshold, AUTOMATION_R1_ACTS on, and the program's step waited for.
    await apiDb.execute(sql`update post_media set nsfw_score = ${0.9}::real where id = ${avatar}::uuid`);
    const deps = automationDeps(apiDb, { media: mediaForCases(h.deps) }, { AUTOMATION_R1_ACTS: "on" });
    avatarSet(deps, rex.id, avatar);
    await deps.background.settle();
    const [state] = await apiDb.execute<{ state: string }>(sql`select moderation_state::text as state from post_media where id = ${avatar}::uuid`);
    expect(state!.state).toBe("withheld");
    for (const answer of [await profileCard(rex.handle), await postCard(postId)]) {
      expect(answer.status).toBe(204);
      expect(keysOf(answer.block)).not.toContain("og:image");
      expect(answer.block).not.toContain(avatar);
    }
    expect(value((await profileCard(rex.handle)).block, "og:description")).toBe("Under review.");
  });

  test("a suspended account's visible post and profile keep their cards, with no label", async () => {
    const sam = await account("Sam Later", "Still here.");
    await previews(sam.id, true);
    const postId = await newPostRow(apiDb, sam.id, { body: "written before the suspension" });
    const before = [await postCard(postId), await profileCard(sam.handle)];
    await suspendForTest(apiDb, sam.id);
    const [suspended] = await apiDb.execute<{ on: boolean }>(sql`select (suspended_from is not null and suspended_from <= now()) as on from profiles where id = ${sam.id}::uuid`);
    expect(suspended!.on).toBe(true);
    const after = [await postCard(postId), await profileCard(sam.handle)];
    expect(after.map((answer) => [answer.status, answer.block])).toEqual(before.map((answer) => [answer.status, answer.block]));
    for (const answer of after) expect(answer.block?.toLowerCase()).not.toContain("suspend");
  });

  test("a deleted account: 404 for its profile and for a post of it, whatever the post's row still says; an old handle and an unknown one 404", async () => {
    const gone = await account("Gone Soon", "A bio.");
    await previews(gone.id, true);
    const postId = await newPostRow(apiDb, gone.id, { body: "left visible by a purge in flight" });
    expect((await postCard(postId)).status).toBe(204);
    await migrateDb.execute(sql`update profiles set deleted_at = now() where id = ${gone.id}::uuid`);
    for (const answer of [await postCard(postId), await profileCard(gone.handle)]) expect([answer.status, answer.body, answer.block]).toEqual([404, "", null]);

    const moved = await account("Moved On");
    const renamed = `r_${randomBytes(5).toString("hex")}`;
    await migrateDb.execute(sql`update profiles set handle = ${renamed}, handle_changed_at = now() where id = ${moved.id}::uuid`);
    await migrateDb.execute(sql`insert into handle_history (handle_lower, profile_id, changed_at) values (${moved.handle}, ${moved.id}::uuid, now())`);
    expect((await profileCard(moved.handle)).status).toBe(404);
    expect((await profileCard(renamed)).status).toBe(204);
    expect(value((await profileCard(renamed)).block, "og:url")).toBe(`${origin()}/u/${renamed}`);
    expect((await profileCard(`n_${randomBytes(5).toString("hex")}`)).status).toBe(404);
  });

  test("it reads no session: a cookie and a bearer token change nothing, and the session's resolution is never reached", async () => {
    const ada = await account("Ada Session");
    await previews(ada.id, true);
    const postId = await newPostRow(apiDb, ada.id, { body: "the same for everyone" });
    const carried = { cookie: "korbat_session=abc; __Host-korbat_session=def", authorization: `Bearer ${"a".repeat(43)}` };
    resolved = 0;
    const plain = [await postCard(postId), await profileCard(ada.handle), await postCard(randomUUID())];
    const withSession = [await postCard(postId, carried), await profileCard(ada.handle, carried), await postCard(randomUUID(), carried)];
    expect(withSession.map((answer) => [answer.status, answer.block])).toEqual(plain.map((answer) => [answer.status, answer.block]));
    expect(resolved).toBe(0);
    // The post's own read, beside it, does go through the session's resolution.
    await app.request(`/api/posts/${postId}`, { headers: carried });
    expect(resolved).toBeGreaterThan(0);
  });

  test("the card routes stand behind the global limit, as the status route does", async () => {
    const store = new MemoryStore();
    const logger = pino({ level: "silent" });
    const social = createSocial({ apiDb, rateLimitStore: store, logger, requireSession: async (_c, next) => next(), requireFreshAuth: async (_c, next) => next() });
    const limited = createApp({
      config,
      logger,
      rateLimitStore: store,
      healthChecks: {},
      auth: createAuth({ config, logger, authDb, kv: new MemoryKv(), mailer: new MemoryMailer(), profiles: createProfileStore(apiDb), turnstile: { verify: async () => true }, breachChecker: { isBreached: async () => false } }),
      social,
      cards: createCards({ social: social.forCards, appOrigin: config.APP_ORIGIN }),
    });
    let last = 0;
    for (let n = 0; n < 300; n++) last = (await limited.request(`/api/cards/post/${randomUUID()}`)).status;
    expect(last).toBe(404);
    const [post, profile] = [await limited.request(`/api/cards/post/${randomUUID()}`), await limited.request("/api/cards/profile/nobody_here")];
    expect([post.status, profile.status]).toEqual([429, 429]);
  });
});
