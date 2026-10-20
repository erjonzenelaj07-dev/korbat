import { AUTOMATION_RULES, CSAM_NOTICE_MAX_ACCOUNTS, DAILY_LIMITS, NOTICE_LIMITS, type CsamKeywordChoice, type TdbFormCategory } from "@korbat/contracts";
import { IMAGE_LOST_NOTICE } from "@korbat/rules";

/**
 * The app's words for reports, notices and moderation cases (3c design, section 9): the report form, the notice status
 * page, the cases screens, the chips and the labels. Each sentence is written here once and the screens take it from
 * here; the words of an outcome, of a statement and of a rule are not here at all: they come from @korbat/contracts and
 * @korbat/rules, which the mails and the staff console use too, so the app can never word them differently.
 */

/** A small count as a word, as the form's sentences print the limits; a larger one as digits. */
export function numberWord(count: number): string {
  return ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][count] ?? String(count);
}

const PROFILE_LIMIT = `${numberWord(CSAM_NOTICE_MAX_ACCOUNTS)} ${CSAM_NOTICE_MAX_ACCOUNTS === 1 ? "profile" : "profiles"}`;

/** What follows every sentence that offers the contact address in place of the form. */
const MAIL_INSTEAD = (contact: string) => `email your report to ${contact} with the korbat links of what you report and why. Do not attach images or files: korbat does not open them.`;

export const REPORT_WORDS = {
  control: "Report",
  imageControl: "Report this image",
  title: "Report to korbat",
  question: "What is wrong with it?",
  /** The three grounds, of equal weight and in this order. */
  grounds: {
    rule: "It breaks a korbat rule",
    illegal: "It is illegal",
    csam: "It is sexual abuse or exploitation of a child, child sexual abuse material, or grooming of a child",
  },
  whichRule: "Which rule?",
  /** In the list of rules, in R2's place: such a report goes the third way. */
  r2Instead: "Child sexual abuse material: choose the third answer, which is anonymous.",
  explanation: "Anything the moderator should know",
  category: "What kind of illegal content is it?",
  categoryNotSure: "I am not sure",
  /** Directly below the categories. */
  csamInstead: "For the sexual abuse or exploitation of a child, child sexual abuse material or grooming, choose the third answer, which is anonymous.",
  citedLaw: "Which law or country (optional)",
  whyIllegal: "Why is it illegal?",
  alsoRule: "A korbat rule it also breaks (optional)",
  noRule: "None",
  which: "Which is it?",
  keywords: {
    csam: "Sexual images or videos of a child",
    deepfake: "Such images made or altered by software",
    grooming: "An adult seeking sexual contact with a child",
    abuse: "Other sexual abuse or exploitation of a child, such as offering a child for sex",
  } satisfies Record<CsamKeywordChoice, string>,
  csamExplanation: "Anything korbat should know (optional)",
  anonymous: "This report is anonymous: korbat does not record who sent it, not even your account. Keep the link we show you to follow it.",
  profileOnly: "If you can, report the post or the image itself: open it and choose Report. From a profile alone korbat cannot tell which image you mean, and its answer covers the images on all the profile's posts.",
  oneProfile: `On this path a report can name ${PROFILE_LIMIT}. Send another report for the next one.`,
  item: "What you report",
  itemPost: "This post",
  itemImage: "One image of this post",
  itemProfile: (handle: string) => `The profile @${handle}`,
  link: "Link to the post or profile on korbat",
  otherItems: "Other items",
  otherItemsHint: `You can add up to ${numberWord(NOTICE_LIMITS.maxTargets - 1)} more korbat links.`,
  otherLink: (n: number) => `Link ${n}`,
  addLink: "Add another link",
  removeLink: "Remove",
  bonaFide: "I believe in good faith that the information in this report is accurate and complete.",
  name: "Your name (optional)",
  email: "Your email (optional)",
  contactHint: "Without an email we cannot send you a receipt or our decision. korbat never shows your name or email to the person you report.",
  /** The privacy line's three sentences; the second is not shown on the anonymous path, which records no sender. */
  privacy: {
    use: "korbat uses what you send only to handle this report; how long it keeps it is in the terms.",
    sender: "Moderators see who sent a report only when a case needs it, for example when you report an account impersonating you; each time is recorded and shown to every staff member.",
    access: "If the person you report asks korbat for their data, the law may require korbat to give them what you wrote, never your name, email or account.",
  },
  turnstile: "Cloudflare Turnstile checks that you are not a bot; it sees your IP address and browser details for that check.",
  send: "Send report",
  /** What the form says in place of sending while something is missing. */
  missing: {
    ground: "Choose what is wrong with it.",
    rule: "Choose the rule it breaks.",
    keyword: "Choose which it is.",
    link: "Give the link to the post or profile on korbat.",
    linkInvalid: "A link must be a whole address that begins with http:// or https://.",
    whyIllegal: "Say why it is illegal.",
    bonaFide: "Confirm that you report in good faith.",
    human: "Wait for the check that you are not a bot.",
    details: "Some details are missing or invalid.",
  },
  sent: "Your report was received",
  reference: (ref: string) => `Its reference is ${ref}.`,
  keepLink: "Keep this link to follow your report or ask for a decision to be re-examined. It is shown only now.",
  copy: "Copy",
  copied: "Copied",
  followInSettings: "You can follow it under Settings, Cases, Your reports.",
  yourReports: "Your reports",
  /** The three failures the form words itself, each naming the users' contact address. */
  humanCheckFailed: (contact: string) => `The check that you are not a bot failed. Try again, or ${MAIL_INSTEAD(contact)}`,
  rateLimited: (wait: string, contact: string) =>
    `korbat cannot take another report from this network or account right now: it takes at most ${NOTICE_LIMITS.signedOut.perHour} reports an hour and ${NOTICE_LIMITS.signedOut.perDay} a day without an account, and ${NOTICE_LIMITS.signedIn.perHour} an hour and ${NOTICE_LIMITS.signedIn.perDay} a day with one. Try again in about ${wait}, or ${MAIL_INSTEAD(contact)}`,
  unavailable: (contact: string) => `korbat cannot take reports right now. Try again in a few minutes, or ${MAIL_INSTEAD(contact)}`,
  /** After each of the three on the anonymous path: a mail is not anonymous. */
  mailShowsAddress: "An email shows korbat your address. korbat deletes your email, and its reply to you, once your report is entered.",
} as const;

