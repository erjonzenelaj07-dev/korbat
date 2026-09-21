# korbat screen-reader states — execution prompt

One file per task. Each file is a complete, self-contained prompt: paste the whole file into a fresh Claude Code session opened at `C:\Users\Lenovo\Desktop\cool\korbat` and let it run. Do them in order. Every prompt checks that the previous task's commit is the latest one before it starts.

## How these prompts were made reliable

Every task was dry-run end to end on 2026-09-21 in a scratch clone of this repository, one commit per task. For each task a runner wrote the tests, ran them and required the expected failure, and wrote the implementation. It then ran every verification command and required each expected line, refused any changed file outside the task's list, and only then committed. These prompts are generated from those commits and the recorded outputs. Every file block is the committed file, and every "Observed on the dry run" block is real output. The scratch clone used shifted ports and its own compose project; the prompts use this repository's real ports and commands.

The dry run settled these points before the prompt was written:

- **A vitest config the coming Vite loader cannot read.** The web app's package has no `"type": "module"` (Expo's own config files are CommonJS), so a `vitest.config.ts` there makes Vite warn that its future native config loader will not load it. The config is `vitest.config.mts`, and the test step forbids the warning.
- **No types for `react-dom/server`.** React 19's `react-dom` ships no types and `@types/react-dom` is not installed, so the test's import would fail the typecheck. A four-line declaration in `apps/app/test/` types the one function the test uses instead of adding a package.
- **Labels that already carry the state.** Save/Saved and Follow/Following change their label with their state, and `aria-pressed` on them would announce it twice, so they get none. Like and Repost, whose labels never change, get `aria-pressed` through a new `pressed` prop on the post card's `Action`.

Each prompt replaces judgment with rules. Files are complete and copied byte for byte, commands run verbatim, and every expected line must appear. Any mismatch is a **STOP condition** that ends the session with a report instead of an improvised fix. The single permitted self-recovery is a clean `node_modules` reinstall after a `Cannot find module` error in a verification step.

## What can differ between runs

- **Durations.** The web export runs a full Metro bundle and can take a few minutes.
- **Lockfile shape.** Adding vitest to the web app adds three lines to `pnpm-lock.yaml` and no new package version; pnpm can record either of the locked vitest variants, and no gate depends on which.
- **Run noise.** Timings and commit hashes differ on every run, and every install prints `Packages: -N`, the optional packages pnpm skips on Windows.

## Verified in the dry run only

Two findings need a browser, so they come from the scratch clone and are not in the prompt:

- **The browser check.** In the scratch stack, rebuilt with the fix and signed in: the tab rows on Home, a profile and Privacy are tab lists whose `aria-selected` follows clicks; the active link says `aria-current="page"` in the sidebar and in the bottom bar at phone width; Like reports `aria-pressed="false"`, `"true"` after a press and `"false"` again, and Repost `"false"`; Save and Follow change only their label, with `aria-busy` on Follow; the re-authentication panel's method is a native button with `aria-pressed="true"`; idle buttons say `aria-busy="false"` and disabled ones `aria-disabled="true"`. The terms checkbox sits behind sign-up and is covered by the test.
- **A highlight the fix mirrors.** On `/settings/privacy` no navigation link is current, because the Settings link points to `/settings/security`, and sighted users see no highlight there either. The fix reports what is shown; which link to highlight on the Privacy page is a separate decision.

## Before you start

- **Files are written by a script, never typed.** A file block can contain backslash escape sequences, and a writing tool can decode those into the characters they stand for; the 2b dry run's own tooling did exactly that once. Every writing step therefore runs `write_blocks.py`, which copies the step's blocks from the committed prompt file byte for byte, and `verify_prompts.py` checks the result after the last task.
- Every gate in the dry run ran with its standard input closed and a time limit. If a step sits without output for much longer than its allowed difference says, it is stuck, not slow: stop it and report.

## Order

| # | File | What it delivers | Needs Docker? |
|---|---|---|---|
| 1 | `01-screen-reader-states.md` | Tabs, navigation, toggles, the terms checkbox and busy buttons expose their state to screen readers through aria props, and the web app's first test keeps accessibilityState out | no |

## Reading a report

Every session ends with a `TASK N REPORT` block. Check three lines before starting the next prompt:

1. `STOP condition hit: none`. If not, the session stopped on purpose. Read the pasted output, fix the environment (Docker not running, a port in use, data services down), and re-run the same prompt from a clean `git status`.
2. Every `Verify` line shows the expected text from the prompt.
3. The `Commit` line ends with the commit subject printed in the prompt.

If a report shows a STOP that is not an environment problem, paste the report back to the planning session. Do not let the executing session improvise.

The design is `docs/superpowers/specs/2026-09-21-screen-reader-states-design.md`. The task map is `docs/superpowers/plans/2026-09-21-screen-reader-states.md`. Where the plan and the prompt differ, the prompt is the verified version.

## Verify the prompts against the repository

After Task 1, run this from the repo root. It extracts the last version of every file the prompts write and compares it with the file on disk:

```bash
python docs/superpowers/prompts/screen-reader-states/verify_prompts.py
```

Expected: `prompts reproduce the repository exactly`.
