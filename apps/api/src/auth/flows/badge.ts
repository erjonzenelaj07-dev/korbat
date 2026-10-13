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
/** Per client address, as the sign-up starts limit theirs: one address cannot run many accounts' starts. */
export const BADGE_STARTS_PER_IP_PER_HOUR = 10;
/** On the whole instance: every start is a text the provider bills, so no crowd of fresh accounts can run up the bill. */
export const BADGE_STARTS_PER_DAY = 200;

/** A flow id is a bearer credential while its verification is pending, so the store holds only its hash. */
export const badgeKey = (flowId: string) => `badge:${sha256Hex(flowId)}`;
/** The flow's attempts, counted by the store's atomic counter under the hashed flow id. */
export const badgeAttemptsKey = (flowId: string) => `badge-attempts:${sha256Hex(flowId)}`;

/**
 * The verification a code is out for, kept under the hashed flow id until the code is right or the ten
 * minutes pass. It holds the number only as its keyed hash, which is what the account will store; the
 * number itself went to the provider and nowhere else. The expiry is kept so that a state the store has
 * not dropped yet at the end of its ten minutes is still treated as gone. It is written once and never
 * written back: attempts are counted apart, atomically.
 */
export interface PendingBadge {
  userId: string;
  phoneHash: string;
  reference: string;
  expiresAt: number;
}

/**
 * The configured provider, or badge_unavailable (404) when VERIFY_PROVIDER is off. The web app does not
 * learn this from the answer: its build flag (EXPO_PUBLIC_BADGE, from WEB_BADGE) decides whether the badge
 * section is shown, off by default like the provider.
 */
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
 * phone (verifyBadge), so this step tells nobody which numbers are registered. Every limit is counted
 * before the provider is asked, so a refused start costs no text; the number is never stored.
 */
export async function startBadge(deps: AuthDeps, session: Session, input: BadgeStartRequest, ctx: RequestContext): Promise<{ flowId: string }> {
  const verify = provider(deps);
  // 3e (design, section 7.2): the badge is a public mark, which a suspended account cannot ask for. A courtesy read, so
  // that no code is texted to it; the write in verifyBadge decides.
  if (await deps.profiles.suspended(session.userId)) throw new AuthError("account_suspended", 403);
  const hashed = phoneHash(deps.config.authHmacKey, input.phone);
  // The narrowest bucket first: a start the account's own limit refuses is not counted against the address or the
  // instance, so one account cannot spend their allowance with starts it was never going to get.
  await enforceLimit(deps.kv, `badge-start:${session.userId}`, BADGE_STARTS_PER_HOUR, HOUR);
  await enforceLimit(deps.kv, `badge-start:ip:${ctx.ipHash}`, BADGE_STARTS_PER_IP_PER_HOUR, HOUR);
  // Per number too, whoever asks, so one phone cannot be texted more than three times an hour through many accounts.
  await enforceLimit(deps.kv, `badge-start:phone:${hashed}`, BADGE_STARTS_PER_HOUR, HOUR);
  // The ceiling last, so it counts only starts every other bucket let through.
  await enforceLimit(deps.kv, "badge-start:all", BADGE_STARTS_PER_DAY, 24 * HOUR);
  const { reference } = await verify.start(input.phone).catch(unavailable);
  const flowId = randomToken();
  const pending: PendingBadge = { userId: session.userId, phoneHash: hashed, reference, expiresAt: deps.now().getTime() + CODE_TTL_MS };
  await deps.kv.set(badgeKey(flowId), JSON.stringify(pending), CODE_TTL_MS);
  return { flowId };
}

/**
 * Checks the code with the provider. Attempts are counted before the provider is asked, as the email
 * codes count theirs, with the store's atomic counter: concurrent requests each get their own count, so
 * a flow takes at most five codes whatever the provider answers and however many requests arrive at
 * once. On success the account's phone hash is written first (the partial unique index on it decides
 * conflicts, so a number another account verified is phone_in_use here and only here), then the
 * profile's verified_at, and the account is told.
 */
export async function verifyBadge(deps: AuthDeps, session: Session, input: BadgeVerifyRequest): Promise<BadgeVerifyResponse> {
  const verify = provider(deps);
  const key = badgeKey(input.flowId);
  const raw = await deps.kv.get(key);
  const pending = raw ? (JSON.parse(raw) as PendingBadge) : null;
  // A flow another account started, an unknown one and one whose ten minutes passed are all no code at all,
  // settled before an attempt is counted: nobody can spend another account's attempts. The store drops the
  // state itself at the end of the ten minutes; a straggler it still holds is treated like a flow that is gone.
  if (!pending || pending.userId !== session.userId) throw new AuthError("invalid_code", 400);
  if (pending.expiresAt <= deps.now().getTime()) throw new AuthError("invalid_code", 400);
  // The counter's life starts at the first attempt and is never extended; it outlives the state by at most ten minutes.
  const attempts = await deps.kv.incr(badgeAttemptsKey(input.flowId), CODE_TTL_MS);
  if (attempts > MAX_CODE_ATTEMPTS) throw new AuthError("too_many_attempts", 429);

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
  if (!(await deps.profiles.setVerified(user.id, deps.now()))) {
    // 3e: the one predicate refused the badge's write (a suspension started meanwhile): the phone hash written a moment
    // before is cleared again, so the account holds nothing of a badge it was refused.
    await deps.repo.setPhoneHash(user.id, null);
    throw new AuthError("account_suspended", 403);
  }
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
