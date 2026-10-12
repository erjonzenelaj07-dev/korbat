import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { ACCOUNT_ITEM_SCOPE, ACCOUNT_SUSPECT_SCOPE, ALREADY_NOT_SHOWN, OUTCOME_PHRASES, QUOTE_ITEM_SCOPE, SUSPECT_OUTCOME_PHRASES, UNSEEN_NO_ACTION, appealDeadline, type NoticeRequest } from "@korbat/contracts";
import { parseVersionedKey } from "../../src/auth/crypto";
import { MemoryJobLock, type JobLock } from "../../src/lib/jobs";
import type { NoticeUpdateLine } from "../../src/mail/mailer";
import type { ModerationDeps } from "../../src/moderation/context";
import { DISPATCH_INTERVAL_MS, casesCalling, cutoffOf, dispatchMarkerKey, dispatchRound, type DispatchReport } from "../../src/moderation/dispatch";
import { noticeStatus, submitNotice } from "../../src/moderation/intake";
import { accountLink, postLink } from "../../src/moderation/links";
import { waitingCases } from "../../src/moderation/repo";
import { deciderWorld, type DeciderWorld, type RealStaff } from "./moderation-decide";
import { act, authCaseCounts, moderationCounts, newImageRow, newPostRow, saveText, uuids } from "./moderation-fixtures";
import { accountTarget, linkTarget, noticesWorld, notices, postTarget, type NoticesWorld } from "./notices-harness";

