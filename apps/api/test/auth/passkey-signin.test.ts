import { randomBytes } from "node:crypto";
import { describe, expect, test, vi } from "vitest";
import { AuthError } from "../../src/auth/context";
import { encrypt } from "../../src/auth/crypto";
import { verifyMfa } from "../../src/auth/flows/mfa";
import { reauthenticate } from "../../src/auth/flows/reauth";
import { HOUR, MINUTE } from "../../src/auth/limits";
import { challengeKey, readChallenge } from "../../src/auth/passkeys/challenge";
import {
  SIGNIN_NEW_DEVICE_PER_DAY,
  SIGNIN_NEW_DEVICE_PER_HOUR,
  SIGNIN_OPTIONS_PER_IP,
  SIGNIN_VERIFY_PER_IP,
  reauthOptions,
  reauthenticatePasskey,
  registerOptions,
  registerVerify,
  signInOptions,
  signInVerify,
} from "../../src/auth/passkeys/flows";
import type { Session } from "../../src/auth/sessions";
import { currentStep, hotp, newTotpSecret } from "../../src/auth/totp";
import { memoryFlowHarness, type MemoryFlowHarness } from "./flow-harness";
import { SoftAuthenticator, type SoftFlags } from "./soft-authenticator";

const RP_ID = "localhost";
const ORIGIN = "http://localhost:8081";
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

/** An account with two-factor on now, encrypted with the harness key so the MFA step can verify a real code. */
function withTotp(h: MemoryFlowHarness, userId: string, secret: Uint8Array): void {
  Object.assign(h.users.get(userId)!, {
    totpSecretEnc: encrypt(Buffer.from(secret), h.deps.config.totpKey),
    totpEnabledAt: h.now(),
    totpLastStep: null,
    recoveryCodesHash: [],
  });
}

/** Registers a passkey through the real flow (before any TOTP, so the level-1 session suffices) and answers its credential id. */
async function registerPasskey(h: MemoryFlowHarness, session: Session, auth: SoftAuthenticator, flags: SoftFlags = ALL): Promise<string> {
  const { options } = await registerOptions(h.deps, session, { label: "ada" });
  const response = auth.create({ rpId: options.rp.id!, challenge: options.challenge, origin: ORIGIN, userHandle: Buffer.from(options.user.id, "base64url"), flags });
  await registerVerify(h.deps, session, { response });
  return response.id;
}

/**
 * A whole passkey sign-in: fresh options, the authenticator's answer, and the verification. The answer carries the user
 * handle the passkey was created with unless the test gives another, or null for none at all.
 */
async function passkeySignIn(
  h: MemoryFlowHarness,
  auth: SoftAuthenticator,
  credentialId: string,
  deviceId: string,
  opts: { flags?: SoftFlags; counter?: number; userHandle?: Uint8Array | null; tamper?: boolean } = {},
) {
  const { options } = await signInOptions(h.deps, h.ctx);
  const response = auth.get({
    credentialId,
    rpId: RP_ID,
    challenge: options.challenge,
    origin: ORIGIN,
    flags: opts.flags ?? ALL,
    counter: opts.counter ?? 0,
    ...(opts.userHandle !== undefined ? { userHandle: opts.userHandle } : {}),
  });
  // A tampered signature stands for any assertion the library will not verify.
  if (opts.tamper) response.response.signature = response.response.signature.slice(0, -4) + (response.response.signature.endsWith("AAAA") ? "BBBB" : "AAAA");
  return signInVerify(h.deps, { deviceId, platform: "web", response }, h.ctx);
}

