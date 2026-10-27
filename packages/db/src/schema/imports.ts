import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, integer, jsonb, pgEnum, pgTable, primaryKey, smallint, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { apiRole, bytea, fullAccess, ts } from "./helpers";
import { profiles } from "./identity";

// ---------------------------------------------------------------- import from other platforms (3b design, sections 6.1, 6.4 and 6.7; Task 2)
// The three tables of the migration imports. Only the API's imports module names them. The closed lists and numbers are
// the contracts' (packages/contracts/src/imports.ts: IMPORT_SOURCE_KINDS, ImportStatus, IMPORT_ACTIVE_STATES,
// IMPORT_FAILURES, IMPORT_STOP_REASONS and IMPORT_RULES), written out here because this package does not depend on the
// contracts; apps/api/test/integration/import-schema.test.ts holds every migrated CHECK, enum and predicate equal to them.
// The migration's hand-written part adds the triggers that force an insert's columns, walk the states of section 4.1 and
// guard the deletes, and the API role's grants.

/** Where an archive came from. A later source is one more value (section 1.4). */
export const importSource = pgEnum("import_source", ["x", "mastodon", "bluesky"]);

/** The twelve states of section 4.1, in ImportStatus's order. The first five are active. */
export const importStatus = pgEnum("import_status", ["uploading", "scanning", "ready", "preparing", "publishing", "done", "stopped", "undoing", "undone", "failed", "cancelled", "expired"]);

/**
 * One import (6.1): an archive's upload, its scan, the person's choice and the publishing, as one row moving through the
 * twelve states. It holds the source, the state, the times, the choice and counts only: never a file name, a handle or a
 * text, but the first words of a post whose image was refused, shown to the person alone (decision 25). import_jobs_insert
 * forces every column but the id, the owner, the source and the size; import_jobs_guard lets each later column change
 * only by the move that names it. A post names its import (posts.import_job_id), so the row stays while one does.
 */
