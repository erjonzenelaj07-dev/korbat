import type { EmailChangeResponse, EmailChangeStartRequest, EmailChangeVerifyRequest } from "@korbat/contracts";
import { AuthError, isUniqueViolation, type AuthDeps, type RequestContext } from "../context";
import { randomToken } from "../crypto";
import { isDisposableEmail } from "../disposable";
import { emailHash } from "../identifiers";
import { HOUR, MINUTE, enforceLimit, padResponseTime } from "../limits";
import type { Session } from "../sessions";
import { CODE_TTL_MS, MIN_START_RESPONSE_MS, checkEmailCode, emailCodeHash, flowKey, newEmailCode, sendCode } from "./email";
import { notifyAccount } from "./notify";

export const EMAIL_CHANGE_STARTS_PER_HOUR = 3;

/** The change a code is out for: kept under the hashed flow id until the code is entered or expires. */
export interface PendingEmailChange {
  userId: string;
  email: string;
}

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
 * The old address is told; every session stays signed in, because the owner just proved a credential.
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
  try {
    await deps.repo.changeEmail(user.id, pending.email, deps.now());
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
  await notifyAccount(deps, user.email, "email_changed", { email: pending.email });
  return { email: pending.email };
}
