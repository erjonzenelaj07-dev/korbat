# korbat — Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The defects the 2026-09-23 audit found are fixed with tests, and the stack moves to the technologies the audit chose: TypeScript 7 (6 for the app), esbuild, ioredis 6, PostgreSQL 18, Valkey, pinned images and a non-root Caddy.

**Architecture:** Nine commits, one per area: dependencies, the build, the auth module, request identity and configuration guards, background jobs with retention and media safety, the social module with its indexes, the web client, the infrastructure, and the documentation. Each fix starts with a failing test.

**Tech Stack:** Node 24, TypeScript 7.0.2 (6.0.3 in the Expo app), esbuild 0.28.2, Hono 4.13.8, zod 4.6.5, ioredis 6, PostgreSQL 18, Valkey 9.1, Caddy 2.11, vitest 4.1.11.

**Complete code:** each task's full files, commands and observed output are in `docs/superpowers/prompts/audit-fixes/NN-<slug>.md`, generated from a verified dry run. This plan is the map. Where it and a prompt differ, the prompt wins.

**Spec:** `docs/superpowers/specs/2026-09-23-audit-fixes-design.md`.

---

## File structure

- `apps/api/`: `build.mjs` (Task 2)
- `apps/api/src/auth/`: `client-ip.ts` (Task 4), `janitor.ts` (Task 5)
- `apps/api/src/auth/flows/`: `notify.ts` (Task 3), `not-me.ts` (Task 3)
- `apps/api/src/lib/`: `jobs.ts` (Task 5)
- `apps/api/test/`: `jobs.test.ts` (Task 5)
- `apps/api/test/auth/`: `limits.test.ts` (Task 3)
- `apps/api/test/integration/`: `auth-janitor.test.ts` (Task 5)
- `apps/api/test/mail/`: `smtp.test.ts` (Task 4)
- `apps/app/public/`: `index.html` (Task 7)
- `apps/app/src/`: `css.d.ts` (Task 1)
- `apps/app/src/lib/`: `links.ts` (Task 7)
- `apps/app/test/`: `query-string.test.ts` (Task 1)
- `apps/worker/`: `build.mjs` (Task 2)
- `packages/contracts/src/`: `text.ts` (Task 6)
- `packages/db/migrations/`: `0007_auth_purge_events.sql` (Task 5)
- `patches/`: `query-string@7.1.3.patch` (Task 10)
- `scripts/`: `pg-major-upgrade.mjs` (Task 8)

## Tasks

### Task 1: TypeScript 7 for the server side and 6 for the app, ioredis 6, hono, zod, argon2, nodemailer and nativewind patch releases; query-string overridden past its decoder advisory

**Prompt:** `docs/superpowers/prompts/audit-fixes/01-dependencies.md`

**Files:**
- Create: `apps/app/test/query-string.test.ts`
- Create: `apps/app/src/css.d.ts`
- Modify: `package.json`
- Modify: `apps/api/package.json`
- Modify: `apps/app/package.json`
- Modify: `apps/worker/package.json`
- Modify: `packages/contracts/package.json`
- Modify: `packages/db/package.json`
- Modify: `packages/media-protocol/package.json`
- Modify: `packages/rules/package.json`
- Modify: `apps/app/vitest.config.mts`
- Modify: `apps/app/tsconfig.json`
- Updated by the install step: `pnpm-lock.yaml`

