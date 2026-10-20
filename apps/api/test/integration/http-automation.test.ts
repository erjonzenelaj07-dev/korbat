import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
  AUTOMATION_RULES,
  AuthorCasesPage,
  CaseView,
  DecisionView,
  ErrorEnvelope,
  FlowResponse,
  MediaStatusResponse,
  PostView,
  QueuePage,
  StaffOverview,
  StaffStepUpOptionsResponse,
  UploadResponse,
  type AuthenticationResponseJSON,
  type CaseDecidedParams,
} from "@korbat/contracts";
import { closeDb, createDb, profiles, type Db } from "@korbat/db";
import { R1_TEST_MODEL, uploadsLayout } from "@korbat/media-protocol";
import { REDRESS_TEXTS, STATEMENT_WORDS, statementParagraphs } from "@korbat/rules";
import { createApp } from "../../src/app";
import { createAuth, type Auth } from "../../src/auth";
import { randomToken } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { DECISION_MAIL_SUBJECTS, renderMail } from "../../src/mail/templates";
import { createMedia } from "../../src/media";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createModeration } from "../../src/moderation";
import { sweepRound } from "../../src/moderation/automated";
import { createProfileStore } from "../../src/profiles/store";
import { createSocial, enforceWriteLimit, socialForModeration } from "../../src/social";
import { createStaff } from "../../src/staff";
import { SoftAuthenticator } from "../auth/soft-authenticator";
import { automationDeps, removeAutomation } from "./automation-fixtures";
import { ageCustodyForTest } from "./custody-fixtures";
import { Browser } from "./http-client";
import { BYTES, fakeWorker } from "./media-harness";
import { act, decisionParams, newPostRow, removeFixtures, type DecisionInput } from "./moderation-fixtures";
import { HUMAN } from "./notices-harness";
import { enrolKey } from "./staff-enrolment";
import { DEVICE_BOUND, TEST_CONSOLE_ORIGIN, TEST_CONSOLE_RP_ID, issueEnrolment, newStaffAccount } from "./staff-fixtures";

// Accounts sign up and a staff key confirms a correction over HTTP: on a loaded machine longer than five seconds.
vi.setConfig({ testTimeout: 120_000 });

const STAFF_CSRF_COOKIE = "__Host-korbat_staff_csrf";
const MARKED = { "x-staff-activity": "1" };

