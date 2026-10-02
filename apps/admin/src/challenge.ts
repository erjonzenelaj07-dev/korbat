import { CEREMONY_CHALLENGE, CHALLENGE_PURPOSES } from "@korbat/contracts";
import { messageFor } from "./messages";
import { fromBase64url } from "./webauthn";

/**
 * The console's check of a sign-in's and an enrolment's challenge before it asks for the key (3a design, section 9). An
 * API under an attacker's control could otherwise hand the sign-in a step-up challenge for an action of its choosing: the
 * key would sign it at an ordinary sign-in, and the assertion would pass audit-verify as a confirmation of that action.
 * So the challenge must be the contracts' 58-byte layout, version 1, with the purpose of exactly this ceremony; a step-up
 * challenge is 74 bytes with a purpose of its own, so it can never pass. The step-up's own check is in step-up.ts.
 */

/** Options whose challenge is not one of this ceremony's; the key was not asked. */
export class CeremonyMismatch extends Error {
  readonly status = 0;
  constructor(readonly code: "signin_mismatch" | "enroll_mismatch") {
    super(messageFor(code));
    this.name = "CeremonyMismatch";
  }
}

/**
 * The challenge's bytes when it is the 58-byte layout of version 1 with `purpose`, or null. It is decoded by the same
 * function that turns it into the bytes the browser hands the key, so the bytes checked are the bytes signed.
 */
function ceremonyBytes(challenge: unknown, purpose: "staff_signin" | "staff_register"): Uint8Array | null {
  if (typeof challenge !== "string") return null;
  let bytes: Uint8Array;
  try {
    bytes = fromBase64url(challenge);
  } catch {
    return null;
  }
  const c = CEREMONY_CHALLENGE;
  if (bytes.length !== c.bytes || bytes[c.versionAt] !== c.version || bytes[c.purposeAt] !== CHALLENGE_PURPOSES[purpose]) return null;
  return bytes;
}

/** A staff sign-in's challenge: the 58-byte layout with the staff_signin purpose, bound to nothing, so its binding is zeros. */
export function checkSignInChallenge(options: { challenge?: unknown }): void {
  const bytes = ceremonyBytes(options.challenge, "staff_signin");
  const c = CEREMONY_CHALLENGE;
  if (!bytes || !bytes.subarray(c.bindingAt, c.bindingAt + c.bindingBytes).every((byte) => byte === 0)) throw new CeremonyMismatch("signin_mismatch");
}

/**
 * A staff registration's challenge: the 58-byte layout with the staff_register purpose. Its binding is the first 16 bytes
 * of the sha256 of the enrolment's id, which the page is never told, so the API alone checks it.
 */
export function checkRegisterChallenge(options: { challenge?: unknown }): void {
  if (!ceremonyBytes(options.challenge, "staff_register")) throw new CeremonyMismatch("enroll_mismatch");
}
