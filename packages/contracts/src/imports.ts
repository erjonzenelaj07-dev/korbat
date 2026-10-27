import { z } from "zod";
import { AltText, MEDIA_MAX_PER_POST } from "./media";
import { FORBIDDEN_CONTROL, FORBIDDEN_FORMAT, normalizePostBody, postLength, visibleLength } from "./text";

/**
 * Import from other platforms (3b design, docs/superpowers/specs/2026-10-22-import-3b-design.md, sections 5.1 and 9.3;
 * Task 1): the line the importer writes and the API reads back as hostile input, the importer's summary, the intake's
 * numbers, the person's choice, the views, the closed lists and every number of the design. It imports only zod,
 * ./media and ./text, so social.ts, moderation.ts, staff.ts and account.ts can read ImportSource while they load.
 */

const rules = {
  /** 7.3: a chunk is exactly this long but the last; under Cloudflare's 100 MB and inside its 125-second read timeout. */
  chunkBytes: 8_388_608,
  /** 7.3: the largest archive, 256 chunks; the CHECK of import_jobs.declared_bytes (6.1). */
  maxBytes: 2_147_483_648,
  /** 7.3: Caddy's body limit for a chunk, its "9MB", which Caddy reads as decimal megabytes. */
  chunkBodyBytes: 9_000_000,
  /** 9.4: the app sends a chunk whose hash differed again at most this often. */
  chunkRetries: 3,
  /** 4.2 step 3, decision 21: an account imports once it is this old (import_too_soon). */
  minAccountAgeDays: 7,
  /** Decision 21: an account younger than this publishes at most newAccountMaxPosts posts per import. */
  newAccountDays: 30,
  newAccountMaxPosts: 1_000,
  /** 7.6: the limits. Published imports per account in seven days, imports created per address in a day, and per hour per account. */
  importsPerWeek: 3,
  importsPerAddressDay: 5,
  chunksPerHour: 600,
  actsPerHour: 20,
  picksPerHour: 3_000,
  /** 7.7: the default of IMPORT_MAX_ACTIVE, imports in uploading or scanning on the site at once. */
  maxActiveDefault: 2,
  /** 7.4, 7.7: IMPORT_IMAGES_PER_HOUR's default, and the most it may be set to (it may only be lowered). */
  imagesPerHourDefault: 600,
  imagesPerHourMax: 600,
  /** 7.7: the default of IMPORT_MIN_FREE_BYTES, kept free on import-archives beyond a new import's size and scanWriteBytes. */
  minFreeBytesDefault: 2_147_483_648,
  /** 4.2 step 3, 7.2: the most a scan may write to import-work. */
  scanWriteBytes: 4_294_967_296,
  /** 7.1: the importer rewrites its heartbeat this often; the API takes no new import once it is older than the second. */
  heartbeatMs: 10_000,
  heartbeatStaleMs: 60_000,
  /** 4.8, decision 4: an archive lives at most this long after its import was created (an upload not complete then expires, a scan not done fails). */
  archiveHours: 24,
  /** 4.8: a scan not done this long after the upload ended fails (scan_timed_out). */
  scanMinutes: 45,
  /** 4.8: a preview not confirmed this long after the scan ended expires. */
  previewHours: 24,
  /** 4.8, decision 19: an imported image whose check is not answered this long after its upload is left out. */
  checkHours: 24,
  /** 4.8: an import not finished this long after its scan ended is stopped; the work folder never outlives it (the terms' three days). */
  workHours: 72,
  /** 4.8, decision 25: a finished import's record stays at least this long after its end. */
  recordDays: 30,
  /** 5.3 step 7, decision 13: a longer text is skipped (too_long_to_read). */
  textMax: 30_000,
  /** Decision 13: a post over this many code points is long; shortened, it is cut to this many with its ellipsis. */
  shortenTo: 1_000,
  /** 5.4: items read, posts kept and images kept by one scan. */
  maxItems: 1_000_000,
  maxPosts: 50_000,
  maxImages: 5_000,
  /** 5.4: a date before the first tweet, or more than futureDays after the import was created, is skipped (date_out_of_range). */
  earliestDate: "2006-03-21",
  futureDays: 1,
  /** 5.5, 5.6: one JSON element of a data file, in bytes and levels (item_too_large). */
  itemMaxBytes: 1_048_576,
  itemMaxDepth: 64,
  /** 5.5: X's data/manifest.js, and the highest N of data/tweets-part<N>.js. */
  manifestMaxBytes: 1_048_576,
  tweetsPartsMax: 99,
  /** 5.7: a CAR's blocks, and its MST's levels and entries a node. */
  carBlockMaxBytes: 1_000_000,
  carMaxBlocks: 2_000_000,
  mstMaxDepth: 48,
  mstMaxEntries: 4_096,
  /** 7.2: the zip reader's limits: entries, central directory, a name, a data file, the ratio, the allowlisted entries' sum. */
  zipMaxEntries: 200_000,
  zipDirectoryMaxBytes: 67_108_864,
  zipNameMaxBytes: 512,
  zipDataMaxBytes: 1_073_741_824,
  zipMaxRatio: 100,
  zipTotalMaxBytes: 4_294_967_296,
  /** 7.1, 7.5: the file protocol's caps: job.json, summary.json, a line of posts.jsonl, and posts.jsonl (whose lines are at most maxPosts). */
  jobFileMaxBytes: 4_096,
  summaryMaxBytes: 65_536,
  lineMaxBytes: 262_144,
  postsFileMaxBytes: 1_073_741_824,
  /** 7.1: the third start of a scan fails it (interrupted); the watchdog ends a scan; the loop sleeps this long when idle. */
  maxAttempts: 3,
  watchdogMs: 1_800_000,
  idleMs: 1_000,
  /** 6.1: the CHECKs of import_jobs (refused_words in code points, scan and choice in bytes), import_picks.alts, import_keys.key and the seed. */
  refusedWordsMax: 80,
  scanMaxBytes: 262_144,
  choiceMaxBytes: 1_024,
  altsMaxBytes: 16_384,
  keyBytes: 32,
  seedBytes: 32,
  /** 7.4: imported images in processing on the site at once. */
  imagesInFlight: 2,
  /** 7.5: import-drive's interval and lock, the intake's batch of keys, a batch of posts, batches a round, the orphan pass. */
  driveIntervalMs: 5_000,
  driveLockMs: 60_000,
  keyBatch: 1_000,
  batchPosts: 200,
  publishBatchesPerRound: 10,
  undoBatchesPerRound: 5,
  orphanEveryRounds: 10,
  orphanAgeMs: 3_600_000,
  /** 9.2: lines a page of the preview, pages kept, samples and a sample's bytes, imports listed. */
  pageLines: 50,
  maxPages: 1_000,
  samples: 3,
  sampleMaxBytes: 262_144,
  listMax: 20,
};

