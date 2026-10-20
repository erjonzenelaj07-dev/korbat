import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, integer, jsonb, pgEnum, pgPolicy, pgTable, primaryKey, real, smallint, text, unique, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { postMedia, postState } from "./content";
import { apiRole, fullAccess, ts, xid8 } from "./helpers";
import { profiles } from "./identity";
import { contactMessages } from "./safety";

// Moderation cases (3c design, section 6.1). The API inserts rows; migrator-owned triggers and functions (migrations 0015
// to 0018) check them, force the columns marked "forced" whatever an insert supplied, and derive every restriction from
// them. Every table has one allow-all policy for the API role: the grants of migration 0015 do the restricting.

export const moderationTarget = pgEnum("moderation_target", ["post", "account"]);
/** Who an intake comes from: a user's report or notice, or a moderator's own finding; 3f: an authority's order. */
// 3d (design, section 6.6): `automated`, a program's finding, and the channel `system` it arrives on. The migration that adds
// them names each as an enum literal only inside PL/pgSQL bodies; every CHECK compares the kind and the channel as text.
export const intakeKind = pgEnum("intake_kind", ["user", "finding", "order", "automated"]);
export const intakeChannel = pgEnum("intake_channel", ["signed_in", "signed_out", "staff", "authority", "system"]);
/** The state of one mail korbat owes. `failed` is final: the relay refused the address for good, or five days passed. */
export const deliveryState = pgEnum("delivery_state", ["pending", "sent", "folded", "suppressed", "no_address", "none", "failed"]);
export const itemOutcome = pgEnum("item_outcome", ["restricted_rule", "restricted_legal", "no_violation", "not_evident", "not_available", "partly_reversed", "reversed"]);
/** 3f: `order`, the decision that gives effect to one item of an authority's order. */
export const decisionKind = pgEnum("decision_kind", ["interim", "final", "review", "correction", "order"]);
export const decisionOutcome = pgEnum("decision_outcome", ["restricted", "no_violation", "not_evident", "kept", "partly_reversed", "reversed"]);
export const decisionGround = pgEnum("decision_ground", ["incompatible", "illegal"]);
export const decisionSource = pgEnum("decision_source", ["notice", "report", "own_initiative", "order"]);
/**
 * 3c's seven measures and five reversals, then 3e's six measures and four reversals (3e design, section 6.1), in the order
 * the migrations added them. The view measures_in_force names the measures. A value of 3e is named as an enum literal
 * only inside a PL/pgSQL body: anywhere else in the migration that adds it, it compares as text (enum-literals.test.ts).
 */
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
  "strike",
  "suspend",
  "terminate",
  "retire_handle",
  "warn_reporting",
  "restrict_reporting",
  "overrule",
  "lift_suspension",
  "unretire_handle",
  "lift_reporting",
  // 3f (design, section 6.2): the measure of an order decision and its reversal. As 3e's, each is an enum literal only
  // inside a PL/pgSQL body of the migration that adds it (enum-literals.test.ts).
  "disable_by_order",
  "reinstate_by_order",
]);

/**
 * What a standing measure or a restriction of reporting rests on (3e design, section 6.1), forced by the ledger's check
 * trigger. Written from the contracts' STANDING_BASES, which a test holds the migrated CHECK to.
 */
