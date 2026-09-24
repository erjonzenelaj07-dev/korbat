import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, createDb, type Db } from "@korbat/db";
import { grantRole } from "../../src/auth/admin";
import { encrypt, randomToken } from "../../src/auth/crypto";
import { listSessions, me, revokeAllSessions, revokeSession, signOut } from "../../src/auth/flows/account";
import { startEmail } from "../../src/auth/flows/email";
import { notMe } from "../../src/auth/flows/not-me";
import { reauthenticate, startReauthEmail } from "../../src/auth/flows/reauth";
import { notMeKey } from "../../src/auth/flows/signin";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { REAUTH_WINDOW_MS } from "../../src/auth/sessions";
import { newTotpSecret } from "../../src/auth/totp";
import { loadConfig } from "../../src/config";
import { currentTotpCode, flowHarness, newTestDevice, onboardedUser, wrongCode } from "./flow-harness";

const PASSWORD = "correct horse battery staple";

describe.skipIf(!process.env.INTEGRATION)("integration: re-authentication, account and session flows", () => {
  let db: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_AUTH, { max: 4 });
    repo = createAuthRepo(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });

  test("re-authenticating with the password or a TOTP code renews the five-minute window; wrong credentials do not", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    await repo.enableTotp(account.user.id, { secretEnc: encrypt(Buffer.from(newTotpSecret()), h.deps.config.totpKey), recoveryCodesHash: [], now: new Date() });

    const staleSession = async () => {
      h.clock.advance(REAUTH_WINDOW_MS + 1_000);
      const session = (await h.deps.sessions.resolve(account.token))!.session;
      expect(h.deps.sessions.isFresh(session)).toBe(false);
      return session;
    };
    const isFreshNow = async () => h.deps.sessions.isFresh((await h.deps.sessions.resolve(account.token))!.session);

    let session = await staleSession();
    await expect(reauthenticate(h.deps, session, { method: "password", password: "wrong password entirely" })).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(await isFreshNow()).toBe(false);
    await reauthenticate(h.deps, session, { method: "password", password: PASSWORD });
    expect(await isFreshNow()).toBe(true);

    session = await staleSession();
    const code = await currentTotpCode(h, repo, account.user.id);
    await expect(reauthenticate(h.deps, session, { method: "totp", code: wrongCode(code) })).rejects.toMatchObject({ code: "invalid_mfa_code" });
    await reauthenticate(h.deps, session, { method: "totp", code });
    expect(await isFreshNow()).toBe(true);
  });

  test("re-authenticating by email accepts only a re-auth code for this account, once", async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const other = await onboardedUser(h, repo);
    h.clock.advance(REAUTH_WINDOW_MS + 1_000);
    const session = (await h.deps.sessions.resolve(account.token))!.session;

    const { flowId } = await startReauthEmail(h.deps, session, h.ctx);
    const reauthMail = h.mailer.sent.at(-1)!;
    expect(reauthMail).toMatchObject({ to: account.email, template: "reauth_code" });
    const reauthCode = reauthMail.data.code!;

    const otherSession = (await h.deps.sessions.resolve(other.token))!.session;
    const otherFlow = await startReauthEmail(h.deps, otherSession, h.ctx);
    await expect(reauthenticate(h.deps, session, { method: "email", flowId: otherFlow.flowId, code: h.mailer.lastCodeFor(other.email)! })).rejects.toMatchObject({
      code: "invalid_code",
    });

    const signInFlow = await startEmail(h.deps, { email: account.email, turnstileToken: "ok", ...newTestDevice() }, h.ctx);
    await expect(reauthenticate(h.deps, session, { method: "email", flowId: signInFlow.flowId, code: h.mailer.lastCodeFor(account.email)! })).rejects.toMatchObject({
      code: "invalid_code",
    });

    await reauthenticate(h.deps, session, { method: "email", flowId, code: reauthCode });
    expect(h.deps.sessions.isFresh((await h.deps.sessions.resolve(account.token))!.session)).toBe(true);
    await expect(reauthenticate(h.deps, session, { method: "email", flowId, code: reauthCode })).rejects.toMatchObject({ code: "invalid_code" });
  });

  test("re-authentication allows five attempts per session every 15 minutes", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    for (let i = 0; i < 5; i++) {
      await expect(reauthenticate(h.deps, account.session, { method: "password", password: "wrong password entirely" })).rejects.toMatchObject({ code: "invalid_credentials" });
    }
    await expect(reauthenticate(h.deps, account.session, { method: "password", password: PASSWORD })).rejects.toMatchObject({ code: "rate_limited" });
  });

  test("me describes the signed-in account and its profile", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    await h.deps.profiles.create({ id: account.user.id, handle: "me_test", displayName: "Me Test" });
    expect(await me(h.deps, account.session)).toEqual({
      user: { id: account.user.id, email: account.email, role: "user", onboarded: true, mfaEnabled: false, hasPassword: true },
      profile: { id: account.user.id, handle: "me_test", displayName: "Me Test" },
    });
  });

  test("sessions can be listed, revoked one at a time, signed out, and revoked all at once", async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const second = await h.deps.sessions.issue(account.user.id, account.session.deviceId);
    const third = await h.deps.sessions.issue(account.user.id, account.session.deviceId);

    const { sessions } = await listSessions(h.deps, account.session);
    expect(sessions).toHaveLength(3);
    expect(sessions.filter((s) => s.current).map((s) => s.id)).toEqual([account.session.sessionId]);

    expect(await revokeSession(h.deps, account.session, second.session.sessionId)).toBe(true);
    expect(await revokeSession(h.deps, account.session, "0".repeat(64))).toBe(false);
    expect(await h.deps.sessions.resolve(second.token)).toBeNull();

    await signOut(h.deps, third.session);
    expect(await h.deps.sessions.resolve(third.token)).toBeNull();

    const fourth = await h.deps.sessions.issue(account.user.id, account.session.deviceId);
    expect(await revokeAllSessions(h.deps, account.session)).toBe(2);
    expect(h.mailer.sent.filter((m) => m.template === "sessions_revoked_all").map((m) => m.data.count)).toEqual(["2"]);
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(await h.deps.sessions.resolve(fourth.token)).toBeNull();
    expect((await repo.recentEvents(account.user.id)).map((e) => e.type)).toEqual(expect.arrayContaining(["session_revoked", "sessions_revoked_all"]));
  });

  test("'This wasn't me' signs out every session, removes the password, and works once", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const token = randomToken();
    await h.kv.set(notMeKey(token), JSON.stringify({ userId: account.user.id, deviceId: account.session.deviceId }), 60_000);

    await notMe(h.deps, { token }, h.ctx);
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect((await repo.findUserById(account.user.id))!.passwordHash).toBeNull();
    expect((await repo.recentEvents(account.user.id)).map((e) => e.type)).toContain("not_me");
    await expect(notMe(h.deps, { token }, h.ctx)).rejects.toMatchObject({ code: "invalid_code" });
  });

  test("granting a role signs the account out everywhere so the new role applies at once", async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    expect(await grantRole(h.deps, account.email.toUpperCase(), "moderator")).toEqual({ userId: account.user.id, previousRole: "user" });
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    const again = await h.deps.sessions.issue(account.user.id, account.session.deviceId);
    expect(again.session).toMatchObject({ role: "moderator", mfaEnabled: false });
    await expect(grantRole(h.deps, "nobody-at-all@korbat.local", "admin")).rejects.toThrow(/no account/);
  });
});
