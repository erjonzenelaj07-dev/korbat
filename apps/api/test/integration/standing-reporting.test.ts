import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { STANDING_RULES } from "@korbat/contracts";
import { STATEMENT_WORDS, statementParagraphs } from "@korbat/rules";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { createAuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { ModerationError } from "../../src/moderation/context";
import { authorCases, authorDecisionView } from "../../src/moderation/author";
import { itemStatus, recordIntake, recordReexamination, reexamineOwnItem } from "../../src/moderation/intake";
import { caseItems, noticeItems, reporterItem } from "../../src/moderation/repo";
import { reporterList } from "../../src/moderation/reports";
import { caseStanding } from "../../src/moderation/standing";
import { exportFor } from "../../src/moderation/export";
import { decisionStatement, mailTemplateOf } from "../../src/moderation/statement";
import { closeDecisions, deciderWorld, type DeciderWorld, type RealStaff } from "./moderation-decide";
import {
  aPost,
  act,
  actionsOf,
  ageStandingForTest,
  anAccount,
  appealOf,
  decideIn,
  ground,
  intake,
  moderationDeps,
  newPostRow,
  newTestStaff,
  refusal,
  refusalDetail,
  releaseForTest,
  removeFixtures,
  rowCounts,
  staffProfile,
  timed,
  type DecisionInput,
  type TestStaff,
} from "./moderation-fixtures";
import { newProfile } from "./social-fixtures";
import { rolledBack } from "./staff-fixtures";

// The flow commits decisions confirmed with a real key, each a round of the step-up flow: slow on a loaded machine.
vi.setConfig({ testTimeout: 240_000 });

/**
 * The restriction of reporting (3e design, sections 6.3 and 7.9; section 12.1, invariants 16, 17 and 20 for the reporting
 * measures). The first part runs at the database's level, as korbat_api (or as the migrator where a release must be
 * written) inside transactions that are rolled back, deciding through the module's own decide (decideIn): the check of
 * every mark, its recheck at commit, the counts by report on both sides, the thresholds and the withdrawal of marks. The
 * second part is the flow through the routes' code, each decision confirmed with a staff key on the software
 * authenticator: from five marked reports to a warning, a restriction, a withdrawn mark and a lifted warning that ends its
 * restriction, read as staff, the person and a reporter read it. What the file commits is removed in the end, and its
 * last test holds it to that.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the restriction of reporting", () => {
  let apiDb: Db;
  let world: DeciderWorld;
  let mod: TestStaff;
  let admin: TestStaff;
  let decider: RealStaff;
  let finder: RealStaff;
  let reviewer: RealStaff;
  let before: Record<string, number>;
  /** The profiles the committed flow made, removed with everything they hold at the end. */
  const made: string[] = [];

  beforeAll(async () => {
    apiDb = createDb(loadConfig().DATABASE_URL_API, { max: 4 });
    world = deciderWorld(apiDb);
    const repo = createAuthRepo(world.authDb);
    mod = await newTestStaff(world.authDb, world.migrateDb, repo, "moderator");
    admin = await newTestStaff(world.authDb, world.migrateDb, repo, "admin");
    decider = await world.staff("moderator");
    finder = await world.staff("admin");
    reviewer = await world.staff("moderator");
    // Read once the staff profiles exist: the world removes them when it closes, after the last test.
    before = await rowCounts(apiDb);
  }, 240_000);
  afterAll(async () => {
    try {
      await closeDecisions();
      await removeFixtures(world.migrateDb, made.splice(0));
      await world.close();
    } finally {
      await closeDb(apiDb);
    }
  }, 240_000);

  // ---------------------------------------------------------------- helpers

  /** One test's world at the database's level: a transaction that is rolled back, with both staff members' profiles in it. */
  const inWorld = (fn: (tx: DbTx) => Promise<void>, db: Db = apiDb) =>
    rolledBack(db, async (tx) => {
      await staffProfile(tx, mod);
      await staffProfile(tx, admin);
      await fn(tx);
    });
  const profile = (db: Db | DbTx) => newProfile(db as Db);
  /** A signed-in person's report under R1 of these posts, one item a post: the report, its items and their cases. */
  async function reportOf(db: Db | DbTx, reporterId: string, postIds: readonly string[]) {
    const recorded = await intake(db, ground.rule(reporterId, "R1"), postIds.map((id, i) => aPost(id, i + 1)));
    return { intakeId: recorded.intakeId, items: recorded.items.map((item) => ({ id: item.id, caseId: item.caseId! })) };
  }
  /** A report of one new post of the author: its item and case. */
  async function reportedPost(db: Db | DbTx, reporterId: string, authorId: string) {
    const postId = await newPostRow(db, authorId);
    const { items } = await reportOf(db, reporterId, [postId]);
    return { postId, ...items[0]! };
  }
  /** A final decision that finds no breach and marks these items "manifestly unfounded". */
  const noBreach = (tx: DbTx, caseId: string, unfounded: readonly string[], staff: TestStaff = mod) => decideIn(tx, staff, caseId, { kind: "final", outcome: "no_violation", unfounded });
  /** The account's case, opened by a finding under R6 (or a user's report of it): the case. */
  async function accountCase(db: Db | DbTx, accountId: string, by: { finding: string } | { reporter: string }) {
    const g = "finding" in by ? ground.finding(by.finding, "R6") : ground.rule(by.reporter, "R6");
    return (await intake(db, g, anAccount(accountId, "named"))).items[0]!.caseId!;
  }
  /** What reporting_record says of the account: its rule reports in the frame and its marked reports among them. */
  const record = async (db: Db | DbTx, accountId: string) =>
    (await db.execute<{ reports: number; unfounded: number }>(sql`select reports, unfounded from reporting_record where account_id = ${accountId}::uuid`))[0] ?? { reports: 0, unfounded: 0 };
  /** A refusal's code and the detail the database gave, or null when it went through. */
  async function refused(promise: Promise<unknown>): Promise<{ code: string; detail: string | null } | null> {
    try {
      await promise;
      return null;
    } catch (err) {
      return { code: err instanceof ModerationError ? err.code : String((await refusal(Promise.reject(err))) ?? err), detail: (err as { detail?: string | null }).detail ?? (await refusalDetail(Promise.reject(err))) };
    }
  }
  /** A mark written as the API would write it, in a savepoint: the refusal's code and detail, or null. */
  const rawMark = (tx: DbTx, itemId: string, decisionId: string) => refused(tx.transaction((sp) => sp.execute(sql`insert into unfounded_marks (item_id, decision_id) values (${itemId}::uuid, ${decisionId}::uuid)`)));

  // ---------------------------------------------------------------- invariant 16 at the database's level

  describe("invariant 16: a mark is a person's, signed, and only on a signed-in rule report", () => {
    test("the check refuses a mark on a notice of illegality, a finding, a signed-out notice, a report of child sexual abuse material and an item the decision did not answer; it forces the reporter, the report and the times", async () => {
      await inWorld(async (tx) => {
        const [author, reporter, other] = [await profile(tx), await profile(tx), await profile(tx)];
        const postId = await newPostRow(tx, author.id);
        const rule = (await intake(tx, ground.rule(reporter.id, "R1"), aPost(postId))).items[0]!;
        const illegal = (await intake(tx, ground.illegal(other.id), aPost(postId))).items[0]!;
        const finding = (await intake(tx, ground.finding(mod.id, "R1"), aPost(postId))).items[0]!;
        const signedOut = (await intake(tx, { ...ground.rule(reporter.id, "R1"), channel: "signed_out", reporterId: null }, aPost(postId))).items[0]!;
        const caseId = rule.caseId!;
        // The case answer says which items may be marked: a signed-in person's report under a rule, and nothing else.
        const listed = new Map((await caseItems(tx, caseId, mod.id)).map((item) => [item.id, item]));
        expect([rule, illegal, finding, signedOut].map((item) => listed.get(item.id)!.markable)).toEqual([true, false, false, false]);
        const elsewhere = await reportedPost(tx, reporter.id, author.id);

        const notMarkable = /signed-in person's report under a rule/;
        for (const item of [illegal, finding, signedOut]) {
          const answer = await refused(noBreach(tx, caseId, [item.id]));
          expect(answer?.code, item.id).toBe("invalid_decision");
          expect(answer?.detail, item.id).toMatch(notMarkable);
        }
        expect((await refused(noBreach(tx, caseId, [elsewhere.id])))?.detail).toMatch(/not one this decision answered/);

        // The path for child sexual abuse material stores no sender: its item is never marked, also by an admin.
        const csamPost = await newPostRow(tx, author.id);
        const csam = (await intake(tx, ground.csam(), aPost(csamPost))).items[0]!;
        expect((await refused(noBreach(tx, csam.caseId!, [csam.id], admin)))?.detail).toMatch(notMarkable);

        // The mark the check takes: the reporter, the report and the time it was received are the database's.
        const decision = await noBreach(tx, caseId, [rule.id]);
        const [mark] = await tx.execute<Record<string, unknown>>(
          sql`select m.decision_id, m.account_id, m.intake_id = i.intake_id as same_report, m.reported_at = n.received_at as sent_then, m.marked_at = now() as marked_now, m.withdrawn_by, m.withdrawn_at
                from unfounded_marks m join intake_items i on i.id = m.item_id join intakes n on n.id = i.intake_id where m.item_id = ${rule.id}::uuid`,
        );
        expect(mark).toEqual({ decision_id: decision, account_id: reporter.id, same_report: true, sent_then: true, marked_now: true, withdrawn_by: null, withdrawn_at: null });
        const after = new Map((await caseItems(tx, caseId, mod.id)).map((item) => [item.id, item]));
        expect(after.get(rule.id)).toMatchObject({ markable: true, unfounded: true, markWithdrawn: false });
        expect(after.get(illegal.id)).toMatchObject({ unfounded: false, markWithdrawn: false });
      });
    });

    test("only a final decision that found no breach marks: a restriction and a decision taken while deciding are refused, whatever their transaction", async () => {
      await inWorld(async (tx) => {
        const [author, reporter] = [await profile(tx), await profile(tx)];
        const first = await reportedPost(tx, reporter.id, author.id);
        const interim = await decideIn(tx, mod, first.caseId, { kind: "interim", actions: [act("withhold")] });
        expect((await rawMark(tx, first.id, interim))?.detail).toMatch(/only a final decision that found no breach/);
        const removal = await decideIn(tx, mod, first.caseId, { kind: "final", actions: [act("remove")] });
        expect((await rawMark(tx, first.id, removal))?.code).toBe("invalid_decision");
        expect((await rawMark(tx, first.id, removal))?.detail).toMatch(/only a final decision that found no breach/);
        // The params' schema refuses marks on any other decision before the database sees them.
        const other = await reportedPost(tx, reporter.id, author.id);
        await expect(decideIn(tx, mod, other.caseId, { kind: "final", actions: [act("remove")], unfounded: [other.id] })).rejects.toThrow(/unfounded/);
      });
    });

    test("the signed list is what the database holds at commit, also when a mark is added after the check was made to run early (unfounded_marks_recheck)", async () => {
      await inWorld(async (tx) => {
        const [author, first, second] = [await profile(tx), await profile(tx), await profile(tx)];
        const postId = await newPostRow(tx, author.id);
        const one = (await intake(tx, ground.rule(first.id), aPost(postId))).items[0]!;
        const two = (await intake(tx, ground.rule(second.id), aPost(postId))).items[0]!;
        // decideIn ran the decision's check at once, inside its savepoint: the signed list held one mark.
        const decision = await noBreach(tx, one.caseId!, [one.id]);
        const late = await refused(
          tx.transaction(async (sp) => {
            await sp.execute(sql`insert into unfounded_marks (item_id, decision_id) values (${two.id}::uuid, ${decision}::uuid)`);
            await sp.execute(sql`set constraints all immediate`);
          }),
        );
        expect(late).toEqual({ code: "invalid_decision", detail: expect.stringMatching(/^unfounded:/) });
        expect((await tx.execute(sql`select 1 from unfounded_marks where decision_id = ${decision}::uuid`)).length).toBe(1);
      });
    });

    test("a kept correction withdraws all of a decision's marks together and mails nobody; one of a decision with no mark left is refused; a withdrawn mark counts no more", async () => {
      // The migrator releases the outcomes, as the daily release would: a mark counts only once its item's is released.
      await inWorld(async (tx) => {
        const author = await profile(tx);
        const reporters = [await profile(tx), await profile(tx), await profile(tx)];
        const postId = await newPostRow(tx, author.id);
        const items = [];
        for (const reporter of reporters) items.push((await intake(tx, ground.rule(reporter.id), aPost(postId))).items[0]!);
        const caseId = items[0]!.caseId!;
        const decision = await noBreach(tx, caseId, items.map((item) => item.id).sort());
        await releaseForTest(tx, items.map((item) => item.id));
        for (const reporter of reporters) expect(await record(tx, reporter.id)).toEqual({ reports: 1, unfounded: 1 });
        const correction = await decideIn(tx, mod, caseId, { kind: "correction", reviewsDecisionId: decision, outcome: "kept", actions: [] });
        const marks = await tx.execute<{ withdrawn_by: string; withdrawn: boolean }>(sql`select withdrawn_by, withdrawn_at = now() as withdrawn from unfounded_marks where decision_id = ${decision}::uuid`);
        expect([...marks]).toEqual(items.map(() => ({ withdrawn_by: correction, withdrawn: true })));
        for (const reporter of reporters) expect(await record(tx, reporter.id)).toEqual({ reports: 1, unfounded: 0 });
        // It concerns the people who reported, not the author: no statement goes for it.
        expect((await tx.execute<{ author_mail: string }>(sql`select author_mail::text from decisions where id = ${correction}::uuid`))[0]!.author_mail).toBe("none");
        expect((await caseItems(tx, caseId, mod.id)).map((item) => [item.unfounded, item.markWithdrawn])).toEqual(items.map(() => [false, true]));
        // Nothing is left to withdraw, and a decision that set no mark has none either.
        expect((await refused(decideIn(tx, mod, caseId, { kind: "correction", reviewsDecisionId: decision, outcome: "kept", actions: [] })))?.code).toBe("invalid_decision");
        const plain = await reportedPost(tx, reporters[0]!.id, author.id);
        const unmarked = await noBreach(tx, plain.caseId, []);
        expect((await refused(decideIn(tx, mod, plain.caseId, { kind: "correction", reviewsDecisionId: unmarked, outcome: "kept", actions: [] })))?.detail).toMatch(/no mark left/);
      }, world.migrateDb);
    });

    test("a mark stops counting when a re-examination of its item ends in a restriction: a derivation, nothing is written", async () => {
      // The release is the dispatch job's to write: the migrator writes it here, in a transaction that is rolled back.
      await inWorld(async (tx) => {
        const [author, reporter] = [await profile(tx), await profile(tx)];
        const marked = await reportedPost(tx, reporter.id, author.id);
        await noBreach(tx, marked.caseId, [marked.id]);
        await releaseForTest(tx, [marked.id]);
        expect(await record(tx, reporter.id)).toEqual({ reports: 1, unfounded: 1 });
        const asked = (await reporterItem(tx, reporter.id, marked.id))!;
        const [again] = await recordReexamination(moderationDeps(tx), asked, null);
        await decideIn(tx, mod, again!.caseId!, { kind: "final", actions: [act("remove")] });
        expect(await record(tx, reporter.id)).toEqual({ reports: 1, unfounded: 0 });
        const [mark] = await tx.execute<{ withdrawn_by: string | null }>(sql`select withdrawn_by from unfounded_marks where item_id = ${marked.id}::uuid`);
        expect(mark).toEqual({ withdrawn_by: null });
      }, world.migrateDb);
    });
  });

  // ---------------------------------------------------------------- invariant 17 at the database's level

  describe("invariant 17: the counts count reports, and the measures read them", () => {
    test("one report naming ten posts, all ten marked, is one marked report of one sent: it never reaches the warning alone", async () => {
      await inWorld(async (tx) => {
        const [author, reporter] = [await profile(tx), await profile(tx)];
        const posts = [];
        for (let i = 0; i < 10; i++) posts.push(await newPostRow(tx, author.id));
        const { items } = await reportOf(tx, reporter.id, posts);
        expect(new Set(items.map((item) => item.caseId)).size).toBe(10);
        for (const item of items) await noBreach(tx, item.caseId, [item.id]);
        await releaseForTest(tx, items.map((item) => item.id));
        expect(await record(tx, reporter.id)).toEqual({ reports: 1, unfounded: 1 });
        const caseId = await accountCase(tx, reporter.id, { finding: mod.id });
        expect((await caseStanding(tx, caseId, reporter.id)).reporting).toMatchObject({ reports: 1, unfounded: 1, mayWarn: false, marked: items.map(() => expect.objectContaining({ sinceWarning: false })) });
        expect((await refused(decideIn(tx, mod, caseId, { kind: "final", ruleId: "R6", actions: [act("warn_reporting")] })))?.detail).toMatch(/below the threshold/);
      }, world.migrateDb);
    });

    test("a warning is refused below either threshold, and a restriction without a warning that still counts", async () => {
      await inWorld(async (tx) => {
        const [author, reporter] = [await profile(tx), await profile(tx)];
        const sent = [];
        for (let i = 0; i < STANDING_RULES.reportWarnMarks - 1; i++) sent.push(await reportedPost(tx, reporter.id, author.id));
        for (const report of sent) await noBreach(tx, report.caseId, [report.id]);
        await releaseForTest(tx, sent.map((report) => report.id));
        const warn = async () => refused(decideIn(tx, mod, await accountCase(tx, reporter.id, { finding: mod.id }), { kind: "final", ruleId: "R6", actions: [act("warn_reporting")] }));
        expect((await warn())?.detail).toMatch(/below the threshold/);
        // Five marked, but of eleven sent: under half.
        for (let i = 0; i < 7; i++) sent.push(await reportedPost(tx, reporter.id, author.id));
        await noBreach(tx, sent[STANDING_RULES.reportWarnMarks - 1]!.caseId, [sent[STANDING_RULES.reportWarnMarks - 1]!.id]);
        await releaseForTest(tx, [sent[STANDING_RULES.reportWarnMarks - 1]!.id]);
        expect(await record(tx, reporter.id)).toEqual({ reports: 11, unfounded: 5 });
        const caseId = await accountCase(tx, reporter.id, { finding: mod.id });
        expect((await caseStanding(tx, caseId, reporter.id)).reporting).toMatchObject({ reports: 11, unfounded: 5, warnedOn: null, marksSince: null, mayWarn: false, mayRestrict: false });
        expect((await warn())?.detail).toMatch(/below the threshold/);
        expect((await refused(decideIn(tx, mod, caseId, { kind: "final", ruleId: "R6", actions: [timed("restrict_reporting", 7, false)] })))?.detail).toMatch(/no warning that still counts/);
      }, world.migrateDb);
    });

    test("a warning answers findings only, counts once, and when lifted because its marks were withdrawn cannot be given again on them", async () => {
      await inWorld(async (tx) => {
        const [author, reporter, other] = [await profile(tx), await profile(tx), await profile(tx)];
        const decisions: string[] = [];
        for (let i = 0; i < STANDING_RULES.reportWarnMarks; i++) {
          const report = await reportedPost(tx, reporter.id, author.id);
          decisions.push(await noBreach(tx, report.caseId, [report.id]));
          await releaseForTest(tx, [report.id]);
        }
        expect(await record(tx, reporter.id)).toEqual({ reports: 5, unfounded: 5 });
        // A case that holds someone's report about the account is decided first: the warning gets a case of its own.
        const reported = await accountCase(tx, reporter.id, { reporter: other.id });
        await accountCase(tx, reporter.id, { finding: mod.id });
        expect((await caseStanding(tx, reported, reporter.id)).reporting.mayWarn).toBe(true);
        expect(await refused(decideIn(tx, mod, reported, { kind: "final", ruleId: "R6", actions: [act("warn_reporting")] }))).toEqual({ code: "invalid_decision", detail: "open_reports" });
        await decideIn(tx, mod, reported, { kind: "final", outcome: "no_violation" });
        const warningCase = await accountCase(tx, reporter.id, { finding: mod.id });
        const warning = await decideIn(tx, mod, warningCase, { kind: "final", ruleId: "R6", actions: [act("warn_reporting")] });
        const [row] = await tx.execute<{ basis: string; frame: boolean; rests_on: string[] | null; needs_admin: boolean }>(
          sql`select a.basis, a.ends_at = now() + make_interval(days => ${STANDING_RULES.reportFrameDays}::int) as frame, a.rests_on::text[] as rests_on, d.needs_admin
                from decision_actions a join decisions d on d.id = a.decision_id where a.decision_id = ${warning}::uuid and a.kind = 'warn_reporting'`,
        );
        expect(row).toEqual({ basis: "reports", frame: true, rests_on: null, needs_admin: false });
        // It restricts nothing: no profile column moves.
        expect((await tx.execute<{ until: string | null }>(sql`select reports_restricted_until::text as until from profiles where id = ${reporter.id}::uuid`))[0]!.until).toBeNull();
        expect((await refused(decideIn(tx, mod, await accountCase(tx, reporter.id, { finding: mod.id }), { kind: "final", ruleId: "R6", actions: [act("warn_reporting")] })))?.detail).toMatch(/still counts/);
        // Lifted by a correction, and one decision's marks withdrawn: the same warning is not given again on them.
        await decideIn(tx, admin, warningCase, { kind: "correction", reviewsDecisionId: warning, outcome: "reversed", actions: [act("lift_reporting")] });
        const [firstCase] = await tx.execute<{ case_id: string }>(sql`select case_id from decisions where id = ${decisions[0]!}::uuid`);
        await decideIn(tx, mod, firstCase!.case_id, { kind: "correction", reviewsDecisionId: decisions[0]!, outcome: "kept", actions: [] });
        expect(await record(tx, reporter.id)).toEqual({ reports: 5, unfounded: 4 });
        expect((await refused(decideIn(tx, mod, await accountCase(tx, reporter.id, { finding: mod.id }), { kind: "final", ruleId: "R6", actions: [act("warn_reporting")] })))?.detail).toMatch(/below the threshold/);
      }, world.migrateDb);
    });

    test("a mark counts, lists and is exported only once its item's outcome is released: before the daily release the warning is refused and its draft lists none of it; after it the warning is taken", async () => {
      // 3e's review (access1, access2): before the release the person can neither read the mark nor ask for a
      // re-examination of it, so no measure rests on it and the export tells nothing of it.
      await inWorld(async (tx) => {
        const [author, reporter] = [await profile(tx), await profile(tx)];
        const sent = [];
        for (let i = 0; i < STANDING_RULES.reportWarnMarks; i++) {
          const report = await reportedPost(tx, reporter.id, author.id);
          await noBreach(tx, report.caseId, [report.id]);
          sent.push(report);
        }
        await releaseForTest(tx, sent.slice(0, -1).map((report) => report.id));
        const last = sent.at(-1)!;
        const lastRef = (await tx.execute<{ ref: string }>(sql`select n.ref from intakes n join intake_items i on i.intake_id = n.id where i.id = ${last.id}::uuid`))[0]!.ref;
        const caseId = await accountCase(tx, reporter.id, { finding: mod.id });
        const warn = () => refused(decideIn(tx, mod, caseId, { kind: "final", ruleId: "R6", actions: [act("warn_reporting")] }));

        expect(await record(tx, reporter.id)).toEqual({ reports: STANDING_RULES.reportWarnMarks, unfounded: STANDING_RULES.reportWarnMarks - 1 });
        const early = (await caseStanding(tx, caseId, reporter.id)).reporting;
        expect(early).toMatchObject({ unfounded: STANDING_RULES.reportWarnMarks - 1, mayWarn: false });
        expect(early.marked).toHaveLength(STANDING_RULES.reportWarnMarks - 1);
        expect(early.marked.map((mark) => mark.ref)).not.toContain(lastRef);
        const exported = (await exportFor(moderationDeps(tx), reporter.id)).reporting;
        expect(exported.markedReports).toBe(STANDING_RULES.reportWarnMarks - 1);
        expect(exported.marks.map((mark) => mark.ref)).not.toContain(lastRef);
        expect((await warn())?.detail).toMatch(/below the threshold/);

        await releaseForTest(tx, [last.id]);
        expect(await record(tx, reporter.id)).toEqual({ reports: STANDING_RULES.reportWarnMarks, unfounded: STANDING_RULES.reportWarnMarks });
        const ready = (await caseStanding(tx, caseId, reporter.id)).reporting;
        expect(ready).toMatchObject({ mayWarn: true });
        expect(ready.marked.map((mark) => mark.ref)).toContain(lastRef);
        expect((await exportFor(moderationDeps(tx), reporter.id)).reporting.marks.map((mark) => mark.ref)).toContain(lastRef);
        expect(await warn()).toBeNull();
      }, world.migrateDb);
    });

    test("the upgrade's back-fill (migration 0025) counts the rule reports received before the tallies' trigger existed: twelve sent, five marked, and the warning is refused", async () => {
      // 3e's review (database4). The statement is the migration's own, read from its file and run as the migrator would run
      // it, over a state as an upgrade meets it: reports received, and no tally of them, as before 0022.
      const folder = path.resolve(import.meta.dirname, "../../../../packages/db/migrations");
      const backfill = readdirSync(folder)
        .filter((name) => name.endsWith(".sql"))
        .flatMap((name) => readFileSync(path.join(folder, name), "utf8").split("--> statement-breakpoint"))
        .map((statement) => statement.split(String.fromCharCode(10)).filter((line) => !line.startsWith("--")).join(String.fromCharCode(10)).trim())
        .filter((statement) => statement.startsWith('INSERT INTO "public"."report_tallies"'));
      expect(backfill).toHaveLength(1);
      await inWorld(async (tx) => {
        const [author, reporter, other] = [await profile(tx), await profile(tx), await profile(tx)];
        const sent = [];
        for (let i = 0; i < 12; i++) sent.push(await reportedPost(tx, reporter.id, author.id));
        await reportedPost(tx, other.id, author.id);
        await tx.execute(sql`delete from report_tallies where account_id = ${reporter.id}::uuid`);
        expect(await record(tx, reporter.id)).toEqual({ reports: 0, unfounded: 0 });

        await tx.execute(sql.raw(backfill[0]!));
        expect(await record(tx, reporter.id)).toEqual({ reports: 12, unfounded: 0 });
        // Run again, or over tallies the trigger already wrote, it counts nothing twice.
        await tx.execute(sql.raw(backfill[0]!));
        expect(await record(tx, reporter.id)).toEqual({ reports: 12, unfounded: 0 });
        expect(await record(tx, other.id)).toEqual({ reports: 1, unfounded: 0 });

        for (const report of sent.slice(0, STANDING_RULES.reportWarnMarks)) await noBreach(tx, report.caseId, [report.id]);
        await releaseForTest(tx, sent.slice(0, STANDING_RULES.reportWarnMarks).map((report) => report.id));
        expect(await record(tx, reporter.id)).toEqual({ reports: 12, unfounded: STANDING_RULES.reportWarnMarks });
        const caseId = await accountCase(tx, reporter.id, { finding: mod.id });
        expect((await refused(decideIn(tx, mod, caseId, { kind: "final", ruleId: "R6", actions: [act("warn_reporting")] })))?.detail).toMatch(/below the threshold/);
      }, world.migrateDb);
    });
  });

  // ---------------------------------------------------------------- the flow through the routes

  describe("the flow: five marked reports, a warning, a restriction, a withdrawn mark and a lifted warning that ends its restriction", () => {
    const W = STATEMENT_WORDS;
    /** The flow's people and decisions, filled in by its tests in order. */
    const flow = {
      reporter: { id: "", handle: "" },
      author: { id: "", handle: "" },
      other: { id: "", handle: "" },
      reports: [] as { postId: string; id: string; caseId: string }[],
      marking: [] as string[],
      warning: "",
      warningCase: "",
      warnedAt: "",
      restriction: "",
      otherIntake: "",
      otherLine: "",
    };
    async function account() {
      const made_ = await profile(apiDb);
      made.push(made_.id);
      return made_;
    }
    /** A confirmed decision through the route's code: its id, or a failure that says why none was recorded. */
    async function decided(member: RealStaff, caseId: string, input: DecisionInput): Promise<string> {
      const outcome = await world.decideAs(member, caseId, input);
      if (typeof outcome === "string") throw new Error(`the decision was not recorded: ${outcome}`);
      return outcome.decisionId;
    }
    const marked = (report: { id: string; caseId: string }) => decided(decider, report.caseId, { kind: "final", outcome: "no_violation", unfounded: [report.id] });
    const view = (caseId: string) => world.moderation.forStaff.caseView(finder.session, caseId);
    const reportingOf = async (caseId: string) => (await view(caseId)).standing!.reporting;
    const deps = () => world.moderation.deps;
    /** The module's interface to the auth module answers only whether report mails are stopped, which the reporter's list asks. */
    const listDeps = () => ({ ...deps(), auth: { ...deps().auth, accountReportMailStopped: async () => false } });
    /** The other person's line for their report about the account: every item as the status page and their list give it. */
    const otherLine = async () => JSON.stringify(await Promise.all((await noticeItems(apiDb, flow.otherIntake)).map((item) => itemStatus(deps(), item))));
    const restrictedUntil = async () => (await apiDb.execute<{ until: string | null }>(sql`select to_char(reports_restricted_until at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as until from profiles where id = ${flow.reporter.id}::uuid`))[0]!.until;
    const today = () => new Date().toISOString().slice(0, 10);
    const utc = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

    test("five of eight reports marked open a warning; a report about the account in its case holds it back until it is decided; the warning answers a finding only, counts for the frame, and reads as sent", async () => {
      flow.reporter = await account();
      flow.author = await account();
      flow.other = await account();
      for (let i = 0; i < 8; i++) flow.reports.push(await reportedPost(apiDb, flow.reporter.id, flow.author.id));
      for (const report of flow.reports.slice(0, 5)) flow.marking.push(await marked(report));
      // The daily release, as the migrator writes it: a mark counts only once its item's outcome is released.
      await releaseForTest(world.migrateDb, flow.reports.slice(0, 5).map((report) => report.id));
      // Each item says whether it can be marked, and whether its mark stands.
      const itemIn = async (report: { id: string; caseId: string }) => (await view(report.caseId)).items.find((item) => item.id === report.id)!;
      expect(await itemIn(flow.reports[0]!)).toMatchObject({ markable: true, unfounded: true, markWithdrawn: false });
      expect(await itemIn(flow.reports[5]!)).toMatchObject({ markable: true, unfounded: false, markWithdrawn: false });

      // Someone reported the account itself, and an admin opened a finding in the same case: the report comes first.
      const reported = await accountCase(apiDb, flow.reporter.id, { reporter: flow.other.id });
      await accountCase(apiDb, flow.reporter.id, { finding: finder.id });
      const first = await view(reported);
      expect(first.standing).toMatchObject({ openReports: true, reporting: { reports: 8, unfounded: 5, warnedOn: null, marksSince: null, mayWarn: true, mayRestrict: false, restrictedUntil: null } });
      expect(first.standing!.reporting.marked.map((mark) => mark.position)).toEqual([1, 1, 1, 1, 1]);
      expect(first.items.find((item) => item.source.kind === "staff")).toMatchObject({ markable: false });
      try {
        await world.decideAs(decider, reported, { kind: "final", ruleId: "R6", actions: [act("warn_reporting")] });
        throw new Error("the warning was recorded");
      } catch (err) {
        expect(err).toBeInstanceOf(ModerationError);
        expect(err).toMatchObject({ code: "invalid_decision", detail: "open_reports" });
      }
      await decided(decider, reported, { kind: "final", outcome: "no_violation" });
      const [otherItem] = await apiDb.execute<{ intake_id: string }>(sql`select intake_id from intake_items where case_id = ${reported}::uuid and reporter_account_id = ${flow.other.id}::uuid`);
      flow.otherIntake = otherItem!.intake_id;
      await world.migrateDb.execute(sql`update intake_items set outcome_sent_at = now(), shown_outcome = outcome where intake_id = ${flow.otherIntake}::uuid`);
      flow.otherLine = await otherLine();

      flow.warningCase = await accountCase(apiDb, flow.reporter.id, { finding: finder.id });
      flow.warning = await decided(decider, flow.warningCase, { kind: "final", ruleId: "R6", actions: [act("warn_reporting")] });
      const found = (await decisionStatement(apiDb, flow.warning))!;
      flow.warnedAt = found.statement.decidedAt;
      const warning = found.statement.measures[0]!;
      expect(warning).toMatchObject({ kind: "warn_reporting", basis: "reports", endsAt: expect.any(String) });
      expect(Date.parse(warning.endsAt!) - Date.parse(flow.warnedAt)).toBe(STANDING_RULES.reportFrameDays * 86_400_000);
      const paragraphs = statementParagraphs(found.statement);
      expect(paragraphs[0]).toBe(`${W.warn(utc(warning.endsAt!))} ${"If 3 of the reports you send after this warning are marked that way while it counts, a moderator may restrict your reports under korbat's rules for up to 30 days."} ${W.reportingOpen}`);
      expect(paragraphs).toContain(W.scope.warn);
      expect(mailTemplateOf(found.statement, paragraphs)).toEqual({ template: "reporting_warned", paragraphs });
      // The person reads it in /me; it restricts nothing.
      expect(await world.moderation.standingFor(flow.reporter.id)).toMatchObject({ measure: null, reporting: { warning: { decisionId: flow.warning, countsUntil: warning.endsAt }, restriction: null } });
      expect(await restrictedUntil()).toBeNull();
      // The Standing screen lists the account by its handle, in reports.
      const lists = await world.moderation.forStaff.standing();
      expect(lists.reportingRecords.items.find((row) => row.handle === flow.reporter.handle)).toEqual({ handle: flow.reporter.handle, caseId: null, reports: 8, unfounded: 5, warnedOn: today(), marksSince: 0 });
      // Invariant 20: the line of the person who reported the account says nothing of it.
      expect(await otherLine()).toBe(flow.otherLine);
    });

    test("three reports sent before the warning and marked after it count toward no restriction, nor do two sent after it; a third does, and the restriction starts at once and reads as sent", async () => {
      for (const report of flow.reports.slice(5)) flow.marking.push(await marked(report));
      // Two of the three are released; the last stays unreleased to the end, and so never counts.
      await releaseForTest(world.migrateDb, flow.reports.slice(5, 7).map((report) => report.id));
      const restrictionCase = await accountCase(apiDb, flow.reporter.id, { finding: finder.id });
      expect(await reportingOf(restrictionCase)).toMatchObject({ reports: 8, unfounded: 7, warnedOn: today(), marksSince: 0, mayWarn: false, mayRestrict: false });
      const restrict = () => world.decideAs(decider, restrictionCase, { kind: "final", ruleId: "R6", actions: [timed("restrict_reporting", 7, false)] });
      expect(await refused(restrict())).toEqual({ code: "invalid_decision", detail: expect.stringMatching(/too few marked reports/) });
      for (let i = 0; i < 2; i++) {
        const report = await reportedPost(apiDb, flow.reporter.id, flow.author.id);
        flow.reports.push(report);
        flow.marking.push(await marked(report));
        await releaseForTest(world.migrateDb, [report.id]);
      }
      expect(await reportingOf(restrictionCase)).toMatchObject({ reports: 10, unfounded: 9, marksSince: 2, mayRestrict: false });
      expect(await refused(restrict())).toEqual({ code: "invalid_decision", detail: expect.stringMatching(/too few marked reports/) });
      const third = await reportedPost(apiDb, flow.reporter.id, flow.author.id);
      flow.reports.push(third);
      flow.marking.push(await marked(third));
      // 3e's review (access1): the third mark is not released yet, so the restriction cannot rest on it.
      expect(await reportingOf(restrictionCase)).toMatchObject({ reports: 11, unfounded: 9, marksSince: 2, mayRestrict: false });
      expect(await refused(restrict())).toEqual({ code: "invalid_decision", detail: expect.stringMatching(/too few marked reports/) });
      await releaseForTest(world.migrateDb, [third.id]);
      const ready = await reportingOf(restrictionCase);
      expect(ready).toMatchObject({ reports: 11, unfounded: 10, marksSince: 3, mayRestrict: true });
      expect(ready.marked.filter((mark) => mark.sinceWarning)).toHaveLength(3);
      flow.restriction = await decided(decider, restrictionCase, { kind: "final", ruleId: "R6", actions: [timed("restrict_reporting", 7, false)] });

      const found = (await decisionStatement(apiDb, flow.restriction))!;
      const restriction = found.statement.measures[0]!;
      expect(restriction).toMatchObject({ kind: "restrict_reporting", basis: "reports", days: 7, warnedAt: flow.warnedAt });
      expect(Date.parse(restriction.endsAt!) - Date.parse(found.statement.decidedAt)).toBe(7 * 86_400_000);
      const paragraphs = statementParagraphs(found.statement);
      expect(paragraphs[0]).toBe(`${W.restrict(7, utc(restriction.endsAt!), utc(flow.warnedAt))} ${W.reportingOpen}`);
      expect(mailTemplateOf(found.statement, paragraphs)).toEqual({ template: "reporting_restricted", days: 7, endsAt: restriction.endsAt, paragraphs });
      // It starts at once: standing_apply wrote its end, which /me and the decision's screen read.
      expect(await restrictedUntil()).toBe(restriction.endsAt);
      expect((await world.moderation.standingFor(flow.reporter.id))!.reporting).toEqual({ warning: { decisionId: flow.warning, countsUntil: expect.any(String) }, restriction: { decisionId: flow.restriction, until: restriction.endsAt } });
      expect((await authorDecisionView(deps(), flow.reporter.id, flow.restriction)).reportingStanding).toEqual({ state: "running", until: restriction.endsAt, endedAt: null, endedBy: null });
      // The warning's decision says that a restriction rests on it, for [review.warning].
      expect((await view(flow.warningCase)).decisions.find((decision) => decision.id === flow.warning)!.standingOn).toEqual([{ kind: "restrict_reporting", basis: "reports" }]);
      expect(await otherLine()).toBe(flow.otherLine);
    });

    test("while it runs, the reporter's report under a rule is refused reporting_restricted and counts nothing; its notice of illegality, its report of child sexual abuse material and its request for a re-examination are taken", async () => {
      const postId = await newPostRow(apiDb, flow.author.id);
      expect(await refusal(recordIntake(deps(), { ground: ground.rule(flow.reporter.id, "R1"), live: [aPost(postId)] }))).toBe("reporting_restricted");
      expect(await record(apiDb, flow.reporter.id)).toEqual({ reports: 11, unfounded: 10 });
      expect((await recordIntake(deps(), { ground: ground.illegal(flow.reporter.id), live: [aPost(postId)] })).items).toHaveLength(1);
      expect((await recordIntake(deps(), { ground: ground.csam(), live: [aPost(await newPostRow(apiDb, flow.author.id))] })).items).toHaveLength(1);
      expect(await record(apiDb, flow.reporter.id)).toEqual({ reports: 11, unfounded: 10 });
      // The first marked item was released to its sender, who may ask for a re-examination: the restriction does not stop it.
      const first = flow.reports[0]!;
      expect(await reexamineOwnItem(deps(), flow.reporter.id, first.id, {})).toEqual({ positions: [1] });
      await world.moderation.settle();
      // The sender's own list shows the mark with the released outcome, and not before it.
      const listed = (await reporterList(listDeps(), flow.reporter.id)).reports.flatMap((report) => report.items);
      expect(listed.find((item) => item.id === first.id)).toMatchObject({ outcome: "no_violation", unfounded: true });
      expect(listed.find((item) => item.id === flow.reports[7]!.id)).toMatchObject({ outcome: null, unfounded: false });
    });

    test("a kept correction withdraws the marks of its decision: the case reads them withdrawn, the counts drop by the report, the sender's line loses the mark, and no statement goes", async () => {
      const first = flow.reports[0]!;
      const correction = await decided(decider, first.caseId, { kind: "correction", reviewsDecisionId: flow.marking[0]!, outcome: "kept", actions: [] });
      expect((await view(first.caseId)).items.find((item) => item.id === first.id)).toMatchObject({ unfounded: false, markWithdrawn: true });
      expect(await record(apiDb, flow.reporter.id)).toEqual({ reports: 11, unfounded: 9 });
      expect((await apiDb.execute<{ author_mail: string }>(sql`select author_mail::text from decisions where id = ${correction}::uuid`))[0]!.author_mail).toBe("none");
      const listed = (await reporterList(listDeps(), flow.reporter.id)).reports.flatMap((report) => report.items);
      expect(listed.find((item) => item.id === first.id)).toMatchObject({ outcome: "no_violation", unfounded: false });
      // A mark is added only in the transaction of its own decision.
      await rolledBack(apiDb, async (tx) => {
        expect((await rawMark(tx, first.id, flow.marking[1]!))?.detail).toMatch(/transaction of its own decision/);
      });
    });

    test("the warning lifted on appeal ends the restriction that rests on it in that review: the column clears, the review's statement says so, the restriction's screen reads it, and reports under the rules are taken again", async () => {
      await appealOf(apiDb, flow.warning, flow.reporter.id);
      const outcome = await world.reviewAs(reviewer, flow.warning, { outcome: "reversed", actions: [act("lift_reporting")] });
      if (typeof outcome === "string") throw new Error(`the review was not recorded: ${outcome}`);
      const review = outcome.decisionId;
      expect(await restrictedUntil()).toBeNull();
      expect((await world.moderation.standingFor(flow.reporter.id))!.reporting).toBeNull();
      const found = (await decisionStatement(apiDb, review))!;
      const restrictionAt = (await decisionStatement(apiDb, flow.restriction))!.statement.decidedAt;
      expect(found.statement.reversals).toEqual([expect.objectContaining({ kind: "lift_reporting", liftedKind: "warn_reporting", liftedDecidedAt: flow.warnedAt })]);
      expect(found.statement.endedStanding).toEqual([{ kind: "restrict_reporting", decidedAt: restrictionAt, periodThen: { state: "running", startedAt: restrictionAt, endedAt: null }, seal: false, replyFiledAt: null }]);
      const paragraphs = statementParagraphs(found.statement);
      expect(paragraphs).toContain(W.reportingLifted.warning);
      expect(paragraphs).toContain(`${W.basisEndedReporting(utc(restrictionAt))} ${W.basisEndedReportingThen.running}`);
      // A lift of a reporting measure, also one that ends a restriction with its warning, rides on 3c's mail.
      expect(mailTemplateOf(found.statement, paragraphs)).toMatchObject({ template: "moderation_decision" });
      const ended = (await authorDecisionView(deps(), flow.reporter.id, flow.restriction)).reportingStanding;
      expect(ended).toMatchObject({ state: "basis_ended", endedBy: review, endedAt: expect.any(String) });
      // The person's list names the restriction's days and what the review ended.
      const rows = (await authorCases(deps(), flow.reporter.id)).decisions;
      expect(rows.find((row) => row.id === flow.restriction)).toMatchObject({ actions: ["restrict_reporting"], reportingDays: 7 });
      expect(rows.find((row) => row.id === review)).toMatchObject({ actions: ["lift_reporting"], endedStanding: ["restrict_reporting"] });
      expect(rows.find((row) => row.id === flow.warning)).not.toHaveProperty("endedStanding");
      // Reports under the rules are taken again, and counted.
      expect((await recordIntake(deps(), { ground: ground.rule(flow.reporter.id, "R1"), live: [aPost(await newPostRow(apiDb, flow.author.id))] })).items).toHaveLength(1);
      expect(await record(apiDb, flow.reporter.id)).toEqual({ reports: 12, unfounded: 9 });
      expect(await otherLine()).toBe(flow.otherLine);
    });

    test("a report sent before the frame and marked inside it counts on neither side", async () => {
      const [sender, author] = [await account(), await account()];
      const report = await reportedPost(apiDb, sender.id, author.id);
      expect(await record(apiDb, sender.id)).toEqual({ reports: 1, unfounded: 0 });
      await ageStandingForTest(world.migrateDb, sender.id, `${STANDING_RULES.reportFrameDays + 1} days`);
      expect(await record(apiDb, sender.id)).toEqual({ reports: 0, unfounded: 0 });
      const decision = await marked(report);
      expect((await actionsOf(apiDb, decision)).length).toBe(0);
      expect((await apiDb.execute(sql`select 1 from unfounded_marks where item_id = ${report.id}::uuid`)).length).toBe(1);
      expect(await record(apiDb, sender.id)).toEqual({ reports: 0, unfounded: 0 });
    });
  });

  test("this file left no row behind: the tables it writes hold what they held before it", async () => {
    await closeDecisions();
    await removeFixtures(world.migrateDb, made.splice(0));
    expect(await rowCounts(apiDb)).toEqual(before);
  });
});