const STANDING_BASES = ["strikes", "threat", "terrorist", "flood", "protective", "threat_repeat", "ladder_end", "reports"];
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
    // 3d (6.6): an automated intake alone may cite no rule: the flag of a match whose class its source does not name child
    // sexual abuse material (review ruling 3).
    check("intakes_has_ground", sql`${t.ruleId} is not null or ${t.allegesIllegal} or ${t.csam} or ${t.kind}::text = 'automated'`),
    // A user's notice of illegality carries its explanation (until the record is erased) and its good-faith statement; the
    // CSAM path is exempt (Article 16(2)(c)).
    check("intakes_illegal_elements", sql`${t.kind} <> 'user' or not ${t.allegesIllegal} or ${t.csam} or (${t.bonaFide} and (${t.explanation} is not null or ${t.erasedAt} is not null))`),
    // A moderator's own finding never alleges illegality in 3c.
    check("intakes_finding_legal", sql`${t.kind} <> 'finding' or not ${t.allegesIllegal}`),
    check("intakes_illegal_not_tc", sql`not ${t.allegesIllegal} or ${t.category} <> 'STATEMENT_CATEGORY_OTHER_VIOLATION_TC'`),
    check("intakes_csam", sql`not ${t.csam} or (${t.category} = 'STATEMENT_CATEGORY_PROTECTION_OF_MINORS' and ${t.reporterId} is null and ${t.contactId} is null)`),
    check("intakes_contact_signed_out", sql`${t.contactId} is null or ${t.channel} = 'signed_out'`),
    check("intakes_reporter_signed_in", sql`${t.reporterId} is null or ${t.channel} = 'signed_in'`),
    // 3d (6.6): a program's finding, and only one, arrives on the channel system.
    check("intakes_finding", sql`(${t.kind} = 'finding') = (${t.findingBy} is not null) and (${t.kind} = 'finding') = (${t.channel} = 'staff') and (${t.kind}::text = 'automated') = (${t.channel}::text = 'system')`),
    check("intakes_lookup", sql`(${t.lookupHash} is not null) = (${t.channel} = 'signed_out' or ${t.csam})`),
    check("intakes_erased", sql`${t.erasedAt} is null or (${t.explanation} is null and ${t.citedLaw} is null)`),
    // No user reports under R2: only a moderator's finding cites it, so no report of such material carries an account.
    // 3d (6.6): or a program's finding on a match the source lists as child sexual abuse material.
    check("intakes_r2_finding_only", sql`${t.ruleId} is distinct from 'R2' or ${t.kind}::text in ('finding', 'automated')`),
    // 3d (6.6): a program's finding is automated processing, cites R1, R2 or no rule, alleges no illegality, is on no path
    // for child sexual abuse material, and has no reporter, no contact and no staff account behind it.
    check(
      "intakes_automated",
      sql`${t.kind}::text <> 'automated' or (${t.automatedProcessing} and (${t.ruleId} is null or ${t.ruleId} in ('R1', 'R2')) and not ${t.allegesIllegal} and not ${t.csam} and ${t.reporterId} is null and ${t.contactId} is null and ${t.findingBy} is null)`,
    ),
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
    /** Forced (3d, 6.6): true without a decider, and for a person's decision that considers a program's finding. */
    automatedDetection: boolean("automated_detection").notNull().default(false),
    /** Forced (3d, 6.6): fully without a decider; partially for a restriction on a suspect program's finding under R2; else not_automated. */
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
    /**
     * The staff account; 3d (design, section 2 row 14, 6.6): null for a program's decision, which is always interim and
     * fully automated (decisions_decider). No profile stands for the system.
     */
    decidedBy: uuid("decided_by").references(() => profiles.id, { onDelete: "restrict" }),
    /** Forced. */
    decidedAt: ts("decided_at").notNull(),
    /** Forced: pg_current_xact_id(). Compared together with decided_at, since a restore restarts the counter. */
    xact: xid8("xact").notNull(),
    /** Forced: 32 random hex characters, the Transparency Database's platform id, never the internal id. */
    puid: text("puid").notNull().unique(),
    /**
     * Forced equal to decided_at: the author's case screen shows the statement at commit. 3f: null while the author is not
     * told (an order's held notice, and every decision held with it), which decisions_informed allows only with no mail
     * pending; every author-side read takes the fragment toldToAuthor, both halves.
     */
    informedAt: ts("informed_at"),
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
    /** 3f: the item of an authority's order that an `order` decision gives effect to; null for every other decision. */
    orderItemId: uuid("order_item_id").references((): AnyPgColumn => legalOrderItems.id, { onDelete: "set null" }),
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
    // 3f: an order decision restricts on the law with no text of korbat's (its kind compared as text: the migration that
    // adds the value cannot name it as a literal of the enum).
    check("decisions_ground_law", sql`${t.ground} is distinct from 'illegal' or ${t.legalReferenceDigest} is not null or ${t.kind}::text = 'order'`),
    // 3d (6.6): a program's decision has a ground and no text, so its two digests are asked of a decision with a decider alone.
    check(
      "decisions_restricted",
      sql`${t.outcome} <> 'restricted' or (${t.ground} is not null and ((${t.factsDigest} is not null and ${t.reasonDigest} is not null) or ${t.decidedBy} is null)) or ${t.kind}::text = 'order'`,
    ),
    // 3d (6.6): a decision without a decider is fully automated, and the only fully automated one; and it is interim.
    check("decisions_decider", sql`(${t.decidedBy} is null) = (${t.automatedDecision} = 'fully') and (${t.decidedBy} is not null or ${t.kind}::text = 'interim')`),
    // 3f: an untold decision has no mail pending, whatever its kind.
    check("decisions_informed", sql`${t.informedAt} is not null or ${t.authorMail}::text = 'none'`),
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
    // 3e (design, section 6.1). The API supplies days, announced and replaced, which the key signs; the check trigger forces
    // the other four and clears all seven on the kinds that do not take them.
    /** The length of a suspend or a restrict_reporting, 1 to 30; null on a terminate. */
    days: smallint("days"),
    /** On a standing measure: announced with the reply window, or taken at once. Always false on a restrict_reporting. */
    announced: boolean("announced"),
    /** Forced: what the measure rests on, one of eight words. */
    basis: text("basis"),
    /** Forced: the decisions it rests on; null when it rests on none. */
    restsOn: uuid("rests_on").array(),
    /** Forced: the decision's time for a measure taken at once; that time plus the reply window for an announced one. */
    startsAt: ts("starts_at"),
    /** Forced: a strike's and a warning's last moment of counting. */
    endsAt: ts("ends_at"),
    /** On a lift_suspension only: the correction withdraws an announced measure that had not started, to make room for another. */
    replaced: boolean("replaced"),
    // 3f (design, section 6.2). Until the ledger's functions of Task 3 no function accepts an order's kinds, so neither is
    // stored before then.
    /** Forced on a disable_by_order from its order's withhold_from_author: whether the post is kept from its author too. */
    withholdAuthor: boolean("withhold_author"),
    /** Supplied and signed on a reinstate_by_order: why the order's measure ends. */
    orderGround: text("order_ground"),
  },
  (t) => [
    check("decision_actions_no_effect", sql`${t.noEffect} in ('already', 'deleted')`),
    // Each names columns only, never a value of action_kind: a check may not name a value its own migration adds.
    check("decision_actions_days", sql`${t.days} between 1 and 30`),
    check("decision_actions_basis", sql`${t.basis} in (${listOf(STANDING_BASES)})`),
    check("decision_actions_announced", sql`${t.announced} is null or ${t.basis} is not null`),
    check("decision_actions_order_ground", sql`${t.orderGround} in ('withdrawn', 'annulled', 'scrutiny', 'not_authentic', 'wrong_item')`),
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

// ---------------------------------------------------------------- account sanctions (3e design, section 6.1)

/**
 * A person's reply to a standing measure (a suspend or a terminate), one a measure. The API role may only insert and read;
 * the triggers of 3e's standing_ledger migration check the reply, force the columns marked forced, and derive the
 * account's standing again. The answering decision and its time are written only by the ledger's triggers.
 */
export const suspensionReplies = pgTable(
  "suspension_replies",
  {
    actionId: uuid("action_id")
      .primaryKey()
      .references(() => decisionActions.id, { onDelete: "restrict" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    /** Optional and free of form, with the salt and digest the server made (the contracts' textDigest). */
    statement: text("statement"),
    statementSalt: text("statement_salt"),
    statementDigest: text("statement_digest"),
    /** Forced: clock_timestamp(), read after the profile's lock. */
    filedAt: ts("filed_at").notNull(),
    /** Forced: filed before the measure's start, or while it had none. */
    onTime: boolean("on_time").notNull(),
    /** Forced null at insert: the decision that answered the reply. */
    answeredBy: uuid("answered_by").references((): AnyPgColumn => decisions.id),
    answeredAt: ts("answered_at"),
    erasedAt: ts("erased_at"),
  },
  (t) => [
    check("suspension_replies_statement_len", sql`char_length(${t.statement}) <= 2000`),
    // The three states of an appeal's statement: none; held to its digest; erased, the digest kept.
    check(
      "suspension_replies_statement",
      sql`(${t.statement} is null) = (${t.statementSalt} is null) and (${t.statement} is null or (${t.erasedAt} is null and ${t.statementSalt} ~ '^[0-9a-f]{64}$' and ${t.statementDigest} is not null and ${t.statementDigest} = encode(sha256(convert_to('korbat.text.v1', 'UTF8') || decode('0a', 'hex') || decode(${t.statementSalt}, 'hex') || convert_to(${t.statement}, 'UTF8')), 'hex'))) and (${t.statement} is not null or ${t.statementDigest} is null or ${t.erasedAt} is not null) and (${t.statementDigest} is null or ${t.statementDigest} ~ '^[0-9a-f]{64}$')`,
    ),
    /** The replies waiting for an answer, oldest first. */
    index("suspension_replies_pending_idx").on(t.filedAt).where(sql`answered_by is null`),
    fullAccess("suspension_replies_api_all", apiRole),
  ],
).enableRLS();

/**
 * A moderator's mark "manifestly unfounded" on an answered item of a signed-in person's rule report, one an item. The
 * API role holds no write on it until the migration of the reporting counts grants INSERT together with the trigger that
 * checks every mark; the reporter, the report and its time are forced, and a withdrawal is written only by the ledger's
 * triggers.
 */
export const unfoundedMarks = pgTable(
  "unfounded_marks",
  {
    itemId: uuid("item_id")
      .primaryKey()
      .references(() => intakeItems.id, { onDelete: "restrict" }),
    /** The decision that set the mark. */
    decisionId: uuid("decision_id")
      .notNull()
      .references((): AnyPgColumn => decisions.id, { onDelete: "restrict" }),
    /** Forced: the reporter. No foreign key: the counts go with the account through the retention functions. */
    accountId: uuid("account_id").notNull(),
    /** Forced: the report the item came in, the unit the counts count. */
    intakeId: uuid("intake_id")
      .notNull()
      .references(() => intakes.id, { onDelete: "restrict" }),
    /** Forced: that report's received_at. */
    reportedAt: ts("reported_at").notNull(),
    /** Forced: now(). */
    markedAt: ts("marked_at").notNull(),
    /** Forced null at insert: the correction that withdrew the mark, and when. */
    withdrawnBy: uuid("withdrawn_by").references((): AnyPgColumn => decisions.id),
    withdrawnAt: ts("withdrawn_at"),
  },
  (t) => [index("unfounded_marks_account_idx").on(t.accountId, t.reportedAt), fullAccess("unfounded_marks_api_all", apiRole)],
).enableRLS();

/** How many rule reports an account sent on a UTC day. Written only by a migrator-owned trigger on intakes; the API role reads it. */
export const reportTallies = pgTable(
  "report_tallies",
  {
    accountId: uuid("account_id").notNull(),
    day: date("day").notNull(),
    reports: integer("reports").notNull(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.day] }), pgPolicy("report_tallies_api_select", { for: "select", to: apiRole, using: sql`true` })],
).enableRLS();

// ---------------------------------------------------------------- authorities' orders (3f design, section 6.2)

// Written from the contracts' ORDER_KINDS, ORDER_CHANNELS, HOLD_END_REASONS, TELL_PERSON_RULES, ORDER_ITEM_CLOSE_REASONS,
// ORDER_EVENT_KINDS, ORDER_EVENT_VIA and ORDER_EVENT_GROUNDS; a database test holds each CHECK to its constant.
const ORDER_KINDS = ["tco_removal", "dsa_art9", "dsa_art10"];
const ORDER_CHANNELS = ["mailbox", "portal", "post", "other"];
const HOLD_END_REASONS = ["not_authentic", "annulled", "released_by_authority", "not_ordered"];
const ORDER_ITEM_CLOSE_REASONS = ["no_post", "not_named", "withdrawn"];
const ORDER_EVENT_KINDS = [
  "opened",
  "annex3_sent",
  "grounds_ceased",
  "clarification_received",
  "annex2_sent",
  "receipt_confirmed",
  "closed_without_effect",
  "reopened",
  "hold_extended",
  "corrected",
  "effect_given",
  "reinstated",
  "notice_released",
  "preservation_ended",
  "verified",
  "issued_at_set",
  "texts_recorded",
  "document_recorded",
  "received_set",
  "sent_at_set",
  "due_set",
  "hold_ended",
  "hold_until_set",
  "preservation_extended",
  "scrutiny_requested",
  "scrutiny_decided",
  "tell_person_set",
  "person_told",
  "imported",
];
/** The grounds of each kind of event that takes one; every other kind takes none. */
const ORDER_EVENT_GROUNDS: Record<string, readonly string[]> = {
  annex3_sent: ["force_majeure", "manifest_error", "insufficient_information"],
  closed_without_effect: ["withdrawn", "annulled", "scrutiny", "not_authentic", "wrong_item", "not_addressed"],
  corrected: ["entry", "caution", "admin"],
  reinstated: ["withdrawn", "annulled", "scrutiny", "not_authentic", "wrong_item"],
  hold_ended: HOLD_END_REASONS,
  scrutiny_decided: ["upheld", "annulled"],
};
/**
 * 3f's review (people2): the one of the authority's three texts a texts_recorded event wrote, from the contracts'
 * ORDER_TEXT_KINDS, so the notice can say since when it holds the reasons. An event written before has none, which the
 * last clause below keeps allowed.
 */
const ORDER_TEXT_KINDS = ["reasons", "redress", "scope"];
const eventGroundCheck = sql.raw(
  [
    ...Object.entries(ORDER_EVENT_GROUNDS).map(([kind, grounds]) => `(kind = '${kind}' and ground in (${grounds.map((g) => `'${g}'`).join(", ")}))`),
    `(kind = 'texts_recorded' and ground in (${ORDER_TEXT_KINDS.map((g) => `'${g}'`).join(", ")}))`,
    `(kind not in (${Object.keys(ORDER_EVENT_GROUNDS)
      .map((kind) => `'${kind}'`)
      .join(", ")}) and ground is null)`,
  ].join(" or "),
);

/**
 * One order of an authority, as a person entered it from its document (3f design, section 6.2). The console's columns
 * come from the API's insert, which the trigger legal_orders_insert completes: it forces when and how the order was
 * opened, its time of receipt from the named message, the channel mailbox with a message, and the withholding and the
 * preservation by kind; it nulls every column of the command line, which only the migrator writes. The API role may read
 * and insert, never update: a correction, a clock event and a reopening go through definer functions bound to their
 * audit rows. The order's document is not stored, only its digest and length.
 */
export const legalOrders = pgTable(
  "legal_orders",
  {
    /** Supplied, so the audit row can name it. */
    id: uuid("id").primaryKey(),
    kind: text("kind").notNull(),
    /** The issuing state's ISO code. */
    memberState: text("member_state").notNull(),
    authority: text("authority").notNull(),
    reference: text("reference").notNull(),
    /** How the order arrived; forced mailbox when a message is named. */
    channel: text("channel").notNull(),
    messageId: uuid("message_id").references(() => contactMessages.id, { onDelete: "restrict" }),
    /** Forced: the named message's time of receipt; null without a message until the command line records it. */
    receivedAt: ts("received_at"),
    /** The command line's: the sending time the channel states, the order's own time stamp, a DSA order's deadline. */
    sentAt: ts("sent_at"),
    issuedAt: ts("issued_at"),
    dueAt: ts("due_at"),
    /** "The author must not be told". No default: an insert that leaves it out is refused. */
    sectionC: boolean("section_c").notNull(),
    emergency: boolean("emergency").notNull(),
    /** The API's: the issuing state is not HOME_STATE. */
    crossBorder: boolean("cross_border").notNull(),
    /** Forced true for a removal order and for any order with Section C. */
    withholdFromAuthor: boolean("withhold_from_author").notNull(),
    /** Forced: true for a removal order, false otherwise. */
    preserve: boolean("preserve").notNull(),
    /** The command line's: the end the authority states, what it rests on, the one extension and the hold's end. */
    authorityHoldUntil: ts("authority_hold_until"),
    holdBasis: text("hold_basis"),
    holdExtended: boolean("hold_extended").notNull().default(false),
    holdEndedAt: ts("hold_ended_at"),
    holdEndReason: text("hold_end_reason"),
    /** The command line's, for an order to provide information: when the person it concerns is told. */
    tellPerson: text("tell_person"),
    tellPersonAt: ts("tell_person_at"),
    openedBy: uuid("opened_by").references(() => profiles.id, { onDelete: "restrict" }),
    /** Forced console for every role but the migrator, and clock_timestamp(). */
    openedVia: text("opened_via").notNull(),
    openedAt: ts("opened_at").notNull(),
    /** The command line's: the check, the authority's texts (held as staff_texts holds a text) and the document's digest. */
    verifiedAt: ts("verified_at"),
    verifiedHow: text("verified_how"),
    reasons: text("reasons"),
    reasonsSalt: text("reasons_salt"),
    reasonsDigest: text("reasons_digest"),
    redress: text("redress"),
    redressSalt: text("redress_salt"),
    redressDigest: text("redress_digest"),
    scope: text("scope"),
    scopeSalt: text("scope_salt"),
    scopeDigest: text("scope_digest"),
    documentSha256: text("document_sha256"),
    documentBytes: bigint("document_bytes", { mode: "number" }),
    /** Set and cleared by order_event_record (closed_without_effect, reopened) and cleared by order-reopen. */
    closedAt: ts("closed_at"),
    importedAt: ts("imported_at"),
  },
  (t) => [
    unique("legal_orders_reference_key").on(t.memberState, t.authority, t.reference),
    check("legal_orders_kind", sql`${t.kind} in (${listOf(ORDER_KINDS)})`),
    check("legal_orders_member_state", sql`${t.memberState} ~ '^[A-Z]{2}$'`),
    check("legal_orders_names", sql`char_length(${t.authority}) between 1 and 200 and char_length(${t.reference}) between 1 and 200`),
    check("legal_orders_channel", sql`${t.channel} in (${listOf(ORDER_CHANNELS)})`),
    check("legal_orders_opened_via", sql`${t.openedVia} in ('console', 'cli')`),
    check("legal_orders_received", sql`${t.receivedAt} <= ${t.openedAt} and ${t.sentAt} <= ${t.openedAt}`),
    check("legal_orders_issued", sql`${t.issuedAt} <= coalesce(${t.receivedAt}, ${t.openedAt})`),
    // A notice can be held only on a post its author cannot see; what a removal order disabled is preserved.
    check("legal_orders_tco", sql`((${t.kind} <> 'tco_removal' and not ${t.sectionC}) or ${t.withholdFromAuthor}) and (${t.kind} <> 'tco_removal' or ${t.preserve})`),
    check(
      "legal_orders_tell",
      sql`(${t.tellPerson} is null or (${t.tellPerson} in ('at_effect', 'at_instant', 'never') and ${t.kind} = 'dsa_art10')) and (${t.tellPersonAt} is not null) = (${t.tellPerson} is not distinct from 'at_instant')`,
    ),
    check("legal_orders_hold_end", sql`(${t.holdEndedAt} is null) = (${t.holdEndReason} is null) and ${t.holdEndReason} in (${listOf(HOLD_END_REASONS)})`),
    check(
      "legal_orders_texts_len",
      sql`char_length(${t.verifiedHow}) <= 500 and char_length(${t.holdBasis}) <= 500 and char_length(${t.scope}) <= 500 and char_length(${t.reasons}) <= 4000 and char_length(${t.redress}) <= 4000`,
    ),
    check("legal_orders_document", sql`${t.documentSha256} ~ '^[0-9a-f]{64}$' and ${t.documentBytes} >= 0`),
    /** The day's count of records a staff account opened. */
    index("legal_orders_opened_by_idx").on(t.openedBy, t.openedAt),
    fullAccess("legal_orders_api_all", apiRole),
  ],
).enableRLS();

/**
 * One link an order names (6.2), with the post it resolved to when it named one: no foreign key, since a record outlives
 * its post. The API inserts the link as named; the trigger forces added_at; the ledger's triggers and the migrator write
 * what the item became (its decision, measure, disabling, preservation and reinstatement), and order_correct and the
 * migrator its closing without effect. The API role updates intake_item_id alone, inside the effect transaction.
 */
export const legalOrderItems = pgTable(
  "legal_order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull().references(() => legalOrders.id, { onDelete: "restrict" }),
    /** 1 to ORDER_ITEMS_MAX, unique in its order. */
    position: smallint("position").notNull(),
    /** As the order names it, at most 500 characters. */
    link: text("link").notNull(),
    postId: uuid("post_id"),
    /** Forced: clock_timestamp(), so an item added after the verification reads as unverified. */
    addedAt: ts("added_at").notNull(),
    intakeItemId: uuid("intake_item_id").references(() => intakeItems.id, { onDelete: "restrict" }),
    /** The newest decision and measure that serve the item; no foreign keys, as the ledger's own rows are never deleted. */
    decisionId: uuid("decision_id"),
    actionId: uuid("action_id"),
    disabledAt: ts("disabled_at"),
    preserveUntil: ts("preserve_until"),
    preserveEndedAt: ts("preserve_ended_at"),
    reinstatedAt: ts("reinstated_at"),
    closedAt: ts("closed_at"),
    closedReason: text("closed_reason"),
  },
  (t) => [
    unique("legal_order_items_position_key").on(t.orderId, t.position),
    uniqueIndex("legal_order_items_post_key").on(t.orderId, t.postId).where(sql`post_id is not null`),
    check("legal_order_items_position", sql`${t.position} between 1 and 50`),
    check("legal_order_items_link", sql`char_length(${t.link}) between 1 and 500`),
    check(
      "legal_order_items_closed",
      sql`(${t.closedAt} is null) = (${t.closedReason} is null) and ${t.closedReason} in (${listOf(ORDER_ITEM_CLOSE_REASONS)}) and (${t.closedAt} is null or ${t.disabledAt} is null)`,
    ),
    /** The freeze's fourth arm (Task 3): is this post preserved by an order. */
    index("legal_order_items_preserved_idx").on(t.postId).where(sql`preserve_until is not null`),
    fullAccess("legal_order_items_api_all", apiRole),
  ],
).enableRLS();

