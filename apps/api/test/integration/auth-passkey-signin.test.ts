import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { authEvents, closeDb, createDb, passkeys, type Db } from "@korbat/db";
import { AuthError } from "../../src/auth/context";
import { encrypt, randomToken } from "../../src/auth/crypto";
import { notMe } from "../../src/auth/flows/not-me";
import { reauthenticate } from "../../src/auth/flows/reauth";
import { notMeKey } from "../../src/auth/flows/signin";
import { MINUTE } from "../../src/auth/limits";
import { reauthOptions, registerOptions, registerVerify, signInOptions, signInVerify } from "../../src/auth/passkeys/flows";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import type { Session } from "../../src/auth/sessions";
import { currentStep, hotp, newTotpSecret } from "../../src/auth/totp";
import { loadConfig } from "../../src/config";
import { SoftAuthenticator, type SoftFlags } from "../auth/soft-authenticator";
import { flowHarness, onboardedUser, type FlowHarness } from "./flow-harness";

const ORIGIN = "http://localhost:8081";
const RP_ID = "localhost";
const PASSWORD = "correct horse battery staple";
const ALL: SoftFlags = { up: true, uv: true, be: true, bs: true };
const BARE: SoftFlags = { up: true, uv: false, be: false, bs: false };

/** The AuthError a flow rejects with; anything else fails the test. */
async function failure(promise: Promise<unknown>): Promise<AuthError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AuthError) return err;
    throw err;
  }
  throw new Error("expected the flow to reject");
}

