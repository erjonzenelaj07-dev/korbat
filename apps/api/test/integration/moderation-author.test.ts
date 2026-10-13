import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  ACCOUNT_ITEM_SCOPE,
  ACCOUNT_SUSPECT_SCOPE,
  ALREADY_NOT_SHOWN,
  AuthorCasesPage,
  DecisionView,
  ErrorEnvelope,
  FlowResponse,
  OUTCOME_PHRASES,
  PostView,
  QUOTE_ITEM_SCOPE,
  REPORTS_PAGE_SIZE,
  ReportsPage,
  SUSPECT_OUTCOME_PHRASES,
  TimelinePage,
  UNSEEN_NO_ACTION,
  appealDeadline,
  itemOutcomeWords,
  mediaPath,
  type NoticeRequest,
} from "@korbat/contracts";
import { getRule, statementParagraphs } from "@korbat/rules";
import { createApp } from "../../src/app";
import { randomToken } from "../../src/auth/crypto";
import { createMediaRepo } from "../../src/media/repo";
import { updateLine } from "../../src/moderation/dispatch";
import { noticeStatus, submitNotice } from "../../src/moderation/intake";
import { pendingOutcomeLines, releaseOutcomes } from "../../src/moderation/repo";
import { createSocial } from "../../src/social";
import { Browser } from "./http-client";
import { deciderWorld, type DeciderWorld, type RealStaff } from "./moderation-decide";
import { act, authCaseCounts, moderationCounts, newImageRow, newPostRow } from "./moderation-fixtures";
import { HUMAN, accountTarget, noticesWorld, notices, postTarget, type NoticesWorld } from "./notices-harness";

// Every test signs accounts up over HTTP and signs decisions with a real staff key: more than a test gets by default.
vi.setConfig({ testTimeout: 180_000 });

