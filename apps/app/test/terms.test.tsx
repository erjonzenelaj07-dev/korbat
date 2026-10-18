import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, test, vi } from "vitest";
import * as contracts from "@korbat/contracts";
import * as rules from "@korbat/rules";

// The build's contact address, which Expo inlines at export time; set before the app's modules read it.
const CONTACT = vi.hoisted(() => {
  process.env.EXPO_PUBLIC_CONTACT_EMAIL = "contact@korbat.local";
  return "contact@korbat.local";
});

import Terms from "../src/app/terms";
import { CONTACT_WORDS, numberWord } from "../src/lib/moderation-words";
import * as terms from "../src/lib/terms";

/**
 * The terms' moderation sections (3c design, sections 9 and 12): what the terms page gains and changes, and the table
 * tests that hold every number and every rule's text the terms print to its constant. A number is held twice: its
 * sentence is in the terms with the constant's value, and with other values in the constants the terms print those and
 * not one of the old ones, so no number is typed. The rulebook, the measures' labels and the outcomes' phrases are held
 * the same way. 3e (design, W.7) adds four sections, "Strikes", "Suspension and termination", "Reporting in bad faith" and
 * "Handles", whose numbers are STANDING_RULES', REPLY_AIM_HOURS', RETENTION.mailGiveUpDays' and APPEAL_MONTHS', and grows
 * RETENTION by three members: two numbers and one phrase, which the terms print as they print a rule's text.
 */
vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
}));

type Contracts = typeof contracts;
type Rules = typeof rules;
type TermsModule = typeof terms;
type Section = { title: string; body: string };

const html = (element: ReactElement): string => renderToStaticMarkup(element);
/** The markup's text as a reader sees it: tags dropped, entities read, spaces collapsed. */
const textOf = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** The sections 3c and 3e wrote or rewrote whole; of "Your data" they wrote every paragraph after the first, which older designs wrote. */
const MODERATION_TITLES = ["What you can post", "The rules", "Reports and notices", "How moderators decide", "Appeals", "Strikes", "Suspension and termination", "Reporting in bad faith", "Handles", "Terrorist content"];
const bodyOf = (t: TermsModule, title: string): string => t.TERMS_SECTIONS.find((section: Section) => section.title === title)?.body ?? "";
const paragraphsOf = (t: TermsModule, title: string): string[] => t.termsParagraphs(bodyOf(t, title));
/** What 3c added to "Your data". */
const dataParagraphs = (t: TermsModule): string[] => paragraphsOf(t, "Your data").slice(1);
/** The terms' moderation text, section by section: the name of the section each sentence is looked for in, and its text. */
const moderationText = (t: TermsModule): Record<string, string> => ({ ...Object.fromEntries(MODERATION_TITLES.map((title) => [title, bodyOf(t, title)])), "Your data": dataParagraphs(t).join(" ") });

/** A count as the terms print it: a small number as a word, and its noun in the singular or the plural. */
const count = (n: number, one: string): string => `${numberWord(n)} ${n === 1 ? one : `${one}s`}`;
/** A share as the terms print it: half as a word, any other as a percentage. */
const share = (fraction: number): string => (fraction === 0.5 ? "half" : `${fraction * 100} percent`);

/**
 * The table of numbers: every number of the constants the terms print, with the section and the sentence it stands in.
 * Built from whatever constants it is given, so the same table reads the terms as they are and the terms as they come out
 * with other numbers in the constants.
 */
