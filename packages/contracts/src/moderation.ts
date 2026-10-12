import { z } from "zod";
import { Email, OpaqueId, TurnstileToken } from "./auth";
import { hex, sha256, sha256Bytes, sortedJson, utf8 } from "./canonical";
import { MediaId } from "./media";
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
} as const;

// ---------------------------------------------------------------- measures

/** The ledger's kinds, in the order of the database's action_kind: the seven measures, then the five reversals. */
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
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

/** What a measure acts on: a post, one image of it, every image its case reaches, or one of an account's two fields. */
export type MeasureTarget = "post" | "image" | "images" | "display_name" | "bio";

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
} as const satisfies Record<ActionKind, MeasureSpec>;

/** The seven measures and the five reversals, each list in the ledger's order: what a statement's data keeps apart. */
export const MEASURE_KINDS = ["withhold", "remove", "seal_media", "withhold_media", "remove_media", "reset_display_name", "reset_bio"] as const satisfies readonly ActionKind[];
export type MeasureKind = (typeof MEASURE_KINDS)[number];
export const REVERSAL_KINDS = ["restore", "unseal_media", "restore_media", "restore_display_name", "restore_bio"] as const satisfies readonly ActionKind[];
export type ReversalKind = (typeof REVERSAL_KINDS)[number];

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

/** One measure or reversal as a decision's confirmed params name it: its kind, and for an image measure the image. */
export interface DecisionActionParams {
  kind: ActionKind;
  mediaId: string | null;
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
  scope: "account" | "quote" | "account_suspect" | null;
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
 *   - The scope's sentence, after every outcome but `not_available`.
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
  }
  return parts.join(" ");
}

/**
 * One item of a notice as its sender reads it. `link` is the item's korbat address, an account's built from the handle
 * as the notice named it and never from the handle the profile holds now. `scope` says what the answer concerns
 * (`account`, `quote`, `account_suspect`, or null). An item about an account carries its scope from the first moment,
 * whatever the handle named: `account_suspect` when the item is suspect or, once released, when its answering decision
 * sealed images, and `account` otherwise. `quote`, for a post that quotes another, comes only with the released outcome,
 * so that before the release nothing tells a live target from a link that names nothing. The page and the app add the
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
  scope: z.enum(["account", "quote", "account_suspect"]).nullable(),
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
  postState: "visible" | "withheld" | "removed" | "deleted_by_author" | null;
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
const TargetKind = z.enum(["post", "account"]);
const StoredPostState = z.enum(["visible", "withheld", "removed", "deleted_by_author"]);

/** How many cases one page of the queue holds. */
export const QUEUE_PAGE_SIZE = 50;

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
});
export type QueueRow = z.infer<typeof QueueRow>;

/** GET /api/staff/queue: a page of the queue in its order, and the cursor that asks for the next; null when there is none. */
export const QueuePage = z.object({ cases: z.array(QueueRow).max(QUEUE_PAGE_SIZE), nextCursor: z.string().nullable() });
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
    kind: z.enum(["reporter", "notifier", "anonymous", "staff", "unlinked"]),
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
});
export type CaseDecisionAction = z.infer<typeof CaseDecisionAction>;

/**
 * A decision as the case page shows it: the statement's data, who decided (a staff handle), the stored facts that it
 * was taken on a suspicion and with the images out of sight, and its measures. A text is null when the decision has
 * none of that kind or it was erased.
 */
export const CaseDecision = z.object({
  id: z.uuid(),
  kind: z.enum(["interim", "final", "review", "correction"]),
  outcome: z.enum(["restricted", "no_violation", "not_evident", "kept", "partly_reversed", "reversed"]),
  ground: z.enum(["incompatible", "illegal"]).nullable(),
  ruleId: z.enum(RULE_IDS).nullable(),
  rulesVersion: z.number().int().positive(),
  redressVersion: z.number().int().positive(),
  category: z.enum(TDB_CATEGORIES),
  categoryKeyword: z.string().nullable(),
  source: z.enum(["notice", "report", "own_initiative"]),
  decidedAt: z.iso.datetime(),
  staffHandle: z.string(),
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
});
export type AppealRow = z.infer<typeof AppealRow>;

/** GET /api/staff/appeals: the pending appeals, newest first. */
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
  intakeKind: z.enum(["user", "finding"]).nullable(),
  ruleId: z.enum(RULE_IDS).nullable(),
  allegesIllegal: z.boolean().nullable(),
  csam: z.boolean().nullable(),
  reexamination: z.boolean().nullable(),
  decisionKind: z.enum(["interim", "final", "review", "correction"]).nullable(),
  outcome: z.enum(["restricted", "no_violation", "not_evident", "kept", "partly_reversed", "reversed"]).nullable(),
  staffHandle: z.string().nullable(),
  result: z.enum(["kept", "partly_reversed", "reversed"]).nullable(),
});
export type CaseHistoryEntry = z.infer<typeof CaseHistoryEntry>;

/**
 * What a case is about, as it stands now: a post with its state and its level, or an account with the handle, display
 * name and bio it holds now. `link` is the post's korbat address, as text: the console links nowhere into the app. A
 * member is null when the row is gone.
 */
export const CaseTarget = z.discriminatedUnion("type", [
  z.object({ type: z.literal("post"), id: z.uuid(), link: z.string(), authorHandle: z.string().nullable(), state: StoredPostState.nullable(), level: z.enum(["visible", "withheld", "removed"]).nullable() }),
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
});
export type CaseView = z.infer<typeof CaseView>;

// ---------------------------------------------------------------- the statement of reasons

