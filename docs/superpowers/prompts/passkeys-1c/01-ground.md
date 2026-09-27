# korbat passkeys (1c) — Task 1 of 9: The ground for passkeys: SimpleWebAuthn 14.0.2 and the browser package 14.0.0 under the release-age floor, the passkey contracts and error codes, migration 0010 (the user handle, the passkey columns, the session handle, factors and passkey id, three event types), the WebAuthn configuration with its production guards, and three mail templates

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-25 to 2026-09-27 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous social platform with a fully self-owned backend: a Hono API on Node 24, an Expo web app, PostgreSQL 18 and Valkey in Docker Compose. Sub-project 1c adds passkeys: sign-in and re-authentication with a passkey through SimpleWebAuthn, with korbat's own checks around the library, session factors that make credential changes on an account with TOTP need two factors, and a lockdown routine behind every undo link. This task lays the ground: the two SimpleWebAuthn packages under the 7-day release-age floor, the passkey contracts and error codes, migration 0010, the WebAuthn configuration with its production guards and three mail templates. The design is `docs/superpowers/specs/2026-09-25-passkeys-1c-design.md`.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. The `install` step runs with `--config.minimum-release-age=0` for that one command, and the `lockfile-age` step then proves that every newly locked version is at least 7 days old. `pnpm-lock.yaml` is written by the install, never by hand. Never edit `pnpm-workspace.yaml` or `.npmrc`, and never add a package this task does not name.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `docs: passkeys (1c) plan and verified execution prompts`.

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
python docs/superpowers/prompts/passkeys-1c/write_blocks.py docs/superpowers/prompts/passkeys-1c/01-ground.md 1
```

Expected: 9 lines starting with `wrote`, one for each file below.

### Create `apps/api/test/auth/messages.test.ts`

```ts
import { AuthErrorCode } from "@korbat/contracts";
import { describe, expect, test } from "vitest";
import { AuthError, authErrorMessage } from "../../src/auth/context";

describe("auth error messages", () => {
  test("every code the contracts list has a message", () => {
    for (const code of AuthErrorCode.options) expect(authErrorMessage(code).length, code).toBeGreaterThan(10);
  });

  test("the passkey codes answer with the wording of the 1c design (section 9)", () => {
    expect(authErrorMessage("passkey_invalid")).toBe("That passkey did not work. Try again or use your email.");
    expect(authErrorMessage("passkey_unsupported")).toBe("This passkey provider is not supported. Try another one.");
    // The cap; the daily bound passes its own message with the hours left (1c design, section 9).
    expect(authErrorMessage("passkey_limit")).toBe("You have 10 passkeys. Remove one to add another.");
    expect(authErrorMessage("passkey_suspended")).toBe("This passkey was switched off because a copy of it may exist. Remove it and add a new one.");
    expect(authErrorMessage("passkey_not_found")).toBe("That passkey is gone.");
    expect(authErrorMessage("challenge_expired")).toBe("That took too long. Try again.");
  });

  test("an AuthError carries the message of its code unless the flow gives its own", () => {
    expect(new AuthError("passkey_not_found", 404).message).toBe("That passkey is gone.");
    const daily = new AuthError("passkey_limit", 409, "You added 5 passkeys today. You can add another in about 3 hours.");
    expect(daily).toMatchObject({ code: "passkey_limit", status: 409, message: "You added 5 passkeys today. You can add another in about 3 hours." });
  });
});
```

### Create `apps/api/test/integration/passkeys-schema.test.ts`

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, createDb, devices, passkeys, sessions, users, type Db } from "@korbat/db";
import { isUniqueViolation } from "../../src/auth/context";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { newUserWithDevice } from "./auth-fixtures";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The error a statement ends with, or null when it succeeded. */
const failure = (statement: PromiseLike<unknown>) => Promise.resolve(statement).then(
  () => null,
  (err: unknown) => err,
);

/**
 * Migration 0010 against the real database. Every statement runs as korbat_auth, the role the auth module uses, so
 * each one that passes also shows that the tables' row-level security policies still cover the new columns.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the passkey schema", () => {
  let db: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_AUTH, { max: 2 });
    repo = createAuthRepo(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });

  async function newSession(userId: string, deviceId: string) {
    const id = sha256Hex(randomToken());
    const now = new Date();
    await repo.createSession({ id, userId, deviceId, now, expiresAt: new Date(now.getTime() + 60_000), absoluteExpiresAt: new Date(now.getTime() + 86_400_000) });
    const [row] = await db.select({ handle: sessions.handle, factors: sessions.factors, passkeyId: sessions.passkeyId }).from(sessions).where(eq(sessions.id, id));
    return { id, ...row! };
  }

  async function newPasskey(userId: string, createdDeviceId: string | null) {
    const [row] = await db.insert(passkeys).values({ userId, credentialId: randomToken(), publicKey: "cose-key", name: "Passkey", createdDeviceId }).returning();
    return row!;
  }

  test("a WebAuthn user handle is stored as bytea, read back as the same bytes, and held to one account", async () => {
    const owner = await newUserWithDevice(repo);
    const other = await newUserWithDevice(repo);
    expect(owner.user.webauthnUserId).toBeNull();
    const handle = randomBytes(32);
    const [written] = await db.update(users).set({ webauthnUserId: handle }).where(eq(users.id, owner.user.id)).returning({ webauthnUserId: users.webauthnUserId });
    expect(Buffer.isBuffer(written!.webauthnUserId)).toBe(true);
    expect(written!.webauthnUserId).toEqual(handle);
    // Found by its bytes, as the user handle of an assertion is compared.
    const [found] = await db.select({ id: users.id }).from(users).where(eq(users.webauthnUserId, handle));
    expect(found?.id).toBe(owner.user.id);
    expect(isUniqueViolation(await failure(db.update(users).set({ webauthnUserId: handle }).where(eq(users.id, other.user.id))))).toBe(true);
  });

  test("each session gets its own random handle, empty factors and no passkey, and holds factors as kind to milliseconds", async () => {
    const { user, device } = await newUserWithDevice(repo);
    const one = await newSession(user.id, device.id);
    const two = await newSession(user.id, device.id);
    expect(one.handle).toMatch(UUID_V4);
    expect(two.handle).toMatch(UUID_V4);
    expect(two.handle).not.toBe(one.handle);
    expect(one).toMatchObject({ factors: {}, passkeyId: null });
    expect(isUniqueViolation(await failure(db.update(sessions).set({ handle: one.handle }).where(eq(sessions.id, two.id))))).toBe(true);
    await db.update(sessions).set({ factors: { email: 1_790_000_000_000, totp: 1_790_000_060_000 } }).where(eq(sessions.id, one.id));
    const [row] = await db.select({ factors: sessions.factors }).from(sessions).where(eq(sessions.id, one.id));
    expect(row?.factors).toEqual({ email: 1_790_000_000_000, totp: 1_790_000_060_000 });
  });

  test("a new passkey starts with both flags off, no AAGUID and no suspicion, and its credential id stays unique", async () => {
    const { user, device } = await newUserWithDevice(repo);
    const passkey = await newPasskey(user.id, device.id);
    expect(passkey).toMatchObject({ aaguid: null, backupEligible: false, uvInitialized: false, createdDeviceId: device.id, suspectAt: null });
    const aaguid = randomUUID();
    const suspectAt = new Date();
    const [updated] = await db.update(passkeys).set({ aaguid, backupEligible: true, uvInitialized: true, suspectAt }).where(eq(passkeys.id, passkey.id)).returning();
    expect(updated).toMatchObject({ aaguid, backupEligible: true, uvInitialized: true, suspectAt });
    const copy = db.insert(passkeys).values({ userId: user.id, credentialId: passkey.credentialId, publicKey: "cose-key", name: "Copy" });
    expect(isUniqueViolation(await failure(copy))).toBe(true);
  });

  test("removing a passkey keeps the sessions it started, without it; removing a device keeps the passkeys it added, without it", async () => {
    const { user, device } = await newUserWithDevice(repo);
    const passkey = await newPasskey(user.id, device.id);
    const session = await newSession(user.id, device.id);
    await db.update(sessions).set({ passkeyId: passkey.id }).where(eq(sessions.id, session.id));
    await db.delete(passkeys).where(eq(passkeys.id, passkey.id));
    const [after] = await db.select({ passkeyId: sessions.passkeyId, revokedAt: sessions.revokedAt }).from(sessions).where(eq(sessions.id, session.id));
    expect(after).toEqual({ passkeyId: null, revokedAt: null });

    const kept = await newPasskey(user.id, device.id);
    await db.delete(devices).where(eq(devices.id, device.id));
    const [orphan] = await db.select({ createdDeviceId: passkeys.createdDeviceId }).from(passkeys).where(eq(passkeys.id, kept.id));
    expect(orphan).toEqual({ createdDeviceId: null });
  });

  test("adding, removing and a counter regression of a passkey are recorded as security events", async () => {
    const { user, device } = await newUserWithDevice(repo);
    const types = ["passkey_added", "passkey_removed", "passkey_counter_regression"] as const;
    for (const type of types) await repo.appendEvent({ userId: user.id, type, deviceId: device.id, metadata: { passkeyId: randomUUID() } });
    expect((await repo.eventsSince(user.id, new Date(0))).map((event) => event.type).sort()).toEqual([...types].sort());
  });
});
```

### Create `packages/contracts/test/passkeys.test.ts`

```ts
import { describe, expect, test } from "vitest";
import {
  AuthenticationResponseJSON,
  PasskeyLabel,
  PasskeyListResponse,
  PasskeyName,
  PasskeyOptionsResponse,
  PasskeyRegisterOptionsRequest,
  PasskeyRegisterVerifyRequest,
  PasskeyRemoveLinkRequest,
  PasskeyRenameRequest,
  PasskeySignInVerifyRequest,
  PasskeyView,
  PasswordSigninRequest,
  RegistrationResponseJSON,
} from "../src/index";

const BELL = String.fromCharCode(7);
const NEWLINE = String.fromCharCode(10);
/** U+202E, the right-to-left override: invisible, and refused by the display-name rules. */
const RLO = String.fromCharCode(0x202e);

/** A base64url string of exactly n characters. */
const b64 = (n: number) => "A".repeat(n);

const at = "2026-09-25T10:00:00.000Z";
const token = "a".repeat(43);

/** What @simplewebauthn/browser's startRegistration returns for a platform passkey, trimmed to realistic sizes. */
const registration = {
  id: "q2Xx0w8bRk6nV8yQ0f2mUg",
  rawId: "q2Xx0w8bRk6nV8yQ0f2mUg",
  type: "public-key",
  response: { clientDataJSON: b64(200), attestationObject: b64(400), transports: ["internal", "hybrid"] },
  clientExtensionResults: { credProps: { rk: true } },
  authenticatorAttachment: "platform",
};

/** What startAuthentication returns for a discoverable passkey: the user handle is there. */
const assertion = {
  id: "q2Xx0w8bRk6nV8yQ0f2mUg",
  rawId: "q2Xx0w8bRk6nV8yQ0f2mUg",
  type: "public-key",
  response: { clientDataJSON: b64(200), authenticatorData: b64(50), signature: b64(96), userHandle: b64(43) },
  clientExtensionResults: {},
  authenticatorAttachment: "cross-platform",
};

const withResponse = <T extends { response: object }>(base: T, response: Record<string, unknown>) => ({ ...base, response: { ...base.response, ...response } });

describe("passkey names and labels", () => {
  test("follow the display-name rules: trimmed, 1 to 50 characters", () => {
    for (const schema of [PasskeyName, PasskeyLabel]) {
      expect(schema.parse("  Ada's phone ")).toBe("Ada's phone");
      expect(schema.parse("x".repeat(50))).toBe("x".repeat(50));
      expect(schema.safeParse("x".repeat(51)).success).toBe(false);
      expect(schema.safeParse("").success).toBe(false);
      expect(schema.safeParse("   ").success).toBe(false);
    }
  });

  test("refuse control characters and invisible direction characters", () => {
    for (const schema of [PasskeyName, PasskeyLabel]) {
      expect(schema.safeParse(`work${BELL}key`).success).toBe(false);
      expect(schema.safeParse(`work${NEWLINE}key`).success).toBe(false);
      expect(schema.safeParse(`work${RLO}key`).success).toBe(false);
    }
  });
});

describe("passkey views", () => {
  const view = {
    id: "3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a",
    name: "Work laptop",
    createdAt: at,
    lastUsedAt: at,
    synced: true,
    createdOn: "Chrome on Windows",
    current: true,
    isNew: false,
    suspended: false,
  };

  test("carry the name, the dates, the flags and the creating device", () => {
    expect(PasskeyView.parse(view)).toEqual(view);
    // A passkey never used since it was added, whose creating device is gone.
    const unused = { ...view, lastUsedAt: null, createdOn: null, current: false, isNew: true };
    expect(PasskeyView.parse(unused)).toEqual(unused);
  });

  test("need every field, with its type", () => {
    for (const key of Object.keys(view)) {
      const partial: Record<string, unknown> = { ...view };
      delete partial[key];
      expect(PasskeyView.safeParse(partial).success, key).toBe(false);
    }
    expect(PasskeyView.safeParse({ ...view, id: "nope" }).success).toBe(false);
    expect(PasskeyView.safeParse({ ...view, createdAt: "yesterday" }).success).toBe(false);
    expect(PasskeyView.safeParse({ ...view, suspended: "no" }).success).toBe(false);
  });

  test("the list holds views and may be empty", () => {
    expect(PasskeyListResponse.parse({ passkeys: [view] })).toEqual({ passkeys: [view] });
    expect(PasskeyListResponse.parse({ passkeys: [] })).toEqual({ passkeys: [] });
    expect(PasskeyListResponse.safeParse({}).success).toBe(false);
  });
});

describe("ceremony options", () => {
  test("registration options are asked for with the label the password manager shows", () => {
    expect(PasskeyRegisterOptionsRequest.parse({ label: " ada " })).toEqual({ label: "ada" });
    expect(PasskeyRegisterOptionsRequest.safeParse({}).success).toBe(false);
    expect(PasskeyRegisterOptionsRequest.safeParse({ label: `ada${BELL}` }).success).toBe(false);
  });

  test("the options come back as the library wrote them, with a base64url challenge", () => {
    const options = {
      challenge: b64(78),
      rp: { name: "korbat", id: "korbat.example" },
      user: { id: b64(43), name: "ada", displayName: "ada" },
      pubKeyCredParams: [{ alg: -8, type: "public-key" }],
      timeout: 300000,
      excludeCredentials: [],
      authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
      attestation: "none",
    };
    // Everything but the challenge passes through untouched: the browser library reads it, not korbat.
    expect(PasskeyOptionsResponse.parse({ options })).toEqual({ options });
    expect(PasskeyOptionsResponse.parse({ options: { challenge: "abc_-XYZ" } })).toEqual({ options: { challenge: "abc_-XYZ" } });
  });

  test("options without a base64url challenge, or that are not an object, are refused", () => {
    expect(PasskeyOptionsResponse.safeParse({ options: {} }).success).toBe(false);
    expect(PasskeyOptionsResponse.safeParse({ options: { challenge: "" } }).success).toBe(false);
    expect(PasskeyOptionsResponse.safeParse({ options: { challenge: "abc+/" } }).success).toBe(false);
    expect(PasskeyOptionsResponse.safeParse({ options: { challenge: "abc=" } }).success).toBe(false);
    expect(PasskeyOptionsResponse.safeParse({ options: "challenge" }).success).toBe(false);
    expect(PasskeyOptionsResponse.safeParse({ options: [b64(10)] }).success).toBe(false);
  });
});

describe("the registration response", () => {
  test("accepts what the browser library returns", () => {
    expect(RegistrationResponseJSON.parse(registration)).toEqual(registration);
    const bare = { ...registration, response: { clientDataJSON: b64(200), attestationObject: b64(400) } };
    delete (bare as Record<string, unknown>).authenticatorAttachment;
    expect(RegistrationResponseJSON.parse(bare)).toEqual(bare);
  });

  test("drops the members korbat does not read, which the attestation object carries anyway", () => {
    const extra = withResponse(registration, { publicKey: b64(120), publicKeyAlgorithm: -7, authenticatorData: b64(160) });
    expect(RegistrationResponseJSON.parse({ ...extra, surprise: b64(10) })).toEqual(registration);
  });

  test("bounds the credential id at 1400 base64url characters", () => {
    for (const key of ["id", "rawId"] as const) {
      expect(RegistrationResponseJSON.safeParse({ ...registration, [key]: b64(1400) }).success, key).toBe(true);
      expect(RegistrationResponseJSON.safeParse({ ...registration, [key]: b64(1401) }).success, key).toBe(false);
      expect(RegistrationResponseJSON.safeParse({ ...registration, [key]: "" }).success, key).toBe(false);
    }
  });

  test("bounds clientDataJSON at 4 KiB and the attestation object at 64 KiB", () => {
    expect(RegistrationResponseJSON.safeParse(withResponse(registration, { clientDataJSON: b64(4096) })).success).toBe(true);
    expect(RegistrationResponseJSON.safeParse(withResponse(registration, { clientDataJSON: b64(4097) })).success).toBe(false);
    expect(RegistrationResponseJSON.safeParse(withResponse(registration, { attestationObject: b64(65536) })).success).toBe(true);
    expect(RegistrationResponseJSON.safeParse(withResponse(registration, { attestationObject: b64(65537) })).success).toBe(false);
  });

  test("takes at most 8 transports of at most 32 characters", () => {
    expect(RegistrationResponseJSON.safeParse(withResponse(registration, { transports: Array(8).fill("usb") })).success).toBe(true);
    expect(RegistrationResponseJSON.safeParse(withResponse(registration, { transports: Array(9).fill("usb") })).success).toBe(false);
    expect(RegistrationResponseJSON.safeParse(withResponse(registration, { transports: ["x".repeat(32)] })).success).toBe(true);
    expect(RegistrationResponseJSON.safeParse(withResponse(registration, { transports: ["x".repeat(33)] })).success).toBe(false);
    expect(RegistrationResponseJSON.safeParse(withResponse(registration, { transports: [""] })).success).toBe(false);
    expect(RegistrationResponseJSON.safeParse(withResponse(registration, { transports: "usb" })).success).toBe(false);
  });

  test("needs base64url, the public-key type, an extension-results object and a known attachment", () => {
    expect(RegistrationResponseJSON.safeParse({ ...registration, id: "q2Xx+w8b/k6nV8yQ" }).success).toBe(false);
    expect(RegistrationResponseJSON.safeParse(withResponse(registration, { attestationObject: `${b64(10)}=` })).success).toBe(false);
    expect(RegistrationResponseJSON.safeParse(withResponse(registration, { attestationObject: undefined })).success).toBe(false);
    expect(RegistrationResponseJSON.safeParse(withResponse(registration, { clientDataJSON: undefined })).success).toBe(false);
    expect(RegistrationResponseJSON.safeParse({ ...registration, type: "password" }).success).toBe(false);
    expect(RegistrationResponseJSON.safeParse({ ...registration, clientExtensionResults: undefined }).success).toBe(false);
    expect(RegistrationResponseJSON.safeParse({ ...registration, clientExtensionResults: "none" }).success).toBe(false);
    expect(RegistrationResponseJSON.safeParse({ ...registration, clientExtensionResults: [] }).success).toBe(false);
    expect(RegistrationResponseJSON.safeParse({ ...registration, authenticatorAttachment: "roaming" }).success).toBe(false);
    expect(RegistrationResponseJSON.safeParse({ ...registration, response: undefined }).success).toBe(false);
  });
});

describe("the authentication response", () => {
  test("accepts what the browser library returns, with or without a user handle", () => {
    expect(AuthenticationResponseJSON.parse(assertion)).toEqual(assertion);
    const { userHandle: _dropped, ...response } = assertion.response;
    expect(AuthenticationResponseJSON.parse({ ...assertion, response })).toEqual({ ...assertion, response });
  });

  test("bounds the credential id at 1400 base64url characters", () => {
    for (const key of ["id", "rawId"] as const) {
      expect(AuthenticationResponseJSON.safeParse({ ...assertion, [key]: b64(1400) }).success, key).toBe(true);
      expect(AuthenticationResponseJSON.safeParse({ ...assertion, [key]: b64(1401) }).success, key).toBe(false);
    }
  });

  test("bounds clientDataJSON and authenticatorData at 4 KiB, the signature at 1 KiB and the user handle at 128 characters", () => {
    const bounds = { clientDataJSON: 4096, authenticatorData: 4096, signature: 1024, userHandle: 128 };
    for (const [key, max] of Object.entries(bounds)) {
      expect(AuthenticationResponseJSON.safeParse(withResponse(assertion, { [key]: b64(max) })).success, key).toBe(true);
      expect(AuthenticationResponseJSON.safeParse(withResponse(assertion, { [key]: b64(max + 1) })).success, key).toBe(false);
      expect(AuthenticationResponseJSON.safeParse(withResponse(assertion, { [key]: "" })).success, key).toBe(false);
      expect(AuthenticationResponseJSON.safeParse(withResponse(assertion, { [key]: "ab/cd" })).success, key).toBe(false);
    }
  });

  test("needs the signature, the authenticator data and the public-key type", () => {
    expect(AuthenticationResponseJSON.safeParse(withResponse(assertion, { signature: undefined })).success).toBe(false);
    expect(AuthenticationResponseJSON.safeParse(withResponse(assertion, { authenticatorData: undefined })).success).toBe(false);
    expect(AuthenticationResponseJSON.safeParse({ ...assertion, type: "otp" }).success).toBe(false);
    expect(AuthenticationResponseJSON.safeParse({ ...assertion, clientExtensionResults: null }).success).toBe(false);
  });
});

describe("passkey requests", () => {
  test("register verify takes the response and an optional name under the display-name rules", () => {
    expect(PasskeyRegisterVerifyRequest.parse({ response: registration })).toEqual({ response: registration });
    expect(PasskeyRegisterVerifyRequest.parse({ name: " Work laptop ", response: registration })).toEqual({ name: "Work laptop", response: registration });
    expect(PasskeyRegisterVerifyRequest.safeParse({ name: `Work${BELL}`, response: registration }).success).toBe(false);
    expect(PasskeyRegisterVerifyRequest.safeParse({ name: "x".repeat(51), response: registration }).success).toBe(false);
    expect(PasskeyRegisterVerifyRequest.safeParse({ name: "Work laptop" }).success).toBe(false);
    // An assertion is not a registration.
    expect(PasskeyRegisterVerifyRequest.safeParse({ response: assertion }).success).toBe(false);
  });

  test("sign-in verify takes the response plus exactly the device fields of the password sign-in", () => {
    const request = { response: assertion, deviceId: "d".repeat(22), platform: "web" };
    expect(PasskeySignInVerifyRequest.parse(request)).toEqual(request);
    expect(Object.keys(PasskeySignInVerifyRequest.shape).sort()).toEqual(["deviceId", "platform", "response"]);
    expect(PasskeySignInVerifyRequest.shape.deviceId).toBe(PasswordSigninRequest.shape.deviceId);
    expect(PasskeySignInVerifyRequest.shape.platform).toBe(PasswordSigninRequest.shape.platform);
    expect(PasskeySignInVerifyRequest.safeParse({ ...request, deviceId: "short" }).success).toBe(false);
    expect(PasskeySignInVerifyRequest.safeParse({ ...request, platform: "desktop" }).success).toBe(false);
    expect(PasskeySignInVerifyRequest.safeParse({ response: assertion, platform: "web" }).success).toBe(false);
    expect(PasskeySignInVerifyRequest.safeParse({ ...request, response: registration }).success).toBe(false);
  });

  test("rename takes a name under the display-name rules", () => {
    expect(PasskeyRenameRequest.parse({ name: " Phone " })).toEqual({ name: "Phone" });
    expect(PasskeyRenameRequest.safeParse({ name: `Pho${RLO}ne` }).success).toBe(false);
    expect(PasskeyRenameRequest.safeParse({ name: `Pho${NEWLINE}ne` }).success).toBe(false);
    expect(PasskeyRenameRequest.safeParse({}).success).toBe(false);
  });

  test("the remove link carries one opaque token", () => {
    expect(PasskeyRemoveLinkRequest.parse({ token })).toEqual({ token });
    expect(PasskeyRemoveLinkRequest.safeParse({ token: "a".repeat(42) }).success).toBe(false);
    expect(PasskeyRemoveLinkRequest.safeParse({ token: `${"a".repeat(42)}=` }).success).toBe(false);
    expect(PasskeyRemoveLinkRequest.safeParse({}).success).toBe(false);
  });
});
```