/** The Transparency Database's names for the categories the illegal ground offers. */
export const CATEGORY_LABELS: Record<TdbFormCategory, string> = {
  STATEMENT_CATEGORY_ANIMAL_WELFARE: "Animal welfare",
  STATEMENT_CATEGORY_CONSUMER_INFORMATION: "Consumer information infringements",
  STATEMENT_CATEGORY_CYBER_VIOLENCE: "Cyber violence",
  STATEMENT_CATEGORY_CYBER_VIOLENCE_AGAINST_WOMEN: "Cyber violence against women",
  STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS: "Data protection and privacy violations",
  STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH: "Illegal or harmful speech",
  STATEMENT_CATEGORY_INTELLECTUAL_PROPERTY_INFRINGEMENTS: "Intellectual property infringements",
  STATEMENT_CATEGORY_NEGATIVE_EFFECTS_ON_CIVIC_DISCOURSE_OR_ELECTIONS: "Negative effects on civic discourse or elections",
  STATEMENT_CATEGORY_PROTECTION_OF_MINORS: "Protection of minors",
  STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY: "Risk for public security",
  STATEMENT_CATEGORY_SCAMS_AND_FRAUD: "Scams and fraud",
  STATEMENT_CATEGORY_SELF_HARM: "Self-harm",
  STATEMENT_CATEGORY_UNSAFE_AND_PROHIBITED_PRODUCTS: "Unsafe, non-compliant or prohibited products",
  STATEMENT_CATEGORY_VIOLENCE: "Violence",
};

