import { STAFF_STEP_UP_CHALLENGE } from "@korbat/contracts";
import { describe, expect, test } from "vitest";
import { createStaffApi } from "../src/api";
import { checkStepUpOptions, revokeSessionWithKey, sessionRevokeAction, StepUpMismatch } from "../src/step-up";
import { envelope, fakeCredentials, fakeFetch, OTHER_SESSION, revokeAction, SESSION_HANDLE, stepUpChallenge, stepUpOptions } from "./fixtures";

/**
 * The check of step-up options before the key is asked (3a design, section 9): the challenge must be the 74 bytes of the
 * contracts' layout with the staff_step_up purpose, bound to this session's handle and the hash of exactly the action the
 * page chose, and the allow list must hold one key; otherwise navigator.credentials.get is never called.
 */
const TARGET = "4f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a";
const THIRD = "0d4c7b9e-1f36-4e2d-9a10-6c3b4f5e8a21";
const action = revokeAction(TARGET);

/** The whole confirmation as the home screen runs it, over a fake API that answers the step-up options with `options`. */
async function revokeWith(options: unknown) {
  const fake = fakeFetch({
    "POST /api/staff/step-up/options": { status: 200, body: options },
    [`DELETE /api/staff/sessions/${TARGET}`]: { status: 204 },
  });
  const credentials = fakeCredentials();
  const api = createStaffApi({ fetch: fake.fetch, cookie: () => "__Host-korbat_staff_csrf=t" });
  const outcome = await revokeSessionWithKey({ api, credentials }, SESSION_HANDLE, TARGET).catch((err: unknown) => err);
  return { outcome, credentials, requests: fake.requests };
}

describe("the check of step-up options", () => {
  test("options bound to this session and this action pass", async () => {
    const options = stepUpOptions(await stepUpChallenge(SESSION_HANDLE, action)).options;
    await expect(checkStepUpOptions(options, SESSION_HANDLE, action)).resolves.toBeUndefined();
  });

  const refusals: [string, () => Promise<unknown>][] = [
    ["a challenge of another length (the other ceremonies' 58 bytes)", async () => stepUpOptions(await stepUpChallenge(SESSION_HANDLE, action, { bytes: 58 }))],
    ["a challenge one byte longer", async () => stepUpOptions(await stepUpChallenge(SESSION_HANDLE, action, { bytes: STAFF_STEP_UP_CHALLENGE.bytes + 1 }))],
    ["a challenge of another purpose (an app sign-in's)", async () => stepUpOptions(await stepUpChallenge(SESSION_HANDLE, action, { purpose: 1 }))],
    ["a challenge of another version", async () => stepUpOptions(await stepUpChallenge(SESSION_HANDLE, action, { version: 2 }))],
    ["a binding for another action", async () => stepUpOptions(await stepUpChallenge(SESSION_HANDLE, { ...action, action: "staff_key_revoked" }))],
    ["a binding for another target", async () => stepUpOptions(await stepUpChallenge(SESSION_HANDLE, revokeAction(THIRD)))],
    ["a binding for another target type", async () => stepUpOptions(await stepUpChallenge(SESSION_HANDLE, { ...action, target: { type: "staff_key", id: TARGET } }))],
    ["a binding for other params", async () => stepUpOptions(await stepUpChallenge(SESSION_HANDLE, { ...action, params: { all: true } }))],
    ["a binding for another session's handle", async () => stepUpOptions(await stepUpChallenge(OTHER_SESSION, action))],
    ["an allow list of two keys", async () => stepUpOptions(await stepUpChallenge(SESSION_HANDLE, action), ["Y3JlZGVudGlhbC0x", "c2Vjb25k"])],
    ["an empty allow list, which lets the browser offer any key", async () => stepUpOptions(await stepUpChallenge(SESSION_HANDLE, action), [])],
    ["no allow list at all", async () => ({ options: { challenge: await stepUpChallenge(SESSION_HANDLE, action), rpId: "localhost", userVerification: "required" } })],
  ];

  for (const [name, make] of refusals) {
    test(`refused before the key is asked: ${name}`, async () => {
      const options = (await make()) as { options: Parameters<typeof checkStepUpOptions>[0] };
      await expect(checkStepUpOptions(options.options, SESSION_HANDLE, action)).rejects.toBeInstanceOf(StepUpMismatch);
      const run = await revokeWith(options);
      expect(run.outcome).toBeInstanceOf(StepUpMismatch);
      expect(run.credentials.calls).toEqual([]);
      // The options were asked for, and nothing was sent after them.
      expect(run.requests.map((r) => r.method)).toEqual(["POST"]);
    });
  }
});

describe("revoking another session with the key", () => {
  test("the action is a lower-case staff session target with no params", () => {
    expect(sessionRevokeAction(TARGET.toUpperCase())).toEqual(action);
  });

  test("asks for options for exactly that action, asks the key once, then sends its assertion", async () => {
    const run = await revokeWith(stepUpOptions(await stepUpChallenge(SESSION_HANDLE, action)));
    expect(run.outcome).toBe("revoked");
    expect(run.credentials.calls.map((c) => c.kind)).toEqual(["get"]);
    expect(run.requests.map((r) => `${r.method} ${r.url} ${r.headers["x-staff-activity"]}`)).toEqual([
      "POST /api/staff/step-up/options 1",
      `DELETE /api/staff/sessions/${TARGET} 1`,
    ]);
    expect(run.requests[0]!.body).toEqual(action);
    expect(run.requests[1]!.body).toMatchObject({ stepUp: { id: "Y3JlZGVudGlhbC0x", type: "public-key" } });
    expect(Object.keys(run.requests[1]!.body as object)).toEqual(["stepUp"]);
  });

  test("a session already gone is no error", async () => {
    const fake = fakeFetch({
      "POST /api/staff/step-up/options": { status: 200, body: stepUpOptions(await stepUpChallenge(SESSION_HANDLE, action)) },
      [`DELETE /api/staff/sessions/${TARGET}`]: { status: 404, body: envelope("not_found") },
    });
    const api = createStaffApi({ fetch: fake.fetch, cookie: () => "" });
    await expect(revokeSessionWithKey({ api, credentials: fakeCredentials() }, SESSION_HANDLE, TARGET)).resolves.toBe("gone");
  });

  test("a confirmation the API refuses is its error", async () => {
    const fake = fakeFetch({
      "POST /api/staff/step-up/options": { status: 200, body: stepUpOptions(await stepUpChallenge(SESSION_HANDLE, action)) },
      [`DELETE /api/staff/sessions/${TARGET}`]: { status: 403, body: envelope("staff_step_up_invalid") },
    });
    const api = createStaffApi({ fetch: fake.fetch, cookie: () => "" });
    await expect(revokeSessionWithKey({ api, credentials: fakeCredentials() }, SESSION_HANDLE, TARGET)).rejects.toMatchObject({ code: "staff_step_up_invalid" });
  });
});
