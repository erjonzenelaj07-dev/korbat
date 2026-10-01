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
    // No hint unless a caller asks for one: 1c's registration names no kind of authenticator.
    expect(options.hints).toEqual([]);
    expect(options.excludeCredentials).toEqual([{ id: "AAECAw", transports: ["internal", "hybrid"], type: "public-key" }]);
  });

  test("registration options require user verification only when asked, and carry the security-key hint only when asked", async () => {
    const input = () => ({
      rp: { id: "console.localhost", name: RP_NAME },
      user: { id: USER_HANDLE, name: "Blue key", displayName: "Blue key" },
      exclude: [],
      challenge: issueChallenge(KEY, "staff_register", NOW, HANDLE),
    });
    // What every staff ceremony asks for (3a design, section 5); 1c's callers name nothing and keep "preferred".
    const required = await registrationOptions({ ...input(), userVerification: "required" });
    expect(required.authenticatorSelection).toEqual({ residentKey: "required", requireResidentKey: true, userVerification: "required" });
    expect(required.hints).toEqual([]);
    expect((await registrationOptions({ ...input(), userVerification: "preferred" })).authenticatorSelection!.userVerification).toBe("preferred");
    expect((await registrationOptions(input())).authenticatorSelection!.userVerification).toBe("preferred");
    // The enrolment's "Register a security key" button: the library sends the hint only with cross-platform attachment,
    // which is why "Use Windows Hello on this computer" sends none.
    const securityKey = await registrationOptions({ ...input(), userVerification: "required", hint: "securityKey" });
    expect(securityKey.hints).toEqual(["security-key"]);
    expect(securityKey.authenticatorSelection).toEqual({ residentKey: "required", requireResidentKey: true, userVerification: "required", authenticatorAttachment: "cross-platform" });
    // The library writes the attachment into the object it is given: the next call without a hint has none.
    expect((await registrationOptions({ ...input(), userVerification: "required" })).authenticatorSelection).toEqual({ residentKey: "required", requireResidentKey: true, userVerification: "required" });
  });

  test("authentication options require user verification only when asked", async () => {
    const challenge = () => issueChallenge(KEY, "staff_signin", NOW);
    expect((await authenticationOptions({ rpId: "console.localhost", allow: [], challenge: challenge(), userVerification: "required" })).userVerification).toBe("required");
    expect((await authenticationOptions({ rpId: RP_ID, allow: [], challenge: challenge(), userVerification: "preferred" })).userVerification).toBe("preferred");
    expect((await authenticationOptions({ rpId: RP_ID, allow: [], challenge: challenge() })).userVerification).toBe("preferred");
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
    // BE as this assertion reported it: the staff flows refuse a key that reports it at any use (3a design, section 2).
    expect(result).toEqual({ newCounter: 7, userVerified: true, backedUp: false, backupEligible: true });
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
    expect(result).toEqual({ newCounter: 1, userVerified: false, backedUp: false, backupEligible: false });
  });

  test("the BE and BS flags are reported as each assertion carries them, whatever the registration said", async () => {
    const auth = new SoftAuthenticator();
    const { passkey } = await registered(auth, { flags: { up: true, uv: true, be: false, bs: false } });
    const credential = { id: passkey.credentialId, publicKey: passkey.publicKey, transports: passkey.transports };
    for (const [flags, expected] of [
      [{ up: true, uv: true, be: false, bs: false }, { backupEligible: false, backedUp: false }],
      [{ up: true, uv: true, be: true, bs: false }, { backupEligible: true, backedUp: false }],
      [{ up: true, uv: true, be: true, bs: true }, { backupEligible: true, backedUp: true }],
    ] as const) {
      const { challenge, response } = assertion(auth, passkey.credentialId, flags, 1);
      expect(await verifyAuthentication({ response, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID, credential })).toMatchObject(expected);
    }
    // BS without BE is impossible, and the library refuses it.
    const { challenge, response } = assertion(auth, passkey.credentialId, { up: true, uv: true, be: false, bs: true }, 1);
    await expectInvalid(verifyAuthentication({ response, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID, credential }));
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