/**
 * An order's events (6.2), insert-only: the API inserts `opened` alone, the two definer functions order_event_record and
 * order_correct the console's, the ledger's functions (Task 3) theirs and the migrator the command line's. A console's
 * event stands only with the audit row a key confirmed, which the deferred trigger legal_order_events_confirmed checks.
 */
export const legalOrderEvents = pgTable(
  "legal_order_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull().references(() => legalOrders.id, { onDelete: "restrict" }),
    itemId: uuid("item_id").references(() => legalOrderItems.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    /** Forced clock_timestamp() for every role but the migrator. */
    at: ts("at").notNull(),
    /** The time the event counts from: a picked message's time of receipt, or a restart's later time; never after `at`. */
    effectiveAt: ts("effective_at"),
    ground: text("ground"),
    byStaff: uuid("by_staff").references(() => profiles.id, { onDelete: "restrict" }),
    via: text("via").notNull(),
  },
  (t) => [
    check("legal_order_events_kind", sql`${t.kind} in (${listOf(ORDER_EVENT_KINDS)})`),
    check("legal_order_events_ground", eventGroundCheck),
    check("legal_order_events_via", sql`${t.via} in ('console', 'cli', 'system')`),
    check("legal_order_events_effective", sql`${t.effectiveAt} <= ${t.at}`),
    index("legal_order_events_order_idx").on(t.orderId, t.at),
    uniqueIndex("legal_order_events_opened_key").on(t.orderId).where(sql`kind = 'opened'`),
    fullAccess("legal_order_events_api_all", apiRole),
  ],
).enableRLS();

