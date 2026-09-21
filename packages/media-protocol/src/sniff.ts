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
