import { z } from "zod";
import { Email, OpaqueId, TurnstileToken } from "./auth";
import { hex, sha256, sha256Bytes, sortedJson, utf8 } from "./canonical";
import { ImportSource } from "./imports";
import { EDGE_RULES, EdgePurgeView, MediaId } from "./media";
import { ALERT_CHANNEL_STATES, GAP_CLASSES, GAP_DISPOSITIONS, ORDER_RULES, OrderNoticeFacts, OrderTexts, OrdersUnverified, ReportsOwed, type OrderGround } from "./orders";
import { AUTOMATION_RULES, MATCH_ANSWER_REASONS, MATCH_HASH_TYPES, MATCH_KINDS, SIGNAL_KINDS, UPLOAD_END_REASONS, UPLOAD_ENDS } from "./automation";
import { FORBIDDEN_FORMAT } from "./text";

// Moderation cases (3c design, section 10): the constants and digests that the database, the API, the console, the app,
// the mails and the terms share. Each is the one source its words and numbers are taken from. This module imports
// nothing from staff.ts, and the index evaluates it first, so staff.ts can read these constants while it loads; an import
// the other way round would be a cycle that fails at load. For the same reason it imports nothing from social.ts, whose
// shapes may come to name this module's constants: what a notice needs of a post's id and of a handle is written here.

// ---------------------------------------------------------------- rules, categories and keywords

/** The rulebook's rule ids. @korbat/rules holds the rules themselves; the contracts never import it. */
export const RULE_IDS = ["R1", "R2", "R3", "R4", "R5", "R6"] as const;
export type RuleId = (typeof RULE_IDS)[number];

/**
 * The 16 categories of the Commission's Transparency Database (read 2026-10-02), which every intake and decision carries.
 * The migration's CHECK lists are written from this constant, and a database test holds them to it. A value the
 * Commission removes stays here: a kept row may hold it, and only the lists offered for new input drop it.
 */
export const TDB_CATEGORIES = [
  "STATEMENT_CATEGORY_ANIMAL_WELFARE",
  "STATEMENT_CATEGORY_CONSUMER_INFORMATION",
  "STATEMENT_CATEGORY_CYBER_VIOLENCE",
  "STATEMENT_CATEGORY_CYBER_VIOLENCE_AGAINST_WOMEN",
  "STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS",
  "STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH",
  "STATEMENT_CATEGORY_INTELLECTUAL_PROPERTY_INFRINGEMENTS",
  "STATEMENT_CATEGORY_NEGATIVE_EFFECTS_ON_CIVIC_DISCOURSE_OR_ELECTIONS",
  "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE",
  "STATEMENT_CATEGORY_OTHER_VIOLATION_TC",
  "STATEMENT_CATEGORY_PROTECTION_OF_MINORS",
  "STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY",
  "STATEMENT_CATEGORY_SCAMS_AND_FRAUD",
  "STATEMENT_CATEGORY_SELF_HARM",
  "STATEMENT_CATEGORY_UNSAFE_AND_PROHIBITED_PRODUCTS",
  "STATEMENT_CATEGORY_VIOLENCE",
] as const;
export type TdbCategory = (typeof TDB_CATEGORIES)[number];

/** The two categories a notifier never chooses: a rule-only report gets the first, a notifier who is not sure the second. */
type UnofferedCategory = "STATEMENT_CATEGORY_OTHER_VIOLATION_TC" | "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE";
export type TdbFormCategory = Exclude<TdbCategory, UnofferedCategory>;

/** The 14 categories the illegal-ground form shows. */
export const TDB_FORM_CATEGORIES: readonly TdbFormCategory[] = TDB_CATEGORIES.filter(
  (category): category is TdbFormCategory => category !== "STATEMENT_CATEGORY_OTHER_VIOLATION_TC" && category !== "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE",
);

/**
 * The four choices of the path for child sexual abuse material and the Transparency Database keyword each stores. "abuse"
 * stores none: the database has no keyword for it.
 */
export const CSAM_KEYWORDS = {
  csam: "KEYWORD_CHILD_SEXUAL_ABUSE_MATERIAL",
  deepfake: "KEYWORD_CHILD_SEXUAL_ABUSE_MATERIAL_DEEPFAKE",
  grooming: "KEYWORD_GROOMING_SEXUAL_ENTICEMENT_MINORS",
  abuse: null,
} as const;
export type CsamKeywordChoice = keyof typeof CSAM_KEYWORDS;

/** The keywords a decision on the law may carry: in 3c only the Transparency Database's "Terrorist content". */
export const DECISION_KEYWORDS = ["KEYWORD_TERRORIST_CONTENT"] as const;
export type DecisionKeyword = (typeof DECISION_KEYWORDS)[number];

/** The category the composer presets for a decision under each rule. */
export const RULE_DEFAULT_CATEGORY = {
  R1: "STATEMENT_CATEGORY_OTHER_VIOLATION_TC",
  R2: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS",
  R3: "STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH",
  R4: "STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS",
  R5: "STATEMENT_CATEGORY_VIOLENCE",
  R6: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD",
} as const satisfies Record<RuleId, TdbCategory>;

// ---------------------------------------------------------------- lanes

/** The queue's lanes: 0 is the most urgent. A case takes the most severe lane of its unanswered items. */
export type Lane = 0 | 1 | 2;

/** R2 and R5 are urgent; R3 and R4 come next; R1 and R6 last. */
const RULE_LANES: Record<RuleId, Lane> = { R1: 2, R2: 0, R3: 1, R4: 1, R5: 0, R6: 2 };

/** The categories that are not in lane 2: violence, public security and self-harm are urgent; six more come next. */
const CATEGORY_LANES: Partial<Record<TdbCategory, Lane>> = {
  STATEMENT_CATEGORY_VIOLENCE: 0,
  STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY: 0,
  STATEMENT_CATEGORY_SELF_HARM: 0,
  STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS: 1,
  STATEMENT_CATEGORY_CYBER_VIOLENCE: 1,
  STATEMENT_CATEGORY_CYBER_VIOLENCE_AGAINST_WOMEN: 1,
  STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH: 1,
  STATEMENT_CATEGORY_PROTECTION_OF_MINORS: 1,
  STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE: 1,
};

/**
 * The lane of an intake's items, from its ground alone: nothing is weighted. The CSAM path is urgent whatever else is
 * said. Otherwise it is the more severe of the cited rule's lane and, on a notice that alleges illegality, the category's:
 * only there is the category a claim about the content, where on a rule report or a finding it is korbat's own
 * classification for the Transparency Database.
 */
export function laneFor(input: { ruleId: RuleId | null; allegesIllegal: boolean; csam: boolean; category: TdbCategory }): Lane {
  if (input.csam) return 0;
  const byRule: Lane = input.ruleId === null ? 2 : RULE_LANES[input.ruleId];
  const byCategory: Lane = input.allegesIllegal ? (CATEGORY_LANES[input.category] ?? 2) : 2;
  return byRule < byCategory ? byRule : byCategory;
}

// ---------------------------------------------------------------- limits and periods

/**
 * What one sender may send, published in the terms: intakes an hour and a day per network signed out and per account
 * signed in, the targets one notice names, and the bounds of its two texts in characters (the migration's CHECKs hold
 * the same numbers).
 */
export const NOTICE_LIMITS = {
  signedOut: { perHour: 5, perDay: 20 },
  signedIn: { perHour: 10, perDay: 50 },
  maxTargets: 10,
  explanationMax: 2000,
  citedLawMax: 300,
} as const;

/** A notice on the CSAM path names at most one account: one such target reaches every image on the account's posts. */
export const CSAM_NOTICE_MAX_ACCOUNTS = 1;

/** How many months back a case page counts earlier answers to reports of this kind about the same target or author. */
export const SUSPECT_EARLIER_MONTHS = 12;

/** How many rows of a seal's list the case answer carries. */
export const SEAL_LIST_MAX = 500;

/** The author's appeal and the re-examination window, in calendar months (appealDeadline, and appeal_deadline in SQL). */
export const APPEAL_MONTHS = 6;

/** Appeals a day per account, and re-examinations a day per account or network. */
export const DAILY_LIMITS = { appeals: 5, reexaminations: 5 } as const;

/**
 * The numbers of account sanctions, the same as the SQL function standing_rules() returns, which a database test compares
 * member by member: every function and view of the standing ledger reads its numbers from there, and every word of the
 * console and the app from here. Each is a cautious default without a source of its own, flagged for the owner (3e
 * design, section 2): one line to change in each place. It stands here, ahead of the section of account sanctions below,
 * because RETENTION reads three of its numbers.
 */
export const STANDING_RULES = {
  /** How long a strike counts. */
  strikeDays: 90,
  /** The active strikes that open the ladder. */
  ladderStrikes: 3,
  /** The most days of the first, second and third suspension of the ladder. */
  ladderDays: [3, 7, 30],
  /** How long a suspension of the ladder counts toward the next rung. */
  ladderMemoryDays: 365,
  /** The reply window, from the moment korbat's own relay accepted the notice mail, and never less from the decision. */
  replyWindowHours: 168,
  /** The window, from the decision, when the relay refused the address or the mail was given up. */
  undeliveredHours: 336,
  /** The most days of a suspension at once, by its ground. */
  threatDays: 30,
  terroristDays: 30,
  floodDays: 7,
  protectiveDays: 14,
  /** The count without which no flood is found: a condition, never the finding. */
  floodPosts: 20,
  floodMinutes: 60,
  /** The most age of the decision a threat or terrorist suspension rests on, and of the seal for good a protective one rests on. */
  basisAgeDays: 30,
  /** The frame of the reporting counts, by the day a report was sent, and a warning's time of counting. */
  reportFrameDays: 90,
  /** The warning's threshold: marked reports, and their share of the rule reports sent. */
  reportWarnMarks: 5,
  reportWarnShare: 0.5,
  /** The restriction's threshold, in marked reports sent after the warning, and its most days. */
  reportRestrictMarks: 3,
  reportRestrictDays: 30,
} as const;

/**
 * How long 3c keeps each kind of data (the design's section 6.6), published in the terms. Each is a design choice, not a
 * legal figure.
 */
export const RETENTION = {
  /** Content restricted under R4 is erased once the restriction is final: this long after its author was told, or at the answer to their appeal. */
  r4FinalMonths: APPEAL_MONTHS,
  /** An intake's record (its texts and who sent it) goes this long after its last release. */
  intakeDays: 30,
  /** A reset field's old value stays readable this long after a lift that comes before the case's copies are erased. */
  resetValueDays: 30,
  /** A case's evidence waits this long after the case's newest snapshot or draft text. */
  evidenceHours: 24,
  /** Statements are erased this long after the account's deletion. */
  statementMonths: 12,
  /** The access log, and the reveal reasons its rows name. */
  accessLogMonths: 12,
  /** A notifier's contact goes this long after the last day korbat owed the notice something, */
  contactMonths: 6,
  /** and at most this long after the notice when nothing moved that day. */
  contactMaxMonths: 13,
  /** A notifier's confirmation of an address. */
  confirmationDays: 30,
  /** Backups are deleted this long after each was taken. No code of 3c enforces it: the README tells the operator. */
  backupDays: 30,
  /** An unconfirmed staff text is deleted after this long. */
  draftHours: 24,
  /** A mail still unsent this long after it was due is given up. */
  mailGiveUpDays: 5,
  /**
   * 3e (design, sections 6.5, 6.7 and W.7): the text of a reply to a suspension or a termination is kept until it is
   * answered and its decision is final for its author (erase_reply_statements); an unanswered reply keeps it, however
   * old. No clock alone ends it, so it is a phrase, the one the terms print, and no number.
   */
  replyText: "until korbat has answered it and its decision can no longer be appealed",
  /**
   * 3e: the reporting counts (the marks "manifestly unfounded" and the daily tallies of rule reports) are deleted this
   * long after the UTC day their report was sent (forget_report_counts), and with the account. It is the frame of the
   * counts, read from STANDING_RULES and never typed twice.
   */
  reportCountDays: STANDING_RULES.reportFrameDays,
  /**
   * 3e: the ledger rows of strikes, suspensions, terminations, warnings and retired handles are kept with their decision,
   * as every row of the ledger is; what ends is their use, after these days: a strike's counting, a suspension's memory
   * toward the next rung, and a warning's counting. Each is STANDING_RULES' own number.
   */
  standingRecord: { strikeDays: STANDING_RULES.strikeDays, ladderMemoryDays: STANDING_RULES.ladderMemoryDays, warningDays: STANDING_RULES.reportFrameDays },
  /**
   * 3f (design, sections 6.8 and 10.1, W.6): how long a handled message at the contact point is kept (one never handled
   * is kept until a person closes it), how long what a removal order disabled is preserved from its disabling (and a day
   * more, ORDER_RULES.preserveMarginDays), how long an order's records and those of a notification or a production are
   * kept after the matter's last event, and a restore gap closed as not needed or imported. Each is order_rules()' own
   * number, read from ORDER_RULES and printed by the terms; the database holds the same numbers and acts on them.
   */
  contactMessageDays: ORDER_RULES.messageKeepDays,
  orderPreserveMonths: ORDER_RULES.preserveMonths,
  orderRecordYears: ORDER_RULES.recordKeepYears,
  restoreGapMonths: ORDER_RULES.gapKeepMonths,
  /**
   * 3d (design, sections 6.10 and W.9): the days a match record keeps its hash and classification after its case closed,
   * its hold ended or its images were released (automation_rules().match_keep_days, which erase_automation_records reads);
   * the days korbat keeps an uploader's address after a refused upload, 3f's hold on an address (order_rules()); and the
   * days an outbox row of the edge is kept after it was done, which the retention job's step edge_purges deletes. Each is
   * its own constant's number, read from there, never typed twice; the terms print all three.
   */
  matchKeepDays: AUTOMATION_RULES.matchKeepDays,
  reportHoldDays: ORDER_RULES.reportHoldDays,
  edgePurgeDays: EDGE_RULES.keepDays,
} as const;

// ---------------------------------------------------------------- account sanctions (3e design, section 10.1)

/** What a standing measure or a restriction of reporting rests on, as the ledger's check trigger forces it. The migration's CHECK list is written from it. */
export const STANDING_BASES = ["strikes", "threat", "terrorist", "flood", "protective", "threat_repeat", "ladder_end", "reports"] as const;
export type StandingBasis = (typeof STANDING_BASES)[number];

/** The bounds of `days` on a suspension and a restriction of reporting. */
export const STANDING_DAYS = { min: 1, max: 30 } as const;

/** The most characters of a reply to a standing measure: the bound of an appeal's statement. */
export const REPLY_TEXT_MAX = 2000;

/**
 * The hours after which a reply to a suspension or a termination that nobody answered joins the queue-age alert, and with
 * them korbat's published aim for answering a reply to a suspension taken at once (3e design, sections 7.7 step 6 and
 * 7.14): an aim, not a promise. The terms, the console and the alert print this number, never a literal.
 */
export const REPLY_AIM_HOURS = 24;

/** The most items one decision marks "manifestly unfounded" (a default, flagged with the other numbers). */
export const UNFOUNDED_MAX = 100;

/**
 * The composer's drafts of the facts of a standing measure or a reporting measure, and the reason of a protective
 * suspension (3e design, section 18, W.5). The console fills each placeholder in braces from the case answer it read, and
 * a draft that holds a count says when it was counted: the key signs the text, and the database checks its own numbers at
 * the commit. The moderator may edit them; they write the reason, except a protective suspension's.
 */
export const STANDING_DRAFTS = {
  facts: {
    strikes:
      "When this was written the account had {activeStrikes} active strikes. Each was given by a decision that found a breach of a korbat rule in a post, and each of those decisions was sent to the account with its reasons.",
    ladder_end:
      "When this was written the account had been suspended {n} times in the last {ladderMemoryDays} days, the last time by korbat's decision of {day}, and had {activeStrikes} active strikes again, one of them given since.",
    threat: "A final decision of korbat found a direct threat of violence in a post of this account.",
    terrorist: "A final decision of korbat found terrorist content in a post of this account.",
    threat_repeat: "A final decision of korbat found a direct threat of violence in a post that this account made after korbat had suspended it for an earlier threat.",
    flood: "The account made {posts} posts between {from} and {to}.",
    protective:
      "On {sealedOn} an admin of korbat decided to keep images of this account sealed, after they were reported as possible child sexual abuse material. korbat's staff do not open images reported this way, so korbat has not assessed them.",
    warn: "In the {frameDays} days up to {readDay} the account sent {reports} reports under korbat's rules. A moderator marked {unfounded} of them as manifestly unfounded: {marked}.",
    restrict: "Of the reports the account sent between korbat's warning of {warnedOn} and {readDay}, a moderator marked {marksSince} as manifestly unfounded: {marked}.",
  },
  reason: {
    protective:
      "An admin found the report credible enough to keep the images sealed and to report them to the police, who can assess them. korbat makes no finding that this account broke the law or a korbat rule. It stops the account from writing for a short, fixed time.",
  },
} as const;

// ---------------------------------------------------------------- measures

/**
 * The ledger's kinds, in the order of the database's action_kind: 3c's seven measures and five reversals, then 3e's six
 * measures (a strike, a suspension, a termination, a retired handle, a warning about reporting and a restriction of it)
 * and four reversals (3e design, section 10.1); then 3f's measure of an authority's order and its reversal (3f design,
 * section 10.1), which only an order decision and its correction hold; then 2d's reset of a profile picture and its
 * reversal (2d design, sections 6.5 and 7.7), appended by the migration avatar_kinds as ADD VALUE appends them.
 */
