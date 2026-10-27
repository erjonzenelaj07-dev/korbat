import { crc32, deflateRawSync } from "node:zlib";

/**
 * A small zip writer for the importer's tests (3b design, section 12.1), after korbat's own writer in
 * apps/api/src/account/zip.ts but never imported from it (an app imports no other app). It writes stored and deflated
 * entries, ZIP64 records on demand, and has a switch for every crafted case the zip reader must refuse or ignore, so
 * that no test reads an archive it did not build.
 */

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const ZIP64_END_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const DESCRIPTOR_SIGNATURE = 0x08074b50;
const MAX32 = 0xffffffff;
const MAX16 = 0xffff;
const FLAG_ENCRYPTED = 1;
const FLAG_DESCRIPTOR = 1 << 3;
const FLAG_UTF8 = 1 << 11;
/** "Made by" Unix (3), version 3.0: the high half of the external attributes then holds the file's mode. */
const MADE_BY_UNIX = (3 << 8) | 30;
const S_IFLNK = 0o120000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;

export interface ZipItem {
  /** The entry's name, or its raw bytes (for a NUL or bytes that are not UTF-8). */
  name: string | Buffer;
  data: Buffer | string;
  /** 0 stored, 8 deflated (the default), 12 bzip2: declared only, the bytes are stored. */
  method?: 0 | 8 | 12;
  /** Flag bit 0, as an encrypting writer sets it. */
  encrypted?: boolean;
  /** A symbolic link entry (mode 0o120777 in the external attributes): its data is the link's target. */
  symlink?: boolean;
  /** A directory entry; give it a name with a trailing slash. */
  directory?: boolean;
  /** Flag bit 3: zero CRC and sizes in the local header, a data descriptor (with its signature) after the data. */
  dataDescriptor?: boolean;
  /** 0xFFFFFFFF sizes in the local header with a ZIP64 extra field holding the real ones. */
  zip64Local?: boolean;
  /** Both headers carry a CRC that is not the data's. */
  badCrc?: boolean;
  /** Both headers declare this uncompressed size instead of the real one: a size that lies. */
  declaredSize?: number;
  /** Both headers declare this compressed size instead of the real one. */
  declaredCompressed?: number;
  /** The local header's name, when it should differ from the central one. */
  localName?: string;
  /** The local header's method, when it should differ from the central one. */
  localMethod?: number;
  /** Clear flag bit 11 (UTF-8): the name is then CP437 by the format. */
  cp437?: boolean;
  /** This entry's local record lies inside the previous entry's stored data: the overlapping-files case. */
  nestInPrevious?: boolean;
}

export interface ZipOptions {
  /** Write the ZIP64 end records, and ZIP64 extras in every central entry. */
  zip64?: boolean;
  /** List the entry at this index twice in the central directory. */
  duplicateCentral?: number;
  /** The archive comment. */
  comment?: Buffer;
  /** Declare a comment this much longer than the one written: a comment that runs past the end. */
  commentOverrun?: number;
  /** The end record's disk numbers. */
  disk?: number;
  /** Override the end record's entry count (and the ZIP64 record's). */
  entriesDeclared?: number;
  /** Override the central directory's offset in the end records. */
  directoryOffset?: number;
  /** Override the central directory's size in the end records. */
  directorySize?: number;
}

const toBuffer = (value: Buffer | string) => (typeof value === "string" ? Buffer.from(value, "utf8") : value);

function zip64Extra(values: readonly number[]): Buffer {
  const extra = Buffer.alloc(4 + values.length * 8);
  extra.writeUInt16LE(0x0001, 0);
  extra.writeUInt16LE(values.length * 8, 2);
  values.forEach((value, index) => extra.writeBigUInt64LE(BigInt(value), 4 + index * 8));
  return extra;
}

interface Prepared {
  item: ZipItem;
  name: Buffer;
  localName: Buffer;
  compressed: Buffer;
  crc: number;
  size: number;
  compressedSize: number;
  flags: number;
  method: number;
  record: Buffer;
  offset: number;
}

