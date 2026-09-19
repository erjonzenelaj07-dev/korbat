# korbat 2b — Task 9 of 17: Media module: repository, upload, status and removal flows, routes and entry point; upload limits join the tier table

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-18 and 2026-09-19 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

The media module in the API, shaped like the auth and social modules: one repository on the korbat_api pool, one file per flow, thin routes at `/api/media` behind requireSession. Upload checks type, size, the pending-upload limit, free space and the account-age tier; status finalizes a result the worker wrote; removal takes back an unattached upload. The integration tests drive the flows with a fake worker that writes results by the protocol.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(media): API file layer with counted streaming uploads, handle-checked reads of the untrusted store, deletion requests, heartbeat age and free space; media settings`.
3. The previous task's last API unit run ended with `Tests  134 passed | 97 skipped (231)`.

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
python docs/superpowers/prompts/images-2b/write_blocks.py docs/superpowers/prompts/images-2b/09-media-upload-flows.md 1
```

Expected: 3 lines starting with `wrote`, one for each file below.

### Create `apps/api/test/integration/media-harness.ts`

```ts
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import type { Db } from "@korbat/db";
import type { MediaFailure } from "@korbat/contracts";
import { MEDIA_FORMATS, type MediaFormat } from "@korbat/media-protocol";
import type { MediaDeps } from "../../src/media/context";
import { createMediaFiles } from "../../src/media/files";
import { createMediaRepo } from "../../src/media/repo";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { enforceWriteLimit } from "../../src/social/limits";
import { DAY_MS, HOUR_MS } from "../../src/social/tiers";
import { newProfile, ticker } from "./social-fixtures";

/** The first bytes of each kind of file. The API judges an upload by these and never decodes it. */
export const BYTES = {
  jpeg: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("JFIF-test-image")]),
  png: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("png-test-image")]),
  pdf: Buffer.from("%PDF-1.7 not an image"),
  heic: Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.from([0, 0, 0, 0]), Buffer.from("mif1heic")]),
  animatedWebp: Buffer.concat([Buffer.from("RIFF"), Buffer.from([40, 0, 0, 0]), Buffer.from("WEBPVP8X"), Buffer.from([10, 0, 0, 0, 0x02, 0, 0, 0])]),
};

/** A request body that arrives in chunks and declares no length. */
export function bodyOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

/**
 * The media module on real Postgres, with both volumes in a temporary directory and a stand-in for
 * the worker that writes files and results exactly as the protocol says. Nothing here decodes an image.
 */
export async function mediaHarness(db: Db, options: { formats?: readonly MediaFormat[]; minFreeBytes?: number } = {}) {
  const clock = ticker();
  const root = mkdtempSync(path.join(tmpdir(), "korbat-media-"));
  const files = createMediaFiles({ uploadsDir: path.join(root, "uploads"), storeDir: path.join(root, "store"), log: pino({ level: "silent" }) });
  await files.prepare();
  for (const dir of [files.store.files, files.store.results, files.store.attempts, files.store.tmp]) mkdirSync(dir, { recursive: true });

  const limits = new MemoryStore(() => clock.now().getTime());
  const deps: MediaDeps = {
    repo: createMediaRepo(db),
    files,
    formats: options.formats ?? MEDIA_FORMATS,
    minFreeBytes: options.minFreeBytes ?? 0,
    enforceUploadLimit: (userId, accountCreatedAt, now) => enforceWriteLimit(limits, userId, "upload", accountCreatedAt, now),
    log: pino({ level: "silent" }),
    now: clock.next,
  };

  const worker = {
    /** What the worker leaves behind for an image it accepted. */
    ready(id: string, size: { width: number; height: number } = { width: 2048, height: 1536 }) {
      mkdirSync(files.store.imageDir(id), { recursive: true });
      writeFileSync(files.store.image(id, "large"), `large-webp-of-${id}`);
      writeFileSync(files.store.image(id, "small"), `small-webp-of-${id}`);
      writeFileSync(files.store.result(id), JSON.stringify({ v: 1, id, status: "ready", ...size, blurhash: "L2Eo_P_3jb_3~qoL" }));
    },
    /** What it leaves behind for one it refused. */
    failed(id: string, reason: MediaFailure) {
      writeFileSync(files.store.result(id), JSON.stringify({ v: 1, id, status: "failed", reason }));
    },
  };

  return {
    deps,
    files,
    clock,
    worker,
    jpeg: () => ({ contentType: "image/jpeg", contentLength: undefined, body: bodyOf(BYTES.jpeg) }),
    /** An account old enough for the established tier. */
    established: () => newProfile(db, { createdAt: new Date(clock.now().getTime() - 3 * DAY_MS) }),
    /** An account in its first day. */
    fresh: () => newProfile(db, { createdAt: new Date(clock.now().getTime() - HOUR_MS) }),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
    newId: randomUUID,
  };
}

export type MediaHarness = Awaited<ReturnType<typeof mediaHarness>>;
```

### Create `apps/api/test/integration/media-flows.test.ts`

```ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { MEDIA_MAX_BYTES, MediaStatusResponse, UploadResponse } from "@korbat/contracts";
import { closeDb, createDb, postMedia, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { remove } from "../../src/media/flows/remove";
import { status } from "../../src/media/flows/status";
import { upload } from "../../src/media/flows/upload";
import { createSocialRepo } from "../../src/social/repo";
import { BYTES, bodyOf, mediaHarness, type MediaHarness } from "./media-harness";
import { rejection } from "./social-harness";
import { newPost } from "./social-fixtures";

describe.skipIf(!process.env.INTEGRATION)("integration: media upload, status and removal", () => {
  let db: Db;
  let h: MediaHarness;

  beforeAll(async () => {
    db = createDb(loadConfig().DATABASE_URL_API, { max: 4 });
    h = await mediaHarness(db);
  });
  afterAll(async () => {
    h.cleanup();
    await closeDb(db);
  });

  const failure = async (promise: Promise<unknown>) => {
    try {
      await promise;
      return null;
    } catch (err) {
      const e = err as { code?: string; status?: number; message?: string };
      return { code: e.code, status: e.status, message: e.message };
    }
  };

  test("an upload is stored for the worker and owned by its account; the worker's verdict is recorded once", async () => {
    const ada = await h.established();
    const sent = UploadResponse.parse(await upload(h.deps, ada.id, h.jpeg()));
    expect(readFileSync(h.files.uploads.upload(sent.id))).toEqual(BYTES.jpeg);
    expect(readdirSync(h.files.uploads.tmp)).toEqual([]);
    expect(await status(h.deps, ada.id, sent.id)).toEqual({ id: sent.id, status: "processing" });

    h.worker.ready(sent.id, { width: 1600, height: 1200 });
    const ready = MediaStatusResponse.parse(await status(h.deps, ada.id, sent.id));
    expect(ready).toEqual({ id: sent.id, status: "ready", width: 1600, height: 1200, blurhash: "L2Eo_P_3jb_3~qoL" });
    expect(existsSync(h.files.uploads.upload(sent.id))).toBe(false);

    h.worker.failed(sent.id, "corrupt_image");
    expect(await status(h.deps, ada.id, sent.id)).toEqual(ready);
  });

  test("a refused image reports the worker's reason", async () => {
    const ada = await h.established();
    const sent = await upload(h.deps, ada.id, h.jpeg());
    h.worker.failed(sent.id, "animated_not_supported");
    expect(await status(h.deps, ada.id, sent.id)).toEqual({ id: sent.id, status: "failed", error: "animated_not_supported" });
    expect(existsSync(h.files.uploads.upload(sent.id))).toBe(false);
  });

  test("the status of an upload is for its owner only", async () => {
    const [ada, bob] = await Promise.all([h.established(), h.established()]);
    const sent = await upload(h.deps, ada.id, h.jpeg());
    expect(await rejection(status(h.deps, bob.id, sent.id))).toBe("not_found");
    expect(await rejection(status(h.deps, ada.id, h.newId()))).toBe("not_found");
  });

  test("the declared type must be an accepted image type; HEIC is told what to do", async () => {
    const ada = await h.established();
    for (const contentType of [undefined, "", "text/plain", "image/svg+xml", "image/tiff", "application/octet-stream"]) {
      expect(await failure(upload(h.deps, ada.id, { ...h.jpeg(), contentType })), String(contentType)).toMatchObject({ code: "unsupported_media_type", status: 415 });
    }
    expect((await failure(upload(h.deps, ada.id, { ...h.jpeg(), contentType: "image/heic" })))?.message).toMatch(/Export the photo as JPEG/);
    expect((await upload(h.deps, ada.id, { ...h.jpeg(), contentType: "IMAGE/JPEG; charset=binary" })).status).toBe("processing");
  });

  test("the first bytes decide, and a refused file leaves no row and no file", async () => {
    const ada = await h.established();
    const before = await h.deps.repo.pendingCount(ada.id);
    expect(await failure(upload(h.deps, ada.id, { ...h.jpeg(), body: bodyOf(BYTES.pdf) }))).toMatchObject({ code: "unsupported_media_type", status: 415 });
    expect((await failure(upload(h.deps, ada.id, { ...h.jpeg(), body: bodyOf(BYTES.heic) })))?.message).toMatch(/Export the photo as JPEG/);
    expect((await failure(upload(h.deps, ada.id, { contentType: "image/webp", contentLength: undefined, body: bodyOf(BYTES.animatedWebp) })))?.message).toMatch(/Animated images/);
    expect(await failure(upload(h.deps, ada.id, { ...h.jpeg(), body: null }))).toMatchObject({ code: "unsupported_media_type" });
    expect(await h.deps.repo.pendingCount(ada.id)).toBe(before);
    expect(readdirSync(h.files.uploads.tmp)).toEqual([]);
    expect((await upload(h.deps, ada.id, { contentType: "image/jpeg", contentLength: undefined, body: bodyOf(BYTES.png) })).status).toBe("processing");
  });

  test("a format that is switched off is refused by type and by bytes", async () => {
    const only = await mediaHarness(db, { formats: ["jpeg"] });
    const ada = await only.established();
    expect(await failure(upload(only.deps, ada.id, { contentType: "image/png", contentLength: undefined, body: bodyOf(BYTES.png) }))).toMatchObject({ code: "unsupported_media_type" });
    expect(await failure(upload(only.deps, ada.id, { contentType: "image/jpeg", contentLength: undefined, body: bodyOf(BYTES.png) }))).toMatchObject({ code: "unsupported_media_type" });
    expect((await upload(only.deps, ada.id, only.jpeg())).status).toBe("processing");
    only.cleanup();
  });

  test("20 MiB is the limit, whether the length is declared or not", async () => {
    const ada = await h.established();
    expect(await failure(upload(h.deps, ada.id, { ...h.jpeg(), contentLength: String(MEDIA_MAX_BYTES + 1) }))).toMatchObject({ code: "file_too_large", status: 413 });
    const mib = new Uint8Array(1024 * 1024);
    const chunks = [BYTES.jpeg, ...Array.from({ length: 20 }, () => mib)];
    expect(await failure(upload(h.deps, ada.id, { ...h.jpeg(), contentLength: "1000", body: bodyOf(...chunks) }))).toMatchObject({ code: "file_too_large", status: 413 });
    expect(readdirSync(h.files.uploads.tmp)).toEqual([]);
  });

  test("an account holds at most 20 uploads that are not on a post", async () => {
    const ada = await h.established();
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) ids.push((await upload(h.deps, ada.id, h.jpeg())).id);
    expect(await failure(upload(h.deps, ada.id, h.jpeg()))).toMatchObject({ code: "too_many_pending_uploads", status: 409 });
    h.worker.failed(ids[0]!, "corrupt_image");
    await status(h.deps, ada.id, ids[0]!);
    expect((await upload(h.deps, ada.id, h.jpeg())).status).toBe("processing");
  });

  test("an account in its first day may upload 20 images an hour, and removing them gives nothing back", async () => {
    const newcomer = await h.fresh();
    for (let i = 0; i < 20; i++) await remove(h.deps, newcomer.id, (await upload(h.deps, newcomer.id, h.jpeg())).id);
    const refused = await failure(upload(h.deps, newcomer.id, h.jpeg()));
    expect(refused).toMatchObject({ code: "rate_limited", status: 429 });
  });

  test("uploads stop while the disk is nearly full", async () => {
    const full = await mediaHarness(db, { minFreeBytes: Number.MAX_SAFE_INTEGER });
    const ada = await full.established();
    expect(await failure(upload(full.deps, ada.id, full.jpeg()))).toMatchObject({ code: "uploads_unavailable", status: 503 });
    full.cleanup();
  });

  test("an account without a profile cannot upload", async () => {
    expect(await rejection(upload(h.deps, h.newId(), h.jpeg()))).toBe("not_found");
  });

  test("removing an upload deletes its row and file and asks the worker to delete what it made", async () => {
    const [ada, bob] = await Promise.all([h.established(), h.established()]);
    const sent = await upload(h.deps, ada.id, h.jpeg());
    h.worker.ready(sent.id);
    expect(await rejection(remove(h.deps, bob.id, sent.id))).toBe("not_found");
    await remove(h.deps, ada.id, sent.id);
    expect(await h.deps.repo.find(sent.id)).toBeNull();
    expect(existsSync(h.files.uploads.upload(sent.id))).toBe(false);
    expect(await h.files.deletionRequests()).toContain(sent.id);
    expect(await rejection(remove(h.deps, ada.id, sent.id))).toBe("not_found");
  });

  test("an image that is on a post cannot be removed on its own", async () => {
    const ada = await h.established();
    const sent = await upload(h.deps, ada.id, h.jpeg());
    h.worker.ready(sent.id);
    await status(h.deps, ada.id, sent.id);
    const postId = await newPost(createSocialRepo(db), ada.id, h.clock.next(), "with an image");
    await db.update(postMedia).set({ postId, position: 0, altText: "a test image" }).where(eq(postMedia.id, sent.id));
    expect(await rejection(remove(h.deps, ada.id, sent.id))).toBe("not_found");
    expect((await h.deps.repo.find(sent.id))?.postId).toBe(postId);
  });
});
```

