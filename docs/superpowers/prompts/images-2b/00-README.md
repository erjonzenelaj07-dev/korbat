# korbat 2b (images) — execution prompts

One file per task. Each file is a complete, self-contained prompt: paste the whole file into a fresh Claude Code session opened at `C:\Users\Lenovo\Desktop\cool\korbat` and let it run. Do them in order. Every prompt checks that the previous task's commit is the latest one before it starts.

## How these prompts were made reliable

Every task was dry-run end to end on 2026-09-18 and 2026-09-19 in a scratch clone of this repository, one commit per task. For each task a runner wrote the tests, ran them and required the expected failure, and wrote the implementation. It then ran every verification command and required each expected line, refused any changed file outside the task's list, and only then committed. These prompts are generated from those commits and the recorded outputs. Every file block is the committed file, and every "Observed on the dry run" block is real output. The scratch clone used shifted ports and its own compose project; the prompts use this repository's real ports and commands.

The dry run found and fixed these defects before the prompts were written:

- **Uppercase media ids.** An id in capitals passed the UUID check and then made the volume layout throw, which answered 500. Media ids are now made lowercase by the contract, and the file route checks the canonical form before touching the disk.
- **MediaError on the social router.** The social routes have their own error handler, which did not know the media module's error type, so posting with an image that was not ready answered 500. The handler now maps it like the app's.
- **Deletion requests withdrawn too early.** The sweeper withdrew a deletion request as soon as the folder was gone, while a slow worker could still write late files for it. Requests now stay for a ten-minute grace period after they are written.
- **MinIO's removal took `migrate` with it.** Deleting the MinIO services from the compose file also deleted the migration service that followed them. It is restored and checked by the stack step.
- **Two schema tasks.** drizzle-kit asks interactively when one migration drops and adds columns, which a scripted run cannot answer, so the `post_media` change is split into a drop-and-relax step and an add step.
- **Nested controls in quotes.** Quoted posts first showed their images as buttons inside the quote's link, a control inside a control. They are plain pictures now; the quote opens the post, where the grid and viewer are.
- **HEIC without a type.** Browsers on Windows often report no type for a `.heic` file, which would have shown the generic refusal. The composer also checks the file name.
- **States that never reached the DOM.** The browser check found the ALT button without `aria-expanded`: react-native-web 0.21 ignores the `accessibilityState` prop. The controls 2b writes use `aria-expanded` and `aria-busy` instead. The older uses elsewhere in the app were fixed afterwards, in commit `1f5580a`.

Each prompt replaces judgment with rules. Files are complete and copied byte for byte, commands run verbatim, and every expected line must appear. Any mismatch is a **STOP condition** that ends the session with a report instead of an improvised fix. The single permitted self-recovery is a clean `node_modules` reinstall after a `Cannot find module` error in a verification step.

## What can differ between runs

- **Migration filenames.** Drizzle's migration filenames in Tasks 4 and 5 end in a random adjective and a hero name, and a hero name can contain an underscore (`0005_huge_scarlet_spider.sql`). The prompts show them as a pattern.
- **Lockfile peer variants.** pnpm may give `apps/api` and `apps/worker` the two locked vitest variants the other way round (vite with esbuild 0.27.7 or 0.28.2). Nothing new is locked, and every gate passes either way.
- **Lockfile counts.** The number of new package versions in Tasks 6 and 15 can differ if a transitive dependency published a release since the dry run; every new version must still be at least 7 days old.
- **Durations.** Web exports in Tasks 15 and 16, image builds in Tasks 7, 14 and 17, and the semgrep scan can take many minutes.
- **Run noise.** Timings, ids, hashes, commit hashes and the worker's memory peak differ on every run. Every install prints `Packages: -N`, the optional packages pnpm skips on Windows, and every integration run prints a Vite warning about the extensionless import in `vitest.integration.config.ts` (`configLoader: 'native'`); neither is a failure.

## Execution findings (2026-09-21)

The prompts were executed in this repository on 2026-09-21, one fresh session per prompt. Every commit was compared with the dry run's by blob hash and matched it, apart from drizzle's random migration names, snapshot ids and timestamps; the migrations' SQL is byte for byte the dry run's. Three things came up:

- **pnpm's trust policy failed installs at random.** Task 6's first attempt stopped at its failing-test step because the hidden install had failed with `ERR_PNPM_TRUST_DOWNGRADE` for `semver@6.3.1`, deep in the web app's Babel tree. pnpm checks a version against the provenance of earlier releases whenever it resolves that version from the registry, and a non-frozen install re-resolves some locked versions on some runs and not on others: the same install failed 3 times in 4, and a lockfile-only update 3 times in 6, while the dry run never hit it. A scan of all 919 versions in the final lockfile with pnpm's rule found three that fail it, each a maintenance release of an older line published by the package's own maintainer without provenance: `semver@6.3.1`, `chokidar@4.0.3` and `ua-parser-js@1.0.41`. With the owner's approval, commit `8d9dd38` lists exactly these under `trustPolicyExclude` in `pnpm-workspace.yaml`. Afterwards 30 installs in a row passed, and every other version, and every new one, is still checked. The tree was reset and Task 6 ran again from the start; prompt 06's second precondition names that commit.
- **Precondition wording.** In prompts 03 and 10 to 14 the third precondition quotes the previous task's integration run, not an API unit run. Those prompts now say so.
- **Migration names.** drizzle-kit names a migration with a random adjective and a hero name, and a hero name can contain an underscore: this run got `0005_huge_scarlet_spider.sql` and `0006_nifty_blue_shield.sql`. The Task 4 session checked drizzle-kit's word lists before accepting the name. Prompts 04 and 05 now describe the shape.

