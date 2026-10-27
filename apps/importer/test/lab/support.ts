import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import type { ImportSource, ImportSummary } from "@korbat/contracts";
import { archivesLayout, workLayout, type ArchivesLayout, type WorkLayout } from "@korbat/import-protocol";
import { ACCOUNT_KEY } from "../fixtures/canaries";

/**
 * What the importer's labs share (3b design, 12.5; test/lab/README.md): the lab folder (the named volume the Docker run
 * mounts at LAB_DIR, or a folder of the system's temporary one), the tool bundled into it, and one scan in a process of
 * its own whose time and peak memory are recorded, one line of JSON each, in <LAB_DIR>/lab-importer.jsonl.
 */

export const LAB_DIR = process.env.LAB_DIR ?? path.join(tmpdir(), "korbat-importer-lab");
const TOOL = path.join(LAB_DIR, "tool.mjs");
const MB = 1_048_576;
const LF = String.fromCharCode(10);

/** Bundles test/lab/tool.ts into the lab folder, as build.mjs bundles the importer. */
export async function buildTool(): Promise<void> {
  mkdirSync(LAB_DIR, { recursive: true });
  await build({
    entryPoints: [path.join(import.meta.dirname, "tool.ts")],
    outfile: TOOL,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node24",
    packages: "bundle",
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    logLevel: "warning",
  });
}

/** Runs the tool with `args` in a process of its own and returns its last line of output, parsed. */
export function runTool<T>(args: readonly string[], timeoutMs = 3_600_000): Promise<T> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ["--expose-gc", TOOL, ...args], { maxBuffer: 16 * MB, timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`tool ${args[0]} failed: ${err.message} ${stderr}`));
      const lines = stdout.trim().split(LF);
      resolve(JSON.parse(lines.at(-1) ?? "null") as T);
    });
  });
}

export interface Volumes {
  root: string;
  archives: ArchivesLayout;
  work: WorkLayout;
}

/** Two fresh volumes under the lab folder, and an import id with its folder ready for an archive. */
export function labVolumes(): Volumes & { id: string } {
  const root = path.join(LAB_DIR, `run-${randomUUID()}`);
  const archives = archivesLayout(path.join(root, "archives"));
  const work = workLayout(path.join(root, "work"));
  for (const dir of [archives.jobs, archives.queue, archives.deletions, work.jobs, work.attempts, work.tmp]) mkdirSync(dir, { recursive: true });
  const id = randomUUID();
  mkdirSync(archives.jobDir(id), { recursive: true });
  return { root, archives, work, id };
}

export function writeJob(volumes: Volumes & { id: string }, source: ImportSource, images: boolean): void {
  const { archives, id } = volumes;
  writeFileSync(archives.job(id), JSON.stringify({ v: 1, id, source, accountKey: ACCOUNT_KEY, images, createdAt: new Date().toISOString() }));
  writeFileSync(archives.queued(id), "");
}

export interface Measurement {
  outcome: string;
  ms: number;
  rssBefore: number;
  maxRss: number;
  peak: number;
  summary: ImportSummary | null;
}

/** One scan of the archive already at the job's path, in a process of its own. */
export function measure(volumes: Volumes & { id: string }): Promise<Measurement> {
  return runTool<Measurement>(["scan", volumes.archives.root, volumes.work.root, volumes.id]);
}

/** Every file under `dir`, relative to it, with forward slashes. */
export function filesUnder(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? [rel + "/", ...filesUnder(path.join(dir, entry.name), rel)] : [rel];
  });
}

export const megabytes = (bytes: number) => Math.round((bytes / MB) * 10) / 10;

/** Writes one measurement to the lab's record and to the run's output. */
export function record(lab: string, name: string, archiveBytes: number, measurement: Measurement): void {
  const line = {
    lab,
    name,
    at: new Date().toISOString(),
    archiveMb: megabytes(archiveBytes),
    outcome: measurement.outcome,
    failure: measurement.summary?.status === "failed" ? measurement.summary.failure : null,
    posts: measurement.summary?.status === "scanned" ? measurement.summary.posts : null,
    images: measurement.summary?.status === "scanned" ? measurement.summary.images : null,
    skipped: measurement.summary?.status === "scanned" ? measurement.summary.skipped : null,
    ms: measurement.ms,
    rssBeforeMb: megabytes(measurement.rssBefore),
    maxRssMb: megabytes(measurement.maxRss),
    peakMb: megabytes(measurement.peak),
  };
  appendFileSync(path.join(LAB_DIR, "lab-importer.jsonl"), JSON.stringify(line) + LF);
  console.log(JSON.stringify(line));
}

export const sizeOf = (file: string) => statSync(file).size;
export const removeRun = (volumes: Volumes) => rmSync(volumes.root, { recursive: true, force: true });
