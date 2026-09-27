import type { MfaVerifyRequest, TotpCodeRequest, TotpSetupResponse } from "@korbat/contracts";
import { AuthError, type AuthDeps, type RequestContext } from "../context";
import { decrypt, encrypt, payloadVersion } from "../crypto";
import { MINUTE, enforceLimit } from "../limits";
import { hashRecoveryCode, newRecoveryCodes } from "../recovery-codes";
import type { UserRow } from "../repo";
import type { FactorKind, IssuedSession, Session } from "../sessions";
import { newTotpSecret, totpQrSvg, totpUri, verifyTotp } from "../totp";
import { notifyAccount } from "./notify";
import { MFA_TICKET_TTL_MS, mfaTicketKey, signIn, type MfaTicket, type SignedIn } from "./signin";

export const TOTP_PENDING_TTL_MS = 10 * MINUTE;
export const MAX_MFA_ATTEMPTS = 5;

/** The pending secret of a setup, kept for the session's handle (1c design, section 2): a rotation keeps the handle, and no other session can confirm it. */
export const totpPendingKey = (handle: string) => `totp-pending:${handle}`;

/**
 * The account's TOTP secret. Previous keys are accepted so that TOTP_ENC_KEY can rotate; a secret
 * still encrypted with an earlier key is re-encrypted with the current one as soon as it is read.
 */
export async function storedSecret(deps: AuthDeps, user: UserRow): Promise<Uint8Array> {
  if (!user.totpSecretEnc) throw new AuthError("mfa_required", 400);
  const secret = decrypt(user.totpSecretEnc, [deps.config.totpKey, ...deps.config.totpPreviousKeys]);
  if (payloadVersion(user.totpSecretEnc) !== deps.config.totpKey.version) {
    await deps.repo.setTotpSecretEnc(user.id, encrypt(secret, deps.config.totpKey));
  }
  return new Uint8Array(secret);
}

/** Verifies a TOTP code and claims its time step atomically, so the same code cannot be used twice. */
async function acceptTotp(deps: AuthDeps, user: UserRow, code: string): Promise<boolean> {
  const step = verifyTotp(await storedSecret(deps, user), code, user.totpLastStep, deps.now().getTime());
  return step !== null && (await deps.repo.claimTotpStep(user.id, step));
}

/**
 * Starts setup with a new secret held encrypted for 10 minutes under the session's handle. Needs a fresh session, at
 * level 2 once the account has TOTP, since setup replaces the secret and the recovery codes (the route checks as well).
 */
export async function setupTotp(deps: AuthDeps, session: Session): Promise<TotpSetupResponse> {
  const needed = deps.sessions.reauthNeeded(session, deps.sessions.requiredLevel(session));
  if (needed) throw new AuthError("reauth_required", 403, undefined, undefined, needed);
  const secret = newTotpSecret();
  await deps.kv.set(totpPendingKey(session.handle), encrypt(Buffer.from(secret), deps.config.totpKey), TOTP_PENDING_TTL_MS);
  const profile = await deps.profiles.find(session.userId);
  const otpauthUri = totpUri(secret, profile?.handle ?? "account");
  return { otpauthUri, qrSvg: totpQrSvg(otpauthUri) };
}

const SETUP_EXPIRED = "Two-factor setup expired. Start again.";

/**
 * Turns MFA on with the pending secret its setup stored for this session's handle: no freshness check of its own, so
 * scanning the QR code cannot run the window out. Issues 10 recovery codes (shown once), writes the totp factor (the
 * code proved the new secret), drops every cached copy of the account's sessions so mfaEnabled is right, rotates the
 * token in place and tells the owner. The pending secret is read first, so a wrong code does not end the setup, and
 * spent once the code is right, before anything is written: of two confirmations at once (a double submit) one
 * turns two-factor on, and the other is refused before it could replace the recovery codes the first one shows.
 */
export async function confirmTotp(deps: AuthDeps, session: Session, input: TotpCodeRequest): Promise<{ recoveryCodes: string[]; issued: IssuedSession }> {
  const user = await deps.repo.findUserById(session.userId);
  if (!user) throw new AuthError("invalid_credentials", 401);
  const pendingKey = totpPendingKey(session.handle);
  const pending = await deps.kv.get(pendingKey);
  if (!pending) throw new AuthError("invalid_mfa_code", 400, SETUP_EXPIRED);
  const secret = new Uint8Array(decrypt(pending, [deps.config.totpKey]));
  const step = verifyTotp(secret, input.code, null, deps.now().getTime());
  if (step === null) throw new AuthError("invalid_mfa_code", 400);
  // Taken, and compared with what the code was checked against: gone means another confirmation spent it, and another
  // value means a newer setup replaced the secret this code proved.
  if ((await deps.kv.take(pendingKey)) !== pending) throw new AuthError("invalid_mfa_code", 400, SETUP_EXPIRED);

  const recoveryCodes = newRecoveryCodes();
  await deps.repo.enableTotp(session.userId, {
    secretEnc: pending,
    recoveryCodesHash: recoveryCodes.map((code) => hashRecoveryCode(deps.config.authHmacKey, code)),
    now: deps.now(),
  });
  await deps.repo.claimTotpStep(session.userId, step);
  await deps.repo.appendEvent({ userId: session.userId, type: "mfa_enabled", deviceId: session.deviceId });
  await deps.sessions.addFactor(session.sessionId, "totp");
  await deps.sessions.forgetUser(session.userId);
  const issued = await deps.sessions.rotate(session);
  await notifyAccount(deps, user.email, "mfa_enabled");
  return { recoveryCodes, issued };
}

