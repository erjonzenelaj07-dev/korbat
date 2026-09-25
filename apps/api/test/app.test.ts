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
    profiles: { create: async () => ({ ok: false, reason: "handle_taken" }), find: async () => null, setVerified: async () => undefined },
  });
  const apiDb = createDb(config.DATABASE_URL_API, { max: 1 });
  const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth() });
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

describe("request bodies", () => {
  test("JSON bodies over 64 KiB are refused with 413; the raw upload route is exempt", async () => {
    const a = app({});
    const big = JSON.stringify({ email: "x".repeat(70_000) });
    const refused = await a.request("/api/auth/email/start", { method: "POST", headers: { "content-type": "application/json" }, body: big });
    expect(refused.status).toBe(413);
    expect(await refused.json()).toMatchObject({ error: { code: "payload_too_large" } });
    const upload = await a.request("/api/media", { method: "POST", headers: { "content-type": "image/jpeg" }, body: big });
    expect(upload.status).toBe(401);
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
