# korbat — Interface and Experience (UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** korbat's look and feel raised to the level of the best social apps while it keeps its values: the design language as code in light, dim and dark with bundled fonts, owned components with required names, purposeful motion with reduced forms and haptics by intent, a feed that keeps the reader's place and ends, moderation status on the author's post with a details sheet and Who sees this, a composer that keeps drafts on the device only, Appearance settings, and the console restyled within its policy.

**Architecture:** Ten commits, no migration and no API route: tokens, fonts, Text, Icon and the theme switch; the primitives, haptics, motion and the shared test mocks; the shell, the navigation and the app's browser check; the post, its media and the lightbox; feeds, threads and profiles; the composer; the moderation surfaces and the public pages; settings, security, the sign-in flow and Appearance; the console within its policy; and the record with the walk-through.

**Tech Stack:** Expo SDK 57 for the web app with expo-router, NativeWind 4 and Reanimated 4; expo-haptics, expo-font, sonner and sonner-native, Lucide icons with react-native-svg, class-variance-authority and clsx at exact pins at least 7 days old; Fraunces and Atkinson Hyperlegible Next and Mono under the OFL, bundled; playwright-core 1.63 for both browser checks; React 19 with esbuild 0.28 and plain CSS for the console; vitest 4.

**Complete code:** each task's full files, commands and observed output are in `docs/superpowers/prompts/interface-experience-ui/NN-<slug>.md`, generated from a verified dry run. This plan is the map. Where it and a prompt differ, the prompt wins.

**Spec:** `docs/superpowers/specs/2026-10-21-interface-experience-ui-design.md`.

---

## File structure

- `apps/admin/test/`: `contrast.test.ts` (Task 9), `tables.test.ts` (Task 10)
- `apps/app/`: `index.ts` (Task 3), `vitest.browser.config.mts` (Task 3)
- `apps/app/assets/fonts/LICENSES/`: `atkinson-hyperlegible-mono-OFL.txt` (Task 1), `atkinson-hyperlegible-next-OFL.txt` (Task 1), `fraunces-OFL.txt` (Task 1)
- `apps/app/public/`: `theme-boot.js` (Task 1)
- `apps/app/src/app/`: `+not-found.tsx` (Task 3)
- `apps/app/src/app/settings/`: `appearance.tsx` (Task 8), `index.tsx` (Task 8)
- `apps/app/src/components/`: `icons.ts` (Task 1), `AboutCard.tsx` (Task 3), `GestureRoot.tsx` (Task 3), `GestureRoot.web.tsx` (Task 3), `ScreenHeader.tsx` (Task 3), `ToastCard.tsx` (Task 3), `toast.tsx` (Task 3), `toast.web.tsx` (Task 3), `Prose.tsx` (Task 7)
- `apps/app/src/components/kit/`: `Icon.tsx` (Task 1), `Icon.web.tsx` (Task 1), `Text.tsx` (Task 1), `Avatar.tsx` (Task 2), `EmptyState.tsx` (Task 2), `ErrorState.tsx` (Task 2), `IconButton.tsx` (Task 2), `ListRow.tsx` (Task 2), `PublicFrame.tsx` (Task 2), `Skeleton.tsx` (Task 2), `StatusChip.tsx` (Task 2), `VisuallyHidden.tsx` (Task 2), `interaction.ts` (Task 2), `lucide-icons.d.ts` (Task 2), `DragArea.tsx` (Task 4), `DragArea.web.tsx` (Task 4), `Menu.tsx` (Task 4), `Sheet.tsx` (Task 4), `measure.ts` (Task 4), `Tabs.tsx` (Task 5)
- `apps/app/src/components/list/`: `List.tsx` (Task 5), `anchor.ts` (Task 5), `anchor.web.ts` (Task 5)
- `apps/app/src/components/moderation/`: `StatusSheet.tsx` (Task 7), `parts.tsx` (Task 7)
- `apps/app/src/components/social/`: `PostMenu.tsx` (Task 4), `WhoSeesThis.tsx` (Task 4), `FeedList.tsx` (Task 5), `FeedRows.tsx` (Task 5), `NewPostsPill.tsx` (Task 5), `ProfileMenu.tsx` (Task 5), `ComposeButton.tsx` (Task 6), `ComposeHost.tsx` (Task 6)
- `apps/app/src/components/social/composer/`: `ComposerCard.tsx` (Task 6), `ComposerField.tsx` (Task 6), `DiscardDialog.tsx` (Task 6), `ProgressRing.tsx` (Task 6), `ProgressRing.web.tsx` (Task 6), `SendBar.tsx` (Task 6), `state.ts` (Task 6)
- `apps/app/src/lib/`: `appearance.ts` (Task 1), `format.ts` (Task 2), `haptics.ts` (Task 2), `motion.ts` (Task 2), `time.ts` (Task 2), `ui-words.ts` (Task 2), `page-title.tsx` (Task 3), `shell-scroll.tsx` (Task 3), `toast-rules.ts` (Task 3), `zod-jitless.ts` (Task 3), `post-actions.ts` (Task 4), `reach.ts` (Task 4), `feed-cache.ts` (Task 5), `feed-rows.ts` (Task 5), `new-posts.ts` (Task 5), `reading-place.ts` (Task 5), `session-end.ts` (Task 5), `composing.ts` (Task 6), `drafts.ts` (Task 6), `auth-words.ts` (Task 8), `lockdown-words.ts` (Task 8), `settings-words.ts` (Task 8)
- `apps/app/src/theme/`: `ThemeProvider.tsx` (Task 1), `cn.ts` (Task 1), `fonts.ts` (Task 1), `fonts.web.ts` (Task 1), `layout.ts` (Task 1), `motion.ts` (Task 1), `scope.ts` (Task 1), `scope.web.ts` (Task 1), `tokens.ts` (Task 1)
- `apps/app/test/`: `appearance.test.ts` (Task 1), `boot.ts` (Task 1), `contrast.test.ts` (Task 1), `legacy-files.ts` (Task 1), `theme.test.ts` (Task 1), `format.test.ts` (Task 2), `haptics.test.ts` (Task 2), `kit.test.tsx` (Task 2), `motion.test.ts` (Task 2), `setup.ts` (Task 2), `shell.test.tsx` (Task 3), `post-card.test.tsx` (Task 4), `reach.test.ts` (Task 4), `anchor.test.ts` (Task 5), `feed-cache.test.ts` (Task 5), `feed-rows.test.ts` (Task 5), `new-posts.test.ts` (Task 5), `reading-place.test.ts` (Task 5), `composer-state.test.ts` (Task 6), `composer.test.tsx` (Task 6), `drafts.test.ts` (Task 6), `status-sheet.test.tsx` (Task 7), `appearance-page.test.tsx` (Task 8)
- `apps/app/test/browser/`: `baseline.json` (Task 1), `app.browser.ts` (Task 3), `caddyfile.ts` (Task 3), `fixture-api.ts` (Task 3), `server.ts` (Task 3), `watch.ts` (Task 3)

## Tasks

### Task 1: Tokens, fonts, Text, Icon and the theme switch: the design language in code, and the theme from the first frame.

**Prompt:** `docs/superpowers/prompts/interface-experience-ui/01-tokens-fonts-text-icon-theme.md`

**Files:**
- Create: `apps/app/assets/fonts/LICENSES/atkinson-hyperlegible-mono-OFL.txt`
- Create: `apps/app/assets/fonts/LICENSES/atkinson-hyperlegible-next-OFL.txt`
- Create: `apps/app/assets/fonts/LICENSES/fraunces-OFL.txt`
- Create: `apps/app/public/theme-boot.js`
- Create: `apps/app/src/components/icons.ts`
- Create: `apps/app/src/components/kit/Icon.tsx`
- Create: `apps/app/src/components/kit/Icon.web.tsx`
- Create: `apps/app/src/components/kit/Text.tsx`
- Create: `apps/app/src/lib/appearance.ts`
- Create: `apps/app/src/theme/ThemeProvider.tsx`
- Create: `apps/app/src/theme/cn.ts`
- Create: `apps/app/src/theme/fonts.ts`
- Create: `apps/app/src/theme/fonts.web.ts`
- Create: `apps/app/src/theme/layout.ts`
- Create: `apps/app/src/theme/motion.ts`
- Create: `apps/app/src/theme/scope.ts`
- Create: `apps/app/src/theme/scope.web.ts`
- Create: `apps/app/src/theme/tokens.ts`
- Create: `apps/app/test/appearance.test.ts`
- Create: `apps/app/test/boot.ts`
- Create: `apps/app/test/browser/baseline.json`
- Create: `apps/app/test/contrast.test.ts`
- Create: `apps/app/test/legacy-files.ts`
- Create: `apps/app/test/theme.test.ts`
- Modify: `apps/app/global.css`
- Modify: `apps/app/metro.config.js`
- Modify: `apps/app/package.json`
- Modify: `apps/app/public/index.html`
- Modify: `apps/app/src/app/(auth)/password.tsx`
- Modify: `apps/app/src/app/(auth)/signin.tsx`
- Modify: `apps/app/src/app/_layout.tsx`
- Modify: `apps/app/src/components/moderation/ReportForm.tsx`
- Modify: `apps/app/tailwind.config.js`
- Modify: `apps/app/test/explore.test.tsx`
- Modify: `apps/app/vitest.config.mts`
- Updated by the install step: `pnpm-lock.yaml`

