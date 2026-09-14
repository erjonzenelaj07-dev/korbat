# korbat 1a — Task 8 of 21: Identifier hashes, handle rules, age check, device labels, disposable domains

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-14 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Small, pure building blocks the flows rely on: keyed hashes for device ids, IP addresses and emails (raw values are never stored), handle rules with a reserved list, the 16+ age check computed in UTC, coarse device labels from the User-Agent, and a disposable-email blocklist pinned to a CC0 source commit.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. Only the exact `pnpm add` commands printed below may change dependencies. Never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(auth): RFC 4648 base32, RFC 4226/6238 TOTP with replay protection, QR code, hashed recovery codes`.
3. The previous task's last API unit run ended with `Tests  48 passed | 1 skipped (49)`.

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

### Create `apps/api/test/auth/identifiers.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { deviceHash, emailHash, ipHash } from "../../src/auth/identifiers";

const key = Buffer.alloc(32, 1);

describe("identifier hashes", () => {
  test("are keyed, namespaced and stable", () => {
    expect(deviceHash(key, "abc")).toBe(deviceHash(key, "abc"));
    expect(deviceHash(key, "abc")).not.toBe(ipHash(key, "abc"));
    expect(deviceHash(Buffer.alloc(32, 2), "abc")).not.toBe(deviceHash(key, "abc"));
    expect(ipHash(key, "203.0.113.9")).toMatch(/^[0-9a-f]{64}$/);
  });
  test("email hashes ignore case and surrounding whitespace", () => {
    expect(emailHash(key, " Ada@Example.COM ")).toBe(emailHash(key, "ada@example.com"));
  });
});
```

### Create `apps/api/test/auth/policy.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { ageOn, meetsMinimumAge } from "../../src/auth/age";
import { deviceLabel } from "../../src/auth/devices";
import { DISPOSABLE_DOMAINS, DISPOSABLE_DOMAINS_SOURCE } from "../../src/auth/data/disposable-domains";
import { isDisposableEmail } from "../../src/auth/disposable";
import { checkHandle } from "../../src/auth/handles";

describe("handles", () => {
  test("3 to 20 of a-z, 0-9 and underscore", () => {
    expect(checkHandle("ada")).toBeNull();
    expect(checkHandle("ada_lovelace_1815")).toBeNull();
    expect(checkHandle("ab")).toBe("handle_invalid");
    expect(checkHandle("a".repeat(21))).toBe("handle_invalid");
    expect(checkHandle("Ada")).toBe("handle_invalid");
    expect(checkHandle("ada-l")).toBe("handle_invalid");
  });
  test("reserved names are refused", () => {
    for (const handle of ["admin", "korbat", "support", "moderator", "transparency"]) {
      expect(checkHandle(handle), handle).toBe("handle_reserved");
    }
  });
});

describe("minimum age", () => {
  const today = new Date("2026-09-14T10:00:00Z");
  test("turning 16 today is allowed, tomorrow is not", () => {
    expect(meetsMinimumAge("2010-09-14", today)).toBe(true);
    expect(meetsMinimumAge("2010-09-15", today)).toBe(false);
    expect(ageOn("2010-09-15", today)).toBe(15);
  });
  test("uses the date in UTC", () => {
    // 23:59 in UTC-5 on the 14th is already the 15th in UTC.
    expect(meetsMinimumAge("2010-09-15", new Date("2026-09-14T23:59:59-05:00"))).toBe(true);
  });
  test("a 29 February birthday counts from 1 March in common years", () => {
    expect(ageOn("2008-02-29", new Date("2025-02-28T12:00:00Z"))).toBe(16);
    expect(ageOn("2008-02-29", new Date("2025-03-01T12:00:00Z"))).toBe(17);
  });
  test("a date of birth in the future never passes", () => {
    expect(meetsMinimumAge("2030-01-01", today)).toBe(false);
  });
});

describe("device labels", () => {
  test("web labels are browser on OS", () => {
    const chromeWin = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";
    expect(deviceLabel(chromeWin, "web")).toBe("Chrome on Windows");
    expect(deviceLabel(`${chromeWin} Edg/139.0.0.0`, "web")).toBe("Edge on Windows");
    expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:142.0) Gecko/20100101 Firefox/142.0", "web")).toBe("Firefox on macOS");
    expect(
      deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1", "web"),
    ).toBe("Safari on iOS");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36", "web")).toBe(
      "Chrome on Android",
    );
    expect(deviceLabel(undefined, "web")).toBe("Browser on unknown OS");
  });
  test("native platforms get app labels", () => {
    expect(deviceLabel("okhttp/4.12", "android")).toBe("korbat for Android");
    expect(deviceLabel(undefined, "ios")).toBe("korbat for iOS");
  });
});