/**
 * 3d (design, section 6.1): one row a file of a sealed image that the one-shot service `quarantine` moved out of the
 * image store, written only by `staff.js quarantine-record`, as the migrator, from the service's receipt. The API's role
 * holds no right on it: it reaches the quarantine through six functions that answer counts, one time and booleans. No
 * foreign key to the image row: the row outlives it, and `post_id` is what still ties a file to its post. A file has
 * three ends at most one of which is set: returned to the store, destroyed (with the release it was destroyed for), or
 * lost (found in neither place by a run with --lost). The insert trigger quarantine_files_insert forces `moved_at`,
 * `unknown`, `post_id` and the ends; quarantine_files_times forces the time of every end and `lost_told`.
 */
export const quarantineFiles = pgTable(
  "quarantine_files",
  {
    mediaId: uuid("media_id").notNull(),
    /** The store's name under its root: files/<aa>/<id>/small.webp or large.webp. */
    file: text("file").notNull(),
    /** Forced: the image's post when the row was written, null for an upload on no post or an image the database does not know. */
    postId: uuid("post_id"),
    size: bigint("size", { mode: "number" }),
    sha256: text("sha256"),
    /** Forced: when the move was recorded (a row imported after a restore keeps its own, never after the clock). */
    movedAt: ts("moved_at").notNull(),
    returnedAt: ts("returned_at"),
    destroyedAt: ts("destroyed_at"),
    /** 3d Task 2: the release the file was destroyed for, written by quarantine-record from the release of its post. */
    releaseId: uuid("release_id").references((): AnyPgColumn => releases.id, { onDelete: "restrict" }),
    lostAt: ts("lost_at"),
    /** Forced with lost_at: the author's notice of the lost file, pending only for an image on a post not sealed for good. */
    lostTold: deliveryState("lost_told"),
    importedAt: ts("imported_at"),
    /** Forced at insert: no image row with this id existed, so the database cannot place the file. */
    unknown: boolean("unknown").notNull(),
  },
  (t) => [
    primaryKey({ name: "quarantine_files_pkey", columns: [t.mediaId, t.file] }),
    // One of the image's two stored names, as the store's naming rule makes them (the contracts' MEDIA_SIZES).
    check(
      "quarantine_files_file",
      sql`${t.file} in ('files/' || left(${t.mediaId}::text, 2) || '/' || ${t.mediaId}::text || '/small.webp', 'files/' || left(${t.mediaId}::text, 2) || '/' || ${t.mediaId}::text || '/large.webp')`,
    ),
    // Both or neither; neither only on a row written as lost before its file was ever moved.
    check(
      "quarantine_files_digest",
      sql`(${t.size} is null) = (${t.sha256} is null) and (${t.size} is null or (${t.size} > 0 and ${t.sha256} ~ '^[0-9a-f]{64}$')) and (${t.size} is not null or ${t.lostAt} is not null)`,
    ),
    check("quarantine_files_ends", sql`num_nonnulls(${t.returnedAt}, ${t.destroyedAt}, ${t.lostAt}) <= 1`),
    check("quarantine_files_release", sql`${t.releaseId} is null or ${t.destroyedAt} is not null`),
    check("quarantine_files_told", sql`(${t.lostTold} is null) = (${t.lostAt} is null)`),
    /** seal_custody's count of a seal's files by post, and from 0031 the released files left to destroy. */
    index("quarantine_files_post_idx").on(t.postId),
    /** lost_untold: the notices of lost files still owed. */
    index("quarantine_files_untold_idx").on(t.mediaId).where(sql`lost_told = 'pending'`),
    // The API's role is granted nothing; this policy only says so to row level security, as 3f's records do.
    pgPolicy("quarantine_files_api_none", { for: "select", to: apiRole, using: sql`false` }),
  ],
).enableRLS();

