# korbat 2b — Task 7 of 17: The worker's loop over the two volumes: attempt cap, atomic writes, deletions, heartbeat and watchdog; Redis and the database leave the worker

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-18 and 2026-09-19 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

The worker's loop over the two volumes: it reads uploads from `media-uploads` (read-only for it) and writes results, files and a heartbeat to `media-store`, always through a temporary file, fsync and rename, so the API never sees half a file. A file gets three attempts, a watchdog ends one that runs past two minutes, and deletion requests are files the worker acts on idempotently. Redis and the database leave the worker entirely; an architecture test proves it cannot import them, and the image builds without install scripts.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. The `install` step runs with `--config.minimum-release-age=0` for that one command, and the `lockfile-age` step then proves that every newly locked version is at least 7 days old. `pnpm-lock.yaml` is written by the install, never by hand. Never edit `pnpm-workspace.yaml` or `.npmrc`, and never add a package this task does not name.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(worker): image pipeline on sharp with a loader allowlist, header pixel caps, EXIF rotation, metadata-free WebP in two sizes and a blurhash`.

## Rules (read twice)

1. Never type a file's content. Every step that writes files starts with a `write_blocks.py` command that copies that step's blocks from this prompt file to disk byte for byte; run it exactly as given and check that it names every file of the step. The blocks are shown below it so you can read what was written. Paths with parentheses or square brackets (expo-router routes) are literal; quote them in shell commands.
2. Run every command exactly as written, in order, from the repo root, without adding filters such as `tail` or `head`.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the tests

```bash
python docs/superpowers/prompts/images-2b/write_blocks.py docs/superpowers/prompts/images-2b/07-worker-loop.md 1
```

Expected: 3 lines starting with `wrote`, one for each file below.

### Create `apps/worker/test/loop.test.ts`

