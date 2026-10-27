# korbat import from other platforms (3b) — execution prompts

One file per task. Each file is a complete, self-contained prompt: paste the whole file into a fresh Claude Code session opened at `C:\Users\Lenovo\Desktop\cool\korbat` and let it run. Do them in order. Every prompt checks that the previous task's commit is the latest one before it starts.

## How these prompts were made reliable

Every task was dry-run end to end on 2026-10-22 to 2026-10-27 in a scratch clone of this repository, one commit per task. For each task a runner wrote the tests, ran them and required the expected failure, and wrote the implementation. It then ran every verification command and required each expected line, refused any changed file outside the task's list, and only then committed. These prompts are generated from those commits and the recorded outputs. Every file block is the committed file, and every "Observed on the dry run" block is real output. The scratch clone used shifted ports and its own compose project; the prompts use this repository's real ports and commands.

The dry run found and settled these points before the prompts were written:

- **An index the foreign key needed (Task 2).** `post_media.import_job_id` is set to null when its import is deleted, and Task 5 reads a job's images by it; without an index both scan the whole table. Task 2 adds `post_media_import_job_idx`, and the schema test's index pin moves with it.
- **A heap held by string slices (Task 3).** The importer's tokenizer kept each string as a slice of its 64 KB chunk, so the 50,000 source ids a scan keeps held about 450 MB alive: the large X scan ran out of heap in the 512 MiB container (633 MB above baseline on the host). `detach()` now copies every string the scan keeps, and the same scan peaks at 61 MB.
- **A slow CAR read (Task 3).** The 2,000,000-block CAR took 17.9 minutes at half a CPU; blocks are now read synchronously from the descriptor and scratch writes go out a megabyte at a time, and it takes 5.2.
- **A pin on the export's last member (Task 6).** `moderation-export.test.ts` held `moderation` as the export's last member; Task 6 adds `imports` after it, and the pin now reads the last two members, as `export.test.ts` does. The runner's first try found it in the whole integration suite; the task's own files had passed alone. The smoke test's step 14 held the same, and Task 8's first smoke run found it: the step now reads `moderation`, then `imports`.
- **An upload that counted a byte it had not sent (Task 7).** Before the first chunk the progress bar's value read `1 KB of 20 MB`; zero now prints `0 KB`, with a unit test.
- **A disabled Publish that left the tab order (Task 7).** react-native-web turns any disabled state of a button into the native `disabled` attribute, which takes the button out of the tab order; Publish writes `aria-disabled` on the element itself, with tabIndex 0, so a keyboard still reaches it.
- **The design's text follows the code where they differ.** The dry run recorded its amendments in the design's section 15.

Each prompt replaces judgment with rules. Files are complete and copied byte for byte, commands run verbatim, and every expected line must appear. Any mismatch is a **STOP condition** that ends the session with a report instead of an improvised fix. The single permitted self-recovery is a clean `node_modules` reinstall after a `Cannot find module` error in a verification step.

## What can differ between runs

- **Run noise.** Timings and commit hashes differ on every run; every install prints `Packages: -N`, the optional packages pnpm skips on Windows, and may remove hoisted packages the lockfile no longer holds.
- **Durations.** Tasks 2, 4, 6, 7 and 8 end a batch and run the whole integration suite twice, on a fresh database and on one upgraded from 0042, the longest gates of the run; Tasks 4 and 8 rebuild every image of the stack, the importer's included, and run the smoke test through Caddy. The importer's labs run in a 512 MiB container at half a CPU and take minutes.
- **The gates' limits.** The unit gate runs vitest with `--testTimeout=60000` for 3b, because a test ran past 20 s inside the workspace's parallel run; the integration gate runs with `--retry=2 --testTimeout=20000`, because other work on the machine can push unrelated tests past their limit. A test that fails for a reason of its own fails all three tries. A machine that sleeps during the run fails a test whose timings span the sleep: run that file again alone. On a heavily loaded machine the whole suite can pass the gate's hour; run it in two halves with `--shard=1/2` and `--shard=2/2` (Task 7 did, 870 and 988 tests).
- **Chromium sends a PUT again by itself** on a reused connection; the app's browser check therefore drops every try at the lost offset until the app reads the import, and counts the dropped tries once.
- **Test archives are built by code.** Every X, Mastodon and Bluesky archive the tests and labs read is written by the tests themselves; no real person's archive is downloaded or opened.
- **The browser checks drive a Chromium build already on the machine** (playwright-core 1.63's, or `KORBAT_BROWSER_CHANNEL`); they never download a browser.

## Verified in the dry run only

These checks ran in the scratch clone only, because they need a browser or seed data the development database must not get:

- **The design's review** (before Task 1): two reviewers, one for build fit and one for people and values, upheld 48 findings (6 high: symlinks in the importer's output folder, source links, Bluesky impersonation, mention links, being found, bulk), applied to the design before it was committed; the rulings made Bluesky an owner's switch, off by default, and split one task, giving eight.
- **The importer's labs** (Task 3): 16 cases in a read-only container with 512 MiB and half a CPU, including a 50,000-post X archive and a 2,000,000-block CAR; and the intake lab (Task 4): 50,000 lines in 52 s at a 252 MiB peak.
- **Two stops of the machine.** A reboot stopped the run for four days after Task 2, and a closed lid froze a whole-suite run in Task 6; each run was started again from the tree, which was intact.

