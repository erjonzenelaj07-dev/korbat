# korbat transparency and automation (3d) — execution prompts

One file per task. Each file is a complete, self-contained prompt: paste the whole file into a fresh Claude Code session opened at `C:\Users\Lenovo\Desktop\cool\korbat` and let it run. Do them in order. Every prompt checks that the previous task's commit is the latest one before it starts.

## How these prompts were made reliable

Every task was dry-run end to end on 2026-10-18 to 2026-10-20 in a scratch clone of this repository, one commit per task. For each task a runner wrote the tests, ran them and required the expected failure, and wrote the implementation. It then ran every verification command and required each expected line, refused any changed file outside the task's list, and only then committed. These prompts are generated from those commits and the recorded outputs. Every file block is the committed file, and every "Observed on the dry run" block is real output. The scratch clone used shifted ports and its own compose project; the prompts use this repository's real ports and commands.

The dry run found and settled these points before the prompts were written:

- **A matched image that stayed public (Task 9).** The review found that two starts of the matcher's step for one image (the late answer, the posting and the sweep can all start it) could mark the match record handled with no case, after which every later try ended as already done: no finding, no seal, no alert. The record is now marked only when no signal names it, the step ends as done only when its own signal is, and the sweep's two reads have batches of their own; both interleavings and a failed retry are tests.
- **A release told before its notice (Task 9).** A release whose notice is held erased its images at once, so the post's sealed placeholders vanished and the author could delete it. While the notice is held the post reads and stays frozen as under the seal.
- **The reader count's salt on disk (Task 9).** The recipients' sketches and the day's salt lived in the Valkey that writes an append-only file, against the public page's promise that the salt is written nowhere. They now live in a Valkey of their own with no persistence (the compose service `counts`), and a month whose store was lost reads "not recorded" instead of a low count.
- **What staff may see and do (Task 9).** Moderators no longer receive an authority's reference and assessment or the leave; the three new admin actions (ending a hold, releasing an upload, releasing a seal) refuse a recused admin; no edition is frozen for a year before korbat's first account; a removal order left out of an edition while held is counted once its hold ends, whatever date the end bears.
- **Restores (Task 9).** release-replay acts in the chain's order and only on lines above the restored head; a refusal made after the backup is held again; Restoring keeps the old media store until the quarantine steps have run and recreates the API and the worker whenever it opens the site, so a test adapter never runs on an open site.
- **The keeper's daily mail (Task 9).** A failed mail is retried within the day and raises an alert after it, and the pages promise an outside keeper only when one is set.
- **A test that depended on the suite's order (found by the dry run's Task 9 runner).** The match file's row-count test, added by Task 9, counted at its start an image row another file had left for the disposal (a post its author deleted keeps its row until then), and the file's own retention round took that row, so the count came short whenever such a file ran first. The file now runs one retention round before it counts; with such a row planted before the file, the old test fails as the runner did and the new one passes.
- **The words (Task 10, migration 0042).** The release notice of a held upload no longer speaks of a post, an appeal and a decision; the urgent alert counts cases and names held uploads apart; an objection stays open during a No report end's delay; a second request for a person gets words of its own; the edition's uploads table prints its total; the export keeps an order decision's members; the composer's preview of a program's finding names korbat's own check, not a user's report.
- **The design's text follows the code where they differ.** The dry run recorded its amendments in the design's section 19.

Each prompt replaces judgment with rules. Files are complete and copied byte for byte, commands run verbatim, and every expected line must appear. Any mismatch is a **STOP condition** that ends the session with a report instead of an improvised fix. The single permitted self-recovery is a clean `node_modules` reinstall after a `Cannot find module` error in a verification step.

## What can differ between runs

