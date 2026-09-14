# korbat 1a — Accounts and Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** People can sign up and sign in on the web with an emailed code, optionally add a password and TOTP two-factor, manage their sessions, and recover from a stolen session, while staff roles change only through a server CLI.

**Architecture:** An auth module inside the API (`apps/api/src/auth/`) owns every auth flow and talks only to the `auth` schema through its own Postgres role; an architecture test enforces the boundary. Sessions are opaque tokens stored as SHA-256, sent as `__Host-` cookies with double-submit CSRF on web and as bearer tokens on native. Short-lived state lives in Redis behind a key-value interface, email goes through a mailer interface (Mailpit in development), and the Expo web app gains the auth screens.

**Tech Stack:** Hono 4.13.5, Drizzle 0.45.2, Postgres 16, Redis 7, zod 4.5.4, @node-rs/argon2 2.2.0, node:crypto TOTP, uqr 0.1.3, nodemailer 10.0.0, Mailpit v1.31.1, Expo 57 with expo-router, @marsidev/react-turnstile 1.6.1, vitest 4.1.11.

**Complete code:** every task's full files, commands and observed output are in `docs/superpowers/prompts/identity-auth-1a/`, one prompt per task, generated from a verified dry run. This plan is the map. Where it and a prompt differ, the prompt wins.

**Spec:** `docs/superpowers/specs/2026-09-14-identity-auth-1a-design.md`, including the amendments found by the dry run.

---

## File structure

- `apps/api/scripts/`: `update-disposable-domains.mjs` (Task 8)
- `apps/api/src/auth/`: `crypto.ts` (Task 4), `passwords.ts` (Task 6), `base32.ts` (Task 7), `totp.ts` (Task 7), `recovery-codes.ts` (Task 7), `identifiers.ts` (Task 8), `handles.ts` (Task 8), `age.ts` (Task 8), `devices.ts` (Task 8), `disposable.ts` (Task 8), `cookies.ts` (Task 9), `turnstile.ts` (Task 9), `kv.ts` (Task 11), `repo.ts` (Task 11), `sessions.ts` (Task 12), `lockout.ts` (Task 12), `context.ts` (Task 13), `limits.ts` (Task 13), `admin.ts` (Task 15), `middleware.ts` (Task 16), `routes.ts` (Task 16), `index.ts` (Task 16)
- `apps/api/src/auth/flows/`: `signin.ts` (Task 13), `email.ts` (Task 13), `signup.ts` (Task 13), `password.ts` (Task 14), `mfa.ts` (Task 14), `reauth.ts` (Task 15), `account.ts` (Task 15), `not-me.ts` (Task 15)
- `apps/api/src/cli/`: `grant-role.ts` (Task 17)
- `apps/api/src/mail/`: `mailer.ts` (Task 10), `templates.ts` (Task 10), `memory.ts` (Task 10), `smtp.ts` (Task 10)
- `apps/api/src/profiles/`: `store.ts` (Task 16)
- `apps/api/test/`: `architecture.test.ts` (Task 17), `cli-grant-role.test.ts` (Task 17)
- `apps/api/test/auth/`: `crypto.test.ts` (Task 4), `passwords.test.ts` (Task 6), `base32.test.ts` (Task 7), `totp.test.ts` (Task 7), `recovery-codes.test.ts` (Task 7), `identifiers.test.ts` (Task 8), `policy.test.ts` (Task 8), `cookies.test.ts` (Task 9), `turnstile.test.ts` (Task 9), `kv-contract.ts` (Task 11), `kv.test.ts` (Task 11)
- `apps/api/test/integration/`: `mailpit.ts` (Task 10), `mail.test.ts` (Task 10), `kv-redis.test.ts` (Task 11), `auth-fixtures.ts` (Task 11), `auth-repo.test.ts` (Task 11), `auth-sessions.test.ts` (Task 12), `flow-harness.ts` (Task 13), `auth-flows-signup.test.ts` (Task 13), `auth-flows-mfa.test.ts` (Task 14), `auth-flows-account.test.ts` (Task 15), `http-auth.test.ts` (Task 16), `cli-grant-role.test.ts` (Task 17), `http-client.ts` (Task 18), `http-e2e.test.ts` (Task 18), `http-timing.test.ts` (Task 18)
- `apps/api/test/mail/`: `templates.test.ts` (Task 10)
- `apps/app/`: `.env.example` (Task 21)
- `apps/app/src/app/`: `terms.tsx` (Task 20)
- `apps/app/src/app/(auth)/`: `_layout.tsx` (Task 20), `age.tsx` (Task 20), `code.tsx` (Task 20), `handle.tsx` (Task 20), `index.tsx` (Task 20), `mfa.tsx` (Task 20), `password.tsx` (Task 20)
- `apps/app/src/app/not-me/`: `[token].tsx` (Task 20)
- `apps/app/src/app/settings/`: `_layout.tsx` (Task 20), `security.tsx` (Task 20)
- `apps/app/src/components/`: `ui.tsx` (Task 20)
- `apps/app/src/components/security/`: `MfaSection.tsx` (Task 20), `PasswordSection.tsx` (Task 20), `QrCode.tsx` (Task 20), `QrCode.web.tsx` (Task 20), `ReauthPanel.tsx` (Task 20), `SessionsSection.tsx` (Task 20)
- `apps/app/src/lib/`: `flow.ts` (Task 20), `session.tsx` (Task 20), `terms.ts` (Task 20)
- `packages/contracts/src/`: `auth.ts` (Task 1)
- `packages/contracts/test/`: `auth.test.ts` (Task 1)
- `scripts/`: `gen-dev-env.mjs` (Task 3), `check-lockfile-age.mjs` (Task 5), `smoke-auth-stack.mjs` (Task 19)

