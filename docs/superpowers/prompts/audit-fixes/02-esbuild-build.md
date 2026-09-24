# korbat audit fixes — Task 2 of 11: esbuild called directly replaces tsup for the API and worker bundles; the chokidar trust exclusion and the dead .npmrc line go

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-23 and 2026-09-24 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous social platform with a fully self-owned backend. The API and the image worker are bundled into single files for their Docker images. This task replaces tsup, which is in maintenance mode and pinned an esbuild with an open advisory, with esbuild called directly from a short build script per app; the bundles are proven by starting the built API and worker. The only version of chokidar that needed a trust-policy exclusion left the lockfile with tsup, so the exclusion goes too, and a dead line leaves `.npmrc`. The design is `docs/superpowers/specs/2026-09-23-audit-fixes-design.md`, section 2.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- Ports 3000 and 8080 on localhost must be free. Stop any korbat API, worker or web process started from this repository first; never stop other Node processes on the machine, and never touch Docker containers, volumes or images that do not belong to the `korbat` compose project.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. The `install` step runs with `--config.minimum-release-age=0` for that one command, and the `lockfile-age` step then proves that every newly locked version is at least 7 days old. `pnpm-lock.yaml` is written by the install, never by hand. Never edit `pnpm-workspace.yaml` or `.npmrc`, and never add a package this task does not name.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `build(deps): TypeScript 7 for the server side and 6.0 for the app, ioredis 6, hono 4.13.8, zod 4.6.5, argon2 2.2.1, nodemailer 10.0.10 with its own types, nativewind 4.2.7; query-string overridden to 9.5.1 to clear the decoder advisory`.

## Rules (read twice)

1. Never type a file's content. Every step that writes files starts with a `write_blocks.py` command that copies that step's blocks from this prompt file to disk byte for byte; run it exactly as given and check that it names every file of the step. The blocks are shown below it so you can read what was written. Paths with parentheses or square brackets (expo-router routes) are literal; quote them in shell commands.
2. Run every command exactly as written, in order, from the repo root, without adding filters such as `tail` or `head`.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the files

```bash
python docs/superpowers/prompts/audit-fixes/write_blocks.py docs/superpowers/prompts/audit-fixes/02-esbuild-build.md 1
```

Expected: 9 lines starting with `wrote`, one for each file below.

### Create `apps/api/build.mjs`

```js
// Bundles the API for the Docker image. esbuild is called directly: the whole configuration fits here.
import { rm } from "node:fs/promises";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });
await build({
  entryPoints: { index: "src/index.ts", migrate: "src/migrate.ts", "grant-role": "src/cli/grant-role.ts" },
  outdir: "dist",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  sourcemap: true,
  // Everything is bundled except @node-rs/argon2: it loads a platform-specific native binary at
  // runtime, so the Docker image ships it in node_modules next to the bundle.
  packages: "bundle",
  external: ["@node-rs/argon2", "@node-rs/argon2/*"],
  // Bundled CommonJS dependencies call require(); an ES module bundle has to provide it.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: "info",
});
console.log("Build success");
```

### Create `apps/worker/build.mjs`

```js
// Bundles the image worker for the Docker image. esbuild is called directly: the whole configuration fits here.
import { rm } from "node:fs/promises";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });
await build({
  entryPoints: { index: "src/index.ts" },
  outdir: "dist",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  sourcemap: true,
  // Everything is bundled except sharp: it loads a platform-specific native binary at runtime, so
  // the Docker image ships it and its platform packages in node_modules next to the bundle.
  packages: "bundle",
  external: ["sharp", "sharp/*", "@img/*"],
  // Bundled CommonJS dependencies call require(); an ES module bundle has to provide it.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: "info",
});
console.log("Build success");
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
    "build": "node build.mjs",
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
    "esbuild": "0.28.2",
    "tsx": "4.23.13",
    "typescript": "7.0.2",
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
    "build": "node build.mjs",
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
    "esbuild": "0.28.2",
    "tsx": "4.23.13",
    "typescript": "7.0.2",
    "vitest": "4.1.11"
  }
}
```

### Replace `apps/api/tsconfig.json` (whole file)

```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "types": ["node"] }, "include": ["src", "test", "vitest.integration.config.ts"] }
```

### Replace `apps/worker/tsconfig.json` (whole file)

```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "types": ["node"] }, "include": ["src", "test", "vitest.config.ts"] }
```

### Replace `apps/api/src/lib/logger.ts` (whole file)

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
  // worker thread that needs __dirname, which does not exist inside the bundle.
  return pretty ? pino(options, pinoPretty({ colorize: true })) : pino(options);
}
```

### Replace `pnpm-workspace.yaml` (whole file)

```yaml
packages:
  - "apps/*"
  - "packages/*"

# Supply-chain hardening (pnpm >= 10.16). Installs are frozen from here on.
minimumReleaseAge: 10080
trustPolicy: no-downgrade
blockExoticSubdeps: true
# Locked releases that fail the no-downgrade rule although their own maintainers published them:
# maintenance releases of older lines, published without provenance after newer releases had it.
# pnpm re-checks locked versions on some non-frozen installs and not others, so without these
# entries adding any dependency failed at random. A scan of every locked version on 2026-09-21
# found three; chokidar@4.0.3 left the lockfile with tsup on 2026-09-23. Every other version, and
# every new one, is still checked.
trustPolicyExclude:
  - semver@6.3.1 # lukekarrys, 2023-07-10, with 5.7.2; used by Babel
  - ua-parser-js@1.0.41 # faisalman, 2025-08-19, with 0.7.41; used by fbjs
