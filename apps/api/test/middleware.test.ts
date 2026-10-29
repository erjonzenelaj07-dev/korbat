import { describe, expect, test } from "vitest";
import { Hono } from "hono";
import { z } from "zod";
import pino from "pino";
import type { AppEnv } from "../src/env";
import { observability } from "../src/middleware/observability";
import { noStore, securityHeaders } from "../src/middleware/security-headers";
import { MemoryStore, rateLimit } from "../src/middleware/rate-limit";
import { validate } from "../src/lib/validate";
import { clientIdentity, clientNetwork, resolveClientIp } from "../src/auth/client-ip";

const silent = pino({ level: "silent" });

function base() {
  const app = new Hono<AppEnv>();
  app.use(observability(silent));
  app.use(securityHeaders, noStore);
  return app;
}

describe("observability", () => {
  test("adds a uuid x-request-id header", async () => {
    const app = base().get("/x", (c) => c.text("ok"));
    const res = await app.request("/x");
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("security headers", () => {
  test("sets the hardened header set on every response", async () => {
    const app = base().get("/x", (c) => c.json({}));
    const h = (await app.request("/x")).headers;
    expect(h.get("content-security-policy")).toContain("default-src 'none'");
    expect(h.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(h.get("strict-transport-security")).toContain("max-age=31536000");
    expect(h.get("referrer-policy")).toBe("no-referrer");
    expect(h.get("x-content-type-options")).toBe("nosniff");
    expect(h.get("x-frame-options")).toBe("DENY");
    expect(h.get("cache-control")).toBe("no-store");
    expect(h.get("x-robots-tag")).toBe("noindex");
  });

  test("2d (design, decision 20 and section 8.2): X-Robots-Tag noindex on every answer, an image's, a 404's and an error's included", async () => {
    const app = base()
      .get("/image", () => new Response("webp", { headers: { "content-type": "image/webp", "cache-control": "public, max-age=60" } }))
      .get("/empty", (c) => c.body(null, 204))
      .get("/boom", () => {
        throw new Error("boom");
      });
    app.notFound((c) => c.json({ error: "not found" }, 404));
    app.onError((_err, c) => c.json({ error: "internal" }, 500));
    for (const [path, status] of [["/image", 200], ["/empty", 204], ["/none", 404], ["/boom", 500]] as const) {
      const res = await app.request(path);
      expect([path, res.status, res.headers.get("x-robots-tag")]).toEqual([path, status, "noindex"]);
    }
    // A handler's own caching stays as it set it.
    expect((await app.request("/image")).headers.get("cache-control")).toBe("public, max-age=60");
  });
});

describe("rateLimit", () => {
  test("allows up to limit then returns 429 with Retry-After", async () => {
    let now = 1_000_000;
    const store = new MemoryStore(() => now);
    const app = base()
      .use(rateLimit({ name: "t", store, limit: 2, windowMs: 10_000, key: () => "k" }))
      .get("/x", (c) => c.text("ok"));
    expect((await app.request("/x")).status).toBe(200);
    expect((await app.request("/x")).status).toBe(200);
    const blocked = await app.request("/x");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await blocked.json()) as { error: { code: string } }).toMatchObject({ error: { code: "rate_limited" } });
    now += 10_001;
    expect((await app.request("/x")).status).toBe(200);
  });
  test("a hit given back with release leaves the count one lower in the same window, and never below zero", async () => {
    let now = 1_000_000;
    const store = new MemoryStore(() => now);
    await store.hit("k", 10_000);
    now += 4_000;
    await store.hit("k", 10_000);
    await store.release("k");
    // One hit left, and the window still ends where the first hit put it: nothing was restarted.
    expect(await store.hit("k", 10_000)).toEqual({ count: 2, resetMs: 6_000 });
    await store.release("k");
    await store.release("k");
    await store.release("k");
    expect(await store.hit("k", 10_000)).toEqual({ count: 1, resetMs: 6_000 });
    // A key that was never hit has nothing to give back, and another key is not touched.
    await store.release("never");
    expect(await store.hit("never", 10_000)).toEqual({ count: 1, resetMs: 10_000 });
    // Once the window is over, a release belongs to no window and the next hit opens a fresh one.
    now += 6_000;
    await store.release("k");
    expect(await store.hit("k", 10_000)).toEqual({ count: 1, resetMs: 10_000 });
  });
  test("a failing store answers 503 with Retry-After instead of letting the request through", async () => {
    const store = {
      hit: async () => {
        throw new Error("redis down");
      },
      release: async () => undefined,
    };
    const app = base().use(rateLimit({ name: "t", store, limit: 2, windowMs: 10_000, key: () => "k" })).get("/x", (c) => c.text("ok"));
    const res = await app.request("/x");
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("30");
    expect(await res.json()).toMatchObject({ error: { code: "service_unavailable" } });
  });
  test("exposes RateLimit-* headers", async () => {
    const app = base()
      .use(rateLimit({ name: "t", store: new MemoryStore(), limit: 5, windowMs: 1000, key: () => "k" }))
      .get("/x", (c) => c.text("ok"));
    const h = (await app.request("/x")).headers;
    expect(h.get("ratelimit-limit")).toBe("5");
    expect(h.get("ratelimit-remaining")).toBe("4");
  });
});

describe("client identity", () => {
  const key = Buffer.alloc(32, 1);
  const spoofed = { "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.7, 10.0.0.1" };
  const seen = async (trust: "cloudflare" | "caddy" | "none", ipHashKey = key) => {
    const app = base().use(clientIdentity({ trust, ipHashKey })).get("/x", (c) => c.json({ ip: c.get("clientIp"), hash: c.get("clientIpHash") }));
    return (await (await app.request("/x", { headers: spoofed })).json()) as { ip: string; hash: string };
  };
  test("cloudflare mode believes cf-connecting-ip", async () => {
    expect((await seen("cloudflare")).ip).toBe("203.0.113.9");
  });
  test("caddy mode takes the first forwarded entry and ignores cf-connecting-ip", async () => {
    expect((await seen("caddy")).ip).toBe("198.51.100.7");
  });
  test("none mode uses the socket only, so a spoofed header opens no bucket", async () => {
    expect((await seen("none")).ip).toBe("direct");
  });
  test("the hash is keyed and never the address itself", async () => {
    const a = await seen("cloudflare");
    const b = await seen("cloudflare", Buffer.alloc(32, 2));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).not.toContain(a.ip);
    expect(a.hash).not.toBe(b.hash);
  });
  test("missing headers fall back down the list", () => {
    const c = { req: { header: () => undefined } } as unknown as Parameters<typeof resolveClientIp>[0];
    for (const trust of ["cloudflare", "caddy", "none"] as const) expect(resolveClientIp(c, trust)).toBe("direct");
  });

  describe("the network an address belongs to, for the limits that count per network (3c design, section 7.1)", () => {
    test("an IPv4 address is its own network; an IPv6 address is its first 64 bits, however it is written", () => {
      expect(clientNetwork("203.0.113.9")).toBe("203.0.113.9");
      expect(clientNetwork("2001:db8:1234:5678:9abc:def0:1234:5678")).toBe("2001:db8:1234:5678::/64");
      expect(clientNetwork("2001:db8:1234:5678::1")).toBe("2001:db8:1234:5678::/64");
      expect(clientNetwork("2001:DB8:1234:5678:FFFF:FFFF:FFFF:FFFF")).toBe("2001:db8:1234:5678::/64");
      // Leading zeros and the compressed form name the same network.
      expect(clientNetwork("2001:0db8:0000:0000:0000:0000:0000:0001")).toBe("2001:db8:0:0::/64");
      expect(clientNetwork("2001:db8::1")).toBe("2001:db8:0:0::/64");
      expect(clientNetwork("::1")).toBe("0:0:0:0::/64");
      expect(clientNetwork("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
      // Another /64 is another network.
      expect(clientNetwork("2001:db8:1234:5679::1")).toBe("2001:db8:1234:5679::/64");
    });
    test("an IPv4 address written as an IPv6 one counts as the IPv4 address it is", () => {
      expect(clientNetwork("::ffff:203.0.113.9")).toBe("203.0.113.9");
      expect(clientNetwork("::FFFF:203.0.113.9")).toBe("203.0.113.9");
    });
    test("what is no address is taken as it is, so a request without one still has a bucket", () => {
      expect(clientNetwork("direct")).toBe("direct");
      expect(clientNetwork("not an address")).toBe("not an address");
    });
    test("the middleware sets its keyed hash beside the address's: one hash for a whole /64, another for the next, never the network itself", async () => {
      const netOf = async (ip: string, ipHashKey = key) => {
        const app = base().use(clientIdentity({ trust: "cloudflare", ipHashKey })).get("/x", (c) => c.json({ hash: c.get("clientIpHash"), net: c.get("clientNetHash") }));
        return (await (await app.request("/x", { headers: { "cf-connecting-ip": ip } })).json()) as { hash: string; net: string };
      };
      const [one, two, next] = [await netOf("2001:db8:1234:5678::1"), await netOf("2001:db8:1234:5678:aaaa:bbbb:cccc:dddd"), await netOf("2001:db8:1234:5679::1")];
      expect(one.net).toMatch(/^[0-9a-f]{64}$/);
      expect(two.net).toBe(one.net);
      expect(next.net).not.toBe(one.net);
      // The address's own hash still tells the two addresses apart.
      expect(two.hash).not.toBe(one.hash);
      expect(one.net).not.toBe(one.hash);
      expect((await netOf("2001:db8:1234:5678::1", Buffer.alloc(32, 2))).net).not.toBe(one.net);
      const v4 = await netOf("203.0.113.9");
      expect(v4.net).toMatch(/^[0-9a-f]{64}$/);
      expect(v4.net).not.toBe(v4.hash);
      expect((await netOf("::ffff:203.0.113.9")).net).toBe(v4.net);
      expect((await netOf("203.0.113.10")).net).not.toBe(v4.net);
    });
  });
});

describe("validate", () => {
  test("returns 400 envelope with field details", async () => {
    const app = base().post("/x", validate("json", z.object({ n: z.number() })), (c) => c.json(c.req.valid("json")));
    const res = await app.request("/x", { method: "POST", body: JSON.stringify({ n: "no" }), headers: { "content-type": "application/json" } });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; details: { properties?: Record<string, unknown> } } };
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.details.properties).toHaveProperty("n");
  });
  test("passes valid input through", async () => {
    const app = base().post("/x", validate("json", z.object({ n: z.number() })), (c) => c.json(c.req.valid("json")));
    const res = await app.request("/x", { method: "POST", body: JSON.stringify({ n: 4 }), headers: { "content-type": "application/json" } });
    expect(await res.json()).toEqual({ n: 4 });
  });
});
