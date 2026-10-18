import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { ORDER_DRAFTS, type OrderView } from "@korbat/contracts";
import { ORDER_NOTICE, statementParagraphs } from "@korbat/rules";
import type { Db, DbTx } from "@korbat/db";
import { authorDecisionView } from "../../src/moderation/author";
import { takeSnapshot } from "../../src/moderation/cases";
import { orderView } from "../../src/moderation/orders";
import { duePreservations, endPreservation, orderErasedOn } from "../../src/moderation/orders-repo";
import { decisionStatement } from "../../src/moderation/statement";
import { CHANNEL_TABLES, aPost, decideIn, imagePost, moderationDeps, newTestStaff, refusal, removeFixtures, report, rowCounts, staffProfile, suspectItemOn, type TestStaff } from "./moderation-fixtures";
import { noticesWorld, type NoticesWorld } from "./notices-harness";
import { closeNotifyFixtures } from "./notify-fixtures";
import { ORDER_TABLES, ageOrderForTest, effectParams, effectWith, orderForTest, sessionOf } from "./orders-fixtures";
import { rolledBack } from "./staff-fixtures";

vi.setConfig({ testTimeout: 120_000 });

/** Past the six months and a day of any preservation: 200 days, in minutes, as ageOrderForTest takes them. */
const PAST_THE_END = 200 * 24 * 60;

