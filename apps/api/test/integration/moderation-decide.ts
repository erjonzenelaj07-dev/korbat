import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import pino from "pino";
import { beforeAll, expect, test } from "vitest";
import type { CaseDecidedParams } from "@korbat/contracts";
import { closeDb, createDb, profiles, type Db } from "@korbat/db";
import type { ActiveStaffSession, StaffStepUpConfirmed } from "../../src/auth";
import { createAuthRepo } from "../../src/auth/repo";
import { verifyStepUp } from "../../src/auth/staff/step-up";
import { loadConfig } from "../../src/config";
import { createModeration, type DecideOutcome } from "../../src/moderation";
import { recordIntake } from "../../src/moderation/intake";
import { socialForModeration } from "../../src/social";
import { SoftAuthenticator } from "../auth/soft-authenticator";
import { flowHarness } from "./flow-harness";
import { act, casesMedia, decisionParams, ground, moderationCounts, removeDecided, uuids, type DecisionInput, type TestStaff } from "./moderation-fixtures";
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
  decideAs(member: RealStaff, caseId: string, input?: DecisionInput): Promise<DecideOutcome>;
  /** Removes the staff profiles this world made (their decisions, findings and texts must be gone by then) and closes its pools. */
  close(options?: { keepStaff?: boolean }): Promise<void>;
}

export function deciderWorld(apiDb: Db): DeciderWorld {
  const config = loadConfig();
  const authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
  // The migrate role issues enrolment links, which only it may; the test environment carries its URL.
  const migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
  const repo = createAuthRepo(authDb);
  const h = flowHarness(repo, { console: TEST_CONSOLE });
  const moderation = createModeration({ apiDb, social: socialForModeration(apiDb), media: casesMedia(apiDb), config, logger: pino({ level: "silent" }) });
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

  async function decideAs(member: RealStaff, caseId: string, input: DecisionInput = {}): Promise<DecideOutcome> {
    const params = await decisionParams(apiDb, member, caseId, input);
    return moderation.forStaff.decide(member.session, await confirm(member, caseId, params), { requestId: `req-${randomUUID()}` });
  }

  async function close(options: { keepStaff?: boolean } = {}): Promise<void> {
    try {
      if (!options.keepStaff && members.length > 0) await migrateDb.execute(sql`delete from profiles where id = any(${uuids(members.map((member) => member.id))})`);
    } finally {
      await Promise.all([closeDb(authDb), closeDb(migrateDb)]);
    }
  }

  return { authDb, migrateDb, moderation, staff, confirm, decideAs, close };
}

// ---------------------------------------------------------------- decideForTest

let world: DeciderWorld | null = null;
let admin: Promise<RealStaff> | null = null;
/** The posts decideForTest decided in this test file. */
const decidedPosts = new Set<string>();

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
 * Removes what decideForTest committed in this test file, if it was used, and closes the pools it opened: the cases of
 * the posts it decided with their items, decisions, measures, texts, snapshots and intakes, and the staff account's
 * profile; the posts' levels are derived again. Two kinds of row stay, and no suite counts either. The audit rows (the
 * staff account's enrolment and sign-in, and one case_decided row for each decision): the audit log is an append-only
 * chain, and audit-verify refuses a record with a row gone. And the staff account's rows in the auth schema (the account,
 * its key, its session and its events), which the auth suites leave for their own accounts too. Calling it again does
 * nothing.
 */
export async function closeDecisions(): Promise<void> {
  const [used, member, posts] = [world, admin, [...decidedPosts]];
  world = null;
  admin = null;
  decidedPosts.clear();
  if (!used) return;
  try {
    const staff = member ? await member.catch(() => null) : null;
    await removeDecided(used.migrateDb, posts, staff ? [staff.id] : []);
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
