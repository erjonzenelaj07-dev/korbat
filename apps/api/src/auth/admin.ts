import type { AuthRepo, UserRole } from "./repo";
import type { Sessions } from "./sessions";

/** The audit log's actor for changes made from the server's command line rather than by a signed-in person. */
export const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Changes an account's role. Used only by the server-side CLI; there is no API endpoint for it.
 * Every session of the account is revoked so the new role (and its MFA requirement) applies at once. The change, the
 * revocations and the role_granted row of the audit log are one transaction on the auth role (3a design, section 7); the
 * cached sessions get their tombstones after it commits.
 */
export async function grantRole(
  deps: { repo: AuthRepo; sessions: Sessions },
  email: string,
  role: UserRole,
): Promise<{ userId: string; previousRole: UserRole }> {
  const changed = await deps.repo.changeRole(email, role, { actorId: SYSTEM_ACTOR_ID, now: new Date() });
  if (!changed) throw new Error(`no account for ${email}`);
  await deps.sessions.tombstone(changed.sessionIds);
  return { userId: changed.userId, previousRole: changed.previousRole };
}