/**
 * The automated decision and "Ask for a person" through the real app (3d design, sections 7.9, 7.10, 8.3, 8.4, 9.4 and
 * 10.2 to 10.4; Task 6; 12.1 rows 3, 4, 6 and 7): the app's site and the console's in one server, with the media, social,
 * moderation and staff modules wired as the server wires them, the test scorer on a closed site and its withhold on, and a
 * stand-in for the worker that writes results of version 2 with the test model's score. A post with a scored image is
 * withheld by the program after the post's commit; its author reads the decision, its statement and "Ask for a person",
 * and asks; the console shows the three chips, the request first in its lane, the signal without its score and the
 * request's text as text; a moderator's correction lifts the measure and answers the request. The sweep takes an image
 * whose step never ran, and the daily alert follows a request that waited past the target. Every row this file commits
 * is removed again by the profiles that own it and the alerts it raised.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the automated decision and Ask for a person over HTTP (3d Task 6)", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  let auth: Auth;
  let app: ReturnType<typeof createApp>;
  let settle: () => Promise<void>;
  let moderator: Awaited<ReturnType<typeof staffBrowser>>;
  let startedAt: string;
  const mailer = new MemoryMailer();
  const root = mkdtempSync(path.join(tmpdir(), "korbat-http-automation-"));
  const uploads = uploadsLayout(path.join(root, "uploads"));
  const worker = fakeWorker(path.join(root, "store"));
  const profileIds: string[] = [];
  const staffIds: string[] = [];
  const mediaIds: string[] = [];

  beforeAll(async () => {
    // The console switched on at the staff harness's address; the R1 check's test scorer withholding, on a closed site,
    // set after loadConfig as a test sets a test adapter for itself.
    config = { ...loadConfig({ ...process.env, CONSOLE_ORIGIN: TEST_CONSOLE_ORIGIN, CONSOLE_RP_ID: "" }), R1_CLASSIFIER: "test", AUTOMATION_R1_ACTS: "on", APP_SITE: "closed" };
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 6 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    const [row] = await apiDb.execute<{ now: string }>(sql`select now()::text as now`);
    startedAt = row!.now;
    repo = createAuthRepo(authDb);
    const rateLimitStore = new MemoryStore();
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
    const media = createMedia({
      apiDb,
      uploadsDir: uploads.root,
      storeDir: path.join(root, "store"),
      formats: config.MEDIA_FORMATS,
      minFreeBytes: 0,
      logger,
      requireSession: auth.requireSession,
      resolveSession: auth.resolveSession,
      rateLimitStore,
      enforceUploadLimit: (userId, accountCreatedAt, at) => enforceWriteLimit(rateLimitStore, userId, "upload", accountCreatedAt, at),
      // The test scorer's model, whose scores finalize keeps, as the server names it under R1_CLASSIFIER=test.
      r1Model: R1_TEST_MODEL,
    });
    await media.prepare();
    const moderation = createModeration({ apiDb, auth: auth.forModeration, social: socialForModeration(apiDb), media: media.forCases, requireSession: auth.requireSession, rateLimitStore, config, logger });
    settle = moderation.settle;
    const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth(), media: media.forPosts, moderation: moderation.forSocial });
    app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, social, media, moderation, staff: createStaff({ apiDb, auth: auth.forStaff, moderation: moderation.forStaff }) });
    moderator = await staffBrowser("moderator");
  }, 180_000);
  afterAll(async () => {
    await settle();
    await removeFixtures(migrateDb, [...profileIds, ...staffIds]);
    await removeAutomation(migrateDb, startedAt, mediaIds);
    rmSync(root, { recursive: true, force: true });
    await Promise.all([closeDb(authDb), closeDb(apiDb), closeDb(migrateDb)]);
  });

  const appBrowser = () => new Browser(app, config.APP_ORIGIN);
  const consoleBrowser = () => new Browser(app, TEST_CONSOLE_ORIGIN, { base: TEST_CONSOLE_ORIGIN, csrfCookie: STAFF_CSRF_COOKIE, csrfHeader: "x-staff-csrf" });
  const refused = async (res: Response) => [res.status, ErrorEnvelope.parse(await res.json()).error.code];
  async function parsed<T>(res: Response, status: number, schema: { parse(value: unknown): T }): Promise<T> {
    expect(res.status, await res.clone().text()).toBe(status);
    const raw: unknown = await res.json();
    const value = schema.parse(raw);
    expect(raw).toStrictEqual(value);
    // No answer to anyone holds a score, a model's rating or the threshold's value (12.1 row 7).
    expect(JSON.stringify(raw)).not.toMatch(/"score"|nsfw|"threshold"/);
    return value;
  }

  /** A browser signed in over HTTP, with a profile, and its address. */
  async function signUp() {
    const b = appBrowser();
    const email = `auto-${randomUUID()}@korbat.local`;
    const handle = `a${randomBytes(4).toString("hex")}`;
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: HUMAN, deviceId: randomToken(), platform: "web" } });
    expect(start.status, await start.clone().text()).toBe(200);
    const { flowId } = FlowResponse.parse(await start.json());
    expect((await b.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } })).status).toBe(200);
    expect((await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).status).toBe(200);
    expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: `User ${handle}` } })).status).toBe(200);
    const id = (await migrateDb.execute<{ id: string }>(sql`select id from profiles where handle = ${handle}`))[0]!.id;
    profileIds.push(id);
    return { b, id, email };
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

  /** A confirmed decision on the case over HTTP; answers the decision's id. */
  async function decide(s: Staff, caseId: string, input: DecisionInput): Promise<string> {
    const params = await decisionParams(apiDb, s, caseId, input);
    const request = { action: "case_decided" as const, target: { type: "case" as const, id: caseId }, params: params as CaseDecidedParams };
    const options = await s.b.fetch("/api/staff/step-up/options", { json: request, headers: MARKED });
    expect(options.status, await options.clone().text()).toBe(200);
    const stepUp: AuthenticationResponseJSON = s.assert(StaffStepUpOptionsResponse.parse(await options.json()).options.challenge);
    const view = await parsed(await s.b.fetch(`/api/staff/cases/${caseId}/decisions`, { json: { ...params, stepUp }, headers: MARKED }), 201, CaseView);
    await settle();
    return view.decisions.at(-1)!.id;
  }

  /**
   * An image uploaded over HTTP and accepted by the stand-in worker with the test model's score, then posted: the post's
   * answer comes first, and the program's step runs after its commit, which settle waits for.
   */
  async function publish(author: Awaited<ReturnType<typeof signUp>>, score: number, model = R1_TEST_MODEL) {
    const sent = await author.b.fetch("/api/media", { raw: { type: "image/jpeg", body: BYTES.jpeg } });
    expect(sent.status).toBe(202);
    const { id } = UploadResponse.parse(await sent.json());
    mediaIds.push(id);
    worker.ready(id, { width: 1200, height: 800 }, { model, score });
    expect(MediaStatusResponse.parse(await (await author.b.fetch(`/api/media/${id}`)).json()).status).toBe("ready");
    const created = await author.b.fetch("/api/posts", { json: { body: "a photo", media: [{ id, alt: "an image" }] } });
    expect(created.status, await created.clone().text()).toBe(201);
    const post = PostView.parse(await created.json());
    await settle();
    return { postId: post.id, mediaId: id };
  }

  /** What the program left on an image: its signal, the decision and its case, and the image's state. */
  async function programOn(mediaId: string) {
    const [row] = await apiDb.execute<{ handled: string | null; decision_id: string | null; case_id: string | null; state: string }>(sql`
      select s.handled, s.decision_id, i.case_id, m.moderation_state::text as state
        from post_media m left join automated_signals s on s.media_id = m.id left join intake_items i on i.id = s.intake_item_id
       where m.id = ${mediaId}::uuid`);
    return row!;
  }

  /** The case's row in the queue, read page by page in the queue's order, and the rows of its lane before it. */
  async function queueRowOf(caseId: string) {
    const rows: QueuePage["cases"] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 50; page++) {
      const answer: QueuePage = await parsed(await moderator.b.fetch(`/api/staff/queue${cursor === null ? "" : `?cursor=${encodeURIComponent(cursor)}`}`), 200, QueuePage);
      rows.push(...answer.cases);
      const found = rows.find((row) => row.id === caseId);
      if (found) return { row: found, before: rows.slice(0, rows.indexOf(found)).filter((row) => row.lane === found.lane) };
      if (answer.nextCursor === null) break;
      cursor = answer.nextCursor;
    }
    throw new Error(`case ${caseId} is not in the queue`);
  }

  let program: { author: Awaited<ReturnType<typeof signUp>>; postId: string; mediaId: string; decisionId: string; caseId: string };

  test("a scored image on a new post: after the post's commit a program withholds it, interim and fully automated, with its statement and its mail", async () => {
    const author = await signUp();
    const { postId, mediaId } = await publish(author, 1);
    const left = await programOn(mediaId);
    expect([left.handled, left.state]).toEqual(["measure", "withheld"]);
    const [decision] = await apiDb.execute<{ kind: string; decided_by: string | null; automated_detection: boolean; automated_decision: string; source: string; rule_id: string; redress_version: number }>(
      sql`select kind::text, decided_by, automated_detection, automated_decision, source::text, rule_id, redress_version from decisions where id = ${left.decision_id!}::uuid`,
    );
    expect({ ...decision! }).toEqual({ kind: "interim", decided_by: null, automated_detection: true, automated_decision: "fully", source: "own_initiative", rule_id: "R1", redress_version: 4 });
    program = { author, postId, mediaId, decisionId: left.decision_id!, caseId: left.case_id! };

    // The author's list marks it as a program's, and its screen offers "Ask for a person".
    const cases = await parsed(await author.b.fetch("/api/moderation/cases"), 200, AuthorCasesPage);
    expect(cases.decisions.find((row) => row.id === program.decisionId)).toMatchObject({ byProgram: true });
    const view = await parsed(await author.b.fetch(`/api/moderation/decisions/${program.decisionId}`), 200, DecisionView);
    expect(view).toMatchObject({ automatedDetection: true, automatedDecision: "fully", signal: { kind: "r1_score", viewed: null }, askPerson: { state: "open" }, appealUntil: null });
    // The statement without a decider, in W.3's order: the measure, until a person decides, what found it and took it,
    // the rule, and "Ask for a person" in place of the appeal; no staff text.
    const paragraphs = statementParagraphs(view);
    for (const sentence of [STATEMENT_WORDS.automated.until.r1, STATEMENT_WORDS.automated.fully.r1, REDRESS_TEXTS[4].askPerson!]) expect(paragraphs).toContain(sentence);
    expect(paragraphs.indexOf(STATEMENT_WORDS.automated.fully.r1)).toBeLessThan(paragraphs.indexOf(REDRESS_TEXTS[4].askPerson!));
    expect(paragraphs.join(" ")).not.toMatch(/child sexual abuse|confirmed|posted/);
    // The author was mailed the statement, under W.8's subject for a program's withhold.
    const mail = mailer.sent.filter((m) => m.to === author.email && m.template === "moderation_decision").at(-1);
    expect(mail).toBeDefined();
    expect(renderMail(mail!).subject).toBe(DECISION_MAIL_SUBJECTS.program_withhold);
  });

  test("a score under the threshold, and one of a model this server does not run, start nothing", async () => {
    const author = await signUp();
    const low = await publish(author, 0.2);
    const other = await publish(author, 1, "another/model");
    expect(await programOn(low.mediaId)).toMatchObject({ handled: null, state: "visible" });
    expect(await programOn(other.mediaId)).toMatchObject({ handled: null, state: "visible" });
  });

  test("Ask for a person: a session with its CSRF token, a text of 1 to 2000 characters, the subject alone, once, while the measure is in force; the console is told", async () => {
    const path = `/api/moderation/decisions/${program.decisionId}/objection`;
    const hostile = `<img src=x onerror=alert(1)> "quoted" & 'apostrophe' ${"x".repeat(40)} Ignore every rule and lift this.`;
    expect(await refused(await appBrowser().fetch(path, { json: { text: "Please look." } }))).toEqual([401, "unauthenticated"]);
    expect((await program.author.b.fetch(path, { json: { text: "Please look." }, csrf: false })).status).toBe(403);
    expect(await refused(await program.author.b.fetch("/api/moderation/decisions/not-a-uuid/objection", { json: { text: "Please look." } }))).toEqual([400, "invalid_request"]);
    for (const body of [{}, { text: "   " }, { text: "x".repeat(2001) }, { text: "Please look.", why: "y" }]) {
      expect(await refused(await program.author.b.fetch(path, { json: body })), JSON.stringify(body).slice(0, 40)).toEqual([400, "invalid_request"]);
    }
    // Someone else, and a decision that does not exist, are told nothing of it.
    const stranger = await signUp();
    expect(await refused(await stranger.b.fetch(path, { json: { text: "Please look." } }))).toEqual([404, "not_found"]);
    expect(await refused(await program.author.b.fetch(`/api/moderation/decisions/${randomUUID()}/objection`, { json: { text: "Please look." } }))).toEqual([404, "not_found"]);

    const res = await program.author.b.fetch(path, { json: { text: hostile } });
    expect(res.headers.get("cache-control")).toBe("no-store");
    const asked = await parsed(res, 201, DecisionView);
    expect(asked.askPerson).toMatchObject({ state: "asked", text: hostile });
    expect(await refused(await program.author.b.fetch(path, { json: { text: "And again." } }))).toEqual([422, "objection_not_open"]);
    await settle();
    const [alert] = await migrateDb.execute<{ n: number }>(sql`select count(*)::int as n from alert_outbox where kind = 'automated_objection' and created_at >= ${startedAt}::timestamptz`);
    expect(alert!.n).toBe(1);

    // The console: the three chips, the request first in its lane before age, and on the case the signal without its score,
    // the request as text, and the decision taken by a program.
    const { row, before } = await queueRowOf(program.caseId);
    expect(row).toMatchObject({ foundByProgram: true, takenByProgram: true, objected: true });
    expect(before.every((other) => other.objected)).toBe(true);
    const view = await parsed(await moderator.b.fetch(`/api/staff/cases/${program.caseId}`, { headers: MARKED }), 200, CaseView);
    expect(view.signals).toEqual([expect.objectContaining({ kind: "r1_score", thresholdVersion: 0 })]);
    expect(view.objection).toMatchObject({ text: hostile });
    expect(view.decisions.find((decision) => decision.id === program.decisionId)).toMatchObject({ byProgram: true, staffHandle: null });
    const home = await parsed(await moderator.b.fetch("/api/staff/overview"), 200, StaffOverview);
    expect(home.automated.objected).toBeGreaterThanOrEqual(1);
    expect(home.automated.objectedCases).toContain(program.caseId);
    expect(home.automated.cases).toContain(program.caseId);
  });

  test("a moderator's correction lifts the program's withhold at once and answers the request; a new request is refused; its statement says the image was not opened", async () => {
    const correction = await decide(moderator, program.caseId, { kind: "correction", outcome: "reversed", reviewsDecisionId: program.decisionId, actions: [act("restore_media", program.mediaId)] });
    expect((await programOn(program.mediaId)).state).toBe("visible");
    const view = await parsed(await program.author.b.fetch(`/api/moderation/decisions/${program.decisionId}`), 200, DecisionView);
    expect(view.askPerson).toMatchObject({ state: "decided", decisionId: correction });
    expect(await refused(await program.author.b.fetch(`/api/moderation/decisions/${program.decisionId}/objection`, { json: { text: "Once more." } }))).toEqual([422, "objection_not_open"]);
    // The correction is a person's: it records what found the item, and no image_viewed row of the moderator stands.
    const corrected = await parsed(await program.author.b.fetch(`/api/moderation/decisions/${correction}`), 200, DecisionView);
    expect(corrected).toMatchObject({ automatedDetection: true, automatedDecision: "not_automated", signal: { kind: "r1_score", viewed: false }, askPerson: null });
    const { row } = await queueRowOf(program.caseId).catch(() => ({ row: null }));
    if (row !== null) expect(row).toMatchObject({ takenByProgram: false, objected: false });
  });

  test("the sweep takes an image whose step never ran, and the daily alert follows a request that waited past the target, once in 24 hours", async () => {
    const author = await signUp();
    // An image scored and posted straight to the tables, so createPost never handed it to the step.
    const sent = await author.b.fetch("/api/media", { raw: { type: "image/jpeg", body: BYTES.jpeg } });
    const { id } = UploadResponse.parse(await sent.json());
    mediaIds.push(id);
    worker.ready(id, { width: 1200, height: 800 }, { model: R1_TEST_MODEL, score: 1 });
    expect(MediaStatusResponse.parse(await (await author.b.fetch(`/api/media/${id}`)).json()).status).toBe("ready");
    // Written now: the sweep reads the posts of the last SWEEP_HOURS hours.
    const postId = await newPostRow(apiDb, author.id, { createdAt: sql`now()` });
    await apiDb.execute(sql`update post_media set post_id = ${postId}::uuid, position = 0, alt_text = 'an image' where id = ${id}::uuid`);
    expect((await programOn(id)).handled).toBeNull();

    // The sweep's round as the job runs it, on the module's dependencies with the same settings.
    const deps = automationDeps(apiDb);
    const swept = await sweepRound(deps);
    await deps.background.settle();
    expect(swept.signalled).toBeGreaterThanOrEqual(1);
    const taken = await programOn(id);
    expect([taken.handled, taken.state]).toEqual(["measure", "withheld"]);

    // Asked, and aged past the published target: the next round writes automated_waiting once, the one after none.
    await parsed(await author.b.fetch(`/api/moderation/decisions/${taken.decision_id}/objection`, { json: { text: "Please have a person look." } }), 201, DecisionView);
    await ageCustodyForTest(migrateDb, { objection: taken.decision_id! }, `${AUTOMATION_RULES.objectionTargetHours + 1} hours`);
    const waiting = await sweepRound(deps);
    expect(waiting.waiting).toBe(true);
    expect((await sweepRound(deps)).waiting).toBe(false);
    const [alert] = await migrateDb.execute<{ facts: Record<string, unknown> }>(sql`select facts from alert_outbox where kind = 'automated_waiting' and created_at >= ${startedAt}::timestamptz order by id desc limit 1`);
    expect(alert!.facts).toMatchObject({ count: expect.any(Number), oldestAt: expect.any(String) });
    // The request is not a limit until it is older than unansweredHours: the program still acts.
    expect(AUTOMATION_RULES.objectionTargetHours + 1).toBeLessThan(AUTOMATION_RULES.unansweredHours);
  });
});
