# korbat 2b — Task 10 of 17: Serving image files after a visibility check: own rate-limit bucket, no session for public images, advisory health, and the media module's boundary rules

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-18 and 2026-09-19 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Image files are served at `/api/media/<id>/<small|large>.webp` after the post's visibility check: anyone for a visible post, with `public, max-age=300`; only the author, never cached, for a withheld or removed one; 404 for everything else. The route is mounted before the global rate limit and before session resolution, with its own bucket. Health gains advisory checks, so a stale worker reports `degraded` without failing the API, and the architecture test extends to the media module's boundary.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(media): upload, status and removal flows with their repository and routes; uploads are tiered by account age; the API mounts /api/media`.
3. The previous task's last API unit run ended with `Tests  109 passed (109)`.

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
python docs/superpowers/prompts/images-2b/write_blocks.py docs/superpowers/prompts/images-2b/10-media-serving.md 1
```

Expected: 5 lines starting with `wrote`, one for each file below.

### Create `apps/api/test/integration/media-serve.test.ts`

```ts
import { rmSync } from "node:fs";
import { Hono } from "hono";
import pino from "pino";
import { createMiddleware } from "hono/factory";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mediaPath } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import type { AppEnv } from "../../src/env";
import type { MediaDeps } from "../../src/media/context";
import { createMediaFiles } from "../../src/media/files";
import { mediaFileRoutes } from "../../src/media/routes";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { mediaHarness, type MediaHarness } from "./media-harness";

describe.skipIf(!process.env.INTEGRATION)("integration: serving image files", () => {
  let db: Db;
  let h: MediaHarness;
  let resolved = 0;

  /** Stands in for the auth module: the test names the viewer in a header, and counts how often a session was resolved. */
  const resolveSession = createMiddleware<AppEnv>(async (c, next) => {
    resolved++;
    const userId = c.req.header("x-test-viewer");
    c.set("session", userId ? ({ userId } as AppEnv["Variables"]["session"]) : null);
    await next();
  });
  const app = (deps: MediaDeps) => new Hono<AppEnv>().route("/api/media", mediaFileRoutes(deps, { resolveSession, rateLimitStore: new MemoryStore() }));
  const get = (harness: { deps: MediaDeps }, path: string, headers: Record<string, string> = {}) => app(harness.deps).request(path, { headers });

  beforeAll(async () => {
    db = createDb(loadConfig().DATABASE_URL_API, { max: 4 });
    h = await mediaHarness(db);
  });
  afterAll(async () => {
    h.cleanup();
    await closeDb(db);
  });

  test("an image of a visible post is public, cacheable for five minutes, and costs no session lookup", async () => {
    const ada = await h.established();
    const { mediaIds } = await h.postWithImages(ada.id);
    resolved = 0;
    for (const size of ["large", "small"] as const) {
      const res = await get(h, mediaPath(mediaIds[0]!, size));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/webp");
      expect(res.headers.get("cache-control")).toBe("public, max-age=300");
      expect(res.headers.get("etag")).toBe(`"${mediaIds[0]}-${size}"`);
      const body = await res.text();
      expect(body).toBe(`${size}-webp-of-${mediaIds[0]}`);
      expect(res.headers.get("content-length")).toBe(String(body.length));
    }
    expect(resolved).toBe(0);
  });

  test("a matching If-None-Match answers 304 with the same cache headers and no body", async () => {
    const ada = await h.established();
    const { mediaIds } = await h.postWithImages(ada.id);
    const etag = `"${mediaIds[0]}-large"`;
    const res = await get(h, mediaPath(mediaIds[0]!, "large"), { "if-none-match": `"something-else", ${etag}` });
    expect(res.status).toBe(304);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(res.headers.get("etag")).toBe(etag);
    expect(await res.text()).toBe("");
    expect((await get(h, mediaPath(mediaIds[0]!, "large"), { "if-none-match": '"stale"' })).status).toBe(200);
  });

  test("an image that is on no post, is not ready, or does not exist is not found for anyone", async () => {
    const ada = await h.established();
    const unattached = await h.readyImage(ada.id);
    for (const path of [mediaPath(unattached, "large"), mediaPath(h.newId(), "large")]) {
      const res = await get(h, path, { "x-test-viewer": ada.id });
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: "not_found" } });
    }
  });

  test("other names under an image id are not found, and nothing is looked up for them", async () => {
    const ada = await h.established();
    const { mediaIds } = await h.postWithImages(ada.id);
    for (const path of [`/api/media/${mediaIds[0]}/large.png`, `/api/media/${mediaIds[0]}/medium.webp`, `/api/media/${mediaIds[0]}/large.webp.bak`, "/api/media/not-an-id/large.webp", `/api/media/${mediaIds[0]!.toUpperCase()}/large.webp`]) {
      expect((await get(h, path)).status, path).toBe(404);
    }
  });

  test.each(["withheld", "removed"] as const)("images of a %s post reach their author only, and are never cached", async (state) => {
    const [ada, bob] = await Promise.all([h.established(), h.established()]);
    const { postId, mediaIds } = await h.postWithImages(ada.id);
    await h.setPostState(postId, state);
    const path = mediaPath(mediaIds[0]!, "large");

    const own = await get(h, path, { "x-test-viewer": ada.id });
    expect(own.status).toBe(200);
    expect(own.headers.get("cache-control")).toBe("private, no-store");
    expect(await own.text()).toBe(`large-webp-of-${mediaIds[0]}`);

    expect((await get(h, path, { "x-test-viewer": bob.id })).status).toBe(404);
    expect((await get(h, path)).status).toBe(404);
    const revalidate = await get(h, path, { "x-test-viewer": bob.id, "if-none-match": `"${mediaIds[0]}-large"` });
    expect(revalidate.status).toBe(404);
  });

  test("images of a deleted post are gone, for the author too", async () => {
    const ada = await h.established();
    const { postId, mediaIds } = await h.postWithImages(ada.id);
    await h.setPostState(postId, "deleted_by_author");
    expect((await get(h, mediaPath(mediaIds[0]!, "large"), { "x-test-viewer": ada.id })).status).toBe(404);
  });

  test("a ready image whose file is missing is not found", async () => {
    const ada = await h.established();
    const { mediaIds } = await h.postWithImages(ada.id);
    rmSync(h.files.store.image(mediaIds[0]!, "small"));
    expect((await get(h, mediaPath(mediaIds[0]!, "small"))).status).toBe(404);
    expect((await get(h, mediaPath(mediaIds[0]!, "large"))).status).toBe(200);
  });

  test("a file that is not on the store's own device is never served: that is what a planted symlink resolves to", async () => {
    const ada = await h.established();
    const { mediaIds } = await h.postWithImages(ada.id);
    const files = createMediaFiles({ uploadsDir: h.files.uploads.root, storeDir: h.files.store.root, log: pino({ level: "silent" }), storeDevice: -1 });
    const res = await get({ deps: { ...h.deps, files } }, mediaPath(mediaIds[0]!, "large"));
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("webp-of");
    expect((await get(h, mediaPath(mediaIds[0]!, "large"))).status).toBe(200);
  });
});
```

