import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, jsonb, pgEnum, pgPolicy, pgTable, primaryKey, smallint, text, unique, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { postMedia, postState } from "./content";
import { apiRole, fullAccess, ts, xid8 } from "./helpers";
import { profiles } from "./identity";

// Moderation cases (3c design, section 6.1). The API inserts rows; migrator-owned triggers and functions (migrations 0015
// to 0018) check them, force the columns marked "forced" whatever an insert supplied, and derive every restriction from
// them. Every table has one allow-all policy for the API role: the grants of migration 0015 do the restricting.

export const moderationTarget = pgEnum("moderation_target", ["post", "account"]);
/** Who an intake comes from: a user's report or notice, or a moderator's own finding. */
export const intakeKind = pgEnum("intake_kind", ["user", "finding"]);
export const intakeChannel = pgEnum("intake_channel", ["signed_in", "signed_out", "staff"]);
/** The state of one mail korbat owes. `failed` is final: the relay refused the address for good, or five days passed. */
export const deliveryState = pgEnum("delivery_state", ["pending", "sent", "folded", "suppressed", "no_address", "none", "failed"]);
export const itemOutcome = pgEnum("item_outcome", ["restricted_rule", "restricted_legal", "no_violation", "not_evident", "not_available", "partly_reversed", "reversed"]);
export const decisionKind = pgEnum("decision_kind", ["interim", "final", "review", "correction"]);
export const decisionOutcome = pgEnum("decision_outcome", ["restricted", "no_violation", "not_evident", "kept", "partly_reversed", "reversed"]);
export const decisionGround = pgEnum("decision_ground", ["incompatible", "illegal"]);
export const decisionSource = pgEnum("decision_source", ["notice", "report", "own_initiative"]);
/** The seven measures, then the five reversals. The view measures_in_force (migration 0015) names the measures. */
export const actionKind = pgEnum("action_kind", [
  "withhold",
  "remove",
  "seal_media",
  "withhold_media",
  "remove_media",
  "reset_display_name",
  "reset_bio",
  "restore",
  "unseal_media",
  "restore_media",
  "restore_display_name",
  "restore_bio",
]);
export const appealResult = pgEnum("appeal_result", ["kept", "partly_reversed", "reversed"]);
export const staffTextKind = pgEnum("staff_text_kind", ["facts", "reason", "legal_reference", "review_reason", "reveal_reason", "note", "seal_declined"]);
export const accessKind = pgEnum("access_kind", ["case_opened", "image_viewed", "identity_revealed"]);

// The lists below are written from the contracts' constants (TDB_CATEGORIES, CSAM_KEYWORDS, DECISION_KEYWORDS and the rule
// ids of RULE_DEFAULT_CATEGORY): @korbat/db does not depend on @korbat/contracts, so a database test holds each CHECK, as
// the migrated database defines it, to its constant. They are text under CHECK lists, never enums, because the
// Commission renames and removes Transparency Database values and an enum cannot drop one. A later migration only adds
// values to a list: a CHECK cannot drop a value that a kept row holds.
const RULE_IDS = ["R1", "R2", "R3", "R4", "R5", "R6"];
const TDB_CATEGORIES = [
  "STATEMENT_CATEGORY_ANIMAL_WELFARE",
  "STATEMENT_CATEGORY_CONSUMER_INFORMATION",
  "STATEMENT_CATEGORY_CYBER_VIOLENCE",
  "STATEMENT_CATEGORY_CYBER_VIOLENCE_AGAINST_WOMEN",
  "STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS",
  "STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH",
  "STATEMENT_CATEGORY_INTELLECTUAL_PROPERTY_INFRINGEMENTS",
  "STATEMENT_CATEGORY_NEGATIVE_EFFECTS_ON_CIVIC_DISCOURSE_OR_ELECTIONS",
  "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE",
  "STATEMENT_CATEGORY_OTHER_VIOLATION_TC",
  "STATEMENT_CATEGORY_PROTECTION_OF_MINORS",
  "STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY",
  "STATEMENT_CATEGORY_SCAMS_AND_FRAUD",
  "STATEMENT_CATEGORY_SELF_HARM",
  "STATEMENT_CATEGORY_UNSAFE_AND_PROHIBITED_PRODUCTS",
  "STATEMENT_CATEGORY_VIOLENCE",
];
const CSAM_KEYWORDS = ["KEYWORD_CHILD_SEXUAL_ABUSE_MATERIAL", "KEYWORD_CHILD_SEXUAL_ABUSE_MATERIAL_DEEPFAKE", "KEYWORD_GROOMING_SEXUAL_ENTICEMENT_MINORS"];
const DECISION_KEYWORDS = ["KEYWORD_TERRORIST_CONTENT"];

