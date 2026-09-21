# korbat 2b — Task 3 of 17: The media-protocol package: limits, volume layout, result files and byte sniffers shared by the API and the worker

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-18 and 2026-09-19 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

The API and the worker share a small package with no I/O of its own: the pixel caps per format, the UUID-only paths of the two volumes, the strict result-file schema that is the protocol's commit point, the heartbeat, and byte sniffers that recognise each accepted format and refuse HEIC, AVIF sequences, animated GIF and WebP, and APNG from the first bytes.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. The `install` step runs with `--config.minimum-release-age=0` for that one command, and the `lockfile-age` step then proves that every newly locked version is at least 7 days old. `pnpm-lock.yaml` is written by the install, never by hand. Never edit `pnpm-workspace.yaml` or `.npmrc`, and never add a package this task does not name.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(contracts): media limits, alt text rule, upload and status responses, media views; every post view carries a media list`.
3. The previous task's integration run ended with `Tests  96 passed (96)`.

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
python docs/superpowers/prompts/images-2b/write_blocks.py docs/superpowers/prompts/images-2b/03-media-protocol.md 1
```

Expected: 4 lines starting with `wrote`, one for each file below.

### Create `packages/media-protocol/package.json`

```json
{
  "name": "@korbat/media-protocol",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc -p .", "test": "vitest run" },
  "dependencies": { "@korbat/contracts": "workspace:*", "zod": "4.5.4" },
  "devDependencies": { "@types/node": "24.13.3", "typescript": "5.9.3", "vitest": "4.1.11" }
}
```

### Create `packages/media-protocol/tsconfig.json`

```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "types": ["node"] }, "include": ["src", "test"] }
```

### Create `packages/media-protocol/test/sniff.test.ts`

```ts
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
```

### Create `packages/media-protocol/test/protocol.test.ts`

```ts
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_STALE_MS,
  Heartbeat,
  MAX_ATTEMPTS,
  MAX_SIDE,
  MEDIA_FORMATS,
  PIXEL_CAP,
  ResultFile,
  VARIANTS,
  isMediaId,
  parseFormats,
  resultFileId,
  storeLayout,
  uploadsLayout,
} from "../src/index";

const ID = "3f2a9c1e-8b7d-4e6f-a5c4-0123456789ab";

describe("limits", () => {
  test("pixel caps follow what decoding costs: AVIF has its own", () => {
    expect(PIXEL_CAP).toEqual({ jpeg: 50_000_000, png: 50_000_000, webp: 50_000_000, gif: 50_000_000, avif: 16_000_000 });
    expect(MAX_SIDE).toBe(16_383);
    expect(VARIANTS).toEqual({ large: { edge: 2048, quality: 82 }, small: { edge: 1024, quality: 80 } });
    expect(MAX_ATTEMPTS).toBe(3);
    expect(HEARTBEAT_STALE_MS).toBeGreaterThan(HEARTBEAT_INTERVAL_MS * 3);
  });

  test("MEDIA_FORMATS: unset means all, a subset keeps the canonical order", () => {
    expect(parseFormats(undefined)).toEqual([...MEDIA_FORMATS]);
    expect(parseFormats("webp, JPEG")).toEqual(["jpeg", "webp"]);
    expect(parseFormats("jpeg,png,webp,gif")).toEqual(["jpeg", "png", "webp", "gif"]);
    expect(parseFormats("png,png")).toEqual(["png"]);
  });

  test("MEDIA_FORMATS: a typo or an empty entry stops the process instead of silently changing what is accepted", () => {
    expect(() => parseFormats("jpeg,tiff")).toThrow(/unknown formats: tiff/);
    expect(() => parseFormats("")).toThrow(/at least one format/);
    expect(() => parseFormats("jpeg,,png")).toThrow(/no empty entries/);
  });
});

