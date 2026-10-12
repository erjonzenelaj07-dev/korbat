import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { RuleId } from "@korbat/contracts";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import type { ActiveStaffSession } from "../../src/auth";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { appealsList } from "../../src/moderation/appeals";
import { authorDecisionView } from "../../src/moderation/author";
import { overview, readCase as readCaseView } from "../../src/moderation/cases";
import { appendConfirmedAudit, insertAction, insertDecision, insertReview } from "../../src/moderation/repo";
import { newUserWithDevice } from "./auth-fixtures";
import {
  aPost,
  act,
  actionsOf,
  appealOf,
  appealRow,
  authCaseCounts,
  decideIn,
  decisionParams,
  decisionRow,
  ground,
  hex64,
  imageStates,
  inForce,
  intake,
  itemsOf,
  madeUpConfirmation,
  moderationDeps,
  newImageRow,
  newPostRow,
  newTestStaff,
  postRow,
  raised,
  readCase,
  refusal,
  refusalDetail,
  removeFixtures,
  reviewIn,
  reviewParams,
  reviewWith,
  rowCounts,
  staffProfile,
  type DecisionInput,
  type TestStaff,
} from "./moderation-fixtures";
import { newProfile } from "./social-fixtures";
import { pgError, rolledBack } from "./staff-fixtures";

// Every test here runs dozens of statements inside one open transaction, each a round trip: on a loaded machine that
// takes longer than the five seconds a test gets by default.
vi.setConfig({ testTimeout: 60_000 });

