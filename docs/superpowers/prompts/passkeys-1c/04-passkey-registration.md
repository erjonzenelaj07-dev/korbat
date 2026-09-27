# korbat passkeys (1c) — Task 4 of 9: Passkey registration and management: register options behind strong freshness with the cap of 10 and the bound of 5 a day, register verify with the challenge read and spent before the library runs and one transaction that re-checks both bounds under the user row's lock, the passkey_added mail with a 7-day remove link, the list with its tags, rename and delete, 'not mine' and the remove link on the lockdown, and the passkey count in /api/me

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-25 to 2026-09-27 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

This task delivers passkey registration and management on the core and the session model: register options behind strong freshness with the two bounds (10 passkeys; 5 added a day, with the wait in the refusal) and the WebAuthn user handle set once; register verify, which reads and spends the challenge before the library runs and writes the passkey and its event in one transaction that re-checks both bounds under the user row's lock, then mails the owner a 7-day one-shot remove link; the list with its tags; rename and delete; 'not mine' and the remove link, both running Task 3's lockdown; and the passkey count in /api/me. Sign-in and re-authentication with a passkey come in Task 5.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(api,contracts): session factors, strong freshness and the lockdown: every sign-in records its factors and method; freshness and the level are read from the factors; the seven credential routes need level 2 on an account with TOTP, and a refusal carries the level and the factors held; every re-authentication rotates the token in place; the re-authentication limits are keyed by the session handle and the IP hash, and a recovery code re-authenticates; TOTP setup is bound to the session handle, confirm needs no freshness of its own and disable takes an empty body; the lockdown routine (sessions, devices, password, passkeys and TOTP from the day before the anchor) stands behind the new-device not-me link and the email-change undo, which check the address the link went to; a used recovery code is mailed to the owner on both paths`.

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
python docs/superpowers/prompts/passkeys-1c/write_blocks.py docs/superpowers/prompts/passkeys-1c/04-passkey-registration.md 1
```

Expected: 6 lines starting with `wrote`, one for each file below.

### Create `apps/api/test/auth/passkey-management.test.ts`

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { AuthError } from "../../src/auth/context";
import { randomToken } from "../../src/auth/crypto";
import { me } from "../../src/auth/flows/account";
import { LOCKDOWN_LOOKBACK_MS } from "../../src/auth/flows/lockdown";
import { emailHash } from "../../src/auth/identifiers";
import { HOUR, MINUTE } from "../../src/auth/limits";
import {
  NEW_PASSKEY_MS,
  PASSKEY_ADDITIONS_PER_DAY,
  PASSKEY_CAP,
  PASSKEY_REMOVE_TTL_MS,
  listPasskeys,
  notMine,
  passkeyRemoveKey,
  registerOptions,
  registerVerify,
  removeByLink,
  removePasskey,
  renamePasskey,
  type PasskeyRemoveToken,
} from "../../src/auth/passkeys/flows";
import type { Session } from "../../src/auth/sessions";
import { memoryFlowHarness, type MemoryFlowHarness } from "./flow-harness";
import { SoftAuthenticator, ZERO_AAGUID, type CborValue, type SoftCreateInput, type SoftFlags } from "./soft-authenticator";

const DAY = 24 * HOUR;
const ORIGIN = "http://localhost:8081";
const ALL: SoftFlags = { up: true, uv: true, be: true, bs: true };
const BARE: SoftFlags = { up: true, uv: false, be: false, bs: false };
const LINK_GONE = "This link has expired or was already used.";
const CAP_MESSAGE = "You have 10 passkeys. Remove one to add another.";

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

/** A time as the passkey mails print it: the date and the minute in UTC. */
const mailTime = (at: Date) => `${at.toISOString().slice(0, 10)} ${at.toISOString().slice(11, 16)} UTC`;

/** An account with two-factor on since `enabledAt`, as the confirm step leaves it. */
function withTotp(h: MemoryFlowHarness, userId: string, enabledAt: Date) {
  Object.assign(h.users.get(userId)!, { totpSecretEnc: "v1:owner", totpEnabledAt: enabledAt, totpLastStep: 7, recoveryCodesHash: ["owner-code"] });
}

/** A session of an account with TOTP, holding the given factors, as the middleware would carry it. */
const mfaSession = (h: MemoryFlowHarness, userId: string, factors: Session["factors"]): Session => ({ ...h.session(userId, { factors }), mfaEnabled: true });

/** The options of a registration, and the browser's answer to them from the software authenticator. */
async function ceremony(h: MemoryFlowHarness, session: Session, auth: SoftAuthenticator, overrides: Partial<SoftCreateInput> & { label?: string } = {}) {
  const { label = "ada", ...create } = overrides;
  const { options } = await registerOptions(h.deps, session, { label });
  const response = auth.create({ rpId: options.rp.id!, challenge: options.challenge, origin: ORIGIN, userHandle: Buffer.from(options.user.id, "base64url"), flags: ALL, ...create });
  return { options, response };
}

/** A whole registration: the options, the browser's answer and the verification; answers the stored passkey's view. */
async function register(h: MemoryFlowHarness, session: Session, auth: SoftAuthenticator, overrides: Partial<SoftCreateInput> & { label?: string; name?: string } = {}) {
  const { name, ...rest } = overrides;
  const { response } = await ceremony(h, session, auth, rest);
  return (await registerVerify(h.deps, session, { name, response })).passkey;
}

