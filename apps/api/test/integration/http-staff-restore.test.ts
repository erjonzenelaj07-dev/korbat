import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { RestoreView, StaffOverview, type GapClass } from "@korbat/contracts";
import { RECOVERY_TABLES, aPost, act, decisionParams, hex64, imagePost, report, restoreForTest, rowCounts, snapshotForTest } from "./moderation-fixtures";
import { MARKED, recoveryWorld, type ConsoleStaff, type RecoveryWorld } from "./recovery-harness";
import { TEST_CONSOLE_ORIGIN } from "./staff-fixtures";
import { Browser } from "./http-client";

vi.setConfig({ testTimeout: 120_000 });

/**
 * After a restore, over HTTP (3f design, sections 7.17, 8.8, 10.2, 10.3 and 10.6; invariants 18 and 24): GET
 * /api/staff/restore behind the staff session lists every open gap by class, in the order to take it again, with the
 * gap's members and nothing of its lost row, whether the app's site may open and the newest import's time; "Not needed"
 * needs the key, refuses a moderator (admin_required) and a closed gap (gap_mismatch), and answers the view; the decide
 * route's query member `gap` closes the gap with the decision in its transaction and names it in the audit row, and a
 * gap the decision does not fit is refused with nothing written; the home screen's overview counts the open gaps. The
 * gaps are written as the import writes them, as the migrator. The file restores the database it found.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: After a restore over HTTP", () => {
  let w: RecoveryWorld;
  let moderator: ConsoleStaff;
  let admin: ConsoleStaff;
  let found: string;
  let before: Record<string, number>;
  const importId = randomUUID();
  let place = 100;

  beforeAll(async () => {
    w = recoveryWorld();
    before = await rowCounts(w.apiDb, [...RECOVERY_TABLES]);
    found = await snapshotForTest(w.migrateDb);
    moderator = await w.staff("moderator");
    admin = await w.staff("admin");
  }, 120_000);
  afterAll(async () => {
    await w.close();
  });

  /** A gap as the import writes it, as the migrator: one import, the next place, the lost row's action, target and metadata. */
  async function gapOf(cls: GapClass, action: string, target: { type: string; id: string } | null, metadata: Record<string, unknown> = {}, actedAt = "2026-10-03T07:00:00.000Z"): Promise<string> {
    const [row] = await w.migrateDb.execute<{ id: string }>(sql`
      insert into public.restore_gaps (import_id, place, hash, action, target_type, target_id, metadata, acted_at, imported_at, class)
      values (${importId}::uuid, ${place++}, ${hex64()}, ${action}, ${target?.type ?? null}, ${target?.id ?? null}, ${JSON.stringify(metadata)}::jsonb, ${actedAt}::timestamptz, now(), ${cls})
      returning id`);
    return row!.id;
  }
  async function view(s: ConsoleStaff): Promise<RestoreView> {
    const res = await s.b.fetch("/api/staff/restore");
    expect(res.status, await res.clone().text()).toBe(200);
    const raw: unknown = await res.json();
    const read = RestoreView.parse(raw);
    expect(raw).toStrictEqual(read);
    return read;
  }
  const notNeeded = async (s: ConsoleStaff, gap: string, key = true) => {
    const params = { disposition: "not_needed" as const };
    const stepUp = key ? await w.confirmation(s, { action: "gap_closed", target: { type: "restore_gap", id: gap }, params }) : undefined;
    return s.b.fetch(`/api/staff/restore/gaps/${gap}/close`, { json: { ...params, ...(stepUp ? { stepUp } : {}) }, headers: MARKED });
  };

  test("every route stands behind the staff session", async () => {
    const stranger = new Browser(w.app, TEST_CONSOLE_ORIGIN, { base: TEST_CONSOLE_ORIGIN, csrfCookie: "__Host-korbat_staff_csrf", csrfHeader: "x-staff-csrf" });
    expect((await stranger.fetch("/api/staff/restore")).status).toBe(401);
    expect((await stranger.fetch(`/api/staff/restore/gaps/${randomUUID()}/close`, { json: { disposition: "not_needed" }, csrf: false })).status).toBe(401);
  });

  test("the view lists the open gaps by class in the order to take them again, with their members only; the site stays closed while a disabling or a seal is open", async () => {
    expect((await view(moderator)).importedAt).toBeNull();
    const reviewed = await gapOf("reversal", "appeals_reviewed", { type: "decision", id: randomUUID() }, { params: { actions: [{ kind: "restore", mediaId: null }] } });
    const removal = await gapOf("restriction", "case_decided", { type: "case", id: randomUUID() }, { params: { actions: [{ kind: "remove", mediaId: null }, { kind: "strike", mediaId: null }] } });
    const effect = await gapOf("order_effect", "order_effected", { type: "order_item", id: randomUUID() });
    const seal = await gapOf("seal_final", "case_decided", { type: "case", id: randomUUID() }, { params: { actions: [{ kind: "seal_media", mediaId: null }], authority: "do not leak" } });
    const v = await view(moderator);
    expect(v.importedAt).not.toBeNull();
    expect(v.gaps.map((gap) => [gap.id, gap.class])).toEqual([
      [effect, "order_effect"],
      [seal, "seal_final"],
      [removal, "restriction"],
      [reviewed, "reversal"],
    ]);
    expect(v.gaps.find((gap) => gap.id === removal)!.kinds).toEqual(["remove", "strike"]);
    expect(v.gaps.find((gap) => gap.id === effect)!.kinds).toEqual(["disable_by_order"]);
    expect(JSON.stringify(v)).not.toContain("do not leak");
    expect([v.mayOpen, v.retentionMay]).toEqual([false, false]);
    const overview = StaffOverview.parse(await (await moderator.b.fetch("/api/staff/overview")).json());
    expect(overview.restore).toEqual({ open: 4, measures: 3, importedAt: v.importedAt });
    // Closed as not needed by an admin with the key, the disabling and the seal no longer keep the site closed.
    for (const gap of [effect, seal]) expect((await notNeeded(admin, gap)).status).toBe(201);
    const after = await view(moderator);
    expect([after.mayOpen, after.retentionMay]).toEqual([true, false]);
    expect(after.gaps.filter((gap) => gap.closedAt === null).map((gap) => gap.id)).toEqual([removal, reviewed]);
  });

  test("Not needed: refused without the key and to a moderator, refused for a closed gap, and answered with the view for an admin", async () => {
    const gap = await gapOf("no_measure", "case_decided", { type: "case", id: randomUUID() });
    expect(await w.refusal(await notNeeded(admin, gap, false))).toEqual([403, "staff_step_up_required"]);
    expect(await w.refusal(await notNeeded(moderator, gap))).toEqual([403, "admin_required"]);
    const res = await notNeeded(admin, gap);
    expect(res.status, await res.clone().text()).toBe(201);
    const closed = RestoreView.parse(await res.json()).gaps.find((g) => g.id === gap)!;
    expect([closed.disposition, closed.closedByDecisionId, closed.closedAt !== null]).toEqual(["not_needed", null, true]);
    expect(await w.refusal(await notNeeded(admin, gap))).toEqual([409, "gap_mismatch"]);
    expect(await w.refusal(await notNeeded(admin, randomUUID()))).toEqual([404, "not_found"]);
  });

  test("the decide route's `gap`: a decision that fits closes it in its transaction and its audit row names it; one that does not fit is refused with nothing written", async () => {
    const p = await imagePost(w.apiDb, 0);
    const { caseId } = await report(w.apiDb, aPost(p.postId));
    const decide = async (gap: string) => {
      const params = await decisionParams(w.apiDb, moderator, caseId, { kind: "final", actions: [act("remove")] });
      const stepUp = await w.confirmation(moderator, { action: "case_decided", target: { type: "case", id: caseId }, params });
      return moderator.b.fetch(`/api/staff/cases/${caseId}/decisions?gap=${gap}`, { json: { ...params, stepUp }, headers: MARKED });
    };
    const seal = await gapOf("seal_final", "case_decided", { type: "case", id: caseId }, { target: { type: "post", id: p.postId } });
    const decisions = async () => Number((await w.migrateDb.execute<{ n: number }>(sql`select count(*)::int as n from public.decisions where case_id = ${caseId}::uuid`))[0]!.n);
    expect(await w.refusal(await decide(seal))).toEqual([409, "gap_mismatch"]);
    expect(await decisions()).toBe(0);
    const removal = await gapOf("restriction", "case_decided", { type: "case", id: caseId }, { target: { type: "post", id: p.postId } });
    const res = await decide(removal);
    expect(res.status, await res.clone().text()).toBe(201);
    await w.moderation.settle();
    const [gap] = await w.migrateDb.execute<{ disposition: string; closed_by: string }>(sql`select disposition, closed_by from public.restore_gaps where id = ${removal}::uuid`);
    const [audit] = await w.migrateDb.execute<{ gap: string; decision: string }>(
      sql`select metadata ->> 'gapId' as gap, metadata ->> 'decisionId' as decision from public.audit_log where action = 'case_decided' order by chain_seq desc limit 1`,
    );
    expect(gap).toEqual({ disposition: "reapplied", closed_by: audit!.decision });
    expect(audit!.gap).toBe(removal);
    // A malformed gap is the validator's refusal, before the key is read.
    expect((await moderator.b.fetch(`/api/staff/cases/${caseId}/decisions?gap=NOT-A-GAP`, { json: {}, headers: MARKED })).status).toBe(400);
  });

  test("leaves the database as the file found it", async () => {
    await w.moderation.settle();
    await restoreForTest(w.migrateDb, found);
    expect(await rowCounts(w.apiDb, [...RECOVERY_TABLES])).toEqual(before);
  });
});
