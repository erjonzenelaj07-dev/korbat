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
      sql`${t.kind} in ('contact_mail', 'contact_mail_escalated', 'order_due', 'order_opened', 'order_corrected', 'order_effected', 'order_reinstated', 'order_unverified', 'hold_ending', 'report_owed', 'handover_undestroyed', 'copy_overdue', 'copy_taken', 'alert_channel_down', 'mailbox_unreachable', 'alert_test', 'moderation_urgent', 'moderation_waiting', 'moderation_burst', 'moderation_reads', 'moderation_reveal', 'moderation_csam_lifted', 'quarantine_due', 'quarantine_lost', 'release_undestroyed', 'seal_released', 'edge_purge_failed', 'head_unwitnessed', 'head_missed', 'automated_objection', 'automation_capped', 'automated_waiting', 'matcher_down', 'hold_ended_unreported', 'head_unmailed', 'import_image_flagged')`,
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

// ---------------------------------------------------------------- records to authorities (3f design, section 6.5)
// The lists are written from the contracts' constants of the same meaning (NOTIFICATION_STATES, NOTIFICATION_DUTIES,
// NOTIFICATION_SENT_KINDS, NOTIFICATION_ANSWERS, NOTIFICATION_EVENT_KINDS, NOTIFICATION_OPENED_VIA,
// PRODUCTION_INSTRUMENTS, ACCESS_PURPOSES, PRODUCED_KINDS, NOT_HELD_KINDS): @korbat/db does not depend on
// @korbat/contracts, so a database test holds each migrated CHECK to its constant.
const NOTIFICATION_DUTIES = ["dsa18_1", "dsa18_2", "tco14_5", "voluntary"];
const NOTIFICATION_SENT_KINDS = ["handle", "address", "created_at", "post_ids", "post_times", "report_time", "files"];
const PRODUCED_KINDS = [...NOTIFICATION_SENT_KINDS, "content"];
const NOT_HELD_KINDS = ["name", "postal_address", "date_of_birth", "phone_number", "ip_address"];
/** The values as a SQL array of string literals: plain lower-case words of this file. */
const arrayOf = (values: readonly string[]) => sql.raw(`array[${values.map((value) => `'${value}'`).join(", ")}]::text[]`);

/**
 * One notification to an authority that is owed, sent or declined (3f design, sections 6.5 and 7.13). Only the command
 * line, as the migrator, reads and writes it, and the trigger report_open() opens one when a seal is taken: the API role
 * holds no grant, and its one policy lets it see no row. No column holds an address, a handle or a value that was sent; an
 * account, a case and a seal are named by their ids, without foreign keys, since the record outlives a purge and a case.
 * opened_at is forced, except that a row with imported_at keeps a supplied time that is not after the clock.
 */