describe("passkey sign-in options (1c design, section 7.4)", () => {
  test("carry an empty allow list and a sign-in challenge, and store nothing but the address's counter", async () => {
    const h = memoryFlowHarness();
    // The three methods of the store that can create a key: what handing out options writes is what they are called with.
    const set = vi.spyOn(h.kv, "set");
    const setIfAbsent = vi.spyOn(h.kv, "setIfAbsent");
    const incr = vi.spyOn(h.kv, "incr");
    const { options } = await signInOptions(h.deps, h.ctx);
    expect(options.allowCredentials).toEqual([]);
    expect(options.challenge).toMatch(/^[A-Za-z0-9_-]{78}$/);
    expect(options.rpId).toBe(RP_ID);
    // A second call is a different challenge, and neither wrote a challenge record, a used-challenge marker or anything else.
    const again = await signInOptions(h.deps, h.ctx);
    expect(again.options.challenge).not.toBe(options.challenge);
    const counter = `rl:passkey-signin-options:ip:${h.ctx.ipHash}`;
    expect(set).not.toHaveBeenCalled();
    expect(setIfAbsent).not.toHaveBeenCalled();
    expect(incr.mock.calls).toEqual([
      [counter, 15 * MINUTE],
      [counter, 15 * MINUTE],
    ]);
    expect(await h.kv.get(counter)).toBe("2");
  });

  test("allows 30 per IP per 15 minutes, then rate_limited with a Retry-After", async () => {
    const h = memoryFlowHarness();
    expect(SIGNIN_OPTIONS_PER_IP).toBe(30);
    for (let i = 0; i < SIGNIN_OPTIONS_PER_IP; i++) await signInOptions(h.deps, h.ctx);
    expect(await failure(signInOptions(h.deps, h.ctx))).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: (15 * MINUTE) / 1000 });
    // Another address has its own allowance.
    expect((await signInOptions(h.deps, { ...h.ctx, ipHash: "other" })).options.challenge).toBeDefined();
  });
});