/** The values as a SQL list of string literals. They are constants of this file, plain upper-case words. */
const listOf = (values: readonly string[]) => sql.raw(values.map((value) => `'${value}'`).join(", "));

/**
 * One case per target while it is open: the partial unique index makes that a database fact under concurrency. The API
 * role may only insert and read; the trigger cases_insert forces every column but id and the target to its initial value,
 * and the derived columns move only through the triggers of intake_items (0015) and decisions (0016).
 */
export const cases = pgTable(
  "cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetType: moderationTarget("target_type").notNull(),
    /** A post's id or an account's. No foreign key: it names two tables, and posts and profiles are never deleted in production. */
    targetId: uuid("target_id").notNull(),
    /** Forced: now(). */
    openedAt: ts("opened_at").notNull(),
    /** The most severe lane of the case's unanswered items: 0 is the most urgent. */
    lane: smallint("lane").notNull().default(2),
    /** The number the newest item got; items are numbered from 1 in the order they attached. */
    intakeSeq: integer("intake_seq").notNull().default(0),
    /** The number of the last item a final decision answered. */
    answeredSeq: integer("answered_seq").notNull().default(0),
    /** Moves with every decision: a decision names the version its moderator saw and is refused when another landed since. */
    stateVersion: integer("state_version").notNull().default(0),
    /** When the oldest unanswered item arrived; null when every item is answered. */
    oldestOpenAt: ts("oldest_open_at"),
    lastDecidedAt: ts("last_decided_at"),
    closedAt: ts("closed_at"),
  },
  (t) => [
    check("cases_lane", sql`${t.lane} between 0 and 2`),
    check("cases_seq_order", sql`${t.answeredSeq} <= ${t.intakeSeq}`),
    check("cases_closed_answered", sql`${t.closedAt} is null or ${t.answeredSeq} = ${t.intakeSeq}`),
    uniqueIndex("cases_one_open_per_target").on(t.targetType, t.targetId).where(sql`closed_at is null`),
    /** The queue: open cases by lane, then by their oldest unanswered item, read without a sort. */
    index("cases_queue_idx").on(t.lane, t.oldestOpenAt).where(sql`closed_at is null`),
    index("cases_target_idx").on(t.targetType, t.targetId, t.openedAt),
    fullAccess("cases_api_all", apiRole),
  ],
).enableRLS();

/**
 * One report, one Article 16 notice or one moderator's own finding. The API role may insert and read, and update only the
 * receipt's state; the trigger intakes_insert forces received_at, erased_at, receipt_sent_at and receipt. A notifier's name
 * and address are not here: contact_id names a row of auth.notifier_contacts, which the API role cannot reach.
 */