- [ ] **Step 1: Write the failing tests: `apps/app/test/appearance.test.ts`, `apps/app/test/boot.ts`, `apps/app/test/browser/baseline.json`, `apps/app/test/contrast.test.ts`, `apps/app/test/legacy-files.ts`, `apps/app/test/theme.test.ts`, `apps/app/test/explore.test.tsx`, `apps/app/vitest.config.mts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/app/assets/fonts/LICENSES/atkinson-hyperlegible-mono-OFL.txt`, `apps/app/assets/fonts/LICENSES/atkinson-hyperlegible-next-OFL.txt`, `apps/app/assets/fonts/LICENSES/fraunces-OFL.txt`, `apps/app/public/theme-boot.js`, `apps/app/src/components/icons.ts`, `apps/app/src/components/kit/Icon.tsx`, `apps/app/src/components/kit/Icon.web.tsx`, `apps/app/src/components/kit/Text.tsx`, `apps/app/src/lib/appearance.ts`, `apps/app/src/theme/ThemeProvider.tsx`, `apps/app/src/theme/cn.ts`, `apps/app/src/theme/fonts.ts`, `apps/app/src/theme/fonts.web.ts`, `apps/app/src/theme/layout.ts`, `apps/app/src/theme/motion.ts`, `apps/app/src/theme/scope.ts`, `apps/app/src/theme/scope.web.ts`, `apps/app/src/theme/tokens.ts`, `apps/app/global.css`, `apps/app/metro.config.js`, `apps/app/package.json`, `apps/app/public/index.html`, `apps/app/src/app/(auth)/password.tsx`, `apps/app/src/app/(auth)/signin.tsx`, `apps/app/src/app/_layout.tsx`, `apps/app/src/components/moderation/ReportForm.tsx`, `apps/app/tailwind.config.js`**
- [ ] **Step 4: install: run `pnpm install --config.package-import-method=copy`, expecting `Done in`**
- [ ] **Step 5: frozen-install: run `pnpm install --frozen-lockfile`, expecting `Done in`**
- [ ] **Step 6: lockfile-age: run `node scripts/check-lockfile-age.mjs --base HEAD`, expecting `all at least 7 days old`**
- [ ] **Step 7: typecheck: run `pnpm typecheck`**
- [ ] **Step 8: test: run `pnpm -r --if-present run test --testTimeout=20000`, expecting `Tests  `**
- [ ] **Step 9: export: run the `export` command in the prompt, expecting `Exported`**
- [ ] **Step 10: Commit: `feat(app): the design language in code and the theme from the first frame: src/theme/tokens.ts holds Light, Dim and Dark (ink and paper with one violet accent) and TEXT_PAIRS, every pair at its WCAG minimum in every theme, mirrored as --k-<token> triplets in global.css and mapped by tailwind.config.js with five radii; ThemeProvider follows the system under System, sets the html class, color-scheme and theme-color on web and NativeWind's vars() on native, and useTheme() works without it; public/theme-boot.js paints the stored theme before the bundle; lib/appearance.ts keeps the reader's choices under korbat.appearance and survives bad records and refused storage; Fraunces, Atkinson Hyperlegible Next and Mono bundled with their licences; kit/Text with ten variants and the text step in rem; kit/Icon over Lucide 1.55.0; the human check follows the theme; the web export's baseline recorded`**

### Task 2: Primitives, haptics, motion and the test mocks: the owned components of section 6 that screens build on.

**Prompt:** `docs/superpowers/prompts/interface-experience-ui/02-primitives-haptics-motion-mocks.md`

**Files:**
- Create: `apps/app/src/components/kit/Avatar.tsx`
- Create: `apps/app/src/components/kit/EmptyState.tsx`
- Create: `apps/app/src/components/kit/ErrorState.tsx`
- Create: `apps/app/src/components/kit/IconButton.tsx`
- Create: `apps/app/src/components/kit/ListRow.tsx`
- Create: `apps/app/src/components/kit/PublicFrame.tsx`
- Create: `apps/app/src/components/kit/Skeleton.tsx`
- Create: `apps/app/src/components/kit/StatusChip.tsx`
- Create: `apps/app/src/components/kit/VisuallyHidden.tsx`
- Create: `apps/app/src/components/kit/interaction.ts`
- Create: `apps/app/src/components/kit/lucide-icons.d.ts`
- Create: `apps/app/src/lib/format.ts`
- Create: `apps/app/src/lib/haptics.ts`
- Create: `apps/app/src/lib/motion.ts`
- Create: `apps/app/src/lib/time.ts`
- Create: `apps/app/src/lib/ui-words.ts`
- Create: `apps/app/test/format.test.ts`
- Create: `apps/app/test/haptics.test.ts`
- Create: `apps/app/test/kit.test.tsx`
- Create: `apps/app/test/motion.test.ts`
- Create: `apps/app/test/setup.ts`
- Modify: `apps/app/package.json`
- Modify: `apps/app/src/components/kit/Icon.tsx`
- Modify: `apps/app/src/components/kit/Icon.web.tsx`
- Modify: `apps/app/src/components/kit/Text.tsx`
- Modify: `apps/app/src/components/ui.tsx`
- Modify: `apps/app/src/lib/social.ts`
- Modify: `apps/app/tailwind.config.js`
- Modify: `apps/app/test/a11y.test.tsx`
- Modify: `apps/app/test/announced.test.tsx`
- Modify: `apps/app/test/appeals.test.tsx`
- Modify: `apps/app/test/automated.test.tsx`
- Modify: `apps/app/test/cases.test.tsx`
- Modify: `apps/app/test/explore.test.tsx`
- Modify: `apps/app/test/hidden-media.test.tsx`
- Modify: `apps/app/test/image-fault.test.tsx`
- Modify: `apps/app/test/legacy-files.ts`
- Modify: `apps/app/test/orders.test.tsx`
- Modify: `apps/app/test/public-pages.test.tsx`
- Modify: `apps/app/test/report.test.tsx`
- Modify: `apps/app/test/reporting.test.tsx`
- Modify: `apps/app/test/standing.test.tsx`
- Modify: `apps/app/vitest.config.mts`
- Updated by the install step: `pnpm-lock.yaml`