export const authorityNotifications = pgTable(
  "authority_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    state: text("state").notNull(),
    /** The duties it meets; empty while a seal's record is only owed. */
    duties: text("duties").array().notNull().default(sql`'{}'::text[]`),
    caseId: uuid("case_id"),
    /** The seal_media row that opened it; null for one the command line opened. */
    sealActionId: uuid("seal_action_id"),
    accountId: uuid("account_id"),
    openedAt: ts("opened_at").notNull(),
    openedVia: text("opened_via").notNull(),
    /** Awareness: the first suspect report's time, and the admin's answer's. */
    firstReportAt: ts("first_report_at"),
    adminAnswerAt: ts("admin_answer_at"),
    /** The check: who, when, yes or no, why. */
    checkedBy: text("checked_by"),
    checkedAt: ts("checked_at"),
    checkResult: boolean("check_result"),
    checkReason: text("check_reason"),
    /** An ISO code and why that state; or null and why none is identifiable. */
    stateConcerned: text("state_concerned"),
    stateBasis: text("state_basis"),
    authority: text("authority"),
    channel: text("channel"),
    sentAt: ts("sent_at"),
    receipt: text("receipt"),
    sentBy: text("sent_by"),
    ownReference: text("own_reference"),
    theirReference: text("their_reference"),
    /** What was sent, by kind, never by value. */
    sentKinds: text("sent_kinds").array(),
    /** Which version of the fixed sentence of what korbat does not hold went with it (RECORDS_NOT_HELD). */
    notKeptVersion: smallint("not_kept_version"),
    /** The authority's answer as one word, and its day. */
    answer: text("answer"),
    answeredAt: ts("answered_at"),
    /** `unsealed` when the database closed it; else the operator's reason. */
    declinedReason: text("declined_reason"),
    closedAt: ts("closed_at"),
    importedAt: ts("imported_at"),
  },
  (t) => [
    check("authority_notifications_state", sql`${t.state} in ('owed', 'sent', 'declined')`),
    check("authority_notifications_duties", sql`${t.duties} <@ ${arrayOf(NOTIFICATION_DUTIES)}`),
    check("authority_notifications_sent_kinds", sql`${t.sentKinds} <@ ${arrayOf(NOTIFICATION_SENT_KINDS)}`),
    check("authority_notifications_answer", sql`${t.answer} in ('not_illegal', 'illegal', 'no_assessment', 'other')`),
    check("authority_notifications_opened_via", sql`${t.openedVia} in ('system', 'cli')`),
    // A seal opens a record and names its row; the command line opens one for a duty and names no seal.
    check("authority_notifications_seal", sql`(${t.openedVia} = 'system') = (${t.sealActionId} is not null)`),
    check("authority_notifications_closed", sql`(${t.state} = 'owed') = (${t.closedAt} is null)`),
    check("authority_notifications_declined", sql`(${t.state} = 'declined') = (${t.declinedReason} is not null)`),
    check(
      "authority_notifications_sent",
      sql`${t.state} <> 'sent' or (${t.sentAt} is not null and ${t.authority} is not null and ${t.channel} is not null and ${t.sentKinds} is not null and cardinality(${t.duties}) > 0 and ${t.notKeptVersion} is not null)`,
    ),
    check("authority_notifications_answered", sql`${t.answer} is null or ${t.answeredAt} is not null`),
    check(
      "authority_notifications_texts",
      sql`char_length(${t.checkReason}) <= 500 and char_length(${t.stateBasis}) <= 500 and char_length(${t.declinedReason}) <= 500 and char_length(${t.checkedBy}) <= 200 and char_length(${t.sentBy}) <= 200 and char_length(${t.authority}) <= 200 and char_length(${t.channel}) <= 200 and char_length(${t.receipt}) <= 500 and char_length(${t.ownReference}) <= 200 and char_length(${t.theirReference}) <= 200`,
    ),
    /** One owed record a seal opened, for each account: a second seal finds it, and the trigger's lock orders the two. */
    uniqueIndex("authority_notifications_owed_seal_key").on(t.accountId).where(sql`state = 'owed' and opened_via = 'system'`),
    /** reports_owed() and the alert's count. */
    index("authority_notifications_owed_idx").on(t.openedAt).where(sql`state = 'owed'`),
    index("authority_notifications_account_idx").on(t.accountId),
    index("authority_notifications_case_idx").on(t.caseId),
    pgPolicy("authority_notifications_api_none", { for: "select", to: apiRole, using: sql`false` }),
  ],
).enableRLS();

/**
 * A later request or answer of the authority about a notification's matter, or the operator's note (7.13 step 6), with
 * the authority's demand that the person is not told and that demand's end, which may be open (null with the mark set).
 * `at` is forced, except for an imported record's event, which keeps a supplied time that is not after the clock.
 */
