# korbat 1a — Task 4 of 21: Auth crypto helpers

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-14 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

All auth cryptography goes through one small module built on `node:crypto`: random tokens, SHA-256, keyed HMAC, constant-time comparison, and AES-256-GCM with versioned keys so the TOTP key can rotate. Session tokens carry a `kb1_` prefix; the database only ever stores their SHA-256.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. Only the exact `pnpm add` commands printed below may change dependencies. Never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(api): validate auth secrets at startup; dev env generator`.
3. The previous task's last API unit run ended with `Tests  23 passed | 1 skipped (24)`.

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

### Create `apps/api/test/auth/crypto.test.ts`

```ts
import { createCipheriv, randomBytes } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  SESSION_TOKEN_PREFIX,
  decrypt,
  encrypt,
  hmacHex,
  newSessionToken,
  parseVersionedKey,
  randomToken,
  safeEqual,
  sha256Hex,
} from "../../src/auth/crypto";

const key = parseVersionedKey(`v1:${Buffer.alloc(32, 1).toString("base64")}`);

describe("crypto", () => {
  test("random tokens are 43 url-safe characters and unique", () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });
  test("sha256 and hmac match published test vectors", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    // RFC 4231, test case 2
    expect(hmacHex(Buffer.from("Jefe"), "what do ya want for nothing?")).toBe("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
  });
  test("safeEqual compares without throwing on a length mismatch", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
  test("versioned keys must be vN and exactly 32 bytes", () => {
    expect(key.version).toBe("v1");
    expect(() => parseVersionedKey(Buffer.alloc(32).toString("base64"))).toThrow(/versioned/);
    expect(() => parseVersionedKey(`v1:${Buffer.alloc(16).toString("base64")}`)).toThrow(/32 bytes/);
  });
  test("AES-GCM round trip uses a fresh IV each time", () => {
    const plain = Buffer.from("totp secret bytes");
    const a = encrypt(plain, key);
    const b = encrypt(plain, key);
    expect(a).toMatch(/^v1:/);
    expect(a).not.toBe(b);
    expect(decrypt(a, [key]).equals(plain)).toBe(true);
  });
  test("tampered ciphertext, unknown key versions and garbage are rejected", () => {
    const payload = encrypt(Buffer.from("secret"), key);
    const raw = Buffer.from(payload.slice(3), "base64");
    raw.writeUInt8(raw.readUInt8(raw.length - 1) ^ 0xff, raw.length - 1);
    expect(() => decrypt(`v1:${raw.toString("base64")}`, [key])).toThrow();
    expect(() => decrypt(payload.replace(/^v1:/, "v2:"), [key])).toThrow(/no key/);
    expect(() => decrypt("garbage", [key])).toThrow(/malformed/);
  });
  test("only the full 16-byte GCM tag is accepted", () => {
    // A ciphertext made with a 4-byte tag, laid out as iv | tag | ciphertext.
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key.key, iv, { authTagLength: 4 });
    const body = Buffer.concat([cipher.update(Buffer.from("a forged totp secret")), cipher.final()]);
    const shortTag = Buffer.concat([iv, cipher.getAuthTag(), body]);
    expect(() => decrypt(`v1:${shortTag.toString("base64")}`, [key])).toThrow();
    // Too short to hold an IV, a full tag and at least one byte of ciphertext.
    expect(() => decrypt(`v1:${Buffer.alloc(28).toString("base64")}`, [key])).toThrow(/malformed/);
  });
  test("session tokens carry the kb1_ prefix and are stored as their sha256", () => {
    const { token, id } = newSessionToken();
    expect(token.startsWith(SESSION_TOKEN_PREFIX)).toBe(true);
    expect(token).toHaveLength(47);
    expect(id).toBe(sha256Hex(token));
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

## Step 2: run the tests and watch them fail

```bash
pnpm --filter @korbat/api test
```

Expected: the command exits with an error, and the output contains:

- `Cannot find module '../../src/auth/crypto'`

Observed on the dry run:

```text
Error: Cannot find module '../../src/auth/crypto' imported from C:\Users\Lenovo\Desktop\cool\korbat/apps/api/test/auth/crypto.test.ts
```

## Step 3: write the implementation

### Create `apps/api/src/auth/crypto.ts`

```ts
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_TOKEN_PREFIX = "kb1_";

/** Random bytes as base64url without padding. 32 bytes gives 43 characters. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hmacHex(key: Buffer, input: string): string {
  return createHmac("sha256", key).update(input).digest("hex");
}

/** Constant-time string comparison that does not throw when lengths differ. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function decodeKey(base64: string): Buffer {
  return Buffer.from(base64, "base64");
}

export interface VersionedKey {
  version: string;
  key: Buffer;
}

/** Parses `v<N>:<base64 of 32 bytes>`. */
export function parseVersionedKey(value: string): VersionedKey {
  const m = /^(v\d+):(.+)$/.exec(value);
  if (!m) throw new Error("encryption key must be versioned, e.g. v1:<base64>");
  const key = Buffer.from(m[2]!, "base64");
  if (key.length !== 32) throw new Error("encryption key must be exactly 32 bytes");
  return { version: m[1]!, key };
}

const IV_BYTES = 12;
/** The full GCM tag. Pinned on both sides so a forged, shorter tag can never be accepted. */
const TAG_BYTES = 16;

/** AES-256-GCM. Output: `<version>:<base64(iv[12] | tag[16] | ciphertext)>`. */
export function encrypt(plain: Buffer, k: VersionedKey): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", k.key, iv, { authTagLength: TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${k.version}:${Buffer.concat([iv, tag, ciphertext]).toString("base64")}`;
}

export function decrypt(payload: string, keys: VersionedKey[]): Buffer {
  const m = /^(v\d+):(.+)$/.exec(payload);
  if (!m) throw new Error("malformed ciphertext");
  const k = keys.find((x) => x.version === m[1]);
  if (!k) throw new Error(`no key for version ${m[1]}`);
  const raw = Buffer.from(m[2]!, "base64");
  if (raw.length < IV_BYTES + TAG_BYTES + 1) throw new Error("malformed ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", k.key, raw.subarray(0, IV_BYTES), { authTagLength: TAG_BYTES });
  decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
}

/** A session token for the client and the id stored in auth.sessions (its sha256). */
export function newSessionToken(): { token: string; id: string } {
  const token = SESSION_TOKEN_PREFIX + randomToken(32);
  return { token, id: sha256Hex(token) };
}
```

## Step 4: verify: test

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

- `apps/api/src/auth/crypto.ts`
- `apps/api/test/auth/crypto.test.ts`

## Step 7: commit

```bash
git add -A
git commit -q -m "feat(auth): tokens, hashing, constant-time compare, versioned AES-256-GCM" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(auth): tokens, hashing, constant-time compare, versioned AES-256-GCM`.

## Report format (mandatory)

```text
TASK 4 REPORT
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
