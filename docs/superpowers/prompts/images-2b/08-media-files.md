# korbat 2b — Task 8 of 17: The API's side of the file protocol: streamed uploads with a byte count, safe reads of the untrusted store, deletion requests, heartbeat and free space

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-18 and 2026-09-19 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

The API's side of the protocol. Uploads stream to the uploads volume with a byte count that stops a body at the limit even without a length header, and the first bytes are sniffed before anything is kept. The store is written by another container and therefore untrusted: files are opened without following symlinks, and the open handle must be a regular file on the store's own device and within the size bound. Deletion requests, the heartbeat's age and free space complete the file layer.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. The `install` step runs with `--config.minimum-release-age=0` for that one command, and the `lockfile-age` step then proves that every newly locked version is at least 7 days old. `pnpm-lock.yaml` is written by the install, never by hand. Never edit `pnpm-workspace.yaml` or `.npmrc`, and never add a package this task does not name.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(worker): file-protocol loop with an attempt cap, atomic writes, deletion requests, heartbeat and watchdog; the worker drops Redis and the database`.

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
python docs/superpowers/prompts/images-2b/write_blocks.py docs/superpowers/prompts/images-2b/08-media-files.md 1
```

Expected: 3 lines starting with `wrote`, one for each file below.

### Create `apps/api/test/media/files.test.ts`

```ts
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterAll, describe, expect, test } from "vitest";
import { MAX_VARIANT_BYTES, SNIFF_BYTES } from "@korbat/media-protocol";
import { MediaError } from "../../src/media/context";
import { createMediaFiles } from "../../src/media/files";

const root = mkdtempSync(path.join(tmpdir(), "korbat-media-files-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

async function volumes(storeDevice?: number) {
  const base = path.join(root, randomUUID());
  const files = createMediaFiles({ uploadsDir: path.join(base, "uploads"), storeDir: path.join(base, "store"), log: pino({ level: "silent" }), storeDevice });
  await files.prepare();
  for (const dir of [files.store.files, files.store.results, files.store.attempts, files.store.tmp]) mkdirSync(dir, { recursive: true });
  return files;
}

/** A body that arrives in chunks and declares no length, like a chunked upload. */
function chunked(...chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
      controller.close();
    },
  });
}
const accept = () => undefined;

describe("receiving an upload", () => {
  test("the body is streamed to tmp/ and only becomes an upload when committed", async () => {
    const files = await volumes();
    const id = randomUUID();
    expect(await files.receive(id, chunked("hello ", "world"), 100, accept)).toBe(11);
    expect(readFileSync(files.uploads.part(id), "utf8")).toBe("hello world");
    expect(existsSync(files.uploads.upload(id))).toBe(false);
    await files.commit(id);
    expect(readFileSync(files.uploads.upload(id), "utf8")).toBe("hello world");
    expect(existsSync(files.uploads.part(id))).toBe(false);
  });

  test("the first bytes are judged before anything is written", async () => {
    const files = await volumes();
    const id = randomUUID();
    let seen = 0;
    let onDisk = true;
    const body = chunked(new Uint8Array(200).fill(1), new Uint8Array(200).fill(2), new Uint8Array(200).fill(3));
    await files.receive(id, body, 10_000, (head) => {
      seen = head.byteLength;
      onDisk = existsSync(files.uploads.part(id));
    });
    expect(seen).toBe(SNIFF_BYTES);
    expect(onDisk).toBe(false);
    expect(statSync(files.uploads.part(id)).size).toBe(600);
  });

  test("a refused head leaves no file behind", async () => {
    const files = await volumes();
    const id = randomUUID();
    const refuse = () => {
      throw new MediaError("unsupported_media_type", 415);
    };
    await expect(files.receive(id, chunked("%PDF-1.7"), 100, refuse)).rejects.toMatchObject({ code: "unsupported_media_type", status: 415 });
    expect(readdirSync(files.uploads.tmp)).toEqual([]);
  });

  test("an empty or missing body reaches the judge as zero bytes", async () => {
    const files = await volumes();
    const heads: number[] = [];
    await files.receive(randomUUID(), chunked(), 100, (head) => void heads.push(head.byteLength));
    await files.receive(randomUUID(), null, 100, (head) => void heads.push(head.byteLength));
    expect(heads).toEqual([0, 0]);
  });

  test("bytes are counted as they arrive: one byte over the limit ends the upload and removes the file", async () => {
    const files = await volumes();
    const id = randomUUID();
    const kib = new Uint8Array(1024);
    await expect(files.receive(id, chunked(kib, kib, kib, new Uint8Array(1)), 3 * 1024, accept)).rejects.toMatchObject({ code: "file_too_large", status: 413 });
    expect(readdirSync(files.uploads.tmp)).toEqual([]);
    expect(await files.receive(randomUUID(), chunked(kib, kib, kib), 3 * 1024, accept)).toBe(3 * 1024);
  });

  test("the same id cannot be received twice", async () => {
    const files = await volumes();
    const id = randomUUID();
    await files.receive(id, chunked("a"), 100, accept);
    await expect(files.receive(id, chunked("b"), 100, accept)).rejects.toMatchObject({ code: "EEXIST" });
  });

  test("discarding removes an upload whether it was committed or not", async () => {
    const files = await volumes();
    const [partial, complete] = [randomUUID(), randomUUID()];
    await files.receive(partial, chunked("a"), 100, accept);
    await files.receive(complete, chunked("b"), 100, accept);
    await files.commit(complete);
    await files.discardUpload(partial);
    await files.discardUpload(complete);
    await files.discardUpload(randomUUID());
    expect([...readdirSync(files.uploads.tmp), ...readdirSync(files.uploads.incoming)]).toEqual([]);
  });

  test("preparing again clears half-received bodies and keeps complete uploads", async () => {
    const files = await volumes();
    const [partial, complete] = [randomUUID(), randomUUID()];
    await files.receive(partial, chunked("a"), 100, accept);
    await files.receive(complete, chunked("b"), 100, accept);
    await files.commit(complete);
    await files.prepare();
    expect(readdirSync(files.uploads.tmp)).toEqual([]);
    expect(readdirSync(files.uploads.incoming)).toEqual([complete]);
  });
});

