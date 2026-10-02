import { CHALLENGE_PURPOSES, STAFF_STEP_UP_CHALLENGE } from "@korbat/contracts";
import { describe, expect, test } from "vitest";
import { createStaffApi } from "../src/api";
import { CeremonyMismatch, checkSignInChallenge } from "../src/challenge";
import { signInWithKey } from "../src/sign-in";
import { ceremonyChallenge, fakeCredentials, fakeFetch, makeMe, registerChallenge, revokeAction, SESSION_HANDLE, signInOptions, stepUpChallenge } from "./fixtures";

/**
 * The check of sign-in options before the key is asked (3a design, section 9, F1 of the review of Tasks 1 to 7): the
 * challenge must be the contracts' 58-byte layout, version 1, with the staff_signin purpose and the zero binding of a
 * challenge bound to nothing. Otherwise navigator.credentials.get is never called. A step-up challenge served as sign-in
 * options would otherwise be signed at an ordinary sign-in, and the assertion would pass audit-verify as a confirmation
 * of an action the person never chose.
 */
const ME = makeMe();

/** A whole sign-in over a fake API that answers the sign-in options with `options`. */
async function signInWith(options: unknown, only?: string) {
  const fake = fakeFetch({
    "POST /api/staff/signin/options": { status: 200, body: options },
    "POST /api/staff/signin/verify": { status: 200, body: ME },
  });
  const credentials = fakeCredentials();
  const api = createStaffApi({ fetch: fake.fetch, cookie: () => "" });
  const outcome = await signInWithKey({ api, credentials }, only).catch((err: unknown) => err);
  return { outcome, credentials, requests: fake.requests };
}

describe("the check of sign-in options", () => {
  test("a staff sign-in challenge passes, and the key is asked once, then the assertion is sent", async () => {
    expect(() => checkSignInChallenge(signInOptions().options)).not.toThrow();
    const run = await signInWith(signInOptions());
    expect(run.outcome).toEqual(ME);
    expect(run.credentials.calls.map((c) => c.kind)).toEqual(["get"]);
    expect(run.requests.map((r) => `${r.method} ${r.url} ${r.headers["x-staff-activity"]}`)).toEqual(["POST /api/staff/signin/options 1", "POST /api/staff/signin/verify 1"]);
  });

  const refusals: [string, () => Promise<string>][] = [
    // The attack: an API under an attacker's control hands out a step-up challenge for an action of its choosing.
    ["a step-up challenge (74 bytes, bound to an action)", () => stepUpChallenge(SESSION_HANDLE, revokeAction("4f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a"))],
    ["a step-up challenge cut to 58 bytes", () => stepUpChallenge(SESSION_HANDLE, revokeAction("4f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a"), { bytes: 58 })],
    ["the step-up purpose in the 58-byte layout", async () => ceremonyChallenge({ purpose: STAFF_STEP_UP_CHALLENGE.purpose })],
    ["an app sign-in's purpose", async () => ceremonyChallenge({ purpose: CHALLENGE_PURPOSES.signin })],
    ["a staff registration's purpose", async () => registerChallenge()],
    ["another version", async () => ceremonyChallenge({ version: 2 })],
    ["a binding, where a sign-in is bound to nothing", async () => ceremonyChallenge({ binding: Buffer.alloc(16, 1) })],
    ["one byte short", async () => ceremonyChallenge({ bytes: 57 })],
    ["one byte long", async () => ceremonyChallenge({ bytes: 59 })],
  ];

  for (const [name, make] of refusals) {
    test(`refused before the key is asked: ${name}`, async () => {
      const options = signInOptions(await make());
      expect(() => checkSignInChallenge(options.options)).toThrow(CeremonyMismatch);
      const run = await signInWith(options);
      expect(run.outcome).toBeInstanceOf(CeremonyMismatch);
      expect((run.outcome as CeremonyMismatch).code).toBe("signin_mismatch");
      expect(run.credentials.calls).toEqual([]);
      // The options were asked for, and nothing was sent after them.
      expect(run.requests.map((r) => r.url)).toEqual(["/api/staff/signin/options"]);
    });
  }
});

describe("signing in with one key only", () => {
  test("the allow list holds exactly the key named, whatever the options listed", async () => {
    const options = signInOptions();
    const listed = { options: { ...options.options, allowCredentials: [{ id: "b3RoZXIta2V5", type: "public-key" }] } };
    const run = await signInWith(listed, "bmV3LWtleQ");
    expect(run.outcome).toEqual(ME);
    const asked = run.credentials.calls[0]!.options as { publicKey: PublicKeyCredentialRequestOptions };
    expect(asked.publicKey.allowCredentials?.map((c) => [Buffer.from(c.id as Uint8Array).toString("base64url"), c.type])).toEqual([["bmV3LWtleQ", "public-key"]]);
    expect(asked.publicKey.userVerification).toBe("required");
  });

  test("options for one key are checked like any other", async () => {
    const run = await signInWith(signInOptions(await stepUpChallenge(SESSION_HANDLE, revokeAction(SESSION_HANDLE))), "bmV3LWtleQ");
    expect(run.outcome).toBeInstanceOf(CeremonyMismatch);
    expect(run.credentials.calls).toEqual([]);
  });
});
