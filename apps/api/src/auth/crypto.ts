import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_TOKEN_PREFIX = "kb1_";

/** Random bytes as base64url without padding. 32 bytes gives 43 characters. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hmacHex(key: Buffer, input: string): string {
  return createHmac("sha256", key).update(input).digest("hex");
}

/** Constant-time string comparison that does not throw when lengths differ. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function decodeKey(base64: string): Buffer {
  return Buffer.from(base64, "base64");
}

export interface VersionedKey {
  version: string;
  key: Buffer;
}

/** Parses `v<N>:<base64 of 32 bytes>`. */
export function parseVersionedKey(value: string): VersionedKey {
  const m = /^(v\d+):(.+)$/.exec(value);
  if (!m) throw new Error("encryption key must be versioned, e.g. v1:<base64>");
  const key = Buffer.from(m[2]!, "base64");
  if (key.length !== 32) throw new Error("encryption key must be exactly 32 bytes");
  return { version: m[1]!, key };
}

const IV_BYTES = 12;
/** The full GCM tag. Pinned on both sides so a forged, shorter tag can never be accepted. */
const TAG_BYTES = 16;

/** AES-256-GCM. Output: `<version>:<base64(iv[12] | tag[16] | ciphertext)>`. */
export function encrypt(plain: Buffer, k: VersionedKey): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", k.key, iv, { authTagLength: TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${k.version}:${Buffer.concat([iv, tag, ciphertext]).toString("base64")}`;
}

export function decrypt(payload: string, keys: VersionedKey[]): Buffer {
  const m = /^(v\d+):(.+)$/.exec(payload);
  if (!m) throw new Error("malformed ciphertext");
  const k = keys.find((x) => x.version === m[1]);
  if (!k) throw new Error(`no key for version ${m[1]}`);
  const raw = Buffer.from(m[2]!, "base64");
  if (raw.length < IV_BYTES + TAG_BYTES + 1) throw new Error("malformed ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", k.key, raw.subarray(0, IV_BYTES), { authTagLength: TAG_BYTES });
  decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
}

/** The key version a ciphertext was made with, or null when it is not of the expected shape. */
export function payloadVersion(payload: string): string | null {
  return /^(v[0-9]+):/.exec(payload)?.[1] ?? null;
}

/** A session token for the client and the id stored in auth.sessions (its sha256). */
export function newSessionToken(): { token: string; id: string } {
  const token = SESSION_TOKEN_PREFIX + randomToken(32);
  return { token, id: sha256Hex(token) };
}
