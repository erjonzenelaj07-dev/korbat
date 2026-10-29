import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, pgEnum, pgTable, primaryKey, real, smallint, text, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { apiRole, bytea, fullAccess, ts } from "./helpers";
import { profiles } from "./identity";
import { importJobs, importSource } from "./imports";

/** 3f (design, section 6.2): `disabled`, a post an authority's order disables, which every reader answers as missing. */
export const postState = pgEnum("post_state", ["visible", "withheld", "removed", "deleted_by_author", "disabled"]);

/**
 * What moderation derives for a post from the measures in force (3c design, section 6.1): the strongest of them.
 * posts.state mirrors it unless the author deleted the post, so post_state gains no value of 3c's. 3f adds `disabled`
 * to both (design, section 6.2), above `removed`: no row holds it before an order is given effect.
 */
export const moderationLevel = pgEnum("moderation_level", ["visible", "withheld", "removed", "disabled"]);

/** An image's own moderation state, beside its post's. Only an image is ever sealed: shown to nobody, its author included. */
export const mediaModerationState = pgEnum("media_moderation_state", ["visible", "withheld", "removed", "sealed"]);

/** A counter kept exact by the application: updated in the same transaction as the action it counts. */
const counter = (name: string) => integer(name).notNull().default(0);

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authorId: uuid("author_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    replyToId: uuid("reply_to_id").references((): AnyPgColumn => posts.id, { onDelete: "set null" }),
    quoteOfId: uuid("quote_of_id").references((): AnyPgColumn => posts.id, { onDelete: "set null" }),
    state: postState("state").notNull().default("visible"),
    likeCount: counter("like_count"),
    repostCount: counter("repost_count"),
    /** Replies that are not deleted. */
    replyCount: counter("reply_count"),
    /** Quotes that are not deleted. */
    quoteCount: counter("quote_count"),
    createdAt: ts("created_at").notNull().defaultNow(),
    /** Set together with state = 'deleted_by_author'; the body is blanked at the same time. */
    deletedAt: ts("deleted_at"),
    /** Derived from the ledger of measures by a migrator-owned function, the only writer; the API role cannot update it. */
    moderationLevel: moderationLevel("moderation_level").notNull().default("visible"),
    /** Set, one way, when the R4 redaction erased the post's content; written only by a migrator-owned function. */
    erasedAt: ts("erased_at"),
    /**
     * Explore's resume rule (3e design, sections 6.1 and 6.4): when the post last left the level visible, when it last came
     * back, and the time its age and window are counted from after its hidden spans. Outside the API's column grants; a
     * later migration gives them their one writer, moderation_apply.
     */
    hiddenAt: ts("hidden_at"),
    restoredAt: ts("restored_at"),
    exploreFrom: ts("explore_from"),
    /**
     * 3b (design, section 6.2): an imported post's import, source, the date its archive gives it, whether it was cut to
     * 1,000 characters, and the key of section 5.4 (32 bytes) by which a later import of the account skips it. All five
     * are set or none is (a native post, or an imported one's tombstone); posts_import_guard (migration 0044) lets an
     * insert set them only for a publishing import of the author with the same source, and an update only clear them, all
     * at once, with the post's tombstone. No on delete clause on the job: its row cannot go while a post names it.
     */
    importJobId: uuid("import_job_id").references((): AnyPgColumn => importJobs.id),
    importSource: importSource("import_source"),
    originalCreatedAt: ts("original_created_at"),
    importShortened: boolean("import_shortened"),
    importKey: bytea("import_key"),
    /**
     * 2d (design, section 6.4, decision 26; migration 0050_post_options): its author hid the post's like and repost counts
     * from everyone else, in the composer or from the post's More menu. Declared last, as the column is the table's last.
     */
    hideCounts: boolean("hide_counts").notNull().default(false),
  },
  (t) => [
    index("posts_author_created_idx").on(t.authorId, t.createdAt),
    /** Explore's restored posts. */
    index("posts_explore_from_idx").on(t.exploreFrom).where(sql`explore_from is not null`),
    index("posts_created_id_idx").on(t.createdAt, t.id),
    /** A thread's replies in order, and every lookup by parent. */
    index("posts_reply_to_created_idx").on(t.replyToId, t.createdAt, t.id),
    /**
     * The public Latest timeline: visible top-level posts and quotes, newest first. 3b (6.2): imported posts are in no
     * feed, so the predicate leaves them out (migration 0045 drops the index and creates it again).
     */
    index("posts_latest_idx").on(t.createdAt, t.id).where(sql`reply_to_id is null and state = 'visible' and import_job_id is null`),
    index("posts_quote_of_idx").on(t.quoteOfId),
    /** 3b: a post is imported once per account while it exists (decision 24). */
    uniqueIndex("posts_import_key_idx").on(t.authorId, t.importKey).where(sql`import_key is not null`),
    /** 3b: an import's posts, for the undo, the foreign key's checks and the job's count. */
    index("posts_import_job_idx").on(t.importJobId, t.id).where(sql`import_job_id is not null`),
    /** 3b (0045): the profile's Imported tab, its top-level imported posts by the archive's date. */
    index("posts_imported_idx").on(t.authorId, t.originalCreatedAt, t.id).where(sql`import_job_id is not null and reply_to_id is null`),
    /**
     * 3b (0045): an author's native posts, for Following's own branch and the Posts and Replies tabs, so a followed
     * account's 50,000 imported posts are never scanned there.
     */
    index("posts_author_native_idx").on(t.authorId, t.createdAt, t.id).where(sql`import_job_id is null`),
    check("posts_body_len", sql`char_length(${t.body}) <= 1000`),
    check("posts_counts_nonnegative", sql`${t.likeCount} >= 0 and ${t.repostCount} >= 0 and ${t.replyCount} >= 0 and ${t.quoteCount} >= 0`),
    check(
      "posts_import_columns",
      sql`(${t.importJobId} is null) = (${t.importSource} is null) and (${t.importJobId} is null) = (${t.originalCreatedAt} is null) and (${t.importJobId} is null) = (${t.importShortened} is null) and (${t.importJobId} is null) = (${t.importKey} is null)`,
    ),
    fullAccess("posts_api_all", apiRole),
  ],
).enableRLS();

