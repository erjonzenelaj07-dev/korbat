# korbat Foundation — execution prompts

One file per task. Each file is a complete, self-contained prompt: paste the entire file into a fresh Claude Code session opened at `C:\Users\Lenovo\Desktop\cool\korbat` and let it run. Do them in order; every prompt checks that the previous task's commit exists before starting.

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
| 13 | `13-expo-app.md` | Expo web shell with NativeWind calling `/api/health` | **yes** (dev API) |
| 14 | `14-docker-compose-stack.md` | Dockerfiles, Caddy, full stack up | **yes** |
| 15 | `15-ci-renovate.md` | GitHub Actions, semgrep, Renovate, admin placeholder | **yes** (semgrep container) |
| 16 | `16-cloudflare-tunnel.md` | Tunnel to the internet, no open ports | **yes** + Cloudflare account and a domain |

After each session, read its report. If it lists deviations, decide whether they are acceptable before starting the next prompt. If a session reports "blocked", fix the blocker (usually Docker not running, or `infra/.env` missing) and re-run the same prompt; every prompt is safe to re-run because it checks state before acting.

Source of truth for all of this is `docs/superpowers/plans/2026-09-03-foundation.md`; the prompts are that plan re-cut so each task stands alone.
