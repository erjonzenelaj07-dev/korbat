import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { STAFF_STEP_UP_CHALLENGE, stepUpBindingText } from "@korbat/contracts";
import { AuthError } from "../context";
import { sha256Hex } from "../crypto";
import type { KeyValueStore } from "../kv";
import { MINUTE } from "../limits";

/**
 * Which ceremony a challenge was issued for; a challenge answers only the ceremony it names. The staff console's two
 * (3a design, section 5) share the layout, the key, the lifetime and the used-challenge markers, so an app sign-in
 * challenge never opens the console's sign-in and a personal passkey's registration challenge never enrols a staff key.
 * The staff step-up has a layout of its own (issueStepUpChallenge below), with the same key, lifetime and markers.
 */
export type ChallengePurpose = "signin" | "register" | "reauth" | "staff_signin" | "staff_register";

/** How long a challenge is valid: the top of WebAuthn L3's recommended range for a ceremony. */
export const CHALLENGE_TTL_MS = 10 * MINUTE;

/**
 * A step-up challenge is read only while at least this much of its life is left. Its action's audit row is stamped by the
 * database after the WebAuthn check, the counter update and the waits for the account's row and the audit head, and
 * audit-verify refuses a row written at or after the challenge's expiry; such a row can never be repaired. A minute is
 * harmless under the browser's 5-minute prompt, and the expiry the challenge carries stays the full ten minutes.
 */
export const STEP_UP_READ_MARGIN_MS = MINUTE;

const VERSION = 1;
const PURPOSE_CODES: Record<ChallengePurpose, number> = { signin: 1, register: 2, reauth: 3, staff_signin: 4, staff_register: 5 };

// The layout: version (1 byte), purpose (1), expiry in epoch milliseconds (8, big-endian), nonce (16), binding (16), then
// the first 16 bytes of HMAC-SHA256 over the 42 before them.
const PURPOSE_AT = 1;
const EXPIRY_AT = 2;
const NONCE_AT = 10;
const BINDING_AT = 26;
const MAC_AT = 42;
const NONCE_BYTES = 16;
const BINDING_BYTES = 16;
const MAC_BYTES = 16;
const CHALLENGE_BYTES = 58;
/** 58 bytes as unpadded base64url. */
const ENCODED_LENGTH = 78;
// The step-up layout, at the contracts' offsets, which audit-verify and the console read too: version (1 byte), purpose
// (1), expiry (8), nonce (16), the full 32-byte binding, then the first 16 bytes of HMAC-SHA256 over the 58 before them.
const STEP_UP = STAFF_STEP_UP_CHALLENGE;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** The used-challenge markers in the key-value store, keyed by the challenge's hash rather than the challenge itself. */
const USED_PREFIX = "webauthn-used:";

const derivedKeys = new WeakMap<Buffer, Buffer>();

/**
 * The key challenges are sealed with: HKDF-SHA256 of AUTH_HMAC_KEY under its own label, so no other use of that key can
 * produce a valid seal. It is derived once per key buffer; the flows can ask for it on every request.
 */
export function challengeKey(authHmacKey: Buffer): Buffer {
  let key = derivedKeys.get(authHmacKey);
  if (!key) {
    key = Buffer.from(hkdfSync("sha256", authHmacKey, "", "korbat-webauthn-challenge", 32));
    derivedKeys.set(authHmacKey, key);
  }
  return key;
}

const invalid = () => new AuthError("passkey_invalid", 401);
const expired = () => new AuthError("challenge_expired", 400);

/**
 * The first 16 bytes of sha256 of what the challenge is bound to (a session's handle, or a staff enrolment's id), zeros
 * for one bound to nothing (the two sign-ins).
 */
function binding(boundTo: string | undefined): Buffer {
  if (boundTo === undefined) return Buffer.alloc(BINDING_BYTES);
  return createHash("sha256").update(boundTo).digest().subarray(0, BINDING_BYTES);
}

function seal(key: Buffer, signed: Buffer): Buffer {
  return createHmac("sha256", key).update(signed).digest().subarray(0, MAC_BYTES);
}

/**
 * The challenge's bytes in one layout (58 bytes for the ceremonies' challenges, 74 for a step-up's), or null for anything
 * else. Only the canonical encoding is accepted: Node's decoder ignores the spare bits of the last character, so without
 * this check several strings would name the same challenge, and each would get its own used-challenge marker.
 */
function decodeAs(challenge: string, length: number, encodedLength: number): Buffer | null {
  if (typeof challenge !== "string" || challenge.length !== encodedLength || !BASE64URL.test(challenge)) return null;
  const bytes = Buffer.from(challenge, "base64url");
  if (bytes.length !== length || bytes.toString("base64url") !== challenge) return null;
  return bytes;
}

const decode = (challenge: string) => decodeAs(challenge, CHALLENGE_BYTES, ENCODED_LENGTH);

/** A challenge of either layout, for spending: both keep their expiry at the same offset. */
const decodeAny = (challenge: string) => decode(challenge) ?? decodeAs(challenge, STEP_UP.bytes, STEP_UP.encodedLength);

/**
 * A stateless WebAuthn challenge: its purpose, its expiry (10 minutes from now), a random nonce and a binding, sealed with
 * an HMAC. Registration and re-authentication bind it to the session's handle, a staff registration to its enrolment's id,
 * and the two sign-ins to nothing. Handing one out stores nothing, so the unauthenticated sign-in options cannot fill the
 * key-value store.
 */
