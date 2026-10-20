import {
  AppealsReviewedParams,
  CaseDecidedParams,
  MEASURES,
  MEASURE_KINDS,
  ORDER_DRAFTS,
  RETIRED_HANDLE_PREFIX,
  RULE_DEFAULT_CATEGORY,
  SEAL_DRAFTS,
  STANDING_DAYS,
  STANDING_DRAFTS,
  STANDING_RULES,
  appealDeadline,
  compareDecisionActions,
  isRetiredPlaceholder,
  sealFactsDraft,
  snapshotDigest,
  statementMatchKind,
  staffTextProblem,
  textDigest,
  type ActionKind,
  type CaseAppeal,
  type CaseDecision,
  type CaseDecisionAction,
  type CaseItem,
  type CaseSignal,
  type CaseSnapshot,
  type CaseView,
  type DecisionActionParams,
  type MatchAnswerReason,
  type MeasureTarget,
  type MeasureKind,
  type OrderGround,
  type ReversalKind,
  type RuleId,
  type StaffMe,
  type StaffTextDraft,
  type TdbCategory,
} from "@korbat/contracts";
import { REDRESS_VERSION, RULES_VERSION, STATEMENT_WORDS, type StatementInput } from "@korbat/rules";
import type { StaffApi } from "./api";
import { AUTOMATION_WORDS, codeOf, COMPOSER_WORDS, describeError, messageFor, NOTE_WORDS, STANDING_WORDS } from "./messages";
import { parseCaseId, type CaseId } from "./router";
import { decideWithKey, reviewWithKey } from "./step-up";
import { normalised, saveStaffText, type RandomBytes } from "./texts";
import type { CredentialsLike } from "./webauthn";

/**
 * The decision composer's pure parts (3c design, sections 7.5 and 8): what it offers to whom, the params it builds from
 * what the page shows, the statement it previews, and the confirmation by the key. The page builds every param itself,
 * from the case it displayed and from digests it computed, so what the key confirms is the console's own reading and
 * never a value an answer chose. The database checks every rule again; what is decided here is only what is offered.
 */

export type StaffRole = StaffMe["role"];

/** The texts a decision or a correction carries, by their kind. */
export const DRAFT_TEXT_KINDS = ["facts", "reason", "legal_reference", "review_reason"] as const;
export type DraftTextKind = (typeof DRAFT_TEXT_KINDS)[number];

/** A text as it was saved on the case: its id, the text as saved, and the salt and digest the console drew and computed. */
export interface SavedText {
  id: string;
  text: string;
  salt: string;
  digest: string;
}

/**
 * The composer's draft for one case, which the store keeps across a sign-in by the same handle: the kind of decision,
 * what it decides and does, each text as its person typed it, and the texts already saved. A correction names the
 * decision it corrects, and its actions are reversals; a review names the decision whose appeal it answers, says which
 * of the three answers it gives (`review`), and its actions are reversals too; any other draft's are measures, and the
 * lifts of withholds taken while deciding.
 */
export interface CaseDraft {
  caseId: CaseId;
  kind: "interim" | "final" | "correction" | "review";
  reviewsDecisionId: string | null;
  /** A review's answer, as its person chose it: keep the decision, reverse part of it, or reverse it. */
  review?: AppealsReviewedParams["outcome"];
  outcome: "restricted" | "no_violation" | "not_evident";
  ground: "incompatible" | "illegal";
  ruleId: RuleId;
  category: TdbCategory;
  /** The checkbox of a decision on the law: terrorist content. */
  terrorist: boolean;
  actions: DecisionActionParams[];
  written: Record<DraftTextKind, string>;
  texts: Partial<Record<DraftTextKind, SavedText>>;
  /** 3e: a correction that answers the person's reply: Keep (the outcome `kept`, nothing lifted) or Reverse (the lift). */
  answer?: "kept" | "reversed";
  /** 3e: a correction that withdraws an announced measure for another, signed `replaced`. */
  replaced?: boolean;
  /** 3e Task 5: the items a final decision that finds no breach marks "manifestly unfounded", which the key signs. */
  unfounded?: string[];
  /** 3e Task 5: a correction kept that withdraws every mark of the "No breach" decision it corrects. */
  withdrawMarks?: boolean;
  /** 3f Task 3: a correction that reinstates a post after an order, its ground signed on its one action. */
  reinstate?: boolean;
  /**
   * 3d Task 7 (section 8.4): the reason of an answer without a seal on a case whose match acts, one of
   * MATCH_ANSWER_REASONS, which the key signs. Nothing is chosen when the composer opens.
   */
  matchAnswerReason?: MatchAnswerReason | null;
}

/** The composer's own sentences, each written once. The seal's drafts are the contracts', and the statement's words the rulebook package's. */
export const COMPOSER = {
  closed: "This case is closed. A new report about its target opens a new case; a restriction of this one that is still in force can be corrected.",
  adminFinal: "A final decision on this case, whatever its outcome, is an admin's.",
  unseen: "This post's images cannot be opened now. A report about an image that you answer now is answered unseen: its sender is told so and may ask again.",
  noEffect:
    "This changes nothing anyone sees now. It is recorded as a measure of its own, stays in force should the other restriction be reversed, and its author is told (not for a measure taken while deciding on a deleted post).",
  noteAdvicePost:
    "To record that you read a new urgent item, save your Art. 18 check as a note: a note saved after the item arrived ends its urgent-lane mails. A measure taken while deciding here changes nothing and mails its author at once.",
  noteAdviceAccount:
    "To record that you read a new urgent item, save your Art. 18 check as a note: a note saved after the item arrived ends its urgent-lane mails. Reset the display name or bio while deciding only when it carries what was reported: a reset mails its author at once.",
  onlySealEnds: "Only the seal, a recorded choice not to seal, or an admin's answer ends the urgent mails.",
  noteEnds: "To record that you read a new urgent item, save your Art. 18 check as a note: a note saved after the item arrived ends its urgent-lane mails.",
  neverWrite: "Never write that the images are child sexual abuse material: nobody at korbat has seen them.",
  declineWords:
    "Record why you do not seal now. This ends the urgent mails for the reports that have arrived so far, until an image is posted that this case reaches; an admin still answers the case. Every staff member sees this choice on the home screen for 30 days.",
  declined: "Your choice not to seal is recorded.",
  admin: {
    endsFreeze: "A final decision without a seal ends this case's freeze: staff may then open these images unless another open report or a seal still covers them, and every staff account is mailed.",
    unseen:
      "You decide without seeing the images. Seal for good, and report, when the report's words, the post's text or alt texts, or the account's conduct give a concrete reason to believe the report; answer without a seal when they give none. Say which it was in the facts.",
    answersEarlier: "Your answer also answers the reports on other grounds that arrived before the newest report of this kind, unseen; their senders are told so and may ask again.",
    afterwards:
      "After an answer without a seal the case's images may be opened: whoever is on duty opens the case's target the same day and, where an image breaks a rule or the law, opens a finding on the post and decides it (if it is what the report said, a finding citing R2, which freezes again). When a new report of this kind arrives before that decision is made, the admin's next answer carries the measure for what staff saw, and its facts say when the images were seen. An admin's answer never restricts under another rule on a report's words alone about an image nobody at korbat has opened: that report is answered unseen, and its sender may ask again.",
  },
  personalData: `${COMPOSER_WORDS.personalDataRule} ${COMPOSER_WORDS.toAuthor}`,
  staysOpen: (throughSeq: number, left: number) =>
    `This decision answers the items up to the newest report of child sexual abuse material (item ${throughSeq}). The reports on other grounds that arrived after it stay open (${left} ${left === 1 ? "item" : "items"}), to be judged with the images once the freeze has ended.`,
  sealInError: "Lift a seal taken while deciding only when it was taken in error: on the wrong case, or on a report that gives no reason to believe it.",
  sealForGood:
    "A seal for good is lifted only on the authority's answer that the images are not child sexual abuse material. Say in the reason that the authority has answered, and the date of its answer. Never write its reference or anything that names a person: the reference stays in the operator's records, off the server.",
  previewNeedsMeasure: "The statement appears here once a measure is chosen.",
  incomplete:
    "This decision is not complete yet: a restriction needs a measure, its facts and its reason, and on the law its legal reference; a correction needs something to lift and its reason; a review needs its reason, and lifts nothing when it keeps the decision, something when it reverses part, and everything still in force when it reverses; an answer to a report of child sexual abuse material needs its facts.",
  freshSnapshot: "The case's newest snapshot could not be shown, so a fresh one was taken and is shown above. Check it, then confirm again.",
  recorded: "The decision is recorded.",
  reviewed: "The review is recorded: the appeal is answered, and its author is told.",
  reviewLabel: "Review the appeal",
  leftForLater: (count: number) => `The reports on other grounds that arrived after the newest report of child sexual abuse material stay open (${count} ${count === 1 ? "item" : "items"}), to be judged with the images once the freeze has ended.`,
  arrivedSince: (count: number) => `${count === 1 ? "1 new item arrived" : `${count} new items arrived`} since this page read the case: ${count === 1 ? "it stays" : "they stay"} open.`,
  interimStays: (measures: string) => `The case stays open, so what was done while deciding stays in force: ${measures}.`,
  alreadyHidden: "This case already hides the post while it is decided.",
  liftLabel: "Lift what was done while deciding",
  correctLabel: "Correct this decision",
} as const;

// ---------------------------------------------------------------- what a case holds

/** The items no decision has answered yet. */
const unanswered = (view: CaseView): CaseItem[] => view.items.filter((item) => item.outcome === null);

/** The unanswered suspect items: reports and findings of child sexual abuse material that still wait for an admin. */
export const suspectOpen = (view: CaseView): CaseItem[] => unanswered(view).filter((item) => item.suspect);

/** Whether a final decision on the case would be an admin's: it holds an unanswered suspect item or one citing R5. */
export function finalNeedsAdmin(view: CaseView): boolean {
  return unanswered(view).some((item) => item.suspect || item.ruleId === "R5");
}

/** The kinds of decision offered: none on a closed case, and to someone who is no admin only "While deciding" where the final decision needs one. */
export function kindsOffered(view: CaseView, role: StaffRole): ("interim" | "final")[] {
  if (view.closedAt !== null) return [];
  return finalNeedsAdmin(view) && role !== "admin" ? ["interim"] : ["interim", "final"];
}

/**
 * The last item a final decision made now answers: the newest item the page showed or, on a case that holds an unanswered
 * suspect item, the newest of those, so that the reports on other grounds that arrived after it stay open and are judged
 * with the images once the freeze has ended.
 */
export function throughSeqOf(view: CaseView): number {
  const suspect = suspectOpen(view);
  return Math.max(0, ...(suspect.length > 0 ? suspect : view.items).map((item) => item.seq));
}

/** The unanswered items a final decision made now would leave open: those that arrived after the newest unanswered suspect item. */
export function leftOpen(view: CaseView): CaseItem[] {
  const through = throughSeqOf(view);
  return unanswered(view).filter((item) => item.seq > through);
}

/** The items a decision of this kind considers: a final one those it answers, one taken while deciding every unanswered item. */
function considered(view: CaseView, kind: "interim" | "final"): CaseItem[] {
  const through = throughSeqOf(view);
  return unanswered(view).filter((item) => kind === "interim" || item.seq <= through);
}

/** Whether the ground of the law is offered: a considered item must allege illegality. */
export const lawOffered = (view: CaseView, kind: "interim" | "final"): boolean => considered(view, kind).some((item) => item.allegesIllegal);

/** The outcomes offered: a decision taken while deciding restricts; a final one restricts or finds no breach, or, where an item alleges illegality, that it is not evident. */
export function outcomesOffered(view: CaseView, kind: "interim" | "final"): CaseDraft["outcome"][] {
  if (kind === "interim") return ["restricted"];
  return lawOffered(view, "final") ? ["restricted", "no_violation", "not_evident"] : ["restricted", "no_violation"];
}

/**
 * The outcomes the composer lists from the start: those of every kind this person may decide. Someone who may only decide
 * "While deciding" sees the restriction alone; anyone who may decide the case sees No breach, and Illegality not evident
 * where an item alleges illegality, before a kind is chosen.
 */
export function outcomesListed(view: CaseView, role: StaffRole): CaseDraft["outcome"][] {
  return kindsOffered(view, role).includes("final") ? outcomesOffered(view, "final") : ["restricted"];
}

/**
 * The measures this target and kind allow, but the seal, which has a control of its own: offered whatever the target's
 * level, but for one the database always refuses. A second withhold of the post while deciding, while this case's own
 * withhold taken while deciding is in force, is such a one; the page says instead that the case hides the post already.
 */
export function measuresOffered(view: CaseView, kind: "interim" | "final"): MeasureKind[] {
  // 3e: an account case's final decision may also retire the handle (8.3); its other standing measures come with their tasks.
  const targets = view.target.type === "post" ? ["post", "image"] : ["display_name", "bio", "handle"];
  return MEASURE_KINDS.filter((measure) => measure !== "seal_media" && MEASURES[measure][kind] && targets.includes(MEASURES[measure].target) && !(kind === "interim" && measure === "withhold" && hiddenWhileDeciding(view)));
}

