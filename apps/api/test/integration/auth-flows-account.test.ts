import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { authEvents, closeDb, createDb, type Db } from "@korbat/db";
import { grantRole } from "../../src/auth/admin";
import { encrypt, randomToken } from "../../src/auth/crypto";
import { listSessions, me, revokeAllSessions, revokeSession, signOut } from "../../src/auth/flows/account";
import { startEmail } from "../../src/auth/flows/email";
import { notMe } from "../../src/auth/flows/not-me";
import { reauthenticate, startReauthEmail } from "../../src/auth/flows/reauth";
import { notMeKey, type NotMeToken } from "../../src/auth/flows/signin";
import { emailHash } from "../../src/auth/identifiers";
import { HOUR, MINUTE } from "../../src/auth/limits";
import { hashRecoveryCode, newRecoveryCodes } from "../../src/auth/recovery-codes";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { REAUTH_WINDOW_MS, type Session } from "../../src/auth/sessions";
import { newTotpSecret } from "../../src/auth/totp";
import { loadConfig } from "../../src/config";
import { currentTotpCode, flowHarness, newTestDevice, newTestEmail, onboardedUser, wrongCode, type FlowHarness } from "./flow-harness";

const PASSWORD = "correct horse battery staple";
const LINK_GONE = "This link has expired or was already used.";

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

  /** Turns TOTP on for an account as the confirm step leaves it, with recovery codes, and answers the codes in the clear. */
  async function enableTotp(h: FlowHarness, userId: string): Promise<string[]> {
    const codes = newRecoveryCodes();
    await repo.enableTotp(userId, {
      secretEnc: encrypt(Buffer.from(newTotpSecret()), h.deps.config.totpKey),
      recoveryCodesHash: codes.map((code) => hashRecoveryCode(h.deps.config.authHmacKey, code)),
      now: h.clock.now(),
    });
    await h.deps.sessions.forgetUser(userId);
    return codes;
  }

  /** The account's events oldest first, with the metadata the flows wrote. */
  const eventsOf = (userId: string) =>
    db
      .select({ type: authEvents.type, deviceId: authEvents.deviceId, ipHash: authEvents.ipHash, metadata: authEvents.metadata })
      .from(authEvents)
      .where(eq(authEvents.userId, userId))
      .orderBy(authEvents.id);

  test("re-authenticating with the password or a TOTP code writes the factor, rotates the token and answers the level reached; wrong credentials do not", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    await enableTotp(h, account.user.id);
    let token = account.token;
    const current = async () => (await h.deps.sessions.resolve(token))!.session;
    const stale = async () => {
      h.clock.advance(REAUTH_WINDOW_MS + 1_000);
      const session = await current();
      expect(h.deps.sessions.isFresh(session)).toBe(false);
      return session;
    };

    let session = await stale();
    await expect(reauthenticate(h.deps, session, { method: "password", password: "wrong password entirely" }, h.ctx)).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(h.deps.sessions.isFresh(await current())).toBe(false);
    const byPassword = await reauthenticate(h.deps, session, { method: "password", password: PASSWORD }, h.ctx);
    expect(byPassword).toMatchObject({ level: 1, mustReenrollMfa: false });
    // The factor is written with the flows' clock, the reauth time follows it, and the token rotates in place: same handle, same device.
    expect(byPassword.issued.session).toMatchObject({ handle: session.handle, deviceId: session.deviceId, factors: { ...session.factors, password: h.clock.ms() }, reauthAt: h.clock.now() });
    expect(await h.deps.sessions.resolve(token)).toBeNull();
    token = byPassword.issued.token;
    expect(h.deps.sessions.isFresh(await current())).toBe(true);

    session = await current();
    const code = await currentTotpCode(h, repo, account.user.id);
    await expect(reauthenticate(h.deps, session, { method: "totp", code: wrongCode(code) }, h.ctx)).rejects.toMatchObject({ code: "invalid_mfa_code" });
    const byTotp = await reauthenticate(h.deps, session, { method: "totp", code }, h.ctx);
    // With the password still in the window, the code makes level 2.
    expect(byTotp).toMatchObject({ level: 2, mustReenrollMfa: false });
    expect(byTotp.issued.session.factors).toEqual({ ...session.factors, totp: h.clock.ms() });
    expect(await h.deps.sessions.resolve(token)).toBeNull();
    token = byTotp.issued.token;

    // Five minutes later a code alone is level 1 again: the first factor must be as recent as the second.
    session = await stale();
    const alone = await reauthenticate(h.deps, session, { method: "totp", code: await currentTotpCode(h, repo, account.user.id) }, h.ctx);
    expect(alone.level).toBe(1);
    expect(h.deps.sessions.level((await h.deps.sessions.resolve(alone.issued.token))!.session)).toBe(1);
  });

  test("re-authenticating by email accepts only a re-auth code for this account, once, and sends three codes an hour per session", async () => {
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
    await expect(reauthenticate(h.deps, session, { method: "email", flowId: otherFlow.flowId, code: h.mailer.lastCodeFor(other.email)! }, h.ctx)).rejects.toMatchObject({
      code: "invalid_code",
    });

    const signInFlow = await startEmail(h.deps, { email: account.email, turnstileToken: "ok", ...newTestDevice() }, h.ctx);
    await expect(reauthenticate(h.deps, session, { method: "email", flowId: signInFlow.flowId, code: h.mailer.lastCodeFor(account.email)! }, h.ctx)).rejects.toMatchObject({
      code: "invalid_code",
    });

    const byEmail = await reauthenticate(h.deps, session, { method: "email", flowId, code: reauthCode }, h.ctx);
    expect(byEmail).toMatchObject({ level: 1, mustReenrollMfa: false });
    expect(byEmail.issued.session).toMatchObject({ handle: session.handle, factors: { email: h.clock.ms() } });
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(h.deps.sessions.isFresh((await h.deps.sessions.resolve(byEmail.issued.token))!.session)).toBe(true);
    await expect(reauthenticate(h.deps, byEmail.issued.session, { method: "email", flowId, code: reauthCode }, h.ctx)).rejects.toMatchObject({ code: "invalid_code" });

    // Three codes an hour, counted by the session's handle, which the rotation kept; another session of the account has three of its own.
    for (let i = 0; i < 2; i++) await startReauthEmail(h.deps, byEmail.issued.session, h.ctx);
    await expect(startReauthEmail(h.deps, byEmail.issued.session, h.ctx)).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: HOUR / 1000 });
    const second = await h.deps.sessions.issue(account.user.id, session.deviceId, { factors: { email: h.clock.ms() } });
    expect((await startReauthEmail(h.deps, second.session, h.ctx)).flowId).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test("re-authentication allows five tries per session every 15 minutes, counted by the handle so two sessions of one account share nothing and a rotation resets nothing", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const wrong = (session: Session) => reauthenticate(h.deps, session, { method: "email", flowId: randomToken(), code: "000000" }, h.ctx);
    for (let i = 0; i < 5; i++) await expect(wrong(account.session)).rejects.toMatchObject({ code: "invalid_code" });
    await expect(reauthenticate(h.deps, account.session, { method: "password", password: PASSWORD }, h.ctx)).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: (15 * MINUTE) / 1000 });

    const second = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    const ok = await reauthenticate(h.deps, second.session, { method: "password", password: PASSWORD }, h.ctx);
    expect(ok.level).toBe(1);
    // The success counted as one of the five, and the rotated session carries the count on: four more tries, then the limit.
    for (let i = 0; i < 4; i++) await expect(wrong(ok.issued.session)).rejects.toMatchObject({ code: "invalid_code" });
    await expect(wrong(ok.issued.session)).rejects.toMatchObject({ code: "rate_limited" });
  });

  test("re-authentication allows thirty tries per address every 15 minutes, whichever sessions try", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const ctx = { ...h.ctx, ipHash: randomToken() };
    const newSession = async () => (await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } })).session;
    const wrong = (session: Session) => reauthenticate(h.deps, session, { method: "email", flowId: randomToken(), code: "000000" }, ctx);
    // Six sessions, five tries each: none reaches its own limit, together they reach the address's.
    for (let s = 0; s < 6; s++) {
      const session = await newSession();
      for (let i = 0; i < 5; i++) await expect(wrong(session)).rejects.toMatchObject({ code: "invalid_code" });
    }
    await expect(wrong(await newSession())).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: (15 * MINUTE) / 1000 });
    // Another address is not affected.
    await expect(reauthenticate(h.deps, await newSession(), { method: "email", flowId: randomToken(), code: "000000" }, h.ctx)).rejects.toMatchObject({ code: "invalid_code" });
  });

  test("a recovery code re-authenticates an account with TOTP once, makes level 2 after a password, and is recorded and announced", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const without = await onboardedUser(h, repo, { password: PASSWORD });
    await expect(reauthenticate(h.deps, without.session, { method: "recovery", recoveryCode: "abcd-ef23-gh45" }, h.ctx)).rejects.toMatchObject({ code: "mfa_required", status: 400 });

    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const codes = await enableTotp(h, account.user.id);
    h.clock.advance(REAUTH_WINDOW_MS + 1_000);
    const session = (await h.deps.sessions.resolve(account.token))!.session;
    // A wrong code is refused, recorded as a failed sign-in by recovery code, and rotates nothing.
    await expect(reauthenticate(h.deps, session, { method: "recovery", recoveryCode: "abcd-ef23-gh45" }, h.ctx)).rejects.toMatchObject({ code: "invalid_mfa_code", status: 401 });
    expect(await h.deps.sessions.resolve(account.token)).not.toBeNull();

    const byPassword = await reauthenticate(h.deps, session, { method: "password", password: PASSWORD }, h.ctx);
    expect(byPassword.level).toBe(1);
    const byCode = await reauthenticate(h.deps, byPassword.issued.session, { method: "recovery", recoveryCode: codes[0]! }, h.ctx);
    expect(byCode).toMatchObject({ level: 2, mustReenrollMfa: true });
    expect(byCode.issued.session).toMatchObject({ handle: session.handle, factors: { ...byPassword.issued.session.factors, recovery: h.clock.ms() } });
    expect(await h.deps.sessions.resolve(byPassword.issued.token)).toBeNull();
    expect(h.deps.sessions.level((await h.deps.sessions.resolve(byCode.issued.token))!.session)).toBe(2);
    // The code is spent.
    expect((await repo.findUserById(account.user.id))!.recoveryCodesHash).toHaveLength(9);
    await expect(reauthenticate(h.deps, byCode.issued.session, { method: "recovery", recoveryCode: codes[0]! }, h.ctx)).rejects.toMatchObject({ code: "invalid_mfa_code" });

    const events = await eventsOf(account.user.id);
    expect(events.filter((e) => e.type === "signin_failure").map((e) => [e.ipHash, e.metadata])).toEqual([
      [h.ctx.ipHash, { method: "recovery_code" }],
      [h.ctx.ipHash, { method: "recovery_code" }],
    ]);
    expect(events.filter((e) => e.type === "recovery_code_used").map((e) => [e.deviceId, e.ipHash])).toEqual([[account.session.deviceId, h.ctx.ipHash]]);
    expect(h.mailer.sent.filter((m) => m.template === "recovery_code_used").map((m) => m.to)).toEqual([account.email]);
  });

  test("me describes the signed-in account and its profile", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    await h.deps.profiles.create({ id: account.user.id, handle: "me_test", displayName: "Me Test" });
    expect(await me(h.deps, account.session)).toEqual({
      user: { id: account.user.id, email: account.email, role: "user", onboarded: true, mfaEnabled: false, hasPassword: true, passkeys: 0 },
      // 2d: and the link-preview switch, off by default.
      profile: { id: account.user.id, handle: "me_test", displayName: "Me Test", handleChangedAt: null, verified: false, showInExplore: true, sharePreviews: false },
    });
  });

  test("sessions can be listed, revoked one at a time, signed out, and revoked all at once", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const second = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    const third = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });

    // Each session is listed under its handle, the id a rotation keeps; the hash of a token is never listed.
    const { sessions } = await listSessions(h.deps, account.session);
    expect(sessions.map((s) => s.id).sort()).toEqual([account.session.handle, second.session.handle, third.session.handle].sort());
    expect(sessions.filter((s) => s.current).map((s) => s.id)).toEqual([account.session.handle]);

    // The listed session re-authenticates before the revoke lands, so its token rotates: the listed id still names it.
    const rotated = await reauthenticate(h.deps, second.session, { method: "password", password: PASSWORD }, h.ctx);
    expect(await h.deps.sessions.resolve(second.token)).toBeNull();
    expect(await h.deps.sessions.resolve(rotated.issued.token)).not.toBeNull();
    expect(await revokeSession(h.deps, account.session, second.session.handle)).toBe(true);
    expect(await h.deps.sessions.resolve(rotated.issued.token)).toBeNull();
    expect(await revokeSession(h.deps, account.session, second.session.handle)).toBe(false);
    expect(await revokeSession(h.deps, account.session, randomUUID())).toBe(false);
    // Another account's session is not this one's to revoke.
    const stranger = await onboardedUser(h, repo);
    expect(await revokeSession(h.deps, account.session, stranger.session.handle)).toBe(false);
    expect(await h.deps.sessions.resolve(stranger.token)).not.toBeNull();
    expect((await eventsOf(account.user.id)).filter((e) => e.type === "session_revoked")).toEqual([
      { type: "session_revoked", deviceId: account.session.deviceId, ipHash: null, metadata: { handle: second.session.handle } },
    ]);

    // Signing out after a rotation ends the session under its new token.
    const thirdRotated = await h.deps.sessions.rotate(third.session);
    await signOut(h.deps, thirdRotated.session);
    expect(await h.deps.sessions.resolve(thirdRotated.token)).toBeNull();

    const fourth = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    expect(await revokeAllSessions(h.deps, account.session)).toBe(2);
    expect(h.mailer.sent.filter((m) => m.template === "sessions_revoked_all").map((m) => m.data.count)).toEqual(["2"]);
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(await h.deps.sessions.resolve(fourth.token)).toBeNull();
    expect((await repo.recentEvents(account.user.id)).map((e) => e.type)).toEqual(expect.arrayContaining(["session_revoked", "sessions_revoked_all"]));
  });

  test("'This wasn't me' locks the account down (every session and device, the password) once, and only for the address it was sent to", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const other = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    const link = async (stored: NotMeToken) => {
      const token = randomToken();
      await h.kv.set(notMeKey(token), JSON.stringify(stored), 60_000);
      return token;
    };
    const key = h.deps.config.authHmacKey;
    const token = await link({ userId: account.user.id, deviceId: account.session.deviceId, signedInAt: h.clock.ms(), passkeyId: null, sentTo: emailHash(key, account.email) });

    await notMe(h.deps, { token }, h.ctx);
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(await h.deps.sessions.resolve(other.token)).toBeNull();
    expect(await repo.listDevices(account.user.id)).toEqual([]);
    expect((await repo.findUserById(account.user.id))!.passwordHash).toBeNull();
    const events = await eventsOf(account.user.id);
    expect(events.filter((e) => e.type === "not_me").map((e) => [e.deviceId, e.ipHash, e.metadata])).toEqual([
      [account.session.deviceId, h.ctx.ipHash, { passkeysRemoved: [], totpCleared: false, passwordCleared: true }],
    ]);
    await expect(notMe(h.deps, { token }, h.ctx)).rejects.toMatchObject({ code: "invalid_code", message: LINK_GONE });

    // A link sent to an address the account has since left does nothing but refuse, and is not spent by the refusal.
    const moved = await onboardedUser(h, repo, { password: PASSWORD });
    const stale = await link({ userId: moved.user.id, deviceId: moved.session.deviceId, signedInAt: h.clock.ms(), passkeyId: null, sentTo: emailHash(key, moved.email) });
    await repo.changeEmail(moved.user.id, newTestEmail("moved"), h.clock.now());
    for (let i = 0; i < 2; i++) await expect(notMe(h.deps, { token: stale }, h.ctx)).rejects.toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    expect(await h.deps.sessions.resolve(moved.token)).not.toBeNull();
    expect((await repo.findUserById(moved.user.id))!.passwordHash).not.toBeNull();
    expect((await repo.recentEvents(moved.user.id)).map((e) => e.type)).not.toContain("not_me");
    // Once the account is back at the address the alert went to, as the email undo puts it, the link works, once.
    await repo.changeEmail(moved.user.id, moved.email, h.clock.now());
    await notMe(h.deps, { token: stale }, h.ctx);
    expect(await h.deps.sessions.resolve(moved.token)).toBeNull();
    expect((await repo.findUserById(moved.user.id))!.passwordHash).toBeNull();
    expect((await repo.recentEvents(moved.user.id)).map((e) => e.type).filter((type) => type === "not_me")).toHaveLength(1);
    await expect(notMe(h.deps, { token: stale }, h.ctx)).rejects.toMatchObject({ code: "invalid_code", message: LINK_GONE });
  });

  test("granting a role signs the account out everywhere so the new role applies at once", async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    // The account held no staff session, link or key, so the change ends none and mails nothing (3a design, section 7).
    expect(await grantRole(h.deps, account.email.toUpperCase(), "moderator")).toEqual({
      userId: account.user.id,
      previousRole: "user",
      staffSessionsRevoked: 0,
      enrollmentsDeleted: 0,
      staffKeysRevoked: 0,
      mailError: null,
      tombstoneError: null,
    });
    expect(h.mailer.sent).toEqual([]);
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    const again = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    expect(again.session).toMatchObject({ role: "moderator", mfaEnabled: false });
    await expect(grantRole(h.deps, "nobody-at-all@korbat.local", "admin")).rejects.toThrow(/no account/);
  });
});
