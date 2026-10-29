import {
  ACCOUNT_MEASURE_SCOPE,
  APPEAL_MONTHS,
  IMPORT_RULES,
  AUTOMATION_RULES,
  CSAM_NOTICE_MAX_ACCOUNTS,
  DAILY_LIMITS,
  ITEM_OUTCOMES,
  MEASURES,
  MEASURE_KINDS,
  NOTICE_LIMITS,
  ORDER_RULES,
  OUTCOME_PHRASES,
  RECIPIENT_RULES,
  REPLY_AIM_HOURS,
  RETENTION,
  RETIRED_HANDLE_PREFIX,
  REVERSAL_KINDS,
  STANDING_RULES,
  STATE_FACTS,
  SUSPECT_EARLIER_MONTHS,
  SUSPECT_OUTCOME_PHRASES,
  UNSEEN_NO_ACTION,
  type ItemOutcome,
  type MeasureKind,
  type StateFacts,
} from "@korbat/contracts";
import { RULES, RULES_VERSION } from "@korbat/rules";
import { numberWord } from "./moderation-words";

/**
 * The terms shown at sign-up. TERMS_VERSION must equal the API's TERMS_VERSION setting; change both
 * together whenever the text changes, so every account records which version it accepted.
 */
export const TERMS_VERSION = "draft-2026-09";

/** The terms page's own words around its sections (UI Task 7), word for word as app/terms.tsx had them in its markup. */
export const TERMS_PAGE = {
  title: "korbat terms",
  version: (version: string) => `Version ${version}`,
  back: "Back to korbat",
} as const;

/**
 * The moderation sections (3c design, section 9) state each rule of the mechanism once more, for the people it is
 * applied to. So that the text cannot drift from the mechanism, nothing it shares with the mechanism is typed here: every
 * limit and period is printed from the contracts' constants, the rules from the rulebook, the measures from the ledger's
 * own table and an answer's phrases from the table the mails and the screens read. A test changes those constants and
 * finds the terms changed with them (test/terms.test.tsx). 3e's sections (design, W.7) print every number of account
 * sanctions from STANDING_RULES, the days after which a mail is given up from RETENTION.mailGiveUpDays and the hours
 * korbat aims to answer a reply in from REPLY_AIM_HOURS, which the code that acts on each reads.
 */

/** A section's paragraphs are kept in one text, a blank line between two. */
const PARAGRAPH_BREAK = String.fromCharCode(10, 10);
const paragraphs = (...parts: string[]): string => parts.join(PARAGRAPH_BREAK);

/** A section's body as its paragraphs, for the page to set apart. */
export function termsParagraphs(body: string): string[] {
  return body.split(PARAGRAPH_BREAK);
}

/** A count as the terms print it: a small number as a word, and its noun in the singular or the plural. */
const count = (n: number, one: string): string => `${numberWord(n)} ${n === 1 ? one : `${one}s`}`;

/** A share as the terms print it: half as a word, any other share as a percentage, so the sentence follows the constant. */
const share = (fraction: number): string => (fraction === 0.5 ? "half" : `${fraction * 100} percent`);

/** A list inside a sentence: "a", "a or b", "a, b or c". */
const orList = (items: readonly string[]): string => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`);

/** A rule's name inside a sentence: its title in the rulebook without the leading "No". */
const ruleName = (rule: { title: string }): string => rule.title.replace(/^No /, "");

/** The rules whose final decisions only an admin takes, as the rulebook marks them. */
const ADMIN_RULES = orList(RULES.filter((rule) => rule.seniorQueue).map((rule) => rule.id));

/** The rule on doxxing, whose restricted content is erased once the restriction is final, as a sentence names it. */
const R4 = (() => {
  const rule = RULES.find((candidate) => candidate.id === "R4");
  if (!rule) throw new Error("the rulebook holds no rule R4");
  return `rule ${rule.id} (${ruleName(rule)})`;
})();

/** The rule on spam and manipulation, under which a false import statement can lead to removal (3b, 11.3), as a sentence names it. */
const R6 = (() => {
  const rule = RULES.find((candidate) => candidate.id === "R6");
  if (!rule) throw new Error("the rulebook holds no rule R6");
  return `rule ${rule.id} (${ruleName(rule)})`;
})();

/**
 * 3b (design, section 11.3): the one licence korbat takes in what is posted, native or imported, which "What you can
 * post" grants and "Importing posts" points to. The terms held no licence sentence for native posts before 3b.
 */
const LICENCE = "korbat may store, show and send what you post as the service needs, until you delete it, except what the rules' records keep";

/**
 * 3b (design, sections 11.3 and decision 28): "Importing posts", joining the draft without a new TERMS_VERSION, as the
 * earlier sub-projects' sentences did; its hours and days are IMPORT_RULES', the same numbers the API and the database hold.
 */
const IMPORTING_POSTS = paragraphs(
  "You can bring your own posts from X or Mastodon, and from Bluesky where korbat has turned it on, by uploading the archive you downloaded from that platform yourself; korbat never asks for your password there and never fetches anything from it. korbat opens only the files of your archive that hold your posts and their images, and of those it keeps only your own public posts: it never opens your messages, contacts, followers, likes and the rest, and posts for followers only or direct messages that share a file with public ones are skipped by who they were addressed to, and never kept or logged.",
  `The whole archive passes through korbat's server and its network provider on its way in. korbat deletes it as soon as it has been read, and within ${IMPORT_RULES.archiveHours} hours of the start at the latest; what was read from it is deleted when the import is published, stopped or cancelled, and within ${numberWord(IMPORT_RULES.workHours / 24)} days at the latest.`,
  "Imported posts are korbat posts. They follow korbat's rules like any post and show on your profile's Imported tab, each with a label that names where it came from and the day the archive gives it, and they are in no feed on their own and never in Explore; anyone can still repost or quote them, and anyone who searches their words may find the originals and the account that wrote them.",
  "On each imported post korbat keeps only the source, the day the archive gives it and a keyed hash that tells it a post you already imported, never the other account: no handle, name, address or link of it.",
  `Before anything is published you state that they are your own and that they were public where you posted them; korbat does not check who wrote an archive. A false statement can lead to the posts' removal under ${R6} and count against your account. Other people named or pictured in an imported post can ask for its removal, as anyone named in a post can.`,
  "You grant korbat for imported posts and images the same licence as for any post (What you can post), and you must be able to grant it: old posts often hold other people's photos and screenshots.",
  "Imported images pass the same checks as uploads, and korbat imports images only while it can check them. One action, Remove imported posts, removes every post of an import again.",
);

/**
 * What each measure does, beside its label. A measure added to the ledger does not compile until it is explained here.
 * 3e's six (design, W.1) point to the section that says the rest; W.7 has no words for them, so these are written here.
 */