```ts
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import pino from "pino";
import { afterAll, describe, expect, test } from "vitest";
import { Heartbeat, MEDIA_FORMATS, ResultFile, storeLayout, uploadsLayout } from "@korbat/media-protocol";
import { prepareStore, tick, writeHeartbeat, type LoopDeps } from "../src/loop";
import { processImage, configureDecoder, type Processed } from "../src/pipeline";
import * as make from "./fixtures";

const ws = make.workspace();
afterAll(() => ws.remove());

const READY: Processed = { ok: true, width: 800, height: 600, blurhash: "L2Eo_P_3jb_3", small: Buffer.from("small-bytes"), large: Buffer.from("large-bytes") };

/** Two fresh volumes and a loop around a stand-in pipeline, so these tests are about the protocol only. */
async function harness(process: LoopDeps["process"] = async () => READY) {
  const root = path.join(ws.dir, randomUUID());
  const uploads = uploadsLayout(path.join(root, "uploads"));
  const store = storeLayout(path.join(root, "store"));
  for (const dir of [uploads.tmp, uploads.incoming, uploads.deletions]) mkdirSync(dir, { recursive: true });
  await prepareStore(store);
  const calls: string[] = [];
  const aborted: string[] = [];
  let clock = 1_800_000_000_000;
  const deps: LoopDeps = {
    uploads,
    store,
    formats: MEDIA_FORMATS,
    log: pino({ level: "silent" }),
    now: () => (clock += 5),
    process: async (file, formats) => {
      calls.push(path.basename(file));
      return process(file, formats);
    },
    abort: (reason) => void aborted.push(reason),
    watchdogMs: 10_000,
  };
  const upload = (data: Buffer | string = "bytes", id: string = randomUUID()) => {
    writeFileSync(uploads.upload(id), data);
    return id;
  };
  const result = (id: string) => ResultFile.parse(JSON.parse(readFileSync(store.result(id), "utf8")));
  return { deps, uploads, store, upload, result, calls, aborted };
}

describe("processing uploads", () => {
  test("an upload becomes two files and a ready result, and the attempt is counted", async () => {
    const h = await harness();
    const id = h.upload();
    expect(await tick(h.deps)).toBe(true);
    expect(h.result(id)).toEqual({ v: 1, id, status: "ready", width: 800, height: 600, blurhash: "L2Eo_P_3jb_3" });
    expect(readFileSync(h.store.image(id, "large"), "utf8")).toBe("large-bytes");
    expect(readFileSync(h.store.image(id, "small"), "utf8")).toBe("small-bytes");
    expect(readFileSync(h.store.attempt(id), "utf8")).toBe("1");
    expect(readdirSync(h.store.tmp)).toEqual([]);
  });

  test("a refused upload gets a failed result with the reason and no files", async () => {
    const h = await harness(async () => ({ ok: false, reason: "animated_not_supported" }));
    const id = h.upload();
    await tick(h.deps);
    expect(h.result(id)).toEqual({ v: 1, id, status: "failed", reason: "animated_not_supported" });
    expect(existsSync(h.store.imageDir(id))).toBe(false);
  });

  test("an upload with a result is left alone, and an idle tick reports no work", async () => {
    const h = await harness();
    h.upload();
    await tick(h.deps);
    expect(await tick(h.deps)).toBe(false);
    expect(h.calls).toHaveLength(1);
  });

  test("one upload per tick, oldest first", async () => {
    const h = await harness();
    const newer = h.upload("b");
    const older = h.upload("a");
    utimesSync(h.uploads.upload(older), new Date(1_700_000_000_000), new Date(1_700_000_000_000));
    utimesSync(h.uploads.upload(newer), new Date(1_700_000_100_000), new Date(1_700_000_100_000));
    await tick(h.deps);
    expect(h.calls).toEqual([older]);
    await tick(h.deps);
    expect(h.calls).toEqual([older, newer]);
  });

  test("a file that makes processing throw is tried three times and then fails for good", async () => {
    const h = await harness(async () => {
      throw new Error("decoder crashed");
    });
    const id = h.upload();
    for (let i = 0; i < 3; i++) {
      await tick(h.deps);
      expect(existsSync(h.store.result(id))).toBe(false);
    }
    expect(readFileSync(h.store.attempt(id), "utf8")).toBe("3");
    await tick(h.deps);
    expect(h.result(id)).toEqual({ v: 1, id, status: "failed", reason: "processing_failed" });
    expect(h.calls).toHaveLength(3);
  });

  test("the attempt is written before the pipeline runs, so a killed process still counts", async () => {
    let seen = "";
    const h = await harness(async (file) => {
      seen = readFileSync(h.store.attempt(path.basename(file)), "utf8");
      return READY;
    });
    h.upload();
    await tick(h.deps);
    expect(seen).toBe("1");
  });

  test("an unreadable attempt counter counts as used up", async () => {
    const h = await harness();
    const id = h.upload();
    writeFileSync(h.store.attempt(id), "many");
    await tick(h.deps);
    expect(h.result(id)).toMatchObject({ status: "failed", reason: "processing_failed" });
    expect(h.calls).toHaveLength(0);
  });

  test("an upload withdrawn while it was being read leaves nothing behind", async () => {
    const h = await harness(async (file) => {
      const fs = await import("node:fs/promises");
      await fs.rm(file);
      throw new Error("Input file is missing");
    });
    const id = h.upload();
    await tick(h.deps);
    await tick(h.deps);
    expect(existsSync(h.store.result(id))).toBe(false);
    expect(existsSync(h.store.attempt(id))).toBe(false);
    expect(h.calls).toHaveLength(1);
  });

  test("the watchdog ends the process when one upload takes too long", async () => {
    const h = await harness(() => new Promise((resolve) => setTimeout(() => resolve(READY), 120)));
    h.deps.watchdogMs = 30;
    h.upload();
    await tick(h.deps);
    expect(h.aborted).toHaveLength(1);
    expect(h.aborted[0]).toMatch(/took longer than 30 ms/);
  });
});

describe("what the loop ignores", () => {
  test("names that are not media ids, directories, and symlinks", async () => {
    const h = await harness();
    writeFileSync(path.join(h.uploads.incoming, "not-an-id"), "x");
    writeFileSync(path.join(h.uploads.incoming, `${randomUUID()}.part`), "x");
    mkdirSync(path.join(h.uploads.incoming, randomUUID()));
    if (process.platform !== "win32") symlinkSync("/etc/passwd", path.join(h.uploads.incoming, randomUUID()));
    expect(await tick(h.deps)).toBe(false);
    expect(h.calls).toEqual([]);
  });
});

describe("deletion requests", () => {
  test("remove the image folder, the result and the attempt counter, and cost nothing when repeated", async () => {
    const h = await harness();
    const id = h.upload();
    await tick(h.deps);
    writeFileSync(h.uploads.deletion(id), "");
    expect(await tick(h.deps)).toBe(true);
    expect([h.store.imageDir(id), h.store.result(id), h.store.attempt(id)].map((target) => existsSync(target))).toEqual([false, false, false]);
    expect(await tick(h.deps)).toBe(false);
  });

  test("an upload with a deletion request is not processed", async () => {
    const h = await harness();
    const id = h.upload();
    writeFileSync(h.uploads.deletion(id), "");
    expect(await tick(h.deps)).toBe(false);
    expect(h.calls).toEqual([]);
  });

  test("files written after the request arrived are still removed", async () => {
    const h = await harness();
    const id = randomUUID();
    writeFileSync(h.uploads.deletion(id), "");
    await tick(h.deps);
    mkdirSync(h.store.imageDir(id), { recursive: true });
    writeFileSync(h.store.image(id, "large"), "late");
    expect(await tick(h.deps)).toBe(true);
    expect(existsSync(h.store.imageDir(id))).toBe(false);
  });
});

describe("results", () => {
  test("a result whose upload is gone has been consumed and is removed with its counter", async () => {
    const h = await harness();
    const id = h.upload();
    await tick(h.deps);
    const fs = await import("node:fs/promises");
    await fs.rm(h.uploads.upload(id));
    await tick(h.deps);
    expect(existsSync(h.store.result(id))).toBe(false);
    expect(existsSync(h.store.attempt(id))).toBe(false);
    expect(existsSync(h.store.image(id, "large"))).toBe(true);
  });
});

describe("heartbeat and start", () => {
  test("the heartbeat is a small file the API can parse", async () => {
    const h = await harness();
    await writeHeartbeat(h.deps);
    expect(Heartbeat.parse(JSON.parse(readFileSync(h.store.heartbeat, "utf8")))).toMatchObject({ v: 1 });
  });

  test("starting clears half-written files and keeps finished ones", async () => {
    const h = await harness();
    const id = h.upload();
    await tick(h.deps);
    writeFileSync(path.join(h.store.tmp, "half-written"), "x");
    await prepareStore(h.store);
    expect(readdirSync(h.store.tmp)).toEqual([]);
    expect(existsSync(h.store.image(id, "small"))).toBe(true);
  });
});

describe("with the real pipeline", () => {
  test("a JPEG upload ends as WebP files on the store volume", async () => {
    configureDecoder(MEDIA_FORMATS);
    const h = await harness(processImage);
    const id = h.upload(await make.photoWithMetadata());
    const refused = h.upload(make.svg());
    await tick(h.deps);
    await tick(h.deps);
    expect(h.result(id)).toMatchObject({ status: "ready", width: 200, height: 400 });
    expect(readFileSync(h.store.image(id, "large")).subarray(8, 12).toString("latin1")).toBe("WEBP");
    expect(readFileSync(h.store.image(id, "large")).includes(make.SECRET)).toBe(false);
    expect(h.result(refused)).toMatchObject({ status: "failed", reason: "unsupported_format" });
  });
});
```

