import { afterAll, describe, expect, test } from "vitest";
import sharp from "sharp";
import { configureDecoder, processImage } from "../src/pipeline";
import * as make from "./fixtures";

// The decoder's block list is one per process, so the format switch has a test file of its own.
const ws = make.workspace();
afterAll(() => ws.remove());

describe("MEDIA_FORMATS switches formats off without a deploy", () => {
  test("a format that is not enabled is refused, and its decoder stays blocked", async () => {
    configureDecoder(["jpeg"]);
    expect(await processImage(ws.file("a.png", await make.png()), ["jpeg"])).toEqual({ ok: false, reason: "unsupported_format" });
    await expect(sharp(await make.png()).metadata()).rejects.toThrow(/unsupported image format/);
    expect((await processImage(ws.file("a.jpg", await make.jpeg()), ["jpeg"])).ok).toBe(true);
  });

  test("with the WebP decoder off, other formats still become WebP with a blurhash", async () => {
    const formats = ["jpeg", "png", "gif", "avif"] as const;
    configureDecoder(formats);
    await expect(sharp(await make.webp()).metadata()).rejects.toThrow(/unsupported image format/);
    expect(await processImage(ws.file("b.webp", await make.webp()), formats)).toEqual({ ok: false, reason: "unsupported_format" });
    const result = await processImage(ws.file("b.png", await make.png()), formats);
    expect(result).toMatchObject({ ok: true, width: 400, height: 200 });
    if (result.ok) {
      expect(result.small.subarray(8, 12).toString("latin1")).toBe("WEBP");
      expect(result.blurhash.length).toBeGreaterThanOrEqual(6);
    }
  });

  test("enabling a format again unblocks it", async () => {
    configureDecoder(["jpeg", "png", "webp", "gif", "avif"]);
    expect((await sharp(await make.webp()).metadata()).format).toBe("webp");
  });
});