### Replace `packages/contracts/test/media.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import {
  ALT_MAX_LENGTH,
  AltText,
  MEDIA_ACCEPTED_TYPES,
  MEDIA_MAX_BYTES,
  MEDIA_MAX_PER_POST,
  MediaAttachment,
  MediaErrorCode,
  MediaFailure,
  MediaStatusResponse,
  MediaView,
  PostView,
  UploadResponse,
  altLength,
  mediaPath,
  normalizeAltText,
} from "../src/index";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("limits and codes", () => {
  test("the numbers the API and the composer share", () => {
    expect(MEDIA_MAX_BYTES).toBe(20_971_520);
    expect(MEDIA_MAX_PER_POST).toBe(4);
    expect(ALT_MAX_LENGTH).toBe(1000);
    expect([...MEDIA_ACCEPTED_TYPES]).toEqual(["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"]);
  });

  test("error codes and failure reasons", () => {
    expect(MediaErrorCode.options).toEqual(["unsupported_media_type", "file_too_large", "too_many_pending_uploads", "uploads_unavailable", "media_unavailable"]);
    expect(MediaFailure.options).toEqual(["unsupported_format", "animated_not_supported", "image_too_large", "corrupt_image", "processing_failed"]);
  });

  test("image paths end in .webp, which is what a CDN caches by default", () => {
    expect(mediaPath(id(7), "small")).toBe(`/api/media/${id(7)}/small.webp`);
    expect(mediaPath(id(7), "large")).toBe(`/api/media/${id(7)}/large.webp`);
  });
});

describe("alt text", () => {
  test("normalization: NFC, every run of whitespace to one space, trimmed", () => {
    expect(normalizeAltText("  a  red\tbarn\r\n\r\nat dusk ")).toBe("a red barn at dusk");
    expect(normalizeAltText("e\u0301")).toBe("\u00e9");
  });

  test("a description is required", () => {
    expect(AltText.safeParse("").success).toBe(false);
    expect(AltText.safeParse(" \n\t ").success).toBe(false);
    expect(AltText.parse(" a cat ")).toBe("a cat");
  });

  test("length is counted in code points after normalization", () => {
    const astral = "\u{1F600}";
    expect(altLength(astral.repeat(3))).toBe(3);
    expect(AltText.safeParse(astral.repeat(ALT_MAX_LENGTH)).success).toBe(true);
    expect(AltText.safeParse(astral.repeat(ALT_MAX_LENGTH + 1)).success).toBe(false);
    expect(AltText.safeParse(`${"a".repeat(ALT_MAX_LENGTH)}   `).success).toBe(true);
  });

  test("control characters are refused, including ones JavaScript does not count as whitespace", () => {
    expect(AltText.safeParse("a\u0000b").success).toBe(false);
    expect(AltText.safeParse("a\u0085b").success).toBe(false);
    expect(AltText.safeParse("a\u001bb").success).toBe(false);
  });

  test("media ids are canonical: any spelling of a UUID becomes its lowercase form", () => {
    expect(MediaAttachment.parse({ id: id(10).toUpperCase().replace("0000000A", "0000000a"), alt: "x" }).id).toBe(id(10));
    expect(MediaAttachment.parse({ id: "3F2A9C1E-8B7D-4E6F-A5C4-0123456789AB", alt: "x" }).id).toBe("3f2a9c1e-8b7d-4e6f-a5c4-0123456789ab");
  });

  test("an attachment is an upload id and a description", () => {
    expect(MediaAttachment.parse({ id: id(1), alt: "  a   cat " })).toEqual({ id: id(1), alt: "a cat" });
    expect(MediaAttachment.safeParse({ id: "nope", alt: "a cat" }).success).toBe(false);
    expect(MediaAttachment.safeParse({ id: id(1) }).success).toBe(false);
  });
});

describe("upload and status responses", () => {
  test("an upload starts as processing", () => {
    expect(UploadResponse.parse({ id: id(1), status: "processing" })).toEqual({ id: id(1), status: "processing" });
    expect(UploadResponse.safeParse({ id: id(1), status: "ready" }).success).toBe(false);
  });

  test("each status carries exactly what it needs", () => {
    expect(MediaStatusResponse.safeParse({ id: id(1), status: "processing" }).success).toBe(true);
    expect(MediaStatusResponse.safeParse({ id: id(1), status: "ready", width: 2048, height: 1536, blurhash: "L2Eo_P_3jb_3" }).success).toBe(true);
    expect(MediaStatusResponse.safeParse({ id: id(1), status: "ready" }).success).toBe(false);
    expect(MediaStatusResponse.safeParse({ id: id(1), status: "ready", width: 0, height: 1536, blurhash: "L2Eo_P_3jb_3" }).success).toBe(false);
    expect(MediaStatusResponse.safeParse({ id: id(1), status: "failed", error: "animated_not_supported" }).success).toBe(true);
    expect(MediaStatusResponse.safeParse({ id: id(1), status: "failed", error: "because" }).success).toBe(false);
  });
});