### Replace `apps/api/test/auth/flow-harness.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import pino from "pino";
import type { AuthConfig, AuthDeps, RequestContext } from "../../src/auth/context";
import { parseVersionedKey, randomToken, sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { createLockout } from "../../src/auth/lockout";
import type { AuthEventType, AuthRepo, EmailCodeRow, UserRow } from "../../src/auth/repo";
import { createSessions, type Session } from "../../src/auth/sessions";
import { devProvider } from "../../src/auth/verify/dev";
import { MemoryMailer } from "../../src/mail/memory";

export interface RecordedEvent {
  userId: string | null;
  type: AuthEventType;
  deviceId: string | null;
  metadata: Record<string, unknown>;
}

export const TEST_TERMS = "draft-test";

/** A session or a device of a user, as the deletion flow revokes and removes them. */
export interface RecordedSession {
  id: string;
  userId: string;
  revokedAt: Date | null;
}

export interface RecordedDevice {
  id: string;
  userId: string;
  revokedAt: Date | null;
}

/**
 * The auth flows without a database: users, email codes, sessions and devices live in memory, and the
 * repository fake holds only the methods the email-change (with its undo link), badge and deletion
 * flows call (and the lookups the sign-in starts make), checked against the real signatures. The key-value store and the
 * mailer are the in-memory ones; the clock moves only when a test says so, so expiries and timestamps
 * compare exactly; and events are kept as the server would write them to auth_events. The integration
 * harness (test/integration/flow-harness.ts) runs flows against the real repository instead.
 */
export function memoryFlowHarness(start = 1_789_000_000_000) {
  let t = start;
  const now = () => new Date(t);
  const users = new Map<string, UserRow>();
  const codes: EmailCodeRow[] = [];
  const events: RecordedEvent[] = [];
  const sessions: RecordedSession[] = [];
  const devices: RecordedDevice[] = [];
  /** The handle of each account's profile, which the deletion flow compares the typed handle with. */
  const handles = new Map<string, string>();
  /** Repository methods told to fail: "takeDown" fails its transaction midway, after staging its writes and before any lands. */
  const faults = new Set<"takeDown">();
  /** Step 1's rows for a user, as the real repository's takeDownRows writes them: live sessions revoked (their ids returned), devices and codes gone. */
  const takeDownRows = (userId: string, at: Date): string[] => {
    const live = sessions.filter((s) => s.userId === userId && s.revokedAt === null);
    for (const s of live) s.revokedAt = at;
    for (let i = devices.length - 1; i >= 0; i--) if (devices[i]!.userId === userId) devices.splice(i, 1);
    for (let i = codes.length - 1; i >= 0; i--) if (codes[i]!.userId === userId) codes.splice(i, 1);
    return live.map((s) => s.id);
  };
  const repo = {
    async findUserById(id: string): Promise<UserRow | undefined> {
      const row = users.get(id);
      return row && row.deletedAt === null ? { ...row } : undefined;
    },
    async findUserByEmail(email: string): Promise<UserRow | undefined> {
      // As the real lookup: the address in any case, and never a deleted row.
      const row = [...users.values()].find((u) => u.email.toLowerCase() === email.toLowerCase());
      return row && row.deletedAt === null ? { ...row } : undefined;
    },
    async setPasswordFailures(userId: string, failedLogins: number, lockedUntil: Date | null): Promise<void> {
      const row = users.get(userId);
      if (row) {
        row.failedLogins = failedLogins;
        row.lockedUntil = lockedUntil;
      }
    },
    async createEmailCode(input: Parameters<AuthRepo["createEmailCode"]>[0]): Promise<void> {
      codes.push({ id: randomUUID(), ...input, attempts: 0, consumedAt: null, createdAt: now() });
    },
    async findEmailCode(flowId: string): Promise<EmailCodeRow | undefined> {
      const row = codes.find((c) => c.flowId === flowId);
      return row ? { ...row } : undefined;
    },
    async addCodeAttempt(id: string): Promise<number> {
      const row = codes.find((c) => c.id === id);
      if (!row) return Number.MAX_SAFE_INTEGER;
      row.attempts += 1;
      return row.attempts;
    },
    async consumeEmailCode(id: string, at: Date): Promise<boolean> {
      const row = codes.find((c) => c.id === id);
      if (!row || row.consumedAt !== null) return false;
      row.consumedAt = at;
      return true;
    },
    async changeEmail(userId: string, email: string, at: Date): Promise<void> {
      // As the real unique index on lower(email), deleted rows included: the driver error that the flow recognises through isUniqueViolation.
      for (const other of users.values()) {
        if (other.id !== userId && other.email.toLowerCase() === email.toLowerCase()) {
          throw Object.assign(new Error('duplicate key value violates unique constraint "users_email_lower_idx"'), { code: "23505" });
        }
      }
      const row = users.get(userId);
      if (!row) return;
      row.email = email;
      row.emailVerifiedAt = at;
    },
    async setPasswordHash(userId: string, passwordHash: string | null, at: Date): Promise<void> {
      // As the real statement: setting or clearing a password also clears any lockout, and records when.
      const row = users.get(userId);
      if (row) Object.assign(row, { passwordHash, passwordChangedAt: at, failedLogins: 0, lockedUntil: null });
    },
    async revokeDevices(userId: string, at: Date): Promise<void> {
      for (const device of devices) if (device.userId === userId && device.revokedAt === null) device.revokedAt = at;
    },
    async disableTotp(userId: string): Promise<void> {
      const row = users.get(userId);
      if (row) Object.assign(row, { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodesHash: [] });
    },
    async setPhoneHash(userId: string, phoneHash: string | null): Promise<void> {
      // As the real partial unique index on phone_hash, deleted rows included: the driver error that the flow recognises through isUniqueViolation.
      if (phoneHash !== null) {
        for (const other of users.values()) {
          if (other.id !== userId && other.phoneHash === phoneHash) {
            throw Object.assign(new Error('duplicate key value violates unique constraint "users_phone_hash_idx"'), { code: "23505" });
          }
        }
      }
      const row = users.get(userId);
      if (row) row.phoneHash = phoneHash;
    },
    async appendEvent(input: Parameters<AuthRepo["appendEvent"]>[0]): Promise<void> {
      events.push({ userId: input.userId, type: input.type, deviceId: input.deviceId ?? null, metadata: input.metadata ?? {} });
    },
    async revokeAllSessions(userId: string, at: Date): Promise<string[]> {
      const live = sessions.filter((s) => s.userId === userId && s.revokedAt === null);
      for (const s of live) s.revokedAt = at;
      return live.map((s) => s.id);
    },
    async markDeleted(userId: string, at: Date): Promise<void> {
      const row = users.get(userId);
      if (row && row.deletedAt === null) row.deletedAt = at;
    },
    async takeDown(userId: string, at: Date, deviceId: string | null): Promise<string[]> {
      // One transaction, as the real one: when it fails midway nothing it would have written lands.
      if (faults.has("takeDown")) throw new Error("the take-down transaction failed midway and was rolled back");
      const row = users.get(userId);
      if (row && row.deletedAt === null) row.deletedAt = at;
      const revoked = takeDownRows(userId, at);
      events.push({ userId, type: "account_deleted", deviceId, metadata: {} });
      return revoked;
    },
    async finishTakeDown(userId: string, at: Date): Promise<string[]> {
      // As the real statement: only a row marked deleted and not purged yet.
      const row = users.get(userId);
      if (!row || row.deletedAt === null || row.purgedAt !== null) return [];
      return takeDownRows(userId, at);
    },
    async finishPurge(userId: string, at: Date): Promise<void> {
      const row = users.get(userId);
      if (!row || row.deletedAt === null || row.purgedAt !== null) return;
      Object.assign(row, {
        email: `deleted:${userId}`,
        emailVerifiedAt: null,
        passwordHash: null,
        totpSecretEnc: null,
        totpEnabledAt: null,
        recoveryCodesHash: [],
        phoneHash: null,
        ageConfirmedAt: null,
        termsVersion: null,
        termsAcceptedAt: null,
        purgedAt: at,
      });
    },
  } satisfies Pick<
    AuthRepo,
    | "findUserById"
    | "findUserByEmail"
    | "setPasswordFailures"
    | "createEmailCode"
    | "findEmailCode"
    | "addCodeAttempt"
    | "consumeEmailCode"
    | "changeEmail"
    | "setPasswordHash"
    | "revokeDevices"
    | "disableTotp"
    | "setPhoneHash"
    | "appendEvent"
    | "revokeAllSessions"
    | "markDeleted"
    | "takeDown"
    | "finishTakeDown"
    | "finishPurge"
  >;
  const authRepo = repo as unknown as AuthRepo;
  const kv = new MemoryKv(() => t);
  const mailer = new MemoryMailer();
  /** profiles.verified_at by account, as the badge flows set and clear it through the profile store. */
  const verified = new Map<string, Date | null>();
  const config: AuthConfig = {
    appOrigin: "http://localhost:8081",
    allowedOrigins: ["http://localhost:8081"],
    authHmacKey: Buffer.alloc(32, 3),
    ipHashKey: Buffer.alloc(32, 4),
    totpKey: parseVersionedKey(`v1:${Buffer.alloc(32, 5).toString("base64")}`),
    totpPreviousKeys: [],
    termsVersion: TEST_TERMS,
    trustProxy: "none",
    verifyProvider: "dev",
    webauthn: { rpId: "localhost", rpName: "korbat", origins: ["http://localhost:8081"] },
  };
  const deps: AuthDeps = {
    repo: authRepo,
    kv,
    sessions: createSessions({ repo: authRepo, kv, now }),
    lockout: createLockout({ repo: authRepo, kv, now }),
    mailer,
    turnstile: { verify: async () => true },
    breachChecker: { isBreached: async () => false },
    // The flows this harness runs create no profile; the badge flows only set and clear verified_at, kept above by
    // account, and the deletion flow reads the handle, kept by account as `user` registers it.
    profiles: {
      create: async () => {
        throw new Error("the memory harness has no profile store");
      },
      find: async (id) => {
        const handle = handles.get(id);
        return handle === undefined ? null : { id, handle, displayName: handle, handleChangedAt: null, verified: (verified.get(id) ?? null) !== null };
      },
      setVerified: async (id, at) => {
        verified.set(id, at);
      },
    },
    // The development provider, which accepts exactly 000000; a test swaps it for null or a scripted one.
    verify: devProvider(),
    config,
    log: pino({ level: "silent" }),
    now,
  };
  const ctx: RequestContext = { ipHash: randomToken(), userAgent: undefined };
  /** A live session on a device of its own, both recorded as the deletion flow will find them; its reauth time is now, as behind requireFreshAuth. */
  const session = (userId: string): Session => {
    const s: Session = { sessionId: sha256Hex(randomToken()), userId, deviceId: randomUUID(), role: "user", onboarded: true, mfaEnabled: false, reauthAt: now() };
    sessions.push({ id: s.sessionId, userId, revokedAt: null });
    devices.push({ id: s.deviceId, userId, revokedAt: null });
    return s;
  };
  return {
    deps,
    kv,
    mailer,
    ctx,
    users,
    codes,
    events,
    sessions,
    devices,
    verified,
    faults,
    now,
    advance(ms: number) {
      t += ms;
    },
    /** Another session of an existing account, on another device. */
    session,
    /**
     * An onboarded account holding a verified address, with a session that just proved a credential, as a route
     * behind requireFreshAuth passes it on. Its profile's handle is the address's local part unless given.
     */
    user(email: string, handle: string = email.split("@")[0]!.toLowerCase().replace(/[^a-z0-9_]/g, "_")): { user: UserRow; session: Session } {
      const id = randomUUID();
      const user: UserRow = {
        id,
        email,
        emailVerifiedAt: now(),
        phoneHash: null,
        passwordHash: null,
        totpSecretEnc: null,
        totpEnabledAt: null,
        recoveryCodesHash: [],
        failedLogins: 0,
        lockedUntil: null,
        createdAt: now(),
        deletedAt: null,
        role: "user",
        ageConfirmedAt: now(),
        termsVersion: TEST_TERMS,
        termsAcceptedAt: now(),
        onboardedAt: now(),
        passwordChangedAt: null,
        totpLastStep: null,
        purgedAt: null,
        webauthnUserId: null,
      };
      users.set(id, user);
      handles.set(id, handle);
      return { user, session: session(id) };
    },
  };
}

export type MemoryFlowHarness = ReturnType<typeof memoryFlowHarness>;
```

### Replace `apps/api/test/config.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { authConfigFrom } from "../src/auth/context";
import { loadConfig } from "../src/config";

const key = Buffer.alloc(32, 7).toString("base64");

const good = {
  DATABASE_URL_API: "postgres://korbat_api:x@localhost:5432/korbat",
  DATABASE_URL_AUTH: "postgres://korbat_auth:x@localhost:5432/korbat",
  REDIS_URL: "redis://localhost:6379",
  APP_ORIGIN: "http://localhost:8081",
  AUTH_HMAC_KEY: key,
  IP_HASH_KEY: key,
  TOTP_ENC_KEY: `v1:${key}`,
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  SMTP_URL: "smtp://localhost:1025",
  MAIL_FROM: "korbat <no-reply@korbat.local>",
  TERMS_VERSION: "draft-2026-09",
};

describe("loadConfig", () => {
  test("applies defaults", () => {
    const c = loadConfig(good);
    expect(c.PORT).toBe(3000);
    expect(c.NODE_ENV).toBe("development");
    expect(c.TRUSTED_ORIGINS).toEqual([]);
  });
  test("parses trusted origins list", () => {
    expect(loadConfig({ ...good, TRUSTED_ORIGINS: "http://a.test, http://b.test" }).TRUSTED_ORIGINS).toEqual(["http://a.test", "http://b.test"]);
  });
  test("fails loudly on a missing database url", () => {
    expect(() => loadConfig({ REDIS_URL: good.REDIS_URL })).toThrow(/DATABASE_URL_API/);
  });
  test("rejects keys shorter than 32 bytes", () => {
    expect(() => loadConfig({ ...good, AUTH_HMAC_KEY: Buffer.alloc(16).toString("base64") })).toThrow(/AUTH_HMAC_KEY/);
  });
  test("TOTP key must be versioned and exactly 32 bytes", () => {
    expect(() => loadConfig({ ...good, TOTP_ENC_KEY: key })).toThrow(/TOTP_ENC_KEY/);
    expect(() => loadConfig({ ...good, TOTP_ENC_KEY: `v1:${Buffer.alloc(33).toString("base64")}` })).toThrow(/TOTP_ENC_KEY/);
  });
  test("SMTP_URL must be smtp or smtps", () => {
    expect(() => loadConfig({ ...good, SMTP_URL: "http://relay.example" })).toThrow(/SMTP_URL/);
    expect(loadConfig({ ...good, SMTP_URL: "smtps://user:pass@relay.example:465" }).SMTP_URL).toMatch(/^smtps:/);
  });
  test("every auth variable is required", () => {
    for (const name of ["APP_ORIGIN", "AUTH_HMAC_KEY", "IP_HASH_KEY", "TOTP_ENC_KEY", "TURNSTILE_SECRET_KEY", "SMTP_URL", "MAIL_FROM", "TERMS_VERSION"]) {
      const env: Record<string, string | undefined> = { ...good };
      delete env[name];
      expect(() => loadConfig(env), name).toThrow(new RegExp(name));
    }
  });
  test("TRUST_PROXY defaults to none and accepts the three modes", () => {
    expect(loadConfig(good).TRUST_PROXY).toBe("none");
    for (const mode of ["cloudflare", "caddy", "none"]) expect(loadConfig({ ...good, TRUST_PROXY: mode }).TRUST_PROXY).toBe(mode);
    expect(() => loadConfig({ ...good, TRUST_PROXY: "nginx" })).toThrow(/TRUST_PROXY/);
  });
  describe("production refuses development values", () => {
    const prod = { ...good, NODE_ENV: "production", APP_ORIGIN: "https://korbat.example", TURNSTILE_SECRET_KEY: "0x4AAAAAAA-real-widget-secret" };
    test("accepts a production configuration", () => {
      expect(loadConfig(prod).NODE_ENV).toBe("production");
    });
    test("refuses Cloudflare's test secrets", () => {
      for (const secret of ["1x0000000000000000000000000000000AA", "2x0000000000000000000000000000000AA", "3x0000000000000000000000000000000AA"]) {
        expect(() => loadConfig({ ...prod, TURNSTILE_SECRET_KEY: secret }), secret).toThrow(/TURNSTILE_SECRET_KEY/);
      }
    });
    test("requires https for the app origin and every trusted origin", () => {
      expect(() => loadConfig({ ...prod, APP_ORIGIN: "http://korbat.example" })).toThrow(/APP_ORIGIN/);
      expect(() => loadConfig({ ...prod, TRUSTED_ORIGINS: "https://a.example, http://b.example" })).toThrow(/TRUSTED_ORIGINS/);
    });
    test("development keeps accepting them", () => {
      expect(loadConfig(good).TURNSTILE_SECRET_KEY).toBe("1x0000000000000000000000000000000AA");
    });
  });
  test("previous TOTP keys are optional, comma-separated and each versioned", () => {
    expect(loadConfig(good).TOTP_ENC_KEYS_PREVIOUS).toEqual([]);
    expect(loadConfig({ ...good, TOTP_ENC_KEYS_PREVIOUS: `v0:${key}, v1:${key}` }).TOTP_ENC_KEYS_PREVIOUS).toEqual([`v0:${key}`, `v1:${key}`]);
    expect(() => loadConfig({ ...good, TOTP_ENC_KEYS_PREVIOUS: key })).toThrow(/TOTP_ENC_KEYS_PREVIOUS/);
  });
  test("media settings default to the development directories, every format and a 2 GiB free-space floor", () => {
    const c = loadConfig(good);
    expect(c.MEDIA_UPLOADS_DIR).toBe("../../.data/media/uploads");
    expect(c.MEDIA_STORE_DIR).toBe("../../.data/media/store");
    expect(c.MEDIA_FORMATS).toEqual(["jpeg", "png", "webp", "gif", "avif"]);
    expect(c.MEDIA_MIN_FREE_BYTES).toBe(2_147_483_648);
  });
  test("MEDIA_RECONCILE is on by default and takes off or force", () => {
    expect(loadConfig(good).MEDIA_RECONCILE).toBe("on");
    expect(loadConfig({ ...good, MEDIA_RECONCILE: "force" }).MEDIA_RECONCILE).toBe("force");
    expect(() => loadConfig({ ...good, MEDIA_RECONCILE: "maybe" })).toThrow(/MEDIA_RECONCILE/);
  });
  test("MEDIA_FORMATS enables a subset, and a typo stops the process instead of changing what is accepted", () => {
    expect(loadConfig({ ...good, MEDIA_FORMATS: "png, jpeg" }).MEDIA_FORMATS).toEqual(["jpeg", "png"]);
    expect(() => loadConfig({ ...good, MEDIA_FORMATS: "jpeg,tiff" })).toThrow(/unknown formats: tiff/);
    expect(loadConfig({ ...good, MEDIA_MIN_FREE_BYTES: "0", MEDIA_STORE_DIR: "/media/store" })).toMatchObject({ MEDIA_MIN_FREE_BYTES: 0, MEDIA_STORE_DIR: "/media/store" });
  });
  describe("the verification provider behind the badge", () => {
    test("is off by default, with the brand korbat and no Vonage credentials", () => {
      const c = loadConfig(good);
      expect(c.VERIFY_PROVIDER).toBe("off");
      expect(c.VERIFY_BRAND).toBe("korbat");
      expect(c.VONAGE_API_KEY).toBeUndefined();
      expect(c.VONAGE_API_SECRET).toBeUndefined();
    });
    test("is off, dev or vonage", () => {
      for (const provider of ["off", "dev", "vonage"]) expect(loadConfig({ ...good, VERIFY_PROVIDER: provider }).VERIFY_PROVIDER).toBe(provider);
      expect(() => loadConfig({ ...good, VERIFY_PROVIDER: "twilio" })).toThrow(/VERIFY_PROVIDER/);
      expect(loadConfig({ ...good, VONAGE_API_KEY: "abcd1234", VONAGE_API_SECRET: "s3cret" })).toMatchObject({ VONAGE_API_KEY: "abcd1234", VONAGE_API_SECRET: "s3cret" });
    });
    test("the brand is 1 to 18 characters without the characters Vonage refuses", () => {
      expect(loadConfig({ ...good, VERIFY_BRAND: "x".repeat(18) }).VERIFY_BRAND).toBe("x".repeat(18));
      expect(loadConfig({ ...good, VERIFY_BRAND: "My korbat 1" }).VERIFY_BRAND).toBe("My korbat 1");
      for (const brand of ["", "x".repeat(19), "kor/bat", "{korbat}", "kor:bat", "$korbat"]) {
        expect(() => loadConfig({ ...good, VERIFY_BRAND: brand }), JSON.stringify(brand)).toThrow(/VERIFY_BRAND/);
      }
    });
    describe("in production", () => {
      const prod = { ...good, NODE_ENV: "production", APP_ORIGIN: "https://korbat.example", TURNSTILE_SECRET_KEY: "0x4AAAAAAA-real-widget-secret" };
      test("the development provider is refused, like the Turnstile test secret", () => {
        expect(() => loadConfig({ ...prod, VERIFY_PROVIDER: "dev" })).toThrow(/VERIFY_PROVIDER=dev is for development only/);
        expect(loadConfig({ ...good, VERIFY_PROVIDER: "dev" }).VERIFY_PROVIDER).toBe("dev");
      });
      test("vonage needs both the key and the secret; off needs nothing", () => {
        expect(() => loadConfig({ ...prod, VERIFY_PROVIDER: "vonage" })).toThrow(/VONAGE_API_KEY/);
        expect(() => loadConfig({ ...prod, VERIFY_PROVIDER: "vonage", VONAGE_API_KEY: "abcd1234" })).toThrow(/VONAGE_API_SECRET/);
        expect(() => loadConfig({ ...prod, VERIFY_PROVIDER: "vonage", VONAGE_API_SECRET: "s3cret" })).toThrow(/VONAGE_API_KEY/);
        expect(loadConfig({ ...prod, VERIFY_PROVIDER: "vonage", VONAGE_API_KEY: "abcd1234", VONAGE_API_SECRET: "s3cret" }).VERIFY_PROVIDER).toBe("vonage");
        expect(loadConfig({ ...prod, VERIFY_PROVIDER: "off" }).VERIFY_PROVIDER).toBe("off");
      });
    });
  });
  describe("the WebAuthn relying party", () => {
    test("defaults to the host of APP_ORIGIN and the name korbat; an empty value, as compose passes it, counts as unset", () => {
      expect(loadConfig(good)).toMatchObject({ WEBAUTHN_RP_ID: "localhost", WEBAUTHN_RP_NAME: "korbat" });
      expect(loadConfig({ ...good, WEBAUTHN_RP_ID: "", WEBAUTHN_RP_NAME: "" })).toMatchObject({ WEBAUTHN_RP_ID: "localhost", WEBAUTHN_RP_NAME: "korbat" });
      expect(loadConfig({ ...good, APP_ORIGIN: "http://127.0.0.1:8380" }).WEBAUTHN_RP_ID).toBe("127.0.0.1");
    });
    test("takes an explicit RP ID in lowercase, and only a bare domain name", () => {
      expect(loadConfig({ ...good, WEBAUTHN_RP_ID: "Korbat.Example" }).WEBAUTHN_RP_ID).toBe("korbat.example");
      expect(loadConfig({ ...good, WEBAUTHN_RP_ID: "localhost" }).WEBAUTHN_RP_ID).toBe("localhost");
      for (const rpId of ["https://korbat.example", "korbat.example:443", "korbat.example/path", "-korbat.example", "korbat..example", "korbat.example.", "kor bat.example", `${"a".repeat(64)}.example`]) {
        expect(() => loadConfig({ ...good, WEBAUTHN_RP_ID: rpId }), rpId).toThrow(/WEBAUTHN_RP_ID/);
      }
    });
    test("the name is 1 to 64 printable characters", () => {
      expect(loadConfig({ ...good, WEBAUTHN_RP_NAME: "My korbat" }).WEBAUTHN_RP_NAME).toBe("My korbat");
      expect(loadConfig({ ...good, WEBAUTHN_RP_NAME: "x".repeat(64) }).WEBAUTHN_RP_NAME).toBe("x".repeat(64));
      // A control character, a tab, and U+202E (the invisible right-to-left override).
      for (const name of ["x".repeat(65), `kor${String.fromCharCode(7)}bat`, `kor${String.fromCharCode(9)}bat`, `kor${String.fromCharCode(0x202e)}bat`]) {
        expect(() => loadConfig({ ...good, WEBAUTHN_RP_NAME: name }), JSON.stringify(name)).toThrow(/WEBAUTHN_RP_NAME/);
      }
    });
    test("the auth configuration exposes it, with APP_ORIGIN and TRUSTED_ORIGINS as the expected origins outside production", () => {
      expect(authConfigFrom(loadConfig({ ...good, TRUSTED_ORIGINS: "http://localhost:19006" })).webauthn).toEqual({
        rpId: "localhost",
        rpName: "korbat",
        origins: ["http://localhost:8081", "http://localhost:19006"],
      });
      expect(authConfigFrom(loadConfig({ ...good, WEBAUTHN_RP_NAME: "My korbat" })).webauthn).toEqual({ rpId: "localhost", rpName: "My korbat", origins: ["http://localhost:8081"] });
    });
    describe("in production", () => {
      const prod = { ...good, NODE_ENV: "production", APP_ORIGIN: "https://korbat.example", TURNSTILE_SECRET_KEY: "0x4AAAAAAA-real-widget-secret" };
      test("the expected origin is APP_ORIGIN alone", () => {
        expect(authConfigFrom(loadConfig({ ...prod, TRUSTED_ORIGINS: "https://admin.korbat.example" })).webauthn).toEqual({
          rpId: "korbat.example",
          rpName: "korbat",
          origins: ["https://korbat.example"],
        });
      });
      test("the RP ID may be the host of APP_ORIGIN", () => {
        expect(loadConfig(prod).WEBAUTHN_RP_ID).toBe("korbat.example");
        expect(loadConfig({ ...prod, WEBAUTHN_RP_ID: "korbat.example" }).WEBAUTHN_RP_ID).toBe("korbat.example");
      });
      test("or a parent domain of that host, when it has a dot", () => {
        const app = { ...prod, APP_ORIGIN: "https://app.korbat.example" };
        expect(loadConfig({ ...app, WEBAUTHN_RP_ID: "korbat.example" }).WEBAUTHN_RP_ID).toBe("korbat.example");
        expect(loadConfig({ ...prod, APP_ORIGIN: "https://a.b.korbat.example", WEBAUTHN_RP_ID: "korbat.example" }).WEBAUTHN_RP_ID).toBe("korbat.example");
        expect(() => loadConfig({ ...app, WEBAUTHN_RP_ID: "example" })).toThrow(/WEBAUTHN_RP_ID must be the host of APP_ORIGIN/);
      });
      test("any other domain is refused: another site, a child of the host, or a suffix that is not a parent", () => {
        const app = { ...prod, APP_ORIGIN: "https://app.korbat.example" };
        for (const rpId of ["other.example", "sub.app.korbat.example", "pp.korbat.example", "korbat.example.net"]) {
          expect(() => loadConfig({ ...app, WEBAUTHN_RP_ID: rpId }), rpId).toThrow(/WEBAUTHN_RP_ID must be the host of APP_ORIGIN/);
        }
      });
      test("never an IP address or localhost", () => {
        for (const origin of ["https://203.0.113.7", "https://[2001:db8::1]", "https://localhost", "https://app.localhost"]) {
          expect(() => loadConfig({ ...prod, APP_ORIGIN: origin }), origin).toThrow(/WEBAUTHN_RP_ID/);
        }
        expect(() => loadConfig({ ...prod, APP_ORIGIN: "https://203.0.113.7", WEBAUTHN_RP_ID: "203.0.113.7" })).toThrow(/WEBAUTHN_RP_ID cannot be an IP address/);
        // A parent of an address is no domain either.
        expect(() => loadConfig({ ...prod, APP_ORIGIN: "https://10.0.0.1", WEBAUTHN_RP_ID: "0.0.1" })).toThrow(/WEBAUTHN_RP_ID cannot be an IP address/);
        expect(() => loadConfig({ ...prod, APP_ORIGIN: "https://localhost", WEBAUTHN_RP_ID: "localhost" })).toThrow(/WEBAUTHN_RP_ID cannot be localhost/);
        expect(() => loadConfig({ ...prod, APP_ORIGIN: "https://app.localhost", WEBAUTHN_RP_ID: "localhost" })).toThrow(/WEBAUTHN_RP_ID cannot be localhost/);
      });
      test("development accepts all of them, since browsers treat localhost as secure", () => {
        expect(loadConfig({ ...good, APP_ORIGIN: "http://localhost:8081", WEBAUTHN_RP_ID: "localhost" }).WEBAUTHN_RP_ID).toBe("localhost");
        expect(loadConfig({ ...good, APP_ORIGIN: "http://app.localhost:8081", WEBAUTHN_RP_ID: "other.example" }).WEBAUTHN_RP_ID).toBe("other.example");
      });
    });
  });
});
```

### Replace `apps/api/test/integration/flow-harness.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import type { MeProfile } from "@korbat/contracts";
import pino from "pino";
import type { AuthConfig, AuthDeps, ProfileStore, RequestContext } from "../../src/auth/context";
import { decrypt, parseVersionedKey, randomToken } from "../../src/auth/crypto";
import { signIn } from "../../src/auth/flows/signin";
import { MemoryKv } from "../../src/auth/kv";
import { createLockout } from "../../src/auth/lockout";
import { hashPassword } from "../../src/auth/passwords";
import type { AuthRepo } from "../../src/auth/repo";
import { createSessions } from "../../src/auth/sessions";
import { currentStep, hotp } from "../../src/auth/totp";
import { devProvider } from "../../src/auth/verify/dev";
import { MemoryMailer } from "../../src/mail/memory";
import { fakeClock } from "./auth-fixtures";

/** Handles unique per store, like the real public.profiles index. A new profile has never changed its handle and holds no badge. */
export function memoryProfiles(): ProfileStore {
  const byHandle = new Map<string, MeProfile>();
  const byId = new Map<string, MeProfile>();
  return {
    async create({ id, handle, displayName }) {
      if (byHandle.has(handle) || byId.has(id)) return { ok: false, reason: "handle_taken" };
      const profile = { id, handle, displayName, handleChangedAt: null, verified: false };
      byHandle.set(handle, profile);
      byId.set(id, profile);
      return { ok: true, profile: { id, handle, displayName } };
    },
    async find(id) {
      return byId.get(id) ?? null;
    },
    async setVerified(id, at) {
      const profile = byId.get(id);
      if (profile) profile.verified = at !== null;
    },
  };
}

export const TEST_TERMS = "draft-test";
export const CHROME_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

/**
 * Real auth repository (Postgres) with an in-memory key-value store, mailer and profile store, a fake
 * clock shared by all of them, Turnstile that fails only for the token "fail", and a breach checker
 * that flags passwords containing "breached". A suite whose profiles live in the public schema (the
 * deletion flow compares the typed handle with the profile's) passes the real profile store instead.
 */
export function flowHarness(repo: AuthRepo, options: { profiles?: ProfileStore } = {}) {
  const clock = fakeClock();
  const kv = new MemoryKv(clock.ms);
  const mailer = new MemoryMailer();
  const config: AuthConfig = {
    appOrigin: "http://localhost:8081",
    allowedOrigins: ["http://localhost:8081"],
    authHmacKey: Buffer.alloc(32, 3),
    ipHashKey: Buffer.alloc(32, 4),
    totpKey: parseVersionedKey(`v1:${Buffer.alloc(32, 5).toString("base64")}`),
    totpPreviousKeys: [],
    termsVersion: TEST_TERMS,
    trustProxy: "none",
    verifyProvider: "dev",
    webauthn: { rpId: "localhost", rpName: "korbat", origins: ["http://localhost:8081"] },
  };
  const deps: AuthDeps = {
    repo,
    kv,
    mailer,
    config,
    now: clock.now,
    sessions: createSessions({ repo, kv, now: clock.now }),
    lockout: createLockout({ repo, kv, now: clock.now }),
    turnstile: { verify: async (token) => token !== "fail" },
    breachChecker: { isBreached: async (password) => password.includes("breached") },
    profiles: options.profiles ?? memoryProfiles(),
    verify: devProvider(),
    log: pino({ level: "silent" }),
  };
  const ctx: RequestContext = { ipHash: randomToken(), userAgent: CHROME_WINDOWS };
  return { deps, clock, kv, mailer, ctx };
}

export type FlowHarness = ReturnType<typeof flowHarness>;

export const newTestEmail = (prefix = "flow") => `${prefix}-${randomUUID()}@korbat.local`;
export const newTestDevice = () => ({ deviceId: randomToken(), platform: "web" as const });
export const wrongCode = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

/** An onboarded account, optionally with a password, signed in on one web device. */
export async function onboardedUser(h: FlowHarness, repo: AuthRepo, options: { password?: string } = {}) {
  const email = newTestEmail("account");
  const created = await repo.createUser({ email, termsVersion: TEST_TERMS, now: new Date() });
  await repo.markOnboarded(created.id, new Date());
  if (options.password) await repo.setPasswordHash(created.id, await hashPassword(options.password), new Date());
  const user = (await repo.findUserById(created.id))!;
  const device = newTestDevice();
  const signed = await signIn(h.deps, user, device, h.ctx, { alertNewDevice: false });
  return { email, user, device, session: signed.issued.session, token: signed.issued.token };
}

export type OnboardedUser = Awaited<ReturnType<typeof onboardedUser>>;

/** The TOTP code for a user's stored secret at the harness clock. */
export async function currentTotpCode(h: FlowHarness, repo: AuthRepo, userId: string): Promise<string> {
  const user = (await repo.findUserById(userId))!;
  const secret = new Uint8Array(decrypt(user.totpSecretEnc!, [h.deps.config.totpKey]));
  return hotp(secret, currentStep(h.clock.ms()));
}
```

### Replace `apps/api/test/mail/templates.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { MemoryMailer } from "../../src/mail/memory";
import { renderTemplate } from "../../src/mail/templates";

describe("mail templates", () => {
  test("code emails carry the code and expiry, and no links or images", () => {
    const r = renderTemplate("sign_in_code", { code: "123456" });
    expect(r.subject).toBe("Your korbat sign-in code");
    expect(r.text).toContain("123456");
    expect(r.text).toContain("10 minutes");
    expect(r.html).toContain("123456");
    expect(r.html).not.toMatch(/<img|<a |https?:\/\//);
  });
  test("every template renders and HTML escapes its data", () => {
    const data = {
      code: "123456",
      deviceLabel: "<b>Chrome</b> on Windows",
      notMeUrl: "http://localhost:8081/not-me/abc",
      revertUrl: "http://localhost:8081/email-revert/def",
      minutes: "15",
      count: "3",
      email: "new<address>@example.com",
      name: "<i>Work</i> laptop",
      time: "2026-09-25 10:00 UTC",
      removeUrl: "http://localhost:8081/passkey-remove/ghi",
    };
    for (const template of [
      "sign_in_code",
      "sign_up_code",
      "reauth_code",
      "new_device",
      "account_locked",
      "mfa_enabled",
      "mfa_disabled",
      "password_changed",
      "recovery_codes_regenerated",
      "sessions_revoked_all",
      "email_change_code",
      "email_changed",
      "email_change_reverted",
      "badge_verified",
      "badge_removed",
      "delete_account_code",
      "account_deleted",
      "passkey_added",
      "passkey_removed",
      "passkey_suspect",
    ] as const) {
      const r = renderTemplate(template, data);
      expect(r.subject.length, template).toBeGreaterThan(5);
      expect(r.text.length, template).toBeGreaterThan(20);
      // Links stay plain text (new_device carries the not-me URL that way); nothing is ever an anchor or an image.
      expect(r.html, template).not.toMatch(/<img|<a /);
    }
    const newDevice = renderTemplate("new_device", data);
    expect(newDevice.html).toContain("&lt;b&gt;Chrome&lt;/b&gt;");
    expect(newDevice.text).toContain("http://localhost:8081/not-me/abc");
    const emailChanged = renderTemplate("email_changed", data);
    expect(emailChanged.html).toContain("new&lt;address&gt;@example.com");
    expect(emailChanged.text).toContain("new<address>@example.com");
    expect(emailChanged.text).toContain("http://localhost:8081/email-revert/def");
  });
  test("the account lifecycle templates say what happened and what to do if it was not the owner", () => {
    const changeCode = renderTemplate("email_change_code", { code: "654321" });
    expect(changeCode.text).toContain("654321");
    expect(changeCode.text).toContain("10 minutes");
    const changed = renderTemplate("email_changed", { email: "new@example.com", revertUrl: "http://localhost:8081/email-revert/abc" });
    expect(changed.text).toContain("new@example.com");
    expect(changed.text).toMatch(/stays? signed in/);
    expect(changed.text).toContain(
      "If this was not you, open this link within 24 hours to move the account back to this address and sign out every session: http://localhost:8081/email-revert/abc",
    );
    // A change while an earlier change's link is still out sends no link of its own, and says where the one that works went.
    const again = renderTemplate("email_changed", { email: "new@example.com" });
    expect(again.text).toContain("new@example.com");
    expect(again.text).not.toMatch(/https?:\/\//);
    expect(again.text).toMatch(/less than a day ago/);
    const reverted = renderTemplate("email_change_reverted", {});
    expect(reverted.text).toMatch(/back at this address/);
    expect(reverted.text).toMatch(/every session/i);
    const deleteCode = renderTemplate("delete_account_code", { code: "111222" });
    expect(deleteCode.text).toContain("111222");
    expect(deleteCode.text).toMatch(/delete/i);
    expect(deleteCode.text).toMatch(/revoke|sign out/i);
    expect(renderTemplate("account_deleted", {}).text).toMatch(/cannot be undone/);
    expect(renderTemplate("badge_verified", {}).text).toMatch(/verified/i);
    expect(renderTemplate("badge_removed", {}).text).toMatch(/removed/i);
  });
  test("the passkey templates name the passkey, say what happened and what to do, and never let the name become HTML", () => {
    const name = `<img src=x onerror=alert(1)> "Work" laptop`;
    const removeUrl = "http://localhost:8081/passkey-remove/abc";
    const added = renderTemplate("passkey_added", { name, deviceLabel: "Chrome on Windows", time: "2026-09-25 10:00 UTC", removeUrl });
    expect(added.subject).toBe("A passkey was added to your korbat account");
    expect(added.text).toContain(name);
    expect(added.text).toContain("Chrome on Windows");
    expect(added.text).toContain("2026-09-25 10:00 UTC");
    expect(added.text).toContain(removeUrl);
    expect(added.text).toContain("7 days");
    // What the link does (the lockdown of the 1c design, section 7.6), before the owner opens it.
    expect(added.text).toMatch(/removes? (this|the) passkey/);
    expect(added.text).toMatch(/sign(s)? out every session/);
    expect(added.text).toMatch(/password/);
    expect(added.text).toMatch(/two-factor authentication/);
    expect(added.text).toMatch(/the day before/);
    expect(added.html).toContain("&lt;img src=x onerror=alert(1)&gt; &quot;Work&quot; laptop");
    expect(added.html).not.toMatch(/<img|<a /);
    expect(added.html).toContain(removeUrl);

    const removed = renderTemplate("passkey_removed", { name, time: "2026-09-25 11:00 UTC" });
    expect(removed.subject).toBe("A passkey was removed from your korbat account");
    expect(removed.text).toContain(name);
    expect(removed.text).toContain("2026-09-25 11:00 UTC");
    expect(removed.text).not.toMatch(/https?:\/\//);
    expect(removed.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(removed.html).not.toMatch(/<img|<a /);

    const suspect = renderTemplate("passkey_suspect", { name });
    expect(suspect.subject).toBe("A passkey on your korbat account was switched off");
    expect(suspect.text).toContain(name);
    expect(suspect.text).toMatch(/copy/);
    expect(suspect.text).toMatch(/switched (it|that passkey) off/);
    expect(suspect.text).toMatch(/remove it/i);
    expect(suspect.text).toMatch(/add a new one/);
    expect(suspect.text).not.toMatch(/https?:\/\//);
    expect(suspect.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(suspect.html).not.toMatch(/<img|<a /);
  });
  test("missing template data is a programming error", () => {
    expect(() => renderTemplate("sign_in_code", {})).toThrow(/code/);
    expect(() => renderTemplate("passkey_added", { name: "Phone", deviceLabel: "Chrome on Windows", time: "2026-09-25 10:00 UTC" })).toThrow(/removeUrl/);
    expect(() => renderTemplate("passkey_added", { deviceLabel: "Chrome on Windows", time: "2026-09-25 10:00 UTC", removeUrl: "http://localhost:8081/passkey-remove/abc" })).toThrow(/name/);
    expect(() => renderTemplate("passkey_removed", { name: "Phone" })).toThrow(/time/);
    expect(() => renderTemplate("passkey_suspect", {})).toThrow(/name/);
  });
  test("the memory mailer records messages and finds the latest code per address", async () => {
    const mailer = new MemoryMailer();
    await mailer.send({ to: "a@b.io", template: "sign_in_code", data: { code: "111111" } });
    await mailer.send({ to: "a@b.io", template: "sign_in_code", data: { code: "222222" } });
    expect(mailer.sent).toHaveLength(2);
    expect(mailer.lastCodeFor("a@b.io")).toBe("222222");
    expect(mailer.lastCodeFor("c@d.io")).toBeUndefined();
  });
});
```

### Replace `packages/contracts/test/auth.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import {
  AuthErrorCode,
  BadgeStartRequest,
  BadgeVerifyRequest,
  BadgeVerifyResponse,
  DeleteConfirmRequest,
  DeleteStartResponse,
  DeviceId,
  DisplayName,
  Email,
  EmailChangeResponse,
  EmailChangeStartRequest,
  EmailChangeVerifyRequest,
  EmailRevertRequest,
  EmailVerifyResponse,
  MeProfile,
  MeResponse,
  MfaVerifyRequest,
  OpaqueId,
  Phone,
  ReauthRequest,
  RecoveryCode,
  SignupCompleteRequest,
} from "../src/index";

const flow = "a".repeat(43);
const userId = "3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a";

describe("auth primitives", () => {
  test("email is trimmed and lowercased, invalid rejected", () => {
    expect(Email.parse("  Alice@Example.COM ")).toBe("alice@example.com");
    expect(Email.safeParse("not-an-email").success).toBe(false);
    expect(Email.safeParse(`${"a".repeat(250)}@x.io`).success).toBe(false);
  });
  test("opaque ids are exactly 43 base64url characters", () => {
    expect(OpaqueId.safeParse(flow).success).toBe(true);
    expect(OpaqueId.safeParse("a".repeat(42)).success).toBe(false);
    expect(OpaqueId.safeParse(`${"a".repeat(42)}=`).success).toBe(false);
  });
  test("device ids are 22 to 64 url-safe characters", () => {
    expect(DeviceId.safeParse("x".repeat(22)).success).toBe(true);
    expect(DeviceId.safeParse("x".repeat(21)).success).toBe(false);
    expect(DeviceId.safeParse("x".repeat(65)).success).toBe(false);
  });
  test("recovery codes are normalised to lowercase base32 groups", () => {
    expect(RecoveryCode.parse(" ABCD-EF23-GH45 ")).toBe("abcd-ef23-gh45");
    expect(RecoveryCode.safeParse("abcd-ef01-gh45").success).toBe(false);
  });
  test("display names reject control characters and more than 50 characters", () => {
    expect(DisplayName.parse("  Ada Lovelace ")).toBe("Ada Lovelace");
    expect(DisplayName.safeParse(`bad${String.fromCharCode(7)}name`).success).toBe(false);
    expect(DisplayName.safeParse("x".repeat(51)).success).toBe(false);
  });
  test("phone numbers are E.164 once spaces, hyphens and parentheses are dropped", () => {
    expect(Phone.parse(" +44 7911 123-456 ")).toBe("+447911123456");
    expect(Phone.parse("+1 (415) 555-0132")).toBe("+14155550132");
    expect(Phone.parse("+1234567")).toBe("+1234567");
    expect(Phone.parse(`+${"9".repeat(15)}`)).toBe(`+${"9".repeat(15)}`);
    // No plus, a leading zero, too short, too long, letters, a plus in the middle.
    for (const bad of ["447911123456", "+0447911123456", "+123456", `+${"9".repeat(16)}`, "+44 7911 ext 12", "44+7911123456", ""]) {
      expect(Phone.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe("auth requests and responses", () => {
  test("email verify response is discriminated by result", () => {
    expect(EmailVerifyResponse.parse({ result: "signup_required" })).toEqual({ result: "signup_required" });
    expect(EmailVerifyResponse.parse({ result: "mfa_required", mfaTicket: flow }).result).toBe("mfa_required");
    expect(EmailVerifyResponse.safeParse({ result: "session" }).success).toBe(false);
    expect(EmailVerifyResponse.parse({ result: "session", mustReenrollMfa: false })).toEqual({ result: "session", mustReenrollMfa: false });
  });
  test("mfa verify takes exactly one of code or recoveryCode", () => {
    expect(MfaVerifyRequest.safeParse({ mfaTicket: flow, code: "123456" }).success).toBe(true);
    expect(MfaVerifyRequest.safeParse({ mfaTicket: flow, recoveryCode: "abcd-ef23-gh45" }).success).toBe(true);
    expect(MfaVerifyRequest.safeParse({ mfaTicket: flow, code: "123456", recoveryCode: "abcd-ef23-gh45" }).success).toBe(false);
    expect(MfaVerifyRequest.safeParse({ mfaTicket: flow }).success).toBe(false);
  });
  test("reauth accepts password, totp and email methods only", () => {
    expect(ReauthRequest.safeParse({ method: "password", password: "x" }).success).toBe(true);
    expect(ReauthRequest.safeParse({ method: "totp", code: "000000" }).success).toBe(true);
    expect(ReauthRequest.safeParse({ method: "email", flowId: flow, code: "000000" }).success).toBe(true);
    expect(ReauthRequest.safeParse({ method: "sms", code: "000000" }).success).toBe(false);
  });
  test("signup completion needs an ISO calendar date", () => {
    expect(SignupCompleteRequest.safeParse({ flowId: flow, dateOfBirth: "2008-02-29", termsVersion: "draft" }).success).toBe(true);
    expect(SignupCompleteRequest.safeParse({ flowId: flow, dateOfBirth: "29/02/2008", termsVersion: "draft" }).success).toBe(false);
  });
  test("me response carries email and a nullable profile", () => {
    const me = {
      user: { id: userId, email: "a@b.io", role: "user", onboarded: false, mfaEnabled: false, hasPassword: false },
      profile: null,
    };
    expect(MeResponse.parse(me)).toEqual(me);
  });
  test("the own profile in the me response says when the handle last changed and whether the badge is held", () => {
    const user = { id: userId, email: "a@b.io", role: "user", onboarded: true, mfaEnabled: false, hasPassword: false };
    const profile = { id: userId, handle: "ada", displayName: "Ada", handleChangedAt: null, verified: false };
    expect(MeResponse.parse({ user, profile })).toEqual({ user, profile });
    expect(MeProfile.parse({ ...profile, handleChangedAt: "2026-09-24T10:00:00.000Z", verified: true }).verified).toBe(true);
    // Both fields are facts the account screen relies on, so a profile without them is not a valid answer.
    expect(MeResponse.safeParse({ user, profile: { id: userId, handle: "ada", displayName: "Ada" } }).success).toBe(false);
    expect(MeProfile.safeParse({ ...profile, handleChangedAt: "yesterday" }).success).toBe(false);
    expect(MeProfile.safeParse({ ...profile, verified: "yes" }).success).toBe(false);
  });
  test("every documented auth error code exists", () => {
    expect(AuthErrorCode.options).toHaveLength(34);
    expect(AuthErrorCode.options).toContain("password_check_unavailable");
    expect(AuthErrorCode.options).toEqual(expect.arrayContaining(["handle_cooldown", "email_in_use", "phone_in_use", "badge_unavailable", "verify_unavailable"]));
    // Passkeys (1c design, section 8).
    expect(AuthErrorCode.options).toEqual(
      expect.arrayContaining(["passkey_invalid", "passkey_unsupported", "passkey_limit", "passkey_suspended", "passkey_not_found", "challenge_expired"]),
    );
  });
});

describe("account lifecycle requests and responses", () => {
  test("an email change starts with an address under the sign-up rules and verifies with a flow id and code", () => {
    expect(EmailChangeStartRequest.parse({ email: " New@Example.COM " })).toEqual({ email: "new@example.com" });
    expect(EmailChangeStartRequest.safeParse({ email: "not-an-email" }).success).toBe(false);
    expect(EmailChangeStartRequest.safeParse({}).success).toBe(false);
    expect(EmailChangeVerifyRequest.parse({ flowId: flow, code: "123456" })).toEqual({ flowId: flow, code: "123456" });
    expect(EmailChangeVerifyRequest.safeParse({ flowId: flow, code: "12345" }).success).toBe(false);
    expect(EmailChangeVerifyRequest.safeParse({ flowId: "short", code: "123456" }).success).toBe(false);
    expect(EmailChangeResponse.parse({ email: "new@example.com" })).toEqual({ email: "new@example.com" });
    expect(EmailChangeResponse.safeParse({ email: "nope" }).success).toBe(false);
  });
  test("the undo link of an email change carries one opaque token", () => {
    expect(EmailRevertRequest.parse({ token: flow })).toEqual({ token: flow });
    expect(EmailRevertRequest.safeParse({ token: "a".repeat(42) }).success).toBe(false);
    expect(EmailRevertRequest.safeParse({ token: `${"a".repeat(42)}/` }).success).toBe(false);
    expect(EmailRevertRequest.safeParse({}).success).toBe(false);
  });
  test("the badge starts with a phone number and verifies with a flow id and a six-digit code", () => {
    expect(BadgeStartRequest.parse({ phone: "+44 7911 123456" })).toEqual({ phone: "+447911123456" });
    expect(BadgeStartRequest.safeParse({ phone: "07911123456" }).success).toBe(false);
    expect(BadgeStartRequest.safeParse({}).success).toBe(false);
    expect(BadgeVerifyRequest.parse({ flowId: flow, code: "000000" })).toEqual({ flowId: flow, code: "000000" });
    expect(BadgeVerifyRequest.safeParse({ flowId: flow, code: "abcdef" }).success).toBe(false);
    expect(BadgeVerifyRequest.safeParse({ flowId: flow, code: "0000000" }).success).toBe(false);
    expect(BadgeVerifyResponse.parse({ verified: true })).toEqual({ verified: true });
    expect(BadgeVerifyResponse.safeParse({ verified: false }).success).toBe(false);
  });
  test("deletion starts with a flow id and is confirmed with the code and the typed handle", () => {
    expect(DeleteStartResponse.parse({ flowId: flow })).toEqual({ flowId: flow });
    expect(DeleteStartResponse.safeParse({ flowId: "x" }).success).toBe(false);
    expect(DeleteConfirmRequest.parse({ flowId: flow, code: "123456", handle: " Ada_Lovelace " })).toEqual({ flowId: flow, code: "123456", handle: "ada_lovelace" });
    expect(DeleteConfirmRequest.safeParse({ flowId: flow, code: "123456" }).success).toBe(false);
    expect(DeleteConfirmRequest.safeParse({ flowId: flow, code: "123456", handle: "" }).success).toBe(false);
    expect(DeleteConfirmRequest.safeParse({ flowId: flow, handle: "ada" }).success).toBe(false);
  });
});
```

### Replace `packages/db/test/schema.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig, pgTable } from "drizzle-orm/pg-core";
import { bytea } from "../src/schema/helpers";
import * as schema from "../src/schema/index";

const tables = Object.values(schema).filter((v) => is(v, PgTable)) as PgTable[];
const byName = new Map(tables.map((t) => [getTableConfig(t).name, getTableConfig(t)]));

describe("auth schema", () => {
  test("auth tables live in the auth schema", () => {
    for (const name of ["users", "devices", "sessions", "email_codes", "passkeys", "auth_events"]) {
      expect(byName.get(name)?.schema, name).toBe("auth");
    }
  });
  test("sessions store only a hash id and carry both expiries", () => {
    const cols = byName.get("sessions")!.columns.map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["id", "user_id", "device_id", "expires_at", "absolute_expires_at", "reauth_at", "revoked_at"]));
  });
});

describe("row level security", () => {
  test("every table has RLS enabled and at least one policy", () => {
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) {
      const cfg = getTableConfig(t);
      expect(cfg.enableRLS, cfg.name).toBe(true);
      expect(cfg.policies.length, cfg.name).toBeGreaterThan(0);
    }
  });
});

describe("content schema", () => {
  test("posts carry a state enum and a body length check", () => {
    const cfg = byName.get("posts")!;
    expect(cfg.schema).toBeUndefined(); // public
    expect(cfg.columns.find((c) => c.name === "state")?.notNull).toBe(true);
    expect(cfg.checks.map((c) => c.name)).toContain("posts_body_len");
  });
  test("join tables have composite primary keys", () => {
    for (const name of ["follows", "likes", "reposts", "bookmarks", "blocks", "mutes"]) {
      expect(byName.get(name)!.primaryKeys.length, name).toBe(1);
      expect(byName.get(name)!.primaryKeys[0]!.columns.length, name).toBe(2);
    }
  });
});

describe("trust and safety schema", () => {
  test("there are 22 tables in total", () => {
    expect(tables.length).toBe(22);
  });
  test("transparency_log carries no user identifiers", () => {
    const cols = byName.get("transparency_log")!.columns.map((c) => c.name);
    for (const c of cols) expect(c, c).not.toMatch(/user|author|moderator|reporter/);
  });
  test("audit_log policies allow only insert and select", () => {
    const kinds = byName.get("audit_log")!.policies.map((p) => p.for).sort();
    expect(kinds).toEqual(["insert", "select"]);
  });
  test("one appeal per case", () => {
    const idx = byName.get("appeals")!.indexes.find((i) => i.config.name === "appeals_case_idx");
    expect(idx?.config.unique).toBe(true);
  });
});

describe("identity and auth 1a", () => {
  test("users carry role, age, terms, onboarding and TOTP replay columns", () => {
    const cols = byName.get("users")!.columns;
    expect(cols.map((c) => c.name)).toEqual(
      expect.arrayContaining(["role", "age_confirmed_at", "terms_version", "terms_accepted_at", "onboarded_at", "password_changed_at", "totp_last_step"]),
    );
    expect(cols.find((c) => c.name === "role")?.notNull).toBe(true);
  });
  test("email codes are bound to a unique flow id", () => {
    const cfg = byName.get("email_codes")!;
    expect(cfg.columns.find((c) => c.name === "flow_id")?.notNull).toBe(true);
    expect(cfg.indexes.find((i) => i.config.name === "email_codes_flow_idx")?.config.unique).toBe(true);
  });
  test("auth_events policies allow only insert and select", () => {
    expect(byName.get("auth_events")?.policies.map((p) => p.for).sort()).toEqual(["insert", "select"]);
  });
  test("email code purposes include reauth", () => {
    expect(schema.emailCodePurpose.enumValues).toContain("reauth");
  });
});

describe("posting and feed 2a", () => {
  test("posts and profiles carry non-negative counters, and posts a deletion time", () => {
    const posts = byName.get("posts")!;
    const postCols = posts.columns.map((c) => c.name);
    expect(postCols).toEqual(expect.arrayContaining(["like_count", "repost_count", "reply_count", "quote_count", "deleted_at"]));
    for (const name of ["like_count", "repost_count", "reply_count", "quote_count"]) {
      expect(posts.columns.find((c) => c.name === name)?.notNull, name).toBe(true);
    }
    expect(posts.checks.map((c) => c.name)).toContain("posts_counts_nonnegative");
    const profiles = byName.get("profiles")!;
    expect(profiles.columns.map((c) => c.name)).toEqual(expect.arrayContaining(["follower_count", "following_count", "post_count"]));
    expect(profiles.checks.map((c) => c.name)).toContain("profiles_counts_nonnegative");
  });
  test("per-account engagement lists and quote lookups have indexes", () => {
    for (const name of ["likes", "reposts", "bookmarks"]) {
      const idx = byName.get(name)!.indexes.find((i) => i.config.name === `${name}_user_created_idx`);
      expect(idx?.config.columns.length, name).toBe(2);
    }
    expect(byName.get("posts")!.indexes.map((i) => i.config.name)).toContain("posts_quote_of_idx");
  });
});

describe("images 2b", () => {
  test("post_media has no path column, and its attachment and dimension columns are optional", () => {
    const cols = byName.get("post_media")!.columns;
    expect(cols.map((c) => c.name)).not.toContain("path");
    for (const name of ["post_id", "position", "width", "height", "blurhash"]) {
      expect(cols.find((c) => c.name === name)?.notNull, name).toBe(false);
    }
  });
  test("every upload has an owner, a status and a creation time; a failure has a reason", () => {
    const cols = byName.get("post_media")!.columns;
    for (const name of ["owner_id", "status", "created_at"]) expect(cols.find((c) => c.name === name)?.notNull, name).toBe(true);
    expect(cols.find((c) => c.name === "error")?.notNull).toBe(false);
    expect(cols.find((c) => c.name === "status")?.default).toBe("processing");
    expect(schema.mediaStatus.enumValues).toEqual(["processing", "ready", "failed"]);
  });
  test("the database itself refuses a ready image without dimensions and an attached image that is incomplete", () => {
    const cfg = byName.get("post_media")!;
    expect(cfg.checks.map((c) => c.name).sort()).toEqual(["post_media_alt_len", "post_media_attached_is_complete", "post_media_ready_has_dims"]);
    expect(cfg.indexes.map((i) => i.config.name).sort()).toEqual(["post_media_owner_created_idx", "post_media_post_position_idx", "post_media_status_created_idx"]);
    expect(cfg.indexes.find((i) => i.config.name === "post_media_post_position_idx")?.config.unique).toBe(true);
  });
});

describe("account lifecycle 1b", () => {
  test("handle_history reserves every lowercase handle a profile ever had, and goes with the profile", () => {
    const cfg = byName.get("handle_history")!;
    expect(cfg.schema).toBeUndefined(); // public
    expect(cfg.columns.map((c) => c.name)).toEqual(["handle_lower", "profile_id", "changed_at"]);
    expect(cfg.columns.find((c) => c.name === "handle_lower")?.primary).toBe(true);
    expect(cfg.columns.find((c) => c.name === "profile_id")?.notNull).toBe(true);
    expect(cfg.columns.find((c) => c.name === "changed_at")?.notNull).toBe(true);
    expect(cfg.columns.find((c) => c.name === "changed_at")?.hasDefault).toBe(true);
    const fk = cfg.foreignKeys.map((k) => ({ table: getTableConfig(k.reference().foreignTable).name, columns: k.reference().foreignColumns.map((c) => c.name), onDelete: k.onDelete }));
    expect(fk).toEqual([{ table: "profiles", columns: ["id"], onDelete: "cascade" }]);
    expect(cfg.policies.map((p) => [p.name, p.for])).toEqual([["handle_history_api_all", "all"]]);
  });
  test("profiles record when the handle last changed; users record when their purge finished", () => {
    const handleChangedAt = byName.get("profiles")!.columns.find((c) => c.name === "handle_changed_at");
    expect(handleChangedAt).toBeDefined();
    expect(handleChangedAt?.notNull).toBe(false);
    const purgedAt = byName.get("users")!.columns.find((c) => c.name === "purged_at");
    expect(purgedAt).toBeDefined();
    expect(purgedAt?.notNull).toBe(false);
  });
  test("one phone per account: a unique index on phone_hash that leaves out the accounts without one", () => {
    const idx = byName.get("users")!.indexes.find((i) => i.config.name === "users_phone_hash_idx");
    expect(idx?.config.unique).toBe(true);
    expect(idx?.config.columns.map((c) => (c as { name?: string }).name)).toEqual(["phone_hash"]);
    expect(idx?.config.where).toBeDefined();
  });
  test("email codes can be for deleting the account, and every account event of 1b has a type", () => {
    expect(schema.emailCodePurpose.enumValues).toContain("delete_account");
    const values = schema.authEventType.enumValues;
    expect(values.slice(values.indexOf("not_me"), values.indexOf("account_deleted") + 1)).toEqual([
      "not_me",
      "profile_updated",
      "handle_changed",
      "email_changed",
      "badge_verified",
      "badge_removed",
      "export_created",
      "account_deleted",
    ]);
  });
});

describe("passkeys 1c", () => {
  const column = (table: string, name: string) => byName.get(table)!.columns.find((c) => c.name === name);
  /** The foreign keys of one local column: the table and columns they point at and what a delete there does. */
  const foreignKeys = (table: string, name: string) =>
    byName
      .get(table)!
      .foreignKeys.filter((k) => k.reference().columns.some((c) => c.name === name))
      .map((k) => ({ table: getTableConfig(k.reference().foreignTable).name, columns: k.reference().foreignColumns.map((c) => c.name), onDelete: k.onDelete }));

  test("bytea is the bytea SQL type and hands Buffers both ways", () => {
    const table = pgTable("bytea_probe", { value: bytea("value") });
    const probe = getTableConfig(table).columns[0]!;
    expect(probe.getSQLType()).toBe("bytea");
    const bytes = Buffer.from([0, 1, 254, 255]);
    expect(probe.mapToDriverValue(bytes)).toEqual(bytes);
    // postgres.js already parses bytea into a Buffer; a driver that answers a plain Uint8Array gets one too.
    const read = probe.mapFromDriverValue(new Uint8Array([0, 1, 254, 255]));
    expect(Buffer.isBuffer(read)).toBe(true);
    expect(read).toEqual(bytes);
    expect(probe.mapFromDriverValue(bytes)).toEqual(bytes);
  });

  test("users carry an optional WebAuthn user handle in bytea, unique among the accounts that have one", () => {
    const handle = column("users", "webauthn_user_id");
    expect(handle?.getSQLType()).toBe("bytea");
    expect(handle?.notNull).toBe(false);
    expect(handle?.hasDefault).toBe(false);
    const idx = byName.get("users")!.indexes.find((i) => i.config.name === "users_webauthn_user_id_idx");
    expect(idx?.config.unique).toBe(true);
    expect(idx?.config.columns.map((c) => (c as { name?: string }).name)).toEqual(["webauthn_user_id"]);
    expect(idx?.config.where).toBeDefined();
  });

  test("passkeys record the AAGUID, the backup and verification flags, the creating device and a suspected copy", () => {
    expect(column("passkeys", "aaguid")?.getSQLType()).toBe("uuid");
    expect(column("passkeys", "aaguid")?.notNull).toBe(false);
    for (const name of ["backup_eligible", "uv_initialized"]) {
      expect(column("passkeys", name)?.getSQLType(), name).toBe("boolean");
      expect(column("passkeys", name)?.notNull, name).toBe(true);
      expect(column("passkeys", name)?.default, name).toBe(false);
    }
    expect(column("passkeys", "created_device_id")?.getSQLType()).toBe("uuid");
    expect(column("passkeys", "created_device_id")?.notNull).toBe(false);
    expect(foreignKeys("passkeys", "created_device_id")).toEqual([{ table: "devices", columns: ["id"], onDelete: "set null" }]);
    expect(column("passkeys", "suspect_at")?.getSQLType()).toBe("timestamp with time zone");
    expect(column("passkeys", "suspect_at")?.notNull).toBe(false);
    // One row per credential: the index the foundation created stays.
    const idx = byName.get("passkeys")!.indexes.find((i) => i.config.name === "passkeys_credential_idx");
    expect(idx?.config.unique).toBe(true);
    expect(idx?.config.columns.map((c) => (c as { name?: string }).name)).toEqual(["credential_id"]);
  });

  test("sessions carry a random handle that is unique, the factors they proved and the passkey that started them", () => {
    const handle = column("sessions", "handle");
    expect(handle?.getSQLType()).toBe("uuid");
    expect(handle?.notNull).toBe(true);
    expect(handle?.hasDefault).toBe(true);
    const idx = byName.get("sessions")!.indexes.find((i) => i.config.name === "sessions_handle_idx");
    expect(idx?.config.unique).toBe(true);
    expect(idx?.config.columns.map((c) => (c as { name?: string }).name)).toEqual(["handle"]);
    const factors = column("sessions", "factors");
    expect(factors?.getSQLType()).toBe("jsonb");
    expect(factors?.notNull).toBe(true);
    expect(factors?.hasDefault).toBe(true);
    expect(column("sessions", "passkey_id")?.notNull).toBe(false);
    expect(foreignKeys("sessions", "passkey_id")).toEqual([{ table: "passkeys", columns: ["id"], onDelete: "set null" }]);
  });

  test("adding, removing and a counter regression of a passkey are security events", () => {
    const values = schema.authEventType.enumValues;
    expect(values.slice(values.indexOf("account_deleted"))).toEqual(["account_deleted", "passkey_added", "passkey_removed", "passkey_counter_regression"]);
  });
});
```

## Step 2: run the tests and watch them fail

```bash
pnpm test
```

Expected: the command exits with an error, and the output contains:

- `Tests  `
- `failed`

Observed on the dry run:

```text
packages/rules test:       Tests  4 passed (4)
packages/contracts test:  ❯ test/passkeys.test.ts (22 tests | 22 failed) 43ms
packages/contracts test:  ❯ test/auth.test.ts (17 tests | 1 failed) 83ms
packages/contracts test:  Test Files  2 failed | 4 passed (6)
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/passkeys-1c/write_blocks.py docs/superpowers/prompts/passkeys-1c/01-ground.md 3
```

Expected: 17 lines starting with `wrote`, one for each file below.

### Create `packages/contracts/src/passkeys.ts`

```ts
import { z } from "zod";
import { DisplayName, OpaqueId, PasswordSigninRequest } from "./auth";

/** base64url without padding, as the browser library encodes every binary member of a WebAuthn response. */
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** A base64url string of at most `max` characters, so a hostile client cannot hand the verifier an unbounded buffer. */
const base64url = (max: number) => z.string().min(1).max(max).regex(BASE64URL, "must be base64url without padding");

/**
 * A credential id as base64url. WebAuthn caps credential ids at 1023 bytes, which is 1364 characters; the
 * bound leaves room for that and the flows check the decoded length themselves.
 */
const CredentialId = base64url(1400);

/** The transports an authenticator reports ("internal", "hybrid", "usb", ...); the flows keep only the ones they know. */
const Transports = z.array(z.string().min(1).max(32)).max(8);

/** Extension outputs such as credProps; the library reads them, korbat does not. */
const ClientExtensionResults = z.record(z.string(), z.unknown());

/** Whether the authenticator is built into the device or roams; absent when the browser does not say. */
const AuthenticatorAttachment = z.enum(["platform", "cross-platform"]).optional();

/** What korbat calls a passkey in the Security list: the display-name rules (1 to 50 characters, no control or invisible characters). */
export const PasskeyName = DisplayName;

/**
 * The name the password manager shows for the passkey (the options' user.name and user.displayName), under the
 * display-name rules. The app prefills it with the handle; korbat puts it in the options and does not store it.
 */
export const PasskeyLabel = DisplayName;

/** One passkey of the account as the Security screen lists it: nothing that identifies the key itself. */
export const PasskeyView = z.object({
  id: z.uuid(),
  name: z.string(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
  /** Backed up, so the password manager syncs it to the owner's other devices. */
  synced: z.boolean(),
  /** The label of the device that added it; null once that device is gone. */
  createdOn: z.string().nullable(),
  /** This session was started with it. */
  current: z.boolean(),
  /** Added in the last 7 days, when "This wasn't me" is offered on it. */
  isNew: z.boolean(),
  /** Switched off after a sign-in used what looks like a copy of it; only removing it is left. */
  suspended: z.boolean(),
});
export type PasskeyView = z.infer<typeof PasskeyView>;

export const PasskeyListResponse = z.object({ passkeys: z.array(PasskeyView) });
export type PasskeyListResponse = z.infer<typeof PasskeyListResponse>;

export const PasskeyRegisterOptionsRequest = z.object({ label: PasskeyLabel });
export type PasskeyRegisterOptionsRequest = z.infer<typeof PasskeyRegisterOptionsRequest>;

/**
 * The options of a ceremony (registration, sign-in or re-authentication) as the server library wrote them. Only the
 * challenge is checked here: everything else passes through untouched to the browser library, which knows its shape.
 */
export const PasskeyOptionsResponse = z.object({ options: z.looseObject({ challenge: z.string().min(1).regex(BASE64URL, "must be base64url without padding") }) });
export type PasskeyOptionsResponse = z.infer<typeof PasskeyOptionsResponse>;

/**
 * The browser's answer to a registration ceremony. Members the browser library adds beside these (the public key, its
 * algorithm and a copy of the authenticator data) are dropped: the server reads all of them from the attestation object.
 */
export const RegistrationResponseJSON = z.object({
  id: CredentialId,
  rawId: CredentialId,
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: base64url(4 * 1024),
    attestationObject: base64url(64 * 1024),
    transports: Transports.optional(),
  }),
  clientExtensionResults: ClientExtensionResults,
  authenticatorAttachment: AuthenticatorAttachment,
});
export type RegistrationResponseJSON = z.infer<typeof RegistrationResponseJSON>;

/** The browser's answer to a sign-in or re-authentication ceremony. */
export const AuthenticationResponseJSON = z.object({
  id: CredentialId,
  rawId: CredentialId,
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: base64url(4 * 1024),
    authenticatorData: base64url(4 * 1024),
    signature: base64url(1024),
    /** The account's WebAuthn user handle; a discoverable passkey returns it, others may not. */
    userHandle: base64url(128).optional(),
  }),
  clientExtensionResults: ClientExtensionResults,
  authenticatorAttachment: AuthenticatorAttachment,
});
export type AuthenticationResponseJSON = z.infer<typeof AuthenticationResponseJSON>;

/** Without a name the flow calls the passkey after the platform it was added on. */
export const PasskeyRegisterVerifyRequest = z.object({ name: PasskeyName.optional(), response: RegistrationResponseJSON });
export type PasskeyRegisterVerifyRequest = z.infer<typeof PasskeyRegisterVerifyRequest>;

/**
 * A passkey sign-in carries the same device fields as a password sign-in, taken from its schema so the two cannot
 * drift apart: the device id the app created at install and the platform, which the API overrides to web for a browser.
 */
export const PasskeySignInVerifyRequest = PasswordSigninRequest.pick({ deviceId: true, platform: true }).extend({ response: AuthenticationResponseJSON });
export type PasskeySignInVerifyRequest = z.infer<typeof PasskeySignInVerifyRequest>;

export const PasskeyRenameRequest = z.object({ name: PasskeyName });
export type PasskeyRenameRequest = z.infer<typeof PasskeyRenameRequest>;

/** The token of the remove link that the passkey_added email carries. It is the only credential the removal needs. */
export const PasskeyRemoveLinkRequest = z.object({ token: OpaqueId });
export type PasskeyRemoveLinkRequest = z.infer<typeof PasskeyRemoveLinkRequest>;
```

### Create `packages/db/migrations/0010_free_thunderbolt.sql`

```sql
ALTER TYPE "auth"."auth_event_type" ADD VALUE 'passkey_added';--> statement-breakpoint
ALTER TYPE "auth"."auth_event_type" ADD VALUE 'passkey_removed';--> statement-breakpoint
ALTER TYPE "auth"."auth_event_type" ADD VALUE 'passkey_counter_regression';--> statement-breakpoint
ALTER TABLE "auth"."passkeys" ADD COLUMN "aaguid" uuid;--> statement-breakpoint
ALTER TABLE "auth"."passkeys" ADD COLUMN "backup_eligible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."passkeys" ADD COLUMN "uv_initialized" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."passkeys" ADD COLUMN "created_device_id" uuid;--> statement-breakpoint
ALTER TABLE "auth"."passkeys" ADD COLUMN "suspect_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth"."sessions" ADD COLUMN "handle" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."sessions" ADD COLUMN "factors" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."sessions" ADD COLUMN "passkey_id" uuid;--> statement-breakpoint
ALTER TABLE "auth"."users" ADD COLUMN "webauthn_user_id" "bytea";--> statement-breakpoint
ALTER TABLE "auth"."passkeys" ADD CONSTRAINT "passkeys_created_device_id_devices_id_fk" FOREIGN KEY ("created_device_id") REFERENCES "auth"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."sessions" ADD CONSTRAINT "sessions_passkey_id_passkeys_id_fk" FOREIGN KEY ("passkey_id") REFERENCES "auth"."passkeys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_handle_idx" ON "auth"."sessions" USING btree ("handle");--> statement-breakpoint
CREATE UNIQUE INDEX "users_webauthn_user_id_idx" ON "auth"."users" USING btree ("webauthn_user_id") WHERE webauthn_user_id is not null;
```

### Create `packages/db/migrations/meta/0010_snapshot.json`

```json
{
  "id": "a5e076b0-3644-4743-8761-67b890a9f4ed",
  "prevId": "2bb6873f-15c3-4a24-be97-8b7d6e0db4b2",
  "version": "7",
  "dialect": "postgresql",
  "tables": {
    "auth.auth_events": {
      "name": "auth_events",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "bigserial",
          "primaryKey": true,
          "notNull": true
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "type": {
          "name": "type",
          "type": "auth_event_type",
          "typeSchema": "auth",
          "primaryKey": false,
          "notNull": true
        },
        "device_id": {
          "name": "device_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "ip_hash": {
          "name": "ip_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "metadata": {
          "name": "metadata",
          "type": "jsonb",
          "primaryKey": false,
          "notNull": true,
          "default": "'{}'::jsonb"
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "auth_events_user_created_idx": {
          "name": "auth_events_user_created_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "auth_events_user_id_users_id_fk": {
          "name": "auth_events_user_id_users_id_fk",
          "tableFrom": "auth_events",
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "set null",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "auth_events_auth_insert": {
          "name": "auth_events_auth_insert",
          "as": "PERMISSIVE",
          "for": "INSERT",
          "to": [
            "korbat_auth"
          ],
          "withCheck": "true"
        },
        "auth_events_auth_select": {
          "name": "auth_events_auth_select",
          "as": "PERMISSIVE",
          "for": "SELECT",
          "to": [
            "korbat_auth"
          ],
          "using": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.devices": {
      "name": "devices",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "device_hash": {
          "name": "device_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "label": {
          "name": "label",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "platform": {
          "name": "platform",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "first_seen_at": {
          "name": "first_seen_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "last_seen_at": {
          "name": "last_seen_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "ip_hash": {
          "name": "ip_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "revoked_at": {
          "name": "revoked_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "devices_user_idx": {
          "name": "devices_user_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "devices_ip_hash_idx": {
          "name": "devices_ip_hash_idx",
          "columns": [
            {
              "expression": "ip_hash",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "devices_user_id_users_id_fk": {
          "name": "devices_user_id_users_id_fk",
          "tableFrom": "devices",
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "devices_auth_all": {
          "name": "devices_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.email_codes": {
      "name": "email_codes",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "email": {
          "name": "email",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "code_hash": {
          "name": "code_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "purpose": {
          "name": "purpose",
          "type": "email_code_purpose",
          "typeSchema": "auth",
          "primaryKey": false,
          "notNull": true
        },
        "expires_at": {
          "name": "expires_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "attempts": {
          "name": "attempts",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "consumed_at": {
          "name": "consumed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "flow_id": {
          "name": "flow_id",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "ip_hash": {
          "name": "ip_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "email_codes_email_idx": {
          "name": "email_codes_email_idx",
          "columns": [
            {
              "expression": "email",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "email_codes_flow_idx": {
          "name": "email_codes_flow_idx",
          "columns": [
            {
              "expression": "flow_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "email_codes_user_id_users_id_fk": {
          "name": "email_codes_user_id_users_id_fk",
          "tableFrom": "email_codes",
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "set null",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "email_codes_auth_all": {
          "name": "email_codes_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.passkeys": {
      "name": "passkeys",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "credential_id": {
          "name": "credential_id",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "public_key": {
          "name": "public_key",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "counter": {
          "name": "counter",
          "type": "bigint",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "transports": {
          "name": "transports",
          "type": "text[]",
          "primaryKey": false,
          "notNull": true,
          "default": "'{}'::text[]"
        },
        "backed_up": {
          "name": "backed_up",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "name": {
          "name": "name",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "last_used_at": {
          "name": "last_used_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "aaguid": {
          "name": "aaguid",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "backup_eligible": {
          "name": "backup_eligible",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "uv_initialized": {
          "name": "uv_initialized",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "created_device_id": {
          "name": "created_device_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "suspect_at": {
          "name": "suspect_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "passkeys_credential_idx": {
          "name": "passkeys_credential_idx",
          "columns": [
            {
              "expression": "credential_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "passkeys_user_idx": {
          "name": "passkeys_user_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "passkeys_user_id_users_id_fk": {
          "name": "passkeys_user_id_users_id_fk",
          "tableFrom": "passkeys",
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "passkeys_created_device_id_devices_id_fk": {
          "name": "passkeys_created_device_id_devices_id_fk",
          "tableFrom": "passkeys",
          "tableTo": "devices",
          "schemaTo": "auth",
          "columnsFrom": [
            "created_device_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "set null",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "passkeys_auth_all": {
          "name": "passkeys_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.sessions": {
      "name": "sessions",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "text",
          "primaryKey": true,
          "notNull": true
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "device_id": {
          "name": "device_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "expires_at": {
          "name": "expires_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "absolute_expires_at": {
          "name": "absolute_expires_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "last_used_at": {
          "name": "last_used_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "revoked_at": {
          "name": "revoked_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "reauth_at": {
          "name": "reauth_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "handle": {
          "name": "handle",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "factors": {
          "name": "factors",
          "type": "jsonb",
          "primaryKey": false,
          "notNull": true,
          "default": "'{}'::jsonb"
        },
        "passkey_id": {
          "name": "passkey_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "sessions_user_idx": {
          "name": "sessions_user_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "sessions_handle_idx": {
          "name": "sessions_handle_idx",
          "columns": [
            {
              "expression": "handle",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "sessions_user_id_users_id_fk": {
          "name": "sessions_user_id_users_id_fk",
          "tableFrom": "sessions",
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "sessions_device_id_devices_id_fk": {
          "name": "sessions_device_id_devices_id_fk",
          "tableFrom": "sessions",
          "tableTo": "devices",
          "schemaTo": "auth",
          "columnsFrom": [
            "device_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "sessions_passkey_id_passkeys_id_fk": {
          "name": "sessions_passkey_id_passkeys_id_fk",
          "tableFrom": "sessions",
          "tableTo": "passkeys",
          "schemaTo": "auth",
          "columnsFrom": [
            "passkey_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "set null",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "sessions_auth_all": {
          "name": "sessions_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.users": {
      "name": "users",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "email": {
          "name": "email",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "email_verified_at": {
          "name": "email_verified_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "phone_hash": {
          "name": "phone_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "password_hash": {
          "name": "password_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "totp_secret_enc": {
          "name": "totp_secret_enc",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "totp_enabled_at": {
          "name": "totp_enabled_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "recovery_codes_hash": {
          "name": "recovery_codes_hash",
          "type": "text[]",
          "primaryKey": false,
          "notNull": true,
          "default": "'{}'::text[]"
        },
        "failed_logins": {
          "name": "failed_logins",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "locked_until": {
          "name": "locked_until",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "deleted_at": {
          "name": "deleted_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "role": {
          "name": "role",
          "type": "user_role",
          "typeSchema": "auth",
          "primaryKey": false,
          "notNull": true,
          "default": "'user'"
        },
        "age_confirmed_at": {
          "name": "age_confirmed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "terms_version": {
          "name": "terms_version",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "terms_accepted_at": {
          "name": "terms_accepted_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "onboarded_at": {
          "name": "onboarded_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "password_changed_at": {
          "name": "password_changed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "totp_last_step": {
          "name": "totp_last_step",
          "type": "bigint",
          "primaryKey": false,
          "notNull": false
        },
        "purged_at": {
          "name": "purged_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "webauthn_user_id": {
          "name": "webauthn_user_id",
          "type": "bytea",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "users_email_lower_idx": {
          "name": "users_email_lower_idx",
          "columns": [
            {
              "expression": "lower(\"email\")",
              "asc": true,
              "isExpression": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "users_phone_hash_idx": {
          "name": "users_phone_hash_idx",
          "columns": [
            {
              "expression": "phone_hash",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "where": "phone_hash is not null",
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "users_webauthn_user_id_idx": {
          "name": "users_webauthn_user_id_idx",
          "columns": [
            {
              "expression": "webauthn_user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "where": "webauthn_user_id is not null",
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "users_auth_all": {
          "name": "users_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.handle_history": {
      "name": "handle_history",
      "schema": "",
      "columns": {
        "handle_lower": {
          "name": "handle_lower",
          "type": "text",
          "primaryKey": true,
          "notNull": true
        },
        "profile_id": {
          "name": "profile_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "changed_at": {
          "name": "changed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {},
      "foreignKeys": {
        "handle_history_profile_id_profiles_id_fk": {
          "name": "handle_history_profile_id_profiles_id_fk",
          "tableFrom": "handle_history",
          "tableTo": "profiles",
          "columnsFrom": [
            "profile_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "handle_history_api_all": {
          "name": "handle_history_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.profiles": {
      "name": "profiles",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true
        },
        "handle": {
          "name": "handle",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "display_name": {
          "name": "display_name",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "bio": {
          "name": "bio",
          "type": "text",
          "primaryKey": false,
          "notNull": true,
          "default": "''"
        },
        "avatar_path": {
          "name": "avatar_path",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "verified_at": {
          "name": "verified_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "reputation": {
          "name": "reputation",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "follower_count": {
          "name": "follower_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "following_count": {
          "name": "following_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "post_count": {
          "name": "post_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "deleted_at": {
          "name": "deleted_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "handle_changed_at": {
          "name": "handle_changed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "profiles_handle_lower_idx": {
          "name": "profiles_handle_lower_idx",
          "columns": [
            {
              "expression": "lower(\"handle\")",
              "asc": true,
              "isExpression": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "profiles_api_all": {
          "name": "profiles_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "profiles_counts_nonnegative": {
          "name": "profiles_counts_nonnegative",
          "value": "\"profiles\".\"follower_count\" >= 0 and \"profiles\".\"following_count\" >= 0 and \"profiles\".\"post_count\" >= 0"
        }
      },
      "isRLSEnabled": true
    },
    "public.blocks": {
      "name": "blocks",
      "schema": "",
      "columns": {
        "blocker_id": {
          "name": "blocker_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "blocked_id": {
          "name": "blocked_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "blocks_to_created_idx": {
          "name": "blocks_to_created_idx",
          "columns": [
            {
              "expression": "blocked_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "blocker_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "blocks_from_created_idx": {
          "name": "blocks_from_created_idx",
          "columns": [
            {
              "expression": "blocker_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "blocked_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "blocks_blocker_id_profiles_id_fk": {
          "name": "blocks_blocker_id_profiles_id_fk",
          "tableFrom": "blocks",
          "tableTo": "profiles",
          "columnsFrom": [
            "blocker_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "blocks_blocked_id_profiles_id_fk": {
          "name": "blocks_blocked_id_profiles_id_fk",
          "tableFrom": "blocks",
          "tableTo": "profiles",
          "columnsFrom": [
            "blocked_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {
        "blocks_blocker_id_blocked_id_pk": {
          "name": "blocks_blocker_id_blocked_id_pk",
          "columns": [
            "blocker_id",
            "blocked_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "blocks_api_all": {
          "name": "blocks_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "blocks_not_self": {
          "name": "blocks_not_self",
          "value": "\"blocks\".\"blocker_id\" <> \"blocks\".\"blocked_id\""
        }
      },
      "isRLSEnabled": true
    },
    "public.bookmarks": {
      "name": "bookmarks",
      "schema": "",
      "columns": {
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "post_id": {
          "name": "post_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "bookmarks_post_idx": {
          "name": "bookmarks_post_idx",
          "columns": [
            {
              "expression": "post_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "bookmarks_user_created_idx": {
          "name": "bookmarks_user_created_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "bookmarks_user_id_profiles_id_fk": {
          "name": "bookmarks_user_id_profiles_id_fk",
          "tableFrom": "bookmarks",
          "tableTo": "profiles",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "bookmarks_post_id_posts_id_fk": {
          "name": "bookmarks_post_id_posts_id_fk",
          "tableFrom": "bookmarks",
          "tableTo": "posts",
          "columnsFrom": [
            "post_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {
        "bookmarks_user_id_post_id_pk": {
          "name": "bookmarks_user_id_post_id_pk",
          "columns": [
            "user_id",
            "post_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "bookmarks_api_all": {
          "name": "bookmarks_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.follows": {
      "name": "follows",
      "schema": "",
      "columns": {
        "follower_id": {
          "name": "follower_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "followee_id": {
          "name": "followee_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "follows_to_created_idx": {
          "name": "follows_to_created_idx",
          "columns": [
            {
              "expression": "followee_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "follower_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "follows_from_created_idx": {
          "name": "follows_from_created_idx",
          "columns": [
            {
              "expression": "follower_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "followee_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "follows_follower_id_profiles_id_fk": {
          "name": "follows_follower_id_profiles_id_fk",
          "tableFrom": "follows",
          "tableTo": "profiles",
          "columnsFrom": [
            "follower_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "follows_followee_id_profiles_id_fk": {
          "name": "follows_followee_id_profiles_id_fk",
          "tableFrom": "follows",
          "tableTo": "profiles",
          "columnsFrom": [
            "followee_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {
        "follows_follower_id_followee_id_pk": {
          "name": "follows_follower_id_followee_id_pk",
          "columns": [
            "follower_id",
            "followee_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "follows_api_all": {
          "name": "follows_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "follows_not_self": {
          "name": "follows_not_self",
          "value": "\"follows\".\"follower_id\" <> \"follows\".\"followee_id\""
        }
      },
      "isRLSEnabled": true
    },
    "public.likes": {
      "name": "likes",
      "schema": "",
      "columns": {
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "post_id": {
          "name": "post_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "likes_post_idx": {
          "name": "likes_post_idx",
          "columns": [
            {
              "expression": "post_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "likes_user_created_idx": {
          "name": "likes_user_created_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "likes_user_id_profiles_id_fk": {
          "name": "likes_user_id_profiles_id_fk",
          "tableFrom": "likes",
          "tableTo": "profiles",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "likes_post_id_posts_id_fk": {
          "name": "likes_post_id_posts_id_fk",
          "tableFrom": "likes",
          "tableTo": "posts",
          "columnsFrom": [
            "post_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {
        "likes_user_id_post_id_pk": {
          "name": "likes_user_id_post_id_pk",
          "columns": [
            "user_id",
            "post_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "likes_api_all": {
          "name": "likes_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.mutes": {
      "name": "mutes",
      "schema": "",
      "columns": {
        "muter_id": {
          "name": "muter_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "muted_id": {
          "name": "muted_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "mutes_to_created_idx": {
          "name": "mutes_to_created_idx",
          "columns": [
            {
              "expression": "muted_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "muter_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "mutes_from_created_idx": {
          "name": "mutes_from_created_idx",
          "columns": [
            {
              "expression": "muter_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "muted_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "mutes_muter_id_profiles_id_fk": {
          "name": "mutes_muter_id_profiles_id_fk",
          "tableFrom": "mutes",
          "tableTo": "profiles",
          "columnsFrom": [
            "muter_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "mutes_muted_id_profiles_id_fk": {
          "name": "mutes_muted_id_profiles_id_fk",
          "tableFrom": "mutes",
          "tableTo": "profiles",
          "columnsFrom": [
            "muted_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {
        "mutes_muter_id_muted_id_pk": {
          "name": "mutes_muter_id_muted_id_pk",
          "columns": [
            "muter_id",
            "muted_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "mutes_api_all": {
          "name": "mutes_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "mutes_not_self": {
          "name": "mutes_not_self",
          "value": "\"mutes\".\"muter_id\" <> \"mutes\".\"muted_id\""
        }
      },
      "isRLSEnabled": true
    },
    "public.post_media": {
      "name": "post_media",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "owner_id": {
          "name": "owner_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "status": {
          "name": "status",
          "type": "media_status",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true,
          "default": "'processing'"
        },
        "error": {
          "name": "error",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "post_id": {
          "name": "post_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "position": {
          "name": "position",
          "type": "integer",
          "primaryKey": false,
          "notNull": false
        },
        "width": {
          "name": "width",
          "type": "integer",
          "primaryKey": false,
          "notNull": false
        },
        "height": {
          "name": "height",
          "type": "integer",
          "primaryKey": false,
          "notNull": false
        },
        "blurhash": {
          "name": "blurhash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "alt_text": {
          "name": "alt_text",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "nsfw_score": {
          "name": "nsfw_score",
          "type": "real",
          "primaryKey": false,
          "notNull": false
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "post_media_post_position_idx": {
          "name": "post_media_post_position_idx",
          "columns": [
            {
              "expression": "post_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "position",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "post_media_owner_created_idx": {
          "name": "post_media_owner_created_idx",
          "columns": [
            {
              "expression": "owner_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "post_media_status_created_idx": {
          "name": "post_media_status_created_idx",
          "columns": [
            {
              "expression": "status",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "post_media_owner_id_profiles_id_fk": {
          "name": "post_media_owner_id_profiles_id_fk",
          "tableFrom": "post_media",
          "tableTo": "profiles",
          "columnsFrom": [
            "owner_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "post_media_post_id_posts_id_fk": {
          "name": "post_media_post_id_posts_id_fk",
          "tableFrom": "post_media",
          "tableTo": "posts",
          "columnsFrom": [
            "post_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "post_media_api_all": {
          "name": "post_media_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "post_media_ready_has_dims": {
          "name": "post_media_ready_has_dims",
          "value": "\"post_media\".\"status\" <> 'ready' or (\"post_media\".\"width\" is not null and \"post_media\".\"height\" is not null and \"post_media\".\"blurhash\" is not null)"
        },
        "post_media_attached_is_complete": {
          "name": "post_media_attached_is_complete",
          "value": "\"post_media\".\"post_id\" is null or (\"post_media\".\"status\" = 'ready' and \"post_media\".\"position\" between 0 and 3 and \"post_media\".\"alt_text\" is not null)"
        },
        "post_media_alt_len": {
          "name": "post_media_alt_len",
          "value": "char_length(\"post_media\".\"alt_text\") <= 1000"
        }
      },
      "isRLSEnabled": true
    },
    "public.posts": {
      "name": "posts",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "author_id": {
          "name": "author_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "body": {
          "name": "body",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "reply_to_id": {
          "name": "reply_to_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "quote_of_id": {
          "name": "quote_of_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "state": {
          "name": "state",
          "type": "post_state",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true,
          "default": "'visible'"
        },
        "like_count": {
          "name": "like_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "repost_count": {
          "name": "repost_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "reply_count": {
          "name": "reply_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "quote_count": {
          "name": "quote_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "deleted_at": {
          "name": "deleted_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "posts_author_created_idx": {
          "name": "posts_author_created_idx",
          "columns": [
            {
              "expression": "author_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "posts_created_id_idx": {
          "name": "posts_created_id_idx",
          "columns": [
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "posts_reply_to_created_idx": {
          "name": "posts_reply_to_created_idx",
          "columns": [
            {
              "expression": "reply_to_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "posts_latest_idx": {
          "name": "posts_latest_idx",
          "columns": [
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "where": "reply_to_id is null and state = 'visible'",
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "posts_quote_of_idx": {
          "name": "posts_quote_of_idx",
          "columns": [
            {
              "expression": "quote_of_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "posts_author_id_profiles_id_fk": {
          "name": "posts_author_id_profiles_id_fk",
          "tableFrom": "posts",
          "tableTo": "profiles",
          "columnsFrom": [
            "author_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "posts_reply_to_id_posts_id_fk": {
          "name": "posts_reply_to_id_posts_id_fk",
          "tableFrom": "posts",
          "tableTo": "posts",
          "columnsFrom": [
            "reply_to_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "set null",
          "onUpdate": "no action"
        },
        "posts_quote_of_id_posts_id_fk": {
          "name": "posts_quote_of_id_posts_id_fk",
          "tableFrom": "posts",
          "tableTo": "posts",
          "columnsFrom": [
            "quote_of_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "set null",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "posts_api_all": {
          "name": "posts_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "posts_body_len": {
          "name": "posts_body_len",
          "value": "char_length(\"posts\".\"body\") <= 1000"
        },
        "posts_counts_nonnegative": {
          "name": "posts_counts_nonnegative",
          "value": "\"posts\".\"like_count\" >= 0 and \"posts\".\"repost_count\" >= 0 and \"posts\".\"reply_count\" >= 0 and \"posts\".\"quote_count\" >= 0"
        }
      },
      "isRLSEnabled": true
    },
    "public.reposts": {
      "name": "reposts",
      "schema": "",
      "columns": {
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "post_id": {
          "name": "post_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "reposts_post_idx": {
          "name": "reposts_post_idx",
          "columns": [
            {
              "expression": "post_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "reposts_user_created_idx": {
          "name": "reposts_user_created_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "reposts_user_id_profiles_id_fk": {
          "name": "reposts_user_id_profiles_id_fk",
          "tableFrom": "reposts",
          "tableTo": "profiles",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "reposts_post_id_posts_id_fk": {
          "name": "reposts_post_id_posts_id_fk",
          "tableFrom": "reposts",
          "tableTo": "posts",
          "columnsFrom": [
            "post_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {
        "reposts_user_id_post_id_pk": {
          "name": "reposts_user_id_post_id_pk",
          "columns": [
            "user_id",
            "post_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "reposts_api_all": {
          "name": "reposts_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.appeals": {
      "name": "appeals",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "case_id": {
          "name": "case_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "statement": {
          "name": "statement",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "status": {
          "name": "status",
          "type": "appeal_status",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true,
          "default": "'open'"
        },
        "reviewer_id": {
          "name": "reviewer_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "decision_reason": {
          "name": "decision_reason",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "decided_at": {
          "name": "decided_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "appeals_case_idx": {
          "name": "appeals_case_idx",
          "columns": [
            {
              "expression": "case_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "appeals_case_id_cases_id_fk": {
          "name": "appeals_case_id_cases_id_fk",
          "tableFrom": "appeals",
          "tableTo": "cases",
          "columnsFrom": [
            "case_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "appeals_reviewer_id_profiles_id_fk": {
          "name": "appeals_reviewer_id_profiles_id_fk",
          "tableFrom": "appeals",
          "tableTo": "profiles",
          "columnsFrom": [
            "reviewer_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "set null",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "appeals_api_all": {
          "name": "appeals_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.audit_log": {
      "name": "audit_log",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "bigserial",
          "primaryKey": true,
          "notNull": true
        },
        "actor_id": {
          "name": "actor_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "action": {
          "name": "action",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "target_type": {
          "name": "target_type",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "target_id": {
          "name": "target_id",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "metadata": {
          "name": "metadata",
          "type": "jsonb",
          "primaryKey": false,
          "notNull": true,
          "default": "'{}'::jsonb"
        },
        "request_id": {
          "name": "request_id",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {},
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "audit_log_api_insert": {
          "name": "audit_log_api_insert",
          "as": "PERMISSIVE",
          "for": "INSERT",
          "to": [
            "korbat_api"
          ],
          "withCheck": "true"
        },
        "audit_log_api_select": {
          "name": "audit_log_api_select",
          "as": "PERMISSIVE",
          "for": "SELECT",
          "to": [
            "korbat_api"
          ],
          "using": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.cases": {
      "name": "cases",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "target_type": {
          "name": "target_type",
          "type": "target_type",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true
        },
        "target_id": {
          "name": "target_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "rule_id": {
          "name": "rule_id",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "action": {
          "name": "action",
          "type": "case_action",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true,
          "default": "'none'"
        },
        "public_reason": {
          "name": "public_reason",
          "type": "text",
          "primaryKey": false,
          "notNull": true,
          "default": "''"
        },
        "moderator_id": {
          "name": "moderator_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "senior": {
          "name": "senior",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "brigading_flag": {
          "name": "brigading_flag",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "weight": {
          "name": "weight",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "closed_at": {
          "name": "closed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "cases_open_idx": {
          "name": "cases_open_idx",
          "columns": [
            {
              "expression": "closed_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "weight",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "cases_target_idx": {
          "name": "cases_target_idx",
          "columns": [
            {
              "expression": "target_type",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "target_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "cases_moderator_id_profiles_id_fk": {
          "name": "cases_moderator_id_profiles_id_fk",
          "tableFrom": "cases",
          "tableTo": "profiles",
          "columnsFrom": [
            "moderator_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "set null",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "cases_api_all": {
          "name": "cases_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.reports": {
      "name": "reports",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "reporter_id": {
          "name": "reporter_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "target_type": {
          "name": "target_type",
          "type": "target_type",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true
        },
        "target_id": {
          "name": "target_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "rule_id": {
          "name": "rule_id",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "details": {
          "name": "details",
          "type": "text",
          "primaryKey": false,
          "notNull": true,
          "default": "''"
        },
        "weight": {
          "name": "weight",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 1
        },
        "status": {
          "name": "status",
          "type": "report_status",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true,
          "default": "'open'"
        },
        "case_id": {
          "name": "case_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "reports_reporter_target_idx": {
          "name": "reports_reporter_target_idx",
          "columns": [
            {
              "expression": "reporter_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "target_type",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "target_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "reports_target_idx": {
          "name": "reports_target_idx",
          "columns": [
            {
              "expression": "target_type",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "target_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "reports_reporter_id_profiles_id_fk": {
          "name": "reports_reporter_id_profiles_id_fk",
          "tableFrom": "reports",
          "tableTo": "profiles",
          "columnsFrom": [
            "reporter_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "reports_case_id_cases_id_fk": {
          "name": "reports_case_id_cases_id_fk",
          "tableFrom": "reports",
          "tableTo": "cases",
          "columnsFrom": [
            "case_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "set null",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "reports_api_all": {
          "name": "reports_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.strikes": {
      "name": "strikes",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "case_id": {
          "name": "case_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "expires_at": {
          "name": "expires_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        }
      },
      "indexes": {
        "strikes_user_active_idx": {
          "name": "strikes_user_active_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "expires_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "strikes_user_id_profiles_id_fk": {
          "name": "strikes_user_id_profiles_id_fk",
          "tableFrom": "strikes",
          "tableTo": "profiles",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "strikes_case_id_cases_id_fk": {
          "name": "strikes_case_id_cases_id_fk",
          "tableFrom": "strikes",
          "tableTo": "cases",
          "columnsFrom": [
            "case_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "strikes_api_all": {
          "name": "strikes_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.transparency_log": {
      "name": "transparency_log",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "rule_id": {
          "name": "rule_id",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "action": {
          "name": "action",
          "type": "case_action",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true
        },
        "target_type": {
          "name": "target_type",
          "type": "target_type",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true
        },
        "decided_at": {
          "name": "decided_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "appealed": {
          "name": "appealed",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "appeal_outcome": {
          "name": "appeal_outcome",
          "type": "appeal_status",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": false
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "transparency_decided_idx": {
          "name": "transparency_decided_idx",
          "columns": [
            {
              "expression": "decided_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "transparency_api_all": {
          "name": "transparency_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    }
  },
  "enums": {
    "auth.auth_event_type": {
      "name": "auth_event_type",
      "schema": "auth",
      "values": [
        "signup",
        "signin_success",
        "signin_failure",
        "mfa_enabled",
        "mfa_disabled",
        "recovery_code_used",
        "recovery_codes_regenerated",
        "password_set",
        "password_changed",
        "session_revoked",
        "sessions_revoked_all",
        "account_locked",
        "new_device",
        "not_me",
        "profile_updated",
        "handle_changed",
        "email_changed",
        "badge_verified",
        "badge_removed",
        "export_created",
        "account_deleted",
        "passkey_added",
        "passkey_removed",
        "passkey_counter_regression"
      ]
    },
    "auth.email_code_purpose": {
      "name": "email_code_purpose",
      "schema": "auth",
      "values": [
        "signup",
        "login",
        "change_email",
        "recovery",
        "reauth",
        "delete_account"
      ]
    },
    "auth.user_role": {
      "name": "user_role",
      "schema": "auth",
      "values": [
        "user",
        "moderator",
        "admin"
      ]
    },
    "public.media_status": {
      "name": "media_status",
      "schema": "public",
      "values": [
        "processing",
        "ready",
        "failed"
      ]
    },
    "public.post_state": {
      "name": "post_state",
      "schema": "public",
      "values": [
        "visible",
        "withheld",
        "removed",
        "deleted_by_author"
      ]
    },
    "public.appeal_status": {
      "name": "appeal_status",
      "schema": "public",
      "values": [
        "open",
        "upheld",
        "denied"
      ]
    },
    "public.case_action": {
      "name": "case_action",
      "schema": "public",
      "values": [
        "none",
        "withhold",
        "remove",
        "strike",
        "suspend"
      ]
    },
    "public.report_status": {
      "name": "report_status",
      "schema": "public",
      "values": [
        "open",
        "merged",
        "closed"
      ]
    },
    "public.target_type": {
      "name": "target_type",
      "schema": "public",
      "values": [
        "post",
        "profile"
      ]
    }
  },
  "schemas": {
    "auth": "auth"
  },
  "sequences": {},
  "roles": {},
  "policies": {},
  "views": {},
  "_meta": {
    "columns": {},
    "schemas": {},
    "tables": {}
  }
}
```

### Replace `apps/api/.env.example` (whole file)

```text
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug
DATABASE_URL_API=postgres://korbat_api:change-me-api@localhost:55432/korbat
DATABASE_URL_AUTH=postgres://korbat_auth:change-me-auth@localhost:55432/korbat
DATABASE_URL_MIGRATE=postgres://korbat_migrate:change-me-migrate@localhost:55432/korbat
REDIS_URL=redis://:change-me-redis@localhost:56379
TRUSTED_ORIGINS=http://localhost:8081
APP_ORIGIN=http://localhost:8081
# Which header names the client: cloudflare (behind the tunnel), caddy (behind Caddy alone) or none (the
# socket). Development and the integration tests use cloudflare, the most permissive mode.
TRUST_PROXY=cloudflare
# Keys are generated by `node scripts/gen-dev-env.mjs`. Never reuse keys between environments.
AUTH_HMAC_KEY=change-me-key-auth-hmac
IP_HASH_KEY=change-me-key-ip-hash
TOTP_ENC_KEY=v1:change-me-key-totp
# Earlier TOTP keys, comma-separated, kept only while secrets they encrypted are still stored.
TOTP_ENC_KEYS_PREVIOUS=
# Cloudflare's documented always-pass test secret. Production uses the real secret.
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
# Local Mailpit from infra/compose.dev.yml. Production points at the EU relay.
SMTP_URL=smtp://localhost:51025
MAIL_FROM="korbat <no-reply@korbat.local>"
TERMS_VERSION=draft-2026-09
# Mailpit HTTP API, read by integration tests only.
MAILPIT_URL=http://localhost:58025
# Images on the host: the API writes uploads, the worker (apps/worker) writes the store. Both
# directories are created on demand under the repository's ignored .data folder.
MEDIA_UPLOADS_DIR=../../.data/media/uploads
MEDIA_STORE_DIR=../../.data/media/store
MEDIA_FORMATS=jpeg,png,webp,gif,avif
MEDIA_MIN_FREE_BYTES=2147483648
# Who checks the phone number behind the verified badge: off hides the badge, dev accepts the code 000000
# (development only; production refuses it), vonage texts a real code and needs VONAGE_API_KEY,
# VONAGE_API_SECRET and VERIFY_BRAND (1 to 18 characters), see infra/.env.example.
VERIFY_PROVIDER=dev
# Passkeys. The RP ID every passkey is bound to: empty means the host of APP_ORIGIN (localhost here). Production
# refuses an address or localhost and accepts only that host or a parent domain of it; changing it later strands
# every passkey. Browsers refuse passkeys on an IP address, so open the app at http://localhost, not 127.0.0.1.
WEBAUTHN_RP_ID=
# The site name password managers show next to a korbat passkey (1 to 64 printable characters); empty means korbat.
WEBAUTHN_RP_NAME=
```

### Replace `apps/api/package.json` (whole file)

```json
{
  "name": "@korbat/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch --env-file=.env src/index.ts",
    "build": "node build.mjs",
    "start": "node dist/index.js",
    "typecheck": "tsc -p .",
    "test": "vitest run",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "update:disposable": "node scripts/update-disposable-domains.mjs"
  },
  "dependencies": {
    "@hono/node-server": "2.1.1",
    "@hono/zod-validator": "0.9.1",
    "@korbat/contracts": "workspace:*",
    "@korbat/db": "workspace:*",
    "@korbat/media-protocol": "workspace:*",
    "@korbat/rules": "workspace:*",
    "@node-rs/argon2": "2.2.1",
    "@simplewebauthn/server": "14.0.2",
    "drizzle-orm": "0.45.2",
    "fflate": "0.8.3",
    "hono": "4.13.8",
    "ioredis": "6.0.0",
    "nodemailer": "10.0.10",
    "pino": "10.3.1",
    "pino-pretty": "13.1.3",
    "uqr": "0.1.3",
    "zod": "4.6.5"
  },
  "devDependencies": {
    "@types/node": "24.13.5",
    "esbuild": "0.28.2",
    "tsx": "4.23.13",
    "typescript": "7.0.2",
    "vitest": "4.1.11"
  }
}
```

### Replace `apps/api/src/auth/context.ts` (whole file)

```ts
import type { AuthErrorCode, MeProfile, Profile } from "@korbat/contracts";
import type { Logger } from "pino";
import type { Config } from "../config";
import type { Mailer } from "../mail/mailer";
import { decodeKey, parseVersionedKey, type VersionedKey } from "./crypto";
import type { KeyValueStore } from "./kv";
import type { Lockout } from "./lockout";
import type { BreachChecker } from "./passwords";
import type { AuthRepo } from "./repo";
import type { Sessions } from "./sessions";
import type { TurnstileVerifier } from "./turnstile";
import type { VerificationProvider } from "./verify/provider";

export interface AuthConfig {
  appOrigin: string;
  /** Origins allowed to send cookie-authenticated state-changing requests. */
  allowedOrigins: string[];
  authHmacKey: Buffer;
  ipHashKey: Buffer;
  totpKey: VersionedKey;
  /** Keys TOTP_ENC_KEY replaced; still accepted for decryption. */
  totpPreviousKeys: VersionedKey[];
  termsVersion: string;
  /** How the client address is read; see TRUST_PROXY in config.ts. */
  trustProxy: "cloudflare" | "caddy" | "none";
  /** Who checks the phone number behind the verified badge; see VERIFY_PROVIDER in config.ts. With `off` the badge routes answer badge_unavailable. */
  verifyProvider: "off" | "dev" | "vonage";
  /** The relying party passkeys are bound to; see WEBAUTHN_RP_ID and WEBAUTHN_RP_NAME in config.ts. */
  webauthn: {
    rpId: string;
    rpName: string;
    /** The origins a ceremony's clientDataJSON may name. */
    origins: string[];
  };
}

export function authConfigFrom(config: Config): AuthConfig {
  return {
    appOrigin: config.APP_ORIGIN,
    allowedOrigins: [config.APP_ORIGIN, ...config.TRUSTED_ORIGINS],
    authHmacKey: decodeKey(config.AUTH_HMAC_KEY),
    ipHashKey: decodeKey(config.IP_HASH_KEY),
    totpKey: parseVersionedKey(config.TOTP_ENC_KEY),
    totpPreviousKeys: config.TOTP_ENC_KEYS_PREVIOUS.map(parseVersionedKey),
    termsVersion: config.TERMS_VERSION,
    trustProxy: config.TRUST_PROXY,
    verifyProvider: config.VERIFY_PROVIDER,
    webauthn: {
      rpId: config.WEBAUTHN_RP_ID,
      rpName: config.WEBAUTHN_RP_NAME,
      // A passkey ceremony run from a development origin (Expo's dev server, say) is accepted outside production only:
      // in production the web app is served from APP_ORIGIN, and no other origin may use its passkeys.
      origins: config.NODE_ENV === "production" ? [config.APP_ORIGIN] : [config.APP_ORIGIN, ...config.TRUSTED_ORIGINS],
    },
  };
}

/** Public profiles live in the public schema, which the auth module cannot reach; the API supplies this. */
export interface ProfileStore {
  create(input: { id: string; handle: string; displayName: string }): Promise<{ ok: true; profile: Profile } | { ok: false; reason: "handle_taken" }>;
  /** The owner's view of their profile, which /me returns: the public facts plus the handle-change date and the badge. */
  find(id: string): Promise<MeProfile | null>;
  /** Sets or clears the badge (profiles.verified_at), which the auth module decides but cannot write itself. */
  setVerified(id: string, at: Date | null): Promise<void>;
}

export interface AuthDeps {
  repo: AuthRepo;
  kv: KeyValueStore;
  sessions: Sessions;
  lockout: Lockout;
  mailer: Mailer;
  turnstile: TurnstileVerifier;
  breachChecker: BreachChecker;
  profiles: ProfileStore;
  /** The phone verification provider behind the badge, or null when VERIFY_PROVIDER is off. */
  verify: VerificationProvider | null;
  config: AuthConfig;
  log: Logger;
  now: () => Date;
}

/** Per-request facts the flows need. The IP is already hashed; the raw address never enters a flow. */
export interface RequestContext {
  ipHash: string;
  userAgent: string | undefined;
}

export type AuthErrorStatus = 400 | 401 | 403 | 404 | 409 | 429 | 503;

/** The auth codes plus the shared one the module also raises, as the social and media modules do: a well-formed request that asks for nothing, such as the current address as the new one. */
export type AuthErrorKind = AuthErrorCode | "invalid_request";

const MESSAGES: Record<AuthErrorKind, string> = {
  invalid_code: "That code is not valid. Check the latest email or request a new code.",
  code_expired: "That code has expired. Request a new one.",
  too_many_attempts: "Too many attempts. Request a new code.",
  invalid_credentials: "Email or password is incorrect.",
  mfa_required: "Two-factor authentication must be turned on first.",
  invalid_mfa_code: "That authentication code is not valid.",
  reauth_required: "Confirm it's you to continue.",
  csrf_failed: "This request could not be verified. Reload the page and try again.",
  turnstile_failed: "We could not verify that you are human. Try again.",
  disposable_email: "Disposable email addresses cannot be used.",
  age_requirement: "You must be at least 16 to use korbat.",
  terms_required: "Accept the current terms to continue.",
  handle_taken: "That handle is taken.",
  handle_invalid: "Handles are 3 to 20 characters: lowercase letters, numbers and underscores.",
  handle_reserved: "That handle is reserved.",
  password_too_short: "Passwords need at least 12 characters.",
  password_too_long: "Passwords can have at most 128 characters.",
  password_breached: "That password appears in known data breaches. Choose a different one.",
  password_check_unavailable: "We could not check that password right now. Try again in a moment.",
  staff_mfa_required: "Staff accounts must keep two-factor authentication on.",
  onboarding_required: "Choose a handle to finish setting up your account.",
  mail_unavailable: "We could not send the email. Try again in a moment.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  handle_cooldown: "Handles can change once every 30 days.",
  email_in_use: "That email address already belongs to an account.",
  phone_in_use: "That phone number is already verified on another account.",
  badge_unavailable: "Verification is not available on this korbat.",
  verify_unavailable: "We could not reach the verification service. Try again in a moment.",
  passkey_invalid: "That passkey did not work. Try again or use your email.",
  passkey_unsupported: "This passkey provider is not supported. Try another one.",
  // The cap of 10; the flow passes its own message, with the hours left, for the bound of 5 a day.
  passkey_limit: "You have 10 passkeys. Remove one to add another.",
  passkey_suspended: "This passkey was switched off because a copy of it may exist. Remove it and add a new one.",
  passkey_not_found: "That passkey is gone.",
  challenge_expired: "That took too long. Try again.",
  invalid_request: "Some details are missing or invalid.",
};

export function authErrorMessage(code: AuthErrorKind): string {
  return MESSAGES[code];
}

/** An expected, user-facing failure. The HTTP layer turns it into an ErrorEnvelope with this code and status. */
export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorKind,
    readonly status: AuthErrorStatus,
    message: string = MESSAGES[code],
    /** For rate limits: seconds until the window resets, sent as Retry-After. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/** True for a Postgres unique-constraint violation, however deeply the driver error is wrapped. */
export function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === "object" && (current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
```

### Replace `apps/api/src/config.ts` (whole file)

```ts
import { isIP } from "node:net";
import { z } from "zod";
import { parseFormats } from "@korbat/media-protocol";

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** A base64 secret that decodes to at least 32 bytes. */
const base64Key = z
  .string()
  .regex(BASE64, "must be base64")
  .refine((s) => Buffer.from(s, "base64").length >= 32, "must decode to at least 32 bytes");

/** `v<N>:<base64>` decoding to exactly 32 bytes (AES-256). The version lets keys rotate. */
const versionedKey = z
  .string()
  .regex(/^v\d+:[A-Za-z0-9+/]+={0,2}$/, "must look like v1:<base64>")
  .refine((s) => Buffer.from(s.slice(s.indexOf(":") + 1), "base64").length === 32, "must decode to exactly 32 bytes");

/** Cloudflare's documented Turnstile test secrets: always pass, always fail, token spent. */
const TURNSTILE_TEST_SECRET = /^[123]x0+AA$/;

/** A secret that may be absent. Compose passes a blank line of infra/.env as an empty string, which counts as absent too. */
const optionalSecret = z
  .string()
  .optional()
  .transform((value) => (value ? value : undefined));

/** A setting whose blank value means "use the default": compose passes a variable infra/.env leaves empty as an empty string. */
const blankAsUnset = z
  .string()
  .optional()
  .transform((value) => (value?.trim() ? value.trim() : undefined));

/**
 * A domain name as WebAuthn takes an RP ID: dot-separated labels of letters, digits and hyphens, each at most 63
 * characters and neither starting nor ending with a hyphen; no scheme, port, path or final dot.
 */
const RP_ID = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

/** Printable text: no control, format, private-use or unassigned characters, and no line or paragraph separators. */
const PRINTABLE = /^[^\p{C}\p{Zl}\p{Zp}]+$/u;

/** The host of an origin as an RP ID would name it: lowercase, without the port or the brackets of an IPv6 address. */
function hostOf(origin: string): string {
  return new URL(origin).hostname.replace(/^\[(.*)\]$/, "$1");
}

/** localhost and its subdomains (RFC 6761): names that only ever mean this machine. */
function isLocalhost(name: string): boolean {
  return name === "localhost" || name.endsWith(".localhost");
}

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL_API: z.url({ protocol: /^postgres(ql)?$/ }),
  DATABASE_URL_AUTH: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  TRUSTED_ORIGINS: z
    .string()
    .default("")
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)),
  KORBAT_VERSION: z.string().default("0.0.0-dev"),
  /**
   * Which header names the client: `cloudflare` behind the tunnel (cf-connecting-ip), `caddy` behind Caddy
   * alone (the first X-Forwarded-For entry, which Caddy sets itself), `none` for the socket address only.
   * A header the mode does not trust is ignored, so a client cannot choose its own rate-limit bucket.
   */
  TRUST_PROXY: z.enum(["cloudflare", "caddy", "none"]).default("none"),
  /** Origin of the web app; state-changing cookie requests must come from here (or TRUSTED_ORIGINS). */
  APP_ORIGIN: z.url({ protocol: /^https?$/ }),
  /** Keys email codes, recovery codes, device ids and email rate-limit buckets. */
  AUTH_HMAC_KEY: base64Key,
  /** Keys IP addresses before they are stored or used as rate-limit buckets. */
  IP_HASH_KEY: base64Key,
  /** Encrypts TOTP secrets at rest. */
  TOTP_ENC_KEY: versionedKey,
  /** Earlier TOTP keys, comma-separated, still accepted for decryption; a secret read with one is re-encrypted with TOTP_ENC_KEY. */
  TOTP_ENC_KEYS_PREVIOUS: z
    .string()
    .default("")
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(versionedKey)),
  TURNSTILE_SECRET_KEY: z.string().min(1),
  SMTP_URL: z.url({ protocol: /^smtps?$/ }),
  MAIL_FROM: z.string().min(3),
  TERMS_VERSION: z.string().min(1).max(64),
  /** The uploads volume, which the API writes and the image worker only reads. The default suits `pnpm dev` from apps/api. */
  MEDIA_UPLOADS_DIR: z.string().min(1).default("../../.data/media/uploads"),
  /** The store volume, which the image worker writes and the API only reads. */
  MEDIA_STORE_DIR: z.string().min(1).default("../../.data/media/store"),
  /** A comma-separated subset of jpeg, png, webp, gif, avif; unset enables all. The worker reads the same variable. */
  MEDIA_FORMATS: z
    .string()
    .optional()
    .transform((value, ctx) => {
      try {
        return parseFormats(value);
      } catch (err) {
        ctx.addIssue({ code: "custom", message: (err as Error).message });
        return z.NEVER;
      }
    }),
  /** Uploads are refused while either media volume has less free space than this. The volumes share a disk with Postgres. */
  MEDIA_MIN_FREE_BYTES: z.coerce.number().int().nonnegative().default(2 * 1024 ** 3),
  /**
   * The sweeper's reconcile pass deletes images that have no row. `on` refuses when there are many of them
   * (a database restored from an older snapshot looks like that); `force` deletes anyway; `off` skips the pass,
   * for the restore window.
   */
  MEDIA_RECONCILE: z.enum(["on", "off", "force"]).default("on"),
  /**
   * Who checks the phone number behind the verified badge: `off` hides the badge, `dev` accepts the code
   * 000000 and nothing else (development only), `vonage` texts a real code through Vonage Verify with the
   * two credentials below.
   */
  VERIFY_PROVIDER: z.enum(["off", "dev", "vonage"]).default("off"),
  VONAGE_API_KEY: optionalSecret,
  VONAGE_API_SECRET: optionalSecret,
  /** The sender name in the verification text. Vonage allows 1 to 18 characters and none of / { } : $. */
  VERIFY_BRAND: z.string().min(1).max(18).regex(/^[^\/{}:$]*$/, "must not contain / { } : or $").default("korbat"),
  /**
   * The relying party ID every passkey is bound to (1c design, section 11): the host of APP_ORIGIN when unset, or a
   * parent domain of it, which subdomains can then share. Changing it later strands every passkey already added.
   */
  WEBAUTHN_RP_ID: blankAsUnset.pipe(z.string().toLowerCase().regex(RP_ID, "must be a bare domain name such as korbat.example: no scheme, port or path").optional()),
  /** The site name password managers show next to a korbat passkey. */
  WEBAUTHN_RP_NAME: blankAsUnset.pipe(z.string().max(64).regex(PRINTABLE, "must be printable: no control or invisible characters").default("korbat")),
}).superRefine((c, ctx) => {
  if (c.NODE_ENV !== "production") return;
  const refuse = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  if (TURNSTILE_TEST_SECRET.test(c.TURNSTILE_SECRET_KEY)) refuse("TURNSTILE_SECRET_KEY", "is a Turnstile test secret; production needs the secret of your own widget");
  if (!c.APP_ORIGIN.startsWith("https://")) refuse("APP_ORIGIN", "must be an https origin in production");
  for (const origin of c.TRUSTED_ORIGINS) if (!origin.startsWith("https://")) refuse("TRUSTED_ORIGINS", `${origin} is not an https origin`);
  // The development provider would hand the badge to anyone who types 000000.
  if (c.VERIFY_PROVIDER === "dev") refuse("VERIFY_PROVIDER", "VERIFY_PROVIDER=dev is for development only");
  if (c.VERIFY_PROVIDER === "vonage") {
    if (!c.VONAGE_API_KEY) refuse("VONAGE_API_KEY", "is required when VERIFY_PROVIDER is vonage");
    if (!c.VONAGE_API_SECRET) refuse("VONAGE_API_SECRET", "is required when VERIFY_PROVIDER is vonage");
  }
  // Browsers accept an RP ID only on its own host or a subdomain of it, and never an address; localhost would
  // bind every passkey to one machine. The dot keeps a bare top-level name out (browsers refuse public suffixes
  // such as co.uk themselves).
  const host = hostOf(c.APP_ORIGIN);
  const rpId = c.WEBAUTHN_RP_ID ?? host;
  if (isIP(rpId) || isIP(host)) {
    refuse("WEBAUTHN_RP_ID", "WEBAUTHN_RP_ID cannot be an IP address, nor can APP_ORIGIN name one: WebAuthn refuses them, so production needs a domain name");
  } else if (isLocalhost(rpId) || isLocalhost(host)) {
    refuse("WEBAUTHN_RP_ID", "WEBAUTHN_RP_ID cannot be localhost in production, nor can APP_ORIGIN name it");
  } else if (rpId !== host && !(host.endsWith(`.${rpId}`) && rpId.includes("."))) {
    refuse("WEBAUTHN_RP_ID", `WEBAUTHN_RP_ID must be the host of APP_ORIGIN (${host}) or a parent domain of it that has a dot`);
  }
}).transform((c) => ({ ...c, WEBAUTHN_RP_ID: c.WEBAUTHN_RP_ID ?? hostOf(c.APP_ORIGIN) }));

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
```

### Replace `apps/api/src/mail/mailer.ts` (whole file)

```ts
export type TemplateName =
  | "sign_in_code"
  | "sign_up_code"
  | "reauth_code"
  | "new_device"
  | "account_locked"
  | "mfa_enabled"
  | "mfa_disabled"
  | "password_changed"
  | "recovery_codes_regenerated"
  | "sessions_revoked_all"
  | "email_change_code"
  | "email_changed"
  | "email_change_reverted"
  | "badge_verified"
  | "badge_removed"
  | "delete_account_code"
  | "account_deleted"
  | "passkey_added"
  | "passkey_removed"
  | "passkey_suspect";

export interface MailMessage {
  to: string;
  template: TemplateName;
  data: Record<string, string>;
}

export interface Mailer {
  /** Throws MailUnavailable when the message could not be handed to the relay. */
  send(message: MailMessage): Promise<void>;
}

export class MailUnavailable extends Error {}
```

### Replace `apps/api/src/mail/templates.ts` (whole file)

```ts
import type { TemplateName } from "./mailer";

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch]!);
}

function need(data: Record<string, string>, key: string): string {
  const value = data[key];
  if (value === undefined || value === "") throw new Error(`mail template data is missing "${key}"`);
  return value;
}

/** Plain paragraphs only: no images, no tracking, no anchor tags. URLs appear as text. */
function build(subject: string, paragraphs: string[]): RenderedMail {
  return {
    subject,
    text: `${paragraphs.join("\n\n")}\n`,
    html: `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">${paragraphs
      .map((p) => `<p>${escapeHtml(p)}</p>`)
      .join("")}</body></html>`,
  };
}

export function renderTemplate(template: TemplateName, data: Record<string, string>): RenderedMail {
  switch (template) {
    case "sign_in_code":
      return build("Your korbat sign-in code", [
        `Your sign-in code is ${need(data, "code")}.`,
        "It expires in 10 minutes. If you did not try to sign in, you can ignore this email; nobody can sign in without the code.",
      ]);
    case "sign_up_code":
      return build("Your korbat sign-up code", [
        `Your sign-up code is ${need(data, "code")}.`,
        "It expires in 10 minutes. If you did not try to create a korbat account, you can ignore this email.",
      ]);
    case "reauth_code":
      return build("Confirm it's you on korbat", [
        `Your confirmation code is ${need(data, "code")}.`,
        "It expires in 10 minutes. korbat asks for it before sensitive account changes.",
      ]);
    case "new_device":
      return build("New sign-in to your korbat account", [
        `Your account was just signed in from a new device: ${need(data, "deviceLabel")}.`,
        "If this was you, there is nothing to do.",
        `If this was not you, open this link within 24 hours to sign out every session and remove your password: ${need(data, "notMeUrl")}`,
      ]);
    case "account_locked":
      return build("Password sign-in paused on your korbat account", [
        `After several wrong passwords, password sign-in is paused for ${need(data, "minutes")} minutes.`,
        "You can still sign in with an emailed code. If you did not try to sign in, consider turning on two-factor authentication.",
      ]);
    case "mfa_enabled":
      return build("Two-factor authentication is on for your korbat account", [
        "Two-factor authentication was just turned on for your korbat account, and a new set of recovery codes was issued.",
        "If this was you, there is nothing to do. If not, sign in, open Security, and review your sessions and devices.",
      ]);
    case "mfa_disabled":
      return build("Two-factor authentication is off for your korbat account", [
        "Two-factor authentication was just turned off for your korbat account.",
        "If this was you, there is nothing to do. If not, sign in, open Security, turn it back on and sign out everywhere.",
      ]);
    case "password_changed":
      return build("Your korbat password changed", [
        "The password of your korbat account was just set or changed.",
        "If this was you, there is nothing to do. If not, sign in with an emailed code, open Security, set a new password and sign out everywhere.",
      ]);
    case "recovery_codes_regenerated":
      return build("New recovery codes for your korbat account", [
        "A new set of recovery codes was just issued for your korbat account. The old codes no longer work.",
        "If this was you, there is nothing to do. If not, sign in, open Security, and review your sessions and devices.",
      ]);
    case "sessions_revoked_all":
      return build("Signed out everywhere on korbat", [
        `Every session of your korbat account was just signed out (${need(data, "count")} in total).`,
        "If this was you, there is nothing to do. If not, sign in and set a new password.",
      ]);
    case "email_change_code":
      return build("Confirm your new korbat email address", [
        `Your confirmation code is ${need(data, "code")}.`,
        "It expires in 10 minutes. If you did not ask to move a korbat account to this address, you can ignore this email; nothing changes without the code.",
      ]);
    case "email_changed":
      // The undo link goes with the first change in a day only (flows/email-change.ts); a later change in that day
      // says where the link that works went, because signing in here is no longer possible.
      return build("Your korbat email address changed", [
        `The email address of your korbat account was just changed to ${need(data, "email")}. This address no longer belongs to the account.`,
        "Every session stays signed in. If this was you, there is nothing to do.",
        data.revertUrl
          ? `If this was not you, open this link within 24 hours to move the account back to this address and sign out every session: ${data.revertUrl}`
          : "If this was not you: the address had already changed less than a day ago, and the link sent then, to the address the account had before, can still move the account back there and sign out every session.",
      ]);
    case "email_change_reverted":
      return build("Your korbat account is back at this address", [
        "Your korbat account is back at this address, moved back from the link sent when its address changed, and every session was signed out.",
        "Sign in with a code sent to this address. A password or two-factor authentication set up after the change was removed; set them up again from Security.",
      ]);
    case "badge_verified":
      return build("Your korbat account is verified", [
        "Your phone number was just confirmed, and your korbat account now shows the verified badge.",
        "korbat keeps only a keyed hash of the number, never the number itself. If this was not you, sign in, open Account, and remove the badge.",
      ]);
    case "badge_removed":
      return build("The verified badge was removed from your korbat account", [
        "The verified badge was just removed from your korbat account, and the phone number behind it was forgotten.",
        "If this was you, there is nothing to do. If not, sign in, open Security, and review your sessions and devices.",
      ]);
    case "delete_account_code":
      return build("Confirm deleting your korbat account", [
        `Someone asked to delete your korbat account. The confirmation code is ${need(data, "code")}.`,
        "It expires in 10 minutes. Deleting the account removes your posts, images and profile for good; nothing happens without the code.",
        "If this was not you, do not enter the code: sign in, open Security, and revoke your other sessions.",
      ]);
    case "account_deleted":
      return build("Your korbat account was deleted", [
        "Your korbat account was deleted as you asked. Your posts, images and profile are gone, and your handle stays reserved so nobody can take it.",
        "This cannot be undone. Thank you for having been part of korbat; you are welcome back with a new account any time.",
      ]);
    case "passkey_added":
      // The link runs the lockdown anchored at the passkey's creation (1c design, section 7.6): it reaches back a day,
      // so a password or two-factor set up just before the passkey, from the same stolen session, goes with it.
      return build("A passkey was added to your korbat account", [
        `A passkey named "${need(data, "name")}" was added to your korbat account from ${need(data, "deviceLabel")} at ${need(data, "time")}.`,
        "If this was you, there is nothing to do.",
        `If this was not you, open this link within 7 days. It removes this passkey, signs out every session, removes your password, and turns off every passkey and two-factor authentication set up since the day before this one was added; then you sign in with a code sent to this address: ${need(data, "removeUrl")}`,
      ]);
    case "passkey_removed":
      return build("A passkey was removed from your korbat account", [
        `The passkey named "${need(data, "name")}" was removed from your korbat account at ${need(data, "time")}. It can no longer sign in.`,
        "If this was you, there is nothing to do. If not, sign in, open Security, and review your passkeys, sessions and devices.",
      ]);
    case "passkey_suspect":
      // A counter that went backwards (1c design, section 2): the signature was right, so someone holds the key, and
      // either the authenticator was cloned or a backup was restored. Only the owner can tell, so the key stays off.
      return build("A passkey on your korbat account was switched off", [
        `A sign-in just used what looks like a copy of your passkey named "${need(data, "name")}", so korbat switched that passkey off. It can no longer sign in.`,
        "Sign in with a code sent to this address, open Security, remove it and add a new one. If you did not try to sign in just now, also review your sessions and devices.",
      ]);
  }
}
```

### Replace `apps/app/package.json` (whole file)

```json
{
  "name": "@korbat/app",
  "version": "0.0.0",
  "private": true,
  "main": "expo-router/entry",
  "scripts": {
    "start": "expo start",
    "web": "expo start --web",
    "export:web": "expo export --platform web",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@korbat/contracts": "workspace:*",
    "@marsidev/react-turnstile": "1.6.1",
    "@simplewebauthn/browser": "14.0.0",
    "expo": "57.0.22",
    "expo-constants": "57.0.18",
    "expo-image": "57.0.5",
    "expo-linking": "57.0.10",
    "expo-router": "57.0.21",
    "nativewind": "4.2.7",
    "react": "19.2.3",
    "react-dom": "19.2.3",
    "react-native": "0.86.3",
    "react-native-gesture-handler": "2.32.0",
    "react-native-reanimated": "4.5.1",
    "react-native-safe-area-context": "5.7.0",
    "react-native-screens": "4.26.2",
    "react-native-web": "0.21.2",
    "react-native-worklets": "0.10.1",
    "zod": "4.6.5"
  },
  "devDependencies": {
    "@types/node": "24.13.5",
    "@types/react": "19.2.18",
    "tailwindcss": "3.4.19",
    "typescript": "6.0.3",
    "vitest": "4.1.11"
  }
}
```

### Replace `infra/.env.example` (whole file)

```text
# Copy to infra/.env and change every password. Never commit infra/.env.
POSTGRES_USER=postgres
POSTGRES_PASSWORD=change-me-superuser
POSTGRES_DB=korbat
KORBAT_MIGRATE_DB_PASSWORD=change-me-migrate
KORBAT_API_DB_PASSWORD=change-me-api
KORBAT_AUTH_DB_PASSWORD=change-me-auth
# Valkey (the session cache and rate-limit counters) refuses every command without it.
REDIS_PASSWORD=change-me-redis

# Images. The formats korbat accepts: remove one to refuse it and keep its decoder blocked, for
# example after a security advisory against that decoder, then restart api and worker.
MEDIA_FORMATS=jpeg,png,webp,gif,avif
# Uploads are refused while a media volume has less free space than this many bytes (2 GiB). The
# volumes share a disk with Postgres, and a full disk stops the database.
MEDIA_MIN_FREE_BYTES=2147483648
# The sweeper's pass that deletes images without a database row: on refuses when there are many of
# them (a database restored from an older snapshot looks like that), off skips it during a restore,
# force deletes them once you have checked.
MEDIA_RECONCILE=on

API_LOG_LEVEL=info
# Comma-separated browser origins allowed to call the API cross-origin. Empty in prod (same origin via Caddy).
API_TRUSTED_ORIGINS=http://localhost:8081

# Auth. `node scripts/gen-dev-env.mjs` fills the keys with random values and shares them with apps/api/.env.
# Origin the web app is served from (Caddy). Production: https://<your domain>.
API_APP_ORIGIN=http://localhost:8080
# Which header names the client: cloudflare when the tunnel is the only way in (the API then trusts
# cf-connecting-ip), caddy when Caddy's port is reachable directly. Never none behind a proxy.
API_TRUST_PROXY=caddy
API_AUTH_HMAC_KEY=change-me-key-auth-hmac
API_IP_HASH_KEY=change-me-key-ip-hash
API_TOTP_ENC_KEY=v1:change-me-key-totp
# Earlier TOTP keys, comma-separated, kept only while secrets they encrypted are still stored; a secret
# read with one is re-encrypted with API_TOTP_ENC_KEY.
API_TOTP_ENC_KEYS_PREVIOUS=
# Cloudflare's documented always-pass test secret. Production uses the secret of your Turnstile widget.
API_TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
# Mailpit from compose.dev.yml. Production: the EU relay, e.g. smtps://user:pass@smtp-relay.example:465
API_SMTP_URL=smtp://mailpit:1025
API_MAIL_FROM="korbat <no-reply@korbat.local>"
API_TERMS_VERSION=draft-2026-09
# Who checks the phone number behind the verified badge: off turns the badge off, dev accepts the code
# 000000 (development only; production refuses it), vonage texts a real code through Vonage Verify with the
# key and secret from the Vonage dashboard (the runbook in the 1b design says how).
API_VERIFY_PROVIDER=off
# Whether the web app's account settings show the verified badge section: on or off. Set it together with
# API_VERIFY_PROVIDER: off while that is off, on once it is dev or vonage (a section shown without a provider
# answers every Send code with "Verification is not available"). The web image reads it as EXPO_PUBLIC_BADGE,
# which Expo inlines at export time.
WEB_BADGE=off
API_VONAGE_API_KEY=
API_VONAGE_API_SECRET=
# The sender name of the verification text: 1 to 18 characters, none of / { } : $.
API_VERIFY_BRAND=korbat
# Passkeys. The RP ID every passkey is bound to: empty means the host of API_APP_ORIGIN. It may instead be a parent
# domain of that host (korbat.example for app.korbat.example), which an admin console on another subdomain could then
# share. Production refuses an IP address or localhost. Choose it before the first passkey is added: changing it
# later strands every passkey.
API_WEBAUTHN_RP_ID=
# The site name password managers show next to a korbat passkey: 1 to 64 printable characters; empty means korbat.
API_WEBAUTHN_RP_NAME=

# Public Turnstile site key baked into the web image. Cloudflare's always-pass test key for development;
# production uses the site key of the same widget as API_TURNSTILE_SECRET_KEY.
WEB_TURNSTILE_SITE_KEY=1x00000000000000000000AA

# development or production. It is the API's NODE_ENV (production refuses Turnstile test keys, plain-http
# origins and a relay without TLS) and a build argument of the web image (production refuses the
# Turnstile test site key). Set it to production before building the images for the public.
KORBAT_ENV=development
# on when cloudflared is the only way in: Caddy then keeps CF-Connecting-IP for the API (and
# API_TRUST_PROXY is cloudflare). off drops the header, so nobody on the network can claim an address.
TUNNEL=off
# Cloudflare Tunnel token (Zero Trust > Networks > Tunnels). Only needed with --profile tunnel. The
# tunnel's public hostname must point at http://caddy:8080.
TUNNEL_TOKEN=

# The development stack's host ports, read only by infra/compose.dev.yml. Set one when another container
# on this machine holds the default, and give apps/api/.env the same port. Defaults: 55432, 56379, 3000,
# 8080, 51025, 58025.
# DEV_PG_PORT=55432
# DEV_REDIS_PORT=56379
# DEV_API_PORT=3000
# DEV_CADDY_PORT=8080
# DEV_SMTP_PORT=51025
# DEV_MAILPIT_PORT=58025
```

### Replace `infra/compose.yml` (whole file)

```yaml
name: korbat

x-logging: &logging
  driver: json-file
  options: { max-size: "20m", max-file: "5" }

x-node-common: &node-common
  restart: unless-stopped
  read_only: true
  tmpfs: ["/tmp"]
  security_opt: ["no-new-privileges:true"]
  logging: *logging

services:
  postgres:
    # PostgreSQL 18. From 18 on the image keeps the cluster under /var/lib/postgresql/<major>/docker, so
    # the volume is mounted one level up and a later major can pg_upgrade inside it. A cluster from the
    # earlier pgdata volume (PostgreSQL 16) is moved over by scripts/pg-major-upgrade.mjs.
    image: postgres:18.6-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873
    restart: unless-stopped
    logging: *logging
    mem_limit: 1g
    memswap_limit: 1g
    pids_limit: 256
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
      KORBAT_MIGRATE_DB_PASSWORD: ${KORBAT_MIGRATE_DB_PASSWORD}
      KORBAT_API_DB_PASSWORD: ${KORBAT_API_DB_PASSWORD}
      KORBAT_AUTH_DB_PASSWORD: ${KORBAT_AUTH_DB_PASSWORD}
    volumes:
      - pgdata18:/var/lib/postgresql
      - ./postgres/init:/docker-entrypoint-initdb.d:ro
    networks: [data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 5s
      timeout: 3s
      retries: 20

  redis:
    # Valkey, the BSD-licensed fork of Redis, under the service name the URLs already use. A password
    # is required: nothing on the data network may read the session cache without it.
    image: valkey/valkey:9.1.2-alpine@sha256:48332870af354a799964c0012ae1194a0bf2bf894eb508f945810596dc2d8d11
    restart: unless-stopped
    logging: *logging
    mem_limit: 384m
    memswap_limit: 384m
    pids_limit: 64
    environment:
      REDIS_PASSWORD: ${REDIS_PASSWORD:?set REDIS_PASSWORD in infra/.env}
    command: ["sh", "-c", "exec valkey-server --appendonly yes --maxmemory 256mb --maxmemory-policy noeviction --requirepass $$REDIS_PASSWORD"]
    volumes:
    # A fresh volume: Valkey 9 cannot read the RDB format 12 that Redis 7.4 wrote into `redisdata`, and that
    # volume held only transient state (limits, codes in flight, cached sessions, queued image jobs).
      - valkeydata:/data
    networks: [data]
    healthcheck:
      test: ["CMD-SHELL", "VALKEYCLI_AUTH=$$REDIS_PASSWORD valkey-cli ping | grep -q PONG"]
      interval: 5s
      timeout: 3s
      retries: 20

  migrate:
    <<: *node-common
    restart: "no"
    build:
      context: ..
      dockerfile: apps/api/Dockerfile
    command: ["node", "dist/migrate.js"]
    environment:
      DATABASE_URL_MIGRATE: postgres://korbat_migrate:${KORBAT_MIGRATE_DB_PASSWORD}@postgres:5432/${POSTGRES_DB}
      MIGRATIONS_DIR: /app/migrations
    networks: [data]
    depends_on:
      postgres: { condition: service_healthy }

  api:
    <<: *node-common
    build:
      context: ..
      dockerfile: apps/api/Dockerfile
      args:
        KORBAT_VERSION: ${KORBAT_VERSION:-0.0.0}
    mem_limit: 512m
    memswap_limit: 512m
    pids_limit: 256
    environment:
      # development or production, from infra/.env; production turns on the guards against test keys, plain-http
      # origins and a relay without TLS. The worker below always runs as production.
      NODE_ENV: ${KORBAT_ENV:?set KORBAT_ENV to development or production in infra/.env}
      PORT: "3000"
      LOG_LEVEL: ${API_LOG_LEVEL:-info}
      DATABASE_URL_API: postgres://korbat_api:${KORBAT_API_DB_PASSWORD}@postgres:5432/${POSTGRES_DB}
      DATABASE_URL_AUTH: postgres://korbat_auth:${KORBAT_AUTH_DB_PASSWORD}@postgres:5432/${POSTGRES_DB}
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379
      TRUSTED_ORIGINS: ${API_TRUSTED_ORIGINS:-}
      # Which header names the client: the stack refuses to start without a choice.
      TRUST_PROXY: ${API_TRUST_PROXY:?set API_TRUST_PROXY in infra/.env}
      # Auth settings. The stack refuses to start while any of these is missing from infra/.env.
      APP_ORIGIN: ${API_APP_ORIGIN:?set API_APP_ORIGIN in infra/.env}
      AUTH_HMAC_KEY: ${API_AUTH_HMAC_KEY:?set API_AUTH_HMAC_KEY in infra/.env}
      IP_HASH_KEY: ${API_IP_HASH_KEY:?set API_IP_HASH_KEY in infra/.env}
      TOTP_ENC_KEY: ${API_TOTP_ENC_KEY:?set API_TOTP_ENC_KEY in infra/.env}
      TOTP_ENC_KEYS_PREVIOUS: ${API_TOTP_ENC_KEYS_PREVIOUS:-}
      TURNSTILE_SECRET_KEY: ${API_TURNSTILE_SECRET_KEY:?set API_TURNSTILE_SECRET_KEY in infra/.env}
      SMTP_URL: ${API_SMTP_URL:?set API_SMTP_URL in infra/.env}
      MAIL_FROM: ${API_MAIL_FROM:?set API_MAIL_FROM in infra/.env}
      TERMS_VERSION: ${API_TERMS_VERSION:?set API_TERMS_VERSION in infra/.env}
      # The verified badge's phone check. off (the default) hides the badge; vonage needs the two credentials.
      VERIFY_PROVIDER: ${API_VERIFY_PROVIDER:-off}
      VONAGE_API_KEY: ${API_VONAGE_API_KEY:-}
      VONAGE_API_SECRET: ${API_VONAGE_API_SECRET:-}
      VERIFY_BRAND: ${API_VERIFY_BRAND:-korbat}
      # Passkeys. Empty values leave the API's defaults: the host of APP_ORIGIN as the RP ID and korbat as the name.
      WEBAUTHN_RP_ID: ${API_WEBAUTHN_RP_ID:-}
      WEBAUTHN_RP_NAME: ${API_WEBAUTHN_RP_NAME:-}
      # Images. The API writes uploads and only reads what the worker stored.
      MEDIA_UPLOADS_DIR: /media/uploads
      MEDIA_STORE_DIR: /media/store
      MEDIA_FORMATS: ${MEDIA_FORMATS:-jpeg,png,webp,gif,avif}
      MEDIA_MIN_FREE_BYTES: ${MEDIA_MIN_FREE_BYTES:-2147483648}
      MEDIA_RECONCILE: ${MEDIA_RECONCILE:-on}
    volumes:
      - media-uploads:/media/uploads
      - media-store:/media/store:ro
    networks: [app, data]
    depends_on:
      migrate: { condition: service_completed_successfully }
      redis: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/api/health"]
      interval: 10s
      timeout: 3s
      retries: 10

  # The image worker runs the decoder, the most exploitable code in the stack. It has no network at
  # all, no credentials and no capabilities: it reads uploads and writes the store, and that is
  # everything it can reach. The memory limit was sized on worst-case images (2b design, Research).
  worker:
    <<: *node-common
    build:
      context: ..
      dockerfile: apps/worker/Dockerfile
    network_mode: none
    cap_drop: [ALL]
    mem_limit: 768m
    memswap_limit: 768m
    cpus: 1.0
    pids_limit: 64
    tmpfs: ["/tmp:size=64m"]
    environment:
      NODE_ENV: production
      LOG_LEVEL: ${API_LOG_LEVEL:-info}
      MEDIA_UPLOADS_DIR: /media/uploads
      MEDIA_STORE_DIR: /media/store
      MEDIA_FORMATS: ${MEDIA_FORMATS:-jpeg,png,webp,gif,avif}
    volumes:
      - media-uploads:/media/uploads:ro
      - media-store:/media/store
    healthcheck:
      test: ["CMD", "node", "-e", "process.exit(Date.now() - JSON.parse(require('fs').readFileSync('/media/store/heartbeat', 'utf8')).at < 60000 ? 0 : 1)"]
      interval: 15s
      timeout: 5s
      retries: 4

  # Caddy serves the web app and proxies /api. It runs as its own user on port 8080, sees only the
  # API, and is the only thing cloudflared can reach.
  caddy:
    restart: unless-stopped
    read_only: true
    tmpfs: ["/tmp"]
    security_opt: ["no-new-privileges:true"]
    cap_drop: [ALL]
    logging: *logging
    mem_limit: 128m
    memswap_limit: 128m
    pids_limit: 64
    build:
      context: ..
      dockerfile: infra/caddy/Dockerfile
      args:
        EXPO_PUBLIC_TURNSTILE_SITE_KEY: ${WEB_TURNSTILE_SITE_KEY:?set WEB_TURNSTILE_SITE_KEY in infra/.env}
        KORBAT_ENV: ${KORBAT_ENV:?set KORBAT_ENV to development or production in infra/.env}
        TUNNEL: ${TUNNEL:-off}
        EXPO_PUBLIC_BADGE: ${WEB_BADGE:-off}
    depends_on:
      api: { condition: service_healthy }
    volumes:
      - caddy-data:/data
      - caddy-config:/config
    networks: [edge, app]

  cloudflared:
    image: cloudflare/cloudflared:2026.9.1@sha256:b269e8abd07a5bf6f3f4be65d5050b2174eca89c56a0241a8ff32a16aec454e4
    restart: unless-stopped
    read_only: true
    security_opt: ["no-new-privileges:true"]
    cap_drop: [ALL]
    logging: *logging
    profiles: ["tunnel"]
    command: ["tunnel", "--no-autoupdate", "run"]
    environment:
      TUNNEL_TOKEN: ${TUNNEL_TOKEN}
    networks: [edge]
    depends_on:
      - caddy

# cloudflared reaches only Caddy, Caddy reaches only the API, and the API alone reaches the data services.
networks:
  edge:
  app:
  data:

volumes:
  # PostgreSQL 18. The earlier pgdata volume (PostgreSQL 16) stays until scripts/pg-major-upgrade.mjs has
  # moved it and you remove it by hand.
  pgdata18:
  valkeydata:
  # Uploads wait here for the worker and are deleted once processed. Nothing in it needs a backup.
  media-uploads:
  # The images korbat serves. Back it up together with the database.
  media-store:
  # Caddy's state, owned by its own user; the earlier root-owned caddydata and caddyconfig volumes can go.
  caddy-data:
  caddy-config:
```

### Replace `packages/contracts/src/auth.ts` (whole file)

```ts
import { z } from "zod";
import { FORBIDDEN_FORMAT } from "./text";

/** Every code the auth endpoints can put in ErrorEnvelope.error.code. */
export const AuthErrorCode = z.enum([
  "invalid_code",
  "code_expired",
  "too_many_attempts",
  "invalid_credentials",
  "mfa_required",
  "invalid_mfa_code",
  "reauth_required",
  "csrf_failed",
  "turnstile_failed",
  "disposable_email",
  "age_requirement",
  "terms_required",
  "handle_taken",
  "handle_invalid",
  "handle_reserved",
  "password_too_short",
  "password_too_long",
  "password_breached",
  "password_check_unavailable",
  "staff_mfa_required",
  "onboarding_required",
  "mail_unavailable",
  "rate_limited",
  "handle_cooldown",
  "email_in_use",
  "phone_in_use",
  "badge_unavailable",
  "verify_unavailable",
  // Passkeys (1c design, sections 8 and 9).
  "passkey_invalid",
  "passkey_unsupported",
  "passkey_limit",
  "passkey_suspended",
  "passkey_not_found",
  "challenge_expired",
]);
export type AuthErrorCode = z.infer<typeof AuthErrorCode>;

export const Platform = z.enum(["web", "ios", "android"]);
export type Platform = z.infer<typeof Platform>;

export const Role = z.enum(["user", "moderator", "admin"]);
export type Role = z.infer<typeof Role>;

/** Random id created once per app install. The server stores only a keyed hash of it. */
export const DeviceId = z.string().regex(/^[A-Za-z0-9_-]{22,64}$/);
/** 32 random bytes as base64url without padding: flow ids, MFA tickets, single-use link tokens. */
export const OpaqueId = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const Email = z.string().trim().toLowerCase().max(254).pipe(z.email());
export const EmailCode = z.string().regex(/^\d{6}$/);
export const TotpCode = z.string().regex(/^\d{6}$/);
/**
 * A phone number in E.164 once the spaces, hyphens and parentheses people type are dropped: a plus and
 * 7 to 15 digits, the first not zero. Whether the number exists is the verification provider's call.
 */
export const Phone = z
  .string()
  .trim()
  .max(64)
  .transform((raw) => raw.replace(/[\s()-]/g, ""))
  .pipe(z.string().regex(/^\+[1-9][0-9]{6,14}$/, "phone numbers are written like +447911123456"));
/** The six-digit code the verification provider texts to a phone; the development provider's is 000000. */
export const PhoneCode = z.string().regex(/^\d{6}$/);
export const RecoveryCode = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z2-7]{4}-[a-z2-7]{4}-[a-z2-7]{4}$/);
/** Handle rules (3-20 of a-z, 0-9, _; reserved names) are enforced by the flow so it can return a specific error code. */
export const HandleInput = z.string().trim().toLowerCase().min(1).max(64);
export const DisplayName = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .regex(/^[^\p{Cc}]+$/u)
  .refine((name) => !FORBIDDEN_FORMAT.test(name), { message: "invisible direction and spacing characters are not allowed" });
export const TurnstileToken = z.string().min(1).max(2048);
/** Length rules (12-128) are enforced by the flow so it can return password_too_short or password_too_long. */
export const PasswordInput = z.string().min(1).max(1024);

/**
 * A new bearer token after the server rotated the session. Present only for native clients; web
 * clients receive fresh cookies instead.
 */
export const RotatedToken = z.string().optional();

// ---------------------------------------------------------------- email entry and sign-up

export const EmailStartRequest = z.object({
  email: Email,
  turnstileToken: TurnstileToken,
  deviceId: DeviceId,
  platform: Platform,
});
export type EmailStartRequest = z.infer<typeof EmailStartRequest>;

export const FlowResponse = z.object({ flowId: OpaqueId });
export type FlowResponse = z.infer<typeof FlowResponse>;

export const EmailVerifyRequest = z.object({ flowId: OpaqueId, code: EmailCode });
export type EmailVerifyRequest = z.infer<typeof EmailVerifyRequest>;

/** A session was issued. Native clients get the bearer token in the body; web clients only get cookies. */
export const SessionResult = z.object({
  result: z.literal("session"),
  mustReenrollMfa: z.boolean(),
  token: z.string().optional(),
});
export const MfaRequiredResult = z.object({ result: z.literal("mfa_required"), mfaTicket: OpaqueId });
export const SignupRequiredResult = z.object({ result: z.literal("signup_required") });

export const EmailVerifyResponse = z.discriminatedUnion("result", [SessionResult, MfaRequiredResult, SignupRequiredResult]);
export type EmailVerifyResponse = z.infer<typeof EmailVerifyResponse>;

export const SignInResponse = z.discriminatedUnion("result", [SessionResult, MfaRequiredResult]);
export type SignInResponse = z.infer<typeof SignInResponse>;

export const SignupCompleteRequest = z.object({
  flowId: OpaqueId,
  dateOfBirth: z.iso.date(),
  termsVersion: z.string().min(1).max(64),
});
export type SignupCompleteRequest = z.infer<typeof SignupCompleteRequest>;

export const Profile = z.object({ id: z.uuid(), handle: z.string(), displayName: z.string() });
export type Profile = z.infer<typeof Profile>;

export const OnboardingHandleRequest = z.object({ handle: HandleInput, displayName: DisplayName });
export type OnboardingHandleRequest = z.infer<typeof OnboardingHandleRequest>;

export const OnboardingHandleResponse = z.object({ profile: Profile, token: RotatedToken });
export type OnboardingHandleResponse = z.infer<typeof OnboardingHandleResponse>;

// ---------------------------------------------------------------- password

export const PasswordSigninRequest = z.object({
  email: Email,
  password: PasswordInput,
  turnstileToken: TurnstileToken,
  deviceId: DeviceId,
  platform: Platform,
});
export type PasswordSigninRequest = z.infer<typeof PasswordSigninRequest>;

export const PasswordSetRequest = z.object({ password: PasswordInput });
export type PasswordSetRequest = z.infer<typeof PasswordSetRequest>;

export const PasswordSetResponse = z.object({ token: RotatedToken });
export type PasswordSetResponse = z.infer<typeof PasswordSetResponse>;

// ---------------------------------------------------------------- MFA

export const TotpSetupResponse = z.object({
  otpauthUri: z.string().startsWith("otpauth://totp/"),
  qrSvg: z.string().startsWith("<svg"),
});
export type TotpSetupResponse = z.infer<typeof TotpSetupResponse>;

export const TotpCodeRequest = z.object({ code: TotpCode });
export type TotpCodeRequest = z.infer<typeof TotpCodeRequest>;

export const RecoveryCodesResponse = z.object({ recoveryCodes: z.array(RecoveryCode).length(10) });
export type RecoveryCodesResponse = z.infer<typeof RecoveryCodesResponse>;

export const TotpConfirmResponse = z.object({ recoveryCodes: z.array(RecoveryCode).length(10), token: RotatedToken });
export type TotpConfirmResponse = z.infer<typeof TotpConfirmResponse>;

/** Exactly one of `code` or `recoveryCode`. */
export const MfaVerifyRequest = z.union([
  z.strictObject({ mfaTicket: OpaqueId, code: TotpCode }),
  z.strictObject({ mfaTicket: OpaqueId, recoveryCode: RecoveryCode }),
]);
export type MfaVerifyRequest = z.infer<typeof MfaVerifyRequest>;

// ---------------------------------------------------------------- re-authentication

export const ReauthRequest = z.discriminatedUnion("method", [
  z.object({ method: z.literal("password"), password: PasswordInput }),
  z.object({ method: z.literal("totp"), code: TotpCode }),
  z.object({ method: z.literal("email"), flowId: OpaqueId, code: EmailCode }),
]);
export type ReauthRequest = z.infer<typeof ReauthRequest>;

// ---------------------------------------------------------------- sessions and account

export const SessionInfo = z.object({
  id: z.string().regex(/^[0-9a-f]{64}$/),
  deviceLabel: z.string(),
  platform: Platform,
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
  current: z.boolean(),
});
export type SessionInfo = z.infer<typeof SessionInfo>;

export const SessionsResponse = z.object({ sessions: z.array(SessionInfo) });
export type SessionsResponse = z.infer<typeof SessionsResponse>;

export const NotMeRequest = z.object({ token: OpaqueId });
export type NotMeRequest = z.infer<typeof NotMeRequest>;

/**
 * The signed-in account's own profile as /me returns it (the profile-editing routes answer the public ProfileView): the public facts
 * plus when the handle last changed (the app shows when the next change is allowed) and whether the
 * verified badge is held.
 */
export const MeProfile = Profile.extend({ handleChangedAt: z.iso.datetime().nullable(), verified: z.boolean() });
export type MeProfile = z.infer<typeof MeProfile>;

export const MeResponse = z.object({
  user: z.object({
    id: z.uuid(),
    email: z.email(),
    role: Role,
    onboarded: z.boolean(),
    mfaEnabled: z.boolean(),
    hasPassword: z.boolean(),
  }),
  profile: MeProfile.nullable(),
});
export type MeResponse = z.infer<typeof MeResponse>;

// ---------------------------------------------------------------- email change

/** The new address, under the sign-up rules. The flow refuses the current address and disposable ones. */
export const EmailChangeStartRequest = z.object({ email: Email });
export type EmailChangeStartRequest = z.infer<typeof EmailChangeStartRequest>;

export const EmailChangeVerifyRequest = z.object({ flowId: OpaqueId, code: EmailCode });
export type EmailChangeVerifyRequest = z.infer<typeof EmailChangeVerifyRequest>;

/** The address the account now has. */
export const EmailChangeResponse = z.object({ email: z.email() });
export type EmailChangeResponse = z.infer<typeof EmailChangeResponse>;

/**
 * The token from the link the email_changed notice sends to the old address. It is the only credential
 * the undo needs, since a passwordless account cannot sign in at the old address any more.
 */
export const EmailRevertRequest = z.object({ token: OpaqueId });
export type EmailRevertRequest = z.infer<typeof EmailRevertRequest>;

// ---------------------------------------------------------------- verified badge

export const BadgeStartRequest = z.object({ phone: Phone });
export type BadgeStartRequest = z.infer<typeof BadgeStartRequest>;

export const BadgeVerifyRequest = z.object({ flowId: OpaqueId, code: PhoneCode });
export type BadgeVerifyRequest = z.infer<typeof BadgeVerifyRequest>;

export const BadgeVerifyResponse = z.object({ verified: z.literal(true) });
export type BadgeVerifyResponse = z.infer<typeof BadgeVerifyResponse>;

// ---------------------------------------------------------------- account deletion

export const DeleteStartResponse = z.object({ flowId: OpaqueId });
export type DeleteStartResponse = z.infer<typeof DeleteStartResponse>;

/** The emailed code and the account's handle typed by the owner; the flow compares the handle case-insensitively. */
export const DeleteConfirmRequest = z.object({ flowId: OpaqueId, code: EmailCode, handle: HandleInput });
export type DeleteConfirmRequest = z.infer<typeof DeleteConfirmRequest>;
```

### Replace `packages/contracts/src/index.ts` (whole file)

```ts
import { z } from "zod";

/** Every non-2xx response from the API has this shape. */
export const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

export const CheckState = z.enum(["ok", "fail"]);

export const HealthResponse = z.object({
  status: z.enum(["ok", "degraded"]),
  version: z.string(),
  checks: z.record(z.string(), CheckState),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

/** Keyset pagination query params shared by every list endpoint. */
export const Pagination = z.object({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type Pagination = z.infer<typeof Pagination>;

export * from "./account";
export * from "./auth";
export * from "./media";
export * from "./passkeys";
export * from "./social";
export * from "./text";
```

### Replace `packages/db/migrations/meta/_journal.json` (whole file)

```json
{
  "version": "7",
  "dialect": "postgresql",
  "entries": [
    {
      "idx": 0,
      "version": "7",
      "when": 1789374373025,
      "tag": "0000_parallel_umar",
      "breakpoints": true
    },
    {
      "idx": 1,
      "version": "7",
      "when": 1789374374757,
      "tag": "0001_grants",
      "breakpoints": true
    },
    {
      "idx": 2,
      "version": "7",
      "when": 1789388768464,
      "tag": "0002_aspiring_prism",
      "breakpoints": true
    },
    {
      "idx": 3,
      "version": "7",
      "when": 1789388790249,
      "tag": "0003_auth_events_grants",
      "breakpoints": true
    },
    {
      "idx": 4,
      "version": "7",
      "when": 1789639555282,
      "tag": "0004_young_bloodscream",
      "breakpoints": true
    },
    {
      "idx": 5,
      "version": "7",
      "when": 1789976535081,
      "tag": "0005_huge_scarlet_spider",
      "breakpoints": true
    },
    {
      "idx": 6,
      "version": "7",
      "when": 1789976685374,
      "tag": "0006_nifty_blue_shield",
      "breakpoints": true
    },
    {
      "idx": 7,
      "version": "7",
      "when": 1790237989056,
      "tag": "0007_auth_purge_events",
      "breakpoints": true
    },
    {
      "idx": 8,
      "version": "7",
      "when": 1790238603639,
      "tag": "0008_careless_shadowcat",
      "breakpoints": true
    },
    {
      "idx": 9,
      "version": "7",
      "when": 1790241720737,
      "tag": "0009_clever_ezekiel",
      "breakpoints": true
    },
    {
      "idx": 10,
      "version": "7",
      "when": 1790332470171,
      "tag": "0010_free_thunderbolt",
      "breakpoints": true
    }
  ]
}
```

### Replace `packages/db/src/schema/auth.ts` (whole file)

```ts
import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, index, integer, jsonb, pgPolicy, pgSchema, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { authRole, bytea, emptyTextArray, fullAccess, ts } from "./helpers";

export const auth = pgSchema("auth");

export const emailCodePurpose = auth.enum("email_code_purpose", ["signup", "login", "change_email", "recovery", "reauth", "delete_account"]);

export const userRole = auth.enum("user_role", ["user", "moderator", "admin"]);

export const authEventType = auth.enum("auth_event_type", [
  "signup",
  "signin_success",
  "signin_failure",
  "mfa_enabled",
  "mfa_disabled",
  "recovery_code_used",
  "recovery_codes_regenerated",
  "password_set",
  "password_changed",
  "session_revoked",
  "sessions_revoked_all",
  "account_locked",
  "new_device",
  "not_me",
  "profile_updated",
  "handle_changed",
  "email_changed",
  "badge_verified",
  "badge_removed",
  "export_created",
  "account_deleted",
  "passkey_added",
  "passkey_removed",
  "passkey_counter_regression",
]);

export const users = auth.table(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    emailVerifiedAt: ts("email_verified_at"),
    /** Salted hash; the raw phone number is discarded after OTP verification. */
    phoneHash: text("phone_hash"),
    /** argon2id encoded string, null for passkey-only accounts. */
    passwordHash: text("password_hash"),
    /** Encrypted with the server-side key; never stored in clear. */
    totpSecretEnc: text("totp_secret_enc"),
    totpEnabledAt: ts("totp_enabled_at"),
    recoveryCodesHash: text("recovery_codes_hash").array().notNull().default(emptyTextArray),
    failedLogins: integer("failed_logins").notNull().default(0),
    lockedUntil: ts("locked_until"),
    createdAt: ts("created_at").notNull().defaultNow(),
    deletedAt: ts("deleted_at"),
    role: userRole("role").notNull().default("user"),
    /** When the 16+ check passed. Date of birth itself is never stored. */
    ageConfirmedAt: ts("age_confirmed_at"),
    termsVersion: text("terms_version"),
    termsAcceptedAt: ts("terms_accepted_at"),
    /** Set once the public profile (handle) exists. */
    onboardedAt: ts("onboarded_at"),
    passwordChangedAt: ts("password_changed_at"),
    /** Last accepted TOTP time step; a code for this step or earlier is rejected (replay protection). */
    totpLastStep: bigint("totp_last_step", { mode: "number" }),
    /**
     * When the purge after deletion finished anonymising this row. deleted_at means the owner confirmed
     * deletion and the account is gone for every purpose; purged_at null with deleted_at set means the purge
     * job still has work to do.
     */
    purgedAt: ts("purged_at"),
    /**
     * The WebAuthn user handle: 32 random bytes that every passkey of the account carries and a discoverable passkey
     * returns at sign-in. Never the account id, so a password manager's records say nothing about the account. Null
     * until the first passkey is added; the passkey flows set it once with a compare-and-set, and the account's
     * deletion clears it (1c design, sections 6 and 7.7).
     */
    webauthnUserId: bytea("webauthn_user_id"),
  },
  (t) => [
    uniqueIndex("users_email_lower_idx").on(sql`lower(${t.email})`),
    /** One phone number per account, as a database fact; accounts without a number stay out of the index. */
    uniqueIndex("users_phone_hash_idx").on(t.phoneHash).where(sql`phone_hash is not null`),
    /** A user handle names one account; accounts without passkeys stay out of the index. */
    uniqueIndex("users_webauthn_user_id_idx").on(t.webauthnUserId).where(sql`webauthn_user_id is not null`),
    fullAccess("users_auth_all", authRole),
  ],
).enableRLS();

export const devices = auth.table(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    deviceHash: text("device_hash").notNull(),
    label: text("label"),
    /** 'web' | 'ios' | 'android' */
    platform: text("platform").notNull(),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    /** Salted hash; purged by the 30-day job. Raw IPs are never stored. */
    ipHash: text("ip_hash"),
    revokedAt: ts("revoked_at"),
  },
  (t) => [index("devices_user_idx").on(t.userId), index("devices_ip_hash_idx").on(t.ipHash), fullAccess("devices_auth_all", authRole)],
).enableRLS();

export const sessions = auth.table(
  "sessions",
  {
    /** sha256 hex of the opaque token handed to the client. The token itself is never stored. */
    id: text("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    /** Sliding expiry, extended on use. */
    expiresAt: ts("expires_at").notNull(),
    /** Hard cap, never extended. */
    absoluteExpiresAt: ts("absolute_expires_at").notNull(),
    lastUsedAt: ts("last_used_at").notNull().defaultNow(),
    revokedAt: ts("revoked_at"),
    /** Last time the user proved possession of a credential on this session: the latest of `factors`. */
    reauthAt: ts("reauth_at").notNull().defaultNow(),
    /**
     * A random id the session keeps for its whole life, while the token and with it `id` rotate. The re-authentication
     * limits and the passkey challenges are keyed by it, so a rotation cannot reset them and no other session can
     * spend them.
     */
    handle: uuid("handle").notNull().defaultRandom(),
    /**
     * The factors this session has proven and when: kind (email, password, totp, recovery, passkey, passkey_uv) to
     * epoch milliseconds. Sessions from before migration 0010 have none and re-authenticate before a sensitive action.
     */
    factors: jsonb("factors").$type<Record<string, number>>().notNull().default(sql`'{}'::jsonb`),
    /** The passkey that started this session, for the lockdown and the Security list; it outlives the passkey. */
    passkeyId: uuid("passkey_id").references(() => passkeys.id, { onDelete: "set null" }),
  },
  (t) => [index("sessions_user_idx").on(t.userId), uniqueIndex("sessions_handle_idx").on(t.handle), fullAccess("sessions_auth_all", authRole)],
).enableRLS();

export const emailCodes = auth.table(
  "email_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    purpose: emailCodePurpose("purpose").notNull(),
    expiresAt: ts("expires_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
    consumedAt: ts("consumed_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    /** Random id returned to the client; a code can only complete the flow that requested it. */
    flowId: text("flow_id").notNull(),
    ipHash: text("ip_hash"),
  },
  (t) => [
    index("email_codes_email_idx").on(t.email),
    uniqueIndex("email_codes_flow_idx").on(t.flowId),
    fullAccess("email_codes_auth_all", authRole),
  ],
).enableRLS();

export const passkeys = auth.table(
  "passkeys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    credentialId: text("credential_id").notNull(),
    /** base64url COSE public key */
    publicKey: text("public_key").notNull(),
    counter: bigint("counter", { mode: "number" }).notNull().default(0),
    transports: text("transports").array().notNull().default(emptyTextArray),
    backedUp: boolean("backed_up").notNull().default(false),
    name: text("name").notNull(),
    /** Written from the flows' clock, like password_changed_at, because the lockdown compares it with flow times. */
    createdAt: ts("created_at").notNull().defaultNow(),
    lastUsedAt: ts("last_used_at"),
    /** The authenticator model the registration reported (all zeros for most synced passkeys); null when none was given. */
    aaguid: uuid("aaguid"),
    /** The BE flag at registration: the key may be synced to other devices. backed_up is the BS flag, which can change. */
    backupEligible: boolean("backup_eligible").notNull().default(false),
    /** The registration verified the user (UV flag); only then does a verified sign-in with it count as two factors. */
    uvInitialized: boolean("uv_initialized").notNull().default(false),
    /** The device whose session added it, for the Security list; it outlives the device. */
    createdDeviceId: uuid("created_device_id").references(() => devices.id, { onDelete: "set null" }),
    /** When a sign-in showed a signature counter that went backwards (a copy of the key may exist); refused from then on. */
    suspectAt: ts("suspect_at"),
  },
  (t) => [uniqueIndex("passkeys_credential_idx").on(t.credentialId), index("passkeys_user_idx").on(t.userId), fullAccess("passkeys_auth_all", authRole)],
).enableRLS();

/** Append-only security log. UPDATE, DELETE and TRUNCATE are also revoked at the grant level (migration 0003). */
export const authEvents = auth.table(
  "auth_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    type: authEventType("type").notNull(),
    deviceId: uuid("device_id"),
    ipHash: text("ip_hash"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("auth_events_user_created_idx").on(t.userId, t.createdAt),
    pgPolicy("auth_events_auth_insert", { for: "insert", to: authRole, withCheck: sql`true` }),
    pgPolicy("auth_events_auth_select", { for: "select", to: authRole, using: sql`true` }),
  ],
).enableRLS();
```

### Replace `packages/db/src/schema/helpers.ts` (whole file)

```ts
import { sql } from "drizzle-orm";
import { customType, pgPolicy, pgRole, timestamp, type PgRole } from "drizzle-orm/pg-core";

/** Roles are created by infra/postgres/init/01-roles.sh, not by migrations. */
export const apiRole = pgRole("korbat_api").existing();
export const authRole = pgRole("korbat_auth").existing();

export const ts = (name: string) => timestamp(name, { withTimezone: true });

/**
 * Raw bytes, which drizzle's pg-core has no column for. postgres.js sends a Buffer as bytea and parses bytea back into
 * a Buffer; a driver that answers a plain Uint8Array is given a Buffer view of the same memory, so readers can rely on
 * Buffer's methods (equals, toString("base64url")).
 */
export const bytea = customType<{ data: Buffer; driverData: Uint8Array }>({
  dataType() {
    return "bytea";
  },
  toDriver(value) {
    return value;
  },
  fromDriver(value) {
    return Buffer.isBuffer(value) ? value : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  },
});

/**
 * Foundation policy: the given role may touch every row of the table.
 * Sub-projects replace this per table with owner-scoped policies as the
 * routes that need them are built. RLS being ON from day one means adding a
 * tighter policy later is a migration, not a redesign.
 */
export function fullAccess(name: string, role: PgRole) {
  return pgPolicy(name, { for: "all", to: role, using: sql`true`, withCheck: sql`true` });
}

export const emptyTextArray = sql`'{}'::text[]`;
```

## Step 4: verify: install

```bash
pnpm install --config.package-import-method=copy
```

Expected output contains:

- `Done in`

Must not contain:

- `ERR_PNPM`

Observed on the dry run:

```text
Done in 4.3s using pnpm v10.30.0
```

## Step 5: verify: lockfile-age

```bash
node scripts/check-lockfile-age.mjs --base HEAD
```

Expected output contains:

- `all at least 7 days old`

Observed on the dry run:

```text
25 new package versions since HEAD; all at least 7 days old
```

## Step 6: verify: typecheck

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

## Step 7: verify: test

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
apps/api test:       Tests  297 passed | 205 skipped (502)
```

## Step 8: verify: generate

```bash
pnpm --filter @korbat/db generate
```

Expected output contains:

- `No schema changes`

Observed on the dry run:

```text
No schema changes, nothing to migrate 😴
```

## Step 9: verify: apply-migrations

```bash
(cd apps/api && set -a && . ./.env && set +a && node --import tsx src/migrate.ts | sed -E 's#from .*#from packages/db/migrations#') && echo count=$(docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T postgres psql -U postgres -d korbat -tAc 'select count(*) from drizzle.__drizzle_migrations')
```

Expected output contains:

- `migrations applied`
- `count=11`

Observed on the dry run:

```text
migrations applied from packages/db/migrations
count=11
```

## Step 10: verify: test-database

```bash
node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `migrations applied`
- `test database ready: korbat_test`

Observed on the dry run:

```text
migrations applied
test database ready: korbat_test
```

## Step 11: verify: integration

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

## Step 12: verify: api-bundle

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

## Step 13: verify: frozen-install

```bash
pnpm install --frozen-lockfile
```

Expected output contains:

- `Done in`

Must not contain:

- `ERR_PNPM`

Observed on the dry run:

```text
Done in 4s using pnpm v10.30.0
```

## Step 14: verify: compose-config

```bash
docker compose --env-file infra/.env.example -f infra/compose.yml config -q && echo config-ok
```

Expected output contains:

- `config-ok`

Observed on the dry run:

```text
config-ok
```

## Step 15: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/.env.example`
- `apps/api/package.json`
- `apps/api/src/auth/context.ts`
- `apps/api/src/config.ts`
- `apps/api/src/mail/mailer.ts`
- `apps/api/src/mail/templates.ts`
- `apps/api/test/auth/flow-harness.ts`
- `apps/api/test/auth/messages.test.ts`
- `apps/api/test/config.test.ts`
- `apps/api/test/integration/flow-harness.ts`
- `apps/api/test/integration/passkeys-schema.test.ts`
- `apps/api/test/mail/templates.test.ts`
- `apps/app/package.json`
- `infra/.env.example`
- `infra/compose.yml`
- `packages/contracts/src/auth.ts`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/passkeys.ts`
- `packages/contracts/test/auth.test.ts`
- `packages/contracts/test/passkeys.test.ts`
- `packages/db/migrations/0010_<two random words>.sql`
- `packages/db/migrations/meta/0010_snapshot.json`
- `packages/db/migrations/meta/_journal.json`
- `packages/db/src/schema/auth.ts`
- `packages/db/src/schema/helpers.ts`
- `packages/db/test/schema.test.ts`
- `pnpm-lock.yaml`

Allowed difference: drizzle-kit names each generated migration with its number and two random words, so that file's name differs from the dry run. Any name of that shape is correct; do not rename it.

## Step 16: commit

```bash
git add -A
git commit -q -m "feat(contracts,db,api): the ground for passkeys: @simplewebauthn/server 14.0.2 and @simplewebauthn/browser 14.0.0 installed under the release-age floor; passkey contracts and error codes; migration 0010 with the WebAuthn user handle, the passkey flags and provenance, the session handle, factors and passkey id, and three event types; WEBAUTHN_RP_ID and WEBAUTHN_RP_NAME with production guards; the passkey_added, passkey_removed and passkey_suspect mails" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(contracts,db,api): the ground for passkeys: @simplewebauthn/server 14.0.2 and @simplewebauthn/browser 14.0.0 installed under the release-age floor; passkey contracts and error codes; migration 0010 with the WebAuthn user handle, the passkey flags and provenance, the session handle, factors and passkey id, and three event types; WEBAUTHN_RP_ID and WEBAUTHN_RP_NAME with production guards; the passkey_added, passkey_removed and passkey_suspect mails`.

## Report format (mandatory)

```text
TASK 1 REPORT
Files written: <count, expected 26>
Failing-test step (the error line): <paste>
Verify "install": <paste the expected lines as printed>
Verify "lockfile-age": <paste the expected lines as printed>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "generate": <paste the expected lines as printed>
Verify "apply-migrations": <paste the expected lines as printed>
Verify "test-database": <paste the expected lines as printed>
Verify "integration": <paste the expected lines as printed>
Verify "api-bundle": <paste the expected lines as printed>
Verify "frozen-install": <paste the expected lines as printed>
Verify "compose-config": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
