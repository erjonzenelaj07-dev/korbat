import { describe, expect, test } from "vitest";
import pino from "pino";
import { HealthResponse } from "@korbat/contracts";
import { createDb } from "@korbat/db";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth";
import { MemoryKv } from "../src/auth/kv";
import { loadConfig } from "../src/config";
import { MemoryMailer } from "../src/mail/memory";
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

/** The real app with both modules; the database pools are created but never connect in these tests. */
function app(checks: Record<string, () => Promise<void>>) {
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
  const social = createSocial({ apiDb: createDb(config.DATABASE_URL_API, { max: 1 }), rateLimitStore, logger, requireSession: auth.requireSession });
  return createApp({ config, logger, rateLimitStore, healthChecks: checks, auth, social });
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
