# korbat Foundation — Task 10 of 16: `@korbat/api` middleware

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-13 with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous social platform where security is half the product. The backend is a self-owned Hono API (TypeScript), the only client of our Postgres and Redis, deployed behind Caddy and a Cloudflare Tunnel. The API returns JSON only. Every request passes through a fixed middleware chain:

- **Observability**: a server-generated request id (never trusted from the client) on every response as `x-request-id` and in every error envelope, a child logger per request, and one access-log line per request.
- **Security headers**: a JSON-only CSP (`default-src 'none'; frame-ancestors 'none'; base-uri 'none'`), HSTS, no-referrer, nosniff, DENY framing, `Cache-Control: no-store`.
- **Rate limiting**: every route is limited. The store is pluggable: in-memory for tests, Redis (atomic Lua) for production. Responses carry `RateLimit-*` headers; 429s carry `Retry-After` and the error envelope.
- **Session**: in the Foundation nobody is signed in. The stub sets `session = null`; `requireSession` answers 401. Sub-project 1 replaces the stub and keeps the `Session` shape and `requireSession` contract.
- **Validation**: bodies and queries are validated with Zod schemas; failures return a 400 envelope with field-level details.

Every error uses `ErrorEnvelope` from `@korbat/contracts`: `{ error: { code, message, requestId?, details? } }`.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0. Docker not needed (tests use the in-memory store).
- Pinned: hono 4.13.5, @hono/zod-validator 0.9.1, zod 4.5.4, ioredis 5.11.1, pino 10.3.1, vitest 4.1.11. All already installed by Task 9.
- `validate.ts` passes five explicit type arguments to `zValidator`. That exact form was verified to typecheck against @hono/zod-validator 0.9.1; other forms were tried and failed. Do not simplify it.

## Preconditions

`git log --oneline -1` must show `feat(api): env config and PII-scrubbing logger`. `pnpm --filter @korbat/api test` passes 7 tests. If `apps/api/src/middleware/` exists, compare with this prompt, fix drift, run steps 4 and 5, and report.

## Rules (read twice)

1. Copy every file below byte for byte.
2. Run every command exactly as written, in order, from the repo root.
3. Compare each command's output with the **Expected** text. A different test count, any unexpected `error TS` or `FAIL` line, or a missing file is a **STOP condition**.
4. On a STOP condition: do not change the given code, do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module`: run `rm -rf node_modules && pnpm install` once from the repo root and repeat the failed command. Record it.
6. Do not create `app.ts`, `index.ts`, or routes; Task 11 does.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Files to create

### `apps/api/test/middleware.test.ts`
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
import { zValidator, type Hook } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import { z, type ZodType } from "zod";
import type { AppEnv } from "../env";
import { errorBody } from "./errors";

/**
 * zod validation for a request target that answers failures with the shared
 * error envelope instead of Hono's default body. The handler reads the parsed
 * value with c.req.valid(target).
 */
export function validate<T extends ZodType, Target extends keyof ValidationTargets>(target: Target, schema: T) {
  const onInvalid: Hook<z.infer<T>, AppEnv, string, Target, {}, T> = (result, c) => {
    if (!result.success) {
      return c.json(errorBody("invalid_request", "Request validation failed", c.get("requestId"), z.treeifyError(result.error)), 400);
    }
    return undefined;
  };
  return zValidator<T, Target, AppEnv, string, typeof onInvalid>(target, schema, onInvalid);
}
```

## Steps

1. Create `apps/api/test/middleware.test.ts`.
2. Run:
   ```bash
   pnpm --filter @korbat/api test
   ```
   Expected: `middleware.test.ts` FAILS with `Failed to resolve import "../src/env"`; the other two files still pass (7 tests). If all pass, STOP.
3. Create `src/env.ts`, `src/lib/errors.ts`, `src/lib/validate.ts`, `src/middleware/observability.ts`, `src/middleware/security-headers.ts`, `src/middleware/rate-limit.ts`, `src/middleware/session.ts`.
4. Run:
   ```bash
   pnpm --filter @korbat/api test
   ```
   Expected: `Test Files  3 passed (3)` and `Tests  14 passed (14)`.
5. Run:
   ```bash
   pnpm --filter @korbat/api typecheck
   ```
   Expected: no `error TS` lines.
6. Commit:
   ```bash
   git add -A && git commit -m "feat(api): observability, security headers, rate limit, session stub, validation

   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
   ```
7. Run `git log --oneline -1`. Expected subject: `feat(api): observability, security headers, rate limit, session stub, validation`.

## Report format (mandatory)

```
TASK 10 REPORT
Files created: <list>
Step 2 output (failure line + Tests line): <paste>
Step 4 output (Test Files + Tests lines): <paste>
Step 5 output: <paste or "clean">
Step 7 output: <paste>
Recovery used (rule 5): yes/no
STOP condition hit: none | <exact output>
```
