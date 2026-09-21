import { describe, expect, test } from "vitest";
import { SNIFF_BYTES, isAnimatedPng, sniffImage, type ByteReader } from "../src/index";

/** Builds a byte array from strings (one byte per character) and numbers. */
function bytes(...parts: (string | number | number[])[]): Uint8Array {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === "string") for (const ch of part) out.push(ch.charCodeAt(0));
    else if (typeof part === "number") out.push(part);
    else out.push(...part);
  }
  return Uint8Array.from(out);
}
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const ftyp = (major: string, ...compatible: string[]) => bytes(be32(16 + 4 * compatible.length), "ftyp", major, be32(0), ...compatible);
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe("sniffing the first bytes", () => {
  test("the five accepted formats", () => {
    expect(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0, "JFIF"))).toEqual({ kind: "image", format: "jpeg" });
    expect(sniffImage(bytes(PNG, be32(13), "IHDR"))).toEqual({ kind: "image", format: "png" });
    expect(sniffImage(bytes("GIF89a", 1, 0, 1, 0))).toEqual({ kind: "image", format: "gif" });
    expect(sniffImage(bytes("GIF87a", 1, 0, 1, 0))).toEqual({ kind: "image", format: "gif" });
    expect(sniffImage(bytes("RIFF", be32(100), "WEBP", "VP8 ", be32(90)))).toEqual({ kind: "image", format: "webp" });
    expect(sniffImage(bytes("RIFF", be32(100), "WEBP", "VP8X", be32(10), 0x10, 0, 0, 0))).toEqual({ kind: "image", format: "webp" });
    expect(sniffImage(ftyp("avif", "avif", "mif1", "miaf", "MA1B"))).toEqual({ kind: "image", format: "avif" });
    expect(sniffImage(ftyp("mif1", "mif1", "avif", "miaf"))).toEqual({ kind: "image", format: "avif" });
  });

  test("HEIC and other HEIF flavours are named, so the interface can say what to do", () => {
    for (const brand of ["heic", "heix", "hevc", "mif1", "msf1"]) expect(sniffImage(ftyp(brand, brand))).toEqual({ kind: "heic" });
    expect(sniffImage(ftyp("heic", "mif1", "heic"))).toEqual({ kind: "heic" });
  });

  test("animation that the header declares is refused before any decoder runs", () => {
    expect(sniffImage(bytes("RIFF", be32(100), "WEBP", "VP8X", be32(10), 0x02, 0, 0, 0))).toEqual({ kind: "animated" });
    expect(sniffImage(bytes("RIFF", be32(100), "WEBP", "VP8X", be32(10), 0x12, 0, 0, 0))).toEqual({ kind: "animated" });
    expect(sniffImage(ftyp("avis", "avis", "msf1", "miaf"))).toEqual({ kind: "animated" });
    expect(sniffImage(ftyp("avif", "avif", "avis", "msf1"))).toEqual({ kind: "animated" });
  });

  test("everything else is unknown: SVG, TIFF, PDF, ZIP, BMP, MP4, text, and nothing at all", () => {
    const others = [
      bytes('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'),
      bytes("<svg xmlns='http://www.w3.org/2000/svg'/>"),
      bytes("II", 42, 0, be32(8)),
      bytes("MM", 0, 42, be32(8)),
      bytes("%PDF-1.7"),
      bytes("PK", 3, 4, 20, 0),
      bytes("BM", be32(0), be32(0)),
      ftyp("isom", "isom", "mp42"),
      bytes("hello, this is text"),
      bytes(),
      bytes(0xff, 0xd8),
      bytes("RIFF", be32(100), "WAVE", "fmt "),
    ];
    for (const head of others) expect(sniffImage(head)).toEqual({ kind: "unknown" });
  });

  test("a brand list is read only as far as its box and the buffer go", () => {
    const lying = bytes(be32(4096), "ftyp", "isom", be32(0), "mp42");
    expect(sniffImage(lying)).toEqual({ kind: "unknown" });
    const tiny = bytes(be32(8), "ftyp", "avif", be32(0));
    expect(sniffImage(tiny)).toEqual({ kind: "image", format: "avif" });
    expect(SNIFF_BYTES).toBe(256);
  });
});

describe("animated PNG", () => {
  const chunk = (type: string, length: number) => bytes(be32(length), type, new Array<number>(length).fill(0), be32(0));
  const reader = (file: Uint8Array): ByteReader => (offset, length) => file.subarray(offset, offset + length);
  const join = (...parts: Uint8Array[]) => bytes(...parts.map((part) => [...part]));

  test("an acTL chunk before the first IDAT means animation", () => {
    expect(isAnimatedPng(reader(join(bytes(PNG), chunk("IHDR", 13), chunk("acTL", 8), chunk("IDAT", 20), chunk("IEND", 0))))).toBe(true);
    expect(isAnimatedPng(reader(join(bytes(PNG), chunk("IHDR", 13), chunk("iCCP", 300), chunk("acTL", 8), chunk("IDAT", 20))))).toBe(true);
  });

  test("an ordinary PNG, and an acTL after the image data, are not", () => {
    expect(isAnimatedPng(reader(join(bytes(PNG), chunk("IHDR", 13), chunk("IDAT", 20), chunk("IEND", 0))))).toBe(false);
    expect(isAnimatedPng(reader(join(bytes(PNG), chunk("IHDR", 13), chunk("IDAT", 20), chunk("acTL", 8), chunk("IEND", 0))))).toBe(false);
  });

  test("a truncated file or a chunk length that points past the end stops the walk", () => {
    expect(isAnimatedPng(reader(join(bytes(PNG), chunk("IHDR", 13)).subarray(0, 20)))).toBe(false);
    expect(isAnimatedPng(reader(join(bytes(PNG), bytes(be32(0xffffffff), "IHDR"))))).toBe(false);
    expect(isAnimatedPng(reader(bytes(PNG)))).toBe(false);
  });

  test("only chunk headers are read, never chunk data", () => {
    const file = join(bytes(PNG), chunk("IHDR", 13), chunk("iCCP", 5000), chunk("IDAT", 20));
    const reads: number[] = [];
    isAnimatedPng((offset, length) => {
      reads.push(length);
      return file.subarray(offset, offset + length);
    });
    expect(reads).toEqual([8, 8, 8]);
  });
});
