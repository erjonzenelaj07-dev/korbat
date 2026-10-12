# korbat — Account Sanctions (3e) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** What an account's record leads to, decided by rules the database applies: strikes that a rule removal must sign and only a full reversal overrules, handle retirement, suspensions at once for the gravest grounds and announced suspensions on the ladder of strikes with a reply heard before they start, termination, the restriction of reporting for manifestly unfounded reports, Explore's formula version 2, and the retention, export, terms and records of all of it, every restriction enforced on every write and told to the person in words they can act on.

**Architecture:** Eight commits: the standing ledger and strikes (migrations 0020 and 0021), handle retirement, enforcement with one predicate and suspensions at once, announced suspensions with replies and termination, the restriction of reporting (0022), Explore version 2 (0023), retention, export, terms and records (0024), and what one adversarial review of the built code upheld (0025: a closing judgment on every write, bounded waits, no lock across a mail).

**Tech Stack:** Node 24, TypeScript 7, Hono 4.13, zod 4, drizzle and hand-written SQL (SECURITY DEFINER triggers and functions, column grants), PostgreSQL 18, Valkey, React 19 with esbuild 0.28 for the console and playwright-core 1.63 for its browser check, Expo for the web app, Caddy 2.11, vitest 4. No new dependency.

**Complete code:** each task's full files, commands and observed output are in `docs/superpowers/prompts/account-sanctions-3e/NN-<slug>.md`, generated from a verified dry run. This plan is the map. Where it and a prompt differ, the prompt wins.

**Spec:** `docs/superpowers/specs/2026-10-09-account-sanctions-3e-design.md`.

---

## File structure

- `apps/admin/src/screens/`: `Standing.tsx` (Task 4)
- `apps/admin/test/`: `strikes.test.tsx` (Task 1), `handles.test.tsx` (Task 2), `at-once.test.tsx` (Task 3), `announced.test.tsx` (Task 4), `reporting.test.tsx` (Task 5)
- `apps/api/src/lib/`: `standing.ts` (Task 3)
- `apps/api/src/moderation/`: `standing-repo.ts` (Task 1), `standing.ts` (Task 1)
- `apps/api/test/`: `moderation-mail-template.test.ts` (Task 4)
- `apps/api/test/integration/`: `standing-grants.test.ts` (Task 1), `standing-ledger.test.ts` (Task 1), `standing-strikes.test.ts` (Task 1), `standing-handles.test.ts` (Task 2), `standing-at-once.test.ts` (Task 3), `standing-route-walk.test.ts` (Task 3), `standing-announced.test.ts` (Task 4), `standing-replies.test.ts` (Task 4), `standing-termination.test.ts` (Task 4), `standing-reporting.test.ts` (Task 5), `standing-explore.test.ts` (Task 6), `standing-retention.test.ts` (Task 7), `standing-closing.test.ts` (Task 8)
- `apps/api/test/lab/`: `standing.lab.ts` (Task 2)
- `apps/app/src/app/settings/cases/[id]/`: `reply.tsx` (Task 4)
- `apps/app/src/components/`: `StandingBanner.tsx` (Task 3)
- `apps/app/src/components/moderation/`: `RefusedNotice.tsx` (Task 8)
- `apps/app/src/lib/`: `standing.ts` (Task 1)
- `apps/app/test/`: `standing.test.tsx` (Task 3), `announced.test.tsx` (Task 4), `reporting.test.tsx` (Task 5)
- `packages/contracts/test/`: `standing.test.ts` (Task 1)
- `packages/db/migrations/`: `0020_fearless_absorbing_man.sql` (Task 1), `0021_standing_ledger.sql` (Task 1), `0022_reporting_counts.sql` (Task 5), `0023_explore_resume.sql` (Task 6), `0024_standing_retention.sql` (Task 7), `0025_standing_review.sql` (Task 8)
- `packages/db/migrations/meta/`: `0020_snapshot.json` (Task 1), `0021_snapshot.json` (Task 1), `0022_snapshot.json` (Task 5), `0023_snapshot.json` (Task 6), `0024_snapshot.json` (Task 7), `0025_snapshot.json` (Task 8)
- `packages/db/test/`: `enum-literals.test.ts` (Task 1)

## Tasks

### Task 1: The standing ledger and strikes

**Prompt:** `docs/superpowers/prompts/account-sanctions-3e/01-standing-ledger-and-strikes.md`

**Files:**
- Create: `apps/admin/test/strikes.test.tsx`
- Create: `apps/api/src/moderation/standing-repo.ts`
- Create: `apps/api/src/moderation/standing.ts`
- Create: `apps/api/test/integration/standing-grants.test.ts`
- Create: `apps/api/test/integration/standing-ledger.test.ts`
- Create: `apps/api/test/integration/standing-strikes.test.ts`
- Create: `apps/app/src/lib/standing.ts`
- Create: `packages/contracts/test/standing.test.ts`
- Create: `packages/db/migrations/0020_fearless_absorbing_man.sql`
- Create: `packages/db/migrations/0021_standing_ledger.sql`
- Create: `packages/db/migrations/meta/0020_snapshot.json`
- Create: `packages/db/migrations/meta/0021_snapshot.json`
- Create: `packages/db/test/enum-literals.test.ts`
- Modify: `apps/admin/src/compose.ts`
- Modify: `apps/admin/src/messages.ts`
- Modify: `apps/admin/src/screens/Case.tsx`
- Modify: `apps/admin/src/screens/Composer.tsx`
- Modify: `apps/admin/test/browser/console.browser.ts`
- Modify: `apps/admin/test/browser/fixture-api.ts`
- Modify: `apps/admin/test/case-fixtures.ts`
- Modify: `apps/admin/test/cases.test.tsx`
- Modify: `apps/admin/test/composer.test.tsx`
- Modify: `apps/api/src/account/flows/export.ts`
- Modify: `apps/api/src/cli/staff-cases.ts`
- Modify: `apps/api/src/moderation/appeals.ts`
- Modify: `apps/api/src/moderation/author-repo.ts`
- Modify: `apps/api/src/moderation/author.ts`
- Modify: `apps/api/src/moderation/cases.ts`
- Modify: `apps/api/src/moderation/context.ts`
- Modify: `apps/api/src/moderation/decide.ts`
- Modify: `apps/api/src/moderation/export.ts`
- Modify: `apps/api/src/moderation/repo.ts`
- Modify: `apps/api/src/moderation/statement-repo.ts`
- Modify: `apps/api/src/moderation/statement.ts`
- Modify: `apps/api/test/account/export.test.ts`
- Modify: `apps/api/test/integration/account-deletion.test.ts`
- Modify: `apps/api/test/integration/cli-staff-cases.test.ts`
- Modify: `apps/api/test/integration/cli-staff-enroll.test.ts`
- Modify: `apps/api/test/integration/http-appeals.test.ts`
- Modify: `apps/api/test/integration/http-staff-decisions.test.ts`
- Modify: `apps/api/test/integration/media-gates.test.ts`
- Modify: `apps/api/test/integration/moderation-appeals-flow.test.ts`
- Modify: `apps/api/test/integration/moderation-appeals.test.ts`
- Modify: `apps/api/test/integration/moderation-author.test.ts`
- Modify: `apps/api/test/integration/moderation-cases.test.ts`
- Modify: `apps/api/test/integration/moderation-decide.ts`
- Modify: `apps/api/test/integration/moderation-decisions.test.ts`
- Modify: `apps/api/test/integration/moderation-export.test.ts`
- Modify: `apps/api/test/integration/moderation-fixtures.ts`
- Modify: `apps/api/test/integration/moderation-schema.test.ts`
- Modify: `apps/api/test/integration/moderation-statement.test.ts`
- Modify: `apps/api/test/moderation-author.test.ts`
- Modify: `apps/api/test/moderation-context.test.ts`
- Modify: `apps/api/test/moderation-retry.test.ts`
- Modify: `apps/app/src/app/settings/cases/index.tsx`
- Modify: `apps/app/src/components/moderation/CasesLists.tsx`
- Modify: `apps/app/src/components/moderation/DecisionDetail.tsx`
- Modify: `apps/app/src/lib/moderation.ts`
- Modify: `apps/app/src/lib/terms.ts`
- Modify: `apps/app/test/appeals.test.tsx`
- Modify: `apps/app/test/cases.test.tsx`
- Modify: `apps/app/test/terms.test.tsx`
- Modify: `packages/contracts/src/account.ts`
- Modify: `packages/contracts/src/moderation.ts`
- Modify: `packages/contracts/src/social.ts`
- Modify: `packages/contracts/src/staff.ts`
- Modify: `packages/contracts/test/account.test.ts`
- Modify: `packages/contracts/test/author.test.ts`
- Modify: `packages/contracts/test/moderation.test.ts`
- Modify: `packages/contracts/test/staff-cases.test.ts`
- Modify: `packages/contracts/test/staff.test.ts`
- Modify: `packages/db/migrations/meta/_journal.json`
- Modify: `packages/db/src/schema/content.ts`
- Modify: `packages/db/src/schema/identity.ts`
- Modify: `packages/db/src/schema/moderation.ts`
- Modify: `packages/db/test/schema.test.ts`
- Modify: `packages/rules/src/index.ts`
- Modify: `packages/rules/src/statement.ts`
- Modify: `packages/rules/test/rules.test.ts`
- Modify: `packages/rules/test/statement.test.ts`
- Modify: `scripts/clean-dev-fixtures.mjs`

