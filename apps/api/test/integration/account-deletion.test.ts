import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { count, eq, sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ORDER_RULES } from "@korbat/contracts";
import { blocks, bookmarks, closeDb, createDb, follows, handleHistory, likes, mutes, posts, profiles, reposts, users, type Db } from "@korbat/db";
import type { AccountDeps } from "../../src/account/context";
import { confirmDeletion, purge, startDeletion } from "../../src/account/flows/deletion";
import { createPurgeJob, purgePending } from "../../src/account/purge";
import { confirmDeletion as authConfirmDeletion, startDeletion as authStartDeletion, takeDownTerminated } from "../../src/auth/flows/deletion";
import { startEmail } from "../../src/auth/flows/email";
import { exportAccount } from "../../src/auth/flows/export";
import { passwordSignIn } from "../../src/auth/flows/password";
import { signIn } from "../../src/auth/flows/signin";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { createImports, importSettingsFrom } from "../../src/imports";
import { MemoryJobLock } from "../../src/lib/jobs";
import { mediaForAccount, mediaForPosts } from "../../src/media";
import { status } from "../../src/media/flows/status";
import { upload } from "../../src/media/flows/upload";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { exportProfile } from "../../src/social/flows/export";
import { createPost, deletePost, getPost, thread } from "../../src/social/flows/posts";
import { profile } from "../../src/social/flows/profiles";
import { latestTimeline } from "../../src/social/flows/timelines";
import { flowHarness, newTestDevice, onboardedUser, type FlowHarness } from "./flow-harness";
import { mediaHarness, type MediaHarness } from "./media-harness";
import { importCounts } from "./imports-harness";
import { suspendRowForTest, untilBlocked } from "./moderation-fixtures";
import { rejection, socialHarness, type SocialHarness } from "./social-harness";

const newHandle = () => `d_${randomBytes(5).toString("hex")}`;
const PASSWORD = "correct horse battery staple";
const page = { limit: 50 };

