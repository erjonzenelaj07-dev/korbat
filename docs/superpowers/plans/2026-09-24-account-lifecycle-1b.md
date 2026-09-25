# korbat — Account Lifecycle (1b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An account owner can change their name, bio, handle and email address, hold or drop the verified badge, take their data with them as a ZIP, and delete the account, each guarded as the design says.

**Architecture:** Nine commits: contracts and schema, profile and handle editing (social), email change (auth), the badge with its provider interface (auth), the streamed export (a new account module), deletion with its purge job (all four modules), the web app screens, the fixes an adversarial review of those seven commits upheld, and the documentation. Each feature starts with a failing test.

**Tech Stack:** Node 24, TypeScript 7 (6 in the Expo app), Hono 4.13 with its streaming helper, zod 4, drizzle, PostgreSQL 18, Valkey, fflate 0.8.3 for the ZIP, Expo SDK 57 / expo-router, vitest 4.

**Complete code:** each task's full files, commands and observed output are in `docs/superpowers/prompts/account-lifecycle-1b/NN-<slug>.md`, generated from a verified dry run. This plan is the map. Where it and a prompt differ, the prompt wins.

**Spec:** `docs/superpowers/specs/2026-09-24-account-lifecycle-1b-design.md`.

---

## File structure

- `apps/api/src/account/`: `context.ts` (Task 5), `index.ts` (Task 5), `routes.ts` (Task 5), `zip.ts` (Task 5), `purge.ts` (Task 6)
- `apps/api/src/account/flows/`: `export.ts` (Task 5), `deletion.ts` (Task 6)
- `apps/api/src/auth/flows/`: `email-change.ts` (Task 3), `badge.ts` (Task 4), `export.ts` (Task 5), `deletion.ts` (Task 6)
- `apps/api/src/auth/verify/`: `dev.ts` (Task 4), `provider.ts` (Task 4), `vonage.ts` (Task 4)
- `apps/api/src/social/flows/`: `profile-edit.ts` (Task 2), `export.ts` (Task 5)
- `apps/api/test/account/`: `export.test.ts` (Task 5), `deletion.test.ts` (Task 6)
- `apps/api/test/auth/`: `email-change.test.ts` (Task 3), `flow-harness.ts` (Task 3), `badge.test.ts` (Task 4), `verify-config.test.ts` (Task 4), `vonage.test.ts` (Task 4), `deletion.test.ts` (Task 6)
- `apps/api/test/integration/`: `http-profile.test.ts` (Task 2), `social-flows-profile-edit.test.ts` (Task 2), `http-badge.test.ts` (Task 4), `account-export.test.ts` (Task 5), `http-account.test.ts` (Task 5), `account-deletion.test.ts` (Task 6), `http-deletion.test.ts` (Task 6), `account-takedown.test.ts` (Task 8), `rate-limit-redis.test.ts` (Task 8)
- `apps/api/test/social/`: `profile-edit.test.ts` (Task 2), `profile-harness.ts` (Task 2)
- `apps/app/src/app/email-revert/`: `[token].tsx` (Task 8)
- `apps/app/src/app/settings/`: `account.tsx` (Task 7), `profile.tsx` (Task 7)
- `apps/app/src/components/`: `SettingsNav.tsx` (Task 7)
- `apps/app/src/lib/`: `download.ts` (Task 7)
- `apps/app/test/`: `lifecycle.test.tsx` (Task 7)
- `packages/contracts/src/`: `account.ts` (Task 1)
- `packages/contracts/test/`: `account.test.ts` (Task 1)
- `packages/db/migrations/`: `0009_clever_ezekiel.sql` (Task 1)
- `packages/db/migrations/meta/`: `0009_snapshot.json` (Task 1)
- `scripts/`: `verify-badge.mjs` (Task 4)

## Tasks

### Task 1: Contracts, schema and migration 0009 for the account lifecycle: bio, phone, profile, handle, email-change, badge, deletion and export shapes; handle_history, handle_changed_at, purged_at, the phone-hash index, the delete_account purpose and seven event types; VERIFY_* configuration with production guards; six mail templates

**Prompt:** `docs/superpowers/prompts/account-lifecycle-1b/01-contracts-schema.md`

