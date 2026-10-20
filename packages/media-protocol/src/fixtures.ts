/**
 * The test adapters' fixtures (3d design, sections 5 "The adapters" and 12; Task 6 for the marker, Task 7 for the
 * matcher's files). The repository carries no image file and commits none: every image the suites use is encoded when
 * the test runs, and an encoder's bytes differ between machines, so what a test adapter recognises is written here as a
 * constant.
 *
 * The test scorer's marker (R1_CLASSIFIER=test): a block of one exact colour in the image's top left corner, at least
 * `side` pixels on each side. The scorer answers 1 for an image whose small size carries it, read from the raw sRGB
 * pixels the pipeline already holds, and 0 for every other image. It looks at the `probe` pixels on each side of the
 * corner and allows each channel `tolerance` levels, so the block survives the pipeline's resize and its conversion to
 * sRGB, and a lossy source's few levels of noise: a test proves it through the real pipeline.
 */
export const R1_MARKER = {
  red: 255,
  green: 0,
  blue: 255,
  /** The block's side in the uploaded image, in pixels: at least this much. */
  side: 64,
  /** The pixels on each side of the small size's corner that the scorer reads. */
  probe: 16,
  /** How far each channel may stray from the colour. */
  tolerance: 12,
} as const;

/**
 * Whether raw pixels (rows of `width` pixels of `channels` bytes, red first) carry the marker in their top left corner:
 * every pixel of the probe's square within the tolerance of the marker's colour. Too small an image carries none.
 */
export function carriesR1Marker(pixels: Uint8Array, width: number, height: number, channels: number): boolean {
  const { probe, tolerance } = R1_MARKER;
  if (channels < 3 || width < probe || height < probe || pixels.length < width * height * channels) return false;
  for (let y = 0; y < probe; y++) {
    for (let x = 0; x < probe; x++) {
      const at = (y * width + x) * channels;
      if (Math.abs(pixels[at]! - R1_MARKER.red) > tolerance || Math.abs(pixels[at + 1]! - R1_MARKER.green) > tolerance || Math.abs(pixels[at + 2]! - R1_MARKER.blue) > tolerance) return false;
    }
  }
  return true;
}

/**
 * The test matcher's two files (3d design, sections 5 "The adapters" and 12; Task 7, MEDIA_MATCH=test): two PNG images of
 * 8 by 8 pixels of one flat colour each, written out byte for byte as hexadecimal constants, so their digests are the same
 * on every machine and no encoder runs at test time. Each is the PNG signature, its IHDR chunk (8 by 8, 8-bit RGB), one
 * IDAT chunk holding a zlib stream with one stored (uncompressed) block of the eight rows (a filter byte of 0, then eight
 * pixels), and the IEND chunk; every CRC-32 and the Adler-32 are written out too. They show nothing: two flat colours.
 * The test adapter answers on their digests, computed from these bytes when it is built, and a unit test holds those to
 * node:crypto's. `acting` is the file the test matcher reports as an exact match of its listed and acting class;
 * `flag` is the one it reports as a match that does not act (near of the listed class, or of the class that is not
 * listed, as the test sets).
 */
const PNG_SIGNATURE = "89504e470d0a1a0a";
const PNG_IHDR_8X8_RGB = "0000000d49484452000000080000000808020000004b6d29dc";
const PNG_IEND = "0000000049454e44ae426082";

/** One fixture's hexadecimal bytes: the signature, IHDR, the IDAT chunk of eight equal rows, and IEND. */
function flatPng(row: string, adler: string, idatCrc: string): string {
  // The IDAT chunk: its length (211 bytes), its type, the zlib header and the stored block's header (final, 200 bytes),
  // the rows, the Adler-32 of the rows, and the chunk's CRC-32.
  return PNG_SIGNATURE + PNG_IHDR_8X8_RGB + "000000d3" + "49444154" + "780101c80037ff" + row.repeat(8) + adler + idatCrc + PNG_IEND;
}

/** Hexadecimal text as bytes. */
function bytesOf(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export const MATCH_FIXTURES = {
  /** Flat 0x2060a0. */
  acting: bytesOf(flatPng("002060a02060a02060a02060a02060a02060a02060a02060a0", "026c4801", "e0c8ad94")),
  /** Flat 0xa06020. */
  flag: bytesOf(flatPng("00a06020a06020a06020a06020a06020a06020a06020a06020", "426c4801", "10978b5e")),
} as const;
