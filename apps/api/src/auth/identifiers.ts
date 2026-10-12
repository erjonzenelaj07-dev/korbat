import { hmacHex } from "./crypto";

/**
 * Keyed, namespaced hashes for identifiers the server must recognise but never store raw.
 * The namespace prefix keeps a device id, an IP, an email and a phone number that happen to share
 * text from producing the same hash.
 */
export function deviceHash(key: Buffer, deviceId: string): string {
  return hmacHex(key, `device:${deviceId}`);
}

export function ipHash(key: Buffer, ip: string): string {
  return hmacHex(key, `ip:${ip}`);
}

/** The network a client is on, as client-ip.ts names it: what the limits that count per network are keyed by. */
export function netHash(key: Buffer, network: string): string {
  return hmacHex(key, `net:${network}`);
}

export function emailHash(key: Buffer, email: string): string {
  return hmacHex(key, `email:${email.trim().toLowerCase()}`);
}

/** The number arrives in E.164 already (the Phone contract), so it is hashed as given. */
export function phoneHash(key: Buffer, phone: string): string {
  return hmacHex(key, `phone:${phone}`);
}