### Replace `apps/api/test/social/tiers.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { DAY_MS, HOUR_MS, NEW_ACCOUNT_MS, REPOST_MIN_AGE_MS, isNewAccount, limitsFor, mayRepostOrQuote } from "../../src/social/tiers";

describe("account tiers", () => {
  test("the low tier ends exactly at 24 hours", () => {
    expect(isNewAccount(NEW_ACCOUNT_MS - 1)).toBe(true);
    expect(isNewAccount(NEW_ACCOUNT_MS)).toBe(false);
    expect(limitsFor("post", 0)).toEqual([{ bucket: "post", max: 5, windowMs: HOUR_MS }]);
    expect(limitsFor("post", NEW_ACCOUNT_MS)).toEqual([{ bucket: "post", max: 30, windowMs: HOUR_MS }]);
    expect(limitsFor("reply", 0)[0]!.max).toBe(20);
    expect(limitsFor("reply", NEW_ACCOUNT_MS)[0]!.max).toBe(60);
  });
  test("reposts and quotes open at 48 hours, and quotes share the post bucket", () => {
    expect(mayRepostOrQuote(REPOST_MIN_AGE_MS - 1)).toBe(false);
    expect(mayRepostOrQuote(REPOST_MIN_AGE_MS)).toBe(true);
    expect(limitsFor("quote", 3 * DAY_MS)).toEqual(limitsFor("post", 3 * DAY_MS));
    expect(limitsFor("repost", 3 * DAY_MS)).toEqual([{ bucket: "repost", max: 30, windowMs: HOUR_MS }]);
  });
  test("image uploads: 20 an hour in the first day, 120 afterwards", () => {
    expect(limitsFor("upload", 0)).toEqual([{ bucket: "upload", max: 20, windowMs: HOUR_MS }]);
    expect(limitsFor("upload", NEW_ACCOUNT_MS)).toEqual([{ bucket: "upload", max: 120, windowMs: HOUR_MS }]);
  });
  test("engagement and graph limits do not depend on age, and follows have two windows", () => {
    for (const age of [0, 10 * DAY_MS]) {
      expect(limitsFor("like", age)[0]!.max).toBe(100);
      expect(limitsFor("bookmark", age)[0]!.max).toBe(100);
      expect(limitsFor("block", age)[0]!.max).toBe(30);
      expect(limitsFor("mute", age)[0]!.max).toBe(30);
      expect(limitsFor("follow", age)).toEqual([
        { bucket: "follow-hour", max: 50, windowMs: HOUR_MS },
        { bucket: "follow-day", max: 400, windowMs: DAY_MS },
      ]);
    }
  });
});
```

## Step 2: run the tests and watch them fail

```bash
pnpm --filter @korbat/api test; pnpm --filter @korbat/api test:integration
```

Expected: the command exits with an error, and the output contains:

- `Tests  1 failed | 134 passed | 97 skipped (232)`
- `Cannot find module '../../src/media/flows/remove'`

Observed on the dry run:

```text
Tests  1 failed | 134 passed | 97 skipped (232)
Error: Cannot find module '../../src/media/flows/remove' imported from C:\Users\Lenovo\Desktop\cool\korbat/apps/api/test/integration/media-flows.test.ts
Error: Cannot find module '../../src/media/flows/remove' imported from C:\Users\Lenovo\Desktop\cool\korbat/apps/api/test/integration/media-flows.test.ts
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/images-2b/write_blocks.py docs/superpowers/prompts/images-2b/09-media-upload-flows.md 3
```

Expected: 11 lines starting with `wrote`, one for each file below.

### Create `apps/api/src/media/repo.ts`

```ts
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { postMedia, profiles, type Db } from "@korbat/db";
import type { ResultFile } from "@korbat/media-protocol";

