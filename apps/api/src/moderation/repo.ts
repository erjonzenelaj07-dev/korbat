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
type Runner = Pick<Db, "execute"> | Pick<DbTx, "execute">;

const rows = async <T>(q: Runner, query: ReturnType<typeof sql>): Promise<T[]> => (await q.execute(query)) as unknown as T[];

/** A timestamptz expression as the text Date.prototype.toISOString writes: UTC, to the millisecond. The expression is written here, never input. */
const iso = (expression: string) => sql.raw(`to_char(${expression} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

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
  changed: boolean;
  reexamines: boolean;
  /** A moderator's decision to take no action: the only answer a re-examination can be asked for. */
  noAction: boolean;
  reexamined: boolean;
  /** The end of the re-examination window, as toISOString writes it; null before the release. */
  until: string | null;
  inWindow: boolean;
}

/**
 * A notice's items in the order its page lists them: by position, an item korbat added for a quoted post (positions 11
 * to 20) directly after the item it was added for, and a re-examination, which shares its item's position, after it.
 * The window's end is the database's own appeal_deadline of the release, read against its clock, as the attach trigger
 * reads it when a re-examination is filed.
 */
export async function noticeItems(q: Runner, intakeId: string): Promise<NoticeItemRow[]> {
  const found = await rows<{
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
    changed: boolean;
    reexamines: boolean;
    no_action: boolean;
    reexamined: boolean;
    until: string | null;
    in_window: boolean;
  }>(
    q,
    sql`select i.position, i.target_type, i.target_id, i.named_handle, i.case_id is not null as has_case, i.suspect,
               i.outcome_sent_at is not null as released, i.shown_outcome,
               to_char(coalesce(d.decided_at, i.created_at) at time zone 'UTC', 'YYYY-MM-DD') as decided_on,
               exists (select 1 from decision_actions a where a.decision_id = i.answered_by and a.kind = 'seal_media') as sealed,
               coalesce(d.unseen, false) as decision_unseen,
               i.revised_sent_at is not null as changed,
               i.reexamines_item_id is not null as reexamines,
               (i.answered_by is not null and i.outcome in ('no_violation', 'not_evident')) as no_action,
               exists (select 1 from intake_items r where r.reexamines_item_id = i.id) as reexamined,
               ${iso("public.appeal_deadline(i.outcome_sent_at)")} as until,
               coalesce(clock_timestamp() < public.appeal_deadline(i.outcome_sent_at), false) as in_window
          from intake_items i left join decisions d on d.id = i.answered_by
         where i.intake_id = ${intakeId}::uuid
         order by (case when i.position > 10 then i.position - 10 else i.position end), (i.position > 10), i.created_at, i.id`,
  );
  return found.map((row) => ({
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
    changed: row.changed,
    reexamines: row.reexamines,
    noAction: row.no_action,
    reexamined: row.reexamined,
    until: row.until,
    inWindow: row.in_window,
  }));
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
