# korbat interface and experience (UI sub-project): design

Status: approved for the dry run on 2026-10-21 under the owner's standing instruction to finish the app (2026-10-20); decisions marked (owner) in section 2 were made by the orchestrator and can be changed by the owner. Inputs: the main design's section 5 (2026-09-03-korbat-design.md), a study of Bluesky's open-source app, an audit of the app and the console at 1222b87, and a check of every library against the 7-day release-age floor. One review round (build fit; people and values) shaped this text.

Written 2026-10-21 against the repository at main 1222b87 (clean tree). Inputs: korbat-scratch/research-ui/audit.md (the audit, cited "audit N"), korbat-scratch/research-ui/libraries.md (cited "libraries N"), korbat-scratch/research-ui/bluesky-study.md (cited "study N"), the main design docs/superpowers/specs/2026-09-03-korbat-design.md (cited "main design"), and the guidance of the frontend-design, emil-design-eng and apple-design skills. Paths are relative to the repository root unless they start with korbat-scratch. The design's six parts are joined in order into one file, docs/superpowers/specs/2026-10-21-interface-and-experience-ui-design.md, committed before Task 1 (section 13).

## 1. Context and scope

### 1.1 What the owner asked

On 2026-10-12 the owner approved this sub-project with these words: "I need such an impressive yet intuitive enough UI/UX that would release endorphin from humans brains when they use it. Something that would rival Instagram. Let's stand on the shoulders of giants here". The same day they added: "study bluesky-social, learn from it, point out its strong points and let's differ from Instagram in a good way". On 2026-10-20 they said: "finish the app".

The main design's section 5 is this sub-project's brief, and its roadmap row "UI" (main design, section 6) names what it delivers. The row sits after sub-project 3, which is complete, and before 3b import.

### 1.2 The idea in one paragraph

korbat is read the way a good newspaper is read: calmly, in order, to the end. Instagram keeps people by never letting a feed end, by ranking, and by counting. korbat delights by the opposite means. It keeps the reader's place to the post, says plainly when they are caught up, answers every touch at once with physical motion, and shows on the post itself what moderation did and who can see it. The look comes from korbat's own world. korbat reads as "the ravens" in Albanian, and a raven's black is not flat: it carries a violet sheen. So the themes are ink and paper with one violet accent, the display face is a soft, slightly wonky serif (Fraunces), and the text face is a sans drawn for low-vision legibility, which also keeps look-alike handles apart (Atkinson Hyperlegible). Boldness is spent in one place, the typography; everything else is quiet.

### 1.3 In scope

- Every route of apps/app (33 route files, audit 1.1), redrawn on one design system: tokens, fonts, icons, motion, owned components.
- Three themes (light, dim, dark) that follow the system by default, with a switch, a text-size step, a font choice and the motion and haptics switches.
- The feed that keeps the reader's place: a "N new posts above" pill, a "You were here" marker persisted per feed on the device, "You're all caught up" when it is true, typed feed rows, optional automatic loading, virtualised lists on web and native.
- The post as an article with one explicit open target, icon actions with optimistic updates and rollback, a menu with "Who sees this", "Copy link", "Delete" and "Report".
- The moderation surfaces on the author's own post: a status chip that opens a details sheet (rule, measure, scope, who in role terms, statement, appeal and its deadline), and, for readers, the one-line reason on a hidden image with a link to how korbat moderates. A lift-able cover over a restricted post is not built, because readers never receive one (decision 10).
- The composer as a sheet on phones and an inline card on wider screens, with required alt text, a progress ring, the draft kept on the device, a discard question only when there is content, and a "Your post was sent" toast with "View".
- A new settings page, Appearance and accessibility, and a Settings index, which the nav's Settings item opens, with Appearance first.
- Toasts, haptics by intent with an off switch, skeleton rows, empty and error states with one action each, an offline state, a branded error boundary, per-screen document titles.
- An automated browser check of the app in Chromium at 360, 768 and 1280 px, in three themes, with reduced motion on and off.
- The staff console restyled within its content security policy, in apps/admin/src/app.css, keeping every class name its tests find.
- The documentation: the README, the main design's section 5 marked delivered with a dated amendment, and a walk-through at three widths.

### 1.4 Out of scope, and where it goes

- Native-only polish waits for sub-project 5 (native builds): react-native-keyboard-controller (a native module Expo Go lacks), react-native-screens form sheets for the composer and menus, pinch-to-zoom and drag-to-dismiss tuned per platform in the lightbox, the expo-font config plugin with static TTF files, preferences that persist on native devices, haptics checked on real devices, state kept across an Android configuration change, app icons and the splash screen. Everything this sub-project builds runs on native through the same components, and section 14 lists what 5 finishes.
- Engagement surfaces wait for 2d: notifications, uploaded avatars, mentions as data, share cards with per-page Open Graph meta served by korbat, help on a new account's first visit, and the author's per-post "hide counts". The generated monogram of section 6.5 holds the place an uploaded avatar will take (decision 22).
- Search and hashtags stay out, as the 2a, 2c and 2026-09-30 decisions keep them out; exact handle lookup remains.
- Video, animated images and their autoplay setting stay out: 2b refuses animated images (2026-09-18-images-2b-design.md, line 29), so there is nothing to autoplay.
- A web manifest and a service worker (study 3.12) go to sub-project 4, with the offline page they would serve.
- Keyboard shortcuts on web (single-key shortcuts need an off switch under WCAG 2.1.4) go to sub-project 5's web polish list.

### 1.5 Internationalisation: out, with the strings kept ready

Decided: this sub-project ships English only and does not add Lingui. libraries.md (A.11) recommends adopting @lingui/core 6.9.1 now, English only, because the UI is rewritten anyway. That argument is weaker for korbat than for Bluesky. korbat already keeps its sentences in words modules (lib/moderation-words.ts, lib/standing.ts, lib/orders.ts, lib/explore.ts, lib/public-pages.ts, lib/terms.ts; audit 1.2), and about 830 test assertions compare rendered text with those constants (audit 4.1). Turning each constant into a Lingui descriptor would change every one of those assertions in a sub-project whose rule is that pinned sentences stay word for word. The macros also need a compiler plugin in two toolchains: babel-preset-expo for the app and esbuild for vitest, which runs no Babel (apps/app/vitest.config.mts). libraries.md says the Expo set-up was not tried (section 5), and the vitest side is not covered by any package it marks ADOPT.

What this sub-project does instead keeps a later switch mechanical:

- Every new visible sentence lives in a words module. The new module for this sub-project's words is apps/app/src/lib/ui-words.ts; screen-specific words join the module of their area.
- A source scan in apps/app/test/a11y.test.tsx refuses a JSX text child that is a bare string literal in src/app and src/components (the idea of Bluesky's avoid-unwrapped-text rule, study 2.11). Single punctuation characters are allowed. It starts with a list, `LEGACY_TEXT_FILES`, of the 34 files that hold bare sentences today (for example (auth)/age.tsx, ComposeSheet.tsx and PostCard.tsx's "Delete this post?"); each task that rewrites one of them moves its sentences into a words module, changes in the same commit any pin that reads the sentence from the screen's source (such as explore.test.tsx:239 on index.tsx), and takes the file off the list, as section 4.2 does for colours. Task 10 checks that no file the sub-project rewrote is still listed and records the rest.
- Layouts never truncate a label to fit: buttons, chips and tab labels wrap or grow, never clip, and the app's browser check fails on any label whose scrollWidth exceeds its clientWidth at 360 px (section 12.3), which is where a longer language would break first.
- Dates and times keep going through Intl in one place (lib/social.ts timeAgo and lib/time.ts, section 8.1).

A later i18n sub-project converts each words module into a catalogue. It is flagged for the owner in section 2 (decision 1), because the home state that korbat is offered in (3f, row 41) may not be English-speaking.

### 1.6 No new API route and no migration

Every screen of this design is built from data the client already receives (audit 5). The places where a richer contract would help are listed with the choice made:

- The details sheet of a status chip reads GET /api/moderation/decisions/:id when it opens. PostModeration does not grow (decision 11).
- "Who sees this" is built from the post, the session's /me and, for the author's own top-level post only, GET /api/posts/:id/explore when the sheet opens (audit 5.4).
- The "N new posts above" pill polls the existing timeline routes with `limit=50` (Pagination allows 1 to 50; packages/contracts/src/index.ts:24-27).
- The reading place is kept on the device, not on the server (decision 8).
- The context column carries no live transparency figures, as the 3d amendment of the main design decided ("no panel shows live transparency figures").

### 1.7 Rules this design keeps

- korbat's values: a chronological feed; no silent reach reduction; moderation visible on the post; pseudonymity (no contact upload, no phone number asked for in any flow of this design); no engagement dark patterns (no streaks, no infinite nudges, no re-engagement prompts, no badge counts on navigation, suggestions only where the reader goes looking).
- WCAG 2.2 AA everywhere, reduced motion respected everywhere, full keyboard use on web.
- The stack stays: Expo SDK 57.0.22, expo-router 57.0.21, NativeWind 4.2.7 on Tailwind 3.4.19, Reanimated 4.5.1 with worklets 0.10.1, gesture-handler 2.32.0, expo-image 57.0.5, react-native-web 0.21.2. The console stays React 19.2.3 with esbuild 0.28.2 and plain CSS under its policy.
- Supply chain: only libraries that libraries.md marks ADOPT, at its pins, with exact versions in package.json; no AGPL; fonts and icons bundled; no third-party analytics, crash reporting or session replay.
- Every visible sentence that a test pins today stays word for word, unless section 8 names the test that changes and why. Every accessible name and role that tests use stays.

### 1.8 Libraries this design adds

Every pin below is the one libraries.md gives (section 1.1), each published on or before 2026-10-13 and so past the 7-day floor of pnpm-workspace.yaml. Each is written as an exact version in apps/app/package.json. A read of the npm registry on 2026-10-21 found no pin a downgrade under the workspace's `trustPolicy: no-downgrade`: lucide-react, lucide-react-native and playwright-core come from a trusted publisher as their earlier versions do, the three @fontsource-variable packages carry provenance as theirs do, react-native-svg, sonner, sonner-native, class-variance-authority and clsx have no attestation on any version, and expo-haptics 57.0.3 has the pattern of expo 57.0.22 and the other expo-* modules the lockfile already holds. A task whose install is refused by the trust policy stops and reports; it never adds a trustPolicyExclude entry on its own.

| Package | Pin | Where it runs | What it does here |
|---|---|---|---|
| lucide-react | 1.55.0 | web (Icon.web.tsx) | The icon set as plain DOM svg |
| lucide-react-native | 1.55.0 | iOS, Android (Icon.tsx) | The same icons, same names, same version |
| react-native-svg | 15.15.4 | iOS, Android | Needed by lucide-react-native and sonner-native; Expo's tested version for SDK 57 |
| sonner | 2.0.8 | web (toast.web.tsx) | Toasts with a polite live region |
| sonner-native | 0.27.0 | iOS, Android (toast.tsx) | The same toast API on native |
| expo-haptics | 57.0.3 | iOS, Android | Haptics behind useHaptics(); nothing on web |
| class-variance-authority | 0.7.1 | everywhere | Variants of NativeWind classes (Button, IconButton, StatusChip, ListRow) |
| clsx | 2.1.1 | everywhere | cva's one dependency; the cn() helper |
| @fontsource-variable/fraunces | 5.3.0 | web | The display face's woff2 files |
| @fontsource-variable/atkinson-hyperlegible-next | 5.3.0 | web | The text face's woff2 files |
| @fontsource-variable/atkinson-hyperlegible-mono | 5.3.0 | web | The handle and code face's woff2 files |
| playwright-core (devDependency) | 1.63.0 | the app's browser check | Already locked for apps/admin; never `playwright install` |

Not added, with the reason from libraries.md: react-native-keyboard-controller (native module, sub-project 5), expo-font as a direct dependency (needed only for its config plugin, sub-project 5; on web the fonts are declared by korbat's own @font-face rules, section 4.3), @legendapp/list and @shopify/flash-list (FlatList stays, section 11.1), tailwind-merge and tailwind-variants (variants are written so they never conflict), expo-blur and expo-glass-effect (flat design), @gorhom/bottom-sheet, lottie-react-native and Rive (Reanimated covers the motion), @lingui/* (section 1.5), radix-ui, @base-ui/react and motion (the console needs none of them: native dialog, details and select elements and CSS transitions do its work).

The font packages carry the SIL Open Font License 1.1; Task 1 copies each package's licence file (the OFL text) into apps/app/assets/fonts/LICENSES/, and a new README section, "Third-party notices" (Task 10), names them. No font file is subset or renamed, so no Reserved Font Name question arises (libraries 2).

## 2. Decisions flagged for the owner

Each decision is made and built as written. The owner can change any of them; the alternative says what changing it costs. All are marked (owner).

1. **Internationalisation (owner).** Chosen: English only in this sub-project; no Lingui; every new sentence in a words module and a source scan against bare strings (section 1.5). Alternative: adopt @lingui/core, @lingui/react, @lingui/babel-plugin-lingui-macro and @lingui/cli 6.9.1 now, as libraries.md (A.11) recommends, with an English catalogue. It costs a Babel plugin in apps/app/babel.config.js that nobody has tried under Expo SDK 57, a macro transform in vitest (which runs esbuild, not Babel), and a rewrite of about 830 test assertions that compare rendered text with words constants. It becomes the cheaper path only if a second language is needed before sub-project 4.
2. **The console's font (owner).** Chosen: the console keeps its system font stack and its policy keeps no font-src, so default-src 'none' still blocks every font file. Handles and ids in the console use the system monospace stack (ui-monospace, "Cascadia Mono", Consolas), which already tells l from 1 and O from 0. Alternative: add `font-src 'self'` to CONSOLE_CSP in apps/admin/site-headers.mjs and to infra/caddy/Caddyfile line 204, change the literal pinned in apps/admin/test/dev-server.test.ts (line 56) and the browser check's rule that /assets/ holds only .css and .js (apps/admin/test/browser/console.browser.ts, first step), measure the zero-report policy again as console-lab.md did, and bundle the two Atkinson Hyperlegible woff2 files through esbuild's file loader. That gives staff the app's anti-impersonation face; it loosens a policy that has been measured clean, for a look.
3. **The accent (owner).** Chosen: one violet accent, the raven's sheen, for every action and only for actions: #5A33D6 in light, #B9A6FF in dim, #B4A0FF in dark (section 4.2). Alternative: no hue at all, keeping today's white-on-dark primary button and sky links; or a teal accent. Neither violet nor teal is told apart from verified blue by every reader (under protanopia the Dark accent and verified blue are almost one colour), so the verified chip keeps its icon and word in every case.
4. **The faces, and handles in a mono face (owner).** Chosen: Fraunces for display (screen titles, profile names, empty-state titles), Atkinson Hyperlegible Next for text, and Atkinson Hyperlegible Mono for handles, so `@korbat_1` and `@korbat_l` differ at a glance (libraries 2). This amends the main design's section 5, which put handles in the display face. Alternative: handles in Fraunces as section 5 wrote; or Instrument Serif as the display face (libraries 2) if Fraunces reads too warm.
5. **Themes and the default (owner).** Chosen: Light, Dim and Dark; the default is "System", which picks Light, or the reader's dark style (Dark unless they pick Dim) when the system is dark. Alternative: Dark by default whatever the system says, the strictest reading of "dark-first".
6. **Paging (owner).** Chosen: "Load more" stays the default at the end of each page, as korbat has it today; a setting, "Load older posts automatically", turns on loading as the reader nears the end; below the "You were here" marker older posts load only by the button, whatever the setting. Alternative: automatic loading by default, as Instagram and Bluesky do.
7. **New posts (owner).** Chosen: Following and Latest ask for new posts 30 seconds after they open and then every 60 seconds, only while the feed is on screen and the page is visible; the only sign is the pill inside the feed. No dot on the Home tab, no count in the page title, nothing while korbat is in the background. Alternative: Bluesky's dot on the Home tab.
8. **Where the reading place lives (owner).** Chosen: on the device only (localStorage on web, keyed by account and feed), cleared at sign-out and whenever the app finds its session gone, and listed with a "Clear what this device keeps" button on the Appearance page (section 8.8); it is not synced between devices and needs no new route. Alternative: a server-side marker per account and feed, which syncs devices and costs a migration and a route.
9. **Where a feed opens (owner).** Chosen: Following and Latest open where the reader left off, when that post is among the newest 100, with "N new posts above"; otherwise at the newest post. A setting, "Open feeds at the newest post", changes it. Alternative: always open at the newest post, as most apps do.
10. **Covers for readers (owner).** Chosen: no reader-side cover for a restricted post, because readers never receive one (apps/api/src/social/visibility.ts:20-38, the 3c access rule). The one place a reader meets moderation, the placeholder of a hidden image, keeps its one-line reason ("Image hidden by korbat moderation"), and the row under the post's images gains a link, "Why are images hidden?", to /rules; there is nothing to lift, since the image never reaches the reader. Alternative: deliver withheld posts to readers behind a cover they can lift (study 4.3); that reverses 3c's access rule and would show the R1 and R4 content that a withhold exists to stop.
11. **What the chip says (owner).** Chosen: the chip keeps today's words (chipText, for example "Removed: R3, strike until 4 Dec"); the appeal deadline, the measure and who decided appear in the details sheet, which reads the decision when it opens. Alternative: grow PostModeration with `appealUntil` and the appeal's state so the chip itself reads "appeal open until 12 Nov" (study 4.3); that is a contract change and a wider chipFacts query, with no migration.
12. **The post's controls (owner).** Chosen: the visible row is Reply, Repost and Like as icons with counts, and Save; Repost opens a menu with Repost and Quote; a More menu holds Who sees this, Copy link, Delete (own posts) and Report (others' posts). Report leaves the visible row. Alternative: keep Report visible in the row, as today.
13. **The colour of a like (owner).** Chosen: every action the reader has turned on (liked, reposted, saved) shows in the accent violet with a filled icon (reposted: a ringed disc, since its icon has no closed shape, section 4.7); there is no red heart. Alternative: a rose heart, Instagram's convention, which also sits near the red of "Removed".
14. **Popular now (owner).** Chosen: Popular now leaves the context column, which keeps the handle box and gains a "How korbat works" card (chronological feed, no silent reach reduction, the rules and the transparency page). Explore stays one tap away as Home's third tab, whose list starts with the same posts. Reason: this design's rule that suggestions appear only where the reader goes looking (study 4.11). Alternative: keep Popular now on every screen at 1024 px and wider, as the 2c design's section 11 built it.
15. **Hiding counts (owner).** Chosen: the reader's setting "Hide like, repost and follower counts" hides like and repost counts on every post and the follower and following numbers on every profile (the links stay, as "Followers" and "Following"), their own included; reply and quote counts stay, because they lead to conversation. Alternative: hide like and repost counts only, or all four post counts.
16. **Document titles (owner).** Chosen: each screen sets its browser tab title on the client now ("Home - korbat", "Profile - korbat", "Post - korbat"), because WCAG 2.4.2 asks for it; a title names the kind of screen and never an account, so a synced browser history holds no handles (the h1 inside the page names the account); the server-rendered titles and Open Graph meta of share cards stay in 2d. Alternative: leave every title to 2d, as the 2026-09-30 amendment of the main design moved "per-page titles" there.
17. **Autoplay (owner).** Chosen: no autoplay setting, because korbat has no moving media (2b refuses animated images). Alternative: show the setting greyed out with that sentence.
18. **Drafts on the device (owner).** Chosen: the composer keeps its text (not its images) in localStorage per context (new post, reply to a post, quote of a post) until it is posted or discarded; sign-out, or the app finding its session gone (revoked, expired or signed out elsewhere), clears every draft (section 8.8). Alternative: keep no draft, since anyone holding the unlocked device could read it.
19. **The desktop composer (owner).** Chosen: at 768 px and wider, Home shows the composer as a one-line card ("What's on your mind?") that opens in place on focus or click and closes back when it is empty and loses focus. Alternative: the composer always open, as today.
20. **The app's browser check (owner).** Chosen: the app gains a Chromium walk like the console's (section 12.3); each run builds the web export, which adds a few minutes to a batch end. Alternative: keep the server-rendered checks only, which cannot see layout, focus, motion or contrast as drawn.
21. **The console's theme (owner).** Chosen: the console follows the operating system's light or dark setting only, with no switch and no dim style, and keeps red as the mark that tells it apart from the app. Alternative: a switch in the masthead, kept in the console's local storage.
22. **Monogram avatars now (owner).** Chosen: every account gets a generated monogram (the first letter of its display name on a neutral disc) beside its posts, in lists and in the profile header, so the feed has its rhythm before 2d brings uploaded avatars into the same place (section 6.5). Alternative: stay text-first until 2d, as the 2026-09-30 amendment of the main design left the layout question to 2d's brainstorm.

