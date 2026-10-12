/**
 * The public rulebook. korbat restricts content when it breaks one of these rules, or when it is illegal under EU law or
 * the law of an EU country and korbat is told about it in a notice. Opinions are never a reason. Every decision cites one
 * of these rules or the law.
 *
 * The rulebook is versioned: a decision records the version it was made under, and its statement is always rendered with
 * that version's text, so an old statement reads exactly as it was sent whatever the rules say now.
 */
export type Automation =
  | "none"                 // report-driven, human decides
  | "withhold_for_review"  // automation may hide from others pending a human
  | "auto_remove";         // automation may remove (R2 only)

export interface Rule {
  id: string;
  title: string;
  text: string;
  allowed: string[];
  notAllowed: string[];
  automation: Automation;
  /** Decided by an admin: every final decision under the rule, whether it acts or not. */
  seniorQueue: boolean;
}

/** Version 1: the six rules as they stood before moderation cases. Kept as it was, for the decisions made under it. */
const RULES_V1 = [
  {
    id: "R1",
    title: "No sexual or pornographic content",
    text: "Images or text whose primary purpose is sexual arousal are not allowed. This includes nudity presented sexually, explicit sexual acts, and sexualised depictions of anyone. Images that score high on the automated check are hidden from others until a person reviews them; the author can always see their own post.",
    allowed: ["Medical or educational discussion of sexuality without explicit imagery", "Art with non-sexual nudity in a clearly artistic or historical context", "Frank discussion of sexual politics or policy"],
    notAllowed: ["Pornographic images or video", "Sexually explicit text posted for arousal", "Links whose preview is pornographic"],
    automation: "withhold_for_review",
    seniorQueue: false,
  },
  {
    id: "R2",
    title: "No child sexual abuse material",
    text: "Any sexualised depiction of a minor is removed automatically on a hash match, the account is suspended, and the material is reported to the relevant authority. This is the only rule enforced without a human decision first. Appeals are reviewed by a senior moderator.",
    allowed: ["Reporting or discussing child safety issues without imagery", "News about arrests or legislation"],
    notAllowed: ["Any sexualised image of a minor, real or generated", "Links to such material", "Solicitation"],
    automation: "auto_remove",
    seniorQueue: true,
  },
  {
    id: "R3",
    title: "No targeted hatred or harassment based on protected traits",
    text: "Attacking a person or group because of race, ethnicity, national origin, religion, disability, sex, sexual orientation, or gender identity is not allowed. Criticising ideas, beliefs, policies, institutions, public figures, or the actions of groups is allowed, even harshly. The line is attacking people for what they are, not disagreeing with what they think or do.",
    allowed: ["Criticism of any religion's doctrine or any government's policy", "Arguing that a political movement is wrong or harmful", "Blunt, offensive, or unpopular opinions about ideas"],
    notAllowed: ["Slurs directed at a person or group", "Calling for a protected group to be harmed or excluded", "Sustained pile-ons against one person because of a protected trait"],
    automation: "none",
    seniorQueue: false,
  },
  {
    id: "R4",
    title: "No doxxing",
    text: "Publishing someone's private information without consent is not allowed: home address, phone number, private email, workplace details intended to enable harassment, financial or ID documents, or private images. When a report is credible the post is hidden from others while a person decides, because the harm is immediate.",
    allowed: ["Public business contact details", "Information a public figure has published about themselves", "Linking to public court records in a news context"],
    notAllowed: ["Posting someone's home address or phone number", "Sharing private messages or images without consent", "Coordinating to find where someone lives"],
    automation: "none",
    seniorQueue: false,
  },
  {
    id: "R5",
    title: "No direct threats of violence",
    text: "Stating an intent to physically harm a specific person or group, or calling for others to do so, is not allowed. Hyperbole, dark humour, and discussion of violence in news, history, or fiction are allowed. Cases go to the senior queue.",
    allowed: ["Discussing wars, crimes, or historical violence", "Obvious hyperbole ('I could kill for a coffee')", "Fiction and satire"],
    notAllowed: ["'I will hurt you' directed at a person", "Calling for a named person to be attacked", "Posting a target list"],
    automation: "none",
    seniorQueue: true,
  },
  {
    id: "R6",
    title: "No spam, scams, or impersonation",
    text: "Repetitive unsolicited posting, deceptive schemes, malware links, and pretending to be another person or organisation are not allowed. Parody and fan accounts are fine when clearly labelled.",
    allowed: ["Promoting your own work in your own posts", "Clearly labelled parody accounts", "Sharing a link once in a relevant thread"],
    notAllowed: ["Posting the same link across many threads", "Phishing or crypto giveaway scams", "An account presenting itself as a real person or brand it is not"],
    automation: "none",
    seniorQueue: false,
  },
] as const satisfies readonly Rule[];

/**
 * Version 2, with moderation cases: nothing is automated (a person decides every case; the automated checks of R1 and R2
 * return with a later version), R2 says how reported images are handled without anyone opening them, R4 and R5 say who
 * hides content while a case is decided and who decides it, and R6 names coordinated manipulation. R3 is unchanged.
 */