describe("images on posts", () => {
  const image = { id: id(9), width: 2048, height: 1536, blurhash: "L2Eo_P_3jb_3", alt: "a cat", small: mediaPath(id(9), "small"), large: mediaPath(id(9), "large") };
  const post = {
    id: id(2),
    author: { id: id(1), handle: "ada", displayName: "Ada", verified: false },
    body: "",
    createdAt: "2026-09-18T10:00:00.000Z",
    state: "visible",
    replyTo: null,
    counts: { likes: 0, reposts: 0, replies: 0, quotes: 0 },
    quoteOf: null,
  };

  test("a media view has dimensions, a placeholder, a description and both paths", () => {
    expect(MediaView.parse(image)).toEqual(image);
    expect(MediaView.safeParse({ ...image, blurhash: "" }).success).toBe(false);
    expect(MediaView.safeParse({ ...image, large: undefined }).success).toBe(false);
  });

  test("every post view has a media list, and a post may consist of images only", () => {
    expect(PostView.parse({ ...post, media: [image] }).media).toEqual([image]);
    expect(PostView.parse({ ...post, body: "text", media: [] }).media).toEqual([]);
    expect(PostView.safeParse(post).success).toBe(false);
  });

  test("a quoted post carries its images too", () => {
    const quoted = { ...post, id: id(3), media: [image] };
    const parsed = PostView.parse({ ...post, body: "look", media: [], quoteOf: quoted });
    expect(parsed.quoteOf).toMatchObject({ media: [image] });
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
export async function mediaHarness(db: Db, options: { formats?: readonly MediaFormat[]; minFreeBytes?: number; storeDevice?: number } = {}) {
  const clock = ticker();
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

### Replace `apps/api/test/app.test.ts` (whole file)

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import pino from "pino";
import { HealthResponse } from "@korbat/contracts";
import { createDb } from "@korbat/db";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth";
import { MemoryKv } from "../src/auth/kv";
import { loadConfig } from "../src/config";
import { MemoryMailer } from "../src/mail/memory";
import { createMedia } from "../src/media";
import { MemoryStore } from "../src/middleware/rate-limit";
import { createSocial } from "../src/social";

const key = Buffer.alloc(32, 7).toString("base64");

const config = loadConfig({
  DATABASE_URL_API: "postgres://a:b@localhost:55432/k",
  DATABASE_URL_AUTH: "postgres://a:b@localhost:55432/k",
  REDIS_URL: "redis://localhost:56379",
  KORBAT_VERSION: "9.9.9",
  APP_ORIGIN: "http://localhost:8081",
  AUTH_HMAC_KEY: key,
  IP_HASH_KEY: key,
  TOTP_ENC_KEY: `v1:${key}`,
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  SMTP_URL: "smtp://localhost:1025",
  MAIL_FROM: "korbat <no-reply@korbat.local>",
  TERMS_VERSION: "draft-2026-09",
});

const mediaRoot = mkdtempSync(path.join(tmpdir(), "korbat-app-test-"));

/** The real app with every module; the database pools are created but never connect in these tests. */
function app(checks: Record<string, () => Promise<void>>, advisoryChecks?: Record<string, () => Promise<void>>) {
  const logger = pino({ level: "silent" });
  const rateLimitStore = new MemoryStore();
  const auth = createAuth({
    config,
    logger,
    authDb: createDb(config.DATABASE_URL_AUTH, { max: 1 }),
    kv: new MemoryKv(),
    mailer: new MemoryMailer(),
    profiles: { create: async () => ({ ok: false, reason: "handle_taken" }), find: async () => null },
  });
  const apiDb = createDb(config.DATABASE_URL_API, { max: 1 });
  const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession });
  const media = createMedia({
    apiDb,
    uploadsDir: path.join(mediaRoot, "uploads"),
    storeDir: path.join(mediaRoot, "store"),
    formats: config.MEDIA_FORMATS,
    minFreeBytes: 0,
    logger,
    requireSession: auth.requireSession,
    resolveSession: auth.resolveSession,
    rateLimitStore,
    enforceUploadLimit: async () => undefined,
  });
  return createApp({ config, logger, rateLimitStore, healthChecks: checks, advisoryChecks, auth, social, media });
}

describe("GET /api/health", () => {
  test("200 ok when all checks pass", async () => {
    const res = await app({ postgres: async () => {}, redis: async () => {} }).request("/api/health");
    expect(res.status).toBe(200);
    const body = HealthResponse.parse(await res.json());
    expect(body).toEqual({ status: "ok", version: "9.9.9", checks: { postgres: "ok", redis: "ok" } });
  });
  test("503 degraded when a check throws", async () => {
    const res = await app({ postgres: async () => { throw new Error("down"); }, redis: async () => {} }).request("/api/health");
    expect(res.status).toBe(503);
    expect(HealthResponse.parse(await res.json()).checks).toEqual({ postgres: "fail", redis: "ok" });
  });
});

describe("advisory health checks", () => {
  const down = async () => {
    throw new Error("stale heartbeat");
  };
  test("a failing advisory check is reported as degraded, with status 200", async () => {
    const res = await app({ postgres: async () => {} }, { image_worker: down }).request("/api/health");
    expect(res.status).toBe(200);
    expect(HealthResponse.parse(await res.json())).toEqual({ status: "degraded", version: "9.9.9", checks: { postgres: "ok", image_worker: "fail" } });
  });
  test("a failing critical check is still 503, whatever the advisory ones say", async () => {
    const res = await app({ postgres: down }, { image_worker: async () => {} }).request("/api/health");
    expect(res.status).toBe(503);
    expect(HealthResponse.parse(await res.json()).checks).toEqual({ postgres: "fail", image_worker: "ok" });
  });
});

describe("caching", () => {
  test("responses are no-store unless the handler set its own Cache-Control", async () => {
    const a = app({});
    a.get("/api/cached", (c) => {
      c.header("Cache-Control", "public, max-age=300");
      return c.text("image bytes");
    });
    expect((await a.request("/api/health")).headers.get("cache-control")).toBe("no-store");
    expect((await a.request("/api/nope")).headers.get("cache-control")).toBe("no-store");
    expect((await a.request("/api/cached")).headers.get("cache-control")).toBe("public, max-age=300");
  });
});

describe("media routes", () => {
  const id = "3f2a9c1e-8b7d-4e6f-a5c4-0123456789ab";
  test("uploading, status and removal need a session", async () => {
    const a = app({});
    const upload = await a.request("/api/media", { method: "POST", headers: { "content-type": "image/jpeg" }, body: "x" });
    expect(upload.status).toBe(401);
    expect(await upload.json()).toMatchObject({ error: { code: "unauthenticated" } });
    expect((await a.request(`/api/media/${id}`)).status).toBe(401);
    expect((await a.request(`/api/media/${id}`, { method: "DELETE" })).status).toBe(401);
  });
  test("image file requests that cannot name an image are not found before any query runs", async () => {
    const a = app({});
    for (const url of ["/api/media/not-an-id/large.webp", `/api/media/${id}/large.png`, `/api/media/${id}/huge.webp`]) {
      const res = await a.request(url);
      expect(res.status, url).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: "not_found" } });
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    }
  });
  test("image files have their own bucket of 1200 a minute, outside the global 300", async () => {
    const a = app({});
    let last = 0;
    for (let i = 0; i < 1201; i++) last = (await a.request("/api/media/not-an-id/large.webp")).status;
    expect(last).toBe(429);
    expect((await a.request("/api/health")).status).toBe(200);
  });
});