describe("passkey registration (1c design, section 7.3)", () => {
  test("options carry the RP, the label as the user's name, a user handle set once, the account's passkeys excluded and a challenge; verify stores the passkey with its flags, records the event and answers the view", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const { options, response } = await ceremony(h, ada.session, auth, { label: "ada on the laptop", aaguid: "fbfc3007-154e-4ecc-8c0b-6e020557d7bd", counter: 3 });
    expect(options.rp).toEqual({ id: "localhost", name: "korbat" });
    expect(options.user.name).toBe("ada on the laptop");
    expect(options.user.displayName).toBe("ada on the laptop");
    expect(options.excludeCredentials).toEqual([]);
    expect(options.attestation).toBe("none");
    // The user handle: 32 random bytes, never the account id, written once and read back from then on.
    const handle = Buffer.from(options.user.id, "base64url");
    expect(handle).toHaveLength(32);
    expect(handle.toString("utf8")).not.toContain(ada.user.id);
    expect(h.users.get(ada.user.id)!.webauthnUserId).toEqual(handle);
    const again = await registerOptions(h.deps, ada.session, { label: "ada" });
    expect(again.options.user.id).toBe(options.user.id);
    expect(again.options.challenge).not.toBe(options.challenge);

    const { passkey } = await registerVerify(h.deps, ada.session, { name: "Laptop", response });
    expect(passkey).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: "Laptop",
      createdAt: h.now().toISOString(),
      lastUsedAt: null,
      synced: true,
      createdOn: "Chrome on Windows",
      current: false,
      isNew: true,
      suspended: false,
    });
    expect(h.passkeys).toEqual([
      {
        id: passkey.id,
        userId: ada.user.id,
        credentialId: response.id,
        publicKey: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
        counter: 3,
        transports: ["internal", "hybrid"],
        backedUp: true,
        name: "Laptop",
        createdAt: h.now(),
        lastUsedAt: null,
        aaguid: "fbfc3007-154e-4ecc-8c0b-6e020557d7bd",
        backupEligible: true,
        uvInitialized: true,
        createdDeviceId: ada.session.deviceId,
        suspectAt: null,
      },
    ]);
    expect(h.events).toEqual([{ userId: ada.user.id, type: "passkey_added", deviceId: ada.session.deviceId, metadata: { passkeyId: passkey.id } }]);
    // The session's factors are not touched: adding a passkey proves nothing about the session.
    expect(await h.kv.get(`sess:${ada.session.sessionId}`)).toBeNull();

    // The next options exclude the passkey, with its transports, so the same authenticator does not add another.
    const next = await registerOptions(h.deps, ada.session, { label: "ada" });
    expect(next.options.excludeCredentials).toEqual([{ id: response.id, transports: ["internal", "hybrid"], type: "public-key" }]);
  });

  test("a registration without user verification is stored as such, and the flags follow the authenticator data", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const passkey = await register(h, ada.session, new SoftAuthenticator(), { name: "Key", flags: BARE });
    expect(passkey).toMatchObject({ name: "Key", synced: false });
    expect(h.passkeys[0]).toMatchObject({ uvInitialized: false, backupEligible: false, backedUp: false, counter: 0, aaguid: ZERO_AAGUID });
  });

  test("without a name the passkey is called after the platform of the device that added it", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    expect((await register(h, ada.session, auth)).name).toBe("Passkey on the web");
    expect((await register(h, h.session(ada.user.id, { platform: "ios" }), auth)).name).toBe("Passkey on iOS");
    expect((await register(h, h.session(ada.user.id, { platform: "android" }), auth)).name).toBe("Passkey on Android");
    expect(h.passkeys.map((p) => p.name)).toEqual(["Passkey on the web", "Passkey on iOS", "Passkey on Android"]);
  });

  test("the owner is told, with a remove link that lives 7 days and names the passkey, its creation and the address it went to; a failed mail does not undo the registration", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const passkey = await register(h, ada.session, new SoftAuthenticator(), { name: "Laptop" });
    expect(h.mailer.sent).toEqual([
      {
        to: "ada@korbat.local",
        template: "passkey_added",
        data: { name: "Laptop", deviceLabel: "Chrome on Windows", time: mailTime(h.now()), removeUrl: expect.stringMatching(/^http:\/\/localhost:8081\/passkey-remove\/[A-Za-z0-9_-]{43}$/) },
      },
    ]);
    const url = h.mailer.sent[0]!.data.removeUrl!;
    const token = url.slice(url.lastIndexOf("/") + 1);
    // Stored under the token's hash only, as every link is, for 7 days.
    expect(PASSKEY_REMOVE_TTL_MS).toBe(7 * DAY);
    const stored = JSON.parse((await h.kv.get(passkeyRemoveKey(token)))!) as PasskeyRemoveToken;
    expect(stored).toEqual({ userId: ada.user.id, passkeyId: passkey.id, createdAt: h.now().getTime(), sentTo: emailHash(h.deps.config.authHmacKey, "ada@korbat.local") });
    h.advance(PASSKEY_REMOVE_TTL_MS - 1);
    expect(await h.kv.get(passkeyRemoveKey(token))).not.toBeNull();
    h.advance(1);
    expect(await h.kv.get(passkeyRemoveKey(token))).toBeNull();

    // A week on, from a session that is fresh then.
    h.mailer.failing = true;
    const second = await register(h, h.session(ada.user.id), new SoftAuthenticator(), { name: "Phone" });
    expect(h.passkeys.map((p) => p.id)).toEqual([passkey.id, second.id]);
    expect(h.mailer.sent).toHaveLength(1);
  });

  test("a challenge bound to another session's handle is refused, and a challenge answers once", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const other = h.session(ada.user.id);
    const auth = new SoftAuthenticator();
    const { response } = await ceremony(h, ada.session, auth);
    expect(await failure(registerVerify(h.deps, other, { response }))).toMatchObject({ code: "passkey_invalid", status: 401 });
    expect(h.passkeys).toEqual([]);
    // The refused try did not spend the challenge for the session it belongs to.
    const { passkey } = await registerVerify(h.deps, ada.session, { response });
    expect(h.passkeys.map((p) => p.id)).toEqual([passkey.id]);
    // The same answer again: its challenge is spent, and the credential id is known.
    expect(await failure(registerVerify(h.deps, ada.session, { response }))).toMatchObject({ code: "passkey_invalid", status: 401 });
    // A new answer to the spent challenge is refused too, whatever it carries.
    const reused = auth.create({ rpId: "localhost", challenge: JSON.parse(Buffer.from(response.response.clientDataJSON, "base64url").toString()).challenge, origin: ORIGIN, userHandle: randomBytes(32), flags: ALL });
    expect(await failure(registerVerify(h.deps, ada.session, { response: reused }))).toMatchObject({ code: "passkey_invalid", status: 401 });
    expect(h.passkeys).toHaveLength(1);
    expect(h.events).toHaveLength(1);
  });

  test("a packed attestation with a certificate chain is passkey_unsupported, and its challenge is spent all the same", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const attStmt = new Map<string | number, CborValue>([
      ["alg", -7],
      ["sig", randomBytes(70)],
      ["x5c", [randomBytes(300)]],
    ]);
    const { options, response } = await ceremony(h, ada.session, auth, { fmt: "packed", attStmt });
    expect(await failure(registerVerify(h.deps, ada.session, { response }))).toMatchObject({ code: "passkey_unsupported", status: 400 });
    expect(h.passkeys).toEqual([]);
    expect(h.mailer.sent).toEqual([]);
    const retry = auth.create({ rpId: "localhost", challenge: options.challenge, origin: ORIGIN, userHandle: Buffer.from(options.user.id, "base64url"), flags: ALL });
    expect(await failure(registerVerify(h.deps, ada.session, { response: retry }))).toMatchObject({ code: "passkey_invalid", status: 401 });
    // A self attestation passes.
    expect((await register(h, ada.session, auth, { fmt: "packed" })).isNew).toBe(true);
  });

  test("a credential id already held, by anyone, is passkey_invalid", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const bob = h.user("bob@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = randomBytes(32);
    await register(h, bob.session, auth, { credentialId });
    expect(await failure(register(h, ada.session, auth, { credentialId }))).toMatchObject({ code: "passkey_invalid", status: 401 });
    expect(h.passkeys.map((p) => p.userId)).toEqual([bob.user.id]);
  });

  test("the cap: at 10 passkeys the options are refused with the reason, and so is a verification whose options came before the tenth", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    expect(PASSKEY_CAP).toBe(10);
    for (let i = 0; i < 9; i++) h.passkey(ada.user.id);
    const { response } = await ceremony(h, ada.session, auth);
    h.passkey(ada.user.id);
    const capped = await failure(registerOptions(h.deps, ada.session, { label: "ada" }));
    expect(capped).toMatchObject({ code: "passkey_limit", status: 409, message: CAP_MESSAGE });
    expect(capped.details).toEqual({ reason: "cap" });
    // The transaction checks again: the tenth slot went to someone else between the options and the answer.
    const late = await failure(registerVerify(h.deps, ada.session, { response }));
    expect(late).toMatchObject({ code: "passkey_limit", status: 409, message: CAP_MESSAGE });
    expect(late.details).toEqual({ reason: "cap" });
    expect(h.passkeys).toHaveLength(10);
    expect(h.events).toEqual([]);
    // The answer's challenge was spent by the refused try.
    expect(await failure(registerVerify(h.deps, ada.session, { response }))).toMatchObject({ code: "passkey_invalid" });
  });

  test("the daily bound: five additions in 24 hours refuse the sixth with the seconds until the oldest of them is a day old, counted from the events so a removal frees nothing", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    expect(PASSKEY_ADDITIONS_PER_DAY).toBe(5);
    const first = await register(h, ada.session, auth);
    // Twenty hours on, from a session that is fresh then (the morning's has gone stale).
    h.advance(20 * HOUR);
    const afternoon = h.session(ada.user.id);
    for (let i = 0; i < 3; i++) await register(h, afternoon, auth);
    // The fifth: its options are handed out under the bound, and the verification is the fifth addition of the day.
    const { response } = await ceremony(h, afternoon, auth);
    await registerVerify(h.deps, afternoon, { response });
    expect(h.passkeys).toHaveLength(5);

    const bound = await failure(registerOptions(h.deps, afternoon, { label: "ada" }));
    expect(bound).toMatchObject({ code: "passkey_limit", status: 409, message: "You added 5 passkeys today. You can add another in about 4 hours." });
    expect(bound.details).toEqual({ reason: "daily", retryAfter: (4 * HOUR) / 1000 });
    // Removing one of today's passkeys frees no slot: the bound counts the additions, not the passkeys.
    await removePasskey(h.deps, afternoon, first.id);
    expect((await failure(registerOptions(h.deps, afternoon, { label: "ada" }))).details).toEqual({ reason: "daily", retryAfter: (4 * HOUR) / 1000 });
    h.advance(3 * HOUR + 59 * MINUTE);
    const evening = h.session(ada.user.id);
    expect((await failure(registerOptions(h.deps, evening, { label: "ada" }))).details).toEqual({ reason: "daily", retryAfter: 60 });
    // Once the oldest addition is a day old, the day has a slot again.
    h.advance(MINUTE);
    expect((await registerOptions(h.deps, evening, { label: "ada" })).options.challenge).toBeDefined();
    expect(h.passkeys).toHaveLength(4);
  });

  test("the daily bound is checked again in the transaction, so options handed out under it do not add a sixth", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const { response } = await ceremony(h, ada.session, auth);
    for (let i = 0; i < 5; i++) await h.deps.repo.appendEvent({ userId: ada.user.id, type: "passkey_added", deviceId: null, metadata: {} });
    const late = await failure(registerVerify(h.deps, ada.session, { response }));
    expect(late).toMatchObject({ code: "passkey_limit", status: 409, message: "You added 5 passkeys today. You can add another in about 24 hours." });
    expect(late.details).toEqual({ reason: "daily", retryAfter: DAY / 1000 });
    expect(h.passkeys).toEqual([]);
  });

  test("the options need a fresh session, at level 2 on an account with TOTP; the verification needs only its bound challenge", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const stale = h.session(ada.user.id, { factors: { email: h.now().getTime() - 10 * MINUTE } });
    const refused = await failure(registerOptions(h.deps, stale, { label: "ada" }));
    expect(refused).toMatchObject({ code: "reauth_required", status: 403 });
    expect(refused.details).toEqual({ level: 1, have: [] });

    withTotp(h, ada.user.id, h.now());
    const weak = mfaSession(h, ada.user.id, { email: h.now().getTime() });
    const level2 = await failure(registerOptions(h.deps, weak, { label: "ada" }));
    expect(level2.details).toEqual({ level: 2, have: ["email"] });
    const strong = mfaSession(h, ada.user.id, { email: h.now().getTime(), totp: h.now().getTime() });
    const { response } = await ceremony(h, strong, auth);
    // The ceremony outlasts the window: the challenge, issued to a strong session and bound to it, stands in for the check.
    h.advance(9 * MINUTE);
    expect((await registerVerify(h.deps, strong, { name: "Laptop", response })).passkey.name).toBe("Laptop");
  });

  test("allows 10 options an hour per session handle, then rate_limited with a Retry-After; another session of the account has its own allowance", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    for (let i = 0; i < 10; i++) await registerOptions(h.deps, ada.session, { label: "ada" });
    expect(await failure(registerOptions(h.deps, ada.session, { label: "ada" }))).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: HOUR / 1000 });
    // A rotation keeps the handle, so it changes nothing.
    expect(await failure(registerOptions(h.deps, { ...ada.session, sessionId: randomToken() }, { label: "ada" }))).toMatchObject({ code: "rate_limited" });
    expect((await registerOptions(h.deps, h.session(ada.user.id), { label: "ada" })).options.challenge).toBeDefined();
  });
});

describe("the passkey list (1c design, section 7.5)", () => {
  test("lists the account's passkeys newest first, with whether each started this session, is new, is suspended, is synced and where it was added", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const bob = h.user("bob@korbat.local");
    expect(NEW_PASSKEY_MS).toBe(7 * DAY);
    const old = h.passkey(ada.user.id, new Date(h.now().getTime() - NEW_PASSKEY_MS), { name: "Old", createdDeviceId: ada.session.deviceId, backedUp: true, lastUsedAt: new Date(h.now().getTime() - DAY) });
    const suspect = h.passkey(ada.user.id, new Date(h.now().getTime() - DAY), { name: "Suspect", suspectAt: new Date(h.now().getTime() - HOUR) });
    const current = h.passkey(ada.user.id, new Date(h.now().getTime() - NEW_PASSKEY_MS + 1), { name: "Current" });
    h.passkey(bob.user.id, h.now(), { name: "Bobs" });
    const session = h.session(ada.user.id, { passkeyId: current });
    const { passkeys } = await listPasskeys(h.deps, session);
    expect(passkeys).toEqual([
      { id: suspect, name: "Suspect", createdAt: new Date(h.now().getTime() - DAY).toISOString(), lastUsedAt: null, synced: false, createdOn: null, current: false, isNew: true, suspended: true },
      { id: current, name: "Current", createdAt: new Date(h.now().getTime() - NEW_PASSKEY_MS + 1).toISOString(), lastUsedAt: null, synced: false, createdOn: null, current: true, isNew: true, suspended: false },
      {
        id: old,
        name: "Old",
        createdAt: new Date(h.now().getTime() - NEW_PASSKEY_MS).toISOString(),
        lastUsedAt: new Date(h.now().getTime() - DAY).toISOString(),
        synced: true,
        createdOn: "Chrome on Windows",
        current: false,
        isNew: false,
        suspended: false,
      },
    ]);
    expect((await listPasskeys(h.deps, ada.session)).passkeys.map((p) => p.current)).toEqual([false, false, false]);
    expect((await listPasskeys(h.deps, h.user("carol@korbat.local").session)).passkeys).toEqual([]);
  });

  test("me counts the account's passkeys", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const bob = h.user("bob@korbat.local");
    expect((await me(h.deps, ada.session)).user.passkeys).toBe(0);
    h.passkey(ada.user.id);
    h.passkey(ada.user.id);
    h.passkey(bob.user.id);
    expect((await me(h.deps, ada.session)).user).toEqual({ id: ada.user.id, email: "ada@korbat.local", role: "user", onboarded: true, mfaEnabled: false, hasPassword: false, passkeys: 2 });
  });
});

