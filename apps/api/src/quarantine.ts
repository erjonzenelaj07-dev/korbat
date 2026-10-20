/**
 * The mover of the quarantine (3d design, sections 5 "The services", 7.1 and 8.10; section 2, rows 38 to 40): an entry
 * point of its own, dist/quarantine.js, run by the operator alone as the one-shot Compose service `quarantine`:
 *
 *   docker compose -f infra/compose.yml --profile quarantine run --rm -T quarantine < list > receipt
 *
 * The service's command names the two roots, `node dist/quarantine.js /media/store /media/quarantine`, and the program
 * refuses to start without both (a test passes two temporary directories the same way). It reads the list that
 * `staff.js quarantine-list` printed, one line a stored file, "<in|out|destroy|operator> <image id> <file>", and prints
 * its receipt, which `staff.js quarantine-record` takes line by line:
 *
 * - `in` and `out`: copy the file from the one root to the other under a temporary name, sync it, compare the SHA-256 of
 *   source and copy, rename the copy to its name, sync the directory, and only then unlink the source; print
 *   "<direction> <id> <file> <bytes> <sha256> done", or `already` when the file was where its direction wants it (with
 *   the same digest: only a source that is left is unlinked), `missing` when it is in neither place (`lost` on a run with
 *   --lost), or `refused` (a name outside the layout, a copy whose digest differs, a file that is not a plain file);
 * - `destroy`: take the digest first, then unlink the file in the quarantine and, when the store holds one of the same
 *   name, there too, and print where it was found: `quarantine`, `store`, `both`, or `already` when in neither;
 * - `operator`: a file the quarantine holds for an image the database does not know is left alone;
 * - with --inventory and no list: nothing moves, and one line "have <id> <file> <bytes> <sha256>" is printed for every
 *   file the quarantine holds.
 *
 * It decodes nothing and opens no file but those the list names. A crash leaves a file in one place or in both, never in
 * neither, and the next run finishes it. One bad line never stops a run: it is printed with its word, the next line is
 * taken, and the run exits 1 at its end. The directory's sync is skipped only where the platform refuses it (EPERM on
 * Windows, where only the tests run); any other error ends the run, with every file still in one place or in both.
 *
 * It opens no database and no socket, holds no credential, and imports no module of the API: the service has no network
 * and no environment and mounts the two volumes alone, so the program that moves sealed files can send them nowhere, and
 * neither the API nor the worker ever mounts the quarantine. It keeps its own copy of the store's naming rule (the media
 * module's storedImageName and handover.ts's) and of the receipt's words (the contracts' QUARANTINE_WORDS); unit tests
 * hold the copies equal.
 */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readdir, rename, rm, stat, unlink, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** The sizes the worker stores of every image, as the contracts' MEDIA_SIZES lists them. */
const SIZES = ["small", "large"] as const;
const MEDIA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);

/** This program's copies of the list's directions and of the receipt's words (the contracts' QUARANTINE_DIRECTIONS and QUARANTINE_WORDS). */
export const MOVER_DIRECTIONS = ["in", "out", "destroy", "operator"] as const;
export const MOVER_WORDS = {
  move: ["done", "already", "missing", "lost", "refused"],
  destroy: ["quarantine", "store", "both", "already", "refused"],
  have: "have",
} as const;
type Direction = (typeof MOVER_DIRECTIONS)[number];

/**
 * This program's copy of the store's naming rule (the media module's storedImageName): where the worker keeps one size of
 * an image, relative to a root, with forward slashes: files/<aa>/<id>/<size>.webp. The quarantine has the same layout.
 */
export function storedName(id: string, size: (typeof SIZES)[number]): string {
  if (!MEDIA_ID.test(id)) throw new TypeError("not a media id");
  return `files/${id.slice(0, 2)}/${id}/${size}.webp`;
}