function numbersTable(c: Contracts): { constant: string; section: string; phrase: string }[] {
  const { NOTICE_LIMITS: L, RETENTION: R, DAILY_LIMITS: D, STANDING_RULES: S } = c;
  return [
    { constant: "NOTICE_LIMITS.signedOut.perHour", section: "Reports and notices", phrase: `at most ${L.signedOut.perHour} reports an hour and` },
    { constant: "NOTICE_LIMITS.signedOut.perDay", section: "Reports and notices", phrase: `and ${L.signedOut.perDay} a day from one network without an account` },
    { constant: "NOTICE_LIMITS.signedIn.perHour", section: "Reports and notices", phrase: `and ${L.signedIn.perHour} an hour and` },
    { constant: "NOTICE_LIMITS.signedIn.perDay", section: "Reports and notices", phrase: `${L.signedIn.perDay} a day from one account` },
    { constant: "NOTICE_LIMITS.maxTargets", section: "Reports and notices", phrase: `up to ${numberWord(L.maxTargets)} posts or profiles on korbat` },
    { constant: "NOTICE_LIMITS.explanationMax", section: "Reports and notices", phrase: `up to ${L.explanationMax} characters long` },
    { constant: "NOTICE_LIMITS.citedLawMax", section: "Reports and notices", phrase: `the law or country you cite up to ${L.citedLawMax}` },
    { constant: "CSAM_NOTICE_MAX_ACCOUNTS", section: "Reports and notices", phrase: `one report can name ${count(c.CSAM_NOTICE_MAX_ACCOUNTS, "profile")} at most` },
    { constant: "APPEAL_MONTHS", section: "Reports and notices", phrase: `once for a re-examination, within ${count(c.APPEAL_MONTHS, "month")} of being told` },
    { constant: "APPEAL_MONTHS", section: "Appeals", phrase: `within ${count(c.APPEAL_MONTHS, "month")} of being told, free of charge and with no form to follow` },
    { constant: "DAILY_LIMITS.reexaminations", section: "Reports and notices", phrase: `at most ${count(D.reexaminations, "re-examination")} a day` },
    { constant: "DAILY_LIMITS.appeals", section: "Appeals", phrase: `at most ${count(D.appeals, "appeal")} a day` },
    { constant: "SUSPECT_EARLIER_MONTHS", section: "Your data", phrase: `in the last ${count(c.SUSPECT_EARLIER_MONTHS, "month")}` },
    { constant: "RETENTION.r4FinalMonths", section: "Your data", phrase: `${count(R.r4FinalMonths, "month")} after you were told` },
    { constant: "RETENTION.intakeDays", section: "Your data", phrase: `${count(R.intakeDays, "day")} after its last outcome was given and settled` },
    // The same period seen from a decision to take no action: the months of the re-examination's window, and these days.
    { constant: "RETENTION.intakeDays", section: "Your data", phrase: `at most about ${count(c.APPEAL_MONTHS + Math.ceil(R.intakeDays / 30), "month")} after a decision to take no action` },
    { constant: "RETENTION.resetValueDays", section: "Appeals", phrase: `for at least ${count(R.resetValueDays, "day")} after a reset that is lifted or ends` },
    { constant: "RETENTION.evidenceHours", section: "Your data", phrase: `when the case closes, or ${count(R.evidenceHours, "hour")} after its newest copy if that is later` },
    { constant: "RETENTION.statementMonths", section: "Your data", phrase: `for ${count(R.statementMonths, "month")} after its deletion` },
    { constant: "RETENTION.accessLogMonths", section: "Your data", phrase: `is kept for ${count(R.accessLogMonths, "month")}` },
    { constant: "RETENTION.contactMonths", section: "Your data", phrase: `deleted ${count(R.contactMonths, "month")} after the last day korbat still owed` },
    { constant: "RETENTION.contactMaxMonths", section: "Your data", phrase: `or ${count(R.contactMaxMonths, "month")} after the report if nothing moved that day` },
    { constant: "RETENTION.confirmationDays", section: "Reports and notices", phrase: `not been confirmed as its sender's in the last ${count(R.confirmationDays, "day")}` },
    { constant: "RETENTION.confirmationDays", section: "Your data", phrase: `is kept for ${count(R.confirmationDays, "day")}` },
    { constant: "RETENTION.backupDays", section: "Your data", phrase: `deleted ${count(R.backupDays, "day")} after it was taken` },
    { constant: "RETENTION.draftHours", section: "Your data", phrase: `is deleted after ${count(R.draftHours, "hour")}` },
    { constant: "RETENTION.mailGiveUpDays", section: "Reports and notices", phrase: `could not send for ${count(R.mailGiveUpDays, "day")}` },
    // 3e (W.7): the four sections, each number from the constant the code that acts on it reads.
    { constant: "STANDING_RULES.strikeDays", section: "Strikes", phrase: `It counts for ${count(S.strikeDays, "day")} from its decision.` },
    { constant: "STANDING_RULES.ladderStrikes", section: "Strikes", phrase: `ends at once if fewer than ${numberWord(S.ladderStrikes)} of its strikes still stand` },
    { constant: "STANDING_RULES.ladderStrikes", section: "Suspension and termination", phrase: `When your account has ${numberWord(S.ladderStrikes)} active strikes at once` },
    { constant: "STANDING_RULES.ladderStrikes", section: "Suspension and termination", phrase: `while at least ${numberWord(S.ladderStrikes - 1)} earlier strikes still count` },
    ...([0, 1, 2] as const).map((rung) => ({
      constant: `STANDING_RULES.ladderDays.${rung}`,
      section: "Suspension and termination",
      phrase: `for at most ${count(S.ladderDays[0], "day")} the first time, ${numberWord(S.ladderDays[1])} the second and ${numberWord(S.ladderDays[2])} the third`,
    })),
    { constant: "STANDING_RULES.ladderMemoryDays", section: "Suspension and termination", phrase: `counting the suspensions decided in the last ${count(S.ladderMemoryDays, "day")}` },
    { constant: "STANDING_RULES.ladderMemoryDays", section: "Suspension and termination", phrase: `that you post within ${count(S.ladderMemoryDays, "day")} after korbat suspended your account` },
    { constant: "STANDING_RULES.replyWindowHours", section: "Suspension and termination", phrase: `The suspension starts ${count(S.replyWindowHours, "hour")} after korbat sent that email.` },
    { constant: "STANDING_RULES.undeliveredHours", section: "Suspension and termination", phrase: `the suspension starts ${count(S.undeliveredHours, "hour")} after the decision` },
    { constant: "STANDING_RULES.threatDays", section: "Suspension and termination", phrase: `a direct threat of violence (rule R5), for up to ${count(S.threatDays, "day")};` },
    { constant: "STANDING_RULES.terroristDays", section: "Suspension and termination", phrase: `is terrorist content, for up to ${count(S.terroristDays, "day")};` },
    { constant: "STANDING_RULES.floodPosts", section: "Suspension and termination", phrase: `it made ${S.floodPosts} or more posts within` },
    { constant: "STANDING_RULES.floodMinutes", section: "Suspension and termination", phrase: `or more posts within ${count(S.floodMinutes, "minute")}, for up to` },
    { constant: "STANDING_RULES.floodDays", section: "Suspension and termination", phrase: `minutes, for up to ${count(S.floodDays, "day")}; and, as a protective suspension` },
    { constant: "STANDING_RULES.basisAgeDays", section: "Suspension and termination", phrase: `by a decision at most ${count(S.basisAgeDays, "day")} old` },
    { constant: "STANDING_RULES.protectiveDays", section: "Suspension and termination", phrase: `once for each such decision and for up to ${count(S.protectiveDays, "day")}.` },
    { constant: "REPLY_AIM_HOURS", section: "Suspension and termination", phrase: `korbat aims to answer a reply to a suspension taken at once within ${count(c.REPLY_AIM_HOURS, "hour")}.` },
    { constant: "RETENTION.mailGiveUpDays", section: "Suspension and termination", phrase: `cannot send the email for ${count(R.mailGiveUpDays, "day")}, only the app can tell you` },
    { constant: "APPEAL_MONTHS", section: "Suspension and termination", phrase: `your ${count(c.APPEAL_MONTHS, "month")} to appeal count again from that answer` },
    { constant: "APPEAL_MONTHS", section: "Suspension and termination", phrase: `It is final when the ${count(c.APPEAL_MONTHS, "month")} for your appeal have passed unused` },
    { constant: "APPEAL_MONTHS", section: "Appeals", phrase: `the ${count(c.APPEAL_MONTHS, "month")} to appeal it count from that answer` },
    { constant: "STANDING_RULES.reportWarnMarks", section: "Reporting in bad faith", phrase: `If at least ${numberWord(S.reportWarnMarks)} of the reports you sent under the rules` },
    { constant: "STANDING_RULES.reportFrameDays", section: "Reporting in bad faith", phrase: `you sent under the rules within ${count(S.reportFrameDays, "day")} are marked` },
    { constant: "STANDING_RULES.reportFrameDays", section: "Reporting in bad faith", phrase: `while it counts, which is ${count(S.reportFrameDays, "day")},` },
    { constant: "STANDING_RULES.reportWarnShare", section: "Reporting in bad faith", phrase: `they are at least ${share(S.reportWarnShare)} of the reports you sent under the rules in that time` },
    { constant: "STANDING_RULES.reportRestrictMarks", section: "Reporting in bad faith", phrase: `If ${numberWord(S.reportRestrictMarks)} of the reports you send after that warning are marked` },
    { constant: "STANDING_RULES.reportRestrictDays", section: "Reporting in bad faith", phrase: `for up to ${count(S.reportRestrictDays, "day")}; the restriction ends at once if the warning is lifted` },
    // "Your data": what 3e keeps, by RETENTION's three new members (two of them numbers read from STANDING_RULES).
    { constant: "RETENTION.standingRecord.strikeDays", section: "Your data", phrase: `a strike counts for ${count(R.standingRecord.strikeDays, "day")}` },
    { constant: "RETENTION.standingRecord.ladderMemoryDays", section: "Your data", phrase: `a suspension counts toward the next one for ${count(R.standingRecord.ladderMemoryDays, "day")}` },
    { constant: "RETENTION.standingRecord.warningDays", section: "Your data", phrase: `a warning about reporting for ${count(R.standingRecord.warningDays, "day")}` },
    { constant: "RETENTION.reportCountDays", section: "Your data", phrase: `both are deleted after ${count(R.reportCountDays, "day")} and with the account` },
  ];
}

