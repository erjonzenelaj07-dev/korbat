import type { BadgeStartRequest, BadgeVerifyRequest, BadgeVerifyResponse } from "@korbat/contracts";
import { AuthError, isUniqueViolation, type AuthDeps, type RequestContext } from "../context";
import { randomToken, sha256Hex } from "../crypto";
import { phoneHash } from "../identifiers";
import { HOUR, enforceLimit } from "../limits";
import type { Session } from "../sessions";
import { VerifyUnavailable, type VerificationProvider } from "../verify/provider";
import { CODE_TTL_MS, MAX_CODE_ATTEMPTS } from "./email";
import { notifyAccount } from "./notify";

export const BADGE_STARTS_PER_HOUR = 3;

/** A flow id is a bearer credential while its verification is pending, so the store holds only its hash. */
export const badgeKey = (flowId: string) => `badge:${sha256Hex(flowId)}`;

/**
 * The verification a code is out for, kept under the hashed flow id until the code is right, the
 * attempts are spent or the ten minutes pass. It holds the number only as its keyed hash, which is what
 * the account will store; the number itself went to the provider and nowhere else. The expiry is kept so
 * that counting an attempt can write the state back without extending its life.
 */
export interface PendingBadge {
  userId: string;
  phoneHash: string;
  reference: string;
  attempts: number;
  expiresAt: number;
}

/** The configured provider, or badge_unavailable (404) when VERIFY_PROVIDER is off; the app hides the section on that answer. */
function provider(deps: AuthDeps): VerificationProvider {
  if (!deps.verify) throw new AuthError("badge_unavailable", 404);
  return deps.verify;
}

/** A provider that could not be asked is verify_unavailable (503): the user tries again later. Anything else is a bug and stays a 500. */
function unavailable(err: unknown): never {
  if (err instanceof VerifyUnavailable) throw new AuthError("verify_unavailable", 503);
  throw err;
}

/**
 * Has the provider text a code to the number. The answer is the same whether or not another account
 * holds the number: the conflict is reported only once the code has proved that the requester holds the
 * phone (verifyBadge), so this step tells nobody which numbers are registered. The request context is
 * taken like every start flow's; nothing here records the address, and the number is never stored.
 */
export async function startBadge(deps: AuthDeps, session: Session, input: BadgeStartRequest, _ctx: RequestContext): Promise<{ flowId: string }> {
  const verify = provider(deps);
  const hashed = phoneHash(deps.config.authHmacKey, input.phone);
  await enforceLimit(deps.kv, `badge-start:${session.userId}`, BADGE_STARTS_PER_HOUR, HOUR);
  // Per number too, whoever asks, so one phone cannot be texted more than three times an hour through many accounts.
  await enforceLimit(deps.kv, `badge-start:phone:${hashed}`, BADGE_STARTS_PER_HOUR, HOUR);
  const { reference } = await verify.start(input.phone).catch(unavailable);
  const flowId = randomToken();
  const pending: PendingBadge = { userId: session.userId, phoneHash: hashed, reference, attempts: 0, expiresAt: deps.now().getTime() + CODE_TTL_MS };
  await deps.kv.set(badgeKey(flowId), JSON.stringify(pending), CODE_TTL_MS);
  return { flowId };
}

/**
 * Checks the code with the provider. Attempts are counted in the store before the provider is asked, as
 * the email codes count theirs, so a flow takes at most five codes whatever the provider answers. On
 * success the account's phone hash is written first (the partial unique index on it decides conflicts,
 * so a number another account verified is phone_in_use here and only here), then the profile's
 * verified_at, and the account is told.
 */
export async function verifyBadge(deps: AuthDeps, session: Session, input: BadgeVerifyRequest): Promise<BadgeVerifyResponse> {
  const verify = provider(deps);
  const key = badgeKey(input.flowId);
  const raw = await deps.kv.get(key);
  const pending = raw ? (JSON.parse(raw) as PendingBadge) : null;
  // A flow another account started, an unknown one and one whose ten minutes passed are all no code at all,
  // settled before an attempt is counted: nobody can spend another account's attempts.
  if (!pending || pending.userId !== session.userId) throw new AuthError("invalid_code", 400);
  // Written back with what is left of the original ten minutes, so an attempt never extends the flow. The
  // store drops the state itself at that moment; a straggler is treated like a flow that is gone.
  const remainingMs = pending.expiresAt - deps.now().getTime();
  if (remainingMs <= 0) throw new AuthError("invalid_code", 400);
  pending.attempts += 1;
  await deps.kv.set(key, JSON.stringify(pending), remainingMs);
  if (pending.attempts > MAX_CODE_ATTEMPTS) throw new AuthError("too_many_attempts", 429);

  const outcome = await verify.check(pending.reference, input.code).catch(unavailable);
  if (outcome === "invalid_code") throw new AuthError("invalid_code", 400);
  if (outcome === "code_expired") {
    // The provider has closed the request, so no code can be checked against it any more: the owner starts again.
    await deps.kv.del(key);
    throw new AuthError("code_expired", 400);
  }
  // The code was right and the provider has spent it: whatever happens next, this flow is over.
  await deps.kv.del(key);
  const user = await deps.repo.findUserById(session.userId);
  if (!user) throw new AuthError("invalid_credentials", 401);
  try {
    await deps.repo.setPhoneHash(user.id, pending.phoneHash);
  } catch (err) {
    if (isUniqueViolation(err)) throw new AuthError("phone_in_use", 409);
    throw err;
  }
  await deps.profiles.setVerified(user.id, deps.now());
  await notifyAccount(deps, user.email, "badge_verified");
  // No metadata: the event log never holds the number, not even hashed, since the hash leaves the account with the badge.
  await deps.repo.appendEvent({ userId: user.id, type: "badge_verified", deviceId: session.deviceId });
  return { verified: true };
}

/**
 * Drops the badge: the phone hash and verified_at are cleared, the account is told and the event
 * recorded. Without a badge nothing is said or recorded, but both columns are cleared anyway, which also
 * finishes a removal that stopped between its two writes. Works with the provider off, so turning it
 * off strands nobody.
 */
export async function removeBadge(deps: AuthDeps, session: Session): Promise<void> {
  const user = await deps.repo.findUserById(session.userId);
  if (!user) throw new AuthError("invalid_credentials", 401);
  const held = user.phoneHash !== null;
  await deps.repo.setPhoneHash(user.id, null);
  await deps.profiles.setVerified(user.id, null);
  if (!held) return;
  await notifyAccount(deps, user.email, "badge_removed");
  await deps.repo.appendEvent({ userId: user.id, type: "badge_removed", deviceId: session.deviceId });
}