describe("renaming and removing a passkey (1c design, section 7.5)", () => {
  test("renames only a passkey of the session's account, answering its view; another account's and an unknown one are passkey_not_found", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const bob = h.user("bob@korbat.local");
    const mine = h.passkey(ada.user.id, h.now(), { name: "Laptop", createdDeviceId: ada.session.deviceId });
    const theirs = h.passkey(bob.user.id, h.now(), { name: "Bobs" });
    const { passkey } = await renamePasskey(h.deps, ada.session, mine, { name: "Work laptop" });
    expect(passkey).toMatchObject({ id: mine, name: "Work laptop", createdOn: "Chrome on Windows", isNew: true });
    expect(h.passkeys.map((p) => p.name)).toEqual(["Work laptop", "Bobs"]);
    expect(await failure(renamePasskey(h.deps, ada.session, theirs, { name: "Taken" }))).toMatchObject({ code: "passkey_not_found", status: 404 });
    expect(await failure(renamePasskey(h.deps, ada.session, randomUUID(), { name: "Nothing" }))).toMatchObject({ code: "passkey_not_found", status: 404 });
    expect(h.passkeys.map((p) => p.name)).toEqual(["Work laptop", "Bobs"]);
    expect(h.events).toEqual([]);
    expect(h.mailer.sent).toEqual([]);
  });

  test("allows 30 renames an hour per account, then rate_limited", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const id = h.passkey(ada.user.id);
    for (let i = 0; i < 30; i++) await renamePasskey(h.deps, ada.session, id, { name: `Name ${i}` });
    expect(await failure(renamePasskey(h.deps, h.session(ada.user.id), id, { name: "Once more" }))).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: HOUR / 1000 });
    expect(h.passkeys[0]!.name).toBe("Name 29");
  });

  test("removes only a passkey of the session's account, the last one too, records it and tells the owner; another account's is passkey_not_found and changes nothing", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const bob = h.user("bob@korbat.local");
    const mine = h.passkey(ada.user.id, h.now(), { name: "Laptop" });
    const theirs = h.passkey(bob.user.id, h.now(), { name: "Bobs" });
    expect(await failure(removePasskey(h.deps, ada.session, theirs))).toMatchObject({ code: "passkey_not_found", status: 404 });
    expect(await failure(removePasskey(h.deps, ada.session, randomUUID()))).toMatchObject({ code: "passkey_not_found", status: 404 });
    expect(h.passkeys).toHaveLength(2);
    expect(h.events).toEqual([]);
    await removePasskey(h.deps, ada.session, mine);
    expect(h.passkeys.map((p) => p.id)).toEqual([theirs]);
    expect(h.events).toEqual([{ userId: ada.user.id, type: "passkey_removed", deviceId: ada.session.deviceId, metadata: { passkeyId: mine, via: "settings" } }]);
    expect(h.mailer.sent).toEqual([{ to: "ada@korbat.local", template: "passkey_removed", data: { name: "Laptop", time: mailTime(h.now()) } }]);
    // The sessions stay: the owner removed a credential, nothing more.
    expect(h.sessions.map((s) => s.revokedAt)).toEqual([null, null]);
    expect(await failure(removePasskey(h.deps, ada.session, mine))).toMatchObject({ code: "passkey_not_found", status: 404 });
  });

  test("removal needs a fresh session, at level 2 on an account with TOTP, and allows 10 an hour per account", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const id = h.passkey(ada.user.id);
    const stale = h.session(ada.user.id, { factors: { email: h.now().getTime() - 10 * MINUTE } });
    expect((await failure(removePasskey(h.deps, stale, id))).details).toEqual({ level: 1, have: [] });
    withTotp(h, ada.user.id, h.now());
    const weak = mfaSession(h, ada.user.id, { email: h.now().getTime() });
    const refused = await failure(removePasskey(h.deps, weak, id));
    expect(refused).toMatchObject({ code: "reauth_required", status: 403 });
    expect(refused.details).toEqual({ level: 2, have: ["email"] });
    expect(h.passkeys).toHaveLength(1);
    const strong = mfaSession(h, ada.user.id, { email: h.now().getTime(), totp: h.now().getTime() });
    for (let i = 0; i < 10; i++) expect(await failure(removePasskey(h.deps, strong, randomUUID()))).toMatchObject({ code: "passkey_not_found" });
    expect(await failure(removePasskey(h.deps, strong, id))).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: HOUR / 1000 });
    expect(h.passkeys).toHaveLength(1);
  });
});

describe("'This wasn't me' on a passkey (1c design, sections 7.5 and 7.6)", () => {
  test("runs the lockdown anchored at the passkey's creation, naming it, and records it with the session's device", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const other = h.session(ada.user.id);
    const bob = h.user("bob@korbat.local");
    await h.deps.repo.setPasswordHash(ada.user.id, "owner-password", h.now());
    // The suspect passkey was added six days ago; the rows around its anchor are placed in the past.
    const createdAt = new Date(h.now().getTime() - 6 * DAY);
    const since = createdAt.getTime() - LOCKDOWN_LOOKBACK_MS;
    const kept = h.passkey(ada.user.id, new Date(since - 1));
    const earlier = h.passkey(ada.user.id, new Date(since));
    const suspect = h.passkey(ada.user.id, createdAt);
    const bobs = h.passkey(bob.user.id, createdAt);
    withTotp(h, ada.user.id, new Date(createdAt.getTime() - HOUR));
    await notMine(h.deps, ada.session, suspect, h.ctx);
    expect(h.passkeys.map((p) => p.id).sort()).toEqual([kept, bobs].sort());
    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([h.now(), h.now()]);
    for (const id of [ada.session.sessionId, other.sessionId]) expect(await h.kv.get(`sess:${id}`), id).toBe("revoked");
    expect(h.devices.filter((d) => d.userId === ada.user.id).map((d) => d.revokedAt)).toEqual([h.now(), h.now()]);
    expect(h.users.get(ada.user.id)).toMatchObject({ passwordHash: null, totpSecretEnc: null, totpEnabledAt: null });
    expect(h.events).toEqual([
      {
        userId: ada.user.id,
        type: "passkey_removed",
        deviceId: ada.session.deviceId,
        metadata: { passkeyId: suspect, via: "not_mine", passkeysRemoved: expect.arrayContaining([earlier, suspect]), totpCleared: true, passwordCleared: true },
      },
    ]);
    expect(h.events[0]!.metadata.passkeysRemoved).toHaveLength(2);
    expect(h.mailer.sent).toEqual([]);
    expect(h.sessions.filter((s) => s.userId === bob.user.id).map((s) => s.revokedAt)).toEqual([null]);
  });

  test("only a passkey of the account added in the last 7 days: older ones, another account's and unknown ones are passkey_not_found and change nothing", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const bob = h.user("bob@korbat.local");
    // Exactly 7 days old is no longer new; a month old is also out of any lockdown's reach below.
    const week = h.passkey(ada.user.id, new Date(h.now().getTime() - NEW_PASSKEY_MS));
    const month = h.passkey(ada.user.id, new Date(h.now().getTime() - 30 * DAY));
    const theirs = h.passkey(bob.user.id, h.now());
    for (const id of [week, month, theirs, randomUUID()]) expect(await failure(notMine(h.deps, ada.session, id, h.ctx))).toMatchObject({ code: "passkey_not_found", status: 404 });
    expect(h.passkeys).toHaveLength(3);
    expect(h.sessions.map((s) => s.revokedAt)).toEqual([null, null]);
    expect(h.events).toEqual([]);
    // One millisecond younger than 7 days is still new; the lockdown it runs reaches the week-old passkey, a day before it.
    const newest = h.passkey(ada.user.id, new Date(h.now().getTime() - NEW_PASSKEY_MS + 1));
    await notMine(h.deps, ada.session, newest, h.ctx);
    expect(h.passkeys.map((p) => p.id).sort()).toEqual([month, theirs].sort());
    expect(h.events.at(-1)!.metadata.passkeysRemoved).toEqual(expect.arrayContaining([week, newest]));
  });

  test("needs a fresh session at level 1 only, and allows 5 a day per account", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const stale = h.session(ada.user.id, { factors: { email: h.now().getTime() - 10 * MINUTE } });
    const refused = await failure(notMine(h.deps, stale, randomUUID(), h.ctx));
    expect(refused).toMatchObject({ code: "reauth_required", status: 403 });
    expect(refused.details).toEqual({ level: 1, have: [] });
    // Level 1 is enough on an account with TOTP: whoever re-enrolled it holds level 2.
    withTotp(h, ada.user.id, h.now());
    const weak = mfaSession(h, ada.user.id, { email: h.now().getTime() });
    for (let i = 0; i < 5; i++) expect(await failure(notMine(h.deps, weak, randomUUID(), h.ctx))).toMatchObject({ code: "passkey_not_found" });
    expect(await failure(notMine(h.deps, weak, randomUUID(), h.ctx))).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: DAY / 1000 });
  });
});

describe("the passkey remove link (1c design, section 7.6)", () => {
  /** A registered passkey and the token of the remove link its mail carried. */
  async function registeredWithLink(h: MemoryFlowHarness, session: Session) {
    const passkey = await register(h, session, new SoftAuthenticator(), { name: "Laptop" });
    const url = h.mailer.sent.at(-1)!.data.removeUrl!;
    return { passkey, token: url.slice(url.lastIndexOf("/") + 1) };
  }

  test("runs the lockdown anchored at the passkey's creation, naming it, once; a second use finds nothing", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const other = h.session(ada.user.id);
    await h.deps.repo.setPasswordHash(ada.user.id, "owner-password", h.now());
    const kept = h.passkey(ada.user.id, new Date(h.now().getTime() - LOCKDOWN_LOOKBACK_MS - 1));
    const earlier = h.passkey(ada.user.id, new Date(h.now().getTime() - LOCKDOWN_LOOKBACK_MS));
    const { passkey, token } = await registeredWithLink(h, ada.session);
    const createdAt = h.now();
    h.advance(3 * DAY);
    const later = h.passkey(ada.user.id, h.now());
    withTotp(h, ada.user.id, h.now());
    const stranger = { ...h.ctx, ipHash: randomToken() };
    await removeByLink(h.deps, { token }, stranger);
    expect(h.passkeys.map((p) => p.id)).toEqual([kept]);
    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([h.now(), h.now()]);
    for (const id of [ada.session.sessionId, other.sessionId]) expect(await h.kv.get(`sess:${id}`), id).toBe("revoked");
    expect(h.devices.filter((d) => d.userId === ada.user.id).map((d) => d.revokedAt)).toEqual([h.now(), h.now()]);
    expect(h.users.get(ada.user.id)).toMatchObject({ passwordHash: null, totpSecretEnc: null, totpEnabledAt: null });
    expect(h.events.at(-1)).toEqual({
      userId: ada.user.id,
      type: "passkey_removed",
      deviceId: null,
      metadata: { passkeyId: passkey.id, via: "link", passkeysRemoved: expect.arrayContaining([earlier, passkey.id, later]), totpCleared: true, passwordCleared: true },
    });
    expect(h.events.at(-1)!.metadata.passkeysRemoved).toHaveLength(3);
    expect(h.events.map((e) => e.type)).toEqual(["passkey_added", "passkey_removed"]);
    // Anchored at the creation, not at the use: the day before the creation is the reach, whatever the passkey's age now.
    expect(new Date(h.now().getTime() - 3 * DAY)).toEqual(createdAt);
    expect(await failure(removeByLink(h.deps, { token }, stranger))).toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    expect(h.events).toHaveLength(2);
  });

  test("works after the passkey is already gone: the sessions and the password still go", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    await h.deps.repo.setPasswordHash(ada.user.id, "owner-password", h.now());
    const { passkey, token } = await registeredWithLink(h, ada.session);
    await removePasskey(h.deps, ada.session, passkey.id);
    expect(h.passkeys).toEqual([]);
    h.advance(DAY);
    await removeByLink(h.deps, { token }, h.ctx);
    expect(h.sessions.map((s) => s.revokedAt)).toEqual([h.now()]);
    expect(h.users.get(ada.user.id)).toMatchObject({ passwordHash: null });
    expect(h.events.at(-1)).toEqual({
      userId: ada.user.id,
      type: "passkey_removed",
      deviceId: null,
      metadata: { passkeyId: passkey.id, via: "link", passkeysRemoved: [], totpCleared: false, passwordCleared: true },
    });
  });

  test("after the account's address changed, the link does nothing but refuse, and is spent", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    await h.deps.repo.setPasswordHash(ada.user.id, "owner-password", h.now());
    const { token } = await registeredWithLink(h, ada.session);
    await h.deps.repo.changeEmail(ada.user.id, "attacker@korbat.local", h.now());
    expect(await failure(removeByLink(h.deps, { token }, h.ctx))).toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    expect(h.passkeys).toHaveLength(1);
    expect(h.sessions.map((s) => s.revokedAt)).toEqual([null]);
    expect(h.users.get(ada.user.id)).toMatchObject({ email: "attacker@korbat.local", passwordHash: "owner-password" });
    expect(h.events.map((e) => e.type)).toEqual(["passkey_added"]);
    // Taken once: nobody can wait for the address to come back and use it then.
    await h.deps.repo.changeEmail(ada.user.id, "ada@korbat.local", h.now());
    expect(await failure(removeByLink(h.deps, { token }, h.ctx))).toMatchObject({ code: "invalid_code", message: LINK_GONE });
    // A change of case alone is no change.
    const bob = h.user("bob@korbat.local");
    const bobs = await registeredWithLink(h, bob.session);
    await h.deps.repo.changeEmail(bob.user.id, "Bob@korbat.local", h.now());
    await removeByLink(h.deps, { token: bobs.token }, h.ctx);
    expect(h.sessions.filter((s) => s.userId === bob.user.id).map((s) => s.revokedAt)).toEqual([h.now()]);
  });

  test("an unknown link and one of an account that is gone are refused alike, and 10 tries an hour per address are allowed", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { token } = await registeredWithLink(h, ada.session);
    await h.deps.repo.markDeleted(ada.user.id, h.now());
    expect(await failure(removeByLink(h.deps, { token }, h.ctx))).toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    for (let i = 0; i < 9; i++) expect(await failure(removeByLink(h.deps, { token: randomToken() }, h.ctx))).toMatchObject({ code: "invalid_code" });
    expect(await failure(removeByLink(h.deps, { token: randomToken() }, h.ctx))).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: HOUR / 1000 });
    expect(await failure(removeByLink(h.deps, { token: randomToken() }, { ...h.ctx, ipHash: randomToken() }))).toMatchObject({ code: "invalid_code" });
    expect(h.events.map((e) => e.type)).toEqual(["passkey_added"]);
  });
});
```

### Create `apps/api/test/integration/auth-passkeys.test.ts`

```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { authEvents, closeDb, createDb, passkeys, sessions, type Db } from "@korbat/db";
import { AuthError } from "../../src/auth/context";
import { randomToken } from "../../src/auth/crypto";
import { me } from "../../src/auth/flows/account";
import { LOCKDOWN_LOOKBACK_MS } from "../../src/auth/flows/lockdown";
import { emailHash } from "../../src/auth/identifiers";
import { HOUR, MINUTE } from "../../src/auth/limits";
import { listPasskeys, notMine, passkeyRemoveKey, registerOptions, registerVerify, removeByLink, removePasskey, renamePasskey, type PasskeyRemoveToken } from "../../src/auth/passkeys/flows";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import type { Session } from "../../src/auth/sessions";
import { loadConfig } from "../../src/config";
import { SoftAuthenticator, type SoftFlags } from "../auth/soft-authenticator";
import { flowHarness, onboardedUser, type FlowHarness } from "./flow-harness";