export const ACTION_KINDS = [
  "withhold",
  "remove",
  "seal_media",
  "withhold_media",
  "remove_media",
  "reset_display_name",
  "reset_bio",
  "restore",
  "unseal_media",
  "restore_media",
  "restore_display_name",
  "restore_bio",
  "strike",
  "suspend",
  "terminate",
  "retire_handle",
  "warn_reporting",
  "restrict_reporting",
  "overrule",
  "lift_suspension",
  "unretire_handle",
  "lift_reporting",
  "disable_by_order",
  "reinstate_by_order",
  "reset_avatar",
  "restore_avatar",
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

/**
 * What a measure acts on: a post, one image of it, every image its case reaches, one of an account's two fields, the
 * account itself (a strike, a suspension or a termination), its handle, or its reports under the rules; 2d: its profile
 * picture, the third field an account case resets.
 */
export type MeasureTarget = "post" | "image" | "images" | "display_name" | "bio" | "account" | "handle" | "reporting" | "avatar";

export interface MeasureSpec {
  /** A decision taken while deciding (interim) may hold it. */
  interim: boolean;
  /** A decision that decides the case (final) may hold it. */
  final: boolean;
  /** For a reversal, the measures it lifts (it names exactly one row of them); null for a measure. */
  lifts: readonly ActionKind[] | null;
  target: MeasureTarget;
  /** The words for it in the composer, the statement and the terms. */
  label: string;
}

/**
 * Every kind of the ledger: whether it is taken while deciding, when the case is decided, or is a reversal; its target;
 * and its label. A post or one image is withheld only while deciding and removed only when the case is decided; a seal
 * and a field reset are either. A reversal is neither: the database's triggers say which decision may hold one.
 */
export const MEASURES = {
  withhold: { interim: true, final: false, lifts: null, target: "post", label: "Withhold the post" },
  remove: { interim: false, final: true, lifts: null, target: "post", label: "Remove" },
  seal_media: { interim: true, final: true, lifts: null, target: "images", label: "Seal the images this case reaches" },
  withhold_media: { interim: true, final: false, lifts: null, target: "image", label: "Withhold one image" },
  remove_media: { interim: false, final: true, lifts: null, target: "image", label: "Remove one image" },
  reset_display_name: { interim: true, final: true, lifts: null, target: "display_name", label: "Reset display name" },
  reset_bio: { interim: true, final: true, lifts: null, target: "bio", label: "Reset bio" },
  restore: { interim: false, final: false, lifts: ["withhold", "remove"], target: "post", label: "Lift the restriction of the post" },
  unseal_media: { interim: false, final: false, lifts: ["seal_media"], target: "images", label: "Lift the seal" },
  restore_media: { interim: false, final: false, lifts: ["withhold_media", "remove_media"], target: "image", label: "Lift the restriction of one image" },
  restore_display_name: { interim: false, final: false, lifts: ["reset_display_name"], target: "display_name", label: "Lift the reset of the display name" },
  restore_bio: { interim: false, final: false, lifts: ["reset_bio"], target: "bio", label: "Lift the reset of the bio" },
  // 3e (design, section 18, W.1). Each measure of 3e is taken only when the case is decided, and none while deciding.
  strike: { interim: false, final: true, lifts: null, target: "account", label: "Strike" },
  suspend: { interim: false, final: true, lifts: null, target: "account", label: "Suspend the account" },
  terminate: { interim: false, final: true, lifts: null, target: "account", label: "Terminate the account" },
  retire_handle: { interim: false, final: true, lifts: null, target: "handle", label: "Retire the handle" },
  warn_reporting: { interim: false, final: true, lifts: null, target: "reporting", label: "Warn about reporting" },
  restrict_reporting: { interim: false, final: true, lifts: null, target: "reporting", label: "Restrict reporting" },
  overrule: { interim: false, final: false, lifts: ["strike"], target: "account", label: "Overrule the strike" },
  lift_suspension: { interim: false, final: false, lifts: ["suspend", "terminate"], target: "account", label: "Lift the suspension" },
  unretire_handle: { interim: false, final: false, lifts: ["retire_handle"], target: "handle", label: "Give the handle back" },
  lift_reporting: { interim: false, final: false, lifts: ["warn_reporting", "restrict_reporting"], target: "reporting", label: "Lift the reporting measure" },
  // 3f (design, section 18, W.1): neither is taken while deciding or when a case is decided; only an order decision holds
  // the first, and only the correction of one the second.
  disable_by_order: { interim: false, final: false, lifts: null, target: "post", label: "Disabled for an order" },
  reinstate_by_order: { interim: false, final: false, lifts: ["disable_by_order"], target: "post", label: "Reinstate after an order" },
  // 2d (design, section 7.7): reset_display_name's spec and its reversal's, with the target avatar.
  reset_avatar: { interim: true, final: true, lifts: null, target: "avatar", label: "Reset profile picture" },
  restore_avatar: { interim: false, final: false, lifts: ["reset_avatar"], target: "avatar", label: "Lift the reset of the profile picture" },
} as const satisfies Record<ActionKind, MeasureSpec>;

/** The fifteen measures and the eleven reversals, each list in the ledger's order: what a statement's data keeps apart. */
export const MEASURE_KINDS = [
  "withhold",
  "remove",
  "seal_media",
  "withhold_media",
  "remove_media",
  "reset_display_name",
  "reset_bio",
  "strike",
  "suspend",
  "terminate",
  "retire_handle",
  "warn_reporting",
  "restrict_reporting",
  "disable_by_order",
  "reset_avatar",
] as const satisfies readonly ActionKind[];
export type MeasureKind = (typeof MEASURE_KINDS)[number];
export const REVERSAL_KINDS = ["restore", "unseal_media", "restore_media", "restore_display_name", "restore_bio", "overrule", "lift_suspension", "unretire_handle", "lift_reporting", "reinstate_by_order", "restore_avatar"] as const satisfies readonly ActionKind[];
export type ReversalKind = (typeof REVERSAL_KINDS)[number];

/** The three kinds whose action entry also signs `days` and `announced` (3e design, section 10.4). */
export const TIMED_KINDS = ["suspend", "terminate", "restrict_reporting"] as const satisfies readonly ActionKind[];
export type TimedKind = (typeof TIMED_KINDS)[number];

/**
 * The console's fixed drafts of the facts and the reason of a seal (3c design, section 10). Nobody at korbat opens images
 * that are reported as child sexual abuse material, so none of these says or implies that korbat found them to be such
 * material, and each reason says that korbat's staff do not open them: the statement then tells its author what korbat
 * knows and no more. The composer fills them in, and the moderator may edit them. The two `added` drafts are for a case
 * whose suspect items korbat added for a quoted post: they never say that this post was reported, and name no other post.
 */
export const SEAL_DRAFTS = {
  facts: {
    notice_post: "korbat received a notice that reports images of this post as child sexual abuse material.",
    notice_account: "korbat received a notice that reports this account for child sexual abuse material. It does not say which images, so korbat sealed every image on the account's posts.",
    notice_added: "korbat received a notice about content on korbat that shows this post's images and reports them as child sexual abuse material.",
    finding_post: "A moderator reported images of this post as possible child sexual abuse material.",
    finding_account: "A moderator reported images on this account's posts as possible child sexual abuse material. korbat sealed every image on the account's posts.",
    finding_added: "A moderator reported content on korbat that shows this post's images as possible child sexual abuse material.",
    /**
     * 3d Task 7 (W.3): a seal for good on a case whose only suspect items are a program's. {comparison} is W.3's clause of
     * the comparison (@korbat/rules), with "this post" for "your post" and a capital letter, which the console fills in;
     * the draft says what the comparison found and not that anyone reported the images, and holds no hash, no list version
     * and no classification string.
     */
    match_post: "{comparison}. korbat's staff do not open such an image, and korbat has not assessed it.",
  },
  reason: {
    deciding: "korbat's staff do not open images reported this way, so korbat has not assessed them. It hides them from everyone, you included, until an admin has answered the report.",
    final:
      "korbat's staff do not open images reported this way, so korbat has not assessed them. An admin found the report credible enough to keep the images sealed and to report them to the police, who can assess them.",
  },
} as const;

/**
 * The facts draft of a seal, chosen from the suspect items its decision considers: a notice's draft when any of them came
 * from a user's notice, else a finding's; the `added` form when every one of them is an item korbat added for a quoted
 * post (or a re-examination of one), else the post's or the account's by the case's target.
 */
export function sealFactsDraft(target: "post" | "account", items: readonly { source: "user" | "finding"; added: boolean }[]): string {
  if (items.length === 0) throw new Error("a seal's facts are drafted from the suspect items its decision considers: there is no suspect item");
  const from = items.some((item) => item.source === "user") ? "notice" : "finding";
  const about = items.every((item) => item.added) ? "added" : target;
  return SEAL_DRAFTS.facts[`${from}_${about}`];
}

/**
 * One measure or reversal as a decision's confirmed params name it: its kind, and for an image measure the image; for a
 * suspension, a termination and a restriction of reporting also its days and whether it is announced (3e design,
 * section 10.4).
 */
export interface DecisionActionParams {
  kind: ActionKind;
  mediaId: string | null;
  days?: number | null;
  announced?: boolean;
  /** 3f: a reinstatement after an order signs its ground (staff.ts, ReinstateAction). */
  orderGround?: OrderGround;
}

/**
 * The one order a decision's actions are confirmed in: by kind and then by image, each compared as a string, an action
 * without an image first. The console sorts with it before it asks for the key, and the params' schema refuses any other
 * order, so the same decision always has the same hash.
 */
export function compareDecisionActions(a: DecisionActionParams, b: DecisionActionParams): number {
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  const [left, right] = [a.mediaId ?? "", b.mediaId ?? ""];
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Why a moderator reveals who sent a report: the choices of the reveal dialog. The reason itself is a saved text. */
export const REVEAL_REASON_CATEGORIES = ["impersonation_claim", "abuse_of_reporting", "legal_requirement", "other"] as const;
export type RevealReasonCategory = (typeof REVEAL_REASON_CATEGORIES)[number];

// ---------------------------------------------------------------- errors

/**
 * Every code the moderation flows put in ErrorEnvelope.error.code: what sending a report or a notice, reading its
 * status, asking for a re-examination, appealing, taking a report in, deciding a case and reviewing an appeal raise, and
 * what the console's case routes answer (a text that cannot be saved, an image that is not shown, a source that cannot
 * be revealed). The routes may also answer the shared invalid_request, onboarding_required, not_found, rate_limited and
 * service_unavailable, and the staff routes the staff codes. The codes the database keeps to itself (moderation_column,
 * quote_item_missing, read_committed_only) are not among them: no route answers one.
 */
export const ModerationErrorCode = z.enum([
  "notice_link_invalid",
  "notice_link_offsite",
  "human_check_failed",
  "staff_cannot_report",
  "notice_not_found",
  "already_reported",
  "appeal_not_open",
  "appeal_exists",
  "reexamination_not_open",
  "reexamination_exists",
  "case_changed",
  "case_closed",
  "staff_recused",
  "staff_target",
  "admin_required",
  "reviewer_conflict",
  "decision_cap",
  "profile_changed",
  "snapshot_mismatch",
  "snapshot_erased",
  "text_not_found",
  "invalid_decision",
  "text_invalid",
  "text_quotes_user",
  "image_refused",
  "reveal_refused",
  // 3e (design, section 10.5): a rule report of an account whose reports are restricted, a reply to a measure that takes
  // none, a decision whose strike is missing or not due, a second standing measure, and a termination under R2.
  "reporting_restricted",
  "reply_not_open",
  "strike_mismatch",
  "standing_conflict",
  "ground_not_established",
  // 3f (design, section 10.6): a message at the contact point that already has its disposition; and Task 2's order
  // records: a named message that is not there, an order of the same state, authority and reference (which carries the
  // order that stands), a closed order, an event the order's state does not take, an extension after the release.
  "message_handled",
  "order_needs_message",
  "order_exists",
  "order_closed",
  "order_event_refused",
  "already_released",
  // Task 3 (giving effect): an effect signed on facts the order no longer has; an unverified DSA Article 9 order without
  // an admin's urgent; the day's order decisions of one account; korbat's appeal of an order's decision.
  "order_changed",
  "order_not_verified",
  "order_cap",
  "not_appealable",
  // Task 6 (recovery): a gap that is not open, or a decision that does not take again what it lost; a copy mark for a
  // place that does not hold the named hash, or that the caller's own newest confirmed download did not release.
  "gap_mismatch",
  "copy_mismatch",
  // 3d Task 2 (design, section 10.7): the release of a seal, refused by seal_release in the order of its checks, or at
  // commit by releases_confirmed when what the key signed is not what was released.
  "release_not_open",
  "release_not_reported",
  "release_not_quarantined",
  "release_preserved",
  "release_no_leave",
  "release_period_unset",
  "release_period_running",
  "release_mismatch",
  // 3d Task 6 (design, section 10.7): "Ask for a person" on a decision that is not a program's or whose measure has ended;
  // (3d review L10) a second time while the first request is open; and the two refusals of a program's measure, which
  // the automated step records on its signal and no route answers.
  "objection_not_open",
  "objection_exists",
  "already_protected",
  "automation_capped",
  // 3d Task 7 (design, section 10.7): the end of a held upload's hold that its state does not allow, or without its reason
  // or with one too many; and an image that an unerased match record names, which staff are never served.
  "hold_not_open",
  "invalid_hold_end",
  "image_matched",
]);
export type ModerationErrorCode = z.infer<typeof ModerationErrorCode>;

// ---------------------------------------------------------------- reports and notices

/**
 * The rules a report or a notice may cite. R2 is offered nowhere: a report of child sexual abuse material goes a path of
 * its own, which records no sender, and only a moderator's finding cites R2 (the database refuses a user's intake that
 * does).
 */
export const REPORT_RULE_IDS = ["R1", "R3", "R4", "R5", "R6"] as const satisfies readonly RuleId[];
export type ReportRuleId = (typeof REPORT_RULE_IDS)[number];

/** How many characters the name a signed-out notifier gives may have. */
export const NOTICE_NAME_MAX = 100;

/** Any control character but the line feed. */
const TEXT_CONTROL = /[^\P{Cc}\n]/u;
/** Any control character at all: a name is one line. */
const LINE_CONTROL = /\p{Cc}/u;

const NOT_WELL_FORMED = { message: "half of a surrogate pair is not text" };
const NO_CONTROL = { message: "control characters are not allowed" };
const NO_FORMAT = { message: "invisible direction and spacing characters are not allowed" };
const SOME_TEXT = { message: "some text is needed" };

/**
 * A free text of a notice. The server stores it as it was written or refuses it, and never changes it: a well-formed
 * string with some text in it, no control character but the line feed, none of the invisible direction and spacing
 * characters, and at most `max` characters as PostgreSQL's char_length counts them, which is what the tables' CHECKs hold.
 */
const noticeText = (max: number) =>
  z
    .string()
    // A character outside the basic plane is two UTF-16 units, so this bound never refuses what the count below accepts.
    .max(2 * max)
    .refine(isWellFormed, NOT_WELL_FORMED)
    .refine((text) => !TEXT_CONTROL.test(text), NO_CONTROL)
    .refine((text) => !FORBIDDEN_FORMAT.test(text), NO_FORMAT)
    .refine((text) => text.trim().length > 0, SOME_TEXT)
    .refine((text) => Array.from(text).length <= max, { message: `at most ${max} characters` });

/** The name a signed-out notifier may give: one line under the same rules. */
const NotifierName = z
  .string()
  .max(2 * NOTICE_NAME_MAX)
  .refine(isWellFormed, NOT_WELL_FORMED)
  .refine((name) => !LINE_CONTROL.test(name), NO_CONTROL)
  .refine((name) => !FORBIDDEN_FORMAT.test(name), NO_FORMAT)
  .refine((name) => name.trim().length > 0, SOME_TEXT)
  .refine((name) => Array.from(name).length <= NOTICE_NAME_MAX, { message: `at most ${NOTICE_NAME_MAX} characters` });

/** A post's id in the lower case PostgreSQL returns, so an id written in any case names the same row. */
const TargetPostId = z.uuid().transform((id) => id.toLowerCase());

/** A handle as a notice names it: an optional leading @, then the 3 to 20 characters handles may contain, kept in lower case. */
const TargetHandle = z
  .string()
  .trim()
  .regex(/^@?[A-Za-z0-9_]{3,20}$/)
  .transform((value) => value.replace(/^@/, "").toLowerCase());

/**
 * A link as a notice gives it: an http or https address of at most 300 characters, kept as written. Whether it is an
 * address of this korbat, and of what, the route decides.
 */
const TargetLink = z.url({ protocol: /^https?$/ }).max(300);

/**
 * What a report or a notice names: a post by its id, optionally with the one of its images that is meant; an account by
 * its handle; or a korbat link, which the server parses. Nothing else can be named, and nothing can be attached.
 */
export const NoticeTarget = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("post"), id: TargetPostId, mediaId: MediaId.optional() }),
  z.strictObject({ kind: z.literal("account"), handle: TargetHandle }),
  z.strictObject({ kind: z.literal("link"), url: TargetLink }),
]);
export type NoticeTarget = z.infer<typeof NoticeTarget>;

const NoticeTargets = z.array(NoticeTarget).min(1).max(NOTICE_LIMITS.maxTargets);
const ReportRule = z.enum(REPORT_RULE_IDS);

/** The categories an illegal-ground notice may carry: the 14 the form shows, and "not specified" for someone who is not sure. */
const NoticeCategory = z.enum([...TDB_FORM_CATEGORIES, "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE"] as const);

/** The four choices of the path for child sexual abuse material. */
const CsamChoice = z.enum(Object.keys(CSAM_KEYWORDS) as [CsamKeywordChoice, ...CsamKeywordChoice[]]);

/**
 * One report or notice, by its ground. Each ground is a strict shape, so a member that belongs to another ground is
 * refused rather than ignored:
 *   - `rule`: it breaks a korbat rule (any but R2), with an optional explanation;
 *   - `illegal`: an Art. 16 notice that it is illegal, with the category, the explanation and the statement of good
 *     faith the Article asks for, optionally the law, a rule it also breaks and, from someone signed out, a name and an
 *     address (a signed-in sender's contact is their account, and the route refuses either from them);
 *   - `csam`: the path for child sexual abuse material, which asks no name or address and records no sender; its
 *     explanation and statement are optional, and it names at most CSAM_NOTICE_MAX_ACCOUNTS accounts, counted by the
 *     handles as named (the route counts again once the links are parsed).
 * `turnstileToken` is the human check of a signed-out sender; a signed-in sender's is ignored.
 */
export const NoticeRequest = z.discriminatedUnion("ground", [
  z.strictObject({
    ground: z.literal("rule"),
    ruleId: ReportRule,
    targets: NoticeTargets,
    explanation: noticeText(NOTICE_LIMITS.explanationMax).optional(),
    turnstileToken: TurnstileToken.optional(),
  }),
  z.strictObject({
    ground: z.literal("illegal"),
    targets: NoticeTargets,
    category: NoticeCategory,
    citedLaw: noticeText(NOTICE_LIMITS.citedLawMax).optional(),
    explanation: noticeText(NOTICE_LIMITS.explanationMax),
    bonaFide: z.literal(true),
    ruleId: ReportRule.optional(),
    name: NotifierName.optional(),
    email: Email.optional(),
    turnstileToken: TurnstileToken.optional(),
  }),
  z
    .strictObject({
      ground: z.literal("csam"),
      targets: NoticeTargets,
      keyword: CsamChoice,
      explanation: noticeText(NOTICE_LIMITS.explanationMax).optional(),
      bonaFide: z.boolean().optional(),
      turnstileToken: TurnstileToken.optional(),
    })
    .refine((notice) => new Set(notice.targets.flatMap((target) => (target.kind === "account" ? [target.handle] : []))).size <= CSAM_NOTICE_MAX_ACCOUNTS, {
      message: `a notice of this kind names at most ${CSAM_NOTICE_MAX_ACCOUNTS} account`,
      path: ["targets"],
    }),
]);
export type NoticeRequest = z.infer<typeof NoticeRequest>;

/** A notice's public reference: N- and ten base32 characters. */
export const NoticeRef = z.string().regex(/^N-[A-Z2-7]{10}$/);

/**
 * The answer to a report or a notice. The token comes only with a notice sent signed out or on the path for child sexual
 * abuse material: it opens the status page, and is shown once.
 */
export const NoticeResponse = z.object({ ref: NoticeRef, token: OpaqueId.optional() });
export type NoticeResponse = z.infer<typeof NoticeResponse>;

/** What the status page sends: the reference with the notice's own token, or with the token of a mail's link. */
export const NoticeStatusRequest = z.strictObject({ ref: NoticeRef, token: OpaqueId });
export type NoticeStatusRequest = z.infer<typeof NoticeStatusRequest>;

/** The page's two buttons, for which only the token of a mail's link works: "I sent this", or "stop korbat's mails about reports to this address". */
export const NoticeContactRequest = z.strictObject({ ref: NoticeRef, token: OpaqueId, choice: z.enum(["confirm", "stop"]) });
export type NoticeContactRequest = z.infer<typeof NoticeContactRequest>;

/**
 * The longest statement an appeal or a request for a re-examination may carry, in characters as PostgreSQL's
 * char_length counts them: what the CHECKs of `appeals` and `intake_items` hold.
 */
export const STATEMENT_MAX = 2000;

/**
 * What the person may add to an appeal or to a request for a re-examination: free of form and optional, under the
 * rules of every free text of a notice. Left out when they wrote nothing.
 */
const Statement = noticeText(STATEMENT_MAX).optional();

/**
 * POST /api/notices/reexamine: a notifier asks korbat to decide an item of their notice again, with the notice's own
 * token or the token of a mail's link, as for the status page. `position` is the item's place on that page, 1 to 20:
 * an item korbat added for a quoted post is asked about like any other, by its own position.
 */
