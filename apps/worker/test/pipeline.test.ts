import { afterAll, beforeAll, describe, expect, test } from "vitest";
import sharp from "sharp";
import { MEDIA_FORMATS, R1_MARKER, R1_TEST_MODEL } from "@korbat/media-protocol";
import { configureDecoder, processImage, type Processed } from "../src/pipeline";
import { testScorer } from "../src/score";
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

describe("3d Task 6: the R1 scorer through the real pipeline (design, sections 5 and 12)", () => {
  /** An image of the given format, of one colour, with or without the marker's block in its top left corner. */
  async function withMarker(format: "png" | "jpeg" | "webp", width: number, height: number, marked: boolean): Promise<Buffer> {
    const base = sharp({ create: { width, height, channels: 3, background: { r: 30, g: 120, b: 60 } } });
    const block = await sharp({ create: { width: R1_MARKER.side, height: R1_MARKER.side, channels: 3, background: { r: R1_MARKER.red, g: R1_MARKER.green, b: R1_MARKER.blue } } }).png().toBuffer();
    const image = marked ? base.composite([{ input: block, left: 0, top: 0 }]) : base;
    return format === "png" ? image.png().toBuffer() : format === "jpeg" ? image.jpeg({ quality: 90 }).toBuffer() : image.webp({ quality: 90 }).toBuffer();
  }

  test("the marker survives the decode, the resize to the small size and the conversion to sRGB, as PNG, JPEG and WebP", async () => {
    for (const format of ["png", "jpeg", "webp"] as const) {
      // 1600 pixels wide: the small size halves it, so the marker's block reaches the scorer at half its side.
      const marked = ready(await processImage(ws.file(`marked.${format}`, await withMarker(format, 1600, 900, true)), MEDIA_FORMATS, testScorer));
      expect(marked.r1, format).toEqual({ model: R1_TEST_MODEL, score: 1 });
      const plain = ready(await processImage(ws.file(`plain.${format}`, await withMarker(format, 1600, 900, false)), MEDIA_FORMATS, testScorer));
      expect(plain.r1, format).toEqual({ model: R1_TEST_MODEL, score: 0 });
    }
  });

  test("without a scorer nothing is scored: the result carries no r1", async () => {
    const result = ready(await processImage(ws.file("unscored.png", await withMarker("png", 400, 300, true)), MEDIA_FORMATS));
    expect(result.r1).toBeUndefined();
  });

  test("a scorer is handed the small size's raw pixels and their shape, and nothing else", async () => {
    const seen: { length: number; width: number; height: number; channels: number }[] = [];
    const recording = { model: "recording", score: async (pixels: Uint8Array, width: number, height: number, channels: number) => (seen.push({ length: pixels.length, width, height, channels }), 0.25) };
    const result = ready(await processImage(ws.file("seen.png", await withMarker("png", 1600, 900, false)), MEDIA_FORMATS, recording));
    expect(result.r1).toEqual({ model: "recording", score: 0.25 });
    expect(seen).toEqual([{ length: 1024 * 576 * 3, width: 1024, height: 576, channels: 3 }]);
  });
});

