# korbat moderation cases (3c) — Task 10 of 12: Export, terms and the stack: the export's moderation member, the terms' moderation sections held to their constants, the smoke test's moderation steps, and the whole stack rebuilt and smoke-tested

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-10-03 to 2026-10-12 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Tasks 1 to 9 built moderation cases end to end. This task adds the export's moderation member, the terms' sections and the smoke test's steps, and it is the stack task: its gates rebuild the whole stack and walk the smoke test through Caddy. The design is `docs/superpowers/specs/2026-10-02-moderation-cases-3c-design.md` (sections 7.11, 9, 10, 11 and 12).

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Ports 3000, 8080 and 8090 on localhost must be free. Stop any korbat API, worker, web or console process started from this repository first; never stop other Node processes on the machine, and never touch Docker containers, volumes or images that do not belong to the `korbat` compose project.
- The ignored env files must hold what Tasks 4, 7 and 9 added to the example files before the stack is rebuilt: `node scripts/gen-dev-env.mjs` appends every setting that is new in an example (the notifier key, the dispatch and retention settings, the contact address) and generates the keys an example marks, and it prints no value. The dry run used ports 8380 and 8390 in its scratch clone.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(db,api,admin,contracts,infra): the evidence lifecycle and the command line: migration 0018 says when each kind of a case's evidence is due and erases it through one function that a frozen post's snapshots pass only when the freeze has ended (gate E), redacts what an R4 decision restricted once that decision is final for its author, releases a closed case's holds, forgets who reported once an intake's record is due, and marks a deleted account for the staff schema; the retention job runs those steps one by one under its own lock, each in a try of its own, with an audit row for each erasure and the images nothing retains dropped in batches whose files are requested after each commit; the account's purge forgets the account in the moderation module after the profile's own purge; the overview counts late erasures; staff.js gains link and unlink (a staff member's personal accounts), limits, text-verify, account-facts, access-request and keys; MODERATION_RETENTION switches the job`.

## Rules (read twice)

1. Never type a file's content. Every step that writes files starts with a `write_blocks.py` command that copies that step's blocks from this prompt file to disk byte for byte; run it exactly as given and check that it names every file of the step. The blocks are shown below it so you can read what was written. Paths with parentheses or square brackets (expo-router routes) are literal; quote them in shell commands.
2. Run every command exactly as written, in order, from the repo root, without adding filters such as `tail` or `head`.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the tests

```bash
python docs/superpowers/prompts/moderation-cases-3c/write_blocks.py docs/superpowers/prompts/moderation-cases-3c/10-export-terms-stack.md 1
```

Expected: 6 lines starting with `wrote`, one for each file below.

### Create `apps/api/test/integration/moderation-export.test.ts`

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { ACCOUNT_ITEM_SCOPE, ExportFormat, OUTCOME_PHRASES, QUOTE_ITEM_SCOPE, itemOutcomeWords, type NoticeRequest } from "@korbat/contracts";
import { getRule } from "@korbat/rules";
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
      { id: reviewed.decisionId, decidedOn: today(), postId, kind: "review", outcome: "kept", ground: null, ruleId: null, rulesVersion: 2, measures: [], reversals: [], facts: null, reason: reviewTexts.reason, legalReference: null, appeal: null },
      { id: reset, decidedOn: today(), postId: null, kind: "final", outcome: "restricted", ground: "incompatible", ruleId: "R6", rulesVersion: 2, measures: [{ kind: "reset_bio", mediaId: null, noEffect: null }], reversals: [], facts: resetTexts.facts, reason: resetTexts.reason, legalReference: null, appeal: null },
      // The removal that followed the re-examination reads like any other: nothing says what it followed.
      { id: again, decidedOn: today(), postId: fine, kind: "final", outcome: "restricted", ground: "incompatible", ruleId: "R1", rulesVersion: 2, measures: [{ kind: "remove", mediaId: null, noEffect: null }], reversals: [], facts: againTexts.facts, reason: againTexts.reason, legalReference: null, appeal: null },
      { id: final, decidedOn: today(), postId, kind: "final", outcome: "restricted", ground: "incompatible", ruleId: "R3", rulesVersion: 2, measures: [{ kind: "remove", mediaId: null, noEffect: null }], reversals: [], facts: finalTexts.facts, reason: finalTexts.reason, legalReference: null, appeal: { state: "answered", result: "kept" } },
      { id: interim, decidedOn: today(), postId, kind: "interim", outcome: "restricted", ground: "incompatible", ruleId: "R3", rulesVersion: 2, measures: [{ kind: "withhold", mediaId: null, noEffect: null }], reversals: [], facts: interimTexts.facts, reason: interimTexts.reason, legalReference: null, appeal: null },
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
      { id: correction, decidedOn: today(), postId: removed, kind: "correction", outcome: "reversed", ground: null, ruleId: null, rulesVersion: 2, measures: [], reversals: [{ kind: "restore", mediaId: null }], facts: null, reason: correctionTexts.reason, legalReference: null, appeal: null },
      { id: removal, decidedOn: today(), postId: removed, kind: "final", outcome: "restricted", ground: "illegal", ruleId: null, rulesVersion: 2, measures: [{ kind: "remove", mediaId: null, noEffect: null }], reversals: [], facts: removalTexts.facts, reason: removalTexts.reason, legalReference: removalTexts.legal, appeal: null },
      // What the moderator wrote for the case's record is not the author's to read: the statement's data does not hold it.
      { id: ended, decidedOn: today(), postId: held, kind: "final", outcome: "no_violation", ground: null, ruleId: null, rulesVersion: 2, measures: [], reversals: [], facts: null, reason: null, legalReference: null, appeal: null },
      { id: withhold, decidedOn: today(), postId: held, kind: "interim", outcome: "restricted", ground: "incompatible", ruleId: "R4", rulesVersion: 2, measures: [{ kind: "withhold", mediaId: null, noEffect: null }], reversals: [], facts: expect.any(String), reason: expect.any(String), legalReference: null, appeal: null },
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
    expect(frozen.json.moderation).toEqual({ decisions: [], reports: [] });

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
      { id: seal, decidedOn: today(), postId: sealedPost, kind: "interim", outcome: "restricted", ground: "incompatible", ruleId: "R2", rulesVersion: 2, measures: [{ kind: "seal_media", mediaId: null, noEffect: null }], reversals: [], facts: expect.any(String), reason: expect.any(String), legalReference: null, appeal: null },
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
```

### Create `apps/api/test/moderation-export.test.ts`

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pino from "pino";
import { describe, expect, test } from "vitest";
import { ExportFormat, OUTCOME_PHRASES, UNSEEN_NO_ACTION, itemOutcomeWords, type DecisionStatement, type NoticeItemStatus } from "@korbat/contracts";
import { MemoryStore } from "../src/middleware/rate-limit";
import { createModeration, type CreateModerationOptions } from "../src/moderation";
import { exportedDecision } from "../src/moderation/author";
import { exportedItem } from "../src/moderation/reports";

/**
 * The export's moderation member without a database (3c design, sections 7.11 and 11): which files it is built in, so
 * that a decision's entry can never reach a report; how one decision and one item of a report are written from what the
 * account's own screens read; and that the module hands the member's read to the account module. The reads themselves
 * run on PostgreSQL in test/integration/moderation-export.test.ts.
 */
const SRC = fileURLToPath(new URL("../src", import.meta.url));
const read = (file: string) => readFileSync(`${SRC}/${file}`, "utf8");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("where the member is built", () => {
  test("its decisions come from the author's reads and its reports from the reporter's list's file; the file that joins them holds no query and names no table of reports", () => {
    const joined = read("moderation/export.ts");
    expect(joined).toMatch(/import \{ exportedDecisions \} from "\.\/author";/);
    expect(joined).toMatch(/import \{ exportedReports \} from "\.\/reports";/);
    expect(joined).not.toMatch(/\bsql\b|drizzle-orm|from "\.\/(repo|author-repo|intake|access)"/);
    expect(/\b(intakes|intakeItems|intake_items)\b/.test(joined)).toBe(false);
    // The author's file builds the decisions' entries, and it may name no report (test/moderation-author.test.ts holds it to that).
    expect(read("moderation/author.ts")).toMatch(/export async function exportedDecisions\(/);
    expect(read("moderation/reports.ts")).toMatch(/export async function exportedReports\(/);
  });

  test("a decision's entry is built from the list's row and the statement's data alone: what its author's screens show", () => {
    const author = read("moderation/author.ts");
    const built = author.slice(author.indexOf("export async function exportedDecisions("));
    expect(built).toMatch(/authorDecisions\(/);
    expect(built).toMatch(/decisionStatement\(/);
  });

  test("the module hands the account module its two operations: forgetting a deleted account's reports, and the export's member", () => {
    const untouched = new Proxy({}, { get: () => () => Promise.reject(new Error("nothing is read while the module is built")) });
    const options: CreateModerationOptions = {
      apiDb: untouched as CreateModerationOptions["apiDb"],
      auth: untouched as CreateModerationOptions["auth"],
      social: untouched as CreateModerationOptions["social"],
      media: untouched as CreateModerationOptions["media"],
      rateLimitStore: new MemoryStore(),
      config: { APP_ORIGIN: "http://localhost:8081" } as CreateModerationOptions["config"],
      logger: pino({ level: "silent" }),
    };
    expect(Object.keys(createModeration(options).forAccount).sort()).toEqual(["exportFor", "forgetAccount"]);
    // The server hands that interface to the account module.
    expect(read("index.ts")).toMatch(/createAccount\(\{[^}]*\bmoderation: moderation\.forAccount\b/);
  });
});

describe("one decision as the export writes it", () => {
  const statement: DecisionStatement = {
    kind: "final",
    outcome: "restricted",
    ground: "incompatible",
    ruleId: "R3",
    rulesVersion: 2,
    redressVersion: 1,
    legalReference: null,
    facts: "The post calls for a named group to be excluded.",
    reason: "That is an attack on people for what they are.",
    source: "report",
    decidedAt: "2026-09-12T08:30:00.000Z",
    post: { id: id(2), createdAt: "2026-09-01T10:00:00.000Z" },
    measures: [
      { kind: "remove", mediaId: null, noEffect: null, sealed: null },
      { kind: "seal_media", mediaId: null, noEffect: "already", sealed: { posts: 1, images: 2, deletedImages: 0 } },
    ],
    reversals: [],
    endedMeasures: [{ kind: "withhold", mediaId: null, resetDecisionId: null, oldValueKept: false, resetRuleId: null }],
    reviewed: null,
  };
  const row = { id: id(10), decidedOn: "2026-09-12", post: { id: id(2), createdAt: "2026-09-01T10:00:00.000Z" }, appeal: null };
  const inFormat = (entry: unknown) => ExportFormat.shape.moderation.shape.decisions.element.parse(entry);

  test("it carries the day, the post, the kind, the outcome, the ground, the rule and its version, each measure with whether it changed anything, and the statement's texts; the format reads it whole", () => {
    const entry = exportedDecision(row, statement);
    expect(entry).toEqual({
      id: id(10),
      decidedOn: "2026-09-12",
      postId: id(2),
      kind: "final",
      outcome: "restricted",
      ground: "incompatible",
      ruleId: "R3",
      rulesVersion: 2,
      measures: [
        { kind: "remove", mediaId: null, noEffect: null },
        { kind: "seal_media", mediaId: null, noEffect: "already" },
      ],
      reversals: [],
      facts: statement.facts,
      reason: statement.reason,
      legalReference: null,
      appeal: null,
    });
    expect(inFormat(entry)).toStrictEqual(entry);
    // The statement's source, its time to the second, what a seal covered and what ended with it are the screen's, not the export's.
    expect(Object.keys(entry)).toEqual(["id", "decidedOn", "postId", "kind", "outcome", "ground", "ruleId", "rulesVersion", "measures", "reversals", "facts", "reason", "legalReference", "appeal"]);
  });

  test("a decision about the account names no post; a correction's reversals are listed, and a text the statement does not hold is null", () => {
    const correction: DecisionStatement = { ...statement, kind: "correction", outcome: "reversed", ground: null, ruleId: null, facts: null, reason: null, post: null, measures: [], reversals: [{ kind: "restore_bio", mediaId: null, resetDecisionId: id(11), oldValueKept: true, resetRuleId: "R6" }], endedMeasures: [] };
    const entry = exportedDecision({ ...row, post: null }, correction);
    expect(entry).toMatchObject({ postId: null, kind: "correction", outcome: "reversed", ground: null, ruleId: null, measures: [], reversals: [{ kind: "restore_bio", mediaId: null }], facts: null, reason: null, legalReference: null });
    expect(inFormat(entry)).toStrictEqual(entry);
    // The reset's facts (the decision that reset the field, its rule) are the statement's sentence, not a member of the entry.
    expect(JSON.stringify(entry)).not.toContain(id(11));
  });

  test("the appeal is pending without a result, or answered with the review's result", () => {
    expect(exportedDecision({ ...row, appeal: "pending" }, statement).appeal).toEqual({ state: "pending", result: null });
    for (const result of ["kept", "partly_reversed", "reversed"] as const) {
      const entry = exportedDecision({ ...row, appeal: result }, statement);
      expect(entry.appeal).toEqual({ state: "answered", result });
      expect(inFormat(entry)).toStrictEqual(entry);
    }
  });
});

describe("one item of a report as the export writes it", () => {
  const waiting: NoticeItemStatus = { position: 1, link: `http://localhost:8081/post/${id(3)}`, scope: null, suspect: false, sealed: false, unseen: false, quotedBy: null, outcome: null, decidedOn: null, changed: false, reexamines: false, reexamination: null };
  const inFormat = (entry: unknown) => ExportFormat.shape.moderation.shape.reports.element.shape.items.element.parse(entry);

  test("before the daily release it carries its place and its link and nothing of an outcome, decided or not", () => {
    const entry = exportedItem(waiting);
    expect(entry).toEqual({ position: 1, link: waiting.link, reexamines: false, outcome: null, outcomeText: null, reexaminationOpen: null });
    expect(inFormat(entry)).toStrictEqual(entry);
  });

  test("released, it carries the outcome, the words the list of reports reads for it, and whether a re-examination is open", () => {
    const released: NoticeItemStatus = { ...waiting, outcome: "no_violation", decidedOn: "2026-09-12", reexamination: { open: true, until: "2027-03-12T00:00:00.000Z" } };
    const entry = exportedItem(released);
    expect(entry).toEqual({ position: 1, link: waiting.link, reexamines: false, outcome: "no_violation", outcomeText: `${OUTCOME_PHRASES.no_violation}.`, reexaminationOpen: true });
    expect(entry.outcomeText).toBe(itemOutcomeWords(released));
    expect(inFormat(entry)).toStrictEqual(entry);
    // Asked already, or past its window: no longer open.
    expect(exportedItem({ ...released, reexamination: { open: false, until: "2027-03-12T00:00:00.000Z" } }).reexaminationOpen).toBe(false);
    // An outcome that cannot be examined again at all.
    const restricted: NoticeItemStatus = { ...waiting, outcome: "restricted_rule", decidedOn: "2026-09-12", rule: { id: "R3", title: "No targeted hatred or harassment based on protected traits" } };
    expect(exportedItem(restricted)).toMatchObject({ outcome: "restricted_rule", outcomeText: "access restricted: it breaks korbat rule R3 (No targeted hatred or harassment based on protected traits).", reexaminationOpen: false });
  });

  test("an answer given while nobody could open the post's images reads as the list reads it, never as a finding of no breach; a re-examination is marked", () => {
    const unseen: NoticeItemStatus = { ...waiting, unseen: true, reexamines: true, outcome: "no_violation", decidedOn: "2026-09-12", reexamination: { open: true, until: "2027-03-12T00:00:00.000Z" } };
    const entry = exportedItem(unseen);
    expect(entry).toEqual({ position: 1, link: waiting.link, reexamines: true, outcome: "no_violation", outcomeText: UNSEEN_NO_ACTION, reexaminationOpen: true });
    expect(inFormat(entry)).toStrictEqual(entry);
  });
});
```

### Create `apps/app/test/terms.test.tsx`

```tsx
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, test, vi } from "vitest";
import * as contracts from "@korbat/contracts";
import * as rules from "@korbat/rules";

// The build's contact address, which Expo inlines at export time; set before the app's modules read it.
const CONTACT = vi.hoisted(() => {
  process.env.EXPO_PUBLIC_CONTACT_EMAIL = "contact@korbat.local";
  return "contact@korbat.local";
});

import Terms from "../src/app/terms";
import { CONTACT_WORDS, numberWord } from "../src/lib/moderation-words";
import * as terms from "../src/lib/terms";

/**
 * The terms' moderation sections (3c design, sections 9 and 12): what the terms page gains and changes, and the table
 * tests that hold every number and every rule's text the terms print to its constant. A number is held twice: its
 * sentence is in the terms with the constant's value, and with other values in the constants the terms print those and
 * not one of the old ones, so no number is typed. The rulebook, the measures' labels and the outcomes' phrases are held
 * the same way.
 */
vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
}));

type Contracts = typeof contracts;
type Rules = typeof rules;
type TermsModule = typeof terms;
type Section = { title: string; body: string };

const html = (element: ReactElement): string => renderToStaticMarkup(element);
/** The markup's text as a reader sees it: tags dropped, entities read, spaces collapsed. */
const textOf = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** The sections 3c wrote or rewrote whole; of "Your data" it wrote every paragraph after the first, which older designs wrote. */
const MODERATION_TITLES = ["What you can post", "The rules", "Reports and notices", "How moderators decide", "Appeals", "Terrorist content"];
const bodyOf = (t: TermsModule, title: string): string => t.TERMS_SECTIONS.find((section: Section) => section.title === title)?.body ?? "";
const paragraphsOf = (t: TermsModule, title: string): string[] => t.termsParagraphs(bodyOf(t, title));
/** What 3c added to "Your data". */
const dataParagraphs = (t: TermsModule): string[] => paragraphsOf(t, "Your data").slice(1);
/** The terms' moderation text, section by section: the name of the section each sentence is looked for in, and its text. */
const moderationText = (t: TermsModule): Record<string, string> => ({ ...Object.fromEntries(MODERATION_TITLES.map((title) => [title, bodyOf(t, title)])), "Your data": dataParagraphs(t).join(" ") });

/** A count as the terms print it: a small number as a word, and its noun in the singular or the plural. */
const count = (n: number, one: string): string => `${numberWord(n)} ${n === 1 ? one : `${one}s`}`;

/**
 * The table of numbers: every number of the constants the terms print, with the section and the sentence it stands in.
 * Built from whatever constants it is given, so the same table reads the terms as they are and the terms as they come out
 * with other numbers in the constants.
 */
function numbersTable(c: Contracts): { constant: string; section: string; phrase: string }[] {
  const { NOTICE_LIMITS: L, RETENTION: R, DAILY_LIMITS: D } = c;
  return [
    { constant: "NOTICE_LIMITS.signedOut.perHour", section: "Reports and notices", phrase: `at most ${L.signedOut.perHour} reports an hour and` },
    { constant: "NOTICE_LIMITS.signedOut.perDay", section: "Reports and notices", phrase: `and ${L.signedOut.perDay} a day from one network without an account` },
    { constant: "NOTICE_LIMITS.signedIn.perHour", section: "Reports and notices", phrase: `and ${L.signedIn.perHour} an hour and` },
    { constant: "NOTICE_LIMITS.signedIn.perDay", section: "Reports and notices", phrase: `${L.signedIn.perDay} a day from one account` },
    { constant: "NOTICE_LIMITS.maxTargets", section: "Reports and notices", phrase: `up to ${numberWord(L.maxTargets)} posts or profiles on korbat` },
    { constant: "NOTICE_LIMITS.explanationMax", section: "Reports and notices", phrase: `up to ${L.explanationMax} characters long` },
    { constant: "NOTICE_LIMITS.citedLawMax", section: "Reports and notices", phrase: `the law or country you cite up to ${L.citedLawMax}` },
    { constant: "CSAM_NOTICE_MAX_ACCOUNTS", section: "Reports and notices", phrase: `one report can name ${count(c.CSAM_NOTICE_MAX_ACCOUNTS, "profile")} at most` },
    { constant: "APPEAL_MONTHS", section: "Reports and notices", phrase: `once for a re-examination, within ${count(c.APPEAL_MONTHS, "month")} of being told` },
    { constant: "APPEAL_MONTHS", section: "Appeals", phrase: `within ${count(c.APPEAL_MONTHS, "month")} of being told, free of charge and with no form to follow` },
    { constant: "DAILY_LIMITS.reexaminations", section: "Reports and notices", phrase: `at most ${count(D.reexaminations, "re-examination")} a day` },
    { constant: "DAILY_LIMITS.appeals", section: "Appeals", phrase: `at most ${count(D.appeals, "appeal")} a day` },
    { constant: "SUSPECT_EARLIER_MONTHS", section: "Your data", phrase: `in the last ${count(c.SUSPECT_EARLIER_MONTHS, "month")}` },
    { constant: "RETENTION.r4FinalMonths", section: "Your data", phrase: `${count(R.r4FinalMonths, "month")} after you were told` },
    { constant: "RETENTION.intakeDays", section: "Your data", phrase: `${count(R.intakeDays, "day")} after its last outcome was given and settled` },
    // The same period seen from a decision to take no action: the months of the re-examination's window, and these days.
    { constant: "RETENTION.intakeDays", section: "Your data", phrase: `at most about ${count(c.APPEAL_MONTHS + Math.ceil(R.intakeDays / 30), "month")} after a decision to take no action` },
    { constant: "RETENTION.resetValueDays", section: "Appeals", phrase: `for at least ${count(R.resetValueDays, "day")} after a reset that is lifted or ends` },
    { constant: "RETENTION.evidenceHours", section: "Your data", phrase: `${count(R.evidenceHours, "hour")} after the case closes` },
    { constant: "RETENTION.statementMonths", section: "Your data", phrase: `for ${count(R.statementMonths, "month")} after its deletion` },
    { constant: "RETENTION.accessLogMonths", section: "Your data", phrase: `is kept for ${count(R.accessLogMonths, "month")}` },
    { constant: "RETENTION.contactMonths", section: "Your data", phrase: `deleted ${count(R.contactMonths, "month")} after the last day korbat still owed` },
    { constant: "RETENTION.contactMaxMonths", section: "Your data", phrase: `or ${count(R.contactMaxMonths, "month")} after the report if nothing moved that day` },
    { constant: "RETENTION.confirmationDays", section: "Reports and notices", phrase: `not been confirmed as its sender's in the last ${count(R.confirmationDays, "day")}` },
    { constant: "RETENTION.confirmationDays", section: "Your data", phrase: `is kept for ${count(R.confirmationDays, "day")}` },
    { constant: "RETENTION.backupDays", section: "Your data", phrase: `deleted ${count(R.backupDays, "day")} after it was taken` },
    { constant: "RETENTION.draftHours", section: "Your data", phrase: `is deleted after ${count(R.draftHours, "hour")}` },
    { constant: "RETENTION.mailGiveUpDays", section: "Reports and notices", phrase: `could not send for ${count(R.mailGiveUpDays, "day")}` },
  ];
}

/** The path of every number in a value, as the table names it. */
function numberPaths(name: string, value: unknown): string[] {
  if (typeof value === "number") return [name];
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, member]) => numberPaths(`${name}.${key}`, member));
}
/** Every number of the constants the terms must print, by its path. */
const constantPaths = (c: Contracts): string[] => [
  ...numberPaths("NOTICE_LIMITS", c.NOTICE_LIMITS),
  ...numberPaths("CSAM_NOTICE_MAX_ACCOUNTS", c.CSAM_NOTICE_MAX_ACCOUNTS),
  ...numberPaths("SUSPECT_EARLIER_MONTHS", c.SUSPECT_EARLIER_MONTHS),
  ...numberPaths("APPEAL_MONTHS", c.APPEAL_MONTHS),
  ...numberPaths("DAILY_LIMITS", c.DAILY_LIMITS),
  ...numberPaths("RETENTION", c.RETENTION),
];

/** A rule's name inside a sentence: its title without the leading "No". */
const ruleName = (rule: { title: string }): string => rule.title.replace(/^No /, "");
/** A list in a sentence: "a", "a or b", "a, b or c". */
const orList = (items: readonly string[]): string => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`);
/** An outcome's phrase as the terms quote it: the rule's number and title are named, not filled in. */
const quoted = (phrase: string): string => phrase.replace("{rule}", "[number]").replace("{title}", "[title]");
/** The phrases an answer to a report can read: the seven outcomes, and the three that stand in for them where nobody opened the images. */
const outcomePhrases = (c: Contracts): string[] => [...c.ITEM_OUTCOMES.map((outcome) => c.OUTCOME_PHRASES[outcome]), c.SUSPECT_OUTCOME_PHRASES.sealed, c.SUSPECT_OUTCOME_PHRASES.no_action, c.UNSEEN_NO_ACTION];

/** The sentence of the measures' paragraph that begins with these words, up to its full stop. */
function measuresSentence(t: TermsModule, lead: string): string {
  const paragraph = paragraphsOf(t, "How moderators decide").find((text) => text.includes("korbat's measures are these"));
  if (!paragraph) throw new Error("the terms have no paragraph of measures");
  const from = paragraph.indexOf(lead);
  if (from === -1) throw new Error(`the measures' paragraph has no sentence that begins "${lead}"`);
  return paragraph.slice(from, paragraph.indexOf(".", from) + 1);
}
const LEADS = { interim: "While korbat decides a case:", final: "When the case is decided:", either: "While it decides or when the case is decided:", lifted: "A later decision can lift each of them again:" };
/** The labels a sentence of the measures' paragraph quotes, in order. */
const labelsIn = (sentence: string): string[] => [...sentence.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);

/** What the tables below hold of the terms, read with the constants and the rulebook they were built from. */
function holds(t: TermsModule, c: Contracts, r: Rules): void {
  const text = moderationText(t);
  // Every number, in its sentence.
  for (const row of numbersTable(c)) expect(text[row.section], `${row.constant}: "${row.phrase}" in ${row.section}`).toContain(row.phrase);
  // Every rule, by its name in "What you can post" and with its number, title and text in "The rules".
  expect(text["What you can post"]).toContain(`(${r.RULES.map(ruleName).join(", ")})`);
  expect(paragraphsOf(t, "The rules").slice(1)).toEqual(r.RULES.map((rule) => `${rule.id}. ${rule.title}. ${rule.text}`));
  expect(paragraphsOf(t, "The rules")[0]).toContain(`version ${r.RULES_VERSION} of its rulebook`);
  // The rules only an admin decides, and the one whose content is erased, are named from the rulebook.
  expect(text["How moderators decide"]).toContain(`under ${orList(r.RULES.filter((rule) => rule.seniorQueue).map((rule) => rule.id))} or on a report made on the anonymous path`);
  const r4 = r.RULES.find((rule) => rule.id === "R4")!;
  expect(text["Your data"]).toContain(`under rule R4 (${ruleName(r4)})`);
  expect(text["Appeals"]).toContain(`under rule R4 (${ruleName(r4)})`);
  // Every measure's label, in the sentence its two marks put it in; every reversal's in the last one.
  const kinds = { interim: c.MEASURE_KINDS.filter((kind) => c.MEASURES[kind].interim && !c.MEASURES[kind].final), final: c.MEASURE_KINDS.filter((kind) => !c.MEASURES[kind].interim && c.MEASURES[kind].final), either: c.MEASURE_KINDS.filter((kind) => c.MEASURES[kind].interim && c.MEASURES[kind].final) };
  for (const group of ["interim", "final", "either"] as const) expect(labelsIn(measuresSentence(t, LEADS[group])), group).toEqual(kinds[group].map((kind) => c.MEASURES[kind].label));
  expect(labelsIn(measuresSentence(t, LEADS.lifted))).toEqual(c.REVERSAL_KINDS.map((kind) => c.MEASURES[kind].label));
  // Every outcome's phrase, each in a paragraph of its own that says what it means.
  const answers = paragraphsOf(t, "Reports and notices").filter((paragraph) => paragraph.startsWith('"'));
  expect(answers.map((paragraph) => paragraph.slice(1, paragraph.indexOf('": ')))).toEqual(outcomePhrases(c).map(quoted));
  for (const paragraph of answers) expect(paragraph.slice(paragraph.indexOf('": ') + 3).length, paragraph).toBeGreaterThan(40);
}

describe("the terms' sections", () => {
  test("are these, in this order, under the draft's version: 3c adds five and rewrites two, without a new version", () => {
    expect(terms.TERMS_SECTIONS.map((section) => section.title)).toEqual(["Draft", "Who can use korbat", "What you can post", "The rules", "Reports and notices", "How moderators decide", "Appeals", "Terrorist content", "Explore", "Your account", "Your data"]);
    expect(terms.TERMS_VERSION).toBe("draft-2026-09");
    // Contact is the page's, built from the build's address, and no section of the terms.
    expect(terms.TERMS_SECTIONS.map((section) => section.title)).not.toContain("Contact");
  });

  test("a section's body is its paragraphs, a blank line between two; none is empty or holds a line break of its own", () => {
    const blank = String.fromCharCode(10, 10);
    for (const section of terms.TERMS_SECTIONS) {
      const paragraphs = terms.termsParagraphs(section.body);
      expect(paragraphs.join(blank), section.title).toBe(section.body);
      for (const paragraph of paragraphs) {
        expect(paragraph.trim(), section.title).toBe(paragraph);
        expect(paragraph.length, section.title).toBeGreaterThan(0);
        expect(paragraph.includes(String.fromCharCode(10)), section.title).toBe(false);
      }
    }
    // The sections older designs wrote are one paragraph each, as they were.
    for (const title of ["Draft", "Who can use korbat", "Explore", "Your account"]) expect(paragraphsOf(terms, title), title).toHaveLength(1);
  });

  test("What you can post says when korbat restricts content: a published rule, each named from the rulebook, or the law and a notice; and that a final restriction can be appealed", () => {
    const names = rules.RULES.map(ruleName).join(", ");
    expect(names).toBe("sexual or pornographic content, child sexual abuse material, targeted hatred or harassment based on protected traits, doxxing, direct threats of violence, spam, scams, impersonation or coordinated manipulation");
    expect(bodyOf(terms, "What you can post")).toBe(
      `You can post opinions, including unpopular ones. korbat restricts content only when it breaks a published rule (${names}), or when it is illegal under EU law or the law of an EU country and someone tells korbat so in a notice. Every decision names the rule or the law and says why, and a final decision that restricts your content can be appealed as the section "Appeals" describes.`,
    );
    // The sentence 3c's code made false is gone from every section.
    for (const section of terms.TERMS_SECTIONS) {
      expect(section.body, section.title).not.toContain("Content is removed only when it breaks a published rule");
      expect(section.body, section.title).not.toContain("Every removal names the rule, and you can appeal it");
    }
  });

  test("Terrorist content is the policy the Regulation asks for, in the design's words", () => {
    expect(bodyOf(terms, "Terrorist content")).toBe(
      "korbat removes terrorist content, as Article 2(7) of Regulation (EU) 2021/784 defines it, when it is told about it in a notice, and, once korbat is open to the public, complies with an authority's removal order within one hour. Material for educational, journalistic, artistic or research purposes, or for preventing or countering terrorism, and polemic or controversial views in public debate are not terrorist content (Article 1(3) of that Regulation). korbat uses no automated tool to find it.",
    );
  });

  test("Your data keeps what it said and gains 3c's paragraphs; the human check is named for a report sent signed out too", () => {
    const [first, ...added] = paragraphsOf(terms, "Your data");
    expect(first).toContain("At sign-in, and when you send a report without being signed in, Cloudflare Turnstile checks that you are not a bot; it sees your IP address and browser details for that check, under Cloudflare's privacy policy.");
    expect(first).not.toContain("At sign-in, Cloudflare Turnstile");
    // What 1a to 2c wrote there still stands.
    for (const kept of ["korbat stores your email address for sign-in and security messages", "a device keeps its hash for 30 days after it was last seen", "If you add a passkey, korbat keeps its public key", "you can export your account's data as a ZIP archive and delete your account"]) expect(first, kept).toContain(kept);
    expect(added.length).toBeGreaterThanOrEqual(8);
    const all = added.join(" ");
    for (const said of [
      "When someone reports a post or a profile, korbat keeps a copy of its text and holds its images, whatever it then decides.",
      "Deleting the post or your account leaves these copies until their period ends.",
      "they are left out of your account's export and are not released by korbat on its own",
      "so a later reversal cannot bring it back or show it to you again",
      "what korbat erased since included",
      "except a backup that korbat must keep for the authorities, which it keeps until they have answered",
      "never shown to staff or to the person reported",
      "in broad bands, never exact numbers",
      "the person reported never sees either",
      "as a number and a day",
      "Your account's export holds the decisions its Cases screens list and your own reports.",
      "where the law requires it after weighing the writer's rights, the words of a report without who wrote it",
    ]) expect(all, said).toContain(said);
  });

  test("the three sections of the procedure say what the design has them state", () => {
    const said: Record<string, string[]> = {
      "Reports and notices": [
        "Anyone can report a post, an image or a profile on korbat, signed in or not",
        "A report about a profile is decided on its display name and bio",
        "A report about a post that quotes another is decided on that post's own text and images",
        "korbat does not record who sent the report, not even an account, asks for no name and no email, and sends no email",
        "a report about a profile covers the images on all the profile's posts, a report about a post that quotes another covers both posts",
        "your name and your email are optional",
        "Reports are anonymous towards the person you report",
        "A person looks at every report about something that is on korbat.",
        "A link that names nothing korbat can show is answered automatically, and the answer says so.",
        "never by how many reports an item has, and by who sent them only under the emergency switch",
        "A report is never read after a less severe one, and every report is still read and answered.",
        "gets at most one receipt a day; the others come with the next daily email",
        "korbat sends no report email to an address whose holder asked it to stop",
        "korbat asks another moderator than the one who decided to take it when it has one",
        "says so and can be asked again",
        'this is what "illegality not evident" means',
      ],
      "How moderators decide": [
        "A moderator, never a program, decides every case.",
        "A moderator never decides about their own accounts or about accounts close to them.",
        "every lifting of a seal, and every correction of such a decision",
        "a moderator and an admin decide without seeing the images, on the report and on what korbat can read",
        "Nobody at korbat opens images that are reported or found as such material while the report is unanswered or the images are sealed",
        "After an admin has answered without a seal, staff may open them like any other image.",
        "It hides the images from everyone, their author included, from the first seal, and never hides a post's text.",
        "A report of this kind about a post that quotes another opens a case on the quoted post too.",
        "korbat does not put the old value back",
        "korbat restricts the least it can: one image rather than the post, one field rather than the account.",
        "its statement then says that it changed nothing now",
        "comes with a statement of reasons, in the app at once and by email",
        "A decision to take no action is not sent to you, since it would tell you that someone reported you",
        "is recorded without being sent to you, since it can never take effect",
        "Content restricted for being illegal is restricted everywhere, since korbat cannot restrict by country.",
      ],
      Appeals: [
        "you can appeal it once, while any of it is in force",
        'choose "Appeal" on the decision\'s screen under Settings, Cases',
        "What korbat does while it decides cannot be appealed.",
        "a seal ends with an admin's answer to the reports it was taken on",
        "made none of the case's decisions, including hiding the content while it was decided, did not report it, and has no link to anyone in the case",
        "the appeal waits, without a time limit, and its screen says so",
        "A review keeps the decision, lifts part of it or lifts all of it, and never adds to it.",
        "A decision reversed in full can no longer be appealed, since nothing of it remains.",
        "is final within korbat, and everyone whose report it answered is told",
        "An appeal of a seal waits, without a time limit, for the assessment of the authority korbat reported the images to.",
        "You can also go to court, or complain to the Digital Services Coordinator of the EU country where you live.",
      ],
    };
    for (const [title, sentences] of Object.entries(said)) for (const sentence of sentences) expect(bodyOf(terms, title), `${title}: ${sentence}`).toContain(sentence);
  });
});

describe("the table tests: the terms' numbers, rules, measures and outcomes are their constants'", () => {
  test("the table of numbers names every number of NOTICE_LIMITS, CSAM_NOTICE_MAX_ACCOUNTS, SUSPECT_EARLIER_MONTHS, APPEAL_MONTHS, DAILY_LIMITS and RETENTION", () => {
    expect([...new Set(numbersTable(contracts).map((row) => row.constant))].sort()).toEqual(constantPaths(contracts).sort());
  });

  test("the terms print every one of them in its sentence, every rule with its text, every measure's label in the sentence its marks put it in, and every outcome's phrase with what it means", () => {
    holds(terms, contracts, rules);
    // As they stand today, in the words a reader meets.
    const text = moderationText(terms);
    expect(text["Reports and notices"]).toContain("korbat takes at most 5 reports an hour and 20 a day from one network without an account, and 10 an hour and 50 a day from one account.");
    expect(text["Reports and notices"]).toContain("one report can name one profile at most");
    expect(text["Appeals"]).toContain("within six months of being told");
    expect(text["Your data"]).toContain("Each is deleted 30 days after it was taken");
    expect(text["How moderators decide"]).toContain("under R2 or R5 or on a report made on the anonymous path");
    expect(labelsIn(measuresSentence(terms, LEADS.interim))).toEqual(["Withhold the post", "Withhold one image"]);
    expect(labelsIn(measuresSentence(terms, LEADS.final))).toEqual(["Remove", "Remove one image"]);
    expect(labelsIn(measuresSentence(terms, LEADS.either))).toEqual(["Seal the images this case reaches", "Reset display name", "Reset bio"]);
    expect(text["Reports and notices"]).toContain('"access restricted: it breaks korbat rule [number] ([title])": ');
  });

  test("the terms name no measure and no period the constants lack: no strike, no retired handle, no suspension, no preservation for an order; and no number but the constants', the emergency switch's 48 hours and the Regulation's own", () => {
    const text = moderationText(terms);
    const all = Object.values(text).join(" ");
    for (const absent of [/\bstrikes?\b/i, /retire/i, /suspen/i, /preserv/i, /\bban(s|ned)?\b/i]) expect(absent.test(all), String(absent)).toBe(false);
    // The quoted labels are the ledger's twelve kinds and nothing else.
    const labels = Object.values(LEADS).flatMap((lead) => labelsIn(measuresSentence(terms, lead)));
    expect([...labels].sort()).toEqual(Object.values(contracts.MEASURES).map((spec) => spec.label).sort());
    // Every run of digits outside the rulebook's own texts, a rule's number and the Regulation's articles is a constant's.
    const values = new Set<string>();
    const collect = (value: unknown): void => {
      if (typeof value === "number") values.add(String(value));
      else if (value !== null && typeof value === "object") Object.values(value).forEach(collect);
    };
    collect([contracts.NOTICE_LIMITS, contracts.DAILY_LIMITS, contracts.RETENTION, contracts.CSAM_NOTICE_MAX_ACCOUNTS, contracts.SUSPECT_EARLIER_MONTHS, contracts.APPEAL_MONTHS]);
    const outside = Object.entries(text)
      .filter(([title]) => title !== "The rules")
      .map(([, body]) => body)
      .join(" ")
      .replace(/Article [0-9]+\([0-9]+\)|Regulation \(EU\) [0-9]+\/[0-9]+/g, " ")
      .replace(/\bR[1-6]\b/g, " ");
    const typed = (outside.match(/[0-9]+/g) ?? []).filter((digits) => !values.has(digits));
    // The age of an account under the emergency switch has no constant: the queue's own query holds the same 48 hours.
    expect(typed).toEqual(["48"]);
    expect(text["Reports and notices"]).toContain("from accounts under 48 hours old");
  });

  describe("with other numbers, another rulebook, other labels and other phrases in the constants", () => {
    let changed: { terms: TermsModule; contracts: Contracts; rules: Rules };

    beforeAll(async () => {
      vi.resetModules();
      // Every number of the constants becomes another, each its own and none a number the terms print today.
      let next = 100;
      const renumber = (value: unknown): unknown => {
        if (typeof value === "number") return ++next;
        if (value === null || typeof value !== "object") return value;
        return Object.fromEntries(Object.entries(value).map(([key, member]) => [key, renumber(member)]));
      };
      vi.doMock("@korbat/contracts", async (importOriginal) => {
        const actual = await importOriginal<Contracts>();
        return {
          ...actual,
          NOTICE_LIMITS: renumber(actual.NOTICE_LIMITS),
          DAILY_LIMITS: renumber(actual.DAILY_LIMITS),
          RETENTION: renumber(actual.RETENTION),
          APPEAL_MONTHS: renumber(actual.APPEAL_MONTHS),
          CSAM_NOTICE_MAX_ACCOUNTS: renumber(actual.CSAM_NOTICE_MAX_ACCOUNTS),
          SUSPECT_EARLIER_MONTHS: renumber(actual.SUSPECT_EARLIER_MONTHS),
          // Other labels, and a removal that may also be taken while deciding: it moves to the third sentence.
          MEASURES: Object.fromEntries(Object.entries(actual.MEASURES).map(([kind, spec]) => [kind, { ...spec, label: `the label of ${kind}`, ...(kind === "remove" ? { interim: true } : {}) }])),
          OUTCOME_PHRASES: Object.fromEntries(actual.ITEM_OUTCOMES.map((outcome) => [outcome, outcome === "restricted_rule" ? "the phrase of restricted_rule {rule} ({title})" : `the phrase of ${outcome}`])),
          SUSPECT_OUTCOME_PHRASES: { sealed: "the phrase of a seal.", no_action: "the phrase of no action on that path." },
          UNSEEN_NO_ACTION: "the phrase of an answer given unseen.",
        };
      });
      vi.doMock("@korbat/rules", async (importOriginal) => {
        const actual = await importOriginal<Rules>();
        return {
          ...actual,
          RULES_VERSION: 9,
          // Other titles and texts, and a third rule that only an admin decides.
          RULES: actual.RULES.map((rule) => ({ ...rule, title: `No title of ${rule.id}`, text: `The text of ${rule.id}.`, seniorQueue: rule.seniorQueue || rule.id === "R3" })),
        };
      });
      changed = { terms: await import("../src/lib/terms"), contracts: await import("@korbat/contracts"), rules: await import("@korbat/rules") };
      vi.doUnmock("@korbat/contracts");
      vi.doUnmock("@korbat/rules");
    });

    test("the constants the terms were built from are the changed ones", () => {
      expect(changed.contracts.RETENTION.backupDays).not.toBe(contracts.RETENTION.backupDays);
      expect(changed.contracts.APPEAL_MONTHS).toBeGreaterThan(100);
      expect(changed.rules.RULES_VERSION).toBe(9);
      expect(changed.terms).not.toBe(terms);
    });

    test("the terms print the changed numbers, rulebook, labels and phrases, each in its place", () => {
      holds(changed.terms, changed.contracts, changed.rules);
      const text = moderationText(changed.terms);
      expect(text["How moderators decide"]).toContain("under R2, R3 or R5 or on a report made on the anonymous path");
      expect(labelsIn(measuresSentence(changed.terms, LEADS.final))).toEqual(["the label of remove_media"]);
      expect(labelsIn(measuresSentence(changed.terms, LEADS.either))).toEqual(["the label of remove", "the label of seal_media", "the label of reset_display_name", "the label of reset_bio"]);
      expect(text["What you can post"]).toContain("(title of R1, title of R2, title of R3, title of R4, title of R5, title of R6)");
    });

    test("and not one of today's: no number, rule title, rule text, label or phrase is typed into the terms", () => {
      const text = moderationText(changed.terms);
      const all = Object.values(text).join(" ");
      for (const row of numbersTable(contracts)) expect(text[row.section]!.includes(row.phrase), `${row.constant}: "${row.phrase}"`).toBe(false);
      for (const rule of rules.RULES) {
        expect(all.includes(rule.text), rule.id).toBe(false);
        expect(all.includes(rule.title), rule.id).toBe(false);
        // A rule's name is also a common word in these sections ("child sexual abuse material"), so it is looked for
        // where the terms list the rules by name, and in brackets, as a sentence names the rule on doxxing.
        expect(text["What you can post"]!.includes(ruleName(rule)), rule.id).toBe(false);
        expect(all.includes(`(${ruleName(rule)})`), rule.id).toBe(false);
      }
      for (const spec of Object.values(contracts.MEASURES)) expect(all.includes(`"${spec.label}"`), spec.label).toBe(false);
      for (const phrase of outcomePhrases(contracts)) expect(all.includes(quoted(phrase)), phrase).toBe(false);
      // The only digits left that no changed constant printed are the emergency switch's and the Regulation's.
      const values = new Set<string>();
      const collect = (value: unknown): void => {
        if (typeof value === "number") values.add(String(value));
        else if (value !== null && typeof value === "object") Object.values(value).forEach(collect);
      };
      const c = changed.contracts;
      collect([c.NOTICE_LIMITS, c.DAILY_LIMITS, c.RETENTION, c.CSAM_NOTICE_MAX_ACCOUNTS, c.SUSPECT_EARLIER_MONTHS, c.APPEAL_MONTHS, c.APPEAL_MONTHS + Math.ceil(c.RETENTION.intakeDays / 30), changed.rules.RULES_VERSION]);
      const outside = all.replace(/Article [0-9]+\([0-9]+\)|Regulation \(EU\) [0-9]+\/[0-9]+/g, " ").replace(/\bR[1-6]\b/g, " ");
      expect((outside.match(/[0-9]+/g) ?? []).filter((digits) => !values.has(digits))).toEqual(["48"]);
    });
  });
});

describe("the terms page", () => {
  test("shows every section under its heading and every paragraph of it, then Contact with the build's address and the link to the report form", () => {
    const out = html(<Terms />);
    const text = textOf(out);
    expect(text).toContain(`Version ${terms.TERMS_VERSION}`);
    let at = 0;
    for (const section of terms.TERMS_SECTIONS) {
      // Each heading after the one before it, with its paragraphs behind it in order.
      const heading = out.indexOf(`>${section.title}</`, at);
      expect(heading, section.title).toBeGreaterThan(at);
      at = heading;
      let within = textOf(out.slice(heading));
      for (const paragraph of terms.termsParagraphs(section.body)) {
        const found = within.indexOf(textOf(paragraph));
        expect(found, `${section.title}: ${paragraph.slice(0, 60)}`).toBeGreaterThan(-1);
        within = within.slice(found);
      }
    }
    // One level-2 heading for each section, and one for Contact.
    expect(out.split("<h2").length - 1).toBe(terms.TERMS_SECTIONS.length + 1);
    // Every paragraph is an element of its own: a reader gets them apart, not as one block. Its first words stand
    // directly behind an opening tag's end.
    const decoded = out.replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&gt;", ">");
    for (const paragraph of terms.TERMS_SECTIONS.flatMap((section) => terms.termsParagraphs(section.body))) {
      const start = paragraph.slice(0, 40);
      expect(decoded.includes(`>${start}`), start).toBe(true);
    }
    expect(text).toContain(`Contact ${CONTACT_WORDS.body(CONTACT)}`);
    expect(text.indexOf("Your account's export holds")).toBeLessThan(text.indexOf("Contact Write to korbat"));
    expect(text.indexOf("Contact Write to korbat")).toBeLessThan(text.indexOf(CONTACT_WORDS.report));
    expect(out).toContain('href="/report"');
  });
});
```

### Replace `apps/api/test/account/deletion.test.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import pino from "pino";
import { describe, expect, test } from "vitest";
import type { DbTx } from "@korbat/db";
import type { AccountDeps } from "../../src/account/context";
import { confirmDeletion, purge, startDeletion } from "../../src/account/flows/deletion";
import { PURGE_INTERVAL_MS, createPurgeJob, purgePending } from "../../src/account/purge";
import { AuthError, type Session } from "../../src/auth";
import type { RequestContext } from "../../src/auth/context";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { MemoryJobLock } from "../../src/lib/jobs";
import { MemoryStore } from "../../src/middleware/rate-limit";

const T0 = 1_789_000_000_000;

interface LogLine {
  level: number;
  msg: string;
  userId?: string;
  purged?: number;
  failed?: number;
}

/**
 * The deletion flows and the purge job on stateful fakes of the three module interfaces: the auth
 * fake knows one account whose handle is "ada" and keeps deleted_at and purged_at per account; the
 * social fake keeps which profiles were purged and can be told to fail once for an account, before its
 * transaction does anything or at its commit (which puts back the image rows the transaction took, as a
 * rollback would); the media fake holds image ids per owner and hands them out once. Every call is
 * logged in order, the commit of the social purge's transaction included, and the transaction it opens
 * is a sentinel the media fake must be handed.
 */
function harness() {
  let t = T0;
  const calls: string[] = [];
  const lines: LogLine[] = [];
  const users = new Map<string, { deletedAt: Date | null; purgedAt: Date | null }>();
  const purgedProfiles = new Map<string, Date>();
  const failing = new Set<string>();
  const failingCommit = new Set<string>();
  const images = new Map<string, string[]>();
  const requested: string[][] = [];
  const started: { session: Session; ctx: RequestContext }[] = [];
  const tx = { sentinel: randomUUID() } as unknown as DbTx;
  const seenTx: unknown[] = [];
  const deps: AccountDeps = {
    auth: {
      startDeletion: async (session, ctx) => {
        calls.push("auth.startDeletion");
        started.push({ session, ctx });
        return { flowId: `flow-${session.userId}` };
      },
      confirmDeletion: async (session, input) => {
        calls.push("auth.confirmDeletion");
        if (input.handle.toLowerCase() !== "ada") throw new AuthError("invalid_request", 400, "handle_mismatch");
        const user = users.get(session.userId);
        if (!user || user.deletedAt) throw new AuthError("invalid_credentials", 401);
        user.deletedAt = new Date(t);
      },
      pendingPurges: async () => {
        calls.push("auth.pendingPurges");
        return [...users].filter(([, user]) => user.deletedAt && !user.purgedAt).map(([id]) => id);
      },
      finishPurge: async (userId) => {
        calls.push("auth.finishPurge");
        const user = users.get(userId);
        // As the real statement: a row already purged, or never deleted, is left alone.
        if (user?.deletedAt && !user.purgedAt) user.purgedAt = new Date(t);
      },
      exportAccount: async () => {
        throw new Error("not exercised here");
      },
      appendEvent: async () => undefined,
    },
    social: {
      purgeProfile: async (userId, now, within) => {
        calls.push("social.purgeProfile");
        if (failing.delete(userId)) throw new Error("the social purge failed");
        const rowsBefore = images.get(userId);
        await within(tx);
        if (failingCommit.delete(userId)) {
          calls.push("social.rollback");
          if (rowsBefore) images.set(userId, rowsBefore);
          throw new Error("the social purge's commit failed");
        }
        calls.push("social.commit");
        if (!purgedProfiles.has(userId)) purgedProfiles.set(userId, now);
      },
      exportProfile: async () => {
        throw new Error("not exercised here");
      },
    },
    media: {
      purgeOwner: async (within, ownerId) => {
        calls.push("media.purgeOwner");
        seenTx.push(within);
        const ids = images.get(ownerId) ?? [];
        images.delete(ownerId);
        return ids;
      },
      requestDeletion: async (ids) => {
        calls.push(`media.requestDeletion(${ids.length})`);
        requested.push([...ids]);
      },
      exportImages: async () => [],
    },
    limits: new MemoryStore(() => t),
    log: pino({ level: "info" }, { write: (line: string) => void lines.push(JSON.parse(line) as LogLine) }),
    now: () => new Date(t),
  };
  /** An onboarded account, live unless told otherwise, with a session that just proved a credential. */
  function account(options: { deletedAt?: Date; images?: string[] } = {}): { userId: string; session: Session } {
    const userId = randomUUID();
    users.set(userId, { deletedAt: options.deletedAt ?? null, purgedAt: null });
    if (options.images) images.set(userId, options.images);
    const session: Session = {
      sessionId: sha256Hex(randomToken()),
      userId,
      deviceId: randomUUID(),
      role: "user",
      onboarded: true,
      mfaEnabled: false,
      reauthAt: new Date(t),
      handle: randomUUID(),
      factors: { email: t },
      passkeyId: null,
    };
    return { userId, session };
  }
  const ctx: RequestContext = { ipHash: randomToken(), userAgent: "test" };
  return {
    deps,
    calls,
    lines,
    users,
    purgedProfiles,
    failing,
    failingCommit,
    images,
    requested,
    started,
    tx,
    seenTx,
    ctx,
    account,
    now: () => new Date(t),
    advance(ms: number) {
      t += ms;
    },
  };
}

describe("account deletion: the flows", () => {
  test("the start step hands the session and the request context to the auth module and answers its flow id", async () => {
    const h = harness();
    const ada = h.account();
    expect(await startDeletion(h.deps, ada.session, h.ctx)).toEqual({ flowId: `flow-${ada.userId}` });
    expect(h.started).toEqual([{ session: ada.session, ctx: h.ctx }]);
    expect(h.calls).toEqual(["auth.startDeletion"]);
  });

  test("confirming runs the auth confirmation, then the social purge with the media detach and the file deletion requests inside its transaction, then the auth purge, in that order", async () => {
    const h = harness();
    const [imageA, imageB] = [randomUUID(), randomUUID()];
    const ada = h.account({ images: [imageA, imageB] });
    await confirmDeletion(h.deps, ada.session, { flowId: "f", code: "123456", handle: "Ada" });
    expect(h.calls).toEqual(["auth.confirmDeletion", "social.purgeProfile", "media.purgeOwner", "media.requestDeletion(2)", "social.commit", "auth.finishPurge"]);
    // The image rows go in the social purge's own transaction, and their files are asked for by id before it commits,
    // so no run can commit the rows away and then stop before asking.
    expect(h.seenTx).toEqual([h.tx]);
    expect(h.requested).toEqual([[imageA, imageB]]);
    expect(h.purgedProfiles.get(ada.userId)).toEqual(h.now());
    expect(h.users.get(ada.userId)).toEqual({ deletedAt: h.now(), purgedAt: h.now() });
    expect(await h.deps.auth.pendingPurges()).toEqual([]);
    expect(h.lines.filter((line) => line.level >= 40)).toEqual([]);
  });

  test("a refused confirmation purges nothing", async () => {
    const h = harness();
    const ada = h.account({ images: [randomUUID()] });
    const refused = await confirmDeletion(h.deps, ada.session, { flowId: "f", code: "123456", handle: "not_ada" }).catch((err: unknown) => err);
    expect(refused).toBeInstanceOf(AuthError);
    expect((refused as AuthError).message).toBe("handle_mismatch");
    expect(h.calls).toEqual(["auth.confirmDeletion"]);
    expect(h.users.get(ada.userId)).toEqual({ deletedAt: null, purgedAt: null });
    expect(h.images.get(ada.userId)).toHaveLength(1);
  });

  test("a purge that fails after the confirmation is logged and the confirmation still succeeds; the account stays pending for the job", async () => {
    const h = harness();
    const ada = h.account({ images: [randomUUID()] });
    h.failing.add(ada.userId);
    await confirmDeletion(h.deps, ada.session, { flowId: "f", code: "123456", handle: "ada" });
    expect(h.calls).toEqual(["auth.confirmDeletion", "social.purgeProfile"]);
    expect(h.requested).toEqual([]);
    expect(h.users.get(ada.userId)).toEqual({ deletedAt: h.now(), purgedAt: null });
    expect(await h.deps.auth.pendingPurges()).toEqual([ada.userId]);
    const errors = h.lines.filter((line) => line.level >= 50);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.userId).toBe(ada.userId);
    expect(errors[0]!.msg).toMatch(/purge/);
  });

  test("the purge is safe to repeat: a second run detaches nothing, requests no deletion, and leaves the purged row as it was", async () => {
    const h = harness();
    const ada = h.account({ deletedAt: new Date(T0 - 60_000), images: [randomUUID()] });
    await purge(h.deps, ada.userId);
    const first = { ...h.users.get(ada.userId)!, profilePurgedAt: h.purgedProfiles.get(ada.userId) };
    expect(first).toEqual({ deletedAt: new Date(T0 - 60_000), purgedAt: h.now(), profilePurgedAt: h.now() });
    h.calls.length = 0;
    h.advance(60_000);
    await purge(h.deps, ada.userId);
    expect(h.calls).toEqual(["social.purgeProfile", "media.purgeOwner", "media.requestDeletion(0)", "social.commit", "auth.finishPurge"]);
    expect(h.requested).toEqual([[expect.any(String)], []]);
    expect({ ...h.users.get(ada.userId)!, profilePurgedAt: h.purgedProfiles.get(ada.userId) }).toEqual(first);
  });

  test("a purge whose transaction fails at the commit has already asked for the files; the next run finds the rows again and asks for the same ids", async () => {
    const h = harness();
    const [imageA, imageB] = [randomUUID(), randomUUID()];
    const ada = h.account({ deletedAt: new Date(T0 - 60_000), images: [imageA, imageB] });
    h.failingCommit.add(ada.userId);
    await expect(purge(h.deps, ada.userId)).rejects.toThrow(/commit/);
    expect(h.calls).toEqual(["social.purgeProfile", "media.purgeOwner", "media.requestDeletion(2)", "social.rollback"]);
    expect(h.users.get(ada.userId)!.purgedAt).toBeNull();
    // The requests are one per id, so asking again for the same ids changes nothing on disk.
    await purge(h.deps, ada.userId);
    expect(h.requested).toEqual([
      [imageA, imageB],
      [imageA, imageB],
    ]);
    expect(h.users.get(ada.userId)!.purgedAt).toEqual(h.now());
  });
});

describe("the purge job", () => {
  test("purges every pending account, counts the ones that failed, and finishes on the next round what failed once", async () => {
    const h = harness();
    const ada = h.account({ deletedAt: new Date(T0 - 120_000), images: [randomUUID()] });
    const bob = h.account({ deletedAt: new Date(T0 - 60_000) });
    h.account();
    h.failing.add(ada.userId);

    expect(await purgePending(h.deps)).toEqual({ purged: 1, failed: 1 });
    expect(h.users.get(ada.userId)!.purgedAt).toBeNull();
    expect(h.users.get(bob.userId)!.purgedAt).toEqual(h.now());
    expect(await h.deps.auth.pendingPurges()).toEqual([ada.userId]);
    // The failure is logged with the account, and the round with its counts.
    expect(h.lines.filter((line) => line.level >= 50).map((line) => line.userId)).toEqual([ada.userId]);
    expect(h.lines.filter((line) => line.purged !== undefined).map((line) => [line.purged, line.failed])).toEqual([[1, 1]]);

    h.advance(PURGE_INTERVAL_MS);
    expect(await purgePending(h.deps)).toEqual({ purged: 1, failed: 0 });
    expect(h.users.get(ada.userId)!.purgedAt).toEqual(h.now());
    expect(h.requested).toEqual([[], [expect.any(String)]]);
    expect(await h.deps.auth.pendingPurges()).toEqual([]);
    // A round with nothing to do reports zeros and logs nothing.
    h.lines.length = 0;
    expect(await purgePending(h.deps)).toEqual({ purged: 0, failed: 0 });
    expect(h.lines).toEqual([]);
  });

  test("runs every five minutes under the lock job:account-purge, and skips a round another instance holds", async () => {
    expect(PURGE_INTERVAL_MS).toBe(5 * 60_000);
    const h = harness();
    const ada = h.account({ deletedAt: new Date(T0 - 60_000) });
    const lock = new MemoryJobLock(() => Date.now());
    const job = createPurgeJob(h.deps, lock);
    await lock.acquire("job:account-purge", "other", 10_000);
    expect(await job.round()).toBe("skipped");
    expect(h.calls).toEqual([]);
    await lock.release("job:account-purge", "other");
    expect(await job.round()).toBe("ran");
    expect(h.users.get(ada.userId)!.purgedAt).toEqual(h.now());
    expect(await lock.acquire("job:account-purge", "other", 10_000)).toBe(true);
  });
});

describe("the purge and the reports the account sent (3c design, section 7.10)", () => {
  /** The harness with the moderation module's interface for this one: the forgetting is logged with the other calls, and can be made to fail. */
  function withModeration() {
    const h = harness();
    const forgotten: string[] = [];
    const failing = new Set<string>();
    h.deps.moderation = {
      forgetAccount: async (userId) => {
        h.calls.push("moderation.forgetAccount");
        if (failing.delete(userId)) throw new Error("the forgetting failed");
        forgotten.push(userId);
      },
      // The export's side of the interface is not exercised by the purge; test/account/export.test.ts covers it.
      exportFor: async () => {
        throw new Error("not exercised by the deletion");
      },
    };
    return { ...h, forgotten, failingForget: failing };
  }

  test("the reporter links are forgotten after the social purge has committed and before the account counts as purged", async () => {
    const h = withModeration();
    const ada = h.account({ deletedAt: new Date(T0 - 60_000), images: [randomUUID()] });
    await purge(h.deps, ada.userId);
    expect(h.calls).toEqual(["social.purgeProfile", "media.purgeOwner", "media.requestDeletion(1)", "social.commit", "moderation.forgetAccount", "auth.finishPurge"]);
    expect(h.forgotten).toEqual([ada.userId]);
    expect(h.users.get(ada.userId)!.purgedAt).toEqual(h.now());
  });

  test("a forgetting that fails leaves the account pending, and the next run does every step again and finishes", async () => {
    const h = withModeration();
    const ada = h.account({ deletedAt: new Date(T0 - 60_000) });
    h.failingForget.add(ada.userId);
    await expect(purge(h.deps, ada.userId)).rejects.toThrow(/forgetting/);
    expect(h.calls).toEqual(["social.purgeProfile", "media.purgeOwner", "media.requestDeletion(0)", "social.commit", "moderation.forgetAccount"]);
    expect(h.users.get(ada.userId)!.purgedAt).toBeNull();
    expect(await h.deps.auth.pendingPurges()).toEqual([ada.userId]);
    // The job's next round: the same steps, and this time the account is purged.
    expect(await purgePending(h.deps)).toEqual({ purged: 1, failed: 0 });
    expect(h.forgotten).toEqual([ada.userId]);
    expect(h.users.get(ada.userId)!.purgedAt).toEqual(h.now());
  });

  test("the confirmation purges through the same steps: the owner's request answers once their reports are forgotten too", async () => {
    const h = withModeration();
    const ada = h.account();
    await confirmDeletion(h.deps, ada.session, { flowId: "f", code: "123456", handle: "ada" });
    expect(h.calls).toEqual(["auth.confirmDeletion", "social.purgeProfile", "media.purgeOwner", "media.requestDeletion(0)", "social.commit", "moderation.forgetAccount", "auth.finishPurge"]);
    expect(h.forgotten).toEqual([ada.userId]);
  });
});
```

### Replace `apps/api/test/account/export.test.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { Deflate, strFromU8, unzipSync } from "fflate";
import { Hono, type MiddlewareHandler } from "hono";
import pino from "pino";
import { afterAll, describe, expect, test, vi } from "vitest";
import { ExportFormat } from "@korbat/contracts";
import { MAX_VARIANT_BYTES } from "@korbat/media-protocol";
import { AccountError, type AccountDeps } from "../../src/account/context";
import { EXPORT_WINDOW_MS, buildExport, enforceExportLimit, exportFilename, exportJson, mediaEntry, writeExport } from "../../src/account/flows/export";
import { accountRoutes } from "../../src/account/routes";
import { createZipWriter, type OpenFile } from "../../src/account/zip";
import type { AccountExport, AuthEventType, Session } from "../../src/auth";
import type { AppEnv } from "../../src/env";
import { createMediaFiles } from "../../src/media/files";
import { MemoryStore } from "../../src/middleware/rate-limit";
import type { ModerationExport } from "../../src/moderation";
import type { ExportedPost } from "../../src/social";
import type { HandleRefRow, PostRefRow } from "../../src/social/repo";

const root = mkdtempSync(path.join(tmpdir(), "korbat-account-export-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const T0 = 1_789_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();
const silent = pino({ level: "silent" });
const KIB64 = 64 * 1024;
const TWO_32 = 0x1_0000_0000;

/** A file of the given bytes in a fresh directory, and its absolute path. */
function fileOf(bytes: Uint8Array): string {
  const dir = path.join(root, randomUUID());
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "large.webp");
  writeFileSync(file, bytes);
  return file;
}

/** Opens a file as the media module's checked open answers: the handle with the size it measured, or null for no plain file. */
function openerOf(file: string): OpenFile {
  return async () => {
    let handle: FileHandle;
    try {
      handle = await open(file, "r");
    } catch {
      return null;
    }
    const stats = await handle.stat();
    if (stats.isFile()) return { handle, size: stats.size };
    await handle.close();
    return null;
  };
}

/**
 * Collects the archive in memory. Every write takes a turn of the event loop, and a write that
 * starts while another is still pending is remembered: the writer must await each one.
 */
function memorySink() {
  const chunks: Uint8Array[] = [];
  let busy = false;
  let overlapped = false;
  return {
    async write(chunk: Uint8Array): Promise<void> {
      if (busy) overlapped = true;
      busy = true;
      await new Promise((resolve) => setTimeout(resolve, 0));
      chunks.push(Uint8Array.from(chunk));
      busy = false;
    },
    bytes: (): Buffer => Buffer.concat(chunks),
    get overlapped() {
      return overlapped;
    },
    get count() {
      return chunks.length;
    },
  };
}

/**
 * A stand-in for an opened store file: `size` bytes of `chunk` (zeros unless given), yielded lazily in
 * chunks of its length, failing once `failAfter` chunks were read when asked to. It records how many
 * chunks were read, whether the reading stopped and whether the handle was closed.
 */
function fakeFile(size: number, options: { failAfter?: number; chunk?: Uint8Array } = {}) {
  const chunk = options.chunk ?? new Uint8Array(KIB64);
  const state = { chunks: 0, stopped: false, closed: false };
  const handle = {
    createReadStream({ start = 0, end = size - 1 }: { start?: number; end?: number }): AsyncIterable<Uint8Array> {
      return (async function* () {
        try {
          for (let at = start; at <= end; at += chunk.length) {
            if (options.failAfter !== undefined && state.chunks >= options.failAfter) throw new Error("the disk failed in the middle of the file");
            state.chunks += 1;
            yield at + chunk.length - 1 <= end ? chunk : chunk.subarray(0, end - at + 1);
          }
        } finally {
          state.stopped = true;
        }
      })();
    },
    async close() {
      state.closed = true;
    },
  };
  const opener: OpenFile = async () => ({ handle: handle as unknown as FileHandle, size });
  return { open: opener, state, chunk };
}

async function collect(pieces: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const piece of pieces) out.push(piece);
  return out;
}

async function* piecesOf(...pieces: string[]): AsyncGenerator<string> {
  yield* pieces;
}

/** One central directory entry as a reader finds it. */
interface CentralEntry {
  at: number;
  name: string;
  method: number;
  versionNeeded: number;
  flags: number;
  compressed: number;
  size: number;
  offset: number;
  /** The payload of the ZIP64 extra field (id 0x0001), as 64-bit values, or null without one. */
  zip64: number[] | null;
}

const u64 = (bytes: Buffer, at: number) => bytes.readUInt32LE(at) + bytes.readUInt32LE(at + 4) * TWO_32;

/** Every central directory entry in archive order, found by its signature (none of the test data holds it). */
function centralDirectory(archive: Uint8Array, base = 0): CentralEntry[] {
  const bytes = Buffer.from(archive);
  const entries: CentralEntry[] = [];
  for (let i = 0; i + 46 <= bytes.length; i++) {
    if (bytes.readUInt32LE(i) !== 0x02014b50) continue;
    const nameLength = bytes.readUInt16LE(i + 28);
    const extraLength = bytes.readUInt16LE(i + 30);
    let zip64: number[] | null = null;
    for (let at = i + 46 + nameLength; at + 4 <= i + 46 + nameLength + extraLength; at += 4 + bytes.readUInt16LE(at + 2)) {
      if (bytes.readUInt16LE(at) !== 0x0001) continue;
      const length = bytes.readUInt16LE(at + 2);
      zip64 = Array.from({ length: length / 8 }, (_, k) => u64(bytes, at + 4 + 8 * k));
    }
    entries.push({
      at: base + i,
      name: bytes.toString("utf8", i + 46, i + 46 + nameLength),
      method: bytes.readUInt16LE(i + 10),
      versionNeeded: bytes.readUInt16LE(i + 6),
      flags: bytes.readUInt16LE(i + 8),
      compressed: bytes.readUInt32LE(i + 20),
      size: bytes.readUInt32LE(i + 24),
      offset: bytes.readUInt32LE(i + 42),
      zip64,
    });
  }
  return entries;
}

/** The end records, read from the archive's last bytes as a reader does: the classic one, then the ZIP64 locator and record when present. */
function endRecords(archive: Uint8Array, base = 0) {
  const bytes = Buffer.from(archive);
  const at = bytes.length - 22;
  expect(bytes.readUInt32LE(at)).toBe(0x06054b50);
  const end = { entriesHere: bytes.readUInt16LE(at + 8), entries: bytes.readUInt16LE(at + 10), size: bytes.readUInt32LE(at + 12), offset: bytes.readUInt32LE(at + 16), comment: bytes.readUInt16LE(at + 20) };
  if (at < 20 || bytes.readUInt32LE(at - 20) !== 0x07064b50) return { end, locator: null, end64: null };
  const locator = { disk: bytes.readUInt32LE(at - 16), offset: u64(bytes, at - 12), disks: bytes.readUInt32LE(at - 4) };
  const r = locator.offset - base;
  expect(bytes.readUInt32LE(r)).toBe(0x06064b50);
  const end64 = {
    at: base + r,
    recordSize: u64(bytes, r + 4),
    versionMadeBy: bytes.readUInt16LE(r + 12),
    versionNeeded: bytes.readUInt16LE(r + 14),
    disk: bytes.readUInt32LE(r + 16),
    directoryDisk: bytes.readUInt32LE(r + 20),
    entriesHere: u64(bytes, r + 24),
    entries: u64(bytes, r + 32),
    size: u64(bytes, r + 40),
    offset: u64(bytes, r + 48),
  };
  return { end, locator, end64 };
}

interface RecordedEvent {
  userId: string;
  type: AuthEventType;
  metadata: Record<string, unknown> | undefined;
}

interface Lists {
  posts: ExportedPost[];
  likes: PostRefRow[];
  reposts: PostRefRow[];
  bookmarks: PostRefRow[];
  following: HandleRefRow[];
  blocks: HandleRefRow[];
  mutes: HandleRefRow[];
}

/**
 * The export flow on fakes of the three module interfaces: an account with two live sessions, one
 * device and two events; a profile with a post carrying two images and a deleted reply, one like, one
 * bookmark, a follow, a block and a mute; and whatever images the test puts in `images`. The social
 * fake hands each list out in pages of the size it is asked for, reading a page only when it is
 * iterated, and records every read in `reads`; a test may add rows to `lists`. `failures` makes the
 * next calls of a module read throw.
 */
function harness() {
  let t = T0;
  const images: { id: string; open: OpenFile }[] = [];
  const userId = randomUUID();
  // Sessions are named by their handles, as the auth module's export lists them; the hash of a token is in no part of the archive.
  const currentSession = randomUUID();
  const otherSession = randomUUID();
  const [postId, deletedId, likedId, bookmarkedId, imageA, imageB] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const events: RecordedEvent[] = [];
  const reads: string[] = [];
  const failures = { exportAccount: 0, exportFor: 0 };
  /** The accounts the moderation module was asked about, in order. */
  const asked: string[] = [];
  // What the moderation module hands over for the account: a removal of the post with its texts and an answered appeal,
  // a correction about the account that carries no text, and one report with a released item and a waiting one. Every
  // object's members stand in another order than the format's, and the first decision carries a member the format does
  // not have: the account module writes the format's members in the format's order, and nothing else.
  const [removalId, correctionId, reportedPost] = [randomUUID(), randomUUID(), randomUUID()];
  const removal = {
    appeal: { result: "kept", state: "answered" },
    legalReference: null,
    reason: "That is an attack on people for what they are.",
    facts: "The post calls for a named group to be excluded.",
    reversals: [],
    measures: [
      { noEffect: null, mediaId: null, kind: "remove" },
      { noEffect: "already", mediaId: imageA, kind: "remove_media" },
    ],
    rulesVersion: 2,
    ruleId: "R3",
    ground: "incompatible",
    outcome: "restricted",
    kind: "final",
    postId,
    decidedOn: "2026-09-12",
    id: removalId,
    decidedBy: "a staff member the export must never name",
  } satisfies ModerationExport["decisions"][number] & { decidedBy: string };
  const moderation: ModerationExport = {
    reports: [
      {
        items: [
          { reexaminationOpen: true, outcomeText: "no action: korbat found no breach of its rules and nothing illegal.", outcome: "no_violation", reexamines: false, link: `http://localhost:8081/post/${reportedPost}`, position: 1 },
          { reexaminationOpen: null, outcomeText: null, outcome: null, reexamines: false, link: "http://localhost:8081/u/bob", position: 2 },
        ],
        explanation: "It offers a fake giveaway.",
        category: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD",
        ruleId: null,
        ground: "illegal",
        receivedAt: new Date(T0 - DAY_MS).toISOString(),
        ref: "N-ABCDEFGH23",
      },
    ],
    decisions: [
      removal,
      { appeal: null, legalReference: null, reason: null, facts: null, reversals: [{ mediaId: null, kind: "restore_bio" }], measures: [], rulesVersion: 2, ruleId: null, ground: null, outcome: "reversed", kind: "correction", postId: null, decidedOn: "2026-09-10", id: correctionId },
    ],
  };
  // The deletion side of the three interfaces is not exercised by the export; test/account/deletion.test.ts covers it.
  const notHere = async (): Promise<never> => {
    throw new Error("not exercised by the export");
  };
  const account: AccountExport = {
    account: { id: userId, email: "ada@korbat.local", createdAt: new Date(T0 - 3 * DAY_MS), role: "user", mfaEnabled: true, hasPassword: false, verified: true, termsVersion: "draft-test", termsAcceptedAt: new Date(T0 - 3 * DAY_MS) },
    // Newest first, as the auth module lists them: a plain key never used, added from a device since gone, and a synced one used yesterday.
    passkeys: [
      { name: "Security key", createdAt: new Date(T0 - DAY_MS), lastUsedAt: null, synced: false, createdOn: null },
      { name: "Laptop", createdAt: new Date(T0 - 2 * DAY_MS), lastUsedAt: new Date(T0 - DAY_MS), synced: true, createdOn: "Chrome on Windows" },
    ],
    sessions: [
      { id: otherSession, createdAt: new Date(T0 - 2 * DAY_MS), lastUsedAt: new Date(T0 - DAY_MS) },
      { id: currentSession, createdAt: new Date(T0 - DAY_MS), lastUsedAt: new Date(T0) },
    ],
    devices: [{ label: "Chrome on Windows", platform: "web", firstSeenAt: new Date(T0 - 3 * DAY_MS), lastSeenAt: new Date(T0) }],
    events: [
      { type: "signin_success", at: new Date(T0 - DAY_MS) },
      { type: "signup", at: new Date(T0 - 3 * DAY_MS) },
    ],
  };
  const lists: Lists = {
    posts: [
      {
        id: postId,
        body: "two photos",
        createdAt: new Date(T0 - 2 * DAY_MS),
        replyToId: null,
        quoteOfId: null,
        state: "visible",
        deletedAt: null,
        media: [
          { id: imageA, altText: "a harbour at dawn", width: 1600, height: 1200 },
          { id: imageB, altText: "a lighthouse", width: 900, height: 1600 },
        ],
      },
      { id: deletedId, body: "", createdAt: new Date(T0 - DAY_MS), replyToId: postId, quoteOfId: null, state: "deleted_by_author", deletedAt: new Date(T0 - 1_000), media: [] },
    ],
    likes: [{ postId: likedId, at: new Date(T0 - DAY_MS) }],
    reposts: [],
    bookmarks: [{ postId: bookmarkedId, at: new Date(T0 - 500) }],
    following: [{ handle: "bob", since: new Date(T0 - 2 * DAY_MS) }],
    blocks: [{ handle: "eve", since: new Date(T0 - DAY_MS) }],
    mutes: [{ handle: "carol", since: new Date(T0 - 200) }],
  };
  /** A list in pages of `pageSize`, each read when the one before has been used, as the social module pages its keyset reads. */
  function paged<T>(name: keyof Lists, rows: T[], pageSize: number): AsyncIterable<T[]> {
    return {
      async *[Symbol.asyncIterator]() {
        for (let at = 0; ; at += pageSize) {
          reads.push(name);
          const page = rows.slice(at, at + pageSize);
          if (page.length > 0) yield page;
          if (page.length < pageSize) return;
        }
      },
    };
  }
  const deps: AccountDeps = {
    auth: {
      startDeletion: notHere,
      confirmDeletion: notHere,
      pendingPurges: notHere,
      finishPurge: notHere,
      exportAccount: async () => {
        if (failures.exportAccount > 0) {
          failures.exportAccount -= 1;
          throw new Error("the auth pool timed out");
        }
        return account;
      },
      appendEvent: async (id, type, metadata) => {
        events.push({ userId: id, type, metadata });
      },
    },
    social: {
      purgeProfile: notHere,
      exportProfile: async (_id, pageSize = 1000) => ({
        // The Explore switch is off, not the column's default, so the export is seen to carry what the profile holds.
        profile: { handle: "ada", displayName: "Ada", bio: "Analytical engines.", createdAt: new Date(T0 - 3 * DAY_MS), handleHistory: ["ada_old", "ada"], showInExplore: false },
        posts: paged("posts", lists.posts, pageSize),
        likes: paged("likes", lists.likes, pageSize),
        reposts: paged("reposts", lists.reposts, pageSize),
        bookmarks: paged("bookmarks", lists.bookmarks, pageSize),
        following: paged("following", lists.following, pageSize),
        blocks: paged("blocks", lists.blocks, pageSize),
        mutes: paged("mutes", lists.mutes, pageSize),
      }),
    },
    media: { purgeOwner: notHere, requestDeletion: notHere, exportImages: async () => images },
    moderation: {
      forgetAccount: notHere,
      exportFor: async (id) => {
        asked.push(id);
        if (failures.exportFor > 0) {
          failures.exportFor -= 1;
          throw new Error("the API pool timed out");
        }
        return moderation;
      },
    },
    limits: new MemoryStore(() => t),
    log: silent,
    now: () => new Date(t),
  };
  return {
    deps,
    moderation,
    asked,
    removalId,
    correctionId,
    reportedPost,
    userId,
    currentSession,
    otherSession,
    postId,
    deletedId,
    likedId,
    bookmarkedId,
    imageA,
    imageB,
    images,
    events,
    lists,
    reads,
    failures,
    now: () => new Date(t),
    advance(ms: number) {
      t += ms;
    },
  };
}

type Harness = ReturnType<typeof harness>;

/** export.json as a document in memory, built from the harness's rows the way the export describes them, for JSON.stringify to write. */
function expectedDocument(h: Harness, missingMedia: string[] = []) {
  const ref = (row: PostRefRow) => ({ postId: row.postId, at: row.at.toISOString() });
  const other = (row: HandleRefRow) => ({ handle: row.handle, since: row.since.toISOString() });
  return {
    format: "korbat-export-1",
    exportedAt: iso(T0),
    account: {
      id: h.userId,
      email: "ada@korbat.local",
      createdAt: iso(T0 - 3 * DAY_MS),
      role: "user",
      mfaEnabled: true,
      hasPassword: false,
      verified: true,
      termsVersion: "draft-test",
      termsAcceptedAt: iso(T0 - 3 * DAY_MS),
      passkeys: [
        { name: "Security key", createdAt: iso(T0 - DAY_MS), lastUsedAt: null, synced: false, createdOn: null },
        { name: "Laptop", createdAt: iso(T0 - 2 * DAY_MS), lastUsedAt: iso(T0 - DAY_MS), synced: true, createdOn: "Chrome on Windows" },
      ],
    },
    profile: { handle: "ada", displayName: "Ada", bio: "Analytical engines.", createdAt: iso(T0 - 3 * DAY_MS), handleHistory: ["ada_old", "ada"], showInExplore: false },
    posts: h.lists.posts.map((post) => ({
      id: post.id,
      body: post.body,
      createdAt: post.createdAt.toISOString(),
      replyToId: post.replyToId,
      quoteOfId: post.quoteOfId,
      state: post.state,
      deletedAt: post.deletedAt ? post.deletedAt.toISOString() : null,
      media: post.media.map((image) => ({ id: image.id, file: `media/${image.id}.webp`, altText: image.altText, width: image.width, height: image.height })),
    })),
    likes: h.lists.likes.map(ref),
    reposts: h.lists.reposts.map(ref),
    bookmarks: h.lists.bookmarks.map(ref),
    following: h.lists.following.map(other),
    blocks: h.lists.blocks.map(other),
    mutes: h.lists.mutes.map(other),
    sessions: [
      { id: h.otherSession, createdAt: iso(T0 - 2 * DAY_MS), lastUsedAt: iso(T0 - DAY_MS), current: false },
      { id: h.currentSession, createdAt: iso(T0 - DAY_MS), lastUsedAt: iso(T0), current: true },
    ],
    devices: [{ label: "Chrome on Windows", platform: "web", firstSeenAt: iso(T0 - 3 * DAY_MS), lastSeenAt: iso(T0) }],
    events: [
      { type: "signin_success", at: iso(T0 - DAY_MS) },
      { type: "signup", at: iso(T0 - 3 * DAY_MS) },
    ],
    missingMedia,
    // Last, with every entry's members in the format's order, whatever order the moderation module handed them over in.
    moderation: expectedModeration(h),
  };
}

/** The moderation member as export.json holds it for the harness's account: the format's members, in the format's order. */
function expectedModeration(h: Harness) {
  return {
    decisions: [
      {
        id: h.removalId,
        decidedOn: "2026-09-12",
        postId: h.postId,
        kind: "final",
        outcome: "restricted",
        ground: "incompatible",
        ruleId: "R3",
        rulesVersion: 2,
        measures: [
          { kind: "remove", mediaId: null, noEffect: null },
          { kind: "remove_media", mediaId: h.imageA, noEffect: "already" },
        ],
        reversals: [],
        facts: "The post calls for a named group to be excluded.",
        reason: "That is an attack on people for what they are.",
        legalReference: null,
        appeal: { state: "answered", result: "kept" },
      },
      { id: h.correctionId, decidedOn: "2026-09-10", postId: null, kind: "correction", outcome: "reversed", ground: null, ruleId: null, rulesVersion: 2, measures: [], reversals: [{ kind: "restore_bio", mediaId: null }], facts: null, reason: null, legalReference: null, appeal: null },
    ],
    reports: [
      {
        ref: "N-ABCDEFGH23",
        receivedAt: iso(T0 - DAY_MS),
        ground: "illegal",
        ruleId: null,
        category: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD",
        explanation: "It offers a fake giveaway.",
        items: [
          { position: 1, link: `http://localhost:8081/post/${h.reportedPost}`, reexamines: false, outcome: "no_violation", outcomeText: "no action: korbat found no breach of its rules and nothing illegal.", reexaminationOpen: true },
          { position: 2, link: "http://localhost:8081/u/bob", reexamines: false, outcome: null, outcomeText: null, reexaminationOpen: null },
        ],
      },
    ],
  };
}

/** More rows in every list than a few pages of two hold: text that JSON escapes, a line break inside a body, characters outside ASCII. */
function addManyRows(h: Harness): void {
  const quote = String.fromCharCode(34);
  const newline = String.fromCharCode(10);
  const accented = `caf${String.fromCharCode(0xe9)} ${String.fromCodePoint(0x1f600)}`;
  for (let i = 0; i < 5; i++) {
    h.lists.posts.push({
      id: randomUUID(),
      body: `post ${i}: ${quote}quoted${quote}${newline}second line, ${accented}`,
      createdAt: new Date(T0 - DAY_MS + i),
      replyToId: i % 2 === 0 ? h.postId : null,
      quoteOfId: i === 3 ? h.postId : null,
      state: i === 4 ? "withheld" : "visible",
      deletedAt: null,
      media: i === 1 ? [{ id: randomUUID(), altText: `alt ${accented}`, width: 10, height: 20 }] : [],
    });
  }
  for (let i = 0; i < 6; i++) h.lists.likes.push({ postId: randomUUID(), at: new Date(T0 - 900 + i) });
  for (let i = 0; i < 3; i++) h.lists.reposts.push({ postId: randomUUID(), at: new Date(T0 - 800 + i) });
  for (let i = 0; i < 4; i++) h.lists.bookmarks.push({ postId: randomUUID(), at: new Date(T0 - 700 + i) });
  for (let i = 0; i < 5; i++) h.lists.following.push({ handle: `friend_${i}`, since: new Date(T0 - 600 + i) });
  for (let i = 0; i < 2; i++) h.lists.blocks.push({ handle: `blocked_${i}`, since: new Date(T0 - 500 + i) });
  for (let i = 0; i < 3; i++) h.lists.mutes.push({ handle: `muted_${i}`, since: new Date(T0 - 400 + i) });
}

/** How many reads a list of `rows` takes in pages of `size`: full pages, then the short (maybe empty) one that says it is over. */
const readsFor = (rows: number, size: number) => Math.floor(rows / size) + 1;

describe("building the export", () => {
  test("the JSON follows the contract, marks the current session, lists the passkeys with nothing of their keys, and keeps a deleted post with its empty body and deletion time", async () => {
    const h = harness();
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now());
    const json = ExportFormat.parse(JSON.parse((await collect(exportJson(plan))).join("")));
    expect(json.format).toBe("korbat-export-1");
    expect(json.exportedAt).toBe(iso(T0));
    expect(json.account).toEqual({
      id: h.userId,
      email: "ada@korbat.local",
      createdAt: iso(T0 - 3 * DAY_MS),
      role: "user",
      mfaEnabled: true,
      hasPassword: false,
      verified: true,
      termsVersion: "draft-test",
      termsAcceptedAt: iso(T0 - 3 * DAY_MS),
      // Inside the account, in the auth module's order (newest first), each as the five facts with the times as ISO text.
      passkeys: [
        { name: "Security key", createdAt: iso(T0 - DAY_MS), lastUsedAt: null, synced: false, createdOn: null },
        { name: "Laptop", createdAt: iso(T0 - 2 * DAY_MS), lastUsedAt: iso(T0 - DAY_MS), synced: true, createdOn: "Chrome on Windows" },
      ],
    });
    expect(json.sessions).toEqual([
      { id: h.otherSession, createdAt: iso(T0 - 2 * DAY_MS), lastUsedAt: iso(T0 - DAY_MS), current: false },
      { id: h.currentSession, createdAt: iso(T0 - DAY_MS), lastUsedAt: iso(T0), current: true },
    ]);
    expect(json.devices).toEqual([{ label: "Chrome on Windows", platform: "web", firstSeenAt: iso(T0 - 3 * DAY_MS), lastSeenAt: iso(T0) }]);
    expect(json.events).toEqual([
      { type: "signin_success", at: iso(T0 - DAY_MS) },
      { type: "signup", at: iso(T0 - 3 * DAY_MS) },
    ]);
    // With the author's Explore switch as the profile holds it (off here); the byte-for-byte tests below place it after the handle history.
    expect(json.profile).toEqual({ handle: "ada", displayName: "Ada", bio: "Analytical engines.", createdAt: iso(T0 - 3 * DAY_MS), handleHistory: ["ada_old", "ada"], showInExplore: false });
    expect(json.posts).toHaveLength(2);
    expect(json.posts[0]).toEqual({
      id: h.postId,
      body: "two photos",
      createdAt: iso(T0 - 2 * DAY_MS),
      replyToId: null,
      quoteOfId: null,
      state: "visible",
      deletedAt: null,
      media: [
        { id: h.imageA, file: `media/${h.imageA}.webp`, altText: "a harbour at dawn", width: 1600, height: 1200 },
        { id: h.imageB, file: `media/${h.imageB}.webp`, altText: "a lighthouse", width: 900, height: 1600 },
      ],
    });
    expect(json.posts[1]).toEqual({ id: h.deletedId, body: "", createdAt: iso(T0 - DAY_MS), replyToId: h.postId, quoteOfId: null, state: "deleted_by_author", deletedAt: iso(T0 - 1_000), media: [] });
    expect(json.likes).toEqual([{ postId: h.likedId, at: iso(T0 - DAY_MS) }]);
    expect(json.reposts).toEqual([]);
    expect(json.bookmarks).toEqual([{ postId: h.bookmarkedId, at: iso(T0 - 500) }]);
    expect(json.following).toEqual([{ handle: "bob", since: iso(T0 - 2 * DAY_MS) }]);
    expect(json.blocks).toEqual([{ handle: "eve", since: iso(T0 - DAY_MS) }]);
    expect(json.mutes).toEqual([{ handle: "carol", since: iso(T0 - 200) }]);
    expect(json.missingMedia).toEqual([]);
    expect(plan.images).toEqual([]);
    // Building the plan records nothing: the event belongs after the last chunk of the stream.
    expect(h.events).toEqual([]);
  });

  test("the images to write are the media module's, and the entry name is media/<id>.webp", async () => {
    const h = harness();
    h.images.push({ id: randomUUID(), open: openerOf(path.join(root, "a")) }, { id: randomUUID(), open: openerOf(path.join(root, "b")) });
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now());
    expect(plan.images).toEqual(h.images);
    expect(mediaEntry(h.images[0]!.id)).toBe(`media/${h.images[0]!.id}.webp`);
  });

  test("export.json is read list by list in pages and written piece by piece, byte for byte as JSON.stringify(document, null, 2) writes it", async () => {
    const h = harness();
    addManyRows(h);
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now(), 2);
    // Only the account and the profile's own fields are read up front; the lists wait for the JSON to be written.
    expect(h.reads).toEqual([]);
    const text = (await collect(exportJson(plan))).join("");
    expect(text).toBe(JSON.stringify(expectedDocument(h), null, 2));
    expect(() => ExportFormat.parse(JSON.parse(text))).not.toThrow();
    // Every list was read in pages of two, one page after the other, in the document's order.
    const order: (keyof Lists)[] = ["posts", "likes", "reposts", "bookmarks", "following", "blocks", "mutes"];
    expect(h.reads).toEqual(order.flatMap((name) => Array.from({ length: readsFor(h.lists[name].length, 2) }, () => name)));
    // The same account in one page per list is the same text.
    const whole = await buildExport(h.deps, h.userId, h.currentSession, h.now());
    expect((await collect(exportJson(whole))).join("")).toBe(text);
  });

  test("empty lists and missing images are written as JSON.stringify writes them", async () => {
    const h = harness();
    for (const name of ["posts", "likes", "bookmarks", "following", "blocks", "mutes"] as const) h.lists[name].length = 0;
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now(), 3);
    plan.missingMedia.push(h.imageA, h.imageB);
    expect((await collect(exportJson(plan))).join("")).toBe(JSON.stringify(expectedDocument(h, [h.imageA, h.imageB]), null, 2));
  });

  test("the moderation member is the document's last: read once, before the first byte, for the account that asks, and written with the format's members in the format's order and nothing else", async () => {
    const h = harness();
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now());
    // Read with the account's own facts, before anything is written.
    expect(h.asked).toEqual([h.userId]);
    const text = (await collect(exportJson(plan))).join("");
    const raw = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(raw).at(-1)).toBe("moderation");
    expect(raw.moderation).toStrictEqual(expectedModeration(h));
    // The contract reads it whole: nothing of it lies outside the format.
    expect(ExportFormat.parse(raw).moderation).toStrictEqual(raw.moderation);
    // Member for member in the format's order, though the module handed every object over in another one.
    const NL = String.fromCharCode(10);
    expect(text.endsWith(`,${NL}  "moderation": ${JSON.stringify(expectedModeration(h), null, 2).replaceAll(NL, `${NL}  `)}${NL}}`)).toBe(true);
    // What the module's objects carry beyond the format is not written.
    expect(text).not.toContain("decidedBy");
    expect(text).not.toContain("a staff member the export must never name");
    expect(h.asked).toEqual([h.userId]);
  });

  test("an account module built without the moderation module still writes the member, with two empty lists", async () => {
    const h = harness();
    const deps: AccountDeps = { ...h.deps, moderation: undefined };
    const text = (await collect(exportJson(await buildExport(deps, h.userId, h.currentSession, h.now())))).join("");
    expect(text).toBe(JSON.stringify({ ...expectedDocument(h), moderation: { decisions: [], reports: [] } }, null, 2));
    expect(() => ExportFormat.parse(JSON.parse(text))).not.toThrow();
    expect(h.asked).toEqual([]);
  });

  test("a large account's export.json comes in several pieces of at most 64 KiB of UTF-8", async () => {
    const h = harness();
    const accented = String.fromCharCode(0xe9).repeat(200);
    for (let i = 0; i < 3_000; i++) h.lists.likes.push({ postId: randomUUID(), at: new Date(T0 - 100_000 + i) });
    for (let i = 0; i < 1_000; i++) h.lists.posts.push({ id: randomUUID(), body: accented, createdAt: new Date(T0 - 50_000 + i), replyToId: null, quoteOfId: null, state: "visible", deletedAt: null, media: [] });
    const pieces = await collect(exportJson(await buildExport(h.deps, h.userId, h.currentSession, h.now())));
    expect(pieces.length).toBeGreaterThan(5);
    for (const piece of pieces) expect(Buffer.byteLength(piece, "utf8")).toBeLessThanOrEqual(KIB64);
    expect(pieces.join("")).toBe(JSON.stringify(expectedDocument(h), null, 2));
  });

  test("the file name carries the handle and the day of the export", () => {
    expect(exportFilename("ada_l", new Date("2026-09-24T23:59:59.000Z"))).toBe("korbat-export-ada_l-2026-09-24.zip");
  });

  test("one export a day: the second is rate_limited with a Retry-After, the next day is allowed again, and a store that fails closes the door", async () => {
    const h = harness();
    await enforceExportLimit(h.deps, h.userId);
    const refused = await enforceExportLimit(h.deps, h.userId).catch((err: unknown) => err);
    expect(refused).toBeInstanceOf(AccountError);
    expect((refused as AccountError).code).toBe("rate_limited");
    expect((refused as AccountError).status).toBe(429);
    expect((refused as AccountError).retryAfterSeconds).toBeGreaterThan(0);
    expect((refused as AccountError).retryAfterSeconds).toBeLessThanOrEqual(EXPORT_WINDOW_MS / 1000);
    // Another account is not affected.
    await enforceExportLimit(h.deps, randomUUID());
    h.advance(EXPORT_WINDOW_MS + 1);
    await enforceExportLimit(h.deps, h.userId);

    const failing: AccountDeps = {
      ...h.deps,
      limits: {
        hit: async () => {
          throw new Error("store down");
        },
        release: async () => undefined,
      },
    };
    const down = await enforceExportLimit(failing, h.userId).catch((err: unknown) => err);
    expect(down).toBeInstanceOf(AccountError);
    expect((down as AccountError).code).toBe("service_unavailable");
    expect((down as AccountError).status).toBe(503);
    expect((down as AccountError).retryAfterSeconds).toBe(30);
  });
});

describe("writing the archive", () => {
  test("the archive holds export.json and every image byte for byte, in chunks that are each awaited", async () => {
    const bytesA = randomBytes(200_000);
    const bytesB = Buffer.from("small-webp");
    const h = harness();
    h.images.push({ id: h.imageA, open: openerOf(fileOf(bytesA)) }, { id: h.imageB, open: openerOf(fileOf(bytesB)) });
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now());
    const sink = memorySink();
    await writeExport(createZipWriter(sink.write), plan);
    expect(sink.overlapped).toBe(false);
    // Two hundred kilobytes do not fit in one read: the image went through several awaited writes.
    expect(sink.count).toBeGreaterThan(3);

    const files = unzipSync(sink.bytes());
    expect(Object.keys(files).sort()).toEqual(["export.json", `media/${h.imageA}.webp`, `media/${h.imageB}.webp`].sort());
    expect(Buffer.compare(Buffer.from(files[`media/${h.imageA}.webp`]!), bytesA)).toBe(0);
    expect(Buffer.compare(Buffer.from(files[`media/${h.imageB}.webp`]!), bytesB)).toBe(0);
    expect(strFromU8(files["export.json"]!)).toBe(JSON.stringify(expectedDocument(h), null, 2));
    expect(centralDirectory(sink.bytes()).map((entry) => [entry.name, entry.method])).toEqual([
      [`media/${h.imageA}.webp`, 0],
      [`media/${h.imageB}.webp`, 0],
      ["export.json", 8],
    ]);
  });

  test("an image whose file is gone is listed under missingMedia, and the archive still closes with the others", async () => {
    const bytesA = Buffer.from("still-there");
    const h = harness();
    h.images.push({ id: h.imageA, open: openerOf(fileOf(bytesA)) }, { id: h.imageB, open: openerOf(path.join(root, randomUUID(), "large.webp")) });
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now());
    const sink = memorySink();
    await writeExport(createZipWriter(sink.write), plan);
    const files = unzipSync(sink.bytes());
    expect(Object.keys(files).sort()).toEqual(["export.json", `media/${h.imageA}.webp`].sort());
    expect(Buffer.compare(Buffer.from(files[`media/${h.imageA}.webp`]!), bytesA)).toBe(0);
    const json = ExportFormat.parse(JSON.parse(strFromU8(files["export.json"]!)));
    expect(json.missingMedia).toEqual([h.imageB]);
    // The post still names the entry the image would have had; missingMedia says why it is not there.
    expect(json.posts[0]!.media[1]!.file).toBe(`media/${h.imageB}.webp`);
    expect(plan.missingMedia).toEqual([h.imageB]);
  });

  /** A store with one image whose large variant holds `bytes`, read through the media module's checked open. */
  async function storeWith(id: string, bytes: Uint8Array) {
    const base = path.join(root, randomUUID());
    const files = createMediaFiles({ uploadsDir: path.join(base, "uploads"), storeDir: path.join(base, "store"), log: silent });
    await files.prepare();
    mkdirSync(files.store.imageDir(id), { recursive: true });
    writeFileSync(files.store.image(id, "large"), bytes);
    return files;
  }

  test("an image larger than a variant may be is refused by the checked open and listed under missingMedia like a missing one", async () => {
    const h = harness();
    const files = await storeWith(h.imageA, Buffer.from("planted"));
    // A sparse file of any size could be planted in the store; the checked open refuses anything over the variant limit.
    truncateSync(files.store.image(h.imageA, "large"), MAX_VARIANT_BYTES + 1);
    const kept = await storeWith(h.imageB, Buffer.from("fine"));
    h.images.push({ id: h.imageA, open: () => files.openImage(h.imageA, "large") }, { id: h.imageB, open: () => kept.openImage(h.imageB, "large") });
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now());
    const sink = memorySink();
    await writeExport(createZipWriter(sink.write), plan);
    const archive = sink.bytes();
    expect(archive.length).toBeLessThan(MAX_VARIANT_BYTES);
    const unpacked = unzipSync(archive);
    expect(Object.keys(unpacked).sort()).toEqual(["export.json", `media/${h.imageB}.webp`].sort());
    expect(ExportFormat.parse(JSON.parse(strFromU8(unpacked["export.json"]!))).missingMedia).toEqual([h.imageA]);
  });

  test("a file that grows after the checked open is read only to the size the open measured", async () => {
    const h = harness();
    const original = randomBytes(150_000);
    const files = await storeWith(h.imageA, original);
    h.images.push({
      id: h.imageA,
      open: async () => {
        const stored = await files.openImage(h.imageA, "large");
        // Whatever lands in the file after the check is not the checked file's.
        appendFileSync(files.store.image(h.imageA, "large"), randomBytes(100_000));
        return stored;
      },
    });
    const sink = memorySink();
    await writeExport(createZipWriter(sink.write), await buildExport(h.deps, h.userId, h.currentSession, h.now()));
    const unpacked = unzipSync(sink.bytes());
    expect(Buffer.compare(Buffer.from(unpacked[`media/${h.imageA}.webp`]!), original)).toBe(0);
  });
});

describe("the zip writer", () => {
  test("entries come out in the order they were added: JSON pieces deflated as one text, files stored as they are", async () => {
    const stored = randomBytes(70_000);
    const first = JSON.stringify({ kind: "first", filler: "x".repeat(2_000) }, null, 2);
    const sink = memorySink();
    const writer = createZipWriter(sink.write);
    await writer.addJsonPieces("first.json", piecesOf(first.slice(0, 700), first.slice(700)));
    expect(await writer.addFile("files/stored.bin", openerOf(fileOf(stored)))).toBe(true);
    await writer.addJsonPieces("last.json", piecesOf('{ "kind": "last" }'));
    await writer.end();

    const files = unzipSync(sink.bytes());
    expect(Object.keys(files)).toEqual(["first.json", "files/stored.bin", "last.json"]);
    expect(strFromU8(files["first.json"]!)).toBe(first);
    expect(Buffer.compare(Buffer.from(files["files/stored.bin"]!), stored)).toBe(0);
    expect(strFromU8(files["last.json"]!)).toBe('{ "kind": "last" }');
    const directory = centralDirectory(sink.bytes());
    expect(directory.map((entry) => [entry.name, entry.method])).toEqual([
      ["first.json", 8],
      ["files/stored.bin", 0],
      ["last.json", 8],
    ]);
    // A plain archive has no ZIP64 field or record, and every entry streams its sizes after its data.
    expect(directory.map((entry) => entry.zip64)).toEqual([null, null, null]);
    expect(directory.every((entry) => entry.versionNeeded === 45 && (entry.flags & 0x0008) !== 0)).toBe(true);
    expect(endRecords(sink.bytes()).end64).toBeNull();
    expect(sink.overlapped).toBe(false);
  });

  test("a file the open refuses adds nothing and answers false; a zero-byte file is an entry without data", async () => {
    const dir = path.join(root, randomUUID());
    mkdirSync(dir, { recursive: true });
    const sink = memorySink();
    const writer = createZipWriter(sink.write);
    expect(await writer.addFile("missing.bin", openerOf(path.join(root, randomUUID(), "missing.webp")))).toBe(false);
    expect(await writer.addFile("dir.bin", openerOf(dir))).toBe(false);
    const empty = fakeFile(0);
    expect(await writer.addFile("empty.bin", empty.open)).toBe(true);
    expect(empty.state).toEqual({ chunks: 0, stopped: false, closed: true });
    await writer.addJsonPieces("only.json", piecesOf('{ "ok": true }'));
    await writer.end();
    const files = unzipSync(sink.bytes());
    expect(Object.keys(files)).toEqual(["empty.bin", "only.json"]);
    expect(files["empty.bin"]!.length).toBe(0);
    expect(centralDirectory(sink.bytes()).map((entry) => entry.name)).toEqual(["empty.bin", "only.json"]);
  });

  test("an empty archive is still a valid archive", async () => {
    const sink = memorySink();
    const writer = createZipWriter(sink.write);
    await writer.end();
    expect(unzipSync(sink.bytes())).toEqual({});
  });

  test("the JSON is fed to the deflate at most 64 KiB at a time, and the event loop turns between two feeds", async () => {
    const push = vi.spyOn(Deflate.prototype, "push");
    const chunks: Uint8Array[] = [];
    const writer = createZipWriter(async (chunk) => {
      chunks.push(Uint8Array.from(chunk));
    });
    let turns = 0;
    let running = true;
    const tick = () => {
      if (!running) return;
      turns += 1;
      setImmediate(tick);
    };
    setImmediate(tick);
    // One piece of 300 KiB and ten small ones.
    const big = "y".repeat(300 * 1024);
    let fed: number[];
    try {
      await writer.addJsonPieces("big.json", piecesOf(big, ...Array.from({ length: 10 }, (_, i) => `,${i}`)));
      await writer.end();
      // Read before the spy is restored, which forgets its calls.
      fed = push.mock.calls.map(([chunk]) => chunk.length);
    } finally {
      running = false;
      push.mockRestore();
    }
    expect(Math.max(...fed)).toBeLessThanOrEqual(KIB64);
    expect(fed.filter((length) => length > 0)).toHaveLength(5 + 10);
    expect(turns).toBeGreaterThanOrEqual(10);
    expect(strFromU8(unzipSync(Buffer.concat(chunks))["big.json"]!)).toBe(big + Array.from({ length: 10 }, (_, i) => `,${i}`).join(""));
  });

  test("forced ZIP64 on a small archive: it opens and gives back its bytes, and its records say what a ZIP64 reader needs", async () => {
    const stored = randomBytes(5_000);
    const sink = memorySink();
    const writer = createZipWriter(sink.write, { zip64: "always" });
    expect(await writer.addFile("a.bin", openerOf(fileOf(stored)))).toBe(true);
    await writer.addJsonPieces("b.json", piecesOf('{ "b": 1 }'));
    await writer.end();
    const archive = sink.bytes();

    const files = unzipSync(archive);
    expect(Object.keys(files)).toEqual(["a.bin", "b.json"]);
    expect(Buffer.compare(Buffer.from(files["a.bin"]!), stored)).toBe(0);
    expect(strFromU8(files["b.json"]!)).toBe('{ "b": 1 }');

    // Every 32-bit field reads 0xFFFFFFFF and the extra field holds the uncompressed size, the compressed size and the offset, in that order.
    const [a, b] = centralDirectory(archive);
    expect(a).toMatchObject({ name: "a.bin", compressed: 0xffffffff, size: 0xffffffff, offset: 0xffffffff, zip64: [5_000, 5_000, 0] });
    expect(b!.zip64![2]).toBe(30 + "a.bin".length + 5_000 + 24);
    expect(b!.zip64![0]).toBe(10);
    // The data descriptor after a.bin's bytes carries 8-byte sizes.
    const descriptor = 30 + "a.bin".length + 5_000;
    expect(archive.readUInt32LE(descriptor)).toBe(0x08074b50);
    expect([u64(archive, descriptor + 8), u64(archive, descriptor + 16)]).toEqual([5_000, 5_000]);

    const { end, locator, end64 } = endRecords(archive);
    const directoryOffset = a!.at;
    expect(end64).toEqual({
      at: archive.length - 22 - 20 - 56,
      recordSize: 44,
      versionMadeBy: 45,
      versionNeeded: 45,
      disk: 0,
      directoryDisk: 0,
      entriesHere: 2,
      entries: 2,
      size: end64!.at - directoryOffset,
      offset: directoryOffset,
    });
    expect(locator).toEqual({ disk: 0, offset: end64!.at, disks: 1 });
    expect(end).toEqual({ entriesHere: 0xffff, entries: 0xffff, size: 0xffffffff, offset: 0xffffffff, comment: 0 });
  });

  test("the writer turns to ZIP64 by itself once an offset passes 4 GiB", async () => {
    const start = TWO_32 - 100;
    const sink = memorySink();
    const writer = createZipWriter(sink.write, { startOffset: start });
    await writer.addFile("a.bin", openerOf(fileOf(Buffer.alloc(50, 1))));
    await writer.addFile("b.bin", openerOf(fileOf(Buffer.alloc(40, 2))));
    await writer.end();
    const archive = sink.bytes();

    const bOffset = start + 30 + 5 + 50 + 16;
    expect(bOffset).toBeGreaterThan(0xffffffff);
    const [a, b] = centralDirectory(archive, start);
    // a.bin starts below 4 GiB and needs nothing; b.bin's offset goes into the extra field alone.
    expect(a).toMatchObject({ name: "a.bin", compressed: 50, size: 50, offset: start, zip64: null });
    expect(b).toMatchObject({ name: "b.bin", compressed: 40, size: 40, offset: 0xffffffff, zip64: [bOffset] });
    // Neither entry reached 4 GiB, so both descriptors keep 4-byte sizes.
    expect(archive.readUInt32LE(30 + 5 + 50)).toBe(0x08074b50);
    expect(archive.readUInt32LE(30 + 5 + 50 + 16)).toBe(0x04034b50);

    const { end, locator, end64 } = endRecords(archive, start);
    expect(end64).toMatchObject({ entriesHere: 2, entries: 2, size: end64!.at - a!.at, offset: a!.at });
    expect(a!.at).toBeGreaterThan(0xffffffff);
    expect(locator).toEqual({ disk: 0, offset: end64!.at, disks: 1 });
    // Only the directory's offset overflows the classic record.
    expect(end).toEqual({ entriesHere: 2, entries: 2, size: end64!.at - a!.at, offset: 0xffffffff, comment: 0 });
  });

  test("an entry of more than 4 GiB is a ZIP64 entry by itself, without the archive being kept in memory", { timeout: 120_000 }, async () => {
    const huge = fakeFile(TWO_32 + 1);
    // Counts every byte and keeps only what is not the file's own data, with where it starts.
    const kept: { at: number; bytes: Uint8Array }[] = [];
    let written = 0;
    const writer = createZipWriter(async (chunk) => {
      if (chunk.buffer !== huge.chunk.buffer) kept.push({ at: written, bytes: Uint8Array.from(chunk) });
      written += chunk.length;
    });
    expect(await writer.addFile("huge.bin", huge.open)).toBe(true);
    await writer.addJsonPieces("after.json", piecesOf('{ "after": true }'));
    await writer.end();
    expect(huge.state).toEqual({ chunks: TWO_32 / KIB64 + 1, stopped: true, closed: true });

    // Everything after the file's data is kept together: its descriptor, the next entry, the directory and the end records.
    const dataEnd = 30 + "huge.bin".length + TWO_32 + 1;
    const tail = Buffer.concat(kept.filter((piece) => piece.at >= dataEnd).map((piece) => piece.bytes));
    expect(dataEnd + tail.length).toBe(written);
    expect(tail.readUInt32LE(0)).toBe(0x08074b50);
    expect([u64(tail, 8), u64(tail, 16)]).toEqual([TWO_32 + 1, TWO_32 + 1]);
    const [hugeEntry, after] = centralDirectory(tail, dataEnd);
    expect(hugeEntry).toMatchObject({ name: "huge.bin", compressed: 0xffffffff, size: 0xffffffff, offset: 0, zip64: [TWO_32 + 1, TWO_32 + 1] });
    expect(after).toMatchObject({ name: "after.json", offset: 0xffffffff, zip64: [dataEnd + 24] });
    const { end, end64 } = endRecords(tail, dataEnd);
    expect(end64).toMatchObject({ entries: 2, offset: hugeEntry!.at });
    expect(end).toMatchObject({ entries: 2, offset: 0xffffffff });
  });
});

describe("the export route", () => {
  /**
   * The account routes on their own, with the session and the logger a request would carry and an error
   * handler that renders AccountError as the app's does; everything else is a 500. The freshness and
   * session guards are passed through: http-account.test.ts covers them on the real app.
   */
  function app(h: Harness, log = silent) {
    const session: Session = {
      sessionId: randomBytes(32).toString("hex"),
      userId: h.userId,
      deviceId: randomUUID(),
      role: "user",
      onboarded: true,
      mfaEnabled: false,
      reauthAt: h.now(),
      // The route marks the current session by this, the id the list carries, and not by the token's hash above.
      handle: h.currentSession,
      factors: { email: h.now().getTime() },
      passkeyId: null,
    };
    const pass: MiddlewareHandler<AppEnv> = async (_c, next) => {
      await next();
    };
    const a = new Hono<AppEnv>();
    a.use(async (c, next) => {
      c.set("requestId", "test");
      c.set("log", log);
      c.set("session", session);
      c.set("authVia", "cookie");
      await next();
    });
    a.route("/api/account", accountRoutes(h.deps, pass, pass, pass));
    a.onError((err, c) => (err instanceof AccountError ? c.json({ error: { code: err.code } }, err.status) : c.json({ error: { code: "internal" } }, 500)));
    return a;
  }
  const exportOf = (a: Hono<AppEnv>) => a.request("/api/account/export", { method: "POST" });
  const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;
  const exported = (h: Harness) => h.events.filter((event) => event.type === "export_created").length;

  test("a complete export streams a valid archive with its headers and records export_created", async () => {
    const h = harness();
    const bytesA = randomBytes(300_000);
    h.images.push({ id: h.imageA, open: openerOf(fileOf(bytesA)) });
    const res = await exportOf(app(h));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="korbat-export-ada-${iso(T0).slice(0, 10)}.zip"`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Buffer.compare(Buffer.from(files[`media/${h.imageA}.webp`]!), bytesA)).toBe(0);
    expect(strFromU8(files["export.json"]!)).toBe(JSON.stringify(expectedDocument(h), null, 2));
    // Recorded once every chunk was taken, before the body ended.
    expect(h.events).toEqual([{ userId: h.userId, type: "export_created", metadata: undefined }]);
  });

  test("a failure before the first byte answers an error and gives the day's export back", async () => {
    const h = harness();
    const a = app(h);
    // The build fails: a pool timeout while the account is read.
    h.failures.exportAccount = 1;
    const failed = await exportOf(a);
    expect(failed.status).toBe(500);
    expect(await errorCode(failed)).toBe("internal");
    // The first image cannot even be opened: still nothing sent.
    h.images.push({
      id: h.imageA,
      open: async () => {
        throw new Error("too many open files");
      },
    });
    const unopened = await exportOf(a);
    expect(unopened.status).toBe(500);
    expect(exported(h)).toBe(0);
    h.images.length = 0;
    const ok = await exportOf(a);
    expect(ok.status).toBe(200);
    expect(Object.keys(unzipSync(new Uint8Array(await ok.arrayBuffer())))).toEqual(["export.json"]);
    expect(exported(h)).toBe(1);
    expect(await errorCode(await exportOf(a))).toBe("rate_limited");
  });

  test("a moderation read that fails before the first byte answers an error and gives the day's export back; the next export carries the member", async () => {
    const h = harness();
    const a = app(h);
    h.failures.exportFor = 1;
    const failed = await exportOf(a);
    expect(failed.status).toBe(500);
    expect(await errorCode(failed)).toBe("internal");
    expect(exported(h)).toBe(0);
    const ok = await exportOf(a);
    expect(ok.status).toBe(200);
    const json = JSON.parse(strFromU8(unzipSync(new Uint8Array(await ok.arrayBuffer()))["export.json"]!)) as { moderation: unknown };
    expect(json.moderation).toStrictEqual(expectedModeration(h));
    expect(exported(h)).toBe(1);
    expect(h.asked).toEqual([h.userId, h.userId]);
  });

  test("a limit store that cannot give the export back is logged, and the build's own error is answered", async () => {
    const h = harness();
    const lines: string[] = [];
    const log = pino({ level: "warn" }, new Writable({ write: (chunk: Buffer, _encoding, done) => (lines.push(chunk.toString("utf8")), done()) }));
    const store = new MemoryStore(() => h.now().getTime());
    h.deps.limits = {
      hit: (key, windowMs) => store.hit(key, windowMs),
      release: async () => {
        throw new Error("the store went away");
      },
    };
    h.failures.exportAccount = 1;
    const res = await exportOf(app(h, log));
    expect(res.status).toBe(500);
    expect(await errorCode(res)).toBe("internal");
    expect(lines.map((line) => (JSON.parse(line) as { level: number; msg: string }).level)).toEqual([40]);
    expect(lines[0]).toMatch(/could not be given back/);
  });

  test("an image that fails in the middle of its reading fails the response body, and the day's export stays spent", async () => {
    const h = harness();
    const failing = fakeFile(1_000_000, { failAfter: 3 });
    h.images.push({ id: h.imageA, open: failing.open });
    const a = app(h);
    const res = await exportOf(a);
    // The status went out with the first bytes; what follows can only end the body with an error, never cleanly.
    expect(res.status).toBe(200);
    await expect(res.arrayBuffer()).rejects.toThrow();
    expect(failing.state).toMatchObject({ chunks: 3, stopped: true, closed: true });
    expect(exported(h)).toBe(0);
    h.images.length = 0;
    expect(await errorCode(await exportOf(a))).toBe("rate_limited");
  });

  test("a client that goes away stops the file reads", async () => {
    const h = harness();
    // A hundred megabytes, read only as fast as the response is taken.
    const big = fakeFile(100 * 1024 * 1024);
    h.images.push({ id: h.imageA, open: big.open });
    const res = await exportOf(app(h));
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    await vi.waitFor(() => expect(big.state).toMatchObject({ stopped: true, closed: true }));
    expect(big.state.chunks).toBeLessThan(10);
    expect(exported(h)).toBe(0);
  });
});
```

### Replace `packages/contracts/test/account.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { ExportFormat } from "../src/index";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = "2026-09-24T10:00:00.000Z";

/** A complete export of a small account: every list holds one entry so each entry shape is exercised. */
const full = {
  format: "korbat-export-1",
  exportedAt: at,
  account: {
    id: id(1),
    email: "ada@example.com",
    createdAt: at,
    role: "user",
    mfaEnabled: true,
    hasPassword: true,
    verified: false,
    termsVersion: "draft-2026-09",
    termsAcceptedAt: at,
    passkeys: [
      { name: "Laptop", createdAt: at, lastUsedAt: at, synced: true, createdOn: "Chrome on Windows" },
      { name: "Security key", createdAt: at, lastUsedAt: null, synced: false, createdOn: null },
    ],
  },
  profile: { handle: "ada", displayName: "Ada", bio: "hello", createdAt: at, handleHistory: ["ada_l", "ada"], showInExplore: false },
  posts: [
    { id: id(2), body: "first", createdAt: at, replyToId: null, quoteOfId: null, state: "visible", deletedAt: null, media: [{ id: id(3), file: `media/${id(3)}.webp`, altText: "a cat", width: 2048, height: 1536 }] },
    { id: id(4), body: "", createdAt: at, replyToId: id(2), quoteOfId: null, state: "deleted_by_author", deletedAt: at, media: [] },
  ],
  likes: [{ postId: id(5), at }],
  reposts: [{ postId: id(5), at }],
  bookmarks: [{ postId: id(5), at }],
  following: [{ handle: "grace", since: at }],
  blocks: [{ handle: "troll", since: at }],
  mutes: [{ handle: "loud", since: at }],
  // A session is named by its handle, as the session list names it; the token's hash stays on the server.
  sessions: [{ id: id(9), createdAt: at, lastUsedAt: at, current: true }],
  devices: [{ label: "Chrome on Windows", platform: "web", firstSeenAt: at, lastSeenAt: at }],
  events: [{ type: "signup", at }],
  missingMedia: [id(6)],
  // Last in the document since 3c: the decisions the account was told of, and the reports it sent itself.
  moderation: {
    decisions: [
      {
        id: id(10),
        decidedOn: "2026-09-24",
        postId: id(2),
        kind: "final",
        outcome: "restricted",
        ground: "incompatible",
        ruleId: "R3",
        rulesVersion: 2,
        measures: [
          { kind: "remove", mediaId: null, noEffect: null },
          { kind: "remove_media", mediaId: id(3), noEffect: "already" },
        ],
        reversals: [],
        facts: "The post calls for a named group to be excluded.",
        reason: "That is an attack on people for what they are.",
        legalReference: null,
        appeal: { state: "answered", result: "kept" },
      },
      // A correction about the account itself: it names no post, lifts a reset, and carries no text that is still held.
      { id: id(11), decidedOn: "2026-09-25", postId: null, kind: "correction", outcome: "reversed", ground: null, ruleId: null, rulesVersion: 2, measures: [], reversals: [{ kind: "restore_bio", mediaId: null }], facts: null, reason: null, legalReference: null, appeal: null },
    ],
    reports: [
      {
        ref: "N-ABCDEFGH23",
        receivedAt: at,
        ground: "illegal",
        ruleId: null,
        category: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD",
        explanation: "It offers a fake giveaway.",
        items: [
          { position: 1, link: `https://korbat.example/post/${id(12)}`, reexamines: false, outcome: "no_violation", outcomeText: "no action: korbat found no breach of its rules and nothing illegal.", reexaminationOpen: true },
          // Decided or not, an item says nothing of its outcome before the daily release.
          { position: 2, link: "https://korbat.example/u/grace", reexamines: false, outcome: null, outcomeText: null, reexaminationOpen: null },
        ],
      },
    ],
  },
};

describe("export format", () => {
  test("a complete export parses unchanged, and every list may be empty", () => {
    expect(ExportFormat.parse(full)).toEqual(full);
    const empty = {
      ...full,
      account: { ...full.account, passkeys: [] },
      posts: [],
      likes: [],
      reposts: [],
      bookmarks: [],
      following: [],
      blocks: [],
      mutes: [],
      sessions: [],
      devices: [],
      events: [],
      missingMedia: [],
      moderation: { decisions: [], reports: [] },
    };
    expect(ExportFormat.parse(empty)).toEqual(empty);
  });

  test("the format name is fixed, so a reader can tell what it opened", () => {
    expect(ExportFormat.safeParse({ ...full, format: "korbat-export-2" }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, format: undefined }).success).toBe(false);
  });

  test("the account and the profile carry the nullable facts as null, never missing", () => {
    expect(ExportFormat.safeParse({ ...full, account: { ...full.account, termsVersion: null, termsAcceptedAt: null } }).success).toBe(true);
    expect(ExportFormat.safeParse({ ...full, account: { ...full.account, email: "not-an-email" } }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, account: { ...full.account, role: "owner" } }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, profile: { ...full.profile, handleHistory: undefined } }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, profile: { ...full.profile, handleHistory: [1] } }).success).toBe(false);
  });

  test("the profile carries the author's Explore switch, always, as it stands", () => {
    // Part of the format since 2c, beside the handle history: on as well as off, never left out.
    expect(ExportFormat.parse({ ...full, profile: { ...full.profile, showInExplore: true } }).profile.showInExplore).toBe(true);
    expect(ExportFormat.parse(full).profile.showInExplore).toBe(false);
    expect(ExportFormat.safeParse({ ...full, profile: { ...full.profile, showInExplore: undefined } }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, profile: { ...full.profile, showInExplore: "off" } }).success).toBe(false);
  });

  test("the account's passkeys carry a name, their times, whether they are synced and where they were added, and nothing that identifies the key", () => {
    const [laptop] = full.account.passkeys;
    const withPasskeys = (passkeys: unknown) => ExportFormat.safeParse({ ...full, account: { ...full.account, passkeys } }).success;
    // The list is part of the format since 1c: always present, empty for an account without passkeys.
    expect(withPasskeys(undefined)).toBe(false);
    expect(withPasskeys([])).toBe(true);
    expect(withPasskeys([{ ...laptop, lastUsedAt: null, createdOn: null }])).toBe(true);
    expect(withPasskeys([{ ...laptop, lastUsedAt: undefined }])).toBe(false);
    expect(withPasskeys([{ ...laptop, createdOn: undefined }])).toBe(false);
    expect(withPasskeys([{ ...laptop, name: undefined }])).toBe(false);
    expect(withPasskeys([{ ...laptop, createdAt: "last week" }])).toBe(false);
    expect(withPasskeys([{ ...laptop, synced: "yes" }])).toBe(false);
    // A reader gets the five fields and no more: nothing of the key, its id or its authenticator is part of the format.
    const parsed = ExportFormat.parse({ ...full, account: { ...full.account, passkeys: [{ ...laptop, id: id(7), credentialId: "Y3JlZA", publicKey: "cose", aaguid: id(8) }] } });
    expect(parsed.account.passkeys).toEqual([laptop]);
  });

  test("a deleted post keeps its place with an empty body and a deletion time; an attached image has its dimensions", () => {
    const [post] = full.posts;
    expect(ExportFormat.safeParse({ ...full, posts: [{ ...post, state: "hidden" }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, posts: [{ ...post, replyToId: undefined }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, posts: [{ ...post, media: [{ id: id(3), file: "media/x.webp", altText: "a cat" }] }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, posts: [{ ...post, media: undefined }] }).success).toBe(false);
  });

  test("engagement entries name a post and a time, graph entries a handle and a time", () => {
    expect(ExportFormat.safeParse({ ...full, likes: [{ postId: "nope", at }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, bookmarks: [{ postId: id(5) }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, following: [{ handle: "grace" }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, mutes: [{ handle: "loud", since: "last week" }] }).success).toBe(false);
  });

  test("sessions, devices, events and missing media keep their shapes", () => {
    expect(ExportFormat.safeParse({ ...full, sessions: [{ id: id(9), createdAt: at, lastUsedAt: at }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, devices: [{ ...full.devices[0], label: null }] }).success).toBe(true);
    expect(ExportFormat.safeParse({ ...full, devices: [{ ...full.devices[0], platform: "desktop" }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, events: [{ type: "signup" }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, missingMedia: undefined }).success).toBe(false);
  });
});

describe("the export's moderation member", () => {
  const [decision, correction] = full.moderation.decisions;
  const [report] = full.moderation.reports;
  const [released, waiting] = report!.items;
  const withModeration = (moderation: unknown) => ExportFormat.safeParse({ ...full, moderation }).success;
  const withDecision = (change: Record<string, unknown>) => withModeration({ decisions: [{ ...decision, ...change }], reports: [] });
  const withReport = (change: Record<string, unknown>) => withModeration({ decisions: [], reports: [{ ...report, ...change }] });
  const withItem = (change: Record<string, unknown>) => withReport({ items: [{ ...released, ...change }] });

  test("is part of korbat-export-1 since 3c, the last member of the document: always present, with its two lists, either of which may be empty", () => {
    // Added without a new format name, as the passkeys and the Explore switch were: a reader that skips it loses nothing.
    expect(ExportFormat.parse(full).format).toBe("korbat-export-1");
    expect(Object.keys(ExportFormat.shape).at(-1)).toBe("moderation");
    expect(withModeration(undefined)).toBe(false);
    expect(withModeration({ decisions: [] })).toBe(false);
    expect(withModeration({ reports: [] })).toBe(false);
    expect(withModeration({ decisions: [], reports: [] })).toBe(true);
    expect(withModeration({ decisions: [decision], reports: [] })).toBe(true);
    expect(withModeration({ decisions: [], reports: [report] })).toBe(true);
  });

  test("a decision carries its day, the post it concerns, its kind, outcome, ground, rule and rules version, its measures with whether each changed anything, its reversals, the texts still held and where the appeal stands", () => {
    expect(withDecision({})).toBe(true);
    // The day, never the time: the list of decisions shows a day too.
    expect(withDecision({ decidedOn: at })).toBe(false);
    expect(withDecision({ decidedOn: undefined })).toBe(false);
    // A decision about the account names no post; the member is null then, never missing.
    expect(withDecision({ postId: null })).toBe(true);
    expect(withDecision({ postId: undefined })).toBe(false);
    expect(withDecision({ postId: "the-post" })).toBe(false);
    for (const kind of ["interim", "final", "review", "correction"]) expect(withDecision({ kind }), kind).toBe(true);
    expect(withDecision({ kind: "order" })).toBe(false);
    for (const outcome of ["restricted", "no_violation", "not_evident", "kept", "partly_reversed", "reversed"]) expect(withDecision({ outcome }), outcome).toBe(true);
    expect(withDecision({ outcome: "suspended" })).toBe(false);
    expect(withDecision({ ground: "illegal", ruleId: null })).toBe(true);
    expect(withDecision({ ground: "other" })).toBe(false);
    expect(withDecision({ ruleId: "R7" })).toBe(false);
    expect(withDecision({ rulesVersion: 0 })).toBe(false);
    expect(withDecision({ rulesVersion: undefined })).toBe(false);
    // The seven measures and nothing else; a reversal is no measure, and a measure no reversal.
    for (const kind of ["withhold", "remove", "seal_media", "withhold_media", "remove_media", "reset_display_name", "reset_bio"]) expect(withDecision({ measures: [{ kind, mediaId: null, noEffect: null }] }), kind).toBe(true);
    expect(withDecision({ measures: [{ kind: "restore", mediaId: null, noEffect: null }] })).toBe(false);
    expect(withDecision({ measures: [{ kind: "strike", mediaId: null, noEffect: null }] })).toBe(false);
    for (const noEffect of ["already", "deleted", null]) expect(withDecision({ measures: [{ kind: "remove", mediaId: null, noEffect }] }), String(noEffect)).toBe(true);
    expect(withDecision({ measures: [{ kind: "remove", mediaId: null, noEffect: "no" }] })).toBe(false);
    expect(withDecision({ measures: [{ kind: "remove", mediaId: null }] })).toBe(false);
    for (const kind of ["restore", "unseal_media", "restore_media", "restore_display_name", "restore_bio"]) expect(withDecision({ reversals: [{ kind, mediaId: null }] }), kind).toBe(true);
    expect(withDecision({ reversals: [{ kind: "remove", mediaId: null }] })).toBe(false);
    expect(withDecision({ measures: undefined })).toBe(false);
    expect(withDecision({ reversals: undefined })).toBe(false);
    // A text that is not held, or that the decision never had, is null, never missing.
    expect(withDecision({ facts: null, reason: null, legalReference: null })).toBe(true);
    for (const text of ["facts", "reason", "legalReference"]) expect(withDecision({ [text]: undefined }), text).toBe(false);
    expect(ExportFormat.parse(full).moderation.decisions[1]).toEqual(correction);
  });

  test("an appeal is pending without a result or answered with one, and null when none was filed", () => {
    expect(withDecision({ appeal: null })).toBe(true);
    expect(withDecision({ appeal: undefined })).toBe(false);
    expect(withDecision({ appeal: { state: "pending", result: null } })).toBe(true);
    for (const result of ["kept", "partly_reversed", "reversed"]) expect(withDecision({ appeal: { state: "answered", result } }), result).toBe(true);
    expect(withDecision({ appeal: { state: "pending", result: "kept" } })).toBe(false);
    expect(withDecision({ appeal: { state: "answered", result: null } })).toBe(false);
    expect(withDecision({ appeal: { state: "withdrawn", result: null } })).toBe(false);
  });

  test("a decision is read with its own members and no more: nothing of who reported, who decided or how many reports there were is part of the format", () => {
    const extra = { ...decision, decidedBy: id(20), staffHandle: "mod_one", reporterId: id(21), reporterHandle: "grace", reports: 3, source: "report", caseId: id(22) };
    const parsed = ExportFormat.parse({ ...full, moderation: { decisions: [extra], reports: [] } });
    expect(parsed.moderation.decisions).toEqual([decision]);
  });

  test("a report carries its reference, when korbat received it, its ground with the rule it cited, its category and its sender's own explanation while that is held", () => {
    expect(withReport({})).toBe(true);
    expect(withReport({ ref: "N-abc" })).toBe(false);
    expect(withReport({ receivedAt: "last week" })).toBe(false);
    expect(withReport({ ground: "rule", ruleId: "R6", category: "STATEMENT_CATEGORY_OTHER_VIOLATION_TC" })).toBe(true);
    // A report on the path for child sexual abuse material records no sender, so it is in nobody's export.
    expect(withReport({ ground: "csam" })).toBe(false);
    expect(withReport({ ruleId: "R9" })).toBe(false);
    expect(withReport({ ruleId: undefined })).toBe(false);
    expect(withReport({ category: "STATEMENT_CATEGORY_MADE_UP" })).toBe(false);
    expect(withReport({ explanation: null })).toBe(true);
    expect(withReport({ explanation: undefined })).toBe(false);
    expect(withReport({ items: undefined })).toBe(false);
    // Read with its own members and no more.
    const parsed = ExportFormat.parse({ ...full, moderation: { decisions: [], reports: [{ ...report, reporterId: id(1), contactId: id(23), lookupHash: "f".repeat(64), token: "secret" }] } });
    expect(parsed.moderation.reports).toEqual([report]);
  });

  test("an item carries its place in the report, its link and whether it is a re-examination; its outcome, the outcome's words and whether a re-examination is open come together, with the release, or not at all", () => {
    expect(withItem({})).toBe(true);
    expect(withReport({ items: [waiting] })).toBe(true);
    expect(withItem({ position: 0 })).toBe(false);
    expect(withItem({ position: 21 })).toBe(false);
    expect(withItem({ link: undefined })).toBe(false);
    expect(withItem({ reexamines: undefined })).toBe(false);
    for (const outcome of ["restricted_rule", "restricted_legal", "no_violation", "not_evident", "not_available", "partly_reversed", "reversed"]) expect(withItem({ outcome }), outcome).toBe(true);
    expect(withItem({ outcome: "restricted" })).toBe(false);
    expect(withItem({ reexaminationOpen: false })).toBe(true);
    // Released, all three are told; before the release, none is.
    expect(withItem({ outcome: null })).toBe(false);
    expect(withItem({ outcomeText: null })).toBe(false);
    expect(withItem({ reexaminationOpen: null })).toBe(false);
    expect(withReport({ items: [{ ...waiting, reexaminationOpen: false }] })).toBe(false);
    expect(withReport({ items: [{ ...waiting, outcomeText: "no action" }] })).toBe(false);
    // An item is read with its own members and no more: the list's id of an item is not part of the export.
    const parsed = ExportFormat.parse({ ...full, moderation: { decisions: [], reports: [{ ...report, items: [{ ...released, id: id(24), caseId: id(25), answeredBy: id(26) }] }] } });
    expect(parsed.moderation.reports[0]!.items).toEqual([released]);
  });
});
```

## Step 2: run the tests and watch them fail

```bash
pnpm test
```

Expected: the command exits with an error, and the output contains:

- `Tests  `
- `failed`

Observed on the dry run:

```text
packages/contracts test:  ❯ test/account.test.ts (14 tests | 7 failed) 179ms
packages/db test:       Tests  60 passed (60)
packages/contracts test:  Test Files  1 failed | 14 passed (15)
packages/contracts test:       Tests  7 failed | 287 passed (294)
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/moderation-cases-3c/write_blocks.py docs/superpowers/prompts/moderation-cases-3c/10-export-terms-stack.md 3
```

Expected: 13 lines starting with `wrote`, one for each file below.

### Create `apps/api/src/moderation/export.ts`

```ts
import type { ExportFormat } from "@korbat/contracts";
import { exportedDecisions } from "./author";
import type { ModerationDeps } from "./context";
import { exportedReports } from "./reports";

/**
 * The moderation member of an account's data export (3c design, section 7.11), which the account module writes last in
 * export.json: the decisions about the account that its Cases screen lists, and the reports and notices it sent itself.
 *
 * This file only joins the two. The decisions are built in the author's file from the list's query and the statement's
 * data, neither of which can reach a report; the reports in the reporter's file from the list of the account's own
 * reports. So the member holds what those screens show and nothing they do not: never another person's report, who
 * reported, a notifier, a count of reports, or a staff member.
 */
export type ModerationExport = ExportFormat["moderation"];

/** ModerationForAccount.exportFor: both lists for one account, read before the archive's first byte. */
export async function exportFor(deps: Pick<ModerationDeps, "apiDb" | "social" | "config">, userId: string): Promise<ModerationExport> {
  const [decisions, reports] = await Promise.all([exportedDecisions(deps, userId), exportedReports(deps, userId)]);
  return { decisions, reports };
}
```

### Replace `apps/api/src/account/context.ts` (whole file)

```ts
import type { Logger } from "pino";
import type { AuthForAccount } from "../auth";
import type { MediaForAccount } from "../media";
import type { ModerationForAccount } from "../moderation";
import type { RateLimitStore } from "../middleware/rate-limit";
import type { SocialForAccount } from "../social";

/** The codes this module raises itself; the modules it calls raise their own, which the app's error handler also renders. */
export type AccountErrorKind = "not_found" | "invalid_request" | "rate_limited" | "service_unavailable";
export type AccountErrorStatus = 400 | 404 | 429 | 503;

const MESSAGES: Record<AccountErrorKind, string> = {
  not_found: "Not found.",
  invalid_request: "Some details are missing or invalid.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  service_unavailable: "That could not be done right now. Try again in a moment.",
};

/** An expected, user-facing failure. The HTTP layer turns it into an ErrorEnvelope with this code and status. */
export class AccountError extends Error {
  constructor(
    readonly code: AccountErrorKind,
    readonly status: AccountErrorStatus,
    message: string = MESSAGES[code],
    /** Set for rate_limited and service_unavailable so the response can carry Retry-After. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "AccountError";
  }
}

export function accountErrorMessage(code: AccountErrorKind): string {
  return MESSAGES[code];
}

/**
 * The account module owns no table: it sequences the other three modules through the interfaces their
 * index files export (1b design, section 5). The limit store is the one every per-account limit uses.
 */
export interface AccountDeps {
  auth: AuthForAccount;
  social: SocialForAccount;
  media: MediaForAccount;
  /**
   * The purge's forgetting of a deleted account's reports, in the moderation module's tables (3c design, section 7.10),
   * and the export's moderation member (section 7.11). The server always hands it over; a test of the other steps may
   * leave it out: the purge then skips that step, and the export writes the member with two empty lists.
   */
  moderation?: ModerationForAccount;
  limits: RateLimitStore;
  log: Logger;
  now: () => Date;
}
```

### Replace `apps/api/src/account/flows/export.ts` (whole file)

```ts
import type { Logger } from "pino";
import type { Platform } from "@korbat/contracts";
import type { AccountExport } from "../../auth";
import type { ModerationExport } from "../../moderation";
import type { ProfileExport } from "../../social";
import { AccountError, type AccountDeps } from "../context";
import type { OpenFile, ZipWriter } from "../zip";

/** One export a day (1b design, section 10). */
export const EXPORTS_PER_WINDOW = 1;
export const EXPORT_WINDOW_MS = 24 * 60 * 60 * 1000;

const exportLimitKey = (userId: string) => `export:${userId}`;

/** The entry an image has in the archive; export.json names it under the post's media. */
export function mediaEntry(id: string): string {
  return `media/${id}.webp`;
}

/** The download's name: the handle and the day, so several exports of one account sort by date. */
export function exportFilename(handle: string, now: Date): string {
  return `korbat-export-${handle}-${now.toISOString().slice(0, 10)}.zip`;
}

/**
 * What the archive is written from. The account's own facts, the profile and the moderation member are
 * read before the first byte; the profile's lists are read page by page while export.json is written,
 * and the images, each behind the media module's checked open, go first, so `missingMedia` is complete
 * by the time the JSON that lists it is written.
 */
export interface ExportPlan {
  exportedAt: Date;
  /** The handle of the session that asked for the export: the id the auth module lists each session under. */
  currentSession: string;
  account: AccountExport;
  profile: ProfileExport;
  /** The decisions about the account that it was told of and its own reports, as the moderation module hands them over (3c design, section 7.11). */
  moderation: ModerationExport;
  images: { id: string; open: OpenFile }[];
  /** The images whose file the checked open refused or could not find, filled while the images are written. */
  missingMedia: string[];
}

/**
 * Counts one export of the account in the daily window and refuses once it is used up. Taken before
 * anything is built or streamed, so a stream that fails midway still counts; Retry-After says when the
 * window resets.
 */
export async function enforceExportLimit(deps: AccountDeps, userId: string): Promise<void> {
  let hit: { count: number; resetMs: number };
  try {
    hit = await deps.limits.hit(exportLimitKey(userId), EXPORT_WINDOW_MS);
  } catch {
    // Fails closed: an export that cannot be counted is not made, and the client is told to retry shortly.
    throw new AccountError("service_unavailable", 503, undefined, 30);
  }
  if (hit.count > EXPORTS_PER_WINDOW) throw new AccountError("rate_limited", 429, undefined, Math.max(1, Math.ceil(hit.resetMs / 1000)));
}

/**
 * Gives the day's export back after a failure before the archive's first byte (a pool timeout, a
 * restart): the owner received nothing, so the attempt must not use up the day. Best effort: when the
 * store cannot be reached, the export stays counted and a warning says so, which costs the owner a day
 * at worst.
 */
export async function giveBackExport(deps: AccountDeps, userId: string, log: Logger): Promise<void> {
  try {
    await deps.limits.release(exportLimitKey(userId));
  } catch (err) {
    log.warn({ err, userId }, "account export: the day's export could not be given back after a failure before the first byte");
  }
}

const iso = (at: Date): string => at.toISOString();
const isoOrNull = (at: Date | null): string | null => (at ? at.toISOString() : null);

/** What an account module built without the moderation module writes: the member is part of the format, so it is always there. */
const NO_MODERATION: ModerationExport = { decisions: [], reports: [] };

/**
 * Reads what is needed before the first byte: the account's facts, sessions, devices and events (one
 * read, bounded by the 90 days of events), the profile's own fields, the list of images, and the
 * moderation member (the decisions the account was told of and its own reports, both short lists). The
 * four modules are asked at once, so a read that fails costs the owner nothing: no byte was sent yet.
 * `currentSession` is the handle of the session asking, which marks its entry among the sessions.
 * `pageSize` is how many rows of each profile list are read at a time; tests lower it.
 */
export async function buildExport(deps: AccountDeps, userId: string, currentSession: string, now: Date, pageSize?: number): Promise<ExportPlan> {
  const [account, profile, images, moderation] = await Promise.all([
    deps.auth.exportAccount(userId),
    deps.social.exportProfile(userId, pageSize),
    deps.media.exportImages(userId),
    // The server always hands the moderation module over; a test of the other members may leave it out.
    deps.moderation ? deps.moderation.exportFor(userId) : NO_MODERATION,
  ]);
  return { exportedAt: now, currentSession, account, profile, moderation, images, missingMedia: [] };
}

/** A list member of export.json, read in pages and written one element at a time. */
class Paged<T> {
  constructor(
    readonly pages: AsyncIterable<readonly T[]>,
    readonly element: (row: T) => unknown,
  ) {}
}

/** An array already in memory, as one page. */
function inMemory<T>(rows: readonly T[], element: (row: T) => unknown): Paged<T> {
  return new Paged(
    (async function* () {
      yield rows;
    })(),
    element,
  );
}

/** Fragments are gathered into pieces of about this many UTF-16 units, at most 3 bytes each in UTF-8: well under 64 KiB. */
const PIECE_CHARS = 16 * 1024;

/**
 * export.json in pieces, written exactly as JSON.stringify(document, null, 2) writes the whole
 * document: member by member at the top level, and the lists element by element, each element
 * stringified on its own and indented to its depth (JSON.stringify's output holds line breaks only
 * between tokens; one inside a string is escaped, so indenting after every line break is exact). No list
 * is ever whole in memory: each is read page by page as it is written.
 */
export async function* exportJson(plan: ExportPlan): AsyncGenerator<string> {
  let buffer = "";
  for await (const fragment of documentFragments(plan)) {
    buffer += fragment;
    if (buffer.length >= PIECE_CHARS) {
      yield buffer;
      buffer = "";
    }
  }
  if (buffer.length > 0) yield buffer;
}

async function* documentFragments(plan: ExportPlan): AsyncGenerator<string> {
  const { account, profile } = plan;
  const ref = (row: { postId: string; at: Date }) => ({ postId: row.postId, at: iso(row.at) });
  const other = (row: { handle: string; since: Date }) => ({ handle: row.handle, since: iso(row.since) });
  // The members in the order of the format (ExportFormat in the contracts); the order is part of the bytes.
  const members: [string, unknown][] = [
    ["format", "korbat-export-1"],
    ["exportedAt", iso(plan.exportedAt)],
    [
      "account",
      {
        id: account.account.id,
        email: account.account.email,
        createdAt: iso(account.account.createdAt),
        role: account.account.role,
        mfaEnabled: account.account.mfaEnabled,
        hasPassword: account.account.hasPassword,
        verified: account.account.verified,
        termsVersion: account.account.termsVersion,
        termsAcceptedAt: isoOrNull(account.account.termsAcceptedAt),
        // Inside the account, where the format places them; at most the cap of ten, so they are written with the account's other facts rather than paged.
        passkeys: account.passkeys.map((passkey) => ({ name: passkey.name, createdAt: iso(passkey.createdAt), lastUsedAt: isoOrNull(passkey.lastUsedAt), synced: passkey.synced, createdOn: passkey.createdOn })),
      },
    ],
    [
      "profile",
      {
        handle: profile.profile.handle,
        displayName: profile.profile.displayName,
        bio: profile.profile.bio,
        createdAt: iso(profile.profile.createdAt),
        handleHistory: [...profile.profile.handleHistory],
        // Last in the profile, where the format added it (2c); the member order is part of the bytes.
        showInExplore: profile.profile.showInExplore,
      },
    ],
    [
      "posts",
      new Paged(profile.posts, (post) => ({
        id: post.id,
        body: post.body,
        createdAt: iso(post.createdAt),
        replyToId: post.replyToId,
        quoteOfId: post.quoteOfId,
        state: post.state,
        deletedAt: isoOrNull(post.deletedAt),
        media: post.media.map((image) => ({ id: image.id, file: mediaEntry(image.id), altText: image.altText, width: image.width, height: image.height })),
      })),
    ],
    ["likes", new Paged(profile.likes, ref)],
    ["reposts", new Paged(profile.reposts, ref)],
    ["bookmarks", new Paged(profile.bookmarks, ref)],
    ["following", new Paged(profile.following, other)],
    ["blocks", new Paged(profile.blocks, other)],
    ["mutes", new Paged(profile.mutes, other)],
    [
      "sessions",
      inMemory(account.sessions, (session) => ({ id: session.id, createdAt: iso(session.createdAt), lastUsedAt: iso(session.lastUsedAt), current: session.id === plan.currentSession })),
    ],
    [
      "devices",
      // The platform column is text; sign-in only ever writes one of the contract's three values.
      inMemory(account.devices, (device) => ({ label: device.label, platform: device.platform as Platform, firstSeenAt: iso(device.firstSeenAt), lastSeenAt: iso(device.lastSeenAt) })),
    ],
    ["events", inMemory(account.events, (event) => ({ type: event.type, at: iso(event.at) }))],
    // Complete by now: the images were written before the JSON.
    ["missingMedia", inMemory(plan.missingMedia, (id) => id)],
    // Last, where the format added it (3c). Each entry is written member by member in the format's order, so the bytes
    // do not depend on how the moderation module builds its objects, and nothing beyond the format is ever written.
    ["moderation", moderationMember(plan.moderation)],
  ];

  yield "{\n";
  for (const [index, [key, value]] of members.entries()) {
    yield `${index === 0 ? "" : ",\n"}  ${JSON.stringify(key)}: `;
    if (value instanceof Paged) yield* listFragments(value);
    else yield indented(JSON.stringify(value, null, 2), "  ");
  }
  yield "\n}";
}

/** The moderation member with every entry's members in the order of the format (ExportFormat in the contracts). */
function moderationMember(moderation: ModerationExport): ModerationExport {
  return {
    decisions: moderation.decisions.map((decision) => ({
      id: decision.id,
      decidedOn: decision.decidedOn,
      postId: decision.postId,
      kind: decision.kind,
      outcome: decision.outcome,
      ground: decision.ground,
      ruleId: decision.ruleId,
      rulesVersion: decision.rulesVersion,
      measures: decision.measures.map((measure) => ({ kind: measure.kind, mediaId: measure.mediaId, noEffect: measure.noEffect })),
      reversals: decision.reversals.map((reversal) => ({ kind: reversal.kind, mediaId: reversal.mediaId })),
      facts: decision.facts,
      reason: decision.reason,
      legalReference: decision.legalReference,
      appeal: decision.appeal === null ? null : decision.appeal.state === "pending" ? { state: "pending", result: null } : { state: "answered", result: decision.appeal.result },
    })),
    reports: moderation.reports.map((report) => ({
      ref: report.ref,
      receivedAt: report.receivedAt,
      ground: report.ground,
      ruleId: report.ruleId,
      category: report.category,
      explanation: report.explanation,
      items: report.items.map((item) => ({ position: item.position, link: item.link, reexamines: item.reexamines, outcome: item.outcome, outcomeText: item.outcomeText, reexaminationOpen: item.reexaminationOpen })),
    })),
  };
}

/** A top-level member's array, as JSON.stringify writes it at that depth: "[]" when empty, else one element per line group. */
async function* listFragments<T>(list: Paged<T>): AsyncGenerator<string> {
  let first = true;
  for await (const page of list.pages) {
    for (const row of page) {
      yield `${first ? "[\n" : ",\n"}    ${indented(JSON.stringify(list.element(row), null, 2), "    ")}`;
      first = false;
    }
  }
  yield first ? "[]" : "\n  ]";
}

const indented = (json: string, pad: string): string => json.replaceAll("\n", `\n${pad}`);

/**
 * Writes the archive: every image as a stored entry, then export.json, then the central directory.
 * export.json comes last so that missingMedia can name every image whose file the checked open refused
 * or did not find when its turn came (the sweeper may be between the row and the file), or that was no
 * longer the owner's to export by then: the media module reads each image's row again as it opens the
 * file, and opens none for an image deleted with its post, erased or sealed since the list was read.
 * The order of entries means nothing to a reader.
 */
export async function writeExport(writer: ZipWriter, plan: ExportPlan): Promise<void> {
  for (const image of plan.images) {
    if (!(await writer.addFile(mediaEntry(image.id), image.open))) plan.missingMedia.push(image.id);
  }
  await writer.addJsonPieces("export.json", exportJson(plan));
  await writer.end();
}
```

### Replace `apps/api/src/account/index.ts` (whole file)

```ts
/**
 * The only file outside `src/account/` may import. Everything else in the module is private and the
 * architecture test fails the build if another file reaches into it.
 */
import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import type { AuthForAccount } from "../auth";
import type { AppEnv } from "../env";
import type { JobLock } from "../lib/jobs";
import type { MediaForAccount } from "../media";
import type { ModerationForAccount } from "../moderation";
import type { RateLimitStore } from "../middleware/rate-limit";
import type { SocialForAccount } from "../social";
import type { AccountDeps } from "./context";
import { createPurgeJob } from "./purge";
import { accountRoutes } from "./routes";

export { AccountError } from "./context";
export type { AccountDeps } from "./context";

export interface CreateAccountOptions {
  /** The other modules' interfaces for this one, as their index files hand them out: auth.forAccount, social.forAccount, media.forAccount. */
  auth: AuthForAccount;
  social: SocialForAccount;
  media: MediaForAccount;
  /** The moderation module's interface for this one: moderation.forAccount. Without it the purge forgets no report's sender, and the export's moderation member is empty. */
  moderation?: ModerationForAccount;
  /** The auth module's requireSession: an onboarded account with CSRF and Origin checked. */
  requireSession: MiddlewareHandler<AppEnv>;
  /** The auth module's requireFreshAuth: a credential proven in the last five minutes, which the export needs. */
  requireFreshAuth: MiddlewareHandler<AppEnv>;
  /** The auth module's requireStrongFreshAuth: level 2 on an account with TOTP, which starting and confirming a deletion need (1c design, section 10). */
  requireStrongFreshAuth: MiddlewareHandler<AppEnv>;
  /** The daily export limit shares the store the per-IP middleware uses. */
  rateLimitStore: RateLimitStore;
  logger: Logger;
  now?: () => Date;
}

export function createAccount(options: CreateAccountOptions) {
  const deps: AccountDeps = {
    auth: options.auth,
    social: options.social,
    media: options.media,
    moderation: options.moderation,
    limits: options.rateLimitStore,
    log: options.logger,
    now: options.now ?? (() => new Date()),
  };
  return {
    deps,
    routes: accountRoutes(deps, options.requireSession, options.requireFreshAuth, options.requireStrongFreshAuth),
    /** Starts the purge job (deletions left half done, every five minutes under the shared lock) and returns the function that stops it. */
    startPurge: (lock: JobLock) => createPurgeJob(deps, lock).start(),
  };
}

export type Account = ReturnType<typeof createAccount>;
```

### Replace `apps/api/src/moderation/access.ts` (whole file)

```ts
import { sql } from "drizzle-orm";
import type { Db } from "@korbat/db";
import { imageModerationStates } from "../media";
import { accountLink, postLink } from "./links";
import { iso, noticeRecords, rows, type Runner } from "./repo";

/**
 * The moderation part of an answer to a GDPR access request, drafted for the operator by `staff.js access-request` (3c
 * design, section 7.13). It is a draft: a person weighs it before anything is sent. It prints what korbat holds about
 * the requester's own content and conduct, and it never prints who reported them: every reporter's and notifier's
 * identity is withheld, by name of the rule, and each text another person wrote (a report's explanation and cited law,
 * a re-examination's statement) is printed apart, marked for the weighing the law asks for.
 *
 * The reads are this module's own tables on the API role. An image is named by its id and its stored state, read
 * through the media module, never opened; a sealed one is named and nothing more.
 */

export const ACCESS_WORDS = {
  /** Why no reporter's or notifier's identity is in the draft. */
  identities: "rights of others: GDPR Art. 15(4), recital 63",
  /** What stands beside every text another person wrote. */
  weigh: "send only after a person has weighed the writer's rights (C-203/22)",
  /** What stands on every case that holds an item of the urgent lane, open or closed. */
  authorities:
    "check the R2, Art. 18 and order records before sending: an authority may need the person not to be told yet, or national law may restrict access (GDPR Art. 23(1)(d))",
  /** The source of an item, as a category: never a count, a name or a report's words. */
  sources: { report: "a report by another user", notice: "a notice under Article 16", finding: "found by a moderator" },
} as const;

/** A part of the draft, printed as JSON for the operator: nothing reads it back. */
type Json = unknown;

/** Ids as one uuid[] parameter. */
const uuids = (ids: readonly string[]) => sql`${`{${ids.join(",")}}`}::uuid[]`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The greatest uuid below this one, or null for the lowest: PostgreSQL orders uuids as 128-bit numbers, so a page of one
 * row after it starts at the id itself when a row has it. That reads one image row by its id through the one function
 * this module may read image rows with.
 */
export function uuidBefore(id: string): string | null {
  if (!UUID.test(id)) throw new TypeError("not a lower-case uuid");
  const value = BigInt(`0x${id.replaceAll("-", "")}`);
  if (value === 0n) return null;
  const hex = (value - 1n).toString(16).padStart(32, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The stored state of each of these images, "gone" for one whose row no longer exists. */
async function imageStates(q: Runner, ids: readonly string[]): Promise<Map<string, string>> {
  const states = new Map<string, string>();
  for (const id of new Set(ids)) {
    if (!UUID.test(id)) continue;
    const [row] = await imageModerationStates(q as Db, uuidBefore(id), 1);
    states.set(id, row?.id === id ? row.moderationState : "gone");
  }
  return states;
}

/** What an intake alleged, in one word. */
const groundOf = (row: { csam: boolean; alleges_illegal: boolean }) => (row.csam ? "child sexual abuse material" : row.alleges_illegal ? "illegal content" : "a korbat rule");

/** The notices and reports these intakes are, each with its items as their sender is shown them: for the requester's own reports, and for a notifier's. */
async function noticesWhere(q: Runner, appOrigin: string, where: ReturnType<typeof sql>): Promise<Json[]> {
  // The same read the sender's own export takes its reports' records from.
  const intakes = await noticeRecords(q, where);
  if (intakes.length === 0) return [];
  const items = await rows<{ intake_id: string; position: number; target_type: "post" | "account"; target_id: string; named_handle: string | null; shown: string | null; reexamination: boolean; statement: string | null }>(
    q,
    sql`select i.intake_id, i.position, i.target_type, i.target_id, i.named_handle, i.shown_outcome::text as shown, i.reexamines_item_id is not null as reexamination, i.statement
          from intake_items i where i.intake_id = any(${uuids(intakes.map((row) => row.id))}) order by i.intake_id, i.position, i.created_at, i.id`,
  );
  return intakes.map((n) => ({
    ref: n.ref,
    receivedAt: n.receivedAt,
    ground: groundOf({ csam: n.csam, alleges_illegal: n.allegesIllegal }),
    rule: n.ruleId,
    category: n.category,
    // The sender's own words, while korbat still holds them.
    explanation: n.explanation,
    citedLaw: n.citedLaw,
    recordErased: n.erased,
    items: items
      .filter((item) => item.intake_id === n.id)
      .map((item) => ({
        item: item.position,
        // The address as the report named it: an account's under the handle it was named by, never a later one.
        link: item.target_type === "post" ? postLink(appOrigin, item.target_id) : accountLink(appOrigin, item.named_handle ?? ""),
        // Only what was released to the sender; an outcome that waits for the daily release is not shown here either.
        shownOutcome: item.shown,
        reexamination: item.reexamination,
        statement: item.statement,
      })),
  }));
}

export interface AccountAccessDraft {
  subject: { handle: string };
  cases: Json[];
  ownReports: Json[];
  withheld: { identities: { count: number; reason: string }; texts: Json[] };
}

/**
 * The draft for an account: every case about the account or one of its posts, whatever its outcome, with each item's
 * source category, ground, rule and category; its snapshots with their content unless it is withheld; every decision
 * with its statement's data and its texts while they are held; and the account's own appeals with their statements.
 * Then the account's own reports and notices. A case that holds an item of the urgent lane, open or closed, is marked
 * for the check of the authorities' records.
 */
export async function accessDraftForAccount(q: Runner, appOrigin: string, account: { id: string; handle: string }): Promise<AccountAccessDraft> {
  const cases = await rows<{ id: string; target_type: "post" | "account"; target_id: string; opened_at: string; closed_at: string | null; urgent: boolean }>(
    q,
    sql`select c.id, c.target_type, c.target_id, ${iso("c.opened_at")} as opened_at, ${iso("c.closed_at")} as closed_at,
               exists (select 1 from intake_items i where i.case_id = c.id and i.lane = 0) as urgent
          from cases c
         where (c.target_type = 'account' and c.target_id = ${account.id}::uuid)
            or (c.target_type = 'post' and c.target_id in (select p.id from posts p where p.author_id = ${account.id}::uuid))
         order by c.opened_at, c.id`,
  );
  const ids = uuids(cases.map((row) => row.id));
  const items = await rows<{ case_id: string; kind: string; csam: boolean; alleges_illegal: boolean; rule_id: string | null; category: string; arrived_at: string; identified: boolean; explanation: string | null; cited_law: string | null; statement: string | null; intake_id: string }>(
    q,
    sql`select i.case_id, n.kind::text as kind, n.csam, n.alleges_illegal, n.rule_id, n.category, ${iso("i.created_at")} as arrived_at,
               (i.reporter_account_id is not null or n.contact_id is not null) as identified, n.explanation, n.cited_law, i.statement, n.id as intake_id
          from intake_items i join intakes n on n.id = i.intake_id where i.case_id = any(${ids}) order by i.case_id, i.seq`,
  );
  const snapshots = await rows<{ id: string; case_id: string; taken_at: string; erased_on: string | null; withheld: boolean; author_handle: string; post_state: string | null; body: string | null; media: { id: string; alt: string | null; width: number; height: number }[] | null; display_name: string | null; bio: string | null; handle: string | null }>(
    q,
    sql`select s.id, s.case_id, ${iso("s.taken_at")} as taken_at, to_char(s.erased_at at time zone 'UTC', 'YYYY-MM-DD') as erased_on, public.snapshot_withheld(s.id) as withheld,
               s.author_handle, s.post_state::text as post_state, s.body, s.media, s.display_name, s.bio, s.handle
          from evidence_snapshots s where s.case_id = any(${ids}) order by s.case_id, s.taken_at, s.id`,
  );
  const decisions = await rows<{ id: string; case_id: string; kind: string; outcome: string; ground: string | null; rule_id: string | null; rules_version: number; category: string; source: string; decided_at: string; redacted_on: string | null; facts: string | null; reason: string | null; legal_reference: string | null; has_facts: boolean; has_reason: boolean; has_legal: boolean }>(
    q,
    sql`select d.id, d.case_id, d.kind::text as kind, d.outcome::text as outcome, d.ground::text as ground, d.rule_id, d.rules_version, d.category, d.source::text as source,
               ${iso("d.decided_at")} as decided_at, to_char(d.redacted_at at time zone 'UTC', 'YYYY-MM-DD') as redacted_on,
               (select t.text from staff_texts t where t.digest = d.facts_digest) as facts,
               (select t.text from staff_texts t where t.digest = d.reason_digest) as reason,
               (select t.text from staff_texts t where t.digest = d.legal_reference_digest) as legal_reference,
               d.facts_digest is not null as has_facts, d.reason_digest is not null as has_reason, d.legal_reference_digest is not null as has_legal
          from decisions d where d.case_id = any(${ids}) order by d.case_id, d.decided_at, d.id`,
  );
  const actions = await rows<{ decision_id: string; kind: string; media_id: string | null; no_effect: string | null }>(
    q,
    sql`select a.decision_id, a.kind::text as kind, a.media_id, a.no_effect from decision_actions a
         where a.decision_id = any(${uuids(decisions.map((row) => row.id))}) order by a.decision_id, a.kind::text, a.media_id`,
  );
  const appeals = await rows<{ decision_id: string; case_id: string; filed_at: string; statement: string | null; erased: boolean; result: string | null; answered_at: string | null }>(
    q,
    sql`select a.decision_id, d.case_id, ${iso("a.filed_at")} as filed_at, a.statement, a.erased_at is not null as erased, a.result::text as result, ${iso("a.answered_at")} as answered_at
          from appeals a join decisions d on d.id = a.decision_id
         where d.case_id = any(${ids}) and a.appellant_account_id = ${account.id}::uuid order by a.filed_at, a.id`,
  );
  // Each image a shown snapshot lists, by its stored state now.
  const states = await imageStates(q, snapshots.filter((s) => !s.withheld).flatMap((s) => (s.media ?? []).map((image) => image.id)));

  /** A statement text: the text while korbat holds it, and whether one was ever given. */
  const text = (given: boolean, held: string | null): Json => (given ? (held === null ? { erased: true } : held) : null);
  const withheldTexts: Json[] = [];
  const seenIntakes = new Set<string>();
  for (const item of items) {
    // A report's own words stand once for its intake, a re-examination's statement for its item.
    if (!seenIntakes.has(`${item.case_id}:${item.intake_id}`)) {
      seenIntakes.add(`${item.case_id}:${item.intake_id}`);
      if (item.explanation !== null) withheldTexts.push({ caseId: item.case_id, kind: "explanation", text: item.explanation, note: ACCESS_WORDS.weigh });
      if (item.cited_law !== null) withheldTexts.push({ caseId: item.case_id, kind: "cited_law", text: item.cited_law, note: ACCESS_WORDS.weigh });
    }
    if (item.statement !== null) withheldTexts.push({ caseId: item.case_id, kind: "reexamination_statement", text: item.statement, note: ACCESS_WORDS.weigh });
  }

  return {
    subject: { handle: account.handle },
    cases: cases.map((c) => ({
      id: c.id,
      target: c.target_type === "post" ? { type: "post", link: postLink(appOrigin, c.target_id) } : { type: "account", link: accountLink(appOrigin, account.handle) },
      openedAt: c.opened_at,
      closedAt: c.closed_at,
      authoritiesCheck: c.urgent ? ACCESS_WORDS.authorities : null,
      items: items
        .filter((item) => item.case_id === c.id)
        .map((item) => ({
          source: item.kind === "finding" ? ACCESS_WORDS.sources.finding : item.alleges_illegal ? ACCESS_WORDS.sources.notice : ACCESS_WORDS.sources.report,
          ground: groundOf(item),
          rule: item.rule_id,
          category: item.category,
          arrivedAt: item.arrived_at,
        })),
      snapshots: snapshots
        .filter((s) => s.case_id === c.id)
        .map((s) =>
          s.withheld
            ? // An erased copy with the day it went and no content; a copy of content erased since is withheld the same way.
              { id: s.id, takenAt: s.taken_at, erasedOn: s.erased_on, withheld: true, content: null }
            : {
                id: s.id,
                takenAt: s.taken_at,
                erasedOn: null,
                withheld: false,
                content: {
                  authorHandle: s.author_handle,
                  postState: s.post_state,
                  body: s.body,
                  displayName: s.display_name,
                  bio: s.bio,
                  handle: s.handle,
                  // A sealed image is named by its id and its state and nothing more.
                  media: (s.media ?? []).map((image) => (states.get(image.id) === "sealed" ? { id: image.id, state: "sealed" } : { id: image.id, state: states.get(image.id) ?? "gone", alt: image.alt, width: image.width, height: image.height })),
                },
              },
        ),
      decisions: decisions
        .filter((d) => d.case_id === c.id)
        .map((d) => ({
          id: d.id,
          kind: d.kind,
          outcome: d.outcome,
          ground: d.ground,
          rule: d.rule_id,
          rulesVersion: d.rules_version,
          category: d.category,
          source: d.source,
          decidedAt: d.decided_at,
          contentErasedOn: d.redacted_on,
          measures: actions.filter((a) => a.decision_id === d.id).map((a) => ({ kind: a.kind, image: a.media_id, noEffect: a.no_effect })),
          facts: text(d.has_facts, d.facts),
          reason: text(d.has_reason, d.reason),
          legalReference: text(d.has_legal, d.legal_reference),
        })),
      appeals: appeals
        .filter((a) => a.case_id === c.id)
        .map((a) => ({ decisionId: a.decision_id, filedAt: a.filed_at, statement: a.erased ? { erased: true } : a.statement, result: a.result, answeredAt: a.answered_at })),
    })),
    ownReports: await noticesWhere(q, appOrigin, sql`n.reporter_id = ${account.id}::uuid`),
    withheld: { identities: { count: items.filter((item) => item.identified).length, reason: ACCESS_WORDS.identities }, texts: withheldTexts },
  };
}

export interface ContactsAccessDraft {
  contacts: { name: string | null; notices: Json[] }[];
}

/** The draft for a signed-out notifier, by the contacts the auth module found for their address: the name each gave and the notices filed under it. */
export async function accessDraftForContacts(q: Runner, appOrigin: string, contacts: readonly { id: string; name: string | null }[]): Promise<ContactsAccessDraft> {
  const drafted: ContactsAccessDraft["contacts"] = [];
  for (const contact of contacts) drafted.push({ name: contact.name, notices: await noticesWhere(q, appOrigin, sql`n.contact_id = ${contact.id}::uuid`) });
  return { contacts: drafted };
}
```

### Replace `apps/api/src/moderation/author.ts` (whole file)

```ts
import {
  AUTHOR_CASES_PAGE_SIZE,
  mediaPath,
  type AuthorCasesPage,
  type DecisionAppeal,
  type DecisionContent,
  type DecisionStatement,
  type DecisionView,
  type ExportFormat,
  type PostModeration,
  type RuleId,
} from "@korbat/contracts";
import { authorDecision, authorDecisions, chipFacts, type AuthorAppealFacts, type AuthorDecisionFacts, type AuthorDecisionRow } from "./author-repo";
import { ModerationError, type ModerationDeps } from "./context";
import { decisionStatement } from "./statement";

/**
 * What the author of a post or the holder of an account reads about korbat's decisions on it (3c design, sections 7.6 and
 * 10): the list of decisions they were told of, one decision with its statement's data and the content it was made on,
 * the same decisions as their export lists them (section 7.11), and the facts behind the chip on their own post.
 * Everything here is built from the author's queries and the statement's
 * data, neither of which can reach a report: an author learns the source of a decision as a category, and nothing else
 * about who reported or how often.
 */

// ---------------------------------------------------------------- page cursors

const CURSOR_TIME = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{6}Z$/;
const CURSOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Where a page of one of the app's moderation lists starts: after the row with this time (to the microsecond, as text) and id. */
export interface ListCursor {
  at: string;
  id: string;
}

/** A list's cursor: the last row's sort key as an opaque word. */
export const encodeListCursor = (cursor: ListCursor): string => Buffer.from(JSON.stringify([cursor.at, cursor.id]), "utf8").toString("base64url");

/** Reads a cursor back; anything this module did not write is refused, never guessed at. */
export function decodeListCursor(cursor: string): ListCursor {
  let parts: unknown;
  try {
    parts = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new ModerationError("invalid_request");
  }
  if (!Array.isArray(parts) || parts.length !== 2) throw new ModerationError("invalid_request");
  const [at, id] = parts as unknown[];
  if (typeof at !== "string" || !CURSOR_TIME.test(at) || typeof id !== "string" || !CURSOR_ID.test(id)) throw new ModerationError("invalid_request");
  return { at, id };
}

// ---------------------------------------------------------------- the list

/** GET /api/moderation/cases: the decisions about the viewer's account that they were told of, newest first, 20 a page. */
export async function authorCases(deps: Pick<ModerationDeps, "apiDb">, viewer: string, cursor?: string): Promise<AuthorCasesPage> {
  const after = cursor === undefined ? null : decodeListCursor(cursor);
  const found = await authorDecisions(deps.apiDb, viewer, after, AUTHOR_CASES_PAGE_SIZE + 1);
  const page = found.slice(0, AUTHOR_CASES_PAGE_SIZE);
  const last = page.at(-1);
  return {
    decisions: page.map((row) => ({
      id: row.id,
      kind: row.kind,
      outcome: row.outcome as AuthorCasesPage["decisions"][number]["outcome"],
      decidedOn: row.decidedOn,
      post: row.post,
      actions: row.actions,
      endedInterim: row.endedInterim,
      ruleId: row.ruleId as RuleId | null,
      legal: row.legal,
      appealUntil: row.appealUntil,
      reversedOn: row.reversedOn,
      appeal: row.appeal,
    })),
    // One row more than the page was read: only then is there a next page.
    nextCursor: found.length > AUTHOR_CASES_PAGE_SIZE && last ? encodeListCursor({ at: last.sortAt, id: last.id }) : null,
  };
}

// ---------------------------------------------------------------- one decision

/**
 * The content a decision was made on, or the reason it is not shown; the first that applies, in this order (3c design,
 * section 10). The database's one predicate says whether the snapshot's content may be shown at all. Where it may not,
 * an R4 redaction of the post or the account is named before a plain erasure: content that was erased because it
 * doxxed someone is said to be gone for that reason, whichever decision is viewed. A snapshot withheld without being
 * erased is one whose post's content was erased since, which only a redaction does.
 */
function contentOf(facts: AuthorDecisionFacts): DecisionContent {
  if (facts.withheld) {
    if (facts.redacted || !facts.erased || facts.erasedOn === null) return { kind: "r4_redacted" };
    return { kind: "erased", contentErasedOn: facts.erasedOn, postKept: facts.targetType === "post" && !facts.postDeleted && !facts.postErased };
  }
  if (facts.targetType === "account") return { kind: "account", handle: facts.handle, displayName: facts.displayName ?? "", bio: facts.bio ?? "" };
  // A sealed image is shown to nobody, its author included, and an image of a post its author deleted is kept for the
  // case and served to nobody: for either, the answer carries how many there are and nothing of them. Otherwise the
  // author's own image route serves each image, a withheld or removed one too; an image whose description the snapshot
  // does not hold was erased before the copy was taken, and is not listed.
  const imagesHidden = facts.sealed ? "sealed" : facts.postDeleted ? "deleted_by_author" : null;
  const images =
    imagesHidden === null
      ? facts.images.flatMap((image) => (image.alt === null ? [] : [{ id: image.id, alt: image.alt, width: image.width, height: image.height, small: mediaPath(image.id, "small"), large: mediaPath(image.id, "large") }]))
      : [];
  return { kind: "post", body: facts.body ?? "", deletedByAuthor: facts.postDeleted, images, imageCount: facts.images.length, imagesHidden };
}

/**
 * The author's appeal as their screen shows it (3c design, section 7.7). A pending appeal says whether anyone may review
 * it now and whether its review is an admin's, in the database's own two answers, which name nobody. An answered one
 * carries the statement of the decision that answered it: the review, or the correction that reversed everything before
 * a review came, read as every statement is and so told to the author in the same words as its mail.
 */
async function appealOf(deps: Pick<ModerationDeps, "apiDb">, appeal: AuthorAppealFacts): Promise<DecisionAppeal> {
  if (appeal.answeredBy === null || appeal.result === null || appeal.answeredOn === null) {
    // An appeal that is not answered always has a reviewer state: the database answers null only for an answered one.
    return { state: "pending", filedAt: appeal.filedAt, reviewer: appeal.reviewer ?? "none_eligible", needsAdmin: appeal.needsAdmin };
  }
  const answer = await decisionStatement(deps.apiDb, appeal.answeredBy);
  if (!answer) throw new Error("an appeal is answered by a decision that does not exist");
  return { state: "answered", filedAt: appeal.filedAt, answeredOn: appeal.answeredOn, result: appeal.result, answeredBy: appeal.answeredBy, statement: answer.statement };
}

/**
 * GET /api/moderation/decisions/:id: one decision as its author reads it, or not_found: for an id that names no
 * decision, for a decision about someone else, and for one its author was not told of.
 */
export async function authorDecisionView(deps: Pick<ModerationDeps, "apiDb">, viewer: string, decisionId: string): Promise<DecisionView> {
  const facts = await authorDecision(deps.apiDb, viewer, decisionId);
  if (!facts) throw new ModerationError("not_found");
  const found = await decisionStatement(deps.apiDb, decisionId);
  if (!found) throw new ModerationError("not_found");
  return {
    id: decisionId,
    ...found.statement,
    appealUntil: facts.appealUntil,
    reversedOn: facts.reversedOn,
    content: contentOf(facts),
    appeal: facts.appeal === null ? null : await appealOf(deps, facts.appeal),
  };
}

// ---------------------------------------------------------------- the export's decisions

/** A decision as the account's export lists it. */
export type ExportedDecision = ExportFormat["moderation"]["decisions"][number];

/** How many decisions the export reads at a time: one statement for the page, and then each decision's statement. */
const EXPORT_PAGE_SIZE = 100;

/**
 * One decision as the export writes it (3c design, section 7.11), from the two things its author's screens are built
 * from: its row in the list and its statement's data. So the entry holds what those screens show and nothing they do
 * not: the facts and the reason of a decision that restricted nothing are not in the statement's data, and a text that
 * was erased is null there. A statement names its source as a category; the entry does not carry even that.
 */
export function exportedDecision(row: Pick<AuthorDecisionRow, "id" | "decidedOn" | "post" | "appeal">, statement: DecisionStatement): ExportedDecision {
  return {
    id: row.id,
    decidedOn: row.decidedOn,
    // The entry of the export's `posts` a decision about a post concerns: a post keeps its row through its deletion.
    postId: row.post?.id ?? null,
    kind: statement.kind,
    outcome: statement.outcome,
    ground: statement.ground,
    ruleId: statement.ruleId,
    rulesVersion: statement.rulesVersion,
    measures: statement.measures.map((measure) => ({ kind: measure.kind, mediaId: measure.mediaId, noEffect: measure.noEffect })),
    reversals: statement.reversals.map((reversal) => ({ kind: reversal.kind, mediaId: reversal.mediaId })),
    facts: statement.facts,
    reason: statement.reason,
    legalReference: statement.legalReference,
    appeal: row.appeal === null ? null : row.appeal === "pending" ? { state: "pending", result: null } : { state: "answered", result: row.appeal },
  };
}

/**
 * The export's `decisions` (ModerationForAccount.exportFor): every decision about the account that its Cases screen
 * lists, which are those its author was told of, newest first as the screen lists them. Read through the list's own
 * query, a page at a time, and each decision's statement through the statement's own read, so no decision the author was
 * not told of, and nothing a statement does not tell, can be in an export.
 */
export async function exportedDecisions(deps: Pick<ModerationDeps, "apiDb">, accountId: string): Promise<ExportedDecision[]> {
  const exported: ExportedDecision[] = [];
  let after: ListCursor | null = null;
  for (;;) {
    const page: AuthorDecisionRow[] = await authorDecisions(deps.apiDb, accountId, after, EXPORT_PAGE_SIZE);
    for (const row of page) {
      const found = await decisionStatement(deps.apiDb, row.id);
      // A decision is a row for good: one the list has just named has a statement.
      if (!found) throw new Error("a decision in its author's list has no statement");
      exported.push(exportedDecision(row, found.statement));
    }
    const last = page.at(-1);
    // A page that is not full is the last one.
    if (page.length < EXPORT_PAGE_SIZE || !last) return exported;
    after = { at: last.sortAt, id: last.id };
  }
}

// ---------------------------------------------------------------- the chip

/**
 * ModerationForSocial.authorFacts: for each of these posts that the viewer wrote and that is withheld or removed, the
 * decision its chip names. One query a page, asked only when the viewer wrote some of the page's restricted posts.
 */
export function authorFacts(deps: Pick<ModerationDeps, "apiDb">, viewer: string, postIds: readonly string[]): Promise<Map<string, PostModeration>> {
  return chipFacts(deps.apiDb, viewer, postIds);
}
```

### Replace `apps/api/src/moderation/index.ts` (whole file)

```ts
/**
 * The only file outside `src/moderation/` may import. Everything else in the module is private and the architecture test
 * fails the build if another file reaches into it.
 *
 * The moderation module (3c design, section 5) runs on the API's role and owns the moderation tables: intakes and their
 * items, cases, decisions and their ledger of measures, evidence snapshots and staff texts. It inserts rows; the database
 * checks them, derives every restriction from them and refuses at commit what cannot stand. It reaches the other modules
 * only through the interfaces they export, never names an image row (the media module locks and holds a case's images for
 * it), and never sees the auth schema: a notifier's name and address, and every mail, are the auth module's.
 */
import type { AppealsPage, CaseView, FindingRequest, FindingResponse, MediaSize, PostModeration, QueuePage, StaffOverview, StaffSnapshotTaken, StaffTextSaveRequest, StaffTextSaved, StaffTextsResponse } from "@korbat/contracts";
import type { Db } from "@korbat/db";
import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import type { ActiveStaffSession, AuthForModeration, StaffStepUpConfirmed } from "../auth";
import type { Config } from "../config";
import type { AppEnv } from "../env";
import type { JobLock } from "../lib/jobs";
import type { MediaForCases, StoredFile } from "../media";
import type { RateLimitStore } from "../middleware/rate-limit";
import type { SocialForModeration } from "../social";
import { appealsList, review, reviewedCase } from "./appeals";
import { authorFacts } from "./author";
import { caseImage, openFinding, overview, queue, readCase, readDecidedCase, takeSnapshot } from "./cases";
import { createBackground, type ModerationDeps } from "./context";
import { decide, type DecideOutcome } from "./decide";
import { createDispatchJob } from "./dispatch";
import { exportFor, type ModerationExport } from "./export";
import { forgetReporter } from "./repo";
import { RETENTION_OFF_WARNING, createRetentionJob } from "./retention";
import { reveal, type RevealOutcome } from "./reveal";
import { moderationRoutes, noSession } from "./routes";
import { ownTexts, saveText } from "./texts";

export { ACCESS_WORDS, accessDraftForAccount, accessDraftForContacts, uuidBefore } from "./access";
export type { AccountAccessDraft, ContactsAccessDraft } from "./access";
export { ModerationError } from "./context";
export type { ModerationDeps, ModerationErrorKind } from "./context";
export type { DecideOutcome } from "./decide";
export type { ModerationExport } from "./export";
export type { RevealOutcome } from "./reveal";

/** What the staff module needs from this one: the console's operations on cases, which its routes run behind the staff gate. */
export interface ModerationForStaff {
  /**
   * Records the decision a step-up confirmed, in one transaction with its audit row. "ended" when the confirming account
   * or key no longer opens anything, "late" when the challenge's time ran out; neither writes anything.
   */
  decide(session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: { requestId: string }): Promise<DecideOutcome>;
  /** The case as the answer to a decision that has just committed on it: logged like every read, and never refused for the day's limit. */
  decidedCase(session: ActiveStaffSession, caseId: string): Promise<CaseView>;
  /**
   * Records the review a step-up confirmed: the answer to the one appeal of the decision the confirmation names, in one
   * transaction with its audit row. "ended" and "late" as for a decision.
   */
  review(session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: { requestId: string }): Promise<DecideOutcome>;
  /** The case of a reviewed decision as the answer to a review that has just committed on it, read as decidedCase reads. */
  reviewedCase(session: ActiveStaffSession, decisionId: string): Promise<CaseView>;
  /** A page of the pending appeals, newest first, each marked whether this person may review it; never a statement. */
  appeals(session: ActiveStaffSession, cursor?: string): Promise<AppealsPage>;
  /** What every staff member's home screen shows: counts, times, staff handles and cases, and how many appeals this person may review. */
  overview(session: ActiveStaffSession): Promise<StaffOverview>;
  /** A page of the queue: open cases by lane and age, after the cursor when one is given. */
  queue(cursor?: string): Promise<QueuePage>;
  /** The case as staff read it. The read is logged, and held to the day's limit on different cases; a recused person is refused. */
  caseView(session: ActiveStaffSession, caseId: string): Promise<CaseView>;
  /** An image of the case's own post, opened for staff and logged, or image_refused. The caller streams the file and closes it. */
  caseImage(session: ActiveStaffSession, caseId: string, mediaId: string, size: MediaSize): Promise<StoredFile>;
  /**
   * A fresh snapshot of the case's target when it differs from the newest; its id and digest, never content. Run again
   * when it gives way to a decision on the case, and refused as case_closed when it keeps having to.
   */
  takeSnapshot(session: ActiveStaffSession, caseId: string): Promise<StaffSnapshotTaken>;
  /** Opens a case, or joins the open one, on the moderator's own finding under a rule (its target resolved first), within the day's limit. */
  openFinding(session: ActiveStaffSession, request: FindingRequest): Promise<FindingResponse>;
  /** Saves a text on the case, as written or not at all. */
  saveText(session: ActiveStaffSession, caseId: string, request: StaffTextSaveRequest): Promise<StaffTextSaved>;
  /** The person's own drafts on the case, with their salts. */
  texts(session: ActiveStaffSession, caseId: string): Promise<StaffTextsResponse>;
  /**
   * Reveals who sent an item, once a step-up confirmed it: the access row and the audit row in one transaction, the
   * identity read only after the commit. "ended" and "late" as for a decision.
   */
  reveal(session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: { requestId: string }): Promise<RevealOutcome>;
}

/**
 * What the social module needs from this one (3c design, section 5): the facts behind the chip on the author's own post.
 * For each of these posts that the viewer wrote and that is withheld or removed, the decision of the strongest post
 * measure in force, or the decision whose erasure removed it. Asked once a page, and only about the viewer's own posts.
 */
export interface ModerationForSocial {
  authorFacts(viewer: string, postIds: readonly string[]): Promise<Map<string, PostModeration>>;
}

/** What the account module needs from this one (3c design, sections 5, 7.10 and 7.11): the purge's forgetting, and the export's member. */
export interface ModerationForAccount {
  /**
   * Forgets that a deleted account sent its reports: the account's id goes from its intakes and their items, which go on
   * being processed. The database acts only on an account whose auth row the take-down marked deleted, and changes
   * nothing when run again.
   */
  forgetAccount(userId: string): Promise<void>;
  /**
   * The moderation member of the account's data export: the decisions about the account that its Cases screen lists and
   * its own reports and notices while their records are kept, each as the account's own screens show it. Never another
   * person's report, a reporter, a notifier or a staff member.
   */
  exportFor(userId: string): Promise<ModerationExport>;
}

export interface CreateModerationOptions {
  /** The korbat_api pool. The module never sees the auth pool. */
  apiDb: Db;
  /** The auth module's interface for moderation: auth.forModeration. */
  auth: AuthForModeration;
  /** The social module's interface for cases: socialForModeration(apiDb). */
  social: SocialForModeration;
  /** The media module's interface for cases: media.forCases. */
  media: MediaForCases;
  /**
   * The auth module's requireSession: an onboarded account with CSRF and Origin checked. The author's and the reporter's
   * routes stand behind it. Without it they refuse every request, so a module built for the staff side alone opens none.
   */
  requireSession?: MiddlewareHandler<AppEnv>;
  /** What one sender may send, and the throttles of the staff alerts, count in the store the per-IP middleware uses. */
  rateLimitStore: RateLimitStore;
  config: Config;
  logger: Logger;
  now?: () => Date;
}

export function createModeration(options: CreateModerationOptions) {
  const deps: ModerationDeps = {
    apiDb: options.apiDb,
    auth: options.auth,
    social: options.social,
    media: options.media,
    limits: options.rateLimitStore,
    background: createBackground(options.logger),
    config: options.config,
    log: options.logger,
    now: options.now ?? (() => new Date()),
  };
  const forStaff: ModerationForStaff = {
    decide: (session, confirmed, ctx) => decide(deps, session, confirmed, ctx),
    decidedCase: (session, caseId) => readDecidedCase(deps, session, caseId),
    review: (session, confirmed, ctx) => review(deps, session, confirmed, ctx),
    reviewedCase: async (session, decisionId) => readDecidedCase(deps, session, await reviewedCase(deps, decisionId)),
    appeals: (session, cursor) => appealsList(deps, session, cursor),
    overview: (session) => overview(deps, session),
    queue: (cursor) => queue(deps, cursor),
    caseView: (session, caseId) => readCase(deps, session, caseId),
    caseImage: (session, caseId, mediaId, size) => caseImage(deps, session, caseId, mediaId, size),
    takeSnapshot: (session, caseId) => takeSnapshot(deps, session, caseId),
    openFinding: (session, request) => openFinding(deps, session, request),
    saveText: (session, caseId, request) => saveText(deps, session, caseId, request),
    texts: (session, caseId) => ownTexts(deps, session, caseId),
    reveal: (session, confirmed, ctx) => reveal(deps, session, confirmed, ctx),
  };
  const forSocial: ModerationForSocial = {
    authorFacts: (viewer, postIds) => authorFacts(deps, viewer, postIds),
  };
  const forAccount: ModerationForAccount = {
    forgetAccount: async (userId) => {
      await forgetReporter(deps.apiDb, userId);
    },
    exportFor: (userId) => exportFor(deps, userId),
  };
  return {
    deps,
    /**
     * The app's routes, mounted at /api: reports and notices, their status page with its contact buttons and its
     * re-examinations, and behind the session guard the account's own decisions, appeals, reports and re-examinations.
     */
    routes: moderationRoutes(deps, options.requireSession ?? noSession),
    /** The interface the staff module uses. */
    forStaff,
    /** The interface the social module's views use. */
    forSocial,
    /** The interface the account module's purge and export use. */
    forAccount,
    /**
     * Resolves once every task a request started and did not wait for has ended: the mails after a report, a notice, a
     * finding, a reveal or a refused case read. The tests await it; the server lets the tasks run.
     */
    settle: () => deps.background.settle(),
    /**
     * Starts the module's background work under the jobs' shared lock, on one API instance at a time: the dispatch job
     * always, and the retention job only while MODERATION_RETENTION is on. Each one's first round comes ten minutes after
     * the start. While the switch is off nothing is erased, released or deleted, and the warning is logged at every start,
     * so a switch left off after a restore is seen. Answers the function that stops both; a round in flight finishes.
     */
    startJobs: (lock: JobLock): (() => void) => {
      const stopDispatch = createDispatchJob(deps, lock).start();
      if (deps.config.MODERATION_RETENTION !== "on") {
        deps.log.warn(RETENTION_OFF_WARNING);
        return stopDispatch;
      }
      const stopRetention = createRetentionJob(deps, lock).start();
      return () => {
        stopDispatch();
        stopRetention();
      };
    },
  };
}

export type Moderation = ReturnType<typeof createModeration>;
```

### Replace `apps/api/src/moderation/repo.ts` (whole file)

```ts
import { sql } from "drizzle-orm";
import type { ActionKind, AppealsReviewedParams, CaseDecidedParams, Lane, StaffStoredAssertion } from "@korbat/contracts";
import type { Db, DbTx } from "@korbat/db";

/**
 * The SQL statements of the moderation module, on the korbat_api pool (3c design, sections 5 and 6). The module inserts
 * rows; migrator-owned triggers check them, force the columns the API must not choose, and derive every restriction from
 * them. So each insert here names only what the API supplies: the database sets the rest whatever an insert said (a time,
 * a number in a case, who a report came from), and a column left out can never be mistaken for one the API chose. That is
 * why the inserts are written as SQL: a query builder would name every column of the table.
 */

/** What a statement runs through: the pool, or a transaction. */
export type Runner = Pick<Db, "execute"> | Pick<DbTx, "execute">;

export const rows = async <T>(q: Runner, query: ReturnType<typeof sql>): Promise<T[]> => (await q.execute(query)) as unknown as T[];

/** A timestamptz expression as the text Date.prototype.toISOString writes: UTC, to the millisecond. The expression is written here, never input. */
export const iso = (expression: string) => sql.raw(`to_char(${expression} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

// ---------------------------------------------------------------- what the database raised

/** The first of the driver's errors in the chain that carries a SQLSTATE; drizzle wraps the driver's error as a cause. */
function driverError(err: unknown): { code: string; message: unknown; constraint_name?: unknown } | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === "object" && typeof (current as { code?: unknown }).code === "string") return current as { code: string; message: unknown; constraint_name?: unknown };
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/** The message of an exception a trigger or a function raised as its code (SQLSTATE P0001); null for anything else. */
export function raisedMessage(err: unknown): string | null {
  const raised = driverError(err);
  return raised?.code === "P0001" && typeof raised.message === "string" ? raised.message : null;
}

/** True for a serialization failure (SQLSTATE 40001): the attach trigger raises it when an item's case closed in between. */
export function isSerializationFailure(err: unknown): boolean {
  return driverError(err)?.code === "40001";
}

/** The constraint a unique violation names (SQLSTATE 23505), or null for anything else. */
export function violatedUniqueConstraint(err: unknown): string | null {
  const raised = driverError(err);
  return raised?.code === "23505" && typeof raised.constraint_name === "string" ? raised.constraint_name : null;
}

// ---------------------------------------------------------------- intakes, items and cases

export type TargetType = "post" | "account";

/** One report, notice or finding as the intake's transaction stores it; the trigger sets when it was received and its receipt's state. */
export interface IntakeRow {
  kind: "user" | "finding";
  ref: string;
  /** The sha256 hex of the notice's token, for a signed-out notice and for every notice on the CSAM path. */
  lookupHash: string | null;
  channel: "signed_in" | "signed_out" | "staff";
  reporterId: string | null;
  findingBy: string | null;
  contactId: string | null;
  ruleId: string | null;
  allegesIllegal: boolean;
  csam: boolean;
  category: string;
  categoryKeyword: string | null;
  citedLaw: string | null;
  explanation: string | null;
  bonaFide: boolean;
}

export async function insertIntake(tx: DbTx, row: IntakeRow): Promise<string> {
  const [inserted] = await rows<{ id: string }>(
    tx,
    sql`insert into intakes (kind, ref, lookup_hash, channel, reporter_id, finding_by, contact_id, rule_id, alleges_illegal, csam, category, category_keyword, cited_law, explanation, bona_fide)
        values (${row.kind}::intake_kind, ${row.ref}, ${row.lookupHash}, ${row.channel}::intake_channel, ${row.reporterId}::uuid, ${row.findingBy}::uuid, ${row.contactId}::uuid,
                ${row.ruleId}, ${row.allegesIllegal}::boolean, ${row.csam}::boolean, ${row.category}, ${row.categoryKeyword}, ${row.citedLaw}, ${row.explanation}, ${row.bonaFide}::boolean)
        returning id`,
  );
  return inserted!.id;
}

/**
 * The target's open case, opened when there is none: an insert that does nothing on a conflict (the API role holds no
 * UPDATE on cases, so it could not do anything else), then a read of the open case in a statement of its own, which
 * sees a case another transaction committed while the insert waited. Null when the read finds none: a decision closed
 * the case after the insert, and the caller runs both again.
 */
export async function openCase(tx: DbTx, targetType: TargetType, targetId: string): Promise<string | null> {
  await tx.execute(sql`insert into cases (target_type, target_id) values (${targetType}::moderation_target, ${targetId}::uuid) on conflict (target_type, target_id) where closed_at is null do nothing`);
  const [open] = await rows<{ id: string }>(tx, sql`select id from cases where target_type = ${targetType}::moderation_target and target_id = ${targetId}::uuid and closed_at is null`);
  return open?.id ?? null;
}

/** A free text someone outside korbat wrote, with the salt and the digest the server made for it. */
export interface SaltedText {
  text: string;
  salt: string;
  digest: string;
}

/** One target of an intake. With a case the attach trigger numbers it into the case; without one it is stored as answered at once, not available. */
export interface ItemRow {
  intakeId: string;
  caseId: string | null;
  targetType: TargetType;
  targetId: string;
  position: number;
  lane: Lane;
  /** The image the sender pointed at: a hint. */
  mediaId: string | null;
  /** For an account, the handle as it was named, in lower case. */
  namedHandle: string | null;
  /**
   * For a re-examination: the item it examines again, and what its sender added. The attach trigger then decides whether
   * that item may be examined again now, and takes the target, the handle, the position and the lane from it whatever
   * this row says.
   */
  reexamines?: { itemId: string; statement: SaltedText | null };
}

/** Stores one item. Answers its id, its number in its case, and the position and the lane the database gave it. */
export async function insertItem(tx: DbTx, row: ItemRow): Promise<{ id: string; seq: number | null; position: number; lane: Lane }> {
  const statement = row.reexamines?.statement ?? null;
  const [inserted] = await rows<{ id: string; seq: number | null; position: number; lane: Lane }>(
    tx,
    sql`insert into intake_items (intake_id, case_id, target_type, target_id, position, lane, media_id, named_handle, outcome, reexamines_item_id, statement, statement_salt, statement_digest)
        values (${row.intakeId}::uuid, ${row.caseId}::uuid, ${row.targetType}::moderation_target, ${row.targetId}::uuid, ${row.position}::smallint, ${row.lane}::smallint,
                ${row.mediaId}::uuid, ${row.namedHandle}, ${row.caseId === null ? "not_available" : null}::item_outcome,
                ${row.reexamines?.itemId ?? null}::uuid, ${statement?.text ?? null}, ${statement?.salt ?? null}, ${statement?.digest ?? null})
        returning id, seq, position, lane`,
  );
  return inserted!;
}

// ---------------------------------------------------------------- reports and notices

/** Ids as one uuid[] parameter. */
const uuids = (ids: readonly string[]) => sql`${`{${ids.join(",")}}`}::uuid[]`;

/** One target as a key of a set: its kind and its id. */
export const targetKey = (target: { type: TargetType; id: string }) => `${target.type}:${target.id}`;

/**
 * Which of these targets the sender has reported already on this ground (alleging illegality or not): the target's open
 * case holds an item of theirs that is no re-examination. The unique index the intake's transaction meets holds the same
 * rule; this read lets a notice that names several targets drop the ones already reported instead of failing whole.
 */
export async function alreadyReported(q: Runner, reporterId: string, allegesIllegal: boolean, targets: readonly { type: TargetType; id: string }[]): Promise<Set<string>> {
  if (targets.length === 0) return new Set();
  const ids = (type: TargetType) => uuids(targets.filter((target) => target.type === type).map((target) => target.id));
  const found = await rows<{ target_type: TargetType; target_id: string }>(
    q,
    sql`select c.target_type, c.target_id from cases c
         where c.closed_at is null
           and ((c.target_type = 'post' and c.target_id = any(${ids("post")})) or (c.target_type = 'account' and c.target_id = any(${ids("account")})))
           and exists (select 1 from intake_items i
                        where i.case_id = c.id and i.reporter_account_id = ${reporterId}::uuid and i.alleges_illegal = ${allegesIllegal}::boolean and i.reexamines_item_id is null)`,
  );
  return new Set(found.map((row) => targetKey({ type: row.target_type, id: row.target_id })));
}

/** A notice as the status page and its receipt need it: where it stands and whom its receipt goes to, never what it says. */
export interface NoticeRow {
  id: string;
  ref: string;
  /** The sha256 hex of the notice's own token; null for a report sent signed in on a rule or on the law. */
  lookupHash: string | null;
  contactId: string | null;
  reporterId: string | null;
  allegesIllegal: boolean;
  /** As Date.prototype.toISOString writes it. */
  receivedAt: string;
  receipt: "pending" | "sent" | "folded" | "suppressed" | "no_address" | "none" | "failed";
}

const noticeColumns = sql`id, ref, lookup_hash, contact_id, reporter_id, alleges_illegal, ${iso("received_at")} as received_at, receipt`;
type NoticeColumns = { id: string; ref: string; lookup_hash: string | null; contact_id: string | null; reporter_id: string | null; alleges_illegal: boolean; received_at: string; receipt: NoticeRow["receipt"] };
const noticeOf = (row: NoticeColumns | undefined): NoticeRow | null =>
  row ? { id: row.id, ref: row.ref, lookupHash: row.lookup_hash, contactId: row.contact_id, reporterId: row.reporter_id, allegesIllegal: row.alleges_illegal, receivedAt: row.received_at, receipt: row.receipt } : null;

/** The notice with this public reference, or null. */
export async function noticeByRef(q: Runner, ref: string): Promise<NoticeRow | null> {
  return noticeOf((await rows<NoticeColumns>(q, sql`select ${noticeColumns} from intakes where ref = ${ref}`))[0]);
}

export async function noticeById(q: Runner, intakeId: string): Promise<NoticeRow | null> {
  return noticeOf((await rows<NoticeColumns>(q, sql`select ${noticeColumns} from intakes where id = ${intakeId}::uuid`))[0]);
}

/** One item of a notice as its sender may read it: nothing of the case, the decision's reasons or the target's content. */
export interface NoticeItemRow {
  /** The item's id: only the signed-in sender's own list carries it; the status page names an item by its position. */
  id: string;
  position: number;
  targetType: TargetType;
  targetId: string;
  /** For an account, the handle as the notice named it. */
  namedHandle: string | null;
  /** False for a link that named nothing live: its item has no case and was answered at once. */
  hasCase: boolean;
  suspect: boolean;
  /** Whether the daily release has shown the outcome; nothing below is told before it. */
  released: boolean;
  shownOutcome: string | null;
  /** The UTC day of the answering decision, or of the item itself when it was answered without one. */
  decidedOn: string;
  /** Whether the answering decision holds a seal. */
  sealed: boolean;
  /** Whether the answering decision was taken while nobody could open the post's images. */
  decisionUnseen: boolean;
  /** The rule the answering decision cites and the rulebook version it was made under; null without a decision or a rule. */
  ruleId: string | null;
  rulesVersion: number | null;
  /** Every measure of the answering decision changed nothing when it was imposed. */
  noEffect: boolean;
  changed: boolean;
  reexamines: boolean;
  /** A moderator's decision to take no action: the only answer a re-examination can be asked for. */
  noAction: boolean;
  reexamined: boolean;
  /** The end of the re-examination window, as toISOString writes it; null before the release. */
  until: string | null;
  inWindow: boolean;
}

const MEASURE_KINDS_SQL = sql`('withhold', 'remove', 'seal_media', 'withhold_media', 'remove_media', 'reset_display_name', 'reset_bio')`;

/**
 * Whether every measure of the decision that answered item `i` changed nothing when it was imposed: it holds a measure,
 * and none whose `no_effect` is null. The mail's line and the status answer read it through this one expression.
 */
const answerChangedNothing = sql`(exists (select 1 from decision_actions a where a.decision_id = i.answered_by and a.kind in ${MEASURE_KINDS_SQL})
                and not exists (select 1 from decision_actions a where a.decision_id = i.answered_by and a.kind in ${MEASURE_KINDS_SQL} and a.no_effect is null))`;

/**
 * The items of these notices, each notice's in the order its page lists them: by position, an item korbat added for a
 * quoted post (positions 11 to 20) directly after the item it was added for, and a re-examination, which shares its
 * item's position, after it. The window's end is the database's own appeal_deadline of the release, read against its
 * clock, as the attach trigger reads it when a re-examination is filed.
 */
export async function noticeItemsOf(q: Runner, intakeIds: readonly string[]): Promise<Map<string, NoticeItemRow[]>> {
  const byNotice = new Map<string, NoticeItemRow[]>(intakeIds.map((id) => [id, []]));
  if (intakeIds.length === 0) return byNotice;
  const found = await rows<{
    id: string;
    intake_id: string;
    position: number;
    target_type: TargetType;
    target_id: string;
    named_handle: string | null;
    has_case: boolean;
    suspect: boolean;
    released: boolean;
    shown_outcome: string | null;
    decided_on: string;
    sealed: boolean;
    decision_unseen: boolean;
    rule_id: string | null;
    rules_version: number | null;
    no_effect: boolean;
    changed: boolean;
    reexamines: boolean;
    no_action: boolean;
    reexamined: boolean;
    until: string | null;
    in_window: boolean;
  }>(
    q,
    sql`select i.id, i.intake_id, i.position, i.target_type, i.target_id, i.named_handle, i.case_id is not null as has_case, i.suspect,
               i.outcome_sent_at is not null as released, i.shown_outcome,
               to_char(coalesce(d.decided_at, i.created_at) at time zone 'UTC', 'YYYY-MM-DD') as decided_on,
               exists (select 1 from decision_actions a where a.decision_id = i.answered_by and a.kind = 'seal_media') as sealed,
               coalesce(d.unseen, false) as decision_unseen,
               d.rule_id, d.rules_version, ${answerChangedNothing} as no_effect,
               i.revised_sent_at is not null as changed,
               i.reexamines_item_id is not null as reexamines,
               (i.answered_by is not null and i.outcome in ('no_violation', 'not_evident')) as no_action,
               exists (select 1 from intake_items r where r.reexamines_item_id = i.id) as reexamined,
               ${iso("public.appeal_deadline(i.outcome_sent_at)")} as until,
               coalesce(clock_timestamp() < public.appeal_deadline(i.outcome_sent_at), false) as in_window
          from intake_items i left join decisions d on d.id = i.answered_by
         where i.intake_id = any(${`{${intakeIds.join(",")}}`}::uuid[])
         order by i.intake_id, (case when i.position > 10 then i.position - 10 else i.position end), (i.position > 10), i.created_at, i.id`,
  );
  const itemOf = (row: (typeof found)[number]): NoticeItemRow => ({
    id: row.id,
    position: row.position,
    targetType: row.target_type,
    targetId: row.target_id,
    namedHandle: row.named_handle,
    hasCase: row.has_case,
    suspect: row.suspect,
    released: row.released,
    shownOutcome: row.shown_outcome,
    decidedOn: row.decided_on,
    sealed: row.sealed,
    decisionUnseen: row.decision_unseen,
    ruleId: row.rule_id,
    rulesVersion: row.rules_version,
    noEffect: row.no_effect,
    changed: row.changed,
    reexamines: row.reexamines,
    noAction: row.no_action,
    reexamined: row.reexamined,
    until: row.until,
    inWindow: row.in_window,
  });
  for (const row of found) byNotice.get(row.intake_id)?.push(itemOf(row));
  return byNotice;
}

/** One notice's items, in the order its page lists them. */
export async function noticeItems(q: Runner, intakeId: string): Promise<NoticeItemRow[]> {
  return (await noticeItemsOf(q, [intakeId])).get(intakeId) ?? [];
}

/** An item as the re-examination route needs it: what it is about, and whose notice it belongs to. */
export interface ReexaminedItemRow {
  id: string;
  intakeId: string;
  position: number;
  targetType: TargetType;
  targetId: string;
  namedHandle: string | null;
  suspect: boolean;
  /** The id under which the auth module keeps the notice's contact, whose day of forgetting a re-examination moves. */
  contactId: string | null;
  /** The signed-in reporter, while the notice's record still names one. */
  reporterId: string | null;
}

type ReexaminedColumns = { id: string; intake_id: string; position: number; target_type: TargetType; target_id: string; named_handle: string | null; suspect: boolean; contact_id: string | null; reporter_id: string | null };
const reexaminedColumns = sql`i.id, i.intake_id, i.position, i.target_type, i.target_id, i.named_handle, i.suspect, n.contact_id, n.reporter_id`;
const reexaminedOf = (row: ReexaminedColumns | undefined): ReexaminedItemRow | null =>
  row
    ? { id: row.id, intakeId: row.intake_id, position: row.position, targetType: row.target_type, targetId: row.target_id, namedHandle: row.named_handle, suspect: row.suspect, contactId: row.contact_id, reporterId: row.reporter_id }
    : null;

/**
 * The newest item at this position of a notice, or null. A re-examination shares its position with the item it examines
 * again, so the newest one is what the status page shows last there, and what a further request is about.
 */
export async function newestItemAt(q: Runner, intakeId: string, position: number): Promise<ReexaminedItemRow | null> {
  return reexaminedOf(
    (
      await rows<ReexaminedColumns>(
        q,
        sql`select ${reexaminedColumns} from intake_items i join intakes n on n.id = i.intake_id
             where i.intake_id = ${intakeId}::uuid and i.position = ${position}::smallint order by i.created_at desc, i.id desc limit 1`,
      )
    )[0],
  );
}

/** The item with this id when it belongs to a report or a notice this account sent and korbat still keeps that link; null otherwise. */
export async function reporterItem(q: Runner, reporterId: string, itemId: string): Promise<ReexaminedItemRow | null> {
  return reexaminedOf((await rows<ReexaminedColumns>(q, sql`select ${reexaminedColumns} from intake_items i join intakes n on n.id = i.intake_id where i.id = ${itemId}::uuid and n.reporter_id = ${reporterId}::uuid`))[0]);
}

/**
 * For a suspect item about a post that quotes another: the item korbat added to the same notice for the quoted post, when
 * that item can be examined again now (a moderator answered it without action, the answer is released, its window is
 * open by the database's clock, and nobody asked yet). Null otherwise. The database's check at commit asks the same of
 * the same rows (intake_items_quote), so a release that lands between this read and the commit is met there.
 */
export async function addedItemOpen(q: Runner, origin: { intakeId: string; targetId: string }): Promise<ReexaminedItemRow | null> {
  return reexaminedOf(
    (
      await rows<ReexaminedColumns>(
        q,
        sql`select ${reexaminedColumns}
              from posts p
              join intake_items i on i.intake_id = ${origin.intakeId}::uuid and i.target_type = 'post' and i.target_id = p.quote_of_id and i.reexamines_item_id is null and i.position > 10
              join intakes n on n.id = i.intake_id
             where p.id = ${origin.targetId}::uuid
               and i.answered_by is not null and i.outcome in ('no_violation', 'not_evident') and i.outcome_sent_at is not null
               and clock_timestamp() < public.appeal_deadline(i.outcome_sent_at)
               and not exists (select 1 from intake_items r where r.reexamines_item_id = i.id)`,
      )
    )[0],
  );
}

/** Where a page of the reporter's list starts: after this notice, by its time (to the microsecond, as text) and id. */
export interface ReportsCursor {
  at: string;
  id: string;
}

/**
 * The reports and notices this account sent, newest first: those whose record still names it. A notice on the path for
 * child sexual abuse material never does, and an account's deletion forgets the link. `sortAt` is the received time to
 * the microsecond, which the next page starts after.
 */
export async function reporterNotices(q: Runner, reporterId: string, after: ReportsCursor | null, limit: number): Promise<(NoticeRow & { sortAt: string })[]> {
  const found = await rows<NoticeColumns & { sort_at: string }>(
    q,
    sql`select ${noticeColumns}, to_char(received_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as sort_at
          from intakes
         where reporter_id = ${reporterId}::uuid
           ${after === null ? sql`` : sql`and (received_at, id) < (${after.at}::timestamptz, ${after.id}::uuid)`}
         order by received_at desc, id desc limit ${limit}::int`,
  );
  return found.flatMap((row) => {
    const notice = noticeOf(row);
    return notice ? [{ ...notice, sortAt: row.sort_at }] : [];
  });
}

/**
 * What a report or a notice said, as far as korbat still holds it: its ground, its category, and its sender's own words,
 * which an erasure of the record nulls. Its sender reads it in their export, and the operator in the draft of an answer
 * to an access request; nobody else's surface is built from it.
 */
export interface NoticeRecord {
  id: string;
  ref: string;
  /** As Date.prototype.toISOString writes it. */
  receivedAt: string;
  csam: boolean;
  allegesIllegal: boolean;
  ruleId: string | null;
  category: string;
  explanation: string | null;
  citedLaw: string | null;
  /** Whether the record was erased: its texts and who sent it are gone. */
  erased: boolean;
}

/**
 * The records of the notices `where` names (a condition on `intakes n`, written by the caller, never input), oldest
 * first. One statement, shared by the export's reports and the access request's draft, so both read the same columns.
 */
export async function noticeRecords(q: Runner, where: ReturnType<typeof sql>): Promise<NoticeRecord[]> {
  const found = await rows<{ id: string; ref: string; received_at: string; csam: boolean; alleges_illegal: boolean; rule_id: string | null; category: string; explanation: string | null; cited_law: string | null; erased: boolean }>(
    q,
    sql`select n.id, n.ref, ${iso("n.received_at")} as received_at, n.csam, n.alleges_illegal, n.rule_id, n.category, n.explanation, n.cited_law, n.erased_at is not null as erased
          from intakes n where ${where} order by n.received_at, n.id`,
  );
  return found.map((row) => ({
    id: row.id,
    ref: row.ref,
    receivedAt: row.received_at,
    csam: row.csam,
    allegesIllegal: row.alleges_illegal,
    ruleId: row.rule_id,
    category: row.category,
    explanation: row.explanation,
    citedLaw: row.cited_law,
    erased: row.erased,
  }));
}

/** What became of a receipt: the delivery states a send can end in. */
export type ReceiptState = "sent" | "folded" | "suppressed" | "no_address" | "failed";

/**
 * Records what became of a notice's receipt, only while it is still pending, so a late answer never overwrites one
 * already recorded: the later writer waits for the first one's commit and then changes nothing. True when this call
 * recorded it.
 */
export async function recordReceipt(q: Runner, intakeId: string, state: ReceiptState): Promise<boolean> {
  const updated = await rows<{ id: string }>(
    q,
    sql`update intakes set receipt = ${state}::delivery_state, receipt_sent_at = case when ${state}::text = 'sent' then now() else receipt_sent_at end
         where id = ${intakeId}::uuid and receipt = 'pending' returning id`,
  );
  return updated.length > 0;
}

/** The open cases in the urgent lane: how many, and since when the oldest of them has waited. One read of the queue's index. */
export async function urgentWaiting(q: Runner): Promise<{ count: number; oldest: Date | null }> {
  const [row] = await rows<{ n: number; oldest: string | null }>(q, sql`select count(*)::int as n, ${iso("min(oldest_open_at)")} as oldest from cases where closed_at is null and lane = 0`);
  return { count: row!.n, oldest: row!.oldest === null ? null : new Date(row!.oldest) };
}

// ---------------------------------------------------------------- evidence

/** The transaction's start to the millisecond, as the snapshots' trigger stamps a snapshot taken in it. */
export async function snapshotTime(tx: DbTx): Promise<string> {
  const [row] = await rows<{ at: string }>(tx, sql`select ${iso("date_trunc('milliseconds', now())")} as at`);
  return row!.at;
}

/**
 * Whether the case holds a snapshot yet, and for an account's case the fields of its newest one. A snapshot's time is its
 * transaction's start to the millisecond, so two snapshots of one case can carry the same time; their ids, which
 * insertSnapshot draws in time order, say which is the newer.
 */
export async function latestSnapshot(tx: DbTx, caseId: string): Promise<{ displayName: string | null; bio: string | null; handle: string | null } | null> {
  const [row] = await rows<{ display_name: string | null; bio: string | null; handle: string | null }>(
    tx,
    sql`select display_name, bio, handle from evidence_snapshots where case_id = ${caseId}::uuid order by taken_at desc, id desc limit 1`,
  );
  return row ? { displayName: row.display_name, bio: row.bio, handle: row.handle } : null;
}

/** A snapshot as the intake stores it: what was copied, with the salt and the digest the server made over all of it. */
export interface SnapshotRow {
  caseId: string;
  targetType: TargetType;
  targetId: string;
  authorHandle: string;
  postState: "visible" | "withheld" | "removed" | "deleted_by_author" | null;
  postCreatedAt: string | null;
  replyToId: string | null;
  quoteOfId: string | null;
  body: string | null;
  media: { id: string; alt: string | null; width: number; height: number }[] | null;
  displayName: string | null;
  bio: string | null;
  handle: string | null;
  salt: string;
  digest: string;
}

/**
 * Stores a snapshot and answers its id with the time the database stamped it, as text to the millisecond. The id is a
 * version 7 uuid, which PostgreSQL draws in time order and never backwards within a session: the newest snapshot of a
 * case is then the one with the latest time and, among those of one millisecond, the greatest id.
 */
export async function insertSnapshot(tx: DbTx, row: SnapshotRow): Promise<{ id: string; takenAt: string }> {
  const [inserted] = await rows<{ id: string; taken_at: string }>(
    tx,
    sql`insert into evidence_snapshots (id, case_id, target_type, target_id, author_handle, post_state, post_created_at, reply_to_id, quote_of_id, body, media, display_name, bio, handle, salt, digest)
        values (uuidv7(), ${row.caseId}::uuid, ${row.targetType}::moderation_target, ${row.targetId}::uuid, ${row.authorHandle}, ${row.postState}::post_state, ${row.postCreatedAt}::timestamptz,
                ${row.replyToId}::uuid, ${row.quoteOfId}::uuid, ${row.body}, ${row.media === null ? null : JSON.stringify(row.media)}::text::jsonb, ${row.displayName}, ${row.bio}, ${row.handle},
                ${row.salt}, ${row.digest})
        returning id, ${iso("taken_at")} as taken_at`,
  );
  return { id: inserted!.id, takenAt: inserted!.taken_at };
}

// ---------------------------------------------------------------- decisions

/** What a case is about, or null when no case has the id. */
export async function caseTarget(q: Runner, caseId: string): Promise<{ type: TargetType; id: string } | null> {
  const [row] = await rows<{ target_type: TargetType; target_id: string }>(q, sql`select target_type, target_id from cases where id = ${caseId}::uuid`);
  return row ? { type: row.target_type, id: row.target_id } : null;
}

/**
 * The decision's row, from the params its staff key confirmed and the account that decided. The id is the API's, so the
 * audit row can name the decision; everything else the row holds is the triggers'.
 */
export async function insertDecision(tx: DbTx, row: { id: string; caseId: string; decidedBy: string; params: CaseDecidedParams }): Promise<void> {
  const p = row.params;
  await tx.execute(
    sql`insert into decisions (id, case_id, kind, reviews_decision_id, seen_state_version, through_seq, outcome, ground, rule_id, rules_version, redress_version, category, category_keyword,
                               snapshot_id, snapshot_digest, facts_digest, reason_digest, legal_reference_digest, decided_by)
        values (${row.id}::uuid, ${row.caseId}::uuid, ${p.kind}::decision_kind, ${p.reviewsDecisionId}::uuid, ${p.stateVersion}::int, ${p.throughSeq}::int, ${p.outcome}::decision_outcome,
                ${p.ground}::decision_ground, ${p.ruleId}, ${p.rulesVersion}::smallint, ${p.redressVersion}::smallint, ${p.category}, ${p.categoryKeyword},
                ${p.snapshotId}::uuid, ${p.snapshotDigest}, ${p.factsDigest}, ${p.reasonDigest}, ${p.legalReferenceDigest}, ${row.decidedBy}::uuid)`,
  );
}

/** One measure or reversal of a decision. Its target, the measure it lifts and whether it changes anything are the triggers'. */
export async function insertAction(tx: DbTx, decisionId: string, action: { kind: ActionKind; mediaId: string | null }): Promise<void> {
  await tx.execute(sql`insert into decision_actions (decision_id, kind, media_id) values (${decisionId}::uuid, ${action.kind}::action_kind, ${action.mediaId}::uuid)`);
}

/**
 * A review's row: the answer to the appeal of the decision it names, from the params the reviewer's key confirmed. Its
 * appeal is the database's to set (the reviewed decision's one pending appeal, under the case's lock), and so is
 * everything else the row holds beyond these columns: a review states no ground of its own.
 */
export async function insertReview(tx: DbTx, row: { id: string; caseId: string; reviewsDecisionId: string; decidedBy: string; params: AppealsReviewedParams }): Promise<void> {
  const p = row.params;
  await tx.execute(
    sql`insert into decisions (id, case_id, kind, reviews_decision_id, seen_state_version, outcome, rules_version, redress_version, category, snapshot_id, snapshot_digest, reason_digest, decided_by)
        values (${row.id}::uuid, ${row.caseId}::uuid, 'review', ${row.reviewsDecisionId}::uuid, ${p.stateVersion}::int, ${p.outcome}::decision_outcome,
                ${p.rulesVersion}::smallint, ${p.redressVersion}::smallint, ${p.category}, ${p.snapshotId}::uuid, ${p.snapshotDigest}, ${p.reasonDigest}, ${row.decidedBy}::uuid)`,
  );
}

/** The decision a review names: its case with the case's target, and its pending appeal, if it has one. Null when no decision has the id. */
export async function reviewedDecision(q: Runner, decisionId: string): Promise<{ caseId: string; target: { type: TargetType; id: string }; pendingAppealId: string | null } | null> {
  const [row] = await rows<{ case_id: string; target_type: TargetType; target_id: string; appeal_id: string | null }>(
    q,
    sql`select d.case_id, c.target_type, c.target_id, (select a.id from appeals a where a.decision_id = d.id and a.answered_by is null) as appeal_id
          from decisions d join cases c on c.id = d.case_id where d.id = ${decisionId}::uuid`,
  );
  return row ? { caseId: row.case_id, target: { type: row.target_type, id: row.target_id }, pendingAppealId: row.appeal_id } : null;
}

/**
 * How many decisions a staff account made in the last `windowMs`, by the database's clock: exact for any window, and
 * unaffected by a restart of the limit store. One read of the index on who decided.
 */
export async function recentDecisionsBy(q: Runner, staffId: string, windowMs: number): Promise<number> {
  const [row] = await rows<{ n: number }>(q, sql`select count(*)::int as n from decisions where decided_by = ${staffId}::uuid and decided_at > now() - make_interval(secs => ${windowMs / 1000}::float8)`);
  return row!.n;
}

/** The audit row of a confirmed action, as public.append_confirmed_audit writes it. */
export interface ConfirmedAuditRow {
  actorId: string;
  keyId: string;
  action: "case_decided" | "appeals_reviewed" | "identity_revealed";
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  staffSession: string;
  actionHash: string;
  stepUp: StaffStoredAssertion;
  requestId: string;
  /** The step-up challenge's expiry: the function refuses a row that joins the chain at or after it. */
  expiresAt: Date;
}

/**
 * Writes a confirmed action's audit row through public.append_confirmed_audit, as the last statement of the action's
 * transaction: the function checks that the acting account and its key are still live, writes the row, and refuses it when
 * the challenge had expired by then, which rolls the whole transaction back. The row holds the chain's head until the
 * commit, so nothing that can wait may run after it. Answers the row's place in the chain.
 */
export async function appendConfirmedAudit(tx: DbTx, row: ConfirmedAuditRow): Promise<number> {
  // The jsonb arguments go as text and are cast, so the driver sends them exactly as serialised here.
  const [written] = await rows<{ place: string }>(
    tx,
    sql`select public.append_confirmed_audit(${row.actorId}::uuid, ${row.keyId}::uuid, ${row.action}::text, ${row.targetType}::text, ${row.targetId}::text,
          ${JSON.stringify(row.metadata)}::text::jsonb, ${row.staffSession}::uuid, ${row.actionHash}::text, ${JSON.stringify(row.stepUp)}::text::jsonb,
          ${row.requestId}::text, ${row.expiresAt.getTime()}::bigint)::text as place`,
  );
  return Number(written!.place);
}

// ---------------------------------------------------------------- the console: recusal, the day's limits and the access log

/** A timestamptz expression as a UTC day. The expression is written here, never input. */
const day = (expression: string) => sql.raw(`to_char(${expression} at time zone 'UTC', 'YYYY-MM-DD')`);

/** Midnight UTC of the database's day: where a staff account's daily counts begin. */
const TODAY = sql`(date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')`;

/**
 * Whether the staff account is too close to the case's subject to open it: the account itself, a personal account the
 * operator linked to it, or one that account follows, blocks, mutes or replied to. The database answers one boolean, and
 * never looks at who reported, so a refused read says nothing about that. False for a case that does not exist.
 */
export async function staffCaseConflict(q: Runner, staffId: string, caseId: string): Promise<boolean> {
  const [row] = await rows<{ conflict: boolean }>(q, sql`select public.staff_case_conflict(${staffId}::uuid, ${caseId}::uuid, false) as conflict`);
  return row!.conflict;
}

/** What one staff account may do in a UTC day. The operator changes the numbers with the command line. */
export interface DailyLimits {
  caseOpens: number;
  findings: number;
  reveals: number;
}

/** The day's limits from the single row the migration wrote; the defaults when the row is missing. */
export async function dailyLimits(q: Runner): Promise<DailyLimits> {
  const [row] = await rows<{ case_opens_per_day: number; findings_per_day: number; reveals_per_day: number }>(q, sql`select case_opens_per_day, findings_per_day, reveals_per_day from moderation_limits where id = 1`);
  return { caseOpens: row?.case_opens_per_day ?? 400, findings: row?.findings_per_day ?? 50, reveals: row?.reveals_per_day ?? 10 };
}

/** How many different cases the staff account has opened since midnight UTC, and whether this case is among them. */
export async function casesOpenedToday(q: Runner, staffId: string, caseId: string): Promise<{ cases: number; thisCase: boolean }> {
  const [row] = await rows<{ n: number; this_case: boolean }>(
    q,
    sql`select count(distinct case_id)::int as n, coalesce(bool_or(case_id = ${caseId}::uuid), false) as this_case
          from case_access_log where staff_id = ${staffId}::uuid and kind = 'case_opened' and at >= ${TODAY}`,
  );
  return { cases: row!.n, thisCase: row!.this_case };
}

/** How many findings the staff account has opened since midnight UTC. */
export async function findingsOpenedToday(q: Runner, staffId: string): Promise<number> {
  const [row] = await rows<{ n: number }>(q, sql`select count(*)::int as n from intakes where finding_by = ${staffId}::uuid and received_at >= ${TODAY}`);
  return row!.n;
}

/** How many sources the staff account has revealed since midnight UTC. */
export async function revealsToday(q: Runner, staffId: string): Promise<number> {
  const [row] = await rows<{ n: number }>(q, sql`select count(*)::int as n from case_access_log where staff_id = ${staffId}::uuid and kind = 'identity_revealed' and at >= ${TODAY}`);
  return row!.n;
}

/** One row of the access log: a case opened, an image viewed, or a source revealed with the text that gives the reason. The database stamps it. */
export async function insertAccess(
  q: Runner,
  row: { staffId: string; caseId: string; kind: "case_opened" | "image_viewed" | "identity_revealed"; mediaId?: string; itemId?: string; textId?: string },
): Promise<Date> {
  const [written] = await rows<{ at: string }>(
    q,
    sql`insert into case_access_log (staff_id, case_id, kind, media_id, intake_item_id, text_id)
        values (${row.staffId}::uuid, ${row.caseId}::uuid, ${row.kind}::access_kind, ${row.mediaId ?? null}::uuid, ${row.itemId ?? null}::uuid, ${row.textId ?? null}::uuid)
        returning ${iso("at")} as at`,
  );
  return new Date(written!.at);
}

/** A profile's public handle, or null when no row has the id: how the console and the staff mails name a staff account. */
export async function handleOf(q: Runner, profileId: string): Promise<string | null> {
  const [row] = await rows<{ handle: string }>(q, sql`select handle from profiles where id = ${profileId}::uuid`);
  return row?.handle ?? null;
}

// ---------------------------------------------------------------- the console: the case

/** A case's own row. */
export interface CaseRow {
  id: string;
  targetType: TargetType;
  targetId: string;
  lane: Lane;
  intakeSeq: number;
  answeredSeq: number;
  stateVersion: number;
  openedAt: string;
  closedAt: string | null;
}

export async function caseById(q: Runner, caseId: string): Promise<CaseRow | null> {
  const [row] = await rows<{ id: string; target_type: TargetType; target_id: string; lane: Lane; intake_seq: number; answered_seq: number; state_version: number; opened_at: string; closed_at: string | null }>(
    q,
    sql`select id, target_type, target_id, lane, intake_seq, answered_seq, state_version, ${iso("opened_at")} as opened_at, ${iso("closed_at")} as closed_at from cases where id = ${caseId}::uuid`,
  );
  if (!row) return null;
  return { id: row.id, targetType: row.target_type, targetId: row.target_id, lane: row.lane, intakeSeq: row.intake_seq, answeredSeq: row.answered_seq, stateVersion: row.state_version, openedAt: row.opened_at, closedAt: row.closed_at };
}

/** A post as it stands, for the case that is about it: read, never written; the rows are the social module's. */
export interface LivePost {
  authorId: string;
  authorHandle: string;
  state: "visible" | "withheld" | "removed" | "deleted_by_author";
  level: "visible" | "withheld" | "removed";
  /** Gate V's answer for the case page: false while the post is frozen, so the console asks for no image. */
  imagesAllowed: boolean;
}

export async function livePost(q: Runner, postId: string): Promise<LivePost | null> {
  const [row] = await rows<{ author_id: string; author_handle: string; state: LivePost["state"]; level: LivePost["level"]; images_allowed: boolean }>(
    q,
    sql`select p.author_id, a.handle as author_handle, p.state, p.moderation_level as level, not public.post_frozen(p.id) as images_allowed
          from posts p join profiles a on a.id = p.author_id where p.id = ${postId}::uuid`,
  );
  return row ? { authorId: row.author_id, authorHandle: row.author_handle, state: row.state, level: row.level, imagesAllowed: row.images_allowed } : null;
}

/** An account's fields as they stand, for the case that is about it. */
export async function liveAccount(q: Runner, accountId: string): Promise<{ handle: string; displayName: string; bio: string; deleted: boolean } | null> {
  const [row] = await rows<{ handle: string; display_name: string; bio: string; deleted: boolean }>(
    q,
    sql`select handle, display_name, bio, deleted_at is not null as deleted from profiles where id = ${accountId}::uuid`,
  );
  return row ? { handle: row.handle, displayName: row.display_name, bio: row.bio, deleted: row.deleted } : null;
}

/** Whether the case is on the path for child sexual abuse material at all (it holds a suspect item or a seal), and whether a suspect item of it is unanswered. */
export async function suspicionOf(q: Runner, caseId: string): Promise<{ holds: boolean; open: boolean }> {
  const [row] = await rows<{ holds: boolean; open: boolean }>(
    q,
    sql`select (exists (select 1 from intake_items i where i.case_id = ${caseId}::uuid and i.suspect)
             or exists (select 1 from decision_actions a join decisions d on d.id = a.decision_id where d.case_id = ${caseId}::uuid and a.kind = 'seal_media')) as holds,
               exists (select 1 from intake_items i where i.case_id = ${caseId}::uuid and i.suspect and i.answered_by is null) as open`,
  );
  return { holds: row!.holds, open: row!.open };
}

/** How often, and when last, an admin answered a report of this kind without a seal. */
export interface EarlierAnswers {
  count: number;
  /** The UTC day of the latest such answer. */
  lastOn: string | null;
}

/**
 * The final decisions of the last `months` months that answered a suspect item without a seal: about this target, and
 * about its author's profile or any of the author's posts. Such a decision is a stored fact (final, taken on a suspicion,
 * holding no seal), so nothing here is computed from which case held which item. Counts and days only.
 */
export async function earlierAnswers(q: Runner, target: { type: TargetType; id: string }, authorId: string | null, months: number): Promise<{ target: EarlierAnswers; author: EarlierAnswers }> {
  const about = sql`(c.target_type = ${target.type}::moderation_target and c.target_id = ${target.id}::uuid)`;
  const ofAuthor =
    authorId === null
      ? about
      : sql`((c.target_type = 'account' and c.target_id = ${authorId}::uuid) or (c.target_type = 'post' and c.target_id in (select p.id from posts p where p.author_id = ${authorId}::uuid)))`;
  const [row] = await rows<{ target_count: number; target_last: string | null; author_count: number; author_last: string | null }>(
    q,
    sql`select (count(*) filter (where ${about}))::int as target_count,
               to_char(max(d.decided_at) filter (where ${about}) at time zone 'UTC', 'YYYY-MM-DD') as target_last,
               count(*)::int as author_count,
               ${day("max(d.decided_at)")} as author_last
          from decisions d join cases c on c.id = d.case_id
         where d.kind = 'final' and d.suspect and d.decided_at >= now() - make_interval(months => ${months}::int)
           and not exists (select 1 from decision_actions a where a.decision_id = d.id and a.kind = 'seal_media')
           and ${ofAuthor}`,
  );
  return { target: { count: row!.target_count, lastOn: row!.target_last }, author: { count: row!.author_count, lastOn: row!.author_last } };
}

/** The UTC day an image of the post was last served to staff by the console's image route, on any case about the post; null when none was. */
export async function imagesOpenedOn(q: Runner, postId: string): Promise<string | null> {
  const [row] = await rows<{ opened_on: string | null }>(
    q,
    sql`select ${day("max(l.at)")} as opened_on from case_access_log l join cases c on c.id = l.case_id
         where l.kind = 'image_viewed' and c.target_type = 'post' and c.target_id = ${postId}::uuid`,
  );
  return row!.opened_on;
}

/** A snapshot as stored, with the database's word on whether its content may be shown. */
export interface SnapshotRead extends Omit<SnapshotRow, "salt"> {
  id: string;
  takenAt: string;
  withheld: boolean;
  erased: boolean;
  /** Null for an erased snapshot, which keeps its digest and loses its salt with its content. */
  salt: string | null;
}

/** The case's snapshots, newest first. `withheld` is the one predicate by which a snapshot's content is withheld wherever it would be shown. */
export async function caseSnapshots(q: Runner, caseId: string, newestOnly = false): Promise<SnapshotRead[]> {
  const found = await rows<{
    id: string;
    taken_at: string;
    withheld: boolean;
    erased: boolean;
    target_type: TargetType;
    target_id: string;
    author_handle: string;
    post_state: SnapshotRow["postState"];
    post_created_at: string | null;
    reply_to_id: string | null;
    quote_of_id: string | null;
    body: string | null;
    media: string | null;
    display_name: string | null;
    bio: string | null;
    handle: string | null;
    salt: string | null;
    digest: string;
  }>(
    q,
    sql`select s.id, ${iso("s.taken_at")} as taken_at, public.snapshot_withheld(s.id) as withheld, s.erased_at is not null as erased, s.target_type, s.target_id, s.author_handle, s.post_state,
               ${iso("s.post_created_at")} as post_created_at, s.reply_to_id, s.quote_of_id, s.body, s.media::text as media, s.display_name, s.bio, s.handle, s.salt, s.digest
          from evidence_snapshots s where s.case_id = ${caseId}::uuid order by s.taken_at desc, s.id desc ${newestOnly ? sql`limit 1` : sql``}`,
  );
  return found.map((row) => ({
    id: row.id,
    takenAt: row.taken_at,
    withheld: row.withheld,
    erased: row.erased,
    caseId,
    targetType: row.target_type,
    targetId: row.target_id,
    authorHandle: row.author_handle,
    postState: row.post_state,
    postCreatedAt: row.post_created_at,
    replyToId: row.reply_to_id,
    quoteOfId: row.quote_of_id,
    body: row.body,
    media: row.media === null ? null : (JSON.parse(row.media) as SnapshotRow["media"]),
    displayName: row.display_name,
    bio: row.bio,
    handle: row.handle,
    salt: row.salt,
    digest: row.digest,
  }));
}

/**
 * Whether a snapshot of the case that still holds its content lists the image. The console's image route asks this of
 * the module's own evidence before it asks the media module for anything: `media` is the list a snapshot of a post
 * copied, each entry with its image's id in the spelling the database writes.
 */
export async function snapshotListsImage(q: Runner, caseId: string, mediaId: string): Promise<boolean> {
  const [row] = await rows<{ listed: boolean }>(
    q,
    sql`select exists (select 1 from evidence_snapshots s
                        where s.case_id = ${caseId}::uuid and s.erased_at is null and s.media @> ${JSON.stringify([{ id: mediaId }])}::text::jsonb) as listed`,
  );
  return row!.listed;
}

/** One item of a case with its intake's ground and texts, as the case page reads it. */
export interface CaseItemRow {
  id: string;
  seq: number;
  position: number;
  createdAt: string;
  lane: Lane;
  targetType: TargetType;
  targetId: string;
  namedHandle: string | null;
  mediaId: string | null;
  suspect: boolean;
  reporterAccountId: string | null;
  outcome: string | null;
  answeredBy: string | null;
  statement: string | null;
  intakeKind: "user" | "finding";
  channel: "signed_in" | "signed_out" | "staff";
  contactId: string | null;
  ruleId: string | null;
  allegesIllegal: boolean;
  csam: boolean;
  category: string;
  categoryKeyword: string | null;
  citedLaw: string | null;
  explanation: string | null;
  erased: boolean;
  reexaminesPosition: number | null;
  reexaminesYourDecision: boolean;
  quotedCaseId: string | null;
}

/**
 * The case's items in the order they attached. For a re-examination: the position of the item it re-examines in its
 * notice, and whether `personId` decided that item. For a suspect item about a post that quotes another: the case of the
 * same notice's item on the quoted post (the one korbat added, or the one the notice named itself).
 */
export async function caseItems(q: Runner, caseId: string, personId: string): Promise<CaseItemRow[]> {
  const found = await rows<{
    id: string;
    seq: number;
    position: number;
    created_at: string;
    lane: Lane;
    target_type: TargetType;
    target_id: string;
    named_handle: string | null;
    media_id: string | null;
    suspect: boolean;
    reporter_account_id: string | null;
    outcome: string | null;
    answered_by: string | null;
    statement: string | null;
    intake_kind: "user" | "finding";
    channel: CaseItemRow["channel"];
    contact_id: string | null;
    rule_id: string | null;
    alleges_illegal: boolean;
    csam: boolean;
    category: string;
    category_keyword: string | null;
    cited_law: string | null;
    explanation: string | null;
    erased: boolean;
    reexamines_position: number | null;
    reexamines_your_decision: boolean;
    quoted_case_id: string | null;
  }>(
    q,
    sql`select i.id, i.seq, i.position, ${iso("i.created_at")} as created_at, i.lane, i.target_type, i.target_id, i.named_handle, i.media_id, i.suspect, i.reporter_account_id,
               i.outcome, i.answered_by, i.statement,
               n.kind as intake_kind, n.channel, n.contact_id, n.rule_id, n.alleges_illegal, n.csam, n.category, n.category_keyword, n.cited_law, n.explanation,
               n.erased_at is not null as erased,
               (select r.position from intake_items r where r.id = i.reexamines_item_id) as reexamines_position,
               coalesce((select d.decided_by = ${personId}::uuid from intake_items r join decisions d on d.id = r.answered_by where r.id = i.reexamines_item_id), false) as reexamines_your_decision,
               case when i.suspect and i.target_type = 'post' then
                 (select a.case_id from posts p join intake_items a on a.intake_id = i.intake_id and a.target_type = 'post' and a.target_id = p.quote_of_id and a.case_id is not null
                   where p.id = i.target_id order by a.created_at desc, a.id limit 1) end as quoted_case_id
          from intake_items i join intakes n on n.id = i.intake_id
         where i.case_id = ${caseId}::uuid order by i.seq`,
  );
  return found.map((row) => ({
    id: row.id,
    seq: row.seq,
    position: row.position,
    createdAt: row.created_at,
    lane: row.lane,
    targetType: row.target_type,
    targetId: row.target_id,
    namedHandle: row.named_handle,
    mediaId: row.media_id,
    suspect: row.suspect,
    reporterAccountId: row.reporter_account_id,
    outcome: row.outcome,
    answeredBy: row.answered_by,
    statement: row.statement,
    intakeKind: row.intake_kind,
    channel: row.channel,
    contactId: row.contact_id,
    ruleId: row.rule_id,
    allegesIllegal: row.alleges_illegal,
    csam: row.csam,
    category: row.category,
    categoryKeyword: row.category_keyword,
    citedLaw: row.cited_law,
    explanation: row.explanation,
    erased: row.erased,
    reexaminesPosition: row.reexamines_position,
    reexaminesYourDecision: row.reexamines_your_decision,
    quotedCaseId: row.quoted_case_id,
  }));
}

/** What a reporter's summary is banded from: when the account was made and four counts over its items that korbat still keeps. */
export interface ReporterFacts {
  createdAt: Date | null;
  filed: number;
  /** Items whose outcome was released, but those answered while nobody could open the images. */
  decided: number;
  actedOn: number;
  /** Released items about a post that a decision answered without action while its images were out of sight. */
  answeredUnseen: number;
}

/**
 * Each reporter's facts, computed on read from the reporter's own rows, never stored. An item is decided once its outcome
 * is released and acted on when that is a restriction, whole or in part. An item that was answered without action while
 * nobody could open the post's images is counted apart and is not among the decided ones.
 */
export async function reporterFacts(q: Runner, reporterIds: readonly string[]): Promise<Map<string, ReporterFacts>> {
  if (reporterIds.length === 0) return new Map();
  const unseen = sql`(x.target_type = 'post' and not x.suspect and x.shown_outcome in ('no_violation', 'not_evident') and coalesce((select d.unseen from decisions d where d.id = x.answered_by), false))`;
  const found = await rows<{ id: string; created_at: string | null; filed: number; decided: number; acted_on: number; unseen: number }>(
    q,
    sql`select r.id, ${iso("p.created_at")} as created_at,
               (select count(*)::int from intake_items x where x.reporter_account_id = r.id) as filed,
               (select count(*)::int from intake_items x where x.reporter_account_id = r.id and x.shown_outcome is not null and not ${unseen}) as decided,
               (select count(*)::int from intake_items x where x.reporter_account_id = r.id and x.shown_outcome in ('restricted_rule', 'restricted_legal', 'partly_reversed')) as acted_on,
               (select count(*)::int from intake_items x where x.reporter_account_id = r.id and x.shown_outcome is not null and ${unseen}) as unseen
          from unnest(${uuids(reporterIds)}) as r(id) left join profiles p on p.id = r.id`,
  );
  return new Map(found.map((row) => [row.id, { createdAt: row.created_at === null ? null : new Date(row.created_at), filed: row.filed, decided: row.decided, actedOn: row.acted_on, answeredUnseen: row.unseen }]));
}

/** A decision of the case with its texts, as the case page reads it; who decided is a handle. */
export interface CaseDecisionRow {
  id: string;
  kind: "interim" | "final" | "review" | "correction";
  outcome: string;
  ground: string | null;
  ruleId: string | null;
  rulesVersion: number;
  redressVersion: number;
  category: string;
  categoryKeyword: string | null;
  source: string;
  decidedAt: string;
  staffHandle: string;
  throughSeq: number;
  answersFromSeq: number | null;
  reviewsDecisionId: string | null;
  snapshotId: string;
  suspect: boolean;
  unseen: boolean;
  needsAdmin: boolean;
  endedInterim: boolean;
  facts: string | null;
  reason: string | null;
  legalReference: string | null;
}

/** The case's decisions, oldest first. A text is read by the digest the decision confirmed; an erased text is null. */
export async function caseDecisions(q: Runner, caseId: string): Promise<CaseDecisionRow[]> {
  const found = await rows<Record<string, unknown>>(
    q,
    sql`select d.id, d.kind, d.outcome, d.ground, d.rule_id, d.rules_version, d.redress_version, d.category, d.category_keyword, d.source, ${iso("d.decided_at")} as decided_at,
               s.handle as staff_handle, d.through_seq, d.answers_from_seq, d.reviews_decision_id, d.snapshot_id, d.suspect, d.unseen, d.needs_admin, d.ended_interim,
               (select t.text from staff_texts t where t.digest = d.facts_digest) as facts,
               (select t.text from staff_texts t where t.digest = d.reason_digest) as reason,
               (select t.text from staff_texts t where t.digest = d.legal_reference_digest) as legal_reference
          from decisions d join profiles s on s.id = d.decided_by
         where d.case_id = ${caseId}::uuid order by d.decided_at, d.id`,
  );
  return found.map((row) => ({
    id: row.id as string,
    kind: row.kind as CaseDecisionRow["kind"],
    outcome: row.outcome as string,
    ground: row.ground as string | null,
    ruleId: row.rule_id as string | null,
    rulesVersion: row.rules_version as number,
    redressVersion: row.redress_version as number,
    category: row.category as string,
    categoryKeyword: row.category_keyword as string | null,
    source: row.source as string,
    decidedAt: row.decided_at as string,
    staffHandle: row.staff_handle as string,
    throughSeq: row.through_seq as number,
    answersFromSeq: row.answers_from_seq as number | null,
    reviewsDecisionId: row.reviews_decision_id as string | null,
    snapshotId: row.snapshot_id as string,
    suspect: row.suspect as boolean,
    unseen: row.unseen as boolean,
    needsAdmin: row.needs_admin as boolean,
    endedInterim: row.ended_interim as boolean,
    facts: row.facts as string | null,
    reason: row.reason as string | null,
    legalReference: row.legal_reference as string | null,
  }));
}

/** One ledger row of a decision of the case: whether it is in force by the view's one definition, and the decision whose reversal lifted it. */
export interface CaseActionRow {
  id: string;
  decisionId: string;
  kind: ActionKind;
  mediaId: string | null;
  noEffect: "already" | "deleted" | null;
  reversesActionId: string | null;
  inForce: boolean;
  liftedBy: string | null;
}

export async function caseActions(q: Runner, caseId: string): Promise<CaseActionRow[]> {
  const found = await rows<{ id: string; decision_id: string; kind: ActionKind; media_id: string | null; no_effect: CaseActionRow["noEffect"]; reverses_action_id: string | null; in_force: boolean; lifted_by: string | null }>(
    q,
    sql`select a.id, a.decision_id, a.kind, a.media_id, a.no_effect, a.reverses_action_id,
               exists (select 1 from measures_in_force m where m.id = a.id) as in_force,
               (select r.decision_id from decision_actions r where r.reverses_action_id = a.id) as lifted_by
          from decision_actions a join decisions d on d.id = a.decision_id
         where d.case_id = ${caseId}::uuid order by a.kind::text, a.media_id`,
  );
  return found.map((row) => ({ id: row.id, decisionId: row.decision_id, kind: row.kind, mediaId: row.media_id, noEffect: row.no_effect, reversesActionId: row.reverses_action_id, inForce: row.in_force, liftedBy: row.lifted_by }));
}

/** What a seal covers, from the list the database wrote when it was recorded: counts, and at most `max` rows of the list, oldest post first. */
export async function sealCovers(q: Runner, actionId: string, max: number): Promise<{ posts: number; images: number; deletedPosts: number; list: { postId: string; createdAt: string; images: number }[] }> {
  const [counts] = await rows<{ posts: number; images: number; deleted_posts: number }>(
    q,
    sql`select count(*)::int as posts, coalesce(sum(s.images), 0)::int as images, (count(*) filter (where p.state = 'deleted_by_author'))::int as deleted_posts
          from seal_posts s left join posts p on p.id = s.post_id where s.action_id = ${actionId}::uuid`,
  );
  const list = await rows<{ post_id: string; created_at: string; images: number }>(
    q,
    sql`select s.post_id, ${iso("p.created_at")} as created_at, s.images from seal_posts s join posts p on p.id = s.post_id
         where s.action_id = ${actionId}::uuid order by p.created_at, s.post_id limit ${max}::int`,
  );
  return { posts: counts!.posts, images: counts!.images, deletedPosts: counts!.deleted_posts, list: list.map((row) => ({ postId: row.post_id, createdAt: row.created_at, images: row.images })) };
}

// ---------------------------------------------------------------- appeals

/** A staff account as the review marks ask about it: its id, and whether its role is admin. */
export interface Reviewer {
  id: string;
  admin: boolean;
}

/**
 * Whether this person may review the pending appeal `a` of decision `d` (3c design, section 7.7): they made none of the
 * case's decisions and opened no finding in it, which is the rule the database refuses a review by; the database's
 * recusal check over the case's subject and everyone who reported in it finds nothing; and they are an admin where the
 * review needs one. The answer is one boolean, and says nothing of which of these it turned on.
 */
const mayReview = (person: Reviewer) => sql`(a.answered_by is null
    and not exists (select 1 from decisions x where x.case_id = d.case_id and x.decided_by = ${person.id}::uuid)
    and not exists (select 1 from intake_items i join intakes n on n.id = i.intake_id where i.case_id = d.case_id and n.finding_by = ${person.id}::uuid)
    and not public.staff_case_conflict(${person.id}::uuid, d.case_id, true)
    and (${person.admin}::boolean or not public.review_needs_admin(d.id)))`;

export type ReviewerStateRow = "available" | "none_single_staff" | "none_eligible";
type AppealResult = "kept" | "partly_reversed" | "reversed";

/** An appeal of a decision of a case, as the case page reads it. */
export interface CaseAppealRow {
  id: string;
  decisionId: string;
  filedAt: string;
  statement: string | null;
  answeredAt: string | null;
  result: AppealResult | null;
  answeredBy: string | null;
  /** Whether anyone may review it now; null once it is answered. */
  reviewer: ReviewerStateRow | null;
  needsAdmin: boolean;
  mayReview: boolean;
}

/**
 * The appeals of the case's decisions, oldest first; a statement is null when there was none or it was erased. Each
 * carries the database's two answers about its review and whether the reading person may review it.
 */
export async function caseAppeals(q: Runner, caseId: string, person: Reviewer): Promise<CaseAppealRow[]> {
  const found = await rows<{ id: string; decision_id: string; filed_at: string; statement: string | null; answered_at: string | null; result: AppealResult | null; answered_by: string | null; reviewer: ReviewerStateRow | null; needs_admin: boolean; may_review: boolean }>(
    q,
    sql`select a.id, a.decision_id, ${iso("a.filed_at")} as filed_at, a.statement, ${iso("a.answered_at")} as answered_at, a.result, a.answered_by,
               public.appeal_reviewer_state(a.id) as reviewer, public.review_needs_admin(d.id) as needs_admin, ${mayReview(person)} as may_review
          from appeals a join decisions d on d.id = a.decision_id where d.case_id = ${caseId}::uuid order by a.filed_at, a.id`,
  );
  return found.map((row) => ({
    id: row.id,
    decisionId: row.decision_id,
    filedAt: row.filed_at,
    statement: row.statement,
    answeredAt: row.answered_at,
    result: row.result,
    answeredBy: row.answered_by,
    reviewer: row.reviewer,
    needsAdmin: row.needs_admin,
    mayReview: row.may_review,
  }));
}

/** A pending appeal as the console's list shows it: never its statement. */
export interface PendingAppealRow {
  id: string;
  caseId: string;
  decisionId: string;
  filedAt: string;
  /** When it was filed, to the microsecond, as text: what the next page starts after. */
  sortAt: string;
  decidedAt: string;
  deadline: string;
  ruleId: string | null;
  legal: boolean;
  actions: ActionKind[];
  reviewer: ReviewerStateRow;
  needsAdmin: boolean;
  mayReview: boolean;
}

/**
 * The pending appeals, newest first, after the cursor when one is given: each with its case, the decision it appeals and
 * the three marks of its review. The list reads no statement, so nobody reads what an appellant wrote without opening
 * the case, whose read is logged and counted.
 */
export async function pendingAppeals(q: Runner, person: Reviewer, after: { at: string; id: string } | null, limit: number): Promise<PendingAppealRow[]> {
  const found = await rows<Record<string, unknown>>(
    q,
    sql`select a.id, d.case_id, a.decision_id, ${iso("a.filed_at")} as filed_at,
               to_char(a.filed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as sort_at,
               ${iso("d.decided_at")} as decided_at, ${iso("public.appeal_deadline(d.informed_at)")} as deadline,
               d.rule_id, d.ground is not distinct from 'illegal' as legal,
               coalesce((select array_agg(x.kind::text order by x.kind, x.media_id) from decision_actions x where x.decision_id = d.id), '{}') as actions,
               public.appeal_reviewer_state(a.id) as reviewer, public.review_needs_admin(d.id) as needs_admin, ${mayReview(person)} as may_review
          from appeals a join decisions d on d.id = a.decision_id
         where a.answered_by is null
           ${after === null ? sql`` : sql`and (a.filed_at, a.id) < (${after.at}::timestamptz, ${after.id}::uuid)`}
         order by a.filed_at desc, a.id desc limit ${limit}::int`,
  );
  return found.map((row) => ({
    id: row.id as string,
    caseId: row.case_id as string,
    decisionId: row.decision_id as string,
    filedAt: row.filed_at as string,
    sortAt: row.sort_at as string,
    decidedAt: row.decided_at as string,
    deadline: row.deadline as string,
    ruleId: row.rule_id as string | null,
    legal: row.legal as boolean,
    actions: row.actions as ActionKind[],
    reviewer: row.reviewer as ReviewerStateRow,
    needsAdmin: row.needs_admin as boolean,
    mayReview: row.may_review as boolean,
  }));
}

/**
 * The appeal's row. The trigger decides whether an appeal of this decision is open now, under the case's lock, and
 * stamps the row; the statement, when there is one, comes with the salt and the digest the server made. Answers its id.
 */
export async function insertAppeal(tx: DbTx, row: { decisionId: string; appellantId: string; statement: SaltedText | null }): Promise<string> {
  const [inserted] = await rows<{ id: string }>(
    tx,
    sql`insert into appeals (decision_id, appellant_account_id, statement, statement_salt, statement_digest)
        values (${row.decisionId}::uuid, ${row.appellantId}::uuid, ${row.statement?.text ?? null}, ${row.statement?.salt ?? null}, ${row.statement?.digest ?? null})
        returning id`,
  );
  return inserted!.id;
}

/** The case's notes and its recorded choices not to seal, oldest first, each with its writer's handle. Erased ones are gone with their text. */
export async function caseStaffTexts(q: Runner, caseId: string): Promise<{ id: string; kind: "note" | "seal_declined"; staffHandle: string; createdAt: string; text: string }[]> {
  const found = await rows<{ id: string; kind: "note" | "seal_declined"; staff_handle: string; created_at: string; text: string }>(
    q,
    sql`select t.id, t.kind, p.handle as staff_handle, ${iso("t.created_at")} as created_at, t.text
          from staff_texts t join profiles p on p.id = t.author_id
         where t.case_id = ${caseId}::uuid and t.kind in ('note', 'seal_declined') and t.erased_at is null order by t.created_at, t.id`,
  );
  return found.map((row) => ({ id: row.id, kind: row.kind, staffHandle: row.staff_handle, createdAt: row.created_at, text: row.text }));
}

/** A saved text that no decision or reveal has named yet, with its salt. */
export interface DraftRow {
  id: string;
  kind: string;
  text: string;
  salt: string;
  digest: string;
  createdAt: string;
}

/** The staff account's own drafts on the case: unconfirmed, unerased, and of a kind that waits for a decision or a reveal. */
export async function ownDrafts(q: Runner, caseId: string, authorId: string): Promise<DraftRow[]> {
  const found = await rows<{ id: string; kind: string; text: string; salt: string; digest: string; created_at: string }>(
    q,
    sql`select id, kind, text, salt, digest, ${iso("created_at")} as created_at from staff_texts
         where case_id = ${caseId}::uuid and author_id = ${authorId}::uuid and confirmed_at is null and erased_at is null and kind not in ('note', 'seal_declined')
         order by created_at, id`,
  );
  return found.map((row) => ({ id: row.id, kind: row.kind, text: row.text, salt: row.salt, digest: row.digest, createdAt: row.created_at }));
}

/** One event of a case's history, from the view that is its one definition; a staff account is its handle. */
export interface HistoryRow {
  at: string;
  event: string;
  refId: string | null;
  seq: number | null;
  intakeKind: string | null;
  ruleId: string | null;
  allegesIllegal: boolean | null;
  csam: boolean | null;
  reexamination: boolean | null;
  decisionKind: string | null;
  outcome: string | null;
  staffHandle: string | null;
  result: string | null;
}

export async function caseHistory(q: Runner, caseId: string): Promise<HistoryRow[]> {
  const found = await rows<Record<string, unknown>>(
    q,
    sql`select ${iso("h.at")} as at, h.event, h.ref_id, h.seq, h.intake_kind, h.rule_id, h.alleges_illegal, h.csam, h.reexamination, h.decision_kind, h.outcome, p.handle as staff_handle, h.result
          from case_history h left join profiles p on p.id = h.staff_id
         where h.case_id = ${caseId}::uuid order by h.at, h.event, h.ref_id`,
  );
  return found.map((row) => ({
    at: row.at as string,
    event: row.event as string,
    refId: row.ref_id as string | null,
    seq: row.seq as number | null,
    intakeKind: row.intake_kind as string | null,
    ruleId: row.rule_id as string | null,
    allegesIllegal: row.alleges_illegal as boolean | null,
    csam: row.csam as boolean | null,
    reexamination: row.reexamination as boolean | null,
    decisionKind: row.decision_kind as string | null,
    outcome: row.outcome as string | null,
    staffHandle: row.staff_handle as string | null,
    result: row.result as string | null,
  }));
}

// ---------------------------------------------------------------- the console: saved texts

/** Everything someone else wrote on the case that a staff text must not quote: explanations, cited laws, re-examination statements and appeal statements. */
export async function theirTexts(q: Runner, caseId: string): Promise<string[]> {
  const found = await rows<{ text: string }>(
    q,
    sql`select n.explanation as text from intakes n where n.explanation is not null and exists (select 1 from intake_items i where i.intake_id = n.id and i.case_id = ${caseId}::uuid)
        union all
        select n.cited_law from intakes n where n.cited_law is not null and exists (select 1 from intake_items i where i.intake_id = n.id and i.case_id = ${caseId}::uuid)
        union all
        select i.statement from intake_items i where i.case_id = ${caseId}::uuid and i.statement is not null
        union all
        select a.statement from appeals a join decisions d on d.id = a.decision_id where d.case_id = ${caseId}::uuid and a.statement is not null`,
  );
  return found.map((row) => row.text);
}

/** Stores a staff text; the trigger stamps it and leaves it unconfirmed, and the table's CHECK holds text, salt and digest together. Answers its id. */
export async function insertStaffText(q: Runner, row: { caseId: string; authorId: string; kind: string; text: string; salt: string; digest: string }): Promise<string> {
  const [inserted] = await rows<{ id: string }>(
    q,
    sql`insert into staff_texts (case_id, author_id, kind, text, salt, digest)
        values (${row.caseId}::uuid, ${row.authorId}::uuid, ${row.kind}::staff_text_kind, ${row.text}, ${row.salt}, ${row.digest}) returning id`,
  );
  return inserted!.id;
}

/** The staff account's own draft with this digest on this case and of this kind, or null: what a repeated save answers. */
export async function ownDraftByDigest(q: Runner, row: { caseId: string; authorId: string; kind: string; digest: string }): Promise<string | null> {
  const [found] = await rows<{ id: string }>(
    q,
    sql`select id from staff_texts where digest = ${row.digest} and case_id = ${row.caseId}::uuid and author_id = ${row.authorId}::uuid and kind = ${row.kind}::staff_text_kind
           and confirmed_at is null and erased_at is null`,
  );
  return found?.id ?? null;
}

// ---------------------------------------------------------------- the console: revealing a source

/** An item with what decides whether its source can be revealed: its case, its intake's path and what links it to a person. */
export interface RevealItemRow {
  caseId: string | null;
  intakeKind: "user" | "finding";
  channel: "signed_in" | "signed_out" | "staff";
  csam: boolean;
  reporterAccountId: string | null;
  contactId: string | null;
}

export async function revealItem(q: Runner, itemId: string): Promise<RevealItemRow | null> {
  const [row] = await rows<{ case_id: string | null; intake_kind: "user" | "finding"; channel: RevealItemRow["channel"]; csam: boolean; reporter_account_id: string | null; contact_id: string | null }>(
    q,
    sql`select i.case_id, n.kind as intake_kind, n.channel, n.csam, i.reporter_account_id, n.contact_id from intake_items i join intakes n on n.id = i.intake_id where i.id = ${itemId}::uuid`,
  );
  return row ? { caseId: row.case_id, intakeKind: row.intake_kind, channel: row.channel, csam: row.csam, reporterAccountId: row.reporter_account_id, contactId: row.contact_id } : null;
}

/** The staff account's saved reason for a reveal on this case, by its digest: unerased, unconfirmed, and named by no access row yet. Its id, or null. */
export async function revealReason(q: Runner, row: { caseId: string; authorId: string; digest: string }): Promise<string | null> {
  const [found] = await rows<{ id: string }>(
    q,
    sql`select t.id from staff_texts t
         where t.digest = ${row.digest} and t.case_id = ${row.caseId}::uuid and t.author_id = ${row.authorId}::uuid and t.kind = 'reveal_reason'
           and t.confirmed_at is null and t.erased_at is null
           and not exists (select 1 from case_access_log l where l.text_id = t.id)`,
  );
  return found?.id ?? null;
}

/** The handle of the reporter the item is still linked to, or null when the link is gone. Read only after a reveal's commit. */
export async function reporterHandle(q: Runner, itemId: string): Promise<string | null> {
  const [row] = await rows<{ handle: string }>(q, sql`select p.handle from intake_items i join profiles p on p.id = i.reporter_account_id where i.id = ${itemId}::uuid`);
  return row?.handle ?? null;
}

// ---------------------------------------------------------------- the console: the queue

/** A row of the queue with its sort key: the lane, whether it is deferred, the oldest unanswered item's time to the microsecond, and the id. */
export interface QueueRead {
  id: string;
  lane: Lane;
  targetType: TargetType;
  openedAt: string;
  oldestOpenAt: string;
  /** The same time as the database holds it, to the microsecond: the cursor's. */
  sortAt: string;
  openItems: number;
  rules: string[];
  categories: string[];
  allegesIllegal: boolean;
  suspect: boolean;
  reexamination: boolean;
  deferred: boolean;
}

/** The place after which a page of the queue begins: the last row's sort key. */
export interface QueueCursor {
  lane: number;
  deferred: boolean;
  sortAt: string;
  id: string;
}

/**
 * Open cases in the queue's order: by lane, then (only with the emergency switch on) the deferred ones last within their
 * lane, then by the oldest unanswered item, then by id. A case is deferred when every unanswered item of it comes from an
 * unproven source: in lanes 1 and 2 a signed-out intake or an account under 48 hours old, in lane 0 a signed-out intake
 * only, so a new account reporting a threat against itself is never deferred. Nothing else orders the queue: no count of
 * reports and no standing of a reporter. `limit` rows after `after`.
 */
export async function queueRows(q: Runner, options: { deferUnproven: boolean; after: QueueCursor | null; limit: number }): Promise<QueueRead[]> {
  const after = options.after;
  const found = await rows<{
    id: string;
    lane: Lane;
    target_type: TargetType;
    opened_at: string;
    oldest_open_at: string;
    sort_at: string;
    open_items: number;
    rules: string;
    categories: string;
    alleges_illegal: boolean;
    suspect: boolean;
    reexamination: boolean;
    deferred: boolean;
  }>(
    q,
    sql`with open_cases as (
          select c.id, c.lane, c.target_type, c.opened_at, coalesce(c.oldest_open_at, c.opened_at) as oldest_open_at, u.open_items, u.rules, u.categories, u.alleges_illegal, u.suspect, u.reexamination,
                 (${options.deferUnproven}::boolean and u.unproven) as deferred
            from cases c
           cross join lateral (
             select count(*)::int as open_items,
                    coalesce(string_agg(distinct n.rule_id, ',' order by n.rule_id), '') as rules,
                    coalesce(string_agg(distinct n.category, ',' order by n.category), '') as categories,
                    coalesce(bool_or(i.alleges_illegal), false) as alleges_illegal,
                    coalesce(bool_or(i.suspect), false) as suspect,
                    coalesce(bool_or(i.reexamines_item_id is not null), false) as reexamination,
                    coalesce(bool_and(n.channel = 'signed_out'
                                      or (c.lane > 0 and exists (select 1 from profiles r where r.id = i.reporter_account_id and r.created_at > now() - interval '48 hours'))), false) as unproven
               from intake_items i join intakes n on n.id = i.intake_id
              where i.case_id = c.id and i.answered_by is null) u
           where c.closed_at is null)
        select o.id, o.lane, o.target_type, ${iso("o.opened_at")} as opened_at, ${iso("o.oldest_open_at")} as oldest_open_at,
               to_char(o.oldest_open_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as sort_at,
               o.open_items, o.rules, o.categories, o.alleges_illegal, o.suspect, o.reexamination, o.deferred
          from open_cases o
         where ${after === null ? sql`true` : sql`(o.lane, o.deferred, o.oldest_open_at, o.id) > (${after.lane}::smallint, ${after.deferred}::boolean, ${after.sortAt}::timestamptz, ${after.id}::uuid)`}
         order by o.lane, o.deferred, o.oldest_open_at, o.id
         limit ${options.limit}::int`,
  );
  const list = (joined: string) => (joined === "" ? [] : joined.split(","));
  return found.map((row) => ({
    id: row.id,
    lane: row.lane,
    targetType: row.target_type,
    openedAt: row.opened_at,
    oldestOpenAt: row.oldest_open_at,
    sortAt: row.sort_at,
    openItems: row.open_items,
    rules: list(row.rules),
    categories: list(row.categories),
    allegesIllegal: row.alleges_illegal,
    suspect: row.suspect,
    reexamination: row.reexamination,
    deferred: row.deferred,
  }));
}

// ---------------------------------------------------------------- the console: the overview

/** Per lane, the open cases and since when the oldest unanswered item of the lane waits. A lane without an open case has no row. */
export async function openByLane(q: Runner): Promise<{ lane: Lane; open: number; oldestAt: string | null }[]> {
  const found = await rows<{ lane: Lane; open: number; oldest: string | null }>(q, sql`select lane, count(*)::int as open, ${iso("min(oldest_open_at)")} as oldest from cases where closed_at is null group by lane`);
  return found.map((row) => ({ lane: row.lane, open: row.open, oldestAt: row.oldest }));
}

/**
 * The pending appeals as the home screen counts them: how many wait, how many of them this person may review, and how
 * many no staff account may review now (the database's appeal_reviewer_state is not `available`).
 */
export async function appealCounts(q: Runner, person: Reviewer): Promise<{ waiting: number; mayReview: number; withoutReviewer: number }> {
  const [row] = await rows<{ waiting: number; may_review: number; without_reviewer: number }>(
    q,
    sql`select count(*)::int as waiting,
               (count(*) filter (where ${mayReview(person)}))::int as may_review,
               (count(*) filter (where public.appeal_reviewer_state(a.id) is distinct from 'available'))::int as without_reviewer
          from appeals a join decisions d on d.id = a.decision_id where a.answered_by is null`,
  );
  return { waiting: row!.waiting, mayReview: row!.may_review, withoutReviewer: row!.without_reviewer };
}

/** The reveals of the last 30 days, newest first, at most `max`, with how many there are in all: time, staff handle and case. */
export async function recentReveals(q: Runner, max: number): Promise<{ total: number; items: { at: string; handle: string; caseId: string }[] }> {
  const found = await rows<{ at: string; handle: string; case_id: string; total: number }>(
    q,
    sql`select ${iso("l.at")} as at, p.handle, l.case_id, (count(*) over ())::int as total
          from case_access_log l join profiles p on p.id = l.staff_id
         where l.kind = 'identity_revealed' and l.at >= now() - interval '30 days'
         order by l.at desc, l.id desc limit ${max}::int`,
  );
  return { total: found[0]?.total ?? 0, items: found.map((row) => ({ at: row.at, handle: row.handle, caseId: row.case_id })) };
}

/** Per staff handle, the images viewed and the findings opened since midnight UTC. */
export async function staffToday(q: Runner): Promise<{ images: { handle: string; count: number }[]; findings: { handle: string; count: number }[] }> {
  const images = await rows<{ handle: string; count: number }>(
    q,
    sql`select p.handle, count(*)::int as count from case_access_log l join profiles p on p.id = l.staff_id where l.kind = 'image_viewed' and l.at >= ${TODAY} group by p.handle order by p.handle`,
  );
  const findings = await rows<{ handle: string; count: number }>(
    q,
    sql`select p.handle, count(*)::int as count from intakes n join profiles p on p.id = n.finding_by where n.kind = 'finding' and n.received_at >= ${TODAY} group by p.handle order by p.handle`,
  );
  return { images: images.map((row) => ({ handle: row.handle, count: row.count })), findings: findings.map((row) => ({ handle: row.handle, count: row.count })) };
}

/** The three kinds of mail by what they wait for, and the decided items the daily release has not released. Counts only. */
export interface MailCounts {
  receipts: number;
  authorMails: number;
  outcomes: number;
}

/**
 * Mails pending for more than an hour, counted from when each became due (an intake's receipt, a decision's time, an
 * outcome's release); mails recorded failed whose give-up time (`giveUpDays` after that same moment) falls in the last 30
 * days; and the items with an outcome that the daily release has not released 26 hours after their decision, or whose
 * changed outcome has waited that long. The release takes about a day at most, so any of the last means it is not
 * finishing.
 */
export async function mailAndReleaseCounts(q: Runner, giveUpDays: number): Promise<{ waiting: MailCounts; failed: MailCounts; releaseOverdue: number }> {
  const gaveUp = (at: string) => sql.raw(`${at} + make_interval(days => ${Number(giveUpDays)}) >= now() - interval '30 days'`);
  const [row] = await rows<Record<string, number>>(
    q,
    sql`select
          (select count(*)::int from intakes where receipt = 'pending' and received_at < now() - interval '1 hour') as receipts_waiting,
          (select count(*)::int from decisions where author_mail = 'pending' and decided_at < now() - interval '1 hour') as author_waiting,
          (select count(*)::int from intake_items where outcome_mail = 'pending' and coalesce(revised_sent_at, outcome_sent_at) < now() - interval '1 hour') as outcomes_waiting,
          (select count(*)::int from intakes where receipt = 'failed' and ${gaveUp("received_at")}) as receipts_failed,
          (select count(*)::int from decisions where author_mail = 'failed' and ${gaveUp("decided_at")}) as author_failed,
          (select count(*)::int from intake_items where outcome_mail = 'failed' and ${gaveUp("coalesce(revised_sent_at, outcome_sent_at)")}) as outcomes_failed,
          (select count(*)::int from intake_items i
            where i.outcome is not null and i.outcome_sent_at is null
              and coalesce((select d.decided_at from decisions d where d.id = i.answered_by), i.created_at) < now() - interval '26 hours')
          + (select count(*)::int from intake_items i where i.revision_pending_at < now() - interval '26 hours') as release_overdue`,
  );
  return {
    waiting: { receipts: row!.receipts_waiting!, authorMails: row!.author_waiting!, outcomes: row!.outcomes_waiting! },
    failed: { receipts: row!.receipts_failed!, authorMails: row!.author_failed!, outcomes: row!.outcomes_failed! },
    releaseOverdue: row!.release_overdue!,
  };
}

/** The decisions of the last 30 days that lifted the protection of reported images: each lifted seal, and each final answer to a suspect item without a seal. Newest first, at most `max`, with their total. */
export async function recentProtectionLifted(q: Runner, max: number): Promise<{ total: number; items: { at: string; handle: string; caseId: string; kind: "unsealed" | "dismissed" }[] }> {
  const found = await rows<{ at: string; handle: string; case_id: string; kind: "unsealed" | "dismissed"; total: number }>(
    q,
    sql`select ${iso("d.decided_at")} as at, p.handle, d.case_id, (count(*) over ())::int as total,
               case when exists (select 1 from decision_actions a where a.decision_id = d.id and a.kind = 'unseal_media') then 'unsealed' else 'dismissed' end as kind
          from decisions d join profiles p on p.id = d.decided_by
         where d.decided_at >= now() - interval '30 days'
           and (exists (select 1 from decision_actions a where a.decision_id = d.id and a.kind = 'unseal_media')
                or (d.kind = 'final' and d.suspect and not exists (select 1 from decision_actions a where a.decision_id = d.id and a.kind = 'seal_media')))
         order by d.decided_at desc, d.id desc limit ${max}::int`,
  );
  return { total: found[0]?.total ?? 0, items: found.map((row) => ({ at: row.at, handle: row.handle, caseId: row.case_id, kind: row.kind })) };
}

/** The recorded choices not to seal of the last 30 days, newest first, at most `max`, with their total: time, staff handle and case, never the reason. */
export async function recentSealsDeclined(q: Runner, max: number): Promise<{ total: number; items: { at: string; handle: string; caseId: string }[] }> {
  const found = await rows<{ at: string; handle: string; case_id: string; total: number }>(
    q,
    sql`select ${iso("t.created_at")} as at, p.handle, t.case_id, (count(*) over ())::int as total
          from staff_texts t join profiles p on p.id = t.author_id
         where t.kind = 'seal_declined' and t.created_at >= now() - interval '30 days'
         order by t.created_at desc, t.id desc limit ${max}::int`,
  );
  return { total: found[0]?.total ?? 0, items: found.map((row) => ({ at: row.at, handle: row.handle, caseId: row.case_id })) };
}

/** The seals taken while deciding that are in force, by the view's one definition, newest first: who took each, on which case, and what its list covers. */
export async function interimSealsInForce(q: Runner, max: number): Promise<{ total: number; items: { at: string; handle: string; caseId: string; posts: number; images: number }[] }> {
  const found = await rows<{ at: string; handle: string; case_id: string; posts: number; images: number; total: number }>(
    q,
    sql`select ${iso("d.decided_at")} as at, p.handle, m.case_id, (count(*) over ())::int as total,
               (select count(*)::int from seal_posts s where s.action_id = m.id) as posts,
               (select coalesce(sum(s.images), 0)::int from seal_posts s where s.action_id = m.id) as images
          from measures_in_force m join decisions d on d.id = m.decision_id join profiles p on p.id = d.decided_by
         where m.kind = 'seal_media' and m.decision_kind = 'interim'
         order by d.decided_at desc, m.id desc limit ${max}::int`,
  );
  return { total: found[0]?.total ?? 0, items: found.map((row) => ({ at: row.at, handle: row.handle, caseId: row.case_id, posts: row.posts, images: row.images })) };
}

// ---------------------------------------------------------------- the statement of reasons

/** A decision as its statement is rendered from it, with what the mail and the staff alerts need beside it. */
export interface StatementDecisionRow {
  id: string;
  caseId: string;
  kind: "interim" | "final" | "review" | "correction";
  outcome: string;
  ground: string | null;
  ruleId: string | null;
  rulesVersion: number;
  redressVersion: number;
  source: string;
  decidedAt: string;
  suspect: boolean;
  authorMail: string;
  decidedBy: string;
  facts: string | null;
  reason: string | null;
  legalReference: string | null;
  targetType: TargetType;
  targetId: string;
  /** The post's creation time, which survives its deletion; null for an account case. */
  postCreatedAt: string | null;
  /** The account the decision is about: the post's author, or the account itself. */
  subjectId: string | null;
  /** The decision a review or a correction is about. */
  reviewed: { kind: "interim" | "final"; ground: string | null; ruleId: string | null; rulesVersion: number; legalReference: string | null; decidedAt: string } | null;
}

export async function statementDecision(q: Runner, decisionId: string): Promise<StatementDecisionRow | null> {
  const [row] = await rows<Record<string, unknown>>(
    q,
    sql`select d.id, d.case_id, d.kind, d.outcome, d.ground, d.rule_id, d.rules_version, d.redress_version, d.source, ${iso("d.decided_at")} as decided_at, d.suspect, d.author_mail, d.decided_by,
               (select t.text from staff_texts t where t.digest = d.facts_digest) as facts,
               (select t.text from staff_texts t where t.digest = d.reason_digest) as reason,
               (select t.text from staff_texts t where t.digest = d.legal_reference_digest) as legal_reference,
               c.target_type, c.target_id,
               (select ${iso("p.created_at")} from posts p where c.target_type = 'post' and p.id = c.target_id) as post_created_at,
               case when c.target_type = 'post' then (select p.author_id from posts p where p.id = c.target_id) else c.target_id end as subject_id,
               r.kind as reviewed_kind, r.ground as reviewed_ground, r.rule_id as reviewed_rule, r.rules_version as reviewed_rules_version, ${iso("r.decided_at")} as reviewed_at,
               (select t.text from staff_texts t where t.digest = r.legal_reference_digest) as reviewed_legal
          from decisions d join cases c on c.id = d.case_id left join decisions r on r.id = d.reviews_decision_id
         where d.id = ${decisionId}::uuid`,
  );
  if (!row) return null;
  return {
    id: row.id as string,
    caseId: row.case_id as string,
    kind: row.kind as StatementDecisionRow["kind"],
    outcome: row.outcome as string,
    ground: row.ground as string | null,
    ruleId: row.rule_id as string | null,
    rulesVersion: row.rules_version as number,
    redressVersion: row.redress_version as number,
    source: row.source as string,
    decidedAt: row.decided_at as string,
    suspect: row.suspect as boolean,
    authorMail: row.author_mail as string,
    decidedBy: row.decided_by as string,
    facts: row.facts as string | null,
    reason: row.reason as string | null,
    legalReference: row.legal_reference as string | null,
    targetType: row.target_type as TargetType,
    targetId: row.target_id as string,
    postCreatedAt: row.post_created_at as string | null,
    subjectId: row.subject_id as string | null,
    reviewed:
      row.reviewed_kind === null
        ? null
        : { kind: row.reviewed_kind as "interim" | "final", ground: row.reviewed_ground as string | null, ruleId: row.reviewed_rule as string | null, rulesVersion: row.reviewed_rules_version as number, legalReference: row.reviewed_legal as string | null, decidedAt: row.reviewed_at as string },
  };
}

/** One ledger row of a decision as its statement tells of it: for a reversal the measure it lifts, for a seal what its list held. */
export interface StatementActionRow {
  kind: ActionKind;
  mediaId: string | null;
  noEffect: "already" | "deleted" | null;
  /** For a reversal: the decision that holds the lifted measure, its rule, whether that measure changed anything, and whether korbat still kept that decision's snapshot when this one was made. */
  lifted: { decisionId: string; ruleId: string | null; noEffect: string | null; snapshotKept: boolean } | null;
  sealedPosts: number;
  sealedImages: number;
  /** The seal's images on posts their author had deleted by the time it was recorded: nothing later is read. */
  sealedDeletedImages: number;
}

/** A decision's measures and reversals, in the ledger's order of kinds. */
export async function statementActions(q: Runner, decisionId: string): Promise<StatementActionRow[]> {
  const found = await rows<Record<string, unknown>>(
    q,
    sql`select a.kind, a.media_id, a.no_effect, l.decision_id as lifted_decision, ld.rule_id as lifted_rule, l.no_effect as lifted_no_effect,
               (ls.erased_at is null or ls.erased_at > d.decided_at) as lifted_snapshot_kept,
               (select count(*)::int from seal_posts s where s.action_id = a.id) as sealed_posts,
               (select coalesce(sum(s.images), 0)::int from seal_posts s where s.action_id = a.id) as sealed_images,
               (select coalesce(sum(s.images), 0)::int from seal_posts s join posts p on p.id = s.post_id
                 where s.action_id = a.id and p.state = 'deleted_by_author' and p.deleted_at <= a.created_at) as sealed_deleted
          from decision_actions a join decisions d on d.id = a.decision_id
          left join decision_actions l on l.id = a.reverses_action_id
          left join decisions ld on ld.id = l.decision_id
          left join evidence_snapshots ls on ls.id = ld.snapshot_id
         where a.decision_id = ${decisionId}::uuid order by a.kind, a.media_id`,
  );
  return found.map((row) => ({
    kind: row.kind as ActionKind,
    mediaId: row.media_id as string | null,
    noEffect: row.no_effect as StatementActionRow["noEffect"],
    lifted: row.lifted_decision === null ? null : { decisionId: row.lifted_decision as string, ruleId: row.lifted_rule as string | null, noEffect: row.lifted_no_effect as string | null, snapshotKept: row.lifted_snapshot_kept as boolean },
    sealedPosts: row.sealed_posts as number,
    sealedImages: row.sealed_images as number,
    sealedDeletedImages: row.sealed_deleted as number,
  }));
}

/** A measure taken while deciding that ended with a final decision, without a reversal. */
export interface EndedMeasureRow {
  kind: ActionKind;
  mediaId: string | null;
  decisionId: string;
  ruleId: string | null;
  noEffect: string | null;
  snapshotKept: boolean;
}

/**
 * The measures taken while deciding that ended with this final decision, of those their author was told of: every one
 * that was still in force when the decision closed its case, and a seal taken while deciding whose suspect items the
 * decision answered, unless the decision itself seals (the images then stay sealed). It reads only what stood when the
 * decision was made: a reversal recorded later, or an item that arrived later, changes nothing here.
 */
export async function endedMeasures(q: Runner, decisionId: string): Promise<EndedMeasureRow[]> {
  const found = await rows<Record<string, unknown>>(
    q,
    sql`select a.kind, a.media_id, i.id as decision_id, i.rule_id, a.no_effect, (s.erased_at is null or s.erased_at > d.decided_at) as snapshot_kept
          from decisions d
          join cases c on c.id = d.case_id
          join decisions i on i.case_id = d.case_id and i.kind = 'interim' and i.decided_at < d.decided_at and i.author_mail <> 'none'
          join decision_actions a on a.decision_id = i.id
          join evidence_snapshots s on s.id = i.snapshot_id
         where d.id = ${decisionId}::uuid and d.kind = 'final'
           and a.kind in ('withhold', 'seal_media', 'withhold_media', 'reset_display_name', 'reset_bio')
           and not exists (select 1 from decision_actions r where r.reverses_action_id = a.id and r.created_at <= d.decided_at)
           and case when a.kind = 'seal_media'
                 then exists (select 1 from intake_items x where x.case_id = d.case_id and x.suspect and x.answered_by = d.id and x.created_at <= i.decided_at)
                      and not exists (select 1 from decision_actions own where own.decision_id = d.id and own.kind = 'seal_media')
                 else c.closed_at = d.decided_at end
         order by i.decided_at, a.kind, a.media_id`,
  );
  return found.map((row) => ({ kind: row.kind as ActionKind, mediaId: row.media_id as string | null, decisionId: row.decision_id as string, ruleId: row.rule_id as string | null, noEffect: row.no_effect as string | null, snapshotKept: row.snapshot_kept as boolean }));
}

/** What became of a mail korbat owed: the delivery states a send can end in. */
export type MailState = "sent" | "suppressed" | "no_address" | "failed";

/**
 * Records what became of a decision's statement mail, only while it is still pending, so a late answer never overwrites
 * one already recorded. True when this call recorded it.
 */
export async function recordAuthorMail(q: Runner, decisionId: string, state: MailState): Promise<boolean> {
  const updated = await rows<{ id: string }>(
    q,
    sql`update decisions set author_mail = ${state}::delivery_state, author_mail_at = case when ${state}::text = 'sent' then now() else author_mail_at end
         where id = ${decisionId}::uuid and author_mail = 'pending' returning id`,
  );
  return updated.length > 0;
}

// ---------------------------------------------------------------- the dispatch job

/** A time as a timestamptz parameter. */
const at = (time: Date) => sql`${time.toISOString()}::timestamptz`;

/** The notices whose receipt is still pending and that were received before `before`, oldest first, at most `limit`. */
export async function pendingReceipts(q: Runner, before: Date, limit: number): Promise<string[]> {
  return (await rows<{ id: string }>(q, sql`select id from intakes where receipt = 'pending' and received_at < ${at(before)} order by received_at, id limit ${limit}::int`)).map((row) => row.id);
}

/** The decisions whose statement mail is still pending and that were decided before `before`, oldest first. The decision caps bound how many there can be. */
export async function pendingAuthorMails(q: Runner, before: Date): Promise<string[]> {
  return (await rows<{ id: string }>(q, sql`select id from decisions where author_mail = 'pending' and decided_at < ${at(before)} order by decided_at, id`)).map((row) => row.id);
}

/**
 * The daily release, through the database's one function for it: every item answered before the cut-off is released with
 * its outcome as of the cut-off, and every released item whose outcome a review or a correction changed before it gets
 * its new outcome. The function refuses a cut-off in the database's future; a cut-off its clock has not reached yet (the
 * API's clock running ahead of it) is therefore taken as now. Answers how many items it changed.
 */
export async function releaseOutcomes(q: Runner, cutoff: Date): Promise<number> {
  const [row] = await rows<{ n: number }>(q, sql`select public.release_outcomes(least(${at(cutoff)}, now())) as n`);
  return row!.n;
}

/**
 * The contacts whose notice is still owed something: an item unanswered (a re-examination included), an item's outcome
 * mail pending or a changed outcome waiting for its release, or its receipt pending or folded. A line or a receipt that
 * was given up is owed nothing more.
 */
export async function contactsOwed(q: Runner): Promise<string[]> {
  const found = await rows<{ contact_id: string }>(
    q,
    sql`select distinct n.contact_id from intakes n
         where n.contact_id is not null
           and (n.receipt in ('pending', 'folded')
                or exists (select 1 from intake_items i where i.intake_id = n.id and (i.outcome is null or i.outcome_mail = 'pending' or i.revision_pending_at is not null)))`,
  );
  return found.map((row) => row.contact_id);
}

/** One released item whose outcome mail is pending, with what its line's words follow from. */
export interface OutcomeLineRow {
  id: string;
  intakeId: string;
  ref: string;
  contactId: string | null;
  reporterId: string | null;
  position: number;
  targetType: TargetType;
  targetId: string;
  namedHandle: string | null;
  hasCase: boolean;
  suspect: boolean;
  shownOutcome: string;
  changed: boolean;
  reexamines: boolean;
  /** A decision answered it: a link that named nothing was answered without one. */
  byDecision: boolean;
  reexamined: boolean;
  ruleId: string | null;
  rulesVersion: number | null;
  decisionUnseen: boolean;
  /** The answering decision holds a seal. */
  sealed: boolean;
  /** Every measure of the answering decision changed nothing when it was imposed. */
  noEffect: boolean;
  /** For an item about a post: the post quotes another. */
  quotes: boolean;
}

/** Every released item whose outcome mail is still pending, whichever round released it, by notice and position. */
export async function pendingOutcomeLines(q: Runner): Promise<OutcomeLineRow[]> {
  const found = await rows<Record<string, unknown>>(
    q,
    sql`select i.id, i.intake_id, n.ref, n.contact_id, i.reporter_account_id, i.position, i.target_type, i.target_id, i.named_handle, i.case_id is not null as has_case, i.suspect,
               i.shown_outcome, i.revised_sent_at is not null as changed, i.reexamines_item_id is not null as reexamines, i.answered_by is not null as by_decision,
               exists (select 1 from intake_items r where r.reexamines_item_id = i.id) as reexamined,
               d.rule_id, d.rules_version, coalesce(d.unseen, false) as decision_unseen,
               exists (select 1 from decision_actions a where a.decision_id = i.answered_by and a.kind = 'seal_media') as sealed,
               ${answerChangedNothing} as no_effect,
               coalesce((select p.quote_of_id is not null from posts p where i.target_type = 'post' and p.id = i.target_id), false) as quotes
          from intake_items i join intakes n on n.id = i.intake_id left join decisions d on d.id = i.answered_by
         where i.outcome_sent_at is not null and i.outcome_mail = 'pending' and i.shown_outcome is not null
         order by n.received_at, n.id, i.position, i.created_at, i.id`,
  );
  return found.map((row) => ({
    id: row.id as string,
    intakeId: row.intake_id as string,
    ref: row.ref as string,
    contactId: row.contact_id as string | null,
    reporterId: row.reporter_account_id as string | null,
    position: row.position as number,
    targetType: row.target_type as TargetType,
    targetId: row.target_id as string,
    namedHandle: row.named_handle as string | null,
    hasCase: row.has_case as boolean,
    suspect: row.suspect as boolean,
    shownOutcome: row.shown_outcome as string,
    changed: row.changed as boolean,
    reexamines: row.reexamines as boolean,
    byDecision: row.by_decision as boolean,
    reexamined: row.reexamined as boolean,
    ruleId: row.rule_id as string | null,
    rulesVersion: row.rules_version as number | null,
    decisionUnseen: row.decision_unseen as boolean,
    sealed: row.sealed as boolean,
    noEffect: row.no_effect as boolean,
    quotes: row.quotes as boolean,
  }));
}

/** The notices of signed-out notifiers whose receipt the 24-hour cap folded: each rides in its address's next update. */
export async function foldedReceipts(q: Runner): Promise<NoticeRow[]> {
  const found = await rows<NoticeColumns>(q, sql`select ${noticeColumns} from intakes where receipt = 'folded' and contact_id is not null order by received_at, id`);
  return found.flatMap((row) => noticeOf(row) ?? []);
}

/** Records what became of these items' outcome mails, only where one is still pending. */
export async function recordOutcomeMails(q: Runner, itemIds: readonly string[], state: MailState): Promise<void> {
  if (itemIds.length === 0) return;
  await q.execute(sql`update intake_items set outcome_mail = ${state}::delivery_state where id = any(${uuids(itemIds)}) and outcome_mail = 'pending'`);
}

/** Records what became of a receipt that rode in an update, only while it is still pending or folded. */
export async function recordCarriedReceipt(q: Runner, intakeId: string, state: MailState): Promise<void> {
  await q.execute(
    sql`update intakes set receipt = ${state}::delivery_state, receipt_sent_at = case when ${state}::text = 'sent' then now() else receipt_sent_at end
         where id = ${intakeId}::uuid and receipt in ('pending', 'folded')`,
  );
}

/** The receipts and the statement mails still unsent `days` days after they were due, recorded as given up; answers their ids. */
export async function giveUpReceiptsAndAuthorMails(q: Runner, now: Date, days: number): Promise<{ receipts: string[]; authorMails: string[] }> {
  const due = sql`${at(now)} - make_interval(days => ${days}::int)`;
  const receipts = await rows<{ id: string }>(q, sql`update intakes set receipt = 'failed' where receipt in ('pending', 'folded') and received_at < ${due} returning id`);
  const authorMails = await rows<{ id: string }>(q, sql`update decisions set author_mail = 'failed' where author_mail = 'pending' and decided_at < ${due} returning id`);
  return { receipts: receipts.map((row) => row.id), authorMails: authorMails.map((row) => row.id) };
}

/** The outcome lines still unsent `days` days after their release, or after the release of their changed outcome, recorded as given up; answers their ids. */
export async function giveUpOutcomeMails(q: Runner, now: Date, days: number): Promise<string[]> {
  const found = await rows<{ id: string }>(
    q,
    sql`update intake_items set outcome_mail = 'failed'
         where outcome_mail = 'pending' and coalesce(revised_sent_at, outcome_sent_at) < ${at(now)} - make_interval(days => ${days}::int) returning id`,
  );
  return found.map((row) => row.id);
}

/** An unanswered item in the urgent lane that has waited long enough to be alerted about again, with what decides whether it still calls for someone. */
export interface UrgentItemRow {
  caseId: string;
  targetType: TargetType;
  targetId: string;
  suspect: boolean;
  /** When the item arrived, in epoch milliseconds. */
  arrivedMs: number;
  /** Whether a decision taken while deciding, a note, or a recorded choice not to seal came after the item arrived. */
  interimAfter: boolean;
  noteAfter: boolean;
  declinedAfter: boolean;
  /** When the newest recorded choice not to seal of the case was saved, in epoch milliseconds, to the millisecond. */
  newestDeclinedMs: number | null;
  /** A post case's post is not visible: withheld, removed, or deleted by its author. */
  postHidden: boolean;
}

/**
 * The unanswered items of open cases in the urgent lane that arrived before `before`. "After the item arrived" compares
 * the item's time with the decision's or the text's, as the view of measures in force does: no later than.
 */
export async function urgentItems(q: Runner, before: Date): Promise<UrgentItemRow[]> {
  const after = (kind: string) => sql.raw(`exists (select 1 from staff_texts t where t.case_id = c.id and t.kind = '${kind}' and t.created_at >= i.created_at)`);
  const found = await rows<Record<string, unknown>>(
    q,
    sql`select c.id as case_id, c.target_type, c.target_id, i.suspect,
               floor(extract(epoch from i.created_at) * 1000)::float8 as arrived_ms,
               exists (select 1 from decisions d where d.case_id = c.id and d.kind = 'interim' and d.decided_at >= i.created_at) as interim_after,
               ${after("note")} as note_after, ${after("seal_declined")} as declined_after,
               (select floor(extract(epoch from max(t.created_at)) * 1000)::float8 from staff_texts t where t.case_id = c.id and t.kind = 'seal_declined') as newest_declined_ms,
               coalesce((select p.state <> 'visible' from posts p where c.target_type = 'post' and p.id = c.target_id), false) as post_hidden
          from intake_items i join cases c on c.id = i.case_id
         where c.closed_at is null and i.lane = 0 and i.outcome is null and i.created_at < ${at(before)}
         order by c.id, i.seq`,
  );
  return found.map((row) => ({
    caseId: row.case_id as string,
    targetType: row.target_type as TargetType,
    targetId: row.target_id as string,
    suspect: row.suspect as boolean,
    arrivedMs: Number(row.arrived_ms),
    interimAfter: row.interim_after as boolean,
    noteAfter: row.note_after as boolean,
    declinedAfter: row.declined_after as boolean,
    newestDeclinedMs: row.newest_declined_ms === null ? null : Number(row.newest_declined_ms),
    postHidden: row.post_hidden as boolean,
  }));
}

/**
 * The cases past their lane's response time (24 hours in lanes 0 and 1, seven days in lane 2, counted from the oldest
 * unanswered item), per lane with the oldest one's time, and the open cases that have held a measure taken while
 * deciding for more than 24 hours, whatever their lane.
 */
export async function waitingCases(q: Runner, now: Date): Promise<{ lanes: { lane: Lane; count: number; oldest: Date }[]; interim: number }> {
  const found = await rows<{ lane: Lane; n: number; oldest: string }>(
    q,
    sql`select lane, count(*)::int as n, ${iso("min(oldest_open_at)")} as oldest from cases
         where closed_at is null and oldest_open_at < ${at(now)} - case when lane = 2 then interval '7 days' else interval '24 hours' end
         group by lane order by lane`,
  );
  const [held] = await rows<{ n: number }>(
    q,
    sql`select count(distinct m.case_id)::int as n from measures_in_force m join decisions d on d.id = m.decision_id join cases c on c.id = m.case_id
         where m.decision_kind = 'interim' and c.closed_at is null and d.decided_at < ${at(now)} - interval '24 hours'`,
  );
  return { lanes: found.map((row) => ({ lane: row.lane, count: row.n, oldest: new Date(row.oldest) })), interim: held!.n };
}

// ---------------------------------------------------------------- retention

/**
 * The SQL of the retention job and of the overview's late erasures (3c design, sections 6.4, 7.3 and 7.9). Every time is
 * the database's own: each erase function checks its due rule against the database's now(), so the job asks with the same
 * clock, and one clock decides what is due. The periods are the contracts' RETENTION, handed over as numbers.
 *
 * The candidates are read from the partial indexes that hold only what is left to erase, so a round's work follows what
 * is left, never every case ever closed. The freeze is read here only to keep a case that holds nothing but snapshots of
 * a frozen post out of the candidates: for every snapshot the one function that erases one decides.
 */

/** The cases that hold a row erase_case_evidence would change: an unerased snapshot that is not of a frozen post, an unerased note or draft, an appeal statement, or an unreleased hold. */
const CANDIDATE_CASES = sql`
  select s.case_id from evidence_snapshots s where s.erased_at is null and not (s.target_type = 'post' and public.post_frozen(s.target_id))
  union select t.case_id from staff_texts t where t.confirmed_at is null and t.erased_at is null
  union select d.case_id from appeals a join decisions d on d.id = a.decision_id where a.statement is not null
  union select h.case_id from media_holds h where h.released_at is null`;

/** A final decision citing R4 that is not redacted yet and one of whose R4 measures is in force, as `d`. */
const REDACTABLE = sql`d.kind = 'final' and d.rule_id = 'R4' and d.redacted_at is null
  and exists (select 1 from measures_in_force m where m.decision_id = d.id and m.kind in ('remove', 'remove_media', 'reset_bio', 'reset_display_name'))`;

/** A decision one of whose statement texts is unerased, as `d`, joined to the profile `p` of its case's subject. */
const STATEMENT_HELD = sql`from decisions d
  join cases c on c.id = d.case_id
  join profiles p on p.id = case when c.target_type = 'account' then c.target_id else (select x.author_id from posts x where x.id = c.target_id) end
  where exists (select 1 from staff_texts t where t.digest in (d.facts_digest, d.reason_digest, d.legal_reference_digest) and t.erased_at is null)`;

/** The candidate cases whose evidence is due now, in id order. */
export async function dueCases(q: Runner): Promise<string[]> {
  const found = await rows<{ id: string }>(q, sql`select k.case_id as id from (${CANDIDATE_CASES}) k where public.case_evidence_due_at(k.case_id) <= now() order by 1`);
  return found.map((row) => row.id);
}

/** The unerased intakes whose record is due now. None is due before `days` days after it was received, which the index is read by. */
export async function dueIntakes(q: Runner, days: number): Promise<string[]> {
  const found = await rows<{ id: string }>(
    q,
    sql`select n.id from intakes n where n.erased_at is null and n.received_at <= now() - make_interval(days => ${days}::int) and public.intake_due_at(n.id) <= now() order by n.received_at, n.id`,
  );
  return found.map((row) => row.id);
}

/** The R4 decisions that are final for their author and not redacted yet. The redaction itself answers false for one whose post is frozen. */
export async function dueRedactions(q: Runner): Promise<string[]> {
  const found = await rows<{ id: string }>(q, sql`select d.id from decisions d where ${REDACTABLE} and public.decision_final_at(d.id) <= now() order by d.decided_at, d.id`);
  return found.map((row) => row.id);
}

/** The decisions that still hold a statement text and whose subject's profile was deleted at least `months` months ago. */
export async function dueStatements(q: Runner, months: number): Promise<string[]> {
  const found = await rows<{ id: string }>(q, sql`select d.id ${STATEMENT_HELD} and p.deleted_at <= now() - make_interval(months => ${months}::int) order by d.decided_at, d.id`);
  return found.map((row) => row.id);
}

const changedBy = async (q: Runner, call: ReturnType<typeof sql>): Promise<number> => (await rows<{ n: number }>(q, sql`select ${call} as n`))[0]!.n;

/** Deletes the drafts nobody confirmed that are older than `hours` hours; never a note, a recorded choice not to seal or a confirmed text. */
export const sweepStaffTexts = (q: Runner, hours: number) => changedBy(q, sql`public.sweep_staff_texts(now() - make_interval(hours => ${hours}::int))`);
/** Erases a due case's snapshots (never one of a frozen post), notes, drafts and appeal statements, and releases its holds. */
export const eraseCaseEvidence = (q: Runner, caseId: string) => changedBy(q, sql`public.erase_case_evidence(${caseId}::uuid)`);
/** Erases a due intake's record: its explanation, its cited law, who sent it and its re-examinations' statements. */
export const eraseIntake = (q: Runner, intakeId: string) => changedBy(q, sql`public.erase_intake(${intakeId}::uuid)`);
/** Erases the statement texts of a decision whose subject's account has been deleted for 12 months. */
export const eraseStatementTexts = (q: Runner, decisionId: string) => changedBy(q, sql`public.erase_statement_texts(${decisionId}::uuid)`);
/** Deletes the access rows older than `months` months, erasing first the reveal reasons they name. */
export const deleteAccessLog = (q: Runner, months: number) => changedBy(q, sql`public.delete_access_log(now() - make_interval(months => ${months}::int))`);
/** Forgets that a deleted account sent its reports; 0 for an account whose auth row is not marked deleted. */
export const forgetReporter = (q: Runner, accountId: string) => changedBy(q, sql`public.forget_reporter(${accountId}::uuid)`);

/** Makes an R4 restriction's erasure final; false when it changed nothing (its post is frozen, or another round was faster). */
export async function redactR4(q: Runner, decisionId: string): Promise<boolean> {
  return (await rows<{ done: boolean }>(q, sql`select public.redact_r4_body(${decisionId}::uuid) as done`))[0]!.done;
}

/** The overview's late erasures that this module's tables answer: what each step should have changed more than a day ago. */
export interface LateErasures {
  caseEvidence: number;
  intakeRecords: number;
  statements: number;
  redactions: number;
  drafts: number;
  accessLog: number;
}

/**
 * How much each due rule is late by more than a day. A case that holds only snapshots of a frozen post is no candidate
 * and never counted, and a redaction whose post is frozen would change nothing now, so it is not counted either: both
 * wait for an admin's answer, not for the job.
 */
export async function lateErasures(q: Runner, periods: { intakeDays: number; statementMonths: number; draftHours: number; accessLogMonths: number }): Promise<LateErasures> {
  const [row] = await rows<{ case_evidence: number; intake_records: number; statements: number; redactions: number; drafts: number; access_log: number }>(
    q,
    sql`select
      (select count(*)::int from (${CANDIDATE_CASES}) k where public.case_evidence_due_at(k.case_id) < now() - interval '1 day') as case_evidence,
      (select count(*)::int from intakes n
        where n.erased_at is null and n.received_at <= now() - make_interval(days => ${periods.intakeDays}::int) and public.intake_due_at(n.id) < now() - interval '1 day') as intake_records,
      (select count(*)::int ${STATEMENT_HELD} and p.deleted_at < now() - make_interval(months => ${periods.statementMonths}::int) - interval '1 day') as statements,
      (select count(*)::int from decisions d join cases c on c.id = d.case_id
        where ${REDACTABLE} and public.decision_final_at(d.id) < now() - interval '1 day'
          and not (c.target_type = 'post' and public.post_frozen(c.target_id))) as redactions,
      (select count(*)::int from staff_texts t
        where t.kind not in ('note', 'seal_declined') and t.confirmed_at is null and t.created_at < now() - make_interval(hours => ${periods.draftHours}::int) - interval '1 day') as drafts,
      (select count(*)::int from case_access_log l where l.at < now() - make_interval(months => ${periods.accessLogMonths}::int) - interval '1 day') as access_log`,
  );
  return { caseEvidence: row!.case_evidence, intakeRecords: row!.intake_records, statements: row!.statements, redactions: row!.redactions, drafts: row!.drafts, accessLog: row!.access_log };
}
```

### Replace `apps/api/src/moderation/reports.ts` (whole file)

```ts
import { sql } from "drizzle-orm";
import { REPORTS_PAGE_SIZE, itemOutcomeWords, type ExportFormat, type NoticeItemStatus, type ReportRow, type ReportsPage, type RuleId, type TdbCategory } from "@korbat/contracts";
import { decodeListCursor, encodeListCursor } from "./author";
import type { ModerationDeps } from "./context";
import { itemStatus, listedItems } from "./intake";
import { noticeItemsOf, noticeRecords, reporterNotices, type ReportsCursor } from "./repo";

/**
 * The reporter's list (3c design, section 7.6): the reports and notices an account sent, while korbat keeps their
 * records, each item exactly as the status page gives it (the same function builds both) and with its id, so the list,
 * the page and the mail tell the same at the same time and in the same words. A report on the path for child sexual abuse material is
 * stored without its sender and is therefore in nobody's list: whoever sent it follows it with the link they were shown.
 */

/** GET /api/moderation/reports: the viewer's own reports and notices, newest first, 20 a page, with whether korbat's report mails to the account are stopped. */
export async function reporterList(deps: Pick<ModerationDeps, "apiDb" | "auth" | "social" | "config">, viewer: string, cursor?: string): Promise<ReportsPage> {
  const after = cursor === undefined ? null : decodeListCursor(cursor);
  const found = await reporterNotices(deps.apiDb, viewer, after, REPORTS_PAGE_SIZE + 1);
  const page = found.slice(0, REPORTS_PAGE_SIZE);
  const items = await noticeItemsOf(deps.apiDb, page.map((notice) => notice.id));
  const reports: ReportRow[] = [];
  for (const notice of page) {
    const rows: ReportRow["items"] = [];
    // Each item as the status page gives it, and its id, by which its sender asks for a re-examination.
    for (const item of listedItems(items.get(notice.id) ?? [])) rows.push({ ...(await itemStatus(deps, item)), id: item.id });
    reports.push({ ref: notice.ref, receivedAt: notice.receivedAt, items: rows });
  }
  const last = page.at(-1);
  return {
    reports,
    // One row more than the page was read: only then is there a next page.
    nextCursor: found.length > REPORTS_PAGE_SIZE && last ? encodeListCursor({ at: last.sortAt, id: last.id }) : null,
    // The account's address is the auth module's alone: it answers whether that address stopped korbat's report mails.
    reportMailStopped: await deps.auth.accountReportMailStopped(viewer),
  };
}

// ---------------------------------------------------------------- the export's reports

/** A report or a notice as its sender's export lists it. */
export type ExportedReport = ExportFormat["moderation"]["reports"][number];

/** How many reports the export reads at a time, each page with its items and its records in a statement each. */
const EXPORT_PAGE_SIZE = 100;

/**
 * One item of a report as the export writes it (3c design, section 7.11), from the item exactly as the list and the
 * status page give it: its place, its link, and whether it is a re-examination. Its outcome, the outcome's words as the
 * list reads them and whether a re-examination is open are written only once the daily release has shown the outcome;
 * until then all three are null, so an export tells no more, and no sooner, than the list and the mail do.
 */
export function exportedItem(status: NoticeItemStatus): ExportedReport["items"][number] {
  const released = status.outcome !== null;
  return {
    position: status.position,
    link: status.link,
    reexamines: status.reexamines,
    outcome: status.outcome,
    outcomeText: itemOutcomeWords(status),
    // Open while the one request can still be made; false for an outcome that cannot be examined again at all.
    reexaminationOpen: released ? (status.reexamination?.open ?? false) : null,
  };
}

/**
 * The export's `reports` (ModerationForAccount.exportFor): the reports and notices the account sent, while korbat keeps
 * their records, newest first as its list shows them. The notices and their items come from the list's own reads and each
 * item from the status page's own function, so the export, the list, the page and the mail tell the same; the ground, the
 * category and the sender's own explanation come from the record's read. A report on the path for child sexual abuse
 * material is stored without its sender and is in nobody's export, and a record that was erased names no sender any more.
 */
export async function exportedReports(deps: Pick<ModerationDeps, "apiDb" | "social" | "config">, accountId: string): Promise<ExportedReport[]> {
  const exported: ExportedReport[] = [];
  let after: ReportsCursor | null = null;
  for (;;) {
    const page: Awaited<ReturnType<typeof reporterNotices>> = await reporterNotices(deps.apiDb, accountId, after, EXPORT_PAGE_SIZE);
    const ids = page.map((notice) => notice.id);
    const items = await noticeItemsOf(deps.apiDb, ids);
    // What each of them said, by its id; asked again for the same sender, so a record erased since the list was read is left out.
    const found = ids.length === 0 ? [] : await noticeRecords(deps.apiDb, sql`n.id = any(${`{${ids.join(",")}}`}::uuid[]) and n.reporter_id = ${accountId}::uuid`);
    const records = new Map(found.map((record) => [record.id, record]));
    for (const notice of page) {
      const record = records.get(notice.id);
      if (!record) continue;
      const rows: ExportedReport["items"] = [];
      for (const item of listedItems(items.get(notice.id) ?? [])) rows.push(exportedItem(await itemStatus(deps, item)));
      exported.push({
        ref: notice.ref,
        receivedAt: notice.receivedAt,
        // A sender's own report is never on the path for child sexual abuse material, which records none.
        ground: record.allegesIllegal ? "illegal" : "rule",
        ruleId: record.ruleId as RuleId | null,
        category: record.category as TdbCategory,
        explanation: record.explanation,
        items: rows,
      });
    }
    const last = page.at(-1);
    // A page that is not full is the last one.
    if (page.length < EXPORT_PAGE_SIZE || !last) return exported;
    after = { at: last.sortAt, id: last.id };
  }
}

/**
 * POST /api/moderation/report-mail/resume: lifts a stop of korbat's report mails to the account's address. The session
 * proves the address, which the account's sign-in code confirmed. It answers the same whether or not there was a stop.
 */
export async function resumeReportMail(deps: Pick<ModerationDeps, "auth">, viewer: string): Promise<void> {
  await deps.auth.resumeAccountReportMail(viewer);
}
```

### Replace `apps/app/src/app/terms.tsx` (whole file)

```tsx
import { ScrollView, Text, View } from "react-native";

import { TextLink } from "@/components/ui";
import { CONTACT_EMAIL, reportHref } from "@/lib/moderation";
import { CONTACT_WORDS } from "@/lib/moderation-words";
import { TERMS_SECTIONS, TERMS_VERSION, termsParagraphs } from "@/lib/terms";

export default function Terms() {
  return (
    <ScrollView className="flex-1 bg-zinc-950" contentContainerClassName="items-center px-6 py-10">
      <View className="w-full max-w-xl">
        <Text accessibilityRole="header" className="text-3xl font-bold tracking-tight text-zinc-50">
          korbat terms
        </Text>
        <Text className="mt-2 text-sm text-zinc-400">Version {TERMS_VERSION}</Text>
        {TERMS_SECTIONS.map((section) => (
          <View key={section.title} className="mt-8">
            <Text accessibilityRole="header" aria-level={2} className="text-lg font-semibold text-zinc-100">
              {section.title}
            </Text>
            {/* A long section is several paragraphs; each is an element of its own, so a reader gets them apart. */}
            {termsParagraphs(section.body).map((paragraph, index) => (
              <Text key={index} className="mt-2 text-base leading-7 text-zinc-300">
                {paragraph}
              </Text>
            ))}
          </View>
        ))}
        {/* Not one of the terms' sections: the users' contact address is the build's (3c design, section 9). */}
        <View className="mt-8">
          <Text accessibilityRole="header" aria-level={2} className="text-lg font-semibold text-zinc-100">
            {CONTACT_WORDS.title}
          </Text>
          <Text className="mt-2 text-base leading-7 text-zinc-300">{CONTACT_WORDS.body(CONTACT_EMAIL)}</Text>
        </View>
        {/* The report form needs no account and no item to start from. */}
        <TextLink label={CONTACT_WORDS.report} href={reportHref()} />
        <TextLink label="Back to korbat" href="/" replace />
      </View>
    </ScrollView>
  );
}
```

### Replace `apps/app/src/lib/terms.ts` (whole file)

```ts
import {
  APPEAL_MONTHS,
  CSAM_NOTICE_MAX_ACCOUNTS,
  DAILY_LIMITS,
  ITEM_OUTCOMES,
  MEASURES,
  MEASURE_KINDS,
  NOTICE_LIMITS,
  OUTCOME_PHRASES,
  RETENTION,
  REVERSAL_KINDS,
  SUSPECT_EARLIER_MONTHS,
  SUSPECT_OUTCOME_PHRASES,
  UNSEEN_NO_ACTION,
  type ItemOutcome,
  type MeasureKind,
} from "@korbat/contracts";
import { RULES, RULES_VERSION } from "@korbat/rules";
import { numberWord } from "./moderation-words";

/**
 * The terms shown at sign-up. TERMS_VERSION must equal the API's TERMS_VERSION setting; change both
 * together whenever the text changes, so every account records which version it accepted.
 */
export const TERMS_VERSION = "draft-2026-09";

/**
 * The moderation sections (3c design, section 9) state each rule of the mechanism once more, for the people it is
 * applied to. So that the text cannot drift from the mechanism, nothing it shares with the mechanism is typed here: every
 * limit and period is printed from the contracts' constants, the rules from the rulebook, the measures from the ledger's
 * own table and an answer's phrases from the table the mails and the screens read. A test changes those constants and
 * finds the terms changed with them (test/terms.test.tsx).
 */

/** A section's paragraphs are kept in one text, a blank line between two. */
const PARAGRAPH_BREAK = String.fromCharCode(10, 10);
const paragraphs = (...parts: string[]): string => parts.join(PARAGRAPH_BREAK);

/** A section's body as its paragraphs, for the page to set apart. */
export function termsParagraphs(body: string): string[] {
  return body.split(PARAGRAPH_BREAK);
}

/** A count as the terms print it: a small number as a word, and its noun in the singular or the plural. */
const count = (n: number, one: string): string => `${numberWord(n)} ${n === 1 ? one : `${one}s`}`;

/** A list inside a sentence: "a", "a or b", "a, b or c". */
const orList = (items: readonly string[]): string => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`);

/** A rule's name inside a sentence: its title in the rulebook without the leading "No". */
const ruleName = (rule: { title: string }): string => rule.title.replace(/^No /, "");

/** The rules whose final decisions only an admin takes, as the rulebook marks them. */
const ADMIN_RULES = orList(RULES.filter((rule) => rule.seniorQueue).map((rule) => rule.id));

/** The rule on doxxing, whose restricted content is erased once the restriction is final, as a sentence names it. */
const R4 = (() => {
  const rule = RULES.find((candidate) => candidate.id === "R4");
  if (!rule) throw new Error("the rulebook holds no rule R4");
  return `rule ${rule.id} (${ruleName(rule)})`;
})();

/** What each measure does, beside its label. A measure added to the ledger does not compile until it is explained here. */
const MEASURE_MEANINGS: Record<MeasureKind, string> = {
  withhold: "the post is hidden from other people; you still see it",
  remove: "the post is removed for other people; it stays in your own view while you keep it",
  seal_media: "the images the case covers are shown to nobody, you included",
  withhold_media: "one image of a post is hidden from other people; you still see it",
  remove_media: "one image of a post is removed for other people; it stays in your own view",
  reset_display_name: "the display name is replaced by the account's handle",
  reset_bio: "the bio is emptied",
};

/** The measures of one sentence, each by the label its decision records and what it does. */
const measureList = (kinds: readonly MeasureKind[]): string => kinds.map((kind) => `"${MEASURES[kind].label}" (${MEASURE_MEANINGS[kind]})`).join("; ");
// The ledger's own two marks sort the measures into the three sentences.
const WHILE_DECIDING = MEASURE_KINDS.filter((kind) => MEASURES[kind].interim && !MEASURES[kind].final);
const WHEN_DECIDED = MEASURE_KINDS.filter((kind) => !MEASURES[kind].interim && MEASURES[kind].final);
const EITHER = MEASURE_KINDS.filter((kind) => MEASURES[kind].interim && MEASURES[kind].final);
const LIFTED = REVERSAL_KINDS.map((kind) => `"${MEASURES[kind].label}"`).join("; ");

/** What each outcome of a report means. An outcome added to the contracts does not compile until it is explained here. */
const OUTCOME_MEANINGS: Record<ItemOutcome, string> = {
  restricted_rule: "a moderator found that the item breaks the rule the answer names, and korbat restricted it.",
  restricted_legal: "a moderator found the item illegal under EU law or the law of an EU country, and korbat restricted it everywhere.",
  no_violation: "a moderator found that the item breaks no rule and is not illegal, and korbat left it as it was.",
  not_evident:
    'this is what "illegality not evident" means: a moderator found no breach of a rule and could not tell from the item and from what you wrote, without a detailed legal examination, that it is illegal. korbat does not settle legal disputes; it leaves such an item up, and a court or an authority can order its removal.',
  not_available: "the link named no post or profile that korbat can show: it does not exist, or its author deleted it. This answer is given automatically, and no person looked at the link.",
  partly_reversed: "on its author's appeal or by a correction, korbat lifted part of what it had done about the item.",
  reversed: "on its author's appeal or by a correction, korbat lifted all of what it had done about the item.",
};

/** An outcome's phrase as the terms quote it: the rule's number and title are named, not filled in. */
const quoted = (phrase: string): string => phrase.replace("{rule}", "[number]").replace("{title}", "[title]");

/** One paragraph for each phrase an answer can read, with what it means: the seven outcomes, then the three that stand in for them where nobody opened the images. */
const ANSWERS: string[] = [
  ...ITEM_OUTCOMES.map((outcome) => `"${quoted(OUTCOME_PHRASES[outcome])}": ${OUTCOME_MEANINGS[outcome]}`),
  `"${SUSPECT_OUTCOME_PHRASES.sealed}": korbat's answer to a report on the anonymous path, and to any other report that the same decision answers, when images were sealed. It never says that korbat found something about the images, since nobody at korbat opened them.`,
  `"${SUSPECT_OUTCOME_PHRASES.no_action}": korbat's answer to a report on the anonymous path when an admin sealed nothing and restricted nothing.`,
  `"${UNSEEN_NO_ACTION}": korbat's answer to a report on another ground about a post, when a moderator took no action while nobody at korbat could open the post's images. It does not use up your one request for a re-examination.`,
];

const COURTS = "You can also go to court, or complain to the Digital Services Coordinator of the EU country where you live.";

export const TERMS_SECTIONS: { title: string; body: string }[] = [
  {
    title: "Draft",
    body: "These terms are a draft for testing korbat before launch. They will be replaced by reviewed terms and a privacy policy before korbat opens to the public.",
  },
  {
    title: "Who can use korbat",
    body: "You must be at least 16 years old. You can use a pseudonym. One person may hold more than one account, but not to evade a suspension.",
  },
  // The 3c design's sentence (section 9), in place of "removed only when it breaks a published rule", which notices of illegality made false. The rules are named from the rulebook.
  {
    title: "What you can post",
    body: `You can post opinions, including unpopular ones. korbat restricts content only when it breaks a published rule (${RULES.map(ruleName).join(", ")}), or when it is illegal under EU law or the law of an EU country and someone tells korbat so in a notice. Every decision names the rule or the law and says why, and a final decision that restricts your content can be appealed as the section "Appeals" describes.`,
  },
  // The rulebook itself, as @korbat/rules holds it: the grounds on which korbat restricts content (Digital Services Act, Article 14(1)).
  {
    title: "The rules",
    body: paragraphs(
      `These are korbat's rules, in version ${RULES_VERSION} of its rulebook. A decision under a rule names the rule, and its statement of reasons quotes the rule as it stood when the decision was made.`,
      ...RULES.map((rule) => `${rule.id}. ${rule.title}. ${rule.text}`),
    ),
  },
  {
    title: "Reports and notices",
    body: paragraphs(
      "Anyone can report a post, an image or a profile on korbat, signed in or not: choose Report on the item itself, or use the report form linked below these terms. A report says either that the item breaks one of korbat's rules or that it is illegal.",
      "A report about a profile is decided on its display name and bio; korbat decides about the account's posts and images in cases of their own. A report about a post that quotes another is decided on that post's own text and images; the quoted post is decided in a case of its own.",
      `For the sexual abuse or exploitation of a child, child sexual abuse material or grooming, the form has a path of its own, which is anonymous: korbat does not record who sent the report, not even an account, asks for no name and no email, and sends no email. You follow such a report through the link that is shown once on screen. On that path a report about a profile covers the images on all the profile's posts, a report about a post that quotes another covers both posts, and one report can name ${count(CSAM_NOTICE_MAX_ACCOUNTS, "profile")} at most.`,
      "A notice that something is illegal asks you to explain why and to confirm that you report in good faith; which law or country you mean, your name and your email are optional. Reports are anonymous towards the person you report: korbat never tells them who reported them, and a request for their data shows them what was written only where the law requires it (see Your data).",
      `korbat takes at most ${NOTICE_LIMITS.signedOut.perHour} reports an hour and ${NOTICE_LIMITS.signedOut.perDay} a day from one network without an account, and ${NOTICE_LIMITS.signedIn.perHour} an hour and ${NOTICE_LIMITS.signedIn.perDay} a day from one account. One report can name up to ${numberWord(NOTICE_LIMITS.maxTargets)} posts or profiles on korbat, by their links; korbat takes no attachments and follows no links to other sites. What you write to explain a report can be up to ${NOTICE_LIMITS.explanationMax} characters long, and the law or country you cite up to ${NOTICE_LIMITS.citedLawMax}.`,
      "A person looks at every report about something that is on korbat. A link that names nothing korbat can show is answered automatically, and the answer says so. Moderators read reports in the order of their severity and then of their age, never by how many reports an item has, and by who sent them only under the emergency switch.",
      "The emergency switch: when a flood of reports keeps moderators from real cases, the operator may turn it on until the flood ends. Reports sent without an account or from accounts under 48 hours old are then read after the others of the same severity; in the urgent lane (threats, violence, self-harm, public security, and the sexual abuse or exploitation of children) only reports sent without an account are. A report is never read after a less severe one, and every report is still read and answered.",
      `Every report gets a reference, shown on screen at once. A notice that something is illegal gets a receipt by email at once when you gave an email or sent it from an account; a report on the anonymous path gets none. An email address that has not been confirmed as its sender's in the last ${count(RETENTION.confirmationDays, "day")} gets at most one receipt a day; the others come with the next daily email. korbat sends its decisions on reports by email once a day, and they are always shown under Settings, Cases, Your reports, or on the report's own page. korbat sends no report email to an address whose holder asked it to stop, and gives up an email it could not send for ${count(RETENTION.mailGiveUpDays, "day")}; the answer stays on the report's page.`,
      "korbat answers each item of a report in one of the following ways.",
      ...ANSWERS,
      `Re-examination: if a moderator answered your report with no action, you can ask once for a re-examination, within ${count(APPEAL_MONTHS, "month")} of being told, free of charge and with an optional statement, under Your reports or on the report's page. It is decided again as a new report, by a moderator; korbat asks another moderator than the one who decided to take it when it has one. You can ask for at most ${count(DAILY_LIMITS.reexaminations, "re-examination")} a day. Its answer is final within korbat, with one exception: an answer given while korbat's staff could not open a post's images, because a report of child sexual abuse material about them was waiting or because they were sealed, says so and can be asked again. ${COURTS}`,
    ),
  },
  {
    title: "How moderators decide",
    body: paragraphs(
      "A moderator, never a program, decides every case. A moderator never decides about their own accounts or about accounts close to them.",
      `Some decisions only an admin takes: every final decision, whether it acts or not, on a report or a moderator's finding under ${ADMIN_RULES} or on a report made on the anonymous path, every lifting of a seal, and every correction of such a decision. Until an admin decides, any moderator may at once hide a reported threat from other people, or seal reported images.`,
      "On the path for child sexual abuse material, a moderator and an admin decide without seeing the images, on the report and on what korbat can read. Nobody at korbat opens images that are reported or found as such material while the report is unanswered or the images are sealed; that covers the images of a post while such a report about it, or about its author's profile, is unanswered. After an admin has answered without a seal, staff may open them like any other image. Reports on other grounds about those images, corrections and appeals are meanwhile decided on what korbat can read, or wait. An admin's answer to such a report about a post also answers the earlier reports about that post, and whoever sent a report about a post that is answered without action while its images cannot be opened is told so and may ask again.",
      "A seal can cover every image on a profile's posts. It hides the images from everyone, their author included, from the first seal, and never hides a post's text. A report of this kind about a post that quotes another opens a case on the quoted post too.",
      `korbat's measures are these, and no others; each is named as a decision records it. While korbat decides a case: ${measureList(WHILE_DECIDING)}. When the case is decided: ${measureList(WHEN_DECIDED)}. While it decides or when the case is decided: ${measureList(EITHER)}. A later decision can lift each of them again: ${LIFTED}.`,
      "A reset is written once, and korbat does not put the old value back: you may set the field again, and what you set is judged on its own if someone reports it. korbat restricts the least it can: one image rather than the post, one field rather than the account. Every finding of a breach is recorded as a restriction of its own, also when the content was already not shown or already deleted; its statement then says that it changed nothing now.",
      "Every decision that restricts your content, also one that changes nothing anyone sees now, every decision that reverses one, every answer to your appeal, and every end or lifting of something korbat told you it did while deciding comes with a statement of reasons, in the app at once and by email. A decision to take no action is not sent to you, since it would tell you that someone reported you, unless it ends or lifts something korbat told you it did while deciding. Something korbat does while deciding about a post you had already deleted is recorded without being sent to you, since it can never take effect. Content restricted for being illegal is restricted everywhere, since korbat cannot restrict by country.",
    ),
  },
  {
    title: "Appeals",
    body: paragraphs(
      `If a final decision restricts your content, you can appeal it once, while any of it is in force, within ${count(APPEAL_MONTHS, "month")} of being told, free of charge and with no form to follow: choose "Appeal" on the decision's screen under Settings, Cases. You can file at most ${count(DAILY_LIMITS.appeals, "appeal")} a day.`,
      "What korbat does while it decides cannot be appealed. It ends with the case's final decision, which is shown and sent to you and can be appealed when it restricts; a seal ends with an admin's answer to the reports it was taken on. A moderator may lift it earlier; a seal, only an admin.",
      "An appeal is reviewed by a moderator who made none of the case's decisions, including hiding the content while it was decided, did not report it, and has no link to anyone in the case. While korbat has no such moderator the appeal waits, without a time limit, and its screen says so: with one moderator every appeal waits, and with two every case both took part in, where one hid the content or reported it and the other decided it, which is how direct threats and images reported as child sexual abuse material are handled whenever the moderator on duty is not the admin.",
      "A review keeps the decision, lifts part of it or lifts all of it, and never adds to it. A decision reversed in full can no longer be appealed, since nothing of it remains. A decision changed on review or by a correction is final within korbat, and everyone whose report it answered is told.",
      `korbat does not put back a display name or a bio it reset: set it again. The screen of the decision that reset it shows what it was while korbat keeps the case's copies, and for at least ${count(RETENTION.resetValueDays, "day")} after a reset that is lifted or ends before they are erased, unless korbat had already erased a value reset under ${R4}, as Your data says.`,
      "An appeal of a seal waits, without a time limit, for the assessment of the authority korbat reported the images to. Only an admin lifts a seal, and a seal for good only on that authority's answer that the images are not child sexual abuse material.",
      COURTS,
    ),
  },
  // The policy Article 7(1) of Regulation (EU) 2021/784 asks for; its one hour is the Regulation's own figure.
  {
    title: "Terrorist content",
    body: "korbat removes terrorist content, as Article 2(7) of Regulation (EU) 2021/784 defines it, when it is told about it in a notice, and, once korbat is open to the public, complies with an authority's removal order within one hour. Material for educational, journalistic, artistic or research purposes, or for preventing or countering terrorism, and polemic or controversial views in public debate are not terrorist content (Article 1(3) of that Regulation). korbat uses no automated tool to find it.",
  },
  // The 2c design's sentence (section 2). It joins the draft without a new TERMS_VERSION, as 1b's and 1c's changes did before any public sign-up.
  {
    title: "Explore",
    body: "Public posts can appear in Explore, ranked by how many other accounts like or repost them; How Explore works gives the rules, and Settings > Privacy keeps your posts out.",
  },
  {
    title: "Your account",
    body: "You are responsible for keeping access to your email address. Turn on two-factor authentication and store your recovery codes; korbat cannot restore an account without them.",
  },
  {
    title: "Your data",
    body: paragraphs(
      "korbat stores your email address for sign-in and security messages, and never shows it to other people. IP addresses are stored only as keyed hashes, and a device keeps its hash for 30 days after it was last seen. Your date of birth is checked once and never stored. Your browser keeps a random device id so korbat can tell a new device from a known one; it is shared by every account used in that browser and is stored on the server only as a keyed hash. At sign-in, and when you send a report without being signed in, Cloudflare Turnstile checks that you are not a bot; it sees your IP address and browser details for that check, under Cloudflare's privacy policy. If you ask for the Verified badge, your phone number is handed to the verification provider for one text message, and korbat keeps only a keyed hash of it. From the Account settings you can export your account's data as a ZIP archive and delete your account; deletion removes your posts, keeps your handle reserved and cannot be undone. If you add a passkey, korbat keeps its public key, a name, the dates it was added and last used, and the device that added it; nothing about your fingerprint or face leaves your device.",
      // What 3c adds, with the periods of RETENTION (3c design, section 6.6).
      `When someone reports a post or a profile, korbat keeps a copy of its text and holds its images, whatever it then decides. Deleting the post or your account leaves these copies until their period ends. A case's copies are erased ${count(RETENTION.evidenceHours, "hour")} after the case closes, or after its newest copy if that is later, unless a restriction of the case can still be appealed or, for a post, a report that only an admin can answer still waits or its images are sealed.`,
      "For a report of child sexual abuse material, korbat keeps the images of the reported post, of the post it quotes, or of all a profile's posts until an admin has answered the report, also when their author deletes the post or the account meanwhile; once their post is deleted they are shown to nobody. Images an admin then keeps sealed are kept for the authorities, with korbat's copies of their post's text; they are left out of your account's export and are not released by korbat on its own.",
      `Content korbat removes or resets under ${R4}, a post's text, an image, a display name or a bio, is erased for good, as far as that decision still stands, once it can no longer be appealed, ${count(RETENTION.r4FinalMonths, "month")} after you were told, or once your appeal against it is answered; for a post, later only while a report that only an admin can answer still waits or while its images are sealed. It is erased from your own view, your export and the decision's screen, and from every copy korbat keeps but its backups (an image once no other case still holds it), also when you had deleted the post, so a later reversal cannot bring it back or show it to you again.`,
      `korbat's backups of its database and its images hold everything as it stood when each was taken, what korbat erased since included. Each is deleted ${count(RETENTION.backupDays, "day")} after it was taken, except a backup that korbat must keep for the authorities, which it keeps until they have answered.`,
      `A notifier's name and email are kept apart from the case, never shown to staff or to the person reported, and deleted ${count(RETENTION.contactMonths, "month")} after the last day korbat still owed the report a decision or an email, or ${count(RETENTION.contactMaxMonths, "month")} after the report if nothing moved that day. That an email address was confirmed as a sender's is kept for ${count(RETENTION.confirmationDays, "day")}.`,
      `Staff see a reporter or a notifier as a summary: roughly how old the account is, how many reports it sent, what share were acted on and how many were answered while their images could not be opened, in broad bands, never exact numbers. A moderator sees a reporter's handle or a notifier's name only when a case needs it, for example a claim of impersonation or abuse of reporting, each time with a recorded reason that is shown to every staff member; the person reported never sees either. korbat forgets which account sent a report ${count(RETENTION.intakeDays, "day")} after its last outcome was given and settled, which is at most about ${count(APPEAL_MONTHS + Math.ceil(RETENTION.intakeDays / 30), "month")} after a decision to take no action, while it can still be re-examined.`,
      `On a report of child sexual abuse material, staff see how many such reports about the same post, profile or author an admin answered without a seal in the last ${count(SUSPECT_EARLIER_MONTHS, "month")}, as a number and a day.`,
      `The reasons korbat gave you for a decision are kept while your account exists and for ${count(RETENTION.statementMonths, "month")} after its deletion; the decision itself stays on record without them. korbat's log of which staff member opened a case, viewed an image or was shown who sent a report, with the reason given for that, is kept for ${count(RETENTION.accessLogMonths, "month")}. A text a moderator wrote for a decision and did not confirm is deleted after ${count(RETENTION.draftHours, "hour")}.`,
      "Your account's export holds the decisions its Cases screens list and your own reports. If you ask for your data at the address under Contact, you receive, within a month, every case about you (cases without action included), the copies korbat keeps, where each case came from (a report by another user, a notice, a moderator) and, where the law requires it after weighing the writer's rights, the words of a report without who wrote it.",
    ),
  },
];
```

### Replace `packages/contracts/src/account.ts` (whole file)

```ts
import { z } from "zod";
import { Platform, Role } from "./auth";
import { ITEM_OUTCOMES, MEASURE_KINDS, NoticeRef, REVERSAL_KINDS, RULE_IDS, TDB_CATEGORIES } from "./moderation";

const at = z.iso.datetime();
/** A UTC day, as the list of decisions shows one. */
const day = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, "must be a UTC day");

/** Something the account did to a post (a like, a repost, a bookmark), and when. */
const PostRef = z.object({ postId: z.uuid(), at });

/** The other side of a graph relation by the handle it had at export time (nothing else about them), and since when. */
const HandleRef = z.object({ handle: z.string(), since: at });

/** An image attached to one of the account's posts; `file` names its entry in the archive. */
const ExportedMedia = z.object({ id: z.uuid(), file: z.string(), altText: z.string(), width: z.number().int().positive(), height: z.number().int().positive() });

/** A post as its author wrote it; a deleted one keeps its place with an empty body and its deletion time. */
const ExportedPost = z.object({
  id: z.uuid(),
  body: z.string(),
  createdAt: at,
  replyToId: z.uuid().nullable(),
  quoteOfId: z.uuid().nullable(),
  state: z.enum(["visible", "withheld", "removed", "deleted_by_author"]),
  deletedAt: at.nullable(),
  media: z.array(ExportedMedia),
});

/** A passkey of the account as the export lists it (1c design, section 7.7): what the Security screen shows, and nothing that identifies the key, its id or its authenticator. */
const ExportedPasskey = z.object({
  name: z.string(),
  createdAt: at,
  lastUsedAt: at.nullable(),
  /** Backed up, so the password manager syncs it to the owner's other devices. */
  synced: z.boolean(),
  /** The label of the device that added it; null once that device is gone. */
  createdOn: z.string().nullable(),
});

/**
 * A decision about the account or one of its posts, as the export lists it (3c design, section 7.11): one of the decisions
 * the Cases screen lists, which are those its author was told of, with what its statement of reasons tells.
 *   - `decidedOn` is the decision's UTC day, as the list shows it; `postId` the entry of `posts` a decision about a post
 *     concerns, null for a decision about the account's display name or bio.
 *   - `ground` and `ruleId` name the law or the rule it rests on, and `rulesVersion` the version of the rulebook it was
 *     made under.
 *   - `measures` are what it imposed, each with `noEffect` set when it changed nothing anyone saw (the content was already
 *     not shown, or already deleted); `reversals` what it lifted. An image measure names the account's own image.
 *   - `facts`, `reason` and `legalReference` are the statement's texts while korbat holds them; null for a text the
 *     decision never had, one that was erased, and the facts and the reason of a decision that restricted nothing.
 *   - `appeal` is where the account's appeal of the decision stands; null when it filed none.
 * It names its source nowhere: no report, no reporter, no notifier and no staff member is part of it.
 */
const ExportedDecision = z.object({
  id: z.uuid(),
  decidedOn: day,
  postId: z.uuid().nullable(),
  kind: z.enum(["interim", "final", "review", "correction"]),
  outcome: z.enum(["restricted", "no_violation", "not_evident", "kept", "partly_reversed", "reversed"]),
  ground: z.enum(["incompatible", "illegal"]).nullable(),
  ruleId: z.enum(RULE_IDS).nullable(),
  rulesVersion: z.number().int().positive(),
  measures: z.array(z.object({ kind: z.enum(MEASURE_KINDS), mediaId: z.uuid().nullable(), noEffect: z.enum(["already", "deleted"]).nullable() })),
  reversals: z.array(z.object({ kind: z.enum(REVERSAL_KINDS), mediaId: z.uuid().nullable() })),
  facts: z.string().nullable(),
  reason: z.string().nullable(),
  legalReference: z.string().nullable(),
  appeal: z
    .discriminatedUnion("state", [
      z.object({ state: z.literal("pending"), result: z.null() }),
      z.object({ state: z.literal("answered"), result: z.enum(["kept", "partly_reversed", "reversed"]) }),
    ])
    .nullable(),
});

/**
 * One item of a report in its sender's export: its place in the report, its korbat address (an account's under the handle
 * the report named, never a later one) and whether it is the re-examination of the item before it. `outcome`, its words
 * as the list of reports reads them (`outcomeText`) and whether a re-examination can still be asked for
 * (`reexaminationOpen`) are told together, once the daily release has shown the outcome; until then all three are null,
 * whether or not a moderator has decided, as on the list and on the report's page.
 */
const ExportedReportItem = z
  .object({
    position: z.number().int().min(1).max(20),
    link: z.string(),
    reexamines: z.boolean(),
    outcome: z.enum(ITEM_OUTCOMES).nullable(),
    outcomeText: z.string().nullable(),
    reexaminationOpen: z.boolean().nullable(),
  })
  .refine((item) => (item.outcome === null) === (item.outcomeText === null) && (item.outcome === null) === (item.reexaminationOpen === null), {
    message: "an outcome, its words and whether a re-examination is open are told together or not at all",
  });

/**
 * A report or a notice the account sent, while korbat keeps its record (3c design, sections 6.6 and 7.11): its reference,
 * when korbat received it, whether it said that something breaks a rule or is illegal, the rule it cited (always for a
 * report on a rule, optionally for a notice of illegality), its Transparency Database category, and the sender's own
 * explanation. A report on the path for child sexual abuse material records no sender, the account included, so it is in
 * nobody's export.
 */
const ExportedReport = z.object({
  ref: NoticeRef,
  receivedAt: at,
  ground: z.enum(["rule", "illegal"]),
  ruleId: z.enum(RULE_IDS).nullable(),
  category: z.enum(TDB_CATEGORIES),
  explanation: z.string().nullable(),
  items: z.array(ExportedReportItem),
});

/**
 * export.json inside the data export archive (1b design, section 7.5): everything the account owns, and
 * nothing about other people beyond the handle they had at export time.
 */
export const ExportFormat = z.object({
  format: z.literal("korbat-export-1"),
  exportedAt: at,
  account: z.object({
    id: z.uuid(),
    email: z.email(),
    createdAt: at,
    role: Role,
    mfaEnabled: z.boolean(),
    hasPassword: z.boolean(),
    verified: z.boolean(),
    termsVersion: z.string().nullable(),
    termsAcceptedAt: at.nullable(),
    /** The account's passkeys, newest first. Added to korbat-export-1 without a new format name: a reader that does not know the member loses nothing by skipping it. */
    passkeys: z.array(ExportedPasskey),
  }),
  profile: z.object({
    handle: z.string(),
    displayName: z.string(),
    bio: z.string(),
    createdAt: at,
    /** Every handle the account ever had, the current one included. */
    handleHistory: z.array(z.string()),
    /**
     * "Show my posts in Explore" as it stands (2c design, section 8). Added to korbat-export-1 without a new format name: a
     * reader that does not know the member loses nothing by skipping it.
     */
    showInExplore: z.boolean(),
  }),
  posts: z.array(ExportedPost),
  likes: z.array(PostRef),
  reposts: z.array(PostRef),
  bookmarks: z.array(PostRef),
  following: z.array(HandleRef),
  blocks: z.array(HandleRef),
  mutes: z.array(HandleRef),
  /** The live sessions. `id` is the session's handle, as the session list names it; the hash of its token never leaves the server. */
  sessions: z.array(z.object({ id: z.string(), createdAt: at, lastUsedAt: at, current: z.boolean() })),
  devices: z.array(z.object({ label: z.string().nullable(), platform: Platform, firstSeenAt: at, lastSeenAt: at })),
  /** The account's own security events: their kind and time, without the metadata. */
  events: z.array(z.object({ type: z.string(), at })),
  /** Ids of ready images whose file was not on disk when the archive was written. */
  missingMedia: z.array(z.string()),
  /**
   * What korbat's moderation holds for the account (3c design, section 7.11): the decisions about it that its Cases screen
   * lists, newest first, and its own reports and notices, newest first. Never another person's report, a reporter, a
   * notifier or a staff member. Added to korbat-export-1 without a new format name, last in the document: a reader that
   * does not know the member loses nothing by skipping it.
   */
  moderation: z.object({ decisions: z.array(ExportedDecision), reports: z.array(ExportedReport) }),
});
export type ExportFormat = z.infer<typeof ExportFormat>;
```

### Replace `scripts/smoke-auth-stack.mjs` (whole file)

```js
#!/usr/bin/env node
/**
 * Smoke test of the auth and social modules in a running Compose stack, through Caddy.
 *
 * 1. The web page's CSP allows the Turnstile widget.
 * 2. The staff console's site (--console): its page answers with the console's CSP, exactly, and
 *    Cache-Control: no-store, no-transform. /api/staff/me answers 404 on the app's site, from Caddy itself,
 *    and, signed out, 401 staff_session_required on the console's, so the API has the console on there.
 *    The console's case routes (the overview, the queue, a case, the appeals) answer the same two ways, and
 *    the console's site answers the app's own moderation routes with 404 itself.
 * 3. Signed out, Explore answers a page that parses; its ranking is computed within a minute (the refresh
 *    job runs a round at start), and by the answer's own Date header it is less than 11 minutes old.
 * 4. Password sign-in for an unknown email returns invalid_credentials (argon2 runs inside the image).
 * 5. A throwaway native-app account signs up with an emailed code read from Mailpit and onboards.
 * 6. /api/me answers for it.
 * 7. It posts, the post appears in the public Latest timeline, and its profile counts one post.
 * 8. It uploads a JPEG carrying a GPS position, waits until it is ready, and posts it without text. The
 *    original upload is gone, and large.webp is served to anyone as a fresh WebP without metadata.
 * 9. A symlink to /proc/self/environ, planted in the store from inside the worker, is refused with 404.
 * 10. Deleting the post stops the image being served, and its folder leaves the store.
 * 11. The worker has only a loopback interface and a 768 MiB memory limit, and has never restarted.
 * 12. With --worst-case, flat-colour files at the pixel caps (48 MP 16-bit interlaced PNG, 48 MP
 *     progressive JPEG, 48 MP GIF, 16 MP AVIF) all become ready without the worker being OOM-killed or
 *     restarted, and its memory peak is printed. Run it after every sharp upgrade.
 * 13. The grant-role CLI makes it a moderator, and its session stops working.
 * 14. A second throwaway account (the first one's session is gone by now, and a deleted account could not
 *     be granted a role) edits its bio, changes its handle, reports the first account's post under a rule
 *     (its own list of reports shows the report undecided, and no decision is about it), downloads its
 *     export as a ZIP whose export.json ends with the moderation member holding that report, posts, and
 *     deletes itself with a code read from Mailpit and its handle typed; afterwards its profile is not
 *     found, its session is gone, and its post has left the Latest timeline.
 * 15. Signed out, a notice that the first account's post is illegal is taken through the app's site with the
 *     human check: it answers a reference and a token. The status page opens with that token and shows the
 *     post's link, undecided, and the contact as given; another token finds no notice. The receipt arrives in
 *     Mailpit under the reference, and the token in its link opens the same page with the address not yet
 *     confirmed. Nothing here decides the case: a decision needs a staff key.
 *
 * Runs only against a local Docker context. Needs API_TURNSTILE_SECRET_KEY set to Cloudflare's always-pass test secret and API_SMTP_URL pointing
 * at Mailpit, and API_CONSOLE_ORIGIN naming the --console address. Makes its images with the sharp the worker uses.
 * Tries a Turnstile refusal again for up to a minute, since outbound calls can stall. Prints no codes or tokens.
 *
 * Every run leaves its first account, by then a moderator, and one open case on that account's post, in the lane
 * that is read last, with a report and a notice that no run can decide. One network may run it five times an hour
 * and twenty times a day: its two sign-ups count against the hourly sign-up limit, and its signed-out notice
 * against the limits of reports sent without an account.
 *
 * Usage, from the repo root:
 *   node scripts/smoke-auth-stack.mjs --base http://localhost:8080 --console http://localhost:8090 \
 *     --mailpit http://localhost:58025 --terms draft-2026-09 [--worst-case] \
 *     -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
 */
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { CONSOLE_CSP } from "../apps/admin/site-headers.mjs";

const argv = process.argv.slice(2);
const separator = argv.indexOf("--");
const options = separator === -1 ? argv : argv.slice(0, separator);
const compose = separator === -1 ? [] : argv.slice(separator + 1);
const option = (name) => {
  const index = options.indexOf(`--${name}`);
  return index === -1 ? undefined : options[index + 1];
};
const base = option("base");
// The staff console's site: Caddy's second site, at exactly the address API_CONSOLE_ORIGIN names, never 127.0.0.1.
const consoleBase = option("console");
const mailpit = option("mailpit");
const terms = option("terms");
const worstCase = options.includes("--worst-case");
if (!base || !consoleBase || !mailpit || !terms || compose.length === 0) {
  console.error("usage: node scripts/smoke-auth-stack.mjs --base <url> --console <url> --mailpit <url> --terms <version> [--worst-case] -- <docker compose command>");
  process.exit(2);
}
function stop(message) {
  console.error(message);
  process.exit(1);
}

/** Docker's current context must be this machine: a remote context would point these commands at another host. */
function requireLocalDocker() {
  const inspected = spawnSync("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], { encoding: "utf8" });
  const host = inspected.status === 0 ? inspected.stdout.trim() : "";
  if (!/^(unix:|npipe:)/.test(host)) stop(`Docker's current context points at "${host || "an unknown endpoint"}", not this machine. This script only runs against a local stack.`);
}
requireLocalDocker();

/** The sharp the worker depends on, so the test images come from the same library that will read them. */
const sharp = createRequire(new URL("../apps/worker/package.json", import.meta.url))("sharp");
/** The fflate the API depends on: the export's archive is opened with the library the API's own tests open it with. */
const { strFromU8, unzipSync } = createRequire(new URL("../apps/api/package.json", import.meta.url))("fflate");

/** Cloudflare's test secret accepts any token. */
const TURNSTILE_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const deviceId = randomBytes(32).toString("base64url");
const email = `smoke-${randomUUID()}@korbat.local`;
const handle = `smoke_${randomBytes(4).toString("hex")}`;
let failures = 0;

function check(label, ok, detail) {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
  return ok;
}

async function api(path, { json, token, method } = {}) {
  const headers = {};
  if (json !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, { method: method ?? (json === undefined ? "GET" : "POST"), headers, body: json === undefined ? undefined : JSON.stringify(json) });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body, summary: `HTTP ${res.status}${body?.error?.code ? ` ${body.error.code}` : ""}` };
}

/** What a failed human check answers: the sign-in routes' code, and the code of a report sent signed out. */
const HUMAN_CHECK_REFUSALS = ["turnstile_failed", "human_check_failed"];

/**
 * Cloudflare's siteverify is a call across the internet, and the API fails closed when it stalls past
 * five seconds. On Docker Desktop, containers' outbound calls stall for up to half a minute right after a
 * heavy image build, which is not a fault of the stack, so a Turnstile refusal is tried again every five
 * seconds for up to a minute. A wrong secret still fails, a minute later.
 */
async function withTurnstile(path, json) {
  const deadline = Date.now() + 60_000;
  let result = await api(path, { json });
  while (HUMAN_CHECK_REFUSALS.includes(result.body?.error?.code) && Date.now() < deadline) {
    console.log(`info ${path}: Turnstile could not be verified; trying again in 5 s`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
    result = await api(path, { json });
  }
  return result;
}

/** Any request, with a raw body; answers with the status, the headers and the body's bytes. */
async function send(path, { method = "GET", token, body, type } = {}) {
  const headers = {};
  if (type) headers["content-type"] = type;
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, { method, headers, body });
  return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) };
}

/** Runs a shell command in a service's container. Its stdin is closed, so nothing can wait on it. */
function inside(service, command) {
  return execFileSync(compose[0], [...compose.slice(1), "exec", "-T", service, "sh", "-c", command], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function workerState() {
  const id = execFileSync(compose[0], [...compose.slice(1), "ps", "-q", "worker"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
  const fields = execFileSync(compose[0], ["inspect", id, "--format", "{{.HostConfig.Memory}} {{.RestartCount}} {{.State.OOMKilled}}"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] })
    .trim()
    .split(" ");
  return { memory: Number(fields[0]), restarts: Number(fields[1]), oomKilled: fields[2] === "true" };
}

async function upload(bytes, type, token) {
  const sent = await send("/api/media", { method: "POST", token, body: bytes, type });
  let id = null;
  try {
    id = JSON.parse(sent.bytes.toString("utf8")).id ?? null;
  } catch {
    id = null;
  }
  return { status: sent.status, id };
}

/** Polls an upload until it is no longer processing; the worker gives up on a file after two minutes. */
async function waitReady(id, token) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const res = await api(`/api/media/${id}`, { token });
    if (res.body?.status !== "processing") return res.body ?? { status: res.summary };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { status: "still processing after 150 s" };
}

const PLANTED = "korbat-smoke-planted-text";
/** 51 deg 30 min north, the latitude planted below, as EXIF writes it: three rationals of 32-bit numbers. */
const LATITUDE = [51, 1, 30, 1, 0, 1];
function hasLatitude(bytes) {
  const little = Buffer.alloc(24);
  const big = Buffer.alloc(24);
  LATITUDE.forEach((value, index) => {
    little.writeUInt32LE(value, index * 4);
    big.writeUInt32BE(value, index * 4);
  });
  return bytes.includes(little) || bytes.includes(big);
}

async function images(token) {
  const jpeg = await sharp({ create: { width: 1200, height: 900, channels: 3, background: "#2f6f4f" } })
    .jpeg()
    .withExif({ IFD0: { Copyright: PLANTED }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "0/1 7/1 0/1" } })
    .toBuffer();
  check("the test JPEG carries a GPS position and planted text", hasLatitude(jpeg) && jpeg.includes(PLANTED));

  const sent = await upload(jpeg, "image/jpeg", token);
  if (!check("upload it through Caddy", sent.status === 202 && sent.id !== null, `HTTP ${sent.status}`)) return;
  const id = sent.id;
  const state = await waitReady(id, token);
  if (!check("the image is ready", state.status === "ready", state.error ?? state.status)) return;
  check("the original upload is gone", inside("api", `test -e /media/uploads/incoming/${id} && echo present || echo gone`) === "gone");

  const created = await api("/api/posts", { json: { media: [{ id, alt: "A plain green test image" }] }, token });
  if (!check("post it without text", created.status === 201 && created.body?.media?.length === 1, created.summary)) return;
  const large = created.body.media[0].large;
  const file = await send(large);
  const served = `HTTP ${file.status}, ${file.headers.get("content-type")}, ${file.headers.get("cache-control")}`;
  check("large.webp is served to anyone and may be cached publicly", file.status === 200 && file.headers.get("content-type") === "image/webp" && file.headers.get("cache-control") === "public, max-age=300", served);
  const meta = await sharp(file.bytes).metadata();
  const clean = meta.format === "webp" && meta.exif === undefined && meta.xmp === undefined && meta.icc === undefined;
  check("large.webp is a fresh WebP without EXIF, XMP, ICC, the GPS position or the planted text", clean && !hasLatitude(file.bytes) && !file.bytes.includes(PLANTED), `${meta.format} ${meta.width}x${meta.height}`);

  const shard = id.slice(0, 2);
  inside("worker", `ln -sf /proc/self/environ /media/store/files/${shard}/${id}/large.webp`);
  const planted = await send(large);
  const leaked = /DATABASE_URL|PASSWORD|SECRET|_KEY=/.test(planted.bytes.toString("latin1"));
  check("a symlink planted in the store by the worker is refused, and nothing leaks", planted.status === 404 && !leaked, `HTTP ${planted.status}`);

  const removed = await send(`/api/posts/${created.body.id}`, { method: "DELETE", token });
  check("delete the post", removed.status === 204, `HTTP ${removed.status}`);
  const after = await send(large);
  check("its image is no longer served", after.status === 404, `HTTP ${after.status}`);
  let folder = "present";
  for (let attempt = 0; attempt < 60 && folder !== "gone"; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    folder = inside("api", `test -e /media/store/files/${shard}/${id} && echo present || echo gone`);
  }
  check("its folder is gone from the store", folder === "gone");

  const interfaces = inside("worker", "ls -x /sys/class/net");
  check("the worker has only a loopback interface", interfaces === "lo", interfaces);
  const worker = workerState();
  check("the worker's memory limit is 768 MiB", worker.memory === 768 * 1024 * 1024, `${worker.memory} bytes`);
  check("the worker has never restarted or been OOM-killed", worker.restarts === 0 && !worker.oomKilled, `restarts ${worker.restarts}, OOM-killed ${worker.oomKilled}`);
}

/** Flat colour compresses to almost nothing, so every file is small to send and at its cap to decode. */
const WORST_CASE = [
  ["48 MP 16-bit interlaced PNG", "image/png", () => sharp({ create: { width: 8000, height: 6000, channels: 3, background: "#806040" } }).toColourspace("rgb16").png({ progressive: true }).toBuffer()],
  ["48 MP progressive JPEG", "image/jpeg", () => sharp({ create: { width: 8000, height: 6000, channels: 3, background: "#406080" } }).jpeg({ progressive: true }).toBuffer()],
  ["48 MP GIF", "image/gif", () => sharp({ create: { width: 8000, height: 6000, channels: 3, background: "#608040" } }).gif().toBuffer()],
  ["16 MP AVIF", "image/avif", () => sharp({ create: { width: 4000, height: 4000, channels: 3, background: "#804060" } }).avif({ effort: 0 }).toBuffer()],
];

async function worstCaseImages(token) {
  for (const [label, type, make] of WORST_CASE) {
    const bytes = await make();
    const sent = await upload(bytes, type, token);
    const state = sent.id ? await waitReady(sent.id, token) : { status: `HTTP ${sent.status}` };
    check(`worst case: ${label} is ready`, state.status === "ready", `${state.error ?? state.status}, ${Math.round(bytes.length / 1024)} KiB sent`);
    if (sent.id) await send(`/api/media/${sent.id}`, { method: "DELETE", token });
  }
  const worker = workerState();
  check("worst case: the worker was never OOM-killed or restarted", worker.restarts === 0 && !worker.oomKilled, `restarts ${worker.restarts}, OOM-killed ${worker.oomKilled}`);
  const peak = Number(inside("worker", "cat /sys/fs/cgroup/memory.peak"));
  console.log(`info worst case: the worker's memory peak is ${Math.round(peak / 1048576)} MiB of ${Math.round(worker.memory / 1048576)} MiB`);
}

/** A GET of a full URL: the status, the headers, and the body when it is JSON. */
async function getJson(url) {
  const res = await fetch(url);
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, headers: res.headers, body, summary: `HTTP ${res.status}${body?.error?.code ? ` ${body.error.code}` : ""}` };
}

/**
 * The staff console's site (3a design, sections 8 and 12). Its page carries the console's own policy, the one
 * apps/admin/site-headers.mjs defines and the Caddyfile's console site sends, and is neither stored nor transformed. The
 * staff API answers only there: the app's site refuses it itself, with a 404 that carries no request id (the API puts one
 * in every error it answers, so none means Caddy answered ahead of its API proxy), and the console's site hands it to the
 * API, whose staff gate accepts the console's Host and, without a session, answers 401. A 404 there means the API has the
 * console off (API_CONSOLE_ORIGIN empty) or API_CONSOLE_ORIGIN names another address than --console.
 */
async function consoleSite() {
  const page = await fetch(`${consoleBase}/`);
  const csp = page.headers.get("content-security-policy");
  check("the console's page answers with the console's CSP, exactly", page.status === 200 && csp === CONSOLE_CSP, `HTTP ${page.status}, ${csp ?? "no CSP"}`);
  const cache = page.headers.get("cache-control");
  check("the console's page is neither stored nor transformed", cache === "no-store, no-transform", cache ?? "no Cache-Control");

  const onApp = await getJson(`${base}/api/staff/me`);
  check("the app's site answers /api/staff/me with 404", onApp.status === 404 && onApp.body?.error?.code === "not_found", onApp.summary);
  check("the app's site refuses the staff API itself, ahead of its API proxy", onApp.status === 404 && onApp.body?.error?.requestId === undefined, onApp.body?.error?.requestId ? "the API answered" : onApp.summary);

  const onConsole = await getJson(`${consoleBase}/api/staff/me`);
  check("signed out, the console's site answers /api/staff/me with 401 staff_session_required", onConsole.status === 401 && onConsole.body?.error?.code === "staff_session_required", onConsole.summary);

  // The console's case routes (3c design, section 12) stand behind the same two doors: the overview, the queue, a case
  // and the appeals. The staff session is asked for before anything of the request is read, so a case that does not
  // exist answers like the others.
  const caseRoutes = ["/api/staff/overview", "/api/staff/queue", `/api/staff/cases/${randomUUID()}`, "/api/staff/appeals"];
  const answers = (list) => list.map((answer, index) => `${caseRoutes[index]}: ${answer.summary}`).join("; ");
  const casesOnApp = await Promise.all(caseRoutes.map((path) => getJson(`${base}${path}`)));
  check(
    "the app's site refuses the console's case routes itself, with 404",
    casesOnApp.every((answer) => answer.status === 404 && answer.body?.error?.code === "not_found" && answer.body.error.requestId === undefined),
    answers(casesOnApp),
  );
  const casesOnConsole = await Promise.all(caseRoutes.map((path) => getJson(`${consoleBase}${path}`)));
  check(
    "signed out, the console's site answers its case routes with 401 staff_session_required",
    casesOnConsole.every((answer) => answer.status === 401 && answer.body?.error?.code === "staff_session_required"),
    answers(casesOnConsole),
  );
  // And the other way round: the console's site proxies the staff API and nothing else, so the app's own moderation
  // routes are answered there by Caddy, never by the API.
  const appRoute = await getJson(`${consoleBase}/api/moderation/cases`);
  check("the console's site refuses the app's moderation routes itself, with 404", appRoute.status === 404 && appRoute.body?.error?.code === "not_found" && appRoute.body.error.requestId === undefined, appRoute.summary);
}

/**
 * Explore signed out (2c design, section 13). The page's fields are checked by hand: post items only, at most the
 * signed-out page of 20, no cursor, a boolean signInForMore and computedAt null or a time. The refresh job runs a round
 * as the API starts, so computedAt is polled for up to a minute. Its age is measured against the answer's Date header,
 * the server's clock rather than this machine's, and stays under 11 minutes: a round at most every 5 minutes, one that
 * skips because the last ranking is under 4.5 minutes old, and a minute and a half to spare.
 */
async function explore() {
  const deadline = Date.now() + 60_000;
  let answer;
  let page = null;
  for (;;) {
    answer = await send("/api/timeline/explore");
    try {
      page = JSON.parse(answer.bytes.toString("utf8"));
    } catch {
      page = null;
    }
    if (answer.status !== 200 || typeof page?.computedAt === "string" || Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  const items = Array.isArray(page?.items) ? page.items : null;
  const posts = items !== null && items.every((item) => item?.kind === "post" && typeof item.post?.id === "string" && typeof item.post?.author?.handle === "string");
  const parses =
    answer.status === 200 &&
    posts &&
    items.length <= 20 &&
    page.nextCursor === null &&
    typeof page.signInForMore === "boolean" &&
    (page.computedAt === null || (typeof page.computedAt === "string" && !Number.isNaN(Date.parse(page.computedAt))));
  check("signed out, Explore answers a page that parses", parses, `HTTP ${answer.status}, ${items === null ? "no" : items.length} posts`);
  if (!check("Explore has a ranking within a minute", typeof page?.computedAt === "string", page?.computedAt ?? "computedAt is null")) return;
  const age = Date.parse(answer.headers.get("date") ?? "") - Date.parse(page.computedAt);
  check("by the answer's Date header, the ranking is less than 11 minutes old", Number.isFinite(age) && age < 11 * 60 * 1000, `${Math.round(age / 1000)} s`);
}

/** The first 6-digit code in the newest message to `to`, or in the newest one with `subject` when an older code email is already in the box. */
async function emailCode(to, subject) {
  const query = encodeURIComponent(`to:"${to}"`);
  for (let attempt = 0; attempt < 40; attempt++) {
    const list = await (await fetch(`${mailpit}/api/v1/search?query=${query}`)).json();
    const newest = subject === undefined ? list.messages?.[0] : list.messages?.find((message) => message.Subject === subject);
    if (newest) {
      const message = await (await fetch(`${mailpit}/api/v1/message/${newest.ID}`)).json();
      const code = /\b(\d{6})\b/.exec(message.Text)?.[1];
      if (code) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no code email to ${to} arrived in Mailpit`);
}

/** A notice's public reference: N- and ten base32 characters. */
const NOTICE_REF = /^N-[A-Z2-7]{10}$/;

/** One line about a report's items as a status answer or a list gives them: how many, and each one's link and outcome. */
const itemsSummary = (items) => (Array.isArray(items) ? `${items.length} item(s): ${items.map((item) => `${item?.link} -> ${item?.outcome}`).join(", ")}` : "no items");
/** Whether these are exactly one item, about this post by its korbat link, with no outcome shown yet. */
const onePostUndecided = (items, postId) => Array.isArray(items) && items.length === 1 && typeof items[0]?.link === "string" && items[0].link.endsWith(`/post/${postId}`) && items[0].outcome === null;

/**
 * A report under a rule from a signed-in account (3c design, sections 7.1, 7.6 and 12), about another account's post:
 * it needs no human check and answers a reference without a token, since the account's own list follows it. That list
 * then shows the report with its one item undecided, and the account's list of decisions is empty. Answers the
 * reference, or null when the report was not taken.
 */
async function signedInReport(postId, token) {
  const reported = await api("/api/notices", { json: { ground: "rule", ruleId: "R6", targets: [{ kind: "post", id: postId }], explanation: "Sent by the smoke test." }, token });
  const ref = reported.body?.ref;
  if (!check("a signed-in report under a rule is taken: a reference and no token", reported.status === 201 && NOTICE_REF.test(ref ?? "") && reported.body.token === undefined, reported.summary)) return null;
  const reports = await api("/api/moderation/reports", { token });
  const mine = reports.body?.reports?.[0];
  check("the account's list of reports shows it, undecided", reports.status === 200 && mine?.ref === ref && onePostUndecided(mine.items, postId), `${reports.summary}, ${itemsSummary(mine?.items)}`);
  const cases = await api("/api/moderation/cases", { token });
  check("no decision is about the account", cases.status === 200 && Array.isArray(cases.body?.decisions) && cases.body.decisions.length === 0 && cases.body.nextCursor === null, cases.summary);
  return ref;
}

/**
 * The export's moderation member (3c design, section 7.11), read from the archive itself: export.json's last member,
 * with no decision about this account and the one report it sent, under its reference and its ground, its item
 * undecided.
 */
function exportedModeration(archive, reportRef, postId) {
  let document = null;
  try {
    document = JSON.parse(strFromU8(unzipSync(new Uint8Array(archive))["export.json"]));
  } catch {
    document = null;
  }
  const moderation = document?.moderation;
  const last = document === null ? "export.json could not be read" : `last member ${Object.keys(document).at(-1)}`;
  if (!check("export.json ends with the moderation member: its decisions and its reports", document !== null && Object.keys(document).at(-1) === "moderation" && Array.isArray(moderation?.decisions) && Array.isArray(moderation?.reports), last)) return;
  const own = moderation.reports[0];
  check(
    "the export holds no decision and the account's one report, undecided",
    reportRef !== null && moderation.decisions.length === 0 && moderation.reports.length === 1 && own?.ref === reportRef && own.ground === "rule" && own.ruleId === "R6" && onePostUndecided(own.items, postId) && own.items[0].reexaminationOpen === null,
    `${moderation.decisions.length} decision(s), ${moderation.reports.length} report(s), ${itemsSummary(own?.items)}`,
  );
}

/** The newest message to `to` in Mailpit whose subject is `subject`, read whole; null when none arrives within half a minute. */
async function mailTo(to, subject) {
  const query = encodeURIComponent(`to:"${to}"`);
  for (let attempt = 0; attempt < 120; attempt++) {
    const list = await (await fetch(`${mailpit}/api/v1/search?query=${query}`)).json();
    const found = list.messages?.find((message) => message.Subject === subject);
    if (found) return (await fetch(`${mailpit}/api/v1/message/${found.ID}`)).json();
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

/**
 * A notice sent signed out, through the app's site (3c design, sections 7.1, 7.2 and 12): an Article 16 notice that the
 * first account's post is illegal, in a category of the lane that is read last, so that no urgent alert goes out, with a
 * name and an address. The human check is Turnstile's, with the test secret that passes any token. It answers a
 * reference and the notice's own token, which opens the status page; the receipt goes to the address at once, and the
 * token in its link opens the same page and shows what korbat knows of the address. A token travels in a POST's body,
 * never in an address.
 */
async function signedOutNotice(postId) {
  const notifier = `notifier-${randomUUID()}@korbat.local`;
  const notice = {
    ground: "illegal",
    category: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD",
    explanation: "Sent by the smoke test: nothing is wrong with this post.",
    bonaFide: true,
    name: "Smoke Test",
    email: notifier,
    targets: [{ kind: "post", id: postId }],
    turnstileToken: TURNSTILE_TOKEN,
  };
  const sent = await withTurnstile("/api/notices", notice);
  const ref = sent.body?.ref;
  const token = sent.body?.token;
  if (!check("signed out, a notice of illegality is taken through the app's site: a reference and a token", sent.status === 201 && NOTICE_REF.test(ref ?? "") && typeof token === "string" && token.length === 43, sent.summary)) return;

  const status = await api("/api/notices/status", { json: { ref, token } });
  check("its status page opens with the token and shows the post's link, undecided", status.status === 200 && status.body?.ref === ref && onePostUndecided(status.body.items, postId), `${status.summary}, ${itemsSummary(status.body?.items)}`);
  // Opened with the notice's own token, the page says that a contact was given and nothing of what korbat knows about the address.
  const contact = status.body?.contact;
  check("the page says that a contact was given, and no more", contact?.given === true && contact.confirmed === null && contact.stopped === null, JSON.stringify(contact ?? null));
  const other = await api("/api/notices/status", { json: { ref, token: randomBytes(32).toString("base64url") } });
  check("another token finds no notice", other.status === 404 && other.body?.error?.code === "notice_not_found", other.summary);

  const receipt = await mailTo(notifier, `korbat received your report ${ref}`);
  if (!check("the receipt arrives in Mailpit under the notice's reference", receipt !== null && typeof receipt.Text === "string" && receipt.Text.includes(ref), receipt === null ? "no receipt within 30 s" : "a receipt without the reference")) return;
  // The mail's link carries the contact's mail token in its fragment, which no server log sees.
  const mailToken = /[/]notice[/]N-[A-Z2-7]{10}#t=([A-Za-z0-9_-]{43})/.exec(receipt.Text)?.[1];
  if (!check("the receipt links to the notice's page with a token of its own", typeof mailToken === "string" && mailToken !== token)) return;
  const byMail = await api("/api/notices/status", { json: { ref, token: mailToken } });
  const known = byMail.body?.contact;
  check(
    "the mail's token opens the same page, with the address not yet confirmed and not stopped",
    byMail.status === 200 && byMail.body?.ref === ref && onePostUndecided(byMail.body.items, postId) && known?.given === true && known.confirmed === false && known.stopped === false,
    `${byMail.summary}, ${JSON.stringify(known ?? null)}`,
  );
}

/**
 * A second account, since the first one's session is gone by now and a deleted account could not be
 * granted a role: the lifecycle of section 7 of the 1b design, end to end, on the bearer session. On its
 * way it reports the first account's post, and its export shows that report.
 */
async function accountLifecycle(reportedPostId) {
  const email = `lifecycle-${randomUUID()}@korbat.local`;
  const handle = `life_${randomBytes(4).toString("hex")}`;
  const start = await withTurnstile("/api/auth/email/start", { email, turnstileToken: TURNSTILE_TOKEN, deviceId, platform: "ios" });
  if (!check("lifecycle: email/start", start.status === 200, start.summary)) return;
  const { flowId } = start.body;
  const verify = await api("/api/auth/email/verify", { json: { flowId, code: await emailCode(email) } });
  if (!check("lifecycle: sign-up code read from Mailpit", verify.body?.result === "signup_required", verify.summary)) return;
  const complete = await api("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-01-01", termsVersion: terms } });
  if (!check("lifecycle: sign-up returns a bearer token", typeof complete.body?.token === "string", complete.summary)) return;
  const onboarding = await api("/api/auth/onboarding/handle", { json: { handle, displayName: "Lifecycle Test" }, token: complete.body.token });
  if (!check("lifecycle: onboarding rotates the token", typeof onboarding.body?.token === "string", onboarding.summary)) return;
  const token = onboarding.body.token;

  const edited = await api("/api/me/profile", { method: "PATCH", json: { bio: "Here for the smoke test." }, token });
  check("edit the bio", edited.status === 200 && edited.body?.profile?.bio === "Here for the smoke test.", edited.summary);
  const renamed = `${handle}_2`;
  const changed = await api("/api/me/handle", { json: { handle: renamed }, token });
  check("change the handle", changed.status === 200 && changed.body?.profile?.handle === renamed, changed.summary);
  const reportRef = await signedInReport(reportedPostId, token);
  const exported = await send("/api/account/export", { method: "POST", token });
  const zip = exported.bytes[0] === 0x50 && exported.bytes[1] === 0x4b;
  check("the export is a ZIP", exported.status === 200 && exported.headers.get("content-type") === "application/zip" && zip, `HTTP ${exported.status}, ${exported.headers.get("content-type")}, ${exported.bytes.length} bytes`);
  if (zip) exportedModeration(exported.bytes, reportRef, reportedPostId);
  const posted = await api("/api/posts", { json: { body: "a post that will not outlive its author" }, token });
  check("lifecycle: create a post", posted.status === 201 && typeof posted.body?.id === "string", posted.summary);

  const deletion = await api("/api/account/delete/start", { json: {}, token });
  if (!check("delete/start", deletion.status === 200 && typeof deletion.body?.flowId === "string", deletion.summary)) return;
  // The sign-up code email is still in the box, so the deletion code is picked by its subject.
  const code = await emailCode(email, "Confirm deleting your korbat account");
  const confirmed = await api("/api/account/delete/confirm", { json: { flowId: deletion.body.flowId, code, handle: renamed }, token });
  check("delete/confirm with the code from Mailpit and the handle typed", confirmed.status === 204, confirmed.summary);
  const profile = await api(`/api/profiles/${renamed}`);
  check("the deleted profile is not found", profile.status === 404 && profile.body?.error?.code === "not_found", profile.summary);
  const me = await api("/api/me", { token });
  check("the deleted account's session is gone", me.status === 401, me.summary);
  const latest = await api("/api/timeline/latest");
  check("its post has left the Latest timeline", Array.isArray(latest.body?.items) && !latest.body.items.some((item) => item.post?.id === posted.body?.id), latest.summary);
}

async function main() {
  const page = await fetch(`${base}/`);
  const csp = page.headers.get("content-security-policy") ?? "";
  check("web CSP allows the Turnstile widget", csp.includes("script-src 'self' https://challenges.cloudflare.com") && csp.includes("frame-src https://challenges.cloudflare.com"));

  await consoleSite();
  await explore();

  const unknown = await withTurnstile("/api/auth/password/signin", { email: `nobody-${randomUUID()}@korbat.local`, password: "not a real password", turnstileToken: TURNSTILE_TOKEN, deviceId, platform: "ios" });
  check("password sign-in for an unknown email", unknown.body?.error?.code === "invalid_credentials", unknown.summary);

  const start = await withTurnstile("/api/auth/email/start", { email, turnstileToken: TURNSTILE_TOKEN, deviceId, platform: "ios" });
  if (!check("email/start", start.status === 200, start.summary)) return;
  const { flowId } = start.body;
  const verify = await api("/api/auth/email/verify", { json: { flowId, code: await emailCode(email) } });
  if (!check("sign-up code read from Mailpit", verify.body?.result === "signup_required", verify.summary)) return;
  const complete = await api("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-01-01", termsVersion: terms } });
  if (!check("sign-up returns a bearer token", typeof complete.body?.token === "string", complete.summary)) return;

  const onboarding = await api("/api/auth/onboarding/handle", { json: { handle, displayName: "Smoke Test" }, token: complete.body.token });
  if (!check("onboarding rotates the token", typeof onboarding.body?.token === "string", onboarding.summary)) return;
  const token = onboarding.body.token;
  const me = await api("/api/me", { token });
  check("/api/me for the new account", me.status === 200 && me.body?.user?.email === email && me.body?.user?.role === "user", me.summary);

  const created = await api("/api/posts", { json: { body: "smoke test post" }, token });
  check("create a post", created.status === 201 && typeof created.body?.id === "string", created.summary);
  const latest = await api("/api/timeline/latest");
  check("the post appears in the public Latest timeline", Array.isArray(latest.body?.items) && latest.body.items.some((item) => item.post?.id === created.body?.id), latest.summary);
  const profile = await api(`/api/profiles/${handle}`);
  check("the profile counts one post", profile.body?.counts?.posts === 1, profile.summary);

  await images(token);
  if (worstCase) await worstCaseImages(token);

  const output = execFileSync(compose[0], [...compose.slice(1), "run", "--rm", "--no-deps", "-T", "api", "node", "dist/grant-role.js", email, "moderator"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  check("grant-role CLI", output.includes("role user -> moderator; every session revoked"), output.trim());
  const after = await api("/api/me", { token });
  check("the session stops working after the role change", after.status === 401, after.summary);

  // The post both the signed-in report and the signed-out notice name: the first account's, which is still there.
  const reportedPostId = created.body?.id;
  if (!check("the first account's post can be reported", typeof reportedPostId === "string")) return;
  await accountLifecycle(reportedPostId);
  await signedOutNotice(reportedPostId);
}

try {
  await main();
} catch (err) {
  check("smoke test ran to the end", false, err instanceof Error ? err.message : String(err));
}
console.log(failures === 0 ? "smoke test passed" : `smoke test FAILED: ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
```

## Step 4: verify: typecheck

```bash
pnpm typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`
- `ERR_PNPM`

Observed on the dry run:

```text
(no output)
```

## Step 5: verify: test

```bash
pnpm -r --if-present run test --testTimeout=20000
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
packages/contracts test:       Tests  294 passed (294)
packages/db test:       Tests  60 passed (60)
packages/media-protocol test:       Tests  21 passed (21)
packages/rules test:       Tests  47 passed (47)
apps/worker test:       Tests  45 passed (45)
apps/admin test:       Tests  372 passed (372)
apps/app test:       Tests  205 passed (205)
apps/api test:       Tests  715 passed | 1088 skipped (1803)
```

## Step 6: verify: generate

```bash
pnpm --filter @korbat/db generate
```

Expected output contains:

- `No schema changes`

Observed on the dry run:

```text
No schema changes, nothing to migrate 😴
```

## Step 7: verify: smoke-syntax

```bash
node --check scripts/smoke-auth-stack.mjs && echo smoke-syntax-ok
```

Expected output contains:

- `smoke-syntax-ok`

Observed on the dry run:

```text
smoke-syntax-ok
```

## Step 8: verify: export

```bash
(cd apps/app && EXPO_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA EXPO_PUBLIC_CONTACT_EMAIL=contact@korbat.local npx expo export --platform web 2>&1 | tail -8)
```

Expected output contains:

- `Exported`

Must not contain:

- `Error`
- `error:`

Observed on the dry run:

```text
Exported: dist
```

## Step 9: verify: integration-own

```bash
cd apps/api && set -a && . ./.env && set +a && node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts --retry=2 --testTimeout=20000 test/integration/moderation-export.test.ts
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
Tests  5 passed (5)
```

## Step 10: verify: api-bundle

```bash
pnpm --filter @korbat/api build 2>&1 | tail -2 && node --check apps/api/dist/index.js && node --check apps/api/dist/staff.js && echo bundle-ok
```

Expected output contains:

- `Build success`
- `bundle-ok`

Must not contain:

- `SyntaxError`

Observed on the dry run:

```text
Build success
bundle-ok
```

## Step 11: verify: stack-down

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml down && echo down-ok
```

Expected output contains:

- `down-ok`

Observed on the dry run:

```text
down-ok
```

## Step 12: verify: build

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml build > .data/stack-build.log 2>&1; echo build-exit=$?; tail -3 .data/stack-build.log
```

Expected output contains:

- `build-exit=0`

Observed on the dry run:

```text
build-exit=0
```

## Step 13: verify: stack-up

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --wait && echo up-ok
```

Expected output contains:

- `up-ok`

Observed on the dry run:

```text
up-ok
```

## Step 14: verify: test-database

```bash
node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `migrations applied`
- `test database ready: korbat_test`

Observed on the dry run:

```text
migrations applied
test database ready: korbat_test
```

## Step 15: verify: smoke

```bash
node scripts/smoke-auth-stack.mjs --base http://localhost:8080 --console http://localhost:$CONSOLE_PORT --mailpit http://localhost:58025 --terms draft-2026-09 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `smoke test passed`

Observed on the dry run:

```text
smoke test passed
```

## Step 16: verify: stack-stop

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml stop caddy api worker cloudflared 2>/dev/null; docker compose -f infra/compose.yml -f infra/compose.dev.yml ps --format '{{.Name}} {{.Status}}'
```

Expected output contains:

- `postgres-1 Up`

Observed on the dry run:

```text
korbat-postgres-1 Up About a minute (healthy)
```

## Step 17: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/account/context.ts`
- `apps/api/src/account/flows/export.ts`
- `apps/api/src/account/index.ts`
- `apps/api/src/moderation/access.ts`
- `apps/api/src/moderation/author.ts`
- `apps/api/src/moderation/export.ts`
- `apps/api/src/moderation/index.ts`
- `apps/api/src/moderation/repo.ts`
- `apps/api/src/moderation/reports.ts`
- `apps/api/test/account/deletion.test.ts`
- `apps/api/test/account/export.test.ts`
- `apps/api/test/integration/moderation-export.test.ts`
- `apps/api/test/moderation-export.test.ts`
- `apps/app/src/app/terms.tsx`
- `apps/app/src/lib/terms.ts`
- `apps/app/test/terms.test.tsx`
- `packages/contracts/src/account.ts`
- `packages/contracts/test/account.test.ts`
- `scripts/smoke-auth-stack.mjs`

## Step 18: commit

```bash
git add -A
git commit -q -m "feat(api,app,contracts): the export, the terms and the stack check for moderation cases: the account's export gains its last member, moderation, from ModerationForAccount.exportFor: the decisions the person was told of with their statements, their appeals, and their own reports as their screens show them, never a reporter, a staff member, a staff text of a decision without a measure or a sealed image; the terms page gains the rulebook's texts, how moderators decide, appeals, reports and notices and the retention periods, every number and every rule's text read from its constant and held there by table tests; the smoke test sends a report signed out through the app's site, reads its status page and checks that the staff routes are refused on the app's site and answered on the console's" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(api,app,contracts): the export, the terms and the stack check for moderation cases: the account's export gains its last member, moderation, from ModerationForAccount.exportFor: the decisions the person was told of with their statements, their appeals, and their own reports as their screens show them, never a reporter, a staff member, a staff text of a decision without a measure or a sealed image; the terms page gains the rulebook's texts, how moderators decide, appeals, reports and notices and the retention periods, every number and every rule's text read from its constant and held there by table tests; the smoke test sends a report signed out through the app's site, reads its status page and checks that the staff routes are refused on the app's site and answered on the console's`.

## Report format (mandatory)

```text
TASK 10 REPORT
Files written: <count, expected 19>
Failing-test step (the error line): <paste>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "generate": <paste the expected lines as printed>
Verify "smoke-syntax": <paste the expected lines as printed>
Verify "export": <paste the expected lines as printed>
Verify "integration-own": <paste the expected lines as printed>
Verify "api-bundle": <paste the expected lines as printed>
Verify "stack-down": <paste the expected lines as printed>
Verify "build": <paste the expected lines as printed>
Verify "stack-up": <paste the expected lines as printed>
Verify "test-database": <paste the expected lines as printed>
Verify "smoke": <paste the expected lines as printed>
Verify "stack-stop": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
