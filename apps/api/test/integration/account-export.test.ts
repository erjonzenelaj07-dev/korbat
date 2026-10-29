import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ACTIVITY_DEFAULTS, ExportFormat } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import type { AccountDeps } from "../../src/account/context";
import { buildExport, exportJson, writeExport } from "../../src/account/flows/export";
import { createActivity } from "../../src/activity";
import { createZipWriter } from "../../src/account/zip";
import { AuthError } from "../../src/auth/context";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { exportAccount } from "../../src/auth/flows/export";
import { signIn } from "../../src/auth/flows/signin";
import { MINUTE } from "../../src/auth/limits";
import { registerOptions, registerVerify } from "../../src/auth/passkeys/flows";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import type { Session } from "../../src/auth/sessions";
import { loadConfig } from "../../src/config";
import { createImports, importSettingsFrom } from "../../src/imports";
import { mediaForAccount, mediaForPosts } from "../../src/media";
import { status } from "../../src/media/flows/status";
import { upload } from "../../src/media/flows/upload";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { SocialError } from "../../src/social/context";
import { exportProfile } from "../../src/social/flows/export";
import { createPost, deletePost } from "../../src/social/flows/posts";
import { setAvatar } from "../../src/social/flows/profile-edit";
import { SoftAuthenticator, type SoftFlags } from "../auth/soft-authenticator";
import { TEST_TERMS, flowHarness, onboardedUser, type FlowHarness } from "./flow-harness";
import { mediaHarness, type MediaHarness } from "./media-harness";
import { importCounts } from "./imports-harness";
import { leavesNoModerationRows } from "./moderation-decide";
import { retireHandleForTest } from "./moderation-fixtures";
import { newPost } from "./social-fixtures";
import { socialHarness, type SocialHarness } from "./social-harness";

const newHandle = () => `x_${randomBytes(5).toString("hex")}`;
const ORIGIN = "http://localhost:8081";
const ALL: SoftFlags = { up: true, uv: true, be: true, bs: true };
const BARE: SoftFlags = { up: true, uv: false, be: false, bs: false };

/** Collects the archive in memory, copying each chunk as the sink of a response would consume it. */
function memorySink() {
  const chunks: Uint8Array[] = [];
  return {
    write: async (chunk: Uint8Array): Promise<void> => {
      chunks.push(Uint8Array.from(chunk));
    },
    bytes: (): Uint8Array => Buffer.concat(chunks),
  };
}