```

### Replace `.npmrc` (whole file)

```text
node-linker=hoisted
```

## Step 2: delete `apps/api/tsup.config.ts`

```bash
git rm -q "apps/api/tsup.config.ts"
```

Expected: no output.

## Step 3: delete `apps/worker/tsup.config.ts`

```bash
git rm -q "apps/worker/tsup.config.ts"
```

Expected: no output.

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
Done in 1.9s using pnpm v10.30.0
```

## Step 5: verify: lockfile-age

```bash
node scripts/check-lockfile-age.mjs --base HEAD
```

Expected output contains:

- `all at least 7 days old`

Observed on the dry run:

```text
0 new package versions since HEAD; all at least 7 days old
```

## Step 6: verify: lockfile

```bash
node -e "const l=require('fs').readFileSync('pnpm-lock.yaml','utf8');console.log('chokidar-4.0.3', /chokidar@4[.]0[.]3/.test(l), 'tsup', /tsup@/.test(l), 'esbuild-0.28.2', /esbuild@0[.]28[.]2/.test(l))"
```

Expected output contains:

- `chokidar-4.0.3 false tsup false esbuild-0.28.2 true`

Observed on the dry run:

```text
chokidar-4.0.3 false tsup false esbuild-0.28.2 true
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

## Step 8: verify: build

```bash
pnpm --filter @korbat/api build && pnpm --filter @korbat/worker build && ls apps/api/dist apps/worker/dist
```

Expected output contains:

- `Build success`
- `grant-role.js`
- `migrate.js`
- `index.js`

Must not contain:

- `error`
- `ERR_PNPM`

Observed on the dry run:

```text
Build success
Build success
grant-role.js
grant-role.js.map
index.js
index.js.map
migrate.js
migrate.js.map
index.js
index.js.map
dist\index.js             2.5mb
dist\grant-role.js        1.7mb
```

## Step 9: verify: api-dist

```bash
mkdir -p .data && (cd apps/api && PORT=3000 node --env-file=.env dist/index.js > ../../.data/api-dist.log 2>&1 & echo $! > ../../.data/api-dist.pid); sleep 8; curl -s -o /dev/null -w 'health=%{http_code}' http://127.0.0.1:3000/api/health; echo; kill $(cat .data/api-dist.pid); sleep 1; grep -c 'api listening' .data/api-dist.log
```

Expected output contains:

- `health=200`
- `1`

Observed on the dry run:

```text
health=200
1
/usr/bin/bash: line 1: ../../.data/api-dist.pid: No such file or directory
```

## Step 10: verify: worker-dist

```bash
mkdir -p .data && (cd apps/worker && timeout 8 node --env-file=.env dist/index.js > ../../.data/worker-dist.log 2>&1; true); grep -o 'worker started' .data/worker-dist.log | head -1
```

Expected output contains:

- `worker started`

Observed on the dry run:

```text
worker started
```

## Step 11: verify: test

```bash
pnpm test
```

Expected output contains:

- `Tests  142 passed | 139 skipped (281)`
- `Tests  45 passed (45)`
- `Tests  9 passed (9)`

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
apps/app test:       Tests  9 passed (9)
apps/worker test:       Tests  45 passed (45)
apps/api test:       Tests  142 passed | 139 skipped (281)
```

## Step 12: verify: audit

```bash
pnpm audit --audit-level high; echo audit-exit=$?
```

Expected output contains:

- `audit-exit=0`

Must not contain:

- `arbitrary file read`

Observed on the dry run:

```text
audit-exit=0
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

- `.npmrc`
- `apps/api/build.mjs`
- `apps/api/package.json`
- `apps/api/src/lib/logger.ts`
- `apps/api/tsconfig.json`
- `apps/api/tsup.config.ts`
- `apps/worker/build.mjs`
- `apps/worker/package.json`
- `apps/worker/tsconfig.json`
- `apps/worker/tsup.config.ts`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`

`git rm` stages the deletion, so `apps/api/tsup.config.ts` and `apps/worker/tsup.config.ts` shows with a `D` in the first column. That line is expected.

## Step 15: commit

```bash
git add -A
git commit -q -m "build: esbuild build scripts replace tsup for the API and the worker; the chokidar@4.0.3 trust exclusion leaves with it, and the dead min-release-age line leaves .npmrc" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `build: esbuild build scripts replace tsup for the API and the worker; the chokidar@4.0.3 trust exclusion leaves with it, and the dead min-release-age line leaves .npmrc`.

## Report format (mandatory)

```text
TASK 2 REPORT
Files written: <count, expected 9>
Verify "install": <paste the expected lines as printed>
Verify "lockfile-age": <paste the expected lines as printed>
Verify "lockfile": <paste the expected lines as printed>
Verify "typecheck": <paste the expected lines as printed>
Verify "build": <paste the expected lines as printed>
Verify "api-dist": <paste the expected lines as printed>
Verify "worker-dist": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "audit": <paste the expected lines as printed>
Verify "frozen-install": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
