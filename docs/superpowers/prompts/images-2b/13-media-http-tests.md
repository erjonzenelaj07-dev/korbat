# korbat 2b — Task 13 of 17: Images over HTTP: two signed-up accounts upload, post, read, delete and hit every refusal through the real app

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-18 and 2026-09-19 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

End-to-end tests over HTTP with two accounts made by the 1a sign-up flow: upload, status, posting with images, public and author-only files, CSRF on uploads, every refusal, the new-account upload tier, and the worker's health.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(media): sweeper finalizes unpolled results, fails stuck uploads after five minutes, expires unattached ones after a day, withdraws finished deletion requests and reconciles orphans under a Redis lock`.
3. The previous task's last API unit run ended with `Tests  131 passed (131)`.

## Rules (read twice)

1. Never type a file's content. Every step that writes files starts with a `write_blocks.py` command that copies that step's blocks from this prompt file to disk byte for byte; run it exactly as given and check that it names every file of the step. The blocks are shown below it so you can read what was written. Paths with parentheses or square brackets (expo-router routes) are literal; quote them in shell commands.
2. Run every command exactly as written, in order, from the repo root, without adding filters such as `tail` or `head`.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the files

```bash
python docs/superpowers/prompts/images-2b/write_blocks.py docs/superpowers/prompts/images-2b/13-media-http-tests.md 1
```

Expected: 3 lines starting with `wrote`, one for each file below.

### Create `apps/api/test/integration/http-media.test.ts`

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ErrorEnvelope, FlowResponse, HealthResponse, MEDIA_MAX_BYTES, MediaStatusResponse, PostView, TimelinePage, UploadResponse } from "@korbat/contracts";
import { closeDb, createDb, posts, type Db } from "@korbat/db";
import { uploadsLayout } from "@korbat/media-protocol";
import { createApp } from "../../src/app";
import { createAuth } from "../../src/auth";
import { randomToken } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { createMedia } from "../../src/media";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { createSocial, enforceWriteLimit } from "../../src/social";
import { DAY_MS } from "../../src/social/tiers";
import { Browser } from "./http-client";
import { BYTES, fakeWorker } from "./media-harness";

type App = ReturnType<typeof createApp>;