/** Whether a name is one the rule makes for this image id: anything else is outside the layout and is never opened. */
export function isStoredName(name: string, id?: string): boolean {
  const parts = name.split("/");
  if (parts.length !== 4) return false;
  const [, , named, file] = parts;
  const size = SIZES.find((s) => file === `${s}.webp`);
  if (size === undefined || !MEDIA_ID.test(named!) || storedName(named!, size) !== name) return false;
  return id === undefined || id === named;
}

/** Follows no symlink at the last path component where the platform can say so, and never waits on a FIFO. */
const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

/** The bytes of a plain file, null when there is nothing under the name, or "other" for anything that is not a plain file. */
async function readPlain(file: string): Promise<Buffer | null | "other"> {
  let handle;
  try {
    handle = await open(file, READ_FLAGS);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // Nothing there, or a part of the path that is no directory: the file is not in this place.
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    return "other";
  }
  try {
    if (!(await handle.stat()).isFile()) return "other";
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

/** What ends a run: an error the run cannot go past without leaving a file's place uncertain. */
class RunEnded extends Error {}

/**
 * Syncs a directory, so that a rename or an unlink in it survives a crash of the host. Windows refuses to sync a
 * directory (EPERM), and only the tests run there: the sync is skipped for that error alone.
 */
async function syncDirectory(dir: string): Promise<void> {
  const handle = await open(dir, constants.O_RDONLY);
  try {
    await handle.sync();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EPERM") throw err;
  } finally {
    await handle.close();
  }
}

export interface QuarantineOptions {
  /** The image store's root and the quarantine's root, the program's two arguments. */
  store: string;
  quarantine: string;
  /** The list on standard input; ignored by an inventory. */
  input: string;
  /** --lost: a file in neither place is printed `lost` in the place of `missing`. */
  lost?: boolean;
  /** --inventory: no list is read, nothing moves, and every file the quarantine holds is printed as a `have` line. */
  inventory?: boolean;
  log: (line: string) => void;
  error: (line: string) => void;
  /** Tests: writes a copy's bytes into its new file; the handle's own write unless a test passes one that writes other bytes. */
  writeCopy?: (file: FileHandle, data: Buffer) => Promise<void>;
  /** Tests: the directory's sync, which a test makes fail with another error than the platform's refusal. */
  syncDirectory?: (dir: string) => Promise<void>;
  /** Tests: called after a copy has its name and its directory is synced, before the source is unlinked: a crash there. */
  beforeUnlink?: (file: string) => Promise<void>;
}

/** Runs one list, or one inventory, and answers its exit code: 0 when every line was carried out, 1 otherwise. */
export async function runQuarantine(options: QuarantineOptions): Promise<number> {
  const sync = options.syncDirectory ?? syncDirectory;
  const where = (root: string, file: string) => path.join(root, ...file.split("/"));
  /** Syncs a directory, or ends the run: a sync that failed for another reason than the platform's refusal is a fault of the disk. */
  const synced = async (dir: string) => {
    try {
      await sync(dir);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "error";
      throw new RunEnded(`quarantine: ${dir}: the directory could not be synced (${code}); the run stops here, and every file is in one place or in both`);
    }
  };

  if (options.inventory) return inventory(options);

  let failed = false;
  const lines = options.input.split(LF).map((line) => (line.endsWith(CR) ? line.slice(0, -1) : line));
  try {
    for (const [index, line] of lines.entries()) {
      if (line.trim() === "") continue;
      const fields = line.split(" ");
      const [direction, id, file] = fields as [string, string, string];
      if (fields.length !== 3 || !(MOVER_DIRECTIONS as readonly string[]).includes(direction) || !MEDIA_ID.test(id)) {
        options.error(`quarantine: line ${index + 1} is not a line of quarantine-list; skipped`);
        failed = true;
        continue;
      }
      if ((direction as Direction) === "operator") {
        // A file of an image the database does not know: the operator decides, and writes the line's direction by hand.
        options.error(`quarantine: ${file} is an operator line; left alone (the README, Restoring)`);
        continue;
      }
      if (!isStoredName(file, id)) {
        options.error(`quarantine: skipped: ${file} is outside the layout`);
        options.log(`${direction} ${id} ${file} refused`);
        failed = true;
        continue;
      }
      if (direction === "destroy") {
        const word = await destroy(id, file);
        if (word === "refused") failed = true;
        continue;
      }
      const [from, to] = direction === "in" ? [options.store, options.quarantine] : [options.quarantine, options.store];
      const word = await move(direction, id, file, from, to);
      if (word === "missing" || word === "refused") failed = true;
    }
  } catch (err) {
    if (!(err instanceof RunEnded)) throw err;
    options.error(err.message);
    return 1;
  }
  return failed ? 1 : 0;

  /** One move in its direction; prints its line and answers its word. */
  async function move(direction: string, id: string, file: string, fromRoot: string, toRoot: string): Promise<string> {
    const source = where(fromRoot, file);
    const target = where(toRoot, file);
    const done = (word: string, data: Buffer) => {
      options.log(`${direction} ${id} ${file} ${data.length} ${sha256(data)} ${word}`);
      return word;
    };
    const bare = (word: string) => {
      options.log(`${direction} ${id} ${file} ${word}`);
      return word;
    };
    const from = await readPlain(source);
    const to = await readPlain(target);
    if (from === "other" || to === "other") {
      options.error(`quarantine: ${file}: not a plain file; nothing moved`);
      return bare("refused");
    }
    if (from === null) {
      if (to !== null) return done("already", to);
      return bare(options.lost ? "lost" : "missing");
    }
    const digest = sha256(from);
    if (to !== null) {
      // The file is where its direction wants it already: only the source that is left is unlinked.
      if (sha256(to) !== digest) {
        options.error(`quarantine: ${file}: another file of the same name is at the destination; both are kept`);
        return bare("refused");
      }
      await unlink(source);
      await synced(path.dirname(source));
      return done("already", to);
    }
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    // The copy is written under a temporary name of its own, which a run cut short may have left: it is never a
    // recorded file, so it is removed before the copy is written again.
    const part = `${target}.part`;
    await rm(part, { force: true });
    const handle = await open(part, "wx", 0o600);
    try {
      await (options.writeCopy ?? ((file, data) => file.writeFile(data)))(handle, from);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const copy = await readPlain(part);
    if (copy === null || copy === "other" || sha256(copy) !== digest) {
      await rm(part, { force: true });
      options.error(`quarantine: ${file}: the copy's digest differs; the copy is removed and the source kept`);
      return bare("refused");
    }
    await rename(part, target);
    await synced(path.dirname(target));
    await options.beforeUnlink?.(file);
    await unlink(source);
    await synced(path.dirname(source));
    return done("done", from);
  }

  /** One destroy line: the digest first, then the unlink in the quarantine and in the store; prints its line and answers its word. */
  async function destroy(id: string, file: string): Promise<string> {
    const inQuarantine = where(options.quarantine, file);
    const inStore = where(options.store, file);
    const kept = await readPlain(inQuarantine);
    const stored = await readPlain(inStore);
    if (kept === "other" || stored === "other") {
      options.error(`quarantine: ${file}: not a plain file; nothing destroyed`);
      options.log(`destroy ${id} ${file} refused`);
      return "refused";
    }
    const data = kept ?? stored;
    if (data === null) {
      options.log(`destroy ${id} ${file} already`);
      return "already";
    }
    // The digest is taken before any unlink, so the record proves which bytes were destroyed.
    const digest = sha256(data);
    if (kept !== null) {
      await unlink(inQuarantine);
      await synced(path.dirname(inQuarantine));
    }
    if (stored !== null) {
      await unlink(inStore);
      await synced(path.dirname(inStore));
    }
    const word = kept !== null && stored !== null ? "both" : kept !== null ? "quarantine" : "store";
    options.log(`destroy ${id} ${file} ${data.length} ${digest} ${word}`);
    return word;
  }
}

/**
 * The inventory: one `have` line for every plain file under the quarantine's files/ whose name the layout makes, in name
 * order, and nothing moved. A name the layout does not make is reported for the operator, left where it is, and makes
 * the run exit 1; a copy that a run cut short left under its temporary name is reported and left too.
 */
async function inventory(options: QuarantineOptions): Promise<number> {
  const root = path.join(options.quarantine, "files");
  let failed = false;
  const names = async (dir: string) => (await readdir(dir, { withFileTypes: true }).catch(() => [])).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const shard of await names(root)) {
    const shardDir = path.join(root, shard.name);
    if (!shard.isDirectory() || !/^[0-9a-f]{2}$/.test(shard.name)) {
      options.error(`quarantine: files/${shard.name} is outside the layout; left where it is`);
      failed = true;
      continue;
    }
    for (const image of await names(shardDir)) {
      const imageDir = path.join(shardDir, image.name);
      if (!image.isDirectory() || !MEDIA_ID.test(image.name) || !image.name.startsWith(shard.name)) {
        options.error(`quarantine: files/${shard.name}/${image.name} is outside the layout; left where it is`);
        failed = true;
        continue;
      }
      for (const entry of await names(imageDir)) {
        const name = `files/${shard.name}/${image.name}/${entry.name}`;
        if (entry.isFile() && entry.name.endsWith(".webp.part")) {
          options.error(`quarantine: ${name} is a copy a run left unfinished; the next move of its file replaces it`);
          continue;
        }
        const data = entry.isFile() && isStoredName(name, image.name) ? await readPlain(path.join(imageDir, entry.name)) : "other";
        if (data === null || data === "other") {
          options.error(`quarantine: ${name} is outside the layout; left where it is`);
          failed = true;
          continue;
        }
        options.log(`${MOVER_WORDS.have} ${image.name} ${name} ${data.length} ${sha256(data)}`);
      }
    }
  }
  return failed ? 1 : 0;
}

/** The program's arguments: its two roots, then at most one of the two flags; anything else refuses to start. */
export function parseQuarantineArgs(argv: readonly string[]): { store: string; quarantine: string; lost: boolean; inventory: boolean } | { problem: string } {
  const roots = argv.filter((arg) => !arg.startsWith("--"));
  const flags = argv.filter((arg) => arg.startsWith("--"));
  if (roots.length !== 2) return { problem: "quarantine: refused: name the image store's root and the quarantine's root, in that order" };
  if (flags.some((flag) => flag !== "--lost" && flag !== "--inventory") || flags.length > 1) {
    return { problem: "quarantine: refused: the only flags are --lost and --inventory, one at a time" };
  }
  return { store: roots[0]!, quarantine: roots[1]!, lost: flags[0] === "--lost", inventory: flags[0] === "--inventory" };
}

/** Everything on standard input. */
async function readInput(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  return Buffer.concat(chunks).toString("utf8");
}

/** The program as the service runs it: refuses to start without both roots, each an existing directory. */
export async function main(argv: readonly string[], io: { log: (line: string) => void; error: (line: string) => void; input: () => Promise<string> }): Promise<number> {
  const args = parseQuarantineArgs(argv);
  if ("problem" in args) {
    io.error(args.problem);
    return 2;
  }
  for (const root of [args.store, args.quarantine]) {
    // A volume that is not mounted is an empty directory of the image, so a root that is no directory is a typing mistake.
    if (!(await stat(root).then((s) => s.isDirectory(), () => false))) {
      io.error(`quarantine: refused: ${root} is not a directory`);
      return 2;
    }
  }
  const input = args.inventory ? "" : await io.input();
  return runQuarantine({ store: args.store, quarantine: args.quarantine, input, lost: args.lost, inventory: args.inventory, log: io.log, error: io.error });
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  void main(process.argv.slice(2), { log: (line) => console.log(line), error: (line) => console.error(line), input: readInput }).then((code) => {
    process.exitCode = code;
  });
}