export const importJobs = pgTable(
  "import_jobs",
  {
    /** Made by the API (randomUUID): it names the import's folders on the two volumes. */
    id: uuid("id").primaryKey(),
    /** No on delete clause: no profile row is ever deleted. */
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => profiles.id),
    source: importSource("source").notNull(),
    /** Forced to uploading at insert. */
    status: importStatus("status").notNull().default("uploading"),
    /** The archive's size as the person's app declared it: 1 byte to IMPORT_RULES.maxBytes. */
    declaredBytes: bigint("declared_bytes", { mode: "number" }).notNull(),
    /** Bytes stored so far; only grows, never past the declared size. */
    receivedBytes: bigint("received_bytes", { mode: "number" }).notNull().default(0),
    /** Forced to clock_timestamp() at insert. */
    createdAt: ts("created_at").notNull().defaultNow(),
    /** Each set once, by the move that names it: into scanning, out of scanning, out of ready by a confirmation. */
    uploadedAt: ts("uploaded_at"),
    scannedAt: ts("scanned_at"),
    confirmedAt: ts("confirmed_at"),
    /** Set by the move into done, stopped, failed, cancelled or expired, and again by the move into undone. */
    endedAt: ts("ended_at"),
    /** IMPORT_FAILURES; set exactly when the state is failed. */
    failure: text("failure"),
    /** IMPORT_STOP_REASONS; set by the move into stopped, and kept through undoing and undone. */
    stopReason: text("stop_reason"),
    /** An admin's end of the whole import (8.7): when, and under which rule. Set together, once. */
    staffEndedAt: ts("staff_ended_at"),
    staffRuleId: text("staff_rule_id"),
    /**
     * 3b Task 6 (the orchestrator's ruling; migration 0048): the case about one of the import's posts that the admin
     * ended it from, and the decision recorded on that case that the end rests on, set with the two above, together and
     * once. No foreign key: the moderation module's retention erases what it erases on its own clock, and the import's
     * row keeps the ids it was ended by.
     */
    staffCaseId: uuid("staff_case_id"),
    staffDecisionId: uuid("staff_decision_id"),
    /** The archive's day and first words of the post whose image was refused (8.2). Set together, once. */
    refusedAtOriginal: date("refused_at_original"),
    refusedWords: text("refused_words"),
    /** The intake's numbers (ImportScanFacts); never a text. Set by the move into ready, and cut down by the move out of it. */
    scan: jsonb("scan"),
    /** ImportChoice, the person's statement and the seed come with the confirmation, together and once. */
    choice: jsonb("choice"),
    statedAt: ts("stated_at"),
    /** 32 random bytes from which the import's post and image ids are derived (6.5); cleared when the import ends. */
    seed: bytea("seed"),
    /** Lines of posts.jsonl handled, and images handed to the feeder; each only grows. */
    postCursor: integer("post_cursor").notNull().default(0),
    imageCursor: integer("image_cursor").notNull().default(0),
    /** Progress counts; each only grows. */
    postsPublished: integer("posts_published").notNull().default(0),
    imagesKept: integer("images_kept").notNull().default(0),
    imagesLeftOut: integer("images_left_out").notNull().default(0),
    postsRemoved: integer("posts_removed").notNull().default(0),
    /**
     * 3b Task 4 (the orchestrator's ruling; migration 0046): whether this import brings images, decided once at its
     * creation (IMPORT_IMAGES on, which the API allows only beside a matcher, decision 15) and written into job.json. The
     * API role inserts it and holds no UPDATE of it, so it never changes; the preview's media route reads it from here.
     */
    images: boolean("images").notNull().default(false),
    /**
     * 3b Task 5 (the orchestrator's ruling; migration 0047): the images the preparation left out, as counts by reason of
     * IMPORT_IMAGE_SKIPS (missing_file, unsupported, too_large, failed, flagged, not_checked), whose sum is always
     * images_left_out, so the result can say why. Forced to an empty object at insert; each count only grows.
     */
    imagesLeftOutBy: jsonb("images_left_out_by").notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [
    // IMPORT_RULES.maxBytes.
    check("import_jobs_declared_bytes", sql`${t.declaredBytes} between 1 and 2147483648`),
    check("import_jobs_received_bytes", sql`${t.receivedBytes} between 0 and ${t.declaredBytes}`),
    // IMPORT_FAILURES.
    check(
      "import_jobs_failure",
      sql`${t.failure} in ('not_this_source', 'not_an_archive', 'tar_gz', 'partial_archive', 'encrypted', 'too_many_entries', 'too_large_uncompressed', 'bad_entry_name', 'unreadable', 'nothing_to_import', 'scan_timed_out', 'interrupted')`,
    ),
    // The state is compared as text, as 3b compares every enum (section 6).
    check("import_jobs_failed", sql`(${t.status}::text = 'failed') = (${t.failure} is not null)`),
    // IMPORT_STOP_REASONS.
    check("import_jobs_stop_reason", sql`${t.stopReason} in ('refused_image', 'by_author', 'by_staff', 'time_ran_out')`),
    // A stopped import has its reason; the reason stays through the undo, and no other state has one.
    check("import_jobs_stopped", sql`(${t.status}::text <> 'stopped' or ${t.stopReason} is not null) and (${t.stopReason} is null or ${t.status}::text in ('stopped', 'undoing', 'undone'))`),
    // 3b Task 6 (0048): the staff end's four columns are set together or not at all.
    check(
      "import_jobs_staff",
      sql`(${t.staffEndedAt} is null) = (${t.staffRuleId} is null) and (${t.staffEndedAt} is null) = (${t.staffCaseId} is null) and (${t.staffEndedAt} is null) = (${t.staffDecisionId} is null)`,
    ),
    check("import_jobs_refused", sql`(${t.refusedAtOriginal} is null) = (${t.refusedWords} is null)`),
    // IMPORT_RULES.refusedWordsMax, in code points.
    check("import_jobs_refused_words", sql`char_length(${t.refusedWords}) <= 80`),
    // IMPORT_RULES.scanMaxBytes and choiceMaxBytes, as the bytes of the jsonb's text form.
    check("import_jobs_scan", sql`jsonb_typeof(${t.scan}) = 'object' and octet_length(${t.scan}::text) <= 262144`),
    check("import_jobs_choice", sql`jsonb_typeof(${t.choice}) = 'object' and octet_length(${t.choice}::text) <= 1024`),
    // The statement is never stored without the choice it confirmed, nor the choice without it.
    check("import_jobs_stated", sql`(${t.choice} is null) = (${t.statedAt} is null)`),
    // IMPORT_RULES.seedBytes.
    check("import_jobs_seed", sql`octet_length(${t.seed}) = 32`),
    // IMPORT_IMAGE_SKIPS: an object whose names are reasons of the list (the jsonb less those keys is empty), in at most
    // 1,024 bytes of its text form. That each count is a whole number that only grows, summing to images_left_out, is
    // import_jobs_guard's (0047).
    check(
      "import_jobs_left_out_by",
      sql`jsonb_typeof(${t.imagesLeftOutBy}) = 'object' and octet_length(${t.imagesLeftOutBy}::text) <= 1024 and (${t.imagesLeftOutBy} - array['video', 'sensitive', 'unsupported', 'too_large', 'missing_file', 'bluesky_no_files', 'images_off', 'not_chosen', 'no_description', 'over_image_cap', 'failed', 'not_checked', 'flagged']) = '{}'::jsonb`,
    ),
    check(
      "import_jobs_counts",
      sql`${t.postCursor} >= 0 and ${t.imageCursor} >= 0 and ${t.postsPublished} >= 0 and ${t.imagesKept} >= 0 and ${t.imagesLeftOut} >= 0 and ${t.postsRemoved} >= 0`,
    ),
    /**
     * One active import an account (4.1): the five states of IMPORT_ACTIVE_STATES. The enum's labels are literals here, not
     * text: an index predicate takes only immutable expressions, and the cast of an enum to text is not one. The type is
     * created in the same migration, so its labels are usable at once.
     */
    uniqueIndex("import_jobs_one_active").on(t.ownerId).where(sql`status in ('uploading', 'scanning', 'ready', 'preparing', 'publishing')`),
    /** import-drive's rounds, by state and age. */
    index("import_jobs_status_idx").on(t.status, t.createdAt),
    /** The account's list of its imports, and the purge's. */
    index("import_jobs_owner_idx").on(t.ownerId, t.createdAt),
    fullAccess("import_jobs_api_all", apiRole),
  ],
).enableRLS();

