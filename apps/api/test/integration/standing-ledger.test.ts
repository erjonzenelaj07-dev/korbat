import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { ACTION_KINDS, ORDER_ACTION_KINDS, STANDING_RULES, type ActionKind, type RuleId } from "@korbat/contracts";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { ModerationError } from "../../src/moderation/context";
import { dueRedactions, insertAction, insertDecision, noticeItems } from "../../src/moderation/repo";
import { closeDecisions, deciderWorld, strikeForTest, type DeciderWorld, type RealStaff } from "./moderation-decide";
import {
  aPost,
  act,
  actionsOf,
  ageStandingForTest,
  anAccount,
  appealOf,
  decideIn,
  decideWith,
  decisionParams,
  decisionRow,
  ground,
  intake,
  newImageRow,
  newPostRow,
  newTestStaff,
  refusal,
  refusalDetail,
  removeFixtures,
  reviewIn,
  rowCounts,
  staffProfile,
  strikeDueFor,
  timed,
  type DecisionInput,
  type TestStaff,
} from "./moderation-fixtures";
import { newProfile } from "./social-fixtures";
import { rolledBack } from "./staff-fixtures";

// Each test runs many statements in one open transaction, each a round trip: a loaded machine needs more than five seconds.
vi.setConfig({ testTimeout: 120_000 });

