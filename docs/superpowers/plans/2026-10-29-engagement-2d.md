# korbat — Engagement (2d) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activity, one screen that tells a person about replies, mentions, quotes and follows of them and the decisions korbat told them about their own content, written in the act's transaction under the recipient's rules and read through the visibility rules every read of a post uses; mentions stored as data and linked only while the account keeps its handle; avatars through the worker and the image checks, reset by a moderator; share cards for public posts and profiles built by the API and stitched in by Caddy; the author's hide counts; and a Getting started panel on a new account's empty Following.

**Architecture:** Seven commits, migrations 0049 to 0053: the contracts and the database for Activity and mentions; mentions and Activity in the API; avatar images through the worker; the moderation of avatars; the app's screens; share cards, indexing and the terms; and the record.

**Tech Stack:** Node 24 and Hono for the API, PostgreSQL 18 with drizzle migrations, triggers and row-level guards, Valkey, the no-network media worker with sharp, Docker Compose and Caddy (card pages and robots.txt); Expo SDK 57 for the web app and React 19 for the console; playwright-core 1.63 for both browser checks; vitest 4.

**Complete code:** each task's full files, commands and observed output are in `docs/superpowers/prompts/engagement-2d/NN-<slug>.md`, generated from a verified dry run. This plan is the map. Where it and a prompt differ, the prompt wins.

**Spec:** `docs/superpowers/specs/2026-10-22-engagement-2d-design.md`.

---

## File structure

- `apps/api/src/activity/`: `flows.ts` (Task 2), `index.ts` (Task 2), `repo.ts` (Task 2), `retention.ts` (Task 2)
- `apps/api/src/cards/`: `build.ts` (Task 6), `index.ts` (Task 6), `words.ts` (Task 6)
- `apps/api/test/`: `measure-lists.test.ts` (Task 4), `cards.test.ts` (Task 6)
- `apps/api/test/integration/`: `activity-schema.test.ts` (Task 1), `activity-harness.ts` (Task 2), `activity-moderation.test.ts` (Task 2), `activity-retention.test.ts` (Task 2), `http-activity.test.ts` (Task 2), `http-hide-counts.test.ts` (Task 2), `mentions.test.ts` (Task 2), `http-avatar.test.ts` (Task 3), `automation-avatar.test.ts` (Task 4), `avatar-moderation.test.ts` (Task 4), `http-cards.test.ts` (Task 6)
- `apps/app/src/app/`: `activity.tsx` (Task 5)
- `apps/app/src/app/settings/`: `activity.tsx` (Task 5)
- `apps/app/src/components/activity/`: `FollowsEntry.tsx` (Task 5), `GettingStarted.tsx` (Task 5), `ModerationEntry.tsx` (Task 5), `PostEntry.tsx` (Task 5)
- `apps/app/src/lib/`: `activity-words.ts` (Task 5), `activity.ts` (Task 5), `avatar.ts` (Task 5)
- `apps/app/test/`: `activity.test.tsx` (Task 5), `avatar-picker.test.tsx` (Task 5)
- `infra/caddy/`: `robots.txt` (Task 6)
- `infra/caddy/lab/`: `README.md` (Task 6), `card-lab.mjs` (Task 6), `crawlers.json` (Task 6)
- `packages/contracts/src/`: `activity.ts` (Task 1), `mentions.ts` (Task 1)
- `packages/contracts/test/`: `activity.test.ts` (Task 1), `mentions.test.ts` (Task 1)
- `packages/db/migrations/`: `0049_activity.sql` (Task 1), `0050_post_options.sql` (Task 1), `0051_avatars.sql` (Task 3), `0052_avatar_kinds.sql` (Task 4), `0053_avatar_moderation.sql` (Task 4)
- `packages/db/migrations/meta/`: `0049_snapshot.json` (Task 1), `0050_snapshot.json` (Task 1), `0051_snapshot.json` (Task 3), `0052_snapshot.json` (Task 4), `0053_snapshot.json` (Task 4)
- `packages/db/src/schema/`: `activity.ts` (Task 1)

## Tasks

### Task 1: Contracts and the database for Activity and mentions: the contract modules activity.ts and mentions.ts, and the migrations 0049_activity and 0050_post_options.

**Prompt:** `docs/superpowers/prompts/engagement-2d/01-activity-mentions-schema.md`

**Files:**
- Create: `apps/api/test/integration/activity-schema.test.ts`
- Create: `packages/contracts/src/activity.ts`
- Create: `packages/contracts/src/mentions.ts`
- Create: `packages/contracts/test/activity.test.ts`
- Create: `packages/contracts/test/mentions.test.ts`
- Create: `packages/db/migrations/0049_activity.sql`
- Create: `packages/db/migrations/0050_post_options.sql`
- Create: `packages/db/migrations/meta/0049_snapshot.json`
- Create: `packages/db/migrations/meta/0050_snapshot.json`
- Create: `packages/db/src/schema/activity.ts`
- Modify: `apps/api/test/integration/import-schema.test.ts`
- Modify: `apps/api/test/integration/moderation-schema.test.ts`
- Modify: `apps/api/test/integration/standing-grants.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/db/migrations/meta/_journal.json`
- Modify: `packages/db/src/schema/content.ts`
- Modify: `packages/db/src/schema/identity.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/test/enum-literals.test.ts`
- Modify: `packages/db/test/schema.test.ts`