const MEASURE_MEANINGS: Record<MeasureKind, string> = {
  withhold: "the post is hidden from other people; you still see it",
  remove: "the post is removed for other people; it stays in your own view while you keep it",
  seal_media: "the images the case covers are shown to nobody, you included",
  withhold_media: "one image of a post is hidden from other people; you still see it",
  remove_media: "one image of a post is removed for other people; it stays in your own view",
  reset_display_name: "the display name is replaced by the account's handle",
  reset_bio: "the bio is emptied",
  // 2d Task 4 (design, section 7.7): the monogram in its place, as the app draws an account without a picture.
  reset_avatar: "the profile picture is removed, and the first letter of the display name is shown in its place",
  strike: "a mark on the account that restricts nothing by itself and counts toward a suspension, as Strikes says",
  suspend: "for a number of days the account can no longer post, engage, follow, edit its profile or report under the rules, as Suspension and termination says",
  terminate: "the account is suspended until the decision is final, and then deleted, as Suspension and termination says",
  retire_handle: "the handle can be used by nobody again, and the profile shows a placeholder in its place, as Handles says",
  warn_reporting: "a warning about reports that are manifestly unfounded, which restricts nothing, as Reporting in bad faith says",
  restrict_reporting: "for a number of days korbat takes no report under its rules from the account, as Reporting in bad faith says",
  // 3f: no decision of korbat's takes it; only an authority's order does, which the terms' sections on orders describe.
  // 3f's review (people5): a DSA order that does not ask that the post be kept from its author leaves it to them.
  disable_by_order: "the post and its images are shown to nobody, or to nobody but you when the order does not ask that they be kept from you, because an authority ordered it",
};

/** The measures of one sentence, each by the label its decision records and what it does. */
const measureList = (kinds: readonly MeasureKind[]): string => kinds.map((kind) => `"${MEASURES[kind].label}" (${MEASURE_MEANINGS[kind]})`).join("; ");
// The ledger's own two marks sort the measures into the three sentences; every kind of the ledger is listed.
const WHILE_DECIDING = MEASURE_KINDS.filter((kind) => MEASURES[kind].interim && !MEASURES[kind].final);
const WHEN_DECIDED = MEASURE_KINDS.filter((kind) => !MEASURES[kind].interim && MEASURES[kind].final);
const EITHER = MEASURE_KINDS.filter((kind) => MEASURES[kind].interim && MEASURES[kind].final);
// 3f: the measure no decision of korbat's own takes, which an authority's order alone does.
const BY_ORDER = MEASURE_KINDS.filter((kind) => !MEASURES[kind].interim && !MEASURES[kind].final);
const LIFTED = REVERSAL_KINDS.map((kind) => `"${MEASURES[kind].label}"`).join("; ");

/**
 * Every measure of the ledger with its label and what it does, sorted by when korbat may take it. 3d Task 4 (design,
 * section 9.2): the rules page prints the same paragraph under "What korbat can do, and when", so it is exported.
 */
export const MEASURES_PARAGRAPH = `korbat's measures are these, and no others; each is named as a decision records it. While korbat decides a case: ${measureList(WHILE_DECIDING)}. When the case is decided: ${measureList(WHEN_DECIDED)}. While it decides or when the case is decided: ${measureList(EITHER)}. On an authority's order alone, never on korbat's own judgement: ${measureList(BY_ORDER)}. A later decision can lift each of them again: ${LIFTED}.`;

/** What each outcome of a report means. An outcome added to the contracts does not compile until it is explained here. */
const OUTCOME_MEANINGS: Record<ItemOutcome, string> = {
  restricted_rule: "a moderator found that the item breaks the rule the answer names, and korbat restricted it.",
  restricted_legal: "a moderator found the item illegal under EU law or the law of an EU country, and korbat restricted it everywhere.",
  no_violation: "a moderator found that the item breaks no rule and is not illegal, and korbat left it as it was.",
  not_evident:
    'this is what "illegality not evident" means: a moderator found no breach of a rule and could not tell from the item and from what you wrote, without a detailed legal examination, that it is illegal. korbat does not settle legal disputes; it leaves such an item up, and a court or an authority can order its removal.',
  not_available: "the link named no post or profile that korbat can show: it does not exist, or its author deleted it. This answer is given automatically, and no person looked at the link.",
  partly_reversed: "on its author's appeal or by a correction, korbat lifted part of what it had done about the item.",
  reversed: "on its author's appeal or by a correction, korbat lifted all of what it had done about the item.",
};

/** An outcome's phrase as the terms quote it: the rule's number and title are named, not filled in. */
const quoted = (phrase: string): string => phrase.replace("{rule}", "[number]").replace("{title}", "[title]");

/** One paragraph for each phrase an answer can read, with what it means: the seven outcomes, then the three that stand in for them where nobody opened the images. */
const ANSWERS: string[] = [
  ...ITEM_OUTCOMES.map((outcome) => `"${quoted(OUTCOME_PHRASES[outcome])}": ${OUTCOME_MEANINGS[outcome]}`),
  `"${SUSPECT_OUTCOME_PHRASES.sealed}": korbat's answer to a report on the anonymous path, and to any other report that the same decision answers, when images were sealed. It never says that korbat found something about the images, since nobody at korbat opened them.`,
  `"${SUSPECT_OUTCOME_PHRASES.no_action}": korbat's answer to a report on the anonymous path when an admin sealed nothing and restricted nothing.`,
  `"${UNSEEN_NO_ACTION}": korbat's answer to a report on another ground about a post, when a moderator took no action while nobody at korbat could open the post's images. It does not use up your one request for a re-examination.`,
];

const COURTS = "You can also go to court, or complain to the Digital Services Coordinator of the EU country where you live.";

/**
 * 3e's four sections (design, W.7), in the design's words, each number printed from the constant the code that acts on
 * it reads: STANDING_RULES for the standing rules, RETENTION.mailGiveUpDays for the days after which a mail is given up,
 * REPLY_AIM_HOURS for korbat's aim in answering a reply, APPEAL_MONTHS for the appeal. The placeholder's prefix is the
 * handle rule's own.
 */
const S = STANDING_RULES;
const [FIRST_RUNG, SECOND_RUNG, THIRD_RUNG] = S.ladderDays;

// 3d Task 4 (design, section 9.2): the rules page prints these three sections and Terrorist content with the same
// builders, so one number has one sentence in both places (a table test holds both).
export const STRIKES = `When a moderator's final decision finds that a post of yours breaks a korbat rule, the decision also gives your account a strike. A strike restricts nothing by itself and is used for one thing: counting toward a suspension. It counts for ${count(S.strikeDays, "day")} from its decision. A decision gives no strike when it rests on the law alone, when it concerns child sexual abuse material (rule R2), when it is about your profile and not a post, or while korbat is still deciding. A post gets at most one strike, and a post you made before you were told of your newest strike gets none, so several posts decided in one sitting count as one warning. A strike also counts when the post was already removed or deleted. The decision's statement tells you of the strike, until when it counts and how many you have; your strikes are listed under Settings, Cases. A strike falls only with its decision: appeal that decision, and if it is reversed the strike stops counting at once, and a suspension that rested on it ends at once if fewer than ${numberWord(S.ladderStrikes)} of its strikes still stand. If that suspension was already over, it no longer counts toward a later one.`;

