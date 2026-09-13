# korbat Foundation — Task 2 of 16: `@korbat/contracts`

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-13 with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous social platform with a self-owned backend (Hono + Drizzle TypeScript API, own Postgres, Redis, MinIO, Docker Compose behind a Cloudflare Tunnel) and an Expo client. `@korbat/contracts` is the single source of truth for every request and response shape: the API validates input with these Zod schemas and types its responses with them, and the Expo app parses responses with the same schemas. A field that is not in a contract cannot leak out of the API. This task creates the package with the three schemas the Foundation needs.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0. Docker not needed.
- Pinned: zod 4.5.4, vitest 4.1.11, typescript 5.9.3.

## Preconditions

`git log --oneline -1` must show `chore: scaffold pnpm workspace`. `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `tsconfig.base.json` exist at the root. If `packages/contracts/` already exists, compare with this prompt, fix drift, run steps 5 to 7, and report.

## Rules (read twice)

1. Copy every file below byte for byte. Do not reformat, reorder, rename, add comments, or "improve".
2. Run every command exactly as written, in order, from the repo root.
3. Compare each command's output with the **Expected** text. Cosmetic differences are fine: timings, colours, the pnpm progress line, the line `npm warn Unknown project config "node-linker"`, git's CRLF warnings. A different test count, any line containing `error`, `ERR_`, or `FAIL` where none is expected, or a missing file is a **STOP condition**.
4. On a STOP condition: do not change the given code, do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module`: run `rm -rf node_modules && pnpm install` once from the repo root and repeat the failed command. Record it in the report.
6. Never commit `.env` files or `node_modules`.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

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

### `packages/contracts/test/contracts.test.ts`
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

### `packages/contracts/src/index.ts`
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

1. Create `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, and `packages/contracts/test/contracts.test.ts`. Do not create `src/index.ts` yet.
2. Run:
   ```bash
   pnpm install
   ```
   Expected: ends with `Done in <time> using pnpm v10.30.0`.
3. Run:
   ```bash
   pnpm --filter @korbat/contracts test
   ```
   Expected: the run FAILS with `Error: Failed to resolve import "../src/index"` (or `Cannot find module`). This proves the test is real. If it passes here, that is a STOP condition.
4. Create `packages/contracts/src/index.ts`.
5. Run:
   ```bash
   pnpm --filter @korbat/contracts test
   ```
   Expected: `Test Files  1 passed (1)` and `Tests  6 passed (6)`.
6. Run:
   ```bash
   pnpm --filter @korbat/contracts typecheck
   ```
   Expected: no `error TS` lines; the command ends with `Done` or silently with exit code 0.
7. Run:
   ```bash
   pnpm typecheck && pnpm test
   ```
   Expected: both succeed; the test summary shows `Tests  6 passed (6)` for contracts.
8. Commit:
   ```bash
   git add -A && git commit -m "feat(contracts): error envelope, health and pagination schemas

   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
   ```
9. Run `git log --oneline -1`. Expected subject: `feat(contracts): error envelope, health and pagination schemas`.

## Report format (mandatory)

```
TASK 2 REPORT
Files created: <list>
Step 3 output (the failure line): <paste>
Step 5 output (Tests line): <paste>
Step 6 output: <paste or "clean">
Step 9 output: <paste>
Recovery used (rule 5): yes/no
STOP condition hit: none | <exact output>
```
