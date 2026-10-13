# korbat account sanctions (3e) — execution prompts

One file per task. Each file is a complete, self-contained prompt: paste the whole file into a fresh Claude Code session opened at `C:\Users\Lenovo\Desktop\cool\korbat` and let it run. Do them in order. Every prompt checks that the previous task's commit is the latest one before it starts.

## How these prompts were made reliable

Every task was dry-run end to end on 2026-10-12 and 2026-10-13 in a scratch clone of this repository, one commit per task. For each task a runner wrote the tests, ran them and required the expected failure, and wrote the implementation. It then ran every verification command and required each expected line, refused any changed file outside the task's list, and only then committed. These prompts are generated from those commits and the recorded outputs. Every file block is the committed file, and every "Observed on the dry run" block is real output. The scratch clone used shifted ports and its own compose project; the prompts use this repository's real ports and commands.

The dry run found and settled these points before the prompts were written:

- **A write could be judged before it waited (Tasks 4 and 8).** Task 4's lab found that a write judged against a suspension's start, then made to wait behind a lock, could commit after the start; the review found the same on eight write paths, also behind locks on other rows. Every write a suspension refuses now ends with one closing judgment of the acting account, after every lock and insert (`closingJudgment`), and the lab asserts it for every refused route.
- **Waits are bounded and no lock is held across a mail (Task 8).** A starved row lock now ends at its bound (`statement_timeout` beside `lock_timeout`), and the statements and the take-down's mail no longer hold the subject's row while the relay answers.
- **Marks count only once the reporter can see them (Task 8).** A report marked manifestly unfounded counts toward a warning or a restriction, and appears in the export, only after its outcome is released; reports sent before 0022 are back-filled into the tallies.
- **The design's text follows the code where they differ.** The dry run recorded 104 amendments, in the design's section 19.

Each prompt replaces judgment with rules. Files are complete and copied byte for byte, commands run verbatim, and every expected line must appear. Any mismatch is a **STOP condition** that ends the session with a report instead of an improvised fix. The single permitted self-recovery is a clean `node_modules` reinstall after a `Cannot find module` error in a verification step.

## What can differ between runs