describe("passkey sign-in verify (1c design, section 7.4)", () => {
  test("a user-verified passkey on an account with TOTP signs in with passkey_uv and level 2, skipping the TOTP step", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, ALL);
    withTotp(h, ada.user.id, newTotpSecret());

    const outcome = await passkeySignIn(h, auth, credentialId, "device-uv");
    expect(outcome.kind).toBe("session");
    if (outcome.kind !== "session") throw new Error("unreachable");
    expect(outcome.issued.session.factors).toEqual({ passkey_uv: h.now().getTime() });
    expect(outcome.issued.session.passkeyId).toBe(h.passkeys[0]!.id);
    expect(h.deps.sessions.level(outcome.issued.session)).toBe(2);
    expect(outcome.issued.session.mfaEnabled).toBe(true);
    // The sign-in is recorded with its method.
    expect(h.events.filter((e) => e.type === "signin_success").at(-1)!.metadata).toEqual({ method: "passkey" });
  });

  test("a passkey without user verification on an account with TOTP gets an MFA ticket, and the TOTP step then holds passkey and totp at level 2", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, BARE);
    const secret = newTotpSecret();
    withTotp(h, ada.user.id, secret);

    // Even a UV assertion is one factor here: the passkey was not registered with user verification.
    const pending = await passkeySignIn(h, auth, credentialId, "device-plain", { flags: ALL });
    expect(pending.kind).toBe("mfa");
    if (pending.kind !== "mfa") throw new Error("unreachable");

    const signed = await verifyMfa(h.deps, { mfaTicket: pending.mfaTicket, code: hotp(secret, currentStep(h.now().getTime())) }, h.ctx);
    expect(Object.keys(signed.issued.session.factors).sort()).toEqual(["passkey", "totp"]);
    expect(signed.issued.session.passkeyId).toBe(h.passkeys[0]!.id);
    expect(h.deps.sessions.level(signed.issued.session)).toBe(2);
    expect(h.events.filter((e) => e.type === "signin_success").at(-1)!.metadata).toEqual({ method: "passkey" });
  });

  test("a passkey registered with user verification but asserted without it is one factor: on an account with TOTP it goes to the TOTP step, and without TOTP it signs in at level 1", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, ALL);
    expect(h.passkeys[0]!.uvInitialized).toBe(true);

    // The options only prefer user verification, so an authenticator may answer without it: the UV flag of this assertion decides.
    const plain = await passkeySignIn(h, auth, credentialId, "device-bare", { flags: BARE });
    expect(plain.kind).toBe("session");
    if (plain.kind !== "session") throw new Error("unreachable");
    expect(plain.issued.session.factors).toEqual({ passkey: h.now().getTime() });
    expect(h.deps.sessions.level(plain.issued.session)).toBe(1);

    const secret = newTotpSecret();
    withTotp(h, ada.user.id, secret);
    const pending = await passkeySignIn(h, auth, credentialId, "device-bare", { flags: BARE });
    expect(pending.kind).toBe("mfa");
    if (pending.kind !== "mfa") throw new Error("unreachable");
    const signed = await verifyMfa(h.deps, { mfaTicket: pending.mfaTicket, code: hotp(secret, currentStep(h.now().getTime())) }, h.ctx);
    expect(Object.keys(signed.issued.session.factors).sort()).toEqual(["passkey", "totp"]);
    // The same passkey with the user verified skips the step.
    expect((await passkeySignIn(h, auth, credentialId, "device-bare", { flags: ALL })).kind).toBe("session");
  });

  test("a staff account with TOTP always goes to the TOTP step, even with a user-verified passkey", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, ALL);
    withTotp(h, ada.user.id, newTotpSecret());
    h.users.get(ada.user.id)!.role = "moderator";
    expect((await passkeySignIn(h, auth, credentialId, "device-staff")).kind).toBe("mfa");
  });

  test("a staff account without TOTP signs in directly, as with an email code", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, ALL);
    h.users.get(ada.user.id)!.role = "admin";
    const outcome = await passkeySignIn(h, auth, credentialId, "device-staff");
    expect(outcome.kind).toBe("session");
  });

  test("an account without TOTP signs in directly; a user-verified passkey is level 2, a plain one level 1", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const uv = new SoftAuthenticator();
    const plain = new SoftAuthenticator();
    const uvId = await registerPasskey(h, ada.session, uv, ALL);
    const plainId = await registerPasskey(h, ada.session, plain, BARE);

    const withUv = await passkeySignIn(h, uv, uvId, "device-a");
    expect(withUv.kind === "session" && h.deps.sessions.level(withUv.issued.session)).toBe(2);
    const withoutUv = await passkeySignIn(h, plain, plainId, "device-b");
    expect(withoutUv.kind === "session" && h.deps.sessions.level(withoutUv.issued.session)).toBe(1);
  });

  test("an unknown credential, a mismatched user handle and a deleted account are all passkey_invalid", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, ALL);

    // A credential korbat never stored: its holder answers, but no row names it.
    const orphan = new SoftAuthenticator();
    const orphanReg = orphan.create({ rpId: RP_ID, challenge: (await signInOptions(h.deps, h.ctx)).options.challenge, origin: ORIGIN, userHandle: randomBytes(32), flags: ALL });
    expect(await failure(passkeySignIn(h, orphan, orphanReg.id, "device-x"))).toMatchObject({ code: "passkey_invalid", status: 401 });

    // The right credential, but a user handle that is not this account's.
    expect(await failure(passkeySignIn(h, auth, credentialId, "device-x", { userHandle: randomBytes(32) }))).toMatchObject({ code: "passkey_invalid", status: 401 });

    // The account is gone.
    await h.deps.repo.markDeleted(ada.user.id, h.now());
    expect(await failure(passkeySignIn(h, auth, credentialId, "device-x"))).toMatchObject({ code: "passkey_invalid", status: 401 });
  });

  test("the options name no account, so the assertion must: without the user handle, or on an account that has none, the sign-in is passkey_invalid before the signature is looked at; a re-authentication, whose session names the account, takes the same assertion", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, ALL);

    const { options } = await signInOptions(h.deps, h.ctx);
    const withoutHandle = auth.get({ credentialId, rpId: RP_ID, challenge: options.challenge, origin: ORIGIN, flags: ALL, counter: 1, userHandle: null });
    expect("userHandle" in withoutHandle.response).toBe(false);
    expect(await failure(signInVerify(h.deps, { deviceId: "device-a", platform: "web", response: withoutHandle }, h.ctx))).toMatchObject({ code: "passkey_invalid", status: 401 });
    // Nothing moved: the passkey was not used, and no session, device or event came of it.
    expect(h.passkeys[0]).toMatchObject({ counter: 0, lastUsedAt: null, suspectAt: null });
    expect(h.sessions).toHaveLength(1);
    expect(h.devices).toHaveLength(1);
    expect(h.events.map((e) => e.type)).toEqual(["passkey_added"]);

    // The handle is checked before the library runs: a suspended passkey, which a verified signature would name as such, stays unnamed.
    await h.deps.repo.suspectPasskey(h.passkeys[0]!.id, h.now());
    expect(await failure(passkeySignIn(h, auth, credentialId, "device-a", { userHandle: null }))).toMatchObject({ code: "passkey_invalid", status: 401 });
    expect(await failure(passkeySignIn(h, auth, credentialId, "device-a"))).toMatchObject({ code: "passkey_suspended", status: 403 });
    h.passkeys[0]!.suspectAt = null;

    // Re-authentication has an allow list and a session, and there the handle may be absent: the same kind of assertion answers.
    const reauth = await reauthOptions(h.deps, ada.session);
    const response = auth.get({ credentialId, rpId: RP_ID, challenge: reauth.options.challenge, origin: ORIGIN, flags: ALL, counter: 2, userHandle: null });
    expect("userHandle" in response.response).toBe(false);
    const result = await reauthenticate(h.deps, ada.session, { method: "passkey", response }, h.ctx);
    expect(result.level).toBe(2);
    expect(result.issued.session.factors.passkey_uv).toBe(h.now().getTime());

    // With its handle the passkey signs in; on an account whose handle is gone, no handle an assertion carries is the account's.
    expect((await passkeySignIn(h, auth, credentialId, "device-a", { counter: 3 })).kind).toBe("session");
    h.users.get(ada.user.id)!.webauthnUserId = null;
    expect(await failure(passkeySignIn(h, auth, credentialId, "device-a", { counter: 4 }))).toMatchObject({ code: "passkey_invalid", status: 401 });
    expect(await failure(passkeySignIn(h, auth, credentialId, "device-a", { counter: 4, userHandle: null }))).toMatchObject({ code: "passkey_invalid", status: 401 });
    expect(h.passkeys[0]!.counter).toBe(3);
  });

  test("a challenge answers once: a replayed assertion is passkey_invalid", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, ALL);
    const { options } = await signInOptions(h.deps, h.ctx);
    const response = auth.get({ credentialId, rpId: RP_ID, challenge: options.challenge, origin: ORIGIN, flags: ALL, counter: 0 });
    expect((await signInVerify(h.deps, { deviceId: "device-a", platform: "web", response }, h.ctx)).kind).toBe("session");
    expect(await failure(signInVerify(h.deps, { deviceId: "device-a", platform: "web", response }, h.ctx))).toMatchObject({ code: "passkey_invalid", status: 401 });
  });

  test("allows 20 verifications per IP per 15 minutes, counted before the challenge, then rate_limited", async () => {
    const h = memoryFlowHarness();
    expect(SIGNIN_VERIFY_PER_IP).toBe(20);
    const orphan = new SoftAuthenticator();
    const reg = orphan.create({ rpId: RP_ID, challenge: (await signInOptions(h.deps, h.ctx)).options.challenge, origin: ORIGIN, userHandle: randomBytes(32), flags: ALL });
    // A bogus challenge is refused at the MAC check, before it is spent, so the same response counts each time.
    const bogus = orphan.get({ credentialId: reg.id, rpId: RP_ID, challenge: "not-a-real-challenge", origin: ORIGIN, flags: ALL, counter: 0 });
    for (let i = 0; i < SIGNIN_VERIFY_PER_IP; i++) {
      expect(await failure(signInVerify(h.deps, { deviceId: "device-a", platform: "web", response: bogus }, h.ctx))).toMatchObject({ code: "passkey_invalid" });
    }
    expect(await failure(signInVerify(h.deps, { deviceId: "device-a", platform: "web", response: bogus }, h.ctx))).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: (15 * MINUTE) / 1000 });
  });
});

