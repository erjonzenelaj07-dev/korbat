# korbat 2b — Task 6 of 17: The worker's image pipeline: sharp behind a decoder allowlist, WebP in two sizes, blurhash, and a reason for every refusal

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-18 and 2026-09-19 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

The worker turns an untrusted upload into two metadata-free WebP files and a blurhash. sharp 0.35.4 runs behind a loader allowlist (JPEG, PNG, WebP, GIF, HEIF for AVIF only), with `failOn: "error"` and the pixel cap enforced from the header before any pixel is decoded. The image is rotated by its EXIF orientation, resized without enlarging, and encoded fresh, so nothing of the original survives. Every refusal has a reason the author will see. The tests make their fixtures with sharp at run time.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. The `install` step runs with `--config.minimum-release-age=0` for that one command, and the `lockfile-age` step then proves that every newly locked version is at least 7 days old. `pnpm-lock.yaml` is written by the install, never by hand. Never edit `pnpm-workspace.yaml` or `.npmrc`, and never add a package this task does not name.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -2` shows `chore(deps): exclude three maintainer-published legacy releases from pnpm's trust policy` first and `feat(db): post_media gains owner, status, failure reason and creation time; checks for ready and attached rows; indexes for pending counts and the sweeper` second. The first commit is the trust-policy fix described under "Execution findings" in `00-README.md`.

## Rules (read twice)

1. Never type a file's content. Every step that writes files starts with a `write_blocks.py` command that copies that step's blocks from this prompt file to disk byte for byte; run it exactly as given and check that it names every file of the step. The blocks are shown below it so you can read what was written. Paths with parentheses or square brackets (expo-router routes) are literal; quote them in shell commands.
2. Run every command exactly as written, in order, from the repo root, without adding filters such as `tail` or `head`.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the tests

```bash
python docs/superpowers/prompts/images-2b/write_blocks.py docs/superpowers/prompts/images-2b/06-worker-pipeline.md 1
```

Expected: 6 lines starting with `wrote`, one for each file below.

### Create `apps/worker/test/fixtures.ts`

```ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32 } from "node:zlib";
import sharp from "sharp";

/** Images the tests make themselves, so the repository carries no binary fixtures. Encoders are never blocked; only loaders are. */

const flat = (width: number, height: number, channels: 3 | 4 = 3) =>
  sharp({ create: { width, height, channels, background: channels === 4 ? { r: 200, g: 30, b: 30, alpha: 0.5 } : { r: 200, g: 30, b: 30 } } });

export const SECRET = "secret-owner-of-this-photo";

/** A JPEG stored sideways (EXIF orientation 6), with a copyright string, GPS position and a Display P3 profile. */
export const photoWithMetadata = () =>
  flat(400, 200)
    .jpeg()
    .withExif({ IFD0: { Copyright: SECRET }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "0/1 7/1 0/1" } })
    .withIccProfile("p3")
    .withMetadata({ orientation: 6 })
    .toBuffer();

export const jpeg = (width = 400, height = 200) => flat(width, height).jpeg().toBuffer();
export const png = (width = 400, height = 200) => flat(width, height, 4).png().toBuffer();
export const webp = (width = 400, height = 200) => flat(width, height, 4).webp().toBuffer();
export const gif = (width = 400, height = 200) => flat(width, height).gif().toBuffer();
export const avif = (width = 400, height = 200) => flat(width, height).avif({ effort: 0 }).toBuffer();
export const tiff = () => flat(40, 20).tiff().toBuffer();
export const svg = () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');

/** Two 20 by 20 frames stacked in one strip, which is how libvips holds an animation. */
const strip = () => {
  const data = Buffer.alloc(20 * 40 * 3, 0);
  data.fill(255, 20 * 20 * 3);
  return sharp(data, { raw: { width: 20, height: 40, channels: 3, pageHeight: 20 } });
};
export const animatedGif = () => strip().gif({ delay: [100, 100], loop: 0 }).toBuffer();
export const animatedWebp = () => strip().webp({ delay: [100, 100], loop: 0 }).toBuffer();

/** An ordinary PNG with an `acTL` chunk after its header, which is what makes a PNG animated. */
export async function animatedPng(): Promise<Buffer> {
  const still = await png(20, 20);
  const body = Buffer.concat([Buffer.from("acTL"), Buffer.from([0, 0, 0, 2, 0, 0, 0, 0])]);
  const chunk = Buffer.alloc(16 + 4);
  chunk.writeUInt32BE(8, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(body), 16);
  const afterHeader = 8 + 25;
  return Buffer.concat([still.subarray(0, afterHeader), chunk, still.subarray(afterHeader)]);
}

/** The first box of an HEIC file. The sniffer refuses it before a decoder sees the rest. */
export const heicHeader = () => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.from([0, 0, 0, 0]), Buffer.from("mif1heic"), Buffer.alloc(64)]);

/** A temporary directory with helpers to put fixtures on disk, where the pipeline reads them. */
export function workspace() {
  const dir = mkdtempSync(path.join(tmpdir(), "korbat-worker-"));
  return {
    dir,
    file(name: string, data: Buffer): string {
      const target = path.join(dir, name);
      writeFileSync(target, data);
      return target;
    },
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}
```

