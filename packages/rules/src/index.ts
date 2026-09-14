/**
 * The public rulebook. This is the complete list of reasons content can be
 * actioned on korbat. Opinions are never a reason. Every moderation case
 * cites exactly one of these IDs.
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
  seniorQueue: boolean;
}

export const RULES = [
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

export type RuleId = (typeof RULES)[number]["id"];

const byId = new Map<string, Rule>(RULES.map((r) => [r.id, r]));

export function getRule(id: string): Rule | undefined {
  return byId.get(id);
}

export function isRuleId(id: string): id is RuleId {
  return byId.has(id);
}
