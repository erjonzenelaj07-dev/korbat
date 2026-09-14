# korbat 1a — Task 7 of 21: Base32, TOTP and recovery codes

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-14 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

TOTP two-factor is implemented on `node:crypto` (RFC 4226 and RFC 6238) because the usual TypeScript library scope is marked unsupported on npm. This task adds base32, HOTP/TOTP with a one-step window and replay protection by step number, `otpauth://` URIs, server-side QR codes as SVG, and ten single-use recovery codes stored as keyed hashes.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. Only the exact `pnpm add` commands printed below may change dependencies. Never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(auth): argon2id password hashing, timing-safe verify, k-anonymity breach check`.
3. The previous task's last API unit run ended with `Tests  37 passed | 1 skipped (38)`.

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

### Create `apps/api/test/auth/base32.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { base32Encode } from "../../src/auth/base32";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("base32", () => {
  test("matches the RFC 4648 section 10 test vectors (lowercase, no padding)", () => {
    expect(base32Encode(bytes(""))).toBe("");
    expect(base32Encode(bytes("f"))).toBe("my");
    expect(base32Encode(bytes("fo"))).toBe("mzxq");
    expect(base32Encode(bytes("foo"))).toBe("mzxw6");
    expect(base32Encode(bytes("foob"))).toBe("mzxw6yq");
    expect(base32Encode(bytes("fooba"))).toBe("mzxw6ytb");
    expect(base32Encode(bytes("foobar"))).toBe("mzxw6ytboi");
  });
  test("20 bytes encode to 32 characters from the base32 alphabet", () => {
    const out = base32Encode(new Uint8Array(20).fill(255));
    expect(out).toHaveLength(32);
    expect(out).toMatch(/^[a-z2-7]+$/);
  });
});
```

### Create `apps/api/test/auth/totp.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { currentStep, hotp, newTotpSecret, totpQrSvg, totpUri, verifyTotp } from "../../src/auth/totp";

// RFC 4226 appendix D and RFC 6238 appendix B both use the ASCII secret "12345678901234567890".
// A 6-digit TOTP is the last 6 digits of the published 8-digit value.
const rfcSecret = new TextEncoder().encode("12345678901234567890");
const t = 1_111_111_109_000; // RFC 6238 published value 07081804

describe("hotp", () => {
  test("matches the RFC 4226 test vectors for counters 0 to 9", () => {
    const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
    expected.forEach((value, counter) => expect(hotp(rfcSecret, counter), `counter ${counter}`).toBe(value));
  });
});

describe("totp", () => {
  test("matches the RFC 6238 test vectors", () => {
    expect(verifyTotp(rfcSecret, "287082", null, 59_000)).toBe(1);
    expect(verifyTotp(rfcSecret, "081804", null, t)).toBe(currentStep(t));
  });
  test("accepts one step either side and nothing further", () => {
    expect(verifyTotp(rfcSecret, "081804", null, t + 30_000)).toBe(currentStep(t));
    expect(verifyTotp(rfcSecret, "081804", null, t - 30_000)).toBe(currentStep(t));
    expect(verifyTotp(rfcSecret, "081804", null, t + 60_000)).toBeNull();
  });
  test("a code for a step at or before the last accepted step is rejected", () => {
    const step = currentStep(t);
    expect(verifyTotp(rfcSecret, "081804", step, t)).toBeNull();
    expect(verifyTotp(rfcSecret, "081804", step - 1, t)).toBe(step);
  });
  test("malformed codes are rejected", () => {
    expect(verifyTotp(rfcSecret, "08180", null, t)).toBeNull();
    expect(verifyTotp(rfcSecret, "abcdef", null, t)).toBeNull();
  });
  test("new secrets are 20 bytes and render an otpauth URI and an SVG QR code", () => {
    const secret = newTotpSecret();
    expect(secret).toHaveLength(20);
    const uri = totpUri(secret, "ada");
    expect(uri).toMatch(/^otpauth:\/\/totp\/korbat:ada\?secret=[A-Z2-7]{32}&/);
    expect(uri).toContain("issuer=korbat");
    expect(uri).toContain("algorithm=SHA1");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
    expect(totpQrSvg(uri).startsWith("<svg")).toBe(true);
  });
});
```

### Create `apps/api/test/auth/recovery-codes.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { consumeRecoveryCode, hashRecoveryCode, newRecoveryCodes } from "../../src/auth/recovery-codes";

const key = Buffer.alloc(32, 9);