describe("layout", () => {
  test("only lowercase UUIDs are media ids", () => {
    expect(isMediaId(ID)).toBe(true);
    for (const bad of ["", ID.toUpperCase(), `${ID}.json`, `../${ID}`, `${ID}/..`, "..", "heartbeat", `${ID} `, ID.replace("-", "_")]) expect(isMediaId(bad)).toBe(false);
  });

  test("the uploads volume", () => {
    const up = uploadsLayout(path.join("x", "uploads"));
    expect(up.part(ID)).toBe(path.join("x", "uploads", "tmp", `${ID}.part`));
    expect(up.upload(ID)).toBe(path.join("x", "uploads", "incoming", ID));
    expect(up.deletion(ID)).toBe(path.join("x", "uploads", "delete", ID));
    expect([up.tmp, up.incoming, up.deletions]).toEqual(["tmp", "incoming", "delete"].map((name) => path.join("x", "uploads", name)));
  });

  test("the store volume shards image folders by the id's first two characters", () => {
    const store = storeLayout(path.join("x", "store"));
    expect(store.shard(ID)).toBe(path.join("x", "store", "files", "3f"));
    expect(store.imageDir(ID)).toBe(path.join("x", "store", "files", "3f", ID));
    expect(store.image(ID, "large")).toBe(path.join("x", "store", "files", "3f", ID, "large.webp"));
    expect(store.image(ID, "small")).toBe(path.join("x", "store", "files", "3f", ID, "small.webp"));
    expect(store.result(ID)).toBe(path.join("x", "store", "results", `${ID}.json`));
    expect(store.attempt(ID)).toBe(path.join("x", "store", "attempts", ID));
    expect(store.heartbeat).toBe(path.join("x", "store", "heartbeat"));
  });

  test("nothing but a media id can become part of a path", () => {
    const up = uploadsLayout("u");
    const store = storeLayout("s");
    for (const bad of ["../../etc/passwd", "..", "", ID.toUpperCase(), `${ID}/x`]) {
      for (const make of [up.part, up.upload, up.deletion, store.shard, store.imageDir, store.result, store.attempt]) expect(() => make(bad)).toThrow("not a media id");
      expect(() => store.image(bad, "large")).toThrow("not a media id");
    }
  });

  test("result file names map back to ids", () => {
    expect(resultFileId(`${ID}.json`)).toBe(ID);
    for (const bad of [ID, `${ID}.json.tmp`, "x.json", `${ID.toUpperCase()}.json`, ".json"]) expect(resultFileId(bad)).toBeNull();
  });
});

describe("result and heartbeat files", () => {
  const ready = { v: 1, id: ID, status: "ready", width: 2048, height: 1536, blurhash: "L2Eo_P_3jb_3~qoLfQj]" };

  test("a ready result has the large size's dimensions and a blurhash", () => {
    expect(ResultFile.parse(ready)).toEqual(ready);
    expect(ResultFile.safeParse({ ...ready, width: MAX_SIDE + 1 }).success).toBe(false);
    expect(ResultFile.safeParse({ ...ready, width: 0 }).success).toBe(false);
    expect(ResultFile.safeParse({ ...ready, blurhash: "x" }).success).toBe(false);
    expect(ResultFile.safeParse({ ...ready, blurhash: "x".repeat(65) }).success).toBe(false);
  });

  test("a failed result names one of the known reasons", () => {
    expect(ResultFile.safeParse({ v: 1, id: ID, status: "failed", reason: "animated_not_supported" }).success).toBe(true);
    expect(ResultFile.safeParse({ v: 1, id: ID, status: "failed", reason: "because" }).success).toBe(false);
    expect(ResultFile.safeParse({ v: 1, id: ID, status: "failed" }).success).toBe(false);
  });

  test("results are parsed strictly: no other version, no extra keys, no other id shape", () => {
    expect(ResultFile.safeParse({ ...ready, v: 2 }).success).toBe(false);
    expect(ResultFile.safeParse({ ...ready, path: "/etc/passwd" }).success).toBe(false);
    expect(ResultFile.safeParse({ ...ready, id: "../x" }).success).toBe(false);
    expect(ResultFile.safeParse("ready").success).toBe(false);
  });

  test("the heartbeat is a version and a time", () => {
    expect(Heartbeat.parse({ v: 1, at: 1_789_000_000_000 })).toEqual({ v: 1, at: 1_789_000_000_000 });
    expect(Heartbeat.safeParse({ v: 1, at: -1 }).success).toBe(false);
    expect(Heartbeat.safeParse({ v: 1, at: 1, extra: true }).success).toBe(false);
  });
});
```

## Step 2: run the tests and watch them fail

```bash
pnpm install --config.minimum-release-age=0 >/dev/null 2>&1; pnpm --filter @korbat/media-protocol test
```

Expected: the command exits with an error, and the output contains:

- `../src/index`

Observed on the dry run:

```text
Error: Cannot find module '../src/index' imported from C:\Users\Lenovo\Desktop\cool\korbat/packages/media-protocol/test/protocol.test.ts
Error: Cannot find module '../src/index' imported from C:\Users\Lenovo\Desktop\cool\korbat/packages/media-protocol/test/sniff.test.ts
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/images-2b/write_blocks.py docs/superpowers/prompts/images-2b/03-media-protocol.md 3
```

Expected: 5 lines starting with `wrote`, one for each file below.

### Create `packages/media-protocol/src/limits.ts`

```ts
/** The image formats korbat can accept. MEDIA_FORMATS in the environment enables a subset. */
export const MEDIA_FORMATS = ["jpeg", "png", "webp", "gif", "avif"] as const;
export type MediaFormat = (typeof MEDIA_FORMATS)[number];

