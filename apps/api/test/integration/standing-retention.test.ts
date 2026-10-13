import { sql, type SQL } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { ExportFormat, STANDING_RULES } from "@korbat/contracts";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { createAuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import type { MediaForCases } from "../../src/media";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createModeration } from "../../src/moderation";
import { exportFor } from "../../src/moderation/export";
import { saltedStatement } from "../../src/moderation/intake";
import { eraseReplyStatements, forgetReportCounts } from "../../src/moderation/repo";
import { RETENTION_ACTION, retentionRound } from "../../src/moderation/retention";
import { insertReply } from "../../src/moderation/standing-repo";
import { socialForModeration } from "../../src/social";
import {
  aPost,
  act,
  ageStandingForTest,
  anAccount,
  casesMedia,
  decideIn,
  ground,
  intake,
  moderationDeps,
  newPostRow,
  newTestStaff,
  noAuthForModeration,
  rowCounts,
  staffProfile,
  timed,
  type TestStaff,
} from "./moderation-fixtures";
import { authAccount, one } from "./retention-fixtures";
import { newProfile } from "./social-fixtures";
import { rolledBack } from "./staff-fixtures";

// Every test decides a dozen cases inside one open transaction, each decision a round of statements: slow on a loaded machine.
vi.setConfig({ testTimeout: 240_000 });

