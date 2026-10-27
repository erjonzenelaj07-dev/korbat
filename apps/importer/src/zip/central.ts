import type { FileHandle } from "node:fs/promises";
import { IMPORT_RULES } from "@korbat/contracts";
import { ScanFailure } from "../adapters/types";
import type { ZipLimits } from "./limits";

/**
 * The zip reader's first three steps (3b design, 7.2; decision 2): the end of central directory record (and its ZIP64
 * record), then the central directory, each entry's name checked before any adapter sees it, directories and symbolic
 * links ignored, and every name filtered through the adapter's allowlist. Only allowlisted entries are kept; nothing of
 * the others is held, and the directory is read through a window, never whole.
 */

const END_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_END_SIGNATURE = 0x06064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_LENGTH = 22;
/** The end record and the longest comment it may carry. */
const END_SEARCH = END_LENGTH + 0xffff;
const MAX16 = 0xffff;
const MAX32 = 0xffffffff;
const FLAG_UTF8 = 1 << 11;
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const S_IFDIR = 0o040000;
const SLASH = 0x2f;
/** One read of the directory: enough for any entry (46 bytes and three fields of at most 65,535). */
const WINDOW_BYTES = 1_048_576;

/** Reads up to `length` bytes at `position`; fewer only at the end of the file. */
export async function readAt(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await handle.read(buffer, filled, length - filled, position + filled);
    if (bytesRead === 0) break;
    filled += bytesRead;
  }
  return filled === length ? buffer : buffer.subarray(0, filled);
}

/** A 64-bit field as a number: beyond 2^53 it is only ever compared with smaller limits, which it then fails. */
const big = (value: bigint) => Number(value);

export interface EndRecord {
  entries: number;
  directorySize: number;
  directoryOffset: number;
  /** Where the end records begin: the central directory must end at or before it. */
  endOffset: number;
}

const notAnArchive = () => new ScanFailure("not_an_archive");

/** Step 1: the end record in the file's last 65,557 bytes, and the ZIP64 records when its fields say so. */
export async function readEnd(handle: FileHandle, fileSize: number, limits: ZipLimits): Promise<EndRecord> {
  if (fileSize < END_LENGTH) throw notAnArchive();
  const tailLength = Math.min(fileSize, END_SEARCH);
  const tailStart = fileSize - tailLength;
  const tail = await readAt(handle, tailStart, tailLength);
  let at = -1;
  // The last record whose comment ends exactly at the end of the file: one whose comment runs past it is no record.
  for (let i = tail.length - END_LENGTH; i >= 0; i--) {
    if (tail.readUInt32LE(i) === END_SIGNATURE && i + END_LENGTH + tail.readUInt16LE(i + 20) === tail.length) {
      at = i;
      break;
    }
  }
  if (at < 0) throw notAnArchive();
  const end = tail.subarray(at, at + END_LENGTH);
  const disk = end.readUInt16LE(4);
  const directoryDisk = end.readUInt16LE(6);
  const onDisk = end.readUInt16LE(8);
  let entries = end.readUInt16LE(10);
  let directorySize = end.readUInt32LE(12);
  let directoryOffset = end.readUInt32LE(16);
  let endOffset = tailStart + at;
  if (disk !== 0 || directoryDisk !== 0 || onDisk !== entries) throw notAnArchive();

  if (entries === MAX16 || directorySize === MAX32 || directoryOffset === MAX32) {
    const locatorAt = endOffset - 20;
    if (locatorAt < 0) throw notAnArchive();
    const locator = await readAt(handle, locatorAt, 20);
    if (locator.length < 20 || locator.readUInt32LE(0) !== ZIP64_LOCATOR_SIGNATURE || locator.readUInt32LE(4) !== 0 || locator.readUInt32LE(16) > 1) throw notAnArchive();
    const recordAt = big(locator.readBigUInt64LE(8));
    if (recordAt + 56 > locatorAt) throw notAnArchive();
    const record = await readAt(handle, recordAt, 56);
    if (record.length < 56 || record.readUInt32LE(0) !== ZIP64_END_SIGNATURE || record.readUInt32LE(16) !== 0 || record.readUInt32LE(20) !== 0) throw notAnArchive();
    const onThisDisk = record.readBigUInt64LE(24);
    const total = record.readBigUInt64LE(32);
    if (onThisDisk !== total) throw notAnArchive();
    entries = big(total);
    directorySize = big(record.readBigUInt64LE(40));
    directoryOffset = big(record.readBigUInt64LE(48));
    endOffset = recordAt;
  }
  if (entries > limits.maxEntries || directorySize > limits.directoryMaxBytes) throw new ScanFailure("too_many_entries");
  if (directoryOffset + directorySize > endOffset) throw new ScanFailure("unreadable");
  return { entries, directorySize, directoryOffset, endOffset };
}

const UTF8 = new TextDecoder("utf-8", { fatal: true });
/** Any control character; the backslash of its pattern is built, so no source file carries one. */
const CONTROL = new RegExp(`${String.fromCharCode(92)}p{Cc}`, "u");
const DRIVE = /^[A-Za-z]:/;

/**
 * Step 2's checks of one entry name: at most `maxBytes` bytes of valid UTF-8 (or, with flag bit 11 clear, CP437 bytes
 * that are all ASCII); no NUL or other control character, no backslash, no drive letter, no leading slash, no `.` or
 * `..` segment and no empty one. Returns the name, or null for a name no allowlist rule may ever see.
 */