- [ ] **Step 1: Write the failing tests: `apps/app/test/format.test.ts`, `apps/app/test/haptics.test.ts`, `apps/app/test/kit.test.tsx`, `apps/app/test/motion.test.ts`, `apps/app/test/setup.ts`, `apps/app/test/a11y.test.tsx`, `apps/app/test/announced.test.tsx`, `apps/app/test/appeals.test.tsx`, `apps/app/test/automated.test.tsx`, `apps/app/test/cases.test.tsx`, `apps/app/test/explore.test.tsx`, `apps/app/test/hidden-media.test.tsx`, `apps/app/test/image-fault.test.tsx`, `apps/app/test/legacy-files.ts`, `apps/app/test/orders.test.tsx`, `apps/app/test/public-pages.test.tsx`, `apps/app/test/report.test.tsx`, `apps/app/test/reporting.test.tsx`, `apps/app/test/standing.test.tsx`, `apps/app/vitest.config.mts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/app/src/components/kit/Avatar.tsx`, `apps/app/src/components/kit/EmptyState.tsx`, `apps/app/src/components/kit/ErrorState.tsx`, `apps/app/src/components/kit/IconButton.tsx`, `apps/app/src/components/kit/ListRow.tsx`, `apps/app/src/components/kit/PublicFrame.tsx`, `apps/app/src/components/kit/Skeleton.tsx`, `apps/app/src/components/kit/StatusChip.tsx`, `apps/app/src/components/kit/VisuallyHidden.tsx`, `apps/app/src/components/kit/interaction.ts`, `apps/app/src/components/kit/lucide-icons.d.ts`, `apps/app/src/lib/format.ts`, `apps/app/src/lib/haptics.ts`, `apps/app/src/lib/motion.ts`, `apps/app/src/lib/time.ts`, `apps/app/src/lib/ui-words.ts`, `apps/app/package.json`, `apps/app/src/components/kit/Icon.tsx`, `apps/app/src/components/kit/Icon.web.tsx`, `apps/app/src/components/kit/Text.tsx`, `apps/app/src/components/ui.tsx`, `apps/app/src/lib/social.ts`, `apps/app/tailwind.config.js`**
- [ ] **Step 4: install: run `pnpm install --config.package-import-method=copy`, expecting `Done in`**
- [ ] **Step 5: frozen-install: run `pnpm install --frozen-lockfile`, expecting `Done in`**
- [ ] **Step 6: lockfile-age: run `node scripts/check-lockfile-age.mjs --base HEAD`, expecting `all at least 7 days old`**
- [ ] **Step 7: typecheck: run `pnpm typecheck`**
- [ ] **Step 8: test: run `pnpm -r --if-present run test --testTimeout=20000`, expecting `Tests  `**
- [ ] **Step 9: export: run the `export` command in the prompt, expecting `Exported`**
- [ ] **Step 10: Commit: `feat(app): the primitives, haptics, motion and the shared test mocks: kit/IconButton with a required label, pressed, busy, a compact count kept out of its name, a popup trigger's aria-expanded and a 500 ms tooltip for fine pointers; Avatar's monogram; ListRow's link, button, switch and radio forms; Skeleton's pulse, still at 0.8 under reduced motion; EmptyState; ErrorState with its offline form and one retry when the browser is online again; StatusChip's image, link and button forms, each tone with an icon of its own; VisuallyHidden; PublicFrame; lib/haptics.ts maps seven intents onto expo-haptics 57.0.3 behind the reader's switch, useMotion() reduces motion for the system or the reader, lib/time.ts takes timeAgo with dayTime, fullDate and postedWhen, compactCount truncates, ui-words.ts holds the kit's words; ui.tsx rebuilt on the kit leaves the colour list; test/setup.ts mocks the native modules once for every file; a scan refuses bare sentences in the markup, 38 files still listed; hover only on fine pointers; icons bundled one module at a time`**

### Task 3: The shell, navigation and the app's browser check: the layout of section 7 on every screen, and the check that guards everything after it.

**Prompt:** `docs/superpowers/prompts/interface-experience-ui/03-shell-navigation-browser-check.md`

**Files:**
- Create: `apps/app/index.ts`
- Create: `apps/app/src/app/+not-found.tsx`
- Create: `apps/app/src/components/AboutCard.tsx`
- Create: `apps/app/src/components/GestureRoot.tsx`
- Create: `apps/app/src/components/GestureRoot.web.tsx`
- Create: `apps/app/src/components/ScreenHeader.tsx`
- Create: `apps/app/src/components/ToastCard.tsx`
- Create: `apps/app/src/components/toast.tsx`
- Create: `apps/app/src/components/toast.web.tsx`
- Create: `apps/app/src/lib/page-title.tsx`
- Create: `apps/app/src/lib/shell-scroll.tsx`
- Create: `apps/app/src/lib/toast-rules.ts`
- Create: `apps/app/src/lib/zod-jitless.ts`
- Create: `apps/app/test/browser/app.browser.ts`
- Create: `apps/app/test/browser/caddyfile.ts`
- Create: `apps/app/test/browser/fixture-api.ts`
- Create: `apps/app/test/browser/server.ts`
- Create: `apps/app/test/browser/watch.ts`
- Create: `apps/app/test/shell.test.tsx`
- Create: `apps/app/vitest.browser.config.mts`
- Modify: `apps/app/package.json`
- Modify: `apps/app/src/app/_layout.tsx`
- Modify: `apps/app/src/app/bookmarks.tsx`
- Modify: `apps/app/src/app/notice/[ref].tsx`
- Modify: `apps/app/src/app/report.tsx`
- Modify: `apps/app/src/app/u/[handle]/followers.tsx`
- Modify: `apps/app/src/app/u/[handle]/following.tsx`
- Modify: `apps/app/src/app/u/[handle]/index.tsx`
- Modify: `apps/app/src/components/AppShell.tsx`
- Modify: `apps/app/src/components/HandleBox.tsx`
- Modify: `apps/app/src/components/SettingsNav.tsx`
- Modify: `apps/app/src/components/StandingBanner.tsx`
- Modify: `apps/app/src/components/kit/EmptyState.tsx`
- Modify: `apps/app/src/components/kit/Skeleton.tsx`
- Modify: `apps/app/src/components/kit/VisuallyHidden.tsx`
- Modify: `apps/app/src/components/social/PagedList.tsx`
- Modify: `apps/app/src/lib/session.tsx`
- Modify: `apps/app/src/lib/social.ts`
- Modify: `apps/app/src/lib/ui-words.ts`
- Modify: `apps/app/src/theme/fonts.web.ts`
- Modify: `apps/app/test/announced.test.tsx`
- Modify: `apps/app/test/explore.test.tsx`
- Modify: `apps/app/test/hidden-media.test.tsx`
- Modify: `apps/app/test/legacy-files.ts`
- Updated by the install step: `pnpm-lock.yaml`
- Modify: `scripts/smoke-auth-stack.mjs`
- Delete: `apps/app/src/components/PopularNow.tsx`

