import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { ACCOUNT_ITEM_SCOPE, ExportFormat, OUTCOME_PHRASES, QUOTE_ITEM_SCOPE, itemOutcomeWords, type NoticeRequest } from "@korbat/contracts";
import { RULES_VERSION, getRule } from "@korbat/rules";
import type { AccountDeps } from "../../src/account/context";
import { buildExport, writeExport } from "../../src/account/flows/export";
import { createZipWriter } from "../../src/account/zip";
import { mediaForAccount } from "../../src/media";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { fileAppeal } from "../../src/moderation/appeals";
import { reexamineOwnItem, submitNotice } from "../../src/moderation/intake";
import { eraseIntake, releaseOutcomes } from "../../src/moderation/repo";
import { reporterList } from "../../src/moderation/reports";
import { exportProfile } from "../../src/social/flows/export";
import { mediaHarness, type MediaHarness } from "./media-harness";
import { deciderWorld, type DeciderWorld, type RealStaff } from "./moderation-decide";
import { act, authCaseCounts, moderationCounts, newImageRow, newPostRow, saveText } from "./moderation-fixtures";
import { accountTarget, linkTarget, noticesWorld, notices, postTarget, type NoticesWorld } from "./notices-harness";
import { ageIntake } from "./retention-fixtures";
import { socialHarness, type SocialHarness } from "./social-harness";

// Every decision is confirmed with a real staff key, and each test makes several: more than a test gets by default.
vi.setConfig({ testTimeout: 180_000 });

const HOUR = 60 * 60_000;

