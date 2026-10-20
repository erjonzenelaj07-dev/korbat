import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { AUTOMATION_RULES, RULE_DEFAULT_CATEGORY, type AutomatedDecidedParams } from "@korbat/contracts";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { REDRESS_VERSION } from "@korbat/rules";
import { SYSTEM_ACTOR_ID } from "../../src/auth";
import { createAuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { automatedParams, automatedStep, measureIn } from "../../src/moderation/automated";
import { insertMatchSignal, insertScoreSignal, insertSystemDecision, joinSignal, signalHandled } from "../../src/moderation/automated-repo";
import { snapshotIn } from "../../src/moderation/cases";
import { recordIntakeIn, type IntakeGround } from "../../src/moderation/intake";
import { appendConfirmedAudit, caseById, insertAction } from "../../src/moderation/repo";
import { decisionStatement } from "../../src/moderation/statement";
import { appendAuditRow } from "../../src/staff";
import { automationDeps, matchForTest, removeAutomation, signalForTest, signalRow, systemRowOf } from "./automation-fixtures";
import { deciderWorld, type DeciderWorld, type RealStaff } from "./moderation-decide";
import {
  MINORS,
  aPost,
  act,
  decideWith,
  decisionParams,
  decisionRow,
  hex64,
  imagePost,
  imageStates,
  inForce,
  itemsOf,
  moderationCounts,
  newTestStaff,
  postRow,
  refusal,
  refusalDetail,
  removeFixtures,
  report,
  staffProfile,
  type TestStaff,
} from "./moderation-fixtures";
import { rolledBack } from "./staff-fixtures";

// The step runs dozens of statements a call, and the caps' tests write a day of decisions: slow on a loaded machine.
vi.setConfig({ testTimeout: 180_000 });

/** A program's finding under R1 as the step writes one, for the faults below. */
const R1_GROUND: IntakeGround = {
  kind: "automated",
  channel: "system",
  reporterId: null,
  findingBy: null,
  contactId: null,
  ruleId: "R1",
  allegesIllegal: false,
  csam: false,
  category: RULE_DEFAULT_CATEGORY.R1,
  categoryKeyword: null,
  citedLaw: null,
  explanation: null,
  bonaFide: false,
  automatedProcessing: true,
};

/** The nine faults of LAB A2, and the decider check of A3, each written through the step's own statements with one change. */
type Fault = "final" | "no_audit" | "staff_audit" | "no_signal" | "two_measures" | "measure_remove" | "rule_r3" | "finding_r3" | "seal_on_r1" | "seal_under_r2" | "other_post_image" | "plain_actor";

/**
 * The automated decision on the database (3d design, sections 6.6 and 12.1 rows 2 to 4 and 7; LAB A as tests on the built
 * code, O4): the built decisions_record and decision_holds, which carry 3e's and 3f's branches, replaced by the migration
 * automated_decisions with its changes alone. Each case of out-A.txt is one test here with the same code, written through
 * the API's own statements (the step's finding, measure and audit row, the module's insert of a decision and of a ledger
 * row): A1 a program's withhold that commits; A2's nine faults, each refused and leaving nothing; a person's decision that
 * claims fully; A3 the API's role that cannot update a decision; A4 the fallback; A5 to A7 a person's final decision, a
 * correction and "no breach" after a program's measure; A8 the caps, here per rule and with the two limits on unanswered
 * measures. A program's decisions commit with the system's plain audit row; the faults and the caps run in transactions
 * that are rolled back. The person's decisions commit with real keys (moderation-decide.ts).
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the automated decision on the database (3d Task 6, LAB A)", () => {
  let apiDb: Db;
  let migrateDb: Db;
  let authDb: Db;
  let world: DeciderWorld;
  let moderator: RealStaff;
  /** A placeholder key: an audit row it confirms is only ever written in a transaction that is rolled back. */
  let staffKey: TestStaff;
  let startedAt: string;
  let before: Record<string, number>;
  const authors: string[] = [];
  const media: string[] = [];

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 6 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    world = deciderWorld(apiDb);
    moderator = await world.staff("moderator");
    staffKey = await newTestStaff(authDb, migrateDb, createAuthRepo(authDb), "moderator");
    const [row] = await apiDb.execute<{ now: string }>(sql`select now()::text as now`);
    startedAt = row!.now;
    before = await moderationCounts(apiDb);
  });

  afterAll(async () => {
    await removeFixtures(migrateDb, authors);
    await removeAutomation(migrateDb, startedAt, media);
    await world.close();
    await migrateDb.execute(sql`delete from auth.staff_keys where user_id = ${staffKey.id}::uuid`).catch(() => undefined);
    await Promise.all([closeDb(apiDb), closeDb(migrateDb), closeDb(authDb)]);
  });

  /** A post with images by a new author, committed, whose first image the program scores; the step's outcome on it. */
  async function program(images = 1, config: Parameters<typeof automationDeps>[2] = {}) {
    const p = await imagePost(apiDb, images);
    authors.push(p.authorId);
    media.push(...p.mediaIds);
    const outcome = await signalForTest(automationDeps(apiDb, {}, config), p.mediaIds[0]!);
    return { ...p, ...outcome };
  }

  /**
   * One fault of LAB A2, in a transaction that is rolled back, as the API's role: the step's own statements in its order
   * (the author's profile, the finding, the snapshot, the decision, its ledger rows, the signal, the audit row) with the
   * one change the fault names, then the check at commit made to run at once. Answers the code the database raised, or
   * null when the decision stood.
   */
  async function faulty(fault: Fault): Promise<{ code: string | null; detail: string | null }> {
    let result: { code: string | null; detail: string | null } = { code: null, detail: null };
    await rolledBack(apiDb, async (tx) => {
      const p = await imagePost(tx, 2);
      const other = await imagePost(tx, 1);
      const deps = automationDeps(tx);
      const mediaId = fault === "other_post_image" ? other.mediaIds[0]! : p.mediaIds[0]!;
      const signalId = (await insertScoreSignal(tx, { mediaId, score: 1, thresholdVersion: 0 }))!;
      const attempt = tx.transaction(async (sp) => {
        await deps.social.lockAccounts(sp, [p.authorId], "no key update");
        const ground = fault === "finding_r3" ? { ...R1_GROUND, ruleId: "R3" as const, category: RULE_DEFAULT_CATEGORY.R3 } : R1_GROUND;
        const recorded = await recordIntakeIn(deps, sp, { ground, live: [{ type: "post", id: p.postId, position: 1, mediaId: p.mediaIds[0]! }] });
        const caseId = recorded.items[0]!.caseId!;
        await joinSignal(sp, signalId, recorded.items[0]!.id);
        const row = (await caseById(sp, caseId))!;
        const snapshot = await snapshotIn(deps, sp, row);
        const stateVersion = (await caseById(sp, caseId))!.stateVersion;
        let params: Record<string, unknown> = automatedParams({ stateVersion, snapshot, mediaId: p.mediaIds[0]! });
        if (fault === "final") params = { ...params, kind: "final", throughSeq: row.intakeSeq };
        if (fault === "rule_r3") params = { ...params, ruleId: "R3", category: RULE_DEFAULT_CATEGORY.R3 };
        if (fault === "measure_remove") params = { ...params, actions: [{ kind: "remove_media", mediaId: p.mediaIds[0]! }] };
        if (fault === "two_measures") params = { ...params, actions: [{ kind: "withhold", mediaId: null }, { kind: "withhold_media", mediaId: p.mediaIds[0]! }] };
        if (fault === "seal_on_r1") params = { ...params, actions: [{ kind: "seal_media", mediaId: null }] };
        if (fault === "seal_under_r2") params = { ...params, ruleId: "R2", category: MINORS, actions: [{ kind: "seal_media", mediaId: null }] };
        const decisionId = randomUUID();
        await insertSystemDecision(sp, { id: decisionId, caseId, params: params as AutomatedDecidedParams });
        for (const action of params.actions as { kind: "withhold_media"; mediaId: string }[]) await insertAction(sp, decisionId, action);
        if (fault !== "no_signal") await signalHandled(sp, signalId, "measure", decisionId);
        const metadata = { params, decisionId, signalId, target: { type: "post", id: p.postId } };
        if (fault === "staff_audit") {
          await staffProfile(sp, staffKey);
          await appendConfirmedAudit(sp, {
            actorId: staffKey.id,
            keyId: staffKey.keyId,
            action: "case_decided",
            targetType: "case",
            targetId: caseId,
            metadata,
            staffSession: randomUUID(),
            actionHash: hex64(),
            stepUp: { authenticatorData: "AAAA", clientDataJSON: "BBBB", signature: "CCCC" },
            requestId: `req-${randomUUID()}`,
            expiresAt: new Date(Date.now() + 10 * 60_000),
          });
        } else if (fault === "plain_actor") {
          await staffProfile(sp, staffKey);
          await appendAuditRow(sp, { actorId: staffKey.id, action: "automated_decided", targetType: "case", targetId: caseId, requestId: null, metadata });
        } else if (fault !== "no_audit") {
          await appendAuditRow(sp, { actorId: SYSTEM_ACTOR_ID, action: "automated_decided", targetType: "case", targetId: caseId, requestId: null, metadata });
        }
        await sp.execute(sql`set constraints public.decisions_check, public.decision_actions_recheck immediate`);
      });
      const refused = await refusal(attempt.then(() => undefined));
      result = { code: refused, detail: refused === null ? null : await refusalDetail(Promise.reject(await attempt.catch((err: unknown) => err))) };
    });
    return result;
  }

  test("LAB A1: a program's withhold of one image commits without a decider, fully automated and detected, for no admin, its statement pending, the system's plain audit row last", async () => {
    const p = await program(1);
    expect(p.handled).toBe("measure");
    const decision = await decisionRow(apiDb, p.decisionId!);
    expect(decision).toMatchObject({
      kind: "interim",
      outcome: "restricted",
      ground: "incompatible",
      rule_id: "R1",
      decided_by: null,
      automated_detection: true,
      automated_decision: "fully",
      needs_admin: false,
      source: "own_initiative",
      suspect: false,
      author_mail: "pending",
      facts_digest: null,
      reason_digest: null,
      redress_version: REDRESS_VERSION,
    });
    const audit = await systemRowOf(apiDb, p.decisionId!);
    expect(audit).toMatchObject({ actor_id: SYSTEM_ACTOR_ID, action: "automated_decided", target_type: "case", target_id: decision.case_id, step_up: null, key_id: null });
    expect(audit!.metadata).toMatchObject({ decisionId: p.decisionId, signalId: p.signalId, target: { type: "post", id: p.postId } });
    // The image reads withheld and the post stays visible: the program hid one image and no text.
    expect(await imageStates(apiDb, p.mediaIds)).toEqual(["withheld"]);
    expect((await postRow(apiDb, p.postId)).level).toBe("visible");
    expect(await inForce(apiDb, { postId: p.postId })).toEqual([`withhold_media:${p.mediaIds[0]}`]);
    // The signal names its finding's item and its decision, handled as a measure; the item is the program's, in lane 2.
    const signal = await signalRow(apiDb, p.signalId);
    expect(signal).toMatchObject({ handled: "measure", decision_id: p.decisionId });
    const [item] = await itemsOf(apiDb, decision.case_id);
    expect(item).toMatchObject({ id: signal.intake_item_id, lane: 2, suspect: false, media_id: p.mediaIds[0] });
    const [intake] = await apiDb.execute<{ kind: string; channel: string; automated_processing: boolean; rule_id: string; reporter_id: string | null; finding_by: string | null }>(
      sql`select n.kind::text as kind, n.channel::text as channel, n.automated_processing, n.rule_id, n.reporter_id, n.finding_by from intakes n join intake_items i on i.intake_id = n.id where i.id = ${signal.intake_item_id}::uuid`,
    );
    expect(intake).toEqual({ kind: "automated", channel: "system", automated_processing: true, rule_id: "R1", reporter_id: null, finding_by: null });
    // Never due a strike: decision_holds asks strike_due of a final decision alone, and a program's is interim.
    expect((await apiDb.execute(sql`select 1 from decision_actions where decision_id = ${p.decisionId}::uuid and kind = 'strike'`)).length).toBe(0);
    // A second entry for the same signal finds it handled and writes nothing (the step's re-read after the profile's lock).
    expect((await automatedStep(automationDeps(apiDb), p.signalId)).handled).toBe("already");
  });

  test("LAB A2: each of the nine faults is refused, invalid_decision or the intake's CHECK, and leaves nothing", async () => {
    const counts = await moderationCounts(apiDb);
    expect(await faulty("final")).toMatchObject({ code: "invalid_decision" });
    expect(await faulty("no_audit")).toMatchObject({ code: "invalid_decision" });
    expect(await faulty("staff_audit")).toMatchObject({ code: "invalid_decision" });
    expect(await faulty("no_signal")).toMatchObject({ code: "invalid_decision" });
    expect(await faulty("two_measures")).toMatchObject({ code: "invalid_decision" });
    expect(await faulty("measure_remove")).toMatchObject({ code: "invalid_decision" });
    expect(await faulty("rule_r3")).toMatchObject({ code: "invalid_decision" });
    expect((await faulty("finding_r3")).code).toMatch(/^23514 .*intakes_automated/);
    // A seal resting on an R1 score: under R1 decision_actions_check refuses a seal on no suspect item; under R2 the
    // decision considers no program's finding of its rule, and rests on no suspect item.
    expect(await faulty("seal_on_r1")).toMatchObject({ code: "invalid_decision" });
    expect(await faulty("seal_under_r2")).toMatchObject({ code: "invalid_decision" });
    // Two more of decision_holds' members: the signal's image on another post, and a plain row of a staff account.
    expect(await faulty("other_post_image")).toMatchObject({ code: "invalid_decision" });
    expect(await faulty("plain_actor")).toMatchObject({ code: "invalid_decision" });
    // And the decision as the step writes it stands, so each refusal above is its fault's.
    expect(await faulty("none" as Fault)).toEqual({ code: null, detail: null });
    expect(await moderationCounts(apiDb)).toEqual(counts);
  });

  test("decision_holds names the member at fault in its detail", async () => {
    expect((await faulty("no_audit")).detail).toMatch(/^decisionId:/);
    expect((await faulty("staff_audit")).detail).toMatch(/^stepUp:/);
    expect((await faulty("plain_actor")).detail).toMatch(/^actor:/);
    expect((await faulty("no_signal")).detail).toMatch(/^signalId:/);
    expect((await faulty("other_post_image")).detail).toMatch(/^signalId:/);
    expect((await faulty("two_measures")).detail).toMatch(/^actions:/);
  });

  test("a person's decision never carries fully, and records the program's finding it considers; the migrator's program decision is refused at commit as the API's is", async () => {
    await rolledBack(apiDb, async (tx) => {
      const p = await imagePost(tx, 1);
      const deps = automationDeps(tx, {}, { AUTOMATION_R1_ACTS: "off" });
      const signalId = (await insertScoreSignal(tx, { mediaId: p.mediaIds[0]!, score: 1, thresholdVersion: 0 }))!;
      const outcome = await automatedStep(deps, signalId);
      expect(outcome.handled).toBe("finding");
      await staffProfile(tx, staffKey);
      const decisionId = await decideWith(tx, staffKey, outcome.caseId!, await decisionParams(tx, staffKey, outcome.caseId!, { kind: "interim", actions: [act("withhold_media", p.mediaIds[0]!)] }));
      const row = await decisionRow(tx, decisionId);
      expect([row.decided_by, row.automated_detection, row.automated_decision]).toEqual([staffKey.id, true, "not_automated"]);
    });
    await rolledBack(migrateDb, async (tx) => {
      const p = await imagePost(tx, 1);
      const deps = automationDeps(tx);
      const signalId = (await insertScoreSignal(tx, { mediaId: p.mediaIds[0]!, score: 1, thresholdVersion: 0 }))!;
      const code = await refusal(
        tx.transaction(async (sp) => {
          const recorded = await recordIntakeIn(deps, sp, { ground: R1_GROUND, live: [{ type: "post", id: p.postId, position: 1, mediaId: p.mediaIds[0]! }] });
          const caseId = recorded.items[0]!.caseId!;
          const row = (await caseById(sp, caseId))!;
          const snapshot = await snapshotIn(deps, sp, row);
          const params = automatedParams({ stateVersion: (await caseById(sp, caseId))!.stateVersion, snapshot, mediaId: p.mediaIds[0]! });
          const decisionId = randomUUID();
          await insertSystemDecision(sp, { id: decisionId, caseId, params });
          await insertAction(sp, decisionId, params.actions[0]);
          await signalHandled(sp, signalId, "measure", decisionId);
          await sp.execute(sql`set constraints public.decisions_check, public.decision_actions_recheck immediate`);
        }),
      );
      expect(code).toBe("invalid_decision");
    });
  });

  test("LAB A3: the API's role cannot write a decider into a decision, or anything else of one", async () => {
    const p = await program(1);
    expect(await refusal(apiDb.execute(sql`update decisions set decided_by = ${moderator.id}::uuid where id = ${p.decisionId}::uuid`))).toMatch(/^42501 permission denied/);
    expect(await refusal(apiDb.execute(sql`update decisions set automated_decision = 'not_automated' where id = ${p.decisionId}::uuid`))).toMatch(/^42501 permission denied/);
  });

  test("LAB A4: with AUTOMATION_R1_ACTS off the program's finding stands in lane 2 with its signal, and nothing is hidden", async () => {
    const p = await program(1, { AUTOMATION_R1_ACTS: "off" });
    expect([p.handled, p.decisionId]).toEqual(["finding", null]);
    expect(await imageStates(apiDb, p.mediaIds)).toEqual(["visible"]);
    expect(await inForce(apiDb, { postId: p.postId })).toEqual([]);
    const [item] = await itemsOf(apiDb, p.caseId!);
    expect(item).toMatchObject({ lane: 2, suspect: false });
    expect((await signalRow(apiDb, p.signalId)).handled).toBe("finding");
  });

  test("LAB A5: a moderator's final decision records the program's finding, is not automated, and ends the program's measure", async () => {
    const p = await program(1);
    const outcome = await world.decideAs(moderator, p.caseId!, { kind: "final", ruleId: "R1", actions: [act("remove_media", p.mediaIds[0]!)] });
    if (typeof outcome === "string") throw new Error(outcome);
    const final = await decisionRow(apiDb, outcome.decisionId);
    expect([final.decided_by, final.automated_detection, final.automated_decision, final.ended_interim]).toEqual([moderator.id, true, "not_automated", true]);
    expect(await imageStates(apiDb, p.mediaIds)).toEqual(["removed"]);
    // The program's decision is as it was taken: interim, without a decider, fully automated.
    expect(await decisionRow(apiDb, p.decisionId!)).toMatchObject({ kind: "interim", decided_by: null, automated_decision: "fully", ended_interim: false });
    // Its statement's data says what found it, and that the moderator did not open the image on this case.
    const found = await decisionStatement(apiDb, outcome.decisionId);
    expect(found!.statement).toMatchObject({ automatedDetection: true, automatedDecision: "not_automated", signal: { kind: "r1_score", viewed: false } });
  });

  test("LAB A6: a moderator's correction lifts a program's withhold at once", async () => {
    const p = await program(1);
    const outcome = await world.decideAs(moderator, p.caseId!, { kind: "correction", outcome: "reversed", reviewsDecisionId: p.decisionId!, actions: [act("restore_media", p.mediaIds[0]!)] });
    if (typeof outcome === "string") throw new Error(outcome);
    expect(await imageStates(apiDb, p.mediaIds)).toEqual(["visible"]);
    expect(await inForce(apiDb, { postId: p.postId })).toEqual([]);
    const correction = await decisionRow(apiDb, outcome.decisionId);
    expect([correction.automated_detection, correction.automated_decision]).toEqual([true, "not_automated"]);
  });

  test("LAB A7: a decision of no breach ends the program's withhold with the case", async () => {
    const p = await program(1);
    const outcome = await world.decideAs(moderator, p.caseId!, { kind: "final", outcome: "no_violation", ground: null, ruleId: null, actions: [] });
    if (typeof outcome === "string") throw new Error(outcome);
    expect(await imageStates(apiDb, p.mediaIds)).toEqual(["visible"]);
    expect(await inForce(apiDb, { postId: p.postId })).toEqual([]);
  });

  test("already_protected: a person's withhold of the post, or of the image, stands for the program's, whose finding is kept as covered", async () => {
    await rolledBack(apiDb, async (tx) => {
      await staffProfile(tx, staffKey);
      for (const measure of ["withhold", "withhold_media"] as const) {
        const p = await imagePost(tx, 2);
        const { caseId } = await report(tx, aPost(p.postId));
        await decideWith(tx, staffKey, caseId, await decisionParams(tx, staffKey, caseId, { kind: "interim", actions: [act(measure, measure === "withhold" ? null : p.mediaIds[0]!)] }));
        const deps = automationDeps(tx);
        const signalId = (await insertScoreSignal(tx, { mediaId: p.mediaIds[0]!, score: 1, thresholdVersion: 0 }))!;
        const covered = await automatedStep(deps, signalId);
        expect([measure, covered.handled, covered.decisionId], measure).toEqual([measure, "covered", null]);
        expect((await signalRow(tx, signalId)).intake_item_id, measure).not.toBeNull();
        // The other image of the post is not covered by a withhold of the first one alone; a withhold of the post covers it.
        const second = (await insertScoreSignal(tx, { mediaId: p.mediaIds[1]!, score: 1, thresholdVersion: 0 }))!;
        expect((await automatedStep(deps, second)).handled, measure).toBe(measure === "withhold" ? "covered" : "measure");
      }
    });
  });

  describe("LAB A8 on the built code: the caps by rule and the two limits on unanswered measures", () => {
    /**
     * A day of a program's decisions, written as the migrator with the decision triggers off (as yearForTest writes its
     * year), inside the caller's transaction, which is rolled back: `n` decisions without a decider under `rule`, `ago` in
     * the past, on open cases of posts of new authors; when `inForce`, each with a withhold_media of an image of its own,
     * four to a post (a post holds four images), one case a post. A test calls it before its first step: a step's
     * decision leaves the commit's checks pending, and a table with pending checks cannot have its triggers turned off.
     */
    async function history(tx: DbTx, n: number, rule: "R1" | "R2", ago: string, inForce: boolean): Promise<{ actionIds: string[] }> {
      const perPost = inForce ? 4 : n;
      const groups: { postId: string; authorId: string; mediaIds: string[]; caseId: string; snapshot: { id: string; digest: string }; count: number }[] = [];
      for (let left = n; left > 0; left -= perPost) {
        const count = Math.min(perPost, left);
        const p = await imagePost(tx, inForce ? count : 0);
        const { caseId } = await report(tx, aPost(p.postId));
        const [snapshot] = await tx.execute<{ id: string; digest: string }>(sql`select id, digest from evidence_snapshots where case_id = ${caseId}::uuid limit 1`);
        groups.push({ ...p, caseId, snapshot: snapshot!, count });
      }
      for (const table of ["decisions", "decision_actions"]) await tx.execute(sql.raw(`alter table public.${table} disable trigger user`));
      const actionIds: string[] = [];
      for (const group of groups) {
        const made = await tx.execute<{ id: string }>(sql`
          insert into public.decisions (case_id, kind, seen_state_version, outcome, ground, rule_id, rules_version, redress_version, category, source,
                                        snapshot_id, snapshot_digest, decided_by, decided_at, xact, puid, informed_at, suspect, needs_admin, ended_interim,
                                        automated_detection, automated_decision)
          select ${group.caseId}::uuid, 'interim', 0, 'restricted', 'incompatible', ${rule}, 3, 4, 'STATEMENT_CATEGORY_OTHER_VIOLATION_TC', 'own_initiative',
                 ${group.snapshot.id}::uuid, ${group.snapshot.digest}, null, now() - ${ago}::interval, '1'::xid8, md5(random()::text || g::text), now() - ${ago}::interval,
                 false, false, false, true, 'fully'
            from generate_series(1, ${group.count}::int) g
          returning id`);
        if (!inForce) continue;
        for (const [i, decision] of made.entries()) {
          const [action] = await tx.execute<{ id: string }>(sql`
            insert into public.decision_actions (decision_id, kind, media_id, subject_account_id, post_id, created_at)
            values (${decision.id}::uuid, 'withhold_media', ${group.mediaIds[i]!}::uuid, ${group.authorId}::uuid, ${group.postId}::uuid, now() - ${ago}::interval) returning id`);
          actionIds.push(action!.id);
        }
      }
      for (const table of ["decisions", "decision_actions"]) await tx.execute(sql.raw(`alter table public.${table} enable trigger user`));
      return { actionIds };
    }

    /**
     * What the database already counts for a rule, committed by this file's earlier tests: the R1 decisions without a
     * decider of the last hour, and their measures in force. The limits count every program's decision, so a test fills
     * a limit up from there.
     */
    async function counted(tx: DbTx, rule: "R1" | "R2"): Promise<{ hour: number; unanswered: number }> {
      const [row] = await tx.execute<{ hour: number; unanswered: number }>(sql`
        select (select count(*)::int from public.decisions d where d.decided_by is null and d.rule_id = ${rule} and d.decided_at > now() - interval '1 hour') as hour,
               (select count(*)::int from public.measures_in_force m join public.decisions d on d.id = m.decision_id
                 where d.decided_by is null and d.rule_id = ${rule}) as unanswered`);
      return row!;
    }

    /** A new post's image scored and stepped as the migrator's transaction sees it; the step's outcome. */
    async function step(tx: DbTx) {
      const p = await imagePost(tx, 1);
      const signalId = (await insertScoreSignal(tx, { mediaId: p.mediaIds[0]!, score: 1, thresholdVersion: 0 }))!;
      return { ...(await automatedStep(automationDeps(tx), signalId)), signalId, mediaId: p.mediaIds[0]! };
    }

    test("the hour's cap is R1's own: twenty R2 decisions in the hour leave R1 its measure, twenty R1 ones refuse the next with its finding kept", async () => {
      await rolledBack(migrateDb, async (tx) => {
        await history(tx, AUTOMATION_RULES.r2DecisionsPerHour, "R2", "10 minutes", false);
        await history(tx, AUTOMATION_RULES.decisionsPerHour - 1 - (await counted(tx, "R1")).hour, "R1", "10 minutes", false);
        // The twentieth R1 decision of the hour is taken: R2's twenty are not R1's.
        expect((await step(tx)).handled).toBe("measure");
        const capped = await step(tx);
        expect([capped.handled, capped.limit, capped.decisionId]).toEqual(["capped", "hour", null]);
        expect((await signalRow(tx, capped.signalId)).intake_item_id).not.toBeNull();
        expect(await imageStates(tx, [capped.mediaId])).toEqual(["visible"]);
        // The alert says which limit was met, and how many findings stand without a measure since.
        const [alert] = await tx.execute<{ facts: Record<string, number | string> }>(sql`select facts from public.alert_outbox where kind = 'automation_capped' order by id desc limit 1`);
        expect(alert!.facts).toMatchObject({ limitHour: 1, count: 1 });
      });
    });

    test("3d Task 7 (row 4): twenty R1 decisions in the hour, then an acting match on a post, which is sealed: the counts are taken per rule", async () => {
      await rolledBack(migrateDb, async (tx) => {
        await history(tx, AUTOMATION_RULES.decisionsPerHour - (await counted(tx, "R1")).hour, "R1", "10 minutes", false);
        const p = await imagePost(tx, 1);
        const signalId = (await insertMatchSignal(tx, { mediaId: p.mediaIds[0]!, matchId: await matchForTest(tx, p.mediaIds[0]!, "acting") }))!;
        const sealed = await automatedStep(automationDeps(tx, {}, { MEDIA_MATCH: "test" }), signalId);
        expect(sealed.handled).toBe("measure");
        expect(await imageStates(tx, p.mediaIds)).toEqual(["sealed"]);
      });
    });

    test("the day's cap: a hundred R1 decisions of the last day refuse the next, as day", async () => {
      await rolledBack(migrateDb, async (tx) => {
        await history(tx, AUTOMATION_RULES.decisionsPerDay, "R1", "3 hours", false);
        expect(await step(tx)).toMatchObject({ handled: "capped", limit: "day" });
      });
    });

    test("unanswered: twenty R1 measures in force stop a new one under R1 alone, and a person's answer lets the program act again", async () => {
      await rolledBack(migrateDb, async (tx) => {
        const { actionIds } = await history(tx, AUTOMATION_RULES.unansweredMax - (await counted(tx, "R1")).unanswered, "R1", "3 days", true);
        expect(await step(tx)).toMatchObject({ handled: "capped", limit: "unanswered" });
        // One measure lifted, as a person's correction lifts it: nineteen wait, and the program takes its measure again. The
        // capped step left no check pending (it wrote no decision), so the triggers can be turned off once more.
        await tx.execute(sql`alter table public.decision_actions disable trigger user`);
        const [lifted] = await tx.execute<{ decision_id: string; media_id: string; subject_account_id: string; post_id: string }>(
          sql`select decision_id, media_id, subject_account_id, post_id from public.decision_actions where id = ${actionIds[0]!}::uuid`,
        );
        await tx.execute(sql`insert into public.decision_actions (decision_id, kind, media_id, subject_account_id, post_id, reverses_action_id, created_at)
                             values (${lifted!.decision_id}::uuid, 'restore_media', ${lifted!.media_id}::uuid, ${lifted!.subject_account_id}::uuid, ${lifted!.post_id}::uuid, ${actionIds[0]!}::uuid, now())`);
        await tx.execute(sql`alter table public.decision_actions enable trigger user`);
        expect((await step(tx)).handled).toBe("measure");
      });
    });

    test("waiting: a request for a person older than unansweredHours, its measure in force, stops new measures under either rule", async () => {
      await rolledBack(migrateDb, async (tx) => {
        const first = await step(tx);
        expect(first.handled).toBe("measure");
        await tx.execute(sql`insert into public.automated_objections (decision_id, text) values (${first.decisionId!}::uuid, 'Please look again.')`);
        await tx.execute(sql`update public.automated_objections set created_at = now() - make_interval(hours => ${AUTOMATION_RULES.unansweredHours + 1}::int) where decision_id = ${first.decisionId!}::uuid`);
        expect(await step(tx)).toMatchObject({ handled: "capped", limit: "waiting" });
      });
    });
  });

  test("no row of a program's decision is left by the faults: the file's counts are its committed programs' alone", async () => {
    const now = await moderationCounts(apiDb);
    // Each committed program above wrote one decision; the faults and the caps wrote nothing that stayed.
    expect(now.decisions! - before.decisions!).toBeGreaterThanOrEqual(1);
    const [stray] = await apiDb.execute<{ n: number }>(sql`select count(*)::int as n from decisions d where d.decided_by is null and not exists (select 1 from automated_signals s where s.decision_id = d.id)`);
    expect(stray!.n).toBe(0);
  });

  test("the measure's own write path is the one the step runs (measureIn), and a second program's measure meets the case's lock order", async () => {
    // measureIn is what the step's savepoint runs: called as the step calls it, inside a transaction that is rolled back.
    await rolledBack(apiDb, async (tx) => {
      const p = await imagePost(tx, 1);
      const deps = automationDeps(tx);
      const signalId = (await insertScoreSignal(tx, { mediaId: p.mediaIds[0]!, score: 1, thresholdVersion: 0 }))!;
      const recorded = await recordIntakeIn(deps, tx, { ground: R1_GROUND, live: [{ type: "post", id: p.postId, position: 1, mediaId: p.mediaIds[0]! }] });
      await joinSignal(tx, signalId, recorded.items[0]!.id);
      const decisionId = await measureIn(deps, tx, { caseId: recorded.items[0]!.caseId!, postId: p.postId, signalId, mediaId: p.mediaIds[0]! });
      await tx.execute(sql`set constraints public.decisions_check, public.decision_actions_recheck immediate`);
      expect((await decisionRow(tx, decisionId)).automated_decision).toBe("fully");
    });
  });
});