const OUTSIDE_KORBAT = "go to court, or complain to the Digital Services Coordinator of the EU country where you live.";

export const STATUS_WORDS = {
  title: "Your report",
  reference: (ref: string) => `Reference ${ref}`,
  received: (time: string) => `Received on ${time}.`,
  item: (n: number) => `Item ${n}`,
  /** The heading of an item korbat added for the post a named post quotes. */
  added: (n: number, link: string) => `The post that item ${n} quotes (${link}), added by korbat`,
  waiting: "Not decided yet.",
  decided: (day: string) => `Decided on ${day}:`,
  reexaminationLabel: "Re-examination",
  /** Beside an item whose answer can still be examined again: what that is, and until when. */
  reexaminationOpen: (until: string) => `A moderator decides it again as a new report. You can ask once for each item, within six months of being told, until ${until}.`,
  /** The control beside such an item: its button, its optional statement, and what it says once asked. */
  reexamine: "Ask for a re-examination",
  reexamineStatement: "Anything you want the moderator to know (optional)",
  /** Beside the control of a report of child sexual abuse material whose added item can be examined again too. */
  reexamineBoth: "korbat examines the post it quotes again as well.",
  /** Beside an outcome a review or a correction changed, and a re-examination's answer. */
  final: `This is final within korbat. You can also ${OUTSIDE_KORBAT}`,
  /** Beside any other decided outcome that cannot be examined again. */
  courts: `You can ${OUTSIDE_KORBAT}`,
  contact: "Emails about this report",
  confirmed: "This address is confirmed as the sender's.",
  unconfirmed: "korbat has not been told yet whether this address sent the report.",
  confirm: "Yes, I sent this: keep me informed",
  stop: "I did not send this: stop korbat's report emails to this address",
  stopHint: "This also stops korbat's emails about reports you send yourself from this address, signed in or not, until you undo it on this page or, if a korbat account uses this address, under Settings, Cases, Your reports.",
  stopped: "korbat's report emails to this address are stopped.",
  undo: "Undo: email this address about reports again",
  retry: "Try again",
} as const;

/**
 * The day's limits of the two forms that ask korbat to look again, an appeal and a re-examination (3c design, section
 * 7.7): worded with their number and the wait the answer gives, since the wait can be a whole day. An appeal is counted
 * per account; a re-examination per account, and without one per network.
 */
export const DAILY_LIMIT_WORDS = {
  appeals: (wait: string) => `korbat takes at most ${DAILY_LIMITS.appeals} appeals a day from one account. Try again in about ${wait}.`,
  reexaminations: (wait: string) => `korbat takes at most ${DAILY_LIMITS.reexaminations} requests for a re-examination a day from one account, or without an account from one network. Try again in about ${wait}.`,
};

/**
 * 3d Task 6 (design, sections 9.4, 9.6 and 9.7): a measure a program took, as its author sees it: the chip [auto.chip]
 * beside the day, "Ask for a person" [auto.ask] under its lead [auto.askLead], the request as sent [auto.asked] with the
 * published target, and once a person has decided [auto.decided] with a link to that decision; the row of "About you";
 * and objection_not_open's words, which are [auto.decided] without the day. The target is the contracts' constant, a
 * published target and never an end: the measure lapses by no timer.
 */
export const AUTO_WORDS = {
  chip: "Taken by a program",
  row: (what: string) => `Taken by a program: ${what}`,
  ask: "Ask for a person",
  askLead:
    "Write anything a person should know. You can send one message. A moderator reads it and lifts the measure or decides the case; for sealed images an admin does. You get that decision's statement either way. You do not need to cite rules or law.",
  askField: "Your message to a person",
  asked: (createdAt: string) => `You asked for a person on ${createdAt}. korbat's target is an answer within ${AUTOMATION_RULES.objectionTargetHours} hours.`,
  decided: (decidedAt: string) => `A person has decided since: the decision of ${decidedAt}, listed under Settings, Cases.`,
  decidedLink: "Open that decision",
  notOpen: "A person has decided since: the decision is listed under Settings, Cases.",
  /** 3d review L10 (people8): objection_exists, a second request from a stale screen or another device; nobody has decided. */
  exists: "You have already asked for a person about this decision. A person reads what you wrote.",
} as const;

