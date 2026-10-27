import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rm, statfs, type FileHandle } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "pino";
import {
  archivesLayout,
  isImportId,
  openWorkFile,
  readHeartbeat,
  readSummary,
  workLayout,
  type JobFile,
  type ReadResult,
  type WorkFileResult,
} from "@korbat/import-protocol";
import type { ImportSummary } from "@korbat/contracts";

/**
 * The API's side of the import's file protocol (3b design, section 7.1), through packages/import-protocol's layouts. The
 * API writes import-archives (the archives as they arrive, each job's job.json, the queue markers and the deletion
 * requests) and only reads import-work, which the importer writes after parsing hostile input: every file of import-work
 * is read through openWorkFile, which trusts no path, link or size the importer left there.
 */

/** Writes that create a file never follow a symlink at the last component, where the platform can say so. */
const CREATE_FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0);
/** archive.part only ever grows at its end, through this descriptor, and is never followed through a symlink. */
const APPEND_FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0);

/** What a chunk's write came to: kept, or truncated back to the stored size because it was short, long or damaged. */
export type ChunkWrite = "kept" | "mismatch";

export interface ImportFilesOptions {
  archivesDir: string;
  workDir: string;
  log: Logger;
  /** Tests only: the free space of import-archives in bytes, in place of statfs. */
  freeBytes?: () => Promise<number>;
  /** Tests only: openWorkFile's device seam, as the media files' storeDevice is. */
  workDevice?: number;
}

/** A name in a folder that is an import id, with the age of the entry itself (never of what a link names). */
export interface AgedId {
  id: string;
  ageMs: number;
}