- [ ] **Step 1: Write the failing tests: `apps/app/test/query-string.test.ts`, `apps/app/src/css.d.ts`, `apps/app/vitest.config.mts`, `apps/app/tsconfig.json`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm --filter @korbat/app test`, expecting `Tests  1 failed | 8 passed (9)`, `the lockfile holds no decode-uri-component below 0.5.0`**
- [ ] **Step 3: Write the implementation: `package.json`, `apps/api/package.json`, `apps/app/package.json`, `apps/worker/package.json`, `packages/contracts/package.json`, `packages/db/package.json`, `packages/media-protocol/package.json`, `packages/rules/package.json`**
- [ ] **Step 4: install: run `pnpm install --config.minimum-release-age=0`, expecting `Done in`**
- [ ] **Step 5: lockfile-age: run `node scripts/check-lockfile-age.mjs --base HEAD`, expecting `all at least 7 days old`**
- [ ] **Step 6: versions: run the `versions` command in the prompt, expecting `typescript 7.0.2 app-typescript 6.0.3 ioredis 6.0.0 hono 4.13.8 zod 4.6.5 query-string 9.5.1 decode-uri-component 0.5.0`**
- [ ] **Step 7: typecheck: run `pnpm typecheck`**
- [ ] **Step 8: test: run `pnpm test`, expecting `Tests  142 passed | 139 skipped (281)`, `Tests  45 passed (45)`, `Tests  9 passed (9)`, `Tests  44 passed (44)`, `Tests  21 passed (21)`, `Tests  18 passed (18)`, `Tests  4 passed (4)`**
- [ ] **Step 9: audit: run `pnpm audit --audit-level high; echo audit-exit=$?`, expecting `audit-exit=0`**
- [ ] **Step 10: build: run `pnpm --filter @korbat/api build && pnpm --filter @korbat/worker build`, expecting `Build success`**
- [ ] **Step 11: integration: run `node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml && cd apps/api && pnpm test:integration`, expecting `Tests  138 passed (138)`**
- [ ] **Step 12: export: run `(cd apps/app && EXPO_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA npx expo export --platform web 2>&1 | tail -8)`, expecting `Exported`**
- [ ] **Step 13: frozen-install: run `pnpm install --frozen-lockfile`, expecting `Done in`**
- [ ] **Step 14: Commit: `build(deps): TypeScript 7 for the server side and 6.0 for the app, ioredis 6, hono 4.13.8, zod 4.6.5, argon2 2.2.1, nodemailer 10.0.10 with its own types, nativewind 4.2.7; query-string overridden to 9.5.1 to clear the decoder advisory`**

### Task 2: esbuild called directly replaces tsup for the API and worker bundles; the chokidar trust exclusion and the dead .npmrc line go

**Prompt:** `docs/superpowers/prompts/audit-fixes/02-esbuild-build.md`

**Files:**
- Create: `apps/api/build.mjs`
- Create: `apps/worker/build.mjs`
- Modify: `apps/api/package.json`
- Modify: `apps/worker/package.json`
- Modify: `apps/api/tsconfig.json`
- Modify: `apps/worker/tsconfig.json`
- Modify: `apps/api/src/lib/logger.ts`
- Modify: `pnpm-workspace.yaml`
- Modify: `.npmrc`
- Updated by the install step: `pnpm-lock.yaml`
- Delete: `apps/api/tsup.config.ts`
- Delete: `apps/worker/tsup.config.ts`

- [ ] **Step 1: Write the files: `apps/api/build.mjs`, `apps/worker/build.mjs`, `apps/api/package.json`, `apps/worker/package.json`, `apps/api/tsconfig.json`, `apps/worker/tsconfig.json`, `apps/api/src/lib/logger.ts`, `pnpm-workspace.yaml`, `.npmrc`**
- [ ] **Step 2: Delete `apps/api/tsup.config.ts` with `git rm`**
- [ ] **Step 3: Delete `apps/worker/tsup.config.ts` with `git rm`**
- [ ] **Step 4: install: run `pnpm install --config.minimum-release-age=0`, expecting `Done in`**
- [ ] **Step 5: lockfile-age: run `node scripts/check-lockfile-age.mjs --base HEAD`, expecting `all at least 7 days old`**
- [ ] **Step 6: lockfile: run the `lockfile` command in the prompt, expecting `chokidar-4.0.3 false tsup false esbuild-0.28.2 true`**
- [ ] **Step 7: typecheck: run `pnpm typecheck`**
- [ ] **Step 8: build: run `pnpm --filter @korbat/api build && pnpm --filter @korbat/worker build && ls apps/api/dist apps/worker/dist`, expecting `Build success`, `grant-role.js`, `migrate.js`, `index.js`**
- [ ] **Step 9: api-dist: run the `api-dist` command in the prompt, expecting `health=200`, `1`**
- [ ] **Step 10: worker-dist: run the `worker-dist` command in the prompt, expecting `worker started`**
- [ ] **Step 11: test: run `pnpm test`, expecting `Tests  142 passed | 139 skipped (281)`, `Tests  45 passed (45)`, `Tests  9 passed (9)`**
- [ ] **Step 12: audit: run `pnpm audit --audit-level high; echo audit-exit=$?`, expecting `audit-exit=0`**
- [ ] **Step 13: frozen-install: run `pnpm install --frozen-lockfile`, expecting `Done in`**
- [ ] **Step 14: Commit: `build: esbuild build scripts replace tsup for the API and the worker; the chokidar@4.0.3 trust exclusion leaves with it, and the dead min-release-age line leaves .npmrc`**

### Task 3: Two-factor enrolment and session revocation need fresh authentication; owners are emailed about security changes; hashed flow ids, the two missing limits, browser requests never get bearer tokens, revocation tombstones, rehash-on-login, TOTP key rotation, malformed JSON answered as 400

**Prompt:** `docs/superpowers/prompts/audit-fixes/03-auth-hardening.md`

**Files:**
- Create: `apps/api/test/auth/limits.test.ts`
- Create: `apps/api/src/auth/flows/notify.ts`
- Create: `apps/api/src/auth/flows/not-me.ts`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/auth/context.ts`
- Modify: `apps/api/src/auth/crypto.ts`
- Modify: `apps/api/src/auth/limits.ts`
- Modify: `apps/api/src/auth/repo.ts`
- Modify: `apps/api/src/auth/sessions.ts`
- Modify: `apps/api/src/auth/routes.ts`
- Modify: `apps/api/src/auth/flows/mfa.ts`
- Modify: `apps/api/src/auth/flows/reauth.ts`
- Modify: `apps/api/src/auth/flows/password.ts`
- Modify: `apps/api/src/auth/flows/account.ts`
- Modify: `apps/api/src/auth/flows/signin.ts`
- Modify: `apps/api/src/auth/flows/email.ts`
- Modify: `apps/api/src/auth/flows/signup.ts`
- Modify: `apps/api/src/mail/mailer.ts`
- Modify: `apps/api/src/mail/templates.ts`
- Modify: `apps/api/test/config.test.ts`
- Modify: `apps/api/test/mail/templates.test.ts`
- Modify: `apps/api/test/integration/flow-harness.ts`
- Modify: `apps/api/test/integration/auth-flows-mfa.test.ts`
- Modify: `apps/api/test/integration/auth-flows-signup.test.ts`
- Modify: `apps/api/test/integration/auth-flows-account.test.ts`
- Modify: `apps/api/test/integration/auth-sessions.test.ts`
- Modify: `apps/api/test/integration/http-auth.test.ts`

