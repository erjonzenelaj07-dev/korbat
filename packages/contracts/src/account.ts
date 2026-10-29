import { z } from "zod";
import { ACTIVITY_KINDS, ActivitySettings } from "./activity";
import { Platform, Role } from "./auth";
import { ImportChoice, ImportSource, ImportStatus } from "./imports";
import { AUTOMATED_DECISIONS, ITEM_OUTCOMES, MEASURE_KINDS, NoticeRef, REPLY_TEXT_MAX, REVERSAL_KINDS, RULE_IDS, STANDING_BASES, STANDING_DAYS, StatementSignal, TDB_CATEGORIES, UploadRefusalView } from "./moderation";
import { OrderNoticeFacts, OrderTexts } from "./orders";

const at = z.iso.datetime();
/** A UTC day, as the list of decisions shows one. */
const day = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, "must be a UTC day");

/** Something the account did to a post (a like, a repost, a bookmark), and when. */
const PostRef = z.object({ postId: z.uuid(), at });

/** The other side of a graph relation by the handle it had at export time (nothing else about them), and since when. */
const HandleRef = z.object({ handle: z.string(), since: at });

/** An image attached to one of the account's posts; `file` names its entry in the archive. */
const ExportedMedia = z.object({ id: z.uuid(), file: z.string(), altText: z.string(), width: z.number().int().positive(), height: z.number().int().positive() });

/** A post as its author wrote it; a deleted one keeps its place with an empty body and its deletion time. */
const ExportedPost = z.object({
  id: z.uuid(),
  body: z.string(),
  createdAt: at,
  replyToId: z.uuid().nullable(),
  quoteOfId: z.uuid().nullable(),
  state: z.enum(["visible", "withheld", "removed", "deleted_by_author"]),
  deletedAt: at.nullable(),
  media: z.array(ExportedMedia),
  /**
   * 3b (design, section 11.2): an imported post's source, the date its archive gave it and whether it was shortened on
   * import, last; null on a native post and on a deleted one, whose import columns are cleared. Added to korbat-export-1
   * without a new format name.
   */
  imported: z.object({ source: ImportSource, originalCreatedAt: at, shortened: z.boolean() }).nullable(),
  /**
   * 2d (design, section 11.2): the handles the post's stored mentions name, as written (lowercased), in text order, whether
   * or not they still link; and whether its author hid its like and repost counts. Last, after the import.
   */
  mentions: z.array(z.string()),
  countsHidden: z.boolean(),
});

/**
 * 2d (design, section 11.2; decision 28): why the Activity list does not show an entry the account received and korbat
 * still holds. `muted`: the account mutes the actor; `post_not_visible`: the entry's post is withheld, removed, disabled
 * or erased, or a block stands between the two accounts; `unfollowed`: the follow is gone; `actor_deleted`: the actor's
 * account is deleted.
 */
export const ACTIVITY_NOT_SHOWN = ["muted", "post_not_visible", "unfollowed", "actor_deleted"] as const;
export type ActivityNotShown = (typeof ACTIVITY_NOT_SHOWN)[number];

/**
 * One Activity entry the account received, as the export lists it, ungrouped: its kind, when it was written (to the
 * microsecond), the post's id (null for a follow, and for a post the account may not see, so the export never discloses
 * another person's moderation), the actor's handle at the time of export, and `shown`: true, or why the list hides it.
 */
const ExportedActivityEntry = z
  .object({
    kind: z.enum(ACTIVITY_KINDS),
    at,
    postId: z.uuid().nullable(),
    actorHandle: z.string(),
    shown: z.union([z.literal(true), z.enum(ACTIVITY_NOT_SHOWN)]),
  })
  .refine((entry) => entry.kind !== "follow" || entry.postId === null, { message: "a follow names no post", path: ["postId"] })
  .refine((entry) => entry.shown !== "post_not_visible" || entry.postId === null, { message: "a post the account may not see is named by no id", path: ["postId"] });

/**
 * 3b (design, section 11.2): one of the account's imports, newest first: its source, state and times, when the person made
 * the statement, the choice confirmed (null before a confirmation) and its counts. Never a file name, a handle or a text:
 * the archive and the work folder are not exported.
 */
