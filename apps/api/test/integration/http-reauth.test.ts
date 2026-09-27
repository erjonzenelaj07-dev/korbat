import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ErrorEnvelope, FlowResponse, MeResponse, ReauthResponse, RecoveryCodesResponse, SessionResult, TotpSetupResponse } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createAccount } from "../../src/account";
import { createApp } from "../../src/app";
import { createAuth, type Auth } from "../../src/auth";
import { encrypt, randomToken, sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { hashRecoveryCode, newRecoveryCodes } from "../../src/auth/recovery-codes";
import { currentStep, hotp, newTotpSecret } from "../../src/auth/totp";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { createMedia } from "../../src/media";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { createSocial, enforceWriteLimit } from "../../src/social";
import { Browser, NativeClient } from "./http-client";

type App = ReturnType<typeof createApp>;

const PASSWORD = "correct horse battery staple";
const newHandle = () => `r${randomBytes(4).toString("hex")}`;
const newEmail = (prefix: string) => `${prefix}-${randomUUID()}@korbat.local`;

/**
 * The level-2 routes of the 1c design (section 10) and the re-authentication answer over HTTP: the four
 * modules wired as the server wires them, cookie and bearer sessions, and TOTP put on accounts directly.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: strong freshness and re-authentication over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let auth: Auth;
  let app: App;
  const root = mkdtempSync(path.join(tmpdir(), "korbat-http-reauth-"));
  const mailer = new MemoryMailer();

  beforeAll(async () => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    const rateLimitStore = new MemoryStore();
    auth = createAuth({
      config,
      logger,
      authDb,
      kv: new MemoryKv(),
      mailer,
      profiles: createProfileStore(apiDb),
      turnstile: { verify: async () => true },
      breachChecker: { isBreached: async () => false },
    });
    const media = createMedia({
      apiDb,
      uploadsDir: path.join(root, "uploads"),
      storeDir: path.join(root, "store"),
      formats: config.MEDIA_FORMATS,
      minFreeBytes: 0,
      logger,
      requireSession: auth.requireSession,
      resolveSession: auth.resolveSession,
      rateLimitStore,
      enforceUploadLimit: (userId, accountCreatedAt, at) => enforceWriteLimit(rateLimitStore, userId, "upload", accountCreatedAt, at),
    });
    await media.prepare();
    const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth(), media: media.forPosts, events: { append: auth.appendEvent } });
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
    app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, social, media, account });
  });
  afterAll(async () => {
    rmSync(root, { recursive: true, force: true });
    await Promise.all([closeDb(authDb), closeDb(apiDb)]);
  });

  /** A signed-in, onboarded web account: its session proved the sign-up's email code and nothing else. */
  async function signUp() {
    const b = new Browser(app, config.APP_ORIGIN);
    const email = newEmail("reauth");
    const handle = newHandle();
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(start.status).toBe(200);
    const { flowId } = FlowResponse.parse(await start.json());
    expect((await b.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } })).status).toBe(200);
    expect((await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).status).toBe(200);
    expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: `User ${handle}` } })).status).toBe(200);
    const me = MeResponse.parse(await (await b.fetch("/api/me")).json());
    return { b, email, handle, userId: me.user.id };
  }

  /** TOTP on, as the confirm step leaves it, with recovery codes; the session cache is dropped so mfaEnabled shows. */
  async function withTotp(userId: string) {
    const secret = newTotpSecret();
    const codes = newRecoveryCodes();
    await auth.deps.repo.enableTotp(userId, {
      secretEnc: encrypt(Buffer.from(secret), auth.deps.config.totpKey),
      recoveryCodesHash: codes.map((code) => hashRecoveryCode(auth.deps.config.authHmacKey, code)),
      now: new Date(),
    });
    await auth.deps.sessions.forgetUser(userId);
    return { secret, codes };
  }
  const totpNow = (secret: Uint8Array) => hotp(secret, currentStep(Date.now()));
  const sessionIdOf = (b: Browser) => sha256Hex(b.cookie("__Host-korbat_session")!);
  /** The session's only factor is the sign-up's email code; moved ten minutes back, nothing within the window is left. */
  async function makeStale(b: Browser) {
    await auth.deps.repo.writeFactor(sessionIdOf(b), "email", new Date(Date.now() - 10 * 60_000));
    await auth.deps.kv.del(`sess:2:${sessionIdOf(b)}`);
  }
  const error = async (res: Response) => ErrorEnvelope.parse(await res.json()).error;
  const post = (b: Browser, route: string, body: unknown) => (body === undefined ? b.fetch(route, { method: "POST" }) : b.fetch(route, { json: body }));

  /** Every level-2 route of section 10 that exists before the passkey routes, with a body that passes validation. */
  const strongRoutes = (handle: string): [string, unknown][] => [
    ["/api/auth/mfa/totp/setup", undefined],
    ["/api/auth/mfa/recovery-codes/regenerate", undefined],
    ["/api/auth/password/set", { password: PASSWORD }],
    ["/api/auth/email/change/start", { email: newEmail("moved") }],
    ["/api/account/delete/start", undefined],
    ["/api/account/delete/confirm", { flowId: randomToken(), code: "123456", handle }],
    ["/api/auth/mfa/totp/disable", {}],
  ];

  test("on an account with TOTP, a session that proved only its email code is refused level 2 by every strong route, keeps its level-1 routes, and passes after a TOTP re-authentication", { timeout: 60_000 }, async () => {
    const { b, handle } = await signUp();
    const { secret } = await withTotp((MeResponse.parse(await (await b.fetch("/api/me")).json())).user.id);
    expect(MeResponse.parse(await (await b.fetch("/api/me")).json()).user.mfaEnabled).toBe(true);
    for (const [route, body] of strongRoutes(handle)) {
      const refused = await post(b, route, body);
      expect(refused.status, route).toBe(403);
      expect(await error(refused), route).toMatchObject({ code: "reauth_required", details: { level: 2, have: ["email"] } });
    }
    // Level 1 stays what it was: past the guard, these answer for their own reasons.
    const verify = await b.fetch("/api/auth/email/change/verify", { json: { flowId: randomToken(), code: "123456" } });
    expect(verify.status).toBe(400);
    expect((await error(verify)).code).toBe("invalid_code");
    expect((await b.fetch(`/api/auth/sessions/${randomUUID()}`, { method: "DELETE" })).status).toBe(404);
    expect((await b.fetch("/api/account/export", { method: "POST" })).status).toBe(200);

    const before = b.cookie("__Host-korbat_session")!;
    const reauth = await b.fetch("/api/auth/reauth", { json: { method: "totp", code: totpNow(secret) } });
    expect(reauth.status).toBe(200);
    // The level reached; the token rotated into the cookies, never into a browser's body.
    expect(ReauthResponse.parse(await reauth.json())).toEqual({ level: 2 });
    expect(b.cookie("__Host-korbat_session")).not.toBe(before);
    expect((await app.request("/api/me", { headers: { cookie: `__Host-korbat_session=${before}` } })).status).toBe(401);
    expect((await b.fetch("/api/me")).status).toBe(200);

    const setup = await post(b, "/api/auth/mfa/totp/setup", undefined);
    expect(setup.status).toBe(200);
    TotpSetupResponse.parse(await setup.json());
    const regenerated = await post(b, "/api/auth/mfa/recovery-codes/regenerate", undefined);
    expect(regenerated.status).toBe(200);
    expect(RecoveryCodesResponse.parse(await regenerated.json()).recoveryCodes).toHaveLength(10);
    const set = await post(b, "/api/auth/password/set", { password: PASSWORD });
    expect(set.status).toBe(200);
    expect(await set.json()).toEqual({});
    const change = await post(b, "/api/auth/email/change/start", { email: newEmail("moved") });
    expect(change.status).toBe(200);
    FlowResponse.parse(await change.json());
    const deletion = await post(b, "/api/account/delete/start", undefined);
    expect(deletion.status).toBe(200);
    FlowResponse.parse(await deletion.json());
    const confirm = await post(b, "/api/account/delete/confirm", { flowId: randomToken(), code: "123456", handle });
    expect(confirm.status).toBe(400);
    expect((await error(confirm)).code).toBe("invalid_code");
    // Last, since it changes what the account needs: no code in the body, the re-authentication spent it.
    expect((await post(b, "/api/auth/mfa/totp/disable", {})).status).toBe(204);
    expect(MeResponse.parse(await (await b.fetch("/api/me")).json()).user.mfaEnabled).toBe(false);
  });

  test("an account without TOTP passes every strong route with its email code alone, and its re-authentication answers level 1", { timeout: 60_000 }, async () => {
    const { b, email, handle } = await signUp();
    const expected: Record<string, number> = {
      "/api/auth/mfa/totp/setup": 200,
      "/api/auth/mfa/recovery-codes/regenerate": 400,
      "/api/auth/password/set": 200,
      "/api/auth/email/change/start": 200,
      "/api/account/delete/start": 200,
      "/api/account/delete/confirm": 400,
      "/api/auth/mfa/totp/disable": 400,
    };
    for (const [route, body] of strongRoutes(handle)) {
      const res = await post(b, route, body);
      expect(res.status, route).toBe(expected[route]);
      if (res.status === 400) expect((await error(res)).code, route).toMatch(/^(mfa_required|invalid_code)$/);
    }
    await makeStale(b);
    const refused = await post(b, "/api/auth/password/set", { password: PASSWORD });
    expect(refused.status).toBe(403);
    expect(await error(refused)).toMatchObject({ code: "reauth_required", details: { level: 1, have: [] } });
    const { flowId } = FlowResponse.parse(await (await b.fetch("/api/auth/reauth/email/start", { method: "POST" })).json());
    const reauth = await b.fetch("/api/auth/reauth", { json: { method: "email", flowId, code: mailer.lastCodeFor(email) } });
    expect(reauth.status).toBe(200);
    expect(ReauthResponse.parse(await reauth.json())).toEqual({ level: 1 });
    expect((await post(b, "/api/auth/password/set", { password: PASSWORD })).status).toBe(200);
  });

  test("a native session gets the rotated token in the answer's body, and the old one stops working at once", async () => {
    const native = new NativeClient(app);
    const email = newEmail("native");
    const { flowId } = FlowResponse.parse(await (await native.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "ios" } })).json());
    await native.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } });
    native.token = SessionResult.parse(await (await native.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).json()).token;
    native.token = ((await (await native.fetch("/api/auth/onboarding/handle", { json: { handle: newHandle(), displayName: "Phone User" } })).json()) as { token: string }).token;
    const before = native.token!;
    const start = FlowResponse.parse(await (await native.fetch("/api/auth/reauth/email/start", { method: "POST" })).json());
    const reauth = await native.fetch("/api/auth/reauth", { json: { method: "email", flowId: start.flowId, code: mailer.lastCodeFor(email) } });
    expect(reauth.status).toBe(200);
    expect(reauth.headers.getSetCookie()).toHaveLength(0);
    const body = ReauthResponse.parse(await reauth.json());
    expect(body).toEqual({ level: 1, token: expect.stringMatching(/^kb1_[A-Za-z0-9_-]{43}$/) });
    expect(body.token).not.toBe(before);
    expect((await native.fetch("/api/me")).status).toBe(401);
    native.token = body.token;
    expect((await native.fetch("/api/me")).status).toBe(200);
  });

  test("a recovery code re-authenticates over HTTP: level 2 after a password, the code normalised, the answer asking for re-enrolment", { timeout: 60_000 }, async () => {
    const { b, userId } = await signUp();
    expect((await post(b, "/api/auth/password/set", { password: PASSWORD })).status).toBe(200);
    const { codes } = await withTotp(userId);
    await makeStale(b);
    const wrong = await b.fetch("/api/auth/reauth", { json: { method: "recovery", recoveryCode: "abcd-ef23-gh45" } });
    expect(wrong.status).toBe(401);
    expect((await error(wrong)).code).toBe("invalid_mfa_code");
    const byPassword = await b.fetch("/api/auth/reauth", { json: { method: "password", password: PASSWORD } });
    expect(ReauthResponse.parse(await byPassword.json())).toEqual({ level: 1 });
    const byCode = await b.fetch("/api/auth/reauth", { json: { method: "recovery", recoveryCode: ` ${codes[0]!.toUpperCase()} ` } });
    expect(byCode.status).toBe(200);
    expect(ReauthResponse.parse(await byCode.json())).toEqual({ level: 2, mustReenrollMfa: true });
    expect(mailer.sent.filter((m) => m.template === "recovery_code_used").map((m) => m.to)).toEqual([(await auth.deps.repo.findUserById(userId))!.email]);
    // Without TOTP there is no recovery code to check.
    const plain = await signUp();
    const refused = await plain.b.fetch("/api/auth/reauth", { json: { method: "recovery", recoveryCode: codes[1] } });
    expect(refused.status).toBe(400);
    expect((await error(refused)).code).toBe("mfa_required");
  });

  test("TOTP confirm needs no freshness: a session gone stale since the setup still confirms with the pending secret, and the code it proved counts as a factor", { timeout: 60_000 }, async () => {
    const { b } = await signUp();
    const setup = TotpSetupResponse.parse(await (await post(b, "/api/auth/mfa/totp/setup", undefined)).json());
    const encoded = new URL(setup.otpauthUri).searchParams.get("secret")!;
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
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
    const secret = Uint8Array.from(bytes);
    await makeStale(b);
    expect((await post(b, "/api/auth/password/set", { password: PASSWORD })).status).toBe(403);
    const before = b.cookie("__Host-korbat_session")!;
    const confirm = await post(b, "/api/auth/mfa/totp/confirm", { code: totpNow(secret) });
    expect(confirm.status).toBe(200);
    expect(RecoveryCodesResponse.parse(await confirm.json()).recoveryCodes).toHaveLength(10);
    expect(b.cookie("__Host-korbat_session")).not.toBe(before);
    expect(MeResponse.parse(await (await b.fetch("/api/me")).json()).user.mfaEnabled).toBe(true);
    // The code proved the new secret, so the session holds `totp` alone: level 1, and a strong route says what is missing.
    const again = await post(b, "/api/auth/mfa/totp/setup", undefined);
    expect(again.status).toBe(403);
    expect(await error(again)).toMatchObject({ code: "reauth_required", details: { level: 2, have: ["totp"] } });
  });
});
