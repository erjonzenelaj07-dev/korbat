import {
  AppealsReviewedParams,
  CaseDecidedParams,
  MEASURES,
  MEASURE_KINDS,
  RULE_DEFAULT_CATEGORY,
  SEAL_DRAFTS,
  compareDecisionActions,
  sealFactsDraft,
  snapshotDigest,
  staffTextProblem,
  textDigest,
  type ActionKind,
  type CaseAppeal,
  type CaseDecision,
  type CaseDecisionAction,
  type CaseItem,
  type CaseSnapshot,
  type CaseView,
  type DecisionActionParams,
  type MeasureKind,
  type ReversalKind,
  type RuleId,
  type StaffMe,
  type StaffTextDraft,
  type TdbCategory,
} from "@korbat/contracts";
import { REDRESS_VERSION, RULES_VERSION, type StatementInput } from "@korbat/rules";
import type { StaffApi } from "./api";
import { codeOf, COMPOSER_WORDS, describeError, messageFor, NOTE_WORDS } from "./messages";
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
  const targets = view.target.type === "post" ? ["post", "image"] : ["display_name", "bio"];
  return MEASURE_KINDS.filter((measure) => measure !== "seal_media" && MEASURES[measure][kind] && targets.includes(MEASURES[measure].target) && !(kind === "interim" && measure === "withhold" && hiddenWhileDeciding(view)));
}

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

