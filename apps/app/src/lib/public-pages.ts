import { EDGE_CACHE, EDGE_WORDS, MEASURES, RECIPIENT_RULES, TRANSPARENCY_RULES, type HeadWitness, type MeasureKind, type PublicFacts } from "@korbat/contracts";
import { RULES } from "@korbat/rules";
import { numberWord } from "./moderation-words";

/**
 * The fixed texts of the two public pages (3d design, sections 9.1 to 9.3 and 18, W.1 and W.2; Tasks 4 and 5): the rules page's
 * (RULES_PAGE), what it says of each tool in each state (TOOL_TEXTS), and the transparency page's (TRANSPARENCY_PAGE).
 * Every number is printed from its constant. The words hold the design's nine rules for every text of 3d: a public page
 * points at no person, says no more of a tool than is true in every state the design builds, and names the order
 * section as the one place a figure is a number.
 */

/** [page.down], in place of the part a page could not fetch: the fixed texts stand, and nothing says a tool is on or off. */
export const PAGE_DOWN = "korbat could not load this part right now. Try again in a minute.";

/** A count of minutes as a sentence prints it. */
const minutes = (n: number) => `${n} ${n === 1 ? "minute" : "minutes"}`;

/** The numbers the rules page prints in its automation section once a tool that rates or compares images is on. */
export interface AutomationLimits {
  decisionsPerHour: number;
  decisionsPerDay: number;
  r2DecisionsPerHour: number;
  r2DecisionsPerDay: number;
  unansweredMax: number;
  unansweredHours: number;
  refusalsPerHour: number;
  objectionTargetHours: number;
}

/** The rules page's words (W.1). */
export const RULES_PAGE = {
  title: "The rules",
  lead: "These are all of korbat's rules. korbat restricts content when it breaks one of them, or when it is illegal under EU law or the law of an EU country and korbat is told about it in a notice. Opinions are never a reason. Every decision names one of these rules or the law, and its statement shows the rule as it read on the day of the decision.",
  rulesHeading: "The rules",
  allowed: "Allowed",
  notAllowed: "Not allowed",
  law: "Illegal content. Anyone can tell korbat that something on it is illegal (Report). An authority or a court can order korbat to act (Terms, Authorities' orders). korbat cannot restrict for one country alone, so a restriction for illegality applies everywhere korbat is available.",
  measuresHeading: "What korbat can do, and when",
  automationHeading: "Automation",
  autoLead: `korbat's moderators are people. A program may do the few things listed here and nothing else. It never removes anything, never judges text, and never suspends or restricts an account. What a program does to a post lasts only until a person decides; the person a measure concerns is told at once, and can put it before a person with "Ask for a person". An upload that a program does not accept stays not accepted: a person decides what happens to the held file, and nobody at korbat can accept it, since nobody opens it. This list is printed by the running server: it says what is switched on today.`,
  autoCap: (l: AutomationLimits) =>
    `A program takes at most ${l.decisionsPerHour} measures an hour and ${l.decisionsPerDay} a day under rule R1, and at most ${l.r2DecisionsPerHour} an hour and ${l.r2DecisionsPerDay} a day under rule R2. It takes no new measure under a rule while ${l.unansweredMax} of its measures under that rule wait for a person, and none under either rule while a request for a person has waited longer than ${l.unansweredHours} hours. It refuses at most ${l.refusalsPerHour} uploads an hour. Over a limit it only reports to korbat's staff.`,
  autoTarget: (hours: number) => `When you ask for a person, korbat's target is an answer within ${hours} hours. It is a target that korbat publishes, not a time after which a measure ends.`,
  dpia: (date: string) => `korbat's data protection impact assessment for this tool is dated ${date}.`,
  dpiaActs: (date: string) => `The assessment that covers the measure it takes is dated ${date}.`,
  autoNone: "No tool that rates or compares images is switched on today.",
  versionHeading: "Version and changes",
  version: (version: number) => `This is version ${version} of the rules.`,
  change: (change: { version: number; date: string; summary: string }) => `Version ${change.version}, ${change.date}: ${change.summary}`,
  transparencyLink: "Transparency",
  exploreLink: "How Explore works",
} as const;

