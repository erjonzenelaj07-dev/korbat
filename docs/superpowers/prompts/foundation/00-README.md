# korbat Foundation — execution prompts

One file per task. Each file is a complete, self-contained prompt: paste the entire file into a fresh Claude Code session opened at `C:\Users\Lenovo\Desktop\cool\korbat` and let it run. Do them in order; every prompt checks that the previous task's commit exists before starting.

## How these prompts were made reliable

Every prompt was **dry-run end to end on 2026-09-13** in a scratch clone: every file was written exactly as printed, every command was executed, and every "Expected" line is the real output observed. The dry run found and fixed nine defects in the first draft (a type predicate that did not compile, a validator helper with wrong generics, a logger transport that crashes inside the bundle, MinIO images that no longer exist on Docker Hub, a wrong expected Postgres error, an Expo template that had changed shape, a test count off by one, a Docker volume path problem on Git Bash, and nine semgrep supply-chain findings). The prompts you have now contain the corrected versions.

Each prompt also replaces judgment with rules: files are copied byte for byte, commands are run verbatim, outputs are compared to the observed ones, and any mismatch is a **STOP condition** that ends the session with a report instead of an improvised fix. The single permitted self-recovery is a clean `node_modules` reinstall when a `Cannot find module` error appears (observed once during the dry run after several incremental installs).

What can still differ between runs, and why it is acceptable:
- **Transitive dependency versions** in the lockfile (the direct dependencies are pinned exactly; transitive ones resolve at install time). Behaviour is guarded by the tests.
- **The random two-word migration filename** drizzle-kit generates.
- **Timings, ids, and colours** in output.
- **Task 16** depends on your Cloudflare account and domain and cannot be verified in advance; its local half (compose profile, port check) was.

## Order

| # | File | What it delivers | Needs Docker running? |
|---|---|---|---|
| 1 | `01-repo-scaffold.md` | pnpm workspace, base tsconfig, editor/git config | no |
| 2 | `02-contracts.md` | `@korbat/contracts` Zod schemas + tests | no |
| 3 | `03-rules.md` | `@korbat/rules` public rulebook + tests | no |
| 4 | `04-db-auth-schema.md` | `@korbat/db` auth schema tables, RLS test | no |
| 5 | `05-db-content-schema.md` | identity + content tables | no |
| 6 | `06-db-safety-schema.md` | trust & safety tables, append-only audit log | no |
| 7 | `07-db-client-migrations.md` | DB client, migrator, generated + grants migrations | no |
| 8 | `08-infra-data-services.md` | Compose data services, Postgres roles, migration applied, isolation verified | **yes** |
| 9 | `09-api-config-logger.md` | API env config + PII-scrubbing logger | no |
| 10 | `10-api-middleware.md` | observability, security headers, rate limit, session stub, validation | no |
| 11 | `11-api-app-health.md` | app factory, health endpoint, entrypoints, tsup build, integration test | **yes** |
| 12 | `12-worker.md` | worker skeleton with job registry | **yes** (smoke) |
| 13 | `13-expo-app.md` | Expo web shell, hand-written with exact pins, calling `/api/health` | **yes** (dev API) |
| 14 | `14-docker-compose-stack.md` | Dockerfiles, Caddy, full stack up, browser check | **yes** |
| 15 | `15-ci-renovate.md` | GitHub Actions (SHA-pinned), semgrep clean, supply-chain settings, Renovate | **yes** (semgrep container) |
| 16 | `16-cloudflare-tunnel.md` | Tunnel to the internet, no open ports | **yes** + Cloudflare account and a domain |

## Reading a report

Every session ends with a `TASK N REPORT` block. Check three lines before starting the next prompt:
1. `STOP condition hit: none`. If not, the session stopped on purpose; read the pasted output, fix the environment (Docker not running, a port in use, `infra/.env` missing), and re-run the same prompt. Re-running is safe: every prompt checks state before acting.
2. The test count line matches the number printed in the prompt.
3. The `git log` line shows the expected commit subject.

If a report shows a STOP that is not an environment problem, paste the report back to the planning session; do not let the executing session improvise.

Source of truth for the design is `docs/superpowers/specs/2026-09-03-korbat-design.md`; the task breakdown is `docs/superpowers/plans/2026-09-03-foundation.md`. Where the plan and a prompt differ, the prompt is the verified version.
