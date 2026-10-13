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
    // 3e: in place of `final` for a decision that suspends the account.
    suspend: (days: number) => `This applies everywhere korbat is available, for ${days} ${days === 1 ? "day" : "days"} from its start.`,
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
  // 3e (design, section 18, W.2): the retirement of a handle and its reversal.
  /** The first sentence of a retirement: which handle, and that nobody can use it again. */
  retireLead: (handle: string) => `korbat retired the handle @${handle}: nobody can use it again, you included.`,
  /**
   * A retirement that changed the profile: the handle, the placeholder, and when a new handle can be chosen without the
   * usual wait, by the decision's own measures (retireEnd): at once; when a suspension the same decision takes at once
   * ends; or not at all, after a termination taken at once, where the sentence ends after "instead".
   */
  retire: (handle: string, placeholder: string, end: RetireEnd) =>
    `korbat retired the handle @${handle}: nobody can use it again, you included. If your profile still held it, it now shows @${placeholder} instead${
      end === "none" ? "." : `, and you can choose a new handle in Settings, Profile, without the usual wait: ${end === "at_once" ? "at once" : "when that suspension ends"}.`
    }`,
  /** A retirement whose handle was already retired. */
  retireAlready: "That handle was already retired, so this changes nothing now.",
  /** The reversal of a retirement. */
  unretired: (handle: string) =>
    `korbat lifted the retirement of the handle @${handle}. If your profile still held the placeholder, it has the handle again. If you chose another handle since, you can change back to @${handle} at once in Settings, Profile. Nobody else could take it meanwhile.`,
  // 3e (design, section 18, W.2, Task 3): a suspension taken at once, the ground it was taken at once on, what any
  // suspension stops and leaves, its effect on Explore, what the software did for a flood, the lift of a suspension in the
  // three states of its period, and the end of a suspension whose basis a reversal broke.
  /** A suspension taken at once: its days and its end, the decision's time plus its days. */
  suspendAtOnce: (days: number, endsAt: string) => `korbat suspended your account for ${days} ${days === 1 ? "day" : "days"}, from this decision until ${endsAt}, without notice beforehand.`,
  /** Why it was taken at once, by its basis; `at` is the time of the decision it rests on, or of the seal's decision. */
  basis: {
    threat: (at: string) => `It was taken at once because korbat's decision of ${at} found a direct threat of violence in a post of yours (rule R5). It ends at once if that decision is reversed.`,
    terrorist: (at: string) => `It was taken at once because korbat's decision of ${at} found terrorist content in a post of yours. It ends at once if that decision is reversed.`,
    flood: "It was taken at once because an admin found that your account was flooding korbat with repetitive, unsolicited posts (rule R6). The facts below say how many posts and what they were.",
    protective: (sealedAt: string) =>
      `It was taken at once because korbat's decision of ${sealedAt} keeps images of your account sealed, after they were reported as possible child sexual abuse material. korbat's staff do not open images reported this way, so korbat has not assessed them. This is not a finding that you broke the law or a korbat rule: it is a protective measure, it gives no strike, and it ends on its date by itself, or earlier if that seal is lifted.`,
  },
  stops: "While it runs you cannot post, reply, quote, like, repost, bookmark, follow, edit your profile, change your handle, upload images, ask for the verified badge, or report under korbat's rules.",
  stays:
    "You can still sign in and read; see your cases and reply to korbat; appeal; ask for a re-examination of a report you sent; export your data; delete your posts or your account; undo likes, reposts, bookmarks and follows; block and mute; and report illegal content. Your profile and posts stay visible to others, without any mark, and others can still follow you and like, repost, reply to and quote your posts.",
  explore:
    "While it runs your posts do not appear in Explore, and your likes and reposts of other people's posts do not count there. Both count again from the first refresh after it ends; a post whose time in Explore has passed by then does not return.",
  automationFlood: "korbat's software counted the posts this rests on. An admin read them and decided; no automated means decided it.",
  /** The lift of a suspension (or a termination), by where its period stood at the lifting decision's time. */
  liftedBefore: (what: "suspension" | "termination", decidedAt: string) => `korbat lifted the ${what} it announced on ${decidedAt}: it never starts.`,
  liftedRunning: (what: "suspension" | "termination") => `korbat lifted the ${what} of your account: it ended with this decision.`,
  liftedEnded: (startedAt: string, endedAt: string) => `korbat lifted the suspension of your account that ran from ${startedAt} to ${endedAt}: it no longer counts toward a later suspension.`,
  /** A suspension (or a termination) whose basis this decision broke: the decision or the seal it rested on, then where its period stood. */
  basisEnded: (what: "suspension" | "termination", decidedAt: string, seal: boolean) => `The ${what} of your account that korbat decided on ${decidedAt} rested on ${seal ? "that seal" : "that decision"}.`,
  basisEndedThen: {
    not_started: "It will not start.",
    running: "It ended with this one.",
    ended: (startedAt: string, endedAt: string) => `It had run from ${startedAt} to ${endedAt}; it no longer counts toward a later suspension.`,
  },
  /** After basisEnded, when the measure had a reply that nobody had answered: this decision answers it. */
  basisEndedReply: (filedAt: string) => `Your reply of ${filedAt} to it needs no answer now.`,
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
    // 3e (W.2, "The rule or the term"): a protective suspension rests on the terms' clause, never on a finding under R2; a
    // measure taken at once on a threat or a flood names the account's conduct. The 14 days are a literal of these words,
    // held to STANDING_RULES.protectiveDays by the rules package's table test.
    protective: (title: string) =>
      `This rests on korbat's terms, section Suspension and termination: when korbat keeps images of an account sealed after a report of child sexual abuse material, an admin may suspend the account once, for up to 14 days. The rule such a report is made under is korbat rule R2, "${title}". korbat has not found that your account broke it.`,
    conduct: (id: string, title: string, text: string) => `Your account's conduct breaks korbat rule ${id}, "${title}": ${text}`,
  },
} as const;

