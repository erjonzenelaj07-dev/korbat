import { setImmediate as nextTurn } from "node:timers/promises";
import { crc32 } from "node:zlib";
import { Deflate } from "fflate";
import type { StoredFile } from "../media";

/** Receives the archive's bytes in order. The writer awaits every call, so a slow consumer slows the reading of the files. */
export type ZipSink = (chunk: Uint8Array) => Promise<void>;

/**
 * Opens the file an entry holds: the media module's checked open, which answers null for a file it
 * refuses (missing, not a plain file of the store, larger than a variant may be) and otherwise the open
 * handle with the size it measured. The writer reads exactly that many bytes and closes the handle.
 */
export type OpenFile = () => Promise<StoredFile | null>;

export interface ZipWriter {
  /**
   * A deflated entry whose text arrives in pieces, for export.json: each piece is encoded, fed to the
   * deflate at most 64 KiB at a time, and the event loop gets a turn between two feeds, so a large
   * document never holds the loop and never sits in memory whole.
   */
  addJsonPieces(name: string, pieces: AsyncIterable<string>): Promise<void>;
  /**
   * A stored entry holding the bytes of the file `open` answers, read in chunks up to the size it
   * checked. False, with nothing added, when it answers null. A failure while reading, after the entry
   * began, is thrown: the archive can no longer be completed.
   */
  addFile(name: string, open: OpenFile): Promise<boolean>;
  /** Writes the central directory and the end records. Nothing may be added afterwards. */
  end(): Promise<void>;
}

export interface ZipWriterOptions {
  /** Tests only: "always" writes the ZIP64 fields of every entry and the ZIP64 end records, whatever the sizes. */
  zip64?: "auto" | "always";
  /**
   * Tests only: offsets are counted from here, as if that many bytes had gone before the archive, so a test
   * can see the switch to ZIP64 at 4 GiB without writing 4 GiB. The bytes written are the archive's all the same.
   */
  startOffset?: number;
}

/** How much of a file is read at a time; each chunk becomes one awaited write. */
const CHUNK_BYTES = 64 * 1024;
/** The most the deflate is given at once; the event loop gets a turn after each. */
const PIECE_BYTES = 64 * 1024;

/** The largest value a 32-bit field holds; the value itself means "see the ZIP64 record", so it is ZIP64 already. */
const MAX32 = 0xffffffff;
const MAX16 = 0xffff;
const TWO_32 = 0x1_0000_0000;

const SIG_LOCAL = 0x04034b50;
const SIG_DESCRIPTOR = 0x08074b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END64 = 0x06064b50;
const SIG_LOCATOR64 = 0x07064b50;
const SIG_END = 0x06054b50;
/** ZIP 4.5: the version that knows ZIP64, needed to read every entry and the archive. */
const VERSION = 45;
/** Bit 3: the CRC and the sizes follow the data in a descriptor. Bit 11: the name is UTF-8. */
const FLAGS = 0x0008 | 0x0800;
const STORED = 0;
const DEFLATED = 8;

interface Entry {
  name: Uint8Array;
  method: typeof STORED | typeof DEFLATED;
  /** Where the local header starts, from the archive's first byte (plus the test offset). */
  offset: number;
  crc: number;
  compressed: number;
  size: number;
  /** Whether the central directory gives it a ZIP64 extra field, which makes the whole archive ZIP64. */
  zip64: boolean;
}

/** A fixed-size record to fill in little-endian. */
function record(length: number): { bytes: Uint8Array; view: DataView } {
  const bytes = new Uint8Array(length);
  return { bytes, view: new DataView(bytes.buffer) };
}

/** A 64-bit field. The values stay far below 2^53, where a JavaScript number is still exact. */
function setUint64(view: DataView, at: number, value: number): void {
  view.setUint32(at, value % TWO_32, true);
  view.setUint32(at + 4, Math.floor(value / TWO_32), true);
}

