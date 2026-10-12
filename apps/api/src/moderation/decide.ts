import { randomUUID } from "node:crypto";
import { CaseDecidedParams, MEASURE_KINDS, REVERSAL_KINDS, type ActionKind } from "@korbat/contracts";
import type { DbTx } from "@korbat/db";
import { REDRESS_VERSION, RULES_VERSION } from "@korbat/rules";
import type { ActiveStaffSession, StaffStepUpConfirmed } from "../auth";
import { boundLockWaits, isDeadlock, isLockNotAvailable } from "../lib/lock-bounds";
import { staffAlert } from "./alerts";
import { ModerationError, isModerationErrorCode, type ModerationDeps } from "./context";
import { appendConfirmedAudit, caseTarget, handleOf, insertAction, insertDecision, insertMarks, raisedDetail, raisedMessage, recentDecisionsBy } from "./repo";
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
 * The kinds of the ledger the decide and review routes accept (3e design, section 7.1 item 2). The params' schema knows
 * all 22 kinds from the first task of 3e on; this list holds 3c's twelve and a strike with its overruling, and each later
 * task of 3e adds the kinds whose flow it builds, so no route records a measure whose flow is not built yet. Any other
 * kind is refused before the transaction (invalid_decision), as are a correction that keeps its decision, a non-empty
 * list of marks and a `replaced` until the tasks that open them.
 */
export const ROUTE_KINDS: ReadonlySet<ActionKind> = new Set<ActionKind>([...MEASURE_KINDS.slice(0, 7), ...REVERSAL_KINDS.slice(0, 5), "strike", "overrule"]);

/**
 * How the module's own tests reach the database's rules below the routes: `allKinds` lifts the routes' list of kinds and
 * the outcomes and members not open yet, so that a test stores every kind of 3e as a route will once its task is built.
 * The routes never pass it.
 */
export interface DecideOptions {
  allKinds?: boolean;
}

/** The route's refusal of what it does not accept yet; nothing when the options lift the list. */
export function refuseUnopened(params: { actions: readonly { kind: ActionKind }[]; outcome: string; kind?: string; unfounded?: readonly string[]; replaced?: boolean }, options: DecideOptions): void {
  if (options.allKinds) return;
  if (params.actions.some((action) => !ROUTE_KINDS.has(action.kind))) throw new ModerationError("invalid_decision");
  // A correction that keeps its decision answers a reply or withdraws marks: neither exists before its task.
  if (params.kind === "correction" && params.outcome === "kept") throw new ModerationError("invalid_decision");
  if ((params.unfounded ?? []).length > 0 || params.replaced === true) throw new ModerationError("invalid_decision");
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
const RETRY_MARGIN_MS = 60_000;

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
export async function afterDecision(deps: Pick<ModerationDeps, "apiDb" | "auth" | "limits" | "log">, staffId: string, decisionId: string): Promise<void> {
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
      const unsealed = statement.reversals.some((reversal) => reversal.kind === "unseal_media");
      const dismissed = statement.kind === "final" && decision.suspect && !statement.measures.some((measure) => measure.kind === "seal_media");
      if (unsealed || dismissed) {
        const handle = (await handleOf(deps.apiDb, staffId)) ?? "unknown";
        const accepted = await deps.auth.mailStaff({ template: "moderation_csam_lifted", handle, at: new Date(statement.decidedAt), what: unsealed ? "unsealed" : "dismissed" });
        if (accepted === 0) deps.log.error({ decisionId }, "moderation: no staff account was mailed about a decision that lifted the protection of reported images; the home screen lists it");
      }
    }
  } catch (err) {
    deps.log.error({ err, decisionId }, "moderation: the staff accounts were not told of a decision that lifted the protection of reported images; the home screen lists it");
  }
}

/**
 * The transaction of a confirmed decision or review, on the API's pool. In this order:
 *   1. every lock wait is bounded by a fifteenth of what is left of the challenge, at most 15 seconds; with under a
 *      millisecond left nothing is written ("late");
 *   2. the subject account's profile row FOR NO KEY UPDATE, the transaction's first lock, so two decisions about one
 *      account run one after the other while likes and follows of others never wait for it;
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
  ctx: { requestId: string },
  subject: string | null,
  write: (tx: DbTx, decisionId: string) => Promise<void>,
): Promise<DecideOutcome> {
  const action = confirmed.action;
  if (action !== "case_decided" && action !== "appeals_reviewed") throw new Error("only a decision or a review is recorded this way");
  for (let attempt = 1; ; attempt++) {
    try {
      const outcome = await deps.apiDb.transaction(async (tx): Promise<DecideOutcome> => {
        if (!(await boundLockWaits(tx, confirmed.expiresAt, DECISION_WAITS))) return "late";
        if (subject !== null) await deps.social.lockAccounts(tx, [subject], "no key update");
        const decisionId = randomUUID();
        await write(tx, decisionId);
        await appendConfirmedAudit(tx, {
          actorId: session.userId,
          keyId: confirmed.keyId,
          action,
          targetType: confirmed.target.type,
          targetId: confirmed.target.id,
          metadata: { params: confirmed.params, decisionId },
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
      if (!isDeadlock(err) && !isLockNotAvailable(err)) throw err;
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
export async function decide(deps: ModerationDeps, session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: { requestId: string }, options: DecideOptions = {}): Promise<DecideOutcome> {
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

  return recordConfirmed(deps, session, confirmed, ctx, subject, async (tx, decisionId) => {
    await insertDecision(tx, { id: decisionId, caseId, decidedBy: session.userId, params });
    // The marks come after the decision's row, whose trigger answered the items, and before its measures.
    await insertMarks(tx, decisionId, params.unfounded);
    for (const action of params.actions) await insertAction(tx, decisionId, action, params.replaced);
  });
}
