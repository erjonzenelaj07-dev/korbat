import { createCipheriv, randomBytes } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  SESSION_TOKEN_PREFIX,
  decrypt,
  encrypt,
  hmacHex,
  newSessionToken,
  parseVersionedKey,
  randomToken,
  safeEqual,
  sha256Hex,
} from "../../src/auth/crypto";

const key = parseVersionedKey(`v1:${Buffer.alloc(32, 1).toString("base64")}`);

describe("crypto", () => {
  test("random tokens are 43 url-safe characters and unique", () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });
  test("sha256 and hmac match published test vectors", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    // RFC 4231, test case 2
    expect(hmacHex(Buffer.from("Jefe"), "what do ya want for nothing?")).toBe("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
  });
  test("safeEqual compares without throwing on a length mismatch", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
  test("versioned keys must be vN and exactly 32 bytes", () => {
    expect(key.version).toBe("v1");
    expect(() => parseVersionedKey(Buffer.alloc(32).toString("base64"))).toThrow(/versioned/);
    expect(() => parseVersionedKey(`v1:${Buffer.alloc(16).toString("base64")}`)).toThrow(/32 bytes/);
  });
  test("AES-GCM round trip uses a fresh IV each time", () => {
    const plain = Buffer.from("totp secret bytes");
    const a = encrypt(plain, key);
    const b = encrypt(plain, key);
    expect(a).toMatch(/^v1:/);
    expect(a).not.toBe(b);
    expect(decrypt(a, [key]).equals(plain)).toBe(true);
  });
  test("tampered ciphertext, unknown key versions and garbage are rejected", () => {
    const payload = encrypt(Buffer.from("secret"), key);
    const raw = Buffer.from(payload.slice(3), "base64");
    raw.writeUInt8(raw.readUInt8(raw.length - 1) ^ 0xff, raw.length - 1);
    expect(() => decrypt(`v1:${raw.toString("base64")}`, [key])).toThrow();
    expect(() => decrypt(payload.replace(/^v1:/, "v2:"), [key])).toThrow(/no key/);
    expect(() => decrypt("garbage", [key])).toThrow(/malformed/);
  });
  test("only the full 16-byte GCM tag is accepted", () => {
    // A ciphertext made with a 4-byte tag, laid out as iv | tag | ciphertext.
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key.key, iv, { authTagLength: 4 });
    const body = Buffer.concat([cipher.update(Buffer.from("a forged totp secret")), cipher.final()]);
    const shortTag = Buffer.concat([iv, cipher.getAuthTag(), body]);
    expect(() => decrypt(`v1:${shortTag.toString("base64")}`, [key])).toThrow();
    // Too short to hold an IV, a full tag and at least one byte of ciphertext.
    expect(() => decrypt(`v1:${Buffer.alloc(28).toString("base64")}`, [key])).toThrow(/malformed/);
  });
  test("session tokens carry the kb1_ prefix and are stored as their sha256", () => {
    const { token, id } = newSessionToken();
    expect(token.startsWith(SESSION_TOKEN_PREFIX)).toBe(true);
    expect(token).toHaveLength(47);
    expect(id).toBe(sha256Hex(token));
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });
});
