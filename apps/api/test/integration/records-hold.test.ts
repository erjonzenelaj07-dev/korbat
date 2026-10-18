import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { ORDER_RULES } from "@korbat/contracts";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { runStaffCommand } from "../../src/cli/staff";
import { loadConfig } from "../../src/config";
import { imagesSealed } from "../../src/moderation/standing-repo";
import { act, appealOf, decideIn, gate, newTestStaff, removeFixtures, reviewIn, rowCounts, staffProfile, type TestStaff } from "./moderation-fixtures";
import { effectParams, effectWith, orderForTest } from "./orders-fixtures";
import { NO_SEAL, SEAL_FOR_GOOD, SEAL_WHILE_DECIDING, ageHoldForTest, heldFor, holdOf, recordCounts, recordsOf, removeRecords, sealActionOf, sealedPost, suspectPost } from "./records-fixtures";
import { newProfile } from "./social-fixtures";
import { rolledBack } from "./staff-fixtures";

vi.setConfig({ testTimeout: 90_000 });

/**
 * The report hold (3f design, sections 6.5, 7.13 and 7.15; invariant 17): a seal opens an owed record once an account and
 * holds the account's address; an admin's answer without a seal closes it, and so does a seal lifted by a correction or
 * a review (declined, unsealed, the hold released, nothing in reports_owed); the seal for good after the one taken while
 * deciding keeps the record and its first times; a second seal that commits beside notification-sent still gets its
 * record and its hold. Every test but the race runs as the migrator in a transaction that is rolled back, so that it can
 * read the records, which the API role cannot; the race commits what its two sessions need and removes it.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the report hold", () => {
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  let mod: TestStaff;
  let admin: TestStaff;
  let admin2: TestStaff;
  let before: Record<string, number>;
  let recordsBefore: Record<string, number>;

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 4 });
    repo = createAuthRepo(authDb);
    mod = await newTestStaff(authDb, migrateDb, repo, "moderator");
    admin = await newTestStaff(authDb, migrateDb, repo, "admin");
    admin2 = await newTestStaff(authDb, migrateDb, repo, "admin");
    before = await rowCounts(apiDb);
    recordsBefore = await recordCounts(migrateDb);
  }, 60_000);
  afterAll(async () => {
    await Promise.all([closeDb(apiDb), closeDb(authDb), closeDb(migrateDb)]);
  });

  /** One test's world, as the migrator, rolled back, with the three staff members' profiles in it. */
  const inWorld = (fn: (tx: DbTx) => Promise<void>) =>
    rolledBack(migrateDb, async (tx) => {
      await staffProfile(tx, mod);
      await staffProfile(tx, admin);
      await staffProfile(tx, admin2);
      await fn(tx);
    });
  const owed = async (tx: DbTx) => (await tx.execute<{ case_id: string; kind: string; since: string }>(sql`select case_id, kind, since::text from public.reports_owed()`)).map((row) => ({ ...row }));
  const nowText = async (tx: DbTx) => (await tx.execute<{ now: string }>(sql`select now()::text as now`))[0]!.now;

  test("a seal opens an owed record once an account and holds its address for reportHoldDays; a seal for good makes the hold final", async () => {
    await inWorld(async (tx) => {
      const first = await sealedPost(tx, mod, "deciding");
      const [record] = await recordsOf(tx, first.authorId);
      const [reported] = await tx.execute<{ at: string }>(sql`select min(created_at)::text as at from intake_items where case_id = ${first.caseId}::uuid and suspect`);
      expect(record).toMatchObject({ state: "owed", duties: [], case_id: first.caseId, seal_action_id: first.sealActionId, account_id: first.authorId, opened_via: "system", first_report_at: reported!.at, admin_answer_at: null, closed_at: null });
      expect(record!.opened_at).toBe(await nowText(tx));
      const hold = await holdOf(tx, first.authorId);
      expect(hold).toMatchObject({ seal_final: false, released_at: null, release_reason: null });
      const [until] = await tx.execute<{ until: string }>(sql`select (${hold!.set_at}::timestamptz + make_interval(days => ${ORDER_RULES.reportHoldDays}))::text as until`);
      expect(await heldFor(tx, first.authorId)).toEqual({ until: until!.until, held: true, final: false });
      expect(await owed(tx)).toContainEqual({ case_id: first.caseId, kind: "sealed_images", since: record!.opened_at });

      // A second seal of the same author's images finds the record owed: no second record.
      const second = await sealedPost(tx, mod, "deciding", first.authorId);
      expect((await recordsOf(tx, first.authorId)).map((r) => r.id)).toEqual([record!.id]);
      expect((await holdOf(tx, first.authorId))!.seal_final).toBe(false);
      // The admin seals the second for good: the hold's sentence becomes the final one, and the record gains the answer's time.
      const final = await decideIn(tx, admin, second.caseId, SEAL_FOR_GOOD);
      const [decided] = await tx.execute<{ at: string }>(sql`select decided_at::text as at from decisions where id = ${final}::uuid`);
      expect((await recordsOf(tx, first.authorId))[0]).toMatchObject({ id: record!.id, state: "owed", admin_answer_at: decided!.at });
      expect(await heldFor(tx, first.authorId)).toMatchObject({ held: true, final: true });
    });
  });

  test("the hold reads as not held once reportHoldDays have passed, and releases nothing by itself", async () => {
    await inWorld(async (tx) => {
      const p = await sealedPost(tx, admin, "final");
      expect(await heldFor(tx, p.authorId)).toMatchObject({ held: true, final: true });
      await ageHoldForTest(tx, p.authorId, `${ORDER_RULES.reportHoldDays} days 1 second`);
      expect(await heldFor(tx, p.authorId)).toEqual({ until: null, held: false, final: true });
      expect(await holdOf(tx, p.authorId)).toMatchObject({ released_at: null });
      expect((await recordsOf(tx, p.authorId))[0]!.state).toBe("owed");
    });
  });

  test("an admin's answer without a seal closes the record as declined, unsealed, and releases the hold; with another seal of the account in force it stays owed", async () => {
    await inWorld(async (tx) => {
      const p = await sealedPost(tx, mod, "deciding");
      await decideIn(tx, admin, p.caseId, NO_SEAL);
      const [record] = await recordsOf(tx, p.authorId);
      expect(record).toMatchObject({ state: "declined", declined_reason: "unsealed" });
      expect(record!.closed_at).toBe(await nowText(tx));
      expect(await holdOf(tx, p.authorId)).toMatchObject({ release_reason: "declined" });
      expect(await heldFor(tx, p.authorId)).toMatchObject({ held: false });
      expect((await owed(tx)).filter((row) => row.case_id === p.caseId)).toEqual([]);

      // Two seals of one author: an answer without a seal on one leaves the other in force, and the record owed.
      const a = await sealedPost(tx, mod, "deciding");
      const b = await sealedPost(tx, mod, "deciding", a.authorId);
      await decideIn(tx, admin, a.caseId, NO_SEAL);
      expect((await recordsOf(tx, a.authorId)).map((r) => r.state)).toEqual(["owed"]);
      expect(await heldFor(tx, a.authorId)).toMatchObject({ held: true });
      await decideIn(tx, admin, b.caseId, NO_SEAL);
      expect((await recordsOf(tx, a.authorId)).map((r) => [r.state, r.declined_reason])).toEqual([["declined", "unsealed"]]);
    });
  });

  test("the seal for good that the admin's answer takes after the seal taken while deciding keeps the record owed with its first times", async () => {
    await inWorld(async (tx) => {
      const p = await sealedPost(tx, mod, "deciding");
      const [record] = await recordsOf(tx, p.authorId);
      const hold = await holdOf(tx, p.authorId);
      await decideIn(tx, admin, p.caseId, SEAL_FOR_GOOD);
      const after = await recordsOf(tx, p.authorId);
      expect(after).toHaveLength(1);
      expect(after[0]).toMatchObject({ id: record!.id, state: "owed", opened_at: record!.opened_at, declined_reason: null, closed_at: null, seal_action_id: p.sealActionId });
      expect(after[0]!.admin_answer_at).not.toBeNull();
      expect(await holdOf(tx, p.authorId)).toEqual({ set_at: hold!.set_at, seal_final: true, released_at: null, release_reason: null });
    });
  });

  test("a seal lifted by a correction closes the record, and so does a seal lifted by a review on the author's appeal", async () => {
    await inWorld(async (tx) => {
      const p = await sealedPost(tx, admin, "final");
      await decideIn(tx, admin, p.caseId, { kind: "correction", reviewsDecisionId: p.decisionId, actions: [act("unseal_media")] });
      expect((await recordsOf(tx, p.authorId)).map((r) => [r.state, r.declined_reason])).toEqual([["declined", "unsealed"]]);
      expect(await holdOf(tx, p.authorId)).toMatchObject({ release_reason: "declined" });

      const q = await sealedPost(tx, admin, "final");
      await appealOf(tx, q.decisionId, q.authorId);
      await reviewIn(tx, admin2, q.decisionId, { outcome: "reversed", actions: [act("unseal_media")] });
      expect((await recordsOf(tx, q.authorId)).map((r) => [r.state, r.declined_reason])).toEqual([["declined", "unsealed"]]);
      expect(await heldFor(tx, q.authorId)).toMatchObject({ held: false });
    });
  });

  test("a report alone opens nothing: only a seal does", async () => {
    await inWorld(async (tx) => {
      const p = await suspectPost(tx);
      expect(await recordsOf(tx, p.authorId)).toEqual([]);
      expect(await holdOf(tx, p.authorId)).toBeNull();
    });
  });

  test("a second seal that commits beside notification-sent still gets its record and its hold", async () => {
    const author = await newProfile(apiDb);
    const recordId = randomUUID();
    // The account's owed record and its hold, committed: a seal's record, as report_open leaves it.
    await migrateDb.execute(sql`
      insert into public.authority_notifications (id, state, case_id, seal_action_id, account_id, opened_at, opened_via)
      values (${recordId}::uuid, 'owed', gen_random_uuid(), gen_random_uuid(), ${author.id}::uuid, now(), 'system')`);
    await migrateDb.execute(sql`insert into auth.report_holds (user_id, set_at, seal_final) values (${author.id}::uuid, now(), true)`);
    const held = gate();
    const released = gate();
    try {
      // A third session holds the record's row, so that notification-sent stops after it took the hold's row.
      const blocker = migrateDb.transaction(async (tx) => {
        await tx.execute(sql`select 1 from public.authority_notifications where id = ${recordId}::uuid for update`);
        held.open();
        await released.opened;
      });
      await held.opened;
      const lines: string[] = [];
      const sent = runStaffCommand(
        ["notification-sent", recordId, "--authority", "BKA", "--channel", "portal", "--duty", "dsa18_1", "--state", "DE", "--basis", "the account's home", "--own-reference", "K-1", "--kinds", "handle,address", "--at", "2026-10-10T01:00:00Z", "--by", "operator"],
        { DATABASE_URL_MIGRATE: process.env.DATABASE_URL_MIGRATE! },
        { log: (line) => lines.push(line), error: (line) => lines.push(line) },
        async () => Buffer.alloc(0),
      );
      await untilWaiting(1);
      // The second seal: it waits at the hold's row, which notification-sent holds.
      let inside: { records: { state: string; seal_action_id: string | null }[]; hold: unknown } | null = null;
      const seal = rolledBack(migrateDb, async (tx) => {
        await staffProfile(tx, admin);
        const p = await suspectPost(tx, 2, author.id);
        const decision = await decideIn(tx, admin, p.caseId, SEAL_FOR_GOOD);
        const action = await sealActionOf(tx, decision);
        inside = { records: (await recordsOf(tx, author.id)).map((r) => ({ state: r.state, seal_action_id: r.seal_action_id === action ? "this seal" : r.seal_action_id })), hold: await holdOf(tx, author.id) };
      });
      await untilWaiting(2);
      released.open();
      await blocker;
      expect(await sent).toBe(0);
      await seal;
      // It read the record as sent, after the command committed, and opened its own with the hold set again.
      expect(inside!.records.map((r) => r.state)).toEqual(["sent", "owed"]);
      expect(inside!.records[1]!.seal_action_id).toBe("this seal");
      expect(inside!.hold).toMatchObject({ seal_final: true, released_at: null, release_reason: null });
    } finally {
      released.open();
      await removeRecords(migrateDb, [author.id]);
      await removeFixtures(migrateDb, [author.id]);
    }
  });

  /** Resolves once this many of the migrator's other sessions wait for a lock. */
  async function untilWaiting(n: number): Promise<void> {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const [row] = await migrateDb.execute<{ n: number }>(
        sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and usename = current_user and wait_event_type = 'Lock'`,
      );
      if (row!.n >= n) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`fewer than ${n} sessions came to wait for a lock`);
  }

  test("a sent record stays past recordKeepYears while the seal for good it answers for is in force, and seal_report still reads it", async () => {
    await inWorld(async (tx) => {
      const p = await sealedPost(tx, mod, "deciding");
      const final = await decideIn(tx, admin, p.caseId, SEAL_FOR_GOOD);
      const forGood = await sealActionOf(tx, final);
      const [record] = await recordsOf(tx, p.authorId);
      // The record holds the first seal's id; the seal taken while deciding ended with the final decision.
      expect(record!.seal_action_id).toBe(p.sealActionId);
      const inForce = async (id: string) => (await tx.execute<{ n: number }>(sql`select count(*)::int as n from public.measures_in_force where id = ${id}::uuid`))[0]!.n;
      expect([await inForce(p.sealActionId), await inForce(forGood)]).toEqual([0, 1]);
      // The record is sent, as notification-sent writes it.
      await tx.execute(sql`update public.authority_notifications set state = 'sent', duties = '{dsa18_1}', sent_at = now(), authority = 'BKA', channel = 'portal',
                             sent_kinds = '{handle}', not_kept_version = 1, closed_at = now() where id = ${record!.id}::uuid`);
      const reported = async () => (await tx.execute<{ reported: boolean }>(sql`select reported from public.seal_report(${forGood}::uuid)`))[0]!.reported;
      expect(await reported()).toBe(true);
      // More than recordKeepYears pass: the seals' times move back, and the record is written again with its times moved
      // back as an import keeps them (its opening time cannot be updated).
      const back = `${ORDER_RULES.recordKeepYears + 1} years`;
      await tx.execute(sql`update public.decision_actions set created_at = created_at - ${back}::interval where id in (${p.sealActionId}::uuid, ${forGood}::uuid)`);
      await tx.execute(sql`create temp table record_copy on commit drop as select * from public.authority_notifications where id = ${record!.id}::uuid`);
      await tx.execute(sql`delete from public.authority_notifications where id = ${record!.id}::uuid`);
      await tx.execute(sql`insert into public.authority_notifications (id, state, duties, case_id, seal_action_id, account_id, opened_at, opened_via, first_report_at, admin_answer_at,
                               authority, channel, sent_at, sent_kinds, not_kept_version, closed_at, imported_at)
                           select id, state, duties, case_id, seal_action_id, account_id, opened_at - ${back}::interval, opened_via, first_report_at - ${back}::interval,
                                  admin_answer_at - ${back}::interval, authority, channel, sent_at - ${back}::interval, sent_kinds, not_kept_version, closed_at - ${back}::interval, now()
                             from record_copy`);
      expect(await reported()).toBe(true);
      // The retention round keeps it: the seal for good is in force, and seal_report answers as before.
      await tx.execute(sql`select public.erase_authority_records()`);
      expect((await recordsOf(tx, p.authorId)).map((row) => row.id)).toEqual([record!.id]);
      expect(await reported()).toBe(true);
    });
  });

  test("a seal taken while an order's notice about the post is held holds the address but tells nothing: the deletion mail's hold paragraph and the sealed images wait for the release", async () => {
    await inWorld(async (tx) => {
      // A post reported as child sexual abuse material, disabled for an order that must not be told, then sealed.
      const p = await suspectPost(tx, 2);
      const order = await orderForTest(tx, mod, { posts: [p.postId], sectionC: true });
      await effectWith(tx, mod, order.id, effectParams(order));
      const seal = await decideIn(tx, mod, p.caseId, SEAL_WHILE_DECIDING);
      const [held] = await tx.execute<{ informed: boolean }>(sql`select informed_at is not null as informed from public.decisions where id = ${seal}::uuid`);
      expect(held!.informed).toBe(false);
      // The record opens and the address is held, as for any seal; what the mails may say of it is not told yet.
      expect((await recordsOf(tx, p.authorId)).map((row) => row.state)).toEqual(["owed"]);
      expect((await heldFor(tx, p.authorId)).held).toBe(true);
      const told = async () => ({
        hold: (await createAuthRepo(tx as unknown as Db).addressHold(p.authorId))?.told,
        sealed: await imagesSealed(tx, p.authorId),
      });
      expect(await told()).toEqual({ hold: false, sealed: false });
      // The release tells the seal with the notice; from then on the deletion mail may say so.
      await tx.execute(sql`update public.legal_orders set hold_ended_at = now(), hold_end_reason = 'released_by_authority' where id = ${order.id}::uuid`);
      await tx.execute(sql`select public.order_notices_release()`);
      expect(await told()).toEqual({ hold: true, sealed: true });
    });
  });

  test("leaves no row behind", async () => {
    expect(await rowCounts(apiDb)).toEqual(before);
    expect(await recordCounts(migrateDb)).toEqual(recordsBefore);
  });
});
