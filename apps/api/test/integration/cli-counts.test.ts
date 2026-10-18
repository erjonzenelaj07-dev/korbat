import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { OrderView } from "@korbat/contracts";
import type { Db, DbTx } from "@korbat/db";
import { SYSTEM_ACTOR_ID } from "../../src/auth";
import { describeTcoCounts, tcoCounts } from "../../src/cli/counts";
import { runStaffCommand } from "../../src/cli/staff";
import { closeContact, correctOrderRecord } from "../../src/moderation/orders";
import { retentionRound } from "../../src/moderation/retention";
import { appendAuditRow } from "../../src/staff";
import { CHANNEL_TABLES, aPost, act, casesMedia, decideIn, imagePost, moderationDeps, newTestStaff, removeFixtures, report, rowCounts, staffProfile, type TestStaff } from "./moderation-fixtures";
import { noticesWorld, type NoticesWorld } from "./notices-harness";
import { closeNotifyFixtures, contactMessageForTest, removeMessages } from "./notify-fixtures";
import { ORDER_TABLES, ageOrderForTest, effectParams, effectWith, orderConfig, orderForTest, sessionOf } from "./orders-fixtures";
import { recordCounts } from "./records-fixtures";
import { rolledBack } from "./staff-fixtures";

vi.setConfig({ testTimeout: 180_000 });