/** A measure as a statement tells of it: what it was, the image of an image measure, whether it changed anything, and what a seal covers. */
export const StatementMeasure = z.object({
  kind: z.enum(MEASURE_KINDS),
  mediaId: z.uuid().nullable(),
  /** Null when the measure changed what someone sees; `already` or `deleted` when it did not. */
  noEffect: z.enum(["already", "deleted"]).nullable(),
  /** For a seal: the posts and images its list held when it was recorded, and how many of those images were on posts their author had deleted by then. */
  sealed: z.object({ posts: Count, images: Count, deletedImages: Count }).nullable(),
});
export type StatementMeasure = z.infer<typeof StatementMeasure>;

/**
 * What a statement says of a field reset that ended or was lifted: the decision that holds the reset (whose screen shows
 * the old value), whether korbat still kept that value when this decision was made, and the rule that decision cites,
 * since a value reset under R4 may have been erased by then.
 */
const ResetFacts = { resetDecisionId: z.uuid().nullable(), oldValueKept: z.boolean(), resetRuleId: z.enum(RULE_IDS).nullable() };

/** A reversal as a statement tells of it. The reset's facts are set only on the lifting of a field reset. */
export const StatementReversal = z.object({ kind: z.enum(REVERSAL_KINDS), mediaId: z.uuid().nullable(), ...ResetFacts });
export type StatementReversal = z.infer<typeof StatementReversal>;

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
export const DecisionStatement = z.object({
  kind: z.enum(["interim", "final", "review", "correction"]),
  outcome: z.enum(["restricted", "no_violation", "not_evident", "kept", "partly_reversed", "reversed"]),
  ground: z.enum(["incompatible", "illegal"]).nullable(),
  ruleId: z.enum(RULE_IDS).nullable(),
  rulesVersion: z.number().int().positive(),
  redressVersion: z.number().int().positive(),
  legalReference: z.string().nullable(),
  facts: z.string().nullable(),
  reason: z.string().nullable(),
  source: z.enum(["notice", "report", "own_initiative"]),
  decidedAt: z.iso.datetime(),
  post: z.object({ id: z.uuid(), createdAt: z.iso.datetime() }).nullable(),
  measures: z.array(StatementMeasure),
  reversals: z.array(StatementReversal),
  endedMeasures: z.array(StatementEndedMeasure),
  reviewed: z
    .object({
      kind: z.enum(["interim", "final"]),
      ground: z.enum(["incompatible", "illegal"]).nullable(),
      ruleId: z.enum(RULE_IDS).nullable(),
      rulesVersion: z.number().int().positive(),
      legalReference: z.string().nullable(),
      decidedAt: z.iso.datetime(),
    })
    .nullable(),
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
  kind: z.enum(["interim", "final", "review", "correction"]),
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
});
export type AuthorCaseRow = z.infer<typeof AuthorCaseRow>;

/** GET /api/moderation/cases: the decisions about the viewer's account, newest first. */
export const AuthorCasesPage = z.object({ decisions: z.array(AuthorCaseRow).max(AUTHOR_CASES_PAGE_SIZE), nextCursor: z.string().nullable() });
export type AuthorCasesPage = z.infer<typeof AuthorCasesPage>;

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
export const DecisionView = DecisionStatement.extend({
  id: z.uuid(),
  appealUntil: z.iso.datetime().nullable(),
  reversedOn: UtcDay.nullable(),
  content: DecisionContent,
  appeal: DecisionAppeal.nullable(),
});
export type DecisionView = z.infer<typeof DecisionView>;

/** How many reports one page of the reporter's list holds. */
export const REPORTS_PAGE_SIZE = 20;

/**
 * One item of a report in its sender's own list: the item as the status page gives it, and its id, by which the signed-in
 * sender asks for its re-examination. The status page, which anyone holding a link may open, names an item by its
 * position and never carries an id.
 */
export const ReportItem = NoticeItemStatus.extend({ id: z.uuid() });
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
const HandleCount = z.object({ handle: z.string(), count: Count });

/**
 * GET /api/staff/overview: what the home screen shows every staff member. Per lane the open cases and since when the
 * oldest unanswered item waits; the appeals waiting, how many of them the reading person may review
 * (`appealsYouMayReview`, by CaseAppeal's rule) and how many no staff account may review now
 * (`appealsWithoutReviewer`: the database's appeal_reviewer_state is not `available`); every reveal of a source in the last 30 days, newest first, with
 * its staff handle and its case; per staff handle the images viewed and the findings opened today (UTC); the mails
 * waiting for more than an hour and those given up in the last 30 days; the decided items the daily release has not
 * released after 26 hours; and whether the emergency switch is on. And, of the path for child sexual abuse material,
 * three lists every staff member sees: the decisions of the last 30 days that lifted the protection of reported images
 * (a lifted seal, `unsealed`, or an admin's final answer to such a report without a seal, `dismissed`), the recorded
 * choices not to seal of the last 30 days, and the seals taken while deciding that are in force, each with what it
 * covers. Counts, times, handles and cases only.
 */
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
  deferUnproven: z.boolean(),
  protectionLifted: z.object({ total: Count, items: z.array(z.object({ at: z.iso.datetime(), handle: z.string(), caseId: z.uuid(), kind: z.enum(["unsealed", "dismissed"]) })).max(OVERVIEW_LIST_MAX) }),
  sealsDeclined: z.object({ total: Count, items: z.array(z.object({ at: z.iso.datetime(), handle: z.string(), caseId: z.uuid() })).max(OVERVIEW_LIST_MAX) }),
  interimSeals: z.object({ total: Count, items: z.array(z.object({ at: z.iso.datetime(), handle: z.string(), caseId: z.uuid(), posts: Count, images: Count })).max(OVERVIEW_LIST_MAX) }),
});
export type StaffOverview = z.infer<typeof StaffOverview>;
