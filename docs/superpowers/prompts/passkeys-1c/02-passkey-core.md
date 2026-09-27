# korbat passkeys (1c) — Task 2 of 9: The passkey core: stateless HMAC-sealed challenges spent once through the key-value store, one wrapper around SimpleWebAuthn 14 with korbat's own checks (the attestation format, the pinned algorithms, the credential id length, the transports, the counter rule kept out of the library), and a software authenticator for the tests

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-25 to 2026-09-27 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

This task builds the passkey core every later task uses: the stateless challenge (58 HMAC-sealed bytes carrying a version, the ceremony's purpose, an expiry, a nonce and a binding to the session's handle, spent once through the key-value store), the one wrapper around SimpleWebAuthn 14 that pins korbat's settings and runs its own checks (the attestation format before the library sees a response, the algorithms, the credential id's length, known transports, the counter rule left to the flows), and a software authenticator that lets the unit tests run whole ceremonies without a browser. Nothing imports the core yet; the flows come in Tasks 4 and 5.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(contracts,db,api): the ground for passkeys: @simplewebauthn/server 14.0.2 and @simplewebauthn/browser 14.0.0 installed under the release-age floor; passkey contracts and error codes; migration 0010 with the WebAuthn user handle, the passkey flags and provenance, the session handle, factors and passkey id, and three event types; WEBAUTHN_RP_ID and WEBAUTHN_RP_NAME with production guards; the passkey_added, passkey_removed and passkey_suspect mails`.

## Rules (read twice)

1. Never type a file's content. Every step that writes files starts with a `write_blocks.py` command that copies that step's blocks from this prompt file to disk byte for byte; run it exactly as given and check that it names every file of the step. The blocks are shown below it so you can read what was written. Paths with parentheses or square brackets (expo-router routes) are literal; quote them in shell commands.
2. Run every command exactly as written, in order, from the repo root, without adding filters such as `tail` or `head`.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the tests

```bash
python docs/superpowers/prompts/passkeys-1c/write_blocks.py docs/superpowers/prompts/passkeys-1c/02-passkey-core.md 1
```

Expected: 4 lines starting with `wrote`, one for each file below.

### Create `apps/api/test/auth/passkey-challenge.test.ts`

```ts
import { createHash, createHmac, hkdfSync } from "node:crypto";
import { describe, expect, test } from "vitest";
import { AuthError } from "../../src/auth/context";
import { sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { HOUR, MINUTE } from "../../src/auth/limits";
import { CHALLENGE_TTL_MS, challengeKey, issueChallenge, readChallenge, spendChallenge, type ChallengePurpose } from "../../src/auth/passkeys/challenge";

const AUTH_HMAC_KEY = Buffer.alloc(32, 3);
const KEY = challengeKey(AUTH_HMAC_KEY);
const T0 = 1_789_000_000_000;
const at = (ms: number) => new Date(T0 + ms);
const HANDLE = "0b7f3c4e-2a51-4c8e-9d7a-5b1e6f2c3d4a";
const OTHER_HANDLE = "7e2d9a10-6c3b-4f5e-8a21-0d4c7b9e1f36";
const PURPOSES: ChallengePurpose[] = ["signin", "register", "reauth"];
const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const bytesOf = (challenge: string) => Buffer.from(challenge, "base64url");
const mac = (first42: Buffer) => createHmac("sha256", KEY).update(first42).digest().subarray(0, 16);
/** Seals 42 bytes as the codec does, so a test can build a challenge whose MAC holds while a field inside it is wrong. */
const sealed = (first42: Buffer) => Buffer.concat([first42, mac(first42)]).toString("base64url");
const spentKey = (challenge: string) => `webauthn-used:${sha256Hex(challenge)}`;

/** The AuthError a synchronous call throws; anything else fails the test. */
function refusal(read: () => unknown): AuthError {
  try {
    read();
  } catch (err) {
    if (err instanceof AuthError) return err;
    throw err;
  }
  throw new Error("expected the challenge to be refused");
}

/** The AuthError a promise rejects with; anything else fails the test. */
async function failure(promise: Promise<unknown>): Promise<AuthError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AuthError) return err;
    throw err;
  }
  throw new Error("expected the challenge to be refused");
}

function expectInvalid(read: () => unknown) {
  const err = refusal(read);
  expect([err.code, err.status]).toEqual(["passkey_invalid", 401]);
}

describe("passkey challenges: the key", () => {
  test("is HKDF-SHA256 of AUTH_HMAC_KEY with an empty salt and the korbat-webauthn-challenge label, derived once per key", () => {
    expect(KEY.equals(Buffer.from(hkdfSync("sha256", AUTH_HMAC_KEY, "", "korbat-webauthn-challenge", 32)))).toBe(true);
    expect(KEY).toHaveLength(32);
    expect(KEY.equals(AUTH_HMAC_KEY)).toBe(false);
    // The same buffer comes back, so the flows can ask for it on every request without deriving it again.
    expect(challengeKey(AUTH_HMAC_KEY)).toBe(KEY);
    expect(challengeKey(Buffer.alloc(32, 4)).equals(KEY)).toBe(false);
  });
});

describe("passkey challenges: issuing and reading", () => {
  test("lays out 58 bytes: version, purpose, expiry, nonce, binding and an HMAC over the first 42, as unpadded base64url", () => {
    const cases: [ChallengePurpose, number, string | undefined][] = [
      ["signin", 1, undefined],
      ["register", 2, HANDLE],
      ["reauth", 3, HANDLE],
    ];
    for (const [purpose, code, bind] of cases) {
      const challenge = issueChallenge(KEY, purpose, at(0), bind);
      expect(challenge).toMatch(/^[A-Za-z0-9_-]{78}$/);
      const bytes = bytesOf(challenge);
      expect(bytes).toHaveLength(58);
      expect(bytes[0]).toBe(1);
      expect(bytes[1]).toBe(code);
      expect(Number(bytes.readBigUInt64BE(2))).toBe(T0 + 10 * MINUTE);
      const binding = bind === undefined ? Buffer.alloc(16) : createHash("sha256").update(bind).digest().subarray(0, 16);
      expect(bytes.subarray(26, 42).equals(binding)).toBe(true);
      expect(bytes.subarray(42).equals(mac(bytes.subarray(0, 42)))).toBe(true);
      expect(() => readChallenge(KEY, challenge, purpose, at(0), bind)).not.toThrow();
    }
    expect(CHALLENGE_TTL_MS).toBe(10 * MINUTE);
  });

  test("draws a fresh 16-byte nonce for every challenge", () => {
    const a = bytesOf(issueChallenge(KEY, "signin", at(0)));
    const b = bytesOf(issueChallenge(KEY, "signin", at(0)));
    expect(a.subarray(0, 10).equals(b.subarray(0, 10))).toBe(true);
    expect(a.subarray(10, 26).equals(b.subarray(10, 26))).toBe(false);
    expect(a.subarray(26, 42).equals(b.subarray(26, 42))).toBe(true);
  });

  test("refuses every tampered byte, the expiry and the MAC included, as passkey_invalid", () => {
    const challenge = issueChallenge(KEY, "reauth", at(0), HANDLE);
    for (let i = 0; i < 58; i++) {
      const bytes = bytesOf(challenge);
      bytes[i] = bytes[i]! ^ 0x01;
      expectInvalid(() => readChallenge(KEY, bytes.toString("base64url"), "reauth", at(0), HANDLE));
    }
  });

  test("refuses a challenge sealed with another key", () => {
    const foreign = issueChallenge(challengeKey(Buffer.alloc(32, 4)), "signin", at(0));
    expectInvalid(() => readChallenge(KEY, foreign, "signin", at(0)));
  });

  test("refuses anything that is not exactly 58 bytes of canonical, unpadded base64url", () => {
    const challenge = issueChallenge(KEY, "signin", at(0));
    const bytes = bytesOf(challenge);
    // Node's decoder ignores the 4 spare bits of the last character: this other string names the very same 58 bytes.
    const last = BASE64URL_ALPHABET.indexOf(challenge.at(-1)!);
    const nonCanonical = challenge.slice(0, -1) + BASE64URL_ALPHABET[last | 1];
    expect(nonCanonical).not.toBe(challenge);
    expect(bytesOf(nonCanonical).equals(bytes)).toBe(true);
    const malformed = [
      "",
      bytes.subarray(0, 57).toString("base64url"),
      Buffer.concat([bytes, Buffer.from([0])]).toString("base64url"),
      `${challenge}==`,
      bytes.toString("base64"),
      `+${challenge.slice(1)}`,
      ` ${challenge.slice(1)}`,
      nonCanonical,
      "A".repeat(10_000),
    ];
    for (const candidate of malformed) expectInvalid(() => readChallenge(KEY, candidate, "signin", at(0)));
  });

  test("refuses a sealed challenge of another version or with an unknown purpose byte", () => {
    const first42 = bytesOf(issueChallenge(KEY, "signin", at(0))).subarray(0, 42);
    const version2 = Buffer.from(first42);
    version2[0] = 2;
    expectInvalid(() => readChallenge(KEY, sealed(version2), "signin", at(0)));
    for (const purpose of [0, 4, 255]) {
      const unknown = Buffer.from(first42);
      unknown[1] = purpose;
      expectInvalid(() => readChallenge(KEY, sealed(unknown), "signin", at(0)));
    }
    // The helper seals exactly as the codec does: with the right fields its output reads.
    expect(() => readChallenge(KEY, sealed(Buffer.from(first42)), "signin", at(0))).not.toThrow();
  });

  test("refuses a challenge issued for another purpose", () => {
    for (const issued of PURPOSES) {
      const bind = issued === "signin" ? undefined : HANDLE;
      const challenge = issueChallenge(KEY, issued, at(0), bind);
      for (const expected of PURPOSES.filter((p) => p !== issued)) expectInvalid(() => readChallenge(KEY, challenge, expected, at(0), bind));
    }
  });

  test("refuses a challenge bound to another session's handle, and a bound one where none is expected", () => {
    const challenge = issueChallenge(KEY, "reauth", at(0), HANDLE);
    expectInvalid(() => readChallenge(KEY, challenge, "reauth", at(0), OTHER_HANDLE));
    expectInvalid(() => readChallenge(KEY, challenge, "reauth", at(0)));
    expect(() => readChallenge(KEY, challenge, "reauth", at(0), HANDLE)).not.toThrow();
  });

  test("refuses a sign-in challenge, whose binding is zeros, where a binding is expected", () => {
    const signin = issueChallenge(KEY, "signin", at(0));
    expectInvalid(() => readChallenge(KEY, signin, "signin", at(0), HANDLE));
    expectInvalid(() => readChallenge(KEY, signin, "reauth", at(0), HANDLE));
    expectInvalid(() => readChallenge(KEY, signin, "register", at(0), HANDLE));
    // An unbound challenge of the right purpose is refused on its binding alone.
    const unbound = issueChallenge(KEY, "register", at(0));
    expectInvalid(() => readChallenge(KEY, unbound, "register", at(0), HANDLE));
  });

  test("expires exactly ten minutes after it was issued, as challenge_expired", () => {
    const challenge = issueChallenge(KEY, "register", at(0), HANDLE);
    expect(() => readChallenge(KEY, challenge, "register", at(CHALLENGE_TTL_MS - 1), HANDLE)).not.toThrow();
    for (const when of [CHALLENGE_TTL_MS, CHALLENGE_TTL_MS + 1, HOUR]) {
      const err = refusal(() => readChallenge(KEY, challenge, "register", at(when), HANDLE));
      expect([err.code, err.status]).toEqual(["challenge_expired", 400]);
    }
  });

  test("checks the seal, the purpose and the binding before the expiry, so an expired forgery is still passkey_invalid", () => {
    const challenge = issueChallenge(KEY, "register", at(0), HANDLE);
    const late = at(HOUR);
    const tampered = bytesOf(challenge);
    tampered[20] = tampered[20]! ^ 0x80;
    expectInvalid(() => readChallenge(KEY, tampered.toString("base64url"), "register", late, HANDLE));
    expectInvalid(() => readChallenge(KEY, challenge, "reauth", late, HANDLE));
    expectInvalid(() => readChallenge(KEY, challenge, "register", late, OTHER_HANDLE));
  });
});

