import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { REDRESS_TEXTS, STATEMENT_WORDS, statementParagraphs } from "@korbat/rules";
import { closeDb, createDb, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { authorCases, authorDecisionView, authorFacts } from "../../src/moderation/author";
import { ModerationError } from "../../src/moderation/context";
import { exportFor } from "../../src/moderation/export";
import { noticeItems } from "../../src/moderation/repo";
import { decisionStatement } from "../../src/moderation/statement";
import { closeDecisions, deciderWorld, strikeForTest, type DeciderWorld, type RealStaff } from "./moderation-decide";
import { aPost, act, actionsOf, anAccount, appealOf, ground, intake, newPostRow, removeFixtures, rowCounts, timed, type DecisionInput } from "./moderation-fixtures";
import { newProfile } from "./social-fixtures";

// Every test commits decisions confirmed with a real key, each a round of the step-up flow: slow on a loaded machine.
vi.setConfig({ testTimeout: 240_000 });

/**
 * Strikes through the decide and review routes (3e design, sections 7.4, 7.11 and 7.12; section 12.1, invariants 4, 5 and
 * 20 for the strike). Each decision is confirmed as the console confirms one, with a staff key on the software
 * authenticator, and recorded by the moderation module's own decide and review, which the staff routes run: the params
 * are the console's, signing the strike the case answer says is due. The author's surfaces (the list of decisions, one
 * decision, the chip, the export and the statement) are read as the app reads them, and a reporter's line is compared with
 * and without a strike. What the file commits is removed in the end, and its last test holds it to that.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: strikes through the routes", () => {
  let apiDb: Db;
  let world: DeciderWorld;
  let admin: RealStaff;
  let reviewer: RealStaff;
  let before: Record<string, number>;
  /** The profiles this file made, removed with everything they hold at the end. */
  const made: string[] = [];

  beforeAll(async () => {
    apiDb = createDb(loadConfig().DATABASE_URL_API, { max: 4 });
    world = deciderWorld(apiDb);
    admin = await world.staff("admin");
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

  const deps = () => world.moderation.deps;
  async function account() {
    const profile = await newProfile(apiDb);
    made.push(profile.id);
    return profile;
  }
  /** A post of the author made now (or 30 days back), reported by someone under R1: the post, its case and the report. */
  async function reportedPost(authorId: string, made_now = true) {
    const postId = await newPostRow(apiDb, authorId, made_now ? { createdAt: sql`clock_timestamp()` } : {});
    const reporter = await account();
    const recorded = await intake(apiDb, ground.rule(reporter.id, "R1"), aPost(postId));
    return { postId, caseId: recorded.items[0]!.caseId!, intakeId: recorded.intakeId };
  }
  /** A confirmed decision through the route's code: its id, or the refusal's code. */
  async function decided(member: RealStaff, caseId: string, input: DecisionInput): Promise<string> {
    const outcome = await world.decideAs(member, caseId, input);
    if (typeof outcome === "string") throw new Error(`the decision was not recorded: ${outcome}`);
    return outcome.decisionId;
  }
  const refusedWith = async (promise: Promise<unknown>) => {
    try {
      await promise;
      return null;
    } catch (err) {
      return err instanceof ModerationError ? err.code : String(err);
    }
  };
  const caseRead = (caseId: string) => world.moderation.forStaff.caseView(admin.session, caseId);

  test("a final removal under a rule signs the strike the case answer says is due; a missing or an undue strike is refused at commit (strike_mismatch)", async () => {
    const author = await account();
    const first = await reportedPost(author.id);
    const view = await caseRead(first.caseId);
    expect(view.strikeDue).toEqual({ due: true, why: "due" });
    expect(view.authorStanding).toEqual({ activeStrikes: "0", suspensionsInYear: "0", now: "none" });
    expect(view.standing).toBeNull();
    // The console signs what the answer says; anything else is refused when the decision commits.
    expect(await refusedWith(world.decideAs(admin, first.caseId, { kind: "final", actions: [act("remove")], strike: false }))).toBe("strike_mismatch");
    const removal = await decided(admin, first.caseId, { kind: "final", actions: [act("remove")] });
    expect((await actionsOf(apiDb, removal)).map((a) => a.kind)).toEqual(["remove", "strike"]);
    const after = await world.moderation.forStaff.decidedCase(admin.session, first.caseId);
    expect(after.strikeDue).toEqual({ due: false, why: "already_struck" });
    expect(after.authorStanding).toEqual({ activeStrikes: "1", suspensionsInYear: "0", now: "none" });
    const strike = after.decisions.find((d) => d.id === removal)!.actions.find((a) => a.kind === "strike")!;
    expect(strike).toMatchObject({ inForce: true, countsUntil: expect.any(String), days: null, announced: null, basis: null, period: null });
    // A post made before the author was told of the strike gets none, and one that signs one is refused.
    const older = await reportedPost(author.id, false);
    expect((await caseRead(older.caseId)).strikeDue).toEqual({ due: false, why: "before_last_strike" });
    expect(await refusedWith(world.decideAs(admin, older.caseId, { kind: "final", actions: [act("remove")], strike: true }))).toBe("strike_mismatch");
    expect((await actionsOf(apiDb, await decided(admin, older.caseId, { kind: "final", actions: [act("remove")] }))).map((a) => a.kind)).toEqual(["remove"]);
  });

  test("the routes accept 3c's kinds, a strike and its overruling, a handle's retirement and its reversal, and a suspension at once with its lift, and nothing else yet: other kinds, a kept correction, marks and a withdrawal are refused", async () => {
    const author = await account();
    const post = await reportedPost(author.id);
    const removal = await decided(admin, post.caseId, { kind: "final", actions: [act("remove")] });
    const accountCase = (await intake(apiDb, ground.finding(admin.id, "R6"), anAccount(author.id))).items[0]!.caseId!;
    // 3e Task 3 opened a suspension taken at once and its lift (standing-at-once.test.ts); a termination and an announced
    // suspension stay closed, refused by the route before the transaction.
    expect(await refusedWith(world.decideAs(admin, accountCase, { kind: "final", ruleId: "R6", actions: [timed("terminate", null, false)] }))).toBe("invalid_decision");
    expect(await refusedWith(world.decideAs(admin, accountCase, { kind: "final", ruleId: "R6", actions: [timed("suspend", 3, true)] }))).toBe("invalid_decision");
    // 3e Task 2 opened the retirement of a handle and its reversal (standing-handles.test.ts).
    expect(await refusedWith(world.decideAs(admin, post.caseId, { kind: "correction", reviewsDecisionId: removal, outcome: "kept", actions: [] }))).toBe("invalid_decision");
    expect(await refusedWith(world.decideAs(admin, accountCase, { kind: "final", outcome: "no_violation", actions: [], unfounded: [post.intakeId] }))).toBe("invalid_decision");
    await appealOf(apiDb, removal, author.id);
    expect(await refusedWith(world.reviewAs(reviewer, removal, { outcome: "reversed", actions: [act("lift_reporting")] }))).toBe("invalid_decision");
    // Nothing of these was stored: the case holds the removal alone.
    const decisions = await apiDb.execute<{ n: number }>(sql`select count(*)::int as n from decisions where case_id in (${post.caseId}::uuid, ${accountCase}::uuid)`);
    expect(decisions[0]!.n).toBe(1);
  });

  test("the author reads the strike: the list, the decision, the chip, the statement and the export; a correction that reverses the removal overrules it at once", async () => {
    const author = await account();
    const post = await reportedPost(author.id);
    const removal = await decided(admin, post.caseId, { kind: "final", actions: [act("remove")] });
    const page = await authorCases(deps(), author.id);
    expect(page.activeStrikes).toBe(1);
    const row = page.decisions.find((d) => d.id === removal)!;
    expect(row.actions).toEqual(["remove", "strike"]);
    expect(row.strike).toEqual({ countsUntil: expect.any(String), overruledAt: null });
    const countsUntil = row.strike!.countsUntil;
    expect((await authorDecisionView(deps(), author.id, removal)).strike).toEqual({ countsUntil, state: "counts", overruledAt: null });
    expect((await authorFacts(deps(), author.id, [post.postId])).get(post.postId)).toMatchObject({ decisionId: removal, strikeUntil: countsUntil });
    // The statement reads as it was sent: the strike, until when it counts, how many counted then, and the prior warning.
    const found = (await decisionStatement(apiDb, removal))!;
    expect(found.statement.measures.find((m) => m.kind === "strike")).toEqual({ kind: "strike", mediaId: null, noEffect: null, sealed: null, endsAt: countsUntil, activeThen: 1 });
    const paragraphs = statementParagraphs(found.statement);
    expect(paragraphs[1]).toContain("This decision gives your account a strike.");
    expect(paragraphs[1]).toContain(REDRESS_TEXTS[2].strikeNext);
    expect(paragraphs).toContain(STATEMENT_WORDS.automationStrike);
    expect((await exportFor(deps(), author.id)).strikes).toEqual([{ decisionId: removal, postId: post.postId, ruleId: "R1", givenAt: expect.any(String), countsUntil, overruledAt: null }]);

    // Reversed whole by a correction, with the overruling the console adds: the strike no longer counts, and says when.
    const correction = await decided(admin, post.caseId, { kind: "correction", reviewsDecisionId: removal, actions: [act("restore")] });
    expect((await actionsOf(apiDb, correction)).map((a) => a.kind)).toEqual(["overrule", "restore"]);
    const overruled = (await authorDecisionView(deps(), author.id, removal)).strike!;
    expect(overruled).toEqual({ countsUntil, state: "overruled", overruledAt: expect.any(String) });
    expect((await authorCases(deps(), author.id)).activeStrikes).toBe(0);
    expect((await exportFor(deps(), author.id)).strikes[0]!.overruledAt).toBe(overruled.overruledAt);
    expect(statementParagraphs((await decisionStatement(apiDb, correction))!.statement)).toContain(STATEMENT_WORDS.overruled);
    // The post is visible again: no chip.
    expect((await authorFacts(deps(), author.id, [post.postId])).get(post.postId)).toBeUndefined();
  });

  test("a review that reverses the removal overrules its strike; one that would leave the strike is refused", async () => {
    const author = await account();
    const post = await reportedPost(author.id);
    const removal = await decided(admin, post.caseId, { kind: "final", actions: [act("remove")] });
    await appealOf(apiDb, removal, author.id);
    expect(await refusedWith(world.reviewAs(reviewer, removal, { actions: [act("restore")], overrule: false }))).toBe("invalid_decision");
    const outcome = await world.reviewAs(reviewer, removal, { actions: [act("restore")] });
    if (typeof outcome === "string") throw new Error(`the review was not recorded: ${outcome}`);
    expect((await actionsOf(apiDb, outcome.decisionId)).map((a) => a.kind)).toEqual(["overrule", "restore"]);
    expect((await authorDecisionView(deps(), author.id, removal)).strike!.state).toBe("overruled");
  });

  test("a reporter's line is the same with and without a strike, also when the post was already deleted (invariant 20, T43)", async () => {
    // X has no strike, so the removal of X's post gives one; Y was told of a strike after writing the post, so its removal gives none.
    const [x, y] = [await account(), await account()];
    const xPost = await reportedPost(x.id);
    const yPost = await reportedPost(y.id, false);
    await decided(admin, (await reportedPost(y.id)).caseId, { kind: "final", actions: [act("remove")] });
    const xRemoval = await decided(admin, xPost.caseId, { kind: "final", actions: [act("remove")] });
    const yRemoval = await decided(admin, yPost.caseId, { kind: "final", actions: [act("remove")] });
    // X's next post is made after X was told of that strike, so its removal gives another; Y's again before.
    const xDeleted = await reportedPost(x.id);
    const yDeleted = await reportedPost(y.id, false);
    for (const deleted of [xDeleted, yDeleted]) await apiDb.execute(sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${deleted.postId}::uuid`);
    const xGone = await decided(admin, xDeleted.caseId, { kind: "final", actions: [act("remove")] });
    const yGone = await decided(admin, yDeleted.caseId, { kind: "final", actions: [act("remove")] });
    expect((await actionsOf(apiDb, xRemoval)).map((a) => a.kind)).toEqual(["remove", "strike"]);
    expect((await actionsOf(apiDb, yRemoval)).map((a) => a.kind)).toEqual(["remove"]);
    expect((await actionsOf(apiDb, xGone)).map((a) => [a.kind, a.no_effect])).toEqual([
      ["remove", "deleted"],
      ["strike", null],
    ]);
    expect((await actionsOf(apiDb, yGone)).map((a) => [a.kind, a.no_effect])).toEqual([["remove", "deleted"]]);
    // The daily release shows each sender the outcome; the line's facts are compared without the ids and the times.
    await apiDb.execute(sql`select public.release_outcomes(now())`);
    const line = async (intakeId: string) => (await noticeItems(apiDb, intakeId)).map(({ id: _id, targetId: _t, decidedOn: _d, until: _u, ...rest }) => rest);
    expect(await line(xPost.intakeId)).toEqual(await line(yPost.intakeId));
    expect(await line(xDeleted.intakeId)).toEqual(await line(yDeleted.intakeId));
    // The removal of a deleted post changed nothing anyone saw, and the line says so with the strike as without it.
    expect((await line(xDeleted.intakeId))[0]).toMatchObject({ shownOutcome: "restricted_rule", noEffect: true });
  });

  test("an account case's answer carries the account's standing: its strikes, the rung, and the report that holds the ladder back", async () => {
    const subject = await account();
    const strikes = await strikeForTest(apiDb, subject.id, 3, "R3");
    const reporter = await account();
    const caseId = (await intake(apiDb, ground.rule(reporter.id, "R3"), anAccount(subject.id))).items[0]!.caseId!;
    const view = await caseRead(caseId);
    expect(view.strikeDue).toBeNull();
    expect(view.authorStanding).toBeNull();
    expect(view.standing).toMatchObject({
      activeStrikes: 3,
      ladderRule: "R3",
      suspensionsInYear: 0,
      lastSuspendedOn: null,
      maxDays: 3,
      mayTerminate: false,
      live: false,
      openReports: true,
      atOnce: [],
      seal: null,
    });
    expect(view.standing!.strikes.map((s) => s.decisionId)).toEqual(strikes);
    expect(view.standing!.flood.posts).toBe(3);
  });

  test("a strike's row in its post case names the standing measures that rest on its decision, so that a review says so before the key is asked", async () => {
    const subject = await account();
    const strikes = await strikeForTest(apiDb, subject.id, 3, "R1");
    const caseOf = async (decisionId: string) =>
      (await apiDb.execute<{ id: string }>(sql`select case_id as id from decisions where id = ${decisionId}::uuid`))[0]!.id;
    const strikeRow = async (decisionId: string) =>
      (await caseRead(await caseOf(decisionId))).decisions.find((d) => d.id === decisionId)!.actions.find((a) => a.kind === "strike")!;
    expect((await strikeRow(strikes[0]!)).restedOnBy).toEqual([]);
    // A suspension announced on the ladder rests on the three strikes (the routes take it from Task 4 on; here the module's own decide).
    const accountCase = (await intake(apiDb, ground.finding(admin.id, "R1"), anAccount(subject.id))).items[0]!.caseId!;
    const outcome = await world.decideAs(admin, accountCase, { kind: "final", ruleId: "R1", actions: [timed("suspend", 3, true)] }, { allKinds: true });
    if (typeof outcome === "string") throw new Error(`the suspension was not recorded: ${outcome}`);
    for (const strike of strikes) expect((await strikeRow(strike)).restedOnBy).toEqual(["suspend"]);
    // Every other row carries null.
    const removal = (await caseRead(await caseOf(strikes[0]!))).decisions.find((d) => d.id === strikes[0])!.actions.find((a) => a.kind === "remove")!;
    expect(removal.restedOnBy).toBeNull();
  });

  test("this file left no row behind", async () => {
    await closeDecisions();
    await removeFixtures(world.migrateDb, made.splice(0));
    expect(await rowCounts(apiDb)).toEqual(before);
  }, 120_000);
});
