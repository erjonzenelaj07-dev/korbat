import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, check, index, integer, jsonb, pgPolicy, pgTable, smallint, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { apiRole, fullAccess, notifyRole, ts } from "./helpers";
import { profiles } from "./identity";

/**
 * Append-only, and since 3a a hash chain (3a design, section 6): the record of every staff action. UPDATE, DELETE and
 * TRUNCATE are revoked from the API role at the grant level (migration 0001). The trigger audit_chain, which migration 0012
 * installs and the migrator owns, sets id, created_at and the four chain columns of every inserted row, whatever the insert
 * supplied, under a lock on audit_head that lasts until the inserting transaction ends: an audit row is always the last
 * statement of its transaction.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorId: uuid("actor_id").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    requestId: text("request_id"),
    /** When the row joined the chain, in milliseconds: the trigger sets it. */
    createdAt: ts("created_at").notNull().defaultNow(),
    /** The handle of the staff session the action came from. */
    staffSession: uuid("staff_session"),
    /** The staff key: the one a step-up confirmed with, or the key a key's row is about. */
    keyId: uuid("key_id"),
    /** The lower-case hex sha256 of the confirmed action's sorted JSON, when a step-up confirmed it. */
    actionHash: text("action_hash"),
    /** The step-up assertion (authenticatorData, clientDataJSON, signature), base64url exactly as the browser sent them. */
    stepUp: jsonb("step_up").$type<{ authenticatorData: string; clientDataJSON: string; signature: string }>(),
    // The chain. The defaults are placeholders the trigger always overwrites: they keep drizzle's insert type from asking
    // for these columns and let migration 0012 add them over existing rows.
    /** The canonical text's version the row was hashed with. */
    chainVersion: smallint("chain_version").notNull().default(0),
    /** The row's place: the order in which inserts took the head's lock, from 1, with no gap. */
    chainSeq: bigint("chain_seq", { mode: "number" }).notNull().default(0),
    /** The hash of the row before it; 64 zeros for the first. */
    prevHash: text("prev_hash").notNull().default(""),
    /** sha256 hex of prev_hash followed by the row's canonical text. */
    hash: text("hash").notNull().default(""),
  },
  (t) => [
    // Serves the viewer and audit-verify. Migration 0012 creates it after the back-fill, which the placeholders would fail.
    uniqueIndex("audit_log_chain_seq_idx").on(t.chainSeq),
    // A step-up leaves its action's hash and its assertion together, with the key that made it.
    check("audit_log_step_up_complete", sql`(${t.actionHash} is null) = (${t.stepUp} is null) and (${t.actionHash} is null or ${t.keyId} is not null)`),
    pgPolicy("audit_log_api_insert", { for: "insert", to: apiRole, withCheck: sql`true` }),
    pgPolicy("audit_log_api_select", { for: "select", to: apiRole, using: sql`true` }),
  ],
).enableRLS();

/**
 * The newest row of the audit chain: its place and hash, or (1, 0, 64 zeros) for an empty log. One row, which only the
 * trigger moves. The API role may read it (audit-head and audit-verify check that it names the newest row) but neither write
 * nor lock it: migration 0012 revokes every other privilege, and SELECT ... FOR UPDATE needs UPDATE.
 */
export const auditHead = pgTable(
  "audit_head",
  {
    id: smallint("id").primaryKey(),
    seq: bigint("seq", { mode: "number" }).notNull(),
    hash: text("hash").notNull(),
  },
  (t) => [check("audit_head_single_row", sql`${t.id} = 1`), pgPolicy("audit_head_api_select", { for: "select", to: apiRole, using: sql`true` })],
).enableRLS();

// ---------------------------------------------------------------- the contact point and the alert channel (3f design, section 6.1)

/**
 * One message at the authorities' contact point, one row a message, which the watcher (role korbat_notify) inserts with
 * four columns: the folder, the two numbers IMAP gives it and the mail host's time of final delivery. It holds no sender,
 * no subject and no content. The triggers of the migration messages_alerts force `seen_at` and `stale`, store a
 * `received_at` ahead of the database's clock as the clock's time, and write the first push's row of alert_outbox; the
 * API sets a disposition once, with who set it, and the trigger stamps when. Each closed list here is written from the
 * contracts' constant of the same name, and a database test holds the two to each other.
 */
export const contactMessages = pgTable(
  "contact_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** `inbox` or `junk`: the folder the watcher read it in. */
    folder: text("folder").notNull(),
    /** The folder's UIDVALIDITY and the message's UID: unique together with the folder. */
    uidvalidity: bigint("uidvalidity", { mode: "number" }).notNull(),
    uid: bigint("uid", { mode: "number" }).notNull(),
    /** The IMAP internal date, the time of final delivery at the mail host; never later than the database's clock. */
    receivedAt: ts("received_at").notNull(),
    /** Forced: clock_timestamp() at the insert. */
    seenAt: ts("seen_at").notNull(),
    /** Forced: received more than order_rules().stale_hours before it was seen, which raises no push. */
    stale: boolean("stale").notNull(),
    /** Null, or what the message turned out to be (CONTACT_DISPOSITIONS); once set it never changes. */
    disposition: text("disposition"),
    handledBy: uuid("handled_by").references(() => profiles.id, { onDelete: "restrict" }),
    /** Forced when the disposition is set. */
    handledAt: ts("handled_at"),
  },
  (t) => [
    unique("contact_messages_uid_key").on(t.folder, t.uidvalidity, t.uid),
    check("contact_messages_folder", sql`${t.folder} in ('inbox', 'junk')`),
    check("contact_messages_disposition", sql`${t.disposition} in ('order', 'referral', 'first_order_notice', 'preservation_request', 'scrutiny_decision', 'clarification', 'not_an_order')`),
    check("contact_messages_handled", sql`(${t.disposition} is null) = (${t.handledAt} is null)`),
    /** The Contact point screen, newest first by the time of receipt. */
    index("contact_messages_received_idx").on(t.receivedAt, t.id),
    /** The messages nobody handled: the home screen's count and the alert steps' subjects. */
    index("contact_messages_open_idx").on(t.receivedAt).where(sql`disposition is null`),
    fullAccess("contact_messages_api_all", apiRole),
    fullAccess("contact_messages_notify_all", notifyRole),
  ],
).enableRLS();

