import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import pino from "pino";
import { beforeAll, expect, test } from "vitest";
import type { AppealsReviewedParams, CaseDecidedParams, RuleId } from "@korbat/contracts";
import { closeDb, createDb, profiles, type Db } from "@korbat/db";
import type { ActiveStaffSession, AuthForModeration, StaffStepUpConfirmed } from "../../src/auth";
import { createAuthRepo } from "../../src/auth/repo";
import { verifyStepUp } from "../../src/auth/staff/step-up";
import { loadConfig } from "../../src/config";
import { MemoryStore, type RateLimitStore } from "../../src/middleware/rate-limit";
import { createModeration, type DecideOutcome } from "../../src/moderation";
import { decide, type DecideOptions } from "../../src/moderation/decide";
import { recordIntake } from "../../src/moderation/intake";
import { socialForModeration } from "../../src/social";
import { SoftAuthenticator } from "../auth/soft-authenticator";
import { flowHarness } from "./flow-harness";
import { act, ageStandingForTest, casesMedia, decisionParams, ground, moderationCounts, newPostRow, noAuthForModeration, removeDecided, reviewParams, timed, uuids, type DecisionInput, type ReviewInput, type TestStaff } from "./moderation-fixtures";
import { enrolKey } from "./staff-enrolment";
import { TEST_CONSOLE, issueEnrolment, newStaffAccount } from "./staff-fixtures";
import { signedIn, stepUpAssertion } from "./staff-step-up";

/**
 * Decisions that commit (3c design, section 12). A committed decision carries an audit row for good, and audit-verify
 * refuses every case_decided row whose step-up is not a real assertion of its actor's staff key over exactly that action.
 * So a test that commits a decision confirms it as the console does: a staff account with a key enrolled through the
 * enrolment flow on the software authenticator, a staff session opened by the sign-in flow, step-up options for the
 * action, the authenticator's assertion, the auth module's verification, and then the moderation module's decide.
 */

/** A staff account whose key the software authenticator holds, signed in at the test console. */
export interface RealStaff extends TestStaff {
  handle: string;
  soft: SoftAuthenticator;
  credentialId: string;
  session: ActiveStaffSession;
  /** The signature counter the authenticator last reported; each use reports the next. */
  counter: number;
}

export interface DeciderWorld {
  authDb: Db;
  migrateDb: Db;
  /** The moderation module on the API's pool, as the server builds it. */
  moderation: ReturnType<typeof createModeration>;
  /** A new staff account with a profile, a real key and a staff session. */
  staff(role?: "moderator" | "admin"): Promise<RealStaff>;
  /** A verified confirmation of exactly these params, by the member's own key in the member's session. */
  confirm(member: RealStaff, caseId: string, params: CaseDecidedParams): Promise<StaffStepUpConfirmed>;
  /** A whole confirmed decision on the case: the params as the console builds them, the confirmation, and decide. */
  decideAs(member: RealStaff, caseId: string, input?: DecisionInput, options?: DecideOptions): Promise<DecideOutcome>;
  /** A verified confirmation of exactly this review of the decision, by the member's own key in the member's session. */
  confirmReview(member: RealStaff, decisionId: string, params: AppealsReviewedParams): Promise<StaffStepUpConfirmed>;
  /** A whole confirmed review of the decision's pending appeal: the params as the console builds them, the confirmation, and review. */
  reviewAs(member: RealStaff, decisionId: string, input?: ReviewInput): Promise<DecideOutcome>;
  /** Removes the staff profiles this world made (their decisions, findings and texts must be gone by then) and closes its pools. */
  close(options?: { keepStaff?: boolean }): Promise<void>;
}

/** What a test may give the world in place of its own: the auth module's interface (none unless given: every member then throws) and the limit store. */
export interface DeciderOptions {
  auth?: AuthForModeration;
  rateLimitStore?: RateLimitStore;
}