export const CASES_WORDS = {
  nav: "Cases",
  title: "Cases",
  tabs: { about: "About you", reports: "Your reports" },
  noDecisions: "korbat has made no decision about your posts or your profile.",
  noReports: "You have sent no reports.",
  post: (time: string) => `Your post of ${time}`,
  profile: "Your profile",
  law: "the law",
  rule: (id: string) => `Rule ${id}`,
  decidedOn: (day: string) => `Decided on ${day}`,
  whileDeciding: "while korbat decides",
  ended: "What korbat did while deciding has ended",
  noAction: "No action",
  /** A review that kept the decision lifts nothing, and is no decision to take no action. */
  keptDecision: "korbat kept its decision",
  review: "the answer to your appeal",
  correction: "a correction by korbat",
  appealOpen: (until: string) => `You can appeal until ${until}`,
  /** Where the author's appeal of a decision stands, in the list. */
  appealState: {
    pending: "Your appeal waits for a reviewer",
    kept: "Your appeal was answered: korbat kept its decision",
    partly_reversed: "Your appeal was answered: korbat reversed part of its decision",
    reversed: "Your appeal was answered: korbat reversed its decision",
  },
  reversed: (day: string) => `Reversed in full on ${day}`,
  more: "Show more",
  report: (ref: string, time: string) => `Report ${ref}, sent on ${time}`,
  mailStopped: "korbat does not email you about your reports, because someone using your email address asked it to stop. Their outcomes are listed here.",
  resume: "Email me about my reports again",
  resumeHint: "korbat may then also email this address about reports sent without an account that give it.",
} as const;

export const DECISION_WORDS = {
  title: "korbat's decision",
  /** 3d (design, section 9.1): the link after the rule a statement names. */
  rulesPage: "The rules page",
  back: "All cases",
  statement: "Statement of reasons",
  content: "What this decision was made on",
  post: (time: string) => `Your post of ${time}`,
  noText: "The post had no text.",
  displayName: "Display name",
  bio: "Bio",
  handle: "Handle",
  empty: "(empty)",
  r4Redacted: "Content erased when the R4 decision became final",
  erased: (day: string) => `korbat's copy of the content this decision was made on was erased on ${day} under its retention rules (Terms, Your data).`,
  postKept: "The post itself stays in your profile while you keep it.",
  deleted: "You deleted this post. korbat keeps this copy for the case for the periods in its terms.",
  deletedImages: "Images kept for the case, not shown",
  resetDecision: "The decision that reset it",
  appeal: "Appeal",
  appealUntil: (until: string) => `You can appeal this decision until ${until}.`,
  /** The appeal's form: a statement is optional and free of form. */
  appealHint: "Tell us anything you want the reviewer to know. You do not need to cite rules or law.",
  appealStatement: "Your appeal (optional)",
  appealFiled: (day: string) => `You appealed on ${day}.`,
  /** A pending appeal: that it waits for a reviewer, or, when nobody at korbat can review it now, why. */
  appealWaiting: "Waiting for a reviewer",
  appealWaits: {
    none_single_staff: "Your appeal waits for a moderator who did not take part in the decision. korbat has one moderator at the moment.",
    none_eligible: "Your appeal waits for a moderator who took no part in this case. None is available now; your appeal stays open until one is.",
    admin: "Your appeal waits for an admin who did not take part in the decision.",
    oneAdmin: "korbat has one admin at the moment.",
    sealed: "Sealed images are reviewed once the authorities have assessed them. Your appeal stays open until then.",
  },
  appealAnswered: (day: string) => `Answered on ${day}`,
  appealAnswer: "The answer to your appeal",
  answerScreen: "This answer on a screen of its own",
  reversed: (day: string) => `Reversed in full on ${day}: nothing of this decision is in force, so there is nothing to appeal.`,
  notFound: "That decision does not exist, or it is not about your account.",
  /** A statement is never rendered with another version of the rules than the one it was made under. */
  cannotRender: "This decision was made under a version of the rules this page does not hold yet. Reload the page to read it.",
} as const;

