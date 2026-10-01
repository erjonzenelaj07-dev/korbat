/**
 * The command lines' lock timeout (3a design, section 7). grant-role and staff.js wait at most 10 seconds for a lock,
 * since an API under an attacker's control could hold the audit head or an account's row open and so stall every
 * revocation; the transaction that gave up has changed nothing. This file has no entry point of its own, so both
 * bundles can include it: a bundled module's import.meta.url is the bundle's, and an entry's check that it was run
 * directly would pass in the other bundle too.
 */

/** What a command that gave up waiting for a lock says. */
export const LOCK_TIMEOUT_ADVICE =
  "an open transaction holds the audit head or the account's row, and 10 seconds passed waiting for it: " +
  "stop the api service (docker compose -f infra/compose.yml stop api) before running this command again, then start it.";

/** True for PostgreSQL's lock_not_available (a lock_timeout ran out), however deeply the driver wrapped it. */
export function isLockTimeout(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === "object" && (current as { code?: unknown }).code === "55P03") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