## Tasks

### Task 1: Auth contracts in @korbat/contracts

**Prompt:** `docs/superpowers/prompts/identity-auth-1a/01-auth-contracts.md`

**Files:**
- Create: `packages/contracts/src/auth.ts`
- Create: `packages/contracts/test/auth.test.ts`
- Modify: `packages/contracts/src/index.ts`

- [ ] **Step 1: Write the failing tests: `packages/contracts/test/auth.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm --filter @korbat/contracts test`, expecting `failed`**
- [ ] **Step 3: Write the implementation: `packages/contracts/src/auth.ts`, `packages/contracts/src/index.ts`**
- [ ] **Step 4: test: run `pnpm --filter @korbat/contracts test`, expecting `Tests  17 passed (17)`**
- [ ] **Step 5: typecheck-contracts: run `pnpm --filter @korbat/contracts typecheck`**
- [ ] **Step 6: typecheck-api: run `pnpm --filter @korbat/api typecheck`**
- [ ] **Step 7: Commit: `feat(contracts): auth request, response and error-code schemas`**

### Task 2: Auth schema changes and migrations

**Prompt:** `docs/superpowers/prompts/identity-auth-1a/02-auth-schema.md`

**Files:**
- Modify: `packages/db/src/schema/auth.ts`
- Modify: `packages/db/test/schema.test.ts`
- Generated by commands: `packages/db/migrations/*`
- Generated by commands: `packages/db/migrations/meta/*`

- [ ] **Step 1: Write the failing tests: `packages/db/test/schema.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm --filter @korbat/db test`, expecting `expected 20 to be 21`**
- [ ] **Step 3: Write the implementation: `packages/db/src/schema/auth.ts`**
- [ ] **Step 4: test: run `pnpm --filter @korbat/db test`, expecting `Tests  13 passed (13)`**
- [ ] **Step 5: typecheck: run `pnpm --filter @korbat/db typecheck`**
- [ ] **Step 6: generate: run `pnpm --filter @korbat/db generate`, expecting `Your SQL migration file`**
- [ ] **Step 7: migration-counts: run the `migration-counts` command in the prompt, expecting `auth_events table: 1`, `reauth enum value: 1`, `new enums: 2`, `policies: 2`, `users columns: 7`, `email_codes columns: 2`, `roles: 0`**
- [ ] **Step 8: grants-migration: run the `grants-migration` command in the prompt, expecting `Prepared empty file for your custom SQL migration`, `REVOKE UPDATE, DELETE, TRUNCATE`**
- [ ] **Step 9: apply-migrations: run the `apply-migrations` command in the prompt, expecting `migrated`, `4`**
- [ ] **Step 10: isolation: run the `isolation` command in the prompt, expecting `INSERT 0 1`, `permission denied for table auth_events`, `permission denied for schema auth`, `{signup,login,change_email,recovery,reauth}`, `{user,moderator,admin}`**
- [ ] **Step 11: Commit: `feat(db): auth roles, onboarding and terms columns, flow-bound email codes, append-only auth_events`**

### Task 3: Auth configuration, secrets and the dev env generator

**Prompt:** `docs/superpowers/prompts/identity-auth-1a/03-auth-config.md`