- **Run noise.** Timings and commit hashes differ on every run; every install prints `Packages: -N`, the optional packages pnpm skips on Windows.
- **Durations.** The integration suite has about 150 files and runs them one at a time; on a busy machine one run takes 20 to 60 minutes, and Tasks 1, 2, 4, 6, 7, 8, 9 and 10 run it twice, on a fresh database and on one upgraded from 0032, where 3f ended. Tasks 1, 2, 3, 4, 6, 7, 8 and 9 rebuild every image of the stack, which can take ten minutes or more on a cold cache.
- **The integration gate retries.** It runs vitest with `--retry=2 --testTimeout=20000`, because other work on the machine can push unrelated tests past their limit; a test that fails for a reason of its own fails all three tries. The gate's own limit is an hour: on a machine saturated by other work the dry run once ran past it.
- **The timing gate tries up to ten times.** 1a's three sign-in timing tests are left out of the integration gate by name and run alone, up to ten times 45 seconds apart; several tries are normal on a loaded machine.
- **The API prints two `ExperimentalWarning`s at start** (SimpleWebAuthn, from 1c, probes Node 24's ML-DSA support at import); they are expected.
- **Every third-party tool is off by default.** The stack and the smoke test run with the edge, the witness, the classifier and the matcher off; their `test` adapters are refused while the site is open.

## Verified in the dry run only

These checks ran in the scratch clone only, because they need a browser or seed data the development database must not get:

- **One adversarial review of the built code** (after Task 8): five finders, one lens each (who can see or do what; the database and concurrency; what people are told; the proofs and the failure paths; the services, the adapters and recovery), ran their probes on the scratch test database and in throwaway scripts outside the repository. It found three high defects; what it upheld is Tasks 9 and 10, and the points left for the owner are in the tooling's record.
- **The walk-through** (after Task 8) drove the whole path through the rebuilt stack with every `test` adapter on and the site closed: a program's decision on a scored image, the request for a person and a moderator's lift; a near match frozen and alerted; a refused upload, its objection and a "No report" end; a matched post sealed, an admin's seal for good, the files moved to the quarantine, the report and the assessment recorded, the release refused without a leave and taken with one, the files destroyed; an answer without a seal; a restore with the release replayed; the first edition and the day's head. A match of another class could not be driven through the stack (the test matcher's switch has no setting) and is covered by the suite.
- **The labs.** LAB A (the automated decision, Task 6), LAB C (known material, Task 7), LAB E (the edition over 20,000 decisions, Task 4) and the contention lab (Task 6) ran in the scratch stack; their numbers are in the tasks' reports. The witness's proof was checked once with `openssl ts -verify` against a local test authority (Task 5).

## Before you start

- **Files are written by a script, never typed.** A file block can contain backslash escape sequences, and a writing tool can decode those into the characters they stand for; the 2b dry run's own tooling did exactly that once. These prompts were replayed into the repository by `replay.py` in the scratch tooling, which runs exactly these steps without a model session; a fresh session following them by hand must reach the same commits. Every writing step therefore runs `write_blocks.py`, which copies the step's blocks from the committed prompt file byte for byte, and `verify_prompts.py` checks the result after the last task.
- Every gate in the dry run ran with its standard input closed and a time limit. If a step sits without output for much longer than its allowed difference says, it is stuck, not slow: stop it and report.

## Order

| # | File | What it delivers | Needs Docker? |
|---|---|---|---|
| 1 | `01-quarantine.md` | The quarantine: sealed files moved out of the image store and back by a one-shot service with no network and no database, recorded line by line, with their counts, a seal's custody, the lost file's end and its notices. | **yes** |
| 2 | `02-release-and-replay.md` | The release and its replay: a seal for good's images released on a recorded leave or instruction to destroy, by an admin's confirmed action, with the author's notice, the proof of destruction and the replay after a restore. | **yes** |
| 3 | `03-edge-and-test-adapter-guard.md` | The edge, and the guard on test adapters: an outbox row for every image that stops being public, drained to an edge purge adapter that is off by default, the new cache headers, the purge's outcome on the case and on the order's screen, and the API's refusal of a test adapter while the app's site is open. | **yes** |
| 4 | `04-public-figures-and-pages.md` | The public figures and pages: the yearly edition with its banded counts and order section, the recipients' count, the public facts and transparency routes, staff.js recipients and edition, and the app's /rules and /transparency. | **yes** |
| 5 | `05-the-head.md` | The head: head_publications and the audit head's daily value, the witness adapter with off, test and rfc3161, the keeper's mail, GET /api/public/head and the head's section of /transparency, head-restore-mark, and the alerts head_unwitnessed and head_missed. | **yes** |
| 6 | `06-the-automated-decision.md` | The automated decision and the R1 seam: a decision without a decider under R1, automated_signals and automated_objections, the step and its sweep, the caps and limits by rule, Ask for a person, redress version 4, the worker's test scorer and result version 2, automation-status, and audit-verify's, text-verify's and restore-import's handling of automated_decided. | **yes** |
| 7 | `07-known-material.md` | Known material: the comparison of uploads with lists that outside bodies keep, through the off and test matchers; an acting match refuses an upload and holds it for an admin's Report or No report, or seals a posted image's post through the automated step under R2's cap; every other match a finding citing R2 or a flag; Held uploads, the refused upload's notice and objection, the release of a held upload and its replay after a restore. | **yes** |
| 8 | `08-flag-texts-record.md` | The flag, the texts and the record: the flag 'possible coordinated reporting' on the queue and the case, the erasure of the automated tools' records and the forgetting of what a tool that is off stored, rulebook version 4, the terms' sections, the export's members, the README whole and the designs' dated amendments. | **yes** |
| 9 | `09-review-fixes-services.md` | Task 9 of 3d: the first half of the fixes the one adversarial review of the built code upheld, in the database, access and the services. | **yes** |
| 10 | `10-review-fixes-words.md` | Task 10 of 3d: the second half of the fixes the one adversarial review of the built code upheld, in the words and the proofs. | **yes** |

## Reading a report

Every session ends with a `TASK N REPORT` block. Check three lines before starting the next prompt:

1. `STOP condition hit: none`. If not, the session stopped on purpose. Read the pasted output, fix the environment (Docker not running, a port in use, data services down), and re-run the same prompt from a clean `git status`.
2. Every `Verify` line shows the expected text from the prompt.
3. The `Commit` line ends with the commit subject printed in the prompt.

If a report shows a STOP that is not an environment problem, paste the report back to the planning session. Do not let the executing session improvise.

The design is `docs/superpowers/specs/2026-10-09-transparency-automation-3d-design.md`, including its amendments from the dry run. The task map is `docs/superpowers/plans/2026-10-18-transparency-automation-3d.md`. Where the plan and a prompt differ, the prompt is the verified version.

## Verify the prompts against the repository

After Task 10, run this from the repo root. It extracts the last version of every file the prompts write and compares it with the file on disk:

```bash
python docs/superpowers/prompts/transparency-automation-3d/verify_prompts.py
```

Expected: `prompts reproduce the repository exactly`.

## Execution findings (2026-10-20)

The ten prompts were replayed into this repository by the scratch tooling. Tasks 1 to 5 went through the same gated runner as the dry run: every red step failed as recorded and every gate passed, the stack rebuilds smoke-tested. Task 6's full replay then stopped on a test of 3f (`orders-hold-end`, the eight time zones) that ran past its own two-minute limit three times on a loaded machine. At that point the owner chose a faster path for Tasks 6 to 10: each task's files were written from its prompt by `write_blocks.py` and committed with the dry run's message, with the stray-file check and no gate, and the gates of Task 10 (on a database upgraded from 0032) and the stack's rebuild and smoke test ran once at the end.

| Task | Commit | Checked |
|---|---|---|
| 1 | `f9e8c1e` | every gate |
| 2 | `f6d85e3` | every gate |
| 3 | `ecc2cfd` | every gate |
| 4 | `586d742` | every gate |
| 5 | `1283612` | every gate |
| 6 | `d9ff85d` | written and committed; gates once at the end |
| 7 | `247025c` | written and committed; gates once at the end |
| 8 | `dcecf21` | written and committed; gates once at the end |
| 9 | `9d446f6` | written and committed; gates once at the end |
| 10 | `8668bb6` | written and committed; gates once at the end |

- **Identical to the dry run.** Each commit changes the same paths as its dry-run commit, and after every task the tree is byte-identical to the dry run's except drizzle's snapshots of 0033 to 0042 and its journal, which end with a newline here and with none in the dry run. `verify_prompts.py` reproduces all 319 files.
- **The gates at the end.** The type check, the unit suites, `generate`, the migrations applied, the console's build and browser check, the web export, the integration suite on a database upgraded from 0032 with no test failed (the dry run's same suite counted 1,767 passed and 3 skipped in 150 files; the run at the end kept only the tail of its output), the timing gate, the API bundles, then the stack rebuilt with the service `counts` and the smoke test through Caddy.
- **What the machine needed.** Another program listened on port 8080 on every interface, so the run set `NODE_OPTIONS=--dns-result-order=ipv4first` (as 3f's replay did). Windows had reserved the ports 58022 to 58121, where Mailpit's web port 58025 lies, so for the run the development Mailpit was published on 58225 (`DEV_MAILPIT_PORT` in the ignored `infra/.env` and `MAILPIT_URL` in the API's ignored env files) and put back afterwards. If `up` fails with "ports are not available" on 58025, check `netsh interface ipv4 show excludedportrange protocol=tcp`.
- **The review that shaped Tasks 9 and 10.** After Task 8, five finders read the built code, one lens each, and one agent walked the whole path through the rebuilt stack. They found three high defects: two starts of the matcher's step for one image could lose the finding and leave the image public; a release whose notice is held showed on the post at once; and the reader count's salt and raw identifiers were written to disk by Valkey's append-only file. The fixes, and the medium and low points upheld, are Tasks 9 and 10. The points left for the owner are in the tooling's record: the classifier's digest, PDQ and a real source's adapter, and the witness token not checked against the value.
