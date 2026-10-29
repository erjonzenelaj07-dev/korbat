import { randomUUID } from "node:crypto";
import { CaseDecidedParams, MEASURE_KINDS, REVERSAL_KINDS, type ActionKind } from "@korbat/contracts";
import type { DbTx } from "@korbat/db";
import type { AccountLockMode } from "../social";
import { REDRESS_VERSION, RULES_VERSION } from "@korbat/rules";
import type { ActiveStaffSession, StaffStepUpConfirmed } from "../auth";
import { boundLockWaits, isBoundReached, isDeadlock } from "../lib/lock-bounds";
import { staffAlert } from "./alerts";
import { ModerationError, isModerationErrorCode, type ModerationDeps } from "./context";
import { decisionCaseHasMatch } from "./automated-repo";
import { appendConfirmedAudit, caseTarget, closeGap, handleOf, holdsAnnouncedStanding, insertAction, insertDecision, insertMarks, raisedDetail, raisedMessage, recentDecisionsBy } from "./repo";
import { decisionStatement, sendStatement } from "./statement";

/**
 * The confirmed transaction of a decision and of a review (3c design, sections 7.5, step 3, and 7.7). The API writes
 * the decision's row, one row for each measure or reversal and, last, the audit row; the database's triggers lock,
 * check, complete and apply them (migrations 0016 and 0017), and its deferred check refuses at commit a decision whose
 * audit row does not name exactly it.
 */

/** A decision that committed, or why none did: the confirming account or key ended, or the challenge's time ran out. */
export type DecideOutcome = { decisionId: string } | "ended" | "late";

/**
 * What a confirmed decision's route hands on besides the confirmation: the request's id for the audit row, and (3f Task
 * 6, section 7.17 step 6) the restore gap the decision takes again, from the decide and review routes' query member
 * `gap`, which the transaction closes with this decision and names in the audit row.
 */
export interface DecideContext {
  requestId: string;
  gap?: string | null;
}

/**
 * The kinds of the ledger the decide and review routes accept (3e design, section 7.1 item 2). The params' schema knows
 * all 22 kinds of 3e from its first task on, and (3f) the reinstatement after an order; this list holds 3c's twelve, a strike with its overruling, (Task 2) a
 * handle's retirement with its reversal, (Task 3) a suspension with its lift, (Task 4) a termination and (Task 5) the
 * warning about reporting, the restriction of it and their lift: every kind, since each task of 3e added the kinds whose
 * flow it built, so that no route recorded a measure whose flow was not built yet. A kind outside it is refused before
 * the transaction (invalid_decision).
 */
export const ROUTE_KINDS: ReadonlySet<ActionKind> = new Set<ActionKind>([
  ...MEASURE_KINDS.slice(0, 7),
  ...REVERSAL_KINDS.slice(0, 5),
  "strike",
  "overrule",
  "retire_handle",
  "unretire_handle",
  "suspend",
  "lift_suspension",
  "terminate",
  "warn_reporting",
  "restrict_reporting",
  "lift_reporting",
  // 3f Task 3 (design, section 7.9): an admin's reinstatement after an order, in a correction of the order decision. Never
  // disable_by_order, which only the effect of an order writes (and the params' schema refuses here).
  "reinstate_by_order",
  // 2d Task 4 (design, sections 6.5 and 7.7): the reset of a profile picture and its reversal, named here: they are last in
  // MEASURE_KINDS and REVERSAL_KINDS, beyond the two slices' edges, which do not move.
  "reset_avatar",
  "restore_avatar",
]);

/**
 * The order in which a decision's actions are inserted (3e design, sections 7.10 and 10.4): the signed list stays in its
 * one order (by kind, then image, so one decision has one hash), where the resets come before the retirement; the
 * database takes a retirement only as its decision's first row, so that a reset of the display name after it copies the
 * placeholder and never the retired handle. So a `retire_handle` is inserted first and the others follow in the list's
 * order. Nothing signed changes: decision_holds compares the ledger with the list as a set.
 */
export function insertionOrder<T extends { kind: ActionKind }>(actions: readonly T[]): T[] {
  return [...actions.filter((action) => action.kind === "retire_handle"), ...actions.filter((action) => action.kind !== "retire_handle")];
}

/**
 * How the module's own tests reach the database's rules below the routes: `allKinds` lifts the routes' list of kinds, so
 * that a test could store every kind of 3e before the task that opened it was built. Since Task 5 the list holds every
 * kind, and the flag changes nothing; the fixtures still pass it. The routes never pass it.
 */
export interface DecideOptions {
  allKinds?: boolean;
}

