# korbat authorities' orders (3f) — execution prompts

One file per task. Each file is a complete, self-contained prompt: paste the whole file into a fresh Claude Code session opened at `C:\Users\Lenovo\Desktop\cool\korbat` and let it run. Do them in order. Every prompt checks that the previous task's commit is the latest one before it starts.

## How these prompts were made reliable

Every task was dry-run end to end on 2026-10-13 to 2026-10-18 in a scratch clone of this repository, one commit per task. For each task a runner wrote the tests, ran them and required the expected failure, and wrote the implementation. It then ran every verification command and required each expected line, refused any changed file outside the task's list, and only then committed. These prompts are generated from those commits and the recorded outputs. Every file block is the committed file, and every "Observed on the dry run" block is real output. The scratch clone used shifted ports and its own compose project; the prompts use this repository's real ports and commands.

The dry run found and settled these points before the prompts were written:

- **What an author must not learn while a notice is held (Tasks 8 and 9).** The review found four paths that told the author during a hold: the data export kept the images of a disabled post; a decision held with the notice still counted in the standing and could be the basis of a suspension the author was told of at once; a seal taken during a hold showed in the deletion mail; a second order on the same post was told at once. Each is now held or left out until the release, and each has its test.
- **A hold and a preservation survive a correction back and forth (Task 8).** Setting "must not be told" again after an admin unset it holds again, and a removal order corrected to another kind and back is preserved again.
- **The alert channel tells the truth under load (Task 8).** A burst past ntfy's visitor limit no longer reads as a channel that is down, the watcher is exempt from that limit, the time-driven alerts no longer wait behind a slow mail relay, and the two alert kinds that were pushed but never mailed are mailed.
- **The restore closes the app's site for real (Task 8).** Setting `APP_SITE=closed` takes effect only when Caddy is recreated; the runbook now says so at every step that sets it, with a check from outside, and the docs test holds it.
- **A test that depended on the suite's order (found by the replay).** The first replay into the real repository failed two checks of the alert channel in `alerts-steps.test.ts`: they judged rows other test files had left owed, so they failed whenever the suite reached them between 3 and 60 minutes after those rows were written, which depends on the order vitest runs the files in. Task 1's test now marks every row still owed as pushed before those two checks, and the dry run's commits were rebuilt with that change; with a row owed 10 minutes the old test fails as the replay did and the new one passes.
- **The design's text follows the code where they differ.** The dry run recorded its amendments in the design's section 19.

Each prompt replaces judgment with rules. Files are complete and copied byte for byte, commands run verbatim, and every expected line must appear. Any mismatch is a **STOP condition** that ends the session with a report instead of an improvised fix. The single permitted self-recovery is a clean `node_modules` reinstall after a `Cannot find module` error in a verification step.

## What can differ between runs

