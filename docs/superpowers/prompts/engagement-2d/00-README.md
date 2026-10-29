# korbat engagement (2d) — execution prompts

One file per task. Each file is a complete, self-contained prompt: paste the whole file into a fresh Claude Code session opened at `C:\Users\Lenovo\Desktop\cool\korbat` and let it run. Do them in order. Every prompt checks that the previous task's commit is the latest one before it starts.

## How these prompts were made reliable

Every task was dry-run end to end on 2026-10-28 to 2026-10-29 in a scratch clone of this repository, one commit per task. For each task a runner wrote the tests, ran them and required the expected failure, and wrote the implementation. It then ran every verification command and required each expected line, refused any changed file outside the task's list, and only then committed. These prompts are generated from those commits and the recorded outputs. Every file block is the committed file, and every "Observed on the dry run" block is real output. The scratch clone used shifted ports and its own compose project; the prompts use this repository's real ports and commands.

The dry run found and settled these points before the prompts were written:

- **A switch too small to reach (Task 5).** The composer's Hide counts switch was a 40 by 20 px target, under the 44 px the app's controls keep; the app's browser check found it at steps 28 and 31. It is a kit switch row now, the whole row the target.
- **A focus lost after Load more (Task 5).** The Activity screen moved the focus to the first entry Load more brought once, on a zero-delay timer. On a loaded machine the list had not drawn that row yet, the removed Load more row had held the focus, and the list gave it to the screen's title; nothing scrolled the list to the new rows, so waiting alone could not help. The gated runner's second try found it at step 52. `retryFocus` in `lib/activity.ts` now tries every 50 ms for at most 5 s, cancelled by the pill, a refresh, another Load more or the list's unmount, and `ListHandle.jumpTo` draws the row; a fake-timer unit test holds the tries, the limit and the cancel. Step 52 passes with Chromium's CPU slowed four and five times.
- **The design's text follows the code where they differ.** The dry run recorded its amendments in the design's section 15.

Each prompt replaces judgment with rules. Files are complete and copied byte for byte, commands run verbatim, and every expected line must appear. Any mismatch is a **STOP condition** that ends the session with a report instead of an improvised fix. The single permitted self-recovery is a clean `node_modules` reinstall after a `Cannot find module` error in a verification step.

## What can differ between runs