/** The chip on the author's own withheld or removed post, and the labels on their own images. */
export const CHIP_WORDS = {
  underReview: "Under review",
  removed: "Removed",
  illegal: "illegal content",
} as const;

/**
 * 3d (design, sections 7.1 and 9.6): what the author reads in the place of an image of their own post that did not load,
 * once the image's status says why: its files are being moved back after its seal was lifted ([image.restoring]), or
 * korbat lost them while they were kept apart ([image.lost], the words of the mail image_lost, IMAGE_LOST_NOTICE). Anyone
 * else sees what a missing image shows.
 */
export const IMAGE_FAULT_WORDS = {
  restoring: "This image is being restored. It is shown again once korbat has moved it back; you do not need to do anything.",
  lost: IMAGE_LOST_NOTICE.onImage,
} as const;

/**
 * 3d Task 2 (design, sections 7.2 and 9.6; W.6): a release of sealed images of the author's posts, on its screen under
 * Settings, Cases, and its entry in "About you". The notice's paragraphs are RELEASE_NOTICE's (packages/rules), which the
 * mail release_notice shares; these are the screen's own words around them. None names an authority, a reference or an
 * assessment.
 */
export const RELEASE_TEXTS = {
  title: "Sealed images released",
  /** The entry in "About you", with its day. */
  entry: "Sealed images released",
  entryOn: (day: string) => `On ${day}`,
  noticesTitle: "Notices",
  /** The link to the decision that sealed. 3d review L11: the notice's own paragraph says where its appeal stands. */
  decision: "The decision that sealed the images",
  notFound: "That notice does not exist, or it is not about your posts.",
} as const;

/**
 * 3d Task 7 (design, sections 9.5, 9.6 and 9.7): a refused upload as its uploader sees it: the composer's tile
 * [upload.refused] with its link "Why", the post refused while it is attached [upload.refusedPost], the entry in "About
 * you", and on the notice's screen "Object" [upload.object] under [upload.objectLead], then [upload.objected]. The
 * notice's own paragraphs are UPLOAD_NOTICE's (W.5), which the mails share.
 */
export const UPLOAD_TEXTS = {
  title: "An upload was not accepted",
  entry: "An upload was not accepted",
  entryOn: (day: string) => `On ${day}`,
  refused: "This image was not accepted.",
  why: "Why",
  refusedPost: "This image was not accepted, so the post was not sent. Remove the image to post. Its notice is under Settings, Cases.",
  object: "Object",
  // 3d review L7 (people5): the terms' period (Your data), the upload's record of a match, which outlasts the file.
  objectLead: "Write anything the admin should know. You can send one message. The admin reads it and decides without viewing the image. What you write is kept as long as this upload's record of a match (Terms, Your data).",
  objectField: "Your message to the admin",
  objected: (objectedAt: string) => `You objected on ${objectedAt}. An admin reads what you wrote; korbat tells you here what was decided, and by email when the hold is lifted.`,
  /** objection_not_open on this screen: the objection is sent, or the hold has ended. */
  notOpen: "You cannot object now: you objected already, or the hold has ended. Read the notice again.",
  notFound: "That notice does not exist, or it is not about your uploads.",
} as const;

/** The terms page's Contact section, built from the build's contact address; it is not part of the terms' own sections. */
export const CONTACT_WORDS = {
  title: "Contact",
  body: (contact: string) => `Write to korbat at ${contact} when the report form does not work for you, to ask for your data, or about a decision. A person reads every email. Do not attach images or files: korbat does not open them.`,
  report: "Report something on korbat",
} as const;