describe("reading the store, which is not trusted", () => {
  const ready = (id: string) => ({ v: 1, id, status: "ready", width: 800, height: 600, blurhash: "L2Eo_P_3jb_3" });

  test("a result that follows the protocol is returned", async () => {
    const files = await volumes();
    const id = randomUUID();
    expect(await files.readResult(id)).toBeNull();
    writeFileSync(files.store.result(id), JSON.stringify(ready(id)));
    expect(await files.readResult(id)).toEqual(ready(id));
  });

  test("anything else is ignored: not JSON, extra keys, another id, too large, a directory", async () => {
    const files = await volumes();
    const [a, b, c, d, e] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    writeFileSync(files.store.result(a), "not json");
    writeFileSync(files.store.result(b), JSON.stringify({ ...ready(b), path: "/etc/passwd" }));
    writeFileSync(files.store.result(c), JSON.stringify(ready(randomUUID())));
    writeFileSync(files.store.result(d), JSON.stringify({ ...ready(d), blurhash: "x".repeat(40_000) }));
    mkdirSync(files.store.result(e));
    for (const id of [a, b, c, d, e]) expect(await files.readResult(id), id).toBeNull();
  });

  test("an image is opened with its size, and the caller gets a handle to stream", async () => {
    const files = await volumes();
    const id = randomUUID();
    expect(await files.openImage(id, "large")).toBeNull();
    mkdirSync(files.store.imageDir(id), { recursive: true });
    writeFileSync(files.store.image(id, "large"), "webp-bytes");
    const stored = await files.openImage(id, "large");
    expect(stored?.size).toBe(10);
    expect(await stored!.handle.readFile("utf8")).toBe("webp-bytes");
    await stored!.handle.close();
  });

  test("a file on another device is refused: that is what a symlink out of the volume looks like", async () => {
    const files = await volumes(-1);
    const id = randomUUID();
    mkdirSync(files.store.imageDir(id), { recursive: true });
    writeFileSync(files.store.image(id, "large"), "webp-bytes");
    writeFileSync(files.store.result(id), JSON.stringify(ready(id)));
    expect(await files.openImage(id, "large")).toBeNull();
    expect(await files.readResult(id)).toBeNull();
  });

  test.skipIf(process.platform === "win32")("a symlink in place of an image is not followed", async () => {
    const files = await volumes();
    const id = randomUUID();
    const secret = path.join(root, `${randomUUID()}.secret`);
    writeFileSync(secret, "DATABASE_URL=secret");
    mkdirSync(files.store.imageDir(id), { recursive: true });
    symlinkSync(secret, files.store.image(id, "large"));
    expect(await files.openImage(id, "large")).toBeNull();
  });

  test("an oversized image and a directory are refused", async () => {
    const files = await volumes();
    const [big, dir] = [randomUUID(), randomUUID()];
    mkdirSync(files.store.imageDir(big), { recursive: true });
    writeFileSync(files.store.image(big, "small"), "");
    truncateSync(files.store.image(big, "small"), MAX_VARIANT_BYTES + 1);
    mkdirSync(files.store.image(dir, "small"), { recursive: true });
    expect(await files.openImage(big, "small")).toBeNull();
    expect(await files.openImage(dir, "small")).toBeNull();
  });
});

