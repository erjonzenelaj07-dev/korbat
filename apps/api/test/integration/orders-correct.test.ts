import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { OrderCorrectFacts, OrderView } from "@korbat/contracts";
import type { Db, DbTx } from "@korbat/db";
import { ModerationError, createBackground } from "../../src/moderation/context";
import { correctOrderRecord } from "../../src/moderation/orders";
import { CHANNEL_TABLES, moderationDeps, newTestStaff, raised, removeFixtures, rowCounts, staffProfile, type TestStaff } from "./moderation-fixtures";
import { noticesWorld, type NoticesWorld } from "./notices-harness";
import { closeNotifyFixtures, contactMessageForTest, outboxSince, removeMessages } from "./notify-fixtures";
import { ORDER_TABLES, removeOrderAlerts, disableItemForTest, orderConfig, orderConfirmation, orderForTest, removeOrders, sessionOf } from "./orders-fixtures";
import { rolledBack } from "./staff-fixtures";

vi.setConfig({ testTimeout: 90_000 });

/**
 * Correcting what a person entered (3f design, section 2 rows 7 and 25, sections 6.2 and 7.4; invariants 25 before any
 * effect and 26's closings). Before any item is disabled any staff member corrects every member the form took (the rule
 * entry): the event corrected, the plain audit row order_corrected with the changed members, and the forced columns as at
 * the insert. Once an item is disabled, setting "must not be told" and nothing else is anyone's without a key (caution),
 * and everything else is an admin's under the step-up (admin), which "step_up_required" answers without one, keeping
 * nothing. A channel is corrected only on an order opened without a message. An item is closed with one of three reasons
 * while it is open. A correction onto another order's state, authority and reference is order_exists; a closed order
 * takes none. Every correction raises order_corrected. The disabling an effect will write (Task 3) is set here by the
 * migrator, on committed orders the last test removes.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: correcting an order's record", () => {
  let w: NoticesWorld;
  let moderator: TestStaff;
  let admin: TestStaff;
  let before: Record<string, number>;
  const orders: string[] = [];
  const messages: string[] = [];
  const started = new Date();

  beforeAll(async () => {
    w = noticesWorld();
    moderator = await newTestStaff(w.authDb, w.migrateDb, w.repo, "moderator");
    admin = await newTestStaff(w.authDb, w.migrateDb, w.repo, "admin");
    await staffProfile(w.apiDb, moderator);
    await staffProfile(w.apiDb, admin);
    // Counted once the staff and the profiles stand: they leave in afterAll, after the last count.
    before = await rowCounts(w.apiDb, [...ORDER_TABLES, ...CHANNEL_TABLES]);
  }, 60_000);
  afterAll(async () => {
    await removeOrders(w.migrateDb, orders);
    await removeMessages(w.migrateDb, messages);
    await removeFixtures(w.migrateDb, [moderator.id, admin.id]);
    await closeNotifyFixtures();
    await w.close();
  });

  /** A correction through the module, by the account given, with the key's confirmation when asked; answers the outcome or the refusal's code. */
  async function correct(db: Db | DbTx, by: TestStaff, orderId: string, facts: OrderCorrectFacts, keyed = false): Promise<OrderView | string> {
    const background = createBackground(pino({ level: "silent" }));
    const deps = moderationDeps(db, { config: orderConfig(), background });
    try {
      const outcome = await correctOrderRecord(deps, sessionOf(by), orderId, facts, keyed ? orderConfirmation(by, "order_corrected", orderId, { facts }) : null, { requestId: `req-${randomUUID()}` });
      await background.settle();
      return outcome;
    } catch (err) {
      return err instanceof ModerationError ? err.code : `${String(err)} ${String((err as { cause?: unknown }).cause)}`;
    }
  }
  const view = (outcome: OrderView | string): OrderView => {
    if (typeof outcome === "string") throw new Error(`refused: ${outcome}`);
    return outcome;
  };
  const lastAudit = async (db: Db | DbTx, orderId: string) =>
    (await db.execute<{ action: string; actor_id: string; step_up: unknown; metadata: Record<string, unknown> }>(
      sql`select action, actor_id, step_up, metadata from public.audit_log where target_id = ${orderId} order by chain_seq desc limit 1`,
    ))[0]!;

  test("before any effect, any staff member corrects every member the form took, without a key: the event corrected under entry, the plain audit row with what changed, the forced columns, and the alert", async () => {
    await rolledBack(w.apiDb, async (tx) => {
      const since = new Date();
      const order = await orderForTest(tx, moderator, { kind: "dsa_art9", channel: "portal", links: ["https://elsewhere.example/c1"], withholdFromAuthor: false, memberState: "DE" });
      const corrected = view(
        await correct(tx, moderator, order.id, { kind: "tco_removal", memberState: "FR", authority: "Office central", reference: "FR-2026-9", channel: "post", emergency: true }),
      );
      expect([corrected.kind, corrected.memberState, corrected.crossBorder, corrected.authority, corrected.reference, corrected.channel, corrected.emergency]).toEqual([
        "tco_removal",
        "FR",
        true,
        "Office central",
        "FR-2026-9",
        "post",
        true,
      ]);
      // A removal order withholds and preserves, by force.
      expect([corrected.withholdFromAuthor, corrected.preserve]).toEqual([true, true]);
      expect(corrected.events.map((e) => [e.kind, e.ground, e.via])).toEqual([
        ["opened", null, "console"],
        ["corrected", "entry", "console"],
      ]);
      const audit = await lastAudit(tx, order.id);
      expect([audit.action, audit.actor_id, audit.step_up]).toEqual(["order_corrected", moderator.id, null]);
      expect(audit.metadata.rule).toBe("entry");
      expect(audit.metadata.eventId).toBe(corrected.events[1]!.id);
      // The members the request changed, and crossBorder, which the API sets with memberState; what the database forces
      // follows them and is no member of the request.
      expect((audit.metadata.changed as { member: string }[]).map((c) => c.member).sort()).toEqual(["authority", "channel", "crossBorder", "emergency", "kind", "memberState", "reference"]);
      expect(audit.metadata.changed).toContainEqual({ member: "kind", from: "dsa_art9", to: "tco_removal" });
      const alerts = await outboxSince(tx, "order_corrected", since);
      expect(alerts.map((a) => [a.priority, a.scope, a.facts.count])).toEqual([[3, "all", 7]]);
      // Section C set forces the withholding.
      const dsa = await orderForTest(tx, moderator, { kind: "dsa_art9", links: ["https://elsewhere.example/c2"], withholdFromAuthor: false });
      expect(view(await correct(tx, moderator, dsa.id, { sectionC: true })).withholdFromAuthor).toBe(true);
    });
  });

  test("a channel is corrected only on an order opened without a message; a member outside the list is refused", async () => {
    const m = await contactMessageForTest(new Date(Date.now() - 60_000), "inbox");
    messages.push(m);
    await rolledBack(w.apiDb, async (tx) => {
      const fromMessage = await orderForTest(tx, moderator, { messageId: m, links: ["https://elsewhere.example/c3"] });
      expect(await correct(tx, moderator, fromMessage.id, { channel: "portal" })).toBe("invalid_request");
      const below = await tx
        .transaction((sp) => sp.execute(sql`select public.order_correct(${fromMessage.id}::uuid, '{"openedAt": "2026-01-01T00:00:00Z"}'::jsonb, ${moderator.id}::uuid)`))
        .then(() => null, (err: unknown) => raised(err)?.message);
      expect(below).toBe("invalid_request");
    });
  });

  test("an item is closed with one of three reasons while it is open; another word, a closed item and another order's item are refused", async () => {
    await rolledBack(w.apiDb, async (tx) => {
      const order = await orderForTest(tx, moderator, { links: ["https://elsewhere.example/i1", "https://elsewhere.example/i2", "https://elsewhere.example/i3", "https://elsewhere.example/i4"] });
      const other = await orderForTest(tx, moderator, { links: ["https://elsewhere.example/o1"] });
      const [a, b, c, d] = order.items.map((i) => i.id);
      const closed = view(
        await correct(tx, moderator, order.id, {
          closeItems: [
            { itemId: a!, reason: "no_post" },
            { itemId: b!, reason: "not_named" },
            { itemId: c!, reason: "withdrawn" },
          ],
        }),
      );
      expect(closed.items.map((i) => i.closedReason)).toEqual(["no_post", "not_named", "withdrawn", null]);
      expect(closed.clock!.itemsOpen).toBe(1);
      expect(await correct(tx, moderator, order.id, { closeItems: [{ itemId: a!, reason: "no_post" }] })).toBe("invalid_request");
      expect(await correct(tx, moderator, order.id, { closeItems: [{ itemId: other.items[0]!.id, reason: "no_post" }] })).toBe("invalid_request");
      const word = await tx
        .transaction((sp) => sp.execute(sql`select public.order_correct(${order.id}::uuid, ${JSON.stringify({ closeItems: [{ itemId: d, reason: "wrong_item" }] })}::jsonb, ${moderator.id}::uuid)`))
        .then(() => null, (err: unknown) => raised(err)?.message);
      expect(word).toBe("invalid_request");
    });
  });

  test("onto another order's state, authority and reference: order_exists with the order that stands; a closed order takes no correction", async () => {
    await rolledBack(w.apiDb, async (tx) => {
      const first = await orderForTest(tx, moderator, { reference: "SAME-1", links: ["https://elsewhere.example/s1"] });
      const second = await orderForTest(tx, moderator, { reference: "SAME-2", links: ["https://elsewhere.example/s2"] });
      const background = createBackground(pino({ level: "silent" }));
      const refused = await correctOrderRecord(moderationDeps(tx, { config: orderConfig(), background }), sessionOf(moderator), second.id, { reference: "SAME-1" }, null, { requestId: "r" }).then(
        () => null,
        (err: unknown) => (err instanceof ModerationError ? { code: err.code, details: err.details } : String(err)),
      );
      expect(refused).toEqual({ code: "order_exists", details: { orderId: first.id } });
      await tx.execute(sql`select public.order_event_record(${second.id}::uuid, 'closed_without_effect', 'withdrawn', null, ${admin.id}::uuid)`);
      expect(await correct(tx, moderator, second.id, { emergency: true })).toBe("order_closed");
    });
  });

  test("once an item is disabled: Section C set alone is caution, anyone's without a key; anything else is admin: refused to a moderator, step_up_required without the key, and confirmed with it", async () => {
    const order = await orderForTest(w.apiDb, moderator, { kind: "dsa_art9", links: ["https://elsewhere.example/e1", "https://elsewhere.example/e2"], withholdFromAuthor: false });
    orders.push(order.id);
    await disableItemForTest(w.migrateDb, order.items[0]!.id);
    await rolledBack(w.apiDb, async (tx) => {
      const caution = view(await correct(tx, moderator, order.id, { sectionC: true }));
      expect(caution.events.at(-1)).toMatchObject({ kind: "corrected", ground: "caution" });
      expect([caution.sectionC, caution.withholdFromAuthor, caution.mayCorrect]).toEqual([true, true, "caution"]);
      expect((await lastAudit(tx, order.id)).step_up).toBeNull();
    });
    await rolledBack(w.apiDb, async (tx) => {
      expect(await correct(tx, moderator, order.id, { emergency: true })).toBe("admin_required");
      expect(await correct(tx, moderator, order.id, { sectionC: true, emergency: true })).toBe("admin_required");
      expect(await correct(tx, moderator, order.id, { closeItems: [{ itemId: order.items[1]!.id, reason: "no_post" }] })).toBe("admin_required");
      // A disabled item is never closed: a wrong one is reinstated (Task 3).
      expect(await correct(tx, admin, order.id, { closeItems: [{ itemId: order.items[0]!.id, reason: "not_named" }] }, true)).toBe("invalid_request");
      // Without the key the admin's correction keeps nothing.
      expect(await correct(tx, admin, order.id, { emergency: true })).toBe("step_up_required");
      const [row] = await tx.execute<{ emergency: boolean; events: number }>(
        sql`select o.emergency, (select count(*)::int from public.legal_order_events e where e.order_id = o.id) as events from public.legal_orders o where o.id = ${order.id}::uuid`,
      );
      expect(row).toEqual({ emergency: false, events: 1 });
      const confirmed = view(await correct(tx, admin, order.id, { emergency: true, kind: "tco_removal" }, true));
      expect(confirmed.events.at(-1)).toMatchObject({ kind: "corrected", ground: "admin" });
      expect([confirmed.emergency, confirmed.kind, confirmed.preserve, confirmed.withholdFromAuthor]).toEqual([true, "tco_removal", true, true]);
      const audit = await lastAudit(tx, order.id);
      expect(audit.step_up).not.toBeNull();
      expect(audit.metadata).toMatchObject({ rule: "admin", params: { facts: { emergency: true, kind: "tco_removal" } } });
    });
  });

  test("leaves no row behind", async () => {
    await removeOrders(w.migrateDb, orders.splice(0));
    await removeMessages(w.migrateDb, messages.splice(0));
    await removeOrderAlerts(w.migrateDb, started);
    expect(await rowCounts(w.apiDb, [...ORDER_TABLES, ...CHANNEL_TABLES])).toEqual(before);
  });
});