- [ ] **Step 1: Write the failing tests: `apps/app/test/browser/app.browser.ts`, `apps/app/test/browser/caddyfile.ts`, `apps/app/test/browser/fixture-api.ts`, `apps/app/test/browser/server.ts`, `apps/app/test/browser/watch.ts`, `apps/app/test/shell.test.tsx`, `apps/app/vitest.browser.config.mts`, `apps/app/test/announced.test.tsx`, `apps/app/test/explore.test.tsx`, `apps/app/test/hidden-media.test.tsx`, `apps/app/test/legacy-files.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/app/index.ts`, `apps/app/src/app/+not-found.tsx`, `apps/app/src/components/AboutCard.tsx`, `apps/app/src/components/GestureRoot.tsx`, `apps/app/src/components/GestureRoot.web.tsx`, `apps/app/src/components/ScreenHeader.tsx`, `apps/app/src/components/ToastCard.tsx`, `apps/app/src/components/toast.tsx`, `apps/app/src/components/toast.web.tsx`, `apps/app/src/lib/page-title.tsx`, `apps/app/src/lib/shell-scroll.tsx`, `apps/app/src/lib/toast-rules.ts`, `apps/app/src/lib/zod-jitless.ts`, `apps/app/package.json`, `apps/app/src/app/_layout.tsx`, `apps/app/src/app/bookmarks.tsx`, `apps/app/src/app/notice/[ref].tsx`, `apps/app/src/app/report.tsx`, `apps/app/src/app/u/[handle]/followers.tsx`, `apps/app/src/app/u/[handle]/following.tsx`, `apps/app/src/app/u/[handle]/index.tsx`, `apps/app/src/components/AppShell.tsx`, `apps/app/src/components/HandleBox.tsx`, `apps/app/src/components/SettingsNav.tsx`, `apps/app/src/components/StandingBanner.tsx`, `apps/app/src/components/kit/EmptyState.tsx`, `apps/app/src/components/kit/Skeleton.tsx`, `apps/app/src/components/kit/VisuallyHidden.tsx`, `apps/app/src/components/social/PagedList.tsx`, `apps/app/src/lib/session.tsx`, `apps/app/src/lib/social.ts`, `apps/app/src/lib/ui-words.ts`, `apps/app/src/theme/fonts.web.ts`, `scripts/smoke-auth-stack.mjs`**
- [ ] **Step 4: Delete `apps/app/src/components/PopularNow.tsx` with `git rm`**
- [ ] **Step 5: install: run `pnpm install --config.package-import-method=copy`, expecting `Done in`**
- [ ] **Step 6: frozen-install: run `pnpm install --frozen-lockfile`, expecting `Done in`**
- [ ] **Step 7: lockfile-age: run `node scripts/check-lockfile-age.mjs --base HEAD`, expecting `all at least 7 days old`**
- [ ] **Step 8: typecheck: run `pnpm typecheck`**
- [ ] **Step 9: test: run `pnpm -r --if-present run test --testTimeout=20000`, expecting `Tests  `**
- [ ] **Step 10: export: run the `export` command in the prompt, expecting `Exported`**
- [ ] **Step 11: app-browser: run `pnpm --filter @korbat/app test:browser`, expecting `Tests  17 passed (17)`**
- [ ] **Step 12: stack-down: run `docker compose -f infra/compose.yml -f infra/compose.dev.yml down && echo down-ok`, expecting `down-ok`**
- [ ] **Step 13: build: run the `build` command in the prompt, expecting `build-exit=0`**
- [ ] **Step 14: stack-up: run `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --wait && echo up-ok`, expecting `up-ok`**
- [ ] **Step 15: test-database: run `node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `migrations applied`, `test database ready: korbat_test`**
- [ ] **Step 16: smoke: run the `smoke` command in the prompt, expecting `smoke test passed`**
- [ ] **Step 17: stack-stop: run the `stack-stop` command in the prompt, expecting `postgres-1 Up`**
- [ ] **Step 18: Commit: `feat(app): the shell, the navigation and the app's browser check: AppShell lays out a phone's tab bar, a tablet's 80 px rail with the k and from 1280 px the full nav with the wordmark, one aria-current item marked by an accent-wash pill, a 3 px accent bar and the strong stroke; a skip link to the main column, a polite offline banner and, from 1024 px, About korbat with the handle box and How korbat works where Popular now was; ScreenHeader's title slides away on a phone as the list scrolls down and returns on a scroll up, staying under reduced motion, and the current Home item brings the feed to its newest post; toast.show() over sonner and sonner-native; usePageTitle(), a not-found screen and an error boundary in the public frame; SettingsNav, StandingBanner, HandleBox and SessionFailure on the tokens; five screens load inside the shell; zod jitless from the app's entry; the browser check builds the export and walks it in Chromium in 17 steps; the smoke test loads the page, theme-boot.js, a font and a post's page`**

### Task 4: The post, its media and the lightbox: section 6.6's post card with its menus and optimistic actions, section 6.7's media and lightbox, and section 6.14's Who sees this.

**Prompt:** `docs/superpowers/prompts/interface-experience-ui/04-post-media-lightbox.md`

**Files:**
- Create: `apps/app/src/components/kit/DragArea.tsx`
- Create: `apps/app/src/components/kit/DragArea.web.tsx`
- Create: `apps/app/src/components/kit/Menu.tsx`
- Create: `apps/app/src/components/kit/Sheet.tsx`
- Create: `apps/app/src/components/kit/measure.ts`
- Create: `apps/app/src/components/social/PostMenu.tsx`
- Create: `apps/app/src/components/social/WhoSeesThis.tsx`
- Create: `apps/app/src/lib/post-actions.ts`
- Create: `apps/app/src/lib/reach.ts`
- Create: `apps/app/test/post-card.test.tsx`
- Create: `apps/app/test/reach.test.ts`
- Modify: `apps/app/src/components/kit/IconButton.tsx`
- Modify: `apps/app/src/components/kit/Text.tsx`
- Modify: `apps/app/src/components/kit/interaction.ts`
- Modify: `apps/app/src/components/social/HiddenImage.tsx`
- Modify: `apps/app/src/components/social/ImageFault.tsx`
- Modify: `apps/app/src/components/social/MediaGrid.tsx`
- Modify: `apps/app/src/components/social/MediaViewer.tsx`
- Modify: `apps/app/src/components/social/PostCard.tsx`
- Modify: `apps/app/src/components/social/ProfileList.tsx`
- Modify: `apps/app/src/components/social/RichText.tsx`
- Modify: `apps/app/src/components/ui.tsx`
- Modify: `apps/app/src/lib/motion.ts`
- Modify: `apps/app/src/lib/social.ts`
- Modify: `apps/app/src/lib/ui-words.ts`
- Modify: `apps/app/src/theme/ThemeProvider.tsx`
- Modify: `apps/app/test/a11y.test.tsx`
- Modify: `apps/app/test/browser/app.browser.ts`
- Modify: `apps/app/test/browser/fixture-api.ts`
- Modify: `apps/app/test/cases.test.tsx`
- Modify: `apps/app/test/explore.test.tsx`
- Modify: `apps/app/test/hidden-media.test.tsx`
- Modify: `apps/app/test/kit.test.tsx`
- Modify: `apps/app/test/legacy-files.ts`
- Modify: `apps/app/test/report.test.tsx`
- Modify: `apps/app/test/theme.test.ts`

- [ ] **Step 1: Write the failing tests: `apps/app/test/post-card.test.tsx`, `apps/app/test/reach.test.ts`, `apps/app/test/a11y.test.tsx`, `apps/app/test/browser/app.browser.ts`, `apps/app/test/browser/fixture-api.ts`, `apps/app/test/cases.test.tsx`, `apps/app/test/explore.test.tsx`, `apps/app/test/hidden-media.test.tsx`, `apps/app/test/kit.test.tsx`, `apps/app/test/legacy-files.ts`, `apps/app/test/report.test.tsx`, `apps/app/test/theme.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/app/src/components/kit/DragArea.tsx`, `apps/app/src/components/kit/DragArea.web.tsx`, `apps/app/src/components/kit/Menu.tsx`, `apps/app/src/components/kit/Sheet.tsx`, `apps/app/src/components/kit/measure.ts`, `apps/app/src/components/social/PostMenu.tsx`, `apps/app/src/components/social/WhoSeesThis.tsx`, `apps/app/src/lib/post-actions.ts`, `apps/app/src/lib/reach.ts`, `apps/app/src/components/kit/IconButton.tsx`, `apps/app/src/components/kit/Text.tsx`, `apps/app/src/components/kit/interaction.ts`, `apps/app/src/components/social/HiddenImage.tsx`, `apps/app/src/components/social/ImageFault.tsx`, `apps/app/src/components/social/MediaGrid.tsx`, `apps/app/src/components/social/MediaViewer.tsx`, `apps/app/src/components/social/PostCard.tsx`, `apps/app/src/components/social/ProfileList.tsx`, `apps/app/src/components/social/RichText.tsx`, `apps/app/src/components/ui.tsx`, `apps/app/src/lib/motion.ts`, `apps/app/src/lib/social.ts`, `apps/app/src/lib/ui-words.ts`, `apps/app/src/theme/ThemeProvider.tsx`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm -r --if-present run test --testTimeout=20000`, expecting `Tests  `**
- [ ] **Step 6: export: run the `export` command in the prompt, expecting `Exported`**
- [ ] **Step 7: app-browser: run `pnpm --filter @korbat/app test:browser`, expecting `Tests  22 passed (22)`**
- [ ] **Step 8: Commit: `feat(app): the post, its media and the lightbox: PostCard is an article named by its author line, with the time as its one link to the post (postedWhen's words in its name), the name and a hidden 44 px avatar as links to the profile, and the card body as a pointer's open target with an 80 ms press wash; Reply, Repost, Like and Save act at once in per-kind request lanes, Like popping on its spring with the accent ring, Repost and Save firmer, counts rolling, Repost's reposted disc, and a refusal rolled back with a nudge, the error haptic and a toast; kit/Sheet and kit/Menu (a bottom sheet or a centred dialog, a sheet or an anchored popover, focus in and back, arrow keys) carry More's Who sees this (reach() in lib/reach.ts), Copy link, Delete with its question and Report, and Repost's menu; MediaGrid, the lightbox on a forced Dark stage that grows from its thumbnail, drags to close and pages, the hidden-image placeholders, RichText and an optimistic FollowButton move onto the tokens; drags on the web run on pointer events, so gesture-handler stays out of the bundle; the browser check gains steps 18 to 22`**

### Task 5: Feeds, threads and profiles: section 8.2's feed that keeps the reader's place (typed rows, the reading place, new posts and their pill, the session's feed cache) on section 7.5's List and anchor, section 8.3's thread, section 8.4's profile with its menu and account lists, section 8.5's Bookmarks, and section 6.10's Tabs.

**Prompt:** `docs/superpowers/prompts/interface-experience-ui/05-feeds-threads-profiles.md`