const W = STATEMENT_WORDS;

/**
 * When the holder of a retired handle may choose a new one without the usual wait (3e design, W.2), read from the
 * decision's own measures so that the sentence reads as it was sent: at once; after a suspension the same decision
 * takes at once (a suspended account changes no handle); never after a termination taken at once. An announced
 * suspension or termination has not started when the decision is sent, so the handle can be chosen at once.
 */
export type RetireEnd = "at_once" | "after_suspension" | "none";
export function retireEnd(measures: readonly StatementInput["measures"][number][]): RetireEnd {
  if (measures.some((measure) => measure.kind === "terminate" && measure.announced === false)) return "none";
  if (measures.some((measure) => measure.kind === "suspend" && measure.announced === false)) return "after_suspension";
  return "at_once";
}

/** The sentence that names the source: a notice or a report was followed, a moderator's finding was found. */
const sourceSentence = (source: StatementInput["source"]): string => (source === "own_initiative" ? `What this decision is about was ${W.source.own_initiative}.` : `korbat decided this ${W.source[source]}.`);

/** What a reset's end or lifting says of the field: korbat does not put the old value back, and where it can still be read. */
function fieldSentence(field: Field, reset: { oldValueKept: boolean; resetRuleId: string | null }): string {
  const parts: string[] = [W.field(field)];
  if (reset.oldValueKept) parts.push(reset.resetRuleId === "R4" ? W.oldValueKeptR4 : W.oldValueKept);
  return parts.join(" ");
}

/**
 * The kinds of 3e whose sentences this version of the package does not hold yet: none is rendered as another one. Task 3
 * words a suspension taken at once and the lift of a suspension; an announced suspension is refused where it is rendered.
 */
const UNWORDED: readonly (MeasureKind | ReversalKind)[] = ["terminate", "warn_reporting", "restrict_reporting", "lift_reporting"];

/** What a sentence calls a standing measure. */
const standingWord = (kind: "suspend" | "terminate"): "suspension" | "termination" => (kind === "terminate" ? "termination" : "suspension");

/** A decision's standing measure (a suspension or a termination), if it holds one: a decision holds at most one. */
const standingOf = (input: StatementInput) => input.measures.find((measure) => measure.kind === "suspend" || measure.kind === "terminate");

/**
 * A suspension taken at once, as three paragraphs (3e design, W.2): what was done, until when, and why at once (with the
 * decision or the seal it rests on, read from the ledger's row), and that it changes nothing for a deleted account; what
 * it stops and what it leaves; and what it does to Explore. An announced suspension is not worded in this version.
 */
