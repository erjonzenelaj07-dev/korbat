import { sql, type SQL } from "drizzle-orm";

/**
 * The one predicate of account sanctions (3e design, sections 5 and 7.2): whether an account may write now. It is an SQL
 * fragment over a profile row, held here as lock-bounds.ts holds the lock waits, so the social and media modules and the
 * profile store read it without one module importing another; no module's index exports it, and the auth module never
 * names it (it may name no public table). Every user of it follows four rules:
 *   1. in a write the time is WRITE_CLOCK, clock_timestamp(), never now(): a transaction that began before a start and
 *      waited for a lock is judged when it gets the row;
 *   2. in a write it reads only columns of the profile row that its own statement locks or updates, never a subquery's
 *      or a second statement's, which would read a row another transaction is about to change;
 *   3. it judges the acting account only: any other party of the write need only be live, as before;
 *   4. the session cache never carries it, so a session opened before a suspension is refused at its next write.
 * A refused write answers 403 account_suspended with no detail; the app then reads /api/me, which carries the standing
 * fresh from the row. Only this file names the profile's three columns of standing among the write paths: the
 * architecture test pins who names them, and every file that names one of the fragments below.
 */

/** The time every write judges a suspension by: the statement's own clock, read when it gets the row. */
export const WRITE_CLOCK: SQL = sql`clock_timestamp()`;

/** A profile alias of the caller's statement: a plain identifier written in the source, never input. */
const ALIAS = /^[a-z_][a-z0-9_]*$/;
function alias(profile: string): SQL {
  if (!ALIAS.test(profile)) throw new Error(`a profile alias is a plain identifier: ${JSON.stringify(profile)}`);
  return sql.raw(profile);
}

/**
 * The predicate's second half: the row's suspension runs at `at`. A suspension is one interval, from suspended_from up to
 * suspended_until (infinity for a termination), which standing_apply alone writes; both are null when none is fixed, so an
 * announced suspension without a start refuses nothing, and an ended interval left on the row refuses nothing either.
 */
export function suspendedAt(profile: string, at: SQL): SQL {
  const p = alias(profile);
  return sql`(${p}.suspended_from is not null and ${p}.suspended_from <= ${at} and ${at} < ${p}.suspended_until)`;
}

/** "Live and not suspended": the profile row is not deleted and its suspension does not run at `at`. */
export function liveNotSuspended(profile: string, at: SQL): SQL {
  const p = alias(profile);
  return sql`(${p}.deleted_at is null and not ${suspendedAt(profile, at)})`;
}

/** The row's restriction of reporting runs at `at` (3e design, section 7.9): only a report under a rule reads it. */
export function reportsRestrictedAt(profile: string, at: SQL): SQL {
  const p = alias(profile);
  return sql`coalesce(${p}.reports_restricted_until > ${at}, false)`;
}