// ---------------------------------------------------------------- the release (3d design, section 6.2; Task 2)
// The closed lists are the contracts' RELEASE_BASES, RELEASE_LEAVE_FROM and RELEASE_NOTICE_STATES, written out here as
// the records' lists are; a database test holds each migrated CHECK to its constant.
const releaseList = (values: readonly string[]) => sql.raw(values.map((value) => `'${value}'`).join(", "));

/**
 * A leave or an instruction to destroy, from an authority or a court, recorded as a fact of its own by staff.js
 * release-leave, as the migrator (3d design, section 6.2; review ruling 1): the one thing a release on the ground leave
 * rests on. An authority's assessment is not in this table and is no ground. The API's role holds no right on it: it
 * reads a leave only through release_facts. A leave recorded by mistake is withdrawn, never deleted or rewritten: the
 * guard release_leaves_guard forces withdrawn_at, refuses a withdrawal once a release rests on the leave (leave_used),
 * and lets nothing else of a recorded leave change but the end of an open untold_until.
 */
export const releaseLeaves = pgTable(
  "release_leaves",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** 3f's record of the report that the leave answers (the seal's, as seal_report finds it). No foreign key into 3f's table. */
    notificationId: uuid("notification_id").notNull(),
    /** authority or court (the contracts' `from`; the word is reserved in SQL). */
    leaveFrom: text("leave_from").notNull(),
    reference: text("reference").notNull(),
    /** The day the letter or order bears, not after the day it was recorded. */
    receivedOn: date("received_on").notNull(),
    /** The authority forbids telling the person, and until when; null with the mark set is an open end. */
    untold: boolean("untold").notNull(),
    untoldUntil: ts("untold_until"),
    /** Forced now(). */
    recordedAt: ts("recorded_at").notNull(),
    recordedBy: text("recorded_by"),
    /** Forced now() when first written, with withdrawn_by, once. */
    withdrawnAt: ts("withdrawn_at"),
    withdrawnBy: text("withdrawn_by"),
  },
  (t) => [
    // ::text, as productions_purposes compares: `authority` is also a value 3f added to intake_channel (the enum-literal rule).
    check("release_leaves_from", sql`${t.leaveFrom}::text in (${releaseList(["authority", "court"])})`),
    check("release_leaves_reference", sql`char_length(${t.reference}) between 1 and 200`),
    check("release_leaves_untold", sql`${t.untold} or ${t.untoldUntil} is null`),
    check("release_leaves_withdrawn", sql`(${t.withdrawnAt} is null) = (${t.withdrawnBy} is null)`),
    check("release_leaves_texts", sql`char_length(${t.recordedBy}) <= 200 and char_length(${t.withdrawnBy}) <= 200`),
    /** release_facts and seal_release: the newest leave of a report that is not withdrawn. */
    index("release_leaves_notification_idx").on(t.notificationId, t.recordedAt),
    // The API's role is granted nothing; this policy only says so to row level security, as quarantine_files' does.
    pgPolicy("release_leaves_api_none", { for: "select", to: apiRole, using: sql`false` }),
  ],
).enableRLS();

