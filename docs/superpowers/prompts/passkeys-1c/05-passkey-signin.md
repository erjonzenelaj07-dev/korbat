# korbat passkeys (1c) — Task 5 of 9: Passkey sign-in and re-authentication: sign-in options without a session and verify with the challenge spent before the library runs, the user handle checked, the counter written in one conditional update (a regression suspends the passkey, records it, mails the owner and refuses), passkey_uv only for a user-verified assertion on a passkey that was registered with user verification, a new-device limit counted after the signature, the MFA ticket when the account has TOTP and the assertion lacked user verification; re-authentication options and the passkey method on Task 3's flow

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-25 to 2026-09-27 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

This task delivers passkey sign-in and passkey re-authentication on the core, the session model and Task 4's repository: sign-in options that need no session and store nothing, sign-in verify that spends the challenge before the library runs, checks the user handle, refuses a suspended passkey only after its signature, writes the counter in one conditional update (a regression suspends the passkey, records it, mails the owner and refuses), grants passkey_uv only for a user-verified assertion on a passkey registered with user verification, counts sign-ins from new devices after the signature, and hands an account with TOTP (or a staff account) to the MFA step when the assertion lacked user verification; and re-authentication options plus the passkey method on Task 3's re-authentication flow.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(api,contracts): passkey registration and management: register options (strong freshness, 10 an hour, the cap of 10 passkeys and the bound of 5 a day with the wait in the refusal, the WebAuthn user handle set once by compare-and-set) and verify (the challenge read and spent before the library runs; one transaction re-checks both bounds under the user row's lock and writes the passkey and its event; the passkey_added mail carries a 7-day one-shot remove link); the list with current, new and suspended tags and the adding device; rename and delete; 'not mine' and the remove link run the lockdown; /api/me counts the passkeys`.

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
python docs/superpowers/prompts/passkeys-1c/write_blocks.py docs/superpowers/prompts/passkeys-1c/05-passkey-signin.md 1
```

Expected: 5 lines starting with `wrote`, one for each file below.

### Create `apps/api/test/auth/passkey-signin.test.ts`

```ts
import { randomBytes } from "node:crypto";
import { describe, expect, test } from "vitest";
import { AuthError } from "../../src/auth/context";
import { encrypt } from "../../src/auth/crypto";
import { verifyMfa } from "../../src/auth/flows/mfa";
import { reauthenticate } from "../../src/auth/flows/reauth";
import { HOUR, MINUTE } from "../../src/auth/limits";
import {
  SIGNIN_NEW_DEVICE_PER_HOUR,
  SIGNIN_OPTIONS_PER_IP,
  SIGNIN_VERIFY_PER_IP,
  reauthOptions,
  reauthenticatePasskey,
  registerOptions,
  registerVerify,
  signInOptions,
  signInVerify,
} from "../../src/auth/passkeys/flows";
import type { Session } from "../../src/auth/sessions";
import { currentStep, hotp, newTotpSecret } from "../../src/auth/totp";
import { memoryFlowHarness, type MemoryFlowHarness } from "./flow-harness";
import { SoftAuthenticator, type SoftFlags } from "./soft-authenticator";

const RP_ID = "localhost";
const ORIGIN = "http://localhost:8081";
const ALL: SoftFlags = { up: true, uv: true, be: true, bs: true };
const BARE: SoftFlags = { up: true, uv: false, be: false, bs: false };

/** The AuthError a flow rejects with; anything else fails the test. */
async function failure(promise: Promise<unknown>): Promise<AuthError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AuthError) return err;
    throw err;
  }
  throw new Error("expected the flow to reject");
}

/** An account with two-factor on now, encrypted with the harness key so the MFA step can verify a real code. */
function withTotp(h: MemoryFlowHarness, userId: string, secret: Uint8Array): void {
  Object.assign(h.users.get(userId)!, {
    totpSecretEnc: encrypt(Buffer.from(secret), h.deps.config.totpKey),
    totpEnabledAt: h.now(),
    totpLastStep: null,
    recoveryCodesHash: [],
  });
}

/** Registers a passkey through the real flow (before any TOTP, so the level-1 session suffices) and answers its credential id. */
async function registerPasskey(h: MemoryFlowHarness, session: Session, auth: SoftAuthenticator, flags: SoftFlags = ALL): Promise<string> {
  const { options } = await registerOptions(h.deps, session, { label: "ada" });
  const response = auth.create({ rpId: options.rp.id!, challenge: options.challenge, origin: ORIGIN, userHandle: Buffer.from(options.user.id, "base64url"), flags });
  await registerVerify(h.deps, session, { response });
  return response.id;
}

/** A whole passkey sign-in: fresh options, the authenticator's answer, and the verification. */
async function passkeySignIn(
  h: MemoryFlowHarness,
  auth: SoftAuthenticator,
  credentialId: string,
  deviceId: string,
  opts: { flags?: SoftFlags; counter?: number; userHandle?: Uint8Array; tamper?: boolean } = {},
) {
  const { options } = await signInOptions(h.deps, h.ctx);
  const response = auth.get({
    credentialId,
    rpId: RP_ID,
    challenge: options.challenge,
    origin: ORIGIN,
    flags: opts.flags ?? ALL,
    counter: opts.counter ?? 0,
    ...(opts.userHandle !== undefined ? { userHandle: opts.userHandle } : {}),
  });
  // A tampered signature stands for any assertion the library will not verify.
  if (opts.tamper) response.response.signature = response.response.signature.slice(0, -4) + (response.response.signature.endsWith("AAAA") ? "BBBB" : "AAAA");
  return signInVerify(h.deps, { deviceId, platform: "web", response }, h.ctx);
}

describe("passkey sign-in options (1c design, section 7.4)", () => {
  test("carry an empty allow list and a sign-in challenge, and store nothing", async () => {
    const h = memoryFlowHarness();
    const { options } = await signInOptions(h.deps, h.ctx);
    expect(options.allowCredentials).toEqual([]);
    expect(options.challenge).toMatch(/^[A-Za-z0-9_-]{78}$/);
    expect(options.rpId).toBe(RP_ID);
    // A second call is a different challenge, and neither wrote a used-challenge marker or anything else.
    const again = await signInOptions(h.deps, h.ctx);
    expect(again.options.challenge).not.toBe(options.challenge);
  });

  test("allows 30 per IP per 15 minutes, then rate_limited with a Retry-After", async () => {
    const h = memoryFlowHarness();
    expect(SIGNIN_OPTIONS_PER_IP).toBe(30);
    for (let i = 0; i < SIGNIN_OPTIONS_PER_IP; i++) await signInOptions(h.deps, h.ctx);
    expect(await failure(signInOptions(h.deps, h.ctx))).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: (15 * MINUTE) / 1000 });
    // Another address has its own allowance.
    expect((await signInOptions(h.deps, { ...h.ctx, ipHash: "other" })).options.challenge).toBeDefined();
  });
});

describe("passkey sign-in verify (1c design, section 7.4)", () => {
  test("a user-verified passkey on an account with TOTP signs in with passkey_uv and level 2, skipping the TOTP step", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, ALL);
    withTotp(h, ada.user.id, newTotpSecret());

    const outcome = await passkeySignIn(h, auth, credentialId, "device-uv");
    expect(outcome.kind).toBe("session");
    if (outcome.kind !== "session") throw new Error("unreachable");
    expect(outcome.issued.session.factors).toEqual({ passkey_uv: h.now().getTime() });
    expect(outcome.issued.session.passkeyId).toBe(h.passkeys[0]!.id);
    expect(h.deps.sessions.level(outcome.issued.session)).toBe(2);
    expect(outcome.issued.session.mfaEnabled).toBe(true);
    // The sign-in is recorded with its method.
    expect(h.events.filter((e) => e.type === "signin_success").at(-1)!.metadata).toEqual({ method: "passkey" });
  });

  test("a passkey without user verification on an account with TOTP gets an MFA ticket, and the TOTP step then holds passkey and totp at level 2", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, BARE);
    const secret = newTotpSecret();
    withTotp(h, ada.user.id, secret);

    // Even a UV assertion is one factor here: the passkey was not registered with user verification.
    const pending = await passkeySignIn(h, auth, credentialId, "device-plain", { flags: ALL });
    expect(pending.kind).toBe("mfa");
    if (pending.kind !== "mfa") throw new Error("unreachable");

    const signed = await verifyMfa(h.deps, { mfaTicket: pending.mfaTicket, code: hotp(secret, currentStep(h.now().getTime())) }, h.ctx);
    expect(Object.keys(signed.issued.session.factors).sort()).toEqual(["passkey", "totp"]);
    expect(signed.issued.session.passkeyId).toBe(h.passkeys[0]!.id);
    expect(h.deps.sessions.level(signed.issued.session)).toBe(2);
    expect(h.events.filter((e) => e.type === "signin_success").at(-1)!.metadata).toEqual({ method: "passkey" });
  });

  test("a staff account with TOTP always goes to the TOTP step, even with a user-verified passkey", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, ALL);
    withTotp(h, ada.user.id, newTotpSecret());
    h.users.get(ada.user.id)!.role = "moderator";
    expect((await passkeySignIn(h, auth, credentialId, "device-staff")).kind).toBe("mfa");
  });

  test("a staff account without TOTP signs in directly, as with an email code", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, ALL);
    h.users.get(ada.user.id)!.role = "admin";
    const outcome = await passkeySignIn(h, auth, credentialId, "device-staff");
    expect(outcome.kind).toBe("session");
  });

  test("an account without TOTP signs in directly; a user-verified passkey is level 2, a plain one level 1", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const uv = new SoftAuthenticator();
    const plain = new SoftAuthenticator();
    const uvId = await registerPasskey(h, ada.session, uv, ALL);
    const plainId = await registerPasskey(h, ada.session, plain, BARE);

    const withUv = await passkeySignIn(h, uv, uvId, "device-a");
    expect(withUv.kind === "session" && h.deps.sessions.level(withUv.issued.session)).toBe(2);
    const withoutUv = await passkeySignIn(h, plain, plainId, "device-b");
    expect(withoutUv.kind === "session" && h.deps.sessions.level(withoutUv.issued.session)).toBe(1);
  });

  test("an unknown credential, a mismatched user handle and a deleted account are all passkey_invalid", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, ALL);

    // A credential korbat never stored: its holder answers, but no row names it.
    const orphan = new SoftAuthenticator();
    const orphanReg = orphan.create({ rpId: RP_ID, challenge: (await signInOptions(h.deps, h.ctx)).options.challenge, origin: ORIGIN, userHandle: randomBytes(32), flags: ALL });
    expect(await failure(passkeySignIn(h, orphan, orphanReg.id, "device-x"))).toMatchObject({ code: "passkey_invalid", status: 401 });

    // The right credential, but a user handle that is not this account's.
    expect(await failure(passkeySignIn(h, auth, credentialId, "device-x", { userHandle: randomBytes(32) }))).toMatchObject({ code: "passkey_invalid", status: 401 });

    // The account is gone.
    await h.deps.repo.markDeleted(ada.user.id, h.now());
    expect(await failure(passkeySignIn(h, auth, credentialId, "device-x"))).toMatchObject({ code: "passkey_invalid", status: 401 });
  });

  test("a challenge answers once: a replayed assertion is passkey_invalid", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, ALL);
    const { options } = await signInOptions(h.deps, h.ctx);
    const response = auth.get({ credentialId, rpId: RP_ID, challenge: options.challenge, origin: ORIGIN, flags: ALL, counter: 0 });
    expect((await signInVerify(h.deps, { deviceId: "device-a", platform: "web", response }, h.ctx)).kind).toBe("session");
    expect(await failure(signInVerify(h.deps, { deviceId: "device-a", platform: "web", response }, h.ctx))).toMatchObject({ code: "passkey_invalid", status: 401 });
  });

  test("allows 20 verifications per IP per 15 minutes, counted before the challenge, then rate_limited", async () => {
    const h = memoryFlowHarness();
    expect(SIGNIN_VERIFY_PER_IP).toBe(20);
    const orphan = new SoftAuthenticator();
    const reg = orphan.create({ rpId: RP_ID, challenge: (await signInOptions(h.deps, h.ctx)).options.challenge, origin: ORIGIN, userHandle: randomBytes(32), flags: ALL });
    // A bogus challenge is refused at the MAC check, before it is spent, so the same response counts each time.
    const bogus = orphan.get({ credentialId: reg.id, rpId: RP_ID, challenge: "not-a-real-challenge", origin: ORIGIN, flags: ALL, counter: 0 });
    for (let i = 0; i < SIGNIN_VERIFY_PER_IP; i++) {
      expect(await failure(signInVerify(h.deps, { deviceId: "device-a", platform: "web", response: bogus }, h.ctx))).toMatchObject({ code: "passkey_invalid" });
    }
    expect(await failure(signInVerify(h.deps, { deviceId: "device-a", platform: "web", response: bogus }, h.ctx))).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: (15 * MINUTE) / 1000 });
  });
});

describe("the passkey counter rule at sign-in (1c design, section 2)", () => {
  test("two zeros pass repeatedly, as a synced passkey always sends", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, ALL);
    for (let i = 0; i < 3; i++) expect((await passkeySignIn(h, auth, credentialId, "device-a", { counter: 0 })).kind).toBe("session");
    expect(h.passkeys[0]!.counter).toBe(0);
    expect(h.passkeys[0]!.suspectAt).toBeNull();
    expect(h.passkeys[0]!.lastUsedAt).toEqual(h.now());
  });

  test("a counter that went backwards after a verified signature suspends the passkey, mails the owner and refuses; a later sign-in is then passkey_suspended, and a bad signature never reveals that", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, ALL);
    // A counter that moves forward is stored.
    expect((await passkeySignIn(h, auth, credentialId, "device-a", { counter: 5 })).kind).toBe("session");
    expect(h.passkeys[0]!.counter).toBe(5);

    // A counter that regresses is caught after the signature: suspect, recorded, mailed and refused.
    expect(await failure(passkeySignIn(h, auth, credentialId, "device-a", { counter: 3 }))).toMatchObject({ code: "passkey_invalid", status: 401 });
    expect(h.passkeys[0]!.suspectAt).toEqual(h.now());
    expect(h.events.filter((e) => e.type === "passkey_counter_regression")).toEqual([{ userId: ada.user.id, type: "passkey_counter_regression", deviceId: null, metadata: { passkeyId: h.passkeys[0]!.id } }]);
    expect(h.mailer.sent.filter((m) => m.template === "passkey_suspect")).toEqual([{ to: "ada@korbat.local", template: "passkey_suspect", data: { name: h.passkeys[0]!.name } }]);

    // From now on a good signature is passkey_suspended, but only after the signature checks.
    expect(await failure(passkeySignIn(h, auth, credentialId, "device-a", { counter: 9 }))).toMatchObject({ code: "passkey_suspended", status: 403 });
    // A response the library will not verify is passkey_invalid, never passkey_suspended: the state is not revealed before the signature.
    expect(await failure(passkeySignIn(h, auth, credentialId, "device-a", { counter: 9, tamper: true }))).toMatchObject({ code: "passkey_invalid", status: 401 });
  });
});

describe("the new-device limit at passkey sign-in (1c design, section 7.4)", () => {
  test("counts only devices the account has not used, only after a verified signature, and refuses beyond five an hour", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, ALL);
    expect(SIGNIN_NEW_DEVICE_PER_HOUR).toBe(5);

    // A failed sign-in from a new device does not count: an unknown credential answered before any device was seen.
    const orphan = new SoftAuthenticator();
    const reg = orphan.create({ rpId: RP_ID, challenge: (await signInOptions(h.deps, h.ctx)).options.challenge, origin: ORIGIN, userHandle: randomBytes(32), flags: ALL });
    await failure(passkeySignIn(h, orphan, reg.id, "new-0"));

    // Five new devices are allowed; the sixth new device is refused.
    for (let i = 0; i < SIGNIN_NEW_DEVICE_PER_HOUR; i++) expect((await passkeySignIn(h, auth, credentialId, `new-${i}`)).kind).toBe("session");
    expect(await failure(passkeySignIn(h, auth, credentialId, "new-6"))).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: HOUR / 1000 });

    // A device the account already used never counts, so it keeps working past the bound.
    for (let i = 0; i < 3; i++) expect((await passkeySignIn(h, auth, credentialId, "new-0")).kind).toBe("session");
  });
});