/**
 * The route's refusal of a kind it does not accept; nothing when the options lift the list. Task 5 opened the marks
 * "manifestly unfounded" too: the database's check of every mark (unfounded_marks_check), and decision_holds at commit,
 * decide whether a mark can stand.
 */
export function refuseUnopened(params: { actions: readonly { kind: ActionKind }[] }, options: DecideOptions): void {
  if (options.allKinds) return;
  if (params.actions.some((action) => !ROUTE_KINDS.has(action.kind))) throw new ModerationError("invalid_decision");
}

/**
 * The lock waits one decision may meet: the subject's profile, the case, the deciding account's row, the cap's advisory
 * lock, up to three texts, the subject's account row, the post, up to four images, the key and the audit head; a review
 * meets its appeal's row in place of two of the texts. A decision that seals, lifts a seal or ends one also locks every
 * image row its seals list; that number has no bound and is not counted, and the audit row's own check of the clock
 * rolls back a transaction that outlasts the challenge.
 */
const DECISION_WAITS = 15;

/** A transaction that met a deadlock or a lock timeout is run once more only while more than this much of the challenge is left. */
export const RETRY_MARGIN_MS = 60_000;

/** One staff account's decisions of the last this long are counted, and at this many every staff account is told. */
export const BURST_WINDOW_MS = 15 * 60_000;
export const BURST_ALERT_AT = 20;
/** The burst alert goes at most once in this long for one staff account, under this key of the limit store. */
export const BURST_ALERT_WINDOW_MS = 60 * 60_000;
export const burstAlertKey = (staffId: string) => `moderation-burst:${staffId}`;

/**
 * What follows a decision's commit, outside its transaction (3c design, section 7.5, step 4). Each part runs in a try of
 * its own, so none keeps another from running, and none can undo the decision:
 *   1. the author's statement is mailed when one is owed, and the result recorded; a failure of the relay leaves it
 *      pending, and the dispatch job mails it;
 *   2. the person's decisions of the last 15 minutes are counted from the decisions themselves, by the database's
 *      clock, and at 20 every staff account, the person's own included, is told, at most once an hour for one person
 *      (the throttle is a key of the limit store): a stolen key decides at the speed of key prompts, and this mail is
 *      how the others learn of it;
 *   3. a decision that lifts a seal, or a final decision on a suspicion that holds no seal (it ends a freeze without
 *      anyone having seen the images), is told to every staff account at once, without a throttle: it cannot be undone
 *      once the images are served again. A failed send is logged and not repeated; the home screen lists every such
 *      decision for 30 days.
 * A review is a decision too, and the review route starts this after its commit: its statement answers the author's
 * appeal, it counts among the reviewer's decisions, and a review that lifts a seal is told to every staff account.
 */
export async function afterDecision(deps: Pick<ModerationDeps, "apiDb" | "auth" | "social" | "limits" | "log">, staffId: string, decisionId: string): Promise<void> {
  try {
    await sendStatement(deps, decisionId);
  } catch (err) {
    deps.log.warn({ err, decisionId }, "moderation: a decision's statement was not mailed; it stays pending for the dispatch job");
  }
  try {
    const count = await recentDecisionsBy(deps.apiDb, staffId, BURST_WINDOW_MS);
    if (count >= BURST_ALERT_AT) {
      const handle = (await handleOf(deps.apiDb, staffId)) ?? "unknown";
      await staffAlert(deps, burstAlertKey(staffId), BURST_ALERT_WINDOW_MS, { template: "moderation_burst", handle, count });
    }
  } catch (err) {
    deps.log.warn({ err, decisionId }, "moderation: a staff account's decisions could not be counted");
  }
  try {
    const found = await decisionStatement(deps.apiDb, decisionId);
    if (found) {
      const { statement, decision } = found;
      // 3f (design, section 7.9 step 6): every staff account hears of an order's measure lifted, by push and mail.
      if (statement.reversals.some((reversal) => reversal.kind === "reinstate_by_order")) {
        await staffAlert(deps, null, 0, { template: "order_reinstated", facts: { at: statement.decidedAt } });
      }
      const unsealed = statement.reversals.some((reversal) => reversal.kind === "unseal_media");
      const dismissed = statement.kind === "final" && decision.suspect && !statement.measures.some((measure) => measure.kind === "seal_media");
      if (unsealed || dismissed) {
        const handle = (await handleOf(deps.apiDb, staffId)) ?? "unknown";
        // 3f (design, section 7.2): the same way as the throttled alerts, without a key: a push to every staff phone, then
        // the mail as before.
        // 3d Task 7 (7.11 step 6, W.8): on a case whose finding came from a match the mail says that the images stay closed
        // to staff, in the place of "staff may open them" and the look of the same day.
        const matched = await decisionCaseHasMatch(deps.apiDb, decisionId);
        const sent = await staffAlert(deps, null, 0, { template: "moderation_csam_lifted", handle, at: new Date(statement.decidedAt), what: unsealed ? "unsealed" : "dismissed", ...(matched ? { matched: true as const } : {}) });
        if (sent === "unsent") deps.log.error({ decisionId }, "moderation: no staff account was alerted to a decision that lifted the protection of reported images; the home screen lists it");
      }
    }
  } catch (err) {
    deps.log.error({ err, decisionId }, "moderation: the staff accounts were not told of a decision that lifted the protection of reported images; the home screen lists it");
  }
}

