import { createHmac, randomBytes } from "node:crypto";
import { renderSVG } from "uqr";
import { base32Encode } from "./base32";
import { safeEqual } from "./crypto";

export const TOTP_ISSUER = "korbat";
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;

/** 160-bit secret, the size RFC 4226 recommends for HMAC-SHA1. */
export function newTotpSecret(): Uint8Array {
  return new Uint8Array(randomBytes(20));
}

/** RFC 4226 HOTP: HMAC-SHA1 over the 8-byte big-endian counter, dynamic truncation, decimal digits. */
export function hotp(secret: Uint8Array, counter: number, digits: number = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", secret).update(message).digest();
  const offset = mac.readUInt8(mac.length - 1) & 0x0f;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function totpUri(secret: Uint8Array, accountName: string): string {
  const label = `${encodeURIComponent(TOTP_ISSUER)}:${encodeURIComponent(accountName)}`;
  const params = new URLSearchParams({
    secret: base32Encode(secret).toUpperCase(),
    issuer: TOTP_ISSUER,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export function totpQrSvg(uri: string): string {
  return renderSVG(uri, { ecc: "M", border: 2 });
}

export function currentStep(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

/**
 * RFC 6238 TOTP check. Returns the time step the code was accepted for, or null.
 * Accepts the previous, current and next step, but only a step later than `lastStep`, so a code
 * cannot be used twice. All three candidates are always computed to keep timing uniform.
 */
export function verifyTotp(secret: Uint8Array, code: string, lastStep: number | null, nowMs: number = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = currentStep(nowMs);
  let accepted: number | null = null;
  for (const step of [now - 1, now, now + 1]) {
    const matches = safeEqual(hotp(secret, step), code);
    if (matches && accepted === null && (lastStep === null || step > lastStep)) accepted = step;
  }
  return accepted;
}
