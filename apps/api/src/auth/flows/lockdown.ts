import type { AuthDeps, RequestContext } from "../context";
import { HOUR } from "../limits";
import type { AuthEventType } from "../repo";

/** How far back a lockdown reaches before its anchor (1c design, section 2): a day catches what an attacker set up just before the event the owner noticed. */
export const LOCKDOWN_LOOKBACK_MS = 24 * HOUR;

/** Who ran the lockdown, for the event it records: the event's type, the device it concerns, and the caller's own facts, kept beside the lockdown's. */
export interface LockdownCaller {
  type: AuthEventType;
  deviceId?: string | null;
  metadata?: Record<string, unknown>;
}

/** What one run did, as its event records it. The password is cleared on every run. */
export interface LockdownReport {
  passkeysRemoved: string[];
  totpCleared: boolean;
  passwordCleared: true;
}

/**
 * The one routine behind every undo link (1c design, sections 2 and 7.6): every session revoked with a tombstone, every
 * device revoked (so the next sign-in on any of them is a new device again, and the owner hears of it), the password
 * cleared, the passkeys created at or after the day before the anchor removed, plus any the caller names (the one that
 * signed in, or the one a link is about, whatever its age), and TOTP turned off when it was enabled at or after that
 * day. The anchor is the event the owner is answering: the alerted sign-in, the address change, a passkey's creation.
 * What the owner had from before stays, except the password, which nobody can tell from one an attacker set. Running
 * it again finds nothing more to remove and records that.
 */
export async function lockdown(
  deps: AuthDeps,
  input: { userId: string; anchor: Date; passkeyIds?: readonly string[]; caller: LockdownCaller; ctx: RequestContext },
): Promise<LockdownReport> {
  const now = deps.now();
  const since = new Date(input.anchor.getTime() - LOCKDOWN_LOOKBACK_MS);
  await deps.sessions.revokeAll(input.userId);
  await deps.repo.revokeDevices(input.userId, now);
  await deps.repo.setPasswordHash(input.userId, null, now);
  const passkeysRemoved = await deps.repo.deletePasskeys(input.userId, { since, ids: input.passkeyIds ?? [] });
  // The row is read after the writes above, none of which touch two-factor; an account that is gone has none to clear.
  const user = await deps.repo.findUserById(input.userId);
  const totpCleared = user !== undefined && user.totpEnabledAt !== null && user.totpEnabledAt.getTime() >= since.getTime();
  if (totpCleared) await deps.repo.disableTotp(input.userId);
  const report: LockdownReport = { passkeysRemoved, totpCleared, passwordCleared: true };
  await deps.repo.appendEvent({
    userId: input.userId,
    type: input.caller.type,
    deviceId: input.caller.deviceId ?? null,
    ipHash: input.ctx.ipHash,
    metadata: { ...input.caller.metadata, ...report },
  });
  return report;
}