- **Run noise.** Timings and commit hashes differ on every run; every install prints `Packages: -N`, the optional packages pnpm skips on Windows.
- **Durations.** The integration suite has about 100 files and runs them one at a time; on a busy machine one run takes 15 to 40 minutes, and Tasks 1, 3, 7 and 8 run it twice, on a fresh database and on one upgraded from 0019, where 3c ended. Tasks 7 and 8 rebuild every image of the stack, which can take ten minutes or more on a cold cache.
- **The integration gate retries.** It runs vitest with `--retry=2 --testTimeout=20000`, because other work on the machine can push unrelated 5-second tests past their limit; a test that fails for a reason of its own fails all three tries.
- **The timing gate tries up to ten times.** 1a's three sign-in timing tests are left out of the integration gate by name and run alone, up to ten times 45 seconds apart; several tries are normal on a loaded machine.
- **The API prints two `ExperimentalWarning`s at start** (SimpleWebAuthn, from 1c, probes Node 24's ML-DSA support at import); they are expected.

## Verified in the dry run only

These checks ran in the scratch clone only, because they need a browser or seed data the development database must not get:

- **One adversarial review of the built code** (before Task 8): four finders, one lens each (who can see or do what; the database and concurrency; what people are told; the proofs and the failure paths), ran their probes on the scratch test database and in throwaway tests outside the repository. It found no high defect; what it upheld is Task 8, and one point is left for the owner (a steady stream of others' likes can still starve the row lock a suspension takes; the bound now ends the wait).
- **The labs** under `apps/api/test/lab/standing.lab.ts` measured retirements racing handle changes, suspensions against writes in flight, the closing judgment and Explore's round times on the scratch test database; their numbers are in the tasks' reports.

## Before you start

- **Files are written by a script, never typed.** A file block can contain backslash escape sequences, and a writing tool can decode those into the characters they stand for; the 2b dry run's own tooling did exactly that once. These prompts were replayed into the repository by `replay.py` in the scratch tooling, which runs exactly these steps without a model session; a fresh session following them by hand must reach the same commits. Every writing step therefore runs `write_blocks.py`, which copies the step's blocks from the committed prompt file byte for byte, and `verify_prompts.py` checks the result after the last task.
- Every gate in the dry run ran with its standard input closed and a time limit. If a step sits without output for much longer than its allowed difference says, it is stuck, not slow: stop it and report.

## Order

| # | File | What it delivers | Needs Docker? |
|---|---|---|---|
| 1 | `01-standing-ledger-and-strikes.md` | The standing ledger and strikes | **yes** |
| 2 | `02-handle-retirement.md` | Handle retirement | **yes** |
| 3 | `03-enforcement-at-once.md` | Enforcement, and suspensions at once | **yes** |
| 4 | `04-announced-replies-termination.md` | Announced suspensions, replies and termination | **yes** |
| 5 | `05-restriction-of-reporting.md` | The restriction of reporting | **yes** |
| 6 | `06-explore-version-2.md` | Explore version 2: the migration explore_resume (moderation_apply and posts_guard replaced), EXPLORE_V2 in place of EXPLORE_V1, the round's three fragments with the predicate and explore_from, the skip rule, explorePage and listedInExplore, the status suspended, and the app's texts and change log. | **yes** |
| 7 | `07-retention-export-terms-records.md` | Retention, export, terms and records: the migration standing_retention and the retention job's two steps, RETENTION's three members, the export's standing, replies and reporting, the terms' four sections and changed sentences, the smoke test's two steps, the README's runbook and the dated amendments of section 15 and of the dry run. | **yes** |
| 8 | `08-review-fixes.md` | What the one adversarial review of account sanctions as built upheld, fixed: the closing judgment of every refused write, the bound of a starved lock, no profile held across a mail, the stale notice, released marks only, and the texts, rows and tests the review named. | **yes** |

## Reading a report

Every session ends with a `TASK N REPORT` block. Check three lines before starting the next prompt:

1. `STOP condition hit: none`. If not, the session stopped on purpose. Read the pasted output, fix the environment (Docker not running, a port in use, data services down), and re-run the same prompt from a clean `git status`.
2. Every `Verify` line shows the expected text from the prompt.
3. The `Commit` line ends with the commit subject printed in the prompt.

If a report shows a STOP that is not an environment problem, paste the report back to the planning session. Do not let the executing session improvise.

The design is `docs/superpowers/specs/2026-10-09-account-sanctions-3e-design.md`, including its amendments from the dry run. The task map is `docs/superpowers/plans/2026-10-13-account-sanctions-3e.md`. Where the plan and a prompt differ, the prompt is the verified version.

## Verify the prompts against the repository

After Task 8, run this from the repo root. It extracts the last version of every file the prompts write and compares it with the file on disk:

```bash
python docs/superpowers/prompts/account-sanctions-3e/verify_prompts.py
```

Expected: `prompts reproduce the repository exactly`.

## Execution findings (2026-10-13)

The eight prompts were replayed into this repository by the scratch tooling's `replay.py`, with no model session, through the same gated runner as the dry run. It ran in one attempt with no stop: every red step failed as recorded, every gate passed, and both stack rebuilds, in Tasks 7 and 8, ended with the smoke test passing through Caddy on the app's site and the console's.

| Task | Commit |
|---|---|
| 1 | `4df1a51` |
| 2 | `fc6fb64` |
| 3 | `0d6a86c` |
| 4 | `622ff48` |
| 5 | `ab2595e` |
| 6 | `d9233f4` |
| 7 | `774a1cf` |
| 8 | `39541f8` |

- **Identical to the dry run.** Each commit changes the same paths as its dry-run commit, and after every task the tree is byte-identical to the dry run's except drizzle's snapshots of 0020 to 0025 and its journal, which end with a newline here and with none in the dry run (drizzle writes none and the prompts' file blocks end every file with one; drizzle orders migrations by the journal's entries, so the newline changes nothing it does). `verify_prompts.py` reproduces all 244 files. The integration suite ends at 1,308 tests on a database upgraded from 0019 (100 files) and 1,302 on a fresh one (99 files: the back-fill test of 0025 runs only on an upgraded database); the timing gate passed.
- **The review that shaped Task 8.** After Task 7, one adversarial review read the built code through four lenses (who can see or do what; the database and concurrency; what people are told; the proofs and the failure paths), each with runs on the scratch test database. It found no high defect. It upheld 21 points: above all a write could be judged against a suspension's start and then wait behind a lock and commit after the start, on eight write paths (Task 4's lab had found one case); waits that a stream of likes could stretch past their bound; locks held across a mail; marks that counted before the reporter could see them. One point is left for the owner: a steady stream of others' likes can still starve the row lock a suspension takes; the bound now ends the wait instead of hanging.