- [ ] **Step 1: Write the failing tests: `apps/api/test/auth/limits.test.ts`, `apps/api/test/config.test.ts`, `apps/api/test/mail/templates.test.ts`, `apps/api/test/integration/flow-harness.ts`, `apps/api/test/integration/auth-flows-mfa.test.ts`, `apps/api/test/integration/auth-flows-signup.test.ts`, `apps/api/test/integration/auth-flows-account.test.ts`, `apps/api/test/integration/auth-sessions.test.ts`, `apps/api/test/integration/http-auth.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm --filter @korbat/api test`, expecting `Tests  3 failed | 141 passed | 148 skipped (292)`**
- [ ] **Step 3: Write the implementation: `apps/api/src/auth/flows/notify.ts`, `apps/api/src/auth/flows/not-me.ts`, `apps/api/src/config.ts`, `apps/api/src/app.ts`, `apps/api/src/auth/context.ts`, `apps/api/src/auth/crypto.ts`, `apps/api/src/auth/limits.ts`, `apps/api/src/auth/repo.ts`, `apps/api/src/auth/sessions.ts`, `apps/api/src/auth/routes.ts`, `apps/api/src/auth/flows/mfa.ts`, `apps/api/src/auth/flows/reauth.ts`, `apps/api/src/auth/flows/password.ts`, `apps/api/src/auth/flows/account.ts`, `apps/api/src/auth/flows/signin.ts`, `apps/api/src/auth/flows/email.ts`, `apps/api/src/auth/flows/signup.ts`, `apps/api/src/mail/mailer.ts`, `apps/api/src/mail/templates.ts`**
- [ ] **Step 4: typecheck: run `pnpm --filter @korbat/api typecheck`**
- [ ] **Step 5: test: run `pnpm --filter @korbat/api test`, expecting `Tests  144 passed | 148 skipped (292)`**
- [ ] **Step 6: integration: run `node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml && cd apps/api && pnpm test:integration`, expecting `Tests  147 passed (147)`**
- [ ] **Step 7: boundary: run the `boundary` command in the prompt, expecting `boundary-checked`**
- [ ] **Step 8: Commit: `fix(auth): two-factor enrolment and revoking a session need fresh authentication; owners are emailed when two-factor, the password, recovery codes or every session changes; the not-me link revokes its device; flow ids are hashed in the store; sign-up completion and handle choice are limited; browser requests are web sessions whatever they claim; revocation tombstones outlive cache fills; passwords are re-hashed on sign-in; previous TOTP keys decrypt and re-encrypt; malformed JSON is a 400`**

### Task 4: The client address is read the way TRUST_PROXY says and only its keyed hash is stored or counted; production refuses test Turnstile secrets and plain-http origins; JSON bodies are capped at 64 KiB; the mail relay must offer TLS in production; error stacks are scrubbed

**Prompt:** `docs/superpowers/prompts/audit-fixes/04-request-identity.md`