### Create `apps/worker/test/config.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { loadConfig } from "../src/config";

const base = { MEDIA_UPLOADS_DIR: "/media/uploads", MEDIA_STORE_DIR: "/media/store" };

describe("worker configuration", () => {
  test("two directories are all it needs; every format is enabled by default", () => {
    expect(loadConfig(base)).toEqual({
      production: false,
      logLevel: "info",
      uploadsDir: "/media/uploads",
      storeDir: "/media/store",
      formats: ["jpeg", "png", "webp", "gif", "avif"],
    });
  });

  test("MEDIA_FORMATS enables a subset, and a typo stops the process", () => {
    expect(loadConfig({ ...base, MEDIA_FORMATS: "jpeg,png" }).formats).toEqual(["jpeg", "png"]);
    expect(() => loadConfig({ ...base, MEDIA_FORMATS: "jpeg,heic" })).toThrow(/unknown formats: heic/);
  });

  test("a missing directory is named", () => {
    expect(() => loadConfig({ MEDIA_UPLOADS_DIR: "/media/uploads" })).toThrow(/MEDIA_STORE_DIR/);
    expect(() => loadConfig({ MEDIA_STORE_DIR: "/media/store" })).toThrow(/MEDIA_UPLOADS_DIR/);
  });

  test("production refuses to start unless libvips was told to block untrusted loaders", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "production" })).toThrow(/VIPS_BLOCK_UNTRUSTED/);
    expect(loadConfig({ ...base, NODE_ENV: "production", VIPS_BLOCK_UNTRUSTED: "1" }).production).toBe(true);
  });
});
```

### Create `apps/worker/test/architecture.test.ts`

```ts
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * The worker runs the image decoder, the most exploitable code in korbat. It is built so that a
 * compromise reaches two directories and nothing else. These rules keep it that way: no database,
 * no queue, no network client, no child processes, and the decoder behind one file.
 */