## 3. What exists

A short summary of korbat-scratch/research-ui/audit.md; its sections hold the line numbers.

### 3.1 The app (apps/app)

- Routes: 33 files under apps/app/src/app (3 layouts, 30 screens; audit 1.1). The auth flow ((auth)/signin, code, password, mfa, age, handle) and the three token pages (email-revert/[token], not-me/[token], passkey-remove/[token]) sit in a centred column outside the shell. Home (index.tsx) has the tabs Following, Latest and Explore; the rest are bookmarks, explore/about, post/[id], u/[handle] with followers and following, report, notice/[ref], rules, transparency, terms, and settings (security, privacy, profile, account, cases with four detail screens).
- Shell: apps/app/src/components/AppShell.tsx already lays out three columns at 1024 px, two at 768 px and a bottom tab bar below 768 px, with the floating compose button on phones (audit 3.1). Its nav and tab bar are words only; its context column holds PopularNow and HandleBox.
- Design system: apps/app/src/components/ui.tsx (138 lines, 12 exports: Screen, Title, Body, Section, VerifiedChip, Field, Button, TextLink, TextButton, ErrorText, Notice, Loading). There are no tokens (tailwind.config.js has `theme: { extend: {} }`), no fonts, no icons, no light theme (bg-zinc-950 is painted per screen), about 590 raw colour classes, hex literals in five files, and no pressed, hover or focus styles of korbat's own (audit 2.1).
- Motion: Reanimated 4.5.1 is used only for useReducedMotion() in ComposeSheet.tsx, MediaGrid.tsx and MediaViewer.tsx (a 150 ms blurhash fade and the RN Modal slide). There are no haptics and no toasts.
- Lists: components/social/PagedList.tsx (FlatList, "Load more", pull to refresh, one empty or error text with "Try again"). A tab change or a new post remounts Home's list (index.tsx, homeListKey), so the place is kept only while the web stack keeps Home mounted.
- Posts: components/social/PostCard.tsx is a View, not an article; the body is a link to the post; the actions are the words Reply, Repost, Quote, Like, Save, Delete and Report; every action waits for the server, one at a time. StateChip and ExploreChip show on the author's own posts (amber while korbat decides, red once removed, emerald In Explore).
- Media: MediaGrid.tsx (own ratio 3:4 to 2:1 for one image, a 16:9 grid for two to four, an ALT toggle under the grid), MediaViewer.tsx (a Modal with Previous, Next, arrow keys and Escape, no animation), HiddenImage.tsx (the placeholders), ImageFault.tsx.
- Composer: Composer.tsx (counter "n/1000", required descriptions per image in ComposerImages.tsx, the Post button names what is missing), ComposeSheet.tsx (RN Modal, discard question), and the inline composer always open on Home at 768 px and wider.
- Words: kept outside components in apps/app/src/lib/moderation-words.ts, standing.ts, orders.ts, explore.ts, public-pages.ts and terms.ts, so markup can move while sentences stay.
- Storage on the device: localStorage holds only the device id (lib/api.ts:184-187) and the passkey suggestion's dismissal (lib/passkeys.ts:221-231). Native has no storage library.
- Web export: `expo export --platform web` with web.output "single" (app.json); public/index.html paints #09090b before the bundle and declares `color-scheme: dark`. The app's policy (infra/caddy/Caddyfile line 25) allows inline styles, fonts from self and data:, images from self, data: and blob:, scripts from self and challenges.cloudflare.com only.

### 3.2 The tests that guard the app