/**
 * 3e (design, section 8.3): whether "Retire the handle" is open. It is greyed with [retire.none] while the profile holds a
 * placeholder: there is no handle to retire, and the database would retire the placeholder of a fresh snapshot.
 */
export const retireOpen = (view: CaseView): boolean => view.target.type === "account" && !(view.target.handle !== null && isRetiredPlaceholder(view.target.handle.toLowerCase()));

/** The handle the newest shown snapshot copied, in lower case as the database retires it; null when no snapshot shows one. */
const snapshotHandle = (view: CaseView): string | null => {
  const newest = view.snapshots[0];
  return newest && !newest.withheld && newest.handle !== null ? newest.handle.toLowerCase() : null;
};

/** [retire.moved]: the profile's handle now differs from the one the newest snapshot copied, which is the one a retirement names. */
export function retireMoved(view: CaseView): boolean {
  const copied = snapshotHandle(view);
  return view.target.type === "account" && copied !== null && view.target.handle !== null && view.target.handle.toLowerCase() !== copied;
}

/**
 * What the preview prints for a retirement's placeholder. The database makes it from the measure's id, which does not
 * exist before the decision is recorded, so the preview prints the prefix and twelve x in place of the hex digits: the
 * placeholder's length and form, and plainly not one the author could meet.
 */
export const PREVIEW_PLACEHOLDER = `${RETIRED_HANDLE_PREFIX}${"x".repeat(12)}`;

/** Whether this case hides its post while it is decided: a withhold taken while deciding is in force. */
export const hiddenWhileDeciding = (view: CaseView): boolean => interimInForce(view).some(({ action }) => action.kind === "withhold");

/**
 * The images an image measure of this kind can name: those of the newest shown snapshot, but, while deciding, not an
 * image a withhold of this case taken while deciding already holds back, which the database refuses to withhold twice.
 */
export function imagesOffered(view: CaseView, kind: "interim" | "final", measure: MeasureKind): string[] {
  const held = kind === "interim" && measure === "withhold_media" ? new Set(interimInForce(view).filter(({ action }) => action.kind === "withhold_media").map(({ action }) => action.mediaId)) : new Set<string | null>();
  return snapshotImages(view).filter((image) => !held.has(image));
}

/** Whether the seal is offered: on a case with an unanswered suspect item that reaches an image; while deciding to anyone eligible, for good to an admin. */
export function sealOffered(view: CaseView, kind: "interim" | "final", role: StaffRole): boolean {
  return suspectOpen(view).length > 0 && (view.suspicion?.reach.images ?? 0) > 0 && (kind === "interim" || role === "admin");
}

/** The images the newest shown snapshot lists, by id: what an image measure can name. */
export function snapshotImages(view: CaseView): string[] {
  const newest = view.snapshots[0];
  return newest && !newest.withheld ? (newest.media ?? []).map((image) => image.id) : [];
}

/**
 * Whether a measure would change nothing now, as far as the page can tell: the post is deleted or already not shown,
 * the image already held back by a measure of this case, the field already the placeholder, the account deleted. The
 * database decides when the measure is recorded; this is what the composer says beside it and what the preview shows.
 * `standing` is the kind of the decision the measure would belong to, which a seal's answer turns on, and so does what
 * the decision ends first. The database ends what was done while deciding before it writes a final decision's measures:
 * every such measure when the decision closes the case, and a seal taken while deciding when it answers the suspect
 * items. What ends then holds nothing back: a post that only this case's withhold hid is visible again, and the measure
 * changes what everyone sees.
 */
export function noEffectOf(view: CaseView, action: DecisionActionParams, standing: "interim" | "final" = "interim"): "already" | "deleted" | null {
  const { target } = view;
  const closes = standing === "final" && leftOpen(view).length === 0;
  const ending = new Set(standing === "final" ? interimInForce(view).filter(({ action: held }) => (held.kind === "seal_media" ? suspectOpen(view).length > 0 : closes)).map(({ action: held }) => held.id) : []);
  const spec = MEASURES[action.kind];
  if (spec.lifts !== null) return null;
  if (action.kind === "seal_media") {
    // A seal on a deleted target changes nothing anyone sees. On a post, neither does one whose images a seal of this case
    // of at least its standing already holds: any seal for one taken while deciding, a seal for good for one for good. On
    // an account a second seal may cover images posted since, which the page cannot tell: it says nothing there.
    if (target.type === "account") return target.deleted ? "deleted" : null;
    if (target.state === "deleted_by_author") return "deleted";
    const held = view.decisions.filter((decided) => decided.actions.some((other) => other.kind === "seal_media" && other.inForce));
    return held.some((decided) => standing === "interim" || decided.kind === "final") ? "already" : null;
  }
  if (target.type === "account") {
    if (target.deleted) return "deleted";
    // 3e: a retirement changes nothing when the newest snapshot's handle is retired already, which the case answer says.
    if (action.kind === "retire_handle") return view.standing?.snapshotHandleRetired ? "already" : null;
    if (action.kind === "reset_display_name") return target.displayName !== null && target.displayName === target.handle ? "already" : null;
    return action.kind === "reset_bio" && target.bio === "" ? "already" : null;
  }
  if (target.state === "deleted_by_author") return "deleted";
  // A post is withheld only by a withhold taken while deciding, and a target has one open case: by this case's own, which
  // a final decision that closes the case ends.
  const level = closes && target.level === "withheld" ? "visible" : target.level;
  if (action.kind === "withhold") return level !== null && level !== "visible" ? "already" : null;
  if (action.kind === "remove") return level === "removed" ? "already" : null;
  // An image measure: the post is not shown, or a measure in force of this case already holds the image back at least as far.
  if (level !== null && level !== "visible") return "already";
  const held = view.decisions.flatMap((decided) => decided.actions).filter((held) => held.inForce && !ending.has(held.id) && (held.kind === "seal_media" || held.mediaId === action.mediaId));
  const strong = held.some((measure) => measure.kind === "seal_media" || measure.kind === "remove_media");
  return strong || (action.kind === "withhold_media" && held.some((measure) => measure.kind === "withhold_media")) ? "already" : null;
}

/**
 * The targets whose measures a correction or a review lifts one by one, each with its own reversal (3c's). A strike falls
 * only with its whole finding: the console adds its overruling to a full reversal (overruleOf) and never offers it alone.
 * A retirement is given back with its own reversal (Task 2, 8.7), (Task 3) a suspension or a termination is lifted with
 * lift_suspension, and (Task 5) a warning about reporting or a restriction of it with lift_reporting: the first two share
 * the target `account` with the strike, so they are named by kind, and the reporting measures with them.
 */
const ONE_BY_ONE: readonly MeasureTarget[] = ["post", "image", "images", "display_name", "bio", "handle"];
const ONE_BY_ONE_KINDS: readonly ActionKind[] = ["suspend", "terminate", "warn_reporting", "restrict_reporting"];

/** Whether a decision's action is a measure that a correction or a review lifts one by one. */
const liftsOneByOne = (action: { kind: ActionKind }): boolean =>
  MEASURES[action.kind].lifts === null && (ONE_BY_ONE.includes(MEASURES[action.kind].target) || ONE_BY_ONE_KINDS.includes(action.kind));

/** The strike a decision gave that stands (no overruling reversed it): what a full reversal of that decision overrules. */
export const standingStrikeOf = (decision: CaseDecision): CaseDecisionAction | undefined => decision.actions.find((action) => action.kind === "strike" && action.inForce);

/** The overruling a reversal of a decision carries: one when it reverses the decision whole and the decision's strike stands. */
function overruleOf(decision: CaseDecision | undefined, reversesWhole: boolean): DecisionActionParams[] {
  return decision && reversesWhole && standingStrikeOf(decision) ? [{ kind: "overrule", mediaId: null }] : [];
}

/**
 * The strike line under "Restrict" (3e design, section 8.2), by its key in STANDING_WORDS.strike, or null where the page
 * shows none: on an account case, and for an outcome that restricts nothing. It is not a choice: "due" is exactly when the
 * console signs a strike, and the database refuses any other list (strike_mismatch). A decision answers a report of child
 * sexual abuse material when it considers an unanswered suspect item, as a final decision considers every one.
 */
export type StrikeLine = "due" | "interim" | "law" | "r2" | "already" | "before";
export function strikeLine(view: CaseView, draft: CaseDraft): StrikeLine | null {
  if (view.strikeDue === null || (draft.kind !== "interim" && draft.kind !== "final") || draft.outcome !== "restricted") return null;
  if (draft.kind === "interim") return "interim";
  if (draft.ground === "illegal") return "law";
  if (draft.ruleId === "R2" || suspectOpen(view).length > 0) return "r2";
  if (view.strikeDue.due) return "due";
  return view.strikeDue.why === "already_struck" ? "already" : "before";
}

/** The strike a decision's params carry: one exactly when the strike line says it is due. */
const strikeOf = (view: CaseView, draft: CaseDraft): DecisionActionParams[] => (strikeLine(view, draft) === "due" ? [{ kind: "strike", mediaId: null }] : []);

/** A day, in milliseconds: a strike counts STANDING_RULES.strikeDays of them from its decision. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The strikes the author would have with this one, for the preview's sentence: the band's lower bound plus this strike.
 * The page reads the author's standing in bands (D 8), so for "3 or more" it says 4; the statement the author gets holds
 * the database's count.
 */
const ACTIVE_THEN: Record<NonNullable<CaseView["authorStanding"]>["activeStrikes"], number> = { "0": 1, "1": 2, "2": 3, "3_or_more": 4 };

/** Whether a suspension or termination that stands rests on the reviewed decision's strike: [review.rests]. */
export const strikeCarriesStanding = (decision: CaseDecision | undefined): boolean => (decision ? (standingStrikeOf(decision)?.restedOnBy ?? []).length > 0 : false);

/** The reversal that lifts a measure. */
function reversalOf(action: { kind: ActionKind; mediaId: string | null }): DecisionActionParams {
  // 3f: an order's measure is lifted only by its own reversal, which a reinstatement holds alone.
  if (action.kind === "disable_by_order") return { kind: "reinstate_by_order", mediaId: null };
  const target = MEASURES[action.kind].target;
  if (target === "post") return { kind: "restore", mediaId: null };
  if (target === "image") return { kind: "restore_media", mediaId: action.mediaId };
  if (target === "images") return { kind: "unseal_media", mediaId: null };
  if (target === "handle") return { kind: "unretire_handle", mediaId: null };
  if (action.kind === "suspend" || action.kind === "terminate") return { kind: "lift_suspension", mediaId: null };
  if (target === "reporting") return { kind: "lift_reporting", mediaId: null };
  return { kind: target === "display_name" ? "restore_display_name" : "restore_bio", mediaId: null };
}

/** The measures taken while deciding that are in force, each with the decision that holds it. */
function interimInForce(view: CaseView): { decision: CaseDecision; action: CaseDecisionAction }[] {
  return view.decisions.filter((decided) => decided.kind === "interim").flatMap((decision) => decision.actions.filter((action) => action.inForce && MEASURES[action.kind].lifts === null).map((action) => ({ decision, action })));
}

/** The withholds taken while deciding that a final decision which leaves the case open may lift: "Lift" beside each. */
export function liftable(view: CaseView): DecisionActionParams[] {
  return interimInForce(view)
    .filter(({ action }) => action.kind === "withhold" || action.kind === "withhold_media")
    .map(({ action }) => reversalOf(action));
}

/** The measure a reversal of a final decision's draft lifts, for its label. */
export const liftedKind = (reversal: DecisionActionParams): MeasureKind => (reversal.kind === "restore_media" ? "withhold_media" : "withhold");

// ---------------------------------------------------------------- 3e: a suspension at once (design, section 8.3)

/** The four grounds of a suspension at once, in the composer's order. The termination at once is Task 4's. */
export type AtOnceKey = "threat" | "terrorist" | "flood" | "protective";
export const AT_ONCE_ORDER: readonly AtOnceKey[] = ["threat", "terrorist", "flood", "protective"];

/** The most days of a suspension at once on each ground, from STANDING_RULES. */
export const AT_ONCE_DAYS: Record<AtOnceKey, number> = {
  threat: STANDING_RULES.threatDays,
  terrorist: STANDING_RULES.terroristDays,
  flood: STANDING_RULES.floodDays,
  protective: STANDING_RULES.protectiveDays,
};

/**
 * The ground a draft's rule or law selects (decision_actions_check's table): R5 a threat, R6 a flood, R2 a protective
 * suspension, the law with the terrorist-content mark terrorist content; any other rule, or the law without the mark,
 * none ([atOnce.other]).
 */