/**
 * Passkey sign-in and re-authentication against the real repository (1c design, sections 7.2 and 7.4), with the software
 * authenticator: the session model, the counter write's conditional update, and the new-device alert's not-me link naming
 * the passkey that signed in.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: passkey sign-in and re-authentication", () => {
  let db: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_AUTH, { max: 4 });
    repo = createAuthRepo(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });

  /** Registers a passkey through Task 4's flow (before any TOTP, so the level-1 session suffices) and answers its credential id. */
  async function register(h: FlowHarness, session: Session, auth: SoftAuthenticator, flags: SoftFlags = ALL): Promise<string> {
    const { options } = await registerOptions(h.deps, session, { label: "ada" });
    const response = auth.create({ rpId: options.rp.id!, challenge: options.challenge, origin: ORIGIN, userHandle: Buffer.from(options.user.id, "base64url"), flags });
    await registerVerify(h.deps, session, { response });
    return response.id;
  }

  /** A whole passkey sign-in against the real repository: fresh options, the authenticator's answer, and the verification. */
  async function passkeySignIn(h: FlowHarness, auth: SoftAuthenticator, credentialId: string, deviceId: string, opts: { flags?: SoftFlags; counter?: number } = {}) {
    const { options } = await signInOptions(h.deps, h.ctx);
    const response = auth.get({ credentialId, rpId: RP_ID, challenge: options.challenge, origin: ORIGIN, flags: opts.flags ?? ALL, counter: opts.counter ?? 0 });
    return signInVerify(h.deps, { deviceId, platform: "web", response }, h.ctx);
  }

  async function withTotp(h: FlowHarness, userId: string): Promise<Uint8Array> {
    const secret = newTotpSecret();
    await repo.enableTotp(userId, { secretEnc: encrypt(Buffer.from(secret), h.deps.config.totpKey), recoveryCodesHash: [], now: h.clock.now() });
    await h.deps.sessions.forgetUser(userId);
    return secret;
  }

  const passkeyRow = async (credentialId: string) => (await db.select().from(passkeys).where(eq(passkeys.credentialId, credentialId)))[0]!;

  test("register, sign out, sign in with the passkey, then re-authenticate with it", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const auth = new SoftAuthenticator();
    const credentialId = await register(h, account.session, auth);
    // Sign out the registration session; the passkey signs in without it.
    await h.deps.sessions.revoke(account.session.handle, account.user.id);
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();

    const outcome = await passkeySignIn(h, auth, credentialId, randomToken(), { counter: 1 });
    expect(outcome.kind).toBe("session");
    if (outcome.kind !== "session") throw new Error("unreachable");
    const signedIn = (await h.deps.sessions.resolve(outcome.issued.token))!.session;
    // A user-verified passkey on a TOTP-less account is two factors in one gesture.
    expect(signedIn.factors.passkey_uv).toBeDefined();
    expect(h.deps.sessions.level(signedIn)).toBe(2);
    expect(signedIn.passkeyId).toBe((await passkeyRow(credentialId)).id);
    expect((await passkeyRow(credentialId)).counter).toBe(1);

    // Re-authenticate with the same passkey: the options list it, the assertion answers, level 2 and the token rotates.
    const { options } = await reauthOptions(h.deps, signedIn);
    expect(options.allowCredentials!.map((c) => c.id)).toContain(credentialId);
    const response = auth.get({ credentialId, rpId: RP_ID, challenge: options.challenge, origin: ORIGIN, flags: ALL, counter: 2 });
    const reauthed = await reauthenticate(h.deps, signedIn, { method: "passkey", response }, h.ctx);
    expect(reauthed.level).toBe(2);
    expect(reauthed.issued.session.handle).toBe(signedIn.handle);
    expect(await h.deps.sessions.resolve(outcome.issued.token)).toBeNull();
    expect((await passkeyRow(credentialId)).counter).toBe(2);
  });

  test("on an account with TOTP a user-verified passkey skips the step, a plain one does not", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const uv = new SoftAuthenticator();
    const plain = new SoftAuthenticator();
    const uvId = await register(h, account.session, uv, ALL);
    const plainId = await register(h, account.session, plain, BARE);
    const secret = await withTotp(h, account.user.id);

    // The user-verified passkey signs in outright at level 2.
    const skipped = await passkeySignIn(h, uv, uvId, randomToken());
    expect(skipped.kind).toBe("session");
    if (skipped.kind !== "session") throw new Error("unreachable");
    expect(h.deps.sessions.level((await h.deps.sessions.resolve(skipped.issued.token))!.session)).toBe(2);

    // The plain passkey stops at the TOTP step; the code then completes the sign-in.
    const pending = await passkeySignIn(h, plain, plainId, randomToken());
    expect(pending.kind).toBe("mfa");
    if (pending.kind !== "mfa") throw new Error("unreachable");
    const { verifyMfa } = await import("../../src/auth/flows/mfa");
    const signed = await verifyMfa(h.deps, { mfaTicket: pending.mfaTicket, code: hotp(secret, currentStep(h.clock.ms())) }, h.ctx);
    expect(Object.keys(signed.issued.session.factors).sort()).toEqual(["passkey", "totp"]);

    // The user-verified passkey asserted without user verification stops there too: the registration alone does not make two factors.
    expect((await passkeyRow(uvId)).uvInitialized).toBe(true);
    expect((await passkeySignIn(h, uv, uvId, randomToken(), { flags: BARE })).kind).toBe("mfa");
    // And re-authenticating with it that way writes the one-factor kind, which is not level 2.
    const session = (await h.deps.sessions.resolve(skipped.issued.token))!.session;
    h.clock.advance(10 * MINUTE);
    const { options } = await reauthOptions(h.deps, session);
    const response = uv.get({ credentialId: uvId, rpId: RP_ID, challenge: options.challenge, origin: ORIGIN, flags: BARE, counter: 0 });
    const reauthed = await reauthenticate(h.deps, session, { method: "passkey", response }, h.ctx);
    expect(reauthed.level).toBe(1);
    expect(reauthed.issued.session.factors).toMatchObject({ passkey: h.clock.ms() });
  });

  test("another account's passkey never re-authenticates a session: the repository looks it up with the session's account, and the passkey's row stays as it was", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const ada = await onboardedUser(h, repo);
    const bob = await onboardedUser(h, repo);
    const auth = new SoftAuthenticator();
    const credentialId = await register(h, ada.session, auth);
    // ada's passkey has a use on the record.
    expect((await passkeySignIn(h, auth, credentialId, randomToken(), { counter: 7 })).kind).toBe("session");
    const before = await passkeyRow(credentialId);
    expect(before).toMatchObject({ userId: ada.user.id, counter: 7, lastUsedAt: h.clock.now(), suspectAt: null });
    h.clock.advance(MINUTE);

    // bob's session gets a challenge of its own and answers it with ada's passkey: a signature that checks, over bob's challenge.
    const { options } = await reauthOptions(h.deps, bob.session);
    expect(options.allowCredentials).toEqual([]);
    const response = auth.get({ credentialId, rpId: RP_ID, challenge: options.challenge, origin: ORIGIN, flags: ALL, counter: 20 });
    expect(await failure(reauthenticate(h.deps, bob.session, { method: "passkey", response }, h.ctx))).toMatchObject({ code: "passkey_invalid", status: 401 });
    // ada's passkey was never found, so nothing of it moved: not the counter, not the use, and it was not suspected.
    expect(await passkeyRow(credentialId)).toEqual(before);
    // bob's session proved nothing: its factors are the sign-in's, and its token was not rotated.
    const bobs = (await h.deps.sessions.resolve(bob.token))!.session;
    expect(bobs).toEqual(bob.session);
    expect(h.deps.sessions.level(bobs)).toBe(1);
    const events = await db.select({ type: authEvents.type }).from(authEvents).where(eq(authEvents.userId, ada.user.id));
    expect(events.map((e) => e.type)).not.toContain("passkey_counter_regression");

    // The passkey still re-authenticates a session of its own account.
    const signedIn = (await h.deps.sessions.resolve(ada.token))!.session;
    const own = await reauthOptions(h.deps, signedIn);
    const ownResponse = auth.get({ credentialId, rpId: RP_ID, challenge: own.options.challenge, origin: ORIGIN, flags: ALL, counter: 21 });
    expect((await reauthenticate(h.deps, signedIn, { method: "passkey", response: ownResponse }, h.ctx)).level).toBe(2);
    expect(await passkeyRow(credentialId)).toMatchObject({ counter: 21, lastUsedAt: h.clock.now() });
  });

  test("a counter regression end to end suspends the passkey, records it, mails the owner and refuses; a later good sign-in is passkey_suspended", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const auth = new SoftAuthenticator();
    const credentialId = await register(h, account.session, auth);
    expect((await passkeySignIn(h, auth, credentialId, randomToken(), { counter: 5 })).kind).toBe("session");
    expect((await passkeyRow(credentialId)).counter).toBe(5);

    // A counter that goes backwards, after the signature checks: suspend, record, mail, refuse.
    expect(await failure(passkeySignIn(h, auth, credentialId, randomToken(), { counter: 3 }))).toMatchObject({ code: "passkey_invalid", status: 401 });
    const row = await passkeyRow(credentialId);
    expect(row.suspectAt).not.toBeNull();
    const events = await db.select({ type: authEvents.type, metadata: authEvents.metadata }).from(authEvents).where(eq(authEvents.userId, account.user.id));
    expect(events.filter((e) => e.type === "passkey_counter_regression")).toEqual([{ type: "passkey_counter_regression", metadata: { passkeyId: row.id } }]);
    expect(h.mailer.sent.filter((m) => m.template === "passkey_suspect")).toEqual([{ to: account.email, template: "passkey_suspect", data: { name: row.name } }]);

    // A suspended passkey is refused from then on, after its signature checks.
    expect(await failure(passkeySignIn(h, auth, credentialId, randomToken(), { counter: 9 }))).toMatchObject({ code: "passkey_suspended", status: 403 });
  });

  test("the new-device alert's not-me link removes the passkey that signed in", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const auth = new SoftAuthenticator();
    const credentialId = await register(h, account.session, auth);
    const added = await passkeyRow(credentialId);

    // Sign in from a device the account has not used: the passkey signs in and its new-device alert names it.
    const outcome = await passkeySignIn(h, auth, credentialId, randomToken());
    expect(outcome.kind).toBe("session");
    const alert = h.mailer.sent.filter((m) => m.template === "new_device").at(-1)!;
    const token = alert.data.notMeUrl!.slice(alert.data.notMeUrl!.lastIndexOf("/") + 1);
    const stored = JSON.parse((await h.deps.kv.get(notMeKey(token)))!) as { passkeyId: string | null };
    expect(stored.passkeyId).toBe(added.id);

    await notMe(h.deps, { token }, h.ctx);
    expect(await db.select().from(passkeys).where(eq(passkeys.id, added.id))).toEqual([]);
    expect((await repo.findUserById(account.user.id))!.passwordHash).toBeNull();
  });
});
