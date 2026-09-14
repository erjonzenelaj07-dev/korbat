# korbat 1a — Task 5 of 21: 1a API dependencies and the lockfile age check

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-14 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

The workspace refuses package versions younger than 7 days, and pnpm re-checks the whole lockfile on every add. While older locks are still inside that window, a plain add fails. This task adds the three auth dependencies with the age check disabled for that one command, and a script that proves no newly locked version is younger than the floor. The supply-chain settings themselves never change.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. Only the exact `pnpm add` commands printed below may change dependencies. Never edit `pnpm-workspace.yaml` or `.npmrc`.
- Pinned by this task: @node-rs/argon2 2.2.0, uqr 0.1.3, nodemailer 10.0.0, @types/nodemailer 6.4.24.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(auth): tokens, hashing, constant-time compare, versioned AES-256-GCM`.
3. The previous task's last API unit run ended with `Tests  31 passed | 1 skipped (32)`.

## Rules (read twice)

1. Copy every file below byte for byte. Each block is the complete file: create it, or replace the existing file entirely.
2. Run every command exactly as written, in order, from the repo root.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the files

### Create `scripts/check-lockfile-age.mjs`

```js
#!/usr/bin/env node
/**
 * Fails when pnpm-lock.yaml gained a package version younger than the workspace's minimumReleaseAge.
 *
 * Why this exists: pnpm re-checks the age of the whole dependency graph on `pnpm add`, so while any
 * existing lock is younger than the floor (for example right after an Expo SDK release) every
 * dependency change fails. The safe workaround is to add the dependency with the age check disabled
 * for that one command and then prove with this script that nothing newly locked is too young.
 *
 * Usage: node scripts/check-lockfile-age.mjs [--base <git ref>]   (default base: HEAD)
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const baseIndex = args.indexOf("--base");
const base = baseIndex >= 0 ? args[baseIndex + 1] : "HEAD";

const workspace = readFileSync(resolve(root, "pnpm-workspace.yaml"), "utf8");
const minutes = Number(/^minimumReleaseAge:\s*(\d+)\s*$/m.exec(workspace)?.[1] ?? "0");
if (!minutes) {
  console.log("minimumReleaseAge is not set; nothing to check");
  process.exit(0);
}

/** `name@version` for every entry in the lockfile's `packages:` section. */
function lockedVersions(text) {
  const section = text.split("\npackages:\n")[1]?.split("\nsnapshots:\n")[0] ?? "";
  return new Set([...section.matchAll(/^ {2}'?(@?[^@\s']+@[^:'()\s]+)'?:\s*$/gm)].map((m) => m[1]));
}