function suspendParagraphs(measure: StatementInput["measures"][number]): string[] {
  if (measure.announced !== false) throw new Error("a statement's suspend is not worded in this version of @korbat/rules unless it is taken at once");
  const { days, endsAt, basis, restsOn } = measure;
  if (days === undefined || days === null || endsAt === undefined || endsAt === null || basis === undefined || basis === null) {
    throw new Error("a statement's suspend names its days, its end and its basis: the decision's data holds none");
  }
  const rested = restsOn?.[0]?.decidedAt;
  let why: string;
  if (basis === "flood") why = W.basis.flood;
  else if ((basis === "threat" || basis === "terrorist" || basis === "protective") && rested !== undefined) why = W.basis[basis](utcMinute(rested));
  else throw new Error(`a statement's suspend at once on the basis ${basis} names the decision it rests on: the decision's data holds none`);
  const lead = [W.suspendAtOnce(days, utcMinute(endsAt)), why];
  if (measure.noEffect === "deleted") lead.push(W.deletedAccount);
  return [lead.join(" "), `${W.stops} ${W.stays}`, W.explore];
}

/** The lift of a suspension, by where its period stood at this decision's time; a withdrawal signed `replaced` is not worded in this version. */
function liftParagraph(reversal: StatementInput["reversals"][number]): string {
  const { liftedKind, periodThen } = reversal;
  if (liftedKind === undefined || liftedKind === null || periodThen === undefined || periodThen === null) {
    throw new Error("a statement's lift_suspension names the measure it lifts and its period then: the decision's data holds neither");
  }
  if (reversal.replaced === true) throw new Error("a statement's lift_suspension signed replaced is not worded in this version of @korbat/rules");
  const what = standingWord(liftedKind);
  if (periodThen.state === "not_started") {
    if (reversal.liftedDecidedAt === undefined || reversal.liftedDecidedAt === null) throw new Error("a statement's lift_suspension before the start names the lifted decision's time: the decision's data holds none");
    return W.liftedBefore(what, utcMinute(reversal.liftedDecidedAt));
  }
  if (periodThen.state === "running") return W.liftedRunning(what);
  // A termination has no end, so it has no form for one that had already ended.
  if (liftedKind === "terminate" || periodThen.startedAt === null || periodThen.endedAt === null) throw new Error("a statement's lift_suspension of a period that ended names its start and its end");
  return W.liftedEnded(utcMinute(periodThen.startedAt), utcMinute(periodThen.endedAt));
}

/** A standing measure whose basis this decision broke: what it rested on, where its period stood, and a reply that waited. */
function basisEndedParagraph(entry: NonNullable<StatementInput["endedStanding"]>[number]): string {
  if (entry.kind === "restrict_reporting") throw new Error("a statement's restriction of reporting ended with its warning is not worded in this version of @korbat/rules");
  const { periodThen } = entry;
  let then: string;
  if (periodThen.state === "ended") {
    if (periodThen.startedAt === null || periodThen.endedAt === null) throw new Error("a statement's ended period names its start and its end");
    then = W.basisEndedThen.ended(utcMinute(periodThen.startedAt), utcMinute(periodThen.endedAt));
  } else then = W.basisEndedThen[periodThen.state];
  const parts = [W.basisEnded(standingWord(entry.kind), utcMinute(entry.decidedAt), entry.seal), then];
  if (entry.replyFiledAt !== null) parts.push(W.basisEndedReply(utcMinute(entry.replyFiledAt)));
  return parts.join(" ");
}

/**
 * A retirement, as a paragraph. One that changed the profile names the handle, its placeholder and when a new handle can be
 * chosen; one that changed nothing names the handle and why, and no placeholder, since none was written.
 */