function localRecord(p: Omit<Prepared, "record" | "offset">): Buffer {
  const { item } = p;
  const descriptor = item.dataDescriptor === true;
  const zip64 = item.zip64Local === true;
  const extra = zip64 ? zip64Extra([p.size, p.compressedSize]) : Buffer.alloc(0);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(LOCAL_SIGNATURE, 0);
  header.writeUInt16LE(zip64 ? 45 : 20, 4);
  header.writeUInt16LE(p.flags, 6);
  header.writeUInt16LE(item.localMethod ?? p.method, 8);
  header.writeUInt32LE(0, 10);
  header.writeUInt32LE(descriptor ? 0 : p.crc, 14);
  header.writeUInt32LE(descriptor ? 0 : zip64 ? MAX32 : p.compressedSize, 18);
  header.writeUInt32LE(descriptor ? 0 : zip64 ? MAX32 : p.size, 22);
  header.writeUInt16LE(p.localName.length, 26);
  header.writeUInt16LE(extra.length, 28);
  const parts = [header, p.localName, extra, p.compressed];
  if (descriptor) {
    const tail = Buffer.alloc(16);
    tail.writeUInt32LE(DESCRIPTOR_SIGNATURE, 0);
    tail.writeUInt32LE(p.crc, 4);
    tail.writeUInt32LE(p.compressedSize, 8);
    tail.writeUInt32LE(p.size, 12);
    parts.push(tail);
  }
  return Buffer.concat(parts);
}

function prepare(item: ZipItem): Omit<Prepared, "record" | "offset"> {
  const name = toBuffer(item.name);
  const data = toBuffer(item.data);
  const method = item.method ?? 8;
  const compressed = method === 8 ? deflateRawSync(data) : data;
  let flags = item.cp437 === true ? 0 : FLAG_UTF8;
  if (item.encrypted === true) flags |= FLAG_ENCRYPTED;
  if (item.dataDescriptor === true) flags |= FLAG_DESCRIPTOR;
  const realCrc = crc32(data);
  return {
    item,
    name,
    localName: item.localName === undefined ? name : Buffer.from(item.localName, "utf8"),
    compressed,
    crc: item.badCrc === true ? (realCrc ^ 0x5a5a5a5a) >>> 0 : realCrc,
    size: item.declaredSize ?? data.length,
    compressedSize: item.declaredCompressed ?? compressed.length,
    flags,
    method,
  };
}

