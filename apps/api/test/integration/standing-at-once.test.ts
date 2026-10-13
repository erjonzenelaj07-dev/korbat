import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { ACCOUNT_MEASURE_SCOPE, FlowResponse, MeResponse, STANDING_RULES, itemOutcomeWords } from "@korbat/contracts";
import { STATEMENT_WORDS, statementParagraphs } from "@korbat/rules";
import { MemoryKv } from "../../src/auth/kv";
import { randomToken } from "../../src/auth/crypto";
import { GRANT_ROLE_WORDS, runGrantRole } from "../../src/cli/grant-role";
import { MemoryMailer } from "../../src/mail/memory";
import { ModerationError } from "../../src/moderation";
import { updateLine } from "../../src/moderation/dispatch";
import { authorCases, authorDecisionView } from "../../src/moderation/author";
import { itemStatus } from "../../src/moderation/intake";
import { noticeItems, pendingOutcomeLines } from "../../src/moderation/repo";
import { decisionStatement } from "../../src/moderation/statement";
import { Browser } from "./http-client";
import { deciderWorld, type DeciderWorld, type RealStaff } from "./moderation-decide";
import { aPost, act, actionsOf, ageStandingForTest, anAccount, ground, imagePost, intake, newPostRow, report, timed, untilBlocked, type DecisionInput } from "./moderation-fixtures";
import { HUMAN, noticesWorld, type NoticesWorld } from "./notices-harness";

// Every test commits decisions confirmed with a real staff key, each a round of the step-up flow: slow on a loaded machine.
vi.setConfig({ testTimeout: 240_000 });

