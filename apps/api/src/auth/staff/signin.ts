import type { StaffMe, StaffRole, StaffSignInVerifyRequest } from "@korbat/contracts";
import { AuthError, type AuthDeps, type StaffRequestContext } from "../context";
import { deviceLabel } from "../devices";
import { noticeTime, notifyAccount } from "../flows/notify";
import { HOUR, enforceLimit } from "../limits";
import { challengeKey, issueChallenge, readChallenge, spendChallenge } from "../passkeys/challenge";
import { authenticationOptions, readResponseChallenge, verifyAuthentication, type PublicKeyCredentialRequestOptionsJSON } from "../passkeys/webauthn";
import { consoleOf } from "./enroll";
import { revokeForCounterRegression } from "./revoke";
import { openStaffSession, staffMe } from "./sessions";

/**
 * The staff sign-in (3a design, section 7, Sign-in). The console asks for options, the browser offers the staff keys it
 * holds for the console's relying party, and the answer opens a staff session. Only a live staff key of a live staff
 * account opens one, and only when its authenticator reported user verification and neither backup eligibility nor a
 * backup at this use. The routes live in the staff module, behind the staff gate; the credential work is here.
 */

/** Sign-in attempts per client address an hour, counted before anything else. */
export const STAFF_SIGNIN_PER_IP_PER_HOUR = 20;
/** Sign-ins per staff key an hour, counted only once its signature and flags have checked, so only its holder spends them. */
export const STAFF_SIGNIN_PER_KEY_PER_HOUR = 10;

/** The one answer for every failure up to and including the signature, so no answer tells a live key from a revoked or unknown one. */
const keyInvalid = () => new AuthError("staff_key_invalid", 401);

/** Runs one step of the codec or the wrapper, answering its passkey_* refusals with staff_key_invalid; challenge_expired stays, and the console starts over on it. */
async function invalidAsStaff<T>(step: () => T | Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (err) {
    if (err instanceof AuthError && (err.code === "passkey_invalid" || err.code === "passkey_unsupported")) throw keyInvalid();
    throw err;
  }
}

/** What a sign-in hands the staff route: the session's token, for the cookie, and the answer /me would give. */
export interface StaffSignedIn {
  token: string;
  me: StaffMe;
}

/**
 * Options for a staff sign-in: an empty allow list, so the options name no account and the browser offers every
 * discoverable credential it holds for the console's relying party; user verification required; and a staff sign-in
 * challenge bound to nothing, which no other ceremony accepts. Handing them out stores nothing.
 */
export async function signInOptions(deps: AuthDeps): Promise<{ options: PublicKeyCredentialRequestOptionsJSON }> {
  const staffConsole = consoleOf(deps);
  const challenge = issueChallenge(challengeKey(deps.config.authHmacKey), "staff_signin", deps.now());
  const options = await authenticationOptions({ rpId: staffConsole.rpId, allow: [], challenge, userVerification: "required" });
  return { options };
}

/**
 * Verifies a staff sign-in. The per-address limit is counted first. The challenge is read from the response and spent
 * before anything else runs, so a forged, foreign or spent one never reaches the library. Then the key must be a live
 * staff key of a live staff account, and the response must carry that account's user handle, since the allow list named
 * no one (as 1c's sign-in requires). Every failure so far, and a response the library refuses on its signature, its origin
 * (CONSOLE_ORIGIN alone) or its relying party (CONSOLE_RP_ID alone), is staff_key_invalid. Only after the signature are the
 * flags read, each refusal with its own code; then the per-key limit is counted, so an unsigned response naming a key's
 * credential id cannot lock its owner out; then 1c's counter rule, in the session's own transaction, where a regression
 * revokes the key. The session is mailed to its owner after the commit.
 */
export async function signInVerify(deps: AuthDeps, input: StaffSignInVerifyRequest, ctx: StaffRequestContext): Promise<StaffSignedIn> {
  await enforceLimit(deps.kv, `staff-signin:ip:${ctx.ipHash}`, STAFF_SIGNIN_PER_IP_PER_HOUR, HOUR);
  const staffConsole = consoleOf(deps);
  const now = deps.now();
  const challenge = await invalidAsStaff(() => readResponseChallenge(input.response));
  await invalidAsStaff(() => readChallenge(challengeKey(deps.config.authHmacKey), challenge, "staff_signin", now));
  await invalidAsStaff(() => spendChallenge(deps.kv, challenge, now));

  const key = await deps.repo.findStaffKeyForSignIn(input.response.id);
  // An unknown or revoked key, and an account that is deleted or no longer staff, are one answer. In development, where
  // the console's relying party ID is the app's, a personal passkey the browser offers here is refused by this lookup alone.
  if (!key || key.revokedAt !== null || key.deletedAt !== null || key.role === "user") throw keyInvalid();
  const userHandle = input.response.response.userHandle;
  if (userHandle === undefined || key.webauthnUserId === null || !Buffer.from(userHandle, "base64url").equals(key.webauthnUserId)) throw keyInvalid();

  const verified = await invalidAsStaff(() =>
    verifyAuthentication({
      response: input.response,
      expectedChallenge: challenge,
      origins: [staffConsole.origin],
      rpId: staffConsole.rpId,
      credential: { id: key.credentialId, publicKey: key.publicKey, transports: key.transports },
    }),
  );
  // After the signature only, so each refusal is a claim the key itself signed. WebAuthn L3 asks a relying party that uses
  // BE in its policy to check it on every assertion, and BS as well, since a key can be synced after it was registered.
  if (!verified.userVerified) throw new AuthError("staff_key_not_user_verified", 403);
  if (verified.backupEligible || verified.backedUp) throw new AuthError("staff_key_not_device_bound", 403);
  await enforceLimit(deps.kv, `staff-signin:key:${key.id}`, STAFF_SIGNIN_PER_KEY_PER_HOUR, HOUR);

  const browser = deviceLabel(ctx.userAgent, "web");
  const role = key.role as StaffRole;
  const opened = await openStaffSession(deps, { userId: key.userId, keyId: key.id, role, newCounter: verified.newCounter, browser }, ctx);
  // Null when the key's counter did not move forward (or another revocation reached the key first): it is revoked now.
  if (!opened) return revokeForCounterRegression(deps, key, ctx);
  const { token, session } = opened;
  // After the commit, and best effort as every notice is: a failed mail never undoes a sign-in.
  await notifyAccount(deps, key.email, "staff_session_started", { name: key.name, browser, time: noticeTime(session.createdAt) });
  return { token, me: await staffMe(deps, session) };
}