describe("passkey challenges: single use", () => {
  test("a challenge is spent once, and its marker lives exactly as long as the challenge", async () => {
    let clock = T0;
    const kv = new MemoryKv(() => clock);
    const challenge = issueChallenge(KEY, "signin", at(0));
    clock = T0 + MINUTE;
    await spendChallenge(kv, challenge, at(MINUTE));
    expect(await kv.get(spentKey(challenge))).toBe("1");
    const second = await failure(spendChallenge(kv, challenge, at(MINUTE)));
    expect([second.code, second.status]).toEqual(["passkey_invalid", 401]);
    clock = T0 + CHALLENGE_TTL_MS - 1;
    expect(await kv.get(spentKey(challenge))).toBe("1");
    expect((await failure(spendChallenge(kv, challenge, at(CHALLENGE_TTL_MS - 1)))).code).toBe("passkey_invalid");
    // Past its expiry the challenge is refused by readChallenge, so the marker has nothing left to guard.
    clock = T0 + CHALLENGE_TTL_MS;
    expect(await kv.get(spentKey(challenge))).toBeNull();
  });

  test("two concurrent spends of the same challenge: exactly one wins", async () => {
    const kv = new MemoryKv(() => T0);
    const challenge = issueChallenge(KEY, "reauth", at(0), HANDLE);
    const results = await Promise.allSettled([spendChallenge(kv, challenge, at(0)), spendChallenge(kv, challenge, at(0))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(AuthError);
    expect((rejected[0]!.reason as AuthError).code).toBe("passkey_invalid");
  });

  test("spending at or after the expiry is challenge_expired and writes no marker", async () => {
    const kv = new MemoryKv(() => T0 + CHALLENGE_TTL_MS);
    const challenge = issueChallenge(KEY, "signin", at(0));
    const err = await failure(spendChallenge(kv, challenge, at(CHALLENGE_TTL_MS)));
    expect([err.code, err.status]).toEqual(["challenge_expired", 400]);
    expect(await kv.get(spentKey(challenge))).toBeNull();
  });

  test("a malformed or non-canonical string cannot be spent, so it can never mark a second copy of a challenge", async () => {
    const kv = new MemoryKv(() => T0);
    const challenge = issueChallenge(KEY, "signin", at(0));
    const last = BASE64URL_ALPHABET.indexOf(challenge.at(-1)!);
    const nonCanonical = challenge.slice(0, -1) + BASE64URL_ALPHABET[last | 1];
    for (const candidate of [nonCanonical, "", "not a challenge", challenge.slice(0, -2)]) {
      expect((await failure(spendChallenge(kv, candidate, at(0)))).code).toBe("passkey_invalid");
      expect(await kv.get(spentKey(candidate))).toBeNull();
    }
    await spendChallenge(kv, challenge, at(0));
  });

  test("spending one challenge leaves every other one spendable", async () => {
    const kv = new MemoryKv(() => T0);
    const a = issueChallenge(KEY, "signin", at(0));
    const b = issueChallenge(KEY, "signin", at(0));
    await spendChallenge(kv, a, at(0));
    await spendChallenge(kv, b, at(0));
    expect((await failure(spendChallenge(kv, a, at(0)))).code).toBe("passkey_invalid");
  });
});
```

### Create `apps/api/test/auth/passkey-webauthn.test.ts`

```ts
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from "vitest";
import { AuthError } from "../../src/auth/context";
import { MemoryKv } from "../../src/auth/kv";
import { challengeKey, issueChallenge, readChallenge, spendChallenge } from "../../src/auth/passkeys/challenge";
import {
  CEREMONY_TIMEOUT_MS,
  MAX_CREDENTIAL_ID_BYTES,
  SUPPORTED_ALGORITHMS,
  authenticationOptions,
  isCounterRegression,
  readResponseChallenge,
  registrationOptions,
  verifyAuthentication,
  verifyRegistration,
} from "../../src/auth/passkeys/webauthn";
import { SoftAuthenticator, type CborValue, type SoftCreateInput, type SoftFlags } from "./soft-authenticator";

// The library's two verification calls, wrapped so a test can prove when korbat never reached them. They still run the
// real code.
vi.mock("@simplewebauthn/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@simplewebauthn/server")>();
  return {
    ...actual,
    verifyRegistrationResponse: vi.fn(actual.verifyRegistrationResponse),
    verifyAuthenticationResponse: vi.fn(actual.verifyAuthenticationResponse),
  };
});

const RP_ID = "localhost";
const RP_NAME = "korbat";
const ORIGIN = "http://localhost:8081";
const ORIGINS = [ORIGIN];
const KEY = challengeKey(Buffer.alloc(32, 3));
const NOW = new Date(1_789_000_000_000);
const HANDLE = "0b7f3c4e-2a51-4c8e-9d7a-5b1e6f2c3d4a";
const USER_HANDLE = Buffer.alloc(32, 7);
const AAGUID = "fbfc3007-154e-4ecc-8c0b-6e020557d7bd";
const ALL: SoftFlags = { up: true, uv: true, be: true, bs: true };
const BARE: SoftFlags = { up: true, uv: false, be: false, bs: false };
const libraryRegistration = vi.mocked(verifyRegistrationResponse);
const libraryAuthentication = vi.mocked(verifyAuthenticationResponse);

let fetchSpy: MockInstance<typeof fetch>;
beforeEach(() => {
  libraryRegistration.mockClear();
  libraryAuthentication.mockClear();
  // Certificate-carrying formats make the library fetch revocation lists; nothing here may reach the network.
  fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in unit tests"));
});
afterEach(() => {
  fetchSpy.mockRestore();
});

/** The AuthError a promise rejects with; anything else fails the test. */
async function failure(promise: Promise<unknown>): Promise<AuthError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AuthError) return err;
    throw err;
  }
  throw new Error("expected the passkey step to be refused");
}

/** The AuthError a synchronous call throws; anything else fails the test. */
function refusal(read: () => unknown): AuthError {
  try {
    read();
  } catch (err) {
    if (err instanceof AuthError) return err;
    throw err;
  }
  throw new Error("expected the passkey step to be refused");
}

async function expectInvalid(promise: Promise<unknown>) {
  const err = await failure(promise);
  expect([err.code, err.status]).toEqual(["passkey_invalid", 401]);
}

/** A registration response to a fresh registration challenge bound to HANDLE, and that challenge. */
function registrationResponse(auth: SoftAuthenticator, overrides: Partial<SoftCreateInput> = {}) {
  const challenge = issueChallenge(KEY, "register", NOW, HANDLE);
  const response = auth.create({ rpId: RP_ID, challenge, origin: ORIGIN, userHandle: USER_HANDLE, flags: ALL, ...overrides });
  return { challenge, response };
}

/** A passkey korbat accepted, with the response it came from. */
async function registered(auth: SoftAuthenticator, overrides: Partial<SoftCreateInput> = {}) {
  const { challenge, response } = registrationResponse(auth, overrides);
  const passkey = await verifyRegistration({ response, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID });
  return { response, passkey };
}

/** An assertion by a registered passkey to a fresh re-authentication challenge, and that challenge. */
function assertion(auth: SoftAuthenticator, credentialId: string, flags: SoftFlags, counter: number, at: { rpId?: string; origin?: string } = {}) {
  const challenge = issueChallenge(KEY, "reauth", NOW, HANDLE);
  const response = auth.get({ credentialId, rpId: at.rpId ?? RP_ID, challenge, origin: at.origin ?? ORIGIN, flags, counter });
  return { challenge, response };
}