/** The path of every number in a value, as the table names it. */
function numberPaths(name: string, value: unknown): string[] {
  if (typeof value === "number") return [name];
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, member]) => numberPaths(`${name}.${key}`, member));
}
/** Every number of the constants the terms must print, by its path. */
const constantPaths = (c: Contracts): string[] => [
  ...numberPaths("NOTICE_LIMITS", c.NOTICE_LIMITS),
  ...numberPaths("CSAM_NOTICE_MAX_ACCOUNTS", c.CSAM_NOTICE_MAX_ACCOUNTS),
  ...numberPaths("SUSPECT_EARLIER_MONTHS", c.SUSPECT_EARLIER_MONTHS),
  ...numberPaths("APPEAL_MONTHS", c.APPEAL_MONTHS),
  ...numberPaths("DAILY_LIMITS", c.DAILY_LIMITS),
  ...numberPaths("RETENTION", c.RETENTION),
  ...numberPaths("STANDING_RULES", c.STANDING_RULES),
  ...numberPaths("REPLY_AIM_HOURS", c.REPLY_AIM_HOURS),
];

/** A rule's name inside a sentence: its title without the leading "No". */
const ruleName = (rule: { title: string }): string => rule.title.replace(/^No /, "");
/** A list in a sentence: "a", "a or b", "a, b or c". */
const orList = (items: readonly string[]): string => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`);
/** An outcome's phrase as the terms quote it: the rule's number and title are named, not filled in. */
const quoted = (phrase: string): string => phrase.replace("{rule}", "[number]").replace("{title}", "[title]");
/** The phrases an answer to a report can read: the seven outcomes, and the three that stand in for them where nobody opened the images. */
const outcomePhrases = (c: Contracts): string[] => [...c.ITEM_OUTCOMES.map((outcome) => c.OUTCOME_PHRASES[outcome]), c.SUSPECT_OUTCOME_PHRASES.sealed, c.SUSPECT_OUTCOME_PHRASES.no_action, c.UNSEEN_NO_ACTION];

/** The sentence of the measures' paragraph that begins with these words, up to its full stop. */
function measuresSentence(t: TermsModule, lead: string): string {
  const paragraph = paragraphsOf(t, "How moderators decide").find((text) => text.includes("korbat's measures are these"));
  if (!paragraph) throw new Error("the terms have no paragraph of measures");
  const from = paragraph.indexOf(lead);
  if (from === -1) throw new Error(`the measures' paragraph has no sentence that begins "${lead}"`);
  return paragraph.slice(from, paragraph.indexOf(".", from) + 1);
}
const LEADS = {
  interim: "While korbat decides a case:",
  final: "When the case is decided:",
  either: "While it decides or when the case is decided:",
  // 3f Task 3: the measure an authority's order alone takes.
  byOrder: "On an authority's order alone, never on korbat's own judgement:",
  lifted: "A later decision can lift each of them again:",
};
/** The labels a sentence of the measures' paragraph quotes, in order. */
const labelsIn = (sentence: string): string[] => [...sentence.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);