export const SUSPENSION = paragraphs(
  `When your account has ${numberWord(S.ladderStrikes)} active strikes at once, a moderator may decide to suspend it: for at most ${count(FIRST_RUNG, "day")} the first time, ${numberWord(SECOND_RUNG)} the second and ${numberWord(THIRD_RUNG)} the third, counting the suspensions decided in the last ${count(S.ladderMemoryDays, "day")}. A moderator may choose fewer days, never more, and a moderator who chose fewer days still used that step. After a suspension, one further strike is enough for the next step while at least ${numberWord(S.ladderStrikes - 1)} earlier strikes still count. After ${numberWord(S.ladderDays.length)} such suspensions in that time, whatever their length, the next step may be the termination of the account, which only an admin decides. Nothing happens automatically: a moderator reads the strikes and decides. Such a decision finds no new breach: its ground is this section, and its statement says so and lists the strikes it rests on.`,
  `korbat tells you first. The decision is always shown in the app with its reasons, and korbat also sends it to you by email. The suspension starts ${count(S.replyWindowHours, "hour")} after korbat sent that email. If korbat's mail service refuses your address or cannot send the email for ${count(RETENTION.mailGiveUpDays, "day")}, only the app can tell you, and the suspension starts ${count(S.undeliveredHours, "hour")} after the decision. korbat cannot see whether an email it sent reached you, so keep the address of your account current. The app shows the start as a date and time. If you reply before the start, it does not start until a moderator has read your reply and answered you; the answer reverses the decision, or keeps it, and then the suspension starts with the answer and never before the time you were first given. A reply sent later is read and answered too, and can end the suspension, but does not pause it. You can reply once, and replying does not use up your appeal: when korbat keeps a decision after a reply you sent before the start, your ${count(APPEAL_MONTHS, "month")} to appeal count again from that answer.`,
  `korbat suspends an account at once, before any reply, only in four cases, each decided by an admin: after a final decision that a post of the account is a direct threat of violence (rule R5), for up to ${count(S.threatDays, "day")}; after a final decision that a post of the account is terrorist content, for up to ${count(S.terroristDays, "day")}; when an admin finds that the account is flooding korbat with repetitive, unsolicited posts (rule R6) and it made ${S.floodPosts} or more posts within ${count(S.floodMinutes, "minute")}, for up to ${count(S.floodDays, "day")}; and, as a protective suspension, when korbat keeps images of the account sealed after a report of child sexual abuse material, by a decision at most ${count(S.basisAgeDays, "day")} old, once for each such decision and for up to ${count(S.protectiveDays, "day")}. In the last case korbat's staff do not open the images, so korbat has not assessed them: the suspension is a protective measure and not a finding that you broke the law or a rule, it gives no strike, counts toward no later step, and ends on its date, or earlier if the seal is lifted. Its appeal is reviewed at once and does not wait for the authorities. In the first two cases the suspension ends at once if the decision it rests on is reversed. An announced suspension never rests on one of these four cases. You get the statement at once and can reply and appeal from the first minute; korbat aims to answer a reply to a suspension taken at once within ${count(REPLY_AIM_HOURS, "hour")}.`,
  "While suspended you cannot post, reply, quote, like, repost, bookmark, follow, edit your profile, change your handle, upload images, ask for the verified badge, or report under korbat's rules. You can still sign in and read, see your cases, reply to korbat, appeal, ask for a re-examination, export your data, delete your posts or your account, undo likes, reposts, bookmarks and follows, block and mute, and report illegal content. Your profile and posts stay visible, without any mark, and others can still follow you and react to your posts. Your posts do not appear in Explore while you are suspended, and your likes and reposts do not count there.",
  `A termination is decided after ${numberWord(S.ladderDays.length)} suspensions as described above, with the same time to reply, or at once after a direct threat of violence (rule R5) that you post within ${count(S.ladderMemoryDays, "day")} after korbat suspended your account for an earlier one, while that suspension and the decision it rests on still stand. A second post from before that suspension is no ground for it. Until the decision is final the account is suspended and nothing more. It is final when the ${count(APPEAL_MONTHS, "month")} for your appeal have passed unused, or when your appeal is answered and the decision kept; nothing is deleted while your appeal or a reply of yours is unanswered. korbat then deletes the account with its posts and profile and every image it has not sealed. Until then you can export your data and delete the account yourself; deleting it ends your appeal, since nothing is left to restore. After the deletion korbat keeps nothing to recognise a new account of yours by; images that korbat sealed stay with it for the authorities alone, as the decision that sealed them said.`,
  "Each of these decisions can be appealed from the moment you are told, as Appeals says; an appeal does not hold a start, only a reply does. One person may hold more than one account, but not to carry on with another account what one was suspended or terminated for: korbat treats that as the same conduct and decides about it like any other breach, on what the account does.",
);

export const REPORTING_IN_BAD_FAITH = paragraphs(
  "Report what you believe breaks a rule; a report that turns out wrong costs you nothing. korbat acts only on reports that are manifestly unfounded: reports that anyone could see name nothing a rule could cover, without weighing them. Examples are many reports of the same account for posts that plainly break no rule, the same text sent against different posts, and a report sent again after it was answered. A moderator may mark such a report when deciding it. You see the mark on your list of reports together with the report's outcome, and you can ask for a re-examination. The mark stops counting if a re-examination finds a breach, and if korbat withdraws it because the report was arguable after all. korbat counts reports, not the posts or accounts a report names: a report counts once, by the day you sent it, however many of its items were marked, so no single report can lead to a warning.",
  `If at least ${numberWord(S.reportWarnMarks)} of the reports you sent under the rules within ${count(S.reportFrameDays, "day")} are marked, and they are at least ${share(S.reportWarnShare)} of the reports you sent under the rules in that time, a moderator may warn you: the warning lists the reports and restricts nothing. If ${numberWord(S.reportRestrictMarks)} of the reports you send after that warning are marked while it counts, which is ${count(S.reportFrameDays, "day")}, a moderator may stop taking your reports under the rules for up to ${count(S.reportRestrictDays, "day")}; the restriction ends at once if the warning is lifted. A person decides each step, looking at how many reports you sent, how many were marked and what they said; the count alone decides nothing. Notices of illegal content, reports of child sexual abuse material and requests for re-examination are never counted and never restricted. You can appeal the warning and the restriction.`,
);

const HANDLES = `When the breach lies in a handle itself (impersonation, someone's private information, a threat), a moderator may retire it. A retired handle can be used by nobody again, you included. Your profile then shows a placeholder that begins with ${RETIRED_HANDLE_PREFIX}, and you can choose a new handle without the usual wait: at once, or, while your account is suspended, when the suspension ends. If the decision is reversed, the retirement is lifted: your profile gets the handle back if it still shows the placeholder, and otherwise you can change back to it at once; nobody else could take it meanwhile. Handles that begin with ${RETIRED_HANDLE_PREFIX} cannot be chosen. korbat keeps a retired handle, as a handle and nothing else, for as long as it refuses it to everyone, also when the breach was someone's private information (rule R4): refusing it needs it.`;