function centralRecord(p: Prepared, zip64: boolean): Buffer {
  const { item } = p;
  const extra = zip64 ? zip64Extra([p.size, p.compressedSize, p.offset]) : Buffer.alloc(0);
  const header = Buffer.alloc(46);
  header.writeUInt32LE(CENTRAL_SIGNATURE, 0);
  header.writeUInt16LE(MADE_BY_UNIX, 4);
  header.writeUInt16LE(zip64 ? 45 : 20, 6);
  header.writeUInt16LE(p.flags, 8);
  header.writeUInt16LE(p.method, 10);
  header.writeUInt32LE(0, 12);
  header.writeUInt32LE(p.crc, 16);
  header.writeUInt32LE(zip64 ? MAX32 : p.compressedSize, 20);
  header.writeUInt32LE(zip64 ? MAX32 : p.size, 24);
  header.writeUInt16LE(p.name.length, 28);
  header.writeUInt16LE(extra.length, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  const mode = item.symlink === true ? S_IFLNK | 0o777 : item.directory === true ? S_IFDIR | 0o755 : S_IFREG | 0o644;
  header.writeUInt32LE((mode << 16) >>> 0, 38);
  header.writeUInt32LE(zip64 ? MAX32 : p.offset, 42);
  return Buffer.concat([header, p.name, extra]);
}

/** The archive's bytes. */
export function buildZip(items: readonly ZipItem[], options: ZipOptions = {}): Buffer {
  const prepared: Prepared[] = [];
  const body: Buffer[] = [];
  let offset = 0;
  for (const item of items) {
    const base = prepare(item);
    const previous = prepared.at(-1);
    if (item.nestInPrevious === true && previous) {
      // The previous entry becomes a stored entry whose data quotes this entry's whole record, which is then not
      // written again: both central entries point into one range of the file.
      const record = localRecord(base);
      const quoted = Buffer.concat([toBuffer(previous.item.data), record]);
      const outer = prepare({ ...previous.item, data: quoted, method: 0 });
      const outerRecord = localRecord(outer);
      offset -= previous.record.length;
      body.pop();
      const rebuilt: Prepared = { ...outer, record: outerRecord, offset };
      prepared[prepared.length - 1] = rebuilt;
      const inner = offset + 30 + outer.localName.length + toBuffer(previous.item.data).length;
      prepared.push({ ...base, record, offset: inner });
      body.push(outerRecord);
      offset += outerRecord.length;
      continue;
    }
    const record = localRecord(base);
    prepared.push({ ...base, record, offset });
    body.push(record);
    offset += record.length;
  }
  const zip64 = options.zip64 === true;
  const listed = [...prepared];
  if (options.duplicateCentral !== undefined) listed.push(prepared[options.duplicateCentral]!);
  const central = Buffer.concat(listed.map((p) => centralRecord(p, zip64)));
  const directoryOffset = options.directoryOffset ?? offset;
  const count = options.entriesDeclared ?? listed.length;
  const tail: Buffer[] = [];
  if (zip64) {
    const record = Buffer.alloc(56);
    record.writeUInt32LE(ZIP64_END_SIGNATURE, 0);
    record.writeBigUInt64LE(44n, 4);
    record.writeUInt16LE(45, 12);
    record.writeUInt16LE(45, 14);
    record.writeUInt32LE(options.disk ?? 0, 16);
    record.writeUInt32LE(options.disk ?? 0, 20);
    record.writeBigUInt64LE(BigInt(count), 24);
    record.writeBigUInt64LE(BigInt(count), 32);
    record.writeBigUInt64LE(BigInt(options.directorySize ?? central.length), 40);
    record.writeBigUInt64LE(BigInt(directoryOffset), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(ZIP64_LOCATOR_SIGNATURE, 0);
    locator.writeUInt32LE(0, 4);
    locator.writeBigUInt64LE(BigInt(offset + central.length), 8);
    locator.writeUInt32LE(1, 16);
    tail.push(record, locator);
  }
  const comment = options.comment ?? Buffer.alloc(0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_SIGNATURE, 0);
  end.writeUInt16LE(options.disk ?? 0, 4);
  end.writeUInt16LE(options.disk ?? 0, 6);
  end.writeUInt16LE(zip64 ? MAX16 : Math.min(count, MAX16), 8);
  end.writeUInt16LE(zip64 ? MAX16 : Math.min(count, MAX16), 10);
  end.writeUInt32LE(zip64 ? MAX32 : (options.directorySize ?? central.length), 12);
  end.writeUInt32LE(zip64 ? MAX32 : directoryOffset, 16);
  end.writeUInt16LE(comment.length + (options.commentOverrun ?? 0), 20);
  return Buffer.concat([...body, central, ...tail, end, comment]);
}

/** A buffer of pseudo-random bytes from a seed, which deflate cannot shrink: image stand-ins and incompressible data. */
export function noise(length: number, seed = 1): Buffer {
  const out = Buffer.alloc(length);
  let state = seed >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    out[i] = state & 0xff;
  }
  return out;
}

/** The first bytes of each image type the importer takes, then noise: enough for its check of the file's type. */
export function fakeImage(kind: "jpg" | "png" | "webp" | "gif", length = 2_048, seed = 7): Buffer {
  const rest = noise(length, seed);
  if (kind === "jpg") return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), rest]);
  if (kind === "png") return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), rest]);
  if (kind === "webp") {
    const head = Buffer.alloc(12);
    head.write("RIFF", 0, "latin1");
    head.writeUInt32LE(length + 4, 4);
    head.write("WEBP", 8, "latin1");
    return Buffer.concat([head, rest]);
  }
  return Buffer.concat([Buffer.from("GIF89a", "latin1"), rest]);
}