export const intakes = pgTable(
  "intakes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: intakeKind("kind").notNull(),
    /** The public reference printed on screens and mails, made by the API: N- and ten base32 characters. */
    ref: text("ref").notNull().unique(),
    /** The sha256 hex of the notice's token, for a signed-out notice and for every notice on the CSAM path. */
    lookupHash: text("lookup_hash").unique(),
    channel: intakeChannel("channel").notNull(),
    reporterId: uuid("reporter_id").references(() => profiles.id, { onDelete: "set null" }),
    /** The staff account behind a finding. On delete restrict: the record of who opened a finding stays. */
    findingBy: uuid("finding_by").references(() => profiles.id, { onDelete: "restrict" }),
    /** The auth-side contact's id. No foreign key, as profiles.id has none to auth.users. */
    contactId: uuid("contact_id"),
    ruleId: text("rule_id"),
    allegesIllegal: boolean("alleges_illegal").notNull().default(false),
    /** The path for suspected child sexual abuse material: no account and no contact is ever stored with it. */
    csam: boolean("csam").notNull().default(false),
    /** One of the Transparency Database's categories. */
    category: text("category").notNull(),
    /** Null for the CSAM path's "abuse" choice, for which the Transparency Database has no keyword. */
    categoryKeyword: text("category_keyword"),
    citedLaw: text("cited_law"),
    explanation: text("explanation"),
    bonaFide: boolean("bona_fide").notNull().default(false),
    /** False in 3c; disclosed in the decision when true (Digital Services Act, Article 16(6)). */
    automatedProcessing: boolean("automated_processing").notNull().default(false),
    /** Forced: now(). */
    receivedAt: ts("received_at").notNull(),
    /** Forced at insert: pending when a contact or (a signed-in reporter alleging illegality) can be mailed, else none. */
    receipt: deliveryState("receipt").notNull().default("none"),
    receiptSentAt: ts("receipt_sent_at"),
    /** Set when the intake record (explanation, cited law, who sent it) was erased. */
    erasedAt: ts("erased_at"),
  },
  (t) => [
    check("intakes_ref", sql`${t.ref} ~ '^N-[A-Z2-7]{10}$'`),
    check("intakes_rule_id", sql`${t.ruleId} in (${listOf(RULE_IDS)})`),
    check("intakes_category", sql`${t.category} in (${listOf(TDB_CATEGORIES)})`),
    check("intakes_category_keyword", sql`${t.categoryKeyword} in (${listOf(CSAM_KEYWORDS)})`),
    check("intakes_cited_law_len", sql`char_length(${t.citedLaw}) <= 300`),
    check("intakes_explanation_len", sql`char_length(${t.explanation}) <= 2000`),
    check("intakes_has_ground", sql`${t.ruleId} is not null or ${t.allegesIllegal} or ${t.csam}`),
    // A user's notice of illegality carries its explanation (until the record is erased) and its good-faith statement; the
    // CSAM path is exempt (Article 16(2)(c)).
    check("intakes_illegal_elements", sql`${t.kind} <> 'user' or not ${t.allegesIllegal} or ${t.csam} or (${t.bonaFide} and (${t.explanation} is not null or ${t.erasedAt} is not null))`),
    // A moderator's own finding never alleges illegality in 3c.
    check("intakes_finding_legal", sql`${t.kind} <> 'finding' or not ${t.allegesIllegal}`),
    check("intakes_illegal_not_tc", sql`not ${t.allegesIllegal} or ${t.category} <> 'STATEMENT_CATEGORY_OTHER_VIOLATION_TC'`),
    check("intakes_csam", sql`not ${t.csam} or (${t.category} = 'STATEMENT_CATEGORY_PROTECTION_OF_MINORS' and ${t.reporterId} is null and ${t.contactId} is null)`),
    check("intakes_contact_signed_out", sql`${t.contactId} is null or ${t.channel} = 'signed_out'`),
    check("intakes_reporter_signed_in", sql`${t.reporterId} is null or ${t.channel} = 'signed_in'`),
    check("intakes_finding", sql`(${t.kind} = 'finding') = (${t.findingBy} is not null) and (${t.kind} = 'finding') = (${t.channel} = 'staff')`),
    check("intakes_lookup", sql`(${t.lookupHash} is not null) = (${t.channel} = 'signed_out' or ${t.csam})`),
    check("intakes_erased", sql`${t.erasedAt} is null or (${t.explanation} is null and ${t.citedLaw} is null)`),
    // No user reports under R2: only a moderator's finding cites it, so no report of such material carries an account.
    check("intakes_r2_finding_only", sql`${t.ruleId} is distinct from 'R2' or ${t.kind} = 'finding'`),
    index("intakes_reporter_idx").on(t.reporterId, t.receivedAt),
    /** The findings limit and the home screen's count. */
    index("intakes_finding_idx").on(t.findingBy, t.receivedAt),
    /** The retention job's candidates. */
    index("intakes_unerased_idx").on(t.receivedAt).where(sql`erased_at is null`),
    fullAccess("intakes_api_all", apiRole),
  ],
).enableRLS();

/**
 * One target of an intake, in exactly one case, or in none when its link names nothing live. The trigger
 * intake_items_attach forces the columns marked forced, numbers the item into its open case and refuses a closed one; the
 * API role may insert and read, and update only outcome_mail.
 */
