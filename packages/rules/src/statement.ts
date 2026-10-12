import { MEASURES, RETENTION, appealDeadline, type DecisionStatement, type MeasureKind, type ReversalKind } from "@korbat/contracts";
// The rulebooks and the redress texts live in the index, which re-exports this module: the two import each other, and
// each uses the other's functions only when called, never while it loads.
import { getRedress, getRule, type RedressTexts } from "./index";

/**
 * The statement of reasons (3c design, section 10), as one pure function of a decision's data: the author's screen, the
 * console's preview and the mail all render it with this, so what the moderator previews is what the author gets. It
 * reads nothing but its input: the rule's words come from the rulebook version the decision was made under and the
 * redress text from its redress version, and which redress text applies follows from the decision's own kind and
 * outcome, never from a later event, so a statement reads as it was sent whenever it is rendered.
 *
 * It carries the six elements of Article 17(3) of the Digital Services Act: what was restricted, where and for how long;
 * the facts, and whether the decision followed a notice or korbat's own finding; whether automated means were used; the
 * legal ground or the rule, with its explanation; and the redress.
 */
export type StatementInput = DecisionStatement;

/** A time as korbat's mails print it: the date and the minute in UTC, since the reader's zone is unknown. */
function utcMinute(at: string | Date): string {
  const iso = (typeof at === "string" ? new Date(at) : at).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

const FIELD_NAMES = { display_name: "display name", bio: "bio" } as const;
type Field = keyof typeof FIELD_NAMES;

/** The field a reset or its lifting is about, or null for any other kind. */
function fieldOf(kind: MeasureKind | ReversalKind): Field | null {
  const target = MEASURES[kind].target;
  return target === "display_name" || target === "bio" ? target : null;
}

/**
 * The statement's fixed words, one place for each: the tests pin them, and the console's composer refers to them. A
 * sentence that names a post names it as "your post of {time}".
 */
export const STATEMENT_WORDS = {
  /** What was done, for each measure but the seal. `post` is the post's time as printed; `deciding` says that it was taken while korbat decides. */
  done: {
    withhold: (post: string) => `korbat hid your post of ${post} from other people while it decides.`,
    remove: (post: string) => `korbat removed your post of ${post}: other people can no longer see it.`,
    withhold_media: (post: string) => `korbat hid one image of your post of ${post} from other people while it decides.`,
    remove_media: (post: string) => `korbat removed one image of your post of ${post}: other people can no longer see it.`,
    reset: (field: Field, deciding: boolean) => `korbat reset your ${FIELD_NAMES[field]}${deciding ? " while it decides" : ""}.`,
  },
  resetOnce: (field: Field) =>
    `korbat wrote this placeholder once. You may set your ${FIELD_NAMES[field]} again; what you set is judged on its own if someone reports it, and korbat does not put the old value back when this measure ends or is lifted.`,
  /** A measure that changed nothing when it was imposed. */
  already: (what: "post" | "image") => `Another decision already keeps this ${what} from being shown, so this changes nothing anyone sees now. It stays in force should that decision be reversed.`,
  alreadyField: "The field already held korbat's placeholder, so this changes nothing now.",
  alreadySealed: "Another decision already keeps these images sealed, so this changes nothing anyone sees now. It stays in force should that decision be reversed.",
  deletedPost: "You had deleted this post, so this changes nothing anyone sees.",
  deletedAccount: "Your account is deleted, so this changes nothing.",
  /** The seal. Nobody at korbat has opened the images, so no sentence says what they show. */
  sealPost: (post: string, images: number) => `korbat sealed the images of your post of ${post} (${images} in all): nobody can see them, you included.`,
  sealAccount: (images: number, posts: number) => `korbat sealed every image it held on your posts at that time (${images} on ${posts} ${posts === 1 ? "post" : "posts"}): nobody can see them, you included.`,
  sealDeleted: (images: number) => `${images} of them ${images === 1 ? "is on a post" : "are on posts"} you had deleted, which korbat had kept under its terms (Your data).`,
  sealForGood: "They are kept only for the authorities korbat reports this to.",
  sealAppeal: "An appeal of a seal waits until the authorities have assessed the images.",
  /** Reversals. */
  lifted: "korbat lifted this restriction. If your post or image is still restricted, another decision listed in Settings, Cases applies, or its content was erased under korbat's retention rules.",
  liftedField: (field: Field) => `korbat lifted the reset of your ${FIELD_NAMES[field]}.`,
  unsealed: "korbat lifted the seal on these images. If an image is still not shown, another decision listed in Settings, Cases applies.",
  /** What a reset's end or lifting leaves: korbat never writes the old value back. */
  field: (field: Field) => `korbat does not put back your ${FIELD_NAMES[field]} as it was before the reset: set it again in Settings, Profile if you wish.`,
  oldValueKept: `The screen of the decision that reset it shows what it was for at least ${RETENTION.resetValueDays} days.`,
  oldValueKeptR4: `The screen of the decision that reset it shows what it was for at least ${RETENTION.resetValueDays} days, unless korbat had already erased it under rule R4.`,
  ended: (measures: string) => `What korbat did while deciding has ended: ${measures}.`,
  /** The lead of a correction and of a review: which decision it is about, by its time, and what became of it. */
  corrected: (decided: string, part: boolean) => `korbat corrected its decision of ${decided} and reversed ${part ? "part of it" : "it"}.`,
  interimLifted: (decided: string) => `korbat lifted what it did while deciding on ${decided}.`,
  reviewed: (decided: string, outcome: "kept" | "partly_reversed" | "reversed") =>
    `korbat reviewed your appeal against its decision of ${decided} and ${outcome === "kept" ? "kept that decision" : outcome === "reversed" ? "reversed that decision" : "reversed part of that decision"}.`,
  noAction: "korbat decided to take no action.",
  /** Where a restriction applies and for how long. korbat cannot restrict by country, and a restriction on the law says so. */
  scope: {
    interim: "This applies everywhere korbat is available, for as long as korbat decides the case.",
    final: "This applies everywhere korbat is available and has no end date.",
    law: "korbat cannot restrict content for one country alone, so this applies everywhere, which is more than the law of a single country asks for.",
  },
  /** The source, as a category only: never a count, a reporter or a report's words. */
  source: {
    notice: "following a notice under Article 16 of the Digital Services Act",
    report: "following a report by another user",
    own_initiative: "found by a moderator",
  },
  automation: "No automated means were used to find this or to decide it.",
  // 3e (design, section 18, W.2): the strike, the overruling of one, and what the software did for a decision that gives one.
  /** A strike: until when it counts, and how many of the account's strikes counted with it when it was decided. */
  strike: (endsAt: string, activeThen: number) =>
    `This decision gives your account a strike. It counts until ${endsAt}. With it your account had ${activeThen} active ${activeThen === 1 ? "strike" : "strikes"} when this was decided. korbat's rules fix when a decision gives a strike; the moderator does not choose it.`,
  /** A strike whose decision's other measures all changed nothing: the content was already not shown, or deleted. */
  strikeAnyway: "The strike counts although the post was already not shown or deleted: what counts is the breach.",
  overruled: "korbat overruled the strike that decision gave. It no longer counts.",
  automationStrike:
    "No automated means were used to find this or to decide that it breaks the rule. That the decision gives a strike follows from korbat's published rule, which its software applies.",
  /**
   * The rule or the law, worded by what korbat knows when it decides. A decision that seals rests on a report that nobody
   * at korbat has checked against the images, since nobody opens them, so it says what the step rests on and never that
   * the rule is broken or the content illegal. A decision taken while deciding says what korbat is checking. Only a final
   * restriction without a seal states a finding. A review or a correction names the ground of the decision it is about.
   */
  ground: {
    sealRule: (id: string, title: string, text: string) => `This step rests on korbat rule ${id}, "${title}": ${text}`,
    sealLaw: (reference: string) => `This step rests on the law: ${reference}`,
    checkingRule: (id: string, title: string, text: string) => `korbat is checking this against korbat rule ${id}, "${title}": ${text}`,
    checkingLaw: (reference: string) => `korbat is checking whether this is illegal. The law in question: ${reference}`,
    breaks: (id: string, title: string, text: string) => `It breaks korbat rule ${id}, "${title}": ${text}`,
    illegal: (reference: string) => `korbat found it illegal. The law it rests on: ${reference}`,
    restedOnRule: (id: string, title: string, text: string) => `That decision rested on korbat rule ${id}, "${title}": ${text}`,
    restedOnLaw: (reference: string) => `That decision rested on the law: ${reference}`,
    referenceErased: "its reference was erased under korbat's retention rules.",
  },
} as const;

const W = STATEMENT_WORDS;

/** The sentence that names the source: a notice or a report was followed, a moderator's finding was found. */
const sourceSentence = (source: StatementInput["source"]): string => (source === "own_initiative" ? `What this decision is about was ${W.source.own_initiative}.` : `korbat decided this ${W.source[source]}.`);

/** What a reset's end or lifting says of the field: korbat does not put the old value back, and where it can still be read. */
function fieldSentence(field: Field, reset: { oldValueKept: boolean; resetRuleId: string | null }): string {
  const parts: string[] = [W.field(field)];
  if (reset.oldValueKept) parts.push(reset.resetRuleId === "R4" ? W.oldValueKeptR4 : W.oldValueKept);
  return parts.join(" ");
}

/** The kinds of 3e whose sentences this version of the package does not hold yet: none is rendered as another one. */
const UNWORDED: readonly (MeasureKind | ReversalKind)[] = ["suspend", "terminate", "retire_handle", "warn_reporting", "restrict_reporting", "lift_suspension", "unretire_handle", "lift_reporting"];

/**
 * A strike, as a paragraph: that the decision gives one, until when it counts and how many counted with it; that it
 * counts although the post was already not shown or deleted, when every other measure of the decision changed nothing;
 * then the prior warning of what strikes lead to, from the decision's own redress version.
 */
function strikeParagraph(input: StatementInput, measure: StatementInput["measures"][number], redress: RedressTexts): string {
  if (measure.endsAt === undefined || measure.endsAt === null || measure.activeThen === undefined || measure.activeThen === null) {
    throw new Error("a statement's strike names its end of counting and the strikes active then: the decision's data holds neither");
  }
  const parts: string[] = [W.strike(utcMinute(measure.endsAt), measure.activeThen)];
  const others = input.measures.filter((other) => other.kind !== "strike");
  if (others.length > 0 && others.every((other) => other.noEffect !== null)) parts.push(W.strikeAnyway);
  // Redress version 1 has no prior warning, and no decision under it holds a strike.
  if (redress.strikeNext !== undefined) parts.push(redress.strikeNext);
  return parts.join(" ");
}

/** One measure, as a paragraph: what was done, then that it changed nothing when it did not. */
function measureParagraph(input: StatementInput, measure: StatementInput["measures"][number], redress: RedressTexts): string {
  const post = input.post === null ? null : utcMinute(input.post.createdAt);
  const deciding = input.kind === "interim";
  if (UNWORDED.includes(measure.kind)) throw new Error(`a statement's ${measure.kind} is not worded in this version of @korbat/rules`);
  if (measure.kind === "strike") return strikeParagraph(input, measure, redress);
  const field = fieldOf(measure.kind);
  if (measure.kind === "seal_media") {
    const sealed = measure.sealed ?? { posts: 0, images: 0, deletedImages: 0 };
    const parts: string[] = [post === null ? W.sealAccount(sealed.images, sealed.posts) : W.sealPost(post, sealed.images)];
    if (post === null && sealed.deletedImages > 0) parts.push(W.sealDeleted(sealed.deletedImages));
    if (input.kind === "final") parts.push(W.sealForGood);
    if (measure.noEffect === "already") parts.push(W.alreadySealed);
    if (measure.noEffect === "deleted") parts.push(post === null ? W.deletedAccount : W.deletedPost);
    return parts.join(" ");
  }
  if (field !== null) {
    const parts: string[] = [W.done.reset(field, deciding)];
    // A reset that changed something wrote the placeholder; one that changed nothing wrote nothing, and says so.
    if (measure.noEffect === null) parts.push(W.resetOnce(field));
    if (measure.noEffect === "already") parts.push(W.alreadyField);
    if (measure.noEffect === "deleted") parts.push(W.deletedAccount);
    return parts.join(" ");
  }
  if (post === null) throw new Error(`a statement's ${measure.kind} names its post: the decision's data holds none`);
  const done = measure.kind === "withhold" ? W.done.withhold(post) : measure.kind === "remove" ? W.done.remove(post) : measure.kind === "withhold_media" ? W.done.withhold_media(post) : W.done.remove_media(post);
  const parts: string[] = [done];
  if (measure.noEffect === "already") parts.push(W.already(MEASURES[measure.kind].target === "image" ? "image" : "post"));
  if (measure.noEffect === "deleted") parts.push(W.deletedPost);
  return parts.join(" ");
}

/** One reversal, as a paragraph. A lifted restriction of a post or an image names the post. */
function reversalParagraph(input: StatementInput, reversal: StatementInput["reversals"][number]): string {
  if (UNWORDED.includes(reversal.kind)) throw new Error(`a statement's ${reversal.kind} is not worded in this version of @korbat/rules`);
  if (reversal.kind === "overrule") return W.overruled;
  const field = fieldOf(reversal.kind);
  if (field !== null) return `${W.liftedField(field)} ${fieldSentence(field, reversal)}`;
  if (reversal.kind === "unseal_media") return W.unsealed;
  if (input.post === null) throw new Error(`a statement's ${reversal.kind} names its post: the decision's data holds none`);
  const post = utcMinute(input.post.createdAt);
  return `${reversal.kind === "restore_media" ? `One image of your post of ${post}` : `Your post of ${post}`}: ${W.lifted}`;
}

/** The measures taken while deciding that ended with the decision, and what becomes of each reset field the decision does not reset itself. */
function endedParagraph(input: StatementInput): string {
  const parts: string[] = [W.ended(input.endedMeasures.map((ended) => MEASURES[ended.kind].label).join(", "))];
  for (const ended of input.endedMeasures) {
    const field = fieldOf(ended.kind);
    if (field !== null && !input.measures.some((measure) => fieldOf(measure.kind) === field)) parts.push(fieldSentence(field, ended));
  }
  return parts.join(" ");
}

/**
 * How a ground is worded (STATEMENT_WORDS.ground): for the decision a review or a correction is about; for a decision
 * that seals; for one taken while deciding; or for a final restriction without a seal, the only one that states a finding.
 */
type GroundForm = "about" | "seal" | "deciding" | "found";

/** The rule or the law a decision rests on, in the form that fits what the decision is. */
function groundParagraph(ground: { ground: StatementInput["ground"]; ruleId: string | null; legalReference: string | null }, rulesVersion: number, form: GroundForm): string | null {
  const G = W.ground;
  if (ground.ground === "illegal") {
    const reference = ground.legalReference ?? G.referenceErased;
    return form === "about" ? G.restedOnLaw(reference) : form === "seal" ? G.sealLaw(reference) : form === "deciding" ? G.checkingLaw(reference) : G.illegal(reference);
  }
  if (ground.ground === "incompatible" && ground.ruleId !== null) {
    const rule = getRule(ground.ruleId, rulesVersion);
    // A decision records the version it was made under, and every version is kept: one that is missing is never rendered as another.
    if (!rule) throw new Error(`a statement cites ${ground.ruleId} of rulebook version ${rulesVersion}, which this package does not hold`);
    const words = form === "about" ? G.restedOnRule : form === "seal" ? G.sealRule : form === "deciding" ? G.checkingRule : G.breaks;
    return words(rule.id, rule.title, rule.text);
  }
  return null;
}

/**
 * The statement of reasons as paragraphs, in this order: what was done (one paragraph for each measure and each reversal,
 * then what ended); where it applies and for how long; how it came to korbat; that nothing was automated; the rule or the
 * law; the facts and the reason; and what the author can do about it.
 */
export function statementParagraphs(input: StatementInput): string[] {
  const redress = getRedress(input.redressVersion);
  if (!redress) throw new Error(`a statement names the redress texts of version ${input.redressVersion}, which this package does not hold`);
  const paragraphs: string[] = [];
  const about = input.kind === "review" || input.kind === "correction";
  const restricts = input.measures.length > 0;

  // What was done.
  if (about) {
    if (input.reviewed === null) throw new Error("the statement of a review or a correction names the decision it is about: the decision's data holds none");
    const decided = utcMinute(input.reviewed.decidedAt);
    if (input.kind === "review") paragraphs.push(W.reviewed(decided, input.outcome === "kept" ? "kept" : input.outcome === "partly_reversed" ? "partly_reversed" : "reversed"));
    else paragraphs.push(input.reviewed.kind === "interim" ? W.interimLifted(decided) : W.corrected(decided, input.outcome === "partly_reversed"));
  }
  for (const measure of input.measures) paragraphs.push(measureParagraph(input, measure, redress));
  for (const reversal of input.reversals) paragraphs.push(reversalParagraph(input, reversal));
  if (input.endedMeasures.length > 0) paragraphs.push(endedParagraph(input));
  if (paragraphs.length === 0) paragraphs.push(W.noAction);

  // Where and how long: only a decision that restricts has a scope.
  if (restricts) {
    paragraphs.push(input.kind === "interim" ? W.scope.interim : W.scope.final);
    if (input.ground === "illegal") paragraphs.push(W.scope.law);
  }

  // How it came to korbat, for a decision of its own; a review or a correction is korbat's own second look.
  if (!about) paragraphs.push(sourceSentence(input.source));
  // A decision that gives a strike says what the software did: it applied korbat's published rule of when one is given.
  paragraphs.push(input.measures.some((measure) => measure.kind === "strike") ? W.automationStrike : W.automation);

  // The rule or the law: the decision's own, or for a review or a correction the reviewed decision's, from that decision's
  // row and in the wording of the rulebook that decision was made under.
  const form: GroundForm = about ? "about" : input.measures.some((measure) => measure.kind === "seal_media") ? "seal" : input.kind === "interim" ? "deciding" : "found";
  const ground = about ? groundParagraph(input.reviewed!, input.reviewed!.rulesVersion, form) : groundParagraph(input, input.rulesVersion, form);
  if (ground !== null) paragraphs.push(ground);

  // The facts and the reason, while korbat keeps them.
  if (input.facts !== null) paragraphs.push(`The facts: ${input.facts}`);
  if (input.reason !== null) paragraphs.push(about ? `Why korbat ${input.outcome === "kept" ? "kept" : "changed"} it: ${input.reason}` : `korbat's reasons: ${input.reason}`);

  // Redress, from the decision's own kind and outcome.
  if (input.kind === "interim") paragraphs.push(redress.interim);
  else if (input.kind === "final" && input.outcome === "restricted") {
    const appeal = redress.appeal.replace("{deadline}", () => utcMinute(appealDeadline(new Date(input.decidedAt))));
    paragraphs.push(input.measures.some((measure) => measure.kind === "seal_media") ? `${appeal} ${W.sealAppeal}` : appeal);
  } else paragraphs.push(redress.notAppealable);
  return paragraphs;
}
