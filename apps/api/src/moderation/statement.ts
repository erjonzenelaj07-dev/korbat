import { MEASURES, type DecisionStatement, type MeasureKind, type ReversalKind, type RuleId, type StandingBasis } from "@korbat/contracts";
import { statementParagraphs } from "@korbat/rules";
import type { DecisionMessage } from "../auth";
import type { ModerationDeps } from "./context";
import { beginMailRecord, lockPendingAuthorMail, recordAuthorMail, type MailState } from "./repo";
import { endedMeasures, endedStanding, repliedTo, statementActions, statementDecision, type StatementDecisionRow } from "./statement-repo";

/**
 * The data a statement of reasons and its mail are rendered from (3c design, sections 7.5 and 10). A decision is the
 * statement: every element is a column, a ledger row or a saved text, read here into the one shape that @korbat/rules
 * renders for the mail, the author's screen and the console's preview. Nothing read here is changed by a later event, so
 * a statement reads as it was sent whenever it is rendered.
 */

/** A decision's statement with what mailing it needs: whom it is about, and whether its mail is still owed. */
export interface StatementFound {
  statement: DecisionStatement;
  decision: StatementDecisionRow;
}

/** Whether a field reset's old value was still kept when the decision that ends or lifts it was made, and where it can be read. */
function resetFacts(kind: MeasureKind | ReversalKind, held: { decisionId: string; ruleId: string | null; noEffect: string | null; snapshotKept: boolean }) {
  const target = MEASURES[kind].target;
  if (target !== "display_name" && target !== "bio") return { resetDecisionId: null, oldValueKept: false, resetRuleId: null };
  // The reset's own snapshot holds the old value, by its compare-and-set; a reset that changed nothing removed none.
  return { resetDecisionId: held.decisionId, oldValueKept: held.noEffect === null && held.snapshotKept, resetRuleId: held.ruleId as RuleId | null };
}

/** The statement's data of one decision, or null when no decision has the id. */
export async function decisionStatement(q: ModerationDeps["apiDb"], decisionId: string): Promise<StatementFound | null> {
  const decision = await statementDecision(q, decisionId);
  if (!decision) return null;
  const actions = await statementActions(q, decisionId);
  const ended = decision.kind === "final" ? await endedMeasures(q, decisionId) : [];
  // 3e: the standing measures whose basis a reversal of this decision broke; absent from a statement that holds none.
  const brokenBasis = decision.kind === "review" || decision.kind === "correction" ? await endedStanding(q, decisionId) : [];
  // 3e Task 4: the reply this correction or review answered by keeping or reversing its measure; absent when none.
  const replied = decision.kind === "review" || decision.kind === "correction" ? await repliedTo(q, decisionId) : null;
  // The facts and the reason are told with a decision that restricts (it holds a measure), with a correction and with a
  // review. Those of a decision without a measure are the case's record, for staff: such a decision tells its author at
  // most that what korbat did while deciding has ended, so the statement's data holds neither, and no mail, screen or
  // export that is rendered from it can carry them.
  const told = decision.kind === "correction" || decision.kind === "review" || actions.some((action) => MEASURES[action.kind].lifts === null);
  const statement: DecisionStatement = {
    kind: decision.kind,
    outcome: decision.outcome as DecisionStatement["outcome"],
    ground: decision.ground as DecisionStatement["ground"],
    ruleId: decision.ruleId as RuleId | null,
    rulesVersion: decision.rulesVersion,
    redressVersion: decision.redressVersion,
    legalReference: decision.legalReference,
    facts: told ? decision.facts : null,
    reason: told ? decision.reason : null,
    source: decision.source as DecisionStatement["source"],
    decidedAt: decision.decidedAt,
    post: decision.targetType === "post" && decision.postCreatedAt !== null ? { id: decision.targetId, createdAt: decision.postCreatedAt } : null,
    measures: actions
      .filter((action) => MEASURES[action.kind].lifts === null)
      .map((action) => ({
        kind: action.kind as MeasureKind,
        mediaId: action.mediaId,
        noEffect: action.noEffect,
        sealed: action.kind === "seal_media" ? { posts: action.sealedPosts, images: action.sealedImages, deletedImages: action.sealedDeletedImages } : null,
        // 3e: what the ledger fixed for good about a strike, a standing measure and a retirement, so its statement reads as
        // it was sent (a retirement's sentence reads its end from whether the decision suspends or terminates at once).
        ...(action.kind === "strike" ? { endsAt: action.endsAt, activeThen: action.activeThen } : {}),
        ...(action.kind === "suspend" || action.kind === "terminate"
          ? {
              announced: action.announced,
              days: action.days,
              basis: action.basis as StandingBasis | null,
              earliestStart: action.earliestStart,
              endsAt: action.endsAt,
              restsOn: action.restsOn === null ? null : action.restsOn.map((entry) => ({ ...entry, ruleId: entry.ruleId as RuleId | null })),
            }
          : {}),
        ...(action.kind === "retire_handle" ? { handle: action.handle, placeholder: action.placeholder } : {}),
      })),
    reversals: actions
      .filter((action) => MEASURES[action.kind].lifts !== null)
      .map((action) => ({
        kind: action.kind as ReversalKind,
        mediaId: action.mediaId,
        ...(action.lifted === null ? { resetDecisionId: null, oldValueKept: false, resetRuleId: null } : resetFacts(action.kind, action.lifted)),
        // 3e: the handle a reversal of a retirement gives back.
        ...(action.kind === "unretire_handle" ? { handle: action.handle } : {}),
        // 3e: what a lift of a suspension lifted, where its period stood then, and whether it was a withdrawal for another measure.
        ...(action.kind === "lift_suspension"
          ? { liftedKind: action.liftedKind, liftedDecidedAt: action.liftedDecidedAt, periodThen: action.periodThen, replaced: action.replaced, replyFiledAt: action.replyFiledAt }
          : {}),
      })),
    endedMeasures: ended.map((measure) => ({ kind: measure.kind as MeasureKind, mediaId: measure.mediaId, ...resetFacts(measure.kind, measure) })),
    ...(brokenBasis.length > 0 ? { endedStanding: brokenBasis } : {}),
    ...(replied !== null ? { repliedTo: replied } : {}),
    reviewed:
      decision.reviewed === null
        ? null
        : {
            kind: decision.reviewed.kind,
            ground: decision.reviewed.ground as DecisionStatement["ground"],
            ruleId: decision.reviewed.ruleId as RuleId | null,
            // The reviewed decision's own rulebook version: its rule is rendered as it was worded when that decision was made.
            rulesVersion: decision.reviewed.rulesVersion,
            legalReference: decision.reviewed.legalReference,
            decidedAt: decision.reviewed.decidedAt,
          },
  };
  return { statement, decision };
}

