import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { MEASURES } from "@korbat/contracts";
import { REDRESS_TEXTS, STATEMENT_WORDS, statementParagraphs } from "@korbat/rules";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { BURST_ALERT_AT, BURST_WINDOW_MS, burstAlertKey } from "../../src/moderation/decide";
import { recordIntake } from "../../src/moderation/intake";
import { pendingAuthorMails, recentDecisionsBy } from "../../src/moderation/repo";
import { decisionStatement, mailSubjectOf, sendStatement } from "../../src/moderation/statement";
import { closeDecisions, deciderWorld, suspendForTest, type DeciderWorld, type RealStaff } from "./moderation-decide";
import { aPost, act, anAccount, authCaseCounts, ground, moderationCounts, newPostRow, saveText, untilBlocked } from "./moderation-fixtures";
import { noticesWorld, type NoticesWorld } from "./notices-harness";

// Every test signs decisions with a real staff key: on a loaded machine that takes longer than a test gets by default.
vi.setConfig({ testTimeout: 90_000 });

/**
 * What follows a decision's commit (3c design, section 7.5, step 4), and the statement it mails (section 10), against
 * the real database, the real auth module and a scripted mailer: the author's statement is mailed at once and its result
 * recorded; a burst of decisions by one staff account is told to every staff account; and the statement's data holds
 * what the decision did, as the author's screen and the console's preview render it. Every decision is confirmed with a
 * real staff key; what the tests store is removed again, and the file's last test holds it to leaving no row behind.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the statement of reasons and what follows a decision's commit", () => {
  let w: NoticesWorld;
  let d: DeciderWorld;
  let limits: MemoryStore;
  let moderator: RealStaff;
  let admin: RealStaff;
  let before: Record<string, number>;

  beforeAll(async () => {
    w = noticesWorld();
    limits = new MemoryStore();
    // The decisions' own module: the real auth module's mails over the world's scripted mailer, and a limit store the test reads.
    d = deciderWorld(w.apiDb, { auth: w.authForModeration, rateLimitStore: limits });
    before = await counts();
    moderator = await d.staff("moderator");
    admin = await d.staff("admin");
  }, 120_000);
  afterAll(async () => {
    await w.close();
  });

  /** How many rows the moderation tables and the four auth tables of moderation cases hold. */
  const counts = async (): Promise<Record<string, number>> => ({ ...(await moderationCounts(w.apiDb)), ...(await authCaseCounts(w.migrateDb)) });

  /** A post of a new account with an address, reported under a rule by another: its author, its id and its open case. */
  async function reportedPost(rule: "R1" | "R5" = "R1") {
    const [author, reporter] = [await w.account(), await w.account()];
    const postId = await newPostRow(w.apiDb, author.id);
    const recorded = await recordIntake(w.deps, { ground: ground.rule(reporter.id, rule), live: [aPost(postId)] });
    return { author, postId, caseId: recorded.items[0]!.caseId! };
  }
  /** The id of a decision that committed. */
  const decided = (outcome: Awaited<ReturnType<DeciderWorld["decideAs"]>>): string => {
    if (typeof outcome === "string") throw new Error(`the decision was not recorded: ${outcome}`);
    return outcome.decisionId;
  };
  const mailState = async (decisionId: string) => {
    const [row] = await w.apiDb.execute<{ author_mail: string; mailed: boolean }>(sql`select author_mail, author_mail_at is not null as mailed from decisions where id = ${decisionId}::uuid`);
    return { ...row! };
  };
  const statementOf = async (decisionId: string) => (await decisionStatement(w.apiDb, decisionId))!;
  const addressOf = async (staff: RealStaff) => (await w.repo.findUserById(staff.id))!.email;

  test("the author's statement is mailed at once, as the statement's own paragraphs, and recorded sent", async () => {
    const { author, postId, caseId } = await reportedPost();
    const id = decided(await d.decideAs(moderator, caseId, { kind: "interim", actions: [act("withhold")] }));
    const mails = w.mailer.to(author.email, "moderation_decision");
    expect(mails).toHaveLength(1);
    const found = await statementOf(id);
    // One function renders the statement for the mail, the author's screen and the console's preview.
    expect(mails[0]!.data).toEqual({ subject: "post_deciding", statement: statementParagraphs(found.statement).join("\n") });
    expect(found.statement).toMatchObject({
      kind: "interim",
      outcome: "restricted",
      ground: "incompatible",
      ruleId: "R1",
      source: "report",
      post: { id: postId },
      measures: [{ kind: "withhold", mediaId: null, noEffect: null, sealed: null }],
      reversals: [],
      endedMeasures: [],
      reviewed: null,
    });
    expect(mails[0]!.data.statement).toContain(REDRESS_TEXTS[1].interim);
    expect(await mailState(id)).toEqual({ author_mail: "sent", mailed: true });
    // Nothing else of the decision reached anyone: no reporter is mailed about a decision taken while deciding.
    expect(w.mailer.sent.filter((mail) => mail.template === "moderation_decision")).toHaveLength(1);
  });

  test("a relay failure leaves the statement pending for the dispatch job; a refused address is recorded failed; a purged account has no address", async () => {
    const waiting = await reportedPost();
    w.mailer.mode = "fail";
    const pending = decided(await d.decideAs(moderator, waiting.caseId, { kind: "interim", actions: [act("withhold")] }));
    expect(await mailState(pending)).toEqual({ author_mail: "pending", mailed: false });
    const refused = await reportedPost();
    w.mailer.mode = "refuse";
    const failed = decided(await d.decideAs(moderator, refused.caseId, { kind: "interim", actions: [act("withhold")] }));
    expect(await mailState(failed)).toEqual({ author_mail: "failed", mailed: false });
    w.mailer.mode = "deliver";
    // An account whose auth row is gone, as the purge leaves it: the decision stands, and there is nobody to mail.
    const gone = await reportedPost();
    await w.repo.markDeleted(gone.author.id, new Date());
    const unaddressed = decided(await d.decideAs(moderator, gone.caseId, { kind: "interim", actions: [act("withhold")] }));
    expect(await mailState(unaddressed)).toEqual({ author_mail: "no_address", mailed: false });
    expect(w.mailer.to(gone.author.email, "moderation_decision")).toHaveLength(0);
  });

  test("a closing no-action decision that ends a withhold taken while deciding tells the author, names the ended measure, and cannot be appealed", async () => {
    const { author, caseId } = await reportedPost();
    decided(await d.decideAs(moderator, caseId, { kind: "interim", actions: [act("withhold")] }));
    const closing = decided(await d.decideAs(moderator, caseId, { kind: "final", outcome: "no_violation" }));
    const { statement } = await statementOf(closing);
    expect(statement).toMatchObject({ kind: "final", outcome: "no_violation", ground: null, measures: [], endedMeasures: [{ kind: "withhold", mediaId: null, resetDecisionId: null, oldValueKept: false }] });
    const paragraphs = statementParagraphs(statement);
    expect(paragraphs[0]).toBe(STATEMENT_WORDS.ended(MEASURES.withhold.label));
    expect(paragraphs.at(-1)).toBe(REDRESS_TEXTS[1].notAppealable);
    const mails = w.mailer.to(author.email, "moderation_decision");
    expect(mails.map((mail) => mail.data.subject)).toEqual(["post_deciding", "lifted_deciding"]);
    expect(await mailState(closing)).toEqual({ author_mail: "sent", mailed: true });
    // A decision that told its author nothing mails nothing: a no-action decision on a case without a measure.
    const quiet = await reportedPost();
    const silent = decided(await d.decideAs(moderator, quiet.caseId, { kind: "final", outcome: "no_violation" }));
    expect(await mailState(silent)).toEqual({ author_mail: "none", mailed: false });
    expect(w.mailer.to(quiet.author.email)).toHaveLength(0);
  });

  test("a decision without a measure keeps its facts and its reason from its author: the statement's data and its mail hold neither, and the case's answer shows both to staff", async () => {
    const { author, caseId } = await reportedPost();
    decided(await d.decideAs(moderator, caseId, { kind: "interim", actions: [act("withhold")] }));
    // The closing decision restricts nothing, and its two texts are written and saved as the console saves them.
    const [facts, reason] = [`What the answer rested on, for staff ${randomUUID()}.`, `Why nothing was done, for staff ${randomUUID()}.`];
    const digests = { factsDigest: await saveText(w.apiDb, caseId, moderator.id, "facts", facts), reasonDigest: await saveText(w.apiDb, caseId, moderator.id, "reason", reason) };
    const closing = decided(await d.decideAs(moderator, caseId, { kind: "final", outcome: "no_violation", ...digests }));
    // The decision's row names both texts: they are the case's record.
    const [row] = await w.apiDb.execute<{ facts: string | null; reason: string | null }>(sql`select facts_digest as facts, reason_digest as reason from decisions where id = ${closing}::uuid`);
    expect(row).toEqual({ facts: digests.factsDigest, reason: digests.reasonDigest });
    // Its author is told that the withhold has ended, and nothing of the two texts: the statement's data holds neither.
    const { statement } = await statementOf(closing);
    expect(statement).toMatchObject({ kind: "final", outcome: "no_violation", measures: [], reversals: [], endedMeasures: [{ kind: "withhold" }], facts: null, reason: null });
    const paragraphs = statementParagraphs(statement);
    expect(paragraphs[0]).toBe(STATEMENT_WORDS.ended(MEASURES.withhold.label));
    const mails = w.mailer.to(author.email, "moderation_decision");
    expect(mails.map((mail) => mail.data.subject)).toEqual(["post_deciding", "lifted_deciding"]);
    expect(mails[1]!.data.statement).toBe(paragraphs.join("\n"));
    for (const told of [paragraphs.join("\n"), JSON.stringify(mails[1]!.data)]) {
      expect(told).not.toContain(facts);
      expect(told).not.toContain(reason);
      expect(told).not.toContain("The facts:");
      expect(told).not.toContain("korbat's reasons:");
    }
    // The withhold's own statement, of a decision that restricts, holds its two texts as before.
    expect(mails[0]!.data.statement).toMatch(/The facts: a facts text /);
    expect(mails[0]!.data.statement).toMatch(/korbat's reasons: a reason text /);
    // Staff read both on the case, in the console's own answer.
    const view = await d.moderation.forStaff.caseView(moderator.session, caseId);
    expect(view.decisions.find((decision) => decision.id === closing)).toMatchObject({ kind: "final", outcome: "no_violation", facts, reason });
  });

  test("a measure taken while deciding on a post its author has deleted tells nobody: no statement is owed, none is sent, and none waits for the dispatch job", async () => {
    const { author, postId, caseId } = await reportedPost();
    await w.apiDb.execute(sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${postId}::uuid`);
    const attempts = w.mailer.attempts.length;
    const quiet = decided(await d.decideAs(moderator, caseId, { kind: "interim", actions: [act("withhold")] }));
    // The measure can never take effect, so its author is told nothing: the decision is recorded without a mail.
    expect((await statementOf(quiet)).statement.measures).toEqual([{ kind: "withhold", mediaId: null, noEffect: "deleted", sealed: null }]);
    expect(await mailState(quiet)).toEqual({ author_mail: "none", mailed: false });
    expect(w.mailer.attempts.slice(attempts).filter((mail) => mail.to === author.email)).toEqual([]);
    // Nothing is pending: the dispatch job finds no statement to send for it, however old the decision is.
    expect(await pendingAuthorMails(w.apiDb, new Date(Date.now() + 24 * 60 * 60_000))).not.toContain(quiet);
    expect(await sendStatement(w.deps, quiet)).toBe("none");
  });

  test("a final restriction carries the appeal; a correction of it is told as a reversal, rendered from the corrected decision's own rule", async () => {
    const { author, caseId } = await reportedPost();
    const removal = decided(await d.decideAs(moderator, caseId, { kind: "final", ruleId: "R6", actions: [act("remove")] }));
    const first = await statementOf(removal);
    expect(mailSubjectOf(first.statement)).toBe("post_restricted");
    expect(statementParagraphs(first.statement).at(-1)).toMatch(/^You can appeal this decision once/);
    const correction = decided(await d.decideAs(moderator, caseId, { kind: "correction", reviewsDecisionId: removal, actions: [act("restore")] }));
    const second = await statementOf(correction);
    expect(second.statement).toMatchObject({
      kind: "correction",
      outcome: "reversed",
      ground: null,
      ruleId: null,
      facts: null,
      // 3e: a full reversal of a removal that gave a strike also overrules the strike (the console and the fixtures sign it).
      reversals: [
        { kind: "restore", mediaId: null, resetDecisionId: null, oldValueKept: false, resetRuleId: null },
        { kind: "overrule", mediaId: null, resetDecisionId: null, oldValueKept: false, resetRuleId: null },
      ],
      reviewed: { kind: "final", ground: "incompatible", ruleId: "R6", rulesVersion: first.statement.rulesVersion, decidedAt: first.statement.decidedAt },
    });
    expect(statementParagraphs(second.statement).join("\n")).toContain("That decision rested on korbat rule R6");
    expect(w.mailer.to(author.email, "moderation_decision").map((mail) => mail.data.subject)).toEqual(["post_restricted", "reversed"]);
  });

  test("an account's fields: a reset taken while deciding that ends with the closing decision says that the old value does not come back, and where it can still be read", async () => {
    const [subject, reporter] = [await w.account(), await w.account()];
    await w.apiDb.execute(sql`update profiles set bio = 'a bio that breaks a rule' where id = ${subject.id}::uuid`);
    const recorded = await recordIntake(w.deps, { ground: ground.rule(reporter.id, "R6"), live: [anAccount(subject.id, subject.handle)] });
    const caseId = recorded.items[0]!.caseId!;
    const reset = decided(await d.decideAs(moderator, caseId, { kind: "interim", ruleId: "R6", actions: [act("reset_bio")] }));
    expect(mailSubjectOf((await statementOf(reset)).statement)).toBe("profile_deciding");
    const closing = decided(await d.decideAs(moderator, caseId, { kind: "final", outcome: "no_violation" }));
    const { statement } = await statementOf(closing);
    expect(statement.post).toBeNull();
    expect(statement.endedMeasures).toEqual([{ kind: "reset_bio", mediaId: null, resetDecisionId: reset, oldValueKept: true, resetRuleId: "R6" }]);
    expect(statementParagraphs(statement)[0]).toBe(`${STATEMENT_WORDS.ended(MEASURES.reset_bio.label)} ${STATEMENT_WORDS.field("bio")} ${STATEMENT_WORDS.oldValueKept}`);
    expect(w.mailer.to(subject.email, "moderation_decision").map((mail) => mail.data.subject)).toEqual(["profile_deciding", "lifted_deciding"]);
  });

  test("twenty decisions by one staff account in the last 15 minutes are told to every staff account, the person's own included, at most once an hour", async () => {
    // A staff account of its own, so that only this test's decisions are counted; each one is made here, with the key.
    const busy = await d.staff("moderator");
    const [busyMail, adminMail] = [await addressOf(busy), await addressOf(admin)];
    const bursts = () => w.mailer.sent.filter((mail) => mail.template === "moderation_burst");
    const cases: string[] = [];
    for (let n = 0; n < 10; n++) cases.push((await reportedPost()).caseId);
    // Nineteen decisions raise nothing: a withhold on each of ten cases, and nine of them closed.
    for (const caseId of cases) decided(await d.decideAs(busy, caseId, { kind: "interim", actions: [act("withhold")] }));
    for (const caseId of cases.slice(0, 9)) decided(await d.decideAs(busy, caseId, { kind: "final", outcome: "no_violation" }));
    expect(await recentDecisionsBy(w.apiDb, busy.id, BURST_WINDOW_MS)).toBe(BURST_ALERT_AT - 1);
    expect(bursts()).toHaveLength(0);
    // The twentieth: every staff account, the person's own included, with the person's handle and the count.
    decided(await d.decideAs(busy, cases[9]!, { kind: "final", outcome: "no_violation" }));
    const recipients = bursts().map((mail) => mail.to);
    expect(recipients).toEqual(expect.arrayContaining([busyMail, adminMail]));
    expect(new Set(bursts().map((mail) => JSON.stringify(mail.data)))).toEqual(new Set([JSON.stringify({ handle: busy.handle, count: String(BURST_ALERT_AT) })]));
    // The twenty-first, inside the hour: counted, and not told again.
    const told = bursts().length;
    const next = await reportedPost();
    decided(await d.decideAs(busy, next.caseId, { kind: "interim", actions: [act("withhold")] }));
    expect(bursts()).toHaveLength(told);
    // Another staff account's decisions are counted on their own.
    const other = await reportedPost();
    decided(await d.decideAs(admin, other.caseId, { kind: "interim", actions: [act("withhold")] }));
    expect(bursts()).toHaveLength(told);
    // The count is the person's rows of the last 15 minutes by the database's clock, whatever the limit store holds:
    // all 21 lie inside that window, and none inside its last millisecond.
    expect(await recentDecisionsBy(w.apiDb, busy.id, BURST_WINDOW_MS)).toBe(BURST_ALERT_AT + 1);
    expect(await recentDecisionsBy(w.apiDb, busy.id, 1)).toBe(0);
    // The alert's throttle is one key of the shared limit store with a window of an hour: the twentieth decision opened
    // it, the twenty-first met it, and this read is its third hit.
    const throttle = await limits.hit(burstAlertKey(busy.id), 60 * 60_000);
    expect(burstAlertKey(busy.id)).toBe(`moderation-burst:${busy.id}`);
    expect(throttle.count).toBe(3);
    expect(throttle.resetMs).toBeGreaterThan(59 * 60_000);
    expect(throttle.resetMs).toBeLessThanOrEqual(60 * 60_000);
  });

  test("3e: an announced suspension's statement is mailed as suspension_announced, and its outcome is recorded under the subject's profile lock, taken after the send and right before the record: a holder of the profile holds the record back, never the mail", async () => {
    const author = await w.account();
    // Through the decide route's own code, mailed by no auth module: the statement waits, pending, for this test.
    const { decisionId } = await suspendForTest(w.apiDb, author.id, { announced: true });
    expect((await mailState(decisionId)).author_mail).toBe("pending");
    const statement = (await statementOf(decisionId)).statement;
    expect(statement.measures.find((measure) => measure.kind === "suspend")).toMatchObject({ announced: true, days: 3, basis: "strikes" });
    // Another transaction holds the account's profile, as a decision about the account does.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let held!: () => void;
    const holding = new Promise<void>((resolve) => (held = resolve));
    const holder = w.migrateDb.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '30s'`);
      await tx.execute(sql`select 1 from profiles where id = ${author.id}::uuid for update`);
      held();
      await gate;
    });
    try {
      await holding;
      const sending = sendStatement(w.deps, decisionId);
      await untilBlocked(w.apiDb, "order by id for no key update");
      // 3e's review (database3): the mail went before the profile was asked for, so a relay that stalls never holds the
      // account's row; the record waits at the profile, holding the decision's row it took before the send.
      expect(w.mailer.to(author.email, "suspension_announced")).toHaveLength(1);
      const second = await w.apiDb
        .transaction(async (tx) => {
          await tx.execute(sql`set local lock_timeout = '1s'`);
          await tx.execute(sql`select id from decisions where id = ${decisionId}::uuid for no key update`);
        })
        .then(
          () => "taken",
          () => "held",
        );
      expect(second).toBe("held");
      release();
      await holder;
      expect(await sending).toBe("sent");
    } finally {
      release();
      await holder.catch(() => undefined);
    }
    expect(await mailState(decisionId)).toEqual({ author_mail: "sent", mailed: true });
    const [mail] = w.mailer.to(author.email, "suspension_announced");
    expect(mail?.data).toMatchObject({ measure: "suspend", days: "3", statement: statementParagraphs(statement).join(String.fromCharCode(10)) });
    expect(w.mailer.to(author.email, "moderation_decision").map((sent) => sent.data.statement)).not.toContain(mail!.data.statement);
    await closeDecisions();
  });

  test("this file left no row behind: the moderation tables and the four auth tables of moderation cases hold what they held before it", async () => {
    await closeDecisions();
    await w.cleanUp();
    await d.close();
    expect(await counts()).toEqual(before);
  });
});
