import type { MeResponse, SessionsResponse } from "@korbat/contracts";
import { AuthError, type AuthDeps } from "../context";
import type { Session } from "../sessions";
import { notifyAccount } from "./notify";

/** The signed-in account. The only response in the API that contains the email address. */
export async function me(deps: AuthDeps, session: Session): Promise<MeResponse> {
  const user = await deps.repo.findUserById(session.userId);
  if (!user) throw new AuthError("invalid_credentials", 401);
  return {
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      onboarded: user.onboardedAt !== null,
      mfaEnabled: user.totpEnabledAt !== null,
      hasPassword: user.passwordHash !== null,
      // The count only (1c design, section 7.5); the Security list is where the passkeys themselves are read.
      passkeys: await deps.repo.countPasskeys(user.id),
    },
    profile: await deps.profiles.find(user.id),
  };
}

/** The user's live sessions, each under its handle: the id that stays while the session's token rotates. */
export async function listSessions(deps: AuthDeps, session: Session): Promise<SessionsResponse> {
  return { sessions: await deps.sessions.list(session.userId, session.handle) };
}

/**
 * Revokes one of the user's own sessions, named by the handle the list gave, so a session that re-authenticated since
 * it was listed (its token rotated) is still revoked. False when no such live session belongs to them.
 */
export async function revokeSession(deps: AuthDeps, session: Session, handle: string): Promise<boolean> {
  const revoked = await deps.sessions.revoke(handle, session.userId);
  if (revoked) await deps.repo.appendEvent({ userId: session.userId, type: "session_revoked", deviceId: session.deviceId, metadata: { handle } });
  return revoked;
}

/** Signs out every session of the account, including the current one (the route requires fresh auth). */
export async function revokeAllSessions(deps: AuthDeps, session: Session): Promise<number> {
  const user = await deps.repo.findUserById(session.userId);
  const count = await deps.sessions.revokeAll(session.userId);
  await deps.repo.appendEvent({ userId: session.userId, type: "sessions_revoked_all", deviceId: session.deviceId, metadata: { count } });
  if (user) await notifyAccount(deps, user.email, "sessions_revoked_all", { count: String(count) });
  return count;
}

export async function signOut(deps: AuthDeps, session: Session): Promise<void> {
  await deps.sessions.revoke(session.handle, session.userId);
  await deps.repo.appendEvent({ userId: session.userId, type: "session_revoked", deviceId: session.deviceId, metadata: { signOut: true } });
}