/**
 * Decoding costs memory by pixel count, not by file size: a 932-byte AVIF of 20 megapixels took
 * 423 MB in the 2026-09-18 measurements, while WebP and 8-bit PNG stream at about 100 MB for 48.
 * AVIF therefore has its own cap. The worker passes these to the decoder, which enforces them
 * from the header before any pixel is decoded.
 */
export const PIXEL_CAP: Record<MediaFormat, number> = {
  jpeg: 50_000_000,
  png: 50_000_000,
  webp: 50_000_000,
  gif: 50_000_000,
  avif: 16_000_000,
};

/** The longest side accepted, which is also the most WebP can hold. */
export const MAX_SIDE = 16_383;

/** The two sizes the worker writes. `edge` bounds the longer side; images are never enlarged. */
export const VARIANTS = {
  large: { edge: 2048, quality: 82 },
  small: { edge: 1024, quality: 80 },
} as const;

/** How often processing of one upload may start. A file that kills the worker is retried at most this often. */
export const MAX_ATTEMPTS = 3;

export const HEARTBEAT_INTERVAL_MS = 10_000;
export const HEARTBEAT_STALE_MS = 60_000;

/** Bounds for files the API reads from the store, which it treats as untrusted. */
export const MAX_RESULT_BYTES = 16 * 1024;
export const MAX_VARIANT_BYTES = 32 * 1024 * 1024;

/**
 * MEDIA_FORMATS: a comma-separated subset of the formats, or unset for all of them. Removing a
 * format refuses it at upload and leaves its decoder blocked, which is how an operator reacts to
 * an advisory against one decoder without a deploy.
 */
export function parseFormats(value: string | undefined): MediaFormat[] {
  if (value === undefined) return [...MEDIA_FORMATS];
  const names = value.split(",").map((name) => name.trim().toLowerCase());
  if (names.some((name) => name === "")) throw new Error("MEDIA_FORMATS must name at least one format and have no empty entries");
  const unknown = names.filter((name) => !(MEDIA_FORMATS as readonly string[]).includes(name));
  if (unknown.length > 0) throw new Error(`MEDIA_FORMATS has unknown formats: ${unknown.join(", ")}. Known: ${MEDIA_FORMATS.join(", ")}`);
  return MEDIA_FORMATS.filter((format) => names.includes(format));
}
```

### Create `packages/media-protocol/src/layout.ts`

```ts
import path from "node:path";
import type { MediaSize } from "@korbat/contracts";

const MEDIA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Ids are lowercase UUIDs made by the API. Nothing else may become part of a path. */
export function isMediaId(value: string): boolean {
  return MEDIA_ID.test(value);
}

function checked(id: string): string {
  if (!isMediaId(id)) throw new Error("not a media id");
  return id;
}

/**
 * The uploads volume: the API writes it, the worker only reads it.
 *   tmp/<id>.part   a body being received
 *   incoming/<id>   a complete upload waiting for the worker
 *   delete/<id>     a request to delete image <id>
 */
export function uploadsLayout(root: string) {
  const tmp = path.join(root, "tmp");
  const incoming = path.join(root, "incoming");
  const deletions = path.join(root, "delete");
  return {
    root,
    tmp,
    incoming,
    deletions,
    part: (id: string) => path.join(tmp, `${checked(id)}.part`),
    upload: (id: string) => path.join(incoming, checked(id)),
    deletion: (id: string) => path.join(deletions, checked(id)),
  };
}
export type UploadsLayout = ReturnType<typeof uploadsLayout>;