/** What the tables below hold of the terms, read with the constants and the rulebook they were built from. */
function holds(t: TermsModule, c: Contracts, r: Rules): void {
  const text = moderationText(t);
  // Every number, in its sentence.
  for (const row of numbersTable(c)) expect(text[row.section], `${row.constant}: "${row.phrase}" in ${row.section}`).toContain(row.phrase);
  // Every rule, by its name in "What you can post" and with its number, title and text in "The rules".
  expect(text["What you can post"]).toContain(`(${r.RULES.map(ruleName).join(", ")})`);
  expect(paragraphsOf(t, "The rules").slice(1)).toEqual(r.RULES.map((rule) => `${rule.id}. ${rule.title}. ${rule.text}`));
  expect(paragraphsOf(t, "The rules")[0]).toContain(`version ${r.RULES_VERSION} of its rulebook`);
  // The rules only an admin decides, and the one whose content is erased, are named from the rulebook.
  expect(text["How moderators decide"]).toContain(`under ${orList(r.RULES.filter((rule) => rule.seniorQueue).map((rule) => rule.id))} or on a report made on the anonymous path`);
  const r4 = r.RULES.find((rule) => rule.id === "R4")!;
  expect(text["Your data"]).toContain(`under rule R4 (${ruleName(r4)})`);
  expect(text["Appeals"]).toContain(`under rule R4 (${ruleName(r4)})`);
  // Every measure's label, in the sentence its two marks put it in; every reversal's in the last one.
  const kinds = { interim: c.MEASURE_KINDS.filter((kind) => c.MEASURES[kind].interim && !c.MEASURES[kind].final), final: c.MEASURE_KINDS.filter((kind) => !c.MEASURES[kind].interim && c.MEASURES[kind].final), either: c.MEASURE_KINDS.filter((kind) => c.MEASURES[kind].interim && c.MEASURES[kind].final) };
  for (const group of ["interim", "final", "either"] as const) expect(labelsIn(measuresSentence(t, LEADS[group])), group).toEqual(kinds[group].map((kind) => c.MEASURES[kind].label));
  expect(labelsIn(measuresSentence(t, LEADS.lifted))).toEqual(c.REVERSAL_KINDS.map((kind) => c.MEASURES[kind].label));
  // Every outcome's phrase, each in a paragraph of its own that says what it means.
  const answers = paragraphsOf(t, "Reports and notices").filter((paragraph) => paragraph.startsWith('"'));
  expect(answers.map((paragraph) => paragraph.slice(1, paragraph.indexOf('": ')))).toEqual(outcomePhrases(c).map(quoted));
  for (const paragraph of answers) expect(paragraph.slice(paragraph.indexOf('": ') + 3).length, paragraph).toBeGreaterThan(40);
  // 3e: the scope phrases of an answer that a measure on an account gave, the placeholder's prefix, and a reply's period.
  expect(text["Reports and notices"]).toContain(`the answer adds "${c.ACCOUNT_MEASURE_SCOPE.measure}", or "${c.ACCOUNT_MEASURE_SCOPE.retired}" when it retired the handle.`);
  expect(text["Handles"]).toContain(`Your profile then shows a placeholder that begins with ${c.RETIRED_HANDLE_PREFIX},`);
  expect(text["Handles"]).toContain(`Handles that begin with ${c.RETIRED_HANDLE_PREFIX} cannot be chosen.`);
  expect(text["Your data"]).toContain(`The text of a reply to a suspension is kept ${c.RETENTION.replyText}; a reply that is not answered yet is never erased.`);
}