describe("passkey options", () => {
  test("registration options carry korbat's challenge unchanged, the user handle, the label, the pinned algorithms and discoverable credentials", async () => {
    const challenge = issueChallenge(KEY, "register", NOW, HANDLE);
    const options = await registrationOptions({
      rp: { id: RP_ID, name: RP_NAME },
      user: { id: USER_HANDLE, name: "ada on the laptop", displayName: "ada on the laptop" },
      exclude: [{ id: "AAECAw", transports: ["internal", "hybrid"] }],
      challenge,
    });
    // The exact string korbat issued, so the browser signs it and readChallenge can read it back.
    expect(options.challenge).toBe(challenge);
    expect(() => readChallenge(KEY, options.challenge, "register", NOW, HANDLE)).not.toThrow();
    expect(options.rp).toEqual({ name: RP_NAME, id: RP_ID });
    expect(options.user).toEqual({ id: USER_HANDLE.toString("base64url"), name: "ada on the laptop", displayName: "ada on the laptop" });
    // Ed25519, ES256, RS256 in that order; never the runtime default, which adds ML-DSA on Node 24.
    expect(SUPPORTED_ALGORITHMS).toEqual([-8, -7, -257]);
    expect(options.pubKeyCredParams).toEqual([
      { alg: -8, type: "public-key" },
      { alg: -7, type: "public-key" },
      { alg: -257, type: "public-key" },
    ]);
    expect(CEREMONY_TIMEOUT_MS).toBe(300_000);
    expect(options.timeout).toBe(300_000);
    expect(options.attestation).toBe("none");
    expect(options.authenticatorSelection).toEqual({ residentKey: "required", requireResidentKey: true, userVerification: "preferred" });
    expect(options.excludeCredentials).toEqual([{ id: "AAECAw", transports: ["internal", "hybrid"], type: "public-key" }]);
  });

  test("two calls never share an authenticatorSelection object, which the library writes into", async () => {
    const input = () => ({
      rp: { id: RP_ID, name: RP_NAME },
      user: { id: USER_HANDLE, name: "ada", displayName: "ada" },
      exclude: [],
      challenge: issueChallenge(KEY, "register", NOW, HANDLE),
    });
    const first = await registrationOptions(input());
    const second = await registrationOptions(input());
    expect(first.authenticatorSelection).not.toBe(second.authenticatorSelection);
    first.authenticatorSelection!.residentKey = "discouraged";
    first.authenticatorSelection!.userVerification = "discouraged";
    expect(second.authenticatorSelection).toEqual({ residentKey: "required", requireResidentKey: true, userVerification: "preferred" });
    expect((await registrationOptions(input())).authenticatorSelection).toEqual({ residentKey: "required", requireResidentKey: true, userVerification: "preferred" });
  });

  test("sign-in options list no credentials, so they say nothing about any account", async () => {
    const challenge = issueChallenge(KEY, "signin", NOW);
    const options = await authenticationOptions({ rpId: RP_ID, allow: [], challenge });
    expect(options.challenge).toBe(challenge);
    expect(options.allowCredentials).toEqual([]);
    expect(options.rpId).toBe(RP_ID);
    expect(options.timeout).toBe(300_000);
    expect(options.userVerification).toBe("preferred");
    expect(() => readChallenge(KEY, options.challenge, "signin", NOW)).not.toThrow();
  });

  test("re-authentication options list the account's passkeys with their transports", async () => {
    const challenge = issueChallenge(KEY, "reauth", NOW, HANDLE);
    const options = await authenticationOptions({ rpId: RP_ID, allow: [{ id: "AAECAw", transports: ["usb"] }, { id: "BAUG", transports: [] }], challenge });
    expect(options.challenge).toBe(challenge);
    expect(options.allowCredentials).toEqual([
      { id: "AAECAw", transports: ["usb"], type: "public-key" },
      { id: "BAUG", transports: [], type: "public-key" },
    ]);
  });
});