/**
 * The store volume: the worker writes it, the API only reads it.
 *   files/<aa>/<id>/small.webp, large.webp   <aa> = the id's first two characters
 *   results/<id>.json                        the outcome, written last
 *   attempts/<id>                            how often processing started
 *   tmp/                                     files being written
 *   heartbeat                                rewritten every ten seconds
 */
export function storeLayout(root: string) {
  const files = path.join(root, "files");
  const results = path.join(root, "results");
  const attempts = path.join(root, "attempts");
  const tmp = path.join(root, "tmp");
  const imageDir = (id: string) => path.join(files, checked(id).slice(0, 2), id);
  return {
    root,
    files,
    results,
    attempts,
    tmp,
    heartbeat: path.join(root, "heartbeat"),
    shard: (id: string) => path.join(files, checked(id).slice(0, 2)),
    imageDir,
    image: (id: string, size: MediaSize) => path.join(imageDir(id), `${size}.webp`),
    result: (id: string) => path.join(results, `${checked(id)}.json`),
    attempt: (id: string) => path.join(attempts, checked(id)),
  };
}
export type StoreLayout = ReturnType<typeof storeLayout>;

/** `<id>.json` to `<id>`, or null when the name is not a result file. */
export function resultFileId(name: string): string | null {
  if (!name.endsWith(".json")) return null;
  const id = name.slice(0, -".json".length);
  return isMediaId(id) ? id : null;
}
```

### Create `packages/media-protocol/src/result.ts`

```ts
import { z } from "zod";
import { MediaFailure } from "@korbat/contracts";
import { MAX_SIDE } from "./limits";

const side = z.number().int().min(1).max(MAX_SIDE);

/**
 * results/<id>.json, the worker's last write for an upload and therefore the commit point. Width
 * and height are those of large.webp, after rotation. The API parses this strictly: the file
 * comes from the one process korbat does not trust.
 */
export const ResultFile = z.discriminatedUnion("status", [
  z.strictObject({ v: z.literal(1), id: z.uuid(), status: z.literal("ready"), width: side, height: side, blurhash: z.string().min(6).max(64) }),
  z.strictObject({ v: z.literal(1), id: z.uuid(), status: z.literal("failed"), reason: MediaFailure }),
]);
export type ResultFile = z.infer<typeof ResultFile>;

/** The heartbeat file: when the worker last completed a tick, in epoch milliseconds. */
export const Heartbeat = z.strictObject({ v: z.literal(1), at: z.number().int().nonnegative() });
export type Heartbeat = z.infer<typeof Heartbeat>;
```

### Create `packages/media-protocol/src/sniff.ts`

```ts
import type { MediaFormat } from "./limits";

/** How many leading bytes `sniffImage` wants. An ISO media `ftyp` box with a long brand list still fits. */
export const SNIFF_BYTES = 256;

/**
 * What the first bytes of an upload say it is. Both sides run this before anything else: the API
 * before it writes a byte to disk, the worker before it hands the file to a decoder.
 */
export type Sniffed =
  | { kind: "image"; format: MediaFormat }
  /** HEIC or another HEIF flavour the decoder cannot read. The interface suggests exporting as JPEG. */
  | { kind: "heic" }
  /** An animated WebP or an AVIF sequence. Animated GIF and PNG are found later, without decoding frames. */
  | { kind: "animated" }
  | { kind: "unknown" };

const ascii = (bytes: Uint8Array, start: number, length: number): string => String.fromCharCode(...bytes.subarray(start, start + length));
const startsWith = (bytes: Uint8Array, signature: number[]): boolean => bytes.length >= signature.length && signature.every((byte, i) => bytes[i] === byte);
const uint32 = (bytes: Uint8Array, at: number): number => ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;

const HEIF_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs", "mif1", "msf1"]);

export function sniffImage(head: Uint8Array): Sniffed {
  if (startsWith(head, [0xff, 0xd8, 0xff])) return { kind: "image", format: "jpeg" };
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: "image", format: "png" };
  if (head.length >= 6 && (ascii(head, 0, 6) === "GIF87a" || ascii(head, 0, 6) === "GIF89a")) return { kind: "image", format: "gif" };
  if (head.length >= 16 && ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WEBP") {
    // An extended WebP (VP8X) says in its flags byte whether it is animated.
    if (ascii(head, 12, 4) === "VP8X" && head.length >= 21 && (head[20]! & 0x02) !== 0) return { kind: "animated" };
    return { kind: "image", format: "webp" };
  }
  if (head.length >= 16 && ascii(head, 4, 4) === "ftyp") return sniffIsoMedia(head);
  return { kind: "unknown" };
}

