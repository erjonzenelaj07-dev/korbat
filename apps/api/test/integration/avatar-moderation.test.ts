import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { AVATAR_RESET_DAYS, AvatarResponse, ErrorEnvelope, FlowResponse, MEDIA_SIZES, MeResponse, MediaStatusResponse, ProfileView, UploadResponse, mediaPath } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { storeLayout, uploadsLayout } from "@korbat/media-protocol";
import { createApp } from "../../src/app";
import { createAuth } from "../../src/auth";
import { randomToken } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { createMedia, quarantineNames, storedImageName, type Media } from "../../src/media";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { ModerationError } from "../../src/moderation";
import { caseImage } from "../../src/moderation/cases";
import { createProfileStore } from "../../src/profiles/store";
import { createSocial, enforceWriteLimit, type Social } from "../../src/social";
import { DAY_MS } from "../../src/social/tiers";
import { webpBytes } from "../media/webp-bytes";
import { Browser } from "./http-client";
import { BYTES, fakeWorker } from "./media-harness";
import { deciderWorld, leavesNoModerationRows, type DeciderWorld, type RealStaff } from "./moderation-decide";
import { act, anAccount, ground, intake, removeFixtures } from "./moderation-fixtures";
import { SEAL_FOR_GOOD, SEAL_WHILE_DECIDING, removeRecords, sealActionOf } from "./records-fixtures";
import { moveForTest, removeReleases, reportForTest } from "./release-fixtures";
import { rolledBack } from "./staff-fixtures";

type App = ReturnType<typeof createApp>;

// Each test signs accounts up, uploads pictures and commits decisions with real keys: slow on a loaded machine.
vi.setConfig({ testTimeout: 120_000 });