export function atOnceGroundOf(draft: Pick<CaseDraft, "ground" | "ruleId" | "terrorist">): AtOnceKey | null {
  if (draft.ground === "illegal") return draft.terrorist ? "terrorist" : null;
  return draft.ruleId === "R5" ? "threat" : draft.ruleId === "R6" ? "flood" : draft.ruleId === "R2" ? "protective" : null;
}

/** Why "Suspend at once" is greyed, by its key in STANDING_WORDS: a standing measure is live, the person is no admin, the rule allows none, a report waits, or the ground's facts are not there now. */
export type AtOnceClosed = "conflict" | "admin" | "other" | "reportsFirst" | "noSeal" | "unmet";

/**
 * Whether "Suspend at once" is open for this draft on this case, and on which ground, or why not; null where the control
 * is not shown at all: on a post case, while deciding, or for an outcome that restricts nothing. The case answer's
 * standing says what the database would accept now; the database decides at the commit.
 */
export function atOnceState(
  view: CaseView,
  role: StaffRole,
  draft: Pick<CaseDraft, "kind" | "outcome" | "ground" | "ruleId" | "terrorist">,
): { open: true; ground: AtOnceKey } | { open: false; why: AtOnceClosed; ground: AtOnceKey | null } | null {
  if (view.target.type !== "account" || view.standing === null || draft.kind !== "final" || draft.outcome !== "restricted") return null;
  const ground = atOnceGroundOf(draft);
  if (view.standing.live) return { open: false, why: "conflict", ground };
  if (role !== "admin") return { open: false, why: "admin", ground };
  if (ground === null) return { open: false, why: "other", ground };
  // A protective suspension answers findings only: a report that waits in the case is decided first.
  if (ground === "protective" && view.standing.openReports) return { open: false, why: "reportsFirst", ground };
  if (!view.standing.atOnce.includes(ground)) return { open: false, why: ground === "protective" ? "noSeal" : "unmet", ground };
  return { open: true, ground };
}

/** The suspension taken at once a draft holds, if any (an announced one is Task 4's control). */
export const suspensionOf = (draft: CaseDraft): DecisionActionParams | undefined => draft.actions.find((action) => action.kind === "suspend" && action.announced === false);

/** A placeholder of a draft filled in, each by a function, so that no character of a value is read as a pattern. */
const filled = (text: string, values: Record<string, string>): string => Object.entries(values).reduce((out, [key, value]) => out.split(`{${key}}`).join(value), text);

/**
 * The draft once "Suspend at once" is chosen with these days: the suspension taken at once beside the draft's other
 * measures, and, when its facts or its reason are still empty, W.5's drafts for the ground, filled from the case answer as
 * this page read it (a flood's count and interval, the day of the seal for good). The moderator may edit them.
 */
export function withAtOnce(view: CaseView, draft: CaseDraft, ground: AtOnceKey, days: number): CaseDraft {
  const standing = view.standing;
  // At most one suspension or termination in a decision: choosing this one puts any other away.
  const actions = [...draft.actions.filter((action) => action.kind !== "suspend" && action.kind !== "terminate"), { kind: "suspend" as const, mediaId: null, days, announced: false }];
  const facts =
    ground === "flood"
      ? filled(STANDING_DRAFTS.facts.flood, { posts: String(standing?.flood.posts ?? 0), from: standing?.flood.from ?? "", to: standing?.flood.to ?? "" })
      : ground === "protective"
        ? filled(STANDING_DRAFTS.facts.protective, { sealedOn: standing?.seal?.decidedOn ?? "" })
        : STANDING_DRAFTS.facts[ground];
  const written = { ...draft.written };
  if (normalised(written.facts) === "") written.facts = facts;
  if (ground === "protective" && normalised(written.reason) === "") written.reason = STANDING_DRAFTS.reason.protective;
  return { ...draft, actions, written };
}

/** A suspension at once as the preview renders it: what the database will fix, as far as the page can tell now. */
function previewSuspension(view: CaseView, draft: CaseDraft, action: DecisionActionParams, noEffect: "already" | "deleted" | null, now: Date) {
  const ground = atOnceGroundOf(draft);
  const days = action.days ?? 1;
  const rested = ground === null || ground === "flood" ? null : (view.standing?.basisDecidedAt[ground] ?? now.toISOString());
  return {
    kind: "suspend" as MeasureKind,
    mediaId: null,
    noEffect,
    sealed: null,
    announced: false,
    days,
    basis: ground,
    earliestStart: now.toISOString(),
    endsAt: new Date(now.getTime() + days * DAY_MS).toISOString(),
    restsOn: rested === null ? null : [{ decidedAt: rested, ruleId: ground === "threat" ? ("R5" as RuleId) : null, postCreatedAt: null }],
  };
}

/** Where a standing measure's period stood, as the case answer reads it now, in the statement's three states: what the preview of its lift prints. */
function periodNow(action: CaseDecisionAction): { state: "not_started" | "running" | "ended"; startedAt: string | null; endedAt: string | null } {
  const period = action.period;
  if (period === null || period.startsAt === null || period.state === "unfixed" || period.state === "announced" || period.state === "held" || period.state === "never") return { state: "not_started", startedAt: null, endedAt: null };
  if (period.state === "running") return { state: "running", startedAt: period.startsAt, endedAt: null };
  return { state: "ended", startedAt: period.startsAt, endedAt: period.endsAt };
}

// ---------------------------------------------------------------- 3e Task 4: announced measures, termination, replies

/** The three controls of a standing measure that Task 4 builds (8.3): announce a suspension, announce a termination, terminate at once. */
export type StandingControl = "announce" | "announceTerminate" | "terminateAtOnce";

/** Why such a control is greyed, by its key in STANDING_WORDS: a measure is live, a report waits, too few strikes, no new strike, not the ladder's end, no admin, no second threat, R2. */
export type StandingClosed = "conflict" | "reportsFirst" | "short" | "stale" | "notYet" | "admin" | "noRepeat" | "r2";

/**
 * Whether a control is open for this draft on this case, or why not; null where it is not shown: on a post case, while
 * deciding, for an outcome that restricts nothing, and on the law (a measure of the ladder cites the newest strike's rule,
 * and a termination at once R5). The case answer's standing says what the database would accept now; it decides at the
 * commit. The two announced measures answer findings only, so a report that waits in the case greys them.
 */
export function standingControlState(view: CaseView, role: StaffRole, draft: Pick<CaseDraft, "kind" | "outcome" | "ground" | "ruleId">, control: StandingControl): { open: true } | { open: false; why: StandingClosed } | null {
  const standing = view.standing;
  if (view.target.type !== "account" || standing === null || draft.kind !== "final" || draft.outcome !== "restricted" || draft.ground !== "incompatible") return null;
  if (standing.live) return { open: false, why: "conflict" };
  if (control === "announce") {
    if (standing.openReports) return { open: false, why: "reportsFirst" };
    if (standing.activeStrikes < STANDING_RULES.ladderStrikes) return { open: false, why: "short" };
    if (standing.maxDays === null) return { open: false, why: "stale" };
    return { open: true };
  }
  if (role !== "admin") return { open: false, why: "admin" };
  if (control === "announceTerminate") {
    if (standing.openReports) return { open: false, why: "reportsFirst" };
    return standing.mayTerminate ? { open: true } : { open: false, why: "notYet" };
  }
  if (draft.ruleId === "R2") return { open: false, why: "r2" };
  return draft.ruleId === "R5" && standing.atOnce.includes("threat_repeat") ? { open: true } : { open: false, why: "noRepeat" };
}

/** The standing measure a draft holds, if any: a suspension or a termination, announced or at once. */
export const standingMeasureOf = (draft: CaseDraft): DecisionActionParams | undefined => draft.actions.find((action) => action.kind === "suspend" || action.kind === "terminate");

/** Whether an action is the measure a control adds. */
export const ofControl = (action: DecisionActionParams, control: StandingControl): boolean =>
  control === "announce" ? action.kind === "suspend" && action.announced === true : control === "announceTerminate" ? action.kind === "terminate" && action.announced === true : action.kind === "terminate" && action.announced === false;

/**
 * The draft once a control is chosen: its measure beside the draft's other measures, and never beside another suspension
 * or termination (at most one of the four can be chosen); for a measure of the ladder the newest strike's rule, which the
 * composer sets ([suspend.rule]); and, when the facts are still empty, W.5's draft, filled from the case answer as this
 * page read it. The moderator may edit them and writes the reason.
 */
export function withStanding(view: CaseView, draft: CaseDraft, control: StandingControl, days: number | null): CaseDraft {
  const standing = view.standing;
  const measure: DecisionActionParams =
    control === "announce" ? { kind: "suspend", mediaId: null, days: days ?? 1, announced: true } : { kind: "terminate", mediaId: null, days: null, announced: control === "announceTerminate" };
  const actions = [...draft.actions.filter((action) => action.kind !== "suspend" && action.kind !== "terminate"), measure];
  const ladder = control !== "terminateAtOnce" && standing?.ladderRule ? standing.ladderRule : draft.ruleId;
  const facts =
    control === "announce"
      ? filled(STANDING_DRAFTS.facts.strikes, { activeStrikes: String(standing?.activeStrikes ?? 0) })
      : control === "announceTerminate"
        ? filled(STANDING_DRAFTS.facts.ladder_end, {
            n: String(standing?.suspensionsInYear ?? 0),
            ladderMemoryDays: String(STANDING_RULES.ladderMemoryDays),
            day: standing?.lastSuspendedOn ?? "",
            activeStrikes: String(standing?.activeStrikes ?? 0),
          })
        : STANDING_DRAFTS.facts.threat_repeat;
  const written = { ...draft.written };
  if (normalised(written.facts) === "") written.facts = facts;
  return { ...draft, ruleId: ladder, category: ladder === draft.ruleId ? draft.category : RULE_DEFAULT_CATEGORY[ladder], actions, written };
}

/** Whether a standing measure a draft holds is still what its control offers now, with days within the rung. */
function standingOffered(view: CaseView, role: StaffRole, draft: Pick<CaseDraft, "kind" | "outcome" | "ground" | "ruleId">, action: DecisionActionParams): boolean | null {
  for (const control of ["announce", "announceTerminate", "terminateAtOnce"] as const) {
    if (!ofControl(action, control)) continue;
    if (standingControlState(view, role, draft, control)?.open !== true) return false;
    // A measure of the ladder cites the newest strike's rule; a suspension's days are at most the rung.
    if (control !== "terminateAtOnce" && draft.ruleId !== view.standing?.ladderRule) return false;
    if (control === "announce") return typeof action.days === "number" && action.days >= STANDING_DAYS.min && action.days <= (view.standing?.maxDays ?? 0);
    return true;
  }
  return null;
}

/** An announced suspension or termination, or a termination at once, as the preview renders it: what the database will fix, as far as the page can tell now. */
function previewStanding(view: CaseView, action: DecisionActionParams, noEffect: "already" | "deleted" | null, now: Date) {
  const standing = view.standing;
  if (action.announced === true) {
    return {
      kind: action.kind as MeasureKind,
      mediaId: null,
      noEffect,
      sealed: null,
      announced: true,
      days: action.kind === "suspend" ? (action.days ?? 1) : null,
      basis: action.kind === "suspend" ? ("strikes" as const) : ("ladder_end" as const),
      earliestStart: new Date(now.getTime() + STANDING_RULES.replyWindowHours * 60 * 60 * 1000).toISOString(),
      endsAt: null,
      // The account's active strikes as the page read them: the database lists the same, with the posts they were given for.
      restsOn: (standing?.strikes ?? []).map((strike) => ({ decidedAt: strike.decidedAt, ruleId: strike.ruleId as RuleId | null, postCreatedAt: null })),
    };
  }
  const repeat = standing?.basisDecidedAt.threatRepeat ?? null;
  return {
    kind: "terminate" as MeasureKind,
    mediaId: null,
    noEffect,
    sealed: null,
    announced: false,
    days: null,
    basis: "threat_repeat" as const,
    earliestStart: now.toISOString(),
    endsAt: null,
    restsOn: [
      { decidedAt: repeat?.earlier ?? now.toISOString(), ruleId: "R5" as RuleId, postCreatedAt: null },
      { decidedAt: repeat?.newer ?? now.toISOString(), ruleId: "R5" as RuleId, postCreatedAt: null },
    ],
  };
}

/** The measure of a decision that a reply was filed against, with the reply, when that decision holds one. */
export function replyOf(decision: CaseDecision): { measure: CaseDecisionAction; reply: NonNullable<CaseDecisionAction["reply"]> } | null {
  const measure = decision.actions.find((action) => (action.kind === "suspend" || action.kind === "terminate") && action.reply !== null);
  return measure && measure.reply ? { measure, reply: measure.reply } : null;
}

/**
 * Where a reply stands, for the case page's block (8.5): answered; or waiting, filed before the start (the start is held),
 * after it while the measure runs, or after it with the measure's days run out since; or left without an answer to give,
 * since the decision that broke its measure's basis answered it ([reply.basisGone]).
 */
