import type { ReauthRequest } from "@korbat/contracts";
import { AuthError, type AuthDeps, type RequestContext } from "../context";
import { randomToken } from "../crypto";
import { HOUR, MINUTE, enforceLimit } from "../limits";
import { verifyPassword } from "../passwords";
import type { Session } from "../sessions";
import { verifyTotp } from "../totp";
import { storedSecret } from "./mfa";
import { CODE_TTL_MS, checkEmailCode, emailCodeHash, newEmailCode, sendCode } from "./email";

/** Sends a code that can only re-authenticate this account (never sign anyone in). */
export async function startReauthEmail(deps: AuthDeps, session: Session, ctx: RequestContext): Promise<{ flowId: string }> {
  await enforceLimit(deps.kv, `reauth-email:${session.sessionId}`, 3, HOUR);
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
 * Proves possession of a credential again and renews the session's five-minute re-auth window.
 * Five attempts per session every 15 minutes; wrong passwords also count towards the lockout.
 */
export async function reauthenticate(deps: AuthDeps, session: Session, input: ReauthRequest): Promise<void> {
  await enforceLimit(deps.kv, `reauth:${session.sessionId}`, 5, 15 * MINUTE);
  const user = await deps.repo.findUserById(session.userId);
  if (!user) throw new AuthError("invalid_credentials", 401);

  switch (input.method) {
    case "password": {
      const usable = user.passwordHash !== null && !deps.lockout.isLocked(user);
      const ok = await verifyPassword(usable ? user.passwordHash : null, input.password);
      if (!ok) {
        if (usable) await deps.lockout.recordFailure(user.id);
        throw new AuthError("invalid_credentials", 401);
      }
      await deps.lockout.recordSuccess(user.id);
      break;
    }
    case "totp": {
      const secret = await storedSecret(deps, user);
      const step = verifyTotp(secret, input.code, user.totpLastStep, deps.now().getTime());
      if (step === null || !(await deps.repo.claimTotpStep(user.id, step))) throw new AuthError("invalid_mfa_code", 401);
      break;
    }
    case "email": {
      const row = await deps.repo.findEmailCode(input.flowId);
      if (row?.purpose !== "reauth" || row.userId !== user.id) throw new AuthError("invalid_code", 400);
      await checkEmailCode(deps, row, input.flowId, input.code);
      break;
    }
  }

  await deps.sessions.markReauth(session.sessionId);
}
