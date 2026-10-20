import { sql } from "drizzle-orm";
import type { Db, DbTx } from "@korbat/db";
import { uuids } from "./moderation-fixtures";

/**
 * 3d Task 1: fixtures of the quarantine's record (3d design, sections 6.1 and 12). quarantine_files is the migrator's
 * alone: the API's role holds no right on it, so every read, write and count here is made as the migrator.
 */

/** One file's row of the quarantine, as the migrator reads it, times as text. */
export interface QuarantineRow {
  media_id: string;
  file: string;
  post_id: string | null;
  size: number | null;
  sha256: string | null;
  moved_at: string;
  returned_at: string | null;
  destroyed_at: string | null;
  lost_at: string | null;
  lost_told: string | null;
  imported_at: string | null;
  unknown: boolean;
}

/** The rows of these images, by image and file. */
export async function quarantineRows(q: Db | DbTx, mediaIds: readonly string[]): Promise<QuarantineRow[]> {
  const found = await q.execute<QuarantineRow & Record<string, unknown>>(sql`
    select media_id, file, post_id, size::int as size, sha256, moved_at::text, returned_at::text, destroyed_at::text, lost_at::text,
           lost_told::text, imported_at::text, unknown
      from public.quarantine_files where media_id = any(${uuids(mediaIds)}) order by media_id, file`);
  return found.map((row) => ({ ...row }));
}

/** How many rows the table holds, as the migrator (the API role cannot count them). */
export async function quarantineCount(q: Db | DbTx): Promise<number> {
  const [row] = await q.execute<{ n: number }>(sql`select count(*)::int as n from public.quarantine_files`);
  return row!.n;
}

/** The plan as the migrator reads it, for these images only, as "<direction> <image id>" strings, sorted. */
export async function planOf(q: Db | DbTx, mediaIds: readonly string[]): Promise<string[]> {
  const found = await q.execute<{ direction: string; media_id: string }>(sql`select p.direction, p.media_id from public.quarantine_plan() p where p.media_id = any(${uuids(mediaIds)})`);
  return found.map((row) => `${row.direction} ${row.media_id}`).sort();
}

/**
 * What ageCustodyForTest moves back: a decision (when a move in became due) with its ledger rows; an image's quarantine
 * rows; an alert kind's rows; (3d Task 6) a signal, by its id, or the request for a person about a decision, by the
 * decision's id.
 */
export type CustodyAgeTarget =
  | { decision: string }
  | { media: string }
  | { alerts: "quarantine_due" | "quarantine_lost" | "automated_waiting" | "automated_objection" | "automation_capped" }
  | { signal: string }
  | { objection: string };

/**
 * The fixture of 3d's section 12, `ageCustodyForTest(target, interval)` (Task 1; Tasks 2, 6 and 7 grow it): as the
 * migrator, moves the times of the rows a day's alert or a due move is judged by back by the interval. It is the only way
 * a test meets a day's alert: every time is forced when it is first written, and no setting shortens a number. For a
 * decision: its decided_at, and the created_at of its ledger rows and of every ledger row that reversed one of them (when
 * a return became due). For an image: every time its quarantine rows hold. For an alert kind: when each of its outbox
 * rows was created. 3d Task 6: for a signal, when it was written and when it was handled, so the sweep's window and its
 * minute are met; for a request for a person, when it was sent, so its target and the limit on waiting are met. Run it
 * inside a transaction that ends in a rollback, or undo it.
 */
export async function ageCustodyForTest(q: Db | DbTx, target: CustodyAgeTarget, interval: string): Promise<void> {
  if ("decision" in target) {
    await q.execute(sql`update public.decisions set decided_at = decided_at - ${interval}::interval where id = ${target.decision}::uuid`);
    await q.execute(sql`
      update public.decision_actions set created_at = created_at - ${interval}::interval
       where decision_id = ${target.decision}::uuid
          or reverses_action_id in (select a.id from public.decision_actions a where a.decision_id = ${target.decision}::uuid)`);
  } else if ("media" in target) {
    await q.execute(sql`
      update public.quarantine_files
         set moved_at = moved_at - ${interval}::interval, returned_at = returned_at - ${interval}::interval,
             destroyed_at = destroyed_at - ${interval}::interval, lost_at = lost_at - ${interval}::interval
       where media_id = ${target.media}::uuid`);
  } else if ("signal" in target) {
    await q.execute(sql`update public.automated_signals set created_at = created_at - ${interval}::interval, handled_at = handled_at - ${interval}::interval where id = ${target.signal}::uuid`);
  } else if ("objection" in target) {
    await q.execute(sql`update public.automated_objections set created_at = created_at - ${interval}::interval where decision_id = ${target.objection}::uuid`);
  } else {
    await q.execute(sql`update public.alert_outbox set created_at = created_at - ${interval}::interval where kind = ${target.alerts}`);
  }
}

/**
 * Removes, as the migrator, the quarantine's rows of these images and, given the time the test began, the staff alerts
 * raised since then that name no message and no order: those its seals, lifted seals and records raised
 * (moderation_urgent, moderation_csam_lifted, quarantine_lost). Files of this kind run one at a time.
 */
export async function removeCustody(migrateDb: Db | DbTx, mediaIds: readonly string[], alertsSince?: string): Promise<void> {
  await migrateDb.execute(sql`delete from public.quarantine_files where media_id = any(${uuids(mediaIds)})`);
  if (alertsSince !== undefined) {
    await migrateDb.execute(sql`delete from public.alert_outbox where message_id is null and order_id is null and created_at >= ${alertsSince}::timestamptz`);
  }
}
