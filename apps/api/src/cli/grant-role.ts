/**
 * Changes an account's role. Run on the server only; there is no API endpoint for this.
 *
 *   docker compose -f infra/compose.yml run --rm api node dist/grant-role.js <email> <user|moderator|admin>
 *
 * Every session and staff session of the account is revoked and every unused staff enrolment link deleted; a change to
 * user also revokes every staff key, and the owner is mailed their names (3a design, section 7). The change is written to
 * public.audit_log in the same transaction. A mail that fails is printed as a warning and undoes nothing.
 */
import { pathToFileURL } from "node:url";
import Redis from "ioredis";
import { Email, Role } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createAuthRepo, createSessions, grantRole, redisKv, type KeyValueStore, type RoleGranted, type UserRole } from "../auth";
import { loadConfig } from "../config";
import type { Mailer } from "../mail/mailer";
import { LOCK_TIMEOUT_ADVICE, isLockTimeout } from "./lock-timeout";
import { commandLineMailer } from "./mail";

/** Audit-log actor for changes made from the server console rather than by a signed-in person; the auth module writes the row. */
export { SYSTEM_ACTOR_ID } from "../auth";
export const GRANT_ROLE_USAGE = "usage: node dist/grant-role.js <email> <user|moderator|admin>";

export function parseGrantRoleArgs(args: readonly string[]): { email: string; role: UserRole } {
  if (args.length !== 2) throw new Error(GRANT_ROLE_USAGE);
  const email = Email.safeParse(args[0]);
  if (!email.success) throw new Error(`not an email address: ${args[0]}\n${GRANT_ROLE_USAGE}`);
  const role = Role.safeParse(args[1]);
  if (!role.success) throw new Error(`unknown role: ${args[1]}\n${GRANT_ROLE_USAGE}`);
  return { email: email.data, role: role.data };
}

/**
 * The role change and its audit rows in one transaction on the auth role, then the tombstones and the mail; grant-role
 * opens no pool on the API's role.
 */
export async function runGrantRole(deps: { authDb: Db; kv: KeyValueStore; mailer: Mailer }, email: string, role: UserRole) {
  const repo = createAuthRepo(deps.authDb);
  const sessions = createSessions({ repo, kv: deps.kv });
  try {
    return await grantRole({ repo, sessions, mailer: deps.mailer }, email, role);
  } catch (err) {
    if (isLockTimeout(err)) throw new Error(`grant-role changed nothing: ${LOCK_TIMEOUT_ADVICE}`, { cause: err });
    throw err;
  }
}

/**
 * What the command prints once the change has committed: the summary always, on stdout, and a warning on stderr for each
 * step after the commit that failed. None of them undoes the change, so the command exits 0 whatever they say.
 */
export function grantRoleReport(granted: RoleGranted, role: UserRole): { out: string[]; warnings: string[] } {
  const out = [
    `user ${granted.userId}: role ${granted.previousRole} -> ${role}; every session revoked; ` +
      `${granted.staffSessionsRevoked} staff sessions and ${granted.staffKeysRevoked} staff keys revoked, ${granted.enrollmentsDeleted} unused enrolment links deleted`,
  ];
  const warnings: string[] = [];
  if (granted.tombstoneError !== null) {
    warnings.push(
      `warning: the revoked app sessions could not be marked in Valkey (${granted.tombstoneError}); they are revoked in the database, ` +
        "a cached copy may still answer for up to a minute; the change stands",
    );
  }
  if (granted.mailError !== null) warnings.push(`warning: the staff_keys_revoked mail to the account could not be sent (${granted.mailError}); the change stands`);
  return { out, warnings };
}

async function main(): Promise<number> {
  let parsed: { email: string; role: UserRole };
  try {
    parsed = parseGrantRoleArgs(process.argv.slice(2));
  } catch (err) {
    console.error((err as Error).message);
    return 2;
  }
  const config = loadConfig();
  const authDb = createDb(config.DATABASE_URL_AUTH, { max: 1 });
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
  try {
    // The same mailer as the staff command line's, built as the API builds its own.
    const granted = await runGrantRole({ authDb, kv: redisKv(redis), mailer: commandLineMailer(process.env) }, parsed.email, parsed.role);
    const report = grantRoleReport(granted, parsed.role);
    for (const line of report.out) console.log(line);
    for (const line of report.warnings) console.error(line);
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  } finally {
    await Promise.allSettled([closeDb(authDb), redis.quit()]);
  }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