describe("passkey registration", () => {
  test("verifies a registration and returns what korbat stores, with the flags", async () => {
    const auth = new SoftAuthenticator();
    const { challenge, response } = registrationResponse(auth, { counter: 4, aaguid: AAGUID });
    const passkey = await verifyRegistration({ response, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID });
    expect(passkey).toEqual({
      credentialId: response.id,
      publicKey: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
      counter: 4,
      transports: ["internal", "hybrid"],
      aaguid: AAGUID,
      backupEligible: true,
      backedUp: true,
      userVerified: true,
    });
    // The public key is the COSE key from the authenticator data, as base64url: an ES256 key on P-256.
    const cose = isoCBOR.decodeFirst<Map<number, unknown>>(Uint8Array.from(Buffer.from(passkey.publicKey, "base64url")));
    expect([cose.get(1), cose.get(3), cose.get(-1)]).toEqual([2, -7, 1]);
    // The library ran once, with korbat's settings: the checked challenge string, every allowed origin, the RP ID,
    // user verification not required and the algorithms pinned.
    expect(libraryRegistration).toHaveBeenCalledTimes(1);
    expect(libraryRegistration.mock.calls[0]![0]).toMatchObject({
      expectedChallenge: challenge,
      expectedOrigin: ORIGINS,
      expectedRPID: RP_ID,
      requireUserVerification: false,
      supportedAlgorithmIDs: [-8, -7, -257],
    });
  });

  test("a registration without user verification still verifies, and says so", async () => {
    const { passkey } = await registered(new SoftAuthenticator(), { flags: BARE });
    expect(passkey).toMatchObject({ userVerified: false, backupEligible: false, backedUp: false, counter: 0, aaguid: "00000000-0000-0000-0000-000000000000" });
  });

  test("a registration without user presence is refused", async () => {
    const { challenge, response } = registrationResponse(new SoftAuthenticator(), { flags: { up: false, uv: true, be: false, bs: false } });
    await expectInvalid(verifyRegistration({ response, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID }));
  });

  test("packed without x5c passes the format check and verifies as a self attestation", async () => {
    const { passkey } = await registered(new SoftAuthenticator(), { fmt: "packed" });
    expect(passkey.userVerified).toBe(true);
    expect(libraryRegistration).toHaveBeenCalledTimes(1);
  });

  test("packed with an x5c chain, tpm, android-key, apple, fido-u2f and any other format are refused before the library runs", async () => {
    const certificate = randomBytes(300);
    const signature = randomBytes(70);
    const statements: [string, Map<string | number, CborValue>][] = [
      ["packed", new Map<string | number, CborValue>([["alg", -7], ["sig", signature], ["x5c", [certificate]]])],
      // An empty chain is still a chain: the library tests x5c for truthiness, and an empty array passes that test.
      ["packed", new Map<string | number, CborValue>([["alg", -7], ["sig", signature], ["x5c", []]])],
      ["tpm", new Map<string | number, CborValue>([["ver", "2.0"], ["alg", -257], ["x5c", [certificate]], ["sig", signature], ["certInfo", randomBytes(100)], ["pubArea", randomBytes(100)]])],
      ["android-key", new Map<string | number, CborValue>([["alg", -7], ["sig", signature], ["x5c", [certificate]]])],
      ["apple", new Map<string | number, CborValue>([["x5c", [certificate]]])],
      ["fido-u2f", new Map<string | number, CborValue>([["sig", signature], ["x5c", [certificate]]])],
      ["android-safetynet", new Map<string | number, CborValue>([["ver", "1"], ["response", randomBytes(100)]])],
      ["a-format-nobody-registered", new Map<string | number, CborValue>()],
    ];
    const auth = new SoftAuthenticator();
    for (const [fmt, attStmt] of statements) {
      const { challenge, response } = registrationResponse(auth, { fmt, attStmt });
      const err = await failure(verifyRegistration({ response, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID }));
      expect([fmt, err.code, err.status]).toEqual([fmt, "passkey_unsupported", 400]);
    }
    expect(libraryRegistration).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("an attestation object that is not a CBOR map of the expected members is passkey_invalid, and the library never sees it", async () => {
    const auth = new SoftAuthenticator();
    const encode = (value: CborValue) => Buffer.from(isoCBOR.encode(value)).toString("base64url");
    const broken = [
      encode(5),
      encode("none"),
      encode(new Map<string | number, CborValue>([["fmt", "none"], ["authData", randomBytes(37)]])),
      encode(new Map<string | number, CborValue>([["fmt", 1], ["attStmt", new Map()], ["authData", randomBytes(37)]])),
      encode(new Map<string | number, CborValue>([["fmt", "none"], ["attStmt", [1, 2]], ["authData", randomBytes(37)]])),
      Buffer.from([0xff, 0x00, 0x13]).toString("base64url"),
    ];
    for (const attestationObject of broken) {
      const { challenge, response } = registrationResponse(auth);
      await expectInvalid(verifyRegistration({ response: { ...response, response: { ...response.response, attestationObject } }, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID }));
    }
    expect(libraryRegistration).not.toHaveBeenCalled();
  });

  test("a credential id of 1024 bytes is refused; 1023 bytes are kept", async () => {
    expect(MAX_CREDENTIAL_ID_BYTES).toBe(1023);
    const auth = new SoftAuthenticator();
    const { challenge, response } = registrationResponse(auth, { credentialId: randomBytes(1024) });
    await expectInvalid(verifyRegistration({ response, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID }));
    const longest = randomBytes(1023);
    const { passkey } = await registered(auth, { credentialId: longest });
    expect(Buffer.from(passkey.credentialId, "base64url").equals(longest)).toBe(true);
  });

  test("transports keep only the known values, without repeats, five at most", async () => {
    const auth = new SoftAuthenticator();
    const mixed = await registered(auth, { transports: ["internal", "carrier-pigeon", "hybrid", "internal", "", "usb", "INTERNAL"] });
    expect(mixed.passkey.transports).toEqual(["internal", "hybrid", "usb"]);
    const excess = await registered(auth, { transports: ["usb", "nfc", "ble", "smart-card", "hybrid", "internal", "cable"] });
    expect(excess.passkey.transports).toEqual(["usb", "nfc", "ble", "smart-card", "hybrid"]);
    const late = await registered(auth, { transports: ["cable", "internal"] });
    expect(late.passkey.transports).toEqual(["cable", "internal"]);
    const { challenge, response } = registrationResponse(auth);
    const { transports: _dropped, ...withoutTransports } = response.response;
    const none = await verifyRegistration({ response: { ...response, response: withoutTransports }, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID });
    expect(none.transports).toEqual([]);
  });

  test("a wrong origin, a wrong RP ID and a wrong challenge are passkey_invalid", async () => {
    const auth = new SoftAuthenticator();
    const wrongOrigin = registrationResponse(auth, { origin: "https://korbat.example.net" });
    await expectInvalid(verifyRegistration({ response: wrongOrigin.response, expectedChallenge: wrongOrigin.challenge, origins: ORIGINS, rpId: RP_ID }));
    const wrongRp = registrationResponse(auth, { rpId: "example.net" });
    await expectInvalid(verifyRegistration({ response: wrongRp.response, expectedChallenge: wrongRp.challenge, origins: ORIGINS, rpId: RP_ID }));
    const { response } = registrationResponse(auth);
    await expectInvalid(verifyRegistration({ response, expectedChallenge: issueChallenge(KEY, "register", NOW, HANDLE), origins: ORIGINS, rpId: RP_ID }));
    // A sign-in response is not a registration, whatever it carries.
    const passkey = await registered(auth);
    const signin = assertion(auth, passkey.response.id, ALL, 1);
    const asRegistration = { ...passkey.response, response: { ...passkey.response.response, clientDataJSON: signin.response.response.clientDataJSON } };
    await expectInvalid(verifyRegistration({ response: asRegistration, expectedChallenge: signin.challenge, origins: ORIGINS, rpId: RP_ID }));
  });

  test("every allowed origin is accepted", async () => {
    const auth = new SoftAuthenticator();
    const { challenge, response } = registrationResponse(auth, { origin: "http://localhost:19006" });
    const passkey = await verifyRegistration({ response, expectedChallenge: challenge, origins: [ORIGIN, "http://localhost:19006"], rpId: RP_ID });
    expect(passkey.credentialId).toBe(response.id);
  });
});

describe("passkey assertions", () => {
  test("an assertion verifies against the stored key with a counter of 0 given to the library, and reports the new counter and flags", async () => {
    const auth = new SoftAuthenticator();
    const { passkey } = await registered(auth);
    const { challenge, response } = assertion(auth, passkey.credentialId, { up: true, uv: true, be: true, bs: false }, 7);
    const result = await verifyAuthentication({ response, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID, credential: { id: passkey.credentialId, publicKey: passkey.publicKey, transports: passkey.transports } });
    expect(result).toEqual({ newCounter: 7, userVerified: true, backedUp: false });
    expect(libraryAuthentication).toHaveBeenCalledTimes(1);
    const call = libraryAuthentication.mock.calls[0]![0];
    expect(call).toMatchObject({ expectedChallenge: challenge, expectedOrigin: ORIGINS, expectedRPID: RP_ID, requireUserVerification: false });
    expect(call.credential.id).toBe(passkey.credentialId);
    expect(call.credential.counter).toBe(0);
    expect(Buffer.from(call.credential.publicKey).toString("base64url")).toBe(passkey.publicKey);
  });

  test("the library never decides on counters: a counter of 0, as Apple passkeys send, and any other counter verify", async () => {
    const auth = new SoftAuthenticator();
    const { passkey } = await registered(auth, { counter: 12 });
    const credential = { id: passkey.credentialId, publicKey: passkey.publicKey, transports: passkey.transports };
    for (const counter of [0, 3, 12, 13]) {
      const { challenge, response } = assertion(auth, passkey.credentialId, ALL, counter);
      expect((await verifyAuthentication({ response, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID, credential })).newCounter).toBe(counter);
    }
  });

  test("an assertion without user verification still verifies, and says so", async () => {
    const auth = new SoftAuthenticator();
    const { passkey } = await registered(auth, { flags: BARE });
    const { challenge, response } = assertion(auth, passkey.credentialId, BARE, 1);
    const result = await verifyAuthentication({ response, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID, credential: { id: passkey.credentialId, publicKey: passkey.publicKey, transports: [] } });
    expect(result).toEqual({ newCounter: 1, userVerified: false, backedUp: false });
  });

  test("an assertion without user presence is refused", async () => {
    const auth = new SoftAuthenticator();
    const { passkey } = await registered(auth);
    const { challenge, response } = assertion(auth, passkey.credentialId, { up: false, uv: true, be: true, bs: true }, 1);
    await expectInvalid(verifyAuthentication({ response, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID, credential: { id: passkey.credentialId, publicKey: passkey.publicKey, transports: [] } }));
  });

  test("a signature by another passkey's key is refused", async () => {
    const auth = new SoftAuthenticator();
    const mine = await registered(auth);
    const theirs = await registered(auth);
    const { challenge, response } = assertion(auth, theirs.passkey.credentialId, ALL, 1);
    await expectInvalid(verifyAuthentication({ response, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID, credential: { id: mine.passkey.credentialId, publicKey: mine.passkey.publicKey, transports: [] } }));
  });

  test("authenticator data changed after signing is refused", async () => {
    const auth = new SoftAuthenticator();
    const { passkey } = await registered(auth);
    const { challenge, response } = assertion(auth, passkey.credentialId, ALL, 1);
    const authData = Buffer.from(response.response.authenticatorData, "base64url");
    // The last byte of the counter: 1 becomes 2.
    authData[36] = 2;
    const tampered = { ...response, response: { ...response.response, authenticatorData: authData.toString("base64url") } };
    await expectInvalid(verifyAuthentication({ response: tampered, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID, credential: { id: passkey.credentialId, publicKey: passkey.publicKey, transports: [] } }));
  });

  test("a wrong origin, a wrong RP ID and a wrong challenge are passkey_invalid", async () => {
    const auth = new SoftAuthenticator();
    const { passkey } = await registered(auth);
    const credential = { id: passkey.credentialId, publicKey: passkey.publicKey, transports: passkey.transports };
    const wrongOrigin = assertion(auth, passkey.credentialId, ALL, 1, { origin: "https://korbat.example.net" });
    await expectInvalid(verifyAuthentication({ response: wrongOrigin.response, expectedChallenge: wrongOrigin.challenge, origins: ORIGINS, rpId: RP_ID, credential }));
    const wrongRp = assertion(auth, passkey.credentialId, ALL, 1, { rpId: "example.net" });
    await expectInvalid(verifyAuthentication({ response: wrongRp.response, expectedChallenge: wrongRp.challenge, origins: ORIGINS, rpId: RP_ID, credential }));
    const { response } = assertion(auth, passkey.credentialId, ALL, 1);
    await expectInvalid(verifyAuthentication({ response, expectedChallenge: issueChallenge(KEY, "reauth", NOW, HANDLE), origins: ORIGINS, rpId: RP_ID, credential }));
  });

  test("a stored key that is not a COSE key is passkey_invalid", async () => {
    const auth = new SoftAuthenticator();
    const { passkey } = await registered(auth);
    const { challenge, response } = assertion(auth, passkey.credentialId, ALL, 1);
    await expectInvalid(verifyAuthentication({ response, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID, credential: { id: passkey.credentialId, publicKey: "AAAA", transports: [] } }));
  });
});

describe("the counter rule", () => {
  test("a counter that does not move past the stored one is a regression, unless both are 0", () => {
    expect(isCounterRegression(0, 0)).toBe(false);
    expect(isCounterRegression(5, 5)).toBe(true);
    expect(isCounterRegression(5, 6)).toBe(false);
    expect(isCounterRegression(5, 4)).toBe(true);
    expect(isCounterRegression(5, 0)).toBe(true);
    expect(isCounterRegression(0, 1)).toBe(false);
  });
});

describe("the response's challenge", () => {
  test("is read from the client data, then checked and spent before the library runs", async () => {
    const auth = new SoftAuthenticator();
    const kv = new MemoryKv(() => NOW.getTime());
    const challenge = issueChallenge(KEY, "register", NOW, HANDLE);
    const options = await registrationOptions({ rp: { id: RP_ID, name: RP_NAME }, user: { id: USER_HANDLE, name: "ada", displayName: "ada" }, exclude: [], challenge });
    const response = auth.create({ rpId: options.rp.id!, challenge: options.challenge, origin: ORIGIN, userHandle: Buffer.from(options.user.id, "base64url"), flags: ALL });
    const read = readResponseChallenge(response);
    expect(read).toBe(challenge);
    readChallenge(KEY, read, "register", NOW, HANDLE);
    await spendChallenge(kv, read, NOW);
    const passkey = await verifyRegistration({ response, expectedChallenge: read, origins: ORIGINS, rpId: RP_ID });
    // The same response again: its challenge is spent.
    expect((await failure(spendChallenge(kv, readResponseChallenge(response), NOW))).code).toBe("passkey_invalid");

    const signin = issueChallenge(KEY, "signin", NOW);
    const signinOptions = await authenticationOptions({ rpId: RP_ID, allow: [], challenge: signin });
    const assertionResponse = auth.get({ credentialId: passkey.credentialId, rpId: RP_ID, challenge: signinOptions.challenge, origin: ORIGIN, flags: ALL, counter: 1 });
    expect(readResponseChallenge(assertionResponse)).toBe(signin);
  });

  test("client data that is not JSON, names no string challenge, or is oversized is passkey_invalid", () => {
    const challenge = issueChallenge(KEY, "signin", NOW);
    const encoded = (text: string) => Buffer.from(text).toString("base64url");
    const json = (value: unknown) => encoded(JSON.stringify(value));
    const cases = [
      encoded("not json"),
      json(null),
      json("a string"),
      json([challenge]),
      json({ type: "webauthn.get", origin: ORIGIN }),
      json({ type: "webauthn.get", challenge: 42, origin: ORIGIN }),
      json({ type: "webauthn.get", challenge: "A".repeat(129), origin: ORIGIN }),
      json({ type: "webauthn.get", challenge, origin: ORIGIN, padding: "x".repeat(3000) }),
      "",
    ];
    for (const clientDataJSON of cases) {
      const err = refusal(() => readResponseChallenge({ response: { clientDataJSON } }));
      expect([err.code, err.status]).toEqual(["passkey_invalid", 401]);
    }
    expect(readResponseChallenge({ response: { clientDataJSON: json({ type: "webauthn.get", challenge, origin: ORIGIN }) } })).toBe(challenge);
  });
});

describe("the library boundary", () => {
  test("webauthn.ts is the only source file that imports @simplewebauthn/server", () => {
    const root = fileURLToPath(new URL("../../src", import.meta.url));
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return walk(full);
        return entry.name.endsWith(".ts") ? [full] : [];
      });
    const importers = walk(root)
      .filter((file) => /["']@simplewebauthn\/server(\/[^"']*)?["']/.test(readFileSync(file, "utf8")))
      .map((file) => relative(root, file).split(sep).join("/"));
    expect(importers).toEqual(["auth/passkeys/webauthn.ts"]);
  });
});
```

### Create `apps/api/test/auth/soft-authenticator.test.ts`

```ts
import { createHash, createPublicKey, createVerify, randomBytes } from "node:crypto";
import { AuthenticationResponseJSON, RegistrationResponseJSON } from "@korbat/contracts";
import { verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import { decodeAttestationObject, decodeClientDataJSON, isoBase64URL, isoCBOR, parseAuthenticatorData } from "@simplewebauthn/server/helpers";
import { describe, expect, test } from "vitest";
import { SoftAuthenticator, ZERO_AAGUID, type SoftFlags } from "./soft-authenticator";

const RP_ID = "localhost";
const ORIGIN = "http://localhost:8081";
const CHALLENGE = "c29mdC1hdXRoZW50aWNhdG9yLWNoYWxsZW5nZQ";
const USER_HANDLE = Buffer.alloc(32, 9);
const AAGUID = "adce0002-35bc-c60a-648b-0b25f1f05503";
const ALL: SoftFlags = { up: true, uv: true, be: true, bs: true };
const BARE: SoftFlags = { up: true, uv: false, be: false, bs: false };

const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest();

/** A COSE public key as the plain CBOR map it is, labels to values. */
const coseMap = (publicKey: Uint8Array) => isoCBOR.decodeFirst<Map<number, unknown>>(Uint8Array.from(publicKey));

/** A registration the library has verified, with the response it came from. */
async function registered(auth: SoftAuthenticator, flags: SoftFlags = ALL) {
  const response = auth.create({ rpId: RP_ID, challenge: CHALLENGE, origin: ORIGIN, userHandle: USER_HANDLE, flags });
  const result = await verifyRegistrationResponse({ response, expectedChallenge: CHALLENGE, expectedOrigin: ORIGIN, expectedRPID: RP_ID, requireUserVerification: false });
  if (!result.verified) throw new Error("the library refused the software authenticator's registration");
  return { response, info: result.registrationInfo };
}

/** The raw authenticator data inside a registration response's attestation object. */
function authDataOf(response: { response: { attestationObject: string } }) {
  return decodeAttestationObject(isoBase64URL.toBuffer(response.response.attestationObject)).get("authData");
}

describe("the software authenticator: registration", () => {
  test("produces a registration the library verifies, with the counter, AAGUID and flags the test chose", async () => {
    const auth = new SoftAuthenticator();
    const response = auth.create({ rpId: RP_ID, challenge: CHALLENGE, origin: ORIGIN, userHandle: USER_HANDLE, flags: ALL, counter: 3, aaguid: AAGUID });
    // The same shape the API's contract accepts, so HTTP tests can post it as it is.
    expect(RegistrationResponseJSON.parse(response)).toEqual(response);
    expect(response.id).toBe(response.rawId);
    expect(response.response.transports).toEqual(["internal", "hybrid"]);
    expect(decodeClientDataJSON(response.response.clientDataJSON)).toEqual({ type: "webauthn.create", challenge: CHALLENGE, origin: ORIGIN, crossOrigin: false });

    const result = await verifyRegistrationResponse({ response, expectedChallenge: CHALLENGE, expectedOrigin: ORIGIN, expectedRPID: RP_ID });
    expect(result.verified).toBe(true);
    const info = result.registrationInfo!;
    expect(info.fmt).toBe("none");
    expect(info.credential.id).toBe(response.id);
    expect(info.credential.counter).toBe(3);
    expect(info.aaguid).toBe(AAGUID);
    expect(info.userVerified).toBe(true);
    expect(info.credentialDeviceType).toBe("multiDevice");
    expect(info.credentialBackedUp).toBe(true);
  });

  test("clears the flags a test turns off: without UV the library verifies only when UV is not required", async () => {
    const auth = new SoftAuthenticator();
    const response = auth.create({ rpId: RP_ID, challenge: CHALLENGE, origin: ORIGIN, userHandle: USER_HANDLE, flags: BARE });
    const relaxed = await verifyRegistrationResponse({ response, expectedChallenge: CHALLENGE, expectedOrigin: ORIGIN, expectedRPID: RP_ID, requireUserVerification: false });
    expect(relaxed.verified).toBe(true);
    expect(relaxed.registrationInfo!.userVerified).toBe(false);
    expect(relaxed.registrationInfo!.credentialDeviceType).toBe("singleDevice");
    expect(relaxed.registrationInfo!.credentialBackedUp).toBe(false);
    expect(relaxed.registrationInfo!.aaguid).toBe(ZERO_AAGUID);
    await expect(verifyRegistrationResponse({ response, expectedChallenge: CHALLENGE, expectedOrigin: ORIGIN, expectedRPID: RP_ID })).rejects.toThrow(/User verification/);
  });

  test("signs a packed self attestation (no x5c) that the library verifies", async () => {
    const auth = new SoftAuthenticator();
    const response = auth.create({ rpId: RP_ID, challenge: CHALLENGE, origin: ORIGIN, userHandle: USER_HANDLE, flags: ALL, fmt: "packed" });
    const attStmt = decodeAttestationObject(isoBase64URL.toBuffer(response.response.attestationObject)).get("attStmt");
    expect(attStmt.get("alg")).toBe(-7);
    expect(attStmt.get("x5c")).toBeUndefined();
    const result = await verifyRegistrationResponse({ response, expectedChallenge: CHALLENGE, expectedOrigin: ORIGIN, expectedRPID: RP_ID });
    expect(result.verified).toBe(true);
    expect(result.registrationInfo!.fmt).toBe("packed");
  });

  test("writes the format and statement a test gives into the attestation object", () => {
    const auth = new SoftAuthenticator();
    const certificate = randomBytes(64);
    const response = auth.create({
      rpId: RP_ID,
      challenge: CHALLENGE,
      origin: ORIGIN,
      userHandle: USER_HANDLE,
      flags: ALL,
      fmt: "tpm",
      attStmt: new Map([["x5c", [certificate]]]),
    });
    const decoded = decodeAttestationObject(isoBase64URL.toBuffer(response.response.attestationObject));
    expect(decoded.get("fmt")).toBe("tpm");
    expect(Buffer.from(decoded.get("attStmt").get("x5c")![0]!).equals(certificate)).toBe(true);
  });

  test("lays the authenticator data out by hand as WebAuthn defines it, with the credential id and the ES256 COSE key", () => {
    const auth = new SoftAuthenticator();
    const credentialId = randomBytes(1024);
    const response = auth.create({ rpId: RP_ID, challenge: CHALLENGE, origin: ORIGIN, userHandle: USER_HANDLE, flags: { up: true, uv: false, be: true, bs: false }, counter: 258, aaguid: AAGUID, credentialId });
    const parsed = parseAuthenticatorData(authDataOf(response));
    expect(Buffer.from(parsed.rpIdHash).equals(sha256(RP_ID))).toBe(true);
    expect(parsed.flags).toMatchObject({ up: true, uv: false, be: true, bs: false, at: true, ed: false });
    expect(parsed.counter).toBe(258);
    expect(Buffer.from(parsed.aaguid!).toString("hex")).toBe(AAGUID.replace(/-/g, ""));
    expect(Buffer.from(parsed.credentialID!).equals(credentialId)).toBe(true);
    expect(response.id).toBe(credentialId.toString("base64url"));
    const cose = coseMap(parsed.credentialPublicKey!);
    // kty EC2, alg ES256, crv P-256, and 32-byte coordinates.
    expect([cose.get(1), cose.get(3), cose.get(-1)]).toEqual([2, -7, 1]);
    expect((cose.get(-2) as Uint8Array).byteLength).toBe(32);
    expect((cose.get(-3) as Uint8Array).byteLength).toBe(32);
  });
});

describe("the software authenticator: sign-in", () => {
  test("produces an assertion the library verifies against the registered key, with the counter and flags the test chose", async () => {
    const auth = new SoftAuthenticator();
    const { response: created, info } = await registered(auth);
    const response = auth.get({ credentialId: created.id, rpId: RP_ID, challenge: CHALLENGE, origin: ORIGIN, flags: { up: true, uv: true, be: true, bs: false }, counter: 9 });
    expect(AuthenticationResponseJSON.parse(response)).toEqual(response);
    expect(decodeClientDataJSON(response.response.clientDataJSON)).toEqual({ type: "webauthn.get", challenge: CHALLENGE, origin: ORIGIN, crossOrigin: false });
    const parsed = parseAuthenticatorData(isoBase64URL.toBuffer(response.response.authenticatorData));
    expect(parsed.flags).toMatchObject({ up: true, uv: true, be: true, bs: false, at: false, ed: false });
    expect(parsed.credentialID).toBeUndefined();

    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: CHALLENGE,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: { id: info.credential.id, publicKey: info.credential.publicKey, counter: 0 },
    });
    expect(result.verified).toBe(true);
    expect(result.authenticationInfo.newCounter).toBe(9);
    expect(result.authenticationInfo.userVerified).toBe(true);
    expect(result.authenticationInfo.credentialBackedUp).toBe(false);
  });

  test("signs with ES256 in DER over the authenticator data and the client data's hash", async () => {
    const auth = new SoftAuthenticator();
    const { response: created, info } = await registered(auth);
    const response = auth.get({ credentialId: created.id, rpId: RP_ID, challenge: CHALLENGE, origin: ORIGIN, flags: ALL, counter: 1 });
    const cose = coseMap(info.credential.publicKey);
    const coordinate = (label: number) => Buffer.from(cose.get(label) as Uint8Array).toString("base64url");
    const publicKey = createPublicKey({ key: { kty: "EC", crv: "P-256", x: coordinate(-2), y: coordinate(-3) }, format: "jwk" });
    const signature = isoBase64URL.toBuffer(response.response.signature);
    // A DER SEQUENCE, not the 64-byte raw form.
    expect(signature[0]).toBe(0x30);
    const signed = Buffer.concat([isoBase64URL.toBuffer(response.response.authenticatorData), sha256(isoBase64URL.toBuffer(response.response.clientDataJSON))]);
    expect(createVerify("sha256").update(signed).verify(publicKey, signature)).toBe(true);
  });

  test("a signature made with another credential's key does not verify", async () => {
    const auth = new SoftAuthenticator();
    const first = await registered(auth);
    const second = await registered(auth);
    const response = auth.get({ credentialId: first.response.id, rpId: RP_ID, challenge: CHALLENGE, origin: ORIGIN, flags: ALL, counter: 1 });
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: CHALLENGE,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: { id: first.info.credential.id, publicKey: second.info.credential.publicKey, counter: 0 },
    });
    expect(result.verified).toBe(false);
  });

  test("returns the user handle given at creation, none when told null, or the bytes it is given", async () => {
    const auth = new SoftAuthenticator();
    const { response: created } = await registered(auth, BARE);
    const base = { credentialId: created.id, rpId: RP_ID, challenge: CHALLENGE, origin: ORIGIN, flags: BARE, counter: 0 };
    expect(auth.get(base).response.userHandle).toBe(USER_HANDLE.toString("base64url"));
    expect("userHandle" in auth.get({ ...base, userHandle: null }).response).toBe(false);
    const other = Buffer.alloc(32, 1);
    expect(auth.get({ ...base, userHandle: other }).response.userHandle).toBe(other.toString("base64url"));
  });

  test("refuses to answer for a credential it does not hold", () => {
    const auth = new SoftAuthenticator();
    expect(() => auth.get({ credentialId: "AAAA", rpId: RP_ID, challenge: CHALLENGE, origin: ORIGIN, flags: ALL, counter: 0 })).toThrow(/holds no credential/);
  });
});
```

### Create `apps/api/test/auth/soft-authenticator.ts`

```ts
import { createHash, createSign, generateKeyPairSync, randomBytes, type KeyObject } from "node:crypto";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@korbat/contracts";
import { isoCBOR } from "@simplewebauthn/server/helpers";

