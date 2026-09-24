# korbat audit fixes — Task 1 of 11: TypeScript 7 for the server side and 6 for the app, ioredis 6, hono, zod, argon2, nodemailer and nativewind patch releases; query-string overridden past its decoder advisory

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-23 and 2026-09-24 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous social platform with a fully self-owned backend: a Hono API on Node 24, an Expo web app, PostgreSQL and a Redis-compatible store in Docker Compose. On 2026-09-23 the repository was audited before work continued past sub-project 2b, and the audit chose the technologies this batch moves to. This task is the dependency refresh: TypeScript 7 (the native compiler) for the API, the worker and the packages, TypeScript 6.0 for the Expo app (what Expo SDK 57 expects), ioredis 6, hono 4.13.8, zod 4.6.5, argon2 2.2.1, nodemailer 10.0.10 with its own types instead of an outdated definitions package, nativewind 4.2.7, and a workspace override of query-string so that the one `pnpm audit` advisory reaching the web bundle (exponential-time decoding of a malformed link) is gone. A test in the web app proves the override works the way expo-router uses the library and that the lockfile holds no vulnerable version. The design is `docs/superpowers/specs/2026-09-23-audit-fixes-design.md`. Task 10 replaces the query-string override after the dry run's browser check; the test this task adds is rewritten there.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. The `install` step runs with `--config.minimum-release-age=0` for that one command, and the `lockfile-age` step then proves that every newly locked version is at least 7 days old. `pnpm-lock.yaml` is written by the install, never by hand. Never edit `pnpm-workspace.yaml` or `.npmrc`, and never add a package this task does not name.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `docs: audit fixes plan and verified execution prompts`.

## Rules (read twice)

1. Never type a file's content. Every step that writes files starts with a `write_blocks.py` command that copies that step's blocks from this prompt file to disk byte for byte; run it exactly as given and check that it names every file of the step. The blocks are shown below it so you can read what was written. Paths with parentheses or square brackets (expo-router routes) are literal; quote them in shell commands.
2. Run every command exactly as written, in order, from the repo root, without adding filters such as `tail` or `head`.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the tests

```bash
python docs/superpowers/prompts/audit-fixes/write_blocks.py docs/superpowers/prompts/audit-fixes/01-dependencies.md 1
```

Expected: 4 lines starting with `wrote`, one for each file below.

### Create `apps/app/test/query-string.test.ts`

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import queryString from "query-string";
import { describe, expect, test } from "vitest";