**Files:**
- Create: `apps/app/src/components/kit/Tabs.tsx`
- Create: `apps/app/src/components/list/List.tsx`
- Create: `apps/app/src/components/list/anchor.ts`
- Create: `apps/app/src/components/list/anchor.web.ts`
- Create: `apps/app/src/components/social/FeedList.tsx`
- Create: `apps/app/src/components/social/FeedRows.tsx`
- Create: `apps/app/src/components/social/NewPostsPill.tsx`
- Create: `apps/app/src/components/social/ProfileMenu.tsx`
- Create: `apps/app/src/lib/feed-cache.ts`
- Create: `apps/app/src/lib/feed-rows.ts`
- Create: `apps/app/src/lib/new-posts.ts`
- Create: `apps/app/src/lib/reading-place.ts`
- Create: `apps/app/src/lib/session-end.ts`
- Create: `apps/app/test/anchor.test.ts`
- Create: `apps/app/test/feed-cache.test.ts`
- Create: `apps/app/test/feed-rows.test.ts`
- Create: `apps/app/test/new-posts.test.ts`
- Create: `apps/app/test/reading-place.test.ts`
- Modify: `apps/app/src/app/bookmarks.tsx`
- Modify: `apps/app/src/app/index.tsx`
- Modify: `apps/app/src/app/post/[id].tsx`
- Modify: `apps/app/src/app/u/[handle]/index.tsx`
- Modify: `apps/app/src/components/kit/ListRow.tsx`
- Modify: `apps/app/src/components/social/ExploreList.tsx`
- Modify: `apps/app/src/components/social/MediaGrid.tsx`
- Modify: `apps/app/src/components/social/PagedList.tsx`
- Modify: `apps/app/src/components/social/PostCard.tsx`
- Modify: `apps/app/src/components/social/ProfileList.tsx`
- Modify: `apps/app/src/lib/explore.ts`
- Modify: `apps/app/src/lib/session.tsx`
- Modify: `apps/app/src/lib/social.ts`
- Modify: `apps/app/src/lib/ui-words.ts`
- Modify: `apps/app/src/theme/fonts.web.ts`
- Modify: `apps/app/test/browser/app.browser.ts`
- Modify: `apps/app/test/browser/fixture-api.ts`
- Modify: `apps/app/test/explore.test.tsx`
- Modify: `apps/app/test/hidden-media.test.tsx`
- Modify: `apps/app/test/kit.test.tsx`
- Modify: `apps/app/test/legacy-files.ts`
- Modify: `apps/app/test/post-card.test.tsx`
- Modify: `apps/app/test/report.test.tsx`
- Modify: `apps/app/test/shell.test.tsx`

- [ ] **Step 1: Write the failing tests: `apps/app/test/anchor.test.ts`, `apps/app/test/feed-cache.test.ts`, `apps/app/test/feed-rows.test.ts`, `apps/app/test/new-posts.test.ts`, `apps/app/test/reading-place.test.ts`, `apps/app/test/browser/app.browser.ts`, `apps/app/test/browser/fixture-api.ts`, `apps/app/test/explore.test.tsx`, `apps/app/test/hidden-media.test.tsx`, `apps/app/test/kit.test.tsx`, `apps/app/test/legacy-files.ts`, `apps/app/test/post-card.test.tsx`, `apps/app/test/report.test.tsx`, `apps/app/test/shell.test.tsx`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/app/src/components/kit/Tabs.tsx`, `apps/app/src/components/list/List.tsx`, `apps/app/src/components/list/anchor.ts`, `apps/app/src/components/list/anchor.web.ts`, `apps/app/src/components/social/FeedList.tsx`, `apps/app/src/components/social/FeedRows.tsx`, `apps/app/src/components/social/NewPostsPill.tsx`, `apps/app/src/components/social/ProfileMenu.tsx`, `apps/app/src/lib/feed-cache.ts`, `apps/app/src/lib/feed-rows.ts`, `apps/app/src/lib/new-posts.ts`, `apps/app/src/lib/reading-place.ts`, `apps/app/src/lib/session-end.ts`, `apps/app/src/app/bookmarks.tsx`, `apps/app/src/app/index.tsx`, `apps/app/src/app/post/[id].tsx`, `apps/app/src/app/u/[handle]/index.tsx`, `apps/app/src/components/kit/ListRow.tsx`, `apps/app/src/components/social/ExploreList.tsx`, `apps/app/src/components/social/MediaGrid.tsx`, `apps/app/src/components/social/PagedList.tsx`, `apps/app/src/components/social/PostCard.tsx`, `apps/app/src/components/social/ProfileList.tsx`, `apps/app/src/lib/explore.ts`, `apps/app/src/lib/session.tsx`, `apps/app/src/lib/social.ts`, `apps/app/src/lib/ui-words.ts`, `apps/app/src/theme/fonts.web.ts`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm -r --if-present run test --testTimeout=20000`, expecting `Tests  `**
- [ ] **Step 6: export: run the `export` command in the prompt, expecting `Exported`**
- [ ] **Step 7: app-browser: run `pnpm --filter @korbat/app test:browser`, expecting `Tests  27 passed (27)`**
- [ ] **Step 8: Commit: `feat(app): feeds, threads and profiles: every list scrolls through list/List.tsx, which owns FlatList's tuning, redraws a row only when its key or version changes and keeps the row on screen when rows are put above it (anchor.web.ts on the scroll node, maintainVisibleContentPosition on native), with the feed pattern (role feed, aria-posinset and aria-setsize, Page Down and Page Up) and the focus handed on after a delete; Home's Following and Latest are typed rows (lib/feed-rows.ts) that keep the reader's place on the device (lib/reading-place.ts), open there within the newest 100 under You were here, ask for new posts every 60 s while in view (lib/new-posts.ts) and count them in a pill that takes the reader to the oldest one, say You're all caught up, and come back across tabs without asking again (lib/feed-cache.ts); kit/Tabs; the thread opens on its large focused post with its chain above; the profile's header gains a More menu with Mute, Block and Report; account rows move onto ListRow and Explore onto List; the session's end clears the appearance and the places; the browser check gains steps 23 to 27`**

### Task 6: The composer: section 6.15's parts on a pure reducer (ComposerField, ProgressRing, the image tray, SendBar and DiscardDialog) with drafts kept on the device (decision 18), section 8.6's sheet on kit/Sheet with its sent toast, Home's collapsed card (decision 19) and the thread's reply card (section 8.3), and New post on every screen (sections 7.2 and 7.3).

**Prompt:** `docs/superpowers/prompts/interface-experience-ui/06-the-composer.md`

**Files:**
- Create: `apps/app/src/components/social/ComposeButton.tsx`
- Create: `apps/app/src/components/social/ComposeHost.tsx`
- Create: `apps/app/src/components/social/composer/ComposerCard.tsx`
- Create: `apps/app/src/components/social/composer/ComposerField.tsx`
- Create: `apps/app/src/components/social/composer/DiscardDialog.tsx`
- Create: `apps/app/src/components/social/composer/ProgressRing.tsx`
- Create: `apps/app/src/components/social/composer/ProgressRing.web.tsx`
- Create: `apps/app/src/components/social/composer/SendBar.tsx`
- Create: `apps/app/src/components/social/composer/state.ts`
- Create: `apps/app/src/lib/composing.ts`
- Create: `apps/app/src/lib/drafts.ts`
- Create: `apps/app/test/composer-state.test.ts`
- Create: `apps/app/test/composer.test.tsx`
- Create: `apps/app/test/drafts.test.ts`
- Modify: `apps/app/src/app/_layout.tsx`
- Modify: `apps/app/src/app/bookmarks.tsx`
- Modify: `apps/app/src/app/index.tsx`
- Modify: `apps/app/src/app/post/[id].tsx`
- Modify: `apps/app/src/app/u/[handle]/index.tsx`
- Modify: `apps/app/src/components/AppShell.tsx`
- Modify: `apps/app/src/components/kit/Sheet.tsx`
- Modify: `apps/app/src/components/social/ComposeSheet.tsx`
- Modify: `apps/app/src/components/social/Composer.tsx`
- Modify: `apps/app/src/components/social/ComposerImages.tsx`
- Modify: `apps/app/src/components/social/FeedList.tsx`
- Modify: `apps/app/src/components/social/PostCard.tsx`
- Modify: `apps/app/src/components/social/useImageUploads.ts`
- Modify: `apps/app/src/lib/feed-cache.ts`
- Modify: `apps/app/src/lib/session-end.ts`
- Modify: `apps/app/src/lib/session.tsx`
- Modify: `apps/app/src/lib/ui-words.ts`
- Modify: `apps/app/test/browser/app.browser.ts`
- Modify: `apps/app/test/browser/fixture-api.ts`
- Modify: `apps/app/test/explore.test.tsx`
- Modify: `apps/app/test/legacy-files.ts`
- Modify: `apps/app/test/reading-place.test.ts`
- Modify: `apps/app/test/setup.ts`

