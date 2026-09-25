import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import Redis from "ioredis";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  FlowResponse,
  MeResponse,
  RecoveryCodesResponse,
  SessionResult,
  SessionsResponse,
  SignInResponse,
  TotpSetupResponse,
} from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth, redisKv, type Auth } from "../../src/auth";
import { randomToken } from "../../src/auth/crypto";
import { hashPassword } from "../../src/auth/passwords";
import { currentStep, hotp } from "../../src/auth/totp";
import { loadConfig, type Config } from "../../src/config";
import { smtpMailer } from "../../src/mail/smtp";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { Browser, NativeClient } from "./http-client";
import { codeFrom, inbox, type Inbox } from "./mailpit";

const PASSWORD = "correct horse battery staple";
const SUBJECT = {
  signUp: "Your korbat sign-up code",
  signIn: "Your korbat sign-in code",
  newDevice: "New sign-in to your korbat account",
  locked: "Password sign-in paused on your korbat account",
  emailChangeCode: "Confirm your new korbat email address",
  emailChanged: "Your korbat email address changed",
};

const newEmail = (prefix: string) => `${prefix}-${randomUUID()}@korbat.local`;
const newHandle = () => `e_${randomBytes(6).toString("hex")}`;

/** The raw secret from an otpauth:// URI (RFC 4648 base32). */
function secretFromUri(uri: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const encoded = new URL(uri).searchParams.get("secret") ?? "";
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of encoded.replace(/=+$/, "")) {
    buffer = (buffer << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
      buffer &= (1 << bits) - 1;
    }
  }
  return Uint8Array.from(bytes);
}

/**
 * The whole auth module over HTTP with the real Redis store, real SMTP into Mailpit and a clock the
 * tests can move forward (for lockout expiry, the re-auth window and new TOTP steps).
 */