export const intakeItems = pgTable(
  "intake_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    intakeId: uuid("intake_id").notNull().references(() => intakes.id, { onDelete: "restrict" }),
    /** 1 to 10: the targets the sender named. 11 to 20: an item korbat added for a quoted post, at its origin's position plus 10. */
    position: smallint("position").notNull(),
    targetType: moderationTarget("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    /** The image the reporter pointed at: a hint. */
    mediaId: uuid("media_id"),
    /** For an account, the handle as the notice or finding named it, in lower case; forced null for a post. */
    namedHandle: text("named_handle"),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "restrict" }),
    /** Forced: the item's number in its case. */
    seq: integer("seq"),
    lane: smallint("lane").notNull(),
    /** Forced, copied from the intake. */
    reporterAccountId: uuid("reporter_account_id"),
    /** Forced, copied from the intake. */
    allegesIllegal: boolean("alleges_illegal").notNull().default(false),
    /** Forced: its intake is on the CSAM path or cites R2. The default is there so that no insert must name a forced column. */
    suspect: boolean("suspect").notNull().default(false),
    /** Forced: now(). */
    createdAt: ts("created_at").notNull(),
    /** What the answering decision found, written once by it, or not_available at insert for an item without a case. */
    outcome: itemOutcome("outcome"),
    answeredBy: uuid("answered_by").references((): AnyPgColumn => decisions.id),
    /** The release: when the outcome was first shown to whoever sent the item. */
    outcomeSentAt: ts("outcome_sent_at"),
    /** What the notifier or reporter is shown. */
    shownOutcome: itemOutcome("shown_outcome"),
    /** Set when a review or correction reverses a measure of the answering decision; cleared by the release. */
    revisionPendingAt: ts("revision_pending_at"),
    revisedSentAt: ts("revised_sent_at"),
    /** Forced at insert. */
    outcomeMail: deliveryState("outcome_mail").notNull().default("none"),
    /** Set on a re-examination: the item it re-examines. */
    reexaminesItemId: uuid("reexamines_item_id").references((): AnyPgColumn => intakeItems.id),
    /** A re-examination's statement, with the salt and digest the server made (the contracts' textDigest). */
    statement: text("statement"),
    statementSalt: text("statement_salt"),
    statementDigest: text("statement_digest"),
    erasedAt: ts("erased_at"),
  },
  (t) => [
    check("intake_items_position", sql`${t.position} between 1 and 20`),
    check("intake_items_lane", sql`${t.lane} between 0 and 2`),
    // An item has a case and a number, or neither; without a case it is answered at once, "not available". The outcome
    // is compared null-safely: a check passes on a null, and an item without a case and without an outcome must not.
    check("intake_items_case", sql`(${t.caseId} is null) = (${t.seq} is null) and (${t.caseId} is not null or ${t.outcome} is not distinct from 'not_available')`),
    check("intake_items_shown", sql`${t.shownOutcome} is null or ${t.outcomeSentAt} is not null`),
    // An account item always carries the handle it was named by, a post item never.
    check("intake_items_named_handle", sql`(${t.targetType} = 'account') = (${t.namedHandle} is not null)`),
    check("intake_items_statement_len", sql`char_length(${t.statement}) <= 2000`),
    // Only a re-examination has a statement, in one of three states: none; a statement held to its digest; erased
    // (statement and salt null, the digest kept, erased_at set). A statement without a digest is refused by name: the
    // comparison alone would be null for it, and a check passes on a null.
    check(
      "intake_items_statement",
      sql`(${t.statementDigest} is null or ${t.reexaminesItemId} is not null) and (${t.statement} is null) = (${t.statementSalt} is null) and (${t.statement} is null or (${t.erasedAt} is null and ${t.statementSalt} ~ '^[0-9a-f]{64}$' and ${t.statementDigest} is not null and ${t.statementDigest} = encode(sha256(convert_to('korbat.text.v1', 'UTF8') || decode('0a', 'hex') || decode(${t.statementSalt}, 'hex') || convert_to(${t.statement}, 'UTF8')), 'hex'))) and (${t.statement} is not null or ${t.statementDigest} is null or ${t.erasedAt} is not null) and (${t.statementDigest} is null or ${t.statementDigest} ~ '^[0-9a-f]{64}$')`,
    ),
    /** A notice names a target once. The trigger intake_items_quote reads an intake's items through this index. */
    uniqueIndex("intake_items_target_once").on(t.intakeId, t.targetType, t.targetId).where(sql`reexamines_item_id is null`),
    /** An item is re-examined once. */
    uniqueIndex("intake_items_reexamines_once").on(t.reexaminesItemId).where(sql`reexamines_item_id is not null`),
    uniqueIndex("intake_items_case_seq_idx").on(t.caseId, t.seq),
    /** One item per signed-in reporter, case and ground; signed-out notifiers, whose column is null, are never merged. */
    uniqueIndex("intake_items_reporter_once").on(t.caseId, t.reporterAccountId, t.allegesIllegal).where(sql`reexamines_item_id is null`),
    index("intake_items_answered_by_idx").on(t.answeredBy),
    /** The freeze's probe: the unanswered suspect items of a case. */
    index("intake_items_suspect_open_idx").on(t.caseId).where(sql`suspect and answered_by is null`),
    index("intake_items_revision_idx").on(t.revisionPendingAt).where(sql`revision_pending_at is not null`),
    fullAccess("intake_items_api_all", apiRole),
  ],
).enableRLS();

