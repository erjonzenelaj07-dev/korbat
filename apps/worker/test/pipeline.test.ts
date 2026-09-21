import { afterAll, beforeAll, describe, expect, test } from "vitest";
import sharp from "sharp";
import { MEDIA_FORMATS } from "@korbat/media-protocol";
import { configureDecoder, processImage, type Processed } from "../src/pipeline";
import * as make from "./fixtures";

const ws = make.workspace();
const run = async (name: string, data: Buffer): Promise<Processed> => processImage(ws.file(name, data), MEDIA_FORMATS);
const ready = (result: Processed) => {
  if (!result.ok) throw new Error(`expected a processed image, got ${result.reason}`);
  return result;
};

beforeAll(() => configureDecoder(MEDIA_FORMATS));
afterAll(() => ws.remove());

describe("the decoder allowlist", () => {
  test("every enabled format decodes, so no loader class name is misspelled", async () => {
    for (const [name, data] of Object.entries({ jpeg: await make.jpeg(), png: await make.png(), webp: await make.webp(), gif: await make.gif(), avif: await make.avif() })) {
      expect((await sharp(data).metadata()).width, name).toBe(400);
    }
  });

  test("the decoder itself refuses SVG and TIFF, which the prebuilt binary could otherwise read", async () => {
    await expect(sharp(make.svg()).metadata()).rejects.toThrow(/unsupported image format/);
    await expect(sharp(await make.tiff()).metadata()).rejects.toThrow(/unsupported image format/);
  });
});

describe("accepted images", () => {
  test.each(["jpeg", "png", "webp", "gif", "avif"] as const)("%s becomes two WebP files and a blurhash, never enlarged", async (format) => {
    const result = ready(await run(`in.${format}`, await make[format]()));
    expect([result.width, result.height]).toEqual([400, 200]);
    expect(result.blurhash).toMatch(/^[0-9A-Za-z#$%*+,\-.:;=?@[\]^_{|}~]{6,}$/);
    for (const data of [result.large, result.small]) {
      expect(data.subarray(0, 4).toString("latin1")).toBe("RIFF");
      expect(data.subarray(8, 12).toString("latin1")).toBe("WEBP");
      expect(await sharp(data).metadata()).toMatchObject({ format: "webp", width: 400, height: 200 });
    }
  });

  test("a large image is reduced to 2048 and 1024 on its longer side, and the result reports the large size", async () => {
    const result = ready(await run("big.jpg", await make.jpeg(3000, 1500)));
    expect([result.width, result.height]).toEqual([2048, 1024]);
    expect(await sharp(result.large).metadata()).toMatchObject({ width: 2048, height: 1024 });
    expect(await sharp(result.small).metadata()).toMatchObject({ width: 1024, height: 512 });
  });

  test("transparency survives", async () => {
    const result = ready(await run("alpha.png", await make.png()));
    expect((await sharp(result.large).metadata()).hasAlpha).toBe(true);
  });

  test("the EXIF rotation is applied, and nothing of the original's metadata survives", async () => {
    const original = await make.photoWithMetadata();
    const before = await sharp(original).metadata();
    expect(before.orientation).toBe(6);
    expect(original.includes(make.SECRET)).toBe(true);
    expect(before.icc).toBeDefined();

    const result = ready(await run("sideways.jpg", original));
    expect([result.width, result.height]).toEqual([200, 400]);
    for (const data of [result.large, result.small]) {
      const meta = await sharp(data).metadata();
      expect([meta.exif, meta.icc, meta.xmp, meta.iptc, meta.orientation]).toEqual([undefined, undefined, undefined, undefined, undefined]);
      expect(data.includes(make.SECRET)).toBe(false);
      expect(data.includes("GPS")).toBe(false);
    }
  });

  test("bytes appended to an image do not reach the output", async () => {
    const marker = "PK\u0003\u0004 hidden-archive-payload";
    const result = ready(await run("polyglot.jpg", Buffer.concat([await make.jpeg(), Buffer.from(marker, "latin1")])));
    expect(result.large.includes("hidden-archive-payload")).toBe(false);
    expect(result.small.includes("hidden-archive-payload")).toBe(false);
  });
});

describe("refused files", () => {
  test("anything that is not an enabled image format is refused by its first bytes", async () => {
    expect(await run("drawing.svg", make.svg())).toEqual({ ok: false, reason: "unsupported_format" });
    expect(await run("scan.tiff", await make.tiff())).toEqual({ ok: false, reason: "unsupported_format" });
    expect(await run("photo.heic", make.heicHeader())).toEqual({ ok: false, reason: "unsupported_format" });
    expect(await run("notes.txt", Buffer.from("just text"))).toEqual({ ok: false, reason: "unsupported_format" });
    expect(await run("empty", Buffer.alloc(0))).toEqual({ ok: false, reason: "unsupported_format" });
  });

  test("animation is refused: GIF by its page count, WebP by its header, PNG by its acTL chunk", async () => {
    expect(await run("anim.gif", await make.animatedGif())).toEqual({ ok: false, reason: "animated_not_supported" });
    expect(await run("anim.webp", await make.animatedWebp())).toEqual({ ok: false, reason: "animated_not_supported" });
    expect(await run("anim.png", await make.animatedPng())).toEqual({ ok: false, reason: "animated_not_supported" });
  });

  test("a truncated file and a file that only starts like an image are corrupt", async () => {
    const whole = await sharp({ create: { width: 800, height: 800, channels: 3, background: "#336699", noise: { type: "gaussian", mean: 128, sigma: 50 } } }).jpeg().toBuffer();
    expect(await run("cut.jpg", whole.subarray(0, Math.floor(whole.length * 0.6)))).toEqual({ ok: false, reason: "corrupt_image" });
    expect(await run("fake.png", Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("not really a png")]))).toEqual({ ok: false, reason: "corrupt_image" });
  });

  test("the pixel caps hold: 51 megapixels of PNG, 17 of AVIF, and a side of 16,384", async () => {
    expect(await run("huge.png", await make.png(8500, 6000))).toEqual({ ok: false, reason: "image_too_large" });
    expect(await run("huge.avif", await make.avif(4250, 4000))).toEqual({ ok: false, reason: "image_too_large" });
    expect(await run("wide.png", await make.png(16_384, 4))).toEqual({ ok: false, reason: "image_too_large" });
  });

  test("an AVIF of 12 megapixels and a 16,383 pixel panorama are fine", async () => {
    expect(ready(await run("ok.avif", await make.avif(4000, 3000))).width).toBe(2048);
    expect(ready(await run("panorama.png", await make.png(16_383, 40))).width).toBe(2048);
  });

  test("a missing file is an error, not a verdict about the image", async () => {
    await expect(processImage(`${ws.dir}/absent.jpg`, MEDIA_FORMATS)).rejects.toThrow();
  });
});
