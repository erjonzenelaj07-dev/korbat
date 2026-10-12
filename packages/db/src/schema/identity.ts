import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
    /** Counters kept exact by the application, in the same transaction as the follow, unfollow, block or post. */
    followerCount: integer("follower_count").notNull().default(0),
    followingCount: integer("following_count").notNull().default(0),
    /** Non-deleted top-level posts and quotes; reposts and replies are not counted. */
    postCount: integer("post_count").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
    deletedAt: ts("deleted_at"),
    /** When the handle was last changed after onboarding; the next change is allowed 30 days later. Null until the first change. */
    handleChangedAt: ts("handle_changed_at"),
    /**
     * "Show my posts in Explore", the author's own switch. Off keeps the account's posts out of Explore from the next
     * read; on again lets them back in at the next refresh. It belongs to the author: the public profile never shows it.
     */
    showInExplore: boolean("show_in_explore").notNull().default(true),
    /**
     * The account's standing (3e design, section 6.1), derived from the ledger of measures by one migrator-owned function,
     * standing_apply, the only writer: the API role holds no UPDATE grant on these three, and a trigger forces them null at
     * insert. `suspended_from` and `suspended_until` are the one interval in which the account's writes are refused
     * (`infinity` ends a termination); both are null when no suspension has a start.
     */
    suspendedFrom: ts("suspended_from"),
    suspendedUntil: ts("suspended_until"),
    /** The end of a restriction of the account's reports under the rules. */
    reportsRestrictedUntil: ts("reports_restricted_until"),
  },
  (t) => [
    uniqueIndex("profiles_handle_lower_idx").on(sql`lower(${t.handle})`),
    check("profiles_counts_nonnegative", sql`${t.followerCount} >= 0 and ${t.followingCount} >= 0 and ${t.postCount} >= 0`),
    // Both ends or neither, and a start before the end. A check passes on a null, so two nulls pass.
    check("profiles_suspended", sql`(${t.suspendedFrom} is null) = (${t.suspendedUntil} is null) and ${t.suspendedFrom} < ${t.suspendedUntil}`),
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
    /**
     * Set while a retirement in the ledger of measures (3e design, section 6.2) keeps this handle from everyone, its former
     * holder included; cleared by the retirement's reversal. The API role cannot update this table, and a trigger forces
     * the column null at insert.
     */
    retiredAt: ts("retired_at"),
  },
  () => [fullAccess("handle_history_api_all", apiRole)],
).enableRLS();