/** Every SQL statement on post_media lives in this module's repository, on the korbat_api pool. */

export interface MediaRow {
  id: string;
  ownerId: string;
  status: "processing" | "ready" | "failed";
  error: string | null;
  postId: string | null;
  width: number | null;
  height: number | null;
  blurhash: string | null;
  createdAt: Date;
}

const columns = {
  id: postMedia.id,
  ownerId: postMedia.ownerId,
  status: postMedia.status,
  error: postMedia.error,
  postId: postMedia.postId,
  width: postMedia.width,
  height: postMedia.height,
  blurhash: postMedia.blurhash,
  createdAt: postMedia.createdAt,
};

export function createMediaRepo(db: Db) {
  return {
    /** When the account was onboarded, which decides its upload tier. */
    async accountCreatedAt(userId: string): Promise<Date | null> {
      const rows = await db.select({ createdAt: profiles.createdAt }).from(profiles).where(eq(profiles.id, userId)).limit(1);
      return rows[0]?.createdAt ?? null;
    },

    /** Uploads of this account that are not on a post yet and did not fail. */
    async pendingCount(ownerId: string): Promise<number> {
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(postMedia)
        .where(and(eq(postMedia.ownerId, ownerId), isNull(postMedia.postId), inArray(postMedia.status, ["processing", "ready"])));
      return rows[0]?.count ?? 0;
    },

    async insertProcessing(input: { id: string; ownerId: string; now: Date }): Promise<void> {
      await db.insert(postMedia).values({ id: input.id, ownerId: input.ownerId, status: "processing", createdAt: input.now });
    },

    async find(id: string): Promise<MediaRow | null> {
      const rows = await db.select(columns).from(postMedia).where(eq(postMedia.id, id)).limit(1);
      return rows[0] ?? null;
    },

    /** Records the worker's verdict, once. A row that is no longer processing is left as it is. */
    async finalize(id: string, result: ResultFile): Promise<boolean> {
      const values = result.status === "ready" ? { status: "ready" as const, width: result.width, height: result.height, blurhash: result.blurhash } : { status: "failed" as const, error: result.reason };
      const rows = await db.update(postMedia).set(values).where(and(eq(postMedia.id, id), eq(postMedia.status, "processing"))).returning({ id: postMedia.id });
      return rows.length === 1;
    },

    /** Removes an upload of this account that is not on a post. */
    async deleteUnattached(id: string, ownerId: string): Promise<boolean> {
      const rows = await db.delete(postMedia).where(and(eq(postMedia.id, id), eq(postMedia.ownerId, ownerId), isNull(postMedia.postId))).returning({ id: postMedia.id });
      return rows.length === 1;
    },

    /** Removes a row whatever its state. Used when an upload could not be handed to the worker. */
    async deleteRow(id: string): Promise<void> {
      await db.delete(postMedia).where(eq(postMedia.id, id));
    },
  };
}