/**
 * 3f (design, W.6 and section 5): the contact point for authorities and the Member State korbat is established in, the
 * web build's two arguments (WEB_CONTACT_POINT and WEB_HOME_STATE in infra/.env), which Expo inlines at export time as it
 * inlines the contact address. The app's page is built, so it cannot read the API's settings of the same names. While the
 * contact point is empty the terms print no section on it, and while the state is empty no sentence names one: both are
 * set, with the API's, as the last step of the README's Before going public.
 */
export const CONTACT_POINT = process.env.EXPO_PUBLIC_CONTACT_POINT ?? "";
export const HOME_STATE = process.env.EXPO_PUBLIC_HOME_STATE ?? "";
/** The home state's facts, while the contracts fill its entry in. */
const STATE: StateFacts | undefined = HOME_STATE === "" ? undefined : (STATE_FACTS as Partial<Record<string, StateFacts>>)[HOME_STATE];
/** The state as a sentence names it: its name from STATE_FACTS, or its code while the contracts have no entry for it. */
const HOME_STATE_NAME = STATE?.name ?? HOME_STATE;

/** A list inside a sentence: "a", "a and b", "a, b and c". */
const andList = (items: readonly string[]): string => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/**
 * 3f's sections (design, W.6), in the design's words. Each number is printed from the constant the code that acts on it
 * reads: what a removal order disabled is kept for RETENTION.orderPreserveMonths and ORDER_RULES.preserveMarginDays, the
 * records for RETENTION.orderRecordYears, a message's record for RETENTION.contactMessageDays, a restore gap for
 * RETENTION.restoreGapMonths and a deleted account's address for ORDER_RULES.reportHoldDays. The hour, the six and twelve
 * weeks and the 48 hours of a scrutiny are the Regulation's own periods (TCO Art. 3(3), 11(3) and 4(4)), written as it
 * writes them: ORDER_RULES holds korbat's own numbers built on them (holdDays counts a day more, so as never to be early).
 */
const O = ORDER_RULES;
const PRESERVED = count(RETENTION.orderPreserveMonths, "month");

const AUTHORITIES_ORDERS = paragraphs(
  "An authority or a court of the European Union or of one of its countries can order korbat to act against a post, or to give information about an account. korbat carries such an order out within the time the law sets and checks that it comes from the authority it names; if it does not, korbat reinstates the post and tells you. A removal order for terrorist content leaves korbat no choice, and has to be carried out within one hour, so korbat may act on it before that check is finished. Any other order korbat checks first, and carries out because the law under which it was issued requires it. korbat does not assess the post under its own rules when it carries out an order: such an order is not a decision of korbat's.",
  "So korbat gives no reasons of its own for it, and korbat's appeal does not apply. You get a notice instead, under Settings, Cases, announced by an email that says only that there is one. The notice says which authority the order names, under which law, on which day and under which reference, and whether korbat has confirmed that it comes from that authority. It gives the authority's reasons and the ways to challenge the order, in the authority's own words, as soon as korbat has them; when korbat adds them later it sends you an email, and the notice says since when it has held them. The notice also says how to ask korbat for a copy of the order.",
  "An order can forbid korbat to tell you about it for a time. Then korbat keeps the post from you as from everyone, tells you nothing, and can say nothing about the post by email either. For a removal order the law sets that time (Terrorist content); for another order the authority that issued it does, and korbat tells you when that authority allows. While korbat may not tell you of an order, it cannot tell you of a decision it takes about the same post under its own rules, or answer an appeal you made about that post before: you get those together with the notice.",
  "korbat lifts what it did only when the authority withdraws the order, when a court annuls it, when the authority of korbat's own country finds that an order from another country infringes the law, when the order turns out not to be authentic, or when korbat disabled a post that the order did not name. For that last case write to the address under Contact, from the email address of your account. When korbat's own rules apply to the same post, that is a second decision, with its own statement of reasons and its own appeal. korbat cannot act for one country alone, so an order takes effect everywhere korbat is available.",
);

// 3c's section, in full as 3f has it read: the removal order is carried out within the hour now, not once korbat is open.
export const TERRORIST_CONTENT = paragraphs(
  "korbat removes terrorist content as defined in Article 2(7) of Regulation (EU) 2021/784 when it is told about it in a notice, and carries out a removal order of a competent authority within one hour of receiving it. Material for educational, journalistic, artistic or research purposes, or for preventing or countering terrorism, and polemic or controversial views in public debate are not terrorist content. korbat uses no automated tool to find it.",
  `A post disabled under a removal order is shown to nobody, you included, for as long as the order stands. korbat keeps it, with its images and a copy of its text, for ${PRESERVED} from the disabling, as the Regulation requires, so that it can be reinstated or examined, and longer only when an authority or a court asks. Deleting the post or your account does not shorten this. Then korbat erases it, and it cannot be reinstated afterwards.`,
  `The law can oblige korbat to tell you nothing about such an order for six weeks, for twelve at most, and up to a day and a few hours more, because korbat counts the end so that it is never early. During that time the post is simply not there, for you as for everyone, and korbat cannot say why. korbat tells you when that period ends, with the day on which the post was disabled. If the order comes from another country of the European Union than korbat's, you can ask the authority of korbat's country to scrutinise it, within 48 hours of receiving its reasons or a copy of it; the notice says since when it has held the reasons. If you challenge an order in court, ask the court or the authority to tell korbat to keep the post until that is decided, since korbat erases it after the ${PRESERVED} otherwise. korbat publishes the figures the Regulation asks for, for every year in which any of them is not zero.`,
);

// The languages the contact point declares are the operator's (STATE_FACTS); while the state's entry declares none, the
// sentence names none rather than print that they are not filled in.
const CONTACT_POINT_SECTION = `Authorities of the Member States, the European Commission and the European Board for Digital Services reach korbat at ${CONTACT_POINT} (Article 11 of the Digital Services Act; Article 15 of Regulation (EU) 2021/784)${STATE?.languages ? `, in ${andList(STATE.languages)}` : ""}. This address is for authorities. Everyone else writes to the address under Contact, and reports content with the report form.`;

/**
 * "Your data"'s four paragraphs of W.6, and RETENTION's printed list of what concerns authorities, in one paragraph. 3f's
 * review (people8): a message an order came with is kept with that order's records (delete_contact_messages skips it), so
 * both sentences about the contact point's records say so.
 */
