import { sql } from "drizzle-orm";
import { APPEALS_PAGE_SIZE, AppealsReviewedParams, DAILY_LIMITS, type AppealRequest, type AppealRow, type AppealsPage, type DecisionView } from "@korbat/contracts";
import { REDRESS_VERSION } from "@korbat/rules";
import type { ActiveStaffSession, StaffStepUpConfirmed } from "../auth";
import { isDeadlock, isLockNotAvailable } from "../lib/lock-bounds";
import { authorDecisionView, decodeListCursor, encodeListCursor } from "./author";
import { reviewerOf } from "./cases";
import { ModerationError, isModerationErrorCode, type ModerationDeps } from "./context";
import { recordConfirmed, refuseUnopened, subjectLockMode, type DecideOptions, type DecideOutcome } from "./decide";
import { countOrRefuse, saltedStatement } from "./intake";
import { insertAction, insertAppeal, insertReview, pendingAppeals, raisedMessage, reviewedDecision, violatedUniqueConstraint } from "./repo";

/**
 * Appeals and their reviews (3c design, sections 6.3 and 7.7). An appeal has one shape: the author's appeal of a final
 * decision that restricts them, one for each such decision, while any of its measures is in force and within six
 * calendar months of being told. A review answers that one appeal: it keeps the decision or lifts measures of it, and
 * never restricts. The database decides whether an appeal is open and who may review it; this file inserts the rows.
 */

const DAY_MS = 24 * 60 * 60_000;

/**
 * The longest an appeal waits for a lock. Its trigger takes the case's row for the length of its own transaction and
 * waits for whoever holds the case: a decision that is being recorded, which for a seal over thousands of images is
 * seconds, or an erasure.
 */
const APPEAL_LOCK_TIMEOUT_MS = 10_000;

/** How often the appeal's transaction is run again after a deadlock or a lock timeout: in each nothing was written. */
const APPEAL_RETRIES = 2;

/**
 * POST /api/moderation/decisions/:id/appeal: the author's appeal of a decision about their post or their account. In
 * this order:
 *   1. the day's limit, five for an account, counted before anything is read, so that whatever the answer the request
 *      was counted;
 *   2. one transaction that inserts the appeal's row. Its trigger decides, under a lock on the decision's case, whether
 *      an appeal of this decision is open now for this account (appeal_not_open: the decision is not a final
 *      restriction, is someone else's, is past its window, or nothing of it is in force), and the unique index refuses
 *      a second appeal (appeal_exists). The statement is optional and free of form; the server makes its salt and
 *      digest. A deadlock or a lock timeout runs the transaction again, and when the last run fails the same way the
 *      answer is service_unavailable;
 *   3. the answer: the decision as its author now reads it, with the appeal waiting. A decision that is not the
 *      viewer's, or of which they were not told, never opened by its id and does not now: not_found.
 * A request that failed through no fault of its sender gives its hit on the day's limit back.
 */
export async function fileAppeal(deps: Pick<ModerationDeps, "apiDb" | "limits" | "log">, viewer: string, decisionId: string, request: AppealRequest): Promise<DecisionView> {
  const key = `appeal:day:account:${viewer}`;
  await countOrRefuse(deps, key, DAY_MS, DAILY_LIMITS.appeals);
  const statement = await saltedStatement(request.statement);
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        await deps.apiDb.transaction(async (tx) => {
          await tx.execute(sql`select set_config('lock_timeout', ${`${APPEAL_LOCK_TIMEOUT_MS}ms`}::text, true)`);
          await insertAppeal(tx, { decisionId, appellantId: viewer, statement });
        });
        break;
      } catch (err) {
        const refusal = raisedMessage(err);
        if (refusal !== null && isModerationErrorCode(refusal)) throw new ModerationError(refusal);
        if (violatedUniqueConstraint(err) === "appeals_once") throw new ModerationError("appeal_exists");
        if (!isDeadlock(err) && !isLockNotAvailable(err)) throw err;
        if (attempt >= APPEAL_RETRIES) throw new ModerationError("service_unavailable", 503, undefined, 30);
      }
    }
  } catch (err) {
    // A refusal that is the sender's own (not open, appealed already) stays counted; anything else was not their doing.
    if (!(err instanceof ModerationError) || err.code === "service_unavailable") {
      await deps.limits.release(key).catch((failure: unknown) => deps.log.warn({ err: failure }, "appeal: a limit hit of a request that could not be saved could not be given back"));
    }
    throw err;
  }
  return authorDecisionView(deps, viewer, decisionId);
}