- [ ] **Step 1: Write the failing tests: `apps/admin/test/strikes.test.tsx`, `apps/api/test/integration/standing-grants.test.ts`, `apps/api/test/integration/standing-ledger.test.ts`, `apps/api/test/integration/standing-strikes.test.ts`, `packages/contracts/test/standing.test.ts`, `packages/db/test/enum-literals.test.ts`, `apps/admin/test/browser/console.browser.ts`, `apps/admin/test/browser/fixture-api.ts`, `apps/admin/test/case-fixtures.ts`, `apps/admin/test/cases.test.tsx`, `apps/admin/test/composer.test.tsx`, `apps/api/test/account/export.test.ts`, `apps/api/test/integration/account-deletion.test.ts`, `apps/api/test/integration/cli-staff-cases.test.ts`, `apps/api/test/integration/cli-staff-enroll.test.ts`, `apps/api/test/integration/http-appeals.test.ts`, `apps/api/test/integration/http-staff-decisions.test.ts`, `apps/api/test/integration/media-gates.test.ts`, `apps/api/test/integration/moderation-appeals-flow.test.ts`, `apps/api/test/integration/moderation-appeals.test.ts`, `apps/api/test/integration/moderation-author.test.ts`, `apps/api/test/integration/moderation-cases.test.ts`, `apps/api/test/integration/moderation-decide.ts`, `apps/api/test/integration/moderation-decisions.test.ts`, `apps/api/test/integration/moderation-export.test.ts`, `apps/api/test/integration/moderation-fixtures.ts`, `apps/api/test/integration/moderation-schema.test.ts`, `apps/api/test/integration/moderation-statement.test.ts`, `apps/api/test/moderation-author.test.ts`, `apps/api/test/moderation-context.test.ts`, `apps/api/test/moderation-retry.test.ts`, `apps/app/test/appeals.test.tsx`, `apps/app/test/cases.test.tsx`, `apps/app/test/terms.test.tsx`, `packages/contracts/test/account.test.ts`, `packages/contracts/test/author.test.ts`, `packages/contracts/test/moderation.test.ts`, `packages/contracts/test/staff-cases.test.ts`, `packages/contracts/test/staff.test.ts`, `packages/db/test/schema.test.ts`, `packages/rules/test/rules.test.ts`, `packages/rules/test/statement.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/api/src/moderation/standing-repo.ts`, `apps/api/src/moderation/standing.ts`, `apps/app/src/lib/standing.ts`, `packages/db/migrations/0020_fearless_absorbing_man.sql`, `packages/db/migrations/0021_standing_ledger.sql`, `packages/db/migrations/meta/0020_snapshot.json`, `packages/db/migrations/meta/0021_snapshot.json`, `apps/admin/src/compose.ts`, `apps/admin/src/messages.ts`, `apps/admin/src/screens/Case.tsx`, `apps/admin/src/screens/Composer.tsx`, `apps/api/src/account/flows/export.ts`, `apps/api/src/cli/staff-cases.ts`, `apps/api/src/moderation/appeals.ts`, `apps/api/src/moderation/author-repo.ts`, `apps/api/src/moderation/author.ts`, `apps/api/src/moderation/cases.ts`, `apps/api/src/moderation/context.ts`, `apps/api/src/moderation/decide.ts`, `apps/api/src/moderation/export.ts`, `apps/api/src/moderation/repo.ts`, `apps/api/src/moderation/statement-repo.ts`, `apps/api/src/moderation/statement.ts`, `apps/app/src/app/settings/cases/index.tsx`, `apps/app/src/components/moderation/CasesLists.tsx`, `apps/app/src/components/moderation/DecisionDetail.tsx`, `apps/app/src/lib/moderation.ts`, `apps/app/src/lib/terms.ts`, `packages/contracts/src/account.ts`, `packages/contracts/src/moderation.ts`, `packages/contracts/src/social.ts`, `packages/contracts/src/staff.ts`, `packages/db/migrations/meta/_journal.json`, `packages/db/src/schema/content.ts`, `packages/db/src/schema/identity.ts`, `packages/db/src/schema/moderation.ts`, `packages/rules/src/index.ts`, `packages/rules/src/statement.ts`, `scripts/clean-dev-fixtures.mjs`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm -r --if-present run test --testTimeout=20000`, expecting `Tests  `**
- [ ] **Step 6: generate: run `pnpm --filter @korbat/db generate`, expecting `No schema changes`**
- [ ] **Step 7: apply-migrations: run the `apply-migrations` command in the prompt, expecting `migrations applied`, `count=22`**
- [ ] **Step 8: admin-build: run `pnpm --filter @korbat/admin build 2>&1 | tail -2 && ls apps/admin/dist apps/admin/dist/assets | sed -E 's/-[A-Z0-9]{8}[.]/-HASH./'`, expecting `Build success`, `index.html`, `main-HASH.js`, `main-HASH.css`**
- [ ] **Step 9: admin-browser: run `pnpm --filter @korbat/admin test:browser`, expecting `Tests  35 passed (35)`**
- [ ] **Step 10: export: run the `export` command in the prompt, expecting `Exported`**
- [ ] **Step 11: test-database-fresh: run `node scripts/test-db.mjs --fresh -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `test database ready: korbat_test`**
- [ ] **Step 12: integration-fresh: run the `integration-fresh` command in the prompt, expecting `Tests  `**
- [ ] **Step 13: test-database-upgrade: run `node scripts/test-db.mjs --upgrade-from 19 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `migrations up to 0019_redaction_scope applied and committed`, `later migrations applied as one batch`, `test database ready: korbat_test`**
- [ ] **Step 14: integration-upgraded: run the `integration-upgraded` command in the prompt, expecting `Tests  `**
- [ ] **Step 15: timing: run the `timing` command in the prompt, expecting `timing-ok=1`**
- [ ] **Step 16: api-bundle: run the `api-bundle` command in the prompt, expecting `Build success`, `bundle-ok`**
- [ ] **Step 17: Commit: `feat(db,contracts,rules,api,admin,app): the standing ledger and strikes: migration 0020 adds the ten kinds, the ledger's seven columns, the profile, handle and post columns under column grants and the tables suspension_replies, unfounded_marks and report_tallies; 0021_standing_ledger adds standing_rules(), active_strikes, suspension_periods, standing_live, strike_due, standing_apply, the new triggers and the decision functions rewritten for 3e; a final rule removal of a post holds the strike strike_due computes, else strike_mismatch at commit, and only a full reversal overrules it; the routes take 3c's kinds, strike and overrule (DecideOptions.allKinds lifts the list for tests); the case answer gains strikeDue, authorStanding, standing and the ledger's columns; rulebook 3 and redress 2 word the strike; the console signs the strike and the overruling, with the strike line, the bands, [review.strike] and [review.rests]; the app shows the strike on the chip, in Your standing and on its decision; the export lists strikes`**

### Task 2: Handle retirement

**Prompt:** `docs/superpowers/prompts/account-sanctions-3e/02-handle-retirement.md`

**Files:**
- Create: `apps/admin/test/handles.test.tsx`
- Create: `apps/api/test/integration/standing-handles.test.ts`
- Create: `apps/api/test/lab/standing.lab.ts`
- Modify: `apps/admin/src/compose.ts`
- Modify: `apps/admin/src/messages.ts`
- Modify: `apps/admin/src/screens/Case.tsx`
- Modify: `apps/admin/src/screens/Composer.tsx`
- Modify: `apps/admin/test/case-fixtures.ts`
- Modify: `apps/admin/test/composer.test.tsx`
- Modify: `apps/api/src/account/flows/export.ts`
- Modify: `apps/api/src/auth/context.ts`
- Modify: `apps/api/src/auth/flows/signup.ts`
- Modify: `apps/api/src/auth/handles.ts`
- Modify: `apps/api/src/auth/index.ts`
- Modify: `apps/api/src/moderation/cases.ts`
- Modify: `apps/api/src/moderation/decide.ts`
- Modify: `apps/api/src/moderation/dispatch.ts`
- Modify: `apps/api/src/moderation/intake.ts`
- Modify: `apps/api/src/moderation/repo.ts`
- Modify: `apps/api/src/moderation/standing-repo.ts`
- Modify: `apps/api/src/moderation/standing.ts`
- Modify: `apps/api/src/moderation/statement-repo.ts`
- Modify: `apps/api/src/moderation/statement.ts`
- Modify: `apps/api/src/profiles/store.ts`
- Modify: `apps/api/src/social/context.ts`
- Modify: `apps/api/src/social/flows/export.ts`
- Modify: `apps/api/src/social/flows/profile-edit.ts`
- Modify: `apps/api/src/social/repo.ts`
- Modify: `apps/api/test/account/export.test.ts`
- Modify: `apps/api/test/auth/messages.test.ts`
- Modify: `apps/api/test/auth/policy.test.ts`
- Modify: `apps/api/test/integration/account-export.test.ts`
- Modify: `apps/api/test/integration/http-auth.test.ts`
- Modify: `apps/api/test/integration/http-profile.test.ts`
- Modify: `apps/api/test/integration/moderation-fixtures.ts`
- Modify: `apps/api/test/integration/social-flows-profile-edit.test.ts`
- Modify: `apps/api/test/integration/standing-strikes.test.ts`
- Modify: `apps/api/test/moderation-dispatch.test.ts`
- Modify: `apps/api/test/social/profile-edit.test.ts`
- Modify: `apps/api/test/social/profile-harness.ts`
- Modify: `apps/app/src/app/settings/profile.tsx`
- Modify: `apps/app/src/components/moderation/CasesLists.tsx`
- Modify: `apps/app/src/lib/api.ts`
- Modify: `apps/app/src/lib/standing.ts`
- Modify: `apps/app/test/cases.test.tsx`
- Modify: `packages/contracts/src/account.ts`
- Modify: `packages/contracts/src/auth.ts`
- Modify: `packages/contracts/src/moderation.ts`
- Modify: `packages/contracts/test/account.test.ts`
- Modify: `packages/contracts/test/auth.test.ts`
- Modify: `packages/contracts/test/staff-cases.test.ts`
- Modify: `packages/contracts/test/standing.test.ts`
- Modify: `packages/rules/src/index.ts`
- Modify: `packages/rules/src/statement.ts`
- Modify: `packages/rules/test/statement.test.ts`

