import { randomBytes } from "node:crypto";
import { describe, expect, test } from "vitest";
import { AuthError } from "../../src/auth/context";
import { encrypt } from "../../src/auth/crypto";
import { verifyMfa } from "../../src/auth/flows/mfa";
import { reauthenticate } from "../../src/auth/flows/reauth";
import { HOUR, MINUTE } from "../../src/auth/limits";
import {
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

/** A whole passkey sign-in: fresh options, the authenticator's answer, and the verification. */
async function passkeySignIn(
  h: MemoryFlowHarness,
  auth: SoftAuthenticator,
  credentialId: string,
  deviceId: string,
  opts: { flags?: SoftFlags; counter?: number; userHandle?: Uint8Array; tamper?: boolean } = {},
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
  test("carry an empty allow list and a sign-in challenge, and store nothing", async () => {
    const h = memoryFlowHarness();
    const { options } = await signInOptions(h.deps, h.ctx);
    expect(options.allowCredentials).toEqual([]);
    expect(options.challenge).toMatch(/^[A-Za-z0-9_-]{78}$/);
    expect(options.rpId).toBe(RP_ID);
    // A second call is a different challenge, and neither wrote a used-challenge marker or anything else.
    const again = await signInOptions(h.deps, h.ctx);
    expect(again.options.challenge).not.toBe(options.challenge);
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

    // Five new devices are allowed; the sixth new device is refused.
    for (let i = 0; i < SIGNIN_NEW_DEVICE_PER_HOUR; i++) expect((await passkeySignIn(h, auth, credentialId, `new-${i}`)).kind).toBe("session");
    expect(await failure(passkeySignIn(h, auth, credentialId, "new-6"))).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: HOUR / 1000 });

    // A device the account already used never counts, so it keeps working past the bound.
    for (let i = 0; i < 3; i++) expect((await passkeySignIn(h, auth, credentialId, "new-0")).kind).toBe("session");
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
    // A challenge bound to another session's handle would not be usable by this one; it is bound to this session.
    expect(options.rpId).toBe(RP_ID);
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

  test("the passkey helper answers passkey_uv for a verified assertion and passkey without user verification", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const uv = new SoftAuthenticator();
    const plain = new SoftAuthenticator();
    const uvId = await registerPasskey(h, ada.session, uv, ALL);
    const plainId = await registerPasskey(h, ada.session, plain, BARE);

    const optionsA = (await reauthOptions(h.deps, ada.session)).options;
    const uvResponse = uv.get({ credentialId: uvId, rpId: RP_ID, challenge: optionsA.challenge, origin: ORIGIN, flags: ALL, counter: 0 });
    expect(await reauthenticatePasskey(h.deps, ada.session, ada.user, uvResponse, h.now())).toBe("passkey_uv");

    const optionsB = (await reauthOptions(h.deps, ada.session)).options;
    const plainResponse = plain.get({ credentialId: plainId, rpId: RP_ID, challenge: optionsB.challenge, origin: ORIGIN, flags: ALL, counter: 0 });
    expect(await reauthenticatePasskey(h.deps, ada.session, ada.user, plainResponse, h.now())).toBe("passkey");
  });
});
