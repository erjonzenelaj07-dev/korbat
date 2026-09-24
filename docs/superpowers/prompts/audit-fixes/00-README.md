# korbat audit fixes — execution prompts

One file per task. Each file is a complete, self-contained prompt: paste the whole file into a fresh Claude Code session opened at `C:\Users\Lenovo\Desktop\cool\korbat` and let it run. Do them in order. Every prompt checks that the previous task's commit is the latest one before it starts.

## How these prompts were made reliable

Every task was dry-run end to end on 2026-09-23 and 2026-09-24 in a scratch clone of this repository, one commit per task. For each task a runner wrote the tests, ran them and required the expected failure, and wrote the implementation. It then ran every verification command and required each expected line, refused any changed file outside the task's list, and only then committed. These prompts are generated from those commits and the recorded outputs. Every file block is the committed file, and every "Observed on the dry run" block is real output. The scratch clone used shifted ports and its own compose project; the prompts use this repository's real ports and commands.

The dry run found and settled these points before the prompts were written:

- **expo stays at 57.0.22.** Its patch releases 57.0.23 and 57.0.24 pull `@expo/cli` 57.0.26, published five days before the dry run, so the lockfile-age check refused them; Renovate proposes the bump once it is mature.
- **TypeScript 6 and 7 include no types by default.** Both compilers default `types` to an empty list and refuse a side-effect import of a file without a declaration, so the app's tsconfig names `node` and `apps/app/src/css.d.ts` declares `*.css`; every other package already named `node`.
- **query-string 9 exports a namespace as its default.** Its types declare only a default export, so the test imports that and calls `parse` and `stringify` on it, the way expo-router reaches them.
- **nodemailer 10 ships its own types.** `@types/nodemailer`, a 6.x definition, left with no code change.
- **The HTML shell is `apps/app/public/index.html`, not `+html.tsx`.** Expo Router reads `+html.tsx` only for static output; with `web.output: "single"` the export takes `public/index.html` as its template, fills in the language and title and appends the bundle links. The dry run's first export ignored the `+html.tsx` file and produced the default shell.
- **The Caddy image strips the binary's file capability.** The official image gives `/usr/bin/caddy` `cap_net_bind_service=ep`; once the service drops every capability and runs as its own user, the kernel refuses to execute a binary whose file capabilities it cannot grant (`operation not permitted`, the container restarting forever). Port 8080 needs no capability, so the Dockerfile runs `setcap -r /usr/bin/caddy` before switching user.

Each prompt replaces judgment with rules. Files are complete and copied byte for byte, commands run verbatim, and every expected line must appear. Any mismatch is a **STOP condition** that ends the session with a report instead of an improvised fix. The single permitted self-recovery is a clean `node_modules` reinstall after a `Cannot find module` error in a verification step.

## What can differ between runs

- **Durations.** The web export runs a full Metro bundle and can take a few minutes; the integration suite a few minutes more.
- **Lockfile counts.** The lockfile-age check reported 48 new package versions on the dry run; the number can differ if a dependency of a dependency published a release since, and the line must still end in `all at least 7 days old`. A version younger than 7 days is a STOP condition.
- **Audit counts.** `pnpm audit` reported 3 advisories (1 low, 2 moderate) after Task 1, all in build-time tools; the count can change as advisories are published, and only `audit-exit=0` is required.
- **Run noise.** Timings and commit hashes differ on every run, and every install prints `Packages: -N`, the optional packages pnpm skips on Windows.
- **A busy native binary.** pnpm links native binaries (esbuild's, TypeScript 7's) from its store into node_modules as hard links, shared with every other pnpm project on the machine. While another project runs one of them, Windows refuses to unlink it and an install fails with `ERR_PNPM_EPERM ... esbuild.exe`. The dry run and the replay therefore install with `--config.package-import-method=copy`, which writes private copies; if an install step fails that way, run the same command again with that flag added once, and record it in the report.
- **The dev-env step (Task 4).** `node scripts/gen-dev-env.mjs` prints `apps/api/.env: completed, added TRUST_PROXY, TOTP_ENC_KEYS_PREVIOUS` when the file exists without the two keys, `nothing to add` when it already has them, and `created with N keys` on a fresh clone; the check that matters is `keys=2`, the count of those two keys in the file afterwards.
- **Task 10's red run.** The dry run observed `1 failed | 15 passed`: the scratch clone's node_modules already held query-string 7.1.3 from an earlier attempt, so only the lockfile assertion failed. In the repository node_modules holds 9.5.1 until the install step, so both tests of the file fail (`2 failed | 14 passed`); either way the run must report failures.

## Verified in the dry run only

These checks ran in the scratch clone only, because they need a browser or seed data the development database must not get:

- **Migration 0008 was generated three times (Task 6).** Each rerun of the task in the scratch clone had to revert the generated migration (its SQL, its snapshot and the journal entry) and undo it in both scratch databases (drop the eight new indexes, recreate the four old ones, delete the row from `drizzle.__drizzle_migrations`), because drizzle-kit reports `No schema changes` once a migration matching the schema exists, and the migrator would try to apply a regenerated file with a newer timestamp on top of the applied one. A single pass, as in the prompt, never meets this.
- **Browser check on the rebuilt scratch stack (after Tasks 8, 10 and 11).** With a session minted for the scratch `@browsercheck` account by SQL: Tab reaches the navigation links as real anchors and Enter follows them, the address bar following (`/signin`); the page is dark with the inline icon before the bundle loads (`color-scheme` dark, `rel=icon` data URI, body background `rgb(9, 9, 11)`); `/settings/privacy` marks the Settings link current; a profile opened with a query string (`/u/browsercheck?x=1&y=%2F`) renders; Delete on an own post shows the labelled dialog row `Delete this post? | Delete | Keep`, Keep withdraws it with the post kept, Delete removes the post; after Task 11 the focus lands on Keep when the question appears. Before Task 10 the same check showed `TypeError: o.stringify is not a function` from the bundle and no address-bar change on any navigation, which is what Task 10 fixes.