**Files:**
- Create: `apps/api/src/auth/client-ip.ts`
- Create: `apps/api/test/mail/smtp.test.ts`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/env.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/auth/context.ts`
- Modify: `apps/api/src/auth/index.ts`
- Modify: `apps/api/src/auth/routes.ts`
- Modify: `apps/api/src/middleware/rate-limit.ts`
- Modify: `apps/api/src/media/routes.ts`
- Modify: `apps/api/src/mail/smtp.ts`
- Modify: `apps/api/src/lib/logger.ts`
- Modify: `apps/api/.env.example`
- Modify: `apps/api/test/middleware.test.ts`
- Modify: `apps/api/test/config.test.ts`
- Modify: `apps/api/test/logger.test.ts`
- Modify: `apps/api/test/app.test.ts`
- Modify: `apps/api/test/integration/flow-harness.ts`

- [ ] **Step 1: Write the failing tests: `apps/api/test/mail/smtp.test.ts`, `apps/api/.env.example`, `apps/api/test/middleware.test.ts`, `apps/api/test/config.test.ts`, `apps/api/test/logger.test.ts`, `apps/api/test/app.test.ts`, `apps/api/test/integration/flow-harness.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm --filter @korbat/api test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/api/src/auth/client-ip.ts`, `apps/api/src/config.ts`, `apps/api/src/env.ts`, `apps/api/src/app.ts`, `apps/api/src/index.ts`, `apps/api/src/auth/context.ts`, `apps/api/src/auth/index.ts`, `apps/api/src/auth/routes.ts`, `apps/api/src/middleware/rate-limit.ts`, `apps/api/src/media/routes.ts`, `apps/api/src/mail/smtp.ts`, `apps/api/src/lib/logger.ts`**
- [ ] **Step 4: dev-env: run `node scripts/gen-dev-env.mjs && echo keys=$(grep -c '^TRUST_PROXY=\|^TOTP_ENC_KEYS_PREVIOUS=' apps/api/.env)`, expecting `apps/api/.env.test: derived`, `keys=2`**
- [ ] **Step 5: typecheck: run `pnpm --filter @korbat/api typecheck`**
- [ ] **Step 6: test: run `pnpm --filter @korbat/api test`, expecting `Tests  `**
- [ ] **Step 7: integration: run `cd apps/api && pnpm test:integration`, expecting `Tests  147 passed (147)`**
- [ ] **Step 8: Commit: `fix(api): TRUST_PROXY decides which header names the client, limits key its hash and never the address; production refuses Turnstile test secrets and plain-http origins; JSON bodies over 64 KiB are 413; the relay must offer TLS in production; error stacks are scrubbed like messages`**

### Task 5: A job runner with a refreshed lock runs the media sweeper and a new auth janitor (dead codes, old sessions, the IP-hash purge, a 90-day security log through a definer function); reconcile refuses to delete many orphan images; the untrusted store is never opened blocking

**Prompt:** `docs/superpowers/prompts/audit-fixes/05-jobs-retention-media-safety.md`

**Files:**
- Create: `apps/api/src/lib/jobs.ts`
- Create: `apps/api/src/auth/janitor.ts`
- Create: `packages/db/migrations/0007_auth_purge_events.sql`
- Create: `apps/api/test/jobs.test.ts`
- Create: `apps/api/test/integration/auth-janitor.test.ts`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/auth/repo.ts`
- Modify: `apps/api/src/auth/index.ts`
- Modify: `apps/api/src/media/context.ts`
- Modify: `apps/api/src/media/index.ts`
- Modify: `apps/api/src/media/sweeper.ts`
- Modify: `apps/api/src/media/files.ts`
- Modify: `apps/api/test/config.test.ts`
- Modify: `apps/api/test/media/files.test.ts`
- Modify: `apps/api/test/integration/media-harness.ts`
- Modify: `apps/api/test/integration/media-sweeper.test.ts`
- Generated by commands: `packages/db/migrations/meta/*`

