import { randomInt } from "node:crypto";
import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { ORDER_RULES, type OrderView } from "@korbat/contracts";
import { ORDER_NOTICE, statementParagraphs } from "@korbat/rules";
import type { Db, DbTx } from "@korbat/db";
import { authorDecisionView } from "../../src/moderation/author";
import { RETENTION_ACTION, retentionRound } from "../../src/moderation/retention";
import { decisionStatement } from "../../src/moderation/statement";
import { CHANNEL_TABLES, casesMedia, decideIn, imagePost, moderationDeps, newTestStaff, refusal, removeFixtures, rowCounts, staffProfile, type TestStaff } from "./moderation-fixtures";
import { noticesWorld, type NoticesWorld } from "./notices-harness";
import { ageMessageForTest, closeNotifyFixtures, outboxOf } from "./notify-fixtures";
import { ORDER_TABLES, ageOrderForTest, effectParams, effectWith, orderForTest } from "./orders-fixtures";
import { rolledBack } from "./staff-fixtures";

vi.setConfig({ testTimeout: 120_000 });

const DAY = 24 * 60;
/** Past the three years an order's records are kept after its last event, in minutes. */
const PAST_THE_RECORDS = (ORDER_RULES.recordKeepYears * 366 + 2) * DAY;

/**
 * How long an order's records and the contact point's messages are kept (3f design, sections 6.4, 6.8 and 7.18;
 * invariant 21, orders and messages). order_records_due() names an order three years after its newest event, and never
 * while a measure of it stands, a preservation of it runs or a decision about one of its posts is untold; erase_order_records
 * deletes its events, items, row and message and keeps the ledger. delete_contact_messages deletes a message 30 days after
 * it was handled and the outbox rows that old, but never an unhandled message, stale or not, nor the rows of a subject
 * still open, so alert_steps() never meets an old threshold again. The retention job runs the three new steps, each with
 * its audit row. Every test runs in a transaction that is rolled back, as the migrator, who alone moves times back.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: retention of orders and messages", () => {
  let w: NoticesWorld;
  let moderator: TestStaff;
  let admin: TestStaff;
  let before: Record<string, number>;
  const log = pino({ level: "silent" });

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

  const due = async (tx: DbTx) => (await tx.execute<{ order_id: string }>(sql`select order_id::text from public.order_records_due()`)).map((row) => row.order_id);
  const erase = (tx: DbTx, orderId: string) => tx.execute<{ n: number }>(sql`select public.erase_order_records(${orderId}::uuid) as n`).then((rows) => rows[0]!.n);
  const deleteMessages = (tx: DbTx, days: number) =>
    tx.execute<{ n: number }>(sql`select public.delete_contact_messages(now() - make_interval(days => ${days})) as n`).then((rows) => rows[0]!.n);
  const count = async (tx: DbTx, query: ReturnType<typeof sql>) => (await tx.execute<{ n: number }>(sql`select count(*)::int as n from (${query}) q`))[0]!.n;
  /** A message as the watcher records it, received some days ago, and handled some days ago when a disposition is given. */
  async function message(tx: DbTx, receivedDaysAgo: number, handled?: { disposition: string; daysAgo: number }, stale = false): Promise<string> {
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into public.contact_messages (folder, uidvalidity, uid, received_at, seen_at, stale, disposition, handled_by, handled_at)
      values ('inbox', ${randomInt(1, 2 ** 31)}, 1, now() - make_interval(days => ${receivedDaysAgo}), now() - make_interval(days => ${receivedDaysAgo}), ${stale},
              ${handled?.disposition ?? null}, ${handled ? moderator.id : null}::uuid, ${handled ? sql`now() - make_interval(days => ${handled.daysAgo})` : null})
      returning id`);
    return row!.id;
  }
  async function given(tx: DbTx, sectionC = false): Promise<{ view: OrderView; postId: string; authorId: string }> {
    const p = await imagePost(tx, 1);
    const order = await orderForTest(tx, moderator, { posts: [p.postId], sectionC });
    return { view: await effectWith(tx, moderator, order.id, effectParams(order)), postId: p.postId, authorId: p.authorId };
  }
  const reinstate = (tx: DbTx, view: OrderView) =>
    decideIn(tx, admin, view.items[0]!.caseId!, { kind: "correction", reviewsDecisionId: view.items[0]!.decisionId!, outcome: "reversed", actions: [{ kind: "reinstate_by_order", orderGround: "withdrawn" }] });

  test("an order's records are due three years after its newest event, never while its measure stands, and are erased whole while the ledger stays", async () => {
    await rolledBack(w.migrateDb, async (tx) => {
      // The message the order came in, handled as an order (insertOrder marks it so for the API's role).
      const msg = await message(tx, 1, { disposition: "order", daysAgo: 0 });
      const p = await imagePost(tx, 1);
      const order = await orderForTest(tx, moderator, { posts: [p.postId], messageId: msg });
      const view = await effectWith(tx, moderator, order.id, effectParams(order));
      const item = view.items[0]!;
      await ageOrderForTest(tx, order.id, PAST_THE_RECORDS);
      // The measure stands (and so would its preservation): never due, however old.
      expect(await due(tx)).not.toContain(order.id);
      expect(await refusal(tx.transaction((sp) => erase(sp, order.id)))).toBe("not_due");
      const correction = await reinstate(tx, view);
      // The reinstatement is the newest event: two years later, still not due.
      await ageOrderForTest(tx, order.id, 2 * 366 * DAY);
      expect(await due(tx)).not.toContain(order.id);
      await ageOrderForTest(tx, order.id, PAST_THE_RECORDS);
      expect(await due(tx)).toContain(order.id);

      const events = await count(tx, sql`select 1 from public.legal_order_events where order_id = ${order.id}::uuid`);
      expect(await erase(tx, order.id)).toBe(events + 1 + 1 + 1);
      expect(await count(tx, sql`select 1 from public.legal_orders where id = ${order.id}::uuid`)).toBe(0);
      expect(await count(tx, sql`select 1 from public.legal_order_items where order_id = ${order.id}::uuid`)).toBe(0);
      expect(await count(tx, sql`select 1 from public.legal_order_events where order_id = ${order.id}::uuid`)).toBe(0);
      expect(await count(tx, sql`select 1 from public.contact_messages where id = ${msg}::uuid`)).toBe(0);
      // The ledger stays, its decisions no longer naming the item.
      const ledger = await tx.execute<{ kind: string; item: string | null }>(
        sql`select d.kind::text as kind, d.order_item_id::text as item from public.decisions d where d.id in (${item.decisionId!}::uuid, ${correction}::uuid) order by d.decided_at`,
      );
      expect(ledger.map((row) => [row.kind, row.item])).toEqual([
        ["order", null],
        ["correction", null],
      ]);
      expect(await count(tx, sql`select 1 from public.decision_actions where decision_id in (${item.decisionId!}::uuid, ${correction}::uuid)`)).toBe(2);

      // Both decisions still read: the notice says only that an order was given effect, and when.
      for (const id of [item.decisionId!, correction]) {
        const found = (await decisionStatement(tx as unknown as Db, id))!;
        expect(found.statement.order).toBeNull();
        const paragraphs = statementParagraphs(found.statement);
        expect(paragraphs.length).toBeGreaterThan(0);
        expect(paragraphs).toContain(ORDER_NOTICE.recordsDeleted.gone);
        expect(paragraphs.join(" ")).not.toMatch(/Bundeskriminalamt|T-/);
        const view = await authorDecisionView(moderationDeps(tx), p.authorId, id);
        expect(statementParagraphs(view, { texts: view.orderTexts ?? null, erasedOn: view.erasedOn ?? null })).toEqual(paragraphs);
      }
    });
  });

  test("an untold decision about one of its posts keeps an order's records, and so does a running hold, however old", async () => {
    await rolledBack(w.migrateDb, async (tx) => {
      const { view } = await given(tx, true);
      await reinstate(tx, view);
      await ageOrderForTest(tx, view.id, PAST_THE_RECORDS);
      // Both the order decision and the correction are held with the notice: informed_at null.
      expect(await count(tx, sql`select 1 from public.decisions d where d.case_id = ${view.items[0]!.caseId!}::uuid and d.informed_at is null`)).toBe(2);
      expect(await due(tx)).not.toContain(view.id);
    });
  });

  test("an order nothing acted on is due three years after it was opened, and not before", async () => {
    await rolledBack(w.migrateDb, async (tx) => {
      const p = await imagePost(tx, 0);
      const order = await orderForTest(tx, moderator, { posts: [p.postId] });
      await ageOrderForTest(tx, order.id, (ORDER_RULES.recordKeepYears * 365 - 2) * DAY);
      expect(await due(tx)).not.toContain(order.id);
      await ageOrderForTest(tx, order.id, 10 * DAY);
      expect(await due(tx)).toContain(order.id);
      expect(await erase(tx, order.id)).toBeGreaterThanOrEqual(3);
    });
  });

  test("a message is deleted 30 days after it was handled; an unhandled one, stale or not, never; an order's message goes with the order", async () => {
    await rolledBack(w.migrateDb, async (tx) => {
      expect(await refusal(tx.transaction((sp) => deleteMessages(sp, ORDER_RULES.messageKeepDays - 1)))).toBe("not_due");
      const handledLong = await message(tx, 40, { disposition: "not_an_order", daysAgo: ORDER_RULES.messageKeepDays + 1 });
      const handledLately = await message(tx, 40, { disposition: "referral", daysAgo: ORDER_RULES.messageKeepDays - 1 });
      const unhandled = await message(tx, 1000);
      const stale = await message(tx, 1000, undefined, true);
      const ordered = await message(tx, 400, { disposition: "order", daysAgo: 400 });
      const p = await imagePost(tx, 0);
      await orderForTest(tx, moderator, { posts: [p.postId], messageId: ordered });
      expect(await deleteMessages(tx, ORDER_RULES.messageKeepDays)).toBeGreaterThanOrEqual(1);
      const left = async (id: string) => count(tx, sql`select 1 from public.contact_messages where id = ${id}::uuid`);
      expect([await left(handledLong), await left(handledLately), await left(unhandled), await left(stale), await left(ordered)]).toEqual([0, 1, 1, 1, 1]);
    });
  });

  test("old outbox rows go unless their subject is open, so alert_steps() never writes an order_due again for a deadline long past", async () => {
    await rolledBack(w.migrateDb, async (tx) => {
      // An unhandled message 40 days old: alert_steps() writes its escalation and its order_due now.
      const unhandled = await message(tx, 40);
      await tx.execute(sql`select public.alert_steps()`);
      const written = (await outboxOf(tx, unhandled)).map((row) => [row.kind, row.step]);
      expect(written).toContainEqual(["order_due", 0]);
      // Forty more days: the rows are 40 days old, and the message still nobody's.
      await ageMessageForTest(tx, unhandled, 40 * DAY);
      // A handled message's old rows, for contrast.
      const handled = await message(tx, 80, { disposition: "not_an_order", daysAgo: 79 });
      await tx.execute(sql`insert into public.alert_outbox (kind, priority, scope, step, facts, message_id) values ('contact_mail_escalated', 5, 'all', 0, '{}'::jsonb, ${handled}::uuid)`);
      await ageMessageForTest(tx, handled, 70 * DAY);
      // An open order's rows, and one of an order given effect in full.
      const openMsg = await message(tx, 1, { disposition: "order", daysAgo: 1 });
      const p = await imagePost(tx, 0);
      const open = await orderForTest(tx, moderator, { posts: [p.postId], messageId: openMsg });
      await ageOrderForTest(tx, open.id, 40 * DAY);
      await tx.execute(sql`select public.alert_steps()`);
      const openRows = await count(tx, sql`select 1 from public.alert_outbox where order_id = ${open.id}::uuid`);
      expect(openRows).toBeGreaterThan(0);
      await ageOrderForTest(tx, open.id, 40 * DAY);
      const doneMsg = await message(tx, 1, { disposition: "order", daysAgo: 1 });
      const q = await imagePost(tx, 0);
      const done = await orderForTest(tx, moderator, { posts: [q.postId], messageId: doneMsg });
      await ageOrderForTest(tx, done.id, 40 * DAY);
      await tx.execute(sql`select public.alert_steps()`);
      await effectWith(tx, moderator, done.id, effectParams(done));
      await ageOrderForTest(tx, done.id, 40 * DAY);
      expect(await count(tx, sql`select 1 from public.alert_outbox where order_id = ${done.id}::uuid and created_at < now() - interval '30 days'`)).toBeGreaterThan(0);

      await deleteMessages(tx, ORDER_RULES.messageKeepDays);
      expect((await outboxOf(tx, unhandled)).map((row) => [row.kind, row.step])).toEqual(written);
      expect(await outboxOf(tx, handled)).toEqual([]);
      expect(await count(tx, sql`select 1 from public.alert_outbox where order_id = ${open.id}::uuid`)).toBe(openRows);
      expect(await count(tx, sql`select 1 from public.alert_outbox where order_id = ${done.id}::uuid and created_at < now() - interval '30 days'`)).toBe(0);

      // Nothing is written again for the deadline long past: the kept rows still answer for it.
      await tx.execute(sql`select public.alert_steps()`);
      expect((await outboxOf(tx, unhandled)).map((row) => [row.kind, row.step])).toEqual(written);
      expect(await count(tx, sql`select 1 from public.alert_outbox where order_id = ${open.id}::uuid`)).toBe(openRows);
      // Had they gone, alert_steps() would have met the old threshold again and rung every phone at priority 5.
      await tx.execute(sql`delete from public.alert_outbox where message_id = ${unhandled}::uuid`);
      await tx.execute(sql`select public.alert_steps()`);
      expect((await outboxOf(tx, unhandled)).map((row) => row.kind)).toContain("order_due");
    });
  });

  test("the retention job runs order_preservation, order_records and contact_messages, each with its audit row", async () => {
    await rolledBack(w.migrateDb, async (tx) => {
      const start = (await tx.execute<{ seq: number }>(sql`select seq::int as seq from public.audit_head where id = 1`))[0]!.seq;
      const preserved = await given(tx);
      await ageOrderForTest(tx, preserved.view.id, 200 * DAY);
      const old = await given(tx);
      await reinstate(tx, old.view);
      await ageOrderForTest(tx, old.view.id, PAST_THE_RECORDS);
      await message(tx, 40, { disposition: "not_an_order", daysAgo: ORDER_RULES.messageKeepDays + 1 });

      const report = await retentionRound({ apiDb: tx as unknown as Db, media: casesMedia(tx), log });
      expect(report.preservations).toBeGreaterThanOrEqual(1);
      expect(report.orderRecords).toBeGreaterThanOrEqual(1);
      expect(report.contactMessages).toBeGreaterThanOrEqual(1);
      expect(report.failed).toBe(0);
      const rows = (
        await tx.execute<{ metadata: Record<string, unknown>; actor_id: string; step_up: unknown }>(
          sql`select metadata, actor_id, step_up from public.audit_log where action = ${RETENTION_ACTION} and chain_seq > ${start} order by chain_seq`,
        )
      ).map((row) => row.metadata);
      expect(rows).toContainEqual({ step: "order_preservation", caseId: null, intakeId: null, decisionId: null, itemId: preserved.view.items[0]!.id, erased: true, count: 1 });
      expect(rows).toContainEqual({ step: "order_records", caseId: null, intakeId: null, decisionId: null, orderId: old.view.id, count: expect.any(Number) });
      expect(rows.some((row) => row.step === "contact_messages")).toBe(true);
      // The steps come before the disposal, which then takes the erased post's image rows.
      const steps = rows.map((row) => row.step);
      expect(steps.indexOf("order_preservation")).toBeLessThan(steps.lastIndexOf("images") === -1 ? Infinity : steps.lastIndexOf("images"));
      const [post] = await tx.execute<{ level: string; body: string }>(sql`select moderation_level::text as level, body from public.posts where id = ${preserved.postId}::uuid`);
      expect([post!.level, post!.body]).toEqual(["removed", ""]);
      expect(await count(tx, sql`select 1 from public.legal_orders where id = ${old.view.id}::uuid`)).toBe(0);
    });
  });
});
