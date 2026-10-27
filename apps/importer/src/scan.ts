import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, type FileHandle } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "pino";
import { IMPORT_RULES, ImportSummary, type ImportFailure, type ImportSource } from "@korbat/contracts";
import { SCAN_MAX_ATTEMPTS, openWorkFile, readJobFile, type ArchivesLayout, type WorkLayout } from "@korbat/import-protocol";
import { blueskyAdapter } from "./adapters/bluesky/index";
import { mastodonAdapter } from "./adapters/mastodon/index";
import { ScanAborted, ScanFailure, type AllowedArchive, type SourceAdapter } from "./adapters/types";
import { xAdapter } from "./adapters/x/index";
import { openCar, looksLikeCar } from "./car/reader";
import { ScanCore, type CoreHooks } from "./core";
import { readAt } from "./zip/central";
import { openZip } from "./zip/entry";

/**
 * One scan (3b design, 7.1's four steps): (1) the attempt is counted first, and a third start writes the summary
 * `failed: interrupted` without opening the archive, so a file that kills the process cannot loop; (2) job.json is read
 * (at most 4 KiB, its schema) and any earlier output of the job cleared, and the archive opened by file descriptor;
 * (3) the zip or CAR reader, the adapter and the core write posts.jsonl and the images; (4) summary.json, the commit
 * point, is written last. The scratch file is deleted when the scan ends. What reaches the log is the job id, the
 * phase, timings, the failure code, the counts once at the end, and an error's class or code: never its message.
 */

export const ADAPTERS: Readonly<Record<ImportSource, SourceAdapter>> = { x: xAdapter, mastodon: mastodonAdapter, bluesky: blueskyAdapter };

export interface ScanHooks extends CoreHooks {
  /** Tests only: called with the scratch file's path just before it is deleted, so a test can read it first. */
  scratch?(file: string): void | Promise<void>;
  /** Tests only: called after the attempt was counted and before anything is opened; a throw stands in for a crash. */
  attempted?(attempts: number): void;
}

export interface ScanDeps {
  archives: ArchivesLayout;
  work: WorkLayout;
  log: Logger;
  hooks?: ScanHooks | undefined;
}

/** scanned or failed: a summary was written. aborted: a deletion request ended it. retry: it broke and will start again. */
export type ScanOutcome = "scanned" | "failed" | "aborted" | "retry";

/** Write under tmp/, flush, rename: the API never sees half a file, and a finished file survives a power cut. */
export async function writeAtomic(work: WorkLayout, target: string, data: string): Promise<void> {
  const temporary = path.join(work.tmp, randomUUID());
  const handle = await open(temporary, "w");
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, target);
}

/** An error as the log may show it: a system code (ENOSPC) or the error's class, never its message. */
export function errorCode(caught: unknown): string {
  const code = (caught as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[A-Z0-9_]{1,40}$/.test(code)) return code;
  return caught instanceof Error ? caught.constructor.name : "unknown";
}

async function readAttempts(work: WorkLayout, id: string): Promise<number> {
  const text = await readFile(work.attempt(id), "utf8").catch(() => "0");
  const count = Number.parseInt(text, 10);
  // A counter that is not a number is treated as spent, as the worker treats its own.
  return Number.isInteger(count) && count >= 0 ? count : SCAN_MAX_ATTEMPTS;
}

/** Empties the job's folder of the work volume: an earlier output, or a part of this scan's. */
async function clearOutput(work: WorkLayout, id: string): Promise<void> {
  await rm(work.jobDir(id), { recursive: true, force: true });
  await mkdir(work.jobDir(id), { recursive: true });
}

async function writeFailed(deps: ScanDeps, id: string, failure: ImportFailure): Promise<void> {
  const { work } = deps;
  await clearOutput(work, id);
  await writeAtomic(work, work.summary(id), JSON.stringify({ v: 1, id, status: "failed", failure } satisfies ImportSummary));
  deps.hooks?.placed?.("summary.json");
  deps.log.info({ id, phase: "failed", failure }, "scan failed");
}

const ZIP = [0x50, 0x4b];
const GZIP = [0x1f, 0x8b];
const starts = (head: Buffer, bytes: number[]) => bytes.every((byte, i) => head[i] === byte);

