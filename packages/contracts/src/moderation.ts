import { hex, sha256, sha256Bytes, sortedJson, utf8 } from "./canonical";

// Moderation cases (3c design, section 10): the constants and digests that the database, the API, the console, the app,
// the mails and the terms share. Each is the one source its words and numbers are taken from. This module imports
// nothing from staff.ts, and the index evaluates it first, so staff.ts can read these constants while it loads; an import
// the other way round would be a cycle that fails at load.

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
