import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  CONTACT_PAGE_SIZE,
  ORDER_ITEMS_MAX,
  ORDER_ITEM_PREVIEW,
  ORDER_RULES,
  ORDER_DECISION,
  ORDER_SCRUTINY_HOURS,
  OrderEffectedParams,
  OrderEventRecordedParams,
  type AlertFacts,
  type ContactCloseRequest,
  type ContactPage,
  type ContactQuery,
  type OrderConsoleEvent,
  type OrderCorrectFacts,
  type OrderItemView,
  type OrderItemsRequest,
  type OrderLinkKind,
  type OrderOpenRequest,
  type OrderState,
  type OrderSummary,
  type OrderView,
  type OrdersPage,
  type StaffOverview,
} from "@korbat/contracts";
import type { Db, DbTx } from "@korbat/db";
import type { ActiveStaffSession, StaffStepUpConfirmed } from "../auth";
import { boundLockWaits, isBoundReached, isDeadlock } from "../lib/lock-bounds";
import { imageCounts, imagePost } from "../media";
import { appendAuditRow } from "../staff";
import { staffAlert } from "./alerts";
import { ModerationError, isModerationErrorCode, type ModerationDeps } from "./context";
import { REDRESS_VERSION, RULES_VERSION } from "@korbat/rules";
import { RETRY_MARGIN_MS, afterDecision } from "./decide";
import { newRef, storeSnapshot } from "./intake";
import { orderLinkTarget } from "./links";
import {
  addOrderItems,
  caseVersion,
  closeMessage,
  contactCounts,
  contactMessages,
  correctOrder,
  disabledAuthors,
  effectItems,
  eventEffectiveAt,
  eventGround,
  existingPosts,
  insertOrder,
  insertOrderDecision,
  messageExists,
  nearestOrderDeadline,
  orderByReference,
  orderEvents,
  orderItems,
  orderRow,
  orderRows,
  ordersOfMessages,
  ordersOpenedToday,
  recordOrderEvent,
  setItemIntake,
  type InsertedOrder,
  type NewOrderItem,
  type OrderRow,
  type WrittenItem,
} from "./orders-repo";
import { itemsWithOpenGaps, openEffectGaps } from "./gaps";
import { appendConfirmedAudit, closeGap, insertAction, insertIntake, insertItem, isSerializationFailure, openCase, raisedDetail, raisedMessage, snapshotTime, violatedUniqueConstraint } from "./repo";

/**
 * Authorities' orders (3f design, sections 5, 7.3 and 8.3). In this task: the messages at the contact point. The watcher
 * records that a message arrived and when, and never who sent it or what it says; a person reads it in the mail host's own
 * app, and then either opens an order from it (Task 2) or closes it here with what it was. Closing restricts nothing and
 * tells nobody, so it needs no key: one transaction, the disposition and then the audit row `contact_closed`.
 */

const PLACE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The list's cursor: the last row's time of receipt to the microsecond and its id, as an opaque word. */
const encodeCursor = (row: { place: string; id: string }): string => Buffer.from(JSON.stringify([row.place, row.id]), "utf8").toString("base64url");

/** Reads a cursor back; anything this module did not write is refused, never guessed at. */
function decodeCursor(cursor: string): { place: string; id: string } {
  let parts: unknown;
  try {
    parts = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new ModerationError("invalid_request");
  }
  if (!Array.isArray(parts) || parts.length !== 2) throw new ModerationError("invalid_request");
  const [place, id] = parts as unknown[];
  if (typeof place !== "string" || !PLACE.test(place) || typeof id !== "string" || !UUID.test(id)) throw new ModerationError("invalid_request");
  return { place, id };
}

/**
 * GET /api/staff/contact: the messages newest first by the time of receipt, CONTACT_PAGE_SIZE a page; with open=1 only
 * those without a disposition. No sender and no subject exist to show. Each carries the orders opened from it.
 */
export async function contactPage(deps: Pick<ModerationDeps, "apiDb">, query: ContactQuery): Promise<ContactPage> {
  const after = query.cursor === undefined ? null : decodeCursor(query.cursor);
  // One row more than a page, to know whether another page follows.
  const rows = await contactMessages(deps.apiDb, { open: query.open === "1", after, limit: CONTACT_PAGE_SIZE + 1 });
  const page = rows.slice(0, CONTACT_PAGE_SIZE);
  const orders = await ordersOfMessages(deps.apiDb, page.map((row) => row.id));
  return {
    items: page.map((row) => ({
      id: row.id,
      folder: row.folder,
      receivedAt: row.receivedAt.toISOString(),
      seenAt: row.seenAt.toISOString(),
      stale: row.stale,
      disposition: row.disposition,
      handledAt: row.handledAt === null ? null : row.handledAt.toISOString(),
      handledBy: row.handledBy,
      orders: orders.get(row.id) ?? [],
    })),
    nextCursor: rows.length > CONTACT_PAGE_SIZE ? encodeCursor(page.at(-1)!) : null,
  };
}

/**
 * POST /api/staff/contact/:message/close (section 7.3 step 3): the disposition and who set it, only while the message has
 * none (the trigger stamps when), then the audit row, last, with the disposition, the time of receipt and the folder. A
 * message that has a disposition already is message_handled, and a disposition never changes; an unknown id is
 * not_found.
 */
