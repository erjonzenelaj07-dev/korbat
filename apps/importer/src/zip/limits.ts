import type { FileHandle } from "node:fs/promises";
import { IMPORT_RULES } from "@korbat/contracts";
import { ScanFailure } from "../adapters/types";
import { readAt, type CentralEntry } from "./central";

/**
 * The zip reader's limits (3b design, 7.2 steps 4 and 5's local checks), every number from IMPORT_RULES. Only
 * allowlisted entries are checked, all before any is opened: encryption, the method, the sizes, the ratio, each
 * entry's local header against its central entry, its data range inside the file and apart from every other
 * allowlisted entry's (the overlapping-files bomb), and the sum of their sizes.
 */

export interface ZipLimits {
  maxEntries: number;
  directoryMaxBytes: number;
  nameMaxBytes: number;
  /** A data file's uncompressed size. An image is not held to it: the core counts one over 20 MiB too_large, unopened. */
  dataMaxBytes: number;
  maxRatio: number;
  totalMaxBytes: number;
}

export const ZIP_LIMITS: Readonly<ZipLimits> = {
  maxEntries: IMPORT_RULES.zipMaxEntries,
  directoryMaxBytes: IMPORT_RULES.zipDirectoryMaxBytes,
  nameMaxBytes: IMPORT_RULES.zipNameMaxBytes,
  dataMaxBytes: IMPORT_RULES.zipDataMaxBytes,
  maxRatio: IMPORT_RULES.zipMaxRatio,
  totalMaxBytes: IMPORT_RULES.zipTotalMaxBytes,
};

const LOCAL_SIGNATURE = 0x04034b50;
const DESCRIPTOR_SIGNATURE = 0x08074b50;
const MAX32 = 0xffffffff;
const FLAG_ENCRYPTED = 1;
const FLAG_DESCRIPTOR = 1 << 3;
const STORED = 0;
const DEFLATED = 8;

/** An allowlisted entry that passed every check, with where its data starts. */
export interface ZipEntry extends CentralEntry {
  dataStart: number;
}

/** The ZIP64 extra field of a local header: its uncompressed and compressed sizes. */
function localZip64(extra: Buffer): [number, number] | null {
  let at = 0;
  while (at + 4 <= extra.length) {
    const id = extra.readUInt16LE(at);
    const size = extra.readUInt16LE(at + 2);
    if (id === 0x0001 && size >= 16 && at + 4 + size <= extra.length) {
      return [Number(extra.readBigUInt64LE(at + 4)), Number(extra.readBigUInt64LE(at + 12))];
    }
    at += 4 + size;
  }
  return null;
}

/**
 * Checks every allowlisted entry and returns them with their data's start. `isImage` names the entries an images rule
 * took. Throws the failure of the first entry that fails.
 */
export async function checkEntries(handle: FileHandle, directoryOffset: number, entries: readonly CentralEntry[], isImage: (name: string) => boolean, limits: ZipLimits): Promise<ZipEntry[]> {
  let total = 0;
  for (const entry of entries) {
    if ((entry.flags & FLAG_ENCRYPTED) !== 0) throw new ScanFailure("encrypted");
    if (entry.method !== STORED && entry.method !== DEFLATED) throw new ScanFailure("unreadable");
    if (!isImage(entry.name) && entry.uncompressedSize > limits.dataMaxBytes) throw new ScanFailure("too_large_uncompressed");
    // The ratio of one entry; nothing that inflates to something from nothing passes.
    if (entry.compressedSize === 0 ? entry.uncompressedSize > 0 : entry.uncompressedSize / entry.compressedSize > limits.maxRatio) {
      throw new ScanFailure("too_large_uncompressed");
    }
    if (entry.method === STORED && entry.compressedSize !== entry.uncompressedSize) throw new ScanFailure("unreadable");
    total += entry.uncompressedSize;
    if (total > limits.totalMaxBytes) throw new ScanFailure("too_large_uncompressed");
  }

  const checked: ZipEntry[] = [];
  const ranges: [number, number][] = [];
  for (const entry of entries) {
    if (entry.offset + 30 > directoryOffset) throw new ScanFailure("unreadable");
    const head = await readAt(handle, entry.offset, 30);
    if (head.length < 30 || head.readUInt32LE(0) !== LOCAL_SIGNATURE) throw new ScanFailure("unreadable");
    const flags = head.readUInt16LE(6);
    const method = head.readUInt16LE(8);
    const nameLength = head.readUInt16LE(26);
    const extraLength = head.readUInt16LE(28);
    if (method !== entry.method || (flags & FLAG_ENCRYPTED) !== (entry.flags & FLAG_ENCRYPTED)) throw new ScanFailure("unreadable");
    const rest = await readAt(handle, entry.offset + 30, nameLength + extraLength);
    if (rest.length < nameLength + extraLength || !rest.subarray(0, nameLength).equals(entry.rawName)) throw new ScanFailure("unreadable");
    const descriptor = (entry.flags & FLAG_DESCRIPTOR) !== 0;
    let zip64 = entry.zip64;
    if (!descriptor) {
      // Without a data descriptor the local header must say what the central entry says.
      let compressed = head.readUInt32LE(18);
      let uncompressed = head.readUInt32LE(22);
      if (compressed === MAX32 || uncompressed === MAX32) {
        const sizes = localZip64(rest.subarray(nameLength));
        if (!sizes) throw new ScanFailure("unreadable");
        [uncompressed, compressed] = sizes;
        zip64 = true;
      }
      if (head.readUInt32LE(14) !== entry.crc || compressed !== entry.compressedSize || uncompressed !== entry.uncompressedSize) throw new ScanFailure("unreadable");
    }
    const dataStart = entry.offset + 30 + nameLength + extraLength;
    let recordEnd = dataStart + entry.compressedSize;
    if (descriptor) {
      // The descriptor's own length (12, 16, 20 or 24 bytes) counts in the range the overlap check compares.
      const signature = await readAt(handle, recordEnd, 4);
      const signed = signature.length === 4 && signature.readUInt32LE(0) === DESCRIPTOR_SIGNATURE;
      recordEnd += (signed ? 4 : 0) + (zip64 ? 20 : 12);
    }
    if (recordEnd > directoryOffset) throw new ScanFailure("unreadable");
    ranges.push([entry.offset, recordEnd]);
    checked.push({ ...entry, dataStart });
  }
  ranges.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i++) if (ranges[i]![0] < ranges[i - 1]![1]) throw new ScanFailure("unreadable");
  return checked;
}