- [ ] **Step 1: custom-migration: run `pnpm --filter @korbat/db generate:custom --name auth_purge_events`, expecting `0007_auth_purge_events.sql`**
- [ ] **Step 2: Write the failing tests: `packages/db/migrations/0007_auth_purge_events.sql`, `apps/api/test/jobs.test.ts`, `apps/api/test/integration/auth-janitor.test.ts`, `apps/api/test/config.test.ts`, `apps/api/test/media/files.test.ts`, `apps/api/test/integration/media-harness.ts`, `apps/api/test/integration/media-sweeper.test.ts`**
- [ ] **Step 3: Run them and confirm they fail: `pnpm --filter @korbat/api test`, expecting `Tests  `, `failed`**
- [ ] **Step 4: Write the implementation: `apps/api/src/lib/jobs.ts`, `apps/api/src/auth/janitor.ts`, `apps/api/src/config.ts`, `apps/api/src/index.ts`, `apps/api/src/auth/repo.ts`, `apps/api/src/auth/index.ts`, `apps/api/src/media/context.ts`, `apps/api/src/media/index.ts`, `apps/api/src/media/sweeper.ts`, `apps/api/src/media/files.ts`**
- [ ] **Step 5: typecheck: run `pnpm --filter @korbat/api typecheck`**
- [ ] **Step 6: test: run `pnpm --filter @korbat/api test`, expecting `Tests  `**
- [ ] **Step 7: apply-migrations: run the `apply-migrations` command in the prompt, expecting `migrations applied`, `count=8`**
- [ ] **Step 8: test-database: run `node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `migrations applied`, `test database ready: korbat_test`**
- [ ] **Step 9: function-live: run the `function-live` command in the prompt, expecting `t|f`**
- [ ] **Step 10: integration: run `cd apps/api && pnpm test:integration`, expecting `Tests  `**
- [ ] **Step 11: Commit: `feat(api): background jobs run under a refreshed lock without overlapping; the auth janitor purges dead codes, old sessions, device address hashes after 30 days and security events after 90 through a migrator-owned function; the sweeper refuses to delete many images without a row unless forced; store entries are inspected before being opened, never blocking`**

### Task 6: A reply's parent author is hidden with the parent; blocking retracts reposts and likes both ways; pair locks close the race between a block and a follow, like, repost, reply or quote; hidden posts answer with their state before a block; disguising characters are refused; follower pages filter before the limit; a failing limit store is a 503; ids are canonical; daily upload caps; four indexes

**Prompt:** `docs/superpowers/prompts/audit-fixes/06-social-fixes.md`

**Files:**
- Create: `packages/contracts/src/text.ts`
- Modify: `apps/api/src/social/repo.ts`
- Modify: `apps/api/src/social/views.ts`
- Modify: `apps/api/src/social/cursor.ts`
- Modify: `apps/api/src/social/context.ts`
- Modify: `apps/api/src/social/limits.ts`
- Modify: `apps/api/src/social/tiers.ts`
- Modify: `apps/api/src/social/flows/posts.ts`
- Modify: `apps/api/src/social/flows/engagement.ts`
- Modify: `apps/api/src/social/flows/graph.ts`
- Modify: `apps/api/src/social/flows/profiles.ts`
- Modify: `apps/api/src/middleware/rate-limit.ts`
- Modify: `packages/contracts/src/social.ts`
- Modify: `packages/contracts/src/media.ts`
- Modify: `packages/contracts/src/auth.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/db/src/schema/content.ts`
- Modify: `apps/app/src/components/social/PostCard.tsx`
- Modify: `packages/contracts/test/social.test.ts`
- Modify: `apps/api/test/social/cursor.test.ts`
- Modify: `apps/api/test/social/limits.test.ts`
- Modify: `apps/api/test/social/tiers.test.ts`
- Modify: `apps/api/test/middleware.test.ts`
- Modify: `apps/api/test/integration/social-flows-posts.test.ts`
- Modify: `apps/api/test/integration/social-flows-graph.test.ts`
- Modify: `apps/api/test/integration/social-repo.test.ts`
- Generated by commands: `packages/db/migrations/0008_*.sql`
- Generated by commands: `packages/db/migrations/meta/*`

- [ ] **Step 1: Write the failing tests: `packages/contracts/test/social.test.ts`, `apps/api/test/social/cursor.test.ts`, `apps/api/test/social/limits.test.ts`, `apps/api/test/social/tiers.test.ts`, `apps/api/test/middleware.test.ts`, `apps/api/test/integration/social-flows-posts.test.ts`, `apps/api/test/integration/social-flows-graph.test.ts`, `apps/api/test/integration/social-repo.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm --filter @korbat/contracts test; pnpm --filter @korbat/api test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `packages/contracts/src/text.ts`, `apps/api/src/social/repo.ts`, `apps/api/src/social/views.ts`, `apps/api/src/social/cursor.ts`, `apps/api/src/social/context.ts`, `apps/api/src/social/limits.ts`, `apps/api/src/social/tiers.ts`, `apps/api/src/social/flows/posts.ts`, `apps/api/src/social/flows/engagement.ts`, `apps/api/src/social/flows/graph.ts`, `apps/api/src/social/flows/profiles.ts`, `apps/api/src/middleware/rate-limit.ts`, `packages/contracts/src/social.ts`, `packages/contracts/src/media.ts`, `packages/contracts/src/auth.ts`, `packages/contracts/src/index.ts`, `packages/db/src/schema/content.ts`, `apps/app/src/components/social/PostCard.tsx`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm test`, expecting `Tests  `**
- [ ] **Step 6: generate: run `pnpm --filter @korbat/db generate`, expecting `Your SQL migration file`**
- [ ] **Step 7: migration-counts: run the `migration-counts` command in the prompt, expecting `created: 8`, `dropped: 4`, `partial: 1`**
- [ ] **Step 8: apply-migrations: run the `apply-migrations` command in the prompt, expecting `migrations applied`, `count=9`**
- [ ] **Step 9: test-database: run `node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `migrations applied`, `test database ready: korbat_test`**
- [ ] **Step 10: indexes-live: run the `indexes-live` command in the prompt, expecting `follows_from_created_idx follows_to_created_idx posts_latest_idx posts_reply_to_created_idx`**
- [ ] **Step 11: integration: run `cd apps/api && pnpm test:integration`, expecting `Tests  `**
- [ ] **Step 12: Commit: `fix(social): a reply names its parent's author only to viewers who could open the parent; blocking retracts the pair's reposts and likes both ways; a pair lock keeps a follow, like, repost, reply or quote from landing across a concurrent block; hidden posts and blocking accounts reveal nothing; bidi overrides and zero-width characters are refused; follower pages filter blocks before the limit; a failing limit store is 503; cursors and ids are bounded and canonical; uploads get a daily cap; thread, list and Latest indexes`**

### Task 7: Every navigation control is a real anchor the keyboard can follow; deletion asks first and actions wait for each other; lists never double-load; a failed session load is not a sign-out and a 401 anywhere is; ids are validated; dim text meets the contrast floor; dialogs, headings and image buttons carry the right roles; the page is dark and has an icon before the bundle loads; the terms name Turnstile and the device id

**Prompt:** `docs/superpowers/prompts/audit-fixes/07-web-client.md`

**Files:**
- Create: `apps/app/src/lib/links.ts`
- Create: `apps/app/public/index.html`
- Modify: `apps/app/src/components/ui.tsx`
- Modify: `apps/app/src/components/AppShell.tsx`
- Modify: `apps/app/src/components/HandleBox.tsx`
- Modify: `apps/app/src/components/social/RichText.tsx`
- Modify: `apps/app/src/components/social/ProfileList.tsx`
- Modify: `apps/app/src/components/social/PostCard.tsx`
- Modify: `apps/app/src/components/social/PagedList.tsx`
- Modify: `apps/app/src/components/social/MediaGrid.tsx`
- Modify: `apps/app/src/components/social/MediaViewer.tsx`
- Modify: `apps/app/src/components/social/ComposeSheet.tsx`
- Modify: `apps/app/src/components/social/Composer.tsx`
- Modify: `apps/app/src/components/social/ComposerImages.tsx`
- Modify: `apps/app/src/components/security/ReauthPanel.tsx`
- Modify: `apps/app/src/components/security/MfaSection.tsx`
- Modify: `apps/app/src/lib/api.ts`
- Modify: `apps/app/src/lib/session.tsx`
- Modify: `apps/app/src/lib/social.ts`
- Modify: `apps/app/src/lib/terms.ts`
- Modify: `apps/app/src/app/post/[id].tsx`
- Modify: `apps/app/src/app/u/[handle]/index.tsx`
- Modify: `apps/app/src/app/u/[handle]/followers.tsx`
- Modify: `apps/app/src/app/u/[handle]/following.tsx`
- Modify: `apps/app/src/app/settings/privacy.tsx`
- Modify: `apps/app/src/app/settings/security.tsx`
- Modify: `apps/app/src/app/bookmarks.tsx`
- Modify: `apps/app/src/app/terms.tsx`
- Modify: `apps/app/src/app/(auth)/age.tsx`
- Modify: `apps/app/src/app/(auth)/code.tsx`
- Modify: `apps/app/src/app/(auth)/mfa.tsx`
- Modify: `apps/app/src/app/(auth)/password.tsx`
- Modify: `apps/app/src/app/(auth)/signin.tsx`
- Modify: `apps/app/src/app/not-me/[token].tsx`
- Modify: `apps/app/test/a11y.test.tsx`

- [ ] **Step 1: Write the failing tests: `apps/app/test/a11y.test.tsx`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm --filter @korbat/app test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/app/src/lib/links.ts`, `apps/app/public/index.html`, `apps/app/src/components/ui.tsx`, `apps/app/src/components/AppShell.tsx`, `apps/app/src/components/HandleBox.tsx`, `apps/app/src/components/social/RichText.tsx`, `apps/app/src/components/social/ProfileList.tsx`, `apps/app/src/components/social/PostCard.tsx`, `apps/app/src/components/social/PagedList.tsx`, `apps/app/src/components/social/MediaGrid.tsx`, `apps/app/src/components/social/MediaViewer.tsx`, `apps/app/src/components/social/ComposeSheet.tsx`, `apps/app/src/components/social/Composer.tsx`, `apps/app/src/components/social/ComposerImages.tsx`, `apps/app/src/components/security/ReauthPanel.tsx`, `apps/app/src/components/security/MfaSection.tsx`, `apps/app/src/lib/api.ts`, `apps/app/src/lib/session.tsx`, `apps/app/src/lib/social.ts`, `apps/app/src/lib/terms.ts`, `apps/app/src/app/post/[id].tsx`, `apps/app/src/app/u/[handle]/index.tsx`, `apps/app/src/app/u/[handle]/followers.tsx`, `apps/app/src/app/u/[handle]/following.tsx`, `apps/app/src/app/settings/privacy.tsx`, `apps/app/src/app/settings/security.tsx`, `apps/app/src/app/bookmarks.tsx`, `apps/app/src/app/terms.tsx`, `apps/app/src/app/(auth)/age.tsx`, `apps/app/src/app/(auth)/code.tsx`, `apps/app/src/app/(auth)/mfa.tsx`, `apps/app/src/app/(auth)/password.tsx`, `apps/app/src/app/(auth)/signin.tsx`, `apps/app/src/app/not-me/[token].tsx`**
- [ ] **Step 4: typecheck: run `pnpm --filter @korbat/app typecheck`**
- [ ] **Step 5: test: run `pnpm --filter @korbat/app test`, expecting `Tests  `**
- [ ] **Step 6: export: run `(cd apps/app && EXPO_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA npx expo export --platform web 2>&1 | tail -8)`, expecting `Exported`**
- [ ] **Step 7: html-shell: run the `html-shell` command in the prompt, expecting `color-scheme true icon true background true`**
- [ ] **Step 8: Commit: `fix(app): navigation links are anchors (expo-router Link, Text href) so the keyboard can follow them; Delete asks first and actions wait for each other; paged lists run one request at a time and only the latest commits; a failed session load shows a retry and a 401 anywhere signs out; post ids are validated; metadata text and input borders meet WCAG contrast; dialogs are dialogs with initial focus, section headings are level 2, image cells are buttons; the HTML shell is dark with an inline icon; the terms name Turnstile and the device id; the Settings link is current on every settings page`**

### Task 8: PostgreSQL 18 with a rehearsed upgrade, Valkey with a password, Caddy as its own user on 8080 with cache headers and body limits, three networks, memory and process limits, log rotation, images pinned by digest, pnpm through corepack, CI permissions and an image build, Renovate digest pinning, and scripts that refuse a remote Docker

**Prompt:** `docs/superpowers/prompts/audit-fixes/08-infrastructure.md`

**Files:**
- Create: `scripts/pg-major-upgrade.mjs`
- Modify: `apps/api/src/auth/routes.ts`
- Modify: `apps/api/test/integration/http-auth.test.ts`
- Modify: `infra/compose.yml`
- Modify: `infra/compose.dev.yml`
- Modify: `infra/caddy/Caddyfile`
- Modify: `infra/caddy/Dockerfile`
- Modify: `infra/.env.example`
- Modify: `apps/api/Dockerfile`
- Modify: `apps/worker/Dockerfile`
- Modify: `apps/api/.env.example`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `renovate.json`
- Modify: `scripts/gen-dev-env.mjs`
- Modify: `scripts/clean-dev-fixtures.mjs`
- Modify: `scripts/smoke-auth-stack.mjs`
- Modify: `README.md`

- [ ] **Step 1: Write the files: `scripts/pg-major-upgrade.mjs`, `apps/api/src/auth/routes.ts`, `apps/api/test/integration/http-auth.test.ts`, `infra/compose.yml`, `infra/compose.dev.yml`, `infra/caddy/Caddyfile`, `infra/caddy/Dockerfile`, `infra/.env.example`, `apps/api/Dockerfile`, `apps/worker/Dockerfile`, `apps/api/.env.example`, `package.json`, `.github/workflows/ci.yml`, `renovate.json`, `scripts/gen-dev-env.mjs`, `scripts/clean-dev-fixtures.mjs`, `scripts/smoke-auth-stack.mjs`, `README.md`**
- [ ] **Step 2: typecheck: run `pnpm --filter @korbat/api typecheck`**
- [ ] **Step 3: dev-env: run the `dev-env` command in the prompt, expecting `apps/api/.env.test: derived`, `infra-keys=6`, `api-redis-auth=1`**
- [ ] **Step 4: compose-config: run `docker compose --env-file infra/.env.example -f infra/compose.yml config -q && echo config-ok`, expecting `config-ok`**
- [ ] **Step 5: stack-down: run `docker compose -f infra/compose.yml -f infra/compose.dev.yml down && echo down-ok`, expecting `down-ok`**
- [ ] **Step 6: build: run the `build` command in the prompt, expecting `build-exit=0`**
- [ ] **Step 7: pg-upgrade: run `node scripts/pg-major-upgrade.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `upgrade complete`, `was left in place`**
- [ ] **Step 8: stack-up: run `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --wait && echo up-ok`, expecting `up-ok`**
- [ ] **Step 9: postgres-version: run the `postgres-version` command in the prompt, expecting `18.6`**
- [ ] **Step 10: valkey-auth: run the `valkey-auth` command in the prompt, expecting `NOAUTH`, `PONG`**
- [ ] **Step 11: caddy-user: run `docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T caddy id -u`, expecting `10001`**
- [ ] **Step 12: page-headers: run `( curl -sI http://localhost:8080/ | grep -iE '^(cache-control|content-security-policy|server):' ) | tr 'A-Z' 'a-z'`, expecting `cache-control: no-cache`, `default-src 'self'`**
- [ ] **Step 13: api-headers: run `( curl -sI http://localhost:8080/api/health | grep -iE '^(content-security-policy|server|cache-control):' ) | tr 'A-Z' 'a-z'`, expecting `default-src 'none'`, `cache-control: no-store`**
- [ ] **Step 14: bundle-headers: run the `bundle-headers` command in the prompt, expecting `bundle: /_expo/static/js/web/`, `max-age=31536000, immutable`**
- [ ] **Step 15: body-limit: run the `body-limit` command in the prompt, expecting `json=413`**
- [ ] **Step 16: test-database: run `node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `migrations applied`, `test database ready: korbat_test`**
- [ ] **Step 17: smoke: run the `smoke` command in the prompt, expecting `smoke test passed`**
- [ ] **Step 18: remote-docker-refused: run `DOCKER_CONTEXT=not-a-context node scripts/clean-dev-fixtures.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml; echo rc=$?`, expecting `not this machine`, `rc=1`**
- [ ] **Step 19: integration: run `cd apps/api && pnpm test:integration`, expecting `Tests  `**
- [ ] **Step 20: stack-stop: run the `stack-stop` command in the prompt, expecting `postgres-1 Up`**
- [ ] **Step 21: Commit: `feat(infra): PostgreSQL 18 on a new volume with an upgrade script for the old one; Valkey with a required password; Caddy runs as its own user on 8080, keeps the API's headers, caches the page and the bundles by kind, caps bodies and drops a client's CF-Connecting-IP unless the tunnel is in front; cloudflared, Caddy, the API and the data services on separate networks; memory, process and log limits on every service; images pinned by digest and pnpm installed by corepack from its hash; CI reads only, builds the images and pins semgrep; the dev scripts refuse a remote Docker; the browser rule counts Origin, Sec-Fetch-Site and Sec-Fetch-Dest, not the bare Sec-Fetch-Mode that Node's fetch sends`**

### Task 9: The 1a, 2a and 2b specs record the audit's amendments, the main design records the audit, the technologies, the method and the roadmap, and the audit spec records what its dry run settled

**Prompt:** `docs/superpowers/prompts/audit-fixes/09-documentation.md`

**Files:**
- Modify: `docs/superpowers/specs/2026-09-14-identity-auth-1a-design.md`
- Modify: `docs/superpowers/specs/2026-09-17-posting-feed-2a-design.md`
- Modify: `docs/superpowers/specs/2026-09-18-images-2b-design.md`
- Modify: `docs/superpowers/specs/2026-09-03-korbat-design.md`
- Modify: `docs/superpowers/specs/2026-09-23-audit-fixes-design.md`

- [ ] **Step 1: Write the files: `docs/superpowers/specs/2026-09-14-identity-auth-1a-design.md`, `docs/superpowers/specs/2026-09-17-posting-feed-2a-design.md`, `docs/superpowers/specs/2026-09-18-images-2b-design.md`, `docs/superpowers/specs/2026-09-03-korbat-design.md`, `docs/superpowers/specs/2026-09-23-audit-fixes-design.md`**
- [ ] **Step 2: sections: run the `sections` command in the prompt, expecting `docs/superpowers/specs/2026-09-14-identity-auth-1a-design.md:1`, `docs/superpowers/specs/2026-09-17-posting-feed-2a-design.md:1`, `docs/superpowers/specs/2026-09-18-images-2b-design.md:1`**
- [ ] **Step 3: line-endings: run the `line-endings` command in the prompt, expecting `crlf-files []`**
- [ ] **Step 4: Commit: `docs: audit amendments in the 1a, 2a and 2b specs; the main design records the audit, the technology and method changes and the roadmap; the audit spec gains its dry-run amendments`**

### Task 10: The query-string override goes: 7.1.3 stays (expo-router imports it as a namespace), its decoder is overridden to decode-uri-component 0.5.0 and a repository patch lets the CommonJS module call the ES module

**Prompt:** `docs/superpowers/prompts/audit-fixes/10-query-string.md`

**Files:**
- Create: `patches/query-string@7.1.3.patch`
- Modify: `package.json`
- Updated by the install step: `pnpm-lock.yaml`
- Modify: `apps/app/test/query-string.test.ts`
- Modify: `docs/superpowers/specs/2026-09-23-audit-fixes-design.md`
- Modify: `infra/caddy/Dockerfile`
- Modify: `apps/api/Dockerfile`
- Modify: `apps/worker/Dockerfile`

- [ ] **Step 1: Write the failing tests: `apps/app/test/query-string.test.ts`, `docs/superpowers/specs/2026-09-23-audit-fixes-design.md`, `infra/caddy/Dockerfile`, `apps/api/Dockerfile`, `apps/worker/Dockerfile`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm --filter @korbat/app test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `patches/query-string@7.1.3.patch`, `package.json`**
- [ ] **Step 4: install: run `pnpm install --config.minimum-release-age=0`, expecting `Done in`**
- [ ] **Step 5: lockfile-age: run `node scripts/check-lockfile-age.mjs --base HEAD`, expecting `all at least 7 days old`**
- [ ] **Step 6: lockfile: run the `lockfile` command in the prompt, expecting `query-string-7.1.3 true query-string-9 false decode-uri-component-0.5.0 true below-0.5 false patched true`**
- [ ] **Step 7: typecheck: run `pnpm --filter @korbat/app typecheck`**
- [ ] **Step 8: test: run `pnpm --filter @korbat/app test`, expecting `Tests  `**
- [ ] **Step 9: audit: run `pnpm audit --audit-level high; echo audit-exit=$?`, expecting `audit-exit=0`**
- [ ] **Step 10: export: run `(cd apps/app && EXPO_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA npx expo export --platform web 2>&1 | tail -8)`, expecting `Exported`**
- [ ] **Step 11: images: run the `images` command in the prompt, expecting `build-exit=0`, `up-ok`**
- [ ] **Step 12: frozen-install: run `pnpm install --frozen-lockfile`, expecting `Done in`**
- [ ] **Step 13: Commit: `fix(deps): query-string stays at 7.1.3 with its decoder overridden to decode-uri-component 0.5.0 and a one-line repository patch for the ES module's default export; the 9.5.1 override had left expo-router's namespace import without stringify, so no navigation updated the address bar`**

### Task 11: The delete question takes the keyboard focus and hands it back to Delete when withdrawn

**Prompt:** `docs/superpowers/prompts/audit-fixes/11-delete-focus.md`

**Files:**
- Modify: `apps/app/src/components/social/PostCard.tsx`
- Modify: `apps/app/test/a11y.test.tsx`

- [ ] **Step 1: Write the failing tests: `apps/app/test/a11y.test.tsx`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm --filter @korbat/app test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/app/src/components/social/PostCard.tsx`**
- [ ] **Step 4: typecheck: run `pnpm --filter @korbat/app typecheck`**
- [ ] **Step 5: test: run `pnpm --filter @korbat/app test`, expecting `Tests  `**
- [ ] **Step 6: export: run `(cd apps/app && EXPO_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA npx expo export --platform web 2>&1 | tail -8)`, expecting `Exported`**
- [ ] **Step 7: web-image: run the `web-image` command in the prompt, expecting `build-exit=0`, `up-ok`**
- [ ] **Step 8: stack-stop: run the `stack-stop` command in the prompt, expecting `postgres-1 Up`**
- [ ] **Step 9: Commit: `fix(app): the delete question takes the keyboard focus and hands it back to Delete when withdrawn, since the Delete control leaves the tree while the question shows`**
