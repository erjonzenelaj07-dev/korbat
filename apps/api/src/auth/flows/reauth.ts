import type { ReauthRequest } from "@korbat/contracts";
import { AuthError, type AuthDeps, type RequestContext } from "../context";
import { randomToken } from "../crypto";
import { HOUR, MINUTE, enforceLimit } from "../limits";
import { reauthenticatePasskey } from "../passkeys/flows";
import { verifyPassword } from "../passwords";
import { hashRecoveryCode } from "../recovery-codes";
import type { FactorKind, IssuedSession, Session } from "../sessions";
import { verifyTotp } from "../totp";
import { CODE_TTL_MS, checkEmailCode, emailCodeHash, newEmailCode, sendCode } from "./email";
import { storedSecret } from "./mfa";
import { notifyAccount } from "./notify";

/** What a re-authentication leaves: the level the session holds now, its rotated token, and after a recovery code the call to set MFA up again. */
export interface Reauthenticated {
  level: 1 | 2;
  issued: IssuedSession;
  mustReenrollMfa: boolean;
}

/**
 * Sends a code that can only re-authenticate this account (never sign anyone in). Three an hour per session, counted by
 * the handle: a rotation keeps it, so rotating resets nothing, and no other session of the account can spend it.
 */
export async function startReauthEmail(deps: AuthDeps, session: Session, ctx: RequestContext): Promise<{ flowId: string }> {
  await enforceLimit(deps.kv, `reauth-email:${session.handle}`, 3, HOUR);
  const user = await deps.repo.findUserById(session.userId);
  if (!user) throw new AuthError("invalid_credentials", 401);
  const flowId = randomToken();
  const code = newEmailCode();
  await deps.repo.createEmailCode({
    flowId,
    email: user.email,
    userId: user.id,
    purpose: "reauth",
    codeHash: emailCodeHash(deps.config.authHmacKey, flowId, code),
    expiresAt: new Date(deps.now().getTime() + CODE_TTL_MS),
    ipHash: ctx.ipHash,
  });
  await sendCode(deps, { to: user.email, template: "reauth_code", data: { code } });
  return { flowId };
}

/**
 * Proves a credential again (1c design, sections 7.1 and 7.2): the factor is written at the flows' clock, so freshness
 * and the level follow from the factors, and the token rotates in place, so a copy of the old token stops working.
 * Five tries per session every 15 minutes, counted at every verification and by the session's handle, and thirty per
 * address; wrong passwords also count towards the lockout.
 */
export async function reauthenticate(deps: AuthDeps, session: Session, input: ReauthRequest, ctx: RequestContext): Promise<Reauthenticated> {
  await enforceLimit(deps.kv, `reauth:${session.handle}`, 5, 15 * MINUTE);
  await enforceLimit(deps.kv, `reauth:ip:${ctx.ipHash}`, 30, 15 * MINUTE);
  const user = await deps.repo.findUserById(session.userId);
  if (!user) throw new AuthError("invalid_credentials", 401);

  let kind: FactorKind;
  let mustReenrollMfa = false;
  switch (input.method) {
    case "password": {
      const usable = user.passwordHash !== null && !deps.lockout.isLocked(user);
      const ok = await verifyPassword(usable ? user.passwordHash : null, input.password);
      if (!ok) {
        if (usable) await deps.lockout.recordFailure(user.id);
        throw new AuthError("invalid_credentials", 401);
      }
      await deps.lockout.recordSuccess(user.id);
      kind = "password";
      break;
    }
    case "totp": {
      const secret = await storedSecret(deps, user);
      const step = verifyTotp(secret, input.code, user.totpLastStep, deps.now().getTime());
      if (step === null || !(await deps.repo.claimTotpStep(user.id, step))) throw new AuthError("invalid_mfa_code", 401);
      kind = "totp";
      break;
    }
    case "email": {
      const row = await deps.repo.findEmailCode(input.flowId);
      if (row?.purpose !== "reauth" || row.userId !== user.id) throw new AuthError("invalid_code", 400);
      await checkEmailCode(deps, row, input.flowId, input.code);
      kind = "email";
      break;
    }
    case "recovery": {
      // Only an account with TOTP holds recovery codes, and each works once (1c design, section 7.2).
      if (!user.totpEnabledAt) throw new AuthError("mfa_required", 400);
      const consumed = await deps.repo.consumeRecoveryCodeHash(user.id, hashRecoveryCode(deps.config.authHmacKey, input.recoveryCode));
      if (!consumed) {
        await deps.repo.appendEvent({ userId: user.id, type: "signin_failure", ipHash: ctx.ipHash, metadata: { method: "recovery_code" } });
        throw new AuthError("invalid_mfa_code", 401);
      }
      await deps.repo.appendEvent({ userId: user.id, type: "recovery_code_used", deviceId: session.deviceId, ipHash: ctx.ipHash });
      // A code spent is one fewer of ten; the owner hears of it as of every other change to their credentials.
      await notifyAccount(deps, user.email, "recovery_code_used");
      mustReenrollMfa = true;
      kind = "recovery";
      break;
    }
    case "passkey": {
      // The challenge, the lookup with the session's user, the signature, the suspect check and the counter write live
      // next to the sign-in flow (1c design, section 7.2); the buckets, the factor write, the rotation and the answer are ours.
      kind = await reauthenticatePasskey(deps, session, user, input.response, deps.now());
      break;
    }
  }

  await deps.sessions.addFactor(session.sessionId, kind);
  const issued = await deps.sessions.rotate(session);
  return { level: deps.sessions.level(issued.session), issued, mustReenrollMfa };
}