/**
 * GET /api/staff/appeals: the pending appeals, newest first, 50 a page, each marked whether the reading person may
 * review it (3c design, section 7.7). No row carries a statement: the reviewer reads it on the case page, whose read is
 * logged and counted.
 */
export async function appealsList(deps: Pick<ModerationDeps, "apiDb">, session: ActiveStaffSession, cursor?: string): Promise<AppealsPage> {
  const after = cursor === undefined ? null : decodeListCursor(cursor);
  const found = await pendingAppeals(deps.apiDb, reviewerOf(session), after, APPEALS_PAGE_SIZE + 1);
  const page = found.slice(0, APPEALS_PAGE_SIZE);
  const last = page.at(-1);
  return {
    appeals: page.map(
      (row): AppealRow => ({
        id: row.id,
        caseId: row.caseId,
        decisionId: row.decisionId,
        filedAt: row.filedAt,
        decidedAt: row.decidedAt,
        deadline: row.deadline,
        ruleId: row.ruleId as AppealRow["ruleId"],
        legal: row.legal,
        actions: row.actions,
        reviewer: row.reviewer,
        needsAdmin: row.needsAdmin,
        mayReview: row.mayReview,
      }),
    ),
    // One row more than the page was read: only then is there a next page.
    nextCursor: found.length > APPEALS_PAGE_SIZE && last ? encodeListCursor({ at: last.sortAt, id: last.id }) : null,
  };
}

/**
 * POST /api/staff/decisions/:decision/review, once its step-up verified (3c design, section 7.7): records the answer to
 * the author's one appeal of the decision, as a decision of kind review, in the one transaction every confirmed decision
 * runs (recordConfirmed), with its audit row as appeals_reviewed on the reviewed decision.
 *
 * Before the transaction: the redress texts are those the API serves now (the rulebook version is the reviewed
 * decision's, which the database holds the review to), and the appeal the reviewer's key confirmed is the decision's
 * pending appeal: when it is not, the appeal was answered since the console read the case, and the answer is
 * case_changed with nothing written. The database forces and compares the appeal again under the case's lock, and at
 * commit holds the audit row's params to the stored review, so a review answers exactly the appeal that was confirmed.
 * It refuses a reviewer who decided anything in the case or opened a finding in it (reviewer_conflict), a party
 * (staff_recused), and a moderator where the review needs an admin (admin_required).
 *
 * After the commit the transaction's own last step does what it does for every decision: the statement's mail, the
 * count of the person's decisions, and the mail to every staff account when the review lifted a seal.
 */
export async function review(deps: ModerationDeps, session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: { requestId: string }, options: DecideOptions = {}): Promise<DecideOutcome> {
  // A confirmation of anything else never reviews an appeal: that would be a wiring fault, not a refusal.
  if (confirmed.action !== "appeals_reviewed" || confirmed.target.type !== "decision" || confirmed.keyId !== session.keyId) {
    throw new Error("a review needs a step-up that confirmed it");
  }
  const params = AppealsReviewedParams.parse(confirmed.params);
  if (params.redressVersion !== REDRESS_VERSION) throw new ModerationError("invalid_decision");
  // The routes' one list of the kinds they accept (3e design, section 7.1 item 2).
  refuseUnopened(params, options);

  const reviewsDecisionId = confirmed.target.id;
  const reviewed = await reviewedDecision(deps.apiDb, reviewsDecisionId);
  if (!reviewed) throw new ModerationError("not_found");
  if (reviewed.pendingAppealId !== params.appealId) throw new ModerationError("case_changed");
  // As for a decision: a case's target and a post's author never change, so the subject is read before the transaction.
  const subject = reviewed.target.type === "account" ? reviewed.target.id : await deps.social.postAuthor(reviewed.target.id);

  // A review holds reversals only, so its first lock stays FOR NO KEY UPDATE (3e design, section 5): a lift included.
  return recordConfirmed(
    deps,
    session,
    confirmed,
    ctx,
    subject,
    async (tx, decisionId) => {
      await insertReview(tx, { id: decisionId, caseId: reviewed.caseId, reviewsDecisionId, decidedBy: session.userId, params });
      for (const action of params.actions) await insertAction(tx, decisionId, action);
    },
    subjectLockMode(params.actions),
  );
}

/** The case a reviewed decision belongs to, for the answer to a review that has just committed. */
export async function reviewedCase(deps: Pick<ModerationDeps, "apiDb">, decisionId: string): Promise<string> {
  const reviewed = await reviewedDecision(deps.apiDb, decisionId);
  if (!reviewed) throw new ModerationError("not_found");
  return reviewed.caseId;
}
