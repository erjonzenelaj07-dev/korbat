# korbat Foundation — Task 10 of 16: `@korbat/api` middleware

You are executing one task of an approved implementation plan. Do this task completely, verify it, commit it, and report. Do nothing beyond it.

## Project context

korbat is a pseudonymous social platform where security is half the product. The backend is a self-owned Hono API (TypeScript) that is the only client of our Postgres and Redis, deployed behind Caddy and a Cloudflare Tunnel. The API returns JSON only; the HTML app is served by Caddy. Every request passes through a fixed middleware chain whose contract is:

- **Observability**: a server-generated request id (never trusted from the client) on every response as `x-request-id` and in every error envelope, a child logger per request, and one access-log line per request. The logger already scrubs PII (Task 9).
- **Security headers**: a JSON-only CSP (`default-src 'none'; frame-ancestors 'none'; base-uri 'none'`), HSTS, no-referrer, nosniff, DENY framing, `Cache-Control: no-store`.
- **Rate limiting**: every route is limited; per-user limits come in later sub-projects. The store is pluggable: an in-memory store for tests and a Redis store (atomic Lua INCR + PEXPIRE) for production. Responses carry `RateLimit-*` headers and 429s carry `Retry-After` plus the shared error envelope.
- **Session**: in the Foundation nobody is signed in. The stub sets `session = null`; `requireSession` answers 401 with the envelope. Sub-project 1 replaces the stub with real cookie/bearer resolution but keeps the same `Session` shape and `requireSession` contract.
- **Validation**: request bodies/queries are validated with Zod schemas from `@korbat/contracts` and failures return a 400 envelope with field-level details.

Every error the API emits uses the `ErrorEnvelope` shape from `@korbat/contracts`: `{ error: { code, message, requestId?, details? } }`.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0. Docker not needed (tests use the in-memory store).
- Pinned: hono 4.13.5, @hono/zod-validator 0.9.1, zod 4.5.4, ioredis 5.11.1, pino 10.3.1, vitest 4.1.11.
- Hono notes: `createMiddleware<Env>()` from `hono/factory` builds typed middleware; `secureHeaders()` from `hono/secure-headers` returns middleware; `app.use(a, b)` accepts several middlewares; `app.request(path, init)` runs a request in tests without a server; `c.header()` before `next()` and `c.res.headers.set()` after `next()` both add response headers; `c.req.valid("json")` returns the validated body after `zValidator`.
- Zod 4: `z.treeifyError(error)` returns `{ errors: [], properties: { field: { errors: [...] } } }`.
- ioredis: `redis.defineCommand(name, { numberOfKeys, lua })` adds a method `redis[name](...)`.
- Full plan: `docs/superpowers/plans/2026-09-03-foundation.md` (Task 10).

## Preconditions

`git log --oneline -1` must show `feat(api): env config and PII-scrubbing logger`. `apps/api/src/config.ts` and `apps/api/src/lib/logger.ts` exist and `pnpm --filter @korbat/api test` passes 7 tests. If `apps/api/src/middleware/` exists, verify against this prompt, fix drift, run tests, skip to the report.

## Rules

1. Test first: write `test/middleware.test.ts`, run, see it fail on missing modules, implement all files, run, see it pass.
2. Exact file contents below. The one place version drift is plausible is the generic signature of `zValidator` in `validate.ts`; if TypeScript rejects the explicit generics, remove them and let inference work. The test is the contract. Report it.
3. Do not create `app.ts`, `index.ts`, or routes; Task 11 does.
4. Do not weaken any header, limit, or envelope to make a test pass; fix the implementation.
5. LF line endings, 2-space indentation.
6. Verify before claiming; paste real output.
7. Commit exactly once with the given message and trailer.

## Files to create