describe("routing", () => {
  test("unknown route returns 404 envelope", async () => {
    const res = await app({}).request("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "not_found" } });
  });
  test("/api/me is 401 without a session", async () => {
    const res = await app({}).request("/api/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "unauthenticated" } });
  });
  test("state-changing requests from another origin are refused before any handler runs", async () => {
    const res = await app({}).request("/api/auth/email/start", {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "csrf_failed" } });
  });
  test("thrown errors become a 500 envelope without leaking the message", async () => {
    const a = app({});
    a.get("/api/boom", () => { throw new Error("secret detail"); });
    const res = await a.request("/api/boom");
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("secret detail");
    expect(JSON.parse(text)).toMatchObject({ error: { code: "internal" } });
  });
});

describe("social routes", () => {
  test("writes and the Following timeline need a session", async () => {
    const a = app({});
    const post = await a.request("/api/posts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: "hi" }) });
    expect(post.status).toBe(401);
    expect(await post.json()).toMatchObject({ error: { code: "unauthenticated" } });
    expect((await a.request("/api/timeline/following")).status).toBe(401);
    expect((await a.request("/api/me/bookmarks")).status).toBe(401);
  });
  test("malformed ids and handles are refused before any query runs", async () => {
    const a = app({});
    const post = await a.request("/api/posts/not-a-uuid");
    expect(post.status).toBe(400);
    expect(await post.json()).toMatchObject({ error: { code: "invalid_request" } });
    expect((await a.request("/api/profiles/has%20space")).status).toBe(400);
    expect((await a.request("/api/timeline/latest?limit=500")).status).toBe(400);
  });
});
```

### Replace `apps/api/test/architecture.test.ts` (whole file)

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Module boundaries (1a spec section 2.2, 2a spec section 2.2). Paths are relative to apps/api/src
 * with forward slashes. The rules are plain functions so the tests below can prove each one catches
 * a deliberate violation.
 */
interface SourceFile {
  path: string;
  source: string;
}

const SRC_ROOT = fileURLToPath(new URL("../src", import.meta.url));
const SCHEMA_ROOT = fileURLToPath(new URL("../../../packages/db/src/schema", import.meta.url));

/** Schema files that define auth-schema objects or shared helpers; every other schema file is public. */
const NON_PUBLIC_SCHEMA_FILES = new Set(["auth.ts", "helpers.ts", "index.ts"]);
const AUTH_SCHEMA_FILE = "auth.ts";
const AUTH_POOL_ALLOWED = new Set(["config.ts", "index.ts", "cli/grant-role.ts"]);
const AUTH_KEYS_ALLOWED = new Set(["config.ts"]);

/** Modules that may only be entered through their index file. */
const MODULES = ["auth", "social", "media"] as const;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

function loadSources(): SourceFile[] {
  return walk(SRC_ROOT).map((full) => ({ path: relative(SRC_ROOT, full).split(sep).join("/"), source: readFileSync(full, "utf8") }));
}

function exportedNames(file: string): string[] {
  const source = readFileSync(join(SCHEMA_ROOT, file), "utf8");
  return [...source.matchAll(/^export (?:const|function|type|interface|enum) ([A-Za-z0-9_]+)/gm)].map((m) => m[1]!);
}

/** Names exported by the public-schema files of @korbat/db (tables and enums the auth module must not touch). */
function publicSchemaNames(): Set<string> {
  const names = new Set<string>();
  for (const file of readdirSync(SCHEMA_ROOT)) {
    if (!file.endsWith(".ts") || NON_PUBLIC_SCHEMA_FILES.has(file)) continue;
    for (const name of exportedNames(file)) names.add(name);
  }
  return names;
}

/** Names exported by the auth-schema file of @korbat/db (tables and enums the social module must not touch). */
function authSchemaNames(): Set<string> {
  return new Set(exportedNames(AUTH_SCHEMA_FILE));
}

/** Every module specifier in static imports, re-exports, side-effect imports and dynamic imports. */
function specifiers(source: string): string[] {
  return [...source.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g)].map((m) => m[1]!);
}

/** Named bindings of every `import { ... } from "@korbat/db"`; a namespace import yields the marker "*". */
function dbImports(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(/\bimport\s+(type\s+)?(\*\s+as\s+\w+|\{[^}]*\})\s+from\s+["'](@korbat\/db(?:\/[^"']*)?)["']/g)) {
    const bindings = match[2]!;
    if (bindings.startsWith("*")) {
      names.push("*");
      continue;
    }
    for (const part of bindings.slice(1, -1).split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!.trim();
      if (name) names.push(name);
    }
  }
  return names;
}

const insideAuth = (path: string) => path.startsWith("auth/");
const insideSocial = (path: string) => path.startsWith("social/");
const insideMedia = (path: string) => path.startsWith("media/");

function findViolations(files: SourceFile[], publicNames: Set<string>, authNames: Set<string>): string[] {
  const violations: string[] = [];
  for (const { path, source } of files) {
    for (const spec of specifiers(source)) {
      if (!spec.startsWith(".")) continue;
      const target = posix.normalize(posix.join(posix.dirname(path), spec)).replace(/\.ts$/, "");
      for (const module of MODULES) {
        if (path.startsWith(`${module}/`)) continue;
        if (target.startsWith(`${module}/`) && target !== `${module}/index`) {
          violations.push(`${path}: imports ${spec}, which is inside the ${module} module (use ./${module})`);
        }
      }
    }
    if (!insideAuth(path) && !AUTH_POOL_ALLOWED.has(path) && /\b(DATABASE_URL_AUTH|authDb)\b/.test(source)) {
      violations.push(`${path}: references the auth database pool`);
    }
    if (!insideAuth(path) && !AUTH_KEYS_ALLOWED.has(path) && /\b(TOTP_ENC_KEY|AUTH_HMAC_KEY|IP_HASH_KEY)\b/.test(source)) {
      violations.push(`${path}: references an auth key`);
    }
    if (insideAuth(path)) {
      for (const name of dbImports(source)) {
        if (name === "*") violations.push(`${path}: namespace import of @korbat/db (import auth-schema names explicitly)`);
        else if (publicNames.has(name)) violations.push(`${path}: imports public-schema ${name} from @korbat/db`);
      }
    }
    if (!insideMedia(path) && /\b(postMedia|post_media)\b/.test(source)) {
      violations.push(`${path}: references post_media, which only the media module may touch`);
    }
    if (insideSocial(path) || insideMedia(path)) {
      for (const name of dbImports(source)) {
        if (name === "*") violations.push(`${path}: namespace import of @korbat/db (import public-schema names explicitly)`);
        else if (authNames.has(name)) violations.push(`${path}: imports auth-schema ${name} from @korbat/db`);
      }
    }
  }
  return violations;
}

describe("module boundaries", () => {
  test("walks the real source tree", () => {
    const paths = loadSources().map((f) => f.path);
    expect(paths).toContain("auth/index.ts");
    expect(paths).toContain("social/index.ts");
    expect(paths).toContain("media/index.ts");
    expect(paths).toContain("app.ts");
    expect(publicSchemaNames()).toContain("profiles");
    expect(publicSchemaNames()).not.toContain("users");
    expect(authSchemaNames()).toContain("users");
    expect(authSchemaNames()).not.toContain("posts");
  });

  test("apps/api/src has no boundary violations", () => {
    expect(findViolations(loadSources(), publicSchemaNames(), authSchemaNames())).toEqual([]);
  });

  test("allows the module indexes, the permitted pool owners and each module's own schema", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { createAuth } from "./auth";\nimport type { Auth } from "./auth/index";\nimport { createSocial } from "./social";` },
      { path: "profiles/store.ts", source: `import { isUniqueViolation } from "../auth";` },
      { path: "cli/grant-role.ts", source: `const authDb = createDb(config.DATABASE_URL_AUTH);` },
      { path: "index.ts", source: `const authDb = createDb(config.DATABASE_URL_AUTH);` },
      { path: "config.ts", source: `AUTH_HMAC_KEY: base64Key, IP_HASH_KEY: base64Key, TOTP_ENC_KEY: versionedKey, DATABASE_URL_AUTH: url` },
      { path: "auth/repo.ts", source: `import { users, sessions, type Db } from "@korbat/db";\nconst k = config.TOTP_ENC_KEY;` },
      { path: "social/repo.ts", source: `import { posts, profiles, type Db } from "@korbat/db";\nimport { SocialError } from "./context";` },
      { path: "social/routes.ts", source: `import type { Auth } from "../auth";` },
    ];
    expect(findViolations(files, new Set(["profiles", "posts"]), new Set(["users", "sessions"]))).toEqual([]);
  });

  test("catches a deep import into the auth module", () => {
    const files: SourceFile[] = [
      { path: "routes/posts.ts", source: `import { hashPassword } from "../auth/passwords";` },
      { path: "app.ts", source: `export { createSessions } from "./auth/sessions.ts";\nconst m = await import("./auth/repo");` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "routes/posts.ts: imports ../auth/passwords, which is inside the auth module (use ./auth)",
      "app.ts: imports ./auth/sessions.ts, which is inside the auth module (use ./auth)",
      "app.ts: imports ./auth/repo, which is inside the auth module (use ./auth)",
    ]);
  });

  test("catches a deep import into the social module, from outside it and from the auth module", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { createSocialRepo } from "./social/repo";` },
      { path: "auth/flows/signup.ts", source: `import { createPost } from "../../social/flows/posts";` },
      { path: "social/flows/graph.ts", source: `import { ownProfile } from "./posts";` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "app.ts: imports ./social/repo, which is inside the social module (use ./social)",
      "auth/flows/signup.ts: imports ../../social/flows/posts, which is inside the social module (use ./social)",
    ]);
  });

  test("catches a deep import into the media module, post_media outside it, and the auth schema inside it", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { createMediaRepo } from "./media/repo";\nimport { createMedia } from "./media";` },
      { path: "social/repo.ts", source: `import { postMedia, posts } from "@korbat/db";` },
      { path: "social/views.ts", source: "const rows = await db.execute(sql`select * from post_media`);" },
      { path: "media/repo.ts", source: `import { postMedia, posts, users, type Db } from "@korbat/db";` },
      { path: "media/flows/serve.ts", source: `import type { MediaDeps } from "../context";` },
    ];
    expect(findViolations(files, new Set(["posts", "postMedia"]), new Set(["users"]))).toEqual([
      "app.ts: imports ./media/repo, which is inside the media module (use ./media)",
      "social/repo.ts: references post_media, which only the media module may touch",
      "social/views.ts: references post_media, which only the media module may touch",
      "media/repo.ts: imports auth-schema users from @korbat/db",
    ]);
  });

  test("catches auth pool and auth key references outside their owners", () => {
    const files: SourceFile[] = [
      { path: "routes/posts.ts", source: `const url = config.DATABASE_URL_AUTH;` },
      { path: "profiles/store.ts", source: `export function f(authDb: Db) {}` },
      { path: "lib/hash.ts", source: `const key = config.IP_HASH_KEY;` },
      { path: "index.ts", source: `const k = config.AUTH_HMAC_KEY;` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "routes/posts.ts: references the auth database pool",
      "profiles/store.ts: references the auth database pool",
      "lib/hash.ts: references an auth key",
      "index.ts: references an auth key",
    ]);
  });

  test("catches public-schema imports inside the auth module", () => {
    const files: SourceFile[] = [
      { path: "auth/repo.ts", source: `import { users, profiles as p, type Db } from "@korbat/db";` },
      { path: "auth/flows/x.ts", source: `import type { posts } from "@korbat/db";` },
      { path: "auth/flows/y.ts", source: `import * as db from "@korbat/db";` },
    ];
    expect(findViolations(files, new Set(["profiles", "posts"]), new Set())).toEqual([
      "auth/repo.ts: imports public-schema profiles from @korbat/db",
      "auth/flows/x.ts: imports public-schema posts from @korbat/db",
      "auth/flows/y.ts: namespace import of @korbat/db (import auth-schema names explicitly)",
    ]);
  });

  test("catches auth-schema imports inside the social module", () => {
    const files: SourceFile[] = [
      { path: "social/repo.ts", source: `import { posts, users as u, type Db } from "@korbat/db";` },
      { path: "social/flows/x.ts", source: `import type { sessions } from "@korbat/db";` },
      { path: "social/flows/y.ts", source: `import * as db from "@korbat/db";` },
    ];
    expect(findViolations(files, new Set(["posts"]), new Set(["users", "sessions"]))).toEqual([
      "social/repo.ts: imports auth-schema users from @korbat/db",
      "social/flows/x.ts: imports auth-schema sessions from @korbat/db",
      "social/flows/y.ts: namespace import of @korbat/db (import public-schema names explicitly)",
    ]);
  });
});
```

## Step 2: run the tests and watch them fail

```bash
pnpm --filter @korbat/api test
```

Expected: the command exits with an error, and the output contains:

- `expected 'no-store' to be 'public, max-age=300'`
- `Tests  4 failed`

Observed on the dry run:

```text
Tests  4 failed | 138 passed | 119 skipped (261)
AssertionError: expected 'no-store' to be 'public, max-age=300' // Object.is equality
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/images-2b/write_blocks.py docs/superpowers/prompts/images-2b/10-media-serving.md 3
```

Expected: 9 lines starting with `wrote`, one for each file below.

### Create `apps/api/src/media/flows/serve.ts`

```ts
import type { MediaSize } from "@korbat/contracts";
import type { MediaDeps } from "../context";
import type { StoredFile } from "../files";

