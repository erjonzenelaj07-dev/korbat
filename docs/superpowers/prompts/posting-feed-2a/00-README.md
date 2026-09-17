# korbat 2a (posting and feed) — execution prompts

One file per task. Each file is a complete, self-contained prompt: paste the whole file into a fresh Claude Code session opened at `C:\Users\Lenovo\Desktop\cool\korbat` and let it run. Do them in order. Every prompt checks that the previous task's commit is the latest one before it starts.

## How these prompts were made reliable

Every task was dry-run end to end on 2026-09-17 in a scratch clone of this repository, one commit per task. For each task a runner wrote the tests, ran them and required the expected failure, and wrote the implementation. It then ran every verification command and required each expected line, refused any changed file outside the task's list, and only then committed. These prompts are generated from those commits and the recorded outputs. Every file block is the committed file, and every "Observed on the dry run" block is real output. The scratch clone used shifted ports and its own compose project; the prompts use this repository's real ports and commands.

The dry run found and fixed these defects before the prompts were written:

- **Array parameters in raw SQL.** Drizzle expands a JavaScript array in a raw query into a list of separate parameters, so `any(...)::uuid[]` received a bare id or a record. Id lists now travel as one comma-joined parameter that SQL splits into a uuid array.
- **Timestamps from raw queries.** Raw queries return timestamps as text and refuse `Date` parameters. The repository formats every returned timestamp as ISO text in SQL, parses it once in the row mappers, and passes cursor times as ISO strings.
- **Counter helper type.** The transactional counter helper declared its column as a SQL fragment while receiving Drizzle columns; it now takes any SQL wrapper.
- **Clock ties in tests.** Two follows made in the same millisecond had undefined list order. The flow test harness advances its clock on every read, and the HTTP tests use a strictly increasing clock.
- **Leading @ in handles.** Only the route layer stripped a leading `@`; the flows now tolerate it too.

Each prompt replaces judgment with rules. Files are complete and copied byte for byte, commands run verbatim, and every expected line must appear. Any mismatch is a **STOP condition** that ends the session with a report instead of an improvised fix. The single permitted self-recovery is a clean `node_modules` reinstall after a `Cannot find module` error in a verification step.

## What can differ between runs

- **Migration filename.** Drizzle's migration filename in Task 2 ends in two random words. The prompt shows the name as a pattern.
- **Export and build durations.** Web exports in Tasks 9 to 12 and the image builds in Task 13 can take many minutes.
- **Run noise.** Timings, ids, hashes and commit hashes differ on every run.

## Order

| # | File | What it delivers | Needs Docker? |
|---|---|---|---|
| 1 | `01-social-contracts.md` | Social contracts: post bodies, post views, timelines, profiles, engagement and the error codes | no |
| 2 | `02-social-schema.md` | Counters, deletion time and list indexes for posts and profiles | **yes** |
| 3 | `03-social-core.md` | Social module core: errors, keyset cursors, account tiers, write limits and the visibility rule | no |
| 4 | `04-social-repo.md` | Social repository: posts, engagement, graph, timelines, lists and profiles in SQL | **yes** |
| 5 | `05-social-flows-posts.md` | Post views, and the post and engagement flows | **yes** |
| 6 | `06-social-flows-graph.md` | Graph, profile and timeline flows | **yes** |
| 7 | `07-social-http.md` | Social routes, the module entry point, app wiring and the boundary test for the social module | **yes** |
| 8 | `08-social-http-tests.md` | Posting and feed over HTTP: two signed-up accounts through the real app | **yes** |
| 9 | `09-web-shell-timelines.md` | Web: social API client, post card, paged lists, app shell, home timelines, and sign-in moved to /signin | no |
| 10 | `10-web-compose-thread.md` | Web: composer, compose sheet, thread page, and quoting | no |
| 11 | `11-web-profiles.md` | Web: profile page with follow, mute and block, and the follower and following lists | no |
| 12 | `12-web-bookmarks-privacy.md` | Web: bookmarks page, privacy settings with unblock and unmute, security page inside the shell | no |
| 13 | `13-stack-smoke-docs.md` | Docker stack with posting: smoke test posts and reads Latest through Caddy; README | **yes** |

## Reading a report

Every session ends with a `TASK N REPORT` block. Check three lines before starting the next prompt:

1. `STOP condition hit: none`. If not, the session stopped on purpose. Read the pasted output, fix the environment (Docker not running, a port in use, data services down), and re-run the same prompt from a clean `git status`.
2. Every `Verify` line shows the expected text from the prompt.
3. The `Commit` line ends with the commit subject printed in the prompt.

If a report shows a STOP that is not an environment problem, paste the report back to the planning session. Do not let the executing session improvise.

The design is `docs/superpowers/specs/2026-09-17-posting-feed-2a-design.md`, including its amendments from the dry run. The task map is `docs/superpowers/plans/2026-09-17-posting-feed-2a.md`. Where the plan and a prompt differ, the prompt is the verified version.

## Verify the prompts against the repository

After Task 13, run this from the repo root. It extracts the last version of every file the prompts write and compares it with the file on disk:

```bash
python docs/superpowers/prompts/posting-feed-2a/verify_prompts.py
```

Expected: `prompts reproduce the repository exactly`.
