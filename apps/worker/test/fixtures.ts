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