/** The MS-DOS date and time every header carries, from the local clock as archivers do; ZIP cannot say a year before 1980. */
function dosDateTime(at: Date): { time: number; date: number } {
  const year = Math.min(2107, Math.max(1980, at.getFullYear()));
  return {
    time: (at.getHours() << 11) | (at.getMinutes() << 5) | (at.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
  };
}

/**
 * A ZIP archive written entry by entry into an async sink. Every entry streams: its local header carries
 * no CRC or sizes (flag bit 3), the data follows, and a data descriptor after it holds the CRC and the
 * sizes, so nothing about an entry has to be known before its first byte goes out. Each chunk is one
 * awaited write, so at most one chunk of input is in flight and back-pressure reaches the file reads.
 *
 * The container is written here rather than by fflate's Zip, which knows no ZIP64: an export whose
 * images pass 4 GiB, or 65,534 entries, would get offsets and a count that wrap, and no reader could open
 * it. fflate still does the deflate, and Node's zlib the CRC-32. ZIP64 (APPNOTE 4.3.9, 4.3.14-4.3.16,
 * 4.5.3) comes in by itself where a value does not fit: an entry whose sizes reach 4 GiB gets 8-byte sizes
 * in its data descriptor; a central directory entry gets a ZIP64 extra field (id 0x0001) holding each size
 * or offset that does not fit, in that order, with 0xFFFFFFFF in the 32-bit field it replaces; and the
 * archive then ends with the ZIP64 end record and its locator before the classic end record, whose
 * fields that do not fit read 0xFFFF or 0xFFFFFFFF.
 */
export function createZipWriter(sink: ZipSink, options: ZipWriterOptions = {}): ZipWriter {
  const always = options.zip64 === "always";
  const { time, date } = dosDateTime(new Date());
  const encoder = new TextEncoder();
  const entries: Entry[] = [];
  let offset = options.startOffset ?? 0;
  /** What the deflate has handed out and the sink has not taken yet: fflate calls back synchronously while it is fed. */
  const queued: Uint8Array[] = [];

  async function write(chunk: Uint8Array): Promise<void> {
    offset += chunk.length;
    await sink(chunk);
  }

  async function drain(): Promise<void> {
    while (queued.length > 0) await write(queued.shift()!);
  }

  /** Writes the entry's local header and returns the entry, to be counted into as its data is written. */
  async function begin(name: string, method: Entry["method"]): Promise<Entry> {
    const entry: Entry = { name: encoder.encode(name), method, offset, crc: 0, compressed: 0, size: 0, zip64: false };
    const { bytes, view } = record(30 + entry.name.length);
    view.setUint32(0, SIG_LOCAL, true);
    view.setUint16(4, VERSION, true);
    view.setUint16(6, FLAGS, true);
    view.setUint16(8, method, true);
    view.setUint16(10, time, true);
    view.setUint16(12, date, true);
    // CRC-32, compressed and uncompressed size (14 to 25) stay zero: the data descriptor carries them.
    view.setUint16(26, entry.name.length, true);
    view.setUint16(28, 0, true);
    bytes.set(entry.name, 30);
    await write(bytes);
    return entry;
  }

  /** Writes the data descriptor once the entry's bytes are out, and keeps the entry for the central directory. */
  async function finish(entry: Entry): Promise<void> {
    // 8-byte sizes once the entry is ZIP64 (APPNOTE 4.3.9.2); 4-byte sizes otherwise, as readers that never saw ZIP64 expect.
    const wide = always || entry.size >= MAX32 || entry.compressed >= MAX32;
    const { bytes, view } = record(wide ? 24 : 16);
    view.setUint32(0, SIG_DESCRIPTOR, true);
    view.setUint32(4, entry.crc, true);
    if (wide) {
      setUint64(view, 8, entry.compressed);
      setUint64(view, 16, entry.size);
    } else {
      view.setUint32(8, entry.compressed, true);
      view.setUint32(12, entry.size, true);
    }
    await write(bytes);
    entries.push(entry);
  }

  /** The entry's central directory header, with a ZIP64 extra field for what does not fit in 32 bits. */
  function central(entry: Entry): Uint8Array {
    const sizeOver = always || entry.size >= MAX32;
    const compressedOver = always || entry.compressed >= MAX32;
    const offsetOver = always || entry.offset >= MAX32;
    // The fields of the extra appear only for the 32-bit fields that read 0xFFFFFFFF, always in this order.
    const wide = [...(sizeOver ? [entry.size] : []), ...(compressedOver ? [entry.compressed] : []), ...(offsetOver ? [entry.offset] : [])];
    entry.zip64 = wide.length > 0;
    const extra = wide.length > 0 ? 4 + 8 * wide.length : 0;
    const { bytes, view } = record(46 + entry.name.length + extra);
    view.setUint32(0, SIG_CENTRAL, true);
    view.setUint16(4, VERSION, true);
    view.setUint16(6, VERSION, true);
    view.setUint16(8, FLAGS, true);
    view.setUint16(10, entry.method, true);
    view.setUint16(12, time, true);
    view.setUint16(14, date, true);
    view.setUint32(16, entry.crc, true);
    view.setUint32(20, compressedOver ? MAX32 : entry.compressed, true);
    view.setUint32(24, sizeOver ? MAX32 : entry.size, true);
    view.setUint16(28, entry.name.length, true);
    view.setUint16(30, extra, true);
    // The comment length, the disk number and both attribute fields (32 to 41) stay zero.
    view.setUint32(42, offsetOver ? MAX32 : entry.offset, true);
    bytes.set(entry.name, 46);
    if (extra > 0) {
      const at = 46 + entry.name.length;
      view.setUint16(at, 0x0001, true);
      view.setUint16(at + 2, extra - 4, true);
      wide.forEach((value, i) => setUint64(view, at + 4 + 8 * i, value));
    }
    return bytes;
  }

  return {
    async addJsonPieces(name, pieces) {
      const entry = await begin(name, DEFLATED);
      const deflate = new Deflate({ level: 6 }, (chunk) => {
        entry.compressed += chunk.length;
        queued.push(chunk);
      });
      for await (const piece of pieces) {
        const bytes = encoder.encode(piece);
        for (let at = 0; at < bytes.length; at += PIECE_BYTES) {
          const part = bytes.subarray(at, at + PIECE_BYTES);
          entry.crc = crc32(part, entry.crc);
          entry.size += part.length;
          deflate.push(part);
          await drain();
          // Deflating is synchronous work on the event loop: every other request gets a turn between two feeds.
          await nextTurn();
        }
      }
      deflate.push(new Uint8Array(0), true);
      await drain();
      await finish(entry);
    },

    async addFile(name, open) {
      // The entry begins only once the file is open and checked: an entry cannot be taken back.
      const stored = await open();
      if (!stored) return false;
      const { handle, size } = stored;
      try {
        const entry = await begin(name, STORED);
        if (size > 0) {
          // Exactly the bytes the checked open measured, so a file that grows after the check adds nothing. The
          // stream closes the handle when it ends, and also when a throw below ends the loop and destroys it.
          const chunks = handle.createReadStream({ start: 0, end: size - 1, highWaterMark: CHUNK_BYTES }) as AsyncIterable<Uint8Array>;
          for await (const chunk of chunks) {
            entry.crc = crc32(chunk, entry.crc);
            entry.size += chunk.length;
            entry.compressed += chunk.length;
            await write(chunk);
          }
        }
        await finish(entry);
        return true;
      } finally {
        // A zero-byte file was never streamed, and a handle the stream closed already is closed again for nothing.
        await handle.close().catch(() => undefined);
      }
    },

    async end() {
      const directoryOffset = offset;
      // The directory goes out in chunks of about the size of a file chunk, not one write per entry.
      let batch: Uint8Array[] = [];
      let batched = 0;
      for (const entry of entries) {
        const header = central(entry);
        batch.push(header);
        batched += header.length;
        if (batched >= CHUNK_BYTES) {
          await write(Buffer.concat(batch));
          batch = [];
          batched = 0;
        }
      }
      if (batch.length > 0) await write(Buffer.concat(batch));
      const directorySize = offset - directoryOffset;
      const count = entries.length;

      const countOver = always || count >= MAX16;
      const sizeOver = always || directorySize >= MAX32;
      const offsetOver = always || directoryOffset >= MAX32;
      const tail: Uint8Array[] = [];
      if (countOver || sizeOver || offsetOver || entries.some((entry) => entry.zip64)) {
        const end64Offset = offset;
        const end64 = record(56);
        end64.view.setUint32(0, SIG_END64, true);
        // The size of the rest of the record, without this field and the signature.
        setUint64(end64.view, 4, 44);
        end64.view.setUint16(12, VERSION, true);
        end64.view.setUint16(14, VERSION, true);
        // This disk and the directory's disk (16 to 23) are disk 0: the archive is never split.
        setUint64(end64.view, 24, count);
        setUint64(end64.view, 32, count);
        setUint64(end64.view, 40, directorySize);
        setUint64(end64.view, 48, directoryOffset);
        const locator = record(20);
        locator.view.setUint32(0, SIG_LOCATOR64, true);
        setUint64(locator.view, 8, end64Offset);
        locator.view.setUint32(16, 1, true);
        tail.push(end64.bytes, locator.bytes);
      }
      const end = record(22);
      end.view.setUint32(0, SIG_END, true);
      end.view.setUint16(8, countOver ? MAX16 : count, true);
      end.view.setUint16(10, countOver ? MAX16 : count, true);
      end.view.setUint32(12, sizeOver ? MAX32 : directorySize, true);
      end.view.setUint32(16, offsetOver ? MAX32 : directoryOffset, true);
      tail.push(end.bytes);
      await write(Buffer.concat(tail));
    },
  };
}