/**
 * The export across the three modules on real Postgres: the auth repository behind the auth flow,
 * the social repository and flows, and the media repository with both volumes in a temporary
 * directory and the stand-in for the worker. Only the account module's dependencies are composed
 * here, the way the server composes them from the module indexes.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the data export of an account", () => {
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  let authRepo: AuthRepo;
  let h: FlowHarness;
  let m: MediaHarness;
  let s: SocialHarness;
  /** 3b Task 6: the import tables' rows before the file's first test. */
  let importRows: Record<string, number>;

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    // 3e: only the migrator can retire a handle, as a decision does.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 1 });
    authRepo = createAuthRepo(authDb);
    importRows = await importCounts(apiDb);
    h = flowHarness(authRepo);
    m = await mediaHarness(apiDb);
    s = socialHarness(apiDb, {
      // 2d Task 3: the media module's interface for posts as createMedia builds it, avatars included.
      media: mediaForPosts(m.deps),
    });
  });
  afterAll(async () => {
    m.cleanup();
    await Promise.all([closeDb(apiDb), closeDb(authDb), closeDb(migrateDb)]);
  });

  // The deletion side of the three interfaces is not exercised by the export; account-deletion.test.ts covers it.
  const notHere = async (): Promise<never> => {
    throw new Error("not exercised by the export");
  };
  const deps = (): AccountDeps => ({
    auth: {
      startDeletion: notHere,
      confirmDeletion: notHere,
      pendingPurges: notHere,
      finishPurge: notHere,
      takeDownTerminated: notHere,
      exportAccount: (userId) => exportAccount(h.deps, userId),
      appendEvent: (userId, type, metadata) => authRepo.appendEvent({ userId, type, metadata }),
    },
    social: { purgeProfile: notHere, exportProfile: (userId, pageSize) => exportProfile(s.deps, userId, pageSize) },
    // The media module's own interface for this one, over the harness's repository and volumes.
    media: { ...mediaForAccount(m.deps), purgeOwner: notHere, requestDeletion: notHere },
    limits: new MemoryStore(),
    log: pino({ level: "silent" }),
    now: () => new Date(),
  });

  const collect = async (pieces: AsyncIterable<string>): Promise<string> => {
    let text = "";
    for await (const piece of pieces) text += piece;
    return text;
  };

  /** An auth account signed in on one device, with a profile of the same id in the public schema. */
  async function account() {
    const owner = await onboardedUser(h, authRepo, { password: "correct horse battery staple" });
    const handle = newHandle();
    const created = await createProfileStore(apiDb).create({ id: owner.user.id, handle, displayName: "Owner" });
    expect(created.ok).toBe(true);
    return { ...owner, handle };
  }

  /** A whole passkey registration through the 1c flow: the options, the software authenticator's answer and the verification; answers the stored view. */
  async function register(session: Session, auth: SoftAuthenticator, name: string | undefined, flags: SoftFlags) {
    const { options } = await registerOptions(h.deps, session, { label: "Owner" });
    const response = auth.create({ rpId: options.rp.id!, challenge: options.challenge, origin: ORIGIN, userHandle: Buffer.from(options.user.id, "base64url"), flags });
    return (await registerVerify(h.deps, session, { name, response })).passkey;
  }

  test("an account with real uploads exports an archive whose images are the store's large.webp byte for byte, and whose JSON holds its rows and its passkeys without their keys", { timeout: 30_000 }, async () => {
    const owner = await account();
    const userId = owner.user.id;
    // A second live session on the same device, and a third one revoked: only the two live ones are listed.
    const second = await signIn(h.deps, owner.user, owner.device, h.ctx, { alertNewDevice: false, factors: { email: h.clock.ms() }, method: "email" });
    const revoked = await signIn(h.deps, owner.user, owner.device, h.ctx, { alertNewDevice: false, factors: { email: h.clock.ms() }, method: "email" });
    await h.deps.sessions.revoke(revoked.issued.session.handle, userId);
    // Two passkeys a minute apart on the harness clock, both from the signed-in device: a synced one, used once since, and a plain one never used.
    const laptopAt = h.clock.now();
    const laptop = await register(owner.session, new SoftAuthenticator(), "Laptop", ALL);
    h.clock.advance(MINUTE);
    const plainAt = h.clock.now();
    await register(owner.session, new SoftAuthenticator(), undefined, BARE);
    const usedAt = new Date();
    expect(await authRepo.claimPasskeyUse(laptop.id, 1, true, usedAt)).toBe(true);
    // The handle left behind is reserved in handle_history; the export lists both.
    const renamed = newHandle();
    expect((await s.repo.changeHandle(userId, renamed, s.clock.next())).ok).toBe(true);

    const [imageA, imageB] = [await m.readyImage(userId, { width: 1600, height: 1200 }), await m.readyImage(userId, { width: 900, height: 1600 })];
    const post = await createPost(s.deps, userId, {
      body: "two photos",
      media: [
        { id: imageA, alt: "a harbour at dawn" },
        { id: imageB, alt: "a lighthouse" },
      ],
    });
    const reply = await createPost(s.deps, userId, { body: "a reply, soon deleted", replyToId: post.id, media: [] });
    await deletePost(s.deps, userId, reply.id);
    // A ready image on no post is still the account's upload; one still processing and one that failed have no file to export.
    const loose = await m.readyImage(userId);
    await upload(m.deps, userId, m.jpeg());
    const failed = (await upload(m.deps, userId, m.jpeg())).id;
    m.worker.failed(failed, "corrupt_image");
    await status(m.deps, userId, failed);

    const [bob, eve, carol] = await Promise.all([s.established(), s.established(), s.established()]);
    const bobsPost = await createPost(s.deps, bob.id, { body: "bob's post", media: [] });
    expect(await s.repo.like(userId, bobsPost.id, s.clock.next())).toBe(true);
    expect(await s.repo.repost(userId, bobsPost.id, s.clock.next())).toBe(true);
    expect(await s.repo.bookmark(userId, bobsPost.id, s.clock.next())).toBe(true);
    expect(await s.repo.follow(userId, bob.id, s.clock.next())).toBe(true);
    expect(await s.repo.block(userId, eve.id, s.clock.next())).toBe(true);
    expect(await s.repo.mute(userId, carol.id, s.clock.next())).toBe(true);
    await authRepo.appendEvent({ userId, type: "profile_updated" });

    const plan = await buildExport(deps(), userId, owner.session.handle, new Date());
    const sink = memorySink();
    await writeExport(createZipWriter(sink.write), plan);
    const files = unzipSync(sink.bytes());
    expect(Object.keys(files).sort()).toEqual(["export.json", `media/${imageA}.webp`, `media/${imageB}.webp`, `media/${loose}.webp`].sort());
    for (const id of [imageA, imageB, loose]) {
      expect(Buffer.compare(Buffer.from(files[`media/${id}.webp`]!), readFileSync(m.files.store.image(id, "large"))), id).toBe(0);
    }
    const text = strFromU8(files["export.json"]!);
    const json = ExportFormat.parse(JSON.parse(text));
    expect(json.missingMedia).toEqual([]);

    expect(json.account).toMatchObject({ id: userId, email: owner.email, role: "user", mfaEnabled: false, hasPassword: true, verified: false, termsVersion: TEST_TERMS });
    expect(json.account.termsAcceptedAt).not.toBeNull();
    // Newest first, the times from the flows' clock and the use as it was written, and the device that added each by its label.
    expect(json.account.passkeys).toEqual([
      { name: "Passkey on the web", createdAt: plainAt.toISOString(), lastUsedAt: null, synced: false, createdOn: "Chrome on Windows" },
      { name: "Laptop", createdAt: laptopAt.toISOString(), lastUsedAt: usedAt.toISOString(), synced: true, createdOn: "Chrome on Windows" },
    ]);
    // In the archive's own text: exactly those five members, and nothing that identifies a key, not the passkey ids, the credential ids or the public keys.
    const raw = JSON.parse(text) as { account: { passkeys: Record<string, unknown>[] } };
    expect(raw.account.passkeys.map((passkey) => Object.keys(passkey))).toEqual(Array.from({ length: 2 }, () => ["name", "createdAt", "lastUsedAt", "synced", "createdOn"]));
    for (const row of await authRepo.listPasskeys(userId)) {
      for (const secret of [row.id, row.credentialId, row.publicKey]) expect(text, secret).not.toContain(secret);
    }
    // The archive's JSON is the document exactly as JSON.stringify writes it, the passkeys in their place inside the account.
    expect(text).toBe(JSON.stringify(raw, null, 2));
    // The live sessions under their handles, the ids the session list shows; the hash of a token, which is what the server
    // looks a session up by, is nowhere in the archive.
    expect(json.sessions.map((session) => session.id).sort()).toEqual([owner.session.handle, second.issued.session.handle].sort());
    expect(json.sessions.find((session) => session.id === owner.session.handle)!.current).toBe(true);
    expect(json.sessions.find((session) => session.id === second.issued.session.handle)!.current).toBe(false);
    for (const hash of [owner.session.sessionId, second.issued.session.sessionId, revoked.issued.session.sessionId]) expect(text, hash).not.toContain(hash);
    expect(json.devices).toHaveLength(1);
    expect(json.devices[0]!.platform).toBe("web");
    // The account's own events, newest first; the sign-ins are among them.
    expect(json.events[0]!.type).toBe("profile_updated");
    expect(json.events.map((event) => event.type)).toContain("signin_success");
    for (let i = 1; i < json.events.length; i++) expect(json.events[i]!.at <= json.events[i - 1]!.at).toBe(true);

    expect(json.profile).toMatchObject({ handle: renamed, displayName: "Owner", bio: "", handleHistory: [owner.handle, renamed] });
    expect(json.posts.map((p) => p.id)).toEqual([post.id, reply.id]);
    expect(json.posts[0]).toMatchObject({
      body: "two photos",
      state: "visible",
      deletedAt: null,
      media: [
        { id: imageA, file: `media/${imageA}.webp`, altText: "a harbour at dawn", width: 1600, height: 1200 },
        { id: imageB, file: `media/${imageB}.webp`, altText: "a lighthouse", width: 900, height: 1600 },
      ],
    });
    expect(json.posts[1]).toMatchObject({ body: "", state: "deleted_by_author", replyToId: post.id, media: [] });
    expect(json.posts[1]!.deletedAt).not.toBeNull();
    expect(json.likes.map((ref) => ref.postId)).toEqual([bobsPost.id]);
    expect(json.reposts.map((ref) => ref.postId)).toEqual([bobsPost.id]);
    expect(json.bookmarks.map((ref) => ref.postId)).toEqual([bobsPost.id]);
    expect(json.following).toEqual([{ handle: bob.handle, since: expect.any(String) }]);
    expect(json.blocks).toEqual([{ handle: eve.handle, since: expect.any(String) }]);
    expect(json.mutes).toEqual([{ handle: carol.handle, since: expect.any(String) }]);
  });

  test("the badge and two-factor are reported as held, an account without passkeys lists none; an unknown account or profile is refused", async () => {
    const owner = await account();
    await authRepo.setPhoneHash(owner.user.id, sha256Hex(randomToken()));
    await authRepo.enableTotp(owner.user.id, { secretEnc: "v1:test", recoveryCodesHash: ["a"], now: new Date() });
    const exported = await exportAccount(h.deps, owner.user.id);
    expect(exported.account).toMatchObject({ verified: true, mfaEnabled: true, hasPassword: true });
    // An account that never registered a passkey exports an empty list, not a missing one.
    expect(exported.passkeys).toEqual([]);

    const unknown = await exportAccount(h.deps, randomUUID()).catch((err: unknown) => err);
    expect(unknown).toBeInstanceOf(AuthError);
    expect((unknown as AuthError).code).toBe("invalid_credentials");
    const nobody = await exportProfile(s.deps, randomUUID()).catch((err: unknown) => err);
    expect(nobody).toBeInstanceOf(SocialError);
    expect((nobody as SocialError).code).toBe("not_found");
    expect(await m.deps.repo.readyImages(randomUUID())).toEqual([]);
  });

  test("export.json read in keyset pages of two is, byte for byte, the document read in pages of a thousand; rows that share a moment are neither lost nor repeated", async () => {
    const owner = await account();
    const userId = owner.user.id;
    const [bob, ...others] = await Promise.all(Array.from({ length: 10 }, () => s.established()));
    const posts: string[] = [];
    for (let i = 0; i < 5; i++) posts.push(await newPost(s.repo, userId, s.clock.next(), `post ${i}`));
    const bobsPosts: string[] = [];
    for (let i = 0; i < 5; i++) bobsPosts.push(await newPost(s.repo, bob!.id, s.clock.next(), `bob ${i}`));
    // Five likes at one moment: within it the post id orders them, and a page may end between two of them.
    const moment = s.clock.next();
    for (const post of bobsPosts) expect(await s.repo.like(userId, post, moment)).toBe(true);
    // Three reposts a microsecond apart inside one millisecond, as a database default writes them: a page key cut to the
    // millisecond would read the same rows again or skip some.
    for (const [i, post] of bobsPosts.slice(0, 3).entries()) {
      await apiDb.execute(sql`insert into reposts (user_id, post_id, created_at) values (${userId}::uuid, ${post}::uuid, ${`2026-01-01T00:00:00.12345${i}Z`}::timestamptz)`);
    }
    for (const post of bobsPosts.slice(0, 4)) expect(await s.repo.bookmark(userId, post, s.clock.next())).toBe(true);
    for (const other of others.slice(0, 5)) expect(await s.repo.follow(userId, other.id, moment)).toBe(true);
    for (const other of others.slice(5, 8)) expect(await s.repo.block(userId, other.id, s.clock.next())).toBe(true);
    for (const other of others.slice(0, 3)) expect(await s.repo.mute(userId, other.id, s.clock.next())).toBe(true);

    const now = new Date();
    const paged = await collect(exportJson(await buildExport(deps(), userId, owner.session.handle, now, 2)));
    const whole = await collect(exportJson(await buildExport(deps(), userId, owner.session.handle, now)));
    expect(paged).toBe(whole);
    expect(paged).toBe(JSON.stringify(JSON.parse(paged), null, 2));
    const json = ExportFormat.parse(JSON.parse(paged));
    expect(json.posts.map((post) => post.id)).toEqual(posts);
    expect(json.likes.map((like) => like.postId)).toEqual([...bobsPosts].sort());
    expect(json.reposts.map((repost) => [repost.postId, repost.at])).toEqual(bobsPosts.slice(0, 3).map((post) => [post, "2026-01-01T00:00:00.123Z"]));
    expect(json.bookmarks.map((bookmark) => bookmark.postId)).toEqual(bobsPosts.slice(0, 4));
    const byId = (list: { id: string; handle: string }[]) => [...list].sort((a, b) => (a.id < b.id ? -1 : 1)).map((profile) => profile.handle);
    expect(json.following.map((ref) => ref.handle)).toEqual(byId(others.slice(0, 5)));
    expect(json.blocks.map((ref) => ref.handle)).toEqual(others.slice(5, 8).map((profile) => profile.handle));
    expect(json.mutes.map((ref) => ref.handle)).toEqual(others.slice(0, 3).map((profile) => profile.handle));
  });

  test("3e: the profile lists the account's own handles that korbat retired, each with when, beside the handle history, which still names them (W.8); a retirement lifted leaves the list", async () => {
    const owner = await account();
    const userId = owner.user.id;
    const { handle, placeholder } = await retireHandleForTest(migrateDb, userId);
    expect(handle).toBe(owner.handle);
    const [{ at }] = (await apiDb.execute<{ at: string }>(sql`select to_char(retired_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at from handle_history where handle_lower = ${handle}`)) as unknown as [{ at: string }];
    const read = async () => ExportFormat.parse(JSON.parse(await collect(exportJson(await buildExport(deps(), userId, owner.session.handle, new Date())))));
    const json = await read();
    expect(json.profile).toMatchObject({ handle: placeholder, handleHistory: [owner.handle, placeholder], retiredHandles: [{ handle: owner.handle, retiredAt: at }] });
    // The member comes after the Explore switch, as the format adds members; 2d's link-preview switch after it.
    // 2d Task 3: the picture, between the retired handles and the preview switch.
    expect(Object.keys(json.profile)).toEqual(["handle", "displayName", "bio", "createdAt", "handleHistory", "showInExplore", "retiredHandles", "avatar", "sharePreviews"]);
    // Lifted, as unretire_handle clears it: the handle is the account's again and the list is empty.
    await migrateDb.execute(sql`update handle_history set retired_at = null where handle_lower = ${handle}`);
    expect((await read()).profile.retiredHandles).toEqual([]);
  });

  test("3b Task 6 (11.2): an imported post carries its source, the archive's date and its mark, a deleted one none; the document ends with the account's imports, newest first, with their choice and counts", async () => {
    const owner = await account();
    const userId = owner.user.id;
    const root = mkdtempSync(path.join(tmpdir(), "korbat-export-imports-"));
    const imports = createImports({
      apiDb,
      archivesDir: path.join(root, "archives"),
      workDir: path.join(root, "work"),
      settings: importSettingsFrom(loadConfig()),
      auth: {} as never,
      social: {} as never,
      media: {} as never,
      moderation: {} as never,
      profiles: {} as never,
      rateLimitStore: new MemoryStore(),
      requireSession: async (_c, next) => next(),
      logger: pino({ level: "silent" }),
    });
    const [done, cancelled] = [randomUUID(), randomUUID()];
    const [kept, deleted] = [randomUUID(), randomUUID()];
    const choice = { from: "2019-01", to: null, replies: true, warnings: false, protected: false, images: false, long: "shorten" };
    try {
      // As the migrator: a published import, confirmed with its choice, and an older one cancelled before any choice.
      await migrateDb.execute(sql`
        insert into import_jobs (id, owner_id, source, status, declared_bytes, received_bytes, created_at, uploaded_at, scanned_at, confirmed_at, ended_at, choice, stated_at, posts_published, posts_removed)
        values (${done}::uuid, ${userId}::uuid, 'mastodon', 'done', 10, 10, now() - interval '1 day', now(), now(), now(), now(), ${JSON.stringify(choice)}::jsonb, now() - interval '1 hour', 2, 0),
               (${cancelled}::uuid, ${userId}::uuid, 'x', 'cancelled', 10, 0, now() - interval '2 days', null, null, null, now() - interval '2 days', null, null, 0, 0)`);
      await migrateDb.execute(sql`
        insert into posts (id, author_id, body, created_at, import_job_id, import_source, original_created_at, import_shortened, import_key)
        values (${kept}::uuid, ${userId}::uuid, 'kept from the archive', now(), ${done}::uuid, 'mastodon', '2019-03-03T12:00:00Z', true, ${randomBytes(32)}::bytea),
               (${deleted}::uuid, ${userId}::uuid, 'deleted later', now(), ${done}::uuid, 'mastodon', '2019-03-04T12:00:00Z', false, ${randomBytes(32)}::bytea)`);
      await migrateDb.execute(sql`update profiles set post_count = 2 where id = ${userId}::uuid`);
      // The author deletes one from its menu: its tombstone keeps nothing of its source.
      await deletePost(s.deps, userId, deleted);
      const text = await collect(exportJson(await buildExport({ ...deps(), imports: imports.forAccount }, userId, owner.session.handle, new Date())));
      const document = ExportFormat.parse(JSON.parse(text));
      // 2d (11.2) moved the pin: the account's Activity follows the imports.
      expect(Object.keys(JSON.parse(text) as object).slice(-2)).toEqual(["imports", "activity"]);
      const byId = new Map(document.posts.map((post) => [post.id, post]));
      expect(byId.get(kept)!.imported).toEqual({ source: "mastodon", originalCreatedAt: "2019-03-03T12:00:00.000Z", shortened: true });
      expect(byId.get(deleted)!).toMatchObject({ state: "deleted_by_author", body: "", imported: null });
      expect(document.imports.map((entry) => [entry.id, entry.status, entry.source])).toEqual([
        [done, "done", "mastodon"],
        [cancelled, "cancelled", "x"],
      ]);
      expect(document.imports[0]).toMatchObject({ choice, counts: { postsPublished: 2, postsRemoved: 0, imagesKept: 0, imagesLeftOut: 0 } });
      expect(document.imports[0]!.statedAt).not.toBeNull();
      expect(document.imports[1]).toMatchObject({ choice: null, statedAt: null });
      // Never a file, an archive's name or a handle: the entries hold the format's members alone.
      expect(Object.keys((JSON.parse(text) as { imports: object[] }).imports[0]!)).toEqual(["id", "source", "status", "createdAt", "endedAt", "statedAt", "choice", "counts"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
      await migrateDb.execute(sql`delete from posts where id in (${kept}::uuid, ${deleted}::uuid)`);
      await migrateDb.execute(sql`delete from import_jobs where id in (${done}::uuid, ${cancelled}::uuid)`);
    }
  });

  test("2d (11.2): the preview switch, each post's mentions as written and its hidden counts, and the account's Activity last: its marker, its rules and every entry it received, newest first and ungrouped, with why the list does not show one", async () => {
    const owner = await account();
    const userId = owner.user.id;
    const [bob, cat, dan, eve, fay, gus] = await Promise.all([s.established(), s.established(), s.established(), s.established(), s.established(), s.established()]);
    const activity = createActivity({ apiDb, social: {} as never, rateLimitStore: new MemoryStore(), requireSession: async (_c, next) => next(), logger: pino({ level: "silent" }) });
    const read = async () => ExportFormat.parse(JSON.parse(await collect(exportJson(await buildExport({ ...deps(), activity: activity.forAccount }, userId, owner.session.handle, new Date(), 2)))));

    // Before anything: previews off, the rules' defaults, no marker and no entry.
    const bare = await read();
    expect(bare.profile.sharePreviews).toBe(false);
    expect(bare.activity).toEqual({ seenAt: null, settings: { ...ACTIVITY_DEFAULTS }, received: [] });

    expect(await s.repo.setSharePreviews(userId, true)).toBe(true);
    // A post that names Bob and Cat, its counts hidden; Cat renames afterwards: the export keeps the handle as written.
    const named = await createPost(s.deps, userId, { body: `thanks @${bob.handle} and @${cat.handle}`, media: [], hideCounts: true });
    const catHandle = cat.handle;
    expect((await s.repo.changeHandle(cat.id, newHandle(), s.clock.next())).ok).toBe(true);
    // What the owner receives: a reply shown; a mention from an account it mutes; a reply withheld since; a follow undone;
    // a mention written while a block was made (5.6's race), hidden only by the block; a reply of an account deleted since.
    const shown = await createPost(s.deps, bob.id, { body: "a reply", replyToId: named.id, media: [] });
    const muted = await createPost(s.deps, cat.id, { body: `hello @${owner.handle}`, media: [] });
    expect(await s.repo.mute(userId, cat.id, s.clock.next())).toBe(true);
    const withheld = await createPost(s.deps, dan.id, { body: "a reply withheld since", replyToId: named.id, media: [] });
    await migrateDb.execute(sql`update posts set state = 'withheld', moderation_level = 'withheld' where id = ${withheld.id}::uuid`);
    expect(await s.repo.follow(eve.id, userId, s.clock.next())).toBe(true);
    expect(await s.repo.unfollow(eve.id, userId)).toBe(true);
    const raced = await createPost(s.deps, fay.id, { body: `hello @${owner.handle}`, media: [] });
    await migrateDb.execute(sql`insert into blocks (blocker_id, blocked_id, created_at) values (${userId}::uuid, ${fay.id}::uuid, now())`);
    const gone = await createPost(s.deps, gus.id, { body: "a reply of an account deleted since", replyToId: named.id, media: [] });
    await migrateDb.execute(sql`update profiles set deleted_at = now() where id = ${gus.id}::uuid`);
    // The marker and the rules, as the activity module writes them.
    const [entry] = await apiDb.execute<{ at: string }>(sql`select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at from activity_items where post_id = ${shown.id}::uuid`);
    await activity.deps.repo.markSeen(userId, entry!.at);
    await activity.deps.repo.saveSettings(userId, { replies: "everyone", mentions: "older", quotes: "off", follows: true });

    const json = await read();
    expect(json.profile.sharePreviews).toBe(true);
    expect(json.posts.find((post) => post.id === named.id)).toMatchObject({ mentions: [bob.handle, catHandle], countsHidden: true });
    expect(json.posts.find((post) => post.id !== named.id)).toBeUndefined();
    expect(json.activity.seenAt).toBe(entry!.at);
    expect(json.activity.settings).toEqual({ replies: "everyone", mentions: "older", quotes: "off", follows: true });
    expect(json.activity.received.map(({ kind, postId, actorHandle, shown: reason }) => ({ kind, postId, actorHandle, shown: reason }))).toEqual([
      { kind: "reply", postId: gone.id, actorHandle: gus.handle, shown: "actor_deleted" },
      { kind: "mention", postId: null, actorHandle: fay.handle, shown: "post_not_visible" },
      { kind: "follow", postId: null, actorHandle: eve.handle, shown: "unfollowed" },
      { kind: "reply", postId: null, actorHandle: dan.handle, shown: "post_not_visible" },
      { kind: "mention", postId: muted.id, actorHandle: (await s.repo.findProfiles([cat.id])).get(cat.id)!.handle, shown: "muted" },
      { kind: "reply", postId: shown.id, actorHandle: bob.handle, shown: true },
    ]);
    // Newest first, to the microsecond; read in pages of two, which the whole document matches byte for byte.
    const times = json.activity.received.map((row) => row.at);
    expect([...times].sort().reverse()).toEqual(times);
    expect(times.every((at) => /[.][0-9]{6}Z$/.test(at))).toBe(true);
    const whole = await collect(exportJson(await buildExport({ ...deps(), activity: activity.forAccount }, userId, owner.session.handle, new Date())));
    expect(JSON.parse(whole).activity).toEqual(JSON.parse(JSON.stringify(json.activity)));
    // Moderation entries are the moderation member's: none is repeated here.
    expect(json.activity.received.every((row) => ["reply", "mention", "quote", "follow"].includes(row.kind))).toBe(true);
    await migrateDb.execute(sql`delete from blocks where blocker_id = ${userId}::uuid and blocked_id = ${fay.id}::uuid`);
  });

  test("2d Task 3 (7.8, 11.2): the profile names the account's picture with its entry, which holds the 400 px square; an avatar's upload never set and a replaced picture are in neither the profile nor the archive", async () => {
    const owner = await account();
    const userId = owner.user.id;
    const archive = async () => {
      const chunks: Uint8Array[] = [];
      await writeExport(createZipWriter(async (chunk) => void chunks.push(Uint8Array.from(chunk))), await buildExport(deps(), userId, owner.session.handle, new Date()));
      const files = unzipSync(Buffer.concat(chunks));
      return { names: Object.keys(files).sort(), json: ExportFormat.parse(JSON.parse(strFromU8(files["export.json"]!))), files };
    };
    expect((await archive()).json.profile.avatar).toBeNull();
    const first = await m.readyAvatar(userId);
    expect((await archive()).names).not.toContain(`media/${first}.webp`);
    await setAvatar(s.deps, userId, first);
    const set = await archive();
    expect(Object.keys(set.json.profile).slice(-3)).toEqual(["retiredHandles", "avatar", "sharePreviews"]);
    expect(set.json.profile.avatar).toEqual({ id: first, file: `media/${first}.webp`, width: 400, height: 400 });
    expect(strFromU8(set.files[`media/${first}.webp`]!)).toBe(readFileSync(m.files.store.image(first, "large"), "utf8"));
    expect(set.json.missingMedia).toEqual([]);
    const second = await m.readyAvatar(userId, "start");
    await setAvatar(s.deps, userId, second);
    const replaced = await archive();
    expect(replaced.json.profile.avatar?.id).toBe(second);
    expect(replaced.names.filter((name) => name.includes(first))).toEqual([]);
    expect(replaced.names).toContain(`media/${second}.webp`);
  });

  test("3b Task 6: this file left no import row behind", async () => {
    expect(await importCounts(apiDb)).toEqual(importRows);
  });

  leavesNoModerationRows(() => apiDb);
});