/** What the first bytes say: a zip (a local header, or the end record of an empty one), a CAR, a gzip, or none of them. */
function kindOf(head: Buffer): "zip" | "car" | "gzip" | null {
  if (starts(head, GZIP)) return "gzip";
  if (starts(head, ZIP) && (starts(head.subarray(2), [3, 4]) || starts(head.subarray(2), [5, 6]))) return "zip";
  if (looksLikeCar(head)) return "car";
  return null;
}

export async function scanJob(deps: ScanDeps, id: string, signal: AbortSignal): Promise<ScanOutcome> {
  const { archives, work, log, hooks } = deps;
  const started = Date.now();
  await mkdir(work.attempts, { recursive: true });
  await mkdir(work.tmp, { recursive: true });
  const attempts = (await readAttempts(work, id)) + 1;
  await writeAtomic(work, work.attempt(id), String(attempts));
  log.info({ id, phase: "started", attempts }, "scan started");
  if (attempts >= SCAN_MAX_ATTEMPTS) {
    await writeFailed(deps, id, "interrupted");
    return "failed";
  }

  let failure: ImportFailure | null = null;
  let aborted = false;
  let core: ScanCore | null = null;
  let file: FileHandle | null = null;
  try {
    hooks?.attempted?.(attempts);
    if (signal.aborted) throw new ScanAborted();
    const job = await readJobFile(archives.root, id);
    if (!job.ok) throw new ScanFailure("unreadable");
    await clearOutput(work, id);
    const opened = await openWorkFile(archives.root, archives.archive(id), IMPORT_RULES.maxBytes);
    if (!opened.ok) throw new ScanFailure("unreadable");
    file = opened.file.handle;
    const size = opened.file.size;
    const { source, images } = job.value;
    const adapter = ADAPTERS[source];

    const kind = kindOf(await readAt(file, 0, 16));
    if (kind === "gzip") throw new ScanFailure("tar_gz");
    if (kind === null) throw new ScanFailure("not_an_archive");
    if ((kind === "car") !== (source === "bluesky")) throw new ScanFailure("not_this_source");

    let archive: AllowedArchive;
    if (kind === "zip") {
      archive = await openZip(file, size, { rules: adapter.allowlist, images, detect: (entries) => adapter.detect(entries) });
      // Their count only: a refused name itself never reaches the log.
      const refused = archive.refusedNames;
      if (refused > 0) log.info({ id, phase: "listed", refusedNames: refused }, "entries with refused names were passed over");
    } else {
      archive = await openCar(file, size);
      const refusal = adapter.detect(archive.entries);
      if (refusal) throw new ScanFailure(refusal);
    }

    core = new ScanCore({
      id,
      work,
      source,
      accountKey: Buffer.from(job.value.accountKey, "hex"),
      createdAt: new Date(job.value.createdAt),
      images,
      log,
      signal,
      archive: archive.kind === "zip" ? archive : undefined,
      hooks,
    });
    await core.open();
    for await (const item of adapter.readPosts(archive, core.context)) await core.add(item);
    const counts = await core.finish();
    if (counts.posts === 0) throw new ScanFailure("nothing_to_import");
    const summary = ImportSummary.safeParse({ v: 1, id, status: "scanned", ...counts });
    if (!summary.success) throw new ScanFailure("unreadable");
    await writeAtomic(work, work.summary(id), JSON.stringify(summary.data));
    hooks?.placed?.("summary.json");
    const { posts, images: written, skipped, imagesSkipped, cleaned, warnings, sourceLinks, protectedPosts, readInPart } = counts;
    log.info(
      { id, phase: "scanned", ms: Date.now() - started, posts, images: written, skipped, imagesSkipped, cleaned, warnings, sourceLinks, protectedPosts, readInPart },
      "scan ended",
    );
    return "scanned";
  } catch (caught) {
    if (caught instanceof ScanAborted) aborted = true;
    else if (caught instanceof ScanFailure) failure = caught.code;
    else {
      log.error({ id, phase: "broken", error: errorCode(caught) }, "scan broke; it will start again");
      return "retry";
    }
  } finally {
    if (core) {
      await hooks?.scratch?.(work.scratch(id));
      await core.close();
    }
    await file?.close();
  }
  if (aborted) {
    await rm(work.jobDir(id), { recursive: true, force: true });
    log.info({ id, phase: "aborted" }, "scan aborted by a deletion request");
    return "aborted";
  }
  await writeFailed(deps, id, failure!);
  return "failed";
}
