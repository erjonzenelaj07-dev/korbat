# korbat — screen-reader states on the web

**Date:** 2026-09-21
**Status:** approved design, ready for a plan
**Scope:** a follow-up to sub-projects 1a and 2a, found by the 2b browser check

## 1. Problem

The web app passes React Native's `accessibilityState` prop in eleven places in nine files, all written in 1a and 2a. react-native-web 0.21.2 drops that prop entirely: `createDOMProps` maps `aria-*` props and the flat legacy props (`accessibilityLabel`, `accessibilitySelected` and the like), but not the `accessibilityState` object, and the only two places that read the name (`TouchableWithoutFeedback` and `AccessibilityUtil/isDisabled`) never turn it into an attribute. Server-rendering the library shows it:

| Props | HTML |
|---|---|
| `accessibilityRole="tab" accessibilityState={{ selected: true }}` | `<div role="tab" tabindex="0">` |
| `accessibilityRole="tab" aria-selected` | `<div role="tab" aria-selected="true" tabindex="0">` |

So a screen reader never hears which tab or navigation item is current, whether Like or Repost is on, whether the terms box is ticked, or whether a button is busy. The 2b controls already use `aria-expanded` and `aria-busy` for this reason.

## 2. Decisions per control

Each control gets the state its ARIA role defines, checked against WAI-ARIA 1.2 and the ARIA Authoring Practices.

| Where | Control | Today | Change |
|---|---|---|---|
| `app/index.tsx` | Following / Latest tabs | `selected` | `aria-selected` on each tab; `accessibilityRole="tablist"` on the row |
| `app/settings/privacy.tsx` | Blocked / Muted tabs | `selected` | same as above |
| `app/u/[handle]/index.tsx` | Posts / Replies / Likes tabs | `selected` | same as above |
| `components/AppShell.tsx` | sidebar and bottom navigation links | `selected` | `aria-current="page"` on the active link only; `aria-selected` is not allowed on links |
| `components/social/PostCard.tsx` | Like and Repost | `selected` | `aria-pressed` (toggle buttons whose label never changes), through a new `pressed` prop on `Action`; absent for signed-out viewers |
| `components/social/PostCard.tsx` | Save / Saved | `selected` | nothing: the label already says the state, and `aria-pressed` on a changing label announces it twice |
| `components/social/ProfileList.tsx` | Follow / Following | `selected`, `busy` | `aria-busy` only, for the same reason |
| `components/security/ReauthPanel.tsx` | method choice | `selected` | `aria-pressed` on each method; it renders as a native `<button>`, so it is already keyboard-accessible |
| `app/(auth)/age.tsx` | terms checkbox | `checked` | `aria-checked` |
| `app/settings/privacy.tsx` | Unblock / Unmute | `busy` | `aria-busy` |
| `components/ui.tsx` | shared `Button` | `disabled`, `busy` | `aria-busy`; `disabled` already produces `aria-disabled` |

React Native 0.86's types declare `aria-selected`, `aria-checked`, `aria-busy`, `aria-disabled` and `aria-expanded`, and its `Role` union includes `tablist`. They do not declare `aria-pressed` or `aria-current`; TypeScript does not check hyphenated JSX attributes a component does not declare, so both compile, and react-native-web renders them. On native, which is sub-project 5, those two are ignored and the native builds get their own accessibility review.

## 3. Regression guard

The web app gets its first test runner: `vitest` 4.1.11, already in the lockfile for the API and the worker, so no new package version is locked. CI's `pnpm test` runs every package's `test` script, so the guard runs in CI without a workflow change.

`apps/app/test/a11y.test.tsx` has two parts:

1. **No `accessibilityState`.** It reads every `.ts` and `.tsx` file under `apps/app/src` and fails with the file and line of each `accessibilityState=` it finds. Before the fix it lists the eleven uses; after it, none.
2. **The states reach the HTML.** It server-renders react-native-web's `Pressable`, `Text` and `View` with the props from section 2 and expects `aria-selected="true"`, `role="tablist"`, `aria-pressed="true"` and `"false"`, `aria-current="page"`, `aria-checked="false"`, `aria-busy="true"` with `aria-disabled="true"`, and a native `<button>` with `aria-pressed` for a pressable `Text`. If a react-native-web upgrade changes any of these, the test says which.

`apps/app/vitest.config.mts` aliases `react-native` to `react-native-web`, so the test imports from `react-native` and is checked against React Native's own types. `react-dom/server` has no types in the workspace (`@types/react-dom` is not installed); a four-line declaration in `apps/app/test/` types the one function the test uses, `renderToStaticMarkup`, instead of adding a package.

## 4. Verification

- The test fails first with the eleven uses, then passes.
- `pnpm --filter @korbat/app typecheck` and the web export succeed; the API unit tests are unchanged.
- The lockfile check reports no new package versions.
- A browser check in the scratch stack signs in and reads the rendered attributes on the real screens: the three tab rows, both navigation layouts, Like, Repost, Save, Follow, the re-authentication panel, the age checkbox and a busy button.

## 5. Out of scope

- The 84 other legacy props (`accessibilityRole`, `accessibilityLabel`, `accessibilityLiveRegion`). react-native-web 0.21.2 still maps them and only warns in development. Moving them to `role` and `aria-*` touches nearly every screen and is better done together with the native builds.
- Tab panels (`aria-controls`, `role="tabpanel"`) and navigation landmarks. The tabs switch a list in place; the fix is about states reaching assistive technology.

## 6. Documentation

The 1a and 2a execution prompts show the files as they were first written. Their `00-README.md` files get a note naming the commit that replaced `accessibilityState`. Their `verify_prompts.py` scripts already report files that later sub-projects changed, so they are point-in-time checks and are not updated.

## 7. Amendments from the dry run (2026-09-21)

The fix was dry-run in the scratch clone with the gated runner before its execution prompt was written. Where the build differs from sections 1 to 6, this section is the verified version.

- The config is `vitest.config.mts`, not `.ts`. The web app's package has no `"type": "module"`, because Expo's own config files are CommonJS, and Vite warns that its coming native config loader will not load an ES-module `.ts` config in such a package. The test step forbids the warning.
- The config needs no JSX option: Vite compiles the test's TSX with React's automatic runtime as it stands (the test imports no `React` and passes).
- The test sorts the uses it finds, so its failure lists them in the same order on every filesystem.
- Red and green: before the component changes the test failed with `1 failed | 6 passed (7)` and named all eleven uses; after them, `7 passed (7)`. The lockfile gained three lines and no new package version.
- The browser check on the rebuilt scratch stack confirmed every state in section 2 except the terms checkbox, which sits behind sign-up and is covered by the test: tab lists with `aria-selected` that follows clicks, `aria-current="page"` in the sidebar and the phone layout's bottom bar, Like's `aria-pressed` turning true and back, Save and Follow carrying their state in the label, the re-authentication method as a native button with `aria-pressed="true"`, and `aria-busy` and `aria-disabled` on buttons.
- On `/settings/privacy` no navigation link is current: the Settings link points to `/settings/security`, and sighted users see no highlight there either. The fix mirrors what is shown; highlighting Settings for every settings page is a separate decision.