/**
 * A decision is the statement of reasons: every element of Article 17(3) is a column, in the Transparency Database's
 * shape. The API role may insert and read, and update only the author's mail state. The triggers of migration 0016 force
 * the columns marked forced and check the rest.
 */
export const decisions = pgTable(
  "decisions",
  {
    /** The API may supply it. */
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "restrict" }),
    kind: decisionKind("kind").notNull(),
    /** Set on a review and on a correction: the decision it reverses measures of. */
    reviewsDecisionId: uuid("reviews_decision_id").references((): AnyPgColumn => decisions.id),
    /** Forced: a review's one appeal. */
    appealId: uuid("appeal_id").references((): AnyPgColumn => appeals.id),
    seenStateVersion: integer("seen_state_version").notNull(),
    /** A final decision answers the items up to this number; 0 for an interim one. */
    throughSeq: integer("through_seq").notNull().default(0),
    /** Forced. */
    answersFromSeq: integer("answers_from_seq"),
    outcome: decisionOutcome("outcome").notNull(),
    ground: decisionGround("ground"),
    ruleId: text("rule_id"),
    rulesVersion: smallint("rules_version").notNull(),
    redressVersion: smallint("redress_version").notNull(),
    category: text("category").notNull(),
    categoryKeyword: text("category_keyword"),
    /** Forced. */
    source: decisionSource("source").notNull(),
    /** Forced to false in 3c. */
    automatedDetection: boolean("automated_detection").notNull().default(false),
    /** Forced to not_automated in 3c. */
    automatedDecision: text("automated_decision").notNull().default("not_automated"),
    /** korbat cannot restrict by country. */
    territorialScope: text("territorial_scope").notNull().default("worldwide"),
    snapshotId: uuid("snapshot_id").notNull().references(() => evidenceSnapshots.id, { onDelete: "restrict" }),
    /** The digest the console computed from what it displayed. */
    snapshotDigest: text("snapshot_digest").notNull(),
    /** Each names a saved staff text by its salted digest: the chain holds the digest, never the text. */
    factsDigest: text("facts_digest"),
    reasonDigest: text("reason_digest"),
    legalReferenceDigest: text("legal_reference_digest"),
    /** The staff account. */
    decidedBy: uuid("decided_by").notNull().references(() => profiles.id, { onDelete: "restrict" }),
    /** Forced. */
    decidedAt: ts("decided_at").notNull(),
    /** Forced: pg_current_xact_id(). Compared together with decided_at, since a restore restarts the counter. */
    xact: xid8("xact").notNull(),
    /** Forced: 32 random hex characters, the Transparency Database's platform id, never the internal id. */
    puid: text("puid").notNull().unique(),
    /** Forced equal to decided_at: the author's case screen shows the statement at commit. */
    informedAt: ts("informed_at").notNull(),
    /** Forced: the decision is taken on a case that holds, or answers, a suspect item. */
    suspect: boolean("suspect").notNull(),
    /** Forced: true for a final decision on a post case taken while the post was frozen, so that nobody could open its images. */
    unseen: boolean("unseen").notNull().default(false),
    /** Forced. */
    needsAdmin: boolean("needs_admin").notNull(),
    /** Forced. */
    endedInterim: boolean("ended_interim").notNull(),
    /** Forced at insert. */
    authorMail: deliveryState("author_mail").notNull().default("none"),
    authorMailAt: ts("author_mail_at"),
    /** The R4 redaction. */
    redactedAt: ts("redacted_at"),
  },
  (t) => [
    check("decisions_rule_id", sql`${t.ruleId} in (${listOf(RULE_IDS)})`),
    check("decisions_category", sql`${t.category} in (${listOf(TDB_CATEGORIES)})`),
    check("decisions_category_keyword", sql`${t.categoryKeyword} in (${listOf(DECISION_KEYWORDS)})`),
    check("decisions_automated_decision", sql`${t.automatedDecision} in ('fully', 'partially', 'not_automated')`),
    check("decisions_territorial_scope", sql`${t.territorialScope} = 'worldwide'`),
    check("decisions_review_target", sql`(${t.kind} in ('review', 'correction')) = (${t.reviewsDecisionId} is not null) and (${t.kind} = 'review') = (${t.appealId} is not null)`),
    check("decisions_interim", sql`${t.kind} <> 'interim' or ${t.throughSeq} = 0`),
    check("decisions_ground_rule", sql`${t.ground} is distinct from 'incompatible' or ${t.ruleId} is not null`),
    check("decisions_ground_law", sql`${t.ground} is distinct from 'illegal' or ${t.legalReferenceDigest} is not null`),
    check("decisions_restricted", sql`${t.outcome} <> 'restricted' or (${t.ground} is not null and ${t.factsDigest} is not null and ${t.reasonDigest} is not null)`),
    check(
      "decisions_digests",
      sql`(${t.factsDigest} is null or ${t.factsDigest} ~ '^[0-9a-f]{64}$') and (${t.reasonDigest} is null or ${t.reasonDigest} ~ '^[0-9a-f]{64}$') and (${t.legalReferenceDigest} is null or ${t.legalReferenceDigest} ~ '^[0-9a-f]{64}$')`,
    ),
    // Null-safe: a decision without a ground carries no keyword either.
    check("decisions_keyword", sql`${t.categoryKeyword} is null or ${t.ground} is not distinct from 'illegal'`),
    // A decision on the law cites no korbat rule.
    check("decisions_law_no_rule", sql`${t.ground} is distinct from 'illegal' or ${t.ruleId} is null`),
    // A review or correction states no ground of its own, and renders its reviewed decision's.
    check(
      "decisions_reversal_plain",
      sql`${t.kind} not in ('review', 'correction') or (${t.ground} is null and ${t.ruleId} is null and ${t.categoryKeyword} is null and ${t.factsDigest} is null and ${t.legalReferenceDigest} is null)`,
    ),
    index("decisions_case_decided_idx").on(t.caseId, t.decidedAt),
    /** The caps count a staff account's decisions by time. */
    index("decisions_decided_by_idx").on(t.decidedBy, t.decidedAt),
    index("decisions_reviews_idx").on(t.reviewsDecisionId),
    uniqueIndex("decisions_appeal_once").on(t.appealId).where(sql`appeal_id is not null`),
    fullAccess("decisions_api_all", apiRole),
  ],
).enableRLS();

