import { randomInt } from "node:crypto";
import { sql } from "drizzle-orm";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";

/**
 * Fixtures of the contact point and the alert channel (3f design, section 12): `contactMessageForTest` inserts a message on
 * korbat_notify's role, as the watcher would, through the test environment's fourth URL (DATABASE_URL_NOTIFY, which
 * assertTestTargets holds to a _test database). Every message a test makes has a validity number of its own, so no two
 * files' messages meet on the unique key; alert_outbox has no foreign keys, so a test finds its rows by its messages' ids
 * or by time, and removes both when it ends.
 */

let pool: Db | null = null;

/** The watcher's role's pool, made on first use; closeNotifyFixtures ends it. */
export function notifyDb(): Db {
  pool ??= createDb(process.env.DATABASE_URL_NOTIFY!, { max: 2 });
  return pool;
}

export async function closeNotifyFixtures(): Promise<void> {
  if (pool) await closeDb(pool);
  pool = null;
}

/** A validity number no other message of the run has: a random base, then counted. */
let validity = randomInt(1_000_000, 2_000_000_000);
export const nextValidity = () => ++validity;

/** A message as the watcher inserts it: its folder, its two numbers and its time of receipt; answers its id. */
export async function contactMessageForTest(receivedAt: Date, folder: "inbox" | "junk" = "inbox", numbers: { uidvalidity?: number; uid?: number } = {}): Promise<string> {
  const [row] = await notifyDb().execute<{ id: string }>(
    sql`insert into public.contact_messages (folder, uidvalidity, uid, received_at) values (${folder}, ${numbers.uidvalidity ?? nextValidity()}, ${numbers.uid ?? 1}, ${receivedAt.toISOString()}) returning id`,
  );
  return row!.id;
}

/** One row of alert_outbox as a test reads it, as the migrator. */
export type OutboxRow = {
  id: number;
  kind: string;
  priority: number;
  scope: string;
  step: number | null;
  facts: Record<string, number | string>;
  message_id: string | null;
  created_at: string;
  pushed_at: string | null;
  mailed_at: string | null;
  push_attempts: number;
};
/** The same as the driver answers it: a bigint id as text. */
type OutboxRaw = Omit<OutboxRow, "id"> & { id: string };

/** A message's rows of alert_outbox, oldest first. */
export async function outboxOf(db: Db | DbTx, messageId: string): Promise<OutboxRow[]> {
  const rows = await db.execute<OutboxRaw>(sql`select * from public.alert_outbox where message_id = ${messageId}::uuid order by id`);
  return rows.map((row) => ({ ...row, id: Number(row.id) }));
}

/** The rows of a kind created at or after a time, oldest first. */
export async function outboxSince(db: Db | DbTx, kind: string, since: Date): Promise<OutboxRow[]> {
  const rows = await db.execute<OutboxRaw>(sql`select * from public.alert_outbox where kind = ${kind} and created_at >= ${since.toISOString()}::timestamptz order by id`);
  return rows.map((row) => ({ ...row, id: Number(row.id) }));
}

/**
 * Moves a message back in time, as the migrator: its time of receipt, the time it was seen and its outbox rows' times, by
 * whole minutes. It is how a test meets an escalation or a deadline: every time is forced by a trigger, and no setting
 * shortens a number of order_rules().
 */
export async function ageMessageForTest(migrateDb: Db | DbTx, messageId: string, minutes: number): Promise<void> {
  await migrateDb.execute(sql`update public.contact_messages set received_at = received_at - make_interval(mins => ${minutes}), seen_at = seen_at - make_interval(mins => ${minutes}) where id = ${messageId}::uuid`);
  await migrateDb.execute(sql`update public.alert_outbox set created_at = created_at - make_interval(mins => ${minutes}) where message_id = ${messageId}::uuid`);
}

/** Removes messages and every outbox row that names them, as the migrator. */
export async function removeMessages(migrateDb: Db, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const list = sql`${`{${ids.join(",")}}`}::uuid[]`;
  await migrateDb.execute(sql`delete from public.alert_outbox where message_id = any(${list})`);
  await migrateDb.execute(sql`delete from public.contact_messages where id = any(${list})`);
}
