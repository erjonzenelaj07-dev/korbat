import { and, desc, eq, gte, isNotNull, lt, lte, sql, type SQL } from "drizzle-orm";
import { STAFF_AUDIT_PAGE_SIZE, type AuditExportLine, type AuditExportedParams, type AuditMarkRequest, type AuditPage, type AuditPageQuery, type StaffStoredAssertion } from "@korbat/contracts";
import { auditLog, copyMarks, profiles, type Db, type DbTx } from "@korbat/db";
import { SYSTEM_ACTOR_ID, type ActiveStaffSession, type StaffStepUpConfirmed } from "../auth";
import { boundLockWaits } from "../lib/lock-bounds";

/** What a read runs through: the pool, or a transaction that should see its own writes. */
type Querier = Pick<Db, "select">;

/**
 * One staff action's row on the record, as the staff module writes it for actions on public tables (3c's decisions are
 * the first). The auth side's rows (sign-ins, revocations, role changes) are not written here: the auth module writes them
 * through auth.append_audit in the transaction of their change. The trigger sets the id, the time, the place and the
 * hashes, whatever an insert supplies, so none is taken here.
 */
export interface StaffAuditRow {
  /** The staff account that acted; 00000000-0000-0000-0000-000000000000 for the server itself. */
  actorId: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  requestId: string | null;
  /** What the action was, never an email, IP, device or phone: the reader never shows it, but the record keeps it for good. */
  metadata?: Record<string, unknown>;
  /** The handle of the staff session the action came from. */
  staffSession?: string | null;
  /** A step-up's key, action hash and assertion go together, as the table's check requires. */
  keyId?: string | null;
  actionHash?: string | null;
  stepUp?: StaffStoredAssertion | null;
}

/** A row's place in the chain and its hash. */
export interface AuditPlace {
  seq: number;
  hash: string;
}

/**
 * Writes a staff action's row in the caller's transaction, which also holds the action's change, so the fact is in the
 * record exactly when its change commits. The insert takes the chain's head and holds it until that transaction ends, so
 * it must be the transaction's last statement: nothing that can wait (another row lock, Valkey, a mail) may run between
 * it and the commit, or every other audit write waits too.
 */
export async function appendAuditRow(tx: DbTx, row: StaffAuditRow): Promise<AuditPlace> {
  const [written] = await tx
    .insert(auditLog)
    .values({
      actorId: row.actorId,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      requestId: row.requestId,
      metadata: row.metadata ?? {},
      staffSession: row.staffSession ?? null,
      keyId: row.keyId ?? null,
      actionHash: row.actionHash ?? null,
      stepUp: row.stepUp ?? null,
    })
    .returning({ seq: auditLog.chainSeq, hash: auditLog.hash });
  return written!;
}

/**
 * The place of the newest copy mark of this account (3f Task 6, sections 7.16 and 8.7): where its next download of the
 * audit log's tail starts; null before its first. The system actor's marks are staff.js audit-export's own.
 */
export async function lastCopiedPlace(q: Querier, staffId: string): Promise<number | null> {
  const [row] = await q.select({ place: copyMarks.place }).from(copyMarks).where(eq(copyMarks.staffId, staffId)).orderBy(desc(copyMarks.at), desc(copyMarks.id)).limit(1);
  return row?.place ?? null;
}

/**
 * One page of the record, newest first by place (3a design, section 7): from the newest row, from before `cursor`, or the
 * page whose newest row is at place `at` (the keeper's "Go to place"), optionally only one action (the home screen's
 * sign-ins) or (3f Task 6, "What one key confirmed") only the rows a step-up of one key confirmed in a period. Each entry
 * names its actor by the actor's public handle, null for the server or an account without one, and the key a step-up
 * confirmed it with by its id; it never carries the metadata. With the reader's own account (3f Task 6) the page carries
 * the place of that account's newest copy mark. Reading is not itself recorded.
 */