// expo-router parses and prints URL query strings through query-string; the workspace overrides it to a
// version whose decoder is not exponential on malformed input (GHSA for decode-uri-component < 0.5.0).
describe("query strings", () => {
  test("parse and stringify behave as expo-router uses them", () => {
    expect(queryString.parse("a=%2F&b=1&c=x%20y")).toEqual({ a: "/", b: "1", c: "x y" });
    expect(queryString.stringify({ b: "1", a: "/" }, { sort: false })).toBe("b=1&a=%2F");
    expect(queryString.parse("")).toEqual({});
  });

  test("the lockfile holds no decode-uri-component below 0.5.0", () => {
    const lock = readFileSync(path.resolve(import.meta.dirname, "..", "..", "..", "pnpm-lock.yaml"), "utf8");
    const versions = [...lock.matchAll(/^ {2}decode-uri-component@([0-9]+)[.]([0-9]+)[.]([0-9]+):/gm)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
    expect(versions.length).toBeGreaterThan(0);
    for (const [major, minor] of versions) expect(major > 0 || minor >= 5).toBe(true);
  });
});
```

### Create `apps/app/src/css.d.ts`

```ts
// The web entry imports the NativeWind stylesheet for its side effect; TypeScript wants the module declared.
declare module "*.css";
```

### Replace `apps/app/vitest.config.mts` (whole file)

```text
import { defineConfig } from "vitest/config";

/**
 * The tests run in Node against react-native-web, which is what `react-native` means in the web
 * build, so they see the HTML a browser gets.
 */
export default defineConfig({
  resolve: { alias: [{ find: /^react-native$/, replacement: "react-native-web" }] },
  test: { environment: "node", include: ["test/**/*.test.{ts,tsx}"] },
});
```

### Replace `apps/app/tsconfig.json` (whole file)

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "types": ["node"],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["**/*.ts", "**/*.tsx", "nativewind-env.d.ts"]
}
```

## Step 2: run the tests and watch them fail

```bash
pnpm --filter @korbat/app test
```

Expected: the command exits with an error, and the output contains:

- `Tests  1 failed | 8 passed (9)`
- `the lockfile holds no decode-uri-component below 0.5.0`

Observed on the dry run:

```text
× the lockfile holds no decode-uri-component below 0.5.0 6ms
Tests  1 failed | 8 passed (9)
FAIL  test/query-string.test.ts > query strings > the lockfile holds no decode-uri-component below 0.5.0
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/audit-fixes/write_blocks.py docs/superpowers/prompts/audit-fixes/01-dependencies.md 3
```

Expected: 8 lines starting with `wrote`, one for each file below.

### Replace `package.json` (whole file)

```json
{
  "name": "korbat",
  "private": true,
  "packageManager": "pnpm@10.30.0",
  "engines": { "node": ">=24" },
  "scripts": {
    "typecheck": "pnpm -r --if-present run typecheck",
    "test": "pnpm -r --if-present run test",
    "build": "pnpm -r --if-present run build"
  },
  "devDependencies": {
    "typescript": "7.0.2"
  },
  "pnpm": {
    "onlyBuiltDependencies": ["esbuild"],
    "overrides": {
      "query-string": "9.5.1"
    }
  }
}
```

### Replace `apps/api/package.json` (whole file)

```json
{
  "name": "@korbat/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch --env-file=.env src/index.ts",
    "build": "tsup",
    "start": "node dist/index.js",
    "typecheck": "tsc -p .",
    "test": "vitest run",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "update:disposable": "node scripts/update-disposable-domains.mjs"
  },
  "dependencies": {
    "@hono/node-server": "2.1.1",
    "@hono/zod-validator": "0.9.1",
    "@korbat/contracts": "workspace:*",
    "@korbat/db": "workspace:*",
    "@korbat/media-protocol": "workspace:*",
    "@korbat/rules": "workspace:*",
    "@node-rs/argon2": "2.2.1",
    "drizzle-orm": "0.45.2",
    "hono": "4.13.8",
    "ioredis": "6.0.0",
    "nodemailer": "10.0.10",
    "pino": "10.3.1",
    "pino-pretty": "13.1.3",
    "uqr": "0.1.3",
    "zod": "4.6.5"
  },
  "devDependencies": {
    "@types/node": "24.13.5",
    "tsup": "8.5.1",
    "tsx": "4.23.13",
    "typescript": "7.0.2",
    "vitest": "4.1.11"
  }
}
```

### Replace `apps/app/package.json` (whole file)

```json
{
  "name": "@korbat/app",
  "version": "0.0.0",
  "private": true,
  "main": "expo-router/entry",
  "scripts": {
    "start": "expo start",
    "web": "expo start --web",
    "export:web": "expo export --platform web",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@korbat/contracts": "workspace:*",
    "@marsidev/react-turnstile": "1.6.1",
    "expo": "57.0.22",
    "expo-constants": "57.0.18",
    "expo-image": "57.0.5",
    "expo-linking": "57.0.10",
    "expo-router": "57.0.21",
    "nativewind": "4.2.7",
    "react": "19.2.3",
    "react-dom": "19.2.3",
    "react-native": "0.86.3",
    "react-native-gesture-handler": "2.32.0",
    "react-native-reanimated": "4.5.1",
    "react-native-safe-area-context": "5.7.0",
    "react-native-screens": "4.26.2",
    "react-native-web": "0.21.2",
    "react-native-worklets": "0.10.1",
    "zod": "4.6.5"
  },
  "devDependencies": {
    "@types/node": "24.13.5",
    "@types/react": "19.2.18",
    "tailwindcss": "3.4.19",
    "typescript": "6.0.3",
    "vitest": "4.1.11"
  }
}
```

### Replace `apps/worker/package.json` (whole file)

```json
{
  "name": "@korbat/worker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch --env-file=.env src/index.ts",
    "build": "tsup",
    "start": "node dist/index.js",
    "typecheck": "tsc -p .",
    "test": "vitest run"
  },
  "dependencies": {
    "@korbat/contracts": "workspace:*",
    "@korbat/media-protocol": "workspace:*",
    "blurhash": "2.0.5",
    "pino": "10.3.1",
    "sharp": "0.35.4",
    "zod": "4.6.5"
  },
  "devDependencies": {
    "@types/node": "24.13.5",
    "tsup": "8.5.1",
    "tsx": "4.23.13",
    "typescript": "7.0.2",
    "vitest": "4.1.11"
  }
}
```

### Replace `packages/contracts/package.json` (whole file)

```json
{
  "name": "@korbat/contracts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc -p .", "test": "vitest run" },
  "dependencies": { "zod": "4.6.5" },
  "devDependencies": { "vitest": "4.1.11", "typescript": "7.0.2" }
}
```

### Replace `packages/db/package.json` (whole file)

```json
{
  "name": "@korbat/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./migrate": "./src/migrate.ts"
  },
  "scripts": {
    "typecheck": "tsc -p .",
    "test": "vitest run",
    "generate": "drizzle-kit generate",
    "generate:custom": "drizzle-kit generate --custom"
  },
  "dependencies": {
    "drizzle-orm": "0.45.2",
    "postgres": "3.4.9"
  },
  "devDependencies": {
    "@types/node": "24.13.5",
    "drizzle-kit": "0.31.10",
    "typescript": "7.0.2",
    "vitest": "4.1.11"
  }
}
```

### Replace `packages/media-protocol/package.json` (whole file)

```json
{
  "name": "@korbat/media-protocol",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc -p .", "test": "vitest run" },
  "dependencies": { "@korbat/contracts": "workspace:*", "zod": "4.6.5" },
  "devDependencies": { "@types/node": "24.13.5", "typescript": "7.0.2", "vitest": "4.1.11" }
}
```

### Replace `packages/rules/package.json` (whole file)

```json
{
  "name": "@korbat/rules",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc -p .", "test": "vitest run" },
  "devDependencies": { "vitest": "4.1.11", "typescript": "7.0.2" }
}
```

## Step 4: verify: install

```bash
pnpm install --config.minimum-release-age=0
```

Expected output contains:

- `Done in`

Must not contain:

- `ERR_PNPM`

Observed on the dry run:

```text
Done in 2s using pnpm v10.30.0
```

## Step 5: verify: lockfile-age

```bash
node scripts/check-lockfile-age.mjs --base HEAD
```

Expected output contains:

- `all at least 7 days old`

Observed on the dry run:

```text
48 new package versions since HEAD; all at least 7 days old
```

## Step 6: verify: versions

```bash
node -e "const v=p=>JSON.parse(require('fs').readFileSync(p+'/package.json','utf8')).version;console.log('typescript',v('node_modules/typescript'),'app-typescript',v('apps/app/node_modules/typescript'),'ioredis',v('node_modules/ioredis'),'hono',v('node_modules/hono'),'zod',v('node_modules/zod'),'query-string',v('node_modules/query-string'),'decode-uri-component',v('node_modules/decode-uri-component'))"
```

Expected output contains:

- `typescript 7.0.2 app-typescript 6.0.3 ioredis 6.0.0 hono 4.13.8 zod 4.6.5 query-string 9.5.1 decode-uri-component 0.5.0`

Observed on the dry run:

```text
typescript 7.0.2 app-typescript 6.0.3 ioredis 6.0.0 hono 4.13.8 zod 4.6.5 query-string 9.5.1 decode-uri-component 0.5.0
```

## Step 7: verify: typecheck

```bash
pnpm typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`
- `ERR_PNPM`

Observed on the dry run:

```text
(no output)
```

## Step 8: verify: test

```bash
pnpm test
```

Expected output contains:

- `Tests  142 passed | 139 skipped (281)`
- `Tests  45 passed (45)`
- `Tests  9 passed (9)`
- `Tests  44 passed (44)`
- `Tests  21 passed (21)`
- `Tests  18 passed (18)`
- `Tests  4 passed (4)`

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
packages/rules test:       Tests  4 passed (4)
packages/db test:       Tests  18 passed (18)
packages/contracts test:       Tests  44 passed (44)
packages/media-protocol test:       Tests  21 passed (21)
apps/app test:       Tests  9 passed (9)
apps/worker test:       Tests  45 passed (45)
apps/api test:       Tests  142 passed | 139 skipped (281)
```

## Step 9: verify: audit

```bash
pnpm audit --audit-level high; echo audit-exit=$?
```

Expected output contains:

- `audit-exit=0`

Must not contain:

- `decode-uri-component`

Observed on the dry run:

```text
audit-exit=0
```

## Step 10: verify: build

```bash
pnpm --filter @korbat/api build && pnpm --filter @korbat/worker build
```

Expected output contains:

- `Build success`

Must not contain:

- `error`

Observed on the dry run:

```text
ESM ⚡️ Build success in 285ms
ESM ⚡️ Build success in 116ms
```

## Step 11: verify: integration

```bash
node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml && cd apps/api && pnpm test:integration
```

Expected output contains:

- `Tests  138 passed (138)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  138 passed (138)
```

## Step 12: verify: export

```bash
(cd apps/app && EXPO_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA npx expo export --platform web 2>&1 | tail -8)
```

Expected output contains:

- `Exported`

Must not contain:

- `Error`
- `error:`

Allowed difference: The web export runs a full Metro bundle and can take a few minutes.

Observed on the dry run:

```text
Exported: dist
```

## Step 13: verify: frozen-install

```bash
pnpm install --frozen-lockfile
```

Expected output contains:

- `Done in`

Must not contain:

- `ERR_PNPM`

Observed on the dry run:

```text
Done in 2s using pnpm v10.30.0
```

## Step 14: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/package.json`
- `apps/app/package.json`
- `apps/app/src/css.d.ts`
- `apps/app/test/query-string.test.ts`
- `apps/app/tsconfig.json`
- `apps/app/vitest.config.mts`
- `apps/worker/package.json`
- `package.json`
- `packages/contracts/package.json`
- `packages/db/package.json`
- `packages/media-protocol/package.json`
- `packages/rules/package.json`
- `pnpm-lock.yaml`

## Step 15: commit

```bash
git add -A
git commit -q -m "build(deps): TypeScript 7 for the server side and 6.0 for the app, ioredis 6, hono 4.13.8, zod 4.6.5, argon2 2.2.1, nodemailer 10.0.10 with its own types, nativewind 4.2.7; query-string overridden to 9.5.1 to clear the decoder advisory" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `build(deps): TypeScript 7 for the server side and 6.0 for the app, ioredis 6, hono 4.13.8, zod 4.6.5, argon2 2.2.1, nodemailer 10.0.10 with its own types, nativewind 4.2.7; query-string overridden to 9.5.1 to clear the decoder advisory`.

## Report format (mandatory)

```text
TASK 1 REPORT
Files written: <count, expected 12>
Failing-test step (the error line): <paste>
Verify "install": <paste the expected lines as printed>
Verify "lockfile-age": <paste the expected lines as printed>
Verify "versions": <paste the expected lines as printed>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "audit": <paste the expected lines as printed>
Verify "build": <paste the expected lines as printed>
Verify "integration": <paste the expected lines as printed>
Verify "export": <paste the expected lines as printed>
Verify "frozen-install": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