export type MediaRepo = ReturnType<typeof createMediaRepo>;
```

### Create `apps/api/src/media/flows/upload.ts`

```ts
import { randomUUID } from "node:crypto";
import { MEDIA_ACCEPTED_TYPES, MEDIA_MAX_BYTES, type MediaAcceptedType, type UploadResponse } from "@korbat/contracts";
import { sniffImage, type MediaFormat } from "@korbat/media-protocol";
import { HEIC_MESSAGE, MAX_PENDING_UPLOADS, MediaError, type MediaDeps } from "../context";

const FORMAT_OF: Record<MediaAcceptedType, MediaFormat> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
};

export interface UploadRequest {
  contentType: string | undefined;
  contentLength: string | undefined;
  body: ReadableStream<Uint8Array> | null;
}

/** `image/jpeg; charset=binary` to `image/jpeg`. */
const mediaType = (header: string | undefined): string => (header ?? "").split(";")[0]!.trim().toLowerCase();

/** The declared type is checked and then forgotten: nothing of it is stored, and the bytes decide what the file is. */
function checkDeclaredType(deps: MediaDeps, header: string | undefined): void {
  const type = mediaType(header);
  if (type === "image/heic" || type === "image/heif") throw new MediaError("unsupported_media_type", 415, HEIC_MESSAGE);
  const format = (MEDIA_ACCEPTED_TYPES as readonly string[]).includes(type) ? FORMAT_OF[type as MediaAcceptedType] : null;
  if (!format || !deps.formats.includes(format)) throw new MediaError("unsupported_media_type", 415);
}

/** Runs on the first bytes, before anything is written to disk. */
function checkFirstBytes(deps: MediaDeps, head: Uint8Array): void {
  const sniffed = sniffImage(head);
  if (sniffed.kind === "heic") throw new MediaError("unsupported_media_type", 415, HEIC_MESSAGE);
  if (sniffed.kind === "animated") throw new MediaError("unsupported_media_type", 415, "Animated images are not supported yet. Use a still image.");
  if (sniffed.kind !== "image" || !deps.formats.includes(sniffed.format)) throw new MediaError("unsupported_media_type", 415);
}

/**
 * Takes one image from its owner and hands it to the worker. Cheap refusals come first; the body
 * is only read once the account may upload. The row is written before the file becomes visible to
 * the worker, so the worker never processes an upload nobody owns.
 */
export async function upload(deps: MediaDeps, ownerId: string, request: UploadRequest): Promise<UploadResponse> {
  checkDeclaredType(deps, request.contentType);
  const declaredLength = Number(request.contentLength);
  if (Number.isFinite(declaredLength) && declaredLength > MEDIA_MAX_BYTES) throw new MediaError("file_too_large", 413);

  const createdAt = await deps.repo.accountCreatedAt(ownerId);
  if (!createdAt) throw new MediaError("not_found", 404);
  await deps.enforceUploadLimit(ownerId, createdAt, deps.now());
  if ((await deps.repo.pendingCount(ownerId)) >= MAX_PENDING_UPLOADS) throw new MediaError("too_many_pending_uploads", 409);
  if ((await deps.files.freeBytes()) < deps.minFreeBytes) {
    deps.log.error({ minFreeBytes: deps.minFreeBytes }, "media: uploads refused, free space is under the floor");
    throw new MediaError("uploads_unavailable", 503);
  }

  const id = randomUUID();
  await deps.files.receive(id, request.body, MEDIA_MAX_BYTES, (head) => checkFirstBytes(deps, head));
  try {
    await deps.repo.insertProcessing({ id, ownerId, now: deps.now() });
    await deps.files.commit(id);
  } catch (err) {
    await deps.repo.deleteRow(id).catch(() => undefined);
    await deps.files.discardUpload(id);
    throw err;
  }
  return { id, status: "processing" };
}
```

### Create `apps/api/src/media/flows/status.ts`

```ts
import { MediaFailure, type MediaStatusResponse } from "@korbat/contracts";
import { MediaError, type MediaDeps } from "../context";
import type { MediaRow } from "../repo";

/**
 * Records the worker's verdict for an upload, if there is one, and removes the upload file, which
 * is how the worker learns that its result was read. Safe to repeat: only a row that is still
 * processing changes.
 */
export async function finalize(deps: MediaDeps, id: string): Promise<boolean> {
  const result = await deps.files.readResult(id);
  if (!result) return false;
  await deps.repo.finalize(id, result);
  await deps.files.discardUpload(id);
  return true;
}

function statusOf(row: MediaRow): MediaStatusResponse {
  if (row.status === "ready" && row.width !== null && row.height !== null && row.blurhash !== null) {
    return { id: row.id, status: "ready", width: row.width, height: row.height, blurhash: row.blurhash };
  }
  if (row.status === "failed") {
    const reason = MediaFailure.safeParse(row.error);
    return { id: row.id, status: "failed", error: reason.success ? reason.data : "processing_failed" };
  }
  return { id: row.id, status: "processing" };
}