- [ ] **Step 1: Write the failing tests: `apps/admin/test/handles.test.tsx`, `apps/api/test/integration/standing-handles.test.ts`, `apps/api/test/lab/standing.lab.ts`, `apps/admin/test/case-fixtures.ts`, `apps/admin/test/composer.test.tsx`, `apps/api/test/account/export.test.ts`, `apps/api/test/auth/messages.test.ts`, `apps/api/test/auth/policy.test.ts`, `apps/api/test/integration/account-export.test.ts`, `apps/api/test/integration/http-auth.test.ts`, `apps/api/test/integration/http-profile.test.ts`, `apps/api/test/integration/moderation-fixtures.ts`, `apps/api/test/integration/social-flows-profile-edit.test.ts`, `apps/api/test/integration/standing-strikes.test.ts`, `apps/api/test/moderation-dispatch.test.ts`, `apps/api/test/social/profile-edit.test.ts`, `apps/api/test/social/profile-harness.ts`, `apps/app/test/cases.test.tsx`, `packages/contracts/test/account.test.ts`, `packages/contracts/test/auth.test.ts`, `packages/contracts/test/staff-cases.test.ts`, `packages/contracts/test/standing.test.ts`, `packages/rules/test/statement.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/admin/src/compose.ts`, `apps/admin/src/messages.ts`, `apps/admin/src/screens/Case.tsx`, `apps/admin/src/screens/Composer.tsx`, `apps/api/src/account/flows/export.ts`, `apps/api/src/auth/context.ts`, `apps/api/src/auth/flows/signup.ts`, `apps/api/src/auth/handles.ts`, `apps/api/src/auth/index.ts`, `apps/api/src/moderation/cases.ts`, `apps/api/src/moderation/decide.ts`, `apps/api/src/moderation/dispatch.ts`, `apps/api/src/moderation/intake.ts`, `apps/api/src/moderation/repo.ts`, `apps/api/src/moderation/standing-repo.ts`, `apps/api/src/moderation/standing.ts`, `apps/api/src/moderation/statement-repo.ts`, `apps/api/src/moderation/statement.ts`, `apps/api/src/profiles/store.ts`, `apps/api/src/social/context.ts`, `apps/api/src/social/flows/export.ts`, `apps/api/src/social/flows/profile-edit.ts`, `apps/api/src/social/repo.ts`, `apps/app/src/app/settings/profile.tsx`, `apps/app/src/components/moderation/CasesLists.tsx`, `apps/app/src/lib/api.ts`, `apps/app/src/lib/standing.ts`, `packages/contracts/src/account.ts`, `packages/contracts/src/auth.ts`, `packages/contracts/src/moderation.ts`, `packages/rules/src/index.ts`, `packages/rules/src/statement.ts`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm -r --if-present run test --testTimeout=20000`, expecting `Tests  `**
- [ ] **Step 6: admin-build: run `pnpm --filter @korbat/admin build 2>&1 | tail -2 && ls apps/admin/dist apps/admin/dist/assets | sed -E 's/-[A-Z0-9]{8}[.]/-HASH./'`, expecting `Build success`, `index.html`, `main-HASH.js`, `main-HASH.css`**
- [ ] **Step 7: admin-browser: run `pnpm --filter @korbat/admin test:browser`, expecting `Tests  35 passed (35)`**
- [ ] **Step 8: export: run the `export` command in the prompt, expecting `Exported`**
- [ ] **Step 9: integration-own: run the `integration-own` command in the prompt, expecting `Tests  `**
- [ ] **Step 10: api-bundle: run the `api-bundle` command in the prompt, expecting `Build success`, `bundle-ok`**
- [ ] **Step 11: Commit: `feat(contracts,rules,api,admin,app): handle retirement: the decide and review routes take retire_handle and unretire_handle, and the decide route inserts a retirement first, so a reset of the display name after it copies the placeholder; the handle change and onboarding answer handle_retired (409) for a retired handle, its former holder included, and handle_reserved (400) for the prefix retired_, which the handle rule now reserves, and pass on the guard's codes when a race reaches it; the statement words the retirement with its three ends, a retirement that changed nothing and the handle given back; a reporter whose report a retirement answered reads that korbat retired the handle; the console offers Retire the handle on an account case with [retire.what], [retire.first], [retire.moved] and [retire.none], and Give the handle back with [review.handle]; the app says on Settings, Profile that korbat retired the handle and names both measures in Cases; the export lists the retired handles with when; lab E runs on the real code`**

### Task 3: Enforcement, and suspensions at once

**Prompt:** `docs/superpowers/prompts/account-sanctions-3e/03-enforcement-at-once.md`

**Files:**
- Create: `apps/admin/test/at-once.test.tsx`
- Create: `apps/api/src/lib/standing.ts`
- Create: `apps/api/test/integration/standing-at-once.test.ts`
- Create: `apps/api/test/integration/standing-route-walk.test.ts`
- Create: `apps/app/src/components/StandingBanner.tsx`
- Create: `apps/app/test/standing.test.tsx`
- Modify: `apps/admin/src/compose.ts`
- Modify: `apps/admin/src/messages.ts`
- Modify: `apps/admin/src/screens/Composer.tsx`
- Modify: `apps/admin/test/browser/console.browser.ts`
- Modify: `apps/admin/test/case-fixtures.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/auth/admin.ts`
- Modify: `apps/api/src/auth/context.ts`
- Modify: `apps/api/src/auth/flows/account.ts`
- Modify: `apps/api/src/auth/flows/badge.ts`
- Modify: `apps/api/src/auth/flows/notifiers.ts`
- Modify: `apps/api/src/auth/index.ts`
- Modify: `apps/api/src/auth/repo.ts`
- Modify: `apps/api/src/auth/routes.ts`
- Modify: `apps/api/src/cli/grant-role.ts`
- Modify: `apps/api/src/mail/mailer.ts`
- Modify: `apps/api/src/mail/templates.ts`
- Modify: `apps/api/src/media/context.ts`
- Modify: `apps/api/src/media/repo.ts`
- Modify: `apps/api/src/moderation/appeals.ts`
- Modify: `apps/api/src/moderation/cases.ts`
- Modify: `apps/api/src/moderation/context.ts`
- Modify: `apps/api/src/moderation/decide.ts`
- Modify: `apps/api/src/moderation/dispatch.ts`
- Modify: `apps/api/src/moderation/index.ts`
- Modify: `apps/api/src/moderation/intake.ts`
- Modify: `apps/api/src/moderation/repo.ts`
- Modify: `apps/api/src/moderation/standing-repo.ts`
- Modify: `apps/api/src/moderation/standing.ts`
- Modify: `apps/api/src/moderation/statement-repo.ts`
- Modify: `apps/api/src/moderation/statement.ts`
- Modify: `apps/api/src/profiles/store.ts`
- Modify: `apps/api/src/social/context.ts`
- Modify: `apps/api/src/social/flows/graph.ts`
- Modify: `apps/api/src/social/flows/posts.ts`
- Modify: `apps/api/src/social/flows/profile-edit.ts`
- Modify: `apps/api/src/social/index.ts`
- Modify: `apps/api/src/social/repo.ts`
- Modify: `apps/api/test/app.test.ts`
- Modify: `apps/api/test/architecture.test.ts`
- Modify: `apps/api/test/auth/badge.test.ts`
- Modify: `apps/api/test/auth/flow-harness.ts`
- Modify: `apps/api/test/integration/account-deletion.test.ts`
- Modify: `apps/api/test/integration/cli-grant-role.test.ts`
- Modify: `apps/api/test/integration/flow-harness.ts`
- Modify: `apps/api/test/integration/http-badge.test.ts`
- Modify: `apps/api/test/integration/http-deletion.test.ts`
- Modify: `apps/api/test/integration/http-media.test.ts`
- Modify: `apps/api/test/integration/http-profile.test.ts`
- Modify: `apps/api/test/integration/http-social.test.ts`
- Modify: `apps/api/test/integration/media-flows.test.ts`
- Modify: `apps/api/test/integration/moderation-decide.ts`
- Modify: `apps/api/test/integration/moderation-fixtures.ts`
- Modify: `apps/api/test/integration/moderation-intake.test.ts`
- Modify: `apps/api/test/integration/moderation-races.test.ts`
- Modify: `apps/api/test/integration/social-flows-graph.test.ts`
- Modify: `apps/api/test/integration/social-flows-posts.test.ts`
- Modify: `apps/api/test/integration/social-flows-profile-edit.test.ts`
- Modify: `apps/api/test/integration/social-repo.test.ts`
- Modify: `apps/api/test/integration/standing-handles.test.ts`
- Modify: `apps/api/test/integration/standing-strikes.test.ts`
- Modify: `apps/api/test/lab/standing.lab.ts`
- Modify: `apps/api/test/mail/moderation-templates.test.ts`
- Modify: `apps/api/test/moderation-dispatch.test.ts`
- Modify: `apps/api/test/moderation-intake-order.test.ts`
- Modify: `apps/api/test/staff/app-mount.test.ts`
- Modify: `apps/api/test/staff/route-table.test.ts`
- Modify: `apps/app/src/app/report.tsx`
- Modify: `apps/app/src/app/settings/cases/index.tsx`
- Modify: `apps/app/src/app/settings/profile.tsx`
- Modify: `apps/app/src/components/AppShell.tsx`
- Modify: `apps/app/src/components/moderation/CasesLists.tsx`
- Modify: `apps/app/src/components/moderation/ReportForm.tsx`
- Modify: `apps/app/src/components/social/ComposeSheet.tsx`
- Modify: `apps/app/src/lib/api.ts`
- Modify: `apps/app/src/lib/session.tsx`
- Modify: `apps/app/src/lib/standing.ts`
- Modify: `apps/app/test/cases.test.tsx`
- Modify: `apps/app/test/explore.test.tsx`
- Modify: `apps/app/test/passkeys.test.tsx`
- Modify: `packages/contracts/src/auth.ts`
- Modify: `packages/contracts/src/moderation.ts`
- Modify: `packages/contracts/src/social.ts`
- Modify: `packages/contracts/test/auth.test.ts`
- Modify: `packages/contracts/test/social.test.ts`
- Modify: `packages/contracts/test/staff-cases.test.ts`
- Modify: `packages/contracts/test/standing.test.ts`
- Modify: `packages/rules/src/statement.ts`
- Modify: `packages/rules/test/statement.test.ts`

