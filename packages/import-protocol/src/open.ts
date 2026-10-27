import { constants, type BigIntStats } from "node:fs";
import { lstat, open, stat, type FileHandle } from "node:fs/promises";
import path from "node:path";

/**
 * The API's one opener (3b design, section 7.1, "The API's one opener"). The importer parses hostile input, so the API
 * trusts nothing it wrote, not even a path: every file of import-work the API reads is opened here. Every component of
 * the path from the mount root down is looked at with lstat: each folder must be a real folder and the file a regular
 * file, none a symbolic link (a junction on Windows reports as one), all on the mount root's device. The file is then
 * opened without following a symlink where the platform can say so (O_NOFOLLOW; Windows cannot, and the checks above
 * still hold there) and without waiting (O_NONBLOCK: a FIFO swapped in would otherwise block a thread of the pool), and
 * the descriptor is checked again: a regular file with the device and inode the lstat saw, within the cap. The caller
 * reads only through that descriptor. So an importer taken over by a crafted archive cannot make the API read a file of
 * another volume, media-store's or /proc's.
 *
 * A refusal is returned as its code and never thrown: the package has no logger, and the API logs the job id and the
 * code (a refused file counts as missing_file). Device and inode are compared as bigints, which Windows' 64-bit file ids
 * need.
 */

const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

/** Why a file was not opened, in the order the checks run. */
export const WORK_FILE_REFUSALS = ["outside", "missing", "symlink", "not_a_file", "other_device", "too_large", "changed", "error"] as const;
export type WorkFileRefusal = (typeof WORK_FILE_REFUSALS)[number];

export interface WorkFile {
  handle: FileHandle;
  size: number;
}

export type WorkFileResult = { ok: true; file: WorkFile } | { ok: false; code: WorkFileRefusal };

export interface WorkFileOptions {
  /** Tests only: pretend the mount root lives on this device, as the media files' storeDevice does. */
  device?: number | bigint;
}

const refuse = (code: WorkFileRefusal): WorkFileResult => ({ ok: false, code });

/** An error of the file system as a refusal: nothing there, a symlink met by O_NOFOLLOW (ELOOP, or EMLINK on the BSDs), or anything else. */
function refusalOf(err: unknown): WorkFileRefusal {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ENOENT" || code === "ENOTDIR") return "missing";
  if (code === "ELOOP" || code === "EMLINK") return "symlink";
  return "error";
}

/**
 * Opens `file`, which must lie under `root` (the import-work mount, or for the importer its import-archives mount), for
 * reading. On success the caller owns the handle and closes it.
 */
export async function openWorkFile(root: string, file: string, maxBytes: number, options: WorkFileOptions = {}): Promise<WorkFileResult> {
  const relative = path.relative(root, file);
  if (relative === "") return refuse("not_a_file");
  const parts = relative.split(path.sep);
  // On Windows a path on another drive comes back absolute.
  if (path.isAbsolute(relative) || parts[0] === "..") return refuse("outside");

  let device: bigint;
  try {
    device = options.device === undefined ? (await stat(root, { bigint: true })).dev : BigInt(options.device);
  } catch (err) {
    return refuse(refusalOf(err));
  }

  // Every component from the root down, so that a symlinked folder anywhere on the path is refused, not only at its end.
  let at = root;
  let entry: BigIntStats | undefined;
  for (const [index, part] of parts.entries()) {
    at = path.join(at, part);
    try {
      entry = await lstat(at, { bigint: true });
    } catch (err) {
      return refuse(refusalOf(err));
    }
    if (entry.isSymbolicLink()) return refuse("symlink");
    const last = index === parts.length - 1;
    if (last ? !entry.isFile() : !entry.isDirectory()) return refuse("not_a_file");
    if (entry.dev !== device) return refuse("other_device");
  }
  if (!entry) return refuse("not_a_file");
  if (entry.size > BigInt(maxBytes)) return refuse("too_large");

  let handle: FileHandle;
  try {
    // The path just walked, normalised: in the caller's own spelling a ".." after a symlinked folder would be resolved
    // through the link by the system, to a file the walk never looked at.
    handle = await open(at, READ_FLAGS);
  } catch (err) {
    return refuse(refusalOf(err));
  }
  let code: WorkFileRefusal = "changed";
  try {
    // The descriptor must be the very file the lstat saw: a swap between the two is a file of someone else's choosing.
    const opened = await handle.stat({ bigint: true });
    if (opened.isFile() && opened.dev === entry.dev && opened.ino === entry.ino) {
      if (opened.size <= BigInt(maxBytes)) return { ok: true, file: { handle, size: Number(opened.size) } };
      code = "too_large";
    }
  } catch {
    code = "error";
  }
  await handle.close();
  return refuse(code);
}
