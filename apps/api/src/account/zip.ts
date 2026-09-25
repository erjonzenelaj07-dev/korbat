import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { Zip, ZipDeflate, ZipPassThrough } from "fflate";

/** Receives the archive's bytes in order. The writer awaits every call, so a slow consumer slows the reading of the files. */
export type ZipSink = (chunk: Uint8Array) => Promise<void>;

export interface ZipWriter {
  /** A deflated entry holding the value as indented JSON. */
  addJson(name: string, value: unknown): Promise<void>;
  /**
   * A stored entry holding the file's bytes, read in chunks. False, with nothing added, when the file
   * cannot be opened or is not a plain file. A failure while reading it, after its entry began, is
   * thrown: the archive can no longer be completed.
   */
  addFile(name: string, path: string): Promise<boolean>;
  /** Writes the central directory. Nothing may be added afterwards. */
  end(): Promise<void>;
}

/** How much of a file is read at a time; each chunk becomes one awaited write. */
const CHUNK_BYTES = 64 * 1024;

/**
 * The files come from the media store, which the worker writes and the API does not trust (2b design,
 * section 2.2): a symlink at the last path component is not followed where the platform can say so, a
 * FIFO planted there must not block a thread of the pool, and whatever was opened is checked to be a
 * plain file before any of it is read.
 */
const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

/**
 * A ZIP archive written entry by entry into an async sink, on fflate's streaming Zip. fflate hands out
 * the archive's bytes synchronously while an entry is pushed or the archive is ended; they are queued,
 * and the queue is drained with one awaited write per chunk before the next piece of input is read, so
 * at most one chunk of input is ever in flight and back-pressure reaches the file reads. Sizes and
 * checksums travel in a data descriptor after each entry's bytes, which is what lets the archive stream
 * without knowing any size up front. Files are stored as they are (images are WebP already); JSON is deflated.
 */
export function createZipWriter(sink: ZipSink): ZipWriter {
  const queued: Uint8Array[] = [];
  let failure: Error | null = null;
  const zip = new Zip((err, chunk) => {
    if (err) failure = err;
    else queued.push(chunk);
  });

  async function drain(): Promise<void> {
    while (queued.length > 0) await sink(queued.shift()!);
    if (failure) throw failure;
  }

  return {
    async addJson(name, value) {
      const entry = new ZipDeflate(name);
      zip.add(entry);
      entry.push(new TextEncoder().encode(JSON.stringify(value, null, 2)), true);
      await drain();
    },

    async addFile(name, path) {
      // The entry is added only once the file is known to be readable: an entry cannot be taken back.
      let handle: FileHandle;
      try {
        handle = await open(path, READ_FLAGS);
      } catch {
        return false;
      }
      const plain = await handle.stat().then((stats) => stats.isFile(), () => false);
      if (!plain) {
        await handle.close();
        return false;
      }
      const entry = new ZipPassThrough(name);
      zip.add(entry);
      // The stream closes the handle when it ends, and also when a throw below ends the loop and destroys it.
      const chunks = handle.createReadStream({ highWaterMark: CHUNK_BYTES }) as AsyncIterable<Uint8Array>;
      for await (const chunk of chunks) {
        entry.push(chunk);
        await drain();
      }
      entry.push(new Uint8Array(0), true);
      await drain();
      return true;
    },

    async end() {
      zip.end();
      await drain();
    },
  };
}
