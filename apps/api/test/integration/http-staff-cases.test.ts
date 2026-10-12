import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
  CaseView,
  ErrorEnvelope,
  FindingResponse,
  QueuePage,
  RevealResponse,
  StaffOverview,
  StaffSnapshotTaken,
  StaffStepUpOptionsResponse,
  StaffTextSaved,
  StaffTextsResponse,
  snapshotDigest,
  textDigest,
  type AuthenticationResponseJSON,
  type IdentityRevealedParams,
} from "@korbat/contracts";
import { closeDb, createDb, profiles, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth, type Auth } from "../../src/auth";
import { randomToken } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { mediaForCases } from "../../src/media";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createModeration, type ModerationForStaff } from "../../src/moderation";
import { recordIntake } from "../../src/moderation/intake";
import { TEXT_SAVES_PER_MINUTE } from "../../src/moderation/texts";
import { createProfileStore } from "../../src/profiles/store";
import { socialForModeration } from "../../src/social";
import { createStaff } from "../../src/staff";
import { SoftAuthenticator } from "../auth/soft-authenticator";
import { webpBytes } from "../media/webp-bytes";
import { newUserWithDevice } from "./auth-fixtures";
import { Browser } from "./http-client";
import { mediaHarness, type MediaHarness } from "./media-harness";
import { MINORS, TC, aPost, ground, hex64, removeFixtures, rowCounts } from "./moderation-fixtures";
import { enrolKey } from "./staff-enrolment";
import { DEVICE_BOUND, TEST_CONSOLE_ORIGIN, TEST_CONSOLE_RP_ID, issueEnrolment, newStaffAccount } from "./staff-fixtures";

// Each test signs staff keys in over HTTP and sends dozens of requests: on a loaded machine that takes longer than the
// five seconds a test gets by default.
vi.setConfig({ testTimeout: 90_000 });

const STAFF_COOKIE = "__Host-korbat_staff";
const STAFF_CSRF_COOKIE = "__Host-korbat_staff_csrf";
/** The mark the console sends on a request its person's action started (3a design, section 7). */
const MARKED = { "x-staff-activity": "1" };