describe("the passkey counter rule at sign-in (1c design, section 2)", () => {
  test("two zeros pass repeatedly, as a synced passkey always sends", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, ALL);
    for (let i = 0; i < 3; i++) expect((await passkeySignIn(h, auth, credentialId, "device-a", { counter: 0 })).kind).toBe("session");
    expect(h.passkeys[0]!.counter).toBe(0);
    expect(h.passkeys[0]!.suspectAt).toBeNull();
    expect(h.passkeys[0]!.lastUsedAt).toEqual(h.now());
  });

  test("a counter that went backwards after a verified signature suspends the passkey, mails the owner and refuses; a later sign-in is then passkey_suspended, and a bad signature never reveals that", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, ALL);
    // A counter that moves forward is stored.
    expect((await passkeySignIn(h, auth, credentialId, "device-a", { counter: 5 })).kind).toBe("session");
    expect(h.passkeys[0]!.counter).toBe(5);

    // A counter that regresses is caught after the signature: suspect, recorded, mailed and refused.
    expect(await failure(passkeySignIn(h, auth, credentialId, "device-a", { counter: 3 }))).toMatchObject({ code: "passkey_invalid", status: 401 });
    expect(h.passkeys[0]!.suspectAt).toEqual(h.now());
    expect(h.events.filter((e) => e.type === "passkey_counter_regression")).toEqual([{ userId: ada.user.id, type: "passkey_counter_regression", deviceId: null, metadata: { passkeyId: h.passkeys[0]!.id } }]);
    expect(h.mailer.sent.filter((m) => m.template === "passkey_suspect")).toEqual([{ to: "ada@korbat.local", template: "passkey_suspect", data: { name: h.passkeys[0]!.name } }]);

    // From now on a good signature is passkey_suspended, but only after the signature checks.
    expect(await failure(passkeySignIn(h, auth, credentialId, "device-a", { counter: 9 }))).toMatchObject({ code: "passkey_suspended", status: 403 });
    // A response the library will not verify is passkey_invalid, never passkey_suspended: the state is not revealed before the signature.
    expect(await failure(passkeySignIn(h, auth, credentialId, "device-a", { counter: 9, tamper: true }))).toMatchObject({ code: "passkey_invalid", status: 401 });
  });
});