/** Images of visible posts are cacheable by anyone for five minutes. Everything else depends on who asks and is never cached. */
export const PUBLIC_CACHE = "public, max-age=300";
export const PRIVATE_CACHE = "private, no-store";

export type Served =
  | { kind: "file"; file: StoredFile; cacheControl: string; etag: string }
  | { kind: "not_modified"; cacheControl: string; etag: string }
  | { kind: "not_found" };

export interface ServeRequest {
  id: string;
  size: MediaSize;
  ifNoneMatch: string | undefined;
  /** Resolves the session. Only called when the answer depends on who asks, so public images cost one query. */
  viewer: () => Promise<string | null>;
}

/**
 * Decides whether an image file may be sent. An image follows its post: visible posts are public,
 * as 2a made them, so blocks are not checked here; withheld and removed posts show their images to
 * their author only; an image without a post, or not ready, does not exist for anyone.
 */
export async function serve(deps: MediaDeps, request: ServeRequest): Promise<Served> {
  const access = await deps.repo.fileAccess(request.id);
  if (!access || access.status !== "ready" || !access.postState) return { kind: "not_found" };

  let cacheControl = PUBLIC_CACHE;
  if (access.postState !== "visible") {
    const moderated = access.postState === "withheld" || access.postState === "removed";
    if (!moderated || (await request.viewer()) !== access.authorId) return { kind: "not_found" };
    cacheControl = PRIVATE_CACHE;
  }

  // The files of an id never change, so the id and the size identify the bytes.
  const etag = `"${request.id}-${request.size}"`;
  if (request.ifNoneMatch?.split(",").some((candidate) => candidate.trim() === etag)) return { kind: "not_modified", cacheControl, etag };

  const file = await deps.files.openImage(request.id, request.size);
  if (!file) {
    deps.log.error({ id: request.id, size: request.size }, "media: a ready image has no usable file in the store");
    return { kind: "not_found" };
  }
  return { kind: "file", file, cacheControl, etag };
}
```

### Replace `packages/contracts/src/media.ts` (whole file)

```ts
import { z } from "zod";