/** The state of one upload, for its owner only. Whoever asks first finalizes it. */
export async function status(deps: MediaDeps, ownerId: string, id: string): Promise<MediaStatusResponse> {
  let row = await deps.repo.find(id);
  if (!row || row.ownerId !== ownerId) throw new MediaError("not_found", 404);
  if (row.status === "processing" && (await finalize(deps, id))) row = (await deps.repo.find(id)) ?? row;
  return statusOf(row);
}
```

### Create `apps/api/src/media/flows/remove.ts`

```ts
import { MediaError, type MediaDeps } from "../context";

/**
 * Removes an upload its owner decided not to post. An image that is on a post goes with the post,
 * not through here, so anything that is not the caller's own unattached upload is simply not found.
 */
export async function remove(deps: MediaDeps, ownerId: string, id: string): Promise<void> {
  if (!(await deps.repo.deleteUnattached(id, ownerId))) throw new MediaError("not_found", 404);
  await deps.files.discardUpload(id);
  // The worker may already have written files, or be about to: the request covers both.
  await deps.files.requestDeletion([id]);
}
```

### Create `apps/api/src/media/routes.ts`

```ts
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { MediaId } from "@korbat/contracts";
import type { AppEnv } from "../env";
import { validate } from "../lib/validate";
import type { MediaDeps } from "./context";
import { remove } from "./flows/remove";
import { status } from "./flows/status";
import { upload } from "./flows/upload";

const MediaParam = z.object({ id: MediaId });

/**
 * Upload, status and removal, mounted at /api/media. `guard` is the auth module's requireSession:
 * an onboarded account, with CSRF and Origin already checked for cookie sessions. The upload body
 * is the raw file; it is streamed, never parsed, and no validator may read it first.
 */
export function mediaRoutes(deps: MediaDeps, guard: MiddlewareHandler<AppEnv>) {
  const r = new Hono<AppEnv>();
  const me = (c: Context<AppEnv>): string => c.get("session")!.userId;

  r.post("/", guard, async (c) => {
    const request = { contentType: c.req.header("content-type"), contentLength: c.req.header("content-length"), body: c.req.raw.body };
    return c.json(await upload(deps, me(c), request), 202);
  });
  r.get("/:id", guard, validate("param", MediaParam), async (c) => c.json(await status(deps, me(c), c.req.valid("param").id)));
  r.delete("/:id", guard, validate("param", MediaParam), async (c) => {
    await remove(deps, me(c), c.req.valid("param").id);
    return c.body(null, 204);
  });

  return r;
}
```

### Create `apps/api/src/media/index.ts`

```ts
/**
 * The only file outside `src/media/` may import. Everything else in the module is private and the
 * architecture test fails the build if another file reaches into it.
 */
import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import type { Db } from "@korbat/db";
import type { MediaFormat } from "@korbat/media-protocol";
import type { AppEnv } from "../env";
import type { MediaDeps } from "./context";
import { createMediaFiles } from "./files";
import { createMediaRepo } from "./repo";
import { mediaRoutes } from "./routes";

export { MediaError } from "./context";
export type { MediaDeps } from "./context";

export interface CreateMediaOptions {
  /** The korbat_api pool. The module never sees the auth pool. */
  apiDb: Db;
  /** The uploads volume, which the API writes, and the store volume, which it only reads. */
  uploadsDir: string;
  storeDir: string;
  formats: readonly MediaFormat[];
  minFreeBytes: number;
  logger: Logger;
  /** The auth module's requireSession: an onboarded account with CSRF and Origin checked. */
  requireSession: MiddlewareHandler<AppEnv>;
  /** Built from the social module's write limits, so every per-account limit lives in one table. */
  enforceUploadLimit: MediaDeps["enforceUploadLimit"];
  now?: () => Date;
}

export function createMedia(options: CreateMediaOptions) {
  const deps: MediaDeps = {
    repo: createMediaRepo(options.apiDb),
    files: createMediaFiles({ uploadsDir: options.uploadsDir, storeDir: options.storeDir, log: options.logger }),
    formats: options.formats,
    minFreeBytes: options.minFreeBytes,
    enforceUploadLimit: options.enforceUploadLimit,
    log: options.logger,
    now: options.now ?? (() => new Date()),
  };
  return {
    deps,
    /** Creates the uploads volume's directories. Call once before serving. */
    prepare: () => deps.files.prepare(),
    routes: mediaRoutes(deps, options.requireSession),
  };
}

export type Media = ReturnType<typeof createMedia>;
```

### Replace `apps/api/src/media/context.ts` (whole file)

```ts
import type { MediaErrorCode } from "@korbat/contracts";
import type { MediaFormat } from "@korbat/media-protocol";
import type { Logger } from "pino";
import type { MediaFiles } from "./files";
import type { MediaRepo } from "./repo";

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

/** How many uploads one account may hold that are not on a post yet. */
export const MAX_PENDING_UPLOADS = 20;

export interface MediaDeps {
  repo: MediaRepo;
  files: MediaFiles;
  /** The formats MEDIA_FORMATS enables. The worker reads the same setting. */
  formats: readonly MediaFormat[];
  /** Uploads are refused while either volume has less free space than this. */
  minFreeBytes: number;
  /** Counts one upload against the account's hourly limit and throws when it is used up. */
  enforceUploadLimit: (userId: string, accountCreatedAt: Date, now: Date) => Promise<void>;
  log: Logger;
  now: () => Date;
}
```

### Replace `apps/api/src/social/tiers.ts` (whole file)

```ts
/**
 * Write limits by account age (2a spec, section 6). Sub-project 3 replaces the age check with
 * reputation without changing the buckets or the enforcement.
 */
