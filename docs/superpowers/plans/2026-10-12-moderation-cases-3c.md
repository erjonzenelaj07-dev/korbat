# korbat — Moderation Cases (3c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anyone can report a post or a profile to korbat, on a rule or as illegal, signed in or not; one open case a target collects what was reported; a moderator's decision is its own statement of reasons and its measures are rows of a ledger from which a post's and an image's state are derived; the author is told, can appeal to a different person, and whoever reported can ask once for a re-examination; images reported as child sexual abuse material are frozen and sealed without anyone at korbat opening them; evidence is kept and erased by published rules.

**Architecture:** Twelve commits: the ground (migrations 0014 and 0015: the tables, the freeze and its gates), the decision engine (0016: decisions, the ledger of measures, the audit link), holds and images, reports and notices, the console's queue and case screens, deciding with statements and the dispatch of mails, the app's report form and case screens, appeals and re-examination (0017), the evidence lifecycle with the retention job and the command line (0018), the export with the terms and the stack check, the fixes one adversarial review of the built code upheld (0019), and the documentation.

**Tech Stack:** Node 24, TypeScript 7, Hono 4.13, zod 4, drizzle and hand-written SQL (SECURITY DEFINER triggers and functions, a view of measures in force), PostgreSQL 18, Valkey, React 19 with esbuild 0.28 for the console and playwright-core 1.63 for its browser check, Expo for the web app, Caddy 2.11, vitest 4. No new dependency.

**Complete code:** each task's full files, commands and observed output are in `docs/superpowers/prompts/moderation-cases-3c/NN-<slug>.md`, generated from a verified dry run. This plan is the map. Where it and a prompt differ, the prompt wins.

**Spec:** `docs/superpowers/specs/2026-10-02-moderation-cases-3c-design.md`.

---

## File structure

- `apps/admin/src/`: `frames.tsx` (Task 5), `hidden.ts` (Task 5), `media.tsx` (Task 5), `texts.ts` (Task 5), `words.ts` (Task 5), `compose.ts` (Task 6)
- `apps/admin/src/screens/`: `Case.tsx` (Task 5), `Queue.tsx` (Task 5), `Composer.tsx` (Task 6), `Appeals.tsx` (Task 8)
- `apps/admin/test/`: `case-fixtures.ts` (Task 5), `cases.test.tsx` (Task 5), `composer-drafts.test.tsx` (Task 6), `composer.test.tsx` (Task 6), `workspace.test.ts` (Task 6), `appeals.test.tsx` (Task 8), `readme.test.ts` (Task 12)
- `apps/api/`: `vitest.lab.config.ts` (Task 2)
- `apps/api/src/auth/flows/`: `notifiers.ts` (Task 4)
- `apps/api/src/cli/`: `staff-cases.ts` (Task 9)
- `apps/api/src/lib/`: `lock-bounds.ts` (Task 2)
- `apps/api/src/media/`: `cases.ts` (Task 3), `webp.ts` (Task 3), `owed.ts` (Task 11)
- `apps/api/src/moderation/`: `context.ts` (Task 2), `decide.ts` (Task 2), `index.ts` (Task 2), `intake.ts` (Task 2), `repo.ts` (Task 2), `alerts.ts` (Task 4), `links.ts` (Task 4), `routes.ts` (Task 4), `cases.ts` (Task 5), `overlap.ts` (Task 5), `reveal.ts` (Task 5), `texts.ts` (Task 5), `dispatch.ts` (Task 6), `statement.ts` (Task 6), `author-repo.ts` (Task 7), `author.ts` (Task 7), `reports.ts` (Task 7), `appeals.ts` (Task 8), `access.ts` (Task 9), `retention.ts` (Task 9), `export.ts` (Task 10), `statement-repo.ts` (Task 11)
- `apps/api/src/staff/`: `cases.ts` (Task 2)
- `apps/api/test/`: `lock-bounds.test.ts` (Task 2), `moderation-context.test.ts` (Task 2), `moderation-intake-order.test.ts` (Task 2), `moderation-retry.test.ts` (Task 2), `moderation-alerts.test.ts` (Task 4), `moderation-links.test.ts` (Task 4), `moderation-notice-limits.test.ts` (Task 4), `moderation-overlap.test.ts` (Task 5), `moderation-summary.test.ts` (Task 5), `moderation-dispatch.test.ts` (Task 6), `moderation-author.test.ts` (Task 7), `moderation-export.test.ts` (Task 10)
- `apps/api/test/integration/`: `media-sealed.test.ts` (Task 1), `moderation-attach.test.ts` (Task 1), `moderation-fixtures.ts` (Task 1), `moderation-freeze.test.ts` (Task 1), `moderation-schema.test.ts` (Task 1), `http-staff-decisions.test.ts` (Task 2), `moderation-apply.test.ts` (Task 2), `moderation-decide.ts` (Task 2), `moderation-decisions.test.ts` (Task 2), `moderation-intake.test.ts` (Task 2), `moderation-races.test.ts` (Task 2), `moderation-release.test.ts` (Task 2), `moderation-seal.test.ts` (Task 2), `media-cases.test.ts` (Task 3), `media-gates.test.ts` (Task 3), `auth-notifiers.test.ts` (Task 4), `http-notices.test.ts` (Task 4), `moderation-notices.test.ts` (Task 4), `notices-harness.ts` (Task 4), `http-staff-cases.test.ts` (Task 5), `moderation-cases.test.ts` (Task 5), `moderation-reveal.test.ts` (Task 5), `moderation-dispatch.test.ts` (Task 6), `moderation-path.test.ts` (Task 6), `moderation-statement.test.ts` (Task 6), `moderation-author.test.ts` (Task 7), `http-appeals.test.ts` (Task 8), `moderation-appeals-flow.test.ts` (Task 8), `moderation-appeals.test.ts` (Task 8), `moderation-reexamine.test.ts` (Task 8), `cli-staff-cases.test.ts` (Task 9), `media-states.test.ts` (Task 9), `moderation-retention-db.test.ts` (Task 9), `moderation-retention.test.ts` (Task 9), `retention-fixtures.ts` (Task 9), `moderation-export.test.ts` (Task 10), `moderation-log-errors.test.ts` (Task 11), `moderation-post-locks.test.ts` (Task 11)
- `apps/api/test/lab/`: `README.md` (Task 2), `contention.lab.ts` (Task 2), `hold.lab.ts` (Task 3)
- `apps/api/test/mail/`: `moderation-templates.test.ts` (Task 6)
- `apps/api/test/media/`: `webp-bytes.ts` (Task 3), `webp.test.ts` (Task 3)
- `apps/api/test/social/`: `delete-retry.test.ts` (Task 11)
- `apps/app/src/app/`: `report.tsx` (Task 7)
- `apps/app/src/app/notice/`: `[ref].tsx` (Task 7)
- `apps/app/src/app/settings/cases/`: `[id].tsx` (Task 7), `index.tsx` (Task 7)
- `apps/app/src/components/moderation/`: `CasesLists.tsx` (Task 7), `DecisionDetail.tsx` (Task 7), `ItemLines.tsx` (Task 7), `NoticeStatusView.tsx` (Task 7), `ReportForm.tsx` (Task 7)
- `apps/app/src/components/social/`: `HiddenImage.tsx` (Task 3)
- `apps/app/src/lib/`: `moderation-words.ts` (Task 7), `moderation.ts` (Task 7)
- `apps/app/test/`: `hidden-media.test.tsx` (Task 3), `cases.test.tsx` (Task 7), `report.test.tsx` (Task 7), `appeals.test.tsx` (Task 8), `terms.test.tsx` (Task 10)
- `packages/contracts/src/`: `canonical.ts` (Task 1), `moderation.ts` (Task 1)
- `packages/contracts/test/`: `canonical.test.ts` (Task 1), `digest-vectors.ts` (Task 1), `moderation.test.ts` (Task 1), `notices.test.ts` (Task 4), `staff-cases.test.ts` (Task 5), `outcomes.test.ts` (Task 6), `author.test.ts` (Task 7), `appeals.test.ts` (Task 8)
- `packages/db/migrations/`: `0014_old_vapor.sql` (Task 1), `0015_greedy_zuras.sql` (Task 1), `0016_decisions_and_ledger.sql` (Task 2), `0017_appeals.sql` (Task 8), `0018_retention.sql` (Task 9), `0019_redaction_scope.sql` (Task 11)
- `packages/db/migrations/meta/`: `0014_snapshot.json` (Task 1), `0015_snapshot.json` (Task 1), `0016_snapshot.json` (Task 2), `0017_snapshot.json` (Task 8), `0018_snapshot.json` (Task 9), `0019_snapshot.json` (Task 11)
- `packages/db/src/schema/`: `moderation.ts` (Task 1)
- `packages/rules/src/`: `statement.ts` (Task 6)
- `packages/rules/test/`: `statement.test.ts` (Task 6)

## Tasks

### Task 1: The ground for moderation cases: migration 0014 (the old tables, their enums and profiles.reputation dropped), migration 0015 (the moderation tables with their grants and forced columns, the attach and quote triggers, the view of measures in force, the freeze's predicate, the keep trigger and the guard on image rows, holds), the Drizzle schema, the contracts' constants and digests, image readers that give only visible images, test-db's --fresh and --upgrade-from, and the development cleaner's order

**Prompt:** `docs/superpowers/prompts/moderation-cases-3c/01-ground.md`

**Files:**
- Create: `apps/api/test/integration/media-sealed.test.ts`
- Create: `apps/api/test/integration/moderation-attach.test.ts`
- Create: `apps/api/test/integration/moderation-fixtures.ts`
- Create: `apps/api/test/integration/moderation-freeze.test.ts`
- Create: `apps/api/test/integration/moderation-schema.test.ts`
- Create: `packages/contracts/src/canonical.ts`
- Create: `packages/contracts/src/moderation.ts`
- Create: `packages/contracts/test/canonical.test.ts`
- Create: `packages/contracts/test/digest-vectors.ts`
- Create: `packages/contracts/test/moderation.test.ts`
- Create: `packages/db/migrations/0014_old_vapor.sql`
- Create: `packages/db/migrations/0015_greedy_zuras.sql`
- Create: `packages/db/migrations/meta/0014_snapshot.json`
- Create: `packages/db/migrations/meta/0015_snapshot.json`
- Create: `packages/db/src/schema/moderation.ts`
- Modify: `apps/api/src/media/flows/serve.ts`
- Modify: `apps/api/src/media/flows/status.ts`
- Modify: `apps/api/src/media/repo.ts`
- Modify: `apps/api/src/social/visibility.ts`
- Modify: `apps/api/test/integration/global-setup.ts`
- Modify: `apps/api/test/social/visibility.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/media.ts`
- Modify: `packages/contracts/src/staff.ts`
- Modify: `packages/contracts/test/media.test.ts`
- Modify: `packages/db/migrations/meta/_journal.json`
- Modify: `packages/db/src/schema/auth.ts`
- Modify: `packages/db/src/schema/content.ts`
- Modify: `packages/db/src/schema/helpers.ts`
- Modify: `packages/db/src/schema/identity.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/src/schema/safety.ts`
- Modify: `packages/db/test/schema.test.ts`
- Modify: `scripts/clean-dev-fixtures.mjs`
- Modify: `scripts/test-db.mjs`

