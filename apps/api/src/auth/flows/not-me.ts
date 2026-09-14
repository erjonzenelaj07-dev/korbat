import type { NotMeRequest } from "@korbat/contracts";
import { AuthError, type AuthDeps, type RequestContext } from "../context";
import { HOUR, enforceLimit } from "../limits";
import { notMeKey } from "./signin";

/**
 * "This wasn't me" from a new-device email: signs out every session and removes the password, so the
 * next sign-in needs the email inbox (and MFA when enabled). The link works once, for 24 hours.
 */
export async function notMe(deps: AuthDeps, input: NotMeRequest, ctx: RequestContext): Promise<void> {
  await enforceLimit(deps.kv, `not-me:ip:${ctx.ipHash}`, 10, HOUR);
  const userId = await deps.kv.take(notMeKey(input.token));
  if (!userId) throw new AuthError("invalid_code", 400, "This link has expired or was already used.");
  await deps.sessions.revokeAll(userId);
  await deps.repo.setPasswordHash(userId, null, deps.now());
  await deps.repo.appendEvent({ userId, type: "not_me", ipHash: ctx.ipHash });
}