export type ReplyState = "answered" | "basisGone" | "onTime" | "late" | "lateEnded";
export function replyState(measure: CaseDecisionAction, reply: NonNullable<CaseDecisionAction["reply"]>): ReplyState {
  if (measure.period?.state === "basis_ended") return "basisGone";
  if (reply.answeredAt !== null) return "answered";
  if (reply.onTime) return "onTime";
  return measure.period?.state === "ended" ? "lateEnded" : "late";
}

/**
 * Whether this person may answer the decision's reply ("Answer this reply"): one waits, its measure's basis holds, and a
 * decision that needed an admin is corrected by an admin ([reply.admin]). The same moderator may answer ([reply.same]).
 */
export function answerable(decision: CaseDecision, role: StaffRole): boolean {
  const found = replyOf(decision);
  if (found === null) return false;
  const state = replyState(found.measure, found.reply);
  if (state !== "onTime" && state !== "late" && state !== "lateEnded") return false;
  return !decision.needsAdmin || role === "admin";
}

/** The draft of an answer to a reply: a correction of the decision that holds the measure, Keep chosen, nothing lifted, no reason written. */
export function answerDraft(caseId: CaseId, view: CaseView, decision: CaseDecision, role: StaffRole): CaseDraft {
  return { ...newDraft(caseId, view, role), kind: "correction", reviewsDecisionId: decision.id, category: decision.category, answer: "kept", actions: [] };
}

/** The draft once the answer is chosen: Keep lifts nothing; Reverse lifts the measure the reply was filed against. */
export function withAnswer(draft: CaseDraft, decision: CaseDecision, answer: "kept" | "reversed"): CaseDraft {
  const found = replyOf(decision);
  return { ...draft, answer, actions: answer === "kept" || found === null ? [] : [reversalOf(found.measure)] };
}

/**
 * Whether this person may withdraw the decision's announced measure for another one ("Withdraw it for another measure",
 * 8.7): an admin, while the account's case shows [conflict] (a standing measure is live), for an announced suspension or
 * termination that has not started. It is never offered to lift a measure for any other reason.
 */
export function withdrawable(view: CaseView, decision: CaseDecision, role: StaffRole): CaseDecisionAction | null {
  if (role !== "admin" || view.standing?.live !== true) return null;
  const measure = decision.actions.find((action) => (action.kind === "suspend" || action.kind === "terminate") && action.announced === true && action.inForce);
  const state = measure?.period?.state;
  return measure && (state === "unfixed" || state === "announced" || state === "held") ? measure : null;
}

/** The draft of a withdrawal: a correction that lifts the announced measure, signed `replaced`, and no other action. */
export function withdrawDraft(caseId: CaseId, view: CaseView, decision: CaseDecision, role: StaffRole): CaseDraft {
  return { ...newDraft(caseId, view, role), kind: "correction", reviewsDecisionId: decision.id, category: decision.category, replaced: true, actions: [{ kind: "lift_suspension", mediaId: null }] };
}

/**
 * 3f Task 3 (design, section 8.6): the order's measure a reinstatement lifts, beside an order decision whose measure is
 * in force; null otherwise. Any staff member sees it; only an admin's control is live.
 */
export function reinstatable(decision: CaseDecision): CaseDecisionAction | null {
  if (decision.kind !== "order") return null;
  return decision.actions.find((action) => action.kind === "disable_by_order" && action.inForce) ?? null;
}

/** The draft of a reinstatement: a correction of the order decision, with no ground chosen yet. */
export function reinstateDraft(caseId: CaseId, view: CaseView, decision: CaseDecision, role: StaffRole): CaseDraft {
  return { ...newDraft(caseId, view, role), kind: "correction", reviewsDecisionId: decision.id, category: decision.category, reinstate: true, actions: [] };
}

/**
 * The ground of a reinstatement chosen: its one action signs it, and its reason is the ground's fixed draft (W.2), which
 * nobody edits: a free text beside an order could say what a non-disclosure decision forbids.
 */
export function withReinstateGround(draft: CaseDraft, ground: OrderGround): CaseDraft {
  const reason = ORDER_DRAFTS.reinstate[ground];
  const saved = draft.texts.review_reason;
  return {
    ...draft,
    actions: [{ kind: "reinstate_by_order", mediaId: null, orderGround: ground }],
    written: { ...draft.written, review_reason: reason },
    texts: saved !== undefined && saved.text === reason ? draft.texts : {},
  };
}

/** The ground a reinstatement's draft signs, or null before one is chosen. */
export const reinstateGroundOf = (draft: CaseDraft): OrderGround | null => draft.actions.find((action) => action.kind === "reinstate_by_order")?.orderGround ?? null;

/**
 * What an answer to a reply would fix, for the preview's statement (repliedTo, 10.2), as the page can tell now: after a
 * kept answer to a reply before the start, the start at the later of now and the earliest start, and the six months
 * counted again from now; otherwise the period as it stands, and the six months from the decision.
 */
function repliedToPreview(decision: CaseDecision, draft: CaseDraft, now: Date): StatementInput["repliedTo"] {
  const found = replyOf(decision);
  if (found === null || draft.answer === undefined || draft.replaced === true) return undefined;
  const { measure, reply } = found;
  const terminate = measure.kind === "terminate";
  const then = periodNow(measure);
  const keptOnTime = draft.answer === "kept" && reply.onTime;
  const start = keptOnTime ? new Date(Math.max(Date.parse(measure.earliestStart ?? now.toISOString()), now.getTime())).toISOString() : (measure.period?.startsAt ?? null);
  const end = terminate || start === null ? null : keptOnTime || draft.answer === "kept" ? new Date(Date.parse(start) + (measure.days ?? 0) * DAY_MS).toISOString() : now.toISOString();
  return {
    filedAt: reply.filedAt,
    onTime: reply.onTime,
    kind: terminate ? "terminate" : "suspend",
    days: terminate ? null : measure.days,
    periodThen: keptOnTime ? { state: start !== null && Date.parse(start) <= now.getTime() ? "running" : "not_started", startedAt: start !== null && Date.parse(start) <= now.getTime() ? start : null, endedAt: null } : then,
    startsAt: draft.answer === "reversed" && reply.onTime ? null : start,
    endsAt: draft.answer === "reversed" && reply.onTime ? null : end,
    appealUntil: appealDeadline(keptOnTime ? now : new Date(decision.decidedAt)).toISOString(),
  };
}

// ---------------------------------------------------------------- 3e Task 5: the restriction of reporting and the marks

/** The two controls of the reporting measures (8.3): warn about reporting, restrict reporting. */
export type ReportingControl = "warn" | "restrict";

/**
 * Why such a control is greyed, by its key in STANDING_WORDS.reporting: a report waits in the case ([reports.first]), too
 * few marked reports ([warn.short]), a warning still counts ([warn.standing]), no warning counts ([restrict.noWarning]),
 * too few marked reports since it ([restrict.short]), a restriction runs ([restrict.running]).
 */
export type ReportingClosed = "reportsFirst" | "warnShort" | "warnStanding" | "noWarning" | "restrictShort" | "running";

/** The ledger kind a reporting control adds. */
export const reportingKindOf = (control: ReportingControl): "warn_reporting" | "restrict_reporting" => (control === "warn" ? "warn_reporting" : "restrict_reporting");

/**
 * Whether a reporting control is open for this draft on this case, or why not; null where it is not shown: on a post
 * case, while deciding, for an outcome that restricts nothing, and on the law (both cite R6). Both answer findings only,
 * so a report that waits in the case greys them; the case answer's reporting says what the database would accept now,
 * and the database decides at the commit.
 */
export function reportingControlState(view: CaseView, draft: Pick<CaseDraft, "kind" | "outcome" | "ground">, control: ReportingControl): { open: true } | { open: false; why: ReportingClosed } | null {
  const standing = view.standing;
  if (view.target.type !== "account" || standing === null || draft.kind !== "final" || draft.outcome !== "restricted" || draft.ground !== "incompatible") return null;
  const reporting = standing.reporting;
  if (standing.openReports) return { open: false, why: "reportsFirst" };
  if (control === "warn") {
    if (reporting.warnedOn !== null) return { open: false, why: "warnStanding" };
    return reporting.mayWarn ? { open: true } : { open: false, why: "warnShort" };
  }
  if (reporting.warnedOn === null) return { open: false, why: "noWarning" };
  if (reporting.restrictedUntil !== null) return { open: false, why: "running" };
  return reporting.mayRestrict ? { open: true } : { open: false, why: "restrictShort" };
}

