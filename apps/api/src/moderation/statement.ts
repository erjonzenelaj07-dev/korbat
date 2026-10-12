import { MEASURES, type DecisionStatement, type MeasureKind, type ReversalKind, type RuleId } from "@korbat/contracts";
import { statementParagraphs } from "@korbat/rules";
import type { DecisionMessage } from "../auth";
import type { ModerationDeps } from "./context";
import { beginMailRecord, lockPendingAuthorMail, recordAuthorMail, type MailState } from "./repo";
import { endedMeasures, statementActions, statementDecision, type StatementDecisionRow } from "./statement-repo";

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
      })),
    reversals: actions
      .filter((action) => MEASURES[action.kind].lifts !== null)
      .map((action) => ({
        kind: action.kind as ReversalKind,
        mediaId: action.mediaId,
        ...(action.lifted === null ? { resetDecisionId: null, oldValueKept: false, resetRuleId: null } : resetFacts(action.kind, action.lifted)),
      })),
    endedMeasures: ended.map((measure) => ({ kind: measure.kind as MeasureKind, mediaId: measure.mediaId, ...resetFacts(measure.kind, measure) })),
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
export function mailSubjectOf(statement: DecisionStatement): DecisionMessage["subject"] {
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
 * Mails a decision's statement to its author when that mail is still owed, and records what became of it: `sent`,
 * `no_address` for an account that is gone, `failed` when the relay refused the address for good. A failure of the relay
 * is thrown, and the mail stays pending for the dispatch job. Answers what was recorded, or "none" when nothing was owed.
 *
 * The decision's row is taken before the mail is sent, in the transaction that records the result (beginMailRecord): a
 * database that cannot write refuses that, and nothing is sent, so a mail is never sent again and again for want of a
 * record. Two senders of one statement (the decision's own request and the dispatch job) then send it once: the second
 * waits for the row and finds the mail recorded.
 */
export async function sendStatement(deps: Pick<ModerationDeps, "apiDb" | "auth">, decisionId: string): Promise<MailState | "none"> {
  const found = await decisionStatement(deps.apiDb, decisionId);
  if (!found || found.decision.authorMail !== "pending") return "none";
  const subject = found.decision.subjectId;
  // The statement is rendered before anything is sent: one that cannot be rendered is no mail, and stays pending.
  const message: DecisionMessage = { template: "moderation_decision", subject: mailSubjectOf(found.statement), paragraphs: statementParagraphs(found.statement) };
  return deps.apiDb.transaction(async (tx) => {
    await beginMailRecord(tx);
    if (!(await lockPendingAuthorMail(tx, decisionId))) return "none";
    const result = subject === null ? "no_address" : await deps.auth.mailAccount(subject, message);
    // A stop of the address never holds a statement back, so "suppressed" is never answered for it.
    const state: MailState = result === "sent" ? "sent" : result === "refused" ? "failed" : "no_address";
    await recordAuthorMail(tx, decisionId, state);
    return state;
  });
}