/**
 * The ledger: every measure and every reversal is a row, inserted only in the transaction of its own confirmed decision,
 * and never changed. A measure is in force while no row reverses it (and, for an interim measure, as the view
 * measures_in_force says). The API role may insert and read.
 */
export const decisionActions = pgTable(
  "decision_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    decisionId: uuid("decision_id").notNull().references(() => decisions.id, { onDelete: "restrict" }),
    kind: actionKind("kind").notNull(),
    /** Image measures and their reversals. */
    mediaId: uuid("media_id"),
    /** Forced: the post's author or the account. */
    subjectAccountId: uuid("subject_account_id").notNull(),
    /** Forced for post and image measures and their reversals; null for a seal, whose posts seal_posts lists. */
    postId: uuid("post_id"),
    /** Forced for reversals: the one measure it lifts. */
    reversesActionId: uuid("reverses_action_id").references((): AnyPgColumn => decisionActions.id),
    /** Forced for measures: null when the measure changed what someone sees; already or deleted when it did not. */
    noEffect: text("no_effect"),
    /** Forced. */
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    check("decision_actions_no_effect", sql`${t.noEffect} in ('already', 'deleted')`),
    // Nulls not distinct: a decision holds a measure without an image (a post measure, a seal, a field reset) once too.
    unique("decision_actions_once").on(t.decisionId, t.kind, t.mediaId).nullsNotDistinct(),
    /** A measure is lifted at most once. */
    uniqueIndex("decision_actions_reversed_once").on(t.reversesActionId).where(sql`reverses_action_id is not null`),
    /** The in-force reads. */
    index("decision_actions_post_kind_idx").on(t.postId, t.kind),
    index("decision_actions_subject_kind_idx").on(t.subjectAccountId, t.kind),
    fullAccess("decision_actions_api_all", apiRole),
  ],
).enableRLS();

/**
 * Part of the ledger: one row for each post whose images a seal_media measure seals, with the number of image rows the
 * post had when the measure was recorded. Only a migrator-owned trigger writes it (0016), from the image rows it locked,
 * so no caller chooses a seal's list; the API role may only read.
 */
export const sealPosts = pgTable(
  "seal_posts",
  {
    actionId: uuid("action_id").notNull().references(() => decisionActions.id, { onDelete: "restrict" }),
    /** No foreign key, as a case's target has none. */
    postId: uuid("post_id").notNull(),
    images: smallint("images").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.actionId, t.postId] }),
    check("seal_posts_images", sql`${t.images} > 0`),
    /** The freeze's probe: is this post listed by a seal. */
    index("seal_posts_post_idx").on(t.postId),
    fullAccess("seal_posts_api_all", apiRole),
  ],
).enableRLS();