describe("2d Task 3: an avatar's two squares (design, sections 7.1 and 7.4)", () => {
  type Crop = "start" | "centre" | "end";
  const avatar = async (name: string, data: Buffer, crop: Crop, scorer: Parameters<typeof processImage>[2] = null) => ready(await processImage(ws.file(name, data), MEDIA_FORMATS, scorer, { crop }));
  const size = async (data: Buffer) => {
    const meta = await sharp(data).metadata();
    return [meta.width, meta.height];
  };

  test("each crop takes its square along the longer side, on a landscape and a portrait source: start, centre (rounded down) and end", async () => {
    for (const [name, width, height] of [["landscape", 300, 200], ["portrait", 200, 300]] as const) {
      const source = await make.banded(width, height).png().toBuffer();
      const bands: string[] = [];
      for (const crop of ["start", "centre", "end"] as const) {
        const result = await avatar(`${name}-${crop}.png`, source, crop);
        // The square's side is the shorter side, 200, under the large square's 400: never enlarged.
        expect([result.width, result.height], `${name} ${crop}`).toEqual([200, 200]);
        expect(await size(result.large), `${name} ${crop}`).toEqual([200, 200]);
        expect(await size(result.small), `${name} ${crop}`).toEqual([128, 128]);
        expect(await make.centreBand(result.small), `${name} ${crop} small`).toBe(await make.centreBand(result.large));
        bands.push(await make.centreBand(result.large));
      }
      expect(bands, name).toEqual(["red", "green", "blue"]);
    }
  });

  test("a large source becomes a 400 square and a 128 square, and the result reports the large one", async () => {
    const result = await avatar("big.jpg", await make.jpeg(1200, 900), "centre");
    expect([result.width, result.height]).toEqual([400, 400]);
    expect(await size(result.large)).toEqual([400, 400]);
    expect(await size(result.small)).toEqual([128, 128]);
    for (const data of [result.large, result.small]) expect(data.subarray(8, 12).toString("latin1")).toBe("WEBP");
    expect(result.blurhash.length).toBeGreaterThanOrEqual(6);
  });

  test("a source smaller than both squares is never enlarged: both files are its shorter side's square", async () => {
    const result = await avatar("small.png", await make.png(90, 60), "end");
    expect([result.width, result.height]).toEqual([60, 60]);
    expect(await size(result.large)).toEqual([60, 60]);
    expect(await size(result.small)).toEqual([60, 60]);
  });

  test("the EXIF rotation is applied before the crop: the start of an image stored sideways is the top of the image as shown", async () => {
    // Stored 300 by 200, red on the left and blue on the right, with orientation 8: shown turned a quarter anticlockwise,
    // 200 by 300, with the stored right edge (blue) on top. A crop along the stored width would start in red.
    const sideways = await make.banded(300, 200).jpeg({ quality: 95 }).withMetadata({ orientation: 8 }).toBuffer();
    expect((await sharp(sideways).metadata()).orientation).toBe(8);
    const start = await avatar("sideways-start.jpg", sideways, "start");
    expect([start.width, start.height]).toEqual([200, 200]);
    expect(await make.centreBand(start.large)).toBe("blue");
    expect(await make.centreBand((await avatar("sideways-end.jpg", sideways, "end")).large)).toBe("red");
  });

  test("both squares are fresh encodes: nothing of the source's EXIF, GPS, ICC or XMP survives", async () => {
    const original = await make.photoWithMetadata();
    expect(original.includes(make.SECRET)).toBe(true);
    const result = await avatar("private.jpg", original, "centre");
    for (const data of [result.large, result.small]) {
      const meta = await sharp(data).metadata();
      expect([meta.exif, meta.icc, meta.xmp, meta.iptc, meta.orientation]).toEqual([undefined, undefined, undefined, undefined, undefined]);
      expect(data.includes(make.SECRET)).toBe(false);
      expect(data.includes("GPS")).toBe(false);
    }
  });

  test("a scorer is handed the 400 square's raw pixels and their shape, as a post's image hands it its small size's", async () => {
    const seen: { length: number; width: number; height: number; channels: number }[] = [];
    const recording = { model: "recording", score: async (pixels: Uint8Array, width: number, height: number, channels: number) => (seen.push({ length: pixels.length, width, height, channels }), 0.75) };
    const result = await avatar("scored.png", await make.banded(1600, 900).png().toBuffer(), "centre", recording);
    expect(result.r1).toEqual({ model: "recording", score: 0.75 });
    expect(seen).toEqual([{ length: 400 * 400 * 3, width: 400, height: 400, channels: 3 }]);
  });

  test("an avatar's refusals are a post's: the format, the animation and the pixel caps are checked first", async () => {
    expect(await processImage(ws.file("avatar.svg", make.svg()), MEDIA_FORMATS, null, { crop: "centre" })).toEqual({ ok: false, reason: "unsupported_format" });
    expect(await processImage(ws.file("avatar-anim.gif", await make.animatedGif()), MEDIA_FORMATS, null, { crop: "centre" })).toEqual({ ok: false, reason: "animated_not_supported" });
    expect(await processImage(ws.file("avatar-huge.png", await make.png(8500, 6000)), MEDIA_FORMATS, null, { crop: "centre" })).toEqual({ ok: false, reason: "image_too_large" });
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
