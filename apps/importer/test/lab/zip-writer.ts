import { open, type FileHandle } from "node:fs/promises";
import { constants, createDeflateRaw, crc32 } from "node:zlib";

/**
 * A streaming zip writer for the labs (3b design, 12.5): archives of gigabytes written to disk a chunk at a time, every
 * entry with a data descriptor (flag bit 3, as Java's ZipOutputStream writes them), and a raw writer for the crafted
 * records of the bombs. The unit tests' writer (test/fixtures/zip.ts) holds an archive in memory; this one never does.
 */

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const DESCRIPTOR = 0x08074b50;
const FLAG_DESCRIPTOR = 1 << 3;
const FLAG_UTF8 = 1 << 11;
const MADE_BY_UNIX = (3 << 8) | 30;
const S_IFREG = 0o100000;

interface Written {
  name: Buffer;
  method: number;
  crc: number;
  compressed: number;
  size: number;
  offset: number;
}

export class StreamingZip {
  private position = 0;
  private readonly entries: Written[] = [];

  private constructor(private readonly handle: FileHandle) {}

  static async create(file: string): Promise<StreamingZip> {
    return new StreamingZip(await open(file, "w"));
  }

  async raw(bytes: Uint8Array): Promise<void> {
    await this.handle.write(bytes, 0, bytes.length, this.position);
    this.position += bytes.length;
  }

  private localHeader(name: Buffer, method: number): Buffer {
    const header = Buffer.alloc(30);
    header.writeUInt32LE(LOCAL, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(FLAG_DESCRIPTOR | FLAG_UTF8, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(name.length, 26);
    return Buffer.concat([header, name]);
  }

  /** One entry from `chunks`, stored (0) or deflated (8) at level 1. */
  async add(name: string, chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, method: 0 | 8 = 8): Promise<void> {
    const rawName = Buffer.from(name, "utf8");
    const offset = this.position;
    await this.raw(this.localHeader(rawName, method));
    let crc = 0;
    let size = 0;
    const start = this.position;
    if (method === 0) {
      for await (const chunk of chunks) {
        crc = crc32(chunk, crc);
        size += chunk.length;
        await this.raw(chunk);
      }
    } else {
      const deflater = createDeflateRaw({ level: 1 });
      const output: Buffer[] = [];
      deflater.on("data", (chunk: Buffer) => output.push(chunk));
      const flushOut = async () => {
        while (output.length > 0) await this.raw(output.shift()!);
      };
      for await (const chunk of chunks) {
        crc = crc32(chunk, crc);
        size += chunk.length;
        await new Promise<void>((resolve, reject) => deflater.write(chunk, (err) => (err ? reject(err) : resolve())));
        await flushOut();
      }
      const ended = new Promise<void>((resolve, reject) => {
        deflater.once("end", resolve);
        deflater.once("error", reject);
      });
      deflater.end();
      await ended;
      await flushOut();
    }
    const compressed = this.position - start;
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(DESCRIPTOR, 0);
    descriptor.writeUInt32LE(crc >>> 0, 4);
    descriptor.writeUInt32LE(compressed, 8);
    descriptor.writeUInt32LE(size, 12);
    await this.raw(descriptor);
    this.entries.push({ name: rawName, method, crc: crc >>> 0, compressed, size, offset });
  }

  /** The central directory and the end record. */
  async finish(): Promise<number> {
    const directoryOffset = this.position;
    for (const entry of this.entries) {
      const header = Buffer.alloc(46);
      header.writeUInt32LE(CENTRAL, 0);
      header.writeUInt16LE(MADE_BY_UNIX, 4);
      header.writeUInt16LE(20, 6);
      header.writeUInt16LE(FLAG_DESCRIPTOR | FLAG_UTF8, 8);
      header.writeUInt16LE(entry.method, 10);
      header.writeUInt32LE(entry.crc, 16);
      header.writeUInt32LE(entry.compressed, 20);
      header.writeUInt32LE(entry.size, 24);
      header.writeUInt16LE(entry.name.length, 28);
      header.writeUInt32LE(((S_IFREG | 0o644) << 16) >>> 0, 38);
      header.writeUInt32LE(entry.offset, 42);
      await this.raw(Buffer.concat([header, entry.name]));
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(END, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(this.position - directoryOffset, 12);
    end.writeUInt32LE(directoryOffset, 16);
    await this.raw(end);
    await this.handle.close();
    return this.position;
  }
}

/** A raw deflate stream that inflates to `copies` times `block`, built from one compressed block: a ratio bomb's kernel. */
export async function repeatedDeflate(block: Buffer, copies: number): Promise<{ stream: Buffer[]; inflated: number }> {
  const { deflateRawSync } = await import("node:zlib");
  // A full flush ends each segment on a byte boundary with no reference to earlier data, so segments can be repeated.
  const segment = deflateRawSync(block, { level: 9, finishFlush: constants.Z_FULL_FLUSH });
  const last = deflateRawSync(Buffer.alloc(0));
  return { stream: [...Array.from({ length: copies }, () => segment), last], inflated: block.length * copies };
}