const RULES_V2 = [
  {
    ...RULES_V1[0],
    text: "Images or text whose primary purpose is sexual arousal are not allowed. This includes nudity presented sexually, explicit sexual acts, and sexualised depictions of anyone.",
    automation: "none",
  },
  {
    ...RULES_V1[1],
    text: "Any sexualised depiction of a minor is not allowed. Nobody at korbat opens images that are reported or found as such material while the report is unanswered or the images are sealed. After an admin has answered without a seal, staff may open them like any other image. Whoever is on duty may seal them while an admin decides: sealed images are shown to nobody, their author included. An admin either seals them for good, in which case they are kept only for the authorities and reported to them, or answers without a seal. Every final decision on a report or finding under this rule, whether it acts or not, and every review of one, is taken by an admin. Only an admin can lift a seal, and a seal for good only on the authorities' answer; an appeal of a seal waits until the authorities have assessed the images.",
    automation: "none",
  },
  RULES_V1[2],
  {
    ...RULES_V1[3],
    text: "Publishing someone's private information without consent is not allowed: home address, phone number, private email, workplace details intended to enable harassment, financial or ID documents, or private images. When a moderator finds a report credible, the post is hidden from others while the moderator decides, because the harm is immediate. The number of reports never decides it.",
  },
  {
    ...RULES_V1[4],
    text: "Stating an intent to physically harm a specific person or group, or calling for others to do so, is not allowed. Hyperbole, dark humour, and discussion of violence in news, history, or fiction are allowed. Any moderator may hide a reported threat from others at once while an admin decides, and may lift that again. Every final decision on a report under this rule, whether it acts or not, is taken by an admin, and only an admin corrects one. An appeal against a restriction under it is reviewed by a moderator who made none of the case's decisions and did not report it themselves, and waits while korbat has none.",
  },
  {
    ...RULES_V1[5],
    title: "No spam, scams, impersonation or coordinated manipulation",
    text: "Repetitive unsolicited posting, deceptive schemes, malware links, and pretending to be another person or organisation are not allowed. Parody and fan accounts are fine when clearly labelled. Coordinating several accounts, your own or other people's, to like, repost or report together is not allowed.",
    allowed: [...RULES_V1[5].allowed, "Asking your followers to read or share a post"],
    notAllowed: [...RULES_V1[5].notAllowed, "A group of accounts liking each other's posts on cue to lift them in Explore", "Reporting someone together to get them removed"],
  },
] as const satisfies readonly Rule[];

/** The version a decision made now records. */
export const RULES_VERSION = 2;

/** Every version of the rulebook, by its number. */
export const RULEBOOKS = { 1: RULES_V1, 2: RULES_V2 } as const satisfies Record<number, readonly Rule[]>;

/** The rules in force. */
export const RULES = RULEBOOKS[RULES_VERSION];

export type RuleId = (typeof RULES)[number]["id"];

/** A rule as one version of the rulebook words it: the current version unless told. Undefined for an id or a version that does not exist. */
export function getRule(id: string, version: number = RULES_VERSION): Rule | undefined {
  const book: readonly Rule[] | undefined = (RULEBOOKS as Record<number, readonly Rule[]>)[version];
  return book?.find((rule) => rule.id === id);
}

export function isRuleId(id: string): id is RuleId {
  return RULES.some((rule) => rule.id === id);
}

/** What a statement of reasons tells its author they can do about the decision. Which text applies follows from the decision's own kind and outcome. */
export interface RedressTexts {
  /** A final decision that restricts: korbat's appeal. `{deadline}` stands for the last day of the appeal, which the statement fills in. */
  appeal: string;
  /** A decision taken while korbat decides. */
  interim: string;
  /** Any other decision, which its author cannot appeal. */
  notAppealable: string;
}

/** The version of the redress texts a decision made now records. */
export const REDRESS_VERSION = 1;

const OUTSIDE_KORBAT = "complain to the Digital Services Coordinator of the EU country where you live (Article 53 of the Digital Services Act).";

/** Every version of the redress texts, by its number, kept as the rulebooks are. */
export const REDRESS_TEXTS = {
  1: {
    appeal: `You can appeal this decision once, free of charge, within six months of being told, until {deadline}: choose "Appeal" on this decision's screen under Settings, Cases. A moderator who took no part in the case reviews it. You can also go to court, or ${OUTSIDE_KORBAT}`,
    interim: `This applies while korbat decides, and ends with its decision. If korbat's decision restricts your post or profile, you can appeal it. You can also go to court, or ${OUTSIDE_KORBAT}`,
    notAppealable: `korbat's appeal does not apply to this decision. Where an earlier decision about this content still stands in part, its own screen in korbat says whether you can still appeal it. You can go to court, or ${OUTSIDE_KORBAT}`,
  },
} as const satisfies Record<number, RedressTexts>;

/** The redress texts of one version. Undefined for a version that does not exist. */
export function getRedress(version: number): RedressTexts | undefined {
  return (REDRESS_TEXTS as Record<number, RedressTexts>)[version];
}

// The statement of reasons, rendered over the rulebooks and the redress texts above. The package exports only this file,
// so the app, the console and the API reach the statement through it.
export { STATEMENT_WORDS, statementParagraphs, type StatementInput } from "./statement";