- [ ] **Step 1: Write the failing tests: `apps/admin/test/at-once.test.tsx`, `apps/api/test/integration/standing-at-once.test.ts`, `apps/api/test/integration/standing-route-walk.test.ts`, `apps/app/test/standing.test.tsx`, `apps/admin/test/browser/console.browser.ts`, `apps/admin/test/case-fixtures.ts`, `apps/api/test/app.test.ts`, `apps/api/test/architecture.test.ts`, `apps/api/test/auth/badge.test.ts`, `apps/api/test/auth/flow-harness.ts`, `apps/api/test/integration/account-deletion.test.ts`, `apps/api/test/integration/cli-grant-role.test.ts`, `apps/api/test/integration/flow-harness.ts`, `apps/api/test/integration/http-badge.test.ts`, `apps/api/test/integration/http-deletion.test.ts`, `apps/api/test/integration/http-media.test.ts`, `apps/api/test/integration/http-profile.test.ts`, `apps/api/test/integration/http-social.test.ts`, `apps/api/test/integration/media-flows.test.ts`, `apps/api/test/integration/moderation-decide.ts`, `apps/api/test/integration/moderation-fixtures.ts`, `apps/api/test/integration/moderation-intake.test.ts`, `apps/api/test/integration/moderation-races.test.ts`, `apps/api/test/integration/social-flows-graph.test.ts`, `apps/api/test/integration/social-flows-posts.test.ts`, `apps/api/test/integration/social-flows-profile-edit.test.ts`, `apps/api/test/integration/social-repo.test.ts`, `apps/api/test/integration/standing-handles.test.ts`, `apps/api/test/integration/standing-strikes.test.ts`, `apps/api/test/lab/standing.lab.ts`, `apps/api/test/mail/moderation-templates.test.ts`, `apps/api/test/moderation-dispatch.test.ts`, `apps/api/test/moderation-intake-order.test.ts`, `apps/api/test/staff/app-mount.test.ts`, `apps/api/test/staff/route-table.test.ts`, `apps/app/test/cases.test.tsx`, `apps/app/test/explore.test.tsx`, `apps/app/test/passkeys.test.tsx`, `packages/contracts/test/auth.test.ts`, `packages/contracts/test/social.test.ts`, `packages/contracts/test/staff-cases.test.ts`, `packages/contracts/test/standing.test.ts`, `packages/rules/test/statement.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/api/src/lib/standing.ts`, `apps/app/src/components/StandingBanner.tsx`, `apps/admin/src/compose.ts`, `apps/admin/src/messages.ts`, `apps/admin/src/screens/Composer.tsx`, `apps/api/src/app.ts`, `apps/api/src/auth/admin.ts`, `apps/api/src/auth/context.ts`, `apps/api/src/auth/flows/account.ts`, `apps/api/src/auth/flows/badge.ts`, `apps/api/src/auth/flows/notifiers.ts`, `apps/api/src/auth/index.ts`, `apps/api/src/auth/repo.ts`, `apps/api/src/auth/routes.ts`, `apps/api/src/cli/grant-role.ts`, `apps/api/src/mail/mailer.ts`, `apps/api/src/mail/templates.ts`, `apps/api/src/media/context.ts`, `apps/api/src/media/repo.ts`, `apps/api/src/moderation/appeals.ts`, `apps/api/src/moderation/cases.ts`, `apps/api/src/moderation/context.ts`, `apps/api/src/moderation/decide.ts`, `apps/api/src/moderation/dispatch.ts`, `apps/api/src/moderation/index.ts`, `apps/api/src/moderation/intake.ts`, `apps/api/src/moderation/repo.ts`, `apps/api/src/moderation/standing-repo.ts`, `apps/api/src/moderation/standing.ts`, `apps/api/src/moderation/statement-repo.ts`, `apps/api/src/moderation/statement.ts`, `apps/api/src/profiles/store.ts`, `apps/api/src/social/context.ts`, `apps/api/src/social/flows/graph.ts`, `apps/api/src/social/flows/posts.ts`, `apps/api/src/social/flows/profile-edit.ts`, `apps/api/src/social/index.ts`, `apps/api/src/social/repo.ts`, `apps/app/src/app/report.tsx`, `apps/app/src/app/settings/cases/index.tsx`, `apps/app/src/app/settings/profile.tsx`, `apps/app/src/components/AppShell.tsx`, `apps/app/src/components/moderation/CasesLists.tsx`, `apps/app/src/components/moderation/ReportForm.tsx`, `apps/app/src/components/social/ComposeSheet.tsx`, `apps/app/src/lib/api.ts`, `apps/app/src/lib/session.tsx`, `apps/app/src/lib/standing.ts`, `packages/contracts/src/auth.ts`, `packages/contracts/src/moderation.ts`, `packages/contracts/src/social.ts`, `packages/rules/src/statement.ts`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm -r --if-present run test --testTimeout=20000`, expecting `Tests  `**
- [ ] **Step 6: admin-build: run `pnpm --filter @korbat/admin build 2>&1 | tail -2 && ls apps/admin/dist apps/admin/dist/assets | sed -E 's/-[A-Z0-9]{8}[.]/-HASH./'`, expecting `Build success`, `index.html`, `main-HASH.js`, `main-HASH.css`**
- [ ] **Step 7: admin-browser: run `pnpm --filter @korbat/admin test:browser`, expecting `Tests  37 passed (37)`**
- [ ] **Step 8: export: run the `export` command in the prompt, expecting `Exported`**
- [ ] **Step 9: test-database-fresh: run `node scripts/test-db.mjs --fresh -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `test database ready: korbat_test`**
- [ ] **Step 10: integration-fresh: run the `integration-fresh` command in the prompt, expecting `Tests  `**
- [ ] **Step 11: test-database-upgrade: run `node scripts/test-db.mjs --upgrade-from 19 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `migrations up to 0019_redaction_scope applied and committed`, `later migrations applied as one batch`, `test database ready: korbat_test`**
- [ ] **Step 12: integration-upgraded: run the `integration-upgraded` command in the prompt, expecting `Tests  `**
- [ ] **Step 13: timing: run the `timing` command in the prompt, expecting `timing-ok=1`**
- [ ] **Step 14: api-bundle: run the `api-bundle` command in the prompt, expecting `Build success`, `bundle-ok`**
- [ ] **Step 15: Commit: `feat(contracts,rules,api,admin,app): enforcement and suspensions at once: one predicate in lib/standing.ts judges the acting account at clock_timestamp() in the statement that locks or updates its row, and every write route of 7.3 refuses a suspended account with 403 account_suspended; follow and unfollow lock both profile rows in id order, a post locks its author first, the purge locks its counterparts before any post, and follow, unfollow and createPost try once more after a deadlock; a decision that suspends takes its subject FOR UPDATE first; an admin suspends at once on a threat, terrorist content, a flood or a seal for good, and lifts, through the routes, with the statement's paragraphs, the two mails and the reporter's line; /api/me carries the account's standing; grant-role refuses an account under a measure; the console offers Suspend at once and the app shows the banner, the refusals and the report form's suspended state; labs B1 to B7 run on the real code`**

### Task 4: Announced suspensions, replies and termination

**Prompt:** `docs/superpowers/prompts/account-sanctions-3e/04-announced-replies-termination.md`

**Files:**
- Create: `apps/admin/src/screens/Standing.tsx`
- Create: `apps/admin/test/announced.test.tsx`
- Create: `apps/api/test/integration/standing-announced.test.ts`
- Create: `apps/api/test/integration/standing-replies.test.ts`
- Create: `apps/api/test/integration/standing-termination.test.ts`
- Create: `apps/api/test/moderation-mail-template.test.ts`
- Create: `apps/app/src/app/settings/cases/[id]/reply.tsx`
- Create: `apps/app/test/announced.test.tsx`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/Layout.tsx`
- Modify: `apps/admin/src/api.ts`
- Modify: `apps/admin/src/compose.ts`
- Modify: `apps/admin/src/messages.ts`
- Modify: `apps/admin/src/router.ts`
- Modify: `apps/admin/src/screens/Appeals.tsx`
- Modify: `apps/admin/src/screens/Case.tsx`
- Modify: `apps/admin/src/screens/Composer.tsx`
- Modify: `apps/admin/src/screens/Home.tsx`
- Modify: `apps/admin/src/screens/Queue.tsx`
- Modify: `apps/admin/test/appeals.test.tsx`
- Modify: `apps/admin/test/browser/console.browser.ts`
- Modify: `apps/admin/test/browser/fixture-api.ts`
- Modify: `apps/admin/test/browser/watch.ts`
- Modify: `apps/admin/test/case-fixtures.ts`
- Modify: `apps/admin/test/cases.test.tsx`
- Modify: `apps/admin/test/fixtures.ts`
- Modify: `apps/admin/test/screens.test.tsx`
- Modify: `apps/admin/test/source.test.ts`
- Modify: `apps/api/src/account/context.ts`
- Modify: `apps/api/src/account/purge.ts`
- Modify: `apps/api/src/auth/flows/deletion.ts`
- Modify: `apps/api/src/auth/flows/notifiers.ts`
- Modify: `apps/api/src/auth/index.ts`
- Modify: `apps/api/src/auth/repo.ts`
- Modify: `apps/api/src/mail/mailer.ts`
- Modify: `apps/api/src/mail/templates.ts`
- Modify: `apps/api/src/moderation/alerts.ts`
- Modify: `apps/api/src/moderation/appeals.ts`
- Modify: `apps/api/src/moderation/author-repo.ts`
- Modify: `apps/api/src/moderation/author.ts`
- Modify: `apps/api/src/moderation/cases.ts`
- Modify: `apps/api/src/moderation/decide.ts`
- Modify: `apps/api/src/moderation/dispatch.ts`
- Modify: `apps/api/src/moderation/index.ts`
- Modify: `apps/api/src/moderation/repo.ts`
- Modify: `apps/api/src/moderation/routes.ts`
- Modify: `apps/api/src/moderation/standing-repo.ts`
- Modify: `apps/api/src/moderation/standing.ts`
- Modify: `apps/api/src/moderation/statement-repo.ts`
- Modify: `apps/api/src/moderation/statement.ts`
- Modify: `apps/api/src/staff/cases.ts`
- Modify: `apps/api/test/account/deletion.test.ts`
- Modify: `apps/api/test/account/export.test.ts`
- Modify: `apps/api/test/integration/account-deletion.test.ts`
- Modify: `apps/api/test/integration/account-export.test.ts`
- Modify: `apps/api/test/integration/account-takedown.test.ts`
- Modify: `apps/api/test/integration/http-appeals.test.ts`
- Modify: `apps/api/test/integration/http-deletion.test.ts`
- Modify: `apps/api/test/integration/http-staff-decisions.test.ts`
- Modify: `apps/api/test/integration/media-gates.test.ts`
- Modify: `apps/api/test/integration/moderation-appeals-flow.test.ts`
- Modify: `apps/api/test/integration/moderation-appeals.test.ts`
- Modify: `apps/api/test/integration/moderation-author.test.ts`
- Modify: `apps/api/test/integration/moderation-cases.test.ts`
- Modify: `apps/api/test/integration/moderation-decide.ts`
- Modify: `apps/api/test/integration/moderation-dispatch.test.ts`
- Modify: `apps/api/test/integration/moderation-path.test.ts`
- Modify: `apps/api/test/integration/moderation-statement.test.ts`
- Modify: `apps/api/test/integration/standing-at-once.test.ts`
- Modify: `apps/api/test/integration/standing-handles.test.ts`
- Modify: `apps/api/test/integration/standing-route-walk.test.ts`
- Modify: `apps/api/test/integration/standing-strikes.test.ts`
- Modify: `apps/api/test/lab/standing.lab.ts`
- Modify: `apps/api/test/mail/moderation-templates.test.ts`
- Modify: `apps/api/test/mail/templates.test.ts`
- Modify: `apps/api/test/moderation-author.test.ts`
- Modify: `apps/api/test/moderation-export.test.ts`
- Modify: `apps/api/test/staff/route-table.test.ts`
- Modify: `apps/app/src/app/settings/account.tsx`
- Modify: `apps/app/src/components/StandingBanner.tsx`
- Modify: `apps/app/src/components/moderation/DecisionDetail.tsx`
- Modify: `apps/app/src/lib/api.ts`
- Modify: `apps/app/src/lib/moderation.ts`
- Modify: `apps/app/src/lib/standing.ts`
- Modify: `apps/app/test/appeals.test.tsx`
- Modify: `apps/app/test/cases.test.tsx`
- Modify: `apps/app/test/lifecycle.test.tsx`
- Modify: `apps/app/test/standing.test.tsx`
- Modify: `packages/contracts/src/moderation.ts`
- Modify: `packages/contracts/test/appeals.test.ts`
- Modify: `packages/contracts/test/author.test.ts`
- Modify: `packages/contracts/test/outcomes.test.ts`
- Modify: `packages/contracts/test/staff-cases.test.ts`
- Modify: `packages/contracts/test/standing.test.ts`
- Modify: `packages/rules/src/statement.ts`
- Modify: `packages/rules/test/statement.test.ts`

