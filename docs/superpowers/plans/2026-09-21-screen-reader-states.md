# korbat — Screen-reader States Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every control in the web app tells a screen reader its state (tabs, navigation links, toggle buttons, the terms checkbox and busy buttons), and a test keeps React Native's dropped `accessibilityState` prop out of the app.

**Architecture:** react-native-web 0.21.2 maps `aria-*` props to HTML and drops `accessibilityState`. Each of the eleven uses becomes the `aria-*` prop its role defines, the tab rows become tab lists, and a vitest test in the web app scans the source and server-renders react-native-web to pin the mapping the app relies on.

**Tech Stack:** Expo 57 with react-native-web 0.21.2 and React 19.2, vitest 4.1.11 (already in the lockfile), `react-dom/server` for the rendering test.

**Complete code:** the task's full files, commands and observed output are in `docs/superpowers/prompts/screen-reader-states/01-screen-reader-states.md`, generated from a verified dry run. This plan is the map. Where it and the prompt differ, the prompt wins.

**Spec:** `docs/superpowers/specs/2026-09-21-screen-reader-states-design.md`.

---

## File structure

- `apps/app/`: `vitest.config.mts` (Task 1)
- `apps/app/test/`: `a11y.test.tsx` (Task 1), `react-dom-server.d.ts` (Task 1)

## Tasks

### Task 1: Tabs, navigation, toggles, the terms checkbox and busy buttons expose their state to screen readers through aria props, and the web app's first test keeps accessibilityState out

**Prompt:** `docs/superpowers/prompts/screen-reader-states/01-screen-reader-states.md`

**Files:**
- Create: `apps/app/test/a11y.test.tsx`
- Create: `apps/app/test/react-dom-server.d.ts`
- Create: `apps/app/vitest.config.mts`
- Modify: `apps/app/package.json`
- Updated by the install step: `pnpm-lock.yaml`
- Modify: `apps/app/src/app/(auth)/age.tsx`
- Modify: `apps/app/src/app/index.tsx`
- Modify: `apps/app/src/app/settings/privacy.tsx`
- Modify: `apps/app/src/app/u/[handle]/index.tsx`
- Modify: `apps/app/src/components/AppShell.tsx`
- Modify: `apps/app/src/components/security/ReauthPanel.tsx`
- Modify: `apps/app/src/components/social/PostCard.tsx`
- Modify: `apps/app/src/components/social/ProfileList.tsx`
- Modify: `apps/app/src/components/ui.tsx`

- [ ] **Step 1: Write the failing tests: `apps/app/test/a11y.test.tsx`, `apps/app/test/react-dom-server.d.ts`, `apps/app/vitest.config.mts`, `apps/app/package.json`**
- [ ] **Step 2: Run them and confirm they fail: `pnpm install --config.minimum-release-age=0 >/dev/null 2>&1; pnpm --filter @korbat/app test`, expecting `Tests  1 failed | 6 passed (7)`, `app/(auth)/age.tsx:76`, `components/ui.tsx:56`**
- [ ] **Step 3: Write the implementation: `apps/app/src/app/(auth)/age.tsx`, `apps/app/src/app/index.tsx`, `apps/app/src/app/settings/privacy.tsx`, `apps/app/src/app/u/[handle]/index.tsx`, `apps/app/src/components/AppShell.tsx`, `apps/app/src/components/security/ReauthPanel.tsx`, `apps/app/src/components/social/PostCard.tsx`, `apps/app/src/components/social/ProfileList.tsx`, `apps/app/src/components/ui.tsx`**
- [ ] **Step 4: install: run `pnpm install --config.minimum-release-age=0`, expecting `Done in`**
- [ ] **Step 5: lockfile-age: run `node scripts/check-lockfile-age.mjs --base HEAD`, expecting `0 new package versions since HEAD; all at least 7 days old`**
- [ ] **Step 6: test: run `pnpm --filter @korbat/app test`, expecting `Tests  7 passed (7)`**
- [ ] **Step 7: typecheck: run `pnpm --filter @korbat/app typecheck`**
- [ ] **Step 8: states: run the `states` command in the prompt, expecting `aria-selected= 3`, `accessibilityRole="tablist" 3`, `aria-current= 2`, `aria-pressed= 2`, `aria-checked= 1`, `aria-busy= 4`, `accessibilityState= 0`**
- [ ] **Step 9: export: run `(cd apps/app && EXPO_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA npx expo export --platform web 2>&1 | tail -8)`, expecting `Exported`**
- [ ] **Step 10: api-unchanged: run `pnpm --filter @korbat/api test`, expecting `Tests  142 passed | 139 skipped (281)`**
- [ ] **Step 11: frozen-install: run `pnpm install --frozen-lockfile`, expecting `Done in`**
- [ ] **Step 12: Commit: `fix(app): tabs, navigation, toggles, the terms checkbox and busy buttons expose their state to screen readers through aria props; the web app's first test keeps accessibilityState out`**