/**
 * Every number of the design (section 9.3), as 3d's AUTOMATION_RULES holds its own: the CHECK constants of Task 2's
 * migrations mirror the ones of 6.1, a database test holds them equal, and the terms print their hours and days from
 * here (11.3). Settings that the owner may change are named for their defaults.
 */
export const IMPORT_RULES: Readonly<typeof rules> = rules;

export const IMPORT_SOURCE_KINDS = ["x", "mastodon", "bluesky"] as const;
export const ImportSource = z.enum(IMPORT_SOURCE_KINDS);
export type ImportSource = z.infer<typeof ImportSource>;

/** The twelve states of section 4.1. */
export const ImportStatus = z.enum(["uploading", "scanning", "ready", "preparing", "publishing", "done", "stopped", "undoing", "undone", "failed", "cancelled", "expired"]);
export type ImportStatus = z.infer<typeof ImportStatus>;

/** The active states: an account has at most one import in them (import_jobs_one_active). undoing is not one. */
export const IMPORT_ACTIVE_STATES = ["uploading", "scanning", "ready", "preparing", "publishing"] as const satisfies readonly ImportStatus[];

/** Why a scan failed: import_jobs.failure's CHECK, and a failed summary's member. */
export const IMPORT_FAILURES = [
  "not_this_source",
  "not_an_archive",
  "tar_gz",
  "partial_archive",
  "encrypted",
  "too_many_entries",
  "too_large_uncompressed",
  "bad_entry_name",
  "unreadable",
  "nothing_to_import",
  "scan_timed_out",
  "interrupted",
] as const;
export const ImportFailure = z.enum(IMPORT_FAILURES);
export type ImportFailure = z.infer<typeof ImportFailure>;

