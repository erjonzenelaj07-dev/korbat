import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { DAILY_LIMITS, DecisionView } from "@korbat/contracts";
import { closeDb, createDb } from "@korbat/db";
import { STATEMENT_WORDS, statementParagraphs } from "@korbat/rules";
import { auditVerify } from "../../src/cli/staff";
import { loadConfig } from "../../src/config";
import { MemoryJobLock, type JobLock } from "../../src/lib/jobs";
import { renderMail } from "../../src/mail/templates";
import { appealsList, fileAppeal } from "../../src/moderation/appeals";
import { authorCases, authorDecisionView } from "../../src/moderation/author";
import { overview, readCase } from "../../src/moderation/cases";
import { ModerationError } from "../../src/moderation/context";
import { dispatchRound } from "../../src/moderation/dispatch";
import { noticeStatus, recordIntake, submitNotice } from "../../src/moderation/intake";
import { deciderWorld, type DeciderWorld, type RealStaff } from "./moderation-decide";
import {
  aPost,
  act,
  appealOf,
  authCaseCounts,
  decisionParams,
  gate,
  ground,
  imageStates,
  inForce,
  moderationCounts,
  newImageRow,
  newPostRow,
  postRow,
  refusal,
  untilBlocked,
  type DecisionInput,
  type ReviewInput,
} from "./moderation-fixtures";
import { noticesWorld, notices, postTarget, type NoticesWorld } from "./notices-harness";
import { withLockTimeout } from "./staff-fixtures";

// Every test signs several decisions with real staff keys, and some run a dispatch round: more than a test gets by default.
vi.setConfig({ testTimeout: 180_000 });

const MIN = 60_000;
const HOUR = 60 * MIN;

