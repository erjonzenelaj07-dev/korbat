import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rm, stat, statfs, type FileHandle } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "pino";
import type { MediaSize } from "@korbat/contracts";
import { Heartbeat, MAX_RESULT_BYTES, MAX_VARIANT_BYTES, ResultFile, SNIFF_BYTES, isMediaId, storeLayout, uploadsLayout } from "@korbat/media-protocol";
import { MediaError } from "./context";

/**
 * The API's side of the file protocol (section 2.2 of the 2b design). The API writes the uploads
 * volume and only reads the store volume, which belongs to the worker. The worker runs the image
 * decoder, so everything in the store is treated as written by an attacker: a file is opened first
 * and the open handle is checked afterwards, which leaves no gap between the check and the use.
 */

export interface StoredFile {
  handle: FileHandle;
  size: number;
}

export interface MediaFilesOptions {
  uploadsDir: string;
  storeDir: string;
  log: Logger;
  /** Tests only: pretend the store lives on this device. */
  storeDevice?: number;
}

/**
 * Follows no symlink at the last path component where the platform can say so (Windows cannot; the device
 * check still holds there), and never waits: opening a FIFO planted in the store would otherwise block a
 * thread of the pool until a writer appeared.
 */
const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

export function createMediaFiles(options: MediaFilesOptions) {
  const uploads = uploadsLayout(options.uploadsDir);
  const store = storeLayout(options.storeDir);
  const { log } = options;
  let storeDevice = options.storeDevice;

  const device = async (): Promise<number> => (storeDevice ??= (await stat(store.root)).dev);

  /**
   * Opens a file of the store for reading. Returns null unless the open handle is a regular file,
   * on the store's own device, and no larger than `maxBytes`. A symlink to anything outside the
   * volume, /proc/self/environ for one, resolves to another device and is refused here.
   */
  async function openStored(file: string, maxBytes: number): Promise<StoredFile | null> {
    // Looked at before it is opened, so that nothing but a plain file is ever opened; the handle is checked again after.
    try {
      const entry = await lstat(file);
      if (!entry.isFile()) {
        log.error({ file: path.basename(file), directory: entry.isDirectory(), symlink: entry.isSymbolicLink(), fifo: entry.isFIFO() }, "media store: refused an entry that is not a plain file");
        return null;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") log.warn({ file: path.basename(file), code: (err as NodeJS.ErrnoException).code }, "media store: a file could not be inspected");
      return null;
    }
    let handle: FileHandle;
    try {
      handle = await open(file, READ_FLAGS);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") log.warn({ file: path.basename(file), code: (err as NodeJS.ErrnoException).code }, "media store: a file could not be opened");
      return null;
    }
    try {
      const stats = await handle.stat();
      if (stats.isFile() && stats.dev === (await device()) && stats.size <= maxBytes) return { handle, size: stats.size };
      log.error({ file: path.basename(file), regular: stats.isFile(), size: stats.size }, "media store: refused a file that is not a plain file of the store");
    } catch (err) {
      log.error({ err }, "media store: could not inspect an open file");
    }
    await handle.close();
    return null;
  }

  async function readStored(file: string, maxBytes: number): Promise<string | null> {
    const stored = await openStored(file, maxBytes);
    if (!stored) return null;
    try {
      return await stored.handle.readFile("utf8");
    } finally {
      await stored.handle.close();
    }
  }

  const namesIn = (dir: string): Promise<string[]> => readdir(dir).catch(() => []);

  return {
    uploads,
    store,

    /** Creates the uploads volume's directories and forgets bodies a crash left half received. */
    async prepare(): Promise<void> {
      await rm(uploads.tmp, { recursive: true, force: true });
      for (const dir of [uploads.tmp, uploads.incoming, uploads.deletions]) await mkdir(dir, { recursive: true });
    },

    /**
     * Streams a request body to tmp/<id>.part. `accept` sees the first bytes before anything is
     * written and throws to refuse them. Bytes are counted here while they arrive, because a
     * declared length can be absent or wrong; one byte over `maxBytes` ends the upload.
     */
    async receive(id: string, body: ReadableStream<Uint8Array> | null, maxBytes: number, accept: (head: Uint8Array) => void): Promise<number> {
      const reader = body?.getReader();
      const first: Uint8Array[] = [];
      let buffered = 0;
      let ended = !reader;
      try {
        while (reader && buffered < SNIFF_BYTES) {
          const chunk = await reader.read();
          if (chunk.done) {
            ended = true;
            break;
          }
          first.push(chunk.value);
          buffered += chunk.value.byteLength;
        }
        accept(Buffer.concat(first).subarray(0, SNIFF_BYTES));
      } catch (err) {
        await reader?.cancel().catch(() => undefined);
        throw err;
      }

      const part = uploads.part(id);
      const handle = await open(part, "wx");
      let bytes = 0;
      try {
        const write = async (chunk: Uint8Array) => {
          bytes += chunk.byteLength;
          if (bytes > maxBytes) throw new MediaError("file_too_large", 413);
          await handle.appendFile(chunk);
        };
        for (const chunk of first) await write(chunk);
        while (reader && !ended) {
          const chunk = await reader.read();
          if (chunk.done) break;
          await write(chunk.value);
        }
        await handle.sync();
        await handle.close();
      } catch (err) {
        await reader?.cancel().catch(() => undefined);
        await handle.close().catch(() => undefined);
        await rm(part, { force: true });
        throw err;
      }
      return bytes;
    },

    /** The upload becomes visible to the worker. A rename inside one volume is atomic. */
    commit: (id: string): Promise<void> => rename(uploads.part(id), uploads.upload(id)),

    /** Removes an upload, complete or not. A file the worker still holds open on Windows is left for the sweeper. */
    async discardUpload(id: string): Promise<void> {
      for (const file of [uploads.part(id), uploads.upload(id)]) {
        await rm(file, { force: true }).catch((err: unknown) => log.warn({ id, code: (err as NodeJS.ErrnoException).code }, "media uploads: an upload could not be removed yet"));
      }
    },

    /** The worker's verdict on an upload, or null while there is none. A result that does not parse is ignored and logged. */
    async readResult(id: string): Promise<ResultFile | null> {
      const text = await readStored(store.result(id), MAX_RESULT_BYTES);
      if (text === null) return null;
      try {
        const parsed = ResultFile.safeParse(JSON.parse(text));
        if (parsed.success && parsed.data.id === id) return parsed.data;
      } catch {
        // falls through to the log line below
      }
      log.error({ id }, "media store: ignored a result file that does not follow the protocol");
      return null;
    },

    /** An image file to stream. The caller closes the handle. */
    openImage: (id: string, size: MediaSize): Promise<StoredFile | null> => openStored(store.image(id, size), MAX_VARIANT_BYTES),

    /** Asks the worker to delete images. The request is an empty file named after the id. */
    async requestDeletion(ids: readonly string[]): Promise<void> {
      for (const id of ids) await (await open(uploads.deletion(id), "w")).close();
    },

    /** Ids with a deletion request. */
    async deletionRequests(): Promise<string[]> {
      return (await namesIn(uploads.deletions)).filter(isMediaId);
    },

    /** Deletion requests with their age, for the sweeper, which only withdraws one after a grace period. */
    async deletionRequestAges(now: number): Promise<{ id: string; ageMs: number }[]> {
      const found: { id: string; ageMs: number }[] = [];
      for (const id of (await namesIn(uploads.deletions)).filter(isMediaId)) {
        const stats = await stat(uploads.deletion(id)).catch(() => null);
        if (stats) found.push({ id, ageMs: now - stats.mtimeMs });
      }
      return found;
    },

    withdrawDeletion: (id: string): Promise<void> => rm(uploads.deletion(id), { force: true }),

    /** Whether the worker still holds anything for this id. */
    async imageRemains(id: string): Promise<boolean> {
      for (const target of [store.imageDir(id), store.result(id)]) {
        if (await stat(target).then(() => true, () => false)) return true;
      }
      return false;
    },

    /** Every image folder in the store with its age, for the reconcile pass. */
    async storedImages(now: number): Promise<{ id: string; ageMs: number }[]> {
      const found: { id: string; ageMs: number }[] = [];
      for (const shard of await namesIn(store.files)) {
        if (!/^[0-9a-f]{2}$/.test(shard)) continue;
        for (const id of await namesIn(path.join(store.files, shard))) {
          if (!isMediaId(id) || !id.startsWith(shard)) continue;
          const stats = await stat(store.imageDir(id)).catch(() => null);
          if (stats) found.push({ id, ageMs: now - stats.mtimeMs });
        }
      }
      return found;
    },

    /** Every upload on disk, complete or partial, with its age, for the reconcile pass. */
    async storedUploads(now: number): Promise<{ id: string; ageMs: number }[]> {
      const found: { id: string; ageMs: number }[] = [];
      const add = async (id: string, file: string) => {
        if (!isMediaId(id)) return;
        const stats = await stat(file).catch(() => null);
        if (stats) found.push({ id, ageMs: now - stats.mtimeMs });
      };
      for (const name of await namesIn(uploads.incoming)) await add(name, path.join(uploads.incoming, name));
      for (const name of await namesIn(uploads.tmp)) if (name.endsWith(".part")) await add(name.slice(0, -".part".length), path.join(uploads.tmp, name));
      return found;
    },

    /** Milliseconds since the worker's last heartbeat, or null when there is none to read. */
    async heartbeatAge(now: number): Promise<number | null> {
      const text = await readStored(store.heartbeat, 1024);
      if (text === null) return null;
      try {
        const beat = Heartbeat.safeParse(JSON.parse(text));
        return beat.success ? now - beat.data.at : null;
      } catch {
        return null;
      }
    },

    /** Free space on the volume with less of it. The volumes share a disk with Postgres, so running out would stop the database. */
    async freeBytes(): Promise<number> {
      const sizes = await Promise.all([uploads.root, store.root].map(async (dir) => {
        const fs = await statfs(dir);
        return fs.bavail * fs.bsize;
      }));
      return Math.min(...sizes);
    },
  };
}

export type MediaFiles = ReturnType<typeof createMediaFiles>;
