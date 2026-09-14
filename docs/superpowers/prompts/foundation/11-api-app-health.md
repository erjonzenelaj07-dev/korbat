# korbat Foundation — Task 11 of 16: `@korbat/api` app factory, health endpoint, entrypoints, build

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-13 with the exact versions named, against real Postgres and Redis containers. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous social platform with a self-owned backend: a Hono (TypeScript) API is the only client of our Postgres (two pools: `korbat_api` for the public schema, `korbat_auth` for the PII `auth` schema) and Redis, deployed with Docker Compose behind Caddy and a Cloudflare Tunnel. Tasks 9 and 10 built the config, the PII-scrubbing logger, and the middleware chain.

This task assembles them: a `createApp(deps)` factory that takes its dependencies so tests run without infrastructure; `GET /api/health` that runs dependency checks and answers 200 `ok` or 503 `degraded` in the `HealthResponse` shape; `GET /api/me` guarded by `requireSession` (401 until sub-project 1); 404 and 500 handlers that emit the error envelope without leaking internals; the production entrypoint wiring real Postgres/Redis with SIGTERM handling; a `migrate` entrypoint for the Docker `migrate` job; a tsup config bundling each entrypoint into one file; and an integration test against the Compose data services. The API is mounted under `/api` because Caddy serves the web app at `/` and proxies `/api/*` on the same origin.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0. **Docker Desktop must be running** with the Task 8 data services up. Check with `docker compose -f infra/compose.yml ps` (postgres and redis `healthy`). If they are down: `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis`.
- Port 3000 on localhost must be free.
- Pinned: hono 4.13.5, @hono/node-server 2.1.1, tsup 8.5.1, tsx 4.23.13, vitest 4.1.11, ioredis 5.11.1 (all installed by Task 9).

## Preconditions

`git log --oneline -1` must show `feat(api): observability, security headers, rate limit, session stub, validation`. `pnpm --filter @korbat/api test` passes 14 tests. If `apps/api/src/app.ts` exists, compare with this prompt, fix drift, run steps 4 to 9, and report.

## Rules (read twice)

1. Copy every file below byte for byte.
2. Run every command exactly as written, in order, from the repo root.
3. Compare each command's output with the **Expected** text. A different test count, an HTTP status other than the one shown, any unexpected `error`, `ERR_`, `error TS`, or `FAIL` line, or a missing file is a **STOP condition**.
4. On a STOP condition: do not change the given code, do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module`: run `rm -rf node_modules && pnpm install` once from the repo root and repeat the failed command. Record it. (Step 8 already does a clean install before the build, because the hoisted `node_modules` was seen to lose transitive files after several incremental installs.)
6. `apps/api/.env` is gitignored; only `.env.example` is committed. Check `git status` before committing.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Files to create

### `apps/api/test/app.test.ts`
```ts
import { describe, expect, test } from "vitest";
import pino from "pino";
import { HealthResponse } from "@korbat/contracts";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { MemoryStore } from "../src/middleware/rate-limit";

const config = loadConfig({
  DATABASE_URL_API: "postgres://a:b@localhost:55432/k",
  DATABASE_URL_AUTH: "postgres://a:b@localhost:55432/k",
  REDIS_URL: "redis://localhost:56379",
  KORBAT_VERSION: "9.9.9",
});