const DAY = 24 * HOUR;
const PASSWORD = "correct horse battery staple";
const ORIGIN = "http://localhost:8081";
const ALL: SoftFlags = { up: true, uv: true, be: true, bs: true };
const BARE: SoftFlags = { up: true, uv: false, be: false, bs: false };
const LINK_GONE = "This link has expired or was already used.";

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
 * Passkey registration and management against the real repository (1c design, sections 7.3, 7.5 and 7.6): the rows,
 * the transaction behind the bounds under a race, the foreign key from a session to the passkey that started it, and the
 * two lockdown paths a passkey offers.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: passkey registration and management", () => {
  let db: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_AUTH, { max: 4 });
    repo = createAuthRepo(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });

  /** The options of a registration and the browser's answer to them from the software authenticator. */
  async function ceremony(h: FlowHarness, session: Session, auth: SoftAuthenticator, flags: SoftFlags = ALL) {
    const { options } = await registerOptions(h.deps, session, { label: "ada" });
    return auth.create({ rpId: options.rp.id!, challenge: options.challenge, origin: ORIGIN, userHandle: Buffer.from(options.user.id, "base64url"), flags });
  }

  /** A whole registration; answers the stored passkey's view. */
  async function register(h: FlowHarness, session: Session, auth: SoftAuthenticator, name?: string, flags: SoftFlags = ALL) {
    const response = await ceremony(h, session, auth, flags);
    return (await registerVerify(h.deps, session, { name, response })).passkey;
  }

  /** A passkey row written directly, as the cap tests fill an account without spending the day's additions. */
  async function directPasskey(userId: string, createdAt: Date): Promise<string> {
    const [row] = await db.insert(passkeys).values({ userId, credentialId: randomToken(), publicKey: "cose-key", name: "Passkey", createdAt }).returning({ id: passkeys.id });
    return row!.id;
  }

  const passkeyIds = async (userId: string) => (await db.select({ id: passkeys.id }).from(passkeys).where(eq(passkeys.userId, userId))).map((row) => row.id).sort();

  /** The account's events oldest first, with the metadata the flows wrote. */
  const eventsOf = (userId: string) =>
    db
      .select({ type: authEvents.type, deviceId: authEvents.deviceId, ipHash: authEvents.ipHash, metadata: authEvents.metadata })
      .from(authEvents)
      .where(eq(authEvents.userId, userId))
      .orderBy(authEvents.id);

  test("registers two passkeys with one user handle, stores their flags and provenance, records and mails each, and lists them newest first", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const auth = new SoftAuthenticator();
    const laptop = await register(h, account.session, auth, "Laptop");
    h.clock.advance(MINUTE);
    const plain = await register(h, account.session, auth, undefined, BARE);
    expect(laptop).toMatchObject({ name: "Laptop", synced: true, createdOn: "Chrome on Windows", current: false, isNew: true, suspended: false, lastUsedAt: null });
    expect(plain).toMatchObject({ name: "Passkey on the web", synced: false, createdAt: h.clock.now().toISOString() });

    const user = (await repo.findUserById(account.user.id))!;
    expect(Buffer.isBuffer(user.webauthnUserId)).toBe(true);
    expect(user.webauthnUserId).toHaveLength(32);
    // Both options carried the same handle: it was set once.
    const { options } = await registerOptions(h.deps, account.session, { label: "ada" });
    expect(Buffer.from(options.user.id, "base64url")).toEqual(user.webauthnUserId);
    expect(options.excludeCredentials!.map((c) => c.id).sort()).toHaveLength(2);

    const rows = await db.select().from(passkeys).where(eq(passkeys.userId, account.user.id)).orderBy(passkeys.createdAt);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: laptop.id, name: "Laptop", counter: 0, transports: ["internal", "hybrid"], backedUp: true, backupEligible: true, uvInitialized: true, createdDeviceId: account.session.deviceId, suspectAt: null, lastUsedAt: null });
    expect(rows[0]!.aaguid).toBe("00000000-0000-0000-0000-000000000000");
    expect(rows[0]!.createdAt).toEqual(new Date(h.clock.ms() - MINUTE));
    expect(rows[1]).toMatchObject({ id: plain.id, name: "Passkey on the web", backedUp: false, backupEligible: false, uvInitialized: false, createdAt: h.clock.now() });

    const { passkeys: listed } = await listPasskeys(h.deps, account.session);
    expect(listed.map((p) => p.id)).toEqual([plain.id, laptop.id]);
    expect((await me(h.deps, account.session)).user.passkeys).toBe(2);
    expect((await eventsOf(account.user.id)).filter((e) => e.type === "passkey_added")).toEqual([
      { type: "passkey_added", deviceId: account.session.deviceId, ipHash: null, metadata: { passkeyId: laptop.id } },
      { type: "passkey_added", deviceId: account.session.deviceId, ipHash: null, metadata: { passkeyId: plain.id } },
    ]);
    const mails = h.mailer.sent.filter((m) => m.template === "passkey_added");
    expect(mails.map((m) => [m.to, m.data.name, m.data.deviceLabel])).toEqual([
      [account.email, "Laptop", "Chrome on Windows"],
      [account.email, "Passkey on the web", "Chrome on Windows"],
    ]);
    const token = /\/passkey-remove\/([A-Za-z0-9_-]{43})$/.exec(mails[1]!.data.removeUrl!)![1]!;
    expect(JSON.parse((await h.kv.get(passkeyRemoveKey(token)))!) as PasskeyRemoveToken).toEqual({
      userId: account.user.id,
      passkeyId: plain.id,
      createdAt: h.clock.ms(),
      sentTo: emailHash(h.deps.config.authHmacKey, account.email),
    });
  });

  test("the cap under a race: with nine passkeys, two registrations answered at once get one tenth slot between them", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const auth = new SoftAuthenticator();
    for (let i = 0; i < 9; i++) await directPasskey(account.user.id, h.clock.now());
    const first = await ceremony(h, account.session, auth);
    const second = await ceremony(h, account.session, auth);
    const outcomes = await Promise.allSettled([registerVerify(h.deps, account.session, { response: first }), registerVerify(h.deps, account.session, { response: second })]);
    const refused = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]!.reason).toBeInstanceOf(AuthError);
    expect(refused[0]!.reason).toMatchObject({ code: "passkey_limit", status: 409, details: { reason: "cap" } });
    expect(await passkeyIds(account.user.id)).toHaveLength(10);
    expect((await eventsOf(account.user.id)).filter((e) => e.type === "passkey_added")).toHaveLength(1);
    const options = await failure(registerOptions(h.deps, account.session, { label: "ada" }));
    expect(options).toMatchObject({ code: "passkey_limit", status: 409, details: { reason: "cap" } });
  });

  test("the daily bound under a race, counted from the events by the database clock: with four additions today, two registrations at once get one fifth between them", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const auth = new SoftAuthenticator();
    // An addition from before yesterday is out of the window, whatever the harness clock says.
    await db.insert(authEvents).values({ userId: account.user.id, type: "passkey_added", deviceId: null, metadata: {}, createdAt: new Date(Date.now() - 25 * HOUR) });
    for (let i = 0; i < 4; i++) await repo.appendEvent({ userId: account.user.id, type: "passkey_added", deviceId: account.session.deviceId, metadata: {} });
    const first = await ceremony(h, account.session, auth);
    const second = await ceremony(h, account.session, auth);
    const outcomes = await Promise.allSettled([registerVerify(h.deps, account.session, { response: first }), registerVerify(h.deps, account.session, { response: second })]);
    const refused = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(refused).toHaveLength(1);
    const daily = refused[0]!.reason as AuthError;
    expect(daily).toBeInstanceOf(AuthError);
    expect(daily).toMatchObject({ code: "passkey_limit", status: 409, message: "You added 5 passkeys today. You can add another in about 24 hours." });
    expect(daily.details).toMatchObject({ reason: "daily" });
    // Until the oldest of today's five is a day old: they were all recorded moments ago.
    const retryAfter = (daily.details as { retryAfter: number }).retryAfter;
    expect(retryAfter).toBeGreaterThan(DAY / 1000 - 60);
    expect(retryAfter).toBeLessThanOrEqual(DAY / 1000);
    expect(await passkeyIds(account.user.id)).toHaveLength(1);
    const options = await failure(registerOptions(h.deps, account.session, { label: "ada" }));
    expect(options.details).toMatchObject({ reason: "daily" });
  });

  test("the remove link runs the lockdown anchored at the passkey's creation: the passkey and the ones from the day before it go, every session and device, the password too; it works once", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const other = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    const since = h.clock.ms() - LOCKDOWN_LOOKBACK_MS;
    const kept = await directPasskey(account.user.id, new Date(since - 1));
    const earlier = await directPasskey(account.user.id, new Date(since));
    const added = await register(h, account.session, new SoftAuthenticator(), "Laptop");
    const url = h.mailer.sent.at(-1)!.data.removeUrl!;
    const token = url.slice(url.lastIndexOf("/") + 1);
    h.clock.advance(3 * DAY);
    const later = await directPasskey(account.user.id, h.clock.now());

    await removeByLink(h.deps, { token }, h.ctx);
    expect(await passkeyIds(account.user.id)).toEqual([kept]);
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(await h.deps.sessions.resolve(other.token)).toBeNull();
    expect(await repo.listActiveSessions(account.user.id, h.clock.now())).toEqual([]);
    expect(await repo.listDevices(account.user.id)).toEqual([]);
    expect((await repo.findUserById(account.user.id))!.passwordHash).toBeNull();
    const removed = (await eventsOf(account.user.id)).filter((e) => e.type === "passkey_removed");
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({ deviceId: null, ipHash: h.ctx.ipHash });
    expect(removed[0]!.metadata).toMatchObject({ passkeyId: added.id, via: "link", totpCleared: false, passwordCleared: true });
    expect([...(removed[0]!.metadata as { passkeysRemoved: string[] }).passkeysRemoved].sort()).toEqual([earlier, added.id, later].sort());
    await expect(removeByLink(h.deps, { token }, h.ctx)).rejects.toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
  });

  test("'not mine' on a passkey of the last 7 days does the same from inside a session, and is recorded with that session's device", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const other = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    const old = await directPasskey(account.user.id, new Date(h.clock.ms() - 30 * DAY));
    const added = await register(h, account.session, new SoftAuthenticator(), "Laptop");
    await expect(notMine(h.deps, account.session, old, h.ctx)).rejects.toMatchObject({ code: "passkey_not_found", status: 404 });

    await notMine(h.deps, account.session, added.id, h.ctx);
    expect(await passkeyIds(account.user.id)).toEqual([old]);
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(await h.deps.sessions.resolve(other.token)).toBeNull();
    expect(await repo.listDevices(account.user.id)).toEqual([]);
    expect((await repo.findUserById(account.user.id))!.passwordHash).toBeNull();
    const removed = (await eventsOf(account.user.id)).filter((e) => e.type === "passkey_removed");
    expect(removed).toEqual([
      { type: "passkey_removed", deviceId: account.session.deviceId, ipHash: h.ctx.ipHash, metadata: { passkeyId: added.id, via: "not_mine", passkeysRemoved: [added.id], totpCleared: false, passwordCleared: true } },
    ]);
    expect(h.mailer.sent.filter((m) => m.template === "passkey_removed")).toEqual([]);
  });

  test("removing the passkey that started the current session keeps the session, without it; rename and removal act only on the account's own passkeys", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const bystander = await onboardedUser(h, repo);
    const added = await register(h, account.session, new SoftAuthenticator(), "Laptop");
    await db.update(sessions).set({ passkeyId: added.id }).where(eq(sessions.id, account.session.sessionId));
    await h.deps.sessions.forgetUser(account.user.id);
    const session = (await h.deps.sessions.resolve(account.token))!.session;
    expect(session.passkeyId).toBe(added.id);
    expect((await listPasskeys(h.deps, session)).passkeys.map((p) => [p.id, p.current])).toEqual([[added.id, true]]);

    await expect(renamePasskey(h.deps, bystander.session, added.id, { name: "Taken" })).rejects.toMatchObject({ code: "passkey_not_found", status: 404 });
    await expect(removePasskey(h.deps, bystander.session, added.id)).rejects.toMatchObject({ code: "passkey_not_found", status: 404 });
    expect((await renamePasskey(h.deps, session, added.id, { name: "Work laptop" })).passkey).toMatchObject({ id: added.id, name: "Work laptop", current: true });

    h.clock.advance(MINUTE);
    await removePasskey(h.deps, session, added.id);
    expect(await passkeyIds(account.user.id)).toEqual([]);
    const [row] = await db.select({ passkeyId: sessions.passkeyId, revokedAt: sessions.revokedAt }).from(sessions).where(eq(sessions.id, account.session.sessionId));
    expect(row).toEqual({ passkeyId: null, revokedAt: null });
    expect(await h.deps.sessions.resolve(account.token)).not.toBeNull();
    expect((await eventsOf(account.user.id)).filter((e) => e.type === "passkey_removed")).toEqual([
      { type: "passkey_removed", deviceId: account.session.deviceId, ipHash: null, metadata: { passkeyId: added.id, via: "settings" } },
    ]);
    expect(h.mailer.sent.at(-1)).toEqual({ to: account.email, template: "passkey_removed", data: { name: "Work laptop", time: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/) } });
    expect(await passkeyIds(bystander.user.id)).toEqual([]);
  });
});
```

### Create `apps/api/test/integration/http-passkeys.test.ts`

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import Redis from "ioredis";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import { ErrorEnvelope, FlowResponse, MeResponse, PasskeyListResponse, PasskeyOptionsResponse, PasskeyView, ReauthResponse } from "@korbat/contracts";
import { closeDb, createDb, sessions, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth, redisKv, type Auth } from "../../src/auth";
import { encrypt, randomToken, sha256Hex } from "../../src/auth/crypto";
import type { PublicKeyCredentialCreationOptionsJSON } from "../../src/auth/passkeys/webauthn";
import { currentStep, hotp, newTotpSecret } from "../../src/auth/totp";
import { loadConfig, type Config } from "../../src/config";
import { smtpMailer } from "../../src/mail/smtp";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { SoftAuthenticator, type SoftFlags } from "../auth/soft-authenticator";
import { Browser } from "./http-client";
import { codeFrom, inbox } from "./mailpit";

const PASSWORD = "correct horse battery staple";
const ALL: SoftFlags = { up: true, uv: true, be: true, bs: true };
const SUBJECT = {
  signUp: "Your korbat sign-up code",
  reauth: "Confirm it's you on korbat",
  passkeyAdded: "A passkey was added to your korbat account",
  passkeyRemoved: "A passkey was removed from your korbat account",
};
const PasskeyResponse = z.object({ passkey: PasskeyView });

const newEmail = (prefix: string) => `${prefix}-${randomUUID()}@korbat.local`;
const newHandle = () => `p_${randomBytes(6).toString("hex")}`;

/**
 * The passkey routes over HTTP (1c design, section 10) with the real Redis store and real SMTP into Mailpit: every guard
 * and limit of registration, the list, rename, removal, "not mine" and the remove link, and strong freshness on the two
 * level-2 routes for an account with TOTP.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the passkey routes over HTTP (Postgres, Redis, Mailpit)", () => {
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
      // A fresh key prefix per run, so rate-limit counters from earlier runs never interfere.
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
  const sessionIdOf = (b: Browser) => sha256Hex(b.cookie("__Host-korbat_session")!);
  const userIdOf = async (b: Browser) => MeResponse.parse(await (await b.fetch("/api/me")).json()).user.id;

  /** A signed-up web account with codes read from Mailpit, onboarded unless told otherwise; its session proved the sign-up's email code and nothing else. */
  async function signUp(options: { onboard?: boolean } = {}) {
    const b = web();
    const email = newEmail("passkeys");
    const box = await inbox(email);
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(start.status).toBe(200);
    const { flowId } = FlowResponse.parse(await start.json());
    expect((await b.fetch("/api/auth/email/verify", { json: { flowId, code: codeFrom(await box.next(SUBJECT.signUp)) } })).status).toBe(200);
    expect((await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).status).toBe(200);
    if (options.onboard !== false) expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle: newHandle(), displayName: "Passkey User" } })).status).toBe(200);
    return { b, email, box, userId: await userIdOf(b) };
  }

  /** A second session of an account that holds PASSWORD, signed in with it from another browser (a code would wait on the address's one-minute cooldown). */
  async function secondSession(email: string) {
    const other = web();
    const signedIn = await other.fetch("/api/auth/password/signin", { json: { email, password: PASSWORD, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(signedIn.status).toBe(200);
    expect((await other.fetch("/api/me")).status).toBe(200);
    return other;
  }

  /** TOTP on, as the confirm step leaves it; the session cache is dropped so mfaEnabled shows. */
  async function withTotp(userId: string) {
    const secret = newTotpSecret();
    await auth.deps.repo.enableTotp(userId, { secretEnc: encrypt(Buffer.from(secret), auth.deps.config.totpKey), recoveryCodesHash: [], now: new Date() });
    await auth.deps.sessions.forgetUser(userId);
    return secret;
  }
  const totpNow = (secret: Uint8Array) => hotp(secret, currentStep(Date.now()));

  /** The session's only factor is the sign-up's email code; moved ten minutes back, nothing within the window is left. */
  async function makeStale(b: Browser) {
    await auth.deps.repo.writeFactor(sessionIdOf(b), "email", new Date(Date.now() - 10 * 60_000));
    await auth.deps.kv.del(`sess:${sessionIdOf(b)}`);
  }

  const optionsFor = async (b: Browser, label = "ada") => {
    const res = await b.fetch("/api/auth/passkeys/register/options", { json: { label } });
    expect(res.status).toBe(200);
    // The contract checks the challenge only and passes the rest through; the test reads the options as the library wrote them.
    return PasskeyOptionsResponse.parse(await res.json()).options as unknown as PublicKeyCredentialCreationOptionsJSON;
  };
  const answer = (authenticator: SoftAuthenticator, options: PublicKeyCredentialCreationOptionsJSON, flags: SoftFlags = ALL) =>
    authenticator.create({ rpId: options.rp.id!, challenge: options.challenge, origin: config.APP_ORIGIN, userHandle: Buffer.from(options.user.id, "base64url"), flags });
  /** A whole registration over HTTP; answers the stored passkey's view. */
  async function register(b: Browser, name?: string) {
    const response = answer(new SoftAuthenticator(), await optionsFor(b));
    const res = await b.fetch("/api/auth/passkeys/register/verify", { json: name === undefined ? { response } : { name, response } });
    expect(res.status).toBe(200);
    return PasskeyResponse.parse(await res.json()).passkey;
  }
  const listed = async (b: Browser) => PasskeyListResponse.parse(await (await b.fetch("/api/auth/passkeys")).json()).passkeys;

  test("registration takes a session at onboarding scope: the options need strong freshness, the verification only its bound challenge; the list needs an onboarded session; me counts", { timeout: 60_000 }, async () => {
    const { b, box } = await signUp({ onboard: false });
    const options = await optionsFor(b, "ada on the laptop");
    expect(options.user.name).toBe("ada on the laptop");
    expect(options.rp).toEqual({ id: config.WEBAUTHN_RP_ID, name: config.WEBAUTHN_RP_NAME });
    // Bad input: an empty label.
    expect((await b.fetch("/api/auth/passkeys/register/options", { json: { label: "" } })).status).toBe(400);
    // A stale session gets no options; the ceremony it already started still completes.
    await makeStale(b);
    const refused = await b.fetch("/api/auth/passkeys/register/options", { json: { label: "ada" } });
    expect(refused.status).toBe(403);
    expect(await error(refused)).toMatchObject({ code: "reauth_required", details: { level: 1, have: [] } });
    const verify = await b.fetch("/api/auth/passkeys/register/verify", { json: { name: "Laptop", response: answer(new SoftAuthenticator(), options) } });
    expect(verify.status).toBe(200);
    const { passkey } = PasskeyResponse.parse(await verify.json());
    expect(passkey).toMatchObject({ name: "Laptop", synced: true, createdOn: "Browser on unknown OS", current: false, isNew: true, suspended: false });
    expect(await box.next(SUBJECT.passkeyAdded)).toMatch(/\/passkey-remove\/[A-Za-z0-9_-]{43}/);
    // The list waits for onboarding; me counts already.
    const early = await b.fetch("/api/auth/passkeys");
    expect(early.status).toBe(403);
    expect((await error(early)).code).toBe("onboarding_required");
    expect(MeResponse.parse(await (await b.fetch("/api/me")).json()).user.passkeys).toBe(1);
    expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle: newHandle(), displayName: "Passkey User" } })).status).toBe(200);
    expect(await listed(b)).toEqual([passkey]);

    // Bad input: a name over the display-name rules, a response missing its attestation.
    expect((await b.fetch("/api/auth/passkeys/register/verify", { json: { name: "x".repeat(51), response: answer(new SoftAuthenticator(), options) } })).status).toBe(400);
    expect((await b.fetch("/api/auth/passkeys/register/verify", { json: { response: { id: "AAAA" } } })).status).toBe(400);

    // Without a session, both are unauthenticated.
    const stranger = web();
    for (const route of ["/api/auth/passkeys/register/options", "/api/auth/passkeys/register/verify"]) {
      const res = await stranger.fetch(route, { json: { label: "ada", response: answer(new SoftAuthenticator(), options) } });
      expect(res.status, route).toBe(401);
      expect((await error(res)).code, route).toBe("unauthenticated");
    }
    expect((await stranger.fetch("/api/auth/passkeys")).status).toBe(401);
  });

  test("on an account with TOTP, the options and the removal need level 2: a session with its email code alone is refused with what it lacks, and passes after a TOTP re-authentication", { timeout: 60_000 }, async () => {
    const { b, userId } = await signUp();
    const passkey = await register(b, "Laptop");
    const secret = await withTotp(userId);
    const options = await b.fetch("/api/auth/passkeys/register/options", { json: { label: "ada" } });
    expect(options.status).toBe(403);
    expect(await error(options)).toMatchObject({ code: "reauth_required", details: { level: 2, have: ["email"] } });
    const removal = await b.fetch(`/api/auth/passkeys/${passkey.id}`, { method: "DELETE" });
    expect(removal.status).toBe(403);
    expect(await error(removal)).toMatchObject({ code: "reauth_required", details: { level: 2, have: ["email"] } });
    // Level 1 keeps its routes: the list, a rename and "not mine" on an unknown passkey answer for their own reasons.
    expect((await b.fetch("/api/auth/passkeys")).status).toBe(200);
    expect((await b.fetch(`/api/auth/passkeys/${passkey.id}`, { method: "PATCH", json: { name: "Renamed" } })).status).toBe(200);
    expect((await b.fetch(`/api/auth/passkeys/${randomUUID()}/not-mine`, { method: "POST" })).status).toBe(404);

    const reauth = await b.fetch("/api/auth/reauth", { json: { method: "totp", code: totpNow(secret) } });
    expect(reauth.status).toBe(200);
    expect(ReauthResponse.parse(await reauth.json())).toEqual({ level: 2 });
    expect((await b.fetch("/api/auth/passkeys/register/options", { json: { label: "ada" } })).status).toBe(200);
    expect((await b.fetch(`/api/auth/passkeys/${passkey.id}`, { method: "DELETE" })).status).toBe(204);
    expect(await listed(b)).toEqual([]);
    expect(MeResponse.parse(await (await b.fetch("/api/me")).json()).user.passkeys).toBe(0);
  });

  test("rename and removal act on the account's own passkeys only: another account's is 404, a malformed id or name is 400; the removal is mailed", { timeout: 60_000 }, async () => {
    const ada = await signUp();
    const bob = await signUp();
    const passkey = await register(ada.b, "Laptop");
    await ada.box.next(SUBJECT.passkeyAdded);
    for (const init of [{ method: "PATCH", json: { name: "Taken" } }, { method: "DELETE" }, { method: "POST" }] as const) {
      const route = init.method === "POST" ? `/api/auth/passkeys/${passkey.id}/not-mine` : `/api/auth/passkeys/${passkey.id}`;
      const res = await bob.b.fetch(route, init);
      expect(res.status, init.method).toBe(404);
      expect((await error(res)).code, init.method).toBe("passkey_not_found");
    }
    expect((await ada.b.fetch("/api/auth/passkeys/not-a-uuid", { method: "PATCH", json: { name: "Fine" } })).status).toBe(400);
    expect((await ada.b.fetch("/api/auth/passkeys/not-a-uuid", { method: "DELETE" })).status).toBe(400);
    expect((await ada.b.fetch(`/api/auth/passkeys/${passkey.id}`, { method: "PATCH", json: { name: "" } })).status).toBe(400);
    expect((await ada.b.fetch(`/api/auth/passkeys/${passkey.id}`, { method: "PATCH", json: {} })).status).toBe(400);
    expect(await listed(ada.b)).toEqual([passkey]);

    const renamed = await ada.b.fetch(`/api/auth/passkeys/${passkey.id}`, { method: "PATCH", json: { name: " Work laptop " } });
    expect(renamed.status).toBe(200);
    expect(PasskeyResponse.parse(await renamed.json()).passkey).toEqual({ ...passkey, name: "Work laptop" });
    expect((await listed(ada.b)).map((p) => p.name)).toEqual(["Work laptop"]);
    expect((await ada.b.fetch(`/api/auth/passkeys/${passkey.id}`, { method: "DELETE" })).status).toBe(204);
    expect(await ada.box.next(SUBJECT.passkeyRemoved)).toContain('"Work laptop"');
    expect(await listed(ada.b)).toEqual([]);
    expect((await ada.b.fetch(`/api/auth/passkeys/${passkey.id}`, { method: "DELETE" })).status).toBe(404);
    // Still signed in: a removal is not a lockdown.
    expect((await ada.b.fetch("/api/me")).status).toBe(200);
  });

  test("the limits: 10 options an hour per session, 30 renames and 10 removals an hour per account, 5 'not mine' a day, 10 remove links an hour per address; each answers rate_limited with a Retry-After", { timeout: 60_000 }, async () => {
    const { b } = await signUp();
    const limited = async (res: Response, retryAfter: number) => {
      expect(res.status).toBe(429);
      expect((await error(res)).code).toBe("rate_limited");
      expect(res.headers.get("retry-after")).toBe(String(retryAfter));
    };
    for (let i = 0; i < 10; i++) expect((await b.fetch("/api/auth/passkeys/register/options", { json: { label: "ada" } })).status).toBe(200);
    await limited(await b.fetch("/api/auth/passkeys/register/options", { json: { label: "ada" } }), 3600);
    for (let i = 0; i < 30; i++) expect((await b.fetch(`/api/auth/passkeys/${randomUUID()}`, { method: "PATCH", json: { name: "Name" } })).status).toBe(404);
    await limited(await b.fetch(`/api/auth/passkeys/${randomUUID()}`, { method: "PATCH", json: { name: "Name" } }), 3600);
    for (let i = 0; i < 10; i++) expect((await b.fetch(`/api/auth/passkeys/${randomUUID()}`, { method: "DELETE" })).status).toBe(404);
    await limited(await b.fetch(`/api/auth/passkeys/${randomUUID()}`, { method: "DELETE" }), 3600);
    for (let i = 0; i < 5; i++) expect((await b.fetch(`/api/auth/passkeys/${randomUUID()}/not-mine`, { method: "POST" })).status).toBe(404);
    await limited(await b.fetch(`/api/auth/passkeys/${randomUUID()}/not-mine`, { method: "POST" }), 86400);
    // Still signed in: none of the refusals was a lockdown.
    expect((await b.fetch("/api/me")).status).toBe(200);

    const stranger = web();
    for (let i = 0; i < 10; i++) {
      const res = await stranger.fetch("/api/auth/passkeys/remove-link", { json: { token: randomToken() } });
      expect(res.status).toBe(400);
      expect((await error(res)).code).toBe("invalid_code");
    }
    await limited(await stranger.fetch("/api/auth/passkeys/remove-link", { json: { token: randomToken() } }), 3600);
    expect((await web().fetch("/api/auth/passkeys/remove-link", { json: { token: randomToken() } })).status).toBe(400);
    expect((await web().fetch("/api/auth/passkeys/remove-link", { json: { token: "short" } })).status).toBe(400);
  });

  test("the remove link read from Mailpit removes the passkey, signs out every session and clears the password, once", { timeout: 60_000 }, async () => {
    const { b, email, box, userId } = await signUp();
    expect((await b.fetch("/api/auth/password/set", { json: { password: PASSWORD } })).status).toBe(200);
    const other = await secondSession(email);
    await register(b, "Laptop");
    const token = /\/passkey-remove\/([A-Za-z0-9_-]{43})/.exec(await box.next(SUBJECT.passkeyAdded))?.[1];
    expect(token).toBeDefined();
    expect(await auth.deps.repo.countPasskeys(userId)).toBe(1);
    expect((await other.fetch("/api/me")).status).toBe(200);

    const stranger = web();
    expect((await stranger.fetch("/api/auth/passkeys/remove-link", { json: { token } })).status).toBe(204);
    expect((await b.fetch("/api/me")).status).toBe(401);
    expect((await other.fetch("/api/me")).status).toBe(401);
    expect(await auth.deps.repo.countPasskeys(userId)).toBe(0);
    expect((await auth.deps.repo.findUserById(userId))!.passwordHash).toBeNull();
    const withPassword = await web().fetch("/api/auth/password/signin", { json: { email, password: PASSWORD, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(withPassword.status).toBe(401);
    expect((await error(withPassword)).code).toBe("invalid_credentials");
    const again = await stranger.fetch("/api/auth/passkeys/remove-link", { json: { token } });
    expect(again.status).toBe(400);
    expect(await error(again)).toMatchObject({ code: "invalid_code", message: "This link has expired or was already used." });
    expect((await auth.deps.repo.eventsSince(userId, new Date(0))).map((e) => e.type)).toContain("passkey_removed");
  });

  test("'not mine' needs a fresh session, then does what the link does and clears the web session's cookies", { timeout: 60_000 }, async () => {
    const { b, email, box, userId } = await signUp();
    expect((await b.fetch("/api/auth/password/set", { json: { password: PASSWORD } })).status).toBe(200);
    const other = await secondSession(email);
    const passkey = await register(b, "Laptop");
    await box.next(SUBJECT.passkeyAdded);
    await makeStale(b);
    const stale = await b.fetch(`/api/auth/passkeys/${passkey.id}/not-mine`, { method: "POST" });
    expect(stale.status).toBe(403);
    expect(await error(stale)).toMatchObject({ code: "reauth_required", details: { level: 1, have: [] } });
    const { flowId } = FlowResponse.parse(await (await b.fetch("/api/auth/reauth/email/start", { method: "POST" })).json());
    expect((await b.fetch("/api/auth/reauth", { json: { method: "email", flowId, code: codeFrom(await box.next(SUBJECT.reauth)) } })).status).toBe(200);

    const res = await b.fetch(`/api/auth/passkeys/${passkey.id}/not-mine`, { method: "POST" });
    expect(res.status).toBe(204);
    expect(res.headers.getSetCookie().some((line) => line.startsWith("__Host-korbat_session=") && line.includes("Max-Age=0"))).toBe(true);
    expect(b.cookie("__Host-korbat_session")).toBeUndefined();
    expect((await b.fetch("/api/me")).status).toBe(401);
    expect((await other.fetch("/api/me")).status).toBe(401);
    expect(await auth.deps.repo.countPasskeys(userId)).toBe(0);
    expect((await auth.deps.repo.findUserById(userId))!.passwordHash).toBeNull();
  });

  test("removing the passkey that started the current session keeps the session, without it", { timeout: 60_000 }, async () => {
    const { b, box } = await signUp();
    const passkey = await register(b, "Laptop");
    await box.next(SUBJECT.passkeyAdded);
    await authDb.update(sessions).set({ passkeyId: passkey.id }).where(eq(sessions.id, sessionIdOf(b)));
    await auth.deps.kv.del(`sess:${sessionIdOf(b)}`);
    expect((await listed(b)).map((p) => [p.id, p.current])).toEqual([[passkey.id, true]]);
    expect((await b.fetch(`/api/auth/passkeys/${passkey.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await b.fetch("/api/me")).status).toBe(200);
    expect(await listed(b)).toEqual([]);
    const [row] = await authDb.select({ passkeyId: sessions.passkeyId, revokedAt: sessions.revokedAt }).from(sessions).where(eq(sessions.id, sessionIdOf(b)));
    expect(row).toEqual({ passkeyId: null, revokedAt: null });
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
import type { AddPasskeyOutcome, AuthEventType, AuthRepo, DeviceRow, EmailCodeRow, NewPasskey, PasskeyLimits, PasskeyListRow, PasskeyRow, UserRow } from "../../src/auth/repo";
import { createSessions, type Factors, type Session } from "../../src/auth/sessions";
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
  /** What the passkey flows read of the row: the platform for a passkey's default name and the label for the Security list. */
  platform: Platform;
  label: string | null;
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
    deviceHash: `hash-${device.id}`,
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
    sessions.push({ id: s.sessionId, userId, revokedAt: null });
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

