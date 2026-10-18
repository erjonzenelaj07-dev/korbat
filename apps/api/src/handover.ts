/**
 * The hand-over of one seal's files (3f design, sections 5 and 7.14 step 2; section 2 row 34): an entry point of its
 * own, dist/handover.js, run by the operator alone as the one-shot Compose service `handover`:
 *
 *   docker compose --profile handover run --rm -T -v <directory>:/handover handover < list > digests
 *
 * The list is what `staff.js handover-list` printed: a first line "production <id>", then one stored name a line. The
 * program refuses a name outside the store's layout, copies each listed file byte for byte into one zip of stored
 * entries, /handover/handover-<production>.zip, and prints each file's name, size and SHA-256, then the archive's, which
 * `staff.js handover-record` stores. It decodes nothing and shows nothing. A missing file, or anything that is not a plain
 * file of the store, ends it with exit 1 and no archive.
 *
 * It opens no database and no socket, and imports no module of the API: the service has no network, mounts the image
 * store read-only, and holds no credential, so the program that reads sealed files can send them nowhere, and the
 * database's most privileged role never mounts the store. It keeps its own copy of the store's naming rule (the media
 * module's storedImageName); a unit test feeds both the same names and fails when they differ.
 */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { link, open, unlink, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { crc32 } from "node:zlib";

/** Where the service mounts the image store, read-only, and the operator's directory for the archive. */
export const HANDOVER_STORE = "/media/store";
export const HANDOVER_OUT = "/handover";

/** The sizes the worker stores of every image, as the contracts' MEDIA_SIZES lists them. */
const SIZES = ["small", "large"] as const;
const MEDIA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const PRODUCTION_LINE = /^production ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/**
 * This program's copy of the store's naming rule (the media module's storedImageName): where the worker keeps one size of
 * an image, relative to the store's root, with forward slashes: files/<aa>/<id>/<size>.webp.
 */
export function storedName(id: string, size: (typeof SIZES)[number]): string {
  if (!MEDIA_ID.test(id)) throw new TypeError("not a media id");
  return `files/${id.slice(0, 2)}/${id}/${size}.webp`;
}

/** Whether a name is one the rule makes: anything else is outside the store's layout and is never opened. */
export function isStoredName(name: string): boolean {
  const parts = name.split("/");
  if (parts.length !== 4) return false;
  const [, , id, file] = parts;
  const size = SIZES.find((s) => file === `${s}.webp`);
  return size !== undefined && MEDIA_ID.test(id!) && storedName(id!, size) === name;
}

/** The fields of one stored entry of the archive. */
interface Entry {
  name: Buffer;
  data: Buffer;
  crc: number;
  offset: number;
}

/** The archive's limits without ZIP64: a seal's files are a few images, far below them; beyond them the copy is refused. */
const MAX_ENTRIES = 0xffff;
const MAX_BYTES = 0xfffffffe;
/** 1980-01-01 00:00, the earliest time a ZIP entry can carry: the archive says nothing about when it was made. */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
/** Bit 11: the name is UTF-8. */
const FLAGS = 0x0800;

/**
 * One ZIP archive of stored entries (method 0, no compression), the bytes of each file exactly as given, in the order
 * given: a local header and the data for each, then the central directory and its end record. Sizes and CRC-32s are
 * known before each header is written, so no data descriptor follows the data.
 */
export function zipStored(files: readonly { name: string; data: Buffer }[]): Buffer {
  if (files.length > MAX_ENTRIES) throw new Error("too many files for one archive");
  const parts: Buffer[] = [];
  const entries: Entry[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const entry: Entry = { name, data: file.data, crc: crc32(file.data), offset };
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(10, 4);
    header.writeUInt16LE(FLAGS, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(DOS_TIME, 10);
    header.writeUInt16LE(DOS_DATE, 12);
    header.writeUInt32LE(entry.crc, 14);
    header.writeUInt32LE(file.data.length, 18);
    header.writeUInt32LE(file.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);
    parts.push(header, name, file.data);
    entries.push(entry);
    offset += header.length + name.length + file.data.length;
    if (offset > MAX_BYTES) throw new Error("the files are too large for one archive");
  }
  const directoryStart = offset;
  for (const entry of entries) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(10, 6);
    header.writeUInt16LE(FLAGS, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(DOS_TIME, 12);
    header.writeUInt16LE(DOS_DATE, 14);
    header.writeUInt32LE(entry.crc, 16);
    header.writeUInt32LE(entry.data.length, 20);
    header.writeUInt32LE(entry.data.length, 24);
    header.writeUInt16LE(entry.name.length, 28);
    // Extra field, comment, disk number, internal and external attributes: none.
    header.writeUInt32LE(entry.offset, 42);
    parts.push(header, entry.name);
    offset += header.length + entry.name.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(offset - directoryStart, 12);
  end.writeUInt32LE(directoryStart, 16);
  parts.push(end);
  if (offset + end.length > MAX_BYTES) throw new Error("the files are too large for one archive");
  return Buffer.concat(parts);
}

/** Follows no symlink at the last path component where the platform can say so, and never waits on a FIFO. */
const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

/** The bytes of a plain file of the store, or null for anything else (missing, a directory, a link, a device). */
async function readStored(store: string, name: string): Promise<Buffer | null> {
  let handle;
  try {
    handle = await open(path.join(store, ...name.split("/")), READ_FLAGS);
  } catch {
    return null;
  }
  try {
    if (!(await handle.stat()).isFile()) return null;
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

export interface HandoverOptions {
  /** The list on standard input. */
  input: string;
  store: string;
  out: string;
  log: (line: string) => void;
  error: (line: string) => void;
  /** Writes the archive's bytes into the new file; the file handle's own write unless a test passes one that fails. */
  writeArchive?: (file: FileHandle, data: Buffer) => Promise<void>;
}

/** Runs one hand-over and answers its exit code: 0 with the archive written and its digests printed, 1 with nothing written. */
export async function runHandover(options: HandoverOptions): Promise<number> {
  // Lines end in a line feed, or in a carriage return and a line feed, as a file saved on Windows does.
  const lines = options.input.split(LF).map((line) => (line.endsWith(CR) ? line.slice(0, -1) : line)).filter((line) => line !== "");
  const first = PRODUCTION_LINE.exec(lines[0] ?? "");
  if (!first) {
    options.error("handover: refused: the list's first line is not the production handover-list printed");
    return 1;
  }
  const names = lines.slice(1);
  if (names.length === 0) {
    options.error("handover: refused: the list names no file");
    return 1;
  }
  for (const name of names) {
    if (!isStoredName(name)) {
      options.error(`handover: refused: ${JSON.stringify(name)} is outside the store`);
      return 1;
    }
  }
  if (new Set(names).size !== names.length) {
    options.error("handover: refused: the list names a file twice");
    return 1;
  }
  // Every file is read before anything is written: a missing one leaves no archive behind.
  const files: { name: string; data: Buffer }[] = [];
  for (const name of names) {
    const data = await readStored(options.store, name);
    if (data === null) {
      options.error(`handover: ${name} is missing or is not a plain file of the store; no archive was written`);
      return 1;
    }
    files.push({ name, data });
  }
  let archive: Buffer;
  try {
    archive = zipStored(files);
  } catch (err) {
    options.error(`handover: ${(err as Error).message}; no archive was written`);
    return 1;
  }
  const target = path.join(options.out, `handover-${first[1]}.zip`);
  const name = path.basename(target);
  // 3f's review (operations7): the archive is written to <name>.part, a new file only, readable by its owner alone, and
  // given its name only once it is whole, by a link that never replaces a file. A write that fails halfway (a full disk)
  // deletes what it wrote, so no part of the sealed files stays behind unrecorded; and the message says so, or names the
  // file to delete when even that failed.
  const part = `${target}.part`;
  const earlier = `handover: ${name} or ${name}.part exists from an earlier run; it may be incomplete and holds the files it lists: delete it before running again; no archive was written`;
  let file: FileHandle;
  try {
    file = await open(part, "wx", 0o600);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    options.error(code === "EEXIST" ? earlier : `handover: ${name} could not be written (${code ?? "error"}); no archive was written`);
    return 1;
  }
  try {
    await (options.writeArchive ?? ((handle, data) => handle.writeFile(data)))(file, archive);
    await file.sync();
    await file.close();
    await link(part, target);
  } catch (err) {
    await file.close().catch(() => undefined);
    const code = (err as NodeJS.ErrnoException).code;
    const removed = await unlink(part).then(
      () => true,
      () => false,
    );
    const left = removed ? "what was written of it was deleted" : `what was written of it could not be deleted: delete ${name}.part by hand`;
    options.error(code === "EEXIST" ? `${earlier.replace("; no archive was written", "")}; ${left}` : `handover: ${name} could not be written (${code ?? "error"}); ${left}, and no archive was written`);
    return 1;
  }
  // The archive is whole under its name; its second name goes, or the operator is told to delete it with the archive.
  if (!(await unlink(part).then(
    () => true,
    () => false,
  ))) {
    options.error(`handover: ${name}.part, a second name of the archive, could not be deleted: delete it by hand when the archive is destroyed`);
  }
  for (const file of files) options.log(`${file.name} ${file.data.length} ${sha256(file.data)}`);
  options.log(`archive ${archive.length} ${sha256(archive)}`);
  return 0;
}

/** Everything on standard input. */
async function readInput(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  return Buffer.concat(chunks).toString("utf8");
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  void readInput()
    .then((input) => runHandover({ input, store: HANDOVER_STORE, out: HANDOVER_OUT, log: (line) => console.log(line), error: (line) => console.error(line) }))
    .then((code) => {
      process.exitCode = code;
    });
}
