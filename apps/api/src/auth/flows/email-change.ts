import type { EmailChangeResponse, EmailChangeStartRequest, EmailChangeVerifyRequest, EmailRevertRequest } from "@korbat/contracts";
import { AuthError, isUniqueViolation, type AuthDeps, type RequestContext } from "../context";
import { randomToken, sha256Hex } from "../crypto";
import { isDisposableEmail } from "../disposable";
import { emailHash } from "../identifiers";
import { HOUR, MINUTE, enforceLimit, padResponseTime } from "../limits";
import type { Session } from "../sessions";
import { CODE_TTL_MS, MIN_START_RESPONSE_MS, checkEmailCode, emailCodeHash, flowKey, newEmailCode, sendCode } from "./email";
import { lockdown } from "./lockdown";
import { notifyAccount } from "./notify";

export const EMAIL_CHANGE_STARTS_PER_HOUR = 3;
/** How long the old address can undo a change, as long as the new-device "not me" link works. */
export const EMAIL_REVERT_TTL_MS = 24 * HOUR;
export const EMAIL_REVERTS_PER_IP_PER_HOUR = 10;

/** The undo link is a bearer credential for a day, so the store holds only its hash. */
export const emailRevertKey = (token: string) => `email-revert:${sha256Hex(token)}`;
/** Present while an account's undo link is out; see openRevert. */
export const emailRevertOpenKey = (userId: string) => `email-revert-open:${userId}`;

/** The change a code is out for: kept under the hashed flow id until the code is entered or expires. */
export interface PendingEmailChange {
  userId: string;
  email: string;
}

/**
 * What an undo link puts back: the address the account had, when it left it (epoch milliseconds from the
 * flows' clock, the one passwordChangedAt, totpEnabledAt and a passkey's createdAt are written with, so the
 * lockdown at the undo compares like with like), and the passkey behind the session that made the change,
 * which the lockdown removes whatever its age.
 */
export interface PendingEmailRevert {
  userId: string;
  oldEmail: string;
  changedAt: number;
  passkeyId: string | null;
}

const LINK_GONE = "This link has expired or was already used.";

/**
 * Sends a code to the address the account wants to move to. The answer, the mail and the time taken
 * are the same whether or not that address already has an account: the conflict is reported only at
 * verification, once the code has proved that the requester holds the mailbox, so this step tells
 * nobody which addresses are registered.
 */
export async function startEmailChange(deps: AuthDeps, session: Session, input: EmailChangeStartRequest, ctx: RequestContext): Promise<{ flowId: string }> {
  const startedAt = Date.now();
  try {
    if (isDisposableEmail(input.email)) throw new AuthError("disposable_email", 400);
    const user = await deps.repo.findUserById(session.userId);
    if (!user) throw new AuthError("invalid_credentials", 401);
    // Refused before any limit is touched, so a slip does not put the account's own address on the cooldown its sign-in codes share.
    if (user.email.toLowerCase() === input.email.toLowerCase()) throw new AuthError("invalid_request", 400, "That is already your email address.");
    await enforceLimit(deps.kv, `email-change:${user.id}`, EMAIL_CHANGE_STARTS_PER_HOUR, HOUR);
    // The new address gets the sign-in start's cooldown and hourly limit, in the same buckets, so asking
    // for a change cannot send an address more codes than asking to sign in could.
    const hashedEmail = emailHash(deps.config.authHmacKey, input.email);
    if (!(await deps.kv.setIfAbsent(`email-cooldown:${hashedEmail}`, "1", MINUTE))) throw new AuthError("rate_limited", 429, undefined, MINUTE / 1000);
    await enforceLimit(deps.kv, `email-start:email:${hashedEmail}`, 3, HOUR);

    const flowId = randomToken();
    const code = newEmailCode();
    await deps.repo.createEmailCode({
      flowId,
      email: input.email,
      userId: user.id,
      purpose: "change_email",
      codeHash: emailCodeHash(deps.config.authHmacKey, flowId, code),
      expiresAt: new Date(deps.now().getTime() + CODE_TTL_MS),
      ipHash: ctx.ipHash,
    });
    const pending: PendingEmailChange = { userId: user.id, email: input.email };
    await deps.kv.set(flowKey(flowId), JSON.stringify(pending), CODE_TTL_MS);
    await sendCode(deps, { to: input.email, template: "email_change_code", data: { code } });
    return { flowId };
  } finally {
    await padResponseTime(startedAt, MIN_START_RESPONSE_MS);
  }
}

/**
 * Moves the account to the new address once its code is right. The unique index on the address
 * decides conflicts, so an address that got an account after the code went out is email_in_use here.
 * Every session stays signed in, because the owner just proved a credential. The old address is told,
 * with a link that undoes the change for 24 hours (revertEmailChange): an account without a password
 * signs in only by a code to its address, so once the address is someone else's, the old one could not
 * sign in to change it back.
 */
