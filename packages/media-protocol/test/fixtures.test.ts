import { createHash } from "node:crypto";
import { inflateSync, crc32 } from "node:zlib";
import { describe, expect, test } from "vitest";
import { MATCH_FIXTURES } from "../src/index";

/**
 * The test matcher's two files (3d design, sections 5 and 12; Task 7): PNG files written out as byte constants. They are
 * well-formed (every chunk's CRC-32 and the stored block's Adler-32 hold), 8 by 8 pixels of one flat colour each, and
 * their digests are fixed, so the test matcher answers the same on every machine. A digest taken here with node:crypto
 * is the one the matcher computes when it is built.
 */
describe("the matcher's fixtures", () => {
  /** The chunks of a PNG file: type and data, each with its CRC checked. */
  function chunks(bytes: Uint8Array): { type: string; data: Buffer }[] {
    const buffer = Buffer.from(bytes);
    expect(buffer.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    const found: { type: string; data: Buffer }[] = [];
    for (let at = 8; at < buffer.length; ) {
      const length = buffer.readUInt32BE(at);
      const type = buffer.subarray(at + 4, at + 8).toString("latin1");
      const data = buffer.subarray(at + 8, at + 8 + length);
      expect(buffer.readUInt32BE(at + 8 + length), `${type} CRC`).toBe(crc32(buffer.subarray(at + 4, at + 8 + length)));
      found.push({ type, data });
      at += 12 + length;
    }
    return found;
  }

  test("each is a well-formed PNG of 8 by 8 RGB pixels of one flat colour, with no other chunk", () => {
    for (const [name, bytes] of Object.entries(MATCH_FIXTURES)) {
      const parts = chunks(bytes);
      expect(parts.map((part) => part.type), name).toEqual(["IHDR", "IDAT", "IEND"]);
      const header = parts[0]!.data;
      expect([header.readUInt32BE(0), header.readUInt32BE(4), header[8], header[9]], name).toEqual([8, 8, 8, 2]);
      const rows = inflateSync(parts[1]!.data);
      expect(rows.length, name).toBe(8 * (1 + 8 * 3));
      // Every row is the filter byte 0 and the same pixel eight times.
      const first = rows.subarray(1, 4);
      for (let y = 0; y < 8; y++) {
        expect(rows[y * 25], name).toBe(0);
        for (let x = 0; x < 8; x++) expect(rows.subarray(y * 25 + 1 + x * 3, y * 25 + 4 + x * 3).equals(first), name).toBe(true);
      }
    }
    expect(Buffer.from(MATCH_FIXTURES.acting).equals(Buffer.from(MATCH_FIXTURES.flag))).toBe(false);
  });

  test("their digests are fixed: node:crypto's SHA-256 of the constants", () => {
    expect(createHash("sha256").update(MATCH_FIXTURES.acting).digest("hex")).toBe("4088e46614abf60d00aed74d6062e2a363f78f022c0565e231277fb13b9b93c1");
    expect(createHash("sha256").update(MATCH_FIXTURES.flag).digest("hex")).toBe("6bbd714bcb39592de7a51d0d87a84a861d8deda8a69cbb6d99bdc2dcb6bf073c");
  });
});