### Create `apps/worker/test/pipeline.test.ts`

```ts
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
```

### Create `apps/worker/test/pipeline-formats.test.ts`

```ts
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
```

### Create `apps/worker/vitest.config.ts`

```ts
import { defineConfig } from "vitest/config";

/**
 * The pipeline tests run the real decoder on fixtures they make themselves, some of them near the
 * pixel caps, so they get a longer timeout. VIPS_BLOCK_UNTRUSTED is set as in the container.
 */
export default defineConfig({
  test: { testTimeout: 60_000, env: { VIPS_BLOCK_UNTRUSTED: "1" } },
});
```

### Replace `apps/worker/package.json` (whole file)

```json
{
  "name": "@korbat/worker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsup",
    "start": "node dist/index.js",
    "typecheck": "tsc -p .",
    "test": "vitest run"
  },
  "dependencies": {
    "@korbat/contracts": "workspace:*",
    "@korbat/db": "workspace:*",
    "@korbat/media-protocol": "workspace:*",
    "blurhash": "2.0.5",
    "ioredis": "5.11.1",
    "pino": "10.3.1",
    "sharp": "0.35.4",
    "zod": "4.5.4"
  },
  "devDependencies": {
    "@types/node": "24.13.3",
    "tsup": "8.5.1",
    "tsx": "4.23.13",
    "typescript": "5.9.3",
    "vitest": "4.1.11"
  }
}
```

### Replace `apps/worker/tsconfig.json` (whole file)

```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "types": ["node"] }, "include": ["src", "test", "tsup.config.ts", "vitest.config.ts"] }
```

## Step 2: run the tests and watch them fail

```bash
pnpm install --config.minimum-release-age=0 >/dev/null 2>&1; pnpm --filter @korbat/worker test
```

Expected: the command exits with an error, and the output contains:

- `Cannot find module '../src/pipeline'`

Observed on the dry run:

```text
Error: Cannot find module '../src/pipeline' imported from C:\Users\Lenovo\Desktop\cool\korbat/apps/worker/test/pipeline-formats.test.ts
Error: Cannot find module '../src/pipeline' imported from C:\Users\Lenovo\Desktop\cool\korbat/apps/worker/test/pipeline.test.ts
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/images-2b/write_blocks.py docs/superpowers/prompts/images-2b/06-worker-pipeline.md 3
```

Expected: 1 line starting with `wrote`, one for each file below.

### Create `apps/worker/src/pipeline.ts`