export function deciderWorld(apiDb: Db, options: DeciderOptions = {}): DeciderWorld {
  const config = loadConfig();
  const authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
  // The migrate role issues enrolment links, which only it may; the test environment carries its URL.
  const migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
  const repo = createAuthRepo(authDb);
  const h = flowHarness(repo, { console: TEST_CONSOLE });
  // Unless a test hands over the auth module's interface, the module is built without one: what follows a decision's
  // commit (the statement's mail, the staff alerts) then fails there, is logged, and leaves the decision as committed.
  const moderation = createModeration({
    apiDb,
    auth: options.auth ?? noAuthForModeration(),
    social: socialForModeration(apiDb),
    media: casesMedia(apiDb),
    rateLimitStore: options.rateLimitStore ?? new MemoryStore(),
    config,
    logger: pino({ level: "silent" }),
  });
  const members: RealStaff[] = [];
  /**
   * The harness's clock stands still unless moved, and a step-up challenge lives ten minutes from it; the audit row is
   * stamped by the database's clock. So the harness's clock is brought to the real time before every flow.
   */
  const sync = () => h.clock.advance(Date.now() - h.clock.ms());

  async function staff(role: "moderator" | "admin" = "moderator"): Promise<RealStaff> {
    sync();
    const { user } = await newStaffAccount(authDb, repo, role);
    const handle = `st_${randomBytes(5).toString("hex")}`;
    await apiDb.insert(profiles).values({ id: user.id, handle, displayName: "Staff" });
    const soft = new SoftAuthenticator();
    const enrolled = await enrolKey(h, soft, (await issueEnrolment(migrateDb, user.id)).token);
    const { session } = await signedIn(h, soft, enrolled.credentialId, 1);
    const member: RealStaff = { id: user.id, keyId: enrolled.key.id, role, handle, soft, credentialId: enrolled.credentialId, session, counter: 1 };
    members.push(member);
    return member;
  }

  async function confirm(member: RealStaff, caseId: string, params: CaseDecidedParams): Promise<StaffStepUpConfirmed> {
    sync();
    const request = { action: "case_decided" as const, target: { type: "case" as const, id: caseId }, params };
    const stepUp = await stepUpAssertion(h, member.soft, member.credentialId, member.session, request, { counter: ++member.counter });
    return verifyStepUp(h.deps, member.session, request, stepUp, { ...h.ctx, requestId: `req-${randomUUID()}` });
  }

  async function decideAs(member: RealStaff, caseId: string, input: DecisionInput = {}, options: DecideOptions = {}): Promise<DecideOutcome> {
    const params = await decisionParams(apiDb, member, caseId, input);
    const confirmed = await confirm(member, caseId, params);
    const ctx = { requestId: `req-${randomUUID()}` };
    // With allKinds the module's own decide is called below the route, as decideWith does: the routes' list of kinds is lifted.
    const outcome = options.allKinds ? await decide(moderation.deps, member.session, confirmed, ctx, options) : await moderation.forStaff.decide(member.session, confirmed, ctx);
    // What a decision starts after its commit (the statement's mail, the staff alerts) has ended before the test goes on.
    await moderation.settle();
    return outcome;
  }

  async function confirmReview(member: RealStaff, decisionId: string, params: AppealsReviewedParams): Promise<StaffStepUpConfirmed> {
    sync();
    const request = { action: "appeals_reviewed" as const, target: { type: "decision" as const, id: decisionId }, params };
    const stepUp = await stepUpAssertion(h, member.soft, member.credentialId, member.session, request, { counter: ++member.counter });
    return verifyStepUp(h.deps, member.session, request, stepUp, { ...h.ctx, requestId: `req-${randomUUID()}` });
  }

  async function reviewAs(member: RealStaff, decisionId: string, input: ReviewInput = {}): Promise<DecideOutcome> {
    const params = await reviewParams(apiDb, member, decisionId, input);
    const outcome = await moderation.forStaff.review(member.session, await confirmReview(member, decisionId, params), { requestId: `req-${randomUUID()}` });
    // As after a decision: what the review started after its commit has ended before the test goes on.
    await moderation.settle();
    return outcome;
  }

  async function close(options: { keepStaff?: boolean } = {}): Promise<void> {
    try {
      if (!options.keepStaff && members.length > 0) await migrateDb.execute(sql`delete from profiles where id = any(${uuids(members.map((member) => member.id))})`);
    } finally {
      await Promise.all([closeDb(authDb), closeDb(migrateDb)]);
    }
  }

  return { authDb, migrateDb, moderation, staff, confirm, decideAs, confirmReview, reviewAs, close };
}

// ---------------------------------------------------------------- decideForTest