describe.skipIf(!process.env.INTEGRATION)("integration: auth end to end (Postgres, Redis, Mailpit)", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let redis: Redis;
  let auth: Auth;
  let app: ReturnType<typeof createApp>;
  let offsetMs = 0;
  const now = () => new Date(Date.now() + offsetMs);
  const advance = (ms: number) => {
    offsetMs += ms;
  };

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
      turnstile: { verify: async (token) => token !== "fail" },
      breachChecker: { isBreached: async () => false },
      now,
    });
    app = createApp({ config, logger, rateLimitStore: new MemoryStore(), healthChecks: {}, auth });
  });
  afterAll(async () => {
    await Promise.allSettled([closeDb(authDb), closeDb(apiDb), redis.quit()]);
  });

  const web = () => new Browser(app, config.APP_ORIGIN);

  /** An onboarded account created directly in the database, optionally with PASSWORD set. */
  async function existingAccount(options: { password?: boolean } = {}) {
    const email = newEmail("e2e");
    const user = await auth.deps.repo.createUser({ email, termsVersion: config.TERMS_VERSION, now: now() });
    await auth.deps.repo.markOnboarded(user.id, now());
    if (options.password) await auth.deps.repo.setPasswordHash(user.id, await hashPassword(PASSWORD), now());
    return { email, userId: user.id };
  }

  const passwordSignIn = (b: Browser, email: string, password: string, deviceId: string) =>
    b.fetch("/api/auth/password/signin", { json: { email, password, turnstileToken: "ok", deviceId, platform: "web" } });

  async function signInByCode(b: Browser, email: string, box: Inbox, deviceId: string) {
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId, platform: "web" } });
    expect(start.status).toBe(200);
    const { flowId } = FlowResponse.parse(await start.json());
    return b.fetch("/api/auth/email/verify", { json: { flowId, code: codeFrom(await box.next(SUBJECT.signIn)) } });
  }

  async function signUpAndOnboard(b: Browser) {
    const email = newEmail("signup");
    const box = await inbox(email);
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(start.status).toBe(200);
    const { flowId } = FlowResponse.parse(await start.json());
    const code = codeFrom(await box.next(SUBJECT.signUp));
    expect(await (await b.fetch("/api/auth/email/verify", { json: { flowId, code } })).json()).toEqual({ result: "signup_required" });
    const complete = await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } });
    expect(await complete.json()).toEqual({ result: "session", mustReenrollMfa: false });
    const reused = await b.fetch("/api/auth/email/verify", { json: { flowId, code } });
    expect(reused.status).toBe(400);
    const handle = newHandle();
    const onboarded = await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: "End To End" } });
    expect(onboarded.status).toBe(200);
    return { email, handle, box };
  }

  test("sign-up through onboarding with codes read from Mailpit", async () => {
    const b = web();
    const { email, handle } = await signUpAndOnboard(b);
    const me = MeResponse.parse(await (await b.fetch("/api/me")).json());
    expect(me.user).toMatchObject({ email, role: "user", onboarded: true, mfaEnabled: false, hasPassword: false });
    expect(me.profile?.handle).toBe(handle);
  });

  test("sign-in by email code on a new device sends an alert whose link signs out everywhere and removes the password", async () => {
    const { email } = await existingAccount({ password: true });
    const box = await inbox(email);
    const phone = new NativeClient(app);
    const phoneSignIn = await phone.fetch("/api/auth/password/signin", {
      json: { email, password: PASSWORD, turnstileToken: "ok", deviceId: randomToken(), platform: "ios" },
    });
    phone.token = SessionResult.parse(await phoneSignIn.json()).token;

    const laptop = web();
    const signedIn = await signInByCode(laptop, email, box, randomToken());
    expect(await signedIn.json()).toEqual({ result: "session", mustReenrollMfa: false });
    const alert = await box.next(SUBJECT.newDevice);
    const token = /\/not-me\/([A-Za-z0-9_-]{43})/.exec(alert)?.[1];
    expect(token).toBeDefined();
    expect((await laptop.fetch("/api/me")).status).toBe(200);
    expect((await phone.fetch("/api/me")).status).toBe(200);

    const stranger = web();
    expect((await stranger.fetch("/api/auth/not-me", { json: { token } })).status).toBe(204);
    expect((await laptop.fetch("/api/me")).status).toBe(401);
    expect((await phone.fetch("/api/me")).status).toBe(401);
    const withPassword = await passwordSignIn(web(), email, PASSWORD, randomToken());
    expect(withPassword.status).toBe(401);
    expect(await withPassword.json()).toMatchObject({ error: { code: "invalid_credentials" } });
    expect((await stranger.fetch("/api/auth/not-me", { json: { token } })).status).toBe(400);
  });

  test("five wrong passwords pause password sign-in and send a notice; email codes still work; the pause lifts after 15 minutes", async () => {
    const { email } = await existingAccount({ password: true });
    const box = await inbox(email);
    const b = web();
    const deviceId = randomToken();
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await passwordSignIn(b, email, "not the right password", deviceId)).status).toBe(401);
    }
    expect(await box.next(SUBJECT.locked)).toContain("15 minutes");

    const whileLocked = await passwordSignIn(b, email, PASSWORD, deviceId);
    expect(whileLocked.status).toBe(401);
    expect(await whileLocked.json()).toMatchObject({ error: { code: "invalid_credentials" } });
    expect(await (await signInByCode(b, email, box, deviceId)).json()).toEqual({ result: "session", mustReenrollMfa: false });

    advance(15 * 60_000 + 1000);
    const afterPause = await passwordSignIn(web(), email, PASSWORD, deviceId);
    expect(afterPause.status).toBe(200);
    expect(await afterPause.json()).toEqual({ result: "session", mustReenrollMfa: false });
  });

  test("MFA: setup, sign-in challenge, replay rejected, recovery code, re-enrolment and disable", { timeout: 60_000 }, async () => {
    const b = web();
    const { email } = await signUpAndOnboard(b);
    expect((await b.fetch("/api/auth/password/set", { json: { password: PASSWORD } })).status).toBe(200);

    const totpNow = (secret: Uint8Array) => hotp(secret, currentStep(now().getTime()));
    const enrol = async () => {
      const setup = TotpSetupResponse.parse(await (await b.fetch("/api/auth/mfa/totp/setup", { method: "POST" })).json());
      const secret = secretFromUri(setup.otpauthUri);
      const code = totpNow(secret);
      const confirm = await b.fetch("/api/auth/mfa/totp/confirm", { json: { code } });
      expect(confirm.status).toBe(200);
      return { secret, code, recoveryCodes: RecoveryCodesResponse.parse(await confirm.json()).recoveryCodes };
    };
    const signOut = async () => expect((await b.fetch("/api/auth/signout", { method: "POST" })).status).toBe(204);
    const deviceId = randomToken();
    const challenge = async () => {
      const body = SignInResponse.parse(await (await passwordSignIn(b, email, PASSWORD, deviceId)).json());
      if (body.result !== "mfa_required") throw new Error(`expected an MFA challenge, got ${body.result}`);
      return body.mfaTicket;
    };
    const verify = (mfaTicket: string, second: { code: string } | { recoveryCode: string }) => b.fetch("/api/auth/mfa/verify", { json: { mfaTicket, ...second } });

    const first = await enrol();
    await signOut();

    let ticket = await challenge();
    const replay = await verify(ticket, { code: first.code });
    expect(replay.status).toBe(401);
    expect(await replay.json()).toMatchObject({ error: { code: "invalid_mfa_code" } });
    advance(30_000);
    expect(await (await verify(ticket, { code: totpNow(first.secret) })).json()).toEqual({ result: "session", mustReenrollMfa: false });
    expect(MeResponse.parse(await (await b.fetch("/api/me")).json()).user.mfaEnabled).toBe(true);
    await signOut();

    ticket = await challenge();
    expect(await (await verify(ticket, { recoveryCode: first.recoveryCodes[0]! })).json()).toEqual({ result: "session", mustReenrollMfa: true });
    await signOut();
    ticket = await challenge();
    expect((await verify(ticket, { recoveryCode: first.recoveryCodes[0]! })).status).toBe(401);
    advance(30_000);
    expect((await verify(ticket, { code: totpNow(first.secret) })).status).toBe(200);

    const second = await enrol();
    expect(second.recoveryCodes).not.toEqual(first.recoveryCodes);
    advance(30_000);
    expect((await b.fetch("/api/auth/mfa/totp/disable", { json: { code: totpNow(second.secret) } })).status).toBe(204);
    expect(MeResponse.parse(await (await b.fetch("/api/me")).json()).user.mfaEnabled).toBe(false);
  });

  test("session list, revoking one session, and revoke-all behind re-authentication", async () => {
    const { email } = await existingAccount({ password: true });
    const laptop = web();
    expect((await passwordSignIn(laptop, email, PASSWORD, randomToken())).status).toBe(200);
    const phone = new NativeClient(app);
    const phoneDevice = randomToken();
    const phoneSignIn = async () => {
      const res = await phone.fetch("/api/auth/password/signin", { json: { email, password: PASSWORD, turnstileToken: "ok", deviceId: phoneDevice, platform: "ios" } });
      phone.token = SessionResult.parse(await res.json()).token;
    };
    await phoneSignIn();

    const { sessions } = SessionsResponse.parse(await (await laptop.fetch("/api/auth/sessions")).json());
    expect(sessions).toHaveLength(2);
    const other = sessions.find((s) => !s.current)!;
    expect(other.platform).toBe("ios");
    expect((await laptop.fetch(`/api/auth/sessions/${other.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await phone.fetch("/api/me")).status).toBe(401);
    expect((await laptop.fetch(`/api/auth/sessions/${other.id}`, { method: "DELETE" })).status).toBe(404);

    await phoneSignIn();
    advance(6 * 60_000);
    const stale = await laptop.fetch("/api/auth/sessions/revoke-all", { method: "POST" });
    expect(stale.status).toBe(403);
    expect(await stale.json()).toMatchObject({ error: { code: "reauth_required" } });
    expect((await laptop.fetch("/api/auth/reauth", { json: { method: "password", password: PASSWORD } })).status).toBe(204);
    expect((await laptop.fetch("/api/auth/sessions/revoke-all", { method: "POST" })).status).toBe(204);
    expect((await laptop.fetch("/api/me")).status).toBe(401);
    expect((await phone.fetch("/api/me")).status).toBe(401);
  });

  test("moving the account to a new address: the code goes to the new mailbox, the old address is told, and only the new address signs in", { timeout: 60_000 }, async () => {
    const b = web();
    const { email: oldAddress, box: oldBox } = await signUpAndOnboard(b);
    expect((await b.fetch("/api/auth/password/set", { json: { password: PASSWORD } })).status).toBe(200);

    // An address that already has an account gets its code like any other; the refusal waits for the code to prove the mailbox.
    const taken = await existingAccount();
    const takenBox = await inbox(taken.email);
    const conflict = await b.fetch("/api/auth/email/change/start", { json: { email: taken.email } });
    expect(conflict.status).toBe(200);
    const conflictFlow = FlowResponse.parse(await conflict.json());
    const conflictCode = codeFrom(await takenBox.next(SUBJECT.emailChangeCode));
    const refused = await b.fetch("/api/auth/email/change/verify", { json: { flowId: conflictFlow.flowId, code: conflictCode } });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { code: "email_in_use" } });

    const newAddress = newEmail("moved");
    const newBox = await inbox(newAddress);
    const started = await b.fetch("/api/auth/email/change/start", { json: { email: newAddress } });
    expect(started.status).toBe(200);
    const { flowId } = FlowResponse.parse(await started.json());
    const code = codeFrom(await newBox.next(SUBJECT.emailChangeCode));
    const verified = await b.fetch("/api/auth/email/change/verify", { json: { flowId, code } });
    expect(verified.status).toBe(200);
    expect(await verified.json()).toEqual({ email: newAddress });
    expect(await oldBox.next(SUBJECT.emailChanged)).toContain(newAddress);

    // The session that made the change stays signed in and sees the new address.
    const me = MeResponse.parse(await (await b.fetch("/api/me")).json());
    expect(me.user.email).toBe(newAddress);
    expect((await auth.deps.repo.recentEvents(me.user.id)).map((e) => e.type)).toContain("email_changed");

    const oldSignIn = await passwordSignIn(web(), oldAddress, PASSWORD, randomToken());
    expect(oldSignIn.status).toBe(401);
    expect(await oldSignIn.json()).toMatchObject({ error: { code: "invalid_credentials" } });
    const newSignIn = await passwordSignIn(web(), newAddress, PASSWORD, randomToken());
    expect(newSignIn.status).toBe(200);
    expect(await newSignIn.json()).toEqual({ result: "session", mustReenrollMfa: false });
  });

  test("an under-16 sign-up is refused and leaves no account behind", async () => {
    const b = web();
    const email = newEmail("young");
    const box = await inbox(email);
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    const { flowId } = FlowResponse.parse(await start.json());
    const code = codeFrom(await box.next(SUBJECT.signUp));
    expect(await (await b.fetch("/api/auth/email/verify", { json: { flowId, code } })).json()).toEqual({ result: "signup_required" });

    const dateOfBirth = `${now().getUTCFullYear() - 15}-01-01`;
    const refused = await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth, termsVersion: config.TERMS_VERSION } });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "age_requirement" } });
    expect(await auth.deps.repo.findUserByEmail(email)).toBeFalsy();

    const retry = await web().fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(retry.status).toBe(403);
    expect(await retry.json()).toMatchObject({ error: { code: "age_requirement" } });
  });

  test("the API database role cannot read auth events", async () => {
    const failure = await apiDb.execute(sql`select id from auth.auth_events limit 1`).then(
      () => null,
      (err: unknown) => err,
    );
    expect(String((failure as { cause?: unknown } | null)?.cause)).toMatch(/permission denied/);
  });
});