- [ ] **Step 1: Write the failing tests: `apps/admin/test/announced.test.tsx`, `apps/api/test/integration/standing-announced.test.ts`, `apps/api/test/integration/standing-replies.test.ts`, `apps/api/test/integration/standing-termination.test.ts`, `apps/api/test/moderation-mail-template.test.ts`, `apps/app/test/announced.test.tsx`, `apps/admin/test/appeals.test.tsx`, `apps/admin/test/browser/console.browser.ts`, `apps/admin/test/browser/fixture-api.ts`, `apps/admin/test/browser/watch.ts`, `apps/admin/test/case-fixtures.ts`, `apps/admin/test/cases.test.tsx`, `apps/admin/test/fixtures.ts`, `apps/admin/test/screens.test.tsx`, `apps/admin/test/source.test.ts`, `apps/api/test/account/deletion.test.ts`, `apps/api/test/account/export.test.ts`, `apps/api/test/integration/account-deletion.test.ts`, `apps/api/test/integration/account-export.test.ts`, `apps/api/test/integration/account-takedown.test.ts`, `apps/api/test/integration/http-appeals.test.ts`, `apps/api/test/integration/http-deletion.test.ts`, `apps/api/test/integration/http-staff-decisions.test.ts`, `apps/api/test/integration/media-gates.test.ts`, `apps/api/test/integration/moderation-appeals-flow.test.ts`, `apps/api/test/integration/moderation-appeals.test.ts`, `apps/api/test/integration/moderation-author.test.ts`, `apps/api/test/integration/moderation-cases.test.ts`, `apps/api/test/integration/moderation-decide.ts`, `apps/api/test/integration/moderation-dispatch.test.ts`, `apps/api/test/integration/moderation-path.test.ts`, `apps/api/test/integration/moderation-statement.test.ts`, `apps/api/test/integration/standing-at-once.test.ts`, `apps/api/test/integration/standing-handles.test.ts`, `apps/api/test/integration/standing-route-walk.test.ts`, `apps/api/test/integration/standing-strikes.test.ts`, `apps/api/test/lab/standing.lab.ts`, `apps/api/test/mail/moderation-templates.test.ts`, `apps/api/test/mail/templates.test.ts`, `apps/api/test/moderation-author.test.ts`, `apps/api/test/moderation-export.test.ts`, `apps/api/test/staff/route-table.test.ts`, `apps/app/test/appeals.test.tsx`, `apps/app/test/cases.test.tsx`, `apps/app/test/lifecycle.test.tsx`, `apps/app/test/standing.test.tsx`, `packages/contracts/test/appeals.test.ts`, `packages/contracts/test/author.test.ts`, `packages/contracts/test/outcomes.test.ts`, `packages/contracts/test/staff-cases.test.ts`, `packages/contracts/test/standing.test.ts`, `packages/rules/test/statement.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/admin/src/screens/Standing.tsx`, `apps/app/src/app/settings/cases/[id]/reply.tsx`, `apps/admin/src/App.tsx`, `apps/admin/src/Layout.tsx`, `apps/admin/src/api.ts`, `apps/admin/src/compose.ts`, `apps/admin/src/messages.ts`, `apps/admin/src/router.ts`, `apps/admin/src/screens/Appeals.tsx`, `apps/admin/src/screens/Case.tsx`, `apps/admin/src/screens/Composer.tsx`, `apps/admin/src/screens/Home.tsx`, `apps/admin/src/screens/Queue.tsx`, `apps/api/src/account/context.ts`, `apps/api/src/account/purge.ts`, `apps/api/src/auth/flows/deletion.ts`, `apps/api/src/auth/flows/notifiers.ts`, `apps/api/src/auth/index.ts`, `apps/api/src/auth/repo.ts`, `apps/api/src/mail/mailer.ts`, `apps/api/src/mail/templates.ts`, `apps/api/src/moderation/alerts.ts`, `apps/api/src/moderation/appeals.ts`, `apps/api/src/moderation/author-repo.ts`, `apps/api/src/moderation/author.ts`, `apps/api/src/moderation/cases.ts`, `apps/api/src/moderation/decide.ts`, `apps/api/src/moderation/dispatch.ts`, `apps/api/src/moderation/index.ts`, `apps/api/src/moderation/repo.ts`, `apps/api/src/moderation/routes.ts`, `apps/api/src/moderation/standing-repo.ts`, `apps/api/src/moderation/standing.ts`, `apps/api/src/moderation/statement-repo.ts`, `apps/api/src/moderation/statement.ts`, `apps/api/src/staff/cases.ts`, `apps/app/src/app/settings/account.tsx`, `apps/app/src/components/StandingBanner.tsx`, `apps/app/src/components/moderation/DecisionDetail.tsx`, `apps/app/src/lib/api.ts`, `apps/app/src/lib/moderation.ts`, `apps/app/src/lib/standing.ts`, `packages/contracts/src/moderation.ts`, `packages/rules/src/statement.ts`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm -r --if-present run test --testTimeout=20000`, expecting `Tests  `**
- [ ] **Step 6: admin-build: run `pnpm --filter @korbat/admin build 2>&1 | tail -2 && ls apps/admin/dist apps/admin/dist/assets | sed -E 's/-[A-Z0-9]{8}[.]/-HASH./'`, expecting `Build success`, `index.html`, `main-HASH.js`, `main-HASH.css`**
- [ ] **Step 7: admin-browser: run `pnpm --filter @korbat/admin test:browser`, expecting `Tests  41 passed (41)`**
- [ ] **Step 8: export: run the `export` command in the prompt, expecting `Exported`**
- [ ] **Step 9: integration-own: run the `integration-own` command in the prompt, expecting `Tests  `**
- [ ] **Step 10: api-bundle: run the `api-bundle` command in the prompt, expecting `Build success`, `bundle-ok`**
- [ ] **Step 11: Commit: `feat(contracts,rules,api,admin,app): announced suspensions, replies and termination: a moderator announces a suspension at the ladder's step, and an admin announces a termination or terminates at once on a second threat, through the routes; the notice's outcome is recorded under the account's profile lock and fixes the start; POST /api/moderation/decisions/:id/reply holds a start not yet reached, and a kept or reversed correction, or a review that keeps the measure, answers it, the six months to appeal counting again after a kept answer to an on-time reply; an admin withdraws an announced measure for another (replaced); the purge round takes a final termination down through takeDownDue and takeDownTerminated, which mails termination_final; the console gains the announce controls, Replies to answer, the Standing screen and the home lines, the app the banner's states, the reply screen and Where it stands now; labs C1, C2 and D run on the real code`**

### Task 5: The restriction of reporting

**Prompt:** `docs/superpowers/prompts/account-sanctions-3e/05-restriction-of-reporting.md`

**Files:**
- Create: `apps/admin/test/reporting.test.tsx`
- Create: `apps/api/test/integration/standing-reporting.test.ts`
- Create: `apps/app/test/reporting.test.tsx`
- Create: `packages/db/migrations/0022_reporting_counts.sql`
- Create: `packages/db/migrations/meta/0022_snapshot.json`
- Modify: `apps/admin/src/compose.ts`
- Modify: `apps/admin/src/messages.ts`
- Modify: `apps/admin/src/screens/Case.tsx`
- Modify: `apps/admin/src/screens/Composer.tsx`
- Modify: `apps/admin/src/screens/Standing.tsx`
- Modify: `apps/admin/test/announced.test.tsx`
- Modify: `apps/admin/test/appeals.test.tsx`
- Modify: `apps/admin/test/browser/console.browser.ts`
- Modify: `apps/admin/test/browser/fixture-api.ts`
- Modify: `apps/admin/test/case-fixtures.ts`
- Modify: `apps/admin/test/cases.test.tsx`
- Modify: `apps/api/src/auth/flows/notifiers.ts`
- Modify: `apps/api/src/mail/mailer.ts`
- Modify: `apps/api/src/mail/templates.ts`
- Modify: `apps/api/src/moderation/author-repo.ts`
- Modify: `apps/api/src/moderation/author.ts`
- Modify: `apps/api/src/moderation/cases.ts`
- Modify: `apps/api/src/moderation/decide.ts`
- Modify: `apps/api/src/moderation/intake.ts`
- Modify: `apps/api/src/moderation/repo.ts`
- Modify: `apps/api/src/moderation/reports.ts`
- Modify: `apps/api/src/moderation/standing-repo.ts`
- Modify: `apps/api/src/moderation/standing.ts`
- Modify: `apps/api/src/moderation/statement-repo.ts`
- Modify: `apps/api/src/moderation/statement.ts`
- Modify: `apps/api/test/integration/cli-staff-cases.test.ts`
- Modify: `apps/api/test/integration/http-staff-decisions.test.ts`
- Modify: `apps/api/test/integration/moderation-author.test.ts`
- Modify: `apps/api/test/integration/moderation-fixtures.ts`
- Modify: `apps/api/test/integration/moderation-intake.test.ts`
- Modify: `apps/api/test/integration/moderation-release.test.ts`
- Modify: `apps/api/test/integration/moderation-retention-db.test.ts`
- Modify: `apps/api/test/integration/notices-harness.ts`
- Modify: `apps/api/test/integration/standing-grants.test.ts`
- Modify: `apps/api/test/integration/standing-handles.test.ts`
- Modify: `apps/api/test/integration/standing-strikes.test.ts`
- Modify: `apps/api/test/mail/moderation-templates.test.ts`
- Modify: `apps/api/test/moderation-mail-template.test.ts`
- Modify: `apps/app/src/components/moderation/CasesLists.tsx`
- Modify: `apps/app/src/components/moderation/DecisionDetail.tsx`
- Modify: `apps/app/src/components/moderation/ItemLines.tsx`
- Modify: `apps/app/src/components/moderation/ReportForm.tsx`
- Modify: `apps/app/src/lib/api.ts`
- Modify: `apps/app/src/lib/standing.ts`
- Modify: `apps/app/test/appeals.test.tsx`
- Modify: `apps/app/test/cases.test.tsx`
- Modify: `packages/contracts/src/moderation.ts`
- Modify: `packages/contracts/test/author.test.ts`
- Modify: `packages/contracts/test/staff-cases.test.ts`
- Modify: `packages/contracts/test/standing.test.ts`
- Modify: `packages/db/migrations/meta/_journal.json`
- Modify: `packages/rules/src/statement.ts`
- Modify: `packages/rules/test/statement.test.ts`

- [ ] **Step 1: Write the failing tests: `apps/admin/test/reporting.test.tsx`, `apps/api/test/integration/standing-reporting.test.ts`, `apps/app/test/reporting.test.tsx`, `apps/admin/test/announced.test.tsx`, `apps/admin/test/appeals.test.tsx`, `apps/admin/test/browser/console.browser.ts`, `apps/admin/test/browser/fixture-api.ts`, `apps/admin/test/case-fixtures.ts`, `apps/admin/test/cases.test.tsx`, `apps/api/test/integration/cli-staff-cases.test.ts`, `apps/api/test/integration/http-staff-decisions.test.ts`, `apps/api/test/integration/moderation-author.test.ts`, `apps/api/test/integration/moderation-fixtures.ts`, `apps/api/test/integration/moderation-intake.test.ts`, `apps/api/test/integration/moderation-release.test.ts`, `apps/api/test/integration/moderation-retention-db.test.ts`, `apps/api/test/integration/notices-harness.ts`, `apps/api/test/integration/standing-grants.test.ts`, `apps/api/test/integration/standing-handles.test.ts`, `apps/api/test/integration/standing-strikes.test.ts`, `apps/api/test/mail/moderation-templates.test.ts`, `apps/api/test/moderation-mail-template.test.ts`, `apps/app/test/appeals.test.tsx`, `apps/app/test/cases.test.tsx`, `packages/contracts/test/author.test.ts`, `packages/contracts/test/staff-cases.test.ts`, `packages/contracts/test/standing.test.ts`, `packages/rules/test/statement.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `packages/db/migrations/0022_reporting_counts.sql`, `packages/db/migrations/meta/0022_snapshot.json`, `apps/admin/src/compose.ts`, `apps/admin/src/messages.ts`, `apps/admin/src/screens/Case.tsx`, `apps/admin/src/screens/Composer.tsx`, `apps/admin/src/screens/Standing.tsx`, `apps/api/src/auth/flows/notifiers.ts`, `apps/api/src/mail/mailer.ts`, `apps/api/src/mail/templates.ts`, `apps/api/src/moderation/author-repo.ts`, `apps/api/src/moderation/author.ts`, `apps/api/src/moderation/cases.ts`, `apps/api/src/moderation/decide.ts`, `apps/api/src/moderation/intake.ts`, `apps/api/src/moderation/repo.ts`, `apps/api/src/moderation/reports.ts`, `apps/api/src/moderation/standing-repo.ts`, `apps/api/src/moderation/standing.ts`, `apps/api/src/moderation/statement-repo.ts`, `apps/api/src/moderation/statement.ts`, `apps/app/src/components/moderation/CasesLists.tsx`, `apps/app/src/components/moderation/DecisionDetail.tsx`, `apps/app/src/components/moderation/ItemLines.tsx`, `apps/app/src/components/moderation/ReportForm.tsx`, `apps/app/src/lib/api.ts`, `apps/app/src/lib/standing.ts`, `packages/contracts/src/moderation.ts`, `packages/db/migrations/meta/_journal.json`, `packages/rules/src/statement.ts`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm -r --if-present run test --testTimeout=20000`, expecting `Tests  `**
- [ ] **Step 6: generate: run `pnpm --filter @korbat/db generate`, expecting `No schema changes`**
- [ ] **Step 7: apply-migrations: run the `apply-migrations` command in the prompt, expecting `migrations applied`, `count=23`**
- [ ] **Step 8: admin-build: run `pnpm --filter @korbat/admin build 2>&1 | tail -2 && ls apps/admin/dist apps/admin/dist/assets | sed -E 's/-[A-Z0-9]{8}[.]/-HASH./'`, expecting `Build success`, `index.html`, `main-HASH.js`, `main-HASH.css`**
- [ ] **Step 9: admin-browser: run `pnpm --filter @korbat/admin test:browser`, expecting `Tests  43 passed (43)`**
- [ ] **Step 10: export: run the `export` command in the prompt, expecting `Exported`**
- [ ] **Step 11: test-database: run `node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `migrations applied`, `test database ready: korbat_test`**
- [ ] **Step 12: integration-own: run the `integration-own` command in the prompt, expecting `Tests  `**
- [ ] **Step 13: api-bundle: run the `api-bundle` command in the prompt, expecting `Build success`, `bundle-ok`**
- [ ] **Step 14: Commit: `feat(db,contracts,rules,api,admin,app): the restriction of reporting: migration 0022_reporting_counts adds unfounded_marks_check, which takes a mark only from its own final no-breach decision on a signed-in rule report it answered and forces the reporter, the report and the times, then grants the API INSERT on marks; unfounded_marks_recheck runs decision_holds again after any later mark; report_tallies_count counts each signed-in rule report once on its UTC day; the view reporting_record counts reports and marked reports in the frame; forget_reporter also deletes an account's marks and tallies; the routes take warn_reporting, restrict_reporting, lift_reporting and the signed marks, and a kept correction withdraws a decision's marks; a restricted reporter's rule report is refused reporting_restricted; the case answer, /me, the Standing screen, the statement, two mails, the console's composer and the app read and word the counts, the marks, the warning, the restriction and its end with its warning`**