/**
 * Images through the real app: 1a sign-up for the accounts, cookie sessions with CSRF, the media and
 * social modules wired as the server wires them, and a stand-in for the worker on the store directory.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: images over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let app: App;
  const root = mkdtempSync(path.join(tmpdir(), "korbat-http-media-"));
  const uploads = uploadsLayout(path.join(root, "uploads"));
  const worker = fakeWorker(path.join(root, "store"));
  const mailer = new MemoryMailer();
  let offsetMs = 0;
  let tick = 0;
  const now = () => new Date(Date.now() + offsetMs + ++tick);

  beforeAll(async () => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    const rateLimitStore = new MemoryStore(() => now().getTime());
    const auth = createAuth({
      config,
      logger,
      authDb,
      kv: new MemoryKv(),
      mailer,
      profiles: createProfileStore(apiDb),
      turnstile: { verify: async () => true },
      breachChecker: { isBreached: async () => false },
    });
    const media = createMedia({
      apiDb,
      uploadsDir: uploads.root,
      storeDir: path.join(root, "store"),
      formats: config.MEDIA_FORMATS,
      minFreeBytes: 0,
      logger,
      requireSession: auth.requireSession,
      resolveSession: auth.resolveSession,
      rateLimitStore,
      enforceUploadLimit: (userId, accountCreatedAt, at) => enforceWriteLimit(rateLimitStore, userId, "upload", accountCreatedAt, at),
      now,
    });
    await media.prepare();
    const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, media: media.forPosts, now });
    app = createApp({ config, logger, rateLimitStore, healthChecks: {}, advisoryChecks: { image_worker: media.healthCheck }, auth, social, media });
  });
  afterAll(async () => {
    rmSync(root, { recursive: true, force: true });
    await Promise.all([closeDb(authDb), closeDb(apiDb)]);
  });

  async function signUp() {
    const b = new Browser(app, config.APP_ORIGIN);
    const email = `media-${randomUUID()}@korbat.local`;
    const handle = `m${randomBytes(4).toString("hex")}`;
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    const { flowId } = FlowResponse.parse(await start.json());
    expect((await b.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } })).status).toBe(200);
    expect((await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).status).toBe(200);
    expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: `User ${handle}` } })).status).toBe(200);
    return { b, handle };
  }

  const errorCode = async (res: Response) => ErrorEnvelope.parse(await res.json()).error.code;
  const jpeg = { type: "image/jpeg", body: BYTES.jpeg };

  /** Uploads an image and lets the stand-in worker accept it. */
  async function readyImage(b: Browser): Promise<string> {
    const res = await b.fetch("/api/media", { raw: jpeg });
    expect(res.status).toBe(202);
    const { id } = UploadResponse.parse(await res.json());
    worker.ready(id, { width: 1200, height: 800 });
    expect(MediaStatusResponse.parse(await (await b.fetch(`/api/media/${id}`)).json()).status).toBe("ready");
    return id;
  }

  test("upload, wait, post, and read the image back, signed in and signed out", async () => {
    offsetMs = 3 * DAY_MS;
    const ada = await signUp();
    const sent = await ada.b.fetch("/api/media", { raw: jpeg });
    expect(sent.status).toBe(202);
    const { id } = UploadResponse.parse(await sent.json());
    expect(MediaStatusResponse.parse(await (await ada.b.fetch(`/api/media/${id}`)).json())).toEqual({ id, status: "processing" });
    expect((await app.request(`/api/media/${id}/large.webp`)).status).toBe(404);

    worker.ready(id, { width: 1200, height: 800 });
    expect(MediaStatusResponse.parse(await (await ada.b.fetch(`/api/media/${id.toUpperCase()}`)).json())).toMatchObject({ id, status: "ready", width: 1200, height: 800 });
    expect(existsSync(uploads.upload(id))).toBe(false);

    const created = await ada.b.fetch("/api/posts", { json: { body: "a photo", media: [{ id, alt: "  a harbour\n at dawn " }] } });
    expect(created.status).toBe(201);
    const post = PostView.parse(await created.json());
    expect(post.media).toEqual([{ id, width: 1200, height: 800, blurhash: "L2Eo_P_3jb_3~qoL", alt: "a harbour at dawn", small: `/api/media/${id}/small.webp`, large: `/api/media/${id}/large.webp` }]);

    const image = await app.request(post.media[0]!.large);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/webp");
    expect(image.headers.get("cache-control")).toBe("public, max-age=300");
    expect(image.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await image.text()).toBe(`large-webp-of-${id}`);
    const again = await app.request(post.media[0]!.large, { headers: { "if-none-match": image.headers.get("etag")! } });
    expect(again.status).toBe(304);

    const latest = TimelinePage.parse(await (await app.request("/api/timeline/latest?limit=50")).json());
    expect(latest.items.find((item) => item.post.id === post.id)?.post.media[0]?.alt).toBe("a harbour at dawn");
  });

  test("uploads need a session, the CSRF token and the app's origin", async () => {
    const ada = await signUp();
    expect((await app.request("/api/media", { method: "POST", headers: { "content-type": "image/jpeg" }, body: BYTES.jpeg })).status).toBe(401);
    const noToken = await ada.b.fetch("/api/media", { raw: jpeg, csrf: false });
    expect([noToken.status, await errorCode(noToken)]).toEqual([403, "csrf_failed"]);
    const evil = new Browser(app, "https://evil.example");
    const crossOrigin = await evil.fetch("/api/media", { raw: jpeg });
    expect([crossOrigin.status, await errorCode(crossOrigin)]).toEqual([403, "csrf_failed"]);
  });

  test("refusals come back in the error envelope with the right status", async () => {
    const [ada, bob] = [await signUp(), await signUp()];
    const svg = await ada.b.fetch("/api/media", { raw: { type: "image/svg+xml", body: Buffer.from("<svg/>") } });
    expect([svg.status, await errorCode(svg)]).toEqual([415, "unsupported_media_type"]);
    const disguised = await ada.b.fetch("/api/media", { raw: { type: "image/png", body: BYTES.pdf } });
    expect([disguised.status, await errorCode(disguised)]).toEqual([415, "unsupported_media_type"]);
    const heic = await ada.b.fetch("/api/media", { raw: { type: "image/jpeg", body: BYTES.heic } });
    expect(ErrorEnvelope.parse(await heic.json()).error.message).toMatch(/Export the photo as JPEG/);
    const declaredTooLarge = await ada.b.fetch("/api/media", { raw: jpeg, headers: { "content-length": String(MEDIA_MAX_BYTES + 1) } });
    expect([declaredTooLarge.status, await errorCode(declaredTooLarge)]).toEqual([413, "file_too_large"]);

    const id = await readyImage(ada.b);
    expect((await bob.b.fetch(`/api/media/${id}`)).status).toBe(404);
    expect((await bob.b.fetch(`/api/media/${id}`, { method: "DELETE" })).status).toBe(404);
    expect((await ada.b.fetch(`/api/media/${id}`, { method: "DELETE" })).status).toBe(204);
    expect((await ada.b.fetch(`/api/media/${id}`)).status).toBe(404);
    expect(existsSync(uploads.deletion(id))).toBe(true);
    expect((await ada.b.fetch("/api/media/not-an-id")).status).toBe(400);
  });

  test("a post takes only the author's own ready images, at most four, each described", async () => {
    const [ada, bob] = [await signUp(), await signUp()];
    const bobs = await readyImage(bob.b);
    const stolen = await ada.b.fetch("/api/posts", { json: { body: "not mine", media: [{ id: bobs, alt: "x" }] } });
    expect([stolen.status, await errorCode(stolen)]).toEqual([400, "media_unavailable"]);

    const ids = [];
    for (let i = 0; i < 5; i++) ids.push(await readyImage(ada.b));
    const five = await ada.b.fetch("/api/posts", { json: { body: "too many", media: ids.map((id) => ({ id, alt: "x" })) } });
    expect([five.status, await errorCode(five)]).toEqual([400, "invalid_request"]);
    const undescribed = await ada.b.fetch("/api/posts", { json: { body: "no alt", media: [{ id: ids[0], alt: "   " }] } });
    expect([undescribed.status, await errorCode(undescribed)]).toEqual([400, "invalid_request"]);
    const empty = await ada.b.fetch("/api/posts", { json: { body: "  ", media: [] } });
    expect([empty.status, await errorCode(empty)]).toEqual([400, "invalid_request"]);

    const four = await ada.b.fetch("/api/posts", { json: { media: ids.slice(0, 4).map((id, i) => ({ id, alt: `image ${i + 1}` })) } });
    expect(four.status).toBe(201);
    expect(PostView.parse(await four.json())).toMatchObject({ body: "", media: [{ alt: "image 1" }, { alt: "image 2" }, { alt: "image 3" }, { alt: "image 4" }] });
  });

  test("images of a withheld post reach their author only, and deleting a post takes its images with it", async () => {
    const [ada, bob] = [await signUp(), await signUp()];
    const id = await readyImage(ada.b);
    const post = PostView.parse(await (await ada.b.fetch("/api/posts", { json: { body: "under review", media: [{ id, alt: "an image" }] } })).json());
    await apiDb.update(posts).set({ state: "withheld" }).where(eq(posts.id, post.id));

    const own = await ada.b.fetch(`/api/media/${id}/small.webp`);
    expect([own.status, own.headers.get("cache-control")]).toEqual([200, "private, no-store"]);
    expect((await bob.b.fetch(`/api/media/${id}/small.webp`)).status).toBe(404);
    expect((await app.request(`/api/media/${id}/small.webp`)).status).toBe(404);

    await apiDb.update(posts).set({ state: "visible" }).where(eq(posts.id, post.id));
    expect((await ada.b.fetch(`/api/posts/${post.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await ada.b.fetch(`/api/media/${id}/small.webp`)).status).toBe(404);
    expect(existsSync(uploads.deletion(id))).toBe(true);
  });

  test("an account in its first day may upload 20 images an hour", async () => {
    offsetMs = 0;
    const newcomer = await signUp();
    for (let i = 0; i < 20; i++) expect((await newcomer.b.fetch("/api/media", { raw: jpeg })).status).toBe(202);
    const refused = await newcomer.b.fetch("/api/media", { raw: jpeg });
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await errorCode(refused)).toBe("rate_limited");
    offsetMs = 3 * DAY_MS;
  });

  test("health names the image worker without turning the API unhealthy", async () => {
    worker.beat(now().getTime() - 5 * 60_000);
    const stale = await app.request("/api/health");
    expect(stale.status).toBe(200);
    expect(HealthResponse.parse(await stale.json())).toMatchObject({ status: "degraded", checks: { image_worker: "fail" } });
    worker.beat(now().getTime());
    expect(HealthResponse.parse(await (await app.request("/api/health")).json())).toMatchObject({ status: "ok", checks: { image_worker: "ok" } });
  });
});
```

### Replace `apps/api/test/integration/http-client.ts` (whole file)

```ts
import { randomInt } from "node:crypto";

/** Anything with Hono's `app.request`. */
export interface RequestApp {
  request(path: string, init?: RequestInit): Response | Promise<Response>;
}

interface FetchInit {
  method?: string;
  json?: unknown;
  /** A raw body with its declared type, which is how an image is uploaded. */
  raw?: { type: string; body: Uint8Array };
  /** Extra request headers. */
  headers?: Record<string, string>;
  /** Web only: send the X-CSRF-Token header (default true). */
  csrf?: boolean;
}

/**
 * A distinct client address per test client, sent as cf-connecting-ip, so per-IP rate limits in one
 * test never affect another.
 */
export const randomIp = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;

/** A minimal browser: keeps cookies, sends Origin on state changes and echoes the CSRF cookie in X-CSRF-Token. */
export class Browser {
  private readonly cookies = new Map<string, string>();

  constructor(
    private readonly app: RequestApp,
    private readonly origin: string,
    private readonly ip: string = randomIp(),
  ) {}

  async fetch(path: string, init: FetchInit = {}): Promise<Response> {
    const method = init.method ?? (init.json === undefined && init.raw === undefined ? "GET" : "POST");
    const headers: Record<string, string> = { "cf-connecting-ip": this.ip, ...init.headers };
    if (this.cookies.size > 0) headers.cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    if (method !== "GET") headers.origin = this.origin;
    const csrf = this.cookies.get("__Host-korbat_csrf");
    if (init.csrf !== false && csrf) headers["x-csrf-token"] = csrf;
    if (init.json !== undefined) headers["content-type"] = "application/json";
    if (init.raw) headers["content-type"] = init.raw.type;
    const body = init.raw ? init.raw.body : init.json === undefined ? undefined : JSON.stringify(init.json);
    const res = await this.app.request(path, { method, headers, body });
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split("; ");
      const separator = pair!.indexOf("=");
      const name = pair!.slice(0, separator);
      if (attributes.includes("Max-Age=0")) this.cookies.delete(name);
      else this.cookies.set(name, pair!.slice(separator + 1));
    }
    return res;
  }

  cookie(name: string): string | undefined {
    return this.cookies.get(name);
  }
}

/** A native app: no cookies and no Origin header; sends the bearer token once it has one. */
export class NativeClient {
  token: string | undefined;

  constructor(
    private readonly app: RequestApp,
    private readonly ip: string = randomIp(),
  ) {}

  fetch(path: string, init: Omit<FetchInit, "csrf"> = {}): Response | Promise<Response> {
    const method = init.method ?? (init.json === undefined ? "GET" : "POST");
    const headers: Record<string, string> = { "cf-connecting-ip": this.ip };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (init.json !== undefined) headers["content-type"] = "application/json";
    return this.app.request(path, { method, headers, body: init.json === undefined ? undefined : JSON.stringify(init.json) });
  }
}
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
import { MEDIA_FORMATS, storeLayout, type MediaFormat, type StoreLayout } from "@korbat/media-protocol";
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

/** Stands in for the worker: writes files and results into a store directory exactly as the protocol says, without decoding anything. */
export function fakeWorker(store: StoreLayout | string) {
  const layout = typeof store === "string" ? storeLayout(store) : store;
  for (const dir of [layout.files, layout.results, layout.attempts, layout.tmp]) mkdirSync(dir, { recursive: true });
  return {
    /** What the worker leaves behind for an image it accepted. */
    ready(id: string, size: { width: number; height: number } = { width: 2048, height: 1536 }) {
      mkdirSync(layout.imageDir(id), { recursive: true });
      writeFileSync(layout.image(id, "large"), `large-webp-of-${id}`);
      writeFileSync(layout.image(id, "small"), `small-webp-of-${id}`);
      writeFileSync(layout.result(id), JSON.stringify({ v: 1, id, status: "ready", ...size, blurhash: "L2Eo_P_3jb_3~qoL" }));
    },
    /** What it leaves behind for one it refused. */
    failed(id: string, reason: MediaFailure) {
      writeFileSync(layout.result(id), JSON.stringify({ v: 1, id, status: "failed", reason }));
    },
    /** A heartbeat written at the given time. */
    beat(at: number) {
      writeFileSync(layout.heartbeat, JSON.stringify({ v: 1, at }));
    },
  };
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

  const worker = fakeWorker(files.store);

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

## Step 2: verify: test

```bash
pnpm --filter @korbat/api test
```

Expected output contains:

- `Tests  142 passed | 139 skipped (281)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  142 passed | 139 skipped (281)
```

## Step 3: verify: typecheck

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

## Step 4: verify: integration

```bash
pnpm --filter @korbat/api test:integration
```

Expected output contains:

- `Tests  138 passed (138)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  138 passed (138)
```

## Step 5: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/test/integration/http-client.ts`
- `apps/api/test/integration/http-media.test.ts`
- `apps/api/test/integration/media-harness.ts`

## Step 6: commit

```bash
git add -A
git commit -q -m "test(media): HTTP tests for upload, status, posting with images, public and author-only files, CSRF, refusals, the new-account tier and worker health" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `test(media): HTTP tests for upload, status, posting with images, public and author-only files, CSRF, refusals, the new-account tier and worker health`.

## Report format (mandatory)

```text
TASK 13 REPORT
Files written: <count, expected 3>
Verify "test": <paste the expected lines as printed>
Verify "typecheck": <paste the expected lines as printed>
Verify "integration": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
