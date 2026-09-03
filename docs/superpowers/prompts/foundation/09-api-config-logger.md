# korbat Foundation — Task 9 of 16: `@korbat/api` config and PII-scrubbing logger

You are executing one task of an approved implementation plan. Do this task completely, verify it, commit it, and report. Do nothing beyond it.

## Project context

korbat is a pseudonymous social platform where users who post unpopular opinions are targets, so deanonymisation is a first-class threat. The backend is a self-owned TypeScript API built on Hono, the only process that talks to our Postgres (two pools: `korbat_api` for the public schema, `korbat_auth` for the PII-bearing `auth` schema) and Redis. One design rule from the spec: **logs scrub tokens, emails, and IPs at the logger level**, so no route can accidentally write PII into a log line that ends up in a file, a shipping pipeline, or a screenshot.

This task creates the `@korbat/api` package with two foundations everything else depends on: a fail-fast, typed environment config, and a pino logger whose every line (both the merged object and the message string) passes through a `scrub()` function that masks emails, IPv4/IPv6 addresses, and any value under a secret-bearing key. Later tasks add middleware (10) and the app itself (11).

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0. Docker not needed for this task.
- Pinned: hono 4.13.5, @hono/node-server 2.1.1, @hono/zod-validator 0.9.1, zod 4.5.4, ioredis 5.11.1, pino 10.3.1, pino-pretty 13.1.3, tsup 8.5.1, tsx 4.23.13, vitest 4.1.11, typescript 5.9.3, @types/node 24.13.3. All of them are declared now so the manifest does not change in Tasks 10 and 11.
- Zod 4 notes: `z.url({ protocol: /regex/ })` validates the scheme; `z.prettifyError(error)` returns a readable multi-line string; `z.coerce.number()` coerces env strings.
- pino notes: `formatters.log` receives the merged object of each call; `hooks.logMethod(args, method)` receives the raw arguments (message string included) and must call `method.apply(this, args)`; `base: undefined` removes pid/hostname.
- Full plan: `docs/superpowers/plans/2026-09-03-foundation.md` (Task 9).

## Preconditions

`git log --oneline -1` must show `feat(infra): compose data services, postgres roles bootstrap`. `packages/contracts`, `packages/rules`, `packages/db` exist and `pnpm test` passes (19 tests). If `apps/api/` exists, verify against this prompt, fix drift, run tests, skip to the report.

## Rules

1. Test first for both modules: write both test files, run, see them fail on missing modules, implement, run, see them pass.
2. Exact file contents below. If pino's hook typing rejects `method.apply(this, ...)`, cast the args (`as Parameters<typeof method>`) rather than changing behaviour, and report it.
3. Do not create `src/index.ts`, `src/app.ts`, routes, or middleware in this task.
4. The scrub regexes are part of the security design; do not loosen them. If a test case fails, fix the implementation, not the test.
5. LF line endings, 2-space indentation.
6. Verify before claiming; paste real output.
7. Commit exactly once with the given message and trailer.

## Files to create

### `apps/api/package.json`
```json
{
  "name": "@korbat/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsup",
    "start": "node dist/index.js",
    "typecheck": "tsc -p .",
    "test": "vitest run",
    "test:integration": "INTEGRATION=1 vitest run test/integration"
  },
  "dependencies": {
    "@hono/node-server": "2.1.1",
    "@hono/zod-validator": "0.9.1",
    "@korbat/contracts": "workspace:*",
    "@korbat/db": "workspace:*",
    "@korbat/rules": "workspace:*",
    "hono": "4.13.5",
    "ioredis": "5.11.1",
    "pino": "10.3.1",
    "zod": "4.5.4"
  },
  "devDependencies": {
    "@types/node": "24.13.3",
    "pino-pretty": "13.1.3",
    "tsup": "8.5.1",
    "tsx": "4.23.13",
    "typescript": "5.9.3",
    "vitest": "4.1.11"
  }
}
```

### `apps/api/tsconfig.json`
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "types": ["node"] }, "include": ["src", "test", "tsup.config.ts"] }
```

### `apps/api/test/config.test.ts` (FIRST)
```ts
import { describe, expect, test } from "vitest";
import { loadConfig } from "../src/config";

const good = {
  DATABASE_URL_API: "postgres://korbat_api:x@localhost:5432/korbat",
  DATABASE_URL_AUTH: "postgres://korbat_auth:x@localhost:5432/korbat",
  REDIS_URL: "redis://localhost:6379",
};