### Task 6: Explore version 2: the migration explore_resume (moderation_apply and posts_guard replaced), EXPLORE_V2 in place of EXPLORE_V1, the round's three fragments with the predicate and explore_from, the skip rule, explorePage and listedInExplore, the status suspended, and the app's texts and change log.

**Prompt:** `docs/superpowers/prompts/account-sanctions-3e/06-explore-version-2.md`

**Files:**
- Create: `apps/api/test/integration/standing-explore.test.ts`
- Create: `packages/db/migrations/0023_explore_resume.sql`
- Create: `packages/db/migrations/meta/0023_snapshot.json`
- Modify: `apps/api/src/social/explore.ts`
- Modify: `apps/api/src/social/flows/explore.ts`
- Modify: `apps/api/src/social/repo.ts`
- Modify: `apps/api/src/social/views.ts`
- Modify: `apps/api/test/architecture.test.ts`
- Modify: `apps/api/test/integration/http-explore.test.ts`
- Modify: `apps/api/test/integration/moderation-apply.test.ts`
- Modify: `apps/api/test/integration/moderation-fixtures.ts`
- Modify: `apps/api/test/integration/moderation-schema.test.ts`
- Modify: `apps/api/test/integration/social-explore-job.test.ts`
- Modify: `apps/api/test/integration/social-explore-ranking.test.ts`
- Modify: `apps/api/test/integration/social-explore-reads.test.ts`
- Modify: `apps/api/test/integration/standing-grants.test.ts`
- Modify: `apps/api/test/lab/standing.lab.ts`
- Modify: `apps/api/test/social/explore-job.test.ts`
- Modify: `apps/app/src/app/explore/about.tsx`
- Modify: `apps/app/src/components/social/ExploreList.tsx`
- Modify: `apps/app/src/lib/explore.ts`
- Modify: `apps/app/test/explore.test.tsx`
- Modify: `packages/contracts/src/explore.ts`
- Modify: `packages/contracts/test/explore.test.ts`
- Modify: `packages/db/migrations/meta/_journal.json`
- Modify: `packages/db/src/schema/content.ts`

