import type { Mailer } from "../../mail/mailer";
import { SYSTEM_ACTOR_ID } from "../admin";
import { AuthError, type AuthDeps, type StaffRequestContext } from "../context";
import { noticeTime, notifyAccount } from "../flows/notify";
import type { AuthRepo, StaffKeysRevoked } from "../repo";

/**
 * Revoking staff keys (3a design, section 7). The command line's `staff.js revoke` and the counter rule share one routine,
 * repo.revokeStaffKeys: the account's row locked first, the keys and every staff session they opened revoked, an event per
 * key and the audit rows last, all in one auth transaction. The counter rule also marks the key suspect and records the
 * regression as such. Only the command line enrols a replacement.
 */

/**
 * A staff key's counter went backwards after its signature verified, at a sign-in or at a step-up (`via` names which): the
 * key is revoked and marked suspect, every live staff session it opened revoked (at a step-up, the confirming one
 * included), staff_key_counter_regression recorded with its audit row, then its owner is mailed staff_key_suspect (never
 * 1c's passkey_suspect, whose remedy names the app's Security screen) and the attempt refused with staff_key_suspended. A
 * key that another revocation reached first, or whose account went meanwhile, is refused as any revoked key is at that
 * ceremony: staff_key_invalid at a sign-in, staff_step_up_invalid at a step-up.
 */
export async function revokeForCounterRegression(
  deps: AuthDeps,
  key: { id: string; userId: string; name: string },
  ctx: StaffRequestContext,
  via: "sign_in" | "step_up",
): Promise<never> {
  const revoked = await deps.repo.revokeStaffKeys({
    account: { id: key.userId },
    key: key.id,
    suspect: true,
    via,
    // The key's holder presented it, so the row is the account's; the request's id ties it to the access log.
    actorId: key.userId,
    now: deps.now(),
    requestId: ctx.requestId,
  });
  if (!revoked.ok || revoked.keys.length === 0) throw via === "sign_in" ? new AuthError("staff_key_invalid", 401) : new AuthError("staff_step_up_invalid", 403);
  // After the commit, and best effort as every notice is: a failed mail never undoes the revocation.
  await notifyAccount(deps, revoked.email, "staff_key_suspect", { name: key.name });
  throw new AuthError("staff_key_suspended", 403);
}

/** What `staff.js revoke` did, or why it found nothing to act on, and why its mail failed when it did. */
export type StaffKeysRevokedReport = (StaffKeysRevoked & { ok: false }) | (Extract<StaffKeysRevoked, { ok: true }> & { mailError: string | null });

/**
 * `staff.js revoke <email> <key id>` and `revoke <email> all`, from the server's command line only: the routine above with
 * the server as the actor, then, after the commit and only when a key was revoked, the owner is mailed the names of the
 * keys revoked (an enrolment link cancelled alone sends nothing, as with grant-role). The mail is best effort: one that
 * fails is reported to the caller and undoes nothing.
 */
export async function revokeStaffKeys(deps: { repo: AuthRepo; mailer: Mailer }, email: string, key: string | "all"): Promise<StaffKeysRevokedReport> {
  const now = new Date();
  const revoked = await deps.repo.revokeStaffKeys({ account: { email }, key, suspect: false, via: "cli", actorId: SYSTEM_ACTOR_ID, now });
  if (!revoked.ok) return revoked;
  let mailError: string | null = null;
  if (revoked.keys.length > 0) {
    try {
      await deps.mailer.send({
        to: revoked.email,
        template: "staff_keys_revoked",
        data: { names: revoked.keys.map((k) => `"${k.name}"`).join(", "), time: noticeTime(now) },
      });
    } catch (err) {
      mailError = err instanceof Error ? err.message : String(err);
    }
  }
  return { ...revoked, mailError };
}