const ROOT = path.resolve(import.meta.dirname, "..");
const ALLOWED_DEPENDENCIES = ["@korbat/contracts", "@korbat/media-protocol", "blurhash", "pino", "sharp", "zod"];
const FORBIDDEN_IMPORTS = [
  /^node:(net|tls|http|https|http2|dgram|dns|child_process|cluster|worker_threads|inspector)$/,
  /^(net|tls|http|https|http2|dgram|dns|child_process|cluster|worker_threads|inspector)$/,
  /^@korbat\/db(\/|$)/,
  /^(ioredis|redis|postgres|pg|drizzle-orm|undici|axios|node-fetch|nodemailer|ws)(\/|$)/,
];
const FORBIDDEN_GLOBALS = /\b(fetch|WebSocket|XMLHttpRequest|EventSource)\s*\(/;

export interface SourceFile {
  path: string;
  source: string;
}

const importsOf = (source: string): string[] =>
  [...source.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g)].map((match) => match[1]!);

export function violations(files: SourceFile[], dependencies: string[]): string[] {
  const found: string[] = [];
  for (const name of dependencies) if (!ALLOWED_DEPENDENCIES.includes(name)) found.push(`package.json: depends on ${name}`);
  for (const file of files) {
    for (const specifier of importsOf(file.source)) {
      if (FORBIDDEN_IMPORTS.some((rule) => rule.test(specifier))) found.push(`${file.path}: imports ${specifier}`);
      if (specifier === "sharp" && file.path !== "pipeline.ts") found.push(`${file.path}: imports sharp, which only pipeline.ts may do`);
    }
    if (FORBIDDEN_GLOBALS.test(file.source)) found.push(`${file.path}: uses a network global`);
  }
  return found;
}

function sourceFiles(dir: string, prefix = ""): SourceFile[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return sourceFiles(path.join(dir, entry.name), rel);
    return entry.name.endsWith(".ts") ? [{ path: rel, source: readFileSync(path.join(dir, entry.name), "utf8") }] : [];
  });
}

