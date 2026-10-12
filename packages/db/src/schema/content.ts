import { sql } from "drizzle-orm";
import { check, index, integer, pgEnum, pgTable, primaryKey, real, smallint, text, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { apiRole, fullAccess, ts } from "./helpers";
import { profiles } from "./identity";

export const postState = pgEnum("post_state", ["visible", "withheld", "removed", "deleted_by_author"]);

/**
 * What moderation derives for a post from the measures in force (3c design, section 6.1): the strongest of them.
 * posts.state mirrors it unless the author deleted the post, so post_state gains no value.
 */
export const moderationLevel = pgEnum("moderation_level", ["visible", "withheld", "removed"]);

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
  },
  (t) => [
    index("posts_author_created_idx").on(t.authorId, t.createdAt),
    /** Explore's restored posts. */
    index("posts_explore_from_idx").on(t.exploreFrom).where(sql`explore_from is not null`),
    index("posts_created_id_idx").on(t.createdAt, t.id),
    /** A thread's replies in order, and every lookup by parent. */
    index("posts_reply_to_created_idx").on(t.replyToId, t.createdAt, t.id),
    /** The public Latest timeline: visible top-level posts and quotes, newest first. */
    index("posts_latest_idx").on(t.createdAt, t.id).where(sql`reply_to_id is null and state = 'visible'`),
    index("posts_quote_of_idx").on(t.quoteOfId),
    check("posts_body_len", sql`char_length(${t.body}) <= 1000`),
    check("posts_counts_nonnegative", sql`${t.likeCount} >= 0 and ${t.repostCount} >= 0 and ${t.replyCount} >= 0 and ${t.quoteCount} >= 0`),
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
    /** The version of the formula the round ranked with (EXPLORE_V1.version in @korbat/contracts). */
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
  },
  (t) => [
    uniqueIndex("post_media_post_position_idx").on(t.postId, t.position),
    index("post_media_owner_created_idx").on(t.ownerId, t.createdAt),
    index("post_media_status_created_idx").on(t.status, t.createdAt),
    check("post_media_ready_has_dims", sql`${t.status} <> 'ready' or (${t.width} is not null and ${t.height} is not null and ${t.blurhash} is not null)`),
    check("post_media_attached_is_complete", sql`${t.postId} is null or (${t.status} = 'ready' and ${t.position} between 0 and 3 and ${t.altText} is not null)`),
    check("post_media_alt_len", sql`char_length(${t.altText}) <= 1000`),
    fullAccess("post_media_api_all", apiRole),
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