- [ ] **Step 1: Write the failing tests: `apps/api/test/integration/standing-explore.test.ts`, `apps/api/test/architecture.test.ts`, `apps/api/test/integration/http-explore.test.ts`, `apps/api/test/integration/moderation-apply.test.ts`, `apps/api/test/integration/moderation-fixtures.ts`, `apps/api/test/integration/moderation-schema.test.ts`, `apps/api/test/integration/social-explore-job.test.ts`, `apps/api/test/integration/social-explore-ranking.test.ts`, `apps/api/test/integration/social-explore-reads.test.ts`, `apps/api/test/integration/standing-grants.test.ts`, `apps/api/test/lab/standing.lab.ts`, `apps/api/test/social/explore-job.test.ts`, `apps/app/test/explore.test.tsx`, `packages/contracts/test/explore.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `packages/db/migrations/0023_explore_resume.sql`, `packages/db/migrations/meta/0023_snapshot.json`, `apps/api/src/social/explore.ts`, `apps/api/src/social/flows/explore.ts`, `apps/api/src/social/repo.ts`, `apps/api/src/social/views.ts`, `apps/app/src/app/explore/about.tsx`, `apps/app/src/components/social/ExploreList.tsx`, `apps/app/src/lib/explore.ts`, `packages/contracts/src/explore.ts`, `packages/db/migrations/meta/_journal.json`, `packages/db/src/schema/content.ts`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm -r --if-present run test --testTimeout=20000`, expecting `Tests  `**
- [ ] **Step 6: generate: run `pnpm --filter @korbat/db generate`, expecting `No schema changes`**
- [ ] **Step 7: apply-migrations: run the `apply-migrations` command in the prompt, expecting `migrations applied`, `count=24`**
- [ ] **Step 8: export: run the `export` command in the prompt, expecting `Exported`**
- [ ] **Step 9: test-database: run `node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `migrations applied`, `test database ready: korbat_test`**
- [ ] **Step 10: integration-own: run the `integration-own` command in the prompt, expecting `Tests  `**
- [ ] **Step 11: api-bundle: run the `api-bundle` command in the prompt, expecting `Build success`, `bundle-ok`**
- [ ] **Step 12: Commit: `feat(db,contracts,api,app): Explore formula version 2: migration 0023_explore_resume makes moderation_apply, the one writer of a post's level, the one writer of posts.hidden_at, restored_at and explore_from in the UPDATE that moves the level, so a restored post's window and age resume by exactly the hidden spans of the ledger, and posts_guard forces the three null on an insert by any role but the migrator; EXPLORE_V2 replaces EXPLORE_V1 with the same numbers and a second entry in the change log; the round leaves out authors and engagers suspended at its own time, counts the window and the score from coalesce(explore_from, created_at) and throws for any other version, and only rankings of version 2 hold a round back; the page, the chip and the status judge the author at the database's clock, and the status gains suspended, reads the window from explore_from, answers pending for a post restored after the ranking and judges only now under a ranking of version 1; How Explore works and the status line say so; lab F runs on the real code`**

### Task 7: Retention, export, terms and records: the migration standing_retention and the retention job's two steps, RETENTION's three members, the export's standing, replies and reporting, the terms' four sections and changed sentences, the smoke test's two steps, the README's runbook and the dated amendments of section 15 and of the dry run.

**Prompt:** `docs/superpowers/prompts/account-sanctions-3e/07-retention-export-terms-records.md`

**Files:**
- Create: `apps/api/test/integration/standing-retention.test.ts`
- Create: `packages/db/migrations/0024_standing_retention.sql`
- Create: `packages/db/migrations/meta/0024_snapshot.json`
- Modify: `README.md`
- Modify: `apps/admin/test/readme.test.ts`
- Modify: `apps/api/src/account/flows/export.ts`
- Modify: `apps/api/src/cli/staff-cases.ts`
- Modify: `apps/api/src/moderation/export.ts`
- Modify: `apps/api/src/moderation/repo.ts`
- Modify: `apps/api/src/moderation/retention.ts`
- Modify: `apps/api/src/moderation/standing-repo.ts`
- Modify: `apps/api/test/account/export.test.ts`
- Modify: `apps/api/test/integration/cli-staff-cases.test.ts`
- Modify: `apps/api/test/integration/moderation-export.test.ts`
- Modify: `apps/api/test/integration/moderation-retention-db.test.ts`
- Modify: `apps/api/test/integration/moderation-retention.test.ts`
- Modify: `apps/api/test/integration/moderation-schema.test.ts`
- Modify: `apps/api/test/integration/standing-grants.test.ts`
- Modify: `apps/app/src/lib/terms.ts`
- Modify: `apps/app/test/terms.test.tsx`
- Modify: `docs/superpowers/specs/2026-09-03-korbat-design.md`
- Modify: `docs/superpowers/specs/2026-09-17-posting-feed-2a-design.md`
- Modify: `docs/superpowers/specs/2026-09-24-account-lifecycle-1b-design.md`
- Modify: `docs/superpowers/specs/2026-09-28-explore-2c-design.md`
- Modify: `docs/superpowers/specs/2026-10-02-moderation-cases-3c-design.md`
- Modify: `docs/superpowers/specs/2026-10-09-account-sanctions-3e-design.md`
- Modify: `packages/contracts/src/account.ts`
- Modify: `packages/contracts/src/moderation.ts`
- Modify: `packages/contracts/test/account.test.ts`
- Modify: `packages/contracts/test/moderation.test.ts`
- Modify: `packages/db/migrations/meta/_journal.json`
- Modify: `scripts/smoke-auth-stack.mjs`

- [ ] **Step 1: Write the failing tests: `apps/api/test/integration/standing-retention.test.ts`, `apps/admin/test/readme.test.ts`, `apps/api/test/account/export.test.ts`, `apps/api/test/integration/cli-staff-cases.test.ts`, `apps/api/test/integration/moderation-export.test.ts`, `apps/api/test/integration/moderation-retention-db.test.ts`, `apps/api/test/integration/moderation-retention.test.ts`, `apps/api/test/integration/moderation-schema.test.ts`, `apps/api/test/integration/standing-grants.test.ts`, `apps/app/test/terms.test.tsx`, `packages/contracts/test/account.test.ts`, `packages/contracts/test/moderation.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `packages/db/migrations/0024_standing_retention.sql`, `packages/db/migrations/meta/0024_snapshot.json`, `README.md`, `apps/api/src/account/flows/export.ts`, `apps/api/src/cli/staff-cases.ts`, `apps/api/src/moderation/export.ts`, `apps/api/src/moderation/repo.ts`, `apps/api/src/moderation/retention.ts`, `apps/api/src/moderation/standing-repo.ts`, `apps/app/src/lib/terms.ts`, `docs/superpowers/specs/2026-09-03-korbat-design.md`, `docs/superpowers/specs/2026-09-17-posting-feed-2a-design.md`, `docs/superpowers/specs/2026-09-24-account-lifecycle-1b-design.md`, `docs/superpowers/specs/2026-09-28-explore-2c-design.md`, `docs/superpowers/specs/2026-10-02-moderation-cases-3c-design.md`, `docs/superpowers/specs/2026-10-09-account-sanctions-3e-design.md`, `packages/contracts/src/account.ts`, `packages/contracts/src/moderation.ts`, `packages/db/migrations/meta/_journal.json`, `scripts/smoke-auth-stack.mjs`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm -r --if-present run test --testTimeout=20000`, expecting `Tests  `**
- [ ] **Step 6: generate: run `pnpm --filter @korbat/db generate`, expecting `No schema changes`**
- [ ] **Step 7: apply-migrations: run the `apply-migrations` command in the prompt, expecting `migrations applied`, `count=25`**
- [ ] **Step 8: admin-build: run `pnpm --filter @korbat/admin build 2>&1 | tail -2 && ls apps/admin/dist apps/admin/dist/assets | sed -E 's/-[A-Z0-9]{8}[.]/-HASH./'`, expecting `Build success`, `index.html`, `main-HASH.js`, `main-HASH.css`**
- [ ] **Step 9: export: run the `export` command in the prompt, expecting `Exported`**
- [ ] **Step 10: test-database-fresh: run `node scripts/test-db.mjs --fresh -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `test database ready: korbat_test`**
- [ ] **Step 11: integration-fresh: run the `integration-fresh` command in the prompt, expecting `Tests  `**
- [ ] **Step 12: test-database-upgrade: run `node scripts/test-db.mjs --upgrade-from 19 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `migrations up to 0019_redaction_scope applied and committed`, `later migrations applied as one batch`, `test database ready: korbat_test`**
- [ ] **Step 13: integration-upgraded: run the `integration-upgraded` command in the prompt, expecting `Tests  `**
- [ ] **Step 14: timing: run the `timing` command in the prompt, expecting `timing-ok=1`**
- [ ] **Step 15: api-bundle: run the `api-bundle` command in the prompt, expecting `Build success`, `bundle-ok`**
- [ ] **Step 16: stack-down: run `docker compose -f infra/compose.yml -f infra/compose.dev.yml down && echo down-ok`, expecting `down-ok`**
- [ ] **Step 17: build: run the `build` command in the prompt, expecting `build-exit=0`**
- [ ] **Step 18: stack-up: run `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --wait && echo up-ok`, expecting `up-ok`**
- [ ] **Step 19: test-database: run `node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `migrations applied`, `test database ready: korbat_test`**
- [ ] **Step 20: smoke: run the `smoke` command in the prompt, expecting `smoke test passed`**
- [ ] **Step 21: stack-stop: run the `stack-stop` command in the prompt, expecting `postgres-1 Up`**
- [ ] **Step 22: Commit: `feat(db,contracts,api,app,admin,docs): retention, export, terms and records of account sanctions: migration 0024_standing_retention adds erase_reply_statements, which blanks a reply's text and salt only once the reply is answered and its decision is final for its author, keeping the digest and the row, and forget_report_counts, which deletes the marks, withdrawn ones too, and the tallies of UTC days before the frame, so both sides of a count leave on the same day; the retention job runs both as its steps reply_statements and report_counts; RETENTION gains replyText, reportCountDays and standingRecord, read from STANDING_RULES; the export gains standing, replies and reporting, a mark by its own report's reference and position; the terms gain Strikes, Suspension and termination, Reporting in bad faith and Handles, list every measure and print every number from its constant; text-verify takes a mark korbat's own rules deleted for no difference; the smoke test reads the standing on /api/me and refuses /api/staff/standing; the README gains 3e's part and runbook, held to the constants by a docs test; the designs gain their dated amendments and 3e's from the dry run`**

### Task 8: What the one adversarial review of account sanctions as built upheld, fixed: the closing judgment of every refused write, the bound of a starved lock, no profile held across a mail, the stale notice, released marks only, and the texts, rows and tests the review named.