describe("deletion requests and the sweeper's view", () => {
  test("a request is an empty file; it is withdrawn once nothing remains", async () => {
    const files = await volumes();
    const id = randomUUID();
    mkdirSync(files.store.imageDir(id), { recursive: true });
    await files.requestDeletion([id]);
    await files.requestDeletion([id]);
    expect(await files.deletionRequests()).toEqual([id]);
    expect(statSync(files.uploads.deletion(id)).size).toBe(0);
    expect(await files.imageRemains(id)).toBe(true);
    rmSync(files.store.imageDir(id), { recursive: true });
    expect(await files.imageRemains(id)).toBe(false);
    await files.withdrawDeletion(id);
    expect(await files.deletionRequests()).toEqual([]);
  });

  test("a leftover result also counts as remaining", async () => {
    const files = await volumes();
    const id = randomUUID();
    writeFileSync(files.store.result(id), "{}");
    expect(await files.imageRemains(id)).toBe(true);
  });

  test("images and uploads on disk are listed with their age; stray names are skipped", async () => {
    const files = await volumes();
    const [image, upload, partial] = [randomUUID(), randomUUID(), randomUUID()];
    mkdirSync(files.store.imageDir(image), { recursive: true });
    mkdirSync(path.join(files.store.files, "zz", "stray"), { recursive: true });
    mkdirSync(path.join(files.store.files, image.slice(0, 2), "not-an-id"), { recursive: true });
    await files.receive(upload, chunked("a"), 100, accept);
    await files.commit(upload);
    await files.receive(partial, chunked("b"), 100, accept);
    writeFileSync(path.join(files.uploads.incoming, "stray"), "x");
    const now = Date.now() + 60_000;
    expect((await files.storedImages(now)).map((entry) => entry.id)).toEqual([image]);
    expect((await files.storedImages(now))[0]!.ageMs).toBeGreaterThan(50_000);
    expect((await files.storedUploads(now)).map((entry) => entry.id).sort()).toEqual([upload, partial].sort());
  });
});

describe("heartbeat and free space", () => {
  test("the heartbeat's age is measured against the clock; a missing or broken one is null", async () => {
    const files = await volumes();
    expect(await files.heartbeatAge(1_000)).toBeNull();
    writeFileSync(files.store.heartbeat, JSON.stringify({ v: 1, at: 1_000 }));
    expect(await files.heartbeatAge(31_000)).toBe(30_000);
    writeFileSync(files.store.heartbeat, "soon");
    expect(await files.heartbeatAge(31_000)).toBeNull();
    writeFileSync(files.store.heartbeat, JSON.stringify({ v: 1, at: 1_000, pid: 7 }));
    expect(await files.heartbeatAge(31_000)).toBeNull();
  });

  test("free space is a number of bytes", async () => {
    const files = await volumes();
    expect(await files.freeBytes()).toBeGreaterThan(0);
  });
});
```

### Replace `apps/api/test/config.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { loadConfig } from "../src/config";

const key = Buffer.alloc(32, 7).toString("base64");