describe("the terms' sections", () => {
  test("are these, in this order, under the draft's version: 3c adds five and rewrites two, 3e adds four after Appeals, without a new version", () => {
    expect(terms.TERMS_SECTIONS.map((section) => section.title)).toEqual([
      "Draft",
      "Who can use korbat",
      "What you can post",
      "The rules",
      "Reports and notices",
      "How moderators decide",
      "Appeals",
      "Strikes",
      "Suspension and termination",
      "Reporting in bad faith",
      "Handles",
      "Terrorist content",
      "Explore",
      "Your account",
      "Your data",
    ]);
    expect(terms.TERMS_VERSION).toBe("draft-2026-09");
    // Contact is the page's, built from the build's address, and no section of the terms.
    expect(terms.TERMS_SECTIONS.map((section) => section.title)).not.toContain("Contact");
  });

  test("a section's body is its paragraphs, a blank line between two; none is empty or holds a line break of its own", () => {
    const blank = String.fromCharCode(10, 10);
    for (const section of terms.TERMS_SECTIONS) {
      const paragraphs = terms.termsParagraphs(section.body);
      expect(paragraphs.join(blank), section.title).toBe(section.body);
      for (const paragraph of paragraphs) {
        expect(paragraph.trim(), section.title).toBe(paragraph);
        expect(paragraph.length, section.title).toBeGreaterThan(0);
        expect(paragraph.includes(String.fromCharCode(10)), section.title).toBe(false);
      }
    }
    // The sections older designs wrote are one paragraph each, as they were.
    for (const title of ["Draft", "Who can use korbat", "Explore", "Your account"]) expect(paragraphsOf(terms, title), title).toHaveLength(1);
  });

  test("What you can post says when korbat restricts content: a published rule, each named from the rulebook, or the law and a notice; and that a final restriction can be appealed", () => {
    const names = rules.RULES.map(ruleName).join(", ");
    expect(names).toBe("sexual or pornographic content, child sexual abuse material, targeted hatred or harassment based on protected traits, doxxing, direct threats of violence, spam, scams, impersonation or coordinated manipulation");
    expect(bodyOf(terms, "What you can post")).toBe(
      `You can post opinions, including unpopular ones. korbat restricts content only when it breaks a published rule (${names}), or when it is illegal under EU law or the law of an EU country and someone tells korbat so in a notice. Every decision names the rule or the law and says why, and a final decision that restricts your content can be appealed as the section "Appeals" describes.`,
    );
    // The sentence 3c's code made false is gone from every section.
    for (const section of terms.TERMS_SECTIONS) {
      expect(section.body, section.title).not.toContain("Content is removed only when it breaks a published rule");
      expect(section.body, section.title).not.toContain("Every removal names the rule, and you can appeal it");
    }
  });

  test("Terrorist content is the policy the Regulation asks for, in the design's words", () => {
    expect(bodyOf(terms, "Terrorist content")).toBe(
      "korbat removes terrorist content, as Article 2(7) of Regulation (EU) 2021/784 defines it, when it is told about it in a notice, and, once korbat is open to the public, complies with an authority's removal order within one hour. Material for educational, journalistic, artistic or research purposes, or for preventing or countering terrorism, and polemic or controversial views in public debate are not terrorist content (Article 1(3) of that Regulation). korbat uses no automated tool to find it.",
    );
  });

  test("Your data keeps what it said and gains 3c's paragraphs; the human check is named for a report sent signed out too", () => {
    const [first, ...added] = paragraphsOf(terms, "Your data");
    expect(first).toContain("At sign-in, and when you send a report without being signed in, Cloudflare Turnstile checks that you are not a bot; it sees your IP address and browser details for that check, under Cloudflare's privacy policy.");
    expect(first).not.toContain("At sign-in, Cloudflare Turnstile");
    // What 1a to 2c wrote there still stands.
    for (const kept of ["korbat stores your email address for sign-in and security messages", "a device keeps its hash for 30 days after it was last seen", "If you add a passkey, korbat keeps its public key", "you can export your account's data as a ZIP archive and delete your account"]) expect(first, kept).toContain(kept);
    expect(added.length).toBeGreaterThanOrEqual(8);
    const all = added.join(" ");
    for (const said of [
      "When someone reports a post or a profile, korbat keeps a copy of its text and holds its images, whatever it then decides.",
      "Deleting the post or your account leaves these copies until their period ends.",
      "they are left out of your account's export and are not released by korbat on its own",
      "so a later reversal cannot bring it back or show it to you again",
      "what korbat erased since included",
      "except a backup that korbat must keep for the authorities, which it keeps until they have answered",
      "never shown to staff or to the person reported",
      "in broad bands, never exact numbers",
      "the person reported never sees either",
      "as a number and a day",
      "Your account's export holds the decisions its Cases screens list and your own reports.",
      "where the law requires it after weighing the writer's rights, the words of a report without who wrote it",
    ]) expect(all, said).toContain(said);
  });

  test("the three sections of the procedure say what the design has them state", () => {
    const said: Record<string, string[]> = {
      "Reports and notices": [
        "Anyone can report a post, an image or a profile on korbat, signed in or not",
        "A report about a profile is decided on its display name and bio",
        "A report about a post that quotes another is decided on that post's own text and images",
        "korbat does not record who sent the report, not even an account, asks for no name and no email, and sends no email",
        "a report about a profile covers the images on all the profile's posts, a report about a post that quotes another covers both posts",
        "your name and your email are optional",
        "Reports are anonymous towards the person you report",
        "A person looks at every report about something that is on korbat.",
        "A link that names nothing korbat can show is answered automatically, and the answer says so.",
        "never by how many reports an item has, and by who sent them only under the emergency switch",
        "A report is never read after a less severe one, and every report is still read and answered.",
        "gets at most one receipt a day; the others come with the next daily email",
        "korbat sends no report email to an address whose holder asked it to stop",
        "korbat asks another moderator than the one who decided to take it when it has one",
        "says so and can be asked again",
        'this is what "illegality not evident" means',
        "An outcome changed on review or by a correction is final within korbat, and everyone whose report it answered is told.",
        "For a notice that something is illegal, korbat sends its decisions by email once a day when you gave an email or sent it from an account. Every decision on a report is shown under Settings, Cases, Your reports, or on the report's own page.",
      ],
      "How moderators decide": [
        "A moderator, never a program, decides every case.",
        "A moderator never decides about their own accounts or about accounts close to them.",
        "every lifting of a seal, and every correction of such a decision",
        "a moderator and an admin decide without seeing the images, on the report and on what korbat can read",
        "Nobody at korbat opens images that are reported or found as such material while the report is unanswered or the images are sealed",
        "After an admin has answered without a seal, staff may open them like any other image.",
        "It hides the images from everyone, their author included, from the first seal, and never hides a post's text.",
        "A report of this kind about a post that quotes another opens a case on the quoted post too.",
        "korbat does not put the old value back",
        "korbat restricts the least it can: one image rather than the post, one field rather than the account.",
        "its statement then says that it changed nothing now",
        "comes with a statement of reasons, in the app at once and by email",
        "A decision to take no action is not sent to you, since it would tell you that someone reported you",
        "is recorded without being sent to you, since it can never take effect",
        "Content restricted for being illegal is restricted everywhere, since korbat cannot restrict by country.",
      ],
      Appeals: [
        "you can appeal it once, while any of it is in force",
        'choose "Appeal" on the decision\'s screen under Settings, Cases',
        "What korbat does while it decides cannot be appealed.",
        "a seal ends with an admin's answer to the reports it was taken on",
        "made none of the case's decisions, including hiding the content while it was decided, did not report it, and has no link to anyone in the case",
        "the appeal waits, without a time limit, and its screen says so",
        "A review keeps the decision, lifts part of it or lifts all of it, and never adds to it.",
        "A decision reversed in full can no longer be appealed, since nothing of it remains.",
        "A decision that a correction changed in part can still be appealed for what remains of it; an answer to your appeal is final within korbat.",
        "An appeal of a seal waits, without a time limit, for the assessment of the authority korbat reported the images to.",
        "You can also go to court, or complain to the Digital Services Coordinator of the EU country where you live.",
      ],
    };
    for (const [title, sentences] of Object.entries(said)) for (const sentence of sentences) expect(bodyOf(terms, title), `${title}: ${sentence}`).toContain(sentence);
    // What the code does not do is not said: a decision a correction changed in part is still open to appeal, a report on a
    // rule gets no mail, and a case's copies are not kept a day past the close of a case that took longer than a day.
    expect(bodyOf(terms, "Appeals")).not.toContain("by a correction is final within korbat");
    expect(bodyOf(terms, "Reports and notices")).not.toContain("korbat sends its decisions on reports by email once a day");
    expect(bodyOf(terms, "Your data")).not.toContain("after the case closes");
  });
});