export async function closeContact(deps: Pick<ModerationDeps, "apiDb">, session: ActiveStaffSession, messageId: string, request: ContactCloseRequest, ctx: { requestId: string }): Promise<void> {
  await deps.apiDb.transaction(async (tx) => {
    const closed = await closeMessage(tx, messageId, request.disposition, session.userId);
    if (closed === null) throw new ModerationError((await messageExists(tx, messageId)) ? "message_handled" : "not_found");
    await appendAuditRow(tx, {
      actorId: session.userId,
      action: "contact_closed",
      targetType: "contact_message",
      targetId: messageId,
      requestId: ctx.requestId,
      staffSession: session.handle,
      metadata: { disposition: request.disposition, receivedAt: closed.receivedAt.toISOString(), folder: closed.folder },
    });
  });
}

/**
 * StaffOverview.contact: the messages nobody has handled, the oldest one's time of receipt, and the earliest deadline of a
 * message that is not handled or of an order that still has an open item, also once it has passed (section 10.2).
 */
export async function contactOverview(deps: Pick<ModerationDeps, "apiDb">): Promise<StaffOverview["contact"]> {
  const [counts, order] = await Promise.all([contactCounts(deps.apiDb), nearestOrderDeadline(deps.apiDb)]);
  const due = [counts.dueAt, order].filter((at): at is Date => at !== null).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  return { open: counts.open, oldestAt: counts.oldestAt?.toISOString() ?? null, dueAt: due?.toISOString() ?? null };
}

// ---------------------------------------------------------------- order records (3f design, sections 7.4, 7.5 and 7.8)

/** What a confirmed action of an order answers: its view, or that the confirming key or account ended, or the challenge ran out. */
export type OrderOutcome = OrderView | "ended" | "late";

/** The locks a recorded event may wait for: the order, the acting account, the message, the key and the audit head. */
const EVENT_WAITS = 5;
/** A correction's: the order, the acting account, the key and the audit head; and one more for each author's profile, decision and post. */
const CORRECTION_WAITS = 4;
/** A correction without a key has no challenge to count from: its lock waits end at this bound, as the command line's do. */
const CORRECTION_LOCK_MS = 10_000;

/** The sha256 of a link, in hex: a link is not copied into the audit chain (section 10.5), its digest and length are. */
const linkDigest = (link: string) => createHash("sha256").update(link, "utf8").digest("hex");

/** An item as the audit rows of opening and adding name it: by its post when its link resolved, else by its link's digest. */
function auditItem(item: WrittenItem): Record<string, unknown> {
  const base = { itemId: item.id, position: item.position, addedAt: item.addedAt.toISOString() };
  return item.postId !== null ? { ...base, postId: item.postId } : { ...base, linkSha256: linkDigest(item.link), linkLength: Array.from(item.link).length };
}

/** What an order's link names now, for its item: a link that named a post or an image with no post found names nothing. */
function linkKindOf(appOrigin: string, link: string, postId: string | null): OrderLinkKind {
  const target = orderLinkTarget(appOrigin, link);
  if ((target.kind === "post" || target.kind === "image") && postId === null) return "other";
  return target.kind;
}

/**
 * The links of an order as its items (section 7.4 step 2), resolved against the app's origin and never fetched: a post's
 * page names the post when a row of posts has it, in any state; an image's address names the post the image is attached
 * to (the media module's imagePost); a profile's page and anything else name no post. Two links that name one post, among
 * these and the order's items already, are refused (invalid_request, 422). A plain function of the module's index, for
 * the console's route and for `staff.js order-open`, on the caller's connection or transaction.
 */
export async function orderItemsFor(q: Db | DbTx, appOrigin: string, links: readonly string[], existingPostIds: readonly string[] = []): Promise<NewOrderItem[]> {
  const targets = links.map((link) => ({ link, target: orderLinkTarget(appOrigin, link) }));
  const named = await existingPosts(q, targets.flatMap(({ target }) => (target.kind === "post" ? [target.postId] : [])));
  const items: NewOrderItem[] = [];
  for (const { link, target } of targets) {
    let postId: string | null = null;
    if (target.kind === "post" && named.has(target.postId)) postId = target.postId;
    if (target.kind === "image") postId = await imagePost(q, target.mediaId);
    items.push({ link, postId });
  }
  const posts = [...existingPostIds, ...items.flatMap((item) => (item.postId === null ? [] : [item.postId]))];
  if (new Set(posts).size !== posts.length) throw new ModerationError("invalid_request", 422, "Two links name the same post.");
  return items;
}

/** Whether the order's issuing state is not the operator's; with no home state named, every order counts as from elsewhere. */
const crossBorderOf = (deps: Pick<ModerationDeps, "config">, memberState: string) => deps.config.HOME_STATE === undefined || memberState !== deps.config.HOME_STATE;

/**
 * A refusal the database raised in an order's transaction, as the module's error: its codes, the shared invalid_request
 * (422 here: a member or an item the order does not take) and not_found; anything else is thrown as it is.
 */
function orderRefusal(err: unknown): ModerationError | null {
  const raised = raisedMessage(err);
  if (raised === "invalid_request") return new ModerationError("invalid_request", 422);
  if (raised === "not_found") return new ModerationError("not_found");
  if (raised === "rate_limited") return new ModerationError("rate_limited");
  if (raised !== null && isModerationErrorCode(raised)) return new ModerationError(raised);
  return null;
}

/** order_exists with the order that stands, read after the refusal, so the console links to it (section 7.4 step 5). */
async function orderExists(deps: Pick<ModerationDeps, "apiDb">, memberState: string, authority: string, reference: string): Promise<ModerationError> {
  const orderId = await orderByReference(deps.apiDb, memberState, authority, reference);
  return new ModerationError("order_exists", undefined, undefined, undefined, orderId === null ? undefined : { orderId });
}

