# korbat Foundation — Task 1 of 16: Repository root scaffold

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-13 with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous social platform: people post opinions under a handle, and content is only ever removed for one of six public rules (sexual content, CSAM, targeted hatred on protected traits, doxxing, direct threats, spam), always by a human who writes a reason the author can read and appeal. Security and transparent moderation are each half of the product's focus. The backend is fully self-owned: a TypeScript API (Hono + Drizzle) in front of our own Postgres, Redis, and MinIO, packaged with Docker Compose and exposed only through a Cloudflare Tunnel. The client is an Expo app, web first.

Sub-project 0 ("Foundation") builds the skeleton. This task creates the repository root that every later task builds on.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, git branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0, git 2.52. Docker is not needed for this task.
- The repo currently contains `.gitignore` and the `docs/` folder only.

## Preconditions

Run `git log --oneline -1`. Expected subject: `docs: self-contained execution prompts for foundation tasks 1-16` (or a later docs commit). If `package.json` already exists at the root, this task was already done: compare every file with the content below, fix any drift, and skip to the report.

## Rules (read twice)

1. Copy every file below byte for byte. Do not reformat, reorder, rename, add comments, or "improve". The only edits allowed are the ones this prompt names.
2. Run every command exactly as written, in order, from the repo root.
3. Compare each command's output with the **Expected** text. Cosmetic differences are fine: timings, random ids, colours, the pnpm progress line, the line `npm warn Unknown project config "node-linker"`, and git's `LF will be replaced by CRLF` warnings. A different count, any line containing `error`, `ERR_`, or `FAIL`, or a missing file is a **STOP condition**.
4. On a STOP condition: do not change the given code, do not try alternatives, do not search the web. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module`: run `rm -rf node_modules && pnpm install` once from the repo root and repeat the failed command. Record that you did this in the report.
6. Never commit `.env` files or `node_modules`.
7. Commit exactly once, at the end, with the exact message given. Do not amend.
8. The report format at the bottom is mandatory.

## Files to create

### `package.json`
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
    "typescript": "5.9.3"
  },
  "pnpm": {
    "onlyBuiltDependencies": ["esbuild"]
  }
}
```
(`onlyBuiltDependencies` tells pnpm 10 that esbuild's install script is approved; without it pnpm prints an "Ignored build scripts" warning on every install.)

### `pnpm-workspace.yaml`
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

### `.npmrc`
```
node-linker=hoisted
```
(Expo requires a flat `node_modules`.)

### `tsconfig.base.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "noEmit": true
  }
}
```

### `.gitattributes`
```
* text=auto eol=lf
*.sh text eol=lf
```

### `.editorconfig`
```
root = true
[*]
end_of_line = lf
insert_final_newline = true
charset = utf-8
indent_style = space
indent_size = 2
```

### `README.md`
````markdown
# korbat

Pseudonymous social platform with a narrow public rulebook and transparent moderation. Self-hosted.

- Design spec: `docs/superpowers/specs/2026-09-03-korbat-design.md`
- Plans: `docs/superpowers/plans/`

## Dev quick start
```bash
pnpm install
cp infra/.env.example infra/.env            # then edit passwords
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis minio minio-init migrate
pnpm --filter @korbat/api dev               # http://localhost:3000/api/health
pnpm --filter @korbat/app web               # http://localhost:8081
```
````

### `.gitignore` (append these four lines to the existing file; keep what is there)
```
.expo/
web-build/
apps/app/dist/
infra/.env
```

## Steps

1. Create the six files and append to `.gitignore`.
2. Run:
   ```bash
   pnpm install
   ```
   Expected: ends with `Done in <time> using pnpm v10.30.0`. A `pnpm-lock.yaml` now exists.
3. Run:
   ```bash
   npx tsc --version
   ```
   Expected: `Version 5.9.3`
4. Run:
   ```bash
   git status --short
   ```
   Expected: exactly these entries (order may differ): `M .gitignore`, `?? .editorconfig`, `?? .gitattributes`, `?? .npmrc`, `?? README.md`, `?? package.json`, `?? pnpm-lock.yaml`, `?? pnpm-workspace.yaml`, `?? tsconfig.base.json`. `node_modules/` must not appear.
5. Commit:
   ```bash
   git add -A && git commit -m "chore: scaffold pnpm workspace

   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
   ```
6. Run `git log --oneline -1`. Expected subject: `chore: scaffold pnpm workspace`.

## Report format (mandatory)

```
TASK 1 REPORT
Files created: <list>
Step 2 output (last line): <paste>
Step 3 output: <paste>
Step 4 output: <paste>
Step 6 output: <paste>
Recovery used (rule 5): yes/no
STOP condition hit: none | <exact output>
```