/**
 * The subject of the statement's mail, by the decision's kind and outcome (3c design, section 7.15), as a key of the mail
 * template's own table: a seal first, whatever else the decision holds; then a decision taken while deciding, on a post
 * or on an account; a final restriction; a final decision that restricts nothing but ends or lifts what was done while
 * deciding, and a correction of a decision taken while deciding; a reversal of a final decision; and a kept appeal.
 */
export function mailSubjectOf(statement: DecisionStatement): Extract<DecisionMessage, { template: "moderation_decision" }>["subject"] {
  const seals = statement.measures.some((measure) => measure.kind === "seal_media");
  const post = statement.post !== null;
  if (statement.kind === "interim") return seals ? "seal_deciding" : post ? "post_deciding" : "profile_deciding";
  if (statement.kind === "final") {
    if (seals) return "seal_final";
    if (statement.outcome === "restricted") return post ? "post_restricted" : "profile_restricted";
    return "lifted_deciding";
  }
  if (statement.kind === "correction") return statement.reviewed?.kind === "interim" ? "lifted_deciding" : "reversed";
  return statement.outcome === "kept" ? "appeal_kept" : "reversed";
}

/**
 * The template a decision's statement is mailed under (3e design, sections 7.15 and 18, W.6): the first row of 7.15's
 * table that fits, and moderation_decision otherwise, so that a strike, a retirement and their reversals ride on 3c's
 * mail. In order: an announced suspension or termination; one taken at once; the answer to a reply (a statement with
 * `repliedTo`); a lift of one (a withdrawal signed `replaced` under its own lead), or a decision whose reversal ended one by
 * breaking its basis. The reporting measures join with the task that builds them.
 */
