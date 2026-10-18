import {
  ACCOUNT_MEASURE_SCOPE,
  APPEAL_MONTHS,
  CSAM_NOTICE_MAX_ACCOUNTS,
  DAILY_LIMITS,
  ITEM_OUTCOMES,
  MEASURES,
  MEASURE_KINDS,
  NOTICE_LIMITS,
  OUTCOME_PHRASES,
  REPLY_AIM_HOURS,
  RETENTION,
  RETIRED_HANDLE_PREFIX,
  REVERSAL_KINDS,
  STANDING_RULES,
  SUSPECT_EARLIER_MONTHS,
  SUSPECT_OUTCOME_PHRASES,
  UNSEEN_NO_ACTION,
  type ItemOutcome,
  type MeasureKind,
} from "@korbat/contracts";
import { RULES, RULES_VERSION } from "@korbat/rules";
import { numberWord } from "./moderation-words";

/**
 * The terms shown at sign-up. TERMS_VERSION must equal the API's TERMS_VERSION setting; change both
 * together whenever the text changes, so every account records which version it accepted.
 */
export const TERMS_VERSION = "draft-2026-09";

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
  strike: "a mark on the account that restricts nothing by itself and counts toward a suspension, as Strikes says",
  suspend: "for a number of days the account can no longer post, engage, follow, edit its profile or report under the rules, as Suspension and termination says",
  terminate: "the account is suspended until the decision is final, and then deleted, as Suspension and termination says",
  retire_handle: "the handle can be used by nobody again, and the profile shows a placeholder in its place, as Handles says",
  warn_reporting: "a warning about reports that are manifestly unfounded, which restricts nothing, as Reporting in bad faith says",
  restrict_reporting: "for a number of days korbat takes no report under its rules from the account, as Reporting in bad faith says",
  // 3f: no decision of korbat's takes it; only an authority's order does, which the terms' sections on orders describe.
  disable_by_order: "the post and its images are shown to nobody, you included, because an authority ordered it",
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

const STRIKES = `When a moderator's final decision finds that a post of yours breaks a korbat rule, the decision also gives your account a strike. A strike restricts nothing by itself and is used for one thing: counting toward a suspension. It counts for ${count(S.strikeDays, "day")} from its decision. A decision gives no strike when it rests on the law alone, when it concerns child sexual abuse material (rule R2), when it is about your profile and not a post, or while korbat is still deciding. A post gets at most one strike, and a post you made before you were told of your newest strike gets none, so several posts decided in one sitting count as one warning. A strike also counts when the post was already removed or deleted. The decision's statement tells you of the strike, until when it counts and how many you have; your strikes are listed under Settings, Cases. A strike falls only with its decision: appeal that decision, and if it is reversed the strike stops counting at once, and a suspension that rested on it ends at once if fewer than ${numberWord(S.ladderStrikes)} of its strikes still stand. If that suspension was already over, it no longer counts toward a later one.`;