**Files:**
- Create: `scripts/gen-dev-env.mjs`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/test/config.test.ts`
- Modify: `apps/api/test/app.test.ts`
- Modify: `apps/api/.env.example`

- [ ] **Step 1: Write the failing tests: `apps/api/test/config.test.ts`, `apps/api/test/app.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm --filter @korbat/api test`, expecting `4 failed`**
- [ ] **Step 3: Write the implementation: `scripts/gen-dev-env.mjs`, `apps/api/src/config.ts`, `apps/api/.env.example`**
- [ ] **Step 4: test: run `pnpm --filter @korbat/api test`, expecting `Tests  23 passed | 1 skipped (24)`**
- [ ] **Step 5: typecheck: run `pnpm --filter @korbat/api typecheck`**
- [ ] **Step 6: gen-env: run `node scripts/gen-dev-env.mjs`, expecting `apps/api/.env`**
- [ ] **Step 7: no-placeholders: run `grep -c change-me apps/api/.env infra/.env; git check-ignore apps/api/.env infra/.env`, expecting `apps/api/.env:0`, `infra/.env:0`**
- [ ] **Step 8: idempotent: run `node scripts/gen-dev-env.mjs`, expecting `apps/api/.env: nothing to add`, `infra/.env: nothing to add`**
- [ ] **Step 9: integration: run `cd apps/api && set -a && . ./.env && set +a && pnpm test:integration`, expecting `Tests  1 passed (1)`**
- [ ] **Step 10: Commit: `feat(api): validate auth secrets at startup; dev env generator`**

### Task 4: Auth crypto helpers

**Prompt:** `docs/superpowers/prompts/identity-auth-1a/04-auth-crypto.md`

**Files:**
- Create: `apps/api/src/auth/crypto.ts`
- Create: `apps/api/test/auth/crypto.test.ts`

- [ ] **Step 1: Write the failing tests: `apps/api/test/auth/crypto.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm --filter @korbat/api test`, expecting `Cannot find module '../../src/auth/crypto'`**
- [ ] **Step 3: Write the implementation: `apps/api/src/auth/crypto.ts`**
- [ ] **Step 4: test: run `pnpm --filter @korbat/api test`, expecting `Tests  31 passed | 1 skipped (32)`**
- [ ] **Step 5: typecheck: run `pnpm --filter @korbat/api typecheck`**
- [ ] **Step 6: Commit: `feat(auth): tokens, hashing, constant-time compare, versioned AES-256-GCM`**

### Task 5: 1a API dependencies and the lockfile age check

**Prompt:** `docs/superpowers/prompts/identity-auth-1a/05-auth-dependencies.md`

**Files:**
- Create: `scripts/check-lockfile-age.mjs`
- Generated by commands: `apps/api/package.json`
- Generated by commands: `pnpm-lock.yaml`

- [ ] **Step 1: Write the files: `scripts/check-lockfile-age.mjs`**
- [ ] **Step 2: floor-blocks-normal-add: run the `floor-blocks-normal-add` command in the prompt, expecting `ERR_PNPM_NO_MATURE_MATCHING_VERSION`, `0`**
- [ ] **Step 3: add-runtime: run `pnpm --filter @korbat/api add -E --config.minimum-release-age=0 @node-rs/argon2@2.2.0 uqr@0.1.3 nodemailer@10.0.0`, expecting `Done in`**
- [ ] **Step 4: add-dev: run `pnpm --filter @korbat/api add -E -D --config.minimum-release-age=0 @types/nodemailer@6.4.24`, expecting `Done in`**
- [ ] **Step 5: lockfile-age: run `node scripts/check-lockfile-age.mjs --base HEAD`, expecting `new package versions since HEAD; all at least 7 days old`**
- [ ] **Step 6: floor-unchanged: run `grep -n 'minimumReleaseAge' pnpm-workspace.yaml && git diff --quiet -- pnpm-workspace.yaml .npmrc && echo 'supply-chain settings unchanged'`, expecting `minimumReleaseAge: 10080`, `supply-chain settings unchanged`**
- [ ] **Step 7: script-entry: run the `script-entry` command in the prompt, expecting `"@node-rs/argon2": "2.2.0"`, `"uqr": "0.1.3"`, `"nodemailer": "10.0.0"`, `"dev": "6.4.24"`, `node scripts/update-disposable-domains.mjs`**
- [ ] **Step 8: frozen-install: run `pnpm install --frozen-lockfile`, expecting `Done in`**
- [ ] **Step 9: native-argon2-loads: run the `native-argon2-loads` command in the prompt, expecting `argon2 ok $argon2id$`**
- [ ] **Step 10: test: run `pnpm --filter @korbat/api test`, expecting `Tests  31 passed | 1 skipped (32)`**
- [ ] **Step 11: audit: run `pnpm audit --audit-level high; echo "audit exit: $?"`, expecting `audit exit: 0`**
- [ ] **Step 12: Commit: `build(api): pin argon2, uqr and nodemailer for auth; check new lockfile entries against the release-age floor`**

### Task 6: Passwords: argon2id and the breached-password check

**Prompt:** `docs/superpowers/prompts/identity-auth-1a/06-auth-passwords.md`

**Files:**
- Create: `apps/api/src/auth/passwords.ts`
- Create: `apps/api/test/auth/passwords.test.ts`

- [ ] **Step 1: Write the failing tests: `apps/api/test/auth/passwords.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm --filter @korbat/api test`, expecting `Cannot find module '../../src/auth/passwords'`**
- [ ] **Step 3: Write the implementation: `apps/api/src/auth/passwords.ts`**
- [ ] **Step 4: test: run `pnpm --filter @korbat/api test`, expecting `Tests  37 passed | 1 skipped (38)`**
- [ ] **Step 5: typecheck: run `pnpm --filter @korbat/api typecheck`**
- [ ] **Step 6: Commit: `feat(auth): argon2id password hashing, timing-safe verify, k-anonymity breach check`**

### Task 7: Base32, TOTP and recovery codes

**Prompt:** `docs/superpowers/prompts/identity-auth-1a/07-auth-totp.md`

**Files:**
- Create: `apps/api/src/auth/base32.ts`
- Create: `apps/api/src/auth/totp.ts`
- Create: `apps/api/src/auth/recovery-codes.ts`
- Create: `apps/api/test/auth/base32.test.ts`
- Create: `apps/api/test/auth/totp.test.ts`
- Create: `apps/api/test/auth/recovery-codes.test.ts`

- [ ] **Step 1: Write the failing tests: `apps/api/test/auth/base32.test.ts`, `apps/api/test/auth/totp.test.ts`, `apps/api/test/auth/recovery-codes.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm --filter @korbat/api test`, expecting `Cannot find module '../../src/auth/base32'`, `Cannot find module '../../src/auth/totp'`, `Cannot find module '../../src/auth/recovery-codes'`**
- [ ] **Step 3: Write the implementation: `apps/api/src/auth/base32.ts`, `apps/api/src/auth/totp.ts`, `apps/api/src/auth/recovery-codes.ts`**
- [ ] **Step 4: test: run `pnpm --filter @korbat/api test`, expecting `Tests  48 passed | 1 skipped (49)`**
- [ ] **Step 5: typecheck: run `pnpm --filter @korbat/api typecheck`**
- [ ] **Step 6: Commit: `feat(auth): RFC 4648 base32, RFC 4226/6238 TOTP with replay protection, QR code, hashed recovery codes`**

### Task 8: Identifier hashes, handle rules, age check, device labels, disposable domains

**Prompt:** `docs/superpowers/prompts/identity-auth-1a/08-auth-policy.md`

**Files:**
- Create: `apps/api/src/auth/identifiers.ts`
- Create: `apps/api/src/auth/handles.ts`
- Create: `apps/api/src/auth/age.ts`
- Create: `apps/api/src/auth/devices.ts`
- Create: `apps/api/src/auth/disposable.ts`
- Create: `apps/api/scripts/update-disposable-domains.mjs`
- Create: `apps/api/test/auth/identifiers.test.ts`
- Create: `apps/api/test/auth/policy.test.ts`
- Generated by commands: `apps/api/src/auth/data/disposable-domains.ts`

- [ ] **Step 1: Write the failing tests: `apps/api/test/auth/identifiers.test.ts`, `apps/api/test/auth/policy.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm --filter @korbat/api test`, expecting `Cannot find module '../../src/auth/identifiers'`**
- [ ] **Step 3: Write the implementation: `apps/api/src/auth/identifiers.ts`, `apps/api/src/auth/handles.ts`, `apps/api/src/auth/age.ts`, `apps/api/src/auth/devices.ts`, `apps/api/src/auth/disposable.ts`, `apps/api/scripts/update-disposable-domains.mjs`**
- [ ] **Step 4: generate-domains: run the `generate-domains` command in the prompt, expecting `wrote `, `domains, sha256 `**
- [ ] **Step 5: deterministic: run `sha256sum apps/api/src/auth/data/disposable-domains.ts && head -3 apps/api/src/auth/data/disposable-domains.ts`, expecting `DISPOSABLE_DOMAINS_SOURCE = "28bb67b2b6398e87d6f0ee5bf4f6096420d456ee"`**
- [ ] **Step 6: test: run `pnpm --filter @korbat/api test`, expecting `Tests  60 passed | 1 skipped (61)`**
- [ ] **Step 7: typecheck: run `pnpm --filter @korbat/api typecheck`**
- [ ] **Step 8: Commit: `feat(auth): keyed identifier hashes, handle rules, 16+ age check, device labels, pinned disposable-domain list`**

### Task 9: Session cookies, CSRF, bearer tokens and Turnstile

**Prompt:** `docs/superpowers/prompts/identity-auth-1a/09-auth-cookies-turnstile.md`

**Files:**
- Create: `apps/api/src/auth/cookies.ts`
- Create: `apps/api/src/auth/turnstile.ts`
- Create: `apps/api/test/auth/cookies.test.ts`
- Create: `apps/api/test/auth/turnstile.test.ts`

- [ ] **Step 1: Write the failing tests: `apps/api/test/auth/cookies.test.ts`, `apps/api/test/auth/turnstile.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm --filter @korbat/api test`, expecting `Cannot find module '../../src/auth/cookies'`, `Cannot find module '../../src/auth/turnstile'`**
- [ ] **Step 3: Write the implementation: `apps/api/src/auth/cookies.ts`, `apps/api/src/auth/turnstile.ts`**
- [ ] **Step 4: test: run `pnpm --filter @korbat/api test`, expecting `Tests  69 passed | 1 skipped (70)`**
- [ ] **Step 5: typecheck: run `pnpm --filter @korbat/api typecheck`**
- [ ] **Step 6: Commit: `feat(auth): __Host- session cookies, double-submit CSRF with Origin check, bearer parsing, Turnstile verifier`**

### Task 10: Mailer, templates and Mailpit for development

**Prompt:** `docs/superpowers/prompts/identity-auth-1a/10-mailer.md`

**Files:**
- Create: `apps/api/src/mail/mailer.ts`
- Create: `apps/api/src/mail/templates.ts`
- Create: `apps/api/src/mail/memory.ts`
- Create: `apps/api/src/mail/smtp.ts`
- Create: `apps/api/test/mail/templates.test.ts`
- Create: `apps/api/test/integration/mailpit.ts`
- Create: `apps/api/test/integration/mail.test.ts`
- Modify: `infra/compose.dev.yml`
- Modify: `apps/api/.env.example`

- [ ] **Step 1: Write the failing tests: `apps/api/test/mail/templates.test.ts`, `apps/api/test/integration/mailpit.ts`, `apps/api/test/integration/mail.test.ts`, `infra/compose.dev.yml`, `apps/api/.env.example`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm --filter @korbat/api test`, expecting `Cannot find module '../../src/mail/memory'`**
- [ ] **Step 3: Write the implementation: `apps/api/src/mail/mailer.ts`, `apps/api/src/mail/templates.ts`, `apps/api/src/mail/memory.ts`, `apps/api/src/mail/smtp.ts`**
- [ ] **Step 4: test: run `pnpm --filter @korbat/api test`, expecting `Tests  73 passed | 2 skipped (75)`**
- [ ] **Step 5: typecheck: run `pnpm --filter @korbat/api typecheck`**
- [ ] **Step 6: compose-config: run the `compose-config` command in the prompt, expecting `compose ok`, `mailpit image axllent/mailpit:v1.31.1`, `127.0.0.1:51025->1025`, `127.0.0.1:58025->8025`**
- [ ] **Step 7: mailpit-up: run the `mailpit-up` command in the prompt, expecting `mailpit api: 200`**
- [ ] **Step 8: gen-env: run `node scripts/gen-dev-env.mjs && grep -c '^MAILPIT_URL=' apps/api/.env`, expecting `added MAILPIT_URL`, `1`**
- [ ] **Step 9: integration: run `cd apps/api && set -a && . ./.env && set +a && pnpm test:integration`, expecting `Tests  2 passed (2)`**
- [ ] **Step 10: Commit: `feat(mail): mailer interface, plain templates, SMTP adapter; Mailpit in dev compose`**