/** Every code the media endpoints add to ErrorEnvelope.error.code (plus the shared ones: invalid_request, not_found, rate_limited). */
export const MediaErrorCode = z.enum(["unsupported_media_type", "file_too_large", "too_many_pending_uploads", "uploads_unavailable", "media_unavailable"]);
export type MediaErrorCode = z.infer<typeof MediaErrorCode>;

/** Why processing an upload failed. Reported on the status response, not as an HTTP error. */
export const MediaFailure = z.enum(["unsupported_format", "animated_not_supported", "image_too_large", "corrupt_image", "processing_failed"]);
export type MediaFailure = z.infer<typeof MediaFailure>;

/** 20 MiB. The API counts bytes while it streams an upload to disk and stops here. */
export const MEDIA_MAX_BYTES = 20 * 1024 * 1024;
export const MEDIA_MAX_PER_POST = 4;
/** The types an upload may declare. The bytes decide; the declaration is checked and then forgotten. */
export const MEDIA_ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"] as const;
export type MediaAcceptedType = (typeof MEDIA_ACCEPTED_TYPES)[number];
export const ALT_MAX_LENGTH = 1000;

/** A media id in its canonical lowercase form, which is also how it names files on the media volumes. */
export const MediaId = z.uuid().transform((id) => id.toLowerCase());