## Verified in the dry run only

One check seeds data that does not belong in your development database, so it ran in the scratch clone and is not in the prompts:

- **The cleanup script's deletion (Task 17).** In the scratch clone, a seeded scenario (a kept account with a post, a test-shaped account that likes it, and a profile without an account that follows the kept account and replies to its post) was listed exactly, deleted with `--yes`, and left the kept account with its post and every counter recomputed: 0 followers, 1 post, 0 likes, 0 replies. The prompt runs the script without `--yes` only, because your development database holds real leftovers you should look at before deleting them.

## Before you start

- **Files are written by a script, never typed.** Several test files spell special characters as backslash escape sequences, and a writing tool can decode those into the characters they stand for; the dry run's own tooling did exactly that once. Every writing step therefore runs `write_blocks.py`, which copies the step's blocks from the committed prompt file byte for byte, and `verify_prompts.py` checks the result after the last task.
- Every gate in the dry run ran with its standard input closed and a time limit. If a step sits without output for much longer than its allowed difference says, it is stuck, not slow: stop it and report.

## Order

| # | File | What it delivers | Needs Docker? |
|---|---|---|---|
| 1 | `01-test-database.md` | A separate database and Redis database for integration tests, loaded without sourcing a file | **yes** |
| 2 | `02-media-contracts.md` | Media contracts: limits, alt text, upload and status responses, media views, and a media list on every post view | **yes** |
| 3 | `03-media-protocol.md` | The media-protocol package: limits, volume layout, result files and byte sniffers shared by the API and the worker | no |
| 4 | `04-post-media-relax.md` | post_media, step 1: drop the unused path column and make the attachment and dimension columns optional | **yes** |
| 5 | `05-post-media-lifecycle.md` | post_media, step 2: owner, status, failure reason and creation time, with checks and indexes | **yes** |
| 6 | `06-worker-pipeline.md` | The worker's image pipeline: sharp behind a decoder allowlist, WebP in two sizes, blurhash, and a reason for every refusal | no |
| 7 | `07-worker-loop.md` | The worker's loop over the two volumes: attempt cap, atomic writes, deletions, heartbeat and watchdog; Redis and the database leave the worker | **yes** |
| 8 | `08-media-files.md` | The API's side of the file protocol: streamed uploads with a byte count, safe reads of the untrusted store, deletion requests, heartbeat and free space | no |
| 9 | `09-media-upload-flows.md` | Media module: repository, upload, status and removal flows, routes and entry point; upload limits join the tier table | **yes** |
| 10 | `10-media-serving.md` | Serving image files after a visibility check: own rate-limit bucket, no session for public images, advisory health, and the media module's boundary rules | **yes** |
| 11 | `11-images-on-posts.md` | Images on posts: CreatePostRequest takes up to four described images, the social flows attach and detach them in their own transactions, and every view carries them | **yes** |
| 12 | `12-media-sweeper.md` | The media sweeper: results nobody polled, stuck uploads, unattached uploads, finished deletion requests and orphaned files, under a leader lock | **yes** |
| 13 | `13-media-http-tests.md` | Images over HTTP: two signed-up accounts upload, post, read, delete and hit every refusal through the real app | **yes** |
| 14 | `14-media-infra.md` | Compose without MinIO: two media volumes, an image worker with no network, credentials or capabilities, a Caddy body limit, and dev scripts that load their env file | **yes** |
| 15 | `15-web-composer-images.md` | The web composer takes up to four images: file picker, refusals before upload, previews, processing state, a required description per image, and a Post button that says what is missing | no |
| 16 | `16-web-post-images.md` | Post cards show their images: one in its own ratio or up to four in a 16:9 grid, blurhash placeholders, an ALT control, thumbnails in quotes, and a full-screen viewer with arrow keys and Escape | no |
| 17 | `17-stack-smoke-cleanup-docs.md` | The stack with images: the smoke test proves metadata stripping, the symlink refusal, deletion from disk and the worker's isolation; a worst-case mode at the pixel caps; a script that cleans test leftovers from the development database; README; scans | **yes** |

## Reading a report

Every session ends with a `TASK N REPORT` block. Check three lines before starting the next prompt:

1. `STOP condition hit: none`. If not, the session stopped on purpose. Read the pasted output, fix the environment (Docker not running, a port in use, data services down), and re-run the same prompt from a clean `git status`.
2. Every `Verify` line shows the expected text from the prompt.
3. The `Commit` line ends with the commit subject printed in the prompt.

If a report shows a STOP that is not an environment problem, paste the report back to the planning session. Do not let the executing session improvise.

The design is `docs/superpowers/specs/2026-09-18-images-2b-design.md`, including its amendments from the dry run. The task map is `docs/superpowers/plans/2026-09-18-images-2b.md`. Where the plan and a prompt differ, the prompt is the verified version.

## Verify the prompts against the repository

After Task 17, run this from the repo root. It extracts the last version of every file the prompts write and compares it with the file on disk:

```bash
python docs/superpowers/prompts/images-2b/verify_prompts.py
```

Expected: `prompts reproduce the repository exactly`.

## Later changes

Commit `1f5580a` (`docs/superpowers/prompts/screen-reader-states/`) changed two files these prompts write: `apps/app/package.json` gained vitest and a `test` script, and the post card's `Action` in `apps/app/src/components/social/PostCard.tsx` passes `aria-pressed` instead of `accessibilityState`, which react-native-web 0.21 ignores. `verify_prompts.py` therefore lists those two files as mismatches; the screen-reader prompt holds their current version.