/**
 * Suspensions taken at once, through the decide route's own code (3e design, sections 7.7, 7.11, 7.12, 7.15 and 7.16; section
 * 12.1, invariants 9 but `terminate`, 13 and 20): each of the four grounds of the closed list accepted on its facts and
 * refused without them, by an admin only; the route's second check, which refuses an announced suspension and every
 * termination before the transaction; the lift and a basis that breaks, with their statements and mails; /api/me's
 * standing, read fresh; grant-role's refusal, against a deciding transaction in both orders; and the line a reporter
 * reads. The accounts are auth accounts with profiles, so the statement mails reach their addresses through the auth
 * module; every decision is confirmed by a staff key on the software authenticator and recorded by moderation.forStaff.
 * What the file commits is removed at the end, and its last test holds the tables to that.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: suspensions at once", () => {
  let n: NoticesWorld;
  let world: DeciderWorld;
  let admin: RealStaff;
  let second: RealStaff;
  let moderator: RealStaff;
  let before: Record<string, number>;

  beforeAll(async () => {
    n = noticesWorld();
    // The deciding module mails through the notices world's auth module, so the statements reach the scripted mailer.
    world = deciderWorld(n.apiDb, { auth: n.authForModeration });
    admin = await world.staff("admin");
    second = await world.staff("admin");
    moderator = await world.staff("moderator");
    before = await n.counts();
  }, 240_000);
  afterAll(async () => {
    try {
      await n.cleanUp();
      await world.close();
    } finally {
      await n.close();
    }
  }, 240_000);

  /** A post of the account made now, in a statement of its own, so that it is later than every decision before it. */
  const postOf = (accountId: string) => newPostRow(n.apiDb, accountId, { createdAt: sql`clock_timestamp()`, body: "a post" });
  /** A confirmed decision through the route's code: its id, or a failure that says why none was recorded. */
  async function decided(member: RealStaff, caseId: string, input: DecisionInput): Promise<string> {
    const outcome = await world.decideAs(member, caseId, input);
    if (typeof outcome === "string") throw new Error(`the decision was not recorded: ${outcome}`);
    return outcome.decisionId;
  }
  /** What a decision through the route was refused with: its code and the trigger's detail (null for the route's own refusal). */
  async function refused(member: RealStaff, caseId: string, input: DecisionInput): Promise<{ code: string; detail: string | null } | null> {
    try {
      await world.decideAs(member, caseId, input);
      return null;
    } catch (err) {
      if (!(err instanceof ModerationError)) throw err;
      return { code: err.code, detail: (err as ModerationError & { detail?: string | null }).detail ?? null };
    }
  }
  /** A final removal under R5 of a new post of the account, by an admin's own finding: the basis `threat` rests on. */
  async function threatOn(accountId: string): Promise<{ decisionId: string; caseId: string }> {
    const caseId = (await intake(n.apiDb, ground.finding(admin.id, "R5"), aPost(await postOf(accountId)))).items[0]!.caseId!;
    return { decisionId: await decided(admin, caseId, { kind: "final", ruleId: "R5", actions: [act("remove")] }), caseId };
  }
  /** An admin's finding on the account under the rule: the account's case, where a measure at once is decided. */
  const accountCase = async (account: { id: string; handle: string }, rule: "R2" | "R5" | "R6") =>
    (await intake(n.apiDb, ground.finding(admin.id, rule), anAccount(account.id, account.handle))).items[0]!.caseId!;
  const atOnce = (days: number) => [timed("suspend", days, false)];
  /** The account's standing as /api/me reads it. */
  const standingOf = (accountId: string) => n.moderation.standingFor(accountId);
  /** The suspension row of a decision. */
  const suspendRow = async (decisionId: string) =>
    (await n.apiDb.execute<{ basis: string; rests_on: string[] | null; days: number; announced: boolean }>(
      sql`select basis, rests_on::text[] as rests_on, days, announced from decision_actions where decision_id = ${decisionId}::uuid and kind = 'suspend'`,
    ))[0]!;

  test("threat: an admin suspends at once on a final R5 decision about a post of the account; the suspension runs from the decision, /api/me says so, and the statement goes as suspension_started_at_once", async () => {
    const account = await n.account();
    const caseId = await accountCase(account, "R5");
    // Without the R5 decision no basis fits.
    expect(await refused(admin, caseId, { kind: "final", ruleId: "R5", actions: atOnce(3) })).toMatchObject({ code: "invalid_decision", detail: expect.stringMatching(/^basis: none fits/) });
    const threat = await threatOn(account.id);
    // A moderator meets admin_required. (The threat's most days are the params' own bound, 30.)
    expect(await refused(moderator, caseId, { kind: "final", ruleId: "R5", actions: atOnce(3) })).toMatchObject({ code: "admin_required" });
    const decisionId = await decided(admin, caseId, { kind: "final", ruleId: "R5", actions: atOnce(7) });
    expect(await suspendRow(decisionId)).toEqual({ basis: "threat", rests_on: [threat.decisionId], days: 7, announced: false });
    const standing = await standingOf(account.id);
    expect(standing?.measure).toMatchObject({ decisionId, kind: "suspend", days: 7, state: "running", replyOpen: true, appealPending: false });
    expect(Date.parse(standing!.measure!.endsAt!) - Date.parse(standing!.measure!.startsAt!)).toBe(7 * 24 * 60 * 60_000);
    expect(standing!.measure!.appealUntil).not.toBeNull();
    // A second standing measure is refused while this one runs.
    expect(await refused(admin, await accountCase(account, "R5"), { kind: "final", ruleId: "R5", actions: atOnce(3) })).toMatchObject({ code: "standing_conflict" });
    // The statement: what was done and why at once, the account's conduct under R5, the reply and the appeal.
    const found = (await decisionStatement(n.apiDb, decisionId))!;
    const measure = found.statement.measures[0]!;
    expect(measure).toMatchObject({ kind: "suspend", announced: false, days: 7, basis: "threat", restsOn: [{ ruleId: "R5", decidedAt: expect.any(String), postCreatedAt: expect.any(String) }] });
    const paragraphs = statementParagraphs(found.statement);
    expect(paragraphs[0]!.startsWith("korbat suspended your account for 7 days, from this decision until")).toBe(true);
    expect(paragraphs.some((paragraph) => paragraph.startsWith("Your account's conduct breaks korbat rule R5"))).toBe(true);
    // The mail, under its own subject and lead, with the statement's paragraphs.
    const [mail] = n.mailer.to(account.email, "suspension_started_at_once");
    expect(mail?.data).toMatchObject({ measure: "suspend", days: "7", statement: paragraphs.join(String.fromCharCode(10)) });
    expect(n.mailer.to(account.email, "moderation_decision").map((m) => m.data.statement)).not.toContain(paragraphs.join(String.fromCharCode(10)));
  });

  test("threat: refused on an R5 decision older than basisAgeDays and on one that was reversed", async () => {
    const old = await n.account();
    await threatOn(old.id);
    await ageStandingForTest(world.migrateDb, old.id, `${STANDING_RULES.basisAgeDays + 1} days`);
    expect(await refused(admin, await accountCase(old, "R5"), { kind: "final", ruleId: "R5", actions: atOnce(3) })).toMatchObject({ code: "invalid_decision", detail: expect.stringMatching(/^basis/) });
    const reversed = await n.account();
    const threat = await threatOn(reversed.id);
    await decided(second, threat.caseId, { kind: "correction", reviewsDecisionId: threat.decisionId, actions: [act("restore")] });
    expect(await refused(admin, await accountCase(reversed, "R5"), { kind: "final", ruleId: "R5", actions: atOnce(3) })).toMatchObject({ code: "invalid_decision", detail: expect.stringMatching(/^basis/) });
  });

  test("an announced suspension on a threat reaches only the ladder, and a termination needs its own facts: the database refuses each (Task 4 opened them in the route), with nothing stored", async () => {
    const account = await n.account();
    await threatOn(account.id);
    const caseId = await accountCase(account, "R5");
    // The route passes them now; the database refuses, with a detail the log keeps: one strike is no ladder, and a first
    // threat is no ground for a termination at once.
    for (const action of [timed("suspend", 3, true), timed("terminate", null, false), timed("terminate", null, true)]) {
      expect(await refused(admin, caseId, { kind: "final", ruleId: "R5", actions: [action] }), `${action.kind} ${action.announced}`).toMatchObject({ code: "invalid_decision", detail: expect.any(String) });
    }
    const [row] = await n.apiDb.execute<{ n: number }>(sql`select count(*)::int as n from decisions where case_id = ${caseId}::uuid`);
    expect(row!.n).toBe(0);
  });

  test("flood: 19 posts in the hour are no floor and 20 are; up to floodDays days; the statement says what the software counted", async () => {
    const account = await n.account();
    for (let i = 0; i < STANDING_RULES.floodPosts - 1; i++) await postOf(account.id);
    const caseId = await accountCase(account, "R6");
    expect(await refused(admin, caseId, { kind: "final", ruleId: "R6", actions: atOnce(3) })).toMatchObject({ code: "invalid_decision", detail: expect.stringMatching(/^basis: none fits/) });
    await postOf(account.id);
    expect(await refused(admin, caseId, { kind: "final", ruleId: "R6", actions: atOnce(STANDING_RULES.floodDays + 1) })).toMatchObject({ code: "invalid_decision", detail: expect.stringMatching(/^days: at most 7/) });
    const decisionId = await decided(admin, caseId, { kind: "final", ruleId: "R6", actions: atOnce(STANDING_RULES.floodDays) });
    expect(await suspendRow(decisionId)).toEqual({ basis: "flood", rests_on: null, days: STANDING_RULES.floodDays, announced: false });
    const paragraphs = statementParagraphs((await decisionStatement(n.apiDb, decisionId))!.statement);
    expect(paragraphs).toContain(STATEMENT_WORDS.automationFlood);
    expect(paragraphs[0]).toContain(STATEMENT_WORDS.basis.flood);
  });

  test("terrorist content: a decision on the law with the keyword about a post of the account; refused without the keyword", async () => {
    const account = await n.account();
    const postCase = (await intake(n.apiDb, ground.illegal(null), aPost(await postOf(account.id)))).items[0]!.caseId!;
    await decided(admin, postCase, { kind: "final", ground: "illegal", categoryKeyword: "KEYWORD_TERRORIST_CONTENT", actions: [act("remove")] });
    const onLaw = async () => (await intake(n.apiDb, ground.illegal(null), anAccount(account.id, account.handle))).items[0]!.caseId!;
    expect(await refused(admin, await onLaw(), { kind: "final", ground: "illegal", actions: atOnce(3) })).toMatchObject({ code: "invalid_decision", detail: expect.stringMatching(/^basis: on the law only/) });
    const decisionId = await decided(admin, await onLaw(), { kind: "final", ground: "illegal", categoryKeyword: "KEYWORD_TERRORIST_CONTENT", actions: atOnce(STANDING_RULES.terroristDays) });
    expect((await suspendRow(decisionId)).basis).toBe("terrorist");
    const paragraphs = statementParagraphs((await decisionStatement(n.apiDb, decisionId))!.statement);
    expect(paragraphs[0]).toContain("found terrorist content in a post of yours");
    expect(paragraphs.some((paragraph) => paragraph.startsWith("korbat found it illegal."))).toBe(true);
  });

  test("protective: on a seal for good of the account's images, once for that seal, in a decision of its own; its statement never says that a rule is broken; lifting the seal ends it and says so", async () => {
    const account = await n.account();
    const { postId } = await imagePost(n.apiDb, 1, account.id);
    const findingR2 = async () => (await intake(n.apiDb, ground.finding(admin.id, "R2"), anAccount(account.id, account.handle))).items[0]!.caseId!;
    expect(await refused(admin, await findingR2(), { kind: "final", ruleId: "R2", actions: atOnce(3) })).toMatchObject({ code: "invalid_decision", detail: expect.stringMatching(/^basis: under R2/) });
    const sealCase = (await report(n.apiDb, aPost(postId), "csam")).caseId;
    const seal = await decided(admin, sealCase, { kind: "final", ruleId: "R2", actions: [act("seal_media")] });
    const caseId = await findingR2();
    expect(await refused(admin, caseId, { kind: "final", ruleId: "R2", actions: atOnce(STANDING_RULES.protectiveDays + 1) })).toMatchObject({ code: "invalid_decision", detail: expect.stringMatching(/^days: at most 14/) });
    const decisionId = await decided(admin, caseId, { kind: "final", ruleId: "R2", actions: atOnce(STANDING_RULES.protectiveDays) });
    expect(await suspendRow(decisionId)).toEqual({ basis: "protective", rests_on: [seal], days: STANDING_RULES.protectiveDays, announced: false });
    const text = statementParagraphs((await decisionStatement(n.apiDb, decisionId))!.statement).join(" | ");
    expect(text).not.toContain("It breaks");
    expect(text).not.toContain("conduct breaks");
    expect(text).toContain("This is not a finding that you broke the law or a korbat rule");
    // Lifting the seal ends the suspension in that transaction; the correction's statement says so, and its mail is suspension_lifted.
    const unseal = await decided(admin, sealCase, { kind: "correction", reviewsDecisionId: seal, actions: [act("unseal_media")] });
    expect((await standingOf(account.id))?.measure).toBeNull();
    const ended = (await decisionStatement(n.apiDb, unseal))!.statement;
    expect(ended.endedStanding).toEqual([{ kind: "suspend", decidedAt: expect.any(String), periodThen: { state: "running", startedAt: expect.any(String), endedAt: null }, seal: true, replyFiledAt: null }]);
    expect(statementParagraphs(ended).some((paragraph) => paragraph.endsWith(`rested on that seal. ${STATEMENT_WORDS.basisEndedThen.running}`))).toBe(true);
    expect(n.mailer.to(account.email, "suspension_lifted").map((m) => [m.data.why, m.data.period])).toEqual([["basis", "running"]]);
    // One protective suspension for one seal, also after its lift: a second needs a newer seal.
    expect(await refused(admin, await findingR2(), { kind: "final", ruleId: "R2", actions: atOnce(3) })).toMatchObject({ code: "invalid_decision" });
  });

  test("its lift: a correction lifts the suspension at once, /api/me shows no measure, the statement says it ended with this decision, and the mail is suspension_lifted", async () => {
    const account = await n.account();
    await threatOn(account.id);
    const caseId = await accountCase(account, "R5");
    const decisionId = await decided(admin, caseId, { kind: "final", ruleId: "R5", actions: atOnce(7) });
    expect((await standingOf(account.id))?.measure?.state).toBe("running");
    // A suspension taken at once needed an admin, so its correction is an admin's too.
    expect(await refused(moderator, caseId, { kind: "correction", reviewsDecisionId: decisionId, actions: [act("lift_suspension")] })).toMatchObject({ code: "admin_required" });
    const lift = await decided(second, caseId, { kind: "correction", reviewsDecisionId: decisionId, actions: [act("lift_suspension")] });
    expect((await standingOf(account.id))?.measure).toBeNull();
    expect((await actionsOf(n.apiDb, lift)).map((a) => a.kind)).toEqual(["lift_suspension"]);
    const statement = (await decisionStatement(n.apiDb, lift))!.statement;
    expect(statement.reversals[0]).toMatchObject({ kind: "lift_suspension", liftedKind: "suspend", periodThen: { state: "running", startedAt: expect.any(String), endedAt: null }, replaced: false });
    expect(statementParagraphs(statement)).toContain(STATEMENT_WORDS.liftedRunning("suspension"));
    expect(n.mailer.to(account.email, "suspension_lifted").map((m) => [m.data.why, m.data.period])).toEqual([["lifted", "running"]]);
    // 3e's review (people5): the decision's screen reads the period cut to the lift, its end the lift's moment, which the
    // app words as a lift while it ran ([now.lifted]).
    const standing = (await authorDecisionView(n.deps, account.id, decisionId)).standing!;
    expect(standing).toMatchObject({ state: "lifted", endedBy: lift, startsAt: expect.any(String) });
    expect(standing.endsAt).toBe(standing.endedAt);
    // 3e's review (people7): the person's list names the suspension with its days and kind, and its lift as a lift.
    const rows = (await authorCases(n.deps, account.id)).decisions;
    expect(rows.find((row) => row.id === decisionId)).toMatchObject({ actions: ["suspend"], standingMeasure: { kind: "suspend", days: 7, announced: false } });
    expect(rows.find((row) => row.id === lift)).toMatchObject({ actions: ["lift_suspension"], liftedStanding: { kind: "suspend", replaced: false } });
    expect(rows.find((row) => row.id === lift)).not.toHaveProperty("standingMeasure");
    // Lifted, it stands no more: a new suspension at once is open again.
    expect(await refused(admin, await accountCase(account, "R5"), { kind: "final", ruleId: "R5", actions: atOnce(3) })).toBeNull();
  });

  test("the basis that breaks: reversing the R5 decision a suspension at once rests on ends it in that transaction, and the reversal's statement and mail say so", async () => {
    const account = await n.account();
    const threat = await threatOn(account.id);
    await decided(admin, await accountCase(account, "R5"), { kind: "final", ruleId: "R5", actions: atOnce(7) });
    const reversal = await decided(second, threat.caseId, { kind: "correction", reviewsDecisionId: threat.decisionId, actions: [act("restore")] });
    expect((await standingOf(account.id))?.measure).toBeNull();
    const statement = (await decisionStatement(n.apiDb, reversal))!.statement;
    expect(statement.endedStanding).toEqual([{ kind: "suspend", decidedAt: expect.any(String), periodThen: { state: "running", startedAt: expect.any(String), endedAt: null }, seal: false, replyFiledAt: null }]);
    expect(statementParagraphs(statement).some((paragraph) => paragraph.endsWith(`rested on that decision. ${STATEMENT_WORDS.basisEndedThen.running}`))).toBe(true);
    expect(n.mailer.to(account.email, "suspension_lifted").map((m) => [m.data.why, m.data.period])).toEqual([["basis", "running"]]);
  });

  test("/api/me carries the standing read fresh at every request: the suspension shows at once on a session opened before it, and goes with its lift", async () => {
    const b = new Browser(n.app, n.config.APP_ORIGIN);
    const email = `standing-${randomUUID()}@korbat.local`;
    const handle = `sa_${randomBytes(4).toString("hex")}`;
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: HUMAN, deviceId: randomToken(), platform: "web" } });
    const { flowId } = FlowResponse.parse(await start.json());
    expect((await b.fetch("/api/auth/email/verify", { json: { flowId, code: n.mailer.lastCodeFor(email) } })).status).toBe(200);
    expect((await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: n.config.TERMS_VERSION } })).status).toBe(200);
    expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: "Standing" } })).status).toBe(200);
    const me = async () => MeResponse.parse(await (await b.fetch("/api/me")).json());
    const id = (await me()).user.id;
    n.profileIds.push(id);
    expect((await me()).standing).toEqual({ activeStrikes: 0, measure: null, reporting: null, handleRetired: false });
    await threatOn(id);
    expect((await me()).standing?.activeStrikes).toBe(1);
    const caseId = await accountCase({ id, handle }, "R5");
    const decisionId = await decided(admin, caseId, { kind: "final", ruleId: "R5", actions: atOnce(5) });
    // The session's cache never carries the standing: the next read shows it.
    expect((await me()).standing?.measure).toMatchObject({ decisionId, kind: "suspend", days: 5, state: "running", reply: null });
    await decided(second, caseId, { kind: "correction", reviewsDecisionId: decisionId, actions: [act("lift_suspension")] });
    expect((await me()).standing?.measure).toBeNull();
  });

  test("grant-role refuses to make a suspended account staff, changing nothing; in the other order a promotion that holds the account's row first makes the deciding transaction wait, and it then meets staff_target", async () => {
    const account = await n.account();
    await threatOn(account.id);
    await decided(admin, await accountCase(account, "R5"), { kind: "final", ruleId: "R5", actions: atOnce(3) });
    const deps = { authDb: n.authDb, kv: new MemoryKv(), mailer: new MemoryMailer() };
    expect(await runGrantRole(deps, account.email, "moderator")).toBe("standing");
    expect((await n.repo.findUserById(account.id))!.role).toBe("user");
    expect(GRANT_ROLE_WORDS.standing).toBe(
      "This account holds a suspension, a termination or a restriction of reporting that stands and has not ended, so it cannot be made staff. Nothing was changed. If the measure was wrong, an admin lifts it with a correction first.",
    );
    // A demotion is never refused.
    expect(await runGrantRole(deps, account.email, "user")).not.toBe("standing");

    // The other order: a promotion holds the account's row, as grant-role's transaction does, while a suspension is decided.
    const other = await n.account();
    await threatOn(other.id);
    const caseId = await accountCase(other, "R5");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let taken!: () => void;
    const locked = new Promise<void>((resolve) => (taken = resolve));
    const promotion = n.authDb.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '20s'`);
      await tx.execute(sql`select 1 from auth.users where id = ${other.id}::uuid for no key update`);
      await tx.execute(sql`update auth.users set role = 'moderator' where id = ${other.id}::uuid`);
      taken();
      await gate;
    });
    let failed: unknown = null;
    promotion.catch((err: unknown) => {
      failed = err;
      taken();
    });
    try {
      await locked;
      expect(failed).toBeNull();
      const deciding = refused(admin, caseId, { kind: "final", ruleId: "R5", actions: atOnce(3) });
      await untilBlocked(n.apiDb, "insert into decisions");
      release();
      await promotion;
      expect(await deciding).toMatchObject({ code: "staff_target" });
    } finally {
      release();
      await promotion.catch(() => undefined);
      await n.authDb.execute(sql`update auth.users set role = 'user' where id = ${other.id}::uuid`);
    }
  });

  test("a reporter whose report a suspension at once answered reads 3c's restricted outcome with ACCOUNT_MEASURE_SCOPE.measure, which names no suspension, its time or its length; in the mail and on the page alike", async () => {
    const account = await n.account();
    await threatOn(account.id);
    const reporter = await n.account();
    const notice = await intake(n.apiDb, ground.rule(reporter.id, "R5"), anAccount(account.id, account.handle));
    const caseId = notice.items[0]!.caseId!;
    await decided(admin, caseId, { kind: "final", ruleId: "R5", actions: atOnce(3) });
    await n.apiDb.execute(sql`select public.release_outcomes(now())`);
    const [item] = await noticeItems(n.apiDb, notice.intakeId);
    const status = await itemStatus(world.moderation.deps, item!);
    expect(status.scope).toBe("account_measure");
    const words = itemOutcomeWords(status)!;
    expect(words.startsWith("access restricted: it breaks korbat rule R5")).toBe(true);
    expect(words.endsWith(` ${ACCOUNT_MEASURE_SCOPE.measure}`)).toBe(true);
    expect(words).not.toMatch(/suspen|terminat|day|until/i);
    // The dispatch job mails the same line: the item's mail is made pending as the release makes a mailed one.
    await world.migrateDb.execute(sql`update intake_items set outcome_mail = 'pending' where intake_id = ${notice.intakeId}::uuid`);
    const mailed = (await pendingOutcomeLines(n.apiDb)).find((line) => line.intakeId === notice.intakeId)!;
    expect(mailed).toMatchObject({ targetType: "account", measure: true, retired: false });
    expect(updateLine(world.moderation.deps, mailed).outcome).toBe(words);
  });

  test("this file left no row behind: what it committed is removed, and the tables hold what they held before it", async () => {
    await world.moderation.settle();
    await n.cleanUp();
    expect(await n.counts()).toEqual(before);
  });
});