- [ ] **Step 1: Write the failing tests: `apps/app/test/composer-state.test.ts`, `apps/app/test/composer.test.tsx`, `apps/app/test/drafts.test.ts`, `apps/app/test/browser/app.browser.ts`, `apps/app/test/browser/fixture-api.ts`, `apps/app/test/explore.test.tsx`, `apps/app/test/legacy-files.ts`, `apps/app/test/reading-place.test.ts`, `apps/app/test/setup.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/app/src/components/social/ComposeButton.tsx`, `apps/app/src/components/social/ComposeHost.tsx`, `apps/app/src/components/social/composer/ComposerCard.tsx`, `apps/app/src/components/social/composer/ComposerField.tsx`, `apps/app/src/components/social/composer/DiscardDialog.tsx`, `apps/app/src/components/social/composer/ProgressRing.tsx`, `apps/app/src/components/social/composer/ProgressRing.web.tsx`, `apps/app/src/components/social/composer/SendBar.tsx`, `apps/app/src/components/social/composer/state.ts`, `apps/app/src/lib/composing.ts`, `apps/app/src/lib/drafts.ts`, `apps/app/src/app/_layout.tsx`, `apps/app/src/app/bookmarks.tsx`, `apps/app/src/app/index.tsx`, `apps/app/src/app/post/[id].tsx`, `apps/app/src/app/u/[handle]/index.tsx`, `apps/app/src/components/AppShell.tsx`, `apps/app/src/components/kit/Sheet.tsx`, `apps/app/src/components/social/ComposeSheet.tsx`, `apps/app/src/components/social/Composer.tsx`, `apps/app/src/components/social/ComposerImages.tsx`, `apps/app/src/components/social/FeedList.tsx`, `apps/app/src/components/social/PostCard.tsx`, `apps/app/src/components/social/useImageUploads.ts`, `apps/app/src/lib/feed-cache.ts`, `apps/app/src/lib/session-end.ts`, `apps/app/src/lib/session.tsx`, `apps/app/src/lib/ui-words.ts`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm -r --if-present run test --testTimeout=20000`, expecting `Tests  `**
- [ ] **Step 6: export: run the `export` command in the prompt, expecting `Exported`**
- [ ] **Step 7: app-browser: run `pnpm --filter @korbat/app test:browser`, expecting `Tests  31 passed (31)`**
- [ ] **Step 8: Commit: `feat(app): the composer: composer/state.ts, a pure reducer of the text, the images and where each upload stands, the send and its refusal and the draft's key, says the length by the server's rule, whether a post may go and the Post button's words, and the parts draw from it: ComposerField with its kept names, growing to half the window and described by {n} of 1000 characters, said again only across 900 and 1000; ProgressRing (a DOM svg on the web, react-native-svg natively); the image tray at 88 px; SendBar; DiscardDialog, asked only when there is content; lib/drafts.ts keeps the text per context on the device 500 ms after typing stops and the session's end clears every draft; ComposeSheet moves onto kit/Sheet, 640 px wide from 768 px, and sending closes it with a toast whose View opens the post; New post ends the rail and the full nav on every screen, one sheet for the app in the root layout, with the phone's compose button on Home, a profile and Bookmarks; Home's collapsed card and the thread's reply card open in place, Reply opens the thread with its card focused, a quote's preview links nowhere; the browser check gains steps 28 to 31`**

### Task 7: Moderation surfaces and the public pages: section 8.7's StatusSheet, opened by the author's chip and read fresh from the decision, the link under a hidden image to /rules (decision 10), the case screens, the report form and a report's status page on the kit, and section 8.9's reading layout for /rules, /transparency and /explore/about, with /terms in PublicFrame.

**Prompt:** `docs/superpowers/prompts/interface-experience-ui/07-moderation-surfaces-and-public-pages.md`

**Files:**
- Create: `apps/app/src/components/Prose.tsx`
- Create: `apps/app/src/components/moderation/StatusSheet.tsx`
- Create: `apps/app/src/components/moderation/parts.tsx`
- Create: `apps/app/test/status-sheet.test.tsx`
- Modify: `apps/app/src/app/explore/about.tsx`
- Modify: `apps/app/src/app/notice/[ref].tsx`
- Modify: `apps/app/src/app/report.tsx`
- Modify: `apps/app/src/app/rules.tsx`
- Modify: `apps/app/src/app/settings/cases/[id].tsx`
- Modify: `apps/app/src/app/settings/cases/[id]/reply.tsx`
- Modify: `apps/app/src/app/settings/cases/index.tsx`
- Modify: `apps/app/src/app/settings/cases/releases/[id].tsx`
- Modify: `apps/app/src/app/settings/cases/uploads/[id].tsx`
- Modify: `apps/app/src/app/terms.tsx`
- Modify: `apps/app/src/app/transparency.tsx`
- Modify: `apps/app/src/components/ScreenHeader.tsx`
- Modify: `apps/app/src/components/kit/PublicFrame.tsx`
- Modify: `apps/app/src/components/kit/StatusChip.tsx`
- Modify: `apps/app/src/components/moderation/CasesLists.tsx`
- Modify: `apps/app/src/components/moderation/DecisionDetail.tsx`
- Modify: `apps/app/src/components/moderation/ItemLines.tsx`
- Modify: `apps/app/src/components/moderation/NoticeStatusView.tsx`
- Modify: `apps/app/src/components/moderation/RefusedNotice.tsx`
- Modify: `apps/app/src/components/moderation/ReleaseNotice.tsx`
- Modify: `apps/app/src/components/moderation/ReportForm.tsx`
- Modify: `apps/app/src/components/moderation/UploadNotice.tsx`
- Modify: `apps/app/src/components/social/MediaGrid.tsx`
- Modify: `apps/app/src/components/social/PostCard.tsx`
- Modify: `apps/app/src/lib/explore.ts`
- Modify: `apps/app/src/lib/moderation-words.ts`
- Modify: `apps/app/src/lib/terms.ts`
- Modify: `apps/app/src/lib/ui-words.ts`
- Modify: `apps/app/test/browser/app.browser.ts`
- Modify: `apps/app/test/browser/fixture-api.ts`
- Modify: `apps/app/test/cases.test.tsx`
- Modify: `apps/app/test/legacy-files.ts`
- Modify: `apps/app/test/orders.test.tsx`

- [ ] **Step 1: Write the failing tests: `apps/app/test/status-sheet.test.tsx`, `apps/app/test/browser/app.browser.ts`, `apps/app/test/browser/fixture-api.ts`, `apps/app/test/cases.test.tsx`, `apps/app/test/legacy-files.ts`, `apps/app/test/orders.test.tsx`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/app/src/components/Prose.tsx`, `apps/app/src/components/moderation/StatusSheet.tsx`, `apps/app/src/components/moderation/parts.tsx`, `apps/app/src/app/explore/about.tsx`, `apps/app/src/app/notice/[ref].tsx`, `apps/app/src/app/report.tsx`, `apps/app/src/app/rules.tsx`, `apps/app/src/app/settings/cases/[id].tsx`, `apps/app/src/app/settings/cases/[id]/reply.tsx`, `apps/app/src/app/settings/cases/index.tsx`, `apps/app/src/app/settings/cases/releases/[id].tsx`, `apps/app/src/app/settings/cases/uploads/[id].tsx`, `apps/app/src/app/terms.tsx`, `apps/app/src/app/transparency.tsx`, `apps/app/src/components/ScreenHeader.tsx`, `apps/app/src/components/kit/PublicFrame.tsx`, `apps/app/src/components/kit/StatusChip.tsx`, `apps/app/src/components/moderation/CasesLists.tsx`, `apps/app/src/components/moderation/DecisionDetail.tsx`, `apps/app/src/components/moderation/ItemLines.tsx`, `apps/app/src/components/moderation/NoticeStatusView.tsx`, `apps/app/src/components/moderation/RefusedNotice.tsx`, `apps/app/src/components/moderation/ReleaseNotice.tsx`, `apps/app/src/components/moderation/ReportForm.tsx`, `apps/app/src/components/moderation/UploadNotice.tsx`, `apps/app/src/components/social/MediaGrid.tsx`, `apps/app/src/components/social/PostCard.tsx`, `apps/app/src/lib/explore.ts`, `apps/app/src/lib/moderation-words.ts`, `apps/app/src/lib/terms.ts`, `apps/app/src/lib/ui-words.ts`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm -r --if-present run test --testTimeout=20000`, expecting `Tests  `**
- [ ] **Step 6: export: run the `export` command in the prompt, expecting `Exported`**
- [ ] **Step 7: app-browser: run `pnpm --filter @korbat/app test:browser`, expecting `Tests  34 passed (34)`**
- [ ] **Step 8: Commit: `feat(app): moderation surfaces and the public pages: the author's chip on a withheld or removed post is the button that opens components/moderation/StatusSheet.tsx, named by its words, which reads GET /api/moderation/decisions/:id each time it opens and keeps the answer in its own state, with skeleton blocks while it waits, ErrorState's Try again, and labelled blocks in the design's order (Rule, What it does, Applies to, Who can see it now, Decided by in role terms, When, Statement with Read the full decision, and Appeal, first while one can be filed, which opens the decision with ?appeal=1 and its field focused); a grid that holds a hidden image gains Why are images hidden? to /rules; DecisionDetail, the Cases lists, the report form, a report's status and the notices move onto the tokens as cards, rows and labelled lines, Cases on Tabs; the case screens, /report and /notice take their titles in ScreenHeader with skeletons inside the shell; /rules, /transparency and How Explore works read in components/Prose.tsx's layout and the terms in PublicFrame's 640 px column; the browser check gains steps 32 to 34`**

### Task 8: Settings, security, auth and Appearance: section 8.8's Appearance and accessibility page, open signed out, with its radio groups, Reading switches, sample post and On this device, the Settings index the nav's Settings item opens, Security, Privacy, Profile, Account and components/security on the kit, and section 8.10's sign-in flow and token pages in PublicFrame, with the theme's cross-fade and the legacy lists emptied.

**Prompt:** `docs/superpowers/prompts/interface-experience-ui/08-settings-security-auth-appearance.md`

**Files:**
- Create: `apps/app/src/app/settings/appearance.tsx`
- Create: `apps/app/src/app/settings/index.tsx`
- Create: `apps/app/src/lib/auth-words.ts`
- Create: `apps/app/src/lib/lockdown-words.ts`
- Create: `apps/app/src/lib/settings-words.ts`
- Create: `apps/app/test/appearance-page.test.tsx`
- Modify: `apps/app/src/app/(auth)/_layout.tsx`
- Modify: `apps/app/src/app/(auth)/age.tsx`
- Modify: `apps/app/src/app/(auth)/code.tsx`
- Modify: `apps/app/src/app/(auth)/handle.tsx`
- Modify: `apps/app/src/app/(auth)/mfa.tsx`
- Modify: `apps/app/src/app/(auth)/password.tsx`
- Modify: `apps/app/src/app/(auth)/signin.tsx`
- Modify: `apps/app/src/app/email-revert/[token].tsx`
- Modify: `apps/app/src/app/not-me/[token].tsx`
- Modify: `apps/app/src/app/passkey-remove/[token].tsx`
- Modify: `apps/app/src/app/settings/_layout.tsx`
- Modify: `apps/app/src/app/settings/account.tsx`
- Modify: `apps/app/src/app/settings/privacy.tsx`
- Modify: `apps/app/src/app/settings/profile.tsx`
- Modify: `apps/app/src/app/settings/security.tsx`
- Modify: `apps/app/src/app/u/[handle]/index.tsx`
- Modify: `apps/app/src/components/AppShell.tsx`
- Modify: `apps/app/src/components/SettingsNav.tsx`
- Modify: `apps/app/src/components/kit/ListRow.tsx`
- Modify: `apps/app/src/components/kit/StatusChip.tsx`
- Modify: `apps/app/src/components/kit/Tabs.tsx`
- Modify: `apps/app/src/components/security/MfaSection.tsx`
- Modify: `apps/app/src/components/security/PasskeysSection.tsx`
- Modify: `apps/app/src/components/security/ReauthPanel.tsx`
- Modify: `apps/app/src/components/security/SessionsSection.tsx`
- Modify: `apps/app/src/components/ui.tsx`
- Modify: `apps/app/src/lib/terms.ts`
- Modify: `apps/app/src/lib/ui-words.ts`
- Modify: `apps/app/src/theme/ThemeProvider.tsx`
- Modify: `apps/app/src/theme/fonts.web.ts`
- Modify: `apps/app/src/theme/motion.ts`
- Modify: `apps/app/test/browser/app.browser.ts`
- Modify: `apps/app/test/browser/watch.ts`
- Modify: `apps/app/test/cases.test.tsx`
- Modify: `apps/app/test/composer.test.tsx`
- Modify: `apps/app/test/kit.test.tsx`
- Modify: `apps/app/test/legacy-files.ts`
- Modify: `apps/app/test/lifecycle.test.tsx`
- Modify: `apps/app/test/passkeys.test.tsx`
- Modify: `apps/app/test/shell.test.tsx`
- Modify: `apps/app/test/terms.test.tsx`

- [ ] **Step 1: Write the failing tests: `apps/app/test/appearance-page.test.tsx`, `apps/app/test/browser/app.browser.ts`, `apps/app/test/browser/watch.ts`, `apps/app/test/cases.test.tsx`, `apps/app/test/composer.test.tsx`, `apps/app/test/kit.test.tsx`, `apps/app/test/legacy-files.ts`, `apps/app/test/lifecycle.test.tsx`, `apps/app/test/passkeys.test.tsx`, `apps/app/test/shell.test.tsx`, `apps/app/test/terms.test.tsx`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/app/src/app/settings/appearance.tsx`, `apps/app/src/app/settings/index.tsx`, `apps/app/src/lib/auth-words.ts`, `apps/app/src/lib/lockdown-words.ts`, `apps/app/src/lib/settings-words.ts`, `apps/app/src/app/(auth)/_layout.tsx`, `apps/app/src/app/(auth)/age.tsx`, `apps/app/src/app/(auth)/code.tsx`, `apps/app/src/app/(auth)/handle.tsx`, `apps/app/src/app/(auth)/mfa.tsx`, `apps/app/src/app/(auth)/password.tsx`, `apps/app/src/app/(auth)/signin.tsx`, `apps/app/src/app/email-revert/[token].tsx`, `apps/app/src/app/not-me/[token].tsx`, `apps/app/src/app/passkey-remove/[token].tsx`, `apps/app/src/app/settings/_layout.tsx`, `apps/app/src/app/settings/account.tsx`, `apps/app/src/app/settings/privacy.tsx`, `apps/app/src/app/settings/profile.tsx`, `apps/app/src/app/settings/security.tsx`, `apps/app/src/app/u/[handle]/index.tsx`, `apps/app/src/components/AppShell.tsx`, `apps/app/src/components/SettingsNav.tsx`, `apps/app/src/components/kit/ListRow.tsx`, `apps/app/src/components/kit/StatusChip.tsx`, `apps/app/src/components/kit/Tabs.tsx`, `apps/app/src/components/security/MfaSection.tsx`, `apps/app/src/components/security/PasskeysSection.tsx`, `apps/app/src/components/security/ReauthPanel.tsx`, `apps/app/src/components/security/SessionsSection.tsx`, `apps/app/src/components/ui.tsx`, `apps/app/src/lib/terms.ts`, `apps/app/src/lib/ui-words.ts`, `apps/app/src/theme/ThemeProvider.tsx`, `apps/app/src/theme/fonts.web.ts`, `apps/app/src/theme/motion.ts`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm -r --if-present run test --testTimeout=20000`, expecting `Tests  `**
- [ ] **Step 6: export: run the `export` command in the prompt, expecting `Exported`**
- [ ] **Step 7: app-browser: run `pnpm --filter @korbat/app test:browser`, expecting `Tests  39 passed (39)`**
- [ ] **Step 8: Commit: `feat(app): settings, security, the sign-in flow and Appearance: app/settings/appearance.tsx, the one settings page open signed out (the settings layout lets its path through, and the signed-out nav gains Appearance after Sign in), applies each choice at once through lib/appearance.ts: Theme with Dark style under System, Text size with a sample post that follows it, Font and Reduce motion as radio groups that are one tab stop each and whose arrows choose at once, the Reading switches (Hide counts hides follower counts too), Haptics on iOS and Android only, and Clear what this device keeps with its toast; a change of theme cross-fades the colours over 200 ms, 150 ms reduced, never on first paint; the nav's Settings and a profile's settings button open the new Settings index, Appearance first; Security, Privacy, Profile and Account take their titles in ScreenHeader with cards of fields and rows, sessions as rows with a neutral this device chip, Blocked and Muted on Tabs; the sign-in screens and token pages move into PublicFrame, codes and handles in the mono face, the lockdown's sentences in one words module; the legacy lists are empty; the browser check gains steps 35 to 39`**

