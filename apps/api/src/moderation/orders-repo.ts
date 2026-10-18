import { sql } from "drizzle-orm";
import type {
  Annex3Ground,
  ContactDisposition,
  ContactFolder,
  HoldEndReason,
  OrderChannel,
  OrderCloseGround,
  OrderConsoleEvent,
  OrderEventKind,
  OrderEventVia,
  OrderGround,
  OrderItemCloseReason,
  OrderKind,
  TellPersonRule,
} from "@korbat/contracts";
import type { Db, DbTx } from "@korbat/db";

/**
 * The SQL of authorities' orders (3f design, section 5): the messages at the contact point, which the watcher inserts and
 * the console lists and closes (the API role reads every column of contact_messages and may update only its disposition
 * and who set it; the database forces when), and the order records, their items and events (Task 2). The API role reads
 * every order and inserts the console's columns; the clock's events and the corrections go through the two definer
 * functions, bound to their audit rows.
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
 * once it has passed. The orders' deadlines are nearestOrderDeadline's.
 */
export async function contactCounts(q: Querier): Promise<{ open: number; oldestAt: Date | null; dueAt: Date | null }> {
  const [row] = await q.execute<{ open: number; oldest_at: string | null; due_at: string | null }>(sql`
    select count(*)::int as open, min(m.received_at) as oldest_at,
           min(m.received_at) + make_interval(mins => (select r.hour_minutes from public.order_rules() r)) as due_at
      from public.contact_messages m
     where m.disposition is null`);
  return { open: row!.open, oldestAt: row!.oldest_at === null ? null : new Date(row!.oldest_at), dueAt: row!.due_at === null ? null : new Date(row!.due_at) };
}

// ---------------------------------------------------------------- order records (3f design, sections 6.2, 7.4 and 7.5)