### Task 11: Key-value store and the auth repository

**Prompt:** `docs/superpowers/prompts/identity-auth-1a/11-auth-stores.md`

**Files:**
- Create: `apps/api/src/auth/kv.ts`
- Create: `apps/api/src/auth/repo.ts`
- Create: `apps/api/test/auth/kv-contract.ts`
- Create: `apps/api/test/auth/kv.test.ts`
- Create: `apps/api/test/integration/kv-redis.test.ts`
- Create: `apps/api/test/integration/auth-fixtures.ts`
- Create: `apps/api/test/integration/auth-repo.test.ts`
- Generated by commands: `apps/api/package.json`
- Generated by commands: `pnpm-lock.yaml`

- [ ] **Step 1: Write the failing tests: `apps/api/test/auth/kv-contract.ts`, `apps/api/test/auth/kv.test.ts`, `apps/api/test/integration/kv-redis.test.ts`, `apps/api/test/integration/auth-fixtures.ts`, `apps/api/test/integration/auth-repo.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm --filter @korbat/api test`, expecting `Cannot find module '../../src/auth/kv'`**
- [ ] **Step 3: Write the implementation: `apps/api/src/auth/kv.ts`, `apps/api/src/auth/repo.ts`**
- [ ] **Step 4: add-drizzle: run `pnpm --filter @korbat/api add -E --config.minimum-release-age=0 drizzle-orm@0.45.2 && node scripts/check-lockfile-age.mjs --base HEAD`, expecting `Done in`, `0 new package versions since HEAD; all at least 7 days old`**
- [ ] **Step 5: test: run `pnpm --filter @korbat/api test`, expecting `Tests  78 passed | 15 skipped (93)`**
- [ ] **Step 6: typecheck: run `pnpm --filter @korbat/api typecheck`**
- [ ] **Step 7: integration: run `cd apps/api && set -a && . ./.env && set +a && pnpm test:integration`, expecting `Tests  15 passed (15)`**
- [ ] **Step 8: Commit: `feat(auth): Redis/memory key-value store with a shared contract; auth repository with atomic single-use updates`**