**Files:**
- Create: `packages/contracts/src/account.ts`
- Create: `packages/contracts/test/account.test.ts`
- Create: `packages/db/migrations/0009_clever_ezekiel.sql`
- Create: `packages/db/migrations/meta/0009_snapshot.json`
- Modify: `apps/api/.env.example`
- Modify: `apps/api/src/auth/context.ts`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/mail/mailer.ts`
- Modify: `apps/api/src/mail/templates.ts`
- Modify: `apps/api/src/profiles/store.ts`
- Modify: `apps/api/test/config.test.ts`
- Modify: `apps/api/test/integration/auth-flows-account.test.ts`
- Modify: `apps/api/test/integration/flow-harness.ts`
- Modify: `apps/api/test/mail/templates.test.ts`
- Modify: `apps/app/src/lib/api.ts`
- Modify: `infra/.env.example`
- Modify: `infra/compose.yml`
- Modify: `packages/contracts/src/auth.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/social.ts`
- Modify: `packages/contracts/test/auth.test.ts`
- Modify: `packages/contracts/test/social.test.ts`
- Modify: `packages/db/migrations/meta/_journal.json`
- Modify: `packages/db/src/schema/auth.ts`
- Modify: `packages/db/src/schema/identity.ts`
- Modify: `packages/db/test/schema.test.ts`

- [ ] **Step 1: Write the failing tests: `packages/contracts/test/account.test.ts`, `apps/api/test/config.test.ts`, `apps/api/test/integration/auth-flows-account.test.ts`, `apps/api/test/integration/flow-harness.ts`, `apps/api/test/mail/templates.test.ts`, `packages/contracts/test/auth.test.ts`, `packages/contracts/test/social.test.ts`, `packages/db/test/schema.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `packages/contracts/src/account.ts`, `packages/db/migrations/0009_clever_ezekiel.sql`, `packages/db/migrations/meta/0009_snapshot.json`, `apps/api/.env.example`, `apps/api/src/auth/context.ts`, `apps/api/src/config.ts`, `apps/api/src/mail/mailer.ts`, `apps/api/src/mail/templates.ts`, `apps/api/src/profiles/store.ts`, `apps/app/src/lib/api.ts`, `infra/.env.example`, `infra/compose.yml`, `packages/contracts/src/auth.ts`, `packages/contracts/src/index.ts`, `packages/contracts/src/social.ts`, `packages/db/migrations/meta/_journal.json`, `packages/db/src/schema/auth.ts`, `packages/db/src/schema/identity.ts`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm test`, expecting `Tests  `**
- [ ] **Step 6: generate: run `pnpm --filter @korbat/db generate`, expecting `No schema changes`**
- [ ] **Step 7: apply-migrations: run the `apply-migrations` command in the prompt, expecting `migrations applied`, `count=10`**
- [ ] **Step 8: test-database: run `node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `migrations applied`, `test database ready: korbat_test`**
- [ ] **Step 9: handle-history: run the `handle-history` command in the prompt, expecting `handle-history=t`**
- [ ] **Step 10: event-types: run the `event-types` command in the prompt, expecting `event-types=21`**
- [ ] **Step 11: integration: run `cd apps/api && set -a && . ./.env && set +a && pnpm test:integration`, expecting `Tests  `**
- [ ] **Step 12: Commit: `feat(contracts,db,api): the account lifecycle's ground: contracts for profile editing, handle change, email change, the badge, deletion and the export; handle_history, handle_changed_at, purged_at, a unique phone-hash index, the delete_account code purpose and seven event types in migration 0009 with the handle backfill; VERIFY_PROVIDER, Vonage credentials and the brand with production guards; six mail templates`**

### Task 2: Profile editing and handle change: display name and bio edits, a handle change once every 30 days with every old handle reserved for its account, onboarding writing the handle history, security events from the social module

**Prompt:** `docs/superpowers/prompts/account-lifecycle-1b/02-profile-handle.md`

**Files:**
- Create: `apps/api/src/social/flows/profile-edit.ts`
- Create: `apps/api/test/integration/http-profile.test.ts`
- Create: `apps/api/test/integration/social-flows-profile-edit.test.ts`
- Create: `apps/api/test/social/profile-edit.test.ts`
- Create: `apps/api/test/social/profile-harness.ts`
- Modify: `apps/api/src/auth/index.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/profiles/store.ts`
- Modify: `apps/api/src/social/context.ts`
- Modify: `apps/api/src/social/flows/profiles.ts`
- Modify: `apps/api/src/social/index.ts`
- Modify: `apps/api/src/social/limits.ts`
- Modify: `apps/api/src/social/repo.ts`
- Modify: `apps/api/src/social/routes.ts`
- Modify: `apps/api/test/app.test.ts`
- Modify: `apps/api/test/integration/http-media.test.ts`
- Modify: `apps/api/test/integration/http-social.test.ts`
- Modify: `apps/api/test/integration/social-harness.ts`