/** A value the library's CBOR encoder takes: maps (never plain objects), arrays, byte strings, text and numbers. */
export type CborValue = Parameters<typeof isoCBOR.encode>[0];

/** The authenticator data flags a test controls: user present, user verified, backup eligible, backed up. */
export interface SoftFlags {
  up: boolean;
  uv: boolean;
  be: boolean;
  bs: boolean;
}

/** The AAGUID most synced passkeys report: all zeros. */
export const ZERO_AAGUID = "00000000-0000-0000-0000-000000000000";

// Bits of the authenticator data's flags byte (WebAuthn L3, section 6.1). AT says attested credential data follows
// the counter, which is true at registration only.
const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_BE = 0x08;
const FLAG_BS = 0x10;
const FLAG_AT = 0x40;

// An ES256 public key as a COSE key (RFC 9053): the labels kty, alg, crv, x and y, and the values EC2, ES256, P-256.
const COSE_KTY = 1;
const COSE_ALG = 3;
const COSE_CRV = -1;
const COSE_X = -2;
const COSE_Y = -3;
const KTY_EC2 = 2;
const ALG_ES256 = -7;
const CRV_P256 = 1;

export interface SoftCreateInput {
  rpId: string;
  challenge: string;
  origin: string;
  /** The options' user.id: the account's WebAuthn user handle, which a discoverable passkey hands back at sign-in. */
  userHandle: Uint8Array;
  flags: SoftFlags;
  /** The attestation format; `none` unless the test names another. */
  fmt?: string;
  /** The attestation statement. Without one, `none` gets an empty map and `packed` a self attestation signed with the new key. */
  attStmt?: Map<string | number, CborValue>;
  /** The signature counter the authenticator data reports; 0 unless given. */
  counter?: number;
  /** The authenticator model; all zeros unless given. */
  aaguid?: string;
  /** The credential id; 32 random bytes unless the test needs particular ones (1024 of them, say). */
  credentialId?: Uint8Array;
  /** What the browser reports as the authenticator's transports; ["internal", "hybrid"] unless given. */
  transports?: string[];
}

