import { describe, expect, test } from "vitest";
import { base32Encode } from "../../src/auth/base32";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("base32", () => {
  test("matches the RFC 4648 section 10 test vectors (lowercase, no padding)", () => {
    expect(base32Encode(bytes(""))).toBe("");
    expect(base32Encode(bytes("f"))).toBe("my");
    expect(base32Encode(bytes("fo"))).toBe("mzxq");
    expect(base32Encode(bytes("foo"))).toBe("mzxw6");
    expect(base32Encode(bytes("foob"))).toBe("mzxw6yq");
    expect(base32Encode(bytes("fooba"))).toBe("mzxw6ytb");
    expect(base32Encode(bytes("foobar"))).toBe("mzxw6ytboi");
  });
  test("20 bytes encode to 32 characters from the base32 alphabet", () => {
    const out = base32Encode(new Uint8Array(20).fill(255));
    expect(out).toHaveLength(32);
    expect(out).toMatch(/^[a-z2-7]+$/);
  });
});