### Task 12: Sessions and password lockout

**Prompt:** `docs/superpowers/prompts/identity-auth-1a/12-auth-sessions-lockout.md`

**Files:**
- Create: `apps/api/src/auth/sessions.ts`
- Create: `apps/api/src/auth/lockout.ts`
- Create: `apps/api/test/integration/auth-sessions.test.ts`

- [ ] **Step 1: Write the failing tests: `apps/api/test/integration/auth-sessions.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm --filter @korbat/api test`, expecting `Cannot find module '../../src/auth/lockout'`**
- [ ] **Step 3: Write the implementation: `apps/api/src/auth/sessions.ts`, `apps/api/src/auth/lockout.ts`**
- [ ] **Step 4: test: run `pnpm --filter @korbat/api test`, expecting `Tests  78 passed | 25 skipped (103)`**
- [ ] **Step 5: typecheck: run `pnpm --filter @korbat/api typecheck`**
- [ ] **Step 6: integration: run `cd apps/api && set -a && . ./.env && set +a && pnpm test:integration`, expecting `Tests  25 passed (25)`**
- [ ] **Step 7: Commit: `feat(auth): sessions with cached resolution, sliding and absolute expiry, rotation, re-auth window; password lockout`**

### Task 13: Email entry, sign-up, onboarding and sign-in flows

**Prompt:** `docs/superpowers/prompts/identity-auth-1a/13-auth-flows-signup.md`

**Files:**
- Create: `apps/api/src/auth/context.ts`
- Create: `apps/api/src/auth/limits.ts`
- Create: `apps/api/src/auth/flows/signin.ts`
- Create: `apps/api/src/auth/flows/email.ts`
- Create: `apps/api/src/auth/flows/signup.ts`
- Create: `apps/api/test/integration/flow-harness.ts`
- Create: `apps/api/test/integration/auth-flows-signup.test.ts`

- [ ] **Step 1: Write the failing tests: `apps/api/test/integration/flow-harness.ts`, `apps/api/test/integration/auth-flows-signup.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm --filter @korbat/api test`, expecting `Cannot find module`**
- [ ] **Step 3: Write the implementation: `apps/api/src/auth/context.ts`, `apps/api/src/auth/limits.ts`, `apps/api/src/auth/flows/signin.ts`, `apps/api/src/auth/flows/email.ts`, `apps/api/src/auth/flows/signup.ts`**
- [ ] **Step 4: test: run `pnpm --filter @korbat/api test`, expecting `Tests  78 passed | 33 skipped (111)`**
- [ ] **Step 5: typecheck: run `pnpm --filter @korbat/api typecheck`**
- [ ] **Step 6: integration: run `cd apps/api && set -a && . ./.env && set +a && pnpm test:integration`, expecting `Tests  33 passed (33)`**
- [ ] **Step 7: Commit: `feat(auth): enumeration-safe email entry, sign-up with age and terms checks, handle onboarding, new-device alerts`**

### Task 14: Password and MFA flows

**Prompt:** `docs/superpowers/prompts/identity-auth-1a/14-auth-flows-password-mfa.md`

**Files:**
- Create: `apps/api/src/auth/flows/password.ts`
- Create: `apps/api/src/auth/flows/mfa.ts`
- Create: `apps/api/test/integration/auth-flows-mfa.test.ts`
- Modify: `apps/api/test/integration/flow-harness.ts`

