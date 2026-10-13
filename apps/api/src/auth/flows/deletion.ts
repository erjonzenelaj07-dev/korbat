import type { DeleteConfirmRequest, DeleteStartResponse } from "@korbat/contracts";
import { AuthError, type AuthDeps, type RequestContext } from "../context";
import { randomToken } from "../crypto";
import { HOUR, enforceLimit } from "../limits";
import type { Session } from "../sessions";
import { CODE_TTL_MS, checkEmailCode, emailCodeHash, flowKey, newEmailCode, sendCode } from "./email";
import { noticeTime, notifyAccount } from "./notify";

export const DELETE_STARTS_PER_HOUR = 3;

/** The deletion a code is out for: kept under the hashed flow id until the code is entered or expires. */
export interface PendingDeletion {
  userId: string;
}

/**
 * Mails the deletion code to the account's own address (1b design, section 7.6): the second of the
 * three guards, after the fresh session the route demands and before the handle the owner types. The
 * code row carries the owner, so no other account can spend it.
 */
export async function startDeletion(deps: AuthDeps, session: Session, ctx: RequestContext): Promise<DeleteStartResponse> {
  const user = await deps.repo.findUserById(session.userId);
  if (!user) throw new AuthError("invalid_credentials", 401);
  await enforceLimit(deps.kv, `delete-start:${user.id}`, DELETE_STARTS_PER_HOUR, HOUR);
  const flowId = randomToken();
  const code = newEmailCode();
  await deps.repo.createEmailCode({
    flowId,
    email: user.email,
    userId: user.id,
    purpose: "delete_account",
    codeHash: emailCodeHash(deps.config.authHmacKey, flowId, code),
    expiresAt: new Date(deps.now().getTime() + CODE_TTL_MS),
    ipHash: ctx.ipHash,
  });
  const pending: PendingDeletion = { userId: user.id };
  await deps.kv.set(flowKey(flowId), JSON.stringify(pending), CODE_TTL_MS);
  await sendCode(deps, { to: user.email, template: "delete_account_code", data: { code } });
  return { flowId };
}

/**
 * Writes the cache tombstones of sessions the database has just revoked, so a cached copy cannot serve
 * them for the rest of its minute. Best effort: the rows are revoked whatever happens here, so a failure
 * only lets a cached copy live out that minute, and the account is not left half gone because the cache
 * was unreachable.
 */
async function tombstoneQuietly(deps: AuthDeps, userId: string, sessionIds: readonly string[]): Promise<void> {
  try {
    await deps.sessions.tombstone(sessionIds);
  } catch (err) {
    deps.log.error({ err, userId }, "account deletion: the session tombstones could not be written; the sessions are revoked in the database");
  }
}

/**
 * The auth side of a deletion, step 1 of section 7.6: the typed handle must be the account's own,
 * then the code must be right; then, in one transaction, the account is marked deleted (every lookup
 * treats the row as absent from here, so no request can succeed against it while the purge runs),
 * every session revoked, its devices, codes and passkeys deleted, its WebAuthn user handle cleared and
 * the event recorded; then the revoked sessions get their tombstones, so the cache cannot revive one,
 * and the account is told. Nothing after the transaction can fail the request: the account is gone
 * once it commits. The row itself is anonymised by finishPurge, once the account module has purged the
 * other schemas.
 */
export async function confirmDeletion(deps: AuthDeps, session: Session, input: DeleteConfirmRequest): Promise<void> {
  const user = await deps.repo.findUserById(session.userId);
  if (!user) throw new AuthError("invalid_credentials", 401);
  // The handle is the third guard, compared in any case and checked before the code, so a slip of the fingers costs no attempt on it.
  const profile = await deps.profiles.find(user.id);
  if (!profile || profile.handle.toLowerCase() !== input.handle.toLowerCase()) throw new AuthError("invalid_request", 400, "handle_mismatch");
  const row = await deps.repo.findEmailCode(input.flowId);
  // A code from another account's deletion, or from any other flow, is no code at all, settled before an attempt is counted.
  if (row?.purpose !== "delete_account" || row.userId !== user.id) throw new AuthError("invalid_code", 400);
  await checkEmailCode(deps, row, input.flowId, input.code);
  // Taken, not read: whatever happens next, this flow is over and the code is spent.
  if (!(await deps.kv.take(flowKey(input.flowId)))) throw new AuthError("code_expired", 400);

  const revoked = await deps.repo.takeDown(user.id, deps.now(), session.deviceId);
  await tombstoneQuietly(deps, user.id, revoked);
  // Told once the account is gone, and never before: a take-down that failed leaves the account as it was. The address
  // still belongs to the row until finishPurge; best effort, since no mail failure may keep an account its owner has given up.
  await notifyAccount(deps, user.email, "account_deleted");
}

/**
 * 3e (design, sections 5 and 7.8 step 3): the take-down of an account whose termination is final for its author, as the
 * system, without a session or a code. As confirmDeletion does: the account's row is read first with its address, then
 * the account is marked deleted with every session revoked and the event written, in one transaction; the revoked
 * sessions get their tombstones; and only after that commit the address read before gets termination_final, best
 * effort, in place of account_deleted, with the decision's day and, when images of the account stay sealed, its
 * sentence about them. It does nothing a second time: an account already marked deleted (gone from every lookup) is
 * left as it is, with no event and no mail, and the answer is false; true only for the take-down this call made. The
 * address stays on the row until finishPurge, so nothing is lost by mailing after the commit.
 */
export async function takeDownTerminated(deps: AuthDeps, userId: string, facts: { decidedAt: Date; imagesSealed: boolean }): Promise<boolean> {
  const user = await deps.repo.findUserById(userId);
  if (!user) return false;
  const revoked = await deps.repo.takeDownTerminated(user.id, deps.now());
  if (revoked === null) return false;
  await tombstoneQuietly(deps, user.id, revoked);
  await notifyAccount(deps, user.email, "termination_final", { decided: noticeTime(facts.decidedAt), imagesSealed: String(facts.imagesSealed) });
  return true;
}

/**
 * Step 4 of section 7.6, which the purge job runs for every account left half deleted: the rows of
 * step 1 again (sessions still live revoked with their tombstones, devices, codes and passkeys deleted,
 * the WebAuthn user handle cleared), for an account marked deleted without the rest, then the row
 * anonymised and marked purged. Both parts change nothing for an account that is live or already
 * purged, so the job can repeat it after any failure.
 */
export async function finishPurge(deps: AuthDeps, userId: string): Promise<void> {
  const revoked = await deps.repo.finishTakeDown(userId, deps.now());
  await tombstoneQuietly(deps, userId, revoked);
  await deps.repo.finishPurge(userId, deps.now());
}
