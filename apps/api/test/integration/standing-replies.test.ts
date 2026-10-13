import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { ErrorEnvelope, FlowResponse, MeResponse, ReplyResponse, STANDING_RULES, appealDeadline, type RuleId } from "@korbat/contracts";
import { REDRESS_TEXTS, STATEMENT_WORDS, statementParagraphs } from "@korbat/rules";
import { randomToken } from "../../src/auth/crypto";
import { ModerationError } from "../../src/moderation";
import { fileAppeal } from "../../src/moderation/appeals";
import { authorDecisionView } from "../../src/moderation/author";
import { fileReply } from "../../src/moderation/standing";
import { decisionStatement } from "../../src/moderation/statement";
import { Browser } from "./http-client";
import { deciderWorld, type DeciderWorld, type RealStaff } from "./moderation-decide";
import { aPost, act, ageStandingForTest, anAccount, decisionParams, ground, intake, newPostRow, timed, type DecisionInput } from "./moderation-fixtures";
import { HUMAN, noticesWorld, type NoticesWorld } from "./notices-harness";

// Every announced measure rests on three strikes, each a confirmed decision: slow on a loaded machine.
vi.setConfig({ testTimeout: 400_000 });

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The reply and its answer (3e design, sections 7.6 steps 9 to 12, 7.11 item 4 and 7.15; section 12.1, invariants 8, 11
 * and 12): the route, its session and its owner, once; a reply before the start holds it, one after changes nothing by
 * itself, and one to a measure that ended or was lifted is refused; a kept answer starts the suspension at the later of
 * the answer and the earliest start, and the six months to appeal count again from it; a reversed answer; a review that
 * keeps the measure in force answers the reply as a kept answer does; a correction drafted before the reply is refused;
 * and the withdrawal of an announced measure for a measure taken at once. Every decision is confirmed with a real staff
 * key and mailed through the notices world's auth module.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the reply to a suspension and its answer", () => {
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

  async function decided(member: RealStaff, caseId: string, input: DecisionInput): Promise<string> {
    const outcome = await world.decideAs(member, caseId, input);
    if (typeof outcome === "string") throw new Error(`the decision was not recorded: ${outcome}`);
    return outcome.decisionId;
  }
  async function refused(member: RealStaff, caseId: string, input: DecisionInput): Promise<string | null> {
    try {
      await world.decideAs(member, caseId, input);
      return null;
    } catch (err) {
      if (!(err instanceof ModerationError)) throw err;
      return err.code;
    }
  }
  async function strikes(accountId: string, count: number, rule: RuleId = "R1"): Promise<void> {
    for (let i = 0; i < count; i++) {
      const postId = await newPostRow(n.apiDb, accountId, { createdAt: sql`clock_timestamp()`, body: `a post that breaks ${rule}` });
      const caseId = (await intake(n.apiDb, ground.finding(admin.id, rule), aPost(postId))).items[0]!.caseId!;
      await decided(admin, caseId, { kind: "final", ruleId: rule, actions: [act("remove")] });
    }
  }
  const accountCase = async (account: { id: string; handle: string }, rule: RuleId) => (await intake(n.apiDb, ground.finding(admin.id, rule), anAccount(account.id, account.handle))).items[0]!.caseId!;
  /** The ladder's first step, announced by the moderator: three strikes, then a suspension of `days` on the account's case. Its mail is sent, so its start is fixed and ahead. */
  async function announce(account: { id: string; handle: string }, days = 3, extra: DecisionInput["actions"] = []) {
    await strikes(account.id, STANDING_RULES.ladderStrikes);
    const caseId = await accountCase(account, "R1");
    const decisionId = await decided(moderator, caseId, { kind: "final", ruleId: "R1", actions: [...extra, timed("suspend", days, true)] });
    return { caseId, decisionId };
  }
  /** The measure's period and its row's earliest start, in epoch milliseconds, and its reply. */
  async function periodOf(decisionId: string) {
    const [row] = await n.apiDb.execute<{ earliest_ms: number; start_ms: number | null; end_ms: number | null; answered_by: string | null; answered_ms: number | null; on_time: boolean | null }>(
      sql`select extract(epoch from a.starts_at) * 1000 as earliest_ms, extract(epoch from p.starts_at) * 1000 as start_ms, extract(epoch from p.ends_at) * 1000 as end_ms,
                 r.answered_by, extract(epoch from r.answered_at) * 1000 as answered_ms, r.on_time
            from decision_actions a left join suspension_periods p on p.action_id = a.id left join suspension_replies r on r.action_id = a.id
           where a.decision_id = ${decisionId}::uuid and a.kind::text in ('suspend', 'terminate')`,
    );
    // To the millisecond, as JavaScript reads a time: the database's microseconds are cut off.
    const num = (value: number | null) => (value === null ? null : Math.floor(Number(value)));
    return { earliest: Math.floor(Number(row!.earliest_ms)), start: num(row!.start_ms), end: num(row!.end_ms), answeredBy: row!.answered_by, answeredAt: num(row!.answered_ms), onTime: row!.on_time };
  }
  const stateOf = async (accountId: string) => (await n.moderation.standingFor(accountId))?.measure ?? null;

  test("the route: a signed-in session of the measure's subject only, once; 201 with when it was filed and that it came before the start; /api/me then shows the start held", async () => {
    const signUp = async () => {
      const b = new Browser(n.app, n.config.APP_ORIGIN);
      const email = `reply-${randomUUID()}@korbat.local`;
      const handle = `rp_${randomBytes(4).toString("hex")}`;
      const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: HUMAN, deviceId: randomToken(), platform: "web" } });
      const { flowId } = FlowResponse.parse(await start.json());
      expect((await b.fetch("/api/auth/email/verify", { json: { flowId, code: n.mailer.lastCodeFor(email) } })).status).toBe(200);
      expect((await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: n.config.TERMS_VERSION } })).status).toBe(200);
      expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: "Reply" } })).status).toBe(200);
      const id = MeResponse.parse(await (await b.fetch("/api/me")).json()).user.id;
      n.profileIds.push(id);
      return { b, id, handle };
    };
    const ada = await signUp();
    const other = await signUp();
    const { decisionId } = await announce(ada);
    expect((await stateOf(ada.id))?.state).toBe("announced");
    const path = `/api/moderation/decisions/${decisionId}/reply`;
    const codeOf = async (res: Response) => ErrorEnvelope.parse(await res.json()).error.code;
    // Signed out: refused at the session guard. Another account: not found, as for the decision's read.
    const signedOut = await new Browser(n.app, n.config.APP_ORIGIN).fetch(path, { json: {} });
    expect(signedOut.status).toBe(401);
    const stranger = await other.b.fetch(path, { json: {} });
    expect([stranger.status, await codeOf(stranger)]).toEqual([404, "not_found"]);
    // A text longer than an appeal's statement is refused before anything is read.
    expect((await ada.b.fetch(path, { json: { statement: "x".repeat(2001) } })).status).toBe(400);
    // The reply: 201, filed before the start, which it now holds.
    const res = await ada.b.fetch(path, { json: { statement: "I want to explain these posts." } });
    expect(res.status).toBe(201);
    const answer = ReplyResponse.parse(await res.json());
    expect(answer.onTime).toBe(true);
    const me = MeResponse.parse(await (await ada.b.fetch("/api/me")).json());
    expect(me.standing?.measure).toMatchObject({ state: "held", startsAt: null, replyOpen: false, reply: { filedAt: answer.filedAt, onTime: true, answeredAt: null } });
    // Its text is kept with the salt and the digest the server made, as an appeal's statement.
    const [stored] = await world.migrateDb.execute<{ statement: string; salted: boolean }>(sql`select statement, statement_salt is not null and statement_digest is not null as salted from suspension_replies where account_id = ${ada.id}::uuid`);
    expect({ ...stored! }).toEqual({ statement: "I want to explain these posts.", salted: true });
    // Once: a second reply is refused.
    const again = await ada.b.fetch(path, { json: {} });
    expect([again.status, await codeOf(again)]).toEqual([422, "reply_not_open"]);
    // A decision that holds no suspension or termination takes no reply.
    const [strike] = await n.apiDb.execute<{ id: string }>(sql`select d.id from decisions d join cases c on c.id = d.case_id join posts p on p.id = c.target_id where p.author_id = ${ada.id}::uuid limit 1`);
    expect((await ada.b.fetch(`/api/moderation/decisions/${strike!.id}/reply`, { json: {} })).status).toBe(404);
  });

  test("invariant 12: a reply after the start changes nothing by itself; a reply to a measure that has ended, or that was lifted, is refused", async () => {
    const late = await n.account();
    const lateMeasure = await announce(late);
    const fixed = await periodOf(lateMeasure.decisionId);
    await ageStandingForTest(world.migrateDb, late.id, `${STANDING_RULES.replyWindowHours + 1} hours`);
    expect((await stateOf(late.id))?.state).toBe("running");
    expect(await fileReply(n.deps, late.id, lateMeasure.decisionId, {})).toMatchObject({ onTime: false });
    expect((await stateOf(late.id))?.state).toBe("running");
    const after = await periodOf(lateMeasure.decisionId);
    expect(after.end! - after.start!).toBe(fixed.end! - fixed.start!);
    // A lift signed `replaced` is refused for a measure that runs: it withdraws only one that has not started.
    expect(await refused(admin, lateMeasure.caseId, { kind: "correction", reviewsDecisionId: lateMeasure.decisionId, actions: [act("lift_suspension")], replaced: true })).toBe("invalid_decision");

    const ended = await n.account();
    const endedMeasure = await announce(ended, 1);
    await ageStandingForTest(world.migrateDb, ended.id, `${STANDING_RULES.replyWindowHours + 25} hours`);
    expect(await stateOf(ended.id)).toBeNull();
    await expect(fileReply(n.deps, ended.id, endedMeasure.decisionId, {})).rejects.toMatchObject({ code: "reply_not_open" });

    const lifted = await n.account();
    const liftedMeasure = await announce(lifted);
    await decided(admin, liftedMeasure.caseId, { kind: "correction", reviewsDecisionId: liftedMeasure.decisionId, actions: [act("lift_suspension")] });
    await expect(fileReply(n.deps, lifted.id, liftedMeasure.decisionId, {})).rejects.toMatchObject({ code: "reply_not_open" });
    // Someone else's measure is not found.
    await expect(fileReply(n.deps, late.id, liftedMeasure.decisionId, {})).rejects.toMatchObject({ code: "not_found" });
  });

  test("a kept answer before the earliest start starts the suspension at that start, never sooner for having replied; its statement and mail say so, and the six months count again from the answer", async () => {
    const dan = await n.account();
    const { caseId, decisionId } = await announce(dan);
    expect((await fileReply(n.deps, dan.id, decisionId, { statement: "Please reconsider." })).onTime).toBe(true);
    expect((await stateOf(dan.id))?.state).toBe("held");
    // The same moderator may answer: the reply is the hearing, not the appeal.
    const kept = await decided(moderator, caseId, { kind: "correction", outcome: "kept", reviewsDecisionId: decisionId });
    const period = await periodOf(decisionId);
    expect(period.answeredBy).toBe(kept);
    expect(period.start).toBe(period.earliest);
    expect(period.end).toBe(period.earliest + 3 * DAY_MS);
    expect((await stateOf(dan.id))?.state).toBe("announced");
    const statement = (await decisionStatement(n.apiDb, kept))!.statement;
    expect(statement.repliedTo).toMatchObject({ onTime: true, kind: "suspend", days: 3, periodThen: { state: "not_started" } });
    expect(Date.parse(statement.repliedTo!.startsAt!)).toBe(period.earliest);
    // The six months count from the answer: later than from the decision.
    const fromDecision = appealDeadline(new Date(statement.reviewed!.decidedAt)).getTime();
    expect(Date.parse(statement.repliedTo!.appealUntil)).toBe(appealDeadline(new Date(statement.decidedAt)).getTime());
    expect(Date.parse(statement.repliedTo!.appealUntil)).toBeGreaterThan(fromDecision);
    const paragraphs = statementParagraphs(statement);
    expect(paragraphs[0]).toContain("and keeps that decision. The suspension of 3 days starts at");
    // 3e's review (people1): the suspension of the ladder rested on the terms, and its answer says so, never naming the rule.
    expect(statement.reviewed!.basis).toBe("strikes");
    expect(paragraphs).toContain(STATEMENT_WORDS.ground.restedOnTerms);
    expect(paragraphs.join(" ")).not.toContain("rested on korbat rule");
    expect(paragraphs[0]!.endsWith("with this answer, and never before the time you were first given.")).toBe(true);
    expect(paragraphs.at(-1)!.startsWith(REDRESS_TEXTS[2].replyAnswered!.slice(0, 40))).toBe(true);
    expect(n.mailer.to(dan.email, "reply_answered").map((mail) => mail.data.outcome)).toEqual(["kept"]);
    const view = await authorDecisionView(n.deps, dan.id, decisionId);
    expect(Date.parse(view.appealUntil!)).toBe(Date.parse(statement.repliedTo!.appealUntil));
    expect(view.standing).toMatchObject({ state: "announced", reply: { onTime: true, answeredBy: kept, text: "Please reconsider." }, replyOpen: false });
    // Nothing is left to answer: a second kept answer is refused.
    expect(await refused(moderator, caseId, { kind: "correction", outcome: "kept", reviewsDecisionId: decisionId })).toBe("invalid_decision");
  });

  test("a kept answer after the earliest start starts the suspension at the answer, and the appeal stays open six months from the answer while the decision's own six months have run out", async () => {
    const eve = await n.account();
    const { caseId, decisionId } = await announce(eve);
    expect((await fileReply(n.deps, eve.id, decisionId, {})).onTime).toBe(true);
    // The reply holds the start for months: nobody answered it.
    await ageStandingForTest(world.migrateDb, eve.id, "5 months");
    expect((await stateOf(eve.id))?.state).toBe("held");
    await decided(moderator, caseId, { kind: "correction", outcome: "kept", reviewsDecisionId: decisionId });
    const period = await periodOf(decisionId);
    expect(period.start).toBe(period.answeredAt);
    expect((await stateOf(eve.id))?.state).toBe("running");
    // Two months on, the decision is seven months old, and the appeal counts from the answer.
    await ageStandingForTest(world.migrateDb, eve.id, "2 months");
    const appealed = await fileAppeal(n.deps, eve.id, decisionId, {});
    expect(appealed.appeal).toMatchObject({ state: "pending" });
    const [final] = await n.apiDb.execute<{ final: Date | null }>(sql`select public.decision_final_at(${decisionId}::uuid) as final`);
    expect(final?.final).toBeNull();
    expect(n.mailer.to(eve.email, "reply_answered").map((mail) => mail.data.outcome)).toEqual(["kept"]);
  });

  test("a reversed answer: the suspension never starts, the statement leads with the reply and the lift, and the mail is reply_answered, reversed", async () => {
    const fay = await n.account();
    const { caseId, decisionId } = await announce(fay);
    await fileReply(n.deps, fay.id, decisionId, { statement: "I was hacked." });
    const reversal = await decided(moderator, caseId, { kind: "correction", reviewsDecisionId: decisionId, actions: [act("lift_suspension")] });
    expect(await stateOf(fay.id)).toBeNull();
    expect((await periodOf(decisionId)).answeredBy).toBe(reversal);
    const statement = (await decisionStatement(n.apiDb, reversal))!.statement;
    expect(statement.repliedTo).toMatchObject({ onTime: true, startsAt: null, endsAt: null, periodThen: { state: "not_started" } });
    const paragraphs = statementParagraphs(statement);
    expect(paragraphs[0]).toContain("and reversed that decision.");
    expect(paragraphs[1]!.startsWith("korbat lifted the suspension it announced on")).toBe(true);
    expect(n.mailer.to(fay.email, "reply_answered").map((mail) => mail.data.outcome)).toEqual(["reversed"]);
    expect(n.mailer.to(fay.email, "suspension_lifted")).toEqual([]);
  });

  test("a review that reverses part and keeps the suspension answers the reply as a kept answer does: the start is fixed, and its statement and mail say so", async () => {
    const gus = await n.account();
    const { decisionId } = await announce(gus, 3, [act("retire_handle")]);
    await fileAppeal(n.deps, gus.id, decisionId, {});
    await fileReply(n.deps, gus.id, decisionId, { statement: "My handle is my name." });
    const outcome = await world.reviewAs(second, decisionId, { outcome: "partly_reversed", actions: [act("unretire_handle")] });
    if (typeof outcome === "string") throw new Error(`the review was not recorded: ${outcome}`);
    const period = await periodOf(decisionId);
    expect(period.answeredBy).toBe(outcome.decisionId);
    expect(period.start).toBe(Math.max(period.earliest, period.answeredAt!));
    const paragraphs = statementParagraphs((await decisionStatement(n.apiDb, outcome.decisionId))!.statement);
    expect(paragraphs[0]).toContain("This also answers your reply of");
    expect(paragraphs[0]).toContain("The suspension of 3 days starts at");
    expect(n.mailer.to(gus.email, "reply_answered").map((mail) => mail.data.outcome)).toEqual(["kept"]);
  });

  test("a correction drafted before the reply is refused case_changed; the withdrawal for another measure closes the reply without an answer, is mailed as such, and makes room for a suspension at once", async () => {
    const hal = await n.account();
    const { caseId, decisionId } = await announce(hal);
    // A kept answer to a measure with no reply is no answer: refused.
    expect(await refused(admin, caseId, { kind: "correction", outcome: "kept", reviewsDecisionId: decisionId })).toBe("invalid_decision");
    // A correction drafted now, then the reply, then the key: the reply raised the case's version.
    const stale = await decisionParams(n.apiDb, admin, caseId, { kind: "correction", reviewsDecisionId: decisionId, actions: [act("lift_suspension")] });
    await fileReply(n.deps, hal.id, decisionId, { statement: "Please read this first." });
    await expect(world.moderation.forStaff.decide(admin.session, await world.confirm(admin, caseId, stale), { requestId: `req-${randomUUID()}` })).rejects.toMatchObject({ code: "case_changed" });
    // The withdrawal: a lift signed `replaced`, of a measure that has not started.
    const withdrawal = await decided(admin, caseId, { kind: "correction", reviewsDecisionId: decisionId, actions: [act("lift_suspension")], replaced: true });
    expect((await periodOf(decisionId)).answeredBy).toBe(withdrawal);
    const statement = (await decisionStatement(n.apiDb, withdrawal))!.statement;
    expect(statement.repliedTo).toBeUndefined();
    expect(statement.reversals[0]).toMatchObject({ kind: "lift_suspension", replaced: true, replyFiledAt: expect.any(String) });
    const paragraphs = statementParagraphs(statement);
    expect(paragraphs[0]!.endsWith("because it is taking another measure on your account. This is not a decision on your reply.")).toBe(true);
    expect(paragraphs.join(" ")).not.toMatch(/korbat read your reply|korbat corrected its decision/);
    expect(n.mailer.to(hal.email, "suspension_lifted").map((mail) => [mail.data.why, mail.data.replied])).toEqual([["replaced", "true"]]);
    expect(n.mailer.to(hal.email, "reply_answered")).toEqual([]);
    // Room is made: a suspension at once on a threat.
    const postId = await newPostRow(n.apiDb, hal.id, { createdAt: sql`clock_timestamp()`, body: "a direct threat" });
    const postCase = (await intake(n.apiDb, ground.finding(admin.id, "R5"), aPost(postId))).items[0]!.caseId!;
    await decided(admin, postCase, { kind: "final", ruleId: "R5", actions: [act("remove")] });
    await decided(admin, await accountCase(hal, "R5"), { kind: "final", ruleId: "R5", actions: [timed("suspend", 3, false)] });
    expect((await stateOf(hal.id))?.state).toBe("running");
  });

  test("this file left no row behind: what it committed is removed, and the tables hold what they held before it", async () => {
    await world.moderation.settle();
    await n.cleanUp();
    expect(await n.counts()).toEqual(before);
  });
});
