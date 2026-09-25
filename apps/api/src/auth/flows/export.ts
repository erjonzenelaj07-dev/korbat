import { AuthError, type AuthDeps } from "../context";
import { EVENT_RETENTION_DAYS } from "../janitor";
import { HOUR } from "../limits";
import type { AuthEventType, UserRole } from "../repo";

const DAY = 24 * HOUR;

/**
 * The auth module's part of the data export (1b design, section 7.5): the account row's facts, its live
 * sessions, its devices and its own security events. Times are Dates here; the account module writes
 * them as ISO text.
 */
export interface AccountExport {
  account: {
    id: string;
    email: string;
    createdAt: Date;
    role: UserRole;
    mfaEnabled: boolean;
    hasPassword: boolean;
    /** The verified badge as this row records it: the phone hash is held exactly while the badge is. */
    verified: boolean;
    termsVersion: string | null;
    termsAcceptedAt: Date | null;
  };
  /** Live sessions only, most recently used first. The caller marks the current one. */
  sessions: { id: string; createdAt: Date; lastUsedAt: Date }[];
  devices: { label: string | null; platform: string; firstSeenAt: Date; lastSeenAt: Date }[];
  /** The account's own events, newest first, at most the 90 days the janitor keeps; the metadata stays behind. */
  events: { type: AuthEventType; at: Date }[];
}

export async function exportAccount(deps: AuthDeps, userId: string): Promise<AccountExport> {
  const user = await deps.repo.findUserById(userId);
  // A session whose account is gone is answered as /me answers it.
  if (!user) throw new AuthError("invalid_credentials", 401);
  const now = deps.now();
  const [sessions, devices, events] = await Promise.all([
    deps.repo.listActiveSessions(userId, now),
    deps.repo.listDevices(userId),
    deps.repo.eventsSince(userId, new Date(now.getTime() - EVENT_RETENTION_DAYS * DAY)),
  ]);
  return {
    account: {
      id: user.id,
      email: user.email,
      createdAt: user.createdAt,
      role: user.role,
      mfaEnabled: user.totpEnabledAt !== null,
      hasPassword: user.passwordHash !== null,
      verified: user.phoneHash !== null,
      termsVersion: user.termsVersion,
      termsAcceptedAt: user.termsAcceptedAt,
    },
    sessions: sessions.map((session) => ({ id: session.id, createdAt: session.createdAt, lastUsedAt: session.lastUsedAt })),
    devices: devices.map((device) => ({ label: device.label, platform: device.platform, firstSeenAt: device.firstSeenAt, lastSeenAt: device.lastSeenAt })),
    events: events.map((event) => ({ type: event.type, at: event.createdAt })),
  };
}