const HOUR = 60 * 60_000;
const DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/**
 * The app's side of moderation cases through the real app (3c design, sections 7.6, 10, 11 and 12): the author's list of
 * decisions and one decision's view, the chip's facts on the author's own post, the reporter's list with its words, and
 * the stop and the resume of korbat's report mails. Every decision is confirmed with a real staff key, every report goes
 * through the intake, and outcomes are released by the database's own function, as the daily dispatch releases them.
 * Every raw answer is held strictly equal to its parsed form. Every test commits; the file's last test removes what was
 * stored and holds the tables to what they held before it.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the app's side of moderation cases", () => {
  let w: NoticesWorld;
  let d: DeciderWorld;
  let moderator: RealStaff;
  let admin: RealStaff;
  let app: ReturnType<typeof createApp>;
  let origin: string;
  let before: Record<string, number>;

  beforeAll(async () => {
    w = noticesWorld();
    origin = w.config.APP_ORIGIN;
    d = deciderWorld(w.apiDb, { auth: w.authForModeration, rateLimitStore: w.deps.limits });
    before = await counts();
    const logger = pino({ level: "silent" });
    const images = createMediaRepo(w.apiDb);
    // The social module as the server wires it for this task: the chip's facts come from the moderation module, and the
    // images from the media repository's one list for posts. Nothing here attaches or deletes an image.
    const social = createSocial({
      apiDb: w.apiDb,
      rateLimitStore: w.deps.limits,
      logger,
      requireSession: w.auth.requireSession,
      requireFreshAuth: w.auth.requireFreshAuth(),
      moderation: w.moderation.forSocial,
      media: { attach: async () => undefined, detachAll: async () => [], requestDeletion: async () => undefined, forPosts: (postIds) => images.forPosts(postIds) },
    });
    app = createApp({ config: w.config, logger, rateLimitStore: w.deps.limits, healthChecks: {}, auth: w.auth, social, moderation: w.moderation });
    moderator = await d.staff("moderator");
    admin = await d.staff("admin");
  }, 120_000);
  afterAll(async () => {
    await w.close();
  });
  beforeEach(() => {
    // Past every hourly window of the limit store and the urgent alert's throttle.
    w.ahead.limitsMs += HOUR;
  });

  const counts = async (): Promise<Record<string, number>> => ({ ...(await moderationCounts(w.apiDb)), ...(await authCaseCounts(w.migrateDb)) });
  const error = async (res: Response) => ErrorEnvelope.parse(await res.json()).error;
  const today = () => new Date().toISOString().slice(0, 10);

  /** A browser signed in over HTTP as a new account; with `onboard` false the account has not chosen a handle yet. */
  async function signUp(onboard = true) {
    const b = new Browser(app, origin);
    const email = `author-${randomUUID()}@korbat.local`;
    const handle = `a${randomBytes(4).toString("hex")}`;
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: HUMAN, deviceId: randomToken(), platform: "web" } });
    expect(start.status, await start.clone().text()).toBe(200);
    const { flowId } = FlowResponse.parse(await start.json());
    expect((await b.fetch("/api/auth/email/verify", { json: { flowId, code: w.mailer.lastCodeFor(email) } })).status).toBe(200);
    expect((await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: w.config.TERMS_VERSION } })).status).toBe(200);
    let id = "";
    if (onboard) {
      expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: `User ${handle}` } })).status).toBe(200);
      id = (await w.migrateDb.execute<{ id: string }>(sql`select id from profiles where handle = ${handle}`))[0]!.id;
      w.profileIds.push(id);
    }
    return { b, email, handle, id, session: { userId: id, role: "user" as const, onboarded: true } };
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

  /** GET a JSON answer and hold the raw body strictly equal to its parsed form. */
  async function read<T>(b: Browser, path: string, schema: { parse(value: unknown): T }): Promise<T> {
    const res = await b.fetch(path);
    expect(res.status, `${path}: ${await res.clone().text()}`).toBe(200);
    expect(res.headers.get("cache-control"), path).toBe("no-store");
    const raw: unknown = await res.json();
    const parsed = schema.parse(raw);
    expect(raw, path).toStrictEqual(parsed);
    return parsed;
  }
  const casesOf = (b: Browser, cursor?: string) => read(b, `/api/moderation/cases${cursor ? `?cursor=${cursor}` : ""}`, AuthorCasesPage);
  const decisionOf = (b: Browser, id: string) => read(b, `/api/moderation/decisions/${id}`, DecisionView);
  const reportsOf = (b: Browser, cursor?: string) => read(b, `/api/moderation/reports${cursor ? `?cursor=${cursor}` : ""}`, ReportsPage);
  const postOf = (b: Browser, id: string) => read(b, `/api/posts/${id}`, PostView);

  // ---------------------------------------------------------------- the routes

  test("the seven signed-in routes (3e adds the reply) are the module's whole surface under /api/moderation; each refuses a reader without a session and an account that has not chosen a handle", async () => {
    const routes = app.routes.filter((route) => route.path.startsWith("/api/moderation") && route.method !== "ALL").map((route) => `${route.method} ${route.path}`);
    expect([...new Set(routes)].sort()).toEqual([
      "GET /api/moderation/cases",
      "GET /api/moderation/decisions/:id",
      "GET /api/moderation/reports",
      "POST /api/moderation/decisions/:id/appeal",
      "POST /api/moderation/decisions/:id/reply",
      "POST /api/moderation/items/:item/reexamine",
      "POST /api/moderation/report-mail/resume",
    ]);
    // The session is asked for before anything of the request is read: the appeal and the re-examination refuse the
    // same way with no body at all.
    const paths: [string, string | undefined][] = [
      ["/api/moderation/cases", undefined],
      [`/api/moderation/decisions/${randomUUID()}`, undefined],
      ["/api/moderation/reports", undefined],
      ["/api/moderation/report-mail/resume", "POST"],
      [`/api/moderation/decisions/${randomUUID()}/appeal`, "POST"],
      [`/api/moderation/decisions/${randomUUID()}/reply`, "POST"],
      [`/api/moderation/items/${randomUUID()}/reexamine`, "POST"],
    ];
    const half = await signUp(false);
    for (const [path, method] of paths) {
      const signedOut = await new Browser(app, origin).fetch(path, { method });
      expect(signedOut.status, path).toBe(401);
      expect((await error(signedOut)).code, path).toBe("unauthenticated");
      const notOnboarded = await half.b.fetch(path, { method });
      expect(notOnboarded.status, path).toBe(403);
      expect((await error(notOnboarded)).code, path).toBe("onboarding_required");
    }
  });

  test("a decision's address must be an id, a cursor must be one the API wrote, and the resume is a POST with the session's CSRF token", async () => {
    const reader = await signUp();
    const notAnId = await reader.b.fetch("/api/moderation/decisions/not-an-id");
    expect(notAnId.status).toBe(400);
    expect((await error(notAnId)).code).toBe("invalid_request");
    for (const path of ["/api/moderation/cases?cursor=nonsense", "/api/moderation/reports?cursor=nonsense"]) {
      const res = await reader.b.fetch(path);
      expect(res.status, path).toBe(400);
      expect((await error(res)).code, path).toBe("invalid_request");
    }
    expect((await reader.b.fetch("/api/moderation/report-mail/resume")).status).toBe(404);
    const withoutCsrf = await reader.b.fetch("/api/moderation/report-mail/resume", { method: "POST", csrf: false });
    expect(withoutCsrf.status).toBe(403);
    expect((await error(withoutCsrf)).code).toBe("csrf_failed");
  });

  // ---------------------------------------------------------------- the author's list and one decision

  test("the author's list holds the decisions they were told of, newest first, and a decision opens only for its subject; none tells of who reported, what they wrote or how many", async () => {
    const author = await signUp();
    const stranger = await signUp();
    const reporter = await signUp();
    const postId = await newPostRow(w.apiDb, author.id, { body: "the reported words" });
    const explanation = `explained-${randomBytes(6).toString("hex")}`;
    const first = await sent(report([postTarget(postId)], { ruleId: "R3", explanation }), reporter.session);
    await sent(notices.rule([postTarget(postId)]));
    const interim = await decided(moderator, first.caseId, { kind: "interim", ruleId: "R3", actions: [act("withhold")] });
    const final = await decided(moderator, first.caseId, { kind: "final", ruleId: "R3", actions: [act("remove")] });
    // A second post of the author's, reported and found fine: its author is told nothing of that decision.
    const fine = await newPostRow(w.apiDb, author.id);
    const other = await sent(report([postTarget(fine)]), reporter.session);
    const silent = await decided(moderator, other.caseId, { kind: "final", outcome: "no_violation" });

    const page = await casesOf(author.b);
    const created = (await w.apiDb.execute<{ at: string }>(sql`select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at from posts where id = ${postId}::uuid`))[0]!.at;
    expect(page.nextCursor).toBeNull();
    expect(page.decisions).toEqual([
      // 3e: the removal under R3 gives the post its strike, listed with the day it stops counting.
      { id: final, kind: "final", outcome: "restricted", decidedOn: today(), post: { id: postId, createdAt: created }, actions: ["remove", "strike"], endedInterim: true, ruleId: "R3", legal: false, appealUntil: expect.any(String), appeal: null, reversedOn: null, strike: { countsUntil: expect.any(String), overruledAt: null } },
      { id: interim, kind: "interim", outcome: "restricted", decidedOn: today(), post: { id: postId, createdAt: created }, actions: ["withhold"], endedInterim: false, ruleId: "R3", legal: false, appealUntil: null, appeal: null, reversedOn: null, strike: null },
    ]);
    expect(page.decisions.map((row) => row.id)).not.toContain(silent);
    expect((await casesOf(stranger.b)).decisions).toEqual([]);
    expect((await casesOf(reporter.b)).decisions).toEqual([]);

    // The decision's view: the statement's data, where its appeal stands, and the content it was made on.
    const view = await decisionOf(author.b, final);
    const decidedAt = new Date(view.decidedAt);
    expect(view).toMatchObject({ id: final, kind: "final", outcome: "restricted", ground: "incompatible", ruleId: "R3", source: "report", post: { id: postId, createdAt: created }, reversedOn: null });
    expect(view.appealUntil).toBe(appealDeadline(decidedAt).toISOString());
    expect(page.decisions[0]!.appealUntil).toBe(view.appealUntil);
    // 3e: the removal gave a strike, with the day it stops counting and the strikes that counted then.
    expect(view.measures).toMatchObject([
      { kind: "remove", mediaId: null, sealed: null },
      { kind: "strike", mediaId: null, sealed: null, endsAt: page.decisions[0]!.strike!.countsUntil, activeThen: 1 },
    ]);
    expect(view.endedMeasures).toEqual([{ kind: "withhold", mediaId: null, resetDecisionId: null, oldValueKept: false, resetRuleId: null }]);
    expect(view.content).toEqual({ kind: "post", body: "the reported words", deletedByAuthor: false, images: [], imageCount: 0, imagesHidden: null });
    // It renders as the mail did: the app calls the same function on the same data.
    const paragraphs = statementParagraphs(view);
    expect(paragraphs.join(" ")).toContain(getRule("R3")!.title);
    expect(w.mailer.to(author.email, "moderation_decision").at(-1)!.data.statement).toBe(paragraphs.join(String.fromCharCode(10)));
    const whileDeciding = await decisionOf(author.b, interim);
    expect(whileDeciding).toMatchObject({ kind: "interim", appealUntil: null, reversedOn: null, content: { kind: "post", body: "the reported words" } });

    // Nobody else opens it, the reporter included, and a decision its author was not told of opens for nobody.
    for (const [who, id] of [[stranger.b, final], [reporter.b, final], [author.b, silent], [author.b, randomUUID()]] as const) {
      const res = await who.fetch(`/api/moderation/decisions/${id}`);
      expect(res.status).toBe(404);
      expect((await error(res)).code).toBe("not_found");
    }

    // The post's chip names the removal, to its author alone.
    expect((await postOf(author.b, postId)).moderation).toEqual({ decisionId: final, ruleId: "R3", legal: false, interim: false, strikeUntil: page.decisions[0]!.strike!.countsUntil });
    const whole = JSON.stringify([page, view, whileDeciding, await postOf(author.b, postId), w.mailer.to(author.email, "moderation_decision")]);
    for (const secret of [reporter.handle, reporter.id, explanation, first.ref]) expect(whole.includes(secret), secret).toBe(false);
    // And no member of the answers could carry a report, its sender or a count of them: the source is a category.
    const names = new Set<string>();
    const collect = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(collect);
      else if (value !== null && typeof value === "object") for (const [name, member] of Object.entries(value)) (names.add(name), collect(member));
    };
    collect([page, view, whileDeciding]);
    expect([...names].filter((name) => /report|intake|notice|notifier|sender|count$|items?$/i.test(name))).toEqual(["imageCount"]);
    expect(view.source).toBe("report");
  });

  test("a post whose images are sealed keeps its text and its place in its author's views: each image is a placeholder that tells the author alone that it is sealed, the post has no chip, and the sealing decision's view shows the text beside the sealed images", async () => {
    const author = await signUp();
    const reader = await signUp();
    const postId = await newPostRow(w.apiDb, author.id, { body: "text beside the images" });
    const images = [await newImageRow(w.apiDb, author.id, postId, 0), await newImageRow(w.apiDb, author.id, postId, 1)];
    const notice = await sent(notices.csam([postTarget(postId)]));
    const seal = await decided(moderator, notice.caseId, { kind: "interim", ruleId: "R2", actions: [act("seal_media")] });

    const own = await postOf(author.b, postId);
    expect(own).toMatchObject({ id: postId, body: "text beside the images", state: "visible" });
    expect(own.media).toEqual(images.map((id) => ({ id, hidden: true, sealed: true })));
    // The post itself is neither withheld nor removed: it has no chip, and the decision is under Settings, Cases.
    expect("moderation" in own).toBe(false);
    for (const other of [reader.b, new Browser(app, origin)]) expect((await postOf(other, postId)).media).toEqual(images.map((id) => ({ id, hidden: true })));

    expect((await casesOf(author.b)).decisions).toMatchObject([{ id: seal, kind: "interim", actions: ["seal_media"], ruleId: "R2", legal: false, appealUntil: null, reversedOn: null }]);
    const view = await decisionOf(author.b, seal);
    expect(view.measures).toEqual([{ kind: "seal_media", mediaId: null, noEffect: null, sealed: { posts: 1, images: 2, deletedImages: 0 } }]);
    expect(view.content).toEqual({ kind: "post", body: "text beside the images", deletedByAuthor: false, images: [], imageCount: 2, imagesHidden: "sealed" });
    // Nothing of a sealed image is in the answer: no id, no path and no description.
    for (const part of [...images, "image 1", "image 2", "/api/media/"]) expect(JSON.stringify(view).includes(part), part).toBe(false);

    // An admin answers without a seal: the seal ends, and the decision's view lists the images for the app's own image route.
    const answer = await decided(admin, notice.caseId, { kind: "final", outcome: "no_violation" });
    expect((await decisionOf(author.b, seal)).content).toEqual({
      kind: "post",
      body: "text beside the images",
      deletedByAuthor: false,
      images: images.map((id, index) => ({ id, alt: `image ${index + 1}`, width: 1200, height: 800, small: mediaPath(id, "small"), large: mediaPath(id, "large") })),
      imageCount: 2,
      imagesHidden: null,
    });
    // The author was told that what korbat did while deciding has ended: that decision is listed, above the seal's.
    const page = await casesOf(author.b);
    expect(page.decisions).toMatchObject([{ id: answer, kind: "final", outcome: "no_violation", actions: [], endedInterim: true, ruleId: null, legal: false, appealUntil: null }, { id: seal }]);
    const ended = await decisionOf(author.b, answer);
    // A decision without a measure tells its author neither its facts nor its reason: they are the case's record.
    expect(ended).toMatchObject({ facts: null, reason: null, measures: [], endedMeasures: [{ kind: "seal_media" }] });
  });

  test("a decision about a post its author deleted since shows korbat's copy of the text and none of its images; one whose copy was erased says on which day, and whether the post itself is still there", async () => {
    const author = await signUp();
    const kept = await newPostRow(w.apiDb, author.id, { body: "kept by its author" });
    const gone = await newPostRow(w.apiDb, author.id, { body: "deleted by its author" });
    const goneImage = await newImageRow(w.apiDb, author.id, gone, 0);
    const decisions: Record<string, string> = {};
    for (const postId of [kept, gone]) {
      const notice = await sent(notices.rule([postTarget(postId)]));
      decisions[postId] = await decided(moderator, notice.caseId, { kind: "final", ruleId: "R1", actions: [act("remove")] });
    }
    // The author deletes the second post, as the app's delete does: the row stays as a tombstone, and its image is held for the case.
    await w.apiDb.execute(sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${gone}::uuid`);
    const deleted = await decisionOf(author.b, decisions[gone]!);
    expect(deleted.content).toEqual({ kind: "post", body: "deleted by its author", deletedByAuthor: true, images: [], imageCount: 1, imagesHidden: "deleted_by_author" });
    expect(JSON.stringify(deleted).includes(goneImage)).toBe(false);
    expect(deleted.post).toMatchObject({ id: gone });

    // The retention job's erasure, done here as the migrator does it: the content columns and the salt null, the day stamped.
    await w.migrateDb.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '10s'`);
      await tx.execute(sql`update evidence_snapshots set body = null, media = null, display_name = null, bio = null, salt = null, erased_at = now()
                            where id in (select snapshot_id from decisions where id = any(${`{${Object.values(decisions).join(",")}}`}::uuid[]))`);
    });
    expect((await decisionOf(author.b, decisions[kept]!)).content).toEqual({ kind: "erased", contentErasedOn: today(), postKept: true });
    expect((await decisionOf(author.b, decisions[gone]!)).content).toEqual({ kind: "erased", contentErasedOn: today(), postKept: false });
    // Once an R4 redaction erased the content, every decision about the post says so, whichever is viewed.
    await w.migrateDb.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '10s'`);
      await tx.execute(sql`update decisions set redacted_at = now() where id = ${decisions[kept]!}::uuid`);
    });
    expect((await decisionOf(author.b, decisions[kept]!)).content).toEqual({ kind: "r4_redacted" });
    expect((await decisionOf(author.b, decisions[gone]!)).content).toEqual({ kind: "erased", contentErasedOn: today(), postKept: false });
  });

  test("a removal reversed in full says on which day, and leaves nothing to appeal; the correction is a decision of its own in the list", async () => {
    const author = await signUp();
    const postId = await newPostRow(w.apiDb, author.id);
    const notice = await sent(notices.illegal([postTarget(postId)], { email: w.address() }));
    const removal = await decided(moderator, notice.caseId, { kind: "final", ground: "illegal", actions: [act("remove")] });
    expect((await decisionOf(author.b, removal)).appealUntil).not.toBeNull();
    // 3e: a removal on the ground of the law gives no strike.
    expect((await postOf(author.b, postId)).moderation).toEqual({ decisionId: removal, ruleId: null, legal: true, interim: false, strikeUntil: null });
    const correction = await decided(moderator, notice.caseId, { kind: "correction", reviewsDecisionId: removal, actions: [act("restore")] });

    const page = await casesOf(author.b);
    expect(page.decisions).toMatchObject([
      { id: correction, kind: "correction", outcome: "reversed", actions: ["restore"], ruleId: null, legal: false, appealUntil: null, reversedOn: null },
      { id: removal, kind: "final", outcome: "restricted", actions: ["remove"], ruleId: null, legal: true, appealUntil: null, reversedOn: today() },
    ]);
    expect(await decisionOf(author.b, removal)).toMatchObject({ source: "notice", ground: "illegal", appealUntil: null, reversedOn: today() });
    expect(await decisionOf(author.b, correction)).toMatchObject({ kind: "correction", reviewed: { kind: "final", ground: "illegal" }, reversals: [{ kind: "restore" }], appealUntil: null, reversedOn: null });
    // The post is visible again, and carries no chip.
    const post = await postOf(author.b, postId);
    expect(post.state).toBe("visible");
    expect("moderation" in post).toBe(false);
  });

  test("a decision about the account shows the fields as korbat copied them, which for a reset is the value the reset removed; it names no post", async () => {
    const author = await signUp();
    const bio = `my own bio ${randomBytes(4).toString("hex")}`;
    await w.apiDb.execute(sql`update profiles set bio = ${bio} where id = ${author.id}::uuid`);
    const notice = await sent(notices.rule([accountTarget(author.handle)], { ruleId: "R6" }));
    const reset = await decided(moderator, notice.caseId, { kind: "final", ruleId: "R6", actions: [act("reset_bio")] });
    const view = await decisionOf(author.b, reset);
    expect(view).toMatchObject({ kind: "final", post: null, ruleId: "R6", measures: [{ kind: "reset_bio", noEffect: null }] });
    expect(view.content).toEqual({ kind: "account", handle: author.handle, displayName: `User ${author.handle}`, bio });
    expect(view.appealUntil).toBe(appealDeadline(new Date(view.decidedAt)).toISOString());
    expect((await casesOf(author.b)).decisions).toMatchObject([{ id: reset, post: null, actions: ["reset_bio"], ruleId: "R6" }]);
  });

  test("the author's list is read a page at a time, newest first, each decision once", async () => {
    const author = await signUp();
    const made: string[] = [];
    // One decision more than a page holds, each the removal of a post of its own.
    for (let n = 0; n <= 20; n++) {
      const notice = await sent(notices.rule([postTarget(await newPostRow(w.apiDb, author.id))]));
      made.push(await decided(admin, notice.caseId, { kind: "final", ruleId: "R1", actions: [act("remove")] }));
    }
    const first = await casesOf(author.b);
    expect(first.decisions).toHaveLength(20);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await casesOf(author.b, first.nextCursor!);
    expect(second.nextCursor).toBeNull();
    expect([...first.decisions, ...second.decisions].map((row) => row.id)).toEqual([...made].reverse());
  });

  // ---------------------------------------------------------------- the chip

  test("the chip names the decision of the strongest post measure in force: an interim decision as such, a removal before a withhold, the newest removal first; and it is the author's alone", async () => {
    const author = await signUp();
    const reader = await signUp();
    // Withheld while korbat decides, under R4.
    const held = await newPostRow(w.apiDb, author.id);
    const first = await sent(notices.rule([postTarget(held)], { ruleId: "R4" }));
    const withhold = await decided(moderator, first.caseId, { kind: "interim", ruleId: "R4", actions: [act("withhold")] });
    expect(await postOf(author.b, held)).toMatchObject({ state: "withheld", moderation: { decisionId: withhold, ruleId: "R4", legal: false, interim: true } });
    // Nobody else is shown a withheld post at all.
    expect((await reader.b.fetch(`/api/posts/${held}`)).status).toBe(404);

    // Removed twice, by the decisions of two cases: the newer removal is named.
    const twice = await newPostRow(w.apiDb, author.id);
    const one = await sent(notices.rule([postTarget(twice)]));
    await decided(moderator, one.caseId, { kind: "final", ruleId: "R1", actions: [act("remove")] });
    const two = await sent(notices.rule([postTarget(twice)], { ruleId: "R3" }));
    const newer = await decided(moderator, two.caseId, { kind: "final", ruleId: "R3", actions: [act("remove")] });
    // 3e: the post got its one strike from the R1 removal; the newer removal gives none, so its chip names no strike.
    expect((await postOf(author.b, twice)).moderation).toEqual({ decisionId: newer, ruleId: "R3", legal: false, interim: false, strikeUntil: null });
    // A withhold while a third case is decided does not take the chip from the removal.
    const three = await sent(notices.rule([postTarget(twice)], { ruleId: "R6" }));
    await decided(moderator, three.caseId, { kind: "interim", ruleId: "R6", actions: [act("withhold")] });
    expect(await postOf(author.b, twice)).toMatchObject({ state: "removed", moderation: { decisionId: newer, ruleId: "R3", interim: false } });

    // The author's own lists carry the chip too; a visible post carries none.
    const fine = await newPostRow(w.apiDb, author.id);
    const list = await read(author.b, `/api/profiles/${author.handle}/posts?limit=50`, TimelinePage);
    const listed = new Map(list.items.map((item) => [item.post.id, item.post]));
    expect(listed.get(held)?.moderation).toEqual({ decisionId: withhold, ruleId: "R4", legal: false, interim: true, strikeUntil: null });
    expect(listed.get(twice)?.moderation).toMatchObject({ decisionId: newer });
    expect("moderation" in listed.get(fine)!).toBe(false);
  });

  // ---------------------------------------------------------------- the reporter's list

  const waiting = { suspect: false, sealed: false, unseen: false, quotedBy: null, outcome: null, decidedOn: null, changed: false, reexamines: false, reexamination: null };
  // In Your reports each item also carries its id, which is what "Ask for a re-examination" names there; the status
  // page names an item by its position and carries none.
  const reported = { ...waiting, id: expect.stringMatching(/^[0-9a-f-]{36}$/) };

  test("Your reports lists the account's own reports, newest first, each item under the link it named and silent until the daily release; then in the words of the mail, an account still under the handle the report named", async () => {
    const reporter = await signUp();
    const other = await signUp();
    const subject = await w.account();
    const author = await w.account();
    const postId = await newPostRow(w.apiDb, author.id);
    const quoting = await newPostRow(w.apiDb, author.id, { quoteOfId: postId });
    const first = await sent(report([postTarget(postId), accountTarget(subject.handle)], { ruleId: "R3" }), reporter.session);
    // Someone signed out reports the same post: one decision answers both, and each sender reads the same words.
    const beside = await sent(notices.rule([postTarget(postId)], { ruleId: "R3" }));
    const second = await sent(notices.illegal([postTarget(quoting)], { turnstileToken: undefined }), reporter.session);
    // On the path for child sexual abuse material korbat records no sender, the account included: it is listed nowhere.
    const elsewhere = await newPostRow(w.apiDb, author.id);
    const anonymous = await sent(notices.csam([postTarget(elsewhere)], { turnstileToken: undefined }), reporter.session);
    expect(anonymous.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await sent(report([postTarget(elsewhere)]), other.session);

    const silent = await reportsOf(reporter.b);
    expect(silent).toEqual({
      reports: [
        { ref: second.ref, receivedAt: expect.stringMatching(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]{12}Z$/), items: [{ position: 1, link: `${origin}/post/${quoting}`, scope: null, ...reported }] },
        { ref: first.ref, receivedAt: expect.stringMatching(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]{12}Z$/), items: [{ position: 1, link: `${origin}/post/${postId}`, scope: null, ...reported }, { position: 2, link: `${origin}/u/${subject.handle}`, scope: "account", ...reported }] },
      ],
      nextCursor: null,
      reportMailStopped: false,
    });
    expect((await reportsOf(other.b)).reports).toHaveLength(1);

    // Decided, and still silent: nothing is told before the daily release.
    await decided(moderator, first.items[0]!.case_id!, { kind: "final", ruleId: "R3", actions: [act("remove")] });
    await decided(moderator, first.items[1]!.case_id!, { kind: "final", outcome: "no_violation" });
    await decided(moderator, second.caseId, { kind: "final", outcome: "not_evident" });
    expect(await reportsOf(reporter.b)).toEqual(silent);
    // The account changes its handle after the report: the list keeps the handle the report named.
    const renamed = `r_${randomBytes(5).toString("hex")}`;
    await w.apiDb.execute(sql`update profiles set handle = ${renamed} where id = ${subject.id}::uuid`);
    await release();

    const after = await reportsOf(reporter.b);
    const rule = { id: "R3", title: getRule("R3")!.title };
    const until = expect.stringMatching(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T/);
    expect(after.reports).toEqual([
      { ref: second.ref, receivedAt: silent.reports[0]!.receivedAt, items: [{ ...reported, position: 1, link: `${origin}/post/${quoting}`, scope: "quote", outcome: "not_evident", decidedOn: today(), reexamination: { open: true, until } }] },
      {
        ref: first.ref,
        receivedAt: silent.reports[1]!.receivedAt,
        items: [
          { ...reported, position: 1, link: `${origin}/post/${postId}`, scope: null, outcome: "restricted_rule", decidedOn: today(), rule },
          { ...reported, position: 2, link: `${origin}/u/${subject.handle}`, scope: "account", outcome: "no_violation", decidedOn: today(), reexamination: { open: true, until } },
        ],
      },
    ]);
    expect(JSON.stringify(after).includes(renamed)).toBe(false);
    const words = after.reports.flatMap((row) => row.items.map(itemOutcomeWords));
    expect(words).toEqual([
      `${OUTCOME_PHRASES.not_evident}. ${QUOTE_ITEM_SCOPE}`,
      `access restricted: it breaks korbat rule R3 (${rule.title}).`,
      `${OUTCOME_PHRASES.no_violation}. ${ACCOUNT_ITEM_SCOPE}`,
    ]);
    // The status page of the signed-out report beside it carries the same facts, and so reads the same words.
    const status = await noticeStatus(w.deps, { ref: beside.ref, token: beside.token! }, w.sender().netHash);
    expect(status.items).toEqual([{ ...waiting, position: 1, link: `${origin}/post/${postId}`, scope: null, outcome: "restricted_rule", decidedOn: today(), rule }]);
    expect(itemOutcomeWords(status.items[0]!)).toBe(words[1]);

    // The line of the daily mail that is owed for the notice of illegality reads the list's words: one composition for both.
    const lineOf = async (ref: string) => updateLine(w.deps, (await pendingOutcomeLines(w.apiDb)).find((row) => row.ref === ref)!);
    expect((await lineOf(second.ref)).outcome).toBe(words[0]);

    // A notice about the post, now removed: the new removal changed nothing anyone sees, and the list and the mail's line say so.
    const again = await sent(notices.illegal([postTarget(postId)], { turnstileToken: undefined }), reporter.session);
    await decided(moderator, again.caseId, { kind: "final", ground: "illegal", actions: [act("remove")] });
    await release();
    const newest = (await reportsOf(reporter.b)).reports[0]!;
    expect(newest).toMatchObject({ ref: again.ref, items: [{ outcome: "restricted_legal", noEffect: true }] });
    expect("rule" in newest.items[0]!).toBe(false);
    expect(itemOutcomeWords(newest.items[0]!)).toBe(`${OUTCOME_PHRASES.restricted_legal}. ${ALREADY_NOT_SHOWN}`);
    expect((await lineOf(again.ref)).outcome).toBe(itemOutcomeWords(newest.items[0]!));
  });

  test("a report on a post whose images nobody could open reads UNSEEN_NO_ACTION in Your reports and can still be examined again; a seal reads the sealed phrase", async () => {
    const reporter = await signUp();
    // Frozen through its author's account's case: a report of child sexual abuse material names the account.
    const frozen = await w.account();
    const frozenPost = await newPostRow(w.apiDb, frozen.id);
    await newImageRow(w.apiDb, frozen.id, frozenPost, 0);
    const freeze = await sent(notices.csam([accountTarget(frozen.handle)]));
    const unseen = await sent(report([postTarget(frozenPost)]), reporter.session);
    await decided(moderator, unseen.caseId, { kind: "final", outcome: "no_violation" });
    // An account whose images an admin seals for good: the reporter's own rule report about it is answered by the seal.
    const sealedOwner = await w.account();
    await newImageRow(w.apiDb, sealedOwner.id, await newPostRow(w.apiDb, sealedOwner.id), 0);
    const about = await sent(report([accountTarget(sealedOwner.handle)], { ruleId: "R6" }), reporter.session);
    await sent(notices.csam([accountTarget(sealedOwner.handle)]));
    await decided(admin, about.caseId, { kind: "final", ruleId: "R2", actions: [act("seal_media")] });
    await release();

    const page = await reportsOf(reporter.b);
    expect(page.reports.map((row) => row.ref)).toEqual([about.ref, unseen.ref]);
    expect(page.reports[1]!.items).toMatchObject([{ outcome: "no_violation", unseen: true, sealed: false, scope: null, reexamination: { open: true } }]);
    expect(itemOutcomeWords(page.reports[1]!.items[0]!)).toBe(UNSEEN_NO_ACTION);
    expect(page.reports[0]!.items).toMatchObject([{ outcome: "restricted_rule", sealed: true, unseen: false, scope: "account_suspect", reexamination: null }]);
    expect(itemOutcomeWords(page.reports[0]!.items[0]!)).toBe(`${SUSPECT_OUTCOME_PHRASES.sealed} ${ACCOUNT_SUSPECT_SCOPE}`);
    // The account's own case is answered, so that nothing of this test keeps a post frozen.
    await decided(admin, freeze.caseId, { kind: "final", outcome: "no_violation" });
  });

  test("the list is read a page at a time; a link that named nothing is answered automatically, a post's and an account's alike, with no scope sentence", async () => {
    const reporter = await signUp();
    const refs: string[] = [];
    for (let n = 0; n <= REPORTS_PAGE_SIZE; n++) {
      // Ten reports an hour from one account: the limit store's clock moves on before the next ten.
      if (n % 9 === 0) w.ahead.limitsMs += HOUR;
      const target = n === 0 ? accountTarget(`gone_${randomBytes(4).toString("hex")}`) : { kind: "link" as const, url: `${origin}/post/${randomUUID()}` };
      refs.push((await sent(report([target]), reporter.session)).ref);
    }
    await release();
    const first = await reportsOf(reporter.b);
    expect(first.reports).toHaveLength(REPORTS_PAGE_SIZE);
    const second = await reportsOf(reporter.b, first.nextCursor!);
    expect(second.nextCursor).toBeNull();
    expect([...first.reports, ...second.reports].map((row) => row.ref)).toEqual([...refs].reverse());
    const oldest = second.reports[0]!.items[0]!;
    expect(oldest).toMatchObject({ scope: "account", outcome: "not_available", decidedOn: expect.stringMatching(DAY), reexamination: null });
    expect(itemOutcomeWords(oldest)).toBe(`${OUTCOME_PHRASES.not_available}.`);
    expect(itemOutcomeWords(first.reports[0]!.items[0]!)).toBe(`${OUTCOME_PHRASES.not_available}.`);
  });

  test("the list says when korbat's report mails to the account are stopped, and the account's resume lifts that: a POST that answers 204 whether or not there was a stop", async () => {
    const reporter = await signUp();
    const other = await signUp();
    expect((await reportsOf(reporter.b)).reportMailStopped).toBe(false);
    // The stop comes from the address itself, on the status page of a notice sent signed out with it.
    const author = await w.account();
    const signedOut = await sent(notices.illegal([postTarget(await newPostRow(w.apiDb, author.id))], { email: reporter.email }));
    const token = /#t=([A-Za-z0-9_-]{43})$/.exec(w.mailer.to(reporter.email, "notice_received").at(-1)!.data.pageUrl!)![1]!;
    expect(await w.authForModeration.stopNotifier((await w.notice(signedOut.ref))!.contact_id!, token)).toBe(true);
    expect((await reportsOf(reporter.b)).reportMailStopped).toBe(true);
    expect((await reportsOf(other.b)).reportMailStopped).toBe(false);

    // Another account's resume lifts nothing of this one's.
    const resume = (b: Browser) => b.fetch("/api/moderation/report-mail/resume", { method: "POST" });
    const none = await resume(other.b);
    expect([none.status, await none.text()]).toEqual([204, ""]);
    expect((await reportsOf(reporter.b)).reportMailStopped).toBe(true);
    const lifted = await resume(reporter.b);
    expect([lifted.status, await lifted.text()]).toEqual([204, ""]);
    expect((await reportsOf(reporter.b)).reportMailStopped).toBe(false);
    expect(await w.authForModeration.accountReportMailStopped(reporter.id)).toBe(false);
    expect((await resume(reporter.b)).status).toBe(204);
  });

  test("this file left no row behind: the moderation tables and the four auth tables of moderation cases hold what they held before it", async () => {
    await w.cleanUp();
    await d.close();
    expect(await counts()).toEqual(before);
  });
});