/**
 * One Explore ranking (a "generation"), written by the refresh job (2c design, sections 6 and 7). The current ranking
 * is the highest generation; the job also keeps the one before it, so a reader paging through a ranking is not cut
 * off by the next round.
 */
export const exploreRuns = pgTable(
  "explore_runs",
  {
    /** Numbered by the database. One ranking every 5 minutes lasts 20,000 years in an integer. */
    generation: integer("generation").primaryKey().generatedAlwaysAsIdentity(),
    /** The refresh time the round was given; the ranking is computed as of this time. */
    asOf: ts("as_of").notNull(),
    /** The version of the formula the round ranked with (EXPLORE_V2.version in @korbat/contracts; rankings from before 3e hold 1). */
    formula: smallint("formula").notNull(),
    /** Posts that passed the candidate predicate at as_of. */
    candidates: integer("candidates").notNull(),
    /** Posts the ranking holds; their positions run from 1 to this. */
    items: integer("items").notNull(),
    /** How long the round took. */
    tookMs: integer("took_ms").notNull(),
  },
  () => [fullAccess("explore_runs_api_all", apiRole)],
).enableRLS();

/**
 * The posts of one Explore ranking, in order. No score or count is stored: nothing reads them after the insert, and
 * the position is the order. A row goes with its ranking, its post or its author.
 */
