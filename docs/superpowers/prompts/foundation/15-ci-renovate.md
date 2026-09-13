# korbat Foundation — Task 15 of 16: CI, semgrep, supply-chain hardening, Renovate, admin placeholder

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-13; the local semgrep scan of the finished repository reports zero findings with these exact files. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous social platform whose backend is fully self-owned. Security is half the product, so the checks a bigger team would run by hand are automated from the first push: typecheck and tests, a dependency audit failing on high severity, semgrep with the OWASP and TypeScript rulesets plus secret detection, production bundle builds, and Compose validation. This task also applies the supply-chain settings semgrep's rules demand: GitHub Actions pinned to commit SHAs, a seven-day minimum release age for new package versions in pnpm and Renovate, pnpm's `trustPolicy: no-downgrade` and `blockExoticSubdeps`. The release-age floor is added now, after every dependency has been resolved into the lockfile, because fresh resolutions (as in Tasks 2 to 13) would be blocked whenever any transitive package is younger than a week; from here on installs are `--frozen-lockfile`, and adding a new dependency later either waits a week or uses `minimumReleaseAgeExclude` deliberately.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0. **Docker Desktop running** (semgrep runs in its container; Compose validation needs Docker).
- On Git Bash, Docker volume paths must be given as `$(pwd -W)` with `MSYS_NO_PATHCONV=1`; a plain `$PWD` gets mangled and semgrep reports "Detected Docker environment without a code volume". The commands below already do this.
- Action pins (commit SHAs looked up on 2026-09-13): `actions/checkout` v7.0.1 = `3d3c42e5aac5ba805825da76410c181273ba90b1`; `pnpm/action-setup` v6.1.0 = `ea17c68df8912ef543352723c149a84f56e3d413`; `actions/setup-node` v7.0.0 = `820762786026740c76f36085b0efc47a31fe5020`.

## Preconditions

`git log --oneline -1` must show `feat(infra): api, worker and caddy images; full compose stack`. If `.github/workflows/ci.yml` exists, compare every file with this prompt, fix drift, run steps 2 to 5, and report.

## Rules (read twice)

1. Copy every file below byte for byte. Append the given lines to `pnpm-workspace.yaml` and `.npmrc` without changing the existing lines.
2. Run every command exactly as written, in order, from the repo root.
3. Compare each command's output with the **Expected** text. Any non-zero exit, any `error TS`/`FAIL` line, an audit result containing `high` or `critical`, or a semgrep result other than `Findings: 0` is a **STOP condition**. Do not add suppressions, do not lower `--audit-level`, do not edit `.semgrepignore`.
4. On a STOP condition: stop, write the report with the exact output, and end the session.
5. Never commit `.env` files.
6. Commit exactly once, at the end, with the exact message given.
7. The report format at the bottom is mandatory.

## Files

### Create `apps/admin/package.json`
```json
{ "name": "@korbat/admin", "version": "0.0.0", "private": true, "type": "module" }
```

### Create `apps/admin/README.md`
```markdown
# @korbat/admin
Moderation console. Built in sub-project 3 (Trust & safety). Deploys as its own container on its own hostname behind Cloudflare Access.
```

### Create `.github/workflows/ci.yml`
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
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
        with: { version: 10.30.0 }
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
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
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - run: semgrep scan --config p/owasp-top-ten --config p/typescript --config p/secrets --error --exclude apps/app/dist --exclude node_modules
```

### Create `renovate.json`
```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended", ":semanticCommits"],
  "schedule": ["before 6am on monday"],
  "minimumReleaseAge": "7 days",
  "packageRules": [
    { "matchUpdateTypes": ["minor", "patch"], "groupName": "non-major dependencies", "minimumReleaseAge": "7 days" },
    { "matchPackageNames": ["expo", "react-native"], "enabled": false, "minimumReleaseAge": "7 days", "description": "Expo SDK upgrades are done by hand with expo upgrade" }
  ],
  "vulnerabilityAlerts": { "enabled": true, "labels": ["security"] }
}
```
(semgrep's Renovate rule requires `minimumReleaseAge` on every `packageRules` entry, not only at the top level.)

### Append to the END of `pnpm-workspace.yaml`
```yaml

# Supply-chain hardening (pnpm >= 10.16). Installs are frozen from here on.
minimumReleaseAge: 10080
trustPolicy: no-downgrade
blockExoticSubdeps: true
```

### Append to the END of `.npmrc`
```
min-release-age=7
```

## Steps

1. Create the four files and make the two appends.
2. Confirm the lockfile still installs under the new settings, then run the CI steps locally:
   ```bash
   pnpm install --frozen-lockfile
   pnpm typecheck
   pnpm test
   pnpm audit --audit-level high; echo "audit exit: $?"
   pnpm --filter @korbat/api build && pnpm --filter @korbat/worker build
   docker compose --env-file infra/.env.example -f infra/compose.yml config -q && echo "compose ok"
   ```
   Expected: install ends with `Done`; typecheck prints `Done` for six packages with no `error TS`; test summary lines are contracts `6 passed`, rules `4 passed`, db `9 passed`, worker `4 passed`, api `19 passed | 1 skipped`; audit prints a summary such as `4 vulnerabilities found` with only `low` and/or `moderate` severities and `audit exit: 0`; both builds print `Build success`; `compose ok`.
3. Run semgrep locally (first run pulls the image and can take several minutes):
   ```bash
   git add -A
   MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W):/src" semgrep/semgrep semgrep scan --config p/owasp-top-ten --config p/typescript --config p/secrets --error --exclude apps/app/dist --exclude node_modules
   ```
   Expected: the summary contains `Findings: 0 (0 blocking)` and `Ran <n> rules on <m> files: 0 findings.` (`git add -A` first because semgrep only scans git-tracked files.)
4. Commit:
   ```bash
   git commit -m "ci: typecheck, tests, audit, semgrep, compose validation; supply-chain hardening; renovate

   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
   ```
5. Run `git log --oneline -1`. Expected subject: `ci: typecheck, tests, audit, semgrep, compose validation; supply-chain hardening; renovate`.
6. If a GitHub remote exists (`git remote -v` prints one), push and report the Actions result; if not, say so. Do not create a remote in this task.

## Report format (mandatory)

```
TASK 15 REPORT
Files created/modified: <list>
Step 2 output (install last line, typecheck summary, five Tests lines, audit summary + exit, build lines, compose ok): <paste>
Step 3 output (semgrep summary lines): <paste>
Step 5 output: <paste>
Remote present / CI result: <paste or "no remote">
STOP condition hit: none | <exact output>
```
