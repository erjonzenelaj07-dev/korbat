import { closeSync, openSync, readSync } from "node:fs";
import { encode } from "blurhash";
import sharp from "sharp";
import type { AvatarCrop, MediaFailure } from "@korbat/contracts";
import { AVATAR_VARIANTS, MAX_SIDE, PIXEL_CAP, SNIFF_BYTES, VARIANTS, isAnimatedPng, sniffImage, type ByteReader, type MediaFormat } from "@korbat/media-protocol";
import type { Scorer } from "./score";

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

/**
 * What processing made of an upload. 3d Task 6: `r1`, the scorer's model and score, while a scorer runs and it answered
 * one; absent otherwise, and then the result file carries no score.
 */
export type Processed =
  | { ok: true; width: number; height: number; blurhash: string; small: Buffer; large: Buffer; r1?: { model: string; score: number } }
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
 *
 * 3d Task 6 (design, sections 5 "The adapters" and 10.2): with a scorer, the small size's raw pixels, which are rendered
 * here once for the WebP and the blurhash, are also handed to it, with their width, height and channels; nothing else is.
 *
 * 2d Task 3 (design, section 7.4): with `avatar`, the crop of the upload's job file, the same checks run first, and then
 * the two squares of avatarSquares are made instead of the two sizes. The uncropped image is never written.
 */
export async function processImage(path: string, formats: readonly MediaFormat[], scorer: Scorer | null = null, avatar?: { crop: AvatarCrop }): Promise<Processed> {
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
    if (avatar !== undefined) return await avatarSquares(path, input, meta.autoOrient, avatar.crop, scorer);

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
    const score = scorer === null ? null : await scorer.score(pixels.data, raw.width, raw.height, raw.channels);

    return { ok: true, width: large.info.width, height: large.info.height, blurhash, small, large: large.data, ...(scorer !== null && score !== null ? { r1: { model: scorer.model, score } } : {}) };
  } catch (err) {
    return refuse(failureOf(err));
  }
}

/**
 * 2d Task 3 (design, sections 7.1 and 7.4): an avatar's two squares. With `w` and `h` the image's size once its EXIF
 * orientation is applied and `s` the shorter of the two, the square of side `s` is cut along the longer side at 0 (start),
 * at half the difference rounded down (centre) or at the difference (end); sharp orients an input that autoOrient marks
 * before it extracts, so the crop is taken from the image as it is shown. The square is rendered once to raw sRGB pixels
 * of at most AVATAR_VARIANTS.large.edge on a side, never enlarged: those pixels make large.webp and, with a scorer, are what
 * it scores, as a post's image is scored from its small size. The small square is resized from them, and its pixels make
 * small.webp and the blurhash. Every file is a fresh encode of pixels, so no metadata of the source survives, and no
 * decoder of WebP is needed. Runs inside processImage's try: a decoder's error is its failure.
 */
async function avatarSquares(path: string, input: Parameters<typeof sharp>[1], oriented: { width: number; height: number }, crop: AvatarCrop, scorer: Scorer | null): Promise<Processed> {
  const side = Math.min(oriented.width, oriented.height);
  const spare = Math.max(oriented.width, oriented.height) - side;
  const offset = crop === "start" ? 0 : crop === "centre" ? Math.floor(spare / 2) : spare;
  const region = oriented.width >= oriented.height ? { left: offset, top: 0, width: side, height: side } : { left: 0, top: offset, width: side, height: side };
  const square = (edge: number) => ({ width: edge, height: edge, fit: "inside" as const, withoutEnlargement: true });

  const large = await sharp(path, input).autoOrient().extract(region).resize(square(AVATAR_VARIANTS.large.edge)).toColourspace("srgb").raw().timeout({ seconds: 30 }).toBuffer({ resolveWithObject: true });
  const largeRaw = { width: large.info.width, height: large.info.height, channels: large.info.channels };
  const largeWebp = await sharp(large.data, { raw: largeRaw }).webp({ quality: AVATAR_VARIANTS.large.quality, effort: 4 }).timeout({ seconds: 30 }).toBuffer();
  const small = await sharp(large.data, { raw: largeRaw }).resize(square(AVATAR_VARIANTS.small.edge)).raw().toBuffer({ resolveWithObject: true });
  const smallRaw = { width: small.info.width, height: small.info.height, channels: small.info.channels };
  const smallWebp = await sharp(small.data, { raw: smallRaw }).webp({ quality: AVATAR_VARIANTS.small.quality, effort: 4 }).timeout({ seconds: 30 }).toBuffer();
  const thumb = await sharp(small.data, { raw: smallRaw }).resize(32, 32, { fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const blurhash = encode(new Uint8ClampedArray(thumb.data), thumb.info.width, thumb.info.height, 4, 3);
  const score = scorer === null ? null : await scorer.score(large.data, largeRaw.width, largeRaw.height, largeRaw.channels);

  return { ok: true, width: largeRaw.width, height: largeRaw.height, blurhash, small: smallWebp, large: largeWebp, ...(scorer !== null && score !== null ? { r1: { model: scorer.model, score } } : {}) };
}
