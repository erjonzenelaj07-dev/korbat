import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "pino";
import type { AvatarCrop } from "@korbat/contracts";
import { AvatarJob, MAX_ATTEMPTS, MAX_JOB_BYTES, RESULT_VERSION, isMediaId, resultFileId, type Heartbeat, type MediaFormat, type ResultFile, type StoreLayout, type UploadsLayout } from "@korbat/media-protocol";
import type { Processed } from "./pipeline";

export interface LoopDeps {
  uploads: UploadsLayout;
  store: StoreLayout;
  formats: readonly MediaFormat[];
  log: Logger;
  now: () => number;
  /**
   * The image pipeline. Tests pass a stand-in; the process passes processImage. 2d Task 3: `avatar`, the crop of the
   * upload's job file, for an avatar's upload; undefined for a post's.
   */
  process: (path: string, formats: readonly MediaFormat[], avatar?: { crop: AvatarCrop }) => Promise<Processed>;
  /** Ends the process when one upload takes too long. Docker restarts the container, and the attempt counter does the rest. */
  abort: (reason: string) => void;
  watchdogMs: number;
}

export const WATCHDOG_MS = 120_000;

/** Creates the store's directories and forgets files a crash left half written. */
export async function prepareStore(store: StoreLayout): Promise<void> {
  await rm(store.tmp, { recursive: true, force: true });
  for (const dir of [store.files, store.results, store.attempts, store.tmp]) await mkdir(dir, { recursive: true });
}

/** Write under tmp/, flush, rename: the API never sees half a file, and a finished file survives a power cut. */
async function writeAtomic(store: StoreLayout, target: string, data: string | Buffer): Promise<void> {
  const temp = path.join(store.tmp, randomUUID());
  const handle = await open(temp, "w");
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, target);
}

export async function writeHeartbeat(deps: Pick<LoopDeps, "store" | "now">): Promise<void> {
  const beat: Heartbeat = { v: 1, at: deps.now() };
  await writeAtomic(deps.store, deps.store.heartbeat, JSON.stringify(beat));
}

/** Names in a directory that are media ids and regular files. Anything else, a symlink included, is ignored. */
async function mediaFiles(dir: string): Promise<{ id: string; mtimeMs: number }[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const found: { id: string; mtimeMs: number }[] = [];
  for (const name of names) {
    if (!isMediaId(name)) continue;
    const stats = await lstat(path.join(dir, name)).catch(() => null);
    if (stats?.isFile()) found.push({ id: name, mtimeMs: stats.mtimeMs });
  }
  return found.sort((a, b) => a.mtimeMs - b.mtimeMs || a.id.localeCompare(b.id));
}

async function readAttempts(store: StoreLayout, id: string): Promise<number> {
  const text = await readFile(store.attempt(id), "utf8").catch(() => "0");
  const count = Number.parseInt(text, 10);
  return Number.isInteger(count) && count >= 0 ? count : MAX_ATTEMPTS;
}

const writeResult = (store: StoreLayout, result: ResultFile) => writeAtomic(store, store.result(result.id), JSON.stringify(result));

/**
 * 2d Task 3 (design, sections 7.2 and 7.4): the upload's job file, which the API writes before the upload itself. None for
 * a post's upload (no file of that name); its crop for an avatar's; "malformed" for anything else that has the name: an
 * entry that is not a plain file, one over MAX_JOB_BYTES, or text that is not exactly AvatarJob. Read from a volume this
 * process does not trust, so it is looked at before it is opened, read whole only within its bound, and parsed strictly.
 */
async function avatarJob(uploads: UploadsLayout, id: string): Promise<{ crop: AvatarCrop } | null | "malformed"> {
  const file = uploads.avatarJob(id);
  const entry = await lstat(file).catch((err: NodeJS.ErrnoException) => (err.code === "ENOENT" ? null : err));
  if (entry === null) return null;
  if (entry instanceof Error || !entry.isFile() || entry.size > MAX_JOB_BYTES) return "malformed";
  try {
    const parsed = AvatarJob.safeParse(JSON.parse(await readFile(file, "utf8")));
    return parsed.success ? { crop: parsed.data.crop } : "malformed";
  } catch {
    return "malformed";
  }
}

/**
 * A deletion request stays until the API sees the image gone and removes it, so this runs for the
 * same id on several ticks. It only acts while something is left, which makes repeats free, and it
 * also catches files that were written after the request arrived.
 */
