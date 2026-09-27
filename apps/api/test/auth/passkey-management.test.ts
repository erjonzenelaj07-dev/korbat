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