/** Why an import was stopped: import_jobs.stop_reason's CHECK. */
export const IMPORT_STOP_REASONS = ["refused_image", "by_author", "by_staff", "time_ran_out"] as const;
export type ImportStopReason = (typeof IMPORT_STOP_REASONS)[number];

/**
 * Why a post is not published. reply, too_long, warning, protected and left_out are counted by the app from the month
 * table and the picks when the choice leaves them out; already_imported and new_account_cap by the intake; the rest by
 * the importer.
 */
export const IMPORT_SKIP_REASONS = [
  "repost",
  "reply",
  "too_long",
  "warning",
  "protected",
  "left_out",
  "not_public",
  "older_version",
  "poll",
  "adult_label",
  "too_long_to_read",
  "date_out_of_range",
  "item_too_large",
  "unreadable",
  "empty",
  "already_imported",
  "over_post_cap",
  "over_item_cap",
  "new_account_cap",
] as const;
export type ImportSkipReason = (typeof IMPORT_SKIP_REASONS)[number];

/** Why an image is not imported. */
export const IMPORT_IMAGE_SKIPS = ["video", "sensitive", "unsupported", "too_large", "missing_file", "bluesky_no_files", "images_off", "not_chosen", "no_description", "over_image_cap", "failed", "not_checked", "flagged"] as const;
export type ImportImageSkip = (typeof IMPORT_IMAGE_SKIPS)[number];

/**
 * A line's marks, the facts a choice decides on, as bits: IMPORT_MARKS[i] is the bit 1 << i. reply: its kind is reply;
 * long: its text is over shortenTo code points; warning and protected: the line's members of those names.
 */
export const IMPORT_MARKS = ["reply", "long", "warning", "protected"] as const;

const Count = z.int().min(0);
const Ref = z.int().min(0).max(IMPORT_RULES.maxPosts - 1);
/** A byte offset into posts.jsonl. */
const Offset = z.int().min(0).max(IMPORT_RULES.postsFileMaxBytes);
const Marks = z.int().min(0).max(2 ** IMPORT_MARKS.length - 1);
const Month = z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/);
/** The archive's day, never its second, which with the text would fingerprint the original. */
const Day = z.iso.date();
const Kind = z.enum(["post", "thread", "reply"]);

/**
 * PostText's rule with textMax in place of POST_MAX_LENGTH, and its raw cap scaled the same way (four UTF-16 units a code
 * point). This module's refinements carry no message of their own: no person reads them (the API answers invalid_request
 * and the intake counts a line unreadable), and every byte here is in the app's web bundle.
 */
export const ImportedText = z
  .string()
  .max(IMPORT_RULES.textMax * 4)
  .transform(normalizePostBody)
  .refine((text) => !FORBIDDEN_CONTROL.test(text))
  .refine((text) => !FORBIDDEN_FORMAT.test(text))
  .refine((text) => postLength(text) <= IMPORT_RULES.textMax);
export type ImportedText = z.infer<typeof ImportedText>;

/**
 * The only names the work folder's media/ may hold: <ref>-<position>.<jpg|png|webp>, the ref without leading zeros and
 * below maxPosts, the position from 0, as refs count, and below MEDIA_MAX_PER_POST (so 0 to 3).
 */
export const ImportMediaFile = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,4})-[0-3][.](jpg|png|webp)$/)
  .refine((file) => Number.parseInt(file, 10) < IMPORT_RULES.maxPosts);
export type ImportMediaFile = z.infer<typeof ImportMediaFile>;