const SUSPENSION = paragraphs(
  `When your account has ${numberWord(S.ladderStrikes)} active strikes at once, a moderator may decide to suspend it: for at most ${count(FIRST_RUNG, "day")} the first time, ${numberWord(SECOND_RUNG)} the second and ${numberWord(THIRD_RUNG)} the third, counting the suspensions decided in the last ${count(S.ladderMemoryDays, "day")}. A moderator may choose fewer days, never more, and a moderator who chose fewer days still used that step. After a suspension, one further strike is enough for the next step while at least ${numberWord(S.ladderStrikes - 1)} earlier strikes still count. After ${numberWord(S.ladderDays.length)} such suspensions in that time, whatever their length, the next step may be the termination of the account, which only an admin decides. Nothing happens automatically: a moderator reads the strikes and decides. Such a decision finds no new breach: its ground is this section, and its statement says so and lists the strikes it rests on.`,
  `korbat tells you first. The decision is always shown in the app with its reasons, and korbat also sends it to you by email. The suspension starts ${count(S.replyWindowHours, "hour")} after korbat sent that email. If korbat's mail service refuses your address or cannot send the email for ${count(RETENTION.mailGiveUpDays, "day")}, only the app can tell you, and the suspension starts ${count(S.undeliveredHours, "hour")} after the decision. korbat cannot see whether an email it sent reached you, so keep the address of your account current. The app shows the start as a date and time. If you reply before the start, it does not start until a moderator has read your reply and answered you; the answer reverses the decision, or keeps it, and then the suspension starts with the answer and never before the time you were first given. A reply sent later is read and answered too, and can end the suspension, but does not pause it. You can reply once, and replying does not use up your appeal: when korbat keeps a decision after a reply you sent before the start, your ${count(APPEAL_MONTHS, "month")} to appeal count again from that answer.`,
  `korbat suspends an account at once, before any reply, only in four cases, each decided by an admin: after a final decision that a post of the account is a direct threat of violence (rule R5), for up to ${count(S.threatDays, "day")}; after a final decision that a post of the account is terrorist content, for up to ${count(S.terroristDays, "day")}; when an admin finds that the account is flooding korbat with repetitive, unsolicited posts (rule R6) and it made ${S.floodPosts} or more posts within ${count(S.floodMinutes, "minute")}, for up to ${count(S.floodDays, "day")}; and, as a protective suspension, when korbat keeps images of the account sealed after a report of child sexual abuse material, by a decision at most ${count(S.basisAgeDays, "day")} old, once for each such decision and for up to ${count(S.protectiveDays, "day")}. In the last case korbat's staff do not open the images, so korbat has not assessed them: the suspension is a protective measure and not a finding that you broke the law or a rule, it gives no strike, counts toward no later step, and ends on its date, or earlier if the seal is lifted. Its appeal is reviewed at once and does not wait for the authorities. In the first two cases the suspension ends at once if the decision it rests on is reversed. An announced suspension never rests on one of these four cases. You get the statement at once and can reply and appeal from the first minute; korbat aims to answer a reply to a suspension taken at once within ${count(REPLY_AIM_HOURS, "hour")}.`,
  "While suspended you cannot post, reply, quote, like, repost, bookmark, follow, edit your profile, change your handle, upload images, ask for the verified badge, or report under korbat's rules. You can still sign in and read, see your cases, reply to korbat, appeal, ask for a re-examination, export your data, delete your posts or your account, undo likes, reposts, bookmarks and follows, block and mute, and report illegal content. Your profile and posts stay visible, without any mark, and others can still follow you and react to your posts. Your posts do not appear in Explore while you are suspended, and your likes and reposts do not count there.",
  `A termination is decided after ${numberWord(S.ladderDays.length)} suspensions as described above, with the same time to reply, or at once after a direct threat of violence (rule R5) that you post within ${count(S.ladderMemoryDays, "day")} after korbat suspended your account for an earlier one, while that suspension and the decision it rests on still stand. A second post from before that suspension is no ground for it. Until the decision is final the account is suspended and nothing more. It is final when the ${count(APPEAL_MONTHS, "month")} for your appeal have passed unused, or when your appeal is answered and the decision kept; nothing is deleted while your appeal or a reply of yours is unanswered. korbat then deletes the account with its posts and profile and every image it has not sealed. Until then you can export your data and delete the account yourself; deleting it ends your appeal, since nothing is left to restore. After the deletion korbat keeps nothing to recognise a new account of yours by; images that korbat sealed stay with it for the authorities alone, as the decision that sealed them said.`,
  "Each of these decisions can be appealed from the moment you are told, as Appeals says; an appeal does not hold a start, only a reply does. One person may hold more than one account, but not to carry on with another account what one was suspended or terminated for: korbat treats that as the same conduct and decides about it like any other breach, on what the account does.",
);

const REPORTING_IN_BAD_FAITH = paragraphs(
  "Report what you believe breaks a rule; a report that turns out wrong costs you nothing. korbat acts only on reports that are manifestly unfounded: reports that anyone could see name nothing a rule could cover, without weighing them. Examples are many reports of the same account for posts that plainly break no rule, the same text sent against different posts, and a report sent again after it was answered. A moderator may mark such a report when deciding it. You see the mark on your list of reports together with the report's outcome, and you can ask for a re-examination. The mark stops counting if a re-examination finds a breach, and if korbat withdraws it because the report was arguable after all. korbat counts reports, not the posts or accounts a report names: a report counts once, by the day you sent it, however many of its items were marked, so no single report can lead to a warning.",
  `If at least ${numberWord(S.reportWarnMarks)} of the reports you sent under the rules within ${count(S.reportFrameDays, "day")} are marked, and they are at least ${share(S.reportWarnShare)} of the reports you sent under the rules in that time, a moderator may warn you: the warning lists the reports and restricts nothing. If ${numberWord(S.reportRestrictMarks)} of the reports you send after that warning are marked while it counts, which is ${count(S.reportFrameDays, "day")}, a moderator may stop taking your reports under the rules for up to ${count(S.reportRestrictDays, "day")}; the restriction ends at once if the warning is lifted. A person decides each step, looking at how many reports you sent, how many were marked and what they said; the count alone decides nothing. Notices of illegal content, reports of child sexual abuse material and requests for re-examination are never counted and never restricted. You can appeal the warning and the restriction.`,
);

