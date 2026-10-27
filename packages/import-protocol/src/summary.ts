import type { FileHandle } from "node:fs/promises";
import { z } from "zod";
import { ImportSource, ImportSummary } from "@korbat/contracts";
import { archivesLayout, isImportId, workLayout } from "./layout";
import { JOB_FILE_MAX_BYTES, SUMMARY_MAX_BYTES } from "./limits";
import { openWorkFile, type WorkFileOptions, type WorkFileRefusal } from "./open";

/**
 * The protocol's small JSON files (3b design, section 7.1): job.json, which the API writes for the importer, and
 * summary.json and the heartbeat, which the importer writes for the API. Each is read under its cap through
 * openWorkFile and parsed strictly; a refusal is returned as its code, never thrown.
 */

/**
 * jobs/<id>/job.json on import-archives: what the importer needs to scan one archive. `accountKey` is the account's
 * import key (5.4, import_keys.key, 32 random bytes) as 64 lowercase hex, the one secret the importer holds; `images`
 * whether images are imported (IMPORT_IMAGES and the matcher, decision 15); `createdAt` the import's creation, from which
 * the core's date bound counts (5.4).
 */
export const JobFile = z.strictObject({
  v: z.literal(1),
  id: z.string().refine(isImportId, { message: "not an import id" }),
  source: ImportSource,
  accountKey: z.string().regex(/^[0-9a-f]{64}$/),
  images: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type JobFile = z.infer<typeof JobFile>;

/** The heartbeat file on import-work: when the importer last completed a tick, in epoch milliseconds (the Compose healthcheck reads `at`). */
export const ImporterHeartbeat = z.strictObject({ v: z.literal(1), at: z.int().min(0) });
export type ImporterHeartbeat = z.infer<typeof ImporterHeartbeat>;

/** Why a file was not read: openWorkFile's refusals, a file that is not JSON or not its schema, or one that names another import. */
export type ReadRefusal = WorkFileRefusal | "invalid" | "wrong_id";
export type ReadResult<T> = { ok: true; value: T } | { ok: false; code: ReadRefusal };

/** The whole file through its descriptor, or null when it holds more than `maxBytes` (it may have grown since it was opened). */
async function readWhole(handle: FileHandle, maxBytes: number): Promise<Buffer | null> {
  const buffer = Buffer.alloc(maxBytes + 1);
  let filled = 0;
  while (filled < buffer.length) {
    const { bytesRead } = await handle.read(buffer, filled, buffer.length - filled, filled);
    if (bytesRead === 0) break;
    filled += bytesRead;
  }
  return filled > maxBytes ? null : buffer.subarray(0, filled);
}

async function readJson<T>(root: string, file: string, maxBytes: number, schema: z.ZodType<T>, options: WorkFileOptions): Promise<ReadResult<T>> {
  const opened = await openWorkFile(root, file, maxBytes, options);
  if (!opened.ok) return { ok: false, code: opened.code };
  let bytes: Buffer | null;
  try {
    bytes = await readWhole(opened.file.handle, maxBytes);
  } catch {
    return { ok: false, code: "error" };
  } finally {
    await opened.file.handle.close();
  }
  if (bytes === null) return { ok: false, code: "too_large" };
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    return { ok: false, code: "invalid" };
  }
  const parsed = schema.safeParse(value);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, code: "invalid" };
}

/** The importer's read of a job file, at most 4 KiB, from the import-archives mount at `root`. */
export async function readJobFile(root: string, id: string, options: WorkFileOptions = {}): Promise<ReadResult<JobFile>> {
  const read = await readJson(root, archivesLayout(root).job(id), JOB_FILE_MAX_BYTES, JobFile, options);
  return read.ok && read.value.id !== id ? { ok: false, code: "wrong_id" } : read;
}

/**
 * The API's read of a scan's summary, at most 64 KiB, from the import-work mount at `root`, parsed with the contracts'
 * ImportSummary. A summary that names another import is refused: an importer taken over by one archive must not be able
 * to settle another person's scan.
 */
export async function readSummary(root: string, id: string, options: WorkFileOptions = {}): Promise<ReadResult<ImportSummary>> {
  const read = await readJson(root, workLayout(root).summary(id), SUMMARY_MAX_BYTES, ImportSummary, options);
  return read.ok && read.value.id !== id ? { ok: false, code: "wrong_id" } : read;
}

/** The API's read of the importer's heartbeat, under the job file's cap of 4 KiB (a heartbeat is a few dozen bytes). */
export async function readHeartbeat(root: string, options: WorkFileOptions = {}): Promise<ReadResult<ImporterHeartbeat>> {
  return readJson(root, workLayout(root).heartbeat, JOB_FILE_MAX_BYTES, ImporterHeartbeat, options);
}
