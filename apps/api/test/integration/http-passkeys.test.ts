import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import Redis from "ioredis";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import { ErrorEnvelope, FlowResponse, MeResponse, PasskeyListResponse, PasskeyOptionsResponse, PasskeyView, ReauthResponse } from "@korbat/contracts";
import { closeDb, createDb, sessions, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth, redisKv, type Auth } from "../../src/auth";
import { encrypt, randomToken, sha256Hex } from "../../src/auth/crypto";
import type { PublicKeyCredentialCreationOptionsJSON } from "../../src/auth/passkeys/webauthn";
import { currentStep, hotp, newTotpSecret } from "../../src/auth/totp";
import { loadConfig, type Config } from "../../src/config";
import { smtpMailer } from "../../src/mail/smtp";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { SoftAuthenticator, type SoftFlags } from "../auth/soft-authenticator";
import { Browser } from "./http-client";
import { codeFrom, inbox } from "./mailpit";

const PASSWORD = "correct horse battery staple";
const ALL: SoftFlags = { up: true, uv: true, be: true, bs: true };
const SUBJECT = {
  signUp: "Your korbat sign-up code",
  reauth: "Confirm it's you on korbat",
  passkeyAdded: "A passkey was added to your korbat account",
  passkeyRemoved: "A passkey was removed from your korbat account",
};
const PasskeyResponse = z.object({ passkey: PasskeyView });

const newEmail = (prefix: string) => `${prefix}-${randomUUID()}@korbat.local`;
const newHandle = () => `p_${randomBytes(6).toString("hex")}`;

