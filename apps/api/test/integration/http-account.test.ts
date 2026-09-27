import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ErrorEnvelope, ExportFormat, FlowResponse, MeResponse, MediaStatusResponse, PostView, UploadResponse } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createAccount } from "../../src/account";
import { createApp } from "../../src/app";
import { createAuth, type Auth } from "../../src/auth";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { createMedia } from "../../src/media";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { createSocial, enforceWriteLimit } from "../../src/social";
import { Browser } from "./http-client";
import { BYTES, fakeWorker } from "./media-harness";

type App = ReturnType<typeof createApp>;

const newHandle = () => `a${randomBytes(4).toString("hex")}`;

/**
 * The export route through the real app: 1a sign-up for the accounts, cookie sessions with CSRF,
 * the auth module's freshness check, an image uploaded over HTTP with the stand-in for the worker
 * on the store directory, and the four modules wired as the server wires them.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the data export over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let auth: Auth;
  let app: App;
  const root = mkdtempSync(path.join(tmpdir(), "korbat-http-account-"));
  const worker = fakeWorker(path.join(root, "store"));
  const mailer = new MemoryMailer();

  beforeAll(async () => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    const rateLimitStore = new MemoryStore();
    auth = createAuth({
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
      uploadsDir: path.join(root, "uploads"),
      storeDir: path.join(root, "store"),
      formats: config.MEDIA_FORMATS,
      minFreeBytes: 0,
      logger,
      requireSession: auth.requireSession,
      resolveSession: auth.resolveSession,
      rateLimitStore,
      enforceUploadLimit: (userId, accountCreatedAt, at) => enforceWriteLimit(rateLimitStore, userId, "upload", accountCreatedAt, at),
    });
    await media.prepare();
    const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth(), media: media.forPosts, events: { append: auth.appendEvent } });
    const account = createAccount({
      auth: auth.forAccount,
      social: social.forAccount,
      media: media.forAccount,
      requireSession: auth.requireSession,
      requireFreshAuth: auth.requireFreshAuth(),
      requireStrongFreshAuth: auth.requireStrongFreshAuth(),
      rateLimitStore,
      logger,
    });
    app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, social, media, account });
  });
  afterAll(async () => {
    rmSync(root, { recursive: true, force: true });
    await Promise.all([closeDb(authDb), closeDb(apiDb)]);
  });

  /** A signed-in web account, onboarded unless told otherwise. */
  async function signUp(onboard = true) {
    const b = new Browser(app, config.APP_ORIGIN);
    const email = `export-${randomUUID()}@korbat.local`;
    const handle = newHandle();
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(start.status).toBe(200);
    const { flowId } = FlowResponse.parse(await start.json());
    expect((await b.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } })).status).toBe(200);
    expect((await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).status).toBe(200);
    if (onboard) expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: `User ${handle}` } })).status).toBe(200);
    const me = MeResponse.parse(await (await b.fetch("/api/me")).json());
    return { b, email, handle, userId: me.user.id };
  }

  const errorCode = async (res: Response) => ErrorEnvelope.parse(await res.json()).error.code;
  const exportOf = (b: Browser) => b.fetch("/api/account/export", { method: "POST" });
  const sessionIdOf = (b: Browser) => sha256Hex(b.cookie("__Host-korbat_session")!);
  /** The session's only factor is the sign-up's email code; moved ten minutes back, nothing within the window is left, so the freshness check fails. */
  async function makeStale(b: Browser) {
    await auth.deps.repo.writeFactor(sessionIdOf(b), "email", new Date(Date.now() - 10 * 60_000));
    await auth.deps.kv.del(`sess:${sessionIdOf(b)}`);
  }
  /** The opposite: the session proved a credential just now. */
  async function makeFresh(b: Browser) {
    await auth.deps.repo.writeFactor(sessionIdOf(b), "email", new Date());
    await auth.deps.kv.del(`sess:${sessionIdOf(b)}`);
  }
  const eventTypes = async (userId: string) => (await auth.deps.repo.recentEvents(userId)).map((e) => e.type);

  /** Uploads an image and lets the stand-in worker accept it. */
  async function readyImage(b: Browser): Promise<string> {
    const res = await b.fetch("/api/media", { raw: { type: "image/jpeg", body: BYTES.jpeg } });
    expect(res.status).toBe(202);
    const { id } = UploadResponse.parse(await res.json());
    worker.ready(id, { width: 1200, height: 800 });
    expect(MediaStatusResponse.parse(await (await b.fetch(`/api/media/${id}`)).json()).status).toBe("ready");
    return id;
  }

  test("the export needs an onboarded, fresh session", async () => {
    const anonymous = await app.request("/api/account/export", { method: "POST" });
    expect(anonymous.status).toBe(401);
    expect(await errorCode(anonymous)).toBe("unauthenticated");
    const notOnboarded = await signUp(false);
    const early = await exportOf(notOnboarded.b);
    expect(early.status).toBe(403);
    expect(await errorCode(early)).toBe("onboarding_required");
    const stale = await signUp();
    await makeStale(stale.b);
    const refused = await exportOf(stale.b);
    expect(refused.status).toBe(403);
    expect(await errorCode(refused)).toBe("reauth_required");
    // A refusal spends nothing: once fresh again, the day's export is still available.
    await makeFresh(stale.b);
    expect((await exportOf(stale.b)).status).toBe(200);
  });

  test("the archive streams with its headers, holds export.json and the uploaded image, records the event, and comes once a day", async () => {
    const ada = await signUp();
    const image = await readyImage(ada.b);
    const created = await ada.b.fetch("/api/posts", { json: { body: "a photo", media: [{ id: image, alt: "a harbour at dawn" }] } });
    expect(created.status).toBe(201);
    const post = PostView.parse(await created.json());

    const res = await exportOf(ada.b);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toMatch(new RegExp(`^attachment; filename="korbat-export-${ada.handle}-\\d{4}-\\d{2}-\\d{2}\\.zip"$`));
    expect(res.headers.get("cache-control")).toBe("no-store");
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(["export.json", `media/${image}.webp`].sort());
    expect(strFromU8(files[`media/${image}.webp`]!)).toBe(`large-webp-of-${image}`);
    const json = ExportFormat.parse(JSON.parse(strFromU8(files["export.json"]!)));
    expect(json.account).toMatchObject({ id: ada.userId, email: ada.email, role: "user", termsVersion: config.TERMS_VERSION });
    expect(json.profile).toMatchObject({ handle: ada.handle, displayName: `User ${ada.handle}`, handleHistory: [ada.handle] });
    expect(json.sessions).toEqual([{ id: sessionIdOf(ada.b), createdAt: expect.any(String), lastUsedAt: expect.any(String), current: true }]);
    expect(json.posts).toHaveLength(1);
    expect(json.posts[0]).toMatchObject({ id: post.id, body: "a photo", media: [{ id: image, file: `media/${image}.webp`, altText: "a harbour at dawn", width: 1200, height: 800 }] });
    expect(json.missingMedia).toEqual([]);
    expect(await eventTypes(ada.userId)).toContain("export_created");

    // The freshness check comes before the daily limit: a stale session is told to re-authenticate, not to wait a day.
    await makeStale(ada.b);
    const stale = await exportOf(ada.b);
    expect(stale.status).toBe(403);
    expect(await errorCode(stale)).toBe("reauth_required");
    await makeFresh(ada.b);
    const again = await exportOf(ada.b);
    expect(again.status).toBe(429);
    expect(await errorCode(again)).toBe("rate_limited");
    const retryAfter = Number(again.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(24 * 3600);
    expect((await eventTypes(ada.userId)).filter((type) => type === "export_created")).toHaveLength(1);
  });
});