/**
 * The console's case routes through the real app (3c design, sections 7.3 and 7.4): the overview, the queue, the case,
 * its images, snapshots and texts, a moderator's own finding, and the reveal of a source confirmed by a real staff key.
 * Everything here commits, as the server does: the tests' profiles, posts and cases are removed again, the audit rows of
 * the confirmed reveals stay (audit-verify accepts them), and the file's last test holds it to leaving no row behind.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the console's case routes over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  let auth: Auth;
  let mailer: MemoryMailer;
  let h: MediaHarness;
  let app: ReturnType<typeof createApp>;
  let deps: ReturnType<typeof createModeration>["deps"];
  let settle: () => Promise<void>;
  let moderator: Awaited<ReturnType<typeof staffBrowser>>;
  let admin: Awaited<ReturnType<typeof staffBrowser>>;
  let before: Record<string, number>;
  /** Every profile the tests made, staff included: removed, with what hangs on them, after the last test. */
  const profileIds: string[] = [];
  /** What a test runs inside the request, once the step-up verified and before the reveal's transaction begins. */
  let insideRequest: (() => Promise<unknown>) | null = null;
  /** How far the auth module's clock stands from the real one, in milliseconds; 0 but where a test sets it back. */
  let skewMs = 0;
  /** How often the image route handed a request to the moderation module. */
  let imageCalls = 0;
  /** How often a staff route's session guard ran: it is what reads a staff session, and what a marked request slides. */
  let sessionReads = 0;
  /** The limit store the app and the moderation module count in: the global limit, the saved texts' minute and the alerts' throttles. */
  let rateLimitStore: MemoryStore;

  async function counts(): Promise<Record<string, number>> {
    const [authSide] = await migrateDb.execute<Record<string, number>>(
      sql`select (select count(*)::int from auth.notifier_contacts) as notifier_contacts, (select count(*)::int from auth.notifier_confirmations) as notifier_confirmations,
                 (select count(*)::int from auth.notifier_suppressions) as notifier_suppressions, (select count(*)::int from auth.staff_personal_accounts) as staff_personal_accounts`,
    );
    return { ...(await rowCounts(apiDb)), ...authSide! };
  }

  beforeAll(async () => {
    // The test environment with the console switched on at the staff harness's address.
    config = loadConfig({ ...process.env, CONSOLE_ORIGIN: TEST_CONSOLE_ORIGIN, CONSOLE_RP_ID: "" });
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    before = await counts();
    repo = createAuthRepo(authDb);
    mailer = new MemoryMailer();
    // The real clock, unless a test sets it back: a reveal's audit row is stamped by the database and held against the
    // challenge's expiry, which the auth module's clock sets.
    const clock = () => Date.now() + skewMs;
    auth = createAuth({ config, logger, authDb, kv: new MemoryKv(clock), mailer, profiles: createProfileStore(apiDb), now: () => new Date(clock()) });
    // The media module over a store of this file's own, so the image route opens real files.
    h = await mediaHarness(apiDb);
    rateLimitStore = new MemoryStore();
    const moderation = createModeration({ apiDb, auth: auth.forModeration, social: socialForModeration(apiDb), media: mediaForCases(h.deps), rateLimitStore, config, logger });
    deps = moderation.deps;
    settle = moderation.settle;
    // The staff routes get the moderation module through a wrapper that counts the image route's calls and lets a test
    // act inside the request, between the step-up's verification and the reveal's own transaction.
    const observed: ModerationForStaff = {
      ...moderation.forStaff,
      caseImage: (...args) => {
        imageCalls++;
        return moderation.forStaff.caseImage(...args);
      },
      reveal: async (...args) => {
        const run = insideRequest;
        insideRequest = null;
        await run?.();
        return moderation.forStaff.reveal(...args);
      },
    };
    // The session guard is the auth module's own, counted: a test can then tell a request that reached it from one
    // answered before it.
    const requireStaff: typeof auth.forStaff.requireStaff = async (c, next) => {
      sessionReads++;
      return auth.forStaff.requireStaff(c, next);
    };
    app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, staff: createStaff({ apiDb, auth: { ...auth.forStaff, requireStaff }, moderation: observed }), moderation });
    moderator = await staffBrowser("moderator");
    admin = await staffBrowser("admin");
  }, 120_000);
  afterAll(async () => {
    await settle();
    await removeFixtures(migrateDb, profileIds);
    h.cleanup();
    await Promise.all([closeDb(authDb), closeDb(apiDb), closeDb(migrateDb)]);
  });

  const consoleBrowser = () => new Browser(app, TEST_CONSOLE_ORIGIN, { base: TEST_CONSOLE_ORIGIN, csrfCookie: STAFF_CSRF_COOKIE, csrfHeader: "x-staff-csrf" });
  const error = async (res: Response) => ErrorEnvelope.parse(await res.json()).error;
  const answered = async (res: Response): Promise<[number, string]> => [res.status, (await error(res)).code];
  /**
   * An answer held to its contract: what the contract's schema reads from the raw JSON is all the JSON holds. The routes
   * send the module's objects as they are, and the schemas drop every member they do not name, so an answer that carries
   * one member more than its contract fails here.
   */
  function held<T>(schema: { parse(raw: unknown): T }, raw: unknown): T {
    const read = schema.parse(raw);
    expect(raw).toStrictEqual(read);
    return read;
  }
  const answer = async <T>(schema: { parse(raw: unknown): T }, res: Response): Promise<T> => held(schema, await res.json());
  /** The seconds a refusal at a limit tells the console to wait. */
  const retryAfter = (res: Response) => Number(res.headers.get("retry-after"));
  const appOrigin = () => new URL(config.APP_ORIGIN).origin;

  /** A live staff account with a profile and one key enrolled through the flow, signed in from the console's browser. */
  async function staffBrowser(role: "moderator" | "admin") {
    const { user } = await newStaffAccount(authDb, repo, role);
    const handle = `s_${randomUUID().slice(0, 8)}`;
    await apiDb.insert(profiles).values({ id: user.id, handle, displayName: "Staff" });
    profileIds.push(user.id);
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
    return { id: user.id, email: user.email, handle, keyId: enrolled.key.id, role, b, assert };
  }
  type Staff = typeof moderator;

  /** An author with a post that holds this many images, each with the files the worker would have written. */
  async function imagePost(images: number) {
    const author = await h.established();
    profileIds.push(author.id);
    const p = await h.postWithImages(author.id, images);
    for (const id of p.mediaIds) {
      writeFileSync(h.files.store.image(id, "large"), webpBytes("VP8X", 2048, 1536, `large of ${id}`));
      writeFileSync(h.files.store.image(id, "small"), webpBytes("VP8 ", 1024, 768, `small of ${id}`));
    }
    return { author, ...p };
  }
  /** A signed-in reporter with a profile. */
  async function reporter() {
    const made = await h.established();
    profileIds.push(made.id);
    return made;
  }
  /** A post reported under a rule by a signed-in reporter: its case and its item. */
  async function reported(images = 0, explanation: string | null = null) {
    const [p, by] = [await imagePost(images), await reporter()];
    const recorded = await recordIntake(deps, { ground: { ...ground.rule(by.id, "R1"), explanation }, live: [aPost(p.postId)] });
    return { ...p, reporter: by, caseId: recorded.items[0]!.caseId!, itemId: recorded.items[0]!.id };
  }
  const get = (s: Staff, path: string) => s.b.fetch(path, { headers: MARKED });
  const post = (s: Staff, path: string, json: unknown = {}) => s.b.fetch(path, { json, headers: MARKED });
  /** Saves a text as the console does: a fresh salt and the digest of the salt and the text. */
  async function saveText(s: Staff, caseId: string, kind: string, text: string) {
    const salt = hex64();
    return post(s, `/api/staff/cases/${caseId}/texts`, { kind, text, salt, digest: await textDigest(salt, text) });
  }
  /** The key's confirmation of exactly this reveal, asked for as the console asks for it. */
  async function confirmation(s: Staff, itemId: string, params: IdentityRevealedParams): Promise<AuthenticationResponseJSON> {
    const res = await s.b.fetch("/api/staff/step-up/options", { json: { action: "identity_revealed", target: { type: "intake_item", id: itemId }, params }, headers: MARKED });
    expect(res.status, await res.clone().text()).toBe(200);
    return s.assert(StaffStepUpOptionsResponse.parse(await res.json()).options.challenge);
  }
  /** A reason saved on the case, and the params of a reveal that names it. */
  async function revealParams(s: Staff, caseId: string): Promise<IdentityRevealedParams> {
    const saved = await saveText(s, caseId, "reveal_reason", `The notifier claims to be impersonated (${randomUUID()}).`);
    expect(saved.status, await saved.clone().text()).toBe(201);
    return { reasonCategory: "impersonation_claim", reasonDigest: (await answer(StaffTextSaved, saved)).digest };
  }
  const revealsOf = async (staffId: string) => (await apiDb.execute<{ n: number }>(sql`select count(*)::int as n from case_access_log where staff_id = ${staffId}::uuid and kind = 'identity_revealed'`))[0]!.n;

  test("every case route needs a staff session, and none answers a cross-origin header", async () => {
    const r = await reported(1);
    const routes: [string, string, unknown?][] = [
      ["GET", "/api/staff/overview"],
      ["GET", "/api/staff/queue"],
      ["GET", `/api/staff/cases/${r.caseId}`],
      ["GET", `/api/staff/cases/${r.caseId}/media/${r.mediaIds[0]}/small`],
      ["GET", `/api/staff/cases/${r.caseId}/texts`],
      ["POST", `/api/staff/cases/${r.caseId}/snapshots`, {}],
      ["POST", `/api/staff/cases/${r.caseId}/texts`, { kind: "note", text: "a note", salt: hex64(), digest: hex64() }],
      ["POST", "/api/staff/findings", { target: { kind: "post", id: r.postId }, ground: "rule", ruleId: "R1", category: TC }],
      ["POST", `/api/staff/items/${r.itemId}/reveal`, { reasonCategory: "other", reasonDigest: hex64() }],
    ];
    for (const [method, path, body] of routes) {
      const stranger = await consoleBrowser().fetch(path, { method, json: body, headers: MARKED });
      expect(await answered(stranger), `${method} ${path} without a session`).toEqual([401, "staff_session_required"]);
      // The same request from the app's origin never reaches a staff route: the gate answers the unknown route.
      const fromApp = await new Browser(app, appOrigin()).fetch(path, { method, json: body });
      expect(fromApp.status, `${method} ${path} from the app's site`).toBe(404);
    }
    // With a session, to an Origin listed in TRUSTED_ORIGINS or not: no staff answer carries a CORS header.
    for (const path of ["/api/staff/overview", "/api/staff/queue", `/api/staff/cases/${r.caseId}`, `/api/staff/cases/${r.caseId}/media/${r.mediaIds[0]}/small`]) {
      const res = await get(moderator, path);
      expect(res.status, path).toBe(200);
      expect([...res.headers.keys()].filter((name) => name.startsWith("access-control-")), path).toEqual([]);
      await res.arrayBuffer();
    }
    expect((await apiDb.execute<{ n: number }>(sql`select count(*)::int as n from staff_texts where case_id = ${r.caseId}::uuid`))[0]!.n).toBe(0);
  });

  test("the overview, the queue and the case answer what the contracts describe, never stored; a case that does not exist is 404, and an id that is none is refused", async () => {
    const r = await reported(1, "The reporter's own words.");
    const seen = await get(moderator, "/api/staff/overview");
    expect(seen.status).toBe(200);
    expect(seen.headers.get("cache-control")).toBe("no-store");
    await answer(StaffOverview, seen);

    const queue = await get(moderator, "/api/staff/queue");
    expect(queue.status).toBe(200);
    const page = await answer(QueuePage, queue);
    expect(page.cases.map((row) => row.id)).toContain(r.caseId);
    expect(await answered(await get(moderator, "/api/staff/queue?cursor=bm9wZQ"))).toEqual([400, "invalid_request"]);
    expect(await answered(await get(moderator, "/api/staff/queue?cursor=a%20b"))).toEqual([400, "invalid_request"]);

    const res = await get(moderator, `/api/staff/cases/${r.caseId}`);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const view = await answer(CaseView, res);
    expect(view).toMatchObject({ id: r.caseId, imagesAllowed: true, suspicion: null, target: { type: "post", id: r.postId, state: "visible", level: "visible" } });
    expect(view.items[0]).toMatchObject({ explanation: "The reporter's own words.", source: { kind: "reporter", label: "Reporter A" } });
    // The console computes the digest of what it displays: it is the one stored.
    const snapshot = view.snapshots[0]!;
    if (snapshot.withheld) throw new Error("the snapshot is shown");
    expect(await snapshotDigest(snapshot)).toBe(snapshot.digest);
    // An upper-case spelling of the id names the same case.
    expect((await get(moderator, `/api/staff/cases/${r.caseId.toUpperCase()}`)).status).toBe(200);
    expect(await answered(await get(moderator, `/api/staff/cases/${randomUUID()}`))).toEqual([404, "not_found"]);
    expect(await answered(await get(moderator, "/api/staff/cases/not-a-case"))).toEqual([400, "invalid_request"]);
    // The two reads were logged for the moderator, and nothing for the refused ones.
    expect((await apiDb.execute<{ n: number }>(sql`select count(*)::int as n from case_access_log where staff_id = ${moderator.id}::uuid and case_id = ${r.caseId}::uuid and kind = 'case_opened'`))[0]!.n).toBe(2);
  });

  test("the image route answers the file as WebP, private and never stored, under the API's own policy; every refusal is one 404", async () => {
    const r = await reported(1);
    const image = r.mediaIds[0]!;
    const res = await get(moderator, `/api/staff/cases/${r.caseId}/media/${image}/small`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(webpBytes("VP8 ", 1024, 768, `small of ${image}`));
    const large = await get(moderator, `/api/staff/cases/${r.caseId}/media/${image}/large`);
    expect(Buffer.from(await large.arrayBuffer())).toEqual(webpBytes("VP8X", 2048, 1536, `large of ${image}`));

    // Another post's image on this case, an image nobody has, and a size that is none.
    const elsewhere = await reported(1);
    expect(await answered(await get(moderator, `/api/staff/cases/${r.caseId}/media/${elsewhere.mediaIds[0]}/small`))).toEqual([404, "image_refused"]);
    expect(await answered(await get(moderator, `/api/staff/cases/${r.caseId}/media/${randomUUID()}/small`))).toEqual([404, "image_refused"]);
    expect(await answered(await get(moderator, `/api/staff/cases/${r.caseId}/media/${image}/original`))).toEqual([400, "invalid_request"]);
    // A report of child sexual abuse material about the post joins its open case: from then on no staff member is
    // served the image that the case served a moment ago.
    const suspect = await recordIntake(deps, { ground: ground.csam(), live: [aPost(r.postId)] });
    expect(suspect.items[0]!.caseId).toBe(r.caseId);
    for (const s of [moderator, admin]) expect(await answered(await get(s, `/api/staff/cases/${r.caseId}/media/${image}/small`)), s.role).toEqual([404, "image_refused"]);
    const frozen = await answer(CaseView, await get(admin, `/api/staff/cases/${r.caseId}`));
    expect(frozen).toMatchObject({ imagesAllowed: false, lane: 0, suspicion: { open: true, reach: { posts: 1, images: 1, sealed: 0, served: 1 } } });
    expect((await apiDb.execute<{ n: number }>(sql`select count(*)::int as n from case_access_log where case_id = ${r.caseId}::uuid and kind = 'image_viewed'`))[0]!.n).toBe(2);
  });

  test("the image route takes GET alone: a HEAD request is answered as an unknown route, with no file opened and no view logged, signed in or not", async () => {
    const r = await reported(1);
    const path = `/api/staff/cases/${r.caseId}/media/${r.mediaIds[0]}/small`;
    const views = async () => (await apiDb.execute<{ n: number }>(sql`select count(*)::int as n from case_access_log where case_id = ${r.caseId}::uuid and kind = 'image_viewed'`))[0]!.n;
    const asked = imageCalls;
    for (const [who, browser] of [["signed in", moderator.b], ["signed out", consoleBrowser()]] as const) {
      const res = await browser.fetch(path, { method: "HEAD", headers: MARKED });
      expect(res.status, who).toBe(404);
      expect(res.headers.get("content-type"), who).not.toBe("image/webp");
      // The answer to a HEAD request has no body.
      expect(await res.text(), who).toBe("");
    }
    // The moderation module was never asked: nothing opened a file, and nothing was logged.
    expect(imageCalls).toBe(asked);
    expect(await views()).toBe(0);
    // The same address with GET is served, and logged once.
    const served = await get(moderator, path);
    expect(served.status).toBe(200);
    await served.arrayBuffer();
    expect(imageCalls).toBe(asked + 1);
    expect(await views()).toBe(1);
  });

  test("no staff route answers HEAD: on a case, with a live staff session, it writes no case_opened row and counts nothing against the day's limit on different cases", async () => {
    const person = await staffBrowser("moderator");
    const [first, second] = [await reported(), await reported()];
    const opened = async () =>
      (await apiDb.execute<{ case_id: string; n: number }>(sql`select case_id, count(*)::int as n from case_access_log where staff_id = ${person.id}::uuid and kind = 'case_opened' group by case_id`)).map((row) => ({ ...row }));
    // One different case a day, so that a counted read would show. The limits' row is the suite's to keep: only the
    // migrator writes it, and it is put back whatever happens.
    const [kept] = await migrateDb.execute<{ case_opens_per_day: number }>(sql`select case_opens_per_day from moderation_limits where id = 1`);
    await migrateDb.execute(sql`update moderation_limits set case_opens_per_day = 1 where id = 1`);
    try {
      const reads = sessionReads;
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await person.b.fetch(`/api/staff/cases/${first.caseId}`, { method: "HEAD", headers: MARKED });
        expect(res.status).toBe(404);
        expect(await res.text()).toBe("");
      }
      // Nothing read the session, and nothing was logged: the case was not opened.
      expect(sessionReads).toBe(reads);
      expect(await opened()).toEqual([]);
      // Had the HEAD opened the first case, the day's one case would be spent. The second is read all the same,
      expect((await get(person, `/api/staff/cases/${second.caseId}`)).status).toBe(200);
      // and is the one that spends it: the limit is in force, and the first case is now one too many.
      expect(await answered(await get(person, `/api/staff/cases/${first.caseId}`))).toEqual([429, "rate_limited"]);
      expect(await opened()).toEqual([{ case_id: second.caseId, n: 1 }]);
      // A HEAD at the limit is the unknown route too, never the limit's refusal.
      expect((await person.b.fetch(`/api/staff/cases/${first.caseId}`, { method: "HEAD", headers: MARKED })).status).toBe(404);
    } finally {
      await migrateDb.execute(sql`update moderation_limits set case_opens_per_day = ${kept!.case_opens_per_day} where id = 1`);
    }
  });

  test("a HEAD on the queue, the overview, a case's drafts and 3a's own reads (the sessions list, the audit log, the keys, the session itself) answers 404 with no body, signed in or not, and never reads the session: its idle end stays where it was", async () => {
    const person = await staffBrowser("moderator");
    const r = await reported();
    /** When the person last acted, as the session's row holds it: a marked request that reads the session moves it. */
    const lastUsed = async () => Number((await authDb.execute<{ at: string }>(sql`select (extract(epoch from last_used_at) * 1000)::bigint::text as at from auth.staff_sessions where user_id = ${person.id}::uuid`))[0]!.at);
    const before = await lastUsed();
    const reads = sessionReads;
    const paths = ["/api/staff/queue", "/api/staff/overview", `/api/staff/cases/${r.caseId}/texts`, "/api/staff/sessions", "/api/staff/audit", "/api/staff/keys", "/api/staff/me"];
    for (const path of paths) {
      for (const [who, browser] of [["signed in", person.b], ["signed out", consoleBrowser()]] as const) {
        const res = await browser.fetch(path, { method: "HEAD", headers: MARKED });
        expect(res.status, `${who}: ${path}`).toBe(404);
        expect(await res.text(), `${who}: ${path}`).toBe("");
        // No staff cookie is set or cleared: nothing looked at a session, live or missing.
        expect(res.headers.getSetCookie(), `${who}: ${path}`).toEqual([]);
      }
    }
    expect(sessionReads).toBe(reads);
    expect(await lastUsed()).toBe(before);
    // The same request with GET reads the session, and its mark moves the idle end.
    await new Promise((resolve) => setTimeout(resolve, 5));
    for (const path of paths) expect((await get(person, path)).status, path).toBe(200);
    expect(sessionReads).toBe(reads + paths.length);
    expect(await lastUsed()).toBeGreaterThan(before);
    // And a signed-out GET is told to sign in, which a signed-out HEAD never was.
    expect(await answered(await consoleBrowser().fetch("/api/staff/overview", { headers: MARKED }))).toEqual([401, "staff_session_required"]);
  });

  test("a text is saved with its digest or refused with a code of its own, and nothing is stored for a refusal; the person's drafts are read back with their salts; a snapshot answers an id and a digest alone", async () => {
    const theirs = "He posted my home address and my phone number to hurt me.";
    const r = await reported(0, theirs);
    const stored = async () => (await apiDb.execute<{ n: number }>(sql`select count(*)::int as n from staff_texts where case_id = ${r.caseId}::uuid`))[0]!.n;

    const saved = await saveText(moderator, r.caseId, "facts", "The post names the home address of another person.");
    expect(saved.status, await saved.clone().text()).toBe(201);
    const { id, digest } = await answer(StaffTextSaved, saved);
    const drafts = await answer(StaffTextsResponse, await get(moderator, `/api/staff/cases/${r.caseId}/texts`));
    expect(drafts.texts).toEqual([expect.objectContaining({ id, digest, kind: "facts", text: "The post names the home address of another person." })]);
    expect(await textDigest(drafts.texts[0]!.salt, drafts.texts[0]!.text)).toBe(digest);
    // Another staff member's drafts are their own.
    expect((await answer(StaffTextsResponse, await get(admin, `/api/staff/cases/${r.caseId}/texts`))).texts).toEqual([]);

    const salt = hex64();
    const mismatch = await post(moderator, `/api/staff/cases/${r.caseId}/texts`, { kind: "reason", text: "The reason.", salt, digest: await textDigest(salt, "Another text.") });
    expect(await answered(mismatch)).toEqual([422, "text_invalid"]);
    expect(await answered(await saveText(moderator, r.caseId, "reason", `As the reporter wrote: ${theirs}`))).toEqual([422, "text_quotes_user"]);
    expect(await answered(await saveText(moderator, r.caseId, "reason", "x".repeat(5001)))).toEqual([422, "text_invalid"]);
    expect(await answered(await saveText(moderator, r.caseId, "statement", "a kind that is none"))).toEqual([400, "invalid_request"]);
    expect(await answered(await saveText(moderator, randomUUID(), "note", "a note"))).toEqual([404, "not_found"]);
    // No text is saved empty, whatever its kind: a reason of nothing or of white space is no reason.
    for (const [kind, text] of [["reveal_reason", ""], ["facts", "   "], ["seal_declined", ` ${String.fromCharCode(10)} `], ["note", ""]] as const) {
      expect(await answered(await saveText(moderator, r.caseId, kind, text)), `${kind}: ${JSON.stringify(text)}`).toEqual([400, "invalid_request"]);
    }
    expect(await stored()).toBe(1);

    const taken = await post(moderator, `/api/staff/cases/${r.caseId}/snapshots`);
    expect(taken.status, await taken.clone().text()).toBe(200);
    const body = (await taken.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["digest", "id"]);
    held(StaffSnapshotTaken, body);
    expect(await answered(await post(moderator, `/api/staff/cases/${randomUUID()}/snapshots`))).toEqual([404, "not_found"]);
  });

  test("a finding opens a case under its rule, answered 201; a target with nothing live is 404 with nothing written; citing R2, a deleted post and an account under a handle it has left get their case whatever is left of them", async () => {
    const findings = async () => (await apiDb.execute<{ n: number }>(sql`select count(*)::int as n from intakes where finding_by = ${moderator.id}::uuid`))[0]!.n;
    const finding = (target: unknown, ruleId = "R1") => post(moderator, "/api/staff/findings", { target, ground: "rule", ruleId, category: ruleId === "R2" ? MINORS : TC });
    const live = await imagePost(1);
    const opened = await finding({ kind: "post", id: live.postId }, "R3");
    expect(opened.status, await opened.clone().text()).toBe(201);
    const { caseId } = await answer(FindingResponse, opened);
    const view = await answer(CaseView, await get(admin, `/api/staff/cases/${caseId}`));
    expect(view.items[0]).toMatchObject({ ruleId: "R3", allegesIllegal: false, source: { kind: "staff", label: "Found by a moderator" } });
    expect(await findings()).toBe(1);

    // Nothing live: a post nobody has, a post its author deleted, a deleted account, a handle its account has left.
    const deleted = await imagePost(1);
    await apiDb.execute(sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${deleted.postId}::uuid`);
    const gone = await reporter();
    await apiDb.execute(sql`update profiles set deleted_at = now() where id = ${gone.id}::uuid`);
    const moved = await imagePost(1);
    const left = `old_${randomUUID().slice(0, 8)}`;
    await migrateDb.execute(sql`insert into handle_history (handle_lower, profile_id, changed_at) values (${left}, ${moved.author.id}::uuid, now())`);
    try {
      const dead: [string, unknown][] = [
        ["a link to a post nobody has", { kind: "link", url: `${appOrigin()}/post/${randomUUID()}` }],
        ["a post its author deleted", { kind: "post", id: deleted.postId }],
        ["a deleted account", { kind: "account", handle: gone.handle }],
        ["a handle its account has left", { kind: "account", handle: left }],
      ];
      for (const [label, target] of dead) expect(await answered(await finding(target, "R1")), label).toEqual([404, "not_found"]);
      expect(await findings()).toBe(1);
      // A finding has no other ground than a rule, and names its target as a notice does.
      expect(await answered(await post(moderator, "/api/staff/findings", { target: { kind: "post", id: live.postId }, ground: "illegal", ruleId: "R1", category: TC }))).toEqual([400, "invalid_request"]);
      expect(await answered(await finding({ kind: "link", url: "https://elsewhere.example/post/x" }))).toEqual([422, "notice_link_offsite"]);

      // Under R2 the same targets are live while their rows exist.
      const onDeleted = await finding({ kind: "post", id: deleted.postId }, "R2");
      const onGone = await finding({ kind: "account", handle: gone.handle }, "R2");
      const onLeft = await finding({ kind: "link", url: `${appOrigin()}/u/${left}` }, "R2");
      for (const res of [onDeleted, onGone, onLeft]) expect(res.status, await res.clone().text()).toBe(201);
      const leftView = await answer(CaseView, await get(admin, `/api/staff/cases/${(await answer(FindingResponse, onLeft)).caseId}`));
      expect(leftView).toMatchObject({ lane: 0, imagesAllowed: false, target: { type: "account", id: moved.author.id, handle: moved.author.handle }, suspicion: { open: true, reach: { posts: 1, images: 1 } } });
      expect(leftView.items[0]).toMatchObject({ link: `${appOrigin()}/u/${left}`, suspect: true, ruleId: "R2" });
      expect(await findings()).toBe(4);
      // The urgent lane's alert went to the staff accounts, once.
      await settle();
      expect(mailer.sent.filter((message) => message.template === "moderation_urgent" && message.to === admin.email)).toHaveLength(1);
    } finally {
      await migrateDb.execute(sql`delete from handle_history where handle_lower = ${left}`);
    }
  });

  test("a staff member whose linked account is the case's subject is refused the case, its image, a snapshot, both text routes and, after the key's confirmation, the reveal: 403 staff_recused, with no access row and no text stored; a case nobody has is 404 for them as for anyone", async () => {
    const close = await staffBrowser("moderator");
    // The personal account the operator linked to the staff account: only the migrator writes that table.
    const personal = (await newUserWithDevice(repo)).user.id;
    await apiDb.insert(profiles).values({ id: personal, handle: `p_${randomUUID().slice(0, 8)}`, displayName: "Personal", createdAt: new Date(Date.now() - 3 * 24 * 3600_000) });
    profileIds.push(personal);
    await migrateDb.execute(sql`insert into auth.staff_personal_accounts (staff_user_id, personal_user_id) values (${close.id}::uuid, ${personal}::uuid)`);
    try {
      // A post of the linked account with an image, reported by someone else.
      const p = await h.postWithImages(personal, 1);
      const image = p.mediaIds[0]!;
      writeFileSync(h.files.store.image(image, "small"), webpBytes("VP8 ", 1024, 768, `small of ${image}`));
      const recorded = await recordIntake(deps, { ground: ground.rule((await reporter()).id, "R1"), live: [aPost(p.postId)] });
      const [caseId, itemId] = [recorded.items[0]!.caseId!, recorded.items[0]!.id];
      const params: IdentityRevealedParams = { reasonCategory: "other", reasonDigest: hex64() };
      const asked = imageCalls;
      const refused = {
        "the case": await answered(await get(close, `/api/staff/cases/${caseId}`)),
        "its image": await answered(await get(close, `/api/staff/cases/${caseId}/media/${image}/small`)),
        "a snapshot": await answered(await post(close, `/api/staff/cases/${caseId}/snapshots`)),
        "saving a text": await answered(await saveText(close, caseId, "reveal_reason", "The reporter claims to be impersonated.")),
        "the drafts": await answered(await get(close, `/api/staff/cases/${caseId}/texts`)),
        // The key confirms exactly this reveal, and the flow refuses it all the same.
        "the reveal": await answered(await post(close, `/api/staff/items/${itemId}/reveal`, { ...params, stepUp: await confirmation(close, itemId, params) })),
      };
      const recused: [number, string] = [403, "staff_recused"];
      expect(refused).toEqual({ "the case": recused, "its image": recused, "a snapshot": recused, "saving a text": recused, "the drafts": recused, "the reveal": recused });
      // The image route did ask the moderation module, which refused before it looked for a file.
      expect(imageCalls).toBe(asked + 1);
      const [left] = await apiDb.execute<{ access: number; texts: number; snapshots: number }>(sql`
        select (select count(*)::int from case_access_log where staff_id = ${close.id}::uuid) as access,
               (select count(*)::int from staff_texts where case_id = ${caseId}::uuid) as texts,
               (select count(*)::int from evidence_snapshots where case_id = ${caseId}::uuid) as snapshots`);
      expect({ ...left! }).toEqual({ access: 0, texts: 0, snapshots: 1 });
      // A case nobody has is not found, for them as for anyone; and another staff member opens the case.
      expect(await answered(await get(close, `/api/staff/cases/${randomUUID()}`))).toEqual([404, "not_found"]);
      expect((await get(admin, `/api/staff/cases/${caseId}`)).status).toBe(200);
    } finally {
      await migrateDb.execute(sql`delete from auth.staff_personal_accounts where staff_user_id = ${close.id}::uuid`);
    }
  });

  test("the day's limits over HTTP: 429 with the seconds to wait on a case read at the limit (a case opened earlier that day is still read, and every staff account is mailed once), on a finding, on a reveal the key confirmed, and on the sixty-first text saved in a minute", async () => {
    const limited = await staffBrowser("moderator");
    const [first, second] = [await reported(), await reported()];
    const within = (res: Response, most: number) => {
      expect(retryAfter(res)).toBeGreaterThanOrEqual(1);
      expect(retryAfter(res)).toBeLessThanOrEqual(most);
    };
    // The limits' row is the suite's to keep: only the migrator writes it, and it is put back whatever happens.
    const [kept] = await migrateDb.execute<{ case_opens_per_day: number; findings_per_day: number; reveals_per_day: number }>(sql`select case_opens_per_day, findings_per_day, reveals_per_day from moderation_limits where id = 1`);
    await migrateDb.execute(sql`update moderation_limits set case_opens_per_day = 1, findings_per_day = 1, reveals_per_day = 1 where id = 1`);
    try {
      // Case reads: one different case a day.
      expect((await get(limited, `/api/staff/cases/${first.caseId}`)).status).toBe(200);
      for (let attempt = 0; attempt < 2; attempt++) {
        const refused = await get(limited, `/api/staff/cases/${second.caseId}`);
        within(refused, 86_400);
        expect(await answered(refused)).toEqual([429, "rate_limited"]);
      }
      expect((await get(limited, `/api/staff/cases/${first.caseId}`)).status).toBe(200);
      const opened = await apiDb.execute<{ case_id: string; n: number }>(sql`select case_id, count(*)::int as n from case_access_log where staff_id = ${limited.id}::uuid and kind = 'case_opened' group by case_id`);
      expect(opened.map((row) => ({ ...row }))).toEqual([{ case_id: first.caseId, n: 2 }]);
      // Every staff account, the person's own included, is told once that day, through the auth module's own mailer:
      // one mail about this person each, however often they were refused.
      await settle();
      for (const s of [limited, admin]) {
        const mails = mailer.sent.filter((message) => message.template === "moderation_reads" && message.to === s.email && message.data.handle === limited.handle);
        expect(mails.map((message) => message.data), s.role).toEqual([expect.objectContaining({ handle: limited.handle, limit: "1" })]);
      }

      // Findings: one a day. The target is resolved first, so a link that names nothing is still answered as that.
      const finding = (postId: string) => post(limited, "/api/staff/findings", { target: { kind: "post", id: postId }, ground: "rule", ruleId: "R1", category: TC });
      const [one, two] = [await imagePost(0), await imagePost(0)];
      expect((await finding(one.postId)).status).toBe(201);
      const overLimit = await finding(two.postId);
      within(overLimit, 86_400);
      expect(await answered(overLimit)).toEqual([429, "rate_limited"]);
      expect(await answered(await finding(randomUUID()))).toEqual([404, "not_found"]);
      const [written] = await apiDb.execute<{ findings: number; cases: number }>(sql`
        select (select count(*)::int from intakes where finding_by = ${limited.id}::uuid) as findings,
               (select count(*)::int from cases where target_id = ${two.postId}::uuid) as cases`);
      expect({ ...written! }).toEqual({ findings: 1, cases: 0 });

      // Reveals: one a day. The second is refused after the key confirmed it: nothing is written, its reason stays a draft.
      const reveal = async (r: typeof first) => {
        const params = await revealParams(limited, r.caseId);
        return { params, res: await post(limited, `/api/staff/items/${r.itemId}/reveal`, { ...params, stepUp: await confirmation(limited, r.itemId, params) }) };
      };
      expect((await reveal(first)).res.status).toBe(200);
      const next = await reveal(second);
      within(next.res, 86_400);
      expect(await answered(next.res)).toEqual([429, "rate_limited"]);
      expect(await revealsOf(limited.id)).toBe(1);
      const [reason] = await apiDb.execute<{ confirmed: boolean }>(sql`select confirmed_at is not null as confirmed from staff_texts where digest = ${next.params.reasonDigest}`);
      expect(reason!.confirmed).toBe(false);

      // Saved texts: sixty a minute. The minute's count so far is read with one more hit, then filled to fifty-nine.
      const key = `staff-text:${limited.id}`;
      for (let used = (await rateLimitStore.hit(key, 60_000)).count; used < TEXT_SAVES_PER_MINUTE - 1; used++) await rateLimitStore.hit(key, 60_000);
      expect((await saveText(limited, first.caseId, "note", "the sixtieth")).status).toBe(201);
      const tooMany = await saveText(limited, first.caseId, "note", "the sixty-first");
      within(tooMany, 60);
      expect(await answered(tooMany)).toEqual([429, "rate_limited"]);
      expect((await apiDb.execute<{ n: number }>(sql`select count(*)::int as n from staff_texts where author_id = ${limited.id}::uuid and kind = 'note'`))[0]!.n).toBe(1);
    } finally {
      await migrateDb.execute(sql`update moderation_limits set case_opens_per_day = ${kept!.case_opens_per_day}, findings_per_day = ${kept!.findings_per_day}, reveals_per_day = ${kept!.reveals_per_day} where id = 1`);
    }
  });

  describe("revealing who sent a report", () => {
    test("the key's confirmation of exactly this reveal answers the reporter's handle; the access row and the audit row commit together, and every staff account is mailed", async () => {
      const r = await reported();
      const params = await revealParams(moderator, r.caseId);
      const res = await post(moderator, `/api/staff/items/${r.itemId}/reveal`, { ...params, stepUp: await confirmation(moderator, r.itemId, params) });
      expect(res.status, await res.clone().text()).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await answer(RevealResponse, res)).toEqual({ handle: r.reporter.handle, name: null });
      const [stored] = await apiDb.execute<Record<string, unknown>>(sql`
        select l.case_id, l.intake_item_id,
               (select t.confirmed_at is not null from staff_texts t where t.id = l.text_id) as confirmed,
               (select count(*)::int from audit_log a where a.action = 'identity_revealed' and a.target_type = 'intake_item' and a.target_id = l.intake_item_id::text and a.actor_id = l.staff_id and a.step_up is not null) as audits
          from case_access_log l where l.staff_id = ${moderator.id}::uuid and l.kind = 'identity_revealed' and l.intake_item_id = ${r.itemId}::uuid`);
      expect({ ...stored! }).toEqual({ case_id: r.caseId, intake_item_id: r.itemId, confirmed: true, audits: 1 });
      // The mail goes to every staff account, the person's own included, with the day's count and the limit.
      await settle();
      for (const s of [moderator, admin]) {
        const mails = mailer.sent.filter((message) => message.template === "moderation_reveal" && message.to === s.email);
        expect(mails.at(-1)?.data, s.role).toMatchObject({ handle: moderator.handle, count: "1", limit: "10" });
      }
      // The home screen lists it for every staff member.
      const seen = await answer(StaffOverview, await get(admin, "/api/staff/overview"));
      expect(seen.reveals.items).toContainEqual({ at: expect.any(String), handle: moderator.handle, caseId: r.caseId });
    });

    test("it needs the key's confirmation of this reveal of this item, and is refused with its own codes for a source that names nobody and for a reason that is none", async () => {
      const [r, elsewhere] = [await reported(), await reported()];
      const params = await revealParams(moderator, r.caseId);
      const stepUp = await confirmation(moderator, r.itemId, params);
      const path = `/api/staff/items/${r.itemId}/reveal`;
      const answers: Record<string, [number, string]> = {};
      answers["no confirmation"] = await answered(await post(moderator, path, params));
      answers["a member the params do not take"] = await answered(await post(moderator, path, { ...params, reason: "free text", stepUp }));
      answers["other params"] = await answered(await post(moderator, path, { ...params, reasonCategory: "other", stepUp }));
      answers["another item"] = await answered(await post(moderator, `/api/staff/items/${elsewhere.itemId}/reveal`, { ...params, stepUp }));
      answers["another person's session"] = await answered(await post(admin, path, { ...params, stepUp }));
      answers["an item that is no uuid"] = await answered(await post(moderator, "/api/staff/items/not-an-item/reveal", { ...params, stepUp }));
      // A confirmed reveal that the flow refuses: a reason nobody saved, an item nobody has, a finding's item.
      const unsaved: IdentityRevealedParams = { reasonCategory: "other", reasonDigest: hex64() };
      answers["a reason nobody saved"] = await answered(await post(moderator, path, { ...unsaved, stepUp: await confirmation(moderator, r.itemId, unsaved) }));
      const nowhere = randomUUID();
      answers["an item nobody has"] = await answered(await post(moderator, `/api/staff/items/${nowhere}/reveal`, { ...unsaved, stepUp: await confirmation(moderator, nowhere, unsaved) }));
      const finding = await recordIntake(deps, { ground: ground.finding(admin.id, "R1"), live: [aPost(r.postId)] });
      const findingItem = finding.items[0]!.id;
      answers["a finding's item"] = await answered(await post(moderator, `/api/staff/items/${findingItem}/reveal`, { ...params, stepUp: await confirmation(moderator, findingItem, params) }));
      expect(answers).toEqual({
        "no confirmation": [403, "staff_step_up_required"],
        "a member the params do not take": [400, "invalid_request"],
        "other params": [403, "staff_step_up_invalid"],
        "another item": [403, "staff_step_up_invalid"],
        "another person's session": [403, "staff_step_up_invalid"],
        "an item that is no uuid": [400, "invalid_request"],
        "a reason nobody saved": [409, "text_not_found"],
        "an item nobody has": [404, "not_found"],
        "a finding's item": [422, "reveal_refused"],
      });
      expect(await revealsOf(moderator.id)).toBe(1);
      // A fresh confirmation of the same params still reveals, once: its challenge is then spent.
      const fresh = await confirmation(moderator, r.itemId, params);
      expect((await post(moderator, path, { ...params, stepUp: fresh })).status).toBe(200);
      expect(await answered(await post(moderator, path, { ...params, stepUp: fresh }))).toEqual([403, "staff_step_up_invalid"]);
      expect(await revealsOf(moderator.id)).toBe(2);
    });

    test("a key revoked between the confirmation and the reveal's transaction ends the session: 401 with both staff cookies cleared, nothing written, and no identity answered", async () => {
      const leaving = await staffBrowser("moderator");
      const r = await reported();
      const params = await revealParams(leaving, r.caseId);
      const stepUp = await confirmation(leaving, r.itemId, params);
      // The key is revoked inside the request, once requireStaff has read the session live and requireStaffStepUp has
      // verified the confirmation: only the reveal's own audit statement can notice it.
      insideRequest = () => authDb.execute(sql`update auth.staff_keys set revoked_at = now() where id = ${leaving.keyId}::uuid`);
      const res = await post(leaving, `/api/staff/items/${r.itemId}/reveal`, { ...params, stepUp });
      expect(insideRequest).toBeNull();
      expect(res.status).toBe(401);
      const body = await res.clone().text();
      expect((await error(res)).code).toBe("staff_session_required");
      expect(body).not.toContain(r.reporter.handle);
      const cleared = res.headers.getSetCookie().filter((line) => line.includes("Max-Age=0")).map((line) => line.slice(0, line.indexOf("=")));
      expect(cleared.sort()).toEqual([STAFF_COOKIE, STAFF_CSRF_COOKIE]);
      expect(await revealsOf(leaving.id)).toBe(0);
      const [text] = await apiDb.execute<{ confirmed: boolean }>(sql`select confirmed_at is not null as confirmed from staff_texts where digest = ${params.reasonDigest}`);
      expect(text!.confirmed).toBe(false);
    });

    test("a signed-out notifier is revealed by the name they gave, which the auth module alone keeps and reads; a notifier who gave an address and no name, and a notice of child sexual abuse material, reveal nobody", async () => {
      const p = await imagePost(0);
      // Two contacts as the notice route stores them, through the auth module: the moderation module holds only their ids.
      const [named, unnamed] = [randomUUID(), randomUUID()];
      const address = `ada-${randomUUID().slice(0, 8)}@notifier.example`;
      await auth.forModeration.storeNotifierContact(named, { name: "Ada Lovelace", email: address });
      await auth.forModeration.storeNotifierContact(unnamed, { email: `nobody-${randomUUID().slice(0, 8)}@notifier.example` });
      try {
        const withName = await recordIntake(deps, { ground: { ...ground.illegal(null), contactId: named }, live: [aPost(p.postId)] });
        const withoutName = await recordIntake(deps, { ground: { ...ground.illegal(null), contactId: unnamed }, live: [aPost(p.postId)] });
        const suspect = await recordIntake(deps, { ground: ground.csam(), live: [aPost(p.postId)] });
        const caseId = withName.items[0]!.caseId!;
        const caseRes = await get(admin, `/api/staff/cases/${caseId}`);
        const caseText = await caseRes.clone().text();
        const view = await answer(CaseView, caseRes);
        // The case says what each sender gave, never what.
        expect(view.items.map((item) => item.source)).toEqual([
          expect.objectContaining({ kind: "notifier", named: true, contactGiven: true, contactLost: false }),
          expect.objectContaining({ kind: "notifier", named: false, contactGiven: true, contactLost: false }),
          expect.objectContaining({ kind: "anonymous", named: null, contactGiven: null }),
        ]);
        for (const kept of ["Ada", "Lovelace", "notifier.example", named, unnamed]) expect(caseText, kept).not.toContain(kept);

        const before = await revealsOf(admin.id);
        const reveal = async (itemId: string) => {
          const params = await revealParams(admin, caseId);
          return post(admin, `/api/staff/items/${itemId}/reveal`, { ...params, stepUp: await confirmation(admin, itemId, params) });
        };
        const res = await reveal(withName.items[0]!.id);
        expect(res.status, await res.clone().text()).toBe(200);
        const text = await res.clone().text();
        expect(await answer(RevealResponse, res)).toEqual({ handle: null, name: "Ada Lovelace" });
        // The name, and never the address.
        expect(text).not.toContain("notifier.example");
        expect(await answered(await reveal(withoutName.items[0]!.id))).toEqual([422, "reveal_refused"]);
        expect(await answered(await reveal(suspect.items[0]!.id))).toEqual([422, "reveal_refused"]);
        expect(await revealsOf(admin.id)).toBe(before + 1);
      } finally {
        await authDb.execute(sql`delete from auth.notifier_contacts where id = any(${`{${named},${unnamed}}`}::uuid[])`);
      }
    });

    test("a reveal whose challenge has run out by the database's clock is answered 400 challenge_expired: nothing is written, the reason stays a draft, and no identity is answered", async () => {
      // A staff member who signed in under a clock set back, so that a challenge issued under a clock set back by less
      // still finds the session begun.
      skewMs = -700_000;
      let slow: Staff;
      try {
        slow = await staffBrowser("moderator");
      } finally {
        skewMs = 0;
      }
      const r = await reported();
      const params = await revealParams(slow, r.caseId);
      // The auth module issues the challenge for ten minutes and, under the same clock, finds it valid; by the database's
      // clock, which the reveal's transaction reads, it ran out five seconds ago.
      skewMs = -605_000;
      let res: Response;
      try {
        res = await post(slow, `/api/staff/items/${r.itemId}/reveal`, { ...params, stepUp: await confirmation(slow, r.itemId, params) });
      } finally {
        skewMs = 0;
      }
      const body = await res.clone().text();
      expect(await answered(res)).toEqual([400, "challenge_expired"]);
      expect(body).not.toContain(r.reporter.handle);
      const [left] = await apiDb.execute<{ reveals: number; confirmed: boolean; audits: number }>(sql`
        select (select count(*)::int from case_access_log where staff_id = ${slow.id}::uuid and kind = 'identity_revealed') as reveals,
               (select confirmed_at is not null from staff_texts where digest = ${params.reasonDigest}) as confirmed,
               (select count(*)::int from audit_log where action = 'identity_revealed' and target_id = ${r.itemId}) as audits`);
      expect({ ...left! }).toEqual({ reveals: 0, confirmed: false, audits: 0 });
      // The same reason under a fresh confirmation reveals: the late one spent nothing.
      const again = await post(slow, `/api/staff/items/${r.itemId}/reveal`, { ...params, stepUp: await confirmation(slow, r.itemId, params) });
      expect(again.status, await again.clone().text()).toBe(200);
      expect(await answer(RevealResponse, again)).toEqual({ handle: r.reporter.handle, name: null });
    });
  });

  test("an answer that carries a member its contract does not name is caught by the check every answer above went through", () => {
    const caseId = randomUUID();
    expect(held(FindingResponse, { caseId })).toEqual({ caseId });
    expect(() => held(FindingResponse, { caseId, reporterId: randomUUID() })).toThrow();
    expect(() => held(RevealResponse, { handle: null, name: "Ada", email: "ada@notifier.example" })).toThrow();
    expect(() => held(StaffTextsResponse, { texts: [{ id: caseId, kind: "facts", text: "t", salt: hex64(), digest: hex64(), createdAt: new Date().toISOString(), authorId: randomUUID() }] })).toThrow();
  });

  test("this file left no row behind: the tables it writes hold what they held before it", async () => {
    await settle();
    await removeFixtures(migrateDb, profileIds.splice(0));
    expect(await counts()).toEqual(before);
  });
});
