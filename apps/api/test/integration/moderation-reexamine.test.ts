import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { ACCOUNT_ITEM_SCOPE, DAILY_LIMITS, OUTCOME_PHRASES, ReexamineResponse, SUSPECT_OUTCOME_PHRASES, UNSEEN_NO_ACTION, appealDeadline, itemOutcomeWords, textDigest, type NoticeRequest } from "@korbat/contracts";
import { MemoryJobLock, type JobLock } from "../../src/lib/jobs";
import { renderMail } from "../../src/mail/templates";
import { fileAppeal } from "../../src/moderation/appeals";
import { queue, readCase } from "../../src/moderation/cases";
import { ModerationError } from "../../src/moderation/context";
import { dispatchRound } from "../../src/moderation/dispatch";
import { noticeStatus, reexamineNotice, reexamineOwnItem, submitNotice } from "../../src/moderation/intake";
import { reporterList } from "../../src/moderation/reports";
import { deciderWorld, type DeciderWorld, type RealStaff } from "./moderation-decide";
import { act, authCaseCounts, moderationCounts, newImageRow, newPostRow, postFrozen, refusal, type DecisionInput } from "./moderation-fixtures";
import { accountTarget, noticesWorld, notices, postTarget, type NoticesWorld } from "./notices-harness";

// Every test signs several decisions with real staff keys and runs dispatch rounds: more than a test gets by default.
vi.setConfig({ testTimeout: 240_000 });

const MIN = 60_000;
const HOUR = 60 * MIN;