describe("the new-device limit at passkey sign-in (1c design, section 7.4)", () => {
  test("counts only devices the account has not used, only after a verified signature, and refuses beyond five an hour", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, ALL);
    expect(SIGNIN_NEW_DEVICE_PER_HOUR).toBe(5);

    // A failed sign-in from a new device does not count: an unknown credential answered before any device was seen.
    const orphan = new SoftAuthenticator();
    const reg = orphan.create({ rpId: RP_ID, challenge: (await signInOptions(h.deps, h.ctx)).options.challenge, origin: ORIGIN, userHandle: randomBytes(32), flags: ALL });
    await failure(passkeySignIn(h, orphan, reg.id, "new-0"));
    // Nor does the account's own credential under a signature the library refuses, from as many new devices as the hour
    // allows: the count comes after the signature, so naming a real credential id without its key spends nothing.
    for (let i = 0; i < SIGNIN_NEW_DEVICE_PER_HOUR; i++) {
      expect(await failure(passkeySignIn(h, auth, credentialId, `forged-${i}`, { tamper: true }))).toMatchObject({ code: "passkey_invalid", status: 401 });
    }
    for (const window of ["hour", "day"]) expect(await h.kv.get(`rl:passkey-signin-new-device:${window}:${ada.user.id}`), window).toBeNull();
    expect(h.devices).toHaveLength(1);

    // Five new devices are allowed; the sixth new device is refused.
    for (let i = 0; i < SIGNIN_NEW_DEVICE_PER_HOUR; i++) expect((await passkeySignIn(h, auth, credentialId, `new-${i}`)).kind).toBe("session");
    expect(await failure(passkeySignIn(h, auth, credentialId, "new-6"))).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: HOUR / 1000 });
    // Past the bound a forged answer from a new device is still told it is invalid, not that the account is limited:
    // the signature is looked at first.
    expect(await failure(passkeySignIn(h, auth, credentialId, "forged-after", { tamper: true }))).toMatchObject({ code: "passkey_invalid", status: 401 });

    // A device the account already used never counts, so it keeps working past the bound.
    for (let i = 0; i < 3; i++) expect((await passkeySignIn(h, auth, credentialId, "new-0")).kind).toBe("session");
  });

  test("refuses beyond twenty new devices a day, however they are spread over the hours, until a day after the first of them", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, ALL);
    expect(SIGNIN_NEW_DEVICE_PER_DAY).toBe(20);
    expect(SIGNIN_NEW_DEVICE_PER_DAY % SIGNIN_NEW_DEVICE_PER_HOUR).toBe(0);

    // Five an hour, the most an hour allows, four hours running; each pause lets the hour's bucket run out.
    const pause = HOUR + MINUTE;
    const hours = SIGNIN_NEW_DEVICE_PER_DAY / SIGNIN_NEW_DEVICE_PER_HOUR;
    for (let hour = 0; hour < hours; hour++) {
      for (let i = 0; i < SIGNIN_NEW_DEVICE_PER_HOUR; i++) expect((await passkeySignIn(h, auth, credentialId, `hour-${hour}-device-${i}`)).kind, `hour ${hour}, device ${i}`).toBe("session");
      h.advance(pause);
    }
    expect(await h.kv.get(`rl:passkey-signin-new-device:day:${ada.user.id}`)).toBe(String(SIGNIN_NEW_DEVICE_PER_DAY));
    // The hour has room again, the day has not: the twenty-first new device is refused until the day is over.
    expect(await failure(passkeySignIn(h, auth, credentialId, "one-too-many"))).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: (24 * HOUR) / 1000 });
    expect(h.devices).toHaveLength(1 + SIGNIN_NEW_DEVICE_PER_DAY);
    // A device the account already used is not counted, so it still signs in.
    expect((await passkeySignIn(h, auth, credentialId, "hour-0-device-0")).kind).toBe("session");
    // The day is counted from the first new device: a millisecond before its end the bound holds, at its end it is over.
    h.advance(24 * HOUR - hours * pause - 1);
    expect(await failure(passkeySignIn(h, auth, credentialId, "still-too-many"))).toMatchObject({ code: "rate_limited", status: 429 });
    h.advance(1);
    expect((await passkeySignIn(h, auth, credentialId, "next-day")).kind).toBe("session");
  });
});

