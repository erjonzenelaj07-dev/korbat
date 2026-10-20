import { sql } from "drizzle-orm";
import { MEDIA_SIZES } from "@korbat/contracts";
import type { Db, DbTx } from "@korbat/db";
import { storedImageName } from "../../src/media";
import { uuids } from "./moderation-fixtures";

/**
 * 3d Task 2: fixtures of the release (3d design, sections 6.2, 7.2 and 12). 3f's records of a report, the quarantine's
 * rows and the leaves are the migrator's alone, so every write and read here is made as the migrator. The release itself
 * is never written here: it is the API's seal_release, under an admin's key, or the command line's replay.
 */

/** The release's four tables, which a suite counts before and after. */
export const RELEASE_TABLES = ["public.releases", "public.release_posts", "public.release_leaves", "public.release_notices"] as const;

/** How many rows each of the release's tables holds, as the migrator (release_leaves is closed to the API role). */
export async function releaseCounts(q: Db | DbTx): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of RELEASE_TABLES) counts[table] = (await q.execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${table}`)))[0]!.n;
  return counts;
}

/** A leave or an instruction to destroy, as release-leave records it. */
export interface LeaveInput {
  from: "authority" | "court";
  reference?: string;
  receivedOn?: string;
  untold?: boolean;
  untoldUntil?: string | null;
}

/** What reportForTest wrote: the seal's record of a report, and the leave when one was asked for. */
export interface ReportedForTest {
  notificationId: string;
  leaveId: string | null;
}

/** The seal's record of a report, as seal_report finds it (seal_record), or null. */
export async function sealRecord(q: Db | DbTx, sealActionId: string): Promise<string | null> {
  const [row] = await q.execute<{ id: string | null }>(sql`select public.seal_record(${sealActionId}::uuid) as id`);
  return row?.id ?? null;
}

/** A leave recorded against a record, as release-leave records it (the row only; the command writes its audit row too). */
export async function leaveForTest(q: Db | DbTx, notificationId: string, leave: LeaveInput): Promise<string> {
  const [row] = await q.execute<{ id: string }>(sql`
    insert into public.release_leaves (notification_id, leave_from, reference, received_on, untold, untold_until, recorded_by)
    values (${notificationId}::uuid, ${leave.from}, ${leave.reference ?? "AZ 1/26"}, ${leave.receivedOn ?? "2026-10-01"}::date,
            ${leave.untold ?? false}, ${leave.untoldUntil ?? null}::timestamptz, 'the operator')
    returning id`);
  return row!.id;
}

/**
 * The fixture of 3d's section 12, `reportForTest(action, { answer, handedOver, leave })` (Task 2): as the migrator, the
 * seal's record of a report is written sent, as notification-sent leaves it, and answered, as notification-answer does,
 * when an answer is given; with `handedOver` a production of the seal's files is recorded as delivered, as the
 * hand-over's record writes one; with `leave`, the leave to destroy as release-leave records it.
 */
export async function reportForTest(
  q: Db | DbTx,
  sealActionId: string,
  options: { answer?: "not_illegal" | "illegal" | "no_assessment" | "other" | null; handedOver?: boolean; leave?: LeaveInput | null } = {},
): Promise<ReportedForTest> {
  const notificationId = await sealRecord(q, sealActionId);
  if (notificationId === null) throw new Error("the seal opened no record of a report");
  await q.execute(sql`
    update public.authority_notifications
       set state = 'sent', sent_at = coalesce(sent_at, now()), authority = 'A test authority', channel = 'portal', sent_kinds = array['files'],
           duties = case when cardinality(duties) = 0 then array['dsa18_1'] else duties end, not_kept_version = 1, closed_at = coalesce(closed_at, now())
     where id = ${notificationId}::uuid and state <> 'sent'`);
  if (options.answer !== undefined && options.answer !== null) {
    await q.execute(sql`update public.authority_notifications set answer = ${options.answer}, answered_at = now(), their_reference = 'ST 12/34' where id = ${notificationId}::uuid`);
  }
  if (options.handedOver) {
    await q.execute(sql`
      insert into public.productions (instrument, notification_id, seal_action_id, account_id, produced, files, delivered_at, recorded_by)
      select 'notification', n.id, ${sealActionId}::uuid, n.account_id, array['files'], '[]'::jsonb, now(), 'the operator'
        from public.authority_notifications n where n.id = ${notificationId}::uuid`);
  }
  const leaveId = options.leave ? await leaveForTest(q, notificationId, options.leave) : null;
  return { notificationId, leaveId };
}

/** Both files of each image recorded as moved into the quarantine, as quarantine-record writes an `in` line. */
export async function moveForTest(q: Db | DbTx, mediaIds: readonly string[]): Promise<void> {
  for (const mediaId of mediaIds) {
    for (const size of MEDIA_SIZES) {
      await q.execute(sql`
        insert into public.quarantine_files (media_id, file, size, sha256)
        values (${mediaId}::uuid, ${storedImageName(mediaId, size)}, 1234, ${"b".repeat(64)})
        on conflict do nothing`);
    }
  }
}

/** A seal's releases and its posts' marks, newest first, as the migrator reads them. */
export async function releasesOf(q: Db | DbTx, sealActionId: string): Promise<{ id: string; post_ids: string[]; basis: string; leave_id: string | null; author_notice: string; backups_clear_at: string }[]> {
  const found = await q.execute<{ id: string; post_ids: string[]; basis: string; leave_id: string | null; author_notice: string; backups_clear_at: string }>(sql`
    select r.id, r.post_ids::text[] as post_ids, r.basis, r.leave_id, r.author_notice, r.backups_clear_at::text
      from public.releases r where r.seal_action_id = ${sealActionId}::uuid order by r.released_at desc, r.id`);
  return found.map((row) => ({ ...row }));
}

/**
 * Removes, as the migrator, the releases that name these posts with their marks and the replays of them, the leaves and
 * the day's notices of these seals' records, and the quarantine's rows of these images. The release's tables are kept
 * for good in production; only a suite's own cleanup deletes them.
 */
export async function removeReleases(migrateDb: Db | DbTx, posts: readonly string[], sealActionIds: readonly string[], mediaIds: readonly string[]): Promise<void> {
  await migrateDb.execute(sql`delete from public.quarantine_files where media_id = any(${uuids(mediaIds)}) or post_id = any(${uuids(posts)})`);
  await migrateDb.execute(sql`delete from public.release_posts where post_id = any(${uuids(posts)})`);
  await migrateDb.execute(sql`delete from public.releases where post_ids && ${uuids(posts)} or seal_action_id = any(${uuids(sealActionIds)})`);
  await migrateDb.execute(sql`
    delete from public.release_leaves l
     where l.notification_id in (select n.id from public.authority_notifications n where n.seal_action_id = any(${uuids(sealActionIds)}))`);
  await migrateDb.execute(sql`delete from public.release_notices where subject_id = any(${uuids(sealActionIds)})`);
}
