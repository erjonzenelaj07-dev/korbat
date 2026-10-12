import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
  AppealsPage,
  CaseView,
  DecisionView,
  ErrorEnvelope,
  FlowResponse,
  NoticeResponse,
  ReexamineResponse,
  ReportsPage,
  StaffOverview,
  StaffStepUpOptionsResponse,
  type AppealsReviewedParams,
  type AuthenticationResponseJSON,
  type CaseDecidedParams,
} from "@korbat/contracts";
import { closeDb, createDb, profiles, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth, type Auth } from "../../src/auth";
import { randomToken } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createModeration } from "../../src/moderation";
import { createProfileStore } from "../../src/profiles/store";
import { socialForModeration } from "../../src/social";
import { createStaff } from "../../src/staff";
import { SoftAuthenticator } from "../auth/soft-authenticator";
import { Browser } from "./http-client";
import { act, authCaseCounts, casesMedia, decisionParams, moderationCounts, newPostRow, removeFixtures, reviewParams, uuids, type DecisionInput, type ReviewInput } from "./moderation-fixtures";
import { HUMAN, notices, postTarget } from "./notices-harness";
import { enrolKey } from "./staff-enrolment";
import { DEVICE_BOUND, TEST_CONSOLE_ORIGIN, TEST_CONSOLE_RP_ID, issueEnrolment, newStaffAccount } from "./staff-fixtures";

// Each test signs accounts up and staff keys in over HTTP and confirms decisions with them: on a loaded machine that
// takes longer than the five seconds a test gets by default.
vi.setConfig({ testTimeout: 120_000 });

const STAFF_CSRF_COOKIE = "__Host-korbat_staff_csrf";
/** The mark the console sends on a request its person's action started (3a design, section 7). */
const MARKED = { "x-staff-activity": "1" };