describe("worker isolation", () => {
  test("the real source tree and package.json have no violations", () => {
    const manifest = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
    expect(violations(sourceFiles(path.join(ROOT, "src")), Object.keys(manifest.dependencies ?? {}))).toEqual([]);
  });

  test("a database, queue or network dependency is a violation", () => {
    expect(violations([], ["sharp", "ioredis", "@korbat/db"])).toEqual(["package.json: depends on ioredis", "package.json: depends on @korbat/db"]);
  });

  test("network modules, child processes and network globals are violations", () => {
    const files = [
      { path: "a.ts", source: 'import net from "node:net";' },
      { path: "b.ts", source: "const { exec } = require('child_process');" },
      { path: "c.ts", source: 'const https = await import("https");' },
      { path: "d.ts", source: 'await fetch("https://example.com/beacon");' },
      { path: "e.ts", source: 'import { createDb } from "@korbat/db";' },
      { path: "ok.ts", source: 'import path from "node:path";\nimport { readFile } from "node:fs/promises";' },
    ];
    expect(violations(files, [])).toEqual([
      "a.ts: imports node:net",
      "b.ts: imports child_process",
      "c.ts: imports https",
      "d.ts: uses a network global",
      "e.ts: imports @korbat/db",
    ]);
  });

  test("only pipeline.ts may import the decoder", () => {
    expect(violations([{ path: "loop.ts", source: 'import sharp from "sharp";' }], [])).toEqual(["loop.ts: imports sharp, which only pipeline.ts may do"]);
    expect(violations([{ path: "pipeline.ts", source: 'import sharp from "sharp";' }], [])).toEqual([]);
  });
});
```

## Step 2: run the tests and watch them fail

```bash
pnpm --filter @korbat/worker test
```

Expected: the command exits with an error, and the output contains:

- `Cannot find module '../src/loop'`
- `Cannot find module '../src/config'`

Observed on the dry run:

```text
Error: Cannot find module '../src/config' imported from C:\Users\Lenovo\Desktop\cool\korbat/apps/worker/test/config.test.ts
Error: Cannot find module '../src/loop' imported from C:\Users\Lenovo\Desktop\cool\korbat/apps/worker/test/loop.test.ts
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/images-2b/write_blocks.py docs/superpowers/prompts/images-2b/07-worker-loop.md 3
```

Expected: 6 lines starting with `wrote`, one for each file below.

### Create `apps/worker/src/config.ts`

```ts
import { z } from "zod";
import { parseFormats, type MediaFormat } from "@korbat/media-protocol";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  /** The uploads volume, which this process may only read. */
  MEDIA_UPLOADS_DIR: z.string().min(1),
  /** The store volume, the only place this process writes. */
  MEDIA_STORE_DIR: z.string().min(1),
  MEDIA_FORMATS: z.string().optional(),
  VIPS_BLOCK_UNTRUSTED: z.string().optional(),
});

export interface Config {
  production: boolean;
  logLevel: z.infer<typeof schema>["LOG_LEVEL"];
  uploadsDir: string;
  storeDir: string;
  formats: MediaFormat[];
}

