import pino from "pino";
import { describe, expect, test } from "vitest";
import { createDb } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth } from "../../src/auth";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createStaff } from "../../src/staff";

const key = Buffer.alloc(32, 7).toString("base64");
const APP_ORIGIN = "http://localhost:8081";
const TRUSTED = "http://localhost:8080";
const CONSOLE_ORIGIN = "http://console.localhost:8090";
const CONSOLE_HOST = "console.localhost:8090";
/** The staff prefix itself, with and without its final slash (distinct paths to Hono's router), and a path under it. */
const PROBE_PATHS = ["/api/staff", "/api/staff/", "/api/staff/probe"];

/**
 * createApp with the staff module (3a design, section 5), the console on or off. The pools are created but never connect:
 * nothing here reaches a flow. `probe` adds a stub route at each of PROBE_PATHS before the first request builds the router,
 * standing in for Task 4's routes, so a request that passes the gate can be told from one that does not: without a route
 * there, a wrong Host and a missing route both end in the same unknown-route 404, gate or no gate.
 */
function build(consoleOrigin: string | undefined, probe = false) {
  const config = loadConfig({
    DATABASE_URL_API: "postgres://a:b@localhost:55432/k",
    DATABASE_URL_AUTH: "postgres://a:b@localhost:55432/k",
    REDIS_URL: "redis://localhost:56379",
    APP_ORIGIN,
    TRUSTED_ORIGINS: TRUSTED,
    AUTH_HMAC_KEY: key,
    IP_HASH_KEY: key,
    TOTP_ENC_KEY: `v1:${key}`,
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    SMTP_URL: "smtp://localhost:1025",
    MAIL_FROM: "korbat <no-reply@korbat.local>",
    TERMS_VERSION: "draft-2026-09",
    ...(consoleOrigin === undefined ? {} : { CONSOLE_ORIGIN: consoleOrigin }),
  });
  const logger = pino({ level: "silent" });
  const auth = createAuth({
    config,
    logger,
    authDb: createDb(config.DATABASE_URL_AUTH, { max: 1 }),
    kv: new MemoryKv(),
    mailer: new MemoryMailer(),
    profiles: { create: async () => ({ ok: false, reason: "handle_taken" }), find: async () => null, setVerified: async () => undefined },
  });
  const staff = createStaff({ apiDb: createDb(config.DATABASE_URL_API, { max: 1 }) });
  const app = createApp({ config, logger, rateLimitStore: new MemoryStore(), healthChecks: {}, auth, staff });
  const seen: { session: unknown; method: string; path: string }[] = [];
  if (probe) {
    app.on(["GET", "POST"], PROBE_PATHS, (c) => {
      seen.push({ session: c.get("session"), method: c.req.method, path: c.req.path });
      return c.json({ ok: true });
    });
  }
  return { app, seen };
}

type ErrorBody = { error: { code: string; message: string; requestId?: string } };

const accessControlHeaders = (res: Response) => [...res.headers.keys()].filter((name) => name.startsWith("access-control-"));

