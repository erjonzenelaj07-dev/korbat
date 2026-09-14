import type { AuthRepo, UserRole } from "./repo";
import type { Sessions } from "./sessions";

/**
 * Changes an account's role. Used only by the server-side CLI; there is no API endpoint for it.
 * Every session of the account is revoked so the new role (and its MFA requirement) applies at once.
 */
export async function grantRole(
  deps: { repo: AuthRepo; sessions: Sessions },
  email: string,
  role: UserRole,
): Promise<{ userId: string; previousRole: UserRole }> {
  const user = await deps.repo.findUserByEmail(email);
  if (!user) throw new Error(`no account for ${email}`);
  await deps.repo.setRole(user.id, role);
  await deps.sessions.revokeAll(user.id);
  return { userId: user.id, previousRole: user.role };
}