/**
 * The routes of appeals and re-examination through the real app (3c design, sections 7.2, 7.7 and 12), the app's site and
 * the console's in one server: the author's appeal and the two re-examination routes with their sessions and refusal
 * codes, and the console's list of appeals and its review, with the staff session and the key's confirmation of exactly
 * that review. Every raw answer is held strictly equal to its parsed form. What the flows store is tested in
 * moderation-appeals-flow.test.ts and moderation-reexamine.test.ts. Every decision and review here is confirmed by a real
 * key, so the audit rows that stay are ones audit-verify accepts; everything else is removed again, and the file's last
 * test holds it to leaving no row behind.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: appeals, reviews and re-examination over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  let auth: Auth;
  let mailer: MemoryMailer;
  let app: ReturnType<typeof createApp>;
  let settle: () => Promise<void>;
  let moderator: Awaited<ReturnType<typeof staffBrowser>>;
  let second: Awaited<ReturnType<typeof staffBrowser>>;
  let admin: Awaited<ReturnType<typeof staffBrowser>>;
  let before: Record<string, number>;
  const staffIds: string[] = [];
  const profileIds: string[] = [];

  beforeAll(async () => {
    // The test environment with the console switched on at the staff harness's address.
    config = loadConfig({ ...process.env, CONSOLE_ORIGIN: TEST_CONSOLE_ORIGIN, CONSOLE_RP_ID: "" });
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 6 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    repo = createAuthRepo(authDb);
    mailer = new MemoryMailer();
    auth = createAuth({
      config,
      logger,
      authDb,
      kv: new MemoryKv(),
      mailer,
      profiles: createProfileStore(apiDb),
      turnstile: { verify: async (token) => token === HUMAN },
      breachChecker: { isBreached: async () => false },
    });
    const rateLimitStore = new MemoryStore();
    const moderation = createModeration({ apiDb, auth: auth.forModeration, social: socialForModeration(apiDb), media: casesMedia(apiDb), requireSession: auth.requireSession, rateLimitStore, config, logger });
    settle = moderation.settle;
    app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, moderation, staff: createStaff({ apiDb, auth: auth.forStaff, moderation: moderation.forStaff }) });
    before = await counts();
    moderator = await staffBrowser("moderator");
    second = await staffBrowser("moderator");
    admin = await staffBrowser("admin");
  }, 180_000);
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(apiDb), closeDb(migrateDb)]);
  });

  /** How many rows the moderation tables and the four auth tables of moderation cases hold. */
  const counts = async (): Promise<Record<string, number>> => ({ ...(await moderationCounts(apiDb)), ...(await authCaseCounts(migrateDb)) });
  const appBrowser = () => new Browser(app, config.APP_ORIGIN);
  const consoleBrowser = () => new Browser(app, TEST_CONSOLE_ORIGIN, { base: TEST_CONSOLE_ORIGIN, csrfCookie: STAFF_CSRF_COOKIE, csrfHeader: "x-staff-csrf" });
  const error = async (res: Response) => ErrorEnvelope.parse(await res.json()).error;
  /** A refusal as its status and its code. */
  const refused = async (res: Response) => [res.status, (await error(res)).code];
  /** A 2xx answer's body, held strictly equal to its parsed form. */
  async function parsed<T>(res: Response, status: number, schema: { parse(value: unknown): T }): Promise<T> {
    expect(res.status, await res.clone().text()).toBe(status);
    const raw: unknown = await res.json();
    const value = schema.parse(raw);
    expect(raw).toStrictEqual(value);
    return value;
  }

  /** A browser signed in over HTTP, with a profile. */
  async function signUp() {
    const b = appBrowser();
    const email = `appeal-${randomUUID()}@korbat.local`;
    const handle = `h${randomBytes(4).toString("hex")}`;
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: HUMAN, deviceId: randomToken(), platform: "web" } });
    expect(start.status, await start.clone().text()).toBe(200);
    const { flowId } = FlowResponse.parse(await start.json());
    expect((await b.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } })).status).toBe(200);
    expect((await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).status).toBe(200);
    expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: `User ${handle}` } })).status).toBe(200);
    const id = (await migrateDb.execute<{ id: string }>(sql`select id from profiles where handle = ${handle}`))[0]!.id;
    profileIds.push(id);
    return { b, id, handle };
  }

  /** A live staff account with a profile and one key enrolled through the flow, signed in from the console's browser. */
  async function staffBrowser(role: "moderator" | "admin") {
    const { user } = await newStaffAccount(authDb, repo, role);
    await apiDb.insert(profiles).values({ id: user.id, handle: `s_${randomUUID().slice(0, 8)}`, displayName: "Staff" });
    staffIds.push(user.id);
    const soft = new SoftAuthenticator();
    const link = await issueEnrolment(migrateDb, user.id);
    const enrolled = await enrolKey({ deps: auth.deps, ctx: { ipHash: randomToken(), userAgent: undefined } }, soft, link.token);
    let counter = 0;
    const assert = (challenge: string) => soft.get({ credentialId: enrolled.credentialId, rpId: TEST_CONSOLE_RP_ID, challenge, origin: TEST_CONSOLE_ORIGIN, flags: DEVICE_BOUND, counter: ++counter });
    const b = consoleBrowser();
    const options = await b.fetch("/api/staff/signin/options", { method: "POST" });
    expect(options.status, await options.clone().text()).toBe(200);
    const { challenge } = ((await options.json()) as { options: { challenge: string } }).options;
    const signedIn = await b.fetch("/api/staff/signin/verify", { json: { response: assert(challenge) } });
    expect(signedIn.status, await signedIn.clone().text()).toBe(200);
    return { id: user.id, keyId: enrolled.key.id, role, b, assert };
  }
  type Staff = typeof moderator;

  /** The key's confirmation of exactly this action, asked for as the console asks for it. */
  async function confirmation(s: Staff, request: { action: "case_decided"; target: { type: "case"; id: string }; params: CaseDecidedParams } | { action: "appeals_reviewed"; target: { type: "decision"; id: string }; params: AppealsReviewedParams }): Promise<AuthenticationResponseJSON> {
    const res = await s.b.fetch("/api/staff/step-up/options", { json: request, headers: MARKED });
    expect(res.status, await res.clone().text()).toBe(200);
    return s.assert(StaffStepUpOptionsResponse.parse(await res.json()).options.challenge);
  }
  /** A confirmed decision on the case over HTTP; answers the decision's id. */
  async function decide(s: Staff, caseId: string, input: DecisionInput): Promise<string> {
    const params = await decisionParams(apiDb, s, caseId, input);
    const res = await s.b.fetch(`/api/staff/cases/${caseId}/decisions`, { json: { ...params, stepUp: await confirmation(s, { action: "case_decided", target: { type: "case", id: caseId }, params }) }, headers: MARKED });
    const view = await parsed(res, 201, CaseView);
    await settle();
    return view.decisions.at(-1)!.id;
  }
  const postReview = (s: Staff, decisionId: string, body: unknown) => s.b.fetch(`/api/staff/decisions/${decisionId}/review`, { json: body, headers: MARKED });
  /** The whole exchange of a review: the params as the console builds them, the confirmation, and the request. */
  async function review(s: Staff, decisionId: string, input: ReviewInput = {}) {
    const params = await reviewParams(apiDb, s, decisionId, input);
    return postReview(s, decisionId, { ...params, stepUp: await confirmation(s, { action: "appeals_reviewed", target: { type: "decision", id: decisionId }, params }) });
  }

  /** A post of a signed-up author, reported under a rule by a signed-up reporter over HTTP, with its case and the report's item. */
  async function reported() {
    const [author, reporter] = [await signUp(), await signUp()];
    const postId = await newPostRow(apiDb, author.id);
    const res = await reporter.b.fetch("/api/notices", { json: { ground: "rule", ruleId: "R1", targets: [postTarget(postId)] } });
    const { ref } = await parsed(res, 201, NoticeResponse);
    await settle();
    const [item] = await migrateDb.execute<{ id: string; case_id: string }>(sql`select i.id, i.case_id from intake_items i join intakes n on n.id = i.intake_id where n.ref = ${ref}`);
    return { author, reporter, postId, ref, itemId: item!.id, caseId: item!.case_id };
  }
  /** The daily release, without the job: every answered item is released as of now. */
  async function release() {
    await migrateDb.execute(sql`update decisions set decided_at = decided_at - interval '1 hour' where decided_at > now() - interval '1 hour'`);
    await migrateDb.execute(sql`select public.release_outcomes(now())`);
  }

  test("the new routes answer a POST only, and the console's list a GET only", async () => {
    const id = randomUUID();
    for (const path of [`/api/moderation/decisions/${id}/appeal`, `/api/moderation/items/${id}/reexamine`, "/api/notices/reexamine"]) {
      expect(await refused(await app.request(`http://localhost${path}`)), path).toEqual([404, "not_found"]);
    }
    expect(await refused(await moderator.b.fetch(`/api/staff/decisions/${id}/review`)), "review").toEqual([404, "not_found"]);
    expect(await refused(await moderator.b.fetch("/api/staff/appeals", { method: "POST", headers: MARKED })), "appeals").toEqual([404, "not_found"]);
  });

  test("the author's appeal: a session with its CSRF token, a well-formed request, the author's own final restriction, and once", async () => {
    const r = await reported();
    const removal = await decide(moderator, r.caseId, { kind: "final", actions: [act("remove")] });
    const path = `/api/moderation/decisions/${removal}/appeal`;

    expect(await refused(await appBrowser().fetch(path, { json: {} }))).toEqual([401, "unauthenticated"]);
    expect((await r.author.b.fetch(path, { json: {}, csrf: false })).status).toBe(403);
    expect(await refused(await r.author.b.fetch("/api/moderation/decisions/not-a-uuid/appeal", { json: {} }))).toEqual([400, "invalid_request"]);
    // A member the request does not know, an empty statement and one past 2000 characters are refused, never changed.
    for (const body of [{ statement: "x", why: "y" }, { statement: "   " }, { statement: "x".repeat(2001) }]) expect(await refused(await r.author.b.fetch(path, { json: body })), JSON.stringify(body).slice(0, 40)).toEqual([400, "invalid_request"]);
    // Someone else's decision and an id that names none get one answer.
    expect(await refused(await r.reporter.b.fetch(path, { json: {} }))).toEqual([422, "appeal_not_open"]);
    expect(await refused(await r.author.b.fetch(`/api/moderation/decisions/${randomUUID()}/appeal`, { json: {} }))).toEqual([422, "appeal_not_open"]);

    const res = await r.author.b.fetch(path, { json: { statement: "x".repeat(2000) } });
    expect(res.headers.get("cache-control")).toBe("no-store");
    const view = await parsed(res, 201, DecisionView);
    expect(view).toMatchObject({ id: removal, appealUntil: null, appeal: { state: "pending", needsAdmin: false } });
    // The decision's own route answers the same.
    expect(await parsed(await r.author.b.fetch(`/api/moderation/decisions/${removal}`), 200, DecisionView)).toEqual(view);
    expect(await refused(await r.author.b.fetch(path, { json: {} }))).toEqual([409, "appeal_exists"]);

    // Five appeals a day: the reporter has used one, and the sixth is told when to come back.
    for (let n = 2; n <= 5; n++) expect(await refused(await r.reporter.b.fetch(path, { json: {} })), String(n)).toEqual([422, "appeal_not_open"]);
    const sixth = await r.reporter.b.fetch(path, { json: {} });
    expect(Number(sixth.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await refused(sixth)).toEqual([429, "rate_limited"]);
  });

  test("the console's list of appeals and the review: a staff session, the key's confirmation of exactly this review, and the database's refusals by their codes", async () => {
    const r = await reported();
    const removal = await decide(moderator, r.caseId, { kind: "final", actions: [act("remove")] });
    await parsed(await r.author.b.fetch(`/api/moderation/decisions/${removal}/appeal`, { json: { statement: "Please look again." } }), 201, DecisionView);

    // The list: behind the staff gate and the staff session, and without the appellant's statement.
    expect(await refused(await consoleBrowser().fetch("/api/staff/appeals", { headers: MARKED }))).toEqual([401, "staff_session_required"]);
    expect(await refused(await second.b.fetch("/api/staff/appeals?cursor=%21", { headers: MARKED }))).toEqual([400, "invalid_request"]);
    const listed = await second.b.fetch("/api/staff/appeals", { headers: MARKED });
    expect(listed.headers.get("cache-control")).toBe("no-store");
    const page = await parsed(listed, 200, AppealsPage);
    const row = page.appeals.find((appeal) => appeal.decisionId === removal)!;
    // 3e: the removal under R1 gave the post a strike, listed among the actions the appeal is against.
    expect(row).toMatchObject({ caseId: r.caseId, ruleId: "R1", actions: ["remove", "strike"], reviewer: "available", needsAdmin: false, mayReview: true });
    expect(JSON.stringify(page)).not.toContain("Please look again");
    expect((await parsed(await moderator.b.fetch("/api/staff/appeals", { headers: MARKED }), 200, AppealsPage)).appeals.find((appeal) => appeal.id === row.id)!.mayReview).toBe(false);
    // The home screen counts them, with the person's own number.
    const home = await parsed(await second.b.fetch("/api/staff/overview"), 200, StaffOverview);
    expect(home.appealsWaiting).toBeGreaterThanOrEqual(1);
    expect(home.appealsYouMayReview).toBeGreaterThanOrEqual(1);
    // The case answer carries the statement and the same marks.
    const view = await parsed(await second.b.fetch(`/api/staff/cases/${r.caseId}`, { headers: MARKED }), 200, CaseView);
    expect(view.appeals).toEqual([expect.objectContaining({ id: row.id, statement: "Please look again.", reviewer: "available", needsAdmin: false, mayReview: true })]);

    // The review needs a staff session and the key's confirmation of exactly this review of exactly this decision.
    const params = await reviewParams(apiDb, second, removal);
    const stepUp = await confirmation(second, { action: "appeals_reviewed", target: { type: "decision", id: removal }, params });
    expect(await refused(await postReview({ ...second, b: consoleBrowser() }, removal, { ...params, stepUp }))).toEqual([401, "staff_session_required"]);
    expect(await refused(await postReview(second, removal, params))).toEqual([403, "staff_step_up_required"]);
    const others = await reviewParams(apiDb, second, removal);
    expect(await refused(await postReview(second, removal, { ...others, stepUp: await confirmation(second, { action: "appeals_reviewed", target: { type: "decision", id: removal }, params }) }))).toEqual([403, "staff_step_up_invalid"]);
    expect(await refused(await postReview(second, randomUUID(), { ...params, stepUp: await confirmation(second, { action: "appeals_reviewed", target: { type: "decision", id: removal }, params }) }))).toEqual([403, "staff_step_up_invalid"]);
    // A review that restricts is no review: the params' schema refuses it before any key is asked.
    expect((await second.b.fetch("/api/staff/step-up/options", { json: { action: "appeals_reviewed", target: { type: "decision", id: removal }, params: { ...params, actions: [{ kind: "remove", mediaId: null }] } }, headers: MARKED })).status).toBe(400);

    // What the database and the module refuse: the decider, a decision that does not exist, the redress texts of another version.
    expect(await refused(await review(moderator, removal))).toEqual([403, "reviewer_conflict"]);
    const missing = randomUUID();
    const forMissing = { ...params };
    expect(await refused(await postReview(second, missing, { ...forMissing, stepUp: await confirmation(second, { action: "appeals_reviewed", target: { type: "decision", id: missing }, params: forMissing }) }))).toEqual([404, "not_found"]);
    expect(await refused(await review(second, removal, { redressVersion: 99 }))).toEqual([422, "invalid_decision"]);
    expect(await refused(await review(second, removal, { appealId: randomUUID() }))).toEqual([409, "case_changed"]);

    // A confirmed review is answered 201 with the case as it now stands.
    const res = await review(second, removal, { outcome: "reversed", actions: [act("restore")] });
    expect(res.headers.get("cache-control")).toBe("no-store");
    const after = await parsed(res, 201, CaseView);
    await settle();
    expect(after).toMatchObject({ id: r.caseId, target: { type: "post", id: r.postId, state: "visible", level: "visible" } });
    const reviewRow = after.decisions.at(-1)!;
    // 3e: the review reverses the removal whole, so it also overrules the strike the removal gave.
    expect(reviewRow).toMatchObject({ kind: "review", outcome: "reversed", reviewsDecisionId: removal, needsAdmin: false, actions: [{ kind: "overrule" }, { kind: "restore" }] });
    expect(after.appeals).toEqual([expect.objectContaining({ id: row.id, result: "reversed", answeredBy: reviewRow.id, reviewer: null, mayReview: false })]);
    // The appeal is answered: another review finds none pending, and the list no longer holds it.
    expect(await refused(await review(admin, removal))).toEqual([409, "case_changed"]);
    expect((await parsed(await second.b.fetch("/api/staff/appeals", { headers: MARKED }), 200, AppealsPage)).appeals.find((appeal) => appeal.id === row.id)).toBeUndefined();
    // The author reads the answer on the decision's screen.
    expect(await parsed(await r.author.b.fetch(`/api/moderation/decisions/${removal}`), 200, DecisionView)).toMatchObject({ appeal: { state: "answered", result: "reversed", answeredBy: reviewRow.id, statement: { kind: "review", outcome: "reversed" } } });
  });

  test("a review of a decision under R5 is a moderator's, and one that only an admin may make is refused to a moderator", async () => {
    const author = await signUp();
    const postId = await newPostRow(apiDb, author.id);
    // A notice on the path for child sexual abuse material, answered by the admin with a removal under R2.
    const notice = await parsed(await appBrowser().fetch("/api/notices", { json: notices.csam([postTarget(postId)]) }), 201, NoticeResponse);
    await settle();
    const [item] = await migrateDb.execute<{ case_id: string }>(sql`select i.case_id from intake_items i join intakes n on n.id = i.intake_id where n.ref = ${notice.ref}`);
    const removal = await decide(admin, item!.case_id, { kind: "final", ruleId: "R2", actions: [act("remove")] });
    const filed = await parsed(await author.b.fetch(`/api/moderation/decisions/${removal}/appeal`, { json: {} }), 201, DecisionView);
    expect(filed.appeal).toMatchObject({ state: "pending", needsAdmin: true });
    expect((await parsed(await second.b.fetch("/api/staff/appeals", { headers: MARKED }), 200, AppealsPage)).appeals.find((appeal) => appeal.decisionId === removal)).toMatchObject({ needsAdmin: true, mayReview: false });
    expect(await refused(await review(second, removal))).toEqual([403, "admin_required"]);
    expect(await refused(await review(admin, removal))).toEqual([403, "reviewer_conflict"]);
  });

  test("re-examination over HTTP: the signed-in reporter by the item's id from their list, and a notifier with the notice's token", async () => {
    const r = await reported();
    await decide(moderator, r.caseId, { kind: "final", outcome: "no_violation" });
    const own = `/api/moderation/items/${r.itemId}/reexamine`;
    // Nothing can be asked before the outcome is released.
    expect(await refused(await r.reporter.b.fetch(own, { json: {} }))).toEqual([422, "reexamination_not_open"]);
    await release();
    // The reporter's list names the item by its id; the status page never does.
    const list = await parsed(await r.reporter.b.fetch("/api/moderation/reports"), 200, ReportsPage);
    expect(list.reports[0]!.items).toEqual([expect.objectContaining({ id: r.itemId, outcome: "no_violation", reexamination: { open: true, until: expect.any(String) } })]);

    expect(await refused(await appBrowser().fetch(own, { json: {} }))).toEqual([401, "unauthenticated"]);
    expect((await r.reporter.b.fetch(own, { json: {}, csrf: false })).status).toBe(403);
    expect(await refused(await r.reporter.b.fetch("/api/moderation/items/not-a-uuid/reexamine", { json: {} }))).toEqual([400, "invalid_request"]);
    expect(await refused(await r.reporter.b.fetch(own, { json: { statement: "x", position: 1 } }))).toEqual([400, "invalid_request"]);
    expect(await refused(await r.author.b.fetch(own, { json: {} }))).toEqual([404, "not_found"]);
    const res = await r.reporter.b.fetch(own, { json: { statement: "Read the second line." } });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await parsed(res, 201, ReexamineResponse)).toEqual({ positions: [1] });
    await settle();
    expect(await refused(await r.reporter.b.fetch(own, { json: {} }))).toEqual([409, "reexamination_exists"]);

    // A notifier without an account: the notice's reference, its token and the item's position.
    const author = await signUp();
    const postId = await newPostRow(apiDb, author.id);
    const notice = await parsed(await appBrowser().fetch("/api/notices", { json: notices.rule([postTarget(postId)]) }), 201, NoticeResponse);
    await settle();
    const [item] = await migrateDb.execute<{ case_id: string }>(sql`select i.case_id from intake_items i join intakes n on n.id = i.intake_id where n.ref = ${notice.ref}`);
    await decide(second, item!.case_id, { kind: "final", outcome: "no_violation" });
    await release();
    const ask = (body: unknown, b = appBrowser()) => b.fetch("/api/notices/reexamine", { json: body });
    const request = { ref: notice.ref, token: notice.token, position: 1 };
    for (const body of [{ ...request, position: 0 }, { ...request, position: 21 }, { ...request, extra: true }, { ref: notice.ref, position: 1 }]) expect(await refused(await ask(body)), JSON.stringify(body).slice(0, 60)).toEqual([400, "invalid_request"]);
    expect(await refused(await ask({ ...request, token: randomToken() }))).toEqual([404, "notice_not_found"]);
    expect(await refused(await ask({ ...request, ref: "N-AAAAAAAAAA" }))).toEqual([404, "notice_not_found"]);
    // Another site's page cannot ask in someone's name.
    expect((await new Browser(app, "https://evil.example").fetch("/api/notices/reexamine", { json: request })).status).toBe(403);
    expect(await parsed(await ask({ ...request, statement: "It is the image, not the text." }), 201, ReexamineResponse)).toEqual({ positions: [1] });
    await settle();
    // The newest item at that position is the request itself, which waits for its answer.
    expect(await refused(await ask(request))).toEqual([422, "reexamination_not_open"]);
    // Five a day from one network: the sixth is told when to come back.
    const one = appBrowser();
    for (let n = 1; n <= 5; n++) expect(await refused(await ask(request, one)), String(n)).toEqual([422, "reexamination_not_open"]);
    const sixth = await ask(request, one);
    expect(Number(sixth.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await refused(sixth)).toEqual([429, "rate_limited"]);
  });

  test("this file left no row behind: the moderation tables and the four auth tables of moderation cases hold what they held before it", async () => {
    await settle();
    await removeFixtures(migrateDb, profileIds);
    await migrateDb.execute(sql`delete from profiles where id = any(${uuids(staffIds)})`);
    expect(await counts()).toEqual(before);
  });
});