/**
 * Account deletion across the three modules on real Postgres: the auth repository behind the auth
 * flows, the social repository's purge, the media repository with both volumes in a temporary
 * directory, composed the way the server composes the account module's dependencies from the module
 * indexes. The auth flows read the handle through the real profile store, as the server wires it.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: account deletion", () => {
  let apiDb: Db;
  let authDb: Db;
  /** 3e: profiles.created_at is no longer the API role's to write (migration 0020 grants it the columns it writes), so the migrator ages the profile. */
  let migrateDb: Db;
  let authRepo: AuthRepo;
  let h: FlowHarness;
  let m: MediaHarness;
  let s: SocialHarness;
  /** 3b Task 6: the import tables' rows before the file's first test, which the purges must leave as they found them. */
  let importRows: Record<string, number>;

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 1 });
    authRepo = createAuthRepo(authDb);
    importRows = await importCounts(apiDb);
    h = flowHarness(authRepo, { profiles: createProfileStore(apiDb) });
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

  const deps = (): AccountDeps => ({
    auth: {
      startDeletion: (session, ctx) => authStartDeletion(h.deps, session, ctx),
      confirmDeletion: (session, input) => authConfirmDeletion(h.deps, session, input),
      pendingPurges: () => authRepo.pendingPurges(),
      finishPurge: (userId) => authRepo.finishPurge(userId, new Date()),
      takeDownTerminated: (userId, facts) => takeDownTerminated(h.deps, userId, facts),
      exportAccount: (userId) => exportAccount(h.deps, userId),
      appendEvent: (userId, type, metadata) => authRepo.appendEvent({ userId, type, metadata }),
    },
    social: {
      purgeProfile: (userId, now, within) => s.repo.purgeProfile(userId, now, within),
      exportProfile: (userId) => exportProfile(s.deps, userId),
    },
    // The media module's own interface for this one, over the harness's repository and volumes.
    media: mediaForAccount(m.deps),
    limits: new MemoryStore(),
    log: pino({ level: "silent" }),
    now: () => new Date(),
  });

  /** An auth account with a password, signed in on one device, with a profile of the same id in the public schema, old enough to quote and repost. */
  async function account() {
    const owner = await onboardedUser(h, authRepo, { password: PASSWORD });
    const handle = newHandle();
    const created = await createProfileStore(apiDb).create({ id: owner.user.id, handle, displayName: "Owner" });
    expect(created.ok).toBe(true);
    await migrateDb.update(profiles).set({ createdAt: new Date(Date.now() - 3 * 24 * 60 * 60_000) }).where(eq(profiles.id, owner.user.id));
    return { ...owner, handle };
  }

  const authRow = async (id: string) => (await authDb.select().from(users).where(eq(users.id, id)))[0];
  const profileRow = async (id: string) => (await apiDb.select().from(profiles).where(eq(profiles.id, id)))[0]!;
  const postRow = async (id: string) => (await apiDb.select().from(posts).where(eq(posts.id, id)))[0]!;
  const rowCount = async (table: typeof likes | typeof reposts | typeof bookmarks, userId: string) =>
    (await apiDb.select({ n: count() }).from(table).where(eq(table.userId, userId)))[0]!.n;
  const pairCount = async (table: typeof follows | typeof blocks | typeof mutes, id: string) =>
    (await apiDb.select({ n: count() }).from(table).where(sql`${table.fromId} = ${id}::uuid or ${table.toId} = ${id}::uuid`))[0]!.n;
  const image = (id: string, alt: string) => ({ id, alt });

  test("deleting an account with posts, images, engagement and graph rows leaves tombstones, right counters elsewhere, no image rows, an anonymised profile with its handle reserved, and an anonymised auth row", async () => {
    const owner = await account();
    const userId = owner.user.id;
    // The handle left behind stays reserved, and so does the current one.
    const renamed = newHandle();
    expect((await s.repo.changeHandle(userId, renamed, s.clock.next())).ok).toBe(true);
    const other = await signIn(h.deps, owner.user, owner.device, h.ctx, { alertNewDevice: false, factors: { email: h.clock.ms() }, method: "email" });
    await authRepo.createEmailCode({ flowId: randomBytes(16).toString("hex"), email: owner.email, userId, purpose: "reauth", codeHash: "h", expiresAt: new Date(Date.now() + 600_000), ipHash: "x" });
    await authRepo.setPhoneHash(userId, randomBytes(16).toString("hex"));
    await h.deps.profiles.setVerified(userId, new Date());

    const [bob, carol, dan, eve] = await Promise.all([s.established(), s.established(), s.established(), s.established()]);
    const bobsPost = await createPost(s.deps, bob.id, { body: "bob's post", media: [] });
    const [imageA, imageB] = [await m.readyImage(userId), await m.readyImage(userId)];
    const root = await createPost(s.deps, userId, { body: "two photos", media: [image(imageA, "a harbour at dawn"), image(imageB, "a lighthouse")] });
    const selfReply = await createPost(s.deps, userId, { body: "my own follow-up", replyToId: root.id, media: [] });
    const replyToBob = await createPost(s.deps, userId, { body: "a reply to bob", replyToId: bobsPost.id, media: [] });
    const quoteOfBob = await createPost(s.deps, userId, { body: "quoting bob", quoteOfId: bobsPost.id, media: [] });
    const earlier = await createPost(s.deps, userId, { body: "deleted before the account", media: [] });
    await deletePost(s.deps, userId, earlier.id);
    const earlierDeletedAt = (await postRow(earlier.id)).deletedAt;
    const bobsReply = await createPost(s.deps, bob.id, { body: "bob replies", replyToId: root.id, media: [] });
    // Engagement: the owner's on bob's post goes with the counters; carol's stays, so the counters come down to one, not to zero.
    for (const who of [userId, carol.id]) expect(await s.repo.like(who, bobsPost.id, s.clock.next())).toBe(true);
    expect(await s.repo.repost(userId, bobsPost.id, s.clock.next())).toBe(true);
    expect(await s.repo.bookmark(userId, bobsPost.id, s.clock.next())).toBe(true);
    expect(await s.repo.like(carol.id, root.id, s.clock.next())).toBe(true);
    // The graph: follows both ways with a bystander on each side, a block each way, a mute each way.
    for (const [from, to] of [
      [userId, bob.id],
      [bob.id, userId],
      [carol.id, userId],
      [carol.id, bob.id],
      [bob.id, carol.id],
    ]) {
      expect(await s.repo.follow(from!, to!, s.clock.next())).toBe(true);
    }
    expect(await s.repo.block(userId, dan.id, s.clock.next())).toBe(true);
    expect(await s.repo.block(eve.id, userId, s.clock.next())).toBe(true);
    expect(await s.repo.mute(userId, carol.id, s.clock.next())).toBe(true);
    expect(await s.repo.mute(dan.id, userId, s.clock.next())).toBe(true);
    // Uploads on no post, in every state: they go too, files and all.
    const loose = await m.readyImage(userId);
    const processing = (await upload(m.deps, userId, m.jpeg())).id;
    const failed = (await upload(m.deps, userId, m.jpeg())).id;
    m.worker.failed(failed, "corrupt_image");
    await status(m.deps, userId, failed);
    // The upload still in processing has its file waiting in the uploads volume for the worker.
    expect(existsSync(m.files.uploads.upload(processing))).toBe(true);

    expect(await profileRow(bob.id)).toMatchObject({ followerCount: 2, followingCount: 2, postCount: 1 });
    expect(await profileRow(carol.id)).toMatchObject({ followerCount: 1, followingCount: 2 });
    expect(await postRow(bobsPost.id)).toMatchObject({ likeCount: 2, repostCount: 1, replyCount: 1, quoteCount: 1 });
    expect(await profileRow(userId)).toMatchObject({ followerCount: 2, followingCount: 1, postCount: 2 });

    const { flowId } = await startDeletion(deps(), owner.session, h.ctx);
    const code = h.mailer.lastCodeFor(owner.email)!;
    await confirmDeletion(deps(), owner.session, { flowId, code, handle: renamed.toUpperCase() });

    // The auth row: gone for every lookup, anonymised, both sessions dead and tombstoned, no devices or codes, the event recorded, the notice sent.
    expect(await authRepo.findUserById(userId)).toBeUndefined();
    expect(await authRepo.findUserByEmail(owner.email)).toBeUndefined();
    const anonymised = (await authRow(userId))!;
    expect(anonymised.deletedAt).not.toBeNull();
    expect(anonymised.purgedAt).not.toBeNull();
    expect(anonymised).toMatchObject({
      email: `deleted:${userId}`,
      emailVerifiedAt: null,
      passwordHash: null,
      totpSecretEnc: null,
      totpEnabledAt: null,
      recoveryCodesHash: [],
      phoneHash: null,
      ageConfirmedAt: null,
      termsVersion: null,
      termsAcceptedAt: null,
    });
    for (const id of [owner.session.sessionId, other.issued.session.sessionId]) {
      expect(await authRepo.findActiveSession(id, new Date()), id).toBeUndefined();
      expect(await h.kv.get(`sess:2:${id}`), id).toBe("revoked");
    }
    expect(await authRepo.listDevices(userId)).toEqual([]);
    expect((await authDb.execute(sql`select count(*)::int as n from auth.email_codes where user_id = ${userId}::uuid`)) as unknown as { n: number }[]).toEqual([{ n: 0 }]);
    expect((await authRepo.recentEvents(userId)).map((e) => e.type)).toContain("account_deleted");
    expect(h.mailer.sent.filter((mail) => mail.to === owner.email).map((mail) => mail.template)).toEqual(["delete_account_code", "account_deleted"]);

    // The profile: not found by either handle, anonymised, its handles still reserved for it.
    expect(await s.repo.findProfileByHandle(renamed)).toBeNull();
    expect(await s.repo.findProfileByHandle(owner.handle)).toBeNull();
    expect(await rejection(profile(s.deps, null, renamed))).toBe("not_found");
    expect(await rejection(exportProfile(s.deps, userId))).toBe("not_found");
    const gone = await profileRow(userId);
    // 2d Task 3 (decision 18): the profile has no avatar_path; its picture was an image row, which the purge's within deletes.
    expect(gone).toMatchObject({ handle: renamed, displayName: "Deleted account", bio: "", verifiedAt: null, followerCount: 0, followingCount: 0, postCount: 0 });
    expect(gone).not.toHaveProperty("avatarPath");
    expect(gone.deletedAt).not.toBeNull();
    expect((await apiDb.select({ handle: handleHistory.handleLower }).from(handleHistory).where(eq(handleHistory.profileId, userId))).map((row) => row.handle).sort()).toEqual([owner.handle, renamed].sort());
    expect(await s.repo.changeHandle(bob.id, renamed, s.clock.next())).toEqual({ ok: false, reason: "handle_taken" });
    expect(await s.repo.changeHandle(bob.id, owner.handle, s.clock.next())).toEqual({ ok: false, reason: "handle_taken" });

    // Every post is a tombstone; the one deleted earlier keeps its time; parents and quoted posts count them no more.
    for (const id of [root.id, selfReply.id, replyToBob.id, quoteOfBob.id, earlier.id]) {
      expect(await postRow(id), id).toMatchObject({ state: "deleted_by_author", body: "" });
      expect((await postRow(id)).deletedAt, id).not.toBeNull();
      expect(await rejection(getPost(s.deps, null, id)), id).toBe("not_found");
    }
    expect((await postRow(earlier.id)).deletedAt).toEqual(earlierDeletedAt);
    expect(await postRow(bobsPost.id)).toMatchObject({ likeCount: 1, repostCount: 0, replyCount: 0, quoteCount: 0 });
    expect((await thread(s.deps, null, bobsReply.id, page)).ancestors).toEqual([{ id: root.id, deleted: true }]);
    expect((await latestTimeline(s.deps, null, page)).items.map((item) => item.post.id)).not.toContain(root.id);
    expect(await postRow(bobsReply.id)).toMatchObject({ state: "visible", replyToId: root.id });

    // The owner's engagement and graph rows are gone, in both directions, and the other accounts' counters follow.
    for (const table of [likes, reposts, bookmarks]) expect(await rowCount(table, userId)).toBe(0);
    for (const table of [follows, blocks, mutes]) expect(await pairCount(table, userId)).toBe(0);
    expect(await rowCount(likes, carol.id)).toBe(2);
    expect(await profileRow(bob.id)).toMatchObject({ followerCount: 1, followingCount: 1, postCount: 1 });
    expect(await profileRow(carol.id)).toMatchObject({ followerCount: 1, followingCount: 1 });
    expect((await s.repo.relation(eve.id, userId)).blocked).toBe(false);
    expect((await s.repo.relation(dan.id, userId)).muted).toBe(false);

    // The image rows are gone whatever their state, and the worker is asked for every file.
    for (const id of [imageA, imageB, loose, processing, failed]) expect(await m.deps.repo.find(id), id).toBeNull();
    expect(await m.deps.repo.readyImages(userId)).toEqual([]);
    expect(await m.files.deletionRequests()).toEqual(expect.arrayContaining([imageA, imageB, loose, processing, failed]));
    // On the disk: every id has its request, and the processing upload's file is gone, so no worker picks it up afterwards.
    for (const id of [imageA, imageB, loose, processing, failed]) expect(existsSync(m.files.uploads.deletion(id)), id).toBe(true);
    for (const id of [imageA, imageB, loose, processing, failed]) expect(existsSync(m.files.uploads.upload(id)), id).toBe(false);
    expect(await authRepo.pendingPurges()).not.toContain(userId);

    // A second purge changes nothing: the rows read the same afterwards, and no further file deletion is asked for.
    const before = { auth: await authRow(userId), profile: gone, bob: await profileRow(bob.id), bobsPost: await postRow(bobsPost.id), requests: (await m.files.deletionRequests()).sort() };
    await purge(deps(), userId);
    expect({ auth: await authRow(userId), profile: await profileRow(userId), bob: await profileRow(bob.id), bobsPost: await postRow(bobsPost.id), requests: (await m.files.deletionRequests()).sort() }).toEqual(before);
  });

  test("2d (4.4, 5.6, 6.7): the purge deletes every Activity entry the account caused or received, every mention that names it and those of its own posts, and its seen marker and rules; what others wrote about others stays", async () => {
    const owner = await account();
    const userId = owner.user.id;
    const [bob, carol] = await Promise.all([s.established(), s.established()]);
    // The owner names Bob and Carol and follows Carol; Bob names the owner and Carol, and replies to the owner.
    const ownPost = await createPost(s.deps, userId, { body: `@${bob.handle} and @${carol.handle}`, media: [] });
    expect(await s.repo.follow(userId, carol.id, s.clock.next())).toBe(true);
    const bobsPost = await createPost(s.deps, bob.id, { body: `@${owner.handle} and @${carol.handle}`, media: [] });
    const bobsReply = await createPost(s.deps, bob.id, { body: "a reply", replyToId: ownPost.id, media: [] });
    await apiDb.execute(sql`insert into activity_state (account_id, seen_at, replies) values (${userId}::uuid, now(), 'following')`);
    // In one order whatever the times: the entries one post writes share its transaction's time.
    const key = (row: { recipient: string; actor: string; post: string | null }) => `${row.recipient}:${row.actor}:${row.post ?? ""}`;
    const sorted = (list: { recipient: string; actor: string; post: string | null }[]) => [...list].sort((a, b) => (key(a) < key(b) ? -1 : 1));
    const entries = async () =>
      sorted(
        (await apiDb.execute<{ recipient: string; actor: string; post: string | null }>(
          sql`select recipient_id as recipient, actor_id as actor, post_id as post from activity_items where recipient_id = any(${`{${[userId, bob.id, carol.id].join(",")}}`}::uuid[])`,
        )).map((row) => ({ ...row })),
      );
    const mentioned = async (postId: string) => (await apiDb.execute<{ account: string }>(sql`select account_id as account from post_mentions where post_id = ${postId}::uuid order by position`)).map((row) => row.account);
    expect(await entries()).toEqual(
      sorted([
        { recipient: bob.id, actor: userId, post: ownPost.id },
        { recipient: carol.id, actor: userId, post: ownPost.id },
        { recipient: carol.id, actor: userId, post: null },
        { recipient: userId, actor: bob.id, post: bobsPost.id },
        { recipient: carol.id, actor: bob.id, post: bobsPost.id },
        { recipient: userId, actor: bob.id, post: bobsReply.id },
      ]),
    );
    expect(await mentioned(ownPost.id)).toEqual([bob.id, carol.id]);
    expect(await mentioned(bobsPost.id)).toEqual([userId, carol.id]);

    const { flowId } = await startDeletion(deps(), owner.session, h.ctx);
    await confirmDeletion(deps(), owner.session, { flowId, code: h.mailer.lastCodeFor(owner.email)!, handle: owner.handle });

    expect(await entries()).toEqual([{ recipient: carol.id, actor: bob.id, post: bobsPost.id }]);
    expect(await mentioned(ownPost.id)).toEqual([]);
    expect(await mentioned(bobsPost.id)).toEqual([carol.id]);
    expect(await apiDb.execute(sql`select 1 from activity_state where account_id = ${userId}::uuid`)).toHaveLength(0);
    // Bob's post keeps its text: only the stored mention of the deleted account went.
    expect(await postRow(bobsPost.id)).toMatchObject({ state: "visible", body: `@${owner.handle} and @${carol.handle}` });
  });

  test("3e: a suspended account deletes itself its 1b way, with no hold: the purge takes the rows of its followers and those it follows before any post, writes their counters exactly, and writes no standing into the deleted row", async () => {
    const owner = await account();
    const userId = owner.user.id;
    const [bob, carol] = await Promise.all([s.established(), s.established()]);
    const own = await createPost(s.deps, userId, { body: "posted before the suspension", media: [] });
    expect(await s.repo.follow(bob.id, userId, s.clock.next())).toBe(true);
    expect(await s.repo.follow(userId, carol.id, s.clock.next())).toBe(true);
    await suspendRowForTest(migrateDb, userId);
    // The suspended account cannot post, but it can delete itself (GDPR Art. 17): no hold (3e design, section 2, row 27).
    expect(await rejection(createPost(s.deps, userId, { body: "while suspended", media: [] }))).toBe("account_suspended");
    const { flowId } = await startDeletion(deps(), owner.session, h.ctx);
    await confirmDeletion(deps(), owner.session, { flowId, code: h.mailer.lastCodeFor(owner.email)!, handle: owner.handle });
    expect((await authRow(userId))!.purgedAt).not.toBeNull();
    expect(await profileRow(userId)).toMatchObject({ displayName: "Deleted account", followerCount: 0, followingCount: 0, postCount: 0 });
    expect(await postRow(own.id)).toMatchObject({ state: "deleted_by_author", body: "" });
    expect(await profileRow(bob.id)).toMatchObject({ followingCount: 0 });
    expect(await profileRow(carol.id)).toMatchObject({ followerCount: 0 });
  });

  test("3e: the take-down of a terminated account, as the system: the row marked deleted and its sessions revoked as a confirmation leaves them, the event marked a termination's, termination_final to the address read before it and never account_deleted; a second call changes and mails nothing, and the round's purge finishes it", async () => {
    const owner = await account();
    const userId = owner.user.id;
    const decidedAt = new Date("2026-04-04T09:30:15.250Z");
    expect(await takeDownTerminated(h.deps, userId, { decidedAt, imagesSealed: true })).toBe(true);
    expect((await authRow(userId))!.deletedAt).not.toBeNull();
    expect(await authRepo.findActiveSession(owner.session.sessionId, new Date())).toBeUndefined();
    const mailed = () => h.mailer.sent.filter((mail) => mail.to === owner.email);
    expect(mailed().map((mail) => mail.template)).toEqual(["termination_final"]);
    expect(mailed()[0]!.data).toEqual({ decided: "2026-04-04 09:30 UTC", imagesSealed: "true" });
    const [event] = await migrateDb.execute<{ metadata: Record<string, unknown> }>(sql`select metadata from auth.auth_events where user_id = ${userId}::uuid and type = 'account_deleted'`);
    expect(event?.metadata).toEqual({ terminated: true });
    // Once only: the account is already marked deleted, so nothing is written and nothing mailed.
    expect(await takeDownTerminated(h.deps, userId, { decidedAt, imagesSealed: true })).toBe(false);
    expect(mailed()).toHaveLength(1);
    // The round's purge finds it among the deletions left to finish, as any other.
    expect(await authRepo.pendingPurges()).toContain(userId);
    const report = await purgePending(deps());
    expect(report).toMatchObject({ failed: 0, terminated: 0 });
    expect((await authRow(userId))!.purgedAt).not.toBeNull();
  });

  test("sign-in with a deleted address behaves as for an unknown one before the purge ran, and one round of the job finishes deletions left half done, oldest first", async () => {
    const ghost = await account();
    const later = await account();
    const bob = await s.established();
    const ghostsPost = await createPost(s.deps, ghost.user.id, { body: "left behind", media: [] });
    expect(await s.repo.follow(bob.id, ghost.user.id, s.clock.next())).toBe(true);
    expect(await s.repo.follow(ghost.user.id, bob.id, s.clock.next())).toBe(true);
    // Deleted by hand, as a process that died after the auth step leaves them: no purge has run.
    await authRepo.markDeleted(ghost.user.id, new Date(Date.now() - 120_000));
    await authRepo.markDeleted(later.user.id, new Date(Date.now() - 60_000));

    // The start answers as for an address without an account, and the right password no longer signs in.
    const device = newTestDevice();
    const started = await startEmail(h.deps, { email: ghost.email, turnstileToken: "ok", ...device }, h.ctx);
    expect(Object.keys(started)).toEqual(["flowId"]);
    expect((await authRepo.findEmailCode(started.flowId))?.purpose).toBe("signup");
    expect(h.mailer.sent.filter((mail) => mail.to === ghost.email).map((mail) => mail.template)).toEqual(["sign_up_code"]);
    expect(await rejection(passwordSignIn(h.deps, { email: ghost.email, password: PASSWORD, turnstileToken: "ok", ...device }, h.ctx))).toBe("invalid_credentials");
    expect(await authRepo.findActiveSession(ghost.session.sessionId, new Date())).toBeUndefined();
    // The profile is still there for the moment; the job is what takes it down.
    expect(await s.repo.findProfileByHandle(ghost.handle)).not.toBeNull();

    const pending = await authRepo.pendingPurges();
    expect(pending).toEqual(expect.arrayContaining([ghost.user.id, later.user.id]));
    expect(pending.indexOf(ghost.user.id)).toBeLessThan(pending.indexOf(later.user.id));
    const report = await purgePending(deps());
    expect(report.failed).toBe(0);
    expect(report.purged).toBeGreaterThanOrEqual(2);
    expect(await authRepo.pendingPurges()).toEqual([]);
    for (const user of [ghost, later]) {
      const row = (await authRow(user.user.id))!;
      expect(row.purgedAt, user.handle).not.toBeNull();
      expect(row.email, user.handle).toBe(`deleted:${user.user.id}`);
      expect(await s.repo.findProfileByHandle(user.handle), user.handle).toBeNull();
      expect(await profileRow(user.user.id)).toMatchObject({ displayName: "Deleted account", followerCount: 0, followingCount: 0, postCount: 0 });
    }
    expect(await postRow(ghostsPost.id)).toMatchObject({ state: "deleted_by_author", body: "" });
    expect(await profileRow(bob.id)).toMatchObject({ followerCount: 0, followingCount: 0 });
    // The job as the server runs it: a round under its lock, with nothing left to do.
    expect(await createPurgeJob(deps(), new MemoryJobLock()).round()).toBe("ran");

    // finishPurge twice is once: the second call leaves the row as it was; and it never touches a live account.
    const purged = await authRow(ghost.user.id);
    await authRepo.finishPurge(ghost.user.id, new Date(Date.now() + 1000));
    expect(await authRow(ghost.user.id)).toEqual(purged);
    const alive = await account();
    await authRepo.finishPurge(alive.user.id, new Date());
    expect(await authRow(alive.user.id)).toMatchObject({ email: alive.email, purgedAt: null, deletedAt: null });
    expect(await authRepo.findUserById(alive.user.id)).toBeDefined();
  });

  test("3f: with an address held for a report, the deletion takes everything down at once but the address: the credentials go in the purge's first statement, the address and purged_at wait, the mail gains the hold's paragraph, and the next round after the hold is released overwrites the address", async () => {
    const owner = await account();
    const userId = owner.user.id;
    await authRepo.setPhoneHash(userId, randomBytes(16).toString("hex"));
    // 3f's review (proofs9): two-factor on, so that the check below of the secret and the codes proves their clearing.
    await authRepo.enableTotp(userId, { secretEnc: "v1:held-account", recoveryCodesHash: ["code-a", "code-b"], now: new Date() });
    expect(await authRow(userId)).toMatchObject({ totpSecretEnc: "v1:held-account", recoveryCodesHash: ["code-a", "code-b"] });
    // A seal taken while deciding holds the account's record: its hold, as report_open sets it, written as the migrator.
    await migrateDb.execute(sql`insert into auth.report_holds (user_id, set_at, seal_final) values (${userId}::uuid, now(), false)`);
    try {
      const { flowId } = await startDeletion(deps(), owner.session, h.ctx);
      await confirmDeletion(deps(), owner.session, { flowId, code: h.mailer.lastCodeFor(owner.email)!, handle: owner.handle });
      // Everything but the address went at once: the credentials and personal facts, the profile, the sessions.
      const held = (await authRow(userId))!;
      expect(held).toMatchObject({ email: owner.email, purgedAt: null, passwordHash: null, totpSecretEnc: null, totpEnabledAt: null, phoneHash: null, recoveryCodesHash: [], ageConfirmedAt: null, termsVersion: null, termsAcceptedAt: null });
      expect(held.deletedAt).not.toBeNull();
      expect(await s.repo.findProfileByHandle(owner.handle)).toBeNull();
      // The mail: the one wording for every account, and the paragraph of the seal taken while deciding, with its day.
      const mail = h.mailer.sent.filter((m) => m.to === owner.email && m.template === "account_deleted").at(-1)!;
      const [until] = await migrateDb.execute<{ day: string }>(sql`select to_char(auth.address_held_until(${userId}::uuid) at time zone 'UTC', 'YYYY-MM-DD') as day`);
      expect(mail.data).toEqual({ heldUntil: until!.day, holdFinal: "false" });
      // The account stays pending, last, and each round counts it as held and changes nothing.
      const first = await purgePending(deps());
      expect(first.held).toBeGreaterThanOrEqual(1);
      expect(await authRow(userId)).toMatchObject({ email: owner.email, purgedAt: null });
      const pending = await authRepo.pendingPurges();
      expect(pending.at(-1)).toBe(userId);
      // The record is sent: the hold is released, and the next round overwrites the address.
      await migrateDb.execute(sql`update auth.report_holds set released_at = now(), release_reason = 'sent' where user_id = ${userId}::uuid`);
      await purgePending(deps());
      expect(await authRow(userId)).toMatchObject({ email: `deleted:${userId}`, emailVerifiedAt: null });
      expect((await authRow(userId))!.purgedAt).not.toBeNull();
    } finally {
      await migrateDb.execute(sql`delete from auth.report_holds where user_id = ${userId}::uuid`);
    }
  });

  test("3b Task 6: the purge clears every import column as it tombstones (a disabled post's too), then deletes the account's imports and import key in its transaction, and asks for their files after the commit; a batch waiting at the profile's lock writes nothing", async () => {
    const owner = await account();
    const userId = owner.user.id;
    const root = mkdtempSync(path.join(tmpdir(), "korbat-purge-imports-"));
    // The imports module over volumes of this test's own; the purge reaches only its interface for the account module.
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
    await imports.prepare();
    try {
      const [done, publishing] = [randomUUID(), randomUUID()];
      const choice = JSON.stringify({ from: null, to: null, replies: false, warnings: false, protected: false, images: false, long: "leave" });
      // As the migrator: the account's key, a done import with two posts (one disabled for an order) and one that publishes.
      await migrateDb.execute(sql`insert into import_keys (owner_id, key) values (${userId}::uuid, ${randomBytes(32)}::bytea)`);
      await migrateDb.execute(sql`
        insert into import_jobs (id, owner_id, source, status, declared_bytes, received_bytes, uploaded_at, scanned_at, confirmed_at, ended_at, choice, stated_at, posts_published)
        values (${done}::uuid, ${userId}::uuid, 'mastodon', 'done', 10, 10, now(), now(), now(), now(), ${choice}::jsonb, now(), 2),
               (${publishing}::uuid, ${userId}::uuid, 'x', 'publishing', 10, 10, now(), now(), now(), null, ${choice}::jsonb, now(), 0)`);
      await migrateDb.execute(sql`update import_jobs set seed = ${randomBytes(32)}::bytea where id = ${publishing}::uuid`);
      const [shown, disabled] = [randomUUID(), randomUUID()];
      await migrateDb.execute(sql`
        insert into posts (id, author_id, body, created_at, import_job_id, import_source, original_created_at, import_shortened, import_key)
        values (${shown}::uuid, ${userId}::uuid, 'imported one', now(), ${done}::uuid, 'mastodon', '2019-03-03T12:00:00Z', false, ${randomBytes(32)}::bytea),
               (${disabled}::uuid, ${userId}::uuid, 'imported two', now(), ${done}::uuid, 'mastodon', '2019-03-04T12:00:00Z', true, ${randomBytes(32)}::bytea)`);
      await migrateDb.execute(sql`update posts set state = 'disabled', moderation_level = 'disabled' where id = ${disabled}::uuid`);
      await migrateDb.execute(sql`update profiles set post_count = 2 where id = ${userId}::uuid`);
      await authRepo.markDeleted(userId, new Date());

      // A batch of the publishing import comes while the purge holds the profile's row: it waits there, and then finds the
      // account deleted and its import gone, and writes nothing.
      let waiting: Promise<string | null> | null = null;
      const marker = `waiting batch ${randomUUID()}`;
      const purging: AccountDeps = {
        ...deps(),
        imports: {
          ...imports.forAccount,
          purgeOwner: async (tx, id) => {
            waiting = rejection(
              s.repo.publishImportedBatch(
                { id: publishing, ownerId: userId, source: "x", cursor: 0 },
                { lines: 1, posts: [{ id: randomUUID(), parentId: null, body: marker, originalCreatedAt: "2019-03-05T12:00:00Z", shortened: false, key: randomBytes(32).toString("hex"), images: [] }] },
                new Date(),
                async () => undefined,
              ),
            );
            await untilBlocked(apiDb, "as suspended from profiles where id");
            return imports.forAccount.purgeOwner(tx, id);
          },
        },
      };
      expect(await purge(purging, userId)).toBe("purged");
      expect(await waiting).toBe("not_found");
      // Every post a tombstone with nothing of its source, the disabled one too; no import row and no key is left.
      for (const id of [shown, disabled]) {
        const [row] = await migrateDb.execute<{ state: string; body: string; job: string | null; source: string | null; original: string | null; shortened: boolean | null; key: string | null }>(
          sql`select state::text as state, body, import_job_id as job, import_source::text as source, original_created_at::text as original, import_shortened as shortened, encode(import_key, 'hex') as key
                from posts where id = ${id}::uuid`,
        );
        expect(row, id).toEqual({ state: "deleted_by_author", body: "", job: null, source: null, original: null, shortened: null, key: null });
      }
      const [left] = await migrateDb.execute<{ jobs: number; keys: number; written: number }>(
        sql`select (select count(*)::int from import_jobs where owner_id = ${userId}::uuid) as jobs, (select count(*)::int from import_keys where owner_id = ${userId}::uuid) as keys,
                   (select count(*)::int from posts where body = ${marker}) as written`,
      );
      expect(left).toEqual({ jobs: 0, keys: 0, written: 0 });
      // After the commit, each import's work folder is asked of the importer.
      for (const id of [done, publishing]) expect(existsSync(imports.deps.files.archives.deletion(id)), id).toBe(true);
      // A second purge changes nothing.
      expect(await purge(purging, userId)).toBe("none");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("3f: a hold older than reportHoldDays reads as not held, and REPORT_HOLD off purges a held address at once, as 1b did", async () => {
    const aged = await account();
    const off = await account();
    for (const user of [aged, off]) {
      await migrateDb.execute(sql`insert into auth.report_holds (user_id, set_at, seal_final) values (${user.user.id}::uuid, now(), true)`);
      await authRepo.markDeleted(user.user.id, new Date(Date.now() - 60_000));
    }
    try {
      expect(await authRepo.finishPurge(aged.user.id, new Date())).toBe("held");
      await migrateDb.execute(sql`update auth.report_holds set set_at = set_at - make_interval(days => ${ORDER_RULES.reportHoldDays}, secs => 1) where user_id = ${aged.user.id}::uuid`);
      expect(await authRepo.finishPurge(aged.user.id, new Date())).toBe("purged");
      expect(await authRepo.finishPurge(off.user.id, new Date(), false)).toBe("purged");
      expect(await authRow(off.user.id)).toMatchObject({ email: `deleted:${off.user.id}` });
      expect(await authRepo.finishPurge(off.user.id, new Date())).toBe("none");
    } finally {
      await migrateDb.execute(sql`delete from auth.report_holds where user_id = any(${`{${aged.user.id},${off.user.id}}`}::uuid[])`);
    }
  });

  test("3b Task 6: this file left no import row behind: the purges deleted what they found", async () => {
    expect(await importCounts(apiDb)).toEqual(importRows);
  });
});