// Every test signs decisions with a real staff key and runs whole dispatch rounds: more than a test gets by default.
vi.setConfig({ testTimeout: 180_000 });

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * The dispatch job (3c design, sections 7.8 and 7.12), round by round, against the real database, the real auth module
 * and a scripted mailer: receipts and statements that waited, the daily release at the dispatch hour, one update for each
 * address or account with the outcome lines' words, their retries and what is given up, the urgent lane's repeat in its
 * three cases and the queue-age alert.
 *
 * The job's clock is the test's, and only ever moves forward; the database's clock is the real one. A cut-off the job's
 * clock has reached before the database's is released as "now", so a move to the next dispatch hour releases what was
 * decided so far. The tests that move the clock by days come last: once the job's clock is five days ahead, every row the
 * database stamps is at once "five days old" to the job. Every decision is confirmed with a real staff key. The file's
 * last test holds it to leaving no row behind.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the dispatch job", () => {
  let w: NoticesWorld;
  let d: DeciderWorld;
  let moderator: RealStaff;
  let admin: RealStaff;
  let lock: JobLock;
  let before: Record<string, number>;
  /** How far the job's clock, the limit store's and the markers' stand ahead of the real one. */
  let aheadMs = 0;

  beforeAll(async () => {
    w = noticesWorld();
    w.deps.now = () => new Date(Date.now() + aheadMs);
    // The dispatch hour came 22 hours ago: nothing a test decides lies before the first round's cut-off.
    w.deps.config = { ...w.deps.config, MODERATION_DISPATCH_HOUR: (new Date().getUTCHours() + 2) % 24 };
    lock = new MemoryJobLock(() => Date.now() + aheadMs);
    // The decisions' own module mails through the same auth module and counts in the same limit store.
    d = deciderWorld(w.apiDb, { auth: w.authForModeration, rateLimitStore: w.deps.limits });
    before = await counts();
    moderator = await d.staff("moderator");
    admin = await d.staff("admin");
  }, 120_000);
  afterAll(async () => {
    await w.close();
  });

  const counts = async (): Promise<Record<string, number>> => ({ ...(await moderationCounts(w.apiDb)), ...(await authCaseCounts(w.migrateDb)) });
  const jobNow = () => new Date(Date.now() + aheadMs);
  const round = (withLock: JobLock = lock) => dispatchRound(w.deps, withLock);
  const ahead = (ms: number) => {
    aheadMs += ms;
    w.ahead.limitsMs = aheadMs;
  };
  /**
   * Moves the dispatch hour to the next full hour that lies at least twenty minutes on, and the clock to one minute past
   * it: everything stored so far is then older than the job's 15-minute waits, and the round that follows is a daily
   * round whose cut-off no decision made so far lies after.
   */
  function toNextDispatch() {
    const next = (Math.floor((Date.now() + aheadMs + 20 * MIN) / HOUR) + 1) * HOUR;
    w.deps.config = { ...w.deps.config, MODERATION_DISPATCH_HOUR: new Date(next).getUTCHours() };
    ahead(next + MIN - (Date.now() + aheadMs));
  }
  /** A decision that committed, by its id. */
  const decided = async (staff: RealStaff, caseId: string, input: Parameters<DeciderWorld["decideAs"]>[2]) => {
    const outcome = await d.decideAs(staff, caseId, input);
    if (typeof outcome === "string") throw new Error(`the decision was not recorded: ${outcome}`);
    return outcome.decisionId;
  };
  /** A notice as its sender sent it, signed out unless a session is given, with its items and the case of its first one. */
  async function sent(request: NoticeRequest, session: Parameters<NoticesWorld["sender"]>[0] = null) {
    const answer = w.remember(await submitNotice(w.deps, request, w.sender(session)));
    await w.moderation.settle();
    const items = await w.items(answer.ref);
    return { ...answer, items, caseId: items[0]!.case_id! };
  }
  const status = (notice: { ref: string; token?: string }) => noticeStatus(w.deps, { ref: notice.ref, token: notice.token! }, w.sender().netHash);
  const itemRows = async (ref: string) =>
    (await w.migrateDb.execute<{ position: number; outcome_mail: string; shown: string | null; released: boolean }>(
      sql`select i.position, i.outcome_mail, i.shown_outcome as shown, i.outcome_sent_at is not null as released from intake_items i join intakes n on n.id = i.intake_id where n.ref = ${ref} order by i.position, i.created_at`,
    )).map((row) => ({ ...row }));
  const receiptOf = async (ref: string) => (await w.notice(ref))!.receipt;
  const contactOf = async (ref: string) => (await w.notice(ref))!.contact_id!;
  /** The day a contact is forgotten, in epoch milliseconds. */
  async function forgetAfter(contactId: string): Promise<number> {
    const [row] = (await w.authDb.execute(sql`select (extract(epoch from forget_after) * 1000)::float8 as ms from auth.notifier_contacts where id = ${contactId}::uuid`)) as unknown as { ms: number }[];
    return Number(row!.ms);
  }
  const authorMail = async (decisionId: string) => (await w.apiDb.execute<{ author_mail: string }>(sql`select author_mail from decisions where id = ${decisionId}::uuid`))[0]!.author_mail;
  /** The lines of the newest update to this address. */
  const lines = (address: string): NoticeUpdateLine[] => w.mailer.updatesTo(address).at(-1)?.data.lines ?? [];
  /** The mail token of the receipt's page link. */
  const tokenOf = (address: string) => /#t=([A-Za-z0-9_-]{43})$/.exec(w.mailer.to(address, "notice_received")[0]!.data.pageUrl!)![1]!;
  /** The ids of a notice's items, in the order named. */
  const itemIds = async (ref: string) =>
    (await w.migrateDb.execute<{ id: string }>(sql`select i.id from intake_items i join intakes n on n.id = i.intake_id where n.ref = ${ref} order by i.position, i.created_at`)).map((row) => row.id);
  /** A logger that keeps every line it is given: its level, its fields and its message. */
  function recorded() {
    const lines: { level: string; fields: Record<string, unknown>; message: string }[] = [];
    const at = (level: string) => (fields: unknown, message?: string) =>
      void lines.push(typeof fields === "string" ? { level, fields: {}, message: fields } : { level, fields: { ...(fields as Record<string, unknown>) }, message: message ?? "" });
    const log = { trace: at("trace"), debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error"), fatal: at("fatal") } as unknown as ModerationDeps["log"];
    /** Every line as text, an error with its message and its stack: what a log file would hold. */
    const text = () => lines.map((line) => JSON.stringify({ ...line, fields: Object.fromEntries(Object.entries(line.fields).map(([name, value]) => [name, value instanceof Error ? `${value.message} ${value.stack ?? ""}` : value])) })).join(" ");
    return { lines, log, text };
  }
  /** A post of a new account, with this many images. */
  async function post(images = 0, options: { quoteOfId?: string } = {}) {
    const author = await w.account();
    const postId = await newPostRow(w.apiDb, author.id, options);
    for (let position = 0; position < images; position++) await newImageRow(w.apiDb, author.id, postId, position);
    return { author, postId };
  }
  /** Closes every open case about this file's accounts and posts, by an admin's final answer that takes no action. */
  async function closeOpenCases() {
    const open = await w.migrateDb.execute<{ id: string }>(
      sql`select c.id from cases c where c.closed_at is null and ((c.target_type = 'account' and c.target_id = any(${uuids(w.profileIds)}))
            or (c.target_type = 'post' and c.target_id in (select p.id from posts p where p.author_id = any(${uuids(w.profileIds)})))) order by c.opened_at`,
    );
    for (const { id } of open) await decided(admin, id, { kind: "final", outcome: "no_violation" });
  }

  test("the cut-off is the latest dispatch hour at or before the round's start, its marker names the cut-off's day and hour, and a round comes every ten minutes", () => {
    expect(cutoffOf(new Date("2026-10-04T07:00:00.000Z"), 7).toISOString()).toBe("2026-10-04T07:00:00.000Z");
    expect(cutoffOf(new Date("2026-10-04T06:59:59.999Z"), 7).toISOString()).toBe("2026-10-03T07:00:00.000Z");
    expect(cutoffOf(new Date("2026-10-04T23:30:00.000Z"), 23).toISOString()).toBe("2026-10-04T23:00:00.000Z");
    expect(cutoffOf(new Date("2026-01-01T00:10:00.000Z"), 0).toISOString()).toBe("2026-01-01T00:00:00.000Z");
    // The day before the first of a month, and of a year.
    expect(cutoffOf(new Date("2026-01-01T00:10:00.000Z"), 23).toISOString()).toBe("2025-12-31T23:00:00.000Z");
    expect(dispatchMarkerKey(new Date("2026-10-04T07:00:00.000Z"))).toBe("moderation-dispatched:2026-10-04T07");
    expect(DISPATCH_INTERVAL_MS).toBe(10 * MIN);
  });

  test("what is younger than 15 minutes is not yet the job's: an urgent item, a pending receipt and a pending statement are left to the request that made them, and are the round's sixteen minutes on", async () => {
    // The job's clock still agrees with the database's here; no later test can ask this.
    const image = await post(1);
    const report = await sent(notices.csam([postTarget(image.postId)]));
    w.mailer.mode = "fail";
    const target = await post();
    const notice = await sent(notices.illegal([postTarget(target.postId)], { email: w.address() }));
    const statement = await decided(moderator, notice.caseId, { kind: "interim", actions: [act("withhold")] });
    w.mailer.mode = "deliver";
    expect(await casesCalling(w.deps, jobNow())).toEqual([]);
    expect(await round()).toMatchObject({ urgent: "none", receipts: 0, statements: 0 });
    expect([await receiptOf(notice.ref), await authorMail(statement)]).toEqual(["pending", "pending"]);
    ahead(16 * MIN);
    expect(await casesCalling(w.deps, jobNow())).toEqual([report.caseId]);
    // The intake's own alert went 16 minutes ago: its window is over, and the round sends the alert again.
    expect(await round()).toMatchObject({ urgent: "sent", receipts: 1, statements: 1 });
    expect([await receiptOf(notice.ref), await authorMail(statement)]).toEqual(["sent", "sent"]);
    await closeOpenCases();
  });

  test("the daily release: a decision made after the cut-off waits for the next dispatch hour; then the outcome shows on the status page, the re-examination window runs, one update goes to the address with the receipt's page link, and the contact's day moves", async () => {
    const { postId } = await post();
    const email = w.address();
    const notice = await sent(notices.illegal([postTarget(postId)], { email, name: "Ada" }));
    expect(w.mailer.to(email, "notice_received")).toHaveLength(1);
    const pageLink = w.mailer.to(email, "notice_received")[0]!.data.pageUrl;
    await decided(moderator, notice.caseId, { kind: "final", outcome: "no_violation" });
    // A round before the next dispatch hour, with no marker yet: its release runs, and its cut-off lies about 22 hours
    // before the decision by the database's clock, so nothing of the decision is released or mailed.
    const early = await round(new MemoryJobLock(() => Date.now() + aheadMs));
    expect(early).toMatchObject({ released: 0, marked: true, daily: true, outcomeMails: 0 });
    expect(await itemRows(notice.ref)).toEqual([{ position: 1, outcome_mail: "pending", shown: null, released: false }]);
    expect((await status(notice)).items[0]).toMatchObject({ outcome: null, decidedOn: null, reexamination: null });
    expect(w.mailer.updatesTo(email)).toHaveLength(0);

    // The dispatch hour is moved after the day's release: the decisions made since are released at the new hour.
    toNextDispatch();
    const daily = await round();
    expect(daily.released).toBeGreaterThanOrEqual(1);
    expect(daily).toMatchObject({ marked: true, daily: true });
    expect(await itemRows(notice.ref)).toEqual([{ position: 1, outcome_mail: "sent", shown: "no_violation", released: true }]);
    // The status page and the mail tell the same at the same time.
    const shown = (await status(notice)).items[0]!;
    expect(shown).toMatchObject({ outcome: "no_violation", sealed: false, unseen: false, changed: false, reexamines: false, scope: null });
    expect(shown.reexamination).toMatchObject({ open: true });
    const updates = w.mailer.updatesTo(email);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.data).toEqual({
      signedIn: false,
      // A moderator's decision to take no action, which can be re-examined; the post quotes nothing, so no scope follows.
      lines: [{ ref: notice.ref, item: 1, link: postLink(w.config.APP_ORIGIN, postId), outcome: `${OUTCOME_PHRASES.no_violation}.`, reexamination: false, changed: false, reexaminable: true, unseen: false, automatic: false }],
      receipts: [],
      // The same page link as the receipt carried, with the contact's mail token.
      pages: [{ ref: notice.ref, pageUrl: pageLink }],
    });
    // The contact was owed its outcome mail when the daily step ran: its day is six months from then.
    expect(Math.abs((await forgetAfter(await contactOf(notice.ref))) - appealDeadline(jobNow()).getTime())).toBeLessThan(5 * MIN);

    // A later round of the same day runs no release and sends nothing again.
    ahead(10 * MIN);
    expect(await round()).toMatchObject({ released: null, marked: true, daily: false, outcomeMails: 0 });
    expect(w.mailer.updatesTo(email)).toHaveLength(1);
  });

  test("the queue-age alert: per lane the cases past its response time, and the cases that have held a measure taken while deciding for more than 24 hours, at most once a day", async () => {
    const waitingMails = () => w.mailer.sent.filter((mail) => mail.template === "moderation_waiting");
    await closeOpenCases();
    const first = await post();
    const report = await sent(notices.rule([postTarget(first.postId)], { ruleId: "R3" }));
    const second = await post();
    const holding = await sent(notices.rule([postTarget(second.postId)]));
    await decided(moderator, holding.caseId, { kind: "interim", actions: [act("withhold")] });
    // Nothing is past its time yet (the job's clock is still less than a day ahead of the database's), and the round sends no alert.
    expect(await waitingCases(w.apiDb, jobNow())).toEqual({ lanes: [], interim: 0 });
    const mailed = waitingMails().length;
    expect((await round()).waiting).toBe("none");
    // A day on, lane 1's case has waited more than its 24 hours; lane 2's seven days are not over, but its measure is a day old.
    ahead(25 * HOUR);
    expect((await round()).waiting).toBe("sent");
    expect(waitingMails().length).toBeGreaterThan(mailed);
    const data = waitingMails().at(-1)!.data;
    expect(data).toMatchObject({ lane1Count: "1", interimCount: "1" });
    expect(data.lane1Oldest).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2} UTC$/);
    expect([data.lane0Count, data.lane2Count]).toEqual([undefined, undefined]);
    // Not again within the day.
    const told = waitingMails().length;
    ahead(10 * MIN);
    expect((await round()).waiting).toBe("throttled");
    expect(waitingMails()).toHaveLength(told);
    await decided(moderator, report.caseId, { kind: "final", outcome: "no_violation" });
    await decided(moderator, holding.caseId, { kind: "final", outcome: "no_violation" });
  });

  test("an account's notices of illegality get one update through its account, signed in and without a page; a link that named nothing is a line of its own; a rule report and a report of child sexual abuse material get no mail, and their outcomes are released all the same", async () => {
    const reporter = await w.account();
    const first = await post(1);
    const illegal = await sent(notices.illegal([postTarget(first.postId)], { turnstileToken: undefined }), reporter.session);
    const second = await post();
    const rule = await sent(notices.rule([postTarget(second.postId)], { turnstileToken: undefined }), reporter.session);
    const third = await post();
    const dead = await sent(notices.illegal([postTarget(third.postId), linkTarget(postLink(w.config.APP_ORIGIN, "00000000-0000-4000-8000-000000000000"))], { turnstileToken: undefined }), reporter.session);
    await decided(moderator, illegal.caseId, { kind: "final", ground: "illegal", actions: [act("remove")] });
    await decided(moderator, rule.caseId, { kind: "final", outcome: "no_violation" });
    await decided(moderator, dead.caseId, { kind: "final", outcome: "not_evident" });
    toNextDispatch();
    await round();
    // One update for the account, with every line of its two notices; the rule report has no line.
    const updates = w.mailer.updatesTo(reporter.email);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.data).toMatchObject({ signedIn: true, receipts: [], pages: [] });
    expect(updates[0]!.data.lines.map((line) => [line.ref, line.item, line.outcome, line.reexaminable, line.automatic])).toEqual([
      [illegal.ref, 1, `${OUTCOME_PHRASES.restricted_legal}.`, false, false],
      [dead.ref, 1, `${OUTCOME_PHRASES.not_evident}.`, true, false],
      // A link that named nothing was answered at once, without a moderator: nothing of it can be re-examined.
      [dead.ref, 2, `${OUTCOME_PHRASES.not_available}.`, false, true],
    ]);
    expect(await itemRows(rule.ref)).toEqual([{ position: 1, outcome_mail: "none", shown: "no_violation", released: true }]);
    expect((await itemRows(dead.ref)).map((row) => row.outcome_mail)).toEqual(["sent", "sent"]);
  });

  test("receipts the cap folded ride in the next daily update with their page links, two of one day in one update and alone when nothing else is owed; two notices of one address make one update; a receipt and a statement that waited are sent by the round", async () => {
    const email = w.address();
    const posts = [await post(), await post(), await post()];
    const [one, two, three] = [
      await sent(notices.illegal([postTarget(posts[0]!.postId)], { email })),
      await sent(notices.illegal([postTarget(posts[1]!.postId)], { email })),
      await sent(notices.illegal([postTarget(posts[2]!.postId)], { email })),
    ];
    // An address that is not confirmed gets one receipt in 24 hours.
    expect([await receiptOf(one.ref), await receiptOf(two.ref), await receiptOf(three.ref)]).toEqual(["sent", "folded", "folded"]);
    // A second address with a folded receipt, whose notices are about the post that stays undecided: it is owed no line.
    const alone = w.address();
    await sent(notices.illegal([postTarget(posts[2]!.postId)], { email: alone }));
    const lonely = await sent(notices.illegal([postTarget(posts[2]!.postId)], { email: alone }));
    expect(await receiptOf(lonely.ref)).toBe("folded");
    // A round before the next dispatch day is not the daily one: a folded receipt goes only with its own notice's
    // lines, there are none, so neither address is mailed and every folded receipt stays folded.
    expect(await round()).toMatchObject({ released: null, marked: true, daily: false, outcomeMails: 0 });
    expect([w.mailer.updatesTo(email), w.mailer.updatesTo(alone)]).toEqual([[], []]);
    expect([await receiptOf(two.ref), await receiptOf(three.ref), await receiptOf(lonely.ref)]).toEqual(["folded", "folded", "folded"]);
    // A notice whose receipt the relay could not take, and a statement it could not take either: both wait.
    w.mailer.mode = "fail";
    const other = w.address();
    const held = await post();
    const waiting = await sent(notices.illegal([postTarget(held.postId)], { email: other }));
    const statement = await decided(moderator, waiting.caseId, { kind: "interim", actions: [act("withhold")] });
    expect(await receiptOf(waiting.ref)).toBe("pending");
    expect(await authorMail(statement)).toBe("pending");
    w.mailer.mode = "deliver";
    // The first two notices of the address are answered; the third stays open.
    await decided(moderator, one.caseId, { kind: "final", outcome: "no_violation" });
    await decided(moderator, two.caseId, { kind: "final", outcome: "not_evident" });

    toNextDispatch();
    const report = await round();
    expect(report.receipts).toBeGreaterThanOrEqual(1);
    expect(report.statements).toBeGreaterThanOrEqual(1);
    expect(await receiptOf(waiting.ref)).toBe("sent");
    expect(await authorMail(statement)).toBe("sent");
    expect(w.mailer.to(held.author.email, "moderation_decision")).toHaveLength(1);
    // One update for the address: the lines of its two answered notices, the two folded receipts, and a page paragraph
    // only for the notice whose receipt went out by itself.
    const updates = w.mailer.updatesTo(email);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.data.lines.map((line) => line.ref)).toEqual([one.ref, two.ref]);
    expect(updates[0]!.data.receipts.map((receipt) => receipt.ref)).toEqual([two.ref, three.ref]);
    expect(updates[0]!.data.receipts[0]!.pageUrl).toMatch(new RegExp(`/notice/${two.ref}#t=[A-Za-z0-9_-]{43}$`));
    expect(updates[0]!.data.receipts[0]!.items).toBe(postLink(w.config.APP_ORIGIN, posts[1]!.postId));
    expect(updates[0]!.data.pages.map((page) => page.ref)).toEqual([one.ref]);
    expect(updates[0]!.data.termsUrl).toBe(`${w.config.APP_ORIGIN}/terms`);
    expect([await receiptOf(two.ref), await receiptOf(three.ref)]).toEqual(["sent", "sent"]);
    // The other address gets an update of its folded receipt alone.
    const single = w.mailer.updatesTo(alone);
    expect(single).toHaveLength(1);
    expect(single[0]!.data).toMatchObject({ lines: [], pages: [] });
    expect(single[0]!.data.receipts.map((receipt) => receipt.ref)).toEqual([lonely.ref]);
    expect(await receiptOf(lonely.ref)).toBe("sent");
    await closeOpenCases();
  });

  test("the outcome lines' words: a restriction of what was already not shown, a post that quotes another, an account, and a decision changed by corrections in part and then in full", async () => {
    const email = w.address();
    // A post another case had already removed: the notice's own removal changes nothing now.
    const hidden = await post();
    const earlier = await sent(notices.rule([postTarget(hidden.postId)]));
    await decided(moderator, earlier.caseId, { kind: "final", actions: [act("remove")] });
    const quoted = await post();
    const quoting = await post(0, { quoteOfId: quoted.postId });
    const named = await w.account();
    const two = await post(2);
    const images = (await w.migrateDb.execute<{ id: string }>(sql`select m.id from post_media m where m.post_id = ${two.postId}::uuid order by m.position`)).map((row) => row.id);
    const notice = await sent(notices.illegal([postTarget(hidden.postId), postTarget(quoting.postId), accountTarget(named.handle), postTarget(two.postId)], { email }));
    const caseOf = (position: number) => notice.items.find((item) => item.position === position)!.case_id!;
    await decided(moderator, caseOf(1), { kind: "final", ground: "illegal", actions: [act("remove")] });
    await decided(moderator, caseOf(2), { kind: "final", outcome: "no_violation" });
    await decided(moderator, caseOf(3), { kind: "final", outcome: "not_evident" });
    const removal = await decided(moderator, caseOf(4), { kind: "final", ruleId: "R1", actions: images.map((id) => act("remove_media", id)) });
    // The named account changes its handle before the release: its line still shows the handle as the notice named it.
    await w.migrateDb.execute(sql`update profiles set handle = ${`r_${named.handle.slice(2)}`} where id = ${named.id}::uuid`);
    await w.migrateDb.execute(sql`insert into handle_history (handle_lower, profile_id, changed_at) values (${named.handle}, ${named.id}::uuid, now())`);
    toNextDispatch();
    await round();
    expect(lines(email).map((line) => line.outcome)).toEqual([
      `${OUTCOME_PHRASES.restricted_legal}. ${ALREADY_NOT_SHOWN}`,
      `${OUTCOME_PHRASES.no_violation}. ${QUOTE_ITEM_SCOPE}`,
      `${OUTCOME_PHRASES.not_evident}. ${ACCOUNT_ITEM_SCOPE}`,
      // The rule in the wording of the rulebook the decision was made under; a post that quotes nothing has no scope.
      "access restricted: it breaks korbat rule R1 (No sexual or pornographic content).",
    ]);
    expect(lines(email)[2]!.link).toBe(accountLink(w.config.APP_ORIGIN, named.handle));
    expect((await status(notice)).items.map((item) => item.scope)).toEqual([null, "quote", "account", null]);

    // One of the two images is given back: the item reads "reversed in part" from the next release, and is mailed again.
    await decided(moderator, caseOf(4), { kind: "correction", reviewsDecisionId: removal, outcome: "partly_reversed", actions: [act("restore_media", images[0]!)] });
    expect((await status(notice)).items[3]).toMatchObject({ outcome: "restricted_rule", changed: false });
    toNextDispatch();
    await round();
    expect(lines(email)).toEqual([expect.objectContaining({ item: 4, outcome: `${OUTCOME_PHRASES.partly_reversed}.`, changed: true, reexaminable: false, unseen: false })]);
    expect((await status(notice)).items[3]).toMatchObject({ outcome: "partly_reversed", changed: true });
    await decided(moderator, caseOf(4), { kind: "correction", reviewsDecisionId: removal, actions: [act("restore_media", images[1]!)] });
    toNextDispatch();
    await round();
    expect(lines(email)).toEqual([expect.objectContaining({ item: 4, outcome: `${OUTCOME_PHRASES.reversed}.`, changed: true })]);
    expect((await status(notice)).items[3]).toMatchObject({ outcome: "reversed", changed: true });
  });

  test("what the sender of another report reads after an admin's answer to a report of child sexual abuse material: UNSEEN_NO_ACTION in the mail's line and on the status page; about an account, the ordinary phrase with its scope, and the sealed phrase with the suspect scope after a seal", async () => {
    // A notice of illegality about an image post, and after it a report of child sexual abuse material about the same post.
    const email = w.address();
    const image = await post(2);
    const notice = await sent(notices.illegal([postTarget(image.postId)], { email }));
    const suspect = await sent(notices.csam([postTarget(image.postId)]));
    expect(suspect.caseId).toBe(notice.caseId);
    // The admin answers without a seal: the earlier notice is answered with it, its images unseen.
    await decided(admin, notice.caseId, { kind: "final", outcome: "no_violation" });
    // The same about an account whose posts hold images: the notice concerns the display name and bio, which staff read.
    const owner = await w.account();
    await newImageRow(w.apiDb, owner.id, await newPostRow(w.apiDb, owner.id), 0);
    const about = await sent(notices.illegal([accountTarget(owner.handle)], { email }));
    await sent(notices.csam([accountTarget(owner.handle)]));
    await decided(admin, about.caseId, { kind: "final", outcome: "no_violation" });
    // And an account whose images an admin seals for good: the earlier notice is answered by the sealing decision.
    const sealedOwner = await w.account();
    await newImageRow(w.apiDb, sealedOwner.id, await newPostRow(w.apiDb, sealedOwner.id), 0);
    const sealedNotice = await sent(notices.illegal([accountTarget(sealedOwner.handle)], { email }));
    await sent(notices.csam([accountTarget(sealedOwner.handle)]));
    await decided(admin, sealedNotice.caseId, { kind: "final", ruleId: "R2", actions: [act("seal_media")] });

    toNextDispatch();
    await round();
    expect(lines(email).map((line) => [line.ref, line.outcome, line.unseen, line.reexaminable])).toEqual([
      [notice.ref, UNSEEN_NO_ACTION, true, true],
      [about.ref, `${OUTCOME_PHRASES.no_violation}. ${ACCOUNT_ITEM_SCOPE}`, false, true],
      [sealedNotice.ref, `${SUSPECT_OUTCOME_PHRASES.sealed} ${ACCOUNT_SUSPECT_SCOPE}`, false, false],
    ]);
    expect((await status(notice)).items[0]).toMatchObject({ outcome: "no_violation", unseen: true, sealed: false, scope: null });
    expect((await status(about)).items[0]).toMatchObject({ outcome: "no_violation", unseen: false, scope: "account" });
    expect((await status(sealedNotice)).items[0]).toMatchObject({ outcome: "restricted_rule", sealed: true, scope: "account_suspect" });
    // The report of child sexual abuse material itself gets no mail: its outcome is on its status page alone.
    expect((await status(suspect)).items[0]).toMatchObject({ suspect: true, outcome: "no_violation", unseen: false });
    expect((await itemRows(suspect.ref))[0]!.outcome_mail).toBe("none");
  });

  test("a rule report on a post frozen through its author's account's case, and one on a post whose images are sealed for good, each answered without action by a moderator, read UNSEEN_NO_ACTION on the status page; once the post is no longer frozen, the ordinary phrase", async () => {
    // Frozen through the author's account's case.
    const frozen = await post(1);
    const freeze = await sent(notices.csam([accountTarget(frozen.author.handle)]));
    const first = await sent(notices.rule([postTarget(frozen.postId)]));
    await decided(moderator, first.caseId, { kind: "final", outcome: "no_violation" });
    // Sealed for good: the post's own case was sealed and closed by an admin.
    const sealedPost = await post(1);
    const report = await sent(notices.csam([postTarget(sealedPost.postId)]));
    await decided(admin, report.caseId, { kind: "final", ruleId: "R2", actions: [act("seal_media")] });
    const second = await sent(notices.rule([postTarget(sealedPost.postId)]));
    await decided(moderator, second.caseId, { kind: "final", outcome: "no_violation" });
    // No longer frozen: the account's report was answered without a seal before this one was decided.
    const free = await post(1);
    const account = await sent(notices.csam([accountTarget(free.author.handle)]));
    await decided(admin, account.caseId, { kind: "final", outcome: "no_violation" });
    const third = await sent(notices.rule([postTarget(free.postId)]));
    await decided(moderator, third.caseId, { kind: "final", outcome: "no_violation" });
    toNextDispatch();
    await round();
    expect((await status(first)).items[0]).toMatchObject({ outcome: "no_violation", unseen: true });
    // Such an answer leaves the re-examination unspent.
    expect((await status(first)).items[0]!.reexamination).toMatchObject({ open: true });
    expect((await status(second)).items[0]).toMatchObject({ outcome: "no_violation", unseen: true });
    expect((await status(third)).items[0]).toMatchObject({ outcome: "no_violation", unseen: false });
    expect((await status(account)).items[0]).toMatchObject({ suspect: true, outcome: "no_violation", scope: "account_suspect" });
    // A rule report sent signed out without a name or an address is owed no mail.
    expect((await itemRows(first.ref))[0]!.outcome_mail).toBe("none");
    await decided(admin, freeze.caseId, { kind: "final", outcome: "no_violation" });
  });

  test("an account whose address stopped korbat's report mails still gets the statement of a decision about it, and neither a receipt nor an update of its reports; once it resumes them, its next update goes", async () => {
    const account = await w.account();
    // The stop came from the address itself, on the status page of a notice sent signed out with it.
    const target = await post();
    const signedOut = await sent(notices.illegal([postTarget(target.postId)], { email: account.email }));
    expect(await w.authForModeration.stopNotifier(await contactOf(signedOut.ref), tokenOf(account.email))).toBe(true);
    expect(await w.authForModeration.accountReportMailStopped(account.id)).toBe(true);
    const other = await post();
    const report = await sent(notices.illegal([postTarget(other.postId)], { turnstileToken: undefined }), account.session);
    expect(await receiptOf(report.ref)).toBe("suppressed");
    await decided(moderator, report.caseId, { kind: "final", outcome: "no_violation" });
    await decided(moderator, signedOut.caseId, { kind: "final", outcome: "no_violation" });
    // A decision about the account's own post: its statement is no report mail, and nothing holds it back.
    const own = await newPostRow(w.apiDb, account.id);
    const about = await sent(notices.rule([postTarget(own)]));
    await decided(moderator, about.caseId, { kind: "final", actions: [act("remove")] });
    expect(w.mailer.to(account.email, "moderation_decision")).toHaveLength(1);
    toNextDispatch();
    await round();
    expect((await itemRows(report.ref))[0]).toMatchObject({ outcome_mail: "suppressed", released: true });
    expect((await itemRows(signedOut.ref))[0]).toMatchObject({ outcome_mail: "suppressed", released: true });
    expect(w.mailer.updatesTo(account.email)).toHaveLength(0);
    // The account resumes the mails in its settings: the next notice's receipt and update go.
    expect(await w.authForModeration.resumeAccountReportMail(account.id)).toBe(true);
    const next = await post();
    const later = await sent(notices.illegal([postTarget(next.postId)], { turnstileToken: undefined }), account.session);
    expect(await receiptOf(later.ref)).toBe("sent");
    await decided(moderator, later.caseId, { kind: "final", outcome: "no_violation" });
    toNextDispatch();
    await round();
    expect(w.mailer.updatesTo(account.email)).toHaveLength(1);
    expect(lines(account.email).map((line) => line.ref)).toEqual([later.ref]);
  });

  test("a contact that cannot be read stops neither the round nor another address's update, and its line goes once it can be read", async () => {
    const [first, second] = [await post(), await post()];
    const unreadable = w.address();
    const kept = await sent(notices.illegal([postTarget(first.postId)], { email: unreadable }));
    // The key was rotated without keeping the old one: what the old key encrypted no configured key opens.
    const keys = w.auth.deps.config;
    const [oldKey, oldPrevious] = [keys.notifierKey, keys.notifierPreviousKeys];
    keys.notifierKey = parseVersionedKey(`v9:${Buffer.alloc(32, 9).toString("base64")}`);
    keys.notifierPreviousKeys = [];
    try {
      const readable = w.address();
      const fresh = await sent(notices.illegal([postTarget(second.postId)], { email: readable }));
      await decided(moderator, kept.caseId, { kind: "final", outcome: "no_violation" });
      await decided(moderator, fresh.caseId, { kind: "final", outcome: "no_violation" });
      toNextDispatch();
      const report = await round();
      expect(report.marked).toBe(true);
      expect((await itemRows(kept.ref))[0]).toMatchObject({ outcome_mail: "pending", released: true });
      expect((await itemRows(fresh.ref))[0]!.outcome_mail).toBe("sent");
      expect(w.mailer.updatesTo(readable)).toHaveLength(1);
      expect(w.mailer.updatesTo(unreadable)).toHaveLength(0);
      // The old key is configured again, among the keys the new one replaced.
      keys.notifierPreviousKeys = [oldKey];
      ahead(10 * MIN);
      await round();
      expect((await itemRows(kept.ref))[0]!.outcome_mail).toBe("sent");
      expect(w.mailer.updatesTo(unreadable)).toHaveLength(1);
    } finally {
      keys.notifierKey = oldKey;
      keys.notifierPreviousKeys = oldPrevious;
    }
  });

  test("a step or a row that fails stops nothing, and no log line names a person: a case whose reach cannot be read still alerts; with the markers' store down the release still runs and the round is not the daily one; a receipt, a statement and an update that meet a fault are left as they were and logged with their step and their row's id; a refused statement is recorded failed at once", async () => {
    // A report of child sexual abuse material that waits: the round's first step reads what its case reaches.
    const image = await post(1);
    const urgent = await sent(notices.csam([postTarget(image.postId)]));
    // An address with a folded receipt and nothing else: it rides only in a daily round.
    const alone = w.address();
    const anchor = await post();
    await sent(notices.illegal([postTarget(anchor.postId)], { email: alone }));
    const lonely = await sent(notices.illegal([postTarget(anchor.postId)], { email: alone }));
    expect(await receiptOf(lonely.ref)).toBe("folded");
    // A signed-in reporter's notice, decided: its update will meet a fault that is not the relay's.
    const reporter = await w.account();
    const reported = await post();
    const signedIn = await sent(notices.illegal([postTarget(reported.postId)], { turnstileToken: undefined }), reporter.session);
    await decided(moderator, signedIn.caseId, { kind: "final", outcome: "no_violation" });
    // Two receipts and two statements the relay could not take.
    w.mailer.mode = "fail";
    const email = w.address();
    const target = await post();
    const notice = await sent(notices.illegal([postTarget(target.postId)], { email }));
    const faulty = await sent(notices.illegal([postTarget((await post()).postId)], { email: w.address() }));
    const [broken, refused] = [await post(), await post()];
    const brokenCase = await sent(notices.rule([postTarget(broken.postId)]));
    const refusedCase = await sent(notices.rule([postTarget(refused.postId)]));
    const brokenStatement = await decided(moderator, brokenCase.caseId, { kind: "interim", actions: [act("withhold")] });
    const refusedStatement = await decided(moderator, refusedCase.caseId, { kind: "interim", actions: [act("withhold")] });
    await decided(moderator, notice.caseId, { kind: "final", outcome: "no_violation" });
    expect([await receiptOf(notice.ref), await receiptOf(faulty.ref), await authorMail(brokenStatement), await authorMail(refusedStatement)]).toEqual(["pending", "pending", "pending", "pending"]);
    w.mailer.mode = "deliver";
    const faultyContact = await contactOf(faulty.ref);
    const faultyId = (await w.notice(faulty.ref))!.id;
    const signedInItems = await itemIds(signedIn.ref);

    toNextDispatch();
    const [media, mailAccount, mailNotifier, mailStaff, silent] = [w.deps.media, w.authForModeration.mailAccount, w.authForModeration.mailNotifier, w.authForModeration.mailStaff, w.deps.log];
    const kept = recorded();
    w.deps.log = kept.log;
    w.deps.media = { ...media, reach: async () => Promise.reject(new Error("the media repository is down")) };
    w.authForModeration.mailAccount = async (userId, message) => {
      // The reporter's update and one statement meet a fault that is not the relay's; the other statement an address the relay refuses for good.
      if (userId === reporter.id || userId === broken.author.id) throw new Error("the auth pool is down");
      if (userId !== refused.author.id) return mailAccount(userId, message);
      w.mailer.mode = "refuse";
      try {
        return await mailAccount(userId, message);
      } finally {
        w.mailer.mode = "deliver";
      }
    };
    w.authForModeration.mailNotifier = async (contactId, message) => {
      if (contactId === faultyContact) throw new Error("a ciphertext no configured key opens");
      return mailNotifier(contactId, message);
    };
    const noMarkers: JobLock = { acquire: async () => Promise.reject(new Error("the markers' store is down")), refresh: lock.refresh.bind(lock), release: lock.release.bind(lock) };
    let report: DispatchReport;
    try {
      report = await round(noMarkers);
    } finally {
      w.deps.media = media;
      w.authForModeration.mailAccount = mailAccount;
      w.authForModeration.mailNotifier = mailNotifier;
    }
    // The case whose reach could not be read counts as calling: an alert fails open, and this one went.
    expect(report.urgent).toBe("sent");
    // The release ran though its marker could be neither asked for nor written; such a round is not the daily one, so
    // the folded receipt that has nothing else waits.
    expect(report.released).toBeGreaterThanOrEqual(1);
    expect(report).toMatchObject({ marked: true, daily: false });
    expect(await receiptOf(lonely.ref)).toBe("folded");
    expect(w.mailer.updatesTo(alone)).toEqual([]);
    // Every other row went its way: the receipt and the line that met no fault are sent, the refused statement failed.
    expect([await receiptOf(notice.ref), await receiptOf(faulty.ref)]).toEqual(["sent", "pending"]);
    expect([(await itemRows(notice.ref))[0]!.outcome_mail, (await itemRows(signedIn.ref))[0]!.outcome_mail]).toEqual(["sent", "pending"]);
    expect([await authorMail(brokenStatement), await authorMail(refusedStatement)]).toEqual(["pending", "failed"]);
    // Each fault is logged as an error with its step and its row's id: the case, the notice, the decision, the items.
    const faults = kept.lines.filter((line) => line.level === "error").map((line) => line.fields);
    expect(faults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ step: "urgent", caseId: urgent.caseId }),
        expect.objectContaining({ step: "receipts", intakeId: faultyId }),
        expect.objectContaining({ step: "statements", decisionId: brokenStatement }),
        expect.objectContaining({ step: "outcomes", itemIds: signedInItems }),
      ]),
    );
    // No line names a person: no address, no handle and no account id, the reporter's least of all.
    expect(kept.lines.length).toBeGreaterThanOrEqual(5);
    for (const person of [reporter, image.author, anchor.author, reported.author, target.author, broken.author, refused.author]) {
      for (const named of [person.id, person.email, person.handle]) expect(kept.text(), named).not.toContain(named);
    }
    for (const address of [alone, email]) expect(kept.text()).not.toContain(address);

    // The next round's urgent step fails outright, and every later step still runs: the marker is written, so this is
    // the daily round; what was left as it was is sent, and nothing a second time.
    ahead(16 * MIN);
    w.authForModeration.mailStaff = async (message) => (message.template === "moderation_urgent" ? Promise.reject(new Error("the staff accounts cannot be read")) : mailStaff(message));
    const next = await round().finally(() => {
      w.authForModeration.mailStaff = mailStaff;
      w.deps.log = silent;
    });
    expect(next).toMatchObject({ urgent: "none", released: 0, marked: true, daily: true });
    expect(kept.lines.some((line) => line.level === "error" && line.fields.step === "urgent" && line.message === "moderation-dispatch: a step failed; the round goes on")).toBe(true);
    expect([await receiptOf(faulty.ref), await authorMail(brokenStatement), (await itemRows(signedIn.ref))[0]!.outcome_mail]).toEqual(["sent", "sent", "sent"]);
    expect(w.mailer.to(broken.author.email, "moderation_decision")).toHaveLength(1);
    expect(w.mailer.to(refused.author.email, "moderation_decision")).toHaveLength(0);
    expect(w.mailer.updatesTo(email)).toHaveLength(1);
    expect(w.mailer.updatesTo(reporter.email)).toHaveLength(1);
    // The folded receipt rode in the round that wrote the marker.
    expect(w.mailer.updatesTo(alone).map((update) => update.data.receipts.map((receipt) => receipt.ref))).toEqual([[lonely.ref]]);
    expect(await receiptOf(lonely.ref)).toBe("sent");
    await decided(admin, urgent.caseId, { kind: "final", outcome: "no_violation" });
    await closeOpenCases();
  });

  describe("the urgent lane's repeat", () => {
    const urgentMails = () => w.mailer.sent.filter((mail) => mail.template === "moderation_urgent").length;
    /** Whether the case still calls for someone once its newest item is older than the job's 15 minutes. */
    async function calls(caseId: string): Promise<boolean> {
      ahead(16 * MIN);
      return (await casesCalling(w.deps, jobNow())).includes(caseId);
    }

    test("a suspect item whose case reaches a served image repeats through a note and a field reset; it ends with a seal, starts again when an image is posted, ends with a recorded choice not to seal, and starts again when an image is posted after that choice", async () => {
      const owner = await w.account();
      const postId = await newPostRow(w.apiDb, owner.id);
      await newImageRow(w.apiDb, owner.id, postId, 0);
      const report = await sent(notices.csam([accountTarget(owner.handle)]));
      expect(await calls(report.caseId)).toBe(true);
      // The round sends the alert again, under the key of the first one, whose window is over by now.
      const mailed = urgentMails();
      expect((await round()).urgent).toBe("sent");
      expect(urgentMails()).toBeGreaterThan(mailed);
      ahead(5 * MIN);
      expect((await round()).urgent).toBe("throttled");
      // Neither a note nor a field reset ends it: the images are still served to someone.
      await saveText(w.apiDb, report.caseId, moderator.id, "note", "Art. 18 check: no suspicion");
      expect(await calls(report.caseId)).toBe(true);
      await decided(moderator, report.caseId, { kind: "interim", ruleId: "R6", actions: [act("reset_display_name")] });
      expect(await calls(report.caseId)).toBe(true);
      // A seal leaves no served image.
      await decided(moderator, report.caseId, { kind: "interim", ruleId: "R2", actions: [act("seal_media")] });
      expect(await calls(report.caseId)).toBe(false);
      // An image posted afterwards is not covered by that seal: the alert starts again by itself.
      const later = await newPostRow(w.apiDb, owner.id, { createdAt: sql`now()` });
      await newImageRow(w.apiDb, owner.id, later, 0);
      expect(await calls(report.caseId)).toBe(true);
      // A recorded choice not to seal ends it for the images posted before it,
      await saveText(w.apiDb, report.caseId, moderator.id, "seal_declined", "The report repeats one that was answered.");
      expect(await calls(report.caseId)).toBe(false);
      // A seal taken after that choice covers the image posted before it, and changes nothing about the alert:
      await decided(moderator, report.caseId, { kind: "interim", ruleId: "R2", actions: [act("seal_media")] });
      expect(await calls(report.caseId)).toBe(false);
      // an image posted after the choice starts it again, also though a seal was taken in between.
      await new Promise((resolve) => setTimeout(resolve, 25));
      const newest = await newPostRow(w.apiDb, owner.id, { createdAt: sql`now()` });
      await newImageRow(w.apiDb, owner.id, newest, 0);
      expect(await calls(report.caseId)).toBe(true);
      // The admin's answer ends it, and with no case calling the round sends nothing.
      await decided(admin, report.caseId, { kind: "final", outcome: "no_violation" });
      expect(await calls(report.caseId)).toBe(false);
      expect(await casesCalling(w.deps, jobNow())).toEqual([]);
      const quiet = urgentMails();
      expect((await round()).urgent).toBe("none");
      expect(urgentMails()).toBe(quiet);
    });

    test("a post case's withhold does not end a suspect item's repeat while its images are served", async () => {
      const { postId } = await post(1);
      const report = await sent(notices.csam([postTarget(postId)]));
      await decided(moderator, report.caseId, { kind: "interim", ruleId: "R1", actions: [act("withhold")] });
      // Withheld, the post's images still go to their author.
      expect(await calls(report.caseId)).toBe(true);
      await decided(admin, report.caseId, { kind: "final", outcome: "no_violation" });
    });

    test("a suspect item whose case reaches no served image ends with a note saved after it arrived, and not with one saved before it", async () => {
      const { postId } = await post(0);
      // A note from before the report arrived: the case was opened by a rule report.
      const rule = await sent(notices.rule([postTarget(postId)]));
      await saveText(w.apiDb, rule.caseId, moderator.id, "note", "A note from before the report.");
      const report = await sent(notices.csam([postTarget(postId)]));
      expect(report.caseId).toBe(rule.caseId);
      expect(await calls(report.caseId)).toBe(true);
      await saveText(w.apiDb, report.caseId, moderator.id, "note", "Art. 18 check: no suspicion");
      expect(await calls(report.caseId)).toBe(false);
      await decided(admin, report.caseId, { kind: "final", outcome: "no_violation" });
    });

    test("an R5 item on a visible post is never ended by a note, and is ended by a withhold taken while deciding; a later item on the post, which is then not visible, is ended by a note", async () => {
      const { postId } = await post();
      const threat = await sent(notices.rule([postTarget(postId)], { ruleId: "R5" }));
      expect(await calls(threat.caseId)).toBe(true);
      await saveText(w.apiDb, threat.caseId, moderator.id, "note", "Art. 18 check: no suspicion");
      expect(await calls(threat.caseId)).toBe(true);
      await decided(moderator, threat.caseId, { kind: "interim", ruleId: "R5", actions: [act("withhold")] });
      expect(await calls(threat.caseId)).toBe(false);
      // A second report arrives on the post, which is now withheld: it calls again, and a note ends that.
      const again = await sent(notices.rule([postTarget(postId)], { ruleId: "R5" }));
      expect(again.caseId).toBe(threat.caseId);
      expect(await calls(threat.caseId)).toBe(true);
      await saveText(w.apiDb, threat.caseId, moderator.id, "note", "Art. 18 check: no suspicion, second report");
      expect(await calls(threat.caseId)).toBe(false);
      await decided(admin, threat.caseId, { kind: "final", ruleId: "R5", actions: [act("remove")] });
    });
  });

  test("a relay failure leaves the lines pending for the next round; a refused address is recorded failed at once and is owed nothing more; a stopped address gets no update; and a line, a receipt and a statement still unsent after five days are tried once more and given up", async () => {
    const made = [];
    for (let i = 0; i < 4; i++) {
      const email = w.address();
      const { postId } = await post();
      const notice = await sent(notices.illegal([postTarget(postId)], { email }));
      await decided(moderator, notice.caseId, { kind: "final", outcome: "no_violation" });
      made.push({ ...notice, email, contactId: await contactOf(notice.ref) });
    }
    const [retried, refused, stopped, lost] = made as [(typeof made)[number], (typeof made)[number], (typeof made)[number], (typeof made)[number]];
    // The third address pressed stop on its page, with the token of its receipt's link.
    expect(await w.authForModeration.stopNotifier(stopped.contactId, tokenOf(stopped.email))).toBe(true);
    // A receipt and a statement that the relay cannot take, now or later.
    w.mailer.mode = "fail";
    const unreachable = w.address();
    const waiting = await sent(notices.illegal([postTarget((await post()).postId)], { email: unreachable }));
    const held = await post();
    const heldCase = await sent(notices.rule([postTarget(held.postId)]));
    const statement = await decided(moderator, heldCase.caseId, { kind: "interim", actions: [act("withhold")] });
    w.mailer.mode = "deliver";
    expect([await receiptOf(waiting.ref), await authorMail(statement)]).toEqual(["pending", "pending"]);
    const unreached = new Set([lost.email, unreachable, held.author.email]);

    toNextDispatch();
    // The relay takes nothing: every line stays pending, and so nothing is recorded but the stop.
    w.mailer.mode = "fail";
    await round();
    expect((await itemRows(retried.ref))[0]).toMatchObject({ outcome_mail: "pending", released: true });
    expect((await itemRows(stopped.ref))[0]!.outcome_mail).toBe("suppressed");
    // The relay now refuses the second address for good, cannot take the fourth's mail, and takes the others.
    const send = w.mailer.send.bind(w.mailer);
    w.mailer.mode = "deliver";
    w.mailer.send = async (message) => {
      w.mailer.mode = message.to === refused.email ? "refuse" : unreached.has(message.to) ? "fail" : "deliver";
      try {
        await send(message);
      } finally {
        w.mailer.mode = "deliver";
      }
    };
    try {
      ahead(10 * MIN);
      await round();
      expect((await itemRows(retried.ref))[0]!.outcome_mail).toBe("sent");
      expect(w.mailer.updatesTo(retried.email)).toHaveLength(1);
      expect((await itemRows(refused.ref))[0]!.outcome_mail).toBe("failed");
      expect((await itemRows(lost.ref))[0]!.outcome_mail).toBe("pending");
      expect(w.mailer.updatesTo(stopped.email)).toHaveLength(0);
      // The receipt and the statement the relay could not take were tried again, and wait on.
      expect([await receiptOf(waiting.ref), await authorMail(statement)]).toEqual(["pending", "pending"]);
      const refusedDay = await forgetAfter(refused.contactId);
      // Five days on, the relay still cannot take the fourth address's mail: the round tries it once more, then gives it up.
      ahead(5 * DAY + MIN);
      const tried = () => w.mailer.attempts.filter((message) => message.to === lost.email && message.template === "notice_update").length;
      const attempts = tried();
      const [silent, kept] = [w.deps.log, recorded()];
      w.deps.log = kept.log;
      const report = await round().finally(() => {
        w.deps.log = silent;
      });
      expect(report.daily).toBe(true);
      // Each mail given up is logged as such with its kind and its row's id, and nothing that names anyone.
      const givenUp = kept.lines.filter((line) => line.message === "moderation: mail given up");
      expect(givenUp.every((line) => line.level === "warn" && Object.keys(line.fields).sort().join() === "id,job,kind")).toBe(true);
      expect(givenUp.map((line) => `${String(line.fields.kind)} ${String(line.fields.id)}`)).toEqual(
        expect.arrayContaining([`receipt ${(await w.notice(waiting.ref))!.id}`, `statement ${statement}`, `outcome ${(await itemIds(lost.ref))[0]!}`]),
      );
      expect(givenUp).toHaveLength(report.givenUp.receipts + report.givenUp.authorMails + report.givenUp.outcomes);
      for (const address of [lost.email, unreachable, held.author.email]) expect(kept.text()).not.toContain(address);
      expect(tried()).toBe(attempts + 1);
      expect((await itemRows(lost.ref))[0]!.outcome_mail).toBe("failed");
      expect(report.givenUp.outcomes).toBeGreaterThanOrEqual(1);
      // So are the receipt and the statement that stayed unsent for five days.
      expect([await receiptOf(waiting.ref), await authorMail(statement)]).toEqual(["failed", "failed"]);
      expect(Math.min(report.givenUp.receipts, report.givenUp.authorMails)).toBeGreaterThanOrEqual(1);
      // The status page still shows the outcome: only the mail was given up.
      expect((await status(lost)).items[0]!.outcome).toBe("no_violation");
      // A contact whose only line failed was owed nothing when that day's release ran: its day did not move, and the
      // one whose line was still pending then was kept for six more months.
      expect(await forgetAfter(refused.contactId)).toBe(refusedDay);
      expect(await forgetAfter(lost.contactId)).toBeGreaterThan(refusedDay);
    } finally {
      w.mailer.send = send;
    }
  });

  test("a daily step whose second half fails releases nothing new when it runs again and sends no outcome mail until that half has finished; failing for six days, it gives no line up before the line was tried", async () => {
    const { postId } = await post();
    const email = w.address();
    const notice = await sent(notices.illegal([postTarget(postId)], { email }));
    await decided(moderator, notice.caseId, { kind: "final", outcome: "no_violation" });
    toNextDispatch();
    const forget = w.authForModeration.forgetNotifierAfter;
    w.authForModeration.forgetNotifierAfter = async () => Promise.reject(new Error("the auth pool is down"));
    try {
      // The release ran and is committed; the marker is not set, so no outcome mail goes.
      const failing = await round();
      expect(failing.released).toBeGreaterThanOrEqual(1);
      expect(failing).toMatchObject({ marked: false, daily: false, outcomeMails: 0 });
      expect((await itemRows(notice.ref))[0]).toMatchObject({ outcome_mail: "pending", released: true });
      ahead(10 * MIN);
      expect(await round()).toMatchObject({ released: 0, marked: false });
      // Six days of it: the line was never tried, so it is not given up.
      ahead(6 * DAY);
      expect(await round()).toMatchObject({ marked: false, givenUp: { outcomes: 0 } });
      expect((await itemRows(notice.ref))[0]!.outcome_mail).toBe("pending");
      expect(w.mailer.updatesTo(email)).toHaveLength(0);
    } finally {
      w.authForModeration.forgetNotifierAfter = forget;
    }
    // Once it works again the step runs to its end, releases nothing new, sets the marker, and the mail goes.
    ahead(10 * MIN);
    expect(await round()).toMatchObject({ released: 0, marked: true, daily: true });
    expect(w.mailer.updatesTo(email)).toHaveLength(1);
    expect((await itemRows(notice.ref))[0]!.outcome_mail).toBe("sent");
  });

  test("a case still undecided after 13 months keeps its notifier's contact: every daily round moves its day while the notice is owed an answer", async () => {
    const { postId } = await post();
    const notice = await sent(notices.illegal([postTarget(postId)], { email: w.address() }));
    const contactId = await contactOf(notice.ref);
    // Stored to be forgotten 13 months after the notice, should no daily round ever run.
    const stored = await forgetAfter(contactId);
    ahead(400 * DAY);
    expect(stored).toBeLessThan(jobNow().getTime());
    expect((await round()).daily).toBe(true);
    expect(Math.abs((await forgetAfter(contactId)) - appealDeadline(jobNow()).getTime())).toBeLessThan(5 * MIN);
  });

  test("this file left no row behind: the moderation tables and the four auth tables of moderation cases hold what they held before it", async () => {
    await w.cleanUp();
    await d.close();
    expect(await counts()).toEqual(before);
  });
});
