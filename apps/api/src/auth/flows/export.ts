import { AuthError, type AuthDeps } from "../context";
import { EVENT_RETENTION_DAYS } from "../janitor";
import { HOUR } from "../limits";
import type { AuthEventType, UserRole } from "../repo";

const DAY = 24 * HOUR;

/**
 * The auth module's part of the data export (1b design, section 7.5): the account row's facts, its
 * passkeys, its live sessions, its devices and its own security events. Times are Dates here; the
 * account module writes them as ISO text.
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
  /**
   * The account's passkeys, newest first, as the Security list shows them (1c design, section 7.7): the key
   * material, the credential id, the AAGUID and the row's id stay behind, since none of them is the owner's to
   * carry and any of them would name the key to whoever reads the archive.
   */
  passkeys: { name: string; createdAt: Date; lastUsedAt: Date | null; synced: boolean; createdOn: string | null }[];
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
  const [passkeys, sessions, devices, events] = await Promise.all([
    deps.repo.listPasskeys(userId),
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
    // The backed-up flag is what the Security list calls synced; the list is already newest first.
    passkeys: passkeys.map((passkey) => ({ name: passkey.name, createdAt: passkey.createdAt, lastUsedAt: passkey.lastUsedAt, synced: passkey.backedUp, createdOn: passkey.createdOn })),
    sessions: sessions.map((session) => ({ id: session.id, createdAt: session.createdAt, lastUsedAt: session.lastUsedAt })),
    devices: devices.map((device) => ({ label: device.label, platform: device.platform, firstSeenAt: device.firstSeenAt, lastSeenAt: device.lastSeenAt })),
    events: events.map((event) => ({ type: event.type, at: event.createdAt })),
  };
}