/**
 * Appeals and reviews as flows (3c design, sections 7.7 and 12), against the real database, the real auth module and a
 * scripted mailer: the author appeals, a different person reviews with a real staff key, and at each step what the
 * author reads and is mailed, what the console lists, what every staff account is mailed, and what whoever reported
 * reads after the daily release. Then the races the database settles: an appeal against a correction that reverses
 * everything, two appeals at once, and a report into an open case while an appeal is being filed. The file's last test
 * holds it to leaving no row behind.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: appeals and reviews, from the author's appeal to the review's answer", () => {
  let w: NoticesWorld;
  let d: DeciderWorld;
  /** Two moderators and two admins: whoever decides, someone else of the needed role is left to review. */
  let mod: RealStaff;
  let mod2: RealStaff;
  let admin: RealStaff;
  let admin2: RealStaff;
  let lock: JobLock;
  let before: Record<string, number>;
  /** How far the dispatch job's clock stands ahead of the real one. */
  let aheadMs = 0;

  beforeAll(async () => {
    w = noticesWorld();
    w.deps.now = () => new Date(Date.now() + aheadMs);
    lock = new MemoryJobLock(() => Date.now() + aheadMs);
    d = deciderWorld(w.apiDb, { auth: w.authForModeration, rateLimitStore: w.deps.limits });
    before = await counts();
    mod = await d.staff("moderator");
    mod2 = await d.staff("moderator");
    admin = await d.staff("admin");
    admin2 = await d.staff("admin");
  }, 180_000);
  afterAll(async () => {
    await w.close();
  });

  const counts = async (): Promise<Record<string, number>> => ({ ...(await moderationCounts(w.apiDb)), ...(await authCaseCounts(w.migrateDb)) });
  /** The next daily release: the dispatch hour is moved to the next full hour at least twenty minutes on, the clock to a minute past it, and a round runs. */
  async function released() {
    const next = (Math.floor((Date.now() + aheadMs + 20 * MIN) / HOUR) + 1) * HOUR;
    w.deps.config = { ...w.deps.config, MODERATION_DISPATCH_HOUR: new Date(next).getUTCHours() };
    aheadMs += next + MIN - (Date.now() + aheadMs);
    w.ahead.limitsMs = aheadMs;
    expect(await dispatchRound(w.deps, lock)).toMatchObject({ marked: true, daily: true });
  }
  const decided = async (staff: RealStaff, caseId: string, input: DecisionInput) => {
    const outcome = await d.decideAs(staff, caseId, input);
    if (typeof outcome === "string") throw new Error(`the decision was not recorded: ${outcome}`);
    return outcome.decisionId;
  };
  const reviewed = async (staff: RealStaff, decisionId: string, input: ReviewInput = {}) => {
    const outcome = await d.reviewAs(staff, decisionId, input);
    if (typeof outcome === "string") throw new Error(`the review was not recorded: ${outcome}`);
    return outcome.decisionId;
  };
  const settled = <T>(promise: Promise<T>) => promise.then((value) => value as unknown, (err: unknown) => err);
  /** The statements mailed to this address, in order: each mail's subject key and its paragraphs. */
  const statements = (address: string) => w.mailer.to(address, "moderation_decision").map((mail) => ({ subject: mail.data.subject, paragraphs: mail.data.statement!.split("\n") }));
  /** The mails that told this staff account of a decision that lifted the protection of reported images. */
  const lifted = async (staff: RealStaff) => w.mailer.to((await w.repo.findUserById(staff.id))!.email, "moderation_csam_lifted").map((mail) => mail.data);
  const appealsOf = async (decisionId: string) =>
    (await w.migrateDb.execute<{ id: string; result: string | null; answered_by: string | null }>(sql`select id, result, answered_by from appeals where decision_id = ${decisionId}::uuid`)).map((row) => ({ ...row }));

  /** A post of a new account with this many images, reported under a rule by another new account, and its open case. */
  async function reportedPost(images = 0) {
    const [author, reporter] = [await w.account(), await w.account()];
    const postId = await newPostRow(w.apiDb, author.id);
    const mediaIds: string[] = [];
    for (let position = 0; position < images; position++) mediaIds.push(await newImageRow(w.apiDb, author.id, postId, position));
    const caseId = (await recordIntake(w.deps, { ground: ground.rule(reporter.id), live: [aPost(postId)] })).items[0]!.caseId!;
    return { author, reporter, postId, mediaIds, caseId };
  }
  /** The same, removed by the first moderator's final decision. */
  async function removedPost(images = 0) {
    const r = await reportedPost(images);
    return { ...r, decisionId: await decided(mod, r.caseId, { kind: "final", actions: [act("remove")] }) };
  }

  test("the author appeals a removal once: it waits for a reviewer at once on their screen and in the console's list, which carries no statement; a second appeal, someone else's and the sixth of a day are refused", async () => {
    const r = await removedPost();
    const until = (await authorDecisionView(w.deps, r.author.id, r.decisionId)).appealUntil;
    expect(until).not.toBeNull();
    const waiting = (await overview(w.deps, mod2.session)).appealsWaiting;

    const view = await fileAppeal(w.deps, r.author.id, r.decisionId, { statement: "The post quotes a film. Please look again." });
    // The answer is the decision as its author now reads it: no further appeal, and this one waiting for someone who may review it.
    expect(DecisionView.parse(view)).toEqual(view);
    expect(view).toMatchObject({ id: r.decisionId, appealUntil: null, appeal: { state: "pending", reviewer: "available", needsAdmin: false } });
    expect((await authorCases(w.deps, r.author.id)).decisions).toEqual([expect.objectContaining({ id: r.decisionId, appealUntil: null, appeal: "pending" })]);

    // One appeal for each decision; the reporter, a stranger and an id that names nothing get one answer.
    expect(await refusal(fileAppeal(w.deps, r.author.id, r.decisionId, {}))).toBe("appeal_exists");
    expect(await refusal(fileAppeal(w.deps, r.reporter.id, r.decisionId, {}))).toBe("appeal_not_open");
    expect(await refusal(fileAppeal(w.deps, r.reporter.id, randomUUID(), {}))).toBe("appeal_not_open");
    expect(await appealsOf(r.decisionId)).toEqual([{ id: expect.any(String), result: null, answered_by: null }]);
    // Five appeals a day for one account, whatever became of each: the reporter has used two.
    for (let n = 3; n <= DAILY_LIMITS.appeals; n++) expect(await refusal(fileAppeal(w.deps, r.reporter.id, randomUUID(), {})), String(n)).toBe("appeal_not_open");
    const sixth = await settled(fileAppeal(w.deps, r.reporter.id, randomUUID(), {}));
    expect(sixth).toBeInstanceOf(ModerationError);
    expect(sixth).toMatchObject({ code: "rate_limited", status: 429 });

    // The console: the appeal waits, the moderator who removed the post may not review it, anyone else may.
    const rowFor = async (staff: RealStaff) => (await appealsList(w.deps, staff.session)).appeals.find((row) => row.decisionId === r.decisionId);
    // 3e: the removal under a rule gave the post its strike, which the row lists among the decision's actions.
    expect(await rowFor(mod2)).toMatchObject({ caseId: r.caseId, ruleId: "R1", legal: false, actions: ["remove", "strike"], deadline: until, reviewer: "available", needsAdmin: false, mayReview: true });
    expect((await rowFor(mod))!.mayReview).toBe(false);
    expect(JSON.stringify(await appealsList(w.deps, mod2.session))).not.toContain("film");
    expect(await overview(w.deps, mod2.session)).toMatchObject({ appealsWaiting: waiting + 1 });
    expect((await overview(w.deps, mod2.session)).appealsYouMayReview).toBe((await overview(w.deps, mod.session)).appealsYouMayReview + 1);
    // The reviewer reads the statement on the case page.
    expect((await readCase(w.deps, mod2.session, r.caseId)).appeals).toEqual([expect.objectContaining({ decisionId: r.decisionId, statement: "The post quotes a film. Please look again.", reviewer: "available", mayReview: true })]);
    expect((await readCase(w.deps, mod.session, r.caseId)).appeals[0]).toMatchObject({ mayReview: false });
  });

  test("a kept review by a second moderator: the first is refused, the author is mailed the review's statement and reads it on the decision's screen, and the post's chip still names the removal", async () => {
    const r = await removedPost();
    await fileAppeal(w.deps, r.author.id, r.decisionId, {});
    expect(await refusal(d.reviewAs(mod, r.decisionId))).toBe("reviewer_conflict");
    const review = await reviewed(mod2, r.decisionId);

    // The record: one appeals_reviewed row on the reviewed decision, naming the review.
    const [audit] = await w.migrateDb.execute<{ action: string; target_type: string; target_id: string; actor_id: string }>(sql`select action, target_type, target_id, actor_id from audit_log where metadata ->> 'decisionId' = ${review}`);
    expect({ ...audit! }).toEqual({ action: "appeals_reviewed", target_type: "decision", target_id: r.decisionId, actor_id: mod2.id });
    expect(await appealsOf(r.decisionId)).toEqual([{ id: expect.any(String), result: "kept", answered_by: review }]);
    expect(await postRow(w.apiDb, r.postId)).toMatchObject({ level: "removed" });
    // The whole record, the review's row included, as the command line checks it.
    const connections = { api: createDb(loadConfig().DATABASE_URL_API, { max: 1 }), auth: createDb(loadConfig().DATABASE_URL_AUTH, { max: 1 }) };
    try {
      expect(await auditVerify(connections, [])).toMatchObject({ ok: true, problems: [], problemCount: 0 });
    } finally {
      await Promise.all([closeDb(connections.api), closeDb(connections.auth)]);
    }

    // The author: the mail, the list and the decision's screen tell the same.
    const mails = statements(r.author.email);
    expect(mails.map((mail) => mail.subject)).toEqual(["post_restricted", "appeal_kept"]);
    const view = await authorDecisionView(w.deps, r.author.id, r.decisionId);
    expect(view.appeal).toMatchObject({ state: "answered", result: "kept", answeredBy: review, answeredOn: new Date().toISOString().slice(0, 10) });
    const answer = view.appeal!.state === "answered" ? view.appeal!.statement : null;
    expect(statementParagraphs(answer!)).toEqual(mails[1]!.paragraphs);
    expect(mails[1]!.paragraphs[0]).toBe(STATEMENT_WORDS.reviewed(`${answer!.reviewed!.decidedAt.slice(0, 10)} ${answer!.reviewed!.decidedAt.slice(11, 16)} UTC`, "kept"));
    expect(mails[1]!.paragraphs.some((paragraph) => paragraph.startsWith("Why korbat kept it: "))).toBe(true);
    const listed = (await authorCases(w.deps, r.author.id)).decisions;
    expect(listed.map((row) => [row.kind, row.outcome, row.appeal])).toEqual([
      ["review", "kept", null],
      ["final", "restricted", "kept"],
    ]);
    // The review has a screen of its own, and cannot be appealed.
    expect(await authorDecisionView(w.deps, r.author.id, review)).toMatchObject({ kind: "review", outcome: "kept", appealUntil: null, appeal: null });
    expect(await refusal(fileAppeal(w.deps, r.author.id, review, {}))).toBe("appeal_not_open");
    // The chip of the removed post names the decision that removed it, not the review.
    expect((await w.moderation.forSocial.authorFacts(r.author.id, [r.postId])).get(r.postId)).toMatchObject({ decisionId: r.decisionId, ruleId: "R1", interim: false });
    // A later case removes the same post again, under another rule: the chip names the newer removal.
    const again = (await recordIntake(w.deps, { ground: ground.rule((await w.account()).id, "R3"), live: [aPost(r.postId)] })).items[0]!.caseId!;
    expect(again).not.toBe(r.caseId);
    const newer = await decided(mod2, again, { kind: "final", ruleId: "R3", actions: [act("remove")] });
    expect((await w.moderation.forSocial.authorFacts(r.author.id, [r.postId])).get(r.postId)).toMatchObject({ decisionId: newer, ruleId: "R3" });
  });

  test("a moderator lifts early what another withheld while deciding on a report of a threat: no admin is needed, the post is shown again and its author is told at once", async () => {
    const [author, reporter] = [await w.account(), await w.account()];
    const postId = await newPostRow(w.apiDb, author.id);
    const caseId = (await recordIntake(w.deps, { ground: ground.rule(reporter.id, "R5"), live: [aPost(postId)] })).items[0]!.caseId!;
    // Whoever is on duty withholds a reported threat at once; its final decision is an admin's.
    const withheld = await decided(mod, caseId, { kind: "interim", ruleId: "R5", actions: [act("withhold")] });
    expect(await refusal(d.decideAs(mod2, caseId, { kind: "final", ruleId: "R5", actions: [act("remove")] }))).toBe("admin_required");
    expect(await postRow(w.apiDb, postId)).toMatchObject({ level: "withheld" });
    // The measure cannot be appealed, and anyone eligible may lift it early.
    expect(await refusal(fileAppeal(w.deps, author.id, withheld, {}))).toBe("appeal_not_open");
    await decided(mod2, caseId, { kind: "correction", reviewsDecisionId: withheld, actions: [act("restore")] });
    expect(await postRow(w.apiDb, postId)).toMatchObject({ state: "visible", level: "visible" });
    expect(statements(author.email).map((mail) => mail.subject)).toEqual(["post_deciding", "lifted_deciding"]);
    // The case stays open for the admin, who answers it.
    await decided(admin, caseId, { kind: "final", outcome: "no_violation" });
  });

  test("a review that reverses: the post is shown again, the author is told, and whoever sent the notice reads the new outcome at the next release, final within korbat", async () => {
    const author = await w.account();
    const postId = await newPostRow(w.apiDb, author.id);
    const email = w.address();
    const notice = w.remember(await submitNotice(w.deps, notices.illegal([postTarget(postId)], { email }), w.sender()));
    await w.moderation.settle();
    const caseId = (await w.items(notice.ref))[0]!.case_id!;
    const removal = await decided(mod, caseId, { kind: "final", actions: [act("remove")] });
    await released();
    const page = async () => (await noticeStatus(w.deps, { ref: notice.ref, token: notice.token! }, w.sender().netHash)).items[0]!;
    expect(await page()).toMatchObject({ outcome: "restricted_rule", changed: false });

    await fileAppeal(w.deps, author.id, removal, {});
    const review = await reviewed(mod2, removal, { outcome: "reversed", actions: [act("restore")] });
    expect(await postRow(w.apiDb, postId)).toMatchObject({ state: "visible", level: "visible" });
    expect(await inForce(w.apiDb, { caseId })).toEqual([]);
    expect(statements(author.email).map((mail) => mail.subject)).toEqual(["post_restricted", "reversed"]);
    expect(await authorDecisionView(w.deps, author.id, removal)).toMatchObject({ reversedOn: expect.any(String), appeal: { state: "answered", result: "reversed", answeredBy: review } });
    // Until the next release the notifier reads what they were told.
    expect(await page()).toMatchObject({ outcome: "restricted_rule", changed: false });

    const updatesBefore = w.mailer.updatesTo(email).length;
    await released();
    // The new outcome cannot be examined again: it is final within korbat, on the page and in the mail.
    expect(await page()).toMatchObject({ outcome: "reversed", changed: true, reexamines: false, reexamination: null });
    const updates = w.mailer.updatesTo(email);
    expect(updates).toHaveLength(updatesBefore + 1);
    expect(updates.at(-1)!.data.lines).toEqual([expect.objectContaining({ ref: notice.ref, item: 1, changed: true, reexamination: false, reexaminable: false, outcome: "korbat reversed its decision to restrict it." })]);
    expect(renderMail(updates.at(-1)!).text).toContain("A decision changed on review or by a correction, or given on re-examination, is final within korbat.");
  });

  test("an appeal of a seal for good waits for an admin: a moderator's review that lifts it is refused, a second admin's is recorded, the images are shown again, and every staff account is mailed at once", async () => {
    const author = await w.account();
    const postId = await newPostRow(w.apiDb, author.id);
    const mediaIds = [await newImageRow(w.apiDb, author.id, postId, 0), await newImageRow(w.apiDb, author.id, postId, 1)];
    const notice = w.remember(await submitNotice(w.deps, notices.csam([postTarget(postId)]), w.sender()));
    await w.moderation.settle();
    const caseId = (await w.items(notice.ref))[0]!.case_id!;
    const seal = await decided(admin, caseId, { kind: "final", ruleId: "R2", actions: [act("seal_media")] });
    expect(await imageStates(w.apiDb, mediaIds)).toEqual(["sealed", "sealed"]);

    // The author's screen says that the review is an admin's; the console marks it so, and offers it to the other admin alone.
    const view = await fileAppeal(w.deps, author.id, seal, {});
    expect(view.appeal).toEqual({ state: "pending", filedAt: expect.any(String), reviewer: "available", needsAdmin: true });
    expect(view.measures.map((measure) => measure.kind)).toEqual(["seal_media"]);
    const rowFor = async (staff: RealStaff) => (await appealsList(w.deps, staff.session)).appeals.find((row) => row.decisionId === seal);
    expect(await rowFor(mod2)).toMatchObject({ needsAdmin: true, mayReview: false, actions: ["seal_media"] });
    expect(await rowFor(admin)).toMatchObject({ needsAdmin: true, mayReview: false });
    expect(await rowFor(admin2)).toMatchObject({ needsAdmin: true, mayReview: true });

    const lift: ReviewInput = { outcome: "reversed", actions: [act("unseal_media")] };
    const toldBefore = (await lifted(mod)).length;
    expect(await refusal(d.reviewAs(mod2, seal, lift))).toBe("admin_required");
    expect(await imageStates(w.apiDb, mediaIds)).toEqual(["sealed", "sealed"]);
    expect(await lifted(mod)).toHaveLength(toldBefore);

    const review = await reviewed(admin2, seal, lift);
    expect(await imageStates(w.apiDb, mediaIds)).toEqual(["visible", "visible"]);
    expect(await appealsOf(seal)).toEqual([{ id: expect.any(String), result: "reversed", answered_by: review }]);
    // What follows the review's commit: its statement to the author, and the mail to every staff account, the reviewer's own included.
    expect(statements(author.email).map((mail) => mail.subject)).toEqual(["seal_final", "reversed"]);
    expect(statements(author.email)[1]!.paragraphs).toContain(STATEMENT_WORDS.unsealed);
    for (const staff of [mod, mod2, admin, admin2]) {
      expect((await lifted(staff)).at(-1), staff.handle).toMatchObject({ handle: admin2.handle, what: "unsealed" });
      expect(await lifted(staff), staff.handle).toHaveLength(toldBefore + 1);
    }
    expect((await overview(w.deps, mod.session)).protectionLifted.items.filter((item) => item.caseId === caseId)).toEqual([{ at: expect.any(String), handle: admin2.handle, caseId, kind: "unsealed" }]);
  });

  describe("an appeal against a correction that reverses everything, in either order", () => {
    test("the correction is being recorded when the appeal arrives: the appeal waits for it and is refused, since nothing is left to appeal", async () => {
      const r = await removedPost();
      const confirmed = await d.confirm(admin, r.caseId, await decisionParams(w.apiDb, admin, r.caseId, { kind: "correction", reviewsDecisionId: r.decisionId, actions: [act("restore")] }));
      const [held, release] = [gate(), gate()];
      // While the audit chain's head is held, the correction stops at its audit row, its last statement, holding its case.
      const holder = withLockTimeout(w.migrateDb, async (tx) => {
        await tx.execute(sql`select 1 from public.audit_head where id = 1 for update`);
        held.open();
        await release.opened;
      });
      await held.opened;
      let correcting: Promise<unknown>;
      let appealing: Promise<unknown>;
      try {
        correcting = settled(d.moderation.forStaff.decide(admin.session, confirmed, { requestId: `req-${randomUUID()}` }));
        await untilBlocked(w.apiDb, "append_confirmed_audit");
        appealing = settled(fileAppeal(w.deps, r.author.id, r.decisionId, {}));
        await untilBlocked(w.apiDb, "insert into appeals");
      } finally {
        release.open();
        await holder;
      }
      expect(await correcting).toEqual({ decisionId: expect.any(String) });
      const refused = await appealing;
      expect(refused).toBeInstanceOf(ModerationError);
      expect(refused).toMatchObject({ code: "appeal_not_open" });
      await d.moderation.settle();
      expect(await appealsOf(r.decisionId)).toEqual([]);
      expect(await postRow(w.apiDb, r.postId)).toMatchObject({ level: "visible" });
    });

    test("the appeal is being filed when the correction arrives: the correction waits for it and answers it as reversed", async () => {
      const r = await removedPost();
      const confirmed = await d.confirm(admin, r.caseId, await decisionParams(w.apiDb, admin, r.caseId, { kind: "correction", reviewsDecisionId: r.decisionId, actions: [act("restore")] }));
      const [held, release] = [gate(), gate()];
      // The appeal's row is inserted and its transaction stays open: its trigger holds the case's row.
      const appealing = withLockTimeout(w.apiDb, async (tx) => {
        const id = await appealOf(tx, r.decisionId, r.author.id);
        held.open();
        await release.opened;
        return id;
      });
      await held.opened;
      let correcting: Promise<unknown>;
      try {
        correcting = settled(d.moderation.forStaff.decide(admin.session, confirmed, { requestId: `req-${randomUUID()}` }));
        await untilBlocked(w.apiDb, "insert into decisions");
      } finally {
        release.open();
      }
      const appeal = await appealing;
      const corrected = (await correcting) as { decisionId: string };
      expect(corrected).toEqual({ decisionId: expect.any(String) });
      await d.moderation.settle();
      expect(await appealsOf(r.decisionId)).toEqual([{ id: appeal, result: "reversed", answered_by: corrected.decisionId }]);
      // The author reads the correction as the answer to their appeal.
      expect((await authorDecisionView(w.deps, r.author.id, r.decisionId)).appeal).toMatchObject({ state: "answered", result: "reversed", answeredBy: corrected.decisionId, statement: { kind: "correction", outcome: "reversed" } });
    });
  });

  test("two appeals of one decision at the same moment: exactly one is stored, and the other is told that an appeal exists", async () => {
    const r = await removedPost();
    const both = await Promise.all([settled(fileAppeal(w.deps, r.author.id, r.decisionId, {})), settled(fileAppeal(w.deps, r.author.id, r.decisionId, {}))]);
    const refusedOnes = both.filter((answer) => answer instanceof ModerationError);
    expect(refusedOnes).toHaveLength(1);
    expect(refusedOnes[0]).toMatchObject({ code: "appeal_exists", status: 409 });
    expect(await appealsOf(r.decisionId)).toHaveLength(1);
  });

  test("a report into a case that is still open does not wait for an appeal that is being filed", async () => {
    // Two reports, of which the final removal answers the first: the case stays open with the second.
    const r = await reportedPost();
    await recordIntake(w.deps, { ground: ground.rule((await w.account()).id), live: [aPost(r.postId)] });
    const removal = await decided(mod, r.caseId, { kind: "final", actions: [act("remove")], throughSeq: 1 });
    const [open] = await w.apiDb.execute<{ open: boolean }>(sql`select closed_at is null as open from cases where id = ${r.caseId}::uuid`);
    expect(open!.open).toBe(true);

    const [held, release] = [gate(), gate()];
    const appealing = withLockTimeout(w.apiDb, async (tx) => {
      await appealOf(tx, removal, r.author.id);
      held.open();
      await release.opened;
    });
    await held.opened;
    try {
      // The appeal's transaction is open and holds the case's row for its key only: a third report attaches at once.
      const third = await recordIntake(w.deps, { ground: ground.rule((await w.account()).id), live: [aPost(r.postId)] });
      expect(third.items[0]).toMatchObject({ caseId: r.caseId, seq: 3 });
    } finally {
      release.open();
      await appealing;
    }
    expect(await appealsOf(removal)).toHaveLength(1);
  });

  test("this file left no row behind: the moderation tables and the four auth tables of moderation cases hold what they held before it", async () => {
    await w.cleanUp();
    await d.close();
    expect(await counts()).toEqual(before);
  });
});