- [ ] **Step 1: Write the failing tests: `apps/api/test/integration/http-profile.test.ts`, `apps/api/test/integration/social-flows-profile-edit.test.ts`, `apps/api/test/social/profile-edit.test.ts`, `apps/api/test/social/profile-harness.ts`, `apps/api/test/app.test.ts`, `apps/api/test/integration/http-media.test.ts`, `apps/api/test/integration/http-social.test.ts`, `apps/api/test/integration/social-harness.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm --filter @korbat/api test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/api/src/social/flows/profile-edit.ts`, `apps/api/src/auth/index.ts`, `apps/api/src/index.ts`, `apps/api/src/profiles/store.ts`, `apps/api/src/social/context.ts`, `apps/api/src/social/flows/profiles.ts`, `apps/api/src/social/index.ts`, `apps/api/src/social/limits.ts`, `apps/api/src/social/repo.ts`, `apps/api/src/social/routes.ts`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm test`, expecting `Tests  `**
- [ ] **Step 6: integration: run `cd apps/api && set -a && . ./.env && set +a && pnpm test:integration`, expecting `Tests  `**
- [ ] **Step 7: Commit: `feat(social): an account edits its display name and bio and changes its handle once every 30 days, with every handle it ever had reserved for it in handle_history (onboarding writes the first row); the social module records profile_updated and handle_changed events through the auth module`**

### Task 3: Email change: a code to the new address with the sign-in start's cooldown and hourly limit, the conflict reported only at verification through the unique index, the old address told, sessions kept

**Prompt:** `docs/superpowers/prompts/account-lifecycle-1b/03-email-change.md`

**Files:**
- Create: `apps/api/src/auth/flows/email-change.ts`
- Create: `apps/api/test/auth/email-change.test.ts`
- Create: `apps/api/test/auth/flow-harness.ts`
- Modify: `apps/api/src/auth/context.ts`
- Modify: `apps/api/src/auth/repo.ts`
- Modify: `apps/api/src/auth/routes.ts`
- Modify: `apps/api/test/integration/http-auth.test.ts`
- Modify: `apps/api/test/integration/http-e2e.test.ts`

- [ ] **Step 1: Write the failing tests: `apps/api/test/auth/email-change.test.ts`, `apps/api/test/auth/flow-harness.ts`, `apps/api/test/integration/http-auth.test.ts`, `apps/api/test/integration/http-e2e.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm --filter @korbat/api test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/api/src/auth/flows/email-change.ts`, `apps/api/src/auth/context.ts`, `apps/api/src/auth/repo.ts`, `apps/api/src/auth/routes.ts`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm test`, expecting `Tests  `**
- [ ] **Step 6: integration: run `cd apps/api && set -a && . ./.env && set +a && pnpm test:integration`, expecting `Tests  `**
- [ ] **Step 7: Commit: `feat(auth): an account moves to a new email address with a code sent there; the start answers alike for free and taken addresses and shares the sign-in start's per-address cooldown and hourly limit, the conflict is reported only at verification from the unique index, the old address is told and every session stays signed in`**

### Task 4: The verified badge: a VerificationProvider interface with the development provider and the Vonage Verify v2 adapter, the badge start, verify and remove flows with one number per account through the unique index, the logger scrubbing phone fields, and the runbook's live-check script

**Prompt:** `docs/superpowers/prompts/account-lifecycle-1b/04-verified-badge.md`

**Files:**
- Create: `apps/api/src/auth/flows/badge.ts`
- Create: `apps/api/src/auth/verify/dev.ts`
- Create: `apps/api/src/auth/verify/provider.ts`
- Create: `apps/api/src/auth/verify/vonage.ts`
- Create: `apps/api/test/auth/badge.test.ts`
- Create: `apps/api/test/auth/verify-config.test.ts`
- Create: `apps/api/test/auth/vonage.test.ts`
- Create: `apps/api/test/integration/http-badge.test.ts`
- Create: `scripts/verify-badge.mjs`
- Modify: `apps/api/src/auth/context.ts`
- Modify: `apps/api/src/auth/identifiers.ts`
- Modify: `apps/api/src/auth/index.ts`
- Modify: `apps/api/src/auth/repo.ts`
- Modify: `apps/api/src/auth/routes.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/lib/logger.ts`
- Modify: `apps/api/src/profiles/store.ts`
- Modify: `apps/api/test/app.test.ts`
- Modify: `apps/api/test/auth/flow-harness.ts`
- Modify: `apps/api/test/auth/identifiers.test.ts`
- Modify: `apps/api/test/integration/auth-repo.test.ts`
- Modify: `apps/api/test/integration/flow-harness.ts`
- Modify: `apps/api/test/logger.test.ts`

