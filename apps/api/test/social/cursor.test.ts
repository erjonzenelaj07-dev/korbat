import { describe, expect, test } from "vitest";
import { SocialError } from "../../src/social/context";
import { MAX_CURSOR_TIME, MAX_GENERATION, decodeCursor, decodeExploreCursor, encodeCursor, encodeExploreCursor } from "../../src/social/cursor";

const id = "00000000-0000-4000-8000-000000000001";
const reposter = "00000000-0000-4000-8000-000000000002";

/** Any value as a client could send it: base64url of its JSON. */
const raw = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

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
  test("a time beyond what a date can hold is invalid_request, never a crash", () => {
    const raw = Buffer.from(JSON.stringify({ t: 9_000_000_000_000_000, id })).toString("base64url");
    expect(() => decodeCursor(raw)).toThrow(/cursor/);
    expect(decodeCursor(encodeCursor({ t: MAX_CURSOR_TIME, id })).t).toBe(MAX_CURSOR_TIME);
  });
  test("extra fields are rejected, so clients cannot smuggle filters through the cursor", () => {
    const raw = Buffer.from(JSON.stringify({ t: 5, id, viewer: "someone-else" })).toString("base64url");
    expect(() => decodeCursor(raw)).toThrow(SocialError);
  });
});

describe("Explore cursors", () => {
  test("round-trip a ranking and the last post read, as base64url of exactly those two in JSON", () => {
    expect(decodeExploreCursor(encodeExploreCursor({ g: 42, id }))).toEqual({ g: 42, id });
    const encoded = encodeExploreCursor({ g: 7, id });
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    // The post read last, never a position: the order is all a reader learns.
    expect(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))).toEqual({ g: 7, id });
  });

  test("the generation runs from 1 to the largest value of the integer column that numbers the rankings", () => {
    expect(MAX_GENERATION).toBe(2_147_483_647);
    expect(decodeExploreCursor(raw({ g: 1, id }))).toEqual({ g: 1, id });
    expect(decodeExploreCursor(raw({ g: MAX_GENERATION, id }))).toEqual({ g: MAX_GENERATION, id });
    // Out of range, not an integer, or not a number: a forged value is a 400, never a query that overflows.
    for (const g of [0, -1, MAX_GENERATION + 1, 2 ** 53, 1.5, "1", null, true, [1], { g: 1 }]) {
      expect(() => decodeExploreCursor(raw({ g, id })), JSON.stringify(g)).toThrow(SocialError);
    }
  });

  test("a missing or extra field, an id that is not a uuid, and anything that is not a cursor are invalid_request, 400", () => {
    const refusals: [string, unknown][] = [
      ["no generation", { id }],
      ["no post", { g: 1 }],
      ["a position smuggled in", { g: 1, id, position: 3 }],
      ["a time smuggled in", { g: 1, id, t: 5 }],
      ["an id that is not a uuid", { g: 1, id: "not-a-uuid" }],
      ["an array", [1, id]],
      ["null", null],
      ["a string", "g1"],
    ];
    for (const [what, value] of refusals) {
      const err = (() => {
        try {
          decodeExploreCursor(raw(value));
        } catch (caught) {
          return caught;
        }
        return null;
      })();
      expect(err, what).toBeInstanceOf(SocialError);
      expect(err, what).toMatchObject({ code: "invalid_request", status: 400, message: "That page cursor is not valid." });
    }
    for (const text of ["", "not-base64!", Buffer.from("{").toString("base64url")]) {
      expect(() => decodeExploreCursor(text), text).toThrow(/cursor is not valid/);
    }
  });

  test("the two cursors are not interchangeable: each decoder refuses the other's", () => {
    expect(() => decodeExploreCursor(encodeCursor({ t: 5, id }))).toThrow(SocialError);
    expect(() => decodeCursor(encodeExploreCursor({ g: 5, id }))).toThrow(SocialError);
  });
});