/**
 * The worker's whole configuration: two directories, the enabled formats and a log level. It has
 * no database URL, no Redis URL and no keys, by design. libvips reads VIPS_BLOCK_UNTRUSTED when it
 * loads, so it has to be in the environment before the process starts; production refuses to run
 * without it.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  const production = result.data.NODE_ENV === "production";
  if (production && result.data.VIPS_BLOCK_UNTRUSTED === undefined) {
    throw new Error("Invalid environment:\nVIPS_BLOCK_UNTRUSTED must be set before the worker starts");
  }
  return {
    production,
    logLevel: result.data.LOG_LEVEL,
    uploadsDir: result.data.MEDIA_UPLOADS_DIR,
    storeDir: result.data.MEDIA_STORE_DIR,
    formats: parseFormats(result.data.MEDIA_FORMATS),
  };
}
```

### Create `apps/worker/src/loop.ts`

```ts
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "pino";
import { MAX_ATTEMPTS, isMediaId, resultFileId, type Heartbeat, type MediaFormat, type ResultFile, type StoreLayout, type UploadsLayout } from "@korbat/media-protocol";
import type { Processed } from "./pipeline";

export interface LoopDeps {
  uploads: UploadsLayout;
  store: StoreLayout;
  formats: readonly MediaFormat[];
  log: Logger;
  now: () => number;
  /** The image pipeline. Tests pass a stand-in; the process passes processImage. */
  process: (path: string, formats: readonly MediaFormat[]) => Promise<Processed>;
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
    await writeResult(store, { v: 1, id, status: "failed", reason: "processing_failed" });
    log.warn({ id, attempts }, "upload failed: too many attempts");
    return;
  }
  await writeAtomic(store, store.attempt(id), String(attempts + 1));

  const started = deps.now();
  const watchdog = setTimeout(() => deps.abort(`upload ${id} took longer than ${deps.watchdogMs} ms`), deps.watchdogMs);
  let processed: Processed;
  try {
    processed = await deps.process(uploads.upload(id), deps.formats);
  } catch (err) {
    if (!existsSync(uploads.upload(id))) return; // The API withdrew the upload while it was being read.
    log.error({ id, err }, "processing threw; the upload will be tried again");
    return;
  } finally {
    clearTimeout(watchdog);
  }

  if (!processed.ok) {
    await writeResult(store, { v: 1, id, status: "failed", reason: processed.reason });
    log.info({ id, reason: processed.reason, ms: deps.now() - started }, "upload refused");
    return;
  }
  await mkdir(store.imageDir(id), { recursive: true });
  await writeAtomic(store, store.image(id, "large"), processed.large);
  await writeAtomic(store, store.image(id, "small"), processed.small);
  // The result is the commit point: it is written last, when both files are in place.
  await writeResult(store, { v: 1, id, status: "ready", width: processed.width, height: processed.height, blurhash: processed.blurhash });
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
```

### Replace `apps/worker/src/index.ts` (whole file)

```ts
import { setTimeout as sleep } from "node:timers/promises";
import pino from "pino";
import { HEARTBEAT_INTERVAL_MS, storeLayout, uploadsLayout } from "@korbat/media-protocol";
import { loadConfig } from "./config";
import { WATCHDOG_MS, prepareStore, tick, writeHeartbeat, type LoopDeps } from "./loop";
import { configureDecoder, processImage } from "./pipeline";

/**
 * The image worker. It reads uploads from one volume and writes WebP files, results and a
 * heartbeat to another, one image at a time. It has no network, no database and no queue: the two
 * volumes are everything it can reach. See docs/superpowers/specs/2026-09-18-images-2b-design.md.
 */
const config = loadConfig();
const log = pino({ level: config.logLevel, base: undefined });
configureDecoder(config.formats);

const deps: LoopDeps = {
  uploads: uploadsLayout(config.uploadsDir),
  store: storeLayout(config.storeDir),
  formats: config.formats,
  log,
  now: Date.now,
  process: processImage,
  abort: (reason) => {
    log.fatal({ reason }, "watchdog: exiting so the container restarts");
    process.exit(1);
  },
  watchdogMs: WATCHDOG_MS,
};

await prepareStore(deps.store);
await writeHeartbeat(deps);
// The heartbeat has its own timer: decoding runs off the main thread, so it keeps beating during a long image.
const heartbeat = setInterval(() => void writeHeartbeat(deps).catch((err: unknown) => log.error({ err }, "heartbeat failed")), HEARTBEAT_INTERVAL_MS);

let running = true;
const stop = (signal: string) => {
  log.info({ signal }, "stopping after the current image");
  running = false;
};
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));