- [ ] **Step 1: Write the failing tests: `apps/api/test/auth/badge.test.ts`, `apps/api/test/auth/verify-config.test.ts`, `apps/api/test/auth/vonage.test.ts`, `apps/api/test/integration/http-badge.test.ts`, `apps/api/test/app.test.ts`, `apps/api/test/auth/flow-harness.ts`, `apps/api/test/auth/identifiers.test.ts`, `apps/api/test/integration/auth-repo.test.ts`, `apps/api/test/integration/flow-harness.ts`, `apps/api/test/logger.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm --filter @korbat/api test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/api/src/auth/flows/badge.ts`, `apps/api/src/auth/verify/dev.ts`, `apps/api/src/auth/verify/provider.ts`, `apps/api/src/auth/verify/vonage.ts`, `scripts/verify-badge.mjs`, `apps/api/src/auth/context.ts`, `apps/api/src/auth/identifiers.ts`, `apps/api/src/auth/index.ts`, `apps/api/src/auth/repo.ts`, `apps/api/src/auth/routes.ts`, `apps/api/src/index.ts`, `apps/api/src/lib/logger.ts`, `apps/api/src/profiles/store.ts`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm test`, expecting `Tests  `**
- [ ] **Step 6: integration: run `cd apps/api && set -a && . ./.env && set +a && pnpm test:integration`, expecting `Tests  `**
- [ ] **Step 7: verify-badge-usage: run `node scripts/verify-badge.mjs 2>&1; echo exit=$?`, expecting `usage: node scripts/verify-badge.mjs`, `exit=2`**
- [ ] **Step 8: Commit: `feat(auth): the verified badge proves a phone number through a VerificationProvider (the development provider accepts 000000, the Vonage Verify v2 adapter sends one text); the number is kept only as a keyed hash that the unique index holds to one account, the badge can be removed, the logger scrubs phone fields, and scripts/verify-badge.mjs checks live credentials without touching an account`**

### Task 5: The data export and the account module: fflate 0.8.3, the three modules' AuthForAccount, SocialForAccount and MediaForAccount export methods, a streaming ZIP writer, POST /api/account/export once a day with export.json written last and the images stored next to it

**Prompt:** `docs/superpowers/prompts/account-lifecycle-1b/05-data-export.md`

**Files:**
- Create: `apps/api/src/account/context.ts`
- Create: `apps/api/src/account/flows/export.ts`
- Create: `apps/api/src/account/index.ts`
- Create: `apps/api/src/account/routes.ts`
- Create: `apps/api/src/account/zip.ts`
- Create: `apps/api/src/auth/flows/export.ts`
- Create: `apps/api/src/social/flows/export.ts`
- Create: `apps/api/test/account/export.test.ts`
- Create: `apps/api/test/integration/account-export.test.ts`
- Create: `apps/api/test/integration/http-account.test.ts`
- Modify: `apps/api/build.mjs`
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/auth/index.ts`
- Modify: `apps/api/src/auth/repo.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/media/index.ts`
- Modify: `apps/api/src/media/repo.ts`
- Modify: `apps/api/src/social/index.ts`
- Modify: `apps/api/src/social/repo.ts`
- Modify: `apps/api/test/app.test.ts`
- Modify: `apps/api/test/architecture.test.ts`
- Updated by the install step: `pnpm-lock.yaml`