**Prompt:** `docs/superpowers/prompts/account-sanctions-3e/08-review-fixes.md`

**Files:**
- Create: `apps/api/test/integration/standing-closing.test.ts`
- Create: `apps/app/src/components/moderation/RefusedNotice.tsx`
- Create: `packages/db/migrations/0025_standing_review.sql`
- Create: `packages/db/migrations/meta/0025_snapshot.json`
- Modify: `README.md`
- Modify: `apps/admin/src/compose.ts`
- Modify: `apps/admin/src/messages.ts`
- Modify: `apps/admin/src/screens/Queue.tsx`
- Modify: `apps/admin/test/announced.test.tsx`
- Modify: `apps/api/src/auth/flows/badge.ts`
- Modify: `apps/api/src/auth/flows/deletion.ts`
- Modify: `apps/api/src/auth/repo.ts`
- Modify: `apps/api/src/lib/lock-bounds.ts`
- Modify: `apps/api/src/lib/standing.ts`
- Modify: `apps/api/src/media/repo.ts`
- Modify: `apps/api/src/moderation/author-repo.ts`
- Modify: `apps/api/src/moderation/author.ts`
- Modify: `apps/api/src/moderation/decide.ts`
- Modify: `apps/api/src/moderation/dispatch.ts`
- Modify: `apps/api/src/moderation/intake.ts`
- Modify: `apps/api/src/moderation/repo.ts`
- Modify: `apps/api/src/moderation/reveal.ts`
- Modify: `apps/api/src/moderation/standing-repo.ts`
- Modify: `apps/api/src/moderation/standing.ts`
- Modify: `apps/api/src/moderation/statement-repo.ts`
- Modify: `apps/api/src/moderation/statement.ts`
- Modify: `apps/api/src/profiles/store.ts`
- Modify: `apps/api/src/social/repo.ts`
- Modify: `apps/api/test/architecture.test.ts`
- Modify: `apps/api/test/integration/http-badge.test.ts`
- Modify: `apps/api/test/integration/moderation-fixtures.ts`
- Modify: `apps/api/test/integration/moderation-races.test.ts`
- Modify: `apps/api/test/integration/moderation-statement.test.ts`
- Modify: `apps/api/test/integration/standing-announced.test.ts`
- Modify: `apps/api/test/integration/standing-at-once.test.ts`
- Modify: `apps/api/test/integration/standing-ledger.test.ts`
- Modify: `apps/api/test/integration/standing-replies.test.ts`
- Modify: `apps/api/test/integration/standing-reporting.test.ts`
- Modify: `apps/api/test/integration/standing-retention.test.ts`
- Modify: `apps/api/test/integration/standing-route-walk.test.ts`
- Modify: `apps/api/test/integration/standing-termination.test.ts`
- Modify: `apps/api/test/lab/standing.lab.ts`
- Modify: `apps/api/test/lock-bounds.test.ts`
- Modify: `apps/api/test/moderation-author.test.ts`
- Modify: `apps/api/test/moderation-intake-order.test.ts`
- Modify: `apps/api/test/moderation-retry.test.ts`
- Modify: `apps/app/src/app/u/[handle]/index.tsx`
- Modify: `apps/app/src/components/moderation/CasesLists.tsx`
- Modify: `apps/app/src/components/moderation/ItemLines.tsx`
- Modify: `apps/app/src/components/social/PostCard.tsx`
- Modify: `apps/app/src/lib/api.ts`
- Modify: `apps/app/src/lib/standing.ts`
- Modify: `apps/app/test/announced.test.tsx`
- Modify: `apps/app/test/cases.test.tsx`
- Modify: `apps/app/test/reporting.test.tsx`
- Modify: `docs/superpowers/specs/2026-10-09-account-sanctions-3e-design.md`
- Modify: `packages/contracts/src/moderation.ts`
- Modify: `packages/db/migrations/meta/_journal.json`
- Modify: `packages/rules/src/statement.ts`
- Modify: `packages/rules/test/statement.test.ts`

- [ ] **Step 1: Write the failing tests: `apps/api/test/integration/standing-closing.test.ts`, `apps/admin/test/announced.test.tsx`, `apps/api/test/architecture.test.ts`, `apps/api/test/integration/http-badge.test.ts`, `apps/api/test/integration/moderation-fixtures.ts`, `apps/api/test/integration/moderation-races.test.ts`, `apps/api/test/integration/moderation-statement.test.ts`, `apps/api/test/integration/standing-announced.test.ts`, `apps/api/test/integration/standing-at-once.test.ts`, `apps/api/test/integration/standing-ledger.test.ts`, `apps/api/test/integration/standing-replies.test.ts`, `apps/api/test/integration/standing-reporting.test.ts`, `apps/api/test/integration/standing-retention.test.ts`, `apps/api/test/integration/standing-route-walk.test.ts`, `apps/api/test/integration/standing-termination.test.ts`, `apps/api/test/lab/standing.lab.ts`, `apps/api/test/lock-bounds.test.ts`, `apps/api/test/moderation-author.test.ts`, `apps/api/test/moderation-intake-order.test.ts`, `apps/api/test/moderation-retry.test.ts`, `apps/app/test/announced.test.tsx`, `apps/app/test/cases.test.tsx`, `apps/app/test/reporting.test.tsx`, `packages/rules/test/statement.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/app/src/components/moderation/RefusedNotice.tsx`, `packages/db/migrations/0025_standing_review.sql`, `packages/db/migrations/meta/0025_snapshot.json`, `README.md`, `apps/admin/src/compose.ts`, `apps/admin/src/messages.ts`, `apps/admin/src/screens/Queue.tsx`, `apps/api/src/auth/flows/badge.ts`, `apps/api/src/auth/flows/deletion.ts`, `apps/api/src/auth/repo.ts`, `apps/api/src/lib/lock-bounds.ts`, `apps/api/src/lib/standing.ts`, `apps/api/src/media/repo.ts`, `apps/api/src/moderation/author-repo.ts`, `apps/api/src/moderation/author.ts`, `apps/api/src/moderation/decide.ts`, `apps/api/src/moderation/dispatch.ts`, `apps/api/src/moderation/intake.ts`, `apps/api/src/moderation/repo.ts`, `apps/api/src/moderation/reveal.ts`, `apps/api/src/moderation/standing-repo.ts`, `apps/api/src/moderation/standing.ts`, `apps/api/src/moderation/statement-repo.ts`, `apps/api/src/moderation/statement.ts`, `apps/api/src/profiles/store.ts`, `apps/api/src/social/repo.ts`, `apps/app/src/app/u/[handle]/index.tsx`, `apps/app/src/components/moderation/CasesLists.tsx`, `apps/app/src/components/moderation/ItemLines.tsx`, `apps/app/src/components/social/PostCard.tsx`, `apps/app/src/lib/api.ts`, `apps/app/src/lib/standing.ts`, `docs/superpowers/specs/2026-10-09-account-sanctions-3e-design.md`, `packages/contracts/src/moderation.ts`, `packages/db/migrations/meta/_journal.json`, `packages/rules/src/statement.ts`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm -r --if-present run test --testTimeout=20000`, expecting `Tests  `**
- [ ] **Step 6: generate: run `pnpm --filter @korbat/db generate`, expecting `No schema changes`**
- [ ] **Step 7: apply-migrations: run the `apply-migrations` command in the prompt, expecting `migrations applied`, `count=26`**
- [ ] **Step 8: admin-build: run `pnpm --filter @korbat/admin build 2>&1 | tail -2 && ls apps/admin/dist apps/admin/dist/assets | sed -E 's/-[A-Z0-9]{8}[.]/-HASH./'`, expecting `Build success`, `index.html`, `main-HASH.js`, `main-HASH.css`**
- [ ] **Step 9: admin-browser: run `pnpm --filter @korbat/admin test:browser`, expecting `Tests  43 passed (43)`**
- [ ] **Step 10: export: run the `export` command in the prompt, expecting `Exported`**
- [ ] **Step 11: test-database-fresh: run `node scripts/test-db.mjs --fresh -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `test database ready: korbat_test`**
- [ ] **Step 12: integration-fresh: run the `integration-fresh` command in the prompt, expecting `Tests  `**
- [ ] **Step 13: test-database-upgrade: run `node scripts/test-db.mjs --upgrade-from 19 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `migrations up to 0019_redaction_scope applied and committed`, `later migrations applied as one batch`, `test database ready: korbat_test`**
- [ ] **Step 14: integration-upgraded: run the `integration-upgraded` command in the prompt, expecting `Tests  `**
- [ ] **Step 15: timing: run the `timing` command in the prompt, expecting `timing-ok=1`**
- [ ] **Step 16: api-bundle: run the `api-bundle` command in the prompt, expecting `Build success`, `bundle-ok`**
- [ ] **Step 17: stack-down: run `docker compose -f infra/compose.yml -f infra/compose.dev.yml down && echo down-ok`, expecting `down-ok`**
- [ ] **Step 18: build: run the `build` command in the prompt, expecting `build-exit=0`**
- [ ] **Step 19: stack-up: run `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --wait && echo up-ok`, expecting `up-ok`**
- [ ] **Step 20: test-database: run `node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `migrations applied`, `test database ready: korbat_test`**
- [ ] **Step 21: smoke: run the `smoke` command in the prompt, expecting `smoke test passed`**
- [ ] **Step 22: stack-stop: run the `stack-stop` command in the prompt, expecting `postgres-1 Up`**
- [ ] **Step 23: Commit: `fix(db,contracts,rules,api,app,admin,docs): what the review of account sanctions upheld, fixed: every write a suspension refuses ends with a closing judgment of the acting account by the clock, after every lock, so none commits after a start it waited past; a bounded lock wait sets statement_timeout beside lock_timeout, so a starved FOR UPDATE ends at its bound; no profile is held across a mail, and a notice whose measure was withdrawn is recorded failed, never sent; migration 0025_standing_review counts a mark only once its outcome is released, takes a withdrawal only from an admin, refuses a reply after the take-down, erases a reply's text once nothing is in force and back-fills the tallies; a refused badge keeps its number; a decision about a measure on the terms says so; the app and the console word the rows, the banner, the refusals and the marks as the design does; and the missing tests`**
