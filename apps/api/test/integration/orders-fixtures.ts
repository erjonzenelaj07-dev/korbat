import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { OrderChannel, OrderKind, OrderView } from "@korbat/contracts";
import type { Db, DbTx } from "@korbat/db";
import type { ActiveStaffSession, StaffStepUpConfirmed } from "../../src/auth";
import { loadConfig, type Config } from "../../src/config";
import pino from "pino";
import { createBackground } from "../../src/moderation/context";
import { openOrder } from "../../src/moderation/orders";
import { hex64, moderationDeps, uuids, type TestStaff } from "./moderation-fixtures";

/**
 * Fixtures of order records (3f design, section 12): `orderForTest` opens an order through the route's own code, from a
 * message or without one, and `ageOrderForTest` moves an order's times back, as the migrator: every time is forced by a
 * trigger, and no setting shortens a number of order_rules(), so it is the only way a test meets a deadline, a reminder
 * or a hold's end. The integration files that write orders add ORDER_TABLES to their row counts.
 */

/** The three tables of order records, which a suite that writes them adds to its row counts. */
export const ORDER_TABLES = ["legal_orders", "legal_order_items", "legal_order_events"] as const;

/** The configuration the order flows read: the test environment's, with Germany as the home state. */
export function orderConfig(overrides: Partial<Config> = {}): Config {
  return { ...loadConfig(), HOME_STATE: "DE", ...overrides };
}

/** A staff session as the staff routes hand one to the moderation module, for a test staff account. */
export function sessionOf(staff: TestStaff): ActiveStaffSession {
  const now = new Date();
  return {
    sessionId: hex64(),
    handle: randomUUID(),
    userId: staff.id,
    keyId: staff.keyId,
    role: staff.role,
    createdAt: now,
    lastUsedAt: now,
    idleExpiresAt: new Date(now.getTime() + 15 * 60_000),
    absoluteExpiresAt: new Date(now.getTime() + 12 * 60 * 60_000),
    browser: "Firefox on Linux",
  };
}

/**
 * A made-up confirmation of an order's action, as requireStaffStepUp hands it on: the hash and the assertion are
 * placeholders, so the audit row it leads to is only ever written in a transaction a test rolls back.
 */
export function orderConfirmation(staff: TestStaff, action: "order_event_recorded" | "order_corrected", orderId: string, params: Record<string, unknown>): StaffStepUpConfirmed {
  return {
    action,
    target: { type: "order", id: orderId },
    params,
    actionHash: hex64(),
    keyId: staff.keyId,
    assertion: { authenticatorData: "AAAA", clientDataJSON: "BBBB", signature: "CCCC" },
    expiresAt: new Date(Date.now() + 10 * 60_000),
  } as StaffStepUpConfirmed;
}

/** What an order opened for a test names; every member has a default. */
export interface OrderForTest {
  kind?: OrderKind;
  sectionC?: boolean;
  /** The posts its links name, by their pages on the app's origin. */
  posts?: readonly string[];
  /** Other links, as named. */
  links?: readonly string[];
  /** The message it came in, or null for "The message is not listed". */
  messageId?: string | null;
  channel?: OrderChannel;
  memberState?: "DE" | "FR" | "AT";
  authority?: string;
  reference?: string;
  withholdFromAuthor?: boolean;
  emergency?: boolean;
}

/**
 * Opens an order through the route's own code (openOrder), as the staff account, on the pool or the transaction given: on
 * a pool it commits, and the test removes it (removeOrders); on a transaction that the test rolls back nothing stays.
 * What follows the commit (the alert order_opened's row and its mail, which no address takes here) is awaited, so its row
 * is written before the answer and on the transaction while it is open.
 */
export async function orderForTest(db: Db | DbTx, staff: TestStaff, options: OrderForTest = {}): Promise<OrderView> {
  const config = orderConfig();
  const background = createBackground(pino({ level: "silent" }));
  const kind = options.kind ?? "tco_removal";
  const sectionC = options.sectionC ?? false;
  const links = [...(options.posts ?? []).map((id) => `${config.APP_ORIGIN}/post/${id}`), ...(options.links ?? [])];
  const messageId = options.messageId === undefined ? null : options.messageId;
  const view = await openOrder(
    moderationDeps(db, { config, background }),
    sessionOf(staff),
    {
      messageId,
      channel: options.channel ?? (messageId === null ? "portal" : "mailbox"),
      kind,
      memberState: options.memberState ?? "DE",
      authority: options.authority ?? "Bundeskriminalamt",
      reference: options.reference ?? `T-${randomUUID()}`,
      links,
      sectionC,
      emergency: options.emergency ?? false,
      withholdFromAuthor: options.withholdFromAuthor ?? (kind === "tco_removal" || sectionC),
    },
    { requestId: `req-${randomUUID()}` },
  );
  await background.settle();
  return view;
}