### Task 9: The console within its policy: section 9's restyle of apps/admin/src/app.css on the app's colour roles in light and dark with red kept as the console's mark, its type, mono ids and clocks, dense tables, one focus rule, status washes, colour-only motion and screens, the case's sticky composer column from 1200 px, and apps/admin/test/contrast.test.ts holding every pair the console draws to WCAG AA.

**Prompt:** `docs/superpowers/prompts/interface-experience-ui/09-console-within-its-policy.md`

**Files:**
- Create: `apps/admin/test/contrast.test.ts`
- Modify: `apps/admin/src/app.css`

- [ ] **Step 1: Write the failing tests: `apps/admin/test/contrast.test.ts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `apps/admin/src/app.css`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm -r --if-present run test --testTimeout=20000`, expecting `Tests  `**
- [ ] **Step 6: admin-build: run `pnpm --filter @korbat/admin build 2>&1 | tail -2 && ls apps/admin/dist apps/admin/dist/assets | sed -E 's/-[A-Z0-9]{8}[.]/-HASH./'`, expecting `Build success`, `index.html`, `main-HASH.js`, `main-HASH.css`**
- [ ] **Step 7: admin-browser: run `pnpm --filter @korbat/admin test:browser`, expecting `Tests  79 passed (79)`**
- [ ] **Step 8: Commit: `feat(admin): the console within its policy: app.css's two :root blocks take the app's roles at its Light and Dark values (three surfaces, two lines, three inks), the review, restricted and ok triples, red kept as the console's mark (#991B1B, and #D13438 as a fill with #FF7B72 as text in dark) with white on it and a blue focus ring, and the old names as aliases no rule reads; one 2 px focus rule; meta in ink-low; ids, times, hashes and the order's clock in the system's mono face with tabular figures; tables dense from 600 px, their head sticky inside its own scroll; the suspect banner on the restricted wash, the Art. 18 check and the author's standing on the review wash, each with a 4 px rule at its start, and every error line ruled too; quiet tabs in the masthead, Sign-in and Enroll as one 440 px card, Home's blocks as panels; the case from 1200 px in two columns with the composer sticky in the second; only colours ease, over 120 ms; test/contrast.test.ts holds every pair the console draws in both schemes`**