export const NoticeReexamineRequest = z.strictObject({ ref: NoticeRef, token: OpaqueId, position: z.number().int().min(1).max(20), statement: Statement });
export type NoticeReexamineRequest = z.infer<typeof NoticeReexamineRequest>;

/** POST /api/moderation/items/:item/reexamine: the same, for an item of a report the signed-in account sent, named by its id. */
export const ReexamineRequest = z.strictObject({ statement: Statement });
export type ReexamineRequest = z.infer<typeof ReexamineRequest>;

/** POST /api/moderation/decisions/:id/appeal: the author's appeal of a final decision that restricts them. */
export const AppealRequest = z.strictObject({ statement: Statement });
export type AppealRequest = z.infer<typeof AppealRequest>;

/**
 * POST /api/moderation/decisions/:id/reply (3e design, sections 7.6 step 9 and 10.2): the person's one reply to the
 * suspension or termination a decision holds, with an optional text under the text rules, at most REPLY_TEXT_MAX
 * characters. The server makes its salt and digest, as for an appeal.
 */
export const ReplyRequest = z.strictObject({ statement: noticeText(REPLY_TEXT_MAX).optional() });
export type ReplyRequest = z.infer<typeof ReplyRequest>;

/**
 * 3d Task 6 (design, sections 2 row 25, 7.10 and 10.2): "Ask for a person", the one text the subject of a program's
 * decision may send while its measure is in force: 1 to OBJECTION_TEXT_MAX characters, under the rules of every free
 * text of a notice, with no transform, which the CHECK of automated_objections holds too. It is the body of both
 * objection routes (the refused upload's is Task 7's).
 */
export const OBJECTION_TEXT_MAX = 2000;
export const ObjectionRequest = z.strictObject({ text: noticeText(OBJECTION_TEXT_MAX) });
export type ObjectionRequest = z.infer<typeof ObjectionRequest>;

/** The answer to a reply (201): when the database filed it, and whether it came before the start, which it then holds. */
export const ReplyResponse = z.object({ filedAt: z.iso.datetime(), onTime: z.boolean() });
export type ReplyResponse = z.infer<typeof ReplyResponse>;

/**
 * The answer to a request for a re-examination (201): the positions of the items that are now examined again, in
 * order. One, or two when the item is a report of child sexual abuse material about a post that quotes another and the
 * item korbat added for the quoted post could be examined again too: korbat then examines both.
 */
export const ReexamineResponse = z.object({ positions: z.array(z.number().int().min(1).max(20)).min(1).max(2) });
export type ReexamineResponse = z.infer<typeof ReexamineResponse>;

/** What an item's sender can be shown, as the database's item_outcome lists them. */
export const ITEM_OUTCOMES = ["restricted_rule", "restricted_legal", "no_violation", "not_evident", "not_available", "partly_reversed", "reversed"] as const;
export const ItemOutcome = z.enum(ITEM_OUTCOMES);
export type ItemOutcome = z.infer<typeof ItemOutcome>;

/**
 * One phrase for each outcome, which the mails, the status page and the app's list all take from here (3c design,
 * section 10). `{rule}` and `{title}` stand for the rule the restricting decision cites, in the wording of the rulebook
 * it was made under. A reader composes a whole answer with outcomeWords, never from these alone.
 */
export const OUTCOME_PHRASES = {
  restricted_rule: "access restricted: it breaks korbat rule {rule} ({title})",
  restricted_legal: "access restricted: korbat found it illegal",
  no_violation: "no action: korbat found no breach of its rules and nothing illegal",
  not_evident: "no action: korbat found no breach of its rules, and whether it is illegal cannot be seen without a detailed legal examination; a court or an authority can order its removal",
  not_available: "no action: the link names nothing korbat can show (checked automatically)",
  partly_reversed: "korbat reversed part of its decision to restrict it",
  reversed: "korbat reversed its decision to restrict it",
} as const satisfies Record<ItemOutcome, string>;

/** After a restricting outcome whose decision's measures all changed nothing when they were imposed. */
export const ALREADY_NOT_SHOWN = "It was already not shown on korbat, so nothing changed now; korbat's restriction stays in force should that change.";

/** After the outcome of an item about an account that is not suspect and whose answering decision sealed nothing. */
export const ACCOUNT_ITEM_SCOPE = "This answer concerns the account's display name and bio. korbat decides about its posts and images in cases of their own and does not report those here.";

/**
 * 3e (design, section 10.1 and W.1): in place of ACCOUNT_ITEM_SCOPE, after the outcome of an item about an account whose
 * answering decision holds an account measure of 3e. `retired` whenever that decision retires the handle, which anyone can
 * see on the profile; `measure` otherwise (the suspensions and the termination taken at once, which Task 3 opens). Neither
 * names a suspension, an access or a duration, so that nothing a reporter reads lets them follow the account's standing.
 */
export const ACCOUNT_MEASURE_SCOPE = {
  retired: "korbat retired the handle.",
  measure: "korbat took a measure on the account. It does not report here which, or for how long.",
} as const;

/** After the outcome of an item about a post that quotes another (never a suspect item, whose quoted post has an item of its own). */
export const QUOTE_ITEM_SCOPE = "This answer concerns this post's own text and images. korbat decides about the post it quotes, shown inside its card, in a case of its own and does not report that here.";

/** After the outcome of an item about an account that is suspect, or that a decision holding a seal answered: that answer does concern the images on the account's posts. */
export const ACCOUNT_SUSPECT_SCOPE =
  "This answer concerns the account's display name and bio and, taken together, the images on its posts. korbat decides about single posts of the account, and about what its posts say, in cases of their own and does not report those here.";

/**
 * On the path for child sexual abuse material nobody opens the images, so no item is shown words that say korbat found
 * something about them. `sealed` stands for every item whose answering decision holds a seal, suspect or not, in place of
 * the two restricting phrases; `no_action` for a suspect item answered without action, in place of the two no-action ones.
 */
export const SUSPECT_OUTCOME_PHRASES = {
  sealed: "access restricted: korbat sealed its images without opening them. They are shown to nobody, their author included, and are kept for the authorities.",
  no_action:
    "no action: korbat's staff do not open images reported this way. An admin found in the report, and in what korbat can read and still holds of it, no sufficient ground to seal images or to restrict anything else.",
} as const;

/** After the restricting phrase of a suspect item that a decision answered by a measure on the post's text, without a seal. */
export const SUSPECT_NO_SEAL = "No image was sealed; korbat's staff do not open images reported this way.";

/**
 * For an item on another ground about a post that a decision answered without action while nobody could open the post's
 * images (decisions.unseen), in place of the two no-action phrases: it tells its sender the truth, and such an answer
 * does not spend the one re-examination.
 */
export const UNSEEN_NO_ACTION =
  "no action for now: when korbat decided, its staff could not open this post's images, because a report of another kind about them was waiting or they were sealed. If your report is about an image, ask for a re-examination.";

/** What decides how one item's outcome reads: the facts of the item and of the decision that answered it. */
export interface OutcomeWordsInput {
  outcome: ItemOutcome;
  /** The rule a `restricted_rule` outcome names, with its title in the rulebook the decision was made under; null for every other outcome. */
  rule: { id: string; title: string } | null;
  /** The item itself is suspect: a report of child sexual abuse material, or a finding citing R2. */
  suspect: boolean;
  /** The answering decision holds a seal. */
  sealed: boolean;
  /** The answering decision was taken while nobody could open the post's images, and the item is about a post and not suspect. */
  unseen: boolean;
  /** Every measure of the answering decision changed nothing when it was imposed. */
  noEffect: boolean;
  /** What the answer concerns, as the status answer gives it. */
  scope: "account" | "quote" | "account_suspect" | "account_retired" | "account_measure" | null;
}

const NO_ACTION: readonly ItemOutcome[] = ["no_violation", "not_evident"];
const RESTRICTING: readonly ItemOutcome[] = ["restricted_rule", "restricted_legal"];

/** A phrase as a sentence: with the one full stop it ends in. */
const sentence = (phrase: string): string => (phrase.endsWith(".") ? phrase : `${phrase}.`);

/**
 * One item's outcome as its sender reads it, in a mail's line, on the status page and in the app's list alike: the
 * outcome's phrase, then the sentences that follow it, in this order (3c design, section 7.8, step 4, and section 10).
 *   - The phrase. A restriction by a decision that holds a seal reads the `sealed` phrase, whatever the item's ground. A
 *     suspect item answered without action reads the `no_action` phrase. An item on another ground about a post, answered
 *     without action with the images out of sight, reads UNSEEN_NO_ACTION; an item about an account never does, since its
 *     answer concerns the display name and bio, which staff read. Every other outcome reads its own phrase, also a
 *     reversal and a link that named nothing on that path.
 *   - SUSPECT_NO_SEAL, after a suspect item's restriction that sealed nothing.
 *   - ALREADY_NOT_SHOWN, after a restricting outcome whose measures all changed nothing.
 *   - The scope's sentence, after every outcome but `not_available`; 3e's retired phrase only after a restricting one, since
 *     a reversal's phrase says on its own that the handle was given back, and a sentence that it was retired would contradict it.
 * The text ends in one full stop.
 */
export function outcomeWords(input: OutcomeWordsInput): string {
  const { outcome, scope } = input;
  const aboutAccount = scope === "account" || scope === "account_suspect";
  const parts: string[] = [];
  if (RESTRICTING.includes(outcome) && input.sealed) {
    parts.push(SUSPECT_OUTCOME_PHRASES.sealed);
  } else if (NO_ACTION.includes(outcome) && input.suspect) {
    parts.push(SUSPECT_OUTCOME_PHRASES.no_action);
  } else if (NO_ACTION.includes(outcome) && input.unseen && !aboutAccount) {
    parts.push(UNSEEN_NO_ACTION);
  } else if (outcome === "restricted_rule") {
    if (input.rule === null) throw new Error("a restriction under a rule is worded with its rule: none was given");
    const { id, title } = input.rule;
    // Each placeholder is filled by a function, so that no character of an id or a title is read as a pattern.
    parts.push(sentence(OUTCOME_PHRASES.restricted_rule.replace("{rule}", () => id).replace("{title}", () => title)));
  } else {
    parts.push(sentence(OUTCOME_PHRASES[outcome]));
  }
  if (RESTRICTING.includes(outcome)) {
    if (input.suspect && !input.sealed) parts.push(SUSPECT_NO_SEAL);
    if (input.noEffect) parts.push(ALREADY_NOT_SHOWN);
  }
  if (outcome !== "not_available") {
    if (scope === "account") parts.push(ACCOUNT_ITEM_SCOPE);
    if (scope === "account_suspect") parts.push(ACCOUNT_SUSPECT_SCOPE);
    if (scope === "quote") parts.push(QUOTE_ITEM_SCOPE);
    if (scope === "account_retired" && RESTRICTING.includes(outcome)) parts.push(ACCOUNT_MEASURE_SCOPE.retired);
    // 3e (7.11 item 7): a suspension or termination taken at once that answered the item, named by no word of what it is.
    if (scope === "account_measure" && RESTRICTING.includes(outcome)) parts.push(ACCOUNT_MEASURE_SCOPE.measure);
  }
  return parts.join(" ");
}

/**
 * One item of a notice as its sender reads it. `link` is the item's korbat address, an account's built from the handle
 * as the notice named it and never from the handle the profile holds now. `scope` says what the answer concerns
 * (`account`, `quote`, `account_suspect`, `account_retired`, `account_measure`, or null). An item about an account carries its scope from
 * the first moment, whatever the handle named: `account_suspect` when the item is suspect or, once released, when its
 * answering decision sealed images; once released, `account_retired` (3e) when that decision retired the handle,
 * `account_measure` (3e) when it took a suspension or termination at once and retired no handle; and
 * `account` otherwise. `quote`, for a post that quotes another, comes only with the released outcome, so that before
 * the release nothing tells a live target from a link that names nothing. The page and the app add the
 * scope's sentence after every outcome but `not_available`. `quotedBy` is the position of the item this one was added for,
 * when korbat added it for a quoted post. `outcome` and `decidedOn` (a UTC day) stay null until the outcome is released,
 * and `sealed`, `unseen` and `reexamination` say nothing before that either: `sealed` that the answering decision sealed
 * images, `unseen` that it was taken while nobody could open the post's images, `reexamination` whether a re-examination
 * can still be asked for and until when (null for an item that cannot be re-examined). `changed` marks an outcome that a
 * review or a correction changed, `reexamines` the item of a re-examination. Two members come only with a released
 * outcome and only when they say something, since the outcome's words need them: `rule`, the rule a `restricted_rule`
 * outcome names, with its title in the rulebook the decision was made under, and `noEffect`, set when every measure of
 * the answering decision changed nothing when it was imposed.
 */
export const NoticeItemStatus = z.object({
  position: z.number().int().min(1).max(20),
  link: z.string(),
  scope: z.enum(["account", "quote", "account_suspect", "account_retired", "account_measure"]).nullable(),
  suspect: z.boolean(),
  sealed: z.boolean(),
  unseen: z.boolean(),
  quotedBy: z.number().int().min(1).max(10).nullable(),
  outcome: ItemOutcome.nullable(),
  decidedOn: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/).nullable(),
  changed: z.boolean(),
  reexamines: z.boolean(),
  reexamination: z.object({ open: z.boolean(), until: z.string() }).nullable(),
  rule: z.object({ id: z.enum(RULE_IDS), title: z.string() }).optional(),
  noEffect: z.literal(true).optional(),
  /**
   * 3d Task 7 (design, sections 7.10 and 10.2): the answering decision's own automated_decision, which comes only with a
   * released outcome and only when it is `partially` (an admin restricted on a program's finding under R2 without
   * opening the images): the line then prints update.automated.partly in the place of 3c's fixed sentence. A program's
   * decision never answers an item, and every other line reads not_automated, so the member is absent for them.
   */
  automatedDecision: z.literal("partially").optional(),
});
export type NoticeItemStatus = z.infer<typeof NoticeItemStatus>;

/**
 * A released item's outcome as its sender reads it on the status page and in the app's list: the same composition as a
 * mail's line (outcomeWords), from the item's own facts. Null while nothing is released.
 */
export function itemOutcomeWords(item: NoticeItemStatus): string | null {
  if (item.outcome === null) return null;
  return outcomeWords({ outcome: item.outcome, rule: item.rule ?? null, suspect: item.suspect, sealed: item.sealed, unseen: item.unseen, noEffect: item.noEffect === true, scope: item.scope });
}

/**
 * The status page's answer. `items` holds the items the notice named, by position, and an item korbat added for a
 * quoted post directly after the item it was added for, from the first release that shows that item's outcome or its
 * own: listed earlier, it would tell that the named post exists. `contact` is null for a notice that left no name or
 * address; `confirmed` and `stopped` are null unless the request carried the token of a mail's link, so the answer to
 * whoever typed an address never depends on what korbat knows about that address.
 */
export const NoticeStatus = z.object({
  ref: NoticeRef,
  receivedAt: z.string(),
  items: z.array(NoticeItemStatus),
  contact: z.object({ given: z.boolean(), confirmed: z.boolean().nullable(), stopped: z.boolean().nullable() }).nullable(),
});
export type NoticeStatus = z.infer<typeof NoticeStatus>;

// ---------------------------------------------------------------- digests

/** Names the rule a text's digest is made by; a later rule gets a later tag. */
export const TEXT_DIGEST_TAG = "korbat.text.v1";

const SALT_HEX = /^[0-9a-f]{64}$/;

/** Whether every surrogate in the text is half of a pair: only then has it UTF-8 bytes. */
function isWellFormed(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i++;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/**
 * The salted digest of a free text (a staff text, a statement): the lower-case hex sha256 of the tag's bytes, a line
 * feed, the salt's 32 bytes and the text's UTF-8 bytes. The API, the console and text-verify call it, and the database's
 * CHECKs compute the same, so a stored text is always the one its digest names. The salt keeps a short text from being
 * confirmed by hashing guesses. A malformed salt or text is refused, never changed: TextEncoder would otherwise hash a
 * lone surrogate as another character.
 */
export async function textDigest(saltHex: string, text: string): Promise<string> {
  if (!SALT_HEX.test(saltHex)) throw new TypeError("a text digest's salt is 32 bytes as 64 lower-case hex characters");
  if (!isWellFormed(text)) throw new TypeError("a text digest is taken over a well-formed text: a lone surrogate has no UTF-8 bytes");
  const tag = utf8(TEXT_DIGEST_TAG);
  const body = utf8(text);
  const bytes = new Uint8Array(tag.length + 1 + 32 + body.length);
  bytes.set(tag, 0);
  bytes[tag.length] = 0x0a;
  for (let i = 0; i < 32; i++) bytes[tag.length + 1 + i] = Number.parseInt(saltHex.slice(2 * i, 2 * i + 2), 16);
  bytes.set(body, tag.length + 33);
  return hex(await sha256Bytes(bytes));
}

/** Names the rule a snapshot's digest is made by. */
export const SNAPSHOT_DIGEST_TAG = "korbat.snapshot.v1";

/**
 * What a snapshot's digest covers: its salt and everything it copied. A post's snapshot leaves the three profile fields
 * null, an account's the post's. Each image is its id, alt text and size, in position order; an alt text is null for an
 * image whose content was erased.
 */
export interface SnapshotDigestInput {
  salt: string;
  targetType: "post" | "account";
  targetId: string;
  /** When the snapshot was taken, as Date.prototype.toISOString writes it. */
  takenAt: string;
  authorHandle: string;
  postState: "visible" | "withheld" | "removed" | "deleted_by_author" | "disabled" | null;
  /** As Date.prototype.toISOString writes it. */
  postCreatedAt: string | null;
  replyToId: string | null;
  quoteOfId: string | null;
  body: string | null;
  media: { id: string; alt: string | null; width: number; height: number }[] | null;
  displayName: string | null;
  bio: string | null;
  handle: string | null;
}

/** A time as toISOString writes it: UTC, to the millisecond. Any other spelling of the same instant would hash differently. */
const ISO_MILLIS = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$/;

function isoTime(name: string, value: string): string {
  if (!ISO_MILLIS.test(value)) throw new TypeError(`a snapshot's ${name} is a UTC time to the millisecond, as toISOString writes it`);
  return value;
}

/**
 * The text a snapshot's digest is taken over: the sorted JSON of version 1 and the snapshot's members, each picked by
 * name, so that whatever else an answer carries, and in whatever order, the API and the console write the same text.
 */
export function snapshotText(snapshot: SnapshotDigestInput): string {
  return sortedJson({
    v: 1,
    salt: snapshot.salt,
    targetType: snapshot.targetType,
    targetId: snapshot.targetId,
    takenAt: isoTime("takenAt", snapshot.takenAt),
    authorHandle: snapshot.authorHandle,
    postState: snapshot.postState,
    postCreatedAt: snapshot.postCreatedAt === null ? null : isoTime("postCreatedAt", snapshot.postCreatedAt),
    replyToId: snapshot.replyToId,
    quoteOfId: snapshot.quoteOfId,
    body: snapshot.body,
    media: snapshot.media === null ? null : snapshot.media.map((image) => ({ id: image.id, alt: image.alt, width: image.width, height: image.height })),
    displayName: snapshot.displayName,
    bio: snapshot.bio,
    handle: snapshot.handle,
  });
}

/** A snapshot's digest: the lower-case hex sha256 of the tag, a line feed and snapshotText, in UTF-8. */
export async function snapshotDigest(snapshot: SnapshotDigestInput): Promise<string> {
  return hex(await sha256(`${SNAPSHOT_DIGEST_TAG}\n${snapshotText(snapshot)}`));
}

/**
 * The end of the author's appeal window and of the re-examination window: APPEAL_MONTHS calendar months after the person
 * was told, in UTC, at the same time of day. A day the target month lacks becomes that month's last day (31 August gives
 * the end of February). PostgreSQL's appeal_deadline computes the same; a test holds the two equal over every month end.
 */
export function appealDeadline(informedAt: Date): Date {
  const year = informedAt.getUTCFullYear();
  const month = informedAt.getUTCMonth() + APPEAL_MONTHS;
  // Day 0 of the month after the target month is the target month's last day; Date.UTC carries a month past 11 into the year.
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(informedAt.getUTCDate(), lastDay);
  return new Date(Date.UTC(year, month, day, informedAt.getUTCHours(), informedAt.getUTCMinutes(), informedAt.getUTCSeconds(), informedAt.getUTCMilliseconds()));
}

// ---------------------------------------------------------------- the console: findings, saved texts and reveals

/**
 * The categories a moderator's own finding may carry: every one of the Transparency Database's but "not specified",
 * which says that a notifier was not sure. A finding is korbat's own classification, never a notice. The console offers
 * exactly this list, so the form and the request's schema cannot come apart.
 */
export const FINDING_CATEGORIES: readonly TdbCategory[] = TDB_CATEGORIES.filter((category) => category !== "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE");
const FindingCategory = z.enum(FINDING_CATEGORIES as [TdbCategory, ...TdbCategory[]]);

/**
 * POST /api/staff/findings: a moderator's own finding. It names one target, as a notice does, cites a korbat rule (R2
 * among them: only a finding cites it) and carries a category. It has no other ground: a finding never alleges
 * illegality, so nothing the console sends can mark a decision as one that followed a notice or an order, and what the
 * moderator writes about it is a saved text, never a member of this request.
 */
export const FindingRequest = z.strictObject({ target: NoticeTarget, ground: z.literal("rule"), ruleId: z.enum(RULE_IDS), category: FindingCategory });
export type FindingRequest = z.infer<typeof FindingRequest>;

/** The case the finding opened or joined. */
export const FindingResponse = z.object({ caseId: z.uuid() });
export type FindingResponse = z.infer<typeof FindingResponse>;

/**
 * The kinds of text staff save, as the database's staff_text_kind lists them. A note and a recorded choice not to seal
 * are complete when saved; every other kind waits for the decision or the reveal that names it.
 */
export const STAFF_TEXT_KINDS = ["facts", "reason", "legal_reference", "review_reason", "reveal_reason", "note", "seal_declined"] as const;
export type StaffTextKind = (typeof STAFF_TEXT_KINDS)[number];

/** The longest text staff may save, in UTF-16 units: the bound of the Transparency Database's facts field. */
export const STAFF_TEXT_MAX = 5000;

const Hex64 = z.string().regex(/^[0-9a-f]{64}$/, "must be 64 lower-case hex characters");

/**
 * What is wrong with a text staff want to save, or null: it must be well formed (no half of a surrogate pair), hold no
 * control character below the space but the line feed, none of the invisible direction and spacing characters, and at
 * most STAFF_TEXT_MAX UTF-16 units. The server refuses such a text and never changes it; the console checks with the
 * same function before it sends one.
 */
export function staffTextProblem(text: string): "malformed" | "control" | "format" | "too_long" | null {
  if (!isWellFormed(text)) return "malformed";
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x20 && unit !== 0x0a) return "control";
  }
  if (FORBIDDEN_FORMAT.test(text)) return "format";
  if (text.length > STAFF_TEXT_MAX) return "too_long";
  return null;
}