const ExportedImport = z.object({
  id: z.uuid(),
  source: ImportSource,
  status: ImportStatus,
  createdAt: at,
  endedAt: at.nullable(),
  statedAt: at.nullable(),
  choice: ImportChoice.nullable(),
  counts: z.object({ postsPublished: z.int().min(0), postsRemoved: z.int().min(0), imagesKept: z.int().min(0), imagesLeftOut: z.int().min(0) }),
});

/** A passkey of the account as the export lists it (1c design, section 7.7): what the Security screen shows, and nothing that identifies the key, its id or its authenticator. */
const ExportedPasskey = z.object({
  name: z.string(),
  createdAt: at,
  lastUsedAt: at.nullable(),
  /** Backed up, so the password manager syncs it to the owner's other devices. */
  synced: z.boolean(),
  /** The label of the device that added it; null once that device is gone. */
  createdOn: z.string().nullable(),
});

/**
 * A decision about the account or one of its posts, as the export lists it (3c design, section 7.11): one of the decisions
 * the Cases screen lists, which are those its author was told of, with what its statement of reasons tells.
 *   - `decidedOn` is the decision's UTC day, as the list shows it; `postId` the entry of `posts` a decision about a post
 *     concerns, null for a decision about the account's display name or bio.
 *   - `ground` and `ruleId` name the law or the rule it rests on, and `rulesVersion` the version of the rulebook it was
 *     made under.
 *   - `measures` are what it imposed, each with `noEffect` set when it changed nothing anyone saw (the content was already
 *     not shown, or already deleted); `reversals` what it lifted. An image measure names the account's own image.
 *   - `facts`, `reason` and `legalReference` are the statement's texts while korbat holds them; null for a text the
 *     decision never had, one that was erased, and the facts and the reason of a decision that restricted nothing.
 *   - `appeal` is where the account's appeal of the decision stands; null when it filed none.
 * It names its source nowhere: no report, no reporter, no notifier and no staff member is part of it.
 */
const ExportedDecision = z.object({
  id: z.uuid(),
  decidedOn: day,
  postId: z.uuid().nullable(),
  kind: z.enum(["interim", "final", "order", "review", "correction"]),
  outcome: z.enum(["restricted", "no_violation", "not_evident", "kept", "partly_reversed", "reversed"]),
  ground: z.enum(["incompatible", "illegal"]).nullable(),
  ruleId: z.enum(RULE_IDS).nullable(),
  rulesVersion: z.number().int().positive(),
  measures: z.array(z.object({ kind: z.enum(MEASURE_KINDS), mediaId: z.uuid().nullable(), noEffect: z.enum(["already", "deleted"]).nullable() })),
  reversals: z.array(z.object({ kind: z.enum(REVERSAL_KINDS), mediaId: z.uuid().nullable() })),
  facts: z.string().nullable(),
  reason: z.string().nullable(),
  legalReference: z.string().nullable(),
  appeal: z
    .discriminatedUnion("state", [
      z.object({ state: z.literal("pending"), result: z.null() }),
      z.object({ state: z.literal("answered"), result: z.enum(["kept", "partly_reversed", "reversed"]) }),
    ])
    .nullable(),
  /**
   * 3f (design, W.7): an order's decision once its author was told, never before: its notice's facts (the order's kind,
   * state, authority, reference and day, whether korbat confirmed it, whether and until when the notice was held, the
   * preservation's end) and, read at the export's time, the authority's words and the day of an erasure; a reinstatement's
   * entry with its ground. Absent on every other decision.
   */
  order: OrderNoticeFacts.optional(),
  orderTexts: OrderTexts.optional(),
  erasedOn: day.nullable().optional(),
  /**
   * 3d (design, W.10): what the statement says of automated means, as its own columns and its signal give it
   * (DecisionStatement's three members: false, not_automated and null for a decision made before 3d), and the text the
   * account sent with "Ask for a person" about a program's measure, with its time, while korbat keeps it; null otherwise.
   * Never a score, a hash, a list version or a classification.
   */
  automatedDetection: z.boolean(),
  automatedDecision: z.enum(AUTOMATED_DECISIONS),
  signal: StatementSignal.nullable(),
  objection: z.object({ text: z.string(), createdAt: at }).nullable(),
});