describe("loadConfig", () => {
  test("applies defaults", () => {
    const c = loadConfig(good);
    expect(c.PORT).toBe(3000);
    expect(c.NODE_ENV).toBe("development");
    expect(c.TRUSTED_ORIGINS).toEqual([]);
  });
  test("parses trusted origins list", () => {
    expect(loadConfig({ ...good, TRUSTED_ORIGINS: "http://a.test, http://b.test" }).TRUSTED_ORIGINS).toEqual(["http://a.test", "http://b.test"]);
  });
  test("fails loudly on a missing database url", () => {
    expect(() => loadConfig({ REDIS_URL: good.REDIS_URL })).toThrow(/DATABASE_URL_API/);
  });
});
```

### `apps/api/test/logger.test.ts` (FIRST)
```ts
import { describe, expect, test } from "vitest";
import { scrub } from "../src/lib/logger";

describe("scrub", () => {
  test("masks emails and IPs inside strings", () => {
    expect(scrub("user a.b+c@example.com from 203.0.113.9")).toBe("user [email] from [ip]");
    expect(scrub("v6 2001:db8:85a3::8a2e:370:7334 and ::1 and fe80::1")).toBe("v6 [ip] and [ip] and [ip]");
  });
  test("leaves timestamps alone", () => {
    expect(scrub("at 2026-09-03T10:30:45Z")).toBe("at 2026-09-03T10:30:45Z");
  });
  test("redacts secret-bearing keys regardless of value", () => {
    expect(scrub({ authorization: "Bearer abc", cookie: "s=1", password: "p", nested: { token: "t" } })).toEqual({
      authorization: "[redacted]",
      cookie: "[redacted]",
      password: "[redacted]",
      nested: { token: "[redacted]" },
    });
  });
  test("walks arrays and keeps non-strings", () => {
    expect(scrub({ n: 1, ok: true, list: ["x@y.io", 2] })).toEqual({ n: 1, ok: true, list: ["[email]", 2] });
  });
});
```

### `apps/api/src/config.ts`
```ts
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL_API: z.url({ protocol: /^postgres(ql)?$/ }),
  DATABASE_URL_AUTH: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  TRUSTED_ORIGINS: z
    .string()
    .default("")
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)),
  KORBAT_VERSION: z.string().default("0.0.0-dev"),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
```

### `apps/api/src/lib/logger.ts`
```ts
import pino, { type Logger } from "pino";

export type { Logger };

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
// Full form, compressed form with "::", and leading "::" form. Requires "::" or 8 groups so times like 10:30:45 are untouched.
const IPV6 = /(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:){1,7}:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})?|::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})/gi;
const SECRET_KEYS = new Set(["authorization", "cookie", "set-cookie", "password", "token", "secret", "session", "code", "otp"]);

/** Recursively masks emails, IPs, and secret-bearing keys. Applied to every log line. */
export function scrub(value: unknown, key?: string): unknown {
  if (key && SECRET_KEYS.has(key.toLowerCase())) return "[redacted]";
  if (typeof value === "string") return value.replace(EMAIL, "[email]").replace(IPV6, "[ip]").replace(IPV4, "[ip]");
  if (Array.isArray(value)) return value.map((v) => scrub(v));
  if (value && typeof value === "object" && !(value instanceof Error)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrub(v, k);
    return out;
  }
  if (value instanceof Error) return { name: value.name, message: scrub(value.message), stack: value.stack };
  return value;
}

export function createLogger(level: string, pretty = false): Logger {
  return pino({
    level,
    base: undefined,
    formatters: { log: (obj) => scrub(obj) as Record<string, unknown> },
    hooks: {
      logMethod(args, method) {
        const scrubbed = args.map((a) => (typeof a === "string" ? scrub(a) : a));
        return method.apply(this, scrubbed as Parameters<typeof method>);
      },
    },
    ...(pretty ? { transport: { target: "pino-pretty", options: { colorize: true } } } : {}),
  });
}
```

## Steps

1. Create `package.json`, `tsconfig.json`, and both test files.
2. Run `pnpm install`. Expected: dependencies installed, lockfile updated.
3. Run `pnpm --filter @korbat/api test`. Expected: both files FAIL with unresolved `../src/config` and `../src/lib/logger`.
4. Create `src/config.ts` and `src/lib/logger.ts`.
5. Run `pnpm --filter @korbat/api test`. Expected: `Tests  7 passed`.
6. Run `pnpm --filter @korbat/api typecheck`. Expected: exits 0.
7. Live sanity check of the logger (no DB needed):
   ```bash
   cd apps/api && npx tsx -e "import('./src/lib/logger.ts').then(({createLogger}) => { const l = createLogger('info'); l.info({ email: 'me@x.io', ip: '203.0.113.5', authorization: 'Bearer zzz' }, 'hello from 10.0.0.1'); })" && cd ../..
   ```
   Expected: one JSON line where `email` is `[email]`, `ip` is `[ip]`, `authorization` is `[redacted]`, and `msg` is `hello from [ip]`.
8. Commit:
```bash
git add -A && git commit -m "feat(api): env config and PII-scrubbing logger

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

## Report format

- Files created
- Output of steps 3, 5, 6, and the JSON line from step 7
- Deviations and why
- Anything blocked or uncertain
