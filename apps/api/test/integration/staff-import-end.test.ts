import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { CaseView, ErrorEnvelope, ImportView, type ImportEndedByStaffParams, type ImportedPost, type RuleId } from "@korbat/contracts";
import { IMPORT_END_GAP_CLASS } from "../../src/cli/restore";
import { ALL, importsHarness, line, type ImportsHarness } from "./imports-harness";
import { closeDecisions, decideForTest } from "./moderation-decide";

vi.setConfig({ testTimeout: 180_000 });

const HOUR = 3_600_000;
const hourly = (n: number): string => new Date(Date.UTC(2018, 0, 1) + n * HOUR).toISOString().replace(/[.][0-9]+Z$/, "Z");

/**
 * An admin's end of a whole import (3b design, sections 8.7 and 9.3; decision 30; 12.3's staff-import-end.test.ts; Task
 * 6 and the orchestrator's rulings): POST /api/staff/imports/:import/end with the step-up import_ended_by_staff, from a case
 * about one of the import's posts, by the final decision recorded on that case under the rule it names. In one
 * transaction: the moves of 8.7 (a running import stopped by_staff, then undoing when it published posts; a done one
 * undoing), the staff end's four columns set once, and the confirmed audit row last. After the commit the person is
 * mailed, and import-drive removes the posts through the person's own undo path. A moderator is refused. The case page
 * shows the import's size. A restore's gap of a lost end is closed by ending the import again.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: an admin's end of a whole import", () => {
  let h: ImportsHarness;
  let admin: Awaited<ReturnType<ImportsHarness["staffBrowser"]>>;
  let moderator: Awaited<ReturnType<ImportsHarness["staffBrowser"]>>;
  const gaps: string[] = [];
  beforeAll(async () => {
    h = await importsHarness({ settings: { maxActive: 100 }, console: true });
    admin = await h.staffBrowser("admin");
    moderator = await h.staffBrowser("moderator");
  }, 120_000);
  afterAll(async () => {
    try {
      if (gaps.length > 0) await h?.migrateDb.execute(sql`delete from public.restore_gaps where id = any(string_to_array(${gaps.join(",")}, ',')::uuid[])`);
      await closeDecisions();
    } finally {
      await h?.close();
    }
  });

  let clock = Date.now();
  const drive = (batches?: { posts?: number; publish?: number; undo?: number }) => h.imports.drive(new Date((clock += 1_000)), { orphans: false, ...(batches ? { batches } : {}) });
  const refusal = async (res: Response) => [res.status, ErrorEnvelope.parse(await res.json()).error.code];
  async function job(id: string) {
    const [row] = await h.migrateDb.execute<{
      status: string;
      stop_reason: string | null;
      seed: string | null;
      staff_ended: boolean;
      staff_rule_id: string | null;
      staff_case_id: string | null;
      staff_decision_id: string | null;
      posts_published: number;
      posts_removed: number;
    }>(
      sql`select status::text as status, stop_reason, encode(seed, 'hex') as seed, staff_ended_at is not null as staff_ended, staff_rule_id, staff_case_id, staff_decision_id,
                 posts_published, posts_removed from import_jobs where id = ${id}::uuid`,
    );
    return row!;
  }
  const idsOf = async (jobId: string) => (await h.migrateDb.execute<{ id: string }>(sql`select id from posts where import_job_id = ${jobId}::uuid order by created_at, id`)).map((row) => row.id);
  const auditOf = async (importId: string) =>
    h.migrateDb.execute<{ actor_id: string; target_type: string; metadata: { params: ImportEndedByStaffParams }; step_up: unknown }>(
      sql`select actor_id, target_type, metadata, step_up from public.audit_log where action = 'import_ended_by_staff' and target_id = ${importId} order by chain_seq`,
    );
  /** A decision as staff record it: an admin's finding on the post under R1 and a final removal (decideForTest), its case and its id. */
  async function decided(postId: string): Promise<{ caseId: string; decisionId: string; ruleId: RuleId }> {
    await decideForTest(h.apiDb, postId, "removed");
    const [row] = await h.migrateDb.execute<{ case_id: string; decision_id: string; rule_id: RuleId }>(
      sql`select c.id as case_id, d.id as decision_id, d.rule_id from cases c join decisions d on d.case_id = c.id
           where c.target_type = 'post' and c.target_id = ${postId}::uuid and d.kind = 'final' order by d.decided_at desc limit 1`,
    );
    return { caseId: row!.case_id, decisionId: row!.decision_id, ruleId: row!.rule_id };
  }
  /** POST /api/staff/imports/<id>/end by a staff member, with a fresh step-up of exactly these params unless one is given. */
  async function end(staff: typeof admin, importId: string, params: ImportEndedByStaffParams, options: { gap?: string; stepUp?: unknown } = {}) {
    const stepUp = options.stepUp ?? (await staff.stepUp({ action: "import_ended_by_staff", target: { type: "import", id: importId }, params }));
    return staff.b.fetch(`/api/staff/imports/${importId}/end${options.gap ? `?gap=${options.gap}` : ""}`, { json: { ...params, stepUp }, headers: staff.marked });
  }
  async function confirmed(lines: readonly ImportedPost[]) {
    const r = await h.ready(lines);
    expect((await h.confirm(r.b, r.view.id, ALL)).status).toBe(200);
    return r;
  }

  test("a moderator is refused admin_required; an admin ends a publishing import: stopped by staff, then undoing, the four columns once, the audit row; the person is mailed and the posts go through the undo path", async () => {
    const lines = [0, 1, 2, 3].map((ref) => line(ref, { at: hourly(ref) }));
    const r = await confirmed(lines);
    await drive({ posts: 2, publish: 1 });
    expect(await job(r.view.id)).toMatchObject({ status: "publishing", posts_published: 2 });
    const [post] = await idsOf(r.view.id);
    const basis = await decided(post!);

    // The case page shows the post's label and the import's size, to any staff member.
    const shown = CaseView.parse(await (await moderator.b.fetch(`/api/staff/cases/${basis.caseId}`, { headers: moderator.marked })).json());
    expect(shown.target).toMatchObject({ type: "post", id: post, imported: { source: "mastodon", at: "2018-01-01", importId: r.view.id, importSize: 2 } });
    const importedAt = shown.target.type === "post" ? shown.target.imported?.importedAt : null;
    expect(importedAt).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);

    expect(await refusal(await end(moderator, r.view.id, basis))).toEqual([403, "admin_required"]);
    // Without the step-up's assertion, nothing is done.
    const bare = await admin.b.fetch(`/api/staff/imports/${r.view.id}/end`, { json: basis, headers: admin.marked });
    expect(await refusal(bare)).toEqual([403, "staff_step_up_required"]);
    expect(await job(r.view.id)).toMatchObject({ status: "publishing", staff_ended: false });
    expect(await auditOf(r.view.id)).toEqual([]);

    const res = await end(admin, r.view.id, basis);
    expect(res.status, await res.clone().text()).toBe(201);
    const answer = CaseView.parse(await res.json());
    expect(answer.id).toBe(basis.caseId);
    expect(await job(r.view.id)).toMatchObject({
      status: "undoing",
      stop_reason: "by_staff",
      seed: null,
      staff_ended: true,
      staff_rule_id: basis.ruleId,
      staff_case_id: basis.caseId,
      staff_decision_id: basis.decisionId,
      posts_published: 2,
    });
    const audit = await auditOf(r.view.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: admin.id, target_type: "import", metadata: { params: basis } });
    expect(audit[0]!.step_up).not.toBeNull();
    // The person's mail: the rule, and that the decision can be appealed.
    const mail = h.mailer.sent.filter((m) => m.to === r.email && m.template === "import_ended_by_staff");
    expect(mail).toHaveLength(1);
    expect(mail[0]!.data).toMatchObject({ rule: basis.ruleId });
    // A second end finds nothing to end.
    expect(await refusal(await end(admin, r.view.id, basis))).toEqual([409, "wrong_state"]);

    for (let round = 0; round < 10 && (await job(r.view.id)).status !== "undone"; round++) await drive();
    expect(await job(r.view.id)).toMatchObject({ status: "undone", posts_removed: 2 });
    expect(await idsOf(r.view.id)).toEqual([]);
    const view = ImportView.parse(await (await r.b.fetch(`/api/imports/${r.view.id}`)).json());
    expect(view).toMatchObject({ status: "undone", stopReason: "by_staff", endedByStaff: basis.ruleId, staffDecisionId: basis.decisionId, undoable: false });
    expect(await refusal(await r.b.fetch(`/api/imports/${r.view.id}/undo`, { method: "POST" }))).toEqual([409, "wrong_state"]);
  });

  test("an admin ends a done import: straight to undoing, the import's size on the case before and after", async () => {
    const r = await h.published([0, 1, 2].map((ref) => line(ref, { at: hourly(ref) })));
    expect(r.view.status).toBe("done");
    const posts = await idsOf(r.view.id);
    const basis = await decided(posts[1]!);
    const res = await end(admin, r.view.id, basis);
    expect(res.status, await res.clone().text()).toBe(201);
    const answer = CaseView.parse(await res.json());
    expect(answer.target).toMatchObject({ imported: { importId: r.view.id, importSize: 3, at: "2018-01-01" } });
    expect(await job(r.view.id)).toMatchObject({ status: "undoing", stop_reason: null, staff_ended: true, staff_decision_id: basis.decisionId });
    for (let round = 0; round < 10 && (await job(r.view.id)).status !== "undone"; round++) await drive();
    expect(await job(r.view.id)).toMatchObject({ status: "undone", posts_removed: 3 });
    // Once the post is a tombstone the case shows no import: its columns went with it.
    const after = CaseView.parse(await (await admin.b.fetch(`/api/staff/cases/${basis.caseId}`, { headers: admin.marked })).json());
    expect(after.target).toMatchObject({ type: "post", imported: null });
  });

  test("refusals: a case whose post is not of this import, a decision of another case or under another rule, an import that does not exist; nothing is written", async () => {
    const a = await h.published([line(0, { at: hourly(0), text: "a 0" }), line(1, { at: hourly(1), text: "a 1" })]);
    const b = await h.published([line(0, { at: hourly(0), text: "b 0" })]);
    const [postA] = await idsOf(a.view.id);
    const [postB] = await idsOf(b.view.id);
    const basisA = await decided(postA!);
    const basisB = await decided(postB!);
    expect(await refusal(await end(admin, b.view.id, basisA))).toEqual([400, "invalid_request"]);
    expect(await refusal(await end(admin, a.view.id, { ...basisA, decisionId: basisB.decisionId }))).toEqual([400, "invalid_request"]);
    expect(await refusal(await end(admin, a.view.id, { ...basisA, ruleId: "R6" }))).toEqual([400, "invalid_request"]);
    expect(await refusal(await end(admin, randomUUID(), basisA))).toEqual([404, "not_found"]);
    for (const id of [a.view.id, b.view.id]) {
      expect(await job(id)).toMatchObject({ status: "done", staff_ended: false, staff_case_id: null });
      expect(await auditOf(id)).toEqual([]);
    }
  });

  test("a restore's gap of a lost end is closed by ending the import again, and only by that import's end", async () => {
    const r = await h.published([line(0, { at: hourly(0) })]);
    const other = await h.published([line(0, { at: hourly(0), text: "other" })]);
    const [post] = await idsOf(r.view.id);
    const basis = await decided(post!);
    /** An open gap as restore-import writes one for a lost import_ended_by_staff row on this import. */
    async function gapOn(importId: string): Promise<string> {
      const id = randomUUID();
      await h.migrateDb.execute(sql`
        insert into public.restore_gaps (id, import_id, place, hash, action, target_type, target_id, metadata, acted_at, imported_at, class)
        values (${id}::uuid, ${randomUUID()}::uuid, 900000000 + ${gaps.length}, ${"d".repeat(64)}, 'import_ended_by_staff', 'import', ${importId},
                ${JSON.stringify({ params: basis })}::jsonb, now() - interval '1 day', now(), ${IMPORT_END_GAP_CLASS})`);
      gaps.push(id);
      return id;
    }
    const mine = await gapOn(r.view.id);
    const theirs = await gapOn(other.view.id);
    // The other import's gap does not fit this end: refused, nothing written.
    expect(await refusal(await end(admin, r.view.id, basis, { gap: theirs }))).toEqual([409, "gap_mismatch"]);
    expect(await job(r.view.id)).toMatchObject({ status: "done", staff_ended: false });
    const res = await end(admin, r.view.id, basis, { gap: mine });
    expect(res.status, await res.clone().text()).toBe(201);
    const [closed] = await h.migrateDb.execute<{ disposition: string | null; closed_by: string | null }>(sql`select disposition, closed_by from public.restore_gaps where id = ${mine}::uuid`);
    expect(closed).toEqual({ disposition: "reapplied", closed_by: basis.decisionId });
    const [open] = await h.migrateDb.execute<{ closed: boolean }>(sql`select closed_at is not null as closed from public.restore_gaps where id = ${theirs}::uuid`);
    expect(open!.closed).toBe(false);
  });

  test("this file left no import row behind", async () => {
    await closeDecisions();
    const { now, before } = await h.cleanup();
    expect(now).toEqual(before);
  });
});