/**
 * POST /api/staff/cases/:case/texts: a text with the salt the console drew and the digest it computed (textDigest). The
 * schema lets any string through: what a text must be is the route's to refuse, with text_invalid, so the console can
 * say what is wrong with it in place. A text of nothing, or of white space alone, the route refuses as an invalid
 * request, whatever its kind: no reason, no facts and no note is saved empty.
 */
export const StaffTextSaveRequest = z.strictObject({ kind: z.enum(STAFF_TEXT_KINDS), text: z.string(), salt: Hex64, digest: Hex64 });
export type StaffTextSaveRequest = z.infer<typeof StaffTextSaveRequest>;

/** The stored text's id and its digest, as the server recomputed it. */
export const StaffTextSaved = z.object({ id: z.uuid(), digest: Hex64 });
export type StaffTextSaved = z.infer<typeof StaffTextSaved>;

/** One of the person's own texts that no decision or reveal has named yet, with its salt, so the console can check it against its digest. */
export const StaffTextDraft = z.object({ id: z.uuid(), kind: z.enum(STAFF_TEXT_KINDS), text: z.string(), salt: Hex64, digest: Hex64, createdAt: z.iso.datetime() });
export type StaffTextDraft = z.infer<typeof StaffTextDraft>;

/** GET /api/staff/cases/:case/texts: the person's own drafts on the case, so a draft survives a reload or a sign-in. */
export const StaffTextsResponse = z.object({ texts: z.array(StaffTextDraft) });
export type StaffTextsResponse = z.infer<typeof StaffTextsResponse>;

/**
 * The kinds of a decision and where its case came from (3c design, section 10; 3f design, section 10.1): an order decision
 * answers an authority's order alone, with the source `order`.
 */
export const DECISION_KIND_VALUES = ["interim", "final", "order", "review", "correction"] as const;
export type DecisionKindValue = (typeof DECISION_KIND_VALUES)[number];
export const DECISION_SOURCE_VALUES = ["notice", "report", "own_initiative", "order"] as const;

/** POST /api/staff/cases/:case/snapshots: the new snapshot's id and digest, or the newest one's when nothing differed. Never its content: that is read with the case. */
export const StaffSnapshotTaken = z.object({ id: z.uuid(), digest: Hex64 });
export type StaffSnapshotTaken = z.infer<typeof StaffSnapshotTaken>;

/**
 * POST /api/staff/items/:item/reveal answers who sent the item: a signed-in reporter's handle, or the name a signed-out
 * notifier gave. Both are null when the name was forgotten between the confirmation and the read. Never an address.
 */
export const RevealResponse = z.object({ handle: z.string().nullable(), name: z.string().nullable() });
export type RevealResponse = z.infer<typeof RevealResponse>;

// ---------------------------------------------------------------- the console: the queue, the case and the overview

const UtcDay = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, "must be a UTC day");
const Count = z.number().int().nonnegative();
const LaneNumber = z.union([z.literal(0), z.literal(1), z.literal(2)]);

// ---------------------------------------------------------------- account sanctions: what staff read (3e design, section 10.3)

/**
 * Where a standing measure stands now: `unfixed` (it has no start yet, since korbat does not know what became of its
 * notice mail), `announced` (its start is fixed and ahead), `held` (a reply filed before the start waits for an answer),
 * `running`, `ended`; and, once it stopped early, `never` (lifted before it started), `lifted`, or `basis_ended` (a
 * decision it rested on was reversed).
 */
export const PERIOD_STATES = ["unfixed", "announced", "held", "running", "ended", "never", "lifted", "basis_ended"] as const;
export type PeriodState = (typeof PERIOD_STATES)[number];

/** A standing measure's start and end as they stand, each null while not fixed (the end of a termination too), and its state. */
export const MeasurePeriod = z.object({ startsAt: z.iso.datetime().nullable(), endsAt: z.iso.datetime().nullable(), state: z.enum(PERIOD_STATES) });
export type MeasurePeriod = z.infer<typeof MeasurePeriod>;

/**
 * On a post case: whether a final restriction of this case on a korbat rule other than R2, resting on no suspect item,
 * gives a strike, as the database's strike_due answers it, and why not: the post already carries a strike that stands, or
 * it was made before its author was told of their newest strike. The database's own answer at the commit decides.
 */
export const StrikeDue = z.object({ due: z.boolean(), why: z.enum(["due", "already_struck", "before_last_strike"]) });
export type StrikeDue = z.infer<typeof StrikeDue>;

/** On a post case: the author's standing in bands, so that the moderator knows what a strike here leads to. */
export const AuthorStanding = z.object({
  activeStrikes: z.enum(["0", "1", "2", "3_or_more"]),
  suspensionsInYear: z.enum(["0", "1", "2_or_more"]),
  now: z.enum(["none", "announced", "suspended", "terminated"]),
});
export type AuthorStanding = z.infer<typeof AuthorStanding>;

/** The grounds of a suspension at once, and the termination at once for a second threat. */
export const AT_ONCE_GROUNDS = ["threat", "terrorist", "flood", "protective", "threat_repeat"] as const;
export type AtOnceGround = (typeof AT_ONCE_GROUNDS)[number];

/**
 * On an account case: the account's standing, read from the same views the ledger's triggers read, as an aid to the
 * console; the database decides at the commit. `strikes` are the active strikes, oldest first; `ladderRule` the rule of
 * the newest; `suspensionsInYear` the suspensions of the ladder that stand with their basis, decided in the last
 * ladderMemoryDays, and `lastSuspendedOn` the day of the newest of them; `maxDays` the rung an announced suspension would
 * take now, null when none can be announced; `mayTerminate` whether a termination can be announced; `live` whether a
 * suspension or termination stands and has not ended, one with no start included; `openReports` whether the case holds an
 * unanswered item of a user's report, which holds the ladder's, the protective and the reporting measures back; `atOnce`
 * the grounds the database would accept now; `flood` the account's posts of the last floodMinutes and the interval they
 * were counted in; `seal` the day of the seal for good a protective suspension would rest on now.
 */
export const CaseStanding = z.object({
  activeStrikes: Count,
  strikes: z.array(z.object({ decisionId: z.uuid(), caseId: z.uuid(), ruleId: z.enum(RULE_IDS), decidedAt: z.iso.datetime(), countsUntil: z.iso.datetime() })),
  ladderRule: z.enum(RULE_IDS).nullable(),
  suspensionsInYear: Count,
  lastSuspendedOn: UtcDay.nullable(),
  maxDays: z.number().int().min(STANDING_DAYS.min).max(STANDING_DAYS.max).nullable(),
  mayTerminate: z.boolean(),
  live: z.boolean(),
  openReports: z.boolean(),
  atOnce: z.array(z.enum(AT_ONCE_GROUNDS)),
  flood: z.object({ posts: Count, from: z.iso.datetime(), to: z.iso.datetime() }),
  seal: z.object({ decidedOn: UtcDay }).nullable(),
  /**
   * 3e Task 2: the handle of the case's newest snapshot is retired already, so a retirement now would change nothing
   * (no_effect `already`); the composer keeps the control open and says so.
   */
  snapshotHandleRetired: z.boolean(),
  /**
   * 3e Task 3: for each ground of a suspension at once that rests on a decision, the time of the decision it would rest on
   * now (the newest that fits decision_actions_check's row: a final R5 decision, a final decision on the law marked
   * terrorist content, a seal for good), or null. The composer's preview prints it in the statement's basis sentence,
   * which names that decision by its time.
   */
  basisDecidedAt: z.object({
    threat: z.iso.datetime().nullable(),
    terrorist: z.iso.datetime().nullable(),
    protective: z.iso.datetime().nullable(),
    /**
     * 3e Task 4: for a termination at once, the times of the two R5 decisions it would rest on now: the one the earlier
     * suspension for a threat rests on, and the newest about a post made after it; null when the ground is not met.
     */
    threatRepeat: z.object({ earlier: z.iso.datetime(), newer: z.iso.datetime() }).nullable().optional(),
  }),
  /**
   * 3e Task 5 (design, sections 8.1 and 10.3): the account's record of reporting, in reports (intakes) and never items, by
   * the day each was sent: `reports` its rule reports sent in the frame of reportFrameDays, `unfounded` those of them that
   * hold a mark "manifestly unfounded" that counts (never more than `reports`); `warnedOn` the day of its warning that still
   * counts, and `marksSince` the marked reports sent since korbat told it of that warning (both null without one);
   * `mayWarn` and `mayRestrict` whether the database would accept the warning or the restriction now (the case's open
   * reports aside, which `openReports` says); `restrictedUntil` the end of a restriction that runs; and `marked`, one row
   * for each mark that counts, oldest report first: its report's reference, the item's position in it, the day the report
   * was sent, the day of the mark, and whether the report was sent after korbat told the account of its warning, for the
   * drafts of W.5. People are never named: a report is its reference.
   */
  reporting: z.object({
    reports: Count,
    unfounded: Count,
    warnedOn: UtcDay.nullable(),
    /** The warning's decision time, which a restriction's statement names ({warnedAt}); null without a warning. */
    warnedAt: z.iso.datetime().nullable(),
    marksSince: Count.nullable(),
    mayWarn: z.boolean(),
    mayRestrict: z.boolean(),
    restrictedUntil: z.iso.datetime().nullable(),
    marked: z.array(z.object({ ref: NoticeRef, position: z.number().int().min(1).max(20), sentOn: UtcDay, markedOn: UtcDay, sinceWarning: z.boolean() })),
  }),
});
export type CaseStanding = z.infer<typeof CaseStanding>;
const TargetKind = z.enum(["post", "account"]);
// 3f: `disabled`, a post an authority's order disabled; no row holds it before an order is given effect (Task 3).
const StoredPostState = z.enum(["visible", "withheld", "removed", "deleted_by_author", "disabled"]);

/** How many cases one page of the queue holds. */
export const QUEUE_PAGE_SIZE = 50;

/**
 * 3d Task 8 (design, sections 2 row 47, 7.13 and 10.3): what the flag "Possible coordinated reporting" shows: how many
 * unanswered reports of signed-in reporters arrived within one window of SIGNAL_RULES.windowMinutes, and from how many
 * accounts. Counts and never a reporter: the case page and the queue say no more ([case.flag], [queue.flag]).
 */
export const CaseFlag = z.strictObject({ items: Count, reporters: Count });
export type CaseFlag = z.infer<typeof CaseFlag>;

/**
 * One open case as the queue lists it: its lane, what it is about, since when it and its oldest unanswered item wait,
 * and what its unanswered items cite. `deferred` is set only under the emergency switch. Nothing here weighs a case:
 * the queue orders by lane and age alone.
 */
export const QueueRow = z.object({
  id: z.uuid(),
  lane: LaneNumber,
  targetType: TargetKind,
  openedAt: z.iso.datetime(),
  oldestOpenAt: z.iso.datetime(),
  openItems: Count,
  rules: z.array(z.enum(RULE_IDS)),
  categories: z.array(z.enum(TDB_CATEGORIES)),
  allegesIllegal: z.boolean(),
  suspect: z.boolean(),
  reexamination: z.boolean(),
  deferred: z.boolean(),
  /**
   * 3d Task 6 (design, sections 8.3 and 10.3): an unanswered item of the case is a program's finding citing R1 or R2
   * ([queue.found]); a measure of a decision without a decider is in force on the case ([queue.taken]); the author asked
   * for a person about a measure in force ([queue.objected]), which alone of the three moves a case: it sorts first inside
   * its lane, before age, and the queue's cursor carries it.
   */
  foundByProgram: z.boolean(),
  takenByProgram: z.boolean(),
  objected: z.boolean(),
  /**
   * 3d Task 7 (design, sections 8.3 and 10.3): an unanswered item of the case is a program's finding that cites no rule,
   * a match with an entry of another class than the source's own for child sexual abuse material ([queue.matchFlag]). It
   * moves nothing: the case stands where its lane and age put it.
   */
  matchFlag: z.boolean(),
  /**
   * 3d Task 8 (design, sections 7.13, 8.3 and 10.3): the flag "Possible coordinated reporting" ([queue.flag]), the two
   * counts of case_flag while it answers true, else null. It moves nothing: no key of the queue's order reads it.
   */
  flag: CaseFlag.nullable(),
});
export type QueueRow = z.infer<typeof QueueRow>;

/**
 * 3e (design, sections 8.5 and 10.3): a reply to a suspension or a termination that no decision has answered yet, as the
 * queue's first section lists it, oldest first: the measure's case and decision, its kind and days, when the reply was
 * filed, whether before the start (it then holds the start), and the measure's end as it stands now (null while it has
 * none, and for a termination). Never the reply's text: that is read on the case page, whose read is logged.
 */
export const QueueReply = z.object({
  caseId: z.uuid(),
  decisionId: z.uuid(),
  kind: z.enum(["suspend", "terminate"]),
  days: z.number().int().min(STANDING_DAYS.min).max(STANDING_DAYS.max).nullable(),
  filedAt: z.iso.datetime(),
  onTime: z.boolean(),
  endsAt: z.iso.datetime().nullable(),
});
export type QueueReply = z.infer<typeof QueueReply>;

/**
 * GET /api/staff/queue: a page of the queue in its order, and the cursor that asks for the next; null when there is none.
 * 3e: the first page (no cursor) also carries the unanswered replies, oldest first; a later page carries none.
 */
export const QueuePage = z.object({ cases: z.array(QueueRow).max(QUEUE_PAGE_SIZE), nextCursor: z.string().nullable(), replies: z.array(QueueReply).max(QUEUE_PAGE_SIZE) });
export type QueuePage = z.infer<typeof QueuePage>;

/** The queue's cursor is the last row's sort key, as an opaque word the server made. */
export const QueueQuery = z.object({ cursor: z.string().regex(/^[A-Za-z0-9_-]{1,400}$/).optional() });
export type QueueQuery = z.infer<typeof QueueQuery>;

/** The fixed words for a source that is no signed-in reporter. A reporter's label is its letter: reporterLabel. */
export const SOURCE_LABELS = {
  notifier: "A notifier",
  anonymous: "Anonymous",
  staff: "Found by a moderator",
  unlinked: "A signed-in reporter no longer linked",
  // 3f (design, section 8.6): an order's intake item, listed with its order and never with a reporter's summary.
  authority: "An authority's order",
  // 3d Task 6 (design, sections 8.4 and 10.3): a program's finding, also one that cites no rule; never a reporter's summary.
  program: "Found by a program",
} as const;

/**
 * A signed-in reporter's label on one case: "Reporter A" for the first reporter of the case, "Reporter B" for the
 * second, and after Z two letters and more, as a spreadsheet names its columns. The letter is given per case, so one
 * person's letter on one case says nothing about another.
 */
export function reporterLabel(index: number): string {
  let letters = "";
  for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) letters = String.fromCharCode(65 + (n % 26)) + letters;
  return `Reporter ${letters}`;
}

/**
 * Who sent an item, as staff see it without a reveal: never a name, a handle or an address. A signed-in reporter is a
 * letter and four bands computed on read (the account's age, the items it filed, the share of its decided items that
 * were acted on, and the items answered while nobody could open the images, which are counted apart); a signed-out
 * notifier is whether a name and an address were given, confirmed or stopped, or that the contact is lost; a notice on
 * the path for child sexual abuse material is anonymous; a finding was found by a moderator. The label is one of the
 * console's own words for its kind, so no answer can put a text of its choosing where the console names a source.
 */
export const SourceSummary = z
  .object({
    kind: z.enum(["reporter", "notifier", "anonymous", "staff", "unlinked", "authority", "program"]),
    label: z.string().max(40),
    accountAge: z.enum(["under_1_month", "1_to_12_months", "over_12_months"]).nullable(),
    itemsFiled: z.enum(["1", "2_to_9", "10_or_more"]).nullable(),
    actedOn: z.enum(["none_decided", "none", "under_half", "half_or_more"]).nullable(),
    answeredUnseen: z.enum(["none", "1", "2_to_9", "10_or_more"]).nullable(),
    named: z.boolean().nullable(),
    contactGiven: z.boolean().nullable(),
    confirmed: z.boolean().nullable(),
    suppressed: z.boolean().nullable(),
    contactLost: z.boolean(),
  })
  .refine((source) => (source.kind === "reporter" ? /^Reporter [A-Z]{1,4}$/.test(source.label) : source.label === SOURCE_LABELS[source.kind]), {
    message: "a source's label is its reporter's letter or the fixed words of its kind",
    path: ["label"],
  });
export type SourceSummary = z.infer<typeof SourceSummary>;

const SnapshotImage = z.object({ id: z.uuid(), alt: z.string().nullable(), width: z.number().int().positive(), height: z.number().int().positive() });