/**
 * The end of an order's preservation (3f design, sections 6.4, 7.11 and 7.18; invariant 11, Task 4's part: the end).
 * order_preservation_end takes the cases, the item, the post and its image rows, then judges: not_due before
 * preserve_until and once ended; while the post is still frozen it changes nothing and answers false, so the next round
 * tries again; when the item's measure no longer stands it ends the preservation and erases nothing; otherwise it blanks
 * the post, marks its image rows erased, erases every snapshot of the post in every case, releases the case's holds,
 * derives the level (removed, for good) and records preservation_ended by the system. The notice then says that the
 * content was erased, and a reinstatement after it says that nothing can be shown again. The candidates the retention
 * job reads are the items due and not ended. Every test runs in a transaction that is rolled back, as the migrator, who
 * alone moves an order's times back.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the end of an order's preservation", () => {
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

  /** A post with images under a removal order given effect by the moderator. */
  async function given(tx: DbTx, images = 2): Promise<{ view: OrderView; postId: string; authorId: string; mediaIds: string[] }> {
    const p = await imagePost(tx, images);
    const order = await orderForTest(tx, moderator, { posts: [p.postId] });
    return { view: await effectWith(tx, moderator, order.id, effectParams(order)), ...p };
  }
  const end = (tx: DbTx, itemId: string) => tx.execute<{ done: boolean }>(sql`select public.order_preservation_end(${itemId}::uuid) as done`).then((rows) => rows[0]!.done);
  const postOf = async (tx: DbTx, id: string) =>
    (await tx.execute<{ body: string; level: string; state: string; erased: string | null }>(
      sql`select body, moderation_level::text as level, state::text as state, erased_at::text as erased from public.posts where id = ${id}::uuid`,
    ))[0]!;
  const itemOf = async (tx: DbTx, id: string) =>
    (await tx.execute<{ ended: string | null; until: string | null }>(sql`select preserve_ended_at::text as ended, preserve_until::text as until from public.legal_order_items where id = ${id}::uuid`))[0]!;
  const imagesOf = async (tx: DbTx, postId: string) =>
    (await tx.execute<{ erased: boolean; state: string }>(sql`select erased_at is not null as erased, moderation_state::text as state from public.post_media where post_id = ${postId}::uuid order by id`)).map((row) => [row.erased, row.state]);
  const snapshotsOf = async (tx: DbTx, postId: string) =>
    (await tx.execute<{ case_id: string; erased: boolean; body: string | null }>(
      sql`select case_id::text, erased_at is not null as erased, body from public.evidence_snapshots where target_type = 'post' and target_id = ${postId}::uuid order by taken_at, id`,
    )).map((row) => ({ caseId: row.case_id, erased: row.erased, body: row.body }));
  const eventsOf = async (tx: DbTx, itemId: string) =>
    (await tx.execute<{ kind: string; via: string; by: string | null }>(sql`select kind, via, by_staff::text as by from public.legal_order_events where item_id = ${itemId}::uuid order by at, id`)).map((row) => [row.kind, row.via, row.by]);
  const today = () => new Date().toISOString().slice(0, 10);

  test("before preserve_until it is not due and changes nothing; a DSA order's item, which preserves nothing, never is", async () => {
    await rolledBack(w.migrateDb, async (tx) => {
      const { view, postId } = await given(tx);
      const item = view.items[0]!;
      expect(await refusal(tx.transaction((sp) => end(sp, item.id)))).toBe("not_due");
      expect((await postOf(tx, postId)).body).not.toBe("");
      expect(await duePreservations(tx as unknown as Db)).not.toContain(item.id);
      const p = await imagePost(tx, 1);
      const dsa = await orderForTest(tx, admin, { kind: "dsa_art9", posts: [p.postId], withholdFromAuthor: false });
      const done = await effectWith(tx, admin, dsa.id, { ...effectParams(dsa), urgent: true });
      await ageOrderForTest(tx, dsa.id, PAST_THE_END);
      expect(await refusal(tx.transaction((sp) => end(sp, done.items[0]!.id)))).toBe("not_due");
      expect(await duePreservations(tx as unknown as Db)).not.toContain(done.items[0]!.id);
    });
  });

  test("at its end, while the measure stands: the post blanked, erased and removed for good, its images erased, every snapshot of it erased in every case, the case's holds released, preservation_ended by the system; a second call is not due", async () => {
    await rolledBack(w.migrateDb, async (tx) => {
      // A report first, decided "no violation", leaves a closed case with its own snapshot of the post; the order's
      // effect then opens a case of its own, with the snapshot the effect takes.
      const p = await imagePost(tx, 2);
      const reported = await report(tx, aPost(p.postId));
      await decideIn(tx, moderator, reported.caseId, { kind: "final", outcome: "no_violation" });
      const order = await orderForTest(tx, moderator, { posts: [p.postId] });
      const view = await effectWith(tx, moderator, order.id, effectParams(order));
      const item = view.items[0]!;
      expect(item.caseId).not.toBe(reported.caseId);
      const holdsBefore = await tx.execute<{ case_id: string; released: boolean }>(
        sql`select case_id::text, released_at is not null as released from public.media_holds where media_id = any(${`{${p.mediaIds.join(",")}}`}::uuid[]) order by case_id`,
      );
      expect(holdsBefore.some((h) => h.case_id === item.caseId && !h.released)).toBe(true);
      await ageOrderForTest(tx, order.id, PAST_THE_END);
      expect(await duePreservations(tx as unknown as Db)).toContain(item.id);

      expect(await end(tx, item.id)).toBe(true);
      const post = await postOf(tx, p.postId);
      const ended = await itemOf(tx, item.id);
      expect([post.body, post.level]).toEqual(["", "removed"]);
      // The erasure and the end are the same instant: how every reader tells an erasure from an end without one.
      expect(post.erased).toBe(ended.ended);
      expect(await imagesOf(tx, p.postId)).toEqual([
        [true, "removed"],
        [true, "removed"],
      ]);
      const snapshots = await snapshotsOf(tx, p.postId);
      expect(new Set(snapshots.map((s) => s.caseId))).toEqual(new Set([reported.caseId, item.caseId!]));
      expect(snapshots.every((s) => s.erased && s.body === null)).toBe(true);
      const holds = await tx.execute<{ case_id: string; released: boolean }>(
        sql`select case_id::text, released_at is not null as released from public.media_holds where media_id = any(${`{${p.mediaIds.join(",")}}`}::uuid[]) and case_id = ${item.caseId}::uuid`,
      );
      expect(holds.length).toBeGreaterThan(0);
      expect(holds.every((h) => h.released)).toBe(true);
      expect((await eventsOf(tx, item.id)).at(-1)).toEqual(["preservation_ended", "system", null]);
      expect(await duePreservations(tx as unknown as Db)).not.toContain(item.id);
      expect(await refusal(tx.transaction((sp) => end(sp, item.id)))).toBe("not_due");

      // The order's screen and the case page read the erasure's day; the notice says the content was erased.
      const read = (await orderView(moderationDeps(tx), order.id, { role: "admin" }))!;
      expect(read.items[0]!.erasedAt).toBe(read.items[0]!.preserveEndedAt);
      expect(read.items[0]!.inForce).toBe(true);
      expect(await orderErasedOn(tx as unknown as Db, p.postId)).toBe(today());
      const notice = await authorDecisionView(moderationDeps(tx), p.authorId, item.decisionId!);
      expect(notice.erasedOn).toBe(today());
      expect(notice.content).toBeNull();
      const paragraphs = statementParagraphs(notice, { texts: notice.orderTexts ?? null, erasedOn: notice.erasedOn ?? null });
      expect(paragraphs).toContain(ORDER_NOTICE.erased(today()));
      expect(paragraphs.some((paragraph) => paragraph.startsWith("korbat keeps the post"))).toBe(false);

      // A reinstatement after the erasure lifts the measure and restores nothing, and its notice says so. The case's
      // copies were erased with the post, so the admin takes a fresh one of the erased post first, as the console does.
      const fresh = await takeSnapshot(moderationDeps(tx), sessionOf(admin), item.caseId!);
      const correction = await decideIn(tx, admin, item.caseId!, {
        kind: "correction",
        reviewsDecisionId: item.decisionId!,
        outcome: "reversed",
        actions: [{ kind: "reinstate_by_order", orderGround: "annulled" }],
        snapshotId: fresh.id,
        snapshotDigest: fresh.digest,
      });
      expect((await postOf(tx, p.postId)).level).toBe("removed");
      expect((await postOf(tx, p.postId)).body).toBe("");
      const reinstated = await authorDecisionView(moderationDeps(tx), p.authorId, correction);
      expect(reinstated.erasedOn).toBe(today());
      expect(statementParagraphs(reinstated, { texts: reinstated.orderTexts ?? null, erasedOn: reinstated.erasedOn ?? null })).toEqual([
        statementParagraphs((await decisionStatement(tx as unknown as Db, correction))!.statement)[0],
        ORDER_DRAFTS.reinstate.annulled,
        ORDER_NOTICE.reinstated.erased(today()),
        ORDER_NOTICE.lifted,
      ]);
    });
  });

  test("while the post is still frozen it changes nothing and answers false, and the item stays a candidate for the next round", async () => {
    await rolledBack(w.migrateDb, async (tx) => {
      const { view, postId } = await given(tx, 1);
      const item = view.items[0]!;
      await ageOrderForTest(tx, view.id, PAST_THE_END);
      // An unanswered suspect report about the post freezes it, whatever the order's preservation does.
      await suspectItemOn(tx, "post", postId);
      const bodyBefore = (await postOf(tx, postId)).body;
      expect(await end(tx, item.id)).toBe(false);
      expect((await itemOf(tx, item.id)).ended).toBeNull();
      expect((await postOf(tx, postId)).body).toBe(bodyBefore);
      expect((await postOf(tx, postId)).erased).toBeNull();
      expect(await imagesOf(tx, postId)).toEqual([[false, "visible"]]);
      expect((await eventsOf(tx, item.id)).map((event) => event[0])).not.toContain("preservation_ended");
      expect(await duePreservations(tx as unknown as Db)).toContain(item.id);
    });
  });

  test("an item whose measure no longer stands ends its preservation and erases nothing", async () => {
    await rolledBack(w.migrateDb, async (tx) => {
      const { view, postId } = await given(tx, 1);
      const item = view.items[0]!;
      await decideIn(tx, admin, item.caseId!, { kind: "correction", reviewsDecisionId: item.decisionId!, outcome: "reversed", actions: [{ kind: "reinstate_by_order", orderGround: "withdrawn" }] });
      // The reinstatement ended the preservation; an imported item (Task 6) can still hold one without a measure.
      await tx.execute(sql`update public.legal_order_items set preserve_ended_at = null where id = ${item.id}::uuid`);
      await ageOrderForTest(tx, view.id, PAST_THE_END);
      expect(await end(tx, item.id)).toBe(true);
      const post = await postOf(tx, postId);
      expect([post.level, post.erased]).toEqual(["visible", null]);
      expect(post.body).not.toBe("");
      expect(await imagesOf(tx, postId)).toEqual([[false, "visible"]]);
      expect((await itemOf(tx, item.id)).ended).not.toBeNull();
      expect((await eventsOf(tx, item.id)).at(-1)).toEqual(["preservation_ended", "system", null]);
      expect(await orderErasedOn(tx as unknown as Db, postId)).toBeNull();
      const read = (await orderView(moderationDeps(tx), view.id, { role: "admin" }))!;
      expect(read.items[0]!.erasedAt).toBeNull();
    });
  });

  test("a re-disabling counts anew: past the first end and before the second, the item is no candidate and nothing is erased", async () => {
    await rolledBack(w.migrateDb, async (tx) => {
      const { view, postId } = await given(tx, 1);
      const item = view.items[0]!;
      await decideIn(tx, admin, item.caseId!, { kind: "correction", reviewsDecisionId: item.decisionId!, outcome: "reversed", actions: [{ kind: "reinstate_by_order", orderGround: "annulled" }] });
      await ageOrderForTest(tx, view.id, PAST_THE_END);
      const again = await effectWith(tx, moderator, view.id, effectParams(view, { itemIds: [item.id] }));
      expect(Date.parse(again.items[0]!.preserveUntil!)).toBeGreaterThan(Date.now() + 150 * 86_400_000);
      expect(await duePreservations(tx as unknown as Db)).not.toContain(item.id);
      expect(await refusal(tx.transaction((sp) => end(sp, item.id)))).toBe("not_due");
      const post = await postOf(tx, postId);
      expect([post.level, post.erased]).toEqual(["disabled", null]);
      expect((await snapshotsOf(tx, postId)).some((s) => !s.erased)).toBe(true);
    });
  });

  test("the API's role may call the four functions, and nobody else may", async () => {
    const rows = await w.migrateDb.execute<{ name: string; api: boolean; anyone: boolean }>(sql`
      select p.proname as name, has_function_privilege('korbat_api', p.oid, 'EXECUTE') as api, has_function_privilege('korbat_auth', p.oid, 'EXECUTE') as anyone
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('order_preservation_end', 'order_records_due', 'erase_order_records', 'delete_contact_messages')
       order by p.proname`);
    expect(rows.map((row) => [row.name, row.api, row.anyone])).toEqual([
      ["delete_contact_messages", true, false],
      ["erase_order_records", true, false],
      ["order_preservation_end", true, false],
      ["order_records_due", true, false],
    ]);
  });
});
