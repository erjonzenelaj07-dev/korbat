# korbat Foundation — Task 1 of 16: Repository root scaffold

You are executing one task of an approved implementation plan. Do this task completely, verify it, commit it, and report. Do nothing beyond it.

## Project context

korbat is a pseudonymous social platform: people post opinions under a handle, and content is only ever removed for one of six public rules (sexual content, CSAM, targeted hatred on protected traits, doxxing, direct threats, spam), always by a human who writes a reason the author can read and appeal. Security and transparent moderation are each half of the product's focus. The backend is fully self-owned: a TypeScript API (Hono + Drizzle) in front of our own Postgres, Redis, and MinIO, packaged with Docker Compose and exposed only through a Cloudflare Tunnel, so it can run on a VPS now and on the owner's home server later. The client is an Expo app, web first.

Sub-project 0 ("Foundation") builds the skeleton: a pnpm monorepo with shared packages (`contracts`, `rules`, `db`), an API skeleton with security middleware and a health endpoint, a worker skeleton, an Expo web shell, the Compose stack, CI, and the tunnel. This task creates the repository root that every later task builds on.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, git branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0, git 2.52. Docker is not needed for this task.
- The repo currently contains only `.gitignore`, `docs/superpowers/specs/2026-09-03-korbat-design.md` (the design spec), `docs/superpowers/plans/2026-09-03-foundation.md` (the full plan; this prompt is its Task 1), and `docs/superpowers/prompts/`.

## Preconditions

Run `git log --oneline`. It must show the commit `docs: foundation (sub-project 0) implementation plan`. If `package.json` already exists at the root, this task was already done: verify it matches the content below, fix any drift, and skip to the report.

## Rules

1. Use the exact file contents given below. Do not add tooling, linters, or scripts that are not listed; later tasks add what they need.
2. Do not create any package under `apps/` or `packages/` in this task.
3. All files use LF line endings and 2-space indentation.
4. Verify before claiming: run each verification command and compare against the expected output. Paste real output in your report.
5. Commit exactly once at the end with the given message, including the trailer line.

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
  }
}
```

### `pnpm-workspace.yaml`
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

### `.npmrc`
Expo requires a flat `node_modules`, so the whole workspace uses the hoisted linker.
```
node-linker=hoisted
```

### `tsconfig.base.json`
Packages export TypeScript source directly and are consumed by bundlers (tsup, Metro, vitest), hence `moduleResolution: bundler` and `noEmit`.
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

## File to modify

### `.gitignore`
Keep the existing content and append these lines:
```
.expo/
web-build/
apps/app/dist/
infra/.env
```

## Steps

1. Create the six files and append to `.gitignore` exactly as above.
2. Run `pnpm install`.
   Expected: a `pnpm-lock.yaml` is created, `node_modules/typescript` exists, no errors. A warning that no workspace projects were found is fine.
3. Run `npx tsc --version`.
   Expected: `Version 5.9.3`.
4. Run `git status --short`.
   Expected: the new files plus `pnpm-lock.yaml` listed; `node_modules/` absent (ignored).
5. Commit:
```bash
git add -A && git commit -m "chore: scaffold pnpm workspace

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
6. Run `git log --oneline -1` and confirm the subject is `chore: scaffold pnpm workspace`.

## Report format

End with a report containing:
- Files created/modified (paths)
- Output of `pnpm install`, `npx tsc --version`, and `git log --oneline -1`
- Any deviation from this prompt and why
- Anything blocked or uncertain