describe("3e's sections and sentences (design, W.7)", () => {
  test("Who can use korbat names what another account may not carry on, and points to the section that says it", () => {
    expect(bodyOf(terms, "Who can use korbat")).toBe(
      "You must be at least 16 years old. You can use a pseudonym. One person may hold more than one account, but not to carry on what another of their accounts was suspended or terminated for (Suspension and termination).",
    );
    expect(bodyOf(terms, "Who can use korbat")).not.toContain("to evade a suspension");
  });

  test("the four sections hold the design's paragraphs and sentences", () => {
    expect(paragraphsOf(terms, "Strikes")).toHaveLength(1);
    expect(paragraphsOf(terms, "Suspension and termination")).toHaveLength(6);
    expect(paragraphsOf(terms, "Reporting in bad faith")).toHaveLength(2);
    expect(paragraphsOf(terms, "Handles")).toHaveLength(1);
    const said: Record<string, string[]> = {
      Strikes: [
        "When a moderator's final decision finds that a post of yours breaks a korbat rule, the decision also gives your account a strike.",
        "A strike restricts nothing by itself and is used for one thing: counting toward a suspension.",
        "A decision gives no strike when it rests on the law alone, when it concerns child sexual abuse material (rule R2), when it is about your profile and not a post, or while korbat is still deciding.",
        "so several posts decided in one sitting count as one warning",
        "A strike also counts when the post was already removed or deleted.",
        "your strikes are listed under Settings, Cases",
        "If that suspension was already over, it no longer counts toward a later one.",
      ],
      "Suspension and termination": [
        "A moderator may choose fewer days, never more, and a moderator who chose fewer days still used that step.",
        "After three such suspensions in that time, whatever their length, the next step may be the termination of the account, which only an admin decides.",
        "Nothing happens automatically: a moderator reads the strikes and decides.",
        "Such a decision finds no new breach: its ground is this section, and its statement says so and lists the strikes it rests on.",
        "korbat cannot see whether an email it sent reached you, so keep the address of your account current.",
        "The app shows the start as a date and time.",
        "A reply sent later is read and answered too, and can end the suspension, but does not pause it.",
        "korbat suspends an account at once, before any reply, only in four cases, each decided by an admin",
        "the suspension is a protective measure and not a finding that you broke the law or a rule, it gives no strike, counts toward no later step, and ends on its date, or earlier if the seal is lifted.",
        "Its appeal is reviewed at once and does not wait for the authorities.",
        "An announced suspension never rests on one of these four cases.",
        "While suspended you cannot post, reply, quote, like, repost, bookmark, follow, edit your profile, change your handle, upload images, ask for the verified badge, or report under korbat's rules.",
        "Your profile and posts stay visible, without any mark, and others can still follow you and react to your posts.",
        "Your posts do not appear in Explore while you are suspended, and your likes and reposts do not count there.",
        "A second post from before that suspension is no ground for it.",
        "nothing is deleted while your appeal or a reply of yours is unanswered",
        "deleting it ends your appeal, since nothing is left to restore",
        "After the deletion korbat keeps nothing to recognise a new account of yours by",
        "an appeal does not hold a start, only a reply does",
        "korbat treats that as the same conduct and decides about it like any other breach, on what the account does.",
      ],
      "Reporting in bad faith": [
        "Report what you believe breaks a rule; a report that turns out wrong costs you nothing.",
        "korbat acts only on reports that are manifestly unfounded",
        "You see the mark on your list of reports together with the report's outcome, and you can ask for a re-examination.",
        "a report counts once, by the day you sent it, however many of its items were marked, so no single report can lead to a warning.",
        "the count alone decides nothing",
        "Notices of illegal content, reports of child sexual abuse material and requests for re-examination are never counted and never restricted.",
        "You can appeal the warning and the restriction.",
      ],
      Handles: [
        "When the breach lies in a handle itself (impersonation, someone's private information, a threat), a moderator may retire it.",
        "A retired handle can be used by nobody again, you included.",
        "you can choose a new handle without the usual wait: at once, or, while your account is suspended, when the suspension ends.",
        "nobody else could take it meanwhile",
        "also when the breach was someone's private information (rule R4): refusing it needs it.",
      ],
      Appeals: [
        "If a final decision restricts your content or your account, you can appeal it once",
        "An appeal never holds the start of a suspension; a reply does.",
        "The appeal of a protective suspension is reviewed at once; only the appeal of a decision that seals images waits for the authorities.",
      ],
      "Reports and notices": [
        "When korbat's answer to a report about an account is a measure on that account, korbat tells you that it took a measure, and not which or for how long",
        "korbat does not tell you what happens to that account afterwards.",
      ],
      "Your data": [
        "korbat keeps the record of every strike, suspension, termination, warning and retired handle with its decision, as it keeps every decision. What ends is its use:",
        "To decide about reporting in bad faith korbat counts, for each account and day, how many reports under its rules the account sent, and keeps which of them a moderator marked manifestly unfounded;",
        "so for that long a marked report stays linked to the account that sent it. A retired handle is kept as a handle (Handles). Your export holds all of this.",
        "while it can still be re-examined, except through the mark of a report found manifestly unfounded (Reporting in bad faith).",
      ],
    };
    for (const [title, sentences] of Object.entries(said)) for (const sentence of sentences) expect(bodyOf(terms, title), `${title}: ${sentence}`).toContain(sentence);
    // No text says more of a mail than korbat knows: it was sent, never delivered or handed over.
    const all = terms.TERMS_SECTIONS.map((section) => section.body).join(" ");
    expect(all).not.toMatch(/delivered|handed to your mail provider/);
    // A protective suspension is never worded as a finding.
    expect(bodyOf(terms, "Suspension and termination")).not.toContain("It breaks");
  });
});