describe("passkey re-authentication (1c design, section 7.2)", () => {
  test("options list the account's usable passkeys, leaving a suspect one out, with a challenge bound to the session", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const good = new SoftAuthenticator();
    const bad = new SoftAuthenticator();
    await registerPasskey(h, ada.session, good, ALL);
    await registerPasskey(h, ada.session, bad, ALL);
    const suspect = h.passkeys[1]!;
    await h.deps.repo.suspectPasskey(suspect.id, h.now());

    const { options } = await reauthOptions(h.deps, ada.session);
    expect(options.allowCredentials!.map((c) => c.id)).toEqual([h.passkeys[0]!.credentialId]);
    expect(options.challenge).toMatch(/^[A-Za-z0-9_-]{78}$/);
    expect(options.rpId).toBe(RP_ID);
    // The challenge is sealed for re-authentication with this session's handle: it reads with that handle and with no
    // other, not with another session's of the same account, not without one, and not as a sign-in challenge.
    const key = challengeKey(h.deps.config.authHmacKey);
    const refusal = (read: () => void): unknown => {
      try {
        read();
      } catch (err) {
        return err;
      }
      return undefined;
    };
    expect(refusal(() => readChallenge(key, options.challenge, "reauth", h.now(), ada.session.handle))).toBeUndefined();
    for (const handle of [h.session(ada.user.id).handle, undefined]) {
      expect(refusal(() => readChallenge(key, options.challenge, "reauth", h.now(), handle)), String(handle)).toMatchObject({ code: "passkey_invalid", status: 401 });
    }
    expect(refusal(() => readChallenge(key, options.challenge, "signin", h.now()))).toMatchObject({ code: "passkey_invalid", status: 401 });
  });

  test("a re-authentication challenge answers only on the session it was issued to: another session of the same account is passkey_invalid, and the owner's session still answers it at level 2", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const other = h.session(ada.user.id);
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, ALL);
    const { options } = await reauthOptions(h.deps, ada.session);
    const response = auth.get({ credentialId, rpId: RP_ID, challenge: options.challenge, origin: ORIGIN, flags: ALL, counter: 1 });

    // The same account and its own passkey: the session's handle is what does not match.
    expect(await failure(reauthenticate(h.deps, other, { method: "passkey", response }, h.ctx))).toMatchObject({ code: "passkey_invalid", status: 401 });
    expect(h.passkeys[0]).toMatchObject({ counter: 0, lastUsedAt: null, suspectAt: null });
    const otherRow = h.sessions.find((s) => s.handle === other.handle)!;
    expect([otherRow.id, otherRow.factors, otherRow.reauthAt]).toEqual([other.sessionId, other.factors, other.reauthAt]);

    // The refusal came before the challenge was spent, so the session it belongs to still answers it, once.
    const result = await reauthenticate(h.deps, ada.session, { method: "passkey", response }, h.ctx);
    expect(result.level).toBe(2);
    expect(result.issued.session.handle).toBe(ada.session.handle);
    expect(result.issued.session.factors.passkey_uv).toBe(h.now().getTime());
    expect(h.passkeys[0]).toMatchObject({ counter: 1, lastUsedAt: h.now() });
    expect(await failure(reauthenticate(h.deps, result.issued.session, { method: "passkey", response }, h.ctx))).toMatchObject({ code: "passkey_invalid", status: 401 });
  });

  test("a passkey of another account is refused and its counter is left untouched", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const bob = h.user("bob@korbat.local");
    const adaAuth = new SoftAuthenticator();
    const adaCredential = await registerPasskey(h, ada.session, adaAuth, ALL);
    // ada's passkey has a counter on the record.
    await passkeySignIn(h, adaAuth, adaCredential, "device-a", { counter: 7 });
    const before = { ...h.passkeys.find((p) => p.credentialId === adaCredential)! };

    // bob asks for a re-authentication challenge, then answers it with ada's credential.
    const { options } = await reauthOptions(h.deps, bob.session);
    const response = adaAuth.get({ credentialId: adaCredential, rpId: RP_ID, challenge: options.challenge, origin: ORIGIN, flags: ALL, counter: 20 });
    expect(await failure(reauthenticate(h.deps, bob.session, { method: "passkey", response }, h.ctx))).toMatchObject({ code: "passkey_invalid", status: 401 });
    // ada's passkey never moved: the lookup with bob's user never found it.
    const after = h.passkeys.find((p) => p.credentialId === adaCredential)!;
    expect(after.counter).toBe(before.counter);
    expect(after.lastUsedAt).toEqual(before.lastUsedAt);
    expect(after.suspectAt).toBeNull();
  });

  test("a user-verified passkey re-authentication gives level 2 on an account with TOTP, rotating the token in place", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, ALL);
    withTotp(h, ada.user.id, newTotpSecret());

    const { options } = await reauthOptions(h.deps, ada.session);
    const response = auth.get({ credentialId, rpId: RP_ID, challenge: options.challenge, origin: ORIGIN, flags: ALL, counter: 0 });
    const result = await reauthenticate(h.deps, ada.session, { method: "passkey", response }, h.ctx);
    expect(result.level).toBe(2);
    expect(result.mustReenrollMfa).toBe(false);
    // The token rotated in place: same handle, the passkey_uv factor written.
    expect(result.issued.session.handle).toBe(ada.session.handle);
    expect(result.issued.session.factors.passkey_uv).toBe(h.now().getTime());
    expect(h.passkeys[0]!.lastUsedAt).toEqual(h.now());
  });

  test("the passkey helper answers passkey_uv only when this assertion verified the user and the passkey was registered with user verification; either half missing, it answers passkey", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const uv = new SoftAuthenticator();
    const plain = new SoftAuthenticator();
    const uvId = await registerPasskey(h, ada.session, uv, ALL);
    const plainId = await registerPasskey(h, ada.session, plain, BARE);

    const optionsA = (await reauthOptions(h.deps, ada.session)).options;
    const uvResponse = uv.get({ credentialId: uvId, rpId: RP_ID, challenge: optionsA.challenge, origin: ORIGIN, flags: ALL, counter: 0 });
    expect(await reauthenticatePasskey(h.deps, ada.session, ada.user, uvResponse, h.now())).toBe("passkey_uv");

    // Registered without user verification: a verified assertion is still one factor.
    const optionsB = (await reauthOptions(h.deps, ada.session)).options;
    const plainResponse = plain.get({ credentialId: plainId, rpId: RP_ID, challenge: optionsB.challenge, origin: ORIGIN, flags: ALL, counter: 0 });
    expect(await reauthenticatePasskey(h.deps, ada.session, ada.user, plainResponse, h.now())).toBe("passkey");

    // Registered with user verification, asserted without it: one factor too.
    const optionsC = (await reauthOptions(h.deps, ada.session)).options;
    const bareResponse = uv.get({ credentialId: uvId, rpId: RP_ID, challenge: optionsC.challenge, origin: ORIGIN, flags: BARE, counter: 0 });
    expect(await reauthenticatePasskey(h.deps, ada.session, ada.user, bareResponse, h.now())).toBe("passkey");
  });

  test("a re-authentication with a passkey registered with user verification but asserted without it writes the factor passkey: level 1, and on an account with TOTP not the level 2 its routes ask for", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, ALL);
    withTotp(h, ada.user.id, newTotpSecret());
    // Ten minutes on, the sign-in's own factor is out of the window: what this re-authentication proves is all the session holds.
    h.advance(10 * MINUTE);

    const { options } = await reauthOptions(h.deps, ada.session);
    const response = auth.get({ credentialId, rpId: RP_ID, challenge: options.challenge, origin: ORIGIN, flags: BARE, counter: 0 });
    const result = await reauthenticate(h.deps, ada.session, { method: "passkey", response }, h.ctx);
    expect(result.level).toBe(1);
    expect(result.issued.session.factors).toEqual({ ...ada.session.factors, passkey: h.now().getTime() });
    expect(h.deps.sessions.reauthNeeded(result.issued.session, h.deps.sessions.requiredLevel(result.issued.session))).toEqual({ level: 2, have: ["passkey"] });
  });
});
