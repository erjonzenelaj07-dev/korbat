import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { CaseDecidedParams, RuleId } from "@korbat/contracts";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { appendConfirmedAudit, insertAction, insertDecision } from "../../src/moderation/repo";
import {
  SPEECH,
  TC,
  aPost,
  act,
  actionsOf,
  anAccount,
  decideIn,
  decideWith,
  decisionParams,
  decisionRow,
  ground,
  hex64,
  inForce,
  intake,
  itemsOf,
  madeUpConfirmation,
  newImageRow,
  newPostRow,
  newTestStaff,
  newestSnapshot,
  postRow,
  readCase,
  refusal,
  refusalDetail,
  rowCounts,
  saveText,
  staffProfile,
  type DecisionInput,
  type TestStaff,
} from "./moderation-fixtures";
import { newProfile } from "./social-fixtures";
import { newUserWithDevice } from "./auth-fixtures";
import { pgError, rolledBack } from "./staff-fixtures";

// Every test here runs dozens of statements inside one open transaction, each a round trip: on a loaded machine that
// takes longer than the five seconds a test gets by default.
vi.setConfig({ testTimeout: 60_000 });

/**
 * The decision triggers of migration 0016 (3c design, section 6.2) against the real database, step by step:
 * decisions_record, decisions_apply, decision_actions_check, decision_actions_apply and the deferred decisions_check.
 * Each test runs as korbat_api, the role the running API holds, inside one transaction that is rolled back: its accounts,
 * posts, reports and decisions exist only there. A decision is made through the moderation module's own decide, with a
 * made-up confirmation (the audit row it writes is never committed), and its check at commit is made to run right after
 * it; a statement the triggers refuse runs in a savepoint, so the transaction goes on. The staff accounts' auth rows and
 * keys are committed by the file's set-up, since the triggers read them in the auth schema; their profiles exist only
 * inside each test's transaction. The file's last test holds it to leaving no row behind.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the decision triggers", () => {
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  let mod: TestStaff;
  let admin: TestStaff;
  /** A personal account the operator linked to the moderator's staff account. It has a profile only where a test gives it one. */
  let linked: string;
  let before: Record<string, number>;

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    // The migrate role is not part of the API configuration; the test environment carries it.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    repo = createAuthRepo(authDb);
    mod = await newTestStaff(authDb, migrateDb, repo, "moderator");
    admin = await newTestStaff(authDb, migrateDb, repo, "admin");
    // The link is written only by the migrator (`staff.js link`), and read only by the definer functions.
    linked = (await newUserWithDevice(repo)).user.id;
    await migrateDb.execute(sql`insert into auth.staff_personal_accounts (staff_user_id, personal_user_id) values (${mod.id}::uuid, ${linked}::uuid)`);
    before = await rowCounts(apiDb);
  }, 60_000);
  afterAll(async () => {
    await migrateDb.execute(sql`delete from auth.staff_personal_accounts where staff_user_id = ${mod.id}::uuid`);
    await Promise.all([closeDb(apiDb), closeDb(authDb), closeDb(migrateDb)]);
  });

  /** One test's world: a transaction of the given pool that is rolled back, with both staff members' profiles in it. */
  const inWorld = (fn: (tx: DbTx) => Promise<void>, db: Db = apiDb) =>
    rolledBack(db, async (tx) => {
      await staffProfile(tx, mod);
      await staffProfile(tx, admin);
      await fn(tx);
    });
  const profile = (tx: DbTx) => newProfile(tx as unknown as Db);
  /** The error of one step inside a transaction, which stays usable: the step runs in a savepoint. */
  const within = (tx: DbTx, fn: (sp: DbTx) => Promise<unknown>) => pgError(tx.transaction(fn));

  /** An author's post with this many images, and its case, opened by one intake. */
  async function reportedPost(tx: DbTx, options: { images?: number; by?: "rule" | "illegal" | "csam" | "finding"; rule?: RuleId; authorId?: string } = {}) {
    const authorId = options.authorId ?? (await profile(tx)).id;
    const postId = await newPostRow(tx, authorId);
    const mediaIds: string[] = [];
    for (let position = 0; position < (options.images ?? 0); position++) mediaIds.push(await newImageRow(tx, authorId, postId, position));
    const reporter = await profile(tx);
    const by = options.by ?? "rule";
    const g = by === "csam" ? ground.csam() : by === "illegal" ? ground.illegal(reporter.id) : by === "finding" ? ground.finding(mod.id, options.rule ?? "R1") : ground.rule(reporter.id, options.rule ?? "R1");
    const recorded = await intake(tx, g, aPost(postId));
    return { authorId, postId, mediaIds, reporter, caseId: recorded.items[0]!.caseId!, recorded };
  }
  /** An account and its case, opened by one rule report that names it. */
  async function reportedAccount(tx: DbTx, options: { rule?: RuleId; by?: "rule" | "csam" } = {}) {
    const account = await profile(tx);
    const reporter = await profile(tx);
    const recorded = await intake(tx, options.by === "csam" ? ground.csam() : ground.rule(reporter.id, options.rule ?? "R6"), anAccount(account.id, account.handle));
    return { account, reporter, caseId: recorded.items[0]!.caseId!, recorded };
  }
  /** One more report into the target's open case. */
  async function alsoReported(tx: DbTx, postId: string, by: "rule" | "illegal" | "csam" = "rule", rule: RuleId = "R1") {
    const reporter = await profile(tx);
    const g = by === "csam" ? ground.csam() : by === "illegal" ? ground.illegal(reporter.id) : ground.rule(reporter.id, rule);
    return { reporter, recorded: await intake(tx, g, aPost(postId)) };
  }
  /**
   * The decision's row and its measures as the module writes them, without the audit row and without the check at commit:
   * for the tests that reach a trigger with something the module's own schema would not let through.
   */
  async function rawDecision(tx: DbTx, staff: TestStaff, caseId: string, input: DecisionInput, overrides: Partial<CaseDecidedParams> = {}) {
    const params = { ...(await decisionParams(tx, staff, caseId, input)), ...overrides } as CaseDecidedParams;
    const id = randomUUID();
    await insertDecision(tx, { id, caseId, decidedBy: staff.id, params });
    for (const action of params.actions) await insertAction(tx, id, action);
    return { id, params };
  }

  describe("a decision's forced columns and what it does to its case", () => {
    test("an interim withhold: the database sets the decision's facts, moves the case's version, confirms the texts and withholds the post", async () => {
      await inWorld(async (tx) => {
        const r = await reportedPost(tx);
        expect(await readCase(tx, r.caseId)).toMatchObject({ state_version: 0, intake_seq: 1, answered_seq: 0, last_decided_at: null });
        const params = await decisionParams(tx, mod, r.caseId, { kind: "interim", actions: [act("withhold")] });
        const id = await decideWith(tx, mod, r.caseId, params);

        const row = await decisionRow(tx, id);
        expect(row).toMatchObject({
          case_id: r.caseId,
          kind: "interim",
          outcome: "restricted",
          ground: "incompatible",
          rule_id: "R1",
          through_seq: 0,
          answers_from_seq: null,
          source: "report",
          suspect: false,
          unseen: false,
          needs_admin: false,
          ended_interim: false,
          author_mail: "pending",
          decided_by: mod.id,
          automated_detection: false,
          automated_decision: "not_automated",
          territorial_scope: "worldwide",
          redacted_at: null,
        });
        expect(row.puid).toMatch(/^[0-9a-f]{32}$/);
        const [times] = await tx.execute<{ decided_now: boolean; informed: boolean; own_xact: boolean; mail_at: string | null }>(
          sql`select decided_at = now() as decided_now, informed_at = decided_at as informed, xact = pg_current_xact_id() as own_xact, author_mail_at::text as mail_at from decisions where id = ${id}::uuid`,
        );
        expect({ ...times! }).toEqual({ decided_now: true, informed: true, own_xact: true, mail_at: null });

        // An interim decision answers nothing: the item stays open, and the case stays as it was but for its version.
        expect(await readCase(tx, r.caseId)).toMatchObject({ state_version: 1, intake_seq: 1, answered_seq: 0, closed_at: null });
        expect((await itemsOf(tx, r.caseId))[0]).toMatchObject({ answered_by: null, outcome: null });
        const [decided] = await tx.execute<{ at_start: boolean }>(sql`select last_decided_at = now() as at_start from cases where id = ${r.caseId}::uuid`);
        expect(decided!.at_start).toBe(true);

        // Both texts are confirmed, by this decision.
        const texts = await tx.execute<{ kind: string; decision_id: string | null; confirmed: boolean }>(
          sql`select kind, decision_id, confirmed_at = now() as confirmed from staff_texts where digest in (${params.factsDigest}, ${params.reasonDigest}) order by kind`,
        );
        expect(texts.map((t) => ({ ...t }))).toEqual([
          { kind: "facts", decision_id: id, confirmed: true },
          { kind: "reason", decision_id: id, confirmed: true },
        ]);

        // The measure: its subject and its post are the database's, and the post is withheld by the derivation.
        expect(await actionsOf(tx, id)).toEqual([expect.objectContaining({ kind: "withhold", media_id: null, subject_account_id: r.authorId, post_id: r.postId, reverses_action_id: null, no_effect: null })]);
        expect(await postRow(tx, r.postId)).toEqual({ state: "withheld", level: "withheld", erased: false });
        expect(await inForce(tx, { caseId: r.caseId })).toEqual(["withhold"]);
      });
    });

    test("whatever an insert supplies for a forced column, the row holds the database's value", async () => {
      await inWorld(async (tx) => {
        const r = await reportedPost(tx);
        const p = await decisionParams(tx, mod, r.caseId, { kind: "interim", actions: [act("withhold")] });
        const id = randomUUID();
        await tx.execute(sql`
          insert into decisions (id, case_id, kind, seen_state_version, through_seq, answers_from_seq, outcome, ground, rule_id, rules_version, redress_version, category, source,
                                 automated_detection, automated_decision, snapshot_id, snapshot_digest, facts_digest, reason_digest, decided_by, decided_at, xact, puid, informed_at,
                                 suspect, unseen, needs_admin, ended_interim, author_mail, author_mail_at, redacted_at)
          values (${id}::uuid, ${r.caseId}::uuid, 'interim', 0, 0, 7, 'restricted', 'incompatible', 'R1', ${p.rulesVersion}, ${p.redressVersion}, ${TC}, 'notice',
                  true, 'fully', ${p.snapshotId}::uuid, ${p.snapshotDigest}, ${p.factsDigest}, ${p.reasonDigest}, ${mod.id}::uuid, '2001-01-01T00:00:00Z', '1'::xid8, 'chosen', '2001-01-01T00:00:00Z',
                  true, true, true, true, 'sent', '2001-01-01T00:00:00Z', '2001-01-01T00:00:00Z')`);
        const row = await decisionRow(tx, id);
        expect(row).toMatchObject({ answers_from_seq: null, source: "report", automated_detection: false, automated_decision: "not_automated", suspect: false, unseen: false, needs_admin: false, ended_interim: false, author_mail: "pending", redacted_at: null });
        expect(row.puid).not.toBe("chosen");
        const [times] = await tx.execute<{ ok: boolean }>(sql`select decided_at = now() and informed_at = now() and xact = pg_current_xact_id() and author_mail_at is null as ok from decisions where id = ${id}::uuid`);
        expect(times!.ok).toBe(true);

        // A ledger row's forced columns likewise.
        const other = await profile(tx);
        const [action] = await tx.execute<Record<string, unknown>>(sql`
          insert into decision_actions (decision_id, kind, media_id, subject_account_id, post_id, reverses_action_id, no_effect, created_at)
          values (${id}::uuid, 'withhold', null, ${other.id}::uuid, ${randomUUID()}::uuid, null, 'already', '2001-01-01T00:00:00Z')
          returning subject_account_id, post_id, no_effect, created_at = now() as created_now`);
        expect(action).toEqual({ subject_account_id: r.authorId, post_id: r.postId, no_effect: null, created_now: true });
      });
    });

    test("a decision that names a case that does not exist is refused as a missing reference", async () => {
      await inWorld(async (tx) => {
        const r = await reportedPost(tx);
        const p = await decisionParams(tx, mod, r.caseId, { kind: "interim", actions: [act("withhold")] });
        const err = await within(tx, (sp) => insertDecision(sp, { id: randomUUID(), caseId: randomUUID(), decidedBy: mod.id, params: p }));
        expect(err?.code).toBe("23503");
      });
    });
  });

  describe("the version and the range", () => {
    test("a decision names the case's version its moderator saw, and is refused once another decision landed", async () => {
      await inWorld(async (tx) => {
        const r = await reportedPost(tx);
        const stale = await decisionParams(tx, mod, r.caseId, { kind: "interim", actions: [act("withhold")] });
        expect(await refusal(decideIn(tx, mod, r.caseId, { kind: "interim", actions: [act("withhold")], stateVersion: 1 }))).toBe("case_changed");
        await decideIn(tx, admin, r.caseId, { kind: "interim", actions: [act("withhold")] });
        // The first moderator's decision was built on version 0; the case is at 1 now.
        expect(await refusal(decideWith(tx, mod, r.caseId, stale))).toBe("case_changed");
        expect((await readCase(tx, r.caseId)).state_version).toBe(1);
      });
    });

    test("a new report does not change the version: a decision on what the moderator saw still lands, and the new item stays open", async () => {
      await inWorld(async (tx) => {
        const r = await reportedPost(tx);
        const seen = await decisionParams(tx, mod, r.caseId, { kind: "final", outcome: "no_violation" });
        expect(seen.throughSeq).toBe(1);
        await alsoReported(tx, r.postId);
        await decideWith(tx, mod, r.caseId, seen);
        const items = await itemsOf(tx, r.caseId);
        expect(items.map((item) => [item.seq, item.outcome])).toEqual([
          [1, "no_violation"],
          [2, null],
        ]);
        expect(await readCase(tx, r.caseId)).toMatchObject({ answered_seq: 1, intake_seq: 2, closed_at: null, state_version: 1 });
      });
    });

    test("a final decision answers from the first unanswered item through its through_seq, which lies in that range", async () => {
      await inWorld(async (tx) => {
        const r = await reportedPost(tx);
        await alsoReported(tx, r.postId, "rule", "R3");
        await alsoReported(tx, r.postId);
        // Nothing, beyond the newest item, and (after the first answer) what is answered already.
        for (const throughSeq of [0, 4]) expect(await refusal(decideIn(tx, mod, r.caseId, { kind: "final", outcome: "no_violation", throughSeq })), String(throughSeq)).toBe("case_changed");
        const first = await decideIn(tx, mod, r.caseId, { kind: "final", outcome: "no_violation", throughSeq: 2 });
        expect(await decisionRow(tx, first)).toMatchObject({ answers_from_seq: 1, through_seq: 2 });
        for (const throughSeq of [1, 2]) expect(await refusal(decideIn(tx, mod, r.caseId, { kind: "final", outcome: "no_violation", throughSeq })), String(throughSeq)).toBe("case_changed");

        // The case stays open with the third item: its lane and oldest time are the unanswered items'.
        const open = await readCase(tx, r.caseId);
        expect(open).toMatchObject({ answered_seq: 2, intake_seq: 3, lane: 2, closed_at: null });
        const items = await itemsOf(tx, r.caseId);
        expect(open.oldest_open_at).toEqual(items[2]!.created_at);
        expect(items.map((item) => item.answered_by)).toEqual([first, first, null]);

        const second = await decideIn(tx, mod, r.caseId, { kind: "final", outcome: "no_violation" });
        expect(await decisionRow(tx, second)).toMatchObject({ answers_from_seq: 3, through_seq: 3 });
        const closed = await readCase(tx, r.caseId);
        expect(closed).toMatchObject({ answered_seq: 3, lane: 2, oldest_open_at: null, state_version: 2 });
        expect(closed.closed_at).not.toBeNull();
      });
    });

    test("while items stay unanswered the case keeps the most severe lane among them", async () => {
      await inWorld(async (tx) => {
        const r = await reportedPost(tx, { rule: "R1" });
        await alsoReported(tx, r.postId, "rule", "R3");
        expect((await readCase(tx, r.caseId)).lane).toBe(1);
        await decideIn(tx, mod, r.caseId, { kind: "final", outcome: "no_violation", throughSeq: 1 });
        expect((await readCase(tx, r.caseId)).lane).toBe(1);
      });
    });
  });

  describe("the kind and its outcomes", () => {
    test("an interim decision restricts, a final one restricts or finds no breach, each on an open case; a review is not for whoever decided in the case", async () => {
      await inWorld(async (tx) => {
        const r = await reportedPost(tx);
        const refused = { code: "P0001", message: "invalid_decision" };
        expect(await within(tx, (sp) => rawDecision(sp, mod, r.caseId, { kind: "interim" }, { outcome: "no_violation" }))).toEqual(refused);
        expect(await within(tx, (sp) => rawDecision(sp, mod, r.caseId, { kind: "final" }, { outcome: "reversed" }))).toEqual(refused);
        // Once the case is closed nothing more is decided on it but a correction.
        const removal = await decideIn(tx, mod, r.caseId, { kind: "final", actions: [act("remove")] });
        expect(await within(tx, (sp) => rawDecision(sp, mod, r.caseId, { kind: "interim", actions: [act("withhold")] }))).toEqual(refused);
        expect(await within(tx, (sp) => rawDecision(sp, mod, r.caseId, { kind: "final", outcome: "no_violation", throughSeq: 1 }))).toEqual(refused);
        // A review of that removal, well formed and with its appeal, by the moderator who removed the post: the trigger
        // itself refuses it, since nobody reviews a case they decided in (migration 0017; its own tests cover reviews).
        const [appeal] = await tx.execute<{ id: string }>(sql`insert into appeals (decision_id, appellant_account_id, filed_at) values (${removal}::uuid, ${r.authorId}::uuid, now()) returning id`);
        const review = await decisionParams(tx, mod, r.caseId, { kind: "correction", reviewsDecisionId: removal, actions: [act("restore")] });
        const asReview = () =>
          tx.transaction((sp) =>
            sp.execute(sql`
              insert into decisions (id, case_id, kind, reviews_decision_id, appeal_id, seen_state_version, through_seq, outcome, rules_version, redress_version, category, snapshot_id, snapshot_digest,
                                     reason_digest, decided_by)
              values (gen_random_uuid(), ${r.caseId}::uuid, 'review', ${removal}::uuid, ${appeal!.id}::uuid, ${review.stateVersion}, 0, 'kept', ${review.rulesVersion}, ${review.redressVersion}, ${review.category},
                      ${review.snapshotId}::uuid, ${review.snapshotDigest}, ${review.reasonDigest}, ${mod.id}::uuid)`),
          );
        expect(await pgError(asReview())).toEqual({ code: "P0001", message: "reviewer_conflict" });
        expect(await refusal(decideIn(tx, mod, r.caseId, { kind: "correction", reviewsDecisionId: removal, actions: [act("restore")] }))).toBeNull();
      });
    });

    test("a correction reverses a restricting interim or final decision of its own case, with that decision's category and rules version and a reason", async () => {
      await inWorld(async (tx) => {
        const r = await reportedPost(tx);
        const other = await reportedPost(tx);
        const withhold = await decideIn(tx, mod, r.caseId, { kind: "interim", actions: [act("withhold")] });
        const elsewhere = await decideIn(tx, mod, other.caseId, { kind: "interim", actions: [act("withhold")] });
        const correct = (overrides: Partial<CaseDecidedParams>, input: DecisionInput = {}) =>
          within(tx, (sp) => rawDecision(sp, mod, r.caseId, { kind: "correction", reviewsDecisionId: withhold, actions: [act("restore")], ...input }, overrides));
        const refused = { code: "P0001", message: "invalid_decision" };
        expect(await correct({ outcome: "restricted" })).toEqual(refused);
        expect(await correct({ reviewsDecisionId: elsewhere })).toEqual(refused);
        expect(await correct({ category: SPEECH })).toEqual(refused);
        expect(await correct({ rulesVersion: 1 })).toEqual(refused);
        expect(await correct({ reasonDigest: null })).toEqual(refused);
        expect(await correct({ reviewsDecisionId: null })).toEqual(refused);
        // The table's own checks hold the rest: only a correction names a decision, and it states no ground of its own.
        expect(await within(tx, (sp) => rawDecision(sp, mod, r.caseId, { kind: "interim", actions: [act("withhold")] }, { reviewsDecisionId: withhold }))).toMatchObject({
          code: "23514",
          message: expect.stringMatching(/decisions_review_target/),
        });
        expect(await correct({ ground: "incompatible", ruleId: "R1" })).toMatchObject({ code: "23514", message: expect.stringMatching(/decisions_reversal_plain/) });

        // A correction of a correction, or of a decision that restricted nothing, corrects nothing.
        const lifted = await decideIn(tx, mod, r.caseId, { kind: "correction", reviewsDecisionId: withhold, actions: [act("restore")] });
        expect(await decisionRow(tx, lifted)).toMatchObject({ kind: "correction", outcome: "reversed", source: "report", suspect: false, needs_admin: false });
        expect(await correct({ reviewsDecisionId: lifted })).toEqual(refused);
        const none = await decideIn(tx, mod, r.caseId, { kind: "final", outcome: "no_violation" });
        expect(await correct({ reviewsDecisionId: none })).toEqual(refused);
      });
    });

    test("the table's checks: a keyword needs the ground of the law, a decision on the law cites no rule and names its reference, a restriction carries its ground and texts", async () => {
      await inWorld(async (tx) => {
        const r = await reportedPost(tx, { by: "illegal" });
        const input: DecisionInput = { kind: "final", outcome: "restricted", ground: "illegal", actions: [act("remove")] };
        const insert = (overrides: Partial<CaseDecidedParams>, base: DecisionInput = input) => within(tx, (sp) => rawDecision(sp, admin, r.caseId, base, overrides));
        const check = (name: string) => expect.objectContaining({ code: "23514", message: expect.stringMatching(new RegExp(`violates check constraint "${name}"`)) });
        // A null ground is the row a plain comparison would let through: its result is null, and a check passes on a null.
        expect(await insert({ categoryKeyword: "KEYWORD_TERRORIST_CONTENT" }, { kind: "final", outcome: "no_violation" })).toEqual(check("decisions_keyword"));
        expect(await insert({ categoryKeyword: "KEYWORD_TERRORIST_CONTENT" }, { kind: "final", outcome: "restricted", actions: [act("remove")] })).toEqual(check("decisions_keyword"));
        expect(await insert({ ruleId: "R3" })).toEqual(check("decisions_law_no_rule"));
        expect(await insert({ legalReferenceDigest: null })).toEqual(check("decisions_ground_law"));
        expect(await insert({ ground: "incompatible", ruleId: null })).toEqual(check("decisions_ground_rule"));
        expect(await insert({ ground: null })).toEqual(check("decisions_restricted"));
        expect(await insert({ factsDigest: null })).toEqual(check("decisions_restricted"));
        expect(await insert({ throughSeq: 1 }, { kind: "interim", actions: [act("withhold")] })).toEqual(check("decisions_interim"));
        // The decision on the law itself, with its keyword, stands.
        const id = await decideIn(tx, admin, r.caseId, { ...input, categoryKeyword: "KEYWORD_TERRORIST_CONTENT" });
        expect(await decisionRow(tx, id)).toMatchObject({ ground: "illegal", rule_id: null, source: "notice" });
      });
    });
  });

  describe("the snapshot and the texts", () => {
    test("the snapshot belongs to the case and has the digest the decision names", async () => {
      await inWorld(async (tx) => {
        const r = await reportedPost(tx);
        const other = await reportedPost(tx);
        const theirs = await newestSnapshot(tx, other.caseId);
        const decideOn = (input: DecisionInput) => refusal(decideIn(tx, mod, r.caseId, { kind: "interim", actions: [act("withhold")], ...input }));
        expect(await decideOn({ snapshotId: theirs.id, snapshotDigest: theirs.digest })).toBe("snapshot_mismatch");
        expect(await decideOn({ snapshotId: randomUUID(), snapshotDigest: hex64() })).toBe("snapshot_mismatch");
        expect(await decideOn({ snapshotId: (await newestSnapshot(tx, r.caseId)).id, snapshotDigest: hex64() })).toBe("snapshot_mismatch");
        expect(await decideOn({})).toBeNull();
      });
    });

    test("an erased snapshot is refused by its own code", async () => {
      // Only a migrator-owned function of a later migration erases a snapshot; here the migrator marks one itself.
      await inWorld(async (tx) => {
        const r = await reportedPost(tx);
        const snapshot = await newestSnapshot(tx, r.caseId);
        await tx.execute(sql`update evidence_snapshots set erased_at = now(), body = null, media = null, salt = null where id = ${snapshot.id}::uuid`);
        expect(await refusal(decideIn(tx, mod, r.caseId, { kind: "interim", actions: [act("withhold")] }))).toBe("snapshot_erased");
      }, migrateDb);
    });

    test("each text is a saved, unconfirmed text of this case, by the deciding account, of the matching kind", async () => {
      await inWorld(async (tx) => {
        const r = await reportedPost(tx, { by: "illegal" });
        const other = await reportedPost(tx);
        const decideOn = (input: DecisionInput) => refusal(decideIn(tx, admin, r.caseId, { kind: "interim", actions: [act("withhold")], ...input }));
        // Never saved; saved on another case; saved by another staff member; saved as another kind.
        expect(await decideOn({ factsDigest: hex64() })).toBe("text_not_found");
        expect(await decideOn({ factsDigest: await saveText(tx, other.caseId, admin.id, "facts") })).toBe("text_not_found");
        expect(await decideOn({ reasonDigest: await saveText(tx, r.caseId, mod.id, "reason") })).toBe("text_not_found");
        expect(await decideOn({ factsDigest: await saveText(tx, r.caseId, admin.id, "reason") })).toBe("text_not_found");
        expect(await decideOn({ reasonDigest: await saveText(tx, r.caseId, admin.id, "note") })).toBe("text_not_found");
        expect(await decideOn({ ground: "illegal", ruleId: null, legalReferenceDigest: await saveText(tx, r.caseId, admin.id, "reason") })).toBe("text_not_found");

        // A text a decision confirmed is used: no second decision names it.
        const facts = await saveText(tx, r.caseId, admin.id, "facts");
        expect(await decideOn({ factsDigest: facts })).toBeNull();
        expect(await decideOn({ factsDigest: facts, actions: [] , kind: "final", outcome: "restricted" })).toBe("text_not_found");
      });
    });

    test("a correction's reason is a review reason, and an erased text names nothing", async () => {
      await inWorld(async (tx) => {
        const r = await reportedPost(tx);
        const withhold = await decideIn(tx, mod, r.caseId, { kind: "interim", actions: [act("withhold")] });
        const correct = (reasonDigest: string) => refusal(decideIn(tx, mod, r.caseId, { kind: "correction", reviewsDecisionId: withhold, actions: [act("restore")], reasonDigest }));
        expect(await correct(await saveText(tx, r.caseId, mod.id, "reason"))).toBe("text_not_found");
        const erased = await saveText(tx, r.caseId, mod.id, "review_reason");
        await tx.execute(sql`update staff_texts set erased_at = now(), text = null, salt = null where digest = ${erased}`);
        expect(await correct(erased)).toBe("text_not_found");
        expect(await correct(await saveText(tx, r.caseId, mod.id, "review_reason"))).toBeNull();
      }, migrateDb);
    });
  });

  describe("the parties: no staff account decides where it, or an account close to it, is a party", () => {
    test("the case's subject, and the signed-in reporters of the items the decision considers", async () => {
      await inWorld(async (tx) => {
        // The moderator's own post.
        const own = await reportedPost(tx, { authorId: mod.id });
        expect(await refusal(decideIn(tx, mod, own.caseId, { kind: "interim", actions: [act("withhold")] }))).toBe("staff_recused");
        expect(await refusal(decideIn(tx, admin, own.caseId, { kind: "interim", actions: [act("withhold")] }))).toBeNull();

        // A post the moderator's own account reported: an interim decision considers every unanswered item.
        const r = await reportedPost(tx);
        await intake(tx, ground.rule(mod.id), aPost(r.postId));
        expect(await refusal(decideIn(tx, mod, r.caseId, { kind: "interim", actions: [act("withhold")] }))).toBe("staff_recused");
        // A final decision considers the items it answers: through the first item the moderator is no party, through both it is.
        expect(await refusal(decideIn(tx, mod, r.caseId, { kind: "final", outcome: "no_violation", throughSeq: 2 }))).toBe("staff_recused");
        const first = await decideIn(tx, mod, r.caseId, { kind: "final", outcome: "no_violation", throughSeq: 1 });
        expect((await decisionRow(tx, first)).through_seq).toBe(1);
        expect(await refusal(decideIn(tx, mod, r.caseId, { kind: "final", outcome: "no_violation" }))).toBe("staff_recused");
        expect(await refusal(decideIn(tx, admin, r.caseId, { kind: "final", outcome: "no_violation" }))).toBeNull();
      });
    });

    test("a correction considers the items its corrected decision answered", async () => {
      await inWorld(async (tx) => {
        const r = await reportedPost(tx);
        await intake(tx, ground.rule(mod.id), aPost(r.postId));
        const removal = await decideIn(tx, admin, r.caseId, { kind: "final", actions: [act("remove")] });
        const correction: DecisionInput = { kind: "correction", reviewsDecisionId: removal, actions: [act("restore")] };
        expect(await refusal(decideIn(tx, mod, r.caseId, correction))).toBe("staff_recused");
        expect(await refusal(decideIn(tx, admin, r.caseId, correction))).toBeNull();
      });
    });

    const conflict = async (tx: DbTx, staffId: string, caseId: string, everyone = false) =>
      (await tx.execute<{ conflict: boolean }>(sql`select public.staff_case_conflict(${staffId}::uuid, ${caseId}::uuid, ${everyone}::boolean) as conflict`))[0]!.conflict;

    test("an account the operator linked to the staff account: as the subject, and through what it did towards the subject", async () => {
      await inWorld(async (tx) => {
        await staffProfile(tx, { id: linked });
        // The linked account's own post.
        const own = await reportedPost(tx, { authorId: linked });
        expect(await conflict(tx, mod.id, own.caseId)).toBe(true);
        expect(await conflict(tx, admin.id, own.caseId)).toBe(false);
        expect(await refusal(decideIn(tx, mod, own.caseId, { kind: "interim", actions: [act("withhold")] }))).toBe("staff_recused");

        // What the linked account did towards the subject: a follow, a block, a mute, a reply in the last 90 days.
        const relations: [string, (subject: string, post: string) => Promise<unknown>, boolean][] = [
          ["follows the subject", (subject) => tx.execute(sql`insert into follows (follower_id, followee_id) values (${linked}::uuid, ${subject}::uuid)`), true],
          ["blocks the subject", (subject) => tx.execute(sql`insert into blocks (blocker_id, blocked_id) values (${linked}::uuid, ${subject}::uuid)`), true],
          ["mutes the subject", (subject) => tx.execute(sql`insert into mutes (muter_id, muted_id) values (${linked}::uuid, ${subject}::uuid)`), true],
          ["replied to a post of the subject 89 days ago", (_subject, post) => newPostRow(tx, linked, { replyToId: post, createdAt: sql`now() - interval '89 days'` }), true],
          ["replied to a post of the subject 91 days ago", (_subject, post) => newPostRow(tx, linked, { replyToId: post, createdAt: sql`now() - interval '91 days'` }), false],
          // What the subject did towards the linked account never counts: anyone can do it, without the staff member doing anything.
          ["is followed by the subject", (subject) => tx.execute(sql`insert into follows (follower_id, followee_id) values (${subject}::uuid, ${linked}::uuid)`), false],
          ["is blocked by the subject", (subject) => tx.execute(sql`insert into blocks (blocker_id, blocked_id) values (${subject}::uuid, ${linked}::uuid)`), false],
          ["is muted by the subject", (subject) => tx.execute(sql`insert into mutes (muter_id, muted_id) values (${subject}::uuid, ${linked}::uuid)`), false],
        ];
        for (const [label, relate, expected] of relations) {
          const r = await reportedPost(tx);
          expect(await conflict(tx, mod.id, r.caseId), `before: ${label}`).toBe(false);
          await relate(r.authorId, r.postId);
          expect(await conflict(tx, mod.id, r.caseId), label).toBe(expected);
          expect(await conflict(tx, admin.id, r.caseId), label).toBe(false);
          expect(await refusal(decideIn(tx, mod, r.caseId, { kind: "interim", actions: [act("withhold")] })), label).toBe(expected ? "staff_recused" : null);
        }
      });
    });

    test("the post a case judges: a reply to, or a quote of, a post the linked account wrote; a reply by the subject elsewhere does not count", async () => {
      await inWorld(async (tx) => {
        await staffProfile(tx, { id: linked });
        const theirs = await newPostRow(tx, linked);
        for (const how of ["replyToId", "quoteOfId"] as const) {
          const author = await profile(tx);
          const postId = await newPostRow(tx, author.id, { [how]: theirs });
          const recorded = await intake(tx, ground.rule((await profile(tx)).id), aPost(postId));
          const caseId = recorded.items[0]!.caseId!;
          expect(await conflict(tx, mod.id, caseId), how).toBe(true);
          expect(await refusal(decideIn(tx, mod, caseId, { kind: "interim", actions: [act("withhold")] })), how).toBe("staff_recused");
          // Another post of the same author, which answers nobody, is the moderator's to judge.
          const plain = await reportedPost(tx, { authorId: author.id });
          expect(await conflict(tx, mod.id, plain.caseId), how).toBe(false);
        }
      });
    });

    test("staff_case_conflict: a linked reporter counts only when everyone is asked for; an account case has no post; a missing case is no conflict", async () => {
      await inWorld(async (tx) => {
        await staffProfile(tx, { id: linked });
        const r = await reportedPost(tx);
        await intake(tx, ground.rule(linked), aPost(r.postId));
        expect(await conflict(tx, mod.id, r.caseId, false)).toBe(false);
        expect(await conflict(tx, mod.id, r.caseId, true)).toBe(true);
        expect(await conflict(tx, admin.id, r.caseId, true)).toBe(false);
        // The reporter itself, with no link: a party only among everyone.
        expect(await conflict(tx, r.reporter.id, r.caseId, false)).toBe(false);
        expect(await conflict(tx, r.reporter.id, r.caseId, true)).toBe(true);
        expect(await conflict(tx, r.authorId, r.caseId, false)).toBe(true);

        const account = await reportedAccount(tx);
        expect(await conflict(tx, mod.id, account.caseId)).toBe(false);
        await tx.execute(sql`insert into follows (follower_id, followee_id) values (${linked}::uuid, ${account.account.id}::uuid)`);
        expect(await conflict(tx, mod.id, account.caseId)).toBe(true);
        expect(await conflict(tx, account.account.id, account.caseId)).toBe(true);

        expect(await conflict(tx, mod.id, randomUUID(), true)).toBe(false);
      });
    });

    test("the API role calls staff_case_conflict, and neither of the two functions behind it", async () => {
      const call = (statement: ReturnType<typeof sql>) => pgError(apiDb.execute(statement));
      expect(await call(sql`select public.staff_case_conflict(${randomUUID()}::uuid, ${randomUUID()}::uuid, true)`)).toBeNull();
      expect((await call(sql`select public.staff_party_conflict(${randomUUID()}::uuid, '{}'::uuid[], null)`))?.message).toMatch(/permission denied for function staff_party_conflict/);
      expect((await call(sql`select public.account_is_staff(${randomUUID()}::uuid)`))?.message).toMatch(/permission denied for function account_is_staff/);
    });
  });

  describe("the role and the suspicion", () => {
    test("a final decision that answers a suspect item needs an admin, whatever it finds; whoever is on duty decides while it waits", async () => {
      await inWorld(async (tx) => {
        const r = await reportedPost(tx, { by: "csam", images: 1 });
        expect(await refusal(decideIn(tx, mod, r.caseId, { kind: "final", outcome: "no_violation" }))).toBe("admin_required");
        // A moderator's interim withhold of the frozen post, and the moderator's early lift of it.
        const withhold = await decideIn(tx, mod, r.caseId, { kind: "interim", actions: [act("withhold")] });
        expect(await decisionRow(tx, withhold)).toMatchObject({ suspect: true, needs_admin: false, unseen: false });
        const lift = await decideIn(tx, mod, r.caseId, { kind: "correction", reviewsDecisionId: withhold, actions: [act("restore")] });
        expect(await decisionRow(tx, lift)).toMatchObject({ suspect: true, needs_admin: false, ended_interim: true });
        const answer = await decideIn(tx, admin, r.caseId, { kind: "final", outcome: "no_violation" });
        expect(await decisionRow(tx, answer)).toMatchObject({ suspect: true, needs_admin: true });
      });
    });

    test("a final decision that considers an R5 item, or that cites R5 itself, needs an admin; an interim one, and a correction of it, do not", async () => {
      await inWorld(async (tx) => {
        const threat = await reportedPost(tx, { rule: "R5" });
        expect(await refusal(decideIn(tx, mod, threat.caseId, { kind: "final", outcome: "no_violation" }))).toBe("admin_required");
        const withhold = await decideIn(tx, mod, threat.caseId, { kind: "interim", ruleId: "R5", actions: [act("withhold")] });
        expect(await decisionRow(tx, withhold)).toMatchObject({ needs_admin: false, rule_id: "R5" });
        // Anyone eligible lifts what was done while deciding.
        const lift = await decideIn(tx, mod, threat.caseId, { kind: "correction", reviewsDecisionId: withhold, actions: [act("restore")] });
        expect(await decisionRow(tx, lift)).toMatchObject({ needs_admin: false, ended_interim: true, author_mail: "pending" });
        const removal = await decideIn(tx, admin, threat.caseId, { kind: "final", ruleId: "R5", actions: [act("remove")] });
        expect(await decisionRow(tx, removal)).toMatchObject({ needs_admin: true });
        // Only an admin corrects a decision that needed one.
        const correction: DecisionInput = { kind: "correction", reviewsDecisionId: removal, actions: [act("restore")] };
        expect(await refusal(decideIn(tx, mod, threat.caseId, correction))).toBe("admin_required");
        const corrected = await decideIn(tx, admin, threat.caseId, correction);
        expect(await decisionRow(tx, corrected)).toMatchObject({ needs_admin: true });

        // An R1 report that the moderator finds to be a threat: citing R5 is the admin's.
        const r = await reportedPost(tx);
        expect(await refusal(decideIn(tx, mod, r.caseId, { kind: "final", ruleId: "R5", actions: [act("remove")] }))).toBe("admin_required");
        expect(await refusal(decideIn(tx, mod, r.caseId, { kind: "final", ruleId: "R1", actions: [act("remove")] }))).toBeNull();
      });
    });

    test("a decision under R2 rests on a suspect item: without one it is refused, for an admin too", async () => {
      await inWorld(async (tx) => {
        const r = await reportedPost(tx, { images: 1 });
        for (const staff of [mod, admin]) {
          expect(await refusal(decideIn(tx, staff, r.caseId, { kind: "interim", ruleId: "R2", actions: [act("withhold")] })), staff.role).toBe("invalid_decision");
          expect(await refusal(decideIn(tx, staff, r.caseId, { kind: "final", ruleId: "R2", actions: [act("remove")] })), staff.role).toBe("invalid_decision");
        }
        // A finding citing R2 is opened first; then the case holds a suspect item.
        await intake(tx, ground.finding(mod.id, "R2"), aPost(r.postId));
        const interim = await decideIn(tx, mod, r.caseId, { kind: "interim", ruleId: "R2", actions: [act("withhold")] });
        expect(await decisionRow(tx, interim)).toMatchObject({ suspect: true, needs_admin: false, source: "report" });
        expect(await refusal(decideIn(tx, mod, r.caseId, { kind: "final", ruleId: "R2", actions: [act("remove")] }))).toBe("admin_required");
        const final = await decideIn(tx, admin, r.caseId, { kind: "final", ruleId: "R2", actions: [act("remove")] });
        expect(await decisionRow(tx, final)).toMatchObject({ suspect: true, needs_admin: true, unseen: true });
      });
    });

    test("a final decision that answers a suspect item answers every unanswered suspect item of its case, and may leave later items of another kind open", async () => {
      await inWorld(async (tx) => {
        // A notice on the CSAM path, a rule report, a second such notice.
        const r = await reportedPost(tx, { by: "csam", images: 1 });
        await alsoReported(tx, r.postId);
        await alsoReported(tx, r.postId, "csam");
        for (const throughSeq of [1, 2]) expect(await refusal(decideIn(tx, admin, r.caseId, { kind: "final", outcome: "no_violation", throughSeq })), String(throughSeq)).toBe("case_changed");
        expect(await refusal(decideIn(tx, admin, r.caseId, { kind: "final", outcome: "no_violation", throughSeq: 3 }))).toBeNull();

        // A rule report, a notice on the CSAM path, a second rule report: the admin answers through the suspect item.
        const ranged = await reportedPost(tx, { images: 1 });
        await alsoReported(tx, ranged.postId, "csam");
        await alsoReported(tx, ranged.postId);
        const answer = await decideIn(tx, admin, ranged.caseId, { kind: "final", outcome: "no_violation", throughSeq: 2 });
        expect(await decisionRow(tx, answer)).toMatchObject({ answers_from_seq: 1, through_seq: 2, suspect: true, needs_admin: true, unseen: true });
        expect((await itemsOf(tx, ranged.caseId)).map((item) => [item.seq, item.suspect, item.outcome])).toEqual([
          [1, false, "no_violation"],
          [2, true, "no_violation"],
          [3, false, null],
        ]);
        expect(await readCase(tx, ranged.caseId)).toMatchObject({ answered_seq: 2, intake_seq: 3, closed_at: null, lane: 2 });
      });
    });

    test("an item of another ground before a suspect item is the moderator's to answer, unseen", async () => {
      await inWorld(async (tx) => {
        const r = await reportedPost(tx, { images: 1 });
        await alsoReported(tx, r.postId, "csam");
        const answer = await decideIn(tx, mod, r.caseId, { kind: "final", outcome: "no_violation", throughSeq: 1 });
        expect(await decisionRow(tx, answer)).toMatchObject({ suspect: false, needs_admin: false, unseen: true });
      });
    });
  });

  describe("the caps", () => {
    /** As the migrator, which may change the limits and write rows around the triggers: nothing of it is committed. */
    const pastDecisions = (tx: DbTx, staff: TestStaff, caseId: string, snapshotId: string, count: number, ago: string) =>
      tx.execute(sql`
        insert into decisions (case_id, kind, seen_state_version, outcome, rules_version, redress_version, category, source, snapshot_id, snapshot_digest, decided_by, decided_at, xact, puid, informed_at, suspect, needs_admin, ended_interim)
        select ${caseId}::uuid, 'final', 0, 'no_violation', 2, 1, ${TC}, 'report', ${snapshotId}::uuid, ${hex64()}, ${staff.id}::uuid, now() - ${ago}::interval, '1'::xid8, md5(n::text || ${randomUUID()}), now(), false, false, false
          from generate_series(1, ${count}::int) n`);

    test("one person takes no more decisions in an hour, or in a day, than the limits allow; another person is not counted", async () => {
      await inWorld(async (tx) => {
        const r = await reportedPost(tx);
        const snapshot = await newestSnapshot(tx, r.caseId);
        await tx.execute(sql`update moderation_limits set decisions_per_hour = 3, decisions_per_day = 5`);
        const attempt = (staff: TestStaff) => refusal(decideIn(tx, staff, r.caseId, { kind: "interim", ruleId: "R1", actions: [] , outcome: "restricted" }));
        // The triggers are off only while the past rows are written.
        await tx.execute(sql`alter table public.decisions disable trigger user`);
        await pastDecisions(tx, mod, r.caseId, snapshot.id, 2, "10 minutes");
        await tx.execute(sql`alter table public.decisions enable trigger user`);
        // Two in the last hour: a third is taken, a fourth refused. The check at commit refuses these empty restrictions
        // anyway; the cap is read before it.
        expect(await attempt(mod)).toBe("invalid_decision");
        await tx.execute(sql`alter table public.decisions disable trigger user`);
        await pastDecisions(tx, mod, r.caseId, snapshot.id, 1, "20 minutes");
        await tx.execute(sql`alter table public.decisions enable trigger user`);
        expect(await attempt(mod)).toBe("decision_cap");
        expect(await attempt(admin)).toBe("invalid_decision");

        // The day's limit: three in the last hour and two more earlier today make five.
        await tx.execute(sql`update moderation_limits set decisions_per_hour = 100`);
        expect(await attempt(mod)).toBe("invalid_decision");
        await tx.execute(sql`alter table public.decisions disable trigger user`);
        await pastDecisions(tx, mod, r.caseId, snapshot.id, 2, "5 hours");
        await pastDecisions(tx, mod, r.caseId, snapshot.id, 9, "25 hours");
        await tx.execute(sql`alter table public.decisions enable trigger user`);
        expect(await attempt(mod)).toBe("decision_cap");
        await tx.execute(sql`update moderation_limits set decisions_per_day = 6`);
        expect(await attempt(mod)).toBe("invalid_decision");
      }, migrateDb);
    });

    test("without the limits' row the caps are 60 an hour and 300 a day", async () => {
      await inWorld(async (tx) => {
        const r = await reportedPost(tx);
        const snapshot = await newestSnapshot(tx, r.caseId);
        await tx.execute(sql`delete from moderation_limits`);
        const attempt = () => refusal(decideIn(tx, mod, r.caseId, { kind: "interim", actions: [act("withhold")] }));
        await tx.execute(sql`alter table public.decisions disable trigger user`);
        await pastDecisions(tx, mod, r.caseId, snapshot.id, 59, "10 minutes");
        await tx.execute(sql`alter table public.decisions enable trigger user`);
        // The sixtieth of the hour is taken; the sixty-first is refused.
        expect(await attempt()).toBeNull();
        expect(await refusal(decideIn(tx, mod, r.caseId, { kind: "final", outcome: "no_violation" }))).toBe("decision_cap");
        await tx.execute(sql`alter table public.decisions disable trigger user`);
        await tx.execute(sql`update decisions set decided_at = now() - interval '2 hours' where decided_by = ${mod.id}::uuid`);
        await pastDecisions(tx, mod, r.caseId, snapshot.id, 239, "3 hours");
        await tx.execute(sql`alter table public.decisions enable trigger user`);
        // 299 today: one more is taken, and the three-hundred-and-first refused.
        expect(await refusal(decideIn(tx, mod, r.caseId, { kind: "final", outcome: "no_violation" }))).toBeNull();
        const again = await reportedPost(tx);
        expect(await refusal(decideIn(tx, mod, again.caseId, { kind: "final", outcome: "no_violation" }))).toBe("decision_cap");
      }, migrateDb);
    });
  });

  describe("the ground, the items' outcomes and the source", () => {
    test("the ground of the law, and 'illegality not evident', need a considered item that alleges illegality", async () => {
      await inWorld(async (tx) => {
        const r = await reportedPost(tx);
        const legal: DecisionInput = { kind: "final", outcome: "restricted", ground: "illegal", actions: [act("remove")] };
        expect(await refusal(decideIn(tx, mod, r.caseId, legal))).toBe("invalid_decision");
        expect(await refusal(decideIn(tx, mod, r.caseId, { kind: "final", outcome: "not_evident" }))).toBe("invalid_decision");
        expect(await refusal(decideIn(tx, mod, r.caseId, { kind: "interim", ground: "illegal", actions: [act("withhold")] }))).toBe("invalid_decision");
        // A notice of illegality arrives: now both are open, but a final decision must answer through that item.
        await alsoReported(tx, r.postId, "illegal");
        expect(await refusal(decideIn(tx, mod, r.caseId, { ...legal, throughSeq: 1 }))).toBe("invalid_decision");
        expect(await refusal(decideIn(tx, mod, r.caseId, { kind: "interim", ground: "illegal", actions: [act("withhold")] }))).toBeNull();
        expect(await refusal(decideIn(tx, mod, r.caseId, legal))).toBeNull();
      });
    });

    test("a final decision writes each item's outcome once: on the law, on a rule, not evident for the item that alleged illegality, no breach", async () => {
      await inWorld(async (tx) => {
        const outcomes = async (decision: DecisionInput) => {
          const r = await reportedPost(tx);
          await alsoReported(tx, r.postId, "illegal");
          const id = await decideIn(tx, mod, r.caseId, { kind: "final", ...decision });
          const items = await itemsOf(tx, r.caseId);
          expect(items.every((item) => item.answered_by === id && item.outcome_sent_at === null && item.shown_outcome === null)).toBe(true);
          return items.map((item) => item.outcome);
        };
        expect(await outcomes({ outcome: "restricted", ground: "illegal", actions: [act("remove")] })).toEqual(["restricted_legal", "restricted_legal"]);
        expect(await outcomes({ outcome: "restricted", actions: [act("remove")] })).toEqual(["restricted_rule", "restricted_rule"]);
        expect(await outcomes({ outcome: "not_evident" })).toEqual(["no_violation", "not_evident"]);
        expect(await outcomes({ outcome: "no_violation" })).toEqual(["no_violation", "no_violation"]);
      });
    });

    test("the source is read from the considered items: a notice, a report, or the moderator's own finding; a correction copies it", async () => {
      await inWorld(async (tx) => {
        const found = await reportedPost(tx, { by: "finding" });
        const own = await decideIn(tx, admin, found.caseId, { kind: "interim", actions: [act("withhold")] });
        expect((await decisionRow(tx, own)).source).toBe("own_initiative");
        // A user's report joins, then a notice of illegality: each decision's source is read from the items it answers.
        await alsoReported(tx, found.postId);
        const second = await decideIn(tx, admin, found.caseId, { kind: "final", outcome: "no_violation", throughSeq: 1 });
        expect((await decisionRow(tx, second)).source).toBe("own_initiative");
        await alsoReported(tx, found.postId, "illegal");
        const third = await decideIn(tx, admin, found.caseId, { kind: "final", outcome: "no_violation", throughSeq: 2 });
        expect((await decisionRow(tx, third)).source).toBe("report");
        const fourth = await decideIn(tx, admin, found.caseId, { kind: "final", actions: [act("remove")] });
        expect((await decisionRow(tx, fourth)).source).toBe("notice");
        const correction = await decideIn(tx, admin, found.caseId, { kind: "correction", reviewsDecisionId: fourth, actions: [act("restore")] });
        expect((await decisionRow(tx, correction)).source).toBe("notice");
      });
    });
  });

  describe("measures and reversals", () => {
    test("a correction holds reversals only: a measure in one is refused, whichever it is", async () => {
      await inWorld(async (tx) => {
        const r = await reportedPost(tx, { images: 1 });
        const withheld = await decideIn(tx, mod, r.caseId, { kind: "interim", actions: [act("withhold")] });
        // The module's own schema refuses such params, so the rows are written as the module writes them, without it.
        const correction = (action: ReturnType<typeof act>) => refusalDetail(tx.transaction((sp) => rawDecision(sp, mod, r.caseId, { kind: "correction", reviewsDecisionId: withheld, actions: [action] })));
        const fit = "A decision of this kind does not hold this measure or reversal.";
        for (const measure of [act("withhold"), act("remove"), act("withhold_media", r.mediaIds[0]!), act("remove_media", r.mediaIds[0]!), act("seal_media")]) {
          expect(await correction(measure), measure.kind).toBe(fit);
        }
        // Its reversal is what a correction holds.
        expect(await correction(act("restore"))).toBeNull();
      });
    });

    test("an action's target, the measure it lifts, its effect and its time are the database's, whatever the insert supplies; a seal names no image", async () => {
      await inWorld(async (tx) => {
        const r = await reportedPost(tx, { images: 1, by: "csam" });
        const stranger = await profile(tx);
        const other = await newPostRow(tx, stranger.id);
        const { id } = await rawDecision(tx, mod, r.caseId, { kind: "interim", ruleId: "R2", actions: [] });
        const supplied = (kind: string, mediaId: string | null, effect: string) =>
          tx.execute<Record<string, unknown>>(sql`
            insert into decision_actions (decision_id, kind, media_id, subject_account_id, post_id, reverses_action_id, no_effect, created_at)
            values (${id}::uuid, ${kind}::action_kind, ${mediaId}::uuid, ${stranger.id}::uuid, ${other}::uuid, ${randomUUID()}::uuid, ${effect}, now() - interval '1 day')
            returning media_id, subject_account_id, post_id, reverses_action_id, no_effect, created_at = now() as stamped_now`);
        // A seal keeps nothing of what was supplied: it names no image and no post, and lifts nothing.
        const [seal] = await supplied("seal_media", r.mediaIds[0]!, "already");
        expect({ ...seal! }).toEqual({ media_id: null, subject_account_id: r.authorId, post_id: null, reverses_action_id: null, no_effect: null, stamped_now: true });
        // A measure on the post is about the case's own post and its author, whatever post and account the insert named.
        const [withhold] = await supplied("withhold", null, "deleted");
        expect({ ...withhold! }).toEqual({ media_id: null, subject_account_id: r.authorId, post_id: r.postId, reverses_action_id: null, no_effect: null, stamped_now: true });
      });
    });

    test("each kind of decision holds its own measures, on a case of the right kind, and at most one on the post itself", async () => {
      await inWorld(async (tx) => {
        const r = await reportedPost(tx, { images: 2 });
        const account = await reportedAccount(tx);
        const refused = { code: "P0001", message: "invalid_decision" };
        const hold = (caseId: string, input: DecisionInput) => within(tx, (sp) => rawDecision(sp, mod, caseId, input));
        // A removal is not taken while deciding, nor a withhold when the case is decided.
        expect(await hold(r.caseId, { kind: "interim", actions: [act("remove")] })).toEqual(refused);
        expect(await hold(r.caseId, { kind: "interim", actions: [act("remove_media", r.mediaIds[0]!)] })).toEqual(refused);
        expect(await hold(r.caseId, { kind: "final", actions: [act("withhold")] })).toEqual(refused);
        expect(await hold(r.caseId, { kind: "final", actions: [act("withhold_media", r.mediaIds[0]!)] })).toEqual(refused);
        // Field measures belong to an account's case, post and image measures to a post's.
        expect(await hold(r.caseId, { kind: "interim", actions: [act("reset_bio")] })).toEqual(refused);
        expect(await hold(account.caseId, { kind: "interim", actions: [act("withhold")] })).toEqual(refused);
        // An image measure names an image of the case's post, and nothing else names an image.
        const elsewhere = await reportedPost(tx, { images: 1 });
        expect(await hold(r.caseId, { kind: "interim", actions: [act("withhold_media", elsewhere.mediaIds[0]!)] })).toEqual(refused);
        expect(await hold(r.caseId, { kind: "interim", actions: [act("withhold_media", randomUUID())] })).toEqual(refused);
        expect(await within(tx, async (sp) => {
          const d = await rawDecision(sp, mod, r.caseId, { kind: "interim" });
          await sp.execute(sql`insert into decision_actions (decision_id, kind, media_id) values (${d.id}::uuid, 'withhold_media', null)`);
        })).toEqual(refused);
        expect(await within(tx, async (sp) => {
          const d = await rawDecision(sp, mod, r.caseId, { kind: "interim" });
          await sp.execute(sql`insert into decision_actions (decision_id, kind, media_id) values (${d.id}::uuid, 'withhold', ${r.mediaIds[0]!}::uuid)`);
        })).toEqual(refused);
        // Two measures on the post itself in one decision.
        expect(await within(tx, async (sp) => {
          const d = await rawDecision(sp, mod, r.caseId, { kind: "interim", actions: [act("withhold")] });
          await insertAction(sp, d.id, act("withhold"));
        })).toEqual(refused);
        // A reversal in an interim or final decision lifts the case's interim withholds only; the rest is a correction's.
        expect(await hold(r.caseId, { kind: "interim", actions: [act("unseal_media")] })).toEqual(refused);
        expect(await hold(account.caseId, { kind: "final", outcome: "no_violation", actions: [act("restore_bio")] })).toEqual(refused);

        // What does stand: a withhold of the post beside a withhold of each image.
        const id = await decideIn(tx, mod, r.caseId, { kind: "interim", actions: [act("withhold"), act("withhold_media", r.mediaIds[1]!), act("withhold_media", r.mediaIds[0]!)] });
        expect((await actionsOf(tx, id)).map((a) => [a.kind, a.media_id !== null, a.post_id])).toEqual([
          ["withhold", false, r.postId],
          ["withhold_media", true, r.postId],
          ["withhold_media", true, r.postId],
        ]);
      });
    });

    test("a second interim withhold of the post, or of the same image, while one is in force in the case is refused; of another image it stands", async () => {
      await inWorld(async (tx) => {
        const r = await reportedPost(tx, { images: 2 });
        await decideIn(tx, mod, r.caseId, { kind: "interim", actions: [act("withhold"), act("withhold_media", r.mediaIds[0]!)] });
        expect(await refusal(decideIn(tx, admin, r.caseId, { kind: "interim", actions: [act("withhold")] }))).toBe("invalid_decision");
        expect(await refusal(decideIn(tx, admin, r.caseId, { kind: "interim", actions: [act("withhold_media", r.mediaIds[0]!)] }))).toBe("invalid_decision");
        expect(await refusal(decideIn(tx, admin, r.caseId, { kind: "interim", actions: [act("withhold_media", r.mediaIds[1]!)] }))).toBeNull();
        expect(await inForce(tx, { caseId: r.caseId })).toEqual(["withhold", `withhold_media:${r.mediaIds[0]}`, `withhold_media:${r.mediaIds[1]}`].sort());
      });
    });

    test("a reversal names exactly one measure: the reviewed decision's for a correction, the case's interim withhold for an interim or final decision", async () => {
      await inWorld(async (tx) => {
        const r = await reportedPost(tx, { images: 2 });
        const [one, two] = r.mediaIds as [string, string];
        const interim = await decideIn(tx, mod, r.caseId, { kind: "interim", actions: [act("withhold"), act("withhold_media", one), act("withhold_media", two)] });
        const measures = await actionsOf(tx, interim);
        const idOf = (kind: string, mediaId: string | null = null) => measures.find((m) => m.kind === kind && m.media_id === mediaId)!.id;

        // An interim decision may lift a withhold of the case, but it restricts: with a reversal alone the commit refuses it.
        expect(await refusal(decideIn(tx, mod, r.caseId, { kind: "interim", actions: [act("restore_media", one)] }))).toBe("invalid_decision");
        // A final decision that leaves the case open lifts the post's withhold early.
        await alsoReported(tx, r.postId);
        const early = await decideIn(tx, mod, r.caseId, { kind: "final", outcome: "no_violation", throughSeq: 1, actions: [act("restore"), act("restore_media", one)] });
        expect((await actionsOf(tx, early)).map((a) => [a.kind, a.reverses_action_id, a.no_effect])).toEqual([
          ["restore", idOf("withhold"), null],
          ["restore_media", idOf("withhold_media", one), null],
        ]);
        expect(await decisionRow(tx, early)).toMatchObject({ ended_interim: true, author_mail: "pending" });
        expect(await inForce(tx, { caseId: r.caseId })).toEqual([`withhold_media:${two}`]);
        expect(await postRow(tx, r.postId)).toMatchObject({ state: "visible", level: "visible" });

        // A second lift of the same measure, by a correction or by another decision: it is no longer in force.
        expect(await refusal(decideIn(tx, mod, r.caseId, { kind: "correction", reviewsDecisionId: interim, outcome: "partly_reversed", actions: [act("restore")] }))).toBe("invalid_decision");
        expect(await refusal(decideIn(tx, mod, r.caseId, { kind: "final", outcome: "no_violation", actions: [act("restore")] }))).toBe("invalid_decision");
        // A correction of the interim decision lifts the measure that decision still holds in force, found by kind and image.
        const corrected = await decideIn(tx, mod, r.caseId, { kind: "correction", reviewsDecisionId: interim, actions: [act("restore_media", two)] });
        expect((await actionsOf(tx, corrected))[0]).toMatchObject({ kind: "restore_media", reverses_action_id: idOf("withhold_media", two) });
        expect(await decisionRow(tx, corrected)).toMatchObject({ outcome: "reversed" });
        expect(await inForce(tx, { caseId: r.caseId })).toEqual([]);
        // A correction never restricts, and lifts only what its own corrected decision holds.
        expect(await refusal(decideIn(tx, mod, r.caseId, { kind: "correction", reviewsDecisionId: early, actions: [act("restore")] }))).toBe("invalid_decision");
      });
    });

    test("the outcome and the ledger agree at commit: a restriction holds a measure, 'no breach' none, 'reversed' leaves nothing in force and 'partly reversed' something", async () => {
      await inWorld(async (tx) => {
        const r = await reportedPost(tx, { images: 2 });
        const [one, two] = r.mediaIds as [string, string];
        const detail = (input: DecisionInput) => refusalDetail(decideIn(tx, mod, r.caseId, input));
        expect(await detail({ kind: "interim", actions: [] })).toMatch(/^restricted: /);
        expect(await detail({ kind: "final", outcome: "restricted", actions: [] })).toMatch(/^restricted: /);
        expect(await detail({ kind: "final", outcome: "no_violation", actions: [act("remove")] })).toMatch(/^no action: /);

        const removal = await decideIn(tx, mod, r.caseId, { kind: "final", actions: [act("remove_media", one), act("remove_media", two)] });
        const correct = (outcome: "reversed" | "partly_reversed", actions: DecisionInput["actions"]) => detail({ kind: "correction", reviewsDecisionId: removal, outcome, actions });
        // 3e: the fixture signs the overruling of a full reversal's strike; left out here, the correction holds no reversal at all.
        expect(await detail({ kind: "correction", reviewsDecisionId: removal, outcome: "reversed", actions: [], overrule: false })).toMatch(/^reversed: a reversing decision holds at least one reversal/);
        expect(await correct("partly_reversed", [])).toMatch(/^reversed: /);
        expect(await correct("reversed", [act("restore_media", one)])).toMatch(/^reversed: a measure of the reviewed decision is still in force/);
        expect(await correct("partly_reversed", [act("restore_media", one), act("restore_media", two)])).toMatch(/^partly_reversed: /);
        expect(await correct("partly_reversed", [act("restore_media", one)])).toBeNull();
        expect(await correct("reversed", [act("restore_media", two)])).toBeNull();
      });
    });

    test("every restricting answer owns its measures, whatever the target's level: each says whether it changed anything now", async () => {
      await inWorld(async (tx) => {
        // A post another case removed: a second case's removal is recorded, in force, and changes nothing now.
        const r = await reportedPost(tx, { images: 1 });
        const first = await decideIn(tx, mod, r.caseId, { kind: "final", actions: [act("remove")] });
        expect((await actionsOf(tx, first))[0]!.no_effect).toBeNull();
        const again = await intake(tx, ground.rule((await profile(tx)).id, "R3"), aPost(r.postId));
        const second = again.items[0]!.caseId!;
        expect(second).not.toBe(r.caseId);
        // An interim withhold, and a withhold of an image, of a post that is already removed.
        const interim = await decideIn(tx, mod, second, { kind: "interim", ruleId: "R3", actions: [act("withhold"), act("withhold_media", r.mediaIds[0]!)] });
        expect((await actionsOf(tx, interim)).map((a) => [a.kind, a.no_effect])).toEqual([
          ["withhold", "already"],
          ["withhold_media", "already"],
        ]);
        expect(await decisionRow(tx, interim)).toMatchObject({ author_mail: "pending" });
        const removal = await decideIn(tx, mod, second, { kind: "final", ruleId: "R3", actions: [act("remove"), act("remove_media", r.mediaIds[0]!)] });
        expect((await actionsOf(tx, removal)).map((a) => [a.kind, a.no_effect])).toEqual([
          ["remove", "already"],
          ["remove_media", "already"],
        ]);
        expect(await decisionRow(tx, removal)).toMatchObject({ author_mail: "pending", outcome: "restricted" });
        expect((await itemsOf(tx, second))[0]).toMatchObject({ outcome: "restricted_rule" });
        expect(await inForce(tx, { postId: r.postId })).toEqual(["remove", "remove", `remove_media:${r.mediaIds[0]}`]);

        // A post its author deleted: a later report is decided on its snapshot, and its measures are recorded.
        const gone = await reportedPost(tx, { images: 1 });
        await tx.execute(sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${gone.postId}::uuid`);
        const onDeleted = await decideIn(tx, mod, gone.caseId, { kind: "interim", actions: [act("withhold")] });
        expect((await actionsOf(tx, onDeleted))[0]!.no_effect).toBe("deleted");
        // Something done while deciding about a deleted post can never take effect: it is recorded without a mail.
        expect(await decisionRow(tx, onDeleted)).toMatchObject({ author_mail: "none" });
        const finalOnDeleted = await decideIn(tx, mod, gone.caseId, { kind: "final", actions: [act("remove"), act("remove_media", gone.mediaIds[0]!)] });
        // 3e: the strike it gave counts although the post is deleted: a strike never has a no_effect.
        expect((await actionsOf(tx, finalOnDeleted)).map((a) => [a.kind, a.no_effect])).toEqual([
          ["remove", "deleted"],
          ["remove_media", "deleted"],
          ["strike", null],
        ]);
        expect(await decisionRow(tx, finalOnDeleted)).toMatchObject({ author_mail: "pending", ended_interim: false });
        // The deletion is terminal: the level follows the ledger, the state stays.
        expect(await postRow(tx, gone.postId)).toEqual({ state: "deleted_by_author", level: "removed", erased: false });
      });
    });

    test("an image's own measure: withheld while deciding, removed for good, and 'already' once its state is at least the measure's", async () => {
      await inWorld(async (tx) => {
        const r = await reportedPost(tx, { images: 2 });
        const [one, two] = r.mediaIds as [string, string];
        const states = async () => (await tx.execute<{ state: string }>(sql`select moderation_state as state from post_media where id in (${one}::uuid, ${two}::uuid) order by position`)).map((row) => row.state);
        await decideIn(tx, mod, r.caseId, { kind: "interim", actions: [act("withhold_media", one)] });
        expect(await states()).toEqual(["withheld", "visible"]);
        expect(await postRow(tx, r.postId)).toMatchObject({ state: "visible", level: "visible" });
        const removal = await decideIn(tx, mod, r.caseId, { kind: "final", actions: [act("remove_media", one)] });
        expect((await actionsOf(tx, removal))[0]!.no_effect).toBeNull();
        expect(await states()).toEqual(["removed", "visible"]);
        // A later case's withhold of the removed image changes nothing now.
        const again = await intake(tx, ground.rule((await profile(tx)).id), aPost(r.postId));
        const later = await decideIn(tx, mod, again.items[0]!.caseId!, { kind: "interim", actions: [act("withhold_media", one), act("withhold_media", two)] });
        expect((await actionsOf(tx, later)).map((a) => a.no_effect).sort()).toEqual(["already", null].sort());
        expect(await states()).toEqual(["removed", "withheld"]);
      });
    });
  });

  describe("field resets", () => {
    test("a reset writes its placeholder once, only while the live field still equals the snapshot; lifting it writes nothing", async () => {
      await inWorld(async (tx) => {
        const r = await reportedAccount(tx);
        const live = async () => ({ ...(await tx.execute<{ display_name: string; bio: string }>(sql`select display_name, bio from profiles where id = ${r.account.id}::uuid`))[0]! });
        await tx.execute(sql`update profiles set bio = 'a bio that breaks a rule' where id = ${r.account.id}::uuid`);
        // The case's snapshot was taken before the bio changed: a decision on stale fields is refused.
        expect(await refusal(decideIn(tx, mod, r.caseId, { kind: "interim", ruleId: "R6", actions: [act("reset_bio")] }))).toBe("profile_changed");
        // A fresh report takes a fresh snapshot of the account.
        await intake(tx, ground.rule((await profile(tx)).id, "R6"), anAccount(r.account.id, r.account.handle));
        const reset = await decideIn(tx, mod, r.caseId, { kind: "interim", ruleId: "R6", actions: [act("reset_bio"), act("reset_display_name")] });
        expect(await live()).toEqual({ display_name: r.account.handle, bio: "" });
        expect((await actionsOf(tx, reset)).map((a) => [a.kind, a.no_effect, a.post_id, a.subject_account_id])).toEqual([
          ["reset_bio", null, null, r.account.id],
          ["reset_display_name", null, null, r.account.id],
        ]);

        // The author sets the bio again, which is their own edit; whoever is on duty resets it again, on a fresh snapshot.
        await tx.execute(sql`update profiles set bio = 'the same again' where id = ${r.account.id}::uuid`);
        expect(await refusal(decideIn(tx, admin, r.caseId, { kind: "interim", ruleId: "R6", actions: [act("reset_bio")] }))).toBe("profile_changed");
        await intake(tx, ground.rule((await profile(tx)).id, "R6"), anAccount(r.account.id, r.account.handle));
        const second = await decideIn(tx, admin, r.caseId, { kind: "interim", ruleId: "R6", actions: [act("reset_bio"), act("reset_display_name")] });
        // The display name already holds its placeholder: that reset changes nothing and writes nothing.
        expect((await actionsOf(tx, second)).map((a) => [a.kind, a.no_effect])).toEqual([
          ["reset_bio", null],
          ["reset_display_name", "already"],
        ]);
        expect(await inForce(tx, { caseId: r.caseId })).toEqual(["reset_bio", "reset_bio", "reset_display_name", "reset_display_name"]);

        // A reset is lifted only by a correction of its own decision, and the lift writes nothing back.
        expect(await pgError(tx.transaction((sp) => rawDecision(sp, mod, r.caseId, { kind: "interim", ruleId: "R6", actions: [act("restore_bio")] })))).toEqual({ code: "P0001", message: "invalid_decision" });
        expect(await pgError(tx.transaction((sp) => rawDecision(sp, mod, r.caseId, { kind: "final", outcome: "no_violation", actions: [act("restore_bio")] })))).toEqual({ code: "P0001", message: "invalid_decision" });
        const lifted = await decideIn(tx, mod, r.caseId, { kind: "correction", reviewsDecisionId: reset, outcome: "partly_reversed", actions: [act("restore_bio")] });
        expect((await actionsOf(tx, lifted))[0]).toMatchObject({ kind: "restore_bio", no_effect: null });
        expect(await live()).toEqual({ display_name: r.account.handle, bio: "" });
        expect(await inForce(tx, { caseId: r.caseId })).toEqual(["reset_bio", "reset_display_name", "reset_display_name"]);

        // The closing decision ends what is left of the interim resets, and tells the author so.
        const closing = await decideIn(tx, mod, r.caseId, { kind: "final", outcome: "no_violation" });
        expect(await decisionRow(tx, closing)).toMatchObject({ ended_interim: true, author_mail: "pending" });
        expect(await inForce(tx, { caseId: r.caseId })).toEqual([]);
        expect(await live()).toEqual({ display_name: r.account.handle, bio: "" });
      });
    });

    test("a reset on a deleted account is recorded and writes nothing into the row the purge anonymised", async () => {
      await inWorld(async (tx) => {
        const r = await reportedAccount(tx);
        await tx.execute(sql`update profiles set display_name = 'Deleted account', bio = '', deleted_at = now() where id = ${r.account.id}::uuid`);
        const interim = await decideIn(tx, mod, r.caseId, { kind: "interim", ruleId: "R6", actions: [act("reset_display_name")] });
        expect((await actionsOf(tx, interim))[0]!.no_effect).toBe("deleted");
        expect(await decisionRow(tx, interim)).toMatchObject({ author_mail: "none" });
        const final = await decideIn(tx, mod, r.caseId, { kind: "final", ruleId: "R6", actions: [act("reset_bio"), act("reset_display_name")] });
        expect((await actionsOf(tx, final)).map((a) => a.no_effect)).toEqual(["deleted", "deleted"]);
        const [row] = await tx.execute<{ display_name: string; bio: string }>(sql`select display_name, bio from profiles where id = ${r.account.id}::uuid`);
        expect({ ...row! }).toEqual({ display_name: "Deleted account", bio: "" });
      });
    });
  });

  describe("no final measure restricts a staff account", () => {
    test("an interim withhold and an interim reset apply to staff as to anyone; a final measure is refused until the account is no longer staff", async () => {
      const { user: staffAuthor } = { user: { id: (await newTestStaff(authDb, migrateDb, repo, "moderator")).id } };
      await inWorld(async (tx) => {
        await staffProfile(tx, staffAuthor);
        const r = await reportedPost(tx, { authorId: staffAuthor.id, rule: "R5" });
        expect(await refusal(decideIn(tx, admin, r.caseId, { kind: "interim", ruleId: "R5", actions: [act("withhold")] }))).toBeNull();
        expect(await refusal(decideIn(tx, admin, r.caseId, { kind: "final", ruleId: "R5", actions: [act("remove")] }))).toBe("staff_target");
        const account = await intake(tx, ground.rule((await profile(tx)).id, "R6"), anAccount(staffAuthor.id, "named"));
        const accountCase = account.items[0]!.caseId!;
        await tx.execute(sql`update profiles set bio = 'x' where id = ${staffAuthor.id}::uuid`);
        await intake(tx, ground.rule((await profile(tx)).id, "R6"), anAccount(staffAuthor.id, "named"));
        expect(await refusal(decideIn(tx, admin, accountCase, { kind: "interim", ruleId: "R6", actions: [act("reset_bio")] }))).toBeNull();
        expect(await refusal(decideIn(tx, admin, accountCase, { kind: "final", ruleId: "R6", actions: [act("reset_display_name")] }))).toBe("staff_target");
        // A final decision that restricts nothing stands: the case can be closed.
        expect(await refusal(decideIn(tx, admin, accountCase, { kind: "final", outcome: "no_violation" }))).toBeNull();
      });
      // After grant-role to user (the role's row, on the auth side), the final measure stands.
      await authDb.execute(sql`update auth.users set role = 'user' where id = ${staffAuthor.id}::uuid`);
      await inWorld(async (tx) => {
        await staffProfile(tx, staffAuthor);
        const r = await reportedPost(tx, { authorId: staffAuthor.id, rule: "R5" });
        expect(await refusal(decideIn(tx, admin, r.caseId, { kind: "final", ruleId: "R5", actions: [act("remove")] }))).toBeNull();
      });
    });
  });

  describe("telling the author", () => {
    test("of an interim decision, a final restriction, a correction of either, and every end of something they were told of; of nothing else", async () => {
      await inWorld(async (tx) => {
        // A decision that takes no action, on a case where nothing was done while deciding, is not sent.
        const quiet = await reportedPost(tx);
        expect(await decisionRow(tx, await decideIn(tx, mod, quiet.caseId, { kind: "final", outcome: "no_violation" }))).toMatchObject({ author_mail: "none", ended_interim: false });

        // An interim withhold, then a final decision that leaves the case open and does not end it.
        const r = await reportedPost(tx);
        await alsoReported(tx, r.postId);
        await decideIn(tx, mod, r.caseId, { kind: "interim", actions: [act("withhold")] });
        const open = await decideIn(tx, mod, r.caseId, { kind: "final", outcome: "no_violation", throughSeq: 1 });
        expect(await decisionRow(tx, open)).toMatchObject({ author_mail: "none", ended_interim: false });
        expect(await postRow(tx, r.postId)).toMatchObject({ level: "withheld" });
        // The closing decision ends the interim withhold with no restore: the author is told, also when it finds no breach.
        const closing = await decideIn(tx, mod, r.caseId, { kind: "final", outcome: "no_violation" });
        expect(await decisionRow(tx, closing)).toMatchObject({ author_mail: "pending", ended_interim: true });
        expect(await actionsOf(tx, closing)).toEqual([]);
        expect(await postRow(tx, r.postId)).toMatchObject({ state: "visible", level: "visible" });
        expect(await inForce(tx, { postId: r.postId })).toEqual([]);

        // A correction of a final restriction tells the author, and marks the items it answered for the next release.
        const final = await reportedPost(tx);
        const removal = await decideIn(tx, mod, final.caseId, { kind: "final", actions: [act("remove")] });
        const correction = await decideIn(tx, mod, final.caseId, { kind: "correction", reviewsDecisionId: removal, actions: [act("restore")] });
        expect(await decisionRow(tx, correction)).toMatchObject({ author_mail: "pending", ended_interim: false });
        const [item] = await tx.execute<{ pending: boolean; outcome: string }>(sql`select revision_pending_at = now() as pending, outcome from intake_items where case_id = ${final.caseId}::uuid`);
        expect({ ...item! }).toEqual({ pending: true, outcome: "restricted_rule" });
        // The correction of an interim decision answers no item, so it marks none.
        const [untouched] = await tx.execute<{ pending: string | null }>(sql`select revision_pending_at::text as pending from intake_items where case_id = ${r.caseId}::uuid and seq = 1`);
        expect(untouched!.pending).toBeNull();
      });
    });

    test("something done while deciding of which the author was never told ends without a word", async () => {
      await inWorld(async (tx) => {
        const gone = await reportedPost(tx);
        await tx.execute(sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${gone.postId}::uuid`);
        const interim = await decideIn(tx, mod, gone.caseId, { kind: "interim", actions: [act("withhold")] });
        expect(await decisionRow(tx, interim)).toMatchObject({ author_mail: "none" });
        // Lifted by a correction, and ended by the closing decision, in two runs of the same case shape.
        expect(await decisionRow(tx, await decideIn(tx, mod, gone.caseId, { kind: "correction", reviewsDecisionId: interim, actions: [act("restore")] }))).toMatchObject({ author_mail: "none", ended_interim: false });
        const other = await reportedPost(tx);
        await tx.execute(sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${other.postId}::uuid`);
        await decideIn(tx, mod, other.caseId, { kind: "interim", actions: [act("withhold")] });
        expect(await decisionRow(tx, await decideIn(tx, mod, other.caseId, { kind: "final", outcome: "no_violation" }))).toMatchObject({ author_mail: "none", ended_interim: false });
      });
    });
  });

  describe("the audit link, at commit", () => {
    /** The audit row the module writes for a decision, which a test then changes. */
    const auditOf = (staff: TestStaff, caseId: string, id: string, params: CaseDecidedParams) => {
      const { session, confirmed } = madeUpConfirmation(staff, caseId, params);
      return {
        actorId: staff.id,
        keyId: staff.keyId,
        action: "case_decided" as const,
        targetType: "case",
        targetId: caseId,
        metadata: { params, decisionId: id } as Record<string, unknown>,
        staffSession: session.handle,
        actionHash: confirmed.actionHash,
        stepUp: confirmed.assertion,
        requestId: "req-test",
        expiresAt: confirmed.expiresAt,
      };
    };
    type Audit = ReturnType<typeof auditOf>;
    /** A decision with its measures and an audit row the test shaped, checked as at commit: the refusal's detail, or null. */
    async function committing(tx: DbTx, r: { caseId: string }, shape: (audit: Audit, params: CaseDecidedParams) => Audit | null, input: DecisionInput = { kind: "interim", actions: [act("withhold")] }, insertOrder: "params" | "reversed" = "params") {
      return refusalDetail(
        tx.transaction(async (sp) => {
          const params = await decisionParams(sp, mod, r.caseId, input);
          const id = randomUUID();
          await insertDecision(sp, { id, caseId: r.caseId, decidedBy: mod.id, params });
          for (const action of insertOrder === "params" ? params.actions : [...params.actions].reverse()) await insertAction(sp, id, action);
          const audit = shape(auditOf(mod, r.caseId, id, params), params);
          if (audit) await appendConfirmedAudit(sp, audit);
          await sp.execute(sql`set constraints public.decisions_check, public.decision_actions_recheck immediate`);
          await sp.execute(sql`set constraints public.decisions_check, public.decision_actions_recheck deferred`);
        }),
      );
    }

    test("a decision commits only with an audit row that names it, by its decider, on its case", async () => {
      await inWorld(async (tx) => {
        const r = await reportedPost(tx, { images: 2 });
        const other = await reportedPost(tx);
        expect(await committing(tx, r, () => null)).toMatch(/^decisionId: /);
        expect(await committing(tx, r, (audit) => ({ ...audit, metadata: { ...audit.metadata, decisionId: randomUUID() } }))).toMatch(/^decisionId: /);
        expect(await committing(tx, r, (audit) => ({ ...audit, metadata: { params: audit.metadata.params } }))).toMatch(/^decisionId: /);
        expect(await committing(tx, r, (audit) => ({ ...audit, actorId: admin.id, keyId: admin.keyId }))).toMatch(/^actor: /);
        expect(await committing(tx, r, (audit) => ({ ...audit, targetId: other.caseId }))).toMatch(/^target: /);
        expect(await committing(tx, r, (audit) => ({ ...audit, targetType: "decision" }))).toMatch(/^target: /);
        expect(await committing(tx, r, (audit) => ({ ...audit, action: "appeals_reviewed" as never }))).toMatch(/^target: /);
        expect(await committing(tx, r, (audit) => ({ ...audit, metadata: { decisionId: audit.metadata.decisionId } }))).toMatch(/^params: /);
        // The row the module writes links the decision.
        expect(await committing(tx, r, (audit) => audit)).toBeNull();
      });
    });

    test("a row without a step-up, which only a direct insert can write, links nothing", async () => {
      await inWorld(async (tx) => {
        const r = await reportedPost(tx);
        const detail = await refusalDetail(
          tx.transaction(async (sp) => {
            const { id, params } = await rawDecision(sp, mod, r.caseId, { kind: "interim", actions: [act("withhold")] });
            await sp.execute(sql`insert into audit_log (actor_id, action, target_type, target_id, metadata) values (${mod.id}::uuid, 'case_decided', 'case', ${r.caseId}, ${JSON.stringify({ params, decisionId: id })}::text::jsonb)`);
            await sp.execute(sql`set constraints public.decisions_check, public.decision_actions_recheck immediate`);
          }),
        );
        expect(detail).toMatch(/^stepUp: /);
      });
    });

    test("every member of the confirmed params equals the decision's column, and the refusal names the member that differs", async () => {
      await inWorld(async (tx) => {
        const r = await reportedPost(tx, { by: "illegal", images: 1 });
        const input: DecisionInput = { kind: "final", outcome: "restricted", ground: "illegal", categoryKeyword: "KEYWORD_TERRORIST_CONTENT", actions: [act("remove")] };
        const changed: Record<string, unknown> = {
          kind: "interim",
          stateVersion: 7,
          throughSeq: 9,
          reviewsDecisionId: randomUUID(),
          snapshotId: randomUUID(),
          snapshotDigest: hex64(),
          outcome: "no_violation",
          ground: "incompatible",
          ruleId: "R3",
          rulesVersion: 1,
          // A version other than the one the decision was made under (3e raised the current one to 2).
          redressVersion: 1,
          category: TC,
          categoryKeyword: null,
          factsDigest: hex64(),
          reasonDigest: null,
          legalReferenceDigest: hex64(),
        };
        for (const [member, value] of Object.entries(changed)) {
          const detail = await committing(tx, r, (audit, params) => ({ ...audit, metadata: { ...audit.metadata, params: { ...params, [member]: value } } }), input);
          expect(detail, member).toBe(`params: ${member} differ from the decision.`);
        }
        // A member the decision does not have, and a member left out.
        expect(await committing(tx, r, (audit, params) => ({ ...audit, metadata: { ...audit.metadata, params: { ...params, note: "x" } } }), input)).toBe("params: note differ from the decision.");
        expect(await committing(tx, r, (audit, params) => ({ ...audit, metadata: { ...audit.metadata, params: { ...params, ruleId: undefined } } }), input)).toBe("params: ruleId differ from the decision.");
        expect(await committing(tx, r, (audit) => audit, input)).toBeNull();
      });
    });

    test("the confirmed actions are the decision's ledger rows as a set: one more, one fewer or another image is refused, another order of insertion is not", async () => {
      await inWorld(async (tx) => {
        const r = await reportedPost(tx, { images: 2 });
        const [one, two] = r.mediaIds as [string, string];
        const input: DecisionInput = { kind: "interim", actions: [act("withhold"), act("withhold_media", one), act("withhold_media", two)] };
        const withActions = (actions: (params: CaseDecidedParams) => unknown) => committing(tx, r, (audit, params) => ({ ...audit, metadata: { ...audit.metadata, params: { ...params, actions: actions(params) } } }), input);
        expect(await withActions((p) => p.actions.slice(1))).toMatch(/^actions: /);
        expect(await withActions((p) => [...p.actions, act("withhold_media", randomUUID())])).toMatch(/^actions: /);
        expect(await withActions((p) => p.actions.map((a) => (a.mediaId === one ? act("withhold_media", randomUUID()) : a)))).toMatch(/^actions: /);
        expect(await withActions((p) => [p.actions[0], p.actions[0], p.actions[1]])).toMatch(/^actions: /);
        expect(await withActions(() => "all")).toMatch(/^actions: /);
        expect(await committing(tx, r, (audit, params) => ({ ...audit, metadata: { decisionId: audit.metadata.decisionId, params: { ...params, actions: undefined } } }), input)).toMatch(/^actions: /);
        // The ledger rows inserted in another order than the params list them.
        expect(await committing(tx, r, (audit) => audit, input, "reversed")).toBeNull();
      });
    });

    test("a second audit row after the decision's own unlinks it: the decision's row is the last statement that writes", async () => {
      await inWorld(async (tx) => {
        const r = await reportedPost(tx);
        const other = await reportedPost(tx);
        const detail = await refusalDetail(
          tx.transaction(async (sp) => {
            const first = await rawDecision(sp, mod, r.caseId, { kind: "interim", actions: [act("withhold")] });
            await appendConfirmedAudit(sp, auditOf(mod, r.caseId, first.id, first.params));
            const second = await rawDecision(sp, mod, other.caseId, { kind: "interim", actions: [act("withhold")] });
            await appendConfirmedAudit(sp, auditOf(mod, other.caseId, second.id, second.params));
            await sp.execute(sql`set constraints public.decisions_check, public.decision_actions_recheck immediate`);
          }),
        );
        expect(detail).toMatch(/^decisionId: /);
      });
    });
  });

  describe("a measure joins the ledger only with its own decision", () => {
    test("an action for a decision of another transaction, or of this transaction's id at another time, is refused; one added in the decision's own transaction queues the decision's check again", async () => {
      // As the migrator, which may change a stored decision: the API role cannot.
      await inWorld(async (tx) => {
        const r = await reportedPost(tx, { images: 2 });
        const id = await decideIn(tx, mod, r.caseId, { kind: "interim", actions: [act("withhold")] });
        const add = (decisionId: string, mediaId: string) =>
          refusalDetail(tx.transaction((sp) => sp.execute(sql`insert into decision_actions (decision_id, kind, media_id) values (${decisionId}::uuid, 'withhold_media', ${mediaId}::uuid)`)));
        const otherTransaction = "A measure or a reversal is added only in the transaction of its own decision.";
        // In the decision's own transaction a further measure passes this step, and queues the decision's check again: the
        // audit row's params do not list it, so its transaction cannot commit with it.
        const queued = refusalDetail(
          tx.transaction(async (sp) => {
            await sp.execute(sql`insert into decision_actions (decision_id, kind, media_id) values (${id}::uuid, 'withhold_media', ${r.mediaIds[0]!}::uuid)`);
            await sp.execute(sql`set constraints public.decisions_check, public.decision_actions_recheck immediate`);
          }),
        );
        expect(await queued).toBe("actions: the decision's measures and reversals are not those the audit row's params list.");
        // Another transaction's id, as a decision that committed earlier holds.
        await tx.execute(sql`update decisions set xact = '1'::xid8 where id = ${id}::uuid`);
        expect(await add(id, r.mediaIds[1]!)).toBe(otherTransaction);
        // The same id with another time: what a logical restore leaves once the counter comes round again.
        await tx.execute(sql`update decisions set xact = pg_current_xact_id(), decided_at = decided_at - interval '1 second' where id = ${id}::uuid`);
        expect(await add(id, r.mediaIds[1]!)).toBe(otherTransaction);
        expect(await add(randomUUID(), r.mediaIds[1]!)).toBe(otherTransaction);
      }, migrateDb);
    });
  });

  test("this file left no row behind: the tables it writes hold what they held before it", async () => {
    expect(await rowCounts(apiDb)).toEqual(before);
  });
});