/**
 * The passkey routes over HTTP (1c design, section 10) with the real Redis store and real SMTP into Mailpit: every guard
 * and limit of registration, the list, rename, removal, "not mine" and the remove link, and strong freshness on the two
 * level-2 routes for an account with TOTP.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the passkey routes over HTTP (Postgres, Redis, Mailpit)", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let redis: Redis;
  let auth: Auth;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
    redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
    auth = createAuth({
      config,
      logger,
      authDb,
      // A fresh key prefix per run, so rate-limit counters from earlier runs never interfere.
      kv: redisKv(redis, `korbat:test:${randomUUID()}:`),
      mailer: smtpMailer(config.SMTP_URL, config.MAIL_FROM),
      profiles: createProfileStore(apiDb),
      turnstile: { verify: async () => true },
      breachChecker: { isBreached: async () => false },
    });
    app = createApp({ config, logger, rateLimitStore: new MemoryStore(), healthChecks: {}, auth });
  });
  afterAll(async () => {
    await Promise.allSettled([closeDb(authDb), closeDb(apiDb), redis.quit()]);
  });

  const web = () => new Browser(app, config.APP_ORIGIN);
  const error = async (res: Response) => ErrorEnvelope.parse(await res.json()).error;
  const sessionIdOf = (b: Browser) => sha256Hex(b.cookie("__Host-korbat_session")!);
  const userIdOf = async (b: Browser) => MeResponse.parse(await (await b.fetch("/api/me")).json()).user.id;

  /** A signed-up web account with codes read from Mailpit, onboarded unless told otherwise; its session proved the sign-up's email code and nothing else. */
  async function signUp(options: { onboard?: boolean } = {}) {
    const b = web();
    const email = newEmail("passkeys");
    const box = await inbox(email);
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(start.status).toBe(200);
    const { flowId } = FlowResponse.parse(await start.json());
    expect((await b.fetch("/api/auth/email/verify", { json: { flowId, code: codeFrom(await box.next(SUBJECT.signUp)) } })).status).toBe(200);
    expect((await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).status).toBe(200);
    if (options.onboard !== false) expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle: newHandle(), displayName: "Passkey User" } })).status).toBe(200);
    return { b, email, box, userId: await userIdOf(b) };
  }

  /** A second session of an account that holds PASSWORD, signed in with it from another browser (a code would wait on the address's one-minute cooldown). */
  async function secondSession(email: string) {
    const other = web();
    const signedIn = await other.fetch("/api/auth/password/signin", { json: { email, password: PASSWORD, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(signedIn.status).toBe(200);
    expect((await other.fetch("/api/me")).status).toBe(200);
    return other;
  }

  /** TOTP on, as the confirm step leaves it; the session cache is dropped so mfaEnabled shows. */
  async function withTotp(userId: string) {
    const secret = newTotpSecret();
    await auth.deps.repo.enableTotp(userId, { secretEnc: encrypt(Buffer.from(secret), auth.deps.config.totpKey), recoveryCodesHash: [], now: new Date() });
    await auth.deps.sessions.forgetUser(userId);
    return secret;
  }
  const totpNow = (secret: Uint8Array) => hotp(secret, currentStep(Date.now()));

  /** The session's only factor is the sign-up's email code; moved ten minutes back, nothing within the window is left. */
  async function makeStale(b: Browser) {
    await auth.deps.repo.writeFactor(sessionIdOf(b), "email", new Date(Date.now() - 10 * 60_000));
    await auth.deps.kv.del(`sess:${sessionIdOf(b)}`);
  }

  const optionsFor = async (b: Browser, label = "ada") => {
    const res = await b.fetch("/api/auth/passkeys/register/options", { json: { label } });
    expect(res.status).toBe(200);
    // The contract checks the challenge only and passes the rest through; the test reads the options as the library wrote them.
    return PasskeyOptionsResponse.parse(await res.json()).options as unknown as PublicKeyCredentialCreationOptionsJSON;
  };
  const answer = (authenticator: SoftAuthenticator, options: PublicKeyCredentialCreationOptionsJSON, flags: SoftFlags = ALL) =>
    authenticator.create({ rpId: options.rp.id!, challenge: options.challenge, origin: config.APP_ORIGIN, userHandle: Buffer.from(options.user.id, "base64url"), flags });
  /** A whole registration over HTTP; answers the stored passkey's view. */
  async function register(b: Browser, name?: string) {
    const response = answer(new SoftAuthenticator(), await optionsFor(b));
    const res = await b.fetch("/api/auth/passkeys/register/verify", { json: name === undefined ? { response } : { name, response } });
    expect(res.status).toBe(200);
    return PasskeyResponse.parse(await res.json()).passkey;
  }
  const listed = async (b: Browser) => PasskeyListResponse.parse(await (await b.fetch("/api/auth/passkeys")).json()).passkeys;

  test("registration takes a session at onboarding scope: the options need strong freshness, the verification only its bound challenge; the list needs an onboarded session; me counts", { timeout: 60_000 }, async () => {
    const { b, box } = await signUp({ onboard: false });
    const options = await optionsFor(b, "ada on the laptop");
    expect(options.user.name).toBe("ada on the laptop");
    expect(options.rp).toEqual({ id: config.WEBAUTHN_RP_ID, name: config.WEBAUTHN_RP_NAME });
    // Bad input: an empty label.
    expect((await b.fetch("/api/auth/passkeys/register/options", { json: { label: "" } })).status).toBe(400);
    // A stale session gets no options; the ceremony it already started still completes.
    await makeStale(b);
    const refused = await b.fetch("/api/auth/passkeys/register/options", { json: { label: "ada" } });
    expect(refused.status).toBe(403);
    expect(await error(refused)).toMatchObject({ code: "reauth_required", details: { level: 1, have: [] } });
    const verify = await b.fetch("/api/auth/passkeys/register/verify", { json: { name: "Laptop", response: answer(new SoftAuthenticator(), options) } });
    expect(verify.status).toBe(200);
    const { passkey } = PasskeyResponse.parse(await verify.json());
    expect(passkey).toMatchObject({ name: "Laptop", synced: true, createdOn: "Browser on unknown OS", current: false, isNew: true, suspended: false });
    expect(await box.next(SUBJECT.passkeyAdded)).toMatch(/\/passkey-remove\/[A-Za-z0-9_-]{43}/);
    // The list waits for onboarding; me counts already.
    const early = await b.fetch("/api/auth/passkeys");
    expect(early.status).toBe(403);
    expect((await error(early)).code).toBe("onboarding_required");
    expect(MeResponse.parse(await (await b.fetch("/api/me")).json()).user.passkeys).toBe(1);
    expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle: newHandle(), displayName: "Passkey User" } })).status).toBe(200);
    expect(await listed(b)).toEqual([passkey]);

    // Bad input: a name over the display-name rules, a response missing its attestation.
    expect((await b.fetch("/api/auth/passkeys/register/verify", { json: { name: "x".repeat(51), response: answer(new SoftAuthenticator(), options) } })).status).toBe(400);
    expect((await b.fetch("/api/auth/passkeys/register/verify", { json: { response: { id: "AAAA" } } })).status).toBe(400);

    // Without a session, both are unauthenticated.
    const stranger = web();
    for (const route of ["/api/auth/passkeys/register/options", "/api/auth/passkeys/register/verify"]) {
      const res = await stranger.fetch(route, { json: { label: "ada", response: answer(new SoftAuthenticator(), options) } });
      expect(res.status, route).toBe(401);
      expect((await error(res)).code, route).toBe("unauthenticated");
    }
    expect((await stranger.fetch("/api/auth/passkeys")).status).toBe(401);
  });

  test("on an account with TOTP, the options and the removal need level 2: a session with its email code alone is refused with what it lacks, and passes after a TOTP re-authentication", { timeout: 60_000 }, async () => {
    const { b, userId } = await signUp();
    const passkey = await register(b, "Laptop");
    const secret = await withTotp(userId);
    const options = await b.fetch("/api/auth/passkeys/register/options", { json: { label: "ada" } });
    expect(options.status).toBe(403);
    expect(await error(options)).toMatchObject({ code: "reauth_required", details: { level: 2, have: ["email"] } });
    const removal = await b.fetch(`/api/auth/passkeys/${passkey.id}`, { method: "DELETE" });
    expect(removal.status).toBe(403);
    expect(await error(removal)).toMatchObject({ code: "reauth_required", details: { level: 2, have: ["email"] } });
    // Level 1 keeps its routes: the list, a rename and "not mine" on an unknown passkey answer for their own reasons.
    expect((await b.fetch("/api/auth/passkeys")).status).toBe(200);
    expect((await b.fetch(`/api/auth/passkeys/${passkey.id}`, { method: "PATCH", json: { name: "Renamed" } })).status).toBe(200);
    expect((await b.fetch(`/api/auth/passkeys/${randomUUID()}/not-mine`, { method: "POST" })).status).toBe(404);

    const reauth = await b.fetch("/api/auth/reauth", { json: { method: "totp", code: totpNow(secret) } });
    expect(reauth.status).toBe(200);
    expect(ReauthResponse.parse(await reauth.json())).toEqual({ level: 2 });
    expect((await b.fetch("/api/auth/passkeys/register/options", { json: { label: "ada" } })).status).toBe(200);
    expect((await b.fetch(`/api/auth/passkeys/${passkey.id}`, { method: "DELETE" })).status).toBe(204);
    expect(await listed(b)).toEqual([]);
    expect(MeResponse.parse(await (await b.fetch("/api/me")).json()).user.passkeys).toBe(0);
  });

  test("rename and removal act on the account's own passkeys only: another account's is 404, a malformed id or name is 400; the removal is mailed", { timeout: 60_000 }, async () => {
    const ada = await signUp();
    const bob = await signUp();
    const passkey = await register(ada.b, "Laptop");
    await ada.box.next(SUBJECT.passkeyAdded);
    for (const init of [{ method: "PATCH", json: { name: "Taken" } }, { method: "DELETE" }, { method: "POST" }] as const) {
      const route = init.method === "POST" ? `/api/auth/passkeys/${passkey.id}/not-mine` : `/api/auth/passkeys/${passkey.id}`;
      const res = await bob.b.fetch(route, init);
      expect(res.status, init.method).toBe(404);
      expect((await error(res)).code, init.method).toBe("passkey_not_found");
    }
    expect((await ada.b.fetch("/api/auth/passkeys/not-a-uuid", { method: "PATCH", json: { name: "Fine" } })).status).toBe(400);
    expect((await ada.b.fetch("/api/auth/passkeys/not-a-uuid", { method: "DELETE" })).status).toBe(400);
    expect((await ada.b.fetch(`/api/auth/passkeys/${passkey.id}`, { method: "PATCH", json: { name: "" } })).status).toBe(400);
    expect((await ada.b.fetch(`/api/auth/passkeys/${passkey.id}`, { method: "PATCH", json: {} })).status).toBe(400);
    expect(await listed(ada.b)).toEqual([passkey]);

    const renamed = await ada.b.fetch(`/api/auth/passkeys/${passkey.id}`, { method: "PATCH", json: { name: " Work laptop " } });
    expect(renamed.status).toBe(200);
    expect(PasskeyResponse.parse(await renamed.json()).passkey).toEqual({ ...passkey, name: "Work laptop" });
    expect((await listed(ada.b)).map((p) => p.name)).toEqual(["Work laptop"]);
    expect((await ada.b.fetch(`/api/auth/passkeys/${passkey.id}`, { method: "DELETE" })).status).toBe(204);
    expect(await ada.box.next(SUBJECT.passkeyRemoved)).toContain('"Work laptop"');
    expect(await listed(ada.b)).toEqual([]);
    expect((await ada.b.fetch(`/api/auth/passkeys/${passkey.id}`, { method: "DELETE" })).status).toBe(404);
    // Still signed in: a removal is not a lockdown.
    expect((await ada.b.fetch("/api/me")).status).toBe(200);
  });

  test("the limits: 10 options an hour per session, 30 renames and 10 removals an hour per account, 5 'not mine' a day, 10 remove links an hour per address; each answers rate_limited with a Retry-After", { timeout: 60_000 }, async () => {
    const { b } = await signUp();
    const limited = async (res: Response, retryAfter: number) => {
      expect(res.status).toBe(429);
      expect((await error(res)).code).toBe("rate_limited");
      expect(res.headers.get("retry-after")).toBe(String(retryAfter));
    };
    for (let i = 0; i < 10; i++) expect((await b.fetch("/api/auth/passkeys/register/options", { json: { label: "ada" } })).status).toBe(200);
    await limited(await b.fetch("/api/auth/passkeys/register/options", { json: { label: "ada" } }), 3600);
    for (let i = 0; i < 30; i++) expect((await b.fetch(`/api/auth/passkeys/${randomUUID()}`, { method: "PATCH", json: { name: "Name" } })).status).toBe(404);
    await limited(await b.fetch(`/api/auth/passkeys/${randomUUID()}`, { method: "PATCH", json: { name: "Name" } }), 3600);
    for (let i = 0; i < 10; i++) expect((await b.fetch(`/api/auth/passkeys/${randomUUID()}`, { method: "DELETE" })).status).toBe(404);
    await limited(await b.fetch(`/api/auth/passkeys/${randomUUID()}`, { method: "DELETE" }), 3600);
    for (let i = 0; i < 5; i++) expect((await b.fetch(`/api/auth/passkeys/${randomUUID()}/not-mine`, { method: "POST" })).status).toBe(404);
    await limited(await b.fetch(`/api/auth/passkeys/${randomUUID()}/not-mine`, { method: "POST" }), 86400);
    // Still signed in: none of the refusals was a lockdown.
    expect((await b.fetch("/api/me")).status).toBe(200);

    const stranger = web();
    for (let i = 0; i < 10; i++) {
      const res = await stranger.fetch("/api/auth/passkeys/remove-link", { json: { token: randomToken() } });
      expect(res.status).toBe(400);
      expect((await error(res)).code).toBe("invalid_code");
    }
    await limited(await stranger.fetch("/api/auth/passkeys/remove-link", { json: { token: randomToken() } }), 3600);
    expect((await web().fetch("/api/auth/passkeys/remove-link", { json: { token: randomToken() } })).status).toBe(400);
    expect((await web().fetch("/api/auth/passkeys/remove-link", { json: { token: "short" } })).status).toBe(400);
  });

  test("the remove link read from Mailpit removes the passkey, signs out every session and clears the password, once", { timeout: 60_000 }, async () => {
    const { b, email, box, userId } = await signUp();
    expect((await b.fetch("/api/auth/password/set", { json: { password: PASSWORD } })).status).toBe(200);
    const other = await secondSession(email);
    await register(b, "Laptop");
    const token = /\/passkey-remove\/([A-Za-z0-9_-]{43})/.exec(await box.next(SUBJECT.passkeyAdded))?.[1];
    expect(token).toBeDefined();
    expect(await auth.deps.repo.countPasskeys(userId)).toBe(1);
    expect((await other.fetch("/api/me")).status).toBe(200);

    const stranger = web();
    expect((await stranger.fetch("/api/auth/passkeys/remove-link", { json: { token } })).status).toBe(204);
    expect((await b.fetch("/api/me")).status).toBe(401);
    expect((await other.fetch("/api/me")).status).toBe(401);
    expect(await auth.deps.repo.countPasskeys(userId)).toBe(0);
    expect((await auth.deps.repo.findUserById(userId))!.passwordHash).toBeNull();
    const withPassword = await web().fetch("/api/auth/password/signin", { json: { email, password: PASSWORD, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(withPassword.status).toBe(401);
    expect((await error(withPassword)).code).toBe("invalid_credentials");
    const again = await stranger.fetch("/api/auth/passkeys/remove-link", { json: { token } });
    expect(again.status).toBe(400);
    expect(await error(again)).toMatchObject({ code: "invalid_code", message: "This link has expired or was already used." });
    expect((await auth.deps.repo.eventsSince(userId, new Date(0))).map((e) => e.type)).toContain("passkey_removed");
  });

  test("'not mine' needs a fresh session, then does what the link does and clears the web session's cookies", { timeout: 60_000 }, async () => {
    const { b, email, box, userId } = await signUp();
    expect((await b.fetch("/api/auth/password/set", { json: { password: PASSWORD } })).status).toBe(200);
    const other = await secondSession(email);
    const passkey = await register(b, "Laptop");
    await box.next(SUBJECT.passkeyAdded);
    await makeStale(b);
    const stale = await b.fetch(`/api/auth/passkeys/${passkey.id}/not-mine`, { method: "POST" });
    expect(stale.status).toBe(403);
    expect(await error(stale)).toMatchObject({ code: "reauth_required", details: { level: 1, have: [] } });
    const { flowId } = FlowResponse.parse(await (await b.fetch("/api/auth/reauth/email/start", { method: "POST" })).json());
    expect((await b.fetch("/api/auth/reauth", { json: { method: "email", flowId, code: codeFrom(await box.next(SUBJECT.reauth)) } })).status).toBe(200);

    const res = await b.fetch(`/api/auth/passkeys/${passkey.id}/not-mine`, { method: "POST" });
    expect(res.status).toBe(204);
    expect(res.headers.getSetCookie().some((line) => line.startsWith("__Host-korbat_session=") && line.includes("Max-Age=0"))).toBe(true);
    expect(b.cookie("__Host-korbat_session")).toBeUndefined();
    expect((await b.fetch("/api/me")).status).toBe(401);
    expect((await other.fetch("/api/me")).status).toBe(401);
    expect(await auth.deps.repo.countPasskeys(userId)).toBe(0);
    expect((await auth.deps.repo.findUserById(userId))!.passwordHash).toBeNull();
  });

  test("removing the passkey that started the current session keeps the session, without it", { timeout: 60_000 }, async () => {
    const { b, box } = await signUp();
    const passkey = await register(b, "Laptop");
    await box.next(SUBJECT.passkeyAdded);
    await authDb.update(sessions).set({ passkeyId: passkey.id }).where(eq(sessions.id, sessionIdOf(b)));
    await auth.deps.kv.del(`sess:${sessionIdOf(b)}`);
    expect((await listed(b)).map((p) => [p.id, p.current])).toEqual([[passkey.id, true]]);
    expect((await b.fetch(`/api/auth/passkeys/${passkey.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await b.fetch("/api/me")).status).toBe(200);
    expect(await listed(b)).toEqual([]);
    const [row] = await authDb.select({ passkeyId: sessions.passkeyId, revokedAt: sessions.revokedAt }).from(sessions).where(eq(sessions.id, sessionIdOf(b)));
    expect(row).toEqual({ passkeyId: null, revokedAt: null });
  });
});
