// The canonical text and the hashes that the step-up actions (staff.ts) and the moderation digests (moderation.ts) are
// built on. The API, audit-verify, text-verify and the console all call these, so each writes the same text and the same
// hash. The package's index does not export this module: its callers are the two files above, and (3f) orders.ts for the
// digests of the records to authorities.

/**
 * JSON with every object's keys sorted and no whitespace. Keys are sorted by UTF-16 code units (Array.prototype.sort's
 * order), and strings and numbers are written as JSON.stringify writes them, so the API, audit-verify and the console write
 * the same text. Anything JSON cannot carry is refused rather than dropped or changed, as JSON.stringify would.
 */
export function sortedJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("a canonical text holds only JSON values: a number must be finite");
    return JSON.stringify(value);
  }
  // Array.from visits holes too, so a sparse array is refused as undefined.
  if (Array.isArray(value)) return `[${Array.from(value, sortedJson).join(",")}]`;
  if (typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${sortedJson(record[key])}`)
      .join(",")}}`;
  }
  throw new TypeError(`a canonical text holds only JSON values, not ${value instanceof Object ? value.constructor.name : typeof value}`);
}

/**
 * The parts of the Web Crypto and Encoding APIs the hashes below use. Browsers and Node (from 19) both have them as
 * globals; the contracts are compiled without the DOM's or Node's types, so only these members are declared.
 */
interface WebPlatform {
  crypto: { subtle: { digest(algorithm: "SHA-256", data: Uint8Array): Promise<ArrayBuffer> } };
  TextEncoder: new () => { encode(text: string): Uint8Array };
}

const platform = () => globalThis as unknown as WebPlatform;

/** A text's UTF-8 bytes. */
export function utf8(text: string): Uint8Array {
  return new (platform().TextEncoder)().encode(text);
}

/** The sha256 of the bytes given. */
export async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await platform().crypto.subtle.digest("SHA-256", data));
}

/** The sha256 of a text's UTF-8 bytes. */
export async function sha256(text: string): Promise<Uint8Array> {
  return sha256Bytes(utf8(text));
}

/** Bytes as lower-case hex, the one spelling PostgreSQL's encode(..., 'hex') writes. */
export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
