import { describe, expect, test } from "vitest";
import { CHAIN_ZERO_HASH, canonicalText, chainHash } from "../../src/staff/chain";
import { CHAIN_VECTORS } from "./chain-vectors";

describe("the audit chain's canonical text, version 1", () => {
  test("the vectors cover what the design lists, and form a chain from 64 zeros", () => {
    expect(CHAIN_VECTORS.map((v) => v.name)).toEqual([
      "grant-role's row, every optional column null",
      "empty strings",
      "quotes and backslashes",
      "control characters",
      "non-ASCII text",
      "nested metadata",
      "a step-up",
    ]);
    expect(CHAIN_ZERO_HASH).toBe("0".repeat(64));
    expect(CHAIN_VECTORS[0]!.prevHash).toBe(CHAIN_ZERO_HASH);
    for (let i = 1; i < CHAIN_VECTORS.length; i++) expect(CHAIN_VECTORS[i]!.prevHash).toBe(CHAIN_VECTORS[i - 1]!.hash);
  });

  for (const vector of CHAIN_VECTORS) {
    test(`${vector.name}: the text and the hash`, () => {
      expect(canonicalText(vector.row)).toBe(vector.canonical);
      expect(chainHash(vector.prevHash, vector.canonical)).toBe(vector.hash);
    });
  }

  test("the stored jsonb is embedded as PostgreSQL printed it, never re-serialised", () => {
    const row = { ...CHAIN_VECTORS[0]!.row, metadataText: '{"b":1,  "a" : 2}', stepUpText: '{ "x": [ ] }' };
    expect(canonicalText(row)).toBe(
      '[1,1,1,"2026-09-30T08:15:42.007Z","00000000-0000-0000-0000-000000000000","role_granted","user","3f2a9c1e-8b7d-4e6f-a5c4-0123456789ab",null,null,null,null,{ "x": [ ] },{"b":1,  "a" : 2}]',
    );
  });

  test("the time is written in UTC to the millisecond", () => {
    const row = { ...CHAIN_VECTORS[0]!.row, createdAt: new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 6)) };
    expect(canonicalText(row)).toContain(',"2026-01-02T03:04:05.006Z",');
  });

  test("the hash is taken over the UTF-8 bytes of prev_hash followed by the text", () => {
    // e-acute is two bytes in UTF-8 (the digest below, computed by Python's hashlib) and one in Latin-1 (de2e33...).
    expect(chainHash("", String.fromCharCode(0xe9))).toBe("4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c");
    expect(chainHash("ab", "cd")).toBe(chainHash("", "abcd"));
    expect(chainHash("", "")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  test("a version it does not know is refused, never hashed as version 1", () => {
    const row = CHAIN_VECTORS[0]!.row;
    expect(() => canonicalText({ ...row, chainVersion: 2 })).toThrow("audit chain version 2 is not known");
    expect(() => canonicalText({ ...row, chainVersion: 0 })).toThrow("audit chain version 0 is not known");
  });
});
