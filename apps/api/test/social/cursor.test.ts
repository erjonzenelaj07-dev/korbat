import { describe, expect, test } from "vitest";
import { SocialError } from "../../src/social/context";
import { decodeCursor, encodeCursor } from "../../src/social/cursor";

const id = "00000000-0000-4000-8000-000000000001";
const reposter = "00000000-0000-4000-8000-000000000002";

describe("cursors", () => {
  test("round-trip with and without a reposter", () => {
    expect(decodeCursor(encodeCursor({ t: 1_789_000_000_123, id }))).toEqual({ t: 1_789_000_000_123, id });
    expect(decodeCursor(encodeCursor({ t: 5, id, r: reposter }))).toEqual({ t: 5, id, r: reposter });
    expect(encodeCursor({ t: 5, id })).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  test("anything that is not a cursor is invalid_request", () => {
    for (const raw of ["", "not-base64!", Buffer.from("[1,2]").toString("base64url"), Buffer.from('{"t":-1,"id":"x"}').toString("base64url")]) {
      expect(() => decodeCursor(raw), raw).toThrow(SocialError);
      expect(() => decodeCursor(raw), raw).toThrow(/cursor/);
    }
  });
  test("extra fields are rejected, so clients cannot smuggle filters through the cursor", () => {
    const raw = Buffer.from(JSON.stringify({ t: 5, id, viewer: "someone-else" })).toString("base64url");
    expect(() => decodeCursor(raw)).toThrow(SocialError);
  });
});