const AUTHORITIES_DATA = [
  `Two things the law can oblige korbat to keep for a time when you delete your account; everything else is deleted at once. First, your email address: when korbat has sealed images of your account, the law may oblige it to report them to the authorities. Until it has done so, or has decided that it need not, and for ${count(O.reportHoldDays, "day")} at most, korbat keeps the address, and nothing else of the account; it uses it for that report alone, and the email that confirms your deletion tells you. You can write to korbat about this at the address under Contact, complain to a data protection authority, and go to court. Second, a post that an authority's order obliges korbat to preserve: korbat keeps it, with its images, until that time ends (Terrorist content), also after your account is gone.`,
  `korbat keeps a record of every report it makes to an authority and of everything it hands to one: which duty, which authority, when, both references, what was asked for and which kinds of data, never a copy of the data. It keeps these records and its records of authorities' orders for ${count(RETENTION.orderRecordYears, "year")} after the matter's last event, an order's record for as long as its measure stands, and a record that says you may not be told of something for as long as that holds. korbat records when a message reaches its contact point for authorities, never who sent it or what it says, and deletes that record ${count(RETENTION.contactMessageDays, "day")} after the message was handled, or, when an order came with it, with that order's records.`,
  "When an authority lawfully asks who holds an account, korbat gives the handle, the email address and the day the account was created. korbat also holds when and from which kind of device an account signed in; it gives those only when an order names them and the law requires it, and its record says so. korbat tells you when it has given an authority information about your account, with the authority's reasons and the ways to challenge its order, unless the order, or the law under which it was issued, forbids telling you or delays it; korbat records which of these applies and on what basis. While korbat may not tell you, its answer to a data request of yours leaves the matter out, and korbat keeps the reason on record.",
  "If korbat has to restore its database from a backup, it may have to take a decision about you again; the decision then says so.",
  `The periods for what concerns authorities: content disabled under a removal order is kept ${PRESERVED} and ${count(O.preserveMarginDays, "day")} from the disabling, and from the new disabling when it was reinstated and disabled again, longer on an authority's or a court's request, and is then erased. An order's records, and the records of a notification or a production, are kept ${count(RETENTION.orderRecordYears, "year")} after the matter's last event; an order's never while its measure stands, and a record of an authority's demand that a person is not told never while that demand holds. The record of a message at the contact point for authorities is kept ${count(RETENTION.contactMessageDays, "day")}, counted from the day the message was handled, or, when an order came with it, as long as that order's records; the record of a message nobody handled is kept until a person has closed it. A gap a restore left is kept ${count(RETENTION.restoreGapMonths, "month")} when it was closed as not needed or imported; a gap that a decision taken again closed is kept as long as that decision. The email address of a deleted account is kept while a report is owed, ${count(O.reportHoldDays, "day")} at most.`,
];

/**
 * 3d (design, W.9): "Automated tools" and "Transparency", drafts without a new TERMS_VERSION, as 3c's, 3e's and 3f's
 * sections were; counsel reviews them in sub-project 4. Every number is AUTOMATION_RULES', which the database's
 * automation_rules() holds the program to. They say what each tool may do when it is switched on, and the rules page says
 * which is on today: so they are true in every state the design builds (section 18, rule 9).
 */
const A = AUTOMATION_RULES;
export const AUTOMATED_TOOLS = paragraphs(
  "korbat's decisions are taken by people. korbat may use two programs, and the rules page says under Automation which of them is switched on today.",
  "The first rates uploaded images against rule R1 and keeps the rating with the image while the check is switched on. An image it rates as likely within the rule is put before a moderator. korbat may also hide that one image from other people until the moderator has decided; the post's text stays and you still see the image.",
  "The second compares the fingerprint of an uploaded image with lists of images that a named body has classified as child sexual abuse material. korbat sends that body fingerprints and nothing else. An upload that the body reports as an exact match with such an entry is not accepted, now or later, and is kept, unopened, until an admin has decided whether korbat reports it to the authorities. A match with such an entry on an image of a post, exact or not, is put before an admin even when the program seals nothing; from then on korbat keeps that post's images, also if you delete the post or your account, until the admin has answered (Your data). On an exact match korbat may also seal that post's images for everyone until then. A match is a comparison of fingerprints: it is not korbat's finding about an image, and korbat's staff do not open an image that a match names, before the admin's answer or after it. A match with an entry of any other class only flags the image for a person.",
  `A program never removes anything, never judges text, and never suspends or restricts an account. It takes at most ${A.decisionsPerHour} measures an hour and ${A.decisionsPerDay} a day under rule R1, and ${A.r2DecisionsPerHour} and ${A.r2DecisionsPerDay} under rule R2, none under a rule while ${A.unansweredMax} of its measures under that rule wait for a person, and none at all while a request for a person has waited longer than ${A.unansweredHours} hours. Every measure a program takes you are told at once, with the reasons and the words "automated means", under Settings, Cases and by email. You can ask for a person there, and korbat's target is that one answers within ${A.objectionTargetHours} hours. The person's decision is the one you can appeal. An upload that is not accepted is different: nobody at korbat can accept it, since nobody opens it; you can object, and an admin decides what happens to the file. korbat uses these programs to keep such content from being shown, on the basis of its legitimate interest in a service that follows its rules and the law; you can object to that at the address under Contact.`,
);

/** 3d (design, W.9): "Transparency". */
export const TRANSPARENCY =
  "korbat publishes its rules, with every change, on the rules page, and each year the counts of what its moderators, its programs and authorities' orders did, on the Transparency page. It publishes numbers, never a decision, and no number small enough to point at a person, except the figures on authorities' orders, which the law asks for as numbers. To give the authorities the figure the Digital Services Act asks for, korbat counts how many accounts and readers use it each month and keeps two numbers a month; the Transparency page says how it counts and what exists until a month has ended.";

/**
 * 3d (design, W.9): "Your data"'s paragraph on what the automated tools and the sealed images leave behind, and
 * RETENTION's printed list of the same, each period from its constant: the match record's days, the address held after a
 * refused upload (3f's hold), the edge's outbox rows, the records to authorities' years, and the reader count's salt.
 */
const R = RETENTION;
const AUTOMATION_DATA = [
  `While a comparison is switched on korbat keeps fingerprints of each uploaded image for as long as it keeps the image; when the comparison is switched off it deletes them all. While the check against rule R1 is switched on it keeps the program's rating of each image the same way, and deletes the ratings when the check is switched off. It keeps the record of a match (the image's id, the body, the kind of match and the fingerprint, never your account) for ${count(R.matchKeepDays, "day")} after the case closed, the hold ended or the images were released. The record that an upload of yours was not accepted names your account for the same time; after that korbat keeps only that an upload was refused on that day. If korbat reported the upload, the record of that report names your account for as long as korbat keeps its records to authorities. While an upload of yours is held korbat keeps your email address for up to ${count(R.reportHoldDays, "day")} from the refusal, also if you delete your account, as it does when images are sealed. It keeps what you wrote when you asked for a person as long as the decision's own texts, and what you wrote when you objected to a refused upload as long as that upload's record of a match. It keeps for ${count(R.edgePurgeDays, "day")} the record that a cached copy was to be dropped, and for ${count(R.orderRecordYears, "year")} the record of a release, of the leave or instruction it rests on, and the digests that prove a destruction.`,
  `The periods for the automated tools and for sealed images: the record of a match: ${count(R.matchKeepDays, "day")} after its case closed, its hold ended or its images were released, or, for an upload that was accepted and never posted, after the comparison; longer only while images sealed for good and not released, or a held upload, rest on it. The record that an upload was not accepted: with your account until the record of its match is erased, and without it afterwards; when korbat reported the upload, the record of that report names your account for as long as korbat keeps its records to authorities. Your email address after an upload of yours was not accepted: up to ${count(R.reportHoldDays, "day")} from the refusal, also if you delete your account; less when the hold ends without a report. The record that a cached copy was to be dropped: ${count(R.edgePurgeDays, "day")} after it closed. Fingerprints of an uploaded image: as long as the image, and only while a comparison is switched on; all are deleted when it is switched off. The rating of an image under rule R1: as long as the image, and only while the check is switched on; all are deleted when it is switched off. The monthly count of readers: two numbers a month, kept; the counting sketches are deleted at the month's end, and the day's key after ${count(RECIPIENT_RULES.saltHours, "hour")}. The record of a release, of the leave or instruction it rests on, and of each destroyed file's digest: as korbat's records to authorities (${count(R.orderRecordYears, "year")}).`,
];

