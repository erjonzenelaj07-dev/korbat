import { createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { EDGE_CACHE, EDGE_RULES } from "@korbat/contracts";
import { PRIVATE_CACHE, PUBLIC_CACHE } from "../../src/media/flows/serve";
import { edgeAdapterFrom, type EdgeSettings } from "../../src/media/edge-adapter";
import { fakeEdge } from "./fake-edge";

/**
 * The edge's purge adapter (3d design, section 5 "The adapters" and 7.4; 12.1 rows 20 and 27; Task 3): `off`, `test` and
 * `cloudflare`, chosen by EDGE_PURGE. The `test` adapter keeps the prefixes in memory and fails a prefix that contains
 * "fail"; it is built only on a site that is closed. The `cloudflare` adapter sends one request a call to the provider's
 * purge route with the bearer token, bounded at EDGE_RULES.timeoutMs, here against fakeEdge(); every failure answers
 * `failed`, and the token is in nothing it answers or throws.
 */
const ZONE = "0123456789abcdef0123456789abcdef";
const TOKEN = "edge_token_that_must_never_be_seen_0123";
const IMAGE = "1a2b3c4d-0000-4000-8000-0000000000e1";
const OTHER = "1a2b3c4d-0000-4000-8000-0000000000e2";
const closed = (over: Partial<EdgeSettings> = {}): EdgeSettings => ({ EDGE_PURGE: "test", APP_SITE: "closed", EDGE_ZONE_ID: undefined, EDGE_API_TOKEN: undefined, EDGE_HOST: undefined, ...over });
const cloudflare = (over: Partial<EdgeSettings> = {}): EdgeSettings => ({ EDGE_PURGE: "cloudflare", APP_SITE: "open", EDGE_ZONE_ID: ZONE, EDGE_API_TOKEN: TOKEN, EDGE_HOST: "korbat.example", ...over });

describe("the public image's header (7.4)", () => {
  test("PUBLIC_CACHE is built from EDGE_CACHE: a browser's minute, an edge's five minutes, revalidated, never stale", () => {
    expect(PUBLIC_CACHE).toBe(`public, max-age=${EDGE_CACHE.browserSeconds}, s-maxage=${EDGE_CACHE.edgeSeconds}, must-revalidate, stale-if-error=0`);
    expect(PUBLIC_CACHE).toBe("public, max-age=60, s-maxage=300, must-revalidate, stale-if-error=0");
    expect(PRIVATE_CACHE).toBe("private, no-store");
  });
});

describe("the edge's purge adapter", () => {
  test("off: the default, which sends nothing", async () => {
    const off = edgeAdapterFrom({ EDGE_PURGE: "off", APP_SITE: "open" });
    expect(off.mode).toBe("off");
    await expect(off.purge([off.prefix(IMAGE)])).rejects.toThrow(/off/);
  });

  test("a prefix covers both sizes of an image and every query-string variant: the host, the image route and the id, with its slash", () => {
    expect(edgeAdapterFrom(cloudflare()).prefix(IMAGE)).toBe(`korbat.example/api/media/${IMAGE}/`);
    expect(edgeAdapterFrom(closed({ EDGE_HOST: "edge.test" })).prefix(IMAGE)).toBe(`edge.test/api/media/${IMAGE}/`);
  });

  test("test: keeps each call's prefixes in memory and accepts them; a prefix that contains fail fails", async () => {
    const adapter = edgeAdapterFrom(closed());
    if (adapter.mode !== "test") throw new Error("not the test adapter");
    expect(await adapter.purge([adapter.prefix(IMAGE), adapter.prefix(OTHER)])).toBe("accepted");
    expect(adapter.sent).toEqual([[adapter.prefix(IMAGE), adapter.prefix(OTHER)]]);
    const failing = edgeAdapterFrom(closed({ EDGE_HOST: "fail.edge.test" }));
    expect(await failing.purge([failing.prefix(IMAGE)])).toBe("failed");
    expect(await adapter.purge([adapter.prefix(IMAGE), "fail"])).toBe("failed");
  });

  test("test is refused while the app's site is open, in the process as at start", () => {
    expect(() => edgeAdapterFrom(closed({ APP_SITE: "open" }))).toThrow(/APP_SITE/);
  });

  test("cloudflare is refused without its zone, its token or its host", () => {
    for (const missing of ["EDGE_ZONE_ID", "EDGE_API_TOKEN", "EDGE_HOST"] as const) {
      expect(() => edgeAdapterFrom(cloudflare({ [missing]: undefined })), missing).toThrow(new RegExp(missing));
    }
  });

  test("no call names more prefixes than a request may carry, or none", async () => {
    const adapter = edgeAdapterFrom(closed());
    const many = Array.from({ length: EDGE_RULES.prefixes + 1 }, (_, i) => `edge.test/api/media/${i}/`);
    await expect(adapter.purge(many)).rejects.toThrow(/at most/);
    await expect(adapter.purge([])).rejects.toThrow(/at least one/);
  });

  describe("cloudflare, against fakeEdge()", () => {
    let edge: Awaited<ReturnType<typeof fakeEdge>>;
    beforeAll(async () => {
      edge = await fakeEdge();
    });
    afterAll(async () => {
      await edge.close();
    });

    test("one POST to the zone's purge route with the prefixes as JSON and a bearer token; accepted when the provider says success", async () => {
      edge.requests.length = 0;
      edge.answer("ok");
      const adapter = edgeAdapterFrom(cloudflare(), { apiBase: edge.apiBase });
      expect(await adapter.purge([adapter.prefix(IMAGE), adapter.prefix(OTHER)])).toBe("accepted");
      expect(edge.requests).toEqual([
        { method: "POST", path: `/client/v4/zones/${ZONE}/purge_cache`, contentType: "application/json", prefixes: [`korbat.example/api/media/${IMAGE}/`, `korbat.example/api/media/${OTHER}/`], bearer: true },
      ]);
    });

    test("a server error, a body that says it failed, a refused token, a closed port and a provider that does not answer within the bound: each failed, with nothing thrown", async () => {
      const adapter = edgeAdapterFrom(cloudflare(), { apiBase: edge.apiBase });
      for (const how of ["error", "refused", "forbidden"] as const) {
        edge.answer(how);
        expect(await adapter.purge([adapter.prefix(IMAGE)]), how).toBe("failed");
      }
      // A port nobody listens on: taken and released again, so the connection is refused.
      const port = await new Promise<number>((resolve) => {
        const probe = createServer().listen(0, "127.0.0.1", () => {
          const taken = (probe.address() as { port: number }).port;
          probe.close(() => resolve(taken));
        });
      });
      expect(await edgeAdapterFrom(cloudflare(), { apiBase: `http://127.0.0.1:${port}/client/v4` }).purge([adapter.prefix(IMAGE)])).toBe("failed");
      edge.answer("hang");
      const started = Date.now();
      expect(await adapter.purge([adapter.prefix(IMAGE)])).toBe("failed");
      const waited = Date.now() - started;
      expect(waited).toBeGreaterThanOrEqual(EDGE_RULES.timeoutMs - 100);
      expect(waited).toBeLessThan(EDGE_RULES.timeoutMs + 5000);
      edge.answer("ok");
    }, 20_000);

    test("the token is in nothing the adapter shows: neither its own fields nor its text", () => {
      const adapter = edgeAdapterFrom(cloudflare(), { apiBase: edge.apiBase });
      expect(JSON.stringify(adapter)).not.toContain(TOKEN);
      expect(String(adapter)).not.toContain(TOKEN);
      expect(Object.values(adapter).map(String).join(" ")).not.toContain(TOKEN);
    });
  });
});
