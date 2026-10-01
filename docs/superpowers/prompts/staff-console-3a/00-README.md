# korbat staff console (3a) — execution prompts

One file per task. Each file is a complete, self-contained prompt: paste the whole file into a fresh Claude Code session opened at `C:\Users\Lenovo\Desktop\cool\korbat` and let it run. Do them in order. Every prompt checks that the previous task's commit is the latest one before it starts.

## How these prompts were made reliable

Every task was dry-run end to end on 2026-09-30 and 2026-10-01 in a scratch clone of this repository, one commit per task. For each task a runner wrote the tests, ran them and required the expected failure, and wrote the implementation. It then ran every verification command and required each expected line, refused any changed file outside the task's list, and only then committed. These prompts are generated from those commits and the recorded outputs. Every file block is the committed file, and every "Observed on the dry run" block is real output. The scratch clone used shifted ports and its own compose project; the prompts use this repository's real ports and commands.

The dry run found and settled these points before the prompts were written:

- **`audit-verify` grew with the tasks.** Task 2 checks the chain, the kept places and that every staff key has one `staff_key_added` row; Task 5 adds the step-up rules (every row whose action is in `STAFF_STEP_UP_ACTIONS` carries a step-up, whatever its actor, checked against the public key, owner, origin and relying party ID recorded on its key); Task 8 makes it read every row whatever its place.

Each prompt replaces judgment with rules. Files are complete and copied byte for byte, commands run verbatim, and every expected line must appear. Any mismatch is a **STOP condition** that ends the session with a report instead of an improvised fix. The single permitted self-recovery is a clean `node_modules` reinstall after a `Cannot find module` error in a verification step.

## What can differ between runs

