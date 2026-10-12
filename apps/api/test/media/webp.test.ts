import { describe, expect, test } from "vitest";
import { WEBP_HEADER_BYTES, webpSize } from "../../src/media/webp";
import { webpBytes, type WebpKind } from "./webp-bytes";

/**
 * The header check behind the one function that opens an image file for staff (3c design, section 7.3, gate V): the
 * store is written by the worker, which runs the decoder, so a file is given to the console only when its first 30 bytes
 * say that it is a WebP and how large. The check reads bytes; it decodes nothing.
 */
describe("the size a WebP file's header states", () => {
  const head = (kind: WebpKind, width: number, height: number) => webpBytes(kind, width, height).subarray(0, WEBP_HEADER_BYTES);

  test("the header is 30 bytes: the container, the first chunk's name and its size fields in each of the three forms", () => {
    expect(WEBP_HEADER_BYTES).toBe(30);
    for (const kind of ["VP8 ", "VP8L", "VP8X"] as const) expect(webpBytes(kind, 4, 3, "").length, kind).toBe(30);
  });

  test.each(["VP8 ", "VP8L", "VP8X"] as const)("a %s file states its width and height", (kind) => {
    expect(webpSize(head(kind, 2048, 1536))).toEqual({ width: 2048, height: 1536 });
    expect(webpSize(head(kind, 1, 1))).toEqual({ width: 1, height: 1 });
    expect(webpSize(head(kind, 683, 1024))).toEqual({ width: 683, height: 1024 });
    // The whole file gives the same answer as its header: only the first 30 bytes are read.
    expect(webpSize(webpBytes(kind, 800, 600))).toEqual({ width: 800, height: 600 });
  });

  test("the extended form holds sizes beyond what the other two can state", () => {
    expect(webpSize(head("VP8X", 16_383, 16_383))).toEqual({ width: 16_383, height: 16_383 });
    expect(webpSize(head("VP8X", 70_000, 3))).toEqual({ width: 70_000, height: 3 });
  });

  test("fewer than 30 bytes state nothing", () => {
    const whole = head("VP8X", 800, 600);
    for (const length of [0, 4, 12, 16, 29]) expect(webpSize(whole.subarray(0, length)), String(length)).toBeNull();
  });

  test("a file that is not a RIFF container named WEBP states nothing", () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 0x20)]);
    const text = Buffer.from("large-webp-of-3f2a9c1e-8b7d-4e6f-a5c4-0123456789ab and more text", "ascii");
    const wave = Buffer.from(head("VP8X", 800, 600));
    wave.write("WAVE", 8, "ascii");
    const riff = Buffer.from(head("VP8X", 800, 600));
    riff.write("RIFX", 0, "ascii");
    for (const bytes of [jpeg, text, wave, riff, Buffer.alloc(30)]) expect(webpSize(bytes)).toBeNull();
  });

  test("a first chunk that is none of the three states nothing", () => {
    for (const name of ["ALPH", "ANIM", "VP8Y", "vp8x", "VP8_"]) {
      const bytes = Buffer.from(head("VP8X", 800, 600));
      bytes.write(name, 12, "ascii");
      expect(webpSize(bytes), name).toBeNull();
    }
  });

  test("a lossy chunk without a key frame's start code, and a lossless one without its signature or of another version, state nothing", () => {
    const noStartCode = Buffer.from(head("VP8 ", 800, 600));
    noStartCode[23] = 0x00;
    expect(webpSize(noStartCode)).toBeNull();
    // The lowest bit of the frame tag is clear in a key frame, the only frame that states a size.
    const interFrame = Buffer.from(head("VP8 ", 800, 600));
    interFrame[20] = interFrame[20]! | 0x01;
    expect(webpSize(interFrame)).toBeNull();
    const noSignature = Buffer.from(head("VP8L", 800, 600));
    noSignature[20] = 0x2e;
    expect(webpSize(noSignature)).toBeNull();
    const otherVersion = Buffer.from(head("VP8L", 800, 600));
    otherVersion[24] = otherVersion[24]! | 0x20;
    expect(webpSize(otherVersion)).toBeNull();
  });

  test("a lossy frame's scaling bits are not part of its size", () => {
    const scaled = Buffer.from(head("VP8 ", 800, 600));
    scaled[27] = scaled[27]! | 0xc0;
    scaled[29] = scaled[29]! | 0x40;
    expect(webpSize(scaled)).toEqual({ width: 800, height: 600 });
  });
});