describe("disposable email domains", () => {
  test("listed domains and their subdomains are blocked, in any case", () => {
    expect(isDisposableEmail("x@mailinator.com")).toBe(true);
    expect(isDisposableEmail("x@eu.mailinator.com")).toBe(true);
    expect(isDisposableEmail("x@MAILINATOR.COM")).toBe(true);
  });
  test("ordinary domains pass and the list is a pinned snapshot", () => {
    expect(isDisposableEmail("ada@gmail.com")).toBe(false);
    expect(isDisposableEmail("ada@proton.me")).toBe(false);
    expect(DISPOSABLE_DOMAINS.length).toBeGreaterThan(1000);
    expect(DISPOSABLE_DOMAINS_SOURCE).toMatch(/^[0-9a-f]{40}$/);
  });
});
```

## Step 2: run the tests and watch them fail

```bash
pnpm --filter @korbat/api test
```

Expected: the command exits with an error, and the output contains:

- `Cannot find module '../../src/auth/identifiers'`

Observed on the dry run:

```text
Error: Cannot find module '../../src/auth/identifiers' imported from C:\Users\Lenovo\Desktop\cool\korbat/apps/api/test/auth/identifiers.test.ts
```

## Step 3: write the implementation

### Create `apps/api/src/auth/identifiers.ts`

```ts
import { hmacHex } from "./crypto";

/**
 * Keyed, namespaced hashes for identifiers the server must recognise but never store raw.
 * The namespace prefix keeps a device id, an IP and an email that happen to share text from
 * producing the same hash.
 */
export function deviceHash(key: Buffer, deviceId: string): string {
  return hmacHex(key, `device:${deviceId}`);
}

export function ipHash(key: Buffer, ip: string): string {
  return hmacHex(key, `ip:${ip}`);
}

export function emailHash(key: Buffer, email: string): string {
  return hmacHex(key, `email:${email.trim().toLowerCase()}`);
}
```

### Create `apps/api/src/auth/handles.ts`

```ts
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  "admin",
  "administrator",
  "korbat",
  "support",
  "help",
  "moderator",
  "mod",
  "staff",
  "security",
  "root",
  "system",
  "official",
  "api",
  "www",
  "about",
  "rules",
  "transparency",
  "settings",
]);

export type HandleError = "handle_invalid" | "handle_reserved";

/** Handles are 3-20 of a-z, 0-9 and underscore, and not reserved. Input is expected already lowercased. */
export function checkHandle(handle: string): HandleError | null {
  if (!/^[a-z0-9_]{3,20}$/.test(handle)) return "handle_invalid";
  if (RESERVED_HANDLES.has(handle)) return "handle_reserved";
  return null;
}
```

### Create `apps/api/src/auth/age.ts`

```ts
export const MINIMUM_AGE = 16;

/** Whole years between an ISO `YYYY-MM-DD` date of birth and today's date in UTC. */
export function ageOn(dateOfBirth: string, today: Date = new Date()): number {
  const [year, month, day] = dateOfBirth.split("-").map(Number) as [number, number, number];
  const todayYear = today.getUTCFullYear();
  const todayMonth = today.getUTCMonth() + 1;
  const todayDay = today.getUTCDate();
  let age = todayYear - year;
  if (todayMonth < month || (todayMonth === month && todayDay < day)) age -= 1;
  return age;
}

export function meetsMinimumAge(dateOfBirth: string, today: Date = new Date()): boolean {
  return ageOn(dateOfBirth, today) >= MINIMUM_AGE;
}
```

### Create `apps/api/src/auth/devices.ts`

```ts
import type { Platform } from "@korbat/contracts";

/**
 * Coarse, human-readable device label such as "Chrome on Windows". Deliberately limited to a
 * fixed set of names: it is shown to the account owner, never used for fingerprinting.
 */
export function deviceLabel(userAgent: string | undefined, platform: Platform): string {
  if (platform === "ios") return "korbat for iOS";
  if (platform === "android") return "korbat for Android";
  const ua = userAgent ?? "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Browser";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /iPhone|iPad/.test(ua)
      ? "iOS"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Android/.test(ua)
          ? "Android"
          : /Linux/.test(ua)
            ? "Linux"
            : "unknown OS";
  return `${browser} on ${os}`;
}
```

### Create `apps/api/src/auth/disposable.ts`

```ts
import { DISPOSABLE_DOMAINS } from "./data/disposable-domains";

const blocked: ReadonlySet<string> = new Set(DISPOSABLE_DOMAINS);