- [ ] **Step 1: Write the failing tests: `apps/api/test/integration/media-sealed.test.ts`, `apps/api/test/integration/moderation-attach.test.ts`, `apps/api/test/integration/moderation-fixtures.ts`, `apps/api/test/integration/moderation-freeze.test.ts`, `apps/api/test/integration/moderation-schema.test.ts`, `packages/contracts/test/canonical.test.ts`, `packages/contracts/test/digest-vectors.ts`, `packages/contracts/test/moderation.test.ts`, `apps/api/test/integration/global-setup.ts`, `apps/api/test/social/visibility.test.ts`, `packages/contracts/test/media.test.ts`, `packages/db/test/schema.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `packages/contracts/src/canonical.ts`, `packages/contracts/src/moderation.ts`, `packages/db/migrations/0014_old_vapor.sql`, `packages/db/migrations/0015_greedy_zuras.sql`, `packages/db/migrations/meta/0014_snapshot.json`, `packages/db/migrations/meta/0015_snapshot.json`, `packages/db/src/schema/moderation.ts`, `apps/api/src/media/flows/serve.ts`, `apps/api/src/media/flows/status.ts`, `apps/api/src/media/repo.ts`, `apps/api/src/social/visibility.ts`, `packages/contracts/src/index.ts`, `packages/contracts/src/media.ts`, `packages/contracts/src/staff.ts`, `packages/db/migrations/meta/_journal.json`, `packages/db/src/schema/auth.ts`, `packages/db/src/schema/content.ts`, `packages/db/src/schema/helpers.ts`, `packages/db/src/schema/identity.ts`, `packages/db/src/schema/index.ts`, `packages/db/src/schema/safety.ts`, `scripts/clean-dev-fixtures.mjs`, `scripts/test-db.mjs`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm test`, expecting `Tests  `**
- [ ] **Step 6: generate: run `pnpm --filter @korbat/db generate`, expecting `No schema changes`**
- [ ] **Step 7: apply-migrations: run the `apply-migrations` command in the prompt, expecting `migrations applied`, `count=16`**
- [ ] **Step 8: test-db-usage: run `node scripts/test-db.mjs --fresh --upgrade-from 13 2>&1; echo usage-exit=$?`, expecting `Usage: node scripts/test-db.mjs [--fresh | --upgrade-from <n>] [-- <docker compose command>]`**
- [ ] **Step 9: test-database-fresh: run `node scripts/test-db.mjs --fresh -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `test database ready: korbat_test`**
- [ ] **Step 10: integration-fresh: run the `integration-fresh` command in the prompt, expecting `Tests  `**
- [ ] **Step 11: test-database-upgrade: run `node scripts/test-db.mjs --upgrade-from 13 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `migrations up to 0013_forget_revoked_staff_keys applied and committed`, `later migrations applied as one batch`, `test database ready: korbat_test`**
- [ ] **Step 12: integration-upgraded: run the `integration-upgraded` command in the prompt, expecting `Tests  `**
- [ ] **Step 13: timing: run the `timing` command in the prompt, expecting `timing-ok=1`**
- [ ] **Step 14: api-bundle: run `pnpm --filter @korbat/api build 2>&1 | tail -2 && node --check apps/api/dist/index.js && echo bundle-ok`, expecting `Build success`, `bundle-ok`**
- [ ] **Step 15: Commit: `feat(db,contracts,api): the ground for moderation cases: migration 0014 drops the tables nothing wrote (reports, cases, appeals, strikes, transparency_log), their enums and profiles.reputation; 0015 creates the moderation tables (cases with one open case a target, intakes and their items, decisions and their ledger of measures, seal_posts, evidence snapshots, staff texts, the access log, the limits row, image holds and four auth tables) with their grants and forced columns, intake_items_attach, intake_items_quote, the view measures_in_force and the freeze: frozen_for and post_frozen (an unanswered suspect item in a post's case or in its author's account's case, or a seal in force), post_media_keep, which keeps a held or frozen image row against every delete, raises in a cascade and outside READ COMMITTED, and post_media_guard, which keeps an image on its post and its owner the post's author; korbat_api can no longer delete a post or a profile; the contracts gain the canonical writer's own module and the moderation constants and digests; serve, forPosts, readyImages, find and status give only images whose own state is visible, and postAccess is exhaustive; test-db.mjs gains --fresh and --upgrade-from; the development cleaner deletes a doomed account's cases before its profile`**

### Task 2: The decision engine: migration 0016 (the decision triggers, the one writer of moderation state, the posts' guard, the release of outcomes, the confirmed audit row and the check that holds a decision to it), the lock bounds, the moderation module's skeleton with the intake's transaction and the decision, the two rulebooks and the redress texts, socialForModeration, the step-up actions, the decision route, and the fixture that decides for tests

**Prompt:** `docs/superpowers/prompts/moderation-cases-3c/02-decision-engine.md`

**Files:**
- Create: `apps/api/src/lib/lock-bounds.ts`
- Create: `apps/api/src/moderation/context.ts`
- Create: `apps/api/src/moderation/decide.ts`
- Create: `apps/api/src/moderation/index.ts`
- Create: `apps/api/src/moderation/intake.ts`
- Create: `apps/api/src/moderation/repo.ts`
- Create: `apps/api/src/staff/cases.ts`
- Create: `apps/api/test/integration/http-staff-decisions.test.ts`
- Create: `apps/api/test/integration/moderation-apply.test.ts`
- Create: `apps/api/test/integration/moderation-decide.ts`
- Create: `apps/api/test/integration/moderation-decisions.test.ts`
- Create: `apps/api/test/integration/moderation-intake.test.ts`
- Create: `apps/api/test/integration/moderation-races.test.ts`
- Create: `apps/api/test/integration/moderation-release.test.ts`
- Create: `apps/api/test/integration/moderation-seal.test.ts`
- Create: `apps/api/test/lab/README.md`
- Create: `apps/api/test/lab/contention.lab.ts`
- Create: `apps/api/test/lock-bounds.test.ts`
- Create: `apps/api/test/moderation-context.test.ts`
- Create: `apps/api/test/moderation-intake-order.test.ts`
- Create: `apps/api/test/moderation-retry.test.ts`
- Create: `apps/api/vitest.lab.config.ts`
- Create: `packages/db/migrations/0016_decisions_and_ledger.sql`
- Create: `packages/db/migrations/meta/0016_snapshot.json`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/auth/repo.ts`
- Modify: `apps/api/src/cli/lock-timeout.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/social/index.ts`
- Modify: `apps/api/src/social/repo.ts`
- Modify: `apps/api/src/staff/index.ts`
- Modify: `apps/api/src/staff/routes.ts`
- Modify: `apps/api/test/architecture.test.ts`
- Modify: `apps/api/test/integration/audit-verify.test.ts`
- Modify: `apps/api/test/integration/http-explore.test.ts`
- Modify: `apps/api/test/integration/http-media.test.ts`
- Modify: `apps/api/test/integration/http-staff-enroll.test.ts`
- Modify: `apps/api/test/integration/http-staff-sessions.test.ts`
- Modify: `apps/api/test/integration/media-harness.ts`
- Modify: `apps/api/test/integration/media-sealed.test.ts`
- Modify: `apps/api/test/integration/media-serve.test.ts`
- Modify: `apps/api/test/integration/moderation-attach.test.ts`
- Modify: `apps/api/test/integration/moderation-fixtures.ts`
- Modify: `apps/api/test/integration/moderation-schema.test.ts`
- Modify: `apps/api/test/integration/social-explore-ranking.test.ts`
- Modify: `apps/api/test/integration/social-explore-reads.test.ts`
- Modify: `apps/api/test/integration/social-flows-posts.test.ts`
- Modify: `apps/api/test/integration/social-repo.test.ts`
- Modify: `apps/api/test/staff/app-mount.test.ts`
- Modify: `apps/api/test/staff/chain-vectors.ts`
- Modify: `apps/api/test/staff/route-table.test.ts`
- Modify: `packages/contracts/src/moderation.ts`
- Modify: `packages/contracts/src/staff.ts`
- Modify: `packages/contracts/test/moderation.test.ts`
- Modify: `packages/contracts/test/staff.test.ts`
- Modify: `packages/db/migrations/meta/_journal.json`
- Modify: `packages/rules/src/index.ts`
- Modify: `packages/rules/test/rules.test.ts`

- [ ] **Step 1: Write the failing tests: `apps/api/test/integration/http-staff-decisions.test.ts`, `apps/api/test/integration/moderation-apply.test.ts`, `apps/api/test/integration/moderation-decide.ts`, `apps/api/test/integration/moderation-decisions.test.ts`, `apps/api/test/integration/moderation-intake.test.ts`, `apps/api/test/integration/moderation-races.test.ts`, `apps/api/test/integration/moderation-release.test.ts`, `apps/api/test/integration/moderation-seal.test.ts`, `apps/api/test/lab/README.md`, `apps/api/test/lab/contention.lab.ts`, `apps/api/test/lock-bounds.test.ts`, `apps/api/test/moderation-context.test.ts`, `apps/api/test/moderation-intake-order.test.ts`, `apps/api/test/moderation-retry.test.ts`, `apps/api/vitest.lab.config.ts`, `apps/api/test/architecture.test.ts`, `apps/api/test/integration/audit-verify.test.ts`, `apps/api/test/integration/http-explore.test.ts`, `apps/api/test/integration/http-media.test.ts`, `apps/api/test/integration/http-staff-enroll.test.ts`, `apps/api/test/integration/http-staff-sessions.test.ts`, `apps/api/test/integration/media-harness.ts`, `apps/api/test/integration/media-sealed.test.ts`, `apps/api/test/integration/media-serve.test.ts`, `apps/api/test/integration/moderation-attach.test.ts`, `apps/api/test/integration/moderation-fixtures.ts`, `apps/api/test/integration/moderation-schema.test.ts`, `apps/api/test/integration/social-explore-ranking.test.ts`, `apps/api/test/integration/social-explore-reads.test.ts`, `apps/api/test/integration/social-flows-posts.test.ts`, `apps/api/test/integration/social-repo.test.ts`, `apps/api/test/staff/app-mount.test.ts`, `apps/api/test/staff/chain-vectors.ts`, `apps/api/test/staff/route-table.test.ts`, `packages/contracts/test/moderation.test.ts`, `packages/contracts/test/staff.test.ts`, `packages/rules/test/rules.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/api/src/lib/lock-bounds.ts`, `apps/api/src/moderation/context.ts`, `apps/api/src/moderation/decide.ts`, `apps/api/src/moderation/index.ts`, `apps/api/src/moderation/intake.ts`, `apps/api/src/moderation/repo.ts`, `apps/api/src/staff/cases.ts`, `packages/db/migrations/0016_decisions_and_ledger.sql`, `packages/db/migrations/meta/0016_snapshot.json`, `apps/api/src/app.ts`, `apps/api/src/auth/repo.ts`, `apps/api/src/cli/lock-timeout.ts`, `apps/api/src/index.ts`, `apps/api/src/social/index.ts`, `apps/api/src/social/repo.ts`, `apps/api/src/staff/index.ts`, `apps/api/src/staff/routes.ts`, `packages/contracts/src/moderation.ts`, `packages/contracts/src/staff.ts`, `packages/db/migrations/meta/_journal.json`, `packages/rules/src/index.ts`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm test`, expecting `Tests  `**
- [ ] **Step 6: generate: run `pnpm --filter @korbat/db generate`, expecting `No schema changes`**
- [ ] **Step 7: apply-migrations: run the `apply-migrations` command in the prompt, expecting `migrations applied`, `count=17`**
- [ ] **Step 8: test-database-fresh: run `node scripts/test-db.mjs --fresh -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `test database ready: korbat_test`**
- [ ] **Step 9: integration-fresh: run the `integration-fresh` command in the prompt, expecting `Tests  `**
- [ ] **Step 10: test-database-upgrade: run `node scripts/test-db.mjs --upgrade-from 13 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `migrations up to 0013_forget_revoked_staff_keys applied and committed`, `later migrations applied as one batch`, `test database ready: korbat_test`**
- [ ] **Step 11: integration-upgraded: run the `integration-upgraded` command in the prompt, expecting `Tests  `**
- [ ] **Step 12: timing: run the `timing` command in the prompt, expecting `timing-ok=1`**
- [ ] **Step 13: api-bundle: run the `api-bundle` command in the prompt, expecting `Build success`, `bundle-ok`**
- [ ] **Step 14: Commit: `feat(db,api,contracts,rules): the decision engine: migration 0016 records a decision as the statement of reasons (decisions_record forces its source, range, suspect, unseen and needs_admin; an admin's answer covers every unanswered suspect item of its case), checks and applies its measures (decision_actions_check and decision_actions_apply: a seal lists the posts whose image rows it locked in seal_posts and locks no post), derives every post's level and every image's state from the measures in force through the one writer moderation_apply, ends a seal taken while deciding where the answer ends it, guards posts' moderation columns, releases outcomes, and holds each decision and each of its ledger rows to the audit row a staff key confirmed, also when a caller runs the deferred check early; apps/api/src/lib/lock-bounds.ts bounds lock waits by a challenge's life for the auth repository, the command line and the decision; the moderation module records an intake in two passes (cases and items in target order, then the copies; the item korbat adds for a quoted post; retried on 40001, 40P01 and 55P03) and decides behind the staff gate and the step-up (POST /api/staff/cases/:case/decisions, 201 with the decision's id); packages/rules gains the rulebooks of versions 1 and 2 and the redress texts; socialForModeration reads posts, profiles and handles for cases, an old handle included; the tests that set a post's state decide through decideForTest; a contention lab measures seals, the purge and decisions against other transactions`**

### Task 3: Holds and images: MediaForCases (the intake's lock and holds, what a case reaches, the one function that serves staff an image, the disposal of images nothing retains), the deleters in id order, the image readers that follow an image's own state, and the placeholder for hidden and sealed images in the views, the contracts and the app

**Prompt:** `docs/superpowers/prompts/moderation-cases-3c/03-holds-images.md`

