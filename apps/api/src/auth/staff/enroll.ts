import { randomBytes } from "node:crypto";
import type { StaffEnrollOptionsRequest, StaffEnrollVerifyRequest, StaffEnrollVerifyResponse } from "@korbat/contracts";
import { AuthError, isUniqueViolation, type AuthDeps, type StaffRequestContext } from "../context";
import { sha256Hex } from "../crypto";
import { noticeTime, notifyAccount } from "../flows/notify";
import { challengeKey, issueChallenge, readChallenge, spendChallenge } from "../passkeys/challenge";
import {
  readResponseChallenge,
  registrationOptions,
  verifyRegistration,
  type CredentialDescriptor,
  type PublicKeyCredentialCreationOptionsJSON,
} from "../passkeys/webauthn";
import type { StaffEnrollmentRow } from "../repo";

/**
 * Staff key enrolment (3a design, section 7, Enrolment). The link `staff.js enroll` printed carries a one-time token; the
 * console's enrolment page asks for the key's options with it, then hands the browser's answer back with it. The routes
 * live in the staff module, behind the staff gate; the credential work is here.
 */

/** The options as the library wrote them, which the contracts' StaffEnrollOptionsResponse passes through to the browser. */
export interface StaffEnrollOptions {
  options: PublicKeyCredentialCreationOptionsJSON;
  rpShared: boolean;
}

const enrollmentInvalid = () => new AuthError("staff_enrollment_invalid", 400);
/** Every refusal of the codec or the wrapper at enrolment: no staff answer carries a passkey_* code (3a design, section 10). */
const keyRefused = () => new AuthError("staff_key_refused", 400);

/** The console as the configuration sets it; the staff routes are mounted only while it is on, so its absence is a wiring fault. */
export function consoleOf(deps: AuthDeps): { origin: string; rpId: string } {
  if (!deps.config.console) throw new Error("the staff console is off: CONSOLE_ORIGIN is not set");
  return deps.config.console;
}

/** Whether staff keys and personal passkeys share a relying party ID, as both are localhost in development (3a design, section 2). */
function sharedRelyingParty(deps: AuthDeps): boolean {
  return deps.config.console !== null && deps.config.console.rpId === deps.config.webauthn.rpId;
}

/**
 * The enrolment a link's token names, while it can still enrol a key: unused, unexpired by the flows' clock, issued for
 * the console as it is configured now (a link issued before the console moved would bind a key to the old address), and
 * for an account that is live, staff and has a handle. Anything else, an unknown token included, is one answer.
 * auth.add_staff_key checks all of it again under the account's lock, by the database's clock.
 */
async function liveEnrollment(deps: AuthDeps, token: string): Promise<StaffEnrollmentRow> {
  const staffConsole = consoleOf(deps);
  const enrollment = await deps.repo.findStaffEnrollment(sha256Hex(token));
  if (!enrollment) throw enrollmentInvalid();
  if (enrollment.usedAt !== null || enrollment.expiresAt.getTime() <= deps.now().getTime()) throw enrollmentInvalid();
  if (enrollment.origin !== staffConsole.origin || enrollment.rpId !== staffConsole.rpId) throw enrollmentInvalid();
  if (enrollment.deletedAt !== null || enrollment.role === "user" || enrollment.onboardedAt === null) throw enrollmentInvalid();
  return enrollment;
}

/** Runs one step of the codec or the wrapper, answering its passkey_* refusals with staff_key_refused; challenge_expired stays, and the console starts over on it. */
async function refusedAsStaff<T>(step: () => T | Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (err) {
    if (err instanceof AuthError && (err.code === "passkey_invalid" || err.code === "passkey_unsupported")) throw keyRefused();
    throw err;
  }
}

/**
 * Registration options for a staff key: the console's relying party, the account's 1c user handle (set now with 1c's
 * compare-and-set when the account has none), the key's name as the only label the authenticator shows, user
 * verification and a resident key required, the pinned algorithms, and a staff registration challenge bound to the
 * enrolment's id. The account's live staff keys are excluded, and while the two relying party IDs are equal its personal
 * passkeys too, so an authenticator refuses rather than replacing one kind with the other under the same user handle. The
 * "Register a security key" button sends the security-key hint; "Use Windows Hello on this computer" sends none, since the
 * hint would hide Windows Hello. `rpShared` tells the page whether it may ask a password manager to drop a refused key.
 */
