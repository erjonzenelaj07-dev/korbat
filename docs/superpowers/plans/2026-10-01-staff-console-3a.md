# korbat — Staff Console (3a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff powers live only on a console of their own: staff keys enrolled through links the command line issues as the migrator, staff sessions apart from user sessions, a per-action step-up whose assertion is stored in the record, and the audit log as a hash chain that `audit-verify` checks in its own code against heads kept off the server.

**Architecture:** Nine commits: the ground (the settings, the contracts, migration 0012 with the chain and the migrator-owned functions), the staff module and the audit record, staff keys and enrolment, staff sign-in and sessions, step-up, the console app (`apps/admin`), its infrastructure (Caddy's console site, Compose, the smoke test, the committed browser check), the fixes an adversarial review and a browser walk-through upheld, and the documentation.

**Tech Stack:** Node 24, TypeScript 7, Hono 4.13, zod 4, drizzle and hand-written SQL (a SECURITY DEFINER trigger and functions), PostgreSQL 18, Valkey, @simplewebauthn/server 14, React 19 with esbuild 0.28 for the console, playwright-core 1.63 for its browser check, Caddy 2.11, vitest 4.

**Complete code:** each task's full files, commands and observed output are in `docs/superpowers/prompts/staff-console-3a/NN-<slug>.md`, generated from a verified dry run. This plan is the map. Where it and a prompt differ, the prompt wins.

**Spec:** `docs/superpowers/specs/2026-09-28-staff-console-3a-design.md`.

---

## File structure

- `apps/admin/`: `build.d.mts` (Task 6), `build.mjs` (Task 6), `dev-server.d.mts` (Task 6), `dev-server.mjs` (Task 6), `dev.mjs` (Task 6), `site-headers.d.mts` (Task 6), `site-headers.mjs` (Task 6), `tsconfig.json` (Task 6), `vitest.config.ts` (Task 6), `vitest.browser.config.ts` (Task 7)
- `apps/admin/public/`: `favicon.svg` (Task 6)
- `apps/admin/src/`: `App.tsx` (Task 6), `Layout.tsx` (Task 6), `api.ts` (Task 6), `app.css` (Task 6), `audit-log.ts` (Task 6), `css.d.ts` (Task 6), `enroll.ts` (Task 6), `idle.ts` (Task 6), `main.tsx` (Task 6), `messages.ts` (Task 6), `nav.tsx` (Task 6), `react-dom.d.ts` (Task 6), `router.ts` (Task 6), `signins.ts` (Task 6), `step-up.ts` (Task 6), `store.ts` (Task 6), `ui.tsx` (Task 6), `webauthn.ts` (Task 6), `zod-jitless.ts` (Task 6), `challenge.ts` (Task 8), `sign-in.ts` (Task 8)
- `apps/admin/src/screens/`: `Audit.tsx` (Task 6), `Enroll.tsx` (Task 6), `Home.tsx` (Task 6), `SignIn.tsx` (Task 6), `Unavailable.tsx` (Task 6)
- `apps/admin/test/`: `api.test.ts` (Task 6), `audit-log.test.ts` (Task 6), `build.test.ts` (Task 6), `dev-server.test.ts` (Task 6), `enroll.test.ts` (Task 6), `fixtures.ts` (Task 6), `idle.test.ts` (Task 6), `router.test.ts` (Task 6), `screens.test.tsx` (Task 6), `signins.test.ts` (Task 6), `source.test.ts` (Task 6), `step-up.test.ts` (Task 6), `store.test.ts` (Task 6), `webauthn.test.ts` (Task 6), `caddyfile.ts` (Task 7), `console-site.test.ts` (Task 7), `fixture-statuses.test.ts` (Task 8), `sign-in.test.ts` (Task 8)
- `apps/admin/test/browser/`: `console.browser.ts` (Task 7), `fixture-api.ts` (Task 7), `server.ts` (Task 7), `watch.ts` (Task 7)
- `apps/api/src/auth/staff/`: `enroll.ts` (Task 3), `cookies.ts` (Task 4), `middleware.ts` (Task 4), `revoke.ts` (Task 4), `sessions.ts` (Task 4), `signin.ts` (Task 4), `step-up.ts` (Task 5)
- `apps/api/src/cli/`: `lock-timeout.ts` (Task 2), `staff.ts` (Task 2), `mail.ts` (Task 3)
- `apps/api/src/staff/`: `audit.ts` (Task 2), `chain.ts` (Task 2), `gate.ts` (Task 2), `index.ts` (Task 2), `routes.ts` (Task 2)
- `apps/api/test/`: `cli-staff.test.ts` (Task 2), `http-client.test.ts` (Task 2), `cli-mail.test.ts` (Task 3)
- `apps/api/test/auth/`: `staff-cookies.test.ts` (Task 4)
- `apps/api/test/integration/`: `audit-chain-schema.test.ts` (Task 1), `staff-fixtures.ts` (Task 1), `staff-schema.test.ts` (Task 1), `audit-verify.test.ts` (Task 2), `staff-audit.test.ts` (Task 2), `cli-staff-enroll.test.ts` (Task 3), `http-staff-enroll.test.ts` (Task 3), `staff-enroll.test.ts` (Task 3), `staff-enrolment.ts` (Task 3), `staff-lifecycle.test.ts` (Task 3), `cli-staff-revoke.test.ts` (Task 4), `http-staff-sessions.test.ts` (Task 4), `staff-sign-in.ts` (Task 4), `staff-signin.test.ts` (Task 4), `staff-step-up.test.ts` (Task 5), `staff-step-up.ts` (Task 5)
- `apps/api/test/staff/`: `app-mount.test.ts` (Task 2), `chain-vectors.ts` (Task 2), `chain.test.ts` (Task 2), `gate.test.ts` (Task 2), `route-table.test.ts` (Task 5)
- `packages/contracts/src/`: `staff.ts` (Task 1)
- `packages/contracts/test/`: `staff.test.ts` (Task 1)
- `packages/db/migrations/`: `0012_aberrant_wendell_vaughn.sql` (Task 1), `0013_forget_revoked_staff_keys.sql` (Task 8)
- `packages/db/migrations/meta/`: `0012_snapshot.json` (Task 1), `0013_snapshot.json` (Task 8)

## Tasks

### Task 1: The ground for the staff console: the console's origin and relying party settings, the staff contracts, migration 0012 (staff keys, enrolments and staff sessions guarded by the database; the audit log as a hash chain with its head, trigger and back-fill; the migrator-owned functions that add a staff key, append the auth side's audit rows and forget a deleted account's keys), the schema test, the harness's head row and the development cleaner's skip

**Prompt:** `docs/superpowers/prompts/staff-console-3a/01-ground.md`

**Files:**
- Create: `apps/api/test/integration/audit-chain-schema.test.ts`
- Create: `apps/api/test/integration/staff-fixtures.ts`
- Create: `apps/api/test/integration/staff-schema.test.ts`
- Create: `packages/contracts/src/staff.ts`
- Create: `packages/contracts/test/staff.test.ts`
- Create: `packages/db/migrations/0012_aberrant_wendell_vaughn.sql`
- Create: `packages/db/migrations/meta/0012_snapshot.json`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/test/config.test.ts`
- Modify: `apps/api/test/integration/global-setup.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/db/migrations/meta/_journal.json`
- Modify: `packages/db/src/schema/auth.ts`
- Modify: `packages/db/src/schema/safety.ts`
- Modify: `packages/db/test/schema.test.ts`
- Modify: `scripts/clean-dev-fixtures.mjs`

- [ ] **Step 1: Write the failing tests: `apps/api/test/integration/audit-chain-schema.test.ts`, `apps/api/test/integration/staff-fixtures.ts`, `apps/api/test/integration/staff-schema.test.ts`, `packages/contracts/test/staff.test.ts`, `apps/api/test/config.test.ts`, `apps/api/test/integration/global-setup.ts`, `packages/db/test/schema.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `packages/contracts/src/staff.ts`, `packages/db/migrations/0012_aberrant_wendell_vaughn.sql`, `packages/db/migrations/meta/0012_snapshot.json`, `apps/api/src/config.ts`, `packages/contracts/src/index.ts`, `packages/db/migrations/meta/_journal.json`, `packages/db/src/schema/auth.ts`, `packages/db/src/schema/safety.ts`, `scripts/clean-dev-fixtures.mjs`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm test`, expecting `Tests  `**
- [ ] **Step 6: generate: run `pnpm --filter @korbat/db generate`, expecting `No schema changes`**
- [ ] **Step 7: apply-migrations: run the `apply-migrations` command in the prompt, expecting `migrations applied`, `count=13`**
- [ ] **Step 8: chain: run the `chain` command in the prompt, expecting `chain=t`**
- [ ] **Step 9: test-database: run `node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `migrations applied`, `test database ready: korbat_test`**
- [ ] **Step 10: integration: run `cd apps/api && set -a && . ./.env && set +a && pnpm test:integration`, expecting `Tests  `**
- [ ] **Step 11: api-bundle: run `pnpm --filter @korbat/api build 2>&1 | tail -2 && node --check apps/api/dist/index.js && echo bundle-ok`, expecting `Build success`, `bundle-ok`**
- [ ] **Step 12: Commit: `feat(contracts,db,api): the ground for the staff console: CONSOLE_ORIGIN and CONSOLE_RP_ID with their rules; the staff contracts and error codes; migration 0012 adds auth.staff_keys, staff_enrollments and staff_sessions, which korbat_auth can revoke but never create or revive, and seven staff event types, and turns the audit log into a hash chain: a migrator-owned trigger places every row under the head's lock, choosing its place, id and time itself, over the canonical text version 1, and the rows written before are chained in id order; auth.add_staff_key, auth.append_audit and auth.forget_staff_keys are the only ways the auth role writes them; the test harness writes the head row and the development cleaner keeps accounts that hold staff keys`**

### Task 2: The staff module and the audit record: chain.ts (the canonical text in Node with its test vectors), the audit writer and reader, the module mounted only while CONSOLE_ORIGIN is set and passed over the app's CORS and session, the staff gate, the architecture rules, staff.js audit-head and audit-verify with kept places, grant-role's change and record in one auth transaction, and the integration client's console mode

**Prompt:** `docs/superpowers/prompts/staff-console-3a/02-staff-module-record.md`

**Files:**
- Create: `apps/api/src/cli/lock-timeout.ts`
- Create: `apps/api/src/cli/staff.ts`
- Create: `apps/api/src/staff/audit.ts`
- Create: `apps/api/src/staff/chain.ts`
- Create: `apps/api/src/staff/gate.ts`
- Create: `apps/api/src/staff/index.ts`
- Create: `apps/api/src/staff/routes.ts`
- Create: `apps/api/test/cli-staff.test.ts`
- Create: `apps/api/test/http-client.test.ts`
- Create: `apps/api/test/integration/audit-verify.test.ts`
- Create: `apps/api/test/integration/staff-audit.test.ts`
- Create: `apps/api/test/staff/app-mount.test.ts`
- Create: `apps/api/test/staff/chain-vectors.ts`
- Create: `apps/api/test/staff/chain.test.ts`
- Create: `apps/api/test/staff/gate.test.ts`
- Modify: `apps/api/build.mjs`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/auth/admin.ts`
- Modify: `apps/api/src/auth/index.ts`
- Modify: `apps/api/src/auth/repo.ts`
- Modify: `apps/api/src/cli/grant-role.ts`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/test/architecture.test.ts`
- Modify: `apps/api/test/integration/cli-grant-role.test.ts`
- Modify: `apps/api/test/integration/http-client.ts`

- [ ] **Step 1: Write the failing tests: `apps/api/test/cli-staff.test.ts`, `apps/api/test/http-client.test.ts`, `apps/api/test/integration/audit-verify.test.ts`, `apps/api/test/integration/staff-audit.test.ts`, `apps/api/test/staff/app-mount.test.ts`, `apps/api/test/staff/chain-vectors.ts`, `apps/api/test/staff/chain.test.ts`, `apps/api/test/staff/gate.test.ts`, `apps/api/test/architecture.test.ts`, `apps/api/test/integration/cli-grant-role.test.ts`, `apps/api/test/integration/http-client.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm --filter @korbat/api test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/api/src/cli/lock-timeout.ts`, `apps/api/src/cli/staff.ts`, `apps/api/src/staff/audit.ts`, `apps/api/src/staff/chain.ts`, `apps/api/src/staff/gate.ts`, `apps/api/src/staff/index.ts`, `apps/api/src/staff/routes.ts`, `apps/api/build.mjs`, `apps/api/src/app.ts`, `apps/api/src/auth/admin.ts`, `apps/api/src/auth/index.ts`, `apps/api/src/auth/repo.ts`, `apps/api/src/cli/grant-role.ts`, `apps/api/src/config.ts`, `apps/api/src/index.ts`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm test`, expecting `Tests  `**
- [ ] **Step 6: integration: run `cd apps/api && set -a && . ./.env && set +a && pnpm test:integration`, expecting `Tests  `**
- [ ] **Step 7: api-bundle: run `pnpm --filter @korbat/api build 2>&1 | tail -2 && node --check apps/api/dist/index.js && echo bundle-ok`, expecting `Build success`, `bundle-ok`**
- [ ] **Step 8: staff-cli: run the `staff-cli` command in the prompt, expecting `usage: node dist/staff.js <command>`, `audit-verify [<chain_seq>:<hash> ...]`, `staff-exit=2`**
- [ ] **Step 9: audit-verify-dev: run the `audit-verify-dev` command in the prompt, expecting `audit-verify: the chain holds:`, `staff keys checked`, `verify-exit=0`**
- [ ] **Step 10: Commit: `feat(api): the staff module and the audit record: chain.ts recomputes the canonical text and the hash in Node, byte for byte with the trigger's, against shared test vectors; the staff module is mounted only while CONSOLE_ORIGIN is set, never meets the app's CORS or session, and stands behind a gate that answers another Host 404 and another Origin or Sec-Fetch-Site 403; staff.js audit-head prints the newest place and hash, and audit-verify reads the head and the rows in one snapshot, recomputes every hash in its own code, checks places kept off the server and that every staff key was added on the record, with only the database URLs it needs; grant-role changes the role and writes its record in one auth transaction through auth.append_audit, giving up after 10 seconds on a held head; the integration client speaks to the console's host with the staff CSRF header`**

### Task 3: Staff keys and enrolment: the codec's staff purposes and any-string binding, the wrapper's user verification, security-key hint and BE report, the enrolment flow and its routes through auth.add_staff_key, staff.js enroll in the migrate service and staff.js keys, grant-role's and the take-down's staff rows, and the four staff mails

**Prompt:** `docs/superpowers/prompts/staff-console-3a/03-staff-keys-enrolment.md`

**Files:**
- Create: `apps/api/src/auth/staff/enroll.ts`
- Create: `apps/api/src/cli/mail.ts`
- Create: `apps/api/test/cli-mail.test.ts`
- Create: `apps/api/test/integration/cli-staff-enroll.test.ts`
- Create: `apps/api/test/integration/http-staff-enroll.test.ts`
- Create: `apps/api/test/integration/staff-enroll.test.ts`
- Create: `apps/api/test/integration/staff-enrolment.ts`
- Create: `apps/api/test/integration/staff-lifecycle.test.ts`
- Modify: `apps/api/src/auth/admin.ts`
- Modify: `apps/api/src/auth/context.ts`
- Modify: `apps/api/src/auth/flows/notify.ts`
- Modify: `apps/api/src/auth/index.ts`
- Modify: `apps/api/src/auth/passkeys/challenge.ts`
- Modify: `apps/api/src/auth/passkeys/flows.ts`
- Modify: `apps/api/src/auth/passkeys/webauthn.ts`
- Modify: `apps/api/src/auth/repo.ts`
- Modify: `apps/api/src/cli/grant-role.ts`
- Modify: `apps/api/src/cli/staff.ts`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/mail/mailer.ts`
- Modify: `apps/api/src/mail/templates.ts`
- Modify: `apps/api/src/staff/index.ts`
- Modify: `apps/api/src/staff/routes.ts`
- Modify: `apps/api/test/auth/flow-harness.ts`
- Modify: `apps/api/test/auth/messages.test.ts`
- Modify: `apps/api/test/auth/passkey-challenge.test.ts`
- Modify: `apps/api/test/auth/passkey-webauthn.test.ts`
- Modify: `apps/api/test/cli-staff.test.ts`
- Modify: `apps/api/test/integration/auth-flows-account.test.ts`
- Modify: `apps/api/test/integration/cli-grant-role.test.ts`
- Modify: `apps/api/test/integration/flow-harness.ts`
- Modify: `apps/api/test/integration/staff-fixtures.ts`
- Modify: `apps/api/test/mail/templates.test.ts`
- Modify: `apps/api/test/staff/app-mount.test.ts`
- Modify: `infra/compose.yml`

- [ ] **Step 1: Write the failing tests: `apps/api/test/cli-mail.test.ts`, `apps/api/test/integration/cli-staff-enroll.test.ts`, `apps/api/test/integration/http-staff-enroll.test.ts`, `apps/api/test/integration/staff-enroll.test.ts`, `apps/api/test/integration/staff-enrolment.ts`, `apps/api/test/integration/staff-lifecycle.test.ts`, `apps/api/test/auth/flow-harness.ts`, `apps/api/test/auth/messages.test.ts`, `apps/api/test/auth/passkey-challenge.test.ts`, `apps/api/test/auth/passkey-webauthn.test.ts`, `apps/api/test/cli-staff.test.ts`, `apps/api/test/integration/auth-flows-account.test.ts`, `apps/api/test/integration/cli-grant-role.test.ts`, `apps/api/test/integration/flow-harness.ts`, `apps/api/test/integration/staff-fixtures.ts`, `apps/api/test/mail/templates.test.ts`, `apps/api/test/staff/app-mount.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm --filter @korbat/api test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/api/src/auth/staff/enroll.ts`, `apps/api/src/cli/mail.ts`, `apps/api/src/auth/admin.ts`, `apps/api/src/auth/context.ts`, `apps/api/src/auth/flows/notify.ts`, `apps/api/src/auth/index.ts`, `apps/api/src/auth/passkeys/challenge.ts`, `apps/api/src/auth/passkeys/flows.ts`, `apps/api/src/auth/passkeys/webauthn.ts`, `apps/api/src/auth/repo.ts`, `apps/api/src/cli/grant-role.ts`, `apps/api/src/cli/staff.ts`, `apps/api/src/config.ts`, `apps/api/src/index.ts`, `apps/api/src/mail/mailer.ts`, `apps/api/src/mail/templates.ts`, `apps/api/src/staff/index.ts`, `apps/api/src/staff/routes.ts`, `infra/compose.yml`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm test`, expecting `Tests  `**
- [ ] **Step 6: integration: run `cd apps/api && set -a && . ./.env && set +a && pnpm test:integration`, expecting `Tests  `**
- [ ] **Step 7: api-bundle: run `pnpm --filter @korbat/api build 2>&1 | tail -2 && node --check apps/api/dist/index.js && echo bundle-ok`, expecting `Build success`, `bundle-ok`**
- [ ] **Step 8: compose-config: run `docker compose --env-file infra/.env.example -f infra/compose.yml config -q && echo config-ok`, expecting `config-ok`**
- [ ] **Step 9: staff-cli: run the `staff-cli` command in the prompt, expecting `usage: node dist/staff.js <command>`, `enroll <email>`, `keys [<email>]`, `audit-verify [<chain_seq>:<hash> ...]`, `staff-exit=2`**
- [ ] **Step 10: enroll-console-off: run the `enroll-console-off` command in the prompt, expecting `CONSOLE_ORIGIN is not set: the staff console is off`, `enroll-exit=1`**
- [ ] **Step 11: audit-verify-dev: run the `audit-verify-dev` command in the prompt, expecting `audit-verify: the chain holds:`, `staff keys checked`, `verify-exit=0`**
- [ ] **Step 12: Commit: `feat(api,infra): staff keys and enrolment: staff.js enroll, run in the migrate service as the migrator, issues a 30-minute single-use link for a live staff account with a handle and records the console's origin and relying party ID on it; the console's enrolment options require user verification and offer a security key or this device, and verify refuses a key that reported no UV or BE after the library has checked it, keeping the link, then stores the key through auth.add_staff_key under the account's lock with its auth event and audit row in one transaction and mails its owner; staff routes answer staff_key_refused, never a passkey code; while the two relying party IDs are equal each kind's options exclude the other's credentials; staff.js keys lists keys with their AAGUID; a role change revokes every session and staff session and cancels open links, and a demotion revokes staff keys and mails their owner; the take-down revokes staff keys and sessions, blanks the keys' names and writes its record after account_deleted`**

### Task 4: Staff sign-in and sessions: the sign-in flow with one staff_key_invalid answer, the counter rule's revocation, the uncached session store with the activity mark, requireStaff with the staff CSRF check, the staff cookies, the me, sessions, keys and audit routes, sign-out, staff.js revoke, the janitor's staff retention, and requireStaffMfa removed

**Prompt:** `docs/superpowers/prompts/staff-console-3a/04-staff-sign-in-sessions.md`

**Files:**
- Create: `apps/api/src/auth/staff/cookies.ts`
- Create: `apps/api/src/auth/staff/middleware.ts`
- Create: `apps/api/src/auth/staff/revoke.ts`
- Create: `apps/api/src/auth/staff/sessions.ts`
- Create: `apps/api/src/auth/staff/signin.ts`
- Create: `apps/api/test/auth/staff-cookies.test.ts`
- Create: `apps/api/test/integration/cli-staff-revoke.test.ts`
- Create: `apps/api/test/integration/http-staff-sessions.test.ts`
- Create: `apps/api/test/integration/staff-sign-in.ts`
- Create: `apps/api/test/integration/staff-signin.test.ts`
- Modify: `apps/api/src/auth/index.ts`
- Modify: `apps/api/src/auth/janitor.ts`
- Modify: `apps/api/src/auth/middleware.ts`
- Modify: `apps/api/src/auth/repo.ts`
- Modify: `apps/api/src/auth/staff/enroll.ts`
- Modify: `apps/api/src/cli/mail.ts`
- Modify: `apps/api/src/cli/staff.ts`
- Modify: `apps/api/src/env.ts`
- Modify: `apps/api/src/staff/index.ts`
- Modify: `apps/api/src/staff/routes.ts`
- Modify: `apps/api/test/cli-staff.test.ts`
- Modify: `apps/api/test/integration/auth-janitor.test.ts`
- Modify: `apps/api/test/integration/http-auth.test.ts`
- Modify: `apps/api/test/integration/staff-audit.test.ts`
- Modify: `apps/api/test/integration/staff-enrolment.ts`
- Modify: `apps/api/test/integration/staff-fixtures.ts`
- Modify: `apps/api/test/staff/app-mount.test.ts`
- Modify: `apps/api/test/staff/gate.test.ts`
- Modify: `apps/app/src/components/security/MfaSection.tsx`
- Modify: `apps/app/test/passkeys.test.tsx`

- [ ] **Step 1: Write the failing tests: `apps/api/test/auth/staff-cookies.test.ts`, `apps/api/test/integration/cli-staff-revoke.test.ts`, `apps/api/test/integration/http-staff-sessions.test.ts`, `apps/api/test/integration/staff-sign-in.ts`, `apps/api/test/integration/staff-signin.test.ts`, `apps/api/test/cli-staff.test.ts`, `apps/api/test/integration/auth-janitor.test.ts`, `apps/api/test/integration/http-auth.test.ts`, `apps/api/test/integration/staff-audit.test.ts`, `apps/api/test/integration/staff-enrolment.ts`, `apps/api/test/integration/staff-fixtures.ts`, `apps/api/test/staff/app-mount.test.ts`, `apps/api/test/staff/gate.test.ts`, `apps/app/test/passkeys.test.tsx`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/api/src/auth/staff/cookies.ts`, `apps/api/src/auth/staff/middleware.ts`, `apps/api/src/auth/staff/revoke.ts`, `apps/api/src/auth/staff/sessions.ts`, `apps/api/src/auth/staff/signin.ts`, `apps/api/src/auth/index.ts`, `apps/api/src/auth/janitor.ts`, `apps/api/src/auth/middleware.ts`, `apps/api/src/auth/repo.ts`, `apps/api/src/auth/staff/enroll.ts`, `apps/api/src/cli/mail.ts`, `apps/api/src/cli/staff.ts`, `apps/api/src/env.ts`, `apps/api/src/staff/index.ts`, `apps/api/src/staff/routes.ts`, `apps/app/src/components/security/MfaSection.tsx`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm test`, expecting `Tests  `**
- [ ] **Step 6: integration: run `cd apps/api && set -a && . ./.env && set +a && pnpm test:integration`, expecting `Tests  `**
- [ ] **Step 7: api-bundle: run `pnpm --filter @korbat/api build 2>&1 | tail -2 && node --check apps/api/dist/index.js && echo bundle-ok`, expecting `Build success`, `bundle-ok`**
- [ ] **Step 8: staff-cli: run the `staff-cli` command in the prompt, expecting `usage: node dist/staff.js <command>`, `enroll <email>`, `keys [<email>]`, `revoke <email> <key id>`, `revoke <email> all`, `audit-verify [<chain_seq>:<hash> ...]`, `staff-exit=2`**
- [ ] **Step 9: audit-verify-dev: run the `audit-verify-dev` command in the prompt, expecting `audit-verify: the chain holds:`, `staff keys checked`, `verify-exit=0`**
- [ ] **Step 10: Commit: `feat(api,app): staff sign-in and sessions: a staff key signs in on the console with user verification, its flags checked after the signature and every earlier failure one staff_key_invalid answer, limited per IP first and per key only after the signature; a counter that goes backwards revokes the key and every staff session it opened and mails its owner; staff sessions are read from the database on every request, never cached, their idle end moved only by requests the console marks as its person's own and never past 12 hours, behind a staff cookie with a staff CSRF header; the console reads its session, sessions, keys and the audit log, and signs out; staff.js revoke revokes one key or all of an account's with its sessions and open links, in one transaction with its record, and mails the owner when a key went; the janitor deletes ended staff sessions after 30 days and spent links after a day; requireStaffMfa is gone and the Security screen says staff tools open only with a staff key`**

### Task 5: Step-up: the 74-byte step-up challenge in the codec and the contracts, the parameter-bound action hash over STAFF_STEP_UP_ACTIONS, the step-up flow and requireStaffStepUp, DELETE /api/staff/sessions/:handle confirmed by the session's key with its assertion stored in the record, audit-verify's step-up and key checks, and the route-table tests

**Prompt:** `docs/superpowers/prompts/staff-console-3a/05-step-up.md`

**Files:**
- Create: `apps/api/src/auth/staff/step-up.ts`
- Create: `apps/api/test/integration/staff-step-up.test.ts`
- Create: `apps/api/test/integration/staff-step-up.ts`
- Create: `apps/api/test/staff/route-table.test.ts`
- Modify: `apps/api/src/auth/index.ts`
- Modify: `apps/api/src/auth/passkeys/challenge.ts`
- Modify: `apps/api/src/auth/passkeys/webauthn.ts`
- Modify: `apps/api/src/auth/repo.ts`
- Modify: `apps/api/src/auth/staff/middleware.ts`
- Modify: `apps/api/src/auth/staff/revoke.ts`
- Modify: `apps/api/src/auth/staff/signin.ts`
- Modify: `apps/api/src/cli/staff.ts`
- Modify: `apps/api/src/env.ts`
- Modify: `apps/api/src/staff/routes.ts`
- Modify: `apps/api/test/auth/passkey-challenge.test.ts`
- Modify: `apps/api/test/auth/passkey-webauthn.test.ts`
- Modify: `apps/api/test/integration/audit-verify.test.ts`
- Modify: `apps/api/test/integration/http-staff-sessions.test.ts`
- Modify: `apps/api/test/staff/app-mount.test.ts`
- Modify: `packages/contracts/src/staff.ts`
- Modify: `packages/contracts/test/staff.test.ts`

- [ ] **Step 1: Write the failing tests: `apps/api/test/integration/staff-step-up.test.ts`, `apps/api/test/integration/staff-step-up.ts`, `apps/api/test/staff/route-table.test.ts`, `apps/api/test/auth/passkey-challenge.test.ts`, `apps/api/test/auth/passkey-webauthn.test.ts`, `apps/api/test/integration/audit-verify.test.ts`, `apps/api/test/integration/http-staff-sessions.test.ts`, `apps/api/test/staff/app-mount.test.ts`, `packages/contracts/test/staff.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/api/src/auth/staff/step-up.ts`, `apps/api/src/auth/index.ts`, `apps/api/src/auth/passkeys/challenge.ts`, `apps/api/src/auth/passkeys/webauthn.ts`, `apps/api/src/auth/repo.ts`, `apps/api/src/auth/staff/middleware.ts`, `apps/api/src/auth/staff/revoke.ts`, `apps/api/src/auth/staff/signin.ts`, `apps/api/src/cli/staff.ts`, `apps/api/src/env.ts`, `apps/api/src/staff/routes.ts`, `packages/contracts/src/staff.ts`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm test`, expecting `Tests  `**
- [ ] **Step 6: integration: run `cd apps/api && set -a && . ./.env && set +a && pnpm test:integration`, expecting `Tests  `**
- [ ] **Step 7: api-bundle: run `pnpm --filter @korbat/api build 2>&1 | tail -2 && node --check apps/api/dist/index.js && echo bundle-ok`, expecting `Build success`, `bundle-ok`**
- [ ] **Step 8: staff-cli: run the `staff-cli` command in the prompt, expecting `usage: node dist/staff.js <command>`, `revoke <email> all`, `audit-verify [<chain_seq>:<hash> ...]`, `staff-exit=2`**
- [ ] **Step 9: audit-verify-dev: run the `audit-verify-dev` command in the prompt, expecting `audit-verify: the chain holds:`, `staff keys checked`, `verify-exit=0`**
- [ ] **Step 10: Commit: `feat(api,contracts): step-up: an action that changes something asks for an assertion from the session's own staff key over a 74-byte challenge bound to the session's handle and the sorted-JSON hash of the action, its target and its parameters, spent once and read only while more than a minute of its ten is left; the route recomputes the hash from what it is about to do, re-checks the key and the account under the account's lock, and writes its record with the assertion in the same transaction; DELETE /api/staff/sessions/:handle is the first such action and takes only a lower-case handle, so the record hashes what was confirmed; audit-verify checks every confirmation against the key's public key, the origin and relying party recorded on it and the row's actor, and that no step-up action's row lacks one; no route changes a role or reads another person's data`**

### Task 6: The staff console: apps/admin as a React page built by esbuild with plain CSS and jitless zod, its router, fetch wrappers and screens (sign-in, enrolment, home, the audit log, the console off), the check of step-up options before the key is asked, the idle timer bounded by the absolute end, the development server with the console site's headers, the development settings, and CI building it

**Prompt:** `docs/superpowers/prompts/staff-console-3a/06-staff-console.md`

**Files:**
- Create: `apps/admin/build.d.mts`
- Create: `apps/admin/build.mjs`
- Create: `apps/admin/dev-server.d.mts`
- Create: `apps/admin/dev-server.mjs`
- Create: `apps/admin/dev.mjs`
- Create: `apps/admin/public/favicon.svg`
- Create: `apps/admin/site-headers.d.mts`
- Create: `apps/admin/site-headers.mjs`
- Create: `apps/admin/src/App.tsx`
- Create: `apps/admin/src/Layout.tsx`
- Create: `apps/admin/src/api.ts`
- Create: `apps/admin/src/app.css`
- Create: `apps/admin/src/audit-log.ts`
- Create: `apps/admin/src/css.d.ts`
- Create: `apps/admin/src/enroll.ts`
- Create: `apps/admin/src/idle.ts`
- Create: `apps/admin/src/main.tsx`
- Create: `apps/admin/src/messages.ts`
- Create: `apps/admin/src/nav.tsx`
- Create: `apps/admin/src/react-dom.d.ts`
- Create: `apps/admin/src/router.ts`
- Create: `apps/admin/src/screens/Audit.tsx`
- Create: `apps/admin/src/screens/Enroll.tsx`
- Create: `apps/admin/src/screens/Home.tsx`
- Create: `apps/admin/src/screens/SignIn.tsx`
- Create: `apps/admin/src/screens/Unavailable.tsx`
- Create: `apps/admin/src/signins.ts`
- Create: `apps/admin/src/step-up.ts`
- Create: `apps/admin/src/store.ts`
- Create: `apps/admin/src/ui.tsx`
- Create: `apps/admin/src/webauthn.ts`
- Create: `apps/admin/src/zod-jitless.ts`
- Create: `apps/admin/test/api.test.ts`
- Create: `apps/admin/test/audit-log.test.ts`
- Create: `apps/admin/test/build.test.ts`
- Create: `apps/admin/test/dev-server.test.ts`
- Create: `apps/admin/test/enroll.test.ts`
- Create: `apps/admin/test/fixtures.ts`
- Create: `apps/admin/test/idle.test.ts`
- Create: `apps/admin/test/router.test.ts`
- Create: `apps/admin/test/screens.test.tsx`
- Create: `apps/admin/test/signins.test.ts`
- Create: `apps/admin/test/source.test.ts`
- Create: `apps/admin/test/step-up.test.ts`
- Create: `apps/admin/test/store.test.ts`
- Create: `apps/admin/test/webauthn.test.ts`
- Create: `apps/admin/tsconfig.json`
- Create: `apps/admin/vitest.config.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`
- Modify: `apps/admin/README.md`
- Modify: `apps/admin/package.json`
- Modify: `apps/api/.env.example`
- Updated by the install step: `pnpm-lock.yaml`

- [ ] **Step 1: Write the failing tests: `apps/admin/test/api.test.ts`, `apps/admin/test/audit-log.test.ts`, `apps/admin/test/build.test.ts`, `apps/admin/test/dev-server.test.ts`, `apps/admin/test/enroll.test.ts`, `apps/admin/test/fixtures.ts`, `apps/admin/test/idle.test.ts`, `apps/admin/test/router.test.ts`, `apps/admin/test/screens.test.tsx`, `apps/admin/test/signins.test.ts`, `apps/admin/test/source.test.ts`, `apps/admin/test/step-up.test.ts`, `apps/admin/test/store.test.ts`, `apps/admin/test/webauthn.test.ts`, `apps/admin/vitest.config.ts`**
- [ ] **Step 2: Run them and confirm they fail: `cd apps/admin && node ../../node_modules/vitest/vitest.mjs run`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/admin/build.d.mts`, `apps/admin/build.mjs`, `apps/admin/dev-server.d.mts`, `apps/admin/dev-server.mjs`, `apps/admin/dev.mjs`, `apps/admin/public/favicon.svg`, `apps/admin/site-headers.d.mts`, `apps/admin/site-headers.mjs`, `apps/admin/src/App.tsx`, `apps/admin/src/Layout.tsx`, `apps/admin/src/api.ts`, `apps/admin/src/app.css`, `apps/admin/src/audit-log.ts`, `apps/admin/src/css.d.ts`, `apps/admin/src/enroll.ts`, `apps/admin/src/idle.ts`, `apps/admin/src/main.tsx`, `apps/admin/src/messages.ts`, `apps/admin/src/nav.tsx`, `apps/admin/src/react-dom.d.ts`, `apps/admin/src/router.ts`, `apps/admin/src/screens/Audit.tsx`, `apps/admin/src/screens/Enroll.tsx`, `apps/admin/src/screens/Home.tsx`, `apps/admin/src/screens/SignIn.tsx`, `apps/admin/src/screens/Unavailable.tsx`, `apps/admin/src/signins.ts`, `apps/admin/src/step-up.ts`, `apps/admin/src/store.ts`, `apps/admin/src/ui.tsx`, `apps/admin/src/webauthn.ts`, `apps/admin/src/zod-jitless.ts`, `apps/admin/tsconfig.json`, `.github/workflows/ci.yml`, `README.md`, `apps/admin/README.md`, `apps/admin/package.json`, `apps/api/.env.example`**
- [ ] **Step 4: frozen-install: run `pnpm install --frozen-lockfile`, expecting `Done in`**
- [ ] **Step 5: lockfile-age: run `node scripts/check-lockfile-age.mjs --base HEAD`, expecting `all at least 7 days old`**
- [ ] **Step 6: typecheck: run `pnpm typecheck`**
- [ ] **Step 7: test: run `pnpm test`, expecting `Tests  `**
- [ ] **Step 8: admin-test: run `pnpm --filter @korbat/admin test`, expecting `Tests  `**
- [ ] **Step 9: admin-build: run `pnpm --filter @korbat/admin build 2>&1 | tail -2 && ls apps/admin/dist apps/admin/dist/assets | sed -E 's/-[A-Z0-9]{8}\./-HASH./'`, expecting `Build success`, `index.html`, `favicon.svg`, `main-HASH.js`, `main-HASH.css`**
- [ ] **Step 10: integration: run `cd apps/api && set -a && . ./.env && set +a && pnpm test:integration`, expecting `Tests  `**
- [ ] **Step 11: Commit: `feat(admin,ci): the staff console: apps/admin is a React page bundled by esbuild into one hashed script and stylesheet with jitless zod, no HTML sinks and every user-written string rendered as text, under the console site's strict policy; it signs in with a staff key, enrols a key from a link with guidance on which keys work and words for every refusal, lists the staff sign-ins of the last 7 days, the person's sessions and keys, and the audit log with Load older and Go to place; before it asks for the key it recomputes the step-up challenge's binding from the session and the action it means to confirm; its idle timer counts only the person's own actions, warns two minutes before the end and never past the 12-hour end; pnpm --filter @korbat/admin dev serves it on 127.0.0.1:8090 beside the API with the same headers; CI builds it`**

### Task 7: Infrastructure for the staff console: Caddy's console site on 8090 with the console's headers, the app's site refusing /api/staff, the image's console stage, Compose and the development port, the environment template, the smoke test's console checks, and the committed browser check run in CI

**Prompt:** `docs/superpowers/prompts/staff-console-3a/07-console-infrastructure.md`

**Files:**
- Create: `apps/admin/test/browser/console.browser.ts`
- Create: `apps/admin/test/browser/fixture-api.ts`
- Create: `apps/admin/test/browser/server.ts`
- Create: `apps/admin/test/browser/watch.ts`
- Create: `apps/admin/test/caddyfile.ts`
- Create: `apps/admin/test/console-site.test.ts`
- Create: `apps/admin/vitest.browser.config.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`
- Modify: `apps/admin/README.md`
- Modify: `apps/admin/package.json`
- Modify: `apps/admin/tsconfig.json`
- Modify: `infra/.env.example`
- Modify: `infra/caddy/Caddyfile`
- Modify: `infra/caddy/Dockerfile`
- Modify: `infra/compose.dev.yml`
- Modify: `infra/compose.yml`
- Updated by the install step: `pnpm-lock.yaml`
- Modify: `scripts/smoke-auth-stack.mjs`

- [ ] **Step 1: Write the failing tests: `apps/admin/test/browser/console.browser.ts`, `apps/admin/test/browser/fixture-api.ts`, `apps/admin/test/browser/server.ts`, `apps/admin/test/browser/watch.ts`, `apps/admin/test/caddyfile.ts`, `apps/admin/test/console-site.test.ts`, `apps/admin/vitest.browser.config.ts`**
- [ ] **Step 2: Run them and confirm they fail: `cd apps/admin && node ../../node_modules/vitest/vitest.mjs run test/console-site.test.ts`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `.github/workflows/ci.yml`, `README.md`, `apps/admin/README.md`, `apps/admin/package.json`, `apps/admin/tsconfig.json`, `infra/.env.example`, `infra/caddy/Caddyfile`, `infra/caddy/Dockerfile`, `infra/compose.dev.yml`, `infra/compose.yml`, `scripts/smoke-auth-stack.mjs`**
- [ ] **Step 4: frozen-install: run `pnpm install --frozen-lockfile`, expecting `Done in`**
- [ ] **Step 5: lockfile-age: run `node scripts/check-lockfile-age.mjs --base HEAD`, expecting `all at least 7 days old`**
- [ ] **Step 6: typecheck: run `pnpm typecheck`**
- [ ] **Step 7: test: run `pnpm test`, expecting `Tests  `**
- [ ] **Step 8: admin-test: run `pnpm --filter @korbat/admin test`, expecting `Tests  `**
- [ ] **Step 9: admin-browser: run `pnpm --filter @korbat/admin test:browser`, expecting `Tests  12 passed (12)`**
- [ ] **Step 10: compose-config: run `docker compose --env-file infra/.env.example -f infra/compose.yml config -q && echo config-ok`, expecting `config-ok`**
- [ ] **Step 11: compose-dev-config: run `docker compose --env-file infra/.env.example -f infra/compose.yml -f infra/compose.dev.yml config -q && echo dev-config-ok`, expecting `dev-config-ok`**
- [ ] **Step 12: stack-down: run `docker compose -f infra/compose.yml -f infra/compose.dev.yml down && echo down-ok`, expecting `down-ok`**
- [ ] **Step 13: build: run the `build` command in the prompt, expecting `build-exit=0`**
- [ ] **Step 14: stack-up: run `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --wait && echo up-ok`, expecting `up-ok`**
- [ ] **Step 15: test-database: run `node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `migrations applied`, `test database ready: korbat_test`**
- [ ] **Step 16: smoke: run the `smoke` command in the prompt, expecting `smoke test passed`**
- [ ] **Step 17: stack-stop: run the `stack-stop` command in the prompt, expecting `postgres-1 Up`**
- [ ] **Step 18: Commit: `feat(infra,admin,ci): the staff console's site: Caddy serves the console from /console on port 8090 under the strict policy and the headers of apps/admin/site-headers.mjs, with no-store, no-transform on the page and immutable only on real hashed files, proxies only /api/staff to the API with the app's body limit and Cloudflare header rule, and answers every other /api path 404; the app's site refuses /api/staff before its API proxy; the image builds the console in a stage of its own; Compose passes CONSOLE_ORIGIN and CONSOLE_RP_ID to the API and publishes the console on DEV_CONSOLE_PORT in development; the smoke test requires --console and checks the console's policy and both sites' staff answers; a committed browser check drives Chromium with a virtual authenticator over every screen against hostile fixtures and fails on any policy or Trusted Types report, and CI runs it with the runner's Chrome`**

### Task 8: What the review of 3a upheld, fixed: the console checks every ceremony's challenge before it asks for a key, audit-verify reads every row whatever its place, keys are judged by the origin and relying party they were enrolled for, the enrolment page's sign-in check uses the new key, and fifteen smaller fixes and tests

**Prompt:** `docs/superpowers/prompts/staff-console-3a/08-review-fixes.md`

**Files:**
- Create: `apps/admin/src/challenge.ts`
- Create: `apps/admin/src/sign-in.ts`
- Create: `apps/admin/test/fixture-statuses.test.ts`
- Create: `apps/admin/test/sign-in.test.ts`
- Create: `packages/db/migrations/0013_forget_revoked_staff_keys.sql`
- Create: `packages/db/migrations/meta/0013_snapshot.json`
- Modify: `apps/admin/src/api.ts`
- Modify: `apps/admin/src/audit-log.ts`
- Modify: `apps/admin/src/enroll.ts`
- Modify: `apps/admin/src/messages.ts`
- Modify: `apps/admin/src/screens/Audit.tsx`
- Modify: `apps/admin/src/screens/Enroll.tsx`
- Modify: `apps/admin/src/screens/Home.tsx`
- Modify: `apps/admin/src/screens/SignIn.tsx`
- Modify: `apps/admin/src/step-up.ts`
- Modify: `apps/admin/src/store.ts`
- Modify: `apps/admin/test/audit-log.test.ts`
- Modify: `apps/admin/test/browser/console.browser.ts`
- Modify: `apps/admin/test/browser/fixture-api.ts`
- Modify: `apps/admin/test/browser/watch.ts`
- Modify: `apps/admin/test/enroll.test.ts`
- Modify: `apps/admin/test/fixtures.ts`
- Modify: `apps/admin/test/screens.test.tsx`
- Modify: `apps/admin/test/source.test.ts`
- Modify: `apps/admin/test/step-up.test.ts`
- Modify: `apps/admin/test/store.test.ts`
- Modify: `apps/admin/test/webauthn.test.ts`
- Modify: `apps/api/src/auth/admin.ts`
- Modify: `apps/api/src/auth/index.ts`
- Modify: `apps/api/src/auth/passkeys/challenge.ts`
- Modify: `apps/api/src/auth/repo.ts`
- Modify: `apps/api/src/auth/staff/enroll.ts`
- Modify: `apps/api/src/auth/staff/signin.ts`
- Modify: `apps/api/src/auth/staff/step-up.ts`
- Modify: `apps/api/src/cli/grant-role.ts`
- Modify: `apps/api/src/cli/staff.ts`
- Modify: `apps/api/test/auth/passkey-challenge.test.ts`
- Modify: `apps/api/test/cli-grant-role.test.ts`
- Modify: `apps/api/test/integration/audit-verify.test.ts`
- Modify: `apps/api/test/integration/auth-flows-account.test.ts`
- Modify: `apps/api/test/integration/cli-grant-role.test.ts`
- Modify: `apps/api/test/integration/cli-staff-enroll.test.ts`
- Modify: `apps/api/test/integration/http-staff-sessions.test.ts`
- Modify: `apps/api/test/integration/staff-lifecycle.test.ts`
- Modify: `apps/api/test/integration/staff-schema.test.ts`
- Modify: `apps/api/test/integration/staff-signin.test.ts`
- Modify: `apps/api/test/integration/staff-step-up.test.ts`
- Modify: `apps/api/test/staff/route-table.test.ts`
- Modify: `packages/contracts/src/staff.ts`
- Modify: `packages/contracts/test/staff.test.ts`
- Modify: `packages/db/migrations/meta/_journal.json`

- [ ] **Step 1: Write the failing tests: `apps/admin/test/fixture-statuses.test.ts`, `apps/admin/test/sign-in.test.ts`, `apps/admin/test/audit-log.test.ts`, `apps/admin/test/browser/console.browser.ts`, `apps/admin/test/browser/fixture-api.ts`, `apps/admin/test/browser/watch.ts`, `apps/admin/test/enroll.test.ts`, `apps/admin/test/fixtures.ts`, `apps/admin/test/screens.test.tsx`, `apps/admin/test/source.test.ts`, `apps/admin/test/step-up.test.ts`, `apps/admin/test/store.test.ts`, `apps/admin/test/webauthn.test.ts`, `apps/api/test/auth/passkey-challenge.test.ts`, `apps/api/test/cli-grant-role.test.ts`, `apps/api/test/integration/audit-verify.test.ts`, `apps/api/test/integration/auth-flows-account.test.ts`, `apps/api/test/integration/cli-grant-role.test.ts`, `apps/api/test/integration/cli-staff-enroll.test.ts`, `apps/api/test/integration/http-staff-sessions.test.ts`, `apps/api/test/integration/staff-lifecycle.test.ts`, `apps/api/test/integration/staff-schema.test.ts`, `apps/api/test/integration/staff-signin.test.ts`, `apps/api/test/integration/staff-step-up.test.ts`, `apps/api/test/staff/route-table.test.ts`, `packages/contracts/test/staff.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/admin/src/challenge.ts`, `apps/admin/src/sign-in.ts`, `packages/db/migrations/0013_forget_revoked_staff_keys.sql`, `packages/db/migrations/meta/0013_snapshot.json`, `apps/admin/src/api.ts`, `apps/admin/src/audit-log.ts`, `apps/admin/src/enroll.ts`, `apps/admin/src/messages.ts`, `apps/admin/src/screens/Audit.tsx`, `apps/admin/src/screens/Enroll.tsx`, `apps/admin/src/screens/Home.tsx`, `apps/admin/src/screens/SignIn.tsx`, `apps/admin/src/step-up.ts`, `apps/admin/src/store.ts`, `apps/api/src/auth/admin.ts`, `apps/api/src/auth/index.ts`, `apps/api/src/auth/passkeys/challenge.ts`, `apps/api/src/auth/repo.ts`, `apps/api/src/auth/staff/enroll.ts`, `apps/api/src/auth/staff/signin.ts`, `apps/api/src/auth/staff/step-up.ts`, `apps/api/src/cli/grant-role.ts`, `apps/api/src/cli/staff.ts`, `packages/contracts/src/staff.ts`, `packages/db/migrations/meta/_journal.json`**
- [ ] **Step 4: frozen-install: run `pnpm install --frozen-lockfile`, expecting `Done in`**
- [ ] **Step 5: typecheck: run `pnpm typecheck`**
- [ ] **Step 6: test: run `pnpm test`, expecting `Tests  `**
- [ ] **Step 7: admin-test: run `pnpm --filter @korbat/admin test`, expecting `Tests  `**
- [ ] **Step 8: admin-browser: run `pnpm --filter @korbat/admin test:browser`, expecting `Tests  14 passed (14)`**
- [ ] **Step 9: generate: run `pnpm --filter @korbat/db generate`, expecting `No schema changes`**
- [ ] **Step 10: apply-migrations: run the `apply-migrations` command in the prompt, expecting `migrations applied`, `count=14`**
- [ ] **Step 11: chain: run the `chain` command in the prompt, expecting `chain=t`**
- [ ] **Step 12: test-database-0013: run `node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `migrations applied`, `test database ready: korbat_test`**
- [ ] **Step 13: integration: run `cd apps/api && set -a && . ./.env && set +a && pnpm test:integration`, expecting `Tests  `**
- [ ] **Step 14: api-bundle: run `pnpm --filter @korbat/api build 2>&1 | tail -2 && node --check apps/api/dist/index.js && echo bundle-ok`, expecting `Build success`, `bundle-ok`**
- [ ] **Step 15: staff-cli: run the `staff-cli` command in the prompt, expecting `usage: node dist/staff.js <command>`, `revoke <email> all`, `audit-verify [<chain_seq>:<hash> ...]`, `staff-exit=2`**
- [ ] **Step 16: audit-verify-dev: run the `audit-verify-dev` command in the prompt, expecting `audit-verify: the chain holds:`, `staff keys checked`, `verify-exit=0`**
- [ ] **Step 17: compose-config: run `docker compose --env-file infra/.env.example -f infra/compose.yml config -q && echo config-ok`, expecting `config-ok`**
- [ ] **Step 18: stack-down: run `docker compose -f infra/compose.yml -f infra/compose.dev.yml down && echo down-ok`, expecting `down-ok`**
- [ ] **Step 19: build: run the `build` command in the prompt, expecting `build-exit=0`**
- [ ] **Step 20: stack-up: run `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --wait && echo up-ok`, expecting `up-ok`**
- [ ] **Step 21: test-database: run `node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `migrations applied`, `test database ready: korbat_test`**
- [ ] **Step 22: smoke: run the `smoke` command in the prompt, expecting `smoke test passed`**
- [ ] **Step 23: stack-stop: run the `stack-stop` command in the prompt, expecting `postgres-1 Up`**
- [ ] **Step 24: Commit: `fix(api,admin,contracts,db): what the review of 3a upheld, fixed: the console checks the layout and purpose of every challenge before it asks for a key, so an API under an attacker's control cannot get a sign-in or an enrolment to sign a step-up; audit-verify pages on place and id and fails on a place held twice, a row with no place or a row count that does not add up; a key enrolled for another origin or relying party opens and confirms nothing, and assertions are verified against the values recorded on the key; the enrolment page signs in with the new key itself; a confirmed action bounds its lock waits by its challenge's life and writes nothing once the database's clock is past the expiry; auth.forget_staff_keys blanks only revoked keys (migration 0013); demotion and take-down revoke keys before sessions; grant-role's tombstones and mail are best effort and reported; staff.js keys gives up on a held lock; the step-up binds the session read just before it; Go to place and Load older say and show what they read; and the tests the review found missing`**

### Task 9: Documentation: the README's staff console section, runbook, restore steps and lines under Before going public; the README lines 3a made false; the main design's amendment and the split of row 3; Changed by 3a in the 1c design; and the dry run's amendments to the 3a design

**Prompt:** `docs/superpowers/prompts/staff-console-3a/09-documentation.md`

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-09-03-korbat-design.md`
- Modify: `docs/superpowers/specs/2026-09-25-passkeys-1c-design.md`
- Modify: `docs/superpowers/specs/2026-09-28-staff-console-3a-design.md`

- [ ] **Step 1: Write the files: `README.md`, `docs/superpowers/specs/2026-09-03-korbat-design.md`, `docs/superpowers/specs/2026-09-25-passkeys-1c-design.md`, `docs/superpowers/specs/2026-09-28-staff-console-3a-design.md`**
- [ ] **Step 2: typecheck: run `pnpm typecheck`**
- [ ] **Step 3: test: run `pnpm test`, expecting `Tests  `**
- [ ] **Step 4: amendments: run the `amendments` command in the prompt, expecting `amendments=48`**
- [ ] **Step 5: Commit: `docs: the README explains the staff console (the staff.js commands, keys and which authenticators work, enrolment, sessions, step-up and the audit log and its kept head, making and removing staff, what to do on each staff mail) with its runbook, the restore steps that revoke every staff key, and under Before going public the console's hostname, the tunnel and who can rewrite the record; the lines 3a made false are rewritten; the main design records what 3a delivered, the split of sub-project 3 into 3a, 3c and 3d and the order 3c, 3d, 3b, 2d, 4, 5; the 1c design records what 3a changed; the 3a design gains its dry-run amendments`**
