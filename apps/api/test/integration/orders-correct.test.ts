import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { OrderCorrectFacts, OrderView } from "@korbat/contracts";
import type { Db, DbTx } from "@korbat/db";
import { ModerationError, createBackground } from "../../src/moderation/context";
import { correctOrderRecord } from "../../src/moderation/orders";
import { CHANNEL_TABLES, aPost, decideIn, ground, imagePost, intake, moderationDeps, newTestStaff, raised, removeFixtures, rowCounts, staffProfile, type TestStaff } from "./moderation-fixtures";
import { newProfile } from "./social-fixtures";
import { noticesWorld, type NoticesWorld } from "./notices-harness";
import { closeNotifyFixtures, contactMessageForTest, outboxSince, removeMessages } from "./notify-fixtures";
import { ORDER_TABLES, removeOrderAlerts, disableItemForTest, effectParams, effectWith, orderConfig, orderConfirmation, orderForTest, removeOrders, sessionOf } from "./orders-fixtures";
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

  test("after a real effect (Task 3): setting Section C untells every told decision of the order and keeps the post from its author; one that told nobody stays so; unsetting it ends the hold as not_ordered; a changed withholding derives the level again", async () => {
    await rolledBack(w.apiDb, async (tx) => {
      const p = await imagePost(tx, 0);
      const reporter = await newProfile(tx as unknown as Db);
      const order = await orderForTest(tx, moderator, { kind: "dsa_art9", posts: [p.postId], withholdFromAuthor: false });
      const done = await effectWith(tx, admin, order.id, { ...effectParams(order), urgent: true });
      const decisionId = done.items[0]!.decisionId!;
      // A report about the post answered "no breach" after the effect: korbat tells its author nothing of it.
      const reported = await intake(tx, ground.rule(reporter.id), aPost(p.postId));
      const noBreach = await decideIn(tx, moderator, reported.items[0]!.caseId!, { kind: "final", outcome: "no_violation" });
      const row = async (id: string) =>
        (await tx.execute<{ informed: boolean; mail: string }>(sql`select informed_at is not null as informed, author_mail::text as mail from public.decisions where id = ${id}::uuid`))[0]!;
      const level = async () => (await tx.execute<{ level: string }>(sql`select moderation_level::text as level from public.posts where id = ${p.postId}::uuid`))[0]!.level;
      expect([await row(decisionId), await level()]).toEqual([{ informed: true, mail: "pending" }, "removed"]);
      const caution = view(await correct(tx, moderator, order.id, { sectionC: true }));
      expect(caution.events.at(-1)).toMatchObject({ kind: "corrected", ground: "caution" });
      expect(await row(decisionId)).toEqual({ informed: false, mail: "none" });
      expect(await row(noBreach)).toEqual({ informed: true, mail: "none" });
      expect(await level()).toBe("disabled");
      // Unsetting it is an admin's, under the key: the hold ends as korbat's mistake, and the withholding follows when unset too.
      const unset = view(await correct(tx, admin, order.id, { sectionC: false, withholdFromAuthor: false }, true));
      expect(unset.events.map((e) => [e.kind, e.ground]).slice(-2)).toEqual([
        ["hold_ended", "not_ordered"],
        ["corrected", "admin"],
      ]);
      expect(await level()).toBe("removed");
      expect((await tx.execute<{ told: number }>(sql`select public.order_notices_release() as told`))[0]!.told).toBe(1);
      expect(await row(decisionId)).toEqual({ informed: true, mail: "pending" });
      expect(await row(noBreach)).toEqual({ informed: true, mail: "none" });
    });
  });

  test("\"must not be told\" set again after an admin unset it holds again: the not_ordered end is cleared, the release tells nothing, and a later disabling of the order is held", async () => {
    await rolledBack(w.apiDb, async (tx) => {
      const p = await imagePost(tx, 0);
      const q = await imagePost(tx, 0);
      const order = await orderForTest(tx, admin, { posts: [p.postId, q.postId], sectionC: true });
      const first = order.items.find((item) => item.postId === p.postId)!;
      const second = order.items.find((item) => item.postId === q.postId)!;
      const done = await effectWith(tx, admin, order.id, effectParams(order, { itemIds: [first.id] }));
      const firstDecision = done.items.find((item) => item.id === first.id)!.decisionId!;
      const row = async (id: string) =>
        (await tx.execute<{ informed: boolean; mail: string }>(sql`select informed_at is not null as informed, author_mail::text as mail from public.decisions where id = ${id}::uuid`))[0]!;
      const hold = async () =>
        (await tx.execute<{ holding: boolean; reason: string | null }>(sql`select coalesce(public.order_hold_until(id) > now(), false) as holding, hold_end_reason as reason from public.legal_orders where id = ${order.id}::uuid`))[0]!;
      expect(await row(firstDecision)).toEqual({ informed: false, mail: "none" });
      // An admin unsets it under the key: the hold ends as korbat's mistake.
      view(await correct(tx, admin, order.id, { sectionC: false }, true));
      expect(await hold()).toEqual({ holding: false, reason: "not_ordered" });
      // A moderator sets it again, the cautious direction anyone on call may take: the hold runs again.
      const again = view(await correct(tx, moderator, order.id, { sectionC: true }));
      expect(again.events.at(-1)).toMatchObject({ kind: "corrected", ground: "caution" });
      expect(await hold()).toEqual({ holding: true, reason: null });
      expect((await tx.execute<{ told: number }>(sql`select public.order_notices_release() as told`))[0]!.told).toBe(0);
      expect(await row(firstDecision)).toEqual({ informed: false, mail: "none" });
      // A later disabling of the order is held with it, not told at once.
      const later = await effectWith(tx, admin, order.id, effectParams(again, { itemIds: [second.id] }));
      expect(await row(later.items.find((item) => item.id === second.id)!.decisionId!)).toEqual({ informed: false, mail: "none" });
    });
  });

  test("a removal order corrected to another kind and back is preserved again: the end is cleared, the post preserved and frozen, and the item's preservation runs as order-access reads it", async () => {
    await rolledBack(w.apiDb, async (tx) => {
      const p = await imagePost(tx, 1);
      const order = await orderForTest(tx, moderator, { posts: [p.postId] });
      await effectWith(tx, moderator, order.id, effectParams(order));
      // running is the condition order-access and order-preserve-extend read (cli/orders.ts, lockItem).
      const item = async () =>
        (await tx.execute<{ running: boolean; preserved: boolean; frozen: boolean; fromDecision: boolean }>(sql`
          select coalesce(i.preserve_until > now() and i.preserve_ended_at is null, false) as running, public.post_preserved(i.post_id) as preserved,
                 public.post_frozen(i.post_id) as frozen, coalesce(i.preserve_until = public.order_preserve_until(d.decided_at), false) as "fromDecision"
            from public.legal_order_items i join public.decisions d on d.id = i.decision_id where i.order_id = ${order.id}::uuid`))[0]!;
      const preserved = { running: true, preserved: true, frozen: true, fromDecision: true };
      expect(await item()).toEqual(preserved);
      view(await correct(tx, admin, order.id, { kind: "dsa_art9" }, true));
      expect(await item()).toMatchObject({ running: false, preserved: false, frozen: false });
      view(await correct(tx, admin, order.id, { kind: "tco_removal" }, true));
      expect(await item()).toEqual(preserved);
    });
  });

  /**
   * The race of a correction that closes an item with "Disable for an order" on the same order (section 5, items 1 and
   * 2), on committed rows: a third session holds a row the effect or the correction must wait for, for a moment. The
   * effect runs in a transaction that is rolled back at its end, as the made-up confirmation asks; the correction commits.
   */
  async function race(hold: "case" | "item"): Promise<{ effect: string; correction: string; closed: string | null }> {
    const authors: string[] = [];
    const made = [await imagePost(w.apiDb, 0), await imagePost(w.apiDb, 0)].sort((a, b) => (a.postId < b.postId ? -1 : 1));
    for (const m of made) authors.push(m.authorId);
    // A report keeps a case open on the second post, which the effect takes before the order's row.
    const reporter = await newProfile(w.apiDb);
    authors.push(reporter.id);
    const caseId = (await intake(w.apiDb, ground.rule(reporter.id), aPost(made[1]!.postId))).items[0]!.caseId!;
    const order = await orderForTest(w.apiDb, moderator, { posts: made.map((m) => m.postId) });
    orders.push(order.id);
    const first = order.items.find((item) => item.postId === made[0]!.postId)!;
    let effect = "none";
    let correction = "none";
    try {
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      const holder = w.migrateDb.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '20s'`);
        if (hold === "case") await tx.execute(sql`select 1 from public.cases where id = ${caseId}::uuid for update`);
        else await tx.execute(sql`select 1 from public.legal_order_items where id = ${first.id}::uuid for update`);
        await released;
      });
      await sleep(200);
      const runEffect = () =>
        w.apiDb
          .transaction(async (tx) => {
            try {
              const done = await effectWith(tx, moderator, order.id, effectParams(order));
              effect = done.items.map((item) => (item.inForce ? "in force" : item.closedAt !== null ? "closed" : "open")).join(",");
            } catch (err) {
              effect = err instanceof ModerationError ? err.code : `${String(err)} ${String((err as { cause?: unknown }).cause)}`;
            }
            throw new Error("the effect's transaction is rolled back");
          })
          .catch(() => undefined);
      const runCorrection = async () => {
        const outcome = await correct(w.apiDb, admin, order.id, { closeItems: [{ itemId: first.id, reason: "no_post" }] });
        correction = typeof outcome === "string" ? outcome : "corrected";
      };
      // With the case held, the effect starts first and waits on the second post's case holding the first item; with the
      // item held, the correction starts first and waits for it, and the effect after it.
      const [a, b] = hold === "case" ? [runEffect, runCorrection] : [runCorrection, runEffect];
      const started = [a()];
      await sleep(800);
      started.push(b());
      await sleep(800);
      release();
      await holder;
      await Promise.all(started);
      const [row] = await w.apiDb.execute<{ reason: string | null }>(sql`select closed_reason as reason from public.legal_order_items where id = ${first.id}::uuid`);
      return { effect, correction, closed: row!.reason };
    } finally {
      await removeFixtures(w.migrateDb, authors);
    }
  }

  test("a correction that closes an item meets an effect on the same order: never a deadlock; it waits for the effect and is refused, or commits first and the effect is refused", async () => {
    // The effect holds the first item and waits for the second post's case; the correction comes then. The correction
    // waits for the first item before it takes the order's row, so the effect goes on to the end; the correction then
    // closes the first item, which the rolled-back effect left open.
    const effectFirst = await race("case");
    expect(effectFirst).toEqual({ effect: "in force,in force", correction: "corrected", closed: "no_post" });
    // The correction holds the order's items first and closes the first one; the effect, which read the order before,
    // then holds that item and finds it closed: it gives effect to nothing (order_changed), and the closing stands.
    const correctionFirst = await race("item");
    expect(correctionFirst).toEqual({ effect: "order_changed", correction: "corrected", closed: "no_post" });
  });

  test("leaves no row behind", async () => {
    await removeOrders(w.migrateDb, orders.splice(0));
    await removeMessages(w.migrateDb, messages.splice(0));
    await removeOrderAlerts(w.migrateDb, started);
    expect(await rowCounts(w.apiDb, [...ORDER_TABLES, ...CHANNEL_TABLES])).toEqual(before);
  });
});
