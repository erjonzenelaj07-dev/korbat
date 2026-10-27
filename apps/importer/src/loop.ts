import { existsSync } from "node:fs";
import { lstat, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "pino";
import { isImportId, type ArchivesLayout, type ImporterHeartbeat, type WorkLayout } from "@korbat/import-protocol";
import { errorCode, scanJob, writeAtomic, type ScanHooks, type ScanOutcome } from "./scan";

/**
 * The importer's loop (3b design, 7.1), after the image worker's: each tick handles deletion requests first (removing a
 * work folder the API no longer wants), then scans at most one archive from queue/ whose job has no summary and no
 * deletion request, oldest marker first, then forgets the attempt counters of archives the API has deleted. While a
 * scan runs, the loop looks for a deletion request for that archive every idleMs and aborts the scan when one comes, and
 * a watchdog of watchdogMs ends the process (Docker restarts it, and the attempt counter does the rest). The importer
 * mounts import-archives read-only: the archive, its queue marker and the request itself are the API's to delete.
 */

export interface LoopDeps {
  archives: ArchivesLayout;
  work: WorkLayout;
  log: Logger;
  now: () => number;
  /** The sleep when idle, and how often a running scan looks for a deletion request. */
  idleMs: number;
  watchdogMs: number;
  /** Ends the process when one scan takes too long. */
  abort: (reason: string) => void;
  /** Tests only: a stand-in for the scan. */
  scan?: (id: string, signal: AbortSignal) => Promise<ScanOutcome>;
  hooks?: ScanHooks | undefined;
}

/** Creates the work volume's folders and forgets files a crash left half written. */
export async function prepareWork(work: WorkLayout): Promise<void> {
  await rm(work.tmp, { recursive: true, force: true });
  for (const dir of [work.jobs, work.attempts, work.tmp]) await mkdir(dir, { recursive: true });
}

/** { v: 1, at } in epoch milliseconds, which the Compose healthcheck and the API read. */
export async function writeHeartbeat(deps: Pick<LoopDeps, "work" | "now">): Promise<void> {
  const beat: ImporterHeartbeat = { v: 1, at: deps.now() };
  await writeAtomic(deps.work, deps.work.heartbeat, JSON.stringify(beat));
}

/** Names in a folder that are import ids and regular files, oldest first. Anything else, a symlink included, is ignored. */
async function idFiles(dir: string): Promise<string[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const found: { id: string; mtimeMs: number }[] = [];
  for (const name of names) {
    if (!isImportId(name)) continue;
    const stats = await lstat(path.join(dir, name)).catch(() => null);
    if (stats?.isFile()) found.push({ id: name, mtimeMs: stats.mtimeMs });
  }
  return found.sort((a, b) => a.mtimeMs - b.mtimeMs || a.id.localeCompare(b.id)).map(({ id }) => id);
}

/**
 * A request stays until the API sees it carried out and withdraws it (7.5 step 8), so this runs for the same id on
 * several ticks; it only acts while the work folder is there, which makes repeats free.
 */
async function handleDeletions(deps: LoopDeps): Promise<boolean> {
  let worked = false;
  for (const id of await idFiles(deps.archives.deletions)) {
    if (!existsSync(deps.work.jobDir(id))) continue;
    await rm(deps.work.jobDir(id), { recursive: true, force: true });
    deps.log.info({ id, phase: "deleted" }, "work folder deleted");
    worked = true;
  }
  return worked;
}

/** An attempt counter outlives its scan until the API deletes the archive's folder. */
async function cleanAttempts(deps: LoopDeps): Promise<void> {
  for (const id of await readdir(deps.work.attempts).catch(() => [] as string[])) {
    if (isImportId(id) && !existsSync(deps.archives.jobDir(id))) await rm(deps.work.attempt(id), { force: true });
  }
}

async function scanOne(deps: LoopDeps, id: string): Promise<void> {
  const controller = new AbortController();
  const deletion = deps.archives.deletion(id);
  const poll = setInterval(() => {
    if (existsSync(deletion)) controller.abort();
  }, deps.idleMs);
  const watchdog = setTimeout(() => deps.abort(`scan of ${id} took longer than ${deps.watchdogMs} ms`), deps.watchdogMs);
  try {
    const scan = deps.scan ?? ((job: string, signal: AbortSignal) => scanJob({ archives: deps.archives, work: deps.work, log: deps.log, hooks: deps.hooks }, job, signal));
    await scan(id, controller.signal);
  } catch (caught) {
    deps.log.error({ id, phase: "broken", error: errorCode(caught) }, "scan threw; it will start again");
  } finally {
    clearInterval(poll);
    clearTimeout(watchdog);
  }
}

/** One pass: deletions, then at most one scan, then attempt cleanup. Returns whether it did any work. */
export async function tick(deps: LoopDeps): Promise<boolean> {
  let worked = await handleDeletions(deps);
  // A job with a summary waits for the API; one with a deletion request is not wanted any more.
  const pending = (await idFiles(deps.archives.queue)).filter((id) => !existsSync(deps.work.summary(id)) && !existsSync(deps.archives.deletion(id)));
  const next = pending[0];
  if (next) {
    await scanOne(deps, next);
    worked = true;
  }
  await cleanAttempts(deps);
  return worked;
}
