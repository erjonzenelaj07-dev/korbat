import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { ORDER_RULES } from "@korbat/contracts";
import type { DbTx } from "@korbat/db";
import { CHANNEL_TABLES, newTestStaff, raised, removeFixtures, rowCounts, staffProfile, type TestStaff } from "./moderation-fixtures";
import { noticesWorld, type NoticesWorld } from "./notices-harness";
import { closeNotifyFixtures, contactMessageForTest, nextValidity, removeMessages } from "./notify-fixtures";
import { ORDER_TABLES, removeOrderAlerts, orderForTest, removeOrders } from "./orders-fixtures";
import { rolledBack } from "./staff-fixtures";

vi.setConfig({ testTimeout: 90_000 });

const MIN = 60_000;

/**
 * The clock of a removal order (3f design, section 2 rows 4, 10 and 11, sections 6.2 and 7.5; invariants 10 and 26, the
 * view; LAB B on the real code). legal_order_clock starts at the earlier of the receipt and the sending time, and again
 * at the newest restart; an Annex III newer than that restart stops it; a fresh hour from a cease or a clarification,
 * never the rest of the old one; within_hour is null while an item is open and judges the last disabling afterwards, true
 * for one given while the clock was stopped. order_event_record holds the rule the console shows: a cease only after an
 * Annex III for force majeure, a clarification only after one on another ground, and a restart takes the later of the
 * message's time and the Annex III's. An order is opened once; an order without a message is accepted at any time, with
 * the channel the person picked, and one opened from a message is mailbox whatever was sent; a message a mail host stamps
 * ahead of the database's clock is stored at the clock's time, so an order opened from it at once meets no CHECK.
 *
 * The view's tests write the orders, items and events as the migrator, with the times they name, in transactions rolled
 * back; the function's run as the API role, rolled back too. What commits is removed, and the last test holds the file to
 * leaving no row behind.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: an order's clock and its events", () => {
  let w: NoticesWorld;
  let staff: TestStaff;
  let admin: TestStaff;
  let before: Record<string, number>;
  const orders: string[] = [];
  const messages: string[] = [];
  const started = new Date();

  beforeAll(async () => {
    w = noticesWorld();
    staff = await newTestStaff(w.authDb, w.migrateDb, w.repo, "moderator");
    admin = await newTestStaff(w.authDb, w.migrateDb, w.repo, "admin");
    await staffProfile(w.apiDb, staff);
    await staffProfile(w.apiDb, admin);
    // Counted once the staff and the profiles stand: they leave in afterAll, after the last count.
    before = await rowCounts(w.apiDb, [...ORDER_TABLES, ...CHANNEL_TABLES]);
  }, 60_000);
  afterAll(async () => {
    await removeOrders(w.migrateDb, orders);
    await removeMessages(w.migrateDb, messages);
    await removeFixtures(w.migrateDb, [staff.id, admin.id]);
    await closeNotifyFixtures();
    await w.close();
  });

  /** A removal order of the migrator's in the transaction, received and sent at the times given (minutes ago, or none). */
  async function orderIn(tx: DbTx, times: { received?: number | null; sent?: number | null; kind?: string } = {}): Promise<string> {
    const at = (minutes: number | null | undefined) => (minutes === null || minutes === undefined ? null : new Date(Date.now() - minutes * MIN).toISOString());
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into public.legal_orders (id, kind, member_state, authority, reference, channel, section_c, emergency, cross_border, withhold_from_author, received_at, sent_at, opened_by, opened_via)
      values (gen_random_uuid(), ${times.kind ?? "tco_removal"}, 'DE', 'BKA', ${`C-${randomUUID()}`}, 'portal', false, false, false, true,
              ${at(times.received === undefined ? 10 : times.received)}::timestamptz, ${at(times.sent)}::timestamptz, ${staff.id}::uuid, 'cli')
      returning id`);
    return row!.id;
  }
  /** An item of the order, disabled or closed `minutes` ago when asked. */
  async function itemIn(tx: DbTx, orderId: string, position: number, state: { disabled?: number; closed?: number } = {}): Promise<string> {
    const at = (minutes: number | undefined) => (minutes === undefined ? null : new Date(Date.now() - minutes * MIN).toISOString());
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into public.legal_order_items (order_id, position, link, post_id, added_at, disabled_at, closed_at, closed_reason)
      values (${orderId}::uuid, ${position}, ${`https://elsewhere.example/${position}`}, null, now(), ${at(state.disabled)}::timestamptz, ${at(state.closed)}::timestamptz,
              ${state.closed === undefined ? null : "no_post"})
      returning id`);
    return row!.id;
  }
  /** An event of the migrator's at a time `minutes` ago, effective at another when given. */
  const eventIn = (tx: DbTx, orderId: string, kind: string, minutes: number, ground: string | null = null, effective?: number) =>
    tx.execute(sql`insert into public.legal_order_events (order_id, kind, ground, at, effective_at, via)
                   values (${orderId}::uuid, ${kind}, ${ground}, now() - make_interval(secs => ${minutes * 60}), ${effective === undefined ? null : new Date(Date.now() - effective * MIN).toISOString()}::timestamptz, 'cli')`);
  /** The clock's row, its times as minutes from now (negative in the past), rounded. */
  async function clock(tx: DbTx, orderId: string) {
    const [row] = await tx.execute<Record<string, unknown>>(sql`
      select c.stopped, c.items_open, c.within_hour,
             round(extract(epoch from c.clock_start - now()) / 60)::int as start, round(extract(epoch from c.deadline_at - now()) / 60)::int as deadline,
             round(extract(epoch from c.target_at - now()) / 60)::int as target, round(extract(epoch from c.first_effect_at - now()) / 60)::int as first,
             round(extract(epoch from c.last_effect_at - now()) / 60)::int as last
        from public.legal_order_clock c where c.order_id = ${orderId}::uuid`);
    return row;
  }

  test("the clock starts at the earlier of the receipt and the sending time; its deadline and target are hour_minutes and target_minutes on", async () => {
    await rolledBack(w.migrateDb, async (tx) => {
      const received = await orderIn(tx, { received: 10 });
      expect(await clock(tx, received)).toMatchObject({ stopped: false, start: -10, deadline: ORDER_RULES.hourMinutes - 10, target: ORDER_RULES.targetMinutes - 10, items_open: 0, within_hour: null });
      const sentEarlier = await orderIn(tx, { received: 10, sent: 25 });
      expect(await clock(tx, sentEarlier)).toMatchObject({ start: -25, deadline: ORDER_RULES.hourMinutes - 25 });
      const none = await orderIn(tx, { received: null });
      expect(await clock(tx, none)).toMatchObject({ start: null, deadline: null, stopped: false });
      // A DSA order has no clock: the view lists removal orders alone.
      expect(await clock(tx, await orderIn(tx, { kind: "dsa_art9" }))).toBeUndefined();
    });
  });

  test("an Annex III stops the clock with no deadline; a clarification effective after it starts a fresh hour from its effective time, never the rest of the old one", async () => {
    await rolledBack(w.migrateDb, async (tx) => {
      const order = await orderIn(tx, { received: 70 });
      // Received 70 minutes ago: overdue.
      expect((await clock(tx, order))!.deadline).toBe(ORDER_RULES.hourMinutes - 70);
      await eventIn(tx, order, "annex3_sent", 30, "insufficient_information");
      expect(await clock(tx, order)).toMatchObject({ stopped: true, deadline: null, target: null });
      await eventIn(tx, order, "clarification_received", 0, null, 5);
      expect(await clock(tx, order)).toMatchObject({ stopped: false, start: -5, deadline: ORDER_RULES.hourMinutes - 5 });
      // A second Annex III stops it again; a cease after it restarts it from the cease.
      await eventIn(tx, order, "annex3_sent", -1, "force_majeure");
      expect((await clock(tx, order))!.stopped).toBe(true);
      await eventIn(tx, order, "grounds_ceased", -2, null);
      expect(await clock(tx, order)).toMatchObject({ stopped: false, start: 2, deadline: ORDER_RULES.hourMinutes + 2 });
    });
  });

  test("the hour is the order's: within_hour is null while an item is open, judges the last disabling once none is, and is true for a disabling given while the clock was stopped", async () => {
    await rolledBack(w.migrateDb, async (tx) => {
      const partial = await orderIn(tx, { received: 30 });
      await itemIn(tx, partial, 1, { disabled: 20 });
      await itemIn(tx, partial, 2);
      expect(await clock(tx, partial)).toMatchObject({ items_open: 1, first: -20, last: -20, within_hour: null, deadline: ORDER_RULES.hourMinutes - 30 });
      const inside = await orderIn(tx, { received: 30 });
      await itemIn(tx, inside, 1, { disabled: 20 });
      await itemIn(tx, inside, 2, { closed: 10 });
      expect(await clock(tx, inside)).toMatchObject({ items_open: 0, within_hour: true });
      const outside = await orderIn(tx, { received: 100 });
      await itemIn(tx, outside, 1, { disabled: 30 });
      expect(await clock(tx, outside)).toMatchObject({ items_open: 0, within_hour: false });
      // Stopped at minute 30 and given effect at minute 90 with no restart: not outside its hour.
      const stopped = await orderIn(tx, { received: 90 });
      await eventIn(tx, stopped, "annex3_sent", 60, "force_majeure");
      await itemIn(tx, stopped, 1, { disabled: 1 });
      expect(await clock(tx, stopped)).toMatchObject({ items_open: 0, within_hour: true });
      // An item that names nothing is open until a person closes it.
      const unnamed = await orderIn(tx, { received: 5 });
      await itemIn(tx, unnamed, 1);
      expect(await clock(tx, unnamed)).toMatchObject({ items_open: 1, within_hour: null });
    });
  });

  /** An order opened as the API role, in the API's transaction, with its message when given. */
  const apiOrder = (tx: DbTx, kind: "tco_removal" | "dsa_art9" = "tco_removal") => orderForTest(tx, staff, { kind, links: ["https://elsewhere.example/x"] });
  /** order_event_record as the API role, by the account given; answers the refusal's code, or null. */
  async function record(tx: DbTx, orderId: string, kind: string, ground: string | null, messageId: string | null = null, by: TestStaff = staff): Promise<string | null> {
    try {
      await tx.transaction((sp) => sp.execute(sql`select public.order_event_record(${orderId}::uuid, ${kind}, ${ground}, ${messageId}::uuid, ${by.id}::uuid)`));
      return null;
    } catch (err) {
      return raised(err)?.message ?? String(err);
    }
  }

  test("order_event_record holds the rule the console shows: every Annex III has exactly one restart, by its ground", async () => {
    const message = await contactMessageForTest(new Date(Date.now() - MIN), "inbox");
    messages.push(message);
    await rolledBack(w.apiDb, async (tx) => {
      const order = (await apiOrder(tx)).id;
      // No restart while the clock runs; an Annex III needs a ground of its list.
      expect(await record(tx, order, "grounds_ceased", null)).toBe("order_event_refused");
      expect(await record(tx, order, "clarification_received", null, message)).toBe("order_event_refused");
      expect(await record(tx, order, "annex3_sent", null)).toBe("order_event_refused");
      expect(await record(tx, order, "annex3_sent", "withdrawn")).toBe("order_event_refused");
      expect(await record(tx, order, "annex3_sent", "manifest_error")).toBeNull();
      // Stopped: a second Annex III is refused, and so is the restart of the other ground.
      expect(await record(tx, order, "annex3_sent", "force_majeure")).toBe("order_event_refused");
      expect(await record(tx, order, "grounds_ceased", null)).toBe("order_event_refused");
      // A clarification names its message.
      expect(await record(tx, order, "clarification_received", null)).toBe("order_needs_message");
      expect(await record(tx, order, "clarification_received", null, randomUUID())).toBe("order_needs_message");
      expect(await record(tx, order, "clarification_received", null, message)).toBeNull();
      // The message was not handled: it is now, as a clarification, by the acting account.
      const [handled] = await tx.execute<{ disposition: string; handled_by: string; stamped: boolean }>(
        sql`select disposition, handled_by, handled_at is not null as stamped from public.contact_messages where id = ${message}::uuid`,
      );
      expect(handled).toEqual({ disposition: "clarification", handled_by: staff.id, stamped: true });
      // Running again: Annex II waits for an effect; receipt_confirmed is a DSA order's.
      expect(await record(tx, order, "annex2_sent", null)).toBe("order_event_refused");
      expect(await record(tx, order, "receipt_confirmed", null)).toBe("order_event_refused");
      // A force-majeure Annex III is ceased, with or without a message.
      expect(await record(tx, order, "annex3_sent", "force_majeure")).toBeNull();
      expect(await record(tx, order, "clarification_received", null, message)).toBe("order_event_refused");
      expect(await record(tx, order, "grounds_ceased", null)).toBeNull();
      const events = await tx.execute<{ kind: string; ground: string | null; via: string; by: string }>(
        sql`select kind, ground, via, by_staff as by from public.legal_order_events where order_id = ${order}::uuid order by at, id`,
      );
      expect(events.map((e) => [e.kind, e.ground, e.via])).toEqual([
        ["opened", null, "console"],
        ["annex3_sent", "manifest_error", "console"],
        ["clarification_received", null, "console"],
        ["annex3_sent", "force_majeure", "console"],
        ["grounds_ceased", null, "console"],
      ]);
      expect(new Set(events.map((e) => e.by))).toEqual(new Set([staff.id]));
    });
  });

  test("a restart takes the later of its message's time and the Annex III's, and nothing is refused for its time", async () => {
    // The clarification arrived before the Annex III was recorded: the clock restarts at the Annex III's time.
    const early = await contactMessageForTest(new Date(Date.now() - 10 * MIN), "inbox");
    messages.push(early);
    await rolledBack(w.apiDb, async (tx) => {
      const order = (await apiOrder(tx)).id;
      expect(await record(tx, order, "annex3_sent", "insufficient_information")).toBeNull();
      const [annex] = await tx.execute<{ at: string }>(sql`select at::text from public.legal_order_events where order_id = ${order}::uuid and kind = 'annex3_sent'`);
      expect(await record(tx, order, "clarification_received", null, early)).toBeNull();
      const [restart] = await tx.execute<{ effective: string; same: boolean }>(sql`
        select effective_at::text as effective, effective_at = ${annex!.at}::timestamptz as same from public.legal_order_events where order_id = ${order}::uuid and kind = 'clarification_received'`);
      expect(restart!.same).toBe(true);
      const [view] = await tx.execute<{ stopped: boolean; same: boolean }>(
        sql`select stopped, clock_start = ${annex!.at}::timestamptz as same from public.legal_order_clock where order_id = ${order}::uuid`,
      );
      expect(view).toEqual({ stopped: false, same: true });
    });
  });

  test("closing, reopening and the extension are an admin's; a closed order takes no event but its reopening", async () => {
    await rolledBack(w.apiDb, async (tx) => {
      const order = (await apiOrder(tx)).id;
      expect(await record(tx, order, "closed_without_effect", "withdrawn")).toBe("admin_required");
      expect(await record(tx, order, "closed_without_effect", "force_majeure", null, admin)).toBe("order_event_refused");
      expect(await record(tx, order, "reopened", null, null, admin)).toBe("order_event_refused");
      expect(await record(tx, order, "closed_without_effect", "not_addressed", null, admin)).toBeNull();
      expect(await record(tx, order, "annex3_sent", "manifest_error")).toBe("order_closed");
      expect(await record(tx, order, "reopened", null)).toBe("admin_required");
      expect(await record(tx, order, "reopened", null, null, admin)).toBeNull();
      const [row] = await tx.execute<{ closed: boolean }>(sql`select closed_at is not null as closed from public.legal_orders where id = ${order}::uuid`);
      expect(row!.closed).toBe(false);
      // An extension: only with Section C (none here), only on a removal order, by an admin, with a message.
      expect(await record(tx, order, "hold_extended", null, null, admin)).toBe("order_needs_message");
      const dsa = (await apiOrder(tx, "dsa_art9")).id;
      expect(await record(tx, dsa, "receipt_confirmed", null)).toBeNull();
      expect(await record(tx, dsa, "annex3_sent", "manifest_error")).toBe("order_event_refused");
    });
  });

  test("an order is opened once; one without a message is accepted with the channel picked, and one from a message is mailbox whatever was sent", async () => {
    const message = await contactMessageForTest(new Date(Date.now() - MIN), "junk");
    messages.push(message);
    await rolledBack(w.apiDb, async (tx) => {
      const insert = (channel: string, messageId: string | null) =>
        tx.execute<{ id: string; channel: string; received: boolean; via: string }>(sql`
          insert into public.legal_orders (id, kind, member_state, authority, reference, channel, message_id, section_c, emergency, cross_border, withhold_from_author, opened_by)
          values (gen_random_uuid(), 'tco_removal', 'DE', 'BKA', ${`O-${randomUUID()}`}, ${channel}, ${messageId}::uuid, false, false, false, false, ${staff.id}::uuid)
          returning id, channel, received_at is not null as received, opened_via as via`);
      for (const channel of ["mailbox", "portal", "post", "other"]) {
        const [row] = await insert(channel, null);
        expect([row!.channel, row!.received, row!.via], channel).toEqual([channel, false, "console"]);
      }
      const [fromMessage] = await insert("portal", message);
      expect([fromMessage!.channel, fromMessage!.received]).toEqual(["mailbox", true]);
      // The trigger reads no row of notify_state: the watcher's state never decides whether an order may be opened.
      const [definition] = await tx.execute<{ text: string }>(sql`select pg_get_functiondef('public.legal_orders_insert'::regproc) as text`);
      expect(definition!.text).not.toMatch(/notify_state/);
      // A second opening of one order is refused by the unique key.
      await tx.execute(sql`insert into public.legal_order_events (order_id, kind) values (${fromMessage!.id}::uuid, 'opened')`);
      const second = await tx
        .transaction((sp) => sp.execute(sql`insert into public.legal_order_events (order_id, kind) values (${fromMessage!.id}::uuid, 'opened')`))
        .then(() => null, (err: unknown) => raised(err)?.code);
      expect(second).toBe("23505");
    });
  });

  test("a message stamped ahead of the database's clock is stored at the clock's time, and an order opened from it at once meets no check", async () => {
    const ahead = await contactMessageForTest(new Date(Date.now() + 5 * MIN), "inbox", { uidvalidity: nextValidity() });
    messages.push(ahead);
    const [row] = await w.apiDb.execute<{ at_or_before: boolean }>(sql`select received_at <= clock_timestamp() as at_or_before from public.contact_messages where id = ${ahead}::uuid`);
    expect(row!.at_or_before).toBe(true);
    const order = await orderForTest(w.apiDb, staff, { messageId: ahead, links: ["https://elsewhere.example/ahead"] });
    orders.push(order.id);
    expect(order.channel).toBe("mailbox");
    expect(order.receivedAt).not.toBeNull();
    expect(Date.parse(order.receivedAt!)).toBeLessThanOrEqual(Date.parse(order.openedAt));
  });

  test("leaves no row behind", async () => {
    await removeOrders(w.migrateDb, orders.splice(0));
    await removeMessages(w.migrateDb, messages.splice(0));
    await removeOrderAlerts(w.migrateDb, started);
    expect(await rowCounts(w.apiDb, [...ORDER_TABLES, ...CHANNEL_TABLES])).toEqual(before);
  });
});
