import type { Mailer } from "../mail/mailer";
import { noticeTime } from "./flows/notify";
import type { AuthRepo, UserRole } from "./repo";
import type { Sessions } from "./sessions";

/** The audit log's actor for changes made from the server's command line rather than by a signed-in person. */
export const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

/** What a role change did, for the command line's report. */
export interface RoleGranted {
  userId: string;
  previousRole: UserRole;
  staffSessionsRevoked: number;
  /** Unused enrolment links deleted, so none issued before the change enrols anything. */
  enrollmentsDeleted: number;
  /** Staff keys revoked: every live one on a change to user, none otherwise. */
  staffKeysRevoked: number;
  /** Why the staff_keys_revoked mail could not be sent, or null when it was sent or none was due. The change stands either way. */
  mailError: string | null;
  /**
   * Why the revoked app sessions' cache tombstones could not be written (Valkey unreachable), or null. The change stands:
   * the sessions are revoked in the database, and a cached copy lasts at most the cache's TTL.
   */
  tombstoneError: string | null;
}

/**
 * Changes an account's role. Used only by the server-side CLI; there is no API endpoint for it.
 * Every session and staff session of the account is revoked and every unused enrolment link deleted, so the new role (and
 * its MFA requirement) applies at once; a change to user also revokes every staff key (3a design, section 7). The change,
 * the revocations and their audit rows are one transaction on the auth role; after it commits, the cached sessions get
 * their tombstones and, when a staff key was revoked, the owner is mailed the keys' names. Both are best effort and
 * independent of each other: the change has committed, so a step that fails is reported to the caller, undoes nothing,
 * and never keeps the other from running (a Valkey outage must not cost the owner the mail that their keys went).
 */
export async function grantRole(deps: { repo: AuthRepo; sessions: Sessions; mailer: Mailer }, email: string, role: UserRole): Promise<RoleGranted> {
  const now = new Date();
  const changed = await deps.repo.changeRole(email, role, { actorId: SYSTEM_ACTOR_ID, now });
  if (!changed) throw new Error(`no account for ${email}`);
  let tombstoneError: string | null = null;
  try {
    await deps.sessions.tombstone(changed.sessionIds);
  } catch (err) {
    tombstoneError = err instanceof Error ? err.message : String(err);
  }
  let mailError: string | null = null;
  if (changed.keysRevoked.length > 0) {
    try {
      await deps.mailer.send({
        to: changed.email,
        template: "staff_keys_revoked",
        data: { names: changed.keysRevoked.map((key) => `"${key.name}"`).join(", "), time: noticeTime(now) },
      });
    } catch (err) {
      mailError = err instanceof Error ? err.message : String(err);
    }
  }
  return {
    userId: changed.userId,
    previousRole: changed.previousRole,
    staffSessionsRevoked: changed.staffSessionsRevoked,
    enrollmentsDeleted: changed.enrollmentsDeleted,
    staffKeysRevoked: changed.keysRevoked.length,
    mailError,
    tombstoneError,
  };
}