/**
 * One row a release (3d design, section 6.2): the one-way end of korbat's keeping of the images of a seal for good, on a
 * recorded leave, by an admin's confirmed action, or a replay of one after a restore. No role but the owner inserts it:
 * seal_release and release_replay are its writers, and the deferred releases_confirmed holds an admin's release to its
 * audit row seal_released at commit. The API's role reads it and moves the author's notice: releases_notice forces its
 * first state (held while release_tellable answers false) and lets the API move it from held only to pending, and only
 * once the author may be told.
 */
export const releases = pgTable(
  "releases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The seal's ledger row the admin named; null for a replay. No foreign key. */
    sealActionId: uuid("seal_action_id"),
    /** A held upload's refusal, from Task 7; null for a seal's release. */
    uploadRefusalId: uuid("upload_refusal_id"),
    /** The posts released, in id order. */
    postIds: uuid("post_ids").array().notNull(),
    basis: text("basis").notNull(),
    /** The leave the release rests on; null with the basis period. No foreign key: a replay may come before its lost leave is recorded again. */
    leaveId: uuid("leave_id"),
    /** The leave's reference, copied from its row. The record's answer is not copied: an assessment is no ground. */
    theirReference: text("their_reference"),
    releasedBy: uuid("released_by").references(() => profiles.id, { onDelete: "restrict" }),
    releasedAt: ts("released_at").notNull(),
    replayOf: uuid("replay_of"),
    /** The day after which no backup that is deleted on time holds a released file. */
    backupsClearAt: ts("backups_clear_at").notNull(),
    /** One of 3c's delivery states or held, forced at insert by releases_notice. */
    authorNotice: text("author_notice").notNull(),
    authorNoticeAt: ts("author_notice_at"),
    importedAt: ts("imported_at"),
  },
  (t) => [
    check("releases_basis", sql`${t.basis} in (${releaseList(["leave", "period"])})`),
    check("releases_leave", sql`(${t.basis} = 'leave') = (${t.leaveId} is not null) and (${t.leaveId} is null) = (${t.theirReference} is null)`),
    check("releases_reference", sql`char_length(${t.theirReference}) between 1 and 200`),
    check("releases_notice", sql`${t.authorNotice} in (${releaseList(["pending", "sent", "folded", "suppressed", "no_address", "none", "failed", "held"])})`),
    // An admin's release names its admin; a replay names none, and no seal, and keeps its original's id.
    check("releases_replay", sql`(${t.replayOf} is null) = (${t.releasedBy} is not null) and (${t.replayOf} is null or ${t.sealActionId} is null)`),
    unique("releases_replay_of_key").on(t.replayOf),
    /** The case answer's release block and Appeals' mark: the releases of one seal. */
    index("releases_seal_idx").on(t.sealActionId),
    /** The dispatch round's notices: the releases whose notice is pending or held. */
    index("releases_notice_idx").on(t.releasedAt).where(sql`author_notice in ('pending', 'held')`),
    fullAccess("releases_api_all", apiRole),
  ],
).enableRLS();

