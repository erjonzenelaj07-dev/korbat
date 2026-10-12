import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";
import { describe, expect, test } from "vitest";
import { createDb } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth } from "../../src/auth";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createModeration } from "../../src/moderation";
import { socialForModeration } from "../../src/social";
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
 * standing in for a route that needs no session, so a request that passes the gate can be told from one that does not: without a route
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
  const apiDb = createDb(config.DATABASE_URL_API, { max: 1 });
  const moderation = createModeration({ apiDb, social: socialForModeration(apiDb), config, logger });
  const staff = createStaff({ apiDb, auth: auth.forStaff, moderation: moderation.forStaff });
  const app = createApp({ config, logger, rateLimitStore: new MemoryStore(), healthChecks: {}, auth, staff });
  const seen: { session: unknown; method: string; path: string }[] = [];
  if (probe) {
    app.on(["GET", "POST"], PROBE_PATHS, (c) => {
      seen.push({ session: c.get("session"), method: c.req.method, path: c.req.path });
      return c.json({ ok: true });
    });
  }
  return { app, seen, auth };
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

  test("the enrolment routes stand behind the gate and validate their bodies before any flow runs", async () => {
    const { app } = build(CONSOLE_ORIGIN);
    for (const path of ["/api/staff/enroll/options", "/api/staff/enroll/verify"]) {
      const post = (headers: Record<string, string>, body: unknown) =>
        app.request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
      // Another Host is the unknown route, another Origin the gate's refusal, a write without an Origin too.
      expect((await post({ host: "localhost:8080", origin: CONSOLE_ORIGIN }, {})).status, path).toBe(404);
      const foreign = await post({ host: CONSOLE_HOST, origin: APP_ORIGIN }, {});
      expect([path, foreign.status, ((await foreign.json()) as ErrorBody).error.code]).toEqual([path, 403, "csrf_failed"]);
      expect((await post({ host: CONSOLE_HOST }, {})).status, path).toBe(403);
      // Through the gate, a body the contracts refuse is invalid_request; the pools behind the flows are never reached.
      const invalid = await post({ host: CONSOLE_HOST, origin: CONSOLE_ORIGIN }, { token: "short", name: "", kind: "phone" });
      expect([path, invalid.status, ((await invalid.json()) as ErrorBody).error.code]).toEqual([path, 400, "invalid_request"]);
    }
  });

  test("the session routes stand behind the gate and requireStaff: without a staff cookie each is staff_session_required with both staff cookies cleared, before any database read", async () => {
    // The pools point at a port nothing listens on: a route that read the database would fail with another answer.
    const { app } = build(CONSOLE_ORIGIN);
    const routes = [
      ["GET", "/api/staff/me"],
      ["GET", "/api/staff/sessions"],
      ["GET", "/api/staff/keys"],
      ["GET", "/api/staff/audit"],
      ["POST", "/api/staff/signout"],
      // Step-up and the revocation it confirms: no session, no confirmation is even read.
      ["POST", "/api/staff/step-up/options"],
      ["DELETE", "/api/staff/sessions/3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a"],
    ] as const;
    for (const [method, path] of routes) {
      // Another Host is still the unknown route, before any session is looked for.
      expect((await app.request(path, { method, headers: { host: "localhost:8080", origin: CONSOLE_ORIGIN } })).status, path).toBe(404);
      // The app's session cookie and a bearer token are not staff sessions.
      const res = await app.request(path, {
        method,
        headers: { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN, cookie: "__Host-korbat_session=kb1_x; __Host-korbat_csrf=c", "x-csrf-token": "c", authorization: `Bearer kb1_${"A".repeat(43)}` },
      });
      expect([path, res.status, ((await res.json()) as ErrorBody).error.code]).toEqual([path, 401, "staff_session_required"]);
      const cleared = res.headers.getSetCookie();
      expect(cleared.map((line) => line.slice(0, line.indexOf("="))).sort(), path).toEqual(["__Host-korbat_staff", "__Host-korbat_staff_csrf"]);
      for (const line of cleared) expect(line, path).toContain("Max-Age=0");
      expect(accessControlHeaders(res), path).toEqual([]);
    }
  });

  test("a staff write with the staff cookie but without the staff CSRF header is csrf_failed, before any database read", async () => {
    const { app } = build(CONSOLE_ORIGIN);
    for (const [method, path] of [
      ["POST", "/api/staff/signout"],
      ["POST", "/api/staff/step-up/options"],
      ["DELETE", "/api/staff/sessions/3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a"],
    ] as const) {
      const res = await app.request(path, { method, headers: { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN, cookie: "__Host-korbat_staff=x; __Host-korbat_staff_csrf=y" } });
      expect([path, res.status]).toEqual([path, 403]);
      expect(((await res.json()) as ErrorBody).error.code).toBe("csrf_failed");
      // A refused write ends nothing: the cookies stay.
      expect(res.headers.getSetCookie()).toEqual([]);
    }
  });

  test("the sign-in options need no session and read no database: a staff sign-in challenge for discoverable, user-verified credentials of the console", async () => {
    const { app } = build(CONSOLE_ORIGIN);
    const res = await app.request("/api/staff/signin/options", { method: "POST", headers: { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN } });
    expect(res.status).toBe(200);
    const { options } = (await res.json()) as { options: { rpId: string; challenge: string; allowCredentials?: unknown[]; userVerification: string } };
    expect(options.rpId).toBe("console.localhost");
    expect(options.allowCredentials ?? []).toEqual([]);
    expect(options.userVerification).toBe("required");
    expect(Buffer.from(options.challenge, "base64url")).toHaveLength(58);
    expect(res.headers.getSetCookie()).toEqual([]);
    // The verification validates its body before any flow runs.
    const invalid = await app.request("/api/staff/signin/verify", {
      method: "POST",
      headers: { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ response: { id: "x" } }),
    });
    expect([invalid.status, ((await invalid.json()) as ErrorBody).error.code]).toEqual([400, "invalid_request"]);
  });

  test("no staff power remains in the app: the auth module offers no requireStaffMfa, and no source names it", () => {
    const { auth } = build(CONSOLE_ORIGIN);
    expect(Object.keys(auth)).not.toContain("requireStaffMfa");
    expect(Object.keys(auth)).toContain("requireStaff");
    const src = fileURLToPath(new URL("../../src", import.meta.url));
    const mentions = readdirSync(src, { recursive: true, encoding: "utf8" }).filter((file) => file.endsWith(".ts") && readFileSync(join(src, file), "utf8").includes("requireStaffMfa"));
    expect(mentions).toEqual([]);
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