/**
 * What the first lock of an answer to a decision needs to know of the decision it answers, read before the transaction
 * (a decision's ledger rows never change): whether it holds an announced suspension or termination, whose reply the
 * answer may answer and whose start it may then fix.
 */
export interface AnsweredFacts {
  kind: "correction" | "review";
  outcome: string;
  holdsAnnounced: boolean;
}

/**
 * The first lock a decision takes on its subject's profile row (3e design, section 5, the lock order, item 1): FOR UPDATE
 * when its signed actions hold a suspension or a termination, and (Task 4) when it answers a decision that holds an
 * announced one and may leave it in force: a correction or a review that keeps it, or a review that reverses part of it.
 * Whether a reply waits, and whether it came before the start, is read inside, after the lock: decisions_apply then takes
 * the row FOR UPDATE for an on-time reply, as the ledger's trigger takes it again for a suspension, and an upgrade behind
 * the case's lock deadlocks with followers' counter updates (LAB B2). FOR NO KEY UPDATE for every other decision, a lift
 * and an overruling included.
 */
export function subjectLockMode(actions: readonly { kind: ActionKind }[], answered: AnsweredFacts | null = null): AccountLockMode {
  if (actions.some((action) => action.kind === "suspend" || action.kind === "terminate")) return "update";
  if (answered !== null && answered.holdsAnnounced && (answered.outcome === "kept" || (answered.kind === "review" && answered.outcome === "partly_reversed"))) return "update";
  return "no key update";
}

/**
 * The transaction of a confirmed decision or review, on the API's pool. In this order:
 *   1. every lock wait is bounded by a fifteenth of what is left of the challenge, at most 15 seconds; with under a
 *      millisecond left nothing is written ("late");
 *   2. the subject account's profile row in `mode` (subjectLockMode), the transaction's first lock: FOR NO KEY UPDATE, so
 *      two decisions about one account run one after the other while likes and follows of others never wait for it, or
 *      (3e) FOR UPDATE for a decision that takes a suspension, which every write of the account then waits for;
 *   3. `write`: the decision's row, whose triggers lock the case and check everything about it, and one row for each
 *      measure or reversal, in the params' order, whose triggers derive what the post and its images now are;
 *   4. last, the audit row, through public.append_confirmed_audit, on the target the key confirmed, with the params
 *      exactly as confirmed and the decision's id.
 * A deadlock, or a lock timeout the bound cut short, runs the transaction once more with the same confirmation while more
 * than a minute of the challenge is left: nothing was written, and no other request can use the spent challenge. Every
 * code a trigger raises is thrown as its ModerationError.
 *
 * Once the decision has committed, what follows it (afterDecision) is started and not waited for: the answer to the
 * person who decided never waits for a mail relay.
 */