/** The author's appeal of a final restriction: one per decision. The API role may insert and read. */
export const appeals = pgTable(
  "appeals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    decisionId: uuid("decision_id").notNull().references((): AnyPgColumn => decisions.id, { onDelete: "restrict" }),
    /** The decision's subject. */
    appellantAccountId: uuid("appellant_account_id").notNull(),
    /** Optional and free of form, with the salt and digest the server made (the contracts' textDigest). */
    statement: text("statement"),
    statementSalt: text("statement_salt"),
    statementDigest: text("statement_digest"),
    /** Forced. */
    filedAt: ts("filed_at").notNull(),
    answeredBy: uuid("answered_by").references((): AnyPgColumn => decisions.id),
    result: appealResult("result"),
    answeredAt: ts("answered_at"),
    erasedAt: ts("erased_at"),
  },
  (t) => [
    check("appeals_statement_len", sql`char_length(${t.statement}) <= 2000`),
    // The three states of intake_items_statement: no statement; a statement held to its digest, which it must have;
    // erased, the digest kept.
    check(
      "appeals_statement",
      sql`(${t.statement} is null) = (${t.statementSalt} is null) and (${t.statement} is null or (${t.erasedAt} is null and ${t.statementSalt} ~ '^[0-9a-f]{64}$' and ${t.statementDigest} is not null and ${t.statementDigest} = encode(sha256(convert_to('korbat.text.v1', 'UTF8') || decode('0a', 'hex') || decode(${t.statementSalt}, 'hex') || convert_to(${t.statement}, 'UTF8')), 'hex'))) and (${t.statement} is not null or ${t.statementDigest} is null or ${t.erasedAt} is not null) and (${t.statementDigest} is null or ${t.statementDigest} ~ '^[0-9a-f]{64}$')`,
    ),
    uniqueIndex("appeals_once").on(t.decisionId),
    /** The pending appeals. */
    index("appeals_pending_idx").on(t.decisionId).where(sql`answered_by is null`),
    /** The statements still to erase: the retention job's candidates. */
    index("appeals_statement_idx").on(t.decisionId).where(sql`statement is not null`),
    fullAccess("appeals_api_all", apiRole),
  ],
).enableRLS();

/**
 * Every free text a decision, a review or a reveal carries, and a case's notes: saved first, salted and digested, so
 * that what a staff key confirms is the digest and the audit chain never holds readable text. Erasure nulls the text and
 * the salt and keeps the digest. The API role may insert and read.
 */
export const staffTexts = pgTable(
  "staff_texts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "restrict" }),
    authorId: uuid("author_id").notNull().references(() => profiles.id, { onDelete: "restrict" }),
    kind: staffTextKind("kind").notNull(),
    text: text("text"),
    salt: text("salt"),
    digest: text("digest").notNull().unique(),
    /** Forced: now(). */
    createdAt: ts("created_at").notNull(),
    /** Forced null at insert; set when a confirmed decision names the digest. */
    decisionId: uuid("decision_id").references((): AnyPgColumn => decisions.id),
    /** Forced null at insert; a text is confirmed when this is set. */
    confirmedAt: ts("confirmed_at"),
    erasedAt: ts("erased_at"),
  },
  (t) => [
    // An outer bound in code points. The API holds a text to 5000 UTF-16 units, which is never more code points.
    check("staff_texts_text_len", sql`char_length(${t.text}) <= 5000`),
    // A text is stored with its salt, 32 bytes as lower-case hex as the statement checks have it, and held to its digest,
    // or erased with neither.
    check(
      "staff_texts_digest",
      sql`(${t.text} is null) = (${t.salt} is null) and (${t.text} is null) = (${t.erasedAt} is not null) and (${t.text} is null or (${t.salt} ~ '^[0-9a-f]{64}$' and ${t.digest} = encode(sha256(convert_to('korbat.text.v1', 'UTF8') || decode('0a', 'hex') || decode(${t.salt}, 'hex') || convert_to(${t.text}, 'UTF8')), 'hex')))`,
    ),
    /** A moderator's drafts, and the retention job's candidates: a note is never confirmed, so an erased one must leave the index. */
    index("staff_texts_open_idx").on(t.caseId, t.authorId).where(sql`confirmed_at is null and erased_at is null`),
    fullAccess("staff_texts_api_all", apiRole),
  ],
).enableRLS();

/**
 * Evidence by copy: what a post or a profile held when it was reported, with a server-made salt and digest. Append-only
 * for the API role; erasure (the content columns and the salt null, the digest kept) goes through a function of 0018.
 */
