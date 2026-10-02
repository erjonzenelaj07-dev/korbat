import { createHash, createHmac, hkdfSync } from "node:crypto";
import { describe, expect, test } from "vitest";
import { CEREMONY_CHALLENGE, CHALLENGE_PURPOSES, STAFF_STEP_UP_CHALLENGE, stepUpActionHash, stepUpBinding } from "@korbat/contracts";
import { AuthError } from "../../src/auth/context";
import { sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { HOUR, MINUTE } from "../../src/auth/limits";
import {
  CHALLENGE_TTL_MS,
  STEP_UP_READ_MARGIN_MS,
  challengeKey,
  issueChallenge,
  issueStepUpChallenge,
  readChallenge,
  readStepUpChallenge,
  spendChallenge,
  type ChallengePurpose,
} from "../../src/auth/passkeys/challenge";

const AUTH_HMAC_KEY = Buffer.alloc(32, 3);
const KEY = challengeKey(AUTH_HMAC_KEY);
const T0 = 1_789_000_000_000;
const at = (ms: number) => new Date(T0 + ms);
const HANDLE = "0b7f3c4e-2a51-4c8e-9d7a-5b1e6f2c3d4a";
const OTHER_HANDLE = "7e2d9a10-6c3b-4f5e-8a21-0d4c7b9e1f36";
/** A staff enrolment's id, which a staff registration challenge is bound to (3a design, section 5). */
const ENROLMENT = "5d0c8e2f-9a41-4b7e-8c3d-2f6a1e9b7c05";
const OTHER_ENROLMENT = "a83f1c62-0e5d-4f9b-b217-6d4e9c0a3b18";
const PURPOSES: ChallengePurpose[] = ["signin", "register", "reauth", "staff_signin", "staff_register"];
/** The purposes whose challenge binds nothing: the two sign-ins, which run before any session or enrolment is known. */
const UNBOUND: ChallengePurpose[] = ["signin", "staff_signin"];
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
      // The staff console's two purposes share the layout, the key, the lifetime and the used-challenge markers.
      ["staff_signin", 4, undefined],
      ["staff_register", 5, ENROLMENT],
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

  test("writes the contracts' layout and purpose codes, which the console checks before it asks for the key", () => {
    const c = CEREMONY_CHALLENGE;
    for (const purpose of PURPOSES) {
      const bind = UNBOUND.includes(purpose) ? undefined : ENROLMENT;
      const challenge = issueChallenge(KEY, purpose, at(0), bind);
      expect(challenge).toHaveLength(c.encodedLength);
      const bytes = bytesOf(challenge);
      expect(bytes).toHaveLength(c.bytes);
      expect([bytes[c.versionAt], bytes[c.purposeAt]]).toEqual([c.version, CHALLENGE_PURPOSES[purpose]]);
      const binding = bind === undefined ? Buffer.alloc(c.bindingBytes) : createHash("sha256").update(bind).digest().subarray(0, c.bindingBytes);
      expect(bytes.subarray(c.bindingAt, c.bindingAt + c.bindingBytes).equals(binding)).toBe(true);
      expect(bytes.subarray(c.sealAt).equals(mac(bytes.subarray(0, c.sealAt)))).toBe(true);
    }
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
    // 4 and 5 are the staff console's purposes, which the purpose tests below cover.
    for (const purpose of [0, 99, 255]) {
      const unknown = Buffer.from(first42);
      unknown[1] = purpose;
      expectInvalid(() => readChallenge(KEY, sealed(unknown), "signin", at(0)));
    }
    // The helper seals exactly as the codec does: with the right fields its output reads.
    expect(() => readChallenge(KEY, sealed(Buffer.from(first42)), "signin", at(0))).not.toThrow();
  });

  test("refuses a challenge issued for another purpose", () => {
    for (const issued of PURPOSES) {
      const bind = UNBOUND.includes(issued) ? undefined : HANDLE;
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

describe("passkey challenges: the staff console's purposes", () => {
  test("an app sign-in challenge does not open the console's sign-in, and a console sign-in challenge does not sign into the app", () => {
    const app = issueChallenge(KEY, "signin", at(0));
    const staff = issueChallenge(KEY, "staff_signin", at(0));
    expectInvalid(() => readChallenge(KEY, app, "staff_signin", at(0)));
    expectInvalid(() => readChallenge(KEY, staff, "signin", at(0)));
    expect(() => readChallenge(KEY, app, "signin", at(0))).not.toThrow();
    expect(() => readChallenge(KEY, staff, "staff_signin", at(0))).not.toThrow();
  });

  test("a personal passkey's registration challenge does not enrol a staff key, nor the reverse, whatever they are bound to", () => {
    const personal = issueChallenge(KEY, "register", at(0), ENROLMENT);
    const staff = issueChallenge(KEY, "staff_register", at(0), HANDLE);
    expectInvalid(() => readChallenge(KEY, personal, "staff_register", at(0), ENROLMENT));
    expectInvalid(() => readChallenge(KEY, staff, "register", at(0), HANDLE));
  });

  test("a staff registration challenge is bound to its enrolment's id, and refused for another enrolment or none", () => {
    const challenge = issueChallenge(KEY, "staff_register", at(0), ENROLMENT);
    // The binding takes any string: the first 16 bytes of the sha256 of the enrolment's id, as of a session's handle.
    expect(bytesOf(challenge).subarray(26, 42).equals(createHash("sha256").update(ENROLMENT).digest().subarray(0, 16))).toBe(true);
    expect(() => readChallenge(KEY, challenge, "staff_register", at(0), ENROLMENT)).not.toThrow();
    expectInvalid(() => readChallenge(KEY, challenge, "staff_register", at(0), OTHER_ENROLMENT));
    expectInvalid(() => readChallenge(KEY, challenge, "staff_register", at(0)));
    // An unbound one of the right purpose names no enrolment.
    expectInvalid(() => readChallenge(KEY, issueChallenge(KEY, "staff_register", at(0)), "staff_register", at(0), ENROLMENT));
  });

  test("a staff sign-in challenge binds nothing, and is refused where a binding is expected", () => {
    const challenge = issueChallenge(KEY, "staff_signin", at(0));
    expect(bytesOf(challenge).subarray(26, 42).equals(Buffer.alloc(16))).toBe(true);
    expectInvalid(() => readChallenge(KEY, challenge, "staff_signin", at(0), HANDLE));
  });

  test("the staff purposes expire after ten minutes as challenge_expired, and are spent once", async () => {
    const challenge = issueChallenge(KEY, "staff_register", at(0), ENROLMENT);
    expect(() => readChallenge(KEY, challenge, "staff_register", at(CHALLENGE_TTL_MS - 1), ENROLMENT)).not.toThrow();
    expect(refusal(() => readChallenge(KEY, challenge, "staff_register", at(CHALLENGE_TTL_MS), ENROLMENT)).code).toBe("challenge_expired");
    const kv = new MemoryKv(() => T0);
    await spendChallenge(kv, challenge, at(0));
    expect((await failure(spendChallenge(kv, challenge, at(0)))).code).toBe("passkey_invalid");
  });
});

describe("passkey challenges: the step-up layout", () => {
  const LF = String.fromCharCode(10);
  /** 3a's one step-up action on a staff session, and variations of each part it binds. */
  const revoke = { action: "staff_session_revoked", target: { type: "staff_session", id: OTHER_HANDLE }, params: {} };
  const L = STAFF_STEP_UP_CHALLENGE;
  /** Seals 58 bytes as the codec does for a step-up challenge. */
  const sealedStepUp = (first58: Buffer) => Buffer.concat([first58, mac(first58)]).toString("base64url");

  test("lays out 74 bytes at the contracts' offsets: version, the step-up purpose, expiry, nonce, the full 32-byte binding and an HMAC over the first 58", async () => {
    const actionHash = await stepUpActionHash(revoke);
    const challenge = issueStepUpChallenge(KEY, at(0), HANDLE, actionHash);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{99}$/);
    expect(challenge).toHaveLength(L.encodedLength);
    const bytes = bytesOf(challenge);
    expect(bytes).toHaveLength(74);
    expect(bytes[L.versionAt]).toBe(1);
    expect(bytes[L.purposeAt]).toBe(6);
    expect(Number(bytes.readBigUInt64BE(L.expiryAt))).toBe(T0 + 10 * MINUTE);
    // The binding is every byte of the sha256 of the session's handle, a newline and the action's hash, not a prefix.
    const binding = createHash("sha256").update(`${HANDLE}${LF}${actionHash}`).digest();
    expect(bytes.subarray(L.bindingAt, L.sealAt).equals(binding)).toBe(true);
    expect(bytes.subarray(L.bindingAt, L.sealAt).equals(Buffer.from(await stepUpBinding(HANDLE, actionHash)))).toBe(true);
    expect(bytes.subarray(L.sealAt).equals(mac(bytes.subarray(0, L.sealAt)))).toBe(true);
    expect(() => readStepUpChallenge(KEY, challenge, at(0), HANDLE, actionHash)).not.toThrow();
  });

  test("draws a fresh nonce for every challenge", async () => {
    const actionHash = await stepUpActionHash(revoke);
    const a = bytesOf(issueStepUpChallenge(KEY, at(0), HANDLE, actionHash));
    const b = bytesOf(issueStepUpChallenge(KEY, at(0), HANDLE, actionHash));
    expect(a.subarray(L.nonceAt, L.bindingAt).equals(b.subarray(L.nonceAt, L.bindingAt))).toBe(false);
    expect(a.subarray(L.bindingAt, L.sealAt).equals(b.subarray(L.bindingAt, L.sealAt))).toBe(true);
  });

  test("is refused for another session, another action, another target or other params", async () => {
    const actionHash = await stepUpActionHash(revoke);
    const challenge = issueStepUpChallenge(KEY, at(0), HANDLE, actionHash);
    expectInvalid(() => readStepUpChallenge(KEY, challenge, at(0), OTHER_HANDLE, actionHash));
    const others = [
      { ...revoke, action: "staff_key_revoked" },
      { ...revoke, target: { type: "staff_session", id: HANDLE } },
      { ...revoke, target: { type: "staff_key", id: OTHER_HANDLE } },
      // 3a's one action has empty params, so other params never reach the binding over HTTP: they are tested here.
      { ...revoke, params: { all: true } },
      { ...revoke, params: { reason: "R2", items: [1, 2] } },
    ];
    for (const other of others) {
      const otherHash = await stepUpActionHash(other);
      expect(otherHash).not.toBe(actionHash);
      expectInvalid(() => readStepUpChallenge(KEY, challenge, at(0), HANDLE, otherHash));
    }
  });

  test("is refused by every other ceremony, and no other ceremony's challenge is read as a step-up", async () => {
    const actionHash = await stepUpActionHash(revoke);
    const stepUp = issueStepUpChallenge(KEY, at(0), HANDLE, actionHash);
    for (const purpose of PURPOSES) {
      expectInvalid(() => readChallenge(KEY, stepUp, purpose, at(0), UNBOUND.includes(purpose) ? undefined : HANDLE));
      const other = issueChallenge(KEY, purpose, at(0), UNBOUND.includes(purpose) ? undefined : HANDLE);
      expectInvalid(() => readStepUpChallenge(KEY, other, at(0), HANDLE, actionHash));
    }
  });

  test("refuses every tampered byte, a challenge sealed with another key, and one of another version or purpose", async () => {
    const actionHash = await stepUpActionHash(revoke);
    const challenge = issueStepUpChallenge(KEY, at(0), HANDLE, actionHash);
    for (let i = 0; i < L.bytes; i++) {
      const bytes = bytesOf(challenge);
      bytes[i] = bytes[i]! ^ 0x01;
      expectInvalid(() => readStepUpChallenge(KEY, bytes.toString("base64url"), at(0), HANDLE, actionHash));
    }
    expectInvalid(() => readStepUpChallenge(KEY, issueStepUpChallenge(challengeKey(Buffer.alloc(32, 4)), at(0), HANDLE, actionHash), at(0), HANDLE, actionHash));
    const first58 = bytesOf(challenge).subarray(0, L.sealAt);
    for (const [at_, value] of [
      [L.versionAt, 2],
      [L.purposeAt, 1],
      [L.purposeAt, 5],
      [L.purposeAt, 7],
    ] as const) {
      const changed = Buffer.from(first58);
      changed[at_] = value;
      expectInvalid(() => readStepUpChallenge(KEY, sealedStepUp(changed), at(0), HANDLE, actionHash));
    }
    // The helper seals exactly as the codec does: with the right fields its output reads.
    expect(() => readStepUpChallenge(KEY, sealedStepUp(Buffer.from(first58)), at(0), HANDLE, actionHash)).not.toThrow();
  });

  test("refuses anything that is not exactly 74 bytes of canonical, unpadded base64url", async () => {
    const actionHash = await stepUpActionHash(revoke);
    const challenge = issueStepUpChallenge(KEY, at(0), HANDLE, actionHash);
    const bytes = bytesOf(challenge);
    // 74 bytes leave 4 spare bits in the last character, which Node's decoder ignores.
    const last = BASE64URL_ALPHABET.indexOf(challenge.at(-1)!);
    const nonCanonical = challenge.slice(0, -1) + BASE64URL_ALPHABET[last | 1];
    expect(bytesOf(nonCanonical).equals(bytes)).toBe(true);
    for (const candidate of [
      "",
      bytes.subarray(0, 73).toString("base64url"),
      Buffer.concat([bytes, Buffer.from([0])]).toString("base64url"),
      `${challenge}=`,
      bytes.toString("base64"),
      nonCanonical,
      "A".repeat(10_000),
    ]) {
      expectInvalid(() => readStepUpChallenge(KEY, candidate, at(0), HANDLE, actionHash));
    }
  });

  test("carries an expiry ten minutes after it was issued, but is read only while a minute of that is left: challenge_expired, checked after the seal and the binding", async () => {
    const actionHash = await stepUpActionHash(revoke);
    const challenge = issueStepUpChallenge(KEY, at(0), HANDLE, actionHash);
    // The expiry it carries, which audit-verify compares with the row's time, is the full ten minutes.
    expect(Number(bytesOf(challenge).readBigUInt64BE(L.expiryAt))).toBe(T0 + CHALLENGE_TTL_MS);
    expect(STEP_UP_READ_MARGIN_MS).toBe(MINUTE);
    expect(() => readStepUpChallenge(KEY, challenge, at(CHALLENGE_TTL_MS - STEP_UP_READ_MARGIN_MS - 1), HANDLE, actionHash)).not.toThrow();
    for (const late of [CHALLENGE_TTL_MS - STEP_UP_READ_MARGIN_MS, CHALLENGE_TTL_MS - 1, CHALLENGE_TTL_MS]) {
      const err = refusal(() => readStepUpChallenge(KEY, challenge, at(late), HANDLE, actionHash));
      expect([late, err.code, err.status]).toEqual([late, "challenge_expired", 400]);
    }
    // An expired challenge for another session is still passkey_invalid: nothing tells which field failed first.
    expectInvalid(() => readStepUpChallenge(KEY, challenge, at(HOUR), OTHER_HANDLE, actionHash));
  });

  test("is spent once through the same used-challenge markers, for the rest of its life", async () => {
    let clock = T0;
    const kv = new MemoryKv(() => clock);
    const challenge = issueStepUpChallenge(KEY, at(0), HANDLE, await stepUpActionHash(revoke));
    await spendChallenge(kv, challenge, at(0));
    expect(await kv.get(spentKey(challenge))).toBe("1");
    expect((await failure(spendChallenge(kv, challenge, at(0)))).code).toBe("passkey_invalid");
    clock = T0 + CHALLENGE_TTL_MS;
    expect(await kv.get(spentKey(challenge))).toBeNull();
    expect((await failure(spendChallenge(kv, challenge, at(CHALLENGE_TTL_MS)))).code).toBe("challenge_expired");
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