- [ ] **Step 1: Write the failing tests: `apps/api/test/account/export.test.ts`, `apps/api/test/integration/account-export.test.ts`, `apps/api/test/integration/http-account.test.ts`, `apps/api/test/app.test.ts`, `apps/api/test/architecture.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm --filter @korbat/api test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/api/src/account/context.ts`, `apps/api/src/account/flows/export.ts`, `apps/api/src/account/index.ts`, `apps/api/src/account/routes.ts`, `apps/api/src/account/zip.ts`, `apps/api/src/auth/flows/export.ts`, `apps/api/src/social/flows/export.ts`, `apps/api/build.mjs`, `apps/api/package.json`, `apps/api/src/app.ts`, `apps/api/src/auth/index.ts`, `apps/api/src/auth/repo.ts`, `apps/api/src/index.ts`, `apps/api/src/media/index.ts`, `apps/api/src/media/repo.ts`, `apps/api/src/social/index.ts`, `apps/api/src/social/repo.ts`**
- [ ] **Step 4: install: run `pnpm install --config.minimum-release-age=0`, expecting `Done in`**
- [ ] **Step 5: lockfile-age: run `node scripts/check-lockfile-age.mjs --base HEAD`, expecting `all at least 7 days old`**
- [ ] **Step 6: typecheck: run `pnpm typecheck`**
- [ ] **Step 7: test: run `pnpm test`, expecting `Tests  `**
- [ ] **Step 8: integration: run `cd apps/api && set -a && . ./.env && set +a && pnpm test:integration`, expecting `Tests  `**
- [ ] **Step 9: build: run `pnpm --filter @korbat/api build 2>&1 | tail -3 && echo fflate=$(grep -c fflate apps/api/dist/index.js)`, expecting `Build success`, `fflate=`**
- [ ] **Step 10: bundle-syntax: run `node --check apps/api/dist/index.js && echo bundle-ok`, expecting `bundle-ok`**
- [ ] **Step 11: frozen-install: run `pnpm install --frozen-lockfile`, expecting `Done in`**
- [ ] **Step 12: Commit: `feat(account): a new account module streams a ZIP export of the account (export.json with the account, profile, posts, engagement, graph, sessions, devices and security events, and every uploaded image next to it) once a day behind fresh authentication; fflate 0.8.3 writes the archive entry by entry with back-pressure, and the auth, social and media modules expose their export reads through the account interfaces; the bundle's require shim is aliased so fflate's own createRequire import cannot clash with it`**

### Task 6: Account deletion: fresh authentication, an emailed code and the typed handle; sessions revoked with tombstones, posts tombstoned with their images deleted, engagement and graph rows gone with their counters, the profile and auth row anonymised, the handle kept reserved; the account-purge job finishes any deletion left half done; the smoke test walks the lifecycle

**Prompt:** `docs/superpowers/prompts/account-lifecycle-1b/06-account-deletion.md`

**Files:**
- Create: `apps/api/src/account/flows/deletion.ts`
- Create: `apps/api/src/account/purge.ts`
- Create: `apps/api/src/auth/flows/deletion.ts`
- Create: `apps/api/test/account/deletion.test.ts`
- Create: `apps/api/test/auth/deletion.test.ts`
- Create: `apps/api/test/integration/account-deletion.test.ts`
- Create: `apps/api/test/integration/http-deletion.test.ts`
- Modify: `apps/api/src/account/index.ts`
- Modify: `apps/api/src/account/routes.ts`
- Modify: `apps/api/src/auth/index.ts`
- Modify: `apps/api/src/auth/repo.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/media/index.ts`
- Modify: `apps/api/src/media/repo.ts`
- Modify: `apps/api/src/social/index.ts`
- Modify: `apps/api/src/social/repo.ts`
- Modify: `apps/api/test/account/export.test.ts`
- Modify: `apps/api/test/auth/flow-harness.ts`
- Modify: `apps/api/test/integration/account-export.test.ts`
- Modify: `apps/api/test/integration/flow-harness.ts`
- Modify: `scripts/smoke-auth-stack.mjs`

