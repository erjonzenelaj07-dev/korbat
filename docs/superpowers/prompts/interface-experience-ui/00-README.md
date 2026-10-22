# korbat interface and experience (UI) — execution prompts

One file per task. Each file is a complete, self-contained prompt: paste the whole file into a fresh Claude Code session opened at `C:\Users\Lenovo\Desktop\cool\korbat` and let it run. Do them in order. Every prompt checks that the previous task's commit is the latest one before it starts.

## How these prompts were made reliable

Every task was dry-run end to end on 2026-10-21 to 2026-10-22 in a scratch clone of this repository, one commit per task. For each task a runner wrote the tests, ran them and required the expected failure, and wrote the implementation. It then ran every verification command and required each expected line, refused any changed file outside the task's list, and only then committed. These prompts are generated from those commits and the recorded outputs. Every file block is the committed file, and every "Observed on the dry run" block is real output. The scratch clone used shifted ports and its own compose project; the prompts use this repository's real ports and commands.

The dry run found and settled these points before the prompts were written:

- **The whole icon set in the bundle (Task 2).** Importing Lucide's named icons from its main entry bundled all of its roughly 1,900 icons and put the web export about 170 KB over its budget. Each icon is now imported from its own module, and a test holds both Icon files to that.
- **A page policy report on every page (Task 3).** zod's probe for `new Function` was reported as an eval violation on every page of the web build. zod is made jitless from the app's own entry, before expo-router loads the route tree.
- **Gesture handler's weight on the web (Tasks 3 and 4).** Its root view and its index pulled about 55 KB gzip into the web bundle. The web build uses a plain view for the root and pointer events for drags (`DragArea.web.tsx`); native keeps gesture handler.
- **Reanimated springs that did not move (Task 4).** A spring started from its own target value never runs, and a spring that follows a running timing inherits no velocity. The like's pop is now released from its pressed scale every time, and the rule is recorded for every later motion.
- **The new-posts pill that jumped to the top (Task 5).** react-native-web's `scrollTo` dropped the y offset, so the pill scrolled to the top instead of to the oldest new post; the element's own `scroll()` is used.
- **Typing in the composer's card broke the screen (Task 6).** A card's callback returned a value from inside an effect, which React called on cleanup.
- **Labels broken inside a word (Task 10's walk-through).** At 768 px the tablet rail drew Bookmarks and Appearance over two lines; the console's Appeals table cut its dates at the hyphen. Both are fixed, each with a test that fails without the fix.
- **The design's text follows the code where they differ.** The dry run recorded its amendments in the design's section 15.

Each prompt replaces judgment with rules. Files are complete and copied byte for byte, commands run verbatim, and every expected line must appear. Any mismatch is a **STOP condition** that ends the session with a report instead of an improvised fix. The single permitted self-recovery is a clean `node_modules` reinstall after a `Cannot find module` error in a verification step.

## What can differ between runs

- **Run noise.** Timings and commit hashes differ on every run; every install prints `Packages: -N`, the optional packages pnpm skips on Windows, and may remove hoisted packages the lockfile no longer holds.
- **Durations.** The app's browser check builds the web export and walks the app, which takes 3 to 10 minutes; the console's takes a few minutes. Task 10 runs the whole integration suite twice, on a fresh database and on one upgraded from 0042, and rebuilds every image of the stack; Task 3 rebuilds the stack too.
- **The integration gate retries.** It runs vitest with `--retry=2 --testTimeout=20000`, because other work on the machine can push unrelated tests past their limit; a test that fails for a reason of its own fails all three tries. A machine that sleeps during the run fails a test whose timings span the sleep: run that file again alone.
- **The browser checks drive a Chromium build already on the machine** (playwright-core 1.63's, or `KORBAT_BROWSER_CHANNEL`); they never download a browser.
- **The app's browser check answers Turnstile with a stub and serves its own export,** so it needs neither the stack nor the internet; another program on port 8080 does not affect it.

## Verified in the dry run only

These checks ran in the scratch clone only, because they need a browser or seed data the development database must not get:

- **The design's review** (before Task 1): two reviewers, one for build fit and one for people and values, recomputed every contrast ratio and upheld 61 findings, applied to the design before it was committed.
- **The walk-through** (Task 10): the app's 15 layout pages at 360, 768 and 1280 px in Light, Dim and Dark, with reduced motion on and off, the New post sheet and the lightbox (342 screenshots), and every console screen at 360 and 1280 px in light and dark (112 screenshots), looked at by the implementer. Its two defects were fixed in Task 10.
- **Screenshots per task:** each implementer looked at its screens at 360 and 1280 px in Light and Dark before its report; the screenshots stay in the scratch clone's ignored `.data/`.

## Before you start

- **Files are written by a script, never typed.** A file block can contain backslash escape sequences, and a writing tool can decode those into the characters they stand for; the 2b dry run's own tooling did exactly that once. These prompts were replayed into the repository by `replay.py` in the scratch tooling, which runs exactly these steps without a model session; a fresh session following them by hand must reach the same commits. Every writing step therefore runs `write_blocks.py`, which copies the step's blocks from the committed prompt file byte for byte, and `verify_prompts.py` checks the result after the last task.
- Every gate in the dry run ran with its standard input closed and a time limit. If a step sits without output for much longer than its allowed difference says, it is stuck, not slow: stop it and report.

## Order

| # | File | What it delivers | Needs Docker? |
|---|---|---|---|
| 1 | `01-tokens-fonts-text-icon-theme.md` | Tokens, fonts, Text, Icon and the theme switch: the design language in code, and the theme from the first frame. | no |
| 2 | `02-primitives-haptics-motion-mocks.md` | Primitives, haptics, motion and the test mocks: the owned components of section 6 that screens build on. | no |
| 3 | `03-shell-navigation-browser-check.md` | The shell, navigation and the app's browser check: the layout of section 7 on every screen, and the check that guards everything after it. | **yes** |
| 4 | `04-post-media-lightbox.md` | The post, its media and the lightbox: section 6.6's post card with its menus and optimistic actions, section 6.7's media and lightbox, and section 6.14's Who sees this. | no |
| 5 | `05-feeds-threads-profiles.md` | Feeds, threads and profiles: section 8.2's feed that keeps the reader's place (typed rows, the reading place, new posts and their pill, the session's feed cache) on section 7.5's List and anchor, section 8.3's thread, section 8.4's profile with its menu and account lists, section 8.5's Bookmarks, and section 6.10's Tabs. | no |
| 6 | `06-the-composer.md` | The composer: section 6.15's parts on a pure reducer (ComposerField, ProgressRing, the image tray, SendBar and DiscardDialog) with drafts kept on the device (decision 18), section 8.6's sheet on kit/Sheet with its sent toast, Home's collapsed card (decision 19) and the thread's reply card (section 8.3), and New post on every screen (sections 7.2 and 7.3). | no |
| 7 | `07-moderation-surfaces-and-public-pages.md` | Moderation surfaces and the public pages: section 8.7's StatusSheet, opened by the author's chip and read fresh from the decision, the link under a hidden image to /rules (decision 10), the case screens, the report form and a report's status page on the kit, and section 8.9's reading layout for /rules, /transparency and /explore/about, with /terms in PublicFrame. | no |
| 8 | `08-settings-security-auth-appearance.md` | Settings, security, auth and Appearance: section 8.8's Appearance and accessibility page, open signed out, with its radio groups, Reading switches, sample post and On this device, the Settings index the nav's Settings item opens, Security, Privacy, Profile, Account and components/security on the kit, and section 8.10's sign-in flow and token pages in PublicFrame, with the theme's cross-fade and the legacy lists emptied. | no |
| 9 | `09-console-within-its-policy.md` | The console within its policy: section 9's restyle of apps/admin/src/app.css on the app's colour roles in light and dark with red kept as the console's mark, its type, mono ids and clocks, dense tables, one focus rule, status washes, colour-only motion and screens, the case's sticky composer column from 1200 px, and apps/admin/test/contrast.test.ts holding every pair the console draws to WCAG AA. | no |
| 10 | `10-documentation-and-walk-through.md` | Documentation and the walk-through: section 15 from the dry run, the README's The interface and Third-party notices, the console's tokens in apps/admin/README.md, the main design's section 5 marked delivered with its 2026-10-21 amendment and the 2c design's section 20, the check that no rewritten file is left on a legacy list, and the walk-through at 360, 768 and 1280 px in the three themes. | **yes** |

## Reading a report

Every session ends with a `TASK N REPORT` block. Check three lines before starting the next prompt:

1. `STOP condition hit: none`. If not, the session stopped on purpose. Read the pasted output, fix the environment (Docker not running, a port in use, data services down), and re-run the same prompt from a clean `git status`.
2. Every `Verify` line shows the expected text from the prompt.
3. The `Commit` line ends with the commit subject printed in the prompt.

If a report shows a STOP that is not an environment problem, paste the report back to the planning session. Do not let the executing session improvise.

The design is `docs/superpowers/specs/2026-10-21-interface-experience-ui-design.md`, including its amendments from the dry run. The task map is `docs/superpowers/plans/2026-10-22-interface-experience-ui.md`. Where the plan and a prompt differ, the prompt is the verified version.

## Verify the prompts against the repository

After Task 10, run this from the repo root. It extracts the last version of every file the prompts write and compares it with the file on disk:

```bash
python docs/superpowers/prompts/interface-experience-ui/verify_prompts.py
```

Expected: `prompts reproduce the repository exactly`.

## Execution findings (2026-10-22)

The ten prompts were replayed into this repository by the fast path the owner chose for 3d: each task's files were written from its prompt by `write_blocks.py`, the install step run where a task changes the lockfile, and the task committed with the dry run's message and the stray-file check; then the gates of Task 10 ran once, on a database upgraded from 0042, with the console's and the app's browser checks, the stack rebuilt and the smoke test through Caddy. All passed.

| Task | Commit |
|---|---|
| 1 | `a0ef9f0` |
| 2 | `cd9554e` |
| 3 | `21b9e66` |
| 4 | `ca30365` |
| 5 | `5d120fe` |
| 6 | `7e892f7` |
| 7 | `5c4e853` |
| 8 | `61b1134` |
| 9 | `99f995c` |
| 10 | `005d989` |

- **Identical to the dry run.** Each commit changes the same paths as its dry-run commit, and after every task the tree is byte-identical to the dry run's, the lockfile included. `verify_prompts.py` reproduces all 217 files.
- **The first fast replay left the lockfile behind.** It wrote the file blocks but skipped the install step of Tasks 1 to 3, so their commits lacked the lockfile's new entries. Nothing was pushed: the repository was reset to the prompts' commit and replayed again with the install step, which is how the prompts read.
- **What the machine needed.** Another program listened on port 8080 on every interface, so the run set `NODE_OPTIONS=--dns-result-order=ipv4first`; Windows still reserved the ports 58022 to 58121, so the development Mailpit was published on 58225 for the run and put back afterwards, as for 3d.
- **Three load effects the dry run settled.** A source scan in `kit.test.tsx` ran past the unit gate's 20 s only inside the workspace's parallel run (3 s alone): it carries a limit of its own. The app's browser walk read elements before the app had drawn them on a loaded machine, a different step each run: `visit()` waits for the main region and a step gets one more try. A run that slept overnight timed out one integration test: run such a file again alone.
- **The review that shaped the design.** Before Task 1, two reviewers (build fit; people and values) recomputed every contrast pair and upheld 61 findings, applied before the design was committed. Task 10's walk-through at three widths, three themes and both motion settings found two defects (the tablet rail broke two labels; the console's table cut its dates), fixed with tests.
