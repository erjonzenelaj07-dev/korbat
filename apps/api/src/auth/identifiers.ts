import { hmacHex } from "./crypto";

/**
 * Keyed, namespaced hashes for identifiers the server must recognise but never store raw.
 * The namespace prefix keeps a device id, an IP and an email that happen to share text from
 * producing the same hash.
 */
export function deviceHash(key: Buffer, deviceId: string): string {
  return hmacHex(key, `device:${deviceId}`);
}

export function ipHash(key: Buffer, ip: string): string {
  return hmacHex(key, `ip:${ip}`);
}

export function emailHash(key: Buffer, email: string): string {
  return hmacHex(key, `email:${email.trim().toLowerCase()}`);
}
