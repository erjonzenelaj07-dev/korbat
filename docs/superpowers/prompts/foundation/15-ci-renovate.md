# korbat Foundation — Task 15 of 16: CI, semgrep, Renovate, admin placeholder

You are executing one task of an approved implementation plan. Do this task completely, verify it, commit it, and report. Do nothing beyond it.

## Project context

korbat is a pseudonymous social platform whose backend is fully self-owned (Hono API, own Postgres with least-privilege roles, Redis, MinIO, Docker Compose behind a Cloudflare Tunnel). Security is half the product, so the security checks that a bigger team would run by hand are automated from the first commit: typecheck and tests on every push, a dependency audit that fails on high-severity findings, static analysis with semgrep's OWASP and TypeScript rulesets plus secret detection, production bundle builds, and Compose file validation. Renovate keeps dependencies current with grouped weekly PRs and immediate security PRs.

This task adds the GitHub Actions workflow, the Renovate config, and a placeholder `@korbat/admin` package so the workspace shape matches the design (the moderation console is built in sub-project 3 and deploys on its own hostname behind Cloudflare Access).

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0. **Docker Desktop running** (semgrep runs locally in its container; Compose validation needs Docker).
- Notes: `pnpm audit --audit-level high` exits non-zero only for high/critical advisories. `docker compose --env-file infra/.env.example -f infra/compose.yml config -q` validates the file using the example env, which is what CI has. The `semgrep/semgrep` image provides the `semgrep` CLI; `--error` makes findings fail the job.
- Full plan: `docs/superpowers/plans/2026-09-03-foundation.md` (Task 15).

## Preconditions

`git log --oneline -1` must show `feat(infra): api, worker and caddy images; full compose stack`. If `.github/workflows/ci.yml` exists, verify against this prompt, fix drift, run the local checks, skip to the report.

## Rules

1. Exact file contents below.
2. If `pnpm audit` reports a high finding with no fix available, add its CVE to `pnpm.auditConfig.ignoreCves` in the root `package.json` and explain it in the commit body. Never lower `--audit-level`.
3. If semgrep reports a finding, fix the code unless it is a clear false positive; a false positive is silenced with a `// nosemgrep: <rule-id>` comment on that line with a reason. List every finding and what you did in the report.
4. LF line endings, 2-space indentation.
5. Verify before claiming; paste real output.
6. Commit exactly once with the given message and trailer.

## Files to create

### `apps/admin/package.json`
```json
{ "name": "@korbat/admin", "version": "0.0.0", "private": true, "type": "module" }
```

### `apps/admin/README.md`
```markdown
# @korbat/admin
Moderation console. Built in sub-project 3 (Trust & safety). Deploys as its own container on its own hostname behind Cloudflare Access.
```

### `.github/workflows/ci.yml`
```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:

jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10.30.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm audit --audit-level high
      - run: pnpm --filter @korbat/api build && pnpm --filter @korbat/worker build
      - run: docker compose --env-file infra/.env.example -f infra/compose.yml config -q

  semgrep:
    runs-on: ubuntu-latest
    container: semgrep/semgrep
    steps:
      - uses: actions/checkout@v4
      - run: semgrep scan --config p/owasp-top-ten --config p/typescript --config p/secrets --error --exclude apps/app/dist
```

### `renovate.json`
```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended", ":semanticCommits"],
  "schedule": ["before 6am on monday"],
  "packageRules": [
    { "matchUpdateTypes": ["minor", "patch"], "groupName": "non-major dependencies" },
    { "matchPackageNames": ["expo", "react-native"], "enabled": false, "description": "Expo SDK upgrades are done by hand with expo upgrade" }
  ],
  "vulnerabilityAlerts": { "enabled": true, "labels": ["security"] }
}
```

## Steps

1. Create the four files.
2. Run the CI steps locally, one at a time, and record each exit status:
   ```bash
   pnpm install --frozen-lockfile
   pnpm typecheck
   pnpm test
   pnpm audit --audit-level high
   pnpm --filter @korbat/api build && pnpm --filter @korbat/worker build
   docker compose --env-file infra/.env.example -f infra/compose.yml config -q && echo "compose ok"
   ```
   Expected: all exit 0. `pnpm test` should report tests from contracts (6), rules (4), db (9), api (20 + 1 skipped), worker (4).
3. Run semgrep locally:
   ```bash
   docker run --rm -v "$PWD:/src" semgrep/semgrep semgrep scan --config p/owasp-top-ten --config p/typescript --config p/secrets --error --exclude apps/app/dist
   ```
   Expected: `0 findings` (or `Ran N rules ... 0 findings`). Handle any finding per Rule 3.
4. Commit:
```bash
git add -A && git commit -m "ci: typecheck, tests, audit, semgrep, compose validation; renovate

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
5. If a GitHub remote exists (`git remote -v`), push and report the Actions result; if not, say so. Do not create a remote in this task.

## Report format

- Files created
- Exit status and trimmed output of each command in step 2, and the semgrep summary line from step 3
- Any audit ignore or semgrep suppression added, with justification
- Whether a remote exists and, if so, the CI outcome
- Deviations and why
- Anything blocked or uncertain