**Files:**
- Create: `apps/api/src/media/cases.ts`
- Create: `apps/api/src/media/webp.ts`
- Create: `apps/api/test/integration/media-cases.test.ts`
- Create: `apps/api/test/integration/media-gates.test.ts`
- Create: `apps/api/test/lab/hold.lab.ts`
- Create: `apps/api/test/media/webp-bytes.ts`
- Create: `apps/api/test/media/webp.test.ts`
- Create: `apps/app/src/components/social/HiddenImage.tsx`
- Create: `apps/app/test/hidden-media.test.tsx`
- Modify: `apps/api/src/account/flows/export.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/media/context.ts`
- Modify: `apps/api/src/media/flows/serve.ts`
- Modify: `apps/api/src/media/index.ts`
- Modify: `apps/api/src/media/repo.ts`
- Modify: `apps/api/src/moderation/context.ts`
- Modify: `apps/api/src/moderation/index.ts`
- Modify: `apps/api/src/moderation/intake.ts`
- Modify: `apps/api/src/social/flows/export.ts`
- Modify: `apps/api/src/social/flows/posts.ts`
- Modify: `apps/api/src/social/index.ts`
- Modify: `apps/api/src/social/repo.ts`
- Modify: `apps/api/src/social/views.ts`
- Modify: `apps/api/test/architecture.test.ts`
- Modify: `apps/api/test/integration/http-media.test.ts`
- Modify: `apps/api/test/integration/http-staff-decisions.test.ts`
- Modify: `apps/api/test/integration/http-staff-enroll.test.ts`
- Modify: `apps/api/test/integration/http-staff-sessions.test.ts`
- Modify: `apps/api/test/integration/media-sealed.test.ts`
- Modify: `apps/api/test/integration/moderation-decide.ts`
- Modify: `apps/api/test/integration/moderation-fixtures.ts`
- Modify: `apps/api/test/integration/moderation-seal.test.ts`
- Modify: `apps/api/test/lab/README.md`
- Modify: `apps/api/test/lab/contention.lab.ts`
- Modify: `apps/api/test/moderation-intake-order.test.ts`
- Modify: `apps/api/test/staff/app-mount.test.ts`
- Modify: `apps/api/test/staff/route-table.test.ts`
- Modify: `apps/app/src/components/PopularNow.tsx`
- Modify: `apps/app/src/components/social/MediaGrid.tsx`
- Modify: `apps/app/src/components/social/MediaViewer.tsx`
- Modify: `packages/contracts/src/media.ts`
- Modify: `packages/contracts/src/social.ts`
- Modify: `packages/contracts/test/media.test.ts`