export async function enrollOptions(deps: AuthDeps, input: StaffEnrollOptionsRequest): Promise<StaffEnrollOptions> {
  const staffConsole = consoleOf(deps);
  const enrollment = await liveEnrollment(deps, input.token);
  // 32 random bytes, never the account id, set once: a passkey registration racing this one reads the same bytes back.
  const userHandle = enrollment.webauthnUserId ?? (await deps.repo.ensureWebauthnUserId(enrollment.userId, randomBytes(32)));
  if (!userHandle) throw enrollmentInvalid();
  const shared = sharedRelyingParty(deps);
  const exclude: CredentialDescriptor[] = (await deps.repo.listLiveStaffKeys(enrollment.userId)).map((k) => ({ id: k.credentialId, transports: k.transports }));
  if (shared) exclude.push(...(await deps.repo.listPasskeys(enrollment.userId)).map((p) => ({ id: p.credentialId, transports: p.transports })));
  const challenge = issueChallenge(challengeKey(deps.config.authHmacKey), "staff_register", deps.now(), enrollment.id);
  const options = await registrationOptions({
    rp: { id: staffConsole.rpId, name: deps.config.webauthn.rpName },
    // Never the email, the handle or the account id: the authenticator shows this name, and so does anyone who sees it.
    user: { id: userHandle, name: input.name, displayName: input.name },
    exclude,
    challenge,
    userVerification: "required",
    hint: input.kind === "security_key" ? "securityKey" : undefined,
  });
  return { options, rpShared: shared };
}

/**
 * Stores the staff key the browser created. The link is checked first, then the challenge is read from the response,
 * checked against the enrolment's id and spent before anything else runs, and the response verified against
 * CONSOLE_ORIGIN and CONSOLE_RP_ID alone; whatever the codec or the wrapper refuses is staff_key_refused. Only then are
 * the flags read, each refusal with its own code: a key that did not verify the user, or that reported backup
 * eligibility (it can be synced) or a backup. A refusal never spends the link, so the person can try another key until
 * it expires. The write is one transaction that ends in auth.add_staff_key; after the commit the owner is mailed.
 */
export async function enrollVerify(deps: AuthDeps, input: StaffEnrollVerifyRequest, ctx: StaffRequestContext): Promise<StaffEnrollVerifyResponse> {
  const staffConsole = consoleOf(deps);
  const enrollment = await liveEnrollment(deps, input.token);
  const now = deps.now();
  const key = challengeKey(deps.config.authHmacKey);
  const challenge = await refusedAsStaff(() => readResponseChallenge(input.response));
  await refusedAsStaff(() => readChallenge(key, challenge, "staff_register", now, enrollment.id));
  await refusedAsStaff(() => spendChallenge(deps.kv, challenge, now));
  const verified = await refusedAsStaff(() => verifyRegistration({ response: input.response, expectedChallenge: challenge, origins: [staffConsole.origin], rpId: staffConsole.rpId }));
  // After the library has verified, so each refusal is the authenticator's own claim about a key it really created.
  if (!verified.userVerified) throw new AuthError("staff_key_not_user_verified", 403);
  if (verified.backupEligible || verified.backedUp) throw new AuthError("staff_key_not_device_bound", 403);

  let outcome;
  try {
    outcome = await deps.repo.addStaffKey({
      userId: enrollment.userId,
      enrollmentId: enrollment.id,
      token: input.token,
      credentialId: verified.credentialId,
      publicKey: verified.publicKey,
      counter: verified.counter,
      transports: verified.transports,
      name: input.name,
      // Zeros when the authenticator or the browser withheld its model, which `staff.js keys` prints as such.
      aaguid: verified.aaguid,
      requestId: ctx.requestId,
    });
  } catch (err) {
    // A credential id korbat already holds as a staff key: the authenticator answered for a key that is not new.
    if (isUniqueViolation(err)) throw keyRefused();
    throw err;
  }
  if (!outcome.ok) throw outcome.reason === "limit" ? new AuthError("staff_key_limit", 409) : enrollmentInvalid();

  const stored = await deps.repo.findStaffKey(outcome.keyId);
  if (!stored) throw new Error(`the staff key ${outcome.keyId} was stored but cannot be read back`);
  // After the commit, and best effort as every notice is: a failed mail never undoes an enrolment.
  await notifyAccount(deps, enrollment.email, "staff_key_added", { name: stored.name, time: noticeTime(stored.createdAt) });
  return { key: { id: stored.id, name: stored.name, createdAt: stored.createdAt.toISOString(), lastUsedAt: stored.lastUsedAt?.toISOString() ?? null } };
}