### Replace `apps/api/test/integration/auth-flows-account.test.ts` (whole file)

```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { authEvents, closeDb, createDb, type Db } from "@korbat/db";
import { grantRole } from "../../src/auth/admin";
import { encrypt, randomToken } from "../../src/auth/crypto";
import { listSessions, me, revokeAllSessions, revokeSession, signOut } from "../../src/auth/flows/account";
import { startEmail } from "../../src/auth/flows/email";
import { notMe } from "../../src/auth/flows/not-me";
import { reauthenticate, startReauthEmail } from "../../src/auth/flows/reauth";
import { notMeKey, type NotMeToken } from "../../src/auth/flows/signin";
import { emailHash } from "../../src/auth/identifiers";
import { HOUR, MINUTE } from "../../src/auth/limits";
import { hashRecoveryCode, newRecoveryCodes } from "../../src/auth/recovery-codes";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { REAUTH_WINDOW_MS, type Session } from "../../src/auth/sessions";
import { newTotpSecret } from "../../src/auth/totp";
import { loadConfig } from "../../src/config";
import { currentTotpCode, flowHarness, newTestDevice, newTestEmail, onboardedUser, wrongCode, type FlowHarness } from "./flow-harness";

const PASSWORD = "correct horse battery staple";
const LINK_GONE = "This link has expired or was already used.";

describe.skipIf(!process.env.INTEGRATION)("integration: re-authentication, account and session flows", () => {
  let db: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_AUTH, { max: 4 });
    repo = createAuthRepo(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });

  /** Turns TOTP on for an account as the confirm step leaves it, with recovery codes, and answers the codes in the clear. */
  async function enableTotp(h: FlowHarness, userId: string): Promise<string[]> {
    const codes = newRecoveryCodes();
    await repo.enableTotp(userId, {
      secretEnc: encrypt(Buffer.from(newTotpSecret()), h.deps.config.totpKey),
      recoveryCodesHash: codes.map((code) => hashRecoveryCode(h.deps.config.authHmacKey, code)),
      now: h.clock.now(),
    });
    await h.deps.sessions.forgetUser(userId);
    return codes;
  }

  /** The account's events oldest first, with the metadata the flows wrote. */
  const eventsOf = (userId: string) =>
    db
      .select({ type: authEvents.type, deviceId: authEvents.deviceId, ipHash: authEvents.ipHash, metadata: authEvents.metadata })
      .from(authEvents)
      .where(eq(authEvents.userId, userId))
      .orderBy(authEvents.id);

  test("re-authenticating with the password or a TOTP code writes the factor, rotates the token and answers the level reached; wrong credentials do not", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    await enableTotp(h, account.user.id);
    let token = account.token;
    const current = async () => (await h.deps.sessions.resolve(token))!.session;
    const stale = async () => {
      h.clock.advance(REAUTH_WINDOW_MS + 1_000);
      const session = await current();
      expect(h.deps.sessions.isFresh(session)).toBe(false);
      return session;
    };

    let session = await stale();
    await expect(reauthenticate(h.deps, session, { method: "password", password: "wrong password entirely" }, h.ctx)).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(h.deps.sessions.isFresh(await current())).toBe(false);
    const byPassword = await reauthenticate(h.deps, session, { method: "password", password: PASSWORD }, h.ctx);
    expect(byPassword).toMatchObject({ level: 1, mustReenrollMfa: false });
    // The factor is written with the flows' clock, the reauth time follows it, and the token rotates in place: same handle, same device.
    expect(byPassword.issued.session).toMatchObject({ handle: session.handle, deviceId: session.deviceId, factors: { ...session.factors, password: h.clock.ms() }, reauthAt: h.clock.now() });
    expect(await h.deps.sessions.resolve(token)).toBeNull();
    token = byPassword.issued.token;
    expect(h.deps.sessions.isFresh(await current())).toBe(true);

    session = await current();
    const code = await currentTotpCode(h, repo, account.user.id);
    await expect(reauthenticate(h.deps, session, { method: "totp", code: wrongCode(code) }, h.ctx)).rejects.toMatchObject({ code: "invalid_mfa_code" });
    const byTotp = await reauthenticate(h.deps, session, { method: "totp", code }, h.ctx);
    // With the password still in the window, the code makes level 2.
    expect(byTotp).toMatchObject({ level: 2, mustReenrollMfa: false });
    expect(byTotp.issued.session.factors).toEqual({ ...session.factors, totp: h.clock.ms() });
    expect(await h.deps.sessions.resolve(token)).toBeNull();
    token = byTotp.issued.token;

    // Five minutes later a code alone is level 1 again: the first factor must be as recent as the second.
    session = await stale();
    const alone = await reauthenticate(h.deps, session, { method: "totp", code: await currentTotpCode(h, repo, account.user.id) }, h.ctx);
    expect(alone.level).toBe(1);
    expect(h.deps.sessions.level((await h.deps.sessions.resolve(alone.issued.token))!.session)).toBe(1);
  });

  test("re-authenticating by email accepts only a re-auth code for this account, once, and sends three codes an hour per session", async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const other = await onboardedUser(h, repo);
    h.clock.advance(REAUTH_WINDOW_MS + 1_000);
    const session = (await h.deps.sessions.resolve(account.token))!.session;

    const { flowId } = await startReauthEmail(h.deps, session, h.ctx);
    const reauthMail = h.mailer.sent.at(-1)!;
    expect(reauthMail).toMatchObject({ to: account.email, template: "reauth_code" });
    const reauthCode = reauthMail.data.code!;

    const otherSession = (await h.deps.sessions.resolve(other.token))!.session;
    const otherFlow = await startReauthEmail(h.deps, otherSession, h.ctx);
    await expect(reauthenticate(h.deps, session, { method: "email", flowId: otherFlow.flowId, code: h.mailer.lastCodeFor(other.email)! }, h.ctx)).rejects.toMatchObject({
      code: "invalid_code",
    });

    const signInFlow = await startEmail(h.deps, { email: account.email, turnstileToken: "ok", ...newTestDevice() }, h.ctx);
    await expect(reauthenticate(h.deps, session, { method: "email", flowId: signInFlow.flowId, code: h.mailer.lastCodeFor(account.email)! }, h.ctx)).rejects.toMatchObject({
      code: "invalid_code",
    });

    const byEmail = await reauthenticate(h.deps, session, { method: "email", flowId, code: reauthCode }, h.ctx);
    expect(byEmail).toMatchObject({ level: 1, mustReenrollMfa: false });
    expect(byEmail.issued.session).toMatchObject({ handle: session.handle, factors: { email: h.clock.ms() } });
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(h.deps.sessions.isFresh((await h.deps.sessions.resolve(byEmail.issued.token))!.session)).toBe(true);
    await expect(reauthenticate(h.deps, byEmail.issued.session, { method: "email", flowId, code: reauthCode }, h.ctx)).rejects.toMatchObject({ code: "invalid_code" });

    // Three codes an hour, counted by the session's handle, which the rotation kept; another session of the account has three of its own.
    for (let i = 0; i < 2; i++) await startReauthEmail(h.deps, byEmail.issued.session, h.ctx);
    await expect(startReauthEmail(h.deps, byEmail.issued.session, h.ctx)).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: HOUR / 1000 });
    const second = await h.deps.sessions.issue(account.user.id, session.deviceId, { factors: { email: h.clock.ms() } });
    expect((await startReauthEmail(h.deps, second.session, h.ctx)).flowId).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test("re-authentication allows five tries per session every 15 minutes, counted by the handle so two sessions of one account share nothing and a rotation resets nothing", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const wrong = (session: Session) => reauthenticate(h.deps, session, { method: "email", flowId: randomToken(), code: "000000" }, h.ctx);
    for (let i = 0; i < 5; i++) await expect(wrong(account.session)).rejects.toMatchObject({ code: "invalid_code" });
    await expect(reauthenticate(h.deps, account.session, { method: "password", password: PASSWORD }, h.ctx)).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: (15 * MINUTE) / 1000 });

    const second = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    const ok = await reauthenticate(h.deps, second.session, { method: "password", password: PASSWORD }, h.ctx);
    expect(ok.level).toBe(1);
    // The success counted as one of the five, and the rotated session carries the count on: four more tries, then the limit.
    for (let i = 0; i < 4; i++) await expect(wrong(ok.issued.session)).rejects.toMatchObject({ code: "invalid_code" });
    await expect(wrong(ok.issued.session)).rejects.toMatchObject({ code: "rate_limited" });
  });

  test("re-authentication allows thirty tries per address every 15 minutes, whichever sessions try", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const ctx = { ...h.ctx, ipHash: randomToken() };
    const newSession = async () => (await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } })).session;
    const wrong = (session: Session) => reauthenticate(h.deps, session, { method: "email", flowId: randomToken(), code: "000000" }, ctx);
    // Six sessions, five tries each: none reaches its own limit, together they reach the address's.
    for (let s = 0; s < 6; s++) {
      const session = await newSession();
      for (let i = 0; i < 5; i++) await expect(wrong(session)).rejects.toMatchObject({ code: "invalid_code" });
    }
    await expect(wrong(await newSession())).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: (15 * MINUTE) / 1000 });
    // Another address is not affected.
    await expect(reauthenticate(h.deps, await newSession(), { method: "email", flowId: randomToken(), code: "000000" }, h.ctx)).rejects.toMatchObject({ code: "invalid_code" });
  });

  test("a recovery code re-authenticates an account with TOTP once, makes level 2 after a password, and is recorded and announced", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const without = await onboardedUser(h, repo, { password: PASSWORD });
    await expect(reauthenticate(h.deps, without.session, { method: "recovery", recoveryCode: "abcd-ef23-gh45" }, h.ctx)).rejects.toMatchObject({ code: "mfa_required", status: 400 });

    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const codes = await enableTotp(h, account.user.id);
    h.clock.advance(REAUTH_WINDOW_MS + 1_000);
    const session = (await h.deps.sessions.resolve(account.token))!.session;
    // A wrong code is refused, recorded as a failed sign-in by recovery code, and rotates nothing.
    await expect(reauthenticate(h.deps, session, { method: "recovery", recoveryCode: "abcd-ef23-gh45" }, h.ctx)).rejects.toMatchObject({ code: "invalid_mfa_code", status: 401 });
    expect(await h.deps.sessions.resolve(account.token)).not.toBeNull();

    const byPassword = await reauthenticate(h.deps, session, { method: "password", password: PASSWORD }, h.ctx);
    expect(byPassword.level).toBe(1);
    const byCode = await reauthenticate(h.deps, byPassword.issued.session, { method: "recovery", recoveryCode: codes[0]! }, h.ctx);
    expect(byCode).toMatchObject({ level: 2, mustReenrollMfa: true });
    expect(byCode.issued.session).toMatchObject({ handle: session.handle, factors: { ...byPassword.issued.session.factors, recovery: h.clock.ms() } });
    expect(await h.deps.sessions.resolve(byPassword.issued.token)).toBeNull();
    expect(h.deps.sessions.level((await h.deps.sessions.resolve(byCode.issued.token))!.session)).toBe(2);
    // The code is spent.
    expect((await repo.findUserById(account.user.id))!.recoveryCodesHash).toHaveLength(9);
    await expect(reauthenticate(h.deps, byCode.issued.session, { method: "recovery", recoveryCode: codes[0]! }, h.ctx)).rejects.toMatchObject({ code: "invalid_mfa_code" });

    const events = await eventsOf(account.user.id);
    expect(events.filter((e) => e.type === "signin_failure").map((e) => [e.ipHash, e.metadata])).toEqual([
      [h.ctx.ipHash, { method: "recovery_code" }],
      [h.ctx.ipHash, { method: "recovery_code" }],
    ]);
    expect(events.filter((e) => e.type === "recovery_code_used").map((e) => [e.deviceId, e.ipHash])).toEqual([[account.session.deviceId, h.ctx.ipHash]]);
    expect(h.mailer.sent.filter((m) => m.template === "recovery_code_used").map((m) => m.to)).toEqual([account.email]);
  });

  test("me describes the signed-in account and its profile", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    await h.deps.profiles.create({ id: account.user.id, handle: "me_test", displayName: "Me Test" });
    expect(await me(h.deps, account.session)).toEqual({
      user: { id: account.user.id, email: account.email, role: "user", onboarded: true, mfaEnabled: false, hasPassword: true, passkeys: 0 },
      profile: { id: account.user.id, handle: "me_test", displayName: "Me Test", handleChangedAt: null, verified: false },
    });
  });

  test("sessions can be listed, revoked one at a time, signed out, and revoked all at once", async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const second = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    const third = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });

    const { sessions } = await listSessions(h.deps, account.session);
    expect(sessions).toHaveLength(3);
    expect(sessions.filter((s) => s.current).map((s) => s.id)).toEqual([account.session.sessionId]);

    expect(await revokeSession(h.deps, account.session, second.session.sessionId)).toBe(true);
    expect(await revokeSession(h.deps, account.session, "0".repeat(64))).toBe(false);
    expect(await h.deps.sessions.resolve(second.token)).toBeNull();

    await signOut(h.deps, third.session);
    expect(await h.deps.sessions.resolve(third.token)).toBeNull();

    const fourth = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    expect(await revokeAllSessions(h.deps, account.session)).toBe(2);
    expect(h.mailer.sent.filter((m) => m.template === "sessions_revoked_all").map((m) => m.data.count)).toEqual(["2"]);
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(await h.deps.sessions.resolve(fourth.token)).toBeNull();
    expect((await repo.recentEvents(account.user.id)).map((e) => e.type)).toEqual(expect.arrayContaining(["session_revoked", "sessions_revoked_all"]));
  });

  test("'This wasn't me' locks the account down (every session and device, the password) once, and only for the address it was sent to", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const other = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    const link = async (stored: NotMeToken) => {
      const token = randomToken();
      await h.kv.set(notMeKey(token), JSON.stringify(stored), 60_000);
      return token;
    };
    const key = h.deps.config.authHmacKey;
    const token = await link({ userId: account.user.id, deviceId: account.session.deviceId, signedInAt: h.clock.ms(), passkeyId: null, sentTo: emailHash(key, account.email) });

    await notMe(h.deps, { token }, h.ctx);
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(await h.deps.sessions.resolve(other.token)).toBeNull();
    expect(await repo.listDevices(account.user.id)).toEqual([]);
    expect((await repo.findUserById(account.user.id))!.passwordHash).toBeNull();
    const events = await eventsOf(account.user.id);
    expect(events.filter((e) => e.type === "not_me").map((e) => [e.deviceId, e.ipHash, e.metadata])).toEqual([
      [account.session.deviceId, h.ctx.ipHash, { passkeysRemoved: [], totpCleared: false, passwordCleared: true }],
    ]);
    await expect(notMe(h.deps, { token }, h.ctx)).rejects.toMatchObject({ code: "invalid_code", message: LINK_GONE });

    // A link sent to an address the account has since left does nothing, and is spent.
    const moved = await onboardedUser(h, repo, { password: PASSWORD });
    const stale = await link({ userId: moved.user.id, deviceId: moved.session.deviceId, signedInAt: h.clock.ms(), passkeyId: null, sentTo: emailHash(key, moved.email) });
    await repo.changeEmail(moved.user.id, newTestEmail("moved"), h.clock.now());
    await expect(notMe(h.deps, { token: stale }, h.ctx)).rejects.toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    expect(await h.deps.sessions.resolve(moved.token)).not.toBeNull();
    expect((await repo.findUserById(moved.user.id))!.passwordHash).not.toBeNull();
    expect((await repo.recentEvents(moved.user.id)).map((e) => e.type)).not.toContain("not_me");
    await expect(notMe(h.deps, { token: stale }, h.ctx)).rejects.toMatchObject({ code: "invalid_code", message: LINK_GONE });
  });

  test("granting a role signs the account out everywhere so the new role applies at once", async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    expect(await grantRole(h.deps, account.email.toUpperCase(), "moderator")).toEqual({ userId: account.user.id, previousRole: "user" });
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    const again = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    expect(again.session).toMatchObject({ role: "moderator", mfaEnabled: false });
    await expect(grantRole(h.deps, "nobody-at-all@korbat.local", "admin")).rejects.toThrow(/no account/);
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
  ReauthResponse,
  RecoveryCode,
  SignupCompleteRequest,
  TotpDisableRequest,
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
  test("reauth accepts password, totp, email and recovery methods only", () => {
    expect(ReauthRequest.safeParse({ method: "password", password: "x" }).success).toBe(true);
    expect(ReauthRequest.safeParse({ method: "totp", code: "000000" }).success).toBe(true);
    expect(ReauthRequest.safeParse({ method: "email", flowId: flow, code: "000000" }).success).toBe(true);
    // A recovery code (1c design, section 7.2), normalised as the MFA step normalises it.
    expect(ReauthRequest.parse({ method: "recovery", recoveryCode: " ABCD-EF23-GH45 " })).toEqual({ method: "recovery", recoveryCode: "abcd-ef23-gh45" });
    expect(ReauthRequest.safeParse({ method: "recovery", recoveryCode: "abcd-ef01-gh45" }).success).toBe(false);
    expect(ReauthRequest.safeParse({ method: "recovery", code: "000000" }).success).toBe(false);
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
Test Files  2 failed | 41 passed | 35 skipped (78)
Tests  372 passed | 225 skipped (597)
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/passkeys-1c/write_blocks.py docs/superpowers/prompts/passkeys-1c/04-passkey-registration.md 3
```