/** True when the email's domain, or any parent domain of it, is on the disposable list. */
export function isDisposableEmail(email: string): boolean {
  const domain = email.slice(email.lastIndexOf("@") + 1).trim().toLowerCase();
  const labels = domain.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    if (blocked.has(labels.slice(i).join("."))) return true;
  }
  return false;
}
```

### Create `apps/api/scripts/update-disposable-domains.mjs`

```js
#!/usr/bin/env node
/**
 * Regenerates src/auth/data/disposable-domains.ts from a pinned commit of the public-domain
 * (CC0-1.0) disposable-email-domains list. Pinning a commit keeps the output byte-identical
 * on every machine; move to a newer commit deliberately.
 *
 * Usage: node scripts/update-disposable-domains.mjs --ref <40-character commit sha>
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const refIndex = args.indexOf("--ref");
const ref = refIndex >= 0 ? args[refIndex + 1] : undefined;
if (!ref || !/^[0-9a-f]{40}$/.test(ref)) {
  console.error("usage: node scripts/update-disposable-domains.mjs --ref <40-character commit sha>");
  process.exit(1);
}

const url = `https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/${ref}/disposable_email_blocklist.conf`;
const res = await fetch(url);
if (!res.ok) {
  console.error(`download failed: HTTP ${res.status}`);
  process.exit(1);
}

const domains = [
  ...new Set(
    (await res.text())
      .split(/\r?\n/)
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line && !line.startsWith("#")),
  ),
].sort();

const unexpected = domains.filter((d) => !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d));
if (unexpected.length > 0) {
  console.error(`unexpected entries, refusing to write: ${unexpected.slice(0, 5).join(", ")}`);
  process.exit(1);
}

const output = [
  `// Generated by apps/api/scripts/update-disposable-domains.mjs from disposable-email-domains@${ref} (CC0-1.0).`,
  "// Do not edit by hand; rerun the script with a newer commit instead.",
  `export const DISPOSABLE_DOMAINS_SOURCE = "${ref}";`,
  "",
  "export const DISPOSABLE_DOMAINS: readonly string[] = [",
  ...domains.map((d) => `  "${d}",`),
  "];",
  "",
].join("\n");

const target = resolve(dirname(fileURLToPath(import.meta.url)), "../src/auth/data/disposable-domains.ts");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, output, "utf8");
console.log(`wrote ${domains.length} domains, sha256 ${createHash("sha256").update(output).digest("hex")}`);
```

## Step 4: verify: generate-domains

```bash
cd apps/api && pnpm update:disposable --ref 28bb67b2b6398e87d6f0ee5bf4f6096420d456ee && pnpm update:disposable --ref 28bb67b2b6398e87d6f0ee5bf4f6096420d456ee
```

Expected output contains:

- `wrote `
- `domains, sha256 `

Must not contain:

- `download failed`
- `unexpected entries`

Observed on the dry run:

```text
wrote 8833 domains, sha256 9eb8b00d8dfa45485276139cfb43a55398957b84746653d18d3c08e8ba4901dc
wrote 8833 domains, sha256 9eb8b00d8dfa45485276139cfb43a55398957b84746653d18d3c08e8ba4901dc
```

## Step 5: verify: deterministic

```bash
sha256sum apps/api/src/auth/data/disposable-domains.ts && head -3 apps/api/src/auth/data/disposable-domains.ts
```

Expected output contains:

- `DISPOSABLE_DOMAINS_SOURCE = "28bb67b2b6398e87d6f0ee5bf4f6096420d456ee"`

Observed on the dry run:

```text
export const DISPOSABLE_DOMAINS_SOURCE = "28bb67b2b6398e87d6f0ee5bf4f6096420d456ee";
```

## Step 6: verify: test

```bash
pnpm --filter @korbat/api test
```

Expected output contains:

- `Tests  60 passed | 1 skipped (61)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  60 passed | 1 skipped (61)
```

## Step 7: verify: typecheck

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

## Step 8: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/scripts/update-disposable-domains.mjs`
- `apps/api/src/auth/age.ts`
- `apps/api/src/auth/data/disposable-domains.ts`
- `apps/api/src/auth/devices.ts`
- `apps/api/src/auth/disposable.ts`
- `apps/api/src/auth/handles.ts`
- `apps/api/src/auth/identifiers.ts`
- `apps/api/test/auth/identifiers.test.ts`
- `apps/api/test/auth/policy.test.ts`

## Step 9: commit

```bash
git add -A
git commit -q -m "feat(auth): keyed identifier hashes, handle rules, 16+ age check, device labels, pinned disposable-domain list" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(auth): keyed identifier hashes, handle rules, 16+ age check, device labels, pinned disposable-domain list`.

## Report format (mandatory)

```text
TASK 8 REPORT
Files written: <count, expected 8>
Failing-test step (the error line): <paste>
Verify "generate-domains": <paste the expected lines as printed>
Verify "deterministic": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "typecheck": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