/**
 * A snapshot of a case's evidence. Shown, it carries everything its digest covers, each member under the name
 * snapshotDigest reads it by, so the console recomputes the digest from exactly what it displays. Withheld (erased, or
 * a copy of content that was erased since), it carries its id, its time and its digest and no content.
 */
export const CaseSnapshot = z.discriminatedUnion("withheld", [
  z.object({ id: z.uuid(), takenAt: z.iso.datetime(), digest: Hex64, withheld: z.literal(true) }),
  z.object({
    id: z.uuid(),
    takenAt: z.iso.datetime(),
    digest: Hex64,
    withheld: z.literal(false),
    salt: Hex64,
    targetType: TargetKind,
    targetId: z.uuid(),
    authorHandle: z.string(),
    postState: StoredPostState.nullable(),
    postCreatedAt: z.iso.datetime().nullable(),
    replyToId: z.uuid().nullable(),
    quoteOfId: z.uuid().nullable(),
    body: z.string().nullable(),
    media: z.array(SnapshotImage).nullable(),
    displayName: z.string().nullable(),
    bio: z.string().nullable(),
    handle: z.string().nullable(),
  }),
]);
export type CaseSnapshot = z.infer<typeof CaseSnapshot>;

/**
 * One item of a case, for staff: its ground and what its sender wrote, the image it points at (a hint), and its source
 * as a summary. `link` is the item's korbat address, an account's under the handle as it was named. `quotedByPosition`
 * is set on an item korbat added for a quoted post (the position of the item it was added for), `quotedCaseId` on a
 * suspect item whose post quotes another (the case of that post's item). A re-examination says which item of its notice
 * it re-examines, and whether the person reading decided that item. `erased` marks an item whose intake record was erased.
 */
export const CaseItem = z.object({
  id: z.uuid(),
  seq: z.number().int().positive(),
  position: z.number().int().min(1).max(20),
  createdAt: z.iso.datetime(),
  lane: LaneNumber,
  link: z.string(),
  ruleId: z.enum(RULE_IDS).nullable(),
  allegesIllegal: z.boolean(),
  csam: z.boolean(),
  category: z.enum(TDB_CATEGORIES),
  categoryKeyword: z.string().nullable(),
  citedLaw: z.string().nullable(),
  explanation: z.string().nullable(),
  mediaId: z.uuid().nullable(),
  suspect: z.boolean(),
  quotedByPosition: z.number().int().min(1).max(10).nullable(),
  quotedCaseId: z.uuid().nullable(),
  reexaminesPosition: z.number().int().min(1).max(20).nullable(),
  reexaminesYourDecision: z.boolean(),
  statement: z.string().nullable(),
  outcome: ItemOutcome.nullable(),
  answeredBy: z.uuid().nullable(),
  erased: z.boolean(),
  source: SourceSummary,
  /**
   * 3e Task 5 (design, sections 8.4 and 10.3): `markable`, a final decision that finds no breach and answers the item may
   * mark it "manifestly unfounded": it is no re-examination and came from a signed-in person's report under a rule (never
   * a notice of illegality, the path for child sexual abuse material, a finding or a signed-out notice), and its sender is
   * still known; `unfounded`, its answering decision marked it and no correction withdrew the mark; `markWithdrawn`, a
   * correction withdrew it.
   */
  markable: z.boolean(),
  unfounded: z.boolean(),
  markWithdrawn: z.boolean(),
  /** 3f (design, section 8.6): the order an order's intake item belongs to, which the page links; null on every other item. */
  orderId: z.uuid().nullable().optional(),
  /**
   * 3d Task 8 (design, sections 7.13 step 4, 8.4 and 10.3): how many other unanswered items the same signed-in reporter has
   * on other open cases, as a count ([case.sameSource]); 0 for an item of any other source. It names no case and no
   * person, and batches nothing: each case is decided on its own.
   */
  sameSourceOpen: Count,
});
export type CaseItem = z.infer<typeof CaseItem>;

/**
 * One measure or reversal of a decision. A measure says whether it is in force and, when a reversal lifted it, which
 * decision's; `noEffect` says that it changed nothing anyone saw when it was imposed. A seal lists what it covers: the
 * posts and images, how many of the posts their author had deleted, and at most SEAL_LIST_MAX rows of the list itself,
 * oldest first, as text for the report to the police, never content.
 */
export const CaseDecisionAction = z.object({
  id: z.uuid(),
  kind: z.enum(ACTION_KINDS),
  mediaId: z.uuid().nullable(),
  noEffect: z.enum(["already", "deleted"]).nullable(),
  inForce: z.boolean(),
  reversesActionId: z.uuid().nullable(),
  liftedBy: z.uuid().nullable(),
  sealed: z
    .object({
      posts: Count,
      images: Count,
      deletedPosts: Count,
      list: z.array(z.object({ postId: z.uuid(), createdAt: z.iso.datetime(), images: z.number().int().positive() })).max(SEAL_LIST_MAX),
    })
    .nullable(),
  // 3e (design, section 10.3): the ledger row's own columns, each null on a kind that does not take it.
  /** A suspension's or a restriction of reporting's days. */
  days: z.number().int().min(STANDING_DAYS.min).max(STANDING_DAYS.max).nullable(),
  /** A standing measure announced with the reply window, or taken at once. */
  announced: z.boolean().nullable(),
  basis: z.enum(STANDING_BASES).nullable(),
  /** The decisions the measure rests on. */
  restsOn: z.array(z.uuid()).nullable(),
  /** A standing measure's earliest start, as its statement names it. */
  earliestStart: z.iso.datetime().nullable(),
  /** A strike's and a warning's last moment of counting. */
  countsUntil: z.iso.datetime().nullable(),
  /** A standing measure's period as it stands now. */
  period: MeasurePeriod.nullable(),
  /**
   * On a strike: the kinds of the standing measures of the account that rest on this strike's decision and stand (not
   * lifted, their basis whole), so that a review says [review.rests] before the key is asked; null on any other kind.
   */
  restedOnBy: z.array(z.enum(["suspend", "terminate"])).nullable(),
  /**
   * 3e Task 2: on a retirement, the handle it retired, from its decision's snapshot in lower case, which the case page
   * names and the preview of its reversal prints. Absent on every other kind.
   */
  handle: z.string().optional(),
  /**
   * 3e Task 4: on a suspension or a termination, the person's reply to it: when it was filed and whether before the start,
   * its text while korbat keeps it (null when there was none or it was erased), and the decision that answered it with
   * when; null when there is no reply and on every other kind. The case page is the one place the text is read.
   */
  reply: z.object({ filedAt: z.iso.datetime(), onTime: z.boolean(), text: z.string().nullable(), answeredAt: z.iso.datetime().nullable(), answeredBy: z.uuid().nullable() }).nullable(),
  /**
   * 3f (design, section 10.2): on an order's measure, its order, whether it keeps the post from its author too, and on a
   * reinstatement its ground; absent on every other kind.
   */
  orderId: z.uuid().optional(),
  withholdAuthor: z.boolean().optional(),
  orderGround: z.enum(["withdrawn", "annulled", "scrutiny", "not_authentic", "wrong_item"]).optional(),
});
export type CaseDecisionAction = z.infer<typeof CaseDecisionAction>;

/**
 * 3d (design, sections 6.1 and 10.3): the custody of one seal for good's files, the answer of seal_custody(action). `files`
 * is two for each image row of the seal's posts that is not erased; `moved` how many of those files are in the quarantine,
 * and `movedAt` the newest time one was recorded there (null when none is); `toReturn` the files of the seal's posts that
 * the quarantine's plan lists for a return to the image store; `filesLeft` the files of its released posts not yet
 * destroyed (0 until the release exists); `lost` the files of its posts that are recorded as lost.
 */
export const SealCustody = z.object({
  files: Count,
  moved: Count,
  movedAt: z.iso.datetime().nullable(),
  toReturn: Count,
  filesLeft: Count,
  lost: Count,
});
export type SealCustody = z.infer<typeof SealCustody>;

// ---------------------------------------------------------------- the release (3d design, sections 6.2, 7.2 and 10)

/**
 * 3d Task 2 (sections 6.2 and 10.1): the mirror of release_rules(), which a database test holds member for column.
 * `silenceDays` is counsel's and ships null, so nothing is released by time: the ground `period` answers
 * release_period_unset. `periodNoticeDays` is how long before such a release its author would be told the day;
 * `backupDays` is RETENTION.backupDays, the age after which a backup that is deleted on time is gone. No member lets an
 * authority's answer release: the ground is a recorded leave or instruction to destroy.
 */
export const RELEASE_RULES = {
  silenceDays: null,
  periodNoticeDays: 30,
  backupDays: 30,
} as const satisfies { silenceDays: number | null; periodNoticeDays: number; backupDays: number };
/** The mirror of release_rules().posts_max: the most posts one release's params name; a seal over more is released in parts, lowest ids first. */
export const RELEASE_POSTS_MAX = 1000;
/** The grounds of a release: a recorded leave or instruction to destroy, or the period's end (unreachable while silenceDays is null). */
export const RELEASE_BASES = ["leave", "period"] as const;
export type ReleaseBasis = (typeof RELEASE_BASES)[number];
/** Who gave a leave or an instruction to destroy (release_leaves.leave_from; `from` is reserved in SQL). */
export const RELEASE_LEAVE_FROM = ["authority", "court"] as const;
export type ReleaseLeaveFrom = (typeof RELEASE_LEAVE_FROM)[number];
/**
 * releases.author_notice: 3c's delivery states (the enum delivery_state, which gains no value) and `held`, while one of
 * release_tellable's three holds stands and the author may not be told yet. The column is text under this CHECK.
 */
export const RELEASE_NOTICE_STATES = ["pending", "sent", "folded", "suppressed", "no_address", "none", "failed", "held"] as const;
export type ReleaseNoticeState = (typeof RELEASE_NOTICE_STATES)[number];

/** A leave or an instruction to destroy that stands, as release_facts answers its six leave_ columns; a withdrawn leave is in no answer. */
export const ReleaseLeave = z.object({
  id: z.uuid(),
  from: z.enum(RELEASE_LEAVE_FROM),
  /** The reference of the letter or order that holds it: an outsider's text, which the console draws framed. */
  reference: z.string().min(1).max(400),
  receivedOn: UtcDay,
  untold: z.boolean(),
  /** With `untold`, the end of the hold on telling the person; null with `untold` true is an open end. */
  untoldUntil: z.iso.datetime().nullable(),
});
export type ReleaseLeave = z.infer<typeof ReleaseLeave>;

/**
 * 3d Task 2 (sections 7.2, 8.5 and 10.3): the release block of a seal for good in force, on its decision. The facts of
 * release_facts(action) (`reported`, `theirReference`, `answer` and `answeredAt`, the authority's assessment shown as
 * what it is, `handedOverAt`, `quarantined` and `preserved` over every unreleased post of the seal, `leave`, and
 * `tellHeld`, whether the author's notice of a release taken now would be held); `postIds`, the lowest RELEASE_POSTS_MAX
 * posts of the seal not yet released, which the params the key signs name, and `remaining`, how many more; `silenceDays`;
 * and, once a part was released, the newest release's `releasedAt`, `basis`, `backupsClearAt` and `noticeHeld` with the
 * seal's released posts and their image rows (`releasedPosts`, `releasedImages`, counted from seal_posts.images, which
 * the disposal never changes), which [release.done] prints. No member is a file's name or digest. 3d review M1: the
 * authority's reference, its assessment with its day and the leave are an admin's block (11.4): absent for a session that
 * is not an admin's.
 */
export const SealRelease = z.object({
  reported: z.boolean(),
  theirReference: z.string().max(400).nullable().optional(),
  answer: z.enum(["not_illegal", "illegal", "no_assessment", "other"]).nullable().optional(),
  answeredAt: z.iso.datetime().nullable().optional(),
  handedOverAt: z.iso.datetime().nullable(),
  quarantined: z.boolean(),
  preserved: z.boolean(),
  leave: ReleaseLeave.nullable().optional(),
  tellHeld: z.boolean(),
  postIds: z.array(z.uuid()).max(RELEASE_POSTS_MAX),
  remaining: Count,
  silenceDays: z.number().int().positive().nullable(),
  releasedAt: z.iso.datetime().nullable(),
  basis: z.enum(RELEASE_BASES).nullable(),
  backupsClearAt: z.iso.datetime().nullable(),
  noticeHeld: z.boolean().nullable(),
  releasedPosts: Count,
  releasedImages: Count,
});
export type SealRelease = z.infer<typeof SealRelease>;

/** 3d Task 2 (sections 8.7 and 10.3): an appeal of a seal whose posts were released, with when and on which ground ([appeals.released]). */
export const AppealReleased = z.object({ at: z.iso.datetime(), basis: z.enum(RELEASE_BASES) });
export type AppealReleased = z.infer<typeof AppealReleased>;

/**
 * A decision as the case page shows it: the statement's data, who decided (a staff handle), the stored facts that it
 * was taken on a suspicion and with the images out of sight, and its measures. A text is null when the decision has
 * none of that kind or it was erased.
 */
export const CaseDecision = z.object({
  id: z.uuid(),
  kind: z.enum(DECISION_KIND_VALUES),
  outcome: z.enum(["restricted", "no_violation", "not_evident", "kept", "partly_reversed", "reversed"]),
  ground: z.enum(["incompatible", "illegal"]).nullable(),
  ruleId: z.enum(RULE_IDS).nullable(),
  rulesVersion: z.number().int().positive(),
  redressVersion: z.number().int().positive(),
  category: z.enum(TDB_CATEGORIES),
  categoryKeyword: z.string().nullable(),
  source: z.enum(DECISION_SOURCE_VALUES),
  decidedAt: z.iso.datetime(),
  /** Who decided; 3d Task 6: null exactly for a program's decision (`byProgram`), which names no staff member. */
  staffHandle: z.string().nullable(),
  /** 3d Task 6 (design, sections 8.4 and 10.3): the decision has no decider: a program took it ([case.auto]). */
  byProgram: z.boolean(),
  /** 3d Task 7 (note 26): the reason of an answer without a seal on an acting match, which the key signed; null otherwise. */
  matchAnswerReason: z.enum(MATCH_ANSWER_REASONS).nullable(),
  throughSeq: Count,
  answersFromSeq: Count.nullable(),
  reviewsDecisionId: z.uuid().nullable(),
  snapshotId: z.uuid(),
  suspect: z.boolean(),
  unseen: z.boolean(),
  needsAdmin: z.boolean(),
  endedInterim: z.boolean(),
  facts: z.string().nullable(),
  reason: z.string().nullable(),
  legalReference: z.string().nullable(),
  actions: z.array(CaseDecisionAction),
  /**
   * 3e Task 3: the suspensions and terminations of the account that stand, whose basis holds, and that rest on this
   * decision (a strike of it, the R5 or terrorist-content decision, or the seal), each with its basis, so that a review or
   * a correction of this decision says before the key is asked what reversing it ends ([review.rests], [review.basis]).
   * Task 5 adds the restrictions of reporting that rest on this decision's warning and still run with it ([review.warning]).
   * Absent where none rests on it.
   */
  standingOn: z.array(z.object({ kind: z.enum(["suspend", "terminate", "restrict_reporting"]), basis: z.enum(STANDING_BASES) })).optional(),
  /**
   * 3d Task 1 (design, sections 6.1, 8.4 and 10.3): on a decision that is not interim and holds a seal_media, where its
   * seal's files are, as seal_custody answers it for that seal: counts and one time, never a file's name or digest and no
   * list by image ([case.custody.in], [case.custody.return], [case.custody.lost]). Absent on every other decision.
   */
  custody: SealCustody.optional(),
  /**
   * 3d Task 2 (sections 7.2, 8.5 and 10.3): on such a decision while its seal is in force, the release block's facts
   * (SealRelease). Absent on every other decision.
   */
  release: SealRelease.optional(),
});
export type CaseDecision = z.infer<typeof CaseDecision>;

/**
 * Whether anyone at korbat may review a pending appeal now, as the database answers it (appeal_reviewer_state):
 * `available`; `none_single_staff` when korbat has at most one staff account that could (one admin, where the review
 * needs an admin); `none_eligible` when it has more and each took part in the case or is too close to someone in it.
 */
export const REVIEWER_STATES = ["available", "none_single_staff", "none_eligible"] as const;
export const ReviewerState = z.enum(REVIEWER_STATES);
export type ReviewerState = z.infer<typeof ReviewerState>;

/**
 * The author's appeal of a decision of the case, with its statement while korbat keeps it, and its answer. For a pending
 * appeal: `reviewer`, whether anyone may review it now; `needsAdmin`, whether its review is an admin's (the appealed
 * decision cites R2 or sealed images); and `mayReview`, whether the reading person may review it: they made none of the
 * case's decisions, opened no finding in it, are not close to anyone in it, and are an admin where one is needed. An
 * answered appeal has no reviewer state and nobody may review it.
 */
export const CaseAppeal = z.object({
  id: z.uuid(),
  decisionId: z.uuid(),
  filedAt: z.iso.datetime(),
  statement: z.string().nullable(),
  answeredAt: z.iso.datetime().nullable(),
  result: z.enum(["kept", "partly_reversed", "reversed"]).nullable(),
  answeredBy: z.uuid().nullable(),
  reviewer: ReviewerState.nullable(),
  needsAdmin: z.boolean(),
  mayReview: z.boolean(),
  /** 3d Task 2: the appealed seal's posts were released; the appeal stays open for an admin ([appeals.released]). */
  released: AppealReleased.nullable().optional(),
});
export type CaseAppeal = z.infer<typeof CaseAppeal>;

/** How many appeals one page of the console's list holds. */
export const APPEALS_PAGE_SIZE = 50;

/**
 * One pending appeal in the console's list: its case, the decision it appeals (when that was decided, the rule or the
 * law it rests on, and what it did), when it was filed, and the end of the decision's appeal window. Then the three
 * marks of CaseAppeal. No row carries the appellant's statement: the reviewer reads it on the case page, whose read is
 * logged and counted.
 */
export const AppealRow = z.object({
  id: z.uuid(),
  caseId: z.uuid(),
  decisionId: z.uuid(),
  filedAt: z.iso.datetime(),
  decidedAt: z.iso.datetime(),
  deadline: z.iso.datetime(),
  ruleId: z.enum(RULE_IDS).nullable(),
  legal: z.boolean(),
  actions: z.array(z.enum(ACTION_KINDS)),
  reviewer: ReviewerState,
  needsAdmin: z.boolean(),
  mayReview: z.boolean(),
  /**
   * 3e (design, sections 7.11 item 6 and 10.3): the appealed decision holds a suspension that runs now or a termination
   * that stands; such appeals come first in the list, oldest first: the person who can do nothing while waiting is read first.
   */
  standingFirst: z.boolean(),
  /** 3d Task 2 (sections 7.2 and 8.7): the appealed seal's posts were released, when and on which ground; null otherwise. */
  released: AppealReleased.nullable().optional(),
});
export type AppealRow = z.infer<typeof AppealRow>;

/** GET /api/staff/appeals: the pending appeals: those of a running suspension or a termination first, oldest first; then the rest, newest first. */
export const AppealsPage = z.object({ appeals: z.array(AppealRow).max(APPEALS_PAGE_SIZE), nextCursor: z.string().nullable() });
export type AppealsPage = z.infer<typeof AppealsPage>;

export const AppealsQuery = z.object({ cursor: z.string().regex(/^[A-Za-z0-9_-]{1,400}$/).optional() });
export type AppealsQuery = z.infer<typeof AppealsQuery>;

/** A note on a case, or a recorded choice not to seal with its reason: who wrote it (a staff handle), when, and the text. */
export const CaseStaffText = z.object({ id: z.uuid(), staffHandle: z.string(), createdAt: z.iso.datetime(), text: z.string() });
export type CaseStaffText = z.infer<typeof CaseStaffText>;

