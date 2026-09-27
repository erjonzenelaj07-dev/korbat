import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, createDb, type Db } from "@korbat/db";
import { hash } from "@node-rs/argon2";
import { decrypt, parseVersionedKey, randomToken } from "../../src/auth/crypto";
import { startEmail, verifyEmail } from "../../src/auth/flows/email";
import { confirmTotp, disableTotp, regenerateRecoveryCodes, setupTotp, verifyMfa } from "../../src/auth/flows/mfa";
import { passwordSignIn, setPassword } from "../../src/auth/flows/password";
import { BreachCheckUnavailable, hashPassword, needsRehash } from "../../src/auth/passwords";
import { hashRecoveryCode } from "../../src/auth/recovery-codes";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { REAUTH_WINDOW_MS } from "../../src/auth/sessions";
import { currentStep, hotp } from "../../src/auth/totp";
import { loadConfig } from "../../src/config";
import {
  currentTotpCode,
  flowHarness,
  newTestDevice,
  newTestEmail,
  onboardedUser,
  wrongCode,
  type FlowHarness,
  type OnboardedUser,
} from "./flow-harness";

const PASSWORD = "correct horse battery staple";

describe.skipIf(!process.env.INTEGRATION)("integration: password and MFA flows", () => {
  let db: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_AUTH, { max: 4 });
    repo = createAuthRepo(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });

  async function enableMfa(h: FlowHarness, account: OnboardedUser) {
    await setupTotp(h.deps, account.session);
    // The pending secret is kept for the session's handle, which a rotation keeps (1c design, section 2).
    const pending = (await h.kv.get(`totp-pending:${account.session.handle}`))!;
    const secret = new Uint8Array(decrypt(pending, [h.deps.config.totpKey]));
    return confirmTotp(h.deps, account.session, { code: hotp(secret, currentStep(h.clock.ms())) });
  }

  /** Signs in by email code (after the resend cooldown) and returns the MFA ticket. */
  async function mfaTicketByEmail(h: FlowHarness, account: OnboardedUser) {
    h.clock.advance(61_000);
    const { flowId } = await startEmail(h.deps, { email: account.email, turnstileToken: "ok", ...account.device }, h.ctx);
    const outcome = await verifyEmail(h.deps, { flowId, code: h.mailer.lastCodeFor(account.email)! }, h.ctx);
    if (outcome.kind !== "mfa") throw new Error(`expected an MFA ticket, got ${outcome.kind}`);
    return outcome.mfaTicket;
  }

  test("password sign-in succeeds; unknown emails, accounts without a password and wrong passwords get the same error", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const withPassword = await onboardedUser(h, repo, { password: PASSWORD });
    const withoutPassword = await onboardedUser(h, repo);
    const attempt = (email: string, password: string, turnstileToken = "ok") =>
      passwordSignIn(h.deps, { email, password, turnstileToken, ...newTestDevice() }, h.ctx);

    expect((await attempt(withPassword.email, PASSWORD)).kind).toBe("session");
    for (const [email, password] of [
      [newTestEmail(), PASSWORD],
      [withoutPassword.email, PASSWORD],
      [withPassword.email, "wrong password entirely"],
    ] as const) {
      await expect(attempt(email, password)).rejects.toMatchObject({ code: "invalid_credentials", status: 401 });
    }
    await expect(attempt(withPassword.email, PASSWORD, "fail")).rejects.toMatchObject({ code: "turnstile_failed" });
  });

  test("five wrong passwords lock password sign-in for 15 minutes and email the owner; email-code sign-in keeps working", { timeout: 60_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const attempt = (password: string) =>
      passwordSignIn(h.deps, { email: account.email, password, turnstileToken: "ok", ...account.device }, h.ctx);

    for (let i = 0; i < 5; i++) await expect(attempt("wrong password entirely")).rejects.toMatchObject({ code: "invalid_credentials" });
    await expect(attempt(PASSWORD)).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(h.mailer.sent.filter((m) => m.template === "account_locked")).toHaveLength(1);

    const { flowId } = await startEmail(h.deps, { email: account.email, turnstileToken: "ok", ...account.device }, h.ctx);
    expect((await verifyEmail(h.deps, { flowId, code: h.mailer.lastCodeFor(account.email)! }, h.ctx)).kind).toBe("session");

    h.clock.advance(16 * 60_000);
    expect((await attempt(PASSWORD)).kind).toBe("session");
  });

  test("password sign-in timing does not reveal whether an email has an account", { timeout: 120_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const time = async (email: string) => {
      const startedAt = performance.now();
      await passwordSignIn(
        h.deps,
        { email, password: "wrong password entirely", turnstileToken: "ok", ...newTestDevice() },
        { ...h.ctx, ipHash: randomToken() },
      ).catch(() => undefined);
      return performance.now() - startedAt;
    };
    const unknown: number[] = [];
    const known: number[] = [];
    for (let i = 0; i < 10; i++) {
      unknown.push(await time(newTestEmail()));
      known.push(await time(account.email));
    }
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    expect(Math.abs(median(unknown) - median(known))).toBeLessThan(50);
  });

  test("setting a password enforces length and breach rules, fails closed when the check is down, and rotates the session", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);

    await expect(setPassword(h.deps, account.session, { password: "short" })).rejects.toMatchObject({ code: "password_too_short" });
    await expect(setPassword(h.deps, account.session, { password: "a".repeat(129) })).rejects.toMatchObject({ code: "password_too_long" });
    await expect(setPassword(h.deps, account.session, { password: "breached password 123" })).rejects.toMatchObject({ code: "password_breached" });

    const realChecker = h.deps.breachChecker;
    h.deps.breachChecker = {
      isBreached: async () => {
        throw new BreachCheckUnavailable("offline");
      },
    };
    await expect(setPassword(h.deps, account.session, { password: PASSWORD })).rejects.toMatchObject({ code: "password_check_unavailable", status: 503 });
    h.deps.breachChecker = realChecker;
    expect((await repo.findUserById(account.user.id))!.passwordHash).toBeNull();

    const rotated = await setPassword(h.deps, account.session, { password: PASSWORD });
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(await h.deps.sessions.resolve(rotated.token)).not.toBeNull();
    await setPassword(h.deps, rotated.session, { password: `${PASSWORD} again` });
    expect(h.mailer.sent.filter((m) => m.template === "password_changed").map((m) => m.to)).toEqual([account.email, account.email]);
    expect((await repo.recentEvents(account.user.id)).map((e) => e.type)).toEqual(expect.arrayContaining(["password_set", "password_changed"]));
  });

  test("MFA setup: a wrong code keeps it off; the right code turns it on, returns 10 recovery codes and rotates the session", async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const setup = await setupTotp(h.deps, account.session);
    expect(setup.otpauthUri).toMatch(/^otpauth:\/\/totp\/korbat:account\?secret=/);
    expect(setup.qrSvg.startsWith("<svg")).toBe(true);

    const pending = (await h.kv.get(`totp-pending:${account.session.handle}`))!;
    const right = hotp(new Uint8Array(decrypt(pending, [h.deps.config.totpKey])), currentStep(h.clock.ms()));
    await expect(confirmTotp(h.deps, account.session, { code: wrongCode(right) })).rejects.toMatchObject({ code: "invalid_mfa_code" });
    expect((await repo.findUserById(account.user.id))!.totpEnabledAt).toBeNull();

    const confirmed = await confirmTotp(h.deps, account.session, { code: right });
    expect(confirmed.recoveryCodes).toHaveLength(10);
    // The code proved the new secret, so the session gains the totp factor; the token rotates in place and the cached copy knows MFA is on.
    expect(confirmed.issued.session).toMatchObject({
      mfaEnabled: true,
      handle: account.session.handle,
      factors: { ...account.session.factors, totp: h.clock.ms() },
      reauthAt: h.clock.now(),
    });
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect((await h.deps.sessions.resolve(confirmed.issued.token))!.session).toEqual(confirmed.issued.session);
    expect(await h.kv.get(`totp-pending:${account.session.handle}`)).toBeNull();
    const stored = (await repo.findUserById(account.user.id))!;
    expect(stored.totpEnabledAt).toEqual(h.clock.now());
    expect(stored.totpSecretEnc).toMatch(/^v1:/);
    expect(stored.recoveryCodesHash).toHaveLength(10);
    expect(stored.recoveryCodesHash).not.toContain(confirmed.recoveryCodes[0]);
  });

  test("two confirmations of one setup at once turn two-factor on once: the recovery codes the one answer shows are the ones stored, and the other is refused before it writes", async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    await setupTotp(h.deps, account.session);
    const pending = (await h.kv.get(`totp-pending:${account.session.handle}`))!;
    const code = hotp(new Uint8Array(decrypt(pending, [h.deps.config.totpKey])), currentStep(h.clock.ms()));
    // A double submit: the same session and the same code, twice at once. Each read of the pending secret waits for the
    // other, so both requests hold it before either goes on, whatever the database's timing.
    const get = h.kv.get.bind(h.kv);
    let readers = 0;
    let release!: () => void;
    const bothRead = new Promise<void>((resolve) => (release = resolve));
    h.kv.get = async (key) => {
      const value = await get(key);
      if (key === `totp-pending:${account.session.handle}`) {
        if (++readers === 2) release();
        await bothRead;
      }
      return value;
    };
    const outcomes = await Promise.allSettled([confirmTotp(h.deps, account.session, { code }), confirmTotp(h.deps, account.session, { code })]);
    h.kv.get = get;
    expect(readers).toBe(2);
    const won = outcomes.filter((o): o is PromiseFulfilledResult<Awaited<ReturnType<typeof confirmTotp>>> => o.status === "fulfilled");
    const lost = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
    expect([won.length, lost.length]).toEqual([1, 1]);
    expect(lost[0]!.reason).toMatchObject({ code: "invalid_mfa_code", status: 400, message: "Two-factor setup expired. Start again." });

    const stored = (await repo.findUserById(account.user.id))!;
    expect(stored.recoveryCodesHash).toEqual(won[0]!.value.recoveryCodes.map((recoveryCode) => hashRecoveryCode(h.deps.config.authHmacKey, recoveryCode)));
    expect(stored).toMatchObject({ totpSecretEnc: pending, totpEnabledAt: h.clock.now() });
    expect((await repo.recentEvents(account.user.id)).filter((e) => e.type === "mfa_enabled")).toHaveLength(1);
    expect(h.mailer.sent.filter((m) => m.template === "mfa_enabled").map((m) => m.to)).toEqual([account.email]);
    // One rotation: the old token is dead, and the token the one answer carries is the session's.
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect((await h.deps.sessions.resolve(won[0]!.value.issued.token))!.session).toMatchObject({ handle: account.session.handle, mfaEnabled: true, factors: { ...account.session.factors, totp: h.clock.ms() } });
    // Every recovery code shown works; the first one proves it at the next sign-in.
    const signed = await verifyMfa(h.deps, { mfaTicket: await mfaTicketByEmail(h, account), recoveryCode: won[0]!.value.recoveryCodes[0]! }, h.ctx);
    expect(signed.mustReenrollMfa).toBe(true);
  });

  test("MFA sign-in accepts a current code once, rejects a replay, and voids a ticket after five wrong codes", { timeout: 60_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    await enableMfa(h, account);

    const firstTicket = await mfaTicketByEmail(h, account);
    const code = await currentTotpCode(h, repo, account.user.id);
    const signed = await verifyMfa(h.deps, { mfaTicket: firstTicket, code }, h.ctx);
    expect(signed.issued.session.mfaEnabled).toBe(true);
    expect(signed.mustReenrollMfa).toBe(false);
    await expect(verifyMfa(h.deps, { mfaTicket: firstTicket, code }, h.ctx)).rejects.toMatchObject({ code: "invalid_mfa_code" });

    const ticketByPassword = async () => {
      const outcome = await passwordSignIn(h.deps, { email: account.email, password: PASSWORD, turnstileToken: "ok", ...account.device }, h.ctx);
      if (outcome.kind !== "mfa") throw new Error("expected an MFA ticket");
      return outcome.mfaTicket;
    };
    await expect(verifyMfa(h.deps, { mfaTicket: await ticketByPassword(), code }, h.ctx)).rejects.toMatchObject({ code: "invalid_mfa_code" });

    const ticket = await ticketByPassword();
    for (let i = 0; i < 5; i++) {
      await expect(verifyMfa(h.deps, { mfaTicket: ticket, code: wrongCode(code) }, h.ctx)).rejects.toMatchObject({ code: "invalid_mfa_code" });
    }
    await expect(verifyMfa(h.deps, { mfaTicket: ticket, code }, h.ctx)).rejects.toMatchObject({ code: "too_many_attempts" });
    await expect(verifyMfa(h.deps, { mfaTicket: ticket, code }, h.ctx)).rejects.toMatchObject({ code: "invalid_mfa_code" });
  });

  test("a recovery code signs in once, asks for MFA to be set up again, is recorded with the device and announced, and cannot be reused", async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const { recoveryCodes } = await enableMfa(h, account);

    const signed = await verifyMfa(h.deps, { mfaTicket: await mfaTicketByEmail(h, account), recoveryCode: recoveryCodes[0]!.toUpperCase() }, h.ctx);
    expect(signed.mustReenrollMfa).toBe(true);
    expect(signed.issued.session.factors).toMatchObject({ email: h.clock.ms(), recovery: h.clock.ms() });
    await expect(verifyMfa(h.deps, { mfaTicket: await mfaTicketByEmail(h, account), recoveryCode: recoveryCodes[0]! }, h.ctx)).rejects.toMatchObject({
      code: "invalid_mfa_code",
    });
    expect((await repo.findUserById(account.user.id))!.recoveryCodesHash).toHaveLength(9);
    // The event names the device the session was issued on, as the re-authentication path's does; the owner is told once, whichever path spent the code.
    const used = (await repo.recentEvents(account.user.id)).filter((e) => e.type === "recovery_code_used");
    expect(used.map((e) => e.deviceId)).toEqual([signed.issued.session.deviceId]);
    expect(h.mailer.sent.filter((m) => m.template === "recovery_code_used").map((m) => m.to)).toEqual([account.email]);
  });

  test("recovery codes can be regenerated; turning MFA off takes no code (the re-authentication spent it), and is refused for staff and for an account without it", async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const { recoveryCodes, issued } = await enableMfa(h, account);

    const regenerated = await regenerateRecoveryCodes(h.deps, issued.session);
    expect(regenerated).toHaveLength(10);
    expect(regenerated).not.toContain(recoveryCodes[0]);
    await expect(verifyMfa(h.deps, { mfaTicket: await mfaTicketByEmail(h, account), recoveryCode: recoveryCodes[0]! }, h.ctx)).rejects.toMatchObject({
      code: "invalid_mfa_code",
    });

    await repo.setRole(account.user.id, "moderator");
    const staff = await h.deps.sessions.issue(account.user.id, issued.session.deviceId, { factors: { email: h.clock.ms(), totp: h.clock.ms() } });
    await expect(disableTotp(h.deps, staff.session)).rejects.toMatchObject({ code: "staff_mfa_required" });
    expect((await repo.findUserById(account.user.id))!.totpEnabledAt).not.toBeNull();

    await repo.setRole(account.user.id, "user");
    const regular = await h.deps.sessions.issue(account.user.id, issued.session.deviceId, { factors: { email: h.clock.ms(), totp: h.clock.ms() } });
    await disableTotp(h.deps, regular.session);
    expect((await repo.findUserById(account.user.id))!).toMatchObject({ totpEnabledAt: null, totpSecretEnc: null, recoveryCodesHash: [] });
    expect((await h.deps.sessions.resolve(regular.token))!.session.mfaEnabled).toBe(false);
    await expect(disableTotp(h.deps, regular.session)).rejects.toMatchObject({ code: "mfa_required", status: 400 });
  });

  test("setup needs a fresh session and, once two-factor is on, level 2; confirmation needs only the pending secret, even six minutes later; the owner is told when it turns on or off", async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    h.clock.advance(REAUTH_WINDOW_MS + 1_000);
    const stale = (await h.deps.sessions.resolve(account.token))!.session;
    await expect(setupTotp(h.deps, stale)).rejects.toMatchObject({ code: "reauth_required", status: 403, details: { level: 1, have: [] } });
    // Without a setup there is no pending secret, whatever the code says.
    await expect(confirmTotp(h.deps, stale, { code: "000000" })).rejects.toMatchObject({ code: "invalid_mfa_code", message: "Two-factor setup expired. Start again." });

    await h.deps.sessions.addFactor(stale.sessionId, "email");
    const fresh = (await h.deps.sessions.resolve(account.token))!.session;
    await setupTotp(h.deps, fresh);
    const pending = (await h.kv.get(`totp-pending:${fresh.handle}`))!;
    const secret = new Uint8Array(decrypt(pending, [h.deps.config.totpKey]));
    // Scanning the QR code took a while: the session is no longer fresh, and the confirmation does not care.
    h.clock.advance(6 * 60_000);
    expect(h.deps.sessions.isFresh((await h.deps.sessions.resolve(account.token))!.session)).toBe(false);
    const { issued } = await confirmTotp(h.deps, fresh, { code: hotp(secret, currentStep(h.clock.ms())) });
    expect(issued.session).toMatchObject({ mfaEnabled: true, factors: { ...fresh.factors, totp: h.clock.ms() } });
    expect(h.mailer.sent.filter((m) => m.template === "mfa_enabled").map((m) => m.to)).toEqual([account.email]);

    // Now that the account has TOTP, replacing the secret needs level 2: an email code alone is refused, with a TOTP code beside it accepted.
    const onlyEmail = await h.deps.sessions.issue(account.user.id, fresh.deviceId, { factors: { email: h.clock.ms() } });
    await expect(setupTotp(h.deps, onlyEmail.session)).rejects.toMatchObject({ code: "reauth_required", status: 403, details: { level: 2, have: ["email"] } });
    await h.deps.sessions.addFactor(onlyEmail.session.sessionId, "totp");
    const strong = (await h.deps.sessions.resolve(onlyEmail.token))!.session;
    expect((await setupTotp(h.deps, strong)).otpauthUri).toMatch(/^otpauth:\/\/totp\//);

    await disableTotp(h.deps, issued.session);
    expect(h.mailer.sent.filter((m) => m.template === "mfa_disabled")).toHaveLength(1);
    expect((await h.deps.sessions.resolve(issued.token))!.session.mfaEnabled).toBe(false);
  });

  test("a secret encrypted with a previous key still verifies and is re-encrypted with the current key", async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    await enableMfa(h, account);
    const v1 = h.deps.config.totpKey;
    const v2 = parseVersionedKey(`v2:${Buffer.alloc(32, 9).toString("base64")}`);
    h.deps.config = { ...h.deps.config, totpKey: v2, totpPreviousKeys: [v1] };

    const before = (await repo.findUserById(account.user.id))!;
    const ticket = await mfaTicketByEmail(h, account);
    const code = hotp(new Uint8Array(decrypt(before.totpSecretEnc!, [v1])), currentStep(h.clock.ms()));
    expect((await verifyMfa(h.deps, { mfaTicket: ticket, code }, h.ctx)).issued.session.mfaEnabled).toBe(true);
    const after = (await repo.findUserById(account.user.id))!;
    expect(after.totpSecretEnc).toMatch(/^v2:/);
    expect(decrypt(after.totpSecretEnc!, [v2])).toEqual(decrypt(before.totpSecretEnc!, [v1]));
  });

  test("a password hashed with older parameters is re-hashed on the next sign-in", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const weak = await hash(PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 });
    await repo.setPasswordHash(account.user.id, weak, new Date());
    expect(needsRehash(weak)).toBe(true);
    expect((await passwordSignIn(h.deps, { email: account.email, password: PASSWORD, turnstileToken: "ok", ...account.device }, h.ctx)).kind).toBe("session");
    const stored = (await repo.findUserById(account.user.id))!.passwordHash!;
    expect(needsRehash(stored)).toBe(false);
    expect(stored).not.toBe(weak);
  });

  test("hashPassword output is accepted by password sign-in on a fresh account", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    await repo.setPasswordHash(account.user.id, await hashPassword(PASSWORD), new Date());
    expect((await passwordSignIn(h.deps, { email: account.email, password: PASSWORD, turnstileToken: "ok", ...account.device }, h.ctx)).kind).toBe("session");
  });
});
