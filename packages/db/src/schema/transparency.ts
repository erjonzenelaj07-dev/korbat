import { sql } from "drizzle-orm";
import { bigint, check, date, integer, jsonb, pgTable, primaryKey, smallint, text, uuid } from "drizzle-orm/pg-core";
import { apiRole, bytea, fullAccess, ts } from "./helpers";

// The public figures (3d design, sections 2 rows 1 to 3 and 8, 6.4, 7.5 and 7.6; Task 4) and the audit head's daily value
// (sections 2 row 9, 6.5 and 7.7; Task 5). Three tables of public record, which hold counts and digests and nothing of a
// person. The transparency module of the API names only this file's tables and the audit head: the architecture test
// holds it to that, so it reads no session and no table of a person.

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
    /**
     * 3d review M4: the ids of the orders this version counted, which edition_publish compares a later call's list with
     * (6.4 step 2), so an order whose hold is later recorded as ended before this version is still published. Never
     * returned by the public read. Null on a version stored before the migration review, read as the list at its instant.
     */
    countedOrders: uuid("counted_orders").array(),
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

/**
 * The audit head's daily value (section 6.5), one `head` row a day and a `restore` row for each restore. The API's job
 * inserts the day's row once (on conflict, nothing), and the insert trigger head_publications_insert forces it for every
 * role but the migrator: a `head` of today in UTC, its place (`chain_seq`) and its `value` (head_value() of the day, the
 * place and the hash) from audit_head as it stands in that statement, and nothing set of the rest; so the API's role
 * cannot publish a value of its own making. The API's role may then set `token` with `witnessed_at`, and `published_at`,
 * each once, from null (the guard head_publications_guard, moderation_column). A `restore` row, `retired_at`, `last_day`
 * and a keeper's value stored after a restore are the command line's (staff.js head-restore-mark, as the migrator). The
 * public route never returns `chain_seq`. Each closed list is written from the contracts' constant of the same name
 * (HEAD_KINDS, HEAD_WITNESSES), and a database test holds the two to each other.
 */
export const headPublications = pgTable(
  "head_publications",
  {
    /** The UTC day. With `kind` the key: a restore can fall on a day that already has its value. */
    day: date("day").notNull(),
    /** head or restore. */
    kind: text("kind").notNull(),
    /**
     * The audit head's place the value was computed from. Null only on a keeper's value that head-restore-mark stored,
     * retired, for a day the restored database lacked: the keeper's mail gives the command the day and the value alone.
     */
    chainSeq: bigint("chain_seq", { mode: "number" }),
    /** head_value(day, chain_seq, hash): 64 hexadecimal characters, which show neither the place nor a row's hash. */
    value: text("value").notNull(),
    /** The adapter that was asked: none while HEAD_WITNESS was off, else rfc3161 or test. */
    witness: text("witness").notNull(),
    /** The witness's answer as received, a whole RFC 3161 TimeStampResp of at most 16 KB, and when it came; both or neither. */
    token: bytea("token"),
    witnessedAt: ts("witnessed_at"),
    /** When the value went public; until then the public route does not show it. */
    publishedAt: ts("published_at"),
    /** When a restore retired the value: true when published, and fitting no log now. */
    retiredAt: ts("retired_at"),
    /** On a restore's row: the day of the newest published value that still fits the restored log, or null when none does. */
    lastDay: date("last_day"),
    /**
     * 3d review M13: when the keeper's mail of this value was accepted by the relay; null until then. The API's role sets
     * it once, from null; later rounds of the day retry while it is null and HEAD_KEEPER_MAIL is set.
     */
    keeperMailedAt: ts("keeper_mailed_at"),
  },
  (t) => [
    primaryKey({ columns: [t.day, t.kind] }),
    check("head_publications_kind", sql`${t.kind} in ('head', 'restore')`),
    check("head_publications_witness", sql`${t.witness} in ('none', 'rfc3161', 'test')`),
    check("head_publications_value", sql`${t.value} ~ '^[0-9a-f]{64}$'`),
    // A token and its time together, of at most HEAD_RULES.tokenMaxBytes, and only from a witness that was asked.
    check("head_publications_token", sql`(${t.token} is null) = (${t.witnessedAt} is null) and (${t.token} is null or (${t.witness} <> 'none' and octet_length(${t.token}) between 1 and 16384))`),
    check("head_publications_place", sql`(${t.chainSeq} is not null and ${t.chainSeq} >= 0) or (${t.chainSeq} is null and ${t.kind} = 'head' and ${t.retiredAt} is not null)`),
    check("head_publications_last_day", sql`${t.lastDay} is null or ${t.kind} = 'restore'`),
    fullAccess("head_publications_api_all", apiRole),
  ],
).enableRLS();
