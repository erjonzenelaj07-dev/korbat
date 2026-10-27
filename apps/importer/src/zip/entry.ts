import type { FileHandle } from "node:fs/promises";
import { Readable } from "node:stream";
import { createInflateRaw, crc32 } from "node:zlib";
import type { ImportFailure } from "@korbat/contracts";
import { ScanFailure, isAllowed, isListed, type ArchiveEntry, type EntryRule, type ZipArchive } from "../adapters/types";
import { readCentral, readEnd } from "./central";
import { ZIP_LIMITS, checkEntries, type ZipEntry, type ZipLimits } from "./limits";

export type { ZipArchive } from "../adapters/types";
export type { ZipLimits } from "./limits";

/**
 * The zip reader (3b design, 7.2; decision 2), korbat's own: the end record, the central directory filtered through the
 * adapter's allowlist, the adapter's detect, every limit, and then entries opened one at a time. An entry streams
 * straight into its reader: nothing is ever extracted to a path built from an entry name. Inflating uses node:zlib's
 * raw inflater, counts its output and stops one byte over the central size, and checks the CRC-32 at the end. A zlib
 * error's message is never kept (it can quote the input): every failure is the code `unreadable`.
 */

/** How much of the file one read takes, and how much of it the inflater gets at once (deflate expands at most about 1,032 to 1). */
const READ_BYTES = 65_536;
const FEED_BYTES = 16_384;

async function* compressedSlices(handle: FileHandle, start: number, length: number): AsyncGenerator<Buffer> {
  let position = start;
  const end = start + length;
  while (position < end) {
    const want = Math.min(READ_BYTES, end - position);
    const buffer = Buffer.alloc(want);
    const { bytesRead } = await handle.read(buffer, 0, want, position);
    if (bytesRead === 0) throw new ScanFailure("unreadable");
    for (let at = 0; at < bytesRead; at += FEED_BYTES) yield buffer.subarray(at, Math.min(at + FEED_BYTES, bytesRead));
    position += bytesRead;
  }
}

async function* inflated(handle: FileHandle, entry: ZipEntry): AsyncGenerator<Buffer> {
  const source = Readable.from(compressedSlices(handle, entry.dataStart, entry.compressedSize), { objectMode: false });
  const inflater = createInflateRaw({ chunkSize: FEED_BYTES });
  source.on("error", (err) => inflater.destroy(err));
  source.pipe(inflater);
  try {
    for await (const chunk of inflater) yield chunk as Buffer;
  } finally {
    source.unpipe(inflater);
    source.destroy();
    inflater.destroy();
  }
}

/** One entry's bytes, inflated and checked: at most its central size, and its CRC-32 at the end. */
export async function* readEntry(handle: FileHandle, entry: ZipEntry): AsyncGenerator<Buffer> {
  let total = 0;
  let crc = 0;
  const chunks = entry.method === 0 ? compressedSlices(handle, entry.dataStart, entry.compressedSize) : inflated(handle, entry);
  try {
    for await (const chunk of chunks) {
      total += chunk.length;
      if (total > entry.uncompressedSize) throw new ScanFailure("unreadable");
      crc = crc32(chunk, crc);
      yield chunk;
    }
  } catch (err) {
    throw err instanceof ScanFailure ? err : new ScanFailure("unreadable");
  }
  if (total !== entry.uncompressedSize || crc !== entry.crc) throw new ScanFailure("unreadable");
}

export interface OpenZipOptions {
  rules: readonly EntryRule[];
  images: boolean;
  /** Tests only: smaller limits than IMPORT_RULES's. */
  limits?: Partial<ZipLimits> | undefined;
  /** Tests only: every well-formed name offered to the allowlist. */
  onName?: (name: string) => void;
  /** The adapter's detect, run on the allowlisted names and sizes before any entry is checked further or opened. */
  detect?: (entries: readonly ArchiveEntry[]) => ImportFailure | null;
}

/** Steps 1 to 5 of 7.2 on an open file: the allowlisted entries, checked, ready to open one at a time. */
export async function openZip(handle: FileHandle, fileSize: number, options: OpenZipOptions): Promise<ZipArchive> {
  const limits: ZipLimits = { ...ZIP_LIMITS, ...options.limits };
  const end = await readEnd(handle, fileSize, limits);
  const allow = (name: string) => isAllowed(options.rules, name, options.images) || isListed(options.rules, name);
  const central = await readCentral(handle, end, { allow, onName: options.onName, limits });
  const listed: ArchiveEntry[] = central.entries.map((entry) => ({ name: entry.name, size: entry.uncompressedSize }));
  const refusal = options.detect?.(listed) ?? null;
  if (refusal) throw new ScanFailure(refusal);
  // A name listed for detect only is never checked further or opened. An entry an images rule took is an image; every
  // other is a data file.
  const openable = central.entries.filter((entry) => isAllowed(options.rules, entry.name, options.images));
  const dataRules = options.rules.filter((rule) => rule.images !== true);
  const isImage = (name: string) => !isAllowed(dataRules, name, false);
  const entries = await checkEntries(handle, end.directoryOffset, openable, isImage, limits);
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  return {
    kind: "zip",
    entries: listed,
    refusedNames: central.refusedNames,
    has: (name) => byName.has(name),
    size: (name) => byName.get(name)?.uncompressedSize,
    open: (name) => {
      const entry = byName.get(name);
      // Only an allowlisted entry can be opened: any other name is a bug of the caller, never a file.
      if (!entry) throw new Error("not an allowlisted entry");
      return readEntry(handle, entry);
    },
  };
}
