import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { RETENTION, STANDING_RULES, type RuleId } from "@korbat/contracts";
import { STATEMENT_WORDS, statementParagraphs } from "@korbat/rules";
import { ModerationError } from "../../src/moderation";
import { giveUpAnnounced } from "../../src/moderation/dispatch";
import { saltedStatement } from "../../src/moderation/intake";
import { caseStanding, fileReply } from "../../src/moderation/standing";
import { insertReply, replyMeasureOf } from "../../src/moderation/standing-repo";
import { decisionStatement, sendStatement } from "../../src/moderation/statement";
import { deciderWorld, type DeciderWorld, type RealStaff } from "./moderation-decide";
import { createSocialRepo } from "../../src/social/repo";
import { aPost, act, ageStandingForTest, anAccount, gate, ground, intake, newPostRow, raised, timed, untilBlocked, type DecisionInput } from "./moderation-fixtures";
import { noticesWorld, type NoticesWorld } from "./notices-harness";

// Every step of the ladder is a confirmed decision, each a round of the step-up flow: slow on a loaded machine.
vi.setConfig({ testTimeout: 400_000 });

const HOUR_MS = 60 * 60_000;

/**
 * Announced suspensions and terminations (3e design, sections 7.6, 7.8 and 7.14; section 12.1, invariants 7, 8, 11 and
 * 20 for the announced measures): the start under each outcome of the notice mail (none while it is pending; the relay's
 * acceptance plus the reply window when sent; the decision plus the undelivered window when refused; the moment a give-up
 * was recorded when that is later), recorded under the subject's profile lock, and the API role unable to move either
 * column again; the ladder from three strikes to an announced termination, one rung after another with its most days;
 * and a basis that breaks under an announced measure that a reply holds. Each decision is confirmed with a real staff
 * key and mailed through the notices world's auth module and its scripted mailer.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: announced suspensions and terminations", () => {
  let n: NoticesWorld;
  let world: DeciderWorld;
  let admin: RealStaff;
  let second: RealStaff;
  let moderator: RealStaff;
  let before: Record<string, number>;

  beforeAll(async () => {
    n = noticesWorld();
    world = deciderWorld(n.apiDb, { auth: n.authForModeration });
    admin = await world.staff("admin");
    second = await world.staff("admin");
    moderator = await world.staff("moderator");
    before = await n.counts();
  }, 400_000);
  afterAll(async () => {
    try {
      await n.cleanUp();
      await world.close();
    } finally {
      await n.close();
    }
  }, 400_000);

  /** A confirmed decision through the route's code: its id, or a failure that says why none was recorded. */
  async function decided(member: RealStaff, caseId: string, input: DecisionInput): Promise<string> {
    const outcome = await world.decideAs(member, caseId, input);
    if (typeof outcome === "string") throw new Error(`the decision was not recorded: ${outcome}`);
    return outcome.decisionId;
  }
  /** What a decision through the route was refused with: its code and the trigger's detail. */
  async function refused(member: RealStaff, caseId: string, input: DecisionInput): Promise<{ code: string; detail: string | null } | null> {
    try {
      await world.decideAs(member, caseId, input);
      return null;
    } catch (err) {
      if (!(err instanceof ModerationError)) throw err;
      return { code: err.code, detail: (err as ModerationError & { detail?: string | null }).detail ?? null };
    }
  }
  /** Strikes the way they come about: a post made now, an admin's own finding on it under the rule, a final removal. */
  async function strikes(accountId: string, count: number, rule: RuleId = "R1"): Promise<string[]> {
    const made: string[] = [];
    for (let i = 0; i < count; i++) {
      const postId = await newPostRow(n.apiDb, accountId, { createdAt: sql`clock_timestamp()`, body: `a post that breaks ${rule}` });
      const caseId = (await intake(n.apiDb, ground.finding(admin.id, rule), aPost(postId))).items[0]!.caseId!;
      made.push(await decided(admin, caseId, { kind: "final", ruleId: rule, actions: [act("remove")] }));
    }
    return made;
  }
  /** An admin's own finding on the account under the rule: the account's case, where an account measure is decided. */
  const accountCase = async (account: { id: string; handle: string }, rule: RuleId) => (await intake(n.apiDb, ground.finding(admin.id, rule), anAccount(account.id, account.handle))).items[0]!.caseId!;
  /** The measure's period as suspension_periods gives it, with the decision's mail, each time in epoch milliseconds. */
  async function periodOf(decisionId: string) {
    const [row] = await n.apiDb.execute<{ author_mail: string; mail_ms: number | null; created_ms: number; earliest_ms: number; start_ms: number | null; end_ms: number | null }>(
      sql`select d.author_mail, extract(epoch from d.author_mail_at) * 1000 as mail_ms, extract(epoch from a.created_at) * 1000 as created_ms,
                 extract(epoch from a.starts_at) * 1000 as earliest_ms, extract(epoch from p.starts_at) * 1000 as start_ms,
                 case when isfinite(p.ends_at) then extract(epoch from p.ends_at) * 1000 end as end_ms
            from decision_actions a join decisions d on d.id = a.decision_id left join suspension_periods p on p.action_id = a.id
           where a.decision_id = ${decisionId}::uuid and a.kind::text in ('suspend', 'terminate')`,
    );
    return { ...row!, mail_ms: row!.mail_ms === null ? null : Number(row!.mail_ms), created_ms: Number(row!.created_ms), earliest_ms: Number(row!.earliest_ms), start_ms: row!.start_ms === null ? null : Number(row!.start_ms), end_ms: row!.end_ms === null ? null : Number(row!.end_ms) };
  }
  /** The profile's two derived columns, as the migrator reads them. */
  async function columnsOf(accountId: string) {
    const [row] = await world.migrateDb.execute<{ from_ms: number | null; until_ms: number | null }>(
      sql`select extract(epoch from suspended_from) * 1000 as from_ms, case when isfinite(suspended_until) then extract(epoch from suspended_until) * 1000 end as until_ms from profiles where id = ${accountId}::uuid`,
    );
    return { from: row!.from_ms === null ? null : Number(row!.from_ms), until: row!.until_ms === null ? null : Number(row!.until_ms) };
  }
  /** An account at the ladder's first step with an announced suspension of 3 days, its mail ended as the scripted mailer says. */
  async function announced(mode: "deliver" | "refuse" | "fail") {
    const account = await n.account();
    await strikes(account.id, STANDING_RULES.ladderStrikes);
    const caseId = await accountCase(account, "R1");
    n.mailer.mode = mode;
    try {
      const decisionId = await decided(moderator, caseId, { kind: "final", ruleId: "R1", actions: [timed("suspend", 3, true)] });
      return { account, caseId, decisionId };
    } finally {
      n.mailer.mode = "deliver";
    }
  }

  test("the start under each outcome of the notice mail: none while it is pending, the relay's acceptance plus the window when sent, the decision plus the undelivered window when refused, and the moment of a late give-up; and the API role cannot move either column again", async () => {
    const windowMs = STANDING_RULES.replyWindowHours * HOUR_MS;
    // Pending: the relay could not be reached. No start, nothing restricted, and /api/me says the start is not fixed.
    const pending = await announced("fail");
    let period = await periodOf(pending.decisionId);
    expect(period).toMatchObject({ author_mail: "pending", mail_ms: null, start_ms: null });
    expect(period.earliest_ms - period.created_ms).toBe(windowMs);
    expect(await columnsOf(pending.account.id)).toEqual({ from: null, until: null });
    expect((await n.moderation.standingFor(pending.account.id))?.measure).toMatchObject({ state: "unfixed", startsAt: null, endsAt: null, days: 3, replyOpen: true });
    // The dispatch job's retry sends it: the start is the relay's acceptance plus the window, never before the earliest start.
    expect(await sendStatement(n.deps, pending.decisionId)).toBe("sent");
    period = await periodOf(pending.decisionId);
    expect(period.author_mail).toBe("sent");
    expect(period.start_ms).toBe(Math.max(period.earliest_ms, period.mail_ms! + windowMs));
    expect(period.end_ms).toBe(period.start_ms! + 3 * 24 * HOUR_MS);
    expect(await columnsOf(pending.account.id)).toEqual({ from: period.start_ms, until: period.end_ms });
    expect((await n.moderation.standingFor(pending.account.id))?.measure).toMatchObject({ state: "announced" });
    // The mail is suspension_announced, with the window the statement names.
    const [mail] = n.mailer.to(pending.account.email, "suspension_announced");
    expect(mail?.data).toMatchObject({ measure: "suspend", days: "3", window: String(STANDING_RULES.replyWindowHours) });

    // Refused for good: the decision plus the undelivered window.
    const refusedMail = await announced("refuse");
    period = await periodOf(refusedMail.decisionId);
    expect(period.author_mail).toBe("failed");
    expect(period.mail_ms).not.toBeNull();
    expect(period.start_ms).toBe(period.created_ms + STANDING_RULES.undeliveredHours * HOUR_MS);

    // Given up after the dispatch job stood still for longer than the undelivered window: the start is the give-up's
    // moment, never a time already past, and the suspension runs at once.
    const late = await announced("fail");
    await ageStandingForTest(world.migrateDb, late.account.id, `${STANDING_RULES.undeliveredHours + 24} hours`);
    expect(await giveUpAnnounced(n.deps, new Date())).toContain(late.decisionId);
    period = await periodOf(late.decisionId);
    expect(period.author_mail).toBe("failed");
    expect(period.start_ms).toBe(period.mail_ms);
    expect(period.start_ms!).toBeGreaterThan(period.created_ms + STANDING_RULES.undeliveredHours * HOUR_MS);
    expect((await n.moderation.standingFor(late.account.id))?.measure?.state).toBe("running");

    // The API role can neither un-send a notice nor move its time (decisions_mail_forward, 42501).
    for (const statement of [
      sql`update decisions set author_mail = 'pending' where id = ${refusedMail.decisionId}::uuid`,
      sql`update decisions set author_mail_at = author_mail_at - interval '1 day' where id = ${pending.decisionId}::uuid`,
    ]) {
      let code: string | null = null;
      try {
        await n.apiDb.execute(statement);
      } catch (err) {
        code = raised(err)?.code ?? null;
      }
      expect(code).toBe("42501");
    }
  });

  test("the ladder to its end: three strikes announce a suspension of at most 3 days, a further strike 7, then 30, and after three suspensions in the year a termination; one standing measure at a time", async () => {
    const account = await n.account();
    const passPeriod = async (days: number) => ageStandingForTest(world.migrateDb, account.id, `${STANDING_RULES.replyWindowHours + days * 24 + 1} hours`);
    await strikes(account.id, 3, "R1");
    let caseId = await accountCase(account, "R1");
    expect(await caseStanding(n.apiDb, caseId, account.id)).toMatchObject({ activeStrikes: 3, ladderRule: "R1", maxDays: STANDING_RULES.ladderDays[0], mayTerminate: false, live: false, suspensionsInYear: 0 });
    // More than the rung is refused; a termination is not open yet; a moderator may announce a suspension.
    expect(await refused(moderator, caseId, { kind: "final", ruleId: "R1", actions: [timed("suspend", STANDING_RULES.ladderDays[0] + 1, true)] })).toMatchObject({ code: "invalid_decision" });
    expect(await refused(admin, caseId, { kind: "final", ruleId: "R1", actions: [timed("terminate", null, true)] })).toMatchObject({ code: "invalid_decision" });
    const first = await decided(moderator, caseId, { kind: "final", ruleId: "R1", actions: [timed("suspend", STANDING_RULES.ladderDays[0], true)] });
    // While it stands (it has a start, and has not run), a second standing measure is refused.
    await strikes(account.id, 1, "R3");
    expect(await refused(moderator, await accountCase(account, "R3"), { kind: "final", ruleId: "R3", actions: [timed("suspend", 1, true)] })).toMatchObject({ code: "standing_conflict" });
    // The statement: the strikes it rests on, the terms' section as its ground, and the start.
    const paragraphs = statementParagraphs((await decisionStatement(n.apiDb, first))!.statement);
    expect(paragraphs[0]!.startsWith(STATEMENT_WORDS.suspendAnnounced(STANDING_RULES.ladderDays[0]))).toBe(true);
    expect(paragraphs.some((paragraph) => paragraph.startsWith("This rests on korbat's terms, section Suspension and termination"))).toBe(true);
    expect(paragraphs).toContain(STATEMENT_WORDS.automationCounted);

    // The first step runs and ends; the strike made since is newer than it: the second step, at most 7 days, under R3.
    await passPeriod(STANDING_RULES.ladderDays[0]);
    caseId = await accountCase(account, "R3");
    expect(await caseStanding(n.apiDb, caseId, account.id)).toMatchObject({ activeStrikes: 4, ladderRule: "R3", maxDays: STANDING_RULES.ladderDays[1], suspensionsInYear: 1, live: false });
    expect(await refused(moderator, caseId, { kind: "final", ruleId: "R3", actions: [timed("suspend", STANDING_RULES.ladderDays[1] + 1, true)] })).toMatchObject({ code: "invalid_decision" });
    await decided(moderator, caseId, { kind: "final", ruleId: "R3", actions: [timed("suspend", STANDING_RULES.ladderDays[1], true)] });
    await passPeriod(STANDING_RULES.ladderDays[1]);

    // The third step: at most 30 days; a moderator who chooses 1 still uses it.
    await strikes(account.id, 1, "R1");
    caseId = await accountCase(account, "R1");
    expect(await caseStanding(n.apiDb, caseId, account.id)).toMatchObject({ maxDays: STANDING_RULES.ladderDays[2], suspensionsInYear: 2, mayTerminate: false });
    await decided(moderator, caseId, { kind: "final", ruleId: "R1", actions: [timed("suspend", 1, true)] });
    await passPeriod(1);

    // Three suspensions of the ladder in the year, and a strike since: a termination can be announced, by an admin only.
    await strikes(account.id, 1, "R1");
    caseId = await accountCase(account, "R1");
    expect(await caseStanding(n.apiDb, caseId, account.id)).toMatchObject({ suspensionsInYear: 3, mayTerminate: true });
    expect(await refused(moderator, caseId, { kind: "final", ruleId: "R1", actions: [timed("terminate", null, true)] })).toMatchObject({ code: "admin_required" });
    const termination = await decided(admin, caseId, { kind: "final", ruleId: "R1", actions: [timed("terminate", null, true)] });
    const [row] = await n.apiDb.execute<{ basis: string; days: number | null; announced: boolean }>(sql`select basis, days, announced from decision_actions where decision_id = ${termination}::uuid and kind::text = 'terminate'`);
    expect({ ...row! }).toEqual({ basis: "ladder_end", days: null, announced: true });
    const ended = statementParagraphs((await decisionStatement(n.apiDb, termination))!.statement);
    expect(ended[0]!.startsWith("korbat will terminate your account. Nothing is restricted yet.")).toBe(true);
    expect(ended.some((paragraph) => paragraph.startsWith("This rests on korbat's terms, section Suspension and termination: after three suspensions"))).toBe(true);
    const mails = n.mailer.to(account.email, "suspension_announced");
    expect(mails.map((mail) => mail.data.measure)).toEqual(["suspend", "suspend", "suspend", "terminate"]);
    expect((await n.moderation.standingFor(account.id))?.measure).toMatchObject({ kind: "terminate", state: "announced", days: null, endsAt: null });
  });

  test("a basis that breaks under an announced suspension held by a reply: the overruling ends it before its start, answers the reply, says so in its statement and mail, and a kept answer is then refused", async () => {
    const account = await n.account();
    const struck = await strikes(account.id, STANDING_RULES.ladderStrikes);
    const caseId = await accountCase(account, "R1");
    const decisionId = await decided(moderator, caseId, { kind: "final", ruleId: "R1", actions: [timed("suspend", 3, true)] });
    const reply = await fileReply(n.deps, account.id, decisionId, { statement: "These posts were satire." });
    expect(reply.onTime).toBe(true);
    expect((await n.moderation.standingFor(account.id))?.measure?.state).toBe("held");
    // A correction reverses one strike's decision whole: fewer than three strikes stand, so the suspension's basis breaks.
    const [strikeCase] = await n.apiDb.execute<{ case_id: string }>(sql`select case_id from decisions where id = ${struck[1]!}::uuid`);
    const reversal = await decided(second, strikeCase!.case_id, { kind: "correction", reviewsDecisionId: struck[1]!, actions: [act("restore")] });
    expect((await n.moderation.standingFor(account.id))?.measure).toBeNull();
    const [answered] = await n.apiDb.execute<{ answered_by: string | null }>(sql`select r.answered_by from suspension_replies r join decision_actions a on a.id = r.action_id where a.decision_id = ${decisionId}::uuid`);
    expect(answered?.answered_by).toBe(reversal);
    const statement = (await decisionStatement(n.apiDb, reversal))!.statement;
    expect(statement.endedStanding).toEqual([{ kind: "suspend", decidedAt: expect.any(String), periodThen: { state: "not_started", startedAt: null, endedAt: null }, seal: false, replyFiledAt: expect.any(String) }]);
    expect(statement.repliedTo).toBeUndefined();
    expect(statementParagraphs(statement).some((paragraph) => paragraph.includes(STATEMENT_WORDS.basisEndedThen.not_started) && paragraph.includes("needs no answer now"))).toBe(true);
    expect(n.mailer.to(account.email, "suspension_lifted").map((mail) => [mail.data.why, mail.data.period])).toEqual([["basis", "not_started"]]);
    expect(n.mailer.to(account.email, "reply_answered")).toEqual([]);
    // Nothing is left to keep: a kept answer to the reply is refused.
    expect(await refused(moderator, caseId, { kind: "correction", outcome: "kept", reviewsDecisionId: decisionId })).toMatchObject({ code: "invalid_decision" });
  });

  // ---------------------------------------------------------------- what the review of the built code added

  /** How many mails of this template the scripted mailer has been handed for this address, sent, failed or hanging. */
  const attemptsOf = (address: string, template: string) => n.mailer.attempts.filter((mail) => mail.to === address && mail.template === template).length;
  /** Resolves once the scripted mailer has been handed one more mail of this template for this address than `before`. */
  async function handedOver(address: string, template: string, before: number): Promise<void> {
    for (let round = 0; round < 400; round++) {
      if (attemptsOf(address, template) > before) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`no ${template} mail was handed over`);
  }
  /** What the promise settled with within `ms`, or "still waiting": a write that waits for the relay must not hang the test. */
  const within = <T>(ms: number, promise: Promise<T>): Promise<T | "still waiting"> =>
    Promise.race([promise, new Promise<"still waiting">((resolve) => setTimeout(() => resolve("still waiting"), ms))]);
  /** The decision's statement mail as the database holds it. */
  const mailState = async (decisionId: string) => (await n.apiDb.execute<{ author_mail: string }>(sql`select author_mail::text from decisions where id = ${decisionId}::uuid`))[0]!.author_mail;

  test("a notice still owed when its suspension was withdrawn is never sent: the dispatch's retry records it failed, fixes no start, and the person reads only the withdrawal", async () => {
    // 3e's review (proofs1): the old statement would name an earliest start and invite a reply the route refuses.
    const pending = await announced("fail");
    expect(await mailState(pending.decisionId)).toBe("pending");
    await decided(admin, pending.caseId, { kind: "correction", reviewsDecisionId: pending.decisionId, actions: [act("lift_suspension")], replaced: true });
    // The strikes' statements went before; of the suspension's mails, only the withdrawal's.
    const standingMails = () => n.mailer.to(pending.account.email).filter((mail) => mail.template.startsWith("suspension_")).map((mail) => mail.template);
    expect(standingMails()).toEqual(["suspension_lifted"]);
    const tried = attemptsOf(pending.account.email, "suspension_announced");
    expect(await sendStatement(n.deps, pending.decisionId)).toBe("failed");
    expect(await mailState(pending.decisionId)).toBe("failed");
    expect(standingMails()).toEqual(["suspension_lifted"]);
    // Not even handed to the relay.
    expect(attemptsOf(pending.account.email, "suspension_announced")).toBe(tried);
    expect((await periodOf(pending.decisionId)).start_ms).toBeNull();
    expect(await columnsOf(pending.account.id)).toEqual({ from: null, until: null });
    expect((await n.moderation.standingFor(pending.account.id))?.measure).toBeNull();
    // Nothing is owed any more: a second retry sends nothing.
    expect(await sendStatement(n.deps, pending.decisionId)).toBe("none");
  });

  test("the give-up of an announced measure's mail waits for an on-time reply that holds the account's profile, and then fixes no start: the account is not suspended while its reply holds the measure", async () => {
    // 3e's review (proofs2): without the give-up's lock on the profile, its derivation would read the period before the
    // reply and write a start the reply holds back.
    const pending = await announced("fail");
    await ageStandingForTest(world.migrateDb, pending.account.id, `${RETENTION.mailGiveUpDays} days 1 hour`);
    const actionId = (await replyMeasureOf(n.apiDb, pending.account.id, pending.decisionId))!;
    const statement = await saltedStatement("I read the notice and reply in time.");
    const held = gate();
    const release = gate();
    let onTime: boolean | null = null;
    // The reply's transaction, as fileReply runs it, held open after its insert.
    const replying = n.apiDb.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '60s'`);
      await n.deps.social.lockAccounts(tx, [pending.account.id], "update");
      onTime = (await insertReply(tx, { actionId, accountId: pending.account.id, statement })).onTime;
      held.open();
      await release.opened;
    });
    let givingUp: Promise<string[]> | null = null;
    try {
      await held.opened;
      givingUp = giveUpAnnounced(n.deps, new Date());
      await untilBlocked(n.apiDb, "order by id for no key update", 60_000);
    } finally {
      release.open();
      await replying;
    }
    expect(await givingUp).toContain(pending.decisionId);
    expect(onTime).toBe(true);
    expect(await mailState(pending.decisionId)).toBe("failed");
    expect((await periodOf(pending.decisionId)).start_ms).toBeNull();
    expect(await columnsOf(pending.account.id)).toEqual({ from: null, until: null });
    expect((await n.moderation.standingFor(pending.account.id))?.measure?.state).toBe("held");
    const [judged] = await n.apiDb.transaction((tx) => n.deps.social.lockAccounts(tx, [pending.account.id], "key share"));
    expect(judged!.suspended).toBe(false);
  });

  test("no profile is held while a notice is mailed: a follow of the account goes through while the relay hangs, a decision about it commits meanwhile, and the outcome is then recorded under the profile's lock without a deadlock", async () => {
    // 3e's review (database3): the subject's profile is taken right before the mail's result is recorded, never before the send.
    const pending = await announced("fail");
    const follower = await n.account();
    const social = createSocialRepo(n.apiDb);
    n.mailer.mode = "hang";
    let sending: Promise<unknown> | null = null;
    try {
      const tried = attemptsOf(pending.account.email, "suspension_announced");
      sending = sendStatement(n.deps, pending.decisionId);
      await handedOver(pending.account.email, "suspension_announced", tried);
      // The notice's send keeps hanging; every later mail (the lift's statement below) is delivered.
      n.mailer.mode = "deliver";
      expect(await within(3000, social.follow(follower.id, pending.account.id, new Date(), true))).toBe(true);
      // A deciding transaction takes the profile first, then the decisions it answers by foreign key: it commits while
      // the mail's transaction holds the decision's row and waits for the relay.
      const corrected = await within(60_000, world.decideAs(admin, pending.caseId, { kind: "correction", reviewsDecisionId: pending.decisionId, actions: [act("lift_suspension")] }));
      expect(corrected).not.toBe("still waiting");
      expect(typeof corrected).not.toBe("string");
    } finally {
      n.mailer.release("deliver");
    }
    expect(await sending).toBe("sent");
    expect(await mailState(pending.decisionId)).toBe("sent");
    expect((await n.moderation.standingFor(pending.account.id))?.measure).toBeNull();

    // The other order: a transaction that holds the profile FOR UPDATE and the decision's row FOR KEY SHARE, as a deciding
    // transaction holds them, while the mail is sent; the mail's transaction records once it has gone.
    const second = await announced("fail");
    const held = gate();
    const release = gate();
    const holder = n.apiDb.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '60s'`);
      await n.deps.social.lockAccounts(tx, [second.account.id], "update");
      await tx.execute(sql`select 1 from decisions where id = ${second.decisionId}::uuid for key share`);
      held.open();
      await release.opened;
    });
    let recording: Promise<unknown> | null = null;
    try {
      await held.opened;
      recording = sendStatement(n.deps, second.decisionId);
      await untilBlocked(n.apiDb, "order by id for no key update", 60_000);
      // The mail went before the profile was asked for.
      expect(n.mailer.to(second.account.email, "suspension_announced")).toHaveLength(1);
    } finally {
      release.open();
      await holder;
    }
    expect(await recording).toBe("sent");
  });

  test("this file left no row behind: what it committed is removed, and the tables hold what they held before it", async () => {
    await world.moderation.settle();
    await n.cleanUp();
    expect(await n.counts()).toEqual(before);
  });
});
