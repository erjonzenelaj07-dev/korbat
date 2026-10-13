import { sql } from "drizzle-orm";
import type { DbTx } from "@korbat/db";

/**
 * The lock waits of a transaction that carries out an action a staff key confirmed (3a design, section 7, Step-up; 3c
 * design, section 7.5), shared by the auth module, the moderation module and the command lines. audit-verify refuses for
 * good an audit row stamped at or after its step-up challenge's expiry, and the row is stamped only once the transaction
 * holds the audit head, so every wait before it must end in time. This file has no entry point of its own, so every
 * bundle can include it.
 */

/** Whether an error is PostgreSQL's, with this SQLSTATE, however deeply the driver wrapped it. */
function hasSqlState(err: unknown, code: string): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === "object" && (current as { code?: unknown }).code === code) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** True for PostgreSQL's lock_not_available: a lock_timeout ran out, and the transaction that gave up has changed nothing. */
export function isLockNotAvailable(err: unknown): boolean {
  return hasSqlState(err, "55P03");
}

/**
 * True when a bounded wait ran out on either of its two limits: lock_timeout (lock_not_available) or the statement_timeout
 * set beside it (query_canceled, 57014), which ends a statement whose lock others keep out of reach. Either way the
 * statement, and so the transaction, changed nothing.
 */
export function isBoundReached(err: unknown): boolean {
  return isLockNotAvailable(err) || hasSqlState(err, "57014");
}

/** True for PostgreSQL's deadlock_detected: this transaction was chosen to give way, and has changed nothing. */
export function isDeadlock(err: unknown): boolean {
  return hasSqlState(err, "40P01");
}

/**
 * Bounds every lock wait of a confirmed action's transaction: lock_timeout becomes the share of what is left of the
 * challenge's life, by the database's clock, that one of `waits` waits may take, and at most 15 seconds, so the waits the
 * transaction may meet all end before the expiry. `waits` is the number of locks it may have to wait for. False when
 * nothing is left, or less than a millisecond, which lock_timeout would read as no limit at all; nothing is set then. The
 * bound only aims to end the transaction in time: the statement that writes the audit row checks the clock itself.
 *
 * statement_timeout is set to the same length (3e's review, database2): lock_timeout is armed again at each wait of one
 * statement, so a FOR UPDATE that a stream of others' key-share locks keeps out of reach (each new one joins the holders
 * without queueing behind it) would wait without end; the statement then ends at the bound, as isBoundReached knows.
 */
export async function boundLockWaits(tx: Pick<DbTx, "execute">, expiresAt: Date, waits: number): Promise<boolean> {
  if (!Number.isInteger(waits) || waits < 1) throw new Error("boundLockWaits takes the number of waits to bound: a positive whole number");
  const [left] = await tx.execute<{ ms: string }>(
    sql`select floor(least(15000, (${expiresAt.getTime()}::numeric - extract(epoch from clock_timestamp()) * 1000) / ${waits}::numeric))::bigint::text as ms`,
  );
  const ms = Number(left!.ms);
  if (!(ms >= 1)) return false;
  await tx.execute(sql`select set_config('lock_timeout', ${`${ms}ms`}::text, true), set_config('statement_timeout', ${`${ms}ms`}::text, true)`);
  return true;
}