### Task 10: Documentation and the walk-through: section 15 from the dry run, the README's The interface and Third-party notices, the console's tokens in apps/admin/README.md, the main design's section 5 marked delivered with its 2026-10-21 amendment and the 2c design's section 20, the check that no rewritten file is left on a legacy list, and the walk-through at 360, 768 and 1280 px in the three themes.

**Prompt:** `docs/superpowers/prompts/interface-experience-ui/10-documentation-and-walk-through.md`

**Files:**
- Create: `apps/admin/test/tables.test.ts`
- Modify: `README.md`
- Modify: `apps/admin/README.md`
- Modify: `apps/admin/src/app.css`
- Modify: `apps/app/src/components/AppShell.tsx`
- Modify: `apps/app/test/a11y.test.tsx`
- Modify: `apps/app/test/browser/app.browser.ts`
- Modify: `apps/app/test/kit.test.tsx`
- Modify: `apps/app/vitest.browser.config.mts`
- Modify: `docs/superpowers/specs/2026-09-03-korbat-design.md`
- Modify: `docs/superpowers/specs/2026-09-28-explore-2c-design.md`
- Modify: `docs/superpowers/specs/2026-10-21-interface-experience-ui-design.md`

- [ ] **Step 1: Write the failing tests: `apps/admin/test/tables.test.ts`, `apps/app/test/a11y.test.tsx`, `apps/app/test/browser/app.browser.ts`, `apps/app/test/kit.test.tsx`, `apps/app/vitest.browser.config.mts`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm test`, expecting `Tests  `, `failed`**
- [ ] **Step 3: Write the implementation: `README.md`, `apps/admin/README.md`, `apps/admin/src/app.css`, `apps/app/src/components/AppShell.tsx`, `docs/superpowers/specs/2026-09-03-korbat-design.md`, `docs/superpowers/specs/2026-09-28-explore-2c-design.md`, `docs/superpowers/specs/2026-10-21-interface-experience-ui-design.md`**
- [ ] **Step 4: typecheck: run `pnpm typecheck`**
- [ ] **Step 5: test: run `pnpm -r --if-present run test --testTimeout=20000`, expecting `Tests  `**
- [ ] **Step 6: admin-build: run `pnpm --filter @korbat/admin build 2>&1 | tail -2 && ls apps/admin/dist apps/admin/dist/assets | sed -E 's/-[A-Z0-9]{8}[.]/-HASH./'`, expecting `Build success`, `index.html`, `main-HASH.js`, `main-HASH.css`**
- [ ] **Step 7: admin-browser: run `pnpm --filter @korbat/admin test:browser`, expecting `Tests  79 passed (79)`**
- [ ] **Step 8: export: run the `export` command in the prompt, expecting `Exported`**
- [ ] **Step 9: app-browser: run `pnpm --filter @korbat/app test:browser`, expecting `Tests  40 passed (40)`**
- [ ] **Step 10: test-database-fresh: run `node scripts/test-db.mjs --fresh -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `test database ready: korbat_test`**
- [ ] **Step 11: integration-fresh: run the `integration-fresh` command in the prompt, expecting `Tests  `**
- [ ] **Step 12: test-database-upgrade: run `node scripts/test-db.mjs --upgrade-from 42 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `migrations up to 0042_review_words applied and committed`, `later migrations applied as one batch`, `test database ready: korbat_test`**
- [ ] **Step 13: integration-upgraded: run the `integration-upgraded` command in the prompt, expecting `Tests  `**
- [ ] **Step 14: timing: run the `timing` command in the prompt, expecting `timing-ok=1`**
- [ ] **Step 15: stack-down: run `docker compose -f infra/compose.yml -f infra/compose.dev.yml down && echo down-ok`, expecting `down-ok`**
- [ ] **Step 16: build: run the `build` command in the prompt, expecting `build-exit=0`**
- [ ] **Step 17: stack-up: run `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --wait && echo up-ok`, expecting `up-ok`**
- [ ] **Step 18: test-database: run `node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml`, expecting `migrations applied`, `test database ready: korbat_test`**
- [ ] **Step 19: smoke: run the `smoke` command in the prompt, expecting `smoke test passed`**
- [ ] **Step 20: stack-stop: run the `stack-stop` command in the prompt, expecting `postgres-1 Up`**
- [ ] **Step 21: Commit: `docs(design,readme,app,admin): the UI sub-project's record and walk-through: README.md gains The interface (the three themes and System, Appearance's choices applied at once, theme-boot.js, what the browser keeps under korbat.appearance, korbat.place.<account id> and korbat.drafts.<account id> and when the session's end or Clear what this device keeps clears them, haptics, the bundled fonts, the budgets with the 791,297-byte cap, the app's browser check and how to run it, the console's look) and Third-party notices; apps/admin/README.md's The look names the console's 21 tokens, the 10 aliases no rule reads and what test/contrast.test.ts holds; the main design marks section 5 delivered and section 9 gains 2026-10-21, the UI sub-project, with status and order; the 2c design gains section 20; a11y.test.tsx holds the 107 rewritten files off both legacy lists; the walk-through's two finds are fixed: the rail's items span its 80 px, so Bookmarks and Appearance stay whole (step 40), and a time in a console table keeps its line; the design's section 15 gains the dry run's amendments`**