function retireParagraph(input: StatementInput, measure: StatementInput["measures"][number]): string {
  const { handle, placeholder } = measure;
  if (handle === undefined || handle === null) throw new Error("a statement's retire_handle names the handle it retired: the decision's data holds none");
  if (measure.noEffect === "already") return `${W.retireLead(handle)} ${W.retireAlready}`;
  if (measure.noEffect === "deleted") return `${W.retireLead(handle)} ${W.deletedAccount}`;
  if (placeholder === undefined || placeholder === null) throw new Error("a statement's retire_handle names the placeholder it gave: the decision's data holds none");
  return W.retire(handle, placeholder, retireEnd(input.measures));
}

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
  if (measure.kind === "retire_handle") return retireParagraph(input, measure);
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
  if (reversal.kind === "lift_suspension") return liftParagraph(reversal);
  if (reversal.kind === "unretire_handle") {
    if (reversal.handle === undefined || reversal.handle === null) throw new Error("a statement's unretire_handle names the handle it gives back: the decision's data holds none");
    return W.unretired(reversal.handle);
  }
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
type GroundForm = "about" | "seal" | "deciding" | "found" | "conduct";

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
    const words = form === "about" ? G.restedOnRule : form === "seal" ? G.sealRule : form === "deciding" ? G.checkingRule : form === "conduct" ? G.conduct : G.breaks;
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
  for (const measure of input.measures) {
    // 3e: a suspension is three paragraphs of its own (what and why, what it stops and leaves, Explore).
    if (measure.kind === "suspend") paragraphs.push(...suspendParagraphs(measure));
    else paragraphs.push(measureParagraph(input, measure, redress));
  }
  for (const reversal of input.reversals) paragraphs.push(reversalParagraph(input, reversal));
  if (input.endedMeasures.length > 0) paragraphs.push(endedParagraph(input));
  // 3e: the standing measures whose basis a reversal of this decision broke.
  for (const entry of input.endedStanding ?? []) paragraphs.push(basisEndedParagraph(entry));
  if (paragraphs.length === 0) paragraphs.push(W.noAction);

  const standing = standingOf(input);
  // Where and how long: only a decision that restricts has a scope; a suspension's is its days from its start.
  if (restricts) {
    paragraphs.push(input.kind === "interim" ? W.scope.interim : standing?.kind === "suspend" && typeof standing.days === "number" ? W.scope.suspend(standing.days) : W.scope.final);
    if (input.ground === "illegal") paragraphs.push(W.scope.law);
  }

  // How it came to korbat, for a decision of its own; a review or a correction is korbat's own second look.
  if (!about) paragraphs.push(sourceSentence(input.source));
  // A decision that gives a strike says what the software did: it applied korbat's published rule of when one is given.
  // A suspension on a flood rests on a count the software made; one on a decision, a threat or a seal rests on nothing
  // the software did, and keeps 3c's sentence.
  paragraphs.push(input.measures.some((measure) => measure.kind === "strike") ? W.automationStrike : standing?.basis === "flood" ? W.automationFlood : W.automation);

  // The rule or the law: the decision's own, or for a review or a correction the reviewed decision's, from that decision's
  // row and in the wording of the rulebook that decision was made under. A decision that holds a standing measure names
  // the ground it truly rests on (3e, W.2): the terms' clause for a protective suspension, which never says that a rule is
  // broken, and the account's conduct for one taken at once on a threat or a flood (the law, as ever, on terrorist content).
  if (!about && standing?.basis === "protective") {
    const r2 = getRule("R2", input.rulesVersion);
    if (!r2) throw new Error(`a statement cites R2 of rulebook version ${input.rulesVersion}, which this package does not hold`);
    paragraphs.push(W.ground.protective(r2.title));
  } else {
    const form: GroundForm = about ? "about" : input.measures.some((measure) => measure.kind === "seal_media") ? "seal" : input.kind === "interim" ? "deciding" : standing ? "conduct" : "found";
    const ground = about ? groundParagraph(input.reviewed!, input.reviewed!.rulesVersion, form) : groundParagraph(input, input.rulesVersion, form);
    if (ground !== null) paragraphs.push(ground);
  }

  // The facts and the reason, while korbat keeps them.
  if (input.facts !== null) paragraphs.push(`The facts: ${input.facts}`);
  if (input.reason !== null) paragraphs.push(about ? `Why korbat ${input.outcome === "kept" ? "kept" : "changed"} it: ${input.reason}` : `korbat's reasons: ${input.reason}`);

  // Redress, from the decision's own kind and outcome.
  if (input.kind === "interim") paragraphs.push(redress.interim);
  else if (input.kind === "final" && input.outcome === "restricted") {
    // 3e (W.3): a measure taken at once can be replied to at any time while it runs; the reply comes before the appeal.
    if (standing !== undefined && standing.announced === false) {
      if (redress.replyAtOnce === undefined) throw new Error(`a statement's measure taken at once needs the reply's text, which redress version ${input.redressVersion} does not hold`);
      paragraphs.push(redress.replyAtOnce);
    }
    const appeal = redress.appeal.replace("{deadline}", () => utcMinute(appealDeadline(new Date(input.decidedAt))));
    paragraphs.push(input.measures.some((measure) => measure.kind === "seal_media") ? `${appeal} ${W.sealAppeal}` : appeal);
  } else paragraphs.push(redress.notAppealable);
  return paragraphs;
}
