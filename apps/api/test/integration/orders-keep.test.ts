import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { ORDER_RULES } from "@korbat/contracts";
import type { Db, DbTx } from "@korbat/db";
import { createMediaRepo } from "../../src/media/repo";
import { caseSnapshots } from "../../src/moderation/repo";
import { createSocialRepo } from "../../src/social/repo";
import { CHANNEL_TABLES, decideIn, imagePost, newTestStaff, removeFixtures, rowCounts, staffProfile, type TestStaff } from "./moderation-fixtures";
import { noticesWorld, type NoticesWorld } from "./notices-harness";
import { closeNotifyFixtures } from "./notify-fixtures";
import { ORDER_TABLES, ageOrderForTest, effectParams, effectWith, orderForTest } from "./orders-fixtures";
import { rolledBack } from "./staff-fixtures";

vi.setConfig({ testTimeout: 120_000 });

/**
 * What is preserved stays (3f design, sections 6.3, 7.10 and 7.11; invariant 11, Task 3's part: keeping; the end is Task
 * 4's). A post a removal order disabled is preserved: post_preserved holds, frozen_for's fourth arm makes it frozen, so
 * gate K keeps its image rows against every delete, the purge's included, and gate E its snapshots; the author's own
 * deletion is refused, while the purge tombstones it; the staff case page reads no text of it, while snapshot_withheld
 * answers what it answered before. A reinstatement ends the preservation, and a disabling after it counts six months
 * anew. Every test runs in a transaction that is rolled back.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: what an order's preservation keeps", () => {
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

  const flag = async (tx: DbTx, expression: ReturnType<typeof sql>) => (await tx.execute<{ v: boolean }>(sql`select ${expression} as v`))[0]!.v;

  test("a preserved post is frozen: its image rows survive every delete, its author's own deletion is refused, the purge tombstones it and keeps the rest; the staff case page reads no text of it", async () => {
    await rolledBack(w.apiDb, async (tx) => {
      const p = await imagePost(tx, 2);
      const order = await orderForTest(tx, moderator, { posts: [p.postId] });
      const done = await effectWith(tx, moderator, order.id, effectParams(order));
      const caseId = done.items[0]!.caseId!;
      expect(await flag(tx, sql`public.post_preserved(${p.postId}::uuid)`)).toBe(true);
      expect(await flag(tx, sql`public.post_frozen(${p.postId}::uuid)`)).toBe(true);
      // Gate K: a delete of the post's image rows deletes nothing.
      const deleted = await tx.execute<{ id: string }>(sql`delete from public.post_media where post_id = ${p.postId}::uuid returning id`);
      expect(deleted).toEqual([]);
      // The author's own deletion: refused by the database for the API role (and the route answers not_found).
      const social = createSocialRepo(tx as unknown as Db);
      expect(await social.deletePost(p.postId, p.authorId, new Date())).toBe(false);
      // The staff case page: no text of the preserved post; the author's predicate answers as before.
      const snapshots = await caseSnapshots(tx, caseId);
      expect(snapshots.every((s) => s.withheld)).toBe(true);
      expect(await flag(tx, sql`(select bool_or(public.snapshot_withheld(s.id)) from public.evidence_snapshots s where s.case_id = ${caseId}::uuid)`)).toBe(false);
      // The purge: the profile first, then the tombstones, which the guard lets through; the image rows stay.
      await social.purgeProfile(p.authorId, new Date(), async (inner) => {
        await createMediaRepo(inner as unknown as Db).purgeOwner(inner, p.authorId);
      });
      const [post] = await tx.execute<{ state: string; level: string }>(sql`select state::text as state, moderation_level::text as level from public.posts where id = ${p.postId}::uuid`);
      expect([post!.state, post!.level]).toEqual(["deleted_by_author", "disabled"]);
      expect((await tx.execute(sql`select id from public.post_media where post_id = ${p.postId}::uuid`)).length).toBe(2);
    });
  });

  test("a DSA order preserves nothing, and freezes nothing", async () => {
    await rolledBack(w.apiDb, async (tx) => {
      const p = await imagePost(tx, 1);
      const order = await orderForTest(tx, admin, { kind: "dsa_art9", posts: [p.postId], withholdFromAuthor: false });
      await effectWith(tx, admin, order.id, { ...effectParams(order), urgent: true });
      expect(await flag(tx, sql`public.post_preserved(${p.postId}::uuid)`)).toBe(false);
      expect(await flag(tx, sql`public.post_frozen(${p.postId}::uuid)`)).toBe(false);
    });
  });

  test("a reinstatement ends the preservation; a disabling after it counts six months and a day from itself, never from the first", async () => {
    // As the migrator, who alone moves an order's times back (ageOrderForTest); the flows run as they do for the API.
    await rolledBack(w.migrateDb, async (tx) => {
      const p = await imagePost(tx, 0);
      const order = await orderForTest(tx, moderator, { posts: [p.postId] });
      const first = await effectWith(tx, moderator, order.id, effectParams(order));
      await decideIn(tx, admin, first.items[0]!.caseId!, { kind: "correction", reviewsDecisionId: first.items[0]!.decisionId!, outcome: "reversed", actions: [{ kind: "reinstate_by_order", orderGround: "annulled" }] });
      expect(await flag(tx, sql`public.post_preserved(${p.postId}::uuid)`)).toBe(false);
      // A hundred days later a court restores the order, and the post is disabled again.
      await ageOrderForTest(tx, order.id, 100 * 24 * 60);
      const again = await effectWith(tx, moderator, order.id, effectParams(order, { itemIds: [order.items[0]!.id] }));
      const item = again.items[0]!;
      expect(item.inForce).toBe(true);
      expect(item.preserveEndedAt).toBeNull();
      expect(item.reinstatedAt).toBeNull();
      // disabled_at keeps the first disabling, which Annex II and the clock read.
      expect(Date.parse(item.disabledAt!)).toBeLessThan(Date.now() - 99 * 86_400_000);
      const expected = new Date();
      expected.setUTCMonth(expected.getUTCMonth() + ORDER_RULES.preserveMonths);
      expected.setUTCDate(expected.getUTCDate() + ORDER_RULES.preserveMarginDays);
      expect(Math.abs(Date.parse(item.preserveUntil!) - expected.getTime())).toBeLessThan(10 * 60_000);
      expect(await flag(tx, sql`public.post_preserved(${p.postId}::uuid)`)).toBe(true);
    });
  });
});
