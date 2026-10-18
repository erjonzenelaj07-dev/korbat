import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { ORDER_RULES, type OrderEffectedParams, type OrderView } from "@korbat/contracts";
import type { DbTx } from "@korbat/db";
import { appendAuditRow } from "../../src/staff";
import { ModerationError } from "../../src/moderation/context";
import { addItems, effectRows, orderView } from "../../src/moderation/orders";
import { insertOrderDecision, setItemIntake } from "../../src/moderation/orders-repo";
import { appendConfirmedAudit } from "../../src/moderation/repo";
import {
  CHANNEL_TABLES,
  aPost,
  act,
  decideIn,
  hex64,
  imagePost,
  moderationDeps,
  newPostRow,
  newTestStaff,
  newestSnapshot,
  raised,
  removeFixtures,
  report,
  rowCounts,
  staffProfile,
  type TestStaff,
} from "./moderation-fixtures";
import { noticesWorld, type NoticesWorld } from "./notices-harness";
import { closeNotifyFixtures } from "./notify-fixtures";
import { ORDER_TABLES, effectParams, effectWith, orderConfig, orderForTest, sessionOf } from "./orders-fixtures";
import { rolledBack } from "./staff-fixtures";

vi.setConfig({ testTimeout: 300_000 });

/**
 * The ledger of an order (3f design, section 6.3; invariants 5, 6, 7 and 9, LAB C and D on the built code). Nothing
 * enters the ledger without a key: each of LAB D's refusals at commit leaves nothing behind, and one audit row covers at
 * most ten decisions. An order waives exactly three checks (recusal, staff_target and the decision caps) and has a cap
 * of its own; its reinstatement is an admin's. The level is derived whatever the order of arrival. korbat's appeal does
 * not apply to an order decision. The author's own deletion of a disabled post is refused by the database too. Every
 * test runs in a transaction that is rolled back.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the ledger of an order", () => {
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

  const asView = (outcome: OrderView | string): OrderView => {
    if (typeof outcome === "string") throw new Error(`refused: ${outcome}`);
    return outcome;
  };
  async function effect(tx: DbTx, by: TestStaff, view: OrderView, params: Record<string, unknown> = effectParams(view)): Promise<OrderView | string> {
    try {
      return await effectWith(tx, by, view.id, params);
    } catch (err) {
      if (err instanceof ModerationError) return err.code;
      throw err;
    }
  }
  const confirmedParts = (staff: TestStaff) => ({
    keyId: staff.keyId,
    staffSession: randomUUID(),
    actionHash: hex64(),
    stepUp: { authenticatorData: "AAAA", clientDataJSON: "BBBB", signature: "CCCC" },
    requestId: `req-${randomUUID()}`,
    expiresAt: new Date(Date.now() + 10 * 60_000),
  });

  /**
   * The effect's rows with an audit row the test chooses, and decision_holds run at once: answers the refusal's code, or
   * null when the decisions stand. The savepoint goes either way, so nothing is left behind.
   */
  async function rawEffect(
    tx: DbTx,
    staff: TestStaff,
    view: OrderView,
    audit: { action?: "order_effected" | "case_decided"; plain?: boolean; params?: (p: OrderEffectedParams) => Record<string, unknown>; decisionIds?: (ids: Record<string, string>) => Record<string, string>; targetId?: string },
    params: OrderEffectedParams = effectParams(view),
  ): Promise<string | null> {
    try {
      await tx.transaction(async (sp) => {
        const ids = await effectRows(moderationDeps(sp, { config: orderConfig() }), sp, staff.id, params);
        const metadata = { params: audit.params ? audit.params(params) : params, decisionIds: audit.decisionIds ? audit.decisionIds(ids) : ids };
        if (audit.plain) await appendAuditRow(sp, { actorId: staff.id, action: "order_effected", targetType: "order", targetId: audit.targetId ?? view.id, requestId: null, metadata });
        else await appendConfirmedAudit(sp, { actorId: staff.id, action: audit.action ?? "order_effected", targetType: "order", targetId: audit.targetId ?? view.id, metadata, ...confirmedParts(staff) });
        await sp.execute(sql`set constraints public.decisions_check, public.decision_actions_recheck immediate`);
        throw new Error("held");
      });
    } catch (err) {
      if (err instanceof Error && err.message === "held") return null;
      return raised(err)?.message ?? String(err);
    }
    return null;
  }

  test("LAB D: each refusal at commit, and one audit row covers at most ten decisions", async () => {
    await rolledBack(w.apiDb, async (tx) => {
      const posts: string[] = [];
      for (let i = 0; i < 11; i++) posts.push((await imagePost(tx, 0)).postId);
      const order = await orderForTest(tx, moderator, { posts: posts.slice(0, 10) });
      const counted = async () => (await tx.execute<{ n: number }>(sql`select count(*)::int as n from public.decisions where order_item_id is not null`))[0]!.n;
      const start = await counted();
      // The plain row: no confirmation.
      expect(await rawEffect(tx, moderator, order, { plain: true })).toBe("invalid_decision");
      // case_decided in the place of order_effected.
      expect(await rawEffect(tx, moderator, order, { action: "case_decided" })).toBe("invalid_decision");
      // Another order as the target, and a forged reference in the params.
      expect(await rawEffect(tx, moderator, order, { targetId: randomUUID() })).toBe("invalid_decision");
      expect(await rawEffect(tx, moderator, order, { params: (p) => ({ ...p, reference: "forged" }) })).toBe("invalid_decision");
      // An item the row does not name, and a decision the row names under another item.
      expect(await rawEffect(tx, moderator, order, { decisionIds: (ids) => Object.fromEntries(Object.entries(ids).slice(1)) })).toBe("invalid_decision");
      expect(
        await rawEffect(tx, moderator, order, {
          decisionIds: (ids) => {
            const [a, b] = Object.keys(ids);
            return { ...ids, [a!]: ids[b!]!, [b!]: ids[a!]! };
          },
        }),
      ).toBe("invalid_decision");
      // "Must not be told" signed with the post shown to its author equals no row.
      expect(await rawEffect(tx, moderator, order, { params: (p) => ({ ...p, sectionC: true }) })).toBe("invalid_decision");
      // Ten decisions under one row stand.
      expect(await rawEffect(tx, moderator, order, {})).toBeNull();
      expect(await counted()).toBe(start);
      // An eleventh is refused: at most items_per_action under one row.
      await addItems(moderationDeps(tx, { config: orderConfig() }), sessionOf(moderator), order.id, { links: [`${orderConfig().APP_ORIGIN}/post/${posts[10]}`] }, { requestId: `req-${randomUUID()}` });
      const eleven = (await orderView(moderationDeps(tx, { config: orderConfig() }), order.id, sessionOf(moderator)))!;
      const all = eleven.items.map((item) => ({ itemId: item.id, postId: item.postId! })).sort((a, b) => (a.postId < b.postId ? -1 : 1));
      expect(all).toHaveLength(ORDER_RULES.itemsPerAction + 1);
      expect(await rawEffect(tx, moderator, eleven, {}, { ...effectParams(eleven), items: all })).toBe("invalid_decision");
      expect(await counted()).toBe(start);
    });
  });

  test("a second measure on an order decision is refused", async () => {
    await rolledBack(w.apiDb, async (tx) => {
      const p = await imagePost(tx, 0);
      const order = await orderForTest(tx, moderator, { posts: [p.postId] });
      const second = await tx
        .transaction(async (sp) => {
          const ids = await effectRows(moderationDeps(sp, { config: orderConfig() }), sp, moderator.id, effectParams(order));
          await sp.execute(sql`insert into public.decision_actions (decision_id, kind) values (${Object.values(ids)[0]!}::uuid, 'remove')`);
        })
        .then(
          () => null,
          (err: unknown) => raised(err)?.message ?? null,
        );
      expect(second).toBe("invalid_decision");
    });
  });

  test("an order waives recusal, staff_target and the decision caps, and has a cap of its own", async () => {
    // The decision caps at zero, as the migrator sets them (staff.js limits), and back after.
    const [limits] = await w.migrateDb.execute<{ per_hour: number; per_day: number }>(sql`select decisions_per_hour as per_hour, decisions_per_day as per_day from public.moderation_limits where id = 1`);
    try {
      await w.migrateDb.execute(sql`update public.moderation_limits set decisions_per_hour = 0, decisions_per_day = 0 where id = 1`);
      await rolledBack(w.apiDb, async (tx) => {
        // The moderator's own post: a party to it and a staff member, and still given effect by the moderator.
        const own = await newPostRow(tx, moderator.id);
        const order = await orderForTest(tx, moderator, { posts: [own] });
        expect(asView(await effect(tx, moderator, order)).items[0]!.inForce).toBe(true);
        // The order's cap: decisionsPerDay order decisions of one account in 24 hours, the next refused.
        let given = 1;
        while (given < ORDER_RULES.decisionsPerDay) {
          const batch: string[] = [];
          for (let i = 0; i < Math.min(ORDER_RULES.itemsPerAction, ORDER_RULES.decisionsPerDay - given); i++) batch.push((await imagePost(tx, 0)).postId);
          const next = await orderForTest(tx, admin, { posts: batch });
          asView(await effect(tx, moderator, next));
          given += batch.length;
        }
        const last = await orderForTest(tx, admin, { posts: [(await imagePost(tx, 0)).postId] });
        expect(await effect(tx, moderator, last)).toBe("order_cap");
        // Another staff member goes on.
        expect(asView(await effect(tx, admin, last)).items[0]!.inForce).toBe(true);
      });
    } finally {
      await w.migrateDb.execute(sql`update public.moderation_limits set decisions_per_hour = ${limits!.per_hour}, decisions_per_day = ${limits!.per_day} where id = 1`);
    }
  });

  test("the reinstatement is an admin's, asks no recusal, and lifts the measure; the level is derived in either order of arrival (LAB C)", async () => {
    await rolledBack(w.apiDb, async (tx) => {
      // Removed under a rule, then disabled: disabled; reinstated: removed again, since the rule's removal stands.
      const a = await imagePost(tx, 0);
      const reported = await report(tx, aPost(a.postId), "rule");
      await decideIn(tx, moderator, reported.caseId, { kind: "final", actions: [act("remove")] });
      const order = await orderForTest(tx, moderator, { posts: [a.postId] });
      const done = asView(await effect(tx, moderator, order));
      const level = async (postId: string) => (await tx.execute<{ level: string; state: string }>(sql`select moderation_level::text as level, state::text as state from public.posts where id = ${postId}::uuid`))[0]!;
      expect(await level(a.postId)).toEqual({ level: "disabled", state: "disabled" });
      const decisionId = done.items[0]!.decisionId!;
      const caseId = done.items[0]!.caseId!;
      const reinstate = { kind: "correction" as const, reviewsDecisionId: decisionId, outcome: "reversed" as const, actions: [{ kind: "reinstate_by_order" as const, orderGround: "withdrawn" as const }] };
      await expect(decideIn(tx, moderator, caseId, reinstate)).rejects.toMatchObject({ code: "admin_required" });
      await decideIn(tx, admin, caseId, reinstate);
      expect(await level(a.postId)).toEqual({ level: "removed", state: "removed" });
      const [item] = await tx.execute<{ reinstated: boolean; ended: boolean }>(sql`select reinstated_at is not null as reinstated, preserve_ended_at is not null as ended from public.legal_order_items where order_id = ${order.id}::uuid`);
      expect([item!.reinstated, item!.ended]).toEqual([true, true]);
      // Disabled first, then removed under a rule: the removal changes nothing now; reinstated, the removal stands.
      const b = await imagePost(tx, 0);
      const second = await orderForTest(tx, moderator, { posts: [b.postId] });
      const first = asView(await effect(tx, moderator, second));
      const rule = await report(tx, aPost(b.postId), "rule");
      const removal = await decideIn(tx, moderator, rule.caseId, { kind: "final", actions: [act("remove")] });
      const [noEffect] = await tx.execute<{ no_effect: string | null }>(sql`select no_effect from public.decision_actions where decision_id = ${removal}::uuid and kind = 'remove'`);
      expect(noEffect!.no_effect).toBe("already");
      expect(await level(b.postId)).toEqual({ level: "disabled", state: "disabled" });
      // The admin is the author of a third post: recusal is asked neither of the effect nor of the reinstatement.
      await decideIn(tx, admin, first.items[0]!.caseId!, { ...reinstate, reviewsDecisionId: first.items[0]!.decisionId! });
      expect(await level(b.postId)).toEqual({ level: "removed", state: "removed" });
      const own = await newPostRow(tx, admin.id);
      const ownOrder = await orderForTest(tx, moderator, { posts: [own] });
      const ownDone = asView(await effect(tx, moderator, ownOrder));
      await decideIn(tx, admin, ownDone.items[0]!.caseId!, { ...reinstate, reviewsDecisionId: ownDone.items[0]!.decisionId!, actions: [{ kind: "reinstate_by_order", orderGround: "wrong_item" }] });
      expect(await level(own)).toEqual({ level: "visible", state: "visible" });
    });
  });

  test("korbat's appeal does not apply: not_appealable; the decision is final when taken", async () => {
    await rolledBack(w.apiDb, async (tx) => {
      const a = await imagePost(tx, 0);
      const order = await orderForTest(tx, moderator, { kind: "dsa_art9", posts: [a.postId], withholdFromAuthor: false });
      const done = asView(await effect(tx, admin, order, { ...effectParams(order), urgent: true }));
      const decisionId = done.items[0]!.decisionId!;
      const appeal = await tx
        .transaction((sp) => sp.execute(sql`insert into public.appeals (decision_id, appellant_account_id) values (${decisionId}::uuid, ${a.authorId}::uuid)`))
        .then(
          () => null,
          (err: unknown) => raised(err)?.message ?? null,
        );
      expect(appeal).toBe("not_appealable");
      const [final] = await tx.execute<{ same: boolean }>(sql`select public.decision_final_at(d.id) = d.decided_at as same from public.decisions d where d.id = ${decisionId}::uuid`);
      expect(final!.same).toBe(true);
    });
  });

  test("the author's own deletion of a disabled post is refused by the database; an item's intake item pointed at a reporter's item is refused", async () => {
    await rolledBack(w.apiDb, async (tx) => {
      const a = await imagePost(tx, 0);
      const order = await orderForTest(tx, moderator, { posts: [a.postId] });
      asView(await effect(tx, moderator, order));
      const deleted = await tx
        .transaction((sp) => sp.execute(sql`update public.posts set state = 'deleted_by_author', deleted_at = now(), body = '' where id = ${a.postId}::uuid`))
        .then(
          () => null,
          (err: unknown) => raised(err)?.code ?? null,
        );
      expect(deleted).toBe("42501");
      // A reporter's unanswered item of the same case named as the order item's intake item: refused.
      const b = await imagePost(tx, 0);
      const reported = await report(tx, aPost(b.postId), "rule");
      const other = await orderForTest(tx, moderator, { posts: [b.postId] });
      const [item] = await tx.execute<{ id: string }>(sql`select id from public.intake_items where case_id = ${reported.caseId}::uuid`);
      const snapshot = await newestSnapshot(tx, reported.caseId);
      const [kase] = await tx.execute<{ v: number }>(sql`select state_version as v from public.cases where id = ${reported.caseId}::uuid`);
      const pointed = await tx
        .transaction(async (sp) => {
          await setItemIntake(sp, other.items[0]!.id, item!.id);
          await insertOrderDecision(sp, {
            id: randomUUID(),
            caseId: reported.caseId,
            itemId: other.items[0]!.id,
            stateVersion: kase!.v,
            rulesVersion: 3,
            redressVersion: 3,
            category: "STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY",
            keyword: "KEYWORD_TERRORIST_CONTENT",
            snapshotId: snapshot.id,
            snapshotDigest: snapshot.digest,
            decidedBy: moderator.id,
          });
        })
        .then(
          () => null,
          (err: unknown) => raised(err)?.message ?? null,
        );
      expect(pointed).toBe("invalid_decision");
    });
  });
});