/** The reversal that lifts a measure. */
function reversalOf(action: { kind: ActionKind; mediaId: string | null }): DecisionActionParams {
  const target = MEASURES[action.kind].target;
  if (target === "post") return { kind: "restore", mediaId: null };
  if (target === "image") return { kind: "restore_media", mediaId: action.mediaId };
  if (target === "images") return { kind: "unseal_media", mediaId: null };
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
function actionOffered(view: CaseView, role: StaffRole, kind: "interim" | "final", restricts: boolean, action: DecisionActionParams): boolean {
  // A Lift stands beside a withhold taken while deciding, on a final decision that leaves the case open.
  if (MEASURES[action.kind].lifts !== null) return kind === "final" && leftOpen(view).length > 0 && liftable(view).some((lift) => sameAction(lift, action));
  if (!restricts) return false;
  if (action.kind === "seal_media") return sealOffered(view, kind, role);
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
  const actions = draft.actions.filter((action) => actionOffered(view, role, kind, outcome === "restricted", action));
  const same = kind === draft.kind && outcome === draft.outcome && ground === draft.ground && ruleId === draft.ruleId && actions.length === draft.actions.length;
  return same ? draft : { ...draft, kind, outcome, ground, ruleId, category, actions };
}

/** The fixed drafts of a seal on this case: the facts by its unanswered suspect items, the reason by whether it is taken while deciding or for good. */
export function sealDraftFor(view: CaseView, kind: "interim" | "final"): { facts: string; reason: string } {
  const items = suspectOpen(view).map((item) => ({ source: item.source.kind === "staff" ? ("finding" as const) : ("user" as const), added: item.quotedByPosition !== null }));
  return { facts: sealFactsDraft(view.target.type, items), reason: kind === "final" ? SEAL_DRAFTS.reason.final : SEAL_DRAFTS.reason.deciding };
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
  const measures = decision.actions.filter((action) => MEASURES[action.kind].lifts === null && action.inForce && (role === "admin" || action.kind !== "seal_media"));
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
  return { appeal, measures: decision.actions.filter((action) => MEASURES[action.kind].lifts === null && action.inForce) };
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
    actions: [...draft.actions].sort(compareDecisionActions),
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

/** Whether the decision a statement was drawn for sends its author anything: one that restricts nothing, lifts nothing and ends nothing is recorded without a mail. */
export const statementSent = (input: StatementInput): boolean => input.kind === "review" || input.kind === "correction" || input.measures.length + input.reversals.length + input.endedMeasures.length > 0;

/** Whether a correction that lifts these leaves nothing of its decision in force: then it reverses the decision, else part of it. */
function reversesAll(view: CaseView, draft: CaseDraft): boolean {
  const decision = view.decisions.find((decided) => decided.id === draft.reviewsDecisionId);
  const inForce = (decision?.actions ?? []).filter((action) => MEASURES[action.kind].lifts === null && action.inForce);
  return inForce.every((action) => holds(draft, reversalOf(action)));
}

/**
 * The statement as its author will receive it, from the draft: the data statementParagraphs renders for the preview. What
 * only the database knows when the decision is recorded (a seal's list, whether a measure changes anything) is the
 * page's reading of the case as it showed it. It throws for a post case without a snapshot the page can show
 * (previewable says so first).
 */
export function previewOf(view: CaseView, draft: CaseDraft, now: Date): StatementInput {
  const text = (kind: DraftTextKind): string | null => (normalised(draft.written[kind]) === "" ? null : normalised(draft.written[kind]));
  const base = { redressVersion: REDRESS_VERSION, decidedAt: now.toISOString(), post: postOf(view) };
  if (draft.kind === "correction" || draft.kind === "review") {
    const corrected = view.decisions.find((decided) => decided.id === draft.reviewsDecisionId);
    if (!corrected || (corrected.kind !== "interim" && corrected.kind !== "final")) throw new Error("a correction's or a review's draft names a decision of the case that restricts");
    return {
      ...base,
      kind: draft.kind,
      outcome: draft.kind === "review" ? reviewOutcomeOf(view, draft) : reversesAll(view, draft) ? "reversed" : "partly_reversed",
      ground: null,
      ruleId: null,
      rulesVersion: corrected.rulesVersion,
      legalReference: null,
      facts: null,
      reason: text("review_reason"),
      source: corrected.source,
      measures: [],
      reversals: draft.actions.map((reversal) => {
        const lifted = corrected.actions.find((action) => sameAction(reversalOf(action), reversal));
        return { kind: reversal.kind as ReversalKind, mediaId: reversal.mediaId, ...(lifted ? resetFacts(view, corrected, lifted) : NO_RESET) };
      }),
      endedMeasures: [],
      reviewed: { kind: corrected.kind, ground: corrected.ground, ruleId: corrected.ruleId, rulesVersion: corrected.rulesVersion, legalReference: corrected.legalReference, decidedAt: corrected.decidedAt },
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
      .map((action) => ({
        kind: action.kind as MeasureKind,
        mediaId: action.mediaId,
        noEffect: noEffectOf(view, action, draft.kind === "final" ? "final" : "interim"),
        sealed: action.kind === "seal_media" ? { posts: reach.posts, images: reach.images, deletedImages: 0 } : null,
      })),
    reversals: draft.actions.filter((action) => MEASURES[action.kind].lifts !== null).map((action) => ({ kind: action.kind as ReversalKind, mediaId: action.mediaId, ...NO_RESET })),
    endedMeasures: endedBy(view, draft),
    reviewed: null,
  };
}

// ---------------------------------------------------------------- the params and the confirmation

/** The digest of a snapshot, computed here from the members the page displayed: never the digest the answer carried. */
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
  const actions = [...draft.actions].sort(compareDecisionActions);
  const shared = { stateVersion: view.stateVersion, snapshotId: newest.id, snapshotDigest: digests.snapshot, redressVersion: REDRESS_VERSION, actions };
  if (draft.kind === "correction") {
    const corrected = view.decisions.find((decided) => decided.id === draft.reviewsDecisionId);
    if (!corrected) throw new Error("a correction's draft names a decision of the case");
    return CaseDecidedParams.parse({
      ...shared,
      kind: "correction",
      throughSeq: 0,
      reviewsDecisionId: corrected.id,
      outcome: reversesAll(view, draft) ? "reversed" : "partly_reversed",
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
  if (draft.kind === "correction") return draft.actions.length > 0;
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
  deps: { api: StaffApi; credentials: CredentialsLike; random?: RandomBytes },
  caseId: CaseId,
  view: CaseView,
  draft: CaseDraft,
  remember: (kind: DraftTextKind, saved: SavedText) => void = () => undefined,
): Promise<ConfirmOutcome> {
  const refusal = (err: unknown): ConfirmOutcome => ({ error: describeError(err), code: codeOf(err) ?? "internal" });
  if (view.id !== caseId) return { error: messageFor("invalid_answer"), code: "invalid_answer" };
  if (!complete(view, draft)) return { error: COMPOSER.incomplete, code: "incomplete" };

  const newest = view.snapshots[0];
  if (!newest || newest.withheld) {
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
      reviewed = reviewParamsOf(view, draft, { snapshot: await shownSnapshotDigest(newest), reason: digests.review_reason ?? null });
    } catch {
      return { error: COMPOSER.incomplete, code: "incomplete" };
    }
    try {
      return { view: await reviewWithKey(deps, caseId, draft.reviewsDecisionId ?? "", reviewed) };
    } catch (err) {
      return refusal(err);
    }
  }

  let params: CaseDecidedParams;
  try {
    params = decisionParamsOf(view, draft, {
      snapshot: await shownSnapshotDigest(newest),
      facts: digests.facts ?? null,
      reason: draft.kind === "correction" ? (digests.review_reason ?? null) : (digests.reason ?? null),
      legalReference: digests.legal_reference ?? null,
    });
  } catch {
    return { error: COMPOSER.incomplete, code: "incomplete" };
  }
  try {
    return { view: await decideWithKey(deps, caseId, params) };
  } catch (err) {
    return refusal(err);
  }
}