/** AVIF and HEIC share a container. The brands in its first box tell them apart. */
function sniffIsoMedia(head: Uint8Array): Sniffed {
  const declared = uint32(head, 0);
  const end = Math.min(declared >= 16 ? declared : head.length, head.length);
  const brands = [ascii(head, 8, 4)];
  for (let at = 16; at + 4 <= end; at += 4) brands.push(ascii(head, at, 4));
  if (brands.includes("avis")) return { kind: "animated" };
  if (brands.includes("avif")) return { kind: "image", format: "avif" };
  if (brands.some((brand) => HEIF_BRANDS.has(brand))) return { kind: "heic" };
  return { kind: "unknown" };
}

/** Returns up to `length` bytes at `offset`, and fewer at the end of the file. */
export type ByteReader = (offset: number, length: number) => Uint8Array;

/**
 * An animated PNG declares itself with an `acTL` chunk before its first `IDAT`. libvips 8.18
 * decodes only the first frame and reports a single page, so the worker looks for the chunk itself.
 * Only chunk headers are read: no chunk data, and no decoding.
 */
export function isAnimatedPng(read: ByteReader): boolean {
  let offset = 8;
  for (let chunks = 0; chunks < 4096; chunks++) {
    const header = read(offset, 8);
    if (header.length < 8) return false;
    const type = ascii(header, 4, 4);
    if (type === "acTL") return true;
    if (type === "IDAT" || type === "IEND") return false;
    offset += 12 + uint32(header, 0);
  }
  return false;
}
```

### Create `packages/media-protocol/src/index.ts`

```ts
/**
 * The contract between the API and the image worker, which talk only through files on two
 * volumes. Each side writes its own volume and reads the other's. See section 2.2 of
 * docs/superpowers/specs/2026-09-18-images-2b-design.md.
 */
export * from "./limits";
export * from "./layout";
export * from "./result";
export * from "./sniff";
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
Done in 2.5s using pnpm v10.30.0
```

## Step 5: verify: lockfile-age

```bash
node scripts/check-lockfile-age.mjs --base HEAD
```

Expected output contains:

- `0 new package versions since HEAD`

Observed on the dry run:

```text
0 new package versions since HEAD; all at least 7 days old
```

## Step 6: verify: test

```bash
pnpm --filter @korbat/media-protocol test
```

Expected output contains:

- `Tests  21 passed (21)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  21 passed (21)
```

## Step 7: verify: typecheck

```bash
pnpm --filter @korbat/media-protocol typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`

Observed on the dry run:

```text
(no output)
```

## Step 8: verify: frozen-install

```bash
pnpm install --frozen-lockfile
```

Expected output contains:

- `Done in`

Must not contain:

- `ERR_PNPM`

Observed on the dry run:

```text
Done in 2.4s using pnpm v10.30.0
```

## Step 9: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `packages/media-protocol/package.json`
- `packages/media-protocol/src/index.ts`
- `packages/media-protocol/src/layout.ts`
- `packages/media-protocol/src/limits.ts`
- `packages/media-protocol/src/result.ts`
- `packages/media-protocol/src/sniff.ts`
- `packages/media-protocol/test/protocol.test.ts`
- `packages/media-protocol/test/sniff.test.ts`
- `packages/media-protocol/tsconfig.json`
- `pnpm-lock.yaml`

## Step 10: commit

```bash
git add -A
git commit -q -m "feat(media-protocol): limits per format, UUID-only volume layout, strict result files, and sniffers for formats, HEIC, animation and APNG" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(media-protocol): limits per format, UUID-only volume layout, strict result files, and sniffers for formats, HEIC, animation and APNG`.

## Report format (mandatory)

```text
TASK 3 REPORT
Files written: <count, expected 9>
Failing-test step (the error line): <paste>
Verify "install": <paste the expected lines as printed>
Verify "lockfile-age": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "typecheck": <paste the expected lines as printed>
Verify "frozen-install": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