export const exploreItems = pgTable(
  "explore_items",
  {
    generation: integer("generation").notNull().references(() => exploreRuns.generation, { onDelete: "cascade" }),
    /** 1 to the ranking's item count, without gaps. */
    position: integer("position").notNull(),
    postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    /** The post's author, so an author's places in a ranking are counted without reading the posts. */
    authorId: uuid("author_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.generation, t.position] }),
    /** A post has one place in a ranking. */
    uniqueIndex("explore_items_generation_post_idx").on(t.generation, t.postId),
    fullAccess("explore_items_api_all", apiRole),
  ],
).enableRLS();

/** An upload is processing until the worker's result is in, then ready or failed for good. */
export const mediaStatus = pgEnum("media_status", ["processing", "ready", "failed"]);

/**
 * 2d Task 3 (design, section 6.4; migration 0051_avatars): what an upload is for, an image of a post or a profile's picture,
 * the contracts' MEDIA_KINDS. New in its migration, created whole: every function compares it as text, and the owner's
 * index names its label as a label (an index predicate takes no cast of an enum to text).
 */
export const mediaKind = pgEnum("media_kind", ["post", "avatar"]);

/**
 * One uploaded image. The files live on the media-store volume under the row's id; no path is
 * stored. Only the API's media module reads or writes this table.
 */
export const postMedia = pgTable(
  "post_media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Who uploaded it. Only this account may attach it to a post. */
    ownerId: uuid("owner_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    status: mediaStatus("status").notNull().default("processing"),
    /** Why processing failed: one of the contracts' MediaFailure values. */
    error: text("error"),
    /** Set, together with the position, when the image is attached to a post. */
    postId: uuid("post_id").references(() => posts.id, { onDelete: "cascade" }),
    position: integer("position"),
    /** Of the large size, after rotation. Set, together with the blurhash, when processing succeeds. */
    width: integer("width"),
    height: integer("height"),
    blurhash: text("blurhash"),
    altText: text("alt_text"),
    /** Filled by sub-project 3. Empty until then. */
    nsfwScore: real("nsfw_score"),
    createdAt: ts("created_at").notNull().defaultNow(),
    // The three columns below are forced to their defaults at insert and written only by migrator-owned functions; the
    // API role holds no UPDATE on them (migration 0015).
    /** Derived from the ledger of measures, as the post's level is. */
    moderationState: mediaModerationState("moderation_state").notNull().default("visible"),
    /** The latest end of the image's unreleased holds (media_holds): while it lies ahead, every delete skips the row. */
    holdUntil: ts("hold_until"),
    /** Set when an R4 removal of the image became final and its content was erased. */
    erasedAt: ts("erased_at"),
    /**
     * 3b (design, section 6.3): the image came from an import, which never changes; and the running import that owns the
     * upload, so the sweeper leaves it alone and the import cleans it up. post_media_import_insert (migration 0044) takes an
     * imported row only for a preparing import of its owner and a native one naming no import; the API role holds no
     * UPDATE of either. The import's row may go first: then its id is set null and the row stays imported, which
     * post_media_import_attach lets onto no post.
     */
    imported: boolean("imported").notNull().default(false),
    importJobId: uuid("import_job_id").references((): AnyPgColumn => importJobs.id, { onDelete: "set null" }),
    /**
     * 2d Task 3 (design, sections 6.4 and 7): the upload's kind, from its query, set at insert and never changed (the API
     * role holds no UPDATE of it). An avatar is never on a post, has no position and no description.
     */
    kind: mediaKind("kind").notNull().default("post"),
    /**
     * The profile this avatar is the picture of, while it is: set and cleared only by the media module's attachAvatar and
     * detachAvatar, under post_media_avatar_guard (to the owner's own profile, from null, on a ready, visible, unerased
     * avatar of a live profile), and refused at insert by post_media_insert. No on delete clause: no profile row is ever
     * deleted, and the account's purge deletes the image rows itself. One avatar a profile (post_media_avatar_idx).
     */
    profileId: uuid("profile_id").references(() => profiles.id),
    /**
     * An avatar's SHA-256 as uploaded, in lowercase hex, taken while the upload streams whatever MEDIA_MATCH says, so that
     * a picture a moderator reset can be recognised when it comes back (Task 4's avatar_resets). Null for a post's image.
     */
    avatarSha256: text("avatar_sha256"),
  },
  (t) => [
    uniqueIndex("post_media_post_position_idx").on(t.postId, t.position),
    index("post_media_owner_created_idx").on(t.ownerId, t.createdAt),
    index("post_media_status_created_idx").on(t.status, t.createdAt),
    check("post_media_ready_has_dims", sql`${t.status} <> 'ready' or (${t.width} is not null and ${t.height} is not null and ${t.blurhash} is not null)`),
    check("post_media_attached_is_complete", sql`${t.postId} is null or (${t.status} = 'ready' and ${t.position} between 0 and 3 and ${t.altText} is not null)`),
    check("post_media_alt_len", sql`char_length(${t.altText}) <= 1000`),
    check("post_media_import_link", sql`${t.importJobId} is null or ${t.imported}`),
    // 2d Task 3 (6.4): an avatar is never attached to a post, and a post's image is never an avatar. Kinds compared as text.
    check(
      "post_media_kind_place",
      sql`(${t.kind}::text = 'post' and ${t.profileId} is null) or (${t.kind}::text = 'avatar' and ${t.postId} is null and ${t.position} is null and ${t.altText} is null)`,
    ),
    // An avatar is only ever its owner's own profile's picture.
    check("post_media_avatar_owner", sql`${t.profileId} is null or ${t.profileId} = ${t.ownerId}`),
    // An avatar always has its file's SHA-256, a post's image never has one. "is not null" first: a CHECK passes on a null,
    // and a pattern match on a null is null.
    check("post_media_avatar_sha256", sql`(${t.kind}::text = 'post' and ${t.avatarSha256} is null) or (${t.kind}::text = 'avatar' and ${t.avatarSha256} is not null and ${t.avatarSha256} ~ '^[0-9a-f]{64}$')`),
    /** 2d Task 3: one avatar a profile, and the one statement of avatarsOf, which reads a page's authors' avatars by profile. */
    uniqueIndex("post_media_avatar_idx").on(t.profileId).where(sql`profile_id is not null`),
    /** 2d Task 3: an owner's avatars, the current one and any former one a hold keeps, for the purge and (Task 4) the seal. */
    index("post_media_owner_avatar_idx").on(t.ownerId).where(sql`kind = 'avatar'`),
    /**
     * 3b: an import's images by their job. The foreign key's set null when a job row goes, and the import's cleanup of its
     * unattached rows in id order (media.deleteImportLeftovers), would scan post_media without it.
     */
    index("post_media_import_job_idx").on(t.importJobId, t.id).where(sql`import_job_id is not null`),
    /**
     * 3b Task 5: the imports whose images are still on no post. import-drive asks it every round, for every import that
     * has ended, so that a stop's or a time limit's leftovers go (7.4); the index holds only rows on their way, never the
     * many attached ones, so the question costs nothing however many images were ever imported.
     */
    index("post_media_import_unattached_idx").on(t.importJobId).where(sql`import_job_id is not null and post_id is null`),
    fullAccess("post_media_api_all", apiRole),
  ],
).enableRLS();

/**
 * The edge's outbox (3d design, sections 2 row 11, 6.3 and 7.4; Task 3): one row each time an image stops being public,
 * which the job edge-purge drains to the purge adapter. No role inserts a row: the two definer triggers post_media_purge
 * and posts_purge write it in the transaction that hides the image, whoever the writer is, and the API's role holds no
 * INSERT, so no route can forget one and none can invent one. The insert trigger edge_purges_insert forces `created_at`
 * (clock_timestamp()) and `next_at` (now(): due at once). The API's job reads it, moves the four columns of a purge's
 * progress and (Task 8) deletes a row 30 days after it was done. No foreign key: an image's row may go, by a deletion or
 * the disposal, while its purge is still owed. The closed lists are the contracts' EDGE_PURGE_CAUSES and
 * EDGE_PURGE_OUTCOMES, written out here; a database test holds each migrated CHECK to its constant.
 */
export const edgePurges = pgTable(
  "edge_purges",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    mediaId: uuid("media_id").notNull(),
    /** state, deleted or released. */
    cause: text("cause").notNull(),
    /** Forced: clock_timestamp(). */
    createdAt: ts("created_at").notNull(),
    /** Forced at insert: now(). The job moves it back off after a failed purge. */
    nextAt: ts("next_at").notNull(),
    attempts: smallint("attempts").notNull().default(0),
    /** accepted, failed or off; set with done_at, once. */
    outcome: text("outcome"),
    doneAt: ts("done_at"),
  },
  (t) => [
    check("edge_purges_cause", sql`${t.cause} in ('state', 'deleted', 'released')`),
    check("edge_purges_outcome", sql`${t.outcome} in ('accepted', 'failed', 'off')`),
    check("edge_purges_done", sql`(${t.outcome} is null) = (${t.doneAt} is null)`),
    check("edge_purges_attempts", sql`${t.attempts} >= 0`),
    /** The job's round: the rows still owed a purge, by when they are due. */
    index("edge_purges_due_idx").on(t.nextAt).where(sql`done_at is null`),
    /** The case's and the order's purge line: the newest row of an image. */
    index("edge_purges_media_idx").on(t.mediaId, t.id),
    fullAccess("edge_purges_api_all", apiRole),
  ],
).enableRLS();