describe("recovery codes", () => {
  test("ten unique codes shaped xxxx-xxxx-xxxx in lowercase base32", () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[a-z2-7]{4}-[a-z2-7]{4}-[a-z2-7]{4}$/);
  });
  test("codes are stored as keyed hashes that ignore case", () => {
    const code = newRecoveryCodes()[0]!;
    expect(hashRecoveryCode(key, code)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRecoveryCode(key, code)).not.toBe(hashRecoveryCode(Buffer.alloc(32, 8), code));
    expect(hashRecoveryCode(key, code.toUpperCase())).toBe(hashRecoveryCode(key, code));
  });
  test("consuming a code removes exactly that code and it cannot be reused", () => {
    const codes = newRecoveryCodes();
    const hashes = codes.map((c) => hashRecoveryCode(key, c));
    const left = consumeRecoveryCode(key, hashes, codes[3]!);
    expect(left).toHaveLength(9);
    expect(consumeRecoveryCode(key, left!, codes[3]!)).toBeNull();
    expect(consumeRecoveryCode(key, hashes, "aaaa-aaaa-aaaa")).toBeNull();
  });
});
```

## Step 2: run the tests and watch them fail

```bash
pnpm --filter @korbat/api test
```

Expected: the command exits with an error, and the output contains:

- `Cannot find module '../../src/auth/base32'`
- `Cannot find module '../../src/auth/totp'`
- `Cannot find module '../../src/auth/recovery-codes'`

Observed on the dry run:

```text
Error: Cannot find module '../../src/auth/base32' imported from C:\Users\Lenovo\Desktop\cool\korbat/apps/api/test/auth/base32.test.ts
Error: Cannot find module '../../src/auth/recovery-codes' imported from C:\Users\Lenovo\Desktop\cool\korbat/apps/api/test/auth/recovery-codes.test.ts
Error: Cannot find module '../../src/auth/totp' imported from C:\Users\Lenovo\Desktop\cool\korbat/apps/api/test/auth/totp.test.ts
```

## Step 3: write the implementation

### Create `apps/api/src/auth/base32.ts`

```ts
const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

/** RFC 4648 base32, lowercase, without padding. Used for TOTP secrets and recovery codes. */
export function base32Encode(bytes: Uint8Array): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET.charAt((buffer >>> (bits - 5)) & 31);
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET.charAt((buffer << (5 - bits)) & 31);
  return out;
}
```

### Create `apps/api/src/auth/totp.ts`

```ts
import { createHmac, randomBytes } from "node:crypto";
import { renderSVG } from "uqr";
import { base32Encode } from "./base32";
import { safeEqual } from "./crypto";

export const TOTP_ISSUER = "korbat";
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;

/** 160-bit secret, the size RFC 4226 recommends for HMAC-SHA1. */
export function newTotpSecret(): Uint8Array {
  return new Uint8Array(randomBytes(20));
}

/** RFC 4226 HOTP: HMAC-SHA1 over the 8-byte big-endian counter, dynamic truncation, decimal digits. */
export function hotp(secret: Uint8Array, counter: number, digits: number = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", secret).update(message).digest();
  const offset = mac.readUInt8(mac.length - 1) & 0x0f;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function totpUri(secret: Uint8Array, accountName: string): string {
  const label = `${encodeURIComponent(TOTP_ISSUER)}:${encodeURIComponent(accountName)}`;
  const params = new URLSearchParams({
    secret: base32Encode(secret).toUpperCase(),
    issuer: TOTP_ISSUER,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export function totpQrSvg(uri: string): string {
  return renderSVG(uri, { ecc: "M", border: 2 });
}

export function currentStep(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

/**
 * RFC 6238 TOTP check. Returns the time step the code was accepted for, or null.
 * Accepts the previous, current and next step, but only a step later than `lastStep`, so a code
 * cannot be used twice. All three candidates are always computed to keep timing uniform.
 */
export function verifyTotp(secret: Uint8Array, code: string, lastStep: number | null, nowMs: number = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = currentStep(nowMs);
  let accepted: number | null = null;
  for (const step of [now - 1, now, now + 1]) {
    const matches = safeEqual(hotp(secret, step), code);
    if (matches && accepted === null && (lastStep === null || step > lastStep)) accepted = step;
  }
  return accepted;
}
```

### Create `apps/api/src/auth/recovery-codes.ts`

```ts
import { randomBytes } from "node:crypto";
import { base32Encode } from "./base32";
import { hmacHex, safeEqual } from "./crypto";

export const RECOVERY_CODE_COUNT = 10;

/** Ten codes shaped `xxxx-xxxx-xxxx`, 60 random bits each, lowercase base32 (a-z, 2-7). */
export function newRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const s = base32Encode(randomBytes(8)).slice(0, 12);
    return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
  });
}

export function hashRecoveryCode(key: Buffer, code: string): string {
  return hmacHex(key, `recovery:${code.trim().toLowerCase()}`);
}

/** Returns the remaining hashes when the code matches one of them, otherwise null. */
export function consumeRecoveryCode(key: Buffer, hashes: readonly string[], code: string): string[] | null {
  const candidate = hashRecoveryCode(key, code);
  let index = -1;
  hashes.forEach((h, i) => {
    if (safeEqual(h, candidate) && index === -1) index = i;
  });
  if (index === -1) return null;
  return hashes.filter((_, i) => i !== index);
}
```

## Step 4: verify: test

```bash
pnpm --filter @korbat/api test
```

Expected output contains:

- `Tests  48 passed | 1 skipped (49)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  48 passed | 1 skipped (49)
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

- `apps/api/src/auth/base32.ts`
- `apps/api/src/auth/recovery-codes.ts`
- `apps/api/src/auth/totp.ts`
- `apps/api/test/auth/base32.test.ts`
- `apps/api/test/auth/recovery-codes.test.ts`
- `apps/api/test/auth/totp.test.ts`

## Step 7: commit

```bash
git add -A
git commit -q -m "feat(auth): RFC 4648 base32, RFC 4226/6238 TOTP with replay protection, QR code, hashed recovery codes" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(auth): RFC 4648 base32, RFC 4226/6238 TOTP with replay protection, QR code, hashed recovery codes`.

## Report format (mandatory)

```text
TASK 7 REPORT
Files written: <count, expected 6>
Failing-test step (the error line): <paste>
Verify "test": <paste the expected lines as printed>
Verify "typecheck": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