## Before you start

- **Files are written by a script, never typed.** A file block can contain backslash escape sequences, and a writing tool can decode those into the characters they stand for; the 2b dry run's own tooling did exactly that once. These prompts were replayed into the repository by `replay.py` in the scratch tooling, which runs exactly these steps without a model session; a fresh session following them by hand must reach the same commits. Every writing step therefore runs `write_blocks.py`, which copies the step's blocks from the committed prompt file byte for byte, and `verify_prompts.py` checks the result after the last task.
- Every gate in the dry run ran with its standard input closed and a time limit. If a step sits without output for much longer than its allowed difference says, it is stuck, not slow: stop it and report.

## Order

| # | File | What it delivers | Needs Docker? |
|---|---|---|---|
| 1 | `01-dependencies.md` | TypeScript 7 for the server side and 6 for the app, ioredis 6, hono, zod, argon2, nodemailer and nativewind patch releases; query-string overridden past its decoder advisory | **yes** |
| 2 | `02-esbuild-build.md` | esbuild called directly replaces tsup for the API and worker bundles; the chokidar trust exclusion and the dead .npmrc line go | no |
| 3 | `03-auth-hardening.md` | Two-factor enrolment and session revocation need fresh authentication; owners are emailed about security changes; hashed flow ids, the two missing limits, browser requests never get bearer tokens, revocation tombstones, rehash-on-login, TOTP key rotation, malformed JSON answered as 400 | **yes** |
| 4 | `04-request-identity.md` | The client address is read the way TRUST_PROXY says and only its keyed hash is stored or counted; production refuses test Turnstile secrets and plain-http origins; JSON bodies are capped at 64 KiB; the mail relay must offer TLS in production; error stacks are scrubbed | **yes** |
| 5 | `05-jobs-retention-media-safety.md` | A job runner with a refreshed lock runs the media sweeper and a new auth janitor (dead codes, old sessions, the IP-hash purge, a 90-day security log through a definer function); reconcile refuses to delete many orphan images; the untrusted store is never opened blocking | **yes** |
| 6 | `06-social-fixes.md` | A reply's parent author is hidden with the parent; blocking retracts reposts and likes both ways; pair locks close the race between a block and a follow, like, repost, reply or quote; hidden posts answer with their state before a block; disguising characters are refused; follower pages filter before the limit; a failing limit store is a 503; ids are canonical; daily upload caps; four indexes | **yes** |
| 7 | `07-web-client.md` | Every navigation control is a real anchor the keyboard can follow; deletion asks first and actions wait for each other; lists never double-load; a failed session load is not a sign-out and a 401 anywhere is; ids are validated; dim text meets the contrast floor; dialogs, headings and image buttons carry the right roles; the page is dark and has an icon before the bundle loads; the terms name Turnstile and the device id | no |
| 8 | `08-infrastructure.md` | PostgreSQL 18 with a rehearsed upgrade, Valkey with a password, Caddy as its own user on 8080 with cache headers and body limits, three networks, memory and process limits, log rotation, images pinned by digest, pnpm through corepack, CI permissions and an image build, Renovate digest pinning, and scripts that refuse a remote Docker | **yes** |
| 9 | `09-documentation.md` | The 1a, 2a and 2b specs record the audit's amendments, the main design records the audit, the technologies, the method and the roadmap, and the audit spec records what its dry run settled | no |
| 10 | `10-query-string.md` | The query-string override goes: 7.1.3 stays (expo-router imports it as a namespace), its decoder is overridden to decode-uri-component 0.5.0 and a repository patch lets the CommonJS module call the ES module | **yes** |
| 11 | `11-delete-focus.md` | The delete question takes the keyboard focus and hands it back to Delete when withdrawn | **yes** |

## Reading a report

Every session ends with a `TASK N REPORT` block. Check three lines before starting the next prompt:

1. `STOP condition hit: none`. If not, the session stopped on purpose. Read the pasted output, fix the environment (Docker not running, a port in use, data services down), and re-run the same prompt from a clean `git status`.
2. Every `Verify` line shows the expected text from the prompt.
3. The `Commit` line ends with the commit subject printed in the prompt.

If a report shows a STOP that is not an environment problem, paste the report back to the planning session. Do not let the executing session improvise.

The design is `docs/superpowers/specs/2026-09-23-audit-fixes-design.md`, including its amendments from the dry run. The task map is `docs/superpowers/plans/2026-09-23-audit-fixes.md`. Where the plan and a prompt differ, the prompt is the verified version.

## Verify the prompts against the repository

After Task 11, run this from the repo root. It extracts the last version of every file the prompts write and compares it with the file on disk:

```bash
python docs/superpowers/prompts/audit-fixes/verify_prompts.py
```

Expected: `prompts reproduce the repository exactly`.