/** What the facts route says of the R1 check's model, printed under its text while it is on. */
type R1Facts = Pick<PublicFacts["r1"], "model" | "digest" | "threshold" | "thresholdVersion" | "publisherClaim">;

/** The text of match.alerts, up to and with the sentence after which match.seals goes its own way (W.1). */
const matchAlerts = (source: string) =>
  `Comparing uploads with known child sexual abuse material: on, with ${source}. korbat computes fingerprints of every uploaded image, keeps them with the image, and sends them, and nothing else, to ${source}: never the image, an address or an account. Only a match that ${source} reports as exact, with an entry it classifies as child sexual abuse material, lets a program refuse or seal. Such an upload is not accepted, now or later, and is held unseen until an admin has decided what happens to the file.`;

/**
 * TOOL_TEXTS (W.1): one text a tool and state. `{source}` and the model's facts come from the facts route; the edge's
 * minutes from EDGE_CACHE, the header's own numbers.
 */
export const TOOL_TEXTS = {
  r1: {
    off: "Rating images against rule R1: off. No program rates any image, and korbat keeps no rating from a time when one did. What a program found while it was on is still put before a moderator. Otherwise a moderator looks at an image only after a report or on a finding of their own.",
    flags:
      "Rating images against rule R1: on. A program rates every uploaded image and korbat keeps the rating with the image. An image it rates at or above the threshold is put before a moderator, who decides. The program hides nothing, and the image's author hears of it only if the moderator's decision restricts the post.",
    withholds:
      "Rating images against rule R1: on. A program rates every uploaded image and korbat keeps the rating with the image. An image it rates at or above the threshold is put before a moderator, and korbat hides that one image from other people until the moderator has decided. The post's text stays, and its author still sees the image, is told at once and can ask for a person.",
    facts: (f: R1Facts) =>
      `The model: ${f.model}. SHA-256 of its weights: ${f.digest}. Threshold: ${f.threshold}, version ${f.thresholdVersion}. Its publisher states: "${f.publisherClaim}". korbat has not measured its error rate and claims none. The publisher does not disclose the training data, and korbat found no outside evaluation of bias. A rating says nothing about rule R2.`,
  },
  match: {
    off: "Comparing uploads with known child sexual abuse material: off. korbat computes no fingerprint of any upload, compares nothing, and keeps no fingerprint from a time when it did, except the one in the record of a match (Terms, Your data). A match found while it was on is still put before korbat's staff. Otherwise rule R2 is applied on reports and on moderators' findings.",
    alerts: (source: string) =>
      `${matchAlerts(source)} A match with such an entry, exact or not, on an image that is already on a post is put before an admin at once; the program seals nothing, and from then on korbat keeps that post's images, also if their author deletes the post or the account, until the admin has answered. A match with an entry of any other class only flags the image for a person: no upload is refused and no image is held, sealed or kept because of it. korbat's staff do not open an image that a match names.`,
    seals: (source: string) =>
      `${matchAlerts(source)} When an image that is already on a post matches in that way, korbat seals that post's images at once, for everyone, until an admin has answered; it keeps them until then, also if their author deletes the post or the account. The author is told at once and can ask for a person. A match with such an entry that ${source} does not report as exact is put before an admin at once too: the program seals nothing on it, and korbat keeps that post's images until the admin has answered. A match with an entry of any other class only flags the image for a person: no upload is refused and no image is held, sealed or kept because of it. korbat's staff do not open an image that a match names, before the admin's answer or after it, and the admin's answer is a person's decision.`,
  },
  edge: {
    off: `Dropping cached copies: off. When an image stops being public, a copy at korbat's network provider can be served for up to ${minutes(EDGE_WORDS.edgeMinutes)}, and a copy in a browser for up to ${minutes(EDGE_CACHE.browserSeconds / 60)}.`,
    on: `Dropping cached copies: on. When an image stops being public, korbat asks its network provider to drop its copy at once. The request can fail, so the bound korbat states is the same: up to ${minutes(EDGE_WORDS.edgeMinutes)} at the provider, up to ${minutes(EDGE_CACHE.browserSeconds / 60)} in a browser.`,
  },
  witness: {
    off: "Outside timestamp for the audit log's daily value: off. The value stands on korbat's Transparency page and in a mail to a person who does not run the server.",
    // 3d review M13: in the place of `off` while no keeper's address is set (the facts' `keeper`): no mail goes to anyone.
    offAlone: "Outside timestamp for the audit log's daily value: off. The value stands on korbat's Transparency page alone.",
    on: "Outside timestamp for the audit log's daily value: on. The Transparency page offers each day's proof and says how to check it.",
  },
} as const;