describe("the table tests: the terms' numbers, rules, measures and outcomes are their constants'", () => {
  test("the table of numbers names every number of NOTICE_LIMITS, CSAM_NOTICE_MAX_ACCOUNTS, SUSPECT_EARLIER_MONTHS, APPEAL_MONTHS, DAILY_LIMITS, RETENTION, STANDING_RULES and REPLY_AIM_HOURS", () => {
    expect([...new Set(numbersTable(contracts).map((row) => row.constant))].sort()).toEqual(constantPaths(contracts).sort());
  });

  test("the terms print every one of them in its sentence, every rule with its text, every measure's label in the sentence its marks put it in, and every outcome's phrase with what it means", () => {
    holds(terms, contracts, rules);
    // As they stand today, in the words a reader meets.
    const text = moderationText(terms);
    expect(text["Reports and notices"]).toContain("korbat takes at most 5 reports an hour and 20 a day from one network without an account, and 10 an hour and 50 a day from one account.");
    expect(text["Reports and notices"]).toContain("one report can name one profile at most");
    expect(text["Appeals"]).toContain("within six months of being told");
    expect(text["Your data"]).toContain("Each is deleted 30 days after it was taken");
    expect(text["How moderators decide"]).toContain("under R2 or R5 or on a report made on the anonymous path");
    expect(labelsIn(measuresSentence(terms, LEADS.interim))).toEqual(["Withhold the post", "Withhold one image"]);
    expect(labelsIn(measuresSentence(terms, LEADS.final))).toEqual(["Remove", "Remove one image", "Strike", "Suspend the account", "Terminate the account", "Retire the handle", "Warn about reporting", "Restrict reporting"]);
    expect(labelsIn(measuresSentence(terms, LEADS.either))).toEqual(["Seal the images this case reaches", "Reset display name", "Reset bio"]);
    expect(text["Reports and notices"]).toContain('"access restricted: it breaks korbat rule [number] ([title])": ');
    // 3e's numbers as a reader meets them.
    expect(text["Strikes"]).toContain("It counts for 90 days from its decision.");
    expect(text["Suspension and termination"]).toContain("for at most three days the first time, seven the second and 30 the third, counting the suspensions decided in the last 365 days");
    expect(text["Suspension and termination"]).toContain("The suspension starts 168 hours after korbat sent that email. If korbat's mail service refuses your address or cannot send the email for five days, only the app can tell you, and the suspension starts 336 hours after the decision.");
    expect(text["Suspension and termination"]).toContain("it made 20 or more posts within 60 minutes, for up to seven days");
    expect(text["Suspension and termination"]).toContain("korbat aims to answer a reply to a suspension taken at once within 24 hours.");
    expect(text["Reporting in bad faith"]).toContain("If at least five of the reports you sent under the rules within 90 days are marked, and they are at least half of the reports you sent under the rules in that time");
    expect(text["Handles"]).toContain("a placeholder that begins with retired_,");
    expect(text["Your data"]).toContain("a strike counts for 90 days, a suspension counts toward the next one for 365 days, a warning about reporting for 90 days.");
  });

  test("the terms name no measure and no period the constants lack: no preservation for an order and no ban; every kind of the ledger is quoted; and no number but the constants', the emergency switch's 48 hours and the Regulation's own", () => {
    const text = moderationText(terms);
    const all = Object.values(text).join(" ");
    // 3e names strikes, suspensions and retired handles (W.7); an order's preservation is 3f's, and korbat bans nobody.
    for (const absent of [/preserv/i, /\bban(s|ned)?\b/i]) expect(absent.test(all), String(absent)).toBe(false);
    // The quoted labels are the ledger's 24 kinds (3f adds the order's measure and its reversal) and nothing else.
    const labels = Object.values(LEADS).flatMap((lead) => labelsIn(measuresSentence(terms, lead)));
    expect([...labels].sort()).toEqual(contracts.ACTION_KINDS.map((kind) => contracts.MEASURES[kind].label).sort());
    // Every run of digits outside the rulebook's own texts, a rule's number and the Regulation's articles is a constant's.
    const values = new Set<string>();
    const collect = (value: unknown): void => {
      if (typeof value === "number") values.add(String(value));
      else if (value !== null && typeof value === "object") Object.values(value).forEach(collect);
    };
    collect([contracts.NOTICE_LIMITS, contracts.DAILY_LIMITS, contracts.RETENTION, contracts.CSAM_NOTICE_MAX_ACCOUNTS, contracts.SUSPECT_EARLIER_MONTHS, contracts.APPEAL_MONTHS, contracts.STANDING_RULES, contracts.REPLY_AIM_HOURS]);
    const outside = Object.entries(text)
      .filter(([title]) => title !== "The rules")
      .map(([, body]) => body)
      .join(" ")
      .replace(/Article [0-9]+\([0-9]+\)|Regulation \(EU\) [0-9]+\/[0-9]+/g, " ")
      .replace(/\bR[1-6]\b/g, " ");
    const typed = (outside.match(/[0-9]+/g) ?? []).filter((digits) => !values.has(digits));
    // The age of an account under the emergency switch has no constant: the queue's own query holds the same 48 hours.
    expect(typed).toEqual(["48"]);
    expect(text["Reports and notices"]).toContain("from accounts under 48 hours old");
  });

  describe("with other numbers, another rulebook, other labels and other phrases in the constants", () => {
    let changed: { terms: TermsModule; contracts: Contracts; rules: Rules };

    beforeAll(async () => {
      vi.resetModules();
      // Every number of the constants becomes another, each its own and none a number the terms print today.
      let next = 100;
      const renumber = (value: unknown): unknown => {
        if (typeof value === "number") return ++next;
        if (Array.isArray(value)) return value.map(renumber);
        if (value === null || typeof value !== "object") return value;
        return Object.fromEntries(Object.entries(value).map(([key, member]) => [key, renumber(member)]));
      };
      vi.doMock("@korbat/contracts", async (importOriginal) => {
        const actual = await importOriginal<Contracts>();
        return {
          ...actual,
          NOTICE_LIMITS: renumber(actual.NOTICE_LIMITS),
          DAILY_LIMITS: renumber(actual.DAILY_LIMITS),
          // RETENTION's one phrase is changed too, as a rule's text is.
          RETENTION: { ...(renumber(actual.RETENTION) as object), replyText: "for the period of a reply's text" },
          STANDING_RULES: renumber(actual.STANDING_RULES),
          REPLY_AIM_HOURS: renumber(actual.REPLY_AIM_HOURS),
          ACCOUNT_MEASURE_SCOPE: { retired: "the phrase of a retirement.", measure: "the phrase of an account measure." },
          RETIRED_HANDLE_PREFIX: "gone_",
          APPEAL_MONTHS: renumber(actual.APPEAL_MONTHS),
          CSAM_NOTICE_MAX_ACCOUNTS: renumber(actual.CSAM_NOTICE_MAX_ACCOUNTS),
          SUSPECT_EARLIER_MONTHS: renumber(actual.SUSPECT_EARLIER_MONTHS),
          // Other labels, and a removal that may also be taken while deciding: it moves to the third sentence.
          MEASURES: Object.fromEntries(Object.entries(actual.MEASURES).map(([kind, spec]) => [kind, { ...spec, label: `the label of ${kind}`, ...(kind === "remove" ? { interim: true } : {}) }])),
          OUTCOME_PHRASES: Object.fromEntries(actual.ITEM_OUTCOMES.map((outcome) => [outcome, outcome === "restricted_rule" ? "the phrase of restricted_rule {rule} ({title})" : `the phrase of ${outcome}`])),
          SUSPECT_OUTCOME_PHRASES: { sealed: "the phrase of a seal.", no_action: "the phrase of no action on that path." },
          UNSEEN_NO_ACTION: "the phrase of an answer given unseen.",
        };
      });
      vi.doMock("@korbat/rules", async (importOriginal) => {
        const actual = await importOriginal<Rules>();
        return {
          ...actual,
          RULES_VERSION: 9,
          // Other titles and texts, and a third rule that only an admin decides.
          RULES: actual.RULES.map((rule) => ({ ...rule, title: `No title of ${rule.id}`, text: `The text of ${rule.id}.`, seniorQueue: rule.seniorQueue || rule.id === "R3" })),
        };
      });
      changed = { terms: await import("../src/lib/terms"), contracts: await import("@korbat/contracts"), rules: await import("@korbat/rules") };
      vi.doUnmock("@korbat/contracts");
      vi.doUnmock("@korbat/rules");
    });

    test("the constants the terms were built from are the changed ones", () => {
      expect(changed.contracts.RETENTION.backupDays).not.toBe(contracts.RETENTION.backupDays);
      expect(changed.contracts.STANDING_RULES.strikeDays).not.toBe(contracts.STANDING_RULES.strikeDays);
      expect(changed.contracts.STANDING_RULES.ladderDays).toHaveLength(3);
      expect(changed.contracts.APPEAL_MONTHS).toBeGreaterThan(100);
      expect(changed.rules.RULES_VERSION).toBe(9);
      expect(changed.terms).not.toBe(terms);
    });

    test("the terms print the changed numbers, rulebook, labels and phrases, each in its place", () => {
      holds(changed.terms, changed.contracts, changed.rules);
      const text = moderationText(changed.terms);
      expect(text["How moderators decide"]).toContain("under R2, R3 or R5 or on a report made on the anonymous path");
      expect(labelsIn(measuresSentence(changed.terms, LEADS.final))).toEqual(["remove_media", "strike", "suspend", "terminate", "retire_handle", "warn_reporting", "restrict_reporting"].map((kind) => `the label of ${kind}`));
      expect(labelsIn(measuresSentence(changed.terms, LEADS.either))).toEqual(["the label of remove", "the label of seal_media", "the label of reset_display_name", "the label of reset_bio"]);
      expect(text["What you can post"]).toContain("(title of R1, title of R2, title of R3, title of R4, title of R5, title of R6)");
    });

    test("and not one of today's: no number, rule title, rule text, label or phrase is typed into the terms", () => {
      const text = moderationText(changed.terms);
      const all = Object.values(text).join(" ");
      for (const row of numbersTable(contracts)) expect(text[row.section]!.includes(row.phrase), `${row.constant}: "${row.phrase}"`).toBe(false);
      for (const rule of rules.RULES) {
        expect(all.includes(rule.text), rule.id).toBe(false);
        expect(all.includes(rule.title), rule.id).toBe(false);
        // A rule's name is also a common word in these sections ("child sexual abuse material"), so it is looked for
        // where the terms list the rules by name, and in brackets, as a sentence names the rule on doxxing.
        expect(text["What you can post"]!.includes(ruleName(rule)), rule.id).toBe(false);
        expect(all.includes(`(${ruleName(rule)})`), rule.id).toBe(false);
      }
      for (const spec of Object.values(contracts.MEASURES)) expect(all.includes(`"${spec.label}"`), spec.label).toBe(false);
      for (const phrase of outcomePhrases(contracts)) expect(all.includes(quoted(phrase)), phrase).toBe(false);
      // 3e: the scope phrases, the placeholder's prefix and a reply's period are the constants', never typed.
      for (const phrase of [contracts.ACCOUNT_MEASURE_SCOPE.measure, contracts.ACCOUNT_MEASURE_SCOPE.retired, contracts.RETIRED_HANDLE_PREFIX, contracts.RETENTION.replyText]) expect(all.includes(phrase), phrase).toBe(false);
      // The only digits left that no changed constant printed are the emergency switch's and the Regulation's.
      const values = new Set<string>();
      const collect = (value: unknown): void => {
        if (typeof value === "number") values.add(String(value));
        else if (value !== null && typeof value === "object") Object.values(value).forEach(collect);
      };
      const c = changed.contracts;
      // 3e prints two numbers worked out from a constant: the earlier strikes after a suspension, and the share as a percentage.
      collect([c.NOTICE_LIMITS, c.DAILY_LIMITS, c.RETENTION, c.CSAM_NOTICE_MAX_ACCOUNTS, c.SUSPECT_EARLIER_MONTHS, c.APPEAL_MONTHS, c.APPEAL_MONTHS + Math.ceil(c.RETENTION.intakeDays / 30), changed.rules.RULES_VERSION]);
      collect([c.STANDING_RULES, c.REPLY_AIM_HOURS, c.STANDING_RULES.ladderStrikes - 1, c.STANDING_RULES.reportWarnShare * 100]);
      const outside = all.replace(/Article [0-9]+\([0-9]+\)|Regulation \(EU\) [0-9]+\/[0-9]+/g, " ").replace(/\bR[1-6]\b/g, " ");
      expect((outside.match(/[0-9]+/g) ?? []).filter((digits) => !values.has(digits))).toEqual(["48"]);
    });
  });
});