let world: DeciderWorld | null = null;
let admin: Promise<RealStaff> | null = null;
/** The posts decideForTest decided in this test file. */
const decidedPosts = new Set<string>();
/** The accounts suspendForTest suspended in this test file: their account cases go with closeDecisions. */
const decidedAccounts = new Set<string>();

/** The id of a committed decision, or a failure that says why none committed. */
function decided(outcome: DecideOutcome, what: string): string {
  if (typeof outcome === "string") throw new Error(`decideForTest: ${what} was not recorded (${outcome})`);
  return outcome.decisionId;
}

/**
 * Puts a post into a moderation state the only way one comes about: by a real, confirmed decision (3c design, section
 * 12). The suites of posting, timelines, Explore and images used to write posts.state themselves; the posts' guard now
 * refuses that for the API role, and nothing but the ledger of measures moves a post's level.
 *
 * - `withheld`: an admin's own finding under R1 opens a case on the post, and an interim decision withholds it.
 * - `removed`: the same finding, and a final decision removes it, which closes the case.
 * - `visible`: what was done is undone: the post's open case is closed by a final decision that finds no breach, which
 *   ends its interim withhold, and every removal in force is reversed in full by a correction.
 *
 * It takes the API's pool. The staff account, its key and its session are made once for each test file; closeDecisions
 * removes what the decisions left.
 */
export async function decideForTest(apiDb: Db, postId: string, state: "withheld" | "removed" | "visible"): Promise<void> {
  world ??= deciderWorld(apiDb);
  admin ??= world.staff("admin");
  const [w, staff] = [world, await admin];
  decidedPosts.add(postId);
  if (state === "visible") {
    const [open] = await apiDb.execute<{ id: string }>(sql`select id from cases where target_type = 'post' and target_id = ${postId}::uuid and closed_at is null`);
    if (open) decided(await w.decideAs(staff, open.id, { kind: "final", outcome: "no_violation" }), "the closing decision");
    const removals = await apiDb.execute<{ decision_id: string; case_id: string }>(sql`select decision_id, case_id from measures_in_force where post_id = ${postId}::uuid and kind = 'remove'`);
    for (const removal of removals) {
      decided(await w.decideAs(staff, removal.case_id, { kind: "correction", reviewsDecisionId: removal.decision_id, actions: [act("restore")] }), "the correction");
    }
    return;
  }
  const recorded = await recordIntake(w.moderation.deps, { ground: ground.finding(staff.id, "R1"), live: [{ type: "post", id: postId, position: 1 }] });
  const caseId = recorded.items[0]!.caseId!;
  decided(await w.decideAs(staff, caseId, state === "withheld" ? { kind: "interim", actions: [act("withhold")] } : { kind: "final", actions: [act("remove")] }), `the decision that makes the post ${state}`);
}

/**
 * Gives an account `n` strikes the way strikes come about (3e design, section 12): for each, a post the account makes
 * now, an admin's own finding on it under the rule, and a final removal through the decide route's own code, which signs
 * the strike the database computes. Each decision commits, and so is told to the account, before its next post is made,
 * so each post is newer than the newest strike and each removal gives one. Answers the decisions, oldest first; fails when
 * one gave no strike. closeDecisions removes what it committed, as for decideForTest; the account's posts stay.
 */
export async function strikeForTest(apiDb: Db, accountId: string, n: number, rule: RuleId = "R1"): Promise<string[]> {
  world ??= deciderWorld(apiDb);
  admin ??= world.staff("admin");
  const [w, staff] = [world, await admin];
  const decisions: string[] = [];
  for (let i = 0; i < n; i++) {
    // Made in a statement of its own after the previous decision committed: later than the time that decision was told.
    const postId = await newPostRow(apiDb, accountId, { createdAt: sql`clock_timestamp()`, body: `a post that breaks ${rule}` });
    decidedPosts.add(postId);
    const recorded = await recordIntake(w.moderation.deps, { ground: ground.finding(staff.id, rule), live: [{ type: "post", id: postId, position: 1 }] });
    const id = decided(await w.decideAs(staff, recorded.items[0]!.caseId!, { kind: "final", ruleId: rule, actions: [act("remove")] }), "a removal that gives a strike");
    const [struck] = await apiDb.execute<{ n: number }>(sql`select count(*)::int as n from decision_actions where decision_id = ${id}::uuid and kind = 'strike'`);
    if (struck!.n !== 1) throw new Error("strikeForTest: the removal gave no strike");
    decisions.push(id);
  }
  return decisions;
}