const good = {
  DATABASE_URL_API: "postgres://korbat_api:x@localhost:5432/korbat",
  DATABASE_URL_AUTH: "postgres://korbat_auth:x@localhost:5432/korbat",
  REDIS_URL: "redis://localhost:6379",
  APP_ORIGIN: "http://localhost:8081",
  AUTH_HMAC_KEY: key,
  IP_HASH_KEY: key,
  TOTP_ENC_KEY: `v1:${key}`,
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  SMTP_URL: "smtp://localhost:1025",
  MAIL_FROM: "korbat <no-reply@korbat.local>",
  TERMS_VERSION: "draft-2026-09",
};

describe("loadConfig", () => {
  test("applies defaults", () => {
    const c = loadConfig(good);
    expect(c.PORT).toBe(3000);
    expect(c.NODE_ENV).toBe("development");
    expect(c.TRUSTED_ORIGINS).toEqual([]);
  });
  test("parses trusted origins list", () => {
    expect(loadConfig({ ...good, TRUSTED_ORIGINS: "http://a.test, http://b.test" }).TRUSTED_ORIGINS).toEqual(["http://a.test", "http://b.test"]);
  });
  test("fails loudly on a missing database url", () => {
    expect(() => loadConfig({ REDIS_URL: good.REDIS_URL })).toThrow(/DATABASE_URL_API/);
  });
  test("rejects keys shorter than 32 bytes", () => {
    expect(() => loadConfig({ ...good, AUTH_HMAC_KEY: Buffer.alloc(16).toString("base64") })).toThrow(/AUTH_HMAC_KEY/);
  });
  test("TOTP key must be versioned and exactly 32 bytes", () => {
    expect(() => loadConfig({ ...good, TOTP_ENC_KEY: key })).toThrow(/TOTP_ENC_KEY/);
    expect(() => loadConfig({ ...good, TOTP_ENC_KEY: `v1:${Buffer.alloc(33).toString("base64")}` })).toThrow(/TOTP_ENC_KEY/);
  });
  test("SMTP_URL must be smtp or smtps", () => {
    expect(() => loadConfig({ ...good, SMTP_URL: "http://relay.example" })).toThrow(/SMTP_URL/);
    expect(loadConfig({ ...good, SMTP_URL: "smtps://user:pass@relay.example:465" }).SMTP_URL).toMatch(/^smtps:/);
  });
  test("every auth variable is required", () => {
    for (const name of ["APP_ORIGIN", "AUTH_HMAC_KEY", "IP_HASH_KEY", "TOTP_ENC_KEY", "TURNSTILE_SECRET_KEY", "SMTP_URL", "MAIL_FROM", "TERMS_VERSION"]) {
      const env: Record<string, string | undefined> = { ...good };
      delete env[name];
      expect(() => loadConfig(env), name).toThrow(new RegExp(name));
    }
  });
  test("media settings default to the development directories, every format and a 2 GiB free-space floor", () => {
    const c = loadConfig(good);
    expect(c.MEDIA_UPLOADS_DIR).toBe("../../.data/media/uploads");
    expect(c.MEDIA_STORE_DIR).toBe("../../.data/media/store");
    expect(c.MEDIA_FORMATS).toEqual(["jpeg", "png", "webp", "gif", "avif"]);
    expect(c.MEDIA_MIN_FREE_BYTES).toBe(2_147_483_648);
  });
  test("MEDIA_FORMATS enables a subset, and a typo stops the process instead of changing what is accepted", () => {
    expect(loadConfig({ ...good, MEDIA_FORMATS: "png, jpeg" }).MEDIA_FORMATS).toEqual(["jpeg", "png"]);
    expect(() => loadConfig({ ...good, MEDIA_FORMATS: "jpeg,tiff" })).toThrow(/unknown formats: tiff/);
    expect(loadConfig({ ...good, MEDIA_MIN_FREE_BYTES: "0", MEDIA_STORE_DIR: "/media/store" })).toMatchObject({ MEDIA_MIN_FREE_BYTES: 0, MEDIA_STORE_DIR: "/media/store" });
  });
});
```

### Replace `apps/api/package.json` (whole file)

```json
{
  "name": "@korbat/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsup",
    "start": "node dist/index.js",
    "typecheck": "tsc -p .",
    "test": "vitest run",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "update:disposable": "node scripts/update-disposable-domains.mjs"
  },
  "dependencies": {
    "@hono/node-server": "2.1.1",
    "@hono/zod-validator": "0.9.1",
    "@korbat/contracts": "workspace:*",
    "@korbat/db": "workspace:*",
    "@korbat/media-protocol": "workspace:*",
    "@korbat/rules": "workspace:*",
    "@node-rs/argon2": "2.2.0",
    "drizzle-orm": "0.45.2",
    "hono": "4.13.5",
    "ioredis": "5.11.1",
    "nodemailer": "10.0.0",
    "pino": "10.3.1",
    "pino-pretty": "13.1.3",
    "uqr": "0.1.3",
    "zod": "4.5.4"
  },
  "devDependencies": {
    "@types/node": "24.13.3",
    "@types/nodemailer": "6.4.24",
    "tsup": "8.5.1",
    "tsx": "4.23.13",
    "typescript": "5.9.3",
    "vitest": "4.1.11"
  }
}
```

## Step 2: run the tests and watch them fail

```bash
pnpm install --config.minimum-release-age=0 >/dev/null 2>&1; pnpm --filter @korbat/api test
```

Expected: the command exits with an error, and the output contains:

- `Cannot find module '../../src/media/context'`
- `Tests  2 failed | 114 passed | 96 skipped (212)`

Observed on the dry run:

```text
Tests  2 failed | 114 passed | 96 skipped (212)
Error: Cannot find module '../../src/media/context' imported from C:\Users\Lenovo\Desktop\cool\korbat/apps/api/test/media/files.test.ts
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/images-2b/write_blocks.py docs/superpowers/prompts/images-2b/08-media-files.md 3
```

Expected: 3 lines starting with `wrote`, one for each file below.

### Create `apps/api/src/media/context.ts`

```ts
import type { MediaErrorCode } from "@korbat/contracts";

