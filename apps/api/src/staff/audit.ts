import { and, desc, eq, lt, lte, type SQL } from "drizzle-orm";
import { STAFF_AUDIT_PAGE_SIZE, type AuditPage, type AuditPageQuery, type StaffStoredAssertion } from "@korbat/contracts";
import { auditLog, profiles, type Db, type DbTx } from "@korbat/db";

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
 * One page of the record, newest first by place (3a design, section 7): from the newest row, from before `cursor`, or the
 * page whose newest row is at place `at` (the keeper's "Go to place"), optionally only one action (the home screen's
 * sign-ins). Each entry names its actor by the actor's public handle, null for the server or an account without one, and
 * never carries the metadata. Reading is not itself recorded.
 */
export async function auditPage(q: Querier, query: AuditPageQuery): Promise<AuditPage> {
  const conditions: SQL[] = [];
  if (query.cursor !== undefined) conditions.push(lt(auditLog.chainSeq, query.cursor));
  if (query.at !== undefined) conditions.push(lte(auditLog.chainSeq, query.at));
  if (query.action !== undefined) conditions.push(eq(auditLog.action, query.action));
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
    })
    .from(auditLog)
    // A profile's id is its account's id; the system actor and an account that never chose a handle have none.
    .leftJoin(profiles, eq(profiles.id, auditLog.actorId))
    .where(and(...conditions))
    .orderBy(desc(auditLog.chainSeq))
    .limit(STAFF_AUDIT_PAGE_SIZE + 1);
  const entries = rows.slice(0, STAFF_AUDIT_PAGE_SIZE).map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  return { entries, nextCursor: rows.length > STAFF_AUDIT_PAGE_SIZE ? entries[entries.length - 1]!.seq : null };
}