/**
 * The export's moderation member on PostgreSQL (3c design, sections 7.11, 11 and 12), through the account module's own
 * export over the real auth, social, media and moderation modules: the decisions an account was told of, as its Cases
 * screen lists them, with what each statement tells; its own reports as its list shows them, an item decided but not
 * released without its outcome; never another person's report, a reporter, a notifier or a staff member; and a post whose
 * images are sealed with its text and without those images. Every decision is confirmed with a real staff key, every
 * report goes through the intake, and outcomes are released by the database's own function. export.json is held
 * strictly equal to its parsed form. Every test commits; the file's last test removes what was stored and holds the
 * tables to what they held before it.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the export's moderation member", () => {
  let w: NoticesWorld;
  let d: DeciderWorld;
  let m: MediaHarness;
  let s: SocialHarness;
  let moderator: RealStaff;
  let admin: RealStaff;
  let origin: string;
  let before: Record<string, number>;

  beforeAll(async () => {
    w = noticesWorld();
    origin = w.config.APP_ORIGIN;
    d = deciderWorld(w.apiDb, { auth: w.authForModeration, rateLimitStore: w.deps.limits });
    before = await counts();
    m = await mediaHarness(w.apiDb);
    // The social module's export over the media repository's one list for posts, as the server wires it; nothing here attaches or deletes an image.
    s = socialHarness(w.apiDb, { media: { attach: async () => undefined, detachAll: async () => [], requestDeletion: async () => undefined, forPosts: (postIds) => m.deps.repo.forPosts(postIds) } });
    moderator = await d.staff("moderator");
    admin = await d.staff("admin");
  }, 120_000);
  afterAll(async () => {
    m.cleanup();
    await w.close();
  });
  beforeEach(() => {
    // Past every hourly window of the limit store and the urgent alert's throttle.
    w.ahead.limitsMs += HOUR;
  });

  const counts = async (): Promise<Record<string, number>> => ({ ...(await moderationCounts(w.apiDb)), ...(await authCaseCounts(w.migrateDb)) });
  const today = () => new Date().toISOString().slice(0, 10);

  // The purge's side of the three interfaces is not exercised by the export; account-deletion.test.ts covers it.
  const notHere = async (): Promise<never> => {
    throw new Error("not exercised by the export");
  };
  /** The account module's dependencies as the server composes them from the module indexes, the moderation module's among them. */
  const deps = (): AccountDeps => ({
    auth: w.auth.forAccount,
    social: { purgeProfile: notHere, exportProfile: (userId, pageSize) => exportProfile(s.deps, userId, pageSize) },
    media: { ...mediaForAccount(m.deps), purgeOwner: notHere, requestDeletion: notHere },
    moderation: w.moderation.forAccount,
    limits: new MemoryStore(),
    log: pino({ level: "silent" }),
    now: () => new Date(),
  });

  /** The account's whole export as its archive holds it: the entries' names, export.json as text, and its document, which the format reads whole. */
  async function exportOf(userId: string) {
    const plan = await buildExport(deps(), userId, "the-asking-session", new Date());
    const chunks: Uint8Array[] = [];
    await writeExport(createZipWriter(async (chunk) => void chunks.push(Uint8Array.from(chunk))), plan);
    const files = unzipSync(Buffer.concat(chunks));
    const text = strFromU8(files["export.json"]!);
    const raw = JSON.parse(text) as Record<string, unknown>;
    const json = ExportFormat.parse(raw);
    expect(raw).toStrictEqual(json);
    // The member is the document's last.
    expect(Object.keys(raw).at(-1)).toBe("moderation");
    return { entries: Object.keys(files).sort(), text, json };
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
  /** A report under a rule as a signed-in account sends it: no human check. */
  const report = (targets: NoticeRequest["targets"], extra: Record<string, unknown> = {}) => notices.rule(targets, { turnstileToken: undefined, ...extra });
  /** The daily release, by the database's one function for it: every item answered so far is shown its outcome. */
  const release = () => releaseOutcomes(w.apiDb, new Date());
  /** The statement's texts of a decision as the database holds them, read as the migrator. */
  async function textsOf(decisionId: string) {
    const [row] = await w.migrateDb.execute<{ facts: string | null; reason: string | null; legal: string | null }>(
      sql`select (select t.text from staff_texts t where t.digest = d.facts_digest) as facts, (select t.text from staff_texts t where t.digest = d.reason_digest) as reason,
                 (select t.text from staff_texts t where t.digest = d.legal_reference_digest) as legal
            from decisions d where d.id = ${decisionId}::uuid`,
    );
    return { ...row! };
  }
  /** Every member name anywhere in a value. */
  function namesIn(value: unknown, names = new Set<string>()): Set<string> {
    if (Array.isArray(value)) for (const member of value) namesIn(member, names);
    else if (value !== null && typeof value === "object") for (const [name, member] of Object.entries(value)) namesIn(member, names.add(name));
    return names;
  }

  test("the decisions an account was told of are in its export as its Cases screen lists them, newest first, with what each statement tells and where its appeal stands; a decision it was not told of is not, and nothing names who reported, what they wrote, how many did, or who decided", async () => {
    const author = await w.account();
    const reporter = await w.account();
    const postId = await newPostRow(w.apiDb, author.id, { body: "the reported words" });
    const explanation = `explained-${randomBytes(6).toString("hex")}`;
    const first = await sent(report([postTarget(postId)], { ruleId: "R3", explanation }), reporter.session);
    const notifier = w.address();
    const beside = await sent(notices.illegal([postTarget(postId)], { email: notifier, name: "Nora Notifier" }));
    const interim = await decided(moderator, first.caseId, { kind: "interim", ruleId: "R3", actions: [act("withhold")] });
    const final = await decided(moderator, first.caseId, { kind: "final", ruleId: "R3", actions: [act("remove")] });
    // A second post, reported and found fine: its author is told nothing of that decision, and the export holds nothing of it.
    const fine = await newPostRow(w.apiDb, author.id);
    const other = await sent(report([postTarget(fine)]), reporter.session);
    const silent = await decided(moderator, other.caseId, { kind: "final", outcome: "no_violation" });
    // Once that outcome is released, the reporter asks for a re-examination in words of their own, and this time korbat
    // removes the post: the author is told of the removal, and of nothing that led to it.
    await release();
    const reexamined = `reexamined-${randomBytes(6).toString("hex")}`;
    const listed = (await reporterList(w.deps, reporter.id)).reports.find((row) => row.ref === other.ref)!;
    await reexamineOwnItem(w.deps, reporter.id, listed.items[0]!.id, { statement: reexamined });
    await w.moderation.settle();
    const reopened = (await w.items(other.ref)).at(-1)!.case_id!;
    expect(reopened).not.toBe(other.caseId);
    const again = await decided(moderator, reopened, { kind: "final", ruleId: "R1", actions: [act("remove")] });
    // The account's bio, reset under R6: a decision about the account names no post.
    await w.apiDb.execute(sql`update profiles set bio = 'a bio that breaks a rule' where id = ${author.id}::uuid`);
    const about = await sent(report([accountTarget(author.handle)], { ruleId: "R6" }), reporter.session);
    const reset = await decided(moderator, about.caseId, { kind: "final", ruleId: "R6", actions: [act("reset_bio")] });

    // Before any appeal: the four decisions the author was told of, newest first, none appealed.
    const told = (await exportOf(author.id)).json.moderation;
    expect(told.decisions.map((entry) => entry.id)).toEqual([reset, again, final, interim]);
    expect(told.decisions.map((entry) => entry.appeal)).toEqual([null, null, null, null]);
    expect(told.reports).toEqual([]);

    // The author appeals the removal: pending, then answered by a reviewer who took no part in the case.
    const statement = `appealed-${randomBytes(6).toString("hex")}`;
    await fileAppeal(w.deps, author.id, final, { statement });
    expect((await exportOf(author.id)).json.moderation.decisions.find((entry) => entry.id === final)!.appeal).toEqual({ state: "pending", result: null });
    const reviewed = await d.reviewAs(admin, final, { outcome: "kept" });
    if (typeof reviewed === "string") throw new Error(`the review was not recorded: ${reviewed}`);

    const exported = await exportOf(author.id);
    const [finalTexts, interimTexts, resetTexts, againTexts, reviewTexts] = [await textsOf(final), await textsOf(interim), await textsOf(reset), await textsOf(again), await textsOf(reviewed.decisionId)];
    for (const texts of [finalTexts, interimTexts, resetTexts, againTexts]) expect([typeof texts.facts, typeof texts.reason]).toEqual(["string", "string"]);
    expect(typeof reviewTexts.reason).toBe("string");
    expect(exported.json.moderation.decisions).toEqual([
      // The review: it keeps the decision, restricts nothing, and tells its own reason.
      { id: reviewed.decisionId, decidedOn: today(), postId, kind: "review", outcome: "kept", ground: null, ruleId: null, rulesVersion: RULES_VERSION, measures: [], reversals: [], facts: null, reason: reviewTexts.reason, legalReference: null, appeal: null },
      { id: reset, decidedOn: today(), postId: null, kind: "final", outcome: "restricted", ground: "incompatible", ruleId: "R6", rulesVersion: RULES_VERSION, measures: [{ kind: "reset_bio", mediaId: null, noEffect: null }], reversals: [], facts: resetTexts.facts, reason: resetTexts.reason, legalReference: null, appeal: null },
      // The removal that followed the re-examination reads like any other: nothing says what it followed.
      { id: again, decidedOn: today(), postId: fine, kind: "final", outcome: "restricted", ground: "incompatible", ruleId: "R1", rulesVersion: RULES_VERSION, measures: [{ kind: "remove", mediaId: null, noEffect: null }], reversals: [], facts: againTexts.facts, reason: againTexts.reason, legalReference: null, appeal: null },
      // 3e: the first removal of the author's post under a rule gives a strike; the later one (of a post made before the author was told of it) none.
      { id: final, decidedOn: today(), postId, kind: "final", outcome: "restricted", ground: "incompatible", ruleId: "R3", rulesVersion: RULES_VERSION, measures: [{ kind: "remove", mediaId: null, noEffect: null }, { kind: "strike", mediaId: null, noEffect: null }], reversals: [], facts: finalTexts.facts, reason: finalTexts.reason, legalReference: null, appeal: { state: "answered", result: "kept" } },
      { id: interim, decidedOn: today(), postId, kind: "interim", outcome: "restricted", ground: "incompatible", ruleId: "R3", rulesVersion: RULES_VERSION, measures: [{ kind: "withhold", mediaId: null, noEffect: null }], reversals: [], facts: interimTexts.facts, reason: interimTexts.reason, legalReference: null, appeal: null },
    ]);
    // The post a decision names is an entry of the export's own posts.
    expect(exported.json.posts.map((post) => post.id)).toContain(postId);
    expect(exported.json.moderation.decisions.map((entry) => entry.id)).not.toContain(silent);
    expect(exported.text).not.toContain(silent);

    // Nothing of the reports, their senders or the staff: not in the member, and nowhere else in the document.
    const secrets = {
      reporterHandle: reporter.handle,
      reporterId: reporter.id,
      explanation,
      reexamined,
      firstRef: first.ref,
      otherRef: other.ref,
      besideRef: beside.ref,
      notifier,
      notifierName: "Nora Notifier",
      moderatorId: moderator.id,
      moderatorHandle: moderator.handle,
      adminId: admin.id,
      adminHandle: admin.handle,
    };
    for (const [what, secret] of Object.entries(secrets)) expect(exported.text.includes(secret), what).toBe(false);
    // And no member of a decision's entry could carry one: its source is not even named as a category.
    expect([...namesIn(exported.json.moderation.decisions)].filter((name) => /report|intake|notice|notifier|sender|source|staff|decidedBy|handle|count|items?$/i.test(name))).toEqual([]);
    // The reporter's own export holds the reports, and no decision: none is about them.
    const theirs = (await exportOf(reporter.id)).json.moderation;
    expect(theirs.decisions).toEqual([]);
    expect(theirs.reports.map((entry) => entry.ref)).toEqual([about.ref, other.ref, first.ref]);
  });

  test("a decision that restricts nothing tells neither its facts nor its reason in the export; a reversal is listed with what it lifted, and a notice of illegality's decision with its legal reference", async () => {
    const author = await w.account();
    // Withheld while korbat decides, then found fine: the author is told that what korbat did has ended, and no more.
    const held = await newPostRow(w.apiDb, author.id);
    const one = await sent(notices.rule([postTarget(held)], { ruleId: "R4" }));
    const withhold = await decided(moderator, one.caseId, { kind: "interim", ruleId: "R4", actions: [act("withhold")] });
    const record = `the case's own record ${randomBytes(6).toString("hex")}`;
    const ended = await decided(moderator, one.caseId, { kind: "final", outcome: "no_violation", reasonDigest: await saveText(w.apiDb, one.caseId, moderator.id, "reason", record) });
    expect((await textsOf(ended)).reason).toBe(record);
    // Removed as illegal, then reversed in full by a correction.
    const removed = await newPostRow(w.apiDb, author.id);
    const two = await sent(notices.illegal([postTarget(removed)], { email: w.address() }));
    const removal = await decided(moderator, two.caseId, { kind: "final", ground: "illegal", actions: [act("remove")] });
    const correction = await decided(moderator, two.caseId, { kind: "correction", reviewsDecisionId: removal, actions: [act("restore")] });

    const exported = await exportOf(author.id);
    const [removalTexts, correctionTexts] = [await textsOf(removal), await textsOf(correction)];
    expect(typeof removalTexts.legal).toBe("string");
    expect(exported.json.moderation.decisions).toEqual([
      { id: correction, decidedOn: today(), postId: removed, kind: "correction", outcome: "reversed", ground: null, ruleId: null, rulesVersion: RULES_VERSION, measures: [], reversals: [{ kind: "restore", mediaId: null }], facts: null, reason: correctionTexts.reason, legalReference: null, appeal: null },
      { id: removal, decidedOn: today(), postId: removed, kind: "final", outcome: "restricted", ground: "illegal", ruleId: null, rulesVersion: RULES_VERSION, measures: [{ kind: "remove", mediaId: null, noEffect: null }], reversals: [], facts: removalTexts.facts, reason: removalTexts.reason, legalReference: removalTexts.legal, appeal: null },
      // What the moderator wrote for the case's record is not the author's to read: the statement's data does not hold it.
      { id: ended, decidedOn: today(), postId: held, kind: "final", outcome: "no_violation", ground: null, ruleId: null, rulesVersion: RULES_VERSION, measures: [], reversals: [], facts: null, reason: null, legalReference: null, appeal: null },
      { id: withhold, decidedOn: today(), postId: held, kind: "interim", outcome: "restricted", ground: "incompatible", ruleId: "R4", rulesVersion: RULES_VERSION, measures: [{ kind: "withhold", mediaId: null, noEffect: null }], reversals: [], facts: expect.any(String), reason: expect.any(String), legalReference: null, appeal: null },
    ]);
    expect(exported.text).not.toContain(record);
  });

  test("an account's own reports are in its export as its list shows them: an item decided but not released shows no outcome; released, it reads the list's words under the link the report named; a re-examination is listed; a report on the anonymous path, another person's report and a record that was erased are not", async () => {
    const reporter = await w.account();
    const other = await w.account();
    const subject = await w.account();
    const author = await w.account();
    const postId = await newPostRow(w.apiDb, author.id);
    const quoting = await newPostRow(w.apiDb, author.id, { quoteOfId: postId });
    const explanation = `my own words ${randomBytes(6).toString("hex")}`;
    const first = await sent(report([postTarget(postId), accountTarget(subject.handle)], { ruleId: "R3", explanation }), reporter.session);
    const second = await sent(notices.illegal([postTarget(quoting)], { turnstileToken: undefined, category: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD" }), reporter.session);
    // On the path for child sexual abuse material korbat records no sender, the account included: it is in nobody's export.
    const elsewhere = await newPostRow(w.apiDb, author.id);
    const anonymous = await sent(notices.csam([postTarget(elsewhere)], { turnstileToken: undefined }), reporter.session);
    // Someone else reports the same post, with words of their own.
    const theirWords = `their words ${randomBytes(6).toString("hex")}`;
    const theirs = await sent(report([postTarget(postId)], { ruleId: "R3", explanation: theirWords }), other.session);

    const waiting = { reexamines: false, outcome: null, outcomeText: null, reexaminationOpen: null };
    const undecided = (await exportOf(reporter.id)).json.moderation;
    expect(undecided.decisions).toEqual([]);
    expect(undecided.reports).toEqual([
      { ref: second.ref, receivedAt: expect.stringMatching(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]{12}Z$/), ground: "illegal", ruleId: null, category: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD", explanation: "It is a threat under section 241.", items: [{ position: 1, link: `${origin}/post/${quoting}`, ...waiting }] },
      {
        ref: first.ref,
        receivedAt: expect.stringMatching(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]{12}Z$/),
        ground: "rule",
        ruleId: "R3",
        category: "STATEMENT_CATEGORY_OTHER_VIOLATION_TC",
        explanation,
        items: [
          { position: 1, link: `${origin}/post/${postId}`, ...waiting },
          { position: 2, link: `${origin}/u/${subject.handle}`, ...waiting },
        ],
      },
    ]);

    // Decided, and still silent: an export tells nothing before the daily release, as the list and the mail tell nothing.
    await decided(moderator, first.items[0]!.case_id!, { kind: "final", ruleId: "R3", actions: [act("remove")] });
    await decided(moderator, first.items[1]!.case_id!, { kind: "final", outcome: "no_violation" });
    await decided(moderator, second.caseId, { kind: "final", outcome: "not_evident" });
    expect((await exportOf(reporter.id)).json.moderation.reports).toEqual(undecided.reports);
    // The account changes its handle after the report: the export keeps the handle the report named.
    const renamed = `r_${randomBytes(5).toString("hex")}`;
    await w.apiDb.execute(sql`update profiles set handle = ${renamed} where id = ${subject.id}::uuid`);
    await release();

    const released = await exportOf(reporter.id);
    const rule = getRule("R3")!;
    expect(released.json.moderation.reports.map((entry) => entry.items)).toEqual([
      [{ position: 1, link: `${origin}/post/${quoting}`, reexamines: false, outcome: "not_evident", outcomeText: `${OUTCOME_PHRASES.not_evident}. ${QUOTE_ITEM_SCOPE}`, reexaminationOpen: true }],
      [
        { position: 1, link: `${origin}/post/${postId}`, reexamines: false, outcome: "restricted_rule", outcomeText: `access restricted: it breaks korbat rule R3 (${rule.title}).`, reexaminationOpen: false },
        { position: 2, link: `${origin}/u/${subject.handle}`, reexamines: false, outcome: "no_violation", outcomeText: `${OUTCOME_PHRASES.no_violation}. ${ACCOUNT_ITEM_SCOPE}`, reexaminationOpen: true },
      ],
    ]);
    // Item for item what the account's list of reports shows, in its order and in its words.
    const list = await reporterList(w.deps, reporter.id);
    expect(released.json.moderation.reports.map((entry) => [entry.ref, entry.receivedAt])).toEqual(list.reports.map((row) => [row.ref, row.receivedAt]));
    expect(released.json.moderation.reports.map((entry) => entry.items)).toEqual(
      list.reports.map((row) => row.items.map((item) => ({ position: item.position, link: item.link, reexamines: item.reexamines, outcome: item.outcome, outcomeText: itemOutcomeWords(item), reexaminationOpen: item.reexamination?.open ?? false }))),
    );

    // A re-examination of the account's item: the item's one request is spent, and the new item waits at its place.
    const asked = `asked again ${randomBytes(6).toString("hex")}`;
    await reexamineOwnItem(w.deps, reporter.id, list.reports[1]!.items[1]!.id, { statement: asked });
    await w.moderation.settle();
    expect((await exportOf(reporter.id)).json.moderation.reports[1]!.items).toEqual([
      { position: 1, link: `${origin}/post/${postId}`, reexamines: false, outcome: "restricted_rule", outcomeText: `access restricted: it breaks korbat rule R3 (${rule.title}).`, reexaminationOpen: false },
      { position: 2, link: `${origin}/u/${subject.handle}`, reexamines: false, outcome: "no_violation", outcomeText: `${OUTCOME_PHRASES.no_violation}. ${ACCOUNT_ITEM_SCOPE}`, reexaminationOpen: false },
      { position: 2, link: `${origin}/u/${subject.handle}`, reexamines: true, ...{ outcome: null, outcomeText: null, reexaminationOpen: null } },
    ]);

    // Nothing of anyone else's report, of the anonymous one, of the subject's later handle, or of the staff.
    const mine = await exportOf(reporter.id);
    const secrets = { theirRef: theirs.ref, theirWords, otherId: other.id, otherHandle: other.handle, anonymousRef: anonymous.ref, anonymousToken: anonymous.token!, renamed, moderatorId: moderator.id, moderatorHandle: moderator.handle };
    for (const [what, secret] of Object.entries(secrets)) expect(mine.text.includes(secret), what).toBe(false);
    expect([...namesIn(mine.json.moderation.reports)].filter((name) => /reporter|notifier|contact|sender|staff|decidedBy|token|hash|caseId|^id$/i.test(name))).toEqual([]);
    // The other reporter's export holds their own report and words, and none of this account's.
    const others = await exportOf(other.id);
    expect(others.json.moderation.reports).toMatchObject([{ ref: theirs.ref, ground: "rule", ruleId: "R3", explanation: theirWords, items: [{ position: 1, link: `${origin}/post/${postId}`, outcome: "restricted_rule" }] }]);
    expect(others.text.includes(explanation)).toBe(false);
    // The author of the reported post reads the decision in theirs, and no report.
    const authors = (await exportOf(author.id)).json.moderation;
    expect(authors.reports).toEqual([]);
    expect(authors.decisions).toMatchObject([{ postId, kind: "final", outcome: "restricted", ruleId: "R3" }]);

    // A link that named nothing was answered automatically. Once korbat has erased that report's record, 30 days after
    // its outcome was shown, the record names no sender any more and the report has left the export, as it left the list.
    const nothing = await sent(report([linkTarget(`${origin}/post/${randomUUID()}`)]), reporter.session);
    await release();
    expect((await exportOf(reporter.id)).json.moderation.reports[0]).toMatchObject({ ref: nothing.ref, items: [{ position: 1, outcome: "not_available", outcomeText: `${OUTCOME_PHRASES.not_available}.`, reexaminationOpen: false }] });
    const [stored] = await w.migrateDb.execute<{ id: string }>(sql`select id from intakes where ref = ${nothing.ref}`);
    await w.migrateDb.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '10s'`);
      await ageIntake(tx, stored!.id, "31 days");
    });
    expect(await eraseIntake(w.apiDb, stored!.id)).toBeGreaterThan(0);
    const after = await exportOf(reporter.id);
    expect(after.json.moderation.reports.map((entry) => entry.ref)).toEqual([second.ref, first.ref]);
    expect(after.text.includes(nothing.ref)).toBe(false);

    // The suspect item of the anonymous report is answered, so that nothing of this test keeps a post frozen.
    await decided(admin, anonymous.caseId, { kind: "final", outcome: "no_violation" });
  });

  test("a post whose images are sealed is exported with its text and without those images, in the list and in the files, and the decision that sealed them is in the member; once the seal has ended the images are the account's to export again", async () => {
    const author = await w.account();
    const sealedPost = await newPostRow(w.apiDb, author.id, { body: "text beside the images" });
    const sealedImages = [await newImageRow(w.apiDb, author.id, sealedPost, 0), await newImageRow(w.apiDb, author.id, sealedPost, 1)];
    const plainPost = await newPostRow(w.apiDb, author.id, { body: "another post" });
    const plainImage = await newImageRow(w.apiDb, author.id, plainPost, 0);
    const notice = await sent(notices.csam([postTarget(sealedPost)]));

    // Reported, and frozen: nothing is hidden yet, and the export lists every image. None of these rows has a file in
    // this test's store, so each image the export tried to write is named under missingMedia.
    const frozen = await exportOf(author.id);
    expect(frozen.json.posts.find((post) => post.id === sealedPost)!.media.map((image) => image.id)).toEqual(sealedImages);
    expect([...frozen.json.missingMedia].sort()).toEqual([...sealedImages, plainImage].sort());
    expect(frozen.json.moderation).toEqual({ decisions: [], reports: [], strikes: [] });

    const seal = await decided(moderator, notice.caseId, { kind: "interim", ruleId: "R2", actions: [act("seal_media")] });
    const sealed = await exportOf(author.id);
    // The post keeps its place, its state and its text; it names no sealed image.
    expect(sealed.json.posts.find((post) => post.id === sealedPost)).toMatchObject({ id: sealedPost, body: "text beside the images", state: "visible", media: [] });
    expect(sealed.json.posts.find((post) => post.id === plainPost)!.media).toEqual([{ id: plainImage, file: `media/${plainImage}.webp`, altText: "image 1", width: 1200, height: 800 }]);
    // No file of a sealed image is in the archive, and none was even tried: only the other post's image is missing.
    expect(sealed.entries).toEqual(["export.json"]);
    expect(sealed.json.missingMedia).toEqual([plainImage]);
    for (const image of sealedImages) expect(sealed.text.includes(image), image).toBe(false);
    // The decision that sealed them is the account's to read: a seal of the images the case reaches, under R2, with its texts.
    expect(sealed.json.moderation.decisions).toEqual([
      { id: seal, decidedOn: today(), postId: sealedPost, kind: "interim", outcome: "restricted", ground: "incompatible", ruleId: "R2", rulesVersion: RULES_VERSION, measures: [{ kind: "seal_media", mediaId: null, noEffect: null }], reversals: [], facts: expect.any(String), reason: expect.any(String), legalReference: null, appeal: null },
    ]);
    expect(sealed.text.includes(notice.ref)).toBe(false);

    // An admin answers without a seal: the seal ends, the images are listed again, and the author is told so.
    const answer = await decided(admin, notice.caseId, { kind: "final", outcome: "no_violation" });
    const lifted = await exportOf(author.id);
    expect(lifted.json.posts.find((post) => post.id === sealedPost)!.media.map((image) => image.id)).toEqual(sealedImages);
    expect(lifted.json.moderation.decisions.map((entry) => [entry.id, entry.kind, entry.outcome])).toEqual([
      [answer, "final", "no_violation"],
      [seal, "interim", "restricted"],
    ]);
  });

  test("this file left no row behind: the moderation tables and the four auth tables of moderation cases hold what they held before it", async () => {
    await w.cleanUp();
    await d.close();
    expect(await counts()).toEqual(before);
  });
});
