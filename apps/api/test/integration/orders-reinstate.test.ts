import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { ORDER_DRAFTS, type OrderView } from "@korbat/contracts";
import { ORDER_NOTICE, statementParagraphs } from "@korbat/rules";
import type { Db, DbTx } from "@korbat/db";
import { afterDecision } from "../../src/moderation/decide";
import { decisionStatement, mailTemplateOf } from "../../src/moderation/statement";
import { CHANNEL_TABLES, decideIn, imagePost, moderationDeps, newTestStaff, removeFixtures, rowCounts, staffProfile, type TestStaff } from "./moderation-fixtures";
import { noticesWorld, type NoticesWorld } from "./notices-harness";
import { closeNotifyFixtures } from "./notify-fixtures";
import { ORDER_TABLES, effectWith, effectParams, orderForTest } from "./orders-fixtures";
import { rolledBack } from "./staff-fixtures";

vi.setConfig({ testTimeout: 120_000 });

/**
 * The reinstatement after an order (3f design, sections 6.3 and 7.9; invariants 6 and 25's correction after effect). An
 * admin corrects the order decision with reinstate_by_order and its ground: the measure lifted, the item reinstated and
 * its preservation ended, the event reinstated with the ground, the level derived again. Told when the disabling was
 * told, with the mail order_reinstated_notice and the notice's reinstatement paragraphs; held, and told with the notice
 * at the release, when the notice is still held. Every staff account hears of it (order_reinstated). Every test runs in a
 * transaction that is rolled back.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: reinstating after an order", () => {
  let w: NoticesWorld;
  let moderator: TestStaff;
  let admin: TestStaff;
  let before: Record<string, number>;

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

  async function given(tx: DbTx, sectionC = false): Promise<{ view: OrderView; postId: string; authorId: string }> {
    const p = await imagePost(tx, 1);
    const order = await orderForTest(tx, moderator, { posts: [p.postId], sectionC });
    return { view: await effectWith(tx, moderator, order.id, effectParams(order)), postId: p.postId, authorId: p.authorId };
  }
  const reinstate = (tx: DbTx, view: OrderView, ground: keyof typeof ORDER_DRAFTS.reinstate = "withdrawn") =>
    decideIn(tx, admin, view.items[0]!.caseId!, { kind: "correction", reviewsDecisionId: view.items[0]!.decisionId!, outcome: "reversed", actions: [{ kind: "reinstate_by_order", orderGround: ground }] });
  const row = async (tx: DbTx, id: string) =>
    (await tx.execute<{ informed: boolean; told_now: boolean; mail: string; needs_admin: boolean }>(
      sql`select informed_at is not null as informed, informed_at = decided_at as told_now, author_mail::text as mail, needs_admin from public.decisions where id = ${id}::uuid`,
    ))[0]!;

  test("a told disabling is reinstated by an admin: lifted, reinstated with its ground, the post shown again, told at once with order_reinstated_notice, and every staff account alerted", async () => {
    await rolledBack(w.apiDb, async (tx) => {
      const { view, postId } = await given(tx);
      const correction = await reinstate(tx, view, "not_authentic");
      expect(await row(tx, correction)).toEqual({ informed: true, told_now: true, mail: "pending", needs_admin: true });
      const [post] = await tx.execute<{ level: string; state: string }>(sql`select moderation_level::text as level, state::text as state from public.posts where id = ${postId}::uuid`);
      expect([post!.level, post!.state]).toEqual(["visible", "visible"]);
      const [item] = await tx.execute<{ reinstated: boolean; ended: boolean; preserved: boolean }>(sql`
        select reinstated_at is not null as reinstated, preserve_ended_at is not null as ended, public.post_preserved(post_id) as preserved
          from public.legal_order_items where order_id = ${view.id}::uuid`);
      expect([item!.reinstated, item!.ended, item!.preserved]).toEqual([true, true, false]);
      const [event] = await tx.execute<{ ground: string; via: string; by: string }>(sql`select ground, via, by_staff::text as by from public.legal_order_events where order_id = ${view.id}::uuid and kind = 'reinstated'`);
      expect([event!.ground, event!.via, event!.by]).toEqual(["not_authentic", "console", admin.id]);
      const found = (await decisionStatement(tx as unknown as Db, correction))!;
      expect(mailTemplateOf(found.statement, []).template).toBe("order_reinstated_notice");
      const paragraphs = statementParagraphs(found.statement);
      expect(paragraphs[0]).toContain("korbat lifted the measure it took on");
      expect(paragraphs[0]).toContain(`(/post/${postId})`);
      expect(paragraphs.slice(1)).toEqual([ORDER_DRAFTS.reinstate.not_authentic, ORDER_NOTICE.reinstated.now, ORDER_NOTICE.lifted]);
      // The alert, through the module's own after-commit step.
      await afterDecision(moderationDeps(tx, { log: pino({ level: "silent" }) }), admin.id, correction);
      const [alert] = await tx.execute<{ priority: number; scope: string }>(sql`select priority, scope from public.alert_outbox where kind = 'order_reinstated' order by id desc limit 1`);
      expect([alert!.priority, alert!.scope]).toEqual([3, "all"]);
    });
  });

  test("a reinstatement while the notice is held is held with it, and the hold stays: nothing is released while it runs", async () => {
    await rolledBack(w.apiDb, async (tx) => {
      const { view } = await given(tx, true);
      const correction = await reinstate(tx, view);
      expect(await row(tx, correction)).toMatchObject({ informed: false, mail: "none" });
      const [order] = await tx.execute<{ held: boolean }>(sql`select public.order_hold_until(id) > now() as held from public.legal_orders where id = ${view.id}::uuid`);
      expect(order!.held).toBe(true);
      // Nothing is released while the hold runs.
      expect((await tx.execute<{ told: number }>(sql`select public.order_notices_release() as told`))[0]!.told).toBe(0);
      expect(await row(tx, view.items[0]!.decisionId!)).toMatchObject({ informed: false, mail: "none" });
    });
  });

  test("the reinstatement asks an admin and a ground: a moderator is refused, and a correction of an order decision reverses it whole", async () => {
    await rolledBack(w.apiDb, async (tx) => {
      const { view } = await given(tx);
      await expect(decideIn(tx, moderator, view.items[0]!.caseId!, { kind: "correction", reviewsDecisionId: view.items[0]!.decisionId!, actions: [{ kind: "reinstate_by_order", orderGround: "withdrawn" }] })).rejects.toMatchObject({
        code: "admin_required",
      });
      // A correction that keeps an order decision has nothing to keep.
      await expect(decideIn(tx, admin, view.items[0]!.caseId!, { kind: "correction", reviewsDecisionId: view.items[0]!.decisionId!, outcome: "kept" })).rejects.toMatchObject({ code: "invalid_decision" });
    });
  });
});
