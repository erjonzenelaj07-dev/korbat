# korbat moderation cases (3c) — execution prompts

One file per task. Each file is a complete, self-contained prompt: paste the whole file into a fresh Claude Code session opened at `C:\Users\Lenovo\Desktop\cool\korbat` and let it run. Do them in order. Every prompt checks that the previous task's commit is the latest one before it starts.

## How these prompts were made reliable

Every task was dry-run end to end on 2026-10-03 to 2026-10-12 in a scratch clone of this repository, one commit per task. For each task a runner wrote the tests, ran them and required the expected failure, and wrote the implementation. It then ran every verification command and required each expected line, refused any changed file outside the task's list, and only then committed. These prompts are generated from those commits and the recorded outputs. Every file block is the committed file, and every "Observed on the dry run" block is real output. The scratch clone used shifted ports and its own compose project; the prompts use this repository's real ports and commands.

The dry run found and settled these points before the prompts were written:

- **A deferred check run early was not queued again (Task 2).** A decision's measures are checked against its audit row's params by a deferred constraint trigger; a `SET CONSTRAINTS ... IMMEDIATE` ran the check early and a measure added afterwards committed unchecked. Migration 0016 records `decision_holds` and adds a second deferred trigger, `decision_actions_recheck`.
- **Lock orders were found by measurement, not by reading.** The purge deadlocked with a notice on a self-quote (Task 3: every post of the account is now locked first, deleted ones too, in id order); an intake that reaches two posts deadlocked with the author's delete of one (Task 11: both now take the posts in id order, and the delete runs once more on a deadlock).
- **Nothing is lost when a step fails halfway (Task 11).** File deletions are requested after the commit with a note written inside it (`delete-owed/`), a mail's result row is locked before the mail is sent, and the R4 redaction erases only what its decision restricted, never a later case's copy (migration 0019).
- **The design's text follows the code where they differ.** The dry run recorded 105 amendments; Task 12 appends them to the design as its section 18.

Each prompt replaces judgment with rules. Files are complete and copied byte for byte, commands run verbatim, and every expected line must appear. Any mismatch is a **STOP condition** that ends the session with a report instead of an improvised fix. The single permitted self-recovery is a clean `node_modules` reinstall after a `Cannot find module` error in a verification step.

## What can differ between runs

