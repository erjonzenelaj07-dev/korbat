import { sql } from "drizzle-orm";
import { check, date, integer, jsonb, pgTable, primaryKey, smallint, text } from "drizzle-orm/pg-core";
import { apiRole, fullAccess, ts } from "./helpers";

// The public figures (3d design, sections 2 rows 1 to 3 and 8, 6.4, 7.5 and 7.6; Task 4). Two tables of public record,
// which hold counts and nothing of a person. The transparency module of the API names only this file's tables (and the
// audit head, from Task 5): the architecture test holds it to that, so it reads no session and no table of a person.

/**
 * One version of a year's edition, frozen when it is stored: the API's role may only read it, the definer function
 * edition_publish() writes the one row a call, and the trigger transparency_editions_frozen refuses every update, for
 * every role. A correction or an order whose hold ended is a new version beside the older ones. The closed list of
 * `reason` is the contracts' EDITION_REASONS, written out here; a database test holds the migrated CHECK to it.
 */
export const transparencyEditions = pgTable(
  "transparency_editions",
  {
    year: smallint("year").notNull(),
    version: smallint("version").notNull(),
    /** When its figures were computed, and when it was published: the same instant, set by edition_publish(). */
    computedAt: ts("computed_at").notNull(),
    publishedAt: ts("published_at").notNull(),
    /** transparency_rules().method when it was stored. */
    method: smallint("method").notNull(),
    /** first, hold_ended or correction. */
    reason: text("reason").notNull(),
    /** What transparency_figures() computed, or (hold_ended) the newest version's figures with the order section alone replaced. */
    figures: jsonb("figures").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.year, t.version] }),
    check("transparency_editions_reason", sql`${t.reason} in ('first', 'hold_ended', 'correction')`),
    // Version 1 is the first, and no other version is.
    check("transparency_editions_first", sql`${t.version} >= 1 and (${t.version} = 1) = (${t.reason} = 'first')`),
    fullAccess("transparency_editions_api_all", apiRole),
  ],
).enableRLS();

/**
 * One month of the recipients' count (7.5): the signed-in accounts of the month's sketch and the sum of its days' sketches
 * of signed-out readers, null while RECIPIENTS_SIGNED_OUT was off. Two numbers a month, and nothing of a person. The API's
 * job inserts the row at the month's close, once; no role updates or deletes one but the migrator (a test's cleanup). The
 * insert trigger recipient_months_insert forces `computed_at`.
 */
export const recipientMonths = pgTable(
  "recipient_months",
  {
    /** The month's first day. */
    month: date("month").primaryKey(),
    signedIn: integer("signed_in").notNull(),
    signedOutDays: integer("signed_out_days"),
    /** RECIPIENT_RULES.method when the month was closed. */
    method: smallint("method").notNull(),
    /** Forced: now(). */
    computedAt: ts("computed_at").notNull(),
  },
  (t) => [
    check("recipient_months_first_day", sql`extract(day from ${t.month}) = 1`),
    check("recipient_months_counts", sql`${t.signedIn} >= 0 and ${t.signedOutDays} >= 0`),
    fullAccess("recipient_months_api_all", apiRole),
  ],
).enableRLS();