/**
 * The release's mark, keyed on the post (3d design, section 2, row 43): a released post is no longer frozen through its
 * seal, whichever seal row lists it, also a seal for good taken again after a restore. No foreign key to posts: a replay
 * marks a post the restored database may not hold. Insert-only for its owner; the API's role reads it.
 */
export const releasePosts = pgTable(
  "release_posts",
  {
    postId: uuid("post_id").primaryKey(),
    releaseId: uuid("release_id")
      .notNull()
      .references(() => releases.id, { onDelete: "restrict" }),
  },
  (t) => [index("release_posts_release_idx").on(t.releaseId), fullAccess("release_posts_api_all", apiRole)],
).enableRLS();

/**
 * The day of a release by period, told to the author beforehand (3d design, section 6.2; row 41), keyed on the seal's
 * ledger row (or, from Task 7, a held upload's refusal). Its one writer is release_announce, which nothing reaches while
 * release_rules().silence_days is null: the route, the screen and the objection's form are built by the task that sets
 * the period, on counsel's answer.
 */
export const releaseNotices = pgTable(
  "release_notices",
  {
    subjectId: uuid("subject_id").primaryKey(),
    releaseOn: date("release_on").notNull(),
    /** Forced now(). */
    createdAt: ts("created_at").notNull(),
    told: deliveryState("told").notNull().default("pending"),
    toldAt: ts("told_at"),
    objection: text("objection"),
    objectedAt: ts("objected_at"),
    objectionAnsweredAt: ts("objection_answered_at"),
  },
  (t) => [
    check("release_notices_objection", sql`(${t.objection} is null) = (${t.objectedAt} is null) and char_length(${t.objection}) between 1 and 2000`),
    fullAccess("release_notices_api_all", apiRole),
  ],
).enableRLS();