async function handleDeletions(deps: LoopDeps): Promise<boolean> {
  let worked = false;
  for (const { id } of await mediaFiles(deps.uploads.deletions)) {
    const leftovers = [deps.store.imageDir(id), deps.store.result(id), deps.store.attempt(id)].filter((target) => existsSync(target));
    if (leftovers.length === 0) continue;
    for (const target of leftovers) await rm(target, { recursive: true, force: true });
    deps.log.info({ id }, "image deleted");
    worked = true;
  }
  return worked;
}

/** One upload, start to finish. The attempt is counted before any decoding, so a file that kills the process cannot loop. */
async function processOne(deps: LoopDeps, id: string): Promise<void> {
  const { store, uploads, log } = deps;
  const attempts = await readAttempts(store, id);
  if (attempts >= MAX_ATTEMPTS) {
    await writeResult(store, { v: RESULT_VERSION, id, status: "failed", reason: "processing_failed" });
    log.warn({ id, attempts }, "upload failed: too many attempts");
    return;
  }
  await writeAtomic(store, store.attempt(id), String(attempts + 1));
  // 2d Task 3: an avatar's upload whose job file cannot be read as a crop fails for good, before any decoder runs.
  const job = await avatarJob(uploads, id);
  if (job === "malformed") {
    await writeResult(store, { v: RESULT_VERSION, id, status: "failed", reason: "processing_failed" });
    log.warn({ id }, "upload failed: its avatar job file is malformed");
    return;
  }

  const started = deps.now();
  const watchdog = setTimeout(() => deps.abort(`upload ${id} took longer than ${deps.watchdogMs} ms`), deps.watchdogMs);
  let processed: Processed;
  try {
    processed = await deps.process(uploads.upload(id), deps.formats, job ?? undefined);
  } catch (err) {
    if (!existsSync(uploads.upload(id))) return; // The API withdrew the upload while it was being read.
    log.error({ id, err }, "processing threw; the upload will be tried again");
    return;
  } finally {
    clearTimeout(watchdog);
  }

  if (!processed.ok) {
    await writeResult(store, { v: RESULT_VERSION, id, status: "failed", reason: processed.reason });
    log.info({ id, reason: processed.reason, ms: deps.now() - started }, "upload refused");
    return;
  }
  await mkdir(store.imageDir(id), { recursive: true });
  await writeAtomic(store, store.image(id, "large"), processed.large);
  await writeAtomic(store, store.image(id, "small"), processed.small);
  // The result is the commit point: it is written last, when both files are in place. 3d Task 6: with the scorer's model
  // and score while one runs. The score is not logged: it is a fact about an image the API alone keeps. 2d Task 3: version
  // 3, and the mark of an avatar's two squares on an avatar's ready result alone, which the API holds against the row's kind.
  await writeResult(store, {
    v: RESULT_VERSION,
    id,
    status: "ready",
    width: processed.width,
    height: processed.height,
    blurhash: processed.blurhash,
    ...(processed.r1 !== undefined ? { r1: processed.r1 } : {}),
    ...(job !== null ? { avatar: true as const } : {}),
  });
  log.info({ id, width: processed.width, height: processed.height, ms: deps.now() - started }, "upload processed");
}

/** A result or an attempt counter whose upload is gone has been consumed by the API, or belongs to an upload it withdrew. */
async function cleanResults(deps: LoopDeps): Promise<void> {
  for (const name of await readdir(deps.store.results).catch(() => [] as string[])) {
    const id = resultFileId(name);
    if (id && !existsSync(deps.uploads.upload(id))) await rm(deps.store.result(id), { force: true });
  }
  for (const id of await readdir(deps.store.attempts).catch(() => [] as string[])) {
    if (isMediaId(id) && !existsSync(deps.uploads.upload(id))) await rm(deps.store.attempt(id), { force: true });
  }
}

/**
 * One pass: deletions, then at most one upload, then result cleanup. Returns whether it did any
 * work, so the caller only sleeps when there was none.
 */
export async function tick(deps: LoopDeps): Promise<boolean> {
  let worked = await handleDeletions(deps);
  // An upload that already has a result is waiting for the API; one with a deletion request is not wanted any more.
  const pending = (await mediaFiles(deps.uploads.incoming)).filter(({ id }) => !existsSync(deps.store.result(id)) && !existsSync(deps.uploads.deletion(id)));
  const next = pending[0];
  if (next) {
    await processOne(deps, next.id);
    worked = true;
  }
  await cleanResults(deps);
  return worked;
}