/**
 * Second factor at sign-in: a TOTP code, or a recovery code (single use; the response then asks the
 * user to set up MFA again). A ticket allows five wrong attempts and issues at most one session.
 */
export async function verifyMfa(deps: AuthDeps, input: MfaVerifyRequest, ctx: RequestContext): Promise<SignedIn> {
  await enforceLimit(deps.kv, `mfa-verify:ip:${ctx.ipHash}`, 20, 15 * MINUTE);
  const key = mfaTicketKey(input.mfaTicket);
  const raw = await deps.kv.get(key);
  if (!raw) throw new AuthError("invalid_mfa_code", 401);
  const ticket = JSON.parse(raw) as MfaTicket;

  if ((await deps.kv.incr(`mfa-attempts:${key}`, MFA_TICKET_TTL_MS)) > MAX_MFA_ATTEMPTS) {
    await deps.kv.del(key);
    throw new AuthError("too_many_attempts", 429);
  }

  const user = await deps.repo.findUserById(ticket.userId);
  if (!user?.totpSecretEnc) throw new AuthError("invalid_mfa_code", 401);

  let mustReenrollMfa = false;
  let second: FactorKind;
  if ("code" in input) {
    if (!(await acceptTotp(deps, user, input.code))) {
      await deps.repo.appendEvent({ userId: user.id, type: "signin_failure", ipHash: ctx.ipHash, metadata: { method: "totp" } });
      throw new AuthError("invalid_mfa_code", 401);
    }
    second = "totp";
  } else {
    const consumed = await deps.repo.consumeRecoveryCodeHash(user.id, hashRecoveryCode(deps.config.authHmacKey, input.recoveryCode));
    if (!consumed) {
      await deps.repo.appendEvent({ userId: user.id, type: "signin_failure", ipHash: ctx.ipHash, metadata: { method: "recovery_code" } });
      throw new AuthError("invalid_mfa_code", 401);
    }
    mustReenrollMfa = true;
    second = "recovery";
  }

  if (!(await deps.kv.take(key))) throw new AuthError("invalid_mfa_code", 401);
  // The second factor joins the first step's, from the ticket, at this step's clock.
  const signed = await signIn(deps, user, { deviceId: ticket.deviceId, platform: ticket.platform }, ctx, {
    alertNewDevice: true,
    mustReenrollMfa,
    factors: { ...ticket.factors, [second]: deps.now().getTime() },
    method: ticket.method,
    passkeyId: ticket.passkeyId,
  });
  if (second === "recovery") {
    // Recorded with the device the session was issued on, whose row a first sign-in creates only in signIn (the ticket
    // holds the app's device id, not the row), and announced as the re-authentication path announces it: a code spent is
    // one fewer of ten, whichever path spent it.
    await deps.repo.appendEvent({ userId: user.id, type: "recovery_code_used", deviceId: signed.issued.session.deviceId, ipHash: ctx.ipHash });
    await notifyAccount(deps, user.email, "recovery_code_used");
  }
  return signed;
}

/**
 * Turns MFA off and tells the owner. No code: the route needs level 2, so a TOTP or recovery code was proven minutes ago
 * (1c design, section 2). Staff accounts can never turn it off.
 */
export async function disableTotp(deps: AuthDeps, session: Session): Promise<void> {
  if (session.role !== "user") throw new AuthError("staff_mfa_required", 403);
  const user = await deps.repo.findUserById(session.userId);
  if (!user?.totpSecretEnc) throw new AuthError("mfa_required", 400);
  await deps.repo.disableTotp(user.id);
  await deps.sessions.forgetUser(user.id);
  await deps.repo.appendEvent({ userId: user.id, type: "mfa_disabled", deviceId: session.deviceId });
  await notifyAccount(deps, user.email, "mfa_disabled");
}

/** Replaces all recovery codes (the route requires strong fresh auth) and tells the owner. The old codes stop working. */
export async function regenerateRecoveryCodes(deps: AuthDeps, session: Session): Promise<string[]> {
  const user = await deps.repo.findUserById(session.userId);
  if (!user?.totpEnabledAt) throw new AuthError("mfa_required", 400);
  const recoveryCodes = newRecoveryCodes();
  await deps.repo.setRecoveryCodes(user.id, recoveryCodes.map((code) => hashRecoveryCode(deps.config.authHmacKey, code)));
  await deps.repo.appendEvent({ userId: user.id, type: "recovery_codes_regenerated", deviceId: session.deviceId });
  await notifyAccount(deps, user.email, "recovery_codes_regenerated");
  return recoveryCodes;
}