/** A timestamptz expression as ISO text in UTC, to the millisecond. The expression is written here, never input. */
const isoOf = (expression: string) => sql.raw(`to_char(${expression} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);
/** A list of uuids as a PostgreSQL array. */
const uuidList = (ids: readonly string[]) => sql`${`{${ids.join(",")}}`}::uuid[]`;

/** One link of a new order, with the post it resolved to (null when it named none). */
export interface NewOrderItem {
  link: string;
  postId: string | null;
}

/**
 * The rows of opening an order (section 7.4), which the console's route, `staff.js order-open` and the import all write
 * through insertOrder. `openedBy` is the opening staff account, null from the command line; `cli` carries what only the
 * migrator may write (the receipt and the sending time a channel states), and is absent for the console, whose insert
 * names the console's columns alone and lets the trigger force the rest.
 */
export interface NewOrder {
  id: string;
  kind: OrderKind;
  memberState: string;
  authority: string;
  reference: string;
  channel: OrderChannel;
  messageId: string | null;
  sectionC: boolean;
  emergency: boolean;
  crossBorder: boolean;
  withholdFromAuthor: boolean;
  openedBy: string | null;
  items: readonly NewOrderItem[];
  cli?: { receivedAt: Date | null; sentAt: Date | null };
}

/** An item as written: its id, position, the time the database stamped, and what it names. */
export interface WrittenItem {
  id: string;
  position: number;
  addedAt: Date;
  link: string;
  postId: string | null;
}

/** What opening an order wrote, as its audit row and its alert need it. */
export interface InsertedOrder {
  id: string;
  openedAt: Date;
  receivedAt: Date | null;
  sentAt: Date | null;
  channel: OrderChannel;
  withholdFromAuthor: boolean;
  items: WrittenItem[];
}

/** Inserts items at the next positions of an order, in the order given, and answers them. */
async function insertItems(tx: DbTx, orderId: string, items: readonly NewOrderItem[], from: number): Promise<WrittenItem[]> {
  const written: WrittenItem[] = [];
  for (const [index, item] of items.entries()) {
    const [row] = await tx.execute<{ id: string; position: number; added_at: string }>(sql`
      insert into public.legal_order_items (id, order_id, position, link, post_id)
      values (gen_random_uuid(), ${orderId}::uuid, ${from + index}::smallint, ${item.link}, ${item.postId}::uuid)
      returning id, position, ${isoOf("added_at")} as added_at`);
    written.push({ id: row!.id, position: row!.position, addedAt: new Date(row!.added_at), link: item.link, postId: item.postId });
  }
  return written;
}

/**
 * The rows of opening an order, in the caller's transaction (section 7.4 step 4): the order's row (the trigger forces
 * when and how it was opened, the receipt from the message and the withholding), one item a link from position 1, the
 * event `opened`, and the message's disposition `order` when one is named and has none (a message closed as something
 * else keeps its word). The audit row is the caller's, last. A plain function of the module's index: it takes the
 * caller's transaction and no dependency, so the command line, as the migrator, writes the same rows. The migrator's
 * insert passes the triggers' forcing, so it supplies its own `opened_via`, its event's `via` and the message's time.
 */
export async function insertOrder(tx: DbTx, order: NewOrder): Promise<InsertedOrder> {
  const cli = order.cli;
  const [row] =
    cli === undefined
      ? await tx.execute<{ opened_at: string; received_at: string | null; sent_at: string | null; channel: OrderChannel; withhold_from_author: boolean }>(sql`
          insert into public.legal_orders (id, kind, member_state, authority, reference, channel, message_id, section_c, emergency, cross_border, withhold_from_author, opened_by)
          values (${order.id}::uuid, ${order.kind}, ${order.memberState}, ${order.authority}, ${order.reference}, ${order.channel}, ${order.messageId}::uuid,
                  ${order.sectionC}::boolean, ${order.emergency}::boolean, ${order.crossBorder}::boolean, ${order.withholdFromAuthor}::boolean, ${order.openedBy}::uuid)
          returning ${isoOf("opened_at")} as opened_at, ${isoOf("received_at")} as received_at, ${isoOf("sent_at")} as sent_at, channel, withhold_from_author`)
      : await tx.execute<{ opened_at: string; received_at: string | null; sent_at: string | null; channel: OrderChannel; withhold_from_author: boolean }>(sql`
          insert into public.legal_orders (id, kind, member_state, authority, reference, channel, message_id, section_c, emergency, cross_border, withhold_from_author,
                                           opened_by, opened_via, received_at, sent_at)
          values (${order.id}::uuid, ${order.kind}, ${order.memberState}, ${order.authority}, ${order.reference}, ${order.channel}, ${order.messageId}::uuid,
                  ${order.sectionC}::boolean, ${order.emergency}::boolean, ${order.crossBorder}::boolean, ${order.withholdFromAuthor}::boolean, ${order.openedBy}::uuid,
                  'cli', ${cli.receivedAt?.toISOString() ?? null}::timestamptz, ${cli.sentAt?.toISOString() ?? null}::timestamptz)
          returning ${isoOf("opened_at")} as opened_at, ${isoOf("received_at")} as received_at, ${isoOf("sent_at")} as sent_at, channel, withhold_from_author`);
  const items = await insertItems(tx, order.id, order.items, 1);
  // The event `opened`: the API role's insert is forced to the console, the clock and the opening account; the migrator's
  // is the command line's.
  await tx.execute(sql`insert into public.legal_order_events (order_id, kind, by_staff, via) values (${order.id}::uuid, 'opened', ${order.openedBy}::uuid, ${cli === undefined ? "console" : "cli"})`);
  if (order.messageId !== null) {
    // The trigger stamps when for the API role; the migrator, whom it does not touch, stamps it here.
    await tx.execute(
      cli === undefined
        ? sql`update public.contact_messages set disposition = 'order', handled_by = ${order.openedBy}::uuid where id = ${order.messageId}::uuid and disposition is null`
        : sql`update public.contact_messages set disposition = 'order', handled_at = now() where id = ${order.messageId}::uuid and disposition is null`,
    );
  }
  return {
    id: order.id,
    openedAt: new Date(row!.opened_at),
    receivedAt: row!.received_at === null ? null : new Date(row!.received_at),
    sentAt: row!.sent_at === null ? null : new Date(row!.sent_at),
    channel: row!.channel,
    withholdFromAuthor: row!.withhold_from_author,
    items,
  };
}

/** Adds items to an order after its last position (section 7.4, "More items"); the caller holds the order's advisory lock. */
export async function addOrderItems(tx: DbTx, orderId: string, items: readonly NewOrderItem[]): Promise<WrittenItem[]> {
  const [last] = await tx.execute<{ position: number }>(sql`select coalesce(max(position), 0)::int as position from public.legal_order_items where order_id = ${orderId}::uuid`);
  return insertItems(tx, orderId, items, last!.position + 1);
}

/** The posts of these ids that a row of posts has, in any state. */
export async function existingPosts(q: Querier, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const found = await q.execute<{ id: string }>(sql`select id from public.posts where id = any(${uuidList(ids)})`);
  return new Set(found.map((row) => row.id));
}

/**
 * How many orders the account opened in the last 24 hours by the database's clock, and in how many seconds the oldest of
 * them leaves that window (section 7.4 step 1); the insert's trigger counts again under the account's lock.
 */
export async function ordersOpenedToday(q: Querier, staffId: string): Promise<{ count: number; retryAfterSeconds: number }> {
  const [row] = await q.execute<{ count: number; retry: number | null }>(sql`
    select count(*)::int as count,
           ceil(extract(epoch from min(opened_at) + make_interval(days => 1) - clock_timestamp()))::int as retry
      from public.legal_orders where opened_by = ${staffId}::uuid and opened_at > clock_timestamp() - make_interval(days => 1)`);
  return { count: row!.count, retryAfterSeconds: Math.max(1, row!.retry ?? 1) };
}

/** The order of this issuing state, authority and reference, which the unique key names. */
export async function orderByReference(q: Querier, memberState: string, authority: string, reference: string): Promise<string | null> {
  const [row] = await q.execute<{ id: string }>(sql`select id from public.legal_orders where member_state = ${memberState} and authority = ${authority} and reference = ${reference}`);
  return row?.id ?? null;
}

/** An order's row as the console's reads need it: the facts, the hold's columns and what the command line recorded. */
export interface OrderRow {
  id: string;
  kind: OrderKind;
  memberState: string;
  authority: string;
  reference: string;
  channel: OrderChannel;
  messageId: string | null;
  receivedAt: string | null;
  sentAt: string | null;
  issuedAt: string | null;
  dueAt: string | null;
  sectionC: boolean;
  emergency: boolean;
  crossBorder: boolean;
  withholdFromAuthor: boolean;
  preserve: boolean;
  holdExtended: boolean;
  holdEndedAt: string | null;
  holdEndReason: HoldEndReason | null;
  tellPerson: TellPersonRule | null;
  tellPersonAt: string | null;
  openedBy: string | null;
  openedVia: "console" | "cli";
  openedAt: string;
  verifiedAt: string | null;
  hasReasons: boolean;
  hasRedress: boolean;
  hasScope: boolean;
  hasDocument: boolean;
  closedAt: string | null;
  importedAt: string | null;
  /** order_hold_until: null without Section C, 'infinity' as null with `holdOpen`. */
  holdUntil: string | null;
  holdOpen: boolean;
  closeGround: OrderCloseGround | null;
  /** The newest notice_released event's time. */
  releasedAt: string | null;
  /** Whether a scrutiny was requested. */
  scrutinyRequested: boolean;
  items: number;
  itemsInForce: number;
  /** Decisions of the order whose author was not told. */
  noticesHeld: number;
  /** An item of the order is disabled, or was. */
  givenEffect: boolean;
  /** Items neither disabled nor closed with a reason, for every kind of order. */
  itemsOpen: number;
  /** An item added after the verification, or any item while the order is not verified. */
  itemsUnverified: boolean;
  clock: OrderClockRow | null;
  /** The database's clock when the row was read. */
  now: string;
}

/** One row of legal_order_clock, with the newest Annex III's time and ground while the clock is stopped. */
export interface OrderClockRow {
  clockStart: string | null;
  stopped: boolean;
  stoppedAt: string | null;
  stopGround: Annex3Ground | null;
  deadlineAt: string | null;
  targetAt: string | null;
  itemsOpen: number;
  firstEffectAt: string | null;
  lastEffectAt: string | null;
  withinHour: boolean | null;
}

/** The orders the filter selects, with every fact the list and the order's screen print. */
async function orderRowsWhere(q: Querier, where: ReturnType<typeof sql>): Promise<OrderRow[]> {
  const found = await q.execute<Record<string, unknown>>(sql`
    select o.id, o.kind, o.member_state, o.authority, o.reference, o.channel, o.message_id,
           ${isoOf("o.received_at")} as received_at, ${isoOf("o.sent_at")} as sent_at, ${isoOf("o.issued_at")} as issued_at, ${isoOf("o.due_at")} as due_at,
           o.section_c, o.emergency, o.cross_border, o.withhold_from_author, o.preserve, o.hold_extended,
           ${isoOf("o.hold_ended_at")} as hold_ended_at, o.hold_end_reason, o.tell_person, ${isoOf("o.tell_person_at")} as tell_person_at,
           p.handle as opened_by, o.opened_via, ${isoOf("o.opened_at")} as opened_at, ${isoOf("o.verified_at")} as verified_at,
           o.reasons is not null as has_reasons, o.redress is not null as has_redress, o.scope is not null as has_scope, o.document_sha256 is not null as has_document,
           ${isoOf("o.closed_at")} as closed_at, ${isoOf("o.imported_at")} as imported_at,
           case when h.until = 'infinity'::timestamptz then null else ${isoOf("h.until")} end as hold_until,
           coalesce(h.until = 'infinity'::timestamptz, false) as hold_open,
           case when o.closed_at is null then null else
             (select e.ground from public.legal_order_events e where e.order_id = o.id and e.kind = 'closed_without_effect' order by e.at desc, e.id desc limit 1) end as close_ground,
           (select ${isoOf("max(e.at)")} from public.legal_order_events e where e.order_id = o.id and e.kind = 'notice_released') as released_at,
           exists (select 1 from public.legal_order_events e where e.order_id = o.id and e.kind = 'scrutiny_requested') as scrutiny_requested,
           (select count(*)::int from public.legal_order_items i where i.order_id = o.id) as items,
           (select count(*)::int from public.legal_order_items i join public.measures_in_force m on m.id = i.action_id where i.order_id = o.id) as items_in_force,
           (select count(*)::int from public.legal_order_items i join public.decisions d on d.order_item_id = i.id where i.order_id = o.id and d.informed_at is null) as notices_held,
           exists (select 1 from public.legal_order_items i where i.order_id = o.id and i.disabled_at is not null) as given_effect,
           (select count(*)::int from public.legal_order_items i where i.order_id = o.id and i.disabled_at is null and i.closed_at is null) as items_open_all,
           exists (select 1 from public.legal_order_items i where i.order_id = o.id and (o.verified_at is null or i.added_at > o.verified_at)) as items_unverified,
           c.order_id is not null as has_clock, ${isoOf("c.clock_start")} as clock_start, c.stopped, ${isoOf("c.deadline_at")} as deadline_at, ${isoOf("c.target_at")} as target_at,
           c.items_open, ${isoOf("c.first_effect_at")} as first_effect_at, ${isoOf("c.last_effect_at")} as last_effect_at, c.within_hour,
           case when c.stopped then (select ${isoOf("a.at")} from public.legal_order_events a where a.order_id = o.id and a.kind = 'annex3_sent' order by a.at desc, a.id desc limit 1) end as stopped_at,
           case when c.stopped then (select a.ground from public.legal_order_events a where a.order_id = o.id and a.kind = 'annex3_sent' order by a.at desc, a.id desc limit 1) end as stop_ground,
           ${isoOf("clock_timestamp()")} as now
      from public.legal_orders o
      left join public.profiles p on p.id = o.opened_by
      left join public.legal_order_clock c on c.order_id = o.id
      cross join lateral (select public.order_hold_until(o.id) as until) h
     where ${where}`);
  return found.map((r) => ({
    id: r.id as string,
    kind: r.kind as OrderKind,
    memberState: r.member_state as string,
    authority: r.authority as string,
    reference: r.reference as string,
    channel: r.channel as OrderChannel,
    messageId: r.message_id as string | null,
    receivedAt: r.received_at as string | null,
    sentAt: r.sent_at as string | null,
    issuedAt: r.issued_at as string | null,
    dueAt: r.due_at as string | null,
    sectionC: r.section_c as boolean,
    emergency: r.emergency as boolean,
    crossBorder: r.cross_border as boolean,
    withholdFromAuthor: r.withhold_from_author as boolean,
    preserve: r.preserve as boolean,
    holdExtended: r.hold_extended as boolean,
    holdEndedAt: r.hold_ended_at as string | null,
    holdEndReason: r.hold_end_reason as HoldEndReason | null,
    tellPerson: r.tell_person as TellPersonRule | null,
    tellPersonAt: r.tell_person_at as string | null,
    openedBy: r.opened_by as string | null,
    openedVia: r.opened_via as "console" | "cli",
    openedAt: r.opened_at as string,
    verifiedAt: r.verified_at as string | null,
    hasReasons: r.has_reasons as boolean,
    hasRedress: r.has_redress as boolean,
    hasScope: r.has_scope as boolean,
    hasDocument: r.has_document as boolean,
    closedAt: r.closed_at as string | null,
    importedAt: r.imported_at as string | null,
    holdUntil: r.hold_until as string | null,
    holdOpen: r.hold_open as boolean,
    closeGround: r.close_ground as OrderCloseGround | null,
    releasedAt: r.released_at as string | null,
    scrutinyRequested: r.scrutiny_requested as boolean,
    items: r.items as number,
    itemsInForce: r.items_in_force as number,
    noticesHeld: r.notices_held as number,
    givenEffect: r.given_effect as boolean,
    itemsOpen: r.items_open_all as number,
    itemsUnverified: r.items_unverified as boolean,
    clock: r.has_clock
      ? {
          clockStart: r.clock_start as string | null,
          stopped: r.stopped as boolean,
          stoppedAt: r.stopped_at as string | null,
          stopGround: r.stop_ground as Annex3Ground | null,
          deadlineAt: r.deadline_at as string | null,
          targetAt: r.target_at as string | null,
          itemsOpen: r.items_open as number,
          firstEffectAt: r.first_effect_at as string | null,
          lastEffectAt: r.last_effect_at as string | null,
          withinHour: r.within_hour as boolean | null,
        }
      : null,
    now: r.now as string,
  }));
}

/** One order's row, or null. */
export async function orderRow(q: Querier, id: string): Promise<OrderRow | null> {
  const [row] = await orderRowsWhere(q, sql`o.id = ${id}::uuid`);
  return row ?? null;
}

/** The orders that are not closed, and those closed in the last 30 days (section 7.5). */
export async function orderRows(q: Querier): Promise<OrderRow[]> {
  return orderRowsWhere(q, sql`(o.closed_at is null or o.closed_at > clock_timestamp() - make_interval(days => 30))`);
}

/** One item of an order with what it named, read live, and what became of it. */
export interface OrderItemRow {
  id: string;
  position: number;
  link: string;
  postId: string | null;
  addedAt: string;
  decisionId: string | null;
  caseId: string | null;
  inForce: boolean;
  disabledAt: string | null;
  noEffect: "deleted" | "already" | null;
  preserveUntil: string | null;
  preserveEndedAt: string | null;
  reinstatedAt: string | null;
  reinstatedGround: OrderGround | null;
  closedAt: string | null;
  closedReason: OrderItemCloseReason | null;
  /** The post as it stands now, when a row of posts has the item's post. */
  post: { authorHandle: string | null; state: string; body: string; createdAt: string; deletedOn: string | null } | null;
}

/** An order's items in position order, each with its post read live. */
export async function orderItems(q: Querier, orderId: string): Promise<OrderItemRow[]> {
  const found = await q.execute<Record<string, unknown>>(sql`
    select i.id, i.position, i.link, i.post_id, ${isoOf("i.added_at")} as added_at, i.decision_id, d.case_id,
           exists (select 1 from public.measures_in_force m where m.id = i.action_id) as in_force,
           ${isoOf("i.disabled_at")} as disabled_at, a.no_effect, ${isoOf("i.preserve_until")} as preserve_until, ${isoOf("i.preserve_ended_at")} as preserve_ended_at,
           ${isoOf("i.reinstated_at")} as reinstated_at,
           (select e.ground from public.legal_order_events e where e.item_id = i.id and e.kind = 'reinstated' order by e.at desc, e.id desc limit 1) as reinstated_ground,
           ${isoOf("i.closed_at")} as closed_at, i.closed_reason,
           p.id is not null as has_post, a2.handle as author_handle, p.state::text as post_state, p.body, ${isoOf("p.created_at")} as post_created_at,
           to_char(p.deleted_at at time zone 'UTC', 'YYYY-MM-DD') as deleted_on
      from public.legal_order_items i
      left join public.decisions d on d.id = i.decision_id
      left join public.decision_actions a on a.id = i.action_id
      left join public.posts p on p.id = i.post_id
      left join public.profiles a2 on a2.id = p.author_id
     where i.order_id = ${orderId}::uuid
     order by i.position`);
  return found.map((r) => ({
    id: r.id as string,
    position: r.position as number,
    link: r.link as string,
    postId: r.post_id as string | null,
    addedAt: r.added_at as string,
    decisionId: r.decision_id as string | null,
    caseId: r.case_id as string | null,
    inForce: r.in_force as boolean,
    disabledAt: r.disabled_at as string | null,
    noEffect: r.no_effect as "deleted" | "already" | null,
    preserveUntil: r.preserve_until as string | null,
    preserveEndedAt: r.preserve_ended_at as string | null,
    reinstatedAt: r.reinstated_at as string | null,
    reinstatedGround: r.reinstated_ground as OrderGround | null,
    closedAt: r.closed_at as string | null,
    closedReason: r.closed_reason as OrderItemCloseReason | null,
    post: r.has_post
      ? { authorHandle: r.author_handle as string | null, state: r.post_state as string, body: r.body as string, createdAt: r.post_created_at as string, deletedOn: r.deleted_on as string | null }
      : null,
  }));
}

/** One event of an order, oldest first, with who wrote it as a staff handle. */
export interface OrderEventRow {
  id: string;
  kind: OrderEventKind;
  ground: string | null;
  at: string;
  effectiveAt: string | null;
  itemId: string | null;
  by: string | null;
  via: OrderEventVia;
}

export async function orderEvents(q: Querier, orderId: string): Promise<OrderEventRow[]> {
  const found = await q.execute<Record<string, unknown>>(sql`
    select e.id, e.kind, e.ground, ${isoOf("e.at")} as at, ${isoOf("e.effective_at")} as effective_at, e.item_id, p.handle as by, e.via
      from public.legal_order_events e left join public.profiles p on p.id = e.by_staff
     where e.order_id = ${orderId}::uuid order by e.at, e.id`);
  return found.map((r) => ({
    id: r.id as string,
    kind: r.kind as OrderEventKind,
    ground: r.ground as string | null,
    at: r.at as string,
    effectiveAt: r.effective_at as string | null,
    itemId: r.item_id as string | null,
    by: r.by as string | null,
    via: r.via as OrderEventVia,
  }));
}

/** An event's effective time, as its audit row records it. */
export async function eventEffectiveAt(q: Querier, eventId: string): Promise<string | null> {
  const [row] = await q.execute<{ effective_at: string | null }>(sql`select ${isoOf("effective_at")} as effective_at from public.legal_order_events where id = ${eventId}::uuid`);
  return row?.effective_at ?? null;
}

/** The ground of an event, which for `corrected` is the rule that allowed the correction. */
export async function eventGround(q: Querier, eventId: string): Promise<string | null> {
  const [row] = await q.execute<{ ground: string | null }>(sql`select ground from public.legal_order_events where id = ${eventId}::uuid`);
  return row?.ground ?? null;
}

/** order_event_record, as its owner, for the acting account (section 6.2): answers the event's id. */
export async function recordOrderEvent(tx: DbTx, orderId: string, kind: OrderConsoleEvent, ground: string | null, messageId: string | null, byStaff: string): Promise<string> {
  const [row] = await tx.execute<{ id: string }>(
    sql`select public.order_event_record(${orderId}::uuid, ${kind}::text, ${ground}::text, ${messageId}::uuid, ${byStaff}::uuid) as id`,
  );
  return row!.id;
}

/** order_correct, as its owner, for the acting account (section 6.2): answers the event's id. */
export async function correctOrder(tx: DbTx, orderId: string, facts: Record<string, unknown>, byStaff: string): Promise<string> {
  const [row] = await tx.execute<{ id: string }>(sql`select public.order_correct(${orderId}::uuid, ${JSON.stringify(facts)}::text::jsonb, ${byStaff}::uuid) as id`);
  return row!.id;
}

/** The authors of the posts an order disabled, which a correction after effect locks first (section 5, the lock order, item 2). */
export async function disabledAuthors(q: Querier, orderId: string): Promise<string[]> {
  const found = await q.execute<{ author_id: string }>(sql`
    select distinct p.author_id from public.legal_order_items i join public.posts p on p.id = i.post_id
     where i.order_id = ${orderId}::uuid and i.disabled_at is not null order by p.author_id`);
  return found.map((row) => row.author_id);
}

/** The orders opened from each of these messages. */
export async function ordersOfMessages(q: Querier, messageIds: readonly string[]): Promise<Map<string, string[]>> {
  const orders = new Map<string, string[]>();
  if (messageIds.length === 0) return orders;
  const found = await q.execute<{ message_id: string; id: string }>(
    sql`select message_id, id from public.legal_orders where message_id = any(${uuidList(messageIds)}) order by opened_at, id`,
  );
  for (const row of found) orders.set(row.message_id, [...(orders.get(row.message_id) ?? []), row.id]);
  return orders;
}

/**
 * The earliest deadline of an order that still has an open item (section 10.2, StaffOverview.contact.dueAt), also once
 * it has passed: a removal order's running clock, or a DSA order's deadline as its text states it. Null when none runs.
 */
export async function nearestOrderDeadline(q: Querier): Promise<Date | null> {
  const [row] = await q.execute<{ due_at: string | null }>(sql`
    select min(d.due) as due_at from (
      select c.deadline_at as due from public.legal_order_clock c join public.legal_orders o on o.id = c.order_id
       where o.closed_at is null and not c.stopped and c.deadline_at is not null and c.items_open > 0
      union all
      select o.due_at from public.legal_orders o
       where o.closed_at is null and o.kind <> 'tco_removal' and o.due_at is not null
         and exists (select 1 from public.legal_order_items i where i.order_id = o.id and i.disabled_at is null and i.closed_at is null)) d`);
  return row?.due_at ? new Date(row.due_at) : null;
}

// ---------------------------------------------------------------- giving effect (Task 3, section 7.6)

/** An order's item as the effect reads it before its transaction: the post it names and what became of it. */
export interface EffectItemRow {
  id: string;
  postId: string | null;
  inForce: boolean;
}

/** The order's items of these ids (the effect compares each with what the key signed). */
export async function effectItems(q: Querier, orderId: string, itemIds: readonly string[]): Promise<EffectItemRow[]> {
  const found = await q.execute<{ id: string; post_id: string | null; in_force: boolean }>(sql`
    select i.id, i.post_id, exists (select 1 from public.measures_in_force m where m.id = i.action_id) as in_force
      from public.legal_order_items i where i.order_id = ${orderId}::uuid and i.id = any(${uuidList(itemIds)})`);
  return found.map((row) => ({ id: row.id, postId: row.post_id, inForce: row.in_force }));
}

/** The intake item an effect inserted for an order's item: the API role may write that one column, which decisions_record does not trust. */
export async function setItemIntake(tx: DbTx, itemId: string, intakeItemId: string): Promise<void> {
  await tx.execute(sql`update public.legal_order_items set intake_item_id = ${intakeItemId}::uuid where id = ${itemId}::uuid`);
}

/** A case's version as it stands in this transaction, which an order decision names as the version it saw. */
export async function caseVersion(tx: DbTx, caseId: string): Promise<number> {
  const [row] = await tx.execute<{ state_version: number }>(sql`select state_version from public.cases where id = ${caseId}::uuid`);
  return row!.state_version;
}

/**
 * An order decision's row (7.6 step 5.2): its item, the case's version, the law as its ground, no rule and no text of
 * korbat's, the texts' versions the API serves, and the snapshot this transaction took. The triggers force the source,
 * the category and keyword, whether it needs an admin, and whether its author is told now or at the hold's end.
 */
export async function insertOrderDecision(
  tx: DbTx,
  row: { id: string; caseId: string; itemId: string; stateVersion: number; rulesVersion: number; redressVersion: number; category: string; keyword: string | null; snapshotId: string; snapshotDigest: string; decidedBy: string },
): Promise<void> {
  await tx.execute(
    sql`insert into decisions (id, case_id, kind, order_item_id, seen_state_version, through_seq, outcome, ground, rule_id, rules_version, redress_version, category, category_keyword,
                               snapshot_id, snapshot_digest, facts_digest, reason_digest, legal_reference_digest, decided_by)
        values (${row.id}::uuid, ${row.caseId}::uuid, 'order'::decision_kind, ${row.itemId}::uuid, ${row.stateVersion}::int, 0, 'restricted'::decision_outcome,
                'illegal'::decision_ground, null, ${row.rulesVersion}::smallint, ${row.redressVersion}::smallint, ${row.category}, ${row.keyword},
                ${row.snapshotId}::uuid, ${row.snapshotDigest}, null, null, null, ${row.decidedBy}::uuid)`,
  );
}

/**
 * Home's [home.unverified] (10.2): the orders that are not closed and have a disabled item while the order is not
 * verified, or a disabled item added after the check, each with its first disabling, oldest first.
 */
export async function unverifiedOrders(q: Querier, limit: number): Promise<{ total: number; items: { orderId: string; effectAt: string }[] }> {
  const found = await q.execute<{ id: string; effect_at: string; total: number }>(sql`
    select o.id, ${isoOf("min(i.disabled_at)")} as effect_at, (count(*) over ())::int as total
      from public.legal_orders o join public.legal_order_items i on i.order_id = o.id and i.disabled_at is not null
     where o.closed_at is null and (o.verified_at is null or i.added_at > o.verified_at)
     group by o.id order by min(i.disabled_at), o.id limit ${limit}`);
  return { total: found[0]?.total ?? 0, items: found.map((row) => ({ orderId: row.id, effectAt: row.effect_at })) };
}

/**
 * Whether an order's notice about this post is held (8.6, CaseView.noticeHeld): an untold order decision about it whose
 * measure is in force, with the earliest end of such a hold, null while it has none recorded ('infinity'); null when no
 * notice is held. The same test as the database's order_notice_held.
 */
export async function noticeHeldOn(q: Querier, postId: string): Promise<{ until: string | null } | null> {
  const [row] = await q.execute<{ held: boolean; until: string | null; open: boolean }>(sql`
    select count(*) > 0 as held,
           ${isoOf("min(public.order_hold_until(i.order_id)) filter (where public.order_hold_until(i.order_id) < 'infinity'::timestamptz)")} as until,
           bool_or(public.order_hold_until(i.order_id) = 'infinity'::timestamptz) as open
      from public.measures_in_force m
      join public.decisions d on d.id = m.decision_id and d.kind::text = 'order' and d.informed_at is null
      join public.legal_order_items i on i.id = d.order_item_id
     where m.post_id = ${postId}::uuid and m.kind::text = 'disable_by_order'`);
  if (!row?.held) return null;
  return { until: row.open ? null : row.until };
}

/**
 * The order members of a case's ledger rows (10.2, CaseDecisionAction): for a disable_by_order its order and whether it
 * keeps the post from its author, for a reinstatement its ground; rows of other kinds are not in the answer.
 */
export async function caseOrderFacts(q: Querier, caseId: string): Promise<Map<string, { orderId?: string; withholdAuthor?: boolean; orderGround?: OrderGround }>> {
  const found = await q.execute<{ id: string; order_id: string | null; withhold_author: boolean | null; order_ground: string | null }>(sql`
    select a.id, i.order_id, a.withhold_author, a.order_ground
      from public.decision_actions a join public.decisions d on d.id = a.decision_id
      left join public.legal_order_items i on i.id = d.order_item_id
     where d.case_id = ${caseId}::uuid and a.kind::text in ('disable_by_order', 'reinstate_by_order')`);
  const facts = new Map<string, { orderId?: string; withholdAuthor?: boolean; orderGround?: OrderGround }>();
  for (const row of found) {
    facts.set(row.id, {
      ...(row.order_id !== null ? { orderId: row.order_id } : {}),
      ...(row.withhold_author !== null ? { withholdAuthor: row.withhold_author } : {}),
      ...(row.order_ground !== null ? { orderGround: row.order_ground as OrderGround } : {}),
    });
  }
  return facts;
}

/** Whether a post is preserved for an order now: the database's one predicate, post_preserved. */
export async function postPreserved(q: Querier, postId: string): Promise<boolean> {
  const [row] = await q.execute<{ preserved: boolean }>(sql`select public.post_preserved(${postId}::uuid) as preserved`);
  return row?.preserved ?? false;
}

/** order_notices_release(), as its owner: how many decisions it told (section 6.3). */
export async function releaseHeldNotices(tx: DbTx): Promise<number> {
  const [row] = await tx.execute<{ told: number }>(sql`select public.order_notices_release() as told`);
  return row?.told ?? 0;
}
