import type { PasswordSetRequest, PasswordSigninRequest } from "@korbat/contracts";
import { AuthError, type AuthDeps, type RequestContext } from "../context";
import { MINUTE, enforceLimit } from "../limits";
import { LOCK_DURATION_MS } from "../lockout";
import { BreachCheckUnavailable, checkPasswordLength, hashPassword, verifyPassword } from "../passwords";
import type { IssuedSession, Session } from "../sessions";
import { firstFactorPassed, type MfaPending, type SignedIn } from "./signin";

/**
 * Password sign-in. Unknown emails, accounts without a password, locked accounts and wrong passwords
 * all run one full argon2 verification and return the same `invalid_credentials` error.
 */
export async function passwordSignIn(deps: AuthDeps, input: PasswordSigninRequest, ctx: RequestContext): Promise<SignedIn | MfaPending> {
  if (!(await deps.turnstile.verify(input.turnstileToken))) throw new AuthError("turnstile_failed", 403);
  await enforceLimit(deps.kv, `password-signin:ip:${ctx.ipHash}`, 20, 15 * MINUTE);

  const user = await deps.repo.findUserByEmail(input.email);
  if (!user || !user.passwordHash || deps.lockout.isLocked(user)) {
    await verifyPassword(null, input.password);
    throw new AuthError("invalid_credentials", 401);
  }

  if (!(await verifyPassword(user.passwordHash, input.password))) {
    const { locked } = await deps.lockout.recordFailure(user.id);
    await deps.repo.appendEvent({ userId: user.id, type: "signin_failure", ipHash: ctx.ipHash, metadata: { method: "password" } });
    if (locked) {
      await deps.repo.appendEvent({ userId: user.id, type: "account_locked", ipHash: ctx.ipHash });
      try {
        await deps.mailer.send({ to: user.email, template: "account_locked", data: { minutes: String(LOCK_DURATION_MS / MINUTE) } });
      } catch (err) {
        deps.log.error({ err, userId: user.id }, "lockout notice email failed");
      }
    }
    throw new AuthError("invalid_credentials", 401);
  }

  await deps.lockout.recordSuccess(user.id);
  return firstFactorPassed(deps, user, { deviceId: input.deviceId, platform: input.platform }, ctx);
}

/**
 * Sets or changes the password (the route requires fresh re-authentication). Length first, then the
 * breach check, which fails closed: when it cannot run, the password is not saved.
 */
export async function setPassword(deps: AuthDeps, session: Session, input: PasswordSetRequest): Promise<IssuedSession> {
  const lengthProblem = checkPasswordLength(input.password);
  if (lengthProblem) throw new AuthError(lengthProblem, 400);

  let breached: boolean;
  try {
    breached = await deps.breachChecker.isBreached(input.password);
  } catch (err) {
    if (err instanceof BreachCheckUnavailable) throw new AuthError("password_check_unavailable", 503);
    throw err;
  }
  if (breached) throw new AuthError("password_breached", 400);

  const user = await deps.repo.findUserById(session.userId);
  if (!user) throw new AuthError("invalid_credentials", 401);
  await deps.repo.setPasswordHash(user.id, await hashPassword(input.password), deps.now());
  await deps.repo.appendEvent({ userId: user.id, type: user.passwordHash ? "password_changed" : "password_set", deviceId: session.deviceId });
  return deps.sessions.rotate(session);
}
