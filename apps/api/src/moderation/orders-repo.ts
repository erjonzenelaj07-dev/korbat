import { sql } from "drizzle-orm";
import type { ContactDisposition, ContactFolder } from "@korbat/contracts";
import type { Db, DbTx } from "@korbat/db";

/**
 * The SQL of authorities' orders (3f design, section 5): in this task, the messages at the contact point, which the
 * watcher inserts and the console lists and closes. The API role reads every column of contact_messages and may update
 * only its disposition and who set it; the database forces when.
 */

type Querier = Pick<Db, "execute"> | Pick<DbTx, "execute">;

/** One message as the Contact point screen reads it, with its place in the list as text of microseconds for the cursor. */
export interface ContactRow {
  id: string;
  folder: ContactFolder;
  receivedAt: Date;
  /** received_at in UTC to the microsecond: the cursor's sort key. */
  place: string;
  seenAt: Date;
  stale: boolean;
  disposition: ContactDisposition | null;
  handledAt: Date | null;
  /** The handle of the staff member who handled it, or null. */
  handledBy: string | null;
}

/** A page of messages, newest first by the time of receipt, after the given place; only those without a disposition when `open`. */
export async function contactMessages(q: Querier, options: { open: boolean; after: { place: string; id: string } | null; limit: number }): Promise<ContactRow[]> {
  const after = options.after === null ? sql`true` : sql`(m.received_at, m.id) < (${options.after.place}::timestamptz, ${options.after.id}::uuid)`;
  const rows = await q.execute<{
    id: string;
    folder: ContactFolder;
    received_at: string;
    place: string;
    seen_at: string;
    stale: boolean;
    disposition: ContactDisposition | null;
    handled_at: string | null;
    handled_by: string | null;
  }>(sql`
    select m.id, m.folder, m.received_at, to_char(m.received_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as place,
           m.seen_at, m.stale, m.disposition, m.handled_at, p.handle as handled_by
      from public.contact_messages m
      left join public.profiles p on p.id = m.handled_by
     where ${after} and (not ${options.open} or m.disposition is null)
     order by m.received_at desc, m.id desc
     limit ${options.limit}`);
  return rows.map((row) => ({
    id: row.id,
    folder: row.folder,
    receivedAt: new Date(row.received_at),
    place: row.place,
    seenAt: new Date(row.seen_at),
    stale: row.stale,
    disposition: row.disposition,
    handledAt: row.handled_at === null ? null : new Date(row.handled_at),
    handledBy: row.handled_by,
  }));
}

/**
 * Sets a message's disposition and who set it, only while it has none: the trigger stamps when, and refuses any other
 * change. Answers the message's time of receipt and folder for the audit row, or null when no message without a
 * disposition has the id.
 */
export async function closeMessage(tx: DbTx, id: string, disposition: Exclude<ContactDisposition, "order">, staffId: string): Promise<{ receivedAt: Date; folder: ContactFolder } | null> {
  const [row] = await tx.execute<{ received_at: string; folder: ContactFolder }>(sql`
    update public.contact_messages set disposition = ${disposition}, handled_by = ${staffId}::uuid
     where id = ${id}::uuid and disposition is null
    returning received_at, folder`);
  return row ? { receivedAt: new Date(row.received_at), folder: row.folder } : null;
}

/** Whether a message has the id, whatever its disposition. */
export async function messageExists(q: Querier, id: string): Promise<boolean> {
  return (await q.execute(sql`select 1 from public.contact_messages where id = ${id}::uuid`)).length > 0;
}

/**
 * The home screen's counts of the contact point: the messages without a disposition, stale ones included, the oldest
 * one's time of receipt, and the earliest deadline among them, the time of receipt and order_rules().hour_minutes, also
 * once it has passed. Task 2 adds the orders' deadlines.
 */
export async function contactCounts(q: Querier): Promise<{ open: number; oldestAt: Date | null; dueAt: Date | null }> {
  const [row] = await q.execute<{ open: number; oldest_at: string | null; due_at: string | null }>(sql`
    select count(*)::int as open, min(m.received_at) as oldest_at,
           min(m.received_at) + make_interval(mins => (select r.hour_minutes from public.order_rules() r)) as due_at
      from public.contact_messages m
     where m.disposition is null`);
  return { open: row!.open, oldestAt: row!.oldest_at === null ? null : new Date(row!.oldest_at), dueAt: row!.due_at === null ? null : new Date(row!.due_at) };
}
