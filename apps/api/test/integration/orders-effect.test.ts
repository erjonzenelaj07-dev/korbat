import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { CaseView, ORDER_RULES, SOURCE_LABELS, type CaseDecidedParams, type OrderView } from "@korbat/contracts";
import type { Db, DbTx } from "@korbat/db";
import { authorCases } from "../../src/moderation/author";
import { readCase } from "../../src/moderation/cases";
import { ModerationError } from "../../src/moderation/context";
import { CHANNEL_TABLES, imagePost, madeUpConfirmation, moderationDeps, newTestStaff, removeFixtures, report, aPost, rowCounts, staffProfile, type TestStaff } from "./moderation-fixtures";
import { noticesWorld, type NoticesWorld } from "./notices-harness";
import { closeNotifyFixtures } from "./notify-fixtures";
import { ORDER_TABLES, effectParams, effectWith, orderForTest, removeOrderAlerts, removeOrders } from "./orders-fixtures";
import { rolledBack } from "./staff-fixtures";

vi.setConfig({ testTimeout: 120_000 });

/**
 * "Disable for an order" (3f design, sections 6.3 and 7.6; invariants 5, 6, 8 and 27). One key touch gives effect to up
 * to ten items: one intake of the kind order, one order decision a post with its one disable_by_order, each item's
 * intake item answered, the posts disabled for everyone, the items' disabling and preservation, the events, and one audit
 * row order_effected that names every decision under its item. An unverified DSA Article 9 order is given effect only by
 * an admin who signs urgent; signed facts that differ from the order, and an item that is not the order's, are
 * order_changed; an item already given effect is refused. Every test runs in a transaction that is rolled back.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: giving effect to an order", () => {
  let w: NoticesWorld;
  let moderator: TestStaff;
  let admin: TestStaff;
  let before: Record<string, number>;
  const started = new Date();

  beforeAll(async () => {
    w = noticesWorld();
    moderator = await newTestStaff(w.authDb, w.migrateDb, w.repo, "moderator");
    admin = await newTestStaff(w.authDb, w.migrateDb, w.repo, "admin");
    await staffProfile(w.apiDb, moderator);
    await staffProfile(w.apiDb, admin);
    before = await rowCounts(w.apiDb, [...ORDER_TABLES, ...CHANNEL_TABLES]);
  }, 60_000);
  afterAll(async () => {
    expect(await rowCounts(w.apiDb, [...ORDER_TABLES, ...CHANNEL_TABLES])).toEqual(before);
    await removeFixtures(w.migrateDb, [moderator.id, admin.id]);
    await closeNotifyFixtures();
    await w.close();
  });

  /** The effect's refusal as its code, or the view. */
  async function effect(tx: DbTx, by: TestStaff, view: OrderView, params: Record<string, unknown> = effectParams(view)): Promise<OrderView | string> {
    try {
      return await effectWith(tx, by, view.id, params);
    } catch (err) {
      if (err instanceof ModerationError) return err.code;
      throw err;
    }
  }
  const asView = (outcome: OrderView | string): OrderView => {
    if (typeof outcome === "string") throw new Error(`refused: ${outcome}`);
    return outcome;
  };
  const decisionsOf = (tx: DbTx, orderId: string) =>
    tx.execute<{ id: string; kind: string; source: string; outcome: string; ground: string; category: string; category_keyword: string | null; informed: boolean; told_now: boolean; author_mail: string; needs_admin: boolean; through_seq: number }>(sql`
      select d.id, d.kind::text as kind, d.source::text as source, d.outcome::text as outcome, d.ground::text as ground, d.category, d.category_keyword,
             d.informed_at is not null as informed, d.informed_at = d.decided_at as told_now, d.author_mail::text as author_mail, d.needs_admin, d.through_seq
        from public.decisions d join public.legal_order_items i on i.id = d.order_item_id where i.order_id = ${orderId}::uuid order by i.position`);

  test("two posts with one key: one intake of the kind order, one decision a post with its one measure, the posts disabled for everyone, the items' disabling and preservation, the events and one audit row; told at once without Section C", async () => {
    await rolledBack(w.apiDb, async (tx) => {
      const a = await imagePost(tx, 2);
      const b = await imagePost(tx, 0);
      const order = await orderForTest(tx, moderator, { posts: [a.postId, b.postId] });
      const done = asView(await effect(tx, moderator, order));
      expect(done.state).toBe("given_effect");
      expect(done.items.map((item) => [item.inForce, item.disabledAt !== null, item.noEffect])).toEqual([
        [true, true, null],
        [true, true, null],
      ]);
      // Six calendar months and a day from the disabling, the form of order_preserve_until.
      for (const item of done.items) {
        const months = new Date(item.disabledAt!);
        months.setUTCMonth(months.getUTCMonth() + ORDER_RULES.preserveMonths);
        months.setUTCDate(months.getUTCDate() + ORDER_RULES.preserveMarginDays);
        expect(Date.parse(item.preserveUntil!)).toBe(months.getTime());
      }
      const posts = await tx.execute<{ state: string; level: string }>(sql`select state::text as state, moderation_level::text as level from public.posts where id in (${a.postId}::uuid, ${b.postId}::uuid)`);
      expect(posts.map((p) => [p.state, p.level])).toEqual([
        ["disabled", "disabled"],
        ["disabled", "disabled"],
      ]);
      // The images keep their own state: no reader serves an image of a disabled post, whatever its state.
      const images = await tx.execute<{ state: string }>(sql`select moderation_state::text as state from public.post_media where post_id = ${a.postId}::uuid`);
      expect(images.map((i) => i.state)).toEqual(["visible", "visible"]);
      const decisions = await decisionsOf(tx, order.id);
      expect(decisions.map((d) => [d.kind, d.source, d.outcome, d.ground, d.category, d.category_keyword, d.told_now, d.author_mail, d.needs_admin, d.through_seq])).toEqual([
        ["order", "order", "restricted", "illegal", "STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY", "KEYWORD_TERRORIST_CONTENT", true, "pending", false, 0],
        ["order", "order", "restricted", "illegal", "STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY", "KEYWORD_TERRORIST_CONTENT", true, "pending", false, 0],
      ]);
      const intakes = await tx.execute<{ kind: string; channel: string; receipt: string; outcome: string; outcome_mail: string; lane: number }>(sql`
        select n.kind::text as kind, n.channel::text as channel, n.receipt::text as receipt, i.outcome::text as outcome, i.outcome_mail::text as outcome_mail, i.lane
          from public.legal_order_items o join public.intake_items i on i.id = o.intake_item_id join public.intakes n on n.id = i.intake_id
         where o.order_id = ${order.id}::uuid order by o.position`);
      expect(intakes.map((i) => [i.kind, i.channel, i.receipt, i.outcome, i.outcome_mail, i.lane])).toEqual([
        ["order", "authority", "none", "restricted_legal", "none", 0],
        ["order", "authority", "none", "restricted_legal", "none", 0],
      ]);
      // The cases the effect opened are closed by their only item's answer.
      const cases = await tx.execute<{ closed: boolean; equal: boolean }>(sql`
        select c.closed_at is not null as closed, c.answered_seq = c.intake_seq as equal from public.cases c where c.target_type = 'post' and c.target_id in (${a.postId}::uuid, ${b.postId}::uuid)`);
      expect(cases.map((c) => [c.closed, c.equal])).toEqual([
        [true, true],
        [true, true],
      ]);
      expect(done.events.filter((e) => e.kind === "effect_given").map((e) => [e.via, e.by !== null])).toEqual([
        ["console", true],
        ["console", true],
      ]);
      const [audit] = await tx.execute<{ action: string; target_id: string; metadata: { decisionIds: Record<string, string>; params: { items: unknown[] } } }>(
        sql`select action, target_id, metadata from public.audit_log order by chain_seq desc limit 1`,
      );
      expect([audit!.action, audit!.target_id]).toEqual(["order_effected", order.id]);
      expect(Object.values(audit!.metadata.decisionIds).sort()).toEqual(decisions.map((d) => d.id).sort());
      expect(audit!.metadata.params.items).toHaveLength(2);
    });
  });

  test("with Section C the notices are held: no informed_at and no mail; the post is disabled whatever the request said", async () => {
    await rolledBack(w.apiDb, async (tx) => {
      const a = await imagePost(tx, 0);
      const order = await orderForTest(tx, moderator, { posts: [a.postId], sectionC: true });
      asView(await effect(tx, moderator, order));
      const [d] = await decisionsOf(tx, order.id);
      expect([d!.informed, d!.author_mail]).toEqual([false, "none"]);
      // A DSA Article 9 order whose author must not be told withholds by force: disabled, and held.
      const b = await imagePost(tx, 0);
      const dsa = await orderForTest(tx, admin, { kind: "dsa_art9", posts: [b.postId], sectionC: true });
      const verified = asView(await effect(tx, admin, dsa, { ...effectParams(dsa), urgent: true }));
      expect(verified.items[0]!.inForce).toBe(true);
      const [level] = await tx.execute<{ level: string }>(sql`select moderation_level::text as level from public.posts where id = ${b.postId}::uuid`);
      expect(level!.level).toBe("disabled");
      const [held] = await decisionsOf(tx, dsa.id);
      expect([held!.informed, held!.author_mail]).toEqual([false, "none"]);
    });
  });

  test("a DSA Article 9 order is verified before effect: refused for a moderator and for an admin without urgent; an admin's urgent effect needs an admin; urgent on a removal order is refused", async () => {
    await rolledBack(w.apiDb, async (tx) => {
      const a = await imagePost(tx, 0);
      const dsa = await orderForTest(tx, moderator, { kind: "dsa_art9", posts: [a.postId], withholdFromAuthor: false });
      expect(await effect(tx, moderator, dsa)).toBe("order_not_verified");
      expect(await effect(tx, moderator, dsa, { ...effectParams(dsa), urgent: true })).toBe("order_not_verified");
      expect(await effect(tx, admin, dsa)).toBe("order_not_verified");
      const urgent = asView(await effect(tx, admin, dsa, { ...effectParams(dsa), urgent: true }));
      expect(urgent.items[0]!.inForce).toBe(true);
      // Not withheld from its author: removed, told at once, and nothing preserved.
      expect(urgent.items[0]!.preserveUntil).toBeNull();
      const [post] = await tx.execute<{ level: string }>(sql`select moderation_level::text as level from public.posts where id = ${a.postId}::uuid`);
      expect(post!.level).toBe("removed");
      const [d] = await decisionsOf(tx, dsa.id);
      expect([d!.category, d!.category_keyword, d!.told_now, d!.author_mail, d!.needs_admin]).toEqual(["STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE", null, true, "pending", true]);
    });
  });

  test("a verified DSA order is given effect by any staff member, and urgent signed for it is refused", async () => {
    // The verification is the migrator's (order-verify): the order and its post are committed, and removed after.
    const b = await imagePost(w.apiDb, 0);
    const verified = await orderForTest(w.apiDb, moderator, { kind: "dsa_art9", posts: [b.postId], withholdFromAuthor: false });
    try {
      await w.migrateDb.execute(sql`update public.legal_orders set verified_at = now(), verified_how = 'test' where id = ${verified.id}::uuid`);
      await rolledBack(w.apiDb, async (tx) => {
        expect(await effect(tx, admin, verified, { ...effectParams(verified), urgent: true })).toBe("invalid_decision");
        expect(asView(await effect(tx, moderator, verified)).items[0]!.inForce).toBe(true);
      });
    } finally {
      await removeOrders(w.migrateDb, [verified.id]);
      await removeOrderAlerts(w.migrateDb, started);
      await removeFixtures(w.migrateDb, [b.authorId]);
    }
  });

  test("signed facts that differ from the order, and an item that is not the order's, are order_changed; an item in force is not given effect twice", async () => {
    await rolledBack(w.apiDb, async (tx) => {
      const a = await imagePost(tx, 0);
      const b = await imagePost(tx, 0);
      const order = await orderForTest(tx, moderator, { posts: [a.postId] });
      const other = await orderForTest(tx, moderator, { posts: [b.postId] });
      expect(await effect(tx, moderator, order, { ...effectParams(order), reference: "something else" })).toBe("order_changed");
      expect(await effect(tx, moderator, order, { ...effectParams(order), items: effectParams(other).items })).toBe("order_changed");
      asView(await effect(tx, moderator, order));
      expect(await effect(tx, moderator, order, { ...effectParams(order, { itemIds: [order.items[0]!.id] }) })).toBe("invalid_decision");
    });
  });

  test("an order answers only its own item: a report on the same post stays open with its lane, and the case stays open", async () => {
    await rolledBack(w.apiDb, async (tx) => {
      const a = await imagePost(tx, 0);
      const reported = await report(tx, aPost(a.postId), "rule");
      const order = await orderForTest(tx, moderator, { posts: [a.postId] });
      asView(await effect(tx, moderator, order));
      const items = await tx.execute<{ kind: string; answered: boolean }>(sql`
        select n.kind::text as kind, i.answered_by is not null as answered from public.intake_items i join public.intakes n on n.id = i.intake_id
         where i.case_id = ${reported.caseId}::uuid order by i.seq`);
      expect(items.map((i) => [i.kind, i.answered])).toEqual([
        ["user", false],
        ["order", true],
      ]);
      const [kase] = await tx.execute<{ closed: boolean; lane: number; answered_seq: number }>(sql`select closed_at is not null as closed, lane, answered_seq from public.cases where id = ${reported.caseId}::uuid`);
      expect([kase!.closed, kase!.answered_seq]).toEqual([false, 0]);
    });
  });

  test("the staff case page of an order's case reads as the contracts' CaseView: the authority's item with its order, Order with its measure withheld from its author, the level disabled, the post preserved; the author's row says disabled or removed", async () => {
    await rolledBack(w.apiDb, async (tx) => {
      const p = await imagePost(tx, 1);
      const order = await orderForTest(tx, moderator, { posts: [p.postId] });
      const done = asView(await effect(tx, moderator, order));
      const caseId = done.items[0]!.caseId!;
      const { session } = madeUpConfirmation(moderator, caseId, {} as CaseDecidedParams);
      const read = await readCase(moderationDeps(tx), session, caseId);
      // The console parses the answer with the contracts: an order's item, decision and history are among what it takes.
      expect(CaseView.safeParse(read).success).toBe(true);
      const item = read.items.find((each) => each.source.kind === "authority")!;
      expect([item.source.label, item.orderId, item.outcome]).toEqual([SOURCE_LABELS.authority, order.id, "restricted_legal"]);
      const decision = read.decisions.find((each) => each.kind === "order")!;
      expect(decision.actions.map((a) => [a.kind, a.inForce, a.orderId, a.withholdAuthor])).toEqual([["disable_by_order", true, order.id, true]]);
      expect(read.target.type === "post" ? read.target.level : null).toBe("disabled");
      expect(read.preserved).toBe(true);
      expect(read.snapshots.every((s) => s.withheld)).toBe(true);
      expect(read.noticeHeld).toBeNull();
      expect(read.history.some((entry) => entry.intakeKind === "order")).toBe(true);
      expect(read.history.some((entry) => entry.decisionKind === "order")).toBe(true);
      expect((await authorCases({ apiDb: tx as unknown as Db }, p.authorId)).decisions.map((row) => row.order)).toEqual(["disabled"]);
      // A DSA order that does not withhold removes the post from everyone but its author: the row says so.
      const q = await imagePost(tx, 0);
      const dsa = await orderForTest(tx, admin, { kind: "dsa_art9", posts: [q.postId], withholdFromAuthor: false });
      await effectWith(tx, admin, dsa.id, { ...effectParams(dsa), urgent: true });
      expect((await authorCases({ apiDb: tx as unknown as Db }, q.authorId)).decisions.map((row) => row.order)).toEqual(["removed"]);
    });
  });
});
