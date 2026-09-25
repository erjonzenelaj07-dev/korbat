import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { apiRole, fullAccess, ts } from "./helpers";

export const profiles = pgTable(
  "profiles",
  {
    /** Equals auth.users.id. Deliberately no cross-schema FK so korbat_api never needs auth access. */
    id: uuid("id").primaryKey(),
    handle: text("handle").notNull(),
    displayName: text("display_name").notNull(),
    bio: text("bio").notNull().default(""),
    avatarPath: text("avatar_path"),
    verifiedAt: ts("verified_at"),
    reputation: integer("reputation").notNull().default(0),
    /** Counters kept exact by the application, in the same transaction as the follow, unfollow, block or post. */
    followerCount: integer("follower_count").notNull().default(0),
    followingCount: integer("following_count").notNull().default(0),
    /** Non-deleted top-level posts and quotes; reposts and replies are not counted. */
    postCount: integer("post_count").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
    deletedAt: ts("deleted_at"),
    /** When the handle was last changed after onboarding; the next change is allowed 30 days later. Null until the first change. */
    handleChangedAt: ts("handle_changed_at"),
  },
  (t) => [
    uniqueIndex("profiles_handle_lower_idx").on(sql`lower(${t.handle})`),
    check("profiles_counts_nonnegative", sql`${t.followerCount} >= 0 and ${t.followingCount} >= 0 and ${t.postCount} >= 0`),
    fullAccess("profiles_api_all", apiRole),
  ],
).enableRLS();

/**
 * Every handle a profile ever had, in lowercase: the one chosen at onboarding and each one later left
 * behind. A handle here belongs to that profile for good, so nobody else can take a renamed account's
 * old name; the profile itself may go back to it. The rows go only with the profile row.
 */
export const handleHistory = pgTable(
  "handle_history",
  {
    handleLower: text("handle_lower").primaryKey(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    changedAt: ts("changed_at").notNull().defaultNow(),
  },
  () => [fullAccess("handle_history_api_all", apiRole)],
).enableRLS();