export async function auditPage(q: Querier, query: AuditPageQuery, staffId: string | null = null): Promise<AuditPage> {
  const conditions: SQL[] = [];
  if (query.cursor !== undefined) conditions.push(lt(auditLog.chainSeq, query.cursor));
  if (query.at !== undefined) conditions.push(lte(auditLog.chainSeq, query.at));
  if (query.action !== undefined) conditions.push(eq(auditLog.action, query.action));
  if (query.key !== undefined) {
    // A step-up leaves its key, its hash and its assertion together (audit_log_step_up_complete): a row with the key and
    // no hash is a key's own row (its enrolment, its revocation), which no key confirmed.
    conditions.push(eq(auditLog.keyId, query.key), isNotNull(auditLog.actionHash));
    if (query.from !== undefined) conditions.push(gte(auditLog.createdAt, new Date(query.from)));
    if (query.to !== undefined) conditions.push(lte(auditLog.createdAt, new Date(query.to)));
  }
  // One row more than a page, to know whether another page follows.
  const rows = await q
    .select({
      seq: auditLog.chainSeq,
      hash: auditLog.hash,
      createdAt: auditLog.createdAt,
      actorHandle: profiles.handle,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      actionHash: auditLog.actionHash,
      stepKeyId: auditLog.keyId,
    })
    .from(auditLog)
    // A profile's id is its account's id; the system actor and an account that never chose a handle have none.
    .leftJoin(profiles, eq(profiles.id, auditLog.actorId))
    .where(and(...conditions))
    .orderBy(desc(auditLog.chainSeq))
    .limit(STAFF_AUDIT_PAGE_SIZE + 1);
  const entries = rows.slice(0, STAFF_AUDIT_PAGE_SIZE).map(({ stepKeyId, ...row }) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    // The key a step-up confirmed the row with; a key's own rows (keyId without a hash) are about the key, not by it.
    keyId: row.actionHash === null ? null : stepKeyId,
  }));
  return {
    entries,
    nextCursor: rows.length > STAFF_AUDIT_PAGE_SIZE ? entries[entries.length - 1]!.seq : null,
    copy: { lastPlace: staffId === null ? null : await lastCopiedPlace(q, staffId) },
  };
}

// ---------------------------------------------------------------- the daily copy (3f design, sections 6.6 and 7.16)

/** How many rows one read of the download takes at a time. */
export const EXPORT_PAGE_SIZE = 1000;

/** What a page of the export reads through: the pool or the command line's connection. */
type Reader = Pick<Db, "execute">;

/** A row of the chain as the download writes it: the canonical text's members as stored, and the two hashes. */
interface LineRow {
  id: string | number;
  chain_version: number;
  chain_seq: string | number;
  created_at: string;
  actor_id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  request_id: string | null;
  staff_session: string | null;
  key_id: string | null;
  action_hash: string | null;
  step_up: string | null;
  metadata: string;
  prev_hash: string;
  hash: string;
}

/**
 * The rows after place `after` up to place `through`, oldest first, as lines of the download (AuditExportLine): read in
 * pages by place and id, each page a statement of its own (the log is append-only, so the pages read the one record). The
 * jsonb columns come as PostgreSQL prints them (a `::text` cast), which the canonical text embeds as it is, so a keeper's
 * file recomputes every hash with staff/chain.ts and nothing of the database's; the time is the row's millisecond, in UTC.
 */
export async function* exportLines(q: Reader, after: number, through: number): AsyncGenerator<AuditExportLine> {
  let from: { seq: number; id: number } | null = null;
  for (;;) {
    const page = (await q.execute(sql`
      select l.id, l.chain_version, l.chain_seq, to_char(l.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at,
             l.actor_id, l.action, l.target_type, l.target_id, l.request_id, l.staff_session, l.key_id, l.action_hash,
             l.step_up::text as step_up, l.metadata::text as metadata, l.prev_hash, l.hash
        from public.audit_log l
       where l.chain_seq > ${after}::bigint and l.chain_seq <= ${through}::bigint
         ${from === null ? sql`` : sql`and (l.chain_seq, l.id) > (${from.seq}::bigint, ${from.id}::bigint)`}
       order by l.chain_seq, l.id
       limit ${EXPORT_PAGE_SIZE}`)) as unknown as LineRow[];
    for (const row of page) {
      yield {
        v: row.chain_version,
        place: Number(row.chain_seq),
        id: Number(row.id),
        at: row.created_at,
        actor: row.actor_id,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        requestId: row.request_id,
        staffSession: row.staff_session,
        keyId: row.key_id,
        actionHash: row.action_hash,
        stepUp: row.step_up,
        metadata: row.metadata,
        prevHash: row.prev_hash,
        hash: row.hash,
      };
    }
    if (page.length < EXPORT_PAGE_SIZE) return;
    const last = page[page.length - 1]!;
    from = { seq: Number(last.chain_seq), id: Number(last.id) };
  }
}

/** The newest place of the chain (0 for an empty log), read from the head the trigger moves. */
async function headPlace(q: Reader): Promise<number> {
  const [row] = (await q.execute(sql`select h.seq::text as seq from public.audit_head h where h.id = 1`)) as unknown as { seq: string }[];
  return Number(row?.seq ?? 0);
}

/** The message of an exception the database raised as its code (SQLSTATE P0001); null for anything else. */
function raised(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    const c = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof c.code === "string") return c.code === "P0001" && typeof c.message === "string" ? c.message : null;
    current = c.cause;
  }
  return null;
}

/**
 * A download that was released: its places and how many rows; or why none was: the confirming account or key ended, the
 * challenge's time ran out, or the download would end after the newest place.
 */
export type ExportOutcome = { after: number; through: number; rows: number; copyTaken: boolean } | "ended" | "late" | "beyond_head";