/**
 * Moves an order's times back by whole minutes, as the migrator: the order's own times, its items', its events', its
 * decisions', its message's and the outbox rows that name either. A test that ages committed rows runs it on the
 * migrator's pool; one inside a migrator's transaction that it rolls back, on that transaction.
 */
export async function ageOrderForTest(migrate: Db | DbTx, orderId: string, minutes: number): Promise<void> {
  const by = sql`make_interval(mins => ${minutes})`;
  await migrate.execute(sql`update public.legal_orders set received_at = received_at - ${by}, sent_at = sent_at - ${by}, issued_at = issued_at - ${by},
                                  due_at = due_at - ${by}, authority_hold_until = authority_hold_until - ${by}, hold_ended_at = hold_ended_at - ${by},
                                  tell_person_at = tell_person_at - ${by}, opened_at = opened_at - ${by}, verified_at = verified_at - ${by},
                                  closed_at = closed_at - ${by}, imported_at = imported_at - ${by}
                             where id = ${orderId}::uuid`);
  await migrate.execute(sql`update public.legal_order_items set added_at = added_at - ${by}, disabled_at = disabled_at - ${by}, preserve_until = preserve_until - ${by},
                                  preserve_ended_at = preserve_ended_at - ${by}, reinstated_at = reinstated_at - ${by}, closed_at = closed_at - ${by}
                             where order_id = ${orderId}::uuid`);
  await migrate.execute(sql`update public.legal_order_events set at = at - ${by}, effective_at = effective_at - ${by} where order_id = ${orderId}::uuid`);
  await migrate.execute(sql`update public.decisions set decided_at = decided_at - ${by}, informed_at = informed_at - ${by}
                             where order_item_id in (select id from public.legal_order_items where order_id = ${orderId}::uuid)`);
  await migrate.execute(sql`update public.contact_messages m set received_at = m.received_at - ${by}, seen_at = m.seen_at - ${by}, handled_at = m.handled_at - ${by}
                             from public.legal_orders o where o.id = ${orderId}::uuid and m.id = o.message_id`);
  await migrate.execute(sql`update public.alert_outbox set created_at = created_at - ${by}
                             where order_id = ${orderId}::uuid or message_id = (select message_id from public.legal_orders where id = ${orderId}::uuid)`);
}

/** Removes orders with their events, items and outbox rows, and the messages they came in with theirs, as the migrator. */
export async function removeOrders(migrateDb: Db | DbTx, orderIds: readonly string[]): Promise<void> {
  if (orderIds.length === 0) return;
  const ids = uuids(orderIds);
  const messages = await migrateDb.execute<{ id: string }>(sql`select message_id as id from public.legal_orders where id = any(${ids}) and message_id is not null`);
  await migrateDb.execute(sql`delete from public.alert_outbox where order_id = any(${ids})`);
  await migrateDb.execute(sql`delete from public.legal_order_events where order_id = any(${ids})`);
  await migrateDb.execute(sql`delete from public.legal_order_items where order_id = any(${ids})`);
  await migrateDb.execute(sql`delete from public.legal_orders where id = any(${ids})`);
  const messageIds = uuids(messages.map((row) => row.id));
  await migrateDb.execute(sql`delete from public.alert_outbox where message_id = any(${messageIds})`);
  await migrateDb.execute(sql`delete from public.contact_messages m where m.id = any(${messageIds}) and not exists (select 1 from public.legal_orders o where o.message_id = m.id)`);
}

/**
 * Removes the rows of the alerts an order's flows raised since a time, which name no subject (order_opened and
 * order_corrected, written by staffAlert after the commit), as the migrator: the files run one after another, so the rows
 * of a kind written since the file began are its own.
 */
export async function removeOrderAlerts(migrateDb: Db | DbTx, since: Date): Promise<void> {
  await migrateDb.execute(sql`delete from public.alert_outbox where kind in ('order_opened', 'order_corrected') and order_id is null and created_at >= ${since.toISOString()}::timestamptz`);
}

/** Marks an item disabled at a time, as the migrator: before the ledger's functions of Task 3 nothing else gives an order effect. */
export async function disableItemForTest(migrate: Db | DbTx, itemId: string, at: Date = new Date()): Promise<void> {
  await migrate.execute(sql`update public.legal_order_items set disabled_at = ${at.toISOString()}::timestamptz where id = ${itemId}::uuid`);
}