/** One event of a case's history, in the order of their times: ids, enums and times, never text. */
export const CaseHistoryEntry = z.object({
  at: z.iso.datetime(),
  event: z.enum(["item", "snapshot", "decision", "appeal_filed", "appeal_answered", "note", "seal_declined", "reveal", "evidence_erased", "redaction"]),
  refId: z.uuid().nullable(),
  seq: z.number().int().nullable(),
  // 3d Task 6: a program's finding, which the history names as such (Case.tsx's history line).
  intakeKind: z.enum(["user", "finding", "order", "automated"]).nullable(),
  ruleId: z.enum(RULE_IDS).nullable(),
  allegesIllegal: z.boolean().nullable(),
  csam: z.boolean().nullable(),
  reexamination: z.boolean().nullable(),
  decisionKind: z.enum(DECISION_KIND_VALUES).nullable(),
  outcome: z.enum(["restricted", "no_violation", "not_evident", "kept", "partly_reversed", "reversed"]).nullable(),
  staffHandle: z.string().nullable(),
  result: z.enum(["kept", "partly_reversed", "reversed"]).nullable(),
});
export type CaseHistoryEntry = z.infer<typeof CaseHistoryEntry>;

/**
 * 3b (design, sections 8.7 and 10.7): an imported post's label and its import as a case shows them: the source and the
 * archive's day from the post's own columns, the import's id, how many posts that import published (its size), and the
 * day the post was published on korbat, which is the day it was imported.
 */
export const CaseImported = z.object({ source: ImportSource, at: z.iso.date(), importId: z.uuid(), importSize: z.int().min(0), importedAt: z.iso.date() });
export type CaseImported = z.infer<typeof CaseImported>;

/**
 * What a case is about, as it stands now: a post with its state and its level, or an account with the handle, display
 * name and bio it holds now. `link` is the post's korbat address, as text: the console links nowhere into the app. A
 * member is null when the row is gone. 3f: a post an order disabled has the level `disabled`. 3b: a post's member gains,
 * last, `imported`, null for a native post and for a post whose import columns were cleared.
 */
export const CaseTarget = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("post"),
    id: z.uuid(),
    link: z.string(),
    authorHandle: z.string().nullable(),
    state: StoredPostState.nullable(),
    level: z.enum(["visible", "withheld", "removed", "disabled"]).nullable(),
    imported: CaseImported.nullable(),
  }),
  z.object({ type: z.literal("account"), id: z.uuid(), handle: z.string().nullable(), displayName: z.string().nullable(), bio: z.string().nullable(), deleted: z.boolean() }),
]);
export type CaseTarget = z.infer<typeof CaseTarget>;

/**
 * What a case on the path for child sexual abuse material shows in place of images: whether a suspect item is
 * unanswered, what the case reaches, and how often an admin answered such a report about this target or this author
 * without a seal in the last SUSPECT_EARLIER_MONTHS months, with the day staff last opened an image of the post in the
 * console. Counts and days only.
 */
export const CaseSuspicion = z.object({
  open: z.boolean(),
  reach: z.object({ posts: Count, images: Count, sealed: Count, served: Count, newestPostOn: UtcDay.nullable() }),
  earlier: z.object({
    target: z.object({ count: Count, lastOn: UtcDay.nullable(), imagesOpenedOn: UtcDay.nullable() }),
    author: z.object({ count: Count, lastOn: UtcDay.nullable() }),
  }),
});
export type CaseSuspicion = z.infer<typeof CaseSuspicion>;

/**
 * GET /api/staff/cases/:case: the case, its target as it stands, its evidence (newest first), its items, its decisions
 * with their measures and texts, its appeals, the reading person's own drafts, the notes and the recorded choices not to
 * seal, and its history. `suspicion` is set for a case that holds a suspect item or a seal. `imagesAllowed` is false
 * while the post is frozen, and for every account case: an account case shows no image.
 */
/**
 * 3d Task 7 (design, sections 7.11, 8.4 and 10.3): a match's record as staff are shown it, never its hash value: the
 * source, its list version and the classification as the source returned them (a third party's strings, at most 100
 * characters, which the console draws framed), the hash type (so the console can say what an MD5 or SHA-1 match is
 * worth), the kind of match as the source reported it, whether the source lists the class as child sexual abuse material,
 * whether the match acts, and when the comparison was made. An erased record has no classification.
 */
export const MatchRecord = z.object({
  source: z.string().min(1).max(100),
  listVersion: z.string().max(100).nullable(),
  hashType: z.enum(MATCH_HASH_TYPES),
  matchKind: z.enum(MATCH_KINDS),
  classification: z.string().max(100).nullable(),
  listed: z.boolean(),
  acting: z.boolean(),
  queriedAt: z.iso.datetime(),
});
export type MatchRecord = z.infer<typeof MatchRecord>;

/** 3d Task 6: an item a program opened, as the case page reads it (CaseView.signals). */
export const CaseSignal = z.object({
  itemId: z.uuid(),
  kind: z.enum(SIGNAL_KINDS),
  /** The version of the threshold a score was over; 0 under the test scorer; null for a match. */
  thresholdVersion: z.number().int().min(0).nullable(),
  /** 3d Task 7: for a match, its record ([case.match]); null for a score. */
  match: MatchRecord.nullable(),
});
export type CaseSignal = z.infer<typeof CaseSignal>;

export const CaseView = z.object({
  id: z.uuid(),
  lane: LaneNumber,
  stateVersion: Count,
  intakeSeq: Count,
  answeredSeq: Count,
  openedAt: z.iso.datetime(),
  closedAt: z.iso.datetime().nullable(),
  target: CaseTarget,
  suspicion: CaseSuspicion.nullable(),
  imagesAllowed: z.boolean(),
  snapshots: z.array(CaseSnapshot),
  items: z.array(CaseItem),
  decisions: z.array(CaseDecision),
  appeals: z.array(CaseAppeal),
  drafts: z.array(StaffTextDraft),
  notes: z.array(CaseStaffText),
  sealsDeclined: z.array(CaseStaffText),
  history: z.array(CaseHistoryEntry),
  // 3e (design, section 10.3): on a post case the strike's answer and the author's standing in bands, on an account case
  // the account's standing; each null on the other kind of case.
  strikeDue: StrikeDue.nullable(),
  authorStanding: AuthorStanding.nullable(),
  standing: CaseStanding.nullable(),
  /**
   * 3f (design, sections 8.6 and 10.2): `preserved` while the case's post is preserved for an order (post_preserved): the
   * page shows no image and no snapshot text, which the API withholds in any case; `noticeHeld` while an order's notice
   * about the case's post is held, with the hold's end (null while it has none recorded), so that the page and the
   * composer say that a decision taken now is told to its author only at the release; null when none is held.
   */
  preserved: z.boolean(),
  noticeHeld: z.object({ until: z.iso.datetime().nullable() }).nullable(),
  /**
   * Task 4 (section 8.6, [reinstate.erased]): the UTC day on which an order's preservation ended by erasing the case's
   * post, so the reinstatement's composer says that reinstating restores nothing; null on an account case and while no
   * erasure happened.
   */
  orderErasedOn: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, "must be a UTC day").nullable(),
  /**
   * Task 5 (sections 7.13 and 10.2): since when a report to the authorities is owed for this case, from reports_owed();
   * null when none is. The console learns nothing else of a notification record.
   */
  reportOwed: z.object({ since: z.iso.datetime() }).nullable(),
  /**
   * 3d Task 3 (design, sections 7.4, 8.4 and 10.3): for each image the case's newest snapshot lists that stopped being
   * public, its newest outbox row of the edge: the purge's outcome, or pending, and its time. Empty on an account case,
   * while the newest snapshot is withheld, and for images that were never hidden.
   */
  purges: z.array(EdgePurgeView),
  /**
   * 3d Task 6 (design, sections 7.11, 8.4 and 10.3): one entry for each item of the case that a program opened: the item,
   * its signal's kind and, for a score, the version of the threshold it was over ([case.r1]); never the score, which beside
   * an image would read as a verdict. Task 7 adds a match's record.
   */
  signals: z.array(CaseSignal),
  /**
   * The author's request for a person about a program's measure that is in force on the case, with its time
   * ([case.objection]); null when none stands. The text is the author's, drawn framed.
   */
  objection: z.object({ text: z.string(), createdAt: z.iso.datetime() }).nullable(),
  /**
   * 3d Task 7 (design, sections 7.11, 8 rule 2 and 10.3): the images of the case's snapshots that an unerased match record
   * names, which staff are never served, on this case or any other, also after an answer without a seal
   * ([case.image.matched]). A list beside the snapshots, so the members each snapshot's digest covers stay as they are.
   */
  matchedImages: z.array(z.uuid()),
  /**
   * 3d Task 8 (design, sections 7.13, 8.4 and 10.3): the flag "Possible coordinated reporting" ([case.flag]), the two
   * counts of case_flag while it answers true, else null. It is no finding: the case is decided on its content as always.
   */
  flag: CaseFlag.nullable(),
});
export type CaseView = z.infer<typeof CaseView>;

// ---------------------------------------------------------------- the statement of reasons

/** A measure as a statement tells of it: what it was, the image of an image measure, whether it changed anything, and what a seal covers. */
export const StatementMeasure = z.object({
  kind: z.enum(MEASURE_KINDS),
  mediaId: z.uuid().nullable(),
  /** Null when the measure changed what someone sees; `already` or `deleted` when it did not. */
  noEffect: z.enum(["already", "deleted"]).nullable(),
  /**
   * For a seal: the posts and images its list held when it was recorded, and how many of those images were on posts their
   * author had deleted by then. 2d Task 4 (design, section 7.7): and, present only when there are any, the profile
   * pictures an account seal listed (seal_avatars).
   */
  sealed: z.object({ posts: Count, images: Count, deletedImages: Count, avatars: Count.optional() }).nullable(),
  // 3e (design, section 10.2): what the ledger fixes for good about a measure of 3e, so a statement reads as it was sent.
  // Absent on 3c's measures.
  /** A strike's last moment of counting. */
  endsAt: z.iso.datetime().nullable().optional(),
  /** On a strike: the account's strikes that stood and counted at the decision's time, this one included. */
  activeThen: Count.nullable().optional(),
  /** On a suspension or a termination: whether it was announced with the reply window or taken at once. */
  announced: z.boolean().nullable().optional(),
  /** On a retirement: the handle of the decision's snapshot, in lower case, as the database retires it. */
  handle: z.string().nullable().optional(),
  /** On a retirement that changed the profile: the placeholder the profile got; null when the measure changed nothing. */
  placeholder: z.string().nullable().optional(),
  /** On a suspension: its days, as the key signed them. */
  days: z.number().int().min(STANDING_DAYS.min).max(STANDING_DAYS.max).nullable().optional(),
  /** On a standing measure: what the database found it rests on. */
  basis: z.enum(STANDING_BASES).nullable().optional(),
  /** On a standing measure: its earliest start (the ledger row's starts_at), the decision's time for one taken at once. */
  earliestStart: z.iso.datetime().nullable().optional(),
  /**
   * On a standing measure: one entry for each decision it rests on, in the ledger's order, with its time, its rule and the
   * time of the post it was about; for a protective suspension the one entry is the sealing decision, with its time only.
   */
  restsOn: z.array(z.object({ decidedAt: z.iso.datetime(), ruleId: z.enum(RULE_IDS).nullable(), postCreatedAt: z.iso.datetime().nullable() })).nullable().optional(),
  /**
   * 3e Task 5: on a restriction of reporting, the time of the warning it follows (its decision's), which its statement
   * names. A warning and a restriction also carry `basis` (`reports`) and `endsAt` (a warning's end of counting; a
   * restriction's start plus its days), and a restriction its `days`.
   */
  warnedAt: z.iso.datetime().nullable().optional(),
});
export type StatementMeasure = z.infer<typeof StatementMeasure>;

/**
 * 3e (design, section 10.2): where a suspension's or a termination's period stood at a decision's time, as the ledger
 * fixes it for good: not started, running since `startedAt`, or ended (from `startedAt` to `endedAt`). A member a state
 * does not need is null.
 */
export const PeriodThen = z.object({ state: z.enum(["not_started", "running", "ended"]), startedAt: z.iso.datetime().nullable(), endedAt: z.iso.datetime().nullable() });
export type PeriodThen = z.infer<typeof PeriodThen>;

/**
 * 3e (design, section 10.2): a standing measure (or a restriction of reporting) whose basis a reversal of this decision
 * broke: its kind and decision's time, where its period stood then, whether the basis that broke was a seal, and the time
 * of its reply when this decision found it unanswered and so answers it.
 */
export const StatementEndedStanding = z.object({
  kind: z.enum(["suspend", "terminate", "restrict_reporting"]),
  decidedAt: z.iso.datetime(),
  periodThen: PeriodThen,
  seal: z.boolean(),
  replyFiledAt: z.iso.datetime().nullable(),
});
export type StatementEndedStanding = z.infer<typeof StatementEndedStanding>;

/**
 * What a statement says of a field reset that ended or was lifted: the decision that holds the reset (whose screen shows
 * the old value), whether korbat still kept that value when this decision was made, and the rule that decision cites,
 * since a value reset under R4 may have been erased by then.
 */
const ResetFacts = { resetDecisionId: z.uuid().nullable(), oldValueKept: z.boolean(), resetRuleId: z.enum(RULE_IDS).nullable() };

/** A reversal as a statement tells of it. The reset's facts are set only on the lifting of a field reset. */
export const StatementReversal = z.object({
  kind: z.enum(REVERSAL_KINDS),
  mediaId: z.uuid().nullable(),
  ...ResetFacts,
  /** 3e: on the reversal of a retirement, the handle it gives back, as the lifted decision's snapshot holds it, in lower case. */
  handle: z.string().nullable().optional(),
  /**
   * 3e: on the lift of a suspension or a termination, the lifted measure's kind and its decision's time. Task 5: on the
   * lift of a reporting measure, the lifted warning's or restriction's kind and its decision's time too.
   */
  liftedKind: z.enum(["suspend", "terminate", "warn_reporting", "restrict_reporting"]).nullable().optional(),
  liftedDecidedAt: z.iso.datetime().nullable().optional(),
  /**
   * 3e: on such a lift, where the lifted measure's period stood at this decision's time. Task 5: on the lift of a
   * restriction of reporting, whether it still ran (`running`) or its days had run out (`ended`, with its end).
   */
  periodThen: PeriodThen.nullable().optional(),
  /** 3e: on such a lift, whether the correction withdrew an announced measure to make room for another (signed `replaced`). */
  replaced: z.boolean().nullable().optional(),
  /**
   * 3e Task 4: on such a lift, when the person had replied to the lifted measure, or null when they had not: a withdrawal
   * signed `replaced` then says that it is no decision on that reply.
   */
  replyFiledAt: z.iso.datetime().nullable().optional(),
});
export type StatementReversal = z.infer<typeof StatementReversal>;

/**
 * 3e (design, section 10.2): on a correction or a review of the decision that holds a suspension or a termination, when it
 * kept or reversed that measure while the person's reply to it was unanswered (never a withdrawal signed `replaced`, never
 * the end of a broken basis): the reply's time and whether it came before the start; the measure's kind and days; where
 * its period stood at this answer's time; the start and the end as this answer fixes or leaves them (after a kept answer
 * to a reply before the start, the later of the answer and the earliest start; the end null for a termination; both null
 * when the measure never starts); and the last moment of the announcing decision's appeal as it stands after this answer.
 */
export const StatementRepliedTo = z.object({
  filedAt: z.iso.datetime(),
  onTime: z.boolean(),
  kind: z.enum(["suspend", "terminate"]),
  days: z.number().int().min(STANDING_DAYS.min).max(STANDING_DAYS.max).nullable(),
  periodThen: PeriodThen,
  startsAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime().nullable(),
  appealUntil: z.iso.datetime(),
});
export type StatementRepliedTo = z.infer<typeof StatementRepliedTo>;

/** A measure taken while deciding that ended with the decision, without a reversal. The reset's facts are set only on a field reset. */
export const StatementEndedMeasure = z.object({ kind: z.enum(MEASURE_KINDS), mediaId: z.uuid().nullable(), ...ResetFacts });
export type StatementEndedMeasure = z.infer<typeof StatementEndedMeasure>;

/**
 * The statement's data (3c design, section 10): everything a statement of reasons is rendered from, and nothing a later
 * event changes, so a statement reads as it was sent whenever it is rendered. It is the part of a decision that the
 * author's decision view, the console's preview and the mail share; @korbat/rules renders it (statementParagraphs).
 *   - `rulesVersion` and `redressVersion`: the rulebook and the redress texts the decision was made under.
 *   - `facts`, `reason`, `legalReference`: the staff texts, each null when the decision has none or it was erased.
 *   - `post`: the post a post case is about, by its id and creation time, which survive its deletion; null for an account case.
 *   - `endedMeasures`: the measures taken while deciding that ended with this decision. A seal taken while deciding is
 *     left out when the decision itself seals, since the images stay sealed.
 *   - `reviewed`: for a review or a correction, the decision it reviews, whose rule or law the statement renders
 *     under the rulebook version that decision was made under (`reviewed.rulesVersion`), never under its own.
 */
/** 3d Task 6: the three values of decisions.automated_decision, which its CHECK holds. */
export const AUTOMATED_DECISIONS = ["not_automated", "partially", "fully"] as const;
export type AutomatedDecision = (typeof AUTOMATED_DECISIONS)[number];

/**
 * 3d Task 6 (design, sections 7.10 and 10.2; W.3): the automated finding a statement speaks of. For a score: its kind,
 * and `viewed`, true when the person who decided opened the signal's image on this case before the decision and the
 * decision is not stored as unseen, false otherwise, null on a program's decision. For a match (Task 7): the source's
 * declared name, `matchKind` (exact only for a cryptographic hash's exact match, near for every perceptual match) and
 * `listedAs` (csam when the source itself lists the entry so). Null members are those its kind does not have.
 */
export const StatementSignal = z.object({
  kind: z.enum(SIGNAL_KINDS),
  source: z.string().max(100).nullable(),
  matchKind: z.enum(["exact", "near"]).nullable(),
  listedAs: z.enum(["csam", "other"]).nullable(),
  viewed: z.boolean().nullable(),
});
export type StatementSignal = z.infer<typeof StatementSignal>;