/** One kept post, one line of posts.jsonl (5.1). The importer writes it; the API parses every line with this schema. */
export const ImportedPost = z
  .strictObject({
    /** Its line in posts.jsonl, from 0; lines are in ascending order of `at`. */
    ref: Ref,
    /** HMAC-SHA256 of the source and the source post's id under the account's import key, as 64 lowercase hex. */
    key: z.string().regex(/^[0-9a-f]{64}$/),
    /** The date the archive gives the post, UTC, whole seconds. */
    at: z.iso.datetime({ offset: false, precision: 0 }),
    /** post: the account's own top-level post; thread: a reply to its own post; reply: a reply to someone else. */
    kind: Kind,
    /** The ref of the post a `thread` item answers, always lower than its own ref; null otherwise. */
    parent: z.int().min(0).nullable(),
    /** korbat's plain text: converted, cleaned and normalised (5.3); up to textMax code points. */
    text: ImportedText,
    /** Images in the work folder, in order; `alt` is the source's description, normalised, or null. */
    media: z.array(z.strictObject({ file: ImportMediaFile, alt: AltText.nullable() })).max(MEDIA_MAX_PER_POST),
    /** X only: dated inside a period protected-history.js marks as protected (5.5); left out unless chosen. */
    protected: z.boolean(),
    /** Mastodon only: the text begins with a content warning's line (decision 12); left out unless chosen. */
    warning: z.boolean(),
  })
  .refine((post) => (post.kind === "thread") === (post.parent !== null) && (post.parent === null || post.parent < post.ref), { path: ["parent"] })
  .refine((post) => visibleLength(post.text) >= 1 || post.media.length >= 1, { path: ["text"] })
  .refine(
    (post) => {
      const names = post.media.map(({ file }) => file.split(/[-.]/));
      return names.every(([ref]) => Number(ref) === post.ref) && new Set(names.map(([, position]) => position)).size === names.length;
    },
    { path: ["media"] },
  );
export type ImportedPost = z.infer<typeof ImportedPost>;

/** The counts a scan reports and the intake keeps: counts only, every reason from the closed lists. */
const scanCounts = {
  /** Lines written (the summary), or lines the preview offers (the intake: readable, not already imported, not over the new account's cap). */
  posts: Count.max(IMPORT_RULES.maxPosts),
  images: Count.max(IMPORT_RULES.maxImages),
  skipped: z.partialRecord(z.enum(IMPORT_SKIP_REASONS), Count),
  imagesSkipped: z.partialRecord(z.enum(IMPORT_IMAGE_SKIPS), Count),
  /** Characters removed by 5.3 step 5, and descriptions that became null. */
  cleaned: Count,
  /** Posts that begin with a content warning's line (Mastodon), and links to the source platform replaced by words (5.3 step 3b). */
  warnings: Count,
  sourceLinks: Count,
  /** X posts dated inside a protected period. */
  protectedPosts: Count,
  /** The scan stopped at maxItems (over_item_cap). */
  readInPart: z.boolean(),
};

/** summary.json, the importer's last write for a scan and its commit point (7.1 step 4). The API parses it as hostile input. */
export const ImportSummary = z.discriminatedUnion("status", [
  z.strictObject({ v: z.literal(1), id: z.uuid(), status: z.literal("scanned"), ...scanCounts }),
  z.strictObject({ v: z.literal(1), id: z.uuid(), status: z.literal("failed"), failure: ImportFailure }),
]);
export type ImportSummary = z.infer<typeof ImportSummary>;

/**
 * A month table: per month, one group per set of marks that occurs, as [marks, posts, images, imagesUndescribed]. In the
 * scan: the lines the preview offers, their images, and those of their images without a source's description. In the
 * picks' counts: [marks, posts left out, images with a source's description in posts left out, images given a
 * description by a pick in posts not left out], so the app's totals stay exact.
 */
const MonthTable = z.array(z.object({ month: Month, groups: z.array(z.tuple([Marks, Count, Count, Count])).max(2 ** IMPORT_MARKS.length) }));

/**
 * What the intake stores in import_jobs.scan (6.1, 7.5 step 2). `fromRef` is the lowest ref that may be published (a
 * new account's newest lines only); `samples` the three newest lines' refs and byte offsets; `pages` every pageLines-th
 * line's byte offset. The move out of ready keeps the counts and fromRef and empties the rest.
 */
export const ImportScanFacts = z.object({
  ...scanCounts,
  months: MonthTable,
  first: Month.nullable(),
  last: Month.nullable(),
  fromRef: Ref,
  samples: z.array(z.object({ ref: Ref, offset: Offset })).max(IMPORT_RULES.samples),
  pages: z.array(Offset).max(IMPORT_RULES.maxPages),
});
export type ImportScanFacts = z.infer<typeof ImportScanFacts>;