/**
 * Re-examination as flows (3c design, sections 7.2 and 12), against the real database, the real auth module and a
 * scripted mailer: whoever sent a notice or a report asks korbat to decide an item again that a moderator answered
 * without action, the request becomes a new item of the same notice on the same target, and it is decided and told like
 * any item. Every decision is confirmed with a real staff key, and every outcome reaches its sender through a real
 * dispatch round. The file's last test holds it to leaving no row behind.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: re-examination, from the request to the answer its sender reads", () => {
  let w: NoticesWorld;
  let d: DeciderWorld;
  let mod: RealStaff;
  let mod2: RealStaff;
  let admin: RealStaff;
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
  const NO_ACTION: DecisionInput = { kind: "final", outcome: "no_violation" };
  /** A notice sent signed out, or with the session given; remembered for the cleanup. */
  async function sent(request: NoticeRequest, session: Parameters<NoticesWorld["sender"]>[0] = null) {
    const answer = w.remember(await submitNotice(w.deps, request, w.sender(session)));
    await w.moderation.settle();
    return answer;
  }
  /** The stored items of a notice, in the order they were filed. */
  const stored = async (ref: string) =>
    (
      await w.migrateDb.execute<{ id: string; position: number; case_id: string | null; lane: number; suspect: boolean; outcome: string | null; reexamines_item_id: string | null; statement: string | null; statement_salt: string | null; statement_digest: string | null; reporter_account_id: string | null }>(
        sql`select i.id, i.position, i.case_id, i.lane, i.suspect, i.outcome, i.reexamines_item_id, i.statement, i.statement_salt, i.statement_digest, i.reporter_account_id
              from intake_items i join intakes n on n.id = i.intake_id where n.ref = ${ref} order by i.created_at, i.position, i.id`,
      )
    ).map((row) => ({ ...row }));
  const page = async (notice: { ref: string; token?: string }) => (await noticeStatus(w.deps, { ref: notice.ref, token: notice.token! }, w.sender().netHash)).items;
  /** A request for a re-examination of the item at this position, from a network of its own. */
  const asked = (notice: { ref: string; token?: string }, position: number, statement?: string) =>
    reexamineNotice(w.deps, { ref: notice.ref, token: notice.token!, position, ...(statement === undefined ? {} : { statement }) }, w.sender().netHash);
  /** A post of a new account with this many images, quoting another post when one is given. */
  async function post(images = 0, quoteOfId?: string) {
    const author = await w.account();
    const postId = await newPostRow(w.apiDb, author.id, quoteOfId === undefined ? {} : { quoteOfId });
    for (let position = 0; position < images; position++) await newImageRow(w.apiDb, author.id, postId, position);
    return { author, postId };
  }
  const urgentMails = async () => w.mailer.to((await w.repo.findUserById(admin.id))!.email, "moderation_urgent").length;

  test("a notifier asks once for a re-examination of a no-action item, with the notice's own token: a new item of the same notice in a new case, marked in the console for whoever decided the first, decided again, and told at the next release as final within korbat", async () => {
    const { author, postId } = await post();
    const email = w.address();
    const notice = await sent(notices.illegal([postTarget(postId)], { email }));
    const [first] = await stored(notice.ref);
    await decided(mod, first!.case_id!, { kind: "final", outcome: "not_evident" });
    // Nothing can be asked before the outcome is released.
    expect(await refusal(asked(notice, 1))).toBe("reexamination_not_open");
    await released();
    const [shown] = await page(notice);
    expect(shown).toMatchObject({ outcome: "not_evident", reexamines: false, reexamination: { open: true, until: expect.any(String) } });
    // The mail says how, in the words of the status page.
    expect(renderMail(w.mailer.updatesTo(email).at(-1)!).text).toContain("You can ask korbat once, within six months and free of charge, to re-examine a moderator's decision to take no action");

    const answer = await asked(notice, 1, "The second sentence names where she lives.");
    expect(ReexamineResponse.parse(answer)).toEqual({ positions: [1] });
    await w.moderation.settle();
    const [, again] = await stored(notice.ref);
    // The first case closed with its answer: the request opened a new one, in the first item's lane, under the same notice.
    expect(again).toMatchObject({ position: 1, lane: first!.lane, suspect: false, outcome: null, reexamines_item_id: first!.id, statement: "The second sentence names where she lives.", reporter_account_id: null });
    expect(again!.case_id).not.toBe(first!.case_id);
    expect(again!.statement_digest).toBe(await textDigest(again!.statement_salt!, again!.statement!));
    // korbat owes the notifier another answer: the day their contact is forgotten moves to six months from now.
    const contactId = (await w.notice(notice.ref))!.contact_id!;
    const [contact] = await w.authDb.execute<{ forget_after: string }>(sql`select to_char(forget_after at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as forget_after from auth.notifier_contacts where id = ${contactId}::uuid`);
    expect(Math.abs(Date.parse(contact!.forget_after) - appealDeadline(w.deps.now()).getTime())).toBeLessThan(5 * MIN);

    // The page: the first item is asked about, and the request waits like any item. A second request is refused.
    const listed = await page(notice);
    expect(listed.map((item) => [item.position, item.reexamines, item.outcome, item.reexamination])).toEqual([
      [1, false, "not_evident", { open: false, until: shown!.reexamination!.until }],
      [1, true, null, null],
    ]);
    expect(await refusal(asked(notice, 1))).toBe("reexamination_not_open");
    expect(await refusal(asked(notice, 2))).toBe("reexamination_not_open");
    expect(await refusal(reexamineNotice(w.deps, { ref: notice.ref, token: "not-the-token-of-this-notice-000000000000000", position: 1 }, w.sender().netHash))).toBe("notice_not_found");

    // The console: the queue and the case mark the re-examination, and tell the first decider that the item re-examines their decision.
    expect((await queue(w.deps)).cases.find((row) => row.id === again!.case_id)).toMatchObject({ reexamination: true });
    expect((await readCase(w.deps, mod.session, again!.case_id!)).items[0]).toMatchObject({ reexaminesPosition: 1, reexaminesYourDecision: true, statement: "The second sentence names where she lives." });
    expect((await readCase(w.deps, mod2.session, again!.case_id!)).items[0]).toMatchObject({ reexaminesPosition: 1, reexaminesYourDecision: false });
    // The database does not refuse the first decider. This time the post is removed: its author is told and may appeal once.
    const removal = await decided(mod, again!.case_id!, { kind: "final", actions: [act("remove")] });
    expect(w.mailer.to(author.email, "moderation_decision").map((mail) => mail.data.subject)).toEqual(["post_restricted"]);
    expect((await fileAppeal(w.deps, author.id, removal, {})).appeal).toMatchObject({ state: "pending" });
    expect(await refusal(fileAppeal(w.deps, author.id, removal, {}))).toBe("appeal_exists");

    const updates = w.mailer.updatesTo(email).length;
    await released();
    // The answer to a re-examination cannot be examined again: final within korbat, on the page and in the mail.
    expect((await page(notice))[1]).toMatchObject({ outcome: "restricted_rule", reexamines: true, reexamination: null, changed: false });
    const update = w.mailer.updatesTo(email);
    expect(update).toHaveLength(updates + 1);
    expect(update.at(-1)!.data.lines).toEqual([expect.objectContaining({ ref: notice.ref, item: 1, reexamination: true, reexaminable: false, unseen: false, changed: false })]);
    const text = renderMail(update.at(-1)!).text;
    expect(text).toContain(`${notice.ref}, item 1 (${w.config.APP_ORIGIN}/post/${postId}), re-examined: `);
    expect(text).toContain("A decision changed on review or by a correction, or given on re-examination, is final within korbat.");
    expect(await refusal(asked(notice, 1))).toBe("reexamination_not_open");
  });

  test("with the token of a mail's link, a re-examination joins the target's open case", async () => {
    const { postId } = await post();
    const email = w.address();
    const notice = await sent(notices.illegal([postTarget(postId)], { email }));
    const [first] = await stored(notice.ref);
    await decided(mod, first!.case_id!, { kind: "final", outcome: "not_evident" });
    await released();
    // Someone else reports the post meanwhile: its case is open again.
    const other = await sent(notices.rule([postTarget(postId)]));
    const openCase = (await stored(other.ref))[0]!.case_id!;
    const mailToken = w.mailer.to(email, "notice_received")[0]!.data.pageUrl!.split("#t=")[1]!;
    expect(mailToken).not.toBe(notice.token);
    expect(await reexamineNotice(w.deps, { ref: notice.ref, token: mailToken, position: 1 }, w.sender().netHash)).toEqual({ positions: [1] });
    await w.moderation.settle();
    expect((await stored(notice.ref))[1]).toMatchObject({ case_id: openCase, reexamines_item_id: first!.id, statement: null });
    await decided(mod2, openCase, NO_ACTION);
  });

  test("a signed-in reporter asks from Your reports, by the item's id: once for each item, never for someone else's, a restricted one or one past its window, and five times a day", async () => {
    const reporter = await w.account();
    const [kept, removed, late] = [await post(), await post(), await post()];
    const report = await sent(notices.rule([postTarget(kept.postId), postTarget(removed.postId), postTarget(late.postId)]), reporter.session);
    const items = await stored(report.ref);
    await decided(mod, items[0]!.case_id!, NO_ACTION);
    await decided(mod, items[1]!.case_id!, { kind: "final", actions: [act("remove")] });
    await decided(mod, items[2]!.case_id!, NO_ACTION);
    await released();
    // The third item's window has passed: it was released more than six months ago.
    await w.migrateDb.execute(sql`update intake_items set outcome_sent_at = now() - interval '6 months 2 days' where id = ${items[2]!.id}::uuid`);
    const listed = async () => (await reporterList(w.deps, reporter.id)).reports.find((row) => row.ref === report.ref)!.items;
    const before = await listed();
    expect(before.map((item) => [item.id, item.outcome, item.reexamination?.open ?? null])).toEqual([
      [items[0]!.id, "no_violation", true],
      [items[1]!.id, "restricted_rule", null],
      [items[2]!.id, "no_violation", false],
    ]);

    // The first hit of the day: accepted.
    expect(await reexamineOwnItem(w.deps, reporter.id, items[0]!.id, { statement: "Look at the reply under it." })).toEqual({ positions: [1] });
    await w.moderation.settle();
    const after = await stored(report.ref);
    expect(after).toHaveLength(4);
    expect(after[3]).toMatchObject({ position: 1, reexamines_item_id: items[0]!.id, reporter_account_id: reporter.id, statement: "Look at the reply under it." });
    expect((await listed()).map((item) => [item.position, item.reexamines, item.reexamination?.open ?? null])).toEqual([
      [1, false, false],
      [1, true, null],
      [2, false, null],
      [3, false, false],
    ]);
    // The second to the fourth: the same item again, a restricted item, and one past its window.
    expect(await refusal(reexamineOwnItem(w.deps, reporter.id, items[0]!.id, {}))).toBe("reexamination_exists");
    expect(await refusal(reexamineOwnItem(w.deps, reporter.id, items[1]!.id, {}))).toBe("reexamination_not_open");
    expect(await refusal(reexamineOwnItem(w.deps, reporter.id, items[2]!.id, {}))).toBe("reexamination_not_open");
    // Someone else's item, and an id that names none, are not found; each request was counted all the same.
    const stranger = await w.account();
    expect(await refusal(reexamineOwnItem(w.deps, stranger.id, items[2]!.id, {}))).toBe("not_found");
    expect(await refusal(reexamineOwnItem(w.deps, reporter.id, randomUUID(), {}))).toBe("not_found");
    expect(DAILY_LIMITS.reexaminations).toBe(5);
    const sixth = await reexamineOwnItem(w.deps, reporter.id, items[2]!.id, {}).then(
      () => null,
      (err: unknown) => err,
    );
    expect(sixth).toBeInstanceOf(ModerationError);
    expect(sixth).toMatchObject({ code: "rate_limited", status: 429 });
    await decided(mod2, after[3]!.case_id!, NO_ACTION);
  });

  test("a re-examination on the path for child sexual abuse material carries no account and no contact, goes to the urgent lane, alerts staff, freezes the post again and is answered by an admin", async () => {
    const { postId } = await post(1);
    const notice = await sent(notices.csam([postTarget(postId)]));
    const [first] = await stored(notice.ref);
    await decided(admin, first!.case_id!, NO_ACTION);
    expect(await postFrozen(w.apiDb, postId)).toBe(false);
    await released();
    const [shown] = await page(notice);
    expect(shown).toMatchObject({ suspect: true, outcome: "no_violation", reexamination: { open: true } });
    expect(itemOutcomeWords(shown!)).toBe(SUSPECT_OUTCOME_PHRASES.no_action);

    const alerts = await urgentMails();
    expect(await asked(notice, 1)).toEqual({ positions: [1] });
    await w.moderation.settle();
    const [, again] = await stored(notice.ref);
    expect(again).toMatchObject({ position: 1, lane: 0, suspect: true, reexamines_item_id: first!.id, reporter_account_id: null });
    expect((await w.notice(notice.ref))!).toMatchObject({ reporter_id: null, contact_id: null });
    expect(await urgentMails()).toBe(alerts + 1);
    expect(await postFrozen(w.apiDb, postId)).toBe(true);
    // Every answer to a report of this kind is an admin's, a re-examination's too.
    expect(await refusal(d.decideAs(mod, again!.case_id!, NO_ACTION))).toBe("admin_required");
    await decided(admin, again!.case_id!, NO_ACTION);
    await released();
    // A suspect item's re-examination is answered for good.
    expect((await page(notice))[1]).toMatchObject({ reexamines: true, outcome: "no_violation", reexamination: null });
    expect(await refusal(asked(notice, 1))).toBe("reexamination_not_open");
  });

  test("a re-examination of an item whose target is gone is answered at once, not available", async () => {
    const reporter = await w.account();
    const { postId } = await post();
    const report = await sent(notices.rule([postTarget(postId)]), reporter.session);
    const [first] = await stored(report.ref);
    await decided(mod, first!.case_id!, NO_ACTION);
    await released();
    // Its author deletes the post.
    await w.apiDb.execute(sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${postId}::uuid`);
    expect(await reexamineOwnItem(w.deps, reporter.id, first!.id, {})).toEqual({ positions: [1] });
    const [, again] = await stored(report.ref);
    expect(again).toMatchObject({ position: 1, case_id: null, outcome: "not_available", reexamines_item_id: first!.id });
    await released();
    const listed = (await reporterList(w.deps, reporter.id)).reports.find((row) => row.ref === report.ref)!.items;
    expect(listed[1]).toMatchObject({ reexamines: true, outcome: "not_available", reexamination: null });
  });

  describe("a report of child sexual abuse material about a post that quotes another", () => {
    /** A quoted post with an image, a post that quotes it, and a notice of this kind naming the quoting post: two items, two cases. */
    async function quoting() {
      const quoted = await post(1);
      const quotingPost = await post(1, quoted.postId);
      const notice = await sent(notices.csam([postTarget(quotingPost.postId)]));
      const [origin, added] = await stored(notice.ref);
      expect([origin!.position, added!.position]).toEqual([1, 11]);
      return { notice, origin: origin!, added: added!, quotedPostId: quoted.postId, quotingPostId: quotingPost.postId };
    }

    test("the item korbat added is asked about by its own position, and examined alone; the named item's request then examines the named post alone", async () => {
      const q = await quoting();
      await decided(admin, q.origin.case_id!, NO_ACTION);
      await decided(admin, q.added.case_id!, NO_ACTION);
      await released();
      expect((await page(q.notice)).map((item) => [item.position, item.quotedBy, item.reexamination?.open ?? null])).toEqual([
        [1, null, true],
        [11, 1, true],
      ]);
      expect(await asked(q.notice, 11)).toEqual({ positions: [11] });
      let items = await stored(q.notice.ref);
      expect(items).toHaveLength(3);
      expect(items[2]).toMatchObject({ position: 11, reexamines_item_id: q.added.id, suspect: true, lane: 0 });
      expect(await postFrozen(w.apiDb, q.quotedPostId)).toBe(true);
      expect(await postFrozen(w.apiDb, q.quotingPostId)).toBe(false);
      // The added item is asked about already: the named item's request examines the named post alone.
      expect(await asked(q.notice, 1)).toEqual({ positions: [1] });
      items = await stored(q.notice.ref);
      expect(items).toHaveLength(4);
      expect(items[3]).toMatchObject({ position: 1, reexamines_item_id: q.origin.id });
      for (const item of items.slice(2)) await decided(admin, item.case_id!, NO_ACTION);
    });

    test("a request about the named item examines the added item again too, in one transaction, when that one is open to it", async () => {
      const q = await quoting();
      await decided(admin, q.origin.case_id!, NO_ACTION);
      await decided(admin, q.added.case_id!, NO_ACTION);
      await released();
      expect(await asked(q.notice, 1, "Both images.")).toEqual({ positions: [1, 11] });
      const items = await stored(q.notice.ref);
      expect(items).toHaveLength(4);
      const [again, addedAgain] = [items.find((item) => item.reexamines_item_id === q.origin.id)!, items.find((item) => item.reexamines_item_id === q.added.id)!];
      // The statement belongs to the item that was asked about.
      expect(again).toMatchObject({ position: 1, statement: "Both images." });
      expect(addedAgain).toMatchObject({ position: 11, statement: null });
      expect(await postFrozen(w.apiDb, q.quotedPostId)).toBe(true);
      expect(await postFrozen(w.apiDb, q.quotingPostId)).toBe(true);
      await decided(admin, again.case_id!, NO_ACTION);
      await decided(admin, addedAgain.case_id!, NO_ACTION);
    });

    test("while the added item is unanswered the quoted post is frozen anyway: the request examines the named item alone", async () => {
      const q = await quoting();
      await decided(admin, q.origin.case_id!, NO_ACTION);
      await released();
      expect(await asked(q.notice, 1)).toEqual({ positions: [1] });
      const items = await stored(q.notice.ref);
      expect(items).toHaveLength(3);
      expect(items[2]).toMatchObject({ position: 1, reexamines_item_id: q.origin.id });
      await decided(admin, q.added.case_id!, NO_ACTION);
      await decided(admin, items[2]!.case_id!, NO_ACTION);
    });
  });

  describe("an answer given while nobody could open the post's images does not spend the re-examination", () => {
    const ownItems = async (reporterId: string, ref: string) => (await reporterList(w.deps, reporterId)).reports.find((row) => row.ref === ref)!.items;

    test("a rule report that an admin's answer to a report of child sexual abuse material answered too reads so and can be asked about; answered the same way, its re-examination can be asked about again; answered with the images in sight, it cannot", async () => {
      const reporter = await w.account();
      const { postId } = await post(1);
      const report = await sent(notices.rule([postTarget(postId)]), reporter.session);
      await sent(notices.csam([postTarget(postId)]));
      const [first] = await stored(report.ref);
      // One decision answers both items of the case, while the post is frozen.
      await decided(admin, first!.case_id!, NO_ACTION);
      await released();
      let [shown] = await ownItems(reporter.id, report.ref);
      expect(shown).toMatchObject({ outcome: "no_violation", unseen: true, reexamination: { open: true } });
      expect(itemOutcomeWords(shown!)).toBe(UNSEEN_NO_ACTION);

      // The first request of the day.
      expect(await reexamineOwnItem(w.deps, reporter.id, shown!.id, {})).toEqual({ positions: [1] });
      const second = (await stored(report.ref))[1]!;
      // Another report of that kind arrives, and the admin answers the case as before: with the images out of sight.
      await sent(notices.csam([postTarget(postId)]));
      await decided(admin, second.case_id!, NO_ACTION);
      await released();
      let listed = await ownItems(reporter.id, report.ref);
      expect(listed.map((item) => [item.reexamines, item.unseen, item.reexamination?.open ?? null])).toEqual([
        [false, true, false],
        [true, true, true],
      ]);
      expect(itemOutcomeWords(listed[1]!)).toBe(UNSEEN_NO_ACTION);
      // Such a line is never called final within korbat; the control stays.
      expect(listed[1]!.id).toBe(second.id);

      // The second request of the day: the re-examination itself is examined again.
      expect(await reexamineOwnItem(w.deps, reporter.id, second.id, {})).toEqual({ positions: [1] });
      const third = (await stored(report.ref))[2]!;
      expect(third).toMatchObject({ reexamines_item_id: second.id });
      // Nothing freezes the post now: a moderator answers with the images in sight, and that answer is final within korbat.
      expect(await postFrozen(w.apiDb, postId)).toBe(false);
      await decided(mod, third.case_id!, NO_ACTION);
      await released();
      listed = await ownItems(reporter.id, report.ref);
      expect(listed[2]).toMatchObject({ reexamines: true, unseen: false, outcome: "no_violation", reexamination: null });
      [shown] = listed;
      // The third request is refused, and the next three are counted too: the sixth of the day is not looked at.
      expect(await refusal(reexamineOwnItem(w.deps, reporter.id, third.id, {}))).toBe("reexamination_not_open");
      for (let n = 4; n <= DAILY_LIMITS.reexaminations; n++) expect(await refusal(reexamineOwnItem(w.deps, reporter.id, third.id, {})), String(n)).toBe("reexamination_not_open");
      expect(await refusal(reexamineOwnItem(w.deps, reporter.id, third.id, {}))).toBe("rate_limited");
    });

    test("a rule report that a moderator answered while the post was frozen through its author's account's case reads so and can be asked about; a report about the account itself keeps the ordinary words and its one request", async () => {
      const [reporter, accountReporter] = [await w.account(), await w.account()];
      const { author, postId } = await post(1);
      // A report of child sexual abuse material about the account freezes every post of it.
      const suspect = await sent(notices.csam([accountTarget(author.handle)]));
      const accountCase = (await stored(suspect.ref))[0]!.case_id!;
      const report = await sent(notices.rule([postTarget(postId)]), reporter.session);
      const about = await sent(notices.rule([accountTarget(author.handle)], { ruleId: "R6" }), accountReporter.session);
      expect(await postFrozen(w.apiDb, postId)).toBe(true);
      // A moderator answers the post's case on its text alone.
      const [first] = await stored(report.ref);
      await decided(mod, first!.case_id!, NO_ACTION);
      // The admin answers the account's case, which holds both the suspect item and the rule report about the account.
      expect((await stored(about.ref))[0]!.case_id).toBe(accountCase);
      await decided(admin, accountCase, NO_ACTION);
      await released();

      const [shown] = await ownItems(reporter.id, report.ref);
      expect(shown).toMatchObject({ outcome: "no_violation", unseen: true, reexamination: { open: true } });
      expect(await reexamineOwnItem(w.deps, reporter.id, shown!.id, {})).toEqual({ positions: [1] });
      await decided(mod2, (await stored(report.ref))[1]!.case_id!, NO_ACTION);

      // The report about the account: its answer concerns the display name and bio, which staff read.
      const [accountItem] = await ownItems(accountReporter.id, about.ref);
      expect(accountItem).toMatchObject({ outcome: "no_violation", unseen: false, scope: "account", reexamination: { open: true } });
      expect(itemOutcomeWords(accountItem!)).toBe(`${OUTCOME_PHRASES.no_violation}. ${ACCOUNT_ITEM_SCOPE}`);
      expect(await reexamineOwnItem(w.deps, accountReporter.id, accountItem!.id, {})).toEqual({ positions: [1] });
      const again = (await stored(about.ref))[1]!;
      await decided(mod, again.case_id!, NO_ACTION);
      await released();
      const listed = await ownItems(accountReporter.id, about.ref);
      expect(listed[1]).toMatchObject({ reexamines: true, unseen: false, reexamination: null });
      expect(await refusal(reexamineOwnItem(w.deps, accountReporter.id, again.id, {}))).toBe("reexamination_not_open");
    });
  });

  test("this file left no row behind: the moderation tables and the four auth tables of moderation cases hold what they held before it", async () => {
    await w.cleanUp();
    await d.close();
    expect(await counts()).toEqual(before);
  });
});