describe("passkey re-authentication (1c design, section 7.2)", () => {
  test("options list the account's usable passkeys, leaving a suspect one out, with a challenge bound to the session", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const good = new SoftAuthenticator();
    const bad = new SoftAuthenticator();
    await registerPasskey(h, ada.session, good, ALL);
    await registerPasskey(h, ada.session, bad, ALL);
    const suspect = h.passkeys[1]!;
    await h.deps.repo.suspectPasskey(suspect.id, h.now());

    const { options } = await reauthOptions(h.deps, ada.session);
    expect(options.allowCredentials!.map((c) => c.id)).toEqual([h.passkeys[0]!.credentialId]);
    expect(options.challenge).toMatch(/^[A-Za-z0-9_-]{78}$/);
    // A challenge bound to another session's handle would not be usable by this one; it is bound to this session.
    expect(options.rpId).toBe(RP_ID);
  });

  test("a passkey of another account is refused and its counter is left untouched", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const bob = h.user("bob@korbat.local");
    const adaAuth = new SoftAuthenticator();
    const adaCredential = await registerPasskey(h, ada.session, adaAuth, ALL);
    // ada's passkey has a counter on the record.
    await passkeySignIn(h, adaAuth, adaCredential, "device-a", { counter: 7 });
    const before = { ...h.passkeys.find((p) => p.credentialId === adaCredential)! };

    // bob asks for a re-authentication challenge, then answers it with ada's credential.
    const { options } = await reauthOptions(h.deps, bob.session);
    const response = adaAuth.get({ credentialId: adaCredential, rpId: RP_ID, challenge: options.challenge, origin: ORIGIN, flags: ALL, counter: 20 });
    expect(await failure(reauthenticate(h.deps, bob.session, { method: "passkey", response }, h.ctx))).toMatchObject({ code: "passkey_invalid", status: 401 });
    // ada's passkey never moved: the lookup with bob's user never found it.
    const after = h.passkeys.find((p) => p.credentialId === adaCredential)!;
    expect(after.counter).toBe(before.counter);
    expect(after.lastUsedAt).toEqual(before.lastUsedAt);
    expect(after.suspectAt).toBeNull();
  });

  test("a user-verified passkey re-authentication gives level 2 on an account with TOTP, rotating the token in place", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, ALL);
    withTotp(h, ada.user.id, newTotpSecret());

    const { options } = await reauthOptions(h.deps, ada.session);
    const response = auth.get({ credentialId, rpId: RP_ID, challenge: options.challenge, origin: ORIGIN, flags: ALL, counter: 0 });
    const result = await reauthenticate(h.deps, ada.session, { method: "passkey", response }, h.ctx);
    expect(result.level).toBe(2);
    expect(result.mustReenrollMfa).toBe(false);
    // The token rotated in place: same handle, the passkey_uv factor written.
    expect(result.issued.session.handle).toBe(ada.session.handle);
    expect(result.issued.session.factors.passkey_uv).toBe(h.now().getTime());
    expect(h.passkeys[0]!.lastUsedAt).toEqual(h.now());
  });

  test("the passkey helper answers passkey_uv for a verified assertion and passkey without user verification", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const uv = new SoftAuthenticator();
    const plain = new SoftAuthenticator();
    const uvId = await registerPasskey(h, ada.session, uv, ALL);
    const plainId = await registerPasskey(h, ada.session, plain, BARE);

    const optionsA = (await reauthOptions(h.deps, ada.session)).options;
    const uvResponse = uv.get({ credentialId: uvId, rpId: RP_ID, challenge: optionsA.challenge, origin: ORIGIN, flags: ALL, counter: 0 });
    expect(await reauthenticatePasskey(h.deps, ada.session, ada.user, uvResponse, h.now())).toBe("passkey_uv");

    const optionsB = (await reauthOptions(h.deps, ada.session)).options;
    const plainResponse = plain.get({ credentialId: plainId, rpId: RP_ID, challenge: optionsB.challenge, origin: ORIGIN, flags: ALL, counter: 0 });
    expect(await reauthenticatePasskey(h.deps, ada.session, ada.user, plainResponse, h.now())).toBe("passkey");
  });
});
```

### Create `apps/api/test/integration/auth-passkey-signin.test.ts`

```ts
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { authEvents, closeDb, createDb, passkeys, type Db } from "@korbat/db";
import { AuthError } from "../../src/auth/context";
import { encrypt, randomToken } from "../../src/auth/crypto";
import { notMe } from "../../src/auth/flows/not-me";
import { reauthenticate } from "../../src/auth/flows/reauth";
import { notMeKey } from "../../src/auth/flows/signin";
import { reauthOptions, registerOptions, registerVerify, signInOptions, signInVerify } from "../../src/auth/passkeys/flows";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import type { Session } from "../../src/auth/sessions";
import { currentStep, hotp, newTotpSecret } from "../../src/auth/totp";
import { loadConfig } from "../../src/config";
import { SoftAuthenticator, type SoftFlags } from "../auth/soft-authenticator";
import { flowHarness, onboardedUser, type FlowHarness } from "./flow-harness";

const ORIGIN = "http://localhost:8081";
const RP_ID = "localhost";
const PASSWORD = "correct horse battery staple";
const ALL: SoftFlags = { up: true, uv: true, be: true, bs: true };
const BARE: SoftFlags = { up: true, uv: false, be: false, bs: false };

/** The AuthError a flow rejects with; anything else fails the test. */
async function failure(promise: Promise<unknown>): Promise<AuthError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AuthError) return err;
    throw err;
  }
  throw new Error("expected the flow to reject");
}

/**
 * Passkey sign-in and re-authentication against the real repository (1c design, sections 7.2 and 7.4), with the software
 * authenticator: the session model, the counter write's conditional update, and the new-device alert's not-me link naming
 * the passkey that signed in.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: passkey sign-in and re-authentication", () => {
  let db: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_AUTH, { max: 4 });
    repo = createAuthRepo(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });

  /** Registers a passkey through Task 4's flow (before any TOTP, so the level-1 session suffices) and answers its credential id. */
  async function register(h: FlowHarness, session: Session, auth: SoftAuthenticator, flags: SoftFlags = ALL): Promise<string> {
    const { options } = await registerOptions(h.deps, session, { label: "ada" });
    const response = auth.create({ rpId: options.rp.id!, challenge: options.challenge, origin: ORIGIN, userHandle: Buffer.from(options.user.id, "base64url"), flags });
    await registerVerify(h.deps, session, { response });
    return response.id;
  }

  /** A whole passkey sign-in against the real repository: fresh options, the authenticator's answer, and the verification. */
  async function passkeySignIn(h: FlowHarness, auth: SoftAuthenticator, credentialId: string, deviceId: string, opts: { flags?: SoftFlags; counter?: number } = {}) {
    const { options } = await signInOptions(h.deps, h.ctx);
    const response = auth.get({ credentialId, rpId: RP_ID, challenge: options.challenge, origin: ORIGIN, flags: opts.flags ?? ALL, counter: opts.counter ?? 0 });
    return signInVerify(h.deps, { deviceId, platform: "web", response }, h.ctx);
  }

  async function withTotp(h: FlowHarness, userId: string): Promise<Uint8Array> {
    const secret = newTotpSecret();
    await repo.enableTotp(userId, { secretEnc: encrypt(Buffer.from(secret), h.deps.config.totpKey), recoveryCodesHash: [], now: h.clock.now() });
    await h.deps.sessions.forgetUser(userId);
    return secret;
  }

  const passkeyRow = async (credentialId: string) => (await db.select().from(passkeys).where(eq(passkeys.credentialId, credentialId)))[0]!;

  test("register, sign out, sign in with the passkey, then re-authenticate with it", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const auth = new SoftAuthenticator();
    const credentialId = await register(h, account.session, auth);
    // Sign out the registration session; the passkey signs in without it.
    await h.deps.sessions.revoke(account.session.sessionId, account.user.id);
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();

    const outcome = await passkeySignIn(h, auth, credentialId, randomToken(), { counter: 1 });
    expect(outcome.kind).toBe("session");
    if (outcome.kind !== "session") throw new Error("unreachable");
    const signedIn = (await h.deps.sessions.resolve(outcome.issued.token))!.session;
    // A user-verified passkey on a TOTP-less account is two factors in one gesture.
    expect(signedIn.factors.passkey_uv).toBeDefined();
    expect(h.deps.sessions.level(signedIn)).toBe(2);
    expect(signedIn.passkeyId).toBe((await passkeyRow(credentialId)).id);
    expect((await passkeyRow(credentialId)).counter).toBe(1);

    // Re-authenticate with the same passkey: the options list it, the assertion answers, level 2 and the token rotates.
    const { options } = await reauthOptions(h.deps, signedIn);
    expect(options.allowCredentials!.map((c) => c.id)).toContain(credentialId);
    const response = auth.get({ credentialId, rpId: RP_ID, challenge: options.challenge, origin: ORIGIN, flags: ALL, counter: 2 });
    const reauthed = await reauthenticate(h.deps, signedIn, { method: "passkey", response }, h.ctx);
    expect(reauthed.level).toBe(2);
    expect(reauthed.issued.session.handle).toBe(signedIn.handle);
    expect(await h.deps.sessions.resolve(outcome.issued.token)).toBeNull();
    expect((await passkeyRow(credentialId)).counter).toBe(2);
  });

  test("on an account with TOTP a user-verified passkey skips the step, a plain one does not", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const uv = new SoftAuthenticator();
    const plain = new SoftAuthenticator();
    const uvId = await register(h, account.session, uv, ALL);
    const plainId = await register(h, account.session, plain, BARE);
    const secret = await withTotp(h, account.user.id);

    // The user-verified passkey signs in outright at level 2.
    const skipped = await passkeySignIn(h, uv, uvId, randomToken());
    expect(skipped.kind).toBe("session");
    if (skipped.kind !== "session") throw new Error("unreachable");
    expect(h.deps.sessions.level((await h.deps.sessions.resolve(skipped.issued.token))!.session)).toBe(2);

    // The plain passkey stops at the TOTP step; the code then completes the sign-in.
    const pending = await passkeySignIn(h, plain, plainId, randomToken());
    expect(pending.kind).toBe("mfa");
    if (pending.kind !== "mfa") throw new Error("unreachable");
    const { verifyMfa } = await import("../../src/auth/flows/mfa");
    const signed = await verifyMfa(h.deps, { mfaTicket: pending.mfaTicket, code: hotp(secret, currentStep(h.clock.ms())) }, h.ctx);
    expect(Object.keys(signed.issued.session.factors).sort()).toEqual(["passkey", "totp"]);
  });

  test("a counter regression end to end suspends the passkey, records it, mails the owner and refuses; a later good sign-in is passkey_suspended", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const auth = new SoftAuthenticator();
    const credentialId = await register(h, account.session, auth);
    expect((await passkeySignIn(h, auth, credentialId, randomToken(), { counter: 5 })).kind).toBe("session");
    expect((await passkeyRow(credentialId)).counter).toBe(5);

    // A counter that goes backwards, after the signature checks: suspend, record, mail, refuse.
    expect(await failure(passkeySignIn(h, auth, credentialId, randomToken(), { counter: 3 }))).toMatchObject({ code: "passkey_invalid", status: 401 });
    const row = await passkeyRow(credentialId);
    expect(row.suspectAt).not.toBeNull();
    const events = await db.select({ type: authEvents.type, metadata: authEvents.metadata }).from(authEvents).where(eq(authEvents.userId, account.user.id));
    expect(events.filter((e) => e.type === "passkey_counter_regression")).toEqual([{ type: "passkey_counter_regression", metadata: { passkeyId: row.id } }]);
    expect(h.mailer.sent.filter((m) => m.template === "passkey_suspect")).toEqual([{ to: account.email, template: "passkey_suspect", data: { name: row.name } }]);

    // A suspended passkey is refused from then on, after its signature checks.
    expect(await failure(passkeySignIn(h, auth, credentialId, randomToken(), { counter: 9 }))).toMatchObject({ code: "passkey_suspended", status: 403 });
  });

  test("the new-device alert's not-me link removes the passkey that signed in", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const auth = new SoftAuthenticator();
    const credentialId = await register(h, account.session, auth);
    const added = await passkeyRow(credentialId);

    // Sign in from a device the account has not used: the passkey signs in and its new-device alert names it.
    const outcome = await passkeySignIn(h, auth, credentialId, randomToken());
    expect(outcome.kind).toBe("session");
    const alert = h.mailer.sent.filter((m) => m.template === "new_device").at(-1)!;
    const token = alert.data.notMeUrl!.slice(alert.data.notMeUrl!.lastIndexOf("/") + 1);
    const stored = JSON.parse((await h.deps.kv.get(notMeKey(token)))!) as { passkeyId: string | null };
    expect(stored.passkeyId).toBe(added.id);

    await notMe(h.deps, { token }, h.ctx);
    expect(await db.select().from(passkeys).where(eq(passkeys.id, added.id))).toEqual([]);
    expect((await repo.findUserById(account.user.id))!.passwordHash).toBeNull();
  });
});
```

### Create `apps/api/test/integration/http-passkey-signin.test.ts`

```ts
import { randomBytes, randomUUID } from "node:crypto";
import Redis from "ioredis";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ErrorEnvelope, FlowResponse, MeResponse, PasskeyOptionsResponse, SessionResult } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth, redisKv, type Auth } from "../../src/auth";
import { encrypt, randomToken } from "../../src/auth/crypto";
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from "../../src/auth/passkeys/webauthn";
import { currentStep, hotp, newTotpSecret } from "../../src/auth/totp";
import { loadConfig, type Config } from "../../src/config";
import { smtpMailer } from "../../src/mail/smtp";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { SoftAuthenticator, type SoftFlags } from "../auth/soft-authenticator";
import { Browser, NativeClient } from "./http-client";
import { codeFrom, inbox } from "./mailpit";

const ALL: SoftFlags = { up: true, uv: true, be: true, bs: true };
const BARE: SoftFlags = { up: true, uv: false, be: false, bs: false };
const SUBJECT = { signUp: "Your korbat sign-up code" };

const newEmail = (prefix: string) => `${prefix}-${randomUUID()}@korbat.local`;
const newHandle = () => `s_${randomBytes(6).toString("hex")}`;