// ---------------------------------------------------------------- the automated decision (3d design, section 6.6; Task 6)
// The closed lists are the contracts' SIGNAL_KINDS and SIGNAL_HANDLED, written out here as the release's are; a database
// test holds each migrated CHECK to its constant.

/**
 * One signal: the fact a program's finding and its one measure rest on (3d design, sections 6.6 and 7.9), a score at or
 * over the threshold of an image on a post (`r1_score`) or, from Task 7, a match record (`known_match`). The API's role
 * inserts it and sets the last four columns, each once: the BEFORE INSERT trigger automated_signals_insert forces
 * created_at and nulls the four, and the guard automated_signals_guard lets each of them change only from null, for every
 * role but the migrator, so a signal is never pointed at a second decision. An image has one signal a kind for as long
 * as the row exists, handled or not (automated_signals_one). The image has no foreign key: it may leave first.
 */
export const automatedSignals = pgTable(
  "automated_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    mediaId: uuid("media_id").notNull(),
    /** For an r1_score and for no other kind: the score the worker wrote and the threshold's version it was over. */
    score: real("score"),
    thresholdVersion: smallint("threshold_version"),
    /** For a known_match and for no other kind; its foreign key to media_matches comes with that table (Task 7). */
    matchId: uuid("match_id"),
    /** Forced: now(). */
    createdAt: ts("created_at").notNull(),
    /** The finding's item; set once, in the step's transaction. */
    intakeItemId: uuid("intake_item_id"),
    /** The program's decision, when the step took a measure; set once. */
    decisionId: uuid("decision_id").references(() => decisions.id, { onDelete: "restrict" }),
    /** What the step did with the signal, and when: both or neither. */
    handledAt: ts("handled_at"),
    handled: text("handled"),
  },
  (t) => [
    check("automated_signals_kind", sql`${t.kind} in ('r1_score', 'known_match')`),
    check("automated_signals_handled", sql`${t.handled} in ('finding', 'measure', 'capped', 'covered', 'gone')`),
    check("automated_signals_handled_at", sql`(${t.handledAt} is null) = (${t.handled} is null)`),
    // A score and its threshold's version for a score alone; a match record for a match alone.
    check("automated_signals_score", sql`((${t.score} is not null and ${t.thresholdVersion} is not null) = (${t.kind} = 'r1_score')) and ((${t.matchId} is not null) = (${t.kind} = 'known_match'))`),
    check("automated_signals_score_range", sql`${t.score} is null or (${t.score} >= 0 and ${t.score} <= 1)`),
    // An image has one signal a kind for as long as the row exists: a handled one is never written again beside it.
    uniqueIndex("automated_signals_one").on(t.mediaId, t.kind),
    /** The sweep's read of the signals a crash or a failed step left unhandled. */
    index("automated_signals_open").on(t.mediaId, t.kind).where(sql`handled_at is null`),
    uniqueIndex("automated_signals_item").on(t.intakeItemId).where(sql`intake_item_id is not null`),
    uniqueIndex("automated_signals_decision").on(t.decisionId).where(sql`decision_id is not null`),
    fullAccess("automated_signals_api_all", apiRole),
  ],
).enableRLS();

/**
 * "Ask for a person" (3d design, sections 2 row 25, 6.6 and 7.10): the one text the subject of a program's decision may
 * send while a measure of it is in force. The insert's definer trigger automated_objections_insert refuses
 * objection_not_open unless the decision has no decider and a measure of it is in force, and forces created_at and
 * erased_at. Nothing stores "answered": a person's correction or final decision ends the measure, and with it the
 * objection. The API's role reads and inserts; the text is set null once erased (Task 8).
 */
export const automatedObjections = pgTable(
  "automated_objections",
  {
    decisionId: uuid("decision_id")
      .primaryKey()
      .references(() => decisions.id, { onDelete: "restrict" }),
    text: text("text"),
    /** Forced: now(). */
    createdAt: ts("created_at").notNull(),
    erasedAt: ts("erased_at"),
  },
  (t) => [
    check("automated_objections_text", sql`(${t.text} is null) = (${t.erasedAt} is not null) and char_length(${t.text}) between 1 and 2000`),
    fullAccess("automated_objections_api_all", apiRole),
  ],
).enableRLS();