```ts
import { closeSync, openSync, readSync } from "node:fs";
import { encode } from "blurhash";
import sharp from "sharp";
import type { MediaFailure } from "@korbat/contracts";
import { MAX_SIDE, PIXEL_CAP, SNIFF_BYTES, VARIANTS, isAnimatedPng, sniffImage, type ByteReader, type MediaFormat } from "@korbat/media-protocol";

/**
 * Everything that touches the image decoder lives in this file. The decoder is the most
 * exploitable code korbat runs, so it only ever sees formats on an allowlist, only after the
 * file's first bytes said it is one of them, and only with a pixel cap it enforces from the header.
 */

/** libvips loader classes. Unblocking a parent class unblocks its file, buffer and source loaders. */
const LOADER: Record<MediaFormat, string> = {
  jpeg: "VipsForeignLoadJpeg",
  png: "VipsForeignLoadPng",
  webp: "VipsForeignLoadWebp",
  gif: "VipsForeignLoadNsgif",
  avif: "VipsForeignLoadHeif",
};

/** What sharp's metadata calls each format. AVIF arrives as "heif" with AV1 compression. */
const METADATA_FORMAT: Record<MediaFormat, string> = { jpeg: "jpeg", png: "png", webp: "webp", gif: "gif", avif: "heif" };

/**
 * Blocks every loader libvips has (the prebuilt binary also carries SVG and TIFF), then unblocks the
 * enabled formats. libvips ignores a class name it does not know, so a typo here would not raise an
 * error; the tests prove that every enabled format decodes and that SVG and TIFF do not. One image
 * at a time, and no operation cache, keep memory predictable.
 */
export function configureDecoder(formats: readonly MediaFormat[]): void {
  sharp.block({ operation: ["VipsForeignLoad"] });
  sharp.unblock({ operation: formats.map((format) => LOADER[format]) });
  sharp.cache(false);
  sharp.concurrency(1);
}

export type Processed =
  | { ok: true; width: number; height: number; blurhash: string; small: Buffer; large: Buffer }
  | { ok: false; reason: MediaFailure };

const refuse = (reason: MediaFailure): Processed => ({ ok: false, reason });

/** Reads from an open file descriptor without ever loading the whole file. */
function fileReader(fd: number): ByteReader {
  return (offset, length) => {
    const buffer = Buffer.alloc(length);
    return buffer.subarray(0, readSync(fd, buffer, 0, length, offset));
  };
}

/** The first bytes decide what the file is. No decoder has run when this returns. */
function sniffFile(path: string, formats: readonly MediaFormat[]): { format: MediaFormat } | { reason: MediaFailure } {
  const fd = openSync(path, "r");
  try {
    const read = fileReader(fd);
    const sniffed = sniffImage(read(0, SNIFF_BYTES));
    if (sniffed.kind === "animated") return { reason: "animated_not_supported" };
    if (sniffed.kind !== "image" || !formats.includes(sniffed.format)) return { reason: "unsupported_format" };
    if (sniffed.format === "png" && isAnimatedPng(read)) return { reason: "animated_not_supported" };
    return { format: sniffed.format };
  } finally {
    closeSync(fd);
  }
}

/** What a decoder error means for the person who uploaded the file. A missing input is not their fault and is rethrown. */
function failureOf(err: unknown): MediaFailure {
  const message = err instanceof Error ? err.message : String(err);
  if (/input file is missing/i.test(message)) throw err;
  if (/exceeds pixel limit/i.test(message)) return "image_too_large";
  if (/timeout/i.test(message)) return "processing_failed";
  return "corrupt_image";
}

/**
 * Turns one uploaded file into the two WebP sizes and a blurhash, or says why not. The output is a
 * fresh encode: rotated by EXIF, in sRGB, without EXIF, GPS, ICC, XMP, IPTC, thumbnails or gain
 * maps, and without anything that was appended to the file. `failOn: "error"` refuses truncated
 * and broken files but not the harmless libjpeg warnings many phone cameras trigger.
 */
export async function processImage(path: string, formats: readonly MediaFormat[]): Promise<Processed> {
  const sniffed = sniffFile(path, formats);
  if ("reason" in sniffed) return refuse(sniffed.reason);
  const { format } = sniffed;
  const input = { limitInputPixels: PIXEL_CAP[format], failOn: "error", sequentialRead: true } as const;

  try {
    const meta = await sharp(path, input).metadata();
    if (meta.format !== METADATA_FORMAT[format]) return refuse("unsupported_format");
    if (format === "avif" && meta.compression !== "av1") return refuse("unsupported_format");
    if ((meta.pages ?? 1) > 1) return refuse("animated_not_supported");
    if ((meta.width ?? 0) > MAX_SIDE || (meta.height ?? 0) > MAX_SIDE) return refuse("image_too_large");

    const resized = (edge: number) =>
      sharp(path, input).autoOrient().resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true }).timeout({ seconds: 30 });
    const large = await resized(VARIANTS.large.edge).webp({ quality: VARIANTS.large.quality, effort: 4 }).toBuffer({ resolveWithObject: true });

    // The small size is rendered to pixels once. Its WebP and the blurhash both come from those
    // pixels, so neither depends on a decoder: the WebP loader may be switched off.
    const pixels = await resized(VARIANTS.small.edge).toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
    const raw = { width: pixels.info.width, height: pixels.info.height, channels: pixels.info.channels };
    const small = await sharp(pixels.data, { raw }).webp({ quality: VARIANTS.small.quality, effort: 4 }).timeout({ seconds: 30 }).toBuffer();
    const thumb = await sharp(pixels.data, { raw }).resize(32, 32, { fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const blurhash = encode(new Uint8ClampedArray(thumb.data), thumb.info.width, thumb.info.height, 4, 3);

    return { ok: true, width: large.info.width, height: large.info.height, blurhash, small, large: large.data };
  } catch (err) {
    return refuse(failureOf(err));
  }
}
```

