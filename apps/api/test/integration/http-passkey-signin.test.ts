import { randomBytes, randomUUID } from "node:crypto";
import Redis from "ioredis";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ErrorEnvelope, FlowResponse, MeResponse, PasskeyOptionsResponse, SessionResult } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth, redisKv, type Auth } from "../../src/auth";
import { encrypt, randomToken } from "../../src/auth/crypto";
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from "../../src/auth/passkeys/webauthn";
import { currentStep, hotp, newTotpSecret } from "../../src/auth/totp";
import { loadConfig, type Config } from "../../src/config";
import { smtpMailer } from "../../src/mail/smtp";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { SoftAuthenticator, type SoftFlags } from "../auth/soft-authenticator";
import { Browser, NativeClient } from "./http-client";
import { codeFrom, inbox } from "./mailpit";

const ALL: SoftFlags = { up: true, uv: true, be: true, bs: true };
const BARE: SoftFlags = { up: true, uv: false, be: false, bs: false };
const SUBJECT = { signUp: "Your korbat sign-up code" };

const newEmail = (prefix: string) => `${prefix}-${randomUUID()}@korbat.local`;
const newHandle = () => `s_${randomBytes(6).toString("hex")}`;

/**
 * The passkey sign-in and re-authentication-options routes over HTTP (1c design, sections 7.2, 7.4 and 10): their guards
 * and limits, the web cookies and the bearer token on a sign-in, and the TOTP step's answer shape.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the passkey sign-in routes over HTTP (Postgres, Redis, Mailpit)", () => {
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
  const userIdOf = async (b: Browser) => MeResponse.parse(await (await b.fetch("/api/me")).json()).user.id;

  /** A signed-up, onboarded web account with codes read from Mailpit. */
  async function signUp() {
    const b = web();
    const email = newEmail("signin");
    const box = await inbox(email);
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(start.status).toBe(200);
    const { flowId } = FlowResponse.parse(await start.json());
    expect((await b.fetch("/api/auth/email/verify", { json: { flowId, code: codeFrom(await box.next(SUBJECT.signUp)) } })).status).toBe(200);
    expect((await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).status).toBe(200);
    expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle: newHandle(), displayName: "Passkey User" } })).status).toBe(200);
    return { b, email, userId: await userIdOf(b) };
  }

  /** Registers a passkey on the signed-in browser and answers the authenticator that holds it and its credential id. */
  async function register(b: Browser, flags: SoftFlags = ALL) {
    const optionsRes = await b.fetch("/api/auth/passkeys/register/options", { json: { label: "ada" } });
    expect(optionsRes.status).toBe(200);
    const options = PasskeyOptionsResponse.parse(await optionsRes.json()).options as unknown as PublicKeyCredentialCreationOptionsJSON;
    const authenticator = new SoftAuthenticator();
    const response = authenticator.create({ rpId: options.rp.id!, challenge: options.challenge, origin: config.APP_ORIGIN, userHandle: Buffer.from(options.user.id, "base64url"), flags });
    expect((await b.fetch("/api/auth/passkeys/register/verify", { json: { response } })).status).toBe(200);
    return { authenticator, credentialId: response.id };
  }

  /** TOTP on, as the confirm step leaves it; the session cache is dropped so mfaEnabled shows. */
  async function withTotp(userId: string) {
    const secret = newTotpSecret();
    await auth.deps.repo.enableTotp(userId, { secretEnc: encrypt(Buffer.from(secret), auth.deps.config.totpKey), recoveryCodesHash: [], now: new Date() });
    await auth.deps.sessions.forgetUser(userId);
    return secret;
  }

  const signinOptions = async (client: Browser | NativeClient) => {
    const res = await client.fetch("/api/auth/passkey/signin/options", { method: "POST" });
    expect(res.status).toBe(200);
    return PasskeyOptionsResponse.parse(await res.json()).options as unknown as PublicKeyCredentialRequestOptionsJSON;
  };
  const assertion = (authenticator: SoftAuthenticator, options: PublicKeyCredentialRequestOptionsJSON, credentialId: string, flags: SoftFlags = ALL) =>
    authenticator.get({ credentialId, rpId: config.WEBAUTHN_RP_ID, challenge: options.challenge, origin: config.APP_ORIGIN, flags, counter: 0 });
  const signinVerify = (client: Browser | NativeClient, response: unknown, platform: "web" | "ios", deviceId = randomToken()) =>
    client.fetch("/api/auth/passkey/signin/verify", { json: { deviceId, platform, response } });

  test("the sign-in routes need no session; the verify body is validated; re-auth options need a session", { timeout: 60_000 }, async () => {
    const stranger = web();
    // Options are public and store nothing but the per-IP counter.
    const options = await signinOptions(stranger);
    expect(options.allowCredentials).toEqual([]);
    expect(options.challenge).toMatch(/^[A-Za-z0-9_-]{78}$/);
    // A malformed verify body is a 400 before any lookup.
    const bad = await stranger.fetch("/api/auth/passkey/signin/verify", { json: { deviceId: "short", platform: "web", response: {} } });
    expect(bad.status).toBe(400);
    expect((await error(bad)).code).toBe("invalid_request");
    // Re-authentication options need an onboarded session.
    const noSession = await stranger.fetch("/api/auth/reauth/passkey/options", { method: "POST" });
    expect(noSession.status).toBe(401);
    expect((await error(noSession)).code).toBe("unauthenticated");
  });

  test("a web sign-in sets the session cookies and no token; a native sign-in returns the bearer token and no cookies", { timeout: 60_000 }, async () => {
    const { b } = await signUp();
    const { authenticator, credentialId } = await register(b);

    // Web: a fresh browser (a new device) signs in with the passkey and gets cookies only.
    const browser = web();
    const webRes = await signinVerify(browser, assertion(authenticator, await signinOptions(browser), credentialId), "web");
    expect(webRes.status).toBe(200);
    expect(await webRes.json()).toEqual({ result: "session", mustReenrollMfa: false });
    expect(webRes.headers.getSetCookie().some((line) => line.startsWith("__Host-korbat_session="))).toBe(true);
    expect(browser.cookie("__Host-korbat_session")).toBeDefined();
    expect((await browser.fetch("/api/me")).status).toBe(200);

    // Native: the bearer token comes back in the body, and no cookies are set.
    const phone = new NativeClient(app);
    const nativeRes = await signinVerify(phone, assertion(authenticator, await signinOptions(phone), credentialId), "ios");
    expect(nativeRes.status).toBe(200);
    const body = SessionResult.parse(await nativeRes.json());
    expect(body.token).toMatch(/^kb1_[A-Za-z0-9_-]{43}$/);
    expect(nativeRes.headers.getSetCookie()).toHaveLength(0);
    phone.token = body.token;
    expect((await phone.fetch("/api/me")).status).toBe(200);
  });

  test("on an account with TOTP, a passkey without user verification stops at the TOTP step, whose code completes the sign-in", { timeout: 60_000 }, async () => {
    const { b, userId } = await signUp();
    const { authenticator, credentialId } = await register(b, BARE);
    const secret = await withTotp(userId);

    const browser = web();
    const pending = await signinVerify(browser, assertion(authenticator, await signinOptions(browser), credentialId), "web");
    expect(pending.status).toBe(200);
    const body = (await pending.json()) as { result: string; mfaTicket?: string };
    expect(body.result).toBe("mfa_required");
    expect(body.mfaTicket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(browser.cookie("__Host-korbat_session")).toBeUndefined();

    const done = await browser.fetch("/api/auth/mfa/verify", { json: { mfaTicket: body.mfaTicket, code: hotp(secret, currentStep(Date.now())) } });
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({ result: "session", mustReenrollMfa: false });
    expect(browser.cookie("__Host-korbat_session")).toBeDefined();
  });

  test("the limits: 30 options and 20 verifications per IP per 15 minutes, and 5 new-device sign-ins an hour per account", { timeout: 90_000 }, async () => {
    const limited = async (res: Response, retryAfter: number) => {
      expect(res.status).toBe(429);
      expect((await error(res)).code).toBe("rate_limited");
      expect(res.headers.get("retry-after")).toBe(String(retryAfter));
    };

    // Options: 30 per IP per 15 minutes.
    const optionsClient = web();
    for (let i = 0; i < 30; i++) expect((await optionsClient.fetch("/api/auth/passkey/signin/options", { method: "POST" })).status).toBe(200);
    await limited(await optionsClient.fetch("/api/auth/passkey/signin/options", { method: "POST" }), 900);

    // Verify: 20 per IP per 15 minutes, counted before the challenge, so a bogus assertion still counts.
    const verifyClient = web();
    const orphan = new SoftAuthenticator();
    const reg = orphan.create({ rpId: config.WEBAUTHN_RP_ID, challenge: (await signinOptions(verifyClient)).challenge, origin: config.APP_ORIGIN, userHandle: randomBytes(32), flags: ALL });
    const bogus = orphan.get({ credentialId: reg.id, rpId: config.WEBAUTHN_RP_ID, challenge: "not-a-real-challenge", origin: config.APP_ORIGIN, flags: ALL, counter: 0 });
    for (let i = 0; i < 20; i++) expect((await signinVerify(verifyClient, bogus, "web")).status).toBe(401);
    await limited(await signinVerify(verifyClient, bogus, "web"), 900);

    // New device: 5 an hour per account. A fresh client each time is a new device; the sixth is refused.
    const { b } = await signUp();
    const { authenticator, credentialId } = await register(b);
    for (let i = 0; i < 5; i++) {
      const client = web();
      expect((await signinVerify(client, assertion(authenticator, await signinOptions(client), credentialId), "web")).status).toBe(200);
    }
    const sixth = web();
    await limited(await signinVerify(sixth, assertion(authenticator, await signinOptions(sixth), credentialId), "web"), 3600);
  });
});
