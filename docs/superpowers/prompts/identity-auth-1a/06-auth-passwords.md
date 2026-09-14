# korbat 1a — Task 6 of 21: Passwords: argon2id and the breached-password check

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-14 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Passwords are optional. When set they are 12 to 128 characters, hashed with argon2id (64 MiB, 3 passes), and checked against Have I Been Pwned with k-anonymity: only a 5-character SHA-1 prefix leaves the server, and an unavailable check fails closed. Unknown accounts still run a full verification against a dummy hash, so timing does not reveal which emails exist.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. Only the exact `pnpm add` commands printed below may change dependencies. Never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `build(api): pin argon2, uqr and nodemailer for auth; check new lockfile entries against the release-age floor`.
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

## Step 1: write the tests

### Create `apps/api/test/auth/passwords.test.ts`

```ts
import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { BreachCheckUnavailable, checkPasswordLength, hashPassword, hibpChecker, needsRehash, verifyPassword } from "../../src/auth/passwords";

const password = "correct horse battery staple";
const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();

function fakeFetch(handler: () => Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return handler();
  }) as typeof fetch;
  return { fn, calls };
}

describe("password rules", () => {
  test("length is counted in characters, 12 to 128", () => {
    expect(checkPasswordLength("a".repeat(11))).toBe("password_too_short");
    expect(checkPasswordLength("a".repeat(12))).toBeNull();
    expect(checkPasswordLength("\u{1F642}".repeat(12))).toBeNull();
    expect(checkPasswordLength("a".repeat(129))).toBe("password_too_long");
  });
});

describe("argon2id", () => {
  test("hashes use argon2id with the configured cost and verify", async () => {
    const stored = await hashPassword(password);
    expect(stored).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
    expect(await verifyPassword(stored, password)).toBe(true);
    expect(await verifyPassword(stored, "wrong password entirely")).toBe(false);
    expect(needsRehash(stored)).toBe(false);
    expect(needsRehash("$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA")).toBe(true);
  });
  test("an account without a password never verifies", async () => {
    expect(await verifyPassword(null, password)).toBe(false);
  });
});

describe("breached password check", () => {
  test("sends only the 5-character prefix, with padding, and finds the suffix", async () => {
    const { fn, calls } = fakeFetch(() => new Response(`0000000000000000000000000000000000A:0\r\n${sha1.slice(5)}:42\r\n`));
    expect(await hibpChecker(fn).isBreached(password)).toBe(true);
    expect(calls[0]!.url).toBe(`https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`);
    expect(calls[0]!.url).not.toContain(sha1.slice(5));
    expect(new Headers(calls[0]!.init?.headers).get("add-padding")).toBe("true");
  });
  test("padding entries with a count of 0 are not breaches", async () => {
    const { fn } = fakeFetch(() => new Response(`${sha1.slice(5)}:0\r\n`));
    expect(await hibpChecker(fn).isBreached(password)).toBe(false);
  });
  test("network errors and non-200 responses make the check unavailable", async () => {
    const offline = fakeFetch(() => {
      throw new Error("offline");
    });
    await expect(hibpChecker(offline.fn).isBreached(password)).rejects.toBeInstanceOf(BreachCheckUnavailable);
    const down = fakeFetch(() => new Response("", { status: 503 }));
    await expect(hibpChecker(down.fn).isBreached(password)).rejects.toBeInstanceOf(BreachCheckUnavailable);
  });
});
```

## Step 2: run the tests and watch them fail

```bash
pnpm --filter @korbat/api test
```

Expected: the command exits with an error, and the output contains:

- `Cannot find module '../../src/auth/passwords'`

Observed on the dry run:

```text
Error: Cannot find module '../../src/auth/passwords' imported from C:\Users\Lenovo\Desktop\cool\korbat/apps/api/test/auth/passwords.test.ts
```

## Step 3: write the implementation

### Create `apps/api/src/auth/passwords.ts`

```ts
import { createHash } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

/** argon2id (the library default) with 64 MiB, 3 passes, 1 lane, 32-byte output. */
export const ARGON2_OPTIONS = { memoryCost: 65536, timeCost: 3, parallelism: 1, outputLen: 32 } as const;

export type PasswordLengthError = "password_too_short" | "password_too_long";

/** Length counted in Unicode code points, not UTF-16 units. */
export function checkPasswordLength(password: string): PasswordLengthError | null {
  const length = [...password].length;
  if (length < PASSWORD_MIN) return "password_too_short";
  if (length > PASSWORD_MAX) return "password_too_long";
  return null;
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

let dummyHash: Promise<string> | undefined;

/**
 * Always runs a full argon2id verification. When the account has no password (or does not exist)
 * it verifies against a fixed dummy hash, so response timing does not reveal which case applies.
 */
export async function verifyPassword(stored: string | null, password: string): Promise<boolean> {
  dummyHash ??= hash("korbat-timing-equaliser-not-a-password", ARGON2_OPTIONS);
  const target = stored ?? (await dummyHash);
  const ok = await verify(target, password);
  return stored !== null && ok;
}

/** True when a stored hash was made with weaker parameters than ARGON2_OPTIONS. */
export function needsRehash(stored: string): boolean {
  const { memoryCost, timeCost, parallelism } = ARGON2_OPTIONS;
  return !stored.startsWith(`$argon2id$v=19$m=${memoryCost},t=${timeCost},p=${parallelism}$`);
}

export class BreachCheckUnavailable extends Error {}

export interface BreachChecker {
  /** Resolves true when the password appears in a known breach. Throws BreachCheckUnavailable when the check cannot run. */
  isBreached(password: string): Promise<boolean>;
}

/**
 * Have I Been Pwned range API (k-anonymity): only the first 5 hex characters of the SHA-1 leave
 * the server, and padding hides the real number of matches.
 */
export function hibpChecker(fetchFn: typeof fetch = fetch, timeoutMs = 3000): BreachChecker {
  return {
    async isBreached(password) {
      const sha1 = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
      const prefix = sha1.slice(0, 5);
      const suffix = sha1.slice(5);
      let res: Response;
      try {
        res = await fetchFn(`https://api.pwnedpasswords.com/range/${prefix}`, {
          headers: { "Add-Padding": "true", "User-Agent": "korbat-auth" },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        throw new BreachCheckUnavailable("breach check request failed", { cause: err });
      }
      if (!res.ok) throw new BreachCheckUnavailable(`breach check returned ${res.status}`);
      for (const line of (await res.text()).split(/\r?\n/)) {
        const [candidate, count] = line.split(":");
        if (candidate === suffix && Number(count) > 0) return true;
      }
      return false;
    },
  };
}
```

## Step 4: verify: test

```bash
pnpm --filter @korbat/api test
```

Expected output contains:

- `Tests  37 passed | 1 skipped (38)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  37 passed | 1 skipped (38)
```

## Step 5: verify: typecheck

```bash
pnpm --filter @korbat/api typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`

Observed on the dry run:

```text
(no output)
```

## Step 6: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/auth/passwords.ts`
- `apps/api/test/auth/passwords.test.ts`

## Step 7: commit

```bash
git add -A
git commit -q -m "feat(auth): argon2id password hashing, timing-safe verify, k-anonymity breach check" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(auth): argon2id password hashing, timing-safe verify, k-anonymity breach check`.

## Report format (mandatory)

```text
TASK 6 REPORT
Files written: <count, expected 2>
Failing-test step (the error line): <paste>
Verify "test": <paste the expected lines as printed>
Verify "typecheck": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