/** What suspendForTest made: the suspension's decision and case, and the decision it rests on. */
export interface SuspendedForTest {
  decisionId: string;
  caseId: string;
  basisDecisionId: string;
}

/**
 * Suspends an account the way a suspension comes about (3e design, section 12), through the decide route's own code
 * (moderation.forStaff.decide, with a real confirmation by an admin's key).
 *
 * At once (the default): on the basis `threat`, which it makes first: a post the account makes now, an admin's own
 * finding on it under R5 and a final removal, which gives the strike the database computes. Then an admin's finding under
 * R5 on the account opens its case, and a final decision on it holds `{ kind: "suspend", days, announced: false }`. The
 * suspension starts with that decision, and every write of the account is refused from then on.
 *
 * Announced (Task 4, `announced: true`): the ladder's first step: three strikes (strikeForTest, under R1), an admin's own
 * finding under R1 on the account, and a final decision that holds `{ kind: "suspend", days, announced: true }` (3 days
 * unless said, the first rung). Nothing is restricted: the world's decisions are mailed by no auth module, so the
 * statement's mail stays pending and the suspension has no start until a test records the mail's outcome or ages it.
 * `basisDecisionId` is then the newest strike's decision.
 *
 * closeDecisions removes what it committed, the account's case included; the account's posts and profile stay.
 */
export async function suspendForTest(apiDb: Db, accountId: string, options: { days?: number; announced?: boolean } = {}): Promise<SuspendedForTest> {
  if (options.announced === true) return announceForTest(apiDb, accountId, options.days ?? 3);
  world ??= deciderWorld(apiDb);
  admin ??= world.staff("admin");
  const [w, staff] = [world, await admin];
  const postId = await newPostRow(apiDb, accountId, { createdAt: sql`clock_timestamp()`, body: "a post with a direct threat" });
  decidedPosts.add(postId);
  decidedAccounts.add(accountId);
  const finding = await recordIntake(w.moderation.deps, { ground: ground.finding(staff.id, "R5"), live: [{ type: "post", id: postId, position: 1 }] });
  const basisDecisionId = decided(await w.decideAs(staff, finding.items[0]!.caseId!, { kind: "final", ruleId: "R5", actions: [act("remove")] }), "the R5 removal a suspension at once rests on");
  const [profile] = await apiDb.execute<{ handle: string }>(sql`select handle from profiles where id = ${accountId}::uuid`);
  const onAccount = await recordIntake(w.moderation.deps, { ground: ground.finding(staff.id, "R5"), live: [{ type: "account", id: accountId, position: 1, namedHandle: profile!.handle }] });
  const caseId = onAccount.items[0]!.caseId!;
  const decisionId = decided(await w.decideAs(staff, caseId, { kind: "final", ruleId: "R5", actions: [timed("suspend", options.days ?? 7, false)] }), "the suspension at once");
  return { decisionId, caseId, basisDecisionId };
}

/** The account case an admin's own finding under the rule opens on the account (or joins, when one is open). */
async function accountCaseForTest(w: DeciderWorld, staff: RealStaff, apiDb: Db, accountId: string, rule: RuleId): Promise<string> {
  const [profile] = await apiDb.execute<{ handle: string }>(sql`select handle from profiles where id = ${accountId}::uuid`);
  const onAccount = await recordIntake(w.moderation.deps, { ground: ground.finding(staff.id, rule), live: [{ type: "account", id: accountId, position: 1, namedHandle: profile!.handle }] });
  return onAccount.items[0]!.caseId!;
}

/** An announced suspension of the ladder's first step: three strikes under R1, then the measure on the account's case. */
async function announceForTest(apiDb: Db, accountId: string, days: number): Promise<SuspendedForTest> {
  world ??= deciderWorld(apiDb);
  admin ??= world.staff("admin");
  const [w, staff] = [world, await admin];
  const strikes = await strikeForTest(apiDb, accountId, 3, "R1");
  decidedAccounts.add(accountId);
  const caseId = await accountCaseForTest(w, staff, apiDb, accountId, "R1");
  const decisionId = decided(await w.decideAs(staff, caseId, { kind: "final", ruleId: "R1", actions: [timed("suspend", days, true)] }), "the announced suspension");
  return { decisionId, caseId, basisDecisionId: strikes.at(-1)! };
}

