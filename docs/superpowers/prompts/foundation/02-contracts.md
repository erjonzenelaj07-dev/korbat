# korbat Foundation — Task 2 of 16: `@korbat/contracts`

You are executing one task of an approved implementation plan. Do this task completely, verify it, commit it, and report. Do nothing beyond it.

## Project context

korbat is a pseudonymous social platform: people post opinions under a handle, and content is only ever removed for one of six public rules, always by a human who writes a reason the author can read and appeal. The backend is a self-owned TypeScript API (Hono + Drizzle) in front of our own Postgres, Redis, and MinIO, packaged with Docker Compose behind a Cloudflare Tunnel. The client is an Expo app, web first.

`@korbat/contracts` is the single source of truth for every request and response shape. The API validates input with these Zod schemas and types its responses with them; the Expo app and the admin console parse responses with the same schemas. A field that is not in a contract cannot leak out of the API, which is how PII minimisation becomes a compile-time property. This task creates the package with the three schemas the Foundation needs: the error envelope, the health response, and pagination.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0. Docker not needed.
- Pinned versions for this task: zod 4.5.4, vitest 4.1.11, typescript 5.9.3. Zod 4 API notes: `z.record(keySchema, valueSchema)` takes two arguments; `z.coerce.number()` is available; `safeParse` returns `{ success, data | error }`.
- Full plan: `docs/superpowers/plans/2026-09-03-foundation.md` (this is its Task 2).

## Preconditions

`git log --oneline -1` must show `chore: scaffold pnpm workspace`. The root must contain `package.json`, `pnpm-workspace.yaml`, `.npmrc` (with `node-linker=hoisted`), and `tsconfig.base.json`. If `packages/contracts/` already exists, verify it matches this prompt, fix drift, run the tests, and skip to the report.

## Rules

1. Test first: write the test file, run it and confirm it fails because the module is missing, then implement, then run again and confirm it passes.
2. Use the exact file contents below. If a pinned library's API differs from the code, keep the test as the contract, make the smallest change that satisfies it, and list the deviation in your report.
3. Do not add schemas beyond the three listed. Later sub-projects add their own.
4. LF line endings, 2-space indentation.
5. Verify before claiming: paste real command output in the report.
6. Commit exactly once at the end with the given message, including the trailer.

## Files to create

### `packages/contracts/package.json`
```json
{
  "name": "@korbat/contracts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc -p .", "test": "vitest run" },
  "dependencies": { "zod": "4.5.4" },
  "devDependencies": { "vitest": "4.1.11", "typescript": "5.9.3" }
}
```

### `packages/contracts/tsconfig.json`
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

### `packages/contracts/test/contracts.test.ts` (write this FIRST)
```ts
import { describe, expect, test } from "vitest";
import { ErrorEnvelope, HealthResponse, Pagination } from "../src/index";

describe("ErrorEnvelope", () => {
  test("accepts a minimal error", () => {
    const r = ErrorEnvelope.safeParse({ error: { code: "not_found", message: "nope" } });
    expect(r.success).toBe(true);
  });
  test("rejects a missing code", () => {
    expect(ErrorEnvelope.safeParse({ error: { message: "nope" } }).success).toBe(false);
  });
});

describe("HealthResponse", () => {
  test("accepts ok with checks", () => {
    const r = HealthResponse.safeParse({ status: "ok", version: "1.2.3", checks: { postgres: "ok", redis: "fail" } });
    expect(r.success).toBe(true);
  });
  test("rejects unknown check state", () => {
    expect(HealthResponse.safeParse({ status: "ok", version: "1", checks: { postgres: "meh" } }).success).toBe(false);
  });
});

describe("Pagination", () => {
  test("defaults limit to 20 and caps at 50", () => {
    expect(Pagination.parse({})).toEqual({ limit: 20 });
    expect(Pagination.safeParse({ limit: 51 }).success).toBe(false);
  });
  test("cursor is optional opaque string", () => {
    expect(Pagination.parse({ cursor: "abc", limit: 5 })).toEqual({ cursor: "abc", limit: 5 });
  });
});
```

### `packages/contracts/src/index.ts` (write this AFTER seeing the test fail)
```ts
import { z } from "zod";

/** Every non-2xx response from the API has this shape. */
export const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

export const CheckState = z.enum(["ok", "fail"]);

export const HealthResponse = z.object({
  status: z.enum(["ok", "degraded"]),
  version: z.string(),
  checks: z.record(z.string(), CheckState),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

/** Keyset pagination query params shared by every list endpoint. */
export const Pagination = z.object({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type Pagination = z.infer<typeof Pagination>;
```

## Steps

1. Create `package.json`, `tsconfig.json`, and the test file.
2. Run `pnpm install`. Expected: zod, vitest, typescript installed; lockfile updated.
3. Run `pnpm --filter @korbat/contracts test`. Expected: FAIL with an error that `../src/index` cannot be resolved. If it passes at this point, something is wrong; stop and investigate.
4. Create `src/index.ts`.
5. Run `pnpm --filter @korbat/contracts test`. Expected: `Tests  6 passed`.
6. Run `pnpm --filter @korbat/contracts typecheck`. Expected: exits 0 with no output.
7. Run `pnpm typecheck && pnpm test` from the root. Expected: both succeed (only this package participates so far).
8. Commit:
```bash
git add -A && git commit -m "feat(contracts): error envelope, health and pagination schemas

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

## Report format

- Files created (paths)
- Output of the failing test run (step 3), the passing test run (step 5), and typecheck (step 6)
- Deviations from this prompt and why
- Anything blocked or uncertain