export function mailTemplateOf(statement: DecisionStatement, paragraphs: readonly string[]): DecisionMessage {
  const standing = statement.measures.find((measure) => measure.kind === "suspend" || measure.kind === "terminate");
  if (statement.kind === "final" && standing !== undefined && standing.announced === true) {
    const measure = standing.kind === "terminate" ? "terminate" : "suspend";
    if (standing.earliestStart === undefined || standing.earliestStart === null) throw new Error("an announced measure's mail names its earliest start: the statement's data holds none");
    // The window is the row's own: its earliest start less its decision's time, in hours.
    const window = Math.round((Date.parse(standing.earliestStart) - Date.parse(statement.decidedAt)) / 3_600_000);
    return { template: "suspension_announced", measure, days: measure === "terminate" ? null : (standing.days ?? null), window, earliestStart: standing.earliestStart, paragraphs };
  }
  if (statement.kind === "final" && standing !== undefined && standing.announced === false) {
    const measure = standing.kind === "terminate" ? "terminate" : "suspend";
    return { template: "suspension_started_at_once", measure, days: standing.days ?? null, endsAt: standing.endsAt ?? null, paragraphs };
  }
  const lift = statement.reversals.find((reversal) => reversal.kind === "lift_suspension");
  if (statement.repliedTo !== undefined) {
    // A review that reverses part but leaves the measure in force answers the reply as a kept answer does.
    const lifted = lift !== undefined && lift.replaced !== true;
    return { template: "reply_answered", outcome: lifted ? "reversed" : "kept", paragraphs };
  }
  if ((statement.kind === "review" || statement.kind === "correction") && lift !== undefined && lift.replaced === true && lift.liftedDecidedAt) {
    return {
      template: "suspension_lifted",
      measure: lift.liftedKind === "terminate" ? "terminate" : "suspend",
      why: "replaced",
      decidedAt: lift.liftedDecidedAt,
      replied: lift.replyFiledAt !== undefined && lift.replyFiledAt !== null,
      paragraphs,
    };
  }
  if ((statement.kind === "review" || statement.kind === "correction") && lift !== undefined && lift.periodThen) {
    return { template: "suspension_lifted", measure: lift.liftedKind === "terminate" ? "terminate" : "suspend", why: "lifted", period: lift.periodThen.state, paragraphs };
  }
  const broken = (statement.endedStanding ?? []).find((entry) => entry.kind === "suspend" || entry.kind === "terminate");
  if (broken !== undefined) return { template: "suspension_lifted", measure: broken.kind === "terminate" ? "terminate" : "suspend", why: "basis", period: broken.periodThen.state, paragraphs };
  return { template: "moderation_decision", subject: mailSubjectOf(statement), paragraphs };
}

/**
 * Mails a decision's statement to its author when that mail is still owed, and records what became of it: `sent`,
 * `no_address` for an account that is gone, `failed` when the relay refused the address for good. A failure of the relay
 * is thrown, and the mail stays pending for the dispatch job. Answers what was recorded, or "none" when nothing was owed.
 *
 * The decision's row is taken before the mail is sent, in the transaction that records the result (beginMailRecord): a
 * database that cannot write refuses that, and nothing is sent, so a mail is never sent again and again for want of a
 * record. Two senders of one statement (the decision's own request and the dispatch job) then send it once: the second
 * waits for the row and finds the mail recorded.
 *
 * 3e (design, section 5, the lock order, item 4): for a decision that holds an announced suspension or termination, the
 * outcome fixes the measure's start (the database's decisions_mail_standing derives the profile's columns), so the
 * transaction takes the subject's profile FOR NO KEY UPDATE first and the decision's row after it, as a deciding
 * transaction takes the profile before it touches decisions.
 */
export async function sendStatement(deps: Pick<ModerationDeps, "apiDb" | "auth" | "social">, decisionId: string): Promise<MailState | "none"> {
  const found = await decisionStatement(deps.apiDb, decisionId);
  if (!found || found.decision.authorMail !== "pending") return "none";
  const subject = found.decision.subjectId;
  // The statement is rendered before anything is sent: one that cannot be rendered is no mail, and stays pending.
  const message = mailTemplateOf(found.statement, statementParagraphs(found.statement));
  const announced = found.statement.kind === "final" && found.statement.measures.some((measure) => (measure.kind === "suspend" || measure.kind === "terminate") && measure.announced === true);
  return deps.apiDb.transaction(async (tx) => {
    await beginMailRecord(tx);
    if (announced && subject !== null) await deps.social.lockAccounts(tx, [subject], "no key update");
    if (!(await lockPendingAuthorMail(tx, decisionId))) return "none";
    const result = subject === null ? "no_address" : await deps.auth.mailAccount(subject, message);
    // A stop of the address never holds a statement back, so "suppressed" is never answered for it.
    const state: MailState = result === "sent" ? "sent" : result === "refused" ? "failed" : "no_address";
    await recordAuthorMail(tx, decisionId, state);
    return state;
  });
}