/** What terminateForTest made: the termination's decision and case, the suspension for the first threat, and the two R5 decisions it rests on. */
export interface TerminatedForTest {
  decisionId: string;
  caseId: string;
  suspensionId: string;
  /** The R5 decision the earlier suspension rests on, and the newer one about a post made after that suspension. */
  earlierDecisionId: string;
  basisDecisionId: string;
}

/**
 * Terminates an account at once, the only path to a termination at once (3e design, section 12): an R5 decision about a
 * post of the account and a suspension at once on it (suspendForTest), that suspension aged past its end
 * (ageStandingForTest, as the migrator), a post the account makes after it and a second R5 decision on that post, then
 * an admin's own finding under R5 on the account and a final decision that holds `{ kind: "terminate", days: null,
 * announced: false }`, on the basis `threat_repeat`. The account is suspended without end from that decision; it is not
 * taken down before the decision is final for it. closeDecisions removes what it committed; the posts and profile stay.
 */
export async function terminateForTest(apiDb: Db, accountId: string): Promise<TerminatedForTest> {
  const first = await suspendForTest(apiDb, accountId, { days: 7 });
  const [w, staff] = [world!, await admin!];
  // The first suspension ends: its period, and every time of the account's ledger, moved back past its 7 days.
  await ageStandingForTest(w.migrateDb, accountId, "8 days");
  // A second threat, in a post made after the account was told of that suspension.
  const postId = await newPostRow(apiDb, accountId, { createdAt: sql`clock_timestamp()`, body: "a second post with a direct threat" });
  decidedPosts.add(postId);
  const finding = await recordIntake(w.moderation.deps, { ground: ground.finding(staff.id, "R5"), live: [{ type: "post", id: postId, position: 1 }] });
  const basisDecisionId = decided(await w.decideAs(staff, finding.items[0]!.caseId!, { kind: "final", ruleId: "R5", actions: [act("remove")] }), "the second R5 removal");
  const caseId = await accountCaseForTest(w, staff, apiDb, accountId, "R5");
  const decisionId = decided(await w.decideAs(staff, caseId, { kind: "final", ruleId: "R5", actions: [timed("terminate", null, false)] }), "the termination at once");
  return { decisionId, caseId, suspensionId: first.decisionId, earlierDecisionId: first.basisDecisionId, basisDecisionId };
}

/**
 * Removes what decideForTest committed in this test file, if it was used, and closes the pools it opened: the cases of
 * the posts it decided with their items, decisions, measures, texts, snapshots and intakes, and the staff account's
 * profile; the posts' levels are derived again. Two kinds of row stay, and no suite counts either. The audit rows (the
 * staff account's enrolment and sign-in, and one case_decided row for each decision): the audit log is an append-only
 * chain, and audit-verify refuses a record with a row gone. And the staff account's rows in the auth schema (the account,
 * its key, its session and its events), which the auth suites leave for their own accounts too. Calling it again does
 * nothing.
 */
export async function closeDecisions(): Promise<void> {
  const [used, member, posts, accounts] = [world, admin, [...decidedPosts], [...decidedAccounts]];
  world = null;
  admin = null;
  decidedPosts.clear();
  decidedAccounts.clear();
  if (!used) return;
  try {
    const staff = member ? await member.catch(() => null) : null;
    await removeDecided(used.migrateDb, posts, staff ? [staff.id] : [], accounts);
  } finally {
    await used.close({ keepStaff: true });
  }
}

/**
 * Holds a test file that uses decideForTest to leaving no moderation row behind. Called last inside the file's describe,
 * with a getter of its pool: it reads the moderation tables' row counts before the file's first test, and adds the file's
 * last test, which removes what decideForTest committed and expects the counts unchanged. The file's own posts and
 * profiles stay, as they always did.
 */
export function leavesNoModerationRows(db: () => Db): void {
  let before: Record<string, number>;
  beforeAll(async () => {
    before = await moderationCounts(db());
  });
  test("this file left no moderation row behind: what put its posts into their states is removed, and the moderation tables hold what they held before it", async () => {
    await closeDecisions();
    expect(await moderationCounts(db())).toEqual(before);
  }, 30_000);
}
