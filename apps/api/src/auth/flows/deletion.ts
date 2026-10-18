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
  // 3f (W.5): one wording for every account, and the hold's paragraph when its address is held for a report.
  await notifyAccount(deps, user.email, "account_deleted", await heldAddressFacts(deps, user.id));
}

/**
 * 3f (design, sections 7.15 and W.5): what a deletion's mail says of an address held for a report to the authorities:
 * the day the hold ends at the latest (heldUntil, a UTC day, from auth.address_held_until) and which of the paragraph's
 * two variants (holdFinal, from auth.address_hold_final: a seal for good, or one taken while deciding). Nothing while
 * REPORT_HOLD is off or nothing is held. Best effort, as the mail is: a failed read is logged and the mail goes in its one
 * wording for every account, which says that korbat keeps what the law obliges it to keep for a time.
 *
 * 3f's review (access3): nothing either while a seal that holds the address is held with an order's notice (`told`
 * false): the paragraph says that korbat sealed images of the account, which the person has not been told. The address
 * stays held all the same; the mail goes in the one wording for every account.
 */
async function heldAddressFacts(deps: AuthDeps, userId: string): Promise<Record<string, string>> {
  if (!deps.config.reportHold) return {};
  try {
    const hold = await deps.repo.addressHold(userId);
    return hold === null || !hold.told ? {} : { heldUntil: hold.until.toISOString().slice(0, 10), holdFinal: String(hold.final) };
  } catch (err) {
    deps.log.error({ err }, "account deletion: whether the address is held could not be read; the mail goes without the hold's paragraph");
    return {};
  }
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
 *
 * The mail is started and not waited for (3e's review, database3): the moderation module's take-down calls this while its
 * own transaction holds the account's profile FOR UPDATE, and a relay that stalls would hold that row, and every like,
 * repost and reply of the account's posts behind it, for as long as the relay. notifyAccount logs a failure itself and
 * never throws.
 */
export async function takeDownTerminated(deps: AuthDeps, userId: string, facts: { decidedAt: Date; imagesSealed: boolean }): Promise<boolean> {
  const user = await deps.repo.findUserById(userId);
  if (!user) return false;
  const revoked = await deps.repo.takeDownTerminated(user.id, deps.now());
  if (revoked === null) return false;
  await tombstoneQuietly(deps, user.id, revoked);
  // 3f (7.15 step 8): a termination's take-down is held the same way, and its mail gains the same paragraph.
  const held = await heldAddressFacts(deps, user.id);
  void notifyAccount(deps, user.email, "termination_final", { decided: noticeTime(facts.decidedAt), imagesSealed: String(facts.imagesSealed), ...held });
  return true;
}

/**
 * Step 4 of section 7.6, which the purge job runs for every account left half deleted: the rows of
 * step 1 again (sessions still live revoked with their tombstones, devices, codes and passkeys deleted,
 * the WebAuthn user handle cleared), for an account marked deleted without the rest, then the row
 * anonymised and marked purged. Both parts change nothing for an account that is live or already
 * purged, so the job can repeat it after any failure. 3f (7.15): while REPORT_HOLD is on and the
 * account's address is held for a report, the credentials go and the address waits: the answer is then
 * `held`, and the account stays pending for the next round.
 */
export async function finishPurge(deps: AuthDeps, userId: string): Promise<"purged" | "held" | "none"> {
  const revoked = await deps.repo.finishTakeDown(userId, deps.now());
  await tombstoneQuietly(deps, userId, revoked);
  return deps.repo.finishPurge(userId, deps.now(), deps.config.reportHold);
}
