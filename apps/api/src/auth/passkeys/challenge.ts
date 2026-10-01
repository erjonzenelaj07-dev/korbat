import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { AuthError } from "../context";
import { sha256Hex } from "../crypto";
import type { KeyValueStore } from "../kv";
import { MINUTE } from "../limits";

/**
 * Which ceremony a challenge was issued for; a challenge answers only the ceremony it names. The staff console's two
 * (3a design, section 5) share the layout, the key, the lifetime and the used-challenge markers, so an app sign-in
 * challenge never opens the console's sign-in and a personal passkey's registration challenge never enrols a staff key.
 */
export type ChallengePurpose = "signin" | "register" | "reauth" | "staff_signin" | "staff_register";

/** How long a challenge is valid: the top of WebAuthn L3's recommended range for a ceremony. */
export const CHALLENGE_TTL_MS = 10 * MINUTE;

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
 * The challenge's 58 bytes, or null for anything else. Only the canonical encoding is accepted: Node's decoder ignores
 * the spare bits of the last character, so without this check several strings would name the same challenge, and each
 * would get its own used-challenge marker.
 */
function decode(challenge: string): Buffer | null {
  if (typeof challenge !== "string" || challenge.length !== ENCODED_LENGTH || !BASE64URL.test(challenge)) return null;
  const bytes = Buffer.from(challenge, "base64url");
  if (bytes.length !== CHALLENGE_BYTES || bytes.toString("base64url") !== challenge) return null;
  return bytes;
}

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
 * Makes a challenge single-use; call it right after readChallenge, before the WebAuthn verification, so a challenge stays
 * spent whatever happens next. The marker lives for the rest of the challenge's lifetime: after that readChallenge
 * refuses the challenge anyway. A second spend is `passkey_invalid`.
 */
export async function spendChallenge(kv: KeyValueStore, challenge: string, now: Date): Promise<void> {
  const bytes = decode(challenge);
  if (!bytes) throw invalid();
  const remaining = Number(bytes.readBigUInt64BE(EXPIRY_AT)) - now.getTime();
  // Refused as readChallenge refuses it, which also keeps the store from being handed a TTL of zero or less (Redis refuses one).
  if (remaining <= 0) throw expired();
  if (!(await kv.setIfAbsent(USED_PREFIX + sha256Hex(challenge), "1", remaining))) throw invalid();
}