export const MEDIA_SIZES = ["small", "large"] as const;
export type MediaSize = (typeof MEDIA_SIZES)[number];

/** Where an image file is served. Views carry these paths, so the server can move images without a client change. */
export function mediaPath(id: string, size: MediaSize): string {
  return `/api/media/${id}/${size}.webp`;
}

/** Length in code points, which is what Postgres char_length counts. */
export function altLength(alt: string): number {
  return Array.from(alt).length;
}

/** Unicode NFC, every run of whitespace (line breaks included) to one space, trimmed. The server and the composer use the same rule. */
export function normalizeAltText(raw: string): string {
  return raw.normalize("NFC").replace(/\s+/gu, " ").trim();
}

const CONTROL = /\p{Cc}/u;

/** An image description as stored: normalized, 1 to 1000 code points, no control characters. */
export const AltText = z
  .string()
  .max(4000)
  .transform(normalizeAltText)
  .refine((alt) => !CONTROL.test(alt), { message: "control characters are not allowed" })
  .refine((alt) => altLength(alt) >= 1, { message: "every image needs a description" })
  .refine((alt) => altLength(alt) <= ALT_MAX_LENGTH, { message: `descriptions have at most ${ALT_MAX_LENGTH} characters` });

/** One image of a new post: an upload that is ready, and its description. */
export const MediaAttachment = z.object({ id: MediaId, alt: AltText });
export type MediaAttachment = z.infer<typeof MediaAttachment>;

export const UploadResponse = z.object({ id: MediaId, status: z.literal("processing") });
export type UploadResponse = z.infer<typeof UploadResponse>;

/** The state of one upload, for its owner. Width and height are those of the large size, after rotation. */
export const MediaStatusResponse = z.discriminatedUnion("status", [
  z.object({ id: MediaId, status: z.literal("processing") }),
  z.object({ id: MediaId, status: z.literal("ready"), width: z.number().int().positive(), height: z.number().int().positive(), blurhash: z.string().min(6) }),
  z.object({ id: MediaId, status: z.literal("failed"), error: MediaFailure }),
]);
export type MediaStatusResponse = z.infer<typeof MediaStatusResponse>;

/** An image on a post, as every reader gets it. */
export const MediaView = z.object({
  id: MediaId,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  blurhash: z.string().min(6),
  alt: z.string(),
  small: z.string(),
  large: z.string(),
});
export type MediaView = z.infer<typeof MediaView>;
```

### Replace `apps/api/src/media/repo.ts` (whole file)

```ts
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { postMedia, posts, profiles, type Db } from "@korbat/db";
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

    /** Removes a row whatever its state. Used when an upload could not be handed to the worker. */
    async deleteRow(id: string): Promise<void> {
      await db.delete(postMedia).where(eq(postMedia.id, id));
    },
  };
}

export type MediaRepo = ReturnType<typeof createMediaRepo>;
```

### Replace `apps/api/src/media/routes.ts` (whole file)

```ts
import { Readable } from "node:stream";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { MediaId, type MediaSize } from "@korbat/contracts";
import { isMediaId } from "@korbat/media-protocol";
import type { AppEnv } from "../env";
import { errorBody } from "../lib/errors";
import { validate } from "../lib/validate";
import { clientIp, rateLimit, type RateLimitStore } from "../middleware/rate-limit";
import type { MediaDeps } from "./context";
import { remove } from "./flows/remove";
import { serve } from "./flows/serve";
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

const IMAGE_FILE = /^(small|large)\.webp$/;

/**
 * The image files: GET /api/media/<id>/small.webp and /large.webp. The app mounts these before its
 * global rate limit and before session resolution. A timeline page can hold 80 images, so they have
 * their own bucket of 1200 requests a minute per IP, and the session is only resolved when the
 * answer depends on who asks. The names end in .webp because that is what a CDN caches by default.
 */