/**
 * The yearly counts (3f design, sections 7.18 and 8.11, Recovery and the counts; invariant 20): staff.js tco-counts
 * prints, from rows, the figures of TCO Art. 7(3) and 21(1) for a calendar year in UTC, and "not recorded", never 0, for
 * a figure the rows can no longer give. The fixture years lie eleven and twelve years back, where nothing else in the
 * test database stands: every order, event, decision, production and audit row of a fixture is written now and moved
 * back as the migrator, inside a transaction that is rolled back, and the counts are read inside it. A count by hand of
 * what each fixture made is what the command must print.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: staff.js tco-counts, the yearly counts", () => {
  let w: NoticesWorld;
  let moderator: TestStaff;
  let admin: TestStaff;
  let before: Record<string, number>;
  let recordsBefore: Record<string, number>;
  const log = pino({ level: "silent" });
  const YEAR = new Date().getUTCFullYear() - 11;
  const EARLIER = YEAR - 1;

  beforeAll(async () => {
    w = noticesWorld();
    moderator = await newTestStaff(w.authDb, w.migrateDb, w.repo, "moderator");
    admin = await newTestStaff(w.authDb, w.migrateDb, w.repo, "admin");
    await staffProfile(w.apiDb, moderator);
    await staffProfile(w.apiDb, admin);
    before = await rowCounts(w.apiDb, [...ORDER_TABLES, ...CHANNEL_TABLES]);
    recordsBefore = await recordCounts(w.migrateDb);
  }, 60_000);
  afterAll(async () => {
    await removeFixtures(w.migrateDb, [moderator.id, admin.id]);
    await closeNotifyFixtures();
    await w.close();
  });

  /** The minutes from now back to the middle of a year, by which a fixture's rows are moved into it. */
  const backTo = (year: number): number => Math.round((Date.now() - Date.UTC(year, 5, 15, 12)) / 60_000);
  const sameYear = (year: number) => sql`make_interval(mins => ${backTo(year)})`;

  /** An order opened on posts of new authors, and "Disable for an order" on the first `effectOn` of its items. */
  async function effected(tx: DbTx, options: { posts: number; effectOn?: number; memberState?: "DE" | "FR" }): Promise<OrderView> {
    const posts: string[] = [];
    for (let n = 0; n < options.posts; n++) posts.push((await imagePost(tx, 1)).postId);
    const order = await orderForTest(tx, moderator, { posts, memberState: options.memberState ?? "DE" });
    const chosen = order.items.slice(0, options.effectOn ?? order.items.length).map((item) => item.id);
    return effectWith(tx, moderator, order.id, effectParams(order, { itemIds: chosen }));
  }
  /** Records the order's receipt so many minutes before its last disabling, as the mail host's delivery time would be. */
  const receivedBefore = (tx: DbTx, orderId: string, minutes: number) =>
    tx.execute(sql`update public.legal_orders set received_at = (select max(disabled_at) from public.legal_order_items where order_id = ${orderId}::uuid) - make_interval(mins => ${minutes})
                    where id = ${orderId}::uuid`);
  const reinstate = (tx: DbTx, view: OrderView, ground: "annulled" | "withdrawn") =>
    decideIn(tx, admin, view.items[0]!.caseId!, { kind: "correction", reviewsDecisionId: view.items[0]!.decisionId!, outcome: "reversed", actions: [{ kind: "reinstate_by_order", orderGround: ground }] });
  /** An event the command line or the console writes, as the migrator writes it with the clock's time. */
  const event = (tx: DbTx, orderId: string, kind: string, ground: string | null, via: "cli" | "console") =>
    tx.execute(sql`insert into public.legal_order_events (order_id, kind, ground, by_staff, via)
                   values (${orderId}::uuid, ${kind}, ${ground}, ${via === "console" ? moderator.id : null}::uuid, ${via})`);
  /**
   * A message at the contact point as the watcher records it, closed on Contact point with this disposition through the
   * route's own code, both committed before a test's transaction opens: the closing's audit row takes the audit head,
   * which that transaction holds once it has written its own. The test removes the message afterwards.
   */
  const messages: string[] = [];
  async function closedMessage(disposition: "referral" | "not_an_order"): Promise<string> {
    const id = await contactMessageForTest(new Date());
    messages.push(id);
    await closeContact(moderationDeps(w.apiDb), sessionOf(moderator), id, { disposition }, { requestId: `req-${randomUUID()}` });
    return id;
  }
  /** Moves the audit row of a message's closing into the year, inside the test's transaction. */
  const closedIn = (tx: DbTx, messageId: string, year: number) =>
    tx.execute(sql`update public.audit_log set created_at = created_at - ${sameYear(year)} where action = 'contact_closed' and target_id = ${messageId}`);
  /** An access to preserved content recorded with its production, entered with its own time as an import keeps it. */
  async function production(tx: DbTx, purpose: "authority" | "review", year: number): Promise<string> {
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into public.productions (instrument, purpose, authority, their_reference, produced, opened_at, imported_at)
      values ('preserved_access', ${purpose}, 'Bundeskriminalamt', ${`P-${randomUUID()}`}, '{content}', now() - ${sameYear(year)}, now()) returning id`);
    return row!.id;
  }
  /** A final decision that restricts a post as terrorist content, under korbat's own procedure, moved into the year. */
  async function terroristRemoval(tx: DbTx, year: number): Promise<void> {
    const p = await imagePost(tx, 0);
    const { caseId } = await report(tx, aPost(p.postId), "illegal");
    const id = await decideIn(tx, moderator, caseId, { kind: "final", outcome: "restricted", ground: "illegal", categoryKeyword: "KEYWORD_TERRORIST_CONTENT", actions: [act("remove")] });
    await tx.execute(sql`update public.decisions set decided_at = decided_at - ${sameYear(year)}, informed_at = informed_at - ${sameYear(year)} where id = ${id}::uuid`);
  }

  test("over a fixture year each figure equals the count by hand, and a year's orders are counted in the year of their receipt", async () => {
    const referral = await closedMessage("referral");
    const other = await closedMessage("not_an_order");
    await rolledBack(w.migrateDb, async (tx) => {
      // A: two posts of a German order, both disabled 10 minutes after its receipt; one item later reinstated as annulled.
      const a = await effected(tx, { posts: 2 });
      await receivedBefore(tx, a.id, 10);
      await reinstate(tx, a, "annulled");
      // B: an order from another Member State, its one post disabled 125 minutes after receipt; scrutiny asked and upheld.
      const b = await effected(tx, { posts: 1, memberState: "FR" });
      await receivedBefore(tx, b.id, 125);
      await event(tx, b.id, "scrutiny_requested", null, "cli");
      await event(tx, b.id, "scrutiny_decided", "upheld", "cli");
      // C: one of two posts disabled 5 minutes after receipt, the other still open; Annex III sent for missing information.
      const c = await effected(tx, { posts: 2, effectOn: 1 });
      await receivedBefore(tx, c.id, 5);
      await event(tx, c.id, "annex3_sent", "insufficient_information", "console");
      // D: an order under DSA Article 9 is no removal order and counts nowhere.
      const d = await orderForTest(tx, moderator, { kind: "dsa_art9", posts: [(await imagePost(tx, 1)).postId] });
      // G, a year earlier: an order opened with "The message is not listed", disabled, whose receipt nobody recorded.
      const g = await effected(tx, { posts: 1 });
      for (const order of [a.id, b.id, c.id, d.id]) await ageOrderForTest(tx, order, backTo(YEAR));
      await ageOrderForTest(tx, g.id, backTo(EARLIER));
      // korbat's own: a terrorist-content removal, a referral and another message closed, two accesses to preserved content.
      await terroristRemoval(tx, YEAR);
      await closedIn(tx, referral, YEAR);
      await closedIn(tx, other, YEAR);
      await production(tx, "authority", YEAR);
      await production(tx, "review", YEAR);

      const counts = await tcoCounts(tx, YEAR);
      expect(counts.received).toEqual({ total: 3, byState: [["DE", 2], ["FR", 1]], crossBorder: 1 });
      expect(counts.itemsDisabled).toBe(4);
      expect(counts.minutes).toEqual({ list: [10, 125], outside: 1, withoutReceipt: 0, open: 1 });
      expect(describeTcoCounts(counts)).toEqual([
        "tco-counts: removal orders received: 3 (DE: 2, FR: 1; from another Member State: 1)",
        "tco-counts: items disabled following a removal order: 4",
        "tco-counts: minutes from the clock's start to the disabling of an order's last item: 10, 125; outside the hour: 1; with an item still open: 1",
        "tco-counts: Annex III sent, by ground: force_majeure 0, manifest_error 0, insufficient_information 1",
        "tco-counts: scrutiny: requested 1; annulled 0; upheld 1",
        "tco-counts: reinstated, by ground: withdrawn 0, annulled 1, scrutiny 0, not_authentic 0, wrong_item 0",
        "tco-counts: access to preserved content by an authority: 1",
        "tco-counts: restricted by korbat as terrorist content without an order: 1",
        "tco-counts: referrals closed: 1",
      ]);
      // The year before holds G alone: its minutes cannot be computed, so neither can how many were outside the hour.
      expect(describeTcoCounts(await tcoCounts(tx, EARLIER))).toEqual([
        "tco-counts: removal orders received: 1 (DE: 1; from another Member State: 0)",
        "tco-counts: items disabled following a removal order: 1",
        "tco-counts: minutes from the clock's start to the disabling of an order's last item: not recorded; outside the hour: not recorded (1 order without a recorded receipt); with an item still open: 0",
        "tco-counts: Annex III sent, by ground: force_majeure 0, manifest_error 0, insufficient_information 0",
        "tco-counts: scrutiny: requested 0; annulled 0; upheld 0",
        "tco-counts: reinstated, by ground: withdrawn 0, annulled 0, scrutiny 0, not_authentic 0, wrong_item 0",
        "tco-counts: access to preserved content by an authority: 0",
        "tco-counts: restricted by korbat as terrorist content without an order: 0",
        "tco-counts: referrals closed: 0",
      ]);
      // A count by hand, read from the rows themselves, agrees with the first line.
      const [byHand] = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from public.legal_orders
         where kind = 'tco_removal' and coalesce(received_at, opened_at) >= make_timestamptz(${YEAR}, 1, 1, 0, 0, 0, 'UTC')
           and coalesce(received_at, opened_at) < make_timestamptz(${YEAR + 1}, 1, 1, 0, 0, 0, 'UTC')`);
      expect(byHand!.n).toBe(counts.received!.total);
    });
  });

  test("a figure whose rows the retention job erased prints not recorded, never 0; what the ledger and the audit log keep is still counted", async () => {
    const referral = await closedMessage("referral");
    await rolledBack(w.migrateDb, async (tx) => {
      // F: disabled, reinstated (nothing of it stands), moved into the year; past its three years the retention job erases it.
      const f = await effected(tx, { posts: 1 });
      await reinstate(tx, f, "withdrawn");
      await ageOrderForTest(tx, f.id, backTo(YEAR));
      await tx.execute(sql`update public.audit_log set created_at = created_at - ${sameYear(YEAR)} where action = 'order_opened' and target_id = ${f.id}`);
      const round = await retentionRound({ apiDb: tx as unknown as Db, media: casesMedia(tx), log });
      expect(round.orderRecords).toBeGreaterThanOrEqual(1);
      expect((await tx.execute(sql`select 1 from public.legal_orders where id = ${f.id}::uuid`)).length).toBe(0);
      // An authority's access recorded in the year whose production is gone.
      await appendAuditRow(tx, { actorId: SYSTEM_ACTOR_ID, action: "preserved_accessed", targetType: "order_item", targetId: randomUUID(), requestId: null, metadata: { purpose: "authority", productionId: randomUUID() } });
      await tx.execute(sql`update public.audit_log set created_at = created_at - ${sameYear(YEAR)} where action = 'preserved_accessed' and chain_seq = (select seq from public.audit_head where id = 1)`);
      await terroristRemoval(tx, YEAR);
      await closedIn(tx, referral, YEAR);

      expect(describeTcoCounts(await tcoCounts(tx, YEAR))).toEqual([
        "tco-counts: removal orders received: not recorded",
        "tco-counts: items disabled following a removal order: not recorded",
        "tco-counts: minutes from the clock's start to the disabling of an order's last item: not recorded",
        "tco-counts: Annex III sent, by ground: not recorded",
        "tco-counts: scrutiny: not recorded",
        "tco-counts: reinstated, by ground: not recorded",
        "tco-counts: access to preserved content by an authority: not recorded",
        "tco-counts: restricted by korbat as terrorist content without an order: 1",
        "tco-counts: referrals closed: 1",
      ]);
      // A year after the erased order's last possible row is untouched by its erasure.
      expect((await tcoCounts(tx, new Date().getUTCFullYear() - 1)).received).not.toBeNull();
    });
  });

  test("3f's review (proofs3): an erasure counts by what the order was when erased: one opened as a DSA order and corrected to a removal order, and one with no opening row (as restore-import writes an order again), make the year's order figures not recorded", async () => {
    // G: opened as a DSA order, corrected to a removal order before its effect (its opening row still says dsa_art9),
    // given effect, reinstated, moved into the year and erased past its three years.
    await rolledBack(w.migrateDb, async (tx) => {
      const opened = await orderForTest(tx, moderator, { kind: "dsa_art9", posts: [(await imagePost(tx, 1)).postId] });
      const corrected = await correctOrderRecord(moderationDeps(tx, { config: orderConfig() }), sessionOf(moderator), opened.id, { kind: "tco_removal" }, null, { requestId: `req-${randomUUID()}` });
      if (typeof corrected === "string") throw new Error(`the correction was not recorded: ${corrected}`);
      const g = await effectWith(tx, moderator, opened.id, effectParams(corrected));
      await reinstate(tx, g, "withdrawn");
      await ageOrderForTest(tx, g.id, backTo(YEAR));
      await tx.execute(sql`update public.audit_log set created_at = created_at - ${sameYear(YEAR)} where action = 'order_opened' and target_id = ${g.id}`);
      const [opening] = await tx.execute<{ kind: string }>(sql`select metadata->>'kind' as kind from public.audit_log where action = 'order_opened' and target_id = ${g.id}`);
      expect(opening!.kind).toBe("dsa_art9");
      expect((await retentionRound({ apiDb: tx as unknown as Db, media: casesMedia(tx), log })).orderRecords).toBeGreaterThanOrEqual(1);
      // The erasure's own row says what the order was when its records went.
      const [erasure] = await tx.execute<{ metadata: Record<string, unknown> }>(
        sql`select metadata from public.audit_log where action = 'moderation_retention' and metadata->>'step' = 'order_records' and metadata->>'orderId' = ${g.id}`,
      );
      expect(erasure!.metadata).toMatchObject({ orderId: g.id, kind: "tco_removal", receivedAt: null });
      expect(new Date(String(erasure!.metadata.openedAt)).getUTCFullYear()).toBe(YEAR);
      const counts = await tcoCounts(tx, YEAR);
      expect([counts.received, counts.itemsDisabled, counts.reinstated]).toEqual([null, null, null]);
    });
    // H: an order with no opening row, as restore-import writes one again (it appends restore_imported alone); here its
    // opening row is made to name another order.
    await rolledBack(w.migrateDb, async (tx) => {
      const h = await effected(tx, { posts: 1 });
      await reinstate(tx, h, "withdrawn");
      await ageOrderForTest(tx, h.id, backTo(YEAR));
      await tx.execute(sql`update public.audit_log set target_id = ${randomUUID()} where action = 'order_opened' and target_id = ${h.id}`);
      expect((await retentionRound({ apiDb: tx as unknown as Db, media: casesMedia(tx), log })).orderRecords).toBeGreaterThanOrEqual(1);
      const counts = await tcoCounts(tx, YEAR);
      expect([counts.received, counts.itemsDisabled, counts.minutes]).toEqual([null, null, null]);
    });
    // An erasure row written before the review names no kind: it counts for every year it could reach, and for no later one.
    await rolledBack(w.migrateDb, async (tx) => {
      expect((await tcoCounts(tx, YEAR)).received).not.toBeNull();
      await appendAuditRow(tx, {
        actorId: SYSTEM_ACTOR_ID,
        action: "moderation_retention",
        targetType: null,
        targetId: null,
        requestId: null,
        metadata: { step: "order_records", caseId: null, intakeId: null, decisionId: null, orderId: randomUUID(), count: 3 },
      });
      // Written three years and a half after the middle of the year: its order's last row could lie in the year.
      await tx.execute(sql`update public.audit_log set created_at = make_timestamptz(${YEAR + 3}::int, 12, 31, 0, 0, 0, 'UTC') where chain_seq = (select seq from public.audit_head where id = 1)`);
      expect((await tcoCounts(tx, YEAR)).received).toBeNull();
      expect((await tcoCounts(tx, YEAR + 1)).received).not.toBeNull();
    });
  });

  test("run as the command, as the migrator: a line a figure, each starting with its name; a year that has not begun is refused", async () => {
    const env = { DATABASE_URL_MIGRATE: process.env.DATABASE_URL_MIGRATE! };
    const run = async (args: string[]) => {
      const lines: string[] = [];
      const code = await runStaffCommand(args, env, { log: (line) => lines.push(`out ${line}`), error: (line) => lines.push(`err ${line}`) });
      return { code, lines };
    };
    const audits = (await w.migrateDb.execute<{ n: number }>(sql`select count(*)::int as n from public.audit_log`))[0]!.n;
    // A year long before korbat: every figure is computed from rows, and none exists.
    const empty = await run(["tco-counts", String(YEAR - 5)]);
    expect(empty.code).toBe(0);
    expect(empty.lines).toEqual([
      "out tco-counts: removal orders received: 0 (from another Member State: 0)",
      "out tco-counts: items disabled following a removal order: 0",
      "out tco-counts: minutes from the clock's start to the disabling of an order's last item: none; outside the hour: 0; with an item still open: 0",
      "out tco-counts: Annex III sent, by ground: force_majeure 0, manifest_error 0, insufficient_information 0",
      "out tco-counts: scrutiny: requested 0; annulled 0; upheld 0",
      "out tco-counts: reinstated, by ground: withdrawn 0, annulled 0, scrutiny 0, not_authentic 0, wrong_item 0",
      "out tco-counts: access to preserved content by an authority: 0",
      "out tco-counts: restricted by korbat as terrorist content without an order: 0",
      "out tco-counts: referrals closed: 0",
    ]);
    const future = new Date().getUTCFullYear() + 1;
    expect(await run(["tco-counts", String(future)])).toEqual({ code: 1, lines: [`err tco-counts: the year ${future} has not begun; nothing changed`] });
    expect((await run(["tco-counts", "26"])).code).toBe(2);
    // It reads only: no audit row.
    expect((await w.migrateDb.execute<{ n: number }>(sql`select count(*)::int as n from public.audit_log`))[0]!.n).toBe(audits);
  });

  test("leaves the orders', the channel's and the records' tables as it found them", async () => {
    await removeMessages(w.migrateDb, messages);
    expect(await rowCounts(w.apiDb, [...ORDER_TABLES, ...CHANNEL_TABLES])).toEqual(before);
    expect(await recordCounts(w.migrateDb)).toEqual(recordsBefore);
  });
});