## Before you start

- **Files are written by a script, never typed.** A file block can contain backslash escape sequences, and a writing tool can decode those into the characters they stand for; the 2b dry run's own tooling did exactly that once. These prompts were replayed into the repository by `replay.py` in the scratch tooling, which runs exactly these steps without a model session; a fresh session following them by hand must reach the same commits. Every writing step therefore runs `write_blocks.py`, which copies the step's blocks from the committed prompt file byte for byte, and `verify_prompts.py` checks the result after the last task.
- Every gate in the dry run ran with its standard input closed and a time limit. If a step sits without output for much longer than its allowed difference says, it is stuck, not slow: stop it and report.

## Order

| # | File | What it delivers | Needs Docker? |
|---|---|---|---|
| 1 | `01-contracts-and-file-protocol.md` | Contracts and the file protocol: packages/contracts/src/imports.ts (5.1, 9.3, IMPORT_RULES) and the new package packages/import-protocol (layout, limits, summary, lines, open, fixtures), the shapes every later 3b task builds on. | no |
| 2 | `02-import-database.md` | The database: migrations 0043_imports, 0044_imported_posts and 0045_import_readers with import_jobs, import_picks and import_keys, the import columns of posts and post_media, their guards, grants and row level security, the readers' indexes, and decision_actions_check's flood count without imported posts (section 6). | **yes** |
| 3 | `03-importer.md` | The importer: apps/importer, a service with no network that reads an X or Mastodon zip with korbat's own zip reader and streaming JSON assembler or a Bluesky CAR in two passes, keeps the person's own public posts through the three adapters and the common core, and writes posts.jsonl, the images of kept posts and summary.json into import-work (sections 5, 7.1 and 7.2), with its fixtures, unit tests and labs (12.1, 12.2, 12.5). | no |
| 4 | `04-upload-scan-preview-service.md` | Upload, scan, the preview and the service: the imports module of apps/api, with POST /api/imports under 4.2's checks, the chunked upload of 7.3, import-drive's scans, intake, time limits, retention and orphans, the preview's lines, picks and images and the cancel, the importer in Compose with its two volumes, Caddy's chunk route, the settings of 7.7 and the smoke test's import to ready (sections 4.2, 4.3, 4.4's routes, 7.3, 7.5 steps 1 to 3, 7 and 8, 7.6, 7.7 and 8.5's create). | **yes** |
| 5 | `05-imported-images.md` | Imported images: the confirmation and the Stop of an import, import-drive's feeder that hands an import's chosen images to the unchanged worker through the media module's own receive path and settles each under the matcher, the stop of an import at a refused image before any post, the cleanup of an ended import's images, and the media module's writers for imports (sections 4.5 steps 1 and 2, 6.5's media writers, 7.4, 7.5 step 4, 8.1 and 8.2). | **yes** |
| 6 | `06-publishing-readers-undo.md` | Publishing, the readers, undo and the account: import-drive publishes a confirmed import's chosen lines in batches through the social module's batch writer and removes them again through the author's own deletion path, imported posts are read on the profile's Imported tab only with their label, the account's purge and export take the imports, and an admin ends a whole import from a case by a recorded decision (sections 4.5 steps 3 and 4, 4.6, 4.7, 6.5's social writers, 7.5 steps 5 and 6, 8.3 to 8.7 and the API half of 9.3). | **yes** |
| 7 | `07-screens-and-console.md` | The screens and the console: Settings, Import posts and one import's screen drawn by its state (the chunked upload, the reading, the preview and the choice, the progress, the result and the undo), the provenance label and the Imported tab, the terms' Importing posts, and the console's import lines with an admin's End this import. | **yes** |
| 8 | `08-documentation-and-stack.md` | Documentation and the stack: the README's Importing posts with 3b's lines in Upgrading, Backups, Counsel's list and The interface, the main design's section 6a marked delivered with its section 9 entry of 2026-10-27, and the smoke test's whole import through the real importer: confirmed, read on the Imported tab and removed. | **yes** |

## Reading a report

Every session ends with a `TASK N REPORT` block. Check three lines before starting the next prompt:

1. `STOP condition hit: none`. If not, the session stopped on purpose. Read the pasted output, fix the environment (Docker not running, a port in use, data services down), and re-run the same prompt from a clean `git status`.
2. Every `Verify` line shows the expected text from the prompt.
3. The `Commit` line ends with the commit subject printed in the prompt.

If a report shows a STOP that is not an environment problem, paste the report back to the planning session. Do not let the executing session improvise.

The design is `docs/superpowers/specs/2026-10-22-import-3b-design.md`, including its amendments from the dry run. The task map is `docs/superpowers/plans/2026-10-27-import-3b.md`. Where the plan and a prompt differ, the prompt is the verified version.

## Verify the prompts against the repository

After Task 8, run this from the repo root. It extracts the last version of every file the prompts write and compares it with the file on disk:

```bash
python docs/superpowers/prompts/import-3b/verify_prompts.py
```

Expected: `prompts reproduce the repository exactly`.