/** The media codes plus the shared ones the module also raises. */
export type MediaErrorKind = MediaErrorCode | "not_found" | "invalid_request";
export type MediaErrorStatus = 400 | 404 | 409 | 413 | 415 | 503;

const MESSAGES: Record<MediaErrorKind, string> = {
  unsupported_media_type: "That file type is not supported. Use a JPEG, PNG, WebP, AVIF or GIF image.",
  file_too_large: "Images can be at most 20 MB.",
  too_many_pending_uploads: "You have too many images waiting to be posted. Post or remove some first.",
  uploads_unavailable: "Image uploads are temporarily unavailable. Try again later.",
  media_unavailable: "One of the images is not available. Remove it and add it again.",
  not_found: "Not found.",
  invalid_request: "Some details are missing or invalid.",
};

/** What an iPhone calls a photo. The decoder cannot read it, so the message says what to do instead. */
export const HEIC_MESSAGE = "HEIC photos are not supported. Export the photo as JPEG and try again.";

/** An expected, user-facing failure. The HTTP layer turns it into an ErrorEnvelope with this code and status. */
export class MediaError extends Error {
  constructor(
    readonly code: MediaErrorKind,
    readonly status: MediaErrorStatus,
    message: string = MESSAGES[code],
  ) {
    super(message);
    this.name = "MediaError";
  }
}

export function mediaErrorMessage(code: MediaErrorKind): string {
  return MESSAGES[code];
}
```

### Create `apps/api/src/media/files.ts`

```ts
import { constants } from "node:fs";
import { mkdir, open, readdir, rename, rm, stat, statfs, type FileHandle } from "node:fs/promises";
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

/** Follows no symlink at the last path component where the platform can say so. Windows cannot; the device check still holds there. */
const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);

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
```

### Replace `apps/api/src/config.ts` (whole file)

```ts
import { z } from "zod";
import { parseFormats } from "@korbat/media-protocol";

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** A base64 secret that decodes to at least 32 bytes. */
const base64Key = z
  .string()
  .regex(BASE64, "must be base64")
  .refine((s) => Buffer.from(s, "base64").length >= 32, "must decode to at least 32 bytes");