### `apps/api/test/middleware.test.ts` (FIRST)
```ts
import { describe, expect, test } from "vitest";
import { Hono } from "hono";
import { z } from "zod";
import pino from "pino";
import type { AppEnv } from "../src/env";
import { observability } from "../src/middleware/observability";
import { noStore, securityHeaders } from "../src/middleware/security-headers";
import { MemoryStore, rateLimit } from "../src/middleware/rate-limit";
import { requireSession, sessionStub } from "../src/middleware/session";
import { validate } from "../src/lib/validate";

const silent = pino({ level: "silent" });

function base() {
  const app = new Hono<AppEnv>();
  app.use(observability(silent));
  app.use(securityHeaders, noStore);
  app.use(sessionStub);
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
  test("exposes RateLimit-* headers", async () => {
    const app = base()
      .use(rateLimit({ name: "t", store: new MemoryStore(), limit: 5, windowMs: 1000, key: () => "k" }))
      .get("/x", (c) => c.text("ok"));
    const h = (await app.request("/x")).headers;
    expect(h.get("ratelimit-limit")).toBe("5");
    expect(h.get("ratelimit-remaining")).toBe("4");
  });
});

describe("session stub", () => {
  test("requireSession returns 401 envelope with requestId", async () => {
    const app = base().get("/me", requireSession, (c) => c.text("never"));
    const res = await app.request("/me");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe("unauthenticated");
    expect(body.error.requestId).toBe(res.headers.get("x-request-id"));
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
```

### `apps/api/src/env.ts`
```ts
import type { Logger } from "pino";

export interface Session {
  sessionId: string;
  userId: string;
}

export type AppEnv = {
  Variables: {
    requestId: string;
    log: Logger;
    session: Session | null;
  };
};
```

### `apps/api/src/lib/errors.ts`
```ts
import type { ErrorEnvelope } from "@korbat/contracts";

export function errorBody(code: string, message: string, requestId?: string, details?: unknown): ErrorEnvelope {
  return {
    error: {
      code,
      message,
      ...(requestId ? { requestId } : {}),
      ...(details !== undefined ? { details } : {}),
    },
  };
}
```

### `apps/api/src/middleware/observability.ts`
```ts
import { randomUUID } from "node:crypto";
import { createMiddleware } from "hono/factory";
import type { Logger } from "pino";
import type { AppEnv } from "../env";

/** Request id (never client-supplied), child logger, and one access-log line per request. */
export function observability(logger: Logger) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const requestId = randomUUID();
    const start = performance.now();
    const log = logger.child({ requestId, cfRay: c.req.header("cf-ray") });
    c.set("requestId", requestId);
    c.set("log", log);
    await next();
    c.res.headers.set("x-request-id", requestId);
    log.info(
      { method: c.req.method, path: c.req.path, status: c.res.status, durationMs: Math.round(performance.now() - start) },
      "request",
    );
  });
}
```

### `apps/api/src/middleware/security-headers.ts`
```ts
import { createMiddleware } from "hono/factory";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv } from "../env";

/** The API only ever returns JSON, so the CSP forbids everything. HTML headers for the web app live in the Caddyfile. */
export const securityHeaders = secureHeaders({
  contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"] },
  strictTransportSecurity: "max-age=31536000; includeSubDomains",
  referrerPolicy: "no-referrer",
  crossOriginResourcePolicy: "same-origin",
  crossOriginOpenerPolicy: "same-origin",
  xFrameOptions: "DENY",
  xContentTypeOptions: "nosniff",
  permissionsPolicy: { camera: [], microphone: [], geolocation: [] },
});

export const noStore = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  c.res.headers.set("Cache-Control", "no-store");
});
```

### `apps/api/src/middleware/rate-limit.ts`
```ts
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type Redis from "ioredis";
import type { AppEnv } from "../env";
import { errorBody } from "../lib/errors";

export interface RateLimitStore {
  /** Increments the counter for key and returns the new count plus ms until the window resets. */
  hit(key: string, windowMs: number): Promise<{ count: number; resetMs: number }>;
}

export class MemoryStore implements RateLimitStore {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly now: () => number = Date.now) {}
  async hit(key: string, windowMs: number) {
    const t = this.now();
    const b = this.buckets.get(key);
    if (!b || b.resetAt <= t) {
      this.buckets.set(key, { count: 1, resetAt: t + windowMs });
      return { count: 1, resetMs: windowMs };
    }
    b.count += 1;
    return { count: b.count, resetMs: b.resetAt - t };
  }
}

const LUA = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
return {c, ttl}
`;

