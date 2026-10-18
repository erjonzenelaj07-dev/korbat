import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { ORDER_RULES } from "@korbat/contracts";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { createAuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { act, decideIn, newTestStaff, rowCounts, staffProfile, type TestStaff } from "./moderation-fixtures";
import { holdOf, recordCounts, recordsOf, sealedPost } from "./records-fixtures";
import { rolledBack } from "./staff-fixtures";

vi.setConfig({ testTimeout: 90_000 });

/**
 * The notification records' two answers and their erasure (3f design, sections 6.5, 6.8 and 7.18; invariant 21, the
 * authority's records). reports_owed() answers a case, a kind and a time for each owed record and nothing more;
 * seal_report(action) answers whether a seal was reported, the authority's reference, its answer's word and day, and
 * when the report was sent (3d's ruling O1), for the seal's own record and for a seal that met its account's record
 * owed. erase_authority_records() deletes a record and a production record_keep_years after their newest time, never
 * while the record's seal is in force, a "not to the person" mark runs (open or ahead) or an archive is not recorded as
 * destroyed, and a hold once its account has no record left. Each test runs as the migrator in a transaction that is
 * rolled back, with the times moved there.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the notification records' answers and their erasure", () => {
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  let mod: TestStaff;
  let admin: TestStaff;
  let before: Record<string, number>;
  let recordsBefore: Record<string, number>;

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    const repo = createAuthRepo(authDb);
    mod = await newTestStaff(authDb, migrateDb, repo, "moderator");
    admin = await newTestStaff(authDb, migrateDb, repo, "admin");
    before = await rowCounts(apiDb);
    recordsBefore = await recordCounts(migrateDb);
  }, 60_000);
  afterAll(async () => {
    await Promise.all([closeDb(apiDb), closeDb(authDb), closeDb(migrateDb)]);
  });

  const inWorld = (fn: (tx: DbTx) => Promise<void>) =>
    rolledBack(migrateDb, async (tx) => {
      await staffProfile(tx, mod);
      await staffProfile(tx, admin);
      await fn(tx);
    });
  const sealReport = async (tx: DbTx, action: string) =>
    ({ ...(await tx.execute<Record<string, unknown>>(sql`select reported, their_reference, answer, answered_at::text, sent_at::text from public.seal_report(${action}::uuid)`))[0]! });
  /** A record the command line opened, with every time of it set back by the interval. */
  const oldRecord = async (tx: DbTx, interval: string, extra: { sealActionId?: string; accountId?: string } = {}) => {
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into public.authority_notifications (state, duties, case_id, seal_action_id, account_id, opened_at, opened_via, closed_at, declined_reason, imported_at)
      values ('declined', '{voluntary}', gen_random_uuid(), ${extra.sealActionId ?? null}, ${extra.accountId ?? null}, now() - ${interval}::interval,
              ${extra.sealActionId ? "system" : "cli"}, now() - ${interval}::interval, 'a check that ended in no', now()) returning id`);
    // closed_at is not forced: the record's newest time is moved with its opening.
    return row!.id;
  };
  const erase = async (tx: DbTx) => Number((await tx.execute<{ n: number }>(sql`select public.erase_authority_records() as n`))[0]!.n);
  const exists = async (tx: DbTx, table: string, id: string) =>
    (await tx.execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${table} where id = '${id}'`)))[0]!.n === 1;
  const years = `${ORDER_RULES.recordKeepYears} years`;

  test("reports_owed() answers each owed record's case, kind and since: sealed_images for a seal's, the first duty for one the command line opened", async () => {
    await inWorld(async (tx) => {
      const p = await sealedPost(tx, mod, "deciding");
      const [cli] = await tx.execute<{ id: string; case_id: string; since: string }>(sql`
        insert into public.authority_notifications (state, duties, case_id, account_id, opened_at, opened_via) values ('owed', '{tco14_5}', gen_random_uuid(), gen_random_uuid(), now(), 'cli')
        returning id, case_id, opened_at::text as since`);
      const owed = (await tx.execute<{ case_id: string; kind: string; since: string }>(sql`select case_id, kind, since::text from public.reports_owed()`)).map((row) => ({ ...row }));
      const [record] = await recordsOf(tx, p.authorId);
      expect(owed).toContainEqual({ case_id: p.caseId, kind: "sealed_images", since: record!.opened_at });
      expect(owed).toContainEqual({ case_id: cli!.case_id, kind: "tco14_5", since: cli!.since });
    });
  });

  test("seal_report: not reported while owed; once sent, the reference, the answer's word, its day and the time sent; a second seal of the account reads the same record; a seal without a record answers one row, not reported", async () => {
    await inWorld(async (tx) => {
      const p = await sealedPost(tx, admin, "final");
      expect(await sealReport(tx, p.sealActionId)).toEqual({ reported: false, their_reference: null, answer: null, answered_at: null, sent_at: null });
      const second = await sealedPost(tx, admin, "final", p.authorId);
      const [record] = await recordsOf(tx, p.authorId);
      await tx.execute(sql`
        update public.authority_notifications
           set state = 'sent', duties = '{dsa18_1}', authority = 'BKA', channel = 'portal', sent_at = '2026-10-10T01:00:00Z', sent_kinds = '{handle,address}', not_kept_version = 1,
               closed_at = now(), their_reference = 'ST 12/34', answer = 'illegal', answered_at = '2026-10-12T00:00:00Z'
         where id = ${record!.id}::uuid`);
      const expected = { reported: true, their_reference: "ST 12/34", answer: "illegal", answered_at: "2026-10-12 00:00:00+00", sent_at: "2026-10-10 01:00:00+00" };
      await tx.execute(sql`set local timezone to 'UTC'`);
      expect(await sealReport(tx, p.sealActionId)).toEqual(expected);
      expect(await sealReport(tx, second.sealActionId)).toEqual(expected);
      const [none] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from public.seal_report(gen_random_uuid())`);
      expect(none!.n).toBe(1);
    });
  });

  test("erase_authority_records deletes a record and its events three years after their newest time, never while its seal is in force or a 'not to the person' runs", async () => {
    await inWorld(async (tx) => {
      const old = await oldRecord(tx, `${years} 1 day`);
      const young = await oldRecord(tx, `${years} -1 day`);
      // An event inside the three years keeps an old record.
      const evented = await oldRecord(tx, `${years} 1 day`);
      await tx.execute(sql`insert into public.authority_notification_events (notification_id, kind, at, occurred_at, how, not_to_person) values (${evented}::uuid, 'request', now(), now(), 'a later letter', false)`);
      // "Not to the person" with an open end, and with an end ahead, keep it whatever its age; one whose end passed does not.
      const open = await oldRecord(tx, `${years} 1 day`);
      const ahead = await oldRecord(tx, `${years} 1 day`);
      const passed = await oldRecord(tx, `${years} 1 day`);
      for (const [id, until] of [[open, null], [ahead, "now() + interval '1 day'"], [passed, "now() - interval '1 day'"]] as const) {
        await tx.execute(sql.raw(`update public.authority_notifications set imported_at = now() where id = '${id}'`));
        await tx.execute(sql.raw(`insert into public.authority_notification_events (notification_id, kind, at, occurred_at, how, not_to_person, not_to_person_until)
                                  values ('${id}', 'request', now() - interval '${years} 1 day', now() - interval '${years} 1 day', 'not to be told', true, ${until ?? "null"})`));
      }
      // A seal's record whose seal is still in force.
      const p = await sealedPost(tx, admin, "final");
      const sealed = await oldRecord(tx, `${years} 1 day`, { sealActionId: p.sealActionId, accountId: p.authorId });
      expect(await erase(tx)).toBeGreaterThanOrEqual(2);
      expect(await exists(tx, "public.authority_notifications", old)).toBe(false);
      expect(await exists(tx, "public.authority_notifications", passed)).toBe(false);
      expect(await exists(tx, "public.authority_notifications", young)).toBe(true);
      expect(await exists(tx, "public.authority_notifications", evented)).toBe(true);
      expect(await exists(tx, "public.authority_notifications", open)).toBe(true);
      expect(await exists(tx, "public.authority_notifications", ahead)).toBe(true);
      expect(await exists(tx, "public.authority_notifications", sealed)).toBe(true);
      // The events went with their record.
      const [left] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from public.authority_notification_events where notification_id = ${passed}::uuid`);
      expect(left!.n).toBe(0);
      // Once the seal is lifted, the old record goes.
      await decideIn(tx, admin, p.caseId, { kind: "correction", reviewsDecisionId: p.decisionId, actions: [act("unseal_media")] });
      await erase(tx);
      expect(await exists(tx, "public.authority_notifications", sealed)).toBe(false);
    });
  });

  test("erase_authority_records deletes a production three years old, never while its archive is not recorded as destroyed or its own 'not to the person' is ahead; a hold goes once its account has no record left", async () => {
    await inWorld(async (tx) => {
      const production = async (extra: string) => {
        const [row] = await tx.execute<{ id: string }>(sql.raw(`
          insert into public.productions (instrument, produced, opened_at, imported_at, files, archive_sha256, delivered_at, destroyed_at, destroyed_how, not_to_person_until)
          values ('demand', '{files}', now() - interval '${years} 1 day', now(), ${extra}) returning id`));
        return row!.id;
      };
      const plain = await production(`null, null, null, null, null, null`);
      const undestroyed = await production(`'[]'::jsonb, '${"b".repeat(64)}', now() - interval '${years} 1 day', null, null, null`);
      const destroyed = await production(`'[]'::jsonb, '${"b".repeat(64)}', now() - interval '${years} 1 day', now() - interval '${years}' - interval '1 hour', 'deleted', null`);
      const silent = await production(`null, null, null, null, null, now() + interval '1 day'`);
      await erase(tx);
      expect(await exists(tx, "public.productions", plain)).toBe(false);
      expect(await exists(tx, "public.productions", destroyed)).toBe(false);
      expect(await exists(tx, "public.productions", undestroyed)).toBe(true);
      expect(await exists(tx, "public.productions", silent)).toBe(true);

      // Holds: one released and one expired go once their account has no record left; one with a record, and one still
      // held, stay.
      const hold = async (released: boolean, setAgo: string) => {
        const [row] = await tx.execute<{ id: string }>(sql.raw(`
          insert into auth.report_holds (user_id, set_at, seal_final, released_at, release_reason)
          values (gen_random_uuid(), now() - interval '${setAgo}', true, ${released ? "now()" : "null"}, ${released ? "'sent'" : "null"}) returning user_id as id`));
        return row!.id;
      };
      const releasedWithOld = await hold(true, "1 day");
      await oldRecord(tx, `${years} 1 day`, { accountId: releasedWithOld });
      const releasedWithYoung = await hold(true, "1 day");
      await oldRecord(tx, "1 day", { accountId: releasedWithYoung });
      const expired = await hold(false, `${ORDER_RULES.reportHoldDays} days 1 minute`);
      const held = await hold(false, "1 day");
      await erase(tx);
      expect(await holdOf(tx, releasedWithOld)).toBeNull();
      expect(await recordsOf(tx, releasedWithOld)).toEqual([]);
      expect(await holdOf(tx, expired)).toBeNull();
      expect(await holdOf(tx, releasedWithYoung)).not.toBeNull();
      expect(await holdOf(tx, held)).not.toBeNull();
    });
  });

  test("leaves no row behind", async () => {
    expect(await rowCounts(apiDb)).toEqual(before);
    expect(await recordCounts(migrateDb)).toEqual(recordsBefore);
  });
});
