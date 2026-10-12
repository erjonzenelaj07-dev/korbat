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
