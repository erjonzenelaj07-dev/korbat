import { sql } from "drizzle-orm";
import type { ActionKind, CaseDecidedParams, Lane, StaffStoredAssertion } from "@korbat/contracts";
import type { Db, DbTx } from "@korbat/db";

/**
 * The SQL statements of the moderation module, on the korbat_api pool (3c design, sections 5 and 6). The module inserts
 * rows; migrator-owned triggers check them, force the columns the API must not choose, and derive every restriction from
 * them. So each insert here names only what the API supplies: the database sets the rest whatever an insert said (a time,
 * a number in a case, who a report came from), and a column left out can never be mistaken for one the API chose. That is
 * why the inserts are written as SQL: a query builder would name every column of the table.
 */

/** What a statement runs through: the pool, or a transaction. */
export type Runner = Pick<Db, "execute"> | Pick<DbTx, "execute">;

export const rows = async <T>(q: Runner, query: ReturnType<typeof sql>): Promise<T[]> => (await q.execute(query)) as unknown as T[];

/** A timestamptz expression as the text Date.prototype.toISOString writes: UTC, to the millisecond. The expression is written here, never input. */
export const iso = (expression: string) => sql.raw(`to_char(${expression} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

// ---------------------------------------------------------------- what the database raised

/** The first of the driver's errors in the chain that carries a SQLSTATE; drizzle wraps the driver's error as a cause. */
function driverError(err: unknown): { code: string; message: unknown; constraint_name?: unknown } | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === "object" && typeof (current as { code?: unknown }).code === "string") return current as { code: string; message: unknown; constraint_name?: unknown };
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/** The message of an exception a trigger or a function raised as its code (SQLSTATE P0001); null for anything else. */
export function raisedMessage(err: unknown): string | null {
  const raised = driverError(err);
  return raised?.code === "P0001" && typeof raised.message === "string" ? raised.message : null;
}

/** True for a serialization failure (SQLSTATE 40001): the attach trigger raises it when an item's case closed in between. */
export function isSerializationFailure(err: unknown): boolean {
  return driverError(err)?.code === "40001";
}

/** The constraint a unique violation names (SQLSTATE 23505), or null for anything else. */
export function violatedUniqueConstraint(err: unknown): string | null {
  const raised = driverError(err);
  return raised?.code === "23505" && typeof raised.constraint_name === "string" ? raised.constraint_name : null;
}

// ---------------------------------------------------------------- intakes, items and cases

export type TargetType = "post" | "account";

/** One report, notice or finding as the intake's transaction stores it; the trigger sets when it was received and its receipt's state. */
export interface IntakeRow {
  kind: "user" | "finding";
  ref: string;
  /** The sha256 hex of the notice's token, for a signed-out notice and for every notice on the CSAM path. */
  lookupHash: string | null;
  channel: "signed_in" | "signed_out" | "staff";
  reporterId: string | null;
  findingBy: string | null;
  contactId: string | null;
  ruleId: string | null;
  allegesIllegal: boolean;
  csam: boolean;
  category: string;
  categoryKeyword: string | null;
  citedLaw: string | null;
  explanation: string | null;
  bonaFide: boolean;
}

export async function insertIntake(tx: DbTx, row: IntakeRow): Promise<string> {
  const [inserted] = await rows<{ id: string }>(
    tx,
    sql`insert into intakes (kind, ref, lookup_hash, channel, reporter_id, finding_by, contact_id, rule_id, alleges_illegal, csam, category, category_keyword, cited_law, explanation, bona_fide)
        values (${row.kind}::intake_kind, ${row.ref}, ${row.lookupHash}, ${row.channel}::intake_channel, ${row.reporterId}::uuid, ${row.findingBy}::uuid, ${row.contactId}::uuid,
                ${row.ruleId}, ${row.allegesIllegal}::boolean, ${row.csam}::boolean, ${row.category}, ${row.categoryKeyword}, ${row.citedLaw}, ${row.explanation}, ${row.bonaFide}::boolean)
        returning id`,
  );
  return inserted!.id;
}

/**
 * The target's open case, opened when there is none: an insert that does nothing on a conflict (the API role holds no
 * UPDATE on cases, so it could not do anything else), then a read of the open case in a statement of its own, which
 * sees a case another transaction committed while the insert waited. Null when the read finds none: a decision closed
 * the case after the insert, and the caller runs both again.
 */
export async function openCase(tx: DbTx, targetType: TargetType, targetId: string): Promise<string | null> {
  await tx.execute(sql`insert into cases (target_type, target_id) values (${targetType}::moderation_target, ${targetId}::uuid) on conflict (target_type, target_id) where closed_at is null do nothing`);
  const [open] = await rows<{ id: string }>(tx, sql`select id from cases where target_type = ${targetType}::moderation_target and target_id = ${targetId}::uuid and closed_at is null`);
  return open?.id ?? null;
}

/** One target of an intake. With a case the attach trigger numbers it into the case; without one it is stored as answered at once, not available. */
export interface ItemRow {
  intakeId: string;
  caseId: string | null;
  targetType: TargetType;
  targetId: string;
  position: number;
  lane: Lane;
  /** The image the sender pointed at: a hint. */
  mediaId: string | null;
  /** For an account, the handle as it was named, in lower case. */
  namedHandle: string | null;
}

export async function insertItem(tx: DbTx, row: ItemRow): Promise<{ id: string; seq: number | null }> {
  const [inserted] = await rows<{ id: string; seq: number | null }>(
    tx,
    sql`insert into intake_items (intake_id, case_id, target_type, target_id, position, lane, media_id, named_handle, outcome)
        values (${row.intakeId}::uuid, ${row.caseId}::uuid, ${row.targetType}::moderation_target, ${row.targetId}::uuid, ${row.position}::smallint, ${row.lane}::smallint,
                ${row.mediaId}::uuid, ${row.namedHandle}, ${row.caseId === null ? "not_available" : null}::item_outcome)
        returning id, seq`,
  );
  return inserted!;
}

// ---------------------------------------------------------------- reports and notices

/** Ids as one uuid[] parameter. */
const uuids = (ids: readonly string[]) => sql`${`{${ids.join(",")}}`}::uuid[]`;

/** One target as a key of a set: its kind and its id. */
export const targetKey = (target: { type: TargetType; id: string }) => `${target.type}:${target.id}`;

/**
 * Which of these targets the sender has reported already on this ground (alleging illegality or not): the target's open
 * case holds an item of theirs that is no re-examination. The unique index the intake's transaction meets holds the same
 * rule; this read lets a notice that names several targets drop the ones already reported instead of failing whole.
 */
export async function alreadyReported(q: Runner, reporterId: string, allegesIllegal: boolean, targets: readonly { type: TargetType; id: string }[]): Promise<Set<string>> {
  if (targets.length === 0) return new Set();
  const ids = (type: TargetType) => uuids(targets.filter((target) => target.type === type).map((target) => target.id));
  const found = await rows<{ target_type: TargetType; target_id: string }>(
    q,
    sql`select c.target_type, c.target_id from cases c
         where c.closed_at is null
           and ((c.target_type = 'post' and c.target_id = any(${ids("post")})) or (c.target_type = 'account' and c.target_id = any(${ids("account")})))
           and exists (select 1 from intake_items i
                        where i.case_id = c.id and i.reporter_account_id = ${reporterId}::uuid and i.alleges_illegal = ${allegesIllegal}::boolean and i.reexamines_item_id is null)`,
  );
  return new Set(found.map((row) => targetKey({ type: row.target_type, id: row.target_id })));
}

/** A notice as the status page and its receipt need it: where it stands and whom its receipt goes to, never what it says. */
export interface NoticeRow {
  id: string;
  ref: string;
  /** The sha256 hex of the notice's own token; null for a report sent signed in on a rule or on the law. */
  lookupHash: string | null;
  contactId: string | null;
  reporterId: string | null;
  allegesIllegal: boolean;
  /** As Date.prototype.toISOString writes it. */
  receivedAt: string;
  receipt: "pending" | "sent" | "folded" | "suppressed" | "no_address" | "none" | "failed";
}

const noticeColumns = sql`id, ref, lookup_hash, contact_id, reporter_id, alleges_illegal, ${iso("received_at")} as received_at, receipt`;
type NoticeColumns = { id: string; ref: string; lookup_hash: string | null; contact_id: string | null; reporter_id: string | null; alleges_illegal: boolean; received_at: string; receipt: NoticeRow["receipt"] };
const noticeOf = (row: NoticeColumns | undefined): NoticeRow | null =>
  row ? { id: row.id, ref: row.ref, lookupHash: row.lookup_hash, contactId: row.contact_id, reporterId: row.reporter_id, allegesIllegal: row.alleges_illegal, receivedAt: row.received_at, receipt: row.receipt } : null;

/** The notice with this public reference, or null. */
export async function noticeByRef(q: Runner, ref: string): Promise<NoticeRow | null> {
  return noticeOf((await rows<NoticeColumns>(q, sql`select ${noticeColumns} from intakes where ref = ${ref}`))[0]);
}

export async function noticeById(q: Runner, intakeId: string): Promise<NoticeRow | null> {
  return noticeOf((await rows<NoticeColumns>(q, sql`select ${noticeColumns} from intakes where id = ${intakeId}::uuid`))[0]);
}

/** One item of a notice as its sender may read it: nothing of the case, the decision's reasons or the target's content. */
export interface NoticeItemRow {
  position: number;
  targetType: TargetType;
  targetId: string;
  /** For an account, the handle as the notice named it. */
  namedHandle: string | null;
  /** False for a link that named nothing live: its item has no case and was answered at once. */
  hasCase: boolean;
  suspect: boolean;
  /** Whether the daily release has shown the outcome; nothing below is told before it. */
  released: boolean;
  shownOutcome: string | null;
  /** The UTC day of the answering decision, or of the item itself when it was answered without one. */
  decidedOn: string;
  /** Whether the answering decision holds a seal. */
  sealed: boolean;
  /** Whether the answering decision was taken while nobody could open the post's images. */
  decisionUnseen: boolean;
  /** The rule the answering decision cites and the rulebook version it was made under; null without a decision or a rule. */
  ruleId: string | null;
  rulesVersion: number | null;
  /** Every measure of the answering decision changed nothing when it was imposed. */
  noEffect: boolean;
  changed: boolean;
  reexamines: boolean;
  /** A moderator's decision to take no action: the only answer a re-examination can be asked for. */
  noAction: boolean;
  reexamined: boolean;
  /** The end of the re-examination window, as toISOString writes it; null before the release. */
  until: string | null;
  inWindow: boolean;
}

const MEASURE_KINDS_SQL = sql`('withhold', 'remove', 'seal_media', 'withhold_media', 'remove_media', 'reset_display_name', 'reset_bio')`;

/**
 * Whether every measure of the decision that answered item `i` changed nothing when it was imposed: it holds a measure,
 * and none whose `no_effect` is null. The mail's line and the status answer read it through this one expression.
 */
const answerChangedNothing = sql`(exists (select 1 from decision_actions a where a.decision_id = i.answered_by and a.kind in ${MEASURE_KINDS_SQL})
                and not exists (select 1 from decision_actions a where a.decision_id = i.answered_by and a.kind in ${MEASURE_KINDS_SQL} and a.no_effect is null))`;

/**
 * The items of these notices, each notice's in the order its page lists them: by position, an item korbat added for a
 * quoted post (positions 11 to 20) directly after the item it was added for, and a re-examination, which shares its
 * item's position, after it. The window's end is the database's own appeal_deadline of the release, read against its
 * clock, as the attach trigger reads it when a re-examination is filed.
 */
export async function noticeItemsOf(q: Runner, intakeIds: readonly string[]): Promise<Map<string, NoticeItemRow[]>> {
  const byNotice = new Map<string, NoticeItemRow[]>(intakeIds.map((id) => [id, []]));
  if (intakeIds.length === 0) return byNotice;
  const found = await rows<{
    intake_id: string;
    position: number;
    target_type: TargetType;
    target_id: string;
    named_handle: string | null;
    has_case: boolean;
    suspect: boolean;
    released: boolean;
    shown_outcome: string | null;
    decided_on: string;
    sealed: boolean;
    decision_unseen: boolean;
    rule_id: string | null;
    rules_version: number | null;
    no_effect: boolean;
    changed: boolean;
    reexamines: boolean;
    no_action: boolean;
    reexamined: boolean;
    until: string | null;
    in_window: boolean;
  }>(
    q,
    sql`select i.intake_id, i.position, i.target_type, i.target_id, i.named_handle, i.case_id is not null as has_case, i.suspect,
               i.outcome_sent_at is not null as released, i.shown_outcome,
               to_char(coalesce(d.decided_at, i.created_at) at time zone 'UTC', 'YYYY-MM-DD') as decided_on,
               exists (select 1 from decision_actions a where a.decision_id = i.answered_by and a.kind = 'seal_media') as sealed,
               coalesce(d.unseen, false) as decision_unseen,
               d.rule_id, d.rules_version, ${answerChangedNothing} as no_effect,
               i.revised_sent_at is not null as changed,
               i.reexamines_item_id is not null as reexamines,
               (i.answered_by is not null and i.outcome in ('no_violation', 'not_evident')) as no_action,
               exists (select 1 from intake_items r where r.reexamines_item_id = i.id) as reexamined,
               ${iso("public.appeal_deadline(i.outcome_sent_at)")} as until,
               coalesce(clock_timestamp() < public.appeal_deadline(i.outcome_sent_at), false) as in_window
          from intake_items i left join decisions d on d.id = i.answered_by
         where i.intake_id = any(${`{${intakeIds.join(",")}}`}::uuid[])
         order by i.intake_id, (case when i.position > 10 then i.position - 10 else i.position end), (i.position > 10), i.created_at, i.id`,
  );
  const itemOf = (row: (typeof found)[number]): NoticeItemRow => ({
    position: row.position,
    targetType: row.target_type,
    targetId: row.target_id,
    namedHandle: row.named_handle,
    hasCase: row.has_case,
    suspect: row.suspect,
    released: row.released,
    shownOutcome: row.shown_outcome,
    decidedOn: row.decided_on,
    sealed: row.sealed,
    decisionUnseen: row.decision_unseen,
    ruleId: row.rule_id,
    rulesVersion: row.rules_version,
    noEffect: row.no_effect,
    changed: row.changed,
    reexamines: row.reexamines,
    noAction: row.no_action,
    reexamined: row.reexamined,
    until: row.until,
    inWindow: row.in_window,
  });
  for (const row of found) byNotice.get(row.intake_id)?.push(itemOf(row));
  return byNotice;
}

/** One notice's items, in the order its page lists them. */
export async function noticeItems(q: Runner, intakeId: string): Promise<NoticeItemRow[]> {
  return (await noticeItemsOf(q, [intakeId])).get(intakeId) ?? [];
}

/** Where a page of the reporter's list starts: after this notice, by its time (to the microsecond, as text) and id. */
export interface ReportsCursor {
  at: string;
  id: string;
}

/**
 * The reports and notices this account sent, newest first: those whose record still names it. A notice on the path for
 * child sexual abuse material never does, and an account's deletion forgets the link. `sortAt` is the received time to
 * the microsecond, which the next page starts after.
 */
export async function reporterNotices(q: Runner, reporterId: string, after: ReportsCursor | null, limit: number): Promise<(NoticeRow & { sortAt: string })[]> {
  const found = await rows<NoticeColumns & { sort_at: string }>(
    q,
    sql`select ${noticeColumns}, to_char(received_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as sort_at
          from intakes
         where reporter_id = ${reporterId}::uuid
           ${after === null ? sql`` : sql`and (received_at, id) < (${after.at}::timestamptz, ${after.id}::uuid)`}
         order by received_at desc, id desc limit ${limit}::int`,
  );
  return found.flatMap((row) => {
    const notice = noticeOf(row);
    return notice ? [{ ...notice, sortAt: row.sort_at }] : [];
  });
}

/** What became of a receipt: the delivery states a send can end in. */
export type ReceiptState = "sent" | "folded" | "suppressed" | "no_address" | "failed";

/**
 * Records what became of a notice's receipt, only while it is still pending, so a late answer never overwrites one
 * already recorded: the later writer waits for the first one's commit and then changes nothing. True when this call
 * recorded it.
 */
export async function recordReceipt(q: Runner, intakeId: string, state: ReceiptState): Promise<boolean> {
  const updated = await rows<{ id: string }>(
    q,
    sql`update intakes set receipt = ${state}::delivery_state, receipt_sent_at = case when ${state}::text = 'sent' then now() else receipt_sent_at end
         where id = ${intakeId}::uuid and receipt = 'pending' returning id`,
  );
  return updated.length > 0;
}

/** The open cases in the urgent lane: how many, and since when the oldest of them has waited. One read of the queue's index. */
export async function urgentWaiting(q: Runner): Promise<{ count: number; oldest: Date | null }> {
  const [row] = await rows<{ n: number; oldest: string | null }>(q, sql`select count(*)::int as n, ${iso("min(oldest_open_at)")} as oldest from cases where closed_at is null and lane = 0`);
  return { count: row!.n, oldest: row!.oldest === null ? null : new Date(row!.oldest) };
}

// ---------------------------------------------------------------- evidence

/** The transaction's start to the millisecond, as the snapshots' trigger stamps a snapshot taken in it. */
export async function snapshotTime(tx: DbTx): Promise<string> {
  const [row] = await rows<{ at: string }>(tx, sql`select ${iso("date_trunc('milliseconds', now())")} as at`);
  return row!.at;
}

/**
 * Whether the case holds a snapshot yet, and for an account's case the fields of its newest one. A snapshot's time is its
 * transaction's start to the millisecond, so two snapshots of one case can carry the same time; their ids, which
 * insertSnapshot draws in time order, say which is the newer.
 */
export async function latestSnapshot(tx: DbTx, caseId: string): Promise<{ displayName: string | null; bio: string | null; handle: string | null } | null> {
  const [row] = await rows<{ display_name: string | null; bio: string | null; handle: string | null }>(
    tx,
    sql`select display_name, bio, handle from evidence_snapshots where case_id = ${caseId}::uuid order by taken_at desc, id desc limit 1`,
  );
  return row ? { displayName: row.display_name, bio: row.bio, handle: row.handle } : null;
}

/** A snapshot as the intake stores it: what was copied, with the salt and the digest the server made over all of it. */
export interface SnapshotRow {
  caseId: string;
  targetType: TargetType;
  targetId: string;
  authorHandle: string;
  postState: "visible" | "withheld" | "removed" | "deleted_by_author" | null;
  postCreatedAt: string | null;
  replyToId: string | null;
  quoteOfId: string | null;
  body: string | null;
  media: { id: string; alt: string | null; width: number; height: number }[] | null;
  displayName: string | null;
  bio: string | null;
  handle: string | null;
  salt: string;
  digest: string;
}

/**
 * Stores a snapshot and answers its id with the time the database stamped it, as text to the millisecond. The id is a
 * version 7 uuid, which PostgreSQL draws in time order and never backwards within a session: the newest snapshot of a
 * case is then the one with the latest time and, among those of one millisecond, the greatest id.
 */
export async function insertSnapshot(tx: DbTx, row: SnapshotRow): Promise<{ id: string; takenAt: string }> {
  const [inserted] = await rows<{ id: string; taken_at: string }>(
    tx,
    sql`insert into evidence_snapshots (id, case_id, target_type, target_id, author_handle, post_state, post_created_at, reply_to_id, quote_of_id, body, media, display_name, bio, handle, salt, digest)
        values (uuidv7(), ${row.caseId}::uuid, ${row.targetType}::moderation_target, ${row.targetId}::uuid, ${row.authorHandle}, ${row.postState}::post_state, ${row.postCreatedAt}::timestamptz,
                ${row.replyToId}::uuid, ${row.quoteOfId}::uuid, ${row.body}, ${row.media === null ? null : JSON.stringify(row.media)}::text::jsonb, ${row.displayName}, ${row.bio}, ${row.handle},
                ${row.salt}, ${row.digest})
        returning id, ${iso("taken_at")} as taken_at`,
  );
  return { id: inserted!.id, takenAt: inserted!.taken_at };
}

// ---------------------------------------------------------------- decisions

/** What a case is about, or null when no case has the id. */
export async function caseTarget(q: Runner, caseId: string): Promise<{ type: TargetType; id: string } | null> {
  const [row] = await rows<{ target_type: TargetType; target_id: string }>(q, sql`select target_type, target_id from cases where id = ${caseId}::uuid`);
  return row ? { type: row.target_type, id: row.target_id } : null;
}

/**
 * The decision's row, from the params its staff key confirmed and the account that decided. The id is the API's, so the
 * audit row can name the decision; everything else the row holds is the triggers'.
 */
export async function insertDecision(tx: DbTx, row: { id: string; caseId: string; decidedBy: string; params: CaseDecidedParams }): Promise<void> {
  const p = row.params;
  await tx.execute(
    sql`insert into decisions (id, case_id, kind, reviews_decision_id, seen_state_version, through_seq, outcome, ground, rule_id, rules_version, redress_version, category, category_keyword,
                               snapshot_id, snapshot_digest, facts_digest, reason_digest, legal_reference_digest, decided_by)
        values (${row.id}::uuid, ${row.caseId}::uuid, ${p.kind}::decision_kind, ${p.reviewsDecisionId}::uuid, ${p.stateVersion}::int, ${p.throughSeq}::int, ${p.outcome}::decision_outcome,
                ${p.ground}::decision_ground, ${p.ruleId}, ${p.rulesVersion}::smallint, ${p.redressVersion}::smallint, ${p.category}, ${p.categoryKeyword},
                ${p.snapshotId}::uuid, ${p.snapshotDigest}, ${p.factsDigest}, ${p.reasonDigest}, ${p.legalReferenceDigest}, ${row.decidedBy}::uuid)`,
  );
}

/** One measure or reversal of a decision. Its target, the measure it lifts and whether it changes anything are the triggers'. */
export async function insertAction(tx: DbTx, decisionId: string, action: { kind: ActionKind; mediaId: string | null }): Promise<void> {
  await tx.execute(sql`insert into decision_actions (decision_id, kind, media_id) values (${decisionId}::uuid, ${action.kind}::action_kind, ${action.mediaId}::uuid)`);
}

/**
 * Whether the seal a decision has just recorded is in force, asked of the view itself, inside the decision's transaction:
 * the one definition of which measures stand, never a copy of its clause.
 */
export async function sealInForce(tx: DbTx, decisionId: string): Promise<boolean> {
  const [row] = await rows<{ held: boolean }>(tx, sql`select exists (select 1 from measures_in_force m where m.decision_id = ${decisionId}::uuid and m.kind = 'seal_media') as held`);
  return row!.held;
}

/**
 * How many decisions a staff account made in the last `windowMs`, by the database's clock: exact for any window, and
 * unaffected by a restart of the limit store. One read of the index on who decided.
 */
export async function recentDecisionsBy(q: Runner, staffId: string, windowMs: number): Promise<number> {
  const [row] = await rows<{ n: number }>(q, sql`select count(*)::int as n from decisions where decided_by = ${staffId}::uuid and decided_at > now() - make_interval(secs => ${windowMs / 1000}::float8)`);
  return row!.n;
}

/** The audit row of a confirmed action, as public.append_confirmed_audit writes it. */
export interface ConfirmedAuditRow {
  actorId: string;
  keyId: string;
  action: "case_decided" | "appeals_reviewed" | "identity_revealed";
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  staffSession: string;
  actionHash: string;
  stepUp: StaffStoredAssertion;
  requestId: string;
  /** The step-up challenge's expiry: the function refuses a row that joins the chain at or after it. */
  expiresAt: Date;
}

/**
 * Writes a confirmed action's audit row through public.append_confirmed_audit, as the last statement of the action's
 * transaction: the function checks that the acting account and its key are still live, writes the row, and refuses it when
 * the challenge had expired by then, which rolls the whole transaction back. The row holds the chain's head until the
 * commit, so nothing that can wait may run after it. Answers the row's place in the chain.
 */
export async function appendConfirmedAudit(tx: DbTx, row: ConfirmedAuditRow): Promise<number> {
  // The jsonb arguments go as text and are cast, so the driver sends them exactly as serialised here.
  const [written] = await rows<{ place: string }>(
    tx,
    sql`select public.append_confirmed_audit(${row.actorId}::uuid, ${row.keyId}::uuid, ${row.action}::text, ${row.targetType}::text, ${row.targetId}::text,
          ${JSON.stringify(row.metadata)}::text::jsonb, ${row.staffSession}::uuid, ${row.actionHash}::text, ${JSON.stringify(row.stepUp)}::text::jsonb,
          ${row.requestId}::text, ${row.expiresAt.getTime()}::bigint)::text as place`,
  );
  return Number(written!.place);
}

// ---------------------------------------------------------------- the console: recusal, the day's limits and the access log

/** A timestamptz expression as a UTC day. The expression is written here, never input. */
const day = (expression: string) => sql.raw(`to_char(${expression} at time zone 'UTC', 'YYYY-MM-DD')`);

/** Midnight UTC of the database's day: where a staff account's daily counts begin. */
const TODAY = sql`(date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')`;

/**
 * Whether the staff account is too close to the case's subject to open it: the account itself, a personal account the
 * operator linked to it, or one that account follows, blocks, mutes or replied to. The database answers one boolean, and
 * never looks at who reported, so a refused read says nothing about that. False for a case that does not exist.
 */
export async function staffCaseConflict(q: Runner, staffId: string, caseId: string): Promise<boolean> {
  const [row] = await rows<{ conflict: boolean }>(q, sql`select public.staff_case_conflict(${staffId}::uuid, ${caseId}::uuid, false) as conflict`);
  return row!.conflict;
}

/** What one staff account may do in a UTC day. The operator changes the numbers with the command line. */
export interface DailyLimits {
  caseOpens: number;
  findings: number;
  reveals: number;
}

/** The day's limits from the single row the migration wrote; the defaults when the row is missing. */
export async function dailyLimits(q: Runner): Promise<DailyLimits> {
  const [row] = await rows<{ case_opens_per_day: number; findings_per_day: number; reveals_per_day: number }>(q, sql`select case_opens_per_day, findings_per_day, reveals_per_day from moderation_limits where id = 1`);
  return { caseOpens: row?.case_opens_per_day ?? 400, findings: row?.findings_per_day ?? 50, reveals: row?.reveals_per_day ?? 10 };
}

/** How many different cases the staff account has opened since midnight UTC, and whether this case is among them. */
export async function casesOpenedToday(q: Runner, staffId: string, caseId: string): Promise<{ cases: number; thisCase: boolean }> {
  const [row] = await rows<{ n: number; this_case: boolean }>(
    q,
    sql`select count(distinct case_id)::int as n, coalesce(bool_or(case_id = ${caseId}::uuid), false) as this_case
          from case_access_log where staff_id = ${staffId}::uuid and kind = 'case_opened' and at >= ${TODAY}`,
  );
  return { cases: row!.n, thisCase: row!.this_case };
}

/** How many findings the staff account has opened since midnight UTC. */
export async function findingsOpenedToday(q: Runner, staffId: string): Promise<number> {
  const [row] = await rows<{ n: number }>(q, sql`select count(*)::int as n from intakes where finding_by = ${staffId}::uuid and received_at >= ${TODAY}`);
  return row!.n;
}

/** How many sources the staff account has revealed since midnight UTC. */
export async function revealsToday(q: Runner, staffId: string): Promise<number> {
  const [row] = await rows<{ n: number }>(q, sql`select count(*)::int as n from case_access_log where staff_id = ${staffId}::uuid and kind = 'identity_revealed' and at >= ${TODAY}`);
  return row!.n;
}

/** One row of the access log: a case opened, an image viewed, or a source revealed with the text that gives the reason. The database stamps it. */
export async function insertAccess(
  q: Runner,
  row: { staffId: string; caseId: string; kind: "case_opened" | "image_viewed" | "identity_revealed"; mediaId?: string; itemId?: string; textId?: string },
): Promise<Date> {
  const [written] = await rows<{ at: string }>(
    q,
    sql`insert into case_access_log (staff_id, case_id, kind, media_id, intake_item_id, text_id)
        values (${row.staffId}::uuid, ${row.caseId}::uuid, ${row.kind}::access_kind, ${row.mediaId ?? null}::uuid, ${row.itemId ?? null}::uuid, ${row.textId ?? null}::uuid)
        returning ${iso("at")} as at`,
  );
  return new Date(written!.at);
}

/** A profile's public handle, or null when no row has the id: how the console and the staff mails name a staff account. */
export async function handleOf(q: Runner, profileId: string): Promise<string | null> {
  const [row] = await rows<{ handle: string }>(q, sql`select handle from profiles where id = ${profileId}::uuid`);
  return row?.handle ?? null;
}

// ---------------------------------------------------------------- the console: the case

/** A case's own row. */
export interface CaseRow {
  id: string;
  targetType: TargetType;
  targetId: string;
  lane: Lane;
  intakeSeq: number;
  answeredSeq: number;
  stateVersion: number;
  openedAt: string;
  closedAt: string | null;
}

export async function caseById(q: Runner, caseId: string): Promise<CaseRow | null> {
  const [row] = await rows<{ id: string; target_type: TargetType; target_id: string; lane: Lane; intake_seq: number; answered_seq: number; state_version: number; opened_at: string; closed_at: string | null }>(
    q,
    sql`select id, target_type, target_id, lane, intake_seq, answered_seq, state_version, ${iso("opened_at")} as opened_at, ${iso("closed_at")} as closed_at from cases where id = ${caseId}::uuid`,
  );
  if (!row) return null;
  return { id: row.id, targetType: row.target_type, targetId: row.target_id, lane: row.lane, intakeSeq: row.intake_seq, answeredSeq: row.answered_seq, stateVersion: row.state_version, openedAt: row.opened_at, closedAt: row.closed_at };
}

/** A post as it stands, for the case that is about it: read, never written; the rows are the social module's. */
export interface LivePost {
  authorId: string;
  authorHandle: string;
  state: "visible" | "withheld" | "removed" | "deleted_by_author";
  level: "visible" | "withheld" | "removed";
  /** Gate V's answer for the case page: false while the post is frozen, so the console asks for no image. */
  imagesAllowed: boolean;
}

export async function livePost(q: Runner, postId: string): Promise<LivePost | null> {
  const [row] = await rows<{ author_id: string; author_handle: string; state: LivePost["state"]; level: LivePost["level"]; images_allowed: boolean }>(
    q,
    sql`select p.author_id, a.handle as author_handle, p.state, p.moderation_level as level, not public.post_frozen(p.id) as images_allowed
          from posts p join profiles a on a.id = p.author_id where p.id = ${postId}::uuid`,
  );
  return row ? { authorId: row.author_id, authorHandle: row.author_handle, state: row.state, level: row.level, imagesAllowed: row.images_allowed } : null;
}

/** An account's fields as they stand, for the case that is about it. */
export async function liveAccount(q: Runner, accountId: string): Promise<{ handle: string; displayName: string; bio: string; deleted: boolean } | null> {
  const [row] = await rows<{ handle: string; display_name: string; bio: string; deleted: boolean }>(
    q,
    sql`select handle, display_name, bio, deleted_at is not null as deleted from profiles where id = ${accountId}::uuid`,
  );
  return row ? { handle: row.handle, displayName: row.display_name, bio: row.bio, deleted: row.deleted } : null;
}

/** Whether the case is on the path for child sexual abuse material at all (it holds a suspect item or a seal), and whether a suspect item of it is unanswered. */
export async function suspicionOf(q: Runner, caseId: string): Promise<{ holds: boolean; open: boolean }> {
  const [row] = await rows<{ holds: boolean; open: boolean }>(
    q,
    sql`select (exists (select 1 from intake_items i where i.case_id = ${caseId}::uuid and i.suspect)
             or exists (select 1 from decision_actions a join decisions d on d.id = a.decision_id where d.case_id = ${caseId}::uuid and a.kind = 'seal_media')) as holds,
               exists (select 1 from intake_items i where i.case_id = ${caseId}::uuid and i.suspect and i.answered_by is null) as open`,
  );
  return { holds: row!.holds, open: row!.open };
}

/** How often, and when last, an admin answered a report of this kind without a seal. */
export interface EarlierAnswers {
  count: number;
  /** The UTC day of the latest such answer. */
  lastOn: string | null;
}

/**
 * The final decisions of the last `months` months that answered a suspect item without a seal: about this target, and
 * about its author's profile or any of the author's posts. Such a decision is a stored fact (final, taken on a suspicion,
 * holding no seal), so nothing here is computed from which case held which item. Counts and days only.
 */
export async function earlierAnswers(q: Runner, target: { type: TargetType; id: string }, authorId: string | null, months: number): Promise<{ target: EarlierAnswers; author: EarlierAnswers }> {
  const about = sql`(c.target_type = ${target.type}::moderation_target and c.target_id = ${target.id}::uuid)`;
  const ofAuthor =
    authorId === null
      ? about
      : sql`((c.target_type = 'account' and c.target_id = ${authorId}::uuid) or (c.target_type = 'post' and c.target_id in (select p.id from posts p where p.author_id = ${authorId}::uuid)))`;
  const [row] = await rows<{ target_count: number; target_last: string | null; author_count: number; author_last: string | null }>(
    q,
    sql`select (count(*) filter (where ${about}))::int as target_count,
               to_char(max(d.decided_at) filter (where ${about}) at time zone 'UTC', 'YYYY-MM-DD') as target_last,
               count(*)::int as author_count,
               ${day("max(d.decided_at)")} as author_last
          from decisions d join cases c on c.id = d.case_id
         where d.kind = 'final' and d.suspect and d.decided_at >= now() - make_interval(months => ${months}::int)
           and not exists (select 1 from decision_actions a where a.decision_id = d.id and a.kind = 'seal_media')
           and ${ofAuthor}`,
  );
  return { target: { count: row!.target_count, lastOn: row!.target_last }, author: { count: row!.author_count, lastOn: row!.author_last } };
}

/** The UTC day an image of the post was last served to staff by the console's image route, on any case about the post; null when none was. */
export async function imagesOpenedOn(q: Runner, postId: string): Promise<string | null> {
  const [row] = await rows<{ opened_on: string | null }>(
    q,
    sql`select ${day("max(l.at)")} as opened_on from case_access_log l join cases c on c.id = l.case_id
         where l.kind = 'image_viewed' and c.target_type = 'post' and c.target_id = ${postId}::uuid`,
  );
  return row!.opened_on;
}

/** A snapshot as stored, with the database's word on whether its content may be shown. */
export interface SnapshotRead extends Omit<SnapshotRow, "salt"> {
  id: string;
  takenAt: string;
  withheld: boolean;
  erased: boolean;
  /** Null for an erased snapshot, which keeps its digest and loses its salt with its content. */
  salt: string | null;
}

/** The case's snapshots, newest first. `withheld` is the one predicate by which a snapshot's content is withheld wherever it would be shown. */
export async function caseSnapshots(q: Runner, caseId: string, newestOnly = false): Promise<SnapshotRead[]> {
  const found = await rows<{
    id: string;
    taken_at: string;
    withheld: boolean;
    erased: boolean;
    target_type: TargetType;
    target_id: string;
    author_handle: string;
    post_state: SnapshotRow["postState"];
    post_created_at: string | null;
    reply_to_id: string | null;
    quote_of_id: string | null;
    body: string | null;
    media: string | null;
    display_name: string | null;
    bio: string | null;
    handle: string | null;
    salt: string | null;
    digest: string;
  }>(
    q,
    sql`select s.id, ${iso("s.taken_at")} as taken_at, public.snapshot_withheld(s.id) as withheld, s.erased_at is not null as erased, s.target_type, s.target_id, s.author_handle, s.post_state,
               ${iso("s.post_created_at")} as post_created_at, s.reply_to_id, s.quote_of_id, s.body, s.media::text as media, s.display_name, s.bio, s.handle, s.salt, s.digest
          from evidence_snapshots s where s.case_id = ${caseId}::uuid order by s.taken_at desc, s.id desc ${newestOnly ? sql`limit 1` : sql``}`,
  );
  return found.map((row) => ({
    id: row.id,
    takenAt: row.taken_at,
    withheld: row.withheld,
    erased: row.erased,
    caseId,
    targetType: row.target_type,
    targetId: row.target_id,
    authorHandle: row.author_handle,
    postState: row.post_state,
    postCreatedAt: row.post_created_at,
    replyToId: row.reply_to_id,
    quoteOfId: row.quote_of_id,
    body: row.body,
    media: row.media === null ? null : (JSON.parse(row.media) as SnapshotRow["media"]),
    displayName: row.display_name,
    bio: row.bio,
    handle: row.handle,
    salt: row.salt,
    digest: row.digest,
  }));
}

/**
 * Whether a snapshot of the case that still holds its content lists the image. The console's image route asks this of
 * the module's own evidence before it asks the media module for anything: `media` is the list a snapshot of a post
 * copied, each entry with its image's id in the spelling the database writes.
 */
export async function snapshotListsImage(q: Runner, caseId: string, mediaId: string): Promise<boolean> {
  const [row] = await rows<{ listed: boolean }>(
    q,
    sql`select exists (select 1 from evidence_snapshots s
                        where s.case_id = ${caseId}::uuid and s.erased_at is null and s.media @> ${JSON.stringify([{ id: mediaId }])}::text::jsonb) as listed`,
  );
  return row!.listed;
}

/** One item of a case with its intake's ground and texts, as the case page reads it. */
export interface CaseItemRow {
  id: string;
  seq: number;
  position: number;
  createdAt: string;
  lane: Lane;
  targetType: TargetType;
  targetId: string;
  namedHandle: string | null;
  mediaId: string | null;
  suspect: boolean;
  reporterAccountId: string | null;
  outcome: string | null;
  answeredBy: string | null;
  statement: string | null;
  intakeKind: "user" | "finding";
  channel: "signed_in" | "signed_out" | "staff";
  contactId: string | null;
  ruleId: string | null;
  allegesIllegal: boolean;
  csam: boolean;
  category: string;
  categoryKeyword: string | null;
  citedLaw: string | null;
  explanation: string | null;
  erased: boolean;
  reexaminesPosition: number | null;
  reexaminesYourDecision: boolean;
  quotedCaseId: string | null;
}

/**
 * The case's items in the order they attached. For a re-examination: the position of the item it re-examines in its
 * notice, and whether `personId` decided that item. For a suspect item about a post that quotes another: the case of the
 * same notice's item on the quoted post (the one korbat added, or the one the notice named itself).
 */
export async function caseItems(q: Runner, caseId: string, personId: string): Promise<CaseItemRow[]> {
  const found = await rows<{
    id: string;
    seq: number;
    position: number;
    created_at: string;
    lane: Lane;
    target_type: TargetType;
    target_id: string;
    named_handle: string | null;
    media_id: string | null;
    suspect: boolean;
    reporter_account_id: string | null;
    outcome: string | null;
    answered_by: string | null;
    statement: string | null;
    intake_kind: "user" | "finding";
    channel: CaseItemRow["channel"];
    contact_id: string | null;
    rule_id: string | null;
    alleges_illegal: boolean;
    csam: boolean;
    category: string;
    category_keyword: string | null;
    cited_law: string | null;
    explanation: string | null;
    erased: boolean;
    reexamines_position: number | null;
    reexamines_your_decision: boolean;
    quoted_case_id: string | null;
  }>(
    q,
    sql`select i.id, i.seq, i.position, ${iso("i.created_at")} as created_at, i.lane, i.target_type, i.target_id, i.named_handle, i.media_id, i.suspect, i.reporter_account_id,
               i.outcome, i.answered_by, i.statement,
               n.kind as intake_kind, n.channel, n.contact_id, n.rule_id, n.alleges_illegal, n.csam, n.category, n.category_keyword, n.cited_law, n.explanation,
               n.erased_at is not null as erased,
               (select r.position from intake_items r where r.id = i.reexamines_item_id) as reexamines_position,
               coalesce((select d.decided_by = ${personId}::uuid from intake_items r join decisions d on d.id = r.answered_by where r.id = i.reexamines_item_id), false) as reexamines_your_decision,
               case when i.suspect and i.target_type = 'post' then
                 (select a.case_id from posts p join intake_items a on a.intake_id = i.intake_id and a.target_type = 'post' and a.target_id = p.quote_of_id and a.case_id is not null
                   where p.id = i.target_id order by a.created_at desc, a.id limit 1) end as quoted_case_id
          from intake_items i join intakes n on n.id = i.intake_id
         where i.case_id = ${caseId}::uuid order by i.seq`,
  );
  return found.map((row) => ({
    id: row.id,
    seq: row.seq,
    position: row.position,
    createdAt: row.created_at,
    lane: row.lane,
    targetType: row.target_type,
    targetId: row.target_id,
    namedHandle: row.named_handle,
    mediaId: row.media_id,
    suspect: row.suspect,
    reporterAccountId: row.reporter_account_id,
    outcome: row.outcome,
    answeredBy: row.answered_by,
    statement: row.statement,
    intakeKind: row.intake_kind,
    channel: row.channel,
    contactId: row.contact_id,
    ruleId: row.rule_id,
    allegesIllegal: row.alleges_illegal,
    csam: row.csam,
    category: row.category,
    categoryKeyword: row.category_keyword,
    citedLaw: row.cited_law,
    explanation: row.explanation,
    erased: row.erased,
    reexaminesPosition: row.reexamines_position,
    reexaminesYourDecision: row.reexamines_your_decision,
    quotedCaseId: row.quoted_case_id,
  }));
}

/** What a reporter's summary is banded from: when the account was made and four counts over its items that korbat still keeps. */
export interface ReporterFacts {
  createdAt: Date | null;
  filed: number;
  /** Items whose outcome was released, but those answered while nobody could open the images. */
  decided: number;
  actedOn: number;
  /** Released items about a post that a decision answered without action while its images were out of sight. */
  answeredUnseen: number;
}

/**
 * Each reporter's facts, computed on read from the reporter's own rows, never stored. An item is decided once its outcome
 * is released and acted on when that is a restriction, whole or in part. An item that was answered without action while
 * nobody could open the post's images is counted apart and is not among the decided ones.
 */
export async function reporterFacts(q: Runner, reporterIds: readonly string[]): Promise<Map<string, ReporterFacts>> {
  if (reporterIds.length === 0) return new Map();
  const unseen = sql`(x.target_type = 'post' and not x.suspect and x.shown_outcome in ('no_violation', 'not_evident') and coalesce((select d.unseen from decisions d where d.id = x.answered_by), false))`;
  const found = await rows<{ id: string; created_at: string | null; filed: number; decided: number; acted_on: number; unseen: number }>(
    q,
    sql`select r.id, ${iso("p.created_at")} as created_at,
               (select count(*)::int from intake_items x where x.reporter_account_id = r.id) as filed,
               (select count(*)::int from intake_items x where x.reporter_account_id = r.id and x.shown_outcome is not null and not ${unseen}) as decided,
               (select count(*)::int from intake_items x where x.reporter_account_id = r.id and x.shown_outcome in ('restricted_rule', 'restricted_legal', 'partly_reversed')) as acted_on,
               (select count(*)::int from intake_items x where x.reporter_account_id = r.id and x.shown_outcome is not null and ${unseen}) as unseen
          from unnest(${uuids(reporterIds)}) as r(id) left join profiles p on p.id = r.id`,
  );
  return new Map(found.map((row) => [row.id, { createdAt: row.created_at === null ? null : new Date(row.created_at), filed: row.filed, decided: row.decided, actedOn: row.acted_on, answeredUnseen: row.unseen }]));
}

/** A decision of the case with its texts, as the case page reads it; who decided is a handle. */
export interface CaseDecisionRow {
  id: string;
  kind: "interim" | "final" | "review" | "correction";
  outcome: string;
  ground: string | null;
  ruleId: string | null;
  rulesVersion: number;
  redressVersion: number;
  category: string;
  categoryKeyword: string | null;
  source: string;
  decidedAt: string;
  staffHandle: string;
  throughSeq: number;
  answersFromSeq: number | null;
  reviewsDecisionId: string | null;
  snapshotId: string;
  suspect: boolean;
  unseen: boolean;
  needsAdmin: boolean;
  endedInterim: boolean;
  facts: string | null;
  reason: string | null;
  legalReference: string | null;
}

/** The case's decisions, oldest first. A text is read by the digest the decision confirmed; an erased text is null. */
export async function caseDecisions(q: Runner, caseId: string): Promise<CaseDecisionRow[]> {
  const found = await rows<Record<string, unknown>>(
    q,
    sql`select d.id, d.kind, d.outcome, d.ground, d.rule_id, d.rules_version, d.redress_version, d.category, d.category_keyword, d.source, ${iso("d.decided_at")} as decided_at,
               s.handle as staff_handle, d.through_seq, d.answers_from_seq, d.reviews_decision_id, d.snapshot_id, d.suspect, d.unseen, d.needs_admin, d.ended_interim,
               (select t.text from staff_texts t where t.digest = d.facts_digest) as facts,
               (select t.text from staff_texts t where t.digest = d.reason_digest) as reason,
               (select t.text from staff_texts t where t.digest = d.legal_reference_digest) as legal_reference
          from decisions d join profiles s on s.id = d.decided_by
         where d.case_id = ${caseId}::uuid order by d.decided_at, d.id`,
  );
  return found.map((row) => ({
    id: row.id as string,
    kind: row.kind as CaseDecisionRow["kind"],
    outcome: row.outcome as string,
    ground: row.ground as string | null,
    ruleId: row.rule_id as string | null,
    rulesVersion: row.rules_version as number,
    redressVersion: row.redress_version as number,
    category: row.category as string,
    categoryKeyword: row.category_keyword as string | null,
    source: row.source as string,
    decidedAt: row.decided_at as string,
    staffHandle: row.staff_handle as string,
    throughSeq: row.through_seq as number,
    answersFromSeq: row.answers_from_seq as number | null,
    reviewsDecisionId: row.reviews_decision_id as string | null,
    snapshotId: row.snapshot_id as string,
    suspect: row.suspect as boolean,
    unseen: row.unseen as boolean,
    needsAdmin: row.needs_admin as boolean,
    endedInterim: row.ended_interim as boolean,
    facts: row.facts as string | null,
    reason: row.reason as string | null,
    legalReference: row.legal_reference as string | null,
  }));
}

/** One ledger row of a decision of the case: whether it is in force by the view's one definition, and the decision whose reversal lifted it. */
export interface CaseActionRow {
  id: string;
  decisionId: string;
  kind: ActionKind;
  mediaId: string | null;
  noEffect: "already" | "deleted" | null;
  reversesActionId: string | null;
  inForce: boolean;
  liftedBy: string | null;
}

export async function caseActions(q: Runner, caseId: string): Promise<CaseActionRow[]> {
  const found = await rows<{ id: string; decision_id: string; kind: ActionKind; media_id: string | null; no_effect: CaseActionRow["noEffect"]; reverses_action_id: string | null; in_force: boolean; lifted_by: string | null }>(
    q,
    sql`select a.id, a.decision_id, a.kind, a.media_id, a.no_effect, a.reverses_action_id,
               exists (select 1 from measures_in_force m where m.id = a.id) as in_force,
               (select r.decision_id from decision_actions r where r.reverses_action_id = a.id) as lifted_by
          from decision_actions a join decisions d on d.id = a.decision_id
         where d.case_id = ${caseId}::uuid order by a.kind::text, a.media_id`,
  );
  return found.map((row) => ({ id: row.id, decisionId: row.decision_id, kind: row.kind, mediaId: row.media_id, noEffect: row.no_effect, reversesActionId: row.reverses_action_id, inForce: row.in_force, liftedBy: row.lifted_by }));
}

/** What a seal covers, from the list the database wrote when it was recorded: counts, and at most `max` rows of the list, oldest post first. */
export async function sealCovers(q: Runner, actionId: string, max: number): Promise<{ posts: number; images: number; deletedPosts: number; list: { postId: string; createdAt: string; images: number }[] }> {
  const [counts] = await rows<{ posts: number; images: number; deleted_posts: number }>(
    q,
    sql`select count(*)::int as posts, coalesce(sum(s.images), 0)::int as images, (count(*) filter (where p.state = 'deleted_by_author'))::int as deleted_posts
          from seal_posts s left join posts p on p.id = s.post_id where s.action_id = ${actionId}::uuid`,
  );
  const list = await rows<{ post_id: string; created_at: string; images: number }>(
    q,
    sql`select s.post_id, ${iso("p.created_at")} as created_at, s.images from seal_posts s join posts p on p.id = s.post_id
         where s.action_id = ${actionId}::uuid order by p.created_at, s.post_id limit ${max}::int`,
  );
  return { posts: counts!.posts, images: counts!.images, deletedPosts: counts!.deleted_posts, list: list.map((row) => ({ postId: row.post_id, createdAt: row.created_at, images: row.images })) };
}

/** The appeals of the case's decisions, oldest first; a statement is null when there was none or it was erased. */
export async function caseAppeals(q: Runner, caseId: string): Promise<{ id: string; decisionId: string; filedAt: string; statement: string | null; answeredAt: string | null; result: "kept" | "partly_reversed" | "reversed" | null; answeredBy: string | null }[]> {
  const found = await rows<{ id: string; decision_id: string; filed_at: string; statement: string | null; answered_at: string | null; result: "kept" | "partly_reversed" | "reversed" | null; answered_by: string | null }>(
    q,
    sql`select a.id, a.decision_id, ${iso("a.filed_at")} as filed_at, a.statement, ${iso("a.answered_at")} as answered_at, a.result, a.answered_by
          from appeals a join decisions d on d.id = a.decision_id where d.case_id = ${caseId}::uuid order by a.filed_at, a.id`,
  );
  return found.map((row) => ({ id: row.id, decisionId: row.decision_id, filedAt: row.filed_at, statement: row.statement, answeredAt: row.answered_at, result: row.result, answeredBy: row.answered_by }));
}

/** The case's notes and its recorded choices not to seal, oldest first, each with its writer's handle. Erased ones are gone with their text. */
export async function caseStaffTexts(q: Runner, caseId: string): Promise<{ id: string; kind: "note" | "seal_declined"; staffHandle: string; createdAt: string; text: string }[]> {
  const found = await rows<{ id: string; kind: "note" | "seal_declined"; staff_handle: string; created_at: string; text: string }>(
    q,
    sql`select t.id, t.kind, p.handle as staff_handle, ${iso("t.created_at")} as created_at, t.text
          from staff_texts t join profiles p on p.id = t.author_id
         where t.case_id = ${caseId}::uuid and t.kind in ('note', 'seal_declined') and t.erased_at is null order by t.created_at, t.id`,
  );
  return found.map((row) => ({ id: row.id, kind: row.kind, staffHandle: row.staff_handle, createdAt: row.created_at, text: row.text }));
}

/** A saved text that no decision or reveal has named yet, with its salt. */
export interface DraftRow {
  id: string;
  kind: string;
  text: string;
  salt: string;
  digest: string;
  createdAt: string;
}

/** The staff account's own drafts on the case: unconfirmed, unerased, and of a kind that waits for a decision or a reveal. */
export async function ownDrafts(q: Runner, caseId: string, authorId: string): Promise<DraftRow[]> {
  const found = await rows<{ id: string; kind: string; text: string; salt: string; digest: string; created_at: string }>(
    q,
    sql`select id, kind, text, salt, digest, ${iso("created_at")} as created_at from staff_texts
         where case_id = ${caseId}::uuid and author_id = ${authorId}::uuid and confirmed_at is null and erased_at is null and kind not in ('note', 'seal_declined')
         order by created_at, id`,
  );
  return found.map((row) => ({ id: row.id, kind: row.kind, text: row.text, salt: row.salt, digest: row.digest, createdAt: row.created_at }));
}

/** One event of a case's history, from the view that is its one definition; a staff account is its handle. */
export interface HistoryRow {
  at: string;
  event: string;
  refId: string | null;
  seq: number | null;
  intakeKind: string | null;
  ruleId: string | null;
  allegesIllegal: boolean | null;
  csam: boolean | null;
  reexamination: boolean | null;
  decisionKind: string | null;
  outcome: string | null;
  staffHandle: string | null;
  result: string | null;
}

export async function caseHistory(q: Runner, caseId: string): Promise<HistoryRow[]> {
  const found = await rows<Record<string, unknown>>(
    q,
    sql`select ${iso("h.at")} as at, h.event, h.ref_id, h.seq, h.intake_kind, h.rule_id, h.alleges_illegal, h.csam, h.reexamination, h.decision_kind, h.outcome, p.handle as staff_handle, h.result
          from case_history h left join profiles p on p.id = h.staff_id
         where h.case_id = ${caseId}::uuid order by h.at, h.event, h.ref_id`,
  );
  return found.map((row) => ({
    at: row.at as string,
    event: row.event as string,
    refId: row.ref_id as string | null,
    seq: row.seq as number | null,
    intakeKind: row.intake_kind as string | null,
    ruleId: row.rule_id as string | null,
    allegesIllegal: row.alleges_illegal as boolean | null,
    csam: row.csam as boolean | null,
    reexamination: row.reexamination as boolean | null,
    decisionKind: row.decision_kind as string | null,
    outcome: row.outcome as string | null,
    staffHandle: row.staff_handle as string | null,
    result: row.result as string | null,
  }));
}

// ---------------------------------------------------------------- the console: saved texts

/** Everything someone else wrote on the case that a staff text must not quote: explanations, cited laws, re-examination statements and appeal statements. */
export async function theirTexts(q: Runner, caseId: string): Promise<string[]> {
  const found = await rows<{ text: string }>(
    q,
    sql`select n.explanation as text from intakes n where n.explanation is not null and exists (select 1 from intake_items i where i.intake_id = n.id and i.case_id = ${caseId}::uuid)
        union all
        select n.cited_law from intakes n where n.cited_law is not null and exists (select 1 from intake_items i where i.intake_id = n.id and i.case_id = ${caseId}::uuid)
        union all
        select i.statement from intake_items i where i.case_id = ${caseId}::uuid and i.statement is not null
        union all
        select a.statement from appeals a join decisions d on d.id = a.decision_id where d.case_id = ${caseId}::uuid and a.statement is not null`,
  );
  return found.map((row) => row.text);
}

/** Stores a staff text; the trigger stamps it and leaves it unconfirmed, and the table's CHECK holds text, salt and digest together. Answers its id. */
export async function insertStaffText(q: Runner, row: { caseId: string; authorId: string; kind: string; text: string; salt: string; digest: string }): Promise<string> {
  const [inserted] = await rows<{ id: string }>(
    q,
    sql`insert into staff_texts (case_id, author_id, kind, text, salt, digest)
        values (${row.caseId}::uuid, ${row.authorId}::uuid, ${row.kind}::staff_text_kind, ${row.text}, ${row.salt}, ${row.digest}) returning id`,
  );
  return inserted!.id;
}

/** The staff account's own draft with this digest on this case and of this kind, or null: what a repeated save answers. */
export async function ownDraftByDigest(q: Runner, row: { caseId: string; authorId: string; kind: string; digest: string }): Promise<string | null> {
  const [found] = await rows<{ id: string }>(
    q,
    sql`select id from staff_texts where digest = ${row.digest} and case_id = ${row.caseId}::uuid and author_id = ${row.authorId}::uuid and kind = ${row.kind}::staff_text_kind
           and confirmed_at is null and erased_at is null`,
  );
  return found?.id ?? null;
}

// ---------------------------------------------------------------- the console: revealing a source

/** An item with what decides whether its source can be revealed: its case, its intake's path and what links it to a person. */
export interface RevealItemRow {
  caseId: string | null;
  intakeKind: "user" | "finding";
  channel: "signed_in" | "signed_out" | "staff";
  csam: boolean;
  reporterAccountId: string | null;
  contactId: string | null;
}

export async function revealItem(q: Runner, itemId: string): Promise<RevealItemRow | null> {
  const [row] = await rows<{ case_id: string | null; intake_kind: "user" | "finding"; channel: RevealItemRow["channel"]; csam: boolean; reporter_account_id: string | null; contact_id: string | null }>(
    q,
    sql`select i.case_id, n.kind as intake_kind, n.channel, n.csam, i.reporter_account_id, n.contact_id from intake_items i join intakes n on n.id = i.intake_id where i.id = ${itemId}::uuid`,
  );
  return row ? { caseId: row.case_id, intakeKind: row.intake_kind, channel: row.channel, csam: row.csam, reporterAccountId: row.reporter_account_id, contactId: row.contact_id } : null;
}

/** The staff account's saved reason for a reveal on this case, by its digest: unerased, unconfirmed, and named by no access row yet. Its id, or null. */
export async function revealReason(q: Runner, row: { caseId: string; authorId: string; digest: string }): Promise<string | null> {
  const [found] = await rows<{ id: string }>(
    q,
    sql`select t.id from staff_texts t
         where t.digest = ${row.digest} and t.case_id = ${row.caseId}::uuid and t.author_id = ${row.authorId}::uuid and t.kind = 'reveal_reason'
           and t.confirmed_at is null and t.erased_at is null
           and not exists (select 1 from case_access_log l where l.text_id = t.id)`,
  );
  return found?.id ?? null;
}

/** The handle of the reporter the item is still linked to, or null when the link is gone. Read only after a reveal's commit. */
export async function reporterHandle(q: Runner, itemId: string): Promise<string | null> {
  const [row] = await rows<{ handle: string }>(q, sql`select p.handle from intake_items i join profiles p on p.id = i.reporter_account_id where i.id = ${itemId}::uuid`);
  return row?.handle ?? null;
}

// ---------------------------------------------------------------- the console: the queue

/** A row of the queue with its sort key: the lane, whether it is deferred, the oldest unanswered item's time to the microsecond, and the id. */
export interface QueueRead {
  id: string;
  lane: Lane;
  targetType: TargetType;
  openedAt: string;
  oldestOpenAt: string;
  /** The same time as the database holds it, to the microsecond: the cursor's. */
  sortAt: string;
  openItems: number;
  rules: string[];
  categories: string[];
  allegesIllegal: boolean;
  suspect: boolean;
  reexamination: boolean;
  deferred: boolean;
}

/** The place after which a page of the queue begins: the last row's sort key. */
export interface QueueCursor {
  lane: number;
  deferred: boolean;
  sortAt: string;
  id: string;
}

/**
 * Open cases in the queue's order: by lane, then (only with the emergency switch on) the deferred ones last within their
 * lane, then by the oldest unanswered item, then by id. A case is deferred when every unanswered item of it comes from an
 * unproven source: in lanes 1 and 2 a signed-out intake or an account under 48 hours old, in lane 0 a signed-out intake
 * only, so a new account reporting a threat against itself is never deferred. Nothing else orders the queue: no count of
 * reports and no standing of a reporter. `limit` rows after `after`.
 */
export async function queueRows(q: Runner, options: { deferUnproven: boolean; after: QueueCursor | null; limit: number }): Promise<QueueRead[]> {
  const after = options.after;
  const found = await rows<{
    id: string;
    lane: Lane;
    target_type: TargetType;
    opened_at: string;
    oldest_open_at: string;
    sort_at: string;
    open_items: number;
    rules: string;
    categories: string;
    alleges_illegal: boolean;
    suspect: boolean;
    reexamination: boolean;
    deferred: boolean;
  }>(
    q,
    sql`with open_cases as (
          select c.id, c.lane, c.target_type, c.opened_at, coalesce(c.oldest_open_at, c.opened_at) as oldest_open_at, u.open_items, u.rules, u.categories, u.alleges_illegal, u.suspect, u.reexamination,
                 (${options.deferUnproven}::boolean and u.unproven) as deferred
            from cases c
           cross join lateral (
             select count(*)::int as open_items,
                    coalesce(string_agg(distinct n.rule_id, ',' order by n.rule_id), '') as rules,
                    coalesce(string_agg(distinct n.category, ',' order by n.category), '') as categories,
                    coalesce(bool_or(i.alleges_illegal), false) as alleges_illegal,
                    coalesce(bool_or(i.suspect), false) as suspect,
                    coalesce(bool_or(i.reexamines_item_id is not null), false) as reexamination,
                    coalesce(bool_and(n.channel = 'signed_out'
                                      or (c.lane > 0 and exists (select 1 from profiles r where r.id = i.reporter_account_id and r.created_at > now() - interval '48 hours'))), false) as unproven
               from intake_items i join intakes n on n.id = i.intake_id
              where i.case_id = c.id and i.answered_by is null) u
           where c.closed_at is null)
        select o.id, o.lane, o.target_type, ${iso("o.opened_at")} as opened_at, ${iso("o.oldest_open_at")} as oldest_open_at,
               to_char(o.oldest_open_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as sort_at,
               o.open_items, o.rules, o.categories, o.alleges_illegal, o.suspect, o.reexamination, o.deferred
          from open_cases o
         where ${after === null ? sql`true` : sql`(o.lane, o.deferred, o.oldest_open_at, o.id) > (${after.lane}::smallint, ${after.deferred}::boolean, ${after.sortAt}::timestamptz, ${after.id}::uuid)`}
         order by o.lane, o.deferred, o.oldest_open_at, o.id
         limit ${options.limit}::int`,
  );
  const list = (joined: string) => (joined === "" ? [] : joined.split(","));
  return found.map((row) => ({
    id: row.id,
    lane: row.lane,
    targetType: row.target_type,
    openedAt: row.opened_at,
    oldestOpenAt: row.oldest_open_at,
    sortAt: row.sort_at,
    openItems: row.open_items,
    rules: list(row.rules),
    categories: list(row.categories),
    allegesIllegal: row.alleges_illegal,
    suspect: row.suspect,
    reexamination: row.reexamination,
    deferred: row.deferred,
  }));
}

// ---------------------------------------------------------------- the console: the overview

/** Per lane, the open cases and since when the oldest unanswered item of the lane waits. A lane without an open case has no row. */
export async function openByLane(q: Runner): Promise<{ lane: Lane; open: number; oldestAt: string | null }[]> {
  const found = await rows<{ lane: Lane; open: number; oldest: string | null }>(q, sql`select lane, count(*)::int as open, ${iso("min(oldest_open_at)")} as oldest from cases where closed_at is null group by lane`);
  return found.map((row) => ({ lane: row.lane, open: row.open, oldestAt: row.oldest }));
}

/** The appeals no review has answered yet. */
export async function appealsWaiting(q: Runner): Promise<number> {
  const [row] = await rows<{ n: number }>(q, sql`select count(*)::int as n from appeals where answered_by is null`);
  return row!.n;
}

/** The reveals of the last 30 days, newest first, at most `max`, with how many there are in all: time, staff handle and case. */
export async function recentReveals(q: Runner, max: number): Promise<{ total: number; items: { at: string; handle: string; caseId: string }[] }> {
  const found = await rows<{ at: string; handle: string; case_id: string; total: number }>(
    q,
    sql`select ${iso("l.at")} as at, p.handle, l.case_id, (count(*) over ())::int as total
          from case_access_log l join profiles p on p.id = l.staff_id
         where l.kind = 'identity_revealed' and l.at >= now() - interval '30 days'
         order by l.at desc, l.id desc limit ${max}::int`,
  );
  return { total: found[0]?.total ?? 0, items: found.map((row) => ({ at: row.at, handle: row.handle, caseId: row.case_id })) };
}

/** Per staff handle, the images viewed and the findings opened since midnight UTC. */
export async function staffToday(q: Runner): Promise<{ images: { handle: string; count: number }[]; findings: { handle: string; count: number }[] }> {
  const images = await rows<{ handle: string; count: number }>(
    q,
    sql`select p.handle, count(*)::int as count from case_access_log l join profiles p on p.id = l.staff_id where l.kind = 'image_viewed' and l.at >= ${TODAY} group by p.handle order by p.handle`,
  );
  const findings = await rows<{ handle: string; count: number }>(
    q,
    sql`select p.handle, count(*)::int as count from intakes n join profiles p on p.id = n.finding_by where n.kind = 'finding' and n.received_at >= ${TODAY} group by p.handle order by p.handle`,
  );
  return { images: images.map((row) => ({ handle: row.handle, count: row.count })), findings: findings.map((row) => ({ handle: row.handle, count: row.count })) };
}

/** The three kinds of mail by what they wait for, and the decided items the daily release has not released. Counts only. */
export interface MailCounts {
  receipts: number;
  authorMails: number;
  outcomes: number;
}

/**
 * Mails pending for more than an hour, counted from when each became due (an intake's receipt, a decision's time, an
 * outcome's release); mails recorded failed whose give-up time (`giveUpDays` after that same moment) falls in the last 30
 * days; and the items with an outcome that the daily release has not released 26 hours after their decision, or whose
 * changed outcome has waited that long. The release takes about a day at most, so any of the last means it is not
 * finishing.
 */
export async function mailAndReleaseCounts(q: Runner, giveUpDays: number): Promise<{ waiting: MailCounts; failed: MailCounts; releaseOverdue: number }> {
  const gaveUp = (at: string) => sql.raw(`${at} + make_interval(days => ${Number(giveUpDays)}) >= now() - interval '30 days'`);
  const [row] = await rows<Record<string, number>>(
    q,
    sql`select
          (select count(*)::int from intakes where receipt = 'pending' and received_at < now() - interval '1 hour') as receipts_waiting,
          (select count(*)::int from decisions where author_mail = 'pending' and decided_at < now() - interval '1 hour') as author_waiting,
          (select count(*)::int from intake_items where outcome_mail = 'pending' and coalesce(revised_sent_at, outcome_sent_at) < now() - interval '1 hour') as outcomes_waiting,
          (select count(*)::int from intakes where receipt = 'failed' and ${gaveUp("received_at")}) as receipts_failed,
          (select count(*)::int from decisions where author_mail = 'failed' and ${gaveUp("decided_at")}) as author_failed,
          (select count(*)::int from intake_items where outcome_mail = 'failed' and ${gaveUp("coalesce(revised_sent_at, outcome_sent_at)")}) as outcomes_failed,
          (select count(*)::int from intake_items i
            where i.outcome is not null and i.outcome_sent_at is null
              and coalesce((select d.decided_at from decisions d where d.id = i.answered_by), i.created_at) < now() - interval '26 hours')
          + (select count(*)::int from intake_items i where i.revision_pending_at < now() - interval '26 hours') as release_overdue`,
  );
  return {
    waiting: { receipts: row!.receipts_waiting!, authorMails: row!.author_waiting!, outcomes: row!.outcomes_waiting! },
    failed: { receipts: row!.receipts_failed!, authorMails: row!.author_failed!, outcomes: row!.outcomes_failed! },
    releaseOverdue: row!.release_overdue!,
  };
}

/** The decisions of the last 30 days that lifted the protection of reported images: each lifted seal, and each final answer to a suspect item without a seal. Newest first, at most `max`, with their total. */
export async function recentProtectionLifted(q: Runner, max: number): Promise<{ total: number; items: { at: string; handle: string; caseId: string; kind: "unsealed" | "dismissed" }[] }> {
  const found = await rows<{ at: string; handle: string; case_id: string; kind: "unsealed" | "dismissed"; total: number }>(
    q,
    sql`select ${iso("d.decided_at")} as at, p.handle, d.case_id, (count(*) over ())::int as total,
               case when exists (select 1 from decision_actions a where a.decision_id = d.id and a.kind = 'unseal_media') then 'unsealed' else 'dismissed' end as kind
          from decisions d join profiles p on p.id = d.decided_by
         where d.decided_at >= now() - interval '30 days'
           and (exists (select 1 from decision_actions a where a.decision_id = d.id and a.kind = 'unseal_media')
                or (d.kind = 'final' and d.suspect and not exists (select 1 from decision_actions a where a.decision_id = d.id and a.kind = 'seal_media')))
         order by d.decided_at desc, d.id desc limit ${max}::int`,
  );
  return { total: found[0]?.total ?? 0, items: found.map((row) => ({ at: row.at, handle: row.handle, caseId: row.case_id, kind: row.kind })) };
}

/** The recorded choices not to seal of the last 30 days, newest first, at most `max`, with their total: time, staff handle and case, never the reason. */
export async function recentSealsDeclined(q: Runner, max: number): Promise<{ total: number; items: { at: string; handle: string; caseId: string }[] }> {
  const found = await rows<{ at: string; handle: string; case_id: string; total: number }>(
    q,
    sql`select ${iso("t.created_at")} as at, p.handle, t.case_id, (count(*) over ())::int as total
          from staff_texts t join profiles p on p.id = t.author_id
         where t.kind = 'seal_declined' and t.created_at >= now() - interval '30 days'
         order by t.created_at desc, t.id desc limit ${max}::int`,
  );
  return { total: found[0]?.total ?? 0, items: found.map((row) => ({ at: row.at, handle: row.handle, caseId: row.case_id })) };
}

/** The seals taken while deciding that are in force, by the view's one definition, newest first: who took each, on which case, and what its list covers. */
export async function interimSealsInForce(q: Runner, max: number): Promise<{ total: number; items: { at: string; handle: string; caseId: string; posts: number; images: number }[] }> {
  const found = await rows<{ at: string; handle: string; case_id: string; posts: number; images: number; total: number }>(
    q,
    sql`select ${iso("d.decided_at")} as at, p.handle, m.case_id, (count(*) over ())::int as total,
               (select count(*)::int from seal_posts s where s.action_id = m.id) as posts,
               (select coalesce(sum(s.images), 0)::int from seal_posts s where s.action_id = m.id) as images
          from measures_in_force m join decisions d on d.id = m.decision_id join profiles p on p.id = d.decided_by
         where m.kind = 'seal_media' and m.decision_kind = 'interim'
         order by d.decided_at desc, m.id desc limit ${max}::int`,
  );
  return { total: found[0]?.total ?? 0, items: found.map((row) => ({ at: row.at, handle: row.handle, caseId: row.case_id, posts: row.posts, images: row.images })) };
}

// ---------------------------------------------------------------- the statement of reasons

/** A decision as its statement is rendered from it, with what the mail and the staff alerts need beside it. */
export interface StatementDecisionRow {
  id: string;
  caseId: string;
  kind: "interim" | "final" | "review" | "correction";
  outcome: string;
  ground: string | null;
  ruleId: string | null;
  rulesVersion: number;
  redressVersion: number;
  source: string;
  decidedAt: string;
  suspect: boolean;
  authorMail: string;
  decidedBy: string;
  facts: string | null;
  reason: string | null;
  legalReference: string | null;
  targetType: TargetType;
  targetId: string;
  /** The post's creation time, which survives its deletion; null for an account case. */
  postCreatedAt: string | null;
  /** The account the decision is about: the post's author, or the account itself. */
  subjectId: string | null;
  /** The decision a review or a correction is about. */
  reviewed: { kind: "interim" | "final"; ground: string | null; ruleId: string | null; rulesVersion: number; legalReference: string | null; decidedAt: string } | null;
}

export async function statementDecision(q: Runner, decisionId: string): Promise<StatementDecisionRow | null> {
  const [row] = await rows<Record<string, unknown>>(
    q,
    sql`select d.id, d.case_id, d.kind, d.outcome, d.ground, d.rule_id, d.rules_version, d.redress_version, d.source, ${iso("d.decided_at")} as decided_at, d.suspect, d.author_mail, d.decided_by,
               (select t.text from staff_texts t where t.digest = d.facts_digest) as facts,
               (select t.text from staff_texts t where t.digest = d.reason_digest) as reason,
               (select t.text from staff_texts t where t.digest = d.legal_reference_digest) as legal_reference,
               c.target_type, c.target_id,
               (select ${iso("p.created_at")} from posts p where c.target_type = 'post' and p.id = c.target_id) as post_created_at,
               case when c.target_type = 'post' then (select p.author_id from posts p where p.id = c.target_id) else c.target_id end as subject_id,
               r.kind as reviewed_kind, r.ground as reviewed_ground, r.rule_id as reviewed_rule, r.rules_version as reviewed_rules_version, ${iso("r.decided_at")} as reviewed_at,
               (select t.text from staff_texts t where t.digest = r.legal_reference_digest) as reviewed_legal
          from decisions d join cases c on c.id = d.case_id left join decisions r on r.id = d.reviews_decision_id
         where d.id = ${decisionId}::uuid`,
  );
  if (!row) return null;
  return {
    id: row.id as string,
    caseId: row.case_id as string,
    kind: row.kind as StatementDecisionRow["kind"],
    outcome: row.outcome as string,
    ground: row.ground as string | null,
    ruleId: row.rule_id as string | null,
    rulesVersion: row.rules_version as number,
    redressVersion: row.redress_version as number,
    source: row.source as string,
    decidedAt: row.decided_at as string,
    suspect: row.suspect as boolean,
    authorMail: row.author_mail as string,
    decidedBy: row.decided_by as string,
    facts: row.facts as string | null,
    reason: row.reason as string | null,
    legalReference: row.legal_reference as string | null,
    targetType: row.target_type as TargetType,
    targetId: row.target_id as string,
    postCreatedAt: row.post_created_at as string | null,
    subjectId: row.subject_id as string | null,
    reviewed:
      row.reviewed_kind === null
        ? null
        : { kind: row.reviewed_kind as "interim" | "final", ground: row.reviewed_ground as string | null, ruleId: row.reviewed_rule as string | null, rulesVersion: row.reviewed_rules_version as number, legalReference: row.reviewed_legal as string | null, decidedAt: row.reviewed_at as string },
  };
}

/** One ledger row of a decision as its statement tells of it: for a reversal the measure it lifts, for a seal what its list held. */
export interface StatementActionRow {
  kind: ActionKind;
  mediaId: string | null;
  noEffect: "already" | "deleted" | null;
  /** For a reversal: the decision that holds the lifted measure, its rule, whether that measure changed anything, and whether korbat still kept that decision's snapshot when this one was made. */
  lifted: { decisionId: string; ruleId: string | null; noEffect: string | null; snapshotKept: boolean } | null;
  sealedPosts: number;
  sealedImages: number;
  /** The seal's images on posts their author had deleted by the time it was recorded: nothing later is read. */
  sealedDeletedImages: number;
}

/** A decision's measures and reversals, in the ledger's order of kinds. */
export async function statementActions(q: Runner, decisionId: string): Promise<StatementActionRow[]> {
  const found = await rows<Record<string, unknown>>(
    q,
    sql`select a.kind, a.media_id, a.no_effect, l.decision_id as lifted_decision, ld.rule_id as lifted_rule, l.no_effect as lifted_no_effect,
               (ls.erased_at is null or ls.erased_at > d.decided_at) as lifted_snapshot_kept,
               (select count(*)::int from seal_posts s where s.action_id = a.id) as sealed_posts,
               (select coalesce(sum(s.images), 0)::int from seal_posts s where s.action_id = a.id) as sealed_images,
               (select coalesce(sum(s.images), 0)::int from seal_posts s join posts p on p.id = s.post_id
                 where s.action_id = a.id and p.state = 'deleted_by_author' and p.deleted_at <= a.created_at) as sealed_deleted
          from decision_actions a join decisions d on d.id = a.decision_id
          left join decision_actions l on l.id = a.reverses_action_id
          left join decisions ld on ld.id = l.decision_id
          left join evidence_snapshots ls on ls.id = ld.snapshot_id
         where a.decision_id = ${decisionId}::uuid order by a.kind, a.media_id`,
  );
  return found.map((row) => ({
    kind: row.kind as ActionKind,
    mediaId: row.media_id as string | null,
    noEffect: row.no_effect as StatementActionRow["noEffect"],
    lifted: row.lifted_decision === null ? null : { decisionId: row.lifted_decision as string, ruleId: row.lifted_rule as string | null, noEffect: row.lifted_no_effect as string | null, snapshotKept: row.lifted_snapshot_kept as boolean },
    sealedPosts: row.sealed_posts as number,
    sealedImages: row.sealed_images as number,
    sealedDeletedImages: row.sealed_deleted as number,
  }));
}

/** A measure taken while deciding that ended with a final decision, without a reversal. */
export interface EndedMeasureRow {
  kind: ActionKind;
  mediaId: string | null;
  decisionId: string;
  ruleId: string | null;
  noEffect: string | null;
  snapshotKept: boolean;
}

/**
 * The measures taken while deciding that ended with this final decision, of those their author was told of: every one
 * that was still in force when the decision closed its case, and a seal taken while deciding whose suspect items the
 * decision answered, unless the decision itself seals (the images then stay sealed). It reads only what stood when the
 * decision was made: a reversal recorded later, or an item that arrived later, changes nothing here.
 */
export async function endedMeasures(q: Runner, decisionId: string): Promise<EndedMeasureRow[]> {
  const found = await rows<Record<string, unknown>>(
    q,
    sql`select a.kind, a.media_id, i.id as decision_id, i.rule_id, a.no_effect, (s.erased_at is null or s.erased_at > d.decided_at) as snapshot_kept
          from decisions d
          join cases c on c.id = d.case_id
          join decisions i on i.case_id = d.case_id and i.kind = 'interim' and i.decided_at < d.decided_at and i.author_mail <> 'none'
          join decision_actions a on a.decision_id = i.id
          join evidence_snapshots s on s.id = i.snapshot_id
         where d.id = ${decisionId}::uuid and d.kind = 'final'
           and a.kind in ('withhold', 'seal_media', 'withhold_media', 'reset_display_name', 'reset_bio')
           and not exists (select 1 from decision_actions r where r.reverses_action_id = a.id and r.created_at <= d.decided_at)
           and case when a.kind = 'seal_media'
                 then exists (select 1 from intake_items x where x.case_id = d.case_id and x.suspect and x.answered_by = d.id and x.created_at <= i.decided_at)
                      and not exists (select 1 from decision_actions own where own.decision_id = d.id and own.kind = 'seal_media')
                 else c.closed_at = d.decided_at end
         order by i.decided_at, a.kind, a.media_id`,
  );
  return found.map((row) => ({ kind: row.kind as ActionKind, mediaId: row.media_id as string | null, decisionId: row.decision_id as string, ruleId: row.rule_id as string | null, noEffect: row.no_effect as string | null, snapshotKept: row.snapshot_kept as boolean }));
}

/** What became of a mail korbat owed: the delivery states a send can end in. */
export type MailState = "sent" | "suppressed" | "no_address" | "failed";

/**
 * Records what became of a decision's statement mail, only while it is still pending, so a late answer never overwrites
 * one already recorded. True when this call recorded it.
 */
export async function recordAuthorMail(q: Runner, decisionId: string, state: MailState): Promise<boolean> {
  const updated = await rows<{ id: string }>(
    q,
    sql`update decisions set author_mail = ${state}::delivery_state, author_mail_at = case when ${state}::text = 'sent' then now() else author_mail_at end
         where id = ${decisionId}::uuid and author_mail = 'pending' returning id`,
  );
  return updated.length > 0;
}

// ---------------------------------------------------------------- the dispatch job

/** A time as a timestamptz parameter. */
const at = (time: Date) => sql`${time.toISOString()}::timestamptz`;

/** The notices whose receipt is still pending and that were received before `before`, oldest first, at most `limit`. */
export async function pendingReceipts(q: Runner, before: Date, limit: number): Promise<string[]> {
  return (await rows<{ id: string }>(q, sql`select id from intakes where receipt = 'pending' and received_at < ${at(before)} order by received_at, id limit ${limit}::int`)).map((row) => row.id);
}

/** The decisions whose statement mail is still pending and that were decided before `before`, oldest first. The decision caps bound how many there can be. */
export async function pendingAuthorMails(q: Runner, before: Date): Promise<string[]> {
  return (await rows<{ id: string }>(q, sql`select id from decisions where author_mail = 'pending' and decided_at < ${at(before)} order by decided_at, id`)).map((row) => row.id);
}

/**
 * The daily release, through the database's one function for it: every item answered before the cut-off is released with
 * its outcome as of the cut-off, and every released item whose outcome a review or a correction changed before it gets
 * its new outcome. The function refuses a cut-off in the database's future; a cut-off its clock has not reached yet (the
 * API's clock running ahead of it) is therefore taken as now. Answers how many items it changed.
 */
export async function releaseOutcomes(q: Runner, cutoff: Date): Promise<number> {
  const [row] = await rows<{ n: number }>(q, sql`select public.release_outcomes(least(${at(cutoff)}, now())) as n`);
  return row!.n;
}

/**
 * The contacts whose notice is still owed something: an item unanswered (a re-examination included), an item's outcome
 * mail pending or a changed outcome waiting for its release, or its receipt pending or folded. A line or a receipt that
 * was given up is owed nothing more.
 */
export async function contactsOwed(q: Runner): Promise<string[]> {
  const found = await rows<{ contact_id: string }>(
    q,
    sql`select distinct n.contact_id from intakes n
         where n.contact_id is not null
           and (n.receipt in ('pending', 'folded')
                or exists (select 1 from intake_items i where i.intake_id = n.id and (i.outcome is null or i.outcome_mail = 'pending' or i.revision_pending_at is not null)))`,
  );
  return found.map((row) => row.contact_id);
}

/** One released item whose outcome mail is pending, with what its line's words follow from. */
export interface OutcomeLineRow {
  id: string;
  intakeId: string;
  ref: string;
  contactId: string | null;
  reporterId: string | null;
  position: number;
  targetType: TargetType;
  targetId: string;
  namedHandle: string | null;
  hasCase: boolean;
  suspect: boolean;
  shownOutcome: string;
  changed: boolean;
  reexamines: boolean;
  /** A decision answered it: a link that named nothing was answered without one. */
  byDecision: boolean;
  reexamined: boolean;
  ruleId: string | null;
  rulesVersion: number | null;
  decisionUnseen: boolean;
  /** The answering decision holds a seal. */
  sealed: boolean;
  /** Every measure of the answering decision changed nothing when it was imposed. */
  noEffect: boolean;
  /** For an item about a post: the post quotes another. */
  quotes: boolean;
}

/** Every released item whose outcome mail is still pending, whichever round released it, by notice and position. */
export async function pendingOutcomeLines(q: Runner): Promise<OutcomeLineRow[]> {
  const found = await rows<Record<string, unknown>>(
    q,
    sql`select i.id, i.intake_id, n.ref, n.contact_id, i.reporter_account_id, i.position, i.target_type, i.target_id, i.named_handle, i.case_id is not null as has_case, i.suspect,
               i.shown_outcome, i.revised_sent_at is not null as changed, i.reexamines_item_id is not null as reexamines, i.answered_by is not null as by_decision,
               exists (select 1 from intake_items r where r.reexamines_item_id = i.id) as reexamined,
               d.rule_id, d.rules_version, coalesce(d.unseen, false) as decision_unseen,
               exists (select 1 from decision_actions a where a.decision_id = i.answered_by and a.kind = 'seal_media') as sealed,
               ${answerChangedNothing} as no_effect,
               coalesce((select p.quote_of_id is not null from posts p where i.target_type = 'post' and p.id = i.target_id), false) as quotes
          from intake_items i join intakes n on n.id = i.intake_id left join decisions d on d.id = i.answered_by
         where i.outcome_sent_at is not null and i.outcome_mail = 'pending' and i.shown_outcome is not null
         order by n.received_at, n.id, i.position, i.created_at, i.id`,
  );
  return found.map((row) => ({
    id: row.id as string,
    intakeId: row.intake_id as string,
    ref: row.ref as string,
    contactId: row.contact_id as string | null,
    reporterId: row.reporter_account_id as string | null,
    position: row.position as number,
    targetType: row.target_type as TargetType,
    targetId: row.target_id as string,
    namedHandle: row.named_handle as string | null,
    hasCase: row.has_case as boolean,
    suspect: row.suspect as boolean,
    shownOutcome: row.shown_outcome as string,
    changed: row.changed as boolean,
    reexamines: row.reexamines as boolean,
    byDecision: row.by_decision as boolean,
    reexamined: row.reexamined as boolean,
    ruleId: row.rule_id as string | null,
    rulesVersion: row.rules_version as number | null,
    decisionUnseen: row.decision_unseen as boolean,
    sealed: row.sealed as boolean,
    noEffect: row.no_effect as boolean,
    quotes: row.quotes as boolean,
  }));
}

/** The notices of signed-out notifiers whose receipt the 24-hour cap folded: each rides in its address's next update. */
export async function foldedReceipts(q: Runner): Promise<NoticeRow[]> {
  const found = await rows<NoticeColumns>(q, sql`select ${noticeColumns} from intakes where receipt = 'folded' and contact_id is not null order by received_at, id`);
  return found.flatMap((row) => noticeOf(row) ?? []);
}

/** Records what became of these items' outcome mails, only where one is still pending. */
export async function recordOutcomeMails(q: Runner, itemIds: readonly string[], state: MailState): Promise<void> {
  if (itemIds.length === 0) return;
  await q.execute(sql`update intake_items set outcome_mail = ${state}::delivery_state where id = any(${uuids(itemIds)}) and outcome_mail = 'pending'`);
}

/** Records what became of a receipt that rode in an update, only while it is still pending or folded. */
export async function recordCarriedReceipt(q: Runner, intakeId: string, state: MailState): Promise<void> {
  await q.execute(
    sql`update intakes set receipt = ${state}::delivery_state, receipt_sent_at = case when ${state}::text = 'sent' then now() else receipt_sent_at end
         where id = ${intakeId}::uuid and receipt in ('pending', 'folded')`,
  );
}

/** The receipts and the statement mails still unsent `days` days after they were due, recorded as given up; answers their ids. */
export async function giveUpReceiptsAndAuthorMails(q: Runner, now: Date, days: number): Promise<{ receipts: string[]; authorMails: string[] }> {
  const due = sql`${at(now)} - make_interval(days => ${days}::int)`;
  const receipts = await rows<{ id: string }>(q, sql`update intakes set receipt = 'failed' where receipt in ('pending', 'folded') and received_at < ${due} returning id`);
  const authorMails = await rows<{ id: string }>(q, sql`update decisions set author_mail = 'failed' where author_mail = 'pending' and decided_at < ${due} returning id`);
  return { receipts: receipts.map((row) => row.id), authorMails: authorMails.map((row) => row.id) };
}

/** The outcome lines still unsent `days` days after their release, or after the release of their changed outcome, recorded as given up; answers their ids. */
export async function giveUpOutcomeMails(q: Runner, now: Date, days: number): Promise<string[]> {
  const found = await rows<{ id: string }>(
    q,
    sql`update intake_items set outcome_mail = 'failed'
         where outcome_mail = 'pending' and coalesce(revised_sent_at, outcome_sent_at) < ${at(now)} - make_interval(days => ${days}::int) returning id`,
  );
  return found.map((row) => row.id);
}

/** An unanswered item in the urgent lane that has waited long enough to be alerted about again, with what decides whether it still calls for someone. */
export interface UrgentItemRow {
  caseId: string;
  targetType: TargetType;
  targetId: string;
  suspect: boolean;
  /** When the item arrived, in epoch milliseconds. */
  arrivedMs: number;
  /** Whether a decision taken while deciding, a note, or a recorded choice not to seal came after the item arrived. */
  interimAfter: boolean;
  noteAfter: boolean;
  declinedAfter: boolean;
  /** When the newest recorded choice not to seal of the case was saved, in epoch milliseconds, to the millisecond. */
  newestDeclinedMs: number | null;
  /** A post case's post is not visible: withheld, removed, or deleted by its author. */
  postHidden: boolean;
}

/**
 * The unanswered items of open cases in the urgent lane that arrived before `before`. "After the item arrived" compares
 * the item's time with the decision's or the text's, as the view of measures in force does: no later than.
 */
export async function urgentItems(q: Runner, before: Date): Promise<UrgentItemRow[]> {
  const after = (kind: string) => sql.raw(`exists (select 1 from staff_texts t where t.case_id = c.id and t.kind = '${kind}' and t.created_at >= i.created_at)`);
  const found = await rows<Record<string, unknown>>(
    q,
    sql`select c.id as case_id, c.target_type, c.target_id, i.suspect,
               floor(extract(epoch from i.created_at) * 1000)::float8 as arrived_ms,
               exists (select 1 from decisions d where d.case_id = c.id and d.kind = 'interim' and d.decided_at >= i.created_at) as interim_after,
               ${after("note")} as note_after, ${after("seal_declined")} as declined_after,
               (select floor(extract(epoch from max(t.created_at)) * 1000)::float8 from staff_texts t where t.case_id = c.id and t.kind = 'seal_declined') as newest_declined_ms,
               coalesce((select p.state <> 'visible' from posts p where c.target_type = 'post' and p.id = c.target_id), false) as post_hidden
          from intake_items i join cases c on c.id = i.case_id
         where c.closed_at is null and i.lane = 0 and i.outcome is null and i.created_at < ${at(before)}
         order by c.id, i.seq`,
  );
  return found.map((row) => ({
    caseId: row.case_id as string,
    targetType: row.target_type as TargetType,
    targetId: row.target_id as string,
    suspect: row.suspect as boolean,
    arrivedMs: Number(row.arrived_ms),
    interimAfter: row.interim_after as boolean,
    noteAfter: row.note_after as boolean,
    declinedAfter: row.declined_after as boolean,
    newestDeclinedMs: row.newest_declined_ms === null ? null : Number(row.newest_declined_ms),
    postHidden: row.post_hidden as boolean,
  }));
}

/**
 * The cases past their lane's response time (24 hours in lanes 0 and 1, seven days in lane 2, counted from the oldest
 * unanswered item), per lane with the oldest one's time, and the open cases that have held a measure taken while
 * deciding for more than 24 hours, whatever their lane.
 */
export async function waitingCases(q: Runner, now: Date): Promise<{ lanes: { lane: Lane; count: number; oldest: Date }[]; interim: number }> {
  const found = await rows<{ lane: Lane; n: number; oldest: string }>(
    q,
    sql`select lane, count(*)::int as n, ${iso("min(oldest_open_at)")} as oldest from cases
         where closed_at is null and oldest_open_at < ${at(now)} - case when lane = 2 then interval '7 days' else interval '24 hours' end
         group by lane order by lane`,
  );
  const [held] = await rows<{ n: number }>(
    q,
    sql`select count(distinct m.case_id)::int as n from measures_in_force m join decisions d on d.id = m.decision_id join cases c on c.id = m.case_id
         where m.decision_kind = 'interim' and c.closed_at is null and d.decided_at < ${at(now)} - interval '24 hours'`,
  );
  return { lanes: found.map((row) => ({ lane: row.lane, count: row.n, oldest: new Date(row.oldest) })), interim: held!.n };
}