/**
 * The person's choices post by post (4.4): a line of posts.jsonl left out, and a description for each of its images the
 * source gave none, by position. Written only while the import is ready (import_picks_guard); deleted when the import
 * ends, and with the import's row in any case.
 */
export const importPicks = pgTable(
  "import_picks",
  {
    importJobId: uuid("import_job_id")
      .notNull()
      .references(() => importJobs.id, { onDelete: "cascade" }),
    /** The line's ref, its place in posts.jsonl. */
    ref: integer("ref").notNull(),
    leftOut: boolean("left_out").notNull().default(false),
    /** An array of at most MEDIA_MAX_PER_POST AltText or null, or null. */
    alts: jsonb("alts"),
    /**
     * 3b Task 4 (the orchestrator's ruling; migration 0046): the picked line's month (YYYY-MM), its marks (IMPORT_MARKS as
     * bits) and how many of its images its source described, copied from posts.jsonl when the pick is first written. The
     * picks' counts of ImportView and ImportPickView are summed from these rows alone, so reading an import opens no work
     * file but the samples. The API role inserts them and holds no UPDATE of them: a line's facts never change.
     */
    month: text("month").notNull(),
    marks: smallint("marks").notNull(),
    described: smallint("described").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.importJobId, t.ref] }),
    check("import_picks_month", sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    // IMPORT_MARKS: four bits.
    check("import_picks_marks", sql`${t.marks} between 0 and 15`),
    // MEDIA_MAX_PER_POST.
    check("import_picks_described", sql`${t.described} between 0 and 4`),
    // At most four descriptions (MEDIA_MAX_PER_POST) in IMPORT_RULES.altsMaxBytes, as the bytes of the jsonb's text form:
    // four AltText of 1,000 code points take up to 16,016 (Task 1's amendment). A CASE, so the length is read only of an array.
    check(
      "import_picks_alts",
      sql`case jsonb_typeof(${t.alts}) when 'array' then jsonb_array_length(${t.alts}) <= 4 and octet_length(${t.alts}::text) <= 16384 else ${t.alts} is null end`,
    ),
    fullAccess("import_picks_api_all", apiRole),
  ],
).enableRLS();

/**
 * Each importing account's random key of section 5.4, under which the importer hashes every source post's id, so a later
 * import skips what an earlier one published (decision 24) and two accounts' imports are never linked. Inserted at the
 * account's first import; never updated (the API role holds no UPDATE); deleted only once the profile is (the purge).
 */
export const importKeys = pgTable(
  "import_keys",
  {
    /** No on delete clause: no profile row is ever deleted. */
    ownerId: uuid("owner_id")
      .primaryKey()
      .references(() => profiles.id),
    key: bytea("key").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    // IMPORT_RULES.keyBytes.
    check("import_keys_key", sql`octet_length(${t.key}) = 32`),
    fullAccess("import_keys_api_all", apiRole),
  ],
).enableRLS();