const current = lockedVersions(readFileSync(resolve(root, "pnpm-lock.yaml"), "utf8"));
const previous = lockedVersions(execFileSync("git", ["show", `${base}:pnpm-lock.yaml`], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
const added = [...current].filter((entry) => !previous.has(entry)).sort();

const now = Date.now();
const floorMs = minutes * 60_000;

async function publishedAt(entry) {
  const at = entry.lastIndexOf("@");
  const name = entry.slice(0, at);
  const version = entry.slice(at + 1);
  const res = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2F")}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`registry returned ${res.status} for ${name}`);
  const iso = (await res.json()).time?.[version];
  if (!iso) throw new Error(`no publish time for ${entry}`);
  return { entry, published: Date.parse(iso) };
}

const results = [];
for (let i = 0; i < added.length; i += 16) {
  results.push(...(await Promise.all(added.slice(i, i + 16).map(publishedAt))));
}

const tooYoung = results.filter((r) => now - r.published < floorMs);
const days = (minutes / 1440).toFixed(minutes % 1440 ? 1 : 0);
if (tooYoung.length > 0) {
  console.error(`${tooYoung.length} of ${added.length} new package versions are younger than ${days} days:`);
  for (const r of tooYoung) console.error(`  ${r.entry} (published ${new Date(r.published).toISOString()})`);
  process.exit(1);
}
console.log(`${added.length} new package versions since ${base}; all at least ${days} days old`);
```

## Step 2: verify: floor-blocks-normal-add

```bash
pnpm --filter @korbat/api add -E uqr@0.1.3 2>&1 | grep -E 'ERR_PNPM_NO_MATURE_MATCHING_VERSION|Done in' | head -1; git checkout -- apps/api/package.json pnpm-lock.yaml; git status --porcelain apps/api/package.json pnpm-lock.yaml | wc -l
```

Expected output contains:

- `ERR_PNPM_NO_MATURE_MATCHING_VERSION`
- `0`

Allowed difference: On or after 2026-09-19 every package locked before this task is older than 7 days, so the plain add can succeed and print `Done in` instead of `ERR_PNPM_NO_MATURE_MATCHING_VERSION`. That is allowed. The same command undoes the change with `git checkout`, and `0` must still print.

Observed on the dry run:

```text
ERR_PNPM_NO_MATURE_MATCHING_VERSION  Version 4.63.2 (released 2 days ago) of @rollup/rollup-linux-loong64-musl does not meet the minimumReleaseAge constraint
0
```

## Step 3: verify: add-runtime

```bash
pnpm --filter @korbat/api add -E --config.minimum-release-age=0 @node-rs/argon2@2.2.0 uqr@0.1.3 nodemailer@10.0.0
```

Expected output contains:

- `Done in`

Must not contain:

- `ERR_PNPM`

Observed on the dry run:

```text
Done in 7.9s using pnpm v10.30.0
```

## Step 4: verify: add-dev

```bash
pnpm --filter @korbat/api add -E -D --config.minimum-release-age=0 @types/nodemailer@6.4.24
```

Expected output contains:

- `Done in`

Must not contain:

- `ERR_PNPM`

Observed on the dry run:

```text
Done in 7.6s using pnpm v10.30.0
```

## Step 5: verify: lockfile-age

```bash
node scripts/check-lockfile-age.mjs --base HEAD
```

Expected output contains:

- `new package versions since HEAD; all at least 7 days old`

Allowed difference: The number of new package versions can differ slightly if a transitive dependency published a release after 2026-09-14. The line must still end with `all at least 7 days old`.

Observed on the dry run:

```text
17 new package versions since HEAD; all at least 7 days old
```

## Step 6: verify: floor-unchanged

```bash
grep -n 'minimumReleaseAge' pnpm-workspace.yaml && git diff --quiet -- pnpm-workspace.yaml .npmrc && echo 'supply-chain settings unchanged'
```

Expected output contains:

- `minimumReleaseAge: 10080`
- `supply-chain settings unchanged`

Observed on the dry run:

```text
6:minimumReleaseAge: 10080
supply-chain settings unchanged
```

## Step 7: verify: script-entry

```bash
cd apps/api && npm pkg set 'scripts.update:disposable=node scripts/update-disposable-domains.mjs' && node -e "const p=require('./package.json'); console.log(JSON.stringify({deps: p.dependencies, dev: p.devDependencies['@types/nodemailer'], script: p.scripts['update:disposable']}, null, 1))"
```

Expected output contains:

- `"@node-rs/argon2": "2.2.0"`
- `"uqr": "0.1.3"`
- `"nodemailer": "10.0.0"`
- `"dev": "6.4.24"`
- `node scripts/update-disposable-domains.mjs`

Must not contain:

- `@oslojs`

Observed on the dry run:

```text
"@node-rs/argon2": "2.2.0",
"nodemailer": "10.0.0",
"uqr": "0.1.3",
"dev": "6.4.24",
"script": "node scripts/update-disposable-domains.mjs"
```

## Step 8: verify: frozen-install

```bash
pnpm install --frozen-lockfile
```

Expected output contains:

- `Done in`

Must not contain:

- `ERR_PNPM`

Observed on the dry run:

```text
Done in 2.2s using pnpm v10.30.0
```

## Step 9: verify: native-argon2-loads

```bash
cd apps/api && node -e "import('@node-rs/argon2').then(async (a) => console.log('argon2 ok', (await a.hash('x', { memoryCost: 1024, timeCost: 1 })).slice(0, 10)))"
```

Expected output contains:

- `argon2 ok $argon2id$`

Observed on the dry run:

```text
argon2 ok $argon2id$
```

## Step 10: verify: test

```bash
pnpm --filter @korbat/api test
```

Expected output contains:

- `Tests  31 passed | 1 skipped (32)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  31 passed | 1 skipped (32)
```

## Step 11: verify: audit

```bash
pnpm audit --audit-level high; echo "audit exit: $?"
```

Expected output contains:

- `audit exit: 0`

Observed on the dry run:

```text
audit exit: 0
```

## Step 12: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/package.json`
- `pnpm-lock.yaml`
- `scripts/check-lockfile-age.mjs`

## Step 13: commit

```bash
git add -A
git commit -q -m "build(api): pin argon2, uqr and nodemailer for auth; check new lockfile entries against the release-age floor" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `build(api): pin argon2, uqr and nodemailer for auth; check new lockfile entries against the release-age floor`.

## Report format (mandatory)

```text
TASK 5 REPORT
Files written: <count, expected 1>
Verify "floor-blocks-normal-add": <paste the expected lines as printed>
Verify "add-runtime": <paste the expected lines as printed>
Verify "add-dev": <paste the expected lines as printed>
Verify "lockfile-age": <paste the expected lines as printed>
Verify "floor-unchanged": <paste the expected lines as printed>
Verify "script-entry": <paste the expected lines as printed>
Verify "frozen-install": <paste the expected lines as printed>
Verify "native-argon2-loads": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "audit": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
