import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { AVATAR_CROPS, AvatarResponse, ErrorEnvelope, FlowResponse, MeResponse, MediaStatusResponse, PostView, ProfilePage, ProfileView, TimelinePage, UploadResponse, mediaPath, type AvatarCrop } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { uploadsLayout } from "@korbat/media-protocol";
import { createApp } from "../../src/app";
import { createAuth } from "../../src/auth";
import { randomToken } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { createMedia, type Media } from "../../src/media";
import { PUBLIC_CACHE } from "../../src/media/flows/serve";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { createSocial, enforceWriteLimit, type Social } from "../../src/social";
import { DAY_MS } from "../../src/social/tiers";
import { Browser } from "./http-client";
import { BYTES, fakeWorker } from "./media-harness";
import { closeDecisions, leavesNoModerationRows } from "./moderation-decide";
import { liftRowForTest, openCase, removeFixtures, suspectItemOn, suspendRowForTest } from "./moderation-fixtures";

type App = ReturnType<typeof createApp>;

// Each test signs accounts up, uploads and sets pictures through the real app: slow on a loaded machine.
vi.setConfig({ testTimeout: 60_000 });

/**
 * 2d Task 3 (design, sections 7.1 to 7.5 and 7.8; section 12.3): avatars through the real app, as http-media.test.ts tests a
 * post's images: 1a sign-up for the accounts, cookie sessions with CSRF, the media and social modules wired as the server
 * wires them, and the stand-in worker on the store directory, which writes an avatar's result as the worker does (version 3
 * with its mark). The upload with kind=avatar and its crop; the set, the replacement and the removal with their outbox rows;
 * the refusals; a suspended account; the public cache; the views that carry an avatar; a replaced and a deleted account's
 * picture shown to nobody; the sweeper and a held former avatar; the pending count, the removal of an upload and a post's
 * images, which never take an avatar. The moderation of an avatar (a reset, a seal, R1's review) is Task 4's.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: avatars over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let migrateDb: Db;
  let app: App;
  let media: Media;
  let social: Social;
  const root = mkdtempSync(path.join(tmpdir(), "korbat-http-avatar-"));
  const uploads = uploadsLayout(path.join(root, "uploads"));
  const worker = fakeWorker(path.join(root, "store"));
  const mailer = new MemoryMailer();
  // Every account is three days old, so it uploads at the established tier.
  const offsetMs = 3 * DAY_MS;
  let tick = 0;
  const now = () => new Date(Date.now() + offsetMs + ++tick);
  /** Every upload of this file, whose outbox rows it removes at its end; and the accounts it removes with removeFixtures. */
  const uploaded: string[] = [];
  const removed: string[] = [];

  beforeAll(async () => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    // A suspension, a case's cleanup and an aged row are the migrator's writes.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
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
    media = createMedia({
      apiDb,
      uploadsDir: uploads.root,
      storeDir: path.join(root, "store"),
      formats: config.MEDIA_FORMATS,
      minFreeBytes: 0,
      logger,
      requireSession: auth.requireSession,
      resolveSession: auth.resolveSession,
      rateLimitStore,
      enforceUploadLimit: (userId, accountCreatedAt, at) => enforceWriteLimit(rateLimitStore, userId, "upload", accountCreatedAt, at),
      now,
    });
    await media.prepare();
    social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth(), media: media.forPosts, now });
    app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, social, media });
  });
  afterAll(async () => {
    rmSync(root, { recursive: true, force: true });
    // The edge's outbox rows of this file's images, which detaching and deleting them wrote; the API's role may delete them.
    if (uploaded.length > 0) await apiDb.execute(sql`delete from public.edge_purges where media_id = any(${`{${uploaded.join(",")}}`}::uuid[])`);
    await closeDecisions();
    await Promise.all([closeDb(authDb), closeDb(apiDb), closeDb(migrateDb)]);
  });

  async function signUp() {
    const b = new Browser(app, config.APP_ORIGIN);
    const email = `avatar-${randomUUID()}@korbat.local`;
    const handle = `a${randomBytes(4).toString("hex")}`;
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    const { flowId } = FlowResponse.parse(await start.json());
    expect((await b.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } })).status).toBe(200);
    expect((await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).status).toBe(200);
    expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: `User ${handle}` } })).status).toBe(200);
    const [row] = await apiDb.execute<{ id: string }>(sql`select id from profiles where handle = ${handle}`);
    return { b, handle, id: row!.id };
  }

  const errorCode = async (res: Response) => ErrorEnvelope.parse(await res.json()).error.code;
  const jpeg = { type: "image/jpeg", body: BYTES.jpeg };
  const view = (id: string) => ({ small: mediaPath(id, "small"), large: mediaPath(id, "large") });
  /** The row's facts this file reads: its kind, the profile it is the avatar of, and its hash. */
  const row = async (id: string) =>
    (await apiDb.execute<{ kind: string; profile_id: string | null; avatar_sha256: string | null }>(sql`select kind::text as kind, profile_id, avatar_sha256 from post_media where id = ${id}::uuid`))[0] ?? null;
  /** The causes of the edge's outbox rows of an image, oldest first. */
  const purges = async (id: string) => (await apiDb.execute<{ cause: string }>(sql`select cause from public.edge_purges where media_id = ${id}::uuid order by id`)).map((r) => r.cause);
  /** What serving a file of the image answers this browser, or a signed-out reader. */
  const served = async (id: string, b?: Browser) => {
    const res = b ? await b.fetch(`/api/media/${id}/large.webp`) : await app.request(`/api/media/${id}/large.webp`);
    return [res.status, res.headers.get("cache-control")];
  };

  /** Sends an avatar's upload with its crop; the answer, and the id when it was taken. */
  async function sendAvatar(b: Browser, crop: AvatarCrop) {
    const res = await b.fetch(`/api/media?kind=avatar&crop=${crop}`, { raw: jpeg });
    const id = res.status === 202 ? UploadResponse.parse(await res.json()).id : null;
    if (id) uploaded.push(id);
    return { res, id };
  }
  /** An avatar's upload that the stand-in worker made into its two squares, ready and not set. */
  async function readyAvatar(b: Browser, crop: AvatarCrop = "centre"): Promise<string> {
    const { res, id } = await sendAvatar(b, crop);
    expect(res.status).toBe(202);
    worker.readyAvatar(id!);
    expect(MediaStatusResponse.parse(await (await b.fetch(`/api/media/${id}`)).json())).toMatchObject({ status: "ready", width: 400, height: 400 });
    return id!;
  }
  /** A post's image, ready. */
  async function readyImage(b: Browser): Promise<string> {
    const res = await b.fetch("/api/media", { raw: jpeg });
    expect(res.status).toBe(202);
    const { id } = UploadResponse.parse(await res.json());
    uploaded.push(id);
    worker.ready(id, { width: 1200, height: 800 });
    expect(MediaStatusResponse.parse(await (await b.fetch(`/api/media/${id}`)).json()).status).toBe("ready");
    return id;
  }
  const setAvatar = (b: Browser, mediaId: string) => b.fetch("/api/me/avatar", { method: "PUT", json: { mediaId } });
  const removeAvatar = (b: Browser) => b.fetch("/api/me/avatar", { method: "DELETE" });

  test("kind=avatar with each crop: its job file is written beside the upload and the file's SHA-256 is kept; a crop alone, an avatar without a crop and an unknown crop are refused before the body is read", async () => {
    const ada = await signUp();
    const sha256 = createHash("sha256").update(BYTES.jpeg).digest("hex");
    for (const crop of AVATAR_CROPS) {
      const { res, id } = await sendAvatar(ada.b, crop);
      expect(res.status, crop).toBe(202);
      expect(JSON.parse(readFileSync(uploads.avatarJob(id!), "utf8")), crop).toEqual({ v: 1, crop });
      expect(existsSync(uploads.upload(id!)), crop).toBe(true);
      expect(await row(id!), crop).toEqual({ kind: "avatar", profile_id: null, avatar_sha256: sha256 });
    }
    for (const query of ["crop=centre", "kind=avatar", "kind=avatar&crop=middle", "kind=post&crop=start", "kind=banner"]) {
      const refused = await ada.b.fetch(`/api/media?${query}`, { raw: jpeg });
      expect([refused.status, await errorCode(refused)], query).toEqual([400, "invalid_request"]);
    }
    // A post's image, with or without kind=post: no job file, no hash.
    for (const query of ["", "?kind=post"]) {
      const res = await ada.b.fetch(`/api/media${query}`, { raw: jpeg });
      const { id } = UploadResponse.parse(await res.json());
      uploaded.push(id);
      expect(existsSync(uploads.avatarJob(id)), query).toBe(false);
      expect(await row(id), query).toEqual({ kind: "post", profile_id: null, avatar_sha256: null });
    }
  });

  test("set, replace and remove: each answers the account's avatar, /api/me and every view carry it, its files are public under the public cache, a replaced one is deleted with its files and shown to nobody, and each detach writes its outbox row", async () => {
    const [ada, bob] = [await signUp(), await signUp()];
    const first = await readyAvatar(ada.b, "start");
    const set = await setAvatar(ada.b, first);
    expect(set.status).toBe(200);
    expect(AvatarResponse.parse(await set.json())).toEqual({ avatar: view(first) });
    expect(await row(first)).toMatchObject({ profile_id: ada.id });
    expect(await purges(first)).toEqual([]);

    // /api/me, the profile (signed out and signed in), a post's author in Latest and on its page, a list of profiles, and
    // Activity's authors: one avatar, the same paths.
    expect(MeResponse.parse(await (await ada.b.fetch("/api/me")).json()).avatar).toEqual(view(first));
    expect(MeResponse.parse(await (await bob.b.fetch("/api/me")).json()).avatar).toBeNull();
    expect(ProfileView.parse(await (await app.request(`/api/profiles/${ada.handle}`)).json()).avatar).toEqual(view(first));
    expect(ProfileView.parse(await (await bob.b.fetch(`/api/profiles/${ada.handle}`)).json()).avatar).toEqual(view(first));
    const post = PostView.parse(await (await ada.b.fetch("/api/posts", { json: { body: "a post under a picture" } })).json());
    expect(post.author.avatar).toEqual(view(first));
    const latest = TimelinePage.parse(await (await app.request("/api/timeline/latest")).json());
    expect(latest.items.find((item) => item.post.id === post.id)?.post.author.avatar).toEqual(view(first));
    const quote = PostView.parse(await (await bob.b.fetch("/api/posts", { json: { body: "a quote", quoteOfId: post.id } })).json());
    expect(quote.author.avatar).toBeNull();
    expect(quote.quoteOf && "author" in quote.quoteOf ? quote.quoteOf.author.avatar : "no embed").toEqual(view(first));
    expect((await bob.b.fetch(`/api/profiles/${ada.handle}/follow`, { method: "POST" })).status).toBe(200);
    const following = ProfilePage.parse(await (await bob.b.fetch(`/api/profiles/${bob.handle}/following`)).json());
    expect(following.items.map((item) => [item.handle, item.avatar])).toEqual([[ada.handle, view(first)]]);
    expect((await social.forActivity.authors([ada.id, bob.id])).get(ada.id)?.avatar).toEqual(view(first));
    expect((await social.forActivity.authors([ada.id, bob.id])).get(bob.id)?.avatar).toBeNull();

    // Both files, to anyone, under the public header; and the 304 under it too.
    for (const size of ["small", "large"] as const) {
      const file = await app.request(view(first)[size]);
      expect([file.status, file.headers.get("content-type"), file.headers.get("cache-control")], size).toEqual([200, "image/webp", PUBLIC_CACHE]);
      const again = await app.request(view(first)[size], { headers: { "if-none-match": file.headers.get("etag") ?? "" } });
      expect([again.status, again.headers.get("cache-control")], size).toEqual([304, PUBLIC_CACHE]);
    }

    // The replacement: the new one is set, the old one detached (its outbox row) and then deleted with its files.
    const second = await readyAvatar(ada.b, "end");
    expect(AvatarResponse.parse(await (await setAvatar(ada.b, second)).json())).toEqual({ avatar: view(second) });
    expect(await purges(first)).toEqual(["state"]);
    expect(await row(first)).toBeNull();
    expect(existsSync(uploads.deletion(first))).toBe(true);
    expect(await served(first)).toEqual([404, "no-store"]);
    expect(await served(first, ada.b)).toEqual([404, "no-store"]);
    expect(MeResponse.parse(await (await ada.b.fetch("/api/me")).json()).avatar).toEqual(view(second));
    // Setting the current one again changes nothing and writes no row.
    expect(AvatarResponse.parse(await (await setAvatar(ada.b, second)).json())).toEqual({ avatar: view(second) });
    expect(await purges(second)).toEqual([]);

    // The removal: no picture, its outbox row, its row and files gone; a second removal answers the same.
    const removedNow = await removeAvatar(ada.b);
    expect([removedNow.status, AvatarResponse.parse(await removedNow.json())]).toEqual([200, { avatar: null }]);
    expect(await purges(second)).toEqual(["state"]);
    expect(await row(second)).toBeNull();
    expect(existsSync(uploads.deletion(second))).toBe(true);
    expect(await served(second, ada.b)).toEqual([404, "no-store"]);
    expect(MeResponse.parse(await (await ada.b.fetch("/api/me")).json()).avatar).toBeNull();
    expect(ProfileView.parse(await (await app.request(`/api/profiles/${ada.handle}`)).json()).avatar).toBeNull();
    expect(AvatarResponse.parse(await (await removeAvatar(ada.b)).json())).toEqual({ avatar: null });
  });

  test("refusals: a post's image is not_an_avatar; an upload processing, failed or refused is avatar_not_ready; another account's upload and a missing one are not_found; a result whose mark does not match the row's kind fails the upload", async () => {
    const [ada, bob] = [await signUp(), await signUp()];
    const image = await readyImage(ada.b);
    const notAvatar = await setAvatar(ada.b, image);
    expect([notAvatar.status, await errorCode(notAvatar)]).toEqual([409, "not_an_avatar"]);

    const processing = (await sendAvatar(ada.b, "centre")).id!;
    const waiting = await setAvatar(ada.b, processing);
    expect([waiting.status, await errorCode(waiting)]).toEqual([409, "avatar_not_ready"]);
    const failed = (await sendAvatar(ada.b, "centre")).id!;
    worker.failed(failed, "corrupt_image");
    expect(MediaStatusResponse.parse(await (await ada.b.fetch(`/api/media/${failed}`)).json()).status).toBe("failed");
    const broken = await setAvatar(ada.b, failed);
    expect([broken.status, await errorCode(broken)]).toEqual([409, "avatar_not_ready"]);
    // A hold for good, which a refused upload's hold is (post_media_refused): the migrator's write, as upload_refusals_hold's.
    const held = await readyAvatar(ada.b);
    await migrateDb.execute(sql`update post_media set hold_until = 'infinity' where id = ${held}::uuid`);
    const refused = await setAvatar(ada.b, held);
    expect([refused.status, await errorCode(refused)]).toEqual([409, "avatar_not_ready"]);
    await migrateDb.execute(sql`update post_media set hold_until = null where id = ${held}::uuid`);

    const bobs = await readyAvatar(bob.b);
    for (const mediaId of [bobs, randomUUID()]) {
      const missing = await setAvatar(ada.b, mediaId);
      expect([missing.status, await errorCode(missing)]).toEqual([404, "not_found"]);
    }
    const invalid = await ada.b.fetch("/api/me/avatar", { method: "PUT", json: { mediaId: "not-an-id" } });
    expect([invalid.status, await errorCode(invalid)]).toEqual([400, "invalid_request"]);
    expect(await row(bobs)).toMatchObject({ profile_id: null });
    expect(MeResponse.parse(await (await ada.b.fetch("/api/me")).json()).avatar).toBeNull();

    // The worker's mark against the row's kind (7.4): an avatar's ready result without it, and a post's with it, fail the
    // upload (processing_failed) rather than store squares as an image or an image as squares.
    const unmarked = (await sendAvatar(ada.b, "centre")).id!;
    worker.ready(unmarked, { width: 400, height: 400 });
    expect(MediaStatusResponse.parse(await (await ada.b.fetch(`/api/media/${unmarked}`)).json())).toEqual({ id: unmarked, status: "failed", error: "processing_failed" });
    const marked = UploadResponse.parse(await (await ada.b.fetch("/api/media", { raw: jpeg })).json()).id;
    uploaded.push(marked);
    worker.readyAvatar(marked);
    expect(MediaStatusResponse.parse(await (await ada.b.fetch(`/api/media/${marked}`)).json())).toEqual({ id: marked, status: "failed", error: "processing_failed" });
  });

  test("3e: while the account's suspension runs, a new avatar and an avatar's upload are refused account_suspended; removing its own stays open", async () => {
    const ada = await signUp();
    const kept = await readyAvatar(ada.b);
    expect((await setAvatar(ada.b, kept)).status).toBe(200);
    const next = await readyAvatar(ada.b);
    await suspendRowForTest(migrateDb, ada.id);
    try {
      const refused = await setAvatar(ada.b, next);
      expect([refused.status, await errorCode(refused)]).toEqual([403, "account_suspended"]);
      expect((await sendAvatar(ada.b, "centre")).res.status).toBe(403);
      expect(MeResponse.parse(await (await ada.b.fetch("/api/me")).json()).avatar).toEqual(view(kept));
      const removal = await removeAvatar(ada.b);
      expect([removal.status, AvatarResponse.parse(await removal.json())]).toEqual([200, { avatar: null }]);
      expect(await row(kept)).toBeNull();
    } finally {
      await liftRowForTest(migrateDb, ada.id);
    }
    expect((await setAvatar(ada.b, next)).status).toBe(200);
  });

  test("an avatar takes no pending slot, is no upload DELETE /api/media/:id removes, and is no image a post can take: the error a missing upload gets, never 500", async () => {
    const ada = await signUp();
    const current = await readyAvatar(ada.b);
    expect((await setAvatar(ada.b, current)).status).toBe(200);
    const spare = await readyAvatar(ada.b);
    // Twenty images of posts waiting, beside the two avatars: the twenty-first is refused, as for an account without one.
    for (let i = 0; i < 20; i++) {
      const res = await ada.b.fetch("/api/media", { raw: jpeg });
      expect(res.status, `upload ${i + 1}`).toBe(202);
      uploaded.push(UploadResponse.parse(await res.json()).id);
    }
    const full = await ada.b.fetch("/api/media", { raw: jpeg });
    expect([full.status, await errorCode(full)]).toEqual([409, "too_many_pending_uploads"]);

    for (const id of [current, spare]) {
      const deleted = await ada.b.fetch(`/api/media/${id}`, { method: "DELETE" });
      expect([deleted.status, await errorCode(deleted)], id).toEqual([404, "not_found"]);
      const posted = await ada.b.fetch("/api/posts", { json: { body: "with my picture", media: [{ id, alt: "my picture" }] } });
      expect([posted.status, await errorCode(posted)], id).toEqual([400, "media_unavailable"]);
    }
    expect(await row(current)).toMatchObject({ profile_id: ada.id });
    expect(await served(current)).toEqual([200, PUBLIC_CACHE]);
  });

  test("the sweeper: an avatar set more than a day ago stays, an upload never set goes after a day, and a former avatar a hold keeps stays until its hold ends and then goes with its files", async () => {
    const ada = await signUp();
    removed.push(ada.id);
    const current = await readyAvatar(ada.b);
    expect((await setAvatar(ada.b, current)).status).toBe(200);
    const unset = await readyAvatar(ada.b);
    // A case's hold on the current picture, ending in a few seconds (media_holds_apply writes the row's hold_until).
    const caseId = await openCase(apiDb, "account", ada.id);
    await apiDb.execute(sql`insert into media_holds (media_id, case_id, until) values (${current}::uuid, ${caseId}::uuid, clock_timestamp() + interval '3 seconds')`);
    const replacement = await readyAvatar(ada.b);
    expect((await setAvatar(ada.b, replacement)).status).toBe(200);
    // The former picture is detached and kept by its hold: no deletion asked for, shown to nobody.
    expect(await row(current)).toMatchObject({ profile_id: null });
    expect(existsSync(uploads.deletion(current))).toBe(false);
    expect(await served(current, ada.b)).toEqual([404, "no-store"]);
    // Every row of the account two days old, as the migrator writes it: the sweeper's day has passed for each.
    await migrateDb.execute(sql`update post_media set created_at = now() - interval '2 days' where owner_id = ${ada.id}::uuid`);
    await media.sweep(new Date(), { reconcile: false });
    expect(await row(replacement)).toMatchObject({ profile_id: ada.id });
    expect(await row(unset)).toBeNull();
    expect(await row(current)).toMatchObject({ profile_id: null });
    await new Promise((resolve) => setTimeout(resolve, 3500));
    await media.sweep(new Date(), { reconcile: false });
    expect(await row(current)).toBeNull();
    expect(existsSync(uploads.deletion(current))).toBe(true);
    expect(await row(replacement)).toMatchObject({ profile_id: ada.id });
    await removeFixtures(migrateDb, removed.splice(0));
  });

  test("the account's purge deletes its avatar in its transaction (outbox: deleted) and nobody is served it from then on; one a frozen account case keeps stays, detached and served to nobody", async () => {
    const [ada, bob] = [await signUp(), await signUp()];
    removed.push(bob.id);
    const adas = await readyAvatar(ada.b);
    expect((await setAvatar(ada.b, adas)).status).toBe(200);
    await social.forAccount.purgeProfile(ada.id, new Date(), async (tx) => void (await media.forAccount.purgeOwner(tx, ada.id)));
    expect(await row(adas)).toBeNull();
    expect(await purges(adas)).toEqual(["deleted"]);
    expect(await served(adas)).toEqual([404, "no-store"]);
    expect(await served(adas, ada.b)).toEqual([404, "no-store"]);

    // Bob's account is under a suspect report: the purge's delete skips his picture (post_media_keep), which is then
    // detached by the purge (state) and shown to nobody, and stays until nothing keeps it.
    const bobs = await readyAvatar(bob.b);
    expect((await setAvatar(bob.b, bobs)).status).toBe(200);
    await suspectItemOn(apiDb, "account", bob.id);
    await social.forAccount.purgeProfile(bob.id, new Date(), async (tx) => void (await media.forAccount.purgeOwner(tx, bob.id)));
    expect(await row(bobs)).toMatchObject({ kind: "avatar", profile_id: null });
    expect(await purges(bobs)).toEqual(["state"]);
    expect(await served(bobs)).toEqual([404, "no-store"]);
    expect(await served(bobs, bob.b)).toEqual([404, "no-store"]);
    await removeFixtures(migrateDb, removed.splice(0));
  });

  leavesNoModerationRows(() => apiDb);
});