export const TERMS_SECTIONS: { title: string; body: string }[] = [
  {
    title: "Draft",
    body: "These terms are a draft for testing korbat before launch. They will be replaced by reviewed terms and a privacy policy before korbat opens to the public.",
  },
  {
    title: "Who can use korbat",
    // 3e (W.7): what another account may not carry on, which "Suspension and termination" says.
    // 3f (W.6): the Member State korbat is established in, from the build's argument, while the build names one.
    body: `You must be at least 16 years old. You can use a pseudonym. One person may hold more than one account, but not to carry on what another of their accounts was suspended or terminated for (Suspension and termination).${HOME_STATE_NAME === "" ? "" : ` korbat is established in ${HOME_STATE_NAME} and offers its service there only.`}`,
  },
  // The 3c design's sentence (section 9), in place of "removed only when it breaks a published rule", which notices of illegality made false. The rules are named from the rulebook.
  {
    title: "What you can post",
    body: paragraphs(
      `You can post opinions, including unpopular ones. korbat restricts content only when it breaks a published rule (${RULES.map(ruleName).join(", ")}), or when it is illegal under EU law or the law of an EU country and someone tells korbat so in a notice. Every decision names the rule or the law and says why, and a final decision that restricts your content can be appealed as the section "Appeals" describes. The one restriction that is not korbat's decision is an authority's order (Authorities' orders).`,
      // 3b (11.3): the licence for every post and image, written here or imported, which Importing posts points to.
      `You grant korbat a licence for every post and image you put on it, written here or imported: ${LICENCE}.`,
    ),
  },
  // The rulebook itself, as @korbat/rules holds it: the grounds on which korbat restricts content (Digital Services Act, Article 14(1)).
  {
    title: "The rules",
    body: paragraphs(
      `These are korbat's rules, in version ${RULES_VERSION} of its rulebook. A decision under a rule names the rule, and its statement of reasons quotes the rule as it stood when the decision was made.`,
      ...RULES.map((rule) => `${rule.id}. ${rule.title}. ${rule.text}`),
    ),
  },
  {
    title: "Reports and notices",
    body: paragraphs(
      "Anyone can report a post, an image or a profile on korbat, signed in or not: choose Report on the item itself, or use the report form linked below these terms. A report says either that the item breaks one of korbat's rules or that it is illegal.",
      "A report about a profile is decided on its display name and bio; korbat decides about the account's posts and images in cases of their own. A report about a post that quotes another is decided on that post's own text and images; the quoted post is decided in a case of its own.",
      `For the sexual abuse or exploitation of a child, child sexual abuse material or grooming, the form has a path of its own, which is anonymous: korbat does not record who sent the report, not even an account, asks for no name and no email, and sends no email. You follow such a report through the link that is shown once on screen. On that path a report about a profile covers the images on all the profile's posts, a report about a post that quotes another covers both posts, and one report can name ${count(CSAM_NOTICE_MAX_ACCOUNTS, "profile")} at most.`,
      "A notice that something is illegal asks you to explain why and to confirm that you report in good faith; which law or country you mean, your name and your email are optional. Reports are anonymous towards the person you report: korbat never tells them who reported them, and a request for their data shows them what was written only where the law requires it (see Your data).",
      `korbat takes at most ${NOTICE_LIMITS.signedOut.perHour} reports an hour and ${NOTICE_LIMITS.signedOut.perDay} a day from one network without an account, and ${NOTICE_LIMITS.signedIn.perHour} an hour and ${NOTICE_LIMITS.signedIn.perDay} a day from one account. One report can name up to ${numberWord(NOTICE_LIMITS.maxTargets)} posts or profiles on korbat, by their links; korbat takes no attachments and follows no links to other sites. What you write to explain a report can be up to ${NOTICE_LIMITS.explanationMax} characters long, and the law or country you cite up to ${NOTICE_LIMITS.citedLawMax}.`,
      "A person looks at every report about something that is on korbat. A link that names nothing korbat can show is answered automatically, and the answer says so. Moderators read reports in the order of their severity and then of their age, never by how many reports an item has, and by who sent them only under the emergency switch. When many reports about one post arrive in a short time from accounts that follow one another, korbat's moderators are shown that; it changes neither the order in which reports are read nor who decides; a moderator still judges the content itself.",
      "The emergency switch: when a flood of reports keeps moderators from real cases, the operator may turn it on until the flood ends. Reports sent without an account or from accounts under 48 hours old are then read after the others of the same severity; in the urgent lane (threats, violence, self-harm, public security, and the sexual abuse or exploitation of children) only reports sent without an account are. A report is never read after a less severe one, and every report is still read and answered.",
      `Every report gets a reference, shown on screen at once. A notice that something is illegal gets a receipt by email at once when you gave an email or sent it from an account; a report on the anonymous path gets none. An email address that has not been confirmed as its sender's in the last ${count(RETENTION.confirmationDays, "day")} gets at most one receipt a day; the others come with the next daily email. For a notice that something is illegal, korbat sends its decisions by email once a day when you gave an email or sent it from an account. Every decision on a report is shown under Settings, Cases, Your reports, or on the report's own page. korbat sends no report email to an address whose holder asked it to stop, and gives up an email it could not send for ${count(RETENTION.mailGiveUpDays, "day")}; the answer stays on the report's page.`,
      "korbat answers each item of a report in one of the following ways.",
      ...ANSWERS,
      // 3e (W.7, W.1): the scope phrases an answer carries when it was a measure on the account a report named.
      `When korbat's answer to a report about an account is a measure on that account, korbat tells you that it took a measure, and not which or for how long: the answer adds "${ACCOUNT_MEASURE_SCOPE.measure}", or "${ACCOUNT_MEASURE_SCOPE.retired}" when it retired the handle. korbat does not tell you what happens to that account afterwards.`,
      `Re-examination: if a moderator answered your report with no action, you can ask once for a re-examination, within ${count(APPEAL_MONTHS, "month")} of being told, free of charge and with an optional statement, under Your reports or on the report's page. It is decided again as a new report, by a moderator; korbat asks another moderator than the one who decided to take it when it has one. You can ask for at most ${count(DAILY_LIMITS.reexaminations, "re-examination")} a day. Its answer is final within korbat, with one exception: an answer given while korbat's staff could not open a post's images, because a report of child sexual abuse material about them was waiting or because they were sealed, says so and can be asked again. An outcome changed on review or by a correction is final within korbat, and everyone whose report it answered is told. ${COURTS}`,
    ),
  },
  {
    title: "How moderators decide",
    body: paragraphs(
      // 3d (W.9): what a program may do until a moderator decides is in Automated tools.
      "A moderator decides every case; what a program may do until then is in Automated tools. A moderator never decides about their own accounts or about accounts close to them.",
      `Some decisions only an admin takes: every final decision, whether it acts or not, on a report or a moderator's finding under ${ADMIN_RULES} or on a report made on the anonymous path, every lifting of a seal, and every correction of such a decision. Until an admin decides, any moderator may at once hide a reported threat from other people, or seal reported images.`,
      "On the path for child sexual abuse material, a moderator and an admin decide without seeing the images, on the report and on what korbat can read. Nobody at korbat opens images that are reported or found as such material while the report is unanswered or the images are sealed; that covers the images of a post while such a report about it, or about its author's profile, is unanswered. After an admin has answered without a seal, staff may open them like any other image, except an image that an automated comparison matched: korbat's staff do not open such an image at any time. Reports on other grounds about those images, corrections and appeals are meanwhile decided on what korbat can read, or wait. An admin's answer to such a report about a post also answers the earlier reports about that post, and whoever sent a report about a post that is answered without action while its images cannot be opened is told so and may ask again.",
      "A seal can cover every image on a profile's posts. It hides the images from everyone, their author included, from the first seal, and never hides a post's text. A report of this kind about a post that quotes another opens a case on the quoted post too.",
      MEASURES_PARAGRAPH,
      "A reset is written once, and korbat does not put the old value back: you may set the field again, and what you set is judged on its own if someone reports it. korbat restricts the least it can: one image rather than the post, one field rather than the account. Every finding of a breach is recorded as a restriction of its own, also when the content was already not shown or already deleted; its statement then says that it changed nothing now.",
      "Every decision that restricts your content, also one that changes nothing anyone sees now, every decision that reverses one, every answer to your appeal, and every end or lifting of something korbat told you it did while deciding comes with a statement of reasons, in the app at once and by email. A decision to take no action is not sent to you, since it would tell you that someone reported you, unless it ends or lifts something korbat told you it did while deciding. Something korbat does while deciding about a post you had already deleted is recorded without being sent to you, since it can never take effect. Content restricted for being illegal is restricted everywhere, since korbat cannot restrict by country.",
    ),
  },
  // 3d (W.9): what a program may do, after the section that says a moderator decides every case.
  { title: "Automated tools", body: AUTOMATED_TOOLS },
  {
    title: "Appeals",
    body: paragraphs(
      `If a final decision restricts your content or your account, you can appeal it once, while any of it is in force, within ${count(APPEAL_MONTHS, "month")} of being told, free of charge and with no form to follow: choose "Appeal" on the decision's screen under Settings, Cases. You can file at most ${count(DAILY_LIMITS.appeals, "appeal")} a day.`,
      "What korbat does while it decides cannot be appealed. It ends with the case's final decision, which is shown and sent to you and can be appealed when it restricts; a seal ends with an admin's answer to the reports it was taken on. A moderator may lift it earlier; a seal, only an admin. What a program does while a person has not decided cannot be appealed; you can ask for a person at once, and the person's decision can be appealed.",
      "An appeal is reviewed by a moderator who made none of the case's decisions, including hiding the content while it was decided, did not report it, and has no link to anyone in the case. While korbat has no such moderator the appeal waits, without a time limit, and its screen says so: with one moderator every appeal waits, and with two every case both took part in, where one hid the content or reported it and the other decided it, which is how direct threats and images reported as child sexual abuse material are handled whenever the moderator on duty is not the admin.",
      "A review keeps the decision, lifts part of it or lifts all of it, and never adds to it. A decision reversed in full can no longer be appealed, since nothing of it remains. A decision that a correction changed in part can still be appealed for what remains of it; an answer to your appeal is final within korbat.",
      `korbat does not put back a display name or a bio it reset: set it again. The screen of the decision that reset it shows what it was while korbat keeps the case's copies, and for at least ${count(RETENTION.resetValueDays, "day")} after a reset that is lifted or ends before they are erased, unless korbat had already erased a value reset under ${R4}, as Your data says.`,
      "An appeal of a seal waits, without a time limit, for the assessment of the authority korbat reported the images to. Only an admin lifts a seal, and a seal for good only on that authority's answer that the images are not child sexual abuse material.",
      // 3e (W.7): what an appeal of a standing measure does and does not do.
      `An appeal never holds the start of a suspension; a reply does. When korbat keeps a decision in answer to a reply you sent before its start, the ${count(APPEAL_MONTHS, "month")} to appeal it count from that answer. The appeal of a protective suspension is reviewed at once; only the appeal of a decision that seals images waits for the authorities.`,
      // 3f (W.6): an order is no decision of korbat's, and what a hold delays counts from the day korbat may tell.
      "korbat's appeal does not apply to what korbat does on an authority's order. If such an order forbids korbat to tell you about a post, korbat's answer to an appeal you made about that post reaches you only when it may tell you of the order; your time to appeal a decision you are told of late counts from the day you are told.",
      COURTS,
    ),
  },
  // 3e's four sections (design, W.7), after the appeals they refer to.
  { title: "Strikes", body: STRIKES },
  { title: "Suspension and termination", body: SUSPENSION },
  { title: "Reporting in bad faith", body: REPORTING_IN_BAD_FAITH },
  { title: "Handles", body: HANDLES },
  // 3f (W.6): what an authority's order is and what korbat does with one, before the section on removal orders.
  { title: "Authorities' orders", body: AUTHORITIES_ORDERS },
  // The policy Article 7(1) of Regulation (EU) 2021/784 asks for; its one hour is the Regulation's own figure.
  { title: "Terrorist content", body: TERRORIST_CONTENT },
  // 3f (W.6): only while the build has a contact point for authorities to publish.
  ...(CONTACT_POINT === "" ? [] : [{ title: "Contact point for authorities", body: CONTACT_POINT_SECTION }]),
  // 3d (W.9): what korbat publishes, and the one count it keeps to publish it.
  { title: "Transparency", body: TRANSPARENCY },
  // The 2c design's sentence (section 2). It joins the draft without a new TERMS_VERSION, as 1b's and 1c's changes did before any public sign-up.
  {
    title: "Explore",
    body: "Public posts can appear in Explore, ranked by how many other accounts like or repost them; How Explore works gives the rules, and Settings > Privacy keeps your posts out.",
  },
  { title: "Importing posts", body: IMPORTING_POSTS },
  {
    title: "Your account",
    body: "You are responsible for keeping access to your email address. Turn on two-factor authentication and store your recovery codes; korbat cannot restore an account without them.",
  },
  {
    title: "Your data",
    // UI Task 8 (8.8): the first paragraph names what the browser keeps beside the device id; it joins the draft without
    // a new TERMS_VERSION, as 2c's to 3f's sentences did.
    body: paragraphs(
      "korbat stores your email address for sign-in and security messages, and never shows it to other people. IP addresses are stored only as keyed hashes, and a device keeps its hash for 30 days after it was last seen. Your date of birth is checked once and never stored. Your browser keeps a random device id so korbat can tell a new device from a known one; it is shared by every account used in that browser and is stored on the server only as a keyed hash. Your browser also keeps, until you sign out, your appearance choices, where you stopped reading in Following and Latest, and drafts you have not sent; none of them leaves the browser, and Clear what this device keeps, in Settings > Appearance and accessibility, removes them at once. The device id stays, and so does your Not now on the passkey card. At sign-in, and when you send a report without being signed in, Cloudflare Turnstile checks that you are not a bot; it sees your IP address and browser details for that check, under Cloudflare's privacy policy. If you ask for the Verified badge, your phone number is handed to the verification provider for one text message, and korbat keeps only a keyed hash of it. From the Account settings you can export your account's data as a ZIP archive and delete your account; deletion removes your posts, keeps your handle reserved and cannot be undone. If you add a passkey, korbat keeps its public key, a name, the dates it was added and last used, and the device that added it; nothing about your fingerprint or face leaves your device.",
      // What 3c adds, with the periods of RETENTION (3c design, section 6.6).
      `When someone reports a post or a profile, korbat keeps a copy of its text and holds its images, whatever it then decides. Deleting the post or your account leaves these copies until their period ends. A case's copies are erased when the case closes, or ${count(RETENTION.evidenceHours, "hour")} after its newest copy if that is later, unless a restriction of the case can still be appealed or, for a post, a report that only an admin can answer still waits or its images are sealed.`,
      // 3d (W.9): the same keeping starts on a program's match when nobody reported anything; and what korbat does with
      // sealed images it reported, which promises no destruction and names no period (review ruling 1).
      "For a report of child sexual abuse material, or a comparison that finds a match of the kind Automated tools describes, korbat keeps the images of the reported or matched post, of the post it quotes, or of all a profile's posts until an admin has answered, also when their author deletes the post or the account meanwhile; once their post is deleted they are shown to nobody. Images an admin then keeps sealed are kept for the authorities, with korbat's copies of their post's text; they are left out of your account's export and are not released by korbat on its own. Sealed images that korbat has reported are kept for the authorities, away from the rest of korbat's images and outside its ordinary backups. korbat does not destroy them on its own judgement, and not because an authority has assessed them: only when an authority or a court has given korbat leave or an instruction to destroy them, and an admin has confirmed it. korbat then tells you, at once or as soon as it may. If the authority answers that they are not illegal, the seal is lifted and they are shown again. An authority may never answer. korbat has set no time after which it then destroys them: they stay sealed and kept.",
      `Content korbat removes or resets under ${R4}, a post's text, an image, a display name or a bio, is erased for good, as far as that decision still stands, once it can no longer be appealed, ${count(RETENTION.r4FinalMonths, "month")} after you were told, or once your appeal against it is answered; for a post, later only while a report that only an admin can answer still waits or while its images are sealed. It is erased from your own view, your export and the decision's screen, and from every copy korbat keeps but its backups (an image once no other case still holds it), also when you had deleted the post, so a later reversal cannot bring it back or show it to you again.`,
      `korbat's backups of its database and its images hold everything as it stood when each was taken, what korbat erased since included. Each is deleted ${count(RETENTION.backupDays, "day")} after it was taken, except a backup that korbat must keep for the authorities, which it keeps until they have answered.`,
      `A notifier's name and email are kept apart from the case, never shown to staff or to the person reported, and deleted ${count(RETENTION.contactMonths, "month")} after the last day korbat still owed the report a decision or an email, or ${count(RETENTION.contactMaxMonths, "month")} after the report if nothing moved that day. That an email address was confirmed as a sender's is kept for ${count(RETENTION.confirmationDays, "day")}.`,
      `Staff see a reporter or a notifier as a summary: roughly how old the account is, how many reports it sent, what share were acted on and how many were answered while their images could not be opened, in broad bands, never exact numbers. A moderator sees a reporter's handle or a notifier's name only when a case needs it, for example a claim of impersonation or abuse of reporting, each time with a recorded reason that is shown to every staff member; the person reported never sees either. korbat forgets which account sent a report ${count(RETENTION.intakeDays, "day")} after its last outcome was given and settled, which is at most about ${count(APPEAL_MONTHS + Math.ceil(RETENTION.intakeDays / 30), "month")} after a decision to take no action, while it can still be re-examined, except through the mark of a report found manifestly unfounded (Reporting in bad faith).`,
      `On a report of child sexual abuse material, staff see how many such reports about the same post, profile or author an admin answered without a seal in the last ${count(SUSPECT_EARLIER_MONTHS, "month")}, as a number and a day.`,
      `The reasons korbat gave you for a decision are kept while your account exists and for ${count(RETENTION.statementMonths, "month")} after its deletion; the decision itself stays on record without them. korbat's log of which staff member opened a case, viewed an image or was shown who sent a report, with the reason given for that, is kept for ${count(RETENTION.accessLogMonths, "month")}. A text a moderator wrote for a decision and did not confirm is deleted after ${count(RETENTION.draftHours, "hour")}.`,
      // 3e (W.7): what korbat keeps of account sanctions, with RETENTION's three members.
      `korbat keeps the record of every strike, suspension, termination, warning and retired handle with its decision, as it keeps every decision. What ends is its use: a strike counts for ${count(RETENTION.standingRecord.strikeDays, "day")}, a suspension counts toward the next one for ${count(RETENTION.standingRecord.ladderMemoryDays, "day")}, a warning about reporting for ${count(RETENTION.standingRecord.warningDays, "day")}. The text of a reply to a suspension is kept ${RETENTION.replyText}; a reply that is not answered yet is never erased. To decide about reporting in bad faith korbat counts, for each account and day, how many reports under its rules the account sent, and keeps which of them a moderator marked manifestly unfounded; both are deleted after ${count(RETENTION.reportCountDays, "day")} and with the account, so for that long a marked report stays linked to the account that sent it. A retired handle is kept as a handle (Handles). Your export holds all of this.`,
      // 3d (W.9): what the automated tools and the sealed images leave behind, and RETENTION's printed list of it.
      ...AUTOMATION_DATA,
      // 3f (W.6): what is kept when an account is deleted, korbat's records about authorities, what an authority can get,
      // after a restore, and the periods of RETENTION that concern authorities.
      ...AUTHORITIES_DATA,
      "Your account's export holds the decisions its Cases screens list and your own reports. If you ask for your data at the address under Contact, you receive, within a month, every case about you (cases without action included), the copies korbat keeps, where each case came from (a report by another user, a notice, a moderator) and, where the law requires it after weighing the writer's rights, the words of a report without who wrote it.",
      // 3b (11.3): the import's record and how long it is kept (6.1, decision 25), by IMPORT_RULES' days.
      `An import's record (its source, its state, its times, your choice and its counts, never a file name or the other account) is kept while a post of it exists and at least ${IMPORT_RULES.recordDays} days after the import ended, and goes with your account.`,
    ),
  },
];