describe("the staff module in createApp", () => {
  test("with CONSOLE_ORIGIN unset, every path under /api/staff is the unknown route, whatever the request carries", async () => {
    const { app } = build(undefined);
    const unknown = (await (await app.request("/api/nope")).json()) as ErrorBody;
    for (const [method, path, headers] of [
      ["GET", "/api/staff", { host: CONSOLE_HOST }],
      ["GET", "/api/staff/me", { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN }],
      // A write from a foreign origin would meet resolveSession's csrf_failed on any other path.
      ["POST", "/api/staff/signout", { host: CONSOLE_HOST, origin: "https://evil.example" }],
      // A preflight from an origin the app trusts would meet the app's CORS on any other path.
      ["OPTIONS", "/api/staff/me", { origin: TRUSTED, "access-control-request-method": "POST" }],
    ] as const) {
      const res = await app.request(path, { method, headers });
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(accessControlHeaders(res), `${method} ${path}`).toEqual([]);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(((await res.json()) as ErrorBody).error).toEqual({ ...unknown.error, requestId: res.headers.get("x-request-id") });
    }
  });

  test("with CONSOLE_ORIGIN set, the staff gate stands before every staff path, the prefix itself included", async () => {
    const { app, seen } = build(CONSOLE_ORIGIN, true);
    const unknown = (await (await app.request("/api/nope")).json()) as ErrorBody;
    // Another Host: the same 404 as an unknown route, so the console cannot tell a wrong address from a console that is off.
    // Each of these paths has a route, so the 404 is the gate's: for another host, the console's host without its port, and
    // no Host at all.
    for (const path of PROBE_PATHS) {
      for (const headers of [{ host: "localhost:8080" }, { host: "console.localhost" }, {}]) {
        const res = await app.request(path, { headers });
        expect(res.status, `${path} ${JSON.stringify(headers)}`).toBe(404);
        expect(((await res.json()) as ErrorBody).error).toEqual({ ...unknown.error, requestId: res.headers.get("x-request-id") });
      }
    }
    // The console's Host with another Origin: refused by the gate before any route runs.
    const foreign = await app.request("/api/staff/probe", { headers: { host: CONSOLE_HOST, origin: APP_ORIGIN } });
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toMatchObject({ error: { code: "csrf_failed" } });
    expect(seen).toEqual([]);
    // Through the gate, a path no route answers is still the unknown route.
    expect((await app.request("/api/staff/nothing-here", { headers: { host: CONSOLE_HOST } })).status).toBe(404);
    // The console's Host reaches the route at every one of them, the prefix itself included.
    for (const path of PROBE_PATHS) expect((await app.request(path, { headers: { host: CONSOLE_HOST } })).status, path).toBe(200);
    expect(seen.map((request) => request.path)).toEqual(PROBE_PATHS);
  });

  test("a console write carrying the app's session and CSRF cookies reaches the staff route: the app's session is never resolved there", async () => {
    const { app, seen } = build(CONSOLE_ORIGIN, true);
    const res = await app.request("/api/staff/probe", {
      method: "POST",
      headers: {
        host: CONSOLE_HOST,
        origin: CONSOLE_ORIGIN,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        cookie: "__Host-korbat_session=not-a-session; __Host-korbat_csrf=abc",
        authorization: "Bearer not-a-token",
      },
      body: "{}",
    });
    expect(res.status).toBe(200);
    expect(seen).toEqual([{ session: undefined, method: "POST", path: "/api/staff/probe" }]);
  });

  test("no staff answer carries CORS headers, even to an origin the app trusts; the app's other paths keep them", async () => {
    const { app } = build(CONSOLE_ORIGIN, true);
    for (const [method, headers] of [
      ["GET", { host: CONSOLE_HOST, origin: TRUSTED }],
      ["OPTIONS", { host: CONSOLE_HOST, origin: TRUSTED, "access-control-request-method": "POST" }],
      ["GET", { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN }],
    ] as const) {
      const res = await app.request("/api/staff/probe", { method, headers });
      expect(accessControlHeaders(res), `${method} ${headers.origin}`).toEqual([]);
    }
    // The one path test: /api/staff and what begins with /api/staff/, never a path that merely starts with the letters.
    const neighbour = await app.request("/api/staffing", { headers: { origin: TRUSTED } });
    expect(neighbour.status).toBe(404);
    expect(neighbour.headers.get("access-control-allow-origin")).toBe(TRUSTED);
    const health = await app.request("/api/health", { headers: { origin: TRUSTED } });
    expect(health.headers.get("access-control-allow-origin")).toBe(TRUSTED);
  });

  test("staff paths keep the JSON body limit and the API's headers", async () => {
    const { app } = build(CONSOLE_ORIGIN, true);
    const res = await app.request("/api/staff/probe", {
      method: "POST",
      headers: { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ x: "x".repeat(70_000) }),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: { code: "payload_too_large" } });
    const ok = await app.request("/api/staff/probe", { headers: { host: CONSOLE_HOST } });
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
    expect(ok.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});
