import { sql } from "drizzle-orm";
import { boolean, check, index, pgEnum, pgTable, primaryKey, smallint, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { posts } from "./content";
import { apiRole, fullAccess, ts } from "./helpers";
import { profiles } from "./identity";

// ---------------------------------------------------------------- engagement (2d design, sections 6.1 to 6.3 and 6.6; Task 1)
// The three tables of the migration activity: Activity's entries, each account's seen marker and rules, and the mentions a
// post stored. The closed lists and numbers are the contracts' (packages/contracts/src/activity.ts: ACTIVITY_KINDS and
// ACTIVITY_REACH; mentions.ts: MENTION_STORE_MAX), written out here because this package does not depend on the
// contracts; apps/api/test/integration/activity-schema.test.ts holds every migrated CHECK and enum equal to them. The
// migration's hand-written part adds the triggers that force an entry's time, guard the seen marker and the mentions'
// posts, erase an erased post's mentions, the API role's grants and lost_told_for. Only the social module writes these
// tables and the activity module reads them (5.3); no profile row is ever deleted, so the profiles' foreign keys have no
// on delete clause and the purge deletes the rows itself.

/** The four social kinds of entry, in ACTIVITY_KINDS' order (decision 2). Moderation entries are never written (5.4). */
export const activityKind = pgEnum("activity_kind", ["reply", "mention", "quote", "follow"]);

/** Who may reach an account with replies, mentions and quotes, in ACTIVITY_REACH's order (decision 7). */
export const activityReach = pgEnum("activity_reach", ["everyone", "older", "following", "off"]);

/**
 * One entry for one recipient (6.1): a reply to their post, a mention of them, a quote of their post, or a follow of
 * them. Ids and a kind, never a text. Written by createPost and follow in the act's transaction, under the recipient's
 * rules; deleted, never updated (the API role holds no UPDATE), by deletePost, block, the purge and, 90 days on, the
 * retention job.
 */
export const activityItems = pgTable(
  "activity_items",
  {
    /** Never shown as a count; the cursor's tie-breaker (`e:` and the id). */
    id: uuid("id").primaryKey().defaultRandom(),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => profiles.id),
    kind: activityKind("kind").notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => profiles.id),
    /** The reply, the quoting post or the mentioning post; null for a follow. The entry goes with its post. */
    postId: uuid("post_id").references(() => posts.id, { onDelete: "cascade" }),
    /** Forced to now() at insert by activity_items_insert, for every role but the migrator; the default serves the migrator. */
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    // The kind is compared as text, as 2d compares every enum (section 6).
    check("activity_items_post", sql`(${t.kind}::text = 'follow') = (${t.postId} is null)`),
    check("activity_items_not_self", sql`${t.recipientId} <> ${t.actorId}`),
    /** The list, newest first, and the newer count. */
    index("activity_items_recipient_idx").on(t.recipientId, t.createdAt, t.id),
    /** One entry per recipient and post (5.1): a reply that also mentions its parent's author makes one. */
    uniqueIndex("activity_items_post_once").on(t.recipientId, t.postId).where(sql`post_id is not null`),
    /**
     * One follow entry per pair (5.3): a follow, unfollow and follow again within 90 days is one entry, with the time of
     * the first. The enum's label is a literal here, not text: an index predicate takes only immutable expressions, and
     * the cast of an enum to text is not one. The type is created in the same migration, so its labels are usable at once.
     */
    uniqueIndex("activity_items_follow_once").on(t.recipientId, t.actorId).where(sql`kind = 'follow'`),
    /** deletePost's deletion of its post's entries. */
    index("activity_items_post_idx").on(t.postId).where(sql`post_id is not null`),
    /** block's and the purge's deletion of the entries an account caused. */
    index("activity_items_actor_idx").on(t.actorId),
    // Rows arrive in time order and are never updated, so a BRIN index of a few kilobytes finds the retention job's old
    // rows as fast as a btree of many megabytes.
    index("activity_items_created_brin").using("brin", t.createdAt),
    fullAccess("activity_items_api_all", apiRole),
  ],
).enableRLS();

/**
 * Each account's seen marker and rules (6.2). An account without a row reads the defaults (ACTIVITY_DEFAULTS); the API
 * writes the row with insert ... on conflict (account_id) do update. No updated_at: it would keep the account's last
 * visit to Activity, which nothing reads (1.5). activity_state_guard moves the marker forward only, never past the clock.
 */
export const activityState = pgTable(
  "activity_state",
  {
    accountId: uuid("account_id")
      .primaryKey()
      .references(() => profiles.id),
    /** Null until the account first opens Activity; only moves forward. */
    seenAt: ts("seen_at"),
    replies: activityReach("replies").notNull().default("everyone"),
    mentions: activityReach("mentions").notNull().default("everyone"),
    quotes: activityReach("quotes").notNull().default("everyone"),
    follows: boolean("follows").notNull().default(true),
  },
  () => [fullAccess("activity_state_api_all", apiRole)],
).enableRLS();

/**
 * The mentions a post stored (6.3, 4.2): the first MENTION_STORE_MAX distinct handles of its text that named a live
 * account when it was written, with that account and the handle as written, by position in the text. Written only by
 * createPost, with its post (post_mentions_insert refuses a row of a post that is not visible or is imported); never
 * updated; deleted with the post's deletion, its erasure (post_mentions_erase) or the purge.
 */
export const postMentions = pgTable(
  "post_mentions",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => profiles.id),
    /** The handle as written, lowercased: the link holds only while the account's handle still equals it (4.3). */
    handle: text("handle").notNull(),
    /** Its place among the post's stored mentions, from 0. */
    position: smallint("position").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.accountId] }),
    // A handle as handles are (apps/api/src/auth/handles.ts), lowercased.
    check("post_mentions_handle", sql`${t.handle} ~ '^[a-z0-9_]{3,20}$'`),
    // MENTION_STORE_MAX - 1. Named apart from the unique index below, which has the name post_mentions_position.
    check("post_mentions_position_range", sql`${t.position} between 0 and 19`),
    uniqueIndex("post_mentions_position").on(t.postId, t.position),
    /** The purge's deletion of the mentions that name an account. */
    index("post_mentions_account_idx").on(t.accountId),
    fullAccess("post_mentions_api_all", apiRole),
  ],
).enableRLS();