type RedisWithHit = Redis & { korbatRateHit(key: string, windowMs: number): Promise<[number, number]> };

export class RedisStore implements RateLimitStore {
  private readonly redis: RedisWithHit;
  constructor(redis: Redis) {
    redis.defineCommand("korbatRateHit", { numberOfKeys: 1, lua: LUA });
    this.redis = redis as RedisWithHit;
  }
  async hit(key: string, windowMs: number) {
    const [count, ttl] = await this.redis.korbatRateHit(`rl:${key}`, windowMs);
    return { count, resetMs: ttl > 0 ? ttl : windowMs };
  }
}

export interface RateLimitOptions {
  name: string;
  store: RateLimitStore;
  limit: number;
  windowMs: number;
  key: (c: Context<AppEnv>) => string;
}

export function rateLimit(opts: RateLimitOptions) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const { count, resetMs } = await opts.store.hit(`${opts.name}:${opts.key(c)}`, opts.windowMs);
    const resetSec = Math.max(1, Math.ceil(resetMs / 1000));
    c.header("RateLimit-Limit", String(opts.limit));
    c.header("RateLimit-Remaining", String(Math.max(0, opts.limit - count)));
    c.header("RateLimit-Reset", String(resetSec));
    if (count > opts.limit) {
      c.header("Retry-After", String(resetSec));
      return c.json(errorBody("rate_limited", "Too many requests", c.get("requestId")), 429);
    }
    await next();
  });
}

/** Cloudflare sets cf-connecting-ip; Caddy forwards it. Anything else is a direct/dev connection. */
export function clientIp(c: Context<AppEnv>): string {
  return c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "direct";
}
```

### `apps/api/src/middleware/session.ts`
```ts
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import { errorBody } from "../lib/errors";

/**
 * Foundation stub: nobody is ever signed in. Sub-project 1 replaces this with
 * cookie (web) and bearer (native) session resolution against auth.sessions.
 * The requireSession contract stays the same.
 */
export const sessionStub = createMiddleware<AppEnv>(async (c, next) => {
  c.set("session", null);
  await next();
});

export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("session")) {
    return c.json(errorBody("unauthenticated", "Sign in required", c.get("requestId")), 401);
  }
  await next();
});
```

### `apps/api/src/lib/validate.ts`
```ts
import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import { z, type ZodType } from "zod";
import type { AppEnv } from "../env";
import { errorBody } from "./errors";

/** zod validation that answers with the shared error envelope instead of Hono's default. */
export function validate<T extends ZodType, Target extends keyof ValidationTargets>(target: Target, schema: T) {
  return zValidator<T, Target, AppEnv>(target, schema, (result, c) => {
    if (!result.success) {
      return c.json(errorBody("invalid_request", "Request validation failed", c.get("requestId"), z.treeifyError(result.error)), 400);
    }
    return undefined;
  });
}
```

## Steps

1. Create the test file.
2. Run `pnpm --filter @korbat/api test`. Expected: `middleware.test.ts` FAILS on unresolved imports; config and logger tests still pass (7).
3. Create `src/env.ts`, `src/lib/errors.ts`, `src/lib/validate.ts`, and the four middleware files.
4. Run `pnpm --filter @korbat/api test`. Expected: `Tests  15 passed` (7 previous + 8 new).
5. Run `pnpm --filter @korbat/api typecheck`. Expected: exits 0. If the only error is in `validate.ts` about `zValidator` generics, apply the fix from Rule 2, re-run tests and typecheck.
6. Commit:
```bash
git add -A && git commit -m "feat(api): observability, security headers, rate limit, session stub, validation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

## Report format

- Files created
- Output of steps 2, 4, 5
- Deviations (especially any change to `validate.ts` typing) and why
- Anything blocked or uncertain