- [ ] **Step 1: Write the failing tests: `apps/api/test/integration/auth-flows-mfa.test.ts`, `apps/api/test/integration/flow-harness.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm --filter @korbat/api test`, expecting `Cannot find module '../../src/auth/flows/mfa'`**
- [ ] **Step 3: Write the implementation: `apps/api/src/auth/flows/password.ts`, `apps/api/src/auth/flows/mfa.ts`**
- [ ] **Step 4: test: run `pnpm --filter @korbat/api test`, expecting `Tests  78 passed | 42 skipped (120)`**
- [ ] **Step 5: typecheck: run `pnpm --filter @korbat/api typecheck`**
- [ ] **Step 6: integration: run `cd apps/api && set -a && . ./.env && set +a && pnpm test:integration`, expecting `Tests  42 passed (42)`**
- [ ] **Step 7: Commit: `feat(auth): password sign-in with lockout, fail-closed password setting, TOTP setup, MFA sign-in, recovery codes`**

### Task 15: Re-authentication, account, session management, 'not me' and role grants

**Prompt:** `docs/superpowers/prompts/identity-auth-1a/15-auth-flows-account.md`

**Files:**
- Create: `apps/api/src/auth/flows/reauth.ts`
- Create: `apps/api/src/auth/flows/account.ts`
- Create: `apps/api/src/auth/flows/not-me.ts`
- Create: `apps/api/src/auth/admin.ts`
- Create: `apps/api/test/integration/auth-flows-account.test.ts`

- [ ] **Step 1: Write the failing tests: `apps/api/test/integration/auth-flows-account.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm --filter @korbat/api test`, expecting `Cannot find module`**
- [ ] **Step 3: Write the implementation: `apps/api/src/auth/flows/reauth.ts`, `apps/api/src/auth/flows/account.ts`, `apps/api/src/auth/flows/not-me.ts`, `apps/api/src/auth/admin.ts`**
- [ ] **Step 4: test: run `pnpm --filter @korbat/api test`, expecting `Tests  78 passed | 49 skipped (127)`**
- [ ] **Step 5: typecheck: run `pnpm --filter @korbat/api typecheck`**
- [ ] **Step 6: integration: run `cd apps/api && set -a && . ./.env && set +a && pnpm test:integration`, expecting `Tests  49 passed (49)`**
- [ ] **Step 7: Commit: `feat(auth): re-authentication by password, TOTP or email; account and session management; 'this wasn't me'; role grants`**

### Task 16: Auth over HTTP: session resolution, CSRF, guards, routes and app wiring

**Prompt:** `docs/superpowers/prompts/identity-auth-1a/16-auth-http.md`

**Files:**
- Create: `apps/api/src/auth/middleware.ts`
- Create: `apps/api/src/auth/routes.ts`
- Create: `apps/api/src/auth/index.ts`
- Create: `apps/api/src/profiles/store.ts`
- Create: `apps/api/test/integration/http-auth.test.ts`
- Modify: `packages/contracts/src/auth.ts`
- Modify: `apps/api/src/auth/context.ts`
- Modify: `apps/api/src/auth/cookies.ts`
- Modify: `apps/api/src/env.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/test/app.test.ts`
- Modify: `apps/api/test/middleware.test.ts`
- Modify: `apps/api/test/integration/health.test.ts`
- Delete: `apps/api/src/middleware/session.ts`

- [ ] **Step 1: Write the failing tests: `apps/api/test/integration/http-auth.test.ts`, `apps/api/test/app.test.ts`, `apps/api/test/middleware.test.ts`, `apps/api/test/integration/health.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm --filter @korbat/api test`, expecting `Test Files  3 failed`, `Cannot find module`**
- [ ] **Step 3: Write the implementation: `apps/api/src/auth/middleware.ts`, `apps/api/src/auth/routes.ts`, `apps/api/src/auth/index.ts`, `apps/api/src/profiles/store.ts`, `packages/contracts/src/auth.ts`, `apps/api/src/auth/context.ts`, `apps/api/src/auth/cookies.ts`, `apps/api/src/env.ts`, `apps/api/src/app.ts`, `apps/api/src/index.ts`**
- [ ] **Step 4: Delete `apps/api/src/middleware/session.ts` with `git rm`**
- [ ] **Step 5: contracts: run `pnpm --filter @korbat/contracts test && pnpm --filter @korbat/contracts typecheck`, expecting `Tests  17 passed (17)`**
- [ ] **Step 6: test: run `pnpm --filter @korbat/api test`, expecting `Tests  78 passed | 56 skipped (134)`**
- [ ] **Step 7: typecheck: run `pnpm --filter @korbat/api typecheck`**
- [ ] **Step 8: no-session-stub: run `grep -rn 'sessionStub' apps/api/src apps/api/test; echo "stub references: $(grep -rln 'sessionStub' apps/api/src apps/api/test | wc -l)"`, expecting `stub references: 0`**
- [ ] **Step 9: integration: run `cd apps/api && set -a && . ./.env && set +a && pnpm test:integration`, expecting `Tests  56 passed (56)`**
- [ ] **Step 10: Commit: `feat(auth): HTTP routes, bearer/cookie session resolution with CSRF and Origin checks, guards; wire auth into the API`**

### Task 17: Auth module boundary test and the grant-role CLI

**Prompt:** `docs/superpowers/prompts/identity-auth-1a/17-auth-boundary-cli.md`

**Files:**
- Create: `apps/api/test/architecture.test.ts`
- Create: `apps/api/src/cli/grant-role.ts`
- Create: `apps/api/test/cli-grant-role.test.ts`
- Create: `apps/api/test/integration/cli-grant-role.test.ts`
- Modify: `apps/api/src/auth/index.ts`