export function mediaFileRoutes(deps: MediaDeps, options: { resolveSession: MiddlewareHandler<AppEnv>; rateLimitStore: RateLimitStore }) {
  const r = new Hono<AppEnv>();
  const limit = rateLimit({ name: "media", store: options.rateLimitStore, limit: 1200, windowMs: 60_000, key: clientIp });

  r.get("/:id/:file", limit, async (c) => {
    const notFound = () => c.json(errorBody("not_found", "Not found.", c.get("requestId")), 404);
    // Only the canonical lowercase id names an image, so every image has exactly one URL and one cache key.
    const id = c.req.param("id");
    const size = IMAGE_FILE.exec(c.req.param("file"))?.[1] as MediaSize | undefined;
    if (!isMediaId(id) || !size) return notFound();

    const served = await serve(deps, {
      id,
      size,
      ifNoneMatch: c.req.header("if-none-match"),
      viewer: async () => {
        await options.resolveSession(c, async () => undefined);
        return c.get("session")?.userId ?? null;
      },
    });
    if (served.kind === "not_found") return notFound();

    c.header("Cache-Control", served.cacheControl);
    c.header("ETag", served.etag);
    if (served.kind === "not_modified") return c.body(null, 304);
    // Always WebP, whatever the bytes are: the store is not trusted, and nosniff plus the API's CSP keep them inert.
    c.header("Content-Type", "image/webp");
    c.header("Content-Length", String(served.file.size));
    return c.body(Readable.toWeb(served.file.handle.createReadStream()) as ReadableStream<Uint8Array>);
  });

  return r;
}
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
import type { MediaDeps } from "./context";
import { createMediaFiles } from "./files";
import { createMediaRepo } from "./repo";
import { mediaFileRoutes, mediaRoutes } from "./routes";

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
  return {
    deps,
    /** Creates the uploads volume's directories. Call once before serving. */
    prepare: () => deps.files.prepare(),
    routes: mediaRoutes(deps, options.requireSession),
    /** Mounted before the global rate limit and session resolution. */
    fileRoutes: mediaFileRoutes(deps, { resolveSession: options.resolveSession, rateLimitStore: options.rateLimitStore }),
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

### Replace `apps/api/src/middleware/security-headers.ts` (whole file)

```ts
import { createMiddleware } from "hono/factory";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv } from "../env";

/** The API only ever returns JSON, so the CSP forbids everything. HTML headers for the web app live in the Caddyfile. */
export const securityHeaders = secureHeaders({
  contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"] },
  strictTransportSecurity: "max-age=31536000; includeSubDomains",
  referrerPolicy: "no-referrer",
  crossOriginResourcePolicy: "same-origin",
  crossOriginOpenerPolicy: "same-origin",
  xFrameOptions: "DENY",
  xContentTypeOptions: "nosniff",
  permissionsPolicy: { camera: [], microphone: [], geolocation: [] },
});

/** Nothing the API returns may be cached, unless a handler said otherwise itself: image files of visible posts do. */
export const noStore = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  if (!c.res.headers.has("Cache-Control")) c.res.headers.set("Cache-Control", "no-store");
});
```

### Replace `apps/api/src/routes/health.ts` (whole file)

```ts
import { Hono } from "hono";
import type { HealthResponse } from "@korbat/contracts";
import type { AppEnv } from "../env";

export type HealthChecks = Record<string, () => Promise<void>>;

/**
 * `checks` are what the API cannot work without: one failing answers 503. `advisory` checks report a
 * part that is down while the API still serves, the image worker for one: a failure there is
 * `degraded` with status 200, so container health and Caddy's start do not hang on it.
 */
export function healthRoutes(checks: HealthChecks, version: string, advisory: HealthChecks = {}) {
  const r = new Hono<AppEnv>();
  r.get("/", async (c) => {
    const entries = await Promise.all(
      Object.entries({ ...checks, ...advisory }).map(async ([name, fn]) => {
        try {
          await fn();
          return [name, "ok"] as const;
        } catch (err) {
          c.get("log").warn({ err, check: name }, "health check failed");
          return [name, "fail"] as const;
        }
      }),
    );
    const ok = entries.every(([, s]) => s === "ok");
    const critical = entries.every(([name, s]) => s === "ok" || name in advisory);
    const body: HealthResponse = { status: ok ? "ok" : "degraded", version, checks: Object.fromEntries(entries) };
    return c.json(body, critical ? 200 : 503);
  });
  return r;
}
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
  /** Checks that report a part being down without marking the API unhealthy, the image worker for one. */
  advisoryChecks?: HealthChecks;
}

export function createApp({ config, logger, rateLimitStore, healthChecks, auth, social, media, advisoryChecks }: AppDeps) {
  const app = new Hono<AppEnv>();

  app.use(observability(logger));
  app.use(securityHeaders, noStore);
  app.use(cors({ origin: config.TRUSTED_ORIGINS, credentials: true }));
  // Image files come before the global limit and session resolution: they have their own bucket,
  // and a public image needs no session. Everything else under /api/media falls through to below.
  if (media) app.route("/api/media", media.fileRoutes);
  app.use(rateLimit({ name: "global", store: rateLimitStore, limit: 300, windowMs: 60_000, key: clientIp }));
  app.use(auth.resolveSession);

  app.route("/api/health", healthRoutes(healthChecks, config.KORBAT_VERSION, advisoryChecks));
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
  resolveSession: auth.resolveSession,
  rateLimitStore,
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
  server.close();
  await Promise.allSettled([closeDb(apiDb), closeDb(authDb), redis.quit()]);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
```

## Step 4: verify: contracts

```bash
pnpm --filter @korbat/contracts test
```

Expected output contains:

- `Tests  41 passed (41)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  41 passed (41)
```

## Step 5: verify: test

```bash
pnpm --filter @korbat/api test
```

Expected output contains:

- `Tests  142 passed | 119 skipped (261)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  142 passed | 119 skipped (261)
```

## Step 6: verify: typecheck

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

## Step 7: verify: deliberate-violation

```bash
printf 'import { createMediaRepo } from "./media/repo";
export const repo = createMediaRepo;
' > apps/api/src/zz-violation.ts; pnpm --filter @korbat/api exec vitest run test/architecture.test.ts; rm -f apps/api/src/zz-violation.ts; echo "violation file present: $(ls apps/api/src/zz-violation.ts 2>/dev/null | wc -l)"
```

Expected output contains:

- `zz-violation.ts: imports ./media/repo, which is inside the media module (use ./media)`
- `violation file present: 0`

Observed on the dry run:

```text
violation file present: 0
+   "zz-violation.ts: imports ./media/repo, which is inside the media module (use ./media)",
```

## Step 8: verify: integration

```bash
pnpm --filter @korbat/api test:integration
```

Expected output contains:

- `Tests  118 passed (118)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  118 passed (118)
```

## Step 9: verify: build

```bash
pnpm --filter @korbat/api build
```

Expected output contains:

- `Build success`

Must not contain:

- `error`

Observed on the dry run:

```text
ESM ⚡️ Build success in 380ms
```

## Step 10: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/app.ts`
- `apps/api/src/index.ts`
- `apps/api/src/media/flows/serve.ts`
- `apps/api/src/media/index.ts`
- `apps/api/src/media/repo.ts`
- `apps/api/src/media/routes.ts`
- `apps/api/src/middleware/security-headers.ts`
- `apps/api/src/routes/health.ts`
- `apps/api/test/app.test.ts`
- `apps/api/test/architecture.test.ts`
- `apps/api/test/integration/media-harness.ts`
- `apps/api/test/integration/media-serve.test.ts`
- `packages/contracts/src/media.ts`
- `packages/contracts/test/media.test.ts`

## Step 11: commit

```bash
git add -A
git commit -q -m "feat(media): image files served after a visibility check, mounted before the global limit and session resolution; canonical media ids; advisory health checks; boundary test covers the media module" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(media): image files served after a visibility check, mounted before the global limit and session resolution; canonical media ids; advisory health checks; boundary test covers the media module`.

## Report format (mandatory)

```text
TASK 10 REPORT
Files written: <count, expected 14>
Failing-test step (the error line): <paste>
Verify "contracts": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "typecheck": <paste the expected lines as printed>
Verify "deliberate-violation": <paste the expected lines as printed>
Verify "integration": <paste the expected lines as printed>
Verify "build": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