- apps/app/test: 19 files, 6,522 lines. They render with react-dom/server through react-native-web (vitest.config.mts aliases react-native to react-native-web) and match HTML as strings; there is no DOM, no testing-library and no snapshot (audit 4.1).
- 76 source reads in 9 files pin exact lines, some with class strings: announced.test.tsx:175 (StandingBanner's tone line), cases.test.tsx:598-599 (StateChip's amber line and surface classes), report.test.tsx:237-257 (MediaGrid and PostCard lines, the profile's Report link), explore.test.tsx:707-834 (privacy's Explore switch line, ExploreStatusLine, AppShell's `<PopularNow />` before `<HandleBox />`), lifecycle.test.tsx:73, 89, 188-241 (SettingsNav in every settings screen, the verified chip line, Field's `<TextInput\n ref={ref}`, Button's `<Pressable ref={ref}`), a11y.test.tsx:139 (`<Action ref={keepRef} label="Keep"`), passkeys.test.tsx:329, 380, 458, hidden-media.test.tsx:175-176. Each task below that rewrites a pinned file changes the pin in the same commit and keeps what it protects.
- a11y.test.tsx scans every source file: no accessibilityState, no hand-made link role, no imagebutton, no accessibilityViewIsModal, every Switch labelled.
- There is no browser check of the app (audit 6.1).

### 3.3 The console (apps/admin)

- React 19 without a router library: router.ts, App.tsx, Layout.tsx (masthead, nav "Console", the who line, IdleNotice), nav.tsx, ui.tsx, frames.tsx, media.tsx and 15 screen files (6,987 lines; Case.tsx and Composer.tsx are the largest).
- One stylesheet, apps/admin/src/app.css (627 lines): custom properties on :root for light and dark by prefers-color-scheme, stone neutrals, a red accent, the system font stack, a 4 px red top border on the masthead, one phone media query at 599 px with 44 px targets and tables collapsed to blocks. No motion, icons or web fonts.
- Its policy (apps/admin/site-headers.mjs and infra/caddy/Caddyfile line 204) has default-src 'none' and no font-src, style-src 'self' without 'unsafe-inline', and Trusted Types with no policy. apps/admin/test/source.test.ts forbids style props, any CSS file but app.css, and every HTML sink in src.
- Its tests pin 56 class attributes in the unit tests and about 35 CSS selectors in the browser walk (apps/admin/test/browser/console.browser.ts, 79 steps, 23 of them at 360 by 740 px with `cleanOnPhone()`: no horizontal scroll and every control at least 44 by 44 px). The walk fails on any policy report, console error, dialog, and any img or svg element in #root other than a case's evidence image.

### 3.4 Data the moderation surfaces can use (audit 5)

- On a post (PostView): `state`, `moderation` (decisionId, ruleId, legal, interim, strikeUntil, order) on the viewer's own withheld or removed post only, `inExplore` on the viewer's own listed post, media with `moderation` on the author's own restricted image, or `{ id, hidden: true, sealed? }`.
- On the account (/me): `standing` (strikes, measure, reporting restriction, retired handle) and `profile.showInExplore`.
- On request: GET /api/moderation/decisions/:id (DecisionView: rule, rules version, measures, source, decidedAt, appealUntil, appeal, strike, standing, askPerson), GET /api/posts/:id/explore (the author's Explore status).
- Readers never receive another account's restricted post (apps/api/src/social/visibility.ts:20-38): the UI must not invent a signal for one.

## 4. The design language

### 4.1 Principles

- **Calm, in order, to the end.** Nothing moves unless the reader moved it or asked for it. The feed has a place, a boundary and an end, and says so in words.
- **One bold thing: the type.** Fraunces sets screen titles, profile names and the few sentences that mark a moment ("You're all caught up"). Everything else is Atkinson Hyperlegible on flat surfaces, one violet accent, and lines instead of shadows.
- **Colour means something or nothing.** The accent marks what the reader can do and what they have done. Amber, red, blue and green mark status and nothing else. Neutrals carry everything else. No gradient, glass or blur anywhere (main design section 5).
- **Status is never colour alone.** Every status carries a word and an icon of its own, so it reads in greyscale, to a screen reader and to a colour-blind reader alike (section 4.8).
- **Answer every touch at once.** Feedback starts on press, not on release; actions update at once and roll back with a sentence if the server refuses; every motion can be interrupted and starts from where the element is.
- **Words do one job each.** Sentence case, plain verbs, the same name for an action from button to toast ("Post" makes "Your post was sent"); errors say what happened and what to do; empty screens offer the next step. No all-caps labels (the established "ALT" badge excepted, which tests pin), no middle-dot meta strings.

### 4.2 Colour tokens

The tokens live in code in one file, apps/app/src/theme/tokens.ts, which exports `THEMES: Record<"light" | "dim" | "dark", Record<ColorToken, string>>` with the hex values below, and `TEXT_PAIRS`, the list of foreground and background pairs the app draws text or controls with, each with its minimum ratio. The names are contrast-graded, after Bluesky's ALF (study 2.1): a name says what a colour is for and how much contrast it carries, never its hue.

- Surfaces: `surface` (the page), `surface-1` (raised: cards that float, sheets, menus, inputs, the composer card), `surface-2` (pressed and selected rows, skeletons, the wash under media).
- Lines: `line-low` (dividers between posts and sections; decorative, no contrast duty), `line-high` (the boundary of a control: inputs, secondary buttons, checkboxes; at least 3:1 under WCAG 1.4.11).
- Ink: `ink-high` (primary text, icons of the active nav item), `ink-medium` (secondary text: body of notices, post meta that matters), `ink-low` (tertiary text: times, counts, placeholders, captions, inactive icons; the floor, at least 4.5:1 on every surface).
- Accent: `accent` (filled primary buttons, the new-posts pill, the active tab's underline, the progress ring), `on-accent` (text and icons on `accent`), `accent-ink` (links, toggled-on actions, the active nav label), `accent-wash` (the background of the selected nav item and of a selected setting row), `focus` (the focus ring).
- Danger: `danger` (the fill of a destructive button: Delete, Discard), `on-danger`, `danger-ink` (error sentences).
- Status, each as a triple `-ink` (text and icon on a surface), `-wash` (the chip's background), `-on-wash` (text and icon on the wash): `review` (amber: under review, interim), `restricted` (red: removed, restricted, an authority's order), `verified` (blue: the verified chip), `explore` (green: In Explore).
- Fixed: `scrim` is rgba(0, 0, 0, 0.6) behind sheets and dialogs, and `media-badge` is rgba(0, 0, 0, 0.72) under the white text of the ALT and count badges on images (white on that badge over a white image is 9.29:1, the worst case).

The three themes:

- **Light** ("Day"): a cool feather-white page (#F6F5F9, deliberately not a cream), white raised surfaces, ink near black with a violet cast.
- **Dim** ("Dusk"): a slate-violet page for readers who find black too hard; every surface a step lighter than Dark.
- **Dark** ("Night", dark-first): the raven's ink (#100F16), with raised surfaces a step up and the sheen violet as the accent.

The values (`THEMES` in tokens.ts):

| Token | Light | Dim | Dark |
|---|---|---|---|
| surface | #F6F5F9 | #1B1A24 | #100F16 |
| surface-1 | #FFFFFF | #24232F | #18171F |
| surface-2 | #ECEAF1 | #2F2D3B | #22202B |
| line-low | #DDDAE4 | #3A3848 | #2B2935 |
| line-high | #827C90 | #807B93 | #726D82 |
| ink-high | #15131B | #F1EFF6 | #F3F1F7 |
| ink-medium | #45404F | #CCC8D8 | #C7C2D3 |
| ink-low | #625D6E | #A8A3B8 | #9C97AB |
| accent | #5A33D6 | #B9A6FF | #B4A0FF |
| on-accent | #FFFFFF | #170E33 | #170E33 |
| accent-ink | #5A33D6 | #B9A6FF | #B4A0FF |
| accent-wash | #ECE6FF | #332C55 | #251E42 |
| focus | #5A33D6 | #B9A6FF | #B4A0FF |
| danger | #C2261B | #D13438 | #D13438 |
| on-danger | #FFFFFF | #FFFFFF | #FFFFFF |
| danger-ink | #B42318 | #FF8A80 | #FF7B72 |
| review-ink | #8A4B00 | #F5B83D | #F5B83D |
| review-wash | #FCEFD2 | #3A2D17 | #2E2310 |
| review-on-wash | #6B3A00 | #FAD27A | #FAD27A |
| restricted-ink | #B42318 | #FF8A80 | #FF7B72 |
| restricted-wash | #FDE4E1 | #3D1A1F | #331418 |
| restricted-on-wash | #8A1C12 | #FFB4AC | #FFADA6 |
| verified-ink | #1F55C7 | #78B0FF | #6AA8FF |
| verified-wash | #E0EAFD | #1A2A45 | #12213A |
| verified-on-wash | #173F94 | #B0CEFF | #A5C8FF |
| explore-ink | #0B7350 | #4BD9A2 | #3DD39A |
| explore-wash | #DAF3E8 | #123328 | #0C2A20 |
| explore-on-wash | #075A3E | #93EDC9 | #86EBC3 |

The contrast of every pair in `TEXT_PAIRS`, computed with the WCAG 2.2 relative-luminance formula; text pairs need 4.5:1, control boundaries, the focus ring and filled controls against the page need 3:1:

| Foreground | Background | Minimum | Light | Dim | Dark |
|---|---|---|---|---|---|
| ink-high | surface | 4.5:1 | 16.96 | 15.10 | 17.00 |
| ink-high | surface-1 | 4.5:1 | 18.41 | 13.58 | 15.86 |
| ink-high | surface-2 | 4.5:1 | 15.43 | 11.81 | 14.31 |
| ink-medium | surface | 4.5:1 | 9.22 | 10.51 | 10.97 |
| ink-medium | surface-1 | 4.5:1 | 10.00 | 9.45 | 10.23 |
| ink-medium | surface-2 | 4.5:1 | 8.39 | 8.22 | 9.23 |
| ink-low | surface | 4.5:1 | 5.84 | 7.05 | 6.74 |
| ink-low | surface-1 | 4.5:1 | 6.34 | 6.34 | 6.29 |
| ink-low | surface-2 | 4.5:1 | 5.32 | 5.51 | 5.67 |
| accent-ink | surface | 4.5:1 | 6.72 | 8.17 | 8.54 |
| accent-ink | surface-1 | 4.5:1 | 7.29 | 7.34 | 7.97 |
| accent-ink | surface-2 | 4.5:1 | 6.11 | 6.39 | 7.19 |
| danger-ink | surface | 4.5:1 | 6.06 | 7.54 | 7.56 |
| danger-ink | surface-1 | 4.5:1 | 6.57 | 6.78 | 7.05 |
| danger-ink | surface-2 | 4.5:1 | 5.51 | 5.90 | 6.36 |
| review-ink | surface | 4.5:1 | 6.27 | 9.68 | 10.71 |
| review-ink | surface-1 | 4.5:1 | 6.80 | 8.70 | 10.00 |
| review-ink | surface-2 | 4.5:1 | 5.70 | 7.57 | 9.02 |
| restricted-ink | surface | 4.5:1 | 6.06 | 7.54 | 7.56 |
| restricted-ink | surface-1 | 4.5:1 | 6.57 | 6.78 | 7.05 |
| restricted-ink | surface-2 | 4.5:1 | 5.51 | 5.90 | 6.36 |
| verified-ink | surface | 4.5:1 | 6.08 | 7.75 | 7.86 |
| verified-ink | surface-1 | 4.5:1 | 6.60 | 6.97 | 7.33 |
| verified-ink | surface-2 | 4.5:1 | 5.53 | 6.06 | 6.61 |
| explore-ink | surface | 4.5:1 | 5.40 | 9.63 | 9.97 |
| explore-ink | surface-1 | 4.5:1 | 5.86 | 8.66 | 9.30 |
| explore-ink | surface-2 | 4.5:1 | 4.91 | 7.53 | 8.39 |
| ink-high | accent-wash | 4.5:1 | 15.19 | 11.28 | 13.95 |
| accent-ink | accent-wash | 4.5:1 | 6.02 | 6.10 | 7.01 |
| on-accent | accent | 4.5:1 | 7.29 | 8.68 | 8.21 |
| on-danger | danger | 4.5:1 | 5.85 | 4.93 | 4.93 |
| review-on-wash | review-wash | 4.5:1 | 8.26 | 9.29 | 10.68 |
| restricted-on-wash | restricted-wash | 4.5:1 | 7.70 | 9.06 | 9.39 |
| verified-on-wash | verified-wash | 4.5:1 | 7.98 | 8.98 | 9.43 |
| explore-on-wash | explore-wash | 4.5:1 | 7.07 | 9.93 | 10.74 |
| line-high | surface | 3:1 | 3.70 | 4.24 | 3.83 |
| line-high | surface-1 | 3:1 | 4.01 | 3.81 | 3.58 |
| focus | surface | 3:1 | 6.72 | 8.17 | 8.54 |
| focus | surface-1 | 3:1 | 7.29 | 7.34 | 7.97 |
| focus (Dark, forced) | lightbox stage over the page | 3:1 | 8.59 | 9.30 | 9.36 |
| accent | surface | 3:1 | 6.72 | 8.17 | 8.54 |
| accent | surface-1 | 3:1 | 7.29 | 7.34 | 7.97 |
| danger | surface | 3:1 | 5.39 | 3.49 | 3.87 |
| danger | surface-1 | 3:1 | 5.85 | 3.14 | 3.61 |

Every pair passes; the tightest are on-danger on danger in Dim and Dark (4.93:1), explore-ink on surface-2 in Light (4.91:1), and the danger fill against surface-1 in Dim (3.14:1). The fixes the audit asked for (audit 3.1) fall out of the tokens: a placeholder is ink-low on surface-1 (at least 6.29:1, where #71717a on zinc-900 gave 3.7:1), and a disabled button that carries its reason ("Describe every image") is ink-low on surface-2 (at least 5.32:1, where zinc-500 on zinc-800 gave 3.1:1).

How the tokens reach the screens:

- apps/app/global.css keeps its three @tailwind directives and gains one block of custom properties per theme: `:root` holds Light, `:root.dim` Dim and `:root.dark, .dark` Dark (the lightbox stage takes the class too, section 6.7), each token as an `R G B` triplet named `--k-<token>` (for example `--k-surface: 16 15 22;` in Dark).
- apps/app/tailwind.config.js maps each token to `rgb(var(--k-<token>) / <alpha-value>)` under `theme.extend.colors` (classes such as `bg-surface-1`, `text-ink-low`, `border-line-high`, `bg-review-wash`). It keeps `darkMode: "class"` and its comment; no screen uses a `dark:` variant, because the variables switch instead.
- On native, apps/app/src/theme/ThemeProvider.tsx wraps the app in a View whose style is NativeWind's `vars()` of the resolved theme, built from THEMES, so the same classes resolve on every platform.
- On web, the provider sets the class `light`, `dim` or `dark` on `<html>`, the `color-scheme` property, and the `theme-color` meta; the reader's appearance is kept in localStorage under `korbat.appearance` by apps/app/src/lib/appearance.ts, the only module in src that touches that key (ThemeProvider reads and writes through it), so the storage pin of explore.test.tsx:864-866 gains exactly that file in Task 1.
- The first paint before the bundle runs: the app's policy allows no inline script (script-src 'self' and Turnstile only; Caddyfile line 25), so a new file, apps/app/public/theme-boot.js (about 40 lines, served as /theme-boot.js with Cache-Control no-cache like the page), is loaded synchronously at the top of public/index.html's head. It reads `korbat.appearance`, resolves "System" with matchMedia, and sets the html class, `data-text-step`, `data-font`, the theme-color meta and color-scheme. The bundle's stylesheet, which holds the variables, has not arrived yet at that moment, so theme-boot.js also carries the three themes' surface and ink-high values and sets them as the html element's background and colour; contrast.test.ts checks they equal THEMES. public/index.html declares `color-scheme: light dark` instead of `dark`, and its reset keeps the Dark values for a browser without scripts; a reader with nothing stored and a light system sees Light from the first frame.
- The Turnstile widget ((auth)/signin.tsx:162, (auth)/password.tsx:59 and components/moderation/ReportForm.tsx:257, each `theme: "dark"` today) takes `theme: "light"` in Light and `"dark"` in Dim and Dark from useTheme().

The tests: apps/app/test/contrast.test.ts computes the ratio of every TEXT_PAIRS entry in every theme with the WCAG formula and fails below its minimum; it also parses global.css and fails when a variable differs from THEMES, so the two cannot drift. A source scan in the same file refuses Tailwind palette classes (a prefix such as text-, bg- or border- followed by zinc, sky, amber, red, emerald, rose or stone and a shade, as in `text-zinc-400`) and hex colour literals anywhere in apps/app/src except src/theme/tokens.ts; while the screens move over, a list `LEGACY_COLOUR_FILES` in the test names the files not yet converted, each task removes its own, and Task 8 empties it.

### 4.3 Type

Three families, bundled (libraries 2), and a scale applied by one Text component (section 6.2), never by per-screen size classes.

| Variant | Family and weight | Size / line height at Default | Tracking | Used for |
|---|---|---|---|---|
| display-1 | Fraunces 600, SOFT 50, WONK 1, optical size automatic | 34 / 40 | -0.02em | The profile's display name at 768 px and wider; the wordmark |
| display-2 | Fraunces 600 | 28 / 34 | -0.015em | Screen titles (Home, Bookmarks, Settings pages, auth titles); the profile's name on phones |
| display-3 | Fraunces 600 | 22 / 28 | -0.01em | Public pages' section headings, empty-state and marker titles ("You were here", "You're all caught up") |
| title | Atkinson Hyperlegible Next 700 | 18 / 24 | 0 | Section, sheet, dialog and card titles |
| post | Atkinson Hyperlegible Next 400 | 17 / 26 | 0 | Post bodies and quoted bodies (quoted at 15 / 22) |
| body | Atkinson Hyperlegible Next 400 | 15 / 22 | 0 | Everything else that is prose |
| body-strong | Atkinson Hyperlegible Next 700 | 15 / 22 | 0 | Display names in the author line, button labels, list row titles |
| meta | Atkinson Hyperlegible Next 400 | 13 / 18 | 0.005em | Times, counts, captions, helper text |
| chip | Atkinson Hyperlegible Next 700 | 12 / 16 | 0.01em | Chips and badges |
| mono | Atkinson Hyperlegible Mono 400 (700 in the profile header) | 14 / 20 | 0 | Handles everywhere, codes, references, ids |

- Fraunces is used at 22 px and up only (at the Default step), where its optical size reads as intended; below that, emphasis comes from weight.
- Tracking tightens as size grows and opens slightly below 14 px, after the apple-design guidance; leading is generous on prose (1.53 for posts) and tight on display (1.18 to 1.27).
- Italic exists for the text face only (Atkinson Hyperlegible Next Italic), used for tombstones ("This post was deleted by its author.").
- The text-size step multiplies size and line height together: Smaller 0.875, Default 1, Larger 1.125, Largest 1.25, rounded to whole pixels. On web the Text component writes sizes in rem, so the browser's own text-size setting scales them too, through one typed helper in kit/Text.tsx that holds the only cast (React Native types fontSize and lineHeight as numbers, and tsc gates every task); on native `allowFontScaling` stays on, so the operating system's text size multiplies the step, with `maxFontSizeMultiplier` 1.5 on chrome (tab labels, chips), 2 on other text and none on post bodies. Every box that holds text (the tab bar, Button, ListRow) sets its height as a minimum, never a fixed height.
- The font choice: "korbat fonts" (default) or "System font". With the system font, the text and display variants use `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` (display at 700 instead of Fraunces) and mono uses `ui-monospace, "Cascadia Mono", Consolas, monospace`.
- Loading on web: apps/app/src/theme/fonts.web.ts adds one style element with the @font-face rules for "Fraunces Variable" (the package's `full` files, which carry the opsz, SOFT and WONK axes), "Atkinson Hyperlegible Next Variable" (normal and italic `wght` files) and "Atkinson Hyperlegible Mono Variable" (normal `wght` file). Each family has a latin and a latin-ext rule whose unicode-range is copied from the package's own CSS, so latin-ext downloads only when a post needs it. The files are `require()`d from the three @fontsource-variable packages (their "./files/*" exports; woff2 joins Metro's asset extensions in metro.config.js), and on web such a require yields the file's URL string, which the @font-face src takes as it is; Metro hashes them into /assets/ (immutable in Caddy) and the policy's `font-src 'self'` serves them. `font-display: swap`; the fallback stack is the system font, so text never waits.
- Loading on native: apps/app/src/theme/fonts.ts resolves every family to the platform's system font until sub-project 5 embeds the static files with expo-font's config plugin (section 14). An unknown family name on iOS logs an error, so native never names a family it has not loaded.
- A unit test (apps/app/test/theme.test.ts) checks that every file fonts.web.ts names exists in node_modules, that each unicode-range equals the package CSS's, and that each family's licence file sits in apps/app/assets/fonts/LICENSES/.

### 4.4 Spacing

Tailwind's 4 px scale stays as it is. apps/app/src/theme/layout.ts names the few layout constants that screens share:

- Gutter: 16 px on phones, 20 px at 768 px and wider.
- Post padding: 16 px across, 12 px down; 12 px between the author line and the body; 8 px between body and media; 4 px above the action row.
- Between sections of a screen: 24 px; between a heading and its content: 8 px.
- Stacks use `gap` rather than a `mt-*` on every child, so a removed child leaves no stray margin.
- Touch targets: at least 44 by 44 px on every platform for every standalone control (a link inside running text needs 24 by 24 px, WCAG 2.5.8's inline exception; section 12.3), by padding and a minimum size on the element itself (so the browser check can measure it), with `hitSlop` added on native, larger than WCAG 2.5.8's 24 px and equal to the console's phone rule.
- Line length: prose blocks (post bodies, notices, public pages) stay under 70 characters per line at Default by the timeline's 600 px column.

### 4.5 Radii

A hierarchy of five, added under `theme.extend.borderRadius` in tailwind.config.js, so radius says what kind of thing a shape is:

| Name | Radius | Used for |
|---|---|---|
| control | 10 px | Buttons, inputs, menu items, segmented controls |
| media | 12 px | Images in posts, the quoted post's frame, image previews in the composer |
| card | 16 px | The composer card, notices, settings groups, the details sheet's blocks |
| sheet | 24 px | The top corners of sheets on phones and every corner of dialogs at 768 px and wider |
| full | 9999 px | Chips, the new-posts pill, the compose button, toggles |

### 4.6 Elevation

Flat. There is no shadow token and no shadow anywhere. Layers are told apart by a surface step and a line: a floating element (menu, sheet, dialog, toast, the new-posts pill) uses surface-1 with a 1 px line-high border in every theme (3.58 to 4.24:1 against surface and surface-1, the line-high rows of TEXT_PAIRS, which also stand for the floating boundary; a line-low edge would be 1.34:1 in Dark), and a modal layer adds the scrim behind it. The compose button is the accent with a 2 px ring in the page's surface colour, which separates it from whatever scrolls under it. Under `forced-colors: active` on web every floating element keeps a 1 px border in CanvasText, so it stays visible when the browser removes backgrounds.

### 4.7 Iconography

- One set: Lucide 1.55.0 (ISC), drawn by lucide-react on web and lucide-react-native on iOS and Android, same names and version on both (libraries A.4). Never Bluesky's icons.
- One component, Icon (section 6.3), takes a name from a closed list in apps/app/src/components/icons.ts that maps korbat's names to Lucide's export names as strings (`as const`), importing neither package. Icon.web.tsx imports the named components from lucide-react and Icon.tsx from lucide-react-native, each as a `Record<IconName, ...>`, so tsc refuses a missing icon on either side, only listed icons are bundled, and the web export and the unit tests never load lucide-react-native or react-native-svg.
- Stroke 1.75 at 24 px, scaled with the icon. Sizes: 24 in the nav and tab bar, 20 in post actions, buttons and rows, 16 inline with meta text, 14 in chips.
- On and off: Heart and Bookmark fill with currentColor when on; Repeat2 has no closed shape, so "reposted" draws it in accent-ink at stroke 2.25 inside a 28 px accent-wash disc with a 1.5 px accent ring (radius full, within the 44 px target; the ring carries 6.11 to 8.54:1 against the surfaces), and its count turns body-strong: a shape cue like the fill, never colour alone. The browser check compares a reposted and an idle button in a greyscale screenshot region.
- An icon is decoration (`aria-hidden`) unless it is the only content of a control, and then the control carries the name (Button requires `label`, section 6.1). No icon ever stands alone without a name.
- Icons with their names in icons.ts: home (House), bookmarks (Bookmark), profile (CircleUser), settings (Settings), compose (SquarePen), reply (MessageCircle), repost (Repeat2), quote (Quote), like (Heart), more (Ellipsis), who-sees (Eye), copy-link (Link), delete (Trash2), report (Flag), close (X), back (ArrowLeft), newer (ArrowUp), previous (ChevronLeft), next (ChevronRight), add-image (ImagePlus), error (CircleAlert), offline (WifiOff), done (CircleCheck), review (Clock), restricted (EyeOff: not shown to others, as on a hidden image; Lucide's Ban, a prohibition sign, is not used), verified (BadgeCheck), explore (Compass), hidden (EyeOff), security (Shield), privacy (Lock), edit-profile (UserPen), account (UserCog), cases (Scale), appearance (Palette), sign-in (LogIn), passkey (KeyRound), external (ExternalLink), info (Info), retry (RotateCw).
- The wordmark is "korbat" set in Fraunces 600, lowercase, at display-1; the favicon keeps its "k" monogram (public/index.html), drawn in the Dark theme's surface and ink-high.

### 4.8 Status colours, and never colour alone

| Status | Tokens | Icon | Words (existing constant) | Where |
|---|---|---|---|---|
| Under review (korbat decides; an interim measure) | review-ink, review-wash, review-on-wash | review (Clock) | CHIP_WORDS.underReview and chipText(), lib/moderation-words.ts and lib/moderation.ts | The author's own withheld post and image; an announced suspension's banner |
| Removed or restricted (a final measure, an authority's order) | restricted-ink, restricted-wash, restricted-on-wash | restricted (EyeOff) | CHIP_WORDS.removed, chipText(), lib/orders.ts:12 | The author's own removed post and image; a running suspension's banner |
| Verified | verified-ink, verified-wash, verified-on-wash | verified (BadgeCheck) | "Verified", label "verified account" (ui.tsx:44) | After a display name, in posts, lists and the profile |
| In Explore | explore-ink, explore-wash, explore-on-wash | explore (Compass) | "In Explore" | The author's own post while it is in the ranking |
| Hidden or sealed image | surface-2, ink-medium (neutral, not a status colour) | hidden (EyeOff) | HIDDEN_IMAGE, SEALED_IMAGE (HiddenImage.tsx) | In place of the image |
| Error | danger-ink | error (CircleAlert) | the error's sentence | ErrorText, failed rows, rolled-back actions |

Rules:

- Every status shows its icon and its words; the colour only repeats what they say. A chip is never a coloured dot.
- A chip's wash carries a 1 px border in its `-ink` colour at 40 percent opacity, and under forced colours a solid CanvasText border, so the chip keeps its shape when backgrounds are removed.
- The standing banner (StandingBanner.tsx) keeps its region "Your account's standing" and its level-2 first sentence (3e design 9.8); its amber or red becomes review or restricted wash with the icon at the start of the heading.
- Green is used for In Explore only, never as "success": a successful action shows the done icon in ink-high.
- Red is never used to decorate: the destructive buttons (Delete, Discard, the account's Delete) use `danger`, and nothing else is red but restrictions and errors.

## 5. Motion and feedback

### 5.1 Rules

- Motion answers the reader. Nothing animates on mount, on a count changing in data, or to draw the eye, with two exceptions: skeleton rows pulse and the centred spinner turns while something loads, because they show work in progress, and the check of "You're all caught up" draws itself once per session (5.2, caught-up).
- Feedback starts on press. Controls show their pressed state on pointer-down; surfaces that a scroll starts on (a post card's open area, a ListRow) show theirs after 80 ms and cancel it on 10 px of movement, so a scroll never flashes a row; actions change their state at once and roll back if the server refuses (section 6.6).
- Everything a finger can move is a Reanimated spring driven by a gesture-handler gesture, started from the element's current value, with the release velocity handed to the spring. Nothing waits for an animation to end before taking input.
- Enter and leave along one path: a sheet comes up from the bottom and leaves downwards; a menu grows from its trigger and shrinks back into it; the lightbox grows from its thumbnail and returns into it.
- Keyboard actions do not animate their content: arrow keys in the lightbox and in tabs switch at once, and a sheet or dialog opened from the keyboard uses its reduced form (a 150 ms fade).
- Only transform and opacity move on screen, with three exceptions that change layout once: the inline composer opening, a deleted post collapsing, and the rows making room for the reader's own new post, all through Reanimated layout transitions.
- Reduced motion has two sources: the operating system (useReducedMotion() on native, prefers-reduced-motion on web) and korbat's own setting "Reduce motion" (Follow the system, or Always). Either one switches every animation below to its reduced form. Reduced means no movement, not no feedback: colour and opacity changes stay, at 150 ms or less.

The values live in apps/app/src/theme/motion.ts:

| Name | Value | Use |
|---|---|---|
| ease-out | cubic-bezier(0.23, 1, 0.32, 1) | Entering, pressing, menus, the pill |
| ease-in-out | cubic-bezier(0.77, 0, 0.175, 1) | On-screen movement without a gesture (tab underline, scroll to the oldest unread new post) |
| spring-snap | damping ratio 1, duration 300 ms | Default spring: sheets opening, the lightbox growing, the tab underline |
| spring-release | damping ratio 0.85, duration 350 ms, with the gesture's velocity | After a drag or flick is released (sheets, lightbox) |
| press-in / press-out | 100 ms / 160 ms, ease-out | Pressed scale |
| fade | 150 ms ease-out | Reduced forms, the blurhash cross-fade |

A hook, useMotion() in apps/app/src/lib/motion.ts, returns `{ reduced, spring(name), timing(name) }`, so no component reads either source on its own and the browser check can flip both.

### 5.2 Every animation

| Name | Trigger | Property and value | Duration or spring | Interruption | Reduced form |
|---|---|---|---|---|---|
| press | Pointer or touch down on a button or icon button (scale); on a row or card (background, after 80 ms, cancelled by 10 px of movement) | buttons scale 0.97, icon buttons 0.92; rows and cards never scale, their background goes to surface-2 | press-in, press-out | Release or a second press retargets from the current scale | No scale; the background change only |
| hover | Web, `(hover: hover) and (pointer: fine)` only | Background surface-2 on rows, icon buttons and nav items | 120 ms ease | Retargets | Same (a colour change) |
| like | The reader turns Like on | One underdamped spring on release from the pressed scale (0.92) to 1, with an initial velocity of 10 scale units per second, so it peaks at 1.15; the fill lands with the release; one ring in accent at 40 percent opacity behind the heart, scale 0.6 to 1.4 and opacity to 0; the count rolls up on an increase and down on a decrease (6 px and out, the new number in from the other side) | Spring damping ratio 0.5, response 0.22 s (settles in about 370 ms); ring 300 ms ease-out; count 180 ms ease-out | A tap mid-pop retargets the one spring from its current value; off never pops (colour fades 120 ms) | Fill and number change at once with a 120 ms cross-fade |
| repost, save | The reader turns Repost or Save on | The same single spring from 0.92, initial velocity 8 (peak 1.12), no ring; the count rolls as above | Damping ratio 0.6, response 0.25 s (about 325 ms) | As like | As like |
| pending | An action's request is still out after 400 ms | The control's icon at 60 percent opacity; aria-busy true | 150 ms fade | Ends when the answer lands | Same |
| rollback | The server refuses an optimistic action | The control returns to its old state; one horizontal nudge of 4 px | 200 ms ease-out | n/a | No nudge; the toast says it |
| sheet-open | A sheet opens on phones (composer, menus, details, who sees this) | translateY 100 percent to 0; scrim opacity 0 to 1 | spring-snap; scrim 200 ms | Grabbing the sheet mid-flight takes it from where it is | Opacity 0 to 1 in 150 ms, no movement |
| sheet-drag | Drag on the handle or the sheet's header | translateY follows the finger 1:1 down; upwards it rubber-bands (overshoot x height x 0.55 / (height + 0.55 x overshoot)) | Live | Always live | The sheet still follows the finger; release closes or stays with a fade |
| sheet-close | Release whose projected end (current + v/1000 x 0.998/0.002) passes half the height, or a downward velocity over 200 px/s (the lightbox's rule too), the close button, Escape, the scrim | translateY to 100 percent; scrim to 0 | spring-release with the release velocity; scrim 150 ms | Grabbing again catches it | Fade out 150 ms |
| dialog | At 768 px and wider, the same surfaces open as centred dialogs | scale 0.96 to 1 and opacity, origin centre | 200 ms ease-out in, 150 ms out | Retargets | Opacity only |
| menu | A popover menu opens at 768 px and wider (More, Repost) | scale 0.97 to 1 and opacity, origin at the trigger's corner | 160 ms ease-out in, 120 ms out | Retargets | Opacity only |
| pill-show | New posts arrive above the viewport | The pill's translateY -8 px to 0 and opacity | 200 ms ease-out in, 150 ms out | Retargets | Opacity only |
| pill-jump | The reader presses the pill | The list scrolls until the oldest unread new post (the first above the reader's place) is at the top of the viewport | Native animated scroll; web `scrollTo` smooth | A touch on the list stops it | Jumps at once |
| new-own-post | The reader's own post enters the top of a feed they are at the top of | The new row fades in and the rows below slide down to make room (Reanimated FadeIn and LinearTransition) | 220 ms ease-out | n/a | Appears at once |
| others-posts | Polled posts are inserted above the viewport | Nothing moves: the list keeps the reader's post where it was (section 7.5) | n/a | n/a | Same |
| lightbox-open | An image cell is pressed | The image grows from the thumbnail's measured rectangle to its fitted size (translate and scale); backdrop fades in | spring-snap; backdrop 200 ms | Closing mid-growth reverses from where it is | Fade 150 ms |
| lightbox-drag | A vertical drag on the image (touch, or a mouse drag on web) | The image follows 1:1, scaling to 0.85 at half a screen; the chrome (close, counter, description) fades out and the backdrop's opacity follows the drag from 0.94 to 0.4 at half a screen | Live | Live | Follows the finger, the backdrop unchanged; settles with a fade |
| lightbox-close | Release whose projected end passes 100 px, or a downward velocity over 200 px/s; Close, Escape | Back into the thumbnail if it is still on screen, else fade | spring-release; fade 150 ms | Catchable | Fade 150 ms |
| lightbox-page | A horizontal swipe on touch | The images follow the finger, then snap to the projected neighbour | spring-release | Live | Changes at once |
| image-in | An image finishes loading | Cross-fade from its blurhash | 150 ms (2b design :487) | n/a | At once (as today) |
| tab-underline | A Home or profile tab is chosen by pointer | The accent underline moves and resizes to the new tab | spring-snap | Retargets | Jumps; arrow keys always jump |
| composer-open | The desktop composer card gets focus or a click | The card grows to the full composer (LinearTransition) | 200 ms ease-out | Blur when empty shrinks it from where it is | At once |
| post-removed | The reader's post is deleted | Opacity to 0, then the rows below close the gap | 150 ms, then 200 ms ease-out | n/a | Removed at once |
| caught-up | "You're all caught up" first becomes true in a session (the marker reached from above, or the pill's count at zero) | Its done icon's stroke draws (dash offset 1 to 0) | 450 ms ease-out, once | n/a | Drawn at once |
| skeleton | A list's first page is loading | Skeleton rows pulse between opacity 0.6 and 1 | 1.6 s per cycle, ease-in-out; stops when content arrives | n/a | Static at 0.8 |
| ring | The composer's character count changes | The ring's dash offset follows the count; colour turns review-ink at 900 and danger-ink above 1000 | 120 ms ease-out | Retargets | Changes at once |
| theme | The reader changes theme | Background and text colours cross-fade on web (a class on html with a colour transition, removed after) | 200 ms ease | n/a | A 150 ms cross-fade: a soft brightness change is gentler than a jump |
| soft-reset | The current Home item is pressed again (section 7.1) | The feed scrolls to the newest post | Smooth scroll | A touch on the list stops it | Jumps at once |
| spinner | The centred Loading of auth screens and guard layouts | Rotation | 800 ms per turn, linear | n/a | A 1.6 s opacity pulse, as the skeleton |
| pull-to-refresh | Native, a pull at the top of a list | The platform's own control | The platform's | The platform's | The platform's; the threshold haptic stays |
| header-hide | Phones: the list scrolls down past the header's height, or back up | The header's translateY to minus its height, or back to 0 | 200 ms ease-out | Reverses from where it is on the next change of direction | The header stays |
| toast | A toast shows or leaves | sonner's (web) and sonner-native's own: up from the bottom with opacity | The libraries' defaults | Swipe away | Opacity only (section 5.4) |

The compose button and the tab bar never hide on scroll: they stay where the reader last saw them. Only the phone header does (header-hide).

### 5.3 Haptics

apps/app/src/lib/haptics.ts exports useHaptics(), after Bluesky's intent API (study 2.3), over expo-haptics 57.0.3. Each intent fires in the same handler as the visual change, before the state update, so sight and touch land on the same frame.

| Intent | When | iOS | Android (performAndroidHapticsAsync) |
|---|---|---|---|
| toggleOn | Like, Repost, Save or Follow turned on | impactAsync(Light) | AndroidHaptics.Toggle_On |
| toggleOff | Turned off | nothing | AndroidHaptics.Toggle_Off |
| selection | A tab, a segment or a theme chosen | selectionAsync() | AndroidHaptics.Segment_Tick |
| threshold | A sheet or the lightbox crosses its close threshold while dragging; pull to refresh arms | impactAsync(Medium), once per crossing | AndroidHaptics.Gesture_Threshold_Activate |
| success | A post, reply, quote, report or appeal is sent | notificationAsync(Success) | AndroidHaptics.Confirm |
| warning | The discard question appears | notificationAsync(Warning) | AndroidHaptics.Reject |
| error | An optimistic action is rolled back | notificationAsync(Error) | AndroidHaptics.Reject |

- Ordinary taps, scrolling and navigation have no haptic.
- On web useHaptics() returns no-ops (the Vibration API is coarse and missing in Safari; libraries A.1).
- The off switch: Settings, Appearance and accessibility, "Haptics" (shown on iOS and Android only). Reduced motion does not turn haptics off; the switch does.
- The Android constant names are checked by tsc against expo-haptics 57.0.3's AndroidHaptics; on devices they are checked in sub-project 5.

### 5.4 Toasts

apps/app/src/components/toast.web.tsx (sonner 2.0.8) and toast.tsx (sonner-native 0.27.0) export one API, `toast.show({ message, action?, tone? })`, and one `<Toaster />` mounted once in the root layout.

- Words: the sentence names the action as its button did. "Your post was sent. It is at the top of Home.", "Your reply was sent", "Your quote was sent", each with the action "View"; "Saved to Bookmarks" with "View"; "Link copied"; a rollback's sentence ("Couldn't like this post. Try again.", one per action, in ui-words.ts).
- Durations: 4 seconds plain, 8 seconds with an action, 6 seconds for a rollback. Timers pause while the toast is hovered, while focus is inside the toaster, and while the page is hidden (sonner's own behaviour; sonner-native pauses on touch).
- At most three on screen; newer ones stack above older ones; each can be swiped away.
- Place: bottom centre, above the tab bar and the safe area on phones (offset 72 px plus the bottom inset; 140 px plus the inset on screens with the compose button, so the toast and its "View" sit above the button, never over it), bottom centre of the window wider up.
- Announcement: on web sonner's region is a polite live region, and its hotkey Alt+T moves focus into it, so the action button can be reached from the keyboard. On native toast.tsx also calls AccessibilityInfo.announceForAccessibility with the message and "View" when there is an action.
- A toast confirms; it never carries the only copy of something the reader must act on. Form errors stay in place as ErrorText (role alert); a failed list page stays as a row.
- Reduced motion: both libraries already drop their movement under the system's setting (sonner by prefers-reduced-motion; for sonner-native the dry run checks it and, if it does not, toast.tsx passes no animation). Under korbat's own "Reduce motion: Always", toast.web.tsx gives each toast the class `k-still`, and the style element of theme/fonts.web.ts carries the rule `.k-still { transform: none !important; transition: opacity 150ms ease !important; }`.

## 6. Components

### 6.1 Where they live, and the rules every one keeps

- apps/app/src/components/ui.tsx keeps its twelve exports and their names (Screen, Title, Body, Section, VerifiedChip, Field, Button, TextLink, TextButton, ErrorText, Notice, Loading), rewritten on the tokens, because tests import them and pin lines of them (audit 4.1). Field keeps `<TextInput` followed by `ref={ref}` on the next line, with the indentation the pin has (eight spaces), and Button keeps `<Pressable ref={ref}`, the two lines lifecycle.test.tsx:240-241 pins.
- New primitives go in apps/app/src/components/kit/, one file each (Text.tsx, Icon.tsx with Icon.web.tsx, IconButton.tsx, Avatar.tsx, Sheet.tsx, Menu.tsx, Tabs.tsx, ListRow.tsx, Skeleton.tsx, EmptyState.tsx, ErrorState.tsx, StatusChip.tsx, VisuallyHidden.tsx, PublicFrame.tsx), plus apps/app/src/components/toast.tsx and toast.web.tsx. ui.tsx builds on them.
- Variants are written with class-variance-authority 0.7.1 and a `cn()` helper over clsx 2.1.1 in apps/app/src/theme/cn.ts; variants never set the same property twice, so no merge step is needed.
- Every control has a name. Button, IconButton, ListRow, Menu items and Tabs take a required `label: string`; for an icon-only control the label is its accessible name, and for a control with visible text the label is that text (WCAG 2.5.3, label in name).
- Every pressable shows the press state of section 5.2, a hover state on web pointers, and a visible focus ring: 2 px `focus` colour, 2 px offset, rounded with the control, drawn as an outline (`focus-visible:outline-2 focus-visible:outline-offset-2` on web, never Tailwind's box-shadow `ring`, which forced-colours mode removes; on native the system focus for keyboards). The ring is never removed.
- States reach assistive technology through aria-* props, never accessibilityState, which react-native-web 0.21 drops (a11y.test.tsx:32-34).
- Links are real anchors: expo-router's Link with `asChild`, or a Text with href; never a hand-made link role (a11y.test.tsx:36-40).
- Touch targets are at least 44 by 44 px (section 4.4).

### 6.2 Text

- Props: `variant` (the ten names of section 4.3), `tone` (`high`, `medium`, `low`, `accent`, `danger`, or a status `-ink`), `as` (`p`, `h1` to `h4` through accessibilityRole "header" with aria-level, `span`), `numberOfLines`, `selectable`, and the usual Text props.
- It reads the appearance (text step and font choice) from useAppearance() and writes fontFamily, fontSize and lineHeight as a style: rem on web, px times the step on native. Screens never write size or font classes again; a source scan (apps/app/test/theme.test.ts) refuses `text-xs` to `text-3xl`, `font-bold`, `font-semibold` and `font-medium` classes in src outside kit/Text.tsx once Task 8 ends (the same allowlist as the colour scan).
- Accessibility: a heading is `accessibilityRole="header"` with `aria-level`, which renders `<h2>` and up on web (a11y.test.tsx:104-106). Each screen has exactly one level-1 heading, its title.

### 6.3 Icon and IconButton

- Icon props: `name` (IconName from icons.ts, which holds export names as strings; each Icon file imports its own package's components, section 4.7), `size` (14, 16, 20, 24), `tone` (as Text), `filled`. Icon.web.tsx renders the lucide-react component with `aria-hidden="true"` and `focusable="false"`; Icon.tsx renders lucide-react-native over react-native-svg with `accessible={false}`.
- vitest resolves `.web.tsx` before `.tsx` (apps/app/vitest.config.mts gains `resolve.extensions` with the web extensions first), so the render tests see what the browser gets.
- IconButton props: `icon`, `label` (required, the accessible name), `onPress`, `pressed` (renders aria-pressed for toggles whose name stays the same), `busy` (aria-busy), `count` (a visible number beside the icon, inside the button, hidden from the name because the label already says it), `tone`, `hasPopup` (`menu` or `dialog`, rendered as aria-haspopup with aria-expanded while open).
- On web, under `(hover: hover) and (pointer: fine)` only, an icon-only IconButton shows its label as a tooltip after 500 ms of hover, then at once for its neighbours while one is open; it grows from the trigger (opacity and scale 0.97 to 1, 125 ms; reduced: opacity only), never shows on touch and adds no aria, since it repeats the name.
- The visible count is formatted by `compactCount()` in a new apps/app/src/lib/format.ts, created with IconButton in Task 2 (1, 999, 1.2K, 12K, 1.2M), and hidden when the reader hides counts (decision 15); the label then drops the number too.

### 6.4 Button, TextLink, TextButton

- Button props: `label` (required), `onPress`, `busy`, `disabled`, `tone` (`primary`, `secondary`, `danger`; the existing names), `size` (`md` 44 px, `lg` 52 px), `icon`, `full` (full width; the default inside forms, as today), `ref`. Primary is the accent fill with on-accent text; secondary is surface-1 with a line-high border and ink-high text; danger is the danger fill with on-danger text.
- States: rest, hover, pressed, focus, busy (label "Please wait..." with the U+2026 ellipsis as today, aria-busy, aria-disabled), disabled (surface-2, ink-low, still readable because it may carry the reason).
- TextLink and TextButton keep their props and become accent-ink, underlined, at body size, with a 44 px tall hit area.

### 6.5 Avatar

- No uploaded avatars exist before 2d. Avatar draws a generated monogram now and takes an image source later: props `account` (`{ id, displayName }`), `size` (32, 40, 64, 96), `src` (unused until 2d).
- The monogram is the first grapheme of the display name in the text face at 700 at 32 and 40 px, and in Fraunces 600 with SOFT 100 at 64 and 96 px, where the letter is above 22 px, so the profile header's name and disc share the display face, ink-medium on surface-2 inside a 1 px line-low ring (at least 8.22:1 in every theme, a pair already in TEXT_PAIRS). It takes no hue: colour in korbat means action or status, and a coloured disc per account would mean neither.
- It is decoration: `aria-hidden`, because the author link beside it carries the name; in a post card it is wrapped in a profile link out of the tab order (section 6.6). It is shown at 40 px in post cards and list rows and at 64 px (phones) or 96 px (768 px and wider) in the profile header. This gives the feed its rhythm now; 2d swaps the source without moving anything (decision 22).

### 6.6 PostCard

The post is an article with one explicit open target (study 3.3).

- Element: `role="article"` with `aria-labelledby` naming its author line, so a screen reader announces "Ada, @ada, 3 hours ago, article".
- Layout: the repost line ("Ben reposted", with the repost icon, Ben's name a link to his profile) above; then the avatar column and the content column. The content holds the author line (display name in body-strong as a link to the profile, VerifiedChip, the handle in mono ink-low, and the time), the reader's own status chips, the reply context ("Replying to @ada", a link), the body (RichText in the post variant, its links and mentions in accent-ink; links, not mentions, also underlined, 1 px at a 2 px offset, since accent-ink against the body's ink is under 3:1, while a mention keeps its "@"), MediaGrid, QuoteEmbed, and the action row. Below 768 px MediaGrid and QuoteEmbed span the card's full inner width, from the avatar's left edge to the right gutter (328 px at 360 instead of 276), keeping radius media; at 768 px and wider they keep the indent.
- The avatar and the name open the profile: the name is the profile link; the avatar sits in a second link to the same profile with `tabIndex={-1}` and aria-hidden, so the name stays the one keyboard and screen-reader target; its box is 44 by 44 px around the 40 px disc, and it is outside the card's open area.
- The open target: the time is the post's link (`/post/<id>`). Its visible text is the short time ("3h") and its name adds visually hidden words from postedWhen (section 8.1: "3h ago, open the post", "posted just now, open the post", "on 12/10/2026, open the post"), so the name contains the visible label. It is the only link to the post in the card, so the keyboard and screen readers meet one target, and padding and a minimum height make it at least 24 by 24 px (WCAG 2.5.8).
- For pointers and touch, the whole card body is the open-post target: a press anywhere on it that is not a link, a button or the avatar opens the post. On web the article's onClick ignores presses whose target is inside a link, a button or an input, and presses that end a text selection; on native the body sits in a Pressable with `accessible={false}`. This is a convenience the explicit link duplicates, so nothing is reachable only by it.
- The body is no longer a link (today it is, PostCard.tsx:197-204), which also ends the link-inside-link of mentions in a linked body.
- Actions (section 2, decision 12): IconButton Reply (count of replies; opens the thread with the reply composer focused), IconButton Repost (count of reposts; `hasPopup="menu"`; the menu offers "Repost" or "Undo repost", and "Quote"), IconButton Like (count; `pressed`), IconButton Save (label "Save" or "Saved", no count, no aria-pressed: the label says it, as today; turning it on shows the toast "Saved to Bookmarks" with "View", which opens /bookmarks and is announced politely, so a screen reader hears that the press worked; turning it off shows none), then a spacer and IconButton More (label "More options for this post"; the menu holds "Who sees this", "Copy link" on web, "Delete" for the author, "Report" for everyone else, signed in or out, as a link to `/report?post=<id>`).
- Optimistic actions: like, repost, save and undoing them (and Follow, section 8.4) change the card at once (state, icon, count), haptic toggleOn or toggleOff fires, and the request goes out. Each kind has its own request lane, so a like and a save can be in flight together while a second tap on the same kind waits for the first answer (so a double tap cannot undo itself, as today's comment in PostCard.tsx wants). The server's answer replaces the counts, so they never drift. A refusal restores the earlier state, plays the rollback nudge, fires the error haptic and shows the rollback toast; `account_suspended` still shows RefusedNotice under the card (3e, 9.4).
- Signed out, an action sends the reader to /signin as today.
- Delete: "Delete" in the More menu replaces the action row with the inline question "Delete this post?" and its two controls, "Delete" (danger) and "Keep", which still use the internal Action component, so the pin `<Action ref={keepRef} label="Keep"` (a11y.test.tsx:139) holds. Keep takes the focus when the question shows; withdrawing it returns the focus to the More button. A deleted post leaves the list with the post-removed motion.
- QuoteEmbed: a bordered region (radius media, line-low) with the quoted author line (name a link to the profile) and the quoted time as the link to the quoted post, so the quote has one open target too; its body is plain text, and its images open nothing (they belong to the quoted post). A tombstone keeps its two sentences.
- The thread's focused post uses the same card in a large variant: post text at 19 / 28 in the text face, the full date and time instead of the short time, and a stats line ("12 reposts, 4 quotes, 30 likes", words from ui-words.ts, hidden counts respected) above the action row.

### 6.7 MediaGrid and the Lightbox

- MediaGrid keeps its geometry (one image at its own ratio between 3:4 and 2:1, two to four in a 16:9 frame; MediaGrid.tsx:12-19, 85-104), its buttons "Open image: <description>", its ALT toggle with aria-expanded named "Show image descriptions" or "Hide image descriptions" (hidden-media.test.tsx:82), its blurhash placeholders and the author's own labels "Under review" and "Removed" on their images, now drawn as StatusChips in the image's corner.
- Each image is clipped to radius media with a 1 px line-low hairline inside, so white images keep an edge on the Light theme.
- Every korbat image has a description (2b requires it), so a per-image ALT badge would say nothing; the one ALT toggle stays.
- The Lightbox is MediaViewer.tsx and MediaViewerContent, kept with their props and words ("Close the image viewer", "Previous image", "Next image", "Report this image", "N of M"), on a stage that stays near-black in every theme (rgba(0, 0, 0, 0.94)) with white text, so images are seen as they are. The stage is a forced Dark token scope (ThemeProvider's vars() of Dark on native; on web the class `dark` on the stage, which global.css's Dark block also matches), so its focus ring, ink and buttons always take the Dark values: the Light focus colour on the stage would be 2.63:1, the Dark one is at least 8.59:1 (TEXT_PAIRS, section 4.2). It gains the motion of section 5.2 (growing from the thumbnail, drag to dismiss, swipe between images on touch). Arrow keys, Escape and the focus returning to the opening image stay (2b design :388).

### 6.8 Sheet and Dialog

- One component, Sheet (kit/Sheet.tsx), with props `open`, `onClose`, `title` (required; it names the dialog), `description`, `dismissible` (default true), `size` (`auto` or `tall`) and children. Below 768 px it is a bottom sheet with a grab handle; at 768 px and wider the same content is a centred dialog 560 px wide (composer 640 px).
- Built on React Native's Modal (transparent, no built-in animation), with Reanimated for the motion and gesture-handler's Pan for the drag (section 5.2). react-native-web's Modal already traps focus and closes on Escape; the sheet adds the scrim (a press on it closes, and it is no tab stop, as the compose sheet's is today) and safe-area padding. GestureDetector throws on iOS and Android without a GestureHandlerRootView above it, so the root layout is wrapped in one (Task 3) and the Sheet wraps its Modal content in its own (Android needs one inside a Modal).
- Accessibility: `role="dialog"`, `aria-modal="true"`, `aria-labelledby` the title (a11y.test.tsx:93-102); focus moves to the first field, else the title; focus returns to the control that opened it; the rest of the page is inert while it is open.
- A sheet with unsaved content asks before closing (the composer's DiscardDialog, section 6.15); others close at once.

### 6.9 Menu

- A disclosure, not an ARIA menu: the trigger is an IconButton with `hasPopup="menu"` and aria-expanded; the content is a list of buttons and real links, so links stay anchors and Tab moves through them. Arrow keys also move between items on web; Escape and a press outside close it and return focus to the trigger.
- Below 768 px the content is a Sheet titled by the trigger's label; at 768 px and wider it is a popover of surface-1 anchored to the trigger, flipped to stay inside the window.
- Item props: `label`, `icon`, `onSelect` or `href`, `tone` (`danger` for Delete), `description` (one line under the label, used by "Who sees this").

### 6.10 Tabs

- Props: `label` (names the tablist), `tabs` (`{ key, label }[]`), `selected`, `onSelect`, `panelId`. Used by Home (Following, Latest, Explore), the profile (Posts, Replies, Likes), Settings, Cases (About you, Reports) and Settings, Privacy (Blocked, Muted).
- Roles stay as tests pin them: `accessibilityRole="tablist"` on the row and `accessibilityRole="tab"` with aria-selected on each (a11y.test.tsx:50; cases.test.tsx:296); the content below is `role="tabpanel"` labelled by the selected tab.
- Keyboard on web: one tab stop (roving tabindex); Left and Right move and select at once, Home and End jump; no animation for keyboard moves.
- Look: label in body-strong, ink-low when not selected, ink-high when selected, with a 2 px accent underline that moves with the tab-underline spring; the row scrolls sideways when the labels are wider than the column, never wrapping into two rows.

### 6.11 ListRow

- One row for settings, lists of accounts, menus on phones and the details sheet: props `title`, `description`, `icon`, `href` or `onPress` or `control` (a Switch or a radio), `value` (a short trailing text, such as "Dark"), `tone`.
- As a link it is an anchor (Link asChild) with a chevron; as a button it is a button; with a Switch the switch carries `accessibilityLabel` equal to the title, written on the `<Switch` line itself because the scan reads one line at a time (a11y.test.tsx:130-133), and the whole row toggles it; in a radio group each row is `role="radio"` with aria-checked inside a `role="radiogroup"` named by the group's heading.
- Minimum height 52 px (44 px target plus padding); dividers line-low; hover and pressed surface-2.
- ProfileRow (components/social/ProfileList.tsx) becomes a ListRow with the Avatar, the display name, the VerifiedChip (replacing the separate check mark at ProfileList.tsx:16, so there is one verified look), the handle in mono and FollowButton as its control.

### 6.12 Skeleton, EmptyState, ErrorState

- Skeleton (kit/Skeleton.tsx): parts `Skeleton.Text` (a bar of one line's height and a given width), `Skeleton.Circle`, `Skeleton.Block`, and two composed rows, `Skeleton.Post` (avatar, two text lines, a media block on every third row, an action bar) and `Skeleton.Row` (for account and settings lists). Surface-2 shapes with the skeleton pulse; `aria-hidden`; the list that shows them carries one visually hidden `role="status"` text from ui-words.ts ("Loading posts", "Loading accounts").
- Loading never leaves the shell: a screen inside AppShell shows skeleton rows in its column while it loads, so the nav never disappears (today it does on five screens, audit 1.1). The centred spinner (`Loading`) stays for the auth screens and the guard layouts, now in accent on the page's surface. SessionFailure (lib/session.tsx:32-43, the full-screen "Try again" when /me fails) is redrawn on ErrorState in Task 3, which takes the file off LEGACY_COLOUR_FILES.
- EmptyState: props `icon`, `title`, `body`, `action` (`{ label, href }` or `{ label, onPress }`). Title in display-3, body in ink-medium, one action at most; it says what the screen will hold and what to do next. The existing empty sentences stay word for word as the body (audit 1.1: "Nothing here yet. Follow someone, or switch to Latest or Explore.", "No posts yet.", "Nothing saved yet. Use Save on a post to keep it here." and the rest), with a short title above each from ui-words.ts.
- ErrorState: props `message` (from errorMessage()), `onRetry`, `offline`. The message is `accessibilityRole="alert"`; the action is "Try again" (the pinned word). Offline (the request failed without a response, or navigator.onLine is false on web): icon offline, title "You're offline", body "korbat will load this when your connection is back.", and the same "Try again"; when the browser reports online again, the list retries once by itself.

### 6.13 StatusChip

- Props: `tone` (`review`, `restricted`, `verified`, `explore`), `label`, `onPress`, `href`. It draws the tone's wash, its icon and its label (section 4.8).
- Three forms, by what the chip does:
  - Information only: a View with `role="img"` and an accessibilityLabel. VerifiedChip is this form and keeps its exact contract: visible "Verified", `role="img"`, label "verified account" (lifecycle.test.tsx, "the verified badge chip").
  - A link: an anchor (In Explore keeps its link to `/post/<id>`, explore.test.tsx:811-812).
  - A button that opens a sheet: the author's moderation chip, `aria-haspopup="dialog"`, its name the chip's words (chipText()), so "Removed: R3, strike until 4 Dec" is read as a button that opens a dialog; it ends with a 14 px chevron (the `next` icon, aria-hidden), so it looks like something to press.
- Chips wrap their text and never truncate it.

### 6.14 WhoSeesThis

- A sheet (title "Who sees this") opened from a post's More menu, for every post. Its sentences come from a new pure function, `reach(post, me, explore?)` in apps/app/src/lib/reach.ts, built from the data of audit 5.4, with every sentence in ui-words.ts:
  - Another account's post: "Public. Anyone can read it, including people who are not signed in."
  - The reader's own visible top-level post: "Public. Anyone can read it, including people who are not signed in.", then what a block does and does not do, "Accounts you blocked do not see it in their feeds, but anyone signed out can still read it.", and "It shows in Latest and in your followers' Following, in time order." and one Explore line: "Also in Explore." when `inExplore`; "Not in Explore: you turned Explore off." when `me.profile.showInExplore` is false; "Not in Explore while your account is suspended." while a suspension runs; otherwise the sentence of its Explore status, read from GET /api/posts/:id/explore when the sheet opens, in the words lib/explore.ts already has for ExploreStatusLine.
  - The reader's own reply: "Public. Shown in the thread and on your Replies tab." Replies never enter Explore, and the sheet says so.
  - The reader's own withheld or removed post: "Only you and korbat's moderators can see it." followed by chipText() and, with an order, "Removed for everyone else by an authority's order." and a link "Read the decision" to `/settings/cases/<decisionId>` when the decision is known.
  - Always last: "korbat never lowers a post's reach in secret. Following and Latest are in time order." with a link to /explore/about, "How Explore works".
- A unit test, apps/app/test/reach.test.ts, covers every branch and that no sentence claims more than the data says: a reader's view of someone else's post never mentions moderation, no sentence says a blocked account cannot read a public post, and the withheld or removed sentence names korbat's moderators.

### 6.15 Composer parts

The Composer (components/social/Composer.tsx) is split into parts that a reducer drives, after Bluesky's composerReducer (study 2.7): apps/app/src/components/social/composer/state.ts (a pure reducer: text, images, the image states, busy, error, the draft's key) with apps/app/test/composer-state.test.ts.

- ComposerField: the TextInput with its existing accessible names ("What's on your mind?", "Your reply", "Your comment on the quoted post") and placeholders, post variant type, growing with its content up to half the screen and then scrolling.
- ProgressRing: a 20 px ring drawn with react-native-svg (DOM svg on web) in accent, review-ink from 900 characters, danger-ink above 1000; a number appears beside it when 100 or fewer remain ("12", then "-3" over the limit). The visible "n/1000" counter is replaced by the ring and number; a visually hidden text "{n} of 1000 characters" is the field's description (aria-describedby), announced politely only when the count crosses 900 and 1000.
- ImageTray: ComposerImages.tsx as today (previews, per-image status, the required description with its counter, Remove), now 88 px previews in radius media, and one new line under "Add image" in ink-low: "korbat removes location and camera details from images." (study 4.9; true by 2b's EXIF strip).
- SendBar: IconButton "Add image" (icon add-image), the ring, "Cancel" when the composer is a sheet, and the Post button, which keeps today's behaviour: it names what is missing ("Remove the failed image", "Describe every image", "Waiting for images...") and shows "Posting..." while it sends (Composer.tsx:41, :110).
- DiscardDialog: the existing question "Discard this draft?" with "Discard" (danger) and "Keep writing", asked only when the draft has content (ComposeSheet.tsx today), with the warning haptic.
- Drafts (decision 18): apps/app/src/lib/drafts.ts keeps the text per context key (`post`, `reply:<id>`, `quote:<id>`) in localStorage under `korbat.drafts.<accountId>`, written 500 ms after typing stops, removed when the post is sent or the draft discarded, all removed when the session ends (section 8.8, On this device); drafts.ts is the only module that touches the key (the storage pin, explore.test.tsx:864-866, gains it in Task 6); on native it is kept in memory until sub-project 5.
- After sending: the sheet closes at once, the success haptic fires, and the toast "Your post was sent" (or reply, or quote) offers "View", which opens `/post/<id>`. In a feed the reader is at the top of, the new post enters with new-own-post; elsewhere it is inserted at the top without moving the reader.

### 6.16 Toast and VisuallyHidden

- Toast: the API and rules of section 5.4; `<Toaster />` is mounted once in apps/app/src/app/_layout.tsx inside the theme provider, so toasts take the theme's surface-1, line and ink tokens and the text face.
- VisuallyHidden (kit/VisuallyHidden.tsx): text kept for assistive technology and off screen (1 px, clipped, absolute), used for the time link's words, the composer's count, list loading statuses and the skip link before it takes focus.

## 7. Layout

### 7.1 Breakpoints

apps/app/src/theme/layout.ts exports `useLayout()`, which reads useWindowDimensions() and returns one of four kinds. The 768 and 1024 px edges are today's (AppShell.tsx:16-17, `WIDE = 1024`, `MEDIUM = 768`); 1280 px is new.

| Kind | Width | Navigation | Timeline column | Context column |
|---|---|---|---|---|
| phone | below 768 px | bottom tab bar with icons and labels; floating compose button | the whole width, gutter 16 px | none |
| tablet | 768 to 1023 px | a rail 80 px wide: the "k" monogram, icons with 12 px labels under them, the New post button | 600 px, centred in the rest | none |
| desktop | 1024 to 1279 px | the 80 px rail | 600 px | 320 px |
| wide | 1280 px and wider | a full nav 240 px wide: the wordmark, icons with labels beside them, a full-width New post button | 600 px | 320 px |

- The three columns sit together, centred, 24 px apart, with line-low rules between them; at wide they take 1,208 px.
- The same components render at every width; only the shell changes. Sheets become dialogs at 768 px (section 6.8) and menus become popovers (section 6.9).
- The nav: Home, Bookmarks, Profile and Settings for an account, and Home and Sign in signed out, as today (AppShell.tsx:35-46, the same items and hrefs); signed out it gains a third item, Appearance (section 8.8), added by Task 8 with the route. The current item has `aria-current="page"` (pinned), an ink-high label in body-strong, its icon at stroke 2.25 (filled where the shape is closed, as Bookmark), an accent-wash pill and a shape mark that carries contrast: a 3 by 20 px accent bar above the icon in the tab bar, a 3 px accent bar at the item's start in the rail and full nav (6.72 to 8.54:1, the Tabs underline's language); the others are ink-low.
- Pressing the current Home item again scrolls Home's feed to the newest post (the soft reset of study 2.2 without a reload); the reader's marker and pill are kept.
- The tab bar and the compose button stay put while the list scrolls.

### 7.2 Phone

- A header bar at the top of each screen (surface, line-low bottom rule): the back button (IconButton "Back") on screens below the tabs, the screen's title in display-2 as its level-1 heading, and the screen's own controls (Home's tabs under the title). So the reading surface is not a quarter chrome, the header slides up out of view as the list scrolls down and returns on any scroll up or when focus enters it (header-hide, section 5.2); under reduced motion it stays.
- The compose button (signed in, on Home, a profile and Bookmarks) is a 56 px accent circle with the compose icon and the label "New post" (pinned), 16 px from the right and 16 px above the tab bar plus the bottom safe area.
- The tab bar is 56 px plus the bottom safe area, surface with a line-low top rule, its items (four for an account, three signed out) each an icon over a 12 px label.

### 7.3 Tablet, desktop and wide

- The rail or full nav is sticky at the left; its New post button opens the composer as a dialog everywhere but on Home, where it focuses the inline composer card.
- The timeline column holds the screen's header (title and tabs) at its top, which stays while the list scrolls under it, with a line-low rule appearing under it once the list has scrolled (no blur).
- The context column (desktop and wide), labelled "About korbat" as a complementary landmark: HandleBox with today's words, the label "Go to a profile" (HandleBox.tsx:26) and the field "Handle" (:29), then the card "How korbat works" with three short lines from ui-words.ts ("Following and Latest are in time order.", "korbat never lowers a post's reach in secret.", "The rules are public, and so is how they are enforced.") and links to /rules, /transparency and /explore/about. Popular now leaves it (decision 14).
- Auth screens, the three token pages and /terms get one shared public frame (PublicFrame in kit/): the wordmark at the top linking to /, the content column 440 px wide (terms 640 px), and a footer with links to /rules, /transparency and /terms. They stay outside AppShell, as their flows need, but no longer look like another app.

### 7.4 Safe areas and the keyboard

- react-native-safe-area-context 5.7.0, installed and unused today, gets its SafeAreaProvider in the root layout. The tab bar, the compose button, sheets and toasts pad by the bottom inset; headers by the top inset on native; public/index.html's viewport meta gains `viewport-fit=cover` so iOS Safari reports the insets.
- On web the browser moves content above the on-screen keyboard; sheets size with the visual viewport (the `dvh` unit through a style on web). Native keyboard tracking waits for react-native-keyboard-controller in sub-project 5; until then sheets use React Native's KeyboardAvoidingView.

### 7.5 Scrolling and the reader's place on web

- The web page keeps its fixed body (public/index.html: `body { overflow: hidden }`) and each list scrolls inside its column, as react-native-web's FlatList does today. The browser's own scroll restoration therefore does not apply, and korbat keeps the place itself.
- Prepending without a jump: every list scrolls through one wrapper, List (apps/app/src/components/list/List.tsx), which owns the FlatList props. Before it commits rows above the viewport it records the key of the first row in view and that row's distance from the viewport's top; after layout it moves the scroll position by the change, so the row stays exactly where it was. On web this runs in apps/app/src/components/list/anchor.web.ts on the scroll node (with `overflow-anchor: none`, so Chrome's own anchoring does not correct twice); on native FlatList's `maintainVisibleContentPosition` with `minIndexForVisible: 1` does it (anchor.ts).
- Within a session each feed keeps its rows, its cursor and its anchor in memory (apps/app/src/lib/feed-cache.ts), so switching Home's tabs, opening a post and coming Back return to the same row. Today a tab change remounts the list and reads page one again (index.tsx, homeListKey); the key now changes only with the reader (an account or signed out), never with the tab or a new post. Explore is not kept there: its answers stay in ExploreList's component state, as 2c's rule and explore.test.tsx:853-862 require, so returning to Explore reads it again.
- Focus order on web: a "Skip to the main content" link appears on the first Tab, then the nav, then the main column (screen title first), then the context column. Landmarks: navigation named "Main", main, complementary named "About korbat".

## 8. Screens

### 8.1 What every screen gets

- The shell of section 7 (AppShell, or PublicFrame for the auth flow, the token pages and /terms), its loading state inside the shell (skeletons, never the nav disappearing), its empty state with one action, its error state with "Try again", and the offline state.
- A document title on web through expo-router's Head (`expo-router/head`), "<what> - korbat", from `TITLE_WORDS` in ui-words.ts (decision 16), naming the kind of screen and never an account.
- One level-1 heading, its title.
- Times through one helper, apps/app/src/lib/time.ts, over Intl: `timeAgo` moves there from lib/social.ts (re-exported from social.ts so its callers and tests keep working), with `dayTime` ("Tue 18:40"), `fullDate` ("21 Oct 2026, 18:40") and `postedWhen`, the spoken form of timeAgo's short time, which always contains it: "posted just now", "3h ago", "on 12/10/2026".
- New words in apps/app/src/lib/ui-words.ts unless the area has a words module; the word tables below give each key and sentence. Words not listed keep their text; a file on `LEGACY_TEXT_FILES` (section 1.5) moves its bare sentences, word for word, into its area's words module in the task that rewrites it.

Words of the shell and the post card, used on every screen:

| Key | Sentence |
|---|---|
| shell.skip | Skip to the main content |
| shell.about | About korbat |
| shell.howTitle | How korbat works |
| shell.how1 | Following and Latest are in time order. |
| shell.how2 | korbat never lowers a post's reach in secret. |
| shell.how3 | The rules are public, and so is how they are enforced. |
| shell.back | Back |
| post.open | {when}, open the post (`when` from postedWhen) |
| post.reposted | {displayName} reposted |
| post.more | More options for this post |
| post.repost / post.unrepost | Repost / Undo repost |
| post.whoSees | Who sees this |
| post.copyLink | Copy link |
| post.reply / post.like / post.reposts | Reply, {n} replies / Like, {n} likes / Repost, {n} reposts (the number left out when zero or hidden) |
| post.reply.one / post.like.one / post.reposts.one | Reply, 1 reply / Like, 1 like / Repost, 1 repost |

### 8.2 Home (/), the feed

What changes:

- The list is built from typed rows (study 2.2) by a pure function, `feedRows()` in apps/app/src/lib/feed-rows.ts: `post` (a TimelineItem), `marker` (the boundary of what the reader has seen), `gap` (new posts not yet loaded between two loaded ones), `loadMore`, `loadMoreError`, `end`, and `skeleton`. Empty and error states are rows of the same list, so the header and tabs never move.
- Reading place (decisions 8 and 9): apps/app/src/lib/reading-place.ts keeps, per account and per feed (Following, Latest), `{ newest: { key, time }, top: { key, time }, savedAt }` in localStorage under `korbat.place.<accountId>`. `newest` is the newest row that has been at least half in view for half a second (FlatList viewability, which react-native-web implements too); `top` is the row at the top of the viewport. Both are written one second after scrolling stops and when the page is hidden. reading-place.ts is the only module that touches the key (the storage pin, explore.test.tsx:864-866, gains it in Task 5), and the key is cleared when the session ends (section 8.8, On this device).
- Opening a feed: the first page is read with `limit=50` (lib/social.ts's following and latest gain an optional limit; today they send a cursor alone, social.ts:33, :56-57). If the stored `top` row is in it, or in a second page of 50, the list opens with that row at the top, and the pill counts the rows above it that are newer than `newest`. Otherwise, or with "Open feeds at the newest post" on, it opens at the newest post. The marker row sits above the first row whose time is not newer than `newest`.
- The marker row: "You were here" in display-3, the time of the place in meta (dayTime within six days, fullDate after), and "Newer posts are above. Below are posts you have already seen." It says "You're all caught up", with the done icon drawing its check once per session (section 5.2, caught-up), only when that is true: when the reader reaches it scrolling down from above it, or when the pill's count reaches zero, where the pill leaves showing "You're all caught up" for 2 s (opacity only).
- New posts (decision 7): apps/app/src/lib/new-posts.ts asks the feed's first page (`limit=50`) 30 seconds after the feed opens and every 60 seconds after, only while Home is focused, the feed is the selected tab and the page is visible (AppState on native, document.visibilityState on web). Rows newer than the list's first row are inserted above it with the anchor of section 7.5, so nothing moves. When all 50 are new, a `gap` row follows them ("Show more new posts"), which reads pages from the 50th until it meets the old first row.
- The pill: floating 12 px under the header, centred, accent fill, the newer icon and "{n} new posts" (or "1 new post", or "50+ new posts"); its name adds "above, go to the first one". Pressing it scrolls to the oldest unread new post, the first post above the reader's place, not to the marker, until that post is at the top of the viewport (pill-jump), so the reader reads on upwards in time order; the count falls as rows come into view, and the pill leaves at zero. Pressing Home in the nav goes to the newest post instead.
- Paging (decision 6): "Load more" stays as the row at the end of each page. With "Load older posts automatically" on, the next page loads when the reader is within two screens of the end, until the marker row; below the marker, only the button loads. When the cursor runs out, the `end` row says "That's everything in Following." or "That's everything in Latest."
- The list keeps its key across tabs and new posts (section 7.5): Home's homeListKey takes the reader only; switching tabs swaps the list's source and restores Following's or Latest's rows and anchor from feed-cache (Explore is read again, section 7.5), and the reader's own new post is inserted at the top of Following and Latest.
- The inline composer at 768 px and wider is the collapsed card of decision 19; below 768 px the compose button opens the sheet.
- PasskeySuggestion becomes a card (surface-1, radius card) with its words unchanged, "Add a passkey" as a primary Button and "Not now" as a secondary one.
- Explore keeps its list, its header ("Updated N minutes ago", "How Explore works") and its footer, restyled; it has no marker and no pill, because it is ranked, and its header links to how it ranks, as today.

What stays: the tabs and their order, `?tab=` in the address, SIGNED_OUT_PROMPTS, the empty sentences, "Load more", "Try again".

States: loading, five Skeleton.Post rows; empty, EmptyState with the pinned sentence and an action ("Open Latest" on an empty Following, a button that calls Home's own `select`, not a `/?tab=` link, so explore.test.tsx:241-242's list of tab links stays); error, ErrorState in the list; signed out, Latest and Explore only, the sign-in prompt card, no marker, no pill and no stored place.

| Key | Sentence |
|---|---|
| feed.marker.title | You were here |
| feed.marker.body | Newer posts are above. Below are posts you have already seen. |
| feed.caughtUp | You're all caught up |
| feed.pill | {n} new posts |
| feed.pill.one | 1 new post |
| feed.pill.many | 50+ new posts |
| feed.pill.label | {visible} above, go to the first one |
| feed.gap | Show more new posts |
| feed.end.following | That's everything in Following. |
| feed.end.latest | That's everything in Latest. |
| feed.loading | Loading posts |
| feed.empty.following.title | Your Following feed is empty |
| feed.empty.following.action | Open Latest |
| feed.empty.latest.title | Nothing posted yet |
| title.home | Home - korbat |

Tests that change: explore.test.tsx:231 and :238 (the index.tsx lines they read: homeListKey keeps only the reader, and the list is a FeedList) and :239 (the empty sentence, read from its words module, section 1.5); the homeListKey cases in the same file (one argument, the reader). New: apps/app/test/feed-rows.test.ts (every row kind, the marker's place, the gap, automatic loading stopping at the marker), reading-place.test.ts (read, write, the 100-post window, cleared when the session ends), new-posts.test.ts (the schedule, visibility, the 50-row gap).

### 8.3 A post and its thread (/post/[id])

- Ancestors above the focused post as compact cards joined by a 2 px line-low thread line through their avatars; the page opens with the focused post at the top of the viewport and the ancestors above it, kept by the anchor of section 7.5 while they load (study 2.5).
- The focused post in the large variant of PostCard (section 6.6), with the stats line; the author's ExploreStatusLine stays under it, with its condition, its two links and its focus effect unchanged (explore.test.tsx:772-790).
- The reply composer stays inline under the focused post at every width, as a collapsed card ("Write your reply") that opens on focus; `?quote=1` still opens the composer sheet for a quote, and "Quote this post" stays as a secondary Button.
- Replies follow, oldest first, as today: the API orders them, and a sort control would need the replies route to sort (section 14).
- Tombstones keep their two sentences, in the italic text face on a surface-2 block.

States: loading, the focused post's skeleton; error, h1 "This post is not available" with "Back to the timeline" (both pinned); no replies, "No replies yet." (pinned); signed out, no composer and a line with a link.

| Key | Sentence |
|---|---|
| thread.signIn | Sign in to reply. |
| thread.stats | {reposts} reposts, {quotes} quotes, {likes} likes (each part left out when zero or hidden; a part of 1 reads "1 repost", "1 quote", "1 like") |
| title.post | Post - korbat |
| title.postMissing | Post not available - korbat |

Tests that change: report.test.tsx:244 (QuoteEmbed's links: the profile link, then the post link, the order the new author line gives).

### 8.4 A profile (/u/[handle]), its followers and following

- Header: Avatar (64 px on phones, 96 px wider), display name (display-2 on phones, display-1 wider), VerifiedChip, the handle in mono 700, the bio in the post variant, the follower and following counts as links (as today; with the hide-counts setting on, the links read "Followers" and "Following" without numbers, decision 15), and "Follows you" as a neutral chip.
- Controls: FollowButton, with its words and states unchanged, drawn as a primary Button while the reader does not follow and a secondary one while they do; it is optimistic like the post's actions (section 6.6): the state changes at once with the toggleOn haptic and a 160 ms cross-fade of the label (reduced: at once), and a refusal rolls back with the error haptic and the toast "Couldn't follow @{handle}. Try again." (or "Couldn't unfollow"); and IconButton More ("More options for @{handle}") with Mute or Unmute, Block or Unblock, and Report as a link to `/report?account=<handle>`, for anyone but the profile's owner, signed in or out (decision 12). The block question keeps its words and becomes a Sheet.
- Tabs: Posts, Replies and Likes (own profile only), on the Tabs component; the empty sentences stay.
- RefusedNotice stays where it is.
- Followers and following: ProfileList with ListRows (section 6.11), skeleton rows while loading, the pinned empty sentences.

States: loading, a header skeleton and three post skeletons; error, h1 "This account is not available" (pinned); signed out, "Sign in to follow this account." (pinned) under the header.

| Key | Sentence |
|---|---|
| profile.more | More options for @{handle} |
| title.profile | Profile - korbat |
| title.followers | Followers - korbat |
| title.following | Following - korbat |

Tests that change: report.test.tsx:248-256 (the profile's Report is in the More menu: the test renders the profile's menu open and finds the same link, still offered signed out and never to the owner); lifecycle.test.tsx:89 keeps its pattern `verified ? <VerifiedChip /> : null` in both files.

### 8.5 Bookmarks (/bookmarks)

- The header "Bookmarks" with "Private to you." (both pinned) under it beside the privacy icon; a PostList; the empty sentence pinned; skeletons inside the shell (today Loading sits outside it, bookmarks.tsx:15).

| Key | Sentence |
|---|---|
| bookmarks.empty.title | No saved posts |
| title.bookmarks | Bookmarks - korbat |

### 8.6 The composer (sheet, card and dialog)

- ComposeSheet becomes the Sheet of section 6.8 around the Composer parts of section 6.15: a bottom sheet with a handle below 768 px, a 640 px dialog wider up. Its title stays "New post", "Reply" or "Quote"; the compose button's label stays "New post"; the scrim's label stays "Close the composer" and it stays no tab stop; a running suspension still replaces the fields with the refusal (3e, 9.4).
- The discard question appears only when the draft has content, with its pinned words; closing an empty composer closes at once.
- Sending closes the sheet at once and shows the toast with "View" (section 5.4).

| Key | Sentence |
|---|---|
| composer.exif | korbat removes location and camera details from images. |
| composer.count | {n} of 1000 characters |
| composer.collapsed | What's on your mind? |
| composer.collapsedReply | Write your reply |
| toast.sent.post | Your post was sent. It is at the top of Home. |
| toast.sent.reply | Your reply was sent |
| toast.sent.quote | Your quote was sent |
| toast.view | View |
| toast.linkCopied | Link copied |
| toast.saved | Saved to Bookmarks |
| toast.failed.like | Couldn't like this post. Try again. |
| toast.failed.unlike | Couldn't remove your like. Try again. |
| toast.failed.repost | Couldn't repost this post. Try again. |
| toast.failed.unrepost | Couldn't undo the repost. Try again. |
| toast.failed.save | Couldn't save this post. Try again. |
| toast.failed.unsave | Couldn't remove this post from Bookmarks. Try again. |
| toast.failed.follow / toast.failed.unfollow | Couldn't follow @{handle}. Try again. / Couldn't unfollow @{handle}. Try again. |

Tests that change: none pin the "n/1000" text; the counter's words move to composer.count, tested in composer-state.test.ts.

### 8.7 The moderation surfaces

The author's chip and its details sheet:

- On the author's own withheld or removed post the StatusChip (review or restricted, section 4.8) keeps chipText()'s words and, when the decision is known, opens StatusSheet (apps/app/src/components/moderation/StatusSheet.tsx). A chip without a decision (audit 5.5, item 2) stays information only, as today.
- StatusSheet reads GET /api/moderation/decisions/:id when it opens (decision 11) and shows, in this order (but with the Appeal block first while an appeal is open), each as a labelled block: "Rule" (the rule's id and title at the decision's rules version from @korbat/rules, or "Illegal content" with the legal reference); "What it does" (the measures in the words DecisionDetail already uses); "Applies to" (this post, this image or this account: the scope said out loud, study 3.10); "Who can see it now" (from reach(), section 6.14); "Decided by" in role terms: "korbat's automated check" only for a decision without a decider, which DecisionView marks as `automatedDecision === "fully"` (packages/contracts/src/moderation.ts:2190-2197, the test DecisionDetail.tsx:398 uses for its "Taken by a program" chip; the case rows' `byProgram`, :1711 and :2265, is not on DecisionView), never from the field merely being set; "An authority's order" when `source === "order"`; otherwise "A korbat moderator" (a "partially" decision is an admin's); "When" (fullDate of decidedAt); "Statement" (the reason's first paragraph and a link "Read the full decision" to /settings/cases/<id>); "Appeal" (open: "You can appeal until {date}." with the primary Button "Appeal", which opens /settings/cases/<id>?appeal=1 with the appeal form focused; interim: the interim redress sentence DecisionDetail shows today; pending or answered: the existing appeal words; a program's decision: "Ask for a person" as DecisionDetail offers it).
- Loading shows skeleton blocks; an error shows ErrorState with "Try again".
- "Who sees this" in the More menu of every post (section 6.14).

What a reader meets:

- A hidden or sealed image stays the placeholder of HiddenImage.tsx with its words; it stays no button, as hidden-media.test.tsx:175-176 requires. When a post has a hidden image, the row under its grid (where the ALT toggle sits) gains one link, "Why are images hidden?", to the rules page (`/rules`), which explains moderation and its tools. Readers get no cover over a restricted post, because they never receive one (decision 10).

The case screens (/settings/cases and its four detail routes), the report form (/report), the report's status page (/notice/[ref]) and the standing banner:

- Restyled on the primitives: DecisionDetail's parts become cards with labelled blocks, the case's events a dated vertical list, NoticeStatusView's items ListRows, ReportForm's steps a stack of cards with one question each. Every sentence stays, from the words modules.
- /report and /notice/[ref] render inside AppShell with skeletons (today their Loading sits outside it).
- StandingBanner keeps its region, its level-2 first sentence and its words, on review or restricted wash with its icon.

| Key | Sentence |
|---|---|
| status.rule | Rule |
| status.does | What it does |
| status.appliesTo | Applies to |
| status.appliesPost | This post |
| status.appliesImage | This image |
| status.appliesAccount | Your account |
| status.whoSees | Who can see it now |
| status.decidedBy | Decided by |
| status.byPerson | A korbat moderator |
| status.byProgram | korbat's automated check |
| status.byOrder | An authority's order |
| status.when | When |
| status.statement | Statement |
| status.readAll | Read the full decision |
| status.appeal | Appeal |
| status.appealUntil | You can appeal until {date}. |
| media.whyHidden | Why are images hidden? |
| reach.public | Public. Anyone can read it, including people who are not signed in. |
| reach.blocks | Accounts you blocked do not see it in their feeds, but anyone signed out can still read it. |
| reach.ownLists | It shows in Latest and in your followers' Following, in time order. |
| reach.inExplore | Also in Explore. |
| reach.exploreOff | Not in Explore: you turned Explore off. |
| reach.suspended | Not in Explore while your account is suspended. |
| reach.ownReply | Public. Shown in the thread and on your Replies tab. Replies never enter Explore. |
| reach.onlyYou | Only you and korbat's moderators can see it. |
| reach.order | Removed for everyone else by an authority's order. |
| reach.never | korbat never lowers a post's reach in secret. Following and Latest are in time order. |

These words go to lib/moderation-words.ts (status.*) and ui-words.ts (reach.*, media.*).

Tests that change: cases.test.tsx:590-599 (the chip is a button that opens the sheet: the test renders StatusSheet with a DecisionView and finds `/settings/cases/<id>` there; the amber and surface lines it reads become `const tone = decision ? (decision.interim ? "review" : "restricted") : post.state === "withheld" ? "review" : "restricted";` and the StatusChip line, which the test reads instead); announced.test.tsx:175 (StandingBanner's tone line becomes the wash line) is Task 3's, which rewrites StandingBanner.tsx; new: status-sheet.test.tsx (each block for an interim, a final open, a pending, an answered, a program's and an order's decision; "Decided by" for `automatedDecision` fully, partially, not_automated and absent), reach.test.ts.

### 8.8 Settings

A new page, Appearance and accessibility (/settings/appearance, apps/app/src/app/settings/appearance.tsx):

- It is the one settings page a signed-out reader can open: settings/_layout.tsx lets this route through signed out, and the signed-out nav gains it after Sign in. Signed in, it shows `<SettingsNav current="appearance" />` like every settings screen but the index.
- The choices, each applied at once with no Save button, kept in localStorage under `korbat.appearance` on this device (theme-boot.js reads the same key) and in memory on native until sub-project 5:
  - Theme: a radio group, System, Light, Dim, Dark (default System); under System, "Dark style": Dim or Dark (default Dark).
  - Text size: Smaller, Default, Larger, Largest, with a sample post that follows the choice.
  - Font: korbat fonts, or System font.
  - Reduce motion: Follow the system, or Always.
  - Haptics: a switch, on by default, shown on iOS and Android only.
  - Reading: three switches, off by default: "Load older posts automatically", "Open feeds at the newest post", "Hide like, repost and follower counts".
  - No autoplay choice: korbat has no moving media (decision 17).
- On this device: the page ends with a block that lists what korbat keeps in this browser (device.body) and a secondary Button "Clear what this device keeps", which removes the appearance, the reading places and the drafts at once (the theme returns to System) and confirms with the toast "Cleared". The same three are cleared whenever the session ends: SessionProvider (apps/app/src/lib/session.tsx), where every end arrives, clears `korbat.appearance` and every `korbat.place.*` and `korbat.drafts.*` key, whatever the account, through the three modules' own clear functions, when its state moves from signed-in to signed-out and when its first /api/me answers 401 while a reading place or a draft is stored (a session revoked, expired or signed out elsewhere while the app was closed). That covers the app's real sign-outs, `signOut()` in app/settings/security.tsx:23-27 and `signOutEverywhere()` in components/security/SessionsSection.tsx:37-45, which both call the provider's refresh() and get 401 from /api/me, the lockdown pages, and any other 401, which reaches the provider's unauthenticated handler (session.tsx:62-65, fed by lib/api.ts:233). The device id (lib/api.ts) and the passkey card's "Not now" (lib/passkeys.ts) stay: they belong to the browser, not to an account. The terms' "Your data" gains the same list, joining the draft without a new TERMS_VERSION as 2c's to 3f's sentences did; terms.test.tsx holds it to the stores (Task 8).
- SettingsNav gains "Appearance" as its first entry. The nav's Settings item (AppShell.tsx:39, `/settings/security` today) opens a new Settings index, /settings (apps/app/src/app/settings/index.tsx): ListRows for Appearance (first), Security, Privacy, Profile, Account and Cases, each with its icon, so the page a newcomer looks for is the first thing Settings shows. It is the one settings screen without SettingsNav, since it is the list; signed out the layout still sends it to /signin, and the nav's own Appearance item is the way in.

The other settings pages (security, privacy, profile, account) keep their sections, words and flows, restyled: each Section becomes a card group of ListRows and fields; SessionsSection lists devices as ListRows with "this device" as a neutral chip; the Explore switch keeps its exact line in privacy.tsx (explore.test.tsx:718), passed to a ListRow as its control, with its track colours from the theme instead of hex literals; the Blocked and Muted tabs use Tabs.

| Key | Sentence |
|---|---|
| appearance.title | Appearance and accessibility |
| appearance.nav | Appearance |
| appearance.theme | Theme |
| appearance.system | System |
| appearance.light | Light |
| appearance.dim | Dim |
| appearance.dark | Dark |
| appearance.darkStyle | Dark style |
| appearance.textSize | Text size |
| appearance.smaller | Smaller |
| appearance.default | Default |
| appearance.larger | Larger |
| appearance.largest | Largest |
| appearance.sample | This is how posts will read. |
| appearance.font | Font |
| appearance.korbatFonts | korbat fonts |
| appearance.systemFont | System font |
| appearance.motion | Reduce motion |
| appearance.followSystem | Follow the system |
| appearance.always | Always |
| appearance.haptics | Haptics |
| appearance.reading | Reading |
| appearance.autoLoad | Load older posts automatically |
| appearance.openNewest | Open feeds at the newest post |
| appearance.hideCounts | Hide like, repost and follower counts |
| device.title | On this device |
| device.body | korbat keeps your appearance choices, where you stopped reading in Following and Latest, and drafts you have not sent in this browser until you sign out. A random device id, which tells a new device from a known one at sign-in, and your Not now on the passkey card stay. |
| device.clear | Clear what this device keeps |
| toast.cleared | Cleared |
| title.settings | {page} - Settings - korbat |
| title.settingsIndex | Settings - korbat |

Tests that change: lifecycle.test.tsx:41-73 (PAGES gains "appearance", as SettingsNav.tsx:5's SettingsPage type does; the row's anchors gain /settings/appearance first); cases.test.tsx:278-279 (SettingsNav's hrefs gain /settings/appearance first); lifecycle.test.tsx:58-73 (every settings screen shows the row, except settings/index.tsx, the index that lists them); explore.test.tsx:707-718 keep their lines; a11y.test.tsx:130-133 still finds every Switch labelled. New: appearance-page.test.tsx (each choice on the page written to the store, the sample post following the text size, the page signed out without SettingsNav's links); the store itself and theme-boot.js are Task 1's appearance.test.ts.

### 8.9 Public pages (/rules, /transparency, /explore/about, /terms)

- An editorial reading layout: a 640 px column, Fraunces for the page title (display-2) and section headings (display-3), the text face at the post size for prose, tables read as label and value rows below 768 px (3d design :2745), the change logs as dated lists.
- /rules, /transparency and /explore/about stay inside AppShell; /terms moves into PublicFrame. Their states ("loading", "down") and every sentence stay; their h1 and h2 elements stay (explore.test.tsx:656).

| Key | Sentence |
|---|---|
| title.rules | Rules - korbat |
| title.transparency | Transparency - korbat |
| title.exploreAbout | How Explore works - korbat |
| title.terms | Terms - korbat |

### 8.10 Sign-in, sign-up and the token pages

- (auth)/signin, code, password, mfa, age and handle, and email-revert/[token], not-me/[token] and passkey-remove/[token], move into PublicFrame (section 7.3). Their fields, buttons, links, words and flows stay; "Sign in with a passkey" stays under the email field as a secondary Button with the passkey icon (KeyRound, added to icons.ts as `passkey`). The Turnstile widget follows the theme (section 4.2).
- The six-digit code field (code.tsx) and the TOTP field (mfa.tsx) use the mono face with one-time-code autofill as today.
- The handle step keeps one step; it gains a live preview of the handle in the mono face, so the reader sees how it will look.

| Key | Sentence |
|---|---|
| title.signin | Sign in - korbat |
| title.code | Check your email - korbat |
| title.password | Sign in with a password - korbat |
| title.mfa | Two-factor authentication - korbat |
| title.age | Almost there - korbat |
| title.handle | Choose your handle - korbat |
| title.token | korbat |

Tests that change: passkeys.test.tsx:458 keeps `<Field label="Email" autoComplete={EMAIL_AUTOFILL}` in signin.tsx.

### 8.11 Errors, not found, offline

- Not found: a new apps/app/src/app/+not-found.tsx inside AppShell: EmptyState "This page doesn't exist" with "Go to Home". Caddy still answers every path with the shell (try_files), so this is what a mistyped address shows.
- A branded error boundary: apps/app/src/app/_layout.tsx exports expo-router's ErrorBoundary, which renders inside PublicFrame "Something went wrong on this screen", "Try again, or go back to Home." (it promises nothing it cannot check: the boundary does not know what a broken screen had sent), "Try again" (the boundary's retry) and "Go to Home". Nothing about the error leaves the device.
- Offline: lists and screens show ErrorState's offline form (section 6.12); on web a polite status banner "You're offline" sits at the top of the main column while navigator.onLine is false and leaves when it returns.
- Notifications do not exist today and stay out of scope until 2d.

| Key | Sentence |
|---|---|
| notFound.title | This page doesn't exist |
| notFound.action | Go to Home |
| crash.title | Something went wrong on this screen |
| crash.body | Try again, or go back to Home. |
| crash.retry | Try again |
| offline.title | You're offline |
| offline.body | korbat will load this when your connection is back. |
| title.notFound | Page not found - korbat |

## 9. The staff console

The console is restyled in apps/admin/src/app.css, within its policy (section 3.3), with the app's colour roles so the two read as one family, and red kept as the console's own mark.

- Tokens: the :root block and its `@media (prefers-color-scheme: dark)` twin gain the app's role names, `--surface`, `--surface-1`, `--surface-2`, `--line-low`, `--line-high`, `--ink-high`, `--ink-medium`, `--ink-low`, `--accent` (a fill), `--on-accent`, `--accent-ink` (text), `--focus`, and the `--review-*`, `--restricted-*` and `--ok-*` triples. The neutrals are the app's Light and Dark values (section 4.2). The accent stays red: #991B1B in light (white on it 8.31:1, and 7.66:1 as text on the Light surface) and #D13438 in dark (white on it 4.93:1), with `--accent-ink` #FF7B72 in dark; the focus ring stays blue (#2563EB light, #60A5FA dark), distinct from the red. The old names (`--bg`, `--fg`, `--muted`, `--line`, `--panel`, `--accent-fg` (app.css:13, :126), `--error-*`, `--notice-*`) stay as aliases in the same blocks, so rules move over one by one; the existing `--ok-bg` and `--ok-fg` (app.css:18-19) become two of the `--ok-*` triple, keeping their names.
- Type, on the system stack (decision 2): body 0.9375rem with line height 1.5; h2 1.5rem 700 with -0.01em tracking; h3 1.125rem 700; meta 0.8125rem in `--ink-low`; ids, handles, digests and clocks in `ui-monospace, "Cascadia Mono", Consolas, monospace` with `font-variant-numeric: tabular-nums`.
- Dense tables: 40 px rows at 600 px and wider, `--line-low` rules, no zebra, `thead` sticky only where the table's block does not scroll vertically (so it never covers a row the walk clicks), numbers right-aligned in tabular figures, a `--surface-2` row hover under `(hover: hover) and (pointer: fine)` only. Below 600 px the existing rule turns tables into blocks, as the browser walk expects.
- Keyboard first: the focus rule (app.css:138-143) extends from a, button and input to select, textarea, summary and `[tabindex]`, 2 px `--focus` with a 2 px offset; nothing removes an outline without that replacement.
- Status: banners (`.banner.suspect`, the standing and order banners) take the review or restricted wash with a 4 px rule at the start and their words first; nothing in the console says a state by colour alone.
- Motion: only `background-color` and `border-color` transitions of 120 ms on hover and focus, inside `@media (prefers-reduced-motion: no-preference)`; nothing moves.
- What does not change: every class name and the order of elements that the unit tests pin (56 class attributes) and the browser walk finds (about 35 selectors), no img or svg in the page but the evidence image, no style attribute, no other CSS file (source.test.ts), the masthead's h1 "korbat staff console" and the nav named "Console". No library is added. No skip link is added either: the walk's inspect() accepts only the console's own paths as links, and the nav is nine links long.

Screen by screen:

- Masthead and nav (Layout.tsx): surface-1, the 4 px red top rule kept, nav links as quiet tabs, the current one styled through `a[aria-current="page"]` in `--accent-ink` with an underline (no class on nav.tsx's links); the who line and IdleNotice in meta.
- Sign-in and Enroll: one 440 px card centred, the key's state as a labelled block.
- Home: the overview lines as a stack of panels, each a title, a count in tabular figures and its link; alerts first.
- Queue and Appeals: dense tables by lane, each lane's heading with its count; the phone blocks as today.
- Case and its Composer: from 1200 px two columns, the snapshot, frames and evidence on the left and the composer in a sticky column on the right with `max-height: 100vh; overflow-y: auto`, so its lower controls can always be scrolled into the 1280 by 900 viewport the walk uses; frames keep their quoted text with a 3 px `--line-high` rule at the start; the preview sits on `--surface-1`.
- Uploads, Standing, Contact, Restore: lists of blocks with a label above each value.
- Orders and Order: the one-hour clock large in the mono stack, `--restricted-ink` with the word "overdue" when it has passed.
- Audit: the chain in the mono stack, one row per entry, digests wrapping by character.
- Unavailable: one centred sentence.

Tests: a new apps/admin/test/contrast.test.ts parses app.css's two :root blocks and checks every text and control pair it declares at 4.5:1 and 3:1, as the app's test does. No existing test changes; any class a screen needs in addition is added with its unit test in the same commit.

## 10. Accessibility

The bar is WCAG 2.2 AA, checked three ways.

- Unit scans (apps/app/test/a11y.test.tsx, extended): the existing scans; no bare string literal as a JSX text child (section 1.5); no raw palette class or hex colour outside tokens.ts (contrast.test.ts); Button, IconButton, ListRow, Menu items and Tabs take `label: string` as a required prop, so tsc refuses a nameless control; no `outline-none` class without a `focus-visible:outline` beside it, and no `focus-visible:ring` anywhere in src (a box-shadow ring vanishes in forced colours).
- Render checks (react-dom/server): PostCard is `role="article"` labelled by its author line; its one link to the post has a name that contains its visible time; every Sheet is a dialog named by its title; StatusChip has its three forms (image, link, button with aria-haspopup), and section 4.8's never-colour-alone rule is tested (kit.test.tsx, Task 2): the four tones map to four different icon names, every chip renders its icon and a non-empty label, and chipText() is never empty; Tabs keep tablist, tab and aria-selected; IconButton's count is not part of its name; the Lightbox keeps its button names.
- The browser check (section 12.3): keyboard only, visible focus, focus return, contrast as drawn, 360 px reflow, 44 px targets for controls and 24 px for inline links.

Focus order and focus moves:

- Web: the skip link, the nav, the main column (its h1 first), the context column. Within a post: author, chips, reply context, body links, media, quote, actions, More. A feed's list follows the WAI-ARIA feed pattern: `role="feed"` (aria-busy while a page loads), each article with aria-posinset and aria-setsize (-1 while more can load), and Page Down and Page Up move focus to the next and previous article's open link; these are not single-character shortcuts, so they need no off switch.
- Opening a Sheet or Menu moves focus into it; closing returns it to the opener; after a delete the focus goes to the next post's open link, or to the screen's title when none is left; after sending, the focus returns to the composer's opener and the toast, announced politely, says where the post is ("Your post was sent. It is at the top of Home."), so its "View", reachable with Alt+T, is a convenience and not the only route.

Names a screen reader hears (the main ones; all words from the words modules):

| Control | Name |
|---|---|
| Post (article) | "{displayName}, @{handle}, {time ago}" |
| The post's link | "{when}, open the post" ("3h ago", "posted just now", "on 12/10/2026") |
| Reply, Repost, Like | "Reply, {n} replies", "Repost, {n} reposts", "Like, {n} likes", with singulars ("Like, 1 like"); no number when zero or hidden; Like and Repost also aria-pressed |
| Save | "Save" or "Saved" |
| More | "More options for this post" |
| New-posts pill | "{n} new posts above, go to the first one" |
| Author's chip | chipText(), a button that opens a dialog |
| Compose button | "New post" |
| Lightbox | "Close the image viewer", "Previous image", "Next image" |

Live regions: toasts (polite, section 5.4); the pill announces "{n} new posts above" politely when it first appears, never on later count changes; list loading statuses (polite); the composer's count at 900 and 1000 (polite); the offline banner (polite); ErrorText and form errors (role alert), as today.

Contrast: the token tests of sections 4.2 and 9, and the browser check's sampling of text as drawn. Text size: Largest with the root font-size at 200 percent must lose no content or control (1.4.4), checked at 320 px (1.4.10's width); 360 px must not scroll sideways either. Motion: section 5's reduced forms. Forced colours: floating layers and chips keep borders.

## 11. Performance

### 11.1 Lists

- FlatList stays on every platform (react-native-web renders it through the same VirtualizedList, which windows rows on web too); no list library is added (libraries A.5). The List wrapper (section 7.5) owns the tuning in one place, after Bluesky's PostFeed (study 2.2): `initialNumToRender` = window height / 120 rounded up, plus 1; `windowSize` 9 on native and 7 on web; `maxToRenderPerBatch` 5; `updateCellsBatchingPeriod` 40; `removeClippedSubviews` on Android only; `onEndReachedThreshold` 2 when automatic loading is on.
- Rows are memoised by key and by a version the post's own updates bump, so a like re-renders one card.
- A feed keeps at most 300 rows in memory; past that, rows farthest from the viewport on the older side are dropped and come back through "Load more". Long sessions therefore keep a bounded DOM (study 3.4).
- If profiling in a later sub-project shows FlatList cannot hold 60 frames per second on a mid-range phone, @legendapp/list 3.6.0 is evaluated in a spike with a prepend test (libraries A.5); this design does not need it.

### 11.2 Images

- The grid draws each image's small size and the lightbox its large size, the two sizes 2b produces; expo-image keeps its blurhash placeholder, `recyclingKey` set to the media id inside lists, and `priority` high for the first two rows only.
- Every image box has its size before the image loads (the ratio from the media view), so nothing shifts.

### 11.3 Budgets

With `web.output: "single"` every route loads the same entry bundle, so the per-route bundle budget is the entry budget; what differs per route is its first requests.

| Budget | Number | Measured on |
|---|---|---|
| JavaScript, all files under _expo/static/js/web | at most 480 KB gzip; if the export of main 1222b87, measured by Task 1's first step and written to apps/app/test/browser/baseline.json, where the budget test reads it, is already above 400 KB, the cap is that baseline plus 80 KB and the README records it | `expo export` output |
| CSS | at most 40 KB gzip | the same output |
| Fonts loaded on a latin page | at most 320 KB (the latin files of the three families; if Fraunces' `full` file alone breaks it, Task 1 takes its `wght` file and drops the SOFT and WONK settings) | the woff2 files fonts.web.ts names |
| API requests before a route's first content | at most 3 (for example /api/me, the timeline page, and nothing else) | the browser check's request log |
| Time to the first post on the fixture API | under 2.5 s at 1280 px on the check's machine | the browser check |

The budget test lives in the app's browser check (section 12.3): after the export it sums the gzip sizes and fails over a cap; the request count and the time are asserted on Home, a post, a profile and /rules.

## 12. Testing

### 12.1 What stays

The app's unit tests keep rendering through react-dom/server with react-native-web (apps/app/vitest.config.mts), now resolving `.web.tsx` first, with apps/app/test/setup.ts (Task 2) mocking once for every file the native modules that never load in Node (Reanimated, gesture-handler, safe-area-context, expo-haptics, expo-router/head, lucide-react-native); every source pin that a task rewrites changes in that task's commit and keeps what it protects (sections 3.2 and 8). The console's unit tests and its browser walk keep running unchanged except for section 9's new contrast test.

### 12.2 What each task proves

- Tokens and theme (Task 1): contrast.test.ts (every pair, every theme; global.css equals THEMES), theme.test.ts (fonts present, unicode-ranges, licences, the text-step maths), appearance.test.ts (the store, theme-boot.js's resolution of each stored value run in a vm context).
- Primitives (Task 2): every existing test file passing on setup.ts's shared mocks; render tests of its kit components' roles, names and states, useHaptics() mapping and its off switch, useMotion() with each reduce source, compactCount().
- Shell (Task 3): the toast API (a fake toaster), nav items and aria-current at each layout kind, the context column's contents, PublicFrame, the not-found screen, the error boundary, titles.
- Posts and media (Task 4): Sheet's and Menu's roles, names, focus and Escape; PostCard's article, link, actions, optimistic update and rollback (a fake social client that answers or refuses), menus, delete hand-off; reach.test.ts; MediaGrid and Lightbox names.
- Feeds (Task 5): Tabs' roles and roving focus; feed-rows.test.ts, reading-place.test.ts, new-posts.test.ts (fake timers), feed-cache.test.ts, the anchor maths of anchor.web.ts as a pure function.
- Composer (Task 6): composer-state.test.ts (every transition), drafts.test.ts, the sheet's discard question only with content, the sent toast.
- Moderation and public pages (Task 7): status-sheet.test.tsx, the hidden-image link, the restyled case screens' words.
- Settings and auth (Task 8): the appearance page, the Settings index, the settings row with Appearance, the auth screens in PublicFrame, the Turnstile theme (Task 1's) kept, the emptied colour and Text allowlists, the terms' list of what the device keeps.
- Console (Task 9): its contrast test and its full browser walk.

### 12.3 The app's browser check

Decided: the app gains one (decision 20).

- Files: apps/app/vitest.browser.config.mts (Node environment, TZ UTC, a 600 s hook timeout for the export), apps/app/test/browser/app.browser.ts (the walk), fixture-api.ts (the API answers the walk needs: /api/me signed in and out, the timelines with cursors and a "new posts" switch, a post and its thread, a profile and its lists, Explore, a decision, the public facts, and one 2 by 2 WebP image), server.ts (serves the export with the headers of the Caddyfile's app_page_headers, read from infra/caddy/Caddyfile by a helper, apps/app/test/browser/caddyfile.ts, as apps/admin/test/caddyfile.ts does for the console), watch.ts (fails on any policy report, console error or warning, page error, dialog or unexpected failed request, after apps/admin/test/browser/watch.ts).
- The build: `expo export --platform web --output-dir <temp>`, once per run, with `EXPO_NO_DOTENV=1` and every EXPO_PUBLIC_* variable set in the child's environment for the check (EXPO_PUBLIC_API_URL the empty string, which lib/api.ts:8 keeps, so calls go to the fixture server's own origin; Cloudflare's published Turnstile test site key), so the developer's apps/app/.env is never read.
- No internet: the walk answers https://challenges.cloudflare.com/* through `context.route` with a small stub of the Turnstile script that calls the widget's callback with a test token, and watch.ts counts that origin as expected; the check needs no network and no stack.
- The browser: playwright-core 1.63.0 as a devDependency of apps/app (already in the lockfile), driving the Chromium build it names or `KORBAT_BROWSER_CHANNEL`; it never runs `playwright install`. The script is `pnpm --filter @korbat/app test:browser`, which runs `vitest run --config vitest.browser.config.mts` (.mts like the unit config, since apps/app/package.json has no "type": "module").
- The matrix, grown by each task with its own screens (section 13: Task 3 the shell and the routes that exist, Task 4 lightbox, like and follow, Task 5 pill and place, Task 6 composer, Task 7 status sheet, Task 8 Appearance and the theme steps), without running every step everywhere: the full walk (every route of section 8, signed out and signed in) at 1280 by 900 in Dark; the layout steps (shell, Home, a post, a profile, the composer, a sheet, Appearance, /rules) at 360 by 740, 768 by 1024 and 1280 by 900; the theme steps (contrast sampling on Home, a post, the status sheet, Appearance and /rules) in Light, Dim and Dark; one text-size step at 320 by 640 with Largest and the root font-size at 200 percent on Home, a post, the composer and Appearance (no horizontal scroll, no label clipped in width or height); the motion steps (sheet, lightbox, like, follow, pill) once with `reducedMotion: "reduce"`, once without, and once with korbat's own "Reduce motion: Always".
- What it asserts: no policy report and no error on any step; at 360 px no horizontal scroll, no clipped label (scrollWidth against clientWidth) and the app's own target rule, phoneProblems in apps/app/test/browser/watch.ts after the console's: every control at least 44 by 44 px, except an `a` laid out inline inside a text block (computed display inline, in a parent that is not a flex row of controls: a link in a post body, a mention, "Replying to", the author line, a link in a notice), which needs 24 by 24 px under WCAG 2.5.8, and an element clipped to 1 px by VisuallyHidden, which is skipped until it takes focus and then measured; keyboard only, Tab reaches the skip link, the nav, the title and the first post's open link in that order, every focused element shows an outline (outline-style not none) of at least 2 px, Escape closes every sheet and focus returns to its opener; every text element in the main column, sampled against its nearest opaque background, meets 4.5:1 (3:1 at 24 px and up, or 18.66 px bold); under reduced motion a sheet and the lightbox show no transform between frames, and without it they do; the first paint (the bundle held back by the fixture server for 2 s) already has the stored theme's html class and background; at 360 px a toast's action and the compose button do not intersect; the "N new posts above" pill appears after the fixture adds posts, and the post at the top of the viewport has not moved; the budgets of section 11.3.
- Screenshots of each layout step are written to the temporary folder for the walk-through and never compared pixel by pixel.

### 12.4 Gates

- Every task: `pnpm --filter @korbat/app typecheck`, `pnpm --filter @korbat/app test`, and for Task 9 `pnpm --filter @korbat/admin typecheck` and `test`.
- From Task 3 on, the tasks that end a batch also run `pnpm --filter @korbat/app test:browser`; Task 9 runs `pnpm --filter @korbat/admin test:browser`.
- Batch ends run the runner's whole integration suite, as every sub-project's batches do.

## 13. Tasks

Ten tasks in build order, in four batches: Tasks 1 to 3, 4 to 6, 7 and 8, and 9 and 10. Each task adds its packages at the pins of section 1.8, updates in its own commit the source pins of the files it rewrites, removes its files from the legacy allowlists of sections 1.5 and 4.2, and runs the gates of section 12.4.

**Task 1. Tokens, fonts, Text, Icon and the theme switch.** Goal: the design language in code, and the theme from the first frame. Its first step measures the web export of 1222b87 and writes apps/app/test/browser/baseline.json (section 11.3). Creates apps/app/src/theme/tokens.ts, cn.ts, layout.ts, motion.ts, fonts.ts, fonts.web.ts, ThemeProvider.tsx, apps/app/src/lib/appearance.ts (the store of section 8.8), apps/app/src/components/kit/Text.tsx (rem on web through one typed helper, section 4.3), Icon.tsx (lucide-react-native), Icon.web.tsx (lucide-react), apps/app/src/components/icons.ts (names as strings), apps/app/public/theme-boot.js, apps/app/assets/fonts/LICENSES/ (the three licence files). Changes apps/app/package.json (lucide-react, lucide-react-native, react-native-svg, class-variance-authority, clsx, the three @fontsource-variable packages), pnpm-lock.yaml, tailwind.config.js, global.css, metro.config.js (adds woff2 to `resolver.assetExts` before withNativeWind; neither Metro's nor Expo's default list has it), vitest.config.mts (web extensions first), public/index.html (theme-boot.js, color-scheme, viewport-fit), src/app/_layout.tsx (ThemeProvider, fonts), (auth)/signin.tsx, password.tsx and components/moderation/ReportForm.tsx:257 (Turnstile theme). Tests: contrast.test.ts, theme.test.ts, appearance.test.ts. Tests that change: explore.test.tsx:864-866 (the storage list gains lib/appearance.ts). Not a batch end; no stack rebuild.

**Task 2. Primitives, haptics, motion and the test mocks.** Goal: the owned components of section 6 that screens build on; Sheet and Menu come with their first users in Task 4, Tabs in Task 5 and the toasts in Task 3, so this task is not twice the size of those after it. Creates kit/IconButton.tsx, Avatar.tsx, ListRow.tsx, Skeleton.tsx, EmptyState.tsx, ErrorState.tsx, StatusChip.tsx, VisuallyHidden.tsx, PublicFrame.tsx, lib/haptics.ts, lib/motion.ts, lib/time.ts, lib/format.ts (compactCount), lib/ui-words.ts, and apps/app/test/setup.ts, named in vitest.config.mts's `test.setupFiles`: one set of mocks for what never loads in Node (react-native-reanimated with useReducedMotion, Animated.View and Text, useSharedValue, useAnimatedStyle, withSpring, withTiming, runOnJS and the layout animations used; react-native-gesture-handler with GestureDetector and GestureHandlerRootView as pass-throughs and a chainable Gesture.Pan; react-native-safe-area-context with a pass-through provider and zero insets; expo-haptics; expo-router/head; lucide-react-native). Changes components/ui.tsx (on the kit, export names and the lines lifecycle.test.tsx:240-241 pins kept), package.json (expo-haptics), and the twelve test files whose one-export Reanimated mock (`useReducedMotion` only) moves onto setup.ts: announced, appeals, automated, cases, explore, hidden-media, image-fault, orders, public-pages, report, reporting and standing (.test.tsx). expo-router stays mocked per file; a task that makes a screen import a new expo-router name adds it to the mocks of the files that render that screen. Tests: kit.test.tsx (roles, names, states of each component), a11y.test.tsx (the bare-string scan with `LEGACY_TEXT_FILES`, the outline rule), haptics.test.ts, motion.test.ts, format.test.ts. Not a batch end; no stack rebuild.

**Task 3. The shell, navigation and the app's browser check.** Goal: the layout of section 7 on every screen, and the check that guards everything after it. Creates components/toast.tsx, toast.web.tsx, components/AboutCard.tsx (How korbat works), lib/page-title.tsx (usePageTitle over expo-router/head; each later task gives its screens their titles), app/+not-found.tsx, apps/app/vitest.browser.config.mts, test/browser/app.browser.ts, fixture-api.ts, server.ts, watch.ts, caddyfile.ts. Changes components/AppShell.tsx (rail, full nav, tab bar with icons, context column, safe areas, skip link, offline banner), SettingsNav.tsx, StandingBanner.tsx, HandleBox.tsx, app/_layout.tsx (GestureHandlerRootView, SafeAreaProvider, Toaster, ErrorBoundary), bookmarks.tsx, report.tsx, notice/[ref].tsx, followers.tsx, following.tsx (loading inside the shell), lib/session.tsx (SessionFailure on ErrorState, off LEGACY_COLOUR_FILES), package.json (sonner, sonner-native, playwright-core dev, the test:browser script), lib/social.ts (the `popular` call, left without a caller); deletes components/PopularNow.tsx (decision 14). Tests that change: explore.test.tsx:823-839 and hidden-media.test.tsx's "Popular now" block (removed with the component; the case they share, an image-only post named by its image's description, moves onto ExploreList's rendering in the same files), explore.test.tsx:241-242 (the `/?tab=` links are app/explore/about.tsx's only) and :853-862 (Explore's callers lose PopularNow.tsx; the files read become four), announced.test.tsx:175; standing.test.tsx:120 (AppShell's StandingBanner line) kept. New: shell.test.tsx (nav at each layout kind, the context column, PublicFrame, not-found, the error boundary, titles, the toast API with a fake toaster). Batch end (Tasks 1 to 3); stack task: the Caddy image is rebuilt with the new export, and the smoke test, scripts/smoke-auth-stack.mjs (changed in this task), loads /, /theme-boot.js (no-cache), a font under /assets/ (immutable; its hashed URL is the first `/assets/...woff2` string in the entry bundle that index.html names) and /post/<id> with its 200 and 404.

**Task 4. The post, its media and the lightbox.** Goal: section 6.6, 6.7 and 6.14. Changes components/social/PostCard.tsx, RichText.tsx, MediaGrid.tsx, MediaViewer.tsx, HiddenImage.tsx, ImageFault.tsx, ProfileList.tsx (FollowButton optimistic, section 8.4), lib/social.ts (per-kind request lanes; compactCount is Task 2's); creates kit/Sheet.tsx, kit/Menu.tsx (with their kit.test.tsx cases), lib/reach.ts, components/social/PostMenu.tsx, WhoSeesThis.tsx; adds the lightbox, like and follow steps to test/browser/app.browser.ts and their answers to fixture-api.ts. The author's chip moves onto StatusChip in its link form, still opening /settings/cases/<id>; Task 7 turns it into the button that opens the details sheet. Tests that change: report.test.tsx:209-219 (Report in the More menu, rendered open), :237-246 (MediaGrid and QuoteEmbed lines and link order), cases.test.tsx:598-599 (the chip's tone and StatusChip lines), a11y.test.tsx:135-140 (the focus returns to More), explore.test.tsx:855 (Explore's callers gain WhoSeesThis.tsx, which keeps the status in component state under the same no-storage check; the files read are five again), hidden-media.test.tsx:144 (Reply is an icon now, so the quote's sentence is ordered before the Reply button's tag, the index of `aria-label="Reply`, in the markup rather than the stripped text), hidden-media.test.tsx:175-176 kept. New: post-card.test.tsx (article, the link's name in each postedWhen form, names at 0, 1 and many, optimistic update and rollback of the actions and of FollowButton, menus), reach.test.ts. Not a batch end; no stack rebuild.

**Task 5. Feeds, threads and profiles.** Goal: section 8.2 to 8.5. Creates kit/Tabs.tsx (with its kit.test.tsx cases), components/list/List.tsx, anchor.ts, anchor.web.ts (section 7.5), lib/feed-rows.ts, reading-place.ts, new-posts.ts, feed-cache.ts, components/social/FeedList.tsx, NewPostsPill.tsx, FeedRows.tsx. Changes components/social/PagedList.tsx (on List and typed rows), ExploreList.tsx, app/index.tsx, post/[id].tsx, u/[handle]/index.tsx, followers.tsx, following.tsx, bookmarks.tsx, lib/social.ts (an optional `limit` on following and latest, the query helper building both parameters; the lines explore.test.tsx:716, :778 and :866-867 read from it are kept), lib/session.tsx (the session's end clears the appearance and the reading places, section 8.8), test/browser/app.browser.ts and fixture-api.ts (the pill and reading-place steps, the "new posts" switch). Tests that change: explore.test.tsx:864-866 (the storage list gains lib/reading-place.ts), explore.test.tsx:231, :238, :239 (the empty sentence, from its words module), :400-406, :518-542 and the homeListKey cases; passkeys.test.tsx:329 kept; report.test.tsx:248-256 (the profile's menu); explore.test.tsx:771-803 kept (post/[id].tsx's expo-router import line, :785, gains no name: titles come through lib/page-title.tsx, and the anchoring sits beside the focus effect of :791-803). New: feed-rows.test.ts, reading-place.test.ts, new-posts.test.ts, feed-cache.test.ts, anchor.test.ts (the anchor's arithmetic as a pure function). Not a batch end; no stack rebuild.

**Task 6. The composer.** Goal: section 6.15 and 8.6. Creates components/social/composer/state.ts, ComposerField.tsx, ProgressRing.tsx, SendBar.tsx, DiscardDialog.tsx, lib/drafts.ts. Changes Composer.tsx, ComposerImages.tsx, ComposeSheet.tsx (on Sheet), useImageUploads.ts, app/index.tsx (the collapsed card), app/post/[id].tsx (the reply card), lib/session.tsx (the session's end clears drafts too), test/browser/app.browser.ts and fixture-api.ts (the composer steps). Tests: composer-state.test.ts, drafts.test.ts (written, sent, discarded, cleared when the session ends), the sheet's discard and sent-toast cases. Tests that change: explore.test.tsx:864-866 (the storage list gains lib/drafts.ts); standing.test.tsx:126 (ComposeSheet's `{refusalSentence(standing)}`) and explore.test.tsx:771-803 kept. Batch end (Tasks 4 to 6), with the browser check's full walk; no stack rebuild.

**Task 7. Moderation surfaces and the public pages.** Goal: section 8.7 and 8.9. Creates components/moderation/StatusSheet.tsx. Changes components/moderation/CasesLists.tsx, DecisionDetail.tsx (the `?appeal=1` focus), ItemLines.tsx, NoticeStatusView.tsx, RefusedNotice.tsx, ReleaseNotice.tsx, ReportForm.tsx, UploadNotice.tsx, app/settings/cases/ (five files), report.tsx, notice/[ref].tsx, rules.tsx, transparency.tsx, explore/about.tsx, terms.tsx (into PublicFrame), lib/moderation-words.ts (the status words). Also changes components/social/PostCard.tsx (the author's chip becomes the button that opens StatusSheet) and MediaGrid.tsx (the "Why are images hidden?" link), and test/browser/app.browser.ts and fixture-api.ts (the status sheet's steps and a decision). Tests that change: cases.test.tsx:590-597 (the decision's link is found in the open sheet); kept: cases.test.tsx:247-249, 260-264, 288-296, 546-548, 666-668 and 871, appeals.test.tsx:126-127, :202-204, :270-273 and :283, automated.test.tsx:103 (`maxLength={OBJECTION_TEXT_MAX}`) and :135 (`onAsk={ask}`), report.test.tsx:486-489, announced.test.tsx:306. New: status-sheet.test.tsx. Not a batch end; no stack rebuild.

**Task 8. Settings, security, auth and Appearance.** Goal: section 8.8 and 8.10. Creates app/settings/appearance.tsx and app/settings/index.tsx (the Settings index, which the nav's Settings item now opens). Changes app/settings/_layout.tsx (Appearance signed out), security.tsx, privacy.tsx, profile.tsx, account.tsx, components/security/ (seven files), app/(auth)/ (six screens and the layout), email-revert/[token].tsx, not-me/[token].tsx, passkey-remove/[token].tsx, SettingsNav.tsx (Appearance first), AppShell.tsx (the signed-out nav's Appearance item, with its route; the Settings item opens /settings), test/browser/app.browser.ts and fixture-api.ts (the Appearance steps and the theme matrix), lib/terms.ts ("Your data" lists what the device keeps, no new TERMS_VERSION) and terms.test.tsx (that sentence names every store). Empties `LEGACY_COLOUR_FILES` and the Text scan's allowlist. Tests that change: lifecycle.test.tsx:41-73 (PAGES gains appearance; :58-73 leaves out settings/index.tsx, the list itself), 188, 200, 229, cases.test.tsx:278-279 (SettingsNav's hrefs gain /settings/appearance first), passkeys.test.tsx:380 and :458 kept, explore.test.tsx:707-718 kept; also kept: announced.test.tsx:270-272 (account.tsx's terminate line), standing.test.tsx:162, lifecycle.test.tsx:134-136 and the account.tsx blocks of :145-245, passkeys.test.tsx:322-337, :356-448 (ReauthPanel and its three `{reauth.pending ? <ReauthPanel` lines), :454-458 (with `label="Sign in with a passkey"`) and :506-508; passkeys.test.tsx:520-536 changes: `sentences()` reads the lockdown sentences from the words module they move to (section 1.5) instead of the three token pages and PasskeysSection.tsx. New: appearance-page.test.tsx. Batch end (Tasks 7 and 8), with the browser check's full matrix; no stack rebuild.

**Task 9. The console within its policy.** Goal: section 9. Changes apps/admin/src/app.css, and Layout.tsx only where a state needs a class; nav.tsx is not changed (the current link is styled through `a[aria-current="page"]`), so apps/admin/test/source.test.ts:64-66 (exactly three `href={` lines, all in nav.tsx) and cases.test.tsx:1074 (`<a href="/queue" aria-current="page"`) are kept; creates apps/admin/test/contrast.test.ts. Checks: the console's unit tests unchanged, `test:browser` with its 79 steps, 23 at 360 by 740 px; at 1280 by 900 the composer steps (console.browser.ts:618, :683, :704, :739, "Confirm with your staff key" among them) and the nine clicks on `table.queue tbody tr` prove the sticky column and thead. Not a batch end; no stack rebuild.

**Task 10. Documentation and the walk-through.** Goal: the record. The design itself, docs/superpowers/specs/2026-10-21-interface-and-experience-ui-design.md (parts 1 to 6 joined), is committed before Task 1, as every sub-project's design is; this task fills its section 15 from the dry run; README.md gains "The interface" (themes, the reading place and what is stored on the device, by key, and when it is cleared, haptics, the browser check and how to run it, the budgets) and a new section "Third-party notices" (the fonts under the OFL 1.1 with the LICENSES folder, Lucide's ISC with its Feather MIT notice, class-variance-authority's Apache-2.0 notice, sonner's and sonner-native's MIT), placed so the sections apps/admin/test/readme.test.ts reads (## Moderation, ## Authorities' orders, ## Quarantine, ## Backups, ## Restoring, ## Upgrading, ## Before going public) keep their bounds; apps/admin/README.md notes the console's tokens; the main design's section 5 is marked delivered and section 9 gains the dated amendment "2026-10-21, the UI sub-project" (delivered; handles in the mono face; Popular now left the context column, amending the 2c design's section 11 too; the decisions of section 2; status and order: next 3b import, 2d engagement, 4 hardening, 5 native builds). a11y.test.tsx gains the check that `LEGACY_TEXT_FILES` names no file a task of this sub-project rewrote, and section 15 records the files still on it. The walk-through runs the browser check's layout steps at 360, 768 and 1280 px in the three themes and keeps the screenshots in the scratch folder, not in git. Batch end (the whole integration suite); stack task: the stack rebuilt from clean and the smoke test of Task 3 run again.

## 14. What is left for later

Sub-project 5, native builds:

- react-native-keyboard-controller 1.22.7 (or the line Expo then tests) for the composer and replies.
- react-native-screens form sheets for the composer and menus on iOS and Android, behind the same Sheet API.
- Static font files embedded with expo-font's config plugin (@expo-google-fonts/fraunces, atkinson-hyperlegible-next and atkinson-hyperlegible-mono 0.4.1, or their versions then), and fonts.ts naming them.
- Persistent storage on native for the appearance, the reading place and drafts, with a storage library chosen then under the same floor: a defect to fix, not polish, since study 3.2 names losing the draft and the place on native as Bluesky's weak point.
- Haptics, the lightbox's pinch and zoom, and sonner-native's reduced motion checked on devices; state kept across an Android configuration change (study 3.2); app icons and the splash; keyboard shortcuts on web with their off switch.

Sub-project 2d, engagement:

- Notifications (grouped, a seen-at snapshot, no re-engagement pushes; study 4.6), uploaded avatars in the Avatar component's place, mentions as data, share cards with server-rendered titles and meta, help on a first visit, and the author's per-post "hide counts".

Other places:

- A "Restored after appeal" chip and the deadline on the chip need PostModeration to grow (decision 11).
- Reply order and a threaded view need the replies route to sort (study 4.10).
- A list of recent sign-ins in Settings, Security, which the main design's section 5 names, needs an account-side route; the console has one.
- A web manifest, a service worker and an offline page: sub-project 4.
- Translations: an i18n sub-project before korbat is offered in a home state whose language is not English (decision 1).
- @legendapp/list, if profiling ever asks (section 11.1); NativeWind 5 with Tailwind 4, and Expo SDK 58 with every expo-* module together (libraries 4).

## 15. Amendments from the dry run