/** "(test adapter)" after a tool's "on": a test adapter can run only while the app's site is closed (W.1). */
const testAdapter = (text: string) => text.replace(": on", ": on (test adapter)");

/** One tool's block on the rules page, as the facts give it: its paragraphs, in order. */
export interface ToolBlock {
  tool: "r1" | "match" | "edge" | "witness";
  on: boolean;
  paragraphs: string[];
}

/**
 * The automation section's four blocks, in the state the facts route gives each tool (9.2 item 4): a tool's text, its
 * model's facts while the R1 check is on, and inside the block of each of the two tools that rate or compare images,
 * while it is on, its own impact assessment's day and, while its measure is on, the day of the one that covers it. A date
 * is never printed over a tool it was not set for.
 */
export function toolBlocks(facts: PublicFacts): ToolBlock[] {
  const dates = (tool: { dpia: string | null; dpiaActs: string | null }, acts: boolean) => [
    ...(tool.dpia === null ? [] : [RULES_PAGE.dpia(tool.dpia)]),
    ...(acts && tool.dpiaActs !== null ? [RULES_PAGE.dpiaActs(tool.dpiaActs)] : []),
  ];
  const marked = (text: string, test: boolean) => (test ? testAdapter(text) : text);
  const { r1, match, edge, witness } = facts;
  const r1On = r1.state !== "off";
  const matchOn = match.state !== "off";
  const source = match.source ?? "its source";
  return [
    {
      tool: "r1",
      on: r1On,
      paragraphs: r1On
        ? [marked(TOOL_TEXTS.r1[r1.state === "withholds" ? "withholds" : "flags"], r1.test), ...(r1.model === null ? [] : [TOOL_TEXTS.r1.facts(r1)]), ...dates(r1, r1.state === "withholds")]
        : [TOOL_TEXTS.r1.off],
    },
    {
      tool: "match",
      on: matchOn,
      paragraphs: matchOn ? [marked(match.state === "seals" ? TOOL_TEXTS.match.seals(source) : TOOL_TEXTS.match.alerts(source), match.test), ...dates(match, match.state === "seals")] : [TOOL_TEXTS.match.off],
    },
    { tool: "edge", on: edge.on, paragraphs: [edge.on ? marked(TOOL_TEXTS.edge.on, edge.test) : TOOL_TEXTS.edge.off] },
    // 3d review M13: the off text names the keeper's mail only while a keeper's address is set.
    { tool: "witness", on: witness.on, paragraphs: [witness.on ? marked(TOOL_TEXTS.witness.on, witness.test) : facts.keeper ? TOOL_TEXTS.witness.off : TOOL_TEXTS.witness.offAlone] },
  ];
}