/**
 * 3d (design, W.6 and W.10): a release that concerned the account's posts or one of its uploads, as its notice reads it:
 * its ground (a leave or instruction, or a period) and its time, and whether it was of an upload. Listed only from the
 * time the account may be told of it: never while its notice is held. Never an authority, a reference or an assessment.
 */
const ExportedRelease = z.object({ id: z.uuid(), basis: z.enum(["leave", "period"]), releasedAt: at, upload: z.boolean() });

/**
 * One item of a report in its sender's export: its place in the report, its korbat address (an account's under the handle
 * the report named, never a later one) and whether it is the re-examination of the item before it. `outcome`, its words
 * as the list of reports reads them (`outcomeText`) and whether a re-examination can still be asked for
 * (`reexaminationOpen`) are told together, once the daily release has shown the outcome; until then all three are null,
 * whether or not a moderator has decided, as on the list and on the report's page.
 */
const ExportedReportItem = z
  .object({
    position: z.number().int().min(1).max(20),
    link: z.string(),
    reexamines: z.boolean(),
    outcome: z.enum(ITEM_OUTCOMES).nullable(),
    outcomeText: z.string().nullable(),
    reexaminationOpen: z.boolean().nullable(),
  })
  .refine((item) => (item.outcome === null) === (item.outcomeText === null) && (item.outcome === null) === (item.reexaminationOpen === null), {
    message: "an outcome, its words and whether a re-examination is open are told together or not at all",
  });

/**
 * A report or a notice the account sent, while korbat keeps its record (3c design, sections 6.6 and 7.11): its reference,
 * when korbat received it, whether it said that something breaks a rule or is illegal, the rule it cited (always for a
 * report on a rule, optionally for a notice of illegality), its Transparency Database category, and the sender's own
 * explanation. A report on the path for child sexual abuse material records no sender, the account included, so it is in
 * nobody's export.
 */
const ExportedReport = z.object({
  ref: NoticeRef,
  receivedAt: at,
  ground: z.enum(["rule", "illegal"]),
  ruleId: z.enum(RULE_IDS).nullable(),
  category: z.enum(TDB_CATEGORIES),
  explanation: z.string().nullable(),
  items: z.array(ExportedReportItem),
});

/**
 * A strike the account was given (3e design, section 18, W.8): the decision that gave it, the post it was given for, the
 * rule, when it was given, until when it counts, and when it was overruled (null while it stands). Strikes from posts are
 * the account's own data; nothing here names another person.
 */
const ExportedStrike = z.object({ decisionId: z.uuid(), postId: z.uuid(), ruleId: z.enum(RULE_IDS), givenAt: at, countsUntil: at, overruledAt: at.nullable() });

/**
 * A suspension, a termination, a warning about reporting or a restriction of reporting of the account (3e design, W.8):
 *   - `decisionId` is the decision that took it, `kind` the measure, `basis` what the database found it rests on, `days`
 *     the days the decision gave (null for a termination and a warning), `announced` whether it was announced (null for
 *     a warning), and `decidedAt` the decision's time.
 *   - `earliestStart` is the earliest start a suspension or a termination was announced with (null for the two reporting
 *     measures). `startsAt` and `endsAt` are its period as the ledger gives it now: null for a suspension that has no
 *     start (an announcement still waiting, or one lifted before its start); `endsAt` null for a termination; a
 *     warning runs from its decision to the end of its counting, a restriction from its decision for its days; each end
 *     is cut to a lift or to a broken basis.
 *   - `liftedAt` and `liftedBy` are the reversal that lifted it and its decision, `replaced` whether that was a withdrawal
 *     for another measure; `basisEndedAt` and `basisEndedBy` the reversal that broke what it rested on and its decision.
 * It names no staff member and no reporter.
 */
