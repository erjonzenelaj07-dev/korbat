import { describe, expect, test } from "vitest";
import { consumeRecoveryCode, hashRecoveryCode, newRecoveryCodes } from "../../src/auth/recovery-codes";

const key = Buffer.alloc(32, 9);

describe("recovery codes", () => {
  test("ten unique codes shaped xxxx-xxxx-xxxx in lowercase base32", () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[a-z2-7]{4}-[a-z2-7]{4}-[a-z2-7]{4}$/);
  });
  test("codes are stored as keyed hashes that ignore case", () => {
    const code = newRecoveryCodes()[0]!;
    expect(hashRecoveryCode(key, code)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRecoveryCode(key, code)).not.toBe(hashRecoveryCode(Buffer.alloc(32, 8), code));
    expect(hashRecoveryCode(key, code.toUpperCase())).toBe(hashRecoveryCode(key, code));
  });
  test("consuming a code removes exactly that code and it cannot be reused", () => {
    const codes = newRecoveryCodes();
    const hashes = codes.map((c) => hashRecoveryCode(key, c));
    const left = consumeRecoveryCode(key, hashes, codes[3]!);
    expect(left).toHaveLength(9);
    expect(consumeRecoveryCode(key, left!, codes[3]!)).toBeNull();
    expect(consumeRecoveryCode(key, hashes, "aaaa-aaaa-aaaa")).toBeNull();
  });
});