export function issueChallenge(key: Buffer, purpose: ChallengePurpose, now: Date, boundTo?: string): string {
  const bytes = Buffer.alloc(CHALLENGE_BYTES);
  bytes[0] = VERSION;
  bytes[PURPOSE_AT] = PURPOSE_CODES[purpose];
  bytes.writeBigUInt64BE(BigInt(now.getTime() + CHALLENGE_TTL_MS), EXPIRY_AT);
  randomBytes(NONCE_BYTES).copy(bytes, NONCE_AT);
  binding(boundTo).copy(bytes, BINDING_AT);
  seal(key, bytes.subarray(0, MAC_AT)).copy(bytes, MAC_AT);
  return bytes.toString("base64url");
}

/**
 * Checks a challenge a ceremony's client data names before any WebAuthn verification runs: the seal first, in constant
 * time, so a forged challenge says nothing about which field failed; then the version, the purpose and the binding
 * (`passkey_invalid`), and only then the expiry (`challenge_expired`), which the app answers by starting over. Pass what
 * the challenge was issued bound to: the session's handle for registration and re-authentication, the enrolment's id for
 * a staff registration, nothing for the sign-ins. The staff flows answer this function's passkey_invalid with a staff code.
 */
export function readChallenge(key: Buffer, challenge: string, purpose: ChallengePurpose, now: Date, boundTo?: string): void {
  const bytes = decode(challenge);
  if (!bytes) throw invalid();
  if (!timingSafeEqual(bytes.subarray(MAC_AT), seal(key, bytes.subarray(0, MAC_AT)))) throw invalid();
  if (bytes[0] !== VERSION || bytes[PURPOSE_AT] !== PURPOSE_CODES[purpose]) throw invalid();
  if (!bytes.subarray(BINDING_AT, MAC_AT).equals(binding(boundTo))) throw invalid();
  if (now.getTime() >= Number(bytes.readBigUInt64BE(EXPIRY_AT))) throw expired();
}

/**
 * The binding of a step-up challenge (3a design, section 7, Step-up): all 32 bytes of the sha256 of the staff session's
 * handle, a newline and the action's hash, so audit-verify and the console can recompute it from what they hold, without
 * the sealing key.
 */
function stepUpBinding(sessionHandle: string, actionHash: string): Buffer {
  return createHash("sha256").update(stepUpBindingText(sessionHandle, actionHash)).digest();
}

/**
 * A staff step-up challenge: the step-up purpose, its expiry (10 minutes from now, as every other ceremony's), a random
 * nonce and the binding of the session and the action, sealed with the same key as the other challenges. An assertion
 * made over it confirms that one action in that one session and nothing else. Handing one out stores nothing.
 */
export function issueStepUpChallenge(key: Buffer, now: Date, sessionHandle: string, actionHash: string): string {
  const bytes = Buffer.alloc(STEP_UP.bytes);
  bytes[STEP_UP.versionAt] = STEP_UP.version;
  bytes[STEP_UP.purposeAt] = STEP_UP.purpose;
  bytes.writeBigUInt64BE(BigInt(now.getTime() + CHALLENGE_TTL_MS), STEP_UP.expiryAt);
  randomBytes(STEP_UP.nonceBytes).copy(bytes, STEP_UP.nonceAt);
  stepUpBinding(sessionHandle, actionHash).copy(bytes, STEP_UP.bindingAt);
  seal(key, bytes.subarray(0, STEP_UP.sealAt)).copy(bytes, STEP_UP.sealAt);
  return bytes.toString("base64url");
}

/**
 * Checks a step-up challenge as readChallenge checks the others: the seal first, in constant time; then the version, the
 * purpose and the binding of this session and this action (`passkey_invalid`); and only then the expiry
 * (`challenge_expired`), which here comes a minute early (STEP_UP_READ_MARGIN_MS), so the action's row is written before
 * it. A challenge of the other layout is refused by its length. The step-up flow answers this function's passkey_invalid
 * with staff_step_up_invalid.
 */
export function readStepUpChallenge(key: Buffer, challenge: string, now: Date, sessionHandle: string, actionHash: string): void {
  const bytes = decodeAs(challenge, STEP_UP.bytes, STEP_UP.encodedLength);
  if (!bytes) throw invalid();
  if (!timingSafeEqual(bytes.subarray(STEP_UP.sealAt), seal(key, bytes.subarray(0, STEP_UP.sealAt)))) throw invalid();
  if (bytes[STEP_UP.versionAt] !== STEP_UP.version || bytes[STEP_UP.purposeAt] !== STEP_UP.purpose) throw invalid();
  if (!bytes.subarray(STEP_UP.bindingAt, STEP_UP.sealAt).equals(stepUpBinding(sessionHandle, actionHash))) throw invalid();
  if (now.getTime() + STEP_UP_READ_MARGIN_MS >= Number(bytes.readBigUInt64BE(STEP_UP.expiryAt))) throw expired();
}

/**
 * Makes a challenge single-use, a step-up's included; call it right after readChallenge or readStepUpChallenge, before the
 * WebAuthn verification, so a challenge stays spent whatever happens next. The marker lives for the rest of the
 * challenge's lifetime: after that the read refuses the challenge anyway. A second spend is `passkey_invalid`.
 */
export async function spendChallenge(kv: KeyValueStore, challenge: string, now: Date): Promise<void> {
  const bytes = decodeAny(challenge);
  if (!bytes) throw invalid();
  const remaining = Number(bytes.readBigUInt64BE(EXPIRY_AT)) - now.getTime();
  // Refused as readChallenge refuses it, which also keeps the store from being handed a TTL of zero or less (Redis refuses one).
  if (remaining <= 0) throw expired();
  if (!(await kv.setIfAbsent(USED_PREFIX + sha256Hex(challenge), "1", remaining))) throw invalid();
}