export const DecisionStatement = z.object({
  kind: z.enum(DECISION_KIND_VALUES),
  outcome: z.enum(["restricted", "no_violation", "not_evident", "kept", "partly_reversed", "reversed"]),
  ground: z.enum(["incompatible", "illegal"]).nullable(),
  ruleId: z.enum(RULE_IDS).nullable(),
  rulesVersion: z.number().int().positive(),
  redressVersion: z.number().int().positive(),
  legalReference: z.string().nullable(),
  facts: z.string().nullable(),
  reason: z.string().nullable(),
  source: z.enum(DECISION_SOURCE_VALUES),
  decidedAt: z.iso.datetime(),
  post: z.object({ id: z.uuid(), createdAt: z.iso.datetime() }).nullable(),
  measures: z.array(StatementMeasure),
  reversals: z.array(StatementReversal),
  endedMeasures: z.array(StatementEndedMeasure),
  /** 3e: the standing measures and restrictions of reporting whose basis a reversal of this decision broke; absent before 3e. */
  endedStanding: z.array(StatementEndedStanding).optional(),
  /** 3e Task 4: the reply this correction or review answered by keeping or reversing its measure; absent otherwise. */
  repliedTo: StatementRepliedTo.optional(),
  reviewed: z
    .object({
      kind: z.enum(["interim", "final", "order"]),
      ground: z.enum(["incompatible", "illegal"]).nullable(),
      ruleId: z.enum(RULE_IDS).nullable(),
      rulesVersion: z.number().int().positive(),
      legalReference: z.string().nullable(),
      decidedAt: z.iso.datetime(),
      /**
       * 3e's review (people1): the basis of the reviewed decision's suspension or termination, null for a decision without
       * one; absent before 3e. A decision about a measure on the bases strikes, ladder_end or protective names korbat's
       * terms as what it rested on, never the rule it cited.
       */
      basis: z.enum(STANDING_BASES).nullable().optional(),
    })
    .nullable(),
  /**
   * 3f (design, section 10.4): for an order decision and the correction of one, what its notice is rendered from, built at
   * every read from the decision's row, its item's and the order's as they stand, so the notice grows without a new
   * decision; null (or absent) for every other decision.
   */
  order: OrderNoticeFacts.nullable().optional(),
  /**
   * 3f Task 6 (sections 7.17 step 7 and 10.4): for a decision that closed a restore gap, the UTC day of the lost decision
   * it took again, read from the gap, which is kept for as long as the decision; absent for every other decision.
   */
  reapplied: z.object({ lostOn: z.iso.date() }).nullable().optional(),
  /**
   * 3f's review (people3): the instant its author was told of the decision, the decision's informed_at: its own time for a
   * decision told at once, the release for one held with an order's notice, null while it is held; absent before the
   * review. The appeal's six months count from it, as appeal_deadline counts them in the database.
   */
  informedAt: z.iso.datetime().nullable().optional(),
  /**
   * 3d Task 6 (design, sections 7.10 and 10.2; W.3): what the decision's own columns say of automated means, and the
   * automated finding it rests on or considered. `automatedDetection` is true when a program's finding is among what the
   * decision considers (its reviewed decision's for a review or a correction); `automatedDecision` is fully for a
   * program's decision, partially for a restriction an admin took on a suspect program's finding under R2, and
   * not_automated otherwise. `signal` is that finding: its kind, and for a score whether the person who decided opened
   * the image on the case before deciding (`viewed`; null on a program's own decision). Absent, as on a decision made
   * before 3d, they read false, not_automated and null. No score, hash or list version is ever here.
   */
  automatedDetection: z.boolean().optional(),
  automatedDecision: z.enum(AUTOMATED_DECISIONS).optional(),
  signal: StatementSignal.nullable().optional(),
});
export type DecisionStatement = z.infer<typeof DecisionStatement>;

// ---------------------------------------------------------------- the app: what the author and the reporter read

/** A page cursor of the app's moderation lists: an opaque word the API wrote. */
const ListCursor = z.string().regex(/^[A-Za-z0-9_-]{1,400}$/);

/** How many decisions one page of the author's list holds. */
export const AUTHOR_CASES_PAGE_SIZE = 20;

/**
 * One decision in its author's list (3c design, section 7.6): the decisions their author was told of, and no other.
 * `decidedOn` is the decision's UTC day, never the day its case opened, which would tell when a report arrived. `post` is
 * the post a decision about a post concerns, by its id and creation time; null for a decision about the account.
 * `actions` are what the decision did, measures and reversals, in the ledger's order of kinds; `endedInterim` says that
 * what korbat did while deciding ended with it. `ruleId` and `legal` name the rule or the law it rests on (neither for a
 * decision without a ground). `appealUntil` is the end of the appeal's window while an appeal can still be filed, and
 * `reversedOn` the UTC day a final restriction was reversed in full; both null otherwise. `appeal` is where the author's
 * appeal of the decision stands: `pending`, or its answer; null when they filed none.
 */
export const AuthorCaseRow = z.object({
  id: z.uuid(),
  kind: z.enum(DECISION_KIND_VALUES),
  outcome: z.enum(["restricted", "no_violation", "not_evident", "kept", "partly_reversed", "reversed"]),
  decidedOn: UtcDay,
  post: z.object({ id: z.uuid(), createdAt: z.iso.datetime() }).nullable(),
  actions: z.array(z.enum(ACTION_KINDS)),
  endedInterim: z.boolean(),
  ruleId: z.enum(RULE_IDS).nullable(),
  legal: z.boolean(),
  appealUntil: z.iso.datetime().nullable(),
  reversedOn: UtcDay.nullable(),
  appeal: z.enum(["pending", "kept", "partly_reversed", "reversed"]).nullable(),
  /** The strike the decision gave (3e design, section 10.2): until when it counts, and when it was overruled; null for a decision without one. */
  strike: z.object({ countsUntil: z.iso.datetime(), overruledAt: z.iso.datetime().nullable() }).nullable(),
  /**
   * 3e Task 5 (design, sections 9.4 and 10.2): the days of the decision's restriction of reporting, which its row names;
   * and the kinds of the measures whose basis a reversal of this decision broke (its statement's endedStanding), which the
   * row says ended with it. Absent where the decision holds none.
   */
  reportingDays: z.number().int().min(STANDING_DAYS.min).max(STANDING_DAYS.max).optional(),
  endedStanding: z.array(z.enum(["suspend", "terminate", "restrict_reporting"])).optional(),
  /**
   * 3e's review (people7; design, section 9.4): the decision's suspension or termination, by its kind, its days (null for a
   * termination) and whether it was announced, which its row names; and what a lift of one lifted, a suspension or a
   * termination, and whether it was a withdrawal for another measure. Absent where the decision holds none.
   */
  standingMeasure: z.object({ kind: z.enum(["suspend", "terminate"]), days: z.number().int().min(STANDING_DAYS.min).max(STANDING_DAYS.max).nullable(), announced: z.boolean() }).optional(),
  liftedStanding: z.object({ kind: z.enum(["suspend", "terminate"]), replaced: z.boolean() }).optional(),
  /**
   * 3f (design, sections 9.3 and 10.4): on the row of an order decision, whether its measure keeps the post from its author
   * too (`disabled`) or only from everyone else (`removed`, a DSA order that does not withhold); on the correction that
   * reinstates after one, `lifted`. Such a row names no rule. Absent on every other row.
   */
  order: z.enum(["disabled", "removed", "lifted"]).optional(),
  /**
   * 3f's review (people9; design, section 9.3): on the row of an order decision, the UTC day its author was told, which the
   * row shows in place of `decidedOn` and by which the list places it: a notice released after a hold is told weeks after
   * the disabling. Absent on every other row.
   */
  toldOn: UtcDay.optional(),
  /**
   * 3d Task 6 (design, sections 9.4 and 10.2): the decision has no decider, so its screen shows [auto.chip] "Taken by a
   * program". Absent, as before 3d, it reads false.
   */
  byProgram: z.boolean().optional(),
});
export type AuthorCaseRow = z.infer<typeof AuthorCaseRow>;

/**
 * GET /api/moderation/cases: the decisions about the viewer's account, newest first, and how many strikes of the account
 * count now (active_strikes), which the block "Your standing" above the list prints.
 */
export const AuthorCasesPage = z.object({ decisions: z.array(AuthorCaseRow).max(AUTHOR_CASES_PAGE_SIZE), nextCursor: z.string().nullable(), activeStrikes: Count });
export type AuthorCasesPage = z.infer<typeof AuthorCasesPage>;

/** 3d Task 2 (section 10.2): how many notices one page of GET /api/moderation/notices holds. */
export const AUTHOR_NOTICES_PAGE_SIZE = 20;
/** How many of a release's posts its notice lists by their time; `postCount` counts them all. */
export const RELEASE_NOTICE_POSTS_MAX = 20;
/**
 * 3d Task 2 (sections 9.6 and 10.2): GET /api/moderation/notices, the notices about the viewer's own posts that are not
 * decisions, newest first: the releases of sealed images of their posts, each with its id and time, and never one
 * whose notice is held. Task 7 adds the refusals of uploads (`upload_refused`).
 */
export const AuthorNoticesPage = z.object({
  notices: z.array(z.object({ kind: z.enum(["release", "upload_refused"]), id: z.uuid(), at: z.iso.datetime() })).max(AUTHOR_NOTICES_PAGE_SIZE),
  nextCursor: z.string().nullable(),
});
export type AuthorNoticesPage = z.infer<typeof AuthorNoticesPage>;

/**
 * 3d review L11 (people9): where the author's appeal of the decision that sealed stands, which the notice's paragraph on
 * that decision follows: none filed (or a held upload's release, which has no such decision), pending, or answered.
 * Never the answer's word: the decision's own screen gives it.
 */
export const RELEASE_NOTICE_APPEALS = ["none", "pending", "answered"] as const;
export type ReleaseNoticeAppeal = (typeof RELEASE_NOTICE_APPEALS)[number];

/**
 * 3d Task 2 (sections 9.6, 10.2 and W.6): GET /api/moderation/releases/:release, what releaseNoticeParagraphs reads, and
 * the decision that sealed, for the link to its screen, with where its appeal stands (review L11). Never an answer's word
 * or an assessment, who gave the leave, an authority or a reference. The route answers not_found to anyone but the posts'
 * author, and while the release's notice is held.
 */
export const ReleaseNoticeView = z.object({
  id: z.uuid(),
  basis: z.enum(RELEASE_BASES),
  releasedAt: z.iso.datetime(),
  backupsClearAt: z.iso.datetime(),
  /** A held upload's release (Task 7); false for a seal's. */
  upload: z.boolean(),
  posts: z.array(z.object({ id: z.uuid(), createdAt: z.iso.datetime() })).max(RELEASE_NOTICE_POSTS_MAX),
  postCount: Count,
  /** The image rows the release erased: the seal's count of each post's images. */
  images: Count,
  sealDecisionId: z.uuid().nullable(),
  appeal: z.enum(RELEASE_NOTICE_APPEALS),
});
export type ReleaseNoticeView = z.infer<typeof ReleaseNoticeView>;

/**
 * 3d Task 7 (design, sections 7.12, 9.5, 10.2 and W.5): GET /api/moderation/uploads/:refusal, what uploadNoticeParagraphs
 * reads of a refused upload, for its uploader alone, and nothing of the file: no hash, no classification string, no list
 * version, no admin. `matchKind` is derived as in a statement (statementMatchKind) and `listedAs` is always csam: only an
 * acting match is ever refused. `mayObject` is 7.12's one rule. `endedAt`, `endAs` and `endReason` are null while the hold
 * stands, and for an end as no_report until its delay has passed: the uploader is told of that end when it is one.
 * `released` is the release's time, null while there is none or its notice is held. `reportKept` is true while a record of
 * a report under 3f names the refusal.
 */
export const UploadRefusalView = z.object({
  id: z.uuid(),
  refusedAt: z.iso.datetime(),
  source: z.string().min(1).max(100),
  matchKind: z.enum(MATCH_KINDS),
  listedAs: z.literal("csam"),
  objection: z.object({ text: z.string(), objectedAt: z.iso.datetime() }).nullable(),
  mayObject: z.boolean(),
  endedAt: z.iso.datetime().nullable(),
  endAs: z.enum(UPLOAD_ENDS).nullable(),
  endReason: z.enum(UPLOAD_END_REASONS).nullable(),
  released: z.iso.datetime().nullable(),
  reportKept: z.boolean(),
});
export type UploadRefusalView = z.infer<typeof UploadRefusalView>;

/** A strike as its decision's screen shows it: until when it counts, whether it still counts, ran out or was overruled, and when. */
export const DecisionStrike = z.object({ countsUntil: z.iso.datetime(), state: z.enum(["counts", "expired", "overruled"]), overruledAt: z.iso.datetime().nullable() });
export type DecisionStrike = z.infer<typeof DecisionStrike>;

export const AuthorCasesQuery = z.object({ cursor: ListCursor.optional() });
export type AuthorCasesQuery = z.infer<typeof AuthorCasesQuery>;

/**
 * An image of the content a decision was made on, as the app's own image route serves it to its author. It is listed
 * only while that route serves it: never for a sealed image or one of a post its author deleted.
 */
export const DecisionImage = z.object({ id: MediaId, alt: z.string(), width: z.number().int().positive(), height: z.number().int().positive(), small: z.string(), large: z.string() });
export type DecisionImage = z.infer<typeof DecisionImage>;

/**
 * The content a decision was made on, from the decision's snapshot, or the reason it is not shown; the first that
 * applies, in this order (3c design, sections 7.6 and 10):
 *   - `r4_redacted`: an R4 redaction erased it when the restriction became final;
 *   - `erased`: korbat's copy was erased under its retention rules, on `contentErasedOn` (a UTC day); `postKept` says
 *     that the post itself is still in its author's profile;
 *   - `post`: the post's text, which is never sealed, and its images. `imagesHidden` says why none is listed: `sealed`
 *     (nobody is shown them, the author included), or `deleted_by_author` (kept for the case, served to nobody);
 *     `imageCount` is how many the snapshot holds either way. `deletedByAuthor` says that the author deleted the post;
 *   - `account`: the account's fields as the snapshot held them, which for a field reset is the value the reset removed.
 */
export const DecisionContent = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("r4_redacted") }),
  z.strictObject({ kind: z.literal("erased"), contentErasedOn: UtcDay, postKept: z.boolean() }),
  z.strictObject({
    kind: z.literal("post"),
    body: z.string(),
    deletedByAuthor: z.boolean(),
    images: z.array(DecisionImage),
    imageCount: Count,
    imagesHidden: z.enum(["sealed", "deleted_by_author"]).nullable(),
  }),
  z.strictObject({ kind: z.literal("account"), handle: z.string(), displayName: z.string(), bio: z.string() }),
]);
export type DecisionContent = z.infer<typeof DecisionContent>;

/**
 * The author's appeal as the decision's screen shows it (3c design, sections 7.7 and 10).
 *   - `pending`: `reviewer` says whether anyone at korbat may review it now and, when nobody may, whether that is
 *     because korbat has one moderator (or one admin); `needsAdmin` that its review is an admin's, which is true only
 *     when the decision cites R2 or sealed images, both of which its author was told. Neither says who took part in
 *     the case or why someone may not review it.
 *   - `answered`: the result, the UTC day, and the answering decision with its statement's data, which the screen
 *     renders as it renders every statement: the review, or the correction that reversed everything before a review.
 */
export const DecisionAppeal = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("pending"), filedAt: z.iso.datetime(), reviewer: ReviewerState, needsAdmin: z.boolean() }),
  z.strictObject({
    state: z.literal("answered"),
    filedAt: z.iso.datetime(),
    answeredOn: UtcDay,
    result: z.enum(["kept", "partly_reversed", "reversed"]),
    answeredBy: z.uuid(),
    statement: DecisionStatement,
  }),
]);
export type DecisionAppeal = z.infer<typeof DecisionAppeal>;

/**
 * GET /api/moderation/decisions/:id: one decision as its author reads it (3c design, sections 7.6 and 10). It is the
 * statement's data, which the app renders with statementParagraphs exactly as the mail was rendered, and what the
 * author's screen adds: `appealUntil` and `reversedOn` as the list gives them, the content actioned, and `appeal`, the
 * author's appeal of this decision (null when they filed none).
 */
/**
 * 3e (design, sections 9.2 and 10.2): where a decision's suspension or termination stands now, read fresh, beside the
 * statement that never changes. `state` as the case page's period has it (unfixed, announced, held, running, ended, never,
 * lifted, basis_ended); the earliest start the statement names; the start and the end once the database has them (the end
 * null for a termination); when it stopped early, and by which decision (`endedBy`: the one that lifted it, withdrew it
 * signed `replaced`, or broke its basis), with `replaced` true for a withdrawal; each decision it rests on (a strike's with
 * where that strike stands now); the reply, with its text while korbat keeps it; and whether a reply can still be sent.
 */
export const DecisionStanding = z.object({
  state: z.enum(PERIOD_STATES),
  earliestStart: z.iso.datetime(),
  startsAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime().nullable(),
  endedAt: z.iso.datetime().nullable(),
  endedBy: z.uuid().nullable(),
  replaced: z.boolean(),
  restsOn: z.array(
    z.object({
      decisionId: z.uuid(),
      ruleId: z.enum(RULE_IDS).nullable(),
      decidedAt: z.iso.datetime(),
      countsUntil: z.iso.datetime().nullable(),
      state: z.enum(["counts", "expired", "overruled"]).nullable(),
      overruledAt: z.iso.datetime().nullable(),
    }),
  ),
  reply: z
    .object({ filedAt: z.iso.datetime(), onTime: z.boolean(), text: z.string().nullable(), erasedAt: z.iso.datetime().nullable(), answeredAt: z.iso.datetime().nullable(), answeredBy: z.uuid().nullable() })
    .nullable(),
  replyOpen: z.boolean(),
});
export type DecisionStanding = z.infer<typeof DecisionStanding>;

/**
 * 3e Task 5 (design, sections 9.2 and 10.2): where a decision's restriction of reporting stands now, read fresh: `running`
 * until its end; `ended` once its days ran out; `lifted` by a review or a correction of its own decision; `basis_ended`
 * when it ended with the warning it rested on, which korbat lifted. `until` is its end as decided (its start plus its
 * days); `endedAt` and `endedBy` the time and the decision that lifted it, or that lifted its warning (null otherwise).
 */
export const ReportingStanding = z.object({
  state: z.enum(["running", "ended", "lifted", "basis_ended"]),
  until: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  endedBy: z.uuid().nullable(),
});
export type ReportingStanding = z.infer<typeof ReportingStanding>;

/**
 * 3d Task 6 (design, sections 7.10 and 10.2): where "Ask for a person" stands on a program's decision. `open` while a
 * measure of it is in force and no objection exists; `asked` with the text and its time while the measure stays in force;
 * `decided` once no measure of it is in force, naming the person's decision that ended it and its time. No lapse by time
 * moves it: only a person's decision does.
 */
export const AskPerson = z.discriminatedUnion("state", [
  z.object({ state: z.literal("open") }),
  z.object({ state: z.literal("asked"), text: z.string(), createdAt: z.iso.datetime() }),
  z.object({ state: z.literal("decided"), decisionId: z.uuid(), decidedAt: z.iso.datetime() }),
]);
export type AskPerson = z.infer<typeof AskPerson>;

export const DecisionView = DecisionStatement.extend({
  id: z.uuid(),
  appealUntil: z.iso.datetime().nullable(),
  reversedOn: UtcDay.nullable(),
  /** 3f: null for an order decision while its measure is in force and after its preservation erased the post (10.4). */
  content: DecisionContent.nullable(),
  appeal: DecisionAppeal.nullable(),
  /** The strike the decision gave, read fresh (3e design, section 10.2); null for a decision without one. */
  strike: DecisionStrike.nullable(),
  /** 3e Task 4: where the decision's suspension or termination stands now; null for a decision without one. */
  standing: DecisionStanding.nullable(),
  /** 3e Task 5: where the decision's restriction of reporting stands now; null (or absent) for a decision without one. */
  reportingStanding: ReportingStanding.nullable().optional(),
  /**
   * 3f (design, section 10.4), read fresh for an order decision and the correction of one: the authority's words as the
   * command line recorded them, and `textsAt`, the time the newest of them was told to the author; and `erasedOn`, the
   * day the preservation's end erased the content. Null (or absent) for every other decision.
   */
  orderTexts: OrderTexts.nullable().optional(),
  erasedOn: UtcDay.nullable().optional(),
  /**
   * 3d Task 6 (design, sections 7.10, 9.4 and 10.2): "Ask for a person" on a program's decision, read fresh; null for a
   * decision with a decider (and absent before 3d).
   */
  askPerson: AskPerson.nullable().optional(),
});
export type DecisionView = z.infer<typeof DecisionView>;

/** How many reports one page of the reporter's list holds. */
export const REPORTS_PAGE_SIZE = 20;

/**
 * One item of a report in its sender's own list: the item as the status page gives it, and its id, by which the signed-in
 * sender asks for its re-examination. The status page, which anyone holding a link may open, names an item by its
 * position and never carries an id.
 */