- **Run noise.** Timings and commit hashes differ on every run; every install prints `Packages: -N`, the optional packages pnpm skips on Windows.
- **Durations.** The integration suite has about 85 files and runs them one at a time; on a busy machine one run takes 15 to 40 minutes, and Tasks 1 to 6, 9 and 11 run it twice, on a fresh database and on one upgraded from 0013. Tasks 10 and 11 rebuild every image of the stack, which can take ten minutes or more on a cold cache.
- **The integration gate retries.** It runs vitest with `--retry=2 --testTimeout=20000`, because other work on the machine can push unrelated 5-second tests past their limit; a test that fails for a reason of its own fails all three tries. The observed output of Tasks 1 to 3 comes from an earlier form of the gate that ran without the retry and with the timing tests inside the suite, so their test counts are a few higher than a run of the printed command gives.
- **The timing gate tries up to ten times.** 1a's three sign-in timing tests (medians of 20 requests within 50 ms) are left out of the integration gate by name and run alone, up to ten times 45 seconds apart; several tries are normal on a loaded machine. The output printed for Tasks 1 to 3 is the same gate's run during Task 4, since their recorded runs used an earlier form of it.
- **The API prints two `ExperimentalWarning`s at start** (SimpleWebAuthn, from 1c, probes Node 24's ML-DSA support at import); they are expected.

## Verified in the dry run only

These checks ran in the scratch clone only, because they need a browser or seed data the development database must not get:

- **One adversarial review of the built code** (before Task 11): four finders, each through one lens (who can see or do what; the database and concurrency; what people are told; the proofs and the failure paths), ran their probes on the scratch test database and in throwaway tests outside the repository. It found no leak and no access hole; what it upheld is Task 11.
- **A look at the rebuilt stack in a browser** after Task 10: the app's `/report` and `/terms` and the console's sign-in page render under their real headers with no policy error. No form was submitted there; the smoke test sends a report and a notice over HTTP.
- **The contention labs** under `apps/api/test/lab/` measured the lock orders above on PostgreSQL 18; their numbers are in the lab's README.

## Before you start

- **Files are written by a script, never typed.** A file block can contain backslash escape sequences, and a writing tool can decode those into the characters they stand for; the 2b dry run's own tooling did exactly that once. These prompts were replayed into the repository by `replay.py` in the scratch tooling, which runs exactly these steps without a model session; a fresh session following them by hand must reach the same commits. Every writing step therefore runs `write_blocks.py`, which copies the step's blocks from the committed prompt file byte for byte, and `verify_prompts.py` checks the result after the last task.
- Every gate in the dry run ran with its standard input closed and a time limit. If a step sits without output for much longer than its allowed difference says, it is stuck, not slow: stop it and report.

## Order

| # | File | What it delivers | Needs Docker? |
|---|---|---|---|
| 1 | `01-ground.md` | The ground for moderation cases: migration 0014 (the old tables, their enums and profiles.reputation dropped), migration 0015 (the moderation tables with their grants and forced columns, the attach and quote triggers, the view of measures in force, the freeze's predicate, the keep trigger and the guard on image rows, holds), the Drizzle schema, the contracts' constants and digests, image readers that give only visible images, test-db's --fresh and --upgrade-from, and the development cleaner's order | **yes** |
| 2 | `02-decision-engine.md` | The decision engine: migration 0016 (the decision triggers, the one writer of moderation state, the posts' guard, the release of outcomes, the confirmed audit row and the check that holds a decision to it), the lock bounds, the moderation module's skeleton with the intake's transaction and the decision, the two rulebooks and the redress texts, socialForModeration, the step-up actions, the decision route, and the fixture that decides for tests | **yes** |
| 3 | `03-holds-images.md` | Holds and images: MediaForCases (the intake's lock and holds, what a case reaches, the one function that serves staff an image, the disposal of images nothing retains), the deleters in id order, the image readers that follow an image's own state, and the placeholder for hidden and sealed images in the views, the contracts and the app | **yes** |
| 4 | `04-reports-notices.md` | Reports and notices: the notice routes with their links, liveness, limits and human check, the notifier's encrypted contact in the auth module, the mailer's refusals and time limits, the notifier key in the configuration and the compose file, the janitor's two purges, the receipt and the urgent alert | **yes** |
| 5 | `05-console-queue-case.md` | The console's queue, case, evidence and reveals: the staff routes for the overview, the queue, a case with its suspicion, images behind gate V, snapshots, findings, texts and the reveal of a source, the access log and the daily limits; and in the console the router, the home, queue and case screens without the composer, the banners, the reveal dialog and their browser check | **yes** |
| 6 | `06-deciding-dispatch.md` | Deciding in the console, statements and the dispatch: the statement's paragraphs in packages/rules, the decision composer with its preview, the seal's controls and the Lift and Correct controls, what follows a decision's commit, the staff mails and the home screen's lists, and the dispatch job with its receipts, statements, daily release, updates, urgent repeat and queue-age alert | **yes** |
| 7 | `07-the-app.md` | The app: the author's cases and decisions and a reporter's own reports over the API, the post chip, the report form with its three grounds, the notice status page, the cases and decision screens, Your reports, Report on posts, images and profiles, and the contact address in the terms | **yes** |
| 8 | `08-appeals-reexamination.md` | Appeals and re-examination: migration 0017 (appeals, who may review, the review kind of a decision, a seal taken while deciding refused when it would not be in force), the author's appeal, a reporter's re-examination request, the console's appeals screen and review composer, and the app's appeal form and re-examination control | **yes** |
| 9 | `09-evidence-lifecycle.md` | Evidence lifecycle and the command line: migration 0018 (when a case's evidence is due, the one function that erases snapshots, the R4 redaction, the release of holds, the forgetting of who reported, the mark of a deleted account), the retention job, the account's deletion in the moderation module, and the staff command line's new commands | **yes** |
| 10 | `10-export-terms-stack.md` | Export, terms and the stack: the export's moderation member, the terms' moderation sections held to their constants, the smoke test's moderation steps, and the whole stack rebuilt and smoke-tested | **yes** |
| 11 | `11-review-fixes.md` | What the adversarial review of the built code upheld: one lock order for an intake and an author's delete, the purge's and the disposal's file requests after their commits, the R4 redaction keeping an open case's later snapshot, a statement that says no more than korbat found, the deletion's words, the composer's forecast of a closing decision, mails that are never sent twice by a database that cannot write, and the tests that were missing | **yes** |
| 12 | `12-documentation.md` | Documentation: the README's moderation section, its runbook and the records the operator keeps, the lines 3c made false, the main design's amendment, Changed by 3c in five designs, and the dry run's amendments to the 3c design | no |

## Reading a report

Every session ends with a `TASK N REPORT` block. Check three lines before starting the next prompt:

1. `STOP condition hit: none`. If not, the session stopped on purpose. Read the pasted output, fix the environment (Docker not running, a port in use, data services down), and re-run the same prompt from a clean `git status`.
2. Every `Verify` line shows the expected text from the prompt.
3. The `Commit` line ends with the commit subject printed in the prompt.

If a report shows a STOP that is not an environment problem, paste the report back to the planning session. Do not let the executing session improvise.

The design is `docs/superpowers/specs/2026-10-02-moderation-cases-3c-design.md`, including its amendments from the dry run. The task map is `docs/superpowers/plans/2026-10-12-moderation-cases-3c.md`. Where the plan and a prompt differ, the prompt is the verified version.

## Verify the prompts against the repository

After Task 12, run this from the repo root. It extracts the last version of every file the prompts write and compares it with the file on disk:

```bash
python docs/superpowers/prompts/moderation-cases-3c/verify_prompts.py
```

Expected: `prompts reproduce the repository exactly`.