const HANDLES = `When the breach lies in a handle itself (impersonation, someone's private information, a threat), a moderator may retire it. A retired handle can be used by nobody again, you included. Your profile then shows a placeholder that begins with ${RETIRED_HANDLE_PREFIX}, and you can choose a new handle without the usual wait: at once, or, while your account is suspended, when the suspension ends. If the decision is reversed, the retirement is lifted: your profile gets the handle back if it still shows the placeholder, and otherwise you can change back to it at once; nobody else could take it meanwhile. Handles that begin with ${RETIRED_HANDLE_PREFIX} cannot be chosen. korbat keeps a retired handle, as a handle and nothing else, for as long as it refuses it to everyone, also when the breach was someone's private information (rule R4): refusing it needs it.`;

export const TERMS_SECTIONS: { title: string; body: string }[] = [
  {
    title: "Draft",
    body: "These terms are a draft for testing korbat before launch. They will be replaced by reviewed terms and a privacy policy before korbat opens to the public.",
  },
  {
    title: "Who can use korbat",
    // 3e (W.7): what another account may not carry on, which "Suspension and termination" says.
    body: "You must be at least 16 years old. You can use a pseudonym. One person may hold more than one account, but not to carry on what another of their accounts was suspended or terminated for (Suspension and termination).",
  },
  // The 3c design's sentence (section 9), in place of "removed only when it breaks a published rule", which notices of illegality made false. The rules are named from the rulebook.
  {
    title: "What you can post",
    body: `You can post opinions, including unpopular ones. korbat restricts content only when it breaks a published rule (${RULES.map(ruleName).join(", ")}), or when it is illegal under EU law or the law of an EU country and someone tells korbat so in a notice. Every decision names the rule or the law and says why, and a final decision that restricts your content can be appealed as the section "Appeals" describes.`,
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
      "A person looks at every report about something that is on korbat. A link that names nothing korbat can show is answered automatically, and the answer says so. Moderators read reports in the order of their severity and then of their age, never by how many reports an item has, and by who sent them only under the emergency switch.",
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
      "A moderator, never a program, decides every case. A moderator never decides about their own accounts or about accounts close to them.",
      `Some decisions only an admin takes: every final decision, whether it acts or not, on a report or a moderator's finding under ${ADMIN_RULES} or on a report made on the anonymous path, every lifting of a seal, and every correction of such a decision. Until an admin decides, any moderator may at once hide a reported threat from other people, or seal reported images.`,
      "On the path for child sexual abuse material, a moderator and an admin decide without seeing the images, on the report and on what korbat can read. Nobody at korbat opens images that are reported or found as such material while the report is unanswered or the images are sealed; that covers the images of a post while such a report about it, or about its author's profile, is unanswered. After an admin has answered without a seal, staff may open them like any other image. Reports on other grounds about those images, corrections and appeals are meanwhile decided on what korbat can read, or wait. An admin's answer to such a report about a post also answers the earlier reports about that post, and whoever sent a report about a post that is answered without action while its images cannot be opened is told so and may ask again.",
      "A seal can cover every image on a profile's posts. It hides the images from everyone, their author included, from the first seal, and never hides a post's text. A report of this kind about a post that quotes another opens a case on the quoted post too.",
      `korbat's measures are these, and no others; each is named as a decision records it. While korbat decides a case: ${measureList(WHILE_DECIDING)}. When the case is decided: ${measureList(WHEN_DECIDED)}. While it decides or when the case is decided: ${measureList(EITHER)}. On an authority's order alone, never on korbat's own judgement: ${measureList(BY_ORDER)}. A later decision can lift each of them again: ${LIFTED}.`,
      "A reset is written once, and korbat does not put the old value back: you may set the field again, and what you set is judged on its own if someone reports it. korbat restricts the least it can: one image rather than the post, one field rather than the account. Every finding of a breach is recorded as a restriction of its own, also when the content was already not shown or already deleted; its statement then says that it changed nothing now.",
      "Every decision that restricts your content, also one that changes nothing anyone sees now, every decision that reverses one, every answer to your appeal, and every end or lifting of something korbat told you it did while deciding comes with a statement of reasons, in the app at once and by email. A decision to take no action is not sent to you, since it would tell you that someone reported you, unless it ends or lifts something korbat told you it did while deciding. Something korbat does while deciding about a post you had already deleted is recorded without being sent to you, since it can never take effect. Content restricted for being illegal is restricted everywhere, since korbat cannot restrict by country.",
    ),
  },
  {
    title: "Appeals",
    body: paragraphs(
      `If a final decision restricts your content or your account, you can appeal it once, while any of it is in force, within ${count(APPEAL_MONTHS, "month")} of being told, free of charge and with no form to follow: choose "Appeal" on the decision's screen under Settings, Cases. You can file at most ${count(DAILY_LIMITS.appeals, "appeal")} a day.`,
      "What korbat does while it decides cannot be appealed. It ends with the case's final decision, which is shown and sent to you and can be appealed when it restricts; a seal ends with an admin's answer to the reports it was taken on. A moderator may lift it earlier; a seal, only an admin.",
      "An appeal is reviewed by a moderator who made none of the case's decisions, including hiding the content while it was decided, did not report it, and has no link to anyone in the case. While korbat has no such moderator the appeal waits, without a time limit, and its screen says so: with one moderator every appeal waits, and with two every case both took part in, where one hid the content or reported it and the other decided it, which is how direct threats and images reported as child sexual abuse material are handled whenever the moderator on duty is not the admin.",
      "A review keeps the decision, lifts part of it or lifts all of it, and never adds to it. A decision reversed in full can no longer be appealed, since nothing of it remains. A decision that a correction changed in part can still be appealed for what remains of it; an answer to your appeal is final within korbat.",
      `korbat does not put back a display name or a bio it reset: set it again. The screen of the decision that reset it shows what it was while korbat keeps the case's copies, and for at least ${count(RETENTION.resetValueDays, "day")} after a reset that is lifted or ends before they are erased, unless korbat had already erased a value reset under ${R4}, as Your data says.`,
      "An appeal of a seal waits, without a time limit, for the assessment of the authority korbat reported the images to. Only an admin lifts a seal, and a seal for good only on that authority's answer that the images are not child sexual abuse material.",
      // 3e (W.7): what an appeal of a standing measure does and does not do.
      `An appeal never holds the start of a suspension; a reply does. When korbat keeps a decision in answer to a reply you sent before its start, the ${count(APPEAL_MONTHS, "month")} to appeal it count from that answer. The appeal of a protective suspension is reviewed at once; only the appeal of a decision that seals images waits for the authorities.`,
      COURTS,
    ),
  },
  // 3e's four sections (design, W.7), after the appeals they refer to.
  { title: "Strikes", body: STRIKES },
  { title: "Suspension and termination", body: SUSPENSION },
  { title: "Reporting in bad faith", body: REPORTING_IN_BAD_FAITH },
  { title: "Handles", body: HANDLES },
  // The policy Article 7(1) of Regulation (EU) 2021/784 asks for; its one hour is the Regulation's own figure.
  {
    title: "Terrorist content",
    body: "korbat removes terrorist content, as Article 2(7) of Regulation (EU) 2021/784 defines it, when it is told about it in a notice, and, once korbat is open to the public, complies with an authority's removal order within one hour. Material for educational, journalistic, artistic or research purposes, or for preventing or countering terrorism, and polemic or controversial views in public debate are not terrorist content (Article 1(3) of that Regulation). korbat uses no automated tool to find it.",
  },
  // The 2c design's sentence (section 2). It joins the draft without a new TERMS_VERSION, as 1b's and 1c's changes did before any public sign-up.
  {
    title: "Explore",
    body: "Public posts can appear in Explore, ranked by how many other accounts like or repost them; How Explore works gives the rules, and Settings > Privacy keeps your posts out.",
  },
  {
    title: "Your account",
    body: "You are responsible for keeping access to your email address. Turn on two-factor authentication and store your recovery codes; korbat cannot restore an account without them.",
  },
  {
    title: "Your data",
    body: paragraphs(
      "korbat stores your email address for sign-in and security messages, and never shows it to other people. IP addresses are stored only as keyed hashes, and a device keeps its hash for 30 days after it was last seen. Your date of birth is checked once and never stored. Your browser keeps a random device id so korbat can tell a new device from a known one; it is shared by every account used in that browser and is stored on the server only as a keyed hash. At sign-in, and when you send a report without being signed in, Cloudflare Turnstile checks that you are not a bot; it sees your IP address and browser details for that check, under Cloudflare's privacy policy. If you ask for the Verified badge, your phone number is handed to the verification provider for one text message, and korbat keeps only a keyed hash of it. From the Account settings you can export your account's data as a ZIP archive and delete your account; deletion removes your posts, keeps your handle reserved and cannot be undone. If you add a passkey, korbat keeps its public key, a name, the dates it was added and last used, and the device that added it; nothing about your fingerprint or face leaves your device.",
      // What 3c adds, with the periods of RETENTION (3c design, section 6.6).
      `When someone reports a post or a profile, korbat keeps a copy of its text and holds its images, whatever it then decides. Deleting the post or your account leaves these copies until their period ends. A case's copies are erased when the case closes, or ${count(RETENTION.evidenceHours, "hour")} after its newest copy if that is later, unless a restriction of the case can still be appealed or, for a post, a report that only an admin can answer still waits or its images are sealed.`,
      "For a report of child sexual abuse material, korbat keeps the images of the reported post, of the post it quotes, or of all a profile's posts until an admin has answered the report, also when their author deletes the post or the account meanwhile; once their post is deleted they are shown to nobody. Images an admin then keeps sealed are kept for the authorities, with korbat's copies of their post's text; they are left out of your account's export and are not released by korbat on its own.",
      `Content korbat removes or resets under ${R4}, a post's text, an image, a display name or a bio, is erased for good, as far as that decision still stands, once it can no longer be appealed, ${count(RETENTION.r4FinalMonths, "month")} after you were told, or once your appeal against it is answered; for a post, later only while a report that only an admin can answer still waits or while its images are sealed. It is erased from your own view, your export and the decision's screen, and from every copy korbat keeps but its backups (an image once no other case still holds it), also when you had deleted the post, so a later reversal cannot bring it back or show it to you again.`,
      `korbat's backups of its database and its images hold everything as it stood when each was taken, what korbat erased since included. Each is deleted ${count(RETENTION.backupDays, "day")} after it was taken, except a backup that korbat must keep for the authorities, which it keeps until they have answered.`,
      `A notifier's name and email are kept apart from the case, never shown to staff or to the person reported, and deleted ${count(RETENTION.contactMonths, "month")} after the last day korbat still owed the report a decision or an email, or ${count(RETENTION.contactMaxMonths, "month")} after the report if nothing moved that day. That an email address was confirmed as a sender's is kept for ${count(RETENTION.confirmationDays, "day")}.`,
      `Staff see a reporter or a notifier as a summary: roughly how old the account is, how many reports it sent, what share were acted on and how many were answered while their images could not be opened, in broad bands, never exact numbers. A moderator sees a reporter's handle or a notifier's name only when a case needs it, for example a claim of impersonation or abuse of reporting, each time with a recorded reason that is shown to every staff member; the person reported never sees either. korbat forgets which account sent a report ${count(RETENTION.intakeDays, "day")} after its last outcome was given and settled, which is at most about ${count(APPEAL_MONTHS + Math.ceil(RETENTION.intakeDays / 30), "month")} after a decision to take no action, while it can still be re-examined, except through the mark of a report found manifestly unfounded (Reporting in bad faith).`,
      `On a report of child sexual abuse material, staff see how many such reports about the same post, profile or author an admin answered without a seal in the last ${count(SUSPECT_EARLIER_MONTHS, "month")}, as a number and a day.`,
      `The reasons korbat gave you for a decision are kept while your account exists and for ${count(RETENTION.statementMonths, "month")} after its deletion; the decision itself stays on record without them. korbat's log of which staff member opened a case, viewed an image or was shown who sent a report, with the reason given for that, is kept for ${count(RETENTION.accessLogMonths, "month")}. A text a moderator wrote for a decision and did not confirm is deleted after ${count(RETENTION.draftHours, "hour")}.`,
      // 3e (W.7): what korbat keeps of account sanctions, with RETENTION's three members.
      `korbat keeps the record of every strike, suspension, termination, warning and retired handle with its decision, as it keeps every decision. What ends is its use: a strike counts for ${count(RETENTION.standingRecord.strikeDays, "day")}, a suspension counts toward the next one for ${count(RETENTION.standingRecord.ladderMemoryDays, "day")}, a warning about reporting for ${count(RETENTION.standingRecord.warningDays, "day")}. The text of a reply to a suspension is kept ${RETENTION.replyText}; a reply that is not answered yet is never erased. To decide about reporting in bad faith korbat counts, for each account and day, how many reports under its rules the account sent, and keeps which of them a moderator marked manifestly unfounded; both are deleted after ${count(RETENTION.reportCountDays, "day")} and with the account, so for that long a marked report stays linked to the account that sent it. A retired handle is kept as a handle (Handles). Your export holds all of this.`,
      "Your account's export holds the decisions its Cases screens list and your own reports. If you ask for your data at the address under Contact, you receive, within a month, every case about you (cases without action included), the copies korbat keeps, where each case came from (a report by another user, a notice, a moderator) and, where the law requires it after weighing the writer's rights, the words of a report without who wrote it.",
    ),
  },
];