/** The day's limit of order records, counted by the API before anything is written (section 7.4 step 1). */
async function checkRecordLimit(deps: Pick<ModerationDeps, "apiDb">, staffId: string): Promise<void> {
  const opened = await ordersOpenedToday(deps.apiDb, staffId);
  if (opened.count >= ORDER_RULES.recordsPerDay) throw new ModerationError("rate_limited", 429, undefined, opened.retryAfterSeconds);
}

/**
 * POST /api/staff/orders (section 7.4): the day's limit; the message, which must exist (not_found; order_needs_message
 * when it went between the read and the insert); the links as items; then one transaction, the rows of insertOrder and
 * the audit row `order_opened` last. No key: the record restricts nothing, copies nothing and tells nobody. After the
 * commit every staff account is alerted (`order_opened`), with the count of items and the deadline, or that it is unknown.
 */
export async function openOrder(deps: ModerationDeps, session: ActiveStaffSession, request: OrderOpenRequest, ctx: { requestId: string }): Promise<OrderView> {
  await checkRecordLimit(deps, session.userId);
  if (request.messageId !== null && !(await messageExists(deps.apiDb, request.messageId))) throw new ModerationError("not_found");
  const items = await orderItemsFor(deps.apiDb, deps.config.APP_ORIGIN, request.links);
  const crossBorder = crossBorderOf(deps, request.memberState);
  const id = randomUUID();
  let inserted: InsertedOrder;
  try {
    inserted = await deps.apiDb.transaction(async (tx) => {
      await tx.execute(sql`select set_config('lock_timeout', '10s', true)`);
      const written = await insertOrder(tx, {
        id,
        kind: request.kind,
        memberState: request.memberState,
        authority: request.authority,
        reference: request.reference,
        channel: request.channel,
        messageId: request.messageId,
        sectionC: request.sectionC,
        emergency: request.emergency,
        crossBorder,
        withholdFromAuthor: request.withholdFromAuthor,
        openedBy: session.userId,
        items,
      });
      await appendAuditRow(tx, {
        actorId: session.userId,
        action: "order_opened",
        targetType: "order",
        targetId: id,
        requestId: ctx.requestId,
        staffSession: session.handle,
        metadata: {
          kind: request.kind,
          memberState: request.memberState,
          authority: request.authority,
          reference: request.reference,
          channel: written.channel,
          messageId: request.messageId,
          receivedAt: written.receivedAt?.toISOString() ?? null,
          sentAt: null,
          openedAt: written.openedAt.toISOString(),
          sectionC: request.sectionC,
          emergency: request.emergency,
          crossBorder,
          withholdFromAuthor: written.withholdFromAuthor,
          via: "console",
          items: written.items.map(auditItem),
        },
      });
      return written;
    });
  } catch (err) {
    if (violatedUniqueConstraint(err) === "legal_orders_reference_key") throw await orderExists(deps, request.memberState, request.authority, request.reference);
    const refusal = orderRefusal(err);
    if (refusal !== null) throw refusal.code === "rate_limited" ? new ModerationError("rate_limited", 429, undefined, (await ordersOpenedToday(deps.apiDb, session.userId)).retryAfterSeconds) : refusal;
    throw err;
  }
  // The deadline a removal order has from its receipt; none for a DSA order, and unknown for a removal order without one.
  const hasClock = request.kind === "tco_removal";
  const facts: AlertFacts = {
    items: inserted.items.length,
    ...(hasClock && inserted.receivedAt !== null ? { dueAt: new Date(inserted.receivedAt.getTime() + ORDER_RULES.hourMinutes * 60_000).toISOString() } : {}),
    unknown: hasClock && inserted.receivedAt === null ? 1 : 0,
  };
  deps.background.start(async () => {
    await staffAlert(deps, null, 0, { template: "order_opened", facts });
  });
  return (await orderView(deps, id, session))!;
}

/**
 * POST /api/staff/orders/:order/items (section 7.4, "More items"): up to itemsPerAction more links to an order that is
 * not closed, up to ORDER_ITEMS_MAX in all, under the order's advisory lock so two additions take distinct positions; the
 * audit row `order_items_added` last. An item added after the order's verification is unverified until order-verify runs
 * again.
 */