/**
 * Migration 0017 (3c design, section 6.3) against the real database: the trigger that decides whether an appeal is
 * open, a review as a decision of its own with its appeal forced, who may review, what a review and a correction do to
 * an appeal, and the seal taken while deciding that the database now refuses when it would not be in force.
 *
 * Each test runs inside one transaction that is rolled back, as korbat_api, the role the running API holds; the few
 * that must move a decision's time, link a staff account or change which staff accounts exist run as the migrator, and
 * say so. A decision and a review are made through the moderation module's own functions with a made-up confirmation
 * (the audit row is never committed), and the check at commit is made to run right after each. The staff accounts' auth
 * rows are committed by the file's set-up, since the triggers read them in the auth schema; their profiles exist only
 * inside each test's transaction. The file's last test holds it to leaving no row behind.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: appeals and reviews in the database (migration 0017)", () => {
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  /** Two moderators and two admins: whoever decides, someone else of the needed role is left to review. */
  let mod: TestStaff;
  let mod2: TestStaff;
  let admin: TestStaff;
  let admin2: TestStaff;
  /** A personal account, which a test may link to a staff account inside its own transaction. */
  let personal: string;
  let before: Record<string, number>;

  const counts = async (): Promise<Record<string, number>> => ({ ...(await rowCounts(apiDb)), ...(await authCaseCounts(migrateDb)) });

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    // The migrate role is not part of the API configuration; the test environment carries it.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    repo = createAuthRepo(authDb);
    mod = await newTestStaff(authDb, migrateDb, repo, "moderator");
    mod2 = await newTestStaff(authDb, migrateDb, repo, "moderator");
    admin = await newTestStaff(authDb, migrateDb, repo, "admin");
    admin2 = await newTestStaff(authDb, migrateDb, repo, "admin");
    personal = (await newUserWithDevice(repo)).user.id;
    before = await counts();
  }, 60_000);
  afterAll(async () => {
    await Promise.all([closeDb(apiDb), closeDb(authDb), closeDb(migrateDb)]);
  });

  /** One test's world: a transaction of the given pool that is rolled back, with the four staff members' profiles in it. */
  const inWorld = (fn: (tx: DbTx) => Promise<void>, db: Db = apiDb) =>
    rolledBack(db, async (tx) => {
      for (const staff of [mod, mod2, admin, admin2]) await staffProfile(tx, staff);
      await fn(tx);
    });
  const profile = (tx: DbTx) => newProfile(tx as unknown as Db);
  /** The error of one step inside a transaction, which stays usable: the step runs in a savepoint. */
  const within = (tx: DbTx, fn: (sp: DbTx) => Promise<unknown>) => pgError(tx.transaction(fn));
  /** What an appeal was refused with, in a savepoint: the trigger's code, the violated constraint, or null when it was stored. */
  const appealRefusal = async (tx: DbTx, decisionId: string, appellantId: string) => {
    try {
      await tx.transaction((sp) => appealOf(sp, decisionId, appellantId));
      return null;
    } catch (err) {
      const found = raised(err);
      return found?.code === "P0001" ? found.message : found?.code === "23505" ? "appeals_once" : `${found?.code} ${found?.message}`;
    }
  };

  /** A staff session as requireStaff hands it over. */
  function sessionOf(staff: TestStaff): ActiveStaffSession {
    const now = new Date();
    return {
      sessionId: hex64(),
      handle: randomUUID(),
      userId: staff.id,
      keyId: staff.keyId,
      role: staff.role,
      createdAt: now,
      lastUsedAt: now,
      idleExpiresAt: new Date(now.getTime() + 15 * 60_000),
      absoluteExpiresAt: new Date(now.getTime() + 12 * 60 * 60_000),
      browser: "Firefox on Linux",
    };
  }

  interface Restricted {
    authorId: string;
    postId: string;
    mediaIds: string[];
    reporterId: string | null;
    caseId: string;
    decisionId: string;
  }

  /**
   * An author's post with this many images, reported once (under a rule, or on the path for child sexual abuse material)
   * and restricted by a final decision: a removal by the first moderator under the report's rule, unless said.
   */
  async function restricted(tx: DbTx, options: { images?: number; by?: "rule" | "csam"; rule?: RuleId; reporterId?: string; decider?: TestStaff; decision?: DecisionInput } = {}): Promise<Restricted> {
    const authorId = (await profile(tx)).id;
    const postId = await newPostRow(tx, authorId);
    const mediaIds: string[] = [];
    for (let position = 0; position < (options.images ?? 0); position++) mediaIds.push(await newImageRow(tx, authorId, postId, position));
    const csam = options.by === "csam";
    const reporterId = csam ? null : (options.reporterId ?? (await profile(tx)).id);
    const recorded = await intake(tx, csam ? ground.csam() : ground.rule(reporterId!, options.rule ?? "R1"), aPost(postId));
    const caseId = recorded.items[0]!.caseId!;
    const decision: DecisionInput = { kind: "final", ruleId: csam ? "R2" : (options.rule ?? "R1"), actions: [act("remove")], ...options.decision };
    const decisionId = await decideIn(tx, options.decider ?? mod, caseId, decision);
    return { authorId, postId, mediaIds, reporterId, caseId, decisionId };
  }

  describe("an appeal is open for the author of a final restriction that is in force, within its window", () => {
    test("the author's appeal is stored unanswered and stamped by the database, whatever the insert supplied; a second one is refused by the unique index", async () => {
      await inWorld(async (tx) => {
        const r = await restricted(tx);
        const [row] = await tx.execute<Record<string, unknown>>(sql`
          insert into appeals (decision_id, appellant_account_id, filed_at, answered_by, result, answered_at, erased_at)
          values (${r.decisionId}::uuid, ${r.authorId}::uuid, '2001-01-01T00:00:00Z', ${r.decisionId}::uuid, 'kept', '2001-01-01T00:00:00Z', '2001-01-01T00:00:00Z')
          returning filed_at = now() as filed_now, answered_by, result, answered_at, erased_at`);
        expect({ ...row! }).toEqual({ filed_now: true, answered_by: null, result: null, answered_at: null, erased_at: null });
        // One appeal for each decision, also once it is answered.
        expect(await appealRefusal(tx, r.decisionId, r.authorId)).toBe("appeals_once");
        // An appeal changes nothing of its case: its version is the one the console read.
        expect((await readCase(tx, r.caseId)).state_version).toBe(1);
      });
    });

    test("an appeal of a decision taken while deciding, of one that restricts nothing, of a correction, of a review, of someone else's decision and of none is refused as appeal_not_open", async () => {
      await inWorld(async (tx) => {
        // What korbat does while it decides cannot be appealed.
        const authorId = (await profile(tx)).id;
        const postId = await newPostRow(tx, authorId);
        const imageId = await newImageRow(tx, authorId, postId, 0);
        const reporter = await profile(tx);
        const caseId = (await intake(tx, ground.rule(reporter.id), aPost(postId))).items[0]!.caseId!;
        const interim = await decideIn(tx, mod2, caseId, { kind: "interim", actions: [act("withhold")] });
        expect(await appealRefusal(tx, interim, authorId)).toBe("appeal_not_open");
        // The final decision removes the post and one image: its author may appeal it, and nobody else may.
        const removal = await decideIn(tx, mod, caseId, { kind: "final", actions: [act("remove"), act("remove_media", imageId)] });
        expect(await appealRefusal(tx, removal, reporter.id)).toBe("appeal_not_open");
        expect(await appealRefusal(tx, removal, (await profile(tx)).id)).toBe("appeal_not_open");
        expect(await appealRefusal(tx, randomUUID(), authorId)).toBe("appeal_not_open");
        // A correction that reverses part of it is no decision to appeal; the removal itself still is.
        const correction = await decideIn(tx, admin, caseId, { kind: "correction", outcome: "partly_reversed", reviewsDecisionId: removal, actions: [act("restore_media", imageId)] });
        expect(await appealRefusal(tx, correction, authorId)).toBe("appeal_not_open");
        const appeal = await appealOf(tx, removal, authorId, "I do not think this broke the rule.");
        expect(await appealRow(tx, appeal)).toMatchObject({ decision_id: removal, appellant_account_id: authorId, statement: "I do not think this broke the rule.", answered_by: null, result: null });
        // Nor is the review that answers it.
        const review = await reviewIn(tx, admin2, removal);
        expect(await appealRefusal(tx, review, authorId)).toBe("appeal_not_open");

        // A final decision that finds no breach restricts nothing.
        const other = await newPostRow(tx, authorId);
        const otherCase = (await intake(tx, ground.rule(reporter.id), aPost(other))).items[0]!.caseId!;
        const noAction = await decideIn(tx, mod, otherCase, { kind: "final", outcome: "no_violation" });
        expect(await appealRefusal(tx, noAction, authorId)).toBe("appeal_not_open");
      });
    });

    test("the window ends six calendar months after the author was told, by the clock read when the appeal arrives", async () => {
      // As the migrator: only it may move the time a decision was told.
      await inWorld(async (tx) => {
        const closed = await restricted(tx);
        const open = await restricted(tx);
        // The latest minute of being told whose window has closed by now, and the earliest whose window stays open for five more minutes.
        await tx.execute(sql`
          update decisions set informed_at = (
            select max(t) from generate_series(clock_timestamp() - interval '6 months 5 days', clock_timestamp() - interval '5 months 25 days', interval '1 minute') t
             where public.appeal_deadline(t) <= clock_timestamp())
           where id = ${closed.decisionId}::uuid`);
        await tx.execute(sql`
          update decisions set informed_at = (
            select min(t) from generate_series(clock_timestamp() - interval '6 months 5 days', clock_timestamp() - interval '5 months 25 days', interval '1 minute') t
             where public.appeal_deadline(t) > clock_timestamp() + interval '5 minutes')
           where id = ${open.decisionId}::uuid`);
        const [edges] = await tx.execute<{ apart: boolean }>(sql`
          select (select informed_at from decisions where id = ${open.decisionId}::uuid) - (select informed_at from decisions where id = ${closed.decisionId}::uuid) between interval '1 minute' and interval '10 minutes' as apart`);
        expect(edges!.apart).toBe(true);
        expect(await appealRefusal(tx, closed.decisionId, closed.authorId)).toBe("appeal_not_open");
        expect(await appealRefusal(tx, open.decisionId, open.authorId)).toBeNull();
        // The month-end clamp: told on 31 August, the window ends on the last day of February.
        const [clamp] = await tx.execute<{ ok: boolean }>(sql`select public.appeal_deadline('2025-08-31T12:00:00Z') = '2026-02-28T12:00:00Z'::timestamptz and public.appeal_deadline('2027-08-31T12:00:00Z') = '2028-02-29T12:00:00Z'::timestamptz as ok`);
        expect(clamp!.ok).toBe(true);
      }, migrateDb);
    });

    test("a restriction that a correction reversed in full leaves nothing to appeal; one reversed in part can still be appealed", async () => {
      await inWorld(async (tx) => {
        const whole = await restricted(tx);
        await decideIn(tx, admin, whole.caseId, { kind: "correction", reviewsDecisionId: whole.decisionId, actions: [act("restore")] });
        expect(await inForce(tx, { caseId: whole.caseId })).toEqual([]);
        expect(await appealRefusal(tx, whole.decisionId, whole.authorId)).toBe("appeal_not_open");

        // A decision with two measures, of which a correction lifts one.
        const authorId = (await profile(tx)).id;
        const postId = await newPostRow(tx, authorId);
        const imageId = await newImageRow(tx, authorId, postId, 0);
        const caseId = (await intake(tx, ground.rule((await profile(tx)).id), aPost(postId))).items[0]!.caseId!;
        const both = await decideIn(tx, mod, caseId, { kind: "final", actions: [act("remove"), act("remove_media", imageId)] });
        await decideIn(tx, admin, caseId, { kind: "correction", outcome: "partly_reversed", reviewsDecisionId: both, actions: [act("restore")] });
        expect(await inForce(tx, { caseId })).toEqual([`remove_media:${imageId}`]);
        expect(await appealRefusal(tx, both, authorId)).toBeNull();
      });
    });
  });

  describe("a review answers exactly its one appeal", () => {
    test("a kept review: the database forces its appeal, its source and that the author is told, answers the appeal and moves the case's version; nothing is lifted", async () => {
      await inWorld(async (tx) => {
        const r = await restricted(tx);
        const appeal = await appealOf(tx, r.decisionId, r.authorId);
        const params = await reviewParams(tx, mod2, r.decisionId);
        expect(params).toMatchObject({ appealId: appeal, outcome: "kept", actions: [] });
        const review = await reviewWith(tx, mod2, r.decisionId, params);

        const row = await decisionRow(tx, review);
        expect(row).toMatchObject({ case_id: r.caseId, kind: "review", outcome: "kept", ground: null, rule_id: null, source: "report", suspect: false, unseen: false, needs_admin: false, ended_interim: false, author_mail: "pending", decided_by: mod2.id });
        const [named] = await tx.execute<{ appeal_id: string; reviews_decision_id: string }>(sql`select appeal_id, reviews_decision_id from decisions where id = ${review}::uuid`);
        expect({ ...named! }).toEqual({ appeal_id: appeal, reviews_decision_id: r.decisionId });
        expect(await appealRow(tx, appeal)).toMatchObject({ answered_by: review, result: "kept", erased_at: null });
        const [answered] = await tx.execute<{ now: boolean }>(sql`select answered_at = now() as now from appeals where id = ${appeal}::uuid`);
        expect(answered!.now).toBe(true);
        expect((await readCase(tx, r.caseId)).state_version).toBe(2);
        // The reason is confirmed by the review, and the removal stands.
        const [text] = await tx.execute<{ kind: string; decision_id: string | null }>(sql`select kind, decision_id from staff_texts where digest = ${params.reasonDigest}`);
        expect({ ...text! }).toEqual({ kind: "review_reason", decision_id: review });
        expect(await actionsOf(tx, review)).toEqual([]);
        expect(await postRow(tx, r.postId)).toMatchObject({ level: "removed" });
        expect((await itemsOf(tx, r.caseId))[0]).toMatchObject({ revision_pending_at: null });
        // The appeal is answered: a second review finds none pending.
        expect(await refusal(reviewIn(tx, admin, r.decisionId))).toBe("case_changed");
      });
    });

    test("whatever appeal an insert names, the review's appeal is the reviewed decision's pending one; with none pending the trigger refuses it as case_changed", async () => {
      await inWorld(async (tx) => {
        const [one, other, none] = [await restricted(tx), await restricted(tx), await restricted(tx)];
        const [appeal, otherAppeal] = [await appealOf(tx, one.decisionId, one.authorId), await appealOf(tx, other.decisionId, other.authorId)];

        // A decision nobody appealed: the trigger itself refuses its review, whatever the module checked before.
        const q = await reviewParams(tx, mod2, none.decisionId);
        const raw = await within(tx, (sp) => insertReview(sp, { id: randomUUID(), caseId: none.caseId, reviewsDecisionId: none.decisionId, decidedBy: mod2.id, params: q }));
        expect(raw).toEqual({ code: "P0001", message: "case_changed" });
        // And the module refuses a review whose confirmed appeal is not the pending one before it writes anything.
        expect(await refusal(reviewWith(tx, mod2, other.decisionId, { ...(await reviewParams(tx, mod2, other.decisionId)), appealId: appeal }))).toBe("case_changed");
        expect(await appealRow(tx, otherAppeal)).toMatchObject({ answered_by: null });

        // A row that names the other decision's appeal: the database stores the reviewed decision's own. (The row has no
        // audit row, so it is the last thing this transaction writes: the check at commit would refuse it.)
        const p = await reviewParams(tx, mod2, one.decisionId);
        const id = randomUUID();
        await tx.execute(sql`
          insert into decisions (id, case_id, kind, reviews_decision_id, appeal_id, seen_state_version, outcome, rules_version, redress_version, category, snapshot_id, snapshot_digest, reason_digest, decided_by)
          values (${id}::uuid, ${one.caseId}::uuid, 'review', ${one.decisionId}::uuid, ${otherAppeal}::uuid, ${p.stateVersion}, 'kept', ${p.rulesVersion}, ${p.redressVersion}, ${p.category},
                  ${p.snapshotId}::uuid, ${p.snapshotDigest}, ${p.reasonDigest}, ${mod2.id}::uuid)`);
        const [stored] = await tx.execute<{ appeal_id: string }>(sql`select appeal_id from decisions where id = ${id}::uuid`);
        expect(stored!.appeal_id).toBe(appeal);
        expect(await appealRow(tx, appeal)).toMatchObject({ answered_by: id, result: "kept" });
        expect(await appealRow(tx, otherAppeal)).toMatchObject({ answered_by: null, result: null });
      });
    });

    test("a review whose audit row names another appeal than the one the database forced is refused at COMMIT", async () => {
      await inWorld(async (tx) => {
        const r = await restricted(tx);
        await appealOf(tx, r.decisionId, r.authorId);
        const params = await reviewParams(tx, mod2, r.decisionId);
        const forged = { ...params, appealId: randomUUID() };
        const { session, confirmed } = madeUpConfirmation(mod2, r.decisionId, params as never);
        const atCommit = tx.transaction(async (sp) => {
          const id = randomUUID();
          await insertReview(sp, { id, caseId: r.caseId, reviewsDecisionId: r.decisionId, decidedBy: mod2.id, params });
          await appendConfirmedAudit(sp, {
            actorId: mod2.id,
            keyId: mod2.keyId,
            action: "appeals_reviewed",
            targetType: "decision",
            targetId: r.decisionId,
            metadata: { params: forged, decisionId: id },
            staffSession: session.handle,
            actionHash: confirmed.actionHash,
            stepUp: confirmed.assertion,
            requestId: "req-forged",
            expiresAt: confirmed.expiresAt,
          });
          await sp.execute(sql`set constraints public.decisions_check, public.decision_actions_recheck immediate`);
        });
        expect(await pgError(atCommit)).toEqual({ code: "P0001", message: "invalid_decision" });
        expect(await refusalDetail(atCommit)).toBe("params: appealId differ from the decision.");
      });
    });

    test("a review is made of a final restriction of its own case, with that decision's category and rules version and a review reason", async () => {
      await inWorld(async (tx) => {
        const r = await restricted(tx);
        await appealOf(tx, r.decisionId, r.authorId);
        const p = await reviewParams(tx, mod2, r.decisionId);
        const insert = (overrides: Partial<typeof p>, reviewsDecisionId = r.decisionId, caseId = r.caseId) =>
          within(tx, (sp) => insertReview(sp, { id: randomUUID(), caseId, reviewsDecisionId, decidedBy: mod2.id, params: { ...p, ...overrides } }));
        const refused = { code: "P0001", message: "invalid_decision" };
        expect(await insert({ category: "STATEMENT_CATEGORY_VIOLENCE" })).toEqual(refused);
        expect(await insert({ rulesVersion: p.rulesVersion + 1 })).toEqual(refused);
        // A decision of another case, and one that is no final restriction, is not reviewed here.
        const other = await restricted(tx);
        expect(await insert({}, other.decisionId)).toEqual(refused);
        // A reason of another kind is not a review's.
        const reason = await decisionParams(tx, mod2, r.caseId, { kind: "interim", actions: [act("withhold")] });
        expect(await insert({ reasonDigest: reason.reasonDigest! })).toEqual({ code: "P0001", message: "text_not_found" });
        // A review never restricts: a measure in its ledger is refused.
        const withMeasure = await within(tx, async (sp) => {
          const id = randomUUID();
          await insertReview(sp, { id, caseId: r.caseId, reviewsDecisionId: r.decisionId, decidedBy: mod2.id, params: p });
          await insertAction(sp, id, act("remove"));
        });
        expect(withMeasure).toEqual(refused);
        // The version the reviewer saw: another decision since then is case_changed.
        expect(await insert({ stateVersion: p.stateVersion + 1 })).toEqual({ code: "P0001", message: "case_changed" });
        expect(await refusal(reviewWith(tx, mod2, r.decisionId, p))).toBeNull();
      });
    });
  });

  describe("who may review", () => {
    test("nobody reviews a case in which they decided anything, a measure taken while deciding included, or opened a finding: reviewer_conflict", async () => {
      await inWorld(async (tx) => {
        // The second moderator withheld the post while deciding; the first removed it.
        const authorId = (await profile(tx)).id;
        const postId = await newPostRow(tx, authorId);
        const caseId = (await intake(tx, ground.rule((await profile(tx)).id), aPost(postId))).items[0]!.caseId!;
        await decideIn(tx, mod2, caseId, { kind: "interim", actions: [act("withhold")] });
        const removal = await decideIn(tx, mod, caseId, { kind: "final", actions: [act("remove")] });
        await appealOf(tx, removal, authorId);
        for (const decider of [mod, mod2]) expect(await refusal(reviewIn(tx, decider, removal)), decider.id).toBe("reviewer_conflict");

        // A case the first admin opened as a finding of their own and the first moderator decided.
        const found = await newPostRow(tx, authorId);
        const foundCase = (await intake(tx, ground.finding(admin.id, "R1"), aPost(found))).items[0]!.caseId!;
        const foundRemoval = await decideIn(tx, mod, foundCase, { kind: "final", actions: [act("remove")] });
        await appealOf(tx, foundRemoval, authorId);
        expect(await refusal(reviewIn(tx, admin, foundRemoval))).toBe("reviewer_conflict");
        // Someone who took no part reviews each.
        expect(await refusal(reviewIn(tx, admin2, removal))).toBeNull();
        expect(await refusal(reviewIn(tx, mod2, foundRemoval))).toBeNull();
      });
    });

    test("a reviewer whose linked personal account reported the item the reviewed decision answered is recused", async () => {
      // As the migrator: only it writes the link of a staff account to a personal one.
      await inWorld(async (tx) => {
        await tx.execute(sql`insert into profiles (id, handle, display_name) values (${personal}::uuid, ${`p_${hex64().slice(0, 10)}`}, 'Personal')`);
        await tx.execute(sql`insert into auth.staff_personal_accounts (staff_user_id, personal_user_id) values (${mod2.id}::uuid, ${personal}::uuid)`);
        const r = await restricted(tx, { reporterId: personal });
        await appealOf(tx, r.decisionId, r.authorId);
        expect(await refusal(reviewIn(tx, mod2, r.decisionId))).toBe("staff_recused");
        expect(await refusal(reviewIn(tx, admin, r.decisionId))).toBeNull();
      }, migrateDb);
    });

    test("review_needs_admin reads two stored facts: true for a decision that cites R2 or holds a seal, false for every other, a restriction under R5 and a frozen post's included", async () => {
      await inWorld(async (tx) => {
        const needs = async (decisionId: string) => (await tx.execute<{ needs: boolean }>(sql`select public.review_needs_admin(${decisionId}::uuid) as needs`))[0]!.needs;
        expect(await needs(randomUUID())).toBe(false);

        // A removal under R5 is an admin's decision, and its review is any eligible moderator's.
        const threat = await restricted(tx, { rule: "R5", decider: admin });
        expect((await decisionRow(tx, threat.decisionId)).needs_admin).toBe(true);
        expect(await needs(threat.decisionId)).toBe(false);
        await appealOf(tx, threat.decisionId, threat.authorId);
        const review = await reviewIn(tx, mod2, threat.decisionId);
        expect(await decisionRow(tx, review)).toMatchObject({ needs_admin: false, decided_by: mod2.id });

        // A removal under R2, on a report of child sexual abuse material: its review is an admin's.
        const r2 = await restricted(tx, { by: "csam", decider: admin });
        expect(await needs(r2.decisionId)).toBe(true);
        await appealOf(tx, r2.decisionId, r2.authorId);
        expect(await refusal(reviewIn(tx, mod2, r2.decisionId))).toBe("admin_required");
        const byAdmin = await reviewIn(tx, admin2, r2.decisionId);
        expect(await decisionRow(tx, byAdmin)).toMatchObject({ needs_admin: true, suspect: true });

        // An admin's answer to such a report without a seal, restricting the text under another rule: no admin for its review.
        const authorId = (await profile(tx)).id;
        const postId = await newPostRow(tx, authorId);
        await intake(tx, ground.rule((await profile(tx)).id, "R1"), aPost(postId));
        const caseId = (await intake(tx, ground.csam(), aPost(postId))).items[0]!.caseId!;
        const noSeal = await decideIn(tx, admin, caseId, { kind: "final", ruleId: "R1", actions: [act("remove")] });
        expect(await decisionRow(tx, noSeal)).toMatchObject({ suspect: true, needs_admin: true });
        expect(await needs(noSeal)).toBe(false);

        // A removal under R1 of a post that a later report of this kind freezes: the answer never reads the freeze.
        const later = await restricted(tx, { images: 1 });
        await intake(tx, ground.csam(), aPost(later.postId));
        const [frozen] = await tx.execute<{ frozen: boolean }>(sql`select public.post_frozen(${later.postId}::uuid) as frozen`);
        expect(frozen!.frozen).toBe(true);
        expect(await needs(later.decisionId)).toBe(false);
      });
    });

    test("a review that lifts a seal for good is an admin's: refused to a moderator, accepted for an admin who took no part, and the images are unsealed", async () => {
      await inWorld(async (tx) => {
        const sealed = await restricted(tx, { images: 2, by: "csam", decider: admin, decision: { kind: "final", ruleId: "R2", actions: [act("seal_media")] } });
        expect(await imageStates(tx, sealed.mediaIds)).toEqual(["sealed", "sealed"]);
        const [needs] = await tx.execute<{ needs: boolean }>(sql`select public.review_needs_admin(${sealed.decisionId}::uuid) as needs`);
        expect(needs!.needs).toBe(true);
        await appealOf(tx, sealed.decisionId, sealed.authorId);
        const lift = { outcome: "reversed", actions: [act("unseal_media")] } as const;
        expect(await refusal(reviewIn(tx, mod2, sealed.decisionId, lift))).toBe("admin_required");
        // The admin who sealed does not review their own decision.
        expect(await refusal(reviewIn(tx, admin, sealed.decisionId, lift))).toBe("reviewer_conflict");
        const review = await reviewIn(tx, admin2, sealed.decisionId, lift);
        expect(await decisionRow(tx, review)).toMatchObject({ kind: "review", outcome: "reversed", needs_admin: true });
        expect(await actionsOf(tx, review)).toEqual([expect.objectContaining({ kind: "unseal_media", media_id: null, post_id: null })]);
        expect(await inForce(tx, { caseId: sealed.caseId })).toEqual([]);
        expect(await imageStates(tx, sealed.mediaIds)).toEqual(["visible", "visible"]);
      });
    });

    test("appeal_reviewer_state answers one word: with one staff account, with two who both decided, with a second one linked to a reporter, with an eligible one, counting only admins where the review needs one, and nothing for an answered appeal", async () => {
      // As the migrator: the test decides which staff accounts korbat has, inside its own transaction.
      await inWorld(async (tx) => {
        const only = async (...staff: TestStaff[]) => {
          await tx.execute(sql`update auth.users set role = 'moderator' where id = any(${`{${[mod.id, mod2.id].join(",")}}`}::uuid[])`);
          await tx.execute(sql`update auth.users set role = 'admin' where id = any(${`{${[admin.id, admin2.id].join(",")}}`}::uuid[])`);
          await tx.execute(sql`update auth.users set role = 'user' where role <> 'user' and not (id = any(${`{${staff.map((member) => member.id).join(",")}}`}::uuid[]))`);
        };
        const state = async (appealId: string) => (await tx.execute<{ state: string | null }>(sql`select public.appeal_reviewer_state(${appealId}::uuid) as state`))[0]!.state;
        expect(await state(randomUUID())).toBeNull();

        // The second moderator withheld, the first removed, and the reporter is the personal account.
        await tx.execute(sql`insert into profiles (id, handle, display_name) values (${personal}::uuid, ${`p_${hex64().slice(0, 10)}`}, 'Personal')`);
        const authorId = (await profile(tx)).id;
        const postId = await newPostRow(tx, authorId);
        const caseId = (await intake(tx, ground.rule(personal), aPost(postId))).items[0]!.caseId!;
        await decideIn(tx, mod2, caseId, { kind: "interim", actions: [act("withhold")] });
        const removal = await decideIn(tx, mod, caseId, { kind: "final", actions: [act("remove")] });
        const appeal = await appealOf(tx, removal, authorId);

        await only(mod);
        expect(await state(appeal)).toBe("none_single_staff");
        // The author reads it in the same word, and no more.
        expect((await authorDecisionView(moderationDeps(tx), authorId, removal)).appeal).toEqual({ state: "pending", filedAt: expect.any(String), reviewer: "none_single_staff", needsAdmin: false });
        await only(mod, mod2);
        expect(await state(appeal)).toBe("none_eligible");
        await only(mod, mod2, admin);
        expect(await state(appeal)).toBe("available");
        // An account that is taken down is no reviewer.
        await tx.execute(sql`update auth.users set deleted_at = now() where id = ${admin.id}::uuid`);
        expect(await state(appeal)).toBe("none_eligible");
        await tx.execute(sql`update auth.users set deleted_at = null where id = ${admin.id}::uuid`);
        // The admin's linked personal account reported in the case: too close to review it.
        await tx.execute(sql`insert into auth.staff_personal_accounts (staff_user_id, personal_user_id) values (${admin.id}::uuid, ${personal}::uuid)`);
        expect(await state(appeal)).toBe("none_eligible");
        await only(mod, mod2, admin, admin2);
        expect(await state(appeal)).toBe("available");

        // What the console reads of it: the marks of the list, of the case and of the home screen.
        const deps = moderationDeps(tx);
        const rowFor = async (staff: TestStaff) => (await appealsList(deps, sessionOf(staff))).appeals.find((row) => row.id === appeal);
        expect(await rowFor(admin2)).toEqual({
          id: appeal,
          caseId,
          decisionId: removal,
          filedAt: expect.any(String),
          decidedAt: expect.any(String),
          deadline: expect.any(String),
          ruleId: "R1",
          legal: false,
          actions: ["remove"],
          reviewer: "available",
          needsAdmin: false,
          mayReview: true,
        });
        // The deciders and the linked admin may not, and the row says no more than that.
        for (const staff of [mod, mod2, admin]) expect((await rowFor(staff))?.mayReview, staff.id).toBe(false);
        expect(JSON.stringify(await rowFor(mod))).not.toMatch(/statement/);
        const counted = async (staff: TestStaff) => {
          const seen = await overview(deps, sessionOf(staff));
          return [seen.appealsWaiting, seen.appealsYouMayReview, seen.appealsWithoutReviewer];
        };
        const [waiting, , without] = await counted(mod);
        expect(await counted(mod)).toEqual([waiting, 0, without]);
        expect(await counted(admin2)).toEqual([waiting, 1, without]);
        await only(mod, mod2);
        expect(await counted(mod)).toEqual([waiting, 0, without! + 1]);
        await only(mod, mod2, admin, admin2);
        expect((await readCaseView(deps, sessionOf(admin2), caseId)).appeals).toEqual([
          { id: appeal, decisionId: removal, filedAt: expect.any(String), statement: null, answeredAt: null, result: null, answeredBy: null, reviewer: "available", needsAdmin: false, mayReview: true },
        ]);

        // A decision under R2: only admins count, in each answer.
        const r2 = await restricted(tx, { by: "csam", decider: admin });
        const r2Appeal = await appealOf(tx, r2.decisionId, r2.authorId);
        await only(admin, mod, mod2);
        expect(await state(r2Appeal)).toBe("none_single_staff");
        expect((await authorDecisionView(moderationDeps(tx), r2.authorId, r2.decisionId)).appeal).toMatchObject({ reviewer: "none_single_staff", needsAdmin: true });
        await only(admin, admin2, mod);
        expect(await state(r2Appeal)).toBe("available");
        const r2Row = async (staff: TestStaff) => (await appealsList(deps, sessionOf(staff))).appeals.find((row) => row.id === r2Appeal);
        expect(await r2Row(mod)).toMatchObject({ needsAdmin: true, mayReview: false, reviewer: "available" });
        expect(await r2Row(admin2)).toMatchObject({ needsAdmin: true, mayReview: true });

        // Answered, an appeal has no reviewer state, and nobody may review it.
        const review = await reviewIn(tx, admin2, removal);
        expect(await state(appeal)).toBeNull();
        expect((await readCaseView(deps, sessionOf(admin2), caseId)).appeals).toEqual([expect.objectContaining({ id: appeal, result: "kept", answeredBy: review, reviewer: null, mayReview: false })]);
        expect(await rowFor(admin2)).toBeUndefined();
      }, migrateDb);
    });
  });

  describe("what a review and a correction do", () => {
    test("a review that reverses lifts the measures still in force and marks the answered items; one that reverses part leaves the rest; the outcome is held to the ledger", async () => {
      await inWorld(async (tx) => {
        const authorId = (await profile(tx)).id;
        const postId = await newPostRow(tx, authorId);
        const imageId = await newImageRow(tx, authorId, postId, 0);
        const caseId = (await intake(tx, ground.rule((await profile(tx)).id), aPost(postId))).items[0]!.caseId!;
        const removal = await decideIn(tx, mod, caseId, { kind: "final", actions: [act("remove"), act("remove_media", imageId)] });
        await appealOf(tx, removal, authorId);

        // "Kept" lifts nothing, "reversed" leaves nothing, "partly reversed" leaves something: each is held to the ledger.
        expect(await refusalDetail(reviewIn(tx, mod2, removal, { outcome: "kept", actions: [act("restore")] }))).toBe("kept: a review that keeps the decision holds no measure and no reversal.");
        expect(await refusalDetail(reviewIn(tx, mod2, removal, { outcome: "reversed", actions: [act("restore")] }))).toBe("reversed: a measure of the reviewed decision is still in force.");
        expect(await refusalDetail(reviewIn(tx, mod2, removal, { outcome: "partly_reversed", actions: [act("restore"), act("restore_media", imageId)] }))).toBe("partly_reversed: no measure of the reviewed decision is left in force.");
        expect(await refusalDetail(reviewIn(tx, mod2, removal, { outcome: "reversed", actions: [] }))).toBe("reversed: a reversing decision holds at least one reversal.");

        const review = await reviewIn(tx, mod2, removal, { outcome: "partly_reversed", actions: [act("restore")] });
        expect(await actionsOf(tx, review)).toEqual([expect.objectContaining({ kind: "restore", post_id: postId, no_effect: null })]);
        const [lifted] = await tx.execute<{ reverses: string; of: string }>(sql`select r.reverses_action_id as reverses, a.decision_id as of from decision_actions r join decision_actions a on a.id = r.reverses_action_id where r.decision_id = ${review}::uuid`);
        expect(lifted!.of).toBe(removal);
        // The post is shown again, its image stays removed, and the report's sender is told the new outcome at the next release.
        expect(await postRow(tx, postId)).toMatchObject({ state: "visible", level: "visible" });
        expect(await imageStates(tx, [imageId])).toEqual(["removed"]);
        expect(await inForce(tx, { caseId })).toEqual([`remove_media:${imageId}`]);
        const [item] = await tx.execute<{ pending: boolean }>(sql`select revision_pending_at = now() as pending from intake_items where case_id = ${caseId}::uuid`);
        expect(item!.pending).toBe(true);
        const [appeal] = await tx.execute<{ result: string; answered_by: string }>(sql`select result, answered_by from appeals where decision_id = ${removal}::uuid`);
        expect({ ...appeal! }).toEqual({ result: "partly_reversed", answered_by: review });
      });
    });

    test("a correction that reverses everything answers the pending appeal as reversed; one that reverses part leaves it for a review of what remains", async () => {
      await inWorld(async (tx) => {
        const whole = await restricted(tx);
        const wholeAppeal = await appealOf(tx, whole.decisionId, whole.authorId);
        const correction = await decideIn(tx, admin, whole.caseId, { kind: "correction", reviewsDecisionId: whole.decisionId, actions: [act("restore")] });
        expect(await appealRow(tx, wholeAppeal)).toMatchObject({ answered_by: correction, result: "reversed" });
        const [at] = await tx.execute<{ now: boolean }>(sql`select answered_at = now() as now from appeals where id = ${wholeAppeal}::uuid`);
        expect(at!.now).toBe(true);
        // Nothing is left to review.
        expect(await refusal(reviewIn(tx, mod2, whole.decisionId))).toBe("case_changed");

        const authorId = (await profile(tx)).id;
        const postId = await newPostRow(tx, authorId);
        const imageId = await newImageRow(tx, authorId, postId, 0);
        const caseId = (await intake(tx, ground.rule((await profile(tx)).id), aPost(postId))).items[0]!.caseId!;
        const removal = await decideIn(tx, mod, caseId, { kind: "final", actions: [act("remove"), act("remove_media", imageId)] });
        const appeal = await appealOf(tx, removal, authorId);
        await decideIn(tx, admin, caseId, { kind: "correction", outcome: "partly_reversed", reviewsDecisionId: removal, actions: [act("restore_media", imageId)] });
        expect(await appealRow(tx, appeal)).toMatchObject({ answered_by: null, result: null });
        // The review's reversals reach only what is still in force: the image's removal is lifted already.
        expect(await refusal(reviewIn(tx, mod2, removal, { outcome: "reversed", actions: [act("restore"), act("restore_media", imageId)] }))).toBe("invalid_decision");
        // The admin who corrected decided in the case, and does not review it.
        expect(await refusal(reviewIn(tx, admin, removal))).toBe("reviewer_conflict");
        const review = await reviewIn(tx, mod2, removal, { outcome: "reversed", actions: [act("restore")] });
        expect(await appealRow(tx, appeal)).toMatchObject({ answered_by: review, result: "reversed" });
        expect(await inForce(tx, { caseId })).toEqual([]);
      });
    });
  });

  describe("a seal taken while deciding that would not be in force is refused by the ledger's own trigger", () => {
    /** A committed post with one image and a rule report, the first moderator's profile committed beside it; everything is removed after `fn`. */
    async function withCommitted(fn: (made: { postId: string; mediaId: string; caseId: string }) => Promise<void>) {
      const [author, reporter] = [await newProfile(apiDb), await newProfile(apiDb)];
      await staffProfile(apiDb, mod);
      try {
        const postId = await newPostRow(apiDb, author.id);
        const mediaId = await newImageRow(apiDb, author.id, postId, 0);
        const caseId = (await intake(apiDb, ground.rule(reporter.id), aPost(postId))).items[0]!.caseId!;
        await fn({ postId, mediaId, caseId });
      } finally {
        await removeFixtures(migrateDb, [author.id, reporter.id]);
        await migrateDb.execute(sql`delete from profiles where id = ${mod.id}::uuid`);
      }
    }
    /** The seal's decision and its measure as the module writes them, in the caller's transaction, without an audit row. */
    async function seal(tx: DbTx, caseId: string): Promise<string> {
      const params = await decisionParams(tx, mod, caseId, { kind: "interim", ruleId: "R2", actions: [act("seal_media")] });
      const id = randomUUID();
      await insertDecision(tx, { id, caseId, decidedBy: mod.id, params });
      await insertAction(tx, id, act("seal_media"));
      return id;
    }

    test("the only unanswered report of child sexual abuse material committed after the decision's transaction began: case_changed, and nothing of the seal is stored", async () => {
      await withCommitted(async ({ postId, mediaId, caseId }) => {
        const outcome = await pgError(
          rolledBack(apiDb, async (tx) => {
            // The transaction has begun, which fixes its time; the report commits in another session afterwards.
            await tx.execute(sql`select now()`);
            await intake(apiDb, ground.csam(), aPost(postId));
            await seal(tx, caseId);
          }),
        );
        expect(outcome).toEqual({ code: "P0001", message: "case_changed" });
        const [stored] = await apiDb.execute<{ decisions: number; lists: number }>(sql`select (select count(*)::int from decisions where case_id = ${caseId}::uuid) as decisions, (select count(*)::int from seal_posts where post_id = ${postId}::uuid) as lists`);
        expect({ ...stored! }).toEqual({ decisions: 0, lists: 0 });
        expect(await imageStates(apiDb, [mediaId])).toEqual(["visible"]);
      });
    });

    test("an earlier unanswered report of that kind and a later one: the seal rests on the earlier one, is in force and seals the image", async () => {
      await withCommitted(async ({ postId, mediaId, caseId }) => {
        await intake(apiDb, ground.csam(), aPost(postId));
        const outcome = await pgError(
          rolledBack(apiDb, async (tx) => {
            await tx.execute(sql`select now()`);
            await intake(apiDb, ground.csam(), aPost(postId));
            const id = await seal(tx, caseId);
            const [order] = await tx.execute<{ earlier: boolean; later: boolean }>(sql`
              select (select min(created_at) from intake_items where case_id = ${caseId}::uuid and suspect) <= (select decided_at from decisions where id = ${id}::uuid) as earlier,
                     (select max(created_at) from intake_items where case_id = ${caseId}::uuid and suspect) > (select decided_at from decisions where id = ${id}::uuid) as later`);
            expect({ ...order! }).toEqual({ earlier: true, later: true });
            expect(await inForce(tx, { caseId })).toEqual(["seal_media"]);
            expect(await imageStates(tx, [mediaId])).toEqual(["sealed"]);
          }),
        );
        // The transaction ran to its end and was rolled back on purpose: no audit row was written, so nothing may commit.
        expect(outcome).toBeNull();
        expect(await imageStates(apiDb, [mediaId])).toEqual(["visible"]);
      });
    });
  });

  test("this file left no row behind: the tables it writes and the four auth tables of moderation cases hold what they held before it", async () => {
    expect(await counts()).toEqual(before);
  });
});