const ExportedStanding = z.object({
  decisionId: z.uuid(),
  kind: z.enum(["suspend", "terminate", "warn_reporting", "restrict_reporting"]),
  basis: z.enum(STANDING_BASES),
  days: z.number().int().min(STANDING_DAYS.min).max(STANDING_DAYS.max).nullable(),
  announced: z.boolean().nullable(),
  decidedAt: at,
  earliestStart: at.nullable(),
  startsAt: at.nullable(),
  endsAt: at.nullable(),
  liftedAt: at.nullable(),
  liftedBy: z.uuid().nullable(),
  replaced: z.boolean(),
  basisEndedAt: at.nullable(),
  basisEndedBy: z.uuid().nullable(),
});

/**
 * A reply the account sent to a suspension or a termination (3e design, W.8): the decision it answered, when it was filed
 * and whether before the start, its text while korbat holds it (null when none was written, or once erased, with
 * `erasedAt`), and the decision that answered it. A reply is never erased before it is answered.
 */
const ExportedReply = z.object({
  decisionId: z.uuid(),
  filedAt: at,
  onTime: z.boolean(),
  text: z.string().max(REPLY_TEXT_MAX).nullable(),
  erasedAt: at.nullable(),
  answeredAt: at.nullable(),
  answeredBy: z.uuid().nullable(),
});

/**
 * The account's own reporting counts (3e design, W.8 and section 6.3): the frame they are counted in, the rule reports it
 * sent on each UTC day korbat still counts, every mark "manifestly unfounded" on its own reports by the report's
 * reference and the item's position (when its report was sent, when it was marked, when a correction withdrew it, and
 * whether it counts now), and the marked reports in the frame, which is what a warning's and a restriction's threshold
 * reads. Nothing in it names another person: never the item reported, its author, or the decision's staff member.
 */
const ExportedReporting = z.object({
  frameDays: z.number().int().positive(),
  days: z.array(z.object({ day, reports: z.number().int().positive() })),
  marks: z.array(z.object({ ref: NoticeRef, position: z.number().int().min(1).max(20), sentOn: day, markedAt: at, withdrawnAt: at.nullable(), counts: z.boolean() })),
  markedReports: z.number().int().nonnegative(),
});

/**
 * export.json inside the data export archive (1b design, section 7.5): everything the account owns, and
 * nothing about other people beyond the handle they had at export time.
 */
/**
 * What deleting an account removes, and what korbat keeps of it (3c design, section 2, row Deletion and cases): the one
 * sentence the deletion screen and both deletion mails say. Since moderation cases, korbat keeps a case's copy of a
 * reported or restricted post or profile for the periods its terms give, and sealed images for the authorities, also
 * after the account is gone, so no sentence about a deletion says that everything is gone for good. 3f (design, W.5):
 * a post preserved under an authority's order and an address held for a report to the authorities outlive the account
 * too, so the sentence names what the law obliges korbat to keep, for every account alike: a sentence for one account
 * alone would tell what a non-disclosure decision forbids.
 */
export const ACCOUNT_DELETION_WORDS =
  "Your posts, images and profile are removed from korbat for everyone, except what korbat keeps for a time: where a post or your profile was reported or restricted, its copy for that case, and what the law obliges korbat to keep, each for the periods in its terms (Terms, Your data).";

