/**
 * The first bytes of a WebP file, built by hand for the tests of the checked open that serves staff an image: a RIFF
 * container named WEBP whose first chunk says how large the picture is, in each of the three forms the format has. Nothing
 * here is a picture: the bytes after the header are filler, since the API never decodes a file of the store.
 */
export type WebpKind = "VP8 " | "VP8L" | "VP8X";

const ascii = (text: string) => Buffer.from(text, "ascii");
const u32 = (value: number) => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value >>> 0);
  return bytes;
};
const u24 = (value: number) => Buffer.from([value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff]);
const u16 = (value: number) => Buffer.from([value & 0xff, (value >> 8) & 0xff]);

/** The chunk that carries the size, from its name on: 18 bytes in each form, so that the whole header is 30. */
function sizeChunk(kind: WebpKind, width: number, height: number): Buffer {
  if (kind === "VP8X") {
    // Flags and three reserved bytes, then the canvas' width and height, each less one, in 24 bits.
    return Buffer.concat([ascii("VP8X"), u32(10), Buffer.from([0, 0, 0, 0]), u24(width - 1), u24(height - 1)]);
  }
  if (kind === "VP8L") {
    // The signature byte, then 14 bits of width less one, 14 of height less one, the alpha bit and three bits of version.
    const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
    return Buffer.concat([ascii("VP8L"), u32(64), Buffer.from([0x2f]), u32(bits), Buffer.alloc(5)]);
  }
  // A key frame's three-byte tag (its lowest bit clear), the start code, then the width and the height in 14 bits each.
  return Buffer.concat([ascii("VP8 "), u32(64), Buffer.from([0x10, 0x02, 0x00]), Buffer.from([0x9d, 0x01, 0x2a]), u16(width & 0x3fff), u16(height & 0x3fff)]);
}

/** A file that begins as a WebP of this size does: the 30 bytes of its header, then filler that names the file. */
export function webpBytes(kind: WebpKind, width: number, height: number, filler = "not a picture"): Buffer {
  const body = Buffer.concat([ascii("WEBP"), sizeChunk(kind, width, height), ascii(filler)]);
  return Buffer.concat([ascii("RIFF"), u32(body.length), body]);
}
