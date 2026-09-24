import type { NotMeRequest } from "@korbat/contracts";
import { AuthError, type AuthDeps, type RequestContext } from "../context";
import { HOUR, enforceLimit } from "../limits";
import { notMeKey, type NotMeToken } from "./signin";

/**
 * "This wasn't me" from a new-device email: signs out every session, revokes the device the alert was
 * about (its next sign-in counts as a new device again) and removes the password, so the next sign-in
 * needs the email inbox (and MFA when enabled). The link works once, for 24 hours.
 */
export async function notMe(deps: AuthDeps, input: NotMeRequest, ctx: RequestContext): Promise<void> {
  await enforceLimit(deps.kv, `not-me:ip:${ctx.ipHash}`, 10, HOUR);
  const raw = await deps.kv.take(notMeKey(input.token));
  if (!raw) throw new AuthError("invalid_code", 400, "This link has expired or was already used.");
  const link: NotMeToken = raw.startsWith("{") ? (JSON.parse(raw) as NotMeToken) : { userId: raw, deviceId: null };
  await deps.sessions.revokeAll(link.userId);
  if (link.deviceId) await deps.repo.revokeDevice(link.deviceId, deps.now());
  await deps.repo.setPasswordHash(link.userId, null, deps.now());
  await deps.repo.appendEvent({ userId: link.userId, type: "not_me", deviceId: link.deviceId, ipHash: ctx.ipHash });
}