log.info({ formats: config.formats }, "worker started");
while (running) {
  const worked = await tick(deps).catch((err: unknown) => {
    log.error({ err }, "tick failed");
    return false;
  });
  if (!worked) await sleep(500);
}
clearInterval(heartbeat);
```

### Replace `apps/worker/package.json` (whole file)

```json
{
  "name": "@korbat/worker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsup",
    "start": "node dist/index.js",
    "typecheck": "tsc -p .",
    "test": "vitest run"
  },
  "dependencies": {
    "@korbat/contracts": "workspace:*",
    "@korbat/media-protocol": "workspace:*",
    "blurhash": "2.0.5",
    "pino": "10.3.1",
    "sharp": "0.35.4",
    "zod": "4.5.4"
  },
  "devDependencies": {
    "@types/node": "24.13.3",
    "tsup": "8.5.1",
    "tsx": "4.23.13",
    "typescript": "5.9.3",
    "vitest": "4.1.11"
  }
}
```

### Replace `apps/worker/tsup.config.ts` (whole file)

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  platform: "node",
  target: "node24",
  bundle: true,
  // Everything is bundled except sharp: it loads a platform-specific native binary at runtime, so
  // the Docker image ships it and its platform packages in node_modules next to the bundle.
  noExternal: [/^(?!sharp(?:\/|$)|@img\/)/],
  external: ["sharp"],
  sourcemap: true,
  clean: true,
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
```

### Replace `apps/worker/Dockerfile` (whole file)

```dockerfile
FROM node:24-alpine AS build
RUN npm install -g pnpm@10.30.0
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN pnpm install --frozen-lockfile --filter @korbat/worker...
RUN pnpm --filter @korbat/worker build

FROM node:24-alpine
ENV NODE_ENV=production
# libvips reads this when it loads, so it has to be in the environment before the process starts.
ENV VIPS_BLOCK_UNTRUSTED=1
WORKDIR /app
COPY --from=build /repo/apps/worker/dist ./dist
# sharp is not bundled (native module). The install above ran on Alpine, so @img holds exactly the
# musl binaries for this image's CPU architecture. detect-libc and semver are what sharp itself needs.
COPY --from=build /repo/node_modules/sharp ./node_modules/sharp
COPY --from=build /repo/node_modules/@img ./node_modules/@img
COPY --from=build /repo/node_modules/detect-libc ./node_modules/detect-libc
COPY --from=build /repo/node_modules/semver ./node_modules/semver
# The volumes mount here. A new volume takes the owner of the path in the image, so both paths
# exist and belong to the user the process runs as, in this image and in the API's.
RUN mkdir -p /media/uploads /media/store && chown node:node /media/uploads /media/store
USER node
CMD ["node", "dist/index.js"]
```

## Step 4: delete `apps/worker/src/jobs.ts`

```bash
git rm -q "apps/worker/src/jobs.ts"
```

Expected: no output.

## Step 5: delete `apps/worker/test/jobs.test.ts`

```bash
git rm -q "apps/worker/test/jobs.test.ts"
```

Expected: no output.

## Step 6: verify: install

```bash
pnpm install --config.minimum-release-age=0
```

Expected output contains:

- `Done in`

Must not contain:

- `ERR_PNPM`

Observed on the dry run:

```text
Done in 7.8s using pnpm v10.30.0
```

## Step 7: verify: lockfile-age

```bash
node scripts/check-lockfile-age.mjs --base HEAD
```

Expected output contains:

- `0 new package versions since HEAD`

Observed on the dry run:

```text
0 new package versions since HEAD; all at least 7 days old
```

## Step 8: verify: test

```bash
pnpm --filter @korbat/worker test
```

Expected output contains:

- `Tests  45 passed (45)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  45 passed (45)
```

## Step 9: verify: typecheck

```bash
pnpm --filter @korbat/worker typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`

Observed on the dry run:

```text
(no output)
```

## Step 10: verify: deliberate-violation