/** "1", "1 and 3", "1, 2 and 3". */
const listedNumbers = (numbers: readonly number[]): string => {
  const words = [...numbers].sort((a, b) => a - b).map(String);
  return words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)!}`;
};

/**
 * W.5's {marked}: the marked reports by what korbat generated, each once, oldest first, with the day it was sent and the
 * numbers of its marked items: "report N-ABCDEFGHIJ of 2026-10-01 (item 2)", joined by "; ". Nobody is named.
 */
export function markedList(marks: readonly NonNullable<CaseView["standing"]>["reporting"]["marked"][number][]): string {
  const reports = new Map<string, { sentOn: string; positions: number[] }>();
  for (const mark of marks) {
    const entry = reports.get(mark.ref) ?? { sentOn: mark.sentOn, positions: [] };
    entry.positions.push(mark.position);
    reports.set(mark.ref, entry);
  }
  return [...reports].map(([ref, { sentOn, positions }]) => `report ${ref} of ${sentOn} (${positions.length === 1 ? "item" : "items"} ${listedNumbers(positions)})`).join("; ");
}

/** The UTC day of an instant: the {readDay} of W.5's reporting drafts. */
const utcDay = (at: Date): string => at.toISOString().slice(0, 10);

/**
 * The draft once a reporting control is chosen: its measure beside the draft's other measures and never beside the other
 * reporting measure, a restriction with its days and never announced; rule R6, which the composer sets; and, when the
 * facts are still empty, W.5's draft filled from the case answer as this page read it on `now`'s day: the counts in
 * reports and the marked reports (since the warning, for a restriction). The moderator may edit them and writes the
 * reason.
 */
export function withReporting(view: CaseView, draft: CaseDraft, control: ReportingControl, days: number | null, now: Date): CaseDraft {
  const reporting = view.standing?.reporting;
  const measure: DecisionActionParams =
    control === "warn" ? { kind: "warn_reporting", mediaId: null } : { kind: "restrict_reporting", mediaId: null, days: days ?? STANDING_RULES.reportRestrictDays, announced: false };
  const actions = [...draft.actions.filter((action) => action.kind !== "warn_reporting" && action.kind !== "restrict_reporting"), measure];
  const facts =
    control === "warn"
      ? filled(STANDING_DRAFTS.facts.warn, {
          frameDays: String(STANDING_RULES.reportFrameDays),
          readDay: utcDay(now),
          reports: String(reporting?.reports ?? 0),
          unfounded: String(reporting?.unfounded ?? 0),
          marked: markedList(reporting?.marked ?? []),
        })
      : filled(STANDING_DRAFTS.facts.restrict, {
          warnedOn: reporting?.warnedOn ?? "",
          readDay: utcDay(now),
          marksSince: String(reporting?.marksSince ?? 0),
          marked: markedList((reporting?.marked ?? []).filter((mark) => mark.sinceWarning)),
        });
  const written = { ...draft.written };
  if (normalised(written.facts) === "") written.facts = facts;
  return { ...draft, ruleId: "R6", category: draft.ruleId === "R6" ? draft.category : RULE_DEFAULT_CATEGORY.R6, actions, written };
}

/** Whether a reporting measure a draft holds is still what its control offers now, under R6 and with a restriction's days within its bound. */
function reportingOffered(view: CaseView, draft: Pick<CaseDraft, "kind" | "outcome" | "ground" | "ruleId">, action: DecisionActionParams): boolean {
  const state = reportingControlState(view, draft, action.kind === "warn_reporting" ? "warn" : "restrict");
  if (state?.open !== true || draft.ruleId !== "R6") return false;
  return action.kind === "warn_reporting" || (action.announced === false && typeof action.days === "number" && action.days >= STANDING_DAYS.min && action.days <= STANDING_RULES.reportRestrictDays);
}

/** A warning about reporting or a restriction of it as the preview renders it: what the database will fix, as far as the page can tell now. */
function previewReporting(view: CaseView, action: DecisionActionParams, noEffect: "already" | "deleted" | null, now: Date) {
  if (action.kind === "warn_reporting") {
    return { kind: "warn_reporting" as MeasureKind, mediaId: null, noEffect, sealed: null, basis: "reports" as const, endsAt: new Date(now.getTime() + STANDING_RULES.reportFrameDays * DAY_MS).toISOString() };
  }
  const days = action.days ?? 1;
  return {
    kind: "restrict_reporting" as MeasureKind,
    mediaId: null,
    noEffect,
    sealed: null,
    basis: "reports" as const,
    days,
    endsAt: new Date(now.getTime() + days * DAY_MS).toISOString(),
    // The warning it follows, by its decision's time as the case answer gives it.
    warnedAt: view.standing?.reporting.warnedAt ?? now.toISOString(),
  };
}

/**
 * What a lift of a reporting measure lifts, for the preview of a correction or a review: the warning, or the restriction
 * with whether its days still run now (it started with its decision) or had run out.
 */
function reportingLiftOf(decision: CaseDecision, lifted: CaseDecisionAction, now: Date) {
  if (lifted.kind === "warn_reporting") return { liftedKind: "warn_reporting" as const, liftedDecidedAt: decision.decidedAt, periodThen: null };
  const end = new Date(Date.parse(decision.decidedAt) + (lifted.days ?? 0) * DAY_MS);
  const ended = end.getTime() <= now.getTime();
  return { liftedKind: "restrict_reporting" as const, liftedDecidedAt: decision.decidedAt, periodThen: { state: ended ? ("ended" as const) : ("running" as const), startedAt: decision.decidedAt, endedAt: ended ? end.toISOString() : null } };
}

/** What a correction's or a review's choice is called: a reporting measure's lift by what it lifts (8.7), every other by its label. */
export function reversalLabel(measure: CaseDecisionAction, reversal: DecisionActionParams): string {
  if (reversal.kind === "lift_reporting") return measure.kind === "warn_reporting" ? STANDING_WORDS.reporting.liftWarning : STANDING_WORDS.reporting.liftRestriction;
  return MEASURES[reversal.kind].label;
}

/** The items a final "No breach" decision made now answers and may mark (8.4): those it considers whose `markable` is true. */
export function markableItems(view: CaseView, draft: Pick<CaseDraft, "kind" | "outcome">): CaseItem[] {
  if (draft.kind !== "final" || draft.outcome !== "no_violation") return [];
  return considered(view, "final").filter((item) => item.markable);
}

/** The items such a decision answers that cannot be marked, for [mark.never], said once. */
export function unmarkableItems(view: CaseView, draft: Pick<CaseDraft, "kind" | "outcome">): CaseItem[] {
  if (draft.kind !== "final" || draft.outcome !== "no_violation") return [];
  return considered(view, "final").filter((item) => !item.markable);
}

/** The draft's marks with one item ticked or unticked, sorted, as the params sign them. */
export function withMark(draft: CaseDraft, itemId: string, on: boolean): string[] {
  const rest = (draft.unfounded ?? []).filter((id) => id !== itemId);
  return (on ? [...rest, itemId] : rest).sort();
}

/** The marks a draft signs: those of its items that a final "No breach" decision made now may still mark, sorted, without repeats. */
export function marksOf(view: CaseView, draft: Pick<CaseDraft, "kind" | "outcome" | "unfounded">): string[] {
  const markable = new Set(markableItems(view, draft).map((item) => item.id));
  return [...new Set((draft.unfounded ?? []).filter((id) => markable.has(id)))].sort();
}

/**
 * The items whose marks a correction of this decision would withdraw ("Withdraw this decision's marks", 8.4 and 8.7): a
 * final "No breach" decision's items whose marks stand. A decision that needed an admin is corrected by an admin.
 */
export function marksWithdrawable(view: CaseView, decision: CaseDecision, role: StaffRole): CaseItem[] {
  if (decision.kind !== "final" || decision.outcome !== "no_violation" || (decision.needsAdmin && role !== "admin")) return [];
  return view.items.filter((item) => item.answeredBy === decision.id && item.unfounded);
}

/** The draft of that correction: kept, nothing lifted, no list signed; the database withdraws every mark of the decision. */
export function withdrawMarksDraft(caseId: CaseId, view: CaseView, decision: CaseDecision, role: StaffRole): CaseDraft {
  return { ...newDraft(caseId, view, role), kind: "correction", reviewsDecisionId: decision.id, category: decision.category, answer: "kept", withdrawMarks: true, actions: [] };
}

// ---------------------------------------------------------------- drafts

const sameAction = (a: DecisionActionParams, b: DecisionActionParams): boolean => a.kind === b.kind && a.mediaId === b.mediaId;

const NO_TEXTS: Record<DraftTextKind, string> = { facts: "", reason: "", legal_reference: "", review_reason: "" };

/** The rule a case's composer opens with: the first unanswered item's own, unless that is R2, which only the seal presets. */
const openingRule = (view: CaseView): RuleId => view.items.find((item) => item.outcome === null && item.ruleId !== null && item.ruleId !== "R2")?.ruleId ?? "R1";

/** The draft a case's composer opens with: a decision taken while deciding that restricts under the first rule offered, with nothing chosen and nothing written. */
export function newDraft(caseId: CaseId, view: CaseView, role: StaffRole): CaseDraft {
  const kinds = kindsOffered(view, role);
  const ruleId = openingRule(view);
  return {
    caseId,
    kind: kinds[0] ?? "interim",
    reviewsDecisionId: null,
    outcome: "restricted",
    ground: "incompatible",
    ruleId,
    category: RULE_DEFAULT_CATEGORY[ruleId],
    terrorist: false,
    actions: [],
    written: { ...NO_TEXTS },
    texts: {},
  };
}

/** Whether an action of a draft is still among what the composer offers for this kind and outcome, on the case as the page shows it. */
function actionOffered(view: CaseView, role: StaffRole, kind: "interim" | "final", restricts: boolean, action: DecisionActionParams, draftLike: Pick<CaseDraft, "ground" | "ruleId" | "terrorist">): boolean {
  // A Lift stands beside a withhold taken while deciding, on a final decision that leaves the case open.
  if (MEASURES[action.kind].lifts !== null) return kind === "final" && leftOpen(view).length > 0 && liftable(view).some((lift) => sameAction(lift, action));
  if (!restricts) return false;
  if (action.kind === "seal_media") return sealOffered(view, kind, role);
  // A retirement while the profile holds a placeholder is greyed, so a draft that held it loses it.
  if (action.kind === "retire_handle" && !retireOpen(view)) return false;
  // 3e Task 4: an announced suspension or termination, or a termination at once, stays while its control is open.
  const standing = action.kind === "suspend" || action.kind === "terminate" ? standingOffered(view, role, { ...draftLike, kind, outcome: restricts ? "restricted" : "no_violation" }, action) : null;
  if (standing !== null) return standing;
  // 3e Task 5: a warning about reporting or a restriction of it stays while its control is open, under R6.
  if (action.kind === "warn_reporting" || action.kind === "restrict_reporting") return reportingOffered(view, { ...draftLike, kind, outcome: restricts ? "restricted" : "no_violation" }, action);
  // 3e: a suspension at once stays while its control is open for this person, rule and case, with days within its ground's.
  if (action.kind === "suspend") {
    const state = atOnceState(view, role, { ...draftLike, kind, outcome: restricts ? "restricted" : "no_violation" });
    return state?.open === true && action.announced === false && typeof action.days === "number" && action.days >= 1 && action.days <= AT_ONCE_DAYS[state.ground];
  }
  if (!measuresOffered(view, kind).includes(action.kind as MeasureKind)) return false;
  // An image measure names an image of the snapshot the page shows that it may still name.
  return MEASURES[action.kind].target !== "image" || (action.mediaId !== null && imagesOffered(view, kind, action.kind as MeasureKind).includes(action.mediaId));
}

/**
 * The draft as far as the case and the person's role offer it now. The composer shows this draft, and it is the one the
 * key confirms, so what was shown is what is sent, also after the page read the case again and the case had changed:
 *   - an outcome without a measure makes the decision a final one, where a final decision is this person's to take;
 *   - a kind, an outcome or the ground of the law that is not offered falls back to the first that is;
 *   - rule R2, on a case that holds no unanswered suspect item any more, gives way to the rule the composer opens with;
 *   - every action that the kind, the target, the shown snapshot or the role no longer offers is dropped.
 * What its person wrote is kept. A draft that needs no change is answered as it is, and so is a correction's and a review's.
 */
export function offeredDraft(view: CaseView, role: StaffRole, draft: CaseDraft): CaseDraft {
  if (draft.kind === "correction" || draft.kind === "review") return draft;
  const kinds = kindsOffered(view, role);
  let kind: "interim" | "final" = draft.outcome !== "restricted" && kinds.includes("final") ? "final" : draft.kind;
  if (!kinds.includes(kind)) kind = kinds[0] ?? kind;
  const outcomes = outcomesOffered(view, kind);
  const outcome = outcomes.includes(draft.outcome) ? draft.outcome : "restricted";
  const ground = draft.ground === "illegal" && !lawOffered(view, kind) ? "incompatible" : draft.ground;
  const ruleId = draft.ruleId === "R2" && suspectOpen(view).length === 0 ? openingRule(view) : draft.ruleId;
  const category = ruleId === draft.ruleId ? draft.category : RULE_DEFAULT_CATEGORY[ruleId];
  const actions = draft.actions.filter((action) => actionOffered(view, role, kind, outcome === "restricted", action, { ground, ruleId, terrorist: draft.terrorist }));
  // 3e Task 5: the marks stay on the items a final "No breach" decision made now may still mark, and on no other.
  const unfounded = marksOf(view, { kind, outcome, unfounded: draft.unfounded });
  const same =
    kind === draft.kind && outcome === draft.outcome && ground === draft.ground && ruleId === draft.ruleId && actions.length === draft.actions.length && unfounded.join(" ") === (draft.unfounded ?? []).join(" ");
  return same ? draft : { ...draft, kind, outcome, ground, ruleId, category, actions, unfounded };
}

/**
 * 3d Task 7 (W.3, SEAL_DRAFTS.facts.match_post): the facts draft of a seal on a case whose only unanswered suspect items
 * are a program's, from the first of them that a match opened: W.3's comparison with "this post" for "your post" and a
 * capital letter, then that korbat's staff do not open such an image. Null on any other case. It holds no hash, no list
 * version and no classification string; the admin may add what the text, the alt texts and the account's conduct show.
 */
export function matchSealFacts(view: CaseView): string | null {
  const suspect = suspectOpen(view);
  if (suspect.length === 0 || suspect.some((item) => item.source.kind !== "program")) return null;
  for (const item of suspect) {
    const match = view.signals.find((found) => found.itemId === item.id && found.kind === "known_match")?.match;
    if (match == null) continue;
    const clause = STATEMENT_WORDS.automated.comparison(match.listed ? "csam" : "other", statementMatchKind(match.hashType, match.matchKind), match.source, "an image of this post");
    return SEAL_DRAFTS.facts.match_post.replace("{comparison}", `${clause.charAt(0).toUpperCase()}${clause.slice(1)}`);
  }
  return null;
}

/** The fixed drafts of a seal on this case: the facts by its unanswered suspect items, the reason by whether it is taken while deciding or for good. */
export function sealDraftFor(view: CaseView, kind: "interim" | "final"): { facts: string; reason: string } {
  const items = suspectOpen(view).map((item) => ({ source: item.source.kind === "staff" ? ("finding" as const) : ("user" as const), added: item.quotedByPosition !== null }));
  return { facts: matchSealFacts(view) ?? sealFactsDraft(view.target.type, items), reason: kind === "final" ? SEAL_DRAFTS.reason.final : SEAL_DRAFTS.reason.deciding };
}

/**
 * 3d Task 7 (section 8.4, note 26): whether this draft is an answer without a seal on a case whose match acts, which asks
 * for one of MATCH_ANSWER_REASONS before the key: a final decision that holds no seal and answers an item a program's
 * acting match opened. A match that does not act asks for none.
 */
export function answerReasonNeeded(view: CaseView, draft: CaseDraft): boolean {
  if (draft.kind !== "final" || draft.actions.some((action) => action.kind === "seal_media")) return false;
  return view.signals.some((signal) => signal.kind === "known_match" && signal.match?.acting === true && view.items.some((item) => item.id === signal.itemId && item.answeredBy === null));
}

/**
 * 3d Task 7 ([case.autoRecord]'s second sentence, 8.4): an admin who restricts on a match's finding citing R2 (a match of
 * the listed class): the database records the decision as partly automated (decision_holds), and the preview says so.
 */
export function restrictsOnMatch(view: CaseView, draft: CaseDraft): boolean {
  if (draft.kind === "correction" || draft.kind === "review" || draft.outcome !== "restricted") return false;
  const found = programFinding(view);
  return found !== null && found.signal.kind === "known_match" && found.signal.match?.listed === true;
}

/** The draft once "Seal the images this case reaches" is chosen: the seal alone, under rule R2, with the fixed drafts, which the moderator may edit. */
export function withSeal(view: CaseView, draft: CaseDraft): CaseDraft {
  const kind = draft.kind === "final" ? "final" : "interim";
  const texts = sealDraftFor(view, kind);
  return {
    ...draft,
    kind,
    reviewsDecisionId: null,
    outcome: "restricted",
    ground: "incompatible",
    ruleId: "R2",
    category: RULE_DEFAULT_CATEGORY.R2,
    terrorist: false,
    actions: [{ kind: "seal_media", mediaId: null }],
    written: { ...draft.written, facts: texts.facts, reason: texts.reason },
    texts: {},
  };
}

/**
 * What of a decision can be corrected by this person, or null when nothing can: its measures still in force. A decision
 * taken while deciding is lifted by anyone eligible; a final restriction that needed an admin is corrected by an admin;
 * and a seal is lifted by an admin only, so to anyone else it is not among the measures offered.
 */
export function correctable(_view: CaseView, decision: CaseDecision, role: StaffRole): { label: string; measures: CaseDecisionAction[] } | null {
  if ((decision.kind !== "interim" && decision.kind !== "final") || decision.outcome !== "restricted") return null;
  if (decision.needsAdmin && role !== "admin") return null;
  const measures = decision.actions.filter((action) => liftsOneByOne(action) && action.inForce && (role === "admin" || action.kind !== "seal_media"));
  if (measures.length === 0) return null;
  return { label: decision.kind === "interim" ? COMPOSER.liftLabel : COMPOSER.correctLabel, measures };
}

/** The draft of a correction of one decision: nothing chosen to lift yet, and no reason written. */
export function correctionDraft(caseId: CaseId, view: CaseView, decision: CaseDecision, role: StaffRole): CaseDraft {
  return { ...newDraft(caseId, view, role), kind: "correction", reviewsDecisionId: decision.id, category: decision.category, actions: [] };
}

/**
 * A correction as "Lift what was done while deciding" or "Correct this decision" opens it: with the reason its person
 * saved for a correction on this case before, which a reload or a sign-in would otherwise throw away.
 */
export function openCorrection(caseId: CaseId, view: CaseView, decision: CaseDecision, role: StaffRole): Promise<CaseDraft> {
  return withSavedTexts(correctionDraft(caseId, view, decision, role), view.drafts);
}

/** The reversals a correction's draft may hold: one for each measure of its decision that this person may lift. */
export function correctionChoices(view: CaseView, draft: CaseDraft, role: StaffRole): { measure: CaseDecisionAction; reversal: DecisionActionParams }[] {
  const decision = view.decisions.find((decided) => decided.id === draft.reviewsDecisionId);
  const offered = decision ? correctable(view, decision, role) : null;
  return (offered?.measures ?? []).map((measure) => ({ measure, reversal: reversalOf(measure) }));
}

// ---------------------------------------------------------------- the review of an appeal

/**
 * What of a decision this person may review, or null: its pending appeal, when the API marked it as this person's to
 * review (they made none of the case's decisions, opened no finding in it, are not close to anyone in it, and are an
 * admin where the review needs one), with the decision's measures still in force, which are what a review may lift.
 */
export function reviewable(view: CaseView, decision: CaseDecision): { appeal: CaseAppeal; measures: CaseDecisionAction[] } | null {
  const appeal = view.appeals.find((filed) => filed.decisionId === decision.id && filed.result === null);
  if (!appeal || !appeal.mayReview || decision.kind !== "final" || decision.outcome !== "restricted") return null;
  return { appeal, measures: decision.actions.filter((action) => liftsOneByOne(action) && action.inForce) };
}

/** The draft of a review of one decision's appeal: the decision kept, nothing lifted, and no reason written. */
export function reviewDraft(caseId: CaseId, view: CaseView, decision: CaseDecision, role: StaffRole): CaseDraft {
  return { ...newDraft(caseId, view, role), kind: "review", reviewsDecisionId: decision.id, review: "kept", category: decision.category, actions: [] };
}

/** A review as "Review this appeal" opens it: with the review reason its person saved on this case before. */
export function openReview(caseId: CaseId, view: CaseView, decision: CaseDecision, role: StaffRole): Promise<CaseDraft> {
  return withSavedTexts(reviewDraft(caseId, view, decision, role), view.drafts);
}

/**
 * The reversals a review's draft may hold: one for each measure of the reviewed decision that is still in force. A seal
 * is lifted by an admin only, so to anyone else it is not among them, and nothing is offered at all once the appeal is
 * answered or is not this person's to review.
 */
export function reviewChoices(view: CaseView, draft: CaseDraft, role: StaffRole): { measure: CaseDecisionAction; reversal: DecisionActionParams }[] {
  const decision = view.decisions.find((decided) => decided.id === draft.reviewsDecisionId);
  const offered = decision ? reviewable(view, decision) : null;
  return (offered?.measures ?? []).filter((measure) => role === "admin" || measure.kind !== "seal_media").map((measure) => ({ measure, reversal: reversalOf(measure) }));
}

/** The answer a review's draft gives. */
export const reviewOutcomeOf = (_view: CaseView, draft: CaseDraft): AppealsReviewedParams["outcome"] => draft.review ?? "kept";

/**
 * Whether a review's draft lifts what its answer says: nothing when it keeps the decision, every measure still in force
 * when it reverses it, and some but not all of them when it reverses part. The database holds the same at commit.
 */
function reviewConsistent(view: CaseView, draft: CaseDraft): boolean {
  const decision = view.decisions.find((decided) => decided.id === draft.reviewsDecisionId);
  const offered = decision ? reviewable(view, decision) : null;
  if (!offered) return false;
  const all = offered.measures.map(reversalOf);
  const lifted = draft.actions.filter((action) => all.some((reversal) => sameAction(reversal, action)));
  if (lifted.length !== draft.actions.length) return false;
  const outcome = reviewOutcomeOf(view, draft);
  if (outcome === "kept") return lifted.length === 0;
  if (outcome === "reversed") return all.length > 0 && lifted.length === all.length;
  return lifted.length > 0 && lifted.length < all.length;
}

/** The digests a review's params carry: the shown snapshot's, and that of the review reason the console saved. */
export interface ReviewDigests {
  snapshot: string;
  reason: string | null;
}

/**
 * The params the key confirms for a review, built from what the page shows (3c design, section 7.7): the case's version,
 * the decision's pending appeal, the newest snapshot by its id with the digest the console computed, the answer, the
 * reviewed decision's category and rules version, the redress texts' version, the reversals in their one order and the
 * digest of the saved reason. The contracts' schema refuses what cannot stand before any key is asked.
 */
export function reviewParamsOf(view: CaseView, draft: CaseDraft, digests: ReviewDigests): AppealsReviewedParams {
  const newest = view.snapshots[0];
  if (!newest) throw new Error("a review names a snapshot of its case: the case holds none");
  const decision = view.decisions.find((decided) => decided.id === draft.reviewsDecisionId);
  const offered = decision ? reviewable(view, decision) : null;
  if (!decision || !offered) throw new Error("a review's draft names a decision of the case whose appeal this person may review");
  return AppealsReviewedParams.parse({
    stateVersion: view.stateVersion,
    appealId: offered.appeal.id,
    snapshotId: newest.id,
    snapshotDigest: digests.snapshot,
    outcome: reviewOutcomeOf(view, draft),
    // A review carries the rulebook version and the category of the decision it reviews.
    rulesVersion: decision.rulesVersion,
    redressVersion: REDRESS_VERSION,
    category: decision.category,
    // 3e: a review that reverses the decision whole overrules the strike it gave, which the person never chooses.
    actions: [...draft.actions, ...overruleOf(decision, reviewOutcomeOf(view, draft) === "reversed")].sort(compareDecisionActions),
    reasonDigest: digests.reason,
  });
}

/** Whether a draft holds an action. */
export const holds = (draft: CaseDraft, action: DecisionActionParams): boolean => draft.actions.some((held) => sameAction(held, action));

/** The draft's actions with one added or taken away. */
export function toggled(draft: CaseDraft, action: DecisionActionParams, on: boolean): DecisionActionParams[] {
  const without = draft.actions.filter((held) => !sameAction(held, action));
  return on ? [...without, action] : without;
}

/**
 * The case's saved texts put into a draft that has none written yet (a reload, or a sign-in in another tab): for each
 * kind the newest of the person's own unconfirmed texts whose digest the console recomputes from its salt and text. One
 * that does not recompute is dropped, and so is one the rules for a staff text refuse: the console would never have
 * saved it, so an answer cannot put it into a draft.
 */
export async function withSavedTexts(draft: CaseDraft, saved: readonly StaffTextDraft[]): Promise<CaseDraft> {
  const next: CaseDraft = { ...draft, written: { ...draft.written }, texts: { ...draft.texts } };
  for (const kind of DRAFT_TEXT_KINDS) {
    if (next.written[kind] !== "") continue;
    const newest = saved.filter((text) => text.kind === kind).at(-1);
    if (!newest) continue;
    if (staffTextProblem(newest.text) !== null) continue;
    const digest = await textDigest(newest.salt, newest.text).catch(() => null);
    if (digest !== newest.digest) continue;
    next.written[kind] = newest.text;
    next.texts[kind] = { id: newest.id, text: newest.text, salt: newest.salt, digest };
  }
  return next;
}

// ---------------------------------------------------------------- the statement the preview shows

/** The source the database will record for a decision made now: a notice, a report, or the moderator's own finding, from the items it considers. */
export function predictedSource(view: CaseView, kind: "interim" | "final"): StatementInput["source"] {
  const fromUsers = considered(view, kind).filter((item) => item.source.kind !== "staff");
  if (fromUsers.some((item) => item.allegesIllegal)) return "notice";
  return fromUsers.length > 0 ? "report" : "own_initiative";
}

/** Whether korbat still keeps what a decision's snapshot copied: the page shows that snapshot's content. */
const snapshotShown = (view: CaseView, snapshotId: string): boolean => view.snapshots.some((snapshot) => snapshot.id === snapshotId && !snapshot.withheld);

const NO_RESET = { resetDecisionId: null, oldValueKept: false, resetRuleId: null } as const;

/** What a statement says of a field reset that ends or is lifted: the decision that holds it, and whether its old value is still kept. */
function resetFacts(view: CaseView, decision: CaseDecision, action: CaseDecisionAction) {
  const target = MEASURES[action.kind].target;
  if (target !== "display_name" && target !== "bio") return NO_RESET;
  return { resetDecisionId: decision.id, oldValueKept: action.noEffect === null && snapshotShown(view, decision.snapshotId), resetRuleId: decision.ruleId };
}

/** The measures taken while deciding that a final decision made now would end: every one when it closes the case, and a seal with the answer to the suspect items. */
function endedBy(view: CaseView, draft: CaseDraft): StatementInput["endedMeasures"] {
  if (draft.kind !== "final") return [];
  const closes = leftOpen(view).length === 0;
  const answersSuspect = suspectOpen(view).length > 0;
  const seals = draft.actions.some((action) => action.kind === "seal_media");
  return interimInForce(view)
    .filter(({ action }) => (action.kind === "seal_media" ? answersSuspect && !seals : closes) && !holds(draft, reversalOf(action)))
    .map(({ decision, action }) => ({ kind: action.kind as MeasureKind, mediaId: action.mediaId, ...resetFacts(view, decision, action) }));
}

/** The newest snapshot the page can show that holds the post's creation time. */
const datedSnapshot = (view: CaseView) => view.snapshots.find((snapshot): snapshot is Extract<CaseSnapshot, { withheld: false }> => !snapshot.withheld && snapshot.postCreatedAt !== null);

/**
 * Whether the page can draw a statement for the case at all. A post's statement names the post by its creation time,
 * which only a snapshot holds: without one the page can show there is no preview, and no time is made up.
 */
export const previewable = (view: CaseView): boolean => view.target.type !== "post" || datedSnapshot(view) !== undefined;

/** The post a post case's statement names: its id and the creation time the shown snapshot copied. */
function postOf(view: CaseView): StatementInput["post"] {
  if (view.target.type !== "post") return null;
  const shown = datedSnapshot(view);
  if (!shown || shown.postCreatedAt === null) throw new Error("a post's statement names the post's creation time: the page shows no snapshot that holds it");
  return { id: view.target.id, createdAt: shown.postCreatedAt };
}

/**
 * 3d Task 6 (section 8.4): the program's finding among the case's unanswered items, with the image it names, or null: a
 * person's decision taken now considers it, so the composer says that the decision is recorded as found by automated
 * means ([case.autoRecord]) and the preview prints the found paragraph.
 */
export function programFinding(view: CaseView): { signal: CaseSignal; mediaId: string | null } | null {
  for (const signal of view.signals) {
    const item = view.items.find((candidate) => candidate.id === signal.itemId);
    if (item !== undefined && item.answeredBy === null) return { signal, mediaId: item.mediaId };
  }
  return null;
}

/**
 * 3d Task 7 (W.3): a case's signal as a statement reads it: a score with whether the image was opened; a match with its
 * source's name, the kind of match derived as the API derives it, and what the source lists the entry as.
 */
export function statementSignalOf(signal: CaseSignal, viewed: boolean | null): NonNullable<StatementInput["signal"]> {
  const match = signal.match;
  if (signal.kind !== "known_match" || match == null) return { kind: signal.kind, source: null, matchKind: null, listedAs: null, viewed };
  return { kind: "known_match", source: match.source, matchKind: statementMatchKind(match.hashType, match.matchKind), listedAs: match.listed ? "csam" : "other", viewed: null };
}

/**
 * The automation members of a person's statement (W.3), as the API's statement data carries them: what found the items the
 * decision is about, and whether its moderator opened the image on this case before deciding, which the page knows from
 * the images it showed this person. A correction or a review speaks of the decision it is about: a program's, or one whose
 * answered items a program found. Nothing when no program found anything here.
 */
function automationOf(view: CaseView, draft: CaseDraft, viewedImages: readonly string[]): Partial<StatementInput> {
  let found: { signal: CaseSignal; mediaId: string | null } | null = null;
  if (draft.kind === "correction" || draft.kind === "review") {
    const corrected = view.decisions.find((decided) => decided.id === draft.reviewsDecisionId);
    for (const signal of view.signals) {
      const item = view.items.find((candidate) => candidate.id === signal.itemId);
      if (item !== undefined && (corrected?.byProgram === true || item.answeredBy === corrected?.id)) {
        found = { signal, mediaId: item.mediaId };
        break;
      }
    }
  } else {
    found = programFinding(view);
  }
  if (found === null) return {};
  const viewed = found.mediaId !== null && viewedImages.includes(found.mediaId);
  // 3d Task 7: a restriction on a match's finding citing R2 is partly automated, as decision_holds records it.
  return { automatedDetection: true, automatedDecision: restrictsOnMatch(view, draft) ? "partially" : "not_automated", signal: statementSignalOf(found.signal, viewed) };
}

/**
 * 3d Task 6 (section 8.4, [case.auto]): the statement a program's decision sent its author, drawn again from the decision as
 * the case answer holds it: its one measure, no text, and the automation members of a decision without a decider.
 */
export function programStatementOf(view: CaseView, decision: CaseDecision): StatementInput {
  const signal = view.signals[0];
  return {
    kind: decision.kind,
    outcome: decision.outcome,
    ground: decision.ground,
    ruleId: decision.ruleId,
    rulesVersion: decision.rulesVersion,
    redressVersion: decision.redressVersion,
    legalReference: null,
    facts: null,
    reason: null,
    source: decision.source,
    decidedAt: decision.decidedAt,
    post: postOf(view),
    measures: decision.actions.filter((action) => MEASURES[action.kind].lifts === null).map((action) => ({ kind: action.kind as MeasureKind, mediaId: action.mediaId, noEffect: action.noEffect, sealed: null })),
    reversals: [],
    endedMeasures: [],
    reviewed: null,
    automatedDetection: true,
    automatedDecision: "fully",
    // 3d Task 7: a program's seal on a match names the match's source and kind, as its statement was sent.
    signal: signal === undefined ? { kind: "r1_score", source: null, matchKind: null, listedAs: null, viewed: null } : statementSignalOf(signal, null),
  };
}

/** Whether the decision a statement was drawn for sends its author anything: one that restricts nothing, lifts nothing and ends nothing is recorded without a mail. */
export const statementSent = (input: StatementInput): boolean => input.kind === "review" || input.kind === "correction" || input.measures.length + input.reversals.length + input.endedMeasures.length > 0;

/** Whether a correction that lifts these leaves nothing of its decision in force: then it reverses the decision, else part of it. */
function reversesAll(view: CaseView, draft: CaseDraft): boolean {
  const decision = view.decisions.find((decided) => decided.id === draft.reviewsDecisionId);
  const inForce = (decision?.actions ?? []).filter((action) => liftsOneByOne(action) && action.inForce);
  return inForce.every((action) => holds(draft, reversalOf(action)));
}

/**
 * The statement as its author will receive it, from the draft: the data statementParagraphs renders for the preview. What
 * only the database knows when the decision is recorded (a seal's list, whether a measure changes anything) is the
 * page's reading of the case as it showed it. It throws for a post case without a snapshot the page can show
 * (previewable says so first).
 */
export function previewOf(view: CaseView, draft: CaseDraft, now: Date, viewedImages: readonly string[] = []): StatementInput {
  const text = (kind: DraftTextKind): string | null => (normalised(draft.written[kind]) === "" ? null : normalised(draft.written[kind]));
  // 3d Task 6: what found the items, and whether this person opened the image, as the statement will say (W.3).
  const base = { redressVersion: REDRESS_VERSION, decidedAt: now.toISOString(), post: postOf(view), ...automationOf(view, draft, viewedImages) };
  if (draft.kind === "correction" || draft.kind === "review") {
    const corrected = view.decisions.find((decided) => decided.id === draft.reviewsDecisionId);
    if (!corrected || (corrected.kind !== "interim" && corrected.kind !== "final")) throw new Error("a correction's or a review's draft names a decision of the case that restricts");
    return {
      ...base,
      kind: draft.kind,
      outcome: draft.kind === "review" ? reviewOutcomeOf(view, draft) : draft.answer === "kept" ? "kept" : reversesAll(view, draft) ? "reversed" : "partly_reversed",
      ground: null,
      ruleId: null,
      rulesVersion: corrected.rulesVersion,
      legalReference: null,
      facts: null,
      reason: text("review_reason"),
      source: corrected.source,
      measures: [],
      // 3e: a full reversal also overrules the decision's strike, as the params will carry it.
      reversals: [...draft.actions, ...overruleOf(corrected, draft.kind === "review" ? reviewOutcomeOf(view, draft) === "reversed" : reversesAll(view, draft))].map((reversal) => {
        const lifted = corrected.actions.find((action) => liftsOneByOne(action) && sameAction(reversalOf(action), reversal));
        // 3e: the handle a retirement's reversal gives back, which the case answer names on the retirement's row.
        const handle = reversal.kind === "unretire_handle" ? { handle: lifted?.handle ?? null } : {};
        // 3e Task 3: what a lift of a suspension lifts, and where its period stands now, which is the lift's time.
        const lift =
          reversal.kind === "lift_suspension" && lifted
            ? {
                liftedKind: lifted.kind === "terminate" ? ("terminate" as const) : ("suspend" as const),
                liftedDecidedAt: corrected.decidedAt,
                periodThen: periodNow(lifted),
                // Task 4: a withdrawal for another measure, and whether the person had replied to what it withdraws.
                replaced: draft.replaced === true,
                replyFiledAt: lifted.reply?.filedAt ?? null,
              }
            : {};
        // 3e Task 5: what a lift of a reporting measure lifts, and whether a restriction's days still ran.
        const reporting = reversal.kind === "lift_reporting" && lifted ? reportingLiftOf(corrected, lifted, now) : {};
        return { kind: reversal.kind as ReversalKind, mediaId: reversal.mediaId, ...(lifted ? resetFacts(view, corrected, lifted) : NO_RESET), ...handle, ...lift, ...reporting };
      }),
      endedMeasures: [],
      reviewed: {
        kind: corrected.kind,
        ground: corrected.ground,
        ruleId: corrected.ruleId,
        rulesVersion: corrected.rulesVersion,
        legalReference: corrected.legalReference,
        decidedAt: corrected.decidedAt,
        // 3e's review (people1): the basis of the corrected decision's suspension or termination, as the API's statement carries it.
        basis: corrected.actions.find((action) => action.kind === "suspend" || action.kind === "terminate")?.basis ?? null,
      },
      // Task 4: what an answer to the reply fixes, as far as the page can tell now.
      ...(draft.kind === "correction" ? { repliedTo: repliedToPreview(corrected, draft, now) } : {}),
    };
  }
  const restricts = draft.outcome === "restricted";
  const law = restricts && draft.ground === "illegal";
  const reach = view.suspicion?.reach ?? { posts: 0, images: 0 };
  // The facts and the reason are told with a decision that holds a measure. Those of a decision without one are the
  // case's record, for staff: the statement's data holds neither, here as in the API's own reading of the decision.
  const told = draft.actions.some((action) => MEASURES[action.kind].lifts === null);
  return {
    ...base,
    kind: draft.kind,
    outcome: draft.outcome,
    ground: restricts ? draft.ground : null,
    ruleId: restricts && !law ? draft.ruleId : null,
    rulesVersion: RULES_VERSION,
    legalReference: law ? text("legal_reference") : null,
    facts: told ? text("facts") : null,
    reason: told ? text("reason") : null,
    source: predictedSource(view, draft.kind),
    measures: draft.actions
      .filter((action) => MEASURES[action.kind].lifts === null)
      .map((action) => {
        const noEffect = noEffectOf(view, action, draft.kind === "final" ? "final" : "interim");
        // 3e Task 4: an announced suspension or termination, or a termination at once.
        if ((action.kind === "suspend" && action.announced === true) || action.kind === "terminate") return previewStanding(view, action, noEffect, now);
        // 3e Task 3: a suspension at once, with its basis, its end and the decision it rests on, as the database will fix them.
        if (action.kind === "suspend") return previewSuspension(view, draft, action, noEffect, now);
        // 3e Task 5: a warning about reporting or a restriction of it, with its end and the warning a restriction follows.
        if (action.kind === "warn_reporting" || action.kind === "restrict_reporting") return previewReporting(view, action, noEffect, now);
        const measure = { kind: action.kind as MeasureKind, mediaId: action.mediaId, noEffect, sealed: action.kind === "seal_media" ? { posts: reach.posts, images: reach.images, deletedImages: 0 } : null };
        // 3e: a retirement names the snapshot's handle, and the placeholder's form when it changes the profile.
        if (action.kind !== "retire_handle") return measure;
        return { ...measure, handle: snapshotHandle(view) ?? (view.target.type === "account" ? (view.target.handle?.toLowerCase() ?? null) : null), placeholder: noEffect === null ? PREVIEW_PLACEHOLDER : null };
      })
      // 3e: the strike the params will carry, until when it counts (decided now) and the strikes that count with it.
      .concat(
        strikeOf(view, draft).map(() => ({
          kind: "strike" as MeasureKind,
          mediaId: null,
          noEffect: null,
          sealed: null,
          endsAt: new Date(now.getTime() + STANDING_RULES.strikeDays * DAY_MS).toISOString(),
          activeThen: ACTIVE_THEN[view.authorStanding?.activeStrikes ?? "0"],
        })),
      ),
    reversals: draft.actions.filter((action) => MEASURES[action.kind].lifts !== null).map((action) => ({ kind: action.kind as ReversalKind, mediaId: action.mediaId, ...NO_RESET })),
    endedMeasures: endedBy(view, draft),
    reviewed: null,
  };
}

// ---------------------------------------------------------------- the params and the confirmation

/** The digest of a snapshot, computed here from the members the page displayed: never the digest the answer carried. */
/** The digest a decision signs: of what the page showed, or, for a copy withheld while its post is preserved for an order, the stored one. */
export function signedSnapshotDigest(snapshot: CaseSnapshot): Promise<string> {
  return snapshot.withheld ? Promise.resolve(snapshot.digest) : shownSnapshotDigest(snapshot);
}

export function shownSnapshotDigest(snapshot: Extract<CaseSnapshot, { withheld: false }>): Promise<string> {
  return snapshotDigest({
    salt: snapshot.salt,
    targetType: snapshot.targetType,
    targetId: snapshot.targetId,
    takenAt: snapshot.takenAt,
    authorHandle: snapshot.authorHandle,
    postState: snapshot.postState,
    postCreatedAt: snapshot.postCreatedAt,
    replyToId: snapshot.replyToId,
    quoteOfId: snapshot.quoteOfId,
    body: snapshot.body,
    media: snapshot.media,
    displayName: snapshot.displayName,
    bio: snapshot.bio,
    handle: snapshot.handle,
  });
}

/** The digests a decision's params carry: the shown snapshot's, and those of the texts the console saved. */
export interface DecisionDigests {
  snapshot: string;
  facts: string | null;
  reason: string | null;
  legalReference: string | null;
}

/**
 * The params the key confirms, built from what the page shows (3c design, section 7.5, step 1): the case's version, the
 * range a final decision answers, the newest snapshot by its id with the digest the console computed, the digests of the
 * saved texts and the actions in their one order. The contracts' schema refuses what cannot stand before any key is asked.
 */
export function decisionParamsOf(view: CaseView, draft: CaseDraft, digests: DecisionDigests): CaseDecidedParams {
  const newest = view.snapshots[0];
  if (!newest) throw new Error("a decision names a snapshot of its case: the case holds none");
  const corrected = draft.kind === "correction" ? view.decisions.find((decided) => decided.id === draft.reviewsDecisionId) : undefined;
  if (draft.kind === "correction" && !corrected) throw new Error("a correction's draft names a decision of the case");
  // 3e: the strike the case answer says is due, and the overruling of a full correction, are the console's to add: the
  // person never chooses either. A kept answer to a reply, and a kept correction that withdraws a decision's marks, lift
  // nothing and overrule nothing. Task 5: a final "No breach" decision signs the marks its person ticked on the items it
  // answers; any other signs none, and a withdrawal of marks signs no list either (the database withdraws them all).
  const kept = draft.answer === "kept" || draft.withdrawMarks === true;
  const added = draft.kind === "correction" ? (kept ? [] : overruleOf(corrected, reversesAll(view, draft))) : strikeOf(view, draft);
  const actions = [...draft.actions, ...added].sort(compareDecisionActions);
  const unfounded = draft.kind === "correction" ? [] : marksOf(view, draft);
  const shared = { stateVersion: view.stateVersion, snapshotId: newest.id, snapshotDigest: digests.snapshot, redressVersion: REDRESS_VERSION, actions, unfounded, replaced: draft.kind === "correction" && draft.replaced === true };
  if (draft.kind === "correction" && corrected) {
    return CaseDecidedParams.parse({
      ...shared,
      kind: "correction",
      throughSeq: 0,
      reviewsDecisionId: corrected.id,
      outcome: kept ? "kept" : reversesAll(view, draft) ? "reversed" : "partly_reversed",
      ground: null,
      ruleId: null,
      // A correction carries the rulebook version and the category of the decision it corrects.
      rulesVersion: corrected.rulesVersion,
      category: corrected.category,
      categoryKeyword: null,
      factsDigest: null,
      reasonDigest: digests.reason,
      legalReferenceDigest: null,
    });
  }
  const restricts = draft.outcome === "restricted";
  const law = restricts && draft.ground === "illegal";
  return CaseDecidedParams.parse({
    ...shared,
    kind: draft.kind,
    throughSeq: draft.kind === "final" ? throughSeqOf(view) : 0,
    reviewsDecisionId: null,
    outcome: draft.outcome,
    ground: restricts ? draft.ground : null,
    ruleId: restricts && !law ? draft.ruleId : null,
    rulesVersion: RULES_VERSION,
    category: draft.category,
    categoryKeyword: law && draft.terrorist ? "KEYWORD_TERRORIST_CONTENT" : null,
    // A restriction carries both; a decision without a measure carries each when it was written.
    factsDigest: digests.facts,
    reasonDigest: digests.reason,
    legalReferenceDigest: law ? digests.legalReference : null,
    // 3d Task 7: the reason of an answer without a seal on an acting match, signed only where it is asked for, so every
    // other decision's params hash as before.
    ...(answerReasonNeeded(view, draft) ? { matchAnswerReason: draft.matchAnswerReason ?? null } : {}),
  });
}

/** The texts whose fields a draft's decision has on the page, in the order they are saved. */
export function textsOffered(draft: CaseDraft): DraftTextKind[] {
  if (draft.kind === "correction" || draft.kind === "review") return ["review_reason"];
  return draft.outcome === "restricted" && draft.ground === "illegal" ? ["facts", "reason", "legal_reference"] : ["facts", "reason"];
}

/**
 * The texts a draft's decision cannot do without. A restriction needs its facts and its reason, and on the law its legal
 * reference; a correction its reason. A decision without a measure may leave both of its texts empty, except an answer to
 * a report or finding of child sexual abuse material: an admin decides it without seeing the images, and says in the
 * facts what the answer rested on.
 */
export function textsRequired(view: CaseView, draft: CaseDraft): DraftTextKind[] {
  if (draft.kind === "correction" || draft.kind === "review" || draft.outcome === "restricted") return textsOffered(draft);
  return suspectOpen(view).length > 0 ? ["facts"] : [];
}

/** Whether a draft holds what its decision needs before anything is sent: something to do, and each text it cannot do without. */
export function complete(view: CaseView, draft: CaseDraft): boolean {
  if (textsRequired(view, draft).some((kind) => normalised(draft.written[kind]) === "")) return false;
  // 3e: a kept answer to a reply lifts nothing; every other correction lifts something.
  if (draft.kind === "correction") return draft.answer === "kept" ? draft.actions.length === 0 : draft.actions.length > 0;
  if (draft.kind === "review") return reviewConsistent(view, draft);
  return draft.outcome !== "restricted" || draft.actions.some((action) => MEASURES[action.kind].lifts === null);
}

/** What saving one text of a draft came to: the saved text, the console's words for a refusal with its code, or null when there was nothing to save. */
export type TextSaveOutcome = { saved: SavedText } | { error: string; code: string } | null;

/**
 * Saves one text of a draft, without the key (3c design, section 7.4): when its field loses focus, and again at Confirm
 * for a text that is not saved yet. Nothing is sent for an empty text, or for one whose normalised form is the one saved
 * already. A refusal comes back in the console's words; nothing is thrown, and the draft is not touched: what was
 * written stays with the caller, which saves it again at the next occasion.
 */
export async function saveDraftText(deps: { api: StaffApi; random?: RandomBytes }, caseId: CaseId, draft: CaseDraft, kind: DraftTextKind): Promise<TextSaveOutcome> {
  const text = normalised(draft.written[kind]);
  if (text === "" || draft.texts[kind]?.text === text) return null;
  try {
    const saved = await saveStaffText(deps, caseId, kind, draft.written[kind]);
    return { saved: { id: saved.id, text: saved.text, salt: saved.salt, digest: saved.digest } };
  } catch (err) {
    return { error: describeError(err, NOTE_WORDS), code: codeOf(err) ?? "internal" };
  }
}

/** The codes after which the case, or its snapshot, is no longer what the page shows: the refusal's words say to read or to take a snapshot again. */
const STALE_CODES: readonly string[] = ["case_changed", "profile_changed", "snapshot_erased", "snapshot_mismatch"];

/**
 * What the page does about a refused confirmation, beside wording it in place with the draft kept: it reads the case
 * again when the refusal says that the case or its snapshot changed, so that "take a fresh snapshot and decide again" can
 * be followed on the spot; and it forgets which texts it saved when one of them is gone or was used, so that the next
 * Confirm saves them again.
 */
export function afterRefusal(code: string): { readAgain: boolean; saveAgain: boolean } {
  return { readAgain: STALE_CODES.includes(code), saveAgain: code === "text_not_found" };
}

/**
 * The page's words after a decision was recorded: on a final decision, which reports the range left open for later, and
 * how many items arrived since the page read the case, which stay open too.
 */
export function decidedNotice(before: CaseView, now: CaseView, wasFinal: boolean): string {
  const words: string[] = [COMPOSER.recorded];
  if (!wasFinal) return words.join(" ");
  const left = leftOpen(before).length;
  const open = now.items.filter((item) => item.outcome === null).length;
  if (left > 0) words.push(COMPOSER.leftForLater(left));
  if (open > left) words.push(COMPOSER.arrivedSince(open - left));
  // The page showed a decision that closes the case and ends what was done while deciding; an item that arrived meanwhile
  // kept the case open, and with it those measures.
  const staying = left === 0 && open > 0 && now.closedAt === null ? interimInForce(now).map(({ action }) => MEASURES[action.kind].label) : [];
  if (staying.length > 0) words.push(COMPOSER.interimStays(staying.join(", ")));
  return words.join(" ");
}

/** What a confirmation needs of the page that runs it: whether it is still open, what it shows and holds now, the saves of texts on their way, and its busy flag. */
export interface ConfirmingPage {
  alive(): boolean;
  /** The case the page shows, or null when it shows none (a read failed for good). */
  shown(): CaseView | null;
  draft(): CaseDraft | null;
  saving(): readonly Promise<unknown>[];
  setBusy(busy: boolean): void;
}

/**
 * One confirmation with the page's busy flag around it. The flag goes up before anything is awaited and comes down on
 * every way out while the page is still open: when `run` has ended, when it threw, and when the page shows no case or
 * holds no draft any more after the wait, so that the composer is never left switched off. The click that confirms also
 * takes the focus from a text's field: that save ends first, so that its text is not saved twice, and `run` gets the
 * case and the draft as they stand after it.
 */
export async function confirmWhileBusy(page: ConfirmingPage, run: (view: CaseView, draft: CaseDraft) => Promise<void>): Promise<void> {
  if (page.shown() === null || page.draft() === null) return;
  page.setBusy(true);
  try {
    await Promise.allSettled(page.saving());
    const [view, draft] = [page.shown(), page.draft()];
    if (!page.alive() || view === null || draft === null) return;
    await run(view, draft);
  } finally {
    if (page.alive()) page.setBusy(false);
  }
}

/**
 * What "Confirm with your staff key" comes to: the case as it now stands; or a fresh snapshot that the page must show
 * before anything is confirmed; or the console's words for the step that failed, with its code, the draft kept.
 */
export type ConfirmOutcome = { view: CaseView } | { fresh: CaseView; notice: string } | { error: string; code: string };

/**
 * The decision as the page runs it (3c design, section 7.5, step 1). `caseId` is the case of the page's address: the
 * texts are saved on it and the key confirms a decision on it, never on whatever case an answer named. In this order:
 *   1. a view of another case than the page's, or a draft that lacks a measure or a text it needs, is not sent at all;
 *   2. when the case's newest snapshot cannot be shown (withheld, erased, or none), a fresh one is taken and the case
 *      read again, and nothing is confirmed: the page shows it first, so no decision names a snapshot nobody was shown;
 *   3. each text that is written is saved, without the key, unless the same text was saved before (when its field lost
 *      focus, or at an earlier try); the digest is the one computed here (saveStaffText refuses an answer that carries
 *      another), and `remember` is told of each save;
 *   4. the snapshot's digest is computed from what the page displayed;
 *   5. the params are built and checked, and the key confirms exactly them; the answer is the case as it now stands. A
 *      review is confirmed as its own action, on the decision whose appeal it answers.
 * Nothing is thrown: a refusal comes back as the console's words for its code.
 */
export async function confirmDecision(
  // 3f Task 6: `gap`, the restore gap a decision takes again after a restore, which the decide or review route closes.
  deps: { api: StaffApi; credentials: CredentialsLike; random?: RandomBytes; gap?: string | null },
  caseId: CaseId,
  view: CaseView,
  draft: CaseDraft,
  remember: (kind: DraftTextKind, saved: SavedText) => void = () => undefined,
): Promise<ConfirmOutcome> {
  const refusal = (err: unknown): ConfirmOutcome => ({ error: describeError(err), code: codeOf(err) ?? "internal" });
  if (view.id !== caseId) return { error: messageFor("invalid_answer"), code: "invalid_answer" };
  if (!complete(view, draft)) return { error: COMPOSER.incomplete, code: "incomplete" };
  // 3d Task 7 (8.4): an answer without a seal on an acting match is refused before the key without its reason.
  if (answerReasonNeeded(view, draft) && (draft.matchAnswerReason ?? null) === null) return { error: AUTOMATION_WORDS.answerReason.choose, code: "incomplete" };

  const newest = view.snapshots[0];
  // 3f (design, section 8.6): on a post preserved for an order every copy is withheld from staff, a fresh one too; the
  // decision then signs the newest copy's stored digest, which the database compares as it always does.
  if (!newest || (newest.withheld && !view.preserved)) {
    try {
      await deps.api.takeSnapshot(caseId, { activity: true });
      return { fresh: await deps.api.caseView(caseId, { activity: true }), notice: COMPOSER.freshSnapshot };
    } catch (err) {
      return refusal(err);
    }
  }

  const digests: Partial<Record<DraftTextKind, string>> = {};
  for (const kind of textsOffered(draft)) {
    const outcome = await saveDraftText(deps, caseId, draft, kind);
    if (outcome !== null && "error" in outcome) return outcome;
    if (outcome !== null) remember(kind, outcome.saved);
    // Saved just now, saved before, or left empty: an empty text has no digest.
    const digest = outcome?.saved.digest ?? (normalised(draft.written[kind]) === "" ? undefined : draft.texts[kind]?.digest);
    if (digest !== undefined) digests[kind] = digest;
  }

  if (draft.kind === "review") {
    // A review is confirmed as the action of its own: on the decision it reviews, with its appeal among the params.
    let reviewed: AppealsReviewedParams;
    try {
      reviewed = reviewParamsOf(view, draft, { snapshot: await signedSnapshotDigest(newest), reason: digests.review_reason ?? null });
    } catch {
      return { error: COMPOSER.incomplete, code: "incomplete" };
    }
    try {
      return { view: await reviewWithKey(deps, caseId, draft.reviewsDecisionId ?? "", reviewed, deps.gap ?? null) };
    } catch (err) {
      return refusal(err);
    }
  }

  let params: CaseDecidedParams;
  try {
    params = decisionParamsOf(view, draft, {
      snapshot: await signedSnapshotDigest(newest),
      facts: digests.facts ?? null,
      reason: draft.kind === "correction" ? (digests.review_reason ?? null) : (digests.reason ?? null),
      legalReference: digests.legal_reference ?? null,
    });
  } catch {
    return { error: COMPOSER.incomplete, code: "incomplete" };
  }
  try {
    return { view: await decideWithKey(deps, caseId, params, deps.gap ?? null) };
  } catch (err) {
    return refusal(err);
  }
}