export interface SoftGetInput {
  /** The credential id as base64url, as the registration response's id carried it. */
  credentialId: string;
  rpId: string;
  challenge: string;
  origin: string;
  flags: SoftFlags;
  counter: number;
  /**
   * The user handle the response returns: absent, the one given at creation (a discoverable passkey); null, none (as a
   * security key used with an allow list may answer); otherwise these bytes (another account's handle, say).
   */
  userHandle?: Uint8Array | null;
}

/** What the authenticator keeps of each credential it created. */
interface HeldCredential {
  privateKey: KeyObject;
  userHandle: Uint8Array;
}

const sha256 = (data: Uint8Array | string): Buffer => createHash("sha256").update(data).digest();
const base64url = (data: Uint8Array): string => Buffer.from(data).toString("base64url");

function flagsByte(flags: SoftFlags, attested: boolean): number {
  return (flags.up ? FLAG_UP : 0) | (flags.uv ? FLAG_UV : 0) | (flags.be ? FLAG_BE : 0) | (flags.bs ? FLAG_BS : 0) | (attested ? FLAG_AT : 0);
}

/** The signature counter: 4 bytes, big-endian. */
function counterBytes(counter: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(counter);
  return bytes;
}

function aaguidBytes(aaguid: string): Buffer {
  const hex = aaguid.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error(`not an AAGUID: ${aaguid}`);
  return Buffer.from(hex, "hex");
}

/** The client data a browser writes, byte for byte what the authenticator's signature covers through its hash. */
function clientData(type: "webauthn.create" | "webauthn.get", challenge: string, origin: string): Buffer {
  return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
}

/** ES256 over the authenticator data followed by the client data's SHA-256, DER-encoded as WebAuthn expects (Node's default for EC keys). */
function sign(privateKey: KeyObject, authData: Buffer, clientDataJSON: Buffer): Buffer {
  return createSign("sha256").update(Buffer.concat([authData, sha256(clientDataJSON)])).sign(privateKey);
}

function coseKey(publicKey: KeyObject): Uint8Array {
  const { x, y } = publicKey.export({ format: "jwk" });
  if (!x || !y) throw new Error("an EC public key exports x and y");
  return isoCBOR.encode(
    new Map<string | number, CborValue>([
      [COSE_KTY, KTY_EC2],
      [COSE_ALG, ALG_ES256],
      [COSE_CRV, CRV_P256],
      [COSE_X, Buffer.from(x, "base64url")],
      [COSE_Y, Buffer.from(y, "base64url")],
    ]),
  );
}

/**
 * A passkey provider in software for the tests: it holds ES256 key pairs from node:crypto and answers registration and
 * sign-in ceremonies with the JSON the browser library sends, built by hand (the authenticator data byte by byte, the
 * attestation object in CBOR through the server library's own encoder). Every input a hostile or unusual authenticator
 * could vary is under the test's control: the flags, the counter, the AAGUID, the credential id, the format and its
 * statement, the transports and the user handle.
 */
export class SoftAuthenticator {
  private readonly credentials = new Map<string, HeldCredential>();