- **Run noise.** Timings and commit hashes differ on every run; every install prints `Packages: -N`, the optional packages pnpm skips on Windows, and may remove hoisted packages the lockfile no longer holds.
- **Durations.** Tasks 2, 3, 4, 6 and 7 end a batch and run the whole integration suite twice, on a fresh database and on one upgraded from 0048, the longest gates of the run; Tasks 3 and 6 rebuild every image of the stack and run the smoke test through Caddy. The app's browser check (57 steps) takes 15 to 30 minutes on a loaded machine.
- **The gates' limits.** The unit gate runs vitest with `--testTimeout=60000`, because tests ran past their 5 s inside the workspace's parallel run while other work loaded the machine; the integration gate runs with `--retry=2 --testTimeout=20000`, for the same reason. A test that fails for a reason of its own fails all three tries. A machine that sleeps during the run fails a test whose timings span the sleep: run that file again alone. On a heavily loaded machine the whole suite can pass the gate's hour; run it in two halves with `--shard=1/2` and `--shard=2/2`.
- **The smoke test creates one import per run,** and an address may start five a day (`IMPORT_RULES`): a sixth run within 24 hours fails at its import step with `rate_limited`. Wait out the window; never clear a live stack's limit to pass a test.
- **The card lab and the smoke test's card step ask only the local stack.** Every crawler request is sent to the machine's own Caddy with a crawler's User-Agent from `infra/caddy/lab/crawlers.json`; no real site is fetched.
- **The browser checks drive a Chromium build already on the machine** (playwright-core 1.63's, or `KORBAT_BROWSER_CHANNEL`); they never download a browser.

## Verified in the dry run only

These checks ran in the scratch clone only, because they need a browser or seed data the development database must not get:

- **The design's review** (before Task 1): two reviewers, one for build fit and one for people and values, raised 53 findings (6 high), applied to the design before it was committed; the rulings made link previews off by default, robots.txt name only the link-preview fetchers, mentions link only while the account keeps the handle, refused a reset picture's file for 30 days, and split one task, giving seven.
- **The card lab's first measure** (Task 6): before the lab existed, a throwaway image built from the pinned Caddy showed that `templates` runs only where the Caddyfile places it and prints `{{ .Env }}` as text; the image was removed. The lab then passed its 57 checks on the stack's own Caddy image.
- **The focus defect measured slowed** (Task 5): step 52 was run with Chromium's CPU slowed four and five times, where the single try and a retry without the scroll both failed.
- **Stops of the run.** The owner paused the run during Task 3 and the laptop rebooted before it resumed; an implementer stalled overnight in Task 5. Each was started again from the tree, which was intact.
- **A task file's browser count** (Task 4): the runner failed on its expected line only, `Tests  1 passed (1)` against the console's 79 tests; the count is the number of tests, and the task file was corrected.

## Before you start

- **Files are written by a script, never typed.** A file block can contain backslash escape sequences, and a writing tool can decode those into the characters they stand for; the 2b dry run's own tooling did exactly that once. These prompts were replayed into the repository by `replay.py` in the scratch tooling, which runs exactly these steps without a model session; a fresh session following them by hand must reach the same commits. Every writing step therefore runs `write_blocks.py`, which copies the step's blocks from the committed prompt file byte for byte, and `verify_prompts.py` checks the result after the last task.
- Every gate in the dry run ran with its standard input closed and a time limit. If a step sits without output for much longer than its allowed difference says, it is stuck, not slow: stop it and report.

## Order

| # | File | What it delivers | Needs Docker? |
|---|---|---|---|
| 1 | `01-activity-mentions-schema.md` | Contracts and the database for Activity and mentions: the contract modules activity.ts and mentions.ts, and the migrations 0049_activity and 0050_post_options. | **yes** |
| 2 | `02-activity-mentions-api.md` | Mentions and Activity in the API: mentions stored and read, Activity entries written in the act's transaction under the recipient's rules and read with the moderation entries, the hide-counts and link-preview switches, and the export's and purge's parts for them. | **yes** |
| 3 | `03-avatar-images.md` | Avatar images: an upload of kind avatar made square by the worker, set and removed by its owner under 3e's predicate, served publicly while it is a live profile's visible picture, carried by every author, profile and /api/me, and known to the sweeper, the export and the purge. | **yes** |
| 4 | `04-avatar-moderation.md` | Moderation of avatars: the measure reset_avatar and its reversal restore_avatar on an account case, an account's report holding its picture, an account case's seal reaching its avatars through 3d's quarantine and release, 3d's checks of a picture opening a finding and never a measure with R1's hold for review, and every list of the measures naming the new kind. | **yes** |
| 5 | `05-engagement-app.md` | The app's side of engagement: the nav's Activity item and the Activity screen with its tabs, headings, pill and seen marker, stored mentions as links and the composer's mentions line, avatars drawn everywhere and the picker on Settings, Profile, hide counts in the composer and the More menu, the Getting started panel on an empty Following, Settings, Activity and Privacy's Link previews, and the browser check's steps 52 to 57. | no |
| 6 | `06-share-cards-indexing-terms.md` | Share cards, indexing and the terms: the API's card routes and head block, Caddy's /post/* and /u/* serving card.html through templates, robots.txt and X-Robots-Tag, the card lab, and the privacy text's four drafts. | **yes** |
| 7 | `07-engagement-record.md` | The record of engagement: the README's Activity, Share cards and search engines, Profile pictures, budget, upgrade notes and counsel's six questions, the lines 2d made false corrected, the main design's row 2d and dated section 9 entry, and the UI design's 2d line marked delivered. | **yes** |

## Reading a report

Every session ends with a `TASK N REPORT` block. Check three lines before starting the next prompt:

1. `STOP condition hit: none`. If not, the session stopped on purpose. Read the pasted output, fix the environment (Docker not running, a port in use, data services down), and re-run the same prompt from a clean `git status`.
2. Every `Verify` line shows the expected text from the prompt.
3. The `Commit` line ends with the commit subject printed in the prompt.

If a report shows a STOP that is not an environment problem, paste the report back to the planning session. Do not let the executing session improvise.

The design is `docs/superpowers/specs/2026-10-22-engagement-2d-design.md`, including its amendments from the dry run. The task map is `docs/superpowers/plans/2026-10-29-engagement-2d.md`. Where the plan and a prompt differ, the prompt is the verified version.

## Verify the prompts against the repository

After Task 7, run this from the repo root. It extracts the last version of every file the prompts write and compares it with the file on disk:

```bash
python docs/superpowers/prompts/engagement-2d/verify_prompts.py
```

Expected: `prompts reproduce the repository exactly`.