/** `v<N>:<base64>` decoding to exactly 32 bytes (AES-256). The version lets keys rotate. */
const versionedKey = z
  .string()
  .regex(/^v\d+:[A-Za-z0-9+/]+={0,2}$/, "must look like v1:<base64>")
  .refine((s) => Buffer.from(s.slice(s.indexOf(":") + 1), "base64").length === 32, "must decode to exactly 32 bytes");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL_API: z.url({ protocol: /^postgres(ql)?$/ }),
  DATABASE_URL_AUTH: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  TRUSTED_ORIGINS: z
    .string()
    .default("")
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)),
  KORBAT_VERSION: z.string().default("0.0.0-dev"),
  /** Origin of the web app; state-changing cookie requests must come from here (or TRUSTED_ORIGINS). */
  APP_ORIGIN: z.url({ protocol: /^https?$/ }),
  /** Keys email codes, recovery codes, device ids and email rate-limit buckets. */
  AUTH_HMAC_KEY: base64Key,
  /** Keys IP addresses before they are stored or used as rate-limit buckets. */
  IP_HASH_KEY: base64Key,
  /** Encrypts TOTP secrets at rest. */
  TOTP_ENC_KEY: versionedKey,
  TURNSTILE_SECRET_KEY: z.string().min(1),
  SMTP_URL: z.url({ protocol: /^smtps?$/ }),
  MAIL_FROM: z.string().min(3),
  TERMS_VERSION: z.string().min(1).max(64),
  /** The uploads volume, which the API writes and the image worker only reads. The default suits `pnpm dev` from apps/api. */
  MEDIA_UPLOADS_DIR: z.string().min(1).default("../../.data/media/uploads"),
  /** The store volume, which the image worker writes and the API only reads. */
  MEDIA_STORE_DIR: z.string().min(1).default("../../.data/media/store"),
  /** A comma-separated subset of jpeg, png, webp, gif, avif; unset enables all. The worker reads the same variable. */
  MEDIA_FORMATS: z
    .string()
    .optional()
    .transform((value, ctx) => {
      try {
        return parseFormats(value);
      } catch (err) {
        ctx.addIssue({ code: "custom", message: (err as Error).message });
        return z.NEVER;
      }
    }),
  /** Uploads are refused while either media volume has less free space than this. The volumes share a disk with Postgres. */
  MEDIA_MIN_FREE_BYTES: z.coerce.number().int().nonnegative().default(2 * 1024 ** 3),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
```

## Step 4: verify: install

```bash
pnpm install --config.minimum-release-age=0
```

Expected output contains:

- `Done in`

Must not contain:

- `ERR_PNPM`

Observed on the dry run:

```text
Done in 2.3s using pnpm v10.30.0
```

## Step 5: verify: lockfile-age

```bash
node scripts/check-lockfile-age.mjs --base HEAD
```

Expected output contains:

- `0 new package versions since HEAD`

Observed on the dry run:

```text
0 new package versions since HEAD; all at least 7 days old
```

## Step 6: verify: test

```bash
pnpm --filter @korbat/api test
```

Expected output contains:

- `Tests  134 passed | 97 skipped (231)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  134 passed | 97 skipped (231)
```

## Step 7: verify: typecheck

```bash
pnpm --filter @korbat/api typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`

Observed on the dry run:

```text
(no output)
```

## Step 8: verify: build

```bash
pnpm --filter @korbat/api build
```

Expected output contains:

- `Build success`

Must not contain:

- `error`

Observed on the dry run:

```text
ESM ⚡️ Build success in 518ms
```

## Step 9: verify: frozen-install

```bash
pnpm install --frozen-lockfile
```

Expected output contains:

- `Done in`

Must not contain:

- `ERR_PNPM`

Observed on the dry run:

```text
Done in 2.2s using pnpm v10.30.0
```

## Step 10: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/package.json`
- `apps/api/src/config.ts`
- `apps/api/src/media/context.ts`
- `apps/api/src/media/files.ts`
- `apps/api/test/config.test.ts`
- `apps/api/test/media/files.test.ts`
- `pnpm-lock.yaml`

## Step 11: commit

```bash
git add -A
git commit -q -m "feat(media): API file layer with counted streaming uploads, handle-checked reads of the untrusted store, deletion requests, heartbeat age and free space; media settings" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(media): API file layer with counted streaming uploads, handle-checked reads of the untrusted store, deletion requests, heartbeat age and free space; media settings`.

## Report format (mandatory)

```text
TASK 8 REPORT
Files written: <count, expected 6>
Failing-test step (the error line): <paste>
Verify "install": <paste the expected lines as printed>
Verify "lockfile-age": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "typecheck": <paste the expected lines as printed>
Verify "build": <paste the expected lines as printed>
Verify "frozen-install": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