export function createImportFiles(options: ImportFilesOptions) {
  const archives = archivesLayout(options.archivesDir);
  const work = workLayout(options.workDir);
  const { log } = options;
  const device = options.workDevice === undefined ? {} : { device: options.workDevice };

  /** The import ids among a folder's names, each with the age of its entry; a folder that is not there has none. */
  async function agedIds(dir: string, now: number): Promise<AgedId[]> {
    const names = await readdir(dir).catch(() => [] as string[]);
    const found: AgedId[] = [];
    for (const name of names) {
      if (!isImportId(name)) continue;
      const stats = await lstat(path.join(dir, name)).catch(() => null);
      if (stats) found.push({ id: name, ageMs: now - stats.mtimeMs });
    }
    return found;
  }

  /** Creates a file through a descriptor that follows no symlink, writes it whole and flushes it. */
  async function writeWhole(file: string, body: string): Promise<void> {
    const handle = await open(file, CREATE_FLAGS, 0o600);
    try {
      await handle.writeFile(body);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  /** Cuts archive.part back to `size` bytes and flushes it. */
  async function truncate(id: string, size: number): Promise<void> {
    const handle = await open(archives.part(id), constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      await handle.truncate(size);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  return {
    archives,
    work,

    /** Creates import-archives' three folders. import-work is the importer's: the API never creates anything there. */
    async prepare(): Promise<void> {
      for (const dir of [archives.jobs, archives.queue, archives.deletions]) await mkdir(dir, { recursive: true });
    },

    /** Free space on import-archives (4.2 step 3, 7.3), which shares a disk with the database. */
    async freeBytes(): Promise<number> {
      if (options.freeBytes) return options.freeBytes();
      const fs = await statfs(archives.root);
      return fs.bavail * fs.bsize;
    },

    /** Milliseconds since the importer's last heartbeat, or null when there is none it may read (4.2 step 3). */
    async heartbeatAge(now: number): Promise<number | null> {
      const beat = await readHeartbeat(work.root, device);
      return beat.ok ? now - beat.value.at : null;
    },

    /** One file of import-work, opened as the protocol says; the caller closes the handle. */
    openWork: (file: string, maxBytes: number): Promise<WorkFileResult> => openWorkFile(work.root, file, maxBytes, device),

    /** A scan's summary.json, at most 64 KiB, parsed as ImportSummary and naming this import. */
    readSummary: (id: string): Promise<ReadResult<ImportSummary>> => readSummary(work.root, id, device),

    /** The folder of an upload, made by its first chunk. */
    ensureJobDir: async (id: string): Promise<void> => {
      await mkdir(archives.jobDir(id), { recursive: true });
    },

    /** The bytes archive.part holds, or null when there is none. The API alone writes import-archives. */
    async partSize(id: string): Promise<number | null> {
      const stats = await lstat(archives.part(id)).catch((err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") return null;
        throw err;
      });
      if (stats === null) return null;
      if (!stats.isFile()) throw new Error("import: archive.part is not a regular file");
      return stats.size;
    },

    /** Cuts archive.part back to `size` bytes: the file then holds only whole chunks that passed (7.3). */
    truncatePart: (id: string, size: number): Promise<void> => truncate(id, size),

    /**
     * Appends one chunk to archive.part (7.3). The body is read as it arrives, counted and hashed, and written through a
     * descriptor opened for appending that follows no symlink; one byte over `length` ends the read. `accept`, for the
     * first chunk, sees the first bytes before any of them is kept, and throws to refuse them. A body that is short, long
     * or whose SHA-256 is not `sha256`, and a body that breaks off, leave the file truncated back to `at`, its stored size,
     * and answer "mismatch"; a kept chunk is flushed (fsync) before the answer, so the row only ever counts bytes on disk.
     */
    async appendChunk(id: string, chunk: { at: number; length: number; sha256: string; body: ReadableStream<Uint8Array> | null; accept?: (head: Buffer) => void; headBytes?: number }): Promise<ChunkWrite> {
      const reader = chunk.body?.getReader();
      const first: Uint8Array[] = [];
      let held = 0;
      let ended = !reader;
      const cancel = () => reader?.cancel().catch(() => undefined);
      try {
        // The first bytes, only as many as the check needs, before anything is written.
        const wanted = Math.min(chunk.headBytes ?? 0, chunk.length);
        while (reader && chunk.accept && held < wanted) {
          const read = await reader.read();
          if (read.done) {
            ended = true;
            break;
          }
          first.push(read.value);
          held += read.value.byteLength;
        }
      } catch {
        // A body that broke off before its first bytes arrived: nothing was written.
        await cancel();
        return "mismatch";
      }
      try {
        chunk.accept?.(Buffer.concat(first));
      } catch (err) {
        await cancel();
        throw err;
      }

      const handle: FileHandle = await open(archives.part(id), APPEND_FLAGS, 0o600);
      const hasher = createHash("sha256");
      let bytes = 0;
      let outcome: ChunkWrite = "kept";
      // A write that failed (a full disk) is the server's fault, and is thrown on once the file is cut back.
      let failed: unknown = null;
      // The file must be exactly the stored size, which the caller has made it; one that is not is left as it is.
      let sized = true;
      try {
        if ((await handle.stat()).size !== chunk.at) {
          sized = false;
          outcome = "mismatch";
        }
        const write = async (piece: Uint8Array): Promise<boolean> => {
          bytes += piece.byteLength;
          if (bytes > chunk.length) return false;
          hasher.update(piece);
          await handle.appendFile(piece);
          return true;
        };
        let within = outcome === "kept";
        for (const piece of first) if (within) within = await write(piece);
        while (within && reader && !ended) {
          let read: Awaited<ReturnType<typeof reader.read>>;
          try {
            read = await reader.read();
          } catch {
            // The connection was lost: a short body.
            within = false;
            break;
          }
          if (read.done) break;
          within = await write(read.value);
        }
        if (!within || bytes !== chunk.length || hasher.digest("hex") !== chunk.sha256) outcome = "mismatch";
      } catch (err) {
        failed = err;
        outcome = "mismatch";
      }
      try {
        if (outcome === "kept") await handle.sync();
      } finally {
        await handle.close();
      }
      if (outcome === "mismatch") {
        await cancel();
        // Through a descriptor of its own: Windows refuses to truncate through one opened for appending.
        if (sized) await truncate(id, chunk.at);
      }
      if (failed !== null) throw failed;
      return outcome;
    },

    /**
     * The last chunk's files (7.3): archive.part becomes archive, job.json is written for the importer, and last the
     * queue marker, by whose time the importer takes the oldest archive first.
     */
    async completeArchive(id: string, job: JobFile): Promise<void> {
      await rename(archives.part(id), archives.archive(id));
      await writeWhole(archives.job(id), JSON.stringify(job));
      await writeWhole(archives.queued(id), "");
    },

    /** The archive's folder (archive.part or archive, and job.json) and its queue marker go; both may be gone already. */
    async removeArchive(id: string): Promise<void> {
      await rm(archives.jobDir(id), { recursive: true, force: true });
      await rm(archives.queued(id), { force: true });
    },

    /** Asks the importer to delete the work folder of `id` and to stop scanning it: an empty file, delete/<id>. */
    async requestWorkDeletion(id: string): Promise<void> {
      await writeWhole(archives.deletion(id), "");
    },

    /** Withdraws a request the importer has carried out. */
    withdrawWorkDeletion: (id: string): Promise<void> => rm(archives.deletion(id), { force: true }),

    /** Whether the importer still has a work folder (or anything) at jobs/<id> of import-work. */
    async workFolderPresent(id: string): Promise<boolean> {
      return (await lstat(work.jobDir(id)).catch(() => null)) !== null;
    },

    /** The archive folders, queue markers, deletion requests and work folders, each by import id with its age (7.5 step 8). */
    archiveFolders: (now: number) => agedIds(archives.jobs, now),
    queueMarkers: (now: number) => agedIds(archives.queue, now),
    deletionRequests: (now: number) => agedIds(archives.deletions, now),
    workFolders: (now: number) => agedIds(work.jobs, now),

    log,
  };
}

export type ImportFiles = ReturnType<typeof createImportFiles>;