/**
 * One alert with its two legs: the watcher publishes its push (`pushed_at`), and the API mails it (`mailed_at`) when its
 * kind's mail is its sentence. Its facts are counts and times only. The subject of a time-driven alert (a message or an
 * order) has no foreign key, so a record's erasure never waits for an alert's row. Every row's created_at, pushed_at,
 * mailed_at and push_attempts are forced at insert for every role. The unique key of a time-driven alert's step,
 * alert_outbox_step_key (kind, message_id, order_id, step) NULLS NOT DISTINCT WHERE step IS NOT NULL, is made by hand in
 * the migration: drizzle cannot write NULLS NOT DISTINCT on a partial index.
 */
export const alertOutbox = pgTable(
  "alert_outbox",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    /** One of the contracts' ALERT_KIND_LIST. */
    kind: text("kind").notNull(),
    /** 3 or 5, ntfy's default and highest priority. */
    priority: smallint("priority").notNull(),
    /** The push topic: the phone on call, or every staff phone. */
    scope: text("scope").notNull(),
    /** Null for an alert an event raised; a running number from 0, counted for each kind and subject, for a time-driven one. */
    step: smallint("step"),
    facts: jsonb("facts").$type<Record<string, number | string>>().notNull(),
    messageId: uuid("message_id"),
    orderId: uuid("order_id"),
    /** Forced: clock_timestamp(). */
    createdAt: ts("created_at").notNull(),
    pushedAt: ts("pushed_at"),
    mailedAt: ts("mailed_at"),
    /** A count of failed publishes, for the log; no cap. */
    pushAttempts: integer("push_attempts").notNull(),
  },
  (t) => [
    check(
      "alert_outbox_kind",
      sql`${t.kind} in ('contact_mail', 'contact_mail_escalated', 'order_due', 'order_opened', 'order_corrected', 'order_effected', 'order_reinstated', 'order_unverified', 'hold_ending', 'report_owed', 'handover_undestroyed', 'copy_overdue', 'copy_taken', 'alert_channel_down', 'mailbox_unreachable', 'alert_test', 'moderation_urgent', 'moderation_waiting', 'moderation_burst', 'moderation_reads', 'moderation_reveal', 'moderation_csam_lifted')`,
    ),
    check("alert_outbox_priority", sql`${t.priority} in (3, 5)`),
    check("alert_outbox_scope", sql`${t.scope} in ('on_call', 'all')`),
    check("alert_outbox_step", sql`${t.step} is null or ${t.step} >= 0`),
    // Counts and times only: an object of at most six members, each a number or a string of the form of an instant in UTC.
    // The paths are strict: in lax mode a member's list would be unwrapped and its numbers read as members.
    check(
      "alert_outbox_facts",
      sql`jsonb_typeof(${t.facts}) = 'object' and jsonb_array_length(jsonb_path_query_array(${t.facts}, 'strict $.*')) <= 6 and not jsonb_path_exists(${t.facts}, 'strict $.* ? (@.type() != "number" && !(@.type() == "string" && @ like_regex "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$"))')`,
    ),
    /** The rows the watcher may still owe a push, oldest first. */
    index("alert_outbox_push_idx").on(t.createdAt).where(sql`pushed_at is null`),
    /** The rows the alert tick may still owe a mail. */
    index("alert_outbox_mail_idx").on(t.createdAt).where(sql`mailed_at is null`),
    fullAccess("alert_outbox_api_all", apiRole),
    fullAccess("alert_outbox_notify_all", notifyRole),
  ],
).enableRLS();

/**
 * The watcher's one row: its heartbeat after each round, when it last read both folders and last published (or owed
 * nothing), and the word of its last failure. The API reads it for the channel's health.
 */
export const notifyState = pgTable(
  "notify_state",
  {
    id: smallint("id").primaryKey(),
    beatAt: ts("beat_at"),
    mailboxOkAt: ts("mailbox_ok_at"),
    pushOkAt: ts("push_ok_at"),
    /** Null, or one of the contracts' NOTIFY_ERRORS. */
    error: text("error"),
  },
  (t) => [
    check("notify_state_single_row", sql`${t.id} = 1`),
    check("notify_state_error", sql`${t.error} in ('imap_connect', 'imap_timeout', 'imap_tls', 'imap_login', 'imap_folder', 'imap_protocol', 'push_connect', 'push_refused')`),
    fullAccess("notify_state_api_all", apiRole),
    fullAccess("notify_state_notify_all", notifyRole),
  ],
).enableRLS();

/** The watcher's mark in each folder: the folder's UIDVALIDITY and the highest UID it has inserted. */
export const notifyFolders = pgTable(
  "notify_folders",
  {
    folder: text("folder").primaryKey(),
    uidvalidity: bigint("uidvalidity", { mode: "number" }),
    lastUid: bigint("last_uid", { mode: "number" }),
  },
  (t) => [check("notify_folders_folder", sql`${t.folder} in ('inbox', 'junk')`), fullAccess("notify_folders_api_all", apiRole), fullAccess("notify_folders_notify_all", notifyRole)],
).enableRLS();