- [ ] **Step 1: Write the failing tests: `apps/api/test/architecture.test.ts`, `apps/api/test/cli-grant-role.test.ts`, `apps/api/test/integration/cli-grant-role.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm --filter @korbat/api test`, expecting `Test Files  2 failed`, `Cannot find module`**
- [ ] **Step 3: Write the implementation: `apps/api/src/cli/grant-role.ts`, `apps/api/src/auth/index.ts`**
- [ ] **Step 4: test: run `pnpm --filter @korbat/api test`, expecting `Tests  88 passed | 58 skipped (146)`**
- [ ] **Step 5: typecheck: run `pnpm --filter @korbat/api typecheck`**
- [ ] **Step 6: deliberate-violation: run the `deliberate-violation` command in the prompt, expecting `zz-violation.ts: imports ./auth/passwords, which is inside the auth module (use ./auth)`, `Tests  1 failed | 5 passed (6)`, `violation file present: 0`**
- [ ] **Step 7: integration: run `cd apps/api && set -a && . ./.env && set +a && pnpm test:integration`, expecting `Tests  58 passed (58)`**
- [ ] **Step 8: Commit: `feat(auth): architecture test enforcing the auth module boundary; grant-role CLI with audit log entry`**

### Task 18: Auth end to end over HTTP against Postgres, Redis and Mailpit, with timing checks

**Prompt:** `docs/superpowers/prompts/identity-auth-1a/18-auth-e2e.md`

**Files:**
- Create: `apps/api/test/integration/http-client.ts`
- Create: `apps/api/test/integration/http-e2e.test.ts`
- Create: `apps/api/test/integration/http-timing.test.ts`
- Modify: `apps/api/test/integration/mailpit.ts`
- Modify: `apps/api/test/integration/http-auth.test.ts`

- [ ] **Step 1: Write the files: `apps/api/test/integration/http-client.ts`, `apps/api/test/integration/http-e2e.test.ts`, `apps/api/test/integration/http-timing.test.ts`, `apps/api/test/integration/mailpit.ts`, `apps/api/test/integration/http-auth.test.ts`**
- [ ] **Step 2: test: run `pnpm --filter @korbat/api test`, expecting `Tests  88 passed | 67 skipped (155)`**
- [ ] **Step 3: typecheck: run `pnpm --filter @korbat/api typecheck`**
- [ ] **Step 4: integration: run `cd apps/api && set -a && . ./.env && set +a && pnpm test:integration`, expecting `Tests  67 passed (67)`**
- [ ] **Step 5: timing-repeat: run the `timing-repeat` command in the prompt, expecting `Tests  2 passed (2)`**
- [ ] **Step 6: Commit: `test(auth): end-to-end HTTP tests with Redis and Mailpit (lockout, MFA, not-me, sessions, age gate) and response-timing checks`**

### Task 19: Auth in the Docker stack: argon2 beside the bundle, grant-role bundle, compose variables, Turnstile CSP, smoke test

**Prompt:** `docs/superpowers/prompts/identity-auth-1a/19-auth-docker.md`

**Files:**
- Create: `scripts/smoke-auth-stack.mjs`
- Modify: `apps/api/tsup.config.ts`
- Modify: `apps/api/Dockerfile`
- Modify: `infra/compose.yml`
- Modify: `infra/caddy/Caddyfile`
- Modify: `infra/.env.example`
- Modify: `scripts/gen-dev-env.mjs`

- [ ] **Step 1: Write the files: `scripts/smoke-auth-stack.mjs`, `apps/api/tsup.config.ts`, `apps/api/Dockerfile`, `infra/compose.yml`, `infra/caddy/Caddyfile`, `infra/.env.example`, `scripts/gen-dev-env.mjs`**
- [ ] **Step 2: build: run the `build` command in the prompt, expecting `Build success`, `grant-role.js`, `index.js`, `migrate.js`, `argon2 imports left external: 1`, `argon2 native loader bundled: 0`**
- [ ] **Step 3: test: run `pnpm --filter @korbat/api test`, expecting `Tests  88 passed | 67 skipped (155)`**
- [ ] **Step 4: env: run the `env` command in the prompt, expecting `auth keys shared: 3`**
- [ ] **Step 5: compose-config: run `docker compose -f infra/compose.yml -f infra/compose.dev.yml config -q && echo compose ok`, expecting `compose ok`**
- [ ] **Step 6: stack: run the `stack` command in the prompt, expecting `health through caddy: 200`, `api running`, `caddy running`, `migrate exited`**
- [ ] **Step 7: argon2-in-image: run the `argon2-in-image` command in the prompt, expecting `image argon2: $argon2id$`**
- [ ] **Step 8: smoke: run the `smoke` command in the prompt, expecting `smoke test passed`**
- [ ] **Step 9: stop-app-services: run `docker compose -f infra/compose.yml -f infra/compose.dev.yml stop caddy api worker minio >/dev/null 2>&1; echo app services stopped`, expecting `app services stopped`**
- [ ] **Step 10: Commit: `feat(infra): ship argon2 and the grant-role CLI in the API image; auth settings in compose; Turnstile in the CSP; auth smoke test`**

### Task 20: Web auth screens: email entry with Turnstile, code, age and terms, handle, password, MFA, security settings, terms, 'this wasn't me'

**Prompt:** `docs/superpowers/prompts/identity-auth-1a/20-web-auth.md`