/** user -> user relation table (follows, blocks, mutes). */
function userPairTable(name: string, from: string, to: string) {
  return pgTable(
    name,
    {
      fromId: uuid(from).notNull().references(() => profiles.id, { onDelete: "cascade" }),
      toId: uuid(to).notNull().references(() => profiles.id, { onDelete: "cascade" }),
      createdAt: ts("created_at").notNull().defaultNow(),
    },
    (t) => [
      primaryKey({ columns: [t.fromId, t.toId] }),
      /** Pages of either side, newest first, and every lookup by either side. */
      index(`${name}_to_created_idx`).on(t.toId, t.createdAt, t.fromId),
      index(`${name}_from_created_idx`).on(t.fromId, t.createdAt, t.toId),
      check(`${name}_not_self`, sql`${t.fromId} <> ${t.toId}`),
      fullAccess(`${name}_api_all`, apiRole),
    ],
  ).enableRLS();
}

/**
 * user -> post relation table (likes, reposts, bookmarks). `createdBrin` adds `<name>_created_brin`, a BRIN index on
 * created_at, for the tables whose recent rows the Explore refresh reads (2c design, section 6).
 */
function userPostTable(name: string, options: { createdBrin?: boolean } = {}) {
  return pgTable(
    name,
    {
      userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
      postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
      createdAt: ts("created_at").notNull().defaultNow(),
    },
    (t) => [
      primaryKey({ columns: [t.userId, t.postId] }),
      index(`${name}_post_idx`).on(t.postId),
      /** Per-account lists (your likes, your bookmarks) and the reposts half of the Following timeline. */
      index(`${name}_user_created_idx`).on(t.userId, t.createdAt),
      // Rows arrive roughly in time order, so a BRIN index of a few kilobytes finds the refresh's window as fast as a
      // btree of many megabytes. Unlikes, blocks and purges let later rows fill old pages and erode that order slowly.
      ...(options.createdBrin ? [index(`${name}_created_brin`).using("brin", t.createdAt)] : []),
      fullAccess(`${name}_api_all`, apiRole),
    ],
  ).enableRLS();
}

export const follows = userPairTable("follows", "follower_id", "followee_id");
export const blocks = userPairTable("blocks", "blocker_id", "blocked_id");
export const mutes = userPairTable("mutes", "muter_id", "muted_id");
export const likes = userPostTable("likes", { createdBrin: true });
export const reposts = userPostTable("reposts", { createdBrin: true });
/** Bookmarks are private and never count towards Explore, so they need no index by time. */
export const bookmarks = userPostTable("bookmarks");