export const authorityNotificationEvents = pgTable(
  "authority_notification_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => authorityNotifications.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    at: ts("at").notNull(),
    /** When the request or answer was made, as the authority dated it. */
    occurredAt: ts("occurred_at"),
    reference: text("reference"),
    /** How it came and what it asked, about the act and never about the person (at most 500 characters). */
    how: text("how").notNull(),
    notToPerson: boolean("not_to_person").notNull(),
    notToPersonUntil: ts("not_to_person_until"),
  },
  (t) => [
    check("authority_notification_events_kind", sql`${t.kind} in ('request', 'answer', 'note')`),
    check("authority_notification_events_until", sql`${t.notToPerson} or ${t.notToPersonUntil} is null`),
    check("authority_notification_events_texts", sql`char_length(${t.how}) between 1 and 500 and char_length(${t.reference}) <= 200`),
    index("authority_notification_events_notification_idx").on(t.notificationId, t.at),
    pgPolicy("authority_notification_events_api_none", { for: "select", to: apiRole, using: sql`false` }),
  ],
).enableRLS();

/**
 * One row for every time something leaves korbat for an authority (3f design, sections 6.5 and 7.14): account data for
 * an order or a notification, a hand-over of one seal's files, a seizure, an access to preserved content for an
 * authority. What was asked for, produced and not held is stored by kind, never as a text; a hand-over's files by name,
 * size and SHA-256. opened_at is forced as a notification's.
 */
export const productions = pgTable(
  "productions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    instrument: text("instrument").notNull(),
    notificationId: uuid("notification_id"),
    orderId: uuid("order_id"),
    orderItemId: uuid("order_item_id"),
    sealActionId: uuid("seal_action_id"),
    accountId: uuid("account_id"),
    /** For preserved_access alone: why the content was opened. */
    purpose: text("purpose"),
    authority: text("authority"),
    ownReference: text("own_reference"),
    theirReference: text("their_reference"),
    asked: text("asked").array(),
    produced: text("produced").array().notNull(),
    notHeld: text("not_held").array(),
    /** A hand-over: each listed file's name, and once recorded its size and SHA-256. */
    files: jsonb("files").$type<{ name: string; bytes: number | null; sha256: string | null }[]>(),
    archiveSha256: text("archive_sha256"),
    channel: text("channel"),
    receipt: text("receipt"),
    deliveredAt: ts("delivered_at"),
    destroyedAt: ts("destroyed_at"),
    destroyedHow: text("destroyed_how"),
    notToPersonUntil: ts("not_to_person_until"),
    openedAt: ts("opened_at").notNull(),
    recordedBy: text("recorded_by"),
    importedAt: ts("imported_at"),
  },
  (t) => [
    check("productions_instrument", sql`${t.instrument} in ('notification', 'demand', 'court_order', 'seizure', 'dsa_art10', 'preserved_access')`),
    check("productions_purpose", sql`(${t.instrument} = 'preserved_access') = (${t.purpose} is not null)`),
    // Compared as text: 'authority' is also a value 3f added to an enum (intake_channel), and the enum-literal rule reads
    // the migrations' words, not their types.
    check("productions_purposes", sql`${t.purpose}::text in ('review', 'complaint', 'authority')`),
    check("productions_asked", sql`${t.asked} <@ ${arrayOf(NOTIFICATION_SENT_KINDS)}`),
    check("productions_produced", sql`${t.produced} <@ ${arrayOf(PRODUCED_KINDS)}`),
    check("productions_not_held", sql`${t.notHeld} <@ ${arrayOf(NOT_HELD_KINDS)}`),
    check("productions_archive", sql`${t.archiveSha256} ~ '^[0-9a-f]{64}$'`),
    check("productions_files", sql`jsonb_typeof(${t.files}) = 'array'`),
    check("productions_destroyed", sql`(${t.destroyedAt} is null) = (${t.destroyedHow} is null)`),
    check(
      "productions_texts",
      sql`char_length(${t.authority}) <= 200 and char_length(${t.ownReference}) <= 200 and char_length(${t.theirReference}) <= 200 and char_length(${t.channel}) <= 200 and char_length(${t.receipt}) <= 500 and char_length(${t.destroyedHow}) <= 500 and char_length(${t.recordedBy}) <= 200`,
    ),
    /** handover_undestroyed's count, and the records command's list. */
    index("productions_undestroyed_idx").on(t.deliveredAt).where(sql`files is not null and destroyed_at is null`),
    index("productions_account_idx").on(t.accountId),
    pgPolicy("productions_api_none", { for: "select", to: apiRole, using: sql`false` }),
  ],
).enableRLS();