```bash
printf 'import net from "node:net";
export const socket = net;
' > apps/worker/src/zz-violation.ts; pnpm --filter @korbat/worker exec vitest run test/architecture.test.ts; rm -f apps/worker/src/zz-violation.ts; echo "violation file present: $(ls apps/worker/src/zz-violation.ts 2>/dev/null | wc -l)"
```

Expected output contains:

- `zz-violation.ts: imports node:net`
- `Tests  1 failed | 3 passed (4)`
- `violation file present: 0`

Observed on the dry run:

```text
Tests  1 failed | 3 passed (4)
violation file present: 0
AssertionError: expected [ 'zz-violation.ts: imports node:net' ] to deeply equal []
+   "zz-violation.ts: imports node:net",
```

## Step 11: verify: build

```bash
pnpm --filter @korbat/worker build && echo "sharp left external: $(grep -c 'from "sharp"' apps/worker/dist/index.js)" && echo "database or redis in the bundle: $(grep -c -E 'ioredis|postgres|drizzle' apps/worker/dist/index.js)"
```

Expected output contains:

- `Build success`
- `sharp left external: 1`
- `database or redis in the bundle: 0`

Observed on the dry run:

```text
ESM ⚡️ Build success in 155ms
sharp left external: 1
database or redis in the bundle: 0
```

## Step 12: verify: image

```bash
docker build -q -f apps/worker/Dockerfile -t korbat-worker-check . >/dev/null && MSYS_NO_PATHCONV=1 docker run --rm --network none --read-only --tmpfs /tmp korbat-worker-check node -e "const sharp = require('sharp'); console.log('sharp', sharp.versions.sharp, 'on', require('detect-libc').familySync(), 'as uid', process.getuid(), 'untrusted loaders blocked:', process.env.VIPS_BLOCK_UNTRUSTED); require('fs').statSync('/media/store').uid === 1000 && console.log('volume paths belong to node');"; docker rmi -f korbat-worker-check >/dev/null
```

Expected output contains:

- `sharp 0.35.4 on musl as uid 1000 untrusted loaders blocked: 1`
- `volume paths belong to node`

Allowed difference: Building the worker image can take several minutes.

Observed on the dry run:

```text
sharp 0.35.4 on musl as uid 1000 untrusted loaders blocked: 1
volume paths belong to node
```

## Step 13: verify: frozen-install

```bash
pnpm install --frozen-lockfile
```

Expected output contains:

- `Done in`

Must not contain:

- `ERR_PNPM`

Observed on the dry run:

```text
Done in 5.2s using pnpm v10.30.0
```

## Step 14: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/worker/Dockerfile`
- `apps/worker/package.json`
- `apps/worker/src/config.ts`
- `apps/worker/src/index.ts`
- `apps/worker/src/jobs.ts`
- `apps/worker/src/loop.ts`
- `apps/worker/test/architecture.test.ts`
- `apps/worker/test/config.test.ts`
- `apps/worker/test/jobs.test.ts`
- `apps/worker/test/loop.test.ts`
- `apps/worker/tsup.config.ts`
- `pnpm-lock.yaml`

`git rm` stages the deletion, so `apps/worker/src/jobs.ts` and `apps/worker/test/jobs.test.ts` shows with a `D` in the first column. That line is expected.

## Step 15: commit

```bash
git add -A
git commit -q -m "feat(worker): file-protocol loop with an attempt cap, atomic writes, deletion requests, heartbeat and watchdog; the worker drops Redis and the database" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(worker): file-protocol loop with an attempt cap, atomic writes, deletion requests, heartbeat and watchdog; the worker drops Redis and the database`.

## Report format (mandatory)

```text
TASK 7 REPORT
Files written: <count, expected 9>
Failing-test step (the error line): <paste>
Verify "install": <paste the expected lines as printed>
Verify "lockfile-age": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "typecheck": <paste the expected lines as printed>
Verify "deliberate-violation": <paste the expected lines as printed>
Verify "build": <paste the expected lines as printed>
Verify "image": <paste the expected lines as printed>
Verify "frozen-install": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