/**
 * What korbat keeps of account sanctions is what the terms say (3e design, sections 6.5, 6.7 and 7.14; section 12.1,
 * invariant 22), and the export shows it (W.8). A reply's text is erased only once the reply is answered and its
 * decision is final for its author; an unanswered reply keeps its text however old, also one filed after that finality.
 * The marks "manifestly unfounded" and the daily tallies leave together once their report's UTC day lies before the frame
 * of report_frame_days, and with the account. The retention job runs both steps, each with its audit row. Every test runs
 * as the migrator, which moves the clock by dating the account's rows back (ageStandingForTest), inside a transaction
 * that is rolled back, deciding through the module's own decide; the file's last test holds it to leaving no row behind.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the retention of account sanctions, and the export's standing", () => {
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  let mod: TestStaff;
  let admin: TestStaff;
  let before: Record<string, number>;

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    const repo = createAuthRepo(authDb);
    mod = await newTestStaff(authDb, migrateDb, repo, "moderator");
    admin = await newTestStaff(authDb, migrateDb, repo, "admin");
    before = await rowCounts(apiDb);
  }, 120_000);
  afterAll(async () => {
    await Promise.all([closeDb(apiDb), closeDb(authDb), closeDb(migrateDb)]);
  });

  // ---------------------------------------------------------------- helpers

  /** One test's world: a transaction of the migrator that is rolled back, with both staff members' profiles in it. */
  const inWorld = (fn: (tx: DbTx) => Promise<void>) =>
    rolledBack(migrateDb, async (tx) => {
      await staffProfile(tx, mod);
      await staffProfile(tx, admin);
      await fn(tx);
    });
  const profile = (tx: DbTx) => newProfile(tx as unknown as Db);
  /** Moves the account's ledger, replies, marks, reports and tallies back by the interval, inside the test's transaction. */
  const age = (tx: DbTx, accountId: string, interval: string) => ageStandingForTest(tx as unknown as Db, accountId, interval);
  /** A time the database holds, as toISOString writes it. */
  const isoOf = async (tx: DbTx, expression: SQL) => (await one<{ at: string | null }>(tx, sql`select to_char((${expression}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at`)).at;
  /** A UTC day the database computes, as YYYY-MM-DD. */
  const dayOf = async (tx: DbTx, expression: SQL) => (await one<{ day: string }>(tx, sql`select to_char(${expression}, 'YYYY-MM-DD') as day`)).day;

  /**
   * A suspension taken at once on the ground of a threat (3e design, section 7.7): an admin's finding under R5 on a post the
   * account makes now and its final removal, which gives the strike the database computes, then an admin's finding under
   * R5 on the account and a final decision that suspends it for `days`. Answers the suspension's decision, case and row.
   */
  async function threatSuspension(tx: DbTx, account: { id: string; handle: string }, days = 7) {
    const postId = await newPostRow(tx, account.id, { createdAt: sql`clock_timestamp()`, body: "a post with a direct threat" });
    const postCase = (await intake(tx, ground.finding(admin.id, "R5"), aPost(postId))).items[0]!.caseId!;
    const removal = await decideIn(tx, admin, postCase, { kind: "final", ruleId: "R5", actions: [act("remove")] });
    const caseId = (await intake(tx, ground.finding(admin.id, "R5"), anAccount(account.id, account.handle))).items[0]!.caseId!;
    const decisionId = await decideIn(tx, admin, caseId, { kind: "final", ruleId: "R5", actions: [timed("suspend", days, false)] });
    const actionId = (await one<{ id: string }>(tx, sql`select id from decision_actions where decision_id = ${decisionId}::uuid and kind::text = 'suspend'`)).id;
    return { decisionId, caseId, actionId, removal };
  }
  /** A reply to the measure, as the reply route inserts it, with its text salted and digested; the trigger decides whether it is on time. */
  async function reply(tx: DbTx, actionId: string, accountId: string, text: string | undefined) {
    return insertReply(tx, { actionId, accountId, statement: await saltedStatement(text) });
  }
  /** What a reply holds now. */
  const replyRow = (tx: DbTx, actionId: string) =>
    one<{ statement: string | null; salt: string | null; digest: string | null; erased: boolean; erased_now: boolean | null; answered: boolean }>(
      tx,
      sql`select statement, statement_salt as salt, statement_digest as digest, erased_at is not null as erased, erased_at = now() as erased_now, answered_at is not null as answered
            from suspension_replies where action_id = ${actionId}::uuid`,
    );
  /** Whether the decision is final for its author now (3c's decision_final_at, as 3e replaced it). */
  const finalNow = async (tx: DbTx, decisionId: string) => (await one<{ final: boolean | null }>(tx, sql`select public.decision_final_at(${decisionId}::uuid) <= now() as final`)).final === true;
  /** A signed-in person's report under R1 of a new post of the author: its report, item and case. */
  async function reportedPost(tx: DbTx, reporterId: string, authorId: string) {
    const postId = await newPostRow(tx, authorId);
    const recorded = await intake(tx, ground.rule(reporterId, "R1"), aPost(postId));
    return { intakeId: recorded.intakeId, itemId: recorded.items[0]!.id, caseId: recorded.items[0]!.caseId! };
  }
  /** A report of the reporter that a moderator answered "No breach" and marked manifestly unfounded: the report and the decision. */
  async function markedReport(tx: DbTx, reporterId: string, authorId: string) {
    const report = await reportedPost(tx, reporterId, authorId);
    const decisionId = await decideIn(tx, mod, report.caseId, { kind: "final", outcome: "no_violation", unfounded: [report.itemId] });
    return { ...report, decisionId };
  }
  /** The account's marks and tallies, as the migrator reads them. */
  const countsOf = (tx: DbTx, accountId: string) =>
    one<{ marks: number; tallies: number }>(
      tx,
      sql`select (select count(*)::int from unfounded_marks where account_id = ${accountId}::uuid) as marks, (select count(*)::int from report_tallies where account_id = ${accountId}::uuid) as tallies`,
    );
  /** A UTC day this many days before today's, as SQL. */
  const daysBack = (days: number) => sql`(now() at time zone 'UTC')::date - ${days}::int`;
  const frame = STANDING_RULES.reportFrameDays;

  // ---------------------------------------------------------------- invariant 22: a reply's text

  describe("erase_reply_statements: a reply's text goes only once the reply is answered and its decision is final for its author", () => {
    test("an answered reply keeps its text while its decision can still be appealed, and loses it once the decision is final; the digest and the row stay, and a reply without a text is not counted", async () => {
      await inWorld(async (tx) => {
        // Whatever another suite left due goes first, so the counts below are this test's own.
        await eraseReplyStatements(tx);
        const ada = await profile(tx);
        const bea = await profile(tx);
        const suspension = await threatSuspension(tx, ada, STANDING_RULES.threatDays);
        const other = await threatSuspension(tx, bea, STANDING_RULES.threatDays);
        // A suspension taken at once has started: a reply is late, and never holds anything.
        expect((await reply(tx, suspension.actionId, ada.id, "These posts were a quote from a film.")).onTime).toBe(false);
        expect((await reply(tx, other.actionId, bea.id, undefined)).onTime).toBe(false);
        const filed = await replyRow(tx, suspension.actionId);
        expect(filed).toMatchObject({ statement: "These posts were a quote from a film.", erased: false, answered: false });

        // Unanswered: kept, whatever else holds.
        expect(await eraseReplyStatements(tx)).toBe(0);
        // Answered by a correction that keeps each decision, the same day: the six months to appeal still run.
        await decideIn(tx, admin, suspension.caseId, { kind: "correction", reviewsDecisionId: suspension.decisionId, outcome: "kept" });
        await decideIn(tx, admin, other.caseId, { kind: "correction", reviewsDecisionId: other.decisionId, outcome: "kept" });
        expect((await replyRow(tx, suspension.actionId)).answered).toBe(true);
        expect(await finalNow(tx, suspension.decisionId)).toBe(false);
        expect(await eraseReplyStatements(tx)).toBe(0);
        expect((await replyRow(tx, suspension.actionId)).statement).toBe("These posts were a quote from a film.");

        // Seven months on, nobody appealed: the decision is final for its author, and the text goes.
        await age(tx, ada.id, "7 months");
        await age(tx, bea.id, "7 months");
        expect(await finalNow(tx, suspension.decisionId)).toBe(true);
        expect(await eraseReplyStatements(tx)).toBe(1);
        expect(await replyRow(tx, suspension.actionId)).toEqual({ statement: null, salt: null, digest: filed.digest, erased: true, erased_now: true, answered: true });
        // The reply without a text had nothing to erase, and stays as it was.
        expect(await replyRow(tx, other.actionId)).toMatchObject({ statement: null, digest: null, erased: false, answered: true });
        // A second run changes nothing.
        expect(await eraseReplyStatements(tx)).toBe(0);
      });
    });

    test("an unanswered reply keeps its text however old: one left unanswered past its decision's finality, and one filed after it", async () => {
      await inWorld(async (tx) => {
        await eraseReplyStatements(tx);
        // A reply filed during a suspension at once and never answered; seven months on the decision is final.
        const cal = await profile(tx);
        const left = await threatSuspension(tx, cal, STANDING_RULES.threatDays);
        await reply(tx, left.actionId, cal.id, "Please read this.");
        await age(tx, cal.id, "7 months");
        expect(await finalNow(tx, left.decisionId)).toBe(true);

        // A termination at once for a second threat (as terminateForTest makes one), final after seven months unused, and
        // a reply to it filed only then: a termination has no end, so a reply is still open.
        const dan = await profile(tx);
        await threatSuspension(tx, dan, 7);
        await age(tx, dan.id, "8 days");
        const secondPost = await newPostRow(tx, dan.id, { createdAt: sql`clock_timestamp()`, body: "a second post with a direct threat" });
        const secondCase = (await intake(tx, ground.finding(admin.id, "R5"), aPost(secondPost))).items[0]!.caseId!;
        await decideIn(tx, admin, secondCase, { kind: "final", ruleId: "R5", actions: [act("remove")] });
        const accountCase = (await intake(tx, ground.finding(admin.id, "R5"), anAccount(dan.id, dan.handle))).items[0]!.caseId!;
        const termination = await decideIn(tx, admin, accountCase, { kind: "final", ruleId: "R5", actions: [timed("terminate", null, false)] });
        const terminate = (await one<{ id: string }>(tx, sql`select id from decision_actions where decision_id = ${termination}::uuid and kind::text = 'terminate'`)).id;
        await age(tx, dan.id, "7 months");
        expect(await finalNow(tx, termination)).toBe(true);
        expect((await reply(tx, terminate, dan.id, "I ask you to look again.")).onTime).toBe(false);

        expect(await eraseReplyStatements(tx)).toBe(0);
        expect(await replyRow(tx, left.actionId)).toMatchObject({ statement: "Please read this.", erased: false, answered: false });
        expect(await replyRow(tx, terminate)).toMatchObject({ statement: "I ask you to look again.", erased: false, answered: false });
      });
    });
  });

  // ---------------------------------------------------------------- invariant 22: the reporting counts

  describe("forget_report_counts: the marks and the tallies of a report leave on the same UTC day, the day the frame passes it", () => {
    test("marks (a withdrawn one too) and tallies of days before the frame are deleted, those inside it kept; the record the measures read does not change", async () => {
      await inWorld(async (tx) => {
        await forgetReportCounts(tx);
        const author = await profile(tx);
        const reporter = await profile(tx);
        const other = await profile(tx);
        // Three marked reports of the reporter, one of whose marks a correction then withdrew, and one of another account.
        const oldest = await markedReport(tx, reporter.id, author.id);
        const boundary = await markedReport(tx, reporter.id, author.id);
        const inside = await markedReport(tx, reporter.id, author.id);
        await decideIn(tx, admin, oldest.caseId, { kind: "correction", reviewsDecisionId: oldest.decisionId, outcome: "kept" });
        const others = await markedReport(tx, other.id, author.id);
        expect(await one(tx, sql`select withdrawn_by is not null as withdrawn from unfounded_marks where item_id = ${oldest.itemId}::uuid`)).toEqual({ withdrawn: true });

        // Each report and its mark dated back as the frame meets it: well before, on the last day outside it, the first inside.
        const sentBack = async (report: { intakeId: string; itemId: string }, days: number) => {
          await tx.execute(sql`update intakes set received_at = now() - make_interval(days => ${days}::int) where id = ${report.intakeId}::uuid`);
          await tx.execute(sql`update unfounded_marks set reported_at = now() - make_interval(days => ${days}::int) where item_id = ${report.itemId}::uuid`);
        };
        await sentBack(oldest, frame + 30);
        await sentBack(boundary, frame);
        await sentBack(inside, frame - 1);
        await tx.execute(sql`delete from report_tallies where account_id = ${reporter.id}::uuid`);
        for (const days of [frame + 30, frame, frame - 1]) {
          await tx.execute(sql`insert into report_tallies (account_id, day, reports) values (${reporter.id}::uuid, ${daysBack(days)}, 1)`);
        }
        const record = () => one<{ reports: number; unfounded: number }>(tx, sql`select reports, unfounded from reporting_record where account_id = ${reporter.id}::uuid`);
        // The frame counts the report of the first day inside it only, on both sides.
        expect(await record()).toEqual({ reports: 1, unfounded: 1 });

        // Two marks and two tallies lie before the frame.
        expect(await forgetReportCounts(tx)).toBe(4);
        expect(await countsOf(tx, reporter.id)).toEqual({ marks: 1, tallies: 1 });
        expect(await one(tx, sql`select item_id from unfounded_marks where account_id = ${reporter.id}::uuid`)).toEqual({ item_id: inside.itemId });
        expect(await one(tx, sql`select day = ${daysBack(frame - 1)} as inside from report_tallies where account_id = ${reporter.id}::uuid`)).toEqual({ inside: true });
        // What the warning and the restriction read is what it was: both sides of every count left together.
        expect(await record()).toEqual({ reports: 1, unfounded: 1 });
        // The other account's report of today is untouched, and a second run deletes nothing.
        expect(await countsOf(tx, other.id)).toEqual({ marks: 1, tallies: 1 });
        expect(others.itemId).not.toBe(inside.itemId);
        expect(await forgetReportCounts(tx)).toBe(0);
      });
    });

    test("both go with the account: the moderation module's forgetAccount deletes the account's marks and tallies, whatever their day, and nobody else's", async () => {
      await inWorld(async (tx) => {
        const author = await profile(tx);
        const leaving = await profile(tx);
        const staying = await profile(tx);
        await markedReport(tx, leaving.id, author.id);
        await reportedPost(tx, leaving.id, author.id);
        await markedReport(tx, staying.id, author.id);
        expect(await countsOf(tx, leaving.id)).toEqual({ marks: 1, tallies: 1 });
        // The account's auth row is marked deleted, as the deletion's first step leaves it; its purge then asks the module.
        await authAccount(tx, leaving.id, "0 seconds");
        const moderation = createModeration({
          apiDb: tx as unknown as Db,
          auth: noAuthForModeration(),
          social: socialForModeration(tx as unknown as Db),
          media: casesMedia(tx),
          rateLimitStore: new MemoryStore(),
          config: loadConfig(),
          logger: pino({ level: "silent" }),
        });
        await moderation.forAccount.forgetAccount(leaving.id);
        expect(await countsOf(tx, leaving.id)).toEqual({ marks: 0, tallies: 0 });
        expect(await countsOf(tx, staying.id)).toEqual({ marks: 1, tallies: 1 });
      });
    });
  });

  // ---------------------------------------------------------------- the retention job's two steps

  test("the retention job runs both steps in every round, each in a transaction of its own that ends with its audit row when it changed something, and its round's line counts them", async () => {
    await inWorld(async (tx) => {
      // No image row is dropped and no file is asked for: the disposal is another step's, tested in moderation-retention.
      const quiet: MediaForCases = { ...casesMedia(tx), requestOwed: async () => 0, dropDisposable: async () => [], requestDeletion: async () => undefined };
      const lines: Record<string, unknown>[] = [];
      const log = pino({ level: "info" }, { write: (line: string) => void lines.push(JSON.parse(line) as Record<string, unknown>) });
      const round = () => retentionRound({ apiDb: tx as unknown as Db, media: quiet, log });
      // Whatever another suite left due goes first, so the counts below are this test's own.
      await round();
      const head = async () => (await one<{ seq: number }>(tx, sql`select seq::int as seq from audit_head where id = 1`)).seq;
      const retentionRows = async (after: number) =>
        [...(await tx.execute<{ metadata: Record<string, unknown> }>(sql`select metadata from audit_log where action = ${RETENTION_ACTION} and chain_seq > ${after} order by chain_seq`))].map((row) => row.metadata);

      // An answered reply whose decision is final, and a marked report with its tally from before the frame.
      const eve = await profile(tx);
      const suspension = await threatSuspension(tx, eve, 7);
      await reply(tx, suspension.actionId, eve.id, "It was satire.");
      await decideIn(tx, admin, suspension.caseId, { kind: "correction", reviewsDecisionId: suspension.decisionId, outcome: "kept" });
      await age(tx, eve.id, "7 months");
      const reporter = await profile(tx);
      await markedReport(tx, reporter.id, (await profile(tx)).id);
      await age(tx, reporter.id, `${frame + 1} days`);

      const start = await head();
      lines.length = 0;
      const done = await round();
      expect(done).toMatchObject({ replies: 1, reportCounts: 2, failed: 0 });
      // One audit row each, the server's own, ids and counts only, in the order of the steps.
      const ours = (await retentionRows(start)).filter((row) => row.step === "reply_statements" || row.step === "report_counts");
      expect(ours).toEqual([
        { step: "reply_statements", caseId: null, intakeId: null, decisionId: null, count: 1 },
        { step: "report_counts", caseId: null, intakeId: null, decisionId: null, count: 2 },
      ]);
      expect(lines.filter((line) => line.msg === "moderation-retention: round").map((line) => ({ replies: line.replies, reportCounts: line.reportCounts }))).toEqual([{ replies: 1, reportCounts: 2 }]);
      expect(JSON.stringify(lines)).not.toContain("It was satire.");
      expect(JSON.stringify(lines)).not.toContain(eve.id);

      // A second round changes nothing and writes no row for either step.
      const again = await head();
      expect(await round()).toMatchObject({ replies: 0, reportCounts: 0, failed: 0 });
      expect((await retentionRows(again)).filter((row) => row.step === "reply_statements" || row.step === "report_counts")).toEqual([]);
    });
  });

  // ---------------------------------------------------------------- the export (W.8)

  test("the export's standing, replies and reporting (W.8): the account's own measures, replies and report counts, a mark by its own report's reference and position, and nothing of anyone else", async () => {
    await inWorld(async (tx) => {
      const author = await profile(tx);
      const sam = await profile(tx);
      const olga = await profile(tx);
      // Six rule reports of Sam's, each marked; one mark is then withdrawn by a correction, so five count, which is a warning's
      // threshold. Olga's marked report is hers alone.
      const reports = [];
      for (let n = 0; n < 6; n++) reports.push(await markedReport(tx, sam.id, author.id));
      await decideIn(tx, admin, reports[0]!.caseId, { kind: "correction", reviewsDecisionId: reports[0]!.decisionId, outcome: "kept" });
      const olgas = await markedReport(tx, olga.id, author.id);
      const warnCase = (await intake(tx, ground.finding(mod.id, "R6"), anAccount(sam.id, sam.handle))).items[0]!.caseId!;
      const warning = await decideIn(tx, mod, warnCase, { kind: "final", ruleId: "R6", actions: [act("warn_reporting")] });
      // Two days later, a suspension at once on a threat, with a reply; a day later korbat lifts it, which answers the reply.
      await age(tx, sam.id, "2 days");
      const suspension = await threatSuspension(tx, sam, 7);
      await reply(tx, suspension.actionId, sam.id, "I did not write that post.");
      await age(tx, sam.id, "1 day");
      const lift = await decideIn(tx, admin, suspension.caseId, { kind: "correction", reviewsDecisionId: suspension.decisionId, outcome: "reversed", actions: [act("lift_suspension")] });

      const exported = await exportFor(moderationDeps(tx), sam.id);
      // It is the format's member, and nothing beyond it.
      expect(ExportFormat.shape.moderation.parse(exported)).toEqual(exported);
      expect(Object.keys(exported)).toEqual(["decisions", "reports", "strikes", "standing", "replies", "reporting"]);

      const decided = (id: string) => isoOf(tx, sql`(select decided_at from decisions where id = ${id}::uuid)`);
      const liftedAt = await isoOf(tx, sql`(select created_at from decision_actions where decision_id = ${lift}::uuid)`);
      expect(exported.standing).toEqual([
        {
          decisionId: suspension.decisionId,
          kind: "suspend",
          basis: "threat",
          days: 7,
          announced: false,
          decidedAt: await decided(suspension.decisionId),
          earliestStart: await isoOf(tx, sql`(select starts_at from decision_actions where id = ${suspension.actionId}::uuid)`),
          startsAt: await decided(suspension.decisionId),
          endsAt: liftedAt,
          liftedAt,
          liftedBy: lift,
          replaced: false,
          basisEndedAt: null,
          basisEndedBy: null,
        },
        {
          decisionId: warning,
          kind: "warn_reporting",
          basis: "reports",
          days: null,
          announced: null,
          decidedAt: await decided(warning),
          earliestStart: null,
          startsAt: await decided(warning),
          endsAt: await isoOf(tx, sql`(select ends_at from decision_actions where decision_id = ${warning}::uuid)`),
          liftedAt: null,
          liftedBy: null,
          replaced: false,
          basisEndedAt: null,
          basisEndedBy: null,
        },
      ]);

      expect(exported.replies).toEqual([
        {
          decisionId: suspension.decisionId,
          filedAt: await isoOf(tx, sql`(select filed_at from suspension_replies where action_id = ${suspension.actionId}::uuid)`),
          onTime: false,
          text: "I did not write that post.",
          erasedAt: null,
          answeredAt: liftedAt,
          answeredBy: lift,
        },
      ]);

      // The counts by report, as the measures read them, and every mark by the reference and position of Sam's own report.
      const sentOn = await dayOf(tx, sql`(select (received_at at time zone 'UTC')::date from intakes where id = ${reports[0]!.intakeId}::uuid)`);
      const refs = new Map(
        (await tx.execute<{ id: string; ref: string }>(sql`select id, ref from intakes where id = any(${`{${reports.map((r) => r.intakeId).join(",")}}`}::uuid[])`)).map((row) => [row.id, row.ref]),
      );
      expect(exported.reporting).toMatchObject({ frameDays: frame, days: [{ day: sentOn, reports: 6 }], markedReports: 5 });
      const byRef = [...exported.reporting.marks].sort((a, b) => (a.ref < b.ref ? -1 : 1));
      const expectedMarks = await Promise.all(
        reports.map(async (report, n) => ({
          ref: refs.get(report.intakeId)!,
          position: 1,
          sentOn,
          markedAt: (await isoOf(tx, sql`(select marked_at from unfounded_marks where item_id = ${report.itemId}::uuid)`))!,
          withdrawnAt: n === 0 ? await isoOf(tx, sql`(select withdrawn_at from unfounded_marks where item_id = ${report.itemId}::uuid)`) : null,
          counts: n !== 0,
        })),
      );
      expect(byRef).toEqual(expectedMarks.sort((a, b) => (a.ref < b.ref ? -1 : 1)));

      // Nothing names another person: not the reported author, not the other reporter, not her report.
      const text = JSON.stringify(exported);
      const olgasRef = (await one<{ ref: string }>(tx, sql`select ref from intakes where id = ${olgas.intakeId}::uuid`)).ref;
      for (const absent of [author.id, author.handle, olga.id, olga.handle, olgasRef, mod.id, admin.id]) expect(text, absent).not.toContain(absent);

      // Once the reply's text is erased the export says when, and still lists the reply.
      await age(tx, sam.id, "7 months");
      expect(await eraseReplyStatements(tx)).toBeGreaterThanOrEqual(1);
      const later = await exportFor(moderationDeps(tx), sam.id);
      expect(later.replies).toEqual([{ ...exported.replies[0]!, filedAt: expect.any(String), answeredAt: expect.any(String), text: null, erasedAt: await isoOf(tx, sql`now()`) }]);
      // And seven months on, the report counts have left the frame and are gone from it.
      await forgetReportCounts(tx);
      expect((await exportFor(moderationDeps(tx), sam.id)).reporting).toEqual({ frameDays: frame, days: [], marks: [], markedReports: 0 });
    });
  });

  test("this file left no row behind", async () => {
    expect(await rowCounts(apiDb)).toEqual(before);
  });
});
