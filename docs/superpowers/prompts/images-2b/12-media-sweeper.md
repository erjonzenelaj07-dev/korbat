# korbat 2b — Task 12 of 17: The media sweeper: results nobody polled, stuck uploads, unattached uploads, finished deletion requests and orphaned files, under a leader lock

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-18 and 2026-09-19 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

A sweeper in the API, run under a Redis leader lock, finishes what clients leave behind: it finalizes results nobody polled, fails uploads stuck in processing after five minutes, expires unattached uploads after a day, withdraws finished deletion requests after a grace period, and reconciles files that have no row. Its tests move a fake clock.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(social): posts, replies and quotes carry up to four described images, attached and detached inside the post's transaction; every view has its media`.
3. The previous task's integration run ended with `Tests  124 passed (124)`.

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
python docs/superpowers/prompts/images-2b/write_blocks.py docs/superpowers/prompts/images-2b/12-media-sweeper.md 1
```

Expected: 2 lines starting with `wrote`, one for each file below.

### Create `apps/api/test/integration/media-sweeper.test.ts`

```ts
import { existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, createDb, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { upload } from "../../src/media/flows/upload";
import { DELETION_GRACE_MS, ORPHAN_AGE_MS, PROCESSING_TIMEOUT_MS, RECONCILE_INTERVAL_MS, SWEEP_INTERVAL_MS, UNATTACHED_TTL_MS, createSweeper, sweep } from "../../src/media/sweeper";
import { mediaHarness, type MediaHarness } from "./media-harness";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * The sweep acts on every row in the database, and other test files run next to this one. So this
 * file never moves "now": it makes its own rows old by starting a harness clock in the past, and
 * sweeps at the real time. Rows other files create are seconds old and stay out of reach.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the media sweeper", () => {
  let db: Db;
  const harnesses: MediaHarness[] = [];
  const started = (ago: number) => mediaHarness(db, { clockStart: Date.now() - ago }).then((h) => (harnesses.push(h), h));
  const now = () => new Date();

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_API, { max: 4 });
  });
  afterAll(async () => {
    for (const h of harnesses) h.cleanup();
    await closeDb(db);
  });

  test("the numbers", () => {
    expect([PROCESSING_TIMEOUT_MS, UNATTACHED_TTL_MS, ORPHAN_AGE_MS, SWEEP_INTERVAL_MS, RECONCILE_INTERVAL_MS]).toEqual([5 * MINUTE, 24 * HOUR, HOUR, 30_000, 10 * MINUTE]);
    expect(DELETION_GRACE_MS).toBe(10 * MINUTE);
  });

  test("a result nobody asked for is recorded, and the upload is removed", async () => {
    const h = await started(MINUTE);
    const ada = await h.established();
    const sent = await upload(h.deps, ada.id, h.jpeg());
    h.worker.ready(sent.id, { width: 640, height: 480 });
    const report = await sweep(h.deps, now(), { reconcile: false });
    expect(report.finalized).toBeGreaterThanOrEqual(1);
    expect(await h.deps.repo.find(sent.id)).toMatchObject({ status: "ready", width: 640, height: 480 });
    expect(existsSync(h.files.uploads.upload(sent.id))).toBe(false);
  });

  test("an upload the worker never answered fails after five minutes; a younger one is left alone", async () => {
    const old = await started(6 * MINUTE);
    const young = await started(MINUTE);
    const [ada, bob] = [await old.established(), await young.established()];
    const stuck = await upload(old.deps, ada.id, old.jpeg());
    const waiting = await upload(young.deps, bob.id, young.jpeg());

    expect((await sweep(old.deps, now(), { reconcile: false })).timedOut).toBeGreaterThanOrEqual(1);
    expect(await old.deps.repo.find(stuck.id)).toMatchObject({ status: "failed", error: "processing_failed" });
    expect(existsSync(old.files.uploads.upload(stuck.id))).toBe(false);
    expect(await old.files.deletionRequests()).toContain(stuck.id);
    expect(await young.deps.repo.find(waiting.id)).toMatchObject({ status: "processing" });
    expect(existsSync(young.files.uploads.upload(waiting.id))).toBe(true);
  });

  test("uploads nobody posted within a day are removed with their files; images on posts stay", async () => {
    const h = await started(25 * HOUR);
    const ada = await h.established();
    const forgotten = await h.readyImage(ada.id);
    const refused = await upload(h.deps, ada.id, h.jpeg());
    h.worker.failed(refused.id, "corrupt_image");
    const { mediaIds } = await h.postWithImages(ada.id);

    expect((await sweep(h.deps, now(), { reconcile: false })).expired).toBeGreaterThanOrEqual(2);
    expect(await h.deps.repo.find(forgotten)).toBeNull();
    expect(await h.deps.repo.find(refused.id)).toBeNull();
    expect(await h.files.deletionRequests()).toEqual(expect.arrayContaining([forgotten, refused.id]));
    expect(await h.deps.repo.find(mediaIds[0]!)).toMatchObject({ status: "ready" });
    expect(await h.files.deletionRequests()).not.toContain(mediaIds[0]);
  });

  test("a deletion request is withdrawn once the worker has removed everything, but not before it is ten minutes old", async () => {
    const h = await started(MINUTE);
    const [done, pending, fresh] = [h.newId(), h.newId(), h.newId()];
    mkdirSync(h.files.store.imageDir(pending), { recursive: true });
    await h.files.requestDeletion([done, pending, fresh]);
    const elevenMinutesAgo = new Date(Date.now() - 11 * MINUTE);
    for (const id of [done, pending]) utimesSync(h.files.uploads.deletion(id), elevenMinutesAgo, elevenMinutesAgo);

    expect((await sweep(h.deps, now(), { reconcile: false })).withdrawn).toBe(1);
    expect((await h.files.deletionRequests()).sort()).toEqual([pending, fresh].sort());
  });

  test("reconcile: old files without a row are removed, young ones and ones with a row are not", async () => {
    const h = await started(MINUTE);
    const ada = await h.established();
    const longAgo = new Date(Date.now() - 2 * HOUR);
    const age = (path: string) => utimesSync(path, longAgo, longAgo);

    const [orphanImage, youngImage, orphanUpload, youngUpload] = [h.newId(), h.newId(), h.newId(), h.newId()];
    for (const id of [orphanImage, youngImage]) mkdirSync(h.files.store.imageDir(id), { recursive: true });
    age(h.files.store.imageDir(orphanImage));
    for (const id of [orphanUpload, youngUpload]) writeFileSync(h.files.uploads.upload(id), "bytes");
    age(h.files.uploads.upload(orphanUpload));
    const owned = await h.readyImage(ada.id);
    age(h.files.store.imageDir(owned));

    expect((await sweep(h.deps, now(), { reconcile: false })).orphans).toBe(0);
    expect((await sweep(h.deps, now(), { reconcile: true })).orphans).toBe(2);
    expect(await h.files.deletionRequests()).toEqual([orphanImage]);
    expect(existsSync(h.files.uploads.upload(orphanUpload))).toBe(false);
    expect(existsSync(h.files.uploads.upload(youngUpload))).toBe(true);
    expect(existsSync(h.files.store.imageDir(owned))).toBe(true);
  });

  test("only the instance that holds the lock sweeps, and it reconciles when that lock is free too", async () => {
    const h = await started(MINUTE);
    const asked: string[] = [];
    const lock = (grant: Record<string, boolean>) => ({
      acquire: async (key: string, ttlMs: number) => {
        asked.push(`${key}:${ttlMs}`);
        return grant[key] ?? false;
      },
    });
    expect(await createSweeper(h.deps, lock({})).round()).toBeNull();
    expect(asked).toEqual(["media:sweeper:25000"]);

    const orphan = h.newId();
    mkdirSync(h.files.store.imageDir(orphan), { recursive: true });
    const longAgo = new Date(Date.now() - 2 * HOUR);
    utimesSync(h.files.store.imageDir(orphan), longAgo, longAgo);
    h.deps.now = () => new Date();
    expect((await createSweeper(h.deps, lock({ "media:sweeper": true })).round())?.orphans).toBe(0);
    expect((await createSweeper(h.deps, lock({ "media:sweeper": true, "media:sweeper:reconcile": true })).round())?.orphans).toBe(1);
    expect(asked).toContain("media:sweeper:reconcile:600000");
  });
});
```

### Replace `apps/api/test/integration/media-harness.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import pino from "pino";
import { postMedia, posts, type Db } from "@korbat/db";
import type { MediaFailure } from "@korbat/contracts";
import { MEDIA_FORMATS, type MediaFormat } from "@korbat/media-protocol";
import type { MediaDeps } from "../../src/media/context";
import { createMediaFiles } from "../../src/media/files";
import { status } from "../../src/media/flows/status";
import { upload } from "../../src/media/flows/upload";
import { createMediaRepo } from "../../src/media/repo";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { enforceWriteLimit } from "../../src/social/limits";
import { createSocialRepo } from "../../src/social/repo";
import { DAY_MS, HOUR_MS } from "../../src/social/tiers";
import { newPost, newProfile, ticker } from "./social-fixtures";

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
export async function mediaHarness(db: Db, options: { formats?: readonly MediaFormat[]; minFreeBytes?: number; storeDevice?: number; clockStart?: number } = {}) {
  const clock = ticker(options.clockStart);
  const root = mkdtempSync(path.join(tmpdir(), "korbat-media-"));
  const files = createMediaFiles({ uploadsDir: path.join(root, "uploads"), storeDir: path.join(root, "store"), log: pino({ level: "silent" }), storeDevice: options.storeDevice });
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

  /** An image of this account that the worker accepted and the API recorded: ready, on no post yet. */
  async function readyImage(ownerId: string, size?: { width: number; height: number }): Promise<string> {
    const sent = await upload(deps, ownerId, { contentType: "image/jpeg", contentLength: undefined, body: bodyOf(BYTES.jpeg) });
    worker.ready(sent.id, size);
    await status(deps, ownerId, sent.id);
    return sent.id;
  }

  /** A post by this account with ready images on it, written straight to the tables. */
  async function postWithImages(authorId: string, count = 1, body = "a post with images"): Promise<{ postId: string; mediaIds: string[] }> {
    const postId = await newPost(createSocialRepo(db), authorId, clock.next(), body);
    const mediaIds: string[] = [];
    for (let position = 0; position < count; position++) {
      const id = await readyImage(authorId);
      await db.update(postMedia).set({ postId, position, altText: `image ${position + 1}` }).where(eq(postMedia.id, id));
      mediaIds.push(id);
    }
    return { postId, mediaIds };
  }

  const setPostState = (postId: string, state: "visible" | "withheld" | "removed" | "deleted_by_author") => db.update(posts).set({ state }).where(eq(posts.id, postId));

  return {
    deps,
    files,
    clock,
    worker,
    readyImage,
    postWithImages,
    setPostState,
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

## Step 2: run the tests and watch them fail

```bash
pnpm --filter @korbat/api test:integration
```

Expected: the command exits with an error, and the output contains:

- `Cannot find module '../../src/media/sweeper'`

Observed on the dry run:

```text
Error: Cannot find module '../../src/media/sweeper' imported from C:\Users\Lenovo\Desktop\cool\korbat/apps/api/test/integration/media-sweeper.test.ts
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/images-2b/write_blocks.py docs/superpowers/prompts/images-2b/12-media-sweeper.md 3
```

Expected: 5 lines starting with `wrote`, one for each file below.

### Create `apps/api/src/media/sweeper.ts`

```ts
import type { MediaDeps } from "./context";
import { finalize } from "./flows/status";

/** An upload the worker has not answered for this long has failed. Normal processing takes seconds. */
export const PROCESSING_TIMEOUT_MS = 5 * 60_000;
/** An upload nobody put on a post within a day is removed. */
export const UNATTACHED_TTL_MS = 24 * 60 * 60_000;
/** Files without a row are only treated as orphans once they are this old, so work in flight is never touched. */
export const ORPHAN_AGE_MS = 60 * 60_000;
/**
 * A deletion request stays at least this long. The worker may be in the middle of an image when
 * the request arrives, and writes its files afterwards; one image takes at most two minutes before
 * the worker's watchdog ends it, so after ten the request has been seen with everything in place.
 */
export const DELETION_GRACE_MS = 10 * 60_000;
export const SWEEP_INTERVAL_MS = 30_000;
export const RECONCILE_INTERVAL_MS = 10 * 60_000;

export interface SweepReport {
  finalized: number;
  timedOut: number;
  expired: number;
  withdrawn: number;
  orphans: number;
}

/**
 * Housekeeping that no request triggers. It is a plain function of the clock, so tests call it
 * with whatever time they need. Every step is safe to repeat and safe to run next to live traffic.
 */
export async function sweep(deps: MediaDeps, now: Date, options: { reconcile: boolean }): Promise<SweepReport> {
  const report: SweepReport = { finalized: 0, timedOut: 0, expired: 0, withdrawn: 0, orphans: 0 };

  // 1. Results nobody asked for: the composer was closed, or the post was written from another device.
  for (const id of await deps.repo.processingIds()) {
    if (await finalize(deps, id)) report.finalized++;
  }

  // 2. Uploads the worker never answered, because it was down or the file killed it three times.
  const stale = await deps.repo.failStale(new Date(now.getTime() - PROCESSING_TIMEOUT_MS));
  // 3. Uploads nobody posted.
  const expired = await deps.repo.deleteUnattachedBefore(new Date(now.getTime() - UNATTACHED_TTL_MS));
  report.timedOut = stale.length;
  report.expired = expired.length;
  for (const id of [...stale, ...expired]) await deps.files.discardUpload(id);
  await deps.files.requestDeletion([...stale, ...expired]);

  // 4. Deletion requests the worker has carried out, once they are old enough to have covered late writes.
  for (const { id, ageMs } of await deps.files.deletionRequestAges(now.getTime())) {
    if (ageMs < DELETION_GRACE_MS || (await deps.files.imageRemains(id))) continue;
    await deps.files.withdrawDeletion(id);
    report.withdrawn++;
  }

  // 5. What a crash between a commit and a file operation left behind, and the files of deleted
  //    accounts, whose rows went by cascade.
  if (options.reconcile) {
    const nowMs = now.getTime();
    const images = (await deps.files.storedImages(nowMs)).filter((entry) => entry.ageMs > ORPHAN_AGE_MS).map((entry) => entry.id);
    const uploads = (await deps.files.storedUploads(nowMs)).filter((entry) => entry.ageMs > ORPHAN_AGE_MS).map((entry) => entry.id);
    const known = await deps.repo.existing([...new Set([...images, ...uploads])]);
    const orphanImages = images.filter((id) => !known.has(id));
    const orphanUploads = uploads.filter((id) => !known.has(id));
    await deps.files.requestDeletion(orphanImages);
    for (const id of orphanUploads) await deps.files.discardUpload(id);
    report.orphans = orphanImages.length + orphanUploads.length;
    if (report.orphans > 0) deps.log.warn({ images: orphanImages.length, uploads: orphanUploads.length }, "media: removed files that had no row");
  }
  return report;
}

/** Lets one API instance sweep at a time. The server builds it on Redis; nothing here knows Redis. */
export interface SweepLock {
  /** True when the key was free and is now held for `ttlMs`. */
  acquire(key: string, ttlMs: number): Promise<boolean>;
}

export function createSweeper(deps: MediaDeps, lock: SweepLock) {
  /** One round: skipped when another instance holds the lock; reconciles when that is due. */
  async function round(): Promise<SweepReport | null> {
    if (!(await lock.acquire("media:sweeper", SWEEP_INTERVAL_MS - 5_000))) return null;
    const reconcile = await lock.acquire("media:sweeper:reconcile", RECONCILE_INTERVAL_MS);
    return sweep(deps, deps.now(), { reconcile });
  }
  return {
    round,
    /** Sweeps every thirty seconds until the returned function is called. */
    start(): () => void {
      const timer = setInterval(() => void round().catch((err: unknown) => deps.log.error({ err }, "media: sweep failed")), SWEEP_INTERVAL_MS);
      timer.unref();
      return () => clearInterval(timer);
    },
  };
}
```

### Replace `apps/api/src/media/repo.ts` (whole file)

```ts
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { mediaPath, type MediaView } from "@korbat/contracts";
import { postMedia, posts, profiles, type Db, type DbTx } from "@korbat/db";
import type { ResultFile } from "@korbat/media-protocol";
import { MediaError } from "./context";

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

    /** What serving an image file depends on: whether it is ready, and its post's state and author. */
    async fileAccess(id: string): Promise<{ status: MediaRow["status"]; postState: string | null; authorId: string | null } | null> {
      const rows = await db
        .select({ status: postMedia.status, postState: posts.state, authorId: posts.authorId })
        .from(postMedia)
        .leftJoin(posts, eq(posts.id, postMedia.postId))
        .where(eq(postMedia.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    /**
     * Puts images on a post, inside the transaction that creates it. Each must belong to the author,
     * be ready and be on no post yet; anything else rolls the post back.
     */
    async attach(tx: DbTx, input: { postId: string; ownerId: string; items: readonly { id: string; alt: string }[] }): Promise<void> {
      for (const [position, item] of input.items.entries()) {
        const rows = await tx
          .update(postMedia)
          .set({ postId: input.postId, position, altText: item.alt })
          .where(and(eq(postMedia.id, item.id), eq(postMedia.ownerId, input.ownerId), isNull(postMedia.postId), eq(postMedia.status, "ready")))
          .returning({ id: postMedia.id });
        if (rows.length !== 1) throw new MediaError("media_unavailable", 400);
      }
    },

    /** Removes a post's images, inside the transaction that deletes it, and says which files to delete afterwards. */
    async detachAll(tx: DbTx, postId: string): Promise<string[]> {
      const rows = await tx.delete(postMedia).where(eq(postMedia.postId, postId)).returning({ id: postMedia.id });
      return rows.map((row) => row.id);
    },

    /** The images of a page of posts, in one query, in their order on each post. */
    async forPosts(postIds: readonly string[]): Promise<Map<string, MediaView[]>> {
      const byPost = new Map<string, MediaView[]>();
      if (postIds.length === 0) return byPost;
      const rows = await db
        .select({ id: postMedia.id, postId: postMedia.postId, width: postMedia.width, height: postMedia.height, blurhash: postMedia.blurhash, altText: postMedia.altText })
        .from(postMedia)
        .where(and(inArray(postMedia.postId, [...postIds]), eq(postMedia.status, "ready")))
        .orderBy(postMedia.postId, postMedia.position);
      for (const row of rows) {
        if (!row.postId || row.width === null || row.height === null || row.blurhash === null) continue;
        const view: MediaView = { id: row.id, width: row.width, height: row.height, blurhash: row.blurhash, alt: row.altText ?? "", small: mediaPath(row.id, "small"), large: mediaPath(row.id, "large") };
        byPost.set(row.postId, [...(byPost.get(row.postId) ?? []), view]);
      }
      return byPost;
    },

    /** Uploads that still wait for the worker's verdict. */
    async processingIds(): Promise<string[]> {
      const rows = await db.select({ id: postMedia.id }).from(postMedia).where(eq(postMedia.status, "processing")).orderBy(postMedia.createdAt);
      return rows.map((row) => row.id);
    },

    /** Fails uploads the worker has not answered since `before`, and says which. */
    async failStale(before: Date): Promise<string[]> {
      const rows = await db
        .update(postMedia)
        .set({ status: "failed", error: "processing_failed" })
        .where(and(eq(postMedia.status, "processing"), lt(postMedia.createdAt, before)))
        .returning({ id: postMedia.id });
      return rows.map((row) => row.id);
    },

    /** Removes uploads made before `before` that were never put on a post, whatever their state, and says which. */
    async deleteUnattachedBefore(before: Date): Promise<string[]> {
      const rows = await db.delete(postMedia).where(and(isNull(postMedia.postId), lt(postMedia.createdAt, before))).returning({ id: postMedia.id });
      return rows.map((row) => row.id);
    },

    /** Which of these ids have a row. */
    async existing(ids: readonly string[]): Promise<Set<string>> {
      if (ids.length === 0) return new Set();
      const rows = await db.select({ id: postMedia.id }).from(postMedia).where(inArray(postMedia.id, [...ids]));
      return new Set(rows.map((row) => row.id));
    },

    /** Removes a row whatever its state. Used when an upload could not be handed to the worker. */
    async deleteRow(id: string): Promise<void> {
      await db.delete(postMedia).where(eq(postMedia.id, id));
    },
  };
}

export type MediaRepo = ReturnType<typeof createMediaRepo>;
```

### Replace `apps/api/src/media/index.ts` (whole file)

```ts
/**
 * The only file outside `src/media/` may import. Everything else in the module is private and the
 * architecture test fails the build if another file reaches into it.
 */
import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import type { Db } from "@korbat/db";
import { HEARTBEAT_STALE_MS, type MediaFormat } from "@korbat/media-protocol";
import type { AppEnv } from "../env";
import type { RateLimitStore } from "../middleware/rate-limit";
import type { MediaDeps, MediaForPosts } from "./context";
import { createMediaFiles } from "./files";
import { createMediaRepo } from "./repo";
import { mediaFileRoutes, mediaRoutes } from "./routes";
import { createSweeper, sweep, type SweepLock } from "./sweeper";

export { MediaError } from "./context";
export type { MediaDeps, MediaForPosts } from "./context";
export type { SweepLock, SweepReport } from "./sweeper";

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
  /** The auth module's resolveSession. The file routes run it themselves, and only when they must. */
  resolveSession: MiddlewareHandler<AppEnv>;
  /** Image requests have their own per-IP bucket in the store the other limits use. */
  rateLimitStore: RateLimitStore;
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
  const forPosts: MediaForPosts = {
    attach: (tx, input) => deps.repo.attach(tx, input),
    detachAll: (tx, postId) => deps.repo.detachAll(tx, postId),
    requestDeletion: (ids) => deps.files.requestDeletion(ids),
    forPosts: (postIds) => deps.repo.forPosts(postIds),
  };
  return {
    deps,
    /** The interface the social module uses to put images on posts and read them back. */
    forPosts,
    /** Creates the uploads volume's directories. Call once before serving. */
    prepare: () => deps.files.prepare(),
    routes: mediaRoutes(deps, options.requireSession),
    /** Mounted before the global rate limit and session resolution. */
    fileRoutes: mediaFileRoutes(deps, { resolveSession: options.resolveSession, rateLimitStore: options.rateLimitStore }),
    /** One pass of housekeeping at the given time. The server runs it on a timer; tests call it directly. */
    sweep: (now: Date, options: { reconcile: boolean }) => sweep(deps, now, options),
    /** Starts sweeping every thirty seconds under the lock, and returns the function that stops it. */
    startSweeper: (lock: SweepLock) => createSweeper(deps, lock).start(),
    /** An advisory health check: the worker's heartbeat is fresh and the volumes have room. */
    async healthCheck(): Promise<void> {
      const age = await deps.files.heartbeatAge(deps.now().getTime());
      if (age === null || age > HEARTBEAT_STALE_MS) throw new Error("the image worker's heartbeat is missing or stale");
      if ((await deps.files.freeBytes()) < deps.minFreeBytes) throw new Error("free space on the media volumes is under the floor");
    },
  };
}

export type Media = ReturnType<typeof createMedia>;
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
  resolveSession: auth.resolveSession,
  rateLimitStore,
  enforceUploadLimit: (userId, accountCreatedAt, now) => enforceWriteLimit(rateLimitStore, userId, "upload", accountCreatedAt, now),
});
await media.prepare();
// One API instance sweeps at a time: the lock is a Redis key that expires on its own.
const stopSweeper = media.startSweeper({ acquire: async (key, ttlMs) => (await redis.set(key, "1", "PX", ttlMs, "NX")) === "OK" });

const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, media: media.forPosts });

const app = createApp({
  config,
  logger,
  rateLimitStore,
  healthChecks: {
    postgres_api: () => ping(apiDb),
    postgres_auth: () => ping(authDb),
    redis: async () => { await redis.ping(); },
  },
  advisoryChecks: { image_worker: media.healthCheck },
  auth,
  social,
  media,
});

const server = serve({ fetch: app.fetch, port: config.PORT, hostname: "0.0.0.0" }, (info) => {
  logger.info({ port: info.port, version: config.KORBAT_VERSION }, "api listening");
});

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  stopSweeper();
  server.close();
  await Promise.allSettled([closeDb(apiDb), closeDb(authDb), redis.quit()]);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
```

### Replace `apps/api/src/media/files.ts` (whole file)

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

    /** Deletion requests with their age, for the sweeper, which only withdraws one after a grace period. */
    async deletionRequestAges(now: number): Promise<{ id: string; ageMs: number }[]> {
      const found: { id: string; ageMs: number }[] = [];
      for (const id of (await namesIn(uploads.deletions)).filter(isMediaId)) {
        const stats = await stat(uploads.deletion(id)).catch(() => null);
        if (stats) found.push({ id, ageMs: now - stats.mtimeMs });
      }
      return found;
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

## Step 4: verify: test

```bash
pnpm --filter @korbat/api test
```

Expected output contains:

- `Tests  142 passed | 132 skipped (274)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  142 passed | 132 skipped (274)
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

- `Tests  131 passed (131)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  131 passed (131)
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
ESM ⚡️ Build success in 361ms
```

## Step 8: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/index.ts`
- `apps/api/src/media/files.ts`
- `apps/api/src/media/index.ts`
- `apps/api/src/media/repo.ts`
- `apps/api/src/media/sweeper.ts`
- `apps/api/test/integration/media-harness.ts`
- `apps/api/test/integration/media-sweeper.test.ts`

## Step 9: commit

```bash
git add -A
git commit -q -m "feat(media): sweeper finalizes unpolled results, fails stuck uploads after five minutes, expires unattached ones after a day, withdraws finished deletion requests and reconciles orphans under a Redis lock" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(media): sweeper finalizes unpolled results, fails stuck uploads after five minutes, expires unattached ones after a day, withdraws finished deletion requests and reconciles orphans under a Redis lock`.

## Report format (mandatory)

```text
TASK 12 REPORT
Files written: <count, expected 7>
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
