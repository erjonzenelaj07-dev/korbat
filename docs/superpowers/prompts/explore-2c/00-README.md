# korbat explore (2c) — execution prompts

One file per task. Each file is a complete, self-contained prompt: paste the whole file into a fresh Claude Code session opened at `C:\Users\Lenovo\Desktop\cool\korbat` and let it run. Do them in order. Every prompt checks that the previous task's commit is the latest one before it starts.

## How these prompts were made reliable

Every task was dry-run end to end on 2026-09-28 in a scratch clone of this repository, one commit per task. For each task a runner wrote the tests, ran them and required the expected failure, and wrote the implementation. It then ran every verification command and required each expected line, refused any changed file outside the task's list, and only then committed. These prompts are generated from those commits and the recorded outputs. Every file block is the committed file, and every "Observed on the dry run" block is real output. The scratch clone used shifted ports and its own compose project; the prompts use this repository's real ports and commands.

The dry run found and settled these points before the prompts were written:

- **drizzle-kit writes its files without a final newline**; the SQL, the snapshot and the journal get one before the migration is applied anywhere, as every committed migration has (1c's replay found the same), so the replay writes them byte for byte.
- **Names the design leaves open**: primary key `explore_items_generation_position_pk`, unique index `explore_items_generation_post_idx`, foreign keys `explore_items_generation_explore_runs_generation_fk`, `explore_items_post_id_posts_id_fk`, `explore_items_author_id_profiles_id_fk`; drizzle exports `exploreRuns`, `exploreItems` and `profiles.showInExplore`.
- **The grants need no migration**: `korbat_api` gets select, insert, update and delete on both tables and usage on the identity sequence from `0001_grants.sql`'s default privileges (checked on the scratch database).
- **`ExplorePage.items` is `TimelineItem[]` with a runtime check that refuses reposts**, so the flow can hand the view builder's output straight in and the app's timeline list accepts the page; `ExploreFormula` types every number as `number`, so tests can pass a changed formula.
- **`apps/api/test/social/messages.test.ts`** pins the new API message tests-first, on the pattern of the auth module's messages test.
- **`set local` applies inside the round**: drizzle's `db.transaction` on postgres.js reserves one connection (`client.begin`), and `tx.execute` runs on it, so the 30-second statement and 5-second lock timeouts hold for every statement of the round; an integration test proves the lock timeout fires under a pool whose own setting is 20 seconds.
- **The ranking tests run in epochs of their own**: the ranking suite's clock starts at 2020-01-01 and the job suite's at 2021-01-01, each test in a 10-day span of its own that first deletes `explore_runs`, so no other suite's rows fall in a window; later read tests take 2022 or later.
- **A failed round still uses up a generation number** (an identity sequence is not rolled back), so no test asserts that generations are consecutive.
- **The job's integration tests move the clock rather than fake the timers**, because fake timers stop postgres.js's own timers; the timer itself is tested with fakes in a unit test (`apps/api/test/social/explore-job.test.ts`).
- **The refresh's plan** on the scratch database with synthetic volume (20,018 posts, 200,000 likes, 40,000 reposts) reads likes and reposts through `likes_created_brin` and `reposts_created_brin`, runs the per-author cap as a window run condition, and takes about 315 ms; the `count(distinct)` sort spills 4.4 MB to disk at the default `work_mem`, so `set local work_mem` is the lever if the refresh ever slows.
- **The status judges with the ranking's own rules**: `exploreRules(asOf, formula)` in the social repository builds the candidate, engagement and approver fragments; the refresh builds its `c`, `e` and `ap` CTEs from them, and the status wraps the same three in `exists (with c ..., e ..., ap ... select 1 from ap)`, once as of the request time and once as of the ranking's.
- **The page hands `postViews` post rows directly**: `ExplorePage`'s refinement admits post items only, so the flow gives the view builder `{ postId, sortAt: the ranking's as_of, reposterId: null }` and wraps each view as `{ kind: "post", post }` instead of going through `timelineItems`, which can answer reposts.
- **A cursor when no ranking exists at all answers 409 `explore_refreshed`**: nothing is kept and there is no current generation for it to be above; the reader starts again and gets the empty first page.
- **Turning the switch back on**: a post still in the current ranking is listed again at the next read (the page and the chip filter on the live switch); "at the next refresh" applies to the posts a round left out while the switch was off, whose status answers `pending`.
- **`explorePage` and `exploreStatus` take an optional formula** like the refresh, so a test can reach `below_cutoff` with a list length of 3; the routes use EXPLORE_V1.
- **Validation comes before the signed-out 401**: the `Pagination` query is checked first, so a malformed cursor or limit is 400 for every reader, and only a well-formed cursor from a signed-out reader is 401.
- **Test epochs and fixtures**: 2020 for the ranking, 2021 for the job, 2022 for the reads and 2023 for the HTTP suite; the shared helpers are in `apps/api/test/integration/explore-fixtures.ts`.
- **Test fixtures of an Explore page use `ExplorePage["items"][number]`**, not `TimelineItem`: the contract's refinement narrows the items to posts, and a `TimelineItem` fixture fails the typecheck (TS2322).
- **The 15-minute stale notice is a screen constant** (`STALE_AFTER_MS` in the Explore list), not a number of the formula; the header's minute is read again every minute.
- **Beyond the design's text**: a "Your posts" section on How Explore works, a "More in Explore" link under Popular now, and the status line and Popular now staying hidden when their read fails; Following's empty text names Latest and Explore in plain text, because the list takes its empty text as a string.
- **The app's tests render Home and `PostCard` in Node** by mocking `expo-image` and `react-native-reanimated` in `apps/app/test/explore.test.tsx`; the screens export their parts for the tests (`homeTabs`, `homeTab` and `Tab` from `index.tsx`, `ExploreSwitch` from `privacy.tsx`, `ExploreRules` from `about.tsx`, `ExploreHeader`, `ExploreEmpty` and `ExploreFooter` from `ExploreList.tsx`, `PopularPosts` from `PopularNow.tsx`).
- **The smoke test's Explore step** runs second, signed out: it checks the page's fields by hand, polls up to a minute for `computedAt`, and measures the ranking's age against the answer's `Date` header (under 11 minutes).
- **The review's rejected findings**: four test gaps were refuted by at least two of three lenses because the code already behaves as the design says and the missing test guards only a future rewrite (bookmarks never counting, the status order for a listed post withheld later, a cursor whose post was muted or blocked since, the 30-second statement timeout).
- **`social.explore` answers `ExplorePage & { date, receivedAt }`**: the answer's `Date` header and the device time it arrived, so the list judges the ranking's age on the server's clock; the device clock stands in only when the header is missing.
- **The list's reads live in `exploreReader(fetchPage)`** in `apps/app/src/lib/explore.ts`: its `load(after?)` answers what the list shows, or null while another read runs, and the component only puts the answer on screen; the reader's tests use fake pages.
- **The post screen re-reads on focus** with expo-router's `useFocusEffect`: the status line on every focus, keeping its text while it reads, and the thread's post through `social.getPost` on every focus after the first, without clearing the screen.
- **`useExploreSwitch()` holds the switch's state in `Privacy()`**, which the Blocked and Muted tabs do not remount; `ExploreSwitch` shows the values it is given, and the list keeps `key={tab}`, since without it the old tab's rows would show with the new tab's actions.

Each prompt replaces judgment with rules. Files are complete and copied byte for byte, commands run verbatim, and every expected line must appear. Any mismatch is a **STOP condition** that ends the session with a report instead of an improvised fix. The single permitted self-recovery is a clean `node_modules` reinstall after a `Cannot find module` error in a verification step.

## What can differ between runs

- **Run noise.** Timings and commit hashes differ on every run; every install prints `Packages: -N`, the optional packages pnpm skips on Windows.
- **Durations.** The integration suite runs its files one at a time and takes a few minutes; the web export runs a full Metro bundle and can take a few minutes.
- **The API prints two `ExperimentalWarning`s at start** (SimpleWebAuthn, from 1c, probes Node 24's ML-DSA support at import); they are expected.
- **`http-timing` can fail under heavy load** ("expected 53.39 to be less than 50", a median of 20 requests): it passes on its own and on a rerun of the suite.

## Verified in the dry run only

These checks ran in the scratch clone only, because they need a browser or seed data the development database must not get:

- **A headless Chromium sometimes renders rows appended to a FlatList only at the next scroll** (react-native-web defers new rows to the browser's idle callback): the list's state is right, it happened in Latest's `PagedList` as well as in the Explore list, and a browser walk-through scrolls before it looks for appended posts. Left to sub-project 5's web polish.
- **Metro caches inlined `EXPO_PUBLIC_*` values**: an export built with another `EXPO_PUBLIC_API_URL` (the agent's own browser check used a fake origin) needs `--clear`, and so does the next normal export.

## Before you start

- **Files are written by a script, never typed.** A file block can contain backslash escape sequences, and a writing tool can decode those into the characters they stand for; the 2b dry run's own tooling did exactly that once. These prompts were replayed into the repository by `replay.py` in the scratch tooling, which runs exactly these steps without a model session; a fresh session following them by hand must reach the same commits. Every writing step therefore runs `write_blocks.py`, which copies the step's blocks from the committed prompt file byte for byte, and `verify_prompts.py` checks the result after the last task.
- Every gate in the dry run ran with its standard input closed and a time limit. If a step sits without output for much longer than its allowed difference says, it is stuck, not slow: stop it and report.

## Order

| # | File | What it delivers | Needs Docker? |
|---|---|---|---|
| 1 | `01-ground.md` | The ground for Explore: EXPLORE_V1 and the Explore contracts, explore_refreshed, and migration 0011 with the author's switch, the generations tables and the BRIN indexes on the engagement's time | **yes** |
| 2 | `02-ranking.md` | The Explore ranking and its job: refreshExplore writes a ranking as of the clock's time in one bounded transaction with every number of the formula as a parameter, the skip rule and the retention of two generations; the explore-refresh job runs a round at start and one every five minutes | **yes** |
| 3 | `03-reads.md` | The Explore reads: the page with its own strict cursor, the author-only status judged with the ranking's own rules, the switch's routes, MeProfile.showInExplore and the export's field, and the In Explore chip on the author's own listed posts | **yes** |
| 4 | `04-web-app.md` | The web app's Explore: the Home tab with its address, the Explore list with its header, refresh handling, signed-out footer and empty state, How Explore works from EXPLORE_V1, the Settings > Privacy switch, the author's status line and chip, Popular now in the context column, and the terms sentence | **yes** |
| 5 | `05-review-fixes.md` | What the review of 2c upheld, fixed: a cursor before any ranking, the signed-out prompt, the ranking's age judged when read with a Refresh button, Home's lists keyed by their reader, the post screen reading its status again on focus, the switch's state across the Privacy tabs, the list's reads in a reader object tested directly, and the one-way mute pinned | **yes** |
| 6 | `06-documentation.md` | The README's Explore section and its paragraph under Before going public, 2c recorded in the 2a design and the main design, and the 2c design's dry-run amendments | no |

## Reading a report

Every session ends with a `TASK N REPORT` block. Check three lines before starting the next prompt:

1. `STOP condition hit: none`. If not, the session stopped on purpose. Read the pasted output, fix the environment (Docker not running, a port in use, data services down), and re-run the same prompt from a clean `git status`.
2. Every `Verify` line shows the expected text from the prompt.
3. The `Commit` line ends with the commit subject printed in the prompt.

If a report shows a STOP that is not an environment problem, paste the report back to the planning session. Do not let the executing session improvise.

The design is `docs/superpowers/specs/2026-09-28-explore-2c-design.md`, including its amendments from the dry run. The task map is `docs/superpowers/plans/2026-09-28-explore-2c.md`. Where the plan and a prompt differ, the prompt is the verified version.

## Verify the prompts against the repository

After Task 6, run this from the repo root. It extracts the last version of every file the prompts write and compares it with the file on disk:

```bash
python docs/superpowers/prompts/explore-2c/verify_prompts.py
```

Expected: `prompts reproduce the repository exactly`.

## Execution findings (2026-09-28)

The six prompts were replayed into this repository by the scratch tooling's `replay.py`. It ran each prompt's steps with no model session, through the same gated runner as the dry run. Every red step failed as recorded, every gate passed, and both stack rebuilds, in Tasks 4 and 5, ended with the smoke test passing, its Explore step included.

| Task | Commit |
|---|---|
| 1 | `4e297f5` |
| 2 | `9d970f7` |
| 3 | `67b7490` |
| 4 | `50fb797` |
| 5 | `7f292a0` |
| 6 | `62ac77b` |

- **Identical to the dry run.** Each commit changes the same paths as its dry-run commit, and every one of its 72 files is byte-identical; the rest of the tree matches too. `verify_prompts.py` reproduces all 60 files. The generated migration files carry their final newline in the prompt, so this replay did not show 1b's and 1c's drizzle difference, and the lockfile did not change.
- **Two false starts, both in Task 1's integration gate, neither in the code.** In the first, 70 tests of the auth side failed with 500 answers after `account-deletion.test.ts` took 7 seconds; every failing file then passed on its own, and the whole suite passed at once (38 files, 247 tests) on the same tree. In the second, `http-badge.test.ts` took 783 seconds and three of its tests hit their 5-second limit: the machine had paused, as it once did during the dry run of Task 3. Each time the tree was restored to the plan's commit and the replay started again; the third run kept the machine awake and passed.
- **The review that shaped Task 5.** After Task 4, an adversarial review read the range with four finders (the ranking, the reads, the web app, the tests against the design), and three refuters with different lenses (the code, the tests, whether a user can reach it) judged each finding. Of 12 findings, 8 were upheld, all of low severity, and Task 5 fixes them; the 4 rejected were test gaps that only a future rewrite could turn into a defect.
- **The browser walk-through.** Explore ran in Chromium against the scratch stack on the build of Task 4 (102 checks, the empty state included) and again on the final build of Task 5 (106 checks, adding the status line's round trip to the switch and the new signed-out prompt). Throwaway accounts were signed up through the API and their ages and likes moved back in the scratch database so a ranking could form. It found no defect beyond those the review upheld. It stays in the scratch tooling (`pw-explore.mjs`), because it writes to the database it runs against.