export const ExportFormat = z.object({
  format: z.literal("korbat-export-1"),
  exportedAt: at,
  account: z.object({
    id: z.uuid(),
    email: z.email(),
    createdAt: at,
    role: Role,
    mfaEnabled: z.boolean(),
    hasPassword: z.boolean(),
    verified: z.boolean(),
    termsVersion: z.string().nullable(),
    termsAcceptedAt: at.nullable(),
    /** The account's passkeys, newest first. Added to korbat-export-1 without a new format name: a reader that does not know the member loses nothing by skipping it. */
    passkeys: z.array(ExportedPasskey),
  }),
  profile: z.object({
    handle: z.string(),
    displayName: z.string(),
    bio: z.string(),
    createdAt: at,
    /** Every handle the account ever had, the current one included. */
    handleHistory: z.array(z.string()),
    /**
     * "Show my posts in Explore" as it stands (2c design, section 8). Added to korbat-export-1 without a new format name: a
     * reader that does not know the member loses nothing by skipping it.
     */
    showInExplore: z.boolean(),
    /**
     * The account's own handles that korbat retired and that are still retired, each with when (3e design, W.8): such a
     * handle stays in `handleHistory`, which lists plain strings, so its time is told here. Added to korbat-export-1
     * without a new format name, last in the profile; empty when none is retired.
     */
    retiredHandles: z.array(z.object({ handle: z.string(), retiredAt: at })),
    /**
     * 2d Task 3 (design, sections 7.8 and 11.2): the account's picture while one is set and the account is shown it, with its
     * file in the archive (the 400 px square, `media/<id>.webp`, listed in missingMedia when it could not be read) and its
     * size; null otherwise. Added to korbat-export-1 without a new format name, before sharePreviews.
     */
    avatar: z.object({ id: z.string(), file: z.string(), width: z.number().int().positive(), height: z.number().int().positive() }).nullable(),
    /**
     * 2d (design, section 11.2; decision 21): the link-preview switch as it stands. Added to korbat-export-1 without a new
     * format name, last in the profile.
     */
    sharePreviews: z.boolean(),
  }),
  posts: z.array(ExportedPost),
  likes: z.array(PostRef),
  reposts: z.array(PostRef),
  bookmarks: z.array(PostRef),
  following: z.array(HandleRef),
  blocks: z.array(HandleRef),
  mutes: z.array(HandleRef),
  /** The live sessions. `id` is the session's handle, as the session list names it; the hash of its token never leaves the server. */
  sessions: z.array(z.object({ id: z.string(), createdAt: at, lastUsedAt: at, current: z.boolean() })),
  devices: z.array(z.object({ label: z.string().nullable(), platform: Platform, firstSeenAt: at, lastSeenAt: at })),
  /** The account's own security events: their kind and time, without the metadata. */
  events: z.array(z.object({ type: z.string(), at })),
  /** Ids of ready images whose file was not on disk when the archive was written. */
  missingMedia: z.array(z.string()),
  /**
   * What korbat's moderation holds for the account (3c design, section 7.11): the decisions about it that its Cases screen
   * lists, newest first, and its own reports and notices, newest first. Never another person's report, a reporter, a
   * notifier or a staff member. Added to korbat-export-1 without a new format name, last in the document: a reader that
   * does not know the member loses nothing by skipping it. `strikes` (3e) lists the account's strikes, newest first;
   * then `standing` its suspensions, terminations and reporting measures, newest first, `replies` its replies to them,
   * newest first, and `reporting` its own reporting counts (3e design, W.8).
   */
  moderation: z.object({
    decisions: z.array(ExportedDecision),
    reports: z.array(ExportedReport),
    strikes: z.array(ExportedStrike),
    standing: z.array(ExportedStanding),
    replies: z.array(ExportedReply),
    reporting: ExportedReporting,
    /**
     * 3d (design, W.10): the account's refused uploads, newest first, each as its notice reads it (UploadRefusalView: the
     * day, the source, the kind of match, the objection, the end and the release as far as the account may be told of
     * them), with no file and no hash; and the releases about its posts or uploads that it may be told of, newest first.
     */
    uploads: z.array(UploadRefusalView),
    releases: z.array(ExportedRelease),
  }),
  /**
   * 3b (design, section 11.2): the account's imports, newest first, each as ExportedImport. Added to korbat-export-1
   * without a new format name, last in the document: a reader that does not know the member loses nothing by skipping it.
   */
  imports: z.array(ExportedImport),
  /**
   * 2d (design, section 11.2; decision 28): the account's Activity as korbat holds it: the seen marker (null before the
   * first visit), the settings (the defaults for an account that never changed them), and every entry it received that
   * korbat still holds, newest first and ungrouped, shown or not. Moderation entries are not repeated here: the
   * `moderation` member holds them. Added to korbat-export-1 without a new format name, last in the document.
   */
  activity: z.object({ seenAt: at.nullable(), settings: ActivitySettings, received: z.array(ExportedActivityEntry) }),
});
export type ExportFormat = z.infer<typeof ExportFormat>;