export const ReportItem = NoticeItemStatus.extend({
  id: z.uuid(),
  /**
   * 3e Task 5 (design, sections 7.9 step 3, 9.4 and 10.2): a moderator marked this item "manifestly unfounded" and the mark
   * still counts (no correction withdrew it, no re-examination of it ended in a restriction, its report is within the
   * frame); false until the item's outcome is released, so the mark tells the sender nothing before the release does.
   * The status page by reference and token never carries it.
   */
  unfounded: z.boolean(),
});
export type ReportItem = z.infer<typeof ReportItem>;

/** One report or notice in its sender's list: its reference, when korbat received it, and its items as the status page gives them, each with its id. */
export const ReportRow = z.object({ ref: NoticeRef, receivedAt: z.string(), items: z.array(ReportItem) });
export type ReportRow = z.infer<typeof ReportRow>;

/**
 * GET /api/moderation/reports: the viewer's own reports and notices, newest first, while korbat keeps their records.
 * `reportMailStopped` says that korbat's mails about reports to the account's address are stopped, which someone who
 * holds that address asked for.
 */
export const ReportsPage = z.object({ reports: z.array(ReportRow).max(REPORTS_PAGE_SIZE), nextCursor: z.string().nullable(), reportMailStopped: z.boolean() });
export type ReportsPage = z.infer<typeof ReportsPage>;

export const ReportsQuery = z.object({ cursor: ListCursor.optional() });
export type ReportsQuery = z.infer<typeof ReportsQuery>;

/** How many rows each of the overview's lists holds at most; its total says how many there are. */
export const OVERVIEW_LIST_MAX = 100;

const MailCounts = z.object({ receipts: Count, authorMails: Count, outcomes: Count });

/**
 * What retention should have erased or deleted more than a day ago and has not, one count for each due rule: closed
 * cases whose evidence is due, intake records, statements of accounts deleted for 12 months, R4 redactions, image rows
 * that nothing retains, unconfirmed drafts, access rows, and notifiers' contacts and confirmations. The retention job and
 * the auth janitor each run every ten minutes, so any count above zero means a step keeps failing, or that the retention
 * job is switched off. The API reads the counts at most once a minute, for all staff.
 */
export const ErasureOverdue = z.object({ caseEvidence: Count, intakeRecords: Count, statements: Count, redactions: Count, images: Count, drafts: Count, accessLog: Count, contacts: Count });
export type ErasureOverdue = z.infer<typeof ErasureOverdue>;
const HandleCount = z.object({ handle: z.string(), count: Count });

/**
 * GET /api/staff/overview: what the home screen shows every staff member. Per lane the open cases and since when the
 * oldest unanswered item waits; the appeals waiting, how many of them the reading person may review
 * (`appealsYouMayReview`, by CaseAppeal's rule) and how many no staff account may review now
 * (`appealsWithoutReviewer`: the database's appeal_reviewer_state is not `available`); every reveal of a source in the last 30 days, newest first, with
 * its staff handle and its case; per staff handle the images viewed and the findings opened today (UTC); the mails
 * waiting for more than an hour and those given up in the last 30 days; the decided items the daily release has not
 * released after 26 hours; what retention should have erased more than a day ago and has not (`erasureOverdue`); and
 * whether the emergency switch is on. And, of the path for child sexual abuse material,
 * three lists every staff member sees: the decisions of the last 30 days that lifted the protection of reported images
 * (a lifted seal, `unsealed`, or an admin's final answer to such a report without a seal, `dismissed`), the recorded
 * choices not to seal of the last 30 days, and the seals taken while deciding that are in force, each with what it
 * covers. Counts, times, handles and cases only.
 */
/**
 * 3d (design, sections 6.1, 8.1 and 10.3): the quarantine's four values on the home screen, those of quarantine_counts()
 * and nothing else: how many images are to be moved into the quarantine and how many returned to the image store, how
 * many images have files to destroy, and since when the oldest move in or out has been due (null when none is).
 */
export const QuarantineCounts = z.object({ dueIn: Count, dueOut: Count, undestroyed: Count, oldest: z.iso.datetime().nullable() });
/** 3d Task 2 (sections 8.2 and 10.3): the kinds of act Home lists for DESTRUCTIVE_DAYS, as 3c lists a lifted seal. */
export const DESTRUCTIVE_KINDS = ["seal_released", "upload_released", "hold_ended_unreported"] as const;
/** How long Home lists such an act, and at most how many. */
export const DESTRUCTIVE_DAYS = 30;
export const DESTRUCTIVE_MAX = 50;
export type QuarantineCounts = z.infer<typeof QuarantineCounts>;

/**
 * 3d (design, sections 6.1, 7.1, 8.10 and 10.1): the four directions of a line of staff.js quarantine-list, and the words
 * the one-shot mover prints at the end of a line of its receipt: for a move in or out, `done`, `already` (the file was
 * where its direction wants it), `missing` (in neither place), `lost` (the same, on a run with --lost) or `refused` (a
 * name outside the store's layout, or a copy whose digest differs); for a destroy line, where the file was found
 * (`quarantine`, `store`, `both`), `already` when it was in neither, or `refused` for a name outside the layout; and the
 * line kind `have` of an inventory. The mover, which imports nothing, keeps its own copy, held equal to this by a test.
 */
export const QUARANTINE_DIRECTIONS = ["in", "out", "destroy", "operator"] as const;
export type QuarantineDirection = (typeof QUARANTINE_DIRECTIONS)[number];
export const QUARANTINE_WORDS = {
  move: ["done", "already", "missing", "lost", "refused"],
  destroy: ["quarantine", "store", "both", "already", "refused"],
  have: "have",
} as const;

/** 3d Task 6: how many cases each of Home's two lists of a program's measures names at most. */
export const AUTOMATED_CASES_MAX = 20;

export const StaffOverview = z.object({
  lanes: z.array(z.object({ lane: LaneNumber, open: Count, oldestAt: z.iso.datetime().nullable() })).length(3),
  appealsWaiting: Count,
  appealsYouMayReview: Count,
  appealsWithoutReviewer: Count,
  reveals: z.object({ total: Count, items: z.array(z.object({ at: z.iso.datetime(), handle: z.string(), caseId: z.uuid() })).max(OVERVIEW_LIST_MAX) }),
  imagesToday: z.array(HandleCount),
  findingsToday: z.array(HandleCount),
  mailsWaiting: MailCounts,
  mailsFailed: MailCounts,
  releaseOverdue: Count,
  erasureOverdue: ErasureOverdue,
  deferUnproven: z.boolean(),
  protectionLifted: z.object({ total: Count, items: z.array(z.object({ at: z.iso.datetime(), handle: z.string(), caseId: z.uuid(), kind: z.enum(["unsealed", "dismissed"]) })).max(OVERVIEW_LIST_MAX) }),
  sealsDeclined: z.object({ total: Count, items: z.array(z.object({ at: z.iso.datetime(), handle: z.string(), caseId: z.uuid() })).max(OVERVIEW_LIST_MAX) }),
  /** 3d Task 6: a seal a program took while deciding (Task 7's automatic seal) names no staff member: its handle is null. */
  interimSeals: z.object({ total: Count, items: z.array(z.object({ at: z.iso.datetime(), handle: z.string().nullable(), caseId: z.uuid(), posts: Count, images: Count })).max(OVERVIEW_LIST_MAX) }),
  /**
   * 3e (design, sections 7.12 and 8.8): the replies to a suspension or a termination that no decision has answered, with
   * the oldest one's time (null when none waits), and the accounts at the ladder's number of strikes (StandingLists'
   * first list).
   */
  repliesWaiting: z.object({ count: Count, oldestAt: z.iso.datetime().nullable() }),
  strikeAccounts: Count,
  /**
   * 3f (design, section 10.2): the messages at the authorities' contact point without a disposition, stale ones included,
   * with the oldest one's time of receipt and the earliest deadline of a message nobody handled, also once it has passed;
   * and the alert channel's state: `down` while the watcher's beat, or a push still owed, is older than
   * ORDER_RULES.channelDownMinutes, `mailbox` while the watcher beats and cannot read the mailbox, `off` with NOTIFY=off,
   * each with the time since when (null while it is ok or off).
   */
  contact: z.object({ open: Count, oldestAt: z.iso.datetime().nullable(), dueAt: z.iso.datetime().nullable() }),
  alerts: z.object({ channel: z.enum(ALERT_CHANNEL_STATES), since: z.iso.datetime().nullable() }),
  /** 3f Task 3: the orders given effect and not verified, or holding a disabled post added after their check ([home.unverified]). */
  ordersUnverified: OrdersUnverified,
  /** 3f Task 5: the notification records owed, from reports_owed() and nothing more ([home.owed]). */
  reportsOwed: ReportsOwed,
  /**
   * 3f Task 6 (sections 7.16, 8.2 and 10.2): the newest copy mark's time (null before the first) and whether the copy is
   * overdue, by ORDER_RULES.copyOverdueHours ([home.copy]); and after a restore the open gaps, those of the classes 1 to 5
   * (measures to take again), and when the newest import ran (null when none ever did), which shows the console's entry
   * "After a restore" ([home.restore]).
   */
  copy: z.object({ newestAt: z.iso.datetime().nullable(), overdue: z.boolean() }),
  restore: z.object({ open: Count, measures: Count, importedAt: z.iso.datetime().nullable() }),
  /** 3d Task 1 (sections 7.1, 8.2 and 10.3): the quarantine's counts, from quarantine_counts() alone ([home.quarantine]). */
  quarantine: QuarantineCounts,
  /**
   * 3d Task 2 (sections 7.2, 8.2 and 10.3): the acts of the last DESTRUCTIVE_DAYS that cannot be taken back, newest first,
   * at most DESTRUCTIVE_MAX, each with its kind, its time and its case ([home.released]). Task 2 writes `seal_released`
   * alone; a held upload's release and a hold ended without a report, with the refusal's id, are Task 7's.
   */
  destructive: z
    .array(z.object({ kind: z.enum(DESTRUCTIVE_KINDS), at: z.iso.datetime(), caseId: z.uuid().nullable(), refusalId: z.uuid().nullable() }))
    .max(DESTRUCTIVE_MAX),
  /**
   * 3d Task 6 (design, sections 8.1, 8.2 and 10.3): the measures of programs in force, waiting for a person, with the
   * oldest one's time and at most AUTOMATED_CASES_MAX of their cases ([home.automated]); and the cases whose author asked
   * for a person about such a measure, with the oldest request's time and at most AUTOMATED_CASES_MAX of them
   * ([home.objected]). Task 7 adds the open cases with a match that only flags.
   */
  automated: z.object({
    waiting: Count,
    oldestAt: z.iso.datetime().nullable(),
    objected: Count,
    oldestObjectionAt: z.iso.datetime().nullable(),
    /** 3d Task 7: the open cases that hold an unanswered match that only flags ([home.flags]). */
    flags: Count,
    cases: z.array(z.uuid()).max(AUTOMATED_CASES_MAX),
    objectedCases: z.array(z.uuid()).max(AUTOMATED_CASES_MAX),
  }),
  /**
   * 3d Task 7 (design, sections 7.12, 8.2 and 10.3): the held uploads no admin has ended, with the oldest refusal's time;
   * the objections nobody answered, of a hold that is open or ended as report and not released; and the uploads that wait
   * under the limit on refusals an hour, neither refused nor accepted ([home.uploads]).
   */
  heldUploads: z.object({ open: Count, oldest: z.iso.datetime().nullable(), objected: Count, capped: Count }),
});
export type StaffOverview = z.infer<typeof StaffOverview>;

/**
 * 3d Task 7 (design, sections 8.6 and 10.3): the release block of a held upload ended as report, as on a seal without its
 * posts: the record upload-report opened (sent, its reference, the authority's assessment shown as what it is, when the
 * files were handed over), whether both of the image's files are in the quarantine by record, the leave that stands, and
 * whether the uploader's notice of a release taken now would be held; silence_days; and, once released, the release's
 * time, ground, the day after which no backup that is deleted on time holds the file, and whether its notice is held.
 * 3d review M1: as on a seal, the authority's reference, its assessment and the leave are absent for a session that is not
 * an admin's.
 */
export const UploadRelease = z.object({
  reported: z.boolean(),
  theirReference: z.string().max(400).nullable().optional(),
  answer: z.enum(["not_illegal", "illegal", "no_assessment", "other"]).nullable().optional(),
  answeredAt: z.iso.datetime().nullable().optional(),
  handedOverAt: z.iso.datetime().nullable(),
  quarantined: z.boolean(),
  leave: ReleaseLeave.nullable().optional(),
  tellHeld: z.boolean(),
  silenceDays: z.number().int().positive().nullable(),
  releasedAt: z.iso.datetime().nullable(),
  basis: z.enum(RELEASE_BASES).nullable(),
  backupsClearAt: z.iso.datetime().nullable(),
  noticeHeld: z.boolean().nullable(),
});
export type UploadRelease = z.infer<typeof UploadRelease>;

/** How many held uploads one page of GET /api/staff/uploads lists. */
export const UPLOADS_PAGE_SIZE = 50;

/**
 * 3d Task 7 (design, sections 7.12 step 3, 8.6 and 10.3): one refusal on Held uploads, never an image, a hash, a file's
 * name or a handle: when it was refused; its match's record; `otherRefusals`, the one thing an admin is given about the
 * uploader, the count of the same uploader's other refusals whose hold has not ended or ended as report, never one ended
 * as no_report; whether the uploader's account still exists; the objection; its end, with `deletesAt` for an end as
 * no_report (the image row's hold_until, after which the sweeper deletes it); whether the record of a report is set; and
 * for an end as report the release block. 3d review M1: `otherRefusals` is the admin's and absent for any other session.
 */
export const HeldUpload = z.object({
  id: z.uuid(),
  refusedAt: z.iso.datetime(),
  match: MatchRecord,
  otherRefusals: Count.optional(),
  uploaderGone: z.boolean(),
  objection: z.string().nullable(),
  objectedAt: z.iso.datetime().nullable(),
  endedAt: z.iso.datetime().nullable(),
  endAs: z.enum(UPLOAD_ENDS).nullable(),
  endReason: z.enum(UPLOAD_END_REASONS).nullable(),
  deletesAt: z.iso.datetime().nullable(),
  reported: z.boolean(),
  quarantined: z.boolean(),
  release: UploadRelease.nullable(),
});
export type HeldUpload = z.infer<typeof HeldUpload>;

/**
 * GET /api/staff/uploads: the refusals whose hold has not ended, oldest first; then those ended as report and not
 * released; then those released or ended as no_report in the last DESTRUCTIVE_DAYS days, UPLOADS_PAGE_SIZE a page.
 */
export const UploadsPage = z.object({ uploads: z.array(HeldUpload).max(UPLOADS_PAGE_SIZE), nextCursor: z.string().nullable() });
export type UploadsPage = z.infer<typeof UploadsPage>;
export const UploadsQuery = z.object({ cursor: z.string().regex(/^[A-Za-z0-9_-]{1,400}$/).optional() });
export type UploadsQuery = z.infer<typeof UploadsQuery>;

/**
 * 3f Task 6 (sections 7.17, 8.8 and 10.2): GET /api/staff/restore, what an import after a restore found lost, in the order
 * in which it is taken again. `importedAt` is the newest import's time, null when none ever ran (the console then hides
 * the screen's entry). `mayOpen` is true when no gap of the classes 1 to 3 is open, and `retentionMay` when none of the
 * classes 1 to 5 is. A gap: its class, when the lost row was written and its action, the case or the order (and the item)
 * it names when the restored database holds them, the lost decision's action kinds, and its closing. `holds` are the
 * orders whose notice the restored database holds back, with each one's end as imported, for [restore.holds]. No
 * metadata beyond these.
 */
export const RestoreGap = z.object({
  id: z.uuid(),
  class: z.enum(GAP_CLASSES),
  actedAt: z.iso.datetime(),
  action: z.string().min(1),
  caseId: z.uuid().nullable(),
  orderId: z.uuid().nullable(),
  itemId: z.uuid().nullable(),
  kinds: z.array(z.enum(ACTION_KINDS)),
  closedAt: z.iso.datetime().nullable(),
  disposition: z.enum(GAP_DISPOSITIONS).nullable(),
  closedByDecisionId: z.uuid().nullable(),
  /** 3d Task 2 ([restore.sealAgain], 8.7): the gap's case is about a post that is released, so a seal taken again freezes nothing. */
  released: z.boolean().optional(),
  /**
   * 3d Task 7 ([restore.holdEnd], 8.7): a lost end of a held upload's hold, with the way it ended and whether the restored
   * database holds the refusal (an admin ends it again the same way) or not (only release-replay closes the gap).
   */
  hold: z.object({ endAs: z.enum(UPLOAD_ENDS), present: z.boolean() }).optional(),
});
export type RestoreGap = z.infer<typeof RestoreGap>;
/** How many gaps one read of After a restore lists at most: every open gap, then the newest import's closed ones. */
export const RESTORE_GAPS_MAX = 1000;
export const RestoreView = z.object({
  importedAt: z.iso.datetime().nullable(),
  mayOpen: z.boolean(),
  retentionMay: z.boolean(),
  gaps: z.array(RestoreGap).max(RESTORE_GAPS_MAX),
  holds: z.array(z.object({ orderId: z.uuid(), holdUntil: z.iso.datetime().nullable() })).max(OVERVIEW_LIST_MAX),
});
export type RestoreView = z.infer<typeof RestoreView>;

/** One of the Standing screen's lists: how many rows there are, and at most OVERVIEW_LIST_MAX of them. */
const StandingList = <T extends z.ZodType>(row: T) => z.object({ total: Count, items: z.array(row).max(OVERVIEW_LIST_MAX) });

/**
 * GET /api/staff/standing (3e design, sections 7.5, 7.12, 8.6 and 10.3): four lists, each newest first, read from the
 * ledger's views; people are handles, and no row names a reporter. None is a queue key and none is weighted.
 *   - `atThreeStrikes`: the accounts with the ladder's number of active strikes, one of them newer than the account's
 *     newest measure of the ladder that stands, and no suspension or termination that stands and has not ended: the
 *     newest strike's rule and day, the most days an announced suspension could take now, and whether a termination
 *     could be announced.
 *   - `reportingRecords`: the accounts whose rule reports hold marks "manifestly unfounded" (the restriction of
 *     reporting's task fills it; until then it is empty).
 *   - `noticesUndelivered`: the announced measures of live accounts whose notice mail was recorded `failed`, with the
 *     start that follows; never a deleted account's `no_address`.
 *   - `terminationsWaiting`: the terminations that stand, with the day each becomes final, or what holds it: a pending
 *     appeal, or an unanswered reply (`replyOnTime` true when the reply came before the start, so it has not started).
 */
export const StandingLists = z.object({
  atThreeStrikes: StandingList(
    z.object({ handle: z.string(), caseId: z.uuid().nullable(), activeStrikes: Count, ruleId: z.enum(RULE_IDS), newestOn: UtcDay, maxDays: z.number().int().min(STANDING_DAYS.min).max(STANDING_DAYS.max).nullable(), mayTerminate: z.boolean() }),
  ),
  reportingRecords: StandingList(z.object({ handle: z.string(), caseId: z.uuid().nullable(), reports: Count, unfounded: Count, warnedOn: UtcDay.nullable(), marksSince: Count.nullable() })),
  noticesUndelivered: StandingList(z.object({ handle: z.string(), caseId: z.uuid(), decidedOn: UtcDay, startsAt: z.iso.datetime() })),
  terminationsWaiting: StandingList(
    z.object({ handle: z.string(), caseId: z.uuid(), decidedOn: UtcDay, finalOn: UtcDay.nullable(), heldBy: z.enum(["appeal", "reply"]).nullable(), replyOnTime: z.boolean().nullable() }),
  ),
});
export type StandingLists = z.infer<typeof StandingLists>;