/** The six full months before an edition's due day end with this month (yyyy-mm), the same in every version of the year. */
export function recipientsMonth(year: number): string {
  return new Date(Date.UTC(year + 1, TRANSPARENCY_RULES.dueMonth - 1, 0)).toISOString().slice(0, 7);
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** The day a year's edition is due, as a sentence names it: 1 March, from TRANSPARENCY_RULES. */
const DUE = `${TRANSPARENCY_RULES.dueDay} ${MONTHS[TRANSPARENCY_RULES.dueMonth - 1]}`;
/** The floor and the rounding of a banded count, as a sentence names them. */
const FLOOR = numberWord(TRANSPARENCY_RULES.floor);
const UNDER_FLOOR = `1 to ${TRANSPARENCY_RULES.floor - 1}`;
const ROUND_TO = numberWord(TRANSPARENCY_RULES.roundTo);

/** Who witnessed a day's value, as its row says it. */
const HEAD_WITNESS_WORDS: Record<HeadWitness, string> = {
  rfc3161: "with an outside timestamp",
  test: "with a test adapter's timestamp, which proves nothing",
  none: "without an outside timestamp",
};

/** The labels of a measure in the tables: the ledger's own. */
const measureLabel = (kind: string) => (kind in MEASURES ? MEASURES[kind as MeasureKind].label : kind);
/** A rule's title in force, for the table by ground. */
const ruleTitle = (id: string) => RULES.find((rule) => rule.id === id)?.title ?? id;

/** The transparency page's words (W.2). */
export const TRANSPARENCY_PAGE = {
  title: "Transparency",
  lead: "What korbat's moderators, its programs and authorities' orders did, in numbers. korbat publishes counts and never a decision: on a service this small, a list of decisions would point at people. Whoever a decision concerns gets its full reasons from korbat directly.",
  read: `How to read a figure. korbat prints 0, "${UNDER_FLOOR}", or a number rounded to the nearest ${ROUND_TO} ("about 60"). A line that would show fewer than ${FLOOR} is folded into "other". Each figure is rounded by itself, so the lines of a table need not add up to its total. The one exception is the section on authorities' orders: the law asks for those figures as numbers, so they are printed as numbers, small ones too. korbat publishes one edition for each calendar year, on or after ${DUE} of the next year, and never changes it: a correction is a new version beside it, marked and dated. The running year shows no figure, so nothing on this page moves when korbat takes one decision.`,
  edition: (year: number, version: number, publishedOn: string, method: number) =>
    `Edition ${year}, version ${version}, published ${publishedOn}. It counts what was decided, received or answered from 1 January to 31 December ${year}, UTC. Method ${method}.`,
  versions: "Earlier versions of this year, kept as they were published:",
  versionLine: (version: number, publishedOn: string, replacedOn: string) => `Version ${version}, published ${publishedOn}, replaced on ${replacedOn}.`,
  showVersion: "Show this version",
  hideVersion: "Hide this version",
  reason: {
    hold_ended: "This version adds an order that an authority's decision forbade korbat to disclose until now. Every other figure is the one first published: nothing else was counted again.",
    correction: (publishedOn: string) => `This version corrects the version before it. Every table of the year was counted again on ${publishedOn}, so a figure can differ for a reason other than the corrected one.`,
  },
  none: `korbat has published no edition yet. The first appears on or after ${DUE} of the year after korbat's first calendar year.`,
  /** A table with no row. */
  tableNone: "None in this year.",
  tables: {
    byGround: "Restrictions, by ground",
    byMeasure: "Restrictions, by kind of measure",
    noBreach: "Decisions that found no breach",
    intakes: "Reports and notices received",
    appeals: "Appeals answered in the year",
    reexaminations: "Re-examinations answered in the year",
    accountMeasures: "Measures on accounts",
    automated: "Programs",
    uploads: "Uploads not accepted",
  },
  labels: {
    ground: (id: string) => `Rule ${id}: ${ruleTitle(id)}`,
    law: "The law",
    otherGrounds: "Other grounds",
    allRestrictions: "All restrictions",
    measure: measureLabel,
    otherMeasures: "Other measures",
    other: "Other",
    noBreach: "Decisions that found no breach",
    intakes: {
      rules: "Reports under korbat's rules",
      illegal: "Notices of illegal content (Article 16 of the Digital Services Act)",
      finding: "Findings by korbat's moderators",
      automated: "Findings by a program",
    } as Record<string, string>,
    appeals: { kept: "Decision kept", partly_reversed: "Reversed in part", reversed: "Reversed" } as Record<string, string>,
    reexaminations: { action: "Action taken", no_action: "No action again" } as Record<string, string>,
    findings: (id: string) => `Findings by a program under rule ${id}`,
    measures: (id: string) => `Measures a program took under rule ${id}`,
    // 3d Task 7: the figures' `open` row, a refusal whose hold no admin had ended by the edition's due day (6.4).
    uploads: { refused: "Uploads refused on a match", report: "Held for a report", no_report: "Hold ended without a report", open: "Held, not yet decided on the due day" } as Record<string, string>,
  },
  autoRate: (base: string, restricted: string) => `Of ${base} findings by a program under rule R1, a person then restricted ${restricted}.`,
  autoFew: "Too few findings to say what became of them.",
  ordersHeading: "Authorities' orders",
  orders:
    "An order is not korbat's decision: korbat gives no reasons of its own for it, publishes no statement of reasons for it, and counts it in none of the tables above. These are the figures that Article 7 of Regulation (EU) 2021/784 asks for, as numbers.",
  /** The headings of the yearly report of authorities' orders (the 3f design's runbook), without the issuing state. */
  orderHeadings: {
    received: "Removal orders received",
    disabled: "Items disabled, and how fast",
    late: "Orders not carried out in time, with the ground",
    scrutiny: "Scrutiny and reinstatements",
    own: "The measures korbat takes against terrorist content",
  },
  orderLines: {
    received: (total: string, crossBorder: string) => `Removal orders received: ${total}, of which from another Member State: ${crossBorder}.`,
    itemsDisabled: (n: string) => `Items disabled following a removal order: ${n}.`,
    minutes: (list: string) => `Minutes from the clock's start to the disabling of an order's last item: ${list}.`,
    outside: (n: string) => `Orders whose last item was disabled outside the hour: ${n}.`,
    open: (n: string) => `Orders with an item still open: ${n}.`,
    annex3: (list: string) => `Annex III sent, by ground: ${list}.`,
    scrutiny: (requested: string, annulled: string, upheld: string) => `Scrutiny requested: ${requested}; annulled: ${annulled}; upheld: ${upheld}.`,
    reinstated: (list: string) => `Reinstated, by ground: ${list}.`,
    access: (n: string) => `Access to preserved content by an authority: ${n}.`,
    terrorist: (n: string) => `Restricted by korbat as terrorist content without an order (notices and its own findings; no automated tool): ${n}.`,
    referrals: (n: string) => `Messages at the contact point closed as a referral: ${n}.`,
  },
  /** Grounds as the page prints them. */
  grounds: {
    force_majeure: "force majeure",
    manifest_error: "manifest error",
    insufficient_information: "insufficient information",
    withdrawn: "withdrawn",
    annulled: "annulled",
    scrutiny: "after scrutiny",
    not_authentic: "not authentic",
    wrong_item: "wrong item",
  } as Record<string, string>,
  /** A figure the rows can no longer give, as tco-counts prints it: never 0. */
  notRecorded: "not recorded",
  ordersHeld: "Orders that an authority's decision forbids korbat to disclose are counted after that decision ends. A year can gain a second, marked version for that reason.",
  recipientsHeading: "Recipients",
  recipients: (month: string, low: string, high: string) =>
    `Average monthly active recipients of korbat (Article 24(2) of the Digital Services Act), over the six months to ${month}: between ${low} and ${high}.`,
  recipientsOff: (month: string, low: string) =>
    `Average monthly active recipients of korbat (Article 24(2) of the Digital Services Act), over the six months to ${month}: at least ${low}; korbat does not count readers without an account.`,
  // 3d review L12 (people10): fewer than six of the six months hold a count. That is the case before korbat has counted
  // six full months, and also after a restore lost a closed month or a loss of the counting store left a month unrecorded
  // (the transparency job's month mark), so the page says "not recorded" with both reasons, never only the first.
  recipientsNotRecorded: (month: string) =>
    `Average monthly active recipients of korbat (Article 24(2) of the Digital Services Act), over the six months to ${month}: not recorded. korbat holds a count for fewer than six of those months: it had not counted six full months by then, or the count of a month is missing, as after a restore of its database from a backup or a loss of its counting store during that month.`,
  method: (method: number) =>
    `How korbat counts (method ${method}). An account that was used while signed in during a month is counted once for that month. A reader without an account is counted once for each day they read korbat: korbat cannot tell whether Tuesday's reader is Monday's, because it keeps nothing that could tell. So the true number lies between the first figure, accounts alone, and the second, accounts plus the sum of each day's readers. To count, korbat feeds a counting sketch: a small summary that cannot list who was counted. For a reader without an account it is fed with a keyed digest of the network address and the browser's name, under a random key that exists for ${RECIPIENT_RULES.saltHours} hours in korbat's short-lived store and is written nowhere else. Until a month's sketch is deleted at the month's end, whoever runs korbat's server could still ask it whether one given account was probably counted in that month; after that korbat keeps two numbers and nothing else. A crawler is left out only when it names itself. korbat does not record where a reader is, so readers outside the European Union are counted too.`,
  // The audit log's daily value (3d Task 5; 9.3 item 6, W.2).
  headHeading: "The audit log's daily value",
  head: "Each day korbat publishes one value computed from the day and the newest entry of its staff audit log, the record of everything korbat's staff confirm with their keys. If an earlier entry were changed or removed later, the log would no longer lead to the values published since. A value shows neither how many entries the log has nor any entry, and it differs from one day to the next also when nothing was added to the log. A value on korbat's own page proves nothing against korbat's operator, who could change this page too.",
  // 3d review M13: [tr.head]'s last sentence, printed after it only while a keeper's address is set (the facts' `keeper`),
  // and the one printed in its place while none is: the page never says that a mail goes where none does.
  headKeeper: "So the same value goes each day to a person who does not run the server, and, when the outside timestamp is on, to a timestamp authority.",
  headNoKeeper: "When the outside timestamp is on, the same value goes each day to a timestamp authority.",
  /** A day's row: its value, and who witnessed it ("witness" reads none for a row without a token). */
  headRow: (day: string, value: string, witness: HeadWitness) => `${day}: ${value}, ${HEAD_WITNESS_WORDS[witness]}`,
  /** [tr.headMissing], in the row of a day between two shown days that has no value. */
  headMissingRow: (day: string) => `${day}: no value was published`,
  /** [tr.restore], a restore's row; the second sentence names the newest value above it that still fits, or says none does. */
  restore: (day: string, lastDay: string | null) =>
    `${day}: korbat restored its database from a backup. ${lastDay === null ? "No value above still fits the restored log." : `The newest value above that still fits the restored log is of ${lastDay}.`}`,
  /** [tr.retired], after a retired value. */
  retired: (day: string) => `retired by the restore of ${day}: true when published, and fits no log now`,
  /**
   * [tr.verify], while a shown row has a proof, with the newest such day's value and file: the command as it was run once
   * against a proof of a local test authority (OpenSSL 3.5.4), where it answered "Verification: OK" for the value and
   * failed for another value and for another authority's certificates.
   */
  verify: (value: string, day: string) =>
    `To check a day: download its proof, get the timestamp authority's certificates from the authority itself, and run: openssl ts -verify -digest ${value} -in ${day}.tsr -CAfile <certificates>. It answers "Verification: OK" when that authority signed this value at the time the proof states.`,
  download: (day: string) => `Download the proof of ${day} (${day}.tsr)`,
  headNone: "korbat has published no daily value yet.",
  tdbHeading: "The Transparency Database",
  tdb: "korbat does not send its statements of reasons to the European Commission's DSA Transparency Database. That duty (Article 24(5) of the Digital Services Act) does not apply to micro and small enterprises (Article 19(1)), which korbat is, and a statement sent there cannot be taken back. Should korbat outgrow the exemption, this page will say from which day it sends them.",
  rulesLink: "The rules",
  exploreLink: "How Explore works",
} as const;