/**
 * 2d Task 4 (design, sections 6.5, 7.5, 7.7 and 7.8; section 12.3): the moderation of an avatar, through the real app for
 * the account's own acts (upload, set, remove) and through decisions committed with real keys, as the console takes them.
 * An account's report snapshots its picture and holds it; reset_avatar's compare-and-set, its no_effect and its 30 days;
 * restore_avatar, which writes nothing; a reset and a sealed picture shown to nobody, its owner included; the staff reader
 * of a case's images with the picture, and the placeholder under a freeze; an account seal's lists, its states, the seal
 * that lists nothing, unseal_media; a sealed picture its owner, a replacement and the sweeper cannot delete; the
 * quarantine's list and a release through releases.avatar_ids.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the moderation of avatars", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let migrateDb: Db;
  let app: App;
  let media: Media;
  let social: Social;
  let world: DeciderWorld;
  let mod: RealStaff;
  let admin: RealStaff;
  const root = mkdtempSync(path.join(tmpdir(), "korbat-avatar-moderation-"));
  const uploads = uploadsLayout(path.join(root, "uploads"));
  const store = storeLayout(path.join(root, "store"));
  const worker = fakeWorker(store);
  const mailer = new MemoryMailer();
  // Every account is three days old, so it uploads at the established tier.
  const offsetMs = 3 * DAY_MS;
  let tick = 0;
  const now = () => new Date(Date.now() + offsetMs + ++tick);
  /** Every upload of this file, whose outbox rows it removes at its end. */
  const uploaded: string[] = [];

  beforeAll(async () => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 6 });
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
      storeDir: store.root,
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
    world = deciderWorld(apiDb);
    mod = await world.staff("moderator");
    admin = await world.staff("admin");
  }, 240_000);
  afterAll(async () => {
    rmSync(root, { recursive: true, force: true });
    if (uploaded.length > 0) await apiDb.execute(sql`delete from public.edge_purges where media_id = any(${`{${uploaded.join(",")}}`}::uuid[])`);
    await world.close();
    await Promise.all([closeDb(authDb), closeDb(apiDb), closeDb(migrateDb)]);
  });

  async function signUp() {
    const b = new Browser(app, config.APP_ORIGIN);
    const email = `avatar-mod-${randomUUID()}@korbat.local`;
    const handle = `m${randomBytes(4).toString("hex")}`;
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    const { flowId } = FlowResponse.parse(await start.json());
    expect((await b.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } })).status).toBe(200);
    expect((await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).status).toBe(200);
    expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: `User ${handle}` } })).status).toBe(200);
    const [row] = await apiDb.execute<{ id: string }>(sql`select id from profiles where handle = ${handle}`);
    return { b, handle, id: row!.id };
  }
  type Account = Awaited<ReturnType<typeof signUp>>;

  const errorCode = async (res: Response) => ErrorEnvelope.parse(await res.json()).error.code;
  /** Another JPEG by its first bytes, with other bytes after them: another file, by its SHA-256. */
  const otherJpeg = (word: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`JFIF-${word}`)]);
  const view = (id: string) => ({ small: mediaPath(id, "small"), large: mediaPath(id, "large") });
  /** An avatar's upload of these bytes that the stand-in worker made into its two squares, ready and not set. */
  async function readyAvatar(b: Browser, body: Buffer = BYTES.jpeg): Promise<string> {
    const res = await b.fetch("/api/media?kind=avatar&crop=centre", { raw: { type: "image/jpeg", body } });
    expect(res.status).toBe(202);
    const { id } = UploadResponse.parse(await res.json());
    uploaded.push(id);
    worker.readyAvatar(id);
    expect(MediaStatusResponse.parse(await (await b.fetch(`/api/media/${id}`)).json()).status).toBe("ready");
    return id;
  }
  const setAvatar = (b: Browser, mediaId: string) => b.fetch("/api/me/avatar", { method: "PUT", json: { mediaId } });
  async function pictured(account: Account, body?: Buffer): Promise<string> {
    const id = await readyAvatar(account.b, body);
    expect((await setAvatar(account.b, id)).status).toBe(200);
    return id;
  }
  /** The row's facts this file reads. */
  const row = async (id: string) =>
    (await apiDb.execute<{ profile_id: string | null; state: string; erased: boolean }>(sql`select profile_id, moderation_state::text as state, erased_at is not null as erased from post_media where id = ${id}::uuid`))[0] ?? null;
  const purges = async (id: string) => (await apiDb.execute<{ cause: string }>(sql`select cause from public.edge_purges where media_id = ${id}::uuid order by id`)).map((r) => r.cause);
  /** What serving the large file answers to the owner's browser and to a signed-out reader. */
  const served = async (id: string, owner: Browser) => [(await owner.fetch(`/api/media/${id}/large.webp`)).status, (await app.request(`/api/media/${id}/large.webp`)).status];
  const myAvatar = async (b: Browser) => MeResponse.parse(await (await b.fetch("/api/me")).json()).avatar;
  /** A report under a rule about the account by a new account, into its case; the reporter, for the cleanup. */
  async function reported(target: Account, by: "rule" | "csam" = "rule"): Promise<{ caseId: string; reporter: string | null }> {
    const reporter = by === "rule" ? (await signUp()).id : null;
    const recorded = await intake(apiDb, reporter === null ? ground.csam() : ground.rule(reporter, "R6"), anAccount(target.id, target.handle));
    return { caseId: recorded.items[0]!.caseId!, reporter };
  }
  const decided = (outcome: Awaited<ReturnType<DeciderWorld["decideAs"]>>): string => {
    if (typeof outcome === "string") throw new Error(`the decision was not recorded (${outcome})`);
    return outcome.decisionId;
  };
  /** The code a decision is refused with. */
  const refusedWith = async (attempt: Promise<unknown>) =>
    attempt.then(
      () => "recorded",
      (err: unknown) => (err instanceof ModerationError ? err.code : String(err)),
    );
  const actionsOf = async (decisionId: string) =>
    (await apiDb.execute<{ kind: string; no_effect: string | null }>(sql`select kind::text as kind, no_effect from decision_actions where decision_id = ${decisionId}::uuid order by kind::text`)).map((r) => [r.kind, r.no_effect]);

  test("an account's report snapshots its current picture by reference and holds it; a changed picture is a new snapshot; an account without one keeps media null", async () => {
    const [ada, ben] = [await signUp(), await signUp()];
    const cleanup = [ada.id, ben.id];
    try {
      const first = await pictured(ada);
      const r1 = await reported(ada);
      cleanup.push(r1.reporter!);
      const snapshots = async (caseId: string) =>
        (await apiDb.execute<{ media: unknown }>(sql`select media from evidence_snapshots where case_id = ${caseId}::uuid order by taken_at, id`)).map((r) => r.media);
      expect(await snapshots(r1.caseId)).toEqual([[{ id: first, alt: null, width: 400, height: 400 }]]);
      const holds = async (caseId: string) => (await apiDb.execute<{ media_id: string }>(sql`select media_id from media_holds where case_id = ${caseId}::uuid and released_at is null order by media_id`)).map((r) => r.media_id);
      expect(await holds(r1.caseId)).toEqual([first]);
      // A second report while the picture is the same takes no new snapshot; after a change it does, and holds the new one.
      const again = await reported(ada);
      cleanup.push(again.reporter!);
      expect(again.caseId).toBe(r1.caseId);
      expect(await snapshots(r1.caseId)).toHaveLength(1);
      const second = await pictured(ada, otherJpeg("second"));
      const third = await reported(ada);
      cleanup.push(third.reporter!);
      expect(await snapshots(r1.caseId)).toEqual([[{ id: first, alt: null, width: 400, height: 400 }], [{ id: second, alt: null, width: 400, height: 400 }]]);
      expect(await holds(r1.caseId)).toEqual([first, second].sort());
      // The replaced picture is detached and kept by the case's hold, shown to nobody.
      expect(await row(first)).toMatchObject({ profile_id: null, state: "visible" });
      expect(await served(first, ada.b)).toEqual([404, 404]);
      // An account without a picture: its snapshot's media stays null, as before 2d.
      const r2 = await reported(ben);
      cleanup.push(r2.reporter!);
      expect(await snapshots(r2.caseId)).toEqual([null]);
      expect(await holds(r2.caseId)).toEqual([]);
    } finally {
      await removeFixtures(migrateDb, cleanup);
    }
  });

  test("reset_avatar: a compare-and-set against the snapshot, written once; the picture shown to nobody, its owner included; its hash refused for 30 days, another file accepted at once; restore_avatar puts nothing back", async () => {
    const [ada, ben] = [await signUp(), await signUp()];
    const cleanup = [ada.id, ben.id];
    try {
      const reset = await pictured(ada);
      const { caseId, reporter } = await reported(ada);
      cleanup.push(reporter!);
      // A new picture after the report: the snapshot holds the old one, so the reset changes nothing and is refused.
      const meanwhile = await pictured(ada, otherJpeg("meanwhile"));
      expect(await refusedWith(world.decideAs(mod, caseId, { kind: "interim", ruleId: "R6", actions: [act("reset_avatar")] }))).toBe("profile_changed");
      expect(await row(meanwhile)).toMatchObject({ profile_id: ada.id });
      // The snapshot's picture set again (a new snapshot is taken by the next report, of the same picture as the first's).
      const back = await readyAvatar(ada.b);
      expect((await setAvatar(ada.b, back)).status).toBe(200);
      const fresh = await reported(ada);
      cleanup.push(fresh.reporter!);
      const decision = decided(await world.decideAs(mod, caseId, { kind: "interim", ruleId: "R6", actions: [act("reset_avatar")] }));
      expect(await actionsOf(decision)).toEqual([["reset_avatar", null]]);
      // Detached once, its outbox row written, and shown to nobody; the account shows its monogram.
      expect(await row(back)).toMatchObject({ profile_id: null });
      expect(await purges(back)).toEqual(["state"]);
      expect(await served(back, ada.b)).toEqual([404, 404]);
      expect(await myAvatar(ada.b)).toBeNull();
      expect(ProfileView.parse(await (await app.request(`/api/profiles/${ada.handle}`)).json()).avatar).toBeNull();
      // The reset's hash, the row's SHA-256, kept 30 days from the decision.
      const [kept] = await apiDb.execute<{ sha256: string; account_id: string; days: number }>(sql`
        select r.sha256, r.account_id, round(extract(epoch from (r.until - d.decided_at)) / 86400)::int as days
          from avatar_resets r join decision_actions a on a.id = r.action_id join decisions d on d.id = a.decision_id where d.id = ${decision}::uuid`);
      expect(kept).toEqual({ sha256: createHash("sha256").update(BYTES.jpeg).digest("hex"), account_id: ada.id, days: AVATAR_RESET_DAYS });

      // The same file again, in a new upload: refused while the 30 days run, with the code that says why.
      const same = await readyAvatar(ada.b);
      const refused = await setAvatar(ada.b, same);
      expect([refused.status, await errorCode(refused)]).toEqual([409, "avatar_reset"]);
      expect(await row(same)).toMatchObject({ profile_id: null });
      // Another account may use the same file: the reset is this account's.
      expect((await setAvatar(ben.b, await readyAvatar(ben.b))).status).toBe(200);
      // Another file is accepted at once.
      const other = await readyAvatar(ada.b, otherJpeg("other"));
      expect(AvatarResponse.parse(await (await setAvatar(ada.b, other)).json())).toEqual({ avatar: view(other) });
      // Once the 30 days are over (the migrator moves the end into the past), the same file is accepted.
      await migrateDb.execute(sql`update avatar_resets set until = now() - interval '1 second' where account_id = ${ada.id}::uuid`);
      expect(AvatarResponse.parse(await (await setAvatar(ada.b, same)).json())).toEqual({ avatar: view(same) });

      // restore_avatar, in a correction of the reset: the ledger lifts it and nothing is written back.
      const correction = decided(await world.decideAs(mod, caseId, { kind: "correction", reviewsDecisionId: decision, actions: [act("restore_avatar")] }));
      expect(await actionsOf(correction)).toEqual([["restore_avatar", null]]);
      expect(await row(back)).toMatchObject({ profile_id: null });
      expect(await myAvatar(ada.b)).toEqual(view(same));
      expect((await apiDb.execute(sql`select 1 from measures_in_force where decision_id = ${decision}::uuid`)).length).toBe(0);
    } finally {
      await removeFixtures(migrateDb, cleanup);
    }
  });

  test("reset_avatar's no_effect: already for an account without a picture, deleted for a deleted one", async () => {
    const [ada, ben] = [await signUp(), await signUp()];
    const cleanup = [ada.id, ben.id];
    try {
      const a = await reported(ada);
      cleanup.push(a.reporter!);
      expect(await actionsOf(decided(await world.decideAs(mod, a.caseId, { kind: "interim", ruleId: "R6", actions: [act("reset_avatar")] })))).toEqual([["reset_avatar", "already"]]);
      await pictured(ben);
      const b = await reported(ben);
      cleanup.push(b.reporter!);
      await social.forAccount.purgeProfile(ben.id, new Date(), async (tx) => void (await media.forAccount.purgeOwner(tx, ben.id)));
      expect(await actionsOf(decided(await world.decideAs(mod, b.caseId, { kind: "final", ruleId: "R6", actions: [act("reset_avatar")] })))).toEqual([["reset_avatar", "deleted"]]);
    } finally {
      await removeFixtures(migrateDb, cleanup);
    }
  });

  test("the staff reader of a case's images opens the account's picture its snapshot holds; under a freeze it opens nothing, and the console draws the placeholder", async () => {
    const ada = await signUp();
    const cleanup = [ada.id];
    try {
      const picture = await pictured(ada);
      // The worker's square, as a WebP of the size its row states, which the checked open asks for.
      writeFileSync(store.image(picture, "large"), webpBytes("VP8X", 400, 400));
      const { caseId, reporter } = await reported(ada);
      cleanup.push(reporter!);
      const deps = { apiDb, media: media.forCases };
      const file = await caseImage(deps, mod.session, caseId, picture, "large");
      await file.handle.close();
      // An id the snapshot does not list is refused, as for a post's case.
      expect(await refusedWith(caseImage(deps, mod.session, caseId, randomUUID(), "large"))).toBe("image_refused");
      // A report of child sexual abuse material freezes the account's case: the picture opens for nobody at korbat.
      await reported(ada, "csam");
      expect(await refusedWith(caseImage(deps, mod.session, caseId, picture, "large"))).toBe("image_refused");
    } finally {
      await removeRecords(migrateDb, cleanup);
      await removeFixtures(migrateDb, cleanup);
    }
  });

  test("an account seal lists the current picture and a held former one, sealed for everyone; its owner's removal, a replacement and the sweeper keep the rows and files; a seal that lists nothing is refused; unseal_media shows them again", async () => {
    const [ada, ben] = [await signUp(), await signUp()];
    const cleanup = [ada.id, ben.id];
    try {
      const former = await pictured(ada);
      // A rule report holds the first picture; then she replaces it, and the hold keeps the former row.
      const held = await reported(ada);
      cleanup.push(held.reporter!);
      const current = await pictured(ada, otherJpeg("current"));
      expect(await row(former)).toMatchObject({ profile_id: null });

      const { caseId } = await reported(ada, "csam");
      const seal = decided(await world.decideAs(admin, caseId, SEAL_WHILE_DECIDING));
      const action = await sealActionOf(migrateDb, seal);
      const listed = (await apiDb.execute<{ media_id: string }>(sql`select media_id from seal_avatars where action_id = ${action}::uuid order by media_id`)).map((r) => r.media_id);
      expect(listed).toEqual([former, current].sort());
      expect((await apiDb.execute(sql`select 1 from seal_posts where action_id = ${action}::uuid`)).length).toBe(0);
      for (const id of [former, current]) expect((await row(id))?.state, id).toBe("sealed");
      // The current picture stops being public (its outbox row); the former one was not public, and writes none.
      expect(await purges(current)).toEqual(["state"]);
      expect(await purges(former)).toEqual(["state"]);
      for (const id of [former, current]) expect(await served(id, ada.b), id).toEqual([404, 404]);
      expect(await myAvatar(ada.b)).toBeNull();

      // Her removal detaches the current one; the row and its files stay, as under a replacement and the sweeper.
      expect((await ada.b.fetch("/api/me/avatar", { method: "DELETE" })).status).toBe(200);
      expect(await row(current)).toMatchObject({ profile_id: null, state: "sealed" });
      expect(existsSync(uploads.deletion(current))).toBe(false);
      const replacement = await pictured(ada, otherJpeg("replacement"));
      await migrateDb.execute(sql`update post_media set created_at = now() - interval '2 days' where owner_id = ${ada.id}::uuid`);
      await media.sweep(new Date(), { reconcile: false });
      for (const id of [former, current]) {
        expect(await row(id), id).toMatchObject({ state: "sealed" });
        expect(existsSync(uploads.deletion(id)), id).toBe(false);
      }
      expect(await row(replacement)).toMatchObject({ profile_id: ada.id });
      // The disposal does not take them either.
      expect(await apiDb.transaction((tx) => media.forCases.dropDisposable(tx))).not.toEqual(expect.arrayContaining([current]));

      // An account with no image on a post and no picture: the seal lists nothing and is refused.
      const empty = await reported(ben, "csam");
      expect(await refusedWith(world.decideAs(admin, empty.caseId, SEAL_WHILE_DECIDING))).toBe("invalid_decision");

      // The seal lifted by a correction: both rows visible again (neither is her picture any more).
      decided(await world.decideAs(admin, caseId, { kind: "correction", reviewsDecisionId: seal, actions: [act("unseal_media")] }));
      for (const id of [former, current]) expect((await row(id))?.state, id).toBe("visible");
    } finally {
      await removeRecords(migrateDb, cleanup);
      await removeFixtures(migrateDb, cleanup);
    }
  });

  test("a seal for good: quarantine-list names the sealed picture's two files; a release erases them through releases.avatar_ids, writes the cause released, and the plan destroys them", async () => {
    const ada = await signUp();
    const cleanup = [ada.id];
    let action: string | null = null;
    let picture: string | null = null;
    try {
      picture = await pictured(ada);
      const { caseId } = await reported(ada, "csam");
      action = await sealActionOf(migrateDb, decided(await world.decideAs(admin, caseId, SEAL_FOR_GOOD)));
      const lines = async () => (await quarantineNames(migrateDb)).lines.filter((line) => line.mediaId === picture);
      expect(await lines()).toEqual([{ direction: "in", mediaId: picture, postId: null, files: MEDIA_SIZES.map((size) => storedImageName(picture!, size)) }]);

      const { leaveId } = await reportForTest(migrateDb, action, { leave: { from: "authority" } });
      await moveForTest(migrateDb, [picture]);
      expect(await lines()).toEqual([]);
      await rolledBack(migrateDb, async (tx) => {
        const [released] = await tx.execute<{ id: string }>(sql`select public.seal_release(${action}::uuid, 'leave', ${leaveId}::uuid, ${admin.id}::uuid) as id`);
        const [release] = await tx.execute<{ post_ids: string[]; avatar_ids: string[] }>(sql`select post_ids::text[], avatar_ids::text[] from releases where id = ${released!.id}::uuid`);
        expect(release).toEqual({ post_ids: [], avatar_ids: [picture] });
        const [erased] = await tx.execute<{ erased: boolean }>(sql`select erased_at is not null as erased from post_media where id = ${picture}::uuid`);
        expect(erased!.erased).toBe(true);
        expect((await tx.execute<{ cause: string }>(sql`select cause from edge_purges where media_id = ${picture}::uuid order by id`)).map((r) => r.cause)).toEqual(["state", "released"]);
        const plan = await tx.execute<{ direction: string }>(sql`select direction from public.quarantine_plan() where media_id = ${picture}::uuid`);
        expect(plan.map((r) => r.direction)).toEqual(["destroy"]);
        // A second release of the seal finds nothing left to release.
        const again = await tx
          .transaction((sp) => sp.execute(sql`select public.seal_release(${action}::uuid, 'leave', ${leaveId}::uuid, ${admin.id}::uuid)`))
          .then(
            () => "released",
            (err: unknown) => String((err as { cause?: { message?: string } }).cause?.message ?? (err as Error).message),
          );
        expect(again).toContain("release_not_open");
      });
    } finally {
      if (action !== null && picture !== null) await removeReleases(migrateDb, [], [action], [picture]);
      await removeRecords(migrateDb, cleanup);
      await removeFixtures(migrateDb, cleanup);
    }
  });

  leavesNoModerationRows(() => apiDb);
});