- [ ] **Step 1: Write the failing tests: `apps/api/test/account/deletion.test.ts`, `apps/api/test/auth/deletion.test.ts`, `apps/api/test/integration/account-deletion.test.ts`, `apps/api/test/integration/http-deletion.test.ts`, `apps/api/test/account/export.test.ts`, `apps/api/test/auth/flow-harness.ts`, `apps/api/test/integration/account-export.test.ts`, `apps/api/test/integration/flow-harness.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm --filter @korbat/api test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/api/src/account/flows/deletion.ts`, `apps/api/src/account/purge.ts`, `apps/api/src/auth/flows/deletion.ts`, `apps/api/src/account/index.ts`, `apps/api/src/account/routes.ts`, `apps/api/src/auth/index.ts`, `apps/api/src/auth/repo.ts`, `apps/api/src/index.ts`, `apps/api/src/media/index.ts`, `apps/api/src/media/repo.ts`, `apps/api/src/social/index.ts`, `apps/api/src/social/repo.ts`, `scripts/smoke-auth-stack.mjs`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm test`, expecting `Tests  `**
- [ ] **Step 6: integration: run `cd apps/api && set -a && . ./.env && set +a && pnpm test:integration`, expecting `Tests  `**
- [ ] **Step 7: smoke-syntax: run `node --check scripts/smoke-auth-stack.mjs && echo smoke-syntax=ok`, expecting `smoke-syntax=ok`**
- [ ] **Step 8: Commit: `feat(account): an account deletes itself with fresh authentication, an emailed code and its typed handle; the auth module takes it down at once (sessions revoked with tombstones, devices and codes gone, the row marked), the purge tombstones its posts with their images deleted, removes its likes, reposts, bookmarks, follows, blocks and mutes with every counter, anonymises the profile and the auth row and keeps the handle reserved; the account-purge job finishes any deletion left half done and the smoke test walks the lifecycle`**

### Task 7: The web app: a settings navigation row, the Profile screen (display name, bio, handle change with its cooldown date), the Account screen (email change, verified badge with its explanation, data export as a download, guarded deletion), the Verified chip on posts and profiles, the terms text, and the WEB_BADGE build switch; the whole stack rebuilt and the smoke test walking the account lifecycle

**Prompt:** `docs/superpowers/prompts/account-lifecycle-1b/07-web-app.md`

**Files:**
- Create: `apps/app/src/app/settings/account.tsx`
- Create: `apps/app/src/app/settings/profile.tsx`
- Create: `apps/app/src/components/SettingsNav.tsx`
- Create: `apps/app/src/lib/download.ts`
- Create: `apps/app/test/lifecycle.test.tsx`
- Modify: `apps/app/src/app/settings/privacy.tsx`
- Modify: `apps/app/src/app/settings/security.tsx`
- Modify: `apps/app/src/app/u/[handle]/index.tsx`
- Modify: `apps/app/src/components/social/PostCard.tsx`
- Modify: `apps/app/src/components/ui.tsx`
- Modify: `apps/app/src/lib/api.ts`
- Modify: `apps/app/src/lib/social.ts`
- Modify: `apps/app/src/lib/terms.ts`
- Modify: `infra/.env.example`
- Modify: `infra/caddy/Dockerfile`
- Modify: `infra/compose.yml`

- [ ] **Step 1: Write the failing tests: `apps/app/test/lifecycle.test.tsx`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm --filter @korbat/app test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/app/src/app/settings/account.tsx`, `apps/app/src/app/settings/profile.tsx`, `apps/app/src/components/SettingsNav.tsx`, `apps/app/src/lib/download.ts`, `apps/app/src/app/settings/privacy.tsx`, `apps/app/src/app/settings/security.tsx`, `apps/app/src/app/u/[handle]/index.tsx`, `apps/app/src/components/social/PostCard.tsx`, `apps/app/src/components/ui.tsx`, `apps/app/src/lib/api.ts`, `apps/app/src/lib/social.ts`, `apps/app/src/lib/terms.ts`, `infra/.env.example`, `infra/caddy/Dockerfile`, `infra/compose.yml`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm test`, expecting `Tests  `**
- [ ] **Step 6: export: run `(cd apps/app && EXPO_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA npx expo export --platform web 2>&1 | tail -8)`, expecting `Exported`**
- [ ] **Step 7: compose-config: run `docker compose --env-file infra/.env.example -f infra/compose.yml config -q && echo config-ok`, expecting `config-ok`**
- [ ] **Step 8: stack-down: run `docker compose -f infra/compose.yml -f infra/compose.dev.yml down && echo down-ok`, expecting `down-ok`**
- [ ] **Step 9: build: run the `build` command in the prompt, expecting `build-exit=0`**
- [ ] **Step 10: stack-up: run `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --wait && echo up-ok`, expecting `up-ok`**
- [ ] **Step 11: test-database: run `node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `migrations applied`, `test database ready: korbat_test`**
- [ ] **Step 12: smoke: run the `smoke` command in the prompt, expecting `smoke test passed`**
- [ ] **Step 13: stack-stop: run the `stack-stop` command in the prompt, expecting `postgres-1 Up`**
- [ ] **Step 14: Commit: `feat(app): Settings gains a navigation row and two screens: Profile (display name, bio, a handle change with the date the next one is allowed) and Account (email change, the verified badge with what it means and where the number goes, the data export saved as a download, deletion behind a code and the typed handle); posts and profiles show a Verified chip; the terms name the verification provider, the export and the deletion; WEB_BADGE lets a build without a provider leave the badge section out`**

### Task 8: Fixes from the adversarial review and the browser walk-through: atomic badge attempts and wider badge-start limits, a one-shot link that undoes an email change, the deletion's first step in one transaction with the file deletions requested before the purge commits, shared locks against writes on a purged account, and the web, contract and export items the review upheld

