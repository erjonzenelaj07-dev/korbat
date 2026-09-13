# korbat Foundation — Task 9 of 16: `@korbat/api` config and PII-scrubbing logger

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-13 with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous social platform where users who post unpopular opinions are targets, so deanonymisation is a first-class threat. The backend is a self-owned TypeScript API built on Hono, the only process that talks to our Postgres (two pools: `korbat_api` for the public schema, `korbat_auth` for the PII-bearing `auth` schema) and Redis. One design rule: **logs scrub tokens, emails, and IPs at the logger level**, so no route can accidentally write PII into a log line.

This task creates the `@korbat/api` package with a fail-fast typed environment config and a pino logger whose every line (merged object and message string) passes through `scrub()`. Later tasks add middleware (10) and the app (11).

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0. Docker not needed for this task.
- Pinned: hono 4.13.5, @hono/node-server 2.1.1, @hono/zod-validator 0.9.1, zod 4.5.4, ioredis 5.11.1, pino 10.3.1, pino-pretty 13.1.3, tsup 8.5.1, tsx 4.23.13, vitest 4.1.11, typescript 5.9.3, @types/node 24.13.3. All are declared now so the manifest does not change in Tasks 10 and 11.
- `pino-pretty` is a runtime dependency on purpose: it is used as an in-process stream in development. A pino *transport* would spawn a worker thread that needs `__dirname`, which does not exist inside the tsup bundle built in Task 11; the stream form works in both.

## Preconditions

`git log --oneline -1` must show `feat(infra): compose data services, postgres roles bootstrap`. `pnpm test` passes 19 tests across contracts, rules, db. If `apps/api/` exists, compare with this prompt, fix drift, run steps 5 to 7, and report.

## Rules (read twice)

1. Copy every file below byte for byte. The scrub regexes are part of the security design.
2. Run every command exactly as written, in order, from the repo root.
3. Compare each command's output with the **Expected** text. Cosmetic differences are fine. A different test count, any unexpected `error TS`, `ERR_`, or `FAIL` line, or a missing file is a **STOP condition**.
4. On a STOP condition: do not change the given code, do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module`: run `rm -rf node_modules && pnpm install` once from the repo root and repeat the failed command. Record it.
6. Do not create `src/index.ts`, `src/app.ts`, routes, or middleware in this task.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

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
    "pino-pretty": "13.1.3",
    "zod": "4.5.4"
  },
  "devDependencies": {
    "@types/node": "24.13.3",
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

### `apps/api/test/config.test.ts`
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

### `apps/api/test/logger.test.ts`
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
import pino, { type Logger, type LoggerOptions } from "pino";
import pinoPretty from "pino-pretty";

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
  const options: LoggerOptions = {
    level,
    base: undefined,
    formatters: { log: (obj) => scrub(obj) as Record<string, unknown> },
    hooks: {
      logMethod(args, method) {
        const scrubbed = args.map((a) => (typeof a === "string" ? scrub(a) : a));
        return method.apply(this, scrubbed as Parameters<typeof method>);
      },
    },
  };
  // pino-pretty is used as an in-process stream, not a transport: transports spawn a
  // worker thread that needs __dirname, which does not exist inside the tsup bundle.
  return pretty ? pino(options, pinoPretty({ colorize: true })) : pino(options);
}
```

## Steps

1. Create `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/test/config.test.ts`, `apps/api/test/logger.test.ts`. Do not create the `src/` files yet.
2. Run:
   ```bash
   pnpm install
   ```
   Expected: ends with `Done in <time> using pnpm v10.30.0`.
3. Run:
   ```bash
   pnpm --filter @korbat/api test
   ```
   Expected: both test files FAIL with `Failed to resolve import` for `../src/config` and `../src/lib/logger`. If they pass, STOP.
4. Create `apps/api/src/config.ts` and `apps/api/src/lib/logger.ts`.
5. Run:
   ```bash
   pnpm --filter @korbat/api test
   ```
   Expected: `Test Files  2 passed (2)` and `Tests  7 passed (7)`.
6. Run:
   ```bash
   pnpm --filter @korbat/api typecheck
   ```
   Expected: no `error TS` lines.
7. Live check of the scrubbing (no database needed):
   ```bash
   cd apps/api && npx tsx -e "import('./src/lib/logger.ts').then(({createLogger}) => { const l = createLogger('info'); l.info({ email: 'me@x.io', ip: '203.0.113.5', authorization: 'Bearer zzz' }, 'hello from 10.0.0.1'); })" && cd ../..
   ```
   Expected: one JSON line equal to (apart from the `time` value):
   `{"level":30,"time":<number>,"email":"[email]","ip":"[ip]","authorization":"[redacted]","msg":"hello from [ip]"}`
8. Commit:
   ```bash
   git add -A && git commit -m "feat(api): env config and PII-scrubbing logger

   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
   ```
9. Run `git log --oneline -1`. Expected subject: `feat(api): env config and PII-scrubbing logger`.

## Report format (mandatory)

```
TASK 9 REPORT
Files created: <list>
Step 3 output (the two failure lines): <paste>
Step 5 output (Test Files + Tests lines): <paste>
Step 6 output: <paste or "clean">
Step 7 output (the JSON line): <paste>
Step 9 output: <paste>
Recovery used (rule 5): yes/no
STOP condition hit: none | <exact output>
```
