import { describe, expect, test } from "vitest";
import { currentStep, hotp, newTotpSecret, totpQrSvg, totpUri, verifyTotp } from "../../src/auth/totp";

// RFC 4226 appendix D and RFC 6238 appendix B both use the ASCII secret "12345678901234567890".
// A 6-digit TOTP is the last 6 digits of the published 8-digit value.
const rfcSecret = new TextEncoder().encode("12345678901234567890");
const t = 1_111_111_109_000; // RFC 6238 published value 07081804

describe("hotp", () => {
  test("matches the RFC 4226 test vectors for counters 0 to 9", () => {
    const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
    expected.forEach((value, counter) => expect(hotp(rfcSecret, counter), `counter ${counter}`).toBe(value));
  });
});

describe("totp", () => {
  test("matches the RFC 6238 test vectors", () => {
    expect(verifyTotp(rfcSecret, "287082", null, 59_000)).toBe(1);
    expect(verifyTotp(rfcSecret, "081804", null, t)).toBe(currentStep(t));
  });
  test("accepts one step either side and nothing further", () => {
    expect(verifyTotp(rfcSecret, "081804", null, t + 30_000)).toBe(currentStep(t));
    expect(verifyTotp(rfcSecret, "081804", null, t - 30_000)).toBe(currentStep(t));
    expect(verifyTotp(rfcSecret, "081804", null, t + 60_000)).toBeNull();
  });
  test("a code for a step at or before the last accepted step is rejected", () => {
    const step = currentStep(t);
    expect(verifyTotp(rfcSecret, "081804", step, t)).toBeNull();
    expect(verifyTotp(rfcSecret, "081804", step - 1, t)).toBe(step);
  });
  test("malformed codes are rejected", () => {
    expect(verifyTotp(rfcSecret, "08180", null, t)).toBeNull();
    expect(verifyTotp(rfcSecret, "abcdef", null, t)).toBeNull();
  });
  test("new secrets are 20 bytes and render an otpauth URI and an SVG QR code", () => {
    const secret = newTotpSecret();
    expect(secret).toHaveLength(20);
    const uri = totpUri(secret, "ada");
    expect(uri).toMatch(/^otpauth:\/\/totp\/korbat:ada\?secret=[A-Z2-7]{32}&/);
    expect(uri).toContain("issuer=korbat");
    expect(uri).toContain("algorithm=SHA1");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
    expect(totpQrSvg(uri).startsWith("<svg")).toBe(true);
  });
});