export const evidenceSnapshots = pgTable(
  "evidence_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "restrict" }),
    targetType: moderationTarget("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    /** Forced: the transaction's start to the millisecond, as JavaScript reads times. */
    takenAt: ts("taken_at").notNull(),
    /** The post's author or the account, at capture. */
    authorHandle: text("author_handle").notNull(),
    postState: postState("post_state"),
    postCreatedAt: ts("post_created_at"),
    replyToId: uuid("reply_to_id"),
    quoteOfId: uuid("quote_of_id"),
    body: text("body"),
    /** The post's images in position order. An alt text is null for an image that was erased. */
    media: jsonb("media").$type<{ id: string; alt: string | null; width: number; height: number }[]>(),
    displayName: text("display_name"),
    bio: text("bio"),
    handle: text("handle"),
    salt: text("salt"),
    /** Computed by the API (the contracts' snapshotDigest) and checked by the console; SQL never recomputes it. */
    digest: text("digest").notNull(),
    erasedAt: ts("erased_at"),
  },
  (t) => [
    check("evidence_erased", sql`${t.erasedAt} is null or (${t.body} is null and ${t.media} is null and ${t.displayName} is null and ${t.bio} is null and ${t.salt} is null)`),
    index("evidence_snapshots_case_taken_idx").on(t.caseId, t.takenAt),
    /** Every snapshot of a post in any case. */
    index("evidence_snapshots_target_idx").on(t.targetType, t.targetId),
    /** The retention job's candidates. */
    index("evidence_snapshots_unerased_idx").on(t.caseId).where(sql`erased_at is null`),
    fullAccess("evidence_snapshots_api_all", apiRole),
  ],
).enableRLS();

/** Who opened which case, viewed which image or revealed which source, and when. The API role may insert and read. */
export const caseAccessLog = pgTable(
  "case_access_log",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    staffId: uuid("staff_id").notNull().references(() => profiles.id, { onDelete: "restrict" }),
    caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "restrict" }),
    kind: accessKind("kind").notNull(),
    mediaId: uuid("media_id"),
    intakeItemId: uuid("intake_item_id"),
    /** A reveal's reason. */
    textId: uuid("text_id"),
    /** Forced: now(). */
    at: ts("at").notNull(),
  },
  (t) => [
    index("case_access_log_staff_idx").on(t.staffId, t.at),
    index("case_access_log_case_idx").on(t.caseId, t.at),
    /** The home screen's list of reveals. */
    index("case_access_log_reveals_idx").on(t.at).where(sql`kind = 'identity_revealed'`),
    fullAccess("case_access_log_api_all", apiRole),
  ],
).enableRLS();

/**
 * The limits on staff, one row that only `staff.js limits` changes, as the migrator: the API role reads it and nothing
 * more. Every reader falls back to the defaults when the row is missing.
 */
export const moderationLimits = pgTable(
  "moderation_limits",
  {
    id: smallint("id").primaryKey(),
    decisionsPerHour: integer("decisions_per_hour").notNull(),
    decisionsPerDay: integer("decisions_per_day").notNull(),
    caseOpensPerDay: integer("case_opens_per_day").notNull(),
    findingsPerDay: integer("findings_per_day").notNull(),
    revealsPerDay: integer("reveals_per_day").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [check("moderation_limits_single_row", sql`${t.id} = 1`), pgPolicy("moderation_limits_api_select", { for: "select", to: apiRole, using: sql`true` })],
).enableRLS();

/**
 * A case's evidence hold on an image row (the media module's table in the API; defined here beside cases, which it
 * references). The trigger media_holds_apply keeps post_media.hold_until at the latest end of the image's unreleased
 * holds, and a row with a hold in force is skipped by every delete. The history goes with a row the disposal deletes.
 * The API role may insert and read; release goes through a function of 0018.
 */
export const mediaHolds = pgTable(
  "media_holds",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    mediaId: uuid("media_id").notNull().references(() => postMedia.id, { onDelete: "cascade" }),
    caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "restrict" }),
    /** Forced: now(). */
    heldAt: ts("held_at").notNull(),
    /** Null: until released. */
    until: ts("until"),
    /** Forced null at insert. */
    releasedAt: ts("released_at"),
  },
  (t) => [
    index("media_holds_media_idx").on(t.mediaId).where(sql`released_at is null`),
    index("media_holds_case_idx").on(t.caseId).where(sql`released_at is null`),
    fullAccess("media_holds_api_all", apiRole),
  ],
).enableRLS();