- [ ] **Step 1: Write the failing tests: `apps/api/test/integration/media-cases.test.ts`, `apps/api/test/integration/media-gates.test.ts`, `apps/api/test/lab/hold.lab.ts`, `apps/api/test/media/webp-bytes.ts`, `apps/api/test/media/webp.test.ts`, `apps/app/test/hidden-media.test.tsx`, `apps/api/test/architecture.test.ts`, `apps/api/test/integration/http-media.test.ts`, `apps/api/test/integration/http-staff-decisions.test.ts`, `apps/api/test/integration/http-staff-enroll.test.ts`, `apps/api/test/integration/http-staff-sessions.test.ts`, `apps/api/test/integration/media-sealed.test.ts`, `apps/api/test/integration/moderation-decide.ts`, `apps/api/test/integration/moderation-fixtures.ts`, `apps/api/test/integration/moderation-seal.test.ts`, `apps/api/test/lab/README.md`, `apps/api/test/lab/contention.lab.ts`, `apps/api/test/moderation-intake-order.test.ts`, `apps/api/test/staff/app-mount.test.ts`, `apps/api/test/staff/route-table.test.ts`, `packages/contracts/test/media.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/api/src/media/cases.ts`, `apps/api/src/media/webp.ts`, `apps/app/src/components/social/HiddenImage.tsx`, `apps/api/src/account/flows/export.ts`, `apps/api/src/index.ts`, `apps/api/src/media/context.ts`, `apps/api/src/media/flows/serve.ts`, `apps/api/src/media/index.ts`, `apps/api/src/media/repo.ts`, `apps/api/src/moderation/context.ts`, `apps/api/src/moderation/index.ts`, `apps/api/src/moderation/intake.ts`, `apps/api/src/social/flows/export.ts`, `apps/api/src/social/flows/posts.ts`, `apps/api/src/social/index.ts`, `apps/api/src/social/repo.ts`, `apps/api/src/social/views.ts`, `apps/app/src/components/PopularNow.tsx`, `apps/app/src/components/social/MediaGrid.tsx`, `apps/app/src/components/social/MediaViewer.tsx`, `packages/contracts/src/media.ts`, `packages/contracts/src/social.ts`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm test`, expecting `Tests  `**
- [ ] **Step 6: generate: run `pnpm --filter @korbat/db generate`, expecting `No schema changes`**
- [ ] **Step 7: apply-migrations: run the `apply-migrations` command in the prompt, expecting `migrations applied`, `count=17`**
- [ ] **Step 8: test-database-fresh: run `node scripts/test-db.mjs --fresh -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `test database ready: korbat_test`**
- [ ] **Step 9: integration-fresh: run the `integration-fresh` command in the prompt, expecting `Tests  `**
- [ ] **Step 10: test-database-upgrade: run `node scripts/test-db.mjs --upgrade-from 13 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `migrations up to 0013_forget_revoked_staff_keys applied and committed`, `later migrations applied as one batch`, `test database ready: korbat_test`**
- [ ] **Step 11: integration-upgraded: run the `integration-upgraded` command in the prompt, expecting `Tests  `**
- [ ] **Step 12: timing: run the `timing` command in the prompt, expecting `timing-ok=1`**
- [ ] **Step 13: api-bundle: run the `api-bundle` command in the prompt, expecting `Build success`, `bundle-ok`**
- [ ] **Step 14: export: run `(cd apps/app && EXPO_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA npx expo export --platform web 2>&1 | tail -8)`, expecting `Exported`**
- [ ] **Step 15: Commit: `feat(api,app,contracts): holds and images: MediaForCases.hold locks every image row an intake reaches in one id order (FOR KEY SHARE; a post's rows also get its case's hold, an account's are only locked, since the freeze keeps them) and the intake's snapshots list what it returned; reach counts a case's posts, images, sealed and served ones; staffImage is the one function that opens an image for staff and refuses a frozen post's, a sealed and an erased one; dropDisposable deletes at most a batch of the images nothing retains, its candidates chosen by their marks before the freeze is read; detachAll and purgeOwner delete in id order with no filter and the keep trigger decides; purgeProfile takes its posts' row locks first, in id order, and deletes images as its last act; serve, forPosts, readyImages and the export's open follow an image's own state: a withheld or removed image goes to its author only, a sealed one to nobody, and others get the placeholder HiddenMedia; the app draws it ("Image hidden by korbat moderation", or "Sealed: not shown to anyone, you included" for the author) in the grid, the viewer and a quote's row, never loads a hidden image, and Popular now skips it`**

### Task 4: Reports and notices: the notice routes with their links, liveness, limits and human check, the notifier's encrypted contact in the auth module, the mailer's refusals and time limits, the notifier key in the configuration and the compose file, the janitor's two purges, the receipt and the urgent alert

**Prompt:** `docs/superpowers/prompts/moderation-cases-3c/04-reports-notices.md`

**Files:**
- Create: `apps/api/src/auth/flows/notifiers.ts`
- Create: `apps/api/src/moderation/alerts.ts`
- Create: `apps/api/src/moderation/links.ts`
- Create: `apps/api/src/moderation/routes.ts`
- Create: `apps/api/test/integration/auth-notifiers.test.ts`
- Create: `apps/api/test/integration/http-notices.test.ts`
- Create: `apps/api/test/integration/moderation-notices.test.ts`
- Create: `apps/api/test/integration/notices-harness.ts`
- Create: `apps/api/test/moderation-alerts.test.ts`
- Create: `apps/api/test/moderation-links.test.ts`
- Create: `apps/api/test/moderation-notice-limits.test.ts`
- Create: `packages/contracts/test/notices.test.ts`
- Modify: `apps/api/.env.example`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/auth/client-ip.ts`
- Modify: `apps/api/src/auth/context.ts`
- Modify: `apps/api/src/auth/identifiers.ts`
- Modify: `apps/api/src/auth/index.ts`
- Modify: `apps/api/src/auth/janitor.ts`
- Modify: `apps/api/src/auth/repo.ts`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/env.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/mail/mailer.ts`
- Modify: `apps/api/src/mail/smtp.ts`
- Modify: `apps/api/src/mail/templates.ts`
- Modify: `apps/api/src/moderation/context.ts`
- Modify: `apps/api/src/moderation/index.ts`
- Modify: `apps/api/src/moderation/intake.ts`
- Modify: `apps/api/src/moderation/repo.ts`
- Modify: `apps/api/test/app.test.ts`
- Modify: `apps/api/test/architecture.test.ts`
- Modify: `apps/api/test/auth/flow-harness.ts`
- Modify: `apps/api/test/auth/identifiers.test.ts`
- Modify: `apps/api/test/auth/verify-config.test.ts`
- Modify: `apps/api/test/config.test.ts`
- Modify: `apps/api/test/integration/auth-janitor.test.ts`
- Modify: `apps/api/test/integration/flow-harness.ts`
- Modify: `apps/api/test/integration/http-staff-decisions.test.ts`
- Modify: `apps/api/test/integration/http-staff-enroll.test.ts`
- Modify: `apps/api/test/integration/http-staff-sessions.test.ts`
- Modify: `apps/api/test/integration/moderation-decide.ts`
- Modify: `apps/api/test/integration/moderation-fixtures.ts`
- Modify: `apps/api/test/mail/smtp.test.ts`
- Modify: `apps/api/test/mail/templates.test.ts`
- Modify: `apps/api/test/middleware.test.ts`
- Modify: `apps/api/test/moderation-context.test.ts`
- Modify: `apps/api/test/staff/app-mount.test.ts`
- Modify: `apps/api/test/staff/route-table.test.ts`
- Modify: `infra/.env.example`
- Modify: `infra/compose.yml`
- Modify: `packages/contracts/src/moderation.ts`
- Modify: `packages/contracts/test/moderation.test.ts`

- [ ] **Step 1: Write the failing tests: `apps/api/test/integration/auth-notifiers.test.ts`, `apps/api/test/integration/http-notices.test.ts`, `apps/api/test/integration/moderation-notices.test.ts`, `apps/api/test/integration/notices-harness.ts`, `apps/api/test/moderation-alerts.test.ts`, `apps/api/test/moderation-links.test.ts`, `apps/api/test/moderation-notice-limits.test.ts`, `packages/contracts/test/notices.test.ts`, `apps/api/test/app.test.ts`, `apps/api/test/architecture.test.ts`, `apps/api/test/auth/flow-harness.ts`, `apps/api/test/auth/identifiers.test.ts`, `apps/api/test/auth/verify-config.test.ts`, `apps/api/test/config.test.ts`, `apps/api/test/integration/auth-janitor.test.ts`, `apps/api/test/integration/flow-harness.ts`, `apps/api/test/integration/http-staff-decisions.test.ts`, `apps/api/test/integration/http-staff-enroll.test.ts`, `apps/api/test/integration/http-staff-sessions.test.ts`, `apps/api/test/integration/moderation-decide.ts`, `apps/api/test/integration/moderation-fixtures.ts`, `apps/api/test/mail/smtp.test.ts`, `apps/api/test/mail/templates.test.ts`, `apps/api/test/middleware.test.ts`, `apps/api/test/moderation-context.test.ts`, `apps/api/test/staff/app-mount.test.ts`, `apps/api/test/staff/route-table.test.ts`, `packages/contracts/test/moderation.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/api/src/auth/flows/notifiers.ts`, `apps/api/src/moderation/alerts.ts`, `apps/api/src/moderation/links.ts`, `apps/api/src/moderation/routes.ts`, `apps/api/.env.example`, `apps/api/src/app.ts`, `apps/api/src/auth/client-ip.ts`, `apps/api/src/auth/context.ts`, `apps/api/src/auth/identifiers.ts`, `apps/api/src/auth/index.ts`, `apps/api/src/auth/janitor.ts`, `apps/api/src/auth/repo.ts`, `apps/api/src/config.ts`, `apps/api/src/env.ts`, `apps/api/src/index.ts`, `apps/api/src/mail/mailer.ts`, `apps/api/src/mail/smtp.ts`, `apps/api/src/mail/templates.ts`, `apps/api/src/moderation/context.ts`, `apps/api/src/moderation/index.ts`, `apps/api/src/moderation/intake.ts`, `apps/api/src/moderation/repo.ts`, `infra/.env.example`, `infra/compose.yml`, `packages/contracts/src/moderation.ts`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm test`, expecting `Tests  `**
- [ ] **Step 6: generate: run `pnpm --filter @korbat/db generate`, expecting `No schema changes`**
- [ ] **Step 7: apply-migrations: run the `apply-migrations` command in the prompt, expecting `migrations applied`, `count=17`**
- [ ] **Step 8: compose-config: run `docker compose --env-file infra/.env.example -f infra/compose.yml config -q && echo config-ok`, expecting `config-ok`**
- [ ] **Step 9: test-database-fresh: run `node scripts/test-db.mjs --fresh -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `test database ready: korbat_test`**
- [ ] **Step 10: integration-fresh: run the `integration-fresh` command in the prompt, expecting `Tests  `**
- [ ] **Step 11: test-database-upgrade: run `node scripts/test-db.mjs --upgrade-from 13 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `migrations up to 0013_forget_revoked_staff_keys applied and committed`, `later migrations applied as one batch`, `test database ready: korbat_test`**
- [ ] **Step 12: integration-upgraded: run the `integration-upgraded` command in the prompt, expecting `Tests  `**
- [ ] **Step 13: timing: run the `timing` command in the prompt, expecting `timing-ok=1`**
- [ ] **Step 14: api-bundle: run the `api-bundle` command in the prompt, expecting `Build success`, `bundle-ok`**
- [ ] **Step 15: Commit: `feat(api,infra): reports and notices: POST /api/notices takes a report on a rule or a notice of illegality from anyone, signed in or not (a human check and limits by network when signed out), about up to ten posts or profiles of this korbat; a target is live by one rule, and on the path for child sexual abuse material by its row alone, an account also under a handle it has left; such a notice names at most one account, counted by the handles as named; a link that names nothing is stored as an item with no case; the status page (POST /api/notices/status) answers by reference and token with each item's link as it was named, never a later handle, and /api/notices/contact confirms or stops the notifier's mail; a signed-out notifier's name and address are kept encrypted in the auth schema under NOTIFIER_ENC_KEY and never shown to staff; the receipt notice_received and the urgent alert moderation_urgent are sent after the commit; the mailer tells a refused recipient from an unavailable relay and bounds each send in time; the auth janitor purges forgotten contacts and expired confirmations, each purge in a try of its own; MODERATION_DISPATCH_HOUR and MODERATION_DEFER_UNPROVEN join the configuration`**

### Task 5: The console's queue, case, evidence and reveals: the staff routes for the overview, the queue, a case with its suspicion, images behind gate V, snapshots, findings, texts and the reveal of a source, the access log and the daily limits; and in the console the router, the home, queue and case screens without the composer, the banners, the reveal dialog and their browser check

**Prompt:** `docs/superpowers/prompts/moderation-cases-3c/05-console-queue-case.md`

**Files:**
- Create: `apps/admin/src/frames.tsx`
- Create: `apps/admin/src/hidden.ts`
- Create: `apps/admin/src/media.tsx`
- Create: `apps/admin/src/screens/Case.tsx`
- Create: `apps/admin/src/screens/Queue.tsx`
- Create: `apps/admin/src/texts.ts`
- Create: `apps/admin/src/words.ts`
- Create: `apps/admin/test/case-fixtures.ts`
- Create: `apps/admin/test/cases.test.tsx`
- Create: `apps/api/src/moderation/cases.ts`
- Create: `apps/api/src/moderation/overlap.ts`
- Create: `apps/api/src/moderation/reveal.ts`
- Create: `apps/api/src/moderation/texts.ts`
- Create: `apps/api/test/integration/http-staff-cases.test.ts`
- Create: `apps/api/test/integration/moderation-cases.test.ts`
- Create: `apps/api/test/integration/moderation-reveal.test.ts`
- Create: `apps/api/test/moderation-overlap.test.ts`
- Create: `apps/api/test/moderation-summary.test.ts`
- Create: `packages/contracts/test/staff-cases.test.ts`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/Layout.tsx`
- Modify: `apps/admin/src/api.ts`
- Modify: `apps/admin/src/app.css`
- Modify: `apps/admin/src/messages.ts`
- Modify: `apps/admin/src/nav.tsx`
- Modify: `apps/admin/src/router.ts`
- Modify: `apps/admin/src/screens/Home.tsx`
- Modify: `apps/admin/src/step-up.ts`
- Modify: `apps/admin/src/store.ts`
- Modify: `apps/admin/test/browser/console.browser.ts`
- Modify: `apps/admin/test/browser/fixture-api.ts`
- Modify: `apps/admin/test/browser/watch.ts`
- Modify: `apps/admin/test/fixture-statuses.test.ts`
- Modify: `apps/admin/test/fixtures.ts`
- Modify: `apps/admin/test/router.test.ts`
- Modify: `apps/admin/test/screens.test.tsx`
- Modify: `apps/admin/test/source.test.ts`
- Modify: `apps/api/src/auth/flows/notifiers.ts`
- Modify: `apps/api/src/mail/mailer.ts`
- Modify: `apps/api/src/mail/templates.ts`
- Modify: `apps/api/src/moderation/context.ts`
- Modify: `apps/api/src/moderation/index.ts`
- Modify: `apps/api/src/moderation/intake.ts`
- Modify: `apps/api/src/moderation/repo.ts`
- Modify: `apps/api/src/staff/cases.ts`
- Modify: `apps/api/src/staff/routes.ts`
- Modify: `apps/api/test/mail/templates.test.ts`
- Modify: `apps/api/test/moderation-context.test.ts`
- Modify: `apps/api/test/staff/route-table.test.ts`
- Modify: `packages/contracts/src/moderation.ts`
- Modify: `packages/contracts/src/staff.ts`
- Modify: `packages/contracts/test/moderation.test.ts`

- [ ] **Step 1: Write the failing tests: `apps/admin/test/case-fixtures.ts`, `apps/admin/test/cases.test.tsx`, `apps/api/test/integration/http-staff-cases.test.ts`, `apps/api/test/integration/moderation-cases.test.ts`, `apps/api/test/integration/moderation-reveal.test.ts`, `apps/api/test/moderation-overlap.test.ts`, `apps/api/test/moderation-summary.test.ts`, `packages/contracts/test/staff-cases.test.ts`, `apps/admin/test/browser/console.browser.ts`, `apps/admin/test/browser/fixture-api.ts`, `apps/admin/test/browser/watch.ts`, `apps/admin/test/fixture-statuses.test.ts`, `apps/admin/test/fixtures.ts`, `apps/admin/test/router.test.ts`, `apps/admin/test/screens.test.tsx`, `apps/admin/test/source.test.ts`, `apps/api/test/mail/templates.test.ts`, `apps/api/test/moderation-context.test.ts`, `apps/api/test/staff/route-table.test.ts`, `packages/contracts/test/moderation.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/admin/src/frames.tsx`, `apps/admin/src/hidden.ts`, `apps/admin/src/media.tsx`, `apps/admin/src/screens/Case.tsx`, `apps/admin/src/screens/Queue.tsx`, `apps/admin/src/texts.ts`, `apps/admin/src/words.ts`, `apps/api/src/moderation/cases.ts`, `apps/api/src/moderation/overlap.ts`, `apps/api/src/moderation/reveal.ts`, `apps/api/src/moderation/texts.ts`, `apps/admin/src/App.tsx`, `apps/admin/src/Layout.tsx`, `apps/admin/src/api.ts`, `apps/admin/src/app.css`, `apps/admin/src/messages.ts`, `apps/admin/src/nav.tsx`, `apps/admin/src/router.ts`, `apps/admin/src/screens/Home.tsx`, `apps/admin/src/step-up.ts`, `apps/admin/src/store.ts`, `apps/api/src/auth/flows/notifiers.ts`, `apps/api/src/mail/mailer.ts`, `apps/api/src/mail/templates.ts`, `apps/api/src/moderation/context.ts`, `apps/api/src/moderation/index.ts`, `apps/api/src/moderation/intake.ts`, `apps/api/src/moderation/repo.ts`, `apps/api/src/staff/cases.ts`, `apps/api/src/staff/routes.ts`, `packages/contracts/src/moderation.ts`, `packages/contracts/src/staff.ts`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm test`, expecting `Tests  `**
- [ ] **Step 6: generate: run `pnpm --filter @korbat/db generate`, expecting `No schema changes`**
- [ ] **Step 7: apply-migrations: run the `apply-migrations` command in the prompt, expecting `migrations applied`, `count=17`**
- [ ] **Step 8: admin-build: run `pnpm --filter @korbat/admin build 2>&1 | tail -2 && ls apps/admin/dist apps/admin/dist/assets | sed -E 's/-[A-Z0-9]{8}[.]/-HASH./'`, expecting `Build success`, `index.html`, `favicon.svg`, `main-HASH.js`, `main-HASH.css`**
- [ ] **Step 9: admin-browser: run `pnpm --filter @korbat/admin test:browser`, expecting `Tests  22 passed (22)`**
- [ ] **Step 10: test-database-fresh: run `node scripts/test-db.mjs --fresh -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `test database ready: korbat_test`**
- [ ] **Step 11: integration-fresh: run the `integration-fresh` command in the prompt, expecting `Tests  `**
- [ ] **Step 12: test-database-upgrade: run `node scripts/test-db.mjs --upgrade-from 13 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `migrations up to 0013_forget_revoked_staff_keys applied and committed`, `later migrations applied as one batch`, `test database ready: korbat_test`**
- [ ] **Step 13: integration-upgraded: run the `integration-upgraded` command in the prompt, expecting `Tests  `**
- [ ] **Step 14: timing: run the `timing` command in the prompt, expecting `timing-ok=1`**
- [ ] **Step 15: api-bundle: run the `api-bundle` command in the prompt, expecting `Build success`, `bundle-ok`**
- [ ] **Step 16: Commit: `feat(api,admin): the console's queue, case, evidence and reveals: GET /api/staff/overview, /queue and /cases/:case answer behind the staff gate, each case read written to the access log and counted against the daily limit of distinct cases; the case answer carries its items with their source summaries, its snapshots (withheld where erased), its notes and recorded choices not to seal, and for a case with a report or finding of child sexual abuse material its suspicion: whether an item is unanswered, what the case reaches in counts, the earlier answers without a seal about the target and its author, and the day staff last opened the post's images; /cases/:case/media/:media/:size serves an image only through MediaForCases.staffImage, never a sealed or erased one or one of a frozen post, on any case; POST /api/staff/findings opens a moderator's own finding under the daily findings limit, a finding citing R2 also for an account under a handle it has left; the texts routes save drafts, notes and a recorded choice not to seal; POST /api/staff/items/:item/reveal shows a signed-in reporter's handle behind the step-up, with its reason, its daily limit and a mail to every staff account; every case route and the reveal refuse a staff account that is a party; the console gains its router, CaseLink, StaffImage, the home, queue and case screens with the Art. 18 banner and the banner of a case with an unanswered suspect item, the Own finding control and the reveal dialog, and its browser check runs them`**

### Task 6: Deciding in the console, statements and the dispatch: the statement's paragraphs in packages/rules, the decision composer with its preview, the seal's controls and the Lift and Correct controls, what follows a decision's commit, the staff mails and the home screen's lists, and the dispatch job with its receipts, statements, daily release, updates, urgent repeat and queue-age alert

**Prompt:** `docs/superpowers/prompts/moderation-cases-3c/06-deciding-dispatch.md`

**Files:**
- Create: `apps/admin/src/compose.ts`
- Create: `apps/admin/src/screens/Composer.tsx`
- Create: `apps/admin/test/composer-drafts.test.tsx`
- Create: `apps/admin/test/composer.test.tsx`
- Create: `apps/admin/test/workspace.test.ts`
- Create: `apps/api/src/moderation/dispatch.ts`
- Create: `apps/api/src/moderation/statement.ts`
- Create: `apps/api/test/integration/moderation-dispatch.test.ts`
- Create: `apps/api/test/integration/moderation-path.test.ts`
- Create: `apps/api/test/integration/moderation-statement.test.ts`
- Create: `apps/api/test/mail/moderation-templates.test.ts`
- Create: `apps/api/test/moderation-dispatch.test.ts`
- Create: `packages/contracts/test/outcomes.test.ts`
- Create: `packages/rules/src/statement.ts`
- Create: `packages/rules/test/statement.test.ts`
- Modify: `apps/admin/package.json`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/api.ts`
- Modify: `apps/admin/src/app.css`
- Modify: `apps/admin/src/messages.ts`
- Modify: `apps/admin/src/screens/Case.tsx`
- Modify: `apps/admin/src/screens/Home.tsx`
- Modify: `apps/admin/src/screens/Queue.tsx`
- Modify: `apps/admin/src/step-up.ts`
- Modify: `apps/admin/src/store.ts`
- Modify: `apps/admin/src/texts.ts`
- Modify: `apps/admin/test/browser/console.browser.ts`
- Modify: `apps/admin/test/browser/fixture-api.ts`
- Modify: `apps/admin/test/browser/watch.ts`
- Modify: `apps/admin/test/case-fixtures.ts`
- Modify: `apps/admin/test/cases.test.tsx`
- Modify: `apps/admin/test/screens.test.tsx`
- Modify: `apps/admin/test/source.test.ts`
- Modify: `apps/admin/test/store.test.ts`
- Modify: `apps/api/src/auth/flows/notifiers.ts`
- Modify: `apps/api/src/auth/flows/notify.ts`
- Modify: `apps/api/src/auth/index.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/mail/mailer.ts`
- Modify: `apps/api/src/mail/memory.ts`
- Modify: `apps/api/src/mail/smtp.ts`
- Modify: `apps/api/src/mail/templates.ts`
- Modify: `apps/api/src/moderation/cases.ts`
- Modify: `apps/api/src/moderation/decide.ts`
- Modify: `apps/api/src/moderation/index.ts`
- Modify: `apps/api/src/moderation/intake.ts`
- Modify: `apps/api/src/moderation/repo.ts`
- Modify: `apps/api/src/staff/cases.ts`
- Modify: `apps/api/test/integration/auth-notifiers.test.ts`
- Modify: `apps/api/test/integration/http-staff-decisions.test.ts`
- Modify: `apps/api/test/integration/moderation-decide.ts`
- Modify: `apps/api/test/integration/moderation-fixtures.ts`
- Modify: `apps/api/test/integration/moderation-races.test.ts`
- Modify: `apps/api/test/integration/notices-harness.ts`
- Modify: `apps/api/test/mail/templates.test.ts`
- Modify: `apps/api/test/moderation-retry.test.ts`
- Modify: `apps/api/test/staff/route-table.test.ts`
- Modify: `packages/contracts/src/moderation.ts`
- Modify: `packages/contracts/src/staff.ts`
- Modify: `packages/contracts/test/staff-cases.test.ts`
- Modify: `packages/rules/package.json`
- Modify: `packages/rules/src/index.ts`
- Updated by the install step: `pnpm-lock.yaml`

- [ ] **Step 1: Write the failing tests: `apps/admin/test/composer-drafts.test.tsx`, `apps/admin/test/composer.test.tsx`, `apps/admin/test/workspace.test.ts`, `apps/api/test/integration/moderation-dispatch.test.ts`, `apps/api/test/integration/moderation-path.test.ts`, `apps/api/test/integration/moderation-statement.test.ts`, `apps/api/test/mail/moderation-templates.test.ts`, `apps/api/test/moderation-dispatch.test.ts`, `packages/contracts/test/outcomes.test.ts`, `packages/rules/test/statement.test.ts`, `apps/admin/test/browser/console.browser.ts`, `apps/admin/test/browser/fixture-api.ts`, `apps/admin/test/browser/watch.ts`, `apps/admin/test/case-fixtures.ts`, `apps/admin/test/cases.test.tsx`, `apps/admin/test/screens.test.tsx`, `apps/admin/test/source.test.ts`, `apps/admin/test/store.test.ts`, `apps/api/test/integration/auth-notifiers.test.ts`, `apps/api/test/integration/http-staff-decisions.test.ts`, `apps/api/test/integration/moderation-decide.ts`, `apps/api/test/integration/moderation-fixtures.ts`, `apps/api/test/integration/moderation-races.test.ts`, `apps/api/test/integration/notices-harness.ts`, `apps/api/test/mail/templates.test.ts`, `apps/api/test/moderation-retry.test.ts`, `apps/api/test/staff/route-table.test.ts`, `packages/contracts/test/staff-cases.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/admin/src/compose.ts`, `apps/admin/src/screens/Composer.tsx`, `apps/api/src/moderation/dispatch.ts`, `apps/api/src/moderation/statement.ts`, `packages/rules/src/statement.ts`, `apps/admin/package.json`, `apps/admin/src/App.tsx`, `apps/admin/src/api.ts`, `apps/admin/src/app.css`, `apps/admin/src/messages.ts`, `apps/admin/src/screens/Case.tsx`, `apps/admin/src/screens/Home.tsx`, `apps/admin/src/screens/Queue.tsx`, `apps/admin/src/step-up.ts`, `apps/admin/src/store.ts`, `apps/admin/src/texts.ts`, `apps/api/src/auth/flows/notifiers.ts`, `apps/api/src/auth/flows/notify.ts`, `apps/api/src/auth/index.ts`, `apps/api/src/index.ts`, `apps/api/src/mail/mailer.ts`, `apps/api/src/mail/memory.ts`, `apps/api/src/mail/smtp.ts`, `apps/api/src/mail/templates.ts`, `apps/api/src/moderation/cases.ts`, `apps/api/src/moderation/decide.ts`, `apps/api/src/moderation/index.ts`, `apps/api/src/moderation/intake.ts`, `apps/api/src/moderation/repo.ts`, `apps/api/src/staff/cases.ts`, `packages/contracts/src/moderation.ts`, `packages/contracts/src/staff.ts`, `packages/rules/package.json`, `packages/rules/src/index.ts`**
- [ ] **Step 4: install: run `pnpm install --config.package-import-method=copy`, expecting `Done in`**
- [ ] **Step 5: frozen-install: run `pnpm install --frozen-lockfile`, expecting `Done in`**
- [ ] **Step 6: lockfile-age: run `node scripts/check-lockfile-age.mjs --base HEAD`, expecting `all at least 7 days old`**
- [ ] **Step 7: typecheck: run `pnpm typecheck`**
- [ ] **Step 8: test: run `pnpm test`, expecting `Tests  `**
- [ ] **Step 9: generate: run `pnpm --filter @korbat/db generate`, expecting `No schema changes`**
- [ ] **Step 10: apply-migrations: run the `apply-migrations` command in the prompt, expecting `migrations applied`, `count=17`**
- [ ] **Step 11: admin-build: run `pnpm --filter @korbat/admin build 2>&1 | tail -2 && ls apps/admin/dist apps/admin/dist/assets | sed -E 's/-[A-Z0-9]{8}[.]/-HASH./'`, expecting `Build success`, `index.html`, `favicon.svg`, `main-HASH.js`, `main-HASH.css`**
- [ ] **Step 12: admin-browser: run `pnpm --filter @korbat/admin test:browser`, expecting `Tests  30 passed (30)`**
- [ ] **Step 13: test-database-fresh: run `node scripts/test-db.mjs --fresh -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `test database ready: korbat_test`**
- [ ] **Step 14: integration-fresh: run the `integration-fresh` command in the prompt, expecting `Tests  `**
- [ ] **Step 15: test-database-upgrade: run `node scripts/test-db.mjs --upgrade-from 13 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `migrations up to 0013_forget_revoked_staff_keys applied and committed`, `later migrations applied as one batch`, `test database ready: korbat_test`**
- [ ] **Step 16: integration-upgraded: run the `integration-upgraded` command in the prompt, expecting `Tests  `**
- [ ] **Step 17: timing: run the `timing` command in the prompt, expecting `timing-ok=1`**
- [ ] **Step 18: api-bundle: run the `api-bundle` command in the prompt, expecting `Build success`, `bundle-ok`**
- [ ] **Step 19: Commit: `feat(rules,api,admin): deciding in the console, statements and the dispatch: packages/rules renders a decision's statement of reasons from its recorded rulebook and redress versions (statementParagraphs, with the sentences of a seal), so an old statement reads exactly as sent; the console gains the decision composer with its preview and draft slot: the range of an admin's answer on a case with an unanswered report of child sexual abuse material stops at the newest such report, a final decision without a measure on a post whose images cannot be opened says that its other reports are answered unseen, whoever is on duty seals what the case reaches with the fixed drafts or records that they do not, and an admin lifts a seal or corrects a decision; the decision route answers the case as read after the commit, mails the author (moderation_decision, moderation_burst) and, when protection was lifted, every staff account (moderation_csam_lifted), and the home screen lists lifted protections, recorded choices not to seal and the seals taken while deciding; the dispatch job sends receipts and statements, releases outcomes once a day, sends each notifier and reporter one update with the outcome's words (sealed without being opened; no action for now, the images could not be opened; the scopes), repeats the urgent alert while a reported image is still served or nobody has acted, and alerts on the queue's age`**

### Task 7: The app: the author's cases and decisions and a reporter's own reports over the API, the post chip, the report form with its three grounds, the notice status page, the cases and decision screens, Your reports, Report on posts, images and profiles, and the contact address in the terms

**Prompt:** `docs/superpowers/prompts/moderation-cases-3c/07-the-app.md`

**Files:**
- Create: `apps/api/src/moderation/author-repo.ts`
- Create: `apps/api/src/moderation/author.ts`
- Create: `apps/api/src/moderation/reports.ts`
- Create: `apps/api/test/integration/moderation-author.test.ts`
- Create: `apps/api/test/moderation-author.test.ts`
- Create: `apps/app/src/app/notice/[ref].tsx`
- Create: `apps/app/src/app/report.tsx`
- Create: `apps/app/src/app/settings/cases/[id].tsx`
- Create: `apps/app/src/app/settings/cases/index.tsx`
- Create: `apps/app/src/components/moderation/CasesLists.tsx`
- Create: `apps/app/src/components/moderation/DecisionDetail.tsx`
- Create: `apps/app/src/components/moderation/ItemLines.tsx`
- Create: `apps/app/src/components/moderation/NoticeStatusView.tsx`
- Create: `apps/app/src/components/moderation/ReportForm.tsx`
- Create: `apps/app/src/lib/moderation-words.ts`
- Create: `apps/app/src/lib/moderation.ts`
- Create: `apps/app/test/cases.test.tsx`
- Create: `apps/app/test/report.test.tsx`
- Create: `packages/contracts/test/author.test.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/moderation/index.ts`
- Modify: `apps/api/src/moderation/intake.ts`
- Modify: `apps/api/src/moderation/repo.ts`
- Modify: `apps/api/src/moderation/routes.ts`
- Modify: `apps/api/src/social/context.ts`
- Modify: `apps/api/src/social/index.ts`
- Modify: `apps/api/src/social/views.ts`
- Modify: `apps/api/test/integration/notices-harness.ts`
- Modify: `apps/app/.env.example`
- Modify: `apps/app/package.json`
- Modify: `apps/app/src/app/terms.tsx`
- Modify: `apps/app/src/app/u/[handle]/index.tsx`
- Modify: `apps/app/src/components/SettingsNav.tsx`
- Modify: `apps/app/src/components/social/MediaGrid.tsx`
- Modify: `apps/app/src/components/social/MediaViewer.tsx`
- Modify: `apps/app/src/components/social/PostCard.tsx`
- Modify: `apps/app/src/lib/api.ts`
- Modify: `apps/app/test/lifecycle.test.tsx`
- Modify: `infra/.env.example`
- Modify: `infra/caddy/Dockerfile`
- Modify: `infra/compose.yml`
- Modify: `packages/contracts/src/moderation.ts`
- Modify: `packages/contracts/src/social.ts`
- Updated by the install step: `pnpm-lock.yaml`

- [ ] **Step 1: Write the failing tests: `apps/api/test/integration/moderation-author.test.ts`, `apps/api/test/moderation-author.test.ts`, `apps/app/test/cases.test.tsx`, `apps/app/test/report.test.tsx`, `packages/contracts/test/author.test.ts`, `apps/api/test/integration/notices-harness.ts`, `apps/app/test/lifecycle.test.tsx`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/api/src/moderation/author-repo.ts`, `apps/api/src/moderation/author.ts`, `apps/api/src/moderation/reports.ts`, `apps/app/src/app/notice/[ref].tsx`, `apps/app/src/app/report.tsx`, `apps/app/src/app/settings/cases/[id].tsx`, `apps/app/src/app/settings/cases/index.tsx`, `apps/app/src/components/moderation/CasesLists.tsx`, `apps/app/src/components/moderation/DecisionDetail.tsx`, `apps/app/src/components/moderation/ItemLines.tsx`, `apps/app/src/components/moderation/NoticeStatusView.tsx`, `apps/app/src/components/moderation/ReportForm.tsx`, `apps/app/src/lib/moderation-words.ts`, `apps/app/src/lib/moderation.ts`, `apps/api/src/index.ts`, `apps/api/src/moderation/index.ts`, `apps/api/src/moderation/intake.ts`, `apps/api/src/moderation/repo.ts`, `apps/api/src/moderation/routes.ts`, `apps/api/src/social/context.ts`, `apps/api/src/social/index.ts`, `apps/api/src/social/views.ts`, `apps/app/.env.example`, `apps/app/package.json`, `apps/app/src/app/terms.tsx`, `apps/app/src/app/u/[handle]/index.tsx`, `apps/app/src/components/SettingsNav.tsx`, `apps/app/src/components/social/MediaGrid.tsx`, `apps/app/src/components/social/MediaViewer.tsx`, `apps/app/src/components/social/PostCard.tsx`, `apps/app/src/lib/api.ts`, `infra/.env.example`, `infra/caddy/Dockerfile`, `infra/compose.yml`, `packages/contracts/src/moderation.ts`, `packages/contracts/src/social.ts`**
- [ ] **Step 4: install: run `pnpm install --config.package-import-method=copy`, expecting `Done in`**
- [ ] **Step 5: frozen-install: run `pnpm install --frozen-lockfile`, expecting `Done in`**
- [ ] **Step 6: lockfile-age: run `node scripts/check-lockfile-age.mjs --base HEAD`, expecting `all at least 7 days old`**
- [ ] **Step 7: typecheck: run `pnpm typecheck`**
- [ ] **Step 8: test: run `pnpm -r --if-present run test --testTimeout=20000`, expecting `Tests  `**
- [ ] **Step 9: generate: run `pnpm --filter @korbat/db generate`, expecting `No schema changes`**
- [ ] **Step 10: compose-config: run `docker compose --env-file infra/.env.example -f infra/compose.yml config -q && echo config-ok`, expecting `config-ok`**
- [ ] **Step 11: export: run the `export` command in the prompt, expecting `Exported`**
- [ ] **Step 12: api-bundle: run `pnpm --filter @korbat/api build 2>&1 | tail -2 && node --check apps/api/dist/index.js && echo bundle-ok`, expecting `Build success`, `bundle-ok`**
- [ ] **Step 13: Commit: `feat(api,app,contracts,infra): the app's side of moderation cases: GET /api/moderation/cases lists the decisions an author was told of and /decisions/:id answers one as its statement's data (DecisionView), with the content it was made on from the decision's snapshot, a sealed image as a placeholder and what was erased said as erased; /reports lists the viewer's own reports in the words of the mails, an account's item under the handle the report named, and POST /report-mail/resume ends a stop of their report mails; a post's view carries its author's chip (Under review, Removed) through the social module's options; the app gains the report form (a korbat rule, illegal content, child sexual abuse material; signed in or out, with or without an item), the notice status page with its words for sealed, unseen and added items, the cases and decision screens under Settings, Your reports, Report on posts, images and profiles, and Cases in the settings menu; @korbat/rules joins the app; the terms page gains its Contact section from EXPO_PUBLIC_CONTACT_EMAIL, which the Caddy image takes as a build argument from WEB_CONTACT_EMAIL and refuses when it is missing in production`**

### Task 8: Appeals and re-examination: migration 0017 (appeals, who may review, the review kind of a decision, a seal taken while deciding refused when it would not be in force), the author's appeal, a reporter's re-examination request, the console's appeals screen and review composer, and the app's appeal form and re-examination control

**Prompt:** `docs/superpowers/prompts/moderation-cases-3c/08-appeals-reexamination.md`

**Files:**
- Create: `apps/admin/src/screens/Appeals.tsx`
- Create: `apps/admin/test/appeals.test.tsx`
- Create: `apps/api/src/moderation/appeals.ts`
- Create: `apps/api/test/integration/http-appeals.test.ts`
- Create: `apps/api/test/integration/moderation-appeals-flow.test.ts`
- Create: `apps/api/test/integration/moderation-appeals.test.ts`
- Create: `apps/api/test/integration/moderation-reexamine.test.ts`
- Create: `apps/app/test/appeals.test.tsx`
- Create: `packages/contracts/test/appeals.test.ts`
- Create: `packages/db/migrations/0017_appeals.sql`
- Create: `packages/db/migrations/meta/0017_snapshot.json`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/api.ts`
- Modify: `apps/admin/src/compose.ts`
- Modify: `apps/admin/src/messages.ts`
- Modify: `apps/admin/src/screens/Case.tsx`
- Modify: `apps/admin/src/screens/Composer.tsx`
- Modify: `apps/admin/src/screens/Home.tsx`
- Modify: `apps/admin/src/step-up.ts`
- Modify: `apps/admin/test/browser/console.browser.ts`
- Modify: `apps/admin/test/browser/fixture-api.ts`
- Modify: `apps/admin/test/case-fixtures.ts`
- Modify: `apps/admin/test/cases.test.tsx`
- Modify: `apps/admin/test/screens.test.tsx`
- Modify: `apps/admin/test/source.test.ts`
- Modify: `apps/api/src/moderation/author-repo.ts`
- Modify: `apps/api/src/moderation/author.ts`
- Modify: `apps/api/src/moderation/cases.ts`
- Modify: `apps/api/src/moderation/context.ts`
- Modify: `apps/api/src/moderation/decide.ts`
- Modify: `apps/api/src/moderation/index.ts`
- Modify: `apps/api/src/moderation/intake.ts`
- Modify: `apps/api/src/moderation/repo.ts`
- Modify: `apps/api/src/moderation/reports.ts`
- Modify: `apps/api/src/moderation/routes.ts`
- Modify: `apps/api/src/staff/cases.ts`
- Modify: `apps/api/test/integration/http-notices.test.ts`
- Modify: `apps/api/test/integration/moderation-author.test.ts`
- Modify: `apps/api/test/integration/moderation-cases.test.ts`
- Modify: `apps/api/test/integration/moderation-decide.ts`
- Modify: `apps/api/test/integration/moderation-decisions.test.ts`
- Modify: `apps/api/test/integration/moderation-fixtures.ts`
- Modify: `apps/api/test/integration/moderation-path.test.ts`
- Modify: `apps/api/test/integration/moderation-reveal.test.ts`
- Modify: `apps/api/test/integration/moderation-schema.test.ts`
- Modify: `apps/api/test/moderation-author.test.ts`
- Modify: `apps/api/test/moderation-context.test.ts`
- Modify: `apps/api/test/moderation-intake-order.test.ts`
- Modify: `apps/api/test/staff/route-table.test.ts`
- Modify: `apps/app/src/app/notice/[ref].tsx`
- Modify: `apps/app/src/app/settings/cases/[id].tsx`
- Modify: `apps/app/src/app/settings/cases/index.tsx`
- Modify: `apps/app/src/components/moderation/CasesLists.tsx`
- Modify: `apps/app/src/components/moderation/DecisionDetail.tsx`
- Modify: `apps/app/src/components/moderation/ItemLines.tsx`
- Modify: `apps/app/src/components/moderation/NoticeStatusView.tsx`
- Modify: `apps/app/src/lib/api.ts`
- Modify: `apps/app/src/lib/moderation-words.ts`
- Modify: `apps/app/src/lib/moderation.ts`
- Modify: `apps/app/test/cases.test.tsx`
- Modify: `packages/contracts/src/moderation.ts`
- Modify: `packages/contracts/src/staff.ts`
- Modify: `packages/contracts/test/author.test.ts`
- Modify: `packages/contracts/test/moderation.test.ts`
- Modify: `packages/contracts/test/outcomes.test.ts`
- Modify: `packages/contracts/test/staff-cases.test.ts`
- Modify: `packages/db/migrations/meta/_journal.json`

- [ ] **Step 1: Write the failing tests: `apps/admin/test/appeals.test.tsx`, `apps/api/test/integration/http-appeals.test.ts`, `apps/api/test/integration/moderation-appeals-flow.test.ts`, `apps/api/test/integration/moderation-appeals.test.ts`, `apps/api/test/integration/moderation-reexamine.test.ts`, `apps/app/test/appeals.test.tsx`, `packages/contracts/test/appeals.test.ts`, `apps/admin/test/browser/console.browser.ts`, `apps/admin/test/browser/fixture-api.ts`, `apps/admin/test/case-fixtures.ts`, `apps/admin/test/cases.test.tsx`, `apps/admin/test/screens.test.tsx`, `apps/admin/test/source.test.ts`, `apps/api/test/integration/http-notices.test.ts`, `apps/api/test/integration/moderation-author.test.ts`, `apps/api/test/integration/moderation-cases.test.ts`, `apps/api/test/integration/moderation-decide.ts`, `apps/api/test/integration/moderation-decisions.test.ts`, `apps/api/test/integration/moderation-fixtures.ts`, `apps/api/test/integration/moderation-path.test.ts`, `apps/api/test/integration/moderation-reveal.test.ts`, `apps/api/test/integration/moderation-schema.test.ts`, `apps/api/test/moderation-author.test.ts`, `apps/api/test/moderation-context.test.ts`, `apps/api/test/moderation-intake-order.test.ts`, `apps/api/test/staff/route-table.test.ts`, `apps/app/test/cases.test.tsx`, `packages/contracts/test/author.test.ts`, `packages/contracts/test/moderation.test.ts`, `packages/contracts/test/outcomes.test.ts`, `packages/contracts/test/staff-cases.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/admin/src/screens/Appeals.tsx`, `apps/api/src/moderation/appeals.ts`, `packages/db/migrations/0017_appeals.sql`, `packages/db/migrations/meta/0017_snapshot.json`, `apps/admin/src/App.tsx`, `apps/admin/src/api.ts`, `apps/admin/src/compose.ts`, `apps/admin/src/messages.ts`, `apps/admin/src/screens/Case.tsx`, `apps/admin/src/screens/Composer.tsx`, `apps/admin/src/screens/Home.tsx`, `apps/admin/src/step-up.ts`, `apps/api/src/moderation/author-repo.ts`, `apps/api/src/moderation/author.ts`, `apps/api/src/moderation/cases.ts`, `apps/api/src/moderation/context.ts`, `apps/api/src/moderation/decide.ts`, `apps/api/src/moderation/index.ts`, `apps/api/src/moderation/intake.ts`, `apps/api/src/moderation/repo.ts`, `apps/api/src/moderation/reports.ts`, `apps/api/src/moderation/routes.ts`, `apps/api/src/staff/cases.ts`, `apps/app/src/app/notice/[ref].tsx`, `apps/app/src/app/settings/cases/[id].tsx`, `apps/app/src/app/settings/cases/index.tsx`, `apps/app/src/components/moderation/CasesLists.tsx`, `apps/app/src/components/moderation/DecisionDetail.tsx`, `apps/app/src/components/moderation/ItemLines.tsx`, `apps/app/src/components/moderation/NoticeStatusView.tsx`, `apps/app/src/lib/api.ts`, `apps/app/src/lib/moderation-words.ts`, `apps/app/src/lib/moderation.ts`, `packages/contracts/src/moderation.ts`, `packages/contracts/src/staff.ts`, `packages/db/migrations/meta/_journal.json`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm -r --if-present run test --testTimeout=20000`, expecting `Tests  `**
- [ ] **Step 6: generate: run `pnpm --filter @korbat/db generate`, expecting `No schema changes`**
- [ ] **Step 7: apply-migrations: run the `apply-migrations` command in the prompt, expecting `migrations applied`, `count=18`**
- [ ] **Step 8: admin-build: run `pnpm --filter @korbat/admin build 2>&1 | tail -2 && ls apps/admin/dist apps/admin/dist/assets | sed -E 's/-[A-Z0-9]{8}[.]/-HASH./'`, expecting `Build success`, `index.html`, `favicon.svg`, `main-HASH.js`, `main-HASH.css`**
- [ ] **Step 9: admin-browser: run `pnpm --filter @korbat/admin test:browser`, expecting `Tests  32 passed (32)`**
- [ ] **Step 10: export: run the `export` command in the prompt, expecting `Exported`**
- [ ] **Step 11: test-database-fresh: run `node scripts/test-db.mjs --fresh -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `test database ready: korbat_test`**
- [ ] **Step 12: integration-own: run the `integration-own` command in the prompt, expecting `Tests  `**
- [ ] **Step 13: api-bundle: run the `api-bundle` command in the prompt, expecting `Build success`, `bundle-ok`**
- [ ] **Step 14: Commit: `feat(db,api,admin,app,contracts): appeals and re-examination: migration 0017 checks an appeal (one a decision, by its subject, inside the six months, while a measure of the decision is in force), says from two stored facts whether a review needs an admin, lets decisions_record take the review kind with its reviewer's conflict, and makes the database itself refuse a seal taken while deciding that would not be in force (case_changed), so the API's own read of the view is gone; POST /api/moderation/decisions/:id/appeal files an appeal and answers the decision as it now reads; POST /api/notices/reexamine and /api/moderation/items/:item/reexamine ask once for a no-action item to be decided again as a new report, an added item and the double request of an origin with its added item included; GET /api/staff/appeals lists the appeals a person may review and POST /api/staff/decisions/:decision/review records a review under the step-up appeals_reviewed, kept, reversed in part or in full, with what follows its commit shared with decisions; the overview counts the appeals this person may review and those without a reviewer; the console gains the appeals screen and the review composer, the app the appeal form with its states and Ask for a re-examination on the status page and in Your reports`**

### Task 9: Evidence lifecycle and the command line: migration 0018 (when a case's evidence is due, the one function that erases snapshots, the R4 redaction, the release of holds, the forgetting of who reported, the mark of a deleted account), the retention job, the account's deletion in the moderation module, and the staff command line's new commands

**Prompt:** `docs/superpowers/prompts/moderation-cases-3c/09-evidence-lifecycle.md`

**Files:**
- Create: `apps/api/src/cli/staff-cases.ts`
- Create: `apps/api/src/moderation/access.ts`
- Create: `apps/api/src/moderation/retention.ts`
- Create: `apps/api/test/integration/cli-staff-cases.test.ts`
- Create: `apps/api/test/integration/media-states.test.ts`
- Create: `apps/api/test/integration/moderation-retention-db.test.ts`
- Create: `apps/api/test/integration/moderation-retention.test.ts`
- Create: `apps/api/test/integration/retention-fixtures.ts`
- Create: `packages/db/migrations/0018_retention.sql`
- Create: `packages/db/migrations/meta/0018_snapshot.json`
- Modify: `apps/admin/src/screens/Home.tsx`
- Modify: `apps/admin/test/browser/console.browser.ts`
- Modify: `apps/admin/test/browser/fixture-api.ts`
- Modify: `apps/admin/test/case-fixtures.ts`
- Modify: `apps/admin/test/cases.test.tsx`
- Modify: `apps/admin/test/screens.test.tsx`
- Modify: `apps/api/.env.example`
- Modify: `apps/api/src/account/context.ts`
- Modify: `apps/api/src/account/flows/deletion.ts`
- Modify: `apps/api/src/account/index.ts`
- Modify: `apps/api/src/auth/flows/notifiers.ts`
- Modify: `apps/api/src/auth/index.ts`
- Modify: `apps/api/src/cli/staff.ts`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/media/index.ts`
- Modify: `apps/api/src/media/repo.ts`
- Modify: `apps/api/src/moderation/cases.ts`
- Modify: `apps/api/src/moderation/index.ts`
- Modify: `apps/api/src/moderation/repo.ts`
- Modify: `apps/api/test/account/deletion.test.ts`
- Modify: `apps/api/test/architecture.test.ts`
- Modify: `apps/api/test/cli-staff.test.ts`
- Modify: `apps/api/test/config.test.ts`
- Modify: `apps/api/test/integration/media-gates.test.ts`
- Modify: `apps/api/test/integration/moderation-cases.test.ts`
- Modify: `apps/api/test/integration/moderation-fixtures.ts`
- Modify: `apps/api/test/integration/moderation-reveal.test.ts`
- Modify: `apps/api/test/integration/moderation-schema.test.ts`
- Modify: `apps/api/test/integration/staff-schema.test.ts`
- Modify: `apps/api/test/lab/README.md`
- Modify: `apps/api/test/lab/contention.lab.ts`
- Modify: `infra/.env.example`
- Modify: `infra/compose.yml`
- Modify: `packages/contracts/src/moderation.ts`
- Modify: `packages/contracts/test/appeals.test.ts`
- Modify: `packages/contracts/test/outcomes.test.ts`
- Modify: `packages/contracts/test/staff-cases.test.ts`
- Modify: `packages/db/migrations/meta/_journal.json`

- [ ] **Step 1: Write the failing tests: `apps/api/test/integration/cli-staff-cases.test.ts`, `apps/api/test/integration/media-states.test.ts`, `apps/api/test/integration/moderation-retention-db.test.ts`, `apps/api/test/integration/moderation-retention.test.ts`, `apps/api/test/integration/retention-fixtures.ts`, `apps/admin/test/browser/console.browser.ts`, `apps/admin/test/browser/fixture-api.ts`, `apps/admin/test/case-fixtures.ts`, `apps/admin/test/cases.test.tsx`, `apps/admin/test/screens.test.tsx`, `apps/api/test/account/deletion.test.ts`, `apps/api/test/architecture.test.ts`, `apps/api/test/cli-staff.test.ts`, `apps/api/test/config.test.ts`, `apps/api/test/integration/media-gates.test.ts`, `apps/api/test/integration/moderation-cases.test.ts`, `apps/api/test/integration/moderation-fixtures.ts`, `apps/api/test/integration/moderation-reveal.test.ts`, `apps/api/test/integration/moderation-schema.test.ts`, `apps/api/test/integration/staff-schema.test.ts`, `apps/api/test/lab/README.md`, `apps/api/test/lab/contention.lab.ts`, `packages/contracts/test/appeals.test.ts`, `packages/contracts/test/outcomes.test.ts`, `packages/contracts/test/staff-cases.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/api/src/cli/staff-cases.ts`, `apps/api/src/moderation/access.ts`, `apps/api/src/moderation/retention.ts`, `packages/db/migrations/0018_retention.sql`, `packages/db/migrations/meta/0018_snapshot.json`, `apps/admin/src/screens/Home.tsx`, `apps/api/.env.example`, `apps/api/src/account/context.ts`, `apps/api/src/account/flows/deletion.ts`, `apps/api/src/account/index.ts`, `apps/api/src/auth/flows/notifiers.ts`, `apps/api/src/auth/index.ts`, `apps/api/src/cli/staff.ts`, `apps/api/src/config.ts`, `apps/api/src/index.ts`, `apps/api/src/media/index.ts`, `apps/api/src/media/repo.ts`, `apps/api/src/moderation/cases.ts`, `apps/api/src/moderation/index.ts`, `apps/api/src/moderation/repo.ts`, `infra/.env.example`, `infra/compose.yml`, `packages/contracts/src/moderation.ts`, `packages/db/migrations/meta/_journal.json`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm -r --if-present run test --testTimeout=20000`, expecting `Tests  `**
- [ ] **Step 6: generate: run `pnpm --filter @korbat/db generate`, expecting `No schema changes`**
- [ ] **Step 7: compose-config: run `docker compose --env-file infra/.env.example -f infra/compose.yml config -q && echo config-ok`, expecting `config-ok`**
- [ ] **Step 8: apply-migrations: run the `apply-migrations` command in the prompt, expecting `migrations applied`, `count=19`**
- [ ] **Step 9: admin-build: run `pnpm --filter @korbat/admin build 2>&1 | tail -2 && ls apps/admin/dist apps/admin/dist/assets | sed -E 's/-[A-Z0-9]{8}[.]/-HASH./'`, expecting `Build success`, `index.html`, `favicon.svg`, `main-HASH.js`, `main-HASH.css`**
- [ ] **Step 10: admin-browser: run `pnpm --filter @korbat/admin test:browser`, expecting `Tests  33 passed (33)`**
- [ ] **Step 11: export: run the `export` command in the prompt, expecting `Exported`**
- [ ] **Step 12: test-database-fresh: run `node scripts/test-db.mjs --fresh -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `test database ready: korbat_test`**
- [ ] **Step 13: integration-fresh: run the `integration-fresh` command in the prompt, expecting `Tests  `**
- [ ] **Step 14: test-database-upgrade: run `node scripts/test-db.mjs --upgrade-from 13 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `migrations up to 0013_forget_revoked_staff_keys applied and committed`, `later migrations applied as one batch`, `test database ready: korbat_test`**
- [ ] **Step 15: integration-upgraded: run the `integration-upgraded` command in the prompt, expecting `Tests  `**
- [ ] **Step 16: timing: run the `timing` command in the prompt, expecting `timing-ok=1`**
- [ ] **Step 17: api-bundle: run the `api-bundle` command in the prompt, expecting `Build success`, `bundle-ok`**
- [ ] **Step 18: Commit: `feat(db,api,admin,contracts,infra): the evidence lifecycle and the command line: migration 0018 says when each kind of a case's evidence is due and erases it through one function that a frozen post's snapshots pass only when the freeze has ended (gate E), redacts what an R4 decision restricted once that decision is final for its author, releases a closed case's holds, forgets who reported once an intake's record is due, and marks a deleted account for the staff schema; the retention job runs those steps one by one under its own lock, each in a try of its own, with an audit row for each erasure and the images nothing retains dropped in batches whose files are requested after each commit; the account's purge forgets the account in the moderation module after the profile's own purge; the overview counts late erasures; staff.js gains link and unlink (a staff member's personal accounts), limits, text-verify, account-facts, access-request and keys; MODERATION_RETENTION switches the job`**

### Task 10: Export, terms and the stack: the export's moderation member, the terms' moderation sections held to their constants, the smoke test's moderation steps, and the whole stack rebuilt and smoke-tested

**Prompt:** `docs/superpowers/prompts/moderation-cases-3c/10-export-terms-stack.md`

**Files:**
- Create: `apps/api/src/moderation/export.ts`
- Create: `apps/api/test/integration/moderation-export.test.ts`
- Create: `apps/api/test/moderation-export.test.ts`
- Create: `apps/app/test/terms.test.tsx`
- Modify: `apps/api/src/account/context.ts`
- Modify: `apps/api/src/account/flows/export.ts`
- Modify: `apps/api/src/account/index.ts`
- Modify: `apps/api/src/moderation/access.ts`
- Modify: `apps/api/src/moderation/author.ts`
- Modify: `apps/api/src/moderation/index.ts`
- Modify: `apps/api/src/moderation/repo.ts`
- Modify: `apps/api/src/moderation/reports.ts`
- Modify: `apps/api/test/account/deletion.test.ts`
- Modify: `apps/api/test/account/export.test.ts`
- Modify: `apps/app/src/app/terms.tsx`
- Modify: `apps/app/src/lib/terms.ts`
- Modify: `packages/contracts/src/account.ts`
- Modify: `packages/contracts/test/account.test.ts`
- Modify: `scripts/smoke-auth-stack.mjs`

- [ ] **Step 1: Write the failing tests: `apps/api/test/integration/moderation-export.test.ts`, `apps/api/test/moderation-export.test.ts`, `apps/app/test/terms.test.tsx`, `apps/api/test/account/deletion.test.ts`, `apps/api/test/account/export.test.ts`, `packages/contracts/test/account.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/api/src/moderation/export.ts`, `apps/api/src/account/context.ts`, `apps/api/src/account/flows/export.ts`, `apps/api/src/account/index.ts`, `apps/api/src/moderation/access.ts`, `apps/api/src/moderation/author.ts`, `apps/api/src/moderation/index.ts`, `apps/api/src/moderation/repo.ts`, `apps/api/src/moderation/reports.ts`, `apps/app/src/app/terms.tsx`, `apps/app/src/lib/terms.ts`, `packages/contracts/src/account.ts`, `scripts/smoke-auth-stack.mjs`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm -r --if-present run test --testTimeout=20000`, expecting `Tests  `**
- [ ] **Step 6: generate: run `pnpm --filter @korbat/db generate`, expecting `No schema changes`**
- [ ] **Step 7: smoke-syntax: run `node --check scripts/smoke-auth-stack.mjs && echo smoke-syntax-ok`, expecting `smoke-syntax-ok`**
- [ ] **Step 8: export: run the `export` command in the prompt, expecting `Exported`**
- [ ] **Step 9: integration-own: run the `integration-own` command in the prompt, expecting `Tests  `**
- [ ] **Step 10: api-bundle: run the `api-bundle` command in the prompt, expecting `Build success`, `bundle-ok`**
- [ ] **Step 11: stack-down: run `docker compose -f infra/compose.yml -f infra/compose.dev.yml down && echo down-ok`, expecting `down-ok`**
- [ ] **Step 12: build: run the `build` command in the prompt, expecting `build-exit=0`**
- [ ] **Step 13: stack-up: run `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --wait && echo up-ok`, expecting `up-ok`**
- [ ] **Step 14: test-database: run `node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `migrations applied`, `test database ready: korbat_test`**
- [ ] **Step 15: smoke: run the `smoke` command in the prompt, expecting `smoke test passed`**
- [ ] **Step 16: stack-stop: run the `stack-stop` command in the prompt, expecting `postgres-1 Up`**
- [ ] **Step 17: Commit: `feat(api,app,contracts): the export, the terms and the stack check for moderation cases: the account's export gains its last member, moderation, from ModerationForAccount.exportFor: the decisions the person was told of with their statements, their appeals, and their own reports as their screens show them, never a reporter, a staff member, a staff text of a decision without a measure or a sealed image; the terms page gains the rulebook's texts, how moderators decide, appeals, reports and notices and the retention periods, every number and every rule's text read from its constant and held there by table tests; the smoke test sends a report signed out through the app's site, reads its status page and checks that the staff routes are refused on the app's site and answered on the console's`**

### Task 11: What the adversarial review of the built code upheld: one lock order for an intake and an author's delete, the purge's and the disposal's file requests after their commits, the R4 redaction keeping an open case's later snapshot, a statement that says no more than korbat found, the deletion's words, the composer's forecast of a closing decision, mails that are never sent twice by a database that cannot write, and the tests that were missing

**Prompt:** `docs/superpowers/prompts/moderation-cases-3c/11-review-fixes.md`

**Files:**
- Create: `apps/api/src/media/owed.ts`
- Create: `apps/api/src/moderation/statement-repo.ts`
- Create: `apps/api/test/integration/moderation-log-errors.test.ts`
- Create: `apps/api/test/integration/moderation-post-locks.test.ts`
- Create: `apps/api/test/social/delete-retry.test.ts`
- Create: `packages/db/migrations/0019_redaction_scope.sql`
- Create: `packages/db/migrations/meta/0019_snapshot.json`
- Modify: `apps/admin/src/compose.ts`
- Modify: `apps/admin/src/screens/Composer.tsx`
- Modify: `apps/admin/test/browser/console.browser.ts`
- Modify: `apps/admin/test/composer-drafts.test.tsx`
- Modify: `apps/admin/test/composer.test.tsx`
- Modify: `apps/api/src/account/flows/deletion.ts`
- Modify: `apps/api/src/lib/logger.ts`
- Modify: `apps/api/src/mail/templates.ts`
- Modify: `apps/api/src/media/cases.ts`
- Modify: `apps/api/src/media/files.ts`
- Modify: `apps/api/src/media/index.ts`
- Modify: `apps/api/src/media/sweeper.ts`
- Modify: `apps/api/src/moderation/dispatch.ts`
- Modify: `apps/api/src/moderation/intake.ts`
- Modify: `apps/api/src/moderation/repo.ts`
- Modify: `apps/api/src/moderation/retention.ts`
- Modify: `apps/api/src/moderation/statement.ts`
- Modify: `apps/api/src/social/flows/posts.ts`
- Modify: `apps/api/src/social/repo.ts`
- Modify: `apps/api/test/account/deletion.test.ts`
- Modify: `apps/api/test/architecture.test.ts`
- Modify: `apps/api/test/integration/media-cases.test.ts`
- Modify: `apps/api/test/integration/media-gates.test.ts`
- Modify: `apps/api/test/integration/moderation-dispatch.test.ts`
- Modify: `apps/api/test/integration/moderation-fixtures.ts`
- Modify: `apps/api/test/integration/moderation-notices.test.ts`
- Modify: `apps/api/test/integration/moderation-path.test.ts`
- Modify: `apps/api/test/integration/moderation-reexamine.test.ts`
- Modify: `apps/api/test/integration/moderation-retention-db.test.ts`
- Modify: `apps/api/test/integration/moderation-retention.test.ts`
- Modify: `apps/api/test/integration/moderation-reveal.test.ts`
- Modify: `apps/api/test/logger.test.ts`
- Modify: `apps/api/test/mail/templates.test.ts`
- Modify: `apps/api/test/media/files.test.ts`
- Modify: `apps/api/test/moderation-author.test.ts`
- Modify: `apps/app/src/app/settings/account.tsx`
- Modify: `apps/app/src/components/moderation/CasesLists.tsx`
- Modify: `apps/app/src/components/moderation/DecisionDetail.tsx`
- Modify: `apps/app/src/components/moderation/ItemLines.tsx`
- Modify: `apps/app/src/lib/moderation-words.ts`
- Modify: `apps/app/src/lib/moderation.ts`
- Modify: `apps/app/src/lib/terms.ts`
- Modify: `apps/app/test/appeals.test.tsx`
- Modify: `apps/app/test/cases.test.tsx`
- Modify: `apps/app/test/lifecycle.test.tsx`
- Modify: `apps/app/test/terms.test.tsx`
- Modify: `packages/contracts/src/account.ts`
- Modify: `packages/contracts/test/account.test.ts`
- Modify: `packages/db/migrations/meta/_journal.json`
- Modify: `packages/media-protocol/src/layout.ts`
- Modify: `packages/media-protocol/test/protocol.test.ts`
- Modify: `packages/rules/src/statement.ts`
- Modify: `packages/rules/test/statement.test.ts`

- [ ] **Step 1: Write the failing tests: `apps/api/test/integration/moderation-log-errors.test.ts`, `apps/api/test/integration/moderation-post-locks.test.ts`, `apps/api/test/social/delete-retry.test.ts`, `apps/admin/test/browser/console.browser.ts`, `apps/admin/test/composer-drafts.test.tsx`, `apps/admin/test/composer.test.tsx`, `apps/api/test/account/deletion.test.ts`, `apps/api/test/architecture.test.ts`, `apps/api/test/integration/media-cases.test.ts`, `apps/api/test/integration/media-gates.test.ts`, `apps/api/test/integration/moderation-dispatch.test.ts`, `apps/api/test/integration/moderation-fixtures.ts`, `apps/api/test/integration/moderation-notices.test.ts`, `apps/api/test/integration/moderation-path.test.ts`, `apps/api/test/integration/moderation-reexamine.test.ts`, `apps/api/test/integration/moderation-retention-db.test.ts`, `apps/api/test/integration/moderation-retention.test.ts`, `apps/api/test/integration/moderation-reveal.test.ts`, `apps/api/test/logger.test.ts`, `apps/api/test/mail/templates.test.ts`, `apps/api/test/media/files.test.ts`, `apps/api/test/moderation-author.test.ts`, `apps/app/test/appeals.test.tsx`, `apps/app/test/cases.test.tsx`, `apps/app/test/lifecycle.test.tsx`, `apps/app/test/terms.test.tsx`, `packages/contracts/test/account.test.ts`, `packages/media-protocol/test/protocol.test.ts`, `packages/rules/test/statement.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/api/src/media/owed.ts`, `apps/api/src/moderation/statement-repo.ts`, `packages/db/migrations/0019_redaction_scope.sql`, `packages/db/migrations/meta/0019_snapshot.json`, `apps/admin/src/compose.ts`, `apps/admin/src/screens/Composer.tsx`, `apps/api/src/account/flows/deletion.ts`, `apps/api/src/lib/logger.ts`, `apps/api/src/mail/templates.ts`, `apps/api/src/media/cases.ts`, `apps/api/src/media/files.ts`, `apps/api/src/media/index.ts`, `apps/api/src/media/sweeper.ts`, `apps/api/src/moderation/dispatch.ts`, `apps/api/src/moderation/intake.ts`, `apps/api/src/moderation/repo.ts`, `apps/api/src/moderation/retention.ts`, `apps/api/src/moderation/statement.ts`, `apps/api/src/social/flows/posts.ts`, `apps/api/src/social/repo.ts`, `apps/app/src/app/settings/account.tsx`, `apps/app/src/components/moderation/CasesLists.tsx`, `apps/app/src/components/moderation/DecisionDetail.tsx`, `apps/app/src/components/moderation/ItemLines.tsx`, `apps/app/src/lib/moderation-words.ts`, `apps/app/src/lib/moderation.ts`, `apps/app/src/lib/terms.ts`, `packages/contracts/src/account.ts`, `packages/db/migrations/meta/_journal.json`, `packages/media-protocol/src/layout.ts`, `packages/rules/src/statement.ts`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm -r --if-present run test --testTimeout=20000`, expecting `Tests  `**
- [ ] **Step 6: generate: run `pnpm --filter @korbat/db generate`, expecting `No schema changes`**
- [ ] **Step 7: apply-migrations: run the `apply-migrations` command in the prompt, expecting `migrations applied`, `count=20`**
- [ ] **Step 8: admin-build: run `pnpm --filter @korbat/admin build 2>&1 | tail -2 && ls apps/admin/dist apps/admin/dist/assets | sed -E 's/-[A-Z0-9]{8}[.]/-HASH./'`, expecting `Build success`, `index.html`, `favicon.svg`, `main-HASH.js`, `main-HASH.css`**
- [ ] **Step 9: admin-browser: run `pnpm --filter @korbat/admin test:browser`, expecting `Tests  33 passed (33)`**
- [ ] **Step 10: export: run the `export` command in the prompt, expecting `Exported`**
- [ ] **Step 11: test-database-fresh: run `node scripts/test-db.mjs --fresh -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `test database ready: korbat_test`**
- [ ] **Step 12: integration-fresh: run the `integration-fresh` command in the prompt, expecting `Tests  `**
- [ ] **Step 13: test-database-upgrade: run `node scripts/test-db.mjs --upgrade-from 13 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `migrations up to 0013_forget_revoked_staff_keys applied and committed`, `later migrations applied as one batch`, `test database ready: korbat_test`**
- [ ] **Step 14: integration-upgraded: run the `integration-upgraded` command in the prompt, expecting `Tests  `**
- [ ] **Step 15: timing: run the `timing` command in the prompt, expecting `timing-ok=1`**
- [ ] **Step 16: api-bundle: run the `api-bundle` command in the prompt, expecting `Build success`, `bundle-ok`**
- [ ] **Step 17: stack-down: run `docker compose -f infra/compose.yml -f infra/compose.dev.yml down && echo down-ok`, expecting `down-ok`**
- [ ] **Step 18: build: run the `build` command in the prompt, expecting `build-exit=0`**
- [ ] **Step 19: stack-up: run `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --wait && echo up-ok`, expecting `up-ok`**
- [ ] **Step 20: test-database: run `node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `migrations applied`, `test database ready: korbat_test`**
- [ ] **Step 21: smoke: run the `smoke` command in the prompt, expecting `smoke test passed`**
- [ ] **Step 22: stack-stop: run the `stack-stop` command in the prompt, expecting `postgres-1 Up`**
- [ ] **Step 23: Commit: `fix(db,api,admin,app,rules,contracts): what the review of moderation cases upheld, fixed: an intake that reaches two posts and an author's delete or post of one of them take the rows in one order, so neither ends in a 500; the account's purge asks for image files only after its commit, and the disposal takes no further batch while file requests fail and counts what is owed; redact_r4_body erases what the R4 decision restricted and never a snapshot an open case took afterwards, under that case's lock (a new migration); a seal's statement says the step rests on rule R2 and a measure taken while deciding says korbat is checking, never that a rule is broken or that something was found illegal; the deletion screen and mails say what korbat keeps for a case; the composer forecasts a closing decision as the database applies it and offers no second withhold; a mail's result row is locked before the mail is sent, so a database that cannot write sends nothing; a failing statement's parameters stay out of the log; the daily limits, three sentences of the terms and a kept review's row say what the code does; the urgent repeat's work a round is bounded; and the tests the review found missing, with the five retention tests left by the evidence lifecycle`**

### Task 12: Documentation: the README's moderation section, its runbook and the records the operator keeps, the lines 3c made false, the main design's amendment, Changed by 3c in five designs, and the dry run's amendments to the 3c design

**Prompt:** `docs/superpowers/prompts/moderation-cases-3c/12-documentation.md`

**Files:**
- Create: `apps/admin/test/readme.test.ts`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-09-03-korbat-design.md`
- Modify: `docs/superpowers/specs/2026-09-17-posting-feed-2a-design.md`
- Modify: `docs/superpowers/specs/2026-09-18-images-2b-design.md`
- Modify: `docs/superpowers/specs/2026-09-24-account-lifecycle-1b-design.md`
- Modify: `docs/superpowers/specs/2026-09-28-explore-2c-design.md`
- Modify: `docs/superpowers/specs/2026-09-28-staff-console-3a-design.md`
- Modify: `docs/superpowers/specs/2026-10-02-moderation-cases-3c-design.md`

- [ ] **Step 1: Write the failing tests: `apps/admin/test/readme.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `cd apps/admin && node ../../node_modules/vitest/vitest.mjs run test/readme.test.ts`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `README.md`, `docs/superpowers/specs/2026-09-03-korbat-design.md`, `docs/superpowers/specs/2026-09-17-posting-feed-2a-design.md`, `docs/superpowers/specs/2026-09-18-images-2b-design.md`, `docs/superpowers/specs/2026-09-24-account-lifecycle-1b-design.md`, `docs/superpowers/specs/2026-09-28-explore-2c-design.md`, `docs/superpowers/specs/2026-09-28-staff-console-3a-design.md`, `docs/superpowers/specs/2026-10-02-moderation-cases-3c-design.md`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm -r --if-present run test --testTimeout=20000`, expecting `Tests  `**
- [ ] **Step 6: amendments: run the `amendments` command in the prompt, expecting `amendments=105`**
- [ ] **Step 7: Commit: `docs: the README explains moderation cases (reports and notices, the queue and its lanes, deciding and the preview, the limits on staff, reveals, appeals and the one-moderator rule, re-examination, evidence and retention, the emergency switch, the mails and the commands) with its runbook and the records kept off the server, and a test holds its words to the code; the lines 3c made false are rewritten; the main design records what 3c delivered and sub-project 3 as it now stands (3c, 3e, 3f, 3d); the 2a, 2b, 1b, 2c and 3a designs say what 3c changed; the 3c design gains its dry-run amendments`**
