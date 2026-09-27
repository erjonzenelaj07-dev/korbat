import type { NotMeRequest } from "@korbat/contracts";
import { AuthError, type AuthDeps, type RequestContext } from "../context";
import { emailHash } from "../identifiers";
import { HOUR, enforceLimit } from "../limits";
import { lockdown } from "./lockdown";
import { NOT_ME_TTL_MS, notMeKey, type NotMeToken } from "./signin";

const LINK_GONE = "This link has expired or was already used.";

/**
 * "This wasn't me" from a new-device email: the lockdown (1c design, section 7.6) anchored at the sign-in the alert
 * announced, naming the passkey that signed in, if one did. The link is taken once, for 24 hours, and does nothing but
 * refuse when the account is gone or its address is no longer the one the alert went to: a link mailed to an attacker's
 * address dies when the owner's is restored. A link from before 1c (no sign-in time, or the bare user id) is anchored
 * at its use minus its 24-hour life, so it removes more, never less, and checks no address.
 */
export async function notMe(deps: AuthDeps, input: NotMeRequest, ctx: RequestContext): Promise<void> {
  await enforceLimit(deps.kv, `not-me:ip:${ctx.ipHash}`, 10, HOUR);
  const raw = await deps.kv.take(notMeKey(input.token));
  if (!raw) throw new AuthError("invalid_code", 400, LINK_GONE);
  const link: NotMeToken = raw.startsWith("{") ? (JSON.parse(raw) as NotMeToken) : { userId: raw, deviceId: null };
  const user = await deps.repo.findUserById(link.userId);
  if (!user) throw new AuthError("invalid_code", 400, LINK_GONE);
  if (link.sentTo !== undefined && link.sentTo !== emailHash(deps.config.authHmacKey, user.email)) throw new AuthError("invalid_code", 400, LINK_GONE);
  const anchor = link.signedInAt === undefined ? new Date(deps.now().getTime() - NOT_ME_TTL_MS) : new Date(link.signedInAt);
  await lockdown(deps, { userId: user.id, anchor, passkeyIds: link.passkeyId ? [link.passkeyId] : [], caller: { type: "not_me", deviceId: link.deviceId }, ctx });
}