export async function recordConfirmed(
  deps: ModerationDeps,
  session: ActiveStaffSession,
  confirmed: StaffStepUpConfirmed,
  ctx: DecideContext,
  subject: string | null,
  write: (tx: DbTx, decisionId: string) => Promise<void>,
  mode: AccountLockMode = "no key update",
  target: { type: "post" | "account"; id: string } | null = null,
): Promise<DecideOutcome> {
  const action = confirmed.action;
  if (action !== "case_decided" && action !== "appeals_reviewed") throw new Error("only a decision or a review is recorded this way");
  for (let attempt = 1; ; attempt++) {
    try {
      const outcome = await deps.apiDb.transaction(async (tx): Promise<DecideOutcome> => {
        if (!(await boundLockWaits(tx, confirmed.expiresAt, DECISION_WAITS))) return "late";
        if (subject !== null) await deps.social.lockAccounts(tx, [subject], mode);
        const decisionId = randomUUID();
        await write(tx, decisionId);
        // 3f Task 6: a decision that takes a lost one again closes its gap here, after its ledger rows and before its audit
        // row, so that the decision's own check at commit covers the closing; gap_close refuses a gap that is not open and
        // a decision that does not fit it (gap_mismatch).
        const gap = ctx.gap ?? null;
        if (gap !== null) await closeGap(tx, gap, decisionId, session.userId);
        await appendConfirmedAudit(tx, {
          actorId: session.userId,
          keyId: confirmed.keyId,
          action,
          targetType: confirmed.target.type,
          targetId: confirmed.target.id,
          // 3f (section 10.5): from Task 3 on the row names its case's target, so a lost decision's row says what it was
          // about after a restore; decision_holds compares it with the case at commit.
          metadata: { params: confirmed.params, decisionId, ...(target !== null ? { target } : {}), ...(gap !== null ? { gapId: gap } : {}) },
          staffSession: session.handle,
          actionHash: confirmed.actionHash,
          stepUp: confirmed.assertion,
          requestId: ctx.requestId,
          expiresAt: confirmed.expiresAt,
        });
        return { decisionId };
      });
      if (typeof outcome !== "string") deps.background.start(() => afterDecision(deps, session.userId, outcome.decisionId));
      return outcome;
    } catch (err) {
      const refusal = raisedMessage(err);
      if (refusal === "staff_confirmation_ended") return "ended";
      if (refusal === "staff_confirmation_late") return "late";
      if (refusal !== null && isModerationErrorCode(refusal)) {
        // A trigger's detail names the rule that did not hold (3e: a basis, the days, open_reports). It is logged and kept
        // on the error for the module's own tests; no answer carries it.
        const detail = raisedDetail(err);
        if (detail !== null) deps.log.info({ refusal, detail }, "moderation: a confirmed decision was refused");
        throw Object.assign(new ModerationError(refusal), { detail });
      }
      // A bound reached on either limit (lock_timeout, or the statement_timeout beside it) changed nothing either.
      if (!isDeadlock(err) && !isBoundReached(err)) throw err;
      if (attempt > 1 || confirmed.expiresAt.getTime() - deps.now().getTime() <= RETRY_MARGIN_MS) return "late";
    }
  }
}

/**
 * POST /api/staff/cases/:case/decisions, once its step-up verified: records the decision the session's key confirmed, in
 * the one transaction of recordConfirmed, with the decision's audit row as case_decided on the case.
 *
 * A seal taken while deciding stands for the reports that had arrived by the decision's time, which is its transaction's
 * start. When the only report it rests on committed while this transaction waited for its locks, the seal would be
 * recorded and not be in force: the images would stay served while the statement told their author they are sealed. The
 * database refuses such a seal itself, as its row joins the ledger (case_changed, with nothing stored); the console reads
 * the case again, and the person confirms again in a transaction that begins after the report.
 */
export async function decide(deps: ModerationDeps, session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: DecideContext, options: DecideOptions = {}): Promise<DecideOutcome> {
  // A confirmation of anything else never decides a case: that would be a wiring fault, not a refusal.
  if (confirmed.action !== "case_decided" || confirmed.target.type !== "case" || confirmed.keyId !== session.keyId) {
    throw new Error("a decision needs a step-up that confirmed it");
  }
  const params = CaseDecidedParams.parse(confirmed.params);
  // A decision is made under the texts the API serves now: the redress texts always, and the rulebook unless it is a
  // correction, which carries the version of the decision it corrects.
  if (params.redressVersion !== REDRESS_VERSION || (params.kind !== "correction" && params.rulesVersion !== RULES_VERSION)) throw new ModerationError("invalid_decision");
  refuseUnopened(params, options);

  const caseId = confirmed.target.id;
  const target = await caseTarget(deps.apiDb, caseId);
  if (!target) throw new ModerationError("not_found");
  // A case's target never changes, and a post's author never does, so the subject is read before the transaction.
  const subject = target.type === "account" ? target.id : await deps.social.postAuthor(target.id);
  // A correction's first lock depends on the decision it corrects, whose ledger rows never change: read before too.
  const answered: AnsweredFacts | null =
    params.kind === "correction" && params.reviewsDecisionId !== null ? { kind: "correction", outcome: params.outcome, holdsAnnounced: await holdsAnnouncedStanding(deps.apiDb, params.reviewsDecisionId) } : null;

  return recordConfirmed(
    deps,
    session,
    confirmed,
    ctx,
    subject,
    async (tx, decisionId) => {
      await insertDecision(tx, { id: decisionId, caseId, decidedBy: session.userId, params });
      // The marks come after the decision's row, whose trigger answered the items, and before its measures.
      await insertMarks(tx, decisionId, params.unfounded);
      for (const action of insertionOrder(params.actions)) await insertAction(tx, decisionId, action, params.replaced);
    },
    subjectLockMode(params.actions, answered),
    target,
  );
}
