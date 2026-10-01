import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createDevServer, parsePort } from "../dev-server.mjs";
import { CONSOLE_CSP, consoleSiteHeaders } from "../site-headers.mjs";

/**
 * The development server (3a design, section 13, Task 6): it serves the build with the console site's headers, the CSP
 * of section 3 included, and forwards /api/staff/* to the API with the Host header kept, so the staff gate sees the
 * console's host. Here it serves a small dist of its own and forwards to a stand-in API on another port.
 */
let dist = "";
let api: Server;
let dev: Server;
let base = "";
const seen: { method: string; url: string; host: string | undefined; origin: string | undefined; body: string }[] = [];

const listen = (server: Server): Promise<number> =>
  new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));

const bodyOf = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    let text = "";
    req.on("data", (chunk) => (text += chunk));
    req.on("end", () => resolve(text));
  });

beforeAll(async () => {
  dist = mkdtempSync(path.join(tmpdir(), "korbat-admin-dev-"));
  mkdirSync(path.join(dist, "assets"));
  writeFileSync(path.join(dist, "index.html"), "<!doctype html><title>console</title>");
  writeFileSync(path.join(dist, "assets", "main-ABCDEFGH.js"), "console.log(1)");
  writeFileSync(path.join(dist, "favicon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
  writeFileSync(path.join(path.dirname(dist), "korbat-admin-dev-secret.txt"), "outside dist");
  api = createServer(async (req, res) => {
    seen.push({ method: req.method!, url: req.url!, host: req.headers.host, origin: req.headers.origin, body: await bodyOf(req) });
    res.writeHead(201, { "content-type": "application/json", "set-cookie": "__Host-korbat_staff=x; Path=/; Secure; HttpOnly", "cache-control": "no-store" });
    res.end(JSON.stringify({ ok: true }));
  });
  const apiPort = await listen(api);
  dev = createDevServer({ dist, api: `http://127.0.0.1:${apiPort}` });
  base = `http://127.0.0.1:${await listen(dev)}`;
});

afterAll(async () => {
  await Promise.all([new Promise((r) => dev.close(r)), new Promise((r) => api.close(r))]);
  rmSync(dist, { recursive: true, force: true });
  rmSync(path.join(path.dirname(dist), "korbat-admin-dev-secret.txt"), { force: true });
});

describe("the console site's headers", () => {
  test("the CSP of section 3, exactly", () => {
    expect(CONSOLE_CSP).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; require-trusted-types-for 'script'; trusted-types 'none'",
    );
  });

  test("the page is never stored or transformed; the hashed files are kept for a year", () => {
    expect(consoleSiteHeaders("/")["Cache-Control"]).toBe("no-store, no-transform");
    expect(consoleSiteHeaders("/favicon.svg")["Cache-Control"]).toBe("no-store, no-transform");
    expect(consoleSiteHeaders("/assets/main-ABCDEFGH.js")["Cache-Control"]).toBe("public, max-age=31536000, immutable");
  });

  test("the rest of section 8's list", () => {
    expect(consoleSiteHeaders("/")).toMatchObject({
      "Content-Security-Policy": CONSOLE_CSP,
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), publickey-credentials-get=(self), publickey-credentials-create=(self)",
    });
  });
});

describe("the development server", () => {
  test("serves the page with the console site's headers, and index.html for every path of the router", async () => {
    for (const p of ["/", "/audit", "/signin", "/enroll/abc", "/no/such/page"]) {
      const res = await fetch(`${base}${p}`);
      expect(res.status, p).toBe(200);
      expect(res.headers.get("content-security-policy"), p).toBe(CONSOLE_CSP);
      expect(res.headers.get("cache-control"), p).toBe("no-store, no-transform");
      expect(res.headers.get("content-type"), p).toBe("text/html; charset=utf-8");
      expect(await res.text()).toBe("<!doctype html><title>console</title>");
    }
  });

  test("serves a hashed file as itself, cached for a year", async () => {
    const res = await fetch(`${base}/assets/main-ABCDEFGH.js`);
    expect(await res.text()).toBe("console.log(1)");
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("content-security-policy")).toBe(CONSOLE_CSP);
  });

  test("never serves a file outside dist", async () => {
    // Sent as written: fetch would resolve the dot segments before the server saw them. Windows also reads a backslash
    // as a separator, so one is built from its code.
    const BACKSLASH = String.fromCharCode(92);
    const raw = (p: string): Promise<string> =>
      new Promise((resolve, reject) => {
        const url = new URL(base);
        const req = request({ host: url.hostname, port: url.port, path: p }, (res) => {
          let text = "";
          res.on("data", (chunk) => (text += chunk));
          res.on("end", () => resolve(`${res.statusCode} ${text}`));
        });
        req.on("error", reject);
        req.end();
      });
    for (const p of ["/../korbat-admin-dev-secret.txt", "/%2e%2e/korbat-admin-dev-secret.txt", "/assets/..%2f..%2fkorbat-admin-dev-secret.txt", `/assets/..${BACKSLASH}..${BACKSLASH}korbat-admin-dev-secret.txt`]) {
      expect(await raw(p), p).not.toContain("outside dist");
    }
  });

  test("forwards /api/staff/* to the API with its method, path, query, body and Host, and hands back its answer", async () => {
    seen.length = 0;
    const host = new URL(base).host;
    const res = await fetch(`${base}/api/staff/audit?cursor=5`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: '{"a":1}' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("set-cookie")).toContain("__Host-korbat_staff=x");
    expect(seen).toEqual([{ method: "POST", url: "/api/staff/audit?cursor=5", host, origin: base, body: '{"a":1}' }]);
    await fetch(`${base}/api/staff`);
    expect(seen[1]!.url).toBe("/api/staff");
  });

  test("any other /api path is not the console's: 404, and nothing reaches the API", async () => {
    seen.length = 0;
    for (const p of ["/api/me", "/api/auth/signin", "/api/staffx", "/api"]) {
      const res = await fetch(`${base}${p}`);
      expect(res.status, p).toBe(404);
    }
    expect(seen).toEqual([]);
  });

  test("an API that is not running is a 502 with an error envelope", async () => {
    const lonely = createDevServer({ dist, api: "http://127.0.0.1:9" });
    const url = `http://127.0.0.1:${await listen(lonely)}`;
    const res = await fetch(`${url}/api/staff/me`);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: { code: "internal" } });
    await new Promise((r) => lonely.close(r));
  });
});

describe("the --port argument", () => {
  test("8090 by default, another port when given", () => {
    expect(parsePort([])).toBe(8090);
    expect(parsePort(["--port", "8091"])).toBe(8091);
    expect(parsePort(["--port=8092"])).toBe(8092);
    expect(parsePort(["--", "--port", "8093"])).toBe(8093);
  });

  test("anything but a port is refused", () => {
    for (const args of [["--port"], ["--port", "x"], ["--port", "0"], ["--port", "65536"], ["--bogus"]]) expect(() => parsePort(args), args.join(" ")).toThrow();
  });
});