export async function addItems(deps: ModerationDeps, session: ActiveStaffSession, orderId: string, request: OrderItemsRequest, ctx: { requestId: string }): Promise<OrderView> {
  const before = await orderRow(deps.apiDb, orderId);
  if (before === null) throw new ModerationError("not_found");
  if (before.closedAt !== null) throw new ModerationError("order_closed");
  try {
    await deps.apiDb.transaction(async (tx) => {
      await tx.execute(sql`select set_config('lock_timeout', '10s', true)`);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`korbat.order_items:${orderId}`}, 0))`);
      const current = await orderItems(tx, orderId);
      if (current.length + request.links.length > ORDER_ITEMS_MAX) throw new ModerationError("invalid_request", 422, `An order holds at most ${ORDER_ITEMS_MAX} items.`);
      const items = await orderItemsFor(tx, deps.config.APP_ORIGIN, request.links, current.flatMap((item) => (item.postId === null ? [] : [item.postId])));
      const written = await addOrderItems(tx, orderId, items);
      await appendAuditRow(tx, {
        actorId: session.userId,
        action: "order_items_added",
        targetType: "order",
        targetId: orderId,
        requestId: ctx.requestId,
        staffSession: session.handle,
        metadata: { items: written.map(auditItem) },
      });
    });
  } catch (err) {
    const refusal = orderRefusal(err);
    if (refusal !== null) throw refusal;
    throw err;
  }
  return (await orderView(deps, orderId, session))!;
}

/**
 * POST /api/staff/orders/:order/events, once its step-up verified (section 7.5): one transaction, its lock waits bounded
 * by the challenge's life; order_event_record decides everything under the order's row, with the session's account as
 * the acting one; then the audit row `order_event_recorded` through append_confirmed_audit, naming the event, which
 * legal_order_events_confirmed holds to it at commit. "ended" and "late" as for a decision; one more try after a deadlock
 * while the challenge has time.
 */
export async function recordEvent(deps: ModerationDeps, session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: { requestId: string }): Promise<OrderOutcome> {
  if (confirmed.action !== "order_event_recorded") throw new Error("only an order's event is recorded this way");
  const params = OrderEventRecordedParams.parse(confirmed.params);
  const orderId = confirmed.target.id;
  for (let attempt = 1; ; attempt++) {
    try {
      const outcome = await deps.apiDb.transaction(async (tx): Promise<"done" | "late"> => {
        if (!(await boundLockWaits(tx, confirmed.expiresAt, EVENT_WAITS))) return "late";
        const eventId = await recordOrderEvent(tx, orderId, params.kind, params.ground, params.messageId, session.userId);
        const effectiveAt = await eventEffectiveAt(tx, eventId);
        await appendConfirmedAudit(tx, {
          actorId: session.userId,
          keyId: confirmed.keyId,
          action: "order_event_recorded",
          targetType: "order",
          targetId: orderId,
          metadata: { params: confirmed.params, eventId, effectiveAt },
          staffSession: session.handle,
          actionHash: confirmed.actionHash,
          stepUp: confirmed.assertion,
          requestId: ctx.requestId,
          expiresAt: confirmed.expiresAt,
        });
        return "done";
      });
      if (outcome === "late") return "late";
      return (await orderView(deps, orderId, session))!;
    } catch (err) {
      const raised = raisedMessage(err);
      if (raised === "staff_confirmation_ended") return "ended";
      if (raised === "staff_confirmation_late") return "late";
      const refusal = orderRefusal(err);
      if (refusal !== null) throw refusal;
      if (!isDeadlock(err) && !isBoundReached(err)) throw err;
      if (attempt > 1 || confirmed.expiresAt.getTime() - deps.now().getTime() <= RETRY_MARGIN_MS) return "late";
    }
  }
}

/** A correction's member as its audit row names it: the request's word and the row's old value, never a text about a person. */
const CORRECTED_MEMBERS = ["kind", "memberState", "authority", "reference", "channel", "sectionC", "emergency", "withholdFromAuthor", "crossBorder"] as const;
const rowValue = (row: OrderRow, member: (typeof CORRECTED_MEMBERS)[number]): unknown =>
  ({ kind: row.kind, memberState: row.memberState, authority: row.authority, reference: row.reference, channel: row.channel, sectionC: row.sectionC, emergency: row.emergency, withholdFromAuthor: row.withholdFromAuthor, crossBorder: row.crossBorder })[member];

/**
 * POST /api/staff/orders/:order/correct (section 7.4, "Correcting what a person entered"): one transaction. For an order
 * that is given effect the authors of its disabled posts are locked first, "no key update" in id order, as the effect
 * transaction begins; then order_correct, to whose facts the API adds crossBorder with memberState, decides under the
 * order's row which rule allows it (entry, caution, admin) and writes it; then the audit row `order_corrected`, with the
 * rule, the changed members (old and new values; a closed item as its id and reason) and the event, through
 * append_confirmed_audit under a key and as a plain row otherwise. A correction under the rule admin without a key is
 * "step_up_required", and nothing is kept. After the commit every staff account is alerted (`order_corrected`).
 */
export async function correctOrderRecord(
  deps: ModerationDeps,
  session: ActiveStaffSession,
  orderId: string,
  facts: OrderCorrectFacts,
  confirmed: StaffStepUpConfirmed | null,
  ctx: { requestId: string },
): Promise<OrderOutcome | "step_up_required"> {
  if (confirmed !== null && (confirmed.action !== "order_corrected" || confirmed.target.id !== orderId)) throw new Error("a correction's key confirms that correction");
  const dbFacts: Record<string, unknown> = { ...facts };
  if (facts.memberState !== undefined) dbFacts.crossBorder = crossBorderOf(deps, facts.memberState);
  let changed: Record<string, unknown>[] = [];
  let counted = 0;
  try {
    const outcome = await deps.apiDb.transaction(async (tx): Promise<"done" | "late" | "step_up_required"> => {
      const before = await orderRow(tx, orderId);
      if (before === null) throw new ModerationError("not_found");
      const authors = before.givenEffect ? await disabledAuthors(tx, orderId) : [];
      const waits = CORRECTION_WAITS + authors.length + 2 * before.items;
      if (confirmed !== null) {
        if (!(await boundLockWaits(tx, confirmed.expiresAt, waits))) return "late";
      } else {
        await tx.execute(sql`select set_config('lock_timeout', ${`${CORRECTION_LOCK_MS}ms`}::text, true)`);
      }
      if (authors.length > 0) await deps.social.lockAccounts(tx, authors, "no key update");
      const eventId = await correctOrder(tx, orderId, dbFacts, session.userId);
      const rule = await eventGround(tx, eventId);
      // Under the rule admin a key must confirm: without one, the transaction's rows go.
      if (rule === "admin" && confirmed === null) throw new StepUpNeeded();
      const after = (await orderRow(tx, orderId))!;
      changed = CORRECTED_MEMBERS.filter((member) => member in dbFacts && rowValue(before, member) !== rowValue(after, member)).map((member) => ({
        member,
        from: rowValue(before, member),
        to: rowValue(after, member),
      }));
      for (const item of facts.closeItems ?? []) changed.push({ member: "closeItems", itemId: item.itemId, reason: item.reason });
      counted = changed.length;
      const metadata = { rule, changed, eventId, ...(confirmed !== null ? { params: confirmed.params } : {}) };
      if (confirmed !== null) {
        await appendConfirmedAudit(tx, {
          actorId: session.userId,
          keyId: confirmed.keyId,
          action: "order_corrected",
          targetType: "order",
          targetId: orderId,
          metadata,
          staffSession: session.handle,
          actionHash: confirmed.actionHash,
          stepUp: confirmed.assertion,
          requestId: ctx.requestId,
          expiresAt: confirmed.expiresAt,
        });
      } else {
        await appendAuditRow(tx, { actorId: session.userId, action: "order_corrected", targetType: "order", targetId: orderId, requestId: ctx.requestId, staffSession: session.handle, metadata });
      }
      return "done";
    }).catch((err: unknown) => {
      // A correction the key must confirm, sent without one: the transaction's rows go, and nothing is kept.
      if (err instanceof StepUpNeeded) return "step_up_required" as const;
      throw err;
    });
    if (outcome !== "done") return outcome;
  } catch (err) {
    const raised = raisedMessage(err);
    if (raised === "staff_confirmation_ended") return "ended";
    if (raised === "staff_confirmation_late") return "late";
    if (raised === "order_exists") {
      const now = await orderRow(deps.apiDb, orderId);
      throw await orderExists(deps, facts.memberState ?? now?.memberState ?? "", facts.authority ?? now?.authority ?? "", facts.reference ?? now?.reference ?? "");
    }
    const refusal = orderRefusal(err);
    if (refusal !== null) throw refusal;
    throw err;
  }
  const at = deps.now().toISOString();
  deps.background.start(async () => {
    await staffAlert(deps, null, 0, { template: "order_corrected", facts: { count: counted, at } });
  });
  return (await orderView(deps, orderId, session))!;
}

/** Thrown inside a correction's transaction to roll it back when the rule needs a key that was not sent. */
class StepUpNeeded extends Error {}

// ---------------------------------------------------------------- the reads

/**
 * An order's state on the list (section 10.2): closed; for a DSA order given_effect once it is given effect in full,
 * else no_clock; for a removal order given_effect only once it is given effect in full (every item disabled or closed
 * with a reason, one at least disabled), and while an item is open the state of its clock.
 */
function stateOf(row: OrderRow, now: number): OrderState {
  if (row.closedAt !== null) return "closed";
  const inFull = row.givenEffect && row.itemsOpen === 0;
  const clock = row.clock;
  if (row.kind !== "tco_removal" || clock === null) return inFull ? "given_effect" : "no_clock";
  if (inFull) return "given_effect";
  if (clock.stopped) return "stopped";
  if (clock.clockStart === null || clock.deadlineAt === null) return "unknown_deadline";
  return Date.parse(clock.deadlineAt) < now ? "overdue" : "running";
}

function summaryOf(row: OrderRow): OrderSummary {
  const now = Date.parse(row.now);
  return {
    id: row.id,
    kind: row.kind,
    memberState: row.memberState as OrderSummary["memberState"],
    authority: row.authority,
    reference: row.reference,
    openedAt: row.openedAt,
    state: stateOf(row, now),
    clock: row.clock,
    dueAt: row.kind === "tco_removal" ? null : row.dueAt,
    closedAt: row.closedAt,
    closeGround: row.closeGround,
    items: row.items,
    itemsInForce: row.itemsInForce,
    verified: row.verifiedAt !== null,
    noticesHeld: row.noticesHeld,
  };
}

/** The deadline a summary sorts by: a running clock's, a DSA order's, or none (after every deadline). */
const sortKey = (summary: OrderSummary): number => {
  if (summary.state === "unknown_deadline") return Number.NEGATIVE_INFINITY;
  const due = summary.clock?.deadlineAt ?? summary.dueAt;
  return due === null ? Number.POSITIVE_INFINITY : Date.parse(due);
};

/** GET /api/staff/orders (section 7.5): the orders not closed, the nearest deadline first, then those closed in the last 30 days. */
export async function ordersPage(deps: Pick<ModerationDeps, "apiDb">): Promise<OrdersPage> {
  const rows = (await orderRows(deps.apiDb)).map(summaryOf);
  const open = rows.filter((order) => order.closedAt === null).sort((a, b) => sortKey(a) - sortKey(b) || b.openedAt.localeCompare(a.openedAt));
  const closed = rows.filter((order) => order.closedAt !== null).sort((a, b) => b.closedAt!.localeCompare(a.closedAt!));
  return { open, closed };
}

/** Which console events order_event_record would take now from this account (an aid for the console: the database decides). */
function eventsAllowed(row: OrderRow, admin: boolean): OrderConsoleEvent[] {
  const closed = row.closedAt !== null;
  const tco = row.kind === "tco_removal";
  const stopped = row.clock?.stopped ?? false;
  const allowed: OrderConsoleEvent[] = [];
  if (!closed && tco && !stopped) allowed.push("annex3_sent");
  if (!closed && tco && stopped && row.clock?.stopGround === "force_majeure") allowed.push("grounds_ceased");
  if (!closed && tco && stopped && row.clock?.stopGround !== "force_majeure") allowed.push("clarification_received");
  if (!closed && tco && row.givenEffect) allowed.push("annex2_sent");
  if (!closed && !tco) allowed.push("receipt_confirmed");
  if (admin && !closed && row.itemsInForce === 0) allowed.push("closed_without_effect");
  if (admin && closed) allowed.push("reopened");
  if (admin && !closed && tco && row.sectionC && !row.holdExtended && row.holdEndedAt === null && row.releasedAt === null) allowed.push("hold_extended");
  return allowed;
}

/** What the command line still owes an order (section 7.5). */
function owedOf(row: OrderRow, now: number): OrderView["owed"] {
  const scrutinyEnd = row.receivedAt === null ? null : Date.parse(row.receivedAt) + ORDER_SCRUTINY_HOURS * 3_600_000;
  return {
    received: row.receivedAt === null,
    verification: row.verifiedAt === null || row.itemsUnverified,
    issuedAt: row.kind === "tco_removal" && row.sectionC && row.issuedAt === null,
    texts: row.kind !== "dsa_art10" && (!row.hasReasons || !row.hasRedress || (row.kind === "dsa_art9" && !row.hasScope)),
    document: !row.hasDocument,
    holdUntil: row.kind !== "tco_removal" && row.sectionC && row.holdOpen,
    tellPerson: row.kind === "dsa_art10" && row.tellPerson === null,
    scrutinyUntil:
      row.kind === "tco_removal" && row.crossBorder && !row.scrutinyRequested && scrutinyEnd !== null && scrutinyEnd > now ? new Date(scrutinyEnd).toISOString() : null,
  };
}

/** GET /api/staff/orders/:order (section 7.5), as the given account may act on it; null for an unknown order. */
export async function orderView(deps: Pick<ModerationDeps, "apiDb" | "config">, orderId: string, viewer: Pick<ActiveStaffSession, "role">): Promise<OrderView | null> {
  const row = await orderRow(deps.apiDb, orderId);
  if (row === null) return null;
  const [items, events, gapped] = await Promise.all([orderItems(deps.apiDb, orderId), orderEvents(deps.apiDb, orderId), itemsWithOpenGaps(deps.apiDb, orderId)]);
  const images = await imageCounts(deps.apiDb, items.flatMap((item) => (item.postId === null ? [] : [item.postId])));
  const now = Date.parse(row.now);
  const admin = viewer.role === "admin";
  const summary = summaryOf(row);
  return {
    ...summary,
    channel: row.channel,
    messageId: row.messageId,
    receivedAt: row.receivedAt,
    sentAt: row.sentAt,
    issuedAt: row.issuedAt,
    sectionC: row.sectionC,
    emergency: row.emergency,
    crossBorder: row.crossBorder,
    withholdFromAuthor: row.withholdFromAuthor,
    preserve: row.preserve,
    openedBy: row.openedBy,
    openedVia: row.openedVia,
    importedAt: row.importedAt,
    tellPerson: row.kind === "dsa_art10" && row.tellPerson !== null ? { rule: row.tellPerson, at: row.tellPersonAt } : null,
    items: items.map((item) => ({
      id: item.id,
      position: item.position,
      link: item.link,
      linkKind: linkKindOf(deps.config.APP_ORIGIN, item.link, item.postId),
      addedAt: item.addedAt,
      unverified: row.verifiedAt === null || Date.parse(item.addedAt) > Date.parse(row.verifiedAt),
      postId: item.postId,
      post:
        item.post === null
          ? null
          : {
              authorHandle: item.post.authorHandle,
              state: item.post.state as NonNullable<OrderItemView["post"]>["state"],
              images: images.get(item.postId!) ?? 0,
              // A post that is not public shows its state's word and no text: the order's screen is no second way to read it.
              preview: item.post.state === "visible" ? Array.from(item.post.body).slice(0, ORDER_ITEM_PREVIEW).join("") : null,
              createdAt: item.post.createdAt,
              deletedOn: item.post.deletedOn,
            },
      decisionId: item.decisionId,
      caseId: item.caseId,
      inForce: item.inForce,
      disabledAt: item.disabledAt,
      noEffect: item.noEffect,
      preserveUntil: item.preserveUntil,
      preserveEndedAt: item.preserveEndedAt,
      erasedAt: item.erasedAt,
      reinstatedAt: item.reinstatedAt,
      reinstatedGround: item.reinstatedGround,
      closedAt: item.closedAt,
      closedReason: item.closedReason,
      // Task 6: an open restore gap names the item, whose disabling the restore lost: "Disable for an order" takes it again.
      gap: gapped.has(item.id),
    })),
    events: events.map((event) => ({ ...event })),
    owed: owedOf(row, now),
    hold: row.sectionC
      ? {
          until: row.holdUntil,
          basis: row.kind === "tco_removal" ? "regulation" : "authority",
          open: row.holdOpen,
          extended: row.holdExtended,
          endedAt: row.holdEndedAt,
          endReason: row.holdEndReason,
          releasedAt: row.releasedAt,
          noticesHeld: row.noticesHeld,
        }
      : null,
    mayClose: admin && row.closedAt === null && row.itemsInForce === 0,
    mayEvents: eventsAllowed(row, admin),
    mayCorrect: row.closedAt !== null ? null : !row.givenEffect ? "entry" : admin ? "admin" : "caution",
  };
}

// ---------------------------------------------------------------- giving effect (Task 3, section 7.6)

/**
 * The lock waits of "Disable for an order" on `n` items (section 7.6, step 1): once the order, the deciding account's
 * row, the cap's advisory lock, the key and the audit head; and for each item the author's profile, the case, the item's
 * row, the account's row, the post and up to four images.
 */
export const ORDER_EFFECT_WAITS = (n: number) => 5 + 9 * n;

/** The order's facts as the key signs them (10.3), from its row: what the effect compares, member by member. */
const signedFacts = (row: OrderRow) => ({
  kind: row.kind,
  memberState: row.memberState,
  authority: row.authority,
  reference: row.reference,
  sectionC: row.sectionC,
  emergency: row.emergency,
  withholdFromAuthor: row.withholdFromAuthor,
});

/**
 * The rows of "Disable for an order" inside the effect's transaction, after the authors' profiles are held and before
 * the audit row (section 7.6, steps 3 to 5): one intake of the kind order (channel authority, no sender, no text, no
 * receipt); for each item in post order the post's open case and the intake's item, whose attach trigger takes the case,
 * then the item's intake_item_id; for each item in post order a snapshot of its own, the order decision and its one
 * disable_by_order, whose triggers force everything else. Answers each item's decision. The module's tests call it with
 * an audit row of their own, to meet decision_holds' refusals.
 */
export async function effectRows(deps: Pick<ModerationDeps, "social" | "media">, tx: DbTx, deciderId: string, params: OrderEffectedParams): Promise<Record<string, string>> {
  const ordered = ORDER_DECISION[params.kind];
  const intakeId = await insertIntake(tx, {
    kind: "order",
    ref: newRef(),
    lookupHash: null,
    channel: "authority",
    reporterId: null,
    findingBy: null,
    contactId: null,
    ruleId: null,
    allegesIllegal: true,
    csam: false,
    category: ordered.category,
    categoryKeyword: null,
    citedLaw: null,
    explanation: null,
    bonaFide: false,
  });
  // The cases in their targets' order, each taken by its intake item's attach trigger before any post is locked.
  const cases = new Map<string, string>();
  for (const [index, item] of params.items.entries()) {
    const caseId = await openCase(tx, "post", item.postId);
    if (caseId === null) throw new ModerationError("case_closed");
    const inserted = await insertItem(tx, { intakeId, caseId, targetType: "post", targetId: item.postId, position: index + 1, lane: 0, mediaId: null, namedHandle: null });
    await setItemIntake(tx, item.itemId, inserted.id);
    cases.set(item.itemId, caseId);
  }
  const takenAt = await snapshotTime(tx);
  const decisionIds: Record<string, string> = {};
  for (const item of params.items) {
    const caseId = cases.get(item.itemId)!;
    // Each item gets a snapshot of its own, also when the case's newest is equal: the preservation keeps this row.
    const post = await deps.social.capturePost(tx, item.postId);
    if (!post) throw new ModerationError("order_changed");
    const held = await deps.media.hold(tx, [{ caseId, postId: item.postId }]);
    const snapshot = await storeSnapshot(tx, takenAt, {
      caseId,
      targetType: "post",
      targetId: item.postId,
      authorHandle: post.authorHandle,
      postState: post.state,
      postCreatedAt: post.createdAt.toISOString(),
      replyToId: post.replyToId,
      quoteOfId: post.quoteOfId,
      body: post.body,
      media: held.get(item.postId) ?? [],
      displayName: null,
      bio: null,
      handle: null,
    });
    const decisionId = randomUUID();
    await insertOrderDecision(tx, {
      id: decisionId,
      caseId,
      itemId: item.itemId,
      stateVersion: await caseVersion(tx, caseId),
      rulesVersion: RULES_VERSION,
      redressVersion: REDRESS_VERSION,
      category: ordered.category,
      keyword: ordered.keyword,
      snapshotId: snapshot.id,
      snapshotDigest: snapshot.digest,
      decidedBy: deciderId,
    });
    await insertAction(tx, decisionId, { kind: "disable_by_order", mediaId: null });
    decisionIds[item.itemId] = decisionId;
  }
  return decisionIds;
}

/**
 * POST /api/staff/orders/:order/effect, once its step-up verified (section 7.6): "Disable for an order" on up to ten items
 * with one key touch.
 *
 * Before the transaction (reads; the database decides again): the order exists (not_found), is open (order_closed) and
 * is no order to provide information (invalid_decision); an unverified DSA Article 9 order is given effect only by an
 * admin who signed `urgent` (order_not_verified); the signed facts equal the order's row and every item is the order's
 * and names its post (order_changed: the console reads the order again); each post's author is read.
 *
 * The transaction, in section 5's lock order: the bound on its lock waits; the authors' profiles "no key update" in one
 * statement; one intake of the kind order (channel authority, no sender, no text, no receipt); for each item in post
 * order the post's open case and the intake's item, whose attach trigger takes the case, then the item's intake_item_id;
 * for each item in post order a snapshot of its own, the order decision and its one disable_by_order, whose triggers
 * force everything else; last the audit row order_effected with the params and decisionIds. decision_holds holds each
 * decision to that row at commit. A deadlock or a bound reached runs it once more while more than a minute of the
 * challenge is left; a case that closed under it (case_closed) once more too.
 *
 * After the commit, each in a try of its own: what follows a decision (the statement's mail for a told notice, the
 * count of the account's decisions), and the alert order_effected to every staff account.
 */
export async function giveEffect(deps: ModerationDeps, session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: { requestId: string }): Promise<OrderOutcome> {
  // A confirmation of anything else never gives effect: a wiring fault, not a refusal.
  if (confirmed.action !== "order_effected" || confirmed.target.type !== "order" || confirmed.keyId !== session.keyId) throw new Error("an effect needs the step-up that confirmed it");
  const params = OrderEffectedParams.parse(confirmed.params);
  const orderId = confirmed.target.id;
  const row = await orderRow(deps.apiDb, orderId);
  if (row === null) throw new ModerationError("not_found");
  if (row.closedAt !== null) throw new ModerationError("order_closed");
  if (row.kind === "dsa_art10") throw new ModerationError("invalid_decision");
  if (row.kind === "dsa_art9" && row.verifiedAt === null && !(session.role === "admin" && params.urgent)) throw new ModerationError("order_not_verified");
  const signed = { kind: params.kind, memberState: params.memberState, authority: params.authority, reference: params.reference, sectionC: params.sectionC, emergency: params.emergency, withholdFromAuthor: params.withholdFromAuthor };
  if (JSON.stringify(signed) !== JSON.stringify(signedFacts(row))) throw new ModerationError("order_changed");
  const items = await effectItems(deps.apiDb, orderId, params.items.map((item) => item.itemId));
  const byId = new Map(items.map((item) => [item.id, item]));
  if (params.items.some((item) => byId.get(item.itemId)?.postId !== item.postId)) throw new ModerationError("order_changed");
  // A post's author never changes; a post purged since the read has none, and the person reads the order again.
  const authors = new Map<string, string>();
  for (const item of params.items) {
    const author = await deps.social.postAuthor(item.postId);
    if (author === null) throw new ModerationError("order_changed");
    authors.set(item.postId, author);
  }
  // Task 6 (7.6 step 5): after a restore, the open gaps of the class order_effect that name one of these items; the
  // request carries nothing for them, and the transaction closes each with its item's decision.
  const gaps = await openEffectGaps(deps.apiDb, params.items.map((item) => item.itemId));
  let decisionIds: Record<string, string> = {};
  for (let attempt = 1; ; attempt++) {
    try {
      const outcome = await deps.apiDb.transaction(async (tx): Promise<"done" | "late"> => {
        if (!(await boundLockWaits(tx, confirmed.expiresAt, ORDER_EFFECT_WAITS(params.items.length)))) return "late";
        await deps.social.lockAccounts(tx, [...new Set(authors.values())].sort(), "no key update");
        decisionIds = await effectRows(deps, tx, session.userId, params);
        // Each gap after the ledger rows and before the audit row (7.6 step 6), in the items' order, so the decisions'
        // own check at commit covers the closings. The audit row names them, item by item, as a decision's names its gap.
        const gapIds: Record<string, string> = {};
        for (const item of params.items) {
          const gap = gaps.get(item.itemId);
          if (gap === undefined) continue;
          await closeGap(tx, gap, decisionIds[item.itemId]!, session.userId);
          gapIds[item.itemId] = gap;
        }
        await appendConfirmedAudit(tx, {
          actorId: session.userId,
          keyId: confirmed.keyId,
          action: "order_effected",
          targetType: "order",
          targetId: orderId,
          metadata: { params: confirmed.params, decisionIds, ...(Object.keys(gapIds).length > 0 ? { gapIds } : {}) },
          staffSession: session.handle,
          actionHash: confirmed.actionHash,
          stepUp: confirmed.assertion,
          requestId: ctx.requestId,
          expiresAt: confirmed.expiresAt,
        });
        return "done";
      });
      if (outcome === "late") return "late";
      break;
    } catch (err) {
      const raised = raisedMessage(err);
      if (raised === "staff_confirmation_ended") return "ended";
      if (raised === "staff_confirmation_late") return "late";
      const retryable = isDeadlock(err) || isBoundReached(err) || isSerializationFailure(err) || (err instanceof ModerationError && err.code === "case_closed");
      if (!retryable) {
        if (err instanceof ModerationError) throw err;
        const refusal = orderRefusal(err);
        if (refusal !== null) {
          const detail = raisedDetail(err);
          if (detail !== null) deps.log.info({ refusal: refusal.code, detail }, "moderation: an order's effect was refused");
          throw refusal;
        }
        throw err;
      }
      if (attempt > 1 || confirmed.expiresAt.getTime() - deps.now().getTime() <= RETRY_MARGIN_MS) {
        if (err instanceof ModerationError && err.code === "case_closed") throw err;
        return "late";
      }
    }
  }
  const view = (await orderView(deps, orderId, session))!;
  const decided = Object.values(decisionIds);
  for (const decisionId of decided) deps.background.start(() => afterDecision(deps, session.userId, decisionId));
  const at = deps.now().toISOString();
  const itemsOpen = view.items.filter((item) => item.disabledAt === null && item.closedAt === null).length;
  const urgent = params.urgent && row.kind === "dsa_art9" && row.verifiedAt === null ? 1 : 0;
  deps.background.start(async () => {
    await staffAlert(deps, null, 0, { template: "order_effected", facts: { items: decided.length, at, itemsOpen, urgent } });
  });
  return view;
}
