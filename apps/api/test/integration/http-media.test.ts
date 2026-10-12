import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ErrorEnvelope, FlowResponse, HealthResponse, MEDIA_MAX_BYTES, MediaStatusResponse, PostView, TimelinePage, UploadResponse } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
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
import { closeDecisions, decideForTest, leavesNoModerationRows } from "./moderation-decide";

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
    const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth(), media: media.forPosts, now });
    app = createApp({ config, logger, rateLimitStore, healthChecks: {}, advisoryChecks: { image_worker: media.healthCheck }, auth, social, media });
  });
  afterAll(async () => {
    rmSync(root, { recursive: true, force: true });
    await closeDecisions();
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
    await decideForTest(apiDb, post.id, "withheld");

    const own = await ada.b.fetch(`/api/media/${id}/small.webp`);
    expect([own.status, own.headers.get("cache-control")]).toEqual([200, "private, no-store"]);
    expect((await bob.b.fetch(`/api/media/${id}/small.webp`)).status).toBe(404);
    expect((await app.request(`/api/media/${id}/small.webp`)).status).toBe(404);

    await decideForTest(apiDb, post.id, "visible");
    expect((await ada.b.fetch(`/api/posts/${post.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await ada.b.fetch(`/api/media/${id}/small.webp`)).status).toBe(404);
    expect(existsSync(uploads.deletion(id))).toBe(true);
    // The states come from real, confirmed decisions: a staff key's enrolment, a sign-in, and a step-up for each.
  }, 30_000);

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

  leavesNoModerationRows(() => apiDb);
});
