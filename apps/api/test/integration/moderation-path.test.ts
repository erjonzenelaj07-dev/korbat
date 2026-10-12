import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { MEASURES, OUTCOME_PHRASES, SUSPECT_OUTCOME_PHRASES, UNSEEN_NO_ACTION, outcomeWords, type NoticeItemStatus, type NoticeRequest } from "@korbat/contracts";
import { REDRESS_TEXTS, STATEMENT_WORDS, getRule, statementParagraphs } from "@korbat/rules";
import { MemoryJobLock, type JobLock } from "../../src/lib/jobs";
import { afterDecision } from "../../src/moderation/decide";
import { dispatchRound } from "../../src/moderation/dispatch";
import { noticeStatus, submitNotice } from "../../src/moderation/intake";
import { decisionStatement } from "../../src/moderation/statement";
import { deciderWorld, type DeciderWorld, type RealStaff } from "./moderation-decide";
import { act, authCaseCounts, imageStates, moderationCounts, newImageRow, newPostRow, postFrozen, refusal, saveText } from "./moderation-fixtures";
import { noticesWorld, notices, postTarget, type NoticesWorld } from "./notices-harness";

// Every test signs several decisions with real staff keys and runs a dispatch round: more than a test gets by default.
vi.setConfig({ testTimeout: 180_000 });

const MIN = 60_000;
const HOUR = 60 * MIN;