function app(checks: Record<string, () => Promise<void>>) {
  return createApp({ config, logger: pino({ level: "silent" }), rateLimitStore: new MemoryStore(), healthChecks: checks });
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
  test("/api/me is 401 while the session stub is in place", async () => {
    expect((await app({}).request("/api/me")).status).toBe(401);
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
```

### `apps/api/src/routes/health.ts`
```ts
import { Hono } from "hono";
import type { HealthResponse } from "@korbat/contracts";
import type { AppEnv } from "../env";

export type HealthChecks = Record<string, () => Promise<void>>;

export function healthRoutes(checks: HealthChecks, version: string) {
  const r = new Hono<AppEnv>();
  r.get("/", async (c) => {
    const entries = await Promise.all(
      Object.entries(checks).map(async ([name, fn]) => {
        try {
          await fn();
          return [name, "ok"] as const;
        } catch (err) {
          c.get("log").warn({ err, check: name }, "health check failed");
          return [name, "fail"] as const;
        }
      }),
    );
    const ok = entries.every(([, s]) => s === "ok");
    const body: HealthResponse = { status: ok ? "ok" : "degraded", version, checks: Object.fromEntries(entries) };
    return c.json(body, ok ? 200 : 503);
  });
  return r;
}
```

### `apps/api/src/app.ts`
```ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Logger } from "pino";
import type { Config } from "./config";
import type { AppEnv } from "./env";
import { errorBody } from "./lib/errors";
import { observability } from "./middleware/observability";
import { clientIp, rateLimit, type RateLimitStore } from "./middleware/rate-limit";
import { noStore, securityHeaders } from "./middleware/security-headers";
import { requireSession, sessionStub } from "./middleware/session";
import { healthRoutes, type HealthChecks } from "./routes/health";

export interface AppDeps {
  config: Config;
  logger: Logger;
  rateLimitStore: RateLimitStore;
  healthChecks: HealthChecks;
}

export function createApp({ config, logger, rateLimitStore, healthChecks }: AppDeps) {
  const app = new Hono<AppEnv>();

  app.use(observability(logger));
  app.use(securityHeaders, noStore);
  app.use(cors({ origin: config.TRUSTED_ORIGINS, credentials: true }));
  app.use(rateLimit({ name: "global", store: rateLimitStore, limit: 300, windowMs: 60_000, key: clientIp }));
  app.use(sessionStub);

  app.route("/api/health", healthRoutes(healthChecks, config.KORBAT_VERSION));
  app.get("/api/me", requireSession, (c) => c.json({ session: c.get("session") }));

  app.notFound((c) => c.json(errorBody("not_found", "No such route", c.get("requestId")), 404));
  app.onError((err, c) => {
    c.get("log").error({ err }, "unhandled error");
    return c.json(errorBody("internal", "Internal error", c.get("requestId")), 500);
  });

  return app;
}
```

### `apps/api/src/index.ts`
```ts
import { serve } from "@hono/node-server";
import Redis from "ioredis";
import { closeDb, createDb, ping } from "@korbat/db";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { createLogger } from "./lib/logger";
import { RedisStore } from "./middleware/rate-limit";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL, config.NODE_ENV === "development");

const apiDb = createDb(config.DATABASE_URL_API);
const authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
redis.on("error", (err) => logger.error({ err }, "redis error"));

const app = createApp({
  config,
  logger,
  rateLimitStore: new RedisStore(redis),
  healthChecks: {
    postgres_api: () => ping(apiDb),
    postgres_auth: () => ping(authDb),
    redis: async () => { await redis.ping(); },
  },
});

const server = serve({ fetch: app.fetch, port: config.PORT, hostname: "0.0.0.0" }, (info) => {
  logger.info({ port: info.port, version: config.KORBAT_VERSION }, "api listening");
});

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  server.close();
  await Promise.allSettled([closeDb(apiDb), closeDb(authDb), redis.quit()]);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
```

### `apps/api/src/migrate.ts`
```ts
import path from "node:path";
import { runMigrations } from "@korbat/db/migrate";

const url = process.env.DATABASE_URL_MIGRATE;
if (!url) throw new Error("DATABASE_URL_MIGRATE is required");
const folder = path.resolve(process.env.MIGRATIONS_DIR ?? "../../packages/db/migrations");

runMigrations(url, folder)
  .then(() => { console.log(`migrations applied from ${folder}`); })
  .catch((err) => { console.error(err); process.exit(1); });
```

### `apps/api/tsup.config.ts`
```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", migrate: "src/migrate.ts" },
  format: ["esm"],
  platform: "node",
  target: "node24",
  bundle: true,
  noExternal: [/.*/],
  sourcemap: true,
  clean: true,
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
```

### `apps/api/.env.example`
```
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug
DATABASE_URL_API=postgres://korbat_api:change-me-api@localhost:55432/korbat
DATABASE_URL_AUTH=postgres://korbat_auth:change-me-auth@localhost:55432/korbat
DATABASE_URL_MIGRATE=postgres://korbat_migrate:change-me-migrate@localhost:55432/korbat
REDIS_URL=redis://localhost:56379
TRUSTED_ORIGINS=http://localhost:8081
```

### `apps/api/test/integration/health.test.ts`
```ts
import { describe, expect, test } from "vitest";
import Redis from "ioredis";
import { HealthResponse } from "@korbat/contracts";
import { closeDb, createDb, ping } from "@korbat/db";
import pino from "pino";
import { createApp } from "../../src/app";
import { loadConfig } from "../../src/config";
import { RedisStore } from "../../src/middleware/rate-limit";

describe.skipIf(!process.env.INTEGRATION)("integration: health against real services", () => {
  test("all checks ok and redis rate limiting counts", async () => {
    const config = loadConfig();
    const apiDb = createDb(config.DATABASE_URL_API, { max: 1 });
    const authDb = createDb(config.DATABASE_URL_AUTH, { max: 1 });
    const redis = new Redis(config.REDIS_URL);
    try {
      const app = createApp({
        config,
        logger: pino({ level: "silent" }),
        rateLimitStore: new RedisStore(redis),
        healthChecks: { postgres_api: () => ping(apiDb), postgres_auth: () => ping(authDb), redis: async () => { await redis.ping(); } },
      });
      const first = await app.request("/api/health");
      expect(first.status).toBe(200);
      expect(HealthResponse.parse(await first.json()).status).toBe("ok");
      const second = await app.request("/api/health");
      expect(Number(second.headers.get("ratelimit-remaining"))).toBeLessThan(Number(first.headers.get("ratelimit-remaining")));
    } finally {
      await Promise.allSettled([closeDb(apiDb), closeDb(authDb), redis.quit()]);
    }
  });
});
```

## Steps

1. Create `apps/api/test/app.test.ts` only.
2. Run:
   ```bash
   pnpm --filter @korbat/api test
   ```
   Expected: `app.test.ts` FAILS with `Failed to resolve import "../src/app"`; 14 other tests pass. If all pass, STOP.
3. Create `src/routes/health.ts` and `src/app.ts`.
4. Run:
   ```bash
   pnpm --filter @korbat/api test
   ```
   Expected: `Test Files  4 passed (4)` and `Tests  19 passed (19)`.
5. Create `src/index.ts`, `src/migrate.ts`, `tsup.config.ts`, `.env.example`, `test/integration/health.test.ts`. Then run:
   ```bash
   pnpm --filter @korbat/api typecheck
   ```
   Expected: no `error TS` lines.
6. Start the dev server against the Compose services and probe it:
   ```bash
   cp apps/api/.env.example apps/api/.env
   (cd apps/api && set -a && . ./.env && set +a && npx tsx src/index.ts > ../../.dev.log 2>&1 &)
   sleep 7
   curl -si http://localhost:3000/api/health | grep -iE "^HTTP|x-request-id|content-security|cache-control|ratelimit-remaining|^\{"
   curl -si http://localhost:3000/api/me | head -1
   curl -si http://localhost:3000/api/nothing | head -1
   ```
   Expected, in order:
   ```
   HTTP/1.1 200 OK
   cache-control: no-store
   content-security-policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'
   ratelimit-remaining: 299
   x-request-id: <uuid>
   {"status":"ok","version":"0.0.0-dev","checks":{"postgres_api":"ok","postgres_auth":"ok","redis":"ok"}}
   HTTP/1.1 401 Unauthorized
   HTTP/1.1 404 Not Found
   ```
   Then stop the dev server:
   ```bash
   for pid in $(netstat -ano | grep ":3000" | grep LISTENING | awk '{print $5}' | sort -u); do taskkill //PID $pid //F; done
   rm -f .dev.log
   ```
7. Run the integration test:
   ```bash
   (cd apps/api && set -a && . ./.env && set +a && pnpm test:integration)
   ```
   Expected: `Tests  1 passed (1)`.
8. Clean install, then build:
   ```bash
   rm -rf node_modules && pnpm install --frozen-lockfile
   pnpm --filter @korbat/api build
   ls apps/api/dist
   ```
   Expected: `Build success`; `dist/` lists `index.js`, `index.js.map`, `migrate.js`, `migrate.js.map`, and one or more `chunk-*.js` files with maps.
9. Run the bundle in both modes:
   ```bash
   (cd apps/api && set -a && . ./.env && set +a && MIGRATIONS_DIR=../../packages/db/migrations node dist/migrate.js)
   (cd apps/api && set -a && . ./.env && set +a && node dist/index.js > ../../.bundle.log 2>&1 &)
   sleep 4; curl -s http://localhost:3000/api/health; echo; head -c 200 .bundle.log; echo
   for pid in $(netstat -ano | grep ":3000" | grep LISTENING | awk '{print $5}' | sort -u); do taskkill //PID $pid //F; done
   (cd apps/api && set -a && . ./.env && set +a && NODE_ENV=production node dist/index.js > ../../.bundle2.log 2>&1 &)
   sleep 4; curl -s http://localhost:3000/api/health; echo; head -c 200 .bundle2.log; echo
   for pid in $(netstat -ano | grep ":3000" | grep LISTENING | awk '{print $5}' | sort -u); do taskkill //PID $pid //F; done
   rm -f .bundle.log .bundle2.log
   ```
   Expected: `migrations applied from <path>` (nothing new to apply); then the health JSON with all checks `ok` followed by a pretty (coloured) `api listening` log line; then the same health JSON followed by a one-line JSON log `{"level":30,...,"msg":"api listening"}`.
10. Run `git status --short` and confirm neither `apps/api/.env` nor `apps/api/dist/` is listed. Commit:
    ```bash
    git add -A && git commit -m "feat(api): app factory, health endpoint, entrypoints and tsup build

    Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
    ```
11. Run `git log --oneline -1`. Expected subject: `feat(api): app factory, health endpoint, entrypoints and tsup build`.

## Report format (mandatory)

```
TASK 11 REPORT
Files created: <list>
Step 2 output (failure line): <paste>
Step 4 output (Test Files + Tests lines): <paste>
Step 5 output: <paste or "clean">
Step 6 output (all eight lines): <paste>
Step 7 output (Tests line): <paste>
Step 8 output (Build success line + dist listing): <paste>
Step 9 output (both health JSON lines): <paste>
Step 11 output: <paste>
Recovery used (rule 5): yes/no
STOP condition hit: none | <exact output>
```