**Files:**
- Create: `apps/app/src/app/(auth)/_layout.tsx`
- Create: `apps/app/src/app/(auth)/age.tsx`
- Create: `apps/app/src/app/(auth)/code.tsx`
- Create: `apps/app/src/app/(auth)/handle.tsx`
- Create: `apps/app/src/app/(auth)/index.tsx`
- Create: `apps/app/src/app/(auth)/mfa.tsx`
- Create: `apps/app/src/app/(auth)/password.tsx`
- Create: `apps/app/src/app/not-me/[token].tsx`
- Create: `apps/app/src/app/settings/_layout.tsx`
- Create: `apps/app/src/app/settings/security.tsx`
- Create: `apps/app/src/app/terms.tsx`
- Create: `apps/app/src/components/security/MfaSection.tsx`
- Create: `apps/app/src/components/security/PasswordSection.tsx`
- Create: `apps/app/src/components/security/QrCode.tsx`
- Create: `apps/app/src/components/security/QrCode.web.tsx`
- Create: `apps/app/src/components/security/ReauthPanel.tsx`
- Create: `apps/app/src/components/security/SessionsSection.tsx`
- Create: `apps/app/src/components/ui.tsx`
- Create: `apps/app/src/lib/flow.ts`
- Create: `apps/app/src/lib/session.tsx`
- Create: `apps/app/src/lib/terms.ts`
- Modify: `apps/app/src/app/_layout.tsx`
- Modify: `apps/app/src/lib/api.ts`
- Delete: `apps/app/src/app/index.tsx`
- Generated by commands: `apps/app/package.json`
- Generated by commands: `pnpm-lock.yaml`

- [ ] **Step 1: Write the files: `apps/app/src/app/(auth)/_layout.tsx`, `apps/app/src/app/(auth)/age.tsx`, `apps/app/src/app/(auth)/code.tsx`, `apps/app/src/app/(auth)/handle.tsx`, `apps/app/src/app/(auth)/index.tsx`, `apps/app/src/app/(auth)/mfa.tsx`, `apps/app/src/app/(auth)/password.tsx`, `apps/app/src/app/not-me/[token].tsx`, `apps/app/src/app/settings/_layout.tsx`, `apps/app/src/app/settings/security.tsx`, `apps/app/src/app/terms.tsx`, `apps/app/src/components/security/MfaSection.tsx`, `apps/app/src/components/security/PasswordSection.tsx`, `apps/app/src/components/security/QrCode.tsx`, `apps/app/src/components/security/QrCode.web.tsx`, `apps/app/src/components/security/ReauthPanel.tsx`, `apps/app/src/components/security/SessionsSection.tsx`, `apps/app/src/components/ui.tsx`, `apps/app/src/lib/flow.ts`, `apps/app/src/lib/session.tsx`, `apps/app/src/lib/terms.ts`, `apps/app/src/app/_layout.tsx`, `apps/app/src/lib/api.ts`**
- [ ] **Step 2: Delete `apps/app/src/app/index.tsx` with `git rm`**
- [ ] **Step 3: deps: run the `deps` command in the prompt, expecting `"@marsidev/react-turnstile": "1.6.1"`, `"zod": "4.5.4"`, `all at least 7 days old`**
- [ ] **Step 4: typecheck: run `pnpm --filter @korbat/app typecheck`**
- [ ] **Step 5: export: run `cd apps/app && EXPO_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA npx expo export --platform web 2>&1 | tail -8`, expecting `Exported`**
- [ ] **Step 6: api-unchanged: run `pnpm --filter @korbat/api test`, expecting `Tests  88 passed | 67 skipped (155)`**
- [ ] **Step 7: Commit: `feat(app): web sign-up and sign-in with Turnstile, onboarding, MFA challenge, security settings, terms and 'this wasn't me'`**

### Task 21: Turnstile site key in the web image, CI lockfile-age and web export checks, dev env for the app, README

**Prompt:** `docs/superpowers/prompts/identity-auth-1a/21-web-image-ci-docs.md`

**Files:**
- Create: `apps/app/.env.example`
- Modify: `.github/workflows/ci.yml`
- Modify: `infra/caddy/Dockerfile`
- Modify: `infra/compose.yml`
- Modify: `infra/.env.example`
- Modify: `scripts/gen-dev-env.mjs`
- Modify: `README.md`

- [ ] **Step 1: Write the files: `apps/app/.env.example`, `.github/workflows/ci.yml`, `infra/caddy/Dockerfile`, `infra/compose.yml`, `infra/.env.example`, `scripts/gen-dev-env.mjs`, `README.md`**
- [ ] **Step 2: env: run `node scripts/gen-dev-env.mjs`, expecting `infra/.env: completed, added WEB_TURNSTILE_SITE_KEY`, `apps/app/.env: created with 2 keys`**
- [ ] **Step 3: lockfile-age: run `node scripts/check-lockfile-age.mjs --base HEAD~1`, expecting `all at least 7 days old`**
- [ ] **Step 4: ci-shell-safety: run the `ci-shell-safety` command in the prompt, expecting `github expressions inside run blocks: 0`, `1`**
- [ ] **Step 5: compose-config-example: run `docker compose --env-file infra/.env.example -f infra/compose.yml config -q && echo compose ok`, expecting `compose ok`**
- [ ] **Step 6: compose-requires-site-key: run the `compose-requires-site-key` command in the prompt, expecting `set WEB_TURNSTILE_SITE_KEY in infra/.env`**
- [ ] **Step 7: web-image: run the `web-image` command in the prompt, expecting `health through caddy: 200`, `site key in web bundle: yes`**
- [ ] **Step 8: semgrep: run the `semgrep` command in the prompt, expecting `Findings: 0 (0 blocking)`**
- [ ] **Step 9: api-unchanged: run `pnpm --filter @korbat/api test`, expecting `Tests  88 passed | 67 skipped (155)`**
- [ ] **Step 10: Commit: `ci: lockfile age and web export checks; Turnstile site key in the web image; app dev env; README for auth`**