Expected: 5 lines starting with `wrote`, one for each file below.

### Create `apps/api/src/auth/passkeys/flows.ts`

```ts
import { randomBytes } from "node:crypto";
import type { PasskeyListResponse, PasskeyRegisterOptionsRequest, PasskeyRegisterVerifyRequest, PasskeyRemoveLinkRequest, PasskeyRenameRequest, PasskeyView } from "@korbat/contracts";
import { AuthError, isUniqueViolation, type AuthDeps, type RequestContext } from "../context";
import { randomToken, sha256Hex } from "../crypto";
import { lockdown } from "../flows/lockdown";
import { notifyAccount } from "../flows/notify";
import { emailHash } from "../identifiers";
import { HOUR, enforceLimit } from "../limits";
import type { AddPasskeyOutcome, PasskeyLimits, PasskeyRow } from "../repo";
import type { Session } from "../sessions";
import { challengeKey, issueChallenge, readChallenge, spendChallenge } from "./challenge";
import { readResponseChallenge, registrationOptions, verifyRegistration, type PublicKeyCredentialCreationOptionsJSON } from "./webauthn";

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
```

### Replace `apps/api/src/auth/flows/account.ts` (whole file)

```ts
import type { MeResponse, SessionsResponse } from "@korbat/contracts";
import { AuthError, type AuthDeps } from "../context";
import type { Session } from "../sessions";
import { notifyAccount } from "./notify";

/** The signed-in account. The only response in the API that contains the email address. */
export async function me(deps: AuthDeps, session: Session): Promise<MeResponse> {
  const user = await deps.repo.findUserById(session.userId);
  if (!user) throw new AuthError("invalid_credentials", 401);
  return {
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      onboarded: user.onboardedAt !== null,
      mfaEnabled: user.totpEnabledAt !== null,
      hasPassword: user.passwordHash !== null,
      // The count only (1c design, section 7.5); the Security list is where the passkeys themselves are read.
      passkeys: await deps.repo.countPasskeys(user.id),
    },
    profile: await deps.profiles.find(user.id),
  };
}

export async function listSessions(deps: AuthDeps, session: Session): Promise<SessionsResponse> {
  return { sessions: await deps.sessions.list(session.userId, session.sessionId) };
}

/** Revokes one of the user's own sessions. False when no such live session belongs to them. */
export async function revokeSession(deps: AuthDeps, session: Session, sessionId: string): Promise<boolean> {
  const revoked = await deps.sessions.revoke(sessionId, session.userId);
  if (revoked) await deps.repo.appendEvent({ userId: session.userId, type: "session_revoked", deviceId: session.deviceId, metadata: { sessionId } });
  return revoked;
}

/** Signs out every session of the account, including the current one (the route requires fresh auth). */
export async function revokeAllSessions(deps: AuthDeps, session: Session): Promise<number> {
  const user = await deps.repo.findUserById(session.userId);
  const count = await deps.sessions.revokeAll(session.userId);
  await deps.repo.appendEvent({ userId: session.userId, type: "sessions_revoked_all", deviceId: session.deviceId, metadata: { count } });
  if (user) await notifyAccount(deps, user.email, "sessions_revoked_all", { count: String(count) });
  return count;
}

export async function signOut(deps: AuthDeps, session: Session): Promise<void> {
  await deps.sessions.revoke(session.sessionId, session.userId);
  await deps.repo.appendEvent({ userId: session.userId, type: "session_revoked", deviceId: session.deviceId, metadata: { signOut: true } });
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
import { listPasskeys, notMine, registerOptions, registerVerify, removeByLink, removePasskey, renamePasskey } from "./passkeys/flows";
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

export const ReauthRequest = z.discriminatedUnion("method", [
  z.object({ method: z.literal("password"), password: PasswordInput }),
  z.object({ method: z.literal("totp"), code: TotpCode }),
  z.object({ method: z.literal("email"), flowId: OpaqueId, code: EmailCode }),
  // A recovery code (1c design, section 7.2): only an account with TOTP holds any, and each works once.
  z.object({ method: z.literal("recovery"), recoveryCode: RecoveryCode }),
]);
export type ReauthRequest = z.infer<typeof ReauthRequest>;

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
packages/db test:       Tests  27 passed (27)
packages/contracts test:       Tests  88 passed (88)
packages/media-protocol test:       Tests  21 passed (21)
apps/app test:       Tests  32 passed (32)
apps/worker test:       Tests  45 passed (45)
apps/api test:       Tests  397 passed | 231 skipped (628)
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
Tests  229 passed (229)
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

- `apps/api/src/auth/flows/account.ts`
- `apps/api/src/auth/passkeys/flows.ts`
- `apps/api/src/auth/repo.ts`
- `apps/api/src/auth/routes.ts`
- `apps/api/test/auth/flow-harness.ts`
- `apps/api/test/auth/passkey-management.test.ts`
- `apps/api/test/integration/auth-flows-account.test.ts`
- `apps/api/test/integration/auth-passkeys.test.ts`
- `apps/api/test/integration/http-passkeys.test.ts`
- `packages/contracts/src/auth.ts`
- `packages/contracts/test/auth.test.ts`

## Step 9: commit

```bash
git add -A
git commit -q -m "feat(api,contracts): passkey registration and management: register options (strong freshness, 10 an hour, the cap of 10 passkeys and the bound of 5 a day with the wait in the refusal, the WebAuthn user handle set once by compare-and-set) and verify (the challenge read and spent before the library runs; one transaction re-checks both bounds under the user row's lock and writes the passkey and its event; the passkey_added mail carries a 7-day one-shot remove link); the list with current, new and suspended tags and the adding device; rename and delete; 'not mine' and the remove link run the lockdown; /api/me counts the passkeys" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(api,contracts): passkey registration and management: register options (strong freshness, 10 an hour, the cap of 10 passkeys and the bound of 5 a day with the wait in the refusal, the WebAuthn user handle set once by compare-and-set) and verify (the challenge read and spent before the library runs; one transaction re-checks both bounds under the user row's lock and writes the passkey and its event; the passkey_added mail carries a 7-day one-shot remove link); the list with current, new and suspended tags and the adding device; rename and delete; 'not mine' and the remove link run the lockdown; /api/me counts the passkeys`.

## Report format (mandatory)

```text
TASK 4 REPORT
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