- **Run noise.** Timings and commit hashes differ on every run; every install prints `Packages: -N`, the optional packages pnpm skips on Windows.
- **Durations.** The integration suite has about 130 files and runs them one at a time; on a busy machine one run takes 15 to 40 minutes, and Tasks 1, 3, 5, 7, 8 and 9 run it twice, on a fresh database and on one upgraded from 0025, where 3e ended. Tasks 1, 4, 7 and 8 rebuild every image of the stack, which can take ten minutes or more on a cold cache.
- **The integration gate retries.** It runs vitest with `--retry=2 --testTimeout=20000`, because other work on the machine can push unrelated 5-second tests past their limit; a test that fails for a reason of its own fails all three tries.
- **The timing gate tries up to ten times.** 1a's three sign-in timing tests are left out of the integration gate by name and run alone, up to ten times 45 seconds apart; several tries are normal on a loaded machine.
- **The API prints two `ExperimentalWarning`s at start** (SimpleWebAuthn, from 1c, probes Node 24's ML-DSA support at import); they are expected.
- **Task 1's first four steps prepare an existing database** (the role `korbat_notify` and its USAGE on `public`, and the env files); on a database that already has them they change nothing.

## Verified in the dry run only

These checks ran in the scratch clone only, because they need a browser or seed data the development database must not get:

- **One adversarial review of the built code** (after Task 7): five finders, one lens each (who can see or do what; the database and concurrency; what people are told; the proofs and the failure paths; the channel, the services and recovery), ran their probes on the scratch test database and in throwaway tests outside the repository. It found four high defects; what it upheld is Tasks 8 and 9, and the points left for the owner are in the tooling's record.
- **The labs.** ntfy behind Caddy's push site (L2, L3, L5 in Task 1; L1, an hour with three idle sockets and a burst of 1,000 publishes; L4, one socket held 12 hours, then ntfy and Caddy restarted with no message lost), the orders lab on PostgreSQL 18.6 (Tasks 3 and 7) and the contention lab (Tasks 4, 7 and 8) ran in the scratch stack; their numbers are in the tasks' reports.
- **The walk-through** (Task 7) drove the whole path on a phone-sized window with a virtual authenticator through the rebuilt stack: a message in the mailbox, the push, an order opened, corrected, given effect with one key prompt, the check from outside, the notice, the reasons, a reinstatement, an order opened with the watcher stopped, and a restore with one lost disabling taken again. A ring on a real phone (the owner's checks P1 to P8 and M) is not part of it.

## Before you start

- **Files are written by a script, never typed.** A file block can contain backslash escape sequences, and a writing tool can decode those into the characters they stand for; the 2b dry run's own tooling did exactly that once. These prompts were replayed into the repository by `replay.py` in the scratch tooling, which runs exactly these steps without a model session; a fresh session following them by hand must reach the same commits. Every writing step therefore runs `write_blocks.py`, which copies the step's blocks from the committed prompt file byte for byte, and `verify_prompts.py` checks the result after the last task.
- Every gate in the dry run ran with its standard input closed and a time limit. If a step sits without output for much longer than its allowed difference says, it is stuck, not slow: stop it and report.

## Order

| # | File | What it delivers | Needs Docker? |
|---|---|---|---|
| 1 | `01-watcher-and-alert-channel.md` | The watcher and the alert channel | **yes** |
| 2 | `02-order-records-and-clock.md` | Order records and the clock | **yes** |
| 3 | `03-giving-effect-to-orders.md` | Giving effect to an order | **yes** |
| 4 | `04-preservation-retention-page-status.md` | Preservation, retention and the page status | **yes** |
| 5 | `05-records-to-authorities.md` | Records to authorities | **yes** |
| 6 | `06-recovery.md` | Recovery | **yes** |
| 7 | `07-counts-terms-record.md` | Counts, terms and the record | **yes** |
| 8 | `08-review-fixes-services.md` | The first half of the review's fixes: the database, access, the alert channel and the services, with migration 0032_orders_review. | **yes** |
| 9 | `09-review-fixes-words.md` | What the review of 3f as built upheld in the words and the proofs: a statement's appeal counted from the telling, the staff mails with phone alerts off, the yearly counts after an erasure, the notice's and the terms' words, the day the author was told on Cases, and the tests that prove the checks nothing tested. | **yes** |

## Reading a report

Every session ends with a `TASK N REPORT` block. Check three lines before starting the next prompt:

1. `STOP condition hit: none`. If not, the session stopped on purpose. Read the pasted output, fix the environment (Docker not running, a port in use, data services down), and re-run the same prompt from a clean `git status`.
2. Every `Verify` line shows the expected text from the prompt.
3. The `Commit` line ends with the commit subject printed in the prompt.

If a report shows a STOP that is not an environment problem, paste the report back to the planning session. Do not let the executing session improvise.

The design is `docs/superpowers/specs/2026-10-09-authorities-orders-3f-design.md`, including its amendments from the dry run. The task map is `docs/superpowers/plans/2026-10-18-authorities-orders-3f.md`. Where the plan and a prompt differ, the prompt is the verified version.

## Verify the prompts against the repository

After Task 9, run this from the repo root. It extracts the last version of every file the prompts write and compares it with the file on disk:

```bash
python docs/superpowers/prompts/authorities-orders-3f/verify_prompts.py
```

Expected: `prompts reproduce the repository exactly`.
