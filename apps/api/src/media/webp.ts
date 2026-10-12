/**
 * What a WebP file's first bytes say about it. The store is written by the worker, which runs the image decoder, so the
 * API treats every file in it as written by an attacker; before an image is handed to the staff console, its header is
 * read here (3c design, section 7.3). Nothing is decoded: the three forms of the format each state the picture's size in
 * fixed places within the first 30 bytes.
 */

/** As many bytes as the longest of the three headers needs: 12 of the container, 8 of the first chunk's name and length, 10 of its fields. */
export const WEBP_HEADER_BYTES = 30;

const ascii = (bytes: Uint8Array, at: number, length: number): string => String.fromCharCode(...bytes.subarray(at, at + length));
const u16 = (bytes: Uint8Array, at: number): number => bytes[at]! | (bytes[at + 1]! << 8);
const u24 = (bytes: Uint8Array, at: number): number => bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16);

/**
 * The width and height a file states, or null when its first 30 bytes are not those of a RIFF container named WEBP whose
 * first chunk is one of the three that carry a size:
 *   - `VP8 `, lossy: a key frame (the lowest bit of its tag is clear) with the start code 9d 01 2a, then the width and
 *     the height in 14 bits each; the two bits above each are a scaling hint for the decoder, not part of the size;
 *   - `VP8L`, lossless: the signature byte 2f, then 14 bits of width less one, 14 of height less one, the alpha bit and
 *     three bits of version, which is 0;
 *   - `VP8X`, extended: after its flags and three reserved bytes, the canvas' width and height, each less one, in 24 bits.
 */
export function webpSize(head: Uint8Array): { width: number; height: number } | null {
  if (head.length < WEBP_HEADER_BYTES) return null;
  if (ascii(head, 0, 4) !== "RIFF" || ascii(head, 8, 4) !== "WEBP") return null;
  const chunk = ascii(head, 12, 4);
  if (chunk === "VP8 ") {
    if ((head[20]! & 1) !== 0 || head[23] !== 0x9d || head[24] !== 0x01 || head[25] !== 0x2a) return null;
    return { width: u16(head, 26) & 0x3fff, height: u16(head, 28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    if (head[20] !== 0x2f || head[24]! >> 5 !== 0) return null;
    // 28 bits across four bytes; the top byte is taken apart by hand, since a shift by 24 would make the number signed.
    const low = u24(head, 21);
    const high = head[24]!;
    return { width: (low & 0x3fff) + 1, height: ((low >> 14) | ((high & 0x0f) << 10)) + 1 };
  }
  if (chunk === "VP8X") return { width: u24(head, 24) + 1, height: u24(head, 27) + 1 };
  return null;
}