// ---------------------------------------------------------------- recovery (3f design, section 6.6)
// The lists are the contracts' GAP_CLASSES and GAP_DISPOSITIONS, in the order the console and the import list them; a
// database test holds each migrated CHECK to its constant, as for the records above.
const GAP_CLASSES = ["order_effect", "seal_final", "seal_interim", "release", "standing", "restriction", "reversal", "no_measure", "record"];
const GAP_DISPOSITIONS = ["reapplied", "not_needed", "imported"];
const listOf = (values: readonly string[]) => sql.raw(values.map((value) => `'${value}'`).join(", "));

/**
 * One row for each lost decision and each lost record that an import after a restore found in the keeper's files (3f
 * design, sections 6.6 and 7.17): the lost audit row's place, hash, action, target, metadata and time, the class that
 * orders its taking again, and its closing. The API role reads it; the import writes it as the migrator, gap_close as its
 * owner, and a record command given --gap closes a gap of the class record. A gap names its closing decision by id
 * without a foreign key: the decision's statement reads the lost day from the gap for as long as the ledger keeps the
 * decision, and the fixtures that remove decisions must not be held by it.
 */
export const restoreGaps = pgTable(
  "restore_gaps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** One value for every gap one import wrote. */
    importId: uuid("import_id").notNull(),
    place: bigint("place", { mode: "number" }).notNull(),
    hash: text("hash").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type"),
    /** An order_effected row gives one gap an item, with the item as its target. */
    targetId: text("target_id"),
    metadata: jsonb("metadata"),
    actedAt: ts("acted_at").notNull(),
    /** When the import that found it ran: the console's "After a restore" names the newest import's time. */
    importedAt: ts("imported_at").notNull(),
    class: text("class").notNull(),
    closedAt: ts("closed_at"),
    /** The decision that took the measure again; null for the dispositions not_needed and imported. */
    closedBy: uuid("closed_by"),
    disposition: text("disposition"),
  },
  (t) => [
    check("restore_gaps_class", sql`${t.class} in (${listOf(GAP_CLASSES)})`),
    check("restore_gaps_disposition", sql`${t.disposition} in (${listOf(GAP_DISPOSITIONS)})`),
    // Open, or closed with a disposition; a decision names the closing exactly when it took the measure again.
    check("restore_gaps_closed", sql`(${t.closedAt} is null) = (${t.disposition} is null) and (${t.closedBy} is not null) = (${t.disposition} is not distinct from 'reapplied')`),
    check("restore_gaps_hash", sql`${t.hash} ~ '^[0-9a-f]{64}$'`),
    check("restore_gaps_place", sql`${t.place} > 0`),
    unique("restore_gaps_place_key").on(t.importId, t.place, t.targetId),
    /** The open gaps by class: the console's list, the home line and whether the app's site may open. */
    index("restore_gaps_open_idx").on(t.class).where(sql`closed_at is null`),
    fullAccess("restore_gaps_api_all", apiRole),
  ],
).enableRLS();

/**
 * The keeper's confirmations of the audit log's daily copy (3f design, sections 6.6 and 7.16): who holds the copy up to
 * which place, and when the database recorded it (forced clock_timestamp()). The mark route inserts one for a staff
 * member once the console holds the whole file; `staff.js audit-export` one under the system actor.
 */
export const copyMarks = pgTable(
  "copy_marks",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    staffId: uuid("staff_id").notNull(),
    /** The newest place the download held. */
    place: bigint("place", { mode: "number" }).notNull(),
    at: ts("at").notNull(),
  },
  (t) => [check("copy_marks_place", sql`${t.place} > 0`), fullAccess("copy_marks_api_all", apiRole)],
).enableRLS();