  create(input: SoftCreateInput): RegistrationResponseJSON {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const credentialId = Buffer.from(input.credentialId ?? randomBytes(32));
    const id = base64url(credentialId);
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(credentialId.length);
    // rpIdHash (32), flags (1), counter (4), then the attested credential data: AAGUID (16), the id's length (2), the
    // id and the COSE public key.
    const authData = Buffer.concat([
      sha256(input.rpId),
      Buffer.from([flagsByte(input.flags, true)]),
      counterBytes(input.counter ?? 0),
      aaguidBytes(input.aaguid ?? ZERO_AAGUID),
      idLength,
      credentialId,
      coseKey(publicKey),
    ]);
    const clientDataJSON = clientData("webauthn.create", input.challenge, input.origin);
    const fmt = input.fmt ?? "none";
    // A packed self attestation (no x5c) is signed with the credential's own key over the same bytes as an assertion.
    const attStmt =
      input.attStmt ??
      (fmt === "packed"
        ? new Map<string | number, CborValue>([
            ["alg", ALG_ES256],
            ["sig", sign(privateKey, authData, clientDataJSON)],
          ])
        : new Map<string | number, CborValue>());
    const attestationObject = isoCBOR.encode(
      new Map<string | number, CborValue>([
        ["fmt", fmt],
        ["attStmt", attStmt],
        ["authData", authData],
      ]),
    );
    this.credentials.set(id, { privateKey, userHandle: Uint8Array.from(input.userHandle) });
    return {
      id,
      rawId: id,
      type: "public-key",
      response: {
        clientDataJSON: base64url(clientDataJSON),
        attestationObject: base64url(attestationObject),
        transports: input.transports ?? ["internal", "hybrid"],
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }

  get(input: SoftGetInput): AuthenticationResponseJSON {
    const held = this.credentials.get(input.credentialId);
    if (!held) throw new Error(`the software authenticator holds no credential ${input.credentialId}`);
    // No attested credential data at sign-in: rpIdHash, flags and counter only.
    const authData = Buffer.concat([sha256(input.rpId), Buffer.from([flagsByte(input.flags, false)]), counterBytes(input.counter)]);
    const clientDataJSON = clientData("webauthn.get", input.challenge, input.origin);
    const userHandle = input.userHandle === undefined ? held.userHandle : input.userHandle;
    return {
      id: input.credentialId,
      rawId: input.credentialId,
      type: "public-key",
      response: {
        clientDataJSON: base64url(clientDataJSON),
        authenticatorData: base64url(authData),
        signature: base64url(sign(held.privateKey, authData, clientDataJSON)),
        ...(userHandle === null ? {} : { userHandle: base64url(userHandle) }),
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }
}
```

## Step 2: run the tests and watch them fail

```bash
pnpm --filter @korbat/api test
```

Expected: the command exits with an error, and the output contains:

- `Tests  `
- `failed`

Observed on the dry run:

```text
Test Files  2 failed | 36 passed | 32 skipped (70)
Tests  307 passed | 205 skipped (512)
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/passkeys-1c/write_blocks.py docs/superpowers/prompts/passkeys-1c/02-passkey-core.md 3
```

Expected: 2 lines starting with `wrote`, one for each file below.

### Create `apps/api/src/auth/passkeys/challenge.ts`

```ts
import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { AuthError } from "../context";
import { sha256Hex } from "../crypto";
import type { KeyValueStore } from "../kv";
import { MINUTE } from "../limits";

/** Which ceremony a challenge was issued for; a challenge answers only the ceremony it names. */
export type ChallengePurpose = "signin" | "register" | "reauth";

/** How long a challenge is valid: the top of WebAuthn L3's recommended range for a ceremony. */
export const CHALLENGE_TTL_MS = 10 * MINUTE;

const VERSION = 1;
const PURPOSE_CODES: Record<ChallengePurpose, number> = { signin: 1, register: 2, reauth: 3 };

// The layout: version (1 byte), purpose (1), expiry in epoch milliseconds (8, big-endian), nonce (16), binding (16), then
// the first 16 bytes of HMAC-SHA256 over the 42 before them.
const PURPOSE_AT = 1;
const EXPIRY_AT = 2;
const NONCE_AT = 10;
const BINDING_AT = 26;
const MAC_AT = 42;
const NONCE_BYTES = 16;
const BINDING_BYTES = 16;
const MAC_BYTES = 16;
const CHALLENGE_BYTES = 58;
/** 58 bytes as unpadded base64url. */
const ENCODED_LENGTH = 78;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** The used-challenge markers in the key-value store, keyed by the challenge's hash rather than the challenge itself. */
const USED_PREFIX = "webauthn-used:";

const derivedKeys = new WeakMap<Buffer, Buffer>();

/**
 * The key challenges are sealed with: HKDF-SHA256 of AUTH_HMAC_KEY under its own label, so no other use of that key can
 * produce a valid seal. It is derived once per key buffer; the flows can ask for it on every request.
 */
export function challengeKey(authHmacKey: Buffer): Buffer {
  let key = derivedKeys.get(authHmacKey);
  if (!key) {
    key = Buffer.from(hkdfSync("sha256", authHmacKey, "", "korbat-webauthn-challenge", 32));
    derivedKeys.set(authHmacKey, key);
  }
  return key;
}

const invalid = () => new AuthError("passkey_invalid", 401);
const expired = () => new AuthError("challenge_expired", 400);

/** The first 16 bytes of sha256(session handle) for a challenge tied to a session, zeros for one that is not (sign-in). */
function binding(sessionHandle: string | undefined): Buffer {
  if (sessionHandle === undefined) return Buffer.alloc(BINDING_BYTES);
  return createHash("sha256").update(sessionHandle).digest().subarray(0, BINDING_BYTES);
}

function seal(key: Buffer, signed: Buffer): Buffer {
  return createHmac("sha256", key).update(signed).digest().subarray(0, MAC_BYTES);
}

/**
 * The challenge's 58 bytes, or null for anything else. Only the canonical encoding is accepted: Node's decoder ignores
 * the spare bits of the last character, so without this check several strings would name the same challenge, and each
 * would get its own used-challenge marker.
 */
function decode(challenge: string): Buffer | null {
  if (typeof challenge !== "string" || challenge.length !== ENCODED_LENGTH || !BASE64URL.test(challenge)) return null;
  const bytes = Buffer.from(challenge, "base64url");
  if (bytes.length !== CHALLENGE_BYTES || bytes.toString("base64url") !== challenge) return null;
  return bytes;
}

/**
 * A stateless WebAuthn challenge: its purpose, its expiry (10 minutes from now), a random nonce and, for registration and
 * re-authentication, a binding to the session's handle, sealed with an HMAC. Handing one out stores nothing, so the
 * unauthenticated sign-in options cannot fill the key-value store.
 */
export function issueChallenge(key: Buffer, purpose: ChallengePurpose, now: Date, sessionHandle?: string): string {
  const bytes = Buffer.alloc(CHALLENGE_BYTES);
  bytes[0] = VERSION;
  bytes[PURPOSE_AT] = PURPOSE_CODES[purpose];
  bytes.writeBigUInt64BE(BigInt(now.getTime() + CHALLENGE_TTL_MS), EXPIRY_AT);
  randomBytes(NONCE_BYTES).copy(bytes, NONCE_AT);
  binding(sessionHandle).copy(bytes, BINDING_AT);
  seal(key, bytes.subarray(0, MAC_AT)).copy(bytes, MAC_AT);
  return bytes.toString("base64url");
}

/**
 * Checks a challenge a ceremony's client data names before any WebAuthn verification runs: the seal first, in constant
 * time, so a forged challenge says nothing about which field failed; then the version, the purpose and the binding
 * (`passkey_invalid`), and only then the expiry (`challenge_expired`), which the app answers by starting over. Pass the
 * session's handle for registration and re-authentication, nothing for sign-in.
 */
export function readChallenge(key: Buffer, challenge: string, purpose: ChallengePurpose, now: Date, sessionHandle?: string): void {
  const bytes = decode(challenge);
  if (!bytes) throw invalid();
  if (!timingSafeEqual(bytes.subarray(MAC_AT), seal(key, bytes.subarray(0, MAC_AT)))) throw invalid();
  if (bytes[0] !== VERSION || bytes[PURPOSE_AT] !== PURPOSE_CODES[purpose]) throw invalid();
  if (!bytes.subarray(BINDING_AT, MAC_AT).equals(binding(sessionHandle))) throw invalid();
  if (now.getTime() >= Number(bytes.readBigUInt64BE(EXPIRY_AT))) throw expired();
}

/**
 * Makes a challenge single-use; call it right after readChallenge, before the WebAuthn verification, so a challenge stays
 * spent whatever happens next. The marker lives for the rest of the challenge's lifetime: after that readChallenge
 * refuses the challenge anyway. A second spend is `passkey_invalid`.
 */
export async function spendChallenge(kv: KeyValueStore, challenge: string, now: Date): Promise<void> {
  const bytes = decode(challenge);
  if (!bytes) throw invalid();
  const remaining = Number(bytes.readBigUInt64BE(EXPIRY_AT)) - now.getTime();
  // Refused as readChallenge refuses it, which also keeps the store from being handed a TTL of zero or less (Redis refuses one).
  if (remaining <= 0) throw expired();
  if (!(await kv.setIfAbsent(USED_PREFIX + sha256Hex(challenge), "1", remaining))) throw invalid();
}
```

### Create `apps/api/src/auth/passkeys/webauthn.ts`

```ts
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@korbat/contracts";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type VerifiedAuthenticationResponse,
  type VerifiedRegistrationResponse,
} from "@simplewebauthn/server";
import { decodeAttestationObject, decodeClientDataJSON, isoBase64URL } from "@simplewebauthn/server/helpers";
import { AuthError } from "../context";
import { MINUTE } from "../limits";

// This is the only file that imports @simplewebauthn/server: everything the library decides passes through here, with
// korbat's settings pinned, and every library failure leaves as passkey_invalid.

export type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON };

/**
 * How long the browser's prompt may stay open: half the challenge's lifetime, so a modal prompt ends before its challenge
 * expires. Conditional mediation (autofill) ignores it; the app restarts that request itself.
 */
export const CEREMONY_TIMEOUT_MS = 5 * MINUTE;

/**
 * Ed25519, ES256 and RS256, pinned on the options and on the verification alike. The library's runtime default adds
 * ML-DSA (-48) on Node 24, which Node still marks experimental.
 */
export const SUPPORTED_ALGORITHMS: readonly number[] = [-8, -7, -257];

/** WebAuthn L3 caps credential ids at this many bytes and has the relying party refuse a longer one at registration; the library does not. */
export const MAX_CREDENTIAL_ID_BYTES = 1023;

/** The transports WebAuthn L3 defines, plus "cable", the older name of hybrid that some browsers still report. */
const KNOWN_TRANSPORTS = new Set(["usb", "nfc", "ble", "smart-card", "hybrid", "internal", "cable"]);
const MAX_TRANSPORTS = 5;

/** The contracts' bound on clientDataJSON, applied again here for callers that did not come through them. */
const MAX_CLIENT_DATA_CHARS = 4 * 1024;
/** Well above the 78 characters of a korbat challenge; anything longer is not one, and is not worth hashing. */
const MAX_CHALLENGE_CHARS = 128;

const invalid = () => new AuthError("passkey_invalid", 401);

/** A credential in an options list: its id as base64url and the transports it was registered with. */
export interface CredentialDescriptor {
  id: string;
  transports: string[];
}

/** Only these two members reach the options JSON, whatever else the caller's objects carry. */
const descriptor = ({ id, transports }: CredentialDescriptor) => ({ id, transports });

/**
 * The challenge's own bytes. Given a string, the library would encode its UTF-8 text again, and the options (and so the
 * browser's client data) would carry a different string from the one korbat issued and checks.
 */
function challengeBytes(challenge: string): Uint8Array<ArrayBuffer> {
  const bytes = Uint8Array.from(Buffer.from(challenge, "base64url"));
  if (Buffer.from(bytes).toString("base64url") !== challenge) throw new Error("a WebAuthn challenge must be canonical base64url, as issueChallenge writes it");
  return bytes;
}

/**
 * Options for navigator.credentials.create: a discoverable credential (the passkey signs in without an email), user
 * verification preferred but never required, no attestation, the pinned algorithms, and the account's passkeys listed
 * so an authenticator that already holds one of them does not add another.
 */
export async function registrationOptions(input: {
  rp: { id: string; name: string };
  /** The account's WebAuthn user handle (never its account id), and the label the password manager shows. */
  user: { id: Uint8Array; name: string; displayName: string };
  exclude: CredentialDescriptor[];
  challenge: string;
}): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return generateRegistrationOptions({
    rpName: input.rp.name,
    rpID: input.rp.id,
    userName: input.user.name,
    userDisplayName: input.user.displayName,
    // 14.0.2 takes the user handle as bytes only; it refuses a string.
    userID: Uint8Array.from(input.user.id),
    challenge: challengeBytes(input.challenge),
    timeout: CEREMONY_TIMEOUT_MS,
    attestationType: "none",
    excludeCredentials: input.exclude.map(descriptor),
    // A new object on every call: the library writes requireResidentKey into the object it is given.
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
    supportedAlgorithmIDs: [...SUPPORTED_ALGORITHMS],
  });
}

/**
 * Options for navigator.credentials.get. Sign-in passes an empty allow list, so the options say nothing about any account
 * and the browser offers every passkey it holds for the RP; re-authentication lists the account's usable passkeys.
 */
export async function authenticationOptions(input: { rpId: string; allow: CredentialDescriptor[]; challenge: string }): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({
    rpID: input.rpId,
    allowCredentials: input.allow.map(descriptor),
    challenge: challengeBytes(input.challenge),
    timeout: CEREMONY_TIMEOUT_MS,
    userVerification: "preferred",
  });
}

