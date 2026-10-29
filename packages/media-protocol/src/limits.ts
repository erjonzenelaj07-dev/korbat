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

/**
 * 2d Task 3 (design, sections 7.1 and 7.4): an avatar's two squares, under the two names of every image: `edge` is the
 * square's side, never enlarged. 40 px in lists and 32 px in the composer use the small one up to three device pixels per
 * CSS pixel; the profile's header and a card use the large one.
 */
export const AVATAR_VARIANTS = {
  large: { edge: 400, quality: 82 },
  small: { edge: 128, quality: 80 },
} as const;

/** How often processing of one upload may start. A file that kills the worker is retried at most this often. */
export const MAX_ATTEMPTS = 3;

export const HEARTBEAT_INTERVAL_MS = 10_000;
export const HEARTBEAT_STALE_MS = 60_000;

/** Bounds for files the API reads from the store, which it treats as untrusted. */
export const MAX_RESULT_BYTES = 16 * 1024;
/** 2d Task 3: the most an avatar's job file may hold, which the worker reads from the volume the API writes. */
export const MAX_JOB_BYTES = 256;
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