export function checkEntryName(raw: Uint8Array, utf8: boolean, maxBytes: number = IMPORT_RULES.zipNameMaxBytes): string | null {
  if (raw.length === 0 || raw.length > maxBytes) return null;
  let name: string;
  if (utf8) {
    try {
      name = UTF8.decode(raw);
    } catch {
      return null;
    }
  } else {
    if (raw.some((byte) => byte >= 0x80)) return null;
    name = Buffer.from(raw).toString("latin1");
  }
  if (CONTROL.test(name) || name.includes(String.fromCharCode(92)) || DRIVE.test(name) || name.startsWith("/")) return null;
  if (name.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) return null;
  return name;
}

/** A central entry the allowlist took. Sizes and the offset come from the ZIP64 extra field where the 32-bit fields are full. */
export interface CentralEntry {
  name: string;
  rawName: Buffer;
  flags: number;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  offset: number;
  /** Whether a ZIP64 extra field gave a size: a data descriptor then holds 64-bit sizes. */
  zip64: boolean;
}

export interface CentralDirectory {
  entries: CentralEntry[];
  /** Entries whose names failed the checks: never offered to the allowlist, never opened. */
  refusedNames: number;
}

export interface CentralOptions {
  allow: (name: string) => boolean;
  /** Tests: every name the allowlist was asked about. */
  onName?: (name: string) => void;
  limits: ZipLimits;
}

/** The ZIP64 extra field (0x0001): the 64-bit values of the fields whose 32-bit form is full, in their fixed order. */
function zip64Values(extra: Buffer, wanted: boolean[]): (number | undefined)[] {
  let at = 0;
  while (at + 4 <= extra.length) {
    const id = extra.readUInt16LE(at);
    const size = extra.readUInt16LE(at + 2);
    if (at + 4 + size > extra.length) break;
    if (id === 0x0001) {
      const values: (number | undefined)[] = [];
      let field = at + 4;
      for (const want of wanted) {
        if (!want) {
          values.push(undefined);
          continue;
        }
        if (field + 8 > at + 4 + size) throw new ScanFailure("unreadable");
        values.push(big(extra.readBigUInt64LE(field)));
        field += 8;
      }
      return values;
    }
    at += 4 + size;
  }
  if (wanted.some(Boolean)) throw new ScanFailure("unreadable");
  return wanted.map(() => undefined);
}

/** Step 2 and 3: the central directory through a window, each entry checked, only allowlisted ones kept. */
export async function readCentral(handle: FileHandle, end: EndRecord, options: CentralOptions): Promise<CentralDirectory> {
  const entries: CentralEntry[] = [];
  const seen = new Set<string>();
  let refusedNames = 0;
  let window: Buffer = Buffer.alloc(0);
  let windowStart = end.directoryOffset;
  let position = end.directoryOffset;
  const stop = end.directoryOffset + end.directorySize;

  /** The next `length` bytes of the directory; an entry that runs past the declared directory is unreadable. */
  const take = async (length: number): Promise<Buffer> => {
    if (position + length > stop) throw new ScanFailure("unreadable");
    if (position + length > windowStart + window.length) {
      windowStart = position;
      window = await readAt(handle, position, Math.min(Math.max(length, WINDOW_BYTES), stop - position));
      if (window.length < length) throw new ScanFailure("unreadable");
    }
    const out = window.subarray(position - windowStart, position - windowStart + length);
    position += length;
    return out;
  };

  for (let index = 0; index < end.entries; index++) {
    const head = await take(46);
    if (head.readUInt32LE(0) !== CENTRAL_SIGNATURE) throw new ScanFailure("unreadable");
    const flags = head.readUInt16LE(8);
    const method = head.readUInt16LE(10);
    const crc = head.readUInt32LE(16);
    const compressed32 = head.readUInt32LE(20);
    const uncompressed32 = head.readUInt32LE(24);
    const nameLength = head.readUInt16LE(28);
    const extraLength = head.readUInt16LE(30);
    const commentLength = head.readUInt16LE(32);
    const startDisk = head.readUInt16LE(34);
    const mode = head.readUInt32LE(38) >>> 16;
    const offset32 = head.readUInt32LE(42);
    const rawName = Buffer.from(await take(nameLength));
    const extra = Buffer.from(await take(extraLength));
    await take(commentLength);

    // A directory or a symbolic link is ignored and never opened, whatever its name.
    if (rawName.at(-1) === SLASH || (mode & S_IFMT) === S_IFDIR || (mode & S_IFMT) === S_IFLNK) continue;
    const name = checkEntryName(rawName, (flags & FLAG_UTF8) !== 0, options.limits.nameMaxBytes);
    if (name === null) {
      refusedNames++;
      continue;
    }
    options.onName?.(name);
    if (!options.allow(name)) continue;
    // Two central entries with one allowlisted name: a reader that takes either could be steered.
    if (seen.has(name)) throw new ScanFailure("bad_entry_name");
    seen.add(name);
    if (startDisk !== 0 && startDisk !== MAX16) throw new ScanFailure("unreadable");
    const [uncompressed, compressed, offset] = zip64Values(extra, [uncompressed32 === MAX32, compressed32 === MAX32, offset32 === MAX32]);
    entries.push({
      name,
      rawName,
      flags,
      method,
      crc,
      compressedSize: compressed ?? compressed32,
      uncompressedSize: uncompressed ?? uncompressed32,
      offset: offset ?? offset32,
      zip64: uncompressed !== undefined || compressed !== undefined,
    });
  }
  return { entries, refusedNames };
}
