import { sql } from "drizzle-orm";
import type { ImportEndedByStaffParams } from "@korbat/contracts";
import type { Db } from "@korbat/db";
import type { ActiveStaffSession, StaffStepUpConfirmed } from "../auth";
import { ImportError, type ImportsForStaff, type StaffEnd } from "../imports";
import { boundLockWaits, isBoundReached, isDeadlock } from "../lib/lock-bounds";
import { ModerationError, type ModerationForStaff } from "../moderation";

/**
 * POST /api/staff/imports/:import/end, once its step-up verified (3b design, section 8.7; decision 30; the orchestrator's
 * rulings for Task 6): an admin's end of a whole import, from a case about one of its posts, by a decision recorded on that
 * case (final, restricting) under the rule the end names. The moderation module says what the case and the decision rest
 * on; then one transaction: the bounded lock waits, the imports module's moves of 8.7 (it holds the case's post to the
 * import and refuses a second end), with `gap` the restore gap of a lost end closed by this end (0048's gap_close), and the
 * confirmed audit row import_ended_by_staff on the import last (append_confirmed_audit, 0048), with the params the key
 * confirmed. After the commit the imports module asks for a running import's files and mails the person. "ended" and
 * "late" as for a decision; once more after a deadlock while the challenge has time. The answer names the case, which the
 * route answers as it now stands.
 */

/** The locks the end may wait for: the import's row, the gap's, the acting account's row, the key and the audit head. */
const END_WAITS = 5;
/** What a retry after a deadlock must leave of the challenge's ten minutes, as a decision's retry does. */
const RETRY_MARGIN_MS = 60_000;

/** What the database raised as its message (SQLSTATE P0001), or null, through drizzle's wrapping. */
function raised(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    const c = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof c.code === "string") return c.code === "P0001" && typeof c.message === "string" ? c.message : null;
    current = c.cause;
  }
  return null;
}

export async function endImport(
  db: Db,
  imports: ImportsForStaff,
  moderation: ModerationForStaff,
  session: ActiveStaffSession,
  confirmed: StaffStepUpConfirmed,
  ctx: { requestId: string; gap: string | null; now: () => Date },
): Promise<{ caseId: string } | "ended" | "late"> {
  // A confirmation of anything else never ends an import: a wiring fault, not a refusal.
  if (confirmed.action !== "import_ended_by_staff" || confirmed.target.type !== "import" || confirmed.keyId !== session.keyId) throw new Error("an import is ended only with the step-up that confirmed it");
  const params = confirmed.params as ImportEndedByStaffParams;
  const importId = confirmed.target.id;
  const basis = await moderation.importEndBasis(params.caseId, params.decisionId, params.ruleId);
  // The decision is not one of the case's, not final and restricting, under another rule, or the case is about no post.
  if (basis === null) throw new ImportError("invalid_request");
  for (let attempt = 1; ; attempt++) {
    let end: StaffEnd | "late";
    try {
      end = await db.transaction(async (tx): Promise<StaffEnd | "late"> => {
        if (!(await boundLockWaits(tx, confirmed.expiresAt, END_WAITS))) return "late";
        const moved = await imports.endByStaff(tx, { id: importId, postId: basis.postId, caseId: params.caseId, decisionId: params.decisionId, ruleId: params.ruleId });
        if (ctx.gap !== null) await tx.execute(sql`select public.gap_close(${ctx.gap}::uuid, ${params.decisionId}::uuid, ${session.userId}::uuid)`);
        // The audit head's lock lasts until commit: the audit row is the transaction's last statement.
        await tx.execute(
          sql`select public.append_confirmed_audit(${session.userId}::uuid, ${confirmed.keyId}::uuid, 'import_ended_by_staff'::text, 'import'::text, ${importId}::text,
                ${JSON.stringify({ params: confirmed.params })}::text::jsonb, ${session.handle}::uuid, ${confirmed.actionHash}::text, ${JSON.stringify(confirmed.assertion)}::text::jsonb,
                ${ctx.requestId}::text, ${confirmed.expiresAt.getTime()}::bigint)`,
        );
        return moved;
      });
    } catch (err) {
      const refusal = raised(err);
      if (refusal === "staff_confirmation_ended") return "ended";
      if (refusal === "staff_confirmation_late") return "late";
      // gap_close's refusals: no such gap, one this end does not take again, or (as for any closing) not an admin.
      if (refusal === "not_found" || refusal === "gap_mismatch" || refusal === "admin_required") throw new ModerationError(refusal);
      if (!isDeadlock(err) && !isBoundReached(err)) throw err;
      if (attempt > 1 || confirmed.expiresAt.getTime() - ctx.now().getTime() <= RETRY_MARGIN_MS) return "late";
      continue;
    }
    if (end === "late") return "late";
    await imports.endedByStaff(end, { ruleId: params.ruleId, decisionId: params.decisionId });
    return { caseId: params.caseId };
  }
}