- [ ] **Step 1: Write the failing tests: `apps/api/test/integration/activity-schema.test.ts`, `packages/contracts/test/activity.test.ts`, `packages/contracts/test/mentions.test.ts`, `apps/api/test/integration/import-schema.test.ts`, `apps/api/test/integration/moderation-schema.test.ts`, `apps/api/test/integration/standing-grants.test.ts`, `packages/db/test/enum-literals.test.ts`, `packages/db/test/schema.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `packages/contracts/src/activity.ts`, `packages/contracts/src/mentions.ts`, `packages/db/migrations/0049_activity.sql`, `packages/db/migrations/0050_post_options.sql`, `packages/db/migrations/meta/0049_snapshot.json`, `packages/db/migrations/meta/0050_snapshot.json`, `packages/db/src/schema/activity.ts`, `packages/contracts/src/index.ts`, `packages/db/migrations/meta/_journal.json`, `packages/db/src/schema/content.ts`, `packages/db/src/schema/identity.ts`, `packages/db/src/schema/index.ts`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm -r --if-present run test --testTimeout=60000`, expecting `Tests  `**
- [ ] **Step 6: generate: run `pnpm --filter @korbat/db generate`, expecting `No schema changes`**
- [ ] **Step 7: apply-migrations: run the `apply-migrations` command in the prompt, expecting `migrations applied`, `count=51`**
- [ ] **Step 8: test-database: run `node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `migrations applied`, `test database ready: korbat_test`**
- [ ] **Step 9: integration-own: run the `integration-own` command in the prompt, expecting `Tests  `**
- [ ] **Step 10: api-bundle: run the `api-bundle` command in the prompt, expecting `Build success`, `bundle-ok`**
- [ ] **Step 11: Commit: `feat(db,contracts): Activity's and mentions' contracts and database: packages/contracts gains mentions.ts (MENTION_TOKEN with its right boundary, mentionHandles reading at most 40 distinct handles in text order, MENTION_STORE_MAX and MENTION_NOTIFY_MAX) and activity.ts (the kinds, reaches and numbers, ActivitySettings and its defaults, ActivityEntry's post, follows and moderation shapes, ActivityPage, the queries, SeenRequest, every time to the microsecond, and a cursor on (at, key) without Buffer); 0049_activity creates activity_kind and activity_reach whole and activity_items, activity_state and post_mentions with their CHECKs, keys and indexes, row level security and 6.6's grants (no UPDATE of an entry or a mention), activity_items_insert forcing the time, activity_state_guard moving the seen marker forward only and never past the clock, post_mentions_insert taking only a visible native post's row, post_mentions_erase, and lost_told_for for the API role alone; 0050_post_options adds posts.hide_counts and profiles.share_previews with their column grants; activity-schema.test.ts holds them, and the grant pins of three integration tests move`**

### Task 2: Mentions and Activity in the API: mentions stored and read, Activity entries written in the act's transaction under the recipient's rules and read with the moderation entries, the hide-counts and link-preview switches, and the export's and purge's parts for them.

**Prompt:** `docs/superpowers/prompts/engagement-2d/02-activity-mentions-api.md`

**Files:**
- Create: `apps/api/src/activity/flows.ts`
- Create: `apps/api/src/activity/index.ts`
- Create: `apps/api/src/activity/repo.ts`
- Create: `apps/api/src/activity/retention.ts`
- Create: `apps/api/test/integration/activity-harness.ts`
- Create: `apps/api/test/integration/activity-moderation.test.ts`
- Create: `apps/api/test/integration/activity-retention.test.ts`
- Create: `apps/api/test/integration/http-activity.test.ts`
- Create: `apps/api/test/integration/http-hide-counts.test.ts`
- Create: `apps/api/test/integration/mentions.test.ts`
- Modify: `apps/api/src/account/context.ts`
- Modify: `apps/api/src/account/flows/export.ts`
- Modify: `apps/api/src/account/index.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/moderation/author-repo.ts`
- Modify: `apps/api/src/moderation/author.ts`
- Modify: `apps/api/src/moderation/index.ts`
- Modify: `apps/api/src/moderation/release.ts`
- Modify: `apps/api/src/profiles/store.ts`
- Modify: `apps/api/src/social/flows/engagement.ts`
- Modify: `apps/api/src/social/flows/export.ts`
- Modify: `apps/api/src/social/flows/posts.ts`
- Modify: `apps/api/src/social/flows/profile-edit.ts`
- Modify: `apps/api/src/social/index.ts`
- Modify: `apps/api/src/social/repo.ts`
- Modify: `apps/api/src/social/routes.ts`
- Modify: `apps/api/src/social/tiers.ts`
- Modify: `apps/api/src/social/views.ts`
- Modify: `apps/api/test/account/export.test.ts`
- Modify: `apps/api/test/architecture.test.ts`
- Modify: `apps/api/test/auth/flow-harness.ts`
- Modify: `apps/api/test/integration/account-deletion.test.ts`
- Modify: `apps/api/test/integration/account-export.test.ts`
- Modify: `apps/api/test/integration/auth-flows-account.test.ts`
- Modify: `apps/api/test/integration/flow-harness.ts`
- Modify: `apps/api/test/integration/moderation-export.test.ts`
- Modify: `apps/api/test/integration/moderation-fixtures.ts`
- Modify: `apps/api/test/integration/social-flows-profile-edit.test.ts`
- Modify: `apps/api/test/integration/standing-route-walk.test.ts`
- Modify: `apps/api/test/moderation-author.test.ts`
- Modify: `apps/api/test/social/tiers.test.ts`
- Modify: `apps/app/src/components/social/PostCard.tsx`
- Modify: `apps/app/src/lib/post-actions.ts`
- Modify: `apps/app/test/browser/fixture-api.ts`
- Modify: `apps/app/test/cases.test.tsx`
- Modify: `apps/app/test/composer.test.tsx`
- Modify: `apps/app/test/explore.test.tsx`
- Modify: `apps/app/test/feed-cache.test.ts`
- Modify: `apps/app/test/feed-rows.test.ts`
- Modify: `apps/app/test/hidden-media.test.tsx`
- Modify: `apps/app/test/post-card.test.tsx`
- Modify: `apps/app/test/reach.test.ts`
- Modify: `apps/app/test/report.test.tsx`
- Modify: `apps/app/test/rich-text.test.tsx`
- Modify: `apps/app/test/standing.test.tsx`
- Modify: `apps/app/test/status-sheet.test.tsx`
- Modify: `packages/contracts/src/account.ts`
- Modify: `packages/contracts/src/auth.ts`
- Modify: `packages/contracts/src/social.ts`
- Modify: `packages/contracts/test/account.test.ts`
- Modify: `packages/contracts/test/activity.test.ts`
- Modify: `packages/contracts/test/auth.test.ts`
- Modify: `packages/contracts/test/author.test.ts`
- Modify: `packages/contracts/test/explore.test.ts`
- Modify: `packages/contracts/test/media.test.ts`
- Modify: `packages/contracts/test/social.test.ts`

- [ ] **Step 1: Write the failing tests: `apps/api/test/integration/activity-harness.ts`, `apps/api/test/integration/activity-moderation.test.ts`, `apps/api/test/integration/activity-retention.test.ts`, `apps/api/test/integration/http-activity.test.ts`, `apps/api/test/integration/http-hide-counts.test.ts`, `apps/api/test/integration/mentions.test.ts`, `apps/api/test/account/export.test.ts`, `apps/api/test/architecture.test.ts`, `apps/api/test/auth/flow-harness.ts`, `apps/api/test/integration/account-deletion.test.ts`, `apps/api/test/integration/account-export.test.ts`, `apps/api/test/integration/auth-flows-account.test.ts`, `apps/api/test/integration/flow-harness.ts`, `apps/api/test/integration/moderation-export.test.ts`, `apps/api/test/integration/moderation-fixtures.ts`, `apps/api/test/integration/social-flows-profile-edit.test.ts`, `apps/api/test/integration/standing-route-walk.test.ts`, `apps/api/test/moderation-author.test.ts`, `apps/api/test/social/tiers.test.ts`, `apps/app/test/browser/fixture-api.ts`, `apps/app/test/cases.test.tsx`, `apps/app/test/composer.test.tsx`, `apps/app/test/explore.test.tsx`, `apps/app/test/feed-cache.test.ts`, `apps/app/test/feed-rows.test.ts`, `apps/app/test/hidden-media.test.tsx`, `apps/app/test/post-card.test.tsx`, `apps/app/test/reach.test.ts`, `apps/app/test/report.test.tsx`, `apps/app/test/rich-text.test.tsx`, `apps/app/test/standing.test.tsx`, `apps/app/test/status-sheet.test.tsx`, `packages/contracts/test/account.test.ts`, `packages/contracts/test/activity.test.ts`, `packages/contracts/test/auth.test.ts`, `packages/contracts/test/author.test.ts`, `packages/contracts/test/explore.test.ts`, `packages/contracts/test/media.test.ts`, `packages/contracts/test/social.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/api/src/activity/flows.ts`, `apps/api/src/activity/index.ts`, `apps/api/src/activity/repo.ts`, `apps/api/src/activity/retention.ts`, `apps/api/src/account/context.ts`, `apps/api/src/account/flows/export.ts`, `apps/api/src/account/index.ts`, `apps/api/src/app.ts`, `apps/api/src/index.ts`, `apps/api/src/moderation/author-repo.ts`, `apps/api/src/moderation/author.ts`, `apps/api/src/moderation/index.ts`, `apps/api/src/moderation/release.ts`, `apps/api/src/profiles/store.ts`, `apps/api/src/social/flows/engagement.ts`, `apps/api/src/social/flows/export.ts`, `apps/api/src/social/flows/posts.ts`, `apps/api/src/social/flows/profile-edit.ts`, `apps/api/src/social/index.ts`, `apps/api/src/social/repo.ts`, `apps/api/src/social/routes.ts`, `apps/api/src/social/tiers.ts`, `apps/api/src/social/views.ts`, `apps/app/src/components/social/PostCard.tsx`, `apps/app/src/lib/post-actions.ts`, `packages/contracts/src/account.ts`, `packages/contracts/src/auth.ts`, `packages/contracts/src/social.ts`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm -r --if-present run test --testTimeout=60000`, expecting `Tests  `**
- [ ] **Step 6: export: run the `export` command in the prompt, expecting `Exported`**
- [ ] **Step 7: test-database-fresh: run `node scripts/test-db.mjs --fresh -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `test database ready: korbat_test`**
- [ ] **Step 8: integration-fresh: run the `integration-fresh` command in the prompt, expecting `Tests  `**
- [ ] **Step 9: test-database-upgrade: run `node scripts/test-db.mjs --upgrade-from 48 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `migrations up to 0048_import_staff_end applied and committed`, `later migrations applied as one batch`, `test database ready: korbat_test`**
- [ ] **Step 10: integration-upgraded: run the `integration-upgraded` command in the prompt, expecting `Tests  `**
- [ ] **Step 11: timing: run the `timing` command in the prompt, expecting `timing-ok=1`**
- [ ] **Step 12: api-bundle: run the `api-bundle` command in the prompt, expecting `Build success`, `bundle-ok`**
- [ ] **Step 13: Commit: `feat(api,contracts,app): mentions and Activity in the API: createPost stores the first 20 live handles its body names (one lookup FOR KEY SHARE in id order, one insert) and writes reply, quote and mention entries, follow a follow entry, by one statement under the recipient's rules (blocks, mutes, Everyone, older than 48 hours by now(), following, off, the follow switch); deletePost, block and the purge delete what they must; the activity module answers GET /api/activity with follows grouped by UTC day and moderation's authorActivity merged by (at, key), the newer count to 21, the seen marker and the settings, and runs activity-retention; PostView carries the reader's mentions and countsHidden, and likes and reposts are null for others when hidden, the engagement answer included; PATCH /api/posts/:id/counts and /api/me/share-previews; the export gains sharePreviews, mentions, countsHidden and activity with shown or why not; the architecture pins and the route walk`**

### Task 3: Avatar images: an upload of kind avatar made square by the worker, set and removed by its owner under 3e's predicate, served publicly while it is a live profile's visible picture, carried by every author, profile and /api/me, and known to the sweeper, the export and the purge.

**Prompt:** `docs/superpowers/prompts/engagement-2d/03-avatar-images.md`

**Files:**
- Create: `apps/api/test/integration/http-avatar.test.ts`
- Create: `packages/db/migrations/0051_avatars.sql`
- Create: `packages/db/migrations/meta/0051_snapshot.json`
- Modify: `apps/api/src/account/flows/export.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/auth/flows/account.ts`
- Modify: `apps/api/src/media/context.ts`
- Modify: `apps/api/src/media/files.ts`
- Modify: `apps/api/src/media/flows/serve.ts`
- Modify: `apps/api/src/media/flows/status.ts`
- Modify: `apps/api/src/media/flows/upload.ts`
- Modify: `apps/api/src/media/index.ts`
- Modify: `apps/api/src/media/match.ts`
- Modify: `apps/api/src/media/repo.ts`
- Modify: `apps/api/src/media/routes.ts`
- Modify: `apps/api/src/media/sweeper.ts`
- Modify: `apps/api/src/social/context.ts`
- Modify: `apps/api/src/social/flows/graph.ts`
- Modify: `apps/api/src/social/flows/profile-edit.ts`
- Modify: `apps/api/src/social/flows/profiles.ts`
- Modify: `apps/api/src/social/index.ts`
- Modify: `apps/api/src/social/repo.ts`
- Modify: `apps/api/src/social/routes.ts`
- Modify: `apps/api/src/social/views.ts`
- Modify: `apps/api/test/account/deletion.test.ts`
- Modify: `apps/api/test/account/export.test.ts`
- Modify: `apps/api/test/architecture.test.ts`
- Modify: `apps/api/test/integration/account-deletion.test.ts`
- Modify: `apps/api/test/integration/account-export.test.ts`
- Modify: `apps/api/test/integration/account-takedown.test.ts`
- Modify: `apps/api/test/integration/activity-harness.ts`
- Modify: `apps/api/test/integration/activity-schema.test.ts`
- Modify: `apps/api/test/integration/http-explore.test.ts`
- Modify: `apps/api/test/integration/media-cases.test.ts`
- Modify: `apps/api/test/integration/media-flows.test.ts`
- Modify: `apps/api/test/integration/media-gates.test.ts`
- Modify: `apps/api/test/integration/media-harness.ts`
- Modify: `apps/api/test/integration/media-sweeper.test.ts`
- Modify: `apps/api/test/integration/moderation-author.test.ts`
- Modify: `apps/api/test/integration/moderation-export.test.ts`
- Modify: `apps/api/test/integration/moderation-schema.test.ts`
- Modify: `apps/api/test/integration/release-flow.test.ts`
- Modify: `apps/api/test/integration/social-flows-posts.test.ts`
- Modify: `apps/api/test/integration/social-media.test.ts`
- Modify: `apps/api/test/integration/standing-grants.test.ts`
- Modify: `apps/api/test/integration/standing-route-walk.test.ts`
- Modify: `apps/api/test/lab/standing.lab.ts`
- Modify: `apps/api/test/media/files.test.ts`
- Modify: `apps/api/test/moderation-author.test.ts`
- Modify: `apps/app/test/browser/fixture-api.ts`
- Modify: `apps/app/test/cases.test.tsx`
- Modify: `apps/app/test/composer.test.tsx`
- Modify: `apps/app/test/explore.test.tsx`
- Modify: `apps/app/test/feed-cache.test.ts`
- Modify: `apps/app/test/feed-rows.test.ts`
- Modify: `apps/app/test/hidden-media.test.tsx`
- Modify: `apps/app/test/passkeys.test.tsx`
- Modify: `apps/app/test/post-card.test.tsx`
- Modify: `apps/app/test/reach.test.ts`
- Modify: `apps/app/test/report.test.tsx`
- Modify: `apps/app/test/rich-text.test.tsx`
- Modify: `apps/app/test/standing.test.tsx`
- Modify: `apps/app/test/status-sheet.test.tsx`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/src/loop.ts`
- Modify: `apps/worker/src/pipeline.ts`
- Modify: `apps/worker/test/fixtures.ts`
- Modify: `apps/worker/test/loop.test.ts`
- Modify: `apps/worker/test/pipeline.test.ts`
- Modify: `packages/contracts/src/account.ts`
- Modify: `packages/contracts/src/auth.ts`
- Modify: `packages/contracts/src/media.ts`
- Modify: `packages/contracts/src/social.ts`
- Modify: `packages/contracts/test/account.test.ts`
- Modify: `packages/contracts/test/activity.test.ts`
- Modify: `packages/contracts/test/auth.test.ts`
- Modify: `packages/contracts/test/author.test.ts`
- Modify: `packages/contracts/test/explore.test.ts`
- Modify: `packages/contracts/test/media.test.ts`
- Modify: `packages/contracts/test/social.test.ts`
- Modify: `packages/contracts/test/standing.test.ts`
- Modify: `packages/db/migrations/meta/_journal.json`
- Modify: `packages/db/src/schema/content.ts`
- Modify: `packages/db/src/schema/identity.ts`
- Modify: `packages/db/test/enum-literals.test.ts`
- Modify: `packages/db/test/schema.test.ts`
- Modify: `packages/media-protocol/src/layout.ts`
- Modify: `packages/media-protocol/src/limits.ts`
- Modify: `packages/media-protocol/src/result.ts`
- Modify: `packages/media-protocol/test/protocol.test.ts`
- Modify: `scripts/smoke-auth-stack.mjs`

- [ ] **Step 1: Write the failing tests: `apps/api/test/integration/http-avatar.test.ts`, `apps/api/test/account/deletion.test.ts`, `apps/api/test/account/export.test.ts`, `apps/api/test/architecture.test.ts`, `apps/api/test/integration/account-deletion.test.ts`, `apps/api/test/integration/account-export.test.ts`, `apps/api/test/integration/account-takedown.test.ts`, `apps/api/test/integration/activity-harness.ts`, `apps/api/test/integration/activity-schema.test.ts`, `apps/api/test/integration/http-explore.test.ts`, `apps/api/test/integration/media-cases.test.ts`, `apps/api/test/integration/media-flows.test.ts`, `apps/api/test/integration/media-gates.test.ts`, `apps/api/test/integration/media-harness.ts`, `apps/api/test/integration/media-sweeper.test.ts`, `apps/api/test/integration/moderation-author.test.ts`, `apps/api/test/integration/moderation-export.test.ts`, `apps/api/test/integration/moderation-schema.test.ts`, `apps/api/test/integration/release-flow.test.ts`, `apps/api/test/integration/social-flows-posts.test.ts`, `apps/api/test/integration/social-media.test.ts`, `apps/api/test/integration/standing-grants.test.ts`, `apps/api/test/integration/standing-route-walk.test.ts`, `apps/api/test/lab/standing.lab.ts`, `apps/api/test/media/files.test.ts`, `apps/api/test/moderation-author.test.ts`, `apps/app/test/browser/fixture-api.ts`, `apps/app/test/cases.test.tsx`, `apps/app/test/composer.test.tsx`, `apps/app/test/explore.test.tsx`, `apps/app/test/feed-cache.test.ts`, `apps/app/test/feed-rows.test.ts`, `apps/app/test/hidden-media.test.tsx`, `apps/app/test/passkeys.test.tsx`, `apps/app/test/post-card.test.tsx`, `apps/app/test/reach.test.ts`, `apps/app/test/report.test.tsx`, `apps/app/test/rich-text.test.tsx`, `apps/app/test/standing.test.tsx`, `apps/app/test/status-sheet.test.tsx`, `apps/worker/test/fixtures.ts`, `apps/worker/test/loop.test.ts`, `apps/worker/test/pipeline.test.ts`, `packages/contracts/test/account.test.ts`, `packages/contracts/test/activity.test.ts`, `packages/contracts/test/auth.test.ts`, `packages/contracts/test/author.test.ts`, `packages/contracts/test/explore.test.ts`, `packages/contracts/test/media.test.ts`, `packages/contracts/test/social.test.ts`, `packages/contracts/test/standing.test.ts`, `packages/db/test/enum-literals.test.ts`, `packages/db/test/schema.test.ts`, `packages/media-protocol/test/protocol.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `packages/db/migrations/0051_avatars.sql`, `packages/db/migrations/meta/0051_snapshot.json`, `apps/api/src/account/flows/export.ts`, `apps/api/src/app.ts`, `apps/api/src/auth/flows/account.ts`, `apps/api/src/media/context.ts`, `apps/api/src/media/files.ts`, `apps/api/src/media/flows/serve.ts`, `apps/api/src/media/flows/status.ts`, `apps/api/src/media/flows/upload.ts`, `apps/api/src/media/index.ts`, `apps/api/src/media/match.ts`, `apps/api/src/media/repo.ts`, `apps/api/src/media/routes.ts`, `apps/api/src/media/sweeper.ts`, `apps/api/src/social/context.ts`, `apps/api/src/social/flows/graph.ts`, `apps/api/src/social/flows/profile-edit.ts`, `apps/api/src/social/flows/profiles.ts`, `apps/api/src/social/index.ts`, `apps/api/src/social/repo.ts`, `apps/api/src/social/routes.ts`, `apps/api/src/social/views.ts`, `apps/worker/src/index.ts`, `apps/worker/src/loop.ts`, `apps/worker/src/pipeline.ts`, `packages/contracts/src/account.ts`, `packages/contracts/src/auth.ts`, `packages/contracts/src/media.ts`, `packages/contracts/src/social.ts`, `packages/db/migrations/meta/_journal.json`, `packages/db/src/schema/content.ts`, `packages/db/src/schema/identity.ts`, `packages/media-protocol/src/layout.ts`, `packages/media-protocol/src/limits.ts`, `packages/media-protocol/src/result.ts`, `scripts/smoke-auth-stack.mjs`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm -r --if-present run test --testTimeout=60000`, expecting `Tests  `**
- [ ] **Step 6: generate: run `pnpm --filter @korbat/db generate`, expecting `No schema changes`**
- [ ] **Step 7: apply-migrations: run the `apply-migrations` command in the prompt, expecting `migrations applied`, `count=52`**
- [ ] **Step 8: export: run the `export` command in the prompt, expecting `Exported`**
- [ ] **Step 9: test-database-fresh: run `node scripts/test-db.mjs --fresh -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `test database ready: korbat_test`**
- [ ] **Step 10: integration-fresh: run the `integration-fresh` command in the prompt, expecting `Tests  `**
- [ ] **Step 11: test-database-upgrade: run `node scripts/test-db.mjs --upgrade-from 48 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `migrations up to 0048_import_staff_end applied and committed`, `later migrations applied as one batch`, `test database ready: korbat_test`**
- [ ] **Step 12: integration-upgraded: run the `integration-upgraded` command in the prompt, expecting `Tests  `**
- [ ] **Step 13: timing: run the `timing` command in the prompt, expecting `timing-ok=1`**
- [ ] **Step 14: api-bundle: run the `api-bundle` command in the prompt, expecting `Build success`, `bundle-ok`**
- [ ] **Step 15: stack-down: run `docker compose -f infra/compose.yml -f infra/compose.dev.yml down && echo down-ok`, expecting `down-ok`**
- [ ] **Step 16: build: run the `build` command in the prompt, expecting `build-exit=0`**
- [ ] **Step 17: stack-up: run `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --wait && echo up-ok`, expecting `up-ok`**
- [ ] **Step 18: test-database: run `node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `migrations applied`, `test database ready: korbat_test`**
- [ ] **Step 19: smoke: run the `smoke` command in the prompt, expecting `smoke test passed`**
- [ ] **Step 20: stack-stop: run the `stack-stop` command in the prompt, expecting `postgres-1 Up`**
- [ ] **Step 21: Commit: `feat(db,contracts,worker,api,app): avatar images: 0051_avatars adds media_kind and post_media's kind, profile_id and avatar_sha256 with their CHECKs, one avatar a profile, post_media_avatar_guard and account_frozen, replaces post_media_insert, _refused, _keep and _purge, and drops profiles.avatar_path; POST /api/media?kind=avatar&crop= keeps the file's SHA-256 and writes incoming/<id>.avatar before the upload; the worker cuts the square at the start, centre or end, writes 400 and 128 px squares, scores the 400 and marks result version 3; PUT and DELETE /api/me/avatar set and remove it in one transaction, the old row deleted after the commit unless kept; avatarsOf gives every Author, ProfileView and /api/me its avatar in one statement a page; serve shows a live profile's visible avatar publicly; the sweeper, the export and the purge know avatars; the smoke test sets one through the real worker`**

### Task 4: Moderation of avatars: the measure reset_avatar and its reversal restore_avatar on an account case, an account's report holding its picture, an account case's seal reaching its avatars through 3d's quarantine and release, 3d's checks of a picture opening a finding and never a measure with R1's hold for review, and every list of the measures naming the new kind.

**Prompt:** `docs/superpowers/prompts/engagement-2d/04-avatar-moderation.md`

**Files:**
- Create: `apps/api/test/integration/automation-avatar.test.ts`
- Create: `apps/api/test/integration/avatar-moderation.test.ts`
- Create: `apps/api/test/measure-lists.test.ts`
- Create: `packages/db/migrations/0052_avatar_kinds.sql`
- Create: `packages/db/migrations/0053_avatar_moderation.sql`
- Create: `packages/db/migrations/meta/0052_snapshot.json`
- Create: `packages/db/migrations/meta/0053_snapshot.json`
- Modify: `apps/admin/src/compose.ts`
- Modify: `apps/admin/src/screens/Case.tsx`
- Modify: `apps/admin/test/cases.test.tsx`
- Modify: `apps/admin/test/composer.test.tsx`
- Modify: `apps/admin/test/handles.test.tsx`
- Modify: `apps/api/src/cli/custody.ts`
- Modify: `apps/api/src/cli/records.ts`
- Modify: `apps/api/src/media/cases.ts`
- Modify: `apps/api/src/media/context.ts`
- Modify: `apps/api/src/media/flows/serve.ts`
- Modify: `apps/api/src/media/index.ts`
- Modify: `apps/api/src/media/repo.ts`
- Modify: `apps/api/src/moderation/author-repo.ts`
- Modify: `apps/api/src/moderation/automated.ts`
- Modify: `apps/api/src/moderation/cases.ts`
- Modify: `apps/api/src/moderation/decide.ts`
- Modify: `apps/api/src/moderation/index.ts`
- Modify: `apps/api/src/moderation/intake.ts`
- Modify: `apps/api/src/moderation/repo.ts`
- Modify: `apps/api/src/moderation/statement-repo.ts`
- Modify: `apps/api/src/moderation/statement.ts`
- Modify: `apps/api/src/social/flows/profile-edit.ts`
- Modify: `apps/api/test/integration/activity-schema.test.ts`
- Modify: `apps/api/test/integration/import-schema.test.ts`
- Modify: `apps/api/test/integration/media-cases.test.ts`
- Modify: `apps/api/test/integration/media-edge-outbox.test.ts`
- Modify: `apps/api/test/integration/media-gates.test.ts`
- Modify: `apps/api/test/integration/moderation-fixtures.ts`
- Modify: `apps/api/test/integration/moderation-schema.test.ts`
- Modify: `apps/api/test/integration/standing-handles.test.ts`
- Modify: `apps/api/test/integration/standing-ledger.test.ts`
- Modify: `apps/api/test/moderation-author.test.ts`
- Modify: `apps/api/test/moderation-intake-order.test.ts`
- Modify: `apps/app/src/components/moderation/DecisionDetail.tsx`
- Modify: `apps/app/src/components/moderation/StatusSheet.tsx`
- Modify: `apps/app/src/lib/moderation-words.ts`
- Modify: `apps/app/src/lib/terms.ts`
- Modify: `apps/app/test/cases.test.tsx`
- Modify: `apps/app/test/status-sheet.test.tsx`
- Modify: `apps/app/test/terms.test.tsx`
- Modify: `packages/contracts/src/media.ts`
- Modify: `packages/contracts/src/moderation.ts`
- Modify: `packages/contracts/test/media.test.ts`
- Modify: `packages/contracts/test/moderation.test.ts`
- Modify: `packages/db/migrations/meta/_journal.json`
- Modify: `packages/db/src/schema/moderation.ts`
- Modify: `packages/db/test/enum-literals.test.ts`
- Modify: `packages/db/test/schema.test.ts`
- Modify: `packages/rules/src/statement.ts`
- Modify: `packages/rules/test/statement.test.ts`

- [ ] **Step 1: Write the failing tests: `apps/api/test/integration/automation-avatar.test.ts`, `apps/api/test/integration/avatar-moderation.test.ts`, `apps/api/test/measure-lists.test.ts`, `apps/admin/test/cases.test.tsx`, `apps/admin/test/composer.test.tsx`, `apps/admin/test/handles.test.tsx`, `apps/api/test/integration/activity-schema.test.ts`, `apps/api/test/integration/import-schema.test.ts`, `apps/api/test/integration/media-cases.test.ts`, `apps/api/test/integration/media-edge-outbox.test.ts`, `apps/api/test/integration/media-gates.test.ts`, `apps/api/test/integration/moderation-fixtures.ts`, `apps/api/test/integration/moderation-schema.test.ts`, `apps/api/test/integration/standing-handles.test.ts`, `apps/api/test/integration/standing-ledger.test.ts`, `apps/api/test/moderation-author.test.ts`, `apps/api/test/moderation-intake-order.test.ts`, `apps/app/test/cases.test.tsx`, `apps/app/test/status-sheet.test.tsx`, `apps/app/test/terms.test.tsx`, `packages/contracts/test/media.test.ts`, `packages/contracts/test/moderation.test.ts`, `packages/db/test/enum-literals.test.ts`, `packages/db/test/schema.test.ts`, `packages/rules/test/statement.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `packages/db/migrations/0052_avatar_kinds.sql`, `packages/db/migrations/0053_avatar_moderation.sql`, `packages/db/migrations/meta/0052_snapshot.json`, `packages/db/migrations/meta/0053_snapshot.json`, `apps/admin/src/compose.ts`, `apps/admin/src/screens/Case.tsx`, `apps/api/src/cli/custody.ts`, `apps/api/src/cli/records.ts`, `apps/api/src/media/cases.ts`, `apps/api/src/media/context.ts`, `apps/api/src/media/flows/serve.ts`, `apps/api/src/media/index.ts`, `apps/api/src/media/repo.ts`, `apps/api/src/moderation/author-repo.ts`, `apps/api/src/moderation/automated.ts`, `apps/api/src/moderation/cases.ts`, `apps/api/src/moderation/decide.ts`, `apps/api/src/moderation/index.ts`, `apps/api/src/moderation/intake.ts`, `apps/api/src/moderation/repo.ts`, `apps/api/src/moderation/statement-repo.ts`, `apps/api/src/moderation/statement.ts`, `apps/api/src/social/flows/profile-edit.ts`, `apps/app/src/components/moderation/DecisionDetail.tsx`, `apps/app/src/components/moderation/StatusSheet.tsx`, `apps/app/src/lib/moderation-words.ts`, `apps/app/src/lib/terms.ts`, `packages/contracts/src/media.ts`, `packages/contracts/src/moderation.ts`, `packages/db/migrations/meta/_journal.json`, `packages/db/src/schema/moderation.ts`, `packages/rules/src/statement.ts`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm -r --if-present run test --testTimeout=60000`, expecting `Tests  `**
- [ ] **Step 6: generate: run `pnpm --filter @korbat/db generate`, expecting `No schema changes`**
- [ ] **Step 7: apply-migrations: run the `apply-migrations` command in the prompt, expecting `migrations applied`, `count=54`**
- [ ] **Step 8: admin-build: run `pnpm --filter @korbat/admin build 2>&1 | tail -2 && ls apps/admin/dist apps/admin/dist/assets | sed -E 's/-[A-Z0-9]{8}[.]/-HASH./'`, expecting `Build success`, `index.html`, `main-HASH.js`, `main-HASH.css`**
- [ ] **Step 9: admin-browser: run `pnpm --filter @korbat/admin test:browser`, expecting `Tests  79 passed (79)`**
- [ ] **Step 10: export: run the `export` command in the prompt, expecting `Exported`**
- [ ] **Step 11: test-database-fresh: run `node scripts/test-db.mjs --fresh -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `test database ready: korbat_test`**
- [ ] **Step 12: integration-fresh: run the `integration-fresh` command in the prompt, expecting `Tests  `**
- [ ] **Step 13: test-database-upgrade: run `node scripts/test-db.mjs --upgrade-from 48 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `migrations up to 0048_import_staff_end applied and committed`, `later migrations applied as one batch`, `test database ready: korbat_test`**
- [ ] **Step 14: integration-upgraded: run the `integration-upgraded` command in the prompt, expecting `Tests  `**
- [ ] **Step 15: timing: run the `timing` command in the prompt, expecting `timing-ok=1`**
- [ ] **Step 16: api-bundle: run the `api-bundle` command in the prompt, expecting `Build success`, `bundle-ok`**
- [ ] **Step 17: Commit: `feat(db,contracts,api,rules,app,admin): moderation of avatars: 0052_avatar_kinds adds reset_avatar and restore_avatar alone; 0053_avatar_moderation adds seal_avatars, avatar_reviews, avatar_resets and releases.avatar_ids, avatar_sealed, avatar_apply and avatar_review, and replaces the keep and purge triggers, decision_actions_check and _apply (a compare-and-set reset keeping the picture's hash 30 days, an account seal listing its avatars), decisions_apply, the release, the quarantine's plan and every list of the measures, the new kinds literals only in PL/pgSQL bodies; an account's report holds its picture by reference; setAvatar refuses a reset picture (avatar_reset) and starts moderation.avatarSet, whose step opens a finding on the account's case and never a measure, and with AUTOMATION_R1_ACTS on withholds an R1 picture from all but its owner until a person answers; the staff reader and the console show an account's picture, a placeholder under a freeze; the statement, status sheet, terms and composer know the reset`**

### Task 5: The app's side of engagement: the nav's Activity item and the Activity screen with its tabs, headings, pill and seen marker, stored mentions as links and the composer's mentions line, avatars drawn everywhere and the picker on Settings, Profile, hide counts in the composer and the More menu, the Getting started panel on an empty Following, Settings, Activity and Privacy's Link previews, and the browser check's steps 52 to 57.

**Prompt:** `docs/superpowers/prompts/engagement-2d/05-engagement-app.md`

**Files:**
- Create: `apps/app/src/app/activity.tsx`
- Create: `apps/app/src/app/settings/activity.tsx`
- Create: `apps/app/src/components/activity/FollowsEntry.tsx`
- Create: `apps/app/src/components/activity/GettingStarted.tsx`
- Create: `apps/app/src/components/activity/ModerationEntry.tsx`
- Create: `apps/app/src/components/activity/PostEntry.tsx`
- Create: `apps/app/src/lib/activity-words.ts`
- Create: `apps/app/src/lib/activity.ts`
- Create: `apps/app/src/lib/avatar.ts`
- Create: `apps/app/test/activity.test.tsx`
- Create: `apps/app/test/avatar-picker.test.tsx`
- Modify: `README.md`
- Modify: `apps/app/src/app/settings/index.tsx`
- Modify: `apps/app/src/app/settings/privacy.tsx`
- Modify: `apps/app/src/app/settings/profile.tsx`
- Modify: `apps/app/src/app/u/[handle]/index.tsx`
- Modify: `apps/app/src/components/AppShell.tsx`
- Modify: `apps/app/src/components/SettingsNav.tsx`
- Modify: `apps/app/src/components/icons.ts`
- Modify: `apps/app/src/components/import/ImportProgress.tsx`
- Modify: `apps/app/src/components/kit/Avatar.tsx`
- Modify: `apps/app/src/components/kit/Icon.tsx`
- Modify: `apps/app/src/components/kit/Icon.web.tsx`
- Modify: `apps/app/src/components/social/Composer.tsx`
- Modify: `apps/app/src/components/social/FeedList.tsx`
- Modify: `apps/app/src/components/social/NewPostsPill.tsx`
- Modify: `apps/app/src/components/social/PostCard.tsx`
- Modify: `apps/app/src/components/social/PostMenu.tsx`
- Modify: `apps/app/src/components/social/ProfileList.tsx`
- Modify: `apps/app/src/components/social/RichText.tsx`
- Modify: `apps/app/src/components/social/composer/ComposerCard.tsx`
- Modify: `apps/app/src/lib/pick-images.ts`
- Modify: `apps/app/src/lib/post-actions.ts`
- Modify: `apps/app/src/lib/reach.ts`
- Modify: `apps/app/src/lib/settings-words.ts`
- Modify: `apps/app/src/lib/social.ts`
- Modify: `apps/app/src/lib/ui-words.ts`
- Modify: `apps/app/test/a11y.test.tsx`
- Modify: `apps/app/test/appearance-page.test.tsx`
- Modify: `apps/app/test/browser/app.browser.ts`
- Modify: `apps/app/test/browser/fixture-api.ts`
- Modify: `apps/app/test/cases.test.tsx`
- Modify: `apps/app/test/composer.test.tsx`
- Modify: `apps/app/test/explore.test.tsx`
- Modify: `apps/app/test/kit.test.tsx`
- Modify: `apps/app/test/lifecycle.test.tsx`
- Modify: `apps/app/test/post-card.test.tsx`
- Modify: `apps/app/test/rich-text.test.tsx`
- Modify: `apps/app/test/shell.test.tsx`
- Modify: `apps/app/test/standing.test.tsx`
- Modify: `apps/app/test/theme.test.ts`

- [ ] **Step 1: Write the failing tests: `apps/app/test/activity.test.tsx`, `apps/app/test/avatar-picker.test.tsx`, `apps/app/test/a11y.test.tsx`, `apps/app/test/appearance-page.test.tsx`, `apps/app/test/browser/app.browser.ts`, `apps/app/test/browser/fixture-api.ts`, `apps/app/test/cases.test.tsx`, `apps/app/test/composer.test.tsx`, `apps/app/test/explore.test.tsx`, `apps/app/test/kit.test.tsx`, `apps/app/test/lifecycle.test.tsx`, `apps/app/test/post-card.test.tsx`, `apps/app/test/rich-text.test.tsx`, `apps/app/test/shell.test.tsx`, `apps/app/test/standing.test.tsx`, `apps/app/test/theme.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/app/src/app/activity.tsx`, `apps/app/src/app/settings/activity.tsx`, `apps/app/src/components/activity/FollowsEntry.tsx`, `apps/app/src/components/activity/GettingStarted.tsx`, `apps/app/src/components/activity/ModerationEntry.tsx`, `apps/app/src/components/activity/PostEntry.tsx`, `apps/app/src/lib/activity-words.ts`, `apps/app/src/lib/activity.ts`, `apps/app/src/lib/avatar.ts`, `README.md`, `apps/app/src/app/settings/index.tsx`, `apps/app/src/app/settings/privacy.tsx`, `apps/app/src/app/settings/profile.tsx`, `apps/app/src/app/u/[handle]/index.tsx`, `apps/app/src/components/AppShell.tsx`, `apps/app/src/components/SettingsNav.tsx`, `apps/app/src/components/icons.ts`, `apps/app/src/components/import/ImportProgress.tsx`, `apps/app/src/components/kit/Avatar.tsx`, `apps/app/src/components/kit/Icon.tsx`, `apps/app/src/components/kit/Icon.web.tsx`, `apps/app/src/components/social/Composer.tsx`, `apps/app/src/components/social/FeedList.tsx`, `apps/app/src/components/social/NewPostsPill.tsx`, `apps/app/src/components/social/PostCard.tsx`, `apps/app/src/components/social/PostMenu.tsx`, `apps/app/src/components/social/ProfileList.tsx`, `apps/app/src/components/social/RichText.tsx`, `apps/app/src/components/social/composer/ComposerCard.tsx`, `apps/app/src/lib/pick-images.ts`, `apps/app/src/lib/post-actions.ts`, `apps/app/src/lib/reach.ts`, `apps/app/src/lib/settings-words.ts`, `apps/app/src/lib/social.ts`, `apps/app/src/lib/ui-words.ts`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm -r --if-present run test --testTimeout=60000`, expecting `Tests  `**
- [ ] **Step 6: export: run the `export` command in the prompt, expecting `Exported`**
- [ ] **Step 7: app-browser: run `pnpm --filter @korbat/app test:browser`, expecting `Tests  57 passed (57)`**
- [ ] **Step 8: Commit: `feat(app): Activity and the rest of engagement in the app: the nav gains Activity second (Bell), four items on a phone, whose Settings is the profile's button; /activity with All and Conversations in the address, entries as named articles, New since you last looked and Earlier, the seen marker, the pill after 30 s, focus after it and Load more; RichText links stored mentions only, the composer says who is told; Avatar draws src; the picker on Settings, Profile with Top, Middle and Bottom, the status line, refused, failed and reset lines and the removal's question; hide counts in the composer and the More menu; Getting started on an empty Following; Settings, Activity saves a settled choice once; Privacy's Link previews; steps 52 to 57`**

### Task 6: Share cards, indexing and the terms: the API's card routes and head block, Caddy's /post/* and /u/* serving card.html through templates, robots.txt and X-Robots-Tag, the card lab, and the privacy text's four drafts.

**Prompt:** `docs/superpowers/prompts/engagement-2d/06-share-cards-indexing-terms.md`

**Files:**
- Create: `apps/api/src/cards/build.ts`
- Create: `apps/api/src/cards/index.ts`
- Create: `apps/api/src/cards/words.ts`
- Create: `apps/api/test/cards.test.ts`
- Create: `apps/api/test/integration/http-cards.test.ts`
- Create: `infra/caddy/lab/README.md`
- Create: `infra/caddy/lab/card-lab.mjs`
- Create: `infra/caddy/lab/crawlers.json`
- Create: `infra/caddy/robots.txt`
- Modify: `apps/admin/test/console-site.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/middleware/security-headers.ts`
- Modify: `apps/api/src/social/index.ts`
- Modify: `apps/api/src/social/repo.ts`
- Modify: `apps/api/test/architecture.test.ts`
- Modify: `apps/api/test/middleware.test.ts`
- Modify: `apps/api/test/transparency/route-table.test.ts`
- Modify: `apps/app/src/lib/terms.ts`
- Modify: `apps/app/test/browser/app.browser.ts`
- Modify: `apps/app/test/browser/caddyfile.ts`
- Modify: `apps/app/test/browser/fixture-api.ts`
- Modify: `apps/app/test/browser/server.ts`
- Modify: `apps/app/test/terms.test.tsx`
- Modify: `infra/caddy/Caddyfile`
- Modify: `infra/caddy/Dockerfile`
- Modify: `scripts/smoke-auth-stack.mjs`

- [ ] **Step 1: Write the failing tests: `apps/api/test/cards.test.ts`, `apps/api/test/integration/http-cards.test.ts`, `apps/admin/test/console-site.test.ts`, `apps/api/test/architecture.test.ts`, `apps/api/test/middleware.test.ts`, `apps/api/test/transparency/route-table.test.ts`, `apps/app/test/browser/app.browser.ts`, `apps/app/test/browser/caddyfile.ts`, `apps/app/test/browser/fixture-api.ts`, `apps/app/test/browser/server.ts`, `apps/app/test/terms.test.tsx`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/api/src/cards/build.ts`, `apps/api/src/cards/index.ts`, `apps/api/src/cards/words.ts`, `infra/caddy/lab/README.md`, `infra/caddy/lab/card-lab.mjs`, `infra/caddy/lab/crawlers.json`, `infra/caddy/robots.txt`, `apps/api/src/app.ts`, `apps/api/src/index.ts`, `apps/api/src/middleware/security-headers.ts`, `apps/api/src/social/index.ts`, `apps/api/src/social/repo.ts`, `apps/app/src/lib/terms.ts`, `infra/caddy/Caddyfile`, `infra/caddy/Dockerfile`, `scripts/smoke-auth-stack.mjs`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm -r --if-present run test --testTimeout=60000`, expecting `Tests  `**
- [ ] **Step 6: admin-build: run `pnpm --filter @korbat/admin build 2>&1 | tail -2 && ls apps/admin/dist apps/admin/dist/assets | sed -E 's/-[A-Z0-9]{8}[.]/-HASH./'`, expecting `Build success`, `index.html`, `main-HASH.js`, `main-HASH.css`**
- [ ] **Step 7: admin-browser: run `pnpm --filter @korbat/admin test:browser`, expecting `Tests  79 passed (79)`**
- [ ] **Step 8: export: run the `export` command in the prompt, expecting `Exported`**
- [ ] **Step 9: app-browser: run `pnpm --filter @korbat/app test:browser`, expecting `Tests  57 passed (57)`**
- [ ] **Step 10: test-database-fresh: run `node scripts/test-db.mjs --fresh -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `test database ready: korbat_test`**
- [ ] **Step 11: integration-fresh: run the `integration-fresh` command in the prompt, expecting `Tests  `**
- [ ] **Step 12: test-database-upgrade: run `node scripts/test-db.mjs --upgrade-from 48 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `migrations up to 0048_import_staff_end applied and committed`, `later migrations applied as one batch`, `test database ready: korbat_test`**
- [ ] **Step 13: integration-upgraded: run the `integration-upgraded` command in the prompt, expecting `Tests  `**
- [ ] **Step 14: timing: run the `timing` command in the prompt, expecting `timing-ok=1`**
- [ ] **Step 15: api-bundle: run the `api-bundle` command in the prompt, expecting `Build success`, `bundle-ok`**
- [ ] **Step 16: stack-down: run `docker compose -f infra/compose.yml -f infra/compose.dev.yml down && echo down-ok`, expecting `down-ok`**
- [ ] **Step 17: build: run the `build` command in the prompt, expecting `build-exit=0`**
- [ ] **Step 18: stack-up: run `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --wait && echo up-ok`, expecting `up-ok`**
- [ ] **Step 19: test-database: run `node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `migrations applied`, `test database ready: korbat_test`**
- [ ] **Step 20: smoke: run the `smoke` command in the prompt, expecting `smoke test passed`**
- [ ] **Step 21: stack-stop: run the `stack-stop` command in the prompt, expecting `postgres-1 Up`**
- [ ] **Step 22: Commit: `feat(api,app,admin,infra,scripts): share cards, indexing and the terms: the cards module answers GET /api/cards/post/:id and /api/cards/profile/:handle beside the status route, after the global limit and before the session, 204 with the head block in Korbat-Card or 404 with no body, from the signed-out reads and the owner's link-preview switch (the social module's forCards and sharePreviewsOf); cardBlock writes 8.3's tags in order, every value escaped with the template delimiters as character references, a generic card while previews are off, the image's description cut last to keep 4,096 bytes; X-Robots-Tag noindex on every API answer; Caddy's /post/* and new /u/* ask the card route without Range and serve card.html through templates for 204, the plain shell with 404 or 200 otherwise, noindex on every page that can name an account, /card.html 404; the image writes card.html and copies robots.txt; the card lab and crawlers.json; the Caddyfile's readers learn /u/*; the terms' four drafts by ACTIVITY_KEEP_DAYS; smoke step 23`**

### Task 7: The record of engagement: the README's Activity, Share cards and search engines, Profile pictures, budget, upgrade notes and counsel's six questions, the lines 2d made false corrected, the main design's row 2d and dated section 9 entry, and the UI design's 2d line marked delivered.

**Prompt:** `docs/superpowers/prompts/engagement-2d/07-engagement-record.md`

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-09-03-korbat-design.md`
- Modify: `docs/superpowers/specs/2026-10-21-interface-experience-ui-design.md`
- Modify: `docs/superpowers/specs/2026-10-22-engagement-2d-design.md`

- [ ] **Step 1: Write the files: `README.md`, `docs/superpowers/specs/2026-09-03-korbat-design.md`, `docs/superpowers/specs/2026-10-21-interface-experience-ui-design.md`, `docs/superpowers/specs/2026-10-22-engagement-2d-design.md`**
- [ ] **Step 2: typecheck: run `pnpm typecheck`**
- [ ] **Step 3: test: run `pnpm -r --if-present run test --testTimeout=60000`, expecting `Tests  `**
- [ ] **Step 4: test-database-fresh: run `node scripts/test-db.mjs --fresh -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `test database ready: korbat_test`**
- [ ] **Step 5: integration-fresh: run the `integration-fresh` command in the prompt, expecting `Tests  `**
- [ ] **Step 6: test-database-upgrade: run `node scripts/test-db.mjs --upgrade-from 48 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `migrations up to 0048_import_staff_end applied and committed`, `later migrations applied as one batch`, `test database ready: korbat_test`**
- [ ] **Step 7: integration-upgraded: run the `integration-upgraded` command in the prompt, expecting `Tests  `**
- [ ] **Step 8: timing: run the `timing` command in the prompt, expecting `timing-ok=1`**
- [ ] **Step 9: Commit: `docs(readme,design): the record of engagement (2d): README gains Activity (what is written in the act's transaction, Settings, Activity's reach and its defaults, the server's seen marker and the pill, follows by UTC day, mentions stored 20 and told 10, what is never shown, 90 days by activity-retention, the export's activity) and Share cards and search engines (the card routes and Caddy's card.html, what a card shows and never shows, previews off by default, robots.txt's five agents and why, X-Robots-Tag, what other platforms keep, the global limit and the log, the card lab); The interface gains Profile pictures (crop, 400 and 128 px, the checks, R1's hold for review, Reset profile picture and 30 days, 10 an hour and 30 a day) and 2d's 824,905 bytes under the unchanged cap; Upgrading names 0049 to 0053 with 0051_avatars as the slow one; Before going public gains counsel's review and six questions; Mutes, counts, Moderation's measures, the export and the smoke paragraph corrected, A release names three open points; the main design's row 2d and its 2026-10-29 entry; the UI design's 2d line delivered`**
