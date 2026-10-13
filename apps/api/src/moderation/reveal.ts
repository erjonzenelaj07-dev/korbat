import { IdentityRevealedParams, type RevealResponse } from "@korbat/contracts";
import type { ActiveStaffSession, StaffStepUpConfirmed } from "../auth";
import { boundLockWaits, isBoundReached, isDeadlock } from "../lib/lock-bounds";
import { secondsToUtcMidnight } from "./cases";
import { ModerationError, isModerationErrorCode, type ModerationDeps } from "./context";
import { appendConfirmedAudit, dailyLimits, handleOf, insertAccess, raisedMessage, reporterHandle, revealItem, revealReason, revealsToday, staffCaseConflict } from "./repo";

/**
 * Revealing who sent a report or a notice (3c design, section 7.3). Staff see a source only as a summary; a reporter's
 * handle, or the name a signed-out notifier gave, is shown to a moderator only through this confirmed action, with a
 * reason category and a saved reason text, written to the access log and to the audit record in one transaction, listed
 * on every staff member's home screen and mailed to every staff account. A notifier's address is never revealed.
 */

/** A reveal that committed, with what it showed; or why none did: the confirming account or key ended, or the challenge's time ran out. */
export type RevealOutcome = RevealResponse | "ended" | "late";

/** The lock waits a reveal may meet: the acting account's row, the key's row and the audit head. */
const REVEAL_WAITS = 3;

/** A transaction that met a deadlock or a lock timeout is run once more only while more than this much of the challenge is left. */
const RETRY_MARGIN_MS = 60_000;

/**
 * POST /api/staff/items/:item/reveal, once its step-up verified. Before anything is written it refuses, in this order:
 *   - not_found: the item does not exist, or has no case (its link named nothing);
 *   - staff_recused: the person is too close to the case's subject;
 *   - reveal_refused: the item's intake is on the path for child sexual abuse material or a moderator's finding, or names
 *     nobody (the reporter's link is gone, or the notifier gave no name, or the contact is lost);
 *   - text_not_found: the params' digest is not that of the person's own saved reason on the item's case, unerased,
 *     unconfirmed and named by no reveal yet;
 *   - rate_limited: the person has revealed the day's limit of sources since midnight UTC. The count is read before the
 *     transaction, so two reveals sent at once may both pass at the limit.
 * Then one transaction: every lock wait bounded by a third of what is left of the challenge; the access row; and, last,
 * the audit row through public.append_confirmed_audit, which also confirms the reason text and is what ends a reveal by
 * a staff account or a key that no longer opens anything, and a late one. Nothing else guards it: no decision's trigger
 * runs for a reveal.
 *
 * The identity is read only after the commit, so none is answered when the commit fails: the reporter's handle, or the
 * notifier's given name from the auth module. Both are null when the name was forgotten in between. Every staff account,
 * the person's own included, is then mailed, best effort and without a throttle: the day's limit bounds it, and the home
 * screen lists every reveal.
 */
export async function reveal(deps: ModerationDeps, session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: { requestId: string }): Promise<RevealOutcome> {
  // A confirmation of anything else never reveals a source: that would be a wiring fault, not a refusal.
  if (confirmed.action !== "identity_revealed" || confirmed.target.type !== "intake_item" || confirmed.keyId !== session.keyId) {
    throw new Error("a reveal needs a step-up that confirmed it");
  }
  const params = IdentityRevealedParams.parse(confirmed.params);
  const itemId = confirmed.target.id;

  const item = await revealItem(deps.apiDb, itemId);
  if (!item || item.caseId === null) throw new ModerationError("not_found");
  const caseId = item.caseId;
  if (await staffCaseConflict(deps.apiDb, session.userId, caseId)) throw new ModerationError("staff_recused");
  if (item.csam || item.intakeKind === "finding") throw new ModerationError("reveal_refused");
  const signedOut = item.channel === "signed_out";
  if (signedOut) {
    const facts = item.contactId === null ? undefined : (await deps.auth.notifierFacts([item.contactId])).get(item.contactId);
    if (!facts?.named) throw new ModerationError("reveal_refused");
  } else if (item.reporterAccountId === null) {
    throw new ModerationError("reveal_refused");
  }
  const textId = await revealReason(deps.apiDb, { caseId, authorId: session.userId, digest: params.reasonDigest });
  if (textId === null) throw new ModerationError("text_not_found");
  const limits = await dailyLimits(deps.apiDb);
  if ((await revealsToday(deps.apiDb, session.userId)) >= limits.reveals) {
    throw new ModerationError("rate_limited", 429, undefined, secondsToUtcMidnight(deps.now()));
  }

  let done: { at: Date; count: number };
  for (let attempt = 1; ; attempt++) {
    try {
      const stamped = await deps.apiDb.transaction(async (tx): Promise<{ at: Date; count: number } | "late"> => {
        if (!(await boundLockWaits(tx, confirmed.expiresAt, REVEAL_WAITS))) return "late";
        const at = await insertAccess(tx, { staffId: session.userId, caseId, kind: "identity_revealed", itemId, textId });
        // The person's reveals of the day, this one included, for the mail; read before the audit row, which is last.
        const count = await revealsToday(tx, session.userId);
        await appendConfirmedAudit(tx, {
          actorId: session.userId,
          keyId: confirmed.keyId,
          action: "identity_revealed",
          targetType: "intake_item",
          targetId: itemId,
          metadata: { params: confirmed.params },
          staffSession: session.handle,
          actionHash: confirmed.actionHash,
          stepUp: confirmed.assertion,
          requestId: ctx.requestId,
          expiresAt: confirmed.expiresAt,
        });
        return { at, count };
      });
      if (stamped === "late") return "late";
      done = stamped;
      break;
    } catch (err) {
      const refusal = raisedMessage(err);
      if (refusal === "staff_confirmation_ended") return "ended";
      if (refusal === "staff_confirmation_late") return "late";
      // The reason text was swept or used between the check above and the audit function's own.
      if (refusal !== null && isModerationErrorCode(refusal)) throw new ModerationError(refusal);
      if (!isDeadlock(err) && !isBoundReached(err)) throw err;
      if (attempt > 1 || confirmed.expiresAt.getTime() - deps.now().getTime() <= RETRY_MARGIN_MS) return "late";
    }
  }

  // The reveal is on the record. Every staff account is told, whatever becomes of the read below.
  deps.background.start(async () => {
    const handle = (await handleOf(deps.apiDb, session.userId)) ?? "unknown";
    await deps.auth.mailStaff({ template: "moderation_reveal", handle, at: done.at, count: done.count, limit: limits.reveals });
  });

  if (signedOut) return { handle: null, name: item.contactId === null ? null : await deps.auth.notifierName(item.contactId) };
  return { handle: await reporterHandle(deps.apiDb, itemId), name: null };
}