## Step 4: verify: install

```bash
pnpm install --config.minimum-release-age=0
```

Expected output contains:

- `Done in`

Must not contain:

- `ERR_PNPM`

Observed on the dry run:

```text
Done in 2.6s using pnpm v10.30.0
```

## Step 5: verify: lockfile-age

```bash
node scripts/check-lockfile-age.mjs --base HEAD
```

Expected output contains:

- `new package versions since HEAD; all at least 7 days old`

Allowed difference: The number of new package versions can differ from the dry run if a dependency of a dependency published a release since; the line must still end in `all at least 7 days old`. A version younger than 7 days is a STOP condition: report it, do not work around it.

Observed on the dry run:

```text
30 new package versions since HEAD; all at least 7 days old
```

## Step 6: verify: no-install-scripts

```bash
node -e "for (const name of ['sharp', 'blurhash']) { const p = require('./node_modules/' + name + '/package.json'); console.log(name, p.version, p.license, 'install scripts:', Object.keys(p.scripts ?? {}).filter((s) => /^(pre|post)?install$/.test(s)).length); }"
```

Expected output contains:

- `sharp 0.35.4 Apache-2.0 install scripts: 0`
- `blurhash 2.0.5 MIT install scripts: 0`

Observed on the dry run:

```text
sharp 0.35.4 Apache-2.0 install scripts: 0
blurhash 2.0.5 MIT install scripts: 0
```

## Step 7: verify: musl-binary-locked

```bash
echo "alpine binary in the lockfile: $(grep -c "'@img/sharp-linuxmusl-x64@0.35.4':" pnpm-lock.yaml)"
```

Expected output contains:

- `alpine binary in the lockfile: 2`

Observed on the dry run:

```text
alpine binary in the lockfile: 2
```

## Step 8: verify: test

```bash
pnpm --filter @korbat/worker test
```

Expected output contains:

- `Tests  24 passed (24)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  24 passed (24)
```

## Step 9: verify: typecheck

```bash
pnpm --filter @korbat/worker typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`

Observed on the dry run:

```text
(no output)
```

## Step 10: verify: frozen-install

```bash
pnpm install --frozen-lockfile
```

Expected output contains:

- `Done in`

Must not contain:

- `ERR_PNPM`

Observed on the dry run:

```text
Done in 2.6s using pnpm v10.30.0
```

## Step 11: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/worker/package.json`
- `apps/worker/src/pipeline.ts`
- `apps/worker/test/fixtures.ts`
- `apps/worker/test/pipeline-formats.test.ts`
- `apps/worker/test/pipeline.test.ts`
- `apps/worker/tsconfig.json`
- `apps/worker/vitest.config.ts`
- `pnpm-lock.yaml`

## Step 12: commit

```bash
git add -A
git commit -q -m "feat(worker): image pipeline on sharp with a loader allowlist, header pixel caps, EXIF rotation, metadata-free WebP in two sizes and a blurhash" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(worker): image pipeline on sharp with a loader allowlist, header pixel caps, EXIF rotation, metadata-free WebP in two sizes and a blurhash`.

## Report format (mandatory)

```text
TASK 6 REPORT
Files written: <count, expected 7>
Failing-test step (the error line): <paste>
Verify "install": <paste the expected lines as printed>
Verify "lockfile-age": <paste the expected lines as printed>
Verify "no-install-scripts": <paste the expected lines as printed>
Verify "musl-binary-locked": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "typecheck": <paste the expected lines as printed>
Verify "frozen-install": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