export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/** Accounts younger than this get the low tier. */
export const NEW_ACCOUNT_MS = 24 * HOUR_MS;
/** Reposting and quoting need an account at least this old. */
export const REPOST_MIN_AGE_MS = 48 * HOUR_MS;

export type WriteAction = "post" | "reply" | "quote" | "repost" | "like" | "bookmark" | "follow" | "block" | "mute" | "upload";

export interface WriteLimit {
  /** Counter name; several actions may share one (quotes count as posts). */
  bucket: string;
  max: number;
  windowMs: number;
}

export const isNewAccount = (accountAgeMs: number): boolean => accountAgeMs < NEW_ACCOUNT_MS;
export const mayRepostOrQuote = (accountAgeMs: number): boolean => accountAgeMs >= REPOST_MIN_AGE_MS;

/** Every window an action must stay within. Follows have an hourly and a daily one. */
export function limitsFor(action: WriteAction, accountAgeMs: number): WriteLimit[] {
  const fresh = isNewAccount(accountAgeMs);
  switch (action) {
    case "post":
    case "quote":
      return [{ bucket: "post", max: fresh ? 5 : 30, windowMs: HOUR_MS }];
    case "reply":
      return [{ bucket: "reply", max: fresh ? 20 : 60, windowMs: HOUR_MS }];
    case "repost":
      return [{ bucket: "repost", max: 30, windowMs: HOUR_MS }];
    case "like":
      return [{ bucket: "like", max: 100, windowMs: HOUR_MS }];
    case "bookmark":
      return [{ bucket: "bookmark", max: 100, windowMs: HOUR_MS }];
    case "follow":
      return [
        { bucket: "follow-hour", max: 50, windowMs: HOUR_MS },
        { bucket: "follow-day", max: 400, windowMs: DAY_MS },
      ];
    case "block":
      return [{ bucket: "block", max: 30, windowMs: HOUR_MS }];
    case "mute":
      return [{ bucket: "mute", max: 30, windowMs: HOUR_MS }];
    // Image uploads (2b). The media module counts them through this table, so every per-account limit lives here.
    case "upload":
      return [{ bucket: "upload", max: fresh ? 20 : 120, windowMs: HOUR_MS }];
  }
}
```

### Replace `apps/api/src/social/index.ts` (whole file)

```ts
/**
 * The only file outside `src/social/` may import. Everything else in the module is private and the
 * architecture test fails the build if another file reaches into it.
 */
import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import type { Db } from "@korbat/db";
import type { AppEnv } from "../env";
import type { RateLimitStore } from "../middleware/rate-limit";
import type { SocialDeps } from "./context";
import { createSocialRepo } from "./repo";
import { socialRoutes } from "./routes";

export { SocialError } from "./context";
export { enforceWriteLimit } from "./limits";
export type { SocialDeps, ViewerId } from "./context";

export interface CreateSocialOptions {
  /** The korbat_api pool. The module never sees the auth pool. */
  apiDb: Db;
  /** Per-account write limits share the store the per-IP middleware uses. */
  rateLimitStore: RateLimitStore;
  logger: Logger;
  /** The auth module's requireSession: an onboarded account with CSRF and Origin checked. */
  requireSession: MiddlewareHandler<AppEnv>;
  now?: () => Date;
}

export function createSocial(options: CreateSocialOptions) {
  const deps: SocialDeps = {
    repo: createSocialRepo(options.apiDb),
    limits: options.rateLimitStore,
    log: options.logger,
    now: options.now ?? (() => new Date()),
  };
  return { deps, routes: socialRoutes(deps, options.requireSession) };
}

export type Social = ReturnType<typeof createSocial>;
```

### Replace `apps/api/src/app.ts` (whole file)

```ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Logger } from "pino";
import { AuthError, type Auth } from "./auth";
import type { Config } from "./config";
import type { AppEnv } from "./env";
import { errorBody } from "./lib/errors";
import { MediaError, type Media } from "./media";
import { observability } from "./middleware/observability";
import { clientIp, rateLimit, type RateLimitStore } from "./middleware/rate-limit";
import { noStore, securityHeaders } from "./middleware/security-headers";
import { healthRoutes, type HealthChecks } from "./routes/health";
import { SocialError, type Social } from "./social";

export interface AppDeps {
  config: Config;
  logger: Logger;
  rateLimitStore: RateLimitStore;
  healthChecks: HealthChecks;
  auth: Auth;
  /** Posting and feed. Optional so auth-only tests need no database for it; the server always wires it. */
  social?: Social;
  /** Image uploads. Optional for the same reason; the server always wires it. */
  media?: Media;
}