/** The locks the download's transaction may wait for: the acting account's row, the key and the audit head. */
const EXPORT_WAITS = 3;

/**
 * POST /api/staff/audit/export, once its step-up verified (sections 6.6 and 7.16 steps 2 and 3): the download is a
 * confirmed action, since a line carries its row's metadata, which the audit page never shows. One transaction holds
 * append_confirmed_audit alone, the action audit_exported on the target `audit` with the params it releases: a key's
 * confirmation is used once, so the action that used it has its row, which says who took which places also when the file
 * never arrives. It writes no mark: the mark is the keeper's confirmation (markCopy). `through` may not be after the head,
 * since the file would end short. Answers the places and whether every staff account is to be alerted (copy_taken): when
 * a staff member other than the caller holds the newest staff copy mark.
 */
export async function exportAudit(db: Db, session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: { requestId: string }): Promise<ExportOutcome> {
  // A confirmation of anything else never releases the record: a wiring fault, not a refusal.
  if (confirmed.action !== "audit_exported" || confirmed.target.type !== "audit" || confirmed.keyId !== session.keyId) throw new Error("the audit download needs the step-up that confirmed it");
  const params = confirmed.params as AuditExportedParams;
  if (String(params.through) !== confirmed.target.id) throw new Error("the audit download's target is the place it ends at");
  if (params.through > (await headPlace(db))) return "beyond_head";
  // The newest staff copy is read before the transaction: the alert is told after the commit and decides nothing.
  const [holder] = (await db.execute(
    sql`select m.staff_id from public.copy_marks m where m.staff_id <> ${SYSTEM_ACTOR_ID}::uuid order by m.at desc, m.id desc limit 1`,
  )) as unknown as { staff_id: string }[];
  try {
    const outcome = await db.transaction(async (tx): Promise<"done" | "late"> => {
      if (!(await boundLockWaits(tx, confirmed.expiresAt, EXPORT_WAITS))) return "late";
      await tx.execute(
        sql`select public.append_confirmed_audit(${session.userId}::uuid, ${confirmed.keyId}::uuid, 'audit_exported'::text, 'audit'::text, ${confirmed.target.id}::text,
              ${JSON.stringify({ params: confirmed.params })}::text::jsonb, ${session.handle}::uuid, ${confirmed.actionHash}::text, ${JSON.stringify(confirmed.assertion)}::text::jsonb,
              ${ctx.requestId}::text, ${confirmed.expiresAt.getTime()}::bigint)`,
      );
      return "done";
    });
    if (outcome === "late") return "late";
  } catch (err) {
    const refusal = raised(err);
    if (refusal === "staff_confirmation_ended") return "ended";
    if (refusal === "staff_confirmation_late") return "late";
    throw err;
  }
  return { after: params.after, through: params.through, rows: params.through - params.after, copyTaken: holder !== undefined && holder.staff_id !== session.userId };
}

/**
 * POST /api/staff/audit/export/mark (sections 6.6 and 7.16 step 4): the keeper's confirmation that the console holds the
 * whole file, which it has checked runs without a break. One transaction: the row at the place `through` holds that hash,
 * and the caller's own newest audit_exported row signed that `through` (copy_mismatch, 409, otherwise, also for a place
 * the caller did not download with a key); then the caller's copy mark and the plain audit row copy_marked, with the
 * places the mark covers. No key: it shows nothing, and it can only say "I hold it" of a file a key released. Answers
 * "mismatch", with nothing written, when either test fails.
 */
export async function markCopy(db: Db, session: ActiveStaffSession, request: AuditMarkRequest, ctx: { requestId: string }): Promise<"marked" | "mismatch"> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '10s'`);
    const [at] = (await tx.execute(sql`select l.hash from public.audit_log l where l.chain_seq = ${request.through}::bigint`)) as unknown as { hash: string }[];
    const [released] = (await tx.execute(
      sql`select (l.metadata -> 'params' ->> 'after')::bigint::text as after, (l.metadata -> 'params' ->> 'through')::bigint::text as through
            from public.audit_log l where l.action = 'audit_exported' and l.actor_id = ${session.userId}::uuid
           order by l.chain_seq desc limit 1`,
    )) as unknown as { after: string; through: string }[];
    if (at === undefined || at.hash !== request.hash || released === undefined || Number(released.through) !== request.through) return "mismatch";
    const after = Number(released.after);
    // The API role inserts these two columns alone; the trigger forces the mark's time.
    await tx.execute(sql`insert into public.copy_marks (staff_id, place) values (${session.userId}::uuid, ${request.through}::bigint)`);
    await appendAuditRow(tx, {
      actorId: session.userId,
      action: "copy_marked",
      targetType: null,
      targetId: null,
      requestId: ctx.requestId,
      staffSession: session.handle,
      metadata: { after, through: request.through, rows: request.through - after },
    });
    return "marked" as const;
  });
}