/** The format and statement of an attestation object, or null when it is not a CBOR map holding a text format and a statement map. */
function attestationFormat(attestationObject: string): { fmt: string; attStmt: Map<unknown, unknown> } | null {
  try {
    const decoded: unknown = decodeAttestationObject(isoBase64URL.toBuffer(attestationObject));
    if (!(decoded instanceof Map)) return null;
    const fmt: unknown = decoded.get("fmt");
    const attStmt: unknown = decoded.get("attStmt");
    return typeof fmt === "string" && attStmt instanceof Map ? { fmt, attStmt } : null;
  } catch {
    return null;
  }
}

/** Known values only, each once, five at most: the library hands back whatever the client sent. */
function knownTransports(reported: unknown): string[] {
  if (!Array.isArray(reported)) return [];
  const kept: string[] = [];
  for (const transport of reported) {
    if (kept.length === MAX_TRANSPORTS) break;
    if (typeof transport === "string" && KNOWN_TRANSPORTS.has(transport) && !kept.includes(transport)) kept.push(transport);
  }
  return kept;
}

/** What korbat stores of a verified registration. */
export interface VerifiedRegistration {
  /** From the authenticator data, base64url; the library never compares it with the response's id, so the response's id is not used. */
  credentialId: string;
  /** The COSE public key as base64url, as auth.passkeys.public_key holds it. */
  publicKey: string;
  counter: number;
  transports: string[];
  aaguid: string;
  /** The BE flag: the key may be synced to the owner's other devices. */
  backupEligible: boolean;
  /** The BS flag: the key is backed up now. */
  backedUp: boolean;
  /** The UV flag. Only a passkey registered with it counts as two factors when a later sign-in is verified too. */
  userVerified: boolean;
}

/**
 * Verifies a registration response whose challenge the caller has already read and spent. The attestation format is
 * checked before the library sees the response: only `none`, or `packed` with no x5c chain (a self attestation), pass;
 * anything else is passkey_unsupported. The format comes from the client whatever the options asked for, and the library
 * fetches revocation lists, with no timeout or size limit, for the formats that carry certificates.
 */
export async function verifyRegistration(input: { response: RegistrationResponseJSON; expectedChallenge: string; origins: string[]; rpId: string }): Promise<VerifiedRegistration> {
  const format = attestationFormat(input.response.response.attestationObject);
  if (!format) throw invalid();
  if (!(format.fmt === "none" || (format.fmt === "packed" && !format.attStmt.has("x5c")))) throw new AuthError("passkey_unsupported", 400);

  let result: VerifiedRegistrationResponse;
  try {
    result = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: input.expectedChallenge,
      expectedOrigin: input.origins,
      expectedRPID: input.rpId,
      // User verification is preferred, never required, so security keys without a PIN still work; the flows read the
      // UV flag instead to decide what the passkey proves.
      requireUserVerification: false,
      supportedAlgorithmIDs: [...SUPPORTED_ALGORITHMS],
    });
  } catch {
    throw invalid();
  }
  if (!result.verified) throw invalid();
  const { credential, aaguid, credentialDeviceType, credentialBackedUp, userVerified } = result.registrationInfo;
  if (Buffer.from(credential.id, "base64url").length > MAX_CREDENTIAL_ID_BYTES) throw invalid();
  return {
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    transports: knownTransports(credential.transports),
    aaguid,
    backupEligible: credentialDeviceType === "multiDevice",
    backedUp: credentialBackedUp,
    userVerified,
  };
}

/** What an assertion proved: the counter to compare with the stored one, and the flags. */
export interface VerifiedAuthentication {
  newCounter: number;
  userVerified: boolean;
  backedUp: boolean;
}

/**
 * Verifies an assertion against a stored passkey, whose challenge the caller has already read and spent. The library is
 * given a stored counter of 0, so it never refuses on a counter: it would do that before checking the signature, and an
 * unsigned response could then pass for a clone. The caller applies isCounterRegression once the signature has checked.
 */
export async function verifyAuthentication(input: {
  response: AuthenticationResponseJSON;
  expectedChallenge: string;
  origins: string[];
  rpId: string;
  /** The stored passkey: its credential id and COSE public key as base64url, and its transports. */
  credential: { id: string; publicKey: string; transports: string[] };
}): Promise<VerifiedAuthentication> {
  let result: VerifiedAuthenticationResponse;
  try {
    result = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: input.expectedChallenge,
      expectedOrigin: input.origins,
      expectedRPID: input.rpId,
      credential: { id: input.credential.id, publicKey: isoBase64URL.toBuffer(input.credential.publicKey), counter: 0, transports: input.credential.transports },
      requireUserVerification: false,
    });
  } catch {
    throw invalid();
  }
  if (!result.verified) throw invalid();
  const info = result.authenticationInfo;
  return { newCounter: info.newCounter, userVerified: info.userVerified, backedUp: info.credentialBackedUp };
}

/**
 * WebAuthn L3, section 6.1.1: a signature counter that did not move past the stored one suggests a copy of the key.
 * Two zeros are not a regression: Apple passkeys, like other synced ones, always report 0.
 */
export function isCounterRegression(stored: number, next: number): boolean {
  return (next > 0 || stored > 0) && next <= stored;
}

/**
 * The challenge a ceremony's client data names. The flows run readChallenge and spendChallenge on it before any
 * verification, so a response to a forged, foreign or spent challenge never reaches the library.
 */
export function readResponseChallenge(response: { response: { clientDataJSON: string } }): string {
  const { clientDataJSON } = response.response;
  if (typeof clientDataJSON !== "string" || clientDataJSON.length > MAX_CLIENT_DATA_CHARS) throw invalid();
  let challenge: unknown;
  try {
    const clientData: unknown = decodeClientDataJSON(clientDataJSON);
    challenge = typeof clientData === "object" && clientData !== null ? (clientData as { challenge?: unknown }).challenge : undefined;
  } catch {
    throw invalid();
  }
  if (typeof challenge !== "string" || challenge.length === 0 || challenge.length > MAX_CHALLENGE_CHARS) throw invalid();
  return challenge;
}
```

## Step 4: verify: typecheck

```bash
pnpm typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`
- `ERR_PNPM`

Observed on the dry run:

```text
(no output)
```

## Step 5: verify: test

```bash
pnpm test
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
packages/rules test:       Tests  4 passed (4)
packages/contracts test:       Tests  86 passed (86)
packages/db test:       Tests  27 passed (27)
packages/media-protocol test:       Tests  21 passed (21)
apps/app test:       Tests  32 passed (32)
apps/worker test:       Tests  45 passed (45)
apps/api test:       Tests  350 passed | 205 skipped (555)
```

## Step 6: verify: integration

```bash
cd apps/api && set -a && . ./.env && set +a && pnpm test:integration
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
Tests  203 passed (203)
```

## Step 7: verify: api-bundle

```bash
pnpm --filter @korbat/api build 2>&1 | tail -2 && node --check apps/api/dist/index.js && echo bundle-ok
```

Expected output contains:

- `Build success`
- `bundle-ok`

Must not contain:

- `SyntaxError`

Observed on the dry run:

```text
Build success
bundle-ok
```

## Step 8: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/auth/passkeys/challenge.ts`
- `apps/api/src/auth/passkeys/webauthn.ts`
- `apps/api/test/auth/passkey-challenge.test.ts`
- `apps/api/test/auth/passkey-webauthn.test.ts`
- `apps/api/test/auth/soft-authenticator.test.ts`
- `apps/api/test/auth/soft-authenticator.ts`

## Step 9: commit

```bash
git add -A
git commit -q -m "feat(api): the passkey core: stateless HMAC-sealed challenges (purpose, expiry, nonce, session binding) that are spent once through the key-value store; one wrapper around SimpleWebAuthn 14 that pins the algorithms, accepts only the none and self-attested packed formats, caps the credential id, keeps known transports only and leaves the counter rule to the flows; readResponseChallenge; and a software authenticator for the tests" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(api): the passkey core: stateless HMAC-sealed challenges (purpose, expiry, nonce, session binding) that are spent once through the key-value store; one wrapper around SimpleWebAuthn 14 that pins the algorithms, accepts only the none and self-attested packed formats, caps the credential id, keeps known transports only and leaves the counter rule to the flows; readResponseChallenge; and a software authenticator for the tests`.

## Report format (mandatory)

```text
TASK 2 REPORT
Files written: <count, expected 6>
Failing-test step (the error line): <paste>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "integration": <paste the expected lines as printed>
Verify "api-bundle": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
