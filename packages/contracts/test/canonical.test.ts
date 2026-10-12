import { describe, expect, test } from "vitest";
import { hex, sha256, sha256Bytes, sortedJson, utf8 } from "../src/canonical";

// The canonical writer and the hash helpers moved out of staff.ts, which the step-up action's tests (staff.test.ts) still
// cover through stepUpActionText and stepUpActionHash. These hold the module's own exports, which moderation.ts uses too.
describe("the canonical JSON writer", () => {
  const BS = String.fromCharCode(92);

  test("sorts the keys of every object, keeps the order of arrays and writes no whitespace", () => {
    expect(sortedJson({ b: [3, { z: 1, a: null }, "x"], a: true, "": -1 })).toBe('{"":-1,"a":true,"b":[3,{"a":null,"z":1},"x"]}');
    expect(sortedJson([])).toBe("[]");
    expect(sortedJson({})).toBe("{}");
    expect(sortedJson(null)).toBe("null");
  });

  test("writes strings and numbers as JSON.stringify writes them", () => {
    const text = `q"${BS}${String.fromCharCode(10)}${String.fromCharCode(0xe9)}`;
    expect(sortedJson(text)).toBe(JSON.stringify(text));
    expect(sortedJson(0.5)).toBe("0.5");
    expect(sortedJson(-0)).toBe("0");
  });

  test("refuses what JSON cannot carry rather than dropping or changing it", () => {
    for (const value of [undefined, Number.NaN, Number.NEGATIVE_INFINITY, () => 1, BigInt(1), new Date(0), [undefined], { a: undefined }, new Map()]) {
      expect(() => sortedJson(value), String(typeof value)).toThrow(TypeError);
    }
  });
});

describe("the hash helpers", () => {
  test("utf8 gives a text's UTF-8 bytes", () => {
    expect(Array.from(utf8("a"))).toEqual([0x61]);
    // e with an acute accent is two bytes; a character outside the basic plane is four.
    expect(Array.from(utf8(String.fromCharCode(0xe9)))).toEqual([0xc3, 0xa9]);
    expect(Array.from(utf8(String.fromCodePoint(0x1f600)))).toEqual([0xf0, 0x9f, 0x98, 0x80]);
  });

  test("hex writes each byte as two lower-case digits", () => {
    expect(hex(new Uint8Array([0, 1, 0x0a, 0xab, 0xff]))).toBe("00010aabff");
    expect(hex(new Uint8Array())).toBe("");
  });

  test("sha256 hashes a text's UTF-8 bytes, and sha256Bytes the bytes it is given", async () => {
    const ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    expect(hex(await sha256("abc"))).toBe(ABC);
    expect(hex(await sha256Bytes(new Uint8Array([0x61, 0x62, 0x63])))).toBe(ABC);
    expect(await sha256("abc")).toHaveLength(32);
  });
});
