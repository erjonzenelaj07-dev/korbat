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