**Prompt:** `docs/superpowers/prompts/account-lifecycle-1b/08-review-fixes.md`

**Files:**
- Create: `apps/api/test/integration/account-takedown.test.ts`
- Create: `apps/api/test/integration/rate-limit-redis.test.ts`
- Create: `apps/app/src/app/email-revert/[token].tsx`
- Modify: `apps/api/src/account/flows/deletion.ts`
- Modify: `apps/api/src/account/flows/export.ts`
- Modify: `apps/api/src/account/routes.ts`
- Modify: `apps/api/src/account/zip.ts`
- Modify: `apps/api/src/auth/flows/badge.ts`
- Modify: `apps/api/src/auth/flows/deletion.ts`
- Modify: `apps/api/src/auth/flows/email-change.ts`
- Modify: `apps/api/src/auth/index.ts`
- Modify: `apps/api/src/auth/repo.ts`
- Modify: `apps/api/src/auth/routes.ts`
- Modify: `apps/api/src/auth/sessions.ts`
- Modify: `apps/api/src/mail/mailer.ts`
- Modify: `apps/api/src/mail/templates.ts`
- Modify: `apps/api/src/media/index.ts`
- Modify: `apps/api/src/middleware/rate-limit.ts`
- Modify: `apps/api/src/social/flows/export.ts`
- Modify: `apps/api/src/social/index.ts`
- Modify: `apps/api/src/social/repo.ts`
- Modify: `apps/api/test/account/deletion.test.ts`
- Modify: `apps/api/test/account/export.test.ts`
- Modify: `apps/api/test/auth/badge.test.ts`
- Modify: `apps/api/test/auth/deletion.test.ts`
- Modify: `apps/api/test/auth/email-change.test.ts`
- Modify: `apps/api/test/auth/flow-harness.ts`
- Modify: `apps/api/test/integration/account-deletion.test.ts`
- Modify: `apps/api/test/integration/account-export.test.ts`
- Modify: `apps/api/test/integration/http-auth.test.ts`
- Modify: `apps/api/test/integration/http-e2e.test.ts`
- Modify: `apps/api/test/integration/social-repo.test.ts`
- Modify: `apps/api/test/mail/templates.test.ts`
- Modify: `apps/api/test/middleware.test.ts`
- Modify: `apps/api/test/social/limits.test.ts`
- Modify: `apps/app/.env.example`
- Modify: `apps/app/src/app/settings/account.tsx`
- Modify: `apps/app/src/app/settings/profile.tsx`
- Modify: `apps/app/src/components/ui.tsx`
- Modify: `apps/app/test/lifecycle.test.tsx`
- Modify: `apps/app/vitest.config.mts`
- Modify: `infra/.env.example`
- Modify: `infra/caddy/Dockerfile`
- Modify: `infra/compose.yml`
- Modify: `packages/contracts/src/auth.ts`
- Modify: `packages/contracts/src/social.ts`
- Modify: `packages/contracts/test/auth.test.ts`
- Modify: `packages/contracts/test/social.test.ts`

