import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import { AuthError } from "../../src/auth";
import type { AppEnv } from "../../src/env";
import { errorBody } from "../../src/lib/errors";
import { staffGate } from "../../src/staff/gate";

const CONSOLE_ORIGIN = "http://console.localhost:8090";
const CONSOLE_HOST = "console.localhost:8090";

/**
 * The staff gate (3a design, section 7) as a unit: a Hono app with one stub route behind it, answering an unknown route
 * and an AuthError as createApp does. No staff route exists before Task 4, whose HTTP tests take the gate through the app.
 */
function gated() {
  const app = new Hono<AppEnv>();
  const reached: string[] = [];
  app.use("/api/staff/*", staffGate(CONSOLE_ORIGIN));
  app.all("/api/staff/stub", (c) => {
    reached.push(c.req.method);
    return c.json({ ok: true });
  });
  app.notFound((c) => c.json(errorBody("not_found", "No such route"), 404));
  app.onError((err, c) => (err instanceof AuthError ? c.json(errorBody(err.code, err.message), err.status) : c.json(errorBody("internal", "Internal error"), 500)));
  const send = (method: string, headers: Record<string, string>) => app.request("/api/staff/stub", { method, headers });
  return { send, reached };
}

async function code(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

describe("the staff gate", () => {
  test("lets through a read from the console's host, with or without its Origin, and a write that carries it", async () => {
    const { send, reached } = gated();
    // Node's fetch, which the smoke test uses, sends neither Origin on a GET nor Sec-Fetch-Site.
    expect((await send("GET", { host: CONSOLE_HOST })).status).toBe(200);
    expect((await send("HEAD", { host: CONSOLE_HOST })).status).toBe(200);
    expect((await send("GET", { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN, "sec-fetch-site": "same-origin" })).status).toBe(200);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect((await send(method, { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN, "sec-fetch-site": "same-origin" })).status, method).toBe(200);
      expect((await send(method, { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN })).status, method).toBe(200);
    }
    expect(reached).toEqual(["GET", "HEAD", "GET", "POST", "POST", "PUT", "PUT", "PATCH", "PATCH", "DELETE", "DELETE"]);
  });

  test("answers another Host, port included, with the 404 of an unknown route, whatever else the request says", async () => {
    const { send, reached } = gated();
    const hosts = ["localhost:8090", "console.localhost", "console.localhost:8091", "localhost:8081", "evil.example", "console.localhost:8090.evil.example"];
    for (const host of hosts) {
      for (const method of ["GET", "POST"]) {
        const res = await send(method, { host, origin: CONSOLE_ORIGIN, "sec-fetch-site": "same-origin" });
        expect(res.status, `${method} ${host}`).toBe(404);
        expect(await code(res)).toBe("not_found");
      }
    }
    // No Host at all (an in-process request sets none), and the forwarded host a proxy might add, which is never read.
    expect((await send("GET", {})).status).toBe(404);
    expect((await send("GET", { host: "localhost:8081", "x-forwarded-host": CONSOLE_HOST })).status).toBe(404);
    // The Host test comes first: a foreign Host with a foreign Origin is still the unknown route, not a CSRF refusal.
    expect((await send("POST", { host: "evil.example", origin: "https://evil.example" })).status).toBe(404);
    expect(reached).toEqual([]);
  });

  test("refuses an Origin other than exactly the console's with csrf_failed, on every method", async () => {
    const { send, reached } = gated();
    const origins = ["http://localhost:8081", "http://localhost:8090", "http://console.localhost:8091", "https://console.localhost:8090", `${CONSOLE_ORIGIN}/`, "null"];
    for (const origin of origins) {
      for (const method of ["GET", "HEAD", "POST", "DELETE"]) {
        const res = await send(method, { host: CONSOLE_HOST, origin });
        expect(res.status, `${method} ${origin}`).toBe(403);
        if (method !== "HEAD") expect(await code(res)).toBe("csrf_failed");
      }
    }
    expect(reached).toEqual([]);
  });

  test("refuses a write without an Origin", async () => {
    const { send, reached } = gated();
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const res = await send(method, { host: CONSOLE_HOST, "sec-fetch-site": "same-origin" });
      expect(res.status, method).toBe(403);
      expect(await code(res)).toBe("csrf_failed");
    }
    expect(reached).toEqual([]);
  });

  test("refuses fetch metadata other than same-origin, even on a read with the console's Origin", async () => {
    const { send, reached } = gated();
    for (const site of ["same-site", "cross-site", "none", "SAME-ORIGIN"]) {
      for (const [method, headers] of [
        ["GET", {}],
        ["GET", { origin: CONSOLE_ORIGIN }],
        ["POST", { origin: CONSOLE_ORIGIN }],
      ] as const) {
        const res = await send(method, { host: CONSOLE_HOST, "sec-fetch-site": site, ...headers });
        expect(res.status, `${method} ${site}`).toBe(403);
        expect(await code(res)).toBe("csrf_failed");
      }
    }
    expect(reached).toEqual([]);
  });
});