- **Run noise.** Timings and commit hashes differ on every run; every install prints `Packages: -N`, the optional packages pnpm skips on Windows.
- **Durations.** The integration suite runs its files one at a time and takes several minutes; Tasks 7 and 8 rebuild every image of the stack, which can take ten minutes or more on a cold cache.
- **The API prints two `ExperimentalWarning`s at start** (SimpleWebAuthn, from 1c, probes Node 24's ML-DSA support at import); they are expected.
- **`http-timing` can fail under heavy load** ("expected 53.39 to be less than 50", a median of 20 requests): it passes on its own and on a rerun of the suite.

## Verified in the dry run only

These checks ran in the scratch clone only, because they need a browser or seed data the development database must not get:

- **The console's bundle is 697 KB, 168 KB gzipped, 453 KB of it zod.** `import { z } from "zod"` keeps zod's whole namespace (every locale, the JIT compiler and the JSON-schema code) because the contracts and the page use `z` as an object. A staff console loads it once per session; trimming it (zod/mini, or a locale stub) would change how the shared contracts import zod and is left as it is.
- **A browser walk-through against the scratch stack** (`tools-3a/pw-console.mjs`, playwright-core 1.63 with a CDP virtual authenticator on Chromium 153, under Caddy's real headers): 143 checks passed after Task 7 and, updated for Task 8, 183 after it. It enrols a key from a command-line link after a backup-eligible key is refused and explained on the same link, signs in with the new key from the success page, enrols a second key while signed in and shows that only it is asked, revokes a second browser's session with a step-up, pages the audit log and goes to a place past the head, refuses a step-up challenge served as sign-in options before any key is asked, checks the not-available page at 127.0.0.1 and the app site's refusal of `/api/staff`, and passes `audit-verify` with a kept head. It writes test accounts to the database it runs against, so it stays in the scratch tooling.
- **The committed browser check's "asks that key and no other" step cannot fail on its own.** Its fixture sends an empty allow list and its first authenticator is set not to answer, so it would pass without the narrowing; the unit test `apps/admin/test/sign-in.test.ts` covers the narrowing, and the walk-through records the allow list the page passes to the browser.

## Before you start

- **Files are written by a script, never typed.** A file block can contain backslash escape sequences, and a writing tool can decode those into the characters they stand for; the 2b dry run's own tooling did exactly that once. These prompts were replayed into the repository by `replay.py` in the scratch tooling, which runs exactly these steps without a model session; a fresh session following them by hand must reach the same commits. Every writing step therefore runs `write_blocks.py`, which copies the step's blocks from the committed prompt file byte for byte, and `verify_prompts.py` checks the result after the last task.
- Every gate in the dry run ran with its standard input closed and a time limit. If a step sits without output for much longer than its allowed difference says, it is stuck, not slow: stop it and report.

## Order

| # | File | What it delivers | Needs Docker? |
|---|---|---|---|
| 1 | `01-ground.md` | The ground for the staff console: the console's origin and relying party settings, the staff contracts, migration 0012 (staff keys, enrolments and staff sessions guarded by the database; the audit log as a hash chain with its head, trigger and back-fill; the migrator-owned functions that add a staff key, append the auth side's audit rows and forget a deleted account's keys), the schema test, the harness's head row and the development cleaner's skip | **yes** |
| 2 | `02-staff-module-record.md` | The staff module and the audit record: chain.ts (the canonical text in Node with its test vectors), the audit writer and reader, the module mounted only while CONSOLE_ORIGIN is set and passed over the app's CORS and session, the staff gate, the architecture rules, staff.js audit-head and audit-verify with kept places, grant-role's change and record in one auth transaction, and the integration client's console mode | **yes** |
| 3 | `03-staff-keys-enrolment.md` | Staff keys and enrolment: the codec's staff purposes and any-string binding, the wrapper's user verification, security-key hint and BE report, the enrolment flow and its routes through auth.add_staff_key, staff.js enroll in the migrate service and staff.js keys, grant-role's and the take-down's staff rows, and the four staff mails | **yes** |
| 4 | `04-staff-sign-in-sessions.md` | Staff sign-in and sessions: the sign-in flow with one staff_key_invalid answer, the counter rule's revocation, the uncached session store with the activity mark, requireStaff with the staff CSRF check, the staff cookies, the me, sessions, keys and audit routes, sign-out, staff.js revoke, the janitor's staff retention, and requireStaffMfa removed | **yes** |
| 5 | `05-step-up.md` | Step-up: the 74-byte step-up challenge in the codec and the contracts, the parameter-bound action hash over STAFF_STEP_UP_ACTIONS, the step-up flow and requireStaffStepUp, DELETE /api/staff/sessions/:handle confirmed by the session's key with its assertion stored in the record, audit-verify's step-up and key checks, and the route-table tests | **yes** |
| 6 | `06-staff-console.md` | The staff console: apps/admin as a React page built by esbuild with plain CSS and jitless zod, its router, fetch wrappers and screens (sign-in, enrolment, home, the audit log, the console off), the check of step-up options before the key is asked, the idle timer bounded by the absolute end, the development server with the console site's headers, the development settings, and CI building it | **yes** |
| 7 | `07-console-infrastructure.md` | Infrastructure for the staff console: Caddy's console site on 8090 with the console's headers, the app's site refusing /api/staff, the image's console stage, Compose and the development port, the environment template, the smoke test's console checks, and the committed browser check run in CI | **yes** |
| 8 | `08-review-fixes.md` | What the review of 3a upheld, fixed: the console checks every ceremony's challenge before it asks for a key, audit-verify reads every row whatever its place, keys are judged by the origin and relying party they were enrolled for, the enrolment page's sign-in check uses the new key, and fifteen smaller fixes and tests | **yes** |
| 9 | `09-documentation.md` | Documentation: the README's staff console section, runbook, restore steps and lines under Before going public; the README lines 3a made false; the main design's amendment and the split of row 3; Changed by 3a in the 1c design; and the dry run's amendments to the 3a design | no |

## Reading a report

Every session ends with a `TASK N REPORT` block. Check three lines before starting the next prompt:

1. `STOP condition hit: none`. If not, the session stopped on purpose. Read the pasted output, fix the environment (Docker not running, a port in use, data services down), and re-run the same prompt from a clean `git status`.
2. Every `Verify` line shows the expected text from the prompt.
3. The `Commit` line ends with the commit subject printed in the prompt.

If a report shows a STOP that is not an environment problem, paste the report back to the planning session. Do not let the executing session improvise.

The design is `docs/superpowers/specs/2026-09-28-staff-console-3a-design.md`, including its amendments from the dry run. The task map is `docs/superpowers/plans/{PLAN_DATE}-staff-console-3a.md`. Where the plan and a prompt differ, the prompt is the verified version.

## Verify the prompts against the repository

After Task 9, run this from the repo root. It extracts the last version of every file the prompts write and compares it with the file on disk:

```bash
python docs/superpowers/prompts/staff-console-3a/verify_prompts.py
```

Expected: `prompts reproduce the repository exactly`.