export function createApp({ config, logger, rateLimitStore, healthChecks, auth, social, media }: AppDeps) {
  const app = new Hono<AppEnv>();

  app.use(observability(logger));
  app.use(securityHeaders, noStore);
  app.use(cors({ origin: config.TRUSTED_ORIGINS, credentials: true }));
  app.use(rateLimit({ name: "global", store: rateLimitStore, limit: 300, windowMs: 60_000, key: clientIp }));
  app.use(auth.resolveSession);

  app.route("/api/health", healthRoutes(healthChecks, config.KORBAT_VERSION));
  app.route("/api/auth", auth.routes);
  app.get("/api/me", auth.requireOnboarding, auth.me);
  if (media) app.route("/api/media", media.routes);
  if (social) app.route("/api", social.routes);

  app.notFound((c) => c.json(errorBody("not_found", "No such route", c.get("requestId")), 404));
  app.onError((err, c) => {
    if (err instanceof AuthError) return c.json(errorBody(err.code, err.message, c.get("requestId")), err.status);
    if (err instanceof MediaError) return c.json(errorBody(err.code, err.message, c.get("requestId")), err.status);
    if (err instanceof SocialError) {
      if (err.retryAfterSeconds) c.header("Retry-After", String(err.retryAfterSeconds));
      return c.json(errorBody(err.code, err.message, c.get("requestId")), err.status);
    }
    c.get("log").error({ err }, "unhandled error");
    return c.json(errorBody("internal", "Internal error", c.get("requestId")), 500);
  });

  return app;
}
```

### Replace `apps/api/src/index.ts` (whole file)

```ts
import { serve } from "@hono/node-server";
import Redis from "ioredis";
import { closeDb, createDb, ping } from "@korbat/db";
import { createApp } from "./app";
import { createAuth } from "./auth";
import { loadConfig } from "./config";
import { createLogger } from "./lib/logger";
import { smtpMailer } from "./mail/smtp";
import { createMedia } from "./media";
import { RedisStore } from "./middleware/rate-limit";
import { createProfileStore } from "./profiles/store";
import { createSocial, enforceWriteLimit } from "./social";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL, config.NODE_ENV === "development");

const apiDb = createDb(config.DATABASE_URL_API);
const authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
redis.on("error", (err) => logger.error({ err }, "redis error"));
const rateLimitStore = new RedisStore(redis);

const auth = createAuth({
  config,
  logger,
  authDb,
  redis,
  mailer: smtpMailer(config.SMTP_URL, config.MAIL_FROM),
  profiles: createProfileStore(apiDb),
});

const media = createMedia({
  apiDb,
  uploadsDir: config.MEDIA_UPLOADS_DIR,
  storeDir: config.MEDIA_STORE_DIR,
  formats: config.MEDIA_FORMATS,
  minFreeBytes: config.MEDIA_MIN_FREE_BYTES,
  logger,
  requireSession: auth.requireSession,
  enforceUploadLimit: (userId, accountCreatedAt, now) => enforceWriteLimit(rateLimitStore, userId, "upload", accountCreatedAt, now),
});
await media.prepare();

const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession });

const app = createApp({
  config,
  logger,
  rateLimitStore,
  healthChecks: {
    postgres_api: () => ping(apiDb),
    postgres_auth: () => ping(authDb),
    redis: async () => { await redis.ping(); },
  },
  auth,
  social,
  media,
});

const server = serve({ fetch: app.fetch, port: config.PORT, hostname: "0.0.0.0" }, (info) => {
  logger.info({ port: info.port, version: config.KORBAT_VERSION }, "api listening");
});

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  server.close();
  await Promise.allSettled([closeDb(apiDb), closeDb(authDb), redis.quit()]);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
```

## Step 4: verify: test

```bash
pnpm --filter @korbat/api test
```

Expected output contains:

- `Tests  135 passed | 110 skipped (245)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  135 passed | 110 skipped (245)
```

## Step 5: verify: typecheck

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

## Step 6: verify: integration

```bash
pnpm --filter @korbat/api test:integration
```

Expected output contains:

- `Tests  109 passed (109)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  109 passed (109)
```

## Step 7: verify: build

```bash
pnpm --filter @korbat/api build
```

Expected output contains:

- `Build success`

Must not contain:

- `error`

Observed on the dry run:

```text
ESM ⚡️ Build success in 389ms
```

## Step 8: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/app.ts`
- `apps/api/src/index.ts`
- `apps/api/src/media/context.ts`
- `apps/api/src/media/flows/remove.ts`
- `apps/api/src/media/flows/status.ts`
- `apps/api/src/media/flows/upload.ts`
- `apps/api/src/media/index.ts`
- `apps/api/src/media/repo.ts`
- `apps/api/src/media/routes.ts`
- `apps/api/src/social/index.ts`
- `apps/api/src/social/tiers.ts`
- `apps/api/test/integration/media-flows.test.ts`
- `apps/api/test/integration/media-harness.ts`
- `apps/api/test/social/tiers.test.ts`

## Step 9: commit

```bash
git add -A
git commit -q -m "feat(media): upload, status and removal flows with their repository and routes; uploads are tiered by account age; the API mounts /api/media" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(media): upload, status and removal flows with their repository and routes; uploads are tiered by account age; the API mounts /api/media`.

## Report format (mandatory)

```text
TASK 9 REPORT
Files written: <count, expected 14>
Failing-test step (the error line): <paste>
Verify "test": <paste the expected lines as printed>
Verify "typecheck": <paste the expected lines as printed>
Verify "integration": <paste the expected lines as printed>
Verify "build": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