/**
 * The standing ledger at the database's level (3e design, section 6.2; section 12.1, invariants 1, 2, 4 to 9, 11 and 13,
 * their database parts): the constants, the strike rule, the overruling, the ladder, a basis that breaks, one standing
 * measure at a time, the closed list of measures taken at once, the start that never comes before the earliest one, and
 * staff. Most tests run as korbat_api inside one transaction that is rolled back, deciding through the module's own
 * decide with the fixtures' flag that lifts the routes' list of kinds (decideWith), so every kind of 3e can be stored before
 * its route opens. Several posts of one author are dated a minute apart in the future, so that each is newer than the
 * time its author was told of the strike before it, all inside one transaction. What needs the clock to move commits,
 * and moves the times back with ageStandingForTest as the migrator; its rows are removed in the end. The file's last test
 * holds it to leaving no row behind.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the standing ledger", () => {
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  let mod: TestStaff;
  let admin: TestStaff;
  let before: Record<string, number>;
  /** Profiles a committed scenario made, removed with everything they hold at the end. */
  const committed: string[] = [];

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    repo = createAuthRepo(authDb);
    mod = await newTestStaff(authDb, migrateDb, repo, "moderator");
    admin = await newTestStaff(authDb, migrateDb, repo, "admin");
    before = await rowCounts(apiDb);
  }, 120_000);
  afterAll(async () => {
    try {
      await closeDecisions();
      await removeFixtures(migrateDb, committed);
    } finally {
      await Promise.all([closeDb(apiDb), closeDb(authDb), closeDb(migrateDb)]);
    }
  }, 120_000);

  /** One test's world: a transaction of the API role that is rolled back, with both staff members' profiles in it. */
  const inWorld = (fn: (tx: DbTx) => Promise<void>, db: Db = apiDb) =>
    rolledBack(db, async (tx) => {
      await staffProfile(tx, mod);
      await staffProfile(tx, admin);
      await fn(tx);
    });
  const profile = (tx: DbTx) => newProfile(tx as unknown as Db);
  /** A time this many minutes after the transaction's start, as SQL. */
  const minutesOn = (minutes: number) => sql`now() + make_interval(mins => ${minutes}::int)`;

  /** A post of the author dated this many minutes after the transaction's start (30 days back when null), and its case, opened by an admin's finding. */
  async function postCase(tx: DbTx, authorId: string, minutes: number | null, rule: RuleId = "R1") {
    const postId = await newPostRow(tx, authorId, minutes === null ? {} : { createdAt: minutesOn(minutes) });
    const recorded = await intake(tx, ground.finding(admin.id, rule), aPost(postId));
    return { postId, caseId: recorded.items[0]!.caseId! };
  }
  /** A final removal of a new post of the author under the rule, which gives a strike: the decision. */
  async function strikeIn(tx: DbTx, authorId: string, minutes: number, rule: RuleId = "R1"): Promise<string> {
    const { caseId } = await postCase(tx, authorId, minutes, rule);
    const decision = await decideIn(tx, admin, caseId, { kind: "final", ruleId: rule, actions: [act("remove")] });
    expect((await actionsOf(tx, decision)).map((a) => a.kind), "the removal gives a strike").toContain("strike");
    return decision;
  }
  /** The account's case, opened by an admin's finding under the rule, or by a user's report. */
  async function accountCase(tx: DbTx, accountId: string, rule: RuleId = "R1", by: "finding" | "report" = "finding"): Promise<string> {
    const g = by === "finding" ? ground.finding(admin.id, rule) : ground.rule((await profile(tx)).id, rule);
    const recorded = await intake(tx, g, anAccount(accountId, "named"));
    return recorded.items[0]!.caseId!;
  }
  /** A final decision on the account's case under the rule, holding these actions. */
  const onAccount = async (tx: DbTx, accountId: string, rule: RuleId, actions: DecisionInput["actions"], staff: TestStaff = admin, by: "finding" | "report" = "finding") =>
    decideIn(tx, staff, await accountCase(tx, accountId, rule, by), { kind: "final", ruleId: rule, actions });
  /** The account's three derived columns. */
  const columns = async (tx: DbTx, accountId: string) =>
    (await tx.execute<{ from: string | null; until: string | null; restricted: string | null }>(
      sql`select suspended_from::text as from, suspended_until::text as until, reports_restricted_until::text as restricted from profiles where id = ${accountId}::uuid`,
    ))[0]!;
  const liveRows = async (tx: DbTx, accountId: string) => (await tx.execute<{ action_id: string }>(sql`select action_id from standing_live where account_id = ${accountId}::uuid`)).length;
  const activeStrikes = async (tx: DbTx, accountId: string) => (await tx.execute<{ n: number }>(sql`select count(*)::int as n from active_strikes where account_id = ${accountId}::uuid`))[0]!.n;
  /**
   * A decision's row and these ledger rows as the module inserts them, without the params' refinements and without the
   * audit row, in a savepoint: what the triggers refuse at insert, which the params' schema would refuse before them.
   * Answers the refusal's code, or null.
   */
  async function rawRows(tx: DbTx, caseId: string, input: DecisionInput, rows: { kind: ActionKind; mediaId?: string | null; days?: number | null; announced?: boolean }[]) {
    const params = await decisionParams(tx, admin, caseId, { ...input, strike: false, overrule: false });
    return refusal(
      tx.transaction(async (sp) => {
        const id = randomUUID();
        await insertDecision(sp, { id, caseId, decidedBy: admin.id, params });
        for (const row of rows) await insertAction(sp, id, { kind: row.kind, mediaId: row.mediaId ?? null, days: row.days, announced: row.announced });
      }),
    );
  }
  /** The ledger row of a kind in a decision. */
  const rowOf = async (tx: DbTx, decisionId: string, kind: string) => (await actionsOf(tx, decisionId)).find((a) => a.kind === kind) as unknown as Record<string, unknown> & { id: string };

  // ---------------------------------------------------------------- the constants and the enum

  test("standing_rules() holds the contracts' STANDING_RULES, name by name, and action_kind the contracts' 26 kinds in order", async () => {
    const [row] = await apiDb.execute<Record<string, unknown>>(sql`select * from public.standing_rules()`);
    const camel = (name: string) => name.replace(/_([a-z])/g, (_m, letter: string) => letter.toUpperCase());
    const read = Object.fromEntries(Object.entries(row!).map(([name, value]) => [camel(name), Array.isArray(value) ? value : Number(value)]));
    expect(read).toEqual({ ...STANDING_RULES, ladderDays: [...STANDING_RULES.ladderDays] });
    const values = await apiDb.execute<{ value: string }>(sql`select unnest(enum_range(null::action_kind))::text as value`);
    // 3f: the migration orders adds an order's measure and its reversal after them, and since Task 3 they are the last two of
    // 3f's ACTION_KINDS; 2d Task 4 (0052_avatar_kinds) appends the reset of a profile picture and its reversal after those.
    expect(values.map((v) => v.value)).toEqual([...ACTION_KINDS]);
    expect(ACTION_KINDS.slice(-4, -2)).toEqual([...ORDER_ACTION_KINDS]);
  });

  // ---------------------------------------------------------------- invariant 4: a strike exactly when one is due

  describe("a decision holds a strike exactly when the database says one is due (invariant 4)", () => {
    test("strike_due over its table: a post case on a korbat rule other than R2 and no suspect item, once a post, never before the newest strike was told", async () => {
      await inWorld(async (tx) => {
        const author = await profile(tx);
        const first = await postCase(tx, author.id, 0);
        const due = (caseId: string, g: "incompatible" | "illegal" | null, rule: string | null, suspect = false) =>
          tx.execute<{ due: boolean }>(sql`select public.strike_due(${caseId}::uuid, ${g}::decision_ground, ${rule}::text, ${suspect}, null) as due`).then((r) => r[0]!.due);
        expect(await due(first.caseId, "incompatible", "R1")).toBe(true);
        // The ground, the rule and the suspicion.
        expect(await due(first.caseId, "illegal", null)).toBe(false);
        expect(await due(first.caseId, "incompatible", "R2")).toBe(false);
        expect(await due(first.caseId, "incompatible", "R1", true)).toBe(false);
        expect(await due(first.caseId, null, null)).toBe(false);
        // An account case never gives one.
        expect(await due(await accountCase(tx, author.id), "incompatible", "R1")).toBe(false);
        // Once given, the post carries it: no second strike for it, in this case or another.
        const struck = await decideIn(tx, admin, first.caseId, { kind: "final", actions: [act("remove")] });
        expect((await actionsOf(tx, struck)).map((a) => [a.kind, a.no_effect])).toEqual([
          ["remove", null],
          ["strike", null],
        ]);
        const again = (await intake(tx, ground.finding(admin.id, "R3"), aPost(first.postId))).items[0]!.caseId!;
        expect(await due(again, "incompatible", "R3")).toBe(false);
        // A post written before its author was told of their newest strike gets none; one written after does.
        expect(await due((await postCase(tx, author.id, null)).caseId, "incompatible", "R1")).toBe(false);
        expect(await due((await postCase(tx, author.id, 1)).caseId, "incompatible", "R1")).toBe(true);
        // leave_out leaves a decision's own strike out of both reads: the commit's own question.
        const [own] = await tx.execute<{ due: boolean }>(sql`select public.strike_due(${again}::uuid, 'incompatible', 'R3', false, ${struck}::uuid) as due`);
        expect(own!.due).toBe(true);
      });
    });

    test("a strike counts also when every other measure changed nothing: a deleted post", async () => {
      await inWorld(async (tx) => {
        const author = await profile(tx);
        const { postId, caseId } = await postCase(tx, author.id, 0);
        await tx.execute(sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${postId}::uuid`);
        const decision = await decideIn(tx, admin, caseId, { kind: "final", actions: [act("remove")] });
        expect((await actionsOf(tx, decision)).map((a) => [a.kind, a.no_effect])).toEqual([
          ["remove", "deleted"],
          ["strike", null],
        ]);
        expect(await activeStrikes(tx, author.id)).toBe(1);
      });
    });

    test("strike_mismatch at commit for a missing strike and for one that is not due; a strike out of place is refused at insert", async () => {
      await inWorld(async (tx) => {
        const author = await profile(tx);
        const { postId, caseId } = await postCase(tx, author.id, 0);
        expect(await refusal(decideIn(tx, admin, caseId, { kind: "final", actions: [act("remove")], strike: false }))).toBe("strike_mismatch");
        await decideIn(tx, admin, caseId, { kind: "final", actions: [act("remove")] });
        // The post is struck: a second decision about it that signs a strike is refused.
        const again = (await intake(tx, ground.finding(admin.id, "R3"), aPost(postId))).items[0]!.caseId!;
        expect(await refusal(decideIn(tx, admin, again, { kind: "final", ruleId: "R3", actions: [act("remove")], strike: true }))).toBe("strike_mismatch");
        expect(await refusal(decideIn(tx, admin, again, { kind: "final", ruleId: "R3", actions: [act("remove")] }))).toBeNull();
        // On the law, under R2 and while deciding no strike stands; nor on an account case, nor as the only measure.
        const other = await postCase(tx, author.id, 5);
        expect(await rawRows(tx, other.caseId, { kind: "interim" }, [act("withhold"), act("strike")])).toBe("invalid_decision");
        expect(await refusalDetail(decideIn(tx, admin, other.caseId, { kind: "final", actions: [], strike: true }))).toMatch(/^restricted: /);
        expect(await refusal(onAccount(tx, author.id, "R1", [act("reset_bio"), act("strike")]))).toBe("invalid_decision");
      });
    });

    test("the fixture's strikeDueFor, the console's question, agrees with what the commit accepts", async () => {
      await inWorld(async (tx) => {
        const author = await profile(tx);
        const { caseId } = await postCase(tx, author.id, 0);
        const [c] = await tx.execute<{ intake_seq: number }>(sql`select intake_seq from cases where id = ${caseId}::uuid`);
        expect(await strikeDueFor(tx, caseId, "incompatible", "R4", c!.intake_seq)).toBe(true);
        expect(await strikeDueFor(tx, caseId, "incompatible", "R2", c!.intake_seq)).toBe(false);
      });
    });
  });

  // ---------------------------------------------------------------- invariant 5: a strike falls only whole

  describe("a strike falls only with its whole finding, and stops counting in that transaction (invariant 5)", () => {
    test("overrule only in a review or correction that reverses; a full reversal without it, and a reversal in part that leaves only the strike, are refused", async () => {
      await inWorld(async (tx) => {
        const author = await profile(tx);
        const { postId, caseId } = await postCase(tx, author.id, 0);
        const imageA = await newImageRow(tx, author.id, postId, 0);
        const imageB = await newImageRow(tx, author.id, postId, 1);
        const removal = await decideIn(tx, admin, caseId, { kind: "final", actions: [act("remove_media", imageA), act("remove_media", imageB)] });
        const correct = (outcome: "reversed" | "partly_reversed", actions: DecisionInput["actions"], overrule = false) =>
          refusalDetail(decideIn(tx, admin, caseId, { kind: "correction", reviewsDecisionId: removal, outcome, actions, overrule }));
        // An overruling in a reversal in part: the params' schema refuses it, and below it the trigger does.
        expect(await rawRows(tx, caseId, { kind: "correction", reviewsDecisionId: removal, outcome: "partly_reversed" }, [act("overrule"), act("restore_media", imageA)])).toBe("invalid_decision");
        expect(await correct("reversed", [act("restore_media", imageA), act("restore_media", imageB)])).toMatch(/^reversed: a measure of the reviewed decision is still in force/);
        expect(await correct("partly_reversed", [act("restore_media", imageA), act("restore_media", imageB)])).toMatch(/^partly_reversed: .*but its strike/);
        // In a decision that is no review or correction an overruling has no place.
        expect(await rawRows(tx, (await postCase(tx, author.id, 5)).caseId, { kind: "final" }, [act("remove"), act("overrule")])).toBe("invalid_decision");
        // Reversed whole, with its overruling: the strike stops counting before the commit, and its row stays.
        expect(await activeStrikes(tx, author.id)).toBe(1);
        expect(await correct("reversed", [act("restore_media", imageA), act("restore_media", imageB)], true)).toBeNull();
        expect(await activeStrikes(tx, author.id)).toBe(0);
        expect((await actionsOf(tx, removal)).map((a) => a.kind)).toContain("strike");
      });
    });

    test("a review that reverses the decision overrules its strike, and one that keeps it keeps the strike", async () => {
      await inWorld(async (tx) => {
        const author = await profile(tx);
        const kept = await strikeIn(tx, author.id, 0);
        const reversed = await strikeIn(tx, author.id, 1);
        await appealOf(tx, kept, author.id);
        await appealOf(tx, reversed, author.id);
        expect(await refusal(reviewIn(tx, mod, kept))).toBeNull();
        expect(await refusalDetail(reviewIn(tx, mod, reversed, { actions: [act("restore")], overrule: false }))).toMatch(/^reversed: a measure of the reviewed decision is still in force/);
        expect(await refusal(reviewIn(tx, mod, reversed, { actions: [act("restore")] }))).toBeNull();
        expect(await activeStrikes(tx, author.id)).toBe(1);
      });
    });
  });

  // ---------------------------------------------------------------- invariant 13: staff

  test("no measure of 3e reaches a staff account: each of the six is refused staff_target (invariant 13)", async () => {
    await inWorld(async (tx) => {
      // A post of the moderator's own, struck: the strike's own row meets the rule when it is the decision's only one.
      const { caseId } = await postCase(tx, mod.id, 0);
      expect(await refusal(decideIn(tx, admin, caseId, { kind: "final", actions: [], strike: true }))).toBe("staff_target");
      for (const actions of [[timed("suspend", 3, true)], [timed("terminate", null, true)], [act("retire_handle")], [act("warn_reporting")], [timed("restrict_reporting", 3, false)]]) {
        expect(await refusal(onAccount(tx, mod.id, "R6", actions)), actions[0]!.kind).toBe("staff_target");
      }
    });
  });

  // ---------------------------------------------------------------- invariant 6: the ladder

  describe("the ladder is the database's (invariant 6)", () => {
    test("an announced suspension needs three active strikes, takes the rung's days at most, cites the newest strike's rule, and rests on the strikes, forced", async () => {
      await inWorld(async (tx) => {
        const account = await profile(tx);
        const strikes = [await strikeIn(tx, account.id, 0), await strikeIn(tx, account.id, 1)];
        expect(await refusalDetail(onAccount(tx, account.id, "R1", [timed("suspend", 3, true)]))).toMatch(/^basis: none fits/);
        strikes.push(await strikeIn(tx, account.id, 2));
        // More than the first rung is refused; a shorter one is allowed and still a step.
        expect(await refusalDetail(onAccount(tx, account.id, "R1", [timed("suspend", STANDING_RULES.ladderDays[0] + 1, true)]))).toMatch(/^days: at most 3 on the basis strikes/);
        // Taken at once, a step of the ladder fits no row.
        expect(await refusalDetail(onAccount(tx, account.id, "R1", [timed("suspend", 3, false)]))).toMatch(/^basis: none fits/);
        const decision = await onAccount(tx, account.id, "R1", [timed("suspend", 1, true)]);
        const row = await rowOf(tx, decision, "suspend");
        expect(row).toMatchObject({ days: 1, announced: true, basis: "strikes", replaced: null, ends_at: null });
        // The three strikes were decided in this one transaction, at one time: their order among themselves is the ids'.
        expect([...(row.rests_on as string[])].sort()).toEqual([...strikes].sort());
        // The earliest start is the decision plus the reply window: nothing is restricted yet.
        const [d] = await tx.execute<{ ok: boolean }>(
          sql`select a.starts_at = d.decided_at + make_interval(hours => ${STANDING_RULES.replyWindowHours}::int) as ok from decision_actions a join decisions d on d.id = a.decision_id where a.id = ${row.id}::uuid`,
        );
        expect(d!.ok).toBe(true);
        expect(await columns(tx, account.id)).toEqual({ from: null, until: null, restricted: null });
        expect(await liveRows(tx, account.id)).toBe(1);
        // Any moderator may announce one: the decision does not need an admin.
        expect((await decisionRow(tx, decision)).needs_admin).toBe(false);
      });
    });

    test("what the database forces is the database's: the API role cannot change a ledger row afterwards", async () => {
      await inWorld(async (tx) => {
        const account = await profile(tx);
        for (const minutes of [0, 1, 2]) await strikeIn(tx, account.id, minutes);
        const decision = await onAccount(tx, account.id, "R1", [timed("suspend", 3, true)]);
        const row = await rowOf(tx, decision, "suspend");
        expect(row.basis).toBe("strikes");
        expect(await refusal(tx.transaction((sp) => sp.execute(sql`update decision_actions set basis = 'flood' where id = ${row.id}::uuid`)))).toMatch(/^42501/);
      });
    });

    test("a ladder measure answers findings only: refused while its decision answers a user's report (open_reports)", async () => {
      await inWorld(async (tx) => {
        const account = await profile(tx);
        for (const minutes of [0, 1, 2]) await strikeIn(tx, account.id, minutes);
        expect(await refusalDetail(onAccount(tx, account.id, "R1", [timed("suspend", 3, true)], admin, "report"))).toBe("open_reports");
      });
    });
  });

  // ---------------------------------------------------------------- invariants 7 and 8: a broken basis, one at a time

  /** The case of a decision. */
  const caseOfDecision = async (tx: DbTx, decisionId: string) => (await tx.execute<{ case_id: string }>(sql`select case_id from decisions where id = ${decisionId}::uuid`))[0]!.case_id;

  describe("a suspension ends by derivation when its basis breaks, and one stands at a time (invariants 7 and 8)", () => {
    test("overruling one of three strikes clears the columns in that transaction, answers the waiting reply, and leaves no kept answer possible", async () => {
      await inWorld(async (tx) => {
        const account = await profile(tx);
        const strikes = [await strikeIn(tx, account.id, 0), await strikeIn(tx, account.id, 1), await strikeIn(tx, account.id, 2)];
        const announcing = await onAccount(tx, account.id, "R1", [timed("suspend", 3, true)]);
        // The relay accepted the notice: the start is fixed, and the columns are written.
        await tx.execute(sql`update decisions set author_mail = 'sent' where id = ${announcing}::uuid`);
        expect((await columns(tx, account.id)).from).not.toBeNull();
        // A reply filed before the start holds it.
        const suspend = await rowOf(tx, announcing, "suspend");
        await tx.execute(sql`insert into suspension_replies (action_id, account_id) values (${suspend.id}::uuid, ${account.id}::uuid)`);
        const [reply] = await tx.execute<{ on_time: boolean; answered_by: string | null }>(sql`select on_time, answered_by from suspension_replies where action_id = ${suspend.id}::uuid`);
        expect(reply).toEqual({ on_time: true, answered_by: null });
        expect(await columns(tx, account.id)).toEqual({ from: null, until: null, restricted: null });
        // One strike overruled with its whole finding: fewer than three stand, so the basis breaks now.
        const correction = await decideIn(tx, admin, await caseOfDecision(tx, strikes[1]!), { kind: "correction", reviewsDecisionId: strikes[1]!, actions: [act("restore")] });
        expect(await liveRows(tx, account.id)).toBe(0);
        expect(await columns(tx, account.id)).toEqual({ from: null, until: null, restricted: null });
        const [basis] = await tx.execute<{ broken: string | null }>(sql`select public.standing_basis_broken_at(${suspend.id}::uuid)::text as broken`);
        expect(basis!.broken).not.toBeNull();
        expect((await tx.execute<{ answered_by: string | null }>(sql`select answered_by from suspension_replies where action_id = ${suspend.id}::uuid`))[0]!.answered_by).toBe(correction);
        // No reply is left to answer: a kept correction of the suspension is refused.
        expect(await refusal(decideIn(tx, admin, await caseOfDecision(tx, announcing), { kind: "correction", reviewsDecisionId: announcing, outcome: "kept", actions: [] }))).toBe("invalid_decision");
      });
    });

    test("a reversed R5 decision ends the threat suspension at once that rests on it", async () => {
      await inWorld(async (tx) => {
        const account = await profile(tx);
        const threat = await strikeIn(tx, account.id, 0, "R5");
        const suspension = await onAccount(tx, account.id, "R5", [timed("suspend", 30, false)]);
        expect(await rowOf(tx, suspension, "suspend")).toMatchObject({ basis: "threat", rests_on: [threat], days: 30, announced: false });
        const running = await columns(tx, account.id);
        expect(running.from).not.toBeNull();
        expect(running.until).not.toBeNull();
        await decideIn(tx, admin, await caseOfDecision(tx, threat), { kind: "correction", reviewsDecisionId: threat, actions: [act("restore")] });
        expect(await columns(tx, account.id)).toEqual({ from: null, until: null, restricted: null });
        expect(await liveRows(tx, account.id)).toBe(0);
      });
    });

    test("standing_conflict while one stands, one with no start included; accepted after a lift; replaced only for an announced one not started", async () => {
      await inWorld(async (tx) => {
        const account = await profile(tx);
        for (const minutes of [0, 1, 2]) await strikeIn(tx, account.id, minutes);
        const announcing = await onAccount(tx, account.id, "R1", [timed("suspend", 3, true)]);
        expect(await refusal(onAccount(tx, account.id, "R1", [timed("suspend", 3, true)]))).toBe("standing_conflict");
        // A lift signed replaced: the announced suspension had not started, so it is a withdrawal for another measure. Only an
        // admin withdraws (3e design, sections 7.6 step 12 and 8.7; the review's access5): a moderator's is admin_required.
        expect(
          await refusal(decideIn(tx, mod, await caseOfDecision(tx, announcing), { kind: "correction", reviewsDecisionId: announcing, actions: [act("lift_suspension")], replaced: true })),
        ).toBe("admin_required");
        const withdrawal = await decideIn(tx, admin, await caseOfDecision(tx, announcing), { kind: "correction", reviewsDecisionId: announcing, actions: [act("lift_suspension")], replaced: true });
        expect(await rowOf(tx, withdrawal, "lift_suspension")).toMatchObject({ replaced: true });
        expect(await liveRows(tx, account.id)).toBe(0);
        // A measure at once that runs: its lift cannot be a withdrawal.
        const threat = await strikeIn(tx, account.id, 3, "R5");
        const atOnce = await onAccount(tx, account.id, "R5", [timed("suspend", 7, false)]);
        expect(await rowOf(tx, atOnce, "suspend")).toMatchObject({ basis: "threat", rests_on: [threat] });
        const atOnceCase = await caseOfDecision(tx, atOnce);
        expect(await refusalDetail(decideIn(tx, admin, atOnceCase, { kind: "correction", reviewsDecisionId: atOnce, actions: [act("lift_suspension")], replaced: true }))).toMatch(/^replaced: /);
        expect(await refusal(decideIn(tx, admin, atOnceCase, { kind: "correction", reviewsDecisionId: atOnce, actions: [act("lift_suspension")] }))).toBeNull();
        expect(await columns(tx, account.id)).toEqual({ from: null, until: null, restricted: null });
      });
    });
  });

  // ---------------------------------------------------------------- invariant 9: measures at once, on the closed list

  test("a reporter is told that nothing changed only when nothing did: a reset that changed nothing beside a suspension at once that did is a measure that changed something", async () => {
    // 3e's review (access4, people4): the status line and the mail line read "It was already not shown ... nothing
    // changed now" from one expression, which looked at 3c's seven kinds only.
    await inWorld(async (tx) => {
      const [account, reporter] = [await profile(tx), await profile(tx)];
      await strikeIn(tx, account.id, 0, "R5");
      const recorded = await intake(tx, ground.rule(reporter.id, "R5"), anAccount(account.id, account.handle));
      const caseId = recorded.items[0]!.caseId!;
      // The bio is empty already, so its reset changes nothing; the suspension starts at once.
      const decision = await decideIn(tx, admin, caseId, { kind: "final", ruleId: "R5", actions: [act("reset_bio"), timed("suspend", 7, false)] });
      expect((await actionsOf(tx, decision)).map((a) => [a.kind, a.no_effect])).toEqual([
        ["reset_bio", "already"],
        ["suspend", null],
      ]);
      expect((await noticeItems(tx, recorded.intakeId)).map((item) => item.noEffect)).toEqual([false]);
      // The reset alone, in another case of the account: it changed nothing, and the reporter is told so.
      const other = await intake(tx, ground.rule((await profile(tx)).id, "R1"), anAccount(account.id, account.handle));
      await decideIn(tx, admin, other.items[0]!.caseId!, { kind: "final", ruleId: "R1", actions: [act("reset_bio")] });
      expect((await noticeItems(tx, other.intakeId)).map((item) => item.noEffect)).toEqual([true]);
    });
  });

  describe("taken at once only on the closed list, only by an admin (invariant 9)", () => {
    test("threat: accepted on a final R5 decision about a post of the account that stands; refused without one, after its reversal, and for a moderator", async () => {
      await inWorld(async (tx) => {
        const account = await profile(tx);
        expect(await refusalDetail(onAccount(tx, account.id, "R5", [timed("suspend", 3, false)]))).toMatch(/^basis: none fits/);
        const threat = await strikeIn(tx, account.id, 0, "R5");
        expect(await refusal(onAccount(tx, account.id, "R5", [timed("suspend", 3, false)], mod))).toBe("admin_required");
        expect(await refusal(onAccount(tx, account.id, "R5", [timed("suspend", STANDING_RULES.threatDays, false)]))).toBeNull();
        await decideIn(tx, admin, await caseOfDecision(tx, threat), { kind: "correction", reviewsDecisionId: threat, actions: [act("restore")] });
        expect(await refusalDetail(onAccount(tx, account.id, "R5", [timed("suspend", 3, false)]))).toMatch(/^basis: none fits/);
      });
    });

    test("terrorist content: a decision on the law with the keyword about a post of the account; any other measure on the law is refused", async () => {
      await inWorld(async (tx) => {
        const account = await profile(tx);
        const postId = await newPostRow(tx, account.id);
        const notifier = await profile(tx);
        const postCaseId = (await intake(tx, ground.illegal(notifier.id), aPost(postId))).items[0]!.caseId!;
        const found = await decideIn(tx, admin, postCaseId, { kind: "final", ground: "illegal", categoryKeyword: "KEYWORD_TERRORIST_CONTENT", actions: [act("remove")] });
        // A decision on the law alone gives no strike.
        expect((await actionsOf(tx, found)).map((a) => a.kind)).toEqual(["remove"]);
        const onLaw = async (actions: DecisionInput["actions"], keyword: "KEYWORD_TERRORIST_CONTENT" | null) => {
          const caseId = (await intake(tx, ground.illegal((await profile(tx)).id), anAccount(account.id))).items[0]!.caseId!;
          return refusalDetail(decideIn(tx, admin, caseId, { kind: "final", ground: "illegal", categoryKeyword: keyword, actions }));
        };
        expect(await onLaw([timed("suspend", 3, true)], "KEYWORD_TERRORIST_CONTENT")).toMatch(/^basis: on the law only/);
        expect(await onLaw([timed("suspend", 3, false)], null)).toMatch(/^basis: on the law only/);
        expect(await onLaw([timed("suspend", STANDING_RULES.terroristDays, false)], "KEYWORD_TERRORIST_CONTENT")).toBeNull();
      });
    });

    test("flood: 19 posts in the hour are no floor, 20 are; up to floodDays days", async () => {
      await inWorld(async (tx) => {
        const account = await profile(tx);
        for (let i = 0; i < STANDING_RULES.floodPosts - 1; i++) await newPostRow(tx, account.id, { createdAt: sql`now()` });
        expect(await refusalDetail(onAccount(tx, account.id, "R6", [timed("suspend", 3, false)]))).toMatch(/^basis: none fits/);
        await newPostRow(tx, account.id, { createdAt: sql`now()` });
        expect(await refusalDetail(onAccount(tx, account.id, "R6", [timed("suspend", STANDING_RULES.floodDays + 1, false)]))).toMatch(/^days: at most 7 on the basis flood/);
        const decision = await onAccount(tx, account.id, "R6", [timed("suspend", STANDING_RULES.floodDays, false)]);
        expect(await rowOf(tx, decision, "suspend")).toMatchObject({ basis: "flood", rests_on: null });
      });
    });

    test("protective: on a seal for good of the account's images, once for that seal, never in the decision that seals, never a termination", async () => {
      await inWorld(async (tx) => {
        const account = await profile(tx);
        const postId = await newPostRow(tx, account.id);
        await newImageRow(tx, account.id, postId, 0);
        // No seal: refused; a termination under R2 is never established.
        const findingR2 = async () => (await intake(tx, ground.finding(admin.id, "R2"), anAccount(account.id))).items[0]!.caseId!;
        const caseId = await findingR2();
        expect(await refusalDetail(decideIn(tx, admin, caseId, { kind: "final", ruleId: "R2", actions: [timed("suspend", 3, false)] }))).toMatch(/^basis: under R2/);
        expect(await refusal(decideIn(tx, admin, caseId, { kind: "final", ruleId: "R2", actions: [timed("terminate", null, false)] }))).toBe("ground_not_established");
        // A seal taken while deciding is not enough; a seal and a suspension in one decision are refused.
        await decideIn(tx, admin, caseId, { kind: "interim", ruleId: "R2", actions: [act("seal_media")] });
        expect(await refusalDetail(decideIn(tx, admin, caseId, { kind: "final", ruleId: "R2", actions: [timed("suspend", 3, false)] }))).toMatch(/^basis: under R2/);
        expect(await refusalDetail(decideIn(tx, admin, caseId, { kind: "final", ruleId: "R2", actions: [act("seal_media"), timed("suspend", 3, false)] }))).toMatch(/^A decision that seals/);
        // The seal for good closes the case; a new finding opens the account's next case, where the suspension is decided.
        const seal = await decideIn(tx, admin, caseId, { kind: "final", ruleId: "R2", actions: [act("seal_media")] });
        expect(await refusalDetail(decideIn(tx, admin, await findingR2(), { kind: "final", ruleId: "R2", actions: [timed("suspend", STANDING_RULES.protectiveDays + 1, false)] }))).toMatch(/^days: at most 14/);
        const protective = await decideIn(tx, admin, await findingR2(), { kind: "final", ruleId: "R2", actions: [timed("suspend", STANDING_RULES.protectiveDays, false)] });
        expect(await rowOf(tx, protective, "suspend")).toMatchObject({ basis: "protective", rests_on: [seal] });
        // Lifted by an admin's correction, it leaves the seal it rested on spent: a second needs a newer seal.
        await decideIn(tx, admin, await caseOfDecision(tx, protective), { kind: "correction", reviewsDecisionId: protective, actions: [act("lift_suspension")] });
        expect(await refusalDetail(decideIn(tx, admin, await findingR2(), { kind: "final", ruleId: "R2", actions: [timed("suspend", 3, false)] }))).toMatch(/^basis: under R2/);
      });
    });

    test("a lifted seal ends the protective suspension that rests on it", async () => {
      await inWorld(async (tx) => {
        const account = await profile(tx);
        const postId = await newPostRow(tx, account.id);
        await newImageRow(tx, account.id, postId, 0);
        const findingR2 = async () => (await intake(tx, ground.finding(admin.id, "R2"), anAccount(account.id))).items[0]!.caseId!;
        const seal = await decideIn(tx, admin, await findingR2(), { kind: "final", ruleId: "R2", actions: [act("seal_media")] });
        await decideIn(tx, admin, await findingR2(), { kind: "final", ruleId: "R2", actions: [timed("suspend", 7, false)] });
        expect((await columns(tx, account.id)).from).not.toBeNull();
        await decideIn(tx, admin, await caseOfDecision(tx, seal), { kind: "correction", reviewsDecisionId: seal, actions: [act("unseal_media")] });
        expect(await columns(tx, account.id)).toEqual({ from: null, until: null, restricted: null });
        expect(await liveRows(tx, account.id)).toBe(0);
      });
    });
  });

  // ---------------------------------------------------------------- invariant 11: the start

  describe("an announced suspension never starts before its earliest start, and the API role cannot move it (invariant 11)", () => {
    /** An announced suspension of a new account on three strikes, and its ledger row. */
    async function announced(tx: DbTx) {
      const account = await profile(tx);
      for (const minutes of [0, 1, 2]) await strikeIn(tx, account.id, minutes);
      const decision = await onAccount(tx, account.id, "R1", [timed("suspend", 3, true)]);
      return { account, decision, row: await rowOf(tx, decision, "suspend") };
    }
    const period = async (tx: DbTx, actionId: string) =>
      (await tx.execute<{ starts: string; ends: string; from_start: number; from_created: number }>(
        sql`select p.starts_at::text as starts, p.ends_at::text as ends, extract(epoch from p.starts_at - a.starts_at)::float8 as from_start,
                   extract(epoch from p.starts_at - a.created_at)::float8 as from_created
              from suspension_periods p join decision_actions a on a.id = p.action_id where p.action_id = ${actionId}::uuid`,
      ))[0];

    test("no start while the mail is pending; sent: the relay's acceptance plus the window, never before starts_at; the API role cannot move or un-send it", async () => {
      await inWorld(async (tx) => {
        const s = await announced(tx);
        expect(await period(tx, s.row.id)).toBeUndefined();
        expect(await decisionRow(tx, s.decision)).toMatchObject({ author_mail: "pending" });
        // pending to a state other than the three, and a time chosen by the API, are refused.
        const update = (set: ReturnType<typeof sql>) => refusal(tx.transaction((sp) => sp.execute(sql`update decisions set ${set} where id = ${s.decision}::uuid`)));
        expect(await update(sql`author_mail = 'none'`)).toMatch(/^42501/);
        expect(await update(sql`author_mail_at = now() - interval '1 day'`)).toMatch(/^42501/);
        // Sent, with a time in the past supplied: the database writes its own.
        expect(await update(sql`author_mail = 'sent', author_mail_at = now() - interval '30 days'`)).toBeNull();
        const [mail] = await tx.execute<{ ok: boolean }>(sql`select author_mail_at = now() as ok from decisions where id = ${s.decision}::uuid`);
        expect(mail!.ok).toBe(true);
        const p = await period(tx, s.row.id);
        expect(p!.from_start).toBe(0);
        expect(p!.from_created).toBe(STANDING_RULES.replyWindowHours * 3600);
        expect((await columns(tx, s.account.id)).from).not.toBeNull();
        // Never again: a second change of the state or of its time.
        expect(await update(sql`author_mail = 'failed'`)).toMatch(/^42501/);
        expect(await update(sql`author_mail_at = now() + interval '1 day'`)).toMatch(/^42501/);
      });
    });

    test("failed: the decision plus the undelivered window; a mail given up later starts at the moment it was given up, never in the past", async () => {
      await inWorld(async (tx) => {
        const s = await announced(tx);
        await tx.execute(sql`update decisions set author_mail = 'failed' where id = ${s.decision}::uuid`);
        expect((await period(tx, s.row.id))!.from_created).toBe(STANDING_RULES.undeliveredHours * 3600);
      });
      // As the migrator, who alone may write a mail's time: an outcome recorded after the undelivered window is the start.
      await inWorld(async (tx) => {
        const s = await announced(tx);
        const late = STANDING_RULES.undeliveredHours + 24;
        await tx.execute(sql`update decisions set author_mail = 'failed', author_mail_at = now() + make_interval(hours => ${late}::int) where id = ${s.decision}::uuid`);
        expect((await period(tx, s.row.id))!.from_created).toBe(late * 3600);
      }, migrateDb);
    });

    test("an on-time reply holds the start; a kept answer before starts_at starts it at starts_at, one after starts_at at the answer", async () => {
      await inWorld(async (tx) => {
        const s = await announced(tx);
        await tx.execute(sql`update decisions set author_mail = 'sent' where id = ${s.decision}::uuid`);
        const caseId = await caseOfDecision(tx, s.decision);
        const drafted = await decisionParams(tx, admin, caseId, { kind: "correction", reviewsDecisionId: s.decision, outcome: "kept", actions: [] });
        await tx.execute(sql`insert into suspension_replies (action_id, account_id) values (${s.row.id}::uuid, ${s.account.id}::uuid)`);
        expect(await period(tx, s.row.id)).toBeUndefined();
        // A correction drafted before the reply is refused: the reply moved the case's version.
        expect(await refusal(decideWith(tx, admin, caseId, drafted))).toBe("case_changed");
        const kept = await decideIn(tx, admin, caseId, { kind: "correction", reviewsDecisionId: s.decision, outcome: "kept", actions: [] });
        expect(await decisionRow(tx, kept)).toMatchObject({ outcome: "kept", author_mail: "pending" });
        expect((await tx.execute<{ answered_by: string }>(sql`select answered_by from suspension_replies where action_id = ${s.row.id}::uuid`))[0]!.answered_by).toBe(kept);
        // The answer came before starts_at: the start is starts_at, never sooner for having replied.
        expect((await period(tx, s.row.id))!.from_start).toBe(0);
      });
      await inWorld(async (tx) => {
        const s = await announced(tx);
        await tx.execute(sql`insert into suspension_replies (action_id, account_id) values (${s.row.id}::uuid, ${s.account.id}::uuid)`);
        // The answer's time moved past starts_at, as only the migrator can: the start follows it.
        const answeredAt = sql`(select starts_at + interval '5 hours' from decision_actions where id = ${s.row.id}::uuid)`;
        await tx.execute(sql`update suspension_replies set answered_by = ${s.decision}::uuid, answered_at = ${answeredAt} where action_id = ${s.row.id}::uuid`);
        await tx.execute(sql`select public.standing_apply(${s.account.id}::uuid)`);
        expect((await period(tx, s.row.id))!.from_start).toBe(5 * 3600);
      }, migrateDb);
    });

    test("a reply is refused to another account's measure and once a reply exists", async () => {
      await inWorld(async (tx) => {
        const s = await announced(tx);
        const other = await profile(tx);
        const reply = (account: string) => refusal(tx.transaction((sp) => sp.execute(sql`insert into suspension_replies (action_id, account_id) values (${s.row.id}::uuid, ${account}::uuid)`)));
        expect(await reply(other.id)).toBe("reply_not_open");
        expect(await reply(s.account.id)).toBeNull();
        expect(await reply(s.account.id)).toBe("reply_not_open");
      });
    });
  });

  // ---------------------------------------------------------------- row 24: the R4 redaction never meets 3e's measures

  test("the R4 redaction's candidates name the four kinds of 3c and 2d's reset of a profile picture: a suspension that cites R4 is never a candidate, however final (row 24)", async () => {
    // The built text of the retention job and of the overview: REDACTABLE names exactly the four, and since 2d Task 4 the
    // reset of a profile picture, a field reset as the two of 3c (0053_avatar_moderation's redact_r4_body lists it too).
    const source = readFileSync(path.resolve(import.meta.dirname, "../../src/moderation/repo.ts"), "utf8");
    const redactable = source.slice(source.indexOf("const REDACTABLE = sql`"), source.indexOf("`;", source.indexOf("const REDACTABLE = sql`")));
    expect(redactable).toContain("m.kind in ('remove', 'remove_media', 'reset_bio', 'reset_display_name', 'reset_avatar')");
    await inWorld(async (tx) => {
      const account = await profile(tx);
      for (const minutes of [0, 1, 2]) await strikeIn(tx, account.id, minutes, "R4");
      const suspension = await onAccount(tx, account.id, "R4", [timed("suspend", 3, true)]);
      // Final for its author long ago, as only the migrator can make it here.
      await tx.execute(sql`update decisions set informed_at = informed_at - interval '7 months', decided_at = decided_at - interval '7 months' where id = ${suspension}::uuid`);
      const [final] = await tx.execute<{ final: boolean }>(sql`select public.decision_final_at(${suspension}::uuid) < now() as final`);
      expect(final!.final).toBe(true);
      expect(await dueRedactions(tx)).not.toContain(suspension);
      expect(await refusal(tx.transaction((sp) => sp.execute(sql`select public.redact_r4_body(${suspension}::uuid)`)))).toBe("invalid_decision");
    }, migrateDb);
  });

  // ---------------------------------------------------------------- what needs the clock: committed, then moved back

  describe("over time: the rungs, a stale ladder, an old basis and a second threat (committed, with ageStandingForTest)", () => {
    let world: DeciderWorld;
    let boss: RealStaff;

    beforeAll(async () => {
      world = deciderWorld(apiDb);
      boss = await world.staff("admin");
    }, 120_000);
    afterAll(async () => {
      // closeDecisions and removeFixtures (the file's afterAll) remove the cases first; the staff profiles go last.
      await closeDecisions();
      await removeFixtures(migrateDb, committed.splice(0));
      await world.close();
    }, 120_000);

    /** An account committed for good until the end of the file. */
    async function committedAccount() {
      const account = await newProfile(apiDb);
      committed.push(account.id);
      return account;
    }
    /** A committed decision on the account's case below the routes' list, by the world's admin: its id. */
    async function commitOnAccount(accountId: string, rule: RuleId, actions: DecisionInput["actions"]): Promise<string> {
      const recorded = await intake(world.moderation.deps.apiDb, ground.finding(boss.id, rule), anAccount(accountId));
      const outcome = await world.decideAs(boss, recorded.items[0]!.caseId!, { kind: "final", ruleId: rule, actions }, { allKinds: true });
      if (typeof outcome === "string") throw new Error(`the decision was not recorded: ${outcome}`);
      return outcome.decisionId;
    }
    /**
     * What a decision on the account's case would answer now, inside a transaction that is rolled back: null when it
     * would stand, else the refusal's detail, or "no detail: " and its code for a refusal without one.
     */
    async function wouldDecide(accountId: string, rule: RuleId, actions: DecisionInput["actions"], staff: TestStaff = admin): Promise<string | null> {
      let answer: string | null = null;
      await inWorld(async (tx) => {
        try {
          await onAccount(tx, accountId, rule, actions, staff);
        } catch (err) {
          const detail = (err as { detail?: string | null }).detail ?? null;
          answer = detail ?? `no detail: ${err instanceof ModerationError ? err.code : String(err)}`;
        }
      });
      return answer;
    }
    const standingOf = async (accountId: string) =>
      (await apiDb.execute<{ running: boolean; live: number }>(
        sql`select coalesce(p.suspended_from <= clock_timestamp() and clock_timestamp() < p.suspended_until, false) as running,
                   (select count(*)::int from standing_live s where s.account_id = p.id) as live
              from profiles p where p.id = ${accountId}::uuid`,
      ))[0]!;

    test("a suspension of the ladder runs from the relay's acceptance plus the window, ends by the clock, and its rung needs a newer strike", async () => {
      const account = await committedAccount();
      const strikes = await strikeForTest(apiDb, account.id, 3);
      const first = await commitOnAccount(account.id, "R1", [timed("suspend", 3, true)]);
      expect(await standingOf(account.id)).toEqual({ running: false, live: 1 });
      // The relay accepted the notice, as the migrator records it here (the test's auth module sends nothing).
      await migrateDb.execute(sql`update decisions set author_mail = 'sent', author_mail_at = now() where id = ${first}::uuid`);
      await migrateDb.execute(sql`select public.standing_apply(${account.id}::uuid)`);
      expect(await standingOf(account.id)).toEqual({ running: false, live: 1 });
      // Eight days on: one day past the reply window, the suspension runs.
      await ageStandingForTest(migrateDb, account.id, "8 days");
      expect(await standingOf(account.id)).toEqual({ running: true, live: 1 });
      // Three more: its three days are over, and nothing was written at either moment but by ageStandingForTest.
      await ageStandingForTest(migrateDb, account.id, "3 days");
      expect(await standingOf(account.id)).toEqual({ running: false, live: 0 });
      // The strikes still count, but none is newer than the last step of the ladder: no next step.
      expect(await wouldDecide(account.id, "R1", [timed("suspend", 7, true)])).toMatch(/^basis: none fits/);
      // A new strike opens the second rung: at most its days.
      strikes.push(...(await strikeForTest(apiDb, account.id, 1)));
      expect(await wouldDecide(account.id, "R1", [timed("suspend", STANDING_RULES.ladderDays[1] + 1, true)])).toMatch(/^days: at most 7/);
      await inWorld(async (tx) => {
        const decision = await onAccount(tx, account.id, "R1", [timed("suspend", STANDING_RULES.ladderDays[1], true)]);
        expect((await rowOf(tx, decision, "suspend")).rests_on).toEqual(strikes);
      });
    }, 240_000);

    test("a step of the ladder cites the rule of the newest strike; with the newest under R5 it is still a step, never a ground at once", async () => {
      const account = await committedAccount();
      const strikes = [...(await strikeForTest(apiDb, account.id, 2)), ...(await strikeForTest(apiDb, account.id, 1, "R5"))];
      expect(await wouldDecide(account.id, "R1", [timed("suspend", 3, true)])).toMatch(/^basis: none fits/);
      expect(await wouldDecide(account.id, "R5", [timed("suspend", STANDING_RULES.threatDays, true)])).toMatch(/^days: at most 3 on the basis strikes/);
      await inWorld(async (tx) => {
        const decision = await onAccount(tx, account.id, "R5", [timed("suspend", 3, true)]);
        // Decided one after the other, the strikes are listed oldest first.
        expect(await rowOf(tx, decision, "suspend")).toMatchObject({ basis: "strikes", days: 3, rests_on: strikes });
      });
    }, 240_000);

    test("a threat's decision older than basis_age_days supports no suspension at once", async () => {
      const account = await committedAccount();
      await strikeForTest(apiDb, account.id, 1, "R5");
      expect(await wouldDecide(account.id, "R5", [timed("suspend", 3, false)])).toBeNull();
      await ageStandingForTest(migrateDb, account.id, `${STANDING_RULES.basisAgeDays + 1} days`);
      expect(await wouldDecide(account.id, "R5", [timed("suspend", 3, false)])).toMatch(/^basis: none fits/);
    }, 240_000);

    test("a termination at once needs a second threat, posted after the person was told of the suspension for the first, which has ended", async () => {
      const account = await committedAccount();
      const [firstThreat] = await strikeForTest(apiDb, account.id, 1, "R5");
      const suspension = await commitOnAccount(account.id, "R5", [timed("suspend", 1, false)]);
      expect(await standingOf(account.id)).toEqual({ running: true, live: 1 });
      // While it runs, no second standing measure; once it ended, none is in the way.
      expect(await wouldDecide(account.id, "R5", [timed("terminate", null, false)])).toBe("no detail: standing_conflict");
      await ageStandingForTest(migrateDb, account.id, "2 days");
      expect(await standingOf(account.id)).toEqual({ running: false, live: 0 });
      // An R5 decision about a post from before the suspension is no second threat.
      await inWorld(async (tx) => {
        const old = await postCase(tx, account.id, null, "R5");
        await decideIn(tx, admin, old.caseId, { kind: "final", ruleId: "R5", actions: [act("remove")] });
        expect(await refusalDetail(onAccount(tx, account.id, "R5", [timed("terminate", null, false)]))).toMatch(/^basis: none fits/);
      });
      const [secondThreat] = await strikeForTest(apiDb, account.id, 1, "R5");
      expect(await wouldDecide(account.id, "R5", [timed("terminate", null, false)], mod)).toBe("no detail: admin_required");
      await inWorld(async (tx) => {
        const termination = await onAccount(tx, account.id, "R5", [timed("terminate", null, false)]);
        expect(await rowOf(tx, termination, "terminate")).toMatchObject({ basis: "threat_repeat", rests_on: [firstThreat, secondThreat], days: null, announced: false });
        expect((await columns(tx, account.id)).until).toBe("infinity");
        // Either threat reversed ends it by derivation.
        await decideIn(tx, admin, await caseOfDecision(tx, secondThreat!), { kind: "correction", reviewsDecisionId: secondThreat!, actions: [act("restore")] });
        expect(await liveRows(tx, account.id)).toBe(0);
        expect(await columns(tx, account.id)).toEqual({ from: null, until: null, restricted: null });
      });
      expect(suspension).toBeTruthy();
    }, 240_000);
  });

  test("this file left no row behind", async () => {
    await closeDecisions();
    expect(await rowCounts(apiDb)).toEqual(before);
  }, 120_000);
});
