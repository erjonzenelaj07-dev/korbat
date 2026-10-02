import { randomBytes, randomUUID } from "node:crypto";
import { and, asc, eq, gt } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
  AuditPage,
  ErrorEnvelope,
  STAFF_STEP_UP_CHALLENGE,
  StaffKeysResponse,
  StaffMe,
  StaffSessionsResponse,
  StaffSignInOptionsResponse,
  StaffSignInVerifyResponse,
  StaffStepUpOptionsResponse,
  stepUpActionHash,
  stepUpBinding,
  type AuthenticationResponseJSON,
} from "@korbat/contracts";
import { auditHead, auditLog, authEvents, closeDb, createDb, profiles, staffKeys, staffSessions, users, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth, revokeStaffKeys, type Auth } from "../../src/auth";
import { decodeKey, randomToken, sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { HOUR, MINUTE } from "../../src/auth/limits";
import { challengeKey, issueChallenge, issueStepUpChallenge } from "../../src/auth/passkeys/challenge";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { runGrantRole } from "../../src/cli/grant-role";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { createStaff } from "../../src/staff";
import { SoftAuthenticator } from "../auth/soft-authenticator";
import { fakeClock } from "./auth-fixtures";
import { Browser, randomIp } from "./http-client";
import { DEVICE_BOUND, TEST_CONSOLE_ORIGIN, TEST_CONSOLE_RP_ID, issueEnrolment, newStaffAccount } from "./staff-fixtures";
import { enrolKey } from "./staff-enrolment";
import { revokeRequest } from "./staff-step-up";

const CONSOLE_HOST = new URL(TEST_CONSOLE_ORIGIN).host;
const STAFF_COOKIE = "__Host-korbat_staff";
const STAFF_CSRF_COOKIE = "__Host-korbat_staff_csrf";
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";
/** The mark the console sends on a request its person's action started (3a design, section 7). */
const MARKED = { "x-staff-activity": "1" };

/** The Set-Cookie lines of an answer, by cookie name. */
function setCookies(res: Response): Map<string, string> {
  return new Map(res.headers.getSetCookie().map((line) => [line.slice(0, line.indexOf("=")), line]));
}

const accessControlHeaders = (res: Response) => [...res.headers.keys()].filter((name) => name.startsWith("access-control-"));

/** A response's signature with its last byte changed. */
function badSignature(response: AuthenticationResponseJSON): AuthenticationResponseJSON {
  const signature = Buffer.from(response.response.signature, "base64url");
  signature[signature.length - 1] = signature[signature.length - 1]! ^ 0xff;
  return { ...response, response: { ...response.response, signature: signature.toString("base64url") } };
}

/**
 * Staff sessions over HTTP (3a design, sections 7 and 12): the console's own browser on http://console.localhost:8090 signs
 * in with a staff key, and every staff request after it passes the staff gate and requireStaff, which reads the session
 * from the database each time. The auth module runs on a clock the tests move, so the idle and absolute ends are reached
 * without waiting.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: staff sessions over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  let auth: Auth;
  let app: ReturnType<typeof createApp>;
  const mailer = new MemoryMailer();
  const clock = fakeClock();

  beforeAll(() => {
    // The test environment with the console switched on at the staff harness's address.
    config = loadConfig({ ...process.env, CONSOLE_ORIGIN: TEST_CONSOLE_ORIGIN, CONSOLE_RP_ID: "" });
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    repo = createAuthRepo(authDb);
    auth = createAuth({ config, logger, authDb, kv: new MemoryKv(clock.ms), mailer, profiles: createProfileStore(apiDb), now: clock.now });
    const staff = createStaff({ apiDb, auth: auth.forStaff });
    app = createApp({ config, logger, rateLimitStore: new MemoryStore(), healthChecks: {}, auth, staff });
  });
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(apiDb), closeDb(migrateDb)]);
  });

  /** The console's page: its own host and origin, echoing the staff CSRF cookie in the staff CSRF header. */
  const consoleBrowser = () => new Browser(app, TEST_CONSOLE_ORIGIN, { base: TEST_CONSOLE_ORIGIN, csrfCookie: STAFF_CSRF_COOKIE, csrfHeader: "x-staff-csrf" });
  /** A request to the console's host with exactly these headers, for what the browser above never sends. */
  const raw = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
    app.request(`${TEST_CONSOLE_ORIGIN}${path}`, { method: init.method ?? "GET", headers: { host: CONSOLE_HOST, "cf-connecting-ip": randomIp(), ...init.headers } });
  const error = async (res: Response) => ErrorEnvelope.parse(await res.json()).error;
  const sessionRow = async (token: string) => (await migrateDb.select().from(staffSessions).where(eq(staffSessions.id, sha256Hex(token))))[0]!;
  const head = async () => (await migrateDb.select().from(auditHead))[0]!;

  /** The 401 that ends a staff session in the console: staff_session_required, with both staff cookies cleared. */
  async function expectEnded(res: Response, label: string) {
    expect(res.status, label).toBe(401);
    const cookies = setCookies(res);
    expect([...cookies.keys()].sort(), label).toEqual([STAFF_COOKIE, STAFF_CSRF_COOKIE]);
    for (const line of cookies.values()) {
      expect(line, label).toContain("Max-Age=0");
      expect(line, label).toContain("Path=/");
      expect(line, label).toContain("Secure");
    }
    expect((await error(res)).code, label).toBe("staff_session_required");
  }

  /**
   * A live staff account with a handle and one key enrolled through the flow, signed in from the console's browser with
   * Firefox's user agent. `signIn` signs in again, from any browser, with the next counter unless told one.
   */
  async function staffBrowser(role: "moderator" | "admin" = "moderator") {
    const { user, device } = await newStaffAccount(authDb, repo, role);
    const handle = `s_${randomUUID().slice(0, 8)}`;
    await apiDb.insert(profiles).values({ id: user.id, handle, displayName: "Staff" });
    const soft = new SoftAuthenticator();
    // The flows run on the moved clock: the link is valid 30 minutes from it, which is never earlier than the database's.
    const link = await issueEnrolment(migrateDb, user.id, { expiresAt: new Date(clock.ms() + 30 * MINUTE) });
    const enrolled = await enrolKey({ deps: auth.deps, ctx: { ipHash: randomToken(), userAgent: undefined } }, soft, link.token);
    let counter = 0;
    async function signIn(browser: Browser, options: { counter?: number; headers?: Record<string, string> } = {}) {
      const answer = await browser.fetch("/api/staff/signin/options", { method: "POST" });
      expect(answer.status, await answer.clone().text()).toBe(200);
      const { options: request } = StaffSignInOptionsResponse.parse(await answer.json());
      counter = options.counter ?? counter + 1;
      const response = soft.get({ credentialId: enrolled.credentialId, rpId: TEST_CONSOLE_RP_ID, challenge: request.challenge, origin: TEST_CONSOLE_ORIGIN, flags: DEVICE_BOUND, counter });
      const res = await browser.fetch("/api/staff/signin/verify", { json: { response }, headers: options.headers });
      return { res, response };
    }
    const b = consoleBrowser();
    const first = await signIn(b, { headers: { "user-agent": FIREFOX_LINUX } });
    expect(first.res.status, await first.res.clone().text()).toBe(200);
    return { user, device, handle, soft, keyId: enrolled.key.id, credentialId: enrolled.credentialId, b, token: b.cookie(STAFF_COOKIE)!, signIn, first };
  }

  /**
   * The key's answer to step-up options for revoking the staff session `handle`, asked for from `s`'s browser as the
   * console asks for them, or over a challenge of the test's own.
   */
  async function confirmation(s: Awaited<ReturnType<typeof staffBrowser>>, handle: string, options: { counter: number; challenge?: string }) {
    let challenge = options.challenge;
    if (challenge === undefined) {
      const res = await s.b.fetch("/api/staff/step-up/options", { json: revokeRequest(handle), headers: MARKED });
      expect(res.status, await res.clone().text()).toBe(200);
      challenge = StaffStepUpOptionsResponse.parse(await res.json()).options.challenge;
    }
    return s.soft.get({ credentialId: s.credentialId, rpId: TEST_CONSOLE_RP_ID, challenge, origin: TEST_CONSOLE_ORIGIN, flags: DEVICE_BOUND, counter: options.counter });
  }
  const revokeSession = (b: Browser, handle: string, stepUp?: AuthenticationResponseJSON) =>
    b.fetch(`/api/staff/sessions/${handle}`, { method: "DELETE", ...(stepUp ? { json: { stepUp } } : {}), headers: MARKED });

  describe("signing in", () => {
    test("sets both staff cookies, __Host-, Secure, Path=/, SameSite=Strict and 12 hours long, the session's HttpOnly; answers /me's body with no CORS header and no-store", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const res = s.first.res;
      const cookies = setCookies(res);
      expect([...cookies.keys()].sort()).toEqual([STAFF_COOKIE, STAFF_CSRF_COOKIE]);
      const session = cookies.get(STAFF_COOKIE)!;
      const csrf = cookies.get(STAFF_CSRF_COOKIE)!;
      expect(session).toMatch(/^__Host-korbat_staff=[A-Za-z0-9_-]{43};/);
      expect(csrf).toMatch(/^__Host-korbat_staff_csrf=[A-Za-z0-9_-]{43};/);
      for (const line of [session, csrf]) {
        for (const attribute of ["Max-Age=43200", "Path=/", "Secure", "SameSite=Strict"]) expect(line).toContain(attribute);
        expect(line).not.toContain("Domain=");
      }
      expect(session).toContain("HttpOnly");
      expect(csrf).not.toContain("HttpOnly");
      // No app cookie is set on the console.
      expect(res.headers.getSetCookie().some((line) => line.startsWith("__Host-korbat_session=") || line.startsWith("__Host-korbat_csrf="))).toBe(false);
      expect(accessControlHeaders(res)).toEqual([]);
      expect(res.headers.get("cache-control")).toBe("no-store");

      const me = StaffSignInVerifyResponse.parse(await res.json());
      const row = await sessionRow(s.token);
      expect(me).toMatchObject({ handle: s.handle, role: "moderator", sessionHandle: row.handle, idleSecondsLeft: 900, absoluteSecondsLeft: 43_200 });
      // The coarse label of the browser that signed in, never its user agent, as the session list and the mail show it.
      expect(row.browser).toBe("Firefox on Linux");
      expect(mailer.sent.filter((m) => m.to === s.user.email).map((m) => [m.template, m.data.browser])).toEqual([
        ["staff_key_added", undefined],
        ["staff_session_started", "Firefox on Linux"],
      ]);
    });

    test("one answer before the signature: a spent challenge, one of another purpose, one with another binding and a bad signature are staff_key_invalid, never a passkey code, and a bad signature on a live key reads as an unknown key", { timeout: 60_000 }, async () => {
      const s = await staffBrowser();
      const b = consoleBrowser();
      const key = challengeKey(decodeKey(config.AUTH_HMAC_KEY));
      const fresh = async () => StaffSignInOptionsResponse.parse(await (await b.fetch("/api/staff/signin/options", { method: "POST" })).json()).options.challenge;
      const assert = (challenge: string, counter: number) =>
        s.soft.get({ credentialId: s.credentialId, rpId: TEST_CONSOLE_RP_ID, challenge, origin: TEST_CONSOLE_ORIGIN, flags: DEVICE_BOUND, counter });
      const spentChallenge = JSON.parse(Buffer.from(s.first.response.response.clientDataJSON, "base64url").toString()).challenge as string;
      const stranger = new SoftAuthenticator();
      const unknown = stranger.create({ rpId: TEST_CONSOLE_RP_ID, challenge: randomBytes(58).toString("base64url"), origin: TEST_CONSOLE_ORIGIN, userHandle: randomBytes(32), flags: DEVICE_BOUND });

      const cases: [string, AuthenticationResponseJSON][] = [
        ["a spent challenge", assert(spentChallenge, 20)],
        ["the app's sign-in challenge", assert(issueChallenge(key, "signin", clock.now()), 21)],
        ["a staff registration challenge", assert(issueChallenge(key, "staff_register", clock.now(), randomUUID()), 22)],
        ["a staff sign-in challenge with a binding", assert(issueChallenge(key, "staff_signin", clock.now(), randomUUID()), 23)],
        ["a bad signature on a live key", badSignature(assert(await fresh(), 24))],
        ["an unknown key", stranger.get({ credentialId: unknown.id, rpId: TEST_CONSOLE_RP_ID, challenge: await fresh(), origin: TEST_CONSOLE_ORIGIN, flags: DEVICE_BOUND, counter: 1 })],
      ];
      const answers: Record<string, { status: number; code: string; message: string }> = {};
      for (const [label, response] of cases) {
        const res = await b.fetch("/api/staff/signin/verify", { json: { response } });
        const { code, message } = await error(res);
        answers[label] = { status: res.status, code, message };
        expect([label, res.status, code]).toEqual([label, 401, "staff_key_invalid"]);
        expect(code, label).not.toMatch(/^passkey_/);
        expect(res.headers.getSetCookie(), label).toEqual([]);
      }
      expect(answers["a bad signature on a live key"]).toEqual(answers["an unknown key"]);
      expect((await migrateDb.select().from(staffSessions).where(eq(staffSessions.userId, s.user.id))).length).toBe(1);
    });
  });

  describe("the person's own reads", () => {
    test("/me with the seconds left, /sessions with every live session and this one marked, /keys with the live keys and never a public key; no answer sets a cookie", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const other = consoleBrowser();
      expect((await s.signIn(other)).res.status).toBe(200);
      // Another account's session is never listed, nor a key the account no longer holds.
      await staffBrowser();
      const red = await enrolKey({ deps: auth.deps, ctx: { ipHash: randomToken(), userAgent: undefined } }, s.soft, (await issueEnrolment(migrateDb, s.user.id, { expiresAt: new Date(clock.ms() + 30 * MINUTE) })).token, { name: "Red key" });
      const old = await enrolKey({ deps: auth.deps, ctx: { ipHash: randomToken(), userAgent: undefined } }, s.soft, (await issueEnrolment(migrateDb, s.user.id, { expiresAt: new Date(clock.ms() + 30 * MINUTE) })).token, { name: "Old key" });
      await authDb.update(staffKeys).set({ revokedAt: clock.now() }).where(eq(staffKeys.id, old.key.id));
      clock.advance(MINUTE);

      for (const headers of [{}, MARKED]) {
        const me = await s.b.fetch("/api/staff/me", { headers });
        expect(me.status).toBe(200);
        expect(me.headers.getSetCookie()).toEqual([]);
        const body = StaffMe.parse(await me.json());
        expect(body.sessionHandle).toBe((await sessionRow(s.token)).handle);
        expect(body.absoluteSecondsLeft).toBe(12 * 60 * 60 - 60);
      }

      const sessions = await s.b.fetch("/api/staff/sessions");
      expect(sessions.headers.getSetCookie()).toEqual([]);
      const listed = StaffSessionsResponse.parse(await sessions.json()).sessions;
      const mine = await sessionRow(s.token);
      const theirs = await sessionRow(other.cookie(STAFF_COOKIE)!);
      expect(listed.map((x) => [x.handle, x.current, x.browser]).sort()).toEqual(
        [
          [mine.handle, true, "Firefox on Linux"],
          [theirs.handle, false, "Browser on unknown OS"],
        ].sort(),
      );
      // The other browser sees the same two, with its own marked.
      const fromOther = StaffSessionsResponse.parse(await (await other.fetch("/api/staff/sessions")).json()).sessions;
      expect(fromOther.find((x) => x.current)!.handle).toBe(theirs.handle);

      const keys = await s.b.fetch("/api/staff/keys");
      const text = await keys.clone().text();
      expect(StaffKeysResponse.parse(await keys.json()).keys.map((k) => [k.id, k.name])).toEqual([
        [s.keyId, "Blue key"],
        [red.key.id, "Red key"],
      ]);
      // The key that signed in shows when it was last used; nothing of any key's credential leaves the server.
      const [blue] = await migrateDb.select().from(staffKeys).where(eq(staffKeys.id, s.keyId));
      expect(text).toContain(blue!.lastUsedAt!.toISOString());
      for (const secret of [blue!.publicKey, blue!.credentialId]) expect(text).not.toContain(secret);
    });
  });

  describe("the idle and absolute limits", () => {
    test("only marked requests count: unmarked reads neither slide the idle end nor move last_used_at, so the session ends 15 minutes after the last marked one", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const t0 = (await sessionRow(s.token)).createdAt.getTime();
      clock.advance(10 * MINUTE);
      const unmarked = await s.b.fetch("/api/staff/me");
      expect(StaffMe.parse(await unmarked.json()).idleSecondsLeft).toBe(5 * 60);
      expect(await sessionRow(s.token)).toMatchObject({ lastUsedAt: new Date(t0), idleExpiresAt: new Date(t0 + 15 * MINUTE) });

      clock.advance(4 * MINUTE);
      const marked = await s.b.fetch("/api/staff/me", { headers: MARKED });
      expect(StaffMe.parse(await marked.json()).idleSecondsLeft).toBe(15 * 60);
      expect(await sessionRow(s.token)).toMatchObject({ lastUsedAt: new Date(t0 + 14 * MINUTE), idleExpiresAt: new Date(t0 + 29 * MINUTE) });

      // Any other value of the header marks nothing.
      clock.advance(MINUTE);
      expect((await s.b.fetch("/api/staff/sessions", { headers: { "x-staff-activity": "true" } })).status).toBe(200);
      clock.advance(13 * MINUTE);
      expect((await s.b.fetch("/api/staff/keys")).status).toBe(200);
      expect(await sessionRow(s.token)).toMatchObject({ lastUsedAt: new Date(t0 + 14 * MINUTE), idleExpiresAt: new Date(t0 + 29 * MINUTE) });

      // At the idle end, the next request is refused and the cookies cleared; a marked one revives nothing.
      clock.advance(MINUTE);
      await expectEnded(await s.b.fetch("/api/staff/me"), "at the idle end");
      expect(s.b.cookie(STAFF_COOKIE)).toBeUndefined();
      await expectEnded(await raw("/api/staff/me", { headers: { cookie: `${STAFF_COOKIE}=${s.token}`, ...MARKED } }), "marked, after the idle end");
      expect(await sessionRow(s.token)).toMatchObject({ lastUsedAt: new Date(t0 + 14 * MINUTE), idleExpiresAt: new Date(t0 + 29 * MINUTE), revokedAt: null });
    });

    test("a marked request slides the idle end, never past the absolute end, which ends the session after 12 hours whatever its person does", { timeout: 60_000 }, async () => {
      const s = await staffBrowser();
      const row = await sessionRow(s.token);
      const t0 = row.createdAt.getTime();
      expect(row.absoluteExpiresAt).toEqual(new Date(t0 + 12 * HOUR));
      // A marked request every 14 minutes for 11 hours and 54 minutes.
      for (let i = 0; i < 51; i++) {
        clock.advance(14 * MINUTE);
        expect((await s.b.fetch("/api/staff/me", { headers: MARKED })).status, `request ${i}`).toBe(200);
      }
      expect(await sessionRow(s.token)).toMatchObject({ lastUsedAt: new Date(t0 + 714 * MINUTE), idleExpiresAt: new Date(t0 + 12 * HOUR) });
      const me = StaffMe.parse(await (await s.b.fetch("/api/staff/me", { headers: MARKED })).json());
      expect([me.idleSecondsLeft, me.absoluteSecondsLeft]).toEqual([6 * 60, 6 * 60]);
      expect(me.idleExpiresAt).toBe(me.absoluteExpiresAt);
      clock.advance(6 * MINUTE);
      await expectEnded(await raw("/api/staff/me", { headers: { cookie: `${STAFF_COOKIE}=${s.token}` } }), "unmarked, at the absolute end");
      await expectEnded(await s.b.fetch("/api/staff/me", { headers: MARKED }), "at the absolute end");
    });
  });

  describe("every way a session ends, refused at its next request", () => {
    type Ender = [string, (s: Awaited<ReturnType<typeof staffBrowser>>) => Promise<void>];
    const enders: Ender[] = [
      ["a revocation by the command line", async (s) => void (await revokeStaffKeys({ repo, mailer }, s.user.email, s.keyId))],
      ["a revocation of every key by the command line", async (s) => void (await revokeStaffKeys({ repo, mailer }, s.user.email, "all"))],
      [
        "a counter that went backwards in another browser",
        async (s) => {
          const { res } = await s.signIn(consoleBrowser(), { counter: 1 });
          expect((await error(res)).code).toBe("staff_key_suspended");
        },
      ],
      ["a demotion by grant-role", async (s) => void (await runGrantRole({ authDb, kv: new MemoryKv(), mailer }, s.user.email, "user"))],
      ["a change from moderator to admin", async (s) => void (await runGrantRole({ authDb, kv: new MemoryKv(), mailer }, s.user.email, "admin"))],
      ["the account's take-down", async (s) => void (await repo.takeDown(s.user.id, clock.now(), null))],
      // Changes that revoke nothing: the session is read with its key and its account at every request, so no tombstone is needed.
      ["its key revoked in the database alone", async (s) => void (await authDb.update(staffKeys).set({ revokedAt: clock.now() }).where(eq(staffKeys.id, s.keyId)))],
      ["the account's role set to user in the database alone", async (s) => void (await authDb.update(users).set({ role: "user" }).where(eq(users.id, s.user.id)))],
      ["the account marked deleted in the database alone", async (s) => void (await authDb.update(users).set({ deletedAt: clock.now() }).where(eq(users.id, s.user.id)))],
      ["the session revoked in the database", async (s) => void (await authDb.update(staffSessions).set({ revokedAt: clock.now() }).where(eq(staffSessions.id, sha256Hex(s.token))))],
      [
        "a revocation confirmed with the key in another browser",
        async (s) => {
          const other = consoleBrowser();
          expect((await s.signIn(other)).res.status).toBe(200);
          const handle = (await sessionRow(s.token)).handle;
          const stepUp = await confirmation({ ...s, b: other }, handle, { counter: 3 });
          expect((await revokeSession(other, handle, stepUp)).status).toBe(204);
        },
      ],
      [
        "a counter that went backwards at a step-up",
        async (s) => {
          const handle = (await sessionRow(s.token)).handle;
          const res = await revokeSession(s.b, handle, await confirmation(s, handle, { counter: 1 }));
          expect([res.status, (await error(res)).code]).toEqual([403, "staff_key_suspended"]);
        },
      ],
    ];
    for (const [label, end] of enders) {
      test(label, { timeout: 30_000 }, async () => {
        const s = await staffBrowser();
        expect((await s.b.fetch("/api/staff/me")).status).toBe(200);
        await end(s);
        // Both of requireStaff's reads refuse it: the plain read (no mark, as the console's idle timer and 3c's refreshes
        // read) and the marked one, which slides the idle end in the same statement. Each is sent with the token by hand,
        // since the first 401 clears the browser's cookies; then the browser's own request.
        await expectEnded(await raw("/api/staff/me", { headers: { cookie: `${STAFF_COOKIE}=${s.token}` } }), `${label}, unmarked`);
        await expectEnded(await raw("/api/staff/me", { headers: { cookie: `${STAFF_COOKIE}=${s.token}`, ...MARKED } }), `${label}, marked`);
        await expectEnded(await s.b.fetch("/api/staff/me", { headers: MARKED }), label);
        expect(s.b.cookie(STAFF_COOKIE)).toBeUndefined();
        expect(s.b.cookie(STAFF_CSRF_COOKIE)).toBeUndefined();
      });
    }

    test("signing out: 204, both cookies cleared, the session revoked with staff_signed_out and its audit row, and no mail", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const row = await sessionRow(s.token);
      const sent = mailer.sent.length;
      const before = await head();
      clock.advance(MINUTE);
      const res = await s.b.fetch("/api/staff/signout", { method: "POST" });
      expect(res.status).toBe(204);
      const cookies = setCookies(res);
      expect([...cookies.keys()].sort()).toEqual([STAFF_COOKIE, STAFF_CSRF_COOKIE]);
      for (const line of cookies.values()) expect(line).toContain("Max-Age=0");
      expect((await sessionRow(s.token)).revokedAt).toEqual(clock.now());

      const [event] = await migrateDb
        .select({ metadata: authEvents.metadata })
        .from(authEvents)
        .where(and(eq(authEvents.userId, s.user.id), eq(authEvents.type, "staff_signed_out")));
      expect(event!.metadata).toEqual({ handle: row.handle });
      const written = await migrateDb.select().from(auditLog).where(gt(auditLog.chainSeq, before.seq)).orderBy(asc(auditLog.chainSeq));
      expect(written.map((r) => [r.action, r.actorId, r.targetType, r.targetId, r.staffSession, r.keyId, r.requestId, r.metadata])).toEqual([
        ["staff_signed_out", s.user.id, "staff_session", row.handle, row.handle, s.keyId, res.headers.get("x-request-id"), {}],
      ]);
      expect(mailer.sent.length).toBe(sent);
      await expectEnded(await raw("/api/staff/me", { headers: { cookie: `${STAFF_COOKIE}=${s.token}` } }), "after signing out");
      // Signing out again is a session that has ended.
      await expectEnded(await raw("/api/staff/signout", { method: "POST", headers: { origin: TEST_CONSOLE_ORIGIN, cookie: `${STAFF_COOKIE}=${s.token}; ${STAFF_CSRF_COOKIE}=x`, "x-staff-csrf": "x" } }), "signing out twice");
    });
  });

  describe("revoking a session, confirmed with the staff key", () => {
    test("the options name the session's key alone over a challenge the console can check; DELETE with the confirmation answers 204, the session ends at its next request, and the row carries the request's id and the confirmation", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const other = consoleBrowser();
      expect((await s.signIn(other)).res.status).toBe(200);
      const mine = await sessionRow(s.token);
      const target = await sessionRow(other.cookie(STAFF_COOKIE)!);
      const request = revokeRequest(target.handle);

      const optionsRes = await s.b.fetch("/api/staff/step-up/options", { json: request, headers: MARKED });
      expect(optionsRes.status).toBe(200);
      expect(accessControlHeaders(optionsRes)).toEqual([]);
      expect(optionsRes.headers.getSetCookie()).toEqual([]);
      const { options } = StaffStepUpOptionsResponse.parse(await optionsRes.json());
      expect(options.rpId).toBe(TEST_CONSOLE_RP_ID);
      expect(options.allowCredentials).toEqual([{ id: s.credentialId, type: "public-key", transports: ["usb", "nfc"] }]);
      expect(options.userVerification).toBe("required");
      // What the console checks before it asks for the key: the layout, the purpose, and the binding of its own session's
      // handle and the hash of what it sent.
      const actionHash = await stepUpActionHash(request);
      const challenge = Buffer.from(options.challenge, "base64url");
      const L = STAFF_STEP_UP_CHALLENGE;
      expect(challenge).toHaveLength(L.bytes);
      expect(challenge[L.purposeAt]).toBe(L.purpose);
      expect(challenge.subarray(L.bindingAt, L.sealAt).equals(Buffer.from(await stepUpBinding(mine.handle, actionHash)))).toBe(true);

      const stepUp = await confirmation(s, target.handle, { counter: 3, challenge: options.challenge });
      const before = await head();
      clock.advance(MINUTE);
      const res = await revokeSession(s.b, target.handle, stepUp);
      expect(res.status, await res.clone().text()).toBe(204);
      expect(res.headers.getSetCookie()).toEqual([]);
      expect(accessControlHeaders(res)).toEqual([]);
      expect((await sessionRow(other.cookie(STAFF_COOKIE)!)).revokedAt).toEqual(clock.now());
      const written = await migrateDb.select().from(auditLog).where(gt(auditLog.chainSeq, before.seq)).orderBy(asc(auditLog.chainSeq));
      expect(written.map((r) => [r.action, r.actorId, r.targetType, r.targetId, r.staffSession, r.keyId, r.actionHash, r.stepUp, r.metadata, r.requestId])).toEqual([
        [
          "staff_session_revoked",
          s.user.id,
          "staff_session",
          target.handle,
          mine.handle,
          s.keyId,
          actionHash,
          { authenticatorData: stepUp.response.authenticatorData, clientDataJSON: stepUp.response.clientDataJSON, signature: stepUp.response.signature },
          { params: {} },
          res.headers.get("x-request-id"),
        ],
      ]);
      await expectEnded(await other.fetch("/api/staff/me"), "the revoked session");
      expect((await s.b.fetch("/api/staff/me")).status).toBe(200);
      // The person may end the session they ask from as well; it ends at its next request.
      expect((await revokeSession(s.b, mine.handle, await confirmation(s, mine.handle, { counter: 4 }))).status).toBe(204);
      await expectEnded(await s.b.fetch("/api/staff/me"), "the session that revoked itself");
    });

    test("without a confirmation the answer is staff_step_up_required; a body, target or options request the schemas refuse is invalid_request; without the staff CSRF header, csrf_failed; nothing changes", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const other = consoleBrowser();
      expect((await s.signIn(other)).res.status).toBe(200);
      const target = await sessionRow(other.cookie(STAFF_COOKIE)!);
      const before = await head();
      for (const [label, init] of [
        ["no body", { method: "DELETE" }],
        ["an empty body", { method: "DELETE", json: {} }],
      ] as const) {
        const res = await s.b.fetch(`/api/staff/sessions/${target.handle}`, init);
        expect([label, res.status, (await error(res)).code]).toEqual([label, 403, "staff_step_up_required"]);
      }
      // Any assertion's shape will do for the schemas: the sign-in's is one.
      const shaped = s.first.response;
      for (const [label, path, body] of [
        ["a member the action's params do not take", `/api/staff/sessions/${target.handle}`, { all: true, stepUp: shaped }],
        ["a stepUp that is not an assertion", `/api/staff/sessions/${target.handle}`, { stepUp: { id: "x" } }],
        ["a handle that is not a uuid", "/api/staff/sessions/not-a-handle", { stepUp: shaped }],
      ] as const) {
        const res = await s.b.fetch(path, { method: "DELETE", json: body });
        expect([label, res.status, (await error(res)).code]).toEqual([label, 400, "invalid_request"]);
      }
      for (const [label, body] of [
        ["an action no step-up confirms", { ...revokeRequest(target.handle), action: "role_granted" }],
        ["another target type", { ...revokeRequest(target.handle), target: { type: "user", id: target.handle } }],
        ["params the action does not take", { ...revokeRequest(target.handle), params: { all: true } }],
        ["a target that is not a uuid", revokeRequest("not-a-handle")],
      ] as const) {
        const res = await s.b.fetch("/api/staff/step-up/options", { json: body });
        expect([label, res.status, (await error(res)).code]).toEqual([label, 400, "invalid_request"]);
      }
      // A write without the staff CSRF header is refused before the session is read, the options included.
      const stepUp = await confirmation(s, target.handle, { counter: 3 });
      expect((await s.b.fetch(`/api/staff/sessions/${target.handle}`, { method: "DELETE", json: { stepUp }, csrf: false })).status).toBe(403);
      expect((await s.b.fetch("/api/staff/step-up/options", { json: revokeRequest(target.handle), csrf: false })).status).toBe(403);
      expect((await sessionRow(other.cookie(STAFF_COOKIE)!)).revokedAt).toBeNull();
      expect(await head()).toEqual(before);
      // The confirmation the refused write carried was never read, so it still confirms what it was given for.
      expect((await revokeSession(s.b, target.handle, stepUp)).status).toBe(204);
    });

    test("a spent challenge, one of another purpose, one with another binding and a bad signature are staff_step_up_invalid, never a passkey code; an expired one is challenge_expired", { timeout: 60_000 }, async () => {
      const s = await staffBrowser();
      const other = consoleBrowser();
      expect((await s.signIn(other)).res.status).toBe(200);
      const mine = await sessionRow(s.token);
      const target = await sessionRow(other.cookie(STAFF_COOKIE)!);
      const key = challengeKey(decodeKey(config.AUTH_HMAC_KEY));
      const actionHash = await stepUpActionHash(revokeRequest(target.handle));
      const fresh = await confirmation(s, target.handle, { counter: 3 });
      const freshChallenge = JSON.parse(Buffer.from(fresh.response.clientDataJSON, "base64url").toString()).challenge as string;
      const signInChallenge = JSON.parse(Buffer.from(s.first.response.response.clientDataJSON, "base64url").toString()).challenge as string;
      const cases: [string, () => Promise<AuthenticationResponseJSON>][] = [
        // The library refuses it, after the challenge was spent: the same challenge signed well is then a spent one.
        ["a bad signature", async () => badSignature(fresh)],
        ["a spent step-up challenge", () => confirmation(s, target.handle, { counter: 4, challenge: freshChallenge })],
        ["the sign-in's challenge", () => confirmation(s, target.handle, { counter: 5, challenge: signInChallenge })],
        ["a staff sign-in challenge", () => confirmation(s, target.handle, { counter: 6, challenge: issueChallenge(key, "staff_signin", clock.now()) })],
        ["a re-authentication challenge for this session", () => confirmation(s, target.handle, { counter: 7, challenge: issueChallenge(key, "reauth", clock.now(), mine.handle) })],
        ["a step-up challenge for another session", () => confirmation(s, target.handle, { counter: 8, challenge: issueStepUpChallenge(key, clock.now(), target.handle, actionHash) })],
        [
          "a step-up challenge for another target",
          async () => confirmation(s, target.handle, { counter: 9, challenge: issueStepUpChallenge(key, clock.now(), mine.handle, await stepUpActionHash(revokeRequest(mine.handle))) }),
        ],
      ];
      for (const [label, make] of cases) {
        const res = await revokeSession(s.b, target.handle, await make());
        const { code } = await error(res);
        expect([label, res.status, code]).toEqual([label, 403, "staff_step_up_invalid"]);
        expect(code, label).not.toMatch(/^passkey_/);
      }
      const late = await confirmation(s, target.handle, { counter: 10 });
      clock.advance(10 * MINUTE);
      const expired = await revokeSession(s.b, target.handle, late);
      expect([expired.status, (await error(expired)).code]).toEqual([400, "challenge_expired"]);
      expect((await sessionRow(other.cookie(STAFF_COOKIE)!)).revokedAt).toBeNull();
    });

    test("another account's session is no session of the person's: 404, it lives on, and the confirmation is spent", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const t = await staffBrowser();
      const theirs = await sessionRow(t.token);
      const before = await head();
      const stepUp = await confirmation(s, theirs.handle, { counter: 3 });
      const res = await revokeSession(s.b, theirs.handle, stepUp);
      expect([res.status, (await error(res)).code]).toEqual([404, "not_found"]);
      expect((await sessionRow(t.token)).revokedAt).toBeNull();
      expect((await t.b.fetch("/api/staff/me")).status).toBe(200);
      expect(await head()).toEqual(before);
      const again = await revokeSession(s.b, theirs.handle, stepUp);
      expect([again.status, (await error(again)).code]).toEqual([403, "staff_step_up_invalid"]);
    });

    test("a handle in upper case is invalid_request, for the options and for the revocation even with a confirmation bound to that spelling: the id is hashed as sent but recorded as the database writes it, so only that spelling is taken", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const other = consoleBrowser();
      expect((await s.signIn(other)).res.status).toBe(200);
      const mine = await sessionRow(s.token);
      const target = await sessionRow(other.cookie(STAFF_COOKIE)!);
      const upper = target.handle.toUpperCase();
      expect(upper).not.toBe(target.handle);
      const before = await head();
      const options = await s.b.fetch("/api/staff/step-up/options", { json: revokeRequest(upper), headers: MARKED });
      expect(options.status, await options.clone().text()).toBe(400);
      expect((await error(options)).code).toBe("invalid_request");
      // The challenge such options would have carried, bound to the upper-case spelling and signed by the session's key.
      const key = challengeKey(decodeKey(config.AUTH_HMAC_KEY));
      const bound = issueStepUpChallenge(key, clock.now(), mine.handle, await stepUpActionHash(revokeRequest(upper)));
      const res = await revokeSession(s.b, upper, await confirmation(s, upper, { counter: 3, challenge: bound }));
      expect(res.status, await res.clone().text()).toBe(400);
      expect((await error(res)).code).toBe("invalid_request");
      expect((await sessionRow(other.cookie(STAFF_COOKIE)!)).revokedAt).toBeNull();
      expect(await head()).toEqual(before);
      // The spelling the console reads from /sessions revokes it.
      expect((await revokeSession(s.b, target.handle, await confirmation(s, target.handle, { counter: 4 }))).status).toBe(204);
    });

    test("a session that ends inside the step-up is answered as requireStaff answers it, staff_session_required with both cookies cleared: its key revoked just before the options, or its key revoked or its account demoted between the confirmation and the action", { timeout: 60_000 }, async () => {
      type Staff = Awaited<ReturnType<typeof staffBrowser>>;
      const revokeKey = (s: Staff) => authDb.update(staffKeys).set({ revokedAt: clock.now() }).where(eq(staffKeys.id, s.keyId));
      const demote = (s: Staff) => authDb.update(users).set({ role: "user" }).where(eq(users.id, s.user.id));
      // Each change is made inside the request, after requireStaff read the session live: just before the options read
      // the session's key, or just before the revocation's transaction.
      const cases: [string, "findStaffKeyCredential" | "revokeConfirmedStaffSession", (s: Staff) => Promise<unknown>][] = [
        ["the key revoked before the options", "findStaffKeyCredential", revokeKey],
        ["the key revoked after the confirmation", "revokeConfirmedStaffSession", revokeKey],
        ["the account demoted after the confirmation", "revokeConfirmedStaffSession", demote],
      ];
      for (const [label, method, end] of cases) {
        const s = await staffBrowser();
        const other = consoleBrowser();
        expect((await s.signIn(other)).res.status, label).toBe(200);
        const target = await sessionRow(other.cookie(STAFF_COOKIE)!);
        const stepUp = method === "revokeConfirmedStaffSession" ? await confirmation(s, target.handle, { counter: 3 }) : undefined;
        const flows = auth.deps.repo;
        const original = flows[method].bind(flows) as (...args: unknown[]) => Promise<unknown>;
        const spy = vi.spyOn(flows, method).mockImplementationOnce((async (...args: unknown[]) => {
          await end(s);
          return original(...args);
        }) as never);
        try {
          const res = stepUp
            ? await revokeSession(s.b, target.handle, stepUp)
            : await s.b.fetch("/api/staff/step-up/options", { json: revokeRequest(target.handle), headers: MARKED });
          expect(spy, label).toHaveBeenCalledOnce();
          await expectEnded(res, label);
        } finally {
          spy.mockRestore();
        }
        expect(s.b.cookie(STAFF_COOKIE), label).toBeUndefined();
        expect(s.b.cookie(STAFF_CSRF_COOKIE), label).toBeUndefined();
        expect((await sessionRow(other.cookie(STAFF_COOKIE)!)).revokedAt, label).toBeNull();
      }
    });
  });

  describe("what opens a staff route", () => {
    test("the staff cookie only: the app's session cookie and a bearer token are refused, a staff cookie opens no app route, and a session created after now is refused", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const app_ = await auth.deps.sessions.issue(s.user.id, s.device.id, { factors: { email: clock.ms() } });
      await expectEnded(await raw("/api/staff/me", { headers: { cookie: `__Host-korbat_session=${app_.token}` } }), "the app's session cookie");
      await expectEnded(await raw("/api/staff/me", { headers: { authorization: `Bearer ${app_.token}` } }), "a bearer token");
      await expectEnded(await raw("/api/staff/me", { headers: { authorization: `Bearer ${s.token}` } }), "the staff token as a bearer token");
      // The staff cookie under the app's name, and on the app's host, opens nothing there.
      const onApp = await app.request("/api/me", { headers: { cookie: `${STAFF_COOKIE}=${s.token}`, "cf-connecting-ip": randomIp() } });
      expect(onApp.status).toBe(401);
      expect((await error(onApp)).code).toBe("unauthenticated");
      const asApp = await app.request("/api/me", { headers: { cookie: `__Host-korbat_session=${s.token}`, "cf-connecting-ip": randomIp() } });
      expect(asApp.status).toBe(401);

      // A row written behind the flows' back that starts in the future, within the database's 12 hours.
      const token = randomToken();
      const start = new Date(clock.ms() + HOUR);
      await authDb.insert(staffSessions).values({
        id: sha256Hex(token),
        userId: s.user.id,
        keyId: s.keyId,
        createdAt: start,
        lastUsedAt: start,
        idleExpiresAt: new Date(start.getTime() + 15 * MINUTE),
        absoluteExpiresAt: new Date(start.getTime() + 12 * HOUR),
        browser: "Firefox on Linux",
      });
      await expectEnded(await raw("/api/staff/me", { headers: { cookie: `${STAFF_COOKIE}=${token}` } }), "a session created after now");
    });

    test("CSRF: a write needs x-staff-csrf equal to the staff CSRF cookie; the app's CSRF cookie and header do not count, and a refused write touches nothing", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const csrf = s.b.cookie(STAFF_CSRF_COOKIE)!;
      const before = await sessionRow(s.token);
      clock.advance(MINUTE);
      const post = (headers: Record<string, string>) => raw("/api/staff/signout", { method: "POST", headers: { origin: TEST_CONSOLE_ORIGIN, ...MARKED, ...headers } });
      const cases: [string, Record<string, string>][] = [
        ["no header", { cookie: `${STAFF_COOKIE}=${s.token}; ${STAFF_CSRF_COOKIE}=${csrf}` }],
        ["another value", { cookie: `${STAFF_COOKIE}=${s.token}; ${STAFF_CSRF_COOKIE}=${csrf}`, "x-staff-csrf": `${csrf.slice(1)}A` }],
        ["the header without its cookie", { cookie: `${STAFF_COOKIE}=${s.token}`, "x-staff-csrf": csrf }],
        ["the app's CSRF cookie and header", { cookie: `${STAFF_COOKIE}=${s.token}; __Host-korbat_csrf=${csrf}`, "x-csrf-token": csrf }],
      ];
      for (const [label, headers] of cases) {
        const res = await post(headers);
        expect([label, res.status, (await error(res)).code]).toEqual([label, 403, "csrf_failed"]);
        expect(res.headers.getSetCookie(), label).toEqual([]);
      }
      expect((await s.b.fetch("/api/staff/signout", { method: "POST", csrf: false })).status).toBe(403);
      expect(await sessionRow(s.token)).toEqual(before);
      expect((await s.b.fetch("/api/staff/signout", { method: "POST" })).status).toBe(204);
    });
  });

  describe("the staff gate over HTTP", () => {
    test("a console POST sent with the app's session and CSRF cookies present reaches its route and is not csrf_failed", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const app_ = await auth.deps.sessions.issue(s.user.id, s.device.id, { factors: { email: clock.ms() } });
      const csrf = s.b.cookie(STAFF_CSRF_COOKIE)!;
      const res = await raw("/api/staff/signout", {
        method: "POST",
        headers: {
          origin: TEST_CONSOLE_ORIGIN,
          "sec-fetch-site": "same-origin",
          cookie: `__Host-korbat_session=${app_.token}; __Host-korbat_csrf=app-csrf; ${STAFF_COOKIE}=${s.token}; ${STAFF_CSRF_COOKIE}=${csrf}`,
          "x-csrf-token": "app-csrf",
          "x-staff-csrf": csrf,
        },
      });
      expect(res.status, await res.clone().text()).toBe(204);
      expect((await sessionRow(s.token)).revokedAt).not.toBeNull();
      // The app's session was neither read nor ended.
      expect(await repo.findActiveSession(app_.session.sessionId, clock.now())).toBeDefined();
    });

    test("no answer under /api/staff/ carries an Access-Control-* header, even to an Origin the app trusts", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const trusted = config.TRUSTED_ORIGINS[0]!;
      const cookie = `${STAFF_COOKIE}=${s.token}`;
      for (const [label, path, init] of [
        ["a read with the trusted Origin", "/api/staff/me", { headers: { cookie, origin: trusted } }],
        ["a preflight from the trusted Origin", "/api/staff/signout", { method: "OPTIONS", headers: { origin: trusted, "access-control-request-method": "POST" } }],
        ["a read of the audit log", "/api/staff/audit", { headers: { cookie } }],
        ["a read with the console's Origin", "/api/staff/sessions", { headers: { cookie, origin: TEST_CONSOLE_ORIGIN } }],
        ["the sign-in options", "/api/staff/signin/options", { method: "POST", headers: { origin: trusted } }],
      ] as const) {
        const res = await raw(path, init);
        expect(accessControlHeaders(res), label).toEqual([]);
      }
      expect(accessControlHeaders(s.first.res)).toEqual([]);
    });

    test("Sec-Fetch-Site other than same-origin, or another Origin, is refused and leaves the idle end and the last use unchanged; another Host is the unknown route", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const before = await sessionRow(s.token);
      clock.advance(5 * MINUTE);
      const cookie = `${STAFF_COOKIE}=${s.token}`;
      for (const [label, headers] of [
        ["same-site", { "sec-fetch-site": "same-site" }],
        ["cross-site", { "sec-fetch-site": "cross-site" }],
        ["the app's Origin", { origin: "http://localhost:8081" }],
        ["another localhost port", { origin: "http://localhost:8090" }],
      ] as const) {
        const res = await raw("/api/staff/me", { headers: { cookie, ...MARKED, ...headers } });
        expect([label, res.status, (await error(res)).code]).toEqual([label, 403, "csrf_failed"]);
        expect(res.headers.getSetCookie(), label).toEqual([]);
      }
      expect(await sessionRow(s.token)).toEqual(before);
      // Another Host, the console's cookie and mark notwithstanding: the 404 of an unknown route, the session untouched.
      for (const host of ["localhost:8080", "console.localhost", "localhost:8090"]) {
        const res = await app.request(`http://${host}/api/staff/me`, { headers: { host, cookie, ...MARKED, "cf-connecting-ip": randomIp() } });
        expect([host, res.status, (await error(res)).code]).toEqual([host, 404, "not_found"]);
      }
      expect(await sessionRow(s.token)).toEqual(before);
    });
  });

  describe("the audit log", () => {
    test("newest first by place, the sign-in's row naming its actor by handle; the staff_sign_in filter, cursor pages and ?at=; reading writes nothing", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const [signInRow] = await migrateDb
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, "staff_sign_in"), eq(auditLog.actorId, s.user.id)));
      const before = await head();

      const page = AuditPage.parse(await (await s.b.fetch("/api/staff/audit")).json());
      expect(page.entries[0]!.seq).toBe(before.seq);
      expect(page.entries.map((e) => e.seq)).toEqual([...page.entries.map((e) => e.seq)].sort((a, b) => b - a));
      const mine = page.entries.find((e) => e.seq === signInRow!.chainSeq)!;
      expect(mine).toEqual({
        seq: signInRow!.chainSeq,
        hash: signInRow!.hash,
        createdAt: signInRow!.createdAt.toISOString(),
        actorHandle: s.handle,
        action: "staff_sign_in",
        targetType: "staff_session",
        targetId: signInRow!.targetId,
        actionHash: null,
      });

      const signIns = AuditPage.parse(await (await s.b.fetch("/api/staff/audit?action=staff_sign_in")).json());
      expect(signIns.entries.every((e) => e.action === "staff_sign_in")).toBe(true);
      expect(signIns.entries[0]!.seq).toBe(signInRow!.chainSeq);

      const at = AuditPage.parse(await (await s.b.fetch(`/api/staff/audit?at=${signInRow!.chainSeq}`)).json());
      expect(at.entries[0]!.seq).toBe(signInRow!.chainSeq);
      const older = AuditPage.parse(await (await s.b.fetch(`/api/staff/audit?cursor=${signInRow!.chainSeq}`)).json());
      expect(older.entries.every((e) => e.seq < signInRow!.chainSeq)).toBe(true);

      for (const query of ["?at=0", "?cursor=2&at=2", "?action=role_granted", "?cursor=abc"]) {
        const res = await s.b.fetch(`/api/staff/audit${query}`);
        expect([query, res.status, (await error(res)).code]).toEqual([query, 400, "invalid_request"]);
      }
      expect(await head()).toEqual(before);
      await expectEnded(await raw("/api/staff/audit"), "without a session");
    });
  });
});