/**
 * The passkey sign-in and re-authentication-options routes over HTTP (1c design, sections 7.2, 7.4 and 10): their guards
 * and limits, the web cookies and the bearer token on a sign-in, and the TOTP step's answer shape.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the passkey sign-in routes over HTTP (Postgres, Redis, Mailpit)", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let redis: Redis;
  let auth: Auth;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
    redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
    auth = createAuth({
      config,
      logger,
      authDb,
      kv: redisKv(redis, `korbat:test:${randomUUID()}:`),
      mailer: smtpMailer(config.SMTP_URL, config.MAIL_FROM),
      profiles: createProfileStore(apiDb),
      turnstile: { verify: async () => true },
      breachChecker: { isBreached: async () => false },
    });
    app = createApp({ config, logger, rateLimitStore: new MemoryStore(), healthChecks: {}, auth });
  });
  afterAll(async () => {
    await Promise.allSettled([closeDb(authDb), closeDb(apiDb), redis.quit()]);
  });

  const web = () => new Browser(app, config.APP_ORIGIN);
  const error = async (res: Response) => ErrorEnvelope.parse(await res.json()).error;
  const userIdOf = async (b: Browser) => MeResponse.parse(await (await b.fetch("/api/me")).json()).user.id;

  /** A signed-up, onboarded web account with codes read from Mailpit. */
  async function signUp() {
    const b = web();
    const email = newEmail("signin");
    const box = await inbox(email);
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(start.status).toBe(200);
    const { flowId } = FlowResponse.parse(await start.json());
    expect((await b.fetch("/api/auth/email/verify", { json: { flowId, code: codeFrom(await box.next(SUBJECT.signUp)) } })).status).toBe(200);
    expect((await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).status).toBe(200);
    expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle: newHandle(), displayName: "Passkey User" } })).status).toBe(200);
    return { b, email, userId: await userIdOf(b) };
  }

  /** Registers a passkey on the signed-in browser and answers the authenticator that holds it and its credential id. */
  async function register(b: Browser, flags: SoftFlags = ALL) {
    const optionsRes = await b.fetch("/api/auth/passkeys/register/options", { json: { label: "ada" } });
    expect(optionsRes.status).toBe(200);
    const options = PasskeyOptionsResponse.parse(await optionsRes.json()).options as unknown as PublicKeyCredentialCreationOptionsJSON;
    const authenticator = new SoftAuthenticator();
    const response = authenticator.create({ rpId: options.rp.id!, challenge: options.challenge, origin: config.APP_ORIGIN, userHandle: Buffer.from(options.user.id, "base64url"), flags });
    expect((await b.fetch("/api/auth/passkeys/register/verify", { json: { response } })).status).toBe(200);
    return { authenticator, credentialId: response.id };
  }

  /** TOTP on, as the confirm step leaves it; the session cache is dropped so mfaEnabled shows. */
  async function withTotp(userId: string) {
    const secret = newTotpSecret();
    await auth.deps.repo.enableTotp(userId, { secretEnc: encrypt(Buffer.from(secret), auth.deps.config.totpKey), recoveryCodesHash: [], now: new Date() });
    await auth.deps.sessions.forgetUser(userId);
    return secret;
  }

  const signinOptions = async (client: Browser | NativeClient) => {
    const res = await client.fetch("/api/auth/passkey/signin/options", { method: "POST" });
    expect(res.status).toBe(200);
    return PasskeyOptionsResponse.parse(await res.json()).options as unknown as PublicKeyCredentialRequestOptionsJSON;
  };
  const assertion = (authenticator: SoftAuthenticator, options: PublicKeyCredentialRequestOptionsJSON, credentialId: string, flags: SoftFlags = ALL) =>
    authenticator.get({ credentialId, rpId: config.WEBAUTHN_RP_ID, challenge: options.challenge, origin: config.APP_ORIGIN, flags, counter: 0 });
  const signinVerify = (client: Browser | NativeClient, response: unknown, platform: "web" | "ios", deviceId = randomToken()) =>
    client.fetch("/api/auth/passkey/signin/verify", { json: { deviceId, platform, response } });

  test("the sign-in routes need no session; the verify body is validated; re-auth options need a session", { timeout: 60_000 }, async () => {
    const stranger = web();
    // Options are public and store nothing but the per-IP counter.
    const options = await signinOptions(stranger);
    expect(options.allowCredentials).toEqual([]);
    expect(options.challenge).toMatch(/^[A-Za-z0-9_-]{78}$/);
    // A malformed verify body is a 400 before any lookup.
    const bad = await stranger.fetch("/api/auth/passkey/signin/verify", { json: { deviceId: "short", platform: "web", response: {} } });
    expect(bad.status).toBe(400);
    expect((await error(bad)).code).toBe("invalid_request");
    // Re-authentication options need an onboarded session.
    const noSession = await stranger.fetch("/api/auth/reauth/passkey/options", { method: "POST" });
    expect(noSession.status).toBe(401);
    expect((await error(noSession)).code).toBe("unauthenticated");
  });

  test("a web sign-in sets the session cookies and no token; a native sign-in returns the bearer token and no cookies", { timeout: 60_000 }, async () => {
    const { b } = await signUp();
    const { authenticator, credentialId } = await register(b);

    // Web: a fresh browser (a new device) signs in with the passkey and gets cookies only.
    const browser = web();
    const webRes = await signinVerify(browser, assertion(authenticator, await signinOptions(browser), credentialId), "web");
    expect(webRes.status).toBe(200);
    expect(await webRes.json()).toEqual({ result: "session", mustReenrollMfa: false });
    expect(webRes.headers.getSetCookie().some((line) => line.startsWith("__Host-korbat_session="))).toBe(true);
    expect(browser.cookie("__Host-korbat_session")).toBeDefined();
    expect((await browser.fetch("/api/me")).status).toBe(200);

    // Native: the bearer token comes back in the body, and no cookies are set.
    const phone = new NativeClient(app);
    const nativeRes = await signinVerify(phone, assertion(authenticator, await signinOptions(phone), credentialId), "ios");
    expect(nativeRes.status).toBe(200);
    const body = SessionResult.parse(await nativeRes.json());
    expect(body.token).toMatch(/^kb1_[A-Za-z0-9_-]{43}$/);
    expect(nativeRes.headers.getSetCookie()).toHaveLength(0);
    phone.token = body.token;
    expect((await phone.fetch("/api/me")).status).toBe(200);
  });

  test("on an account with TOTP, a passkey without user verification stops at the TOTP step, whose code completes the sign-in", { timeout: 60_000 }, async () => {
    const { b, userId } = await signUp();
    const { authenticator, credentialId } = await register(b, BARE);
    const secret = await withTotp(userId);

    const browser = web();
    const pending = await signinVerify(browser, assertion(authenticator, await signinOptions(browser), credentialId), "web");
    expect(pending.status).toBe(200);
    const body = (await pending.json()) as { result: string; mfaTicket?: string };
    expect(body.result).toBe("mfa_required");
    expect(body.mfaTicket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(browser.cookie("__Host-korbat_session")).toBeUndefined();

    const done = await browser.fetch("/api/auth/mfa/verify", { json: { mfaTicket: body.mfaTicket, code: hotp(secret, currentStep(Date.now())) } });
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({ result: "session", mustReenrollMfa: false });
    expect(browser.cookie("__Host-korbat_session")).toBeDefined();
  });

  test("the limits: 30 options and 20 verifications per IP per 15 minutes, and 5 new-device sign-ins an hour per account", { timeout: 90_000 }, async () => {
    const limited = async (res: Response, retryAfter: number) => {
      expect(res.status).toBe(429);
      expect((await error(res)).code).toBe("rate_limited");
      expect(res.headers.get("retry-after")).toBe(String(retryAfter));
    };

    // Options: 30 per IP per 15 minutes.
    const optionsClient = web();
    for (let i = 0; i < 30; i++) expect((await optionsClient.fetch("/api/auth/passkey/signin/options", { method: "POST" })).status).toBe(200);
    await limited(await optionsClient.fetch("/api/auth/passkey/signin/options", { method: "POST" }), 900);

    // Verify: 20 per IP per 15 minutes, counted before the challenge, so a bogus assertion still counts.
    const verifyClient = web();
    const orphan = new SoftAuthenticator();
    const reg = orphan.create({ rpId: config.WEBAUTHN_RP_ID, challenge: (await signinOptions(verifyClient)).challenge, origin: config.APP_ORIGIN, userHandle: randomBytes(32), flags: ALL });
    const bogus = orphan.get({ credentialId: reg.id, rpId: config.WEBAUTHN_RP_ID, challenge: "not-a-real-challenge", origin: config.APP_ORIGIN, flags: ALL, counter: 0 });
    for (let i = 0; i < 20; i++) expect((await signinVerify(verifyClient, bogus, "web")).status).toBe(401);
    await limited(await signinVerify(verifyClient, bogus, "web"), 900);

    // New device: 5 an hour per account. A fresh client each time is a new device; the sixth is refused.
    const { b } = await signUp();
    const { authenticator, credentialId } = await register(b);
    for (let i = 0; i < 5; i++) {
      const client = web();
      expect((await signinVerify(client, assertion(authenticator, await signinOptions(client), credentialId), "web")).status).toBe(200);
    }
    const sixth = web();
    await limited(await signinVerify(sixth, assertion(authenticator, await signinOptions(sixth), credentialId), "web"), 3600);
  });
});
```

### Replace `apps/api/test/auth/flow-harness.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import type { Platform } from "@korbat/contracts";
import pino from "pino";
import type { AuthConfig, AuthDeps, RequestContext } from "../../src/auth/context";
import { parseVersionedKey, randomToken, sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { createLockout } from "../../src/auth/lockout";
import type { ActiveSessionRow, AddPasskeyOutcome, AuthEventType, AuthRepo, DeviceRow, EmailCodeRow, NewPasskey, PasskeyLimits, PasskeyListRow, PasskeyRow, UserRow } from "../../src/auth/repo";
import { createSessions, SESSION_ABSOLUTE_MS, SESSION_IDLE_MS, type Factors, type Session } from "../../src/auth/sessions";
import { devProvider } from "../../src/auth/verify/dev";
import { MemoryMailer } from "../../src/mail/memory";

export interface RecordedEvent {
  userId: string | null;
  type: AuthEventType;
  deviceId: string | null;
  metadata: Record<string, unknown>;
}

export const TEST_TERMS = "draft-test";

/**
 * A session of a user, as the deletion and lockdown flows revoke it and, since Task 5, as the sign-in and re-authentication
 * flows issue, resolve and rotate it. The first three fields are all those older flows read; the rest let findActiveSession
 * answer a full row.
 */
export interface RecordedSession {
  id: string;
  userId: string;
  revokedAt: Date | null;
  deviceId: string;
  handle: string;
  factors: Record<string, number>;
  passkeyId: string | null;
  reauthAt: Date;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
}

export interface RecordedDevice {
  id: string;
  userId: string;
  revokedAt: Date | null;
  /** What the passkey flows read of the row: the platform for a passkey's default name and the label for the Security list. */
  platform: Platform;
  label: string | null;
  /** The keyed hash a sign-in looks a device up by; absent on the devices h.session and h.user seed, which no lookup finds. */
  deviceHash?: string;
}

/** A passkey of a user, as the registration writes it and the lockdown and the management flows read it. */
export type RecordedPasskey = PasskeyRow;

/**
 * The auth flows without a database: users, email codes, sessions, devices and passkeys live in memory, and the
 * repository fake holds only the methods the email-change (with its undo link), badge, deletion, not-me and
 * lockdown flows call (and the lookups the sign-in starts make), checked against the real signatures. The key-value store and the
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
  const passkeys: RecordedPasskey[] = [];
  /**
   * When each event was recorded, at the harness clock, kept beside the events rather than on them: the tests compare
   * the events with the exact objects the flows write, and the daily passkey bound is the only reader of the times.
   */
  const eventTimes = new WeakMap<RecordedEvent, number>();
  const recordEvent = (event: RecordedEvent) => {
    events.push(event);
    eventTimes.set(event, t);
  };
  /** The handle of each account's profile, which the deletion flow compares the typed handle with. */
  const handles = new Map<string, string>();
  /** Repository methods told to fail: "takeDown" fails its transaction midway, after staging its writes and before any lands. */
  const faults = new Set<"takeDown">();
  /** A device as the real row reads, from what the harness keeps of it; the hash and the times are placeholders no flow reads here. */
  const deviceRow = (device: RecordedDevice): DeviceRow => ({
    id: device.id,
    userId: device.userId,
    deviceHash: device.deviceHash ?? `hash-${device.id}`,
    label: device.label,
    platform: device.platform,
    firstSeenAt: now(),
    lastSeenAt: now(),
    ipHash: null,
    revokedAt: device.revokedAt,
  });
  /** A passkey with the label of the device that added it, as the real join answers it: null once that device is gone. */
  const withDevice = (passkey: RecordedPasskey): PasskeyListRow => ({ ...passkey, createdOn: devices.find((d) => d.id === passkey.createdDeviceId)?.label ?? null });
  /**
   * The daily bound's reading, as the real statement makes it: the times of the account's latest passkey_added events within
   * the window, at most `limit` of them, and the seconds until the oldest of those leaves the window.
   */
  const recentPasskeyAdditions = (userId: string, withinMs: number, limit: number) => {
    const recent = events
      .filter((e) => e.userId === userId && e.type === "passkey_added")
      .map((e) => eventTimes.get(e)!)
      .filter((at) => at > t - withinMs)
      .sort((a, b) => b - a)
      .slice(0, limit);
    const oldest = recent.at(-1);
    return { count: recent.length, retryAfterSeconds: oldest === undefined ? 0 : Math.ceil((oldest + withinMs - t) / 1000) };
  };
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
    async deletePasskeys(userId: string, input: { since: Date; ids: readonly string[] }): Promise<string[]> {
      // As the real statement: the user's passkeys created at or after `since`, plus any of theirs the caller names.
      const removed: string[] = [];
      for (let i = passkeys.length - 1; i >= 0; i--) {
        const passkey = passkeys[i]!;
        if (passkey.userId !== userId) continue;
        if (passkey.createdAt.getTime() >= input.since.getTime() || input.ids.includes(passkey.id)) {
          removed.push(passkey.id);
          passkeys.splice(i, 1);
        }
      }
      return removed;
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
      recordEvent({ userId: input.userId, type: input.type, deviceId: input.deviceId ?? null, metadata: input.metadata ?? {} });
    },
    async findDeviceById(id: string): Promise<DeviceRow | undefined> {
      const device = devices.find((d) => d.id === id);
      return device ? deviceRow(device) : undefined;
    },
    async ensureWebauthnUserId(userId: string, candidate: Buffer): Promise<Buffer | undefined> {
      // As the real compare-and-set: the first candidate sticks, every later call reads it back.
      const row = users.get(userId);
      if (!row || row.deletedAt !== null) return undefined;
      row.webauthnUserId ??= candidate;
      return row.webauthnUserId;
    },
    async countPasskeys(userId: string): Promise<number> {
      return passkeys.filter((p) => p.userId === userId).length;
    },
    async listPasskeys(userId: string): Promise<PasskeyListRow[]> {
      // Newest first, as the real statement orders them.
      return passkeys
        .filter((p) => p.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map(withDevice);
    },
    async findPasskey(id: string, userId: string): Promise<PasskeyListRow | undefined> {
      const passkey = passkeys.find((p) => p.id === id && p.userId === userId);
      return passkey ? withDevice(passkey) : undefined;
    },
    async recentPasskeyAdditions(userId: string, withinMs: number, limit: number): Promise<{ count: number; retryAfterSeconds: number }> {
      return recentPasskeyAdditions(userId, withinMs, limit);
    },
    async addPasskey(input: NewPasskey, limits: PasskeyLimits): Promise<AddPasskeyOutcome> {
      // As the real transaction: the account locked, both bounds checked again, then the row and its event, or nothing.
      const row = users.get(input.userId);
      if (!row || row.deletedAt !== null) return { ok: false, reason: "gone" };
      if (passkeys.filter((p) => p.userId === input.userId).length >= limits.passkeys) return { ok: false, reason: "cap" };
      const additions = recentPasskeyAdditions(input.userId, limits.windowMs, limits.additions);
      if (additions.count >= limits.additions) return { ok: false, reason: "daily", retryAfterSeconds: additions.retryAfterSeconds };
      // As the real unique index on credential_id: the driver error that the flow recognises through isUniqueViolation.
      if (passkeys.some((p) => p.credentialId === input.credentialId)) {
        throw Object.assign(new Error('duplicate key value violates unique constraint "passkeys_credential_idx"'), { code: "23505" });
      }
      const passkey: RecordedPasskey = { id: randomUUID(), lastUsedAt: null, suspectAt: null, ...input };
      passkeys.push(passkey);
      recordEvent({ userId: input.userId, type: "passkey_added", deviceId: input.createdDeviceId, metadata: { passkeyId: passkey.id } });
      return { ok: true, passkey: { ...passkey } };
    },
    async renamePasskey(id: string, userId: string, name: string): Promise<boolean> {
      const passkey = passkeys.find((p) => p.id === id && p.userId === userId);
      if (!passkey) return false;
      passkey.name = name;
      return true;
    },
    async deletePasskey(id: string, userId: string): Promise<{ name: string } | undefined> {
      const index = passkeys.findIndex((p) => p.id === id && p.userId === userId);
      if (index === -1) return undefined;
      const [removed] = passkeys.splice(index, 1);
      return { name: removed!.name };
    },
    async findPasskeyByCredentialId(credentialId: string): Promise<PasskeyRow | undefined> {
      // As the real lookup: any account's, and the flow refuses a deleted owner through findUserById.
      const passkey = passkeys.find((p) => p.credentialId === credentialId);
      return passkey ? { ...passkey } : undefined;
    },
    async findPasskeyByCredential(credentialId: string, userId: string): Promise<PasskeyRow | undefined> {
      const passkey = passkeys.find((p) => p.credentialId === credentialId && p.userId === userId);
      return passkey ? { ...passkey } : undefined;
    },
    async claimPasskeyUse(id: string, newCounter: number, backedUp: boolean, at: Date): Promise<boolean> {
      // As the real conditional update: a suspect passkey never matches, and the counter must move forward unless both are zero.
      const passkey = passkeys.find((p) => p.id === id);
      if (!passkey || passkey.suspectAt !== null) return false;
      if (!((newCounter === 0 && passkey.counter === 0) || newCounter > passkey.counter)) return false;
      passkey.counter = newCounter;
      passkey.lastUsedAt = at;
      passkey.backedUp = backedUp;
      return true;
    },
    async suspectPasskey(id: string, at: Date): Promise<void> {
      const passkey = passkeys.find((p) => p.id === id);
      if (passkey && passkey.suspectAt === null) passkey.suspectAt = at;
    },
    async findDevice(userId: string, deviceHashValue: string): Promise<DeviceRow | undefined> {
      const device = devices.find((d) => d.userId === userId && d.deviceHash === deviceHashValue && d.revokedAt === null);
      return device ? deviceRow(device) : undefined;
    },
    async createDevice(input: { userId: string; deviceHash: string; label: string; platform: string; ipHash: string | null }): Promise<DeviceRow> {
      const device: RecordedDevice = { id: randomUUID(), userId: input.userId, revokedAt: null, platform: input.platform as Platform, label: input.label, deviceHash: input.deviceHash };
      devices.push(device);
      return deviceRow(device);
    },
    async touchDevice(): Promise<void> {
      // The row's last-seen and ip are placeholders no flow reads here, so touching it changes nothing observable.
    },
    async createSession(input: {
      id: string;
      userId: string;
      deviceId: string;
      now: Date;
      expiresAt: Date;
      absoluteExpiresAt: Date;
      factors?: Record<string, number>;
      passkeyId?: string | null;
    }): Promise<void> {
      // As the real insert: the reauth time is the latest of the factors, and a fresh handle stands in for the column's default.
      const factors = input.factors ?? {};
      const times = Object.values(factors);
      sessions.push({
        id: input.id,
        userId: input.userId,
        revokedAt: null,
        deviceId: input.deviceId,
        handle: randomUUID(),
        factors,
        passkeyId: input.passkeyId ?? null,
        reauthAt: times.length > 0 ? new Date(Math.max(...times)) : input.now,
        createdAt: input.now,
        lastUsedAt: input.now,
        expiresAt: input.expiresAt,
        absoluteExpiresAt: input.absoluteExpiresAt,
      });
    },
    async findActiveSession(id: string, at: Date): Promise<ActiveSessionRow | undefined> {
      // As the real joins: the session, its account and its device must all be live.
      const row = sessions.find((s) => s.id === id && s.revokedAt === null && s.expiresAt > at && s.absoluteExpiresAt > at);
      if (!row) return undefined;
      const user = users.get(row.userId);
      if (!user || user.deletedAt !== null) return undefined;
      const device = devices.find((d) => d.id === row.deviceId && d.revokedAt === null);
      if (!device) return undefined;
      return {
        id: row.id,
        userId: row.userId,
        deviceId: row.deviceId,
        role: user.role,
        onboardedAt: user.onboardedAt,
        totpEnabledAt: user.totpEnabledAt,
        reauthAt: row.reauthAt,
        lastUsedAt: row.lastUsedAt,
        expiresAt: row.expiresAt,
        absoluteExpiresAt: row.absoluteExpiresAt,
        handle: row.handle,
        factors: row.factors,
        passkeyId: row.passkeyId,
      };
    },
    async rotateSession(id: string, newId: string): Promise<boolean> {
      // As the real statement: the primary key changes in place for a live row, and everything else stays.
      const row = sessions.find((s) => s.id === id && s.revokedAt === null);
      if (!row) return false;
      row.id = newId;
      return true;
    },
    async writeFactor(id: string, kind: string, at: Date): Promise<void> {
      // As the real statement: the kind's time is set or replaced and the reauth time follows it.
      const row = sessions.find((s) => s.id === id);
      if (!row) return;
      row.factors = { ...row.factors, [kind]: at.getTime() };
      row.reauthAt = at;
    },
    async claimTotpStep(userId: string, step: number): Promise<boolean> {
      // As the real conditional update: a step no later than the last accepted one is refused, so a code cannot be reused.
      const row = users.get(userId);
      if (!row || (row.totpLastStep !== null && row.totpLastStep >= step)) return false;
      row.totpLastStep = step;
      return true;
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
      recordEvent({ userId, type: "account_deleted", deviceId, metadata: {} });
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
    | "deletePasskeys"
    | "setPhoneHash"
    | "appendEvent"
    | "findDeviceById"
    | "ensureWebauthnUserId"
    | "countPasskeys"
    | "listPasskeys"
    | "findPasskey"
    | "recentPasskeyAdditions"
    | "addPasskey"
    | "renamePasskey"
    | "deletePasskey"
    | "findPasskeyByCredentialId"
    | "findPasskeyByCredential"
    | "claimPasskeyUse"
    | "suspectPasskey"
    | "findDevice"
    | "createDevice"
    | "touchDevice"
    | "createSession"
    | "findActiveSession"
    | "rotateSession"
    | "writeFactor"
    | "claimTotpStep"
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
  /**
   * A live session on a device of its own, both recorded as the deletion flow will find them. It proved an email code
   * just now unless given other factors, as a session behind requireFreshAuth has, and started from no passkey unless told so.
   * The device is a web browser labelled as the sign-in labels one, unless the test says otherwise.
   */
  const session = (userId: string, options: { factors?: Factors; passkeyId?: string | null; platform?: Platform; label?: string | null } = {}): Session => {
    const s: Session = {
      sessionId: sha256Hex(randomToken()),
      userId,
      deviceId: randomUUID(),
      role: "user",
      onboarded: true,
      mfaEnabled: false,
      reauthAt: now(),
      handle: randomUUID(),
      factors: options.factors ?? { email: t },
      passkeyId: options.passkeyId ?? null,
    };
    sessions.push({
      id: s.sessionId,
      userId,
      revokedAt: null,
      deviceId: s.deviceId,
      handle: s.handle,
      factors: s.factors,
      passkeyId: s.passkeyId,
      reauthAt: s.reauthAt,
      createdAt: now(),
      lastUsedAt: now(),
      expiresAt: new Date(t + SESSION_IDLE_MS),
      absoluteExpiresAt: new Date(t + SESSION_ABSOLUTE_MS),
    });
    devices.push({ id: s.deviceId, userId, revokedAt: null, platform: options.platform ?? "web", label: options.label === undefined ? "Chrome on Windows" : options.label });
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
    passkeys,
    verified,
    faults,
    now,
    advance(ms: number) {
      t += ms;
    },
    /** Another session of an existing account, on another device. */
    session,
    /**
     * A passkey of an existing account, created at `createdAt` (now unless given) with the row's defaults (a plain,
     * unnamed synced key added from no device) unless overridden; answers its id.
     */
    passkey(userId: string, createdAt: Date = now(), overrides: Partial<Omit<RecordedPasskey, "id" | "userId" | "createdAt">> = {}): string {
      const id = randomUUID();
      passkeys.push({
        id,
        userId,
        createdAt,
        credentialId: randomToken(),
        publicKey: "cose-key",
        counter: 0,
        transports: [],
        backedUp: false,
        name: "Passkey",
        lastUsedAt: null,
        aaguid: null,
        backupEligible: false,
        uvInitialized: false,
        createdDeviceId: null,
        suspectAt: null,
        ...overrides,
      });
      return id;
    },
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
  ReauthResponse,
  RecoveryCode,
  SignupCompleteRequest,
  TotpDisableRequest,
} from "../src/index";

const flow = "a".repeat(43);
const userId = "3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a";

/** A minimal well-formed authentication assertion, for the passkey re-authentication variant. */
const reauthAssertion = {
  id: "q2Xx0w8bRk6nV8yQ0f2mUg",
  rawId: "q2Xx0w8bRk6nV8yQ0f2mUg",
  type: "public-key",
  response: { clientDataJSON: "A".repeat(200), authenticatorData: "A".repeat(50), signature: "A".repeat(96) },
  clientExtensionResults: {},
};

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
  test("reauth accepts password, totp, email, recovery and passkey methods only", () => {
    expect(ReauthRequest.safeParse({ method: "password", password: "x" }).success).toBe(true);
    expect(ReauthRequest.safeParse({ method: "totp", code: "000000" }).success).toBe(true);
    expect(ReauthRequest.safeParse({ method: "email", flowId: flow, code: "000000" }).success).toBe(true);
    // A recovery code (1c design, section 7.2), normalised as the MFA step normalises it.
    expect(ReauthRequest.parse({ method: "recovery", recoveryCode: " ABCD-EF23-GH45 " })).toEqual({ method: "recovery", recoveryCode: "abcd-ef23-gh45" });
    expect(ReauthRequest.safeParse({ method: "recovery", recoveryCode: "abcd-ef01-gh45" }).success).toBe(false);
    expect(ReauthRequest.safeParse({ method: "recovery", code: "000000" }).success).toBe(false);
    // A passkey re-authentication carries an assertion (1c design, section 7.2); a registration is not one.
    expect(ReauthRequest.safeParse({ method: "passkey", response: reauthAssertion }).success).toBe(true);
    expect(ReauthRequest.safeParse({ method: "passkey" }).success).toBe(false);
    expect(ReauthRequest.safeParse({ method: "passkey", response: { ...reauthAssertion, response: {} } }).success).toBe(false);
    expect(ReauthRequest.safeParse({ method: "sms", code: "000000" }).success).toBe(false);
  });
  test("the reauth answer carries the level reached, the rotated token for native clients and, after a recovery code, the re-enrolment flag", () => {
    expect(ReauthResponse.parse({ level: 1 })).toEqual({ level: 1 });
    expect(ReauthResponse.parse({ level: 2, token: "kb1_x", mustReenrollMfa: true })).toEqual({ level: 2, token: "kb1_x", mustReenrollMfa: true });
    expect(ReauthResponse.safeParse({ level: 3 }).success).toBe(false);
    expect(ReauthResponse.safeParse({ level: "2" }).success).toBe(false);
    expect(ReauthResponse.safeParse({ token: "kb1_x" }).success).toBe(false);
  });
  test("turning TOTP off takes an empty body: the re-authentication already spent the code, and a code sent anyway is dropped", () => {
    expect(TotpDisableRequest.parse({})).toEqual({});
    expect(TotpDisableRequest.parse({ code: "123456" })).toEqual({});
    expect(TotpDisableRequest.safeParse(null).success).toBe(false);
    expect(TotpDisableRequest.safeParse("code").success).toBe(false);
  });
  test("signup completion needs an ISO calendar date", () => {
    expect(SignupCompleteRequest.safeParse({ flowId: flow, dateOfBirth: "2008-02-29", termsVersion: "draft" }).success).toBe(true);
    expect(SignupCompleteRequest.safeParse({ flowId: flow, dateOfBirth: "29/02/2008", termsVersion: "draft" }).success).toBe(false);
  });
  test("me response carries email, the count of passkeys and a nullable profile", () => {
    const me = {
      user: { id: userId, email: "a@b.io", role: "user", onboarded: false, mfaEnabled: false, hasPassword: false, passkeys: 0 },
      profile: null,
    };
    expect(MeResponse.parse(me)).toEqual(me);
    // The count decides whether the app offers a passkey re-authentication and the suggestion card (1c design, section 9), so it is never left out.
    expect(MeResponse.parse({ ...me, user: { ...me.user, passkeys: 3 } }).user.passkeys).toBe(3);
    expect(MeResponse.safeParse({ ...me, user: { ...me.user, passkeys: undefined } }).success).toBe(false);
    expect(MeResponse.safeParse({ ...me, user: { ...me.user, passkeys: -1 } }).success).toBe(false);
    expect(MeResponse.safeParse({ ...me, user: { ...me.user, passkeys: 1.5 } }).success).toBe(false);
  });
  test("the own profile in the me response says when the handle last changed and whether the badge is held", () => {
    const user = { id: userId, email: "a@b.io", role: "user", onboarded: true, mfaEnabled: false, hasPassword: false, passkeys: 0 };
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

## Step 2: run the tests and watch them fail

```bash
pnpm --filter @korbat/api test
```

Expected: the command exits with an error, and the output contains:

- `Tests  `
- `failed`

Observed on the dry run:

```text
❯ test/auth/passkey-signin.test.ts (17 tests | 17 failed) 328ms
Test Files  1 failed | 42 passed | 38 skipped (81)
Tests  17 failed | 397 passed | 239 skipped (653)
262|     // A failed sign-in from a new device does not count: an unknown c…
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/passkeys-1c/write_blocks.py docs/superpowers/prompts/passkeys-1c/05-passkey-signin.md 3
```

Expected: 6 lines starting with `wrote`, one for each file below.

### Replace `apps/api/src/auth/flows/reauth.ts` (whole file)

```ts
import type { ReauthRequest } from "@korbat/contracts";
import { AuthError, type AuthDeps, type RequestContext } from "../context";
import { randomToken } from "../crypto";
import { HOUR, MINUTE, enforceLimit } from "../limits";
import { reauthenticatePasskey } from "../passkeys/flows";
import { verifyPassword } from "../passwords";
import { hashRecoveryCode } from "../recovery-codes";
import type { FactorKind, IssuedSession, Session } from "../sessions";
import { verifyTotp } from "../totp";
import { CODE_TTL_MS, checkEmailCode, emailCodeHash, newEmailCode, sendCode } from "./email";
import { storedSecret } from "./mfa";
import { notifyAccount } from "./notify";

/** What a re-authentication leaves: the level the session holds now, its rotated token, and after a recovery code the call to set MFA up again. */
export interface Reauthenticated {
  level: 1 | 2;
  issued: IssuedSession;
  mustReenrollMfa: boolean;
}

/**
 * Sends a code that can only re-authenticate this account (never sign anyone in). Three an hour per session, counted by
 * the handle: a rotation keeps it, so rotating resets nothing, and no other session of the account can spend it.
 */
export async function startReauthEmail(deps: AuthDeps, session: Session, ctx: RequestContext): Promise<{ flowId: string }> {
  await enforceLimit(deps.kv, `reauth-email:${session.handle}`, 3, HOUR);
  const user = await deps.repo.findUserById(session.userId);
  if (!user) throw new AuthError("invalid_credentials", 401);
  const flowId = randomToken();
  const code = newEmailCode();
  await deps.repo.createEmailCode({
    flowId,
    email: user.email,
    userId: user.id,
    purpose: "reauth",
    codeHash: emailCodeHash(deps.config.authHmacKey, flowId, code),
    expiresAt: new Date(deps.now().getTime() + CODE_TTL_MS),
    ipHash: ctx.ipHash,
  });
  await sendCode(deps, { to: user.email, template: "reauth_code", data: { code } });
  return { flowId };
}

/**
 * Proves a credential again (1c design, sections 7.1 and 7.2): the factor is written at the flows' clock, so freshness
 * and the level follow from the factors, and the token rotates in place, so a copy of the old token stops working.
 * Five tries per session every 15 minutes, counted at every verification and by the session's handle, and thirty per
 * address; wrong passwords also count towards the lockout.
 */
export async function reauthenticate(deps: AuthDeps, session: Session, input: ReauthRequest, ctx: RequestContext): Promise<Reauthenticated> {
  await enforceLimit(deps.kv, `reauth:${session.handle}`, 5, 15 * MINUTE);
  await enforceLimit(deps.kv, `reauth:ip:${ctx.ipHash}`, 30, 15 * MINUTE);
  const user = await deps.repo.findUserById(session.userId);
  if (!user) throw new AuthError("invalid_credentials", 401);

  let kind: FactorKind;
  let mustReenrollMfa = false;
  switch (input.method) {
    case "password": {
      const usable = user.passwordHash !== null && !deps.lockout.isLocked(user);
      const ok = await verifyPassword(usable ? user.passwordHash : null, input.password);
      if (!ok) {
        if (usable) await deps.lockout.recordFailure(user.id);
        throw new AuthError("invalid_credentials", 401);
      }
      await deps.lockout.recordSuccess(user.id);
      kind = "password";
      break;
    }
    case "totp": {
      const secret = await storedSecret(deps, user);
      const step = verifyTotp(secret, input.code, user.totpLastStep, deps.now().getTime());
      if (step === null || !(await deps.repo.claimTotpStep(user.id, step))) throw new AuthError("invalid_mfa_code", 401);
      kind = "totp";
      break;
    }
    case "email": {
      const row = await deps.repo.findEmailCode(input.flowId);
      if (row?.purpose !== "reauth" || row.userId !== user.id) throw new AuthError("invalid_code", 400);
      await checkEmailCode(deps, row, input.flowId, input.code);
      kind = "email";
      break;
    }
    case "recovery": {
      // Only an account with TOTP holds recovery codes, and each works once (1c design, section 7.2).
      if (!user.totpEnabledAt) throw new AuthError("mfa_required", 400);
      const consumed = await deps.repo.consumeRecoveryCodeHash(user.id, hashRecoveryCode(deps.config.authHmacKey, input.recoveryCode));
      if (!consumed) {
        await deps.repo.appendEvent({ userId: user.id, type: "signin_failure", ipHash: ctx.ipHash, metadata: { method: "recovery_code" } });
        throw new AuthError("invalid_mfa_code", 401);
      }
      await deps.repo.appendEvent({ userId: user.id, type: "recovery_code_used", deviceId: session.deviceId, ipHash: ctx.ipHash });
      // A code spent is one fewer of ten; the owner hears of it as of every other change to their credentials.
      await notifyAccount(deps, user.email, "recovery_code_used");
      mustReenrollMfa = true;
      kind = "recovery";
      break;
    }
    case "passkey": {
      // The challenge, the lookup with the session's user, the signature, the suspect check and the counter write live
      // next to the sign-in flow (1c design, section 7.2); the buckets, the factor write, the rotation and the answer are ours.
      kind = await reauthenticatePasskey(deps, session, user, input.response, deps.now());
      break;
    }
  }

  await deps.sessions.addFactor(session.sessionId, kind);
  const issued = await deps.sessions.rotate(session);
  return { level: deps.sessions.level(issued.session), issued, mustReenrollMfa };
}
```

### Replace `apps/api/src/auth/passkeys/flows.ts` (whole file)

```ts
import { randomBytes } from "node:crypto";
import type {
  AuthenticationResponseJSON,
  PasskeyListResponse,
  PasskeyRegisterOptionsRequest,
  PasskeyRegisterVerifyRequest,
  PasskeyRemoveLinkRequest,
  PasskeyRenameRequest,
  PasskeySignInVerifyRequest,
  PasskeyView,
} from "@korbat/contracts";
import { AuthError, isUniqueViolation, type AuthDeps, type RequestContext } from "../context";
import { randomToken, sha256Hex } from "../crypto";
import { MFA_TICKET_TTL_MS, mfaTicketKey, signIn, type DeviceInput, type MfaPending, type MfaTicket, type SignedIn } from "../flows/signin";
import { lockdown } from "../flows/lockdown";
import { notifyAccount } from "../flows/notify";
import { deviceHash, emailHash } from "../identifiers";
import { HOUR, MINUTE, enforceLimit } from "../limits";
import type { AddPasskeyOutcome, PasskeyLimits, PasskeyRow, UserRow } from "../repo";
import type { FactorKind, Session } from "../sessions";
import { challengeKey, issueChallenge, readChallenge, spendChallenge } from "./challenge";
import {
  authenticationOptions,
  readResponseChallenge,
  registrationOptions,
  verifyAuthentication,
  verifyRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type VerifiedAuthentication,
} from "./webauthn";

const DAY = 24 * HOUR;

/** At most this many passkeys on an account at a time (1c design, section 2). */
export const PASSKEY_CAP = 10;
/** At most this many added in any 24 hours, counted from the passkey_added events, so removing one frees no slot of the day. */
export const PASSKEY_ADDITIONS_PER_DAY = 5;
export const PASSKEY_ADDITIONS_WINDOW_MS = DAY;
/** A passkey counts as new for this long: the Security list marks it and offers "This wasn't me" on it. */
export const NEW_PASSKEY_MS = 7 * DAY;
/** How long the remove link in the passkey_added notice works. */
export const PASSKEY_REMOVE_TTL_MS = 7 * DAY;
export const REGISTER_OPTIONS_PER_HOUR = 10;
export const RENAMES_PER_HOUR = 30;
export const REMOVALS_PER_HOUR = 10;
export const NOT_MINE_PER_DAY = 5;
export const REMOVE_LINKS_PER_IP_PER_HOUR = 10;
/** The window the two unauthenticated sign-in limits count over. */
export const SIGNIN_WINDOW_MS = 15 * MINUTE;
export const SIGNIN_OPTIONS_PER_IP = 30;
export const SIGNIN_VERIFY_PER_IP = 20;
/** A passkey sign-in from a device the account has not used: bounded per account, since the assertion carries no session to key by. */
export const SIGNIN_NEW_DEVICE_PER_HOUR = 5;
export const SIGNIN_NEW_DEVICE_PER_DAY = 20;

const LIMITS: PasskeyLimits = { passkeys: PASSKEY_CAP, additions: PASSKEY_ADDITIONS_PER_DAY, windowMs: PASSKEY_ADDITIONS_WINDOW_MS };
const LINK_GONE = "This link has expired or was already used.";

/** The remove link is a bearer credential for 7 days, so the store holds only its hash. */
export const passkeyRemoveKey = (token: string) => `passkey-remove:${sha256Hex(token)}`;

/**
 * What a remove link acts on: the account, the passkey, its creation (epoch milliseconds from the flows' clock, the
 * lockdown's anchor, which holds whether or not the passkey is still there) and the keyed hash of the address the link
 * went to, which the link checks against the account's current address.
 */
export interface PasskeyRemoveToken {
  userId: string;
  passkeyId: string;
  createdAt: number;
  sentTo: string;
}

/** Refuses a session that has not proven enough within the window: level 2 on an account with TOTP unless told level 1, as the route's guard does. */
function requireFresh(deps: AuthDeps, session: Session, level: 1 | 2 = deps.sessions.requiredLevel(session)): void {
  const needed = deps.sessions.reauthNeeded(session, level);
  if (needed) throw new AuthError("reauth_required", 403, undefined, undefined, needed);
}

/**
 * A bound refused, as the app reads it: the reason in the details, and for the daily bound the seconds until the day has
 * a slot again, said in hours in the message (the cap keeps the code's own message).
 */
function limitReached(bound: { reason: "cap" } | { reason: "daily"; retryAfterSeconds: number }): AuthError {
  if (bound.reason === "cap") return new AuthError("passkey_limit", 409, undefined, undefined, { reason: "cap" });
  const hours = Math.max(1, Math.ceil(bound.retryAfterSeconds / 3600));
  const wait = hours === 1 ? "1 hour" : `${hours} hours`;
  return new AuthError("passkey_limit", 409, `You added ${PASSKEY_ADDITIONS_PER_DAY} passkeys today. You can add another in about ${wait}.`, undefined, {
    reason: "daily",
    retryAfter: bound.retryAfterSeconds,
  });
}

/** Both bounds before the options are handed out, so a full account is told at once; the registration's transaction checks them again. */
async function checkBounds(deps: AuthDeps, userId: string): Promise<void> {
  if ((await deps.repo.countPasskeys(userId)) >= PASSKEY_CAP) throw limitReached({ reason: "cap" });
  const additions = await deps.repo.recentPasskeyAdditions(userId, PASSKEY_ADDITIONS_WINDOW_MS, PASSKEY_ADDITIONS_PER_DAY);
  if (additions.count >= PASSKEY_ADDITIONS_PER_DAY) throw limitReached({ reason: "daily", retryAfterSeconds: additions.retryAfterSeconds });
}

const isNew = (createdAt: Date, now: Date) => now.getTime() - createdAt.getTime() < NEW_PASSKEY_MS;

/** A passkey as the Security list shows it: nothing of the key itself. */
function view(row: PasskeyRow, createdOn: string | null, session: Session, now: Date): PasskeyView {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    synced: row.backedUp,
    createdOn,
    current: session.passkeyId === row.id,
    isNew: isNew(row.createdAt, now),
    suspended: row.suspectAt !== null,
  };
}

/** The name a passkey gets when the owner gives none: after the platform of the device whose session added it. */
function defaultName(platform: string | undefined): string {
  const where = platform === "ios" ? "iOS" : platform === "android" ? "Android" : "the web";
  return `Passkey on ${where}`;
}

/** A time as the passkey notices print it: the date and the minute in UTC, since the reader's zone is unknown. */
function mailTime(at: Date): string {
  const iso = at.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/**
 * Options for adding a passkey (1c design, section 7.3): the account's user handle (set now if it never had one), the
 * label the password manager will show, the account's passkeys excluded so an authenticator does not add a second copy,
 * and a registration challenge bound to this session's handle. Needs level 2 on an account with TOTP (the route checks as
 * well): adding a credential is the first thing a stolen session would do.
 */
export async function registerOptions(deps: AuthDeps, session: Session, input: PasskeyRegisterOptionsRequest): Promise<{ options: PublicKeyCredentialCreationOptionsJSON }> {
  requireFresh(deps, session);
  // Counted by the handle: a rotation keeps it, and no other session of the account can spend it.
  await enforceLimit(deps.kv, `passkey-register:${session.handle}`, REGISTER_OPTIONS_PER_HOUR, HOUR);
  const user = await deps.repo.findUserById(session.userId);
  if (!user) throw new AuthError("invalid_credentials", 401);
  await checkBounds(deps, user.id);
  // 32 random bytes, never the account id, set once: a registration racing this one reads the same bytes back.
  const userId = user.webauthnUserId ?? (await deps.repo.ensureWebauthnUserId(user.id, randomBytes(32)));
  if (!userId) throw new AuthError("invalid_credentials", 401);
  const held = await deps.repo.listPasskeys(user.id);
  const challenge = issueChallenge(challengeKey(deps.config.authHmacKey), "register", deps.now(), session.handle);
  const options = await registrationOptions({
    rp: { id: deps.config.webauthn.rpId, name: deps.config.webauthn.rpName },
    // The label goes to the password manager and nowhere else: korbat keeps nothing of it.
    user: { id: userId, name: input.label, displayName: input.label },
    exclude: held.map((p) => ({ id: p.credentialId, transports: p.transports })),
    challenge,
  });
  return { options };
}

/**
 * Stores the passkey the browser created (1c design, section 7.3). The challenge is read from the response, checked
 * against this session's handle and spent before anything else runs, so it stays spent whatever happens next; it was
 * issued to a strong-fresh session and bound to it, so no second freshness check is needed and a ceremony that outlasts
 * the window still completes. The row and its passkey_added event land in one transaction that checks both bounds
 * again. The session's factors do not change: adding a passkey proves nothing about the session. Then the owner is told,
 * with a one-shot link that runs the lockdown for 7 days, tied to the address it goes to.
 */
export async function registerVerify(deps: AuthDeps, session: Session, input: PasskeyRegisterVerifyRequest): Promise<{ passkey: PasskeyView }> {
  const now = deps.now();
  const challenge = readResponseChallenge(input.response);
  readChallenge(challengeKey(deps.config.authHmacKey), challenge, "register", now, session.handle);
  await spendChallenge(deps.kv, challenge, now);
  const verified = await verifyRegistration({ response: input.response, expectedChallenge: challenge, origins: deps.config.webauthn.origins, rpId: deps.config.webauthn.rpId });
  const user = await deps.repo.findUserById(session.userId);
  if (!user) throw new AuthError("invalid_credentials", 401);
  const device = await deps.repo.findDeviceById(session.deviceId);
  const name = input.name ?? defaultName(device?.platform);
  let outcome: AddPasskeyOutcome;
  try {
    outcome = await deps.repo.addPasskey(
      {
        userId: user.id,
        credentialId: verified.credentialId,
        publicKey: verified.publicKey,
        counter: verified.counter,
        transports: verified.transports,
        aaguid: verified.aaguid,
        backupEligible: verified.backupEligible,
        backedUp: verified.backedUp,
        uvInitialized: verified.userVerified,
        createdDeviceId: session.deviceId,
        // From the flows' clock, like password_changed_at: the lockdown compares it with flow times.
        createdAt: now,
        name,
      },
      LIMITS,
    );
  } catch (err) {
    // A credential id korbat already holds, whoever's it is: the authenticator answered for a key that is not new.
    if (isUniqueViolation(err)) throw new AuthError("passkey_invalid", 401);
    throw err;
  }
  if (!outcome.ok) {
    if (outcome.reason === "gone") throw new AuthError("invalid_credentials", 401);
    throw limitReached(outcome);
  }
  const passkey = outcome.passkey;
  // After the commit, and best effort as every notice is: a failed mail never undoes a registration.
  const token = randomToken();
  const link: PasskeyRemoveToken = { userId: user.id, passkeyId: passkey.id, createdAt: passkey.createdAt.getTime(), sentTo: emailHash(deps.config.authHmacKey, user.email) };
  await deps.kv.set(passkeyRemoveKey(token), JSON.stringify(link), PASSKEY_REMOVE_TTL_MS);
  await notifyAccount(deps, user.email, "passkey_added", {
    name,
    deviceLabel: device?.label ?? "Unknown device",
    time: mailTime(now),
    removeUrl: `${deps.config.appOrigin}/passkey-remove/${token}`,
  });
  return { passkey: view(passkey, device?.label ?? null, session, now) };
}

/** The account's passkeys for the Security screen, newest first (1c design, section 7.5). */
export async function listPasskeys(deps: AuthDeps, session: Session): Promise<PasskeyListResponse> {
  const now = deps.now();
  const rows = await deps.repo.listPasskeys(session.userId);
  return { passkeys: rows.map((row) => view(row, row.createdOn, session, now)) };
}

/** Renames one passkey of the session's account; another account's and an unknown one are not told apart. Thirty an hour per account. */
export async function renamePasskey(deps: AuthDeps, session: Session, id: string, input: PasskeyRenameRequest): Promise<{ passkey: PasskeyView }> {
  await enforceLimit(deps.kv, `passkey-rename:${session.userId}`, RENAMES_PER_HOUR, HOUR);
  if (!(await deps.repo.renamePasskey(id, session.userId, input.name))) throw new AuthError("passkey_not_found", 404);
  const row = await deps.repo.findPasskey(id, session.userId);
  if (!row) throw new AuthError("passkey_not_found", 404);
  return { passkey: view(row, row.createdOn, session, deps.now()) };
}

/**
 * Removes one passkey of the session's account, the last one too (email stays the recovery root), records it and tells
 * the owner. Needs level 2 on an account with TOTP (the route checks as well). The sessions the passkey started keep
 * running: the owner removed a credential, nothing more.
 */
export async function removePasskey(deps: AuthDeps, session: Session, id: string): Promise<void> {
  requireFresh(deps, session);
  await enforceLimit(deps.kv, `passkey-remove:${session.userId}`, REMOVALS_PER_HOUR, HOUR);
  const removed = await deps.repo.deletePasskey(id, session.userId);
  if (!removed) throw new AuthError("passkey_not_found", 404);
  await deps.repo.appendEvent({ userId: session.userId, type: "passkey_removed", deviceId: session.deviceId, metadata: { passkeyId: id, via: "settings" } });
  const user = await deps.repo.findUserById(session.userId);
  if (user) await notifyAccount(deps, user.email, "passkey_removed", { name: removed.name, time: mailTime(deps.now()) });
}

/**
 * "This wasn't me" on a passkey of the last 7 days, the ones the Security list offers it on (1c design, section 7.5):
 * the lockdown anchored at the passkey's creation, naming it, recorded with this session's device. Level 1 is enough,
 * on an account with TOTP too: whoever re-enrolled it from a stolen session holds level 2, and the owner may not.
 */
export async function notMine(deps: AuthDeps, session: Session, id: string, ctx: RequestContext): Promise<void> {
  requireFresh(deps, session, 1);
  await enforceLimit(deps.kv, `passkey-not-mine:${session.userId}`, NOT_MINE_PER_DAY, DAY);
  const passkey = await deps.repo.findPasskey(id, session.userId);
  // An older passkey, another account's and an unknown one are not told apart.
  if (!passkey || !isNew(passkey.createdAt, deps.now())) throw new AuthError("passkey_not_found", 404);
  await lockdown(deps, {
    userId: session.userId,
    anchor: passkey.createdAt,
    passkeyIds: [passkey.id],
    caller: { type: "passkey_removed", deviceId: session.deviceId, metadata: { passkeyId: passkey.id, via: "not_mine" } },
    ctx,
  });
}

/**
 * The remove link from the passkey_added notice, which needs no session: the link is the credential, and works once.
 * The lockdown runs anchored at the passkey's creation and names it, so the link works whether or not the passkey is
 * still there (1c design, section 7.6). It does nothing but refuse when the account is gone or its address is no longer
 * the one the notice went to: a link mailed to an attacker's address dies when the owner's is restored.
 */
export async function removeByLink(deps: AuthDeps, input: PasskeyRemoveLinkRequest, ctx: RequestContext): Promise<void> {
  await enforceLimit(deps.kv, `passkey-remove-link:ip:${ctx.ipHash}`, REMOVE_LINKS_PER_IP_PER_HOUR, HOUR);
  // Taken, not read: two requests with the same link cannot both act on it.
  const raw = await deps.kv.take(passkeyRemoveKey(input.token));
  if (!raw) throw new AuthError("invalid_code", 400, LINK_GONE);
  const link = JSON.parse(raw) as PasskeyRemoveToken;
  const user = await deps.repo.findUserById(link.userId);
  if (!user) throw new AuthError("invalid_code", 400, LINK_GONE);
  if (link.sentTo !== emailHash(deps.config.authHmacKey, user.email)) throw new AuthError("invalid_code", 400, LINK_GONE);
  await lockdown(deps, {
    userId: user.id,
    anchor: new Date(link.createdAt),
    passkeyIds: [link.passkeyId],
    caller: { type: "passkey_removed", metadata: { passkeyId: link.passkeyId, via: "link" } },
    ctx,
  });
}

/**
 * Records a verified passkey's use (1c design, sections 2, 7.2 and 7.4): the counter, the use time and the current backup
 * state in one conditional update. When it matches no row after a signature has checked, the counter did not move forward,
 * or a concurrent use took the same step: the passkey is marked suspect, the regression recorded, the owner told best
 * effort, and the attempt refused. A passkey already suspect is caught by the caller before this runs, so this only ever
 * suspends a fresh regression.
 */
async function recordPasskeyUse(deps: AuthDeps, passkey: Pick<PasskeyRow, "id" | "userId" | "name">, email: string, verified: VerifiedAuthentication, now: Date): Promise<void> {
  if (await deps.repo.claimPasskeyUse(passkey.id, verified.newCounter, verified.backedUp, now)) return;
  await deps.repo.suspectPasskey(passkey.id, now);
  await deps.repo.appendEvent({ userId: passkey.userId, type: "passkey_counter_regression", metadata: { passkeyId: passkey.id } });
  await notifyAccount(deps, email, "passkey_suspect", { name: passkey.name });
  throw new AuthError("passkey_invalid", 401);
}

/** The factor a verified assertion proves: two factors only when the authenticator verified the user and the passkey was registered with UV. */
function passkeyFactor(verified: VerifiedAuthentication, passkey: Pick<PasskeyRow, "uvInitialized">): FactorKind {
  return verified.userVerified && passkey.uvInitialized ? "passkey_uv" : "passkey";
}

/**
 * Options for a passkey sign-in (1c design, section 7.4): an empty allow list, so the options name no account and the
 * browser offers every passkey it holds for the relying party, and a sign-in challenge with no session binding. Handing
 * them out stores nothing beyond the per-IP counter, so it cannot fill the key-value store. Thirty per IP per 15 minutes.
 */
export async function signInOptions(deps: AuthDeps, ctx: RequestContext): Promise<{ options: PublicKeyCredentialRequestOptionsJSON }> {
  await enforceLimit(deps.kv, `passkey-signin-options:ip:${ctx.ipHash}`, SIGNIN_OPTIONS_PER_IP, SIGNIN_WINDOW_MS);
  const challenge = issueChallenge(challengeKey(deps.config.authHmacKey), "signin", deps.now());
  const options = await authenticationOptions({ rpId: deps.config.webauthn.rpId, allow: [], challenge });
  return { options };
}

/**
 * Verifies a passkey sign-in (1c design, section 7.4). The challenge is read from the response, checked with no session
 * binding and spent before anything else runs, so a forged, foreign or spent one never reaches the library. The passkey is
 * found by its credential id and its account read: an unknown credential, and a deleted or purged account, are alike
 * passkey_invalid, as is a user handle the response carries that is not this account's. Only after the signature checks is
 * a suspect passkey passkey_suspended, and only then does the counter write run (a counter that did not move forward
 * suspends the passkey and refuses); the factor is passkey_uv only when the authenticator verified the user and the passkey
 * was registered with UV. A sign-in from a device the account has not used is counted, and only after a verified signature,
 * so nobody but the passkey's holder can spend the new-device allowance. Then, on an account with TOTP, a one-factor
 * passkey (and every staff sign-in) goes to the TOTP step with an MFA ticket; otherwise a session is issued directly, with
 * the new-device alert whose not-me link names the passkey. There is no account lockout.
 */
export async function signInVerify(deps: AuthDeps, input: PasskeySignInVerifyRequest, ctx: RequestContext): Promise<SignedIn | MfaPending> {
  await enforceLimit(deps.kv, `passkey-signin:ip:${ctx.ipHash}`, SIGNIN_VERIFY_PER_IP, SIGNIN_WINDOW_MS);
  const now = deps.now();
  const challenge = readResponseChallenge(input.response);
  readChallenge(challengeKey(deps.config.authHmacKey), challenge, "signin", now);
  await spendChallenge(deps.kv, challenge, now);

  const passkey = await deps.repo.findPasskeyByCredentialId(input.response.id);
  if (!passkey) throw new AuthError("passkey_invalid", 401);
  const user = await deps.repo.findUserById(passkey.userId);
  // A deleted or purged account's row is gone from findUserById: its passkey signs nobody in.
  if (!user) throw new AuthError("passkey_invalid", 401);
  // A discoverable passkey returns the account's handle; when present it must be this account's, or the response is another's.
  const userHandle = input.response.response.userHandle;
  if (userHandle !== undefined && !(user.webauthnUserId !== null && Buffer.from(userHandle, "base64url").equals(user.webauthnUserId))) {
    throw new AuthError("passkey_invalid", 401);
  }

  const verified = await verifyAuthentication({
    response: input.response,
    expectedChallenge: challenge,
    origins: deps.config.webauthn.origins,
    rpId: deps.config.webauthn.rpId,
    credential: { id: passkey.credentialId, publicKey: passkey.publicKey, transports: passkey.transports },
  });
  // After the signature only: an unsigned response can never switch a passkey off or tell one from another.
  if (passkey.suspectAt !== null) throw new AuthError("passkey_suspended", 403);
  await recordPasskeyUse(deps, passkey, user.email, verified, now);

  const factor = passkeyFactor(verified, passkey);
  const device: DeviceInput = { deviceId: input.deviceId, platform: input.platform };
  if (!(await deps.repo.findDevice(user.id, deviceHash(deps.config.authHmacKey, device.deviceId)))) {
    await enforceLimit(deps.kv, `passkey-signin-new-device:hour:${user.id}`, SIGNIN_NEW_DEVICE_PER_HOUR, HOUR);
    await enforceLimit(deps.kv, `passkey-signin-new-device:day:${user.id}`, SIGNIN_NEW_DEVICE_PER_DAY, DAY);
  }

  const proof = { factors: { [factor]: now.getTime() }, method: "passkey" as const, passkeyId: passkey.id };
  // On an account with TOTP, a one-factor passkey still needs the second factor, and staff always do (1c design, section 2).
  if (user.totpEnabledAt && (factor === "passkey" || user.role !== "user")) {
    const mfaTicket = randomToken();
    const ticket: MfaTicket = { userId: user.id, deviceId: device.deviceId, platform: device.platform, ...proof };
    await deps.kv.set(mfaTicketKey(mfaTicket), JSON.stringify(ticket), MFA_TICKET_TTL_MS);
    return { kind: "mfa", mfaTicket };
  }
  return signIn(deps, user, device, ctx, { alertNewDevice: true, ...proof });
}

/**
 * Options for re-authenticating with a passkey (1c design, section 7.2): the account's passkeys that are not suspect in the
 * allow list, so the browser offers only ones that still work, and a re-authentication challenge bound to this session's
 * handle, which no other session of the account can answer.
 */
export async function reauthOptions(deps: AuthDeps, session: Session): Promise<{ options: PublicKeyCredentialRequestOptionsJSON }> {
  const held = await deps.repo.listPasskeys(session.userId);
  const allow = held.filter((p) => p.suspectAt === null).map((p) => ({ id: p.credentialId, transports: p.transports }));
  const challenge = issueChallenge(challengeKey(deps.config.authHmacKey), "reauth", deps.now(), session.handle);
  const options = await authenticationOptions({ rpId: deps.config.webauthn.rpId, allow, challenge });
  return { options };
}

/**
 * The passkey method of the re-authentication flow (1c design, section 7.2), run from flows/reauth.ts so the buckets,
 * reauth_at, the rotation and the answer stay that flow's. The challenge is read from the response, checked against this
 * session's handle and spent first; the passkey is looked up with the session's user, so another account's and an unknown
 * one are alike passkey_invalid and neither touches a passkey's counter; after the signature checks, a suspect passkey is
 * passkey_suspended, and the counter write applies. Answers the factor proven, passkey_uv or passkey.
 */
export async function reauthenticatePasskey(deps: AuthDeps, session: Session, user: UserRow, response: AuthenticationResponseJSON, now: Date): Promise<FactorKind> {
  const challenge = readResponseChallenge(response);
  readChallenge(challengeKey(deps.config.authHmacKey), challenge, "reauth", now, session.handle);
  await spendChallenge(deps.kv, challenge, now);
  const passkey = await deps.repo.findPasskeyByCredential(response.id, session.userId);
  if (!passkey) throw new AuthError("passkey_invalid", 401);
  const verified = await verifyAuthentication({
    response,
    expectedChallenge: challenge,
    origins: deps.config.webauthn.origins,
    rpId: deps.config.webauthn.rpId,
    credential: { id: passkey.credentialId, publicKey: passkey.publicKey, transports: passkey.transports },
  });
  if (passkey.suspectAt !== null) throw new AuthError("passkey_suspended", 403);
  await recordPasskeyUse(deps, passkey, user.email, verified, now);
  return passkeyFactor(verified, passkey);
}
```

### Replace `apps/api/src/auth/repo.ts` (whole file)

```ts
import { and, desc, eq, getTableColumns, gt, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { authEventType, authEvents, devices, emailCodePurpose, emailCodes, passkeys, sessions, userRole, users, type Db } from "@korbat/db";

/**
 * Every SQL statement the auth module runs. It receives only the korbat_auth pool and touches only
 * tables in the `auth` schema. Single-use and replay rules are enforced with conditional updates so
 * two concurrent requests cannot both succeed.
 */

export type UserRow = typeof users.$inferSelect;
export type DeviceRow = typeof devices.$inferSelect;
export type EmailCodeRow = typeof emailCodes.$inferSelect;
export type AuthEventType = (typeof authEventType.enumValues)[number];
export type EmailCodePurpose = (typeof emailCodePurpose.enumValues)[number];
export type UserRole = (typeof userRole.enumValues)[number];
export type PasskeyRow = typeof passkeys.$inferSelect;
/** A passkey with the label of the device that added it, null once that device is gone. */
export type PasskeyListRow = PasskeyRow & { createdOn: string | null };
/** What a registration stores of a verified passkey; the id, the last use and the suspicion are the row's own. */
export type NewPasskey = Omit<PasskeyRow, "id" | "lastUsedAt" | "suspectAt">;

/** The per-account bounds a registration checks in its transaction (1c design, section 2): at most `passkeys` at a time, and `additions` within `windowMs`. */
export interface PasskeyLimits {
  passkeys: number;
  additions: number;
  windowMs: number;
}

/** What addPasskey answers: the row it inserted; which bound refused it, with the seconds until the day has a slot again; or that the account is gone. */
export type AddPasskeyOutcome =
  | { ok: true; passkey: PasskeyRow }
  | { ok: false; reason: "gone" }
  | { ok: false; reason: "cap" }
  | { ok: false; reason: "daily"; retryAfterSeconds: number };

export interface ActiveSessionRow {
  id: string;
  userId: string;
  deviceId: string;
  role: UserRole;
  onboardedAt: Date | null;
  totpEnabledAt: Date | null;
  reauthAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  /** The session's id for life, which a rotation keeps. */
  handle: string;
  /** The factors proven, kind to epoch milliseconds; empty for a session from before migration 0010. */
  factors: Record<string, number>;
  passkeyId: string | null;
}

export interface SessionListRow {
  id: string;
  deviceLabel: string | null;
  platform: string;
  createdAt: Date;
  lastUsedAt: Date;
}

export function createAuthRepo(db: Db) {
  return {
    // ------------------------------------------------------------ users

    async findUserByEmail(email: string): Promise<UserRow | undefined> {
      const [row] = await db
        .select()
        .from(users)
        .where(and(sql`lower(${users.email}) = lower(${email})`, isNull(users.deletedAt)))
        .limit(1);
      return row;
    },

    async findUserById(id: string): Promise<UserRow | undefined> {
      const [row] = await db
        .select()
        .from(users)
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .limit(1);
      return row;
    },

    /** The email is already verified (the user proved it with a code) and the age check has passed. */
    async createUser(input: { email: string; termsVersion: string; now: Date }): Promise<UserRow> {
      const [row] = await db
        .insert(users)
        .values({
          email: input.email,
          emailVerifiedAt: input.now,
          ageConfirmedAt: input.now,
          termsVersion: input.termsVersion,
          termsAcceptedAt: input.now,
        })
        .returning();
      return row!;
    },

    async markOnboarded(userId: string, now: Date): Promise<void> {
      await db.update(users).set({ onboardedAt: now }).where(eq(users.id, userId));
    },

    /**
     * Moves the account to an address its owner just proved with a code, so it is verified as of now.
     * When another row holds the address, in any case, the unique index on lower(email) raises the
     * driver's unique violation; the flow reports that as email_in_use.
     */
    async changeEmail(userId: string, email: string, now: Date): Promise<void> {
      await db.update(users).set({ email, emailVerifiedAt: now }).where(eq(users.id, userId));
    },

    /**
     * The keyed hash of the phone number behind the verified badge, or null to drop it. When another row
     * holds the same hash, the partial unique index on phone_hash raises the driver's unique violation;
     * the flow reports that as phone_in_use.
     */
    async setPhoneHash(userId: string, phoneHash: string | null): Promise<void> {
      await db.update(users).set({ phoneHash }).where(eq(users.id, userId));
    },

    /** Setting or clearing a password also clears any password lockout. */
    async setPasswordHash(userId: string, passwordHash: string | null, now: Date): Promise<void> {
      await db
        .update(users)
        .set({ passwordHash, passwordChangedAt: now, failedLogins: 0, lockedUntil: null })
        .where(eq(users.id, userId));
    },

    /** Replaces the hash only, after a sign-in verified the password against older parameters. */
    async replacePasswordHash(userId: string, passwordHash: string): Promise<void> {
      await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
    },

    async setPasswordFailures(userId: string, failedLogins: number, lockedUntil: Date | null): Promise<void> {
      await db.update(users).set({ failedLogins, lockedUntil }).where(eq(users.id, userId));
    },

    async enableTotp(userId: string, input: { secretEnc: string; recoveryCodesHash: string[]; now: Date }): Promise<void> {
      await db
        .update(users)
        .set({ totpSecretEnc: input.secretEnc, totpEnabledAt: input.now, totpLastStep: null, recoveryCodesHash: input.recoveryCodesHash })
        .where(eq(users.id, userId));
    },

    async disableTotp(userId: string): Promise<void> {
      await db
        .update(users)
        .set({ totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodesHash: [] })
        .where(eq(users.id, userId));
    },

    /** The same secret re-encrypted with the current key; nothing else about MFA changes. */
    async setTotpSecretEnc(userId: string, totpSecretEnc: string): Promise<void> {
      await db.update(users).set({ totpSecretEnc }).where(eq(users.id, userId));
    },

    async setRecoveryCodes(userId: string, recoveryCodesHash: string[]): Promise<void> {
      await db.update(users).set({ recoveryCodesHash }).where(eq(users.id, userId));
    },

    /** Claims a TOTP time step. False when this step or a later one was already used. */
    async claimTotpStep(userId: string, step: number): Promise<boolean> {
      const rows = await db
        .update(users)
        .set({ totpLastStep: step })
        .where(and(eq(users.id, userId), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))))
        .returning({ id: users.id });
      return rows.length === 1;
    },

    /** Removes one recovery-code hash. False when it is not (or no longer) present. */
    async consumeRecoveryCodeHash(userId: string, codeHash: string): Promise<boolean> {
      const rows = await db
        .update(users)
        .set({ recoveryCodesHash: sql`array_remove(${users.recoveryCodesHash}, ${codeHash})` })
        .where(and(eq(users.id, userId), sql`${codeHash} = ANY(${users.recoveryCodesHash})`))
        .returning({ id: users.id });
      return rows.length === 1;
    },

    async setRole(userId: string, role: UserRole): Promise<void> {
      await db.update(users).set({ role }).where(eq(users.id, userId));
    },

    // ------------------------------------------------------------ deletion

    /**
     * Marks the row deleted and nothing else: from now on every lookup above treats it as absent. Once only; a
     * later call changes nothing. A deletion goes through takeDown; this is the state a take-down that stopped
     * after the mark would leave, which finishTakeDown completes.
     */
    async markDeleted(userId: string, now: Date): Promise<void> {
      await db.update(users).set({ deletedAt: now }).where(and(eq(users.id, userId), isNull(users.deletedAt)));
    },

    /**
     * Step 1 of a deletion (1b design, section 7.6) in one transaction: the row is marked deleted, every live
     * session revoked, every device and code deleted and the account_deleted event appended. Either all of it
     * lands or none of it does, so a failure leaves a live account with its sessions, never a deleted one with
     * sessions and devices that nothing would remove. Answers the ids of the sessions it revoked, for the cache
     * tombstones, which are not the database's to write.
     */
    async takeDown(userId: string, now: Date, deviceId: string | null): Promise<string[]> {
      return db.transaction(async (tx) => {
        await tx.update(users).set({ deletedAt: now }).where(and(eq(users.id, userId), isNull(users.deletedAt)));
        const revoked = await takeDownRows(tx, userId, now);
        await tx.insert(authEvents).values({ userId, type: "account_deleted", deviceId, metadata: {} });
        return revoked;
      });
    },

    /**
     * The rows of step 1 again, for a row marked deleted and not purged yet: a take-down that stopped after the
     * mark, or a session that a sign-in already past its lookup created after it. Nothing for a live or a purged
     * row. The event is not appended again: the confirmation that recorded it is the only one there was.
     */
    async finishTakeDown(userId: string, now: Date): Promise<string[]> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, userId), isNotNull(users.deletedAt), isNull(users.purgedAt)));
        return row ? takeDownRows(tx, userId, now) : [];
      });
    },

    /** Deleted accounts whose row the purge has not anonymised yet, oldest deletion first, at most 100 a round. */
    async pendingPurges(): Promise<string[]> {
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(and(isNotNull(users.deletedAt), isNull(users.purgedAt)))
        .orderBy(users.deletedAt, users.id)
        .limit(100);
      return rows.map((r) => r.id);
    },

    /**
     * The last step of a deletion: the address becomes deleted:<id> (unique, and never a real address),
     * every credential and personal fact is cleared, and purged_at says it is done. Only a deleted row
     * not purged yet is written, so a second call, or a call for a live account, changes nothing.
     */
    async finishPurge(userId: string, now: Date): Promise<void> {
      await db
        .update(users)
        .set({
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
          purgedAt: now,
        })
        .where(and(eq(users.id, userId), isNotNull(users.deletedAt), isNull(users.purgedAt)));
    },

    // ------------------------------------------------------------ email codes

    async createEmailCode(input: {
      flowId: string;
      email: string;
      userId: string | null;
      purpose: EmailCodePurpose;
      codeHash: string;
      expiresAt: Date;
      ipHash: string | null;
    }): Promise<void> {
      await db.insert(emailCodes).values(input);
    },

    async findEmailCode(flowId: string): Promise<EmailCodeRow | undefined> {
      const [row] = await db.select().from(emailCodes).where(eq(emailCodes.flowId, flowId)).limit(1);
      return row;
    },

    /** Increments the attempt counter atomically and returns the new value. */
    async addCodeAttempt(id: string): Promise<number> {
      const [row] = await db
        .update(emailCodes)
        .set({ attempts: sql`${emailCodes.attempts} + 1` })
        .where(eq(emailCodes.id, id))
        .returning({ attempts: emailCodes.attempts });
      return row?.attempts ?? Number.MAX_SAFE_INTEGER;
    },

    /** Marks a code used. False when it was already used, so a code works exactly once. */
    async consumeEmailCode(id: string, now: Date): Promise<boolean> {
      const rows = await db
        .update(emailCodes)
        .set({ consumedAt: now })
        .where(and(eq(emailCodes.id, id), isNull(emailCodes.consumedAt)))
        .returning({ id: emailCodes.id });
      return rows.length === 1;
    },

    // ------------------------------------------------------------ devices

    async findDevice(userId: string, deviceHash: string): Promise<DeviceRow | undefined> {
      const [row] = await db
        .select()
        .from(devices)
        .where(and(eq(devices.userId, userId), eq(devices.deviceHash, deviceHash), isNull(devices.revokedAt)))
        .limit(1);
      return row;
    },

    /** The device by its row id, revoked or not: a session's device, whose platform names a passkey and whose label the passkey notices carry. */
    async findDeviceById(id: string): Promise<DeviceRow | undefined> {
      const [row] = await db.select().from(devices).where(eq(devices.id, id)).limit(1);
      return row;
    },

    async createDevice(input: { userId: string; deviceHash: string; label: string; platform: string; ipHash: string | null }): Promise<DeviceRow> {
      const [row] = await db.insert(devices).values(input).returning();
      return row!;
    },

    async touchDevice(id: string, ipHash: string | null, now: Date): Promise<void> {
      await db.update(devices).set({ lastSeenAt: now, ipHash }).where(eq(devices.id, id));
    },

    /** A revoked device no longer carries live sessions and counts as new at its next sign-in. */
    async revokeDevice(id: string, now: Date): Promise<void> {
      await db.update(devices).set({ revokedAt: now }).where(and(eq(devices.id, id), isNull(devices.revokedAt)));
    },

    /** Every device of the user, as revokeDevice revokes one: the next sign-in on any of them counts as a new device. */
    async revokeDevices(userId: string, now: Date): Promise<void> {
      await db.update(devices).set({ revokedAt: now }).where(and(eq(devices.userId, userId), isNull(devices.revokedAt)));
    },

    /** The user's devices that are not revoked, oldest first, for the data export; a revoked one stands for nothing of the account's any more. */
    async listDevices(userId: string): Promise<{ label: string | null; platform: string; firstSeenAt: Date; lastSeenAt: Date }[]> {
      return db
        .select({ label: devices.label, platform: devices.platform, firstSeenAt: devices.firstSeenAt, lastSeenAt: devices.lastSeenAt })
        .from(devices)
        .where(and(eq(devices.userId, userId), isNull(devices.revokedAt)))
        .orderBy(devices.firstSeenAt, devices.id);
    },

    // ------------------------------------------------------------ sessions

    /**
     * A new session with the factors its sign-in proved (kind to epoch milliseconds from the flows' clock) and the passkey
     * that started it, if one did. The reauth time is the latest of the factors, which is what freshness is read from. A row
     * without factors, as migration 0010 left the sessions from before it, re-authenticates before its next sensitive action.
     */
    async createSession(input: {
      id: string;
      userId: string;
      deviceId: string;
      now: Date;
      expiresAt: Date;
      absoluteExpiresAt: Date;
      factors?: Record<string, number>;
      passkeyId?: string | null;
    }): Promise<void> {
      const factors = input.factors ?? {};
      const times = Object.values(factors);
      await db.insert(sessions).values({
        id: input.id,
        userId: input.userId,
        deviceId: input.deviceId,
        createdAt: input.now,
        lastUsedAt: input.now,
        reauthAt: times.length > 0 ? new Date(Math.max(...times)) : input.now,
        expiresAt: input.expiresAt,
        absoluteExpiresAt: input.absoluteExpiresAt,
        factors,
        passkeyId: input.passkeyId ?? null,
      });
    },

    /** A session counts only when neither it, its device nor its user is revoked, deleted or expired. */
    async findActiveSession(id: string, now: Date): Promise<ActiveSessionRow | undefined> {
      const [row] = await db
        .select({
          id: sessions.id,
          userId: sessions.userId,
          deviceId: sessions.deviceId,
          role: users.role,
          onboardedAt: users.onboardedAt,
          totpEnabledAt: users.totpEnabledAt,
          reauthAt: sessions.reauthAt,
          lastUsedAt: sessions.lastUsedAt,
          expiresAt: sessions.expiresAt,
          absoluteExpiresAt: sessions.absoluteExpiresAt,
          handle: sessions.handle,
          factors: sessions.factors,
          passkeyId: sessions.passkeyId,
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .innerJoin(devices, eq(devices.id, sessions.deviceId))
        .where(
          and(
            eq(sessions.id, id),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, now),
            gt(sessions.absoluteExpiresAt, now),
            isNull(users.deletedAt),
            isNull(devices.revokedAt),
          ),
        )
        .limit(1);
      return row;
    },

    async slideSession(id: string, expiresAt: Date, now: Date): Promise<void> {
      await db.update(sessions).set({ expiresAt, lastUsedAt: now }).where(eq(sessions.id, id));
    },

    /**
     * Records a factor the session proved at `at`: the kind's time is set or replaced, and reauth_at, the latest of
     * them, follows the write. The flows always pass their clock's now.
     */
    async writeFactor(id: string, kind: string, at: Date): Promise<void> {
      await db
        .update(sessions)
        .set({ factors: sql`${sessions.factors} || ${JSON.stringify({ [kind]: at.getTime() })}::jsonb`, reauthAt: at })
        .where(eq(sessions.id, id));
    },

    /**
     * Replaces the session's id, the token's hash, and nothing else, for a live session only: the handle, factors, reauth
     * time, passkey, device and expiries stay. False when the session is revoked or gone, so a rotation never revives one.
     * Nothing references sessions.id, so the primary key changes in place.
     */
    async rotateSession(id: string, newId: string): Promise<boolean> {
      const rows = await db
        .update(sessions)
        .set({ id: newId })
        .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      return rows.length === 1;
    },

    /** Revokes one session of this user. False when it does not belong to the user or is already revoked. */
    async revokeSession(id: string, userId: string, now: Date): Promise<boolean> {
      const rows = await db
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.id, id), eq(sessions.userId, userId), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      return rows.length === 1;
    },

    /** Revokes every live session of the user and returns their ids (for cache invalidation). */
    async revokeAllSessions(userId: string, now: Date): Promise<string[]> {
      const rows = await db
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      return rows.map((r) => r.id);
    },

    async listActiveSessions(userId: string, now: Date): Promise<SessionListRow[]> {
      return db
        .select({
          id: sessions.id,
          deviceLabel: devices.label,
          platform: devices.platform,
          createdAt: sessions.createdAt,
          lastUsedAt: sessions.lastUsedAt,
        })
        .from(sessions)
        .innerJoin(devices, eq(devices.id, sessions.deviceId))
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, now), gt(sessions.absoluteExpiresAt, now)))
        .orderBy(desc(sessions.lastUsedAt));
    },

    // ------------------------------------------------------------ passkeys

    /**
     * The account's WebAuthn user handle, set to `candidate` when there is none yet (1c design, section 6): a
     * compare-and-set in one statement, so two registrations at once end with the same handle, whichever wrote it.
     * Undefined for an account that is gone.
     */
    async ensureWebauthnUserId(userId: string, candidate: Buffer): Promise<Buffer | undefined> {
      const [row] = await db
        .update(users)
        .set({ webauthnUserId: sql`coalesce(${users.webauthnUserId}, ${candidate})` })
        .where(and(eq(users.id, userId), isNull(users.deletedAt)))
        .returning({ webauthnUserId: users.webauthnUserId });
      return row?.webauthnUserId ?? undefined;
    },

    async countPasskeys(userId: string): Promise<number> {
      const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(passkeys).where(eq(passkeys.userId, userId));
      return row?.count ?? 0;
    },

    /** The account's passkeys newest first, each with the label of the device that added it, for the Security list and the options' exclusions. */
    async listPasskeys(userId: string): Promise<PasskeyListRow[]> {
      return db
        .select({ ...getTableColumns(passkeys), createdOn: devices.label })
        .from(passkeys)
        .leftJoin(devices, eq(devices.id, passkeys.createdDeviceId))
        .where(eq(passkeys.userId, userId))
        .orderBy(desc(passkeys.createdAt), desc(passkeys.id));
    },

    /** One passkey of the account, with its device's label. Undefined when it is another account's or gone, which the flows do not tell apart. */
    async findPasskey(id: string, userId: string): Promise<PasskeyListRow | undefined> {
      const [row] = await db
        .select({ ...getTableColumns(passkeys), createdOn: devices.label })
        .from(passkeys)
        .leftJoin(devices, eq(devices.id, passkeys.createdDeviceId))
        .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
        .limit(1);
      return row;
    },

    /**
     * The passkey a sign-in's credential id names, whichever account it belongs to (1c design, section 7.4): the assertion
     * says nothing about the account, so the flow finds the owner from here. Undefined for an unknown credential; the flow
     * then reads the owner and refuses a deleted one, so a gone account never signs in.
     */
    async findPasskeyByCredentialId(credentialId: string): Promise<PasskeyRow | undefined> {
      const [row] = await db.select().from(passkeys).where(eq(passkeys.credentialId, credentialId)).limit(1);
      return row;
    },

    /**
     * A passkey the session's account holds, by credential id (1c design, section 7.2): the re-authentication looks it up
     * with the session's user, so another account's passkey and an unknown one are alike undefined and never re-authenticate.
     */
    async findPasskeyByCredential(credentialId: string, userId: string): Promise<PasskeyRow | undefined> {
      const [row] = await db
        .select()
        .from(passkeys)
        .where(and(eq(passkeys.credentialId, credentialId), eq(passkeys.userId, userId)))
        .limit(1);
      return row;
    },

    /**
     * Writes a verified passkey's use in one conditional update (1c design, section 2), in the pattern of claimTotpStep: the
     * new counter, the use time and the current backup state, only for a passkey that is not suspect and whose counter moved
     * forward (two zeros, as synced passkeys always send, pass repeatedly). False when it matched no row, which the flow
     * reads, after a verified signature, as a counter regression or a race lost to one.
     */
    async claimPasskeyUse(id: string, newCounter: number, backedUp: boolean, now: Date): Promise<boolean> {
      const rows = await db
        .update(passkeys)
        .set({ counter: newCounter, lastUsedAt: now, backedUp })
        .where(and(eq(passkeys.id, id), isNull(passkeys.suspectAt), sql`((${newCounter} = 0 and ${passkeys.counter} = 0) or ${newCounter} > ${passkeys.counter})`))
        .returning({ id: passkeys.id });
      return rows.length === 1;
    },

    /** Marks a passkey suspect once (1c design, section 2), so a later sign-in with it is refused; a second call changes nothing. */
    async suspectPasskey(id: string, now: Date): Promise<void> {
      await db.update(passkeys).set({ suspectAt: now }).where(and(eq(passkeys.id, id), isNull(passkeys.suspectAt)));
    },

    /** The daily bound's reading for the options step; the registration's transaction reads it again. */
    async recentPasskeyAdditions(userId: string, withinMs: number, limit: number): Promise<{ count: number; retryAfterSeconds: number }> {
      return recentPasskeyAdditions(db, userId, withinMs, limit);
    },

    /**
     * A registration's transaction (1c design, section 7.3): the user row locked `for update`, so two registrations of one
     * account run one after the other and the later one sees what the earlier committed; both bounds checked again there;
     * then the passkey and its passkey_added event, or neither. A credential id already held raises the driver's unique
     * violation, which the flow reports as passkey_invalid.
     */
    async addPasskey(input: NewPasskey, limits: PasskeyLimits): Promise<AddPasskeyOutcome> {
      return db.transaction(async (tx): Promise<AddPasskeyOutcome> => {
        const [locked] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, input.userId), isNull(users.deletedAt)))
          .for("update");
        if (!locked) return { ok: false, reason: "gone" };
        const [held] = await tx.select({ count: sql<number>`count(*)::int` }).from(passkeys).where(eq(passkeys.userId, input.userId));
        if ((held?.count ?? 0) >= limits.passkeys) return { ok: false, reason: "cap" };
        const additions = await recentPasskeyAdditions(tx, input.userId, limits.windowMs, limits.additions);
        if (additions.count >= limits.additions) return { ok: false, reason: "daily", retryAfterSeconds: additions.retryAfterSeconds };
        const [passkey] = await tx.insert(passkeys).values(input).returning();
        await tx.insert(authEvents).values({ userId: input.userId, type: "passkey_added", deviceId: input.createdDeviceId, metadata: { passkeyId: passkey!.id } });
        return { ok: true, passkey: passkey! };
      });
    },

    /** Renames one passkey of the account. False when it is another account's or gone. */
    async renamePasskey(id: string, userId: string, name: string): Promise<boolean> {
      const rows = await db
        .update(passkeys)
        .set({ name })
        .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
        .returning({ id: passkeys.id });
      return rows.length === 1;
    },

    /**
     * Removes one passkey of the account and answers its name, for the notice; undefined when it is another account's or
     * gone. The sessions it started keep running without it: the foreign key sets their passkey_id to null.
     */
    async deletePasskey(id: string, userId: string): Promise<{ name: string } | undefined> {
      const [row] = await db
        .delete(passkeys)
        .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
        .returning({ name: passkeys.name });
      return row;
    },

    /**
     * The lockdown's removal (1c design, section 7.6): the user's passkeys created at or after `since`, plus any of theirs
     * the caller names, whatever their age. Answers the ids removed, for the caller's event. A named passkey of another
     * account is not the caller's to remove and stays.
     */
    async deletePasskeys(userId: string, input: { since: Date; ids: readonly string[] }): Promise<string[]> {
      const reach = input.ids.length > 0 ? or(gte(passkeys.createdAt, input.since), inArray(passkeys.id, [...input.ids])) : gte(passkeys.createdAt, input.since);
      const rows = await db
        .delete(passkeys)
        .where(and(eq(passkeys.userId, userId), reach))
        .returning({ id: passkeys.id });
      return rows.map((row) => row.id);
    },

    // ------------------------------------------------------------ events

    async appendEvent(input: {
      userId: string | null;
      type: AuthEventType;
      deviceId?: string | null;
      ipHash?: string | null;
      metadata?: Record<string, unknown>;
    }): Promise<void> {
      await db.insert(authEvents).values({
        userId: input.userId,
        type: input.type,
        deviceId: input.deviceId ?? null,
        ipHash: input.ipHash ?? null,
        metadata: input.metadata ?? {},
      });
    },

    // ------------------------------------------------------------ retention

    /** Codes consumed or expired before `before` are of no use to anyone; they still hold an email and an ip hash. */
    async purgeEmailCodes(before: Date): Promise<number> {
      const rows = await db
        .delete(emailCodes)
        .where(or(and(sql`${emailCodes.consumedAt} is not null`, lt(emailCodes.consumedAt, before)), lt(emailCodes.expiresAt, before)))
        .returning({ id: emailCodes.id });
      return rows.length;
    },

    /** Sessions revoked or expired before `before`. Live ones are never touched. */
    async purgeSessions(before: Date): Promise<number> {
      const rows = await db
        .delete(sessions)
        .where(or(and(sql`${sessions.revokedAt} is not null`, lt(sessions.revokedAt, before)), lt(sessions.expiresAt, before), lt(sessions.absoluteExpiresAt, before)))
        .returning({ id: sessions.id });
      return rows.length;
    },

    /** The design's IP-hash purge: a device not seen since `before` keeps no address hash. */
    async purgeDeviceIpHashes(before: Date): Promise<number> {
      const rows = await db
        .update(devices)
        .set({ ipHash: null })
        .where(and(sql`${devices.ipHash} is not null`, lt(devices.lastSeenAt, before)))
        .returning({ id: devices.id });
      return rows.length;
    },

    /**
     * Events older than `days` days, through auth.purge_events (migration 0007): the table stays
     * append-only for this role, which holds no DELETE on it; the function is owned by the migrator.
     */
    async purgeEvents(days: number): Promise<number> {
      const [row] = (await db.execute(sql`select auth.purge_events(make_interval(days => ${days}::int)) as removed`)) as unknown as { removed: number }[];
      return Number(row?.removed ?? 0);
    },

    async recentEvents(userId: string, limit = 20) {
      return db
        .select({ type: authEvents.type, deviceId: authEvents.deviceId, createdAt: authEvents.createdAt })
        .from(authEvents)
        .where(eq(authEvents.userId, userId))
        .orderBy(desc(authEvents.createdAt), desc(authEvents.id))
        .limit(limit);
    },

    /** The user's own events since `since`, newest first, for the data export: their kind and time, never the metadata. */
    async eventsSince(userId: string, since: Date): Promise<{ type: AuthEventType; createdAt: Date }[]> {
      return db
        .select({ type: authEvents.type, createdAt: authEvents.createdAt })
        .from(authEvents)
        .where(and(eq(authEvents.userId, userId), gte(authEvents.createdAt, since)))
        .orderBy(desc(authEvents.createdAt), desc(authEvents.id));
    },
  };
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** What a read runs through: the pool, or a transaction that needs the read to see its own lock. */
type Querier = Pick<Db, "select">;

/**
 * The daily bound's reading (1c design, section 2): how many passkey_added events the account has within the window, at
 * most `limit` of them, and the seconds until the oldest of those is out of the window, when the day has a slot again.
 * Counted from the events, so a removal frees nothing, and by the database clock, which wrote them.
 */
async function recentPasskeyAdditions(q: Querier, userId: string, withinMs: number, limit: number): Promise<{ count: number; retryAfterSeconds: number }> {
  const window = sql`make_interval(secs => ${withinMs / 1000}::float8)`;
  const recent = q
    .select({ createdAt: authEvents.createdAt })
    .from(authEvents)
    .where(and(eq(authEvents.userId, userId), eq(authEvents.type, "passkey_added"), gt(authEvents.createdAt, sql`now() - ${window}`)))
    .orderBy(desc(authEvents.createdAt))
    .limit(limit)
    .as("recent");
  const [row] = await q
    .select({
      count: sql<number>`count(*)::int`,
      retryAfterSeconds: sql<number>`coalesce(ceil(extract(epoch from (min(${recent.createdAt}) + ${window} - now())))::int, 0)`,
    })
    .from(recent);
  return { count: row?.count ?? 0, retryAfterSeconds: row?.retryAfterSeconds ?? 0 };
}

/**
 * The rows step 1 of a deletion takes down, inside the caller's transaction: every live session is revoked
 * (its id answered, for the cache tombstones), every device is deleted, and with it by cascade every session
 * row, and every code out for the user goes, whatever its purpose, so none can complete a flow for an
 * account that is gone.
 */
async function takeDownRows(tx: Tx, userId: string, now: Date): Promise<string[]> {
  const revoked = await tx
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  await tx.delete(devices).where(eq(devices.userId, userId));
  await tx.delete(emailCodes).where(eq(emailCodes.userId, userId));
  return revoked.map((row) => row.id);
}

export type AuthRepo = ReturnType<typeof createAuthRepo>;
```

### Replace `apps/api/src/auth/routes.ts` (whole file)

```ts
import {
  BadgeStartRequest,
  BadgeVerifyRequest,
  EmailChangeStartRequest,
  EmailChangeVerifyRequest,
  EmailRevertRequest,
  EmailStartRequest,
  EmailVerifyRequest,
  MfaVerifyRequest,
  NotMeRequest,
  OnboardingHandleRequest,
  PasskeyRegisterOptionsRequest,
  PasskeyRegisterVerifyRequest,
  PasskeyRemoveLinkRequest,
  PasskeyRenameRequest,
  PasskeySignInVerifyRequest,
  PasswordSetRequest,
  PasswordSigninRequest,
  ReauthRequest,
  SignupCompleteRequest,
  TotpCodeRequest,
  TotpDisableRequest,
  type Platform,
} from "@korbat/contracts";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AppEnv } from "../env";
import { errorBody } from "../lib/errors";
import { validate } from "../lib/validate";
import { AuthError, type AuthDeps, type RequestContext } from "./context";
import { clearSessionCookies, setSessionCookies } from "./cookies";
import { listSessions, me, revokeAllSessions, revokeSession, signOut } from "./flows/account";
import { removeBadge, startBadge, verifyBadge } from "./flows/badge";
import { startEmail, verifyEmail } from "./flows/email";
import { revertEmailChange, startEmailChange, verifyEmailChange } from "./flows/email-change";
import { confirmTotp, disableTotp, regenerateRecoveryCodes, setupTotp, verifyMfa } from "./flows/mfa";
import { notMe } from "./flows/not-me";
import { passwordSignIn, setPassword } from "./flows/password";
import { reauthenticate, startReauthEmail } from "./flows/reauth";
import type { MfaPending, SignedIn } from "./flows/signin";
import { chooseHandle, completeSignup } from "./flows/signup";
import { requireFreshAuth, requireOnboarding, requireSession, requireStrongFreshAuth } from "./middleware";
import { listPasskeys, notMine, reauthOptions, registerOptions, registerVerify, removeByLink, removePasskey, renamePasskey, signInOptions, signInVerify } from "./passkeys/flows";
import type { IssuedSession, Session } from "./sessions";

/** Every `/api/auth/*` endpoint. Handlers only validate, call a flow and shape the response. */
export function authRoutes(deps: AuthDeps) {
  const r = new Hono<AppEnv>();
  const fresh = requireFreshAuth(deps);
  // Level 2 on an account with TOTP (1c design, section 10): the routes that replace or remove a credential.
  const strong = requireStrongFreshAuth(deps);

  const requestContext = (c: Context<AppEnv>): RequestContext => ({
    ipHash: c.get("clientIpHash") ?? "direct",
    userAgent: c.req.header("user-agent"),
  });
  const currentSession = (c: Context<AppEnv>): Session => c.get("session")!;

  /**
   * Browsers send Origin on state changes and the fetch metadata headers Sec-Fetch-Site and Sec-Fetch-Dest
   * on every request; native apps send none of them, and Node's own fetch sends a bare Sec-Fetch-Mode that
   * cannot be removed, which therefore does not count. A request from a browser is a web session whatever
   * the body says, so it gets cookies, never a token.
   */
  const fromBrowser = (c: Context<AppEnv>): boolean =>
    c.req.header("origin") !== undefined || c.req.header("sec-fetch-site") !== undefined || c.req.header("sec-fetch-dest") !== undefined;
  const asWeb = <T extends { platform: Platform }>(c: Context<AppEnv>, input: T): T => (fromBrowser(c) ? { ...input, platform: "web" } : input);

  /** Web: cookies only, never the token in the body. Native: the bearer token in the body, no cookies. */
  const sessionIssued = (c: Context<AppEnv>, signed: SignedIn) => {
    if (signed.platform === "web") {
      setSessionCookies(c, signed.issued.token, signed.issued.maxAgeSeconds);
      return c.json({ result: "session" as const, mustReenrollMfa: signed.mustReenrollMfa });
    }
    return c.json({ result: "session" as const, mustReenrollMfa: signed.mustReenrollMfa, token: signed.issued.token });
  };

  const firstFactor = (c: Context<AppEnv>, outcome: SignedIn | MfaPending) =>
    outcome.kind === "mfa" ? c.json({ result: "mfa_required" as const, mfaTicket: outcome.mfaTicket }) : sessionIssued(c, outcome);

  /** After a flow rotated the current session: fresh cookies for web, the new token for native. */
  const rotated = (c: Context<AppEnv>, issued: IssuedSession): { token?: string } => {
    if (c.get("authVia") === "cookie") {
      setSessionCookies(c, issued.token, issued.maxAgeSeconds);
      return {};
    }
    return { token: issued.token };
  };

  r.onError((err, c) => {
    if (err instanceof AuthError) {
      if (err.retryAfterSeconds) c.header("Retry-After", String(err.retryAfterSeconds));
      return c.json(errorBody(err.code, err.message, c.get("requestId"), err.details), err.status);
    }
    if (err instanceof HTTPException) return c.json(errorBody("invalid_request", err.message, c.get("requestId")), err.status);
    c.get("log").error({ err }, "unhandled error in auth route");
    return c.json(errorBody("internal", "Internal error", c.get("requestId")), 500);
  });

  r.post("/email/start", validate("json", EmailStartRequest), async (c) => c.json(await startEmail(deps, asWeb(c, c.req.valid("json")), requestContext(c))));

  r.post("/email/verify", validate("json", EmailVerifyRequest), async (c) => {
    const outcome = await verifyEmail(deps, c.req.valid("json"), requestContext(c));
    if (outcome.kind === "signup_required") return c.json({ result: "signup_required" as const });
    return firstFactor(c, outcome);
  });

  r.post("/signup/complete", validate("json", SignupCompleteRequest), async (c) =>
    sessionIssued(c, await completeSignup(deps, c.req.valid("json"), requestContext(c))),
  );

  r.post("/onboarding/handle", requireOnboarding, validate("json", OnboardingHandleRequest), async (c) => {
    const { profile, issued } = await chooseHandle(deps, currentSession(c), c.req.valid("json"));
    return c.json({ profile, ...rotated(c, issued) });
  });

  r.post("/email/change/start", requireSession, strong, validate("json", EmailChangeStartRequest), async (c) =>
    c.json(await startEmailChange(deps, currentSession(c), c.req.valid("json"), requestContext(c))),
  );

  r.post("/email/change/verify", requireSession, fresh, validate("json", EmailChangeVerifyRequest), async (c) =>
    c.json(await verifyEmailChange(deps, currentSession(c), c.req.valid("json"))),
  );

  // The undo link from the email_changed notice: no session, like the not-me link, since the link itself is the credential.
  r.post("/email/revert", validate("json", EmailRevertRequest), async (c) => {
    await revertEmailChange(deps, c.req.valid("json"), requestContext(c));
    return c.body(null, 204);
  });

  r.post("/badge/start", requireSession, fresh, validate("json", BadgeStartRequest), async (c) =>
    c.json(await startBadge(deps, currentSession(c), c.req.valid("json"), requestContext(c))),
  );

  r.post("/badge/verify", requireSession, fresh, validate("json", BadgeVerifyRequest), async (c) =>
    c.json(await verifyBadge(deps, currentSession(c), c.req.valid("json"))),
  );

  r.delete("/badge", requireSession, fresh, async (c) => {
    await removeBadge(deps, currentSession(c));
    return c.body(null, 204);
  });

  r.post("/password/signin", validate("json", PasswordSigninRequest), async (c) =>
    firstFactor(c, await passwordSignIn(deps, asWeb(c, c.req.valid("json")), requestContext(c))),
  );

  // Passkey sign-in (1c design, section 7.4), unauthenticated like /password/signin: the options carry an empty allow list,
  // and verify handles web and native exactly as /password/signin does (asWeb, then a session or the TOTP step).
  r.post("/passkey/signin/options", async (c) => c.json(await signInOptions(deps, requestContext(c))));

  r.post("/passkey/signin/verify", validate("json", PasskeySignInVerifyRequest), async (c) =>
    firstFactor(c, await signInVerify(deps, asWeb(c, c.req.valid("json")), requestContext(c))),
  );

  r.post("/password/set", requireSession, strong, validate("json", PasswordSetRequest), async (c) =>
    c.json(rotated(c, await setPassword(deps, currentSession(c), c.req.valid("json")))),
  );

  r.post("/mfa/verify", validate("json", MfaVerifyRequest), async (c) => sessionIssued(c, await verifyMfa(deps, c.req.valid("json"), requestContext(c))));

  r.post("/mfa/totp/setup", requireSession, strong, async (c) => c.json(await setupTotp(deps, currentSession(c))));

  // No freshness check: the pending secret its setup stored for the session is the proof, so scanning the QR code cannot run the window out.
  r.post("/mfa/totp/confirm", requireSession, validate("json", TotpCodeRequest), async (c) => {
    const { recoveryCodes, issued } = await confirmTotp(deps, currentSession(c), c.req.valid("json"));
    return c.json({ recoveryCodes, ...rotated(c, issued) });
  });

  r.post("/mfa/totp/disable", requireSession, strong, validate("json", TotpDisableRequest), async (c) => {
    await disableTotp(deps, currentSession(c));
    return c.body(null, 204);
  });

  r.post("/mfa/recovery-codes/regenerate", requireSession, strong, async (c) => c.json({ recoveryCodes: await regenerateRecoveryCodes(deps, currentSession(c)) }));

  r.post("/reauth/email/start", requireOnboarding, async (c) => c.json(await startReauthEmail(deps, currentSession(c), requestContext(c))));

  // The level reached and, after a recovery code, the call to set MFA up again; the rotated token as every rotation hands it out.
  r.post("/reauth", requireOnboarding, validate("json", ReauthRequest), async (c) => {
    const { level, issued, mustReenrollMfa } = await reauthenticate(deps, currentSession(c), c.req.valid("json"), requestContext(c));
    return c.json({ level, ...(mustReenrollMfa ? { mustReenrollMfa } : {}), ...rotated(c, issued) });
  });

  // Options for a passkey re-authentication (1c design, section 7.2): the account's usable passkeys and a challenge bound to this session.
  r.post("/reauth/passkey/options", requireOnboarding, async (c) => c.json(await reauthOptions(deps, currentSession(c))));

  r.get("/sessions", requireSession, async (c) => c.json(await listSessions(deps, currentSession(c))));

  r.delete("/sessions/:id", requireSession, fresh, validate("param", z.object({ id: z.string().regex(/^[0-9a-f]{64}$/) })), async (c) => {
    const revoked = await revokeSession(deps, currentSession(c), c.req.valid("param").id);
    return revoked ? c.body(null, 204) : c.json(errorBody("not_found", "No such session", c.get("requestId")), 404);
  });

  r.post("/sessions/revoke-all", requireSession, fresh, async (c) => {
    await revokeAllSessions(deps, currentSession(c));
    if (c.get("authVia") === "cookie") clearSessionCookies(c);
    return c.body(null, 204);
  });

  r.post("/signout", requireOnboarding, async (c) => {
    await signOut(deps, currentSession(c));
    if (c.get("authVia") === "cookie") clearSessionCookies(c);
    return c.body(null, 204);
  });

  r.post("/not-me", validate("json", NotMeRequest), async (c) => {
    await notMe(deps, c.req.valid("json"), requestContext(c));
    return c.body(null, 204);
  });

  // Passkeys (1c design, sections 7.3 and 7.5). Registration takes any signed-in session, one still choosing a handle too:
  // the options need level 2 on an account with TOTP, the verification only the challenge those options carried, which
  // is bound to the session (a ceremony that outlasts the window still completes).
  r.post("/passkeys/register/options", requireOnboarding, strong, validate("json", PasskeyRegisterOptionsRequest), async (c) =>
    c.json(await registerOptions(deps, currentSession(c), c.req.valid("json"))),
  );

  r.post("/passkeys/register/verify", requireOnboarding, validate("json", PasskeyRegisterVerifyRequest), async (c) =>
    c.json(await registerVerify(deps, currentSession(c), c.req.valid("json"))),
  );

  r.get("/passkeys", requireSession, async (c) => c.json(await listPasskeys(deps, currentSession(c))));

  r.patch("/passkeys/:id", requireSession, validate("param", z.object({ id: z.uuid() })), validate("json", PasskeyRenameRequest), async (c) =>
    c.json(await renamePasskey(deps, currentSession(c), c.req.valid("param").id, c.req.valid("json"))),
  );

  r.delete("/passkeys/:id", requireSession, strong, validate("param", z.object({ id: z.uuid() })), async (c) => {
    await removePasskey(deps, currentSession(c), c.req.valid("param").id);
    return c.body(null, 204);
  });

  // "This wasn't me" on a new passkey: the lockdown signs this session out with every other, so a web session loses its cookies here.
  r.post("/passkeys/:id/not-mine", requireSession, fresh, validate("param", z.object({ id: z.uuid() })), async (c) => {
    await notMine(deps, currentSession(c), c.req.valid("param").id, requestContext(c));
    if (c.get("authVia") === "cookie") clearSessionCookies(c);
    return c.body(null, 204);
  });

  // The remove link from the passkey_added notice: no session, like the not-me link, since the link itself is the credential.
  r.post("/passkeys/remove-link", validate("json", PasskeyRemoveLinkRequest), async (c) => {
    await removeByLink(deps, c.req.valid("json"), requestContext(c));
    return c.body(null, 204);
  });

  return r;
}

/** GET /api/me, mounted by the app behind requireOnboarding. */
export function meHandler(deps: AuthDeps) {
  return async (c: Context<AppEnv>) => c.json(await me(deps, c.get("session")!));
}
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

/**
 * Turning TOTP off takes no code (1c design, section 2): the route needs a level-2 re-authentication, which already spent
 * the current step. A code a client sends anyway is dropped.
 */
export const TotpDisableRequest = z.object({});
export type TotpDisableRequest = z.infer<typeof TotpDisableRequest>;

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

// ReauthRequest lives in passkeys.ts: its `passkey` variant needs AuthenticationResponseJSON, and having auth.ts import
// that would form a cycle (passkeys.ts already imports this file). ReauthResponse stays here, as it names no passkey type.

/**
 * What a re-authentication answers (1c design, section 7.2): the level the session holds now (2 when a second factor
 * stands beside a first within the window, or a user-verified passkey does), the rotated token for native clients (web
 * clients get fresh cookies instead), and, after a recovery code, that two-factor authentication should be set up again.
 */
export const ReauthResponse = z.object({
  level: z.union([z.literal(1), z.literal(2)]),
  token: RotatedToken,
  mustReenrollMfa: z.boolean().optional(),
});
export type ReauthResponse = z.infer<typeof ReauthResponse>;

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
    /** How many passkeys the account holds (1c design, section 7.5): above zero the app offers a passkey re-authentication, at zero it suggests adding one. */
    passkeys: z.number().int().nonnegative(),
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

### Replace `packages/contracts/src/passkeys.ts` (whole file)

```ts
import { z } from "zod";
import { DisplayName, EmailCode, OpaqueId, PasswordInput, PasswordSigninRequest, RecoveryCode, TotpCode } from "./auth";

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

/**
 * Re-authentication (1c design, section 7.2). It lives here rather than in auth.ts because its `passkey` variant carries an
 * AuthenticationResponseJSON; the password, TOTP, email and recovery variants read their fields from auth.ts. The `passkey`
 * response follows POST /api/auth/reauth/passkey/options, whose challenge is bound to the session's handle.
 */
export const ReauthRequest = z.discriminatedUnion("method", [
  z.object({ method: z.literal("password"), password: PasswordInput }),
  z.object({ method: z.literal("totp"), code: TotpCode }),
  z.object({ method: z.literal("email"), flowId: OpaqueId, code: EmailCode }),
  // A recovery code: only an account with TOTP holds any, and each works once.
  z.object({ method: z.literal("recovery"), recoveryCode: RecoveryCode }),
  z.object({ method: z.literal("passkey"), response: AuthenticationResponseJSON }),
]);
export type ReauthRequest = z.infer<typeof ReauthRequest>;
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
packages/contracts test:       Tests  88 passed (88)
packages/db test:       Tests  27 passed (27)
packages/media-protocol test:       Tests  21 passed (21)
apps/app test:       Tests  32 passed (32)
apps/worker test:       Tests  45 passed (45)
apps/api test:       Tests  414 passed | 239 skipped (653)
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
Tests  237 passed (237)
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

- `apps/api/src/auth/flows/reauth.ts`
- `apps/api/src/auth/passkeys/flows.ts`
- `apps/api/src/auth/repo.ts`
- `apps/api/src/auth/routes.ts`
- `apps/api/test/auth/flow-harness.ts`
- `apps/api/test/auth/passkey-signin.test.ts`
- `apps/api/test/integration/auth-passkey-signin.test.ts`
- `apps/api/test/integration/http-passkey-signin.test.ts`
- `packages/contracts/src/auth.ts`
- `packages/contracts/src/passkeys.ts`
- `packages/contracts/test/auth.test.ts`

## Step 9: commit

```bash
git add -A
git commit -q -m "feat(api,contracts): passkey sign-in and re-authentication: sign-in options without a session and verify (the challenge spent before the library runs, the user handle checked, a suspended passkey refused after its signature, the counter written in one conditional update and a regression suspending the passkey, recording it, mailing the owner and refusing; passkey_uv only for a user-verified assertion on a passkey registered with user verification; a new-device limit counted after the signature; the MFA ticket when the account has TOTP and the assertion lacked user verification, or the account is staff); re-authentication options and the passkey method on the re-authentication flow; ReauthRequest moves to the passkey contracts" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(api,contracts): passkey sign-in and re-authentication: sign-in options without a session and verify (the challenge spent before the library runs, the user handle checked, a suspended passkey refused after its signature, the counter written in one conditional update and a regression suspending the passkey, recording it, mailing the owner and refusing; passkey_uv only for a user-verified assertion on a passkey registered with user verification; a new-device limit counted after the signature; the MFA ticket when the account has TOTP and the assertion lacked user verification, or the account is staff); re-authentication options and the passkey method on the re-authentication flow; ReauthRequest moves to the passkey contracts`.

## Report format (mandatory)

```text
TASK 5 REPORT
Files written: <count, expected 11>
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