describe("the terms page", () => {
  test("shows every section under its heading and every paragraph of it, then Contact with the build's address and the link to the report form", () => {
    const out = html(<Terms />);
    const text = textOf(out);
    expect(text).toContain(`Version ${terms.TERMS_VERSION}`);
    let at = 0;
    for (const section of terms.TERMS_SECTIONS) {
      // Each heading after the one before it, with its paragraphs behind it in order.
      const heading = out.indexOf(`>${section.title}</`, at);
      expect(heading, section.title).toBeGreaterThan(at);
      at = heading;
      let within = textOf(out.slice(heading));
      for (const paragraph of terms.termsParagraphs(section.body)) {
        const found = within.indexOf(textOf(paragraph));
        expect(found, `${section.title}: ${paragraph.slice(0, 60)}`).toBeGreaterThan(-1);
        within = within.slice(found);
      }
    }
    // One level-2 heading for each section, and one for Contact.
    expect(out.split("<h2").length - 1).toBe(terms.TERMS_SECTIONS.length + 1);
    // Every paragraph is an element of its own: a reader gets them apart, not as one block. Its first words stand
    // directly behind an opening tag's end.
    const decoded = out.replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&gt;", ">");
    for (const paragraph of terms.TERMS_SECTIONS.flatMap((section) => terms.termsParagraphs(section.body))) {
      const start = paragraph.slice(0, 40);
      expect(decoded.includes(`>${start}`), start).toBe(true);
    }
    expect(text).toContain(`Contact ${CONTACT_WORDS.body(CONTACT)}`);
    expect(text.indexOf("Your account's export holds")).toBeLessThan(text.indexOf("Contact Write to korbat"));
    expect(text.indexOf("Contact Write to korbat")).toBeLessThan(text.indexOf(CONTACT_WORDS.report));
    expect(out).toContain('href="/report"');
  });
});