/** The person's choice (4.4): a range of months, inclusive, either end open when null; never `from` after `to`. */
export const ImportChoice = z
  .strictObject({
    from: Month.nullable(),
    to: Month.nullable(),
    replies: z.boolean(),
    warnings: z.boolean(),
    protected: z.boolean(),
    images: z.boolean(),
    long: z.enum(["leave", "shorten"]),
  })
  .refine((choice) => choice.from === null || choice.to === null || choice.from <= choice.to, { path: ["to"] });
export type ImportChoice = z.infer<typeof ImportChoice>;

/** One line of the preview's list (9.2), with the person's pick: `alts[i]` is the description written for media[i]. */
export const ImportLineView = z.object({
  ref: Ref,
  at: Day,
  kind: Kind,
  marks: Marks,
  text: z.string(),
  media: z.array(z.object({ file: ImportMediaFile, alt: z.string().nullable() })),
  leftOut: z.boolean(),
  alts: z.array(z.string().nullable()),
});
export type ImportLineView = z.infer<typeof ImportLineView>;

/** A pick (4.4): leave the line out or not, and a description for each image its source gave none, by position in media. */
export const ImportPickRequest = z.strictObject({ leftOut: z.boolean(), alts: z.array(AltText.nullable()).max(MEDIA_MAX_PER_POST) });
export type ImportPickRequest = z.infer<typeof ImportPickRequest>;

/** The pick as saved, and the picks' counts by month and marks. */
export const ImportPickView = z.object({ ref: Ref, leftOut: z.boolean(), alts: z.array(z.string().nullable()), picks: MonthTable });
export type ImportPickView = z.infer<typeof ImportPickView>;

export const CreateImportRequest = z.strictObject({ source: ImportSource, bytes: z.int().min(1).max(IMPORT_RULES.maxBytes) });
export type CreateImportRequest = z.infer<typeof CreateImportRequest>;

/** The statement (decision 14) is part of the request: without it there is nothing to confirm. */
export const ConfirmImportRequest = z.strictObject({ choice: ImportChoice, statement: z.literal(true) });
export type ConfirmImportRequest = z.infer<typeof ConfirmImportRequest>;

/**
 * An import as its owner sees it (9.3). No text but the samples (only in ready) and the refused post's first words, no
 * file name, no source id. `scan` holds the facts without their offsets; `endedByStaff` is the rule's id when an admin
 * ended it; `refusedAt` is the archive's day of the post whose image was refused.
 */
export const ImportView = z.object({
  id: z.uuid(),
  source: ImportSource,
  status: ImportStatus,
  createdAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  declaredBytes: z.int().min(1).max(IMPORT_RULES.maxBytes),
  receivedBytes: Count.max(IMPORT_RULES.maxBytes),
  chunkBytes: z.int().min(1),
  failure: ImportFailure.nullable(),
  stopReason: z.enum(IMPORT_STOP_REASONS).nullable(),
  endedByStaff: z.string().nullable(),
  scan: ImportScanFacts.omit({ samples: true, pages: true }).nullable(),
  samples: z.array(z.object({ at: Day, text: z.string() })).max(IMPORT_RULES.samples),
  choice: ImportChoice.nullable(),
  picks: MonthTable,
  progress: z.object({ imagesTotal: Count, imagesSettled: Count, postsTotal: Count, postsPublished: Count, postsRemoved: Count, postsLeft: Count }),
  paused: z.boolean(),
  refusalId: z.uuid().nullable(),
  refusedAt: Day.nullable(),
  refusedWords: z.string().nullable(),
  undoable: z.boolean(),
});
export type ImportView = z.infer<typeof ImportView>;

/** Every code the imports endpoints add to ErrorEnvelope.error.code; rate_limited, account_suspended and not_found are shared. */
export const ImportErrorCode = z.enum([
  "imports_unavailable",
  "import_active",
  "rate_limited",
  "archive_too_large",
  "wrong_state",
  "wrong_offset",
  "chunk_too_large",
  "chunk_mismatch",
  "not_an_archive",
  "statement_required",
  "nothing_chosen",
  "import_too_soon",
  "account_suspended",
  "not_found",
]);
export type ImportErrorCode = z.infer<typeof ImportErrorCode>;
