import { randomBytes } from "node:crypto";
import { base32Encode } from "./base32";
import { hmacHex, safeEqual } from "./crypto";

export const RECOVERY_CODE_COUNT = 10;

/** Ten codes shaped `xxxx-xxxx-xxxx`, 60 random bits each, lowercase base32 (a-z, 2-7). */
export function newRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const s = base32Encode(randomBytes(8)).slice(0, 12);
    return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
  });
}

export function hashRecoveryCode(key: Buffer, code: string): string {
  return hmacHex(key, `recovery:${code.trim().toLowerCase()}`);
}

/** Returns the remaining hashes when the code matches one of them, otherwise null. */
export function consumeRecoveryCode(key: Buffer, hashes: readonly string[], code: string): string[] | null {
  const candidate = hashRecoveryCode(key, code);
  let index = -1;
  hashes.forEach((h, i) => {
    if (safeEqual(h, candidate) && index === -1) index = i;
  });
  if (index === -1) return null;
  return hashes.filter((_, i) => i !== index);
}