- [ ] **Step 1: Write the failing tests: `apps/api/test/integration/account-takedown.test.ts`, `apps/api/test/integration/rate-limit-redis.test.ts`, `apps/api/test/account/deletion.test.ts`, `apps/api/test/account/export.test.ts`, `apps/api/test/auth/badge.test.ts`, `apps/api/test/auth/deletion.test.ts`, `apps/api/test/auth/email-change.test.ts`, `apps/api/test/auth/flow-harness.ts`, `apps/api/test/integration/account-deletion.test.ts`, `apps/api/test/integration/account-export.test.ts`, `apps/api/test/integration/http-auth.test.ts`, `apps/api/test/integration/http-e2e.test.ts`, `apps/api/test/integration/social-repo.test.ts`, `apps/api/test/mail/templates.test.ts`, `apps/api/test/middleware.test.ts`, `apps/api/test/social/limits.test.ts`, `apps/app/test/lifecycle.test.tsx`, `apps/app/vitest.config.mts`, `packages/contracts/test/auth.test.ts`, `packages/contracts/test/social.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/app/src/app/email-revert/[token].tsx`, `apps/api/src/account/flows/deletion.ts`, `apps/api/src/account/flows/export.ts`, `apps/api/src/account/routes.ts`, `apps/api/src/account/zip.ts`, `apps/api/src/auth/flows/badge.ts`, `apps/api/src/auth/flows/deletion.ts`, `apps/api/src/auth/flows/email-change.ts`, `apps/api/src/auth/index.ts`, `apps/api/src/auth/repo.ts`, `apps/api/src/auth/routes.ts`, `apps/api/src/auth/sessions.ts`, `apps/api/src/mail/mailer.ts`, `apps/api/src/mail/templates.ts`, `apps/api/src/media/index.ts`, `apps/api/src/middleware/rate-limit.ts`, `apps/api/src/social/flows/export.ts`, `apps/api/src/social/index.ts`, `apps/api/src/social/repo.ts`, `apps/app/.env.example`, `apps/app/src/app/settings/account.tsx`, `apps/app/src/app/settings/profile.tsx`, `apps/app/src/components/ui.tsx`, `infra/.env.example`, `infra/caddy/Dockerfile`, `infra/compose.yml`, `packages/contracts/src/auth.ts`, `packages/contracts/src/social.ts`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm test`, expecting `Tests  `**
- [ ] **Step 6: integration: run `cd apps/api && set -a && . ./.env && set +a && pnpm test:integration`, expecting `Tests  `**
- [ ] **Step 7: api-bundle: run `pnpm --filter @korbat/api build 2>&1 | tail -2 && node --check apps/api/dist/index.js && echo bundle-ok`, expecting `Build success`, `bundle-ok`**
- [ ] **Step 8: export: run `(cd apps/app && EXPO_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA npx expo export --platform web 2>&1 | tail -8)`, expecting `Exported`**
- [ ] **Step 9: compose-config: run `docker compose --env-file infra/.env.example -f infra/compose.yml config -q && echo config-ok`, expecting `config-ok`**
- [ ] **Step 10: stack-down: run `docker compose -f infra/compose.yml -f infra/compose.dev.yml down && echo down-ok`, expecting `down-ok`**
- [ ] **Step 11: build: run the `build` command in the prompt, expecting `build-exit=0`**
- [ ] **Step 12: stack-up: run `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --wait && echo up-ok`, expecting `up-ok`**
- [ ] **Step 13: test-database: run `node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `migrations applied`, `test database ready: korbat_test`**
- [ ] **Step 14: smoke: run the `smoke` command in the prompt, expecting `smoke test passed`**
- [ ] **Step 15: stack-stop: run the `stack-stop` command in the prompt, expecting `postgres-1 Up`**
- [ ] **Step 16: Commit: `fix(account): what the review of 1b upheld, fixed: badge attempts are counted atomically and badge starts are limited per IP and instance-wide; a one-shot link lets the old address undo an email change; the deletion's first step is one transaction that the purge repeats, the purge requests its file deletions (pending uploads too) before committing, and every social write takes a key-share lock so none lands on a purged account; the export writes a ZIP64-capable archive, streams export.json in pages, opens images through the media checks, gives the day back on an early failure and breaks the download on a late one; plus the web and contract fixes listed in the 1b design's amendments`**

### Task 9: The README's account section, 1b recorded in the 1a and 2b specs and the main design, the 1b spec's dry-run amendments, one contract comment corrected

**Prompt:** `docs/superpowers/prompts/account-lifecycle-1b/09-documentation.md`

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-09-14-identity-auth-1a-design.md`
- Modify: `docs/superpowers/specs/2026-09-18-images-2b-design.md`
- Modify: `docs/superpowers/specs/2026-09-03-korbat-design.md`
- Modify: `docs/superpowers/specs/2026-09-24-account-lifecycle-1b-design.md`
- Modify: `packages/contracts/src/auth.ts`

- [ ] **Step 1: Write the files: `README.md`, `docs/superpowers/specs/2026-09-14-identity-auth-1a-design.md`, `docs/superpowers/specs/2026-09-18-images-2b-design.md`, `docs/superpowers/specs/2026-09-03-korbat-design.md`, `docs/superpowers/specs/2026-09-24-account-lifecycle-1b-design.md`, `packages/contracts/src/auth.ts`**
- [ ] **Step 2: sections: run the `sections` command in the prompt, expecting `1`**
- [ ] **Step 3: line-endings: run the `line-endings` command in the prompt, expecting `crlf-files []`**
- [ ] **Step 4: contracts: run `pnpm --filter @korbat/contracts test`, expecting `Tests  `**
- [ ] **Step 5: Commit: `docs: the README explains profile, email, badge, export and deletion; the 1a and 2b specs and the main design record what 1b delivered; the 1b spec gains its dry-run amendments; the MeProfile comment names what the profile-editing routes return`**