/**
 * The path for child sexual abuse material as one flow (3c design, sections 7.5, 7.8 and 7.12), against the real
 * database, the real auth module and a scripted mailer: a moderator seals while an admin decides, and the admin gives
 * one of two answers, a seal for good or an answer without a seal. At each step: what the images are, what the author is
 * mailed, what every staff account is mailed, what the home screen lists, and, after the daily release, what whoever
 * reported reads. Every decision is confirmed with a real staff key. The file's last test holds it to leaving no row
 * behind.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the path for child sexual abuse material, from the seal taken while deciding to the admin's two answers", () => {
  let w: NoticesWorld;
  let d: DeciderWorld;
  let moderator: RealStaff;
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
    moderator = await d.staff("moderator");
    admin = await d.staff("admin");
  }, 120_000);
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
  const decided = async (staff: RealStaff, caseId: string, input: Parameters<DeciderWorld["decideAs"]>[2]) => {
    const outcome = await d.decideAs(staff, caseId, input);
    if (typeof outcome === "string") throw new Error(`the decision was not recorded: ${outcome}`);
    return outcome.decisionId;
  };
  async function sent(request: NoticeRequest) {
    const answer = w.remember(await submitNotice(w.deps, request, w.sender()));
    await w.moderation.settle();
    const items = await w.items(answer.ref);
    return { ...answer, caseId: items[0]!.case_id! };
  }
  const itemOf = async (notice: { ref: string; token?: string }) => (await noticeStatus(w.deps, { ref: notice.ref, token: notice.token! }, w.sender().netHash)).items[0]!;
  /** An item's outcome as its sender reads it, composed as the status page and the app compose it. */
  const wordsOf = (item: NoticeItemStatus, ruleId: string | null = null) =>
    outcomeWords({ outcome: item.outcome!, rule: ruleId === null ? null : { id: ruleId, title: getRule(ruleId)!.title }, suspect: item.suspect, sealed: item.sealed, unseen: item.unseen, noEffect: false, scope: item.scope });
  /** A post of a new account with this many images. */
  async function post(images: number) {
    const author = await w.account();
    const postId = await newPostRow(w.apiDb, author.id);
    const mediaIds: string[] = [];
    for (let position = 0; position < images; position++) mediaIds.push(await newImageRow(w.apiDb, author.id, postId, position));
    return { author, postId, mediaIds };
  }
  /** The statements mailed to this address, in order. */
  const statements = (address: string) => w.mailer.to(address, "moderation_decision").map((mail) => mail.data);
  const paragraphsOf = async (decisionId: string) => statementParagraphs((await decisionStatement(w.apiDb, decisionId))!.statement);
  const decidedAt = async (decisionId: string) => (await decisionStatement(w.apiDb, decisionId))!.statement.decidedAt;
  /** The mails that told this staff account of a decision that lifted the protection of reported images. */
  const lifted = async (staff: RealStaff) => w.mailer.to((await w.repo.findUserById(staff.id))!.email, "moderation_csam_lifted").map((mail) => mail.data);
  /** The home screen's three lists of the path, each cut down to one case. */
  async function home(caseId: string) {
    const overview = await w.moderation.forStaff.overview(admin.session);
    const of = <T extends { caseId: string }>(list: { items: T[] }) => list.items.filter((item) => item.caseId === caseId);
    return { protectionLifted: of(overview.protectionLifted), sealsDeclined: of(overview.sealsDeclined), interimSeals: of(overview.interimSeals), whole: JSON.stringify(overview) };
  }

  test("a moderator seals while an admin decides, and the admin seals for good: the images are sealed for everyone throughout, the author is told each time with that decision's redress, no staff alert goes, and both reports read the sealed phrase", async () => {
    const { author, postId, mediaIds } = await post(2);
    const email = w.address();
    // A notice of illegality about the post, and then a report of child sexual abuse material about it: one case.
    const notice = await sent(notices.illegal([postTarget(postId)], { email }));
    const report = await sent(notices.csam([postTarget(postId)]));
    expect(report.caseId).toBe(notice.caseId);
    expect(await postFrozen(w.apiDb, postId)).toBe(true);
    expect(await imageStates(w.apiDb, mediaIds)).toEqual(["visible", "visible"]);
    const alerts = (await lifted(moderator)).length;

    // The moderator on duty seals without opening anything.
    const seal = await decided(moderator, report.caseId, { kind: "interim", ruleId: "R2", actions: [act("seal_media")] });
    expect(await imageStates(w.apiDb, mediaIds)).toEqual(["sealed", "sealed"]);
    const first = await paragraphsOf(seal);
    expect(statements(author.email)).toEqual([{ subject: "seal_deciding", statement: first.join("\n") }]);
    expect(first[0]).toMatch(/^korbat sealed the images of your post of [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2} UTC \(2 in all\): nobody can see them, you included\.$/);
    // A decision taken while deciding ends with korbat's decision, and cannot be appealed.
    expect(first.at(-1)).toBe(REDRESS_TEXTS[1].interim);
    expect(first.join(" ")).not.toContain(STATEMENT_WORDS.sealForGood);
    // The home screen lists the seal with who took it and what it covers.
    expect(await home(report.caseId)).toMatchObject({ interimSeals: [{ at: await decidedAt(seal), handle: moderator.handle, caseId: report.caseId, posts: 1, images: 2 }], protectionLifted: [] });

    // A moderator can neither answer the report nor lift the seal: each is an admin's.
    expect(await refusal(d.decideAs(moderator, report.caseId, { kind: "final", outcome: "no_violation" }))).toBe("admin_required");
    expect(await refusal(d.decideAs(moderator, report.caseId, { kind: "final", ruleId: "R2", actions: [act("seal_media")] }))).toBe("admin_required");
    expect(await refusal(d.decideAs(moderator, report.caseId, { kind: "correction", reviewsDecisionId: seal, actions: [act("unseal_media")] }))).toBe("admin_required");
    expect(await imageStates(w.apiDb, mediaIds)).toEqual(["sealed", "sealed"]);

    // The admin's first answer: a seal for good, which closes the case.
    const final = await decided(admin, report.caseId, { kind: "final", ruleId: "R2", actions: [act("seal_media")] });
    expect(await imageStates(w.apiDb, mediaIds)).toEqual(["sealed", "sealed"]);
    const last = await paragraphsOf(final);
    expect(statements(author.email)).toEqual([expect.anything(), { subject: "seal_final", statement: last.join("\n") }]);
    expect(last[0]).toContain(STATEMENT_WORDS.sealForGood);
    // The appeal with its last day, and the sentence that an appeal of a seal waits for the authorities.
    expect(last.at(-1)).toMatch(/^You can appeal this decision once, free of charge, within six months of being told, until [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2} UTC:/);
    expect(last.at(-1)!.endsWith(` ${STATEMENT_WORDS.sealAppeal}`)).toBe(true);
    // Nothing was lifted: no staff account is alerted, and the seal taken while deciding, which ended with the case, is no longer listed.
    expect((await lifted(moderator)).length).toBe(alerts);
    expect(await home(report.caseId)).toMatchObject({ interimSeals: [], protectionLifted: [] });

    // After the release, the report and the notice the same decision answered both read the sealed phrase.
    await released();
    const reported = await itemOf(report);
    expect(reported).toMatchObject({ suspect: true, outcome: "restricted_rule", sealed: true, unseen: false, reexamination: null });
    expect(wordsOf(reported, "R2")).toBe(SUSPECT_OUTCOME_PHRASES.sealed);
    const noticed = await itemOf(notice);
    expect(noticed).toMatchObject({ suspect: false, outcome: "restricted_rule", sealed: true });
    expect(wordsOf(noticed, "R2")).toBe(SUSPECT_OUTCOME_PHRASES.sealed);
    expect(w.mailer.updatesTo(email).at(-1)!.data.lines.map((line) => line.outcome)).toEqual([SUSPECT_OUTCOME_PHRASES.sealed]);
  });

  test("the admin's second answer, without a seal, reaches through the report and no further: the seal taken while deciding ends, the author is told, every staff account is told at once, the home screen lists it, the report reads the no-action phrase, an earlier rule report is answered unseen, and a later one stays open for a moderator who can then see the images", async () => {
    const { author, postId, mediaIds } = await post(1);
    // A rule report, then the report of child sexual abuse material: the case's first and second item.
    const earlier = await sent(notices.rule([postTarget(postId)]));
    const report = await sent(notices.csam([postTarget(postId)]));
    expect(report.caseId).toBe(earlier.caseId);
    const seal = await decided(moderator, report.caseId, { kind: "interim", ruleId: "R2", actions: [act("seal_media")] });
    expect(await imageStates(w.apiDb, mediaIds)).toEqual(["sealed"]);
    // A second rule report arrives after it, in the same case: its third item.
    const later = await sent(notices.rule([postTarget(postId)]));
    expect(later.caseId).toBe(report.caseId);
    const [toModerator, toAdmin] = [(await lifted(moderator)).length, (await lifted(admin)).length];

    // The admin answers through the report of child sexual abuse material, the second item, and no further: the range
    // the console sends on such a case.
    const answer = await decided(admin, report.caseId, { kind: "final", outcome: "no_violation", throughSeq: 2 });
    expect(await imageStates(w.apiDb, mediaIds)).toEqual(["visible"]);
    expect(await postFrozen(w.apiDb, postId)).toBe(false);
    const [open] = await w.migrateDb.execute<{ closed: boolean; answered_seq: number; intake_seq: number }>(sql`select closed_at is not null as closed, answered_seq, intake_seq from cases where id = ${report.caseId}::uuid`);
    expect({ ...open! }).toEqual({ closed: false, answered_seq: 2, intake_seq: 3 });

    // The author is told that what korbat did while deciding has ended; nothing of it can be appealed.
    const told = await paragraphsOf(answer);
    expect(statements(author.email)).toEqual([expect.objectContaining({ subject: "seal_deciding" }), { subject: "lifted_deciding", statement: told.join("\n") }]);
    expect(told[0]).toBe(STATEMENT_WORDS.ended(MEASURES.seal_media.label));
    expect(told.at(-1)).toBe(REDRESS_TEXTS[1].notAppealable);
    // Every staff account, the admin's own included, is told at once who ended the protection and when: it cannot be undone.
    const alert = { handle: admin.handle, time: expect.stringMatching(/^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2} UTC$/), what: "dismissed" };
    expect((await lifted(moderator)).slice(toModerator)).toEqual([alert]);
    expect((await lifted(admin)).slice(toAdmin)).toEqual([alert]);
    // And the home screen lists it for every staff member, while the seal it ended is no longer listed.
    expect(await home(report.caseId)).toMatchObject({ protectionLifted: [{ at: await decidedAt(answer), handle: admin.handle, caseId: report.caseId, kind: "dismissed" }], interimSeals: [] });

    // The moderator decides the rule report with the images in sight: an ordinary answer.
    await decided(moderator, report.caseId, { kind: "final", outcome: "no_violation" });
    await released();
    const reported = await itemOf(report);
    expect(reported).toMatchObject({ suspect: true, outcome: "no_violation", sealed: false, unseen: false });
    expect(wordsOf(reported)).toBe(SUSPECT_OUTCOME_PHRASES.no_action);
    // The rule report that arrived before it was answered by the admin with the images out of sight, and says so;
    const unseen = await itemOf(earlier);
    expect(unseen).toMatchObject({ suspect: false, outcome: "no_violation", unseen: true });
    expect(wordsOf(unseen)).toBe(UNSEEN_NO_ACTION);
    // the one that arrived after it was judged with the images.
    const ruled = await itemOf(later);
    expect(ruled).toMatchObject({ suspect: false, outcome: "no_violation", unseen: false });
    expect(wordsOf(ruled)).toBe(`${OUTCOME_PHRASES.no_violation}.`);
    void seal;
  });

  test("a recorded choice not to seal is listed on the home screen without its reason; an admin who lifts a seal taken while deciding is told to every staff account as an unsealing, and the report keeps the post frozen until it is answered", async () => {
    const { author, postId, mediaIds } = await post(1);
    const report = await sent(notices.csam([postTarget(postId)]));
    await saveText(w.apiDb, report.caseId, moderator.id, "seal_declined", "The report repeats one that was answered yesterday.");
    const listed = await home(report.caseId);
    expect(listed.sealsDeclined).toEqual([{ at: expect.any(String), handle: moderator.handle, caseId: report.caseId }]);
    expect(listed.whole).not.toContain("answered yesterday");

    // The seal is taken after all, and an admin lifts it while the report still waits.
    const seal = await decided(moderator, report.caseId, { kind: "interim", ruleId: "R2", actions: [act("seal_media")] });
    const before = (await lifted(moderator)).length;
    const lift = await decided(admin, report.caseId, { kind: "correction", reviewsDecisionId: seal, actions: [act("unseal_media")] });
    expect(await imageStates(w.apiDb, mediaIds)).toEqual(["visible"]);
    // The report is unanswered: the post stays frozen, and no staff member is served its images.
    expect(await postFrozen(w.apiDb, postId)).toBe(true);
    expect((await lifted(moderator)).slice(before)).toEqual([{ handle: admin.handle, time: expect.any(String), what: "unsealed" }]);
    const told = await paragraphsOf(lift);
    expect(statements(author.email).at(-1)).toEqual({ subject: "lifted_deciding", statement: told.join("\n") });
    expect(told).toContain(STATEMENT_WORDS.unsealed);

    // The admin's answer without a seal is a second entry: newest first, each with what it did.
    const answer = await decided(admin, report.caseId, { kind: "final", outcome: "no_violation" });
    expect((await lifted(moderator)).slice(before).map((mail) => mail.what)).toEqual(["unsealed", "dismissed"]);
    expect((await home(report.caseId)).protectionLifted).toEqual([
      { at: await decidedAt(answer), handle: admin.handle, caseId: report.caseId, kind: "dismissed" },
      { at: await decidedAt(lift), handle: admin.handle, caseId: report.caseId, kind: "unsealed" },
    ]);
    expect(await postFrozen(w.apiDb, postId)).toBe(false);
  });

  test("every staff account is told of an answer without a seal whatever becomes of the steps beside that mail: the author's statement the relay cannot take, and the count of the admin's decisions that cannot be read", async () => {
    const { author, postId } = await post(1);
    const report = await sent(notices.csam([postTarget(postId)]));
    // A seal taken while deciding: the answer that ends it owes its author a statement.
    await decided(moderator, report.caseId, { kind: "interim", ruleId: "R2", actions: [act("seal_media")] });
    const [toModerator, toAdmin] = [(await lifted(moderator)).length, (await lifted(admin)).length];
    // The relay cannot take a mail to the author's address, and takes every other.
    const send = w.mailer.send.bind(w.mailer);
    w.mailer.send = async (message) => {
      w.mailer.mode = message.to === author.email ? "fail" : "deliver";
      try {
        await send(message);
      } finally {
        w.mailer.mode = "deliver";
      }
    };
    let answer: string;
    try {
      answer = await decided(admin, report.caseId, { kind: "final", outcome: "no_violation" });
    } finally {
      w.mailer.send = send;
    }
    // The statement waits for the dispatch job; the staff were told at once, each once.
    const [mail] = await w.apiDb.execute<{ author_mail: string }>(sql`select author_mail from decisions where id = ${answer}::uuid`);
    expect(mail!.author_mail).toBe("pending");
    const alert = { handle: admin.handle, time: expect.any(String), what: "dismissed" };
    expect((await lifted(moderator)).slice(toModerator)).toEqual([alert]);
    expect((await lifted(admin)).slice(toAdmin)).toEqual([alert]);

    // The same steps once more for the committed answer, with the count of the admin's recent decisions failing: the
    // read of that count raises, and the staff are told all the same.
    const failing = new Proxy(w.apiDb, {
      get(target, property, receiver) {
        if (property !== "execute") return Reflect.get(target, property, receiver) as unknown;
        return (query: Parameters<typeof target.execute>[0]) => {
          const text = new PgDialect().sqlToQuery(query as SQL).sql;
          if (text.includes("count(*)") && text.includes("decided_by")) return Promise.reject(new Error("the count could not be read"));
          return target.execute(query);
        };
      },
    });
    await afterDecision({ apiDb: failing, auth: w.authForModeration, limits: w.deps.limits, log: w.deps.log }, admin.id, answer);
    expect((await lifted(moderator)).slice(toModerator)).toEqual([alert, alert]);
    expect((await lifted(admin)).slice(toAdmin)).toEqual([alert, alert]);
  });

  test("this file left no row behind: the moderation tables and the four auth tables of moderation cases hold what they held before it", async () => {
    await w.cleanUp();
    await d.close();
    expect(await counts()).toEqual(before);
  });
});