export async function verifyEmailChange(deps: AuthDeps, session: Session, input: EmailChangeVerifyRequest): Promise<EmailChangeResponse> {
  const row = await deps.repo.findEmailCode(input.flowId);
  // A code from another account's change, or from any other flow, is no code at all. The row carries
  // the owner, so this is settled before an attempt is counted: nobody can spend another account's attempts.
  if (row?.purpose !== "change_email" || row.userId !== session.userId) throw new AuthError("invalid_code", 400);
  await checkEmailCode(deps, row, input.flowId, input.code);
  // Taken, not read: whatever happens next, this flow is over and the code is spent.
  const raw = await deps.kv.take(flowKey(input.flowId));
  if (!raw) throw new AuthError("code_expired", 400);
  const pending = JSON.parse(raw) as PendingEmailChange;

  const user = await deps.repo.findUserById(session.userId);
  if (!user) throw new AuthError("invalid_credentials", 401);
  const changedAt = deps.now();
  try {
    await deps.repo.changeEmail(user.id, pending.email, changedAt);
  } catch (err) {
    if (isUniqueViolation(err)) throw new AuthError("email_in_use", 409);
    throw err;
  }
  // Hashes only: the event log never holds an address.
  await deps.repo.appendEvent({
    userId: user.id,
    type: "email_changed",
    deviceId: session.deviceId,
    metadata: { from: emailHash(deps.config.authHmacKey, user.email), to: emailHash(deps.config.authHmacKey, pending.email) },
  });
  const revertUrl = await openRevert(deps, { userId: user.id, oldEmail: user.email, changedAt: changedAt.getTime(), passkeyId: session.passkeyId });
  await notifyAccount(deps, user.email, "email_changed", revertUrl === null ? { email: pending.email } : { email: pending.email, revertUrl });
  return { email: pending.email };
}

/**
 * Mints the undo link for a change, or none. One link per account at a time: the first change opens a
 * day in which later changes get no link of their own, and the one link, used, goes back to the address
 * before that first change. A link per change would undo nothing: someone who took the account and
 * changed the address twice would hold the link sent to the address in the middle, one of their own,
 * and could use it after the owner used theirs to move the account back to it.
 */
async function openRevert(deps: AuthDeps, revert: PendingEmailRevert): Promise<string | null> {
  if (!(await deps.kv.setIfAbsent(emailRevertOpenKey(revert.userId), "1", EMAIL_REVERT_TTL_MS))) return null;
  const token = randomToken();
  await deps.kv.set(emailRevertKey(token), JSON.stringify(revert), EMAIL_REVERT_TTL_MS);
  return `${deps.config.appOrigin}/email-revert/${token}`;
}

/**
 * The undo link from the email_changed notice, which needs no session: the link is the credential, and
 * works once. The account goes back to the old address (email_in_use when that address got another
 * account meanwhile), then the lockdown runs anchored at the change (1c design, section 7.6): every
 * session signed out, every device revoked, the password removed, the passkeys added since the day
 * before the change and the one behind the changing session removed, and two-factor set up since then
 * turned off, so whoever made the change keeps no way in. What the owner set up earlier stays, except
 * the password, which nobody can tell from one an attacker set. The address the account was moved to
 * is told nothing; the old one gets a short note.
 */
export async function revertEmailChange(deps: AuthDeps, input: EmailRevertRequest, ctx: RequestContext): Promise<void> {
  await enforceLimit(deps.kv, `email-revert:ip:${ctx.ipHash}`, EMAIL_REVERTS_PER_IP_PER_HOUR, HOUR);
  // Taken, not read: two requests with the same link cannot both act on it.
  const raw = await deps.kv.take(emailRevertKey(input.token));
  if (!raw) throw new AuthError("invalid_code", 400, LINK_GONE);
  const revert = JSON.parse(raw) as PendingEmailRevert;
  // An account deleted since has nothing left to move back.
  const user = await deps.repo.findUserById(revert.userId);
  if (!user) throw new AuthError("invalid_code", 400, LINK_GONE);
  try {
    await deps.repo.changeEmail(user.id, revert.oldEmail, deps.now());
  } catch (err) {
    if (isUniqueViolation(err)) throw new AuthError("email_in_use", 409);
    throw err;
  }
  // The lockdown records the undo itself: the event log holds hashes only, never an address.
  const key = deps.config.authHmacKey;
  await lockdown(deps, {
    userId: user.id,
    anchor: new Date(revert.changedAt),
    passkeyIds: revert.passkeyId ? [revert.passkeyId] : [],
    caller: { type: "email_changed", metadata: { from: emailHash(key, user.email), to: emailHash(key, revert.oldEmail), reverted: true } },
    ctx,
  });
  // The link is spent, so the next change may send one again.
  await deps.kv.del(emailRevertOpenKey(user.id));
  await notifyAccount(deps, revert.oldEmail, "email_change_reverted");
}
