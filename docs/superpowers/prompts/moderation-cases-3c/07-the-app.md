# korbat moderation cases (3c) — Task 7 of 12: The app: the author's cases and decisions and a reporter's own reports over the API, the post chip, the report form with its three grounds, the notice status page, the cases and decision screens, Your reports, Report on posts, images and profiles, and the contact address in the terms

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-10-03 to 2026-10-12 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Tasks 1 to 6 built the ground, the decision engine, the images' side, the notice routes, the console and the dispatch. This task builds the app's side: the author's routes and screens, the report form, the notice status page and Your reports. The design is `docs/superpowers/specs/2026-10-02-moderation-cases-3c-design.md` (sections 5, 7.2, 7.6, 9, 10 and 11). This task changes an example env file: after writing the files and before the checks, run `node scripts/gen-dev-env.mjs`, which appends every setting that is new in an example to the ignored env files, generates the keys an example marks and prints no value.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. The `install` step runs `pnpm install` with that floor in force, and the `lockfile-age` step then proves that every newly locked version is at least 7 days old. `pnpm-lock.yaml` is written by the install, never by hand. Never edit `pnpm-workspace.yaml` or `.npmrc`, and never add a package this task does not name.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(rules,api,admin): deciding in the console, statements and the dispatch: packages/rules renders a decision's statement of reasons from its recorded rulebook and redress versions (statementParagraphs, with the sentences of a seal), so an old statement reads exactly as sent; the console gains the decision composer with its preview and draft slot: the range of an admin's answer on a case with an unanswered report of child sexual abuse material stops at the newest such report, a final decision without a measure on a post whose images cannot be opened says that its other reports are answered unseen, whoever is on duty seals what the case reaches with the fixed drafts or records that they do not, and an admin lifts a seal or corrects a decision; the decision route answers the case as read after the commit, mails the author (moderation_decision, moderation_burst) and, when protection was lifted, every staff account (moderation_csam_lifted), and the home screen lists lifted protections, recorded choices not to seal and the seals taken while deciding; the dispatch job sends receipts and statements, releases outcomes once a day, sends each notifier and reporter one update with the outcome's words (sealed without being opened; no action for now, the images could not be opened; the scopes), repeats the urgent alert while a reported image is still served or nobody has acted, and alerts on the queue's age`.

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
python docs/superpowers/prompts/moderation-cases-3c/write_blocks.py docs/superpowers/prompts/moderation-cases-3c/07-the-app.md 1
```

Expected: 7 lines starting with `wrote`, one for each file below.

### Create `apps/api/test/integration/moderation-author.test.ts`

```ts
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

  test("the four signed-in routes are the module's whole surface under /api/moderation; each refuses a reader without a session and an account that has not chosen a handle", async () => {
    const routes = app.routes.filter((route) => route.path.startsWith("/api/moderation") && route.method !== "ALL").map((route) => `${route.method} ${route.path}`);
    expect([...new Set(routes)].sort()).toEqual(["GET /api/moderation/cases", "GET /api/moderation/decisions/:id", "GET /api/moderation/reports", "POST /api/moderation/report-mail/resume"]);
    const paths: [string, string | undefined][] = [
      ["/api/moderation/cases", undefined],
      [`/api/moderation/decisions/${randomUUID()}`, undefined],
      ["/api/moderation/reports", undefined],
      ["/api/moderation/report-mail/resume", "POST"],
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
      { id: final, kind: "final", outcome: "restricted", decidedOn: today(), post: { id: postId, createdAt: created }, actions: ["remove"], endedInterim: true, ruleId: "R3", legal: false, appealUntil: expect.any(String), reversedOn: null },
      { id: interim, kind: "interim", outcome: "restricted", decidedOn: today(), post: { id: postId, createdAt: created }, actions: ["withhold"], endedInterim: false, ruleId: "R3", legal: false, appealUntil: null, reversedOn: null },
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
    expect(view.measures).toMatchObject([{ kind: "remove", mediaId: null, sealed: null }]);
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
    expect((await postOf(author.b, postId)).moderation).toEqual({ decisionId: final, ruleId: "R3", legal: false, interim: false });
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
    expect((await postOf(author.b, postId)).moderation).toEqual({ decisionId: removal, ruleId: null, legal: true, interim: false });
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
    expect((await postOf(author.b, twice)).moderation).toEqual({ decisionId: newer, ruleId: "R3", legal: false, interim: false });
    // A withhold while a third case is decided does not take the chip from the removal.
    const three = await sent(notices.rule([postTarget(twice)], { ruleId: "R6" }));
    await decided(moderator, three.caseId, { kind: "interim", ruleId: "R6", actions: [act("withhold")] });
    expect(await postOf(author.b, twice)).toMatchObject({ state: "removed", moderation: { decisionId: newer, ruleId: "R3", interim: false } });

    // The author's own lists carry the chip too; a visible post carries none.
    const fine = await newPostRow(w.apiDb, author.id);
    const list = await read(author.b, `/api/profiles/${author.handle}/posts?limit=50`, TimelinePage);
    const listed = new Map(list.items.map((item) => [item.post.id, item.post]));
    expect(listed.get(held)?.moderation).toEqual({ decisionId: withhold, ruleId: "R4", legal: false, interim: true });
    expect(listed.get(twice)?.moderation).toMatchObject({ decisionId: newer });
    expect("moderation" in listed.get(fine)!).toBe(false);
  });

  // ---------------------------------------------------------------- the reporter's list

  const waiting = { suspect: false, sealed: false, unseen: false, quotedBy: null, outcome: null, decidedOn: null, changed: false, reexamines: false, reexamination: null };

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
        { ref: second.ref, receivedAt: expect.stringMatching(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]{12}Z$/), items: [{ position: 1, link: `${origin}/post/${quoting}`, scope: null, ...waiting }] },
        { ref: first.ref, receivedAt: expect.stringMatching(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]{12}Z$/), items: [{ position: 1, link: `${origin}/post/${postId}`, scope: null, ...waiting }, { position: 2, link: `${origin}/u/${subject.handle}`, scope: "account", ...waiting }] },
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
      { ref: second.ref, receivedAt: silent.reports[0]!.receivedAt, items: [{ ...waiting, position: 1, link: `${origin}/post/${quoting}`, scope: "quote", outcome: "not_evident", decidedOn: today(), reexamination: { open: true, until } }] },
      {
        ref: first.ref,
        receivedAt: silent.reports[1]!.receivedAt,
        items: [
          { ...waiting, position: 1, link: `${origin}/post/${postId}`, scope: null, outcome: "restricted_rule", decidedOn: today(), rule },
          { ...waiting, position: 2, link: `${origin}/u/${subject.handle}`, scope: "account", outcome: "no_violation", decidedOn: today(), reexamination: { open: true, until } },
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
```

### Create `apps/api/test/moderation-author.test.ts`

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import pino from "pino";
import { describe, expect, test } from "vitest";
import { ErrorEnvelope, type PostModeration } from "@korbat/contracts";
import type { AppEnv } from "../src/env";
import { MemoryStore } from "../src/middleware/rate-limit";
import { createModeration, type CreateModerationOptions, type ModerationForSocial } from "../src/moderation";
import { decodeListCursor, encodeListCursor } from "../src/moderation/author";
import type { SocialDeps } from "../src/social";
import type { PostRow } from "../src/social/repo";
import { isTombstone, loadPostViews } from "../src/social/views";

/**
 * The author's side of moderation cases without a database (3c design, sections 5, 7.6 and 11): which source files may
 * name a report at all, that the signed-in routes refuse everyone unless the server hands them its session guard, how the
 * server wires the module, and how a post's view comes by its chip.
 */
const SRC = fileURLToPath(new URL("../src", import.meta.url));
const read = (file: string) => readFileSync(`${SRC}/${file}`, "utf8");

describe("what the author's reads may name", () => {
  // Whatever the author sees is built from these three files, and none of them can reach a report: not who sent it, not
  // what it said, not how many there were. A statement names its source as a category only.
  const FILES = ["moderation/author.ts", "moderation/author-repo.ts", "moderation/statement.ts"];
  const REPORT_NAMES = /\b(intakes|intakeItems|intake_items)\b/;

  test("the author's reads and the statement's data never name the tables of reports and notices", () => {
    for (const file of FILES) expect(REPORT_NAMES.test(read(file)), file).toBe(false);
  });

  test("the scan catches each name, in a query, through the query builder and in a comment", () => {
    for (const source of ["sql`select count(*) from intake_items i where i.case_id = ${caseId}`", "await db.select().from(intakeItems)", "// joined with intakes for the reporter", 'sql`from "public"."intakes" n`']) {
      expect(REPORT_NAMES.test(source), source).toBe(true);
    }
    // A word that only contains a name is not the name.
    expect(REPORT_NAMES.test("const intakesSeen = 1; const reintake_items_x = 2;")).toBe(false);
  });

  test("the reporter's list is read in a file of its own, which the author's reads do not import", () => {
    expect(read("moderation/author.ts")).not.toMatch(/from "\.\/(reports|intake|repo)"/);
    expect(read("moderation/author-repo.ts")).not.toMatch(/from "\.\/(reports|intake)"/);
  });
});

describe("the module's signed-in routes", () => {
  const config = { APP_ORIGIN: "http://localhost:8081" } as CreateModerationOptions["config"];
  const untouched = new Proxy({}, { get: () => () => Promise.reject(new Error("a refused request reached a flow")) });
  const options = (extra: Partial<CreateModerationOptions> = {}): CreateModerationOptions => ({
    apiDb: untouched as CreateModerationOptions["apiDb"],
    auth: untouched as CreateModerationOptions["auth"],
    social: untouched as CreateModerationOptions["social"],
    media: untouched as CreateModerationOptions["media"],
    rateLimitStore: new MemoryStore(),
    config,
    logger: pino({ level: "silent" }),
    ...extra,
  });
  const SIGNED_IN: [string, string][] = [
    ["GET", "/api/moderation/cases"],
    ["GET", "/api/moderation/decisions/00000000-0000-4000-8000-000000000001"],
    ["GET", "/api/moderation/reports"],
    ["POST", "/api/moderation/report-mail/resume"],
  ];

  test("are the four of the design, beside the three public ones", () => {
    const routes = createModeration(options()).routes.routes.filter((route) => route.method !== "ALL").map((route) => `${route.method} ${route.path}`);
    expect([...new Set(routes)].sort()).toEqual(
      ["GET /moderation/cases", "GET /moderation/decisions/:id", "GET /moderation/reports", "POST /moderation/report-mail/resume", "POST /notices", "POST /notices/contact", "POST /notices/status"].sort(),
    );
  });

  test("built without the server's session guard, each refuses every request and reaches no flow", async () => {
    const app = new Hono<AppEnv>().route("/api", createModeration(options()).routes);
    for (const [method, path] of SIGNED_IN) {
      const res = await app.request(path, { method });
      expect(res.status, path).toBe(401);
      expect(ErrorEnvelope.parse(await res.json()).error.code, path).toBe("unauthenticated");
    }
  });

  test("stands behind the guard it is given: what the guard refuses reaches no flow", async () => {
    const seen: string[] = [];
    const refuse = createMiddleware<AppEnv>(async (c) => {
      seen.push(`${c.req.method} ${c.req.path}`);
      return c.json({ error: { code: "onboarding_required", message: "Choose a handle to finish setting up your account." } }, 403);
    });
    const app = new Hono<AppEnv>().route("/api", createModeration(options({ requireSession: refuse })).routes);
    for (const [method, path] of SIGNED_IN) expect((await app.request(path, { method })).status, path).toBe(403);
    expect(seen).toEqual(SIGNED_IN.map(([method, path]) => `${method} ${path}`));
  });

  test("the server hands the module its session guard, and the social module the facts for the chip", () => {
    const index = read("index.ts");
    expect(index).toMatch(/createModeration\(\{[^}]*\brequireSession: auth\.requireSession\b[^}]*\}\)/);
    // Nothing closes between the call's opening and the member: it is an option of this call.
    expect(index).toMatch(/createSocial\(\{[^}]*\bmoderation: moderation\.forSocial\b/);
  });
});

describe("the list cursors", () => {
  test("a cursor reads back as it was written, and anything else is refused", () => {
    const at = { at: "2026-10-04T10:00:00.123456Z", id: "00000000-0000-4000-8000-000000000001" };
    expect(decodeListCursor(encodeListCursor(at))).toEqual(at);
    for (const bad of ["x", Buffer.from("{}").toString("base64url"), Buffer.from(JSON.stringify(["2026-10-04", at.id])).toString("base64url"), Buffer.from(JSON.stringify([at.at, "no-id"])).toString("base64url"), Buffer.from(JSON.stringify([at.at, at.id, 1])).toString("base64url")]) {
      expect(() => decodeListCursor(bad), bad).toThrowError(expect.objectContaining({ code: "invalid_request" }));
    }
  });
});

describe("a post's chip in its view", () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const ME = id(900);
  const OTHER = id(901);
  const row = (n: number, authorId: string, state: PostRow["state"], extra: Partial<PostRow> = {}): PostRow => ({
    id: id(n),
    authorId,
    body: `post ${n}`,
    replyToId: null,
    quoteOfId: null,
    state,
    likeCount: 0,
    repostCount: 0,
    replyCount: 0,
    quoteCount: 0,
    createdAt: new Date("2026-10-04T10:00:00.000Z"),
    deletedAt: null,
    author: { id: authorId, handle: authorId === ME ? "me" : "other", displayName: "A", verified: false },
    replyToHandle: null,
    replyToAuthorId: null,
    replyToState: null,
    ...extra,
  });

  /** The social module's view source over rows held in memory, with a record of what the moderation module was asked. */
  function source(rows: PostRow[], facts: Record<string, PostModeration>) {
    const asked: { viewer: string; postIds: string[] }[] = [];
    const moderation: ModerationForSocial = {
      authorFacts: async (viewer, postIds) => {
        asked.push({ viewer, postIds: [...postIds] });
        return new Map(Object.entries(facts));
      },
    };
    const repo = {
      findPosts: async (ids: string[]) => new Map(rows.filter((r) => ids.includes(r.id)).map((r) => [r.id, r])),
      blockedEitherWay: async () => new Set<string>(),
      viewerPostStates: async (_viewer: string, ids: string[]) => new Map(ids.map((postId) => [postId, { liked: false, reposted: false, bookmarked: false }])),
      listedInExplore: async () => new Set<string>(),
    } as unknown as SocialDeps["repo"];
    const media = { forPosts: async () => new Map() } as unknown as SocialDeps["media"];
    return { asked, view: { repo, media, moderation } };
  }

  test("the viewer's own withheld and removed posts carry the decision the moderation module names, asked once for the page", async () => {
    const rows = [row(1, ME, "withheld"), row(2, ME, "removed"), row(3, ME, "visible"), row(4, OTHER, "visible")];
    const chips = { [id(1)]: { decisionId: id(51), ruleId: "R4" as const, legal: false, interim: true }, [id(2)]: { decisionId: id(52), ruleId: null, legal: true, interim: false } };
    const s = source(rows, chips);
    const views = await loadPostViews(s.view, ME, rows.map((r) => r.id));
    expect(s.asked).toEqual([{ viewer: ME, postIds: [id(1), id(2)] }]);
    const moderationOf = (n: number) => {
      const view = views.get(id(n))!;
      return isTombstone(view) ? "tombstone" : view.moderation;
    };
    expect(moderationOf(1)).toEqual(chips[id(1)]);
    expect(moderationOf(2)).toEqual(chips[id(2)]);
    expect(moderationOf(3)).toBeUndefined();
    expect(moderationOf(4)).toBeUndefined();
    const visible = views.get(id(3))!;
    expect("moderation" in visible).toBe(false);
  });

  test("nothing is asked for a signed-out reader, for a page of other people's posts, or for a page of the viewer's visible posts", async () => {
    const rows = [row(1, OTHER, "visible"), row(2, ME, "visible")];
    for (const viewer of [null, ME, OTHER]) {
      const s = source(rows, {});
      await loadPostViews(s.view, viewer, rows.map((r) => r.id));
      expect(s.asked, String(viewer)).toEqual([]);
    }
  });

  test("a restricted post the module names no decision for carries no chip, and a quoted embed never carries one", async () => {
    const rows = [row(1, ME, "removed"), row(2, ME, "visible", { quoteOfId: id(3) }), row(3, ME, "withheld")];
    const s = source(rows, { [id(3)]: { decisionId: id(53), ruleId: "R1", legal: false, interim: true } });
    const views = await loadPostViews(s.view, ME, [id(1), id(2)]);
    const first = views.get(id(1))!;
    const second = views.get(id(2))!;
    if (isTombstone(first) || isTombstone(second)) throw new Error("the author sees their own posts");
    expect("moderation" in first).toBe(false);
    // The quoted post is the viewer's own and withheld: its embed shows it, without a chip of its own.
    expect(second.quoteOf).toMatchObject({ id: id(3), state: "withheld" });
    expect("moderation" in (second.quoteOf as object)).toBe(false);
    // Only the posts of the page itself are asked about.
    expect(s.asked).toEqual([{ viewer: ME, postIds: [id(1)] }]);
  });
});
```

### Create `apps/app/test/cases.test.tsx`

```tsx
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import {
  ACCOUNT_SUSPECT_SCOPE,
  OUTCOME_PHRASES,
  SUSPECT_NO_SEAL,
  SUSPECT_OUTCOME_PHRASES,
  UNSEEN_NO_ACTION,
  itemOutcomeWords,
  type AuthorCaseRow,
  type DecisionView,
  type HiddenMedia,
  type MediaView,
  type NoticeItemStatus,
  type NoticeStatus,
  type PostView,
  type ReportsPage,
} from "@korbat/contracts";
import { REDRESS_TEXTS, STATEMENT_WORDS, getRule, statementParagraphs } from "@korbat/rules";
import NoticePage from "../src/app/notice/[ref]";
import { DecisionsList, ReportsList } from "../src/components/moderation/CasesLists";
import { DecisionDetail } from "../src/components/moderation/DecisionDetail";
import { NoticeNotFound, NoticeStatusView } from "../src/components/moderation/NoticeStatusView";
import { SettingsNav } from "../src/components/SettingsNav";
import { HIDDEN_IMAGE, SEALED_IMAGE } from "../src/components/social/HiddenImage";
import { MediaGrid } from "../src/components/social/MediaGrid";
import { MediaViewerContent } from "../src/components/social/MediaViewer";
import { PostCard } from "../src/components/social/PostCard";
import { chipText, fragmentToken, itemRedress, utcMinute } from "../src/lib/moderation";
import { CASES_WORDS, CHIP_WORDS, DECISION_WORDS, STATUS_WORDS } from "../src/lib/moderation-words";

/**
 * The notice status page, the cases screens and the decision screen, the chips and the labels in the web app (3c design,
 * section 9). An outcome's words come from the contracts and a statement's from the rulebook's package, so the tests hold
 * the screens to those functions and pin only the screens' own words. The components are server-rendered with made-up
 * answers in each state; what a static render cannot show (a request, where a token travels) is read from the source.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");
const read = (...parts: string[]): string => readFileSync(path.join(SRC, ...parts), "utf8");

const route = vi.hoisted(() => ({ params: {} as Record<string, string> }));
const session = vi.hoisted(() => ({ state: { status: "signed-out" } as unknown }));

vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  Redirect: () => null,
  router: { push: () => undefined, replace: () => undefined },
  useLocalSearchParams: () => route.params,
  usePathname: () => "/settings/cases",
}));
vi.mock("@/lib/session", () => ({ useSession: () => ({ state: session.state, refresh: async () => session.state }) }));
vi.mock("expo-image", async () => {
  const { createElement } = await import("react");
  return { Image: ({ source, accessibilityLabel }: { source: { uri: string }; accessibilityLabel: string }) => createElement("img", { "data-uri": source.uri, alt: accessibilityLabel }) };
});
vi.mock("react-native-reanimated", () => ({ useReducedMotion: () => false }));

const html = (element: ReactElement): string => renderToStaticMarkup(element);
const textOf = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
const hrefs = (markup: string): string[] => [...markup.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map((match) => match[1]!.replace(/&amp;/g, "&"));
const loaded = (markup: string): string[] => [...markup.matchAll(/data-uri="([^"]+)"/g)].map((match) => match[1]!);
/** The text of every button in the markup. */
const buttons = (markup: string): string[] => [...markup.matchAll(/<(?:div|button)\b[^>]*\brole="button"[^>]*>(.*?)<\/(?:div|button)>/g)].map((match) => textOf(match[1]!));
const count = (whole: string, part: string): number => whole.split(part).length - 1;

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const APP = "http://localhost:8081";
const TIME = "2026-10-04T10:00:00.000Z";

const waiting: NoticeItemStatus = { position: 1, link: `${APP}/post/${id(1)}`, scope: null, suspect: false, sealed: false, unseen: false, quotedBy: null, outcome: null, decidedOn: null, changed: false, reexamines: false, reexamination: null };
const item = (extra: Partial<NoticeItemStatus>): NoticeItemStatus => ({ ...waiting, decidedOn: "2026-10-05", ...extra });
const status = (items: NoticeItemStatus[], contact: NoticeStatus["contact"] = null): NoticeStatus => ({ ref: "N-ABCDEFGH23", receivedAt: TIME, items, contact });
const page = (items: NoticeItemStatus[], contact?: NoticeStatus["contact"]) => html(<NoticeStatusView status={status(items, contact)} />);
const UNTIL = "2027-04-05T07:00:00.000Z";

describe("the words", () => {
  test("the status page's own sentences are the design's", () => {
    expect(STATUS_WORDS.added(2, `${APP}/post/${id(9)}`)).toBe(`The post that item 2 quotes (${APP}/post/${id(9)}), added by korbat`);
    expect(STATUS_WORDS.reexaminationLabel).toBe("Re-examination");
    expect(STATUS_WORDS.reexaminationOpen("2027-04-05")).toBe("A moderator decides it again as a new report. You can ask once for each item, within six months of being told, until 2027-04-05.");
    expect(STATUS_WORDS.final).toBe("This is final within korbat. You can also go to court, or complain to the Digital Services Coordinator of the EU country where you live.");
    expect(STATUS_WORDS.courts).toBe("You can go to court, or complain to the Digital Services Coordinator of the EU country where you live.");
    expect(STATUS_WORDS.confirm).toBe("Yes, I sent this: keep me informed");
    expect(STATUS_WORDS.stop).toBe("I did not send this: stop korbat's report emails to this address");
    expect(STATUS_WORDS.stopHint).toBe(
      "This also stops korbat's emails about reports you send yourself from this address, signed in or not, until you undo it on this page or, if a korbat account uses this address, under Settings, Cases, Your reports.",
    );
    expect(STATUS_WORDS.stopped).toBe("korbat's report emails to this address are stopped.");
    expect(STATUS_WORDS.undo).toBe("Undo: email this address about reports again");
  });

  test("the cases screens' and the decision screen's own sentences are the design's", () => {
    expect(CASES_WORDS.tabs).toEqual({ about: "About you", reports: "Your reports" });
    expect(CASES_WORDS.mailStopped).toBe("korbat does not email you about your reports, because someone using your email address asked it to stop. Their outcomes are listed here.");
    expect(CASES_WORDS.resume).toBe("Email me about my reports again");
    expect(CASES_WORDS.resumeHint).toBe("korbat may then also email this address about reports sent without an account that give it.");
    expect(DECISION_WORDS.post("2026-10-04 10:00 UTC")).toBe("Your post of 2026-10-04 10:00 UTC");
    expect(DECISION_WORDS.r4Redacted).toBe("Content erased when the R4 decision became final");
    expect(DECISION_WORDS.erased("2026-10-05")).toBe("korbat's copy of the content this decision was made on was erased on 2026-10-05 under its retention rules (Terms, Your data).");
    expect(DECISION_WORDS.postKept).toBe("The post itself stays in your profile while you keep it.");
    expect(DECISION_WORDS.deleted).toBe("You deleted this post. korbat keeps this copy for the case for the periods in its terms.");
    expect(DECISION_WORDS.deletedImages).toBe("Images kept for the case, not shown");
    expect(DECISION_WORDS.resetDecision).toBe("The decision that reset it");
    expect(DECISION_WORDS.appeal).toBe("Appeal");
    expect(DECISION_WORDS.reversed("2026-10-06")).toBe("Reversed in full on 2026-10-06: nothing of this decision is in force, so there is nothing to appeal.");
    expect(SEALED_IMAGE).toBe("Sealed: not shown to anyone, you included");
    expect(HIDDEN_IMAGE).toBe("Image hidden by korbat moderation");
  });
});

describe("the notice status page", () => {
  test("shows the reference, when korbat received it, and each item with its link; an undecided item says so and nothing more", () => {
    const out = page([waiting, { ...waiting, position: 2, link: `${APP}/u/ada`, scope: "account" }]);
    const text = textOf(out);
    expect(text).toContain("N-ABCDEFGH23");
    expect(text).toContain(STATUS_WORDS.received(utcMinute(TIME)));
    expect(text).toContain(`${APP}/post/${id(1)}`);
    expect(text).toContain(`${APP}/u/ada`);
    expect(count(text, STATUS_WORDS.waiting)).toBe(2);
    for (const words of [STATUS_WORDS.final, STATUS_WORDS.courts, STATUS_WORDS.reexaminationLabel, "This answer concerns"]) expect(text).not.toContain(words);
    // Opened from the link shown on screen: no contact buttons.
    expect(buttons(out)).toEqual([]);
  });

  test("a decided item reads the words the mail reads: the contracts' one composition from the item's own facts", () => {
    const rule = { id: "R3" as const, title: getRule("R3")!.title };
    const items = [
      item({ outcome: "restricted_rule", rule }),
      item({ position: 2, outcome: "restricted_legal", noEffect: true }),
      item({ position: 3, outcome: "no_violation", reexamination: { open: true, until: UNTIL } }),
      item({ position: 4, link: `${APP}/u/ada`, scope: "account", outcome: "not_available" }),
    ];
    const text = textOf(page(items));
    for (const one of items) expect(text).toContain(itemOutcomeWords(one)!);
    expect(text).toContain(`access restricted: it breaks korbat rule R3 (${rule.title}).`);
    expect(text).toContain(STATUS_WORDS.decided("2026-10-05"));
    // A link that named nothing reads no scope sentence, though the answer keeps the item's scope.
    expect(text).not.toContain("This answer concerns the account's display name and bio.");
  });

  test("a report on the anonymous path reads the phrases of that path, each of them, and after an account's outcome that the answer concerns the images on its posts", () => {
    const sealed = textOf(page([item({ suspect: true, sealed: true, outcome: "restricted_rule", rule: { id: "R2", title: getRule("R2")!.title } })]));
    expect(sealed).toContain(SUSPECT_OUTCOME_PHRASES.sealed);
    expect(sealed).not.toContain("it breaks korbat rule");
    const dismissed = textOf(page([item({ suspect: true, outcome: "no_violation" })]));
    expect(dismissed).toContain(SUSPECT_OUTCOME_PHRASES.no_action);
    expect(dismissed).not.toContain(OUTCOME_PHRASES.no_violation);
    const onText = textOf(page([item({ suspect: true, outcome: "restricted_rule", rule: { id: "R5", title: getRule("R5")!.title } })]));
    expect(onText).toContain(SUSPECT_NO_SEAL);
    const account = textOf(page([item({ link: `${APP}/u/ada`, suspect: true, scope: "account_suspect", outcome: "not_evident" })]));
    expect(account).toContain(`${SUSPECT_OUTCOME_PHRASES.no_action} ${ACCOUNT_SUSPECT_SCOPE}`);
    // A rule report about an account that the sealing decision answered too: the sealed phrase, then the same scope.
    const beside = textOf(page([item({ link: `${APP}/u/ada`, sealed: true, scope: "account_suspect", outcome: "restricted_rule", rule: { id: "R2", title: getRule("R2")!.title } })]));
    expect(beside).toContain(`${SUSPECT_OUTCOME_PHRASES.sealed} ${ACCOUNT_SUSPECT_SCOPE}`);
  });

  test("an answer given while nobody could open the post's images reads UNSEEN_NO_ACTION with the re-examination still open beside it, also when it answers a re-examination, and is never called final", () => {
    const unseen = item({ outcome: "no_violation", unseen: true, reexamination: { open: true, until: UNTIL } });
    for (const one of [unseen, { ...unseen, reexamines: true }]) {
      const text = textOf(page([one]));
      expect(text).toContain(UNSEEN_NO_ACTION);
      expect(text).toContain(STATUS_WORDS.reexaminationOpen(utcMinute(UNTIL)));
      expect(text).not.toContain(STATUS_WORDS.final);
      expect(text).not.toContain(STATUS_WORDS.courts);
      expect(itemRedress(one)).toBe("reexamination");
    }
    // The re-examination's own answer is labelled as one.
    expect(textOf(page([{ ...unseen, reexamines: true }]))).toContain(STATUS_WORDS.reexaminationLabel);
  });

  test("beside an outcome: that it can still be examined again while that is open; that it is final within korbat when it was changed or answers a re-examination; the courts for any other", () => {
    const open = item({ outcome: "not_evident", reexamination: { open: true, until: UNTIL } });
    const asked = item({ outcome: "no_violation", reexamination: { open: false, until: UNTIL } });
    const answer = item({ outcome: "no_violation", reexamines: true });
    const changed = item({ outcome: "reversed", changed: true });
    const restricted = item({ outcome: "restricted_legal" });
    expect([open, asked, answer, changed, restricted, waiting].map(itemRedress)).toEqual(["reexamination", "courts", "final", "final", "courts", "waiting"]);
    // A restriction answered while the images were out of sight is no "no action for now": changed, it is final.
    expect(itemRedress(item({ outcome: "restricted_rule", unseen: true, reexamines: true }))).toBe("final");

    const openText = textOf(page([open]));
    expect(openText).toContain(STATUS_WORDS.reexaminationOpen(utcMinute(UNTIL)));
    expect(openText).not.toContain(STATUS_WORDS.courts);
    for (const one of [asked, restricted]) {
      const text = textOf(page([one]));
      expect(text).toContain(STATUS_WORDS.courts);
      expect(text).not.toContain(STATUS_WORDS.final);
      expect(text).not.toContain("A moderator decides it again");
    }
    for (const one of [answer, changed]) {
      const text = textOf(page([one]));
      expect(text).toContain(STATUS_WORDS.final);
      expect(count(text, "go to court")).toBe(1);
    }
    expect(textOf(page([answer]))).toContain(STATUS_WORDS.reexaminationLabel);
    expect(textOf(page([changed]))).not.toContain(STATUS_WORDS.reexaminationLabel);
  });

  test("an item korbat added for a quoted post is headed as such, after the item it was added for, with an outcome of its own", () => {
    const origin = item({ position: 2, suspect: true, outcome: "no_violation" });
    const added = item({ position: 12, link: `${APP}/post/${id(9)}`, suspect: true, sealed: true, quotedBy: 2, outcome: "restricted_rule", rule: { id: "R2", title: getRule("R2")!.title } });
    const text = textOf(page([origin, added]));
    const heading = STATUS_WORDS.added(2, `${APP}/post/${id(9)}`);
    expect(text).toContain(heading);
    expect(text.indexOf(heading)).toBeGreaterThan(text.indexOf(STATUS_WORDS.item(2)));
    expect(text).toContain(SUSPECT_OUTCOME_PHRASES.sealed);
    expect(text).not.toContain(STATUS_WORDS.item(12));
  });

  test("opened from a mail's link, the page shows the contact's state with its two buttons and what a stop also stops; opened from the on-screen link, none", () => {
    const fromMail = page([waiting], { given: true, confirmed: false, stopped: false });
    expect(buttons(fromMail)).toEqual([STATUS_WORDS.confirm, STATUS_WORDS.stop]);
    expect(textOf(fromMail)).toContain(STATUS_WORDS.stopHint);
    expect(textOf(fromMail)).toContain(STATUS_WORDS.unconfirmed);
    expect(textOf(page([waiting], { given: true, confirmed: true, stopped: false }))).toContain(STATUS_WORDS.confirmed);
    for (const contact of [{ given: true, confirmed: null, stopped: null }, { given: false, confirmed: null, stopped: null }, null]) {
      const out = page([waiting], contact);
      expect(buttons(out)).toEqual([]);
      expect(textOf(out)).not.toContain(STATUS_WORDS.stopHint);
    }
  });

  test("a stopped address reads that the emails are stopped, with the one button that undoes it", () => {
    const out = page([waiting], { given: true, confirmed: false, stopped: true });
    expect(textOf(out)).toContain(STATUS_WORDS.stopped);
    expect(buttons(out)).toEqual([STATUS_WORDS.undo]);
    expect(textOf(out)).not.toContain(STATUS_WORDS.confirm);
    // The undo is the confirm choice, which lifts the stop; the other two send their own.
    const view = read("components", "moderation", "NoticeStatusView.tsx");
    expect(view).toContain('<Button label={STATUS_WORDS.undo} onPress={() => onContact?.("confirm")}');
    expect(view).toContain('<Button label={STATUS_WORDS.confirm} onPress={() => onContact?.("confirm")}');
    expect(view).toContain('<Button label={STATUS_WORDS.stop} onPress={() => onContact?.("stop")}');
  });

  test("a wrong reference or token is one sentence, whatever was wrong", () => {
    expect(textOf(html(<NoticeNotFound />))).toContain("We could not find a report with this link.");
  });

  test("the token is read from the address's fragment and sent in the body of a POST, never in a query", () => {
    const token = "A".repeat(20) + "b_-".repeat(7) + "zz";
    expect(fragmentToken(`#t=${token}`)).toBe(token);
    for (const hash of ["", "#", `#t=${token}x`, `#t=${token.slice(1)}`, `#x=${token}`, `?t=${token}`, `#t=${token}&u=1`]) expect(fragmentToken(hash), hash).toBeNull();
    const screen = read("app", "notice", "[ref].tsx");
    expect(screen).toContain("fragmentToken(location.hash)");
    expect(screen).toContain("moderation.status(ref, token)");
    expect(screen).toContain("moderation.contact(ref, token, choice)");
    expect(screen).not.toMatch(/useLocalSearchParams<[^>]*\btoken\b/);
    const client = read("lib", "moderation.ts");
    expect(client).toContain('status: (ref: string, token: string) => api("/api/notices/status", { json: { ref, token }, schema: NoticeStatus })');
    expect(client).toContain('contact: (ref: string, token: string, choice: "confirm" | "stop") => api("/api/notices/contact", { json: { ref, token, choice } })');
    // Before the fragment is read, and without one, the page says the link is no report's: it asks the API nothing.
    route.params = { ref: "N-ABCDEFGH23" };
    expect(textOf(html(<NoticePage />))).not.toContain("N-ABCDEFGH23");
    // The page is outside the settings, whose layout would send a signed-out reader to sign in.
    expect(readdirSync(path.join(SRC, "app", "notice"))).toEqual(["[ref].tsx"]);
  });
});

describe("Cases, under Settings", () => {
  test("the settings row has Cases, whose screens live in a folder of their own inside the settings layout", () => {
    const out = html(<SettingsNav current="cases" />);
    expect(hrefs(out)).toEqual(["/settings/security", "/settings/privacy", "/settings/profile", "/settings/account", "/settings/cases"]);
    const current = (out.match(/<a\b[^>]*>/g) ?? []).filter((tag) => tag.includes('aria-current="page"'));
    expect(current).toHaveLength(1);
    expect(current[0]).toContain('href="/settings/cases"');
    expect(textOf(out)).toContain("Cases");
    expect(readdirSync(path.join(SRC, "app", "settings", "cases")).sort()).toEqual(["[id].tsx", "index.tsx"]);
    for (const file of ["index.tsx", "[id].tsx"]) expect(read("app", "settings", "cases", file), file).toContain('<SettingsNav current="cases" />');
    // Two tabs, and the list each shows.
    const screen = read("app", "settings", "cases", "index.tsx");
    expect(screen).toContain('accessibilityRole="tablist"');
    expect(screen).toContain("moderation.cases(");
    expect(screen).toContain("moderation.reports(");
    expect(screen).toContain("moderation.resumeReportMail()");
  });

  const row = (extra: Partial<AuthorCaseRow> = {}): AuthorCaseRow => ({
    id: id(3),
    kind: "final",
    outcome: "restricted",
    decidedOn: "2026-10-05",
    post: { id: id(1), createdAt: TIME },
    actions: ["remove"],
    endedInterim: false,
    ruleId: "R3",
    legal: false,
    appealUntil: "2027-04-05T10:00:00.000Z",
    reversedOn: null,
    ...extra,
  });

  test("About you lists each decision with its day, what was done, the post's time, the rule or the law and where its appeal stands, each a link to its screen", () => {
    const rows = [
      row(),
      row({ id: id(4), kind: "interim", actions: ["seal_media", "withhold"], ruleId: null, legal: true, appealUntil: null }),
      row({ id: id(5), post: null, actions: ["reset_bio"], ruleId: "R6", appealUntil: null, reversedOn: "2026-10-06" }),
      row({ id: id(6), outcome: "no_violation", actions: [], endedInterim: true, ruleId: null, appealUntil: null }),
      row({ id: id(7), kind: "correction", outcome: "reversed", actions: ["restore"], ruleId: null, appealUntil: null }),
    ];
    const out = html(<DecisionsList decisions={rows} />);
    const text = textOf(out);
    expect(hrefs(out)).toEqual(rows.map((one) => `/settings/cases/${one.id}`));
    expect(count(text, CASES_WORDS.decidedOn("2026-10-05"))).toBe(5);
    expect(text).toContain(CASES_WORDS.post(utcMinute(TIME)));
    expect(text).toContain(CASES_WORDS.profile);
    // What was done, in the measures' own labels.
    for (const label of ["Remove", "Seal the images this case reaches", "Withhold the post", "Reset bio", "Lift the restriction of the post"]) expect(text, label).toContain(label);
    expect(text).toContain(CASES_WORDS.rule("R3"));
    expect(text).toContain(CASES_WORDS.law);
    expect(text).toContain(CASES_WORDS.whileDeciding);
    expect(text).toContain(CASES_WORDS.ended);
    expect(text).toContain(CASES_WORDS.correction);
    expect(count(text, "You can appeal until")).toBe(1);
    expect(text).toContain(CASES_WORDS.appealOpen(utcMinute("2027-04-05T10:00:00.000Z")));
    expect(text).toContain(CASES_WORDS.reversed("2026-10-06"));
    expect(textOf(html(<DecisionsList decisions={[]} />))).toContain(CASES_WORDS.noDecisions);
  });

  const reports = (extra: Partial<ReportsPage> = {}): ReportsPage => ({
    reports: [
      { ref: "N-ABCDEFGH23", receivedAt: TIME, items: [item({ link: `${APP}/u/old_handle`, scope: "account", outcome: "no_violation", reexamination: { open: true, until: UNTIL } }), { ...waiting, position: 2 }] },
      { ref: "N-BCDEFGH234", receivedAt: TIME, items: [item({ outcome: "not_evident", unseen: true, reexamination: { open: true, until: UNTIL } })] },
    ],
    nextCursor: null,
    reportMailStopped: false,
    ...extra,
  });

  test("Your reports lists each report with its items as the status page words them: the account under the handle the report named, the outcome once released, and whether it can still be examined again", () => {
    const answer = reports();
    const out = html(<ReportsList page={answer} />);
    const text = textOf(out);
    expect(text).toContain("N-ABCDEFGH23");
    expect(text).toContain(`${APP}/u/old_handle`);
    expect(text).toContain(itemOutcomeWords(answer.reports[0]!.items[0]!)!);
    expect(text).toContain(STATUS_WORDS.reexaminationOpen(utcMinute(UNTIL)));
    expect(text).toContain(STATUS_WORDS.waiting);
    expect(text).toContain(UNSEEN_NO_ACTION);
    expect(text).not.toContain(STATUS_WORDS.final);
    // Without a stop there is no notice and no button.
    expect(text).not.toContain(CASES_WORDS.mailStopped);
    expect(buttons(out)).toEqual([]);
    expect(textOf(html(<ReportsList page={reports({ reports: [] })} />))).toContain(CASES_WORDS.noReports);
  });

  test("when the account's address stopped korbat's report mails, the tab says so above the list, with the button that resumes them and what that also allows", () => {
    const out = html(<ReportsList page={reports({ reportMailStopped: true })} />);
    const text = textOf(out);
    expect(text).toContain(CASES_WORDS.mailStopped);
    expect(buttons(out)).toEqual([CASES_WORDS.resume]);
    expect(text).toContain(CASES_WORDS.resumeHint);
    expect(text.indexOf(CASES_WORDS.mailStopped)).toBeLessThan(text.indexOf("N-ABCDEFGH23"));
    expect(read("lib", "moderation.ts")).toContain('resumeReportMail: () => api("/api/moderation/report-mail/resume", { method: "POST" })');
  });
});

describe("a decision's screen", () => {
  const statement = {
    kind: "final" as const,
    outcome: "restricted" as const,
    ground: "incompatible" as const,
    ruleId: "R3" as const,
    rulesVersion: 2,
    redressVersion: 1,
    legalReference: null,
    facts: "The post attacks a group for its religion.",
    reason: "That is an attack on people, not on an idea.",
    source: "report" as const,
    decidedAt: TIME,
    post: { id: id(1), createdAt: "2026-09-01T08:30:00.000Z" },
    measures: [{ kind: "remove" as const, mediaId: null, noEffect: null, sealed: null }],
    reversals: [],
    endedMeasures: [],
    reviewed: null,
  };
  const image = (n: number) => ({ id: id(n), alt: `picture ${n}`, width: 800, height: 600, small: `/api/media/${id(n)}/small.webp`, large: `/api/media/${id(n)}/large.webp` });
  const view = (extra: Partial<DecisionView> = {}): DecisionView => ({
    id: id(3),
    ...statement,
    appealUntil: "2027-04-04T10:00:00.000Z",
    reversedOn: null,
    content: { kind: "post", body: "the words that were judged", deletedByAuthor: false, images: [image(7)], imageCount: 1, imagesHidden: null },
    ...extra,
  });
  const screen = (extra: Partial<DecisionView> = {}) => html(<DecisionDetail view={view(extra)} />);

  test("a final restriction: the statement as the mail rendered it, the post's time, the content it was made on, and Appeal with its deadline", () => {
    const out = screen();
    const text = textOf(out);
    for (const paragraph of statementParagraphs(view())) expect(text).toContain(paragraph);
    expect(text).toContain(`"${getRule("R3", 2)!.title}"`);
    expect(text).toContain(STATEMENT_WORDS.automation);
    expect(text).toContain(DECISION_WORDS.post("2026-09-01 08:30 UTC"));
    expect(text).toContain("the words that were judged");
    // The image comes from the app's own image route, with its description.
    expect(loaded(out)).toEqual([expect.stringContaining(`/api/media/${id(7)}/small.webp`)]);
    expect(out).toContain('alt="picture 7"');
    expect(text).toContain(DECISION_WORDS.appeal);
    expect(text).toContain(DECISION_WORDS.appealUntil("2027-04-04 10:00 UTC"));
    expect(text).not.toContain("Reversed in full");
  });

  test("a decision taken while korbat decides: the interim redress, and no Appeal", () => {
    const interim = { kind: "interim" as const, measures: [{ kind: "withhold" as const, mediaId: null, noEffect: null, sealed: null }], appealUntil: null };
    const text = textOf(screen(interim));
    expect(text).toContain(REDRESS_TEXTS[1].interim);
    expect(text).toContain(STATEMENT_WORDS.scope.interim);
    // Neither the section nor its sentence: the interim redress never says the word.
    expect(text).not.toContain("Appeal");
    expect(text).not.toContain("You can appeal this decision until");
    expect(text).not.toContain("Reversed in full");
  });

  test("a restriction reversed in full says on which day, in place of Appeal", () => {
    const text = textOf(screen({ appealUntil: null, reversedOn: "2026-10-06" }));
    expect(text).toContain(DECISION_WORDS.reversed("2026-10-06"));
    expect(text).not.toContain("You can appeal this decision until");
  });

  test("a post whose images are sealed keeps its text: each sealed image is drawn as its placeholder, and nothing is loaded for it", () => {
    const sealed = {
      kind: "interim" as const,
      ruleId: "R2" as const,
      measures: [{ kind: "seal_media" as const, mediaId: null, noEffect: null, sealed: { posts: 1, images: 2, deletedImages: 0 } }],
      appealUntil: null,
      content: { kind: "post" as const, body: "text beside the images", deletedByAuthor: false, images: [], imageCount: 2, imagesHidden: "sealed" as const },
    };
    const out = screen(sealed);
    const text = textOf(out);
    expect(text).toContain("text beside the images");
    expect(count(text, SEALED_IMAGE)).toBe(2);
    expect(loaded(out)).toEqual([]);
    expect(text).toContain(STATEMENT_WORDS.sealPost("2026-09-01 08:30 UTC", 2));
  });

  test("a post its author deleted: korbat's copy of the text under its own heading, and its images kept and not shown", () => {
    const out = screen({ content: { kind: "post", body: "deleted since", deletedByAuthor: true, images: [], imageCount: 2, imagesHidden: "deleted_by_author" } });
    const text = textOf(out);
    expect(text).toContain(DECISION_WORDS.deleted);
    expect(text.indexOf(DECISION_WORDS.deleted)).toBeLessThan(text.indexOf("deleted since"));
    expect(count(text, DECISION_WORDS.deletedImages)).toBe(1);
    expect(loaded(out)).toEqual([]);
    // A deleted post without images says nothing of images.
    expect(textOf(screen({ content: { kind: "post", body: "deleted since", deletedByAuthor: true, images: [], imageCount: 0, imagesHidden: "deleted_by_author" } }))).not.toContain(DECISION_WORDS.deletedImages);
  });

  test("content korbat no longer holds: erased under the retention rules on its day, with the profile sentence only for a post its author kept; or erased by the R4 decision", () => {
    const kept = textOf(screen({ content: { kind: "erased", contentErasedOn: "2027-04-06", postKept: true } }));
    expect(kept).toContain(`${DECISION_WORDS.erased("2027-04-06")} ${DECISION_WORDS.postKept}`);
    const gone = textOf(screen({ content: { kind: "erased", contentErasedOn: "2027-04-06", postKept: false } }));
    expect(gone).toContain(DECISION_WORDS.erased("2027-04-06"));
    expect(gone).not.toContain(DECISION_WORDS.postKept);
    const redacted = textOf(screen({ ruleId: "R4", content: { kind: "r4_redacted" } }));
    expect(redacted).toContain(DECISION_WORDS.r4Redacted);
    expect(redacted).not.toContain("was erased on");
    // The post's time stays on the screen whatever became of the content.
    for (const text of [kept, gone, redacted]) expect(text).toContain(DECISION_WORDS.post("2026-09-01 08:30 UTC"));
  });

  test("a decision about the account shows the fields as korbat copied them, and links the decision that reset a field while its value is still kept", () => {
    const reset = {
      post: null,
      ruleId: "R6" as const,
      measures: [{ kind: "reset_bio" as const, mediaId: null, noEffect: null, sealed: null }],
      content: { kind: "account" as const, handle: "ada", displayName: "Ada", bio: "what the bio said" },
    };
    const text = textOf(screen(reset));
    expect(text).toContain(`${DECISION_WORDS.bio} what the bio said`);
    expect(text).toContain(`${DECISION_WORDS.displayName} Ada`);
    expect(text).not.toContain("Your post of");
    // A later decision that lifts the reset: its statement says where the old value can be read, and the screen links there.
    const lifted = {
      kind: "correction" as const,
      outcome: "reversed" as const,
      ground: null,
      ruleId: null,
      facts: null,
      post: null,
      measures: [],
      reversals: [{ kind: "restore_bio" as const, mediaId: null, resetDecisionId: id(3), oldValueKept: true, resetRuleId: "R6" as const }],
      reviewed: { kind: "final" as const, ground: "incompatible" as const, ruleId: "R6" as const, rulesVersion: 2, legalReference: null, decidedAt: TIME },
      appealUntil: null,
      content: { kind: "account" as const, handle: "ada", displayName: "Ada", bio: "what the bio said" },
    };
    const out = screen({ id: id(8), ...lifted });
    expect(textOf(out)).toContain(STATEMENT_WORDS.oldValueKept);
    expect(textOf(out)).toContain(DECISION_WORDS.resetDecision);
    expect(hrefs(out)).toContain(`/settings/cases/${id(3)}`);
    // Once the old value is gone, nothing links there.
    const erased = screen({ id: id(8), ...lifted, reversals: [{ ...lifted.reversals[0]!, oldValueKept: false }] });
    expect(hrefs(erased)).not.toContain(`/settings/cases/${id(3)}`);
  });

  test("the screen asks for the decision by the id in its address and says when there is none for this account", () => {
    const source = read("app", "settings", "cases", "[id].tsx");
    expect(source).toContain("moderation.decision(id)");
    expect(source).toContain("DECISION_WORDS.notFound");
    expect(read("lib", "moderation.ts")).toContain("decision: (id: string) => api(`/api/moderation/decisions/${encodeURIComponent(id)}`, { schema: DecisionView })");
  });
});

describe("the chips and the labels", () => {
  const post = (extra: Partial<PostView> = {}): PostView => ({
    id: id(1),
    author: { id: id(900), handle: "ada", displayName: "Ada", verified: false },
    body: "my own post",
    createdAt: TIME,
    state: "removed",
    replyTo: null,
    counts: { likes: 0, reposts: 0, replies: 0, quotes: 0 },
    media: [],
    quoteOf: null,
    ...extra,
  });
  const me = (userId: string) => ({ status: "signed-in", me: { user: { id: userId, onboarded: true }, profile: { handle: "ada" } } });
  const image = (n: number, moderation?: MediaView["moderation"]): MediaView => ({ id: id(n), width: 800, height: 600, blurhash: "LEHV6nWB2yk8", alt: `picture ${n}`, small: `/api/media/${id(n)}/small.webp`, large: `/api/media/${id(n)}/large.webp`, ...(moderation ? { moderation } : {}) });

  test("the chip's four texts: under review or removed, under a rule or as illegal content", () => {
    expect(CHIP_WORDS).toEqual({ underReview: "Under review", removed: "Removed", illegal: "illegal content" });
    const decision = { decisionId: id(3), ruleId: "R4" as const, legal: false, interim: true };
    expect(chipText(decision)).toBe("Under review: R4");
    expect(chipText({ ...decision, ruleId: null, legal: true })).toBe("Under review: illegal content");
    expect(chipText({ ...decision, ruleId: "R3", interim: false })).toBe("Removed: R3");
    expect(chipText({ ...decision, ruleId: null, legal: true, interim: false })).toBe("Removed: illegal content");
  });

  test("the author's own withheld or removed post shows the chip as a link to the decision's statement, amber while korbat decides and red once removed", () => {
    session.state = me(id(900));
    const removed = html(<PostCard post={post({ moderation: { decisionId: id(3), ruleId: "R3", legal: false, interim: false } })} />);
    expect(textOf(removed)).toContain("Removed: R3");
    expect(hrefs(removed)).toContain(`/settings/cases/${id(3)}`);
    const held = html(<PostCard post={post({ state: "withheld", moderation: { decisionId: id(4), ruleId: null, legal: true, interim: true } })} />);
    expect(textOf(held)).toContain("Under review: illegal content");
    expect(hrefs(held)).toContain(`/settings/cases/${id(4)}`);
    // The colours are class names, which a render without the style compiler does not carry: they are read from the source.
    const card = read("components", "social", "PostCard.tsx");
    expect(card).toContain('const amber = decision ? decision.interim : post.state === "withheld";');
    expect(card).toContain('const surface = `self-start rounded-full px-2 py-0.5 ${amber ? "bg-amber-500/15" : "bg-red-500/15"}`;');
    // Without the decision's facts the chip still says the state, and links nowhere.
    const bare = html(<PostCard post={post()} />);
    expect(textOf(bare)).toContain("Removed");
    expect(hrefs(bare).filter((href) => href.startsWith("/settings/cases"))).toEqual([]);
    // A post whose images are sealed keeps its text and its place, without a chip: the post itself is visible.
    const sealedMedia: HiddenMedia[] = [{ id: id(21), hidden: true, sealed: true }, { id: id(22), hidden: true, sealed: true }];
    const sealed = html(<PostCard post={post({ state: "visible", media: sealedMedia })} />);
    expect(textOf(sealed)).toContain("my own post");
    expect(count(textOf(sealed), SEALED_IMAGE)).toBe(2);
    expect(hrefs(sealed).filter((href) => href.startsWith("/settings/cases"))).toEqual([]);
    session.state = { status: "signed-out" };
    // Anyone else reads the placeholder of a hidden image for each of them.
    const others = html(<PostCard post={post({ state: "visible", media: [{ id: id(21), hidden: true }, { id: id(22), hidden: true }] })} />);
    expect(count(textOf(others), HIDDEN_IMAGE)).toBe(2);
    expect(textOf(others)).not.toContain(SEALED_IMAGE);
  });

  test("the author's own withheld image says Under review on itself and a removed one Removed, in the post and in the viewer; anyone else gets one placeholder for both", () => {
    const own = html(<MediaGrid media={[image(1, "withheld"), image(2, "removed"), image(3)]} postId={id(1)} own />);
    const text = textOf(own);
    expect(count(text, "Under review")).toBe(1);
    expect(count(text, "Removed")).toBe(1);
    // The author still sees their own images.
    expect(loaded(own)).toHaveLength(3);
    const noop = () => undefined;
    expect(textOf(html(<MediaViewerContent media={[image(1, "withheld")]} index={0} onIndex={noop} onClose={noop} />))).toContain("Under review");
    expect(textOf(html(<MediaViewerContent media={[image(2, "removed")]} index={0} onIndex={noop} onClose={noop} />))).toContain("Removed");
    expect(textOf(html(<MediaViewerContent media={[image(3)]} index={0} onIndex={noop} onClose={noop} />))).not.toMatch(/Under review|Removed/);
    // For anyone else the API sends the same hidden image for a withheld and a removed one: one placeholder, which does not say which.
    const hidden: HiddenMedia = { id: id(1), hidden: true };
    const others = textOf(html(<MediaGrid media={[hidden, { ...hidden, id: id(2) }]} postId={id(1)} />));
    expect(count(others, HIDDEN_IMAGE)).toBe(2);
    expect(others).not.toMatch(/Under review|Removed/);
  });
});
```

### Create `apps/app/test/report.test.tsx`

```tsx
import { readFileSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { CSAM_KEYWORDS, CSAM_NOTICE_MAX_ACCOUNTS, NOTICE_LIMITS, REPORT_RULE_IDS, TDB_FORM_CATEGORIES, type HiddenMedia, type MediaView, type PostView } from "@korbat/contracts";
import { RULES } from "@korbat/rules";

// The build's contact address, which Expo inlines at export time; set before the app's modules read it.
const CONTACT = vi.hoisted(() => {
  process.env.EXPO_PUBLIC_CONTACT_EMAIL = "contact@korbat.local";
  return "contact@korbat.local";
});

import Report from "../src/app/report";
import Terms from "../src/app/terms";
import { ReportForm, ReportSent } from "../src/components/moderation/ReportForm";
import { MediaGrid } from "../src/components/social/MediaGrid";
import { MediaViewerContent } from "../src/components/social/MediaViewer";
import { PostCard, QuoteEmbed } from "../src/components/social/PostCard";
import { ApiError, messageFor } from "../src/lib/api";
import {
  CONTACT_EMAIL,
  EMPTY_DRAFT,
  OTHER_LINKS_MAX,
  draftTargets,
  givenTarget,
  noticeFrom,
  profileOnly,
  profilesNamed,
  reportFailure,
  reportHref,
  ruleLine,
  statusLink,
  tooManyProfiles,
  waitWords,
  type GivenTarget,
  type ReportDraft,
} from "../src/lib/moderation";
import { CATEGORY_LABELS, CONTACT_WORDS, REPORT_WORDS, numberWord } from "../src/lib/moderation-words";
import { TERMS_SECTIONS } from "../src/lib/terms";

/**
 * The report form and what leads to it in the web app (3c design, section 9): "Report" on posts, images and profiles, the
 * form's three grounds with every word of it, what it sends, its success screen, the three failures it words itself, and
 * the terms page's Contact section. The helpers that decide are called; the form and the screens are server-rendered in
 * each state, as explore.test.tsx renders its screens; what a static render cannot show (a request, a press) is read from
 * the source.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");
const REPO = path.resolve(import.meta.dirname, "..", "..", "..");
const read = (...parts: string[]): string => readFileSync(path.join(SRC, ...parts), "utf8");

/** The route parameters and the session the component under test reads; each test sets what it needs. */
const route = vi.hoisted(() => ({ params: {} as Record<string, string> }));
const session = vi.hoisted(() => ({ state: { status: "signed-out" } as unknown }));

vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  Redirect: () => null,
  router: { push: () => undefined, replace: () => undefined },
  useLocalSearchParams: () => route.params,
  usePathname: () => "/report",
}));
vi.mock("@/lib/session", () => ({ useSession: () => ({ state: session.state, refresh: async () => session.state }) }));
vi.mock("expo-image", async () => {
  const { createElement } = await import("react");
  return { Image: ({ source, accessibilityLabel }: { source: { uri: string }; accessibilityLabel: string }) => createElement("img", { "data-uri": source.uri, alt: accessibilityLabel }) };
});
vi.mock("react-native-reanimated", () => ({ useReducedMotion: () => false }));
// The human check's widget loads a script from Cloudflare; here it is a mark a test can find.
vi.mock("@marsidev/react-turnstile", async () => {
  const { createElement } = await import("react");
  return { Turnstile: () => createElement("div", { "data-turnstile": "widget" }) };
});

const html = (element: ReactElement): string => renderToStaticMarkup(element);
/** The markup's text as a reader sees it: tags dropped, entities read, spaces collapsed. */
const textOf = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
/** The address of every link in the markup, in order. */
const hrefs = (markup: string): string[] => [...markup.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map((match) => match[1]!.replace(/&amp;/g, "&"));
/** The accessible name of every field in the markup. */
const fields = (markup: string): string[] => [...markup.matchAll(/<(?:input|textarea)\b[^>]*\baria-label="([^"]*)"/g)].map((match) => match[1]!.replace(/&#x27;/g, "'"));
/** Every element with this role, as its opening tag. */
const withRole = (markup: string, role: string): string[] => (markup.match(/<[a-z]+\b[^>]*>/g) ?? []).filter((tag) => tag.includes(`role="${role}"`));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POST: GivenTarget = { kind: "post", id: id(1) };
const PROFILE: GivenTarget = { kind: "account", handle: "ada" };
const draft = (extra: Partial<ReportDraft> = {}): ReportDraft => ({ ...EMPTY_DRAFT, ...extra });
const form = (options: { signedIn?: boolean; given?: GivenTarget | null; initial?: Partial<ReportDraft> } = {}) =>
  html(<ReportForm signedIn={options.signedIn ?? true} given={options.given === undefined ? POST : options.given} initial={options.initial} />);

describe("the words", () => {
  test("the form's sentences are the design's, with their numbers printed from the contracts", () => {
    expect(REPORT_WORDS.question).toBe("What is wrong with it?");
    expect(REPORT_WORDS.grounds).toEqual({
      rule: "It breaks a korbat rule",
      illegal: "It is illegal",
      csam: "It is sexual abuse or exploitation of a child, child sexual abuse material, or grooming of a child",
    });
    expect(REPORT_WORDS.r2Instead).toBe("Child sexual abuse material: choose the third answer, which is anonymous.");
    expect(REPORT_WORDS.csamInstead).toBe("For the sexual abuse or exploitation of a child, child sexual abuse material or grooming, choose the third answer, which is anonymous.");
    expect(Object.keys(REPORT_WORDS.keywords)).toEqual(Object.keys(CSAM_KEYWORDS));
    expect(REPORT_WORDS.keywords).toEqual({
      csam: "Sexual images or videos of a child",
      deepfake: "Such images made or altered by software",
      grooming: "An adult seeking sexual contact with a child",
      abuse: "Other sexual abuse or exploitation of a child, such as offering a child for sex",
    });
    expect(REPORT_WORDS.anonymous).toBe("This report is anonymous: korbat does not record who sent it, not even your account. Keep the link we show you to follow it.");
    expect(REPORT_WORDS.profileOnly).toBe(
      "If you can, report the post or the image itself: open it and choose Report. From a profile alone korbat cannot tell which image you mean, and its answer covers the images on all the profile's posts.",
    );
    expect(CSAM_NOTICE_MAX_ACCOUNTS).toBe(1);
    expect(REPORT_WORDS.oneProfile).toBe("On this path a report can name one profile. Send another report for the next one.");
    expect(REPORT_WORDS.bonaFide).toBe("I believe in good faith that the information in this report is accurate and complete.");
    expect(REPORT_WORDS.contactHint).toBe("Without an email we cannot send you a receipt or our decision. korbat never shows your name or email to the person you report.");
    expect(`${REPORT_WORDS.privacy.use} ${REPORT_WORDS.privacy.sender} ${REPORT_WORDS.privacy.access}`).toBe(
      "korbat uses what you send only to handle this report; how long it keeps it is in the terms. Moderators see who sent a report only when a case needs it, for example when you report an account impersonating you; each time is recorded and shown to every staff member. If the person you report asks korbat for their data, the law may require korbat to give them what you wrote, never your name, email or account.",
    );
    expect(REPORT_WORDS.turnstile).toBe("Cloudflare Turnstile checks that you are not a bot; it sees your IP address and browser details for that check.");
    expect(REPORT_WORDS.keepLink).toBe("Keep this link to follow your report or ask for a decision to be re-examined. It is shown only now.");
    expect(REPORT_WORDS.followInSettings).toBe("You can follow it under Settings, Cases, Your reports.");
    expect([REPORT_WORDS.control, REPORT_WORDS.imageControl, REPORT_WORDS.link, REPORT_WORDS.otherItems, REPORT_WORDS.explanation, REPORT_WORDS.citedLaw, REPORT_WORDS.whyIllegal, REPORT_WORDS.name, REPORT_WORDS.email]).toEqual([
      "Report",
      "Report this image",
      "Link to the post or profile on korbat",
      "Other items",
      "Anything the moderator should know",
      "Which law or country (optional)",
      "Why is it illegal?",
      "Your name (optional)",
      "Your email (optional)",
    ]);
    expect(numberWord(9)).toBe("nine");
    expect(REPORT_WORDS.otherItemsHint).toBe("You can add up to nine more korbat links.");
    expect(OTHER_LINKS_MAX).toBe(NOTICE_LIMITS.maxTargets - 1);
  });

  test("the three failures the form words itself name the contact address, the limits and the wait", () => {
    const mail = "email your report to contact@korbat.local with the korbat links of what you report and why. Do not attach images or files: korbat does not open them.";
    expect(REPORT_WORDS.humanCheckFailed(CONTACT)).toBe(`The check that you are not a bot failed. Try again, or ${mail}`);
    expect(REPORT_WORDS.rateLimited("20 minutes", CONTACT)).toBe(
      `korbat cannot take another report from this network or account right now: it takes at most 5 reports an hour and 20 a day without an account, and 10 an hour and 50 a day with one. Try again in about 20 minutes, or ${mail}`,
    );
    expect([NOTICE_LIMITS.signedOut, NOTICE_LIMITS.signedIn]).toEqual([{ perHour: 5, perDay: 20 }, { perHour: 10, perDay: 50 }]);
    expect(REPORT_WORDS.unavailable(CONTACT)).toBe(`korbat cannot take reports right now. Try again in a few minutes, or ${mail}`);
    expect(REPORT_WORDS.mailShowsAddress).toBe("An email shows korbat your address. korbat deletes your email, and its reply to you, once your report is entered.");
  });

  test("every category the illegal ground offers has a name, and the app's table words the codes the form can meet", () => {
    expect(Object.keys(CATEGORY_LABELS).sort()).toEqual([...TDB_FORM_CATEGORIES].sort());
    expect(new Set(Object.values(CATEGORY_LABELS)).size).toBe(TDB_FORM_CATEGORIES.length);
    expect(messageFor("notice_link_invalid")).toBe("That link does not name a post or a profile on korbat.");
    expect(messageFor("notice_link_offsite")).toBe("Only links to this korbat can be reported.");
    expect(messageFor("already_reported")).toBe("You already reported this; it is being looked at.");
    expect(messageFor("staff_cannot_report")).toBe("A staff account does not send reports. Open a finding in the staff console instead.");
    expect(messageFor("notice_not_found")).toBe("We could not find a report with this link.");
    expect(messageFor("human_check_failed")).toBe("We could not verify that you are human. Try again.");
  });
});

describe("what leads to the form", () => {
  test("the form's address names the post, the image of a post, or the profile it is opened on, and reads it back", () => {
    expect(reportHref()).toBe("/report");
    expect(reportHref({ post: id(1) })).toBe(`/report?post=${id(1)}`);
    expect(reportHref({ post: id(1), media: id(2) })).toBe(`/report?post=${id(1)}&media=${id(2)}`);
    expect(reportHref({ account: "ada" })).toBe("/report?account=ada");
    expect(givenTarget({ post: id(1) })).toEqual({ kind: "post", id: id(1) });
    expect(givenTarget({ post: id(1), media: id(2) })).toEqual({ kind: "post", id: id(1), mediaId: id(2) });
    expect(givenTarget({ account: "@Ada" })).toEqual({ kind: "account", handle: "ada" });
    // Anything the API would refuse names nothing: the form then asks for a link.
    for (const params of [{}, { post: "nope" }, { account: "a b" }, { media: id(2) }, { post: ["x"] }]) expect(givenTarget(params), JSON.stringify(params)).toBeNull();
  });

  const image = (n: number): MediaView => ({ id: id(n), width: 800, height: 600, blurhash: "LEHV6nWB2yk8", alt: `picture ${n}`, small: `/api/media/${id(n)}/small.webp`, large: `/api/media/${id(n)}/large.webp` });
  const hidden = (n: number): HiddenMedia => ({ id: id(n), hidden: true });
  const post = (n: number, extra: Partial<PostView> = {}): PostView => ({
    id: id(n),
    author: { id: id(900), handle: "ada", displayName: "Ada", verified: false },
    body: `post number ${n}`,
    createdAt: "2026-10-04T10:00:00.000Z",
    state: "visible",
    replyTo: null,
    counts: { likes: 0, reposts: 0, replies: 0, quotes: 0 },
    media: [],
    quoteOf: null,
    ...extra,
  });
  const me = (userId: string) => ({ status: "signed-in", me: { user: { id: userId, onboarded: true }, profile: { handle: "me" } } });

  test("a post that is not the reader's own has Report in its action row, signed in or out; the reader's own has none", () => {
    for (const state of [{ status: "signed-out" }, me(id(901))]) {
      session.state = state;
      const out = html(<PostCard post={post(1)} />);
      expect(hrefs(out)).toContain(`/report?post=${id(1)}`);
      expect(textOf(out)).toContain("Report");
    }
    session.state = me(id(900));
    const own = html(<PostCard post={post(1)} />);
    expect(hrefs(own).filter((href) => href.startsWith("/report"))).toEqual([]);
    session.state = { status: "signed-out" };
  });

  test("the viewer reports an image on the post that holds it: opened from a post it names that post, and nothing for a hidden image or the reader's own post", () => {
    const noop = () => undefined;
    const media = [image(11), hidden(12)];
    const shown = html(<MediaViewerContent media={media} index={0} onIndex={noop} onClose={noop} postId={id(2)} />);
    expect(hrefs(shown)).toEqual([`/report?post=${id(2)}&media=${id(11)}`]);
    expect(textOf(shown)).toContain("Report this image");
    // A hidden image has nothing to report by; the post's own Report still names the post.
    expect(hrefs(html(<MediaViewerContent media={media} index={1} onIndex={noop} onClose={noop} postId={id(2)} />))).toEqual([]);
    // Without a post to report on (the reader's own post), the viewer offers nothing.
    expect(hrefs(html(<MediaViewerContent media={media} index={0} onIndex={noop} onClose={noop} />))).toEqual([]);
  });

  test("the grid hands the viewer its post, and a quoted post's images belong to the quoted post", () => {
    const grid = read("components", "social", "MediaGrid.tsx");
    expect(grid).toContain("<MediaViewer media={media} index={open} onIndex={setOpen} onClose={() => setOpen(null)} postId={own ? undefined : postId} />");
    const card = read("components", "social", "PostCard.tsx");
    expect(card).toContain("<MediaGrid media={post.media} postId={post.id} own={post.author.id === me} />");
    expect(card).toContain("<MediaGrid media={quote.media} compact postId={quote.id} />");
    // The quote is one link to the quoted post, where the grid and the viewer are: its squares open nothing themselves.
    const quoted = { ...post(2, { media: [image(21)] }), quoteOf: null };
    const out = html(<QuoteEmbed quote={quoted} />);
    expect(hrefs(out)).toEqual([`/post/${id(2)}`, "/u/ada"]);
    expect(html(<MediaGrid media={[image(1)]} postId={id(5)} />)).not.toContain("/report");
  });

  test("a profile has Report beside Mute and Block, and signed out too", () => {
    const profile = read("app", "u", "[handle]", "index.tsx");
    // Anyone but the profile's owner is offered it.
    expect(profile).toContain("const report = own ? null : (");
    expect(profile).toContain("<Link href={reportHref({ account: profile.handle })} asChild>");
    // In the row of the signed-in controls, after Block; and alone in their place when they are not shown.
    const row = profile.slice(profile.indexOf("{me && !own && viewer ? ("), profile.indexOf("{!own && !(me && viewer) ?"));
    expect(row.indexOf("Block</Text>")).toBeGreaterThan(row.indexOf("Mute"));
    expect(row.indexOf("{report}")).toBeGreaterThan(row.indexOf("Block</Text>"));
    expect(profile).toContain('{!own && !(me && viewer) ? <View className="mt-3 flex-row">{report}</View> : null}');
  });

  test("the terms page ends with a Contact section built from the build's address, and a link to the form, which needs no account", () => {
    expect(CONTACT_EMAIL).toBe(CONTACT);
    const out = html(<Terms />);
    const text = textOf(out);
    expect(CONTACT_WORDS.body(CONTACT)).toBe(
      "Write to korbat at contact@korbat.local when the report form does not work for you, to ask for your data, or about a decision. A person reads every email. Do not attach images or files: korbat does not open them.",
    );
    expect(text).toContain(`Contact ${CONTACT_WORDS.body(CONTACT)}`);
    expect(text).toContain("Report something on korbat");
    expect(hrefs(out)).toContain("/report");
    // After the terms' own sections, of which it is no part, and before the link to the form.
    expect(TERMS_SECTIONS.map((section) => section.title)).not.toContain("Contact");
    const last = TERMS_SECTIONS.at(-1)!.title;
    expect(text.indexOf(last)).toBeLessThan(text.indexOf("Contact Write to korbat"));
    expect(text.indexOf("Contact Write to korbat")).toBeLessThan(text.indexOf("Report something on korbat"));
    // The form is no settings screen: the settings layout would send a signed-out reader to sign in.
    expect(read("app", "report.tsx")).not.toContain("SettingsNav");
  });
});

describe("the form", () => {
  test("asks what is wrong with three choices of equal weight, each a radio of one group, none chosen at first", () => {
    const out = form();
    const text = textOf(out);
    expect(text).toContain("What is wrong with it?");
    const at = Object.values(REPORT_WORDS.grounds).map((label) => text.indexOf(label));
    expect(at.every((index) => index > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(withRole(out, "radiogroup")).toHaveLength(1);
    const radios = withRole(out, "radio");
    expect(radios).toHaveLength(3);
    for (const radio of radios) expect(radio).toContain('aria-checked="false"');
    // Nothing of a ground shows before one is chosen, and nothing can be sent.
    for (const words of [REPORT_WORDS.whichRule, REPORT_WORDS.whyIllegal, REPORT_WORDS.which, REPORT_WORDS.anonymous]) expect(text).not.toContain(words);
    expect(text).toContain(REPORT_WORDS.missing.ground);
  });

  test("the rule ground lists the rules that can be reported, each with its title and one line, R2 replaced by the pointer to the third answer, and an optional note", () => {
    const out = form({ initial: { ground: "rule" } });
    const text = textOf(out);
    for (const ruleId of REPORT_RULE_IDS) {
      const rule = RULES.find((entry) => entry.id === ruleId)!;
      expect(text, ruleId).toContain(`${rule.id}: ${rule.title}`);
      expect(text, ruleId).toContain(ruleLine(rule));
    }
    const r2 = RULES.find((entry) => entry.id === "R2")!;
    expect(text).not.toContain(r2.title);
    expect(text).toContain(REPORT_WORDS.r2Instead);
    // In R2's place: after R1 and before R3.
    expect(text.indexOf(REPORT_WORDS.r2Instead)).toBeGreaterThan(text.indexOf("R1: "));
    expect(text.indexOf(REPORT_WORDS.r2Instead)).toBeLessThan(text.indexOf("R3: "));
    expect(fields(out)).toEqual([REPORT_WORDS.explanation]);
    expect(out.toLowerCase()).toContain(`maxlength="${NOTICE_LIMITS.explanationMax}"`);
    expect(ruleLine({ text: "One sentence. And another." })).toBe("One sentence.");
    expect(ruleLine({ text: "Only one" })).toBe("Only one");
  });

  test("the illegal ground asks for the category, not sure by default, points to the third answer directly below it, and asks why, the law, a rule and good faith", () => {
    const out = form({ initial: { ground: "illegal" } });
    const text = textOf(out);
    const categories = [REPORT_WORDS.categoryNotSure, ...TDB_FORM_CATEGORIES.map((category) => CATEGORY_LABELS[category])];
    for (const label of categories) expect(text, label).toContain(label);
    const checked = withRole(out, "radio").filter((tag) => tag.includes('aria-checked="true"'));
    // The ground itself, "I am not sure", and no rule beside the law.
    expect(checked).toHaveLength(3);
    // The pointer stands directly below the categories: after the last of them and before the next field.
    const pointer = text.indexOf(REPORT_WORDS.csamInstead);
    expect(pointer).toBeGreaterThan(Math.max(...categories.map((label) => text.indexOf(label))));
    expect(pointer).toBeLessThan(text.indexOf(REPORT_WORDS.citedLaw));
    expect(fields(out)).toEqual([REPORT_WORDS.citedLaw, REPORT_WORDS.whyIllegal]);
    // A rule it also breaks: every rule but R2, and none.
    expect(text).toContain(REPORT_WORDS.alsoRule);
    for (const ruleId of REPORT_RULE_IDS) expect(text).toContain(`${ruleId}: `);
    expect(text).not.toContain("R2: ");
    const box = withRole(out, "checkbox");
    expect(box).toHaveLength(1);
    expect(box[0]).toContain('aria-checked="false"');
    expect(text).toContain(REPORT_WORDS.bonaFide);
  });

  test("the anonymous path asks which it is, says that nobody is recorded, and asks for neither a name nor an email, signed in or out", () => {
    for (const signedIn of [true, false]) {
      const out = form({ signedIn, initial: { ground: "csam" } });
      const text = textOf(out);
      for (const label of Object.values(REPORT_WORDS.keywords)) expect(text).toContain(label);
      expect(text).toContain(REPORT_WORDS.anonymous);
      expect(fields(out)).toEqual([REPORT_WORDS.csamExplanation]);
      expect(text).not.toContain(REPORT_WORDS.contactHint);
      // Good faith may be stated, and is not asked for.
      expect(withRole(out, "checkbox")).toHaveLength(1);
      // The privacy line leaves out who sees the sender: this path records none.
      expect(text).toContain(REPORT_WORDS.privacy.use);
      expect(text).toContain(REPORT_WORDS.privacy.access);
      expect(text).not.toContain(REPORT_WORDS.privacy.sender);
    }
    // On the other grounds the line is whole.
    expect(textOf(form({ initial: { ground: "rule" } }))).toContain(`${REPORT_WORDS.privacy.use} ${REPORT_WORDS.privacy.sender} ${REPORT_WORDS.privacy.access}`);
  });

  test("on the anonymous path, for images, a report that names only a profile is asked for the post or the image, and never refused", () => {
    const images = (keyword: ReportDraft["keyword"], extra: Partial<ReportDraft> = {}) => draft({ ground: "csam", keyword, ...extra });
    expect(profileOnly(images("csam"), PROFILE)).toBe(true);
    expect(profileOnly(images("deepfake"), PROFILE)).toBe(true);
    // Not for grooming or other abuse, which are not about an image; not on another ground; not with a post beside it.
    expect(profileOnly(images("grooming"), PROFILE)).toBe(false);
    expect(profileOnly(images("abuse"), PROFILE)).toBe(false);
    expect(profileOnly(draft({ ground: "illegal", keyword: "csam" }), PROFILE)).toBe(false);
    expect(profileOnly(images("csam"), POST)).toBe(false);
    expect(profileOnly(images("csam", { others: ["http://localhost:8081/post/" + id(2)] }), PROFILE)).toBe(false);
    // A typed link to a profile is a profile too.
    expect(profileOnly(images("csam", { link: "http://localhost:8081/u/ada" }), null)).toBe(true);
    expect(profileOnly(images("csam", { link: "http://localhost:8081/post/" + id(2) }), null)).toBe(false);

    const out = form({ given: PROFILE, initial: { ground: "csam", keyword: "csam" } });
    expect(textOf(out)).toContain(REPORT_WORDS.profileOnly);
    // It can still be sent: the sentence asks, it does not refuse.
    const sent = noticeFrom(draft({ ground: "csam", keyword: "csam" }), PROFILE, { signedIn: true, turnstileToken: null });
    expect(sent).toEqual({ request: { ground: "csam", targets: [PROFILE], keyword: "csam" } });
    expect(textOf(form({ given: PROFILE, initial: { ground: "csam", keyword: "grooming" } }))).not.toContain(REPORT_WORDS.profileOnly);
    expect(textOf(form({ given: PROFILE, initial: { ground: "rule" } }))).not.toContain(REPORT_WORDS.profileOnly);
  });

  test("on the anonymous path a report names one profile at most: with a second the form says so before anything is sent", () => {
    const second = draft({ ground: "csam", keyword: "grooming", others: ["http://localhost:8081/u/bob"] });
    expect(profilesNamed(draftTargets(second, PROFILE))).toBe(2);
    expect(tooManyProfiles(second, PROFILE)).toBe(true);
    expect(noticeFrom(second, PROFILE, { signedIn: true, turnstileToken: null })).toEqual({ problem: REPORT_WORDS.oneProfile });
    expect(textOf(form({ given: PROFILE, initial: second }))).toContain(REPORT_WORDS.oneProfile);
    // The same profile named twice is one profile, a post beside it is no profile, and other grounds have no such limit.
    expect(tooManyProfiles(draft({ ground: "csam", keyword: "csam", others: ["http://localhost:8081/u/ADA", "http://localhost:8081/post/" + id(2)] }), PROFILE)).toBe(false);
    expect(tooManyProfiles({ ...second, ground: "rule" }, PROFILE)).toBe(false);
    expect(textOf(form({ given: PROFILE, initial: { ...second, ground: "rule", ruleId: "R6" } }))).not.toContain(REPORT_WORDS.oneProfile);
  });

  test("signed out, the illegal ground asks for an optional name and email, and every ground shows the human check with its sentence; signed in, none of it", () => {
    for (const ground of ["rule", "illegal", "csam"] as const) {
      const out = form({ signedIn: false, initial: { ground } });
      expect(out, ground).toContain('data-turnstile="widget"');
      expect(textOf(out), ground).toContain(REPORT_WORDS.turnstile);
      const signedIn = form({ signedIn: true, initial: { ground } });
      expect(signedIn, ground).not.toContain("data-turnstile");
      expect(textOf(signedIn), ground).not.toContain(REPORT_WORDS.turnstile);
      expect(fields(signedIn), ground).not.toContain(REPORT_WORDS.email);
    }
    const illegal = form({ signedIn: false, initial: { ground: "illegal" } });
    expect(fields(illegal)).toEqual([REPORT_WORDS.citedLaw, REPORT_WORDS.whyIllegal, REPORT_WORDS.name, REPORT_WORDS.email]);
    expect(textOf(illegal)).toContain(REPORT_WORDS.contactHint);
    expect(fields(form({ signedIn: false, initial: { ground: "rule" } }))).toEqual([REPORT_WORDS.explanation]);
    // Before a ground is chosen the check is there already: it takes a moment to pass.
    expect(form({ signedIn: false })).toContain('data-turnstile="widget"');
  });

  test("opened without an item, the form starts with one required field for the link; opened on one, it shows what is reported; other items take up to nine more links", () => {
    const bare = form({ given: null });
    expect(fields(bare)[0]).toBe(REPORT_WORDS.link);
    expect(textOf(bare)).toContain(REPORT_WORDS.otherItems);
    expect(textOf(bare)).toContain(REPORT_WORDS.otherItemsHint);
    const onPost = form({ given: { kind: "post", id: id(1), mediaId: id(2) } });
    expect(fields(onPost)).not.toContain(REPORT_WORDS.link);
    expect(hrefs(onPost)).toContain(`/post/${id(1)}`);
    expect(hrefs(form({ given: PROFILE }))).toContain("/u/ada");
    // Each added link is a field of its own; at nine there is no way to add a tenth.
    const nine = form({ initial: { others: Array.from({ length: OTHER_LINKS_MAX }, () => "") } });
    expect(fields(nine).filter((label) => label.startsWith("Link "))).toHaveLength(9);
    expect(textOf(nine)).not.toContain(REPORT_WORDS.addLink);
    expect(textOf(form({ initial: { others: [""] } }))).toContain(REPORT_WORDS.addLink);
  });

  test("the screen opens the form on what its address names, signed in or out, and without an item when it names none", () => {
    session.state = { status: "signed-out" };
    route.params = { post: id(1), media: id(2) };
    const onImage = html(<Report />);
    expect(hrefs(onImage)).toContain(`/post/${id(1)}`);
    expect(onImage).toContain('data-turnstile="widget"');
    route.params = { account: "ada" };
    expect(hrefs(html(<Report />))).toContain("/u/ada");
    route.params = {};
    expect(fields(html(<Report />))[0]).toBe(REPORT_WORDS.link);
    session.state = { status: "signed-in", me: { user: { id: id(901), onboarded: true }, profile: { handle: "me" } } };
    expect(html(<Report />)).not.toContain("data-turnstile");
    session.state = { status: "signed-out" };
  });
});

describe("what the form sends", () => {
  const signedIn = { signedIn: true, turnstileToken: null };
  const signedOut = { signedIn: false, turnstileToken: "token" };

  test("says what is missing, one thing at a time, and sends nothing until it is all there", () => {
    const missing = REPORT_WORDS.missing;
    expect(noticeFrom(draft(), POST, signedIn)).toEqual({ problem: missing.ground });
    expect(noticeFrom(draft({ ground: "rule" }), null, signedIn)).toEqual({ problem: missing.link });
    expect(noticeFrom(draft({ ground: "rule", link: "korbat.example/post/1" }), null, signedIn)).toEqual({ problem: missing.linkInvalid });
    expect(noticeFrom(draft({ ground: "rule" }), POST, signedIn)).toEqual({ problem: missing.rule });
    expect(noticeFrom(draft({ ground: "illegal" }), POST, signedIn)).toEqual({ problem: missing.whyIllegal });
    expect(noticeFrom(draft({ ground: "illegal", explanation: "It is a threat." }), POST, signedIn)).toEqual({ problem: missing.bonaFide });
    expect(noticeFrom(draft({ ground: "csam" }), POST, signedIn)).toEqual({ problem: missing.keyword });
    expect(noticeFrom(draft({ ground: "rule", ruleId: "R3" }), POST, { signedIn: false, turnstileToken: null })).toEqual({ problem: missing.human });
    expect(noticeFrom(draft({ ground: "illegal", explanation: "x", bonaFide: true, email: "not an address" }), POST, signedOut)).toEqual({ problem: missing.details });
  });

  test("a rule report, a notice of illegality and an anonymous report, each in the contracts' shape for its sender", () => {
    expect(noticeFrom(draft({ ground: "rule", ruleId: "R3", explanation: "  look at the second line  " }), POST, signedIn)).toEqual({
      request: { ground: "rule", ruleId: "R3", targets: [POST], explanation: "look at the second line" },
    });
    expect(noticeFrom(draft({ ground: "rule", ruleId: "R1", link: " http://localhost:8081/post/x ", others: ["", "http://localhost:8081/u/bob"] }), null, signedOut)).toEqual({
      request: { ground: "rule", ruleId: "R1", targets: [{ kind: "link", url: "http://localhost:8081/post/x" }, { kind: "link", url: "http://localhost:8081/u/bob" }], turnstileToken: "token" },
    });
    const illegal = draft({ ground: "illegal", explanation: "It is a threat.", bonaFide: true, citedLaw: "Section 241", ruleId: "R5", name: "Ada", email: "ada@korbat.local", category: "STATEMENT_CATEGORY_VIOLENCE" });
    expect(noticeFrom(illegal, PROFILE, signedOut)).toEqual({
      request: { ground: "illegal", targets: [PROFILE], category: "STATEMENT_CATEGORY_VIOLENCE", citedLaw: "Section 241", explanation: "It is a threat.", bonaFide: true, ruleId: "R5", name: "Ada", email: "ada@korbat.local", turnstileToken: "token" },
    });
    // Signed in, the contact is the account: a name or an address typed earlier is never sent.
    expect(noticeFrom(illegal, PROFILE, signedIn)).toEqual({
      request: { ground: "illegal", targets: [PROFILE], category: "STATEMENT_CATEGORY_VIOLENCE", citedLaw: "Section 241", explanation: "It is a threat.", bonaFide: true, ruleId: "R5" },
    });
    // The anonymous path sends neither, whatever the draft holds, and good faith only when it was stated.
    expect(noticeFrom(draft({ ground: "csam", keyword: "deepfake", name: "Ada", email: "ada@korbat.local", ruleId: "R1" }), POST, signedOut)).toEqual({
      request: { ground: "csam", targets: [POST], keyword: "deepfake", turnstileToken: "token" },
    });
    expect(noticeFrom(draft({ ground: "csam", keyword: "abuse", bonaFide: true, explanation: "seen today" }), POST, signedIn)).toEqual({
      request: { ground: "csam", targets: [POST], keyword: "abuse", explanation: "seen today", bonaFide: true },
    });
  });

  test("the form posts the request once, resets the human check after a failure, and shows the answer's screen", () => {
    const source = read("components", "moderation", "ReportForm.tsx");
    expect(source).toContain("const answer = await moderation.send(built.request);");
    expect(source).toContain("turnstile.current?.reset();");
    expect(source).toContain('setError(reportFailure(err, draft.ground === "csam"));');
    expect(read("lib", "moderation.ts")).toContain('send: (request: NoticeRequest) => api("/api/notices", { json: request, schema: NoticeResponse })');
  });
});

describe("after sending", () => {
  const TOKEN = "t".repeat(43);

  test("signed out, the screen shows the reference and the link to keep, its token in the fragment, with a Copy button", () => {
    const out = html(<ReportSent answer={{ ref: "N-ABCDEFGH23", token: TOKEN }} signedIn={false} origin="http://localhost:8081" />);
    const text = textOf(out);
    expect(text).toContain("N-ABCDEFGH23");
    expect(text).toContain(REPORT_WORDS.keepLink);
    expect(statusLink("http://localhost:8081", "N-ABCDEFGH23", TOKEN)).toBe(`http://localhost:8081/notice/N-ABCDEFGH23#t=${TOKEN}`);
    expect(text).toContain(`http://localhost:8081/notice/N-ABCDEFGH23#t=${TOKEN}`);
    // The token is never part of a query, which a server would be sent and would log.
    expect(out).not.toContain(`?t=${TOKEN}`);
    expect(withRole(out, "button").some((tag) => tag.includes(REPORT_WORDS.copy)) || text.includes(REPORT_WORDS.copy)).toBe(true);
    expect(text).not.toContain(REPORT_WORDS.followInSettings);
  });

  test("signed in, a report on a rule or on the law is followed under Settings, Cases, Your reports, and no link is shown", () => {
    const out = html(<ReportSent answer={{ ref: "N-ABCDEFGH23" }} signedIn origin="http://localhost:8081" />);
    const text = textOf(out);
    expect(text).toContain(REPORT_WORDS.followInSettings);
    expect(hrefs(out)).toContain("/settings/cases?tab=reports");
    expect(text).not.toContain(REPORT_WORDS.keepLink);
    expect(text).not.toContain("/notice/");
  });

  test("signed in, an anonymous report shows the link and not the Settings sentence: korbat recorded no account for it", () => {
    const out = html(<ReportSent answer={{ ref: "N-ABCDEFGH23", token: TOKEN }} signedIn origin="http://localhost:8081" />);
    const text = textOf(out);
    expect(text).toContain(REPORT_WORDS.keepLink);
    expect(text).toContain(`/notice/N-ABCDEFGH23#t=${TOKEN}`);
    expect(text).not.toContain(REPORT_WORDS.followInSettings);
    expect(hrefs(out).filter((href) => href.startsWith("/settings"))).toEqual([]);
  });
});

describe("a send that fails", () => {
  const failed = (code: string, retryAfter?: number) => new ApiError(code === "rate_limited" ? 429 : 403, code, "the server's own words", retryAfter);

  test("the human check, the limits and an API that cannot take reports each get the form's own sentence, naming the build's contact address", () => {
    expect(reportFailure(failed("human_check_failed"), false)).toBe(REPORT_WORDS.humanCheckFailed(CONTACT));
    expect(reportFailure(failed("rate_limited", 1200), false)).toBe(REPORT_WORDS.rateLimited("20 minutes", CONTACT));
    expect(reportFailure(failed("service_unavailable"), false)).toBe(REPORT_WORDS.unavailable(CONTACT));
    for (const code of ["human_check_failed", "rate_limited", "service_unavailable"]) expect(reportFailure(failed(code, 60), false), code).toContain("contact@korbat.local");
  });

  test("the wait is worded in minutes under an hour and in hours otherwise", () => {
    expect([waitWords(1), waitWords(60), waitWords(61), waitWords(3599), waitWords(3600), waitWords(3601), waitWords(20 * 3600), waitWords(undefined)]).toEqual([
      "1 minute",
      "1 minute",
      "2 minutes",
      "60 minutes",
      "1 hour",
      "2 hours",
      "20 hours",
      "1 hour",
    ]);
  });

  test("on the anonymous path each is followed by what an email gives away", () => {
    for (const code of ["human_check_failed", "rate_limited", "service_unavailable"]) {
      const words = reportFailure(failed(code, 60), true);
      expect(words.endsWith(` ${REPORT_WORDS.mailShowsAddress}`), code).toBe(true);
      expect(reportFailure(failed(code, 60), false), code).not.toContain(REPORT_WORDS.mailShowsAddress);
    }
  });

  test("any other failure shows the server's message, as everywhere in the app", () => {
    expect(reportFailure(failed("already_reported"), false)).toBe("the server's own words");
    expect(reportFailure(failed("already_reported"), true)).toBe("the server's own words");
    expect(reportFailure(new Error("boom"), false)).toBe("Something went wrong. Try again.");
  });
});

describe("the build's contact address", () => {
  const repo = (...parts: string[]) => readFileSync(path.join(REPO, ...parts), "utf8");

  test("the app reads it from the build, and both example files carry the development value", () => {
    expect(read("lib", "moderation.ts")).toContain('export const CONTACT_EMAIL = process.env.EXPO_PUBLIC_CONTACT_EMAIL ?? "";');
    expect(repo("infra", ".env.example")).toMatch(/^WEB_CONTACT_EMAIL=contact@korbat\.local$/m);
    expect(repo("apps", "app", ".env.example")).toMatch(/^EXPO_PUBLIC_CONTACT_EMAIL=contact@korbat\.local$/m);
  });

  test("the compose service requires it, and the web image takes it as a build argument, refuses what is no address, refuses a placeholder domain in production, and passes it to the export", () => {
    expect(repo("infra", "compose.yml")).toContain("EXPO_PUBLIC_CONTACT_EMAIL: ${WEB_CONTACT_EMAIL:?set WEB_CONTACT_EMAIL in infra/.env}");
    const dockerfile = repo("infra", "caddy", "Dockerfile");
    expect(dockerfile).toContain("ARG EXPO_PUBLIC_CONTACT_EMAIL");
    expect(dockerfile).toContain('RUN case "$EXPO_PUBLIC_CONTACT_EMAIL" in *?@?*.?*) ;; *) echo "the EXPO_PUBLIC_CONTACT_EMAIL build argument must be an email address" >&2; exit 1;; esac');
    expect(dockerfile).toContain(
      'RUN if [ "$KORBAT_ENV" = "production" ]; then case "$(printf %s "${EXPO_PUBLIC_CONTACT_EMAIL##*@}" | tr A-Z a-z)" in *.local|*.localhost|*.test|*.invalid|*.example|example.com|example.org|example.net) echo "EXPO_PUBLIC_CONTACT_EMAIL is a placeholder address; a production build needs the address people can write to" >&2; exit 1;; esac; fi',
    );
    expect(dockerfile).toContain(
      'RUN cd apps/app && EXPO_PUBLIC_TURNSTILE_SITE_KEY="$EXPO_PUBLIC_TURNSTILE_SITE_KEY" EXPO_PUBLIC_BADGE="$EXPO_PUBLIC_BADGE" EXPO_PUBLIC_CONTACT_EMAIL="$EXPO_PUBLIC_CONTACT_EMAIL" npx expo export --platform web',
    );
    // The refusals come before the export, and the production one after KORBAT_ENV is declared.
    expect(dockerfile.indexOf("ARG KORBAT_ENV")).toBeLessThan(dockerfile.indexOf("is a placeholder address"));
    expect(dockerfile.indexOf("is a placeholder address")).toBeLessThan(dockerfile.indexOf("npx expo export"));
  });
});
```

### Create `packages/contracts/test/author.test.ts`

```ts
import { describe, expect, test } from "vitest";
import {
  ACCOUNT_ITEM_SCOPE,
  ALREADY_NOT_SHOWN,
  AuthorCasesPage,
  AuthorCasesQuery,
  DecisionView,
  NoticeItemStatus,
  OUTCOME_PHRASES,
  PostView,
  QuotedPost,
  REPORTS_PAGE_SIZE,
  ReportsPage,
  ReportsQuery,
  SUSPECT_OUTCOME_PHRASES,
  UNSEEN_NO_ACTION,
  itemOutcomeWords,
  outcomeWords,
} from "../src/index";

/**
 * What the app reads of moderation (3c design, sections 7.6 and 10): the chip's facts on the author's own post, the
 * author's list of decisions and one decision's view, and the reporter's list. Each shape is what its route answers and
 * what the app parses, so this file pins what each may carry.
 */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TIME = "2026-10-04T10:00:00.000Z";

const post = (extra: Record<string, unknown> = {}) => ({
  id: id(1),
  author: { id: id(900), handle: "ada", displayName: "Ada", verified: false },
  body: "a post",
  createdAt: TIME,
  state: "removed",
  replyTo: null,
  counts: { likes: 0, reposts: 0, replies: 0, quotes: 0 },
  media: [],
  quoteOf: null,
  ...extra,
});

describe("the chip's facts on a post", () => {
  test("a post may carry the decision behind its state: its id, the rule or the law, and whether korbat is still deciding", () => {
    const chip = { decisionId: id(2), ruleId: "R3", legal: false, interim: false };
    expect(PostView.parse(post({ moderation: chip })).moderation).toEqual(chip);
    expect(PostView.parse(post({ moderation: { decisionId: id(2), ruleId: null, legal: true, interim: true } })).moderation).toEqual({ decisionId: id(2), ruleId: null, legal: true, interim: true });
    expect(PostView.parse(post()).moderation).toBeUndefined();
    for (const ruleId of ["R1", "R2", "R3", "R4", "R5", "R6"]) expect(PostView.safeParse(post({ moderation: { ...chip, ruleId } })).success, ruleId).toBe(true);
  });

  test("anything else in its place is refused", () => {
    const chip = { decisionId: id(2), ruleId: "R3", legal: false, interim: false };
    for (const moderation of [{ ...chip, ruleId: "R7" }, { ...chip, decisionId: "no id" }, { ...chip, legal: "yes" }, { decisionId: id(2), ruleId: "R3", legal: false }, null]) {
      expect(PostView.safeParse(post({ moderation })).success, JSON.stringify(moderation)).toBe(false);
    }
  });

  test("a quoted embed carries none: the chip belongs to the card of the post itself", () => {
    const quoted = QuotedPost.parse(post({ moderation: { decisionId: id(2), ruleId: "R3", legal: false, interim: false } }));
    expect("moderation" in quoted).toBe(false);
  });
});

describe("an item's words from the status answer's item", () => {
  const waiting = { position: 1, link: "http://localhost:8081/post/" + id(1), scope: null, suspect: false, sealed: false, unseen: false, quotedBy: null, outcome: null, decidedOn: null, changed: false, reexamines: false, reexamination: null };

  test("a released restriction under a rule carries the rule with its title, and a restriction that changed nothing says so; neither is there before the release", () => {
    expect(NoticeItemStatus.parse(waiting)).toEqual(waiting);
    const restricted = { ...waiting, outcome: "restricted_rule", decidedOn: "2026-10-04", rule: { id: "R3", title: "No targeted hatred" }, noEffect: true };
    expect(NoticeItemStatus.parse(restricted)).toEqual(restricted);
    expect(NoticeItemStatus.safeParse({ ...restricted, rule: { id: "R9", title: "x" } }).success).toBe(false);
    expect(NoticeItemStatus.safeParse({ ...restricted, rule: { id: "R3" } }).success).toBe(false);
    // The mark is there or it is not: a false one is never sent.
    expect(NoticeItemStatus.safeParse({ ...restricted, noEffect: false }).success).toBe(false);
  });

  test("the words are the one composition the mails use, from the item's own facts, and nothing is said before the release", () => {
    expect(itemOutcomeWords(NoticeItemStatus.parse(waiting))).toBeNull();
    const rule = { id: "R3", title: "No targeted hatred" } as const;
    const restricted = NoticeItemStatus.parse({ ...waiting, outcome: "restricted_rule", decidedOn: "2026-10-04", rule, noEffect: true, scope: "quote" });
    expect(itemOutcomeWords(restricted)).toBe(outcomeWords({ outcome: "restricted_rule", rule, suspect: false, sealed: false, unseen: false, noEffect: true, scope: "quote" }));
    expect(itemOutcomeWords(restricted)).toContain("it breaks korbat rule R3 (No targeted hatred).");
    expect(itemOutcomeWords(restricted)).toContain(ALREADY_NOT_SHOWN);
    const unseen = NoticeItemStatus.parse({ ...waiting, outcome: "no_violation", decidedOn: "2026-10-04", unseen: true });
    expect(itemOutcomeWords(unseen)).toBe(UNSEEN_NO_ACTION);
    const sealed = NoticeItemStatus.parse({ ...waiting, outcome: "restricted_rule", decidedOn: "2026-10-04", suspect: true, sealed: true, rule: { id: "R2", title: "No child sexual abuse material" } });
    expect(itemOutcomeWords(sealed)).toBe(SUSPECT_OUTCOME_PHRASES.sealed);
    const dismissed = NoticeItemStatus.parse({ ...waiting, outcome: "not_evident", decidedOn: "2026-10-04", suspect: true });
    expect(itemOutcomeWords(dismissed)).toBe(SUSPECT_OUTCOME_PHRASES.no_action);
  });

  test("an account's item that named nothing keeps its scope in the answer and reads no scope sentence", () => {
    const nothing = NoticeItemStatus.parse({ ...waiting, link: "http://localhost:8081/u/nobody", scope: "account", outcome: "not_available", decidedOn: "2026-10-04" });
    expect(itemOutcomeWords(nothing)).toBe(`${OUTCOME_PHRASES.not_available}.`);
    const answered = NoticeItemStatus.parse({ ...nothing, outcome: "no_violation" });
    expect(itemOutcomeWords(answered)).toBe(`${OUTCOME_PHRASES.no_violation}. ${ACCOUNT_ITEM_SCOPE}`);
  });
});

describe("the author's list of decisions", () => {
  const row = { id: id(3), kind: "final", outcome: "restricted", decidedOn: "2026-10-04", post: { id: id(1), createdAt: TIME }, actions: ["remove"], endedInterim: false, ruleId: "R3", legal: false, appealUntil: "2027-04-04T10:00:00.000Z", reversedOn: null };

  test("a page holds decisions, each with its day, what it did, the post's time for a decision about a post, the rule or the law and where its appeal stands", () => {
    const page = { decisions: [row, { ...row, id: id(4), kind: "interim", post: null, actions: ["reset_bio", "seal_media"], ruleId: null, legal: true, appealUntil: null }], nextCursor: "abc" };
    expect(AuthorCasesPage.parse(page)).toEqual(page);
    expect(AuthorCasesPage.parse({ decisions: [{ ...row, kind: "correction", outcome: "reversed", actions: ["restore"], ruleId: null, appealUntil: null, reversedOn: null }], nextCursor: null }).decisions[0]!.actions).toEqual(["restore"]);
    expect(AuthorCasesPage.safeParse({ decisions: [{ ...row, decidedOn: TIME }], nextCursor: null }).success).toBe(false);
    expect(AuthorCasesPage.safeParse({ decisions: [{ ...row, actions: ["delete"] }], nextCursor: null }).success).toBe(false);
  });

  test("its query takes an optional cursor and nothing else", () => {
    expect(AuthorCasesQuery.parse({})).toEqual({});
    expect(AuthorCasesQuery.parse({ cursor: "abc_-" })).toEqual({ cursor: "abc_-" });
    expect(AuthorCasesQuery.safeParse({ cursor: "" }).success).toBe(false);
    expect(AuthorCasesQuery.safeParse({ cursor: "a b" }).success).toBe(false);
    expect(ReportsQuery.parse({ cursor: "abc" })).toEqual({ cursor: "abc" });
    expect(ReportsQuery.safeParse({ cursor: "x".repeat(401) }).success).toBe(false);
  });
});

describe("one decision as its author reads it", () => {
  const statement = {
    kind: "final",
    outcome: "restricted",
    ground: "incompatible",
    ruleId: "R3",
    rulesVersion: 2,
    redressVersion: 1,
    legalReference: null,
    facts: "The post attacks a group.",
    reason: "It breaks the rule.",
    source: "report",
    decidedAt: TIME,
    post: { id: id(1), createdAt: TIME },
    measures: [{ kind: "remove", mediaId: null, noEffect: null, sealed: null }],
    reversals: [],
    endedMeasures: [],
    reviewed: null,
  };
  const image = { id: id(7), alt: "a picture", width: 800, height: 600, small: `/api/media/${id(7)}/small.webp`, large: `/api/media/${id(7)}/large.webp` };
  const view = { id: id(3), ...statement, appealUntil: "2027-04-04T10:00:00.000Z", reversedOn: null, content: { kind: "post", body: "the words", deletedByAuthor: false, images: [image], imageCount: 1, imagesHidden: null } };

  test("it is the statement's data with what the author's screen adds: where the appeal stands and the content actioned", () => {
    expect(DecisionView.parse(view)).toEqual(view);
    expect(DecisionView.safeParse({ ...view, content: undefined }).success).toBe(false);
    expect(DecisionView.safeParse({ ...view, id: undefined }).success).toBe(false);
  });

  test("the content is the post's text with its images, an account's fields, or the reason it is not shown", () => {
    const contents = [
      { kind: "post", body: "", deletedByAuthor: true, images: [], imageCount: 2, imagesHidden: "deleted_by_author" },
      { kind: "post", body: "text stays", deletedByAuthor: false, images: [], imageCount: 3, imagesHidden: "sealed" },
      { kind: "account", handle: "ada", displayName: "Ada", bio: "hello" },
      { kind: "r4_redacted" },
      { kind: "erased", contentErasedOn: "2026-10-05", postKept: true },
      { kind: "erased", contentErasedOn: "2026-10-05", postKept: false },
    ];
    for (const content of contents) expect(DecisionView.parse({ ...view, content }).content, content.kind).toEqual(content);
    for (const content of [{ kind: "erased" }, { kind: "post", body: "x" }, { kind: "sealed" }, { kind: "post", body: "x", deletedByAuthor: false, images: [], imageCount: 1, imagesHidden: "withheld" }]) {
      expect(DecisionView.safeParse({ ...view, content }).success, JSON.stringify(content)).toBe(false);
    }
  });

  test("an image of the content carries what the app's own image route needs, and nothing of an image that is not shown", () => {
    expect(DecisionView.safeParse({ ...view, content: { ...view.content, images: [{ id: id(7), alt: "a picture" }] } }).success).toBe(false);
  });
});

describe("the reporter's list", () => {
  const item = { position: 1, link: "http://localhost:8081/u/ada", scope: "account", suspect: false, sealed: false, unseen: false, quotedBy: null, outcome: null, decidedOn: null, changed: false, reexamines: false, reexamination: null };

  test("a page holds the account's reports, each with its reference, its time and its items in the status page's shape, and says whether korbat's report mails to the account are stopped", () => {
    const page = { reports: [{ ref: "N-ABCDEFGH23", receivedAt: TIME, items: [item, { ...item, position: 2, outcome: "no_violation", decidedOn: "2026-10-04", reexamination: { open: true, until: "2027-04-04T07:00:00.000Z" } }] }], nextCursor: null, reportMailStopped: true };
    expect(ReportsPage.parse(page)).toEqual(page);
    expect(ReportsPage.safeParse({ ...page, reportMailStopped: undefined }).success).toBe(false);
    expect(ReportsPage.safeParse({ ...page, reports: [{ ref: "nope", receivedAt: TIME, items: [] }] }).success).toBe(false);
    expect(REPORTS_PAGE_SIZE).toBe(20);
    expect(ReportsPage.safeParse({ ...page, reports: Array.from({ length: REPORTS_PAGE_SIZE + 1 }, () => page.reports[0]) }).success).toBe(false);
  });
});
```

### Replace `apps/api/test/integration/notices-harness.ts` (whole file)

```ts
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import pino from "pino";
import type { NoticeRequest } from "@korbat/contracts";
import { closeDb, createDb, profiles, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth, type AuthForModeration } from "../../src/auth";
import { emailHash } from "../../src/auth/identifiers";
import { MemoryKv } from "../../src/auth/kv";
import { createAuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { MailRefused, MailUnavailable, type FlatMailMessage, type MailMessage, type Mailer, type NoticeUpdateMessage } from "../../src/mail/mailer";
import { renderMail } from "../../src/mail/templates";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createModeration } from "../../src/moderation";
import type { NoticeSender } from "../../src/moderation/intake";
import { createProfileStore } from "../../src/profiles/store";
import { socialForModeration } from "../../src/social";
import { newTestEmail } from "./flow-harness";
import { casesMedia, gate, removeFixtures, rowCounts, uuids } from "./moderation-fixtures";

/**
 * What the tests of reports and notices share (3c design, sections 7.1 and 7.2): the real auth and moderation modules
 * over the test database, as the server wires them, with a mailer the test scripts, a human check that passes one
 * token, and clocks for the limits and the auth module's key-value store that the test moves. Every test commits (the
 * auth side is another pool), so the world remembers what was made and `cleanUp` removes it.
 */

/** The only token the human check passes. */
export const HUMAN = "human";

/** Records what was sent, and ends a send the way the test says: delivered, refused for good, failed, or not at all until released. */
export class ScriptedMailer implements Mailer {
  /** Every message handed over, delivered or not, in order. */
  readonly attempts: MailMessage[] = [];
  /** The flat messages delivered, and, apart from them, the structured daily updates delivered: each in order. */
  readonly sent: FlatMailMessage[] = [];
  readonly updates: NoticeUpdateMessage[] = [];
  mode: "deliver" | "refuse" | "fail" | "hang" = "deliver";
  private waiting = gate();

  async send(message: MailMessage): Promise<void> {
    // As the real mailer does first: a message whose data its template lacks is a programming error.
    renderMail(message);
    this.attempts.push(message);
    if (this.mode === "hang") await this.waiting.opened;
    if (this.mode === "refuse") throw new MailRefused("the relay refused the recipient");
    if (this.mode === "fail") throw new MailUnavailable("the relay could not be reached");
    if (message.template === "notice_update") this.updates.push(message);
    else this.sent.push(message);
  }

  /** Lets every hanging send end, as `mode` now says. */
  release(mode: "deliver" | "refuse" | "fail" = "deliver"): void {
    this.mode = mode;
    this.waiting.open();
    this.waiting = gate();
  }

  to(address: string, template?: string): FlatMailMessage[] {
    return this.sent.filter((message) => message.to === address && (template === undefined || message.template === template));
  }

  /** The daily updates delivered to this address, in order. */
  updatesTo(address: string): NoticeUpdateMessage[] {
    return this.updates.filter((message) => message.to === address);
  }

  /** The code of the newest mail to this address that carries one: a sign-up or sign-in code. */
  lastCodeFor(address: string): string | undefined {
    return this.to(address).findLast((message) => message.data.code)?.data.code;
  }
}

export function noticesWorld() {
  const config = loadConfig();
  const logger = pino({ level: "silent" });
  const authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
  const apiDb = createDb(config.DATABASE_URL_API, { max: 8 });
  // The migrate role is not part of the API configuration; the test environment carries it, for the fixtures' cleanup.
  const migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
  const repo = createAuthRepo(authDb);
  const mailer = new ScriptedMailer();
  /** How far the limit store's clock, and the auth module's key-value store's, stand ahead of the real one. */
  const ahead = { limitsMs: 0, kvMs: 0 };
  const rateLimitStore = new MemoryStore(() => Date.now() + ahead.limitsMs);
  const auth = createAuth({
    config,
    logger,
    authDb,
    kv: new MemoryKv(() => Date.now() + ahead.kvMs),
    mailer,
    profiles: createProfileStore(apiDb),
    turnstile: { verify: async (token) => token === HUMAN },
    breachChecker: { isBreached: async () => false },
  });
  // A copy the tests may script: a member replaced here is what the moderation module calls.
  const authForModeration: AuthForModeration = { ...auth.forModeration };
  const moderation = createModeration({ apiDb, auth: authForModeration, social: socialForModeration(apiDb), media: casesMedia(apiDb), requireSession: auth.requireSession, rateLimitStore, config, logger });
  const app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, moderation });

  const profileIds: string[] = [];
  const refs: string[] = [];
  const addresses: string[] = [];

  /** An onboarded account: an auth user with an address of its own and its profile, as sign-up leaves them. */
  async function account(options: { createdAt?: Date } = {}) {
    const email = newTestEmail("reporter");
    addresses.push(email);
    const user = await repo.createUser({ email, termsVersion: config.TERMS_VERSION, now: new Date() });
    await repo.markOnboarded(user.id, new Date());
    const handle = `n_${randomBytes(5).toString("hex")}`;
    await apiDb.insert(profiles).values({ id: user.id, handle, displayName: `Profile ${handle}`, createdAt: options.createdAt ?? new Date() });
    profileIds.push(user.id);
    return { id: user.id, handle, email, session: { userId: user.id, role: "user" as const, onboarded: true } };
  }

  /** A fresh address a signed-out notifier gives. */
  const address = () => {
    const email = newTestEmail("notifier");
    addresses.push(email);
    return email;
  };

  /** A sender from a network of its own: signed out, or the session given. */
  const sender = (session: NoticeSender["session"] = null): NoticeSender => ({ session, netHash: `net-${randomBytes(8).toString("hex")}` });

  /** The stored notice with this reference, as the migrator reads it. */
  async function notice(ref: string) {
    const [row] = await migrateDb.execute<{ id: string; kind: string; channel: string; reporter_id: string | null; contact_id: string | null; rule_id: string | null; alleges_illegal: boolean; csam: boolean; category: string; category_keyword: string | null; cited_law: string | null; explanation: string | null; bona_fide: boolean; lookup_hash: string | null; receipt: string; receipt_sent: boolean }>(
      sql`select id, kind, channel, reporter_id, contact_id, rule_id, alleges_illegal, csam, category, category_keyword, cited_law, explanation, bona_fide, lookup_hash, receipt, receipt_sent_at is not null as receipt_sent from intakes where ref = ${ref}`,
    );
    return row ? { ...row } : undefined;
  }

  /** The notice's items in position order, each with its case's lane when it has a case. */
  async function items(ref: string) {
    const rows = await migrateDb.execute<{ position: number; target_type: string; target_id: string; named_handle: string | null; media_id: string | null; case_id: string | null; lane: number; suspect: boolean; outcome: string | null; reporter_account_id: string | null; case_lane: number | null }>(
      sql`select i.position, i.target_type, i.target_id, i.named_handle, i.media_id, i.case_id, i.lane, i.suspect, i.outcome, i.reporter_account_id, c.lane as case_lane
            from intake_items i join intakes n on n.id = i.intake_id left join cases c on c.id = i.case_id where n.ref = ${ref} order by i.position, i.created_at`,
    );
    return rows.map((row) => ({ ...row }));
  }

  /** Remembers a notice the test stored, so that the cleanup removes it, and hands the answer back. */
  function remember<T extends { ref: string }>(answer: T): T {
    refs.push(answer.ref);
    return answer;
  }

  /** How many rows the moderation tables, the posts and profiles, and the auth side's notifier tables hold. */
  async function counts(): Promise<Record<string, number>> {
    const [authSide] = (await authDb.execute(
      sql`select (select count(*)::int from auth.notifier_contacts) as notifier_contacts, (select count(*)::int from auth.notifier_confirmations) as notifier_confirmations, (select count(*)::int from auth.notifier_suppressions) as notifier_suppressions`,
    )) as unknown as Record<string, number>[];
    return { ...(await rowCounts(apiDb)), ...authSide! };
  }

  /**
   * Removes what the tests stored: the profiles with their posts, images and cases; the notices that named nothing of
   * theirs (a link to no row, a handle nobody holds), by their references; and, on the auth side, the notices' contacts
   * and whatever the tests' addresses confirmed or stopped. The tasks the requests started are waited for first.
   */
  async function cleanUp(): Promise<void> {
    await moderation.settle();
    const contacts = refs.length === 0 ? [] : await migrateDb.execute<{ contact_id: string }>(sql`select contact_id from intakes where ref = any(${`{${refs.join(",")}}`}::text[]) and contact_id is not null`);
    await removeFixtures(migrateDb, profileIds.splice(0));
    if (refs.length > 0) {
      await migrateDb.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '10s'`);
        // What is left of these notices names nothing live: their items have no case.
        await tx.execute(sql`delete from intake_items where intake_id in (select id from intakes where ref = any(${`{${refs.join(",")}}`}::text[]))`);
        await tx.execute(sql`delete from intakes where ref = any(${`{${refs.join(",")}}`}::text[])`);
      });
      refs.length = 0;
    }
    if (contacts.length > 0) await authDb.execute(sql`delete from auth.notifier_contacts where id = any(${uuids(contacts.map((row) => row.contact_id))})`);
    if (addresses.length > 0) {
      const hashes = `{${addresses.splice(0).map((email) => emailHash(auth.deps.config.authHmacKey, email)).join(",")}}`;
      await authDb.execute(sql`delete from auth.notifier_confirmations where email_hash = any(${hashes}::text[])`);
      await authDb.execute(sql`delete from auth.notifier_suppressions where email_hash = any(${hashes}::text[])`);
    }
  }

  return {
    config,
    apiDb,
    authDb,
    migrateDb,
    repo,
    mailer,
    ahead,
    auth,
    authForModeration,
    moderation,
    deps: moderation.deps,
    app,
    profileIds,
    account,
    address,
    sender,
    notice,
    items,
    remember,
    counts,
    cleanUp,
    close: () => Promise.all([closeDb(authDb), closeDb(apiDb), closeDb(migrateDb)]),
  };
}

export type NoticesWorld = ReturnType<typeof noticesWorld>;

/** The three grounds as a signed-out sender words them, each about the targets given. */
export const notices = {
  rule: (targets: NoticeRequest["targets"], extra: Record<string, unknown> = {}) => ({ ground: "rule", ruleId: "R1", targets, turnstileToken: HUMAN, ...extra }) as NoticeRequest,
  illegal: (targets: NoticeRequest["targets"], extra: Record<string, unknown> = {}) =>
    ({ ground: "illegal", targets, category: "STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH", explanation: "It is a threat under section 241.", bonaFide: true, turnstileToken: HUMAN, ...extra }) as NoticeRequest,
  csam: (targets: NoticeRequest["targets"], extra: Record<string, unknown> = {}) => ({ ground: "csam", targets, keyword: "csam", turnstileToken: HUMAN, ...extra }) as NoticeRequest,
};

export const postTarget = (id: string, mediaId?: string) => ({ kind: "post" as const, id, ...(mediaId === undefined ? {} : { mediaId }) });
export const accountTarget = (handle: string) => ({ kind: "account" as const, handle });
export const linkTarget = (url: string) => ({ kind: "link" as const, url });
```

### Replace `apps/app/test/lifecycle.test.tsx` (whole file)

```tsx
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import EmailRevert from "../src/app/email-revert/[token]";
import { exportMessage } from "../src/app/settings/account";
import { SettingsNav, type SettingsPage } from "../src/components/SettingsNav";
import { VerifiedChip } from "../src/components/ui";
import { ApiError } from "../src/lib/api";
import { exportFilename } from "../src/lib/download";

/**
 * The account-lifecycle screens (1b design, section 9): the row of settings links, the verified badge
 * chip and the export download. The screens themselves need the router and a session, so what can be
 * checked without a browser is rendered on its own or read from the source, as a11y.test.tsx does.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");
const REPO = path.resolve(import.meta.dirname, "..", "..", "..");

/** The route parameters the screen under test reads; each test sets them. */
const route = vi.hoisted(() => ({ params: {} as Record<string, string> }));

// expo-router cannot load in Node (it reaches React Native's own modules), and the row needs only what
// Link does with `asChild`: hand the child its href, which react-native-web renders as a real anchor. A
// screen also reads its route parameters, and could navigate, which a static render never does.
vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  router: { replace: () => undefined },
  useLocalSearchParams: () => route.params,
}));
// A screen reads the session only to refresh it after its call; a static render never makes one.
vi.mock("@/lib/session", () => ({ useSession: () => ({ refresh: async () => undefined }) }));

const html = (element: ReactElement): string => renderToStaticMarkup(element);

/** Every anchor's opening tag in the markup. */
const anchors = (markup: string): string[] => markup.match(/<a\b[^>]*>/g) ?? [];

const PAGES: SettingsPage[] = ["security", "privacy", "profile", "account", "cases"];

describe("the settings row", () => {
  test("links every settings screen as a real anchor inside a navigation landmark", () => {
    const out = html(<SettingsNav current="security" />);
    expect(out).toMatch(/<nav\b|role="navigation"/);
    expect(anchors(out).map((tag) => /href="([^"]+)"/.exec(tag)?.[1])).toEqual(PAGES.map((page) => `/settings/${page}`));
  });

  test("marks the current page and only it", () => {
    for (const page of PAGES) {
      const current = anchors(html(<SettingsNav current={page} />)).filter((tag) => tag.includes('aria-current="page"'));
      expect(current, page).toHaveLength(1);
      expect(current[0], page).toContain(`href="/settings/${page}"`);
    }
  });

  test("every settings screen shows the row and names itself as the current page", () => {
    const dir = path.join(SRC, "app", "settings");
    // A page is a file of the folder, or a folder of its own whose screens all belong to it (Cases: its list and one decision).
    const screens = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith("_"))
      .flatMap((entry) =>
        entry.isDirectory() ? readdirSync(path.join(dir, entry.name)).map((file) => ({ page: entry.name, file: path.join(entry.name, file) })) : [{ page: entry.name.replace(/\.tsx$/, ""), file: entry.name }],
      );
    expect([...new Set(screens.map((screen) => screen.page))].sort()).toEqual([...PAGES].sort());
    for (const { page, file } of screens) {
      expect(file.endsWith(".tsx"), file).toBe(true);
      expect(readFileSync(path.join(dir, file), "utf8"), file).toContain(`<SettingsNav current="${page}"`);
    }
  });
});

describe("the verified badge chip", () => {
  test("renders its label and names itself for a screen reader, as an image, since ARIA lets no generic element carry a name", () => {
    const out = html(<VerifiedChip />);
    expect(out).toContain("Verified");
    const tag = /<div[^>]*aria-label="verified account"[^>]*>/.exec(out)?.[0] ?? "";
    expect(tag).toContain('role="img"');
  });

  test("is what post cards and the profile header show for a verified account", () => {
    for (const file of [path.join("components", "social", "PostCard.tsx"), path.join("app", "u", "[handle]", "index.tsx")]) {
      const source = readFileSync(path.join(SRC, file), "utf8");
      expect(source, file).toMatch(/verified \? <VerifiedChip \/> : null/);
    }
  });
});

describe("the export download", () => {
  test("takes its file name from Content-Disposition and falls back to a plain one", () => {
    expect(exportFilename('attachment; filename="korbat-export-alice-2026-09-24.zip"')).toBe("korbat-export-alice-2026-09-24.zip");
    expect(exportFilename(null)).toBe("korbat-export.zip");
    expect(exportFilename("attachment")).toBe("korbat-export.zip");
    // Only the API's own shape of name reaches the browser's download prompt.
    expect(exportFilename('attachment; filename="../evil.zip"')).toBe("korbat-export.zip");
  });
});

describe("the email-revert page, opened from the link in the email-changed notice", () => {
  const LABEL = "Move my account back to this address";
  /** The opening tag of the button whose text is the label, or "" when there is none. */
  const buttonTag = (markup: string): string => {
    const at = markup.indexOf(LABEL);
    const role = at === -1 ? -1 : markup.lastIndexOf('role="button"', at);
    return role === -1 ? "" : markup.slice(markup.lastIndexOf("<", role), markup.indexOf(">", role) + 1);
  };

  test("with the link's token it explains what happens and offers the button, which nothing happens without", () => {
    route.params = { token: "A".repeat(20) + "b_-".repeat(7) + "z".repeat(2) };
    const out = html(<EmailRevert />);
    expect(out).toContain(LABEL);
    expect(out).toMatch(/sign(s|ed)? out every session/i);
    expect(buttonTag(out)).not.toBe("");
    expect(buttonTag(out)).not.toContain('aria-disabled="true"');
    expect(out).not.toContain('role="alert"');
  });

  test("with anything else in place of the token it says the link is incomplete and disables the button", () => {
    for (const token of ["", "short", "A".repeat(42) + "/"]) {
      route.params = { token };
      const out = html(<EmailRevert />);
      expect(out, token).toContain('role="alert"');
      expect(out, token).toMatch(/link is incomplete/);
      expect(buttonTag(out), token).toContain('aria-disabled="true"');
    }
  });

  test("the button posts the token to the undo route and the page then offers Sign in", () => {
    const source = readFileSync(path.join(SRC, "app", "email-revert", "[token].tsx"), "utf8");
    expect(source).toContain('api("/api/auth/email/revert", { json: { token } })');
    expect(source).toMatch(/router\.replace\("\/signin"\)/);
  });
});

/**
 * The settings screens' own rules, read from their source: the static render cannot press a key or
 * move the focus, so what a keyboard does there is checked in the code that does it.
 */
describe("the settings forms", () => {
  const account = readFileSync(path.join(SRC, "app", "settings", "account.tsx"), "utf8");
  const profile = readFileSync(path.join(SRC, "app", "settings", "profile.tsx"), "utf8");

  /** The body of the function or component `name` declares at the top of the file, up to its closing brace at the start of a line. */
  function block(source: string, name: string): string {
    const from = source.indexOf(`function ${name}(`);
    expect(from, name).toBeGreaterThanOrEqual(0);
    return source.slice(from, source.indexOf("\n}\n", from));
  }

  /** The first statement of the function `name` inside `outer`, comments skipped. */
  function firstStatement(source: string, outer: string, name: string): string {
    const body = block(source, outer);
    const at = body.indexOf(`function ${name}(`);
    expect(at, `${outer} ${name}`).toBeGreaterThanOrEqual(0);
    const lines = body
      .slice(at)
      .split("\n")
      .slice(1)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("//"));
    return lines[0] ?? "";
  }

  test("Enter follows the same rules as the button: every action begins with its button's condition", () => {
    expect(firstStatement(account, "useAction", "act")).toBe("if (busy) return;");
    expect(firstStatement(account, "EmailSection", "start")).toBe("if (email.trim().length === 0) return;");
    expect(firstStatement(account, "EmailSection", "verify")).toBe("if (!CODE.test(code.trim())) return;");
    expect(firstStatement(account, "BadgeSection", "start")).toBe("if (phone.trim().length === 0) return;");
    expect(firstStatement(account, "BadgeSection", "verify")).toBe("if (!CODE.test(code.trim())) return;");
    expect(firstStatement(account, "DeleteSection", "confirm")).toBe("if (!CODE.test(code.trim()) || !matches) return;");
    expect(firstStatement(profile, "ProfileForm", "save")).toBe("if (!saved || !ready || busy) return;");
    expect(firstStatement(profile, "HandleSection", "change")).toBe("if (!ready || busy) return;");
  });

  test("the account's own address is refused in its own words, without asking the API", () => {
    const email = block(account, "EmailSection");
    expect(email).toContain("const current = email.trim().toLowerCase() === me.user.email.toLowerCase();");
    expect(email).toContain('<Button label="Send code" onPress={() => void start()} busy={busy} disabled={email.trim().length === 0 || current} />');
    const start = email.slice(email.indexOf("function start("));
    const refusal = start.indexOf('setError("That is already your email address.");');
    expect(refusal).toBeGreaterThan(0);
    expect(refusal).toBeLessThan(start.indexOf('api("/api/auth/email/change/start"'));
  });

  test("the badge section shows only in a build that says on, and every build defaults to off", () => {
    expect(account).toContain('const BADGE_SHOWN = process.env.EXPO_PUBLIC_BADGE === "on";');
    const read = (...parts: string[]) => readFileSync(path.join(REPO, ...parts), "utf8");
    expect(read("infra", "compose.yml")).toContain("EXPO_PUBLIC_BADGE: ${WEB_BADGE:-off}");
    const dockerfile = read("infra", "caddy", "Dockerfile");
    expect(dockerfile).toContain("ARG EXPO_PUBLIC_BADGE=off");
    expect(dockerfile).toContain('RUN case "$EXPO_PUBLIC_BADGE" in on|off) ;; *) echo "EXPO_PUBLIC_BADGE must be on or off" >&2; exit 1;; esac');
    const infraEnv = read("infra", ".env.example");
    expect(infraEnv).toMatch(/^WEB_BADGE=off$/m);
    expect(infraEnv).toMatch(/^API_VERIFY_PROVIDER=off$/m);
    // The development API runs the dev provider, so the development app shows the section.
    expect(read("apps", "app", ".env.example")).toMatch(/^EXPO_PUBLIC_BADGE=on$/m);
    expect(read("apps", "api", ".env.example")).toMatch(/^VERIFY_PROVIDER=dev$/m);
  });

  test("the focus survives a step change: code fields take it, and going back hands it to the section's first control", () => {
    for (const label of ["Code from the email", "Code from the text message"]) {
      const fields = account.split("\n").filter((line) => line.includes(`<Field label="${label}"`));
      expect(fields.length, label).toBeGreaterThan(0);
      for (const field of fields) expect(field, label).toContain(" autoFocus ");
    }
    expect(block(account, "EmailSection")).toContain("useFocusOnReturn(flowId !== null, emailRef);");
    expect(block(account, "EmailSection")).toContain('<Field ref={emailRef} label="New email address"');
    expect(block(account, "BadgeSection")).toContain("useFocusOnReturn(verified || flowId !== null, phoneRef);");
    expect(block(account, "BadgeSection")).toContain('<Field ref={phoneRef} label="Phone number"');
    expect(block(account, "BadgeSection")).toContain("useFocusOnReturn(!verified, removeRef);");
    expect(block(account, "BadgeSection")).toContain('<Button ref={removeRef} label="Remove badge"');
    expect(block(account, "DeleteSection")).toContain("useFocusOnReturn(flowId !== null, sendRef);");
    expect(block(account, "DeleteSection")).toContain('<Button ref={sendRef} label="Send me a code"');
    const hook = block(account, "useFocusOnReturn");
    expect(hook).toContain("if (!away && wasAway.current) target.current?.focus();");
    // The field and the button hand the ref to the element react-native-web renders, whose focus() moves the browser's focus.
    const ui = readFileSync(path.join(SRC, "components", "ui.tsx"), "utf8");
    expect(block(ui, "Field")).toContain("<TextInput\n        ref={ref}");
    expect(block(ui, "Button")).toContain("<Pressable ref={ref}");
  });

  test("the export's daily limit says when the next export is allowed", () => {
    const limited = (seconds: number) => new ApiError(429, "rate_limited", "Too many requests. Wait a moment and try again.", seconds);
    expect(exportMessage(limited(3600))).toBe("You exported your data today already. You can export again in about an hour.");
    expect(exportMessage(limited(20 * 3600))).toBe("You exported your data today already. You can export again in about 20 hours.");
    expect(exportMessage(limited(20 * 3600 - 600))).toBe("You exported your data today already. You can export again in about 20 hours.");
    expect(exportMessage(new ApiError(403, "reauth_required", "Confirm it's you to continue."))).toBe("Confirm it's you to continue.");
  });

  test("the export says it was downloaded only once the whole body arrived; a body that fails part way is an error", () => {
    const exporting = block(account, "ExportSection");
    const saved = exporting.indexOf("saveBlob(await res.blob(), exportFilename(res.headers.get(\"content-disposition\")));");
    expect(saved).toBeGreaterThan(0);
    expect(saved).toBeLessThan(exporting.indexOf('setDone("Your export was downloaded.");'));
    // A rejected res.blob() leaves the action through useAction, which shows the error and no note.
    expect(exporting).toContain("useAction(run, exportMessage)");
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
packages/contracts test:  ❯ test/author.test.ts (12 tests | 11 failed) 64ms
packages/db test:       Tests  60 passed (60)
packages/contracts test:  Test Files  1 failed | 13 passed (14)
packages/contracts test:       Tests  11 failed | 265 passed (276)
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/moderation-cases-3c/write_blocks.py docs/superpowers/prompts/moderation-cases-3c/07-the-app.md 3
```

Expected: 36 lines starting with `wrote`, one for each file below.

### Create `apps/api/src/moderation/author-repo.ts`

```ts
import { sql } from "drizzle-orm";
import type { ActionKind, PostModeration, RuleId } from "@korbat/contracts";
import { iso, rows, type Runner } from "./repo";

/**
 * The queries the author's surfaces are built from (3c design, sections 5, 7.6 and 11): the list of decisions about an
 * account, one decision's gate with the content it was made on, and the chip's facts on the author's own posts. They read
 * decisions, their ledger, cases, snapshots and the author's own posts and nothing else: no query here can reach who
 * reported, what a report said or how many there were, and a test refuses the names of those tables in this file.
 */

/** A UTC day of a timestamptz expression. The expression is written here, never input. */
const day = (expression: string) => sql.raw(`to_char(${expression} at time zone 'UTC', 'YYYY-MM-DD')`);

const MEASURES = sql`('withhold', 'remove', 'seal_media', 'withhold_media', 'remove_media', 'reset_display_name', 'reset_bio')`;

/**
 * The end of the appeal's window of decision `d`, while an appeal can still be filed: a final decision that restricts,
 * with at least one of its measures in force, no appeal filed, and its deadline not yet reached on the database's clock.
 * Null otherwise: for a decision taken while deciding, one that restricts nothing, a review, a correction, a restriction
 * reversed in full, and once the author appealed or the window closed.
 */
const appealUntil = sql`case when d.kind = 'final' and d.outcome = 'restricted'
                  and exists (select 1 from measures_in_force m where m.decision_id = d.id)
                  and not exists (select 1 from appeals ap where ap.decision_id = d.id)
                  and clock_timestamp() < public.appeal_deadline(d.informed_at)
             then ${iso("public.appeal_deadline(d.informed_at)")} end`;

/**
 * The UTC day on which the last measure of decision `d` was lifted, for a final decision that restricted and of which
 * nothing is in force any more. Null while any of its measures stands, and for every other decision: a decision taken
 * while deciding ends with its case, without a reversal.
 */
const reversedOn = sql`case when d.kind = 'final' and d.outcome = 'restricted'
                  and exists (select 1 from decision_actions a where a.decision_id = d.id and a.kind in ${MEASURES})
                  and not exists (select 1 from decision_actions a where a.decision_id = d.id and a.kind in ${MEASURES}
                                   and not exists (select 1 from decision_actions r where r.reverses_action_id = a.id))
             then (select ${day("max(r.created_at)")} from decision_actions a join decision_actions r on r.reverses_action_id = a.id where a.decision_id = d.id) end`;

/**
 * The cases about an account: the account's own, and those about the posts it wrote. A post keeps its author through its
 * deletion and the account's purge, so a decision stays with the account it was about.
 */
const casesAbout = (accountId: string) => sql`(
    select c.id, c.target_type, c.target_id from cases c where c.target_type = 'account' and c.target_id = ${accountId}::uuid
    union all
    select c.id, c.target_type, c.target_id from cases c join posts p on p.id = c.target_id where c.target_type = 'post' and p.author_id = ${accountId}::uuid
  )`;

/** One decision as the author's list shows it. */
export interface AuthorDecisionRow {
  id: string;
  kind: "interim" | "final" | "review" | "correction";
  outcome: string;
  decidedOn: string;
  /** The decision's time to the microsecond, as text: what the next page starts after. */
  sortAt: string;
  post: { id: string; createdAt: string } | null;
  actions: ActionKind[];
  endedInterim: boolean;
  ruleId: string | null;
  legal: boolean;
  appealUntil: string | null;
  reversedOn: string | null;
}

/**
 * The decisions about this account that its author was told of (`author_mail` is not `none`), newest first, after the
 * cursor when one is given. A decision the author was not told of is in no page.
 */
export async function authorDecisions(q: Runner, accountId: string, after: { at: string; id: string } | null, limit: number): Promise<AuthorDecisionRow[]> {
  const found = await rows<Record<string, unknown>>(
    q,
    sql`select d.id, d.kind, d.outcome, ${day("d.decided_at")} as decided_on,
               to_char(d.decided_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as sort_at,
               c.target_type, c.target_id,
               (select ${iso("p.created_at")} from posts p where c.target_type = 'post' and p.id = c.target_id) as post_created_at,
               coalesce((select array_agg(a.kind::text order by a.kind, a.media_id) from decision_actions a where a.decision_id = d.id), '{}') as actions,
               d.ended_interim, d.rule_id, d.ground is not distinct from 'illegal' as legal,
               ${appealUntil} as appeal_until, ${reversedOn} as reversed_on
          from ${casesAbout(accountId)} c join decisions d on d.case_id = c.id
         where d.author_mail <> 'none'
           ${after === null ? sql`` : sql`and (d.decided_at, d.id) < (${after.at}::timestamptz, ${after.id}::uuid)`}
         order by d.decided_at desc, d.id desc limit ${limit}::int`,
  );
  return found.map((row) => ({
    id: row.id as string,
    kind: row.kind as AuthorDecisionRow["kind"],
    outcome: row.outcome as string,
    decidedOn: row.decided_on as string,
    sortAt: row.sort_at as string,
    post: row.target_type === "post" && row.post_created_at !== null ? { id: row.target_id as string, createdAt: row.post_created_at as string } : null,
    actions: row.actions as ActionKind[],
    endedInterim: row.ended_interim as boolean,
    ruleId: row.rule_id as string | null,
    legal: row.legal as boolean,
    appealUntil: row.appeal_until as string | null,
    reversedOn: row.reversed_on as string | null,
  }));
}

/** What the author's view of one decision adds to its statement: where its appeal stands, and its snapshot with what decides whether and how it is shown. */
export interface AuthorDecisionFacts {
  targetType: "post" | "account";
  targetId: string;
  appealUntil: string | null;
  reversedOn: string | null;
  /** The database's one predicate by which a snapshot's content is withheld wherever it would be shown. */
  withheld: boolean;
  erased: boolean;
  /** The UTC day the snapshot was erased; null while it is kept. */
  erasedOn: string | null;
  /** A decision about the same post or account carries an R4 redaction. */
  redacted: boolean;
  body: string | null;
  images: { id: string; alt: string | null; width: number; height: number }[];
  handle: string;
  displayName: string | null;
  bio: string | null;
  /** For a decision about a post: whether its author deleted it, whether its content was erased, and whether a seal in force lists it. */
  postDeleted: boolean;
  postErased: boolean;
  sealed: boolean;
}

/**
 * One decision for the account it is about, or null: when no decision has the id, when it is about someone else, and when
 * its author was not told of it, so that no such decision opens by its id. A post's images are sealed exactly while a
 * seal in force lists the post, which is how the database derives their state too; this module never reads an image row.
 */
export async function authorDecision(q: Runner, accountId: string, decisionId: string): Promise<AuthorDecisionFacts | null> {
  const [row] = await rows<Record<string, unknown>>(
    q,
    sql`select c.target_type, c.target_id, ${appealUntil} as appeal_until, ${reversedOn} as reversed_on,
               public.snapshot_withheld(d.snapshot_id) as withheld, s.erased_at is not null as erased, ${day("s.erased_at")} as erased_on,
               exists (select 1 from decisions r join cases rc on rc.id = r.case_id
                        where rc.target_type = c.target_type and rc.target_id = c.target_id and r.redacted_at is not null) as redacted,
               s.body, s.media::text as media, coalesce(s.handle, s.author_handle) as handle, s.display_name, s.bio,
               coalesce(p.state = 'deleted_by_author', false) as post_deleted, coalesce(p.erased_at is not null, false) as post_erased,
               (c.target_type = 'post' and exists (select 1 from seal_posts sp join measures_in_force m on m.id = sp.action_id where sp.post_id = c.target_id)) as sealed
          from decisions d
          join cases c on c.id = d.case_id
          join evidence_snapshots s on s.id = d.snapshot_id
          left join posts p on c.target_type = 'post' and p.id = c.target_id
         where d.id = ${decisionId}::uuid and d.author_mail <> 'none'
           and case when c.target_type = 'post' then p.author_id = ${accountId}::uuid else c.target_id = ${accountId}::uuid end`,
  );
  if (!row) return null;
  return {
    targetType: row.target_type as "post" | "account",
    targetId: row.target_id as string,
    appealUntil: row.appeal_until as string | null,
    reversedOn: row.reversed_on as string | null,
    withheld: row.withheld as boolean,
    erased: row.erased as boolean,
    erasedOn: row.erased_on as string | null,
    redacted: row.redacted as boolean,
    body: row.body as string | null,
    images: row.media === null ? [] : (JSON.parse(row.media as string) as AuthorDecisionFacts["images"]),
    handle: row.handle as string,
    displayName: row.display_name as string | null,
    bio: row.bio as string | null,
    postDeleted: row.post_deleted as boolean,
    postErased: row.post_erased as boolean,
    sealed: row.sealed as boolean,
  };
}

/**
 * The decision behind the state of each of these posts that the account wrote and that is withheld or removed (3c design,
 * section 5): the decision of the strongest post measure in force, a removal before a withhold and the newest first; or,
 * for a post that is removed only because its content was erased, with no post measure in force, the newest decision
 * whose R4 redaction it was. A post of someone else, and one that is visible, is not in the answer.
 */
export async function chipFacts(q: Runner, accountId: string, postIds: readonly string[]): Promise<Map<string, PostModeration>> {
  const facts = new Map<string, PostModeration>();
  if (postIds.length === 0) return facts;
  const found = await rows<{ post_id: string; decision_id: string; rule_id: string | null; legal: boolean; interim: boolean }>(
    q,
    sql`select p.id as post_id, f.decision_id, f.rule_id, f.legal, f.interim
          from posts p
          cross join lateral (
            (select d.id as decision_id, d.rule_id, d.ground is not distinct from 'illegal' as legal, d.kind = 'interim' as interim, 0 as source,
                    (m.kind = 'remove') as removes, d.decided_at
               from measures_in_force m join decisions d on d.id = m.decision_id
              where m.post_id = p.id and m.kind in ('withhold', 'remove'))
            union all
            (select d.id, d.rule_id, d.ground is not distinct from 'illegal', false, 1, true, d.redacted_at
               from cases c join decisions d on d.case_id = c.id
              where c.target_type = 'post' and c.target_id = p.id and p.erased_at is not null and d.redacted_at is not null
                and exists (select 1 from decision_actions a where a.decision_id = d.id and a.kind = 'remove'))
            order by source, removes desc, decided_at desc, decision_id desc
            limit 1
          ) f
         where p.id = any(${`{${postIds.join(",")}}`}::uuid[]) and p.author_id = ${accountId}::uuid and p.moderation_level in ('withheld', 'removed')`,
  );
  for (const row of found) facts.set(row.post_id, { decisionId: row.decision_id, ruleId: row.rule_id as RuleId | null, legal: row.legal, interim: row.interim });
  return facts;
}
```

### Create `apps/api/src/moderation/author.ts`

```ts
import { AUTHOR_CASES_PAGE_SIZE, mediaPath, type AuthorCasesPage, type DecisionContent, type DecisionView, type PostModeration, type RuleId } from "@korbat/contracts";
import { authorDecision, authorDecisions, chipFacts, type AuthorDecisionFacts } from "./author-repo";
import { ModerationError, type ModerationDeps } from "./context";
import { decisionStatement } from "./statement";

/**
 * What the author of a post or the holder of an account reads about korbat's decisions on it (3c design, sections 7.6 and
 * 10): the list of decisions they were told of, one decision with its statement's data and the content it was made on,
 * and the facts behind the chip on their own post. Everything here is built from the author's queries and the statement's
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
 * GET /api/moderation/decisions/:id: one decision as its author reads it, or not_found: for an id that names no
 * decision, for a decision about someone else, and for one its author was not told of.
 */
export async function authorDecisionView(deps: Pick<ModerationDeps, "apiDb">, viewer: string, decisionId: string): Promise<DecisionView> {
  const facts = await authorDecision(deps.apiDb, viewer, decisionId);
  if (!facts) throw new ModerationError("not_found");
  const found = await decisionStatement(deps.apiDb, decisionId);
  if (!found) throw new ModerationError("not_found");
  return { id: decisionId, ...found.statement, appealUntil: facts.appealUntil, reversedOn: facts.reversedOn, content: contentOf(facts) };
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

### Create `apps/api/src/moderation/reports.ts`

```ts
import { REPORTS_PAGE_SIZE, type ReportRow, type ReportsPage } from "@korbat/contracts";
import { decodeListCursor, encodeListCursor } from "./author";
import type { ModerationDeps } from "./context";
import { itemStatus, listedItems } from "./intake";
import { noticeItemsOf, reporterNotices } from "./repo";

/**
 * The reporter's list (3c design, section 7.6): the reports and notices an account sent, while korbat keeps their
 * records, each item exactly as the status page gives it (the same function builds both), so the list, the page and the
 * mail tell the same at the same time and in the same words. A report on the path for child sexual abuse material is
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
    for (const item of listedItems(items.get(notice.id) ?? [])) rows.push(await itemStatus(deps, item));
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

/**
 * POST /api/moderation/report-mail/resume: lifts a stop of korbat's report mails to the account's address. The session
 * proves the address, which the account's sign-in code confirmed. It answers the same whether or not there was a stop.
 */
export async function resumeReportMail(deps: Pick<ModerationDeps, "auth">, viewer: string): Promise<void> {
  await deps.auth.resumeAccountReportMail(viewer);
}
```

### Create `apps/app/src/app/notice/[ref].tsx`

```tsx
import { useCallback, useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { NoticeRef, type NoticeStatus } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { NoticeNotFound, NoticeStatusView } from "@/components/moderation/NoticeStatusView";
import { Button, ErrorText, Loading } from "@/components/ui";
import { ApiError, errorMessage } from "@/lib/api";
import { fragmentToken, moderation } from "@/lib/moderation";
import { STATUS_WORDS } from "@/lib/moderation-words";

type Shown = { kind: "loading" } | { kind: "missing" } | { kind: "failed"; message: string } | { kind: "status"; status: NoticeStatus };

/**
 * The notice status page (3c design, section 9), outside the settings: whoever holds the link reads it, signed in or
 * not. The link carries the reference in its path and the token in its fragment, which a browser sends to no server; the
 * page reads the token there and sends it only in the body of a POST. A wrong reference and a wrong token read the same.
 */
export default function NoticePage() {
  const { ref } = useLocalSearchParams<{ ref: string }>();
  const [token, setToken] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (ref: string, token: string) => {
    try {
      setShown({ kind: "status", status: await moderation.status(ref, token) });
    } catch (err) {
      // No report has this reference with this token, or the address was not a status page's at all.
      if (err instanceof ApiError && (err.code === "notice_not_found" || err.code === "invalid_request")) setShown({ kind: "missing" });
      else setShown({ kind: "failed", message: errorMessage(err) });
    }
  }, []);

  useEffect(() => {
    const location = (globalThis as { location?: { hash: string } }).location;
    const found = location ? fragmentToken(location.hash) : null;
    setToken(found);
    if (found === null || !NoticeRef.safeParse(ref).success) {
      setShown({ kind: "missing" });
      return;
    }
    setShown({ kind: "loading" });
    void load(ref, found);
  }, [ref, load]);

  /** One of the page's buttons: a POST with the page's own token, then the page again as the API now gives it. */
  async function contact(choice: "confirm" | "stop") {
    if (busy || token === null) return;
    setBusy(true);
    setError(null);
    try {
      await moderation.contact(ref, token, choice);
      await load(ref, token);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (shown.kind === "loading") return <Loading />;
  return (
    <AppShell>
      <ScrollView contentContainerClassName="px-4 pb-16 pt-6">
        <View className="w-full max-w-xl">
          {shown.kind === "missing" ? <NoticeNotFound /> : null}
          {shown.kind === "failed" ? (
            <>
              <ErrorText message={shown.message} />
              <Button
                label={STATUS_WORDS.retry}
                onPress={() => {
                  if (token !== null) void load(ref, token);
                }}
                tone="secondary"
              />
            </>
          ) : null}
          {shown.kind === "status" ? <NoticeStatusView status={shown.status} onContact={(choice) => void contact(choice)} busy={busy} error={error} /> : null}
        </View>
      </ScrollView>
    </AppShell>
  );
}
```

### Create `apps/app/src/app/report.tsx`

```tsx
import { ScrollView, View } from "react-native";
import { Redirect, useLocalSearchParams } from "expo-router";
import { AppShell } from "@/components/AppShell";
import { ReportForm } from "@/components/moderation/ReportForm";
import { Loading } from "@/components/ui";
import { givenTarget } from "@/lib/moderation";
import { useSession } from "@/lib/session";

/**
 * The report form's page (3c design, section 9): opened from "Report" on a post, an image or a profile, whose address
 * names the item, or on its own, from the terms page, where it asks for a link. It stands outside the settings, whose
 * layout sends a signed-out reader to sign in: anyone may report, signed in or not. An account that has not chosen a
 * handle yet finishes that first, as the API asks of every signed-in request.
 */
export default function Report() {
  const params = useLocalSearchParams<{ post?: string; media?: string; account?: string }>();
  const { state } = useSession();
  if (state.status === "loading") return <Loading />;
  if (state.status === "signed-in" && !state.me.user.onboarded) return <Redirect href="/handle" />;
  const given = givenTarget(params);
  return (
    <AppShell>
      <ScrollView contentContainerClassName="px-4 pb-16 pt-6">
        <View className="w-full max-w-xl">
          {/* A form opened on another item starts empty: its key is the item. */}
          <ReportForm key={given ? JSON.stringify(given) : "link"} signedIn={state.status === "signed-in"} given={given} />
        </View>
      </ScrollView>
    </AppShell>
  );
}
```

### Create `apps/app/src/app/settings/cases/[id].tsx`

```tsx
import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import type { DecisionView } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { DecisionDetail } from "@/components/moderation/DecisionDetail";
import { SettingsNav } from "@/components/SettingsNav";
import { ErrorText, Loading, TextLink } from "@/components/ui";
import { ApiError, errorMessage } from "@/lib/api";
import { moderation } from "@/lib/moderation";
import { CASES_WORDS, DECISION_WORDS } from "@/lib/moderation-words";

type Shown = { kind: "loading" } | { kind: "missing" } | { kind: "failed"; message: string } | { kind: "decision"; view: DecisionView };

/**
 * One decision (3c design, section 9), under Settings, Cases: the chip on a post and each row of "About you" lead here.
 * The API answers only for the account the decision is about and only for a decision that account was told of; anything
 * else reads as one sentence, whatever the id named.
 */
export default function Decision() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [shown, setShown] = useState<Shown>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setShown({ kind: "loading" });
    void (async () => {
      try {
        const view = await moderation.decision(id);
        if (!cancelled) setShown({ kind: "decision", view });
      } catch (err) {
        if (cancelled) return;
        // No decision of this account has the id, or the address held no id at all.
        if (err instanceof ApiError && (err.status === 404 || err.code === "invalid_request")) setShown({ kind: "missing" });
        else setShown({ kind: "failed", message: errorMessage(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <AppShell>
      <ScrollView contentContainerClassName="px-4 pb-16 pt-4">
        <Text accessibilityRole="header" className="text-xl font-bold text-zinc-50">
          {CASES_WORDS.title}
        </Text>
        <SettingsNav current="cases" />
        <View className="mt-6 w-full max-w-xl">
          {shown.kind === "loading" ? <Loading /> : null}
          {shown.kind === "missing" ? <ErrorText message={DECISION_WORDS.notFound} /> : null}
          {shown.kind === "failed" ? <ErrorText message={shown.message} /> : null}
          {shown.kind === "decision" ? <DecisionDetail view={shown.view} /> : null}
          <TextLink label={DECISION_WORDS.back} href="/settings/cases" />
        </View>
      </ScrollView>
    </AppShell>
  );
}
```

### Create `apps/app/src/app/settings/cases/index.tsx`

```tsx
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import type { AuthorCaseRow, ReportRow } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { DecisionsList, ReportsList } from "@/components/moderation/CasesLists";
import { SettingsNav } from "@/components/SettingsNav";
import { ErrorText, TextButton } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { moderation } from "@/lib/moderation";
import { CASES_WORDS, STATUS_WORDS } from "@/lib/moderation-words";

type Tab = "about" | "reports";

/** A list read a page at a time: its rows so far, the cursor of the next page, and whether a read is out or failed. */
interface Pages<T> {
  rows: T[];
  next: string | null;
  loaded: boolean;
  busy: boolean;
  error: string | null;
}

const EMPTY = { rows: [], next: null, loaded: false, busy: false, error: null };

/**
 * Cases (3c design, section 9), inside the settings layout, which lets in only a signed-in account with a handle: two
 * tabs. "About you" lists the decisions about the account; "Your reports" lists the reports it sent, with their outcomes
 * once released and, when the account's address stopped korbat's report mails, the notice and the button that resumes
 * them. A link from the report form opens the second tab (`?tab=reports`).
 */
export default function Cases() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(params.tab === "reports" ? "reports" : "about");
  const [decisions, setDecisions] = useState<Pages<AuthorCaseRow>>(EMPTY);
  const [reports, setReports] = useState<Pages<ReportRow>>(EMPTY);
  const [mailStopped, setMailStopped] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);

  /** Reads the first page of the decisions, or the page after `cursor`. */
  const loadDecisions = useCallback(async (cursor?: string) => {
    setDecisions((current) => ({ ...current, busy: true, error: null }));
    try {
      const page = await moderation.cases(cursor);
      setDecisions((current) => ({ rows: cursor ? [...current.rows, ...page.decisions] : page.decisions, next: page.nextCursor, loaded: true, busy: false, error: null }));
    } catch (err) {
      setDecisions((current) => ({ ...current, busy: false, error: errorMessage(err) }));
    }
  }, []);

  /** The same for the reports; every page says whether korbat's report mails to the account are stopped. */
  const loadReports = useCallback(async (cursor?: string) => {
    setReports((current) => ({ ...current, busy: true, error: null }));
    try {
      const page = await moderation.reports(cursor);
      setMailStopped(page.reportMailStopped);
      setReports((current) => ({ rows: cursor ? [...current.rows, ...page.reports] : page.reports, next: page.nextCursor, loaded: true, busy: false, error: null }));
    } catch (err) {
      setReports((current) => ({ ...current, busy: false, error: errorMessage(err) }));
    }
  }, []);

  // Each tab reads its list the first time it is shown.
  useEffect(() => {
    if (tab === "about" && !decisions.loaded && !decisions.busy && decisions.error === null) void loadDecisions();
    if (tab === "reports" && !reports.loaded && !reports.busy && reports.error === null) void loadReports();
  }, [tab, decisions, reports, loadDecisions, loadReports]);

  async function resume() {
    if (resuming) return;
    setResuming(true);
    setResumeError(null);
    try {
      await moderation.resumeReportMail();
      setMailStopped(false);
    } catch (err) {
      setResumeError(errorMessage(err));
    } finally {
      setResuming(false);
    }
  }

  const shown = tab === "about" ? decisions : reports;
  return (
    <AppShell>
      <ScrollView>
        <View className="border-b border-zinc-800 px-4 pt-4">
          <Text accessibilityRole="header" className="text-xl font-bold text-zinc-50">
            {CASES_WORDS.title}
          </Text>
          <SettingsNav current="cases" />
          <View accessibilityRole="tablist" className="mt-4 flex-row">
            {(["about", "reports"] as Tab[]).map((t) => (
              <Pressable key={t} accessibilityRole="tab" aria-selected={tab === t} onPress={() => setTab(t)} className={`mr-6 border-b-2 pb-2 ${tab === t ? "border-zinc-50" : "border-transparent"}`}>
                <Text className={`text-base ${tab === t ? "font-semibold text-zinc-50" : "text-zinc-400"}`}>{CASES_WORDS.tabs[t]}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        {tab === "about" && decisions.loaded ? <DecisionsList decisions={decisions.rows} /> : null}
        {tab === "reports" && reports.loaded ? <ReportsList page={{ reports: reports.rows, reportMailStopped: mailStopped }} onResume={() => void resume()} busy={resuming} error={resumeError} /> : null}
        <View className="px-4 pb-10">
          <ErrorText message={shown.error} />
          {/* A first read that failed is asked again by hand; the tab does not ask in a loop. */}
          {shown.error && !shown.loaded ? <TextButton label={STATUS_WORDS.retry} onPress={() => void (tab === "about" ? loadDecisions() : loadReports())} /> : null}
          {shown.next ? <TextButton label={CASES_WORDS.more} onPress={() => void (tab === "about" ? loadDecisions(shown.next!) : loadReports(shown.next!))} /> : null}
        </View>
      </ScrollView>
    </AppShell>
  );
}
```

### Create `apps/app/src/components/moderation/CasesLists.tsx`

```tsx
import { Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import { MEASURES, type AuthorCaseRow, type ReportsPage } from "@korbat/contracts";
import { Button, ErrorText } from "@/components/ui";
import { utcMinute } from "@/lib/moderation";
import { CASES_WORDS } from "@/lib/moderation-words";
import { ItemLines } from "./ItemLines";

/** What a decision did, in the measures' own labels; a decision without a measure ended what was done while deciding, or took no action. */
function done(row: AuthorCaseRow): string {
  const labels: string[] = row.actions.map((kind) => MEASURES[kind].label);
  if (row.endedInterim) labels.push(CASES_WORDS.ended);
  return labels.length > 0 ? labels.join(", ") : CASES_WORDS.noAction;
}

/** Which kind of decision it is, where that is not plain from what it did. */
function kindWords(row: AuthorCaseRow): string | null {
  if (row.kind === "interim") return CASES_WORDS.whileDeciding;
  if (row.kind === "review") return CASES_WORDS.review;
  if (row.kind === "correction") return CASES_WORDS.correction;
  return null;
}

/**
 * "About you" (3c design, section 9): the decisions about the account that its holder was told of, newest first. Each
 * row is a link to the decision's screen and says what it is about (the post, by its creation time, or the profile), the
 * decision's day, what was done, the rule or the law, and where its appeal stands.
 */
export function DecisionsList({ decisions }: { decisions: readonly AuthorCaseRow[] }) {
  if (decisions.length === 0) return <Text className="px-4 py-8 text-base text-zinc-400">{CASES_WORDS.noDecisions}</Text>;
  return (
    <View>
      {decisions.map((row) => {
        const kind = kindWords(row);
        return (
          <Link key={row.id} href={`/settings/cases/${row.id}`} asChild>
            <Pressable className="border-b border-zinc-800 px-4 py-3">
              <Text className="text-base font-semibold text-zinc-50">{row.post ? CASES_WORDS.post(utcMinute(row.post.createdAt)) : CASES_WORDS.profile}</Text>
              <Text className="mt-1 text-sm text-zinc-400">
                {CASES_WORDS.decidedOn(row.decidedOn)}
                {kind ? ` (${kind})` : ""}
              </Text>
              <Text className="mt-1 text-sm leading-5 text-zinc-200">{done(row)}</Text>
              {row.ruleId || row.legal ? <Text className="mt-1 text-sm text-zinc-300">{row.ruleId ? CASES_WORDS.rule(row.ruleId) : CASES_WORDS.law}</Text> : null}
              {row.appealUntil ? <Text className="mt-1 text-sm text-zinc-300">{CASES_WORDS.appealOpen(utcMinute(row.appealUntil))}</Text> : null}
              {row.reversedOn ? <Text className="mt-1 text-sm text-zinc-300">{CASES_WORDS.reversed(row.reversedOn)}</Text> : null}
            </Pressable>
          </Link>
        );
      })}
    </View>
  );
}

/**
 * "Your reports" (3c design, section 9): the account's reports with each item as the status page words it. When the
 * account's address stopped korbat's report mails (someone who holds it asked for that on a status page), the tab says so
 * above the list, with the button that resumes them: the outcomes are listed here either way.
 */
export function ReportsList({ page, onResume, busy = false, error = null }: { page: Pick<ReportsPage, "reports" | "reportMailStopped">; onResume?: () => void; busy?: boolean; error?: string | null }) {
  return (
    <View>
      {page.reportMailStopped ? (
        <View className="border-b border-zinc-800 px-4 pb-4 pt-3">
          <Text className="text-sm leading-5 text-zinc-200">{CASES_WORDS.mailStopped}</Text>
          <Button label={CASES_WORDS.resume} onPress={() => onResume?.()} busy={busy} tone="secondary" />
          <Text className="mt-2 text-sm leading-5 text-zinc-400">{CASES_WORDS.resumeHint}</Text>
          <ErrorText message={error} />
        </View>
      ) : null}
      {page.reports.length === 0 ? <Text className="px-4 py-8 text-base text-zinc-400">{CASES_WORDS.noReports}</Text> : null}
      {page.reports.map((report) => (
        <View key={report.ref} className="border-b border-zinc-800 px-4 pb-4 pt-3">
          <Text className="text-base font-semibold text-zinc-50">{CASES_WORDS.report(report.ref, utcMinute(report.receivedAt))}</Text>
          <ItemLines items={report.items} />
        </View>
      ))}
    </View>
  );
}
```

### Create `apps/app/src/components/moderation/DecisionDetail.tsx`

```tsx
import { Image } from "expo-image";
import { Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import type { DecisionContent, DecisionView } from "@korbat/contracts";
import { statementParagraphs } from "@korbat/rules";
import { Section } from "@/components/ui";
import { SEALED_IMAGE } from "@/components/social/HiddenImage";
import { clampRatio } from "@/components/social/MediaGrid";
import { API_BASE } from "@/lib/api";
import { utcMinute } from "@/lib/moderation";
import { CASES_WORDS, DECISION_WORDS } from "@/lib/moderation-words";

const Line = ({ children, strong = false }: { children: string; strong?: boolean }) => <Text className={`mt-3 text-base leading-6 ${strong ? "font-semibold text-zinc-100" : "text-zinc-200"}`}>{children}</Text>;
const Note = ({ children }: { children: string }) => <Text className="mt-3 text-sm leading-5 text-zinc-400">{children}</Text>;

/** One field of an account as korbat copied it. */
function FieldValue({ label, value }: { label: string; value: string }) {
  return (
    <Text className="mt-3 text-base leading-6 text-zinc-200">
      <Text className="font-semibold text-zinc-100">{label}</Text> {value.length > 0 ? value : DECISION_WORDS.empty}
    </Text>
  );
}

/**
 * The content a decision was made on, or the reason it is not shown (3c design, section 7.6). A post's text is never
 * sealed, so it stands beside its sealed images, each drawn as the placeholder that tells the author nobody is shown it.
 * The images of a post its author deleted are kept for the case and shown to nobody. Every other image comes from the
 * app's own image route, which serves the author their withheld and removed images too.
 */
function Content({ content }: { content: DecisionContent }) {
  if (content.kind === "r4_redacted") return <Note>{DECISION_WORDS.r4Redacted}</Note>;
  if (content.kind === "erased") return <Note>{content.postKept ? `${DECISION_WORDS.erased(content.contentErasedOn)} ${DECISION_WORDS.postKept}` : DECISION_WORDS.erased(content.contentErasedOn)}</Note>;
  if (content.kind === "account") {
    return (
      <View>
        <FieldValue label={DECISION_WORDS.handle} value={`@${content.handle}`} />
        <FieldValue label={DECISION_WORDS.displayName} value={content.displayName} />
        <FieldValue label={DECISION_WORDS.bio} value={content.bio} />
      </View>
    );
  }
  return (
    <View>
      {content.deletedByAuthor ? <Note>{DECISION_WORDS.deleted}</Note> : null}
      {content.body.length > 0 ? <Line>{content.body}</Line> : <Note>{DECISION_WORDS.noText}</Note>}
      {content.imagesHidden === "sealed"
        ? Array.from({ length: content.imageCount }, (_, index) => (
            <View key={index} className="mt-3 items-center justify-center rounded-lg bg-zinc-900 px-3 py-6">
              <Text className="text-center text-sm leading-5 text-zinc-400">{SEALED_IMAGE}</Text>
            </View>
          ))
        : null}
      {content.imagesHidden === "deleted_by_author" && content.imageCount > 0 ? <Note>{DECISION_WORDS.deletedImages}</Note> : null}
      {content.images.map((image) => (
        <View key={image.id} className="mt-3">
          <View className="overflow-hidden rounded-xl border border-zinc-800" style={{ aspectRatio: clampRatio(image.width, image.height) }}>
            {/* On the web expo-image takes the <img alt> from accessibilityLabel, not from alt. */}
            <Image source={{ uri: `${API_BASE}${image.small}` }} contentFit="cover" accessibilityLabel={image.alt} style={{ width: "100%", height: "100%" }} />
          </View>
          <Text className="mt-1 text-sm leading-5 text-zinc-300">{image.alt}</Text>
        </View>
      ))}
    </View>
  );
}

/** The statement's paragraphs, or null when this build's rulebook does not hold the version the decision was made under: it is then never rendered as another. */
function paragraphsOf(view: DecisionView): string[] | null {
  try {
    return statementParagraphs(view);
  } catch {
    return null;
  }
}

/**
 * One decision as its author reads it (3c design, section 9): the statement of reasons, rendered by the same function
 * that rendered its mail, from the same data; what the decision is about and the content it was made on; and where its
 * appeal stands. A decision that ends or lifts a field reset links the decision that reset the field while korbat still
 * keeps the old value there. An appeal is filed from here once korbat takes appeals; until then the screen says until
 * when one can be filed, or that a restriction reversed in full leaves nothing to appeal.
 */
export function DecisionDetail({ view }: { view: DecisionView }) {
  const paragraphs = paragraphsOf(view);
  // The decisions whose screens still show a reset field's old value: of the resets this decision lifts, and of those that ended with it.
  const resets = [...new Set([...view.reversals, ...view.endedMeasures].flatMap((entry) => (entry.oldValueKept && entry.resetDecisionId ? [entry.resetDecisionId] : [])))];
  return (
    <View>
      {/* The screen's own title is "Cases": this heading and the sections under it are one level below it. */}
      <Text accessibilityRole="header" aria-level={2} className="text-lg font-semibold text-zinc-50">
        {DECISION_WORDS.title}
      </Text>
      <Text className="mt-1 text-base text-zinc-300">{view.post ? DECISION_WORDS.post(utcMinute(view.post.createdAt)) : CASES_WORDS.profile}</Text>

      <Section title={DECISION_WORDS.statement}>
        {paragraphs ? paragraphs.map((paragraph, index) => <Line key={index}>{paragraph}</Line>) : <Note>{DECISION_WORDS.cannotRender}</Note>}
        {resets.map((decisionId) => (
          <Link key={decisionId} href={`/settings/cases/${decisionId}`} asChild>
            <Pressable className="mt-3 self-start">
              <Text className="text-sm text-sky-400 underline">{DECISION_WORDS.resetDecision}</Text>
            </Pressable>
          </Link>
        ))}
      </Section>

      <Section title={DECISION_WORDS.content}>
        <Content content={view.content} />
      </Section>

      {view.appealUntil || view.reversedOn ? (
        <Section title={DECISION_WORDS.appeal}>
          <Line>{view.appealUntil ? DECISION_WORDS.appealUntil(utcMinute(view.appealUntil)) : DECISION_WORDS.reversed(view.reversedOn!)}</Line>
        </Section>
      ) : null}
    </View>
  );
}
```

### Create `apps/app/src/components/moderation/ItemLines.tsx`

```tsx
import { Text, View } from "react-native";
import { itemOutcomeWords, type NoticeItemStatus } from "@korbat/contracts";
import { externalLink } from "@/lib/links";
import { itemRedress, utcMinute } from "@/lib/moderation";
import { STATUS_WORDS } from "@/lib/moderation-words";

/**
 * One item of a report as its sender reads it, on the notice status page and in Your reports alike (3c design, section
 * 9). Its link is the address the report named, an account's under the handle as named. Once its outcome is released it
 * reads the words the mail reads (the contracts' one composition, from the item's own facts), and beside them what the
 * sender can still do: ask for a re-examination while that is open, or go to court; a changed outcome and a
 * re-examination's answer are final within korbat. Until then it says only that it is not decided.
 */
function ItemLine({ item }: { item: NoticeItemStatus }) {
  const words = itemOutcomeWords(item);
  const redress = itemRedress(item);
  return (
    <View className="mt-4 rounded-lg border border-zinc-800 px-4 py-3">
      {item.quotedBy !== null ? (
        // An item korbat added for the post a named post quotes: its heading says so, with the quoted post's address.
        <Text className="text-sm font-semibold text-zinc-100">{STATUS_WORDS.added(item.quotedBy, item.link)}</Text>
      ) : (
        <Text className="text-sm font-semibold text-zinc-100">
          {STATUS_WORDS.item(item.position)}
          {item.reexamines ? ` (${STATUS_WORDS.reexaminationLabel})` : ""}:{" "}
          <Text {...externalLink(item.link)} className="font-normal text-sky-400 underline">
            {item.link}
          </Text>
        </Text>
      )}
      {words === null || item.decidedOn === null ? (
        <Text className="mt-2 text-sm text-zinc-400">{STATUS_WORDS.waiting}</Text>
      ) : (
        <>
          <Text className="mt-2 text-sm leading-5 text-zinc-200">
            {STATUS_WORDS.decided(item.decidedOn)} {words}
          </Text>
          {redress === "reexamination" && item.reexamination ? <Text className="mt-2 text-sm leading-5 text-zinc-400">{STATUS_WORDS.reexaminationOpen(utcMinute(item.reexamination.until))}</Text> : null}
          {redress === "final" ? <Text className="mt-2 text-sm leading-5 text-zinc-400">{STATUS_WORDS.final}</Text> : null}
          {redress === "courts" ? <Text className="mt-2 text-sm leading-5 text-zinc-400">{STATUS_WORDS.courts}</Text> : null}
        </>
      )}
    </View>
  );
}

/** A report's items in the order the API lists them: by position, an added item directly after the item it was added for. */
export function ItemLines({ items }: { items: readonly NoticeItemStatus[] }) {
  return (
    <View>
      {items.map((item, index) => (
        // A re-examination shares its item's position, so the place in the list is the key.
        <ItemLine key={index} item={item} />
      ))}
    </View>
  );
}
```

### Create `apps/app/src/components/moderation/NoticeStatusView.tsx`

```tsx
import { Text, View } from "react-native";
import type { NoticeStatus } from "@korbat/contracts";
import { Body, Button, ErrorText, TextLink, Title } from "@/components/ui";
import { messageFor } from "@/lib/api";
import { utcMinute } from "@/lib/moderation";
import { STATUS_WORDS } from "@/lib/moderation-words";
import { ItemLines } from "./ItemLines";

/**
 * Where a notice stands (3c design, section 9): its reference, when korbat received it, and each item with its outcome
 * once released. The contact's part shows only when the page was opened from a mail's link: the answer then carries
 * whether the address is confirmed or stopped, and the page offers "I sent this" and "stop", each a button that posts with
 * the same token, never a link that acts when it is merely opened. A stopped address reads so, with the one button that
 * undoes it. Opened from the link shown on screen, the answer says neither, and the page shows no contact buttons.
 */
export function NoticeStatusView({ status, onContact, busy = false, error = null }: { status: NoticeStatus; onContact?: (choice: "confirm" | "stop") => void; busy?: boolean; error?: string | null }) {
  const contact = status.contact !== null && status.contact.confirmed !== null && status.contact.stopped !== null ? status.contact : null;
  return (
    <View>
      <Title>{STATUS_WORDS.title}</Title>
      <Body>{STATUS_WORDS.reference(status.ref)}</Body>
      <Body>{STATUS_WORDS.received(utcMinute(status.receivedAt))}</Body>
      <ItemLines items={status.items} />
      {contact ? (
        <View className="mt-8">
          <Text accessibilityRole="header" aria-level={2} className="text-lg font-semibold text-zinc-100">
            {STATUS_WORDS.contact}
          </Text>
          {contact.stopped ? (
            <>
              <Body>{STATUS_WORDS.stopped}</Body>
              <Button label={STATUS_WORDS.undo} onPress={() => onContact?.("confirm")} busy={busy} tone="secondary" />
            </>
          ) : (
            <>
              <Body>{contact.confirmed ? STATUS_WORDS.confirmed : STATUS_WORDS.unconfirmed}</Body>
              <Button label={STATUS_WORDS.confirm} onPress={() => onContact?.("confirm")} busy={busy} tone="secondary" />
              <Button label={STATUS_WORDS.stop} onPress={() => onContact?.("stop")} busy={busy} tone="secondary" />
              <Text className="mt-2 text-sm leading-5 text-zinc-400">{STATUS_WORDS.stopHint}</Text>
            </>
          )}
          <ErrorText message={error} />
        </View>
      ) : null}
      <TextLink label="Back to korbat" href="/" replace />
    </View>
  );
}

/** One sentence for a wrong reference and a wrong token alike: the page never says which was wrong. */
export function NoticeNotFound() {
  return (
    <View>
      <Title>{STATUS_WORDS.title}</Title>
      <Text accessibilityRole="alert" className="mt-4 text-base text-zinc-200">
        {messageFor("notice_not_found")}
      </Text>
      <TextLink label="Back to korbat" href="/" replace />
    </View>
  );
}
```

### Create `apps/app/src/components/moderation/ReportForm.tsx`

```tsx
import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { NOTICE_LIMITS, REPORT_RULE_IDS, TDB_FORM_CATEGORIES, type CsamKeywordChoice, type NoticeResponse, type ReportRuleId } from "@korbat/contracts";
import { RULES } from "@korbat/rules";
import { Body, Button, ErrorText, Field, TextButton, TextLink, Title } from "@/components/ui";
import { ApiError } from "@/lib/api";
import {
  EMPTY_DRAFT,
  OTHER_LINKS_MAX,
  moderation,
  noticeFrom,
  profileOnly,
  reportFailure,
  ruleLine,
  statusLink,
  tooManyProfiles,
  type GivenTarget,
  type Ground,
  type NoticeCategoryChoice,
  type ReportDraft,
} from "@/lib/moderation";
import { CATEGORY_LABELS, REPORT_WORDS } from "@/lib/moderation-words";

const SITE_KEY = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY ?? "";

/** One entry of a list of choices: a choice with its label and an optional line under it, or a line of text that stands in a choice's place. */
type ChoiceEntry<T extends string> = { value: T; label: string; hint?: string } | { note: string };

/**
 * One question with its answers, of which one is chosen: a radio group, each answer a radio that says whether it is
 * checked. Every answer has the same weight on the page; a note among them is plain text and no control.
 */
function Choice<T extends string>({ label, entries, value, onChange }: { label: string; entries: ChoiceEntry<T>[]; value: T | null; onChange: (value: T) => void }) {
  return (
    <View accessibilityRole="radiogroup" aria-label={label} className="mt-6">
      <Text className="text-sm font-medium text-zinc-300">{label}</Text>
      {entries.map((entry) =>
        "note" in entry ? (
          <Text key={entry.note} className="mt-2 rounded-lg border border-dashed border-zinc-700 px-4 py-3 text-sm leading-5 text-zinc-400">
            {entry.note}
          </Text>
        ) : (
          <Pressable
            key={entry.value}
            accessibilityRole="radio"
            aria-checked={value === entry.value}
            onPress={() => onChange(entry.value)}
            className={`mt-2 rounded-lg border px-4 py-3 ${value === entry.value ? "border-zinc-50 bg-zinc-900" : "border-zinc-700"}`}
          >
            <Text className={`text-base ${value === entry.value ? "font-semibold text-zinc-50" : "text-zinc-200"}`}>{entry.label}</Text>
            {entry.hint ? <Text className="mt-1 text-sm leading-5 text-zinc-400">{entry.hint}</Text> : null}
          </Pressable>
        ),
      )}
    </View>
  );
}

/** A statement the person may tick: a checkbox that says whether it is checked. */
function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <Pressable accessibilityRole="checkbox" aria-checked={checked} onPress={() => onChange(!checked)} className="mt-6 flex-row items-start gap-3">
      <View className={`mt-0.5 h-5 w-5 items-center justify-center rounded border ${checked ? "border-zinc-50 bg-zinc-50" : "border-zinc-500"}`}>
        {checked ? <Text className="text-xs font-bold text-zinc-950">x</Text> : null}
      </View>
      <Text className="flex-1 text-base leading-6 text-zinc-200">{label}</Text>
    </Pressable>
  );
}

const Hint = ({ children }: { children: string }) => <Text className="mt-2 text-sm leading-5 text-zinc-400">{children}</Text>;

/** The rules a report may cite, each with its title and one line; R2 is no choice: in its place stands the pointer to the anonymous path. */
function ruleEntries(withPointer: boolean): ChoiceEntry<ReportRuleId>[] {
  const reportable: readonly string[] = REPORT_RULE_IDS;
  return RULES.flatMap((rule): ChoiceEntry<ReportRuleId>[] => {
    if (reportable.includes(rule.id)) return [{ value: rule.id as ReportRuleId, label: `${rule.id}: ${rule.title}`, hint: ruleLine(rule) }];
    return withPointer ? [{ note: REPORT_WORDS.r2Instead }] : [];
  });
}

const GROUNDS: ChoiceEntry<Ground>[] = [
  { value: "rule", label: REPORT_WORDS.grounds.rule },
  { value: "illegal", label: REPORT_WORDS.grounds.illegal },
  { value: "csam", label: REPORT_WORDS.grounds.csam },
];
const CATEGORIES: ChoiceEntry<NoticeCategoryChoice>[] = [
  { value: "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE", label: REPORT_WORDS.categoryNotSure },
  ...TDB_FORM_CATEGORIES.map((category) => ({ value: category, label: CATEGORY_LABELS[category] })),
];
const KEYWORDS: ChoiceEntry<CsamKeywordChoice>[] = (Object.keys(REPORT_WORDS.keywords) as CsamKeywordChoice[]).map((keyword) => ({ value: keyword, label: REPORT_WORDS.keywords[keyword] }));
/** The illegal ground's optional rule: none, or one of the rules a report may cite. */
const NO_RULE = "none";

/** What the form was opened on, as a link to it; a form opened without an item asks for its link instead. */
function GivenItem({ given }: { given: GivenTarget }) {
  const [href, label] = given.kind === "post" ? [`/post/${given.id}`, given.mediaId ? REPORT_WORDS.itemImage : REPORT_WORDS.itemPost] : [`/u/${given.handle}`, REPORT_WORDS.itemProfile(given.handle)];
  return (
    <View className="mt-6">
      <Text className="text-sm font-medium text-zinc-300">{REPORT_WORDS.item}</Text>
      <Link href={href} asChild>
        <Pressable className="mt-2 self-start">
          <Text className="text-base text-sky-400 underline">{label}</Text>
        </Pressable>
      </Link>
    </View>
  );
}

/**
 * The report form (3c design, section 9): what is wrong, with three grounds of equal weight, then what that ground
 * needs. It builds the request from what is filled in (noticeFrom), says what is still missing in place of sending, and
 * shows the answer's screen once korbat took the report. `given` is the post, image or profile "Report" was pressed on,
 * or null for a form opened on its own, which asks for the link. Signed out, every ground needs the human check.
 * `initial` is what a test starts the form with.
 */
export function ReportForm({ signedIn, given, initial }: { signedIn: boolean; given: GivenTarget | null; initial?: Partial<ReportDraft> }) {
  const turnstile = useRef<TurnstileInstance | null>(null);
  const [draft, setDraft] = useState<ReportDraft>({ ...EMPTY_DRAFT, ...initial });
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<NoticeResponse | null>(null);
  const set = (patch: Partial<ReportDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const built = noticeFrom(draft, given, { signedIn, turnstileToken: token });
  const anonymous = draft.ground === "csam";

  async function send() {
    if (busy || !("request" in built)) return;
    setBusy(true);
    setError(null);
    try {
      const answer = await moderation.send(built.request);
      setSent(answer);
    } catch (err) {
      setError(reportFailure(err, draft.ground === "csam"));
      // A token of the human check is good for one request: the next try needs a fresh one.
      turnstile.current?.reset();
      setToken(null);
    } finally {
      setBusy(false);
    }
  }

  if (sent) return <ReportSent answer={sent} signedIn={signedIn} origin={(globalThis as { location?: { origin?: string } }).location?.origin ?? ""} />;

  const setOther = (index: number, url: string) => set({ others: draft.others.map((other, at) => (at === index ? url : other)) });
  return (
    <View>
      <Title>{REPORT_WORDS.title}</Title>
      {given ? <GivenItem given={given} /> : <Field label={REPORT_WORDS.link} autoCapitalize="none" inputMode="url" value={draft.link} onChangeText={(link) => set({ link })} />}

      <Choice label={REPORT_WORDS.question} entries={GROUNDS} value={draft.ground} onChange={(ground) => set({ ground })} />

      {draft.ground === "rule" ? (
        <>
          <Choice label={REPORT_WORDS.whichRule} entries={ruleEntries(true)} value={draft.ruleId} onChange={(ruleId) => set({ ruleId })} />
          <Field label={REPORT_WORDS.explanation} multiline numberOfLines={4} maxLength={NOTICE_LIMITS.explanationMax} value={draft.explanation} onChangeText={(explanation) => set({ explanation })} />
        </>
      ) : null}

      {draft.ground === "illegal" ? (
        <>
          <Choice label={REPORT_WORDS.category} entries={CATEGORIES} value={draft.category} onChange={(category) => set({ category })} />
          <Hint>{REPORT_WORDS.csamInstead}</Hint>
          <Field label={REPORT_WORDS.citedLaw} maxLength={NOTICE_LIMITS.citedLawMax} value={draft.citedLaw} onChangeText={(citedLaw) => set({ citedLaw })} />
          <Field label={REPORT_WORDS.whyIllegal} multiline numberOfLines={4} maxLength={NOTICE_LIMITS.explanationMax} value={draft.explanation} onChangeText={(explanation) => set({ explanation })} />
          <Choice
            label={REPORT_WORDS.alsoRule}
            entries={[{ value: NO_RULE, label: REPORT_WORDS.noRule }, ...ruleEntries(false)]}
            value={draft.ruleId ?? NO_RULE}
            onChange={(ruleId) => set({ ruleId: ruleId === NO_RULE ? null : (ruleId as ReportRuleId) })}
          />
          <Check label={REPORT_WORDS.bonaFide} checked={draft.bonaFide} onChange={(bonaFide) => set({ bonaFide })} />
          {signedIn ? null : (
            <>
              <Field label={REPORT_WORDS.name} autoComplete="name" value={draft.name} onChangeText={(name) => set({ name })} />
              <Field label={REPORT_WORDS.email} autoComplete="email" autoCapitalize="none" inputMode="email" value={draft.email} onChangeText={(email) => set({ email })} />
              <Hint>{REPORT_WORDS.contactHint}</Hint>
            </>
          )}
        </>
      ) : null}

      {draft.ground === "csam" ? (
        <>
          <Choice label={REPORT_WORDS.which} entries={KEYWORDS} value={draft.keyword} onChange={(keyword) => set({ keyword })} />
          {profileOnly(draft, given) ? <Hint>{REPORT_WORDS.profileOnly}</Hint> : null}
          <Field label={REPORT_WORDS.csamExplanation} multiline numberOfLines={4} maxLength={NOTICE_LIMITS.explanationMax} value={draft.explanation} onChangeText={(explanation) => set({ explanation })} />
          <Check label={REPORT_WORDS.bonaFide} checked={draft.bonaFide} onChange={(bonaFide) => set({ bonaFide })} />
          <Hint>{REPORT_WORDS.anonymous}</Hint>
        </>
      ) : null}

      <View className="mt-8">
        <Text accessibilityRole="header" aria-level={2} className="text-base font-semibold text-zinc-100">
          {REPORT_WORDS.otherItems}
        </Text>
        <Hint>{REPORT_WORDS.otherItemsHint}</Hint>
        {draft.others.map((other, index) => (
          <View key={index}>
            <Field label={REPORT_WORDS.otherLink(index + 1)} autoCapitalize="none" inputMode="url" value={other} onChangeText={(url) => setOther(index, url)} />
            <Pressable accessibilityRole="button" accessibilityLabel={`${REPORT_WORDS.removeLink}: ${REPORT_WORDS.otherLink(index + 1)}`} onPress={() => set({ others: draft.others.filter((_, at) => at !== index) })} className="mt-2 self-start">
              <Text className="text-sm text-zinc-400 underline">{REPORT_WORDS.removeLink}</Text>
            </Pressable>
          </View>
        ))}
        {draft.others.length < OTHER_LINKS_MAX ? <TextButton label={REPORT_WORDS.addLink} onPress={() => set({ others: [...draft.others, ""] })} /> : null}
        {/* Said before anything is sent: the anonymous path's one report reaches every image of the profile it names. */}
        {tooManyProfiles(draft, given) ? <ErrorText message={REPORT_WORDS.oneProfile} /> : null}
      </View>

      <Text className="mt-8 text-sm leading-5 text-zinc-400">
        {/* Who sees the sender is not said on the anonymous path, which records none. */}
        {[REPORT_WORDS.privacy.use, ...(anonymous ? [] : [REPORT_WORDS.privacy.sender]), REPORT_WORDS.privacy.access].join(" ")}
      </Text>
      {signedIn ? null : (
        <View className="mt-6">
          <Turnstile
            ref={turnstile}
            siteKey={SITE_KEY}
            options={{ theme: "dark", refreshExpired: "manual" }}
            onSuccess={setToken}
            onExpire={() => {
              setToken(null);
              turnstile.current?.reset();
            }}
            onError={() => setError(reportFailure(new ApiError(403, "human_check_failed", ""), anonymous))}
          />
          <Hint>{REPORT_WORDS.turnstile}</Hint>
        </View>
      )}

      <ErrorText message={error} />
      {/* What is still missing, in place of a button that silently does nothing; the one-profile sentence stands above already. */}
      {"problem" in built && built.problem !== REPORT_WORDS.oneProfile ? <Hint>{built.problem}</Hint> : null}
      <Button label={REPORT_WORDS.send} onPress={() => void send()} busy={busy} disabled={!("request" in built)} />
      <TextLink label="Back to korbat" href="/" replace />
    </View>
  );
}

/**
 * What the form shows once korbat took the report: its reference and how to follow it. A report sent signed out, or on
 * the anonymous path, is followed with a link that is shown only now, its token in the fragment, which no server is sent;
 * a signed-in report on a rule or on the law is in the account's own list. The answer carries a token exactly in the
 * first case, so the token decides.
 */
export function ReportSent({ answer, signedIn, origin }: { answer: { ref: string; token?: string }; signedIn: boolean; origin: string }) {
  const [copied, setCopied] = useState(false);
  const link = answer.token ? statusLink(origin, answer.ref, answer.token) : null;

  async function copy() {
    if (!link) return;
    const clipboard = (globalThis as { navigator?: { clipboard?: { writeText(text: string): Promise<void> } } }).navigator?.clipboard;
    try {
      await clipboard?.writeText(link);
      setCopied(clipboard !== undefined);
    } catch {
      // The browser refused the clipboard: the link stays on screen to be selected.
      setCopied(false);
    }
  }

  return (
    <View>
      <Title>{REPORT_WORDS.sent}</Title>
      <Body>{REPORT_WORDS.reference(answer.ref)}</Body>
      {link ? (
        <>
          <Body>{REPORT_WORDS.keepLink}</Body>
          <Text selectable className="mt-4 rounded-lg bg-zinc-900 px-4 py-3 text-sm text-zinc-100">
            {link}
          </Text>
          <Button label={copied ? REPORT_WORDS.copied : REPORT_WORDS.copy} onPress={() => void copy()} tone="secondary" />
        </>
      ) : signedIn ? (
        <>
          <Body>{REPORT_WORDS.followInSettings}</Body>
          <TextLink label={REPORT_WORDS.yourReports} href="/settings/cases?tab=reports" />
        </>
      ) : null}
      <TextLink label="Back to korbat" href="/" replace />
    </View>
  );
}
```

### Create `apps/app/src/lib/moderation-words.ts`

```ts
import { CSAM_NOTICE_MAX_ACCOUNTS, NOTICE_LIMITS, type CsamKeywordChoice, type TdbFormCategory } from "@korbat/contracts";

/**
 * The app's words for reports, notices and moderation cases (3c design, section 9): the report form, the notice status
 * page, the cases screens, the chips and the labels. Each sentence is written here once and the screens take it from
 * here; the words of an outcome, of a statement and of a rule are not here at all: they come from @korbat/contracts and
 * @korbat/rules, which the mails and the staff console use too, so the app can never word them differently.
 */

/** A small count as a word, as the form's sentences print the limits; a larger one as digits. */
export function numberWord(count: number): string {
  return ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][count] ?? String(count);
}

const PROFILE_LIMIT = `${numberWord(CSAM_NOTICE_MAX_ACCOUNTS)} ${CSAM_NOTICE_MAX_ACCOUNTS === 1 ? "profile" : "profiles"}`;

/** What follows every sentence that offers the contact address in place of the form. */
const MAIL_INSTEAD = (contact: string) => `email your report to ${contact} with the korbat links of what you report and why. Do not attach images or files: korbat does not open them.`;

export const REPORT_WORDS = {
  control: "Report",
  imageControl: "Report this image",
  title: "Report to korbat",
  question: "What is wrong with it?",
  /** The three grounds, of equal weight and in this order. */
  grounds: {
    rule: "It breaks a korbat rule",
    illegal: "It is illegal",
    csam: "It is sexual abuse or exploitation of a child, child sexual abuse material, or grooming of a child",
  },
  whichRule: "Which rule?",
  /** In the list of rules, in R2's place: such a report goes the third way. */
  r2Instead: "Child sexual abuse material: choose the third answer, which is anonymous.",
  explanation: "Anything the moderator should know",
  category: "What kind of illegal content is it?",
  categoryNotSure: "I am not sure",
  /** Directly below the categories. */
  csamInstead: "For the sexual abuse or exploitation of a child, child sexual abuse material or grooming, choose the third answer, which is anonymous.",
  citedLaw: "Which law or country (optional)",
  whyIllegal: "Why is it illegal?",
  alsoRule: "A korbat rule it also breaks (optional)",
  noRule: "None",
  which: "Which is it?",
  keywords: {
    csam: "Sexual images or videos of a child",
    deepfake: "Such images made or altered by software",
    grooming: "An adult seeking sexual contact with a child",
    abuse: "Other sexual abuse or exploitation of a child, such as offering a child for sex",
  } satisfies Record<CsamKeywordChoice, string>,
  csamExplanation: "Anything korbat should know (optional)",
  anonymous: "This report is anonymous: korbat does not record who sent it, not even your account. Keep the link we show you to follow it.",
  profileOnly: "If you can, report the post or the image itself: open it and choose Report. From a profile alone korbat cannot tell which image you mean, and its answer covers the images on all the profile's posts.",
  oneProfile: `On this path a report can name ${PROFILE_LIMIT}. Send another report for the next one.`,
  item: "What you report",
  itemPost: "This post",
  itemImage: "One image of this post",
  itemProfile: (handle: string) => `The profile @${handle}`,
  link: "Link to the post or profile on korbat",
  otherItems: "Other items",
  otherItemsHint: `You can add up to ${numberWord(NOTICE_LIMITS.maxTargets - 1)} more korbat links.`,
  otherLink: (n: number) => `Link ${n}`,
  addLink: "Add another link",
  removeLink: "Remove",
  bonaFide: "I believe in good faith that the information in this report is accurate and complete.",
  name: "Your name (optional)",
  email: "Your email (optional)",
  contactHint: "Without an email we cannot send you a receipt or our decision. korbat never shows your name or email to the person you report.",
  /** The privacy line's three sentences; the second is not shown on the anonymous path, which records no sender. */
  privacy: {
    use: "korbat uses what you send only to handle this report; how long it keeps it is in the terms.",
    sender: "Moderators see who sent a report only when a case needs it, for example when you report an account impersonating you; each time is recorded and shown to every staff member.",
    access: "If the person you report asks korbat for their data, the law may require korbat to give them what you wrote, never your name, email or account.",
  },
  turnstile: "Cloudflare Turnstile checks that you are not a bot; it sees your IP address and browser details for that check.",
  send: "Send report",
  /** What the form says in place of sending while something is missing. */
  missing: {
    ground: "Choose what is wrong with it.",
    rule: "Choose the rule it breaks.",
    keyword: "Choose which it is.",
    link: "Give the link to the post or profile on korbat.",
    linkInvalid: "A link must be a whole address that begins with http:// or https://.",
    whyIllegal: "Say why it is illegal.",
    bonaFide: "Confirm that you report in good faith.",
    human: "Wait for the check that you are not a bot.",
    details: "Some details are missing or invalid.",
  },
  sent: "Your report was received",
  reference: (ref: string) => `Its reference is ${ref}.`,
  keepLink: "Keep this link to follow your report or ask for a decision to be re-examined. It is shown only now.",
  copy: "Copy",
  copied: "Copied",
  followInSettings: "You can follow it under Settings, Cases, Your reports.",
  yourReports: "Your reports",
  /** The three failures the form words itself, each naming the users' contact address. */
  humanCheckFailed: (contact: string) => `The check that you are not a bot failed. Try again, or ${MAIL_INSTEAD(contact)}`,
  rateLimited: (wait: string, contact: string) =>
    `korbat cannot take another report from this network or account right now: it takes at most ${NOTICE_LIMITS.signedOut.perHour} reports an hour and ${NOTICE_LIMITS.signedOut.perDay} a day without an account, and ${NOTICE_LIMITS.signedIn.perHour} an hour and ${NOTICE_LIMITS.signedIn.perDay} a day with one. Try again in about ${wait}, or ${MAIL_INSTEAD(contact)}`,
  unavailable: (contact: string) => `korbat cannot take reports right now. Try again in a few minutes, or ${MAIL_INSTEAD(contact)}`,
  /** After each of the three on the anonymous path: a mail is not anonymous. */
  mailShowsAddress: "An email shows korbat your address. korbat deletes your email, and its reply to you, once your report is entered.",
} as const;

/** The Transparency Database's names for the categories the illegal ground offers. */
export const CATEGORY_LABELS: Record<TdbFormCategory, string> = {
  STATEMENT_CATEGORY_ANIMAL_WELFARE: "Animal welfare",
  STATEMENT_CATEGORY_CONSUMER_INFORMATION: "Consumer information infringements",
  STATEMENT_CATEGORY_CYBER_VIOLENCE: "Cyber violence",
  STATEMENT_CATEGORY_CYBER_VIOLENCE_AGAINST_WOMEN: "Cyber violence against women",
  STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS: "Data protection and privacy violations",
  STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH: "Illegal or harmful speech",
  STATEMENT_CATEGORY_INTELLECTUAL_PROPERTY_INFRINGEMENTS: "Intellectual property infringements",
  STATEMENT_CATEGORY_NEGATIVE_EFFECTS_ON_CIVIC_DISCOURSE_OR_ELECTIONS: "Negative effects on civic discourse or elections",
  STATEMENT_CATEGORY_PROTECTION_OF_MINORS: "Protection of minors",
  STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY: "Risk for public security",
  STATEMENT_CATEGORY_SCAMS_AND_FRAUD: "Scams and fraud",
  STATEMENT_CATEGORY_SELF_HARM: "Self-harm",
  STATEMENT_CATEGORY_UNSAFE_AND_PROHIBITED_PRODUCTS: "Unsafe, non-compliant or prohibited products",
  STATEMENT_CATEGORY_VIOLENCE: "Violence",
};

const OUTSIDE_KORBAT = "go to court, or complain to the Digital Services Coordinator of the EU country where you live.";

export const STATUS_WORDS = {
  title: "Your report",
  reference: (ref: string) => `Reference ${ref}`,
  received: (time: string) => `Received on ${time}.`,
  item: (n: number) => `Item ${n}`,
  /** The heading of an item korbat added for the post a named post quotes. */
  added: (n: number, link: string) => `The post that item ${n} quotes (${link}), added by korbat`,
  waiting: "Not decided yet.",
  decided: (day: string) => `Decided on ${day}:`,
  reexaminationLabel: "Re-examination",
  /** Beside an item whose answer can still be examined again: what that is, and until when. */
  reexaminationOpen: (until: string) => `A moderator decides it again as a new report. You can ask once for each item, within six months of being told, until ${until}.`,
  /** Beside an outcome a review or a correction changed, and a re-examination's answer. */
  final: `This is final within korbat. You can also ${OUTSIDE_KORBAT}`,
  /** Beside any other decided outcome that cannot be examined again. */
  courts: `You can ${OUTSIDE_KORBAT}`,
  contact: "Emails about this report",
  confirmed: "This address is confirmed as the sender's.",
  unconfirmed: "korbat has not been told yet whether this address sent the report.",
  confirm: "Yes, I sent this: keep me informed",
  stop: "I did not send this: stop korbat's report emails to this address",
  stopHint: "This also stops korbat's emails about reports you send yourself from this address, signed in or not, until you undo it on this page or, if a korbat account uses this address, under Settings, Cases, Your reports.",
  stopped: "korbat's report emails to this address are stopped.",
  undo: "Undo: email this address about reports again",
  retry: "Try again",
} as const;

export const CASES_WORDS = {
  nav: "Cases",
  title: "Cases",
  tabs: { about: "About you", reports: "Your reports" },
  noDecisions: "korbat has made no decision about your posts or your profile.",
  noReports: "You have sent no reports.",
  post: (time: string) => `Your post of ${time}`,
  profile: "Your profile",
  law: "the law",
  rule: (id: string) => `Rule ${id}`,
  decidedOn: (day: string) => `Decided on ${day}`,
  whileDeciding: "while korbat decides",
  ended: "What korbat did while deciding has ended",
  noAction: "No action",
  review: "the answer to your appeal",
  correction: "a correction by korbat",
  appealOpen: (until: string) => `You can appeal until ${until}`,
  reversed: (day: string) => `Reversed in full on ${day}`,
  more: "Show more",
  report: (ref: string, time: string) => `Report ${ref}, sent on ${time}`,
  mailStopped: "korbat does not email you about your reports, because someone using your email address asked it to stop. Their outcomes are listed here.",
  resume: "Email me about my reports again",
  resumeHint: "korbat may then also email this address about reports sent without an account that give it.",
} as const;

export const DECISION_WORDS = {
  title: "korbat's decision",
  back: "All cases",
  statement: "Statement of reasons",
  content: "What this decision was made on",
  post: (time: string) => `Your post of ${time}`,
  noText: "The post had no text.",
  displayName: "Display name",
  bio: "Bio",
  handle: "Handle",
  empty: "(empty)",
  r4Redacted: "Content erased when the R4 decision became final",
  erased: (day: string) => `korbat's copy of the content this decision was made on was erased on ${day} under its retention rules (Terms, Your data).`,
  postKept: "The post itself stays in your profile while you keep it.",
  deleted: "You deleted this post. korbat keeps this copy for the case for the periods in its terms.",
  deletedImages: "Images kept for the case, not shown",
  resetDecision: "The decision that reset it",
  appeal: "Appeal",
  appealUntil: (until: string) => `You can appeal this decision until ${until}.`,
  reversed: (day: string) => `Reversed in full on ${day}: nothing of this decision is in force, so there is nothing to appeal.`,
  notFound: "That decision does not exist, or it is not about your account.",
  /** A statement is never rendered with another version of the rules than the one it was made under. */
  cannotRender: "This decision was made under a version of the rules this page does not hold yet. Reload the page to read it.",
} as const;

/** The chip on the author's own withheld or removed post, and the labels on their own images. */
export const CHIP_WORDS = {
  underReview: "Under review",
  removed: "Removed",
  illegal: "illegal content",
} as const;

/** The terms page's Contact section, built from the build's contact address; it is not part of the terms' own sections. */
export const CONTACT_WORDS = {
  title: "Contact",
  body: (contact: string) => `Write to korbat at ${contact} when the report form does not work for you, to ask for your data, or about a decision. A person reads every email. Do not attach images or files: korbat does not open them.`,
  report: "Report something on korbat",
} as const;
```

### Create `apps/app/src/lib/moderation.ts`

```ts
import {
  AuthorCasesPage,
  CSAM_NOTICE_MAX_ACCOUNTS,
  DecisionView,
  NOTICE_LIMITS,
  NoticeRequest,
  NoticeResponse,
  NoticeStatus,
  NoticeTarget,
  ReportsPage,
  type CsamKeywordChoice,
  type NoticeItemStatus,
  type PostModeration,
  type ReportRuleId,
  type TdbFormCategory,
} from "@korbat/contracts";
import type { Rule } from "@korbat/rules";
import { api, ApiError, errorMessage } from "./api";
import { CHIP_WORDS, REPORT_WORDS } from "./moderation-words";

/**
 * Reports, notices and moderation cases in the app (3c design, section 9): the calls, and the rules the screens share.
 * Everything that decides is a plain function here, so a test can call it: what a report's address carries, what the
 * form sends, which sentence a failure gets, and what stands beside an item's outcome.
 */

/**
 * The users' contact address, which Expo inlines into the web bundle at export time (WEB_CONTACT_EMAIL in infra/.env; the
 * web image refuses to build without one). The report form names it when the form itself cannot be used, and the terms
 * page shows it.
 */
export const CONTACT_EMAIL = process.env.EXPO_PUBLIC_CONTACT_EMAIL ?? "";

const query = (cursor?: string) => (cursor ? `?cursor=${encodeURIComponent(cursor)}` : "");

/** The moderation endpoints the app calls, typed by the shared contracts. Cookies and CSRF are handled by `api`. */
export const moderation = {
  /** One report or notice. Signed out it carries the human check's token; the answer's token is shown once. */
  send: (request: NoticeRequest) => api("/api/notices", { json: request, schema: NoticeResponse }),
  /** Where a notice stands. The token travels in the body of a POST, never in an address. */
  status: (ref: string, token: string) => api("/api/notices/status", { json: { ref, token }, schema: NoticeStatus }),
  /** The status page's buttons, for which only the token of a mail's link works. */
  contact: (ref: string, token: string, choice: "confirm" | "stop") => api("/api/notices/contact", { json: { ref, token, choice } }),
  cases: (cursor?: string) => api(`/api/moderation/cases${query(cursor)}`, { schema: AuthorCasesPage }),
  decision: (id: string) => api(`/api/moderation/decisions/${encodeURIComponent(id)}`, { schema: DecisionView }),
  reports: (cursor?: string) => api(`/api/moderation/reports${query(cursor)}`, { schema: ReportsPage }),
  resumeReportMail: () => api("/api/moderation/report-mail/resume", { method: "POST" }),
};

// ---------------------------------------------------------------- what a report is opened on

/** A post, optionally with the one of its images that is meant, or a profile: what "Report" was pressed on. */
export type GivenTarget = Extract<NoticeTarget, { kind: "post" | "account" }>;

/** The report form's address: on its own, or opened on a post, on one image of a post, or on a profile. */
export function reportHref(on?: { post: string; media?: string } | { account: string }): string {
  if (!on) return "/report";
  if ("account" in on) return `/report?account=${encodeURIComponent(on.account)}`;
  return `/report?post=${encodeURIComponent(on.post)}${on.media ? `&media=${encodeURIComponent(on.media)}` : ""}`;
}

const one = (value: unknown): string | undefined => (typeof value === "string" && value.length > 0 ? value : undefined);

/** What the form's address names, or null when it names nothing the API would take: the form then asks for a link. */
export function givenTarget(params: { post?: unknown; media?: unknown; account?: unknown }): GivenTarget | null {
  const [post, media, account] = [one(params.post), one(params.media), one(params.account)];
  const parsed = post !== undefined ? NoticeTarget.safeParse({ kind: "post", id: post, ...(media !== undefined ? { mediaId: media } : {}) }) : account !== undefined ? NoticeTarget.safeParse({ kind: "account", handle: account }) : null;
  return parsed?.success && parsed.data.kind !== "link" ? parsed.data : null;
}

// ---------------------------------------------------------------- the form

export type Ground = "rule" | "illegal" | "csam";

/** The category of an illegal-ground notice: one of the 14 the form shows, or "not specified" for someone who is not sure. */
export type NoticeCategoryChoice = TdbFormCategory | "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE";

/** What the person has filled in so far. */
export interface ReportDraft {
  ground: Ground | null;
  /** The rule of the rule ground; on the illegal ground, a rule it also breaks. */
  ruleId: ReportRuleId | null;
  explanation: string;
  category: NoticeCategoryChoice;
  citedLaw: string;
  bonaFide: boolean;
  keyword: CsamKeywordChoice | null;
  name: string;
  email: string;
  /** The item's link, when the form was opened without an item. */
  link: string;
  /** Up to nine more korbat links. */
  others: string[];
}

export const EMPTY_DRAFT: ReportDraft = {
  ground: null,
  ruleId: null,
  explanation: "",
  category: "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE",
  citedLaw: "",
  bonaFide: false,
  keyword: null,
  name: "",
  email: "",
  link: "",
  others: [],
};

/** How many more links "Other items" takes. */
export const OTHER_LINKS_MAX = NOTICE_LIMITS.maxTargets - 1;

/** What the draft names, in order: the item the form was opened on or its link, then the other links that hold something. */
export function draftTargets(draft: ReportDraft, given: GivenTarget | null): NoticeTarget[] {
  const links = [...(given ? [] : [draft.link]), ...draft.others].map((url) => url.trim()).filter((url) => url.length > 0);
  return [...(given ? [given] : []), ...links.map((url) => ({ kind: "link" as const, url }))];
}

/** The handle a target names when it is a profile: an account, or a link to /u/<handle>. Null for anything else. */
function profileOf(target: NoticeTarget): string | null {
  if (target.kind === "account") return target.handle.toLowerCase();
  if (target.kind !== "link") return null;
  try {
    const match = /^[/]u[/]@?([A-Za-z0-9_]{3,20})[/]?$/.exec(new URL(target.url).pathname);
    return match ? match[1]!.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** How many different profiles the targets name. */
export function profilesNamed(targets: readonly NoticeTarget[]): number {
  return new Set(targets.map(profileOf).filter((handle) => handle !== null)).size;
}

/**
 * Whether the form asks for the post or the image itself: on the anonymous path, for images, when the only item is a
 * profile. From a profile alone korbat cannot tell which image is meant. The form says so and never refuses the profile.
 */
export function profileOnly(draft: ReportDraft, given: GivenTarget | null): boolean {
  const targets = draftTargets(draft, given);
  return draft.ground === "csam" && (draft.keyword === "csam" || draft.keyword === "deepfake") && targets.length === 1 && profileOf(targets[0]!) !== null;
}

/** Whether the anonymous path's report names more profiles than one report may: the form says so before anything is sent. */
export function tooManyProfiles(draft: ReportDraft, given: GivenTarget | null): boolean {
  return draft.ground === "csam" && profilesNamed(draftTargets(draft, given)) > CSAM_NOTICE_MAX_ACCOUNTS;
}

const text = (value: string): string | undefined => (value.trim().length > 0 ? value.trim() : undefined);

/**
 * The request the draft makes, or the sentence that says what is still missing. A signed-out sender needs the human
 * check's token on every ground; a name and an address are sent only signed out and only on the illegal ground, since a
 * signed-in sender's contact is their account and the anonymous path asks for neither.
 */
export function noticeFrom(draft: ReportDraft, given: GivenTarget | null, sender: { signedIn: boolean; turnstileToken: string | null }): { request: NoticeRequest } | { problem: string } {
  const missing = REPORT_WORDS.missing;
  if (draft.ground === null) return { problem: missing.ground };
  const targets = draftTargets(draft, given);
  if (targets.length === 0) return { problem: missing.link };
  if (targets.some((target) => target.kind === "link" && !/^https?:[/][/]/i.test(target.url))) return { problem: missing.linkInvalid };
  const human = sender.signedIn ? {} : { turnstileToken: sender.turnstileToken ?? undefined };
  const explanation = text(draft.explanation);
  let request: unknown;
  if (draft.ground === "rule") {
    if (draft.ruleId === null) return { problem: missing.rule };
    request = { ground: "rule", ruleId: draft.ruleId, targets, ...(explanation ? { explanation } : {}), ...human };
  } else if (draft.ground === "illegal") {
    if (!explanation) return { problem: missing.whyIllegal };
    if (!draft.bonaFide) return { problem: missing.bonaFide };
    const [citedLaw, name, email] = [text(draft.citedLaw), text(draft.name), text(draft.email)];
    request = {
      ground: "illegal",
      targets,
      category: draft.category,
      ...(citedLaw ? { citedLaw } : {}),
      explanation,
      bonaFide: true,
      ...(draft.ruleId ? { ruleId: draft.ruleId } : {}),
      ...(!sender.signedIn && name ? { name } : {}),
      ...(!sender.signedIn && email ? { email } : {}),
      ...human,
    };
  } else {
    if (draft.keyword === null) return { problem: missing.keyword };
    if (tooManyProfiles(draft, given)) return { problem: REPORT_WORDS.oneProfile };
    request = { ground: "csam", targets, keyword: draft.keyword, ...(explanation ? { explanation } : {}), ...(draft.bonaFide ? { bonaFide: true } : {}), ...human };
  }
  if (!sender.signedIn && !sender.turnstileToken) return { problem: missing.human };
  const parsed = NoticeRequest.safeParse(request);
  return parsed.success ? { request: parsed.data } : { problem: missing.details };
}

/** The first sentence of a rule's text: the one line the form shows under its title. */
export function ruleLine(rule: Pick<Rule, "text">): string {
  const end = rule.text.indexOf(". ");
  return end === -1 ? rule.text : rule.text.slice(0, end + 1);
}

/** A wait as the form words it, from the answer's Retry-After: in minutes under an hour, in hours otherwise. */
export function waitWords(seconds: number | undefined): string {
  if (seconds === undefined || seconds >= 3600) {
    const hours = seconds === undefined ? 1 : Math.ceil(seconds / 3600);
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

/**
 * What the form shows for a failed send. Three failures get the form's own words, which name the users' contact address,
 * since for each the form itself is what does not work: the human check, the limits and an API that cannot take reports.
 * On the anonymous path each is followed by what a mail gives away. Anything else is the server's message, as elsewhere.
 */
export function reportFailure(err: unknown, anonymous: boolean, contact: string = CONTACT_EMAIL): string {
  if (!(err instanceof ApiError)) return errorMessage(err);
  let words: string | null = null;
  if (err.code === "human_check_failed") words = REPORT_WORDS.humanCheckFailed(contact);
  if (err.code === "rate_limited") words = REPORT_WORDS.rateLimited(waitWords(err.retryAfter), contact);
  if (err.code === "service_unavailable") words = REPORT_WORDS.unavailable(contact);
  if (words === null) return errorMessage(err);
  return anonymous ? `${words} ${REPORT_WORDS.mailShowsAddress}` : words;
}

// ---------------------------------------------------------------- the status page

/** The status page's address for a notice, its token in the fragment, which no server is sent. */
export function statusLink(origin: string, ref: string, token: string): string {
  return `${origin}/notice/${ref}#t=${token}`;
}

/** The token a status page's address carries in its fragment, or null when the fragment holds none. */
export function fragmentToken(hash: string): string | null {
  return /^#t=([A-Za-z0-9_-]{43})$/.exec(hash)?.[1] ?? null;
}

/**
 * What stands beside one item on the status page and in Your reports (3c design, section 9, and the rule of 7.8 step 4):
 *   - `waiting`: nothing is released yet;
 *   - `final`: the outcome was changed on review or by a correction, or answers a re-examination: it is final within
 *     korbat. An answer given while nobody could open the post's images is never final: it leaves the re-examination
 *     unspent;
 *   - `reexamination`: the answer can still be examined again, until the item's date;
 *   - `courts`: any other decided outcome, which cannot be examined again.
 */
export function itemRedress(item: NoticeItemStatus): "waiting" | "final" | "reexamination" | "courts" {
  if (item.outcome === null) return "waiting";
  const unseenAnswer = item.unseen && (item.outcome === "no_violation" || item.outcome === "not_evident");
  if (item.changed || (item.reexamines && !unseenAnswer)) return "final";
  if (item.reexamination?.open) return "reexamination";
  return "courts";
}

// ---------------------------------------------------------------- chips and times

/** The chip of the author's own withheld or removed post: "Under review: R4", "Removed: illegal content". */
export function chipText(decision: PostModeration): string {
  const state = decision.interim ? CHIP_WORDS.underReview : CHIP_WORDS.removed;
  const ground = decision.legal ? CHIP_WORDS.illegal : decision.ruleId;
  return ground ? `${state}: ${ground}` : state;
}

/** A time as korbat's statements print it: the date and the minute in UTC. */
export function utcMinute(at: string): string {
  const iso = new Date(at).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}
```

### Replace `apps/api/src/index.ts` (whole file)

```ts
import { serve } from "@hono/node-server";
import Redis from "ioredis";
import { closeDb, createDb, ping } from "@korbat/db";
import { createAccount } from "./account";
import { createApp } from "./app";
import { createAuth, verificationProviderFrom } from "./auth";
import { loadConfig } from "./config";
import { redisJobLock } from "./lib/jobs";
import { createLogger } from "./lib/logger";
import { smtpMailer } from "./mail/smtp";
import { createMedia } from "./media";
import { RedisStore } from "./middleware/rate-limit";
import { createModeration } from "./moderation";
import { createProfileStore } from "./profiles/store";
import { createSocial, enforceWriteLimit, socialForModeration } from "./social";
import { createStaff } from "./staff";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL, config.NODE_ENV === "development");

const apiDb = createDb(config.DATABASE_URL_API);
const authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
redis.on("error", (err) => logger.error({ err }, "redis error"));
const rateLimitStore = new RedisStore(redis);

const auth = createAuth({
  config,
  logger,
  authDb,
  redis,
  mailer: smtpMailer(config.SMTP_URL, config.MAIL_FROM, { requireTls: config.NODE_ENV === "production" }),
  profiles: createProfileStore(apiDb),
  // Null when VERIFY_PROVIDER is off: the badge routes then answer badge_unavailable and the app hides the section.
  verify: verificationProviderFrom(config),
});

const media = createMedia({
  apiDb,
  uploadsDir: config.MEDIA_UPLOADS_DIR,
  storeDir: config.MEDIA_STORE_DIR,
  formats: config.MEDIA_FORMATS,
  minFreeBytes: config.MEDIA_MIN_FREE_BYTES,
  reconcile: config.MEDIA_RECONCILE,
  logger,
  requireSession: auth.requireSession,
  resolveSession: auth.resolveSession,
  rateLimitStore,
  enforceUploadLimit: (userId, accountCreatedAt, now) => enforceWriteLimit(rateLimitStore, userId, "upload", accountCreatedAt, now),
});
await media.prepare();
// Background work runs on one API instance at a time, under locks in Redis that are refreshed while a round runs.
const jobLock = redisJobLock(redis);
const stopSweeper = media.startSweeper(jobLock);
const stopJanitor = auth.startJanitor(jobLock);

// Moderation cases: the module owns its tables on the API's role and reaches the social module through an interface of
// that module's own, built over the same pool, the image rows through the media module's interface for cases, and a
// notifier's contact and every mail through the auth module's. Its limits count in the store the per-IP limit uses, and
// the routes of an account's own decisions and reports stand behind the auth module's session guard.
const moderation = createModeration({ apiDb, auth: auth.forModeration, social: socialForModeration(apiDb), media: media.forCases, requireSession: auth.requireSession, rateLimitStore, config, logger });
// The dispatch job: the staff alerts that are still due, the daily release of outcomes, and the mails that waited.
const stopModeration = moderation.startJobs(jobLock);

const social = createSocial({
  apiDb,
  rateLimitStore,
  logger,
  requireSession: auth.requireSession,
  requireFreshAuth: auth.requireFreshAuth(),
  media: media.forPosts,
  // The chip on the author's own withheld or removed post names its decision, which the moderation module reads.
  moderation: moderation.forSocial,
  // Profile and handle changes are security events; the social module hands them to the auth module, which owns the table.
  events: { append: auth.appendEvent },
});
// Explore's ranking: a round at once, so Explore is filled on a new database or after downtime, then one every five minutes.
const stopExplore = social.startExplore(jobLock);

// The account module owns no table: it reaches the three modules above only through the interfaces their index files export.
const account = createAccount({
  auth: auth.forAccount,
  social: social.forAccount,
  media: media.forAccount,
  requireSession: auth.requireSession,
  requireFreshAuth: auth.requireFreshAuth(),
  requireStrongFreshAuth: auth.requireStrongFreshAuth(),
  rateLimitStore,
  logger,
});
// Deletions the process did not finish (a crash after the auth step, a failed purge) are completed within five minutes.
const stopPurge = account.startPurge(jobLock);

// The staff console's API; createApp mounts it only while CONSOLE_ORIGIN is set. Its credential work is the auth module's,
// its case work the moderation module's.
const staff = createStaff({ apiDb, auth: auth.forStaff, moderation: moderation.forStaff });

const app = createApp({
  config,
  logger,
  rateLimitStore,
  healthChecks: {
    postgres_api: () => ping(apiDb),
    postgres_auth: () => ping(authDb),
    redis: async () => { await redis.ping(); },
  },
  advisoryChecks: { image_worker: media.healthCheck },
  auth,
  social,
  media,
  account,
  staff,
  moderation,
});

const server = serve({ fetch: app.fetch, port: config.PORT, hostname: "0.0.0.0" }, (info) => {
  logger.info({ port: info.port, version: config.KORBAT_VERSION }, "api listening");
});

/** How long the shutdown waits for the moderation module's tasks that a request started and did not wait for. */
const SETTLE_MS = 5_000;

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  stopSweeper();
  stopJanitor();
  stopExplore();
  stopPurge();
  stopModeration();
  server.close();
  // A statement, a receipt or a staff alert may be on its way to the relay: it gets five seconds to finish before the
  // pools close under it. What is still unsent then stays pending, and the dispatch job of the next start sends it.
  let waited: NodeJS.Timeout | undefined;
  const settled = await Promise.race([
    moderation.settle().then(() => true),
    new Promise<boolean>((resolve) => {
      waited = setTimeout(() => resolve(false), SETTLE_MS);
    }),
  ]);
  clearTimeout(waited);
  if (!settled) logger.warn({ signal }, "shutting down with moderation mails still in flight; what is pending is sent after the next start");
  await Promise.allSettled([closeDb(apiDb), closeDb(authDb), redis.quit()]);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
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
import type { CaseView, FindingRequest, FindingResponse, MediaSize, PostModeration, QueuePage, StaffOverview, StaffSnapshotTaken, StaffTextSaveRequest, StaffTextSaved, StaffTextsResponse } from "@korbat/contracts";
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
import { authorFacts } from "./author";
import { caseImage, openFinding, overview, queue, readCase, readDecidedCase, takeSnapshot } from "./cases";
import { createBackground, type ModerationDeps } from "./context";
import { decide, type DecideOutcome } from "./decide";
import { createDispatchJob } from "./dispatch";
import { reveal, type RevealOutcome } from "./reveal";
import { moderationRoutes, noSession } from "./routes";
import { ownTexts, saveText } from "./texts";

export { ModerationError } from "./context";
export type { ModerationDeps, ModerationErrorKind } from "./context";
export type { DecideOutcome } from "./decide";
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
  /** What every staff member's home screen shows: counts, times, staff handles and cases. */
  overview(): Promise<StaffOverview>;
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
    overview: () => overview(deps),
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
  return {
    deps,
    /**
     * The app's routes, mounted at /api: reports and notices, their status page and its contact buttons, and behind the
     * session guard the account's own decisions and reports.
     */
    routes: moderationRoutes(deps, options.requireSession ?? noSession),
    /** The interface the staff module uses. */
    forStaff,
    /** The interface the social module's views use. */
    forSocial,
    /**
     * Resolves once every task a request started and did not wait for has ended: the mails after a report, a notice, a
     * finding, a reveal or a refused case read. The tests await it; the server lets the tasks run.
     */
    settle: () => deps.background.settle(),
    /**
     * Starts the module's background work under the jobs' shared lock, on one API instance at a time: the dispatch job,
     * whose first round comes ten minutes after the start. Answers the function that stops it; a round in flight finishes.
     */
    startJobs: (lock: JobLock): (() => void) => createDispatchJob(deps, lock).start(),
  };
}

export type Moderation = ReturnType<typeof createModeration>;
```

### Replace `apps/api/src/moderation/intake.ts` (whole file)

```ts
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  CSAM_KEYWORDS,
  CSAM_NOTICE_MAX_ACCOUNTS,
  NOTICE_LIMITS,
  laneFor,
  snapshotDigest,
  type ItemOutcome,
  type Lane,
  type NoticeContactRequest,
  type NoticeItemStatus,
  type NoticeRequest,
  type NoticeResponse,
  type NoticeStatus,
  type NoticeStatusRequest,
  type RuleId,
  type TdbCategory,
} from "@korbat/contracts";
import type { DbTx } from "@korbat/db";
import { getRule } from "@korbat/rules";
import type { AccountMailResult, NotifierMailResult, Session } from "../auth";
import { isDeadlock, isLockNotAvailable } from "../lib/lock-bounds";
import { MailUnavailable } from "../mail/mailer";
import type { HoldPair } from "../media";
import type { CapturedPost, CapturedProfile } from "../social";
import { alertUrgentLane } from "./alerts";
import { ModerationError, type ModerationDeps } from "./context";
import { accountLink, parseLink, postLink } from "./links";
import {
  alreadyReported,
  insertIntake,
  insertItem,
  insertSnapshot,
  isSerializationFailure,
  latestSnapshot,
  noticeById,
  noticeByRef,
  noticeItems,
  openCase,
  recordReceipt,
  snapshotTime,
  targetKey,
  violatedUniqueConstraint,
  type NoticeItemRow,
  type NoticeRow,
  type ReceiptState,
} from "./repo";

/**
 * Taking in a report, a notice or a moderator's own finding (3c design, section 7.1): one intake, one item for each
 * target it names, each item in exactly one open case, and the first copy of each target as evidence. First the
 * transaction every intake runs (step 4); below it what a report or a notice passes before it and what follows its
 * commit (steps 1 to 3, 5 and 6), and the notifier's status page and contact (section 7.2).
 */

/** What an intake alleges and who sent it: the ground's columns of the intake's row. */
export interface IntakeGround {
  kind: "user" | "finding";
  channel: "signed_in" | "signed_out" | "staff";
  /** The signed-in reporter; never set on the path for child sexual abuse material, which records no sender. */
  reporterId: string | null;
  /** The staff account behind a finding. */
  findingBy: string | null;
  /** The id under which the auth module keeps a signed-out notifier's name and address. */
  contactId: string | null;
  ruleId: RuleId | null;
  allegesIllegal: boolean;
  csam: boolean;
  category: TdbCategory;
  categoryKeyword: string | null;
  citedLaw: string | null;
  explanation: string | null;
  bonaFide: boolean;
}

/** A target that is live: a post by its id, or an account by its id with the handle it was named by. `position` is its place among the targets named, from 1. */
export type LiveTarget =
  | { type: "post"; id: string; position: number; mediaId?: string | null }
  | { type: "account"; id: string; position: number; namedHandle: string };

/** A target with nothing live: a link to a post that names no row or a deleted one, or a handle that names no account. It is stored as answered at once. */
export type DeadTarget = { type: "post"; id: string; position: number } | { type: "account"; position: number; namedHandle: string };

export interface IntakeRequest {
  ground: IntakeGround;
  live: readonly LiveTarget[];
  dead?: readonly DeadTarget[];
}

export interface RecordedItem {
  id: string;
  position: number;
  targetType: "post" | "account";
  targetId: string;
  /** Null for a target with nothing live. */
  caseId: string | null;
  seq: number | null;
  lane: Lane;
}

export interface IntakeRecorded {
  intakeId: string;
  /** The public reference: N- and ten base32 characters. */
  ref: string;
  /** The notice's token, for a signed-out notice and for every notice on the CSAM path: shown once, and stored only as its sha256. */
  token: string | null;
  /** Whether the intake's items are suspect: it is on the CSAM path, or a finding citing R2. */
  suspect: boolean;
  items: RecordedItem[];
}

/** How often the transaction is run again after a case closed under it, a deadlock or a lock timeout: in each nothing was written. */
const RETRIES = 3;
/** How often one transaction asks for a target's open case before it starts over. */
const CASE_READS = 3;
/**
 * The longest the intake waits for a lock. A case's row is held by a decision for as long as that decision's
 * transaction runs, which for a seal over thousands of images is seconds; an intake that waited longer starts over.
 */
const LOCK_TIMEOUT_MS = 10_000;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** A fresh public reference: N- and ten base32 characters from 50 random bits. */
function newRef(): string {
  const bytes = randomBytes(7);
  // 48 bits and two more: 50 in all, which a JavaScript number holds exactly.
  const bits = bytes.readUIntBE(0, 6) * 4 + (bytes[6]! & 3);
  let ref = "";
  // 50 bits, five at a time from the top.
  for (let shift = 45; shift >= 0; shift -= 5) ref += BASE32[Math.floor(bits / 2 ** shift) % 32];
  return `N-${ref}`;
}

/** Whether an intake's items are suspect, as the attach trigger forces it: the CSAM path, or a finding citing R2. */
export const isSuspect = (ground: IntakeGround) => ground.csam || ground.ruleId === "R2";

/**
 * The live targets of a suspect intake with the items korbat adds: a post's card shows the images of the post it
 * quotes, so a report of child sexual abuse material about a post that quotes another is a report about both. Each
 * quoted post that the request does not name itself becomes a target of its own, at the position of the item it was
 * added for plus 10 (the lowest such position when several named posts quote it). One level only, as a card draws one
 * quote deep: an added target brings none of its own. Read outside any transaction; a post's quote never changes.
 */
export async function withAddedTargets(deps: Pick<ModerationDeps, "social">, live: readonly LiveTarget[]): Promise<LiveTarget[]> {
  const named = new Set(live.filter((target) => target.type === "post").map((target) => target.id));
  const added = new Map<string, number>();
  for (const target of live) {
    if (target.type !== "post" || target.position > 10) continue;
    const quoted = (await deps.social.postRef(target.id))?.quoteOfId;
    if (!quoted || named.has(quoted)) continue;
    added.set(quoted, Math.min(added.get(quoted) ?? target.position, target.position));
  }
  return [...live, ...[...added].map(([id, position]): LiveTarget => ({ type: "post", id, position: position + 10 }))];
}

/** Thrown inside the transaction to roll it back and run it again: the case a target was read into closed before the read found one. */
class StartOver extends Error {}

/** A case's targets in one order for every intake: by kind (posts before accounts, as the database orders the two) and then by id. */
const byTarget = (a: LiveTarget, b: LiveTarget) => (a.type !== b.type ? (a.type === "post" ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Stores one intake in one transaction, which changes nothing unless it commits. In this order:
 *   1. a signed-in reporter's profile row, FOR KEY SHARE, refusing a missing or deleted account;
 *   2. the intake's row, with a fresh reference and, for a signed-out or CSAM notice, the hash of a fresh token;
 *   3. for each live target, in the targets' order: its open case (opened when there is none) and then its item, which
 *      the attach trigger numbers into the case, so every intake takes its cases in one order and two notices that name
 *      the same targets never deadlock; only then the captures, posts in id order, each under a share lock on its post,
 *      so none holds a post while it waits for a case;
 *   4. one hold through the media module for the whole intake: the image rows of every post target, and for a suspect
 *      item about an account every image row on the account's posts, locked by one statement in one id order, with each
 *      post's case's evidence hold on its images; then a snapshot for each case that holds none yet, or, for an account,
 *      whose newest one differs from the account now, a post's listing the images the hold answered;
 *   5. for each target with nothing live, an item with no case, answered at once.
 * It is run again, up to three times, when an item's case closed in between (the attach trigger says so), on a deadlock
 * and on a lock timeout; when the last run fails the same way the answer is case_closed. A signed-in reporter who already
 * has an item on the same ground in a target's open case is answered already_reported.
 */
export async function recordIntake(deps: ModerationDeps, request: IntakeRequest): Promise<IntakeRecorded> {
  const suspect = isSuspect(request.ground);
  const live = suspect ? await withAddedTargets(deps, request.live) : [...request.live];
  for (let attempt = 0; ; attempt++) {
    try {
      return await deps.apiDb.transaction((tx) => recordIn(deps, tx, { ...request, live }, suspect));
    } catch (err) {
      const constraint = violatedUniqueConstraint(err);
      if (constraint === "intake_items_reporter_once") throw new ModerationError("already_reported");
      // A reference another intake already has: one in 2^50 for each pair. The next run draws a new one.
      const startOver = err instanceof StartOver || isSerializationFailure(err) || isDeadlock(err) || isLockNotAvailable(err) || constraint === "intakes_ref_unique";
      if (!startOver) throw err;
      if (attempt >= RETRIES) throw new ModerationError("case_closed");
    }
  }
}

async function recordIn(deps: ModerationDeps, tx: DbTx, request: IntakeRequest, suspect: boolean): Promise<IntakeRecorded> {
  const { ground } = request;
  await tx.execute(sql`select set_config('lock_timeout', ${`${LOCK_TIMEOUT_MS}ms`}::text, true)`);

  // 1.
  if (ground.reporterId !== null) await deps.social.lockAccounts(tx, [ground.reporterId], "key share", true);

  // 2. The token is stored only as its hash; the answer carries it once.
  const ref = newRef();
  const token = ground.channel === "signed_out" || ground.csam ? randomBytes(32).toString("base64url") : null;
  const intakeId = await insertIntake(tx, { ...ground, ref, lookupHash: token === null ? null : createHash("sha256").update(token).digest("hex") });
  const lane = laneFor({ ruleId: ground.ruleId, allegesIllegal: ground.allegesIllegal, csam: ground.csam, category: ground.category });

  // 3. First every case with its item, in the targets' order.
  const items: RecordedItem[] = [];
  const cases = new Map<LiveTarget, string>();
  for (const target of [...request.live].sort(byTarget)) {
    let caseId: string | null = null;
    for (let read = 0; read < CASE_READS && caseId === null; read++) caseId = await openCase(tx, target.type, target.id);
    // A live target's item is never stored without a case.
    if (caseId === null) throw new StartOver();
    cases.set(target, caseId);
    const item = await insertItem(tx, {
      intakeId,
      caseId,
      targetType: target.type,
      targetId: target.id,
      position: target.position,
      lane,
      mediaId: target.type === "post" ? (target.mediaId ?? null) : null,
      namedHandle: target.type === "account" ? target.namedHandle.toLowerCase() : null,
    });
    items.push({ id: item.id, position: target.position, targetType: target.type, targetId: target.id, caseId, seq: item.seq, lane });
  }

  // Then the captures: every post in id order under a share lock, and every account's fields. The time is the
  // transaction's start, which the snapshots' trigger stamps.
  const takenAt = await snapshotTime(tx);
  const posts = new Map<string, CapturedPost>();
  const profiles = new Map<string, CapturedProfile>();
  for (const target of cases.keys()) {
    if (target.type === "post") {
      const post = await deps.social.capturePost(tx, target.id);
      if (!post) throw new Error("a post that an intake names has no row");
      posts.set(target.id, post);
    } else {
      const profile = await deps.social.captureProfile(tx, target.id);
      if (!profile) throw new Error("an account that an intake names has no row");
      profiles.set(target.id, profile);
    }
  }

  // 4. One hold for the whole intake, after every capture, so that no image row is locked before the last post is. Each
  // post's case holds the post's images as evidence, on every ground alike. A suspect item about an account reaches every
  // image on the account's posts: the freeze keeps those from the item's commit on, without a hold, and the pair only locks
  // them, so that a delete racing this intake waits and then reads the committed item.
  const pairs: HoldPair[] = [];
  for (const [target, caseId] of cases) if (target.type === "post") pairs.push({ caseId, postId: target.id });
  for (const target of cases.keys()) if (target.type === "account" && suspect) pairs.push({ ownerId: target.id });
  const held = await deps.media.hold(tx, pairs);

  // Then the snapshots, each post's with the images the hold answered for it.
  for (const [target, caseId] of cases) {
    const before = await latestSnapshot(tx, caseId);
    if (target.type === "post") {
      const post = posts.get(target.id)!;
      if (before !== null) continue;
      await storeSnapshot(tx, takenAt, {
        caseId,
        targetType: "post",
        targetId: target.id,
        authorHandle: post.authorHandle,
        postState: post.state,
        postCreatedAt: post.createdAt.toISOString(),
        replyToId: post.replyToId,
        quoteOfId: post.quoteOfId,
        body: post.body,
        // The images as the media module read them under their row locks, in position order; an erased image's alt text
        // is not copied. An empty list means that the post had none, or that they were gone before this intake.
        media: held.get(target.id) ?? [],
        displayName: null,
        bio: null,
        handle: null,
      });
    } else {
      const profile = profiles.get(target.id)!;
      if (before !== null && before.displayName === profile.displayName && before.bio === profile.bio && before.handle === profile.handle) continue;
      await storeSnapshot(tx, takenAt, {
        caseId,
        targetType: "account",
        targetId: target.id,
        authorHandle: profile.handle,
        postState: null,
        postCreatedAt: null,
        replyToId: null,
        quoteOfId: null,
        body: null,
        media: null,
        displayName: profile.displayName,
        bio: profile.bio,
        handle: profile.handle,
      });
    }
  }

  // 5. An account's link that names nothing gets an id that names nothing either, whether or not a profile holds or once
  // held the handle: no stored id ties an old handle to its account.
  for (const target of request.dead ?? []) {
    const targetId = target.type === "post" ? target.id : randomUUID();
    const item = await insertItem(tx, {
      intakeId,
      caseId: null,
      targetType: target.type,
      targetId,
      position: target.position,
      lane,
      mediaId: null,
      namedHandle: target.type === "account" ? target.namedHandle.toLowerCase() : null,
    });
    items.push({ id: item.id, position: target.position, targetType: target.type, targetId, caseId: null, seq: null, lane });
  }
  items.sort((a, b) => a.position - b.position);
  return { intakeId, ref, token, suspect, items };
}

export type SnapshotContent = Omit<Parameters<typeof insertSnapshot>[1], "salt" | "digest">;

/**
 * One snapshot: a salt of the server's own, and the digest over the salt, the time and everything copied. The time in
 * the digest is the one the database stamps the row with; when the two differ the transaction is rolled back, since the
 * stored row would not recompute to its digest. Answers the snapshot's id and digest. The console's snapshot route
 * stores its snapshots through this too, so every snapshot is made one way.
 */
export async function storeSnapshot(tx: DbTx, takenAt: string, content: SnapshotContent): Promise<{ id: string; digest: string }> {
  const salt = randomBytes(32).toString("hex");
  const digest = await snapshotDigest({
    salt,
    targetType: content.targetType,
    targetId: content.targetId,
    takenAt,
    authorHandle: content.authorHandle,
    postState: content.postState,
    postCreatedAt: content.postCreatedAt,
    replyToId: content.replyToId,
    quoteOfId: content.quoteOfId,
    body: content.body,
    media: content.media,
    displayName: content.displayName,
    bio: content.bio,
    handle: content.handle,
  });
  const stored = await insertSnapshot(tx, { ...content, salt, digest });
  if (stored.takenAt !== takenAt) throw new Error("a snapshot was stamped at another time than its digest covers");
  return { id: stored.id, digest };
}

// ---------------------------------------------------------------- reports and notices: POST /api/notices

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

/** How often one network may read a notice's status or use its contact buttons in an hour; the two routes share the count. */
export const STATUS_READS_PER_HOUR = 30;

/** Who sends a report or a notice: the session of a signed-in sender, or none, and the keyed hash of the network the request came from. */
export interface NoticeSender {
  session: Pick<Session, "userId" | "role" | "onboarded"> | null;
  netHash: string;
}

/** A target as a report names it, once a link is parsed: a post by its id, or an account by a handle. */
export type NamedTarget = { type: "post"; id: string; mediaId: string | null } | { type: "account"; handle: string };

/**
 * Counts one event in a window of the shared limit store and refuses it once the window is used up. An event that
 * cannot be counted is refused too: the limits are what keeps one sender from flooding the queue.
 */
export async function countOrRefuse(deps: Pick<ModerationDeps, "limits">, key: string, windowMs: number, max: number): Promise<void> {
  let hit: { count: number; resetMs: number };
  try {
    hit = await deps.limits.hit(key, windowMs);
  } catch {
    throw new ModerationError("service_unavailable", 503, undefined, 30);
  }
  if (hit.count > max) throw new ModerationError("rate_limited", 429, undefined, Math.max(1, Math.ceil(hit.resetMs / 1000)));
}

/**
 * Which targets are live is one rule for every route (3c design, section 7.1, step 3), and it reads no image.
 *
 * For a suspect intake (a report of child sexual abuse material, or a finding citing R2) a target is live while its row
 * exists: a post in any state, one its author deleted or the purge blanked included, and an account whose profile row
 * exists, purged or not, also under a handle it has left, which the handle history keeps reserved for it. So no such
 * report about anything that exists is answered automatically: it waits for an admin, whatever is left of its target.
 *
 * For every other ground a post is live when it exists and its author has not deleted it, whatever its level, and an
 * account when a profile holds the named handle now and is not deleted: an old handle names nothing, and repeated
 * reports cannot keep content its author deleted, nor put deleted images before staff.
 *
 * Answers the target with its id, or null when it names nothing live.
 */
export async function liveTarget(deps: Pick<ModerationDeps, "social">, target: NamedTarget, suspect: boolean): Promise<{ type: "post" | "account"; id: string } | null> {
  if (target.type === "post") {
    const post = await deps.social.postRef(target.id);
    if (!post) return null;
    return suspect || post.state !== "deleted_by_author" ? { type: "post", id: target.id } : null;
  }
  const account = await deps.social.findAccountByHandle(target.handle, suspect);
  return account ? { type: "account", id: account.id } : null;
}

/** A notice's targets, resolved: the live ones and those with nothing live, numbered from 1 in the order the notice named them. */
export interface ResolvedTargets {
  live: LiveTarget[];
  dead: DeadTarget[];
}

/**
 * Resolves a notice's targets, outside any transaction (3c design, section 7.1, step 3):
 *   - a link is parsed into the post or the account it names, or refused;
 *   - a notice on the path for child sexual abuse material that names more than CSAM_NOTICE_MAX_ACCOUNTS accounts is
 *     refused, the accounts counted by the handles as named, before any is looked up, so the refusal says nothing about
 *     which handles are live or name the same account;
 *   - the targets are de-duplicated as named, a post by its id and an account by its handle: an account's link with
 *     nothing live has no id to compare, and a stored id must never tie an old handle to its account;
 *   - each is looked up by the one liveness rule;
 *   - a signed-in sender's target that they have reported already on this ground is dropped (`skip`).
 * What is left is numbered from 1 in the order named. The answer to the sender never says which targets were live.
 */
export async function resolveTargets(
  deps: Pick<ModerationDeps, "social" | "config">,
  request: Pick<NoticeRequest, "ground" | "targets">,
  skip: (live: readonly { type: "post" | "account"; id: string }[]) => Promise<Set<string>> = async () => new Set(),
): Promise<ResolvedTargets> {
  const suspect = request.ground === "csam";
  const named: NamedTarget[] = [];
  for (const target of request.targets) {
    const parsed = target.kind === "link" ? parseLink(deps.config.APP_ORIGIN, target.url) : target.kind === "post" ? { type: "post" as const, id: target.id } : { type: "account" as const, handle: target.handle };
    if (parsed.type === "account") {
      if (!named.some((seen) => seen.type === "account" && seen.handle === parsed.handle)) named.push(parsed);
      continue;
    }
    const mediaId = target.kind === "post" ? (target.mediaId ?? null) : null;
    const seen = named.find((earlier) => earlier.type === "post" && earlier.id === parsed.id);
    // Named twice, the post is one target; the image one of the two pointed at is kept.
    if (seen && seen.type === "post") seen.mediaId ??= mediaId;
    else named.push({ type: "post", id: parsed.id, mediaId });
  }
  if (suspect && named.filter((target) => target.type === "account").length > CSAM_NOTICE_MAX_ACCOUNTS) throw new ModerationError("invalid_request");

  const found = await Promise.all(named.map((target) => liveTarget(deps, target, suspect)));
  const liveOnes = found.flatMap((target) => (target === null ? [] : [target]));
  const skipped = liveOnes.length === 0 ? new Set<string>() : await skip(liveOnes);
  const resolved: ResolvedTargets = { live: [], dead: [] };
  const stored = new Set<string>();
  let position = 0;
  named.forEach((target, index) => {
    const live = found[index] ?? null;
    if (live !== null) {
      // Dropped: already reported by this sender, or (on the path that looks up old handles) the same account as an earlier target.
      if (skipped.has(targetKey(live)) || stored.has(targetKey(live))) return;
      stored.add(targetKey(live));
      position++;
      if (target.type === "post") resolved.live.push({ type: "post", id: live.id, position, mediaId: target.mediaId });
      else resolved.live.push({ type: "account", id: live.id, position, namedHandle: target.handle });
      return;
    }
    position++;
    if (target.type === "post") resolved.dead.push({ type: "post", id: target.id, position });
    else resolved.dead.push({ type: "account", position, namedHandle: target.handle });
  });
  // Every target was live and reported already: there is nothing to store.
  if (position === 0) throw new ModerationError("already_reported");
  return resolved;
}

/** The ground's columns of a report or a notice, from the request and its sender. */
function groundOf(request: NoticeRequest, reporterId: string | null, signedIn: boolean): IntakeGround {
  const channel = signedIn ? "signed_in" : "signed_out";
  const base = { kind: "user" as const, channel, findingBy: null, contactId: null } satisfies Partial<IntakeGround>;
  switch (request.ground) {
    case "rule":
      // A rule-only report alleges no illegality: its category is the Transparency Database's for a breach of the terms.
      return { ...base, reporterId, ruleId: request.ruleId, allegesIllegal: false, csam: false, category: "STATEMENT_CATEGORY_OTHER_VIOLATION_TC", categoryKeyword: null, citedLaw: null, explanation: request.explanation ?? null, bonaFide: false };
    case "illegal":
      return {
        ...base,
        reporterId,
        // A signed-out notifier's name and address go to the auth module under this id; the notice holds the id alone.
        contactId: !signedIn && (request.name !== undefined || request.email !== undefined) ? randomUUID() : null,
        ruleId: request.ruleId ?? null,
        allegesIllegal: true,
        csam: false,
        category: request.category,
        categoryKeyword: null,
        citedLaw: request.citedLaw ?? null,
        explanation: request.explanation,
        bonaFide: true,
      };
    case "csam":
      // An Art. 16 notice of illegal content that records no sender, whoever sent it: no account, no contact.
      return {
        ...base,
        reporterId: null,
        ruleId: null,
        allegesIllegal: true,
        csam: true,
        category: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS",
        categoryKeyword: CSAM_KEYWORDS[request.keyword],
        citedLaw: null,
        explanation: request.explanation ?? null,
        bonaFide: request.bonaFide ?? false,
      };
  }
}

/**
 * One report or notice (3c design, section 7.1). In this order:
 *   1. who may send it: a staff account reports only as its own finding, in the console; a session that has not finished
 *      onboarding has no profile to report from and is refused, never treated as signed out; a signed-in sender leaves no
 *      name or address, since their contact is their account;
 *   2. the human check of a signed-out sender, then the limits: per network signed out, per account signed in;
 *   3. the targets, resolved outside any transaction;
 *   4. the intake's transaction; a request it could not save through no fault of its sender gives its limit hits back;
 *   5. after its commit, a signed-out notifier's contact is stored by the auth module (a failure is logged: the notice
 *      stands without it, and no contact can exist without its notice), and the mails are started without being waited
 *      for: the urgent lane's alert first, then the receipt;
 *   6. the answer: the reference, and the token of a notice sent signed out or on the path for child sexual abuse
 *      material, which is shown once and is the only way to follow such a notice. A stalled relay never costs it.
 */
export async function submitNotice(deps: ModerationDeps, request: NoticeRequest, sender: NoticeSender): Promise<NoticeResponse> {
  // 1.
  const { session } = sender;
  if (session !== null) {
    if (session.role !== "user") throw new ModerationError("staff_cannot_report");
    if (!session.onboarded) throw new ModerationError("onboarding_required");
    if (request.ground === "illegal" && (request.name !== undefined || request.email !== undefined)) throw new ModerationError("invalid_request");
  }

  // 2. A signed-in sender's token is ignored. From here on the request is counted, whatever a later step says of its
  // links or its targets: a sender cannot probe what exists without spending the hour.
  const counted: string[] = [];
  const count = async (key: string, windowMs: number, max: number) => {
    await countOrRefuse(deps, key, windowMs, max);
    counted.push(key);
  };
  if (session === null) {
    if (request.turnstileToken === undefined || !(await deps.auth.verifyHuman(request.turnstileToken))) throw new ModerationError("human_check_failed");
    await count(`notice:hour:net:${sender.netHash}`, HOUR_MS, NOTICE_LIMITS.signedOut.perHour);
    await count(`notice:day:net:${sender.netHash}`, DAY_MS, NOTICE_LIMITS.signedOut.perDay);
  } else {
    await count(`notice:hour:account:${session.userId}`, HOUR_MS, NOTICE_LIMITS.signedIn.perHour);
    await count(`notice:day:account:${session.userId}`, DAY_MS, NOTICE_LIMITS.signedIn.perDay);
  }

  // 3. On the path for child sexual abuse material nothing is matched against the session's account or its reports: every
  // live target gets an item, so someone who sent a notice of illegality about a post can still report it this way.
  const ground = groundOf(request, session?.userId ?? null, session !== null);
  const reporterId = ground.reporterId;
  const targets = await resolveTargets(deps, request, reporterId === null ? undefined : (live) => alreadyReported(deps.apiDb, reporterId, ground.allegesIllegal, live));

  // 4. A request that fails here through no fault of its sender gives back what it took of their limits, since its answer
  // tells them to send it again: its case kept changing until the last retry (case_closed), or the transaction failed in
  // a way no rule of the module names. A refusal that is the sender's own (already reported, an account that is gone)
  // stays counted.
  let recorded: IntakeRecorded;
  try {
    recorded = await recordIntake(deps, { ground, live: targets.live, dead: targets.dead });
  } catch (err) {
    if (!(err instanceof ModerationError) || err.code === "case_closed") {
      // The key holds the sender's network or account: the warning names neither.
      for (const key of counted) await deps.limits.release(key).catch((failure: unknown) => deps.log.warn({ err: failure }, "notice: a limit hit of a request that could not be saved could not be given back"));
    }
    throw err;
  }

  // 5. The contact is stored before the answer; the mails are not waited for.
  if (ground.contactId !== null && request.ground === "illegal") {
    try {
      await deps.auth.storeNotifierContact(ground.contactId, { name: request.name, email: request.email });
    } catch (err) {
      deps.log.error({ err, intakeId: recorded.intakeId }, "notice: the notifier's contact could not be stored; the notice stands without it");
    }
  }
  const urgent = recorded.items.some((item) => item.caseId !== null && item.lane === 0);
  deps.background.start(async () => {
    if (urgent) {
      try {
        await alertUrgentLane(deps);
      } catch (err) {
        deps.log.error({ err, intakeId: recorded.intakeId }, "notice: the urgent lane's alert failed; the dispatch job repeats it");
      }
    }
    await sendReceipt(deps, recorded.intakeId);
  });

  // 6.
  return recorded.token === null ? { ref: recorded.ref } : { ref: recorded.ref, token: recorded.token };
}

/** What a mail's result is recorded as. A contact nobody has (never stored, or forgotten) has no address; a refused address is given up. */
const RECEIPT_STATES: Record<NotifierMailResult | AccountMailResult, ReceiptState> = { sent: "sent", folded: "folded", suppressed: "suppressed", no_address: "no_address", forgotten: "no_address", refused: "failed" };

/**
 * A notice's receipt, built from the stored notice alone, so a receipt sent later, or carried in a daily update, holds
 * the same reference, time and links as one sent at once: the links of the items the sender named, in their order, an
 * account's under the handle as named.
 */
export async function receiptMessage(deps: Pick<ModerationDeps, "apiDb" | "config">, notice: Pick<NoticeRow, "id" | "ref" | "receivedAt">) {
  // The items the sender named: not those korbat added for a quoted post, and no re-examination, which shares its item's position.
  const items = (await noticeItems(deps.apiDb, notice.id)).filter((item) => item.position <= 10 && !item.reexamines);
  return { template: "notice_received" as const, ref: notice.ref, receivedAt: new Date(notice.receivedAt), items: items.map((item) => itemLink(deps, item)) };
}

/**
 * Sends a notice's receipt and records what became of it: to a signed-out notifier's contact, or to the account behind a
 * notice of illegality sent signed in. A notice without a pending receipt sends nothing. A failure of the relay leaves
 * the receipt pending, for the dispatch job to send; any other result is recorded, only while the receipt is still
 * pending. A fault that is not the relay's (a database error, a contact no configured key opens) is thrown: its caller
 * logs it as what it is, and the receipt stays pending.
 */
export async function sendReceipt(deps: Pick<ModerationDeps, "apiDb" | "auth" | "config" | "log">, intakeId: string): Promise<ReceiptState | "pending" | "none"> {
  const notice = await noticeById(deps.apiDb, intakeId);
  if (!notice || notice.receipt !== "pending") return "none";
  const message = await receiptMessage(deps, notice);
  let result: NotifierMailResult | AccountMailResult;
  try {
    if (notice.contactId !== null) result = await deps.auth.mailNotifier(notice.contactId, message);
    else if (notice.reporterId !== null) result = await deps.auth.mailAccount(notice.reporterId, message);
    // The reporter's link was forgotten with their account: there is nobody to mail.
    else result = "no_address";
  } catch (err) {
    if (!(err instanceof MailUnavailable)) throw err;
    deps.log.warn({ err, intakeId }, "notice receipt: not sent; it stays pending for the next try");
    return "pending";
  }
  await recordReceipt(deps.apiDb, intakeId, RECEIPT_STATES[result]);
  return RECEIPT_STATES[result];
}

// ---------------------------------------------------------------- the notifier's status page and contact

/** An item's korbat address: a post's from its id, an account's from the handle as the notice named it, never from the handle the profile holds now. */
export function itemLink(deps: Pick<ModerationDeps, "config">, item: Pick<NoticeItemRow, "targetType" | "targetId" | "namedHandle">): string {
  return item.targetType === "post" ? postLink(deps.config.APP_ORIGIN, item.targetId) : accountLink(deps.config.APP_ORIGIN, item.namedHandle!);
}

/** Whether two hex digests are the same, compared in constant time. */
function sameDigest(a: string, b: string): boolean {
  const [left, right] = [Buffer.from(a, "hex"), Buffer.from(b, "hex")];
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * One item as its sender reads it (3c design, sections 7.2 and 10). Nothing of the outcome is told before the daily
 * release: not the outcome or its day, not whether images were sealed or out of sight, not whether a re-examination can
 * be asked for, so the page and the mail tell the same at the same time. And nothing before it tells whether the target
 * was live: an item whose link named nothing reads exactly as one that waits for a moderator.
 */
export async function itemStatus(deps: Pick<ModerationDeps, "social" | "config">, item: NoticeItemRow): Promise<NoticeItemStatus> {
  // "No action for now": a decision taken while nobody could open the post's images, on an item about a post that is not itself suspect.
  const unseen = item.released && item.decisionUnseen && item.targetType === "post" && !item.suspect;
  // What the answer concerns. Before the release the scope comes from what the notice named and from the item's suspect
  // mark alone, never from what the target turned out to be: the page must not tell a live target from a link that names
  // nothing, nor, on the path for child sexual abuse material, whether a handle names an account.
  let scope: NoticeItemStatus["scope"] = null;
  if (item.targetType === "account") {
    // With or without a case: the answer concerns the images on the account's posts too when the item is suspect or,
    // once released, when its decision sealed them. After "not available" the page and the app add no scope sentence.
    scope = item.suspect || (item.released && item.sealed) ? "account_suspect" : "account";
  } else if (item.released && item.hasCase && !item.suspect && (await deps.social.postRef(item.targetId))?.quoteOfId) {
    // Whether a post quotes another can be read only from its row, so this scope comes with the released outcome and not
    // before it. A suspect item about a quoting post has an item of its own for the quoted post, and no such scope.
    scope = "quote";
  }
  // Only a moderator's decision to take no action can be examined again, once; an answer given with the images out of
  // sight does not spend that, also when it answered a re-examination.
  const reexaminable = item.released && item.noAction && (!item.reexamines || unseen);
  // What the outcome's words need beside it, as the mail's line reads them: the rule a restriction under a rule names, in
  // the wording of the rulebook the decision was made under, and whether the restriction changed nothing anyone saw.
  const outcome = item.released ? (item.shownOutcome as ItemOutcome) : null;
  let rule: NoticeItemStatus["rule"];
  if (outcome === "restricted_rule") {
    const found = item.ruleId === null || item.rulesVersion === null ? undefined : getRule(item.ruleId, item.rulesVersion);
    if (!found) throw new Error("the item's restriction names no rule of a rulebook korbat holds");
    rule = { id: found.id as RuleId, title: found.title };
  }
  const restricting = outcome === "restricted_rule" || outcome === "restricted_legal";
  return {
    position: item.position,
    link: itemLink(deps, item),
    scope,
    suspect: item.suspect,
    sealed: item.released && item.sealed,
    unseen,
    quotedBy: item.position > 10 ? item.position - 10 : null,
    outcome,
    decidedOn: item.released ? item.decidedOn : null,
    changed: item.changed,
    reexamines: item.reexamines,
    reexamination: reexaminable ? { open: !item.reexamined && item.inWindow, until: item.until! } : null,
    ...(rule ? { rule } : {}),
    ...(restricting && item.noEffect ? { noEffect: true as const } : {}),
  };
}

/**
 * The items the status page lists. An item korbat added for a quoted post (a position above 10) exists only where the
 * named post exists and quotes another, so listing it at once would tell a live target from a link that names nothing.
 * It is listed from the first release that shows an outcome of its pair: its origin's, after which it stands directly
 * behind it, with its own outcome or waiting; or its own, since from the release an outcome shows on the page and its
 * window to ask for a re-examination runs. Its origin's waiting past that same release already told that it names a row:
 * a link to no row was answered by then. A re-examination is filed only on a released item, so it is always listed.
 */
export function listedItems(items: readonly NoticeItemRow[]): NoticeItemRow[] {
  const releasedOrigins = new Set(items.filter((item) => item.position <= 10 && !item.reexamines && item.released).map((item) => item.position));
  return items.filter((item) => item.position <= 10 || item.reexamines || item.released || releasedOrigins.has(item.position - 10));
}

/**
 * The notifier's status page (3c design, section 7.2): the notice whose reference matches and whose token this is, either
 * the notice's own, shown once on screen, or the mail token of its contact, which the receipt's link carries. Anything
 * else is notice_not_found. With the notice's own token the contact's `confirmed` and `stopped` are null, so the answer
 * to whoever typed an address never depends on what korbat knows about that address.
 */
export async function noticeStatus(deps: Pick<ModerationDeps, "apiDb" | "auth" | "social" | "limits" | "config">, request: NoticeStatusRequest, netHash: string): Promise<NoticeStatus> {
  await countOrRefuse(deps, `notice-status:${netHash}`, HOUR_MS, STATUS_READS_PER_HOUR);
  const notice = await noticeByRef(deps.apiDb, request.ref);
  if (!notice) throw new ModerationError("notice_not_found");
  const own = notice.lookupHash !== null && sameDigest(notice.lookupHash, createHash("sha256").update(request.token).digest("hex"));
  const byMail = !own && notice.contactId !== null && (await deps.auth.notifierMailTokenMatches(notice.contactId, request.token));
  if (!own && !byMail) throw new ModerationError("notice_not_found");

  const items: NoticeItemStatus[] = [];
  for (const item of listedItems(await noticeItems(deps.apiDb, notice.id))) items.push(await itemStatus(deps, item));
  let contact: NoticeStatus["contact"] = null;
  if (notice.contactId !== null) {
    const facts = (await deps.auth.notifierFacts([notice.contactId])).get(notice.contactId);
    contact = { given: facts?.contactGiven ?? false, confirmed: byMail ? (facts?.confirmed ?? false) : null, stopped: byMail ? (facts?.suppressed ?? false) : null };
  }
  return { ref: notice.ref, receivedAt: notice.receivedAt, items, contact };
}

/**
 * The status page's two buttons (3c design, section 7.2): "I sent this" and "stop korbat's emails about reports to this
 * address". Only the contact's mail token works them: the notice's own token, a notice without a contact and a wrong
 * token are all notice_not_found, so typing someone's address neither confirms it nor stops korbat's mail to it.
 */
export async function noticeContact(deps: Pick<ModerationDeps, "apiDb" | "auth" | "limits">, request: NoticeContactRequest, netHash: string): Promise<void> {
  await countOrRefuse(deps, `notice-status:${netHash}`, HOUR_MS, STATUS_READS_PER_HOUR);
  const notice = await noticeByRef(deps.apiDb, request.ref);
  if (!notice || notice.contactId === null) throw new ModerationError("notice_not_found");
  const done = request.choice === "confirm" ? await deps.auth.confirmNotifier(notice.contactId, request.token) : await deps.auth.stopNotifier(notice.contactId, request.token);
  if (!done) throw new ModerationError("notice_not_found");
}
```

### Replace `apps/api/src/moderation/repo.ts` (whole file)

```ts
import { sql } from "drizzle-orm";
import type { ActionKind, CaseDecidedParams, Lane, StaffStoredAssertion } from "@korbat/contracts";
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
}

export async function insertItem(tx: DbTx, row: ItemRow): Promise<{ id: string; seq: number | null }> {
  const [inserted] = await rows<{ id: string; seq: number | null }>(
    tx,
    sql`insert into intake_items (intake_id, case_id, target_type, target_id, position, lane, media_id, named_handle, outcome)
        values (${row.intakeId}::uuid, ${row.caseId}::uuid, ${row.targetType}::moderation_target, ${row.targetId}::uuid, ${row.position}::smallint, ${row.lane}::smallint,
                ${row.mediaId}::uuid, ${row.namedHandle}, ${row.caseId === null ? "not_available" : null}::item_outcome)
        returning id, seq`,
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
    sql`select i.intake_id, i.position, i.target_type, i.target_id, i.named_handle, i.case_id is not null as has_case, i.suspect,
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
 * Whether the seal a decision has just recorded is in force, asked of the view itself, inside the decision's transaction:
 * the one definition of which measures stand, never a copy of its clause.
 */
export async function sealInForce(tx: DbTx, decisionId: string): Promise<boolean> {
  const [row] = await rows<{ held: boolean }>(tx, sql`select exists (select 1 from measures_in_force m where m.decision_id = ${decisionId}::uuid and m.kind = 'seal_media') as held`);
  return row!.held;
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

/** The appeals of the case's decisions, oldest first; a statement is null when there was none or it was erased. */
export async function caseAppeals(q: Runner, caseId: string): Promise<{ id: string; decisionId: string; filedAt: string; statement: string | null; answeredAt: string | null; result: "kept" | "partly_reversed" | "reversed" | null; answeredBy: string | null }[]> {
  const found = await rows<{ id: string; decision_id: string; filed_at: string; statement: string | null; answered_at: string | null; result: "kept" | "partly_reversed" | "reversed" | null; answered_by: string | null }>(
    q,
    sql`select a.id, a.decision_id, ${iso("a.filed_at")} as filed_at, a.statement, ${iso("a.answered_at")} as answered_at, a.result, a.answered_by
          from appeals a join decisions d on d.id = a.decision_id where d.case_id = ${caseId}::uuid order by a.filed_at, a.id`,
  );
  return found.map((row) => ({ id: row.id, decisionId: row.decision_id, filedAt: row.filed_at, statement: row.statement, answeredAt: row.answered_at, result: row.result, answeredBy: row.answered_by }));
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

/** The appeals no review has answered yet. */
export async function appealsWaiting(q: Runner): Promise<number> {
  const [row] = await rows<{ n: number }>(q, sql`select count(*)::int as n from appeals where answered_by is null`);
  return row!.n;
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
```

### Replace `apps/api/src/moderation/routes.ts` (whole file)

```ts
import { AuthorCasesQuery, NoticeContactRequest, NoticeRequest, NoticeStatusRequest, ReportsQuery } from "@korbat/contracts";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { errorBody } from "../lib/errors";
import { validate } from "../lib/validate";
import { authorCases, authorDecisionView } from "./author";
import type { ModerationDeps } from "./context";
import { noticeContact, noticeStatus, submitNotice, type NoticeSender } from "./intake";
import { reporterList, resumeReportMail } from "./reports";

/** A decision's id in the lower case PostgreSQL returns. */
const DecisionParam = z.object({ id: z.uuid().transform((id) => id.toLowerCase()) });

/**
 * The guard the signed-in routes stand behind when the module is built without the server's: it refuses every request.
 * The server always hands over the auth module's requireSession; a module built without one, as the tests of the staff
 * side build it, must not open a signed-in route to anyone.
 */
export const noSession: MiddlewareHandler<AppEnv> = async (c) => c.json(errorBody("unauthenticated", "Sign in required", c.get("requestId")), 401);

/**
 * The moderation module's app routes, mounted at `/api` after the global rate limit and session resolution (3c design,
 * section 5). Handlers only validate, call a flow and shape the response; a flow's refusal is a ModerationError, which
 * the app's error handler turns into the shared envelope.
 *
 * The three routes under `/api/notices` take a request with or without a session. Signed out, such a request passes
 * session resolution with its Origin checked and no CSRF token, since there is no cookie to ride on; signed in from a
 * browser, it carries the token as every cookie request does. The status page's tokens travel in the body of a POST, so
 * no address, and no server log, ever holds one.
 *
 * The four routes under `/api/moderation` are the signed-in account's own (section 7.6). `guard` is the auth module's
 * requireSession: an onboarded account, with CSRF and Origin already checked for cookie sessions. Each answers only for
 * the session's account: the decisions about it, and the reports it sent.
 */
export function moderationRoutes(deps: ModerationDeps, guard: MiddlewareHandler<AppEnv>) {
  const r = new Hono<AppEnv>();
  /** The keyed hash of the client's network, which the client identity middleware set; "direct" where it did not run. */
  const netHash = (c: Context<AppEnv>): string => c.get("clientNetHash") ?? "direct";
  const sender = (c: Context<AppEnv>): NoticeSender => ({ session: c.get("session"), netHash: netHash(c) });
  const me = (c: Context<AppEnv>): string => c.get("session")!.userId;

  // One request is one report or notice: one intake, an item for each target it names.
  r.post("/notices", validate("json", NoticeRequest), async (c) => c.json(await submitNotice(deps, c.req.valid("json"), sender(c)), 201));
  // Where a notice stands, for whoever holds its reference with its own token or with the token of a mail's link.
  r.post("/notices/status", validate("json", NoticeStatusRequest), async (c) => c.json(await noticeStatus(deps, c.req.valid("json"), netHash(c))));
  // The status page's two buttons: a POST each, never a link that acts when it is merely opened.
  r.post("/notices/contact", validate("json", NoticeContactRequest), async (c) => {
    await noticeContact(deps, c.req.valid("json"), netHash(c));
    return c.body(null, 204);
  });

  // The decisions about the account that its author was told of, newest first.
  r.get("/moderation/cases", guard, validate("query", AuthorCasesQuery), async (c) => c.json(await authorCases(deps, me(c), c.req.valid("query").cursor)));
  // One of them, with its statement's data and the content it was made on; not_found for anyone but its subject.
  r.get("/moderation/decisions/:id", guard, validate("param", DecisionParam), async (c) => c.json(await authorDecisionView(deps, me(c), c.req.valid("param").id)));
  // The reports and notices the account sent, each item as its status page would give it.
  r.get("/moderation/reports", guard, validate("query", ReportsQuery), async (c) => c.json(await reporterList(deps, me(c), c.req.valid("query").cursor)));
  // Lifts a stop of korbat's report mails to the account's address; the same answer whether or not there was one.
  r.post("/moderation/report-mail/resume", guard, async (c) => {
    await resumeReportMail(deps, me(c));
    return c.body(null, 204);
  });

  return r;
}
```

### Replace `apps/api/src/social/context.ts` (whole file)

```ts
import type { AuthErrorCode, SocialErrorCode } from "@korbat/contracts";
import type { Logger } from "pino";
import type { AuthEventType } from "../auth";
import { MediaError, type MediaForPosts } from "../media";
import type { RateLimitStore } from "../middleware/rate-limit";
import type { ModerationForSocial } from "../moderation";
import type { SocialRepo } from "./repo";

/** The handle codes onboarding answers with, which a handle change raises too, plus its cooldown. */
type HandleErrorCode = Extract<AuthErrorCode, "handle_invalid" | "handle_reserved" | "handle_taken" | "handle_cooldown">;

/** The social codes plus the shared ones the module also raises. */
export type SocialErrorKind = SocialErrorCode | HandleErrorCode | "not_found" | "invalid_request" | "rate_limited" | "service_unavailable";
export type SocialErrorStatus = 400 | 403 | 404 | 409 | 429 | 503;

const MESSAGES: Record<SocialErrorKind, string> = {
  post_unavailable: "That post is not available to reply to or quote.",
  not_author: "Only the author can delete this post.",
  blocked: "You blocked this account. Unblock it in your privacy settings first.",
  self_target: "You cannot do that to your own account.",
  account_too_new: "New accounts can repost and quote after 48 hours.",
  // The page asked for belongs to an Explore ranking that is no longer kept; the app starts again from the current one.
  explore_refreshed: "Explore was refreshed.",
  not_found: "Not found.",
  invalid_request: "Some details are missing or invalid.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  service_unavailable: "That could not be done right now. Try again in a moment.",
  handle_invalid: "Handles are 3 to 20 characters: lowercase letters, numbers and underscores.",
  handle_reserved: "That handle is reserved.",
  handle_taken: "That handle is taken.",
  handle_cooldown: "Handles can change once every 30 days.",
};

/** An expected, user-facing failure. The HTTP layer turns it into an ErrorEnvelope with this code and status. */
export class SocialError extends Error {
  constructor(
    readonly code: SocialErrorKind,
    readonly status: SocialErrorStatus,
    message: string = MESSAGES[code],
    /** Set for rate_limited, service_unavailable and handle_cooldown so the response can carry Retry-After. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "SocialError";
  }
}

export function socialErrorMessage(code: SocialErrorKind): string {
  return MESSAGES[code];
}

/** The account making a request, or null when signed out. Reads accept null; writes never do. */
export type ViewerId = string | null;

/** Posts without images: what the module runs with when no media module is wired, as in the 2a tests. */
export const WITHOUT_MEDIA: MediaForPosts = {
  attach: async (_tx, input) => {
    if (input.items.length > 0) throw new MediaError("media_unavailable", 400);
  },
  detachAll: async () => [],
  requestDeletion: async () => undefined,
  forPosts: async () => new Map(),
};

/** Security events about an account go to the auth module's table; this is its appendEvent, as the server wires it. */
export interface SocialEvents {
  append(userId: string, type: AuthEventType, metadata?: Record<string, unknown>): Promise<void>;
}

export interface SocialDeps {
  repo: SocialRepo;
  /** Images on posts. The media module owns them; this module only passes its transaction along. */
  media: MediaForPosts;
  /**
   * The decision behind the state of the viewer's own withheld or removed post, for its chip. The moderation module owns
   * the decisions. Absent in the tests of posting alone, whose posts then carry no chip.
   */
  moderation?: ModerationForSocial;
  /** Per-account write limits; the same store the per-IP middleware uses. */
  limits: RateLimitStore;
  log: Logger;
  now: () => Date;
  /** Records profile and handle changes as security events. Absent in the 2a tests, which record nothing. */
  events?: SocialEvents;
}
```

### Replace `apps/api/src/social/index.ts` (whole file)

```ts
/**
 * The only file outside `src/social/` may import. Everything else in the module is private and the
 * architecture test fails the build if another file reaches into it.
 */
import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import type { Db, DbTx } from "@korbat/db";
import type { AppEnv } from "../env";
import type { JobLock } from "../lib/jobs";
import type { MediaForPosts } from "../media";
import type { RateLimitStore } from "../middleware/rate-limit";
import type { ModerationForSocial } from "../moderation";
import { WITHOUT_MEDIA, type SocialDeps, type SocialEvents } from "./context";
import { startExplore } from "./explore";
import { exportProfile, type ProfileExport } from "./flows/export";
import { createSocialRepo, type AccountLockMode, type CapturedPost, type CapturedProfile } from "./repo";
import { socialRoutes } from "./routes";

export { SocialError } from "./context";
export { enforceWriteLimit } from "./limits";
export type { SocialDeps, SocialEvents, ViewerId } from "./context";
export type { AccountLockMode, CapturedPost, CapturedProfile } from "./repo";
export type { ExportedMedia, ExportedPost, ProfileExport } from "./flows/export";

/** What the account module needs from this one (1b design, section 5): the purge of a deleted account, and the data export. */
export interface SocialForAccount {
  /**
   * One transaction that tombstones every post, removes the engagement and graph rows with their
   * counters and anonymises the profile row, keeping its handle; `within` runs inside it, as its last
   * act, for the media rows. Safe to repeat: a second run changes nothing.
   */
  purgeProfile(userId: string, now: Date, within: (tx: DbTx) => Promise<void>): Promise<void>;
  /**
   * The profile, read at once, and its posts with their images, its engagement and its side of the graph,
   * each read in keyset pages of `pageSize` rows (1,000 unless a test says otherwise) as it is iterated.
   */
  exportProfile(userId: string, pageSize?: number): Promise<ProfileExport>;
}

/**
 * What the moderation module needs from this one (3c design, section 5): the locks on profile rows that order a case's
 * transactions against everything else an account does, and the reads a case's evidence and its rules are built from.
 * The moderation module owns no table of this one and never writes to one.
 */
export interface SocialForModeration {
  /** Locks these profile rows in id order, in one statement; with `live`, a missing or deleted account is refused (not_found). */
  lockAccounts(tx: DbTx, ids: readonly string[], mode: AccountLockMode, live?: boolean): Promise<{ id: string; deleted: boolean }[]>;
  /** The post, locked `for share`, as evidence copies it, or null; its body is empty when its content was erased. */
  capturePost(tx: DbTx, postId: string): Promise<CapturedPost | null>;
  /** The account's handle, display name and bio as evidence copies them, or null. */
  captureProfile(tx: DbTx, accountId: string): Promise<CapturedProfile | null>;
  /**
   * The account a handle names. With `withDeleted`, for a report of child sexual abuse material, also a deleted profile
   * and the account of a handle it has left; without it, only a live profile that holds the handle now.
   */
  findAccountByHandle(handle: string, withDeleted: boolean): Promise<{ id: string; deleted: boolean } | null>;
  /** Who wrote the post, or null when no row has the id. */
  postAuthor(postId: string): Promise<string | null>;
  /** The post's author, state and the post it quotes, or null when no row has the id; no lock. */
  postRef(postId: string): Promise<{ authorId: string; state: "visible" | "withheld" | "removed" | "deleted_by_author"; quoteOfId: string | null } | null>;
}

/**
 * The moderation module's interface over the social repository on the pool it is given. A factory of its own, not a
 * member of createSocial's result: the social module's views take facts from the moderation module, which is therefore
 * built between the two.
 */
export function socialForModeration(apiDb: Db): SocialForModeration {
  const repo = createSocialRepo(apiDb);
  return {
    lockAccounts: (tx, ids, mode, live) => repo.lockAccounts(tx, ids, mode, live),
    capturePost: (tx, postId) => repo.capturePost(tx, postId),
    captureProfile: (tx, accountId) => repo.captureProfile(tx, accountId),
    findAccountByHandle: (handle, withDeleted) => repo.findAccountByHandle(handle, withDeleted),
    postAuthor: (postId) => repo.postAuthor(postId),
    postRef: (postId) => repo.postRef(postId),
  };
}

export interface CreateSocialOptions {
  /** The korbat_api pool. The module never sees the auth pool. */
  apiDb: Db;
  /** Per-account write limits share the store the per-IP middleware uses. */
  rateLimitStore: RateLimitStore;
  logger: Logger;
  /** The auth module's requireSession: an onboarded account with CSRF and Origin checked. */
  requireSession: MiddlewareHandler<AppEnv>;
  /** The auth module's requireFreshAuth: a credential proven in the last five minutes, which a handle change needs on top. */
  requireFreshAuth: MiddlewareHandler<AppEnv>;
  /** The auth module's appendEvent, so profile and handle changes land in auth_events. Without it nothing is recorded (the 2a tests). */
  events?: SocialEvents;
  /** The media module's interface for posts. Without it posts carry no images. */
  media?: MediaForPosts;
  /** The moderation module's interface for views: moderation.forSocial. Without it no post carries the author's chip. */
  moderation?: ModerationForSocial;
  now?: () => Date;
}

export function createSocial(options: CreateSocialOptions) {
  const deps: SocialDeps = {
    repo: createSocialRepo(options.apiDb),
    media: options.media ?? WITHOUT_MEDIA,
    moderation: options.moderation,
    limits: options.rateLimitStore,
    log: options.logger,
    now: options.now ?? (() => new Date()),
    events: options.events,
  };
  const forAccount: SocialForAccount = {
    purgeProfile: (userId, now, within) => deps.repo.purgeProfile(userId, now, within),
    exportProfile: (userId, pageSize) => exportProfile(deps, userId, pageSize),
  };
  return {
    deps,
    /** The interface the account module uses. */
    forAccount,
    routes: socialRoutes(deps, options.requireSession, options.requireFreshAuth),
    /**
     * Starts the Explore refresh under the shared job lock: a round at once, then one every five minutes. Returns the
     * function that stops the timer.
     */
    startExplore: (lock: JobLock) => startExplore(deps, lock),
  };
}

export type Social = ReturnType<typeof createSocial>;
```

### Replace `apps/api/src/social/views.ts` (whole file)

```ts
import type { Author, HiddenMedia, MediaView, PostView, TimelineItem, Tombstone } from "@korbat/contracts";
import type { PostImage } from "../media";
import type { SocialDeps, ViewerId } from "./context";
import { encodeCursor } from "./cursor";
import type { ListRow, PostRow, ProfileRow } from "./repo";
import { postAccess, tombstone } from "./visibility";

/** Where views come from: the posts, their images through the media module, and the chip's facts through the moderation module. */
export type ViewSource = Pick<SocialDeps, "repo" | "media" | "moderation">;

/** What a post id resolves to for a viewer: the view, or a tombstone when the viewer may not see it. */
export type LoadedPost = PostView | Tombstone;

export function isTombstone(loaded: LoadedPost): loaded is Tombstone {
  return !("author" in loaded);
}

export function authorOf(profile: ProfileRow): Author {
  return { id: profile.id, handle: profile.handle, displayName: profile.displayName, verified: profile.verified };
}

/**
 * One image of a post as this viewer gets it (3c design, section 7.10). A visible image is the image. A withheld or
 * removed one stays with its author, who gets it with that state; anyone else gets a placeholder in its place, the same
 * for both states, with nothing of the image in it. A sealed image is that placeholder for every viewer, its author
 * included, who alone is told that it is sealed.
 */
export function mediaFor(viewer: ViewerId, authorId: string, image: PostImage): MediaView | HiddenMedia {
  const own = viewer !== null && viewer === authorId;
  if (image.state === "sealed") return own ? { id: image.id, hidden: true, sealed: true } : { id: image.id, hidden: true };
  const { state, ...view } = image;
  if (state === "visible") return view;
  return own ? { ...view, moderation: state } : { id: image.id, hidden: true };
}

/**
 * Turns post ids into views for one viewer: loads the rows and, one level deep, the posts they
 * quote; decides access for every row with the visibility rule and the viewer's blocks; attaches
 * the viewer's like, repost and bookmark state, and every post's images, each as this viewer gets it
 * (mediaFor). Ids that resolve to nothing become tombstones, and tombstones carry no images. The
 * viewer's own visible posts that the current Explore ranking holds, while their switch is on, carry
 * the author's chip (2c design, section 8):
 * asked in one query, and only when the viewer wrote some of the posts; a quoted embed never carries it.
 * The viewer's own withheld and removed posts carry the decision behind their state (3c design, section 7.6), which the
 * moderation module names: asked the same way, once for the page and only when the viewer wrote such a post.
 */
export async function loadPostViews({ repo, media, moderation }: ViewSource, viewer: ViewerId, ids: string[]): Promise<Map<string, LoadedPost>> {
  const unique = [...new Set(ids)];
  const primary = await repo.findPosts(unique);
  const quoteIds = [...new Set([...primary.values()].map((row) => row.quoteOfId).filter((id): id is string => id !== null && !primary.has(id)))];
  const quoted = await repo.findPosts(quoteIds);
  const all = new Map([...primary, ...quoted]);
  const authorIds = [...new Set([...all.values()].flatMap((row) => (row.replyToAuthorId ? [row.authorId, row.replyToAuthorId] : [row.authorId])))];
  const blocked = viewer ? await repo.blockedEitherWay(viewer, authorIds) : new Set<string>();
  const states = viewer ? await repo.viewerPostStates(viewer, [...all.keys()]) : null;
  const images = await media.forPosts([...all.keys()]);
  // A withheld or removed post is never in Explore for anyone, its author included, so only visible ones are asked about.
  const own = viewer ? [...primary.values()].filter((row) => row.authorId === viewer && row.state === "visible").map((row) => row.id) : [];
  const inExplore = viewer && own.length > 0 ? await repo.listedInExplore(viewer, own) : new Set<string>();
  // The chip of a withheld or removed post is its author's alone, so only the viewer's own such posts are asked about.
  const restricted = viewer ? [...primary.values()].filter((row) => row.authorId === viewer && (row.state === "withheld" || row.state === "removed")).map((row) => row.id) : [];
  const decisions = viewer && moderation && restricted.length > 0 ? await moderation.authorFacts(viewer, restricted) : null;

  const access = (row: PostRow) => postAccess(viewer, row, blocked.has(row.authorId));
  /** The parent's handle only when the viewer could open the parent; a block either way, or a hidden or deleted parent, gives null. */
  const parentHandle = (row: PostRow): string | null =>
    row.replyToAuthorId && row.replyToState && postAccess(viewer, { authorId: row.replyToAuthorId, state: row.replyToState }, blocked.has(row.replyToAuthorId)) === "shown"
      ? row.replyToHandle
      : null;
  const base = (row: PostRow) => ({
    id: row.id,
    author: row.author,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    state: row.state as PostView["state"],
    replyTo: row.replyToId ? { id: row.replyToId, authorHandle: parentHandle(row) } : null,
    counts: { likes: row.likeCount, reposts: row.repostCount, replies: row.replyCount, quotes: row.quoteCount },
    media: (images.get(row.id) ?? []).map((image) => mediaFor(viewer, row.authorId, image)),
    ...(states ? { viewer: states.get(row.id)! } : {}),
  });
  const quoteOf = (id: string | null): PostView["quoteOf"] => {
    if (id === null) return null;
    const row = all.get(id);
    if (!row) return tombstone(id, "hidden");
    const a = access(row);
    return a === "shown" ? { ...base(row), quoteOf: null } : tombstone(id, a);
  };

  const out = new Map<string, LoadedPost>();
  for (const id of unique) {
    const row = primary.get(id);
    if (!row) {
      out.set(id, tombstone(id, "hidden"));
      continue;
    }
    const a = access(row);
    const decision = decisions?.get(id);
    out.set(id, a === "shown" ? { ...base(row), ...(inExplore.has(id) ? { inExplore: true as const } : {}), ...(decision ? { moderation: decision } : {}), quoteOf: quoteOf(row.quoteOfId) } : tombstone(id, a));
  }
  return out;
}

/** One post as the viewer sees it, or null when they may not. */
export async function postView(source: ViewSource, viewer: ViewerId, id: string): Promise<PostView | null> {
  const loaded = (await loadPostViews(source, viewer, [id])).get(id)!;
  return isTombstone(loaded) ? null : loaded;
}

/** Views for list rows, in list order, dropping anything the viewer may not see. */
export async function postViews(source: ViewSource, viewer: ViewerId, rows: ListRow[]): Promise<PostView[]> {
  const loaded = await loadPostViews(source, viewer, rows.map((row) => row.postId));
  return rows.map((row) => loaded.get(row.postId)!).filter((view): view is PostView => !isTombstone(view));
}

/** Timeline items for list rows, with the reposter attached to repost rows. */
export async function timelineItems(source: ViewSource, viewer: ViewerId, rows: ListRow[]): Promise<TimelineItem[]> {
  const loaded = await loadPostViews(source, viewer, rows.map((row) => row.postId));
  const reposters = await source.repo.findProfiles([...new Set(rows.map((row) => row.reposterId).filter((id): id is string => id !== null))]);
  const items: TimelineItem[] = [];
  for (const row of rows) {
    const view = loaded.get(row.postId)!;
    if (isTombstone(view)) continue;
    const reposter = row.reposterId ? reposters.get(row.reposterId) : undefined;
    if (row.reposterId && !reposter) continue;
    items.push(reposter ? { kind: "repost", post: view, repostedBy: authorOf(reposter), repostedAt: row.sortAt.toISOString() } : { kind: "post", post: view });
  }
  return items;
}

/** The cursor for the page after these rows, or null when the page was not full. */
export function pageCursor(rows: { sortAt: Date; postId?: string; profileId?: string; reposterId?: string | null }[], limit: number): string | null {
  if (rows.length < limit) return null;
  const last = rows[rows.length - 1]!;
  return encodeCursor({ t: last.sortAt.getTime(), id: (last.postId ?? last.profileId)!, ...(last.reposterId ? { r: last.reposterId } : {}) });
}
```

### Replace `apps/app/.env.example` (whole file)

```text
# Used by `pnpm --filter @korbat/app web`. `node scripts/gen-dev-env.mjs` copies this to apps/app/.env.
# Cloudflare's always-pass Turnstile test key; the API on the host uses the matching test secret.
EXPO_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
# The dev web server (8081) calls the API on the host directly. The Docker web image leaves this unset
# and calls the API on its own origin through Caddy.
EXPO_PUBLIC_API_URL=http://localhost:3000
# The account settings show the verified badge section only when this is on. The development API runs the dev
# provider (VERIFY_PROVIDER=dev in apps/api/.env.example), so the development app shows it; the web image takes
# WEB_BADGE from infra/.env instead, off by default.
EXPO_PUBLIC_BADGE=on
# The users' contact address, which the report form names when the form itself cannot be used and the terms page
# shows. The web image takes WEB_CONTACT_EMAIL from infra/.env instead and refuses to build without one.
EXPO_PUBLIC_CONTACT_EMAIL=contact@korbat.local
```

### Replace `apps/app/package.json` (whole file)

```json
{
  "name": "@korbat/app",
  "version": "0.0.0",
  "private": true,
  "main": "expo-router/entry",
  "scripts": {
    "start": "expo start",
    "web": "expo start --web",
    "export:web": "expo export --platform web",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@korbat/contracts": "workspace:*",
    "@korbat/rules": "workspace:*",
    "@marsidev/react-turnstile": "1.6.1",
    "@simplewebauthn/browser": "14.0.0",
    "expo": "57.0.22",
    "expo-constants": "57.0.18",
    "expo-image": "57.0.5",
    "expo-linking": "57.0.10",
    "expo-router": "57.0.21",
    "nativewind": "4.2.7",
    "react": "19.2.3",
    "react-dom": "19.2.3",
    "react-native": "0.86.3",
    "react-native-gesture-handler": "2.32.0",
    "react-native-reanimated": "4.5.1",
    "react-native-safe-area-context": "5.7.0",
    "react-native-screens": "4.26.2",
    "react-native-web": "0.21.2",
    "react-native-worklets": "0.10.1",
    "zod": "4.6.5"
  },
  "devDependencies": {
    "@types/node": "24.13.5",
    "@types/react": "19.2.18",
    "tailwindcss": "3.4.19",
    "typescript": "6.0.3",
    "vitest": "4.1.11"
  }
}
```

### Replace `apps/app/src/app/terms.tsx` (whole file)

```tsx
import { ScrollView, Text, View } from "react-native";

import { TextLink } from "@/components/ui";
import { CONTACT_EMAIL, reportHref } from "@/lib/moderation";
import { CONTACT_WORDS } from "@/lib/moderation-words";
import { TERMS_SECTIONS, TERMS_VERSION } from "@/lib/terms";

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
            <Text className="mt-2 text-base leading-7 text-zinc-300">{section.body}</Text>
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

### Replace `apps/app/src/app/u/[handle]/index.tsx` (whole file)

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Link, router, useLocalSearchParams, type Href } from "expo-router";
import type { ProfileView } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { PostList, TimelineList } from "@/components/social/PagedList";
import { FollowButton } from "@/components/social/ProfileList";
import { Button, Loading, VerifiedChip } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { reportHref } from "@/lib/moderation";
import { REPORT_WORDS } from "@/lib/moderation-words";
import { useSession } from "@/lib/session";
import { social } from "@/lib/social";

type Tab = "posts" | "replies" | "likes";

function Stat({ label, value, href }: { label: string; value: number; href?: Href }) {
  const inner = (
    <Text className="text-sm text-zinc-400">
      <Text className="font-semibold text-zinc-50">{value}</Text> {label}
    </Text>
  );
  return href ? (
    <Link href={href} asChild>
      <Pressable className="mr-4">{inner}</Pressable>
    </Link>
  ) : (
    <View className="mr-4">{inner}</View>
  );
}

/** A profile: header with counts and actions, then Posts and Replies tabs, plus a private Likes tab on your own. */
export default function ProfileScreen() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const { state } = useSession();
  const me = state.status === "signed-in" && state.me.user.onboarded ? state.me : null;
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("posts");
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const blockDialog = useRef<View>(null);
  useEffect(() => {
    if (confirmBlock) (blockDialog.current as unknown as { focus?: () => void } | null)?.focus?.();
  }, [confirmBlock]);

  useEffect(() => {
    let cancelled = false;
    setProfile(null);
    setError(null);
    setTab("posts");
    social
      .profile(handle)
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [handle, state.status]);

  const fetchPosts = useCallback((cursor?: string) => social.profilePosts(handle, cursor), [handle]);
  const fetchReplies = useCallback((cursor?: string) => social.profileReplies(handle, cursor), [handle]);
  const fetchLikes = useCallback((cursor?: string) => social.myLikes(cursor), []);

  async function act(action: () => Promise<void>) {
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <AppShell>
        <View className="px-4 py-10">
          <Text accessibilityRole="header" className="text-xl font-bold text-zinc-50">
            This account is not available
          </Text>
          <Text className="mt-2 text-base text-zinc-400">{error}</Text>
        </View>
      </AppShell>
    );
  }
  if (!profile) {
    return (
      <AppShell>
        <Loading />
      </AppShell>
    );
  }

  const own = me !== null && profile.id === me.user.id;
  const viewer = profile.viewer;
  const tabs: Tab[] = own ? ["posts", "replies", "likes"] : ["posts", "replies"];

  // Anyone but the profile's owner may report it, signed in or out (3c design, section 9): a link to the report form,
  // which stands beside Mute and Block when those are shown.
  const report = own ? null : (
    <Link href={reportHref({ account: profile.handle })} asChild>
      <Pressable className="rounded-full border border-zinc-600 px-4 py-1.5">
        <Text className="text-sm text-zinc-200">{REPORT_WORDS.control}</Text>
      </Pressable>
    </Link>
  );

  const header = (
    <View className="border-b border-zinc-800 px-4 pt-4">
      <View className="flex-row flex-wrap items-center gap-x-2">
        <Text accessibilityRole="header" className="text-2xl font-bold text-zinc-50">
          {profile.displayName}
        </Text>
        {profile.verified ? <VerifiedChip /> : null}
      </View>
      <Text className="text-base text-zinc-400">@{profile.handle}</Text>
      {profile.bio ? <Text className="mt-2 text-base leading-6 text-zinc-200">{profile.bio}</Text> : null}
      <View className="mt-3 flex-row">
        <Stat label="posts" value={profile.counts.posts} />
        <Stat label="followers" value={profile.counts.followers} href={me ? `/u/${profile.handle}/followers` : undefined} />
        <Stat label="following" value={profile.counts.following} href={me ? `/u/${profile.handle}/following` : undefined} />
      </View>
      {viewer?.followedBy ? <Text className="mt-1 text-xs text-zinc-400">Follows you</Text> : null}

      {me && !own && viewer ? (
        <View className="mt-3 flex-row flex-wrap items-center gap-2">
          <FollowButton
            handle={profile.handle}
            initial={viewer.following}
            onChange={(following, followerCount) =>
              setProfile((current) => (current ? { ...current, counts: { ...current.counts, followers: followerCount }, viewer: { ...current.viewer!, following } } : current))
            }
          />
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() =>
              void act(async () => {
                const { muted } = await social.setMute(profile.handle, !viewer.muted);
                setProfile((current) => (current ? { ...current, viewer: { ...current.viewer!, muted } } : current));
              })
            }
            className="rounded-full border border-zinc-600 px-4 py-1.5"
          >
            <Text className="text-sm text-zinc-200">{viewer.muted ? "Unmute" : "Mute"}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => setConfirmBlock(true)} className="rounded-full border border-red-900 px-4 py-1.5">
            <Text className="text-sm text-red-300">Block</Text>
          </Pressable>
          {report}
        </View>
      ) : null}
      {/* Without the signed-in controls (signed out, or no relation loaded) the report link stands alone in their place. */}
      {!own && !(me && viewer) ? <View className="mt-3 flex-row">{report}</View> : null}
      {own ? <Button label="Security and privacy settings" onPress={() => router.push("/settings/security")} tone="secondary" /> : null}
      {!me ? <Text className="mt-3 text-xs text-zinc-400">Sign in to follow this account.</Text> : null}
      {actionError ? (
        <Text accessibilityRole="alert" className="mt-2 text-sm text-red-400">
          {actionError}
        </Text>
      ) : null}

      {confirmBlock ? (
        <View ref={blockDialog} role="dialog" aria-labelledby="block-title" tabIndex={-1} className="mt-3 rounded-lg border border-red-900 bg-zinc-900 p-4">
          <Text nativeID="block-title" className="text-base font-semibold text-zinc-50">
            Block @{profile.handle}?
          </Text>
          <Text className="mt-1 text-sm text-zinc-300">
            Neither of you will see the other's posts or profile while signed in, and you will unfollow each other. Posts on korbat are public, so a block does not hide them from
            someone who signs out. You can undo this in your privacy settings.
          </Text>
          <View className="mt-3 flex-row gap-2">
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() =>
                void act(async () => {
                  await social.setBlock(profile.handle, true);
                  router.replace("/settings/privacy");
                })
              }
              className="rounded-lg bg-red-600 px-4 py-2"
            >
              <Text className="text-sm font-semibold text-zinc-50">Block</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setConfirmBlock(false)} className="rounded-lg border border-zinc-700 px-4 py-2">
              <Text className="text-sm text-zinc-200">Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View accessibilityRole="tablist" className="mt-4 flex-row">
        {tabs.map((t) => (
          <Pressable key={t} accessibilityRole="tab" aria-selected={tab === t} onPress={() => setTab(t)} className={`mr-6 border-b-2 pb-2 ${tab === t ? "border-zinc-50" : "border-transparent"}`}>
            <Text className={`text-base ${tab === t ? "font-semibold text-zinc-50" : "text-zinc-400"}`}>{t === "posts" ? "Posts" : t === "replies" ? "Replies" : "Likes"}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );

  return (
    <AppShell>
      {tab === "posts" ? (
        <TimelineList key="posts" fetchPage={fetchPosts} empty="No posts yet." header={header} />
      ) : tab === "replies" ? (
        <PostList key="replies" fetchPage={fetchReplies} empty="No replies yet." header={header} />
      ) : (
        <PostList key="likes" fetchPage={fetchLikes} empty="You have not liked anything yet. Only you can see this tab." header={header} />
      )}
    </AppShell>
  );
}
```

### Replace `apps/app/src/components/SettingsNav.tsx` (whole file)

```tsx
import { Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import { CASES_WORDS } from "@/lib/moderation-words";

export type SettingsPage = "security" | "privacy" | "profile" | "account" | "cases";

const PAGES: { page: SettingsPage; label: string }[] = [
  { page: "security", label: "Security" },
  { page: "privacy", label: "Privacy" },
  { page: "profile", label: "Profile" },
  { page: "account", label: "Account" },
  // The decisions about the account and the reports it sent (3c design, section 9); its screens are the folder settings/cases.
  { page: "cases", label: CASES_WORDS.nav },
];

/**
 * The row of links between the settings screens, shown by every one of them under its title. Each
 * link is a real anchor (expo-router's Link), so the keyboard can follow it. The screen names itself
 * through `current` instead of the row asking the router for the path, which also lets a test render
 * the row on its own.
 */
export function SettingsNav({ current }: { current: SettingsPage }) {
  return (
    <View role="navigation" aria-label="Settings" className="mt-3 flex-row flex-wrap">
      {PAGES.map(({ page, label }) => (
        <Link key={page} href={`/settings/${page}`} asChild>
          <Pressable aria-current={page === current ? "page" : undefined} className="mr-5 py-1">
            <Text className={`text-sm underline ${page === current ? "font-semibold text-zinc-50" : "text-zinc-400"}`}>{label}</Text>
          </Pressable>
        </Link>
      ))}
    </View>
  );
}
```

### Replace `apps/app/src/components/social/MediaGrid.tsx` (whole file)

```tsx
import { useState } from "react";
import { Image } from "expo-image";
import { Pressable, Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { isHiddenMedia, type HiddenMedia, type MediaView } from "@korbat/contracts";
import { API_BASE } from "@/lib/api";
import { CHIP_WORDS } from "@/lib/moderation-words";
import { HiddenImage, HiddenRowWords, HiddenThumbnail, hiddenImageWords } from "./HiddenImage";
import { MediaViewer } from "./MediaViewer";

/** A single image keeps its own shape, within limits, so a very tall or very wide one cannot take over the timeline. */
const MIN_RATIO = 3 / 4;
const MAX_RATIO = 2;
const FRAME_RATIO = 16 / 9;
const GAP = 2;
const THUMBNAIL = 64;

export const clampRatio = (width: number, height: number): number => Math.min(MAX_RATIO, Math.max(MIN_RATIO, width / height));

/**
 * The small size of an image with its blurhash; expo-image loads it lazily on the web. The blurhash
 * fades into the image unless the system asks for reduced motion, which swaps it at once.
 */
function Picture({ item, style }: { item: MediaView; style: { width: number | "100%"; height: number | "100%"; borderRadius?: number } }) {
  const still = useReducedMotion();
  return (
    // On the web expo-image takes the <img alt> from accessibilityLabel, not from alt.
    <Image source={{ uri: `${API_BASE}${item.small}` }} placeholder={{ blurhash: item.blurhash }} contentFit="cover" transition={still ? 0 : 150} accessibilityLabel={item.alt} style={style} />
  );
}

/**
 * The label on the author's own image that moderation withheld or removed (3c design, section 9): the author keeps seeing
 * such an image, and reads on the image itself that others do not. The API marks an image so only for its author.
 */
export function OwnImageLabel({ state }: { state: NonNullable<MediaView["moderation"]> }) {
  const amber = state === "withheld";
  return (
    <View pointerEvents="none" className={`absolute left-1 top-1 rounded-full px-2 py-0.5 ${amber ? "bg-amber-950" : "bg-red-950"}`}>
      <Text className={`text-xs font-medium ${amber ? "text-amber-300" : "text-red-300"}`}>{amber ? CHIP_WORDS.underReview : CHIP_WORDS.removed}</Text>
    </View>
  );
}

/** One image of the frame: the control that opens it and, beside that control, the label of the author's own restricted image, as text of its own. */
function Cell({ item, onPress }: { item: MediaView; onPress: () => void }) {
  return (
    <View style={{ flex: 1 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open image: ${item.alt}`} onPress={onPress} style={{ flex: 1 }}>
        <Picture item={item} style={{ width: "100%", height: "100%" }} />
      </Pressable>
      {item.moderation ? <OwnImageLabel state={item.moderation} /> : null}
    </View>
  );
}

/**
 * The images of a post. One image is shown in its own ratio; two to four share a 16:9 frame and are
 * cropped to their cell. Pressing one opens the viewer; ALT shows the descriptions in place. An image
 * moderation hid from this reader keeps its place as a placeholder: it has no size of its own, so alone
 * it takes the frame's ratio, it is no control, and it has no description to show. The viewer is told the
 * post that holds the images, so that an image can be reported on it, unless the post is the reader's own.
 */
function Grid({ media, postId, own }: { media: (MediaView | HiddenMedia)[]; postId?: string; own?: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  const [described, setDescribed] = useState(false);
  const cell = (index: number) => {
    const item = media[index]!;
    return isHiddenMedia(item) ? <HiddenImage key={item.id} item={item} /> : <Cell key={item.id} item={item} onPress={() => setOpen(index)} />;
  };
  const first = media[0]!;
  // Descriptions exist only for the images this reader is shown.
  const anyShown = media.some((item) => !isHiddenMedia(item));

  let frame;
  if (media.length === 1) {
    frame = <View style={{ aspectRatio: isHiddenMedia(first) ? FRAME_RATIO : clampRatio(first.width, first.height) }}>{cell(0)}</View>;
  } else if (media.length === 2) {
    frame = <View style={{ aspectRatio: FRAME_RATIO, flexDirection: "row", gap: GAP }}>{[cell(0), cell(1)]}</View>;
  } else if (media.length === 3) {
    frame = (
      <View style={{ aspectRatio: FRAME_RATIO, flexDirection: "row", gap: GAP }}>
        {cell(0)}
        <View style={{ flex: 1, gap: GAP }}>{[cell(1), cell(2)]}</View>
      </View>
    );
  } else {
    frame = (
      <View style={{ aspectRatio: FRAME_RATIO, gap: GAP }}>
        <View style={{ flex: 1, flexDirection: "row", gap: GAP }}>{[cell(0), cell(1)]}</View>
        <View style={{ flex: 1, flexDirection: "row", gap: GAP }}>{[cell(2), cell(3)]}</View>
      </View>
    );
  }

  return (
    <View className="mt-2">
      <View className="overflow-hidden rounded-xl border border-zinc-800">{frame}</View>
      {anyShown ? (
        <Pressable accessibilityRole="button" aria-expanded={described} accessibilityLabel={described ? "Hide image descriptions" : "Show image descriptions"} onPress={() => setDescribed(!described)} className="mt-1 self-start rounded border border-zinc-700 px-1.5 py-0.5">
          <Text className="text-xs font-semibold text-zinc-300">ALT</Text>
        </Pressable>
      ) : null}
      {described
        ? media.map((item, index) => (
            <Text key={item.id} className="mt-1 text-sm leading-5 text-zinc-300">
              {media.length > 1 ? `${index + 1}. ` : ""}
              {/* A hidden image keeps its number, so the others' numbers match their places in the frame. */}
              {isHiddenMedia(item) ? hiddenImageWords(item) : item.alt}
            </Text>
          ))
        : null}
      {open === null ? null : <MediaViewer media={media} index={open} onIndex={setOpen} onClose={() => setOpen(null)} postId={own ? undefined : postId} />}
    </View>
  );
}

/**
 * A post's images (`Grid`), or a quoted post's as one row of small squares (`compact`). The squares
 * are pictures, not buttons: the whole quote is a link to the quoted post, where the grid and the
 * viewer are, and a control inside another control is one that assistive technology cannot reach.
 * A hidden image keeps its square in the row, and the row says the placeholder's sentence once, as
 * text, under the squares. `postId` is the post that holds the images and `own` says that the reader
 * wrote it: the viewer reports an image on that post, and offers no report of the reader's own.
 */
export function MediaGrid({ media, compact = false, postId, own = false }: { media: (MediaView | HiddenMedia)[]; compact?: boolean; postId?: string; own?: boolean }) {
  if (media.length === 0) return null;
  if (!compact) return <Grid media={media} postId={postId} own={own} />;
  return (
    <View className="mt-2">
      <View className="flex-row" style={{ gap: GAP }}>
        {media.map((item) => (isHiddenMedia(item) ? <HiddenThumbnail key={item.id} size={THUMBNAIL} /> : <Picture key={item.id} item={item} style={{ width: THUMBNAIL, height: THUMBNAIL, borderRadius: 6 }} />))}
      </View>
      <HiddenRowWords media={media} />
    </View>
  );
}
```

### Replace `apps/app/src/components/social/MediaViewer.tsx` (whole file)

```tsx
import { useEffect } from "react";
import { Image } from "expo-image";
import { Modal, Platform, Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import { useReducedMotion } from "react-native-reanimated";
import { isHiddenMedia, type HiddenMedia, type MediaView } from "@korbat/contracts";
import { API_BASE } from "@/lib/api";
import { reportHref } from "@/lib/moderation";
import { CHIP_WORDS, REPORT_WORDS } from "@/lib/moderation-words";
import { HiddenImage } from "./HiddenImage";

interface MediaViewerProps {
  media: (MediaView | HiddenMedia)[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  /** The post that holds the images: an image is reported on it. Absent for the reader's own post, which they do not report. */
  postId?: string;
}

/**
 * What the viewer shows: one image in its large size, fitted inside the screen, with its description
 * underneath, its place among the post's images and the controls. The viewer is opened from an image's
 * own cell only; stepping through the post's images can still come to one moderation hid from this
 * reader, which is never loaded: its placeholder stands in the image's place. An image that is shown can
 * be reported from here, on the post that holds it; the author's own withheld or removed image says so.
 */
export function MediaViewerContent({ media, index, onIndex, onClose, postId }: MediaViewerProps) {
  const still = useReducedMotion();
  const item = media[index]!;
  const many = media.length > 1;
  const step = (by: number) => onIndex((index + by + media.length) % media.length);

  return (
    <View className="flex-1 bg-black/95">
      <View className="flex-row items-center justify-between px-4 py-3">
        <Text className="text-sm text-zinc-300">{many ? `${index + 1} of ${media.length}` : ""}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close the image viewer" onPress={onClose} className="rounded-lg border border-zinc-700 px-3 py-1.5">
          <Text className="text-sm text-zinc-200">Close</Text>
        </Pressable>
      </View>
      <View className="flex-1 px-2">
        {isHiddenMedia(item) ? (
          <HiddenImage item={item} />
        ) : (
          <Image source={{ uri: `${API_BASE}${item.large}` }} placeholder={{ blurhash: item.blurhash }} contentFit="contain" transition={still ? 0 : 150} accessibilityLabel={item.alt} style={{ flex: 1 }} />
        )}
      </View>
      {isHiddenMedia(item) ? null : <Text className="px-4 py-3 text-center text-sm leading-5 text-zinc-200">{item.alt}</Text>}
      {!isHiddenMedia(item) && item.moderation ? (
        <Text className={`pb-3 text-center text-sm font-medium ${item.moderation === "withheld" ? "text-amber-300" : "text-red-300"}`}>
          {item.moderation === "withheld" ? CHIP_WORDS.underReview : CHIP_WORDS.removed}
        </Text>
      ) : null}
      {!isHiddenMedia(item) && postId ? (
        // A real anchor, as every link of the app; the viewer closes as the form opens.
        <Link href={reportHref({ post: postId, media: item.id })} onPress={onClose} asChild>
          <Pressable className="self-center pb-3">
            <Text className="text-sm text-zinc-400 underline">{REPORT_WORDS.imageControl}</Text>
          </Pressable>
        </Link>
      ) : null}
      {many ? (
        <View className="flex-row justify-center gap-3 pb-4">
          <Pressable accessibilityRole="button" accessibilityLabel="Previous image" onPress={() => step(-1)} className="rounded-lg border border-zinc-700 px-4 py-2">
            <Text className="text-sm text-zinc-200">Previous</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Next image" onPress={() => step(1)} className="rounded-lg border border-zinc-700 px-4 py-2">
            <Text className="text-sm text-zinc-200">Next</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/**
 * One image on the whole screen. Arrow keys move between the images of the post; react-native-web's
 * Modal closes it on Escape and returns focus to the image that opened it. It appears at once: nothing
 * about it needs motion, and the image fades in from its blurhash only when reduced motion is not asked for.
 */
export function MediaViewer({ media, index, onIndex, onClose, postId }: MediaViewerProps) {
  const many = media.length > 1;

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" && many) onIndex((index + 1) % media.length);
      if (event.key === "ArrowLeft" && many) onIndex((index - 1 + media.length) % media.length);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [index, many, media.length, onIndex]);

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <MediaViewerContent media={media} index={index} onIndex={onIndex} onClose={onClose} postId={postId} />
    </Modal>
  );
}
```

### Replace `apps/app/src/components/social/PostCard.tsx` (whole file)

```tsx
import { useEffect, useRef, useState, type Ref } from "react";
import { Pressable, Text, View } from "react-native";
import { Link, router } from "expo-router";
import type { Author, PostView, QuotedPost, Tombstone } from "@korbat/contracts";
import { VerifiedChip } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { chipText, reportHref } from "@/lib/moderation";
import { CHIP_WORDS, REPORT_WORDS } from "@/lib/moderation-words";
import { useSession } from "@/lib/session";
import { social, timeAgo, type EngagementKind } from "@/lib/social";
import { MediaGrid } from "./MediaGrid";
import { RichText } from "./RichText";

function AuthorLine({ author, createdAt }: { author: Author; createdAt: string }) {
  return (
    <View className="flex-row flex-wrap items-baseline gap-x-2">
      <Link href={`/u/${author.handle}`} asChild>
        <Pressable>
          <Text className="text-base font-semibold text-zinc-50">{author.displayName}</Text>
        </Pressable>
      </Link>
      {author.verified ? <VerifiedChip /> : null}
      <Text className="text-sm text-zinc-400">
        @{author.handle} · {timeAgo(createdAt)}
      </Text>
    </View>
  );
}

function TombstoneBox({ tombstone }: { tombstone: Tombstone }) {
  return (
    <View className="mt-2 rounded-lg border border-zinc-800 px-3 py-2">
      <Text className="text-sm italic text-zinc-400">{tombstone.deleted ? "This post was deleted by its author." : "This post is unavailable."}</Text>
    </View>
  );
}

export function QuoteEmbed({ quote }: { quote: QuotedPost | Tombstone }) {
  if (!("author" in quote)) return <TombstoneBox tombstone={quote} />;
  return (
    <Link href={`/post/${quote.id}`} asChild>
      <Pressable className="mt-2 rounded-lg border border-zinc-800 px-3 py-2">
        <AuthorLine author={quote.author} createdAt={quote.createdAt} />
        {quote.body ? <RichText body={quote.body} className="mt-1 text-sm leading-5 text-zinc-300" /> : null}
        <MediaGrid media={quote.media} compact postId={quote.id} />
      </Pressable>
    </Link>
  );
}

/**
 * The chip on the author's own withheld or removed post (3c design, section 9). With the decision behind the state it
 * names the rule or says "illegal content", amber while korbat decides and red once removed, and links to the decision's
 * statement under Settings, Cases. A view without the decision's facts still says the state, and links nowhere.
 */
function StateChip({ post }: { post: PostView }) {
  if (post.state === "visible") return null;
  const decision = post.moderation;
  const amber = decision ? decision.interim : post.state === "withheld";
  const surface = `self-start rounded-full px-2 py-0.5 ${amber ? "bg-amber-500/15" : "bg-red-500/15"}`;
  const words = <Text className={`text-xs font-medium ${amber ? "text-amber-300" : "text-red-300"}`}>{decision ? chipText(decision) : amber ? CHIP_WORDS.underReview : CHIP_WORDS.removed}</Text>;
  if (!decision) return <View className={surface}>{words}</View>;
  return (
    <Link href={`/settings/cases/${decision.decisionId}`} asChild>
      <Pressable className={surface}>{words}</Pressable>
    </Link>
  );
}

/**
 * The author's own post while it is in the current Explore ranking (2c design, section 8): a link to the post, whose
 * status line under it says more and leads to the switch.
 */
function ExploreChip({ id }: { id: string }) {
  return (
    <Link href={`/post/${id}`} asChild>
      <Pressable className="self-start rounded-full bg-emerald-500/15 px-2 py-0.5">
        <Text className="text-xs font-medium text-emerald-300">In Explore</Text>
      </Pressable>
    </Link>
  );
}

/**
 * `active` colours the action. `pressed` tells a screen reader that a toggle is on, and is for
 * toggles whose label stays the same (Like, Repost); Save changes its label instead, which
 * already says so. While one action's request is in flight, every action waits.
 */
function Action({
  label,
  count,
  active,
  pressed,
  busy,
  activeClass,
  onPress,
  ref,
}: {
  label: string;
  count?: number;
  active?: boolean;
  pressed?: boolean;
  busy?: boolean;
  activeClass?: string;
  onPress: () => void;
  ref?: Ref<View>;
}) {
  return (
    <Pressable ref={ref} accessibilityRole="button" aria-pressed={pressed} aria-busy={busy} disabled={busy} onPress={onPress} className="flex-row items-center gap-1 py-1 pr-4">
      <Text className={`text-sm ${active ? activeClass : "text-zinc-400"}`}>{label}</Text>
      {count !== undefined && count > 0 ? <Text className={`text-sm ${active ? activeClass : "text-zinc-400"}`}>{count}</Text> : null}
    </Pressable>
  );
}

/**
 * One post in any list. Actions update the card from the server's answer, so counts never drift
 * from the truth. A signed-out reader is sent to sign in on the first action.
 */
export function PostCard({ post: initial, repostedBy, onDeleted }: { post: PostView; repostedBy?: Author; onDeleted?: (id: string) => void }) {
  const { state } = useSession();
  const me = state.status === "signed-in" ? state.me.user.id : null;
  const [post, setPost] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  useEffect(() => setPost(initial), [initial]);
  const deleteRef = useRef<View>(null);
  const keepRef = useRef<View>(null);
  const wasConfirming = useRef(false);
  // The Delete control leaves the tree while the question shows, so a keyboard user would drop to the page
  // body: the safe answer takes the focus, and Delete takes it back when the question is withdrawn.
  useEffect(() => {
    if (confirmingDelete) keepRef.current?.focus();
    else if (wasConfirming.current) deleteRef.current?.focus();
    wasConfirming.current = confirmingDelete;
  }, [confirmingDelete]);

  /** Runs one request at a time: a second tap while one is in flight does nothing, so a double tap cannot undo itself. */
  async function request(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function toggle(kind: EngagementKind) {
    if (!me) {
      router.push("/signin");
      return;
    }
    const current = post.viewer ?? { liked: false, reposted: false, bookmarked: false };
    const on = kind === "like" ? !current.liked : kind === "repost" ? !current.reposted : !current.bookmarked;
    void request(async () => {
      const result = await social.engage(post.id, kind, on);
      setPost((current) => ({ ...current, counts: result.counts, viewer: result.viewer }));
    });
  }

  function remove() {
    void request(async () => {
      await social.deletePost(post.id);
      setConfirmingDelete(false);
      onDeleted?.(post.id);
    });
  }

  return (
    <View className="border-b border-zinc-800 px-4 py-3">
      {repostedBy ? <Text className="mb-1 text-xs text-zinc-400">↻ {repostedBy.displayName} reposted</Text> : null}
      <AuthorLine author={post.author} createdAt={post.createdAt} />
      {post.author.id === me ? <StateChip post={post} /> : null}
      {/* The API sets inExplore only on the viewer's own posts; the check keeps the chip on them whatever a view carries. */}
      {post.author.id === me && post.inExplore ? <ExploreChip id={post.id} /> : null}
      {post.replyTo ? (
        <Text className="text-xs text-zinc-400">
          {post.replyTo.authorHandle ? "Replying to " : "Replying to a post you can't see"}
          {post.replyTo.authorHandle ? (
            <Link href={`/u/${post.replyTo.authorHandle}`} asChild>
              <Text className="text-sky-400">@{post.replyTo.authorHandle}</Text>
            </Link>
          ) : null}
        </Text>
      ) : null}
      {/* A post may consist of images only, and then there is no text to link. */}
      {post.body ? (
        <Link href={`/post/${post.id}`} asChild>
          <Pressable className="mt-1">
            <RichText body={post.body} />
          </Pressable>
        </Link>
      ) : null}
      <MediaGrid media={post.media} postId={post.id} own={post.author.id === me} />
      {post.quoteOf ? <QuoteEmbed quote={post.quoteOf} /> : null}
      <View className="mt-2 flex-row flex-wrap items-center">
        <Action label="Reply" count={post.counts.replies} onPress={() => router.push(`/post/${post.id}`)} />
        <Action label="Repost" count={post.counts.reposts} active={post.viewer?.reposted} pressed={post.viewer?.reposted} busy={busy} activeClass="text-emerald-400" onPress={() => toggle("repost")} />
        <Action label="Quote" count={post.counts.quotes} onPress={() => (me ? router.push(`/post/${post.id}?quote=1`) : router.push("/signin"))} />
        <Action label="Like" count={post.counts.likes} active={post.viewer?.liked} pressed={post.viewer?.liked} busy={busy} activeClass="text-rose-400" onPress={() => toggle("like")} />
        <Action label={post.viewer?.bookmarked ? "Saved" : "Save"} active={post.viewer?.bookmarked} busy={busy} activeClass="text-sky-400" onPress={() => toggle("bookmark")} />
        {post.author.id === me && !confirmingDelete ? <Action ref={deleteRef} label="Delete" busy={busy} onPress={() => setConfirmingDelete(true)} /> : null}
        {/* Anyone but the author may report the post, signed in or out; the form is a page of its own, so this is a link. */}
        {post.author.id !== me ? (
          <Link href={reportHref({ post: post.id })} asChild>
            <Pressable className="flex-row items-center gap-1 py-1 pr-4">
              <Text className="text-sm text-zinc-400">{REPORT_WORDS.control}</Text>
            </Pressable>
          </Link>
        ) : null}
      </View>
      {confirmingDelete ? (
        <View role="dialog" aria-labelledby={`delete-${post.id}`} className="mt-2 flex-row flex-wrap items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2">
          <Text nativeID={`delete-${post.id}`} className="text-sm text-zinc-200">
            Delete this post?
          </Text>
          <Action label="Delete" busy={busy} activeClass="text-red-400" active onPress={remove} />
          <Action ref={keepRef} label="Keep" busy={busy} onPress={() => setConfirmingDelete(false)} />
        </View>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" className="mt-1 text-xs text-red-400">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
```

### Replace `apps/app/src/lib/api.ts` (whole file)

```ts
import { Platform } from "react-native";
import { ErrorEnvelope, HealthResponse, type AuthErrorCode, type ModerationErrorCode } from "@korbat/contracts";
import type { z } from "zod";

/** Same origin on web (Caddy proxies /api). Native needs an absolute URL. */
export const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === "web" ? "" : "http://localhost:3000");

const CSRF_COOKIE = "__Host-korbat_csrf";
const DEVICE_KEY = "korbat.deviceId";

/** Browser globals, typed locally so this file does not depend on the DOM type library. */
const web = globalThis as unknown as {
  document?: { cookie: string };
  localStorage?: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  crypto: { getRandomValues<T extends Uint8Array>(array: T): T };
};

let onUnauthenticated: (() => void) | null = null;

/**
 * Called when a request outside the sign-in flow answers 401: the session ended elsewhere (signed
 * out everywhere, revoked, expired). The session provider registers it to drop the signed-in state.
 */
export function setUnauthenticatedHandler(handler: (() => void) | null): void {
  onUnauthenticated = handler;
}

/** A failed API call with the server's error code and a message fit to show the user. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Seconds until the request may be repeated, from Retry-After: a rate limit or the handle cooldown. */
    readonly retryAfter?: number,
    /** What the server sent beside the code (1c design, section 7.1): for reauth_required the level and the factors held, for passkey_limit the bound and its wait. */
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const MESSAGES: Partial<Record<AuthErrorCode | ModerationErrorCode | "unauthenticated" | "invalid_request" | "not_found" | "internal" | "network", string>> = {
  invalid_code: "That code is not valid. Check the latest email or request a new code.",
  code_expired: "That code has expired. Request a new one.",
  too_many_attempts: "Too many attempts. Start again.",
  invalid_credentials: "Email or password is incorrect.",
  mfa_required: "Turn on two-factor authentication first.",
  invalid_mfa_code: "That authentication code is not valid.",
  reauth_required: "Confirm it's you to continue.",
  csrf_failed: "This request could not be verified. Reload the page and try again.",
  turnstile_failed: "We could not verify that you are human. Try again.",
  disposable_email: "Disposable email addresses cannot be used.",
  age_requirement: "You must be at least 16 to use korbat.",
  terms_required: "Accept the current terms to continue.",
  handle_taken: "That handle is taken.",
  handle_invalid: "Handles are 3 to 20 characters: lowercase letters, numbers and underscores.",
  handle_reserved: "That handle is reserved.",
  password_too_short: "Passwords need at least 12 characters.",
  password_too_long: "Passwords can have at most 128 characters.",
  password_breached: "That password appears in known data breaches. Choose a different one.",
  password_check_unavailable: "We could not check that password right now. Try again in a moment.",
  staff_mfa_required: "Staff accounts must keep two-factor authentication on.",
  onboarding_required: "Choose a handle to finish setting up your account.",
  mail_unavailable: "We could not send the email. Try again in a moment.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  handle_cooldown: "Handles can change once every 30 days.",
  email_in_use: "That email address already belongs to an account.",
  phone_in_use: "That phone number is already verified on another account.",
  badge_unavailable: "Verification is not available on this korbat.",
  verify_unavailable: "We could not reach the verification service. Try again in a moment.",
  // Passkeys (1c design, section 9). The cap's sentence; the daily bound's wait is worded by messageFor from the details.
  passkey_invalid: "That passkey did not work. Try again or use your email.",
  passkey_unsupported: "This passkey provider is not supported. Try another one.",
  passkey_limit: "You have 10 passkeys. Remove one to add another.",
  passkey_suspended: "This passkey was switched off because a copy of it may exist. Remove it and add a new one.",
  passkey_not_found: "That passkey is gone.",
  challenge_expired: "That took too long. Try again.",
  // Reports and notices (3c design, section 9): the codes a person who reports can meet. The report form words three
  // failures itself, with the users' contact address: the human check, the limits and an API that cannot take reports.
  notice_link_invalid: "That link does not name a post or a profile on korbat.",
  notice_link_offsite: "Only links to this korbat can be reported.",
  human_check_failed: "We could not verify that you are human. Try again.",
  already_reported: "You already reported this; it is being looked at.",
  staff_cannot_report: "A staff account does not send reports. Open a finding in the staff console instead.",
  notice_not_found: "We could not find a report with this link.",
  unauthenticated: "Sign in to continue.",
  invalid_request: "Some details are missing or invalid.",
  not_found: "That no longer exists.",
  internal: "Something went wrong on our side. Try again.",
  network: "Cannot reach korbat. Check your connection.",
};

/** The daily passkey bound as the API details it: 5 added in a day, and the seconds until the day has a slot again. */
function dailyPasskeyBound(details: unknown): number | null {
  const bound = details as { reason?: unknown; retryAfter?: unknown } | null;
  return bound && typeof bound === "object" && bound.reason === "daily" && typeof bound.retryAfter === "number" && bound.retryAfter > 0 ? bound.retryAfter : null;
}

/** The message for a code; `details` is what the server sent beside it, which turns the daily passkey bound into its wait in hours. */
export function messageFor(code: string, fallback?: string, details?: unknown): string {
  const wait = code === "passkey_limit" ? dailyPasskeyBound(details) : null;
  if (wait !== null) {
    const hours = Math.max(1, Math.ceil(wait / 3600));
    return `You added 5 passkeys today. You can add another in about ${hours === 1 ? "1 hour" : `${hours} hours`}.`;
  }
  return MESSAGES[code as keyof typeof MESSAGES] ?? fallback ?? "Something went wrong. Try again.";
}

/** The message to show for any thrown value. */
export function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong. Try again.";
}

function readCookie(name: string): string | undefined {
  const cookies = web.document?.cookie;
  if (!cookies) return undefined;
  for (const part of cookies.split("; ")) {
    const separator = part.indexOf("=");
    if (part.slice(0, separator) === name) return decodeURIComponent(part.slice(separator + 1));
  }
  return undefined;
}

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** 32 random bytes as unpadded base64url (43 characters). */
function randomDeviceId(): string {
  const bytes = web.crypto.getRandomValues(new Uint8Array(33));
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += BASE64URL[(n >> 18) & 63]! + BASE64URL[(n >> 12) & 63]! + BASE64URL[(n >> 6) & 63]! + BASE64URL[n & 63]!;
  }
  return out.slice(0, 43);
}

/** A random id created once per browser. The server stores only a keyed hash of it. */
export function deviceId(): string {
  try {
    const existing = web.localStorage?.getItem(DEVICE_KEY);
    if (existing && /^[A-Za-z0-9_-]{22,64}$/.test(existing)) return existing;
    const created = randomDeviceId();
    web.localStorage?.setItem(DEVICE_KEY, created);
    return created;
  } catch {
    return randomDeviceId();
  }
}

export const platform: "web" | "ios" | "android" = Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "web";

interface RequestOptions<T> {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  json?: unknown;
  /** A raw body sent as it is, with its declared type: how an image is uploaded. */
  raw?: { type: string; body: Blob };
  /** Schema for a JSON response body. Omit for 204 responses. */
  schema?: z.ZodType<T>;
}

/**
 * Calls the API with the session cookie and answers with the raw response, for a body that is not
 * JSON (the account export's ZIP). State-changing requests echo the CSRF cookie in X-CSRF-Token; the
 * session cookie itself is HttpOnly and never readable here. A failed call throws an ApiError.
 */
export async function apiResponse(path: string, options: Omit<RequestOptions<unknown>, "schema"> = {}): Promise<Response> {
  const method = options.method ?? (options.json === undefined && options.raw === undefined ? "GET" : "POST");
  const headers: Record<string, string> = {};
  if (options.json !== undefined) headers["content-type"] = "application/json";
  if (options.raw) headers["content-type"] = options.raw.type;
  if (method !== "GET") {
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) headers["x-csrf-token"] = csrf;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      credentials: "include",
      body: options.raw ? options.raw.body : options.json === undefined ? undefined : JSON.stringify(options.json),
    });
  } catch {
    throw new ApiError(0, "network", messageFor("network"));
  }

  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/api/auth/") && path !== "/api/me") onUnauthenticated?.();
    const parsed = ErrorEnvelope.safeParse(await res.json().catch(() => null));
    const code = parsed.success ? parsed.data.error.code : "internal";
    const details = parsed.success ? parsed.data.error.details : undefined;
    // The server's message is written for people and can be more specific than the generic text for
    // its code ("Two-factor setup expired. Start again."). Only validation and internal errors use
    // the local wording, because their server messages are technical, and the passkey bounds do, so
    // the daily bound's wait is worded here from the details.
    const local = code === "invalid_request" || code === "internal" || code === "passkey_limit" || !parsed.success;
    // Retry-After is whole seconds: on a rate limit, and on the handle cooldown, where it says when the next change is allowed.
    const retryAfter = Number(res.headers.get("retry-after"));
    throw new ApiError(res.status, code, local ? messageFor(code, undefined, details) : parsed.data.error.message, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined, details);
  }
  return res;
}

/** Calls the API as `apiResponse` does and parses the JSON answer with `schema`; omit it for a 204 response. */
export async function api<T = void>(path: string, options: RequestOptions<T> = {}): Promise<T> {
  const res = await apiResponse(path, options);
  if (!options.schema) return undefined as T;
  return options.schema.parse(await res.json());
}

export async function fetchHealth(): Promise<HealthResponse> {
  return api("/api/health", { schema: HealthResponse });
}
```

### Replace `infra/.env.example` (whole file)

```text
# Copy to infra/.env and change every password. Never commit infra/.env.
POSTGRES_USER=postgres
POSTGRES_PASSWORD=change-me-superuser
POSTGRES_DB=korbat
KORBAT_MIGRATE_DB_PASSWORD=change-me-migrate
KORBAT_API_DB_PASSWORD=change-me-api
KORBAT_AUTH_DB_PASSWORD=change-me-auth
# Valkey (the session cache and rate-limit counters) refuses every command without it.
REDIS_PASSWORD=change-me-redis

# Images. The formats korbat accepts: remove one to refuse it and keep its decoder blocked, for
# example after a security advisory against that decoder, then restart api and worker.
MEDIA_FORMATS=jpeg,png,webp,gif,avif
# Uploads are refused while a media volume has less free space than this many bytes (2 GiB). The
# volumes share a disk with Postgres, and a full disk stops the database.
MEDIA_MIN_FREE_BYTES=2147483648
# The sweeper's pass that deletes images without a database row: on refuses when there are many of
# them (a database restored from an older snapshot looks like that), off skips it during a restore,
# force deletes them once you have checked.
MEDIA_RECONCILE=on

API_LOG_LEVEL=info
# Comma-separated browser origins allowed to call the API cross-origin. Empty in prod (same origin via Caddy).
API_TRUSTED_ORIGINS=http://localhost:8081

# Auth. `node scripts/gen-dev-env.mjs` fills the keys with random values and shares them with apps/api/.env.
# Origin the web app is served from (Caddy). Production: https://<your domain>.
API_APP_ORIGIN=http://localhost:8080
# Which header names the client: cloudflare when the tunnel is the only way in (the API then trusts
# cf-connecting-ip), caddy when Caddy's port is reachable directly. Never none behind a proxy.
API_TRUST_PROXY=caddy
API_AUTH_HMAC_KEY=change-me-key-auth-hmac
API_IP_HASH_KEY=change-me-key-ip-hash
API_TOTP_ENC_KEY=v1:change-me-key-totp
# Earlier TOTP keys, comma-separated, kept only while secrets they encrypted are still stored; a secret
# read with one is re-encrypted with API_TOTP_ENC_KEY.
API_TOTP_ENC_KEYS_PREVIOUS=
# Encrypts what a signed-out notifier leaves to be told about their notice: a name, an address and the token of the
# mails' link. Keep it secret and backed up as API_TOTP_ENC_KEY is: without it korbat can neither mail a notifier nor
# say who sent a notice.
API_NOTIFIER_ENC_KEY=v1:change-me-key-notifier
# Earlier notifier keys, comma-separated. A contact is never encrypted again, so a key stays here while a contact it
# encrypted is still stored.
API_NOTIFIER_ENC_KEYS_PREVIOUS=
# Cloudflare's documented always-pass test secret. Production uses the secret of your Turnstile widget.
API_TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
# Mailpit from compose.dev.yml. Production: the EU relay, e.g. smtps://user:pass@smtp-relay.example:465
API_SMTP_URL=smtp://mailpit:1025
API_MAIL_FROM="korbat <no-reply@korbat.local>"
API_TERMS_VERSION=draft-2026-09
# Who checks the phone number behind the verified badge: off turns the badge off, dev accepts the code
# 000000 (development only; production refuses it), vonage texts a real code through Vonage Verify with the
# key and secret from the Vonage dashboard (the runbook in the 1b design says how).
API_VERIFY_PROVIDER=off
# Whether the web app's account settings show the verified badge section: on or off. Set it together with
# API_VERIFY_PROVIDER: off while that is off, on once it is dev or vonage (a section shown without a provider
# answers every Send code with "Verification is not available"). The web image reads it as EXPO_PUBLIC_BADGE,
# which Expo inlines at export time.
WEB_BADGE=off
API_VONAGE_API_KEY=
API_VONAGE_API_SECRET=
# The sender name of the verification text: 1 to 18 characters, none of / { } : $.
API_VERIFY_BRAND=korbat
# Passkeys. The RP ID every passkey is bound to: empty means the host of API_APP_ORIGIN. It may instead be a parent
# domain of that host (korbat.example for app.korbat.example). The staff console does not use it: staff keys have their
# own RP ID. Production refuses an IP address or localhost. Choose it before the first passkey is added: changing it
# later strands every passkey.
API_WEBAUTHN_RP_ID=
# The site name password managers show next to a korbat passkey: 1 to 64 printable characters; empty means korbat.
API_WEBAUTHN_RP_NAME=

# The staff console: the origin staff open it at, served by Caddy's second site (port 8090 in its container). Empty
# switches the console off: every /api/staff path then answers 404. It must differ from API_APP_ORIGIN and never appear
# in API_TRUSTED_ORIGINS. In development it is localhost on the port compose.dev.yml publishes the console on
# (DEV_CONSOLE_PORT below); open it there, never at 127.0.0.1. Production: https://<the console's own hostname>, a
# hostname apart from the app's.
API_CONSOLE_ORIGIN=http://localhost:8090
# The RP ID staff keys are bound to: empty means the hostname of API_CONSOLE_ORIGIN, which production requires. Choose
# the console's hostname before the first staff key is enrolled: moving the console later means enrolling every key
# again.
API_CONSOLE_RP_ID=

# Moderation. The hour of the UTC day, 0 to 23, at which the day's decisions on reports and notices are released to those
# who sent them, in one batch, so that nobody can tell from a mail's minute when a decision was made; empty means 7.
API_MODERATION_DISPATCH_HOUR=7
# The queue's emergency switch, published in the terms: on sorts cases whose open reports all come from unproven sources
# after the others of their lane, never below a less severe lane. off, the default, orders by lane and age alone.
API_MODERATION_DEFER_UNPROVEN=off

# Public Turnstile site key baked into the web image. Cloudflare's always-pass test key for development;
# production uses the site key of the same widget as API_TURNSTILE_SECRET_KEY.
WEB_TURNSTILE_SITE_KEY=1x00000000000000000000AA
# The address people write to when the report form does not work for them, to ask for their data, or about a decision.
# It is baked into the web image as EXPO_PUBLIC_CONTACT_EMAIL: the report form names it when the human check fails or
# the limits are reached, and the terms page shows it. The image refuses to build without an address, and a
# production build refuses a placeholder (a domain ending in .local, .localhost, .test, .invalid or .example, or
# example.com, example.org or example.net). A person reads this mailbox every working day.
WEB_CONTACT_EMAIL=contact@korbat.local

# development or production. It is the API's NODE_ENV (production refuses Turnstile test keys, plain-http
# origins and a relay without TLS) and a build argument of the web image (production refuses the
# Turnstile test site key). Set it to production before building the images for the public.
KORBAT_ENV=development
# on when cloudflared is the only way in: Caddy then keeps CF-Connecting-IP for the API (and
# API_TRUST_PROXY is cloudflare). off drops the header, so nobody on the network can claim an address.
TUNNEL=off
# Cloudflare Tunnel token (Zero Trust > Networks > Tunnels). Only needed with --profile tunnel. The
# tunnel has two public hostnames: the app's, pointing at http://caddy:8080, and the staff console's (the hostname of
# API_CONSOLE_ORIGIN), pointing at http://caddy:8090. Leave the HTTP Host Header setting of each empty, so the API sees
# the hostname the browser used.
TUNNEL_TOKEN=

# The development stack's host ports, read only by infra/compose.dev.yml. Set one when another container
# on this machine holds the default, and give apps/api/.env the same port. Defaults: 55432, 56379, 3000,
# 8080, 8090, 51025, 58025.
# DEV_PG_PORT=55432
# DEV_REDIS_PORT=56379
# DEV_API_PORT=3000
# DEV_CADDY_PORT=8080
# The staff console's port: API_CONSOLE_ORIGIN must name the same port on localhost (http://localhost:<port>).
# DEV_CONSOLE_PORT=8090
# DEV_SMTP_PORT=51025
# DEV_MAILPIT_PORT=58025
```

### Replace `infra/caddy/Dockerfile` (whole file)

```dockerfile
FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS web
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
# pnpm verifies the repository patches named in package.json at every install, hashed into the lockfile.
COPY patches ./patches
# pnpm at the version and hash the root package.json names; corepack verifies the download against the hash.
RUN corepack enable && corepack install
COPY packages ./packages
COPY apps/app ./apps/app
RUN pnpm install --frozen-lockfile --filter @korbat/app...
# The public Turnstile site key is inlined into the web bundle at export time. It is not a secret.
ARG EXPO_PUBLIC_TURNSTILE_SITE_KEY
ARG KORBAT_ENV=development
RUN test -n "$EXPO_PUBLIC_TURNSTILE_SITE_KEY" || { echo "the EXPO_PUBLIC_TURNSTILE_SITE_KEY build argument is required" >&2; exit 1; }
# Cloudflare's test keys pass every check, so a production build refuses them.
RUN if [ "$KORBAT_ENV" = "production" ]; then case "$EXPO_PUBLIC_TURNSTILE_SITE_KEY" in [123]x0*AA) echo "EXPO_PUBLIC_TURNSTILE_SITE_KEY is a Turnstile test key; a production build needs the site key of your own widget" >&2; exit 1;; esac; fi
# Whether the account settings show the verified badge section (WEB_BADGE in infra/.env): on only when the API's
# verification provider is on, off by default as the provider is. Anything else is refused, so a typo cannot hide or show it.
ARG EXPO_PUBLIC_BADGE=off
RUN case "$EXPO_PUBLIC_BADGE" in on|off) ;; *) echo "EXPO_PUBLIC_BADGE must be on or off" >&2; exit 1;; esac
# The users' contact address (WEB_CONTACT_EMAIL in infra/.env), inlined like the site key: the report form names it when
# the form itself cannot be used, and the terms page shows it. A build without an address is refused, and a production
# build refuses a placeholder domain, as it refuses a Turnstile test key: mail to it would reach nobody.
ARG EXPO_PUBLIC_CONTACT_EMAIL
RUN case "$EXPO_PUBLIC_CONTACT_EMAIL" in *?@?*.?*) ;; *) echo "the EXPO_PUBLIC_CONTACT_EMAIL build argument must be an email address" >&2; exit 1;; esac
RUN if [ "$KORBAT_ENV" = "production" ]; then case "$(printf %s "${EXPO_PUBLIC_CONTACT_EMAIL##*@}" | tr A-Z a-z)" in *.local|*.localhost|*.test|*.invalid|*.example|example.com|example.org|example.net) echo "EXPO_PUBLIC_CONTACT_EMAIL is a placeholder address; a production build needs the address people can write to" >&2; exit 1;; esac; fi
RUN cd apps/app && EXPO_PUBLIC_TURNSTILE_SITE_KEY="$EXPO_PUBLIC_TURNSTILE_SITE_KEY" EXPO_PUBLIC_BADGE="$EXPO_PUBLIC_BADGE" EXPO_PUBLIC_CONTACT_EMAIL="$EXPO_PUBLIC_CONTACT_EMAIL" npx expo export --platform web

# The staff console (apps/admin), in a stage of its own: its page takes no build argument and holds no secret, and its
# packages never meet the app's. esbuild writes dist/: index.html, favicon.svg and the hashed script and stylesheet.
FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS console
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
# pnpm verifies the repository patches named in package.json at every install, hashed into the lockfile.
COPY patches ./patches
# pnpm at the version and hash the root package.json names; corepack verifies the download against the hash.
RUN corepack enable && corepack install
COPY packages ./packages
COPY apps/admin ./apps/admin
RUN pnpm install --frozen-lockfile --filter @korbat/admin...
RUN pnpm --filter @korbat/admin build

FROM caddy:2.11.4-alpine@sha256:6aeddd44c3078b0f9a35206472a11420648a79c184603ef95957d0a20044cb2b
ARG TUNNEL=off
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
# Behind the tunnel cloudflared sets CF-Connecting-IP and the API needs it; anywhere else a client could set it.
RUN if [ "$TUNNEL" = "on" ]; then : > /etc/caddy/cf-header.caddy; else echo "header_up -CF-Connecting-IP" > /etc/caddy/cf-header.caddy; fi
COPY --from=web /repo/apps/app/dist /srv
# The console's site serves /console, a folder outside the app's /srv, so the app's site can never serve the console.
COPY --from=console /repo/apps/admin/dist /console
# The image's binary carries cap_net_bind_service as a file capability; with every capability dropped, the
# kernel refuses to run it ("operation not permitted"). Ports 8080 and 8090 need no capability, so it is removed.
RUN setcap -r /usr/bin/caddy
# Caddy runs as its own user on ports it may bind without privileges; its state directories are its own.
RUN adduser -D -u 10001 caddy && mkdir -p /data /config && chown -R caddy:caddy /data /config
USER caddy
# The app's site and the staff console's.
EXPOSE 8080 8090
```

### Replace `infra/compose.yml` (whole file)

```yaml
name: korbat

x-logging: &logging
  driver: json-file
  options: { max-size: "20m", max-file: "5" }

x-node-common: &node-common
  restart: unless-stopped
  read_only: true
  tmpfs: ["/tmp"]
  security_opt: ["no-new-privileges:true"]
  logging: *logging

services:
  postgres:
    # PostgreSQL 18. From 18 on the image keeps the cluster under /var/lib/postgresql/<major>/docker, so
    # the volume is mounted one level up and a later major can pg_upgrade inside it. A cluster from the
    # earlier pgdata volume (PostgreSQL 16) is moved over by scripts/pg-major-upgrade.mjs.
    image: postgres:18.6-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873
    restart: unless-stopped
    logging: *logging
    mem_limit: 1g
    memswap_limit: 1g
    pids_limit: 256
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
      KORBAT_MIGRATE_DB_PASSWORD: ${KORBAT_MIGRATE_DB_PASSWORD}
      KORBAT_API_DB_PASSWORD: ${KORBAT_API_DB_PASSWORD}
      KORBAT_AUTH_DB_PASSWORD: ${KORBAT_AUTH_DB_PASSWORD}
    volumes:
      - pgdata18:/var/lib/postgresql
      - ./postgres/init:/docker-entrypoint-initdb.d:ro
    networks: [data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 5s
      timeout: 3s
      retries: 20

  redis:
    # Valkey, the BSD-licensed fork of Redis, under the service name the URLs already use. A password
    # is required: nothing on the data network may read the session cache without it.
    image: valkey/valkey:9.1.2-alpine@sha256:48332870af354a799964c0012ae1194a0bf2bf894eb508f945810596dc2d8d11
    restart: unless-stopped
    logging: *logging
    mem_limit: 384m
    memswap_limit: 384m
    pids_limit: 64
    environment:
      REDIS_PASSWORD: ${REDIS_PASSWORD:?set REDIS_PASSWORD in infra/.env}
    command: ["sh", "-c", "exec valkey-server --appendonly yes --maxmemory 256mb --maxmemory-policy noeviction --requirepass $$REDIS_PASSWORD"]
    volumes:
    # A fresh volume: Valkey 9 cannot read the RDB format 12 that Redis 7.4 wrote into `redisdata`, and that
    # volume held only transient state (limits, codes in flight, cached sessions, queued image jobs).
      - valkeydata:/data
    networks: [data]
    healthcheck:
      test: ["CMD-SHELL", "VALKEYCLI_AUTH=$$REDIS_PASSWORD valkey-cli ping | grep -q PONG"]
      interval: 5s
      timeout: 3s
      retries: 20

  migrate:
    <<: *node-common
    restart: "no"
    build:
      context: ..
      dockerfile: apps/api/Dockerfile
    command: ["node", "dist/migrate.js"]
    environment:
      DATABASE_URL_MIGRATE: postgres://korbat_migrate:${KORBAT_MIGRATE_DB_PASSWORD}@postgres:5432/${POSTGRES_DB}
      MIGRATIONS_DIR: /app/migrations
      # `staff.js enroll` runs here, as the migrator, the one role the running API never holds, and records on each link
      # the console's origin and relying party ID it is issued for. Empty, the console is off and enroll refuses.
      CONSOLE_ORIGIN: ${API_CONSOLE_ORIGIN:-}
      CONSOLE_RP_ID: ${API_CONSOLE_RP_ID:-}
    networks: [data]
    depends_on:
      postgres: { condition: service_healthy }

  api:
    <<: *node-common
    build:
      context: ..
      dockerfile: apps/api/Dockerfile
      args:
        KORBAT_VERSION: ${KORBAT_VERSION:-0.0.0}
    mem_limit: 512m
    memswap_limit: 512m
    pids_limit: 256
    environment:
      # development or production, from infra/.env; production turns on the guards against test keys, plain-http
      # origins and a relay without TLS. The worker below always runs as production.
      NODE_ENV: ${KORBAT_ENV:?set KORBAT_ENV to development or production in infra/.env}
      PORT: "3000"
      LOG_LEVEL: ${API_LOG_LEVEL:-info}
      DATABASE_URL_API: postgres://korbat_api:${KORBAT_API_DB_PASSWORD}@postgres:5432/${POSTGRES_DB}
      DATABASE_URL_AUTH: postgres://korbat_auth:${KORBAT_AUTH_DB_PASSWORD}@postgres:5432/${POSTGRES_DB}
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379
      TRUSTED_ORIGINS: ${API_TRUSTED_ORIGINS:-}
      # Which header names the client: the stack refuses to start without a choice.
      TRUST_PROXY: ${API_TRUST_PROXY:?set API_TRUST_PROXY in infra/.env}
      # Auth settings. The stack refuses to start while any of these is missing from infra/.env.
      APP_ORIGIN: ${API_APP_ORIGIN:?set API_APP_ORIGIN in infra/.env}
      AUTH_HMAC_KEY: ${API_AUTH_HMAC_KEY:?set API_AUTH_HMAC_KEY in infra/.env}
      IP_HASH_KEY: ${API_IP_HASH_KEY:?set API_IP_HASH_KEY in infra/.env}
      TOTP_ENC_KEY: ${API_TOTP_ENC_KEY:?set API_TOTP_ENC_KEY in infra/.env}
      TOTP_ENC_KEYS_PREVIOUS: ${API_TOTP_ENC_KEYS_PREVIOUS:-}
      # Encrypts a signed-out notifier's name and address; earlier keys stay accepted for decryption.
      NOTIFIER_ENC_KEY: ${API_NOTIFIER_ENC_KEY:?set API_NOTIFIER_ENC_KEY in infra/.env}
      NOTIFIER_ENC_KEYS_PREVIOUS: ${API_NOTIFIER_ENC_KEYS_PREVIOUS:-}
      TURNSTILE_SECRET_KEY: ${API_TURNSTILE_SECRET_KEY:?set API_TURNSTILE_SECRET_KEY in infra/.env}
      SMTP_URL: ${API_SMTP_URL:?set API_SMTP_URL in infra/.env}
      MAIL_FROM: ${API_MAIL_FROM:?set API_MAIL_FROM in infra/.env}
      TERMS_VERSION: ${API_TERMS_VERSION:?set API_TERMS_VERSION in infra/.env}
      # The verified badge's phone check. off (the default) hides the badge; vonage needs the two credentials.
      VERIFY_PROVIDER: ${API_VERIFY_PROVIDER:-off}
      VONAGE_API_KEY: ${API_VONAGE_API_KEY:-}
      VONAGE_API_SECRET: ${API_VONAGE_API_SECRET:-}
      VERIFY_BRAND: ${API_VERIFY_BRAND:-korbat}
      # Passkeys. Empty values leave the API's defaults: the host of APP_ORIGIN as the RP ID and korbat as the name.
      WEBAUTHN_RP_ID: ${API_WEBAUTHN_RP_ID:-}
      WEBAUTHN_RP_NAME: ${API_WEBAUTHN_RP_NAME:-}
      # The staff console, served by Caddy's second site: the origin staff open it at, and the RP ID staff keys are bound
      # to (empty means the console's hostname). An empty origin switches the console off: every /api/staff path then
      # answers 404. The migrate service gets the same two values for `staff.js enroll`.
      CONSOLE_ORIGIN: ${API_CONSOLE_ORIGIN:-}
      CONSOLE_RP_ID: ${API_CONSOLE_RP_ID:-}
      # Moderation: the UTC hour of the daily release of decisions to those who reported, and the queue's emergency switch.
      MODERATION_DISPATCH_HOUR: ${API_MODERATION_DISPATCH_HOUR:-7}
      MODERATION_DEFER_UNPROVEN: ${API_MODERATION_DEFER_UNPROVEN:-off}
      # Images. The API writes uploads and only reads what the worker stored.
      MEDIA_UPLOADS_DIR: /media/uploads
      MEDIA_STORE_DIR: /media/store
      MEDIA_FORMATS: ${MEDIA_FORMATS:-jpeg,png,webp,gif,avif}
      MEDIA_MIN_FREE_BYTES: ${MEDIA_MIN_FREE_BYTES:-2147483648}
      MEDIA_RECONCILE: ${MEDIA_RECONCILE:-on}
    volumes:
      - media-uploads:/media/uploads
      - media-store:/media/store:ro
    networks: [app, data]
    depends_on:
      migrate: { condition: service_completed_successfully }
      redis: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/api/health"]
      interval: 10s
      timeout: 3s
      retries: 10

  # The image worker runs the decoder, the most exploitable code in the stack. It has no network at
  # all, no credentials and no capabilities: it reads uploads and writes the store, and that is
  # everything it can reach. The memory limit was sized on worst-case images (2b design, Research).
  worker:
    <<: *node-common
    build:
      context: ..
      dockerfile: apps/worker/Dockerfile
    network_mode: none
    cap_drop: [ALL]
    mem_limit: 768m
    memswap_limit: 768m
    cpus: 1.0
    pids_limit: 64
    tmpfs: ["/tmp:size=64m"]
    environment:
      NODE_ENV: production
      LOG_LEVEL: ${API_LOG_LEVEL:-info}
      MEDIA_UPLOADS_DIR: /media/uploads
      MEDIA_STORE_DIR: /media/store
      MEDIA_FORMATS: ${MEDIA_FORMATS:-jpeg,png,webp,gif,avif}
    volumes:
      - media-uploads:/media/uploads:ro
      - media-store:/media/store
    healthcheck:
      test: ["CMD", "node", "-e", "process.exit(Date.now() - JSON.parse(require('fs').readFileSync('/media/store/heartbeat', 'utf8')).at < 60000 ? 0 : 1)"]
      interval: 15s
      timeout: 5s
      retries: 4

  # Caddy serves the web app on port 8080, proxying /api, and the staff console on port 8090, proxying only
  # /api/staff. It runs as its own user, sees only the API, and is the only thing cloudflared can reach.
  caddy:
    restart: unless-stopped
    read_only: true
    tmpfs: ["/tmp"]
    security_opt: ["no-new-privileges:true"]
    cap_drop: [ALL]
    logging: *logging
    mem_limit: 128m
    memswap_limit: 128m
    pids_limit: 64
    build:
      context: ..
      dockerfile: infra/caddy/Dockerfile
      args:
        EXPO_PUBLIC_TURNSTILE_SITE_KEY: ${WEB_TURNSTILE_SITE_KEY:?set WEB_TURNSTILE_SITE_KEY in infra/.env}
        KORBAT_ENV: ${KORBAT_ENV:?set KORBAT_ENV to development or production in infra/.env}
        TUNNEL: ${TUNNEL:-off}
        EXPO_PUBLIC_BADGE: ${WEB_BADGE:-off}
        EXPO_PUBLIC_CONTACT_EMAIL: ${WEB_CONTACT_EMAIL:?set WEB_CONTACT_EMAIL in infra/.env}
    depends_on:
      api: { condition: service_healthy }
    volumes:
      - caddy-data:/data
      - caddy-config:/config
    networks: [edge, app]

  cloudflared:
    image: cloudflare/cloudflared:2026.9.1@sha256:b269e8abd07a5bf6f3f4be65d5050b2174eca89c56a0241a8ff32a16aec454e4
    restart: unless-stopped
    read_only: true
    security_opt: ["no-new-privileges:true"]
    cap_drop: [ALL]
    logging: *logging
    profiles: ["tunnel"]
    command: ["tunnel", "--no-autoupdate", "run"]
    environment:
      TUNNEL_TOKEN: ${TUNNEL_TOKEN}
    networks: [edge]
    depends_on:
      - caddy

# cloudflared reaches only Caddy, Caddy reaches only the API, and the API alone reaches the data services.
networks:
  edge:
  app:
  data:

volumes:
  # PostgreSQL 18. The earlier pgdata volume (PostgreSQL 16) stays until scripts/pg-major-upgrade.mjs has
  # moved it and you remove it by hand.
  pgdata18:
  valkeydata:
  # Uploads wait here for the worker and are deleted once processed. Nothing in it needs a backup.
  media-uploads:
  # The images korbat serves. Back it up together with the database.
  media-store:
  # Caddy's state, owned by its own user; the earlier root-owned caddydata and caddyconfig volumes can go.
  caddy-data:
  caddy-config:
```

### Replace `packages/contracts/src/moderation.ts` (whole file)

```ts
import { z } from "zod";
import { Email, OpaqueId, TurnstileToken } from "./auth";
import { hex, sha256, sha256Bytes, sortedJson, utf8 } from "./canonical";
import { MediaId } from "./media";
import { FORBIDDEN_FORMAT } from "./text";

// Moderation cases (3c design, section 10): the constants and digests that the database, the API, the console, the app,
// the mails and the terms share. Each is the one source its words and numbers are taken from. This module imports
// nothing from staff.ts, and the index evaluates it first, so staff.ts can read these constants while it loads; an import
// the other way round would be a cycle that fails at load. For the same reason it imports nothing from social.ts, whose
// shapes may come to name this module's constants: what a notice needs of a post's id and of a handle is written here.

// ---------------------------------------------------------------- rules, categories and keywords

/** The rulebook's rule ids. @korbat/rules holds the rules themselves; the contracts never import it. */
export const RULE_IDS = ["R1", "R2", "R3", "R4", "R5", "R6"] as const;
export type RuleId = (typeof RULE_IDS)[number];

/**
 * The 16 categories of the Commission's Transparency Database (read 2026-10-02), which every intake and decision carries.
 * The migration's CHECK lists are written from this constant, and a database test holds them to it. A value the
 * Commission removes stays here: a kept row may hold it, and only the lists offered for new input drop it.
 */
export const TDB_CATEGORIES = [
  "STATEMENT_CATEGORY_ANIMAL_WELFARE",
  "STATEMENT_CATEGORY_CONSUMER_INFORMATION",
  "STATEMENT_CATEGORY_CYBER_VIOLENCE",
  "STATEMENT_CATEGORY_CYBER_VIOLENCE_AGAINST_WOMEN",
  "STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS",
  "STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH",
  "STATEMENT_CATEGORY_INTELLECTUAL_PROPERTY_INFRINGEMENTS",
  "STATEMENT_CATEGORY_NEGATIVE_EFFECTS_ON_CIVIC_DISCOURSE_OR_ELECTIONS",
  "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE",
  "STATEMENT_CATEGORY_OTHER_VIOLATION_TC",
  "STATEMENT_CATEGORY_PROTECTION_OF_MINORS",
  "STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY",
  "STATEMENT_CATEGORY_SCAMS_AND_FRAUD",
  "STATEMENT_CATEGORY_SELF_HARM",
  "STATEMENT_CATEGORY_UNSAFE_AND_PROHIBITED_PRODUCTS",
  "STATEMENT_CATEGORY_VIOLENCE",
] as const;
export type TdbCategory = (typeof TDB_CATEGORIES)[number];

/** The two categories a notifier never chooses: a rule-only report gets the first, a notifier who is not sure the second. */
type UnofferedCategory = "STATEMENT_CATEGORY_OTHER_VIOLATION_TC" | "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE";
export type TdbFormCategory = Exclude<TdbCategory, UnofferedCategory>;

/** The 14 categories the illegal-ground form shows. */
export const TDB_FORM_CATEGORIES: readonly TdbFormCategory[] = TDB_CATEGORIES.filter(
  (category): category is TdbFormCategory => category !== "STATEMENT_CATEGORY_OTHER_VIOLATION_TC" && category !== "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE",
);

/**
 * The four choices of the path for child sexual abuse material and the Transparency Database keyword each stores. "abuse"
 * stores none: the database has no keyword for it.
 */
export const CSAM_KEYWORDS = {
  csam: "KEYWORD_CHILD_SEXUAL_ABUSE_MATERIAL",
  deepfake: "KEYWORD_CHILD_SEXUAL_ABUSE_MATERIAL_DEEPFAKE",
  grooming: "KEYWORD_GROOMING_SEXUAL_ENTICEMENT_MINORS",
  abuse: null,
} as const;
export type CsamKeywordChoice = keyof typeof CSAM_KEYWORDS;

/** The keywords a decision on the law may carry: in 3c only the Transparency Database's "Terrorist content". */
export const DECISION_KEYWORDS = ["KEYWORD_TERRORIST_CONTENT"] as const;
export type DecisionKeyword = (typeof DECISION_KEYWORDS)[number];

/** The category the composer presets for a decision under each rule. */
export const RULE_DEFAULT_CATEGORY = {
  R1: "STATEMENT_CATEGORY_OTHER_VIOLATION_TC",
  R2: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS",
  R3: "STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH",
  R4: "STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS",
  R5: "STATEMENT_CATEGORY_VIOLENCE",
  R6: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD",
} as const satisfies Record<RuleId, TdbCategory>;

// ---------------------------------------------------------------- lanes

/** The queue's lanes: 0 is the most urgent. A case takes the most severe lane of its unanswered items. */
export type Lane = 0 | 1 | 2;

/** R2 and R5 are urgent; R3 and R4 come next; R1 and R6 last. */
const RULE_LANES: Record<RuleId, Lane> = { R1: 2, R2: 0, R3: 1, R4: 1, R5: 0, R6: 2 };

/** The categories that are not in lane 2: violence, public security and self-harm are urgent; six more come next. */
const CATEGORY_LANES: Partial<Record<TdbCategory, Lane>> = {
  STATEMENT_CATEGORY_VIOLENCE: 0,
  STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY: 0,
  STATEMENT_CATEGORY_SELF_HARM: 0,
  STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS: 1,
  STATEMENT_CATEGORY_CYBER_VIOLENCE: 1,
  STATEMENT_CATEGORY_CYBER_VIOLENCE_AGAINST_WOMEN: 1,
  STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH: 1,
  STATEMENT_CATEGORY_PROTECTION_OF_MINORS: 1,
  STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE: 1,
};

/**
 * The lane of an intake's items, from its ground alone: nothing is weighted. The CSAM path is urgent whatever else is
 * said. Otherwise it is the more severe of the cited rule's lane and, on a notice that alleges illegality, the category's:
 * only there is the category a claim about the content, where on a rule report or a finding it is korbat's own
 * classification for the Transparency Database.
 */
export function laneFor(input: { ruleId: RuleId | null; allegesIllegal: boolean; csam: boolean; category: TdbCategory }): Lane {
  if (input.csam) return 0;
  const byRule: Lane = input.ruleId === null ? 2 : RULE_LANES[input.ruleId];
  const byCategory: Lane = input.allegesIllegal ? (CATEGORY_LANES[input.category] ?? 2) : 2;
  return byRule < byCategory ? byRule : byCategory;
}

// ---------------------------------------------------------------- limits and periods

/**
 * What one sender may send, published in the terms: intakes an hour and a day per network signed out and per account
 * signed in, the targets one notice names, and the bounds of its two texts in characters (the migration's CHECKs hold
 * the same numbers).
 */
export const NOTICE_LIMITS = {
  signedOut: { perHour: 5, perDay: 20 },
  signedIn: { perHour: 10, perDay: 50 },
  maxTargets: 10,
  explanationMax: 2000,
  citedLawMax: 300,
} as const;

/** A notice on the CSAM path names at most one account: one such target reaches every image on the account's posts. */
export const CSAM_NOTICE_MAX_ACCOUNTS = 1;

/** How many months back a case page counts earlier answers to reports of this kind about the same target or author. */
export const SUSPECT_EARLIER_MONTHS = 12;

/** How many rows of a seal's list the case answer carries. */
export const SEAL_LIST_MAX = 500;

/** The author's appeal and the re-examination window, in calendar months (appealDeadline, and appeal_deadline in SQL). */
export const APPEAL_MONTHS = 6;

/** Appeals a day per account, and re-examinations a day per account or network. */
export const DAILY_LIMITS = { appeals: 5, reexaminations: 5 } as const;

/**
 * How long 3c keeps each kind of data (the design's section 6.6), published in the terms. Each is a design choice, not a
 * legal figure.
 */
export const RETENTION = {
  /** Content restricted under R4 is erased once the restriction is final: this long after its author was told, or at the answer to their appeal. */
  r4FinalMonths: APPEAL_MONTHS,
  /** An intake's record (its texts and who sent it) goes this long after its last release. */
  intakeDays: 30,
  /** A reset field's old value stays readable this long after a lift that comes before the case's copies are erased. */
  resetValueDays: 30,
  /** A case's evidence waits this long after the case's newest snapshot or draft text. */
  evidenceHours: 24,
  /** Statements are erased this long after the account's deletion. */
  statementMonths: 12,
  /** The access log, and the reveal reasons its rows name. */
  accessLogMonths: 12,
  /** A notifier's contact goes this long after the last day korbat owed the notice something, */
  contactMonths: 6,
  /** and at most this long after the notice when nothing moved that day. */
  contactMaxMonths: 13,
  /** A notifier's confirmation of an address. */
  confirmationDays: 30,
  /** Backups are deleted this long after each was taken. No code of 3c enforces it: the README tells the operator. */
  backupDays: 30,
  /** An unconfirmed staff text is deleted after this long. */
  draftHours: 24,
  /** A mail still unsent this long after it was due is given up. */
  mailGiveUpDays: 5,
} as const;

// ---------------------------------------------------------------- measures

/** The ledger's kinds, in the order of the database's action_kind: the seven measures, then the five reversals. */
export const ACTION_KINDS = [
  "withhold",
  "remove",
  "seal_media",
  "withhold_media",
  "remove_media",
  "reset_display_name",
  "reset_bio",
  "restore",
  "unseal_media",
  "restore_media",
  "restore_display_name",
  "restore_bio",
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

/** What a measure acts on: a post, one image of it, every image its case reaches, or one of an account's two fields. */
export type MeasureTarget = "post" | "image" | "images" | "display_name" | "bio";

export interface MeasureSpec {
  /** A decision taken while deciding (interim) may hold it. */
  interim: boolean;
  /** A decision that decides the case (final) may hold it. */
  final: boolean;
  /** For a reversal, the measures it lifts (it names exactly one row of them); null for a measure. */
  lifts: readonly ActionKind[] | null;
  target: MeasureTarget;
  /** The words for it in the composer, the statement and the terms. */
  label: string;
}

/**
 * Every kind of the ledger: whether it is taken while deciding, when the case is decided, or is a reversal; its target;
 * and its label. A post or one image is withheld only while deciding and removed only when the case is decided; a seal
 * and a field reset are either. A reversal is neither: the database's triggers say which decision may hold one.
 */
export const MEASURES = {
  withhold: { interim: true, final: false, lifts: null, target: "post", label: "Withhold the post" },
  remove: { interim: false, final: true, lifts: null, target: "post", label: "Remove" },
  seal_media: { interim: true, final: true, lifts: null, target: "images", label: "Seal the images this case reaches" },
  withhold_media: { interim: true, final: false, lifts: null, target: "image", label: "Withhold one image" },
  remove_media: { interim: false, final: true, lifts: null, target: "image", label: "Remove one image" },
  reset_display_name: { interim: true, final: true, lifts: null, target: "display_name", label: "Reset display name" },
  reset_bio: { interim: true, final: true, lifts: null, target: "bio", label: "Reset bio" },
  restore: { interim: false, final: false, lifts: ["withhold", "remove"], target: "post", label: "Lift the restriction of the post" },
  unseal_media: { interim: false, final: false, lifts: ["seal_media"], target: "images", label: "Lift the seal" },
  restore_media: { interim: false, final: false, lifts: ["withhold_media", "remove_media"], target: "image", label: "Lift the restriction of one image" },
  restore_display_name: { interim: false, final: false, lifts: ["reset_display_name"], target: "display_name", label: "Lift the reset of the display name" },
  restore_bio: { interim: false, final: false, lifts: ["reset_bio"], target: "bio", label: "Lift the reset of the bio" },
} as const satisfies Record<ActionKind, MeasureSpec>;

/** The seven measures and the five reversals, each list in the ledger's order: what a statement's data keeps apart. */
export const MEASURE_KINDS = ["withhold", "remove", "seal_media", "withhold_media", "remove_media", "reset_display_name", "reset_bio"] as const satisfies readonly ActionKind[];
export type MeasureKind = (typeof MEASURE_KINDS)[number];
export const REVERSAL_KINDS = ["restore", "unseal_media", "restore_media", "restore_display_name", "restore_bio"] as const satisfies readonly ActionKind[];
export type ReversalKind = (typeof REVERSAL_KINDS)[number];

/**
 * The console's fixed drafts of the facts and the reason of a seal (3c design, section 10). Nobody at korbat opens images
 * that are reported as child sexual abuse material, so none of these says or implies that korbat found them to be such
 * material, and each reason says that korbat's staff do not open them: the statement then tells its author what korbat
 * knows and no more. The composer fills them in, and the moderator may edit them. The two `added` drafts are for a case
 * whose suspect items korbat added for a quoted post: they never say that this post was reported, and name no other post.
 */
export const SEAL_DRAFTS = {
  facts: {
    notice_post: "korbat received a notice that reports images of this post as child sexual abuse material.",
    notice_account: "korbat received a notice that reports this account for child sexual abuse material. It does not say which images, so korbat sealed every image on the account's posts.",
    notice_added: "korbat received a notice about content on korbat that shows this post's images and reports them as child sexual abuse material.",
    finding_post: "A moderator reported images of this post as possible child sexual abuse material.",
    finding_account: "A moderator reported images on this account's posts as possible child sexual abuse material. korbat sealed every image on the account's posts.",
    finding_added: "A moderator reported content on korbat that shows this post's images as possible child sexual abuse material.",
  },
  reason: {
    deciding: "korbat's staff do not open images reported this way, so korbat has not assessed them. It hides them from everyone, you included, until an admin has answered the report.",
    final:
      "korbat's staff do not open images reported this way, so korbat has not assessed them. An admin found the report credible enough to keep the images sealed and to report them to the police, who can assess them.",
  },
} as const;

/**
 * The facts draft of a seal, chosen from the suspect items its decision considers: a notice's draft when any of them came
 * from a user's notice, else a finding's; the `added` form when every one of them is an item korbat added for a quoted
 * post (or a re-examination of one), else the post's or the account's by the case's target.
 */
export function sealFactsDraft(target: "post" | "account", items: readonly { source: "user" | "finding"; added: boolean }[]): string {
  if (items.length === 0) throw new Error("a seal's facts are drafted from the suspect items its decision considers: there is no suspect item");
  const from = items.some((item) => item.source === "user") ? "notice" : "finding";
  const about = items.every((item) => item.added) ? "added" : target;
  return SEAL_DRAFTS.facts[`${from}_${about}`];
}

/** One measure or reversal as a decision's confirmed params name it: its kind, and for an image measure the image. */
export interface DecisionActionParams {
  kind: ActionKind;
  mediaId: string | null;
}

/**
 * The one order a decision's actions are confirmed in: by kind and then by image, each compared as a string, an action
 * without an image first. The console sorts with it before it asks for the key, and the params' schema refuses any other
 * order, so the same decision always has the same hash.
 */
export function compareDecisionActions(a: DecisionActionParams, b: DecisionActionParams): number {
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  const [left, right] = [a.mediaId ?? "", b.mediaId ?? ""];
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Why a moderator reveals who sent a report: the choices of the reveal dialog. The reason itself is a saved text. */
export const REVEAL_REASON_CATEGORIES = ["impersonation_claim", "abuse_of_reporting", "legal_requirement", "other"] as const;
export type RevealReasonCategory = (typeof REVEAL_REASON_CATEGORIES)[number];

// ---------------------------------------------------------------- errors

/**
 * Every code the moderation flows put in ErrorEnvelope.error.code so far: what sending a report or a notice, reading its
 * status, taking it in and deciding a case raise, and what the console's case routes answer (a text that cannot be saved,
 * an image that is not shown, a source that cannot be revealed). The routes may also answer the shared invalid_request,
 * onboarding_required, not_found, rate_limited and service_unavailable, and the staff routes the staff codes. The codes
 * the database keeps to itself (moderation_column, quote_item_missing, read_committed_only) are not among them: no route
 * answers one.
 */
export const ModerationErrorCode = z.enum([
  "notice_link_invalid",
  "notice_link_offsite",
  "human_check_failed",
  "staff_cannot_report",
  "notice_not_found",
  "already_reported",
  "case_changed",
  "case_closed",
  "staff_recused",
  "staff_target",
  "admin_required",
  "decision_cap",
  "profile_changed",
  "snapshot_mismatch",
  "snapshot_erased",
  "text_not_found",
  "invalid_decision",
  "text_invalid",
  "text_quotes_user",
  "image_refused",
  "reveal_refused",
]);
export type ModerationErrorCode = z.infer<typeof ModerationErrorCode>;

// ---------------------------------------------------------------- reports and notices

/**
 * The rules a report or a notice may cite. R2 is offered nowhere: a report of child sexual abuse material goes a path of
 * its own, which records no sender, and only a moderator's finding cites R2 (the database refuses a user's intake that
 * does).
 */
export const REPORT_RULE_IDS = ["R1", "R3", "R4", "R5", "R6"] as const satisfies readonly RuleId[];
export type ReportRuleId = (typeof REPORT_RULE_IDS)[number];

/** How many characters the name a signed-out notifier gives may have. */
export const NOTICE_NAME_MAX = 100;

/** Any control character but the line feed. */
const TEXT_CONTROL = /[^\P{Cc}\n]/u;
/** Any control character at all: a name is one line. */
const LINE_CONTROL = /\p{Cc}/u;

const NOT_WELL_FORMED = { message: "half of a surrogate pair is not text" };
const NO_CONTROL = { message: "control characters are not allowed" };
const NO_FORMAT = { message: "invisible direction and spacing characters are not allowed" };
const SOME_TEXT = { message: "some text is needed" };

/**
 * A free text of a notice. The server stores it as it was written or refuses it, and never changes it: a well-formed
 * string with some text in it, no control character but the line feed, none of the invisible direction and spacing
 * characters, and at most `max` characters as PostgreSQL's char_length counts them, which is what the tables' CHECKs hold.
 */
const noticeText = (max: number) =>
  z
    .string()
    // A character outside the basic plane is two UTF-16 units, so this bound never refuses what the count below accepts.
    .max(2 * max)
    .refine(isWellFormed, NOT_WELL_FORMED)
    .refine((text) => !TEXT_CONTROL.test(text), NO_CONTROL)
    .refine((text) => !FORBIDDEN_FORMAT.test(text), NO_FORMAT)
    .refine((text) => text.trim().length > 0, SOME_TEXT)
    .refine((text) => Array.from(text).length <= max, { message: `at most ${max} characters` });

/** The name a signed-out notifier may give: one line under the same rules. */
const NotifierName = z
  .string()
  .max(2 * NOTICE_NAME_MAX)
  .refine(isWellFormed, NOT_WELL_FORMED)
  .refine((name) => !LINE_CONTROL.test(name), NO_CONTROL)
  .refine((name) => !FORBIDDEN_FORMAT.test(name), NO_FORMAT)
  .refine((name) => name.trim().length > 0, SOME_TEXT)
  .refine((name) => Array.from(name).length <= NOTICE_NAME_MAX, { message: `at most ${NOTICE_NAME_MAX} characters` });

/** A post's id in the lower case PostgreSQL returns, so an id written in any case names the same row. */
const TargetPostId = z.uuid().transform((id) => id.toLowerCase());

/** A handle as a notice names it: an optional leading @, then the 3 to 20 characters handles may contain, kept in lower case. */
const TargetHandle = z
  .string()
  .trim()
  .regex(/^@?[A-Za-z0-9_]{3,20}$/)
  .transform((value) => value.replace(/^@/, "").toLowerCase());

/**
 * A link as a notice gives it: an http or https address of at most 300 characters, kept as written. Whether it is an
 * address of this korbat, and of what, the route decides.
 */
const TargetLink = z.url({ protocol: /^https?$/ }).max(300);

/**
 * What a report or a notice names: a post by its id, optionally with the one of its images that is meant; an account by
 * its handle; or a korbat link, which the server parses. Nothing else can be named, and nothing can be attached.
 */
export const NoticeTarget = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("post"), id: TargetPostId, mediaId: MediaId.optional() }),
  z.strictObject({ kind: z.literal("account"), handle: TargetHandle }),
  z.strictObject({ kind: z.literal("link"), url: TargetLink }),
]);
export type NoticeTarget = z.infer<typeof NoticeTarget>;

const NoticeTargets = z.array(NoticeTarget).min(1).max(NOTICE_LIMITS.maxTargets);
const ReportRule = z.enum(REPORT_RULE_IDS);

/** The categories an illegal-ground notice may carry: the 14 the form shows, and "not specified" for someone who is not sure. */
const NoticeCategory = z.enum([...TDB_FORM_CATEGORIES, "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE"] as const);

/** The four choices of the path for child sexual abuse material. */
const CsamChoice = z.enum(Object.keys(CSAM_KEYWORDS) as [CsamKeywordChoice, ...CsamKeywordChoice[]]);

/**
 * One report or notice, by its ground. Each ground is a strict shape, so a member that belongs to another ground is
 * refused rather than ignored:
 *   - `rule`: it breaks a korbat rule (any but R2), with an optional explanation;
 *   - `illegal`: an Art. 16 notice that it is illegal, with the category, the explanation and the statement of good
 *     faith the Article asks for, optionally the law, a rule it also breaks and, from someone signed out, a name and an
 *     address (a signed-in sender's contact is their account, and the route refuses either from them);
 *   - `csam`: the path for child sexual abuse material, which asks no name or address and records no sender; its
 *     explanation and statement are optional, and it names at most CSAM_NOTICE_MAX_ACCOUNTS accounts, counted by the
 *     handles as named (the route counts again once the links are parsed).
 * `turnstileToken` is the human check of a signed-out sender; a signed-in sender's is ignored.
 */
export const NoticeRequest = z.discriminatedUnion("ground", [
  z.strictObject({
    ground: z.literal("rule"),
    ruleId: ReportRule,
    targets: NoticeTargets,
    explanation: noticeText(NOTICE_LIMITS.explanationMax).optional(),
    turnstileToken: TurnstileToken.optional(),
  }),
  z.strictObject({
    ground: z.literal("illegal"),
    targets: NoticeTargets,
    category: NoticeCategory,
    citedLaw: noticeText(NOTICE_LIMITS.citedLawMax).optional(),
    explanation: noticeText(NOTICE_LIMITS.explanationMax),
    bonaFide: z.literal(true),
    ruleId: ReportRule.optional(),
    name: NotifierName.optional(),
    email: Email.optional(),
    turnstileToken: TurnstileToken.optional(),
  }),
  z
    .strictObject({
      ground: z.literal("csam"),
      targets: NoticeTargets,
      keyword: CsamChoice,
      explanation: noticeText(NOTICE_LIMITS.explanationMax).optional(),
      bonaFide: z.boolean().optional(),
      turnstileToken: TurnstileToken.optional(),
    })
    .refine((notice) => new Set(notice.targets.flatMap((target) => (target.kind === "account" ? [target.handle] : []))).size <= CSAM_NOTICE_MAX_ACCOUNTS, {
      message: `a notice of this kind names at most ${CSAM_NOTICE_MAX_ACCOUNTS} account`,
      path: ["targets"],
    }),
]);
export type NoticeRequest = z.infer<typeof NoticeRequest>;

/** A notice's public reference: N- and ten base32 characters. */
export const NoticeRef = z.string().regex(/^N-[A-Z2-7]{10}$/);

/**
 * The answer to a report or a notice. The token comes only with a notice sent signed out or on the path for child sexual
 * abuse material: it opens the status page, and is shown once.
 */
export const NoticeResponse = z.object({ ref: NoticeRef, token: OpaqueId.optional() });
export type NoticeResponse = z.infer<typeof NoticeResponse>;

/** What the status page sends: the reference with the notice's own token, or with the token of a mail's link. */
export const NoticeStatusRequest = z.strictObject({ ref: NoticeRef, token: OpaqueId });
export type NoticeStatusRequest = z.infer<typeof NoticeStatusRequest>;

/** The page's two buttons, for which only the token of a mail's link works: "I sent this", or "stop korbat's mails about reports to this address". */
export const NoticeContactRequest = z.strictObject({ ref: NoticeRef, token: OpaqueId, choice: z.enum(["confirm", "stop"]) });
export type NoticeContactRequest = z.infer<typeof NoticeContactRequest>;

/** What an item's sender can be shown, as the database's item_outcome lists them. */
export const ITEM_OUTCOMES = ["restricted_rule", "restricted_legal", "no_violation", "not_evident", "not_available", "partly_reversed", "reversed"] as const;
export const ItemOutcome = z.enum(ITEM_OUTCOMES);
export type ItemOutcome = z.infer<typeof ItemOutcome>;

/**
 * One phrase for each outcome, which the mails, the status page and the app's list all take from here (3c design,
 * section 10). `{rule}` and `{title}` stand for the rule the restricting decision cites, in the wording of the rulebook
 * it was made under. A reader composes a whole answer with outcomeWords, never from these alone.
 */
export const OUTCOME_PHRASES = {
  restricted_rule: "access restricted: it breaks korbat rule {rule} ({title})",
  restricted_legal: "access restricted: korbat found it illegal",
  no_violation: "no action: korbat found no breach of its rules and nothing illegal",
  not_evident: "no action: korbat found no breach of its rules, and whether it is illegal cannot be seen without a detailed legal examination; a court or an authority can order its removal",
  not_available: "no action: the link names nothing korbat can show (checked automatically)",
  partly_reversed: "korbat reversed part of its decision to restrict it",
  reversed: "korbat reversed its decision to restrict it",
} as const satisfies Record<ItemOutcome, string>;

/** After a restricting outcome whose decision's measures all changed nothing when they were imposed. */
export const ALREADY_NOT_SHOWN = "It was already not shown on korbat, so nothing changed now; korbat's restriction stays in force should that change.";

/** After the outcome of an item about an account that is not suspect and whose answering decision sealed nothing. */
export const ACCOUNT_ITEM_SCOPE = "This answer concerns the account's display name and bio. korbat decides about its posts and images in cases of their own and does not report those here.";

/** After the outcome of an item about a post that quotes another (never a suspect item, whose quoted post has an item of its own). */
export const QUOTE_ITEM_SCOPE = "This answer concerns this post's own text and images. korbat decides about the post it quotes, shown inside its card, in a case of its own and does not report that here.";

/** After the outcome of an item about an account that is suspect, or that a decision holding a seal answered: that answer does concern the images on the account's posts. */
export const ACCOUNT_SUSPECT_SCOPE =
  "This answer concerns the account's display name and bio and, taken together, the images on its posts. korbat decides about single posts of the account, and about what its posts say, in cases of their own and does not report those here.";

/**
 * On the path for child sexual abuse material nobody opens the images, so no item is shown words that say korbat found
 * something about them. `sealed` stands for every item whose answering decision holds a seal, suspect or not, in place of
 * the two restricting phrases; `no_action` for a suspect item answered without action, in place of the two no-action ones.
 */
export const SUSPECT_OUTCOME_PHRASES = {
  sealed: "access restricted: korbat sealed its images without opening them. They are shown to nobody, their author included, and are kept for the authorities.",
  no_action:
    "no action: korbat's staff do not open images reported this way. An admin found in the report, and in what korbat can read and still holds of it, no sufficient ground to seal images or to restrict anything else.",
} as const;

/** After the restricting phrase of a suspect item that a decision answered by a measure on the post's text, without a seal. */
export const SUSPECT_NO_SEAL = "No image was sealed; korbat's staff do not open images reported this way.";

/**
 * For an item on another ground about a post that a decision answered without action while nobody could open the post's
 * images (decisions.unseen), in place of the two no-action phrases: it tells its sender the truth, and such an answer
 * does not spend the one re-examination.
 */
export const UNSEEN_NO_ACTION =
  "no action for now: when korbat decided, its staff could not open this post's images, because a report of another kind about them was waiting or they were sealed. If your report is about an image, ask for a re-examination.";

/** What decides how one item's outcome reads: the facts of the item and of the decision that answered it. */
export interface OutcomeWordsInput {
  outcome: ItemOutcome;
  /** The rule a `restricted_rule` outcome names, with its title in the rulebook the decision was made under; null for every other outcome. */
  rule: { id: string; title: string } | null;
  /** The item itself is suspect: a report of child sexual abuse material, or a finding citing R2. */
  suspect: boolean;
  /** The answering decision holds a seal. */
  sealed: boolean;
  /** The answering decision was taken while nobody could open the post's images, and the item is about a post and not suspect. */
  unseen: boolean;
  /** Every measure of the answering decision changed nothing when it was imposed. */
  noEffect: boolean;
  /** What the answer concerns, as the status answer gives it. */
  scope: "account" | "quote" | "account_suspect" | null;
}

const NO_ACTION: readonly ItemOutcome[] = ["no_violation", "not_evident"];
const RESTRICTING: readonly ItemOutcome[] = ["restricted_rule", "restricted_legal"];

/** A phrase as a sentence: with the one full stop it ends in. */
const sentence = (phrase: string): string => (phrase.endsWith(".") ? phrase : `${phrase}.`);

/**
 * One item's outcome as its sender reads it, in a mail's line, on the status page and in the app's list alike: the
 * outcome's phrase, then the sentences that follow it, in this order (3c design, section 7.8, step 4, and section 10).
 *   - The phrase. A restriction by a decision that holds a seal reads the `sealed` phrase, whatever the item's ground. A
 *     suspect item answered without action reads the `no_action` phrase. An item on another ground about a post, answered
 *     without action with the images out of sight, reads UNSEEN_NO_ACTION; an item about an account never does, since its
 *     answer concerns the display name and bio, which staff read. Every other outcome reads its own phrase, also a
 *     reversal and a link that named nothing on that path.
 *   - SUSPECT_NO_SEAL, after a suspect item's restriction that sealed nothing.
 *   - ALREADY_NOT_SHOWN, after a restricting outcome whose measures all changed nothing.
 *   - The scope's sentence, after every outcome but `not_available`.
 * The text ends in one full stop.
 */
export function outcomeWords(input: OutcomeWordsInput): string {
  const { outcome, scope } = input;
  const aboutAccount = scope === "account" || scope === "account_suspect";
  const parts: string[] = [];
  if (RESTRICTING.includes(outcome) && input.sealed) {
    parts.push(SUSPECT_OUTCOME_PHRASES.sealed);
  } else if (NO_ACTION.includes(outcome) && input.suspect) {
    parts.push(SUSPECT_OUTCOME_PHRASES.no_action);
  } else if (NO_ACTION.includes(outcome) && input.unseen && !aboutAccount) {
    parts.push(UNSEEN_NO_ACTION);
  } else if (outcome === "restricted_rule") {
    if (input.rule === null) throw new Error("a restriction under a rule is worded with its rule: none was given");
    const { id, title } = input.rule;
    // Each placeholder is filled by a function, so that no character of an id or a title is read as a pattern.
    parts.push(sentence(OUTCOME_PHRASES.restricted_rule.replace("{rule}", () => id).replace("{title}", () => title)));
  } else {
    parts.push(sentence(OUTCOME_PHRASES[outcome]));
  }
  if (RESTRICTING.includes(outcome)) {
    if (input.suspect && !input.sealed) parts.push(SUSPECT_NO_SEAL);
    if (input.noEffect) parts.push(ALREADY_NOT_SHOWN);
  }
  if (outcome !== "not_available") {
    if (scope === "account") parts.push(ACCOUNT_ITEM_SCOPE);
    if (scope === "account_suspect") parts.push(ACCOUNT_SUSPECT_SCOPE);
    if (scope === "quote") parts.push(QUOTE_ITEM_SCOPE);
  }
  return parts.join(" ");
}

/**
 * One item of a notice as its sender reads it. `link` is the item's korbat address, an account's built from the handle
 * as the notice named it and never from the handle the profile holds now. `scope` says what the answer concerns
 * (`account`, `quote`, `account_suspect`, or null). An item about an account carries its scope from the first moment,
 * whatever the handle named: `account_suspect` when the item is suspect or, once released, when its answering decision
 * sealed images, and `account` otherwise. `quote`, for a post that quotes another, comes only with the released outcome,
 * so that before the release nothing tells a live target from a link that names nothing. The page and the app add the
 * scope's sentence after every outcome but `not_available`. `quotedBy` is the position of the item this one was added for,
 * when korbat added it for a quoted post. `outcome` and `decidedOn` (a UTC day) stay null until the outcome is released,
 * and `sealed`, `unseen` and `reexamination` say nothing before that either: `sealed` that the answering decision sealed
 * images, `unseen` that it was taken while nobody could open the post's images, `reexamination` whether a re-examination
 * can still be asked for and until when (null for an item that cannot be re-examined). `changed` marks an outcome that a
 * review or a correction changed, `reexamines` the item of a re-examination. Two members come only with a released
 * outcome and only when they say something, since the outcome's words need them: `rule`, the rule a `restricted_rule`
 * outcome names, with its title in the rulebook the decision was made under, and `noEffect`, set when every measure of
 * the answering decision changed nothing when it was imposed.
 */
export const NoticeItemStatus = z.object({
  position: z.number().int().min(1).max(20),
  link: z.string(),
  scope: z.enum(["account", "quote", "account_suspect"]).nullable(),
  suspect: z.boolean(),
  sealed: z.boolean(),
  unseen: z.boolean(),
  quotedBy: z.number().int().min(1).max(10).nullable(),
  outcome: ItemOutcome.nullable(),
  decidedOn: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/).nullable(),
  changed: z.boolean(),
  reexamines: z.boolean(),
  reexamination: z.object({ open: z.boolean(), until: z.string() }).nullable(),
  rule: z.object({ id: z.enum(RULE_IDS), title: z.string() }).optional(),
  noEffect: z.literal(true).optional(),
});
export type NoticeItemStatus = z.infer<typeof NoticeItemStatus>;

/**
 * A released item's outcome as its sender reads it on the status page and in the app's list: the same composition as a
 * mail's line (outcomeWords), from the item's own facts. Null while nothing is released.
 */
export function itemOutcomeWords(item: NoticeItemStatus): string | null {
  if (item.outcome === null) return null;
  return outcomeWords({ outcome: item.outcome, rule: item.rule ?? null, suspect: item.suspect, sealed: item.sealed, unseen: item.unseen, noEffect: item.noEffect === true, scope: item.scope });
}

/**
 * The status page's answer. `items` holds the items the notice named, by position, and an item korbat added for a
 * quoted post directly after the item it was added for, from the first release that shows that item's outcome or its
 * own: listed earlier, it would tell that the named post exists. `contact` is null for a notice that left no name or
 * address; `confirmed` and `stopped` are null unless the request carried the token of a mail's link, so the answer to
 * whoever typed an address never depends on what korbat knows about that address.
 */
export const NoticeStatus = z.object({
  ref: NoticeRef,
  receivedAt: z.string(),
  items: z.array(NoticeItemStatus),
  contact: z.object({ given: z.boolean(), confirmed: z.boolean().nullable(), stopped: z.boolean().nullable() }).nullable(),
});
export type NoticeStatus = z.infer<typeof NoticeStatus>;

// ---------------------------------------------------------------- digests

/** Names the rule a text's digest is made by; a later rule gets a later tag. */
export const TEXT_DIGEST_TAG = "korbat.text.v1";

const SALT_HEX = /^[0-9a-f]{64}$/;

/** Whether every surrogate in the text is half of a pair: only then has it UTF-8 bytes. */
function isWellFormed(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i++;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/**
 * The salted digest of a free text (a staff text, a statement): the lower-case hex sha256 of the tag's bytes, a line
 * feed, the salt's 32 bytes and the text's UTF-8 bytes. The API, the console and text-verify call it, and the database's
 * CHECKs compute the same, so a stored text is always the one its digest names. The salt keeps a short text from being
 * confirmed by hashing guesses. A malformed salt or text is refused, never changed: TextEncoder would otherwise hash a
 * lone surrogate as another character.
 */
export async function textDigest(saltHex: string, text: string): Promise<string> {
  if (!SALT_HEX.test(saltHex)) throw new TypeError("a text digest's salt is 32 bytes as 64 lower-case hex characters");
  if (!isWellFormed(text)) throw new TypeError("a text digest is taken over a well-formed text: a lone surrogate has no UTF-8 bytes");
  const tag = utf8(TEXT_DIGEST_TAG);
  const body = utf8(text);
  const bytes = new Uint8Array(tag.length + 1 + 32 + body.length);
  bytes.set(tag, 0);
  bytes[tag.length] = 0x0a;
  for (let i = 0; i < 32; i++) bytes[tag.length + 1 + i] = Number.parseInt(saltHex.slice(2 * i, 2 * i + 2), 16);
  bytes.set(body, tag.length + 33);
  return hex(await sha256Bytes(bytes));
}

/** Names the rule a snapshot's digest is made by. */
export const SNAPSHOT_DIGEST_TAG = "korbat.snapshot.v1";

/**
 * What a snapshot's digest covers: its salt and everything it copied. A post's snapshot leaves the three profile fields
 * null, an account's the post's. Each image is its id, alt text and size, in position order; an alt text is null for an
 * image whose content was erased.
 */
export interface SnapshotDigestInput {
  salt: string;
  targetType: "post" | "account";
  targetId: string;
  /** When the snapshot was taken, as Date.prototype.toISOString writes it. */
  takenAt: string;
  authorHandle: string;
  postState: "visible" | "withheld" | "removed" | "deleted_by_author" | null;
  /** As Date.prototype.toISOString writes it. */
  postCreatedAt: string | null;
  replyToId: string | null;
  quoteOfId: string | null;
  body: string | null;
  media: { id: string; alt: string | null; width: number; height: number }[] | null;
  displayName: string | null;
  bio: string | null;
  handle: string | null;
}

/** A time as toISOString writes it: UTC, to the millisecond. Any other spelling of the same instant would hash differently. */
const ISO_MILLIS = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$/;

function isoTime(name: string, value: string): string {
  if (!ISO_MILLIS.test(value)) throw new TypeError(`a snapshot's ${name} is a UTC time to the millisecond, as toISOString writes it`);
  return value;
}

/**
 * The text a snapshot's digest is taken over: the sorted JSON of version 1 and the snapshot's members, each picked by
 * name, so that whatever else an answer carries, and in whatever order, the API and the console write the same text.
 */
export function snapshotText(snapshot: SnapshotDigestInput): string {
  return sortedJson({
    v: 1,
    salt: snapshot.salt,
    targetType: snapshot.targetType,
    targetId: snapshot.targetId,
    takenAt: isoTime("takenAt", snapshot.takenAt),
    authorHandle: snapshot.authorHandle,
    postState: snapshot.postState,
    postCreatedAt: snapshot.postCreatedAt === null ? null : isoTime("postCreatedAt", snapshot.postCreatedAt),
    replyToId: snapshot.replyToId,
    quoteOfId: snapshot.quoteOfId,
    body: snapshot.body,
    media: snapshot.media === null ? null : snapshot.media.map((image) => ({ id: image.id, alt: image.alt, width: image.width, height: image.height })),
    displayName: snapshot.displayName,
    bio: snapshot.bio,
    handle: snapshot.handle,
  });
}

/** A snapshot's digest: the lower-case hex sha256 of the tag, a line feed and snapshotText, in UTF-8. */
export async function snapshotDigest(snapshot: SnapshotDigestInput): Promise<string> {
  return hex(await sha256(`${SNAPSHOT_DIGEST_TAG}\n${snapshotText(snapshot)}`));
}

/**
 * The end of the author's appeal window and of the re-examination window: APPEAL_MONTHS calendar months after the person
 * was told, in UTC, at the same time of day. A day the target month lacks becomes that month's last day (31 August gives
 * the end of February). PostgreSQL's appeal_deadline computes the same; a test holds the two equal over every month end.
 */
export function appealDeadline(informedAt: Date): Date {
  const year = informedAt.getUTCFullYear();
  const month = informedAt.getUTCMonth() + APPEAL_MONTHS;
  // Day 0 of the month after the target month is the target month's last day; Date.UTC carries a month past 11 into the year.
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(informedAt.getUTCDate(), lastDay);
  return new Date(Date.UTC(year, month, day, informedAt.getUTCHours(), informedAt.getUTCMinutes(), informedAt.getUTCSeconds(), informedAt.getUTCMilliseconds()));
}

// ---------------------------------------------------------------- the console: findings, saved texts and reveals

/**
 * The categories a moderator's own finding may carry: every one of the Transparency Database's but "not specified",
 * which says that a notifier was not sure. A finding is korbat's own classification, never a notice. The console offers
 * exactly this list, so the form and the request's schema cannot come apart.
 */
export const FINDING_CATEGORIES: readonly TdbCategory[] = TDB_CATEGORIES.filter((category) => category !== "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE");
const FindingCategory = z.enum(FINDING_CATEGORIES as [TdbCategory, ...TdbCategory[]]);

/**
 * POST /api/staff/findings: a moderator's own finding. It names one target, as a notice does, cites a korbat rule (R2
 * among them: only a finding cites it) and carries a category. It has no other ground: a finding never alleges
 * illegality, so nothing the console sends can mark a decision as one that followed a notice or an order, and what the
 * moderator writes about it is a saved text, never a member of this request.
 */
export const FindingRequest = z.strictObject({ target: NoticeTarget, ground: z.literal("rule"), ruleId: z.enum(RULE_IDS), category: FindingCategory });
export type FindingRequest = z.infer<typeof FindingRequest>;

/** The case the finding opened or joined. */
export const FindingResponse = z.object({ caseId: z.uuid() });
export type FindingResponse = z.infer<typeof FindingResponse>;

/**
 * The kinds of text staff save, as the database's staff_text_kind lists them. A note and a recorded choice not to seal
 * are complete when saved; every other kind waits for the decision or the reveal that names it.
 */
export const STAFF_TEXT_KINDS = ["facts", "reason", "legal_reference", "review_reason", "reveal_reason", "note", "seal_declined"] as const;
export type StaffTextKind = (typeof STAFF_TEXT_KINDS)[number];

/** The longest text staff may save, in UTF-16 units: the bound of the Transparency Database's facts field. */
export const STAFF_TEXT_MAX = 5000;

const Hex64 = z.string().regex(/^[0-9a-f]{64}$/, "must be 64 lower-case hex characters");

/**
 * What is wrong with a text staff want to save, or null: it must be well formed (no half of a surrogate pair), hold no
 * control character below the space but the line feed, none of the invisible direction and spacing characters, and at
 * most STAFF_TEXT_MAX UTF-16 units. The server refuses such a text and never changes it; the console checks with the
 * same function before it sends one.
 */
export function staffTextProblem(text: string): "malformed" | "control" | "format" | "too_long" | null {
  if (!isWellFormed(text)) return "malformed";
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x20 && unit !== 0x0a) return "control";
  }
  if (FORBIDDEN_FORMAT.test(text)) return "format";
  if (text.length > STAFF_TEXT_MAX) return "too_long";
  return null;
}

/**
 * POST /api/staff/cases/:case/texts: a text with the salt the console drew and the digest it computed (textDigest). The
 * schema lets any string through: what a text must be is the route's to refuse, with text_invalid, so the console can
 * say what is wrong with it in place. A text of nothing, or of white space alone, the route refuses as an invalid
 * request, whatever its kind: no reason, no facts and no note is saved empty.
 */
export const StaffTextSaveRequest = z.strictObject({ kind: z.enum(STAFF_TEXT_KINDS), text: z.string(), salt: Hex64, digest: Hex64 });
export type StaffTextSaveRequest = z.infer<typeof StaffTextSaveRequest>;

/** The stored text's id and its digest, as the server recomputed it. */
export const StaffTextSaved = z.object({ id: z.uuid(), digest: Hex64 });
export type StaffTextSaved = z.infer<typeof StaffTextSaved>;

/** One of the person's own texts that no decision or reveal has named yet, with its salt, so the console can check it against its digest. */
export const StaffTextDraft = z.object({ id: z.uuid(), kind: z.enum(STAFF_TEXT_KINDS), text: z.string(), salt: Hex64, digest: Hex64, createdAt: z.iso.datetime() });
export type StaffTextDraft = z.infer<typeof StaffTextDraft>;

/** GET /api/staff/cases/:case/texts: the person's own drafts on the case, so a draft survives a reload or a sign-in. */
export const StaffTextsResponse = z.object({ texts: z.array(StaffTextDraft) });
export type StaffTextsResponse = z.infer<typeof StaffTextsResponse>;

/** POST /api/staff/cases/:case/snapshots: the new snapshot's id and digest, or the newest one's when nothing differed. Never its content: that is read with the case. */
export const StaffSnapshotTaken = z.object({ id: z.uuid(), digest: Hex64 });
export type StaffSnapshotTaken = z.infer<typeof StaffSnapshotTaken>;

/**
 * POST /api/staff/items/:item/reveal answers who sent the item: a signed-in reporter's handle, or the name a signed-out
 * notifier gave. Both are null when the name was forgotten between the confirmation and the read. Never an address.
 */
export const RevealResponse = z.object({ handle: z.string().nullable(), name: z.string().nullable() });
export type RevealResponse = z.infer<typeof RevealResponse>;

// ---------------------------------------------------------------- the console: the queue, the case and the overview

const UtcDay = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, "must be a UTC day");
const Count = z.number().int().nonnegative();
const LaneNumber = z.union([z.literal(0), z.literal(1), z.literal(2)]);
const TargetKind = z.enum(["post", "account"]);
const StoredPostState = z.enum(["visible", "withheld", "removed", "deleted_by_author"]);

/** How many cases one page of the queue holds. */
export const QUEUE_PAGE_SIZE = 50;

/**
 * One open case as the queue lists it: its lane, what it is about, since when it and its oldest unanswered item wait,
 * and what its unanswered items cite. `deferred` is set only under the emergency switch. Nothing here weighs a case:
 * the queue orders by lane and age alone.
 */
export const QueueRow = z.object({
  id: z.uuid(),
  lane: LaneNumber,
  targetType: TargetKind,
  openedAt: z.iso.datetime(),
  oldestOpenAt: z.iso.datetime(),
  openItems: Count,
  rules: z.array(z.enum(RULE_IDS)),
  categories: z.array(z.enum(TDB_CATEGORIES)),
  allegesIllegal: z.boolean(),
  suspect: z.boolean(),
  reexamination: z.boolean(),
  deferred: z.boolean(),
});
export type QueueRow = z.infer<typeof QueueRow>;

/** GET /api/staff/queue: a page of the queue in its order, and the cursor that asks for the next; null when there is none. */
export const QueuePage = z.object({ cases: z.array(QueueRow).max(QUEUE_PAGE_SIZE), nextCursor: z.string().nullable() });
export type QueuePage = z.infer<typeof QueuePage>;

/** The queue's cursor is the last row's sort key, as an opaque word the server made. */
export const QueueQuery = z.object({ cursor: z.string().regex(/^[A-Za-z0-9_-]{1,400}$/).optional() });
export type QueueQuery = z.infer<typeof QueueQuery>;

/** The fixed words for a source that is no signed-in reporter. A reporter's label is its letter: reporterLabel. */
export const SOURCE_LABELS = {
  notifier: "A notifier",
  anonymous: "Anonymous",
  staff: "Found by a moderator",
  unlinked: "A signed-in reporter no longer linked",
} as const;

/**
 * A signed-in reporter's label on one case: "Reporter A" for the first reporter of the case, "Reporter B" for the
 * second, and after Z two letters and more, as a spreadsheet names its columns. The letter is given per case, so one
 * person's letter on one case says nothing about another.
 */
export function reporterLabel(index: number): string {
  let letters = "";
  for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) letters = String.fromCharCode(65 + (n % 26)) + letters;
  return `Reporter ${letters}`;
}

/**
 * Who sent an item, as staff see it without a reveal: never a name, a handle or an address. A signed-in reporter is a
 * letter and four bands computed on read (the account's age, the items it filed, the share of its decided items that
 * were acted on, and the items answered while nobody could open the images, which are counted apart); a signed-out
 * notifier is whether a name and an address were given, confirmed or stopped, or that the contact is lost; a notice on
 * the path for child sexual abuse material is anonymous; a finding was found by a moderator. The label is one of the
 * console's own words for its kind, so no answer can put a text of its choosing where the console names a source.
 */
export const SourceSummary = z
  .object({
    kind: z.enum(["reporter", "notifier", "anonymous", "staff", "unlinked"]),
    label: z.string().max(40),
    accountAge: z.enum(["under_1_month", "1_to_12_months", "over_12_months"]).nullable(),
    itemsFiled: z.enum(["1", "2_to_9", "10_or_more"]).nullable(),
    actedOn: z.enum(["none_decided", "none", "under_half", "half_or_more"]).nullable(),
    answeredUnseen: z.enum(["none", "1", "2_to_9", "10_or_more"]).nullable(),
    named: z.boolean().nullable(),
    contactGiven: z.boolean().nullable(),
    confirmed: z.boolean().nullable(),
    suppressed: z.boolean().nullable(),
    contactLost: z.boolean(),
  })
  .refine((source) => (source.kind === "reporter" ? /^Reporter [A-Z]{1,4}$/.test(source.label) : source.label === SOURCE_LABELS[source.kind]), {
    message: "a source's label is its reporter's letter or the fixed words of its kind",
    path: ["label"],
  });
export type SourceSummary = z.infer<typeof SourceSummary>;

const SnapshotImage = z.object({ id: z.uuid(), alt: z.string().nullable(), width: z.number().int().positive(), height: z.number().int().positive() });

/**
 * A snapshot of a case's evidence. Shown, it carries everything its digest covers, each member under the name
 * snapshotDigest reads it by, so the console recomputes the digest from exactly what it displays. Withheld (erased, or
 * a copy of content that was erased since), it carries its id, its time and its digest and no content.
 */
export const CaseSnapshot = z.discriminatedUnion("withheld", [
  z.object({ id: z.uuid(), takenAt: z.iso.datetime(), digest: Hex64, withheld: z.literal(true) }),
  z.object({
    id: z.uuid(),
    takenAt: z.iso.datetime(),
    digest: Hex64,
    withheld: z.literal(false),
    salt: Hex64,
    targetType: TargetKind,
    targetId: z.uuid(),
    authorHandle: z.string(),
    postState: StoredPostState.nullable(),
    postCreatedAt: z.iso.datetime().nullable(),
    replyToId: z.uuid().nullable(),
    quoteOfId: z.uuid().nullable(),
    body: z.string().nullable(),
    media: z.array(SnapshotImage).nullable(),
    displayName: z.string().nullable(),
    bio: z.string().nullable(),
    handle: z.string().nullable(),
  }),
]);
export type CaseSnapshot = z.infer<typeof CaseSnapshot>;

/**
 * One item of a case, for staff: its ground and what its sender wrote, the image it points at (a hint), and its source
 * as a summary. `link` is the item's korbat address, an account's under the handle as it was named. `quotedByPosition`
 * is set on an item korbat added for a quoted post (the position of the item it was added for), `quotedCaseId` on a
 * suspect item whose post quotes another (the case of that post's item). A re-examination says which item of its notice
 * it re-examines, and whether the person reading decided that item. `erased` marks an item whose intake record was erased.
 */
export const CaseItem = z.object({
  id: z.uuid(),
  seq: z.number().int().positive(),
  position: z.number().int().min(1).max(20),
  createdAt: z.iso.datetime(),
  lane: LaneNumber,
  link: z.string(),
  ruleId: z.enum(RULE_IDS).nullable(),
  allegesIllegal: z.boolean(),
  csam: z.boolean(),
  category: z.enum(TDB_CATEGORIES),
  categoryKeyword: z.string().nullable(),
  citedLaw: z.string().nullable(),
  explanation: z.string().nullable(),
  mediaId: z.uuid().nullable(),
  suspect: z.boolean(),
  quotedByPosition: z.number().int().min(1).max(10).nullable(),
  quotedCaseId: z.uuid().nullable(),
  reexaminesPosition: z.number().int().min(1).max(20).nullable(),
  reexaminesYourDecision: z.boolean(),
  statement: z.string().nullable(),
  outcome: ItemOutcome.nullable(),
  answeredBy: z.uuid().nullable(),
  erased: z.boolean(),
  source: SourceSummary,
});
export type CaseItem = z.infer<typeof CaseItem>;

/**
 * One measure or reversal of a decision. A measure says whether it is in force and, when a reversal lifted it, which
 * decision's; `noEffect` says that it changed nothing anyone saw when it was imposed. A seal lists what it covers: the
 * posts and images, how many of the posts their author had deleted, and at most SEAL_LIST_MAX rows of the list itself,
 * oldest first, as text for the report to the police, never content.
 */
export const CaseDecisionAction = z.object({
  id: z.uuid(),
  kind: z.enum(ACTION_KINDS),
  mediaId: z.uuid().nullable(),
  noEffect: z.enum(["already", "deleted"]).nullable(),
  inForce: z.boolean(),
  reversesActionId: z.uuid().nullable(),
  liftedBy: z.uuid().nullable(),
  sealed: z
    .object({
      posts: Count,
      images: Count,
      deletedPosts: Count,
      list: z.array(z.object({ postId: z.uuid(), createdAt: z.iso.datetime(), images: z.number().int().positive() })).max(SEAL_LIST_MAX),
    })
    .nullable(),
});
export type CaseDecisionAction = z.infer<typeof CaseDecisionAction>;

/**
 * A decision as the case page shows it: the statement's data, who decided (a staff handle), the stored facts that it
 * was taken on a suspicion and with the images out of sight, and its measures. A text is null when the decision has
 * none of that kind or it was erased.
 */
export const CaseDecision = z.object({
  id: z.uuid(),
  kind: z.enum(["interim", "final", "review", "correction"]),
  outcome: z.enum(["restricted", "no_violation", "not_evident", "kept", "partly_reversed", "reversed"]),
  ground: z.enum(["incompatible", "illegal"]).nullable(),
  ruleId: z.enum(RULE_IDS).nullable(),
  rulesVersion: z.number().int().positive(),
  redressVersion: z.number().int().positive(),
  category: z.enum(TDB_CATEGORIES),
  categoryKeyword: z.string().nullable(),
  source: z.enum(["notice", "report", "own_initiative"]),
  decidedAt: z.iso.datetime(),
  staffHandle: z.string(),
  throughSeq: Count,
  answersFromSeq: Count.nullable(),
  reviewsDecisionId: z.uuid().nullable(),
  snapshotId: z.uuid(),
  suspect: z.boolean(),
  unseen: z.boolean(),
  needsAdmin: z.boolean(),
  endedInterim: z.boolean(),
  facts: z.string().nullable(),
  reason: z.string().nullable(),
  legalReference: z.string().nullable(),
  actions: z.array(CaseDecisionAction),
});
export type CaseDecision = z.infer<typeof CaseDecision>;

/** The author's appeal of a decision of the case, with its statement while korbat keeps it, and its answer. */
export const CaseAppeal = z.object({
  id: z.uuid(),
  decisionId: z.uuid(),
  filedAt: z.iso.datetime(),
  statement: z.string().nullable(),
  answeredAt: z.iso.datetime().nullable(),
  result: z.enum(["kept", "partly_reversed", "reversed"]).nullable(),
  answeredBy: z.uuid().nullable(),
});
export type CaseAppeal = z.infer<typeof CaseAppeal>;

/** A note on a case, or a recorded choice not to seal with its reason: who wrote it (a staff handle), when, and the text. */
export const CaseStaffText = z.object({ id: z.uuid(), staffHandle: z.string(), createdAt: z.iso.datetime(), text: z.string() });
export type CaseStaffText = z.infer<typeof CaseStaffText>;

/** One event of a case's history, in the order of their times: ids, enums and times, never text. */
export const CaseHistoryEntry = z.object({
  at: z.iso.datetime(),
  event: z.enum(["item", "snapshot", "decision", "appeal_filed", "appeal_answered", "note", "seal_declined", "reveal", "evidence_erased", "redaction"]),
  refId: z.uuid().nullable(),
  seq: z.number().int().nullable(),
  intakeKind: z.enum(["user", "finding"]).nullable(),
  ruleId: z.enum(RULE_IDS).nullable(),
  allegesIllegal: z.boolean().nullable(),
  csam: z.boolean().nullable(),
  reexamination: z.boolean().nullable(),
  decisionKind: z.enum(["interim", "final", "review", "correction"]).nullable(),
  outcome: z.enum(["restricted", "no_violation", "not_evident", "kept", "partly_reversed", "reversed"]).nullable(),
  staffHandle: z.string().nullable(),
  result: z.enum(["kept", "partly_reversed", "reversed"]).nullable(),
});
export type CaseHistoryEntry = z.infer<typeof CaseHistoryEntry>;

/**
 * What a case is about, as it stands now: a post with its state and its level, or an account with the handle, display
 * name and bio it holds now. `link` is the post's korbat address, as text: the console links nowhere into the app. A
 * member is null when the row is gone.
 */
export const CaseTarget = z.discriminatedUnion("type", [
  z.object({ type: z.literal("post"), id: z.uuid(), link: z.string(), authorHandle: z.string().nullable(), state: StoredPostState.nullable(), level: z.enum(["visible", "withheld", "removed"]).nullable() }),
  z.object({ type: z.literal("account"), id: z.uuid(), handle: z.string().nullable(), displayName: z.string().nullable(), bio: z.string().nullable(), deleted: z.boolean() }),
]);
export type CaseTarget = z.infer<typeof CaseTarget>;

/**
 * What a case on the path for child sexual abuse material shows in place of images: whether a suspect item is
 * unanswered, what the case reaches, and how often an admin answered such a report about this target or this author
 * without a seal in the last SUSPECT_EARLIER_MONTHS months, with the day staff last opened an image of the post in the
 * console. Counts and days only.
 */
export const CaseSuspicion = z.object({
  open: z.boolean(),
  reach: z.object({ posts: Count, images: Count, sealed: Count, served: Count, newestPostOn: UtcDay.nullable() }),
  earlier: z.object({
    target: z.object({ count: Count, lastOn: UtcDay.nullable(), imagesOpenedOn: UtcDay.nullable() }),
    author: z.object({ count: Count, lastOn: UtcDay.nullable() }),
  }),
});
export type CaseSuspicion = z.infer<typeof CaseSuspicion>;

/**
 * GET /api/staff/cases/:case: the case, its target as it stands, its evidence (newest first), its items, its decisions
 * with their measures and texts, its appeals, the reading person's own drafts, the notes and the recorded choices not to
 * seal, and its history. `suspicion` is set for a case that holds a suspect item or a seal. `imagesAllowed` is false
 * while the post is frozen, and for every account case: an account case shows no image.
 */
export const CaseView = z.object({
  id: z.uuid(),
  lane: LaneNumber,
  stateVersion: Count,
  intakeSeq: Count,
  answeredSeq: Count,
  openedAt: z.iso.datetime(),
  closedAt: z.iso.datetime().nullable(),
  target: CaseTarget,
  suspicion: CaseSuspicion.nullable(),
  imagesAllowed: z.boolean(),
  snapshots: z.array(CaseSnapshot),
  items: z.array(CaseItem),
  decisions: z.array(CaseDecision),
  appeals: z.array(CaseAppeal),
  drafts: z.array(StaffTextDraft),
  notes: z.array(CaseStaffText),
  sealsDeclined: z.array(CaseStaffText),
  history: z.array(CaseHistoryEntry),
});
export type CaseView = z.infer<typeof CaseView>;

// ---------------------------------------------------------------- the statement of reasons

/** A measure as a statement tells of it: what it was, the image of an image measure, whether it changed anything, and what a seal covers. */
export const StatementMeasure = z.object({
  kind: z.enum(MEASURE_KINDS),
  mediaId: z.uuid().nullable(),
  /** Null when the measure changed what someone sees; `already` or `deleted` when it did not. */
  noEffect: z.enum(["already", "deleted"]).nullable(),
  /** For a seal: the posts and images its list held when it was recorded, and how many of those images were on posts their author had deleted by then. */
  sealed: z.object({ posts: Count, images: Count, deletedImages: Count }).nullable(),
});
export type StatementMeasure = z.infer<typeof StatementMeasure>;

/**
 * What a statement says of a field reset that ended or was lifted: the decision that holds the reset (whose screen shows
 * the old value), whether korbat still kept that value when this decision was made, and the rule that decision cites,
 * since a value reset under R4 may have been erased by then.
 */
const ResetFacts = { resetDecisionId: z.uuid().nullable(), oldValueKept: z.boolean(), resetRuleId: z.enum(RULE_IDS).nullable() };

/** A reversal as a statement tells of it. The reset's facts are set only on the lifting of a field reset. */
export const StatementReversal = z.object({ kind: z.enum(REVERSAL_KINDS), mediaId: z.uuid().nullable(), ...ResetFacts });
export type StatementReversal = z.infer<typeof StatementReversal>;

/** A measure taken while deciding that ended with the decision, without a reversal. The reset's facts are set only on a field reset. */
export const StatementEndedMeasure = z.object({ kind: z.enum(MEASURE_KINDS), mediaId: z.uuid().nullable(), ...ResetFacts });
export type StatementEndedMeasure = z.infer<typeof StatementEndedMeasure>;

/**
 * The statement's data (3c design, section 10): everything a statement of reasons is rendered from, and nothing a later
 * event changes, so a statement reads as it was sent whenever it is rendered. It is the part of a decision that the
 * author's decision view, the console's preview and the mail share; @korbat/rules renders it (statementParagraphs).
 *   - `rulesVersion` and `redressVersion`: the rulebook and the redress texts the decision was made under.
 *   - `facts`, `reason`, `legalReference`: the staff texts, each null when the decision has none or it was erased.
 *   - `post`: the post a post case is about, by its id and creation time, which survive its deletion; null for an account case.
 *   - `endedMeasures`: the measures taken while deciding that ended with this decision. A seal taken while deciding is
 *     left out when the decision itself seals, since the images stay sealed.
 *   - `reviewed`: for a review or a correction, the decision it reviews, whose rule or law the statement renders
 *     under the rulebook version that decision was made under (`reviewed.rulesVersion`), never under its own.
 */
export const DecisionStatement = z.object({
  kind: z.enum(["interim", "final", "review", "correction"]),
  outcome: z.enum(["restricted", "no_violation", "not_evident", "kept", "partly_reversed", "reversed"]),
  ground: z.enum(["incompatible", "illegal"]).nullable(),
  ruleId: z.enum(RULE_IDS).nullable(),
  rulesVersion: z.number().int().positive(),
  redressVersion: z.number().int().positive(),
  legalReference: z.string().nullable(),
  facts: z.string().nullable(),
  reason: z.string().nullable(),
  source: z.enum(["notice", "report", "own_initiative"]),
  decidedAt: z.iso.datetime(),
  post: z.object({ id: z.uuid(), createdAt: z.iso.datetime() }).nullable(),
  measures: z.array(StatementMeasure),
  reversals: z.array(StatementReversal),
  endedMeasures: z.array(StatementEndedMeasure),
  reviewed: z
    .object({
      kind: z.enum(["interim", "final"]),
      ground: z.enum(["incompatible", "illegal"]).nullable(),
      ruleId: z.enum(RULE_IDS).nullable(),
      rulesVersion: z.number().int().positive(),
      legalReference: z.string().nullable(),
      decidedAt: z.iso.datetime(),
    })
    .nullable(),
});
export type DecisionStatement = z.infer<typeof DecisionStatement>;

// ---------------------------------------------------------------- the app: what the author and the reporter read

/** A page cursor of the app's moderation lists: an opaque word the API wrote. */
const ListCursor = z.string().regex(/^[A-Za-z0-9_-]{1,400}$/);

/** How many decisions one page of the author's list holds. */
export const AUTHOR_CASES_PAGE_SIZE = 20;

/**
 * One decision in its author's list (3c design, section 7.6): the decisions their author was told of, and no other.
 * `decidedOn` is the decision's UTC day, never the day its case opened, which would tell when a report arrived. `post` is
 * the post a decision about a post concerns, by its id and creation time; null for a decision about the account.
 * `actions` are what the decision did, measures and reversals, in the ledger's order of kinds; `endedInterim` says that
 * what korbat did while deciding ended with it. `ruleId` and `legal` name the rule or the law it rests on (neither for a
 * decision without a ground). `appealUntil` is the end of the appeal's window while an appeal can still be filed, and
 * `reversedOn` the UTC day a final restriction was reversed in full; both null otherwise.
 */
export const AuthorCaseRow = z.object({
  id: z.uuid(),
  kind: z.enum(["interim", "final", "review", "correction"]),
  outcome: z.enum(["restricted", "no_violation", "not_evident", "kept", "partly_reversed", "reversed"]),
  decidedOn: UtcDay,
  post: z.object({ id: z.uuid(), createdAt: z.iso.datetime() }).nullable(),
  actions: z.array(z.enum(ACTION_KINDS)),
  endedInterim: z.boolean(),
  ruleId: z.enum(RULE_IDS).nullable(),
  legal: z.boolean(),
  appealUntil: z.iso.datetime().nullable(),
  reversedOn: UtcDay.nullable(),
});
export type AuthorCaseRow = z.infer<typeof AuthorCaseRow>;

/** GET /api/moderation/cases: the decisions about the viewer's account, newest first. */
export const AuthorCasesPage = z.object({ decisions: z.array(AuthorCaseRow).max(AUTHOR_CASES_PAGE_SIZE), nextCursor: z.string().nullable() });
export type AuthorCasesPage = z.infer<typeof AuthorCasesPage>;

export const AuthorCasesQuery = z.object({ cursor: ListCursor.optional() });
export type AuthorCasesQuery = z.infer<typeof AuthorCasesQuery>;

/**
 * An image of the content a decision was made on, as the app's own image route serves it to its author. It is listed
 * only while that route serves it: never for a sealed image or one of a post its author deleted.
 */
export const DecisionImage = z.object({ id: MediaId, alt: z.string(), width: z.number().int().positive(), height: z.number().int().positive(), small: z.string(), large: z.string() });
export type DecisionImage = z.infer<typeof DecisionImage>;

/**
 * The content a decision was made on, from the decision's snapshot, or the reason it is not shown; the first that
 * applies, in this order (3c design, sections 7.6 and 10):
 *   - `r4_redacted`: an R4 redaction erased it when the restriction became final;
 *   - `erased`: korbat's copy was erased under its retention rules, on `contentErasedOn` (a UTC day); `postKept` says
 *     that the post itself is still in its author's profile;
 *   - `post`: the post's text, which is never sealed, and its images. `imagesHidden` says why none is listed: `sealed`
 *     (nobody is shown them, the author included), or `deleted_by_author` (kept for the case, served to nobody);
 *     `imageCount` is how many the snapshot holds either way. `deletedByAuthor` says that the author deleted the post;
 *   - `account`: the account's fields as the snapshot held them, which for a field reset is the value the reset removed.
 */
export const DecisionContent = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("r4_redacted") }),
  z.strictObject({ kind: z.literal("erased"), contentErasedOn: UtcDay, postKept: z.boolean() }),
  z.strictObject({
    kind: z.literal("post"),
    body: z.string(),
    deletedByAuthor: z.boolean(),
    images: z.array(DecisionImage),
    imageCount: Count,
    imagesHidden: z.enum(["sealed", "deleted_by_author"]).nullable(),
  }),
  z.strictObject({ kind: z.literal("account"), handle: z.string(), displayName: z.string(), bio: z.string() }),
]);
export type DecisionContent = z.infer<typeof DecisionContent>;

/**
 * GET /api/moderation/decisions/:id: one decision as its author reads it (3c design, sections 7.6 and 10). It is the
 * statement's data, which the app renders with statementParagraphs exactly as the mail was rendered, and what the
 * author's screen adds: `appealUntil` and `reversedOn` as the list gives them, and the content actioned.
 */
export const DecisionView = DecisionStatement.extend({
  id: z.uuid(),
  appealUntil: z.iso.datetime().nullable(),
  reversedOn: UtcDay.nullable(),
  content: DecisionContent,
});
export type DecisionView = z.infer<typeof DecisionView>;

/** How many reports one page of the reporter's list holds. */
export const REPORTS_PAGE_SIZE = 20;

/** One report or notice in its sender's list: its reference, when korbat received it, and its items as the status page gives them. */
export const ReportRow = z.object({ ref: NoticeRef, receivedAt: z.string(), items: z.array(NoticeItemStatus) });
export type ReportRow = z.infer<typeof ReportRow>;

/**
 * GET /api/moderation/reports: the viewer's own reports and notices, newest first, while korbat keeps their records.
 * `reportMailStopped` says that korbat's mails about reports to the account's address are stopped, which someone who
 * holds that address asked for.
 */
export const ReportsPage = z.object({ reports: z.array(ReportRow).max(REPORTS_PAGE_SIZE), nextCursor: z.string().nullable(), reportMailStopped: z.boolean() });
export type ReportsPage = z.infer<typeof ReportsPage>;

export const ReportsQuery = z.object({ cursor: ListCursor.optional() });
export type ReportsQuery = z.infer<typeof ReportsQuery>;

/** How many rows each of the overview's lists holds at most; its total says how many there are. */
export const OVERVIEW_LIST_MAX = 100;

const MailCounts = z.object({ receipts: Count, authorMails: Count, outcomes: Count });
const HandleCount = z.object({ handle: z.string(), count: Count });

/**
 * GET /api/staff/overview: what the home screen shows every staff member. Per lane the open cases and since when the
 * oldest unanswered item waits; the appeals waiting; every reveal of a source in the last 30 days, newest first, with
 * its staff handle and its case; per staff handle the images viewed and the findings opened today (UTC); the mails
 * waiting for more than an hour and those given up in the last 30 days; the decided items the daily release has not
 * released after 26 hours; and whether the emergency switch is on. And, of the path for child sexual abuse material,
 * three lists every staff member sees: the decisions of the last 30 days that lifted the protection of reported images
 * (a lifted seal, `unsealed`, or an admin's final answer to such a report without a seal, `dismissed`), the recorded
 * choices not to seal of the last 30 days, and the seals taken while deciding that are in force, each with what it
 * covers. Counts, times, handles and cases only.
 */
export const StaffOverview = z.object({
  lanes: z.array(z.object({ lane: LaneNumber, open: Count, oldestAt: z.iso.datetime().nullable() })).length(3),
  appealsWaiting: Count,
  reveals: z.object({ total: Count, items: z.array(z.object({ at: z.iso.datetime(), handle: z.string(), caseId: z.uuid() })).max(OVERVIEW_LIST_MAX) }),
  imagesToday: z.array(HandleCount),
  findingsToday: z.array(HandleCount),
  mailsWaiting: MailCounts,
  mailsFailed: MailCounts,
  releaseOverdue: Count,
  deferUnproven: z.boolean(),
  protectionLifted: z.object({ total: Count, items: z.array(z.object({ at: z.iso.datetime(), handle: z.string(), caseId: z.uuid(), kind: z.enum(["unsealed", "dismissed"]) })).max(OVERVIEW_LIST_MAX) }),
  sealsDeclined: z.object({ total: Count, items: z.array(z.object({ at: z.iso.datetime(), handle: z.string(), caseId: z.uuid() })).max(OVERVIEW_LIST_MAX) }),
  interimSeals: z.object({ total: Count, items: z.array(z.object({ at: z.iso.datetime(), handle: z.string(), caseId: z.uuid(), posts: Count, images: Count })).max(OVERVIEW_LIST_MAX) }),
});
export type StaffOverview = z.infer<typeof StaffOverview>;
```

### Replace `packages/contracts/src/social.ts` (whole file)

```ts
import { z } from "zod";
import { DisplayName, HandleInput } from "./auth";
import { HiddenMedia, MEDIA_MAX_PER_POST, MediaAttachment, MediaView } from "./media";
import { RULE_IDS } from "./moderation";
import { FORBIDDEN_FORMAT, visibleLength } from "./text";

/**
 * Every code the social endpoints add to ErrorEnvelope.error.code (plus the shared ones: invalid_request, not_found, rate_limited).
 * explore_refreshed (409) refuses a page of an Explore ranking that is no longer kept.
 */
export const SocialErrorCode = z.enum(["post_unavailable", "not_author", "blocked", "self_target", "account_too_new", "explore_refreshed"]);
export type SocialErrorCode = z.infer<typeof SocialErrorCode>;

/** Postgres returns lowercase ids; the canonical form, so a lookup by any spelling finds the row. */
export const PostId = z.uuid().transform((id) => id.toLowerCase());

/** A handle from a URL or a lookup box: an optional leading @, then the 3 to 20 characters handles may contain. */
export const HandleParam = z
  .string()
  .trim()
  .regex(/^@?[A-Za-z0-9_]{3,20}$/)
  .transform((value) => value.replace(/^@/, "").toLowerCase());

export const POST_MAX_LENGTH = 1000;

/** Length in code points, which is what Postgres char_length counts. */
export function postLength(body: string): number {
  return Array.from(body).length;
}

/** Unicode NFC, CR LF to LF, at most two consecutive line breaks, trimmed. The server and the composer use the same rule. */
export function normalizePostBody(raw: string): string {
  return raw.normalize("NFC").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Any control character other than tab and line feed. */
const FORBIDDEN_CONTROL = /[^\P{Cc}\t\n]/u;

/** A post body as stored: normalized, 1 to 1000 code points, some of them visible, no control or disguising characters. */
export const PostBody = z
  .string()
  .max(4000)
  .transform(normalizePostBody)
  .refine((body) => !FORBIDDEN_CONTROL.test(body), { message: "control characters are not allowed" })
  .refine((body) => !FORBIDDEN_FORMAT.test(body), { message: "invisible direction and spacing characters are not allowed" })
  .refine((body) => visibleLength(body) >= 1, { message: "a post needs some text" })
  .refine((body) => postLength(body) <= POST_MAX_LENGTH, { message: `posts have at most ${POST_MAX_LENGTH} characters` });

/** The text of a post that may also carry images: the same rule as PostBody, except that it may be empty. */
export const PostText = z
  .string()
  .max(4000)
  .transform(normalizePostBody)
  .refine((body) => !FORBIDDEN_CONTROL.test(body), { message: "control characters are not allowed" })
  .refine((body) => !FORBIDDEN_FORMAT.test(body), { message: "invisible direction and spacing characters are not allowed" })
  .refine((body) => postLength(body) <= POST_MAX_LENGTH, { message: `posts have at most ${POST_MAX_LENGTH} characters` });

/** A new post, reply or quote: text, up to four images that are ready, or both. */
export const CreatePostRequest = z
  .object({
    body: PostText.default(""),
    replyToId: PostId.optional(),
    quoteOfId: PostId.optional(),
    media: z.array(MediaAttachment).max(MEDIA_MAX_PER_POST).default([]),
  })
  .refine((post) => !(post.replyToId && post.quoteOfId), { message: "a post is a reply or a quote, not both", path: ["quoteOfId"] })
  .refine((post) => visibleLength(post.body) >= 1 || post.media.length >= 1, { message: "a post needs text or an image", path: ["body"] })
  .refine((post) => new Set(post.media.map((item) => item.id)).size === post.media.length, { message: "an image can be attached once", path: ["media"] });
export type CreatePostRequest = z.infer<typeof CreatePostRequest>;

// ---------------------------------------------------------------- posts

export const Author = z.object({ id: z.uuid(), handle: z.string(), displayName: z.string(), verified: z.boolean() });
export type Author = z.infer<typeof Author>;

/** Stands in for a post where its absence would break structure: an ancestor in a thread or a quoted embed. */
export const Tombstone = z
  .strictObject({ id: z.uuid(), deleted: z.literal(true).optional(), unavailable: z.literal(true).optional() })
  .refine((t) => t.deleted === true || t.unavailable === true, { message: "a tombstone is deleted or unavailable" });
export type Tombstone = z.infer<typeof Tombstone>;

/** Never deleted_by_author: deleted posts only ever appear as tombstones. */
export const PostState = z.enum(["visible", "withheld", "removed"]);
export type PostState = z.infer<typeof PostState>;

export const PostCounts = z.object({
  likes: z.number().int().min(0),
  reposts: z.number().int().min(0),
  replies: z.number().int().min(0),
  quotes: z.number().int().min(0),
});
export type PostCounts = z.infer<typeof PostCounts>;

export const ViewerPostState = z.object({ liked: z.boolean(), reposted: z.boolean(), bookmarked: z.boolean() });
export type ViewerPostState = z.infer<typeof ViewerPostState>;

const postFields = {
  id: z.uuid(),
  author: Author,
  body: z.string(),
  createdAt: z.iso.datetime(),
  state: PostState,
  /** The handle is null when the viewer could not open the parent: its author is blocked either way, or it is hidden or deleted. */
  replyTo: z.object({ id: z.uuid(), authorHandle: z.string().nullable() }).nullable(),
  counts: PostCounts,
  /** The post's images in order, each as the image or, where the reader is not shown it, as a hidden image in its place. Always present, often empty. */
  media: z.array(z.union([MediaView, HiddenMedia])),
  /** Present only for a signed-in viewer. */
  viewer: ViewerPostState.optional(),
};

/** A quoted post as embedded: one level deep, so its own quote is not expanded. */
export const QuotedPost = z.object({ ...postFields, quoteOf: z.null() });
export type QuotedPost = z.infer<typeof QuotedPost>;

/**
 * The decision behind the state of the viewer's own withheld or removed post (3c design, sections 5 and 7.6): the decision
 * of the strongest post measure in force, by its id, the rule it cites (null for a decision on the law), whether it rests
 * on the law, and whether korbat is still deciding. The app shows it as the chip that links to the statement.
 */
export const PostModeration = z.object({ decisionId: z.uuid(), ruleId: z.enum(RULE_IDS).nullable(), legal: z.boolean(), interim: z.boolean() });
export type PostModeration = z.infer<typeof PostModeration>;

export const PostView = z.object({
  ...postFields,
  /**
   * The author's "In Explore" chip (2c design, section 8): present, and true, only on the viewer's own post while it is in
   * the current Explore ranking with their switch on. Nobody else's view carries it, nor does a quoted embed. It sits here
   * rather than in `viewer`, which the like, repost and bookmark answers replace.
   */
  inExplore: z.literal(true).optional(),
  /** Present only on the viewer's own post while moderation withholds or removed it; nobody else's view carries it, nor does a quoted embed. */
  moderation: PostModeration.optional(),
  quoteOf: z.union([QuotedPost, Tombstone]).nullable(),
});
export type PostView = z.infer<typeof PostView>;

/** An item of a timeline or a profile's Posts tab. */
export const TimelineItem = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("post"), post: PostView }),
  z.object({ kind: z.literal("repost"), post: PostView, repostedBy: Author, repostedAt: z.iso.datetime() }),
]);
export type TimelineItem = z.infer<typeof TimelineItem>;

export function page<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}

export const TimelinePage = page(TimelineItem);
export type TimelinePage = z.infer<typeof TimelinePage>;
export const PostPage = page(PostView);
export type PostPage = z.infer<typeof PostPage>;

export const ThreadResponse = z.object({
  ancestors: z.array(z.union([PostView, Tombstone])),
  post: PostView,
  replies: PostPage,
});
export type ThreadResponse = z.infer<typeof ThreadResponse>;

// ---------------------------------------------------------------- engagement and graph

export const EngagementResponse = z.object({ counts: PostCounts, viewer: ViewerPostState });
export type EngagementResponse = z.infer<typeof EngagementResponse>;

export const FollowResponse = z.object({ following: z.boolean(), followerCount: z.number().int().min(0) });
export type FollowResponse = z.infer<typeof FollowResponse>;

export const BlockResponse = z.object({ blocked: z.boolean() });
export type BlockResponse = z.infer<typeof BlockResponse>;

export const MuteResponse = z.object({ muted: z.boolean() });
export type MuteResponse = z.infer<typeof MuteResponse>;

// ---------------------------------------------------------------- profiles

export const ProfileCounts = z.object({
  posts: z.number().int().min(0),
  followers: z.number().int().min(0),
  following: z.number().int().min(0),
});

export const ViewerProfileState = z.object({ following: z.boolean(), followedBy: z.boolean(), blocked: z.boolean(), muted: z.boolean() });
export type ViewerProfileState = z.infer<typeof ViewerProfileState>;

export const ProfileView = z.object({
  id: z.uuid(),
  handle: z.string(),
  displayName: z.string(),
  bio: z.string(),
  verified: z.boolean(),
  createdAt: z.iso.datetime(),
  counts: ProfileCounts,
  /** Present only for a signed-in viewer looking at someone else. */
  viewer: ViewerProfileState.optional(),
});
export type ProfileView = z.infer<typeof ProfileView>;

export const ProfileListItem = Author.extend({ bio: z.string(), viewerFollows: z.boolean().optional() });
export type ProfileListItem = z.infer<typeof ProfileListItem>;

export const ProfilePage = page(ProfileListItem);
export type ProfilePage = z.infer<typeof ProfilePage>;

// ---------------------------------------------------------------- profile editing

export const BIO_MAX_LENGTH = 160;

/** A bio as stored: trimmed, at most 160 code points, one line of plain text with no control or disguising characters. Empty clears it. */
export const Bio = z
  .string()
  .trim()
  // The line and paragraph separators (Zl, Zp) break a line as a newline does, without being control characters.
  .regex(/^[^\p{Cc}\p{Zl}\p{Zp}]*$/u, "control characters and line breaks are not allowed")
  .refine((bio) => !FORBIDDEN_FORMAT.test(bio), { message: "invisible direction and spacing characters are not allowed" })
  .refine((bio) => postLength(bio) <= BIO_MAX_LENGTH, { message: `bios have at most ${BIO_MAX_LENGTH} characters` });

/** What the profile screen saves: either field, or both. The handle has its own route and rules. */
export const ProfileEditRequest = z
  .object({ displayName: DisplayName.optional(), bio: Bio.optional() })
  .refine((edit) => edit.displayName !== undefined || edit.bio !== undefined, { message: "nothing to change" });
export type ProfileEditRequest = z.infer<typeof ProfileEditRequest>;

/** The handle rules and the 30-day cooldown are enforced by the flow, which answers with a specific error code. */
export const HandleChangeRequest = z.object({ handle: HandleInput });
export type HandleChangeRequest = z.infer<typeof HandleChangeRequest>;
```

## Step 4: verify: install

```bash
pnpm install --config.package-import-method=copy
```

Expected output contains:

- `Done in`

Must not contain:

- `ERR_PNPM`

Observed on the dry run:

```text
Done in 4.8s using pnpm v10.30.0
```

## Step 5: verify: frozen-install

```bash
pnpm install --frozen-lockfile
```

Expected output contains:

- `Done in`

Must not contain:

- `ERR_PNPM`

Observed on the dry run:

```text
Done in 3.6s using pnpm v10.30.0
```

## Step 6: verify: lockfile-age

```bash
node scripts/check-lockfile-age.mjs --base HEAD
```

Expected output contains:

- `all at least 7 days old`

Observed on the dry run:

```text
0 new package versions since HEAD; all at least 7 days old
```

## Step 7: verify: typecheck

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

## Step 8: verify: test

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
packages/db test:       Tests  60 passed (60)
packages/contracts test:       Tests  276 passed (276)
packages/media-protocol test:       Tests  21 passed (21)
packages/rules test:       Tests  47 passed (47)
apps/worker test:       Tests  45 passed (45)
apps/app test:       Tests  177 passed (177)
apps/admin test:       Tests  355 passed (355)
apps/api test:       Tests  692 passed | 976 skipped (1668)
```

## Step 9: verify: generate

```bash
pnpm --filter @korbat/db generate
```

Expected output contains:

- `No schema changes`

Observed on the dry run:

```text
No schema changes, nothing to migrate 😴
```

## Step 10: verify: compose-config

```bash
docker compose --env-file infra/.env.example -f infra/compose.yml config -q && echo config-ok
```

Expected output contains:

- `config-ok`

Observed on the dry run:

```text
config-ok
```

## Step 11: verify: export

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

## Step 12: verify: api-bundle

```bash
pnpm --filter @korbat/api build 2>&1 | tail -2 && node --check apps/api/dist/index.js && echo bundle-ok
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

## Step 13: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/index.ts`
- `apps/api/src/moderation/author-repo.ts`
- `apps/api/src/moderation/author.ts`
- `apps/api/src/moderation/index.ts`
- `apps/api/src/moderation/intake.ts`
- `apps/api/src/moderation/repo.ts`
- `apps/api/src/moderation/reports.ts`
- `apps/api/src/moderation/routes.ts`
- `apps/api/src/social/context.ts`
- `apps/api/src/social/index.ts`
- `apps/api/src/social/views.ts`
- `apps/api/test/integration/moderation-author.test.ts`
- `apps/api/test/integration/notices-harness.ts`
- `apps/api/test/moderation-author.test.ts`
- `apps/app/.env.example`
- `apps/app/package.json`
- `apps/app/src/app/notice/[ref].tsx`
- `apps/app/src/app/report.tsx`
- `apps/app/src/app/settings/cases/[id].tsx`
- `apps/app/src/app/settings/cases/index.tsx`
- `apps/app/src/app/terms.tsx`
- `apps/app/src/app/u/[handle]/index.tsx`
- `apps/app/src/components/SettingsNav.tsx`
- `apps/app/src/components/moderation/CasesLists.tsx`
- `apps/app/src/components/moderation/DecisionDetail.tsx`
- `apps/app/src/components/moderation/ItemLines.tsx`
- `apps/app/src/components/moderation/NoticeStatusView.tsx`
- `apps/app/src/components/moderation/ReportForm.tsx`
- `apps/app/src/components/social/MediaGrid.tsx`
- `apps/app/src/components/social/MediaViewer.tsx`
- `apps/app/src/components/social/PostCard.tsx`
- `apps/app/src/lib/api.ts`
- `apps/app/src/lib/moderation-words.ts`
- `apps/app/src/lib/moderation.ts`
- `apps/app/test/cases.test.tsx`
- `apps/app/test/lifecycle.test.tsx`
- `apps/app/test/report.test.tsx`
- `infra/.env.example`
- `infra/caddy/Dockerfile`
- `infra/compose.yml`
- `packages/contracts/src/moderation.ts`
- `packages/contracts/src/social.ts`
- `packages/contracts/test/author.test.ts`
- `pnpm-lock.yaml`

## Step 14: commit

```bash
git add -A
git commit -q -m "feat(api,app,contracts,infra): the app's side of moderation cases: GET /api/moderation/cases lists the decisions an author was told of and /decisions/:id answers one as its statement's data (DecisionView), with the content it was made on from the decision's snapshot, a sealed image as a placeholder and what was erased said as erased; /reports lists the viewer's own reports in the words of the mails, an account's item under the handle the report named, and POST /report-mail/resume ends a stop of their report mails; a post's view carries its author's chip (Under review, Removed) through the social module's options; the app gains the report form (a korbat rule, illegal content, child sexual abuse material; signed in or out, with or without an item), the notice status page with its words for sealed, unseen and added items, the cases and decision screens under Settings, Your reports, Report on posts, images and profiles, and Cases in the settings menu; @korbat/rules joins the app; the terms page gains its Contact section from EXPO_PUBLIC_CONTACT_EMAIL, which the Caddy image takes as a build argument from WEB_CONTACT_EMAIL and refuses when it is missing in production" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(api,app,contracts,infra): the app's side of moderation cases: GET /api/moderation/cases lists the decisions an author was told of and /decisions/:id answers one as its statement's data (DecisionView), with the content it was made on from the decision's snapshot, a sealed image as a placeholder and what was erased said as erased; /reports lists the viewer's own reports in the words of the mails, an account's item under the handle the report named, and POST /report-mail/resume ends a stop of their report mails; a post's view carries its author's chip (Under review, Removed) through the social module's options; the app gains the report form (a korbat rule, illegal content, child sexual abuse material; signed in or out, with or without an item), the notice status page with its words for sealed, unseen and added items, the cases and decision screens under Settings, Your reports, Report on posts, images and profiles, and Cases in the settings menu; @korbat/rules joins the app; the terms page gains its Contact section from EXPO_PUBLIC_CONTACT_EMAIL, which the Caddy image takes as a build argument from WEB_CONTACT_EMAIL and refuses when it is missing in production`.

## Report format (mandatory)

```text
TASK 7 REPORT
Files written: <count, expected 43>
Failing-test step (the error line): <paste>
Verify "install": <paste the expected lines as printed>
Verify "frozen-install": <paste the expected lines as printed>
Verify "lockfile-age": <paste the expected lines as printed>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "generate": <paste the expected lines as printed>
Verify "compose-config": <paste the expected lines as printed>
Verify "export": <paste the expected lines as printed>
Verify "api-bundle": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
