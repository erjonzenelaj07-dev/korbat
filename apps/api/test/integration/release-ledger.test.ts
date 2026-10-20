import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { RELEASE_BASES, RELEASE_LEAVE_FROM, RELEASE_NOTICE_STATES, RELEASE_POSTS_MAX, RELEASE_RULES, RETENTION, type SealReleasedParams } from "@korbat/contracts";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { createAuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { appendConfirmedAudit } from "../../src/moderation/repo";
import { appendAuditRow } from "../../src/staff";
import { deciderWorld, type DeciderWorld, type RealStaff } from "./moderation-decide";
import { CHANNEL_TABLES, aPost, act, hex64, imagePost, newTestStaff, postFrozen, raised, removeDecided, removeFixtures, report, rowCounts, staffProfile, type TestStaff } from "./moderation-fixtures";
import { orderForTest, removeOrders } from "./orders-fixtures";
import { SEAL_FOR_GOOD, SEAL_WHILE_DECIDING, removeRecords, sealActionOf } from "./records-fixtures";
import { leaveForTest, moveForTest, releaseCounts, removeReleases, reportForTest, sealRecord } from "./release-fixtures";
import { rolledBack } from "./staff-fixtures";

vi.setConfig({ testTimeout: 120_000 });

/** A sealed post of this file: its author, its images, its case, the sealing decision and its seal's ledger row. */
interface Sealed {
  authorId: string;
  postId: string;
  mediaIds: string[];
  caseId: string;
  decisionId: string;
  sealActionId: string;
}

/**
 * The release on the database (3d design, sections 6.2, 6.9, 7.2 and 12.1 rows 16 and 18; LAB D1 as tests on the built
 * code, with 3f's real seal_report): seal_release's refusals in its order (release_not_open, release_not_reported,
 * release_not_quarantined, release_preserved, release_no_leave whatever the authority's answer, release_period_unset,
 * admin_required), the leave that passes it, releases_confirmed at commit (release_mismatch), what a release writes and
 * what it never writes, the end of the freeze through the seal and a new freeze through a new item, the leave's guard and
 * its withdrawal, the three holds on telling, the grants, the closed lists and the mirror of release_rules(). The seals
 * commit with real keys and the records, moves and leaves as the migrator; every release here is made in a transaction
 * that is rolled back, with a made-up confirmation of a placeholder key, its commit check run in a savepoint (`set
 * constraints ... immediate`). The release that commits under a real key is release-flow.test.ts's.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the release on the database (3d Task 2)", () => {
  let world: DeciderWorld;
  let admin: RealStaff;
  let apiDb: Db;
  let migrateDb: Db;
  let authDb: Db;
  let before: Record<string, number>;
  let releasesBefore: Record<string, number>;
  let startedAt: string;
  /** Placeholder keys: an audit row they confirm is only ever written in a transaction that is rolled back. */
  let staffAdmin: TestStaff;
  let otherAdmin: TestStaff;
  let moderator: TestStaff;
  /** Sealed for good, two images: the file's main seal. Sealed while deciding. Sealed for good over a post with an erased image row. */
  let good: Sealed;
  let deciding: Sealed;
  let erasedOne: Sealed;
  const authors: string[] = [];
  const posts: string[] = [];
  const orders: string[] = [];
  const allMedia = () => [...good.mediaIds, ...deciding.mediaIds, ...erasedOne.mediaIds];
  const allSeals = () => [good.sealActionId, deciding.sealActionId, erasedOne.sealActionId];

  /** A post with images, reported on the path for child sexual abuse material, and sealed by the admin's real key. */
  async function sealed(images: number, how: "final" | "deciding", beforeSeal?: (p: { postId: string; mediaIds: string[] }) => Promise<void>): Promise<Sealed> {
    const p = await imagePost(apiDb, images);
    authors.push(p.authorId);
    posts.push(p.postId);
    if (beforeSeal) await beforeSeal(p);
    const { caseId } = await report(apiDb, aPost(p.postId), "csam");
    const outcome = await world.decideAs(admin, caseId, how === "final" ? SEAL_FOR_GOOD : SEAL_WHILE_DECIDING);
    if (typeof outcome === "string") throw new Error(`the seal was not recorded (${outcome})`);
    return { ...p, caseId, decisionId: outcome.decisionId, sealActionId: await sealActionOf(migrateDb, outcome.decisionId) };
  }

  /** The params a console would sign for a release of this seal on this leave: its lowest unreleased posts, the leave and its reference. */
  const params = (seal: Sealed, leaveId: string | null, reference: string | null = "AZ 1/26", basis: SealReleasedParams["basis"] = "leave"): SealReleasedParams => ({
    postIds: [seal.postId],
    basis,
    leaveId,
    theirReference: reference,
  });

  /** How a test's release writes its audit row: confirmed (the default), none, a plain row, another admin's, other params or another target. */
  interface How {
    audit?: "confirmed" | "none" | "plain";
    auditBy?: TestStaff;
    auditParams?: Record<string, unknown>;
    auditTarget?: string;
    /** Run inside the savepoint after the release and its commit check, as the API's role, with the release's id. */
    then?: (tx: DbTx, releaseId: string) => Promise<void>;
  }

  /**
   * One release in a transaction that is rolled back, as the API's role, as the release's route writes it: seal_release
   * with the given basis and leave by `staff`, then the audit row (as `how` says), then releases_confirmed made to run at
   * once. Answers "ok" or the code the database raised.
   */
  async function tryRelease(staff: TestStaff, action: string, p: SealReleasedParams | (Omit<SealReleasedParams, "basis"> & { basis: string }), how: How = {}): Promise<string> {
    let outcome = "ok";
    await rolledBack(apiDb, async (tx) => {
      try {
        await tx.transaction(async (sp) => {
          const [row] = await sp.execute<{ id: string }>(sql`select public.seal_release(${action}::uuid, ${p.basis}, ${p.leaveId}::uuid, ${staff.id}::uuid) as id`);
          const releaseId = row!.id;
          const by = how.auditBy ?? staff;
          const metadata = { params: how.auditParams ?? p, releaseId };
          if (how.audit === "plain") {
            await appendAuditRow(sp, { actorId: by.id, action: "seal_released", targetType: "seal", targetId: how.auditTarget ?? action, requestId: null, metadata });
          } else if (how.audit !== "none") {
            await appendConfirmedAudit(sp, {
              actorId: by.id,
              keyId: by.keyId,
              action: "seal_released",
              targetType: "seal",
              targetId: how.auditTarget ?? action,
              metadata,
              staffSession: randomUUID(),
              actionHash: hex64(),
              stepUp: { authenticatorData: "AAAA", clientDataJSON: "BBBB", signature: "CCCC" },
              requestId: `req-${randomUUID()}`,
              expiresAt: new Date(Date.now() + 10 * 60_000),
            });
          }
          await sp.execute(sql`set constraints public.releases_confirmed immediate`);
          await sp.execute(sql`set constraints public.releases_confirmed deferred`);
          if (how.then) await how.then(sp, releaseId);
        });
      } catch (err) {
        const refused = raised(err);
        outcome = refused?.code === "P0001" ? refused.message : `unexpected: ${refused?.code ?? ""} ${(err as Error).message}`;
      }
    });
    return outcome;
  }

  /** The seal's record, answered and of which answer, as the migrator sets it: notification-answer's write. */
  const answer = (seal: Sealed, word: string | null) =>
    migrateDb.execute(
      word === null
        ? sql`update public.authority_notifications set answer = null, answered_at = null where id = public.seal_record(${seal.sealActionId}::uuid)`
        : sql`update public.authority_notifications set answer = ${word}, answered_at = now() where id = public.seal_record(${seal.sealActionId}::uuid)`,
    );
  /** release_facts as the API's role reads it, times as text. */
  const facts = async (q: Db | DbTx, action: string) => ({ ...(await q.execute<Record<string, unknown>>(sql`select * from public.release_facts(${action}::uuid)`))[0]! });

  beforeAll(async () => {
    // Read in beforeAll: a suite without a database is collected and skipped, and its environment is not loaded then.
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    world = deciderWorld(apiDb);
    before = await rowCounts(apiDb, [...CHANNEL_TABLES]);
    releasesBefore = await releaseCounts(migrateDb);
    startedAt = (await migrateDb.execute<{ now: string }>(sql`select now()::text as now`))[0]!.now;
    admin = await world.staff("admin");
    const repo = createAuthRepo(authDb);
    staffAdmin = await newTestStaff(authDb, migrateDb, repo, "admin");
    otherAdmin = await newTestStaff(authDb, migrateDb, repo, "admin");
    moderator = await newTestStaff(authDb, migrateDb, repo, "moderator");
    for (const member of [staffAdmin, otherAdmin, moderator]) await staffProfile(apiDb, member);
    good = await sealed(2, "final");
    deciding = await sealed(1, "deciding");
    // A post one of whose two image rows is erased before the seal: seal_posts.images counts both rows (0016), and the
    // erased one keeps no file to move.
    erasedOne = await sealed(2, "final", async (p) => {
      await migrateDb.execute(sql`update public.post_media set erased_at = now() where id = ${p.mediaIds[0]!}::uuid`);
    });
  }, 300_000);

  afterAll(async () => {
    await removeReleases(migrateDb, posts, allSeals(), allMedia());
    await removeOrders(migrateDb, orders);
    await removeRecords(migrateDb, [...authors, admin.id]);
    await removeDecided(migrateDb, posts, [admin.id]);
    await removeFixtures(migrateDb, [...authors, staffAdmin.id, otherAdmin.id, moderator.id]);
    await world.close();
    await Promise.all([closeDb(migrateDb), closeDb(authDb), closeDb(apiDb)]);
  });

  test("the grants: no right on release_leaves, a read of the release's other tables, two columns of the notice, and the functions the API's role may call", async () => {
    const [rights] = await migrateDb.execute<Record<string, boolean>>(sql`
      select has_table_privilege('korbat_api', 'public.release_leaves', 'SELECT') as leaves_sel, has_table_privilege('korbat_api', 'public.release_leaves', 'INSERT') as leaves_ins,
             has_table_privilege('korbat_api', 'public.release_leaves', 'UPDATE') as leaves_upd,
             has_table_privilege('korbat_api', 'public.releases', 'SELECT') as releases_sel, has_table_privilege('korbat_api', 'public.releases', 'INSERT') as releases_ins,
             has_column_privilege('korbat_api', 'public.releases', 'author_notice', 'UPDATE') as notice_upd, has_column_privilege('korbat_api', 'public.releases', 'post_ids', 'UPDATE') as posts_upd,
             has_table_privilege('korbat_api', 'public.release_posts', 'SELECT') as marks_sel, has_table_privilege('korbat_api', 'public.release_posts', 'INSERT') as marks_ins,
             has_table_privilege('korbat_api', 'public.release_posts', 'UPDATE') as marks_upd, has_table_privilege('korbat_api', 'public.release_posts', 'DELETE') as marks_del,
             has_table_privilege('korbat_api', 'public.release_notices', 'INSERT') as notices_ins, has_column_privilege('korbat_api', 'public.release_notices', 'objection', 'UPDATE') as objection_upd,
             has_column_privilege('korbat_api', 'public.post_media', 'erased_at', 'UPDATE') as erased_upd,
             has_function_privilege('korbat_api', 'public.release_rules()', 'EXECUTE') as rules,
             has_function_privilege('korbat_api', 'public.release_facts(uuid)', 'EXECUTE') as facts,
             has_function_privilege('korbat_api', 'public.seal_release(uuid, text, uuid, uuid)', 'EXECUTE') as release,
             has_function_privilege('korbat_api', 'public.release_tellable(uuid)', 'EXECUTE') as tellable,
             has_function_privilege('korbat_api', 'public.release_announce(uuid, uuid)', 'EXECUTE') as announce,
             has_function_privilege('korbat_api', 'public.release_replay(uuid, uuid[], text, uuid, text, timestamptz)', 'EXECUTE') as replay,
             has_function_privilege('korbat_api', 'public.seal_record(uuid)', 'EXECUTE') as record,
             has_function_privilege('korbat_api', 'public.release_may_tell(uuid, uuid, uuid[])', 'EXECUTE') as may_tell,
             has_function_privilege('korbat_api', 'public.seal_report(uuid)', 'EXECUTE') as report`);
    expect({ ...rights }).toEqual({
      leaves_sel: false,
      leaves_ins: false,
      leaves_upd: false,
      releases_sel: true,
      releases_ins: false,
      notice_upd: true,
      posts_upd: false,
      marks_sel: true,
      marks_ins: false,
      marks_upd: false,
      marks_del: false,
      notices_ins: false,
      objection_upd: true,
      erased_upd: false,
      rules: true,
      facts: true,
      release: true,
      tellable: true,
      announce: true,
      replay: false,
      record: false,
      may_tell: false,
      report: false,
    });
    // As the API's role: no leave can be read or invented, no mark written, no image row erased.
    const refusedAsApi = async (statement: ReturnType<typeof sql>) => raised(await apiDb.execute(statement).then(() => null, (err: unknown) => err))?.code;
    expect(await refusedAsApi(sql`select count(*) from public.release_leaves`)).toBe("42501");
    expect(await refusedAsApi(sql`insert into public.release_leaves (notification_id, leave_from, reference, received_on, untold) values (gen_random_uuid(), 'court', 'x', current_date, false)`)).toBe("42501");
    expect(await refusedAsApi(sql`insert into public.release_posts (post_id, release_id) values (gen_random_uuid(), gen_random_uuid())`)).toBe("42501");
    expect(await refusedAsApi(sql`update public.post_media set erased_at = now() where id = ${good.mediaIds[0]!}::uuid`)).toBe("42501");
  });

  test("the closed lists are the contracts' and release_rules() is RELEASE_RULES with RELEASE_POSTS_MAX, its backups RETENTION's", async () => {
    const listed = async (table: string, name: string) => {
      const [row] = await migrateDb.execute<{ def: string }>(sql`select pg_get_constraintdef(c.oid) as def from pg_constraint c where c.conrelid = ${`public.${table}`}::regclass and c.conname = ${name}`);
      return [...row!.def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
    };
    expect(await listed("releases", "releases_basis")).toEqual([...RELEASE_BASES]);
    expect(await listed("release_leaves", "release_leaves_from")).toEqual([...RELEASE_LEAVE_FROM]);
    expect(await listed("releases", "releases_notice")).toEqual([...RELEASE_NOTICE_STATES]);
    const [rules] = await apiDb.execute<{ silence_days: number | null; period_notice_days: number; backup_days: number; posts_max: number }>(sql`select * from public.release_rules()`);
    expect({ silenceDays: rules!.silence_days, periodNoticeDays: rules!.period_notice_days, backupDays: rules!.backup_days }).toEqual({ ...RELEASE_RULES });
    expect(rules!.posts_max).toBe(RELEASE_POSTS_MAX);
    expect(rules!.backup_days).toBe(RETENTION.backupDays);
  });

  test("LAB D1: refused on a seal taken while deciding or no seal, before its report, before its files are moved, on a preserved post, and by period while unset", async () => {
    const someLeave = randomUUID();
    expect(await tryRelease(staffAdmin, deciding.sealActionId, { ...params(deciding, someLeave) })).toBe("release_not_open");
    expect(await tryRelease(staffAdmin, randomUUID(), params(good, someLeave))).toBe("release_not_open");
    // A seal's record of a report opens with the seal; until it is sent, nothing is reported.
    expect(await tryRelease(staffAdmin, good.sealActionId, params(good, someLeave))).toBe("release_not_reported");
    await reportForTest(migrateDb, good.sealActionId, { answer: "illegal" });
    expect(await tryRelease(staffAdmin, good.sealActionId, params(good, someLeave))).toBe("release_not_quarantined");
    // One file of two in the quarantine is not enough: every unerased image row of every unreleased post, both files.
    await migrateDb.execute(sql`insert into public.quarantine_files (media_id, file, size, sha256)
                                values (${good.mediaIds[0]!}::uuid, ${`files/${good.mediaIds[0]!.slice(0, 2)}/${good.mediaIds[0]!}/small.webp`}, 10, ${"c".repeat(64)})`);
    expect((await facts(apiDb, good.sealActionId)).quarantined).toBe(false);
    await moveForTest(migrateDb, good.mediaIds);
    expect((await facts(apiDb, good.sealActionId)).quarantined).toBe(true);
    // A post preserved for an order is never released.
    const order = await orderForTest(apiDb, moderator, { posts: [good.postId] });
    orders.push(order.id);
    await migrateDb.execute(sql`update public.legal_order_items set preserve_until = now() + interval '1 day', preserve_ended_at = null where order_id = ${order.id}::uuid`);
    expect((await facts(apiDb, good.sealActionId)).preserved).toBe(true);
    expect(await tryRelease(staffAdmin, good.sealActionId, params(good, someLeave))).toBe("release_preserved");
    await migrateDb.execute(sql`update public.legal_order_items set preserve_until = now() - interval '1 second' where order_id = ${order.id}::uuid`);
    expect((await facts(apiDb, good.sealActionId)).preserved).toBe(false);
    // The ground period answers release_period_unset while silence_days is null, before anything else of the ground.
    expect(await tryRelease(staffAdmin, good.sealActionId, { ...params(good, null, null, "period") })).toBe("release_period_unset");
  });

  test("an assessment releases nothing: without a leave every answer, and none, is release_no_leave, and so are the word answer and another record's leave", async () => {
    for (const word of ["illegal", "not_illegal", "no_assessment", "other", null]) {
      await answer(good, word);
      expect(await tryRelease(staffAdmin, good.sealActionId, params(good, randomUUID())), String(word)).toBe("release_no_leave");
    }
    await answer(good, "illegal");
    expect(await tryRelease(staffAdmin, good.sealActionId, { ...params(good, randomUUID()), basis: "answer" })).toBe("release_no_leave");
    // A leave of another seal's record releases nothing here: a leave releases the seal it was given for.
    await reportForTest(migrateDb, erasedOne.sealActionId, {});
    const otherRecordLeave = await leaveForTest(migrateDb, (await sealRecord(migrateDb, erasedOne.sealActionId))!, { from: "court" });
    expect(await tryRelease(staffAdmin, good.sealActionId, params(good, otherRecordLeave))).toBe("release_no_leave");
    expect((await facts(apiDb, good.sealActionId)).leave_id).toBeNull();
  });

  test("a recorded leave, from an authority or from a court, releases whatever the answer, by an admin alone; at commit the key's row must be this release's", async () => {
    const record = (await sealRecord(migrateDb, good.sealActionId))!;
    const fromAuthority = await leaveForTest(migrateDb, record, { from: "authority", reference: "AZ 1/26" });
    const f = await facts(apiDb, good.sealActionId);
    expect([f.leave_id, f.leave_from, f.leave_reference, f.reported, f.answer, f.quarantined, f.preserved, f.tell_held]).toEqual([fromAuthority, "authority", "AZ 1/26", true, "illegal", true, false, false]);
    for (const word of ["illegal", "not_illegal", null]) {
      await answer(good, word);
      expect(await tryRelease(staffAdmin, good.sealActionId, params(good, fromAuthority)), String(word)).toBe("ok");
    }
    const fromCourt = await leaveForTest(migrateDb, record, { from: "court", reference: "4 O 1/26" });
    expect(await tryRelease(staffAdmin, good.sealActionId, params(good, fromCourt, "4 O 1/26"))).toBe("ok");
    // A moderator, with every fact in place, is refused at the last check of seal_release.
    expect(await tryRelease(moderator, good.sealActionId, params(good, fromAuthority))).toBe("admin_required");
    // At commit: no audit row, a plain one, another admin's, other params, another seal's: release_mismatch, nothing left.
    expect(await tryRelease(staffAdmin, good.sealActionId, params(good, fromAuthority), { audit: "none" })).toBe("release_mismatch");
    expect(await tryRelease(staffAdmin, good.sealActionId, params(good, fromAuthority), { audit: "plain" })).toBe("release_mismatch");
    expect(await tryRelease(staffAdmin, good.sealActionId, params(good, fromAuthority), { auditBy: otherAdmin })).toBe("release_mismatch");
    expect(await tryRelease(staffAdmin, good.sealActionId, params(good, fromAuthority), { auditParams: { ...params(good, fromAuthority), theirReference: "AZ 2/26" } })).toBe("release_mismatch");
    expect(await tryRelease(staffAdmin, good.sealActionId, params(good, fromAuthority), { auditParams: { ...params(good, fromAuthority), postIds: [randomUUID()] } })).toBe("release_mismatch");
    expect(await tryRelease(staffAdmin, good.sealActionId, params(good, fromAuthority), { auditTarget: erasedOne.sealActionId })).toBe("release_mismatch");
    // The reference as the key confirmed it is the leave's as its record holds it: another reference is refused at commit.
    expect(await tryRelease(staffAdmin, good.sealActionId, params(good, fromAuthority, "AZ 9/99"))).toBe("release_mismatch");
    expect(await releaseCounts(migrateDb)).toMatchObject({ "public.releases": releasesBefore["public.releases"], "public.release_posts": releasesBefore["public.release_posts"] });
  });

  test("what a release writes: one row, its marks, the erased image rows, and no decision or ledger row; the post is no longer frozen through the seal, and a new suspect item freezes it again", async () => {
    const [leave] = await migrateDb.execute<{ id: string }>(sql`select id from public.release_leaves where notification_id = public.seal_record(${good.sealActionId}::uuid) and leave_from = 'authority' order by recorded_at limit 1`);
    const counted = async (tx: DbTx) => ({ ...(await tx.execute<{ d: number; a: number }>(sql`select (select count(*)::int from public.decisions) as d, (select count(*)::int from public.decision_actions) as a`))[0]! });
    let ledgerBefore: { d: number; a: number } | null = null;
    await rolledBack(apiDb, async (tx) => {
      ledgerBefore = await counted(tx);
    });
    expect(await postFrozen(apiDb, good.postId)).toBe(true);
    const outcome = await tryRelease(staffAdmin, good.sealActionId, params(good, leave!.id), {
      then: async (tx, releaseId) => {
        const [row] = await tx.execute<Record<string, unknown>>(sql`
          select r.seal_action_id, r.post_ids::text[] as post_ids, r.basis, r.leave_id, r.their_reference, r.released_by, r.replay_of, r.author_notice,
                 r.backups_clear_at - r.released_at >= make_interval(days => 30) as backups_after, r.backups_clear_at - r.released_at < make_interval(days => 31) as backups_within
            from public.releases r where r.id = ${releaseId}::uuid`);
        expect({ ...row }).toEqual({
          seal_action_id: good.sealActionId,
          post_ids: [good.postId],
          basis: "leave",
          leave_id: leave!.id,
          their_reference: "AZ 1/26",
          released_by: staffAdmin.id,
          replay_of: null,
          author_notice: "pending",
          backups_after: true,
          backups_within: true,
        });
        const marks = await tx.execute<{ release_id: string }>(sql`select release_id from public.release_posts where post_id = ${good.postId}::uuid`);
        expect(marks.map((mark) => mark.release_id)).toEqual([releaseId]);
        const images = await tx.execute<{ erased: boolean; state: string }>(sql`select erased_at is not null as erased, moderation_state::text as state from public.post_media where post_id = ${good.postId}::uuid`);
        // The rows are erased; the image's state stays sealed: the seal stays in force as a measure.
        expect(images.map((image) => [image.erased, image.state])).toEqual([
          [true, "sealed"],
          [true, "sealed"],
        ]);
        expect(await counted(tx)).toEqual(ledgerBefore);
        const [inForce] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from public.measures_in_force where id = ${good.sealActionId}::uuid`);
        expect(inForce!.n).toBe(1);
        // Not frozen through the seal any more; a new unanswered suspect item freezes it again through the first arm.
        expect(await postFrozen(tx, good.postId)).toBe(false);
        await report(tx, aPost(good.postId), "csam");
        expect(await postFrozen(tx, good.postId)).toBe(true);
        // The seal's custody: no unerased row, both files of both images left to destroy, and the home's count of them.
        const [custody] = await tx.execute<{ files: number; files_left: number }>(sql`select files, files_left from public.seal_custody(${good.sealActionId}::uuid)`);
        expect({ ...custody }).toEqual({ files: 0, files_left: 4 });
        const [counts] = await tx.execute<{ undestroyed: number }>(sql`select undestroyed from public.quarantine_counts()`);
        expect(counts!.undestroyed).toBeGreaterThanOrEqual(4);
        // A second release of the same seal in the same transaction finds every post released.
        const second = await tx
          .transaction((sp) => sp.execute(sql`select public.seal_release(${good.sealActionId}::uuid, 'leave', ${leave!.id}::uuid, ${staffAdmin.id}::uuid)`))
          .then(() => null, (err: unknown) => raised(err)?.message);
        expect(second).toBe("release_not_open");
      },
    });
    expect(outcome).toBe("ok");
  });

  test("a seal over a post with an erased image row is released: the count is of every row, the move of every unerased row", async () => {
    await moveForTest(migrateDb, erasedOne.mediaIds.slice(1));
    const record = (await sealRecord(migrateDb, erasedOne.sealActionId))!;
    const leaveId = await leaveForTest(migrateDb, record, { from: "court", reference: "7 Js 1/26" });
    const f = await facts(apiDb, erasedOne.sealActionId);
    expect([f.quarantined, f.leave_id]).toEqual([true, leaveId]);
    expect(
      await tryRelease(staffAdmin, erasedOne.sealActionId, params(erasedOne, leaveId, "7 Js 1/26"), {
        then: async (tx) => {
          const [custody] = await tx.execute<{ files_left: number }>(sql`select files_left from public.seal_custody(${erasedOne.sealActionId}::uuid)`);
          expect(custody!.files_left).toBe(2);
        },
      }),
    ).toBe("ok");
  });

  test("the leave's guard: a withdrawal is forced to now and is final, nothing else of a leave changes but an open end of its hold, and a withdrawn leave supports no release", async () => {
    const record = (await sealRecord(migrateDb, good.sealActionId))!;
    const mistaken = await leaveForTest(migrateDb, record, { from: "authority", reference: "WRONG 1", untold: true });
    const asMigrator = (statement: ReturnType<typeof sql>) => migrateDb.transaction((tx) => tx.execute(statement)).then(() => null, (err: unknown) => raised(err)?.message ?? String(err));
    // Nothing but the two changes: the reference, the record, the day and the mark are as recorded.
    expect(await asMigrator(sql`update public.release_leaves set reference = 'RIGHT 1' where id = ${mistaken}::uuid`)).toBe("moderation_column");
    expect(await asMigrator(sql`update public.release_leaves set untold = false where id = ${mistaken}::uuid`)).toBe("moderation_column");
    // The newest leave that stands is the one the case shows.
    expect((await facts(apiDb, good.sealActionId)).leave_id).toBe(mistaken);
    // An open end is ended once; then it stays.
    expect(await asMigrator(sql`update public.release_leaves set untold_until = now() - interval '1 minute' where id = ${mistaken}::uuid`)).toBeNull();
    expect(await asMigrator(sql`update public.release_leaves set untold_until = now() + interval '1 day' where id = ${mistaken}::uuid`)).toBe("moderation_column");
    // The withdrawal: the time is the database's, whatever was supplied, and nothing of a withdrawn leave changes after it.
    expect(await asMigrator(sql`update public.release_leaves set withdrawn_by = 'the operator', withdrawn_at = '2001-01-01T00:00:00Z' where id = ${mistaken}::uuid`)).toBeNull();
    const [withdrawn] = await migrateDb.execute<{ recent: boolean }>(sql`select withdrawn_at > now() - interval '1 minute' as recent from public.release_leaves where id = ${mistaken}::uuid`);
    expect(withdrawn!.recent).toBe(true);
    expect(await asMigrator(sql`update public.release_leaves set withdrawn_by = 'someone else' where id = ${mistaken}::uuid`)).toBe("moderation_column");
    // It is in no answer and supports no release, as one never recorded.
    expect((await facts(apiDb, good.sealActionId)).leave_id).not.toBe(mistaken);
    expect(await tryRelease(staffAdmin, good.sealActionId, params(good, mistaken, "WRONG 1"))).toBe("release_no_leave");
    // A leave a release rests on cannot be withdrawn: the guard reads the release after the row's lock (leave_used).
    const used = await leaveForTest(migrateDb, record, { from: "court", reference: "USED 1" });
    await rolledBack(migrateDb, async (tx) => {
      await tx.execute(sql`insert into public.releases (seal_action_id, post_ids, basis, leave_id, their_reference, released_by, released_at, backups_clear_at, author_notice)
                           values (${good.sealActionId}::uuid, array[${good.postId}::uuid], 'leave', ${used}::uuid, 'USED 1', ${staffAdmin.id}::uuid, now(), now(), 'none')`);
      const refused = await tx
        .transaction((sp) => sp.execute(sql`update public.release_leaves set withdrawn_by = 'the operator' where id = ${used}::uuid`))
        .then(() => null, (err: unknown) => raised(err)?.message);
      expect(refused).toBe("leave_used");
    });
  });

  test("the three holds on telling: the leave's own mark, the record's mark not to the person, and an untold decision about a post; each holds the notice", async () => {
    const record = (await sealRecord(migrateDb, good.sealActionId))!;
    const untold = await leaveForTest(migrateDb, record, { from: "authority", reference: "HOLD 1", untold: true });
    expect((await facts(apiDb, good.sealActionId)).tell_held).toBe(true);
    const bornAs = async (leaveId: string, reference: string): Promise<string | null> => {
      let state: string | null = null;
      const outcome = await tryRelease(staffAdmin, good.sealActionId, params(good, leaveId, reference), {
        then: async (tx, releaseId) => {
          const [row] = await tx.execute<{ notice: string; tellable: boolean }>(sql`select author_notice as notice, public.release_tellable(id) as tellable from public.releases where id = ${releaseId}::uuid`);
          state = `${row!.notice} ${row!.tellable}`;
          if (row!.notice !== "held") return;
          // The API's role cannot move a held notice while the hold stands, nor to anything but pending.
          for (const to of ["pending", "sent"]) {
            const moved = await tx
              .transaction((sp) => sp.execute(sql`update public.releases set author_notice = ${to} where id = ${releaseId}::uuid`))
              .then(() => null, (err: unknown) => raised(err)?.message);
            expect(moved, to).toBe("moderation_column");
          }
        },
      });
      expect(outcome).toBe("ok");
      return state;
    };
    expect(await bornAs(untold, "HOLD 1")).toBe("held false");
    // Its end ahead holds it too; an end that passed does not.
    await migrateDb.execute(sql`update public.release_leaves set untold_until = now() + interval '1 hour' where id = ${untold}::uuid`);
    expect(await bornAs(untold, "HOLD 1")).toBe("held false");
    const ended = await leaveForTest(migrateDb, record, { from: "authority", reference: "HOLD 2", untold: true, untoldUntil: new Date(Date.now() - 60_000).toISOString() });
    expect((await facts(apiDb, good.sealActionId)).tell_held).toBe(false);
    expect(await bornAs(ended, "HOLD 2")).toBe("pending true");
    // The record's mark not to the person, with an open end: the notice is held whatever the leave says.
    const [event] = await migrateDb.execute<{ id: string }>(sql`
      insert into public.authority_notification_events (notification_id, kind, at, how, not_to_person, not_to_person_until)
      values (${record}::uuid, 'request', now(), 'by letter', true, null) returning id`);
    expect((await facts(apiDb, good.sealActionId)).tell_held).toBe(true);
    expect(await bornAs(ended, "HOLD 2")).toBe("held false");
    await migrateDb.execute(sql`delete from public.authority_notification_events where id = ${event!.id}::uuid`);
    expect((await facts(apiDb, good.sealActionId)).tell_held).toBe(false);
    // An untold decision about a post of the release (3f's hold: informed_at null), as the migrator sees it.
    await rolledBack(migrateDb, async (tx) => {
      await tx.execute(sql`update public.decisions set informed_at = null, author_mail = 'none' where id = ${good.decisionId}::uuid`);
      const [f] = await tx.execute<{ tell_held: boolean }>(sql`select tell_held from public.release_facts(${good.sealActionId}::uuid)`);
      expect(f!.tell_held).toBe(true);
    });
  });

  test("destruction is proved: after a release the plan lists its files under destroy, also once the disposal dropped the image rows; the record takes the release's id; release_undestroyed alerts daily", async () => {
    const [leave] = await migrateDb.execute<{ id: string }>(sql`select id from public.release_leaves where notification_id = public.seal_record(${erasedOne.sealActionId}::uuid) limit 1`);
    // As the migrator, who owns seal_release, in a transaction that is rolled back: the commit check would hold the
    // release to an admin's confirmed audit row, which this transaction never meets.
    await rolledBack(migrateDb, async (tx) => {
      const [released] = await tx.execute<{ id: string }>(sql`select public.seal_release(${erasedOne.sealActionId}::uuid, 'leave', ${leave!.id}::uuid, ${staffAdmin.id}::uuid) as id`);
      const plan = async () =>
        (await tx.execute<{ direction: string; media_id: string }>(sql`select direction, media_id from public.quarantine_plan() where media_id = any(${`{${erasedOne.mediaIds.join(",")}}`}::uuid[])`)).map(
          (row) => `${row.direction} ${row.media_id}`,
        );
      // The moved image's files are to destroy; the image erased before the seal had no file moved and has nothing listed.
      expect(await plan()).toEqual([`destroy ${erasedOne.mediaIds[1]!}`]);
      // The disposal drops the erased rows of a post nothing freezes: the files stay listed, by their post's mark.
      await tx.execute(sql`update public.post_media set hold_until = null where post_id = ${erasedOne.postId}::uuid`);
      await tx.execute(sql`delete from public.post_media where post_id = ${erasedOne.postId}::uuid`);
      expect(await plan()).toEqual([`destroy ${erasedOne.mediaIds[1]!}`]);
      const [counts] = await tx.execute<{ undestroyed: number }>(sql`select undestroyed from public.quarantine_counts()`);
      expect(counts!.undestroyed).toBeGreaterThanOrEqual(2);
      // A day after the release, still recorded in the quarantine: release_undestroyed, once a day, files counted.
      await tx.execute(sql`delete from public.alert_outbox where kind = 'release_undestroyed'`);
      await tx.execute(sql`update public.releases set released_at = released_at - interval '25 hours' where id = ${released!.id}::uuid`);
      await tx.execute(sql`select public.alert_steps()`);
      const alerts = await tx.execute<{ facts: { count: number; oldestAt: string } }>(sql`select facts from public.alert_outbox where kind = 'release_undestroyed'`);
      expect(alerts).toHaveLength(1);
      expect(alerts[0]!.facts.count).toBeGreaterThanOrEqual(2);
      await tx.execute(sql`select public.alert_steps()`);
      expect(await tx.execute(sql`select 1 from public.alert_outbox where kind = 'release_undestroyed'`)).toHaveLength(1);
      // The record of a destroy line, as quarantine-record writes it: the release's id from the post's mark, the time forced.
      await tx.execute(sql`
        update public.quarantine_files q set returned_at = null, destroyed_at = now(),
               release_id = (select r.release_id from public.release_posts r where r.post_id = q.post_id)
         where q.media_id = ${erasedOne.mediaIds[1]!}::uuid`);
      const rowsAfter = await tx.execute<{ release_id: string; destroyed: boolean }>(sql`select release_id, destroyed_at is not null as destroyed from public.quarantine_files where media_id = ${erasedOne.mediaIds[1]!}::uuid`);
      expect(rowsAfter.map((row) => [row.release_id, row.destroyed])).toEqual([
        [released!.id, true],
        [released!.id, true],
      ]);
      expect(await plan()).toEqual([]);
      const [custody] = await tx.execute<{ files_left: number }>(sql`select files_left from public.seal_custody(${erasedOne.sealActionId}::uuid)`);
      expect(custody!.files_left).toBe(0);
    });
  });

  test("release_announce: as built release_period_unset; with a period set, an admin's alone, its row written once, and the period's three waits in seal_release", async () => {
    expect(raised(await apiDb.execute(sql`select public.release_announce(${good.sealActionId}::uuid, ${staffAdmin.id}::uuid)`).then(() => null, (err: unknown) => err))?.message).toBe("release_period_unset");
    await rolledBack(migrateDb, async (tx) => {
      // The period counsel would set, inside a transaction that is rolled back: the function as a later migration replaces it.
      await tx.execute(sql.raw(`CREATE OR REPLACE FUNCTION public.release_rules() RETURNS TABLE (silence_days integer, period_notice_days integer, backup_days integer, posts_max integer)
        LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$ SELECT 10, 30, 30, 1000 $$`));
      const refusedIn = async (statement: ReturnType<typeof sql>) => tx.transaction((sp) => sp.execute(statement)).then(() => null, (err: unknown) => raised(err)?.message);
      expect(await refusedIn(sql`select public.release_announce(${good.sealActionId}::uuid, ${moderator.id}::uuid)`)).toBe("admin_required");
      expect(await refusedIn(sql`select public.release_announce(${deciding.sealActionId}::uuid, ${staffAdmin.id}::uuid)`)).toBe("release_not_open");
      const [announced] = await tx.execute<{ day: string }>(sql`select public.release_announce(${good.sealActionId}::uuid, ${staffAdmin.id}::uuid)::text as day`);
      const [expected] = await tx.execute<{ day: string }>(sql`select ((now() + interval '30 days') at time zone 'UTC')::date::text as day`);
      expect(announced!.day).toBe(expected!.day);
      const [again] = await tx.execute<{ day: string }>(sql`select public.release_announce(${good.sealActionId}::uuid, ${staffAdmin.id}::uuid)::text as day`);
      expect(again!.day).toBe(announced!.day);
      const notices = await tx.execute<{ told: string }>(sql`select told::text from public.release_notices where subject_id = ${good.sealActionId}::uuid`);
      expect(notices.map((n) => n.told)).toEqual(["pending"]);
      // The ground period, step by step: the silence has not passed; then the day's notice is not told; not old enough;
      // an objection unanswered; and only then the release.
      const period = sql`select public.seal_release(${good.sealActionId}::uuid, 'period', null, ${staffAdmin.id}::uuid)`;
      expect(await refusedIn(period)).toBe("release_period_running");
      await tx.execute(sql`update public.authority_notifications set sent_at = sent_at - interval '11 days' where id = public.seal_record(${good.sealActionId}::uuid)`);
      expect(await refusedIn(period)).toBe("release_period_running");
      await tx.execute(sql`update public.release_notices set told = 'sent', told_at = now() where subject_id = ${good.sealActionId}::uuid`);
      expect(await refusedIn(period)).toBe("release_period_running");
      await tx.execute(sql`update public.release_notices set created_at = created_at - interval '31 days', objection = 'Keep them', objected_at = now() where subject_id = ${good.sealActionId}::uuid`);
      expect(await refusedIn(period)).toBe("release_period_running");
      await tx.execute(sql`update public.release_notices set objection_answered_at = now() where subject_id = ${good.sealActionId}::uuid`);
      expect(await refusedIn(period)).toBeNull();
    });
    // The replaced function went with the rollback.
    expect(raised(await apiDb.execute(sql`select public.release_announce(${good.sealActionId}::uuid, ${staffAdmin.id}::uuid)`).then(() => null, (err: unknown) => err))?.message).toBe("release_period_unset");
  });

  test("this file left nothing behind: its seals, records, moves, leaves and orders are removed, and the tables hold what they held before", async () => {
    // The alerts its seals and its order raised (moderation_urgent, order_opened) since the file began.
    await migrateDb.execute(sql`delete from public.alert_outbox where created_at >= ${startedAt}::timestamptz`);
    await removeReleases(migrateDb, posts, allSeals(), allMedia());
    await removeOrders(migrateDb, orders);
    await removeRecords(migrateDb, [...authors, admin.id]);
    await removeDecided(migrateDb, posts, [admin.id]);
    await removeFixtures(migrateDb, [...authors, staffAdmin.id, otherAdmin.id, moderator.id]);
    expect(await releaseCounts(migrateDb)).toEqual(releasesBefore);
    expect(await rowCounts(apiDb, [...CHANNEL_TABLES])).toMatchObject(before);
  });
});
