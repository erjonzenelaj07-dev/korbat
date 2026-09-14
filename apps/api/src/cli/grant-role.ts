/**
 * Changes an account's role. Run on the server only; there is no API endpoint for this.
 *
 *   docker compose -f infra/compose.yml run --rm api node dist/grant-role.js <email> <user|moderator|admin>
 *
 * Every session of the account is revoked, and the change is written to public.audit_log.
 */
import { pathToFileURL } from "node:url";
import Redis from "ioredis";
import { Email, Role } from "@korbat/contracts";
import { auditLog, closeDb, createDb, type Db } from "@korbat/db";
import { createAuthRepo, createSessions, grantRole, redisKv, type KeyValueStore, type UserRole } from "../auth";
import { loadConfig } from "../config";

/** Audit-log actor for changes made from the server console rather than by a signed-in person. */
export const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
export const GRANT_ROLE_USAGE = "usage: node dist/grant-role.js <email> <user|moderator|admin>";

export function parseGrantRoleArgs(args: readonly string[]): { email: string; role: UserRole } {
  if (args.length !== 2) throw new Error(GRANT_ROLE_USAGE);
  const email = Email.safeParse(args[0]);
  if (!email.success) throw new Error(`not an email address: ${args[0]}\n${GRANT_ROLE_USAGE}`);
  const role = Role.safeParse(args[1]);
  if (!role.success) throw new Error(`unknown role: ${args[1]}\n${GRANT_ROLE_USAGE}`);
  return { email: email.data, role: role.data };
}

export async function runGrantRole(deps: { authDb: Db; apiDb: Db; kv: KeyValueStore }, email: string, role: UserRole) {
  const repo = createAuthRepo(deps.authDb);
  const sessions = createSessions({ repo, kv: deps.kv });
  const result = await grantRole({ repo, sessions }, email, role);
  await deps.apiDb.insert(auditLog).values({
    actorId: SYSTEM_ACTOR_ID,
    action: "role_granted",
    targetType: "user",
    targetId: result.userId,
    metadata: { from: result.previousRole, to: role, via: "cli" },
  });
  return result;
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
  const apiDb = createDb(config.DATABASE_URL_API, { max: 1 });
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
  try {
    const { userId, previousRole } = await runGrantRole({ authDb, apiDb, kv: redisKv(redis) }, parsed.email, parsed.role);
    console.log(`user ${userId}: role ${previousRole} -> ${parsed.role}; every session revoked`);
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  } finally {
    await Promise.allSettled([closeDb(authDb), closeDb(apiDb), redis.quit()]);
  }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
