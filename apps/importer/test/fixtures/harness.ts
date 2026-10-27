import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import pino, { type Logger } from "pino";
import { ImportedPost, ImportSummary, type ImportSource } from "@korbat/contracts";
import { archivesLayout, workLayout, type ArchivesLayout, type WorkLayout } from "@korbat/import-protocol";
import { scanJob, type ScanHooks, type ScanOutcome } from "../../src/scan";
import { ACCOUNT_KEY, CREATED_AT } from "./canaries";

/** A temporary folder for one test file, removed when it ends. */
export function workspace() {
  const dir = mkdtempSync(path.join(tmpdir(), "korbat-importer-"));
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

/** A logger whose every line lands in `lines`, as the process's stdout would carry them. */
export function capturingLogger(level: pino.Level = "trace"): { log: Logger; lines: string[] } {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString("utf8"));
      done();
    },
  });
  return { log: pino({ level, base: undefined }, sink), lines };
}

/** Two fresh volumes in `dir`: import-archives and import-work, as the importer sees them. */
export function volumes(dir: string): { archives: ArchivesLayout; work: WorkLayout } {
  const root = path.join(dir, randomUUID());
  const archives = archivesLayout(path.join(root, "archives"));
  const work = workLayout(path.join(root, "work"));
  for (const folder of [archives.jobs, archives.queue, archives.deletions, work.jobs, work.attempts, work.tmp]) mkdirSync(folder, { recursive: true });
  return { archives, work };
}

export interface JobOptions {
  source: ImportSource;
  archive: Buffer;
  images?: boolean;
  createdAt?: string;
  accountKey?: string;
  id?: string;
  /** Leave the queue marker out. */
  unqueued?: boolean;
}

/** Writes what the API writes for one import: the archive, job.json and the queue marker. */
export function placeJob(archives: ArchivesLayout, options: JobOptions): string {
  const id = options.id ?? randomUUID();
  mkdirSync(archives.jobDir(id), { recursive: true });
  writeFileSync(archives.archive(id), options.archive);
  writeFileSync(
    archives.job(id),
    JSON.stringify({ v: 1, id, source: options.source, accountKey: options.accountKey ?? ACCOUNT_KEY, images: options.images ?? false, createdAt: options.createdAt ?? CREATED_AT }),
  );
  if (options.unqueued !== true) writeFileSync(archives.queued(id), "");
  return id;
}

export interface ScanResult {
  id: string;
  outcome: ScanOutcome;
  summary: ImportSummary | null;
  /** posts.jsonl's raw text, and each line parsed with the contract (every line must parse). */
  raw: string;
  lines: ImportedPost[];
  media: Map<string, Buffer>;
  logs: string[];
  /** The scratch file as it was just before the scan deleted it. */
  scratch: Buffer | null;
  archives: ArchivesLayout;
  work: WorkLayout;
}

export function readOutput(work: WorkLayout, id: string): Pick<ScanResult, "summary" | "raw" | "lines" | "media"> {
  const summaryPath = work.summary(id);
  const summary = existsSync(summaryPath) ? ImportSummary.parse(JSON.parse(readFileSync(summaryPath, "utf8"))) : null;
  const raw = existsSync(work.posts(id)) ? readFileSync(work.posts(id), "utf8") : "";
  const lines = raw === "" ? [] : raw.split(String.fromCharCode(10)).filter((line) => line !== "").map((line) => ImportedPost.parse(JSON.parse(line)));
  const media = new Map<string, Buffer>();
  if (existsSync(work.mediaDir(id))) for (const name of readdirSync(work.mediaDir(id))) media.set(name, readFileSync(path.join(work.mediaDir(id), name)));
  return { summary, raw, lines, media };
}

/** One scan of a code-built archive, start to finish, through the importer's own scan with a capturing logger. */
export async function runScan(dir: string, options: JobOptions & { hooks?: ScanHooks; signal?: AbortSignal }): Promise<ScanResult> {
  const { archives, work } = volumes(dir);
  const id = placeJob(archives, options);
  const { log, lines: logs } = capturingLogger();
  let scratch: Buffer | null = null;
  const hooks: ScanHooks = {
    ...options.hooks,
    scratch: async (file) => {
      scratch = existsSync(file) ? readFileSync(file) : null;
      await options.hooks?.scratch?.(file);
    },
  };
  const outcome = await scanJob({ archives, work, log, hooks }, id, options.signal ?? new AbortController().signal);
  return { id, outcome, ...readOutput(work, id), logs, scratch, archives, work };
}

/** The line whose text contains `fragment`; fails the test when there is none or more than one. */
export function lineWith(lines: readonly ImportedPost[], fragment: string): ImportedPost {
  const found = lines.filter((line) => line.text.includes(fragment));
  if (found.length !== 1) throw new Error(`expected one line with "${fragment}", found ${found.length}`);
  return found[0]!;
}

/** The scanned summary, or a failure naming what came instead. */
export function scanned(result: ScanResult) {
  if (result.summary?.status !== "scanned") throw new Error(`expected a scanned summary, got ${JSON.stringify(result.summary)} (${result.outcome})`);
  return result.summary;
}
