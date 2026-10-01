import { describe, expect, test } from "vitest";
import { createStaffApi } from "../src/api";
import { enrollKey, type SignalApi } from "../src/enroll";
import { enrollOptions, envelope, fakeCredentials, fakeFetch } from "./fixtures";

/**
 * Enrolment (3a design, section 9): options for the key's name and kind, the browser's registration, then the verify.
 * After a refusal for a synced key or one without user verification, and only when the console's relying party ID is not
 * the app's (rpShared false), the page asks the password manager to drop the credential it just made, through the Signal
 * API where the browser has it.
 */
const TOKEN = "A".repeat(20) + "b_-".repeat(7) + "zz";
const KEY = { id: "5b0e4a52-3c1d-4f6e-9a8b-7c6d5e4f3a2b", name: "Blue key", createdAt: "2026-10-01T09:00:00.000Z", lastUsedAt: null };

function run(rpShared: boolean, verify: { status: number; body?: unknown }, signal: SignalApi | undefined) {
  const fake = fakeFetch({
    "POST /api/staff/enroll/options": { status: 200, body: enrollOptions(rpShared) },
    "POST /api/staff/enroll/verify": verify,
  });
  const credentials = fakeCredentials();
  const api = createStaffApi({ fetch: fake.fetch, cookie: () => "" });
  return { result: enrollKey({ api, credentials, signal }, { token: TOKEN, name: "Blue key", kind: "security_key" }), requests: fake.requests, credentials };
}

/** A Signal API that records its calls. */
function recordingSignal() {
  const calls: unknown[] = [];
  const signal: SignalApi = {
    signalUnknownCredential: async (options) => {
      calls.push(options);
    },
  };
  return { signal, calls };
}

describe("enrolling a staff key", () => {
  test("options for the name and kind, the browser's registration, then the verify with the same token and name", async () => {
    const { signal, calls } = recordingSignal();
    const r = run(false, { status: 200, body: { key: KEY } }, signal);
    expect(await r.result).toEqual({ ok: true, key: KEY });
    expect(r.requests.map((q) => `${q.method} ${q.url} ${q.headers["x-staff-activity"]}`)).toEqual(["POST /api/staff/enroll/options 1", "POST /api/staff/enroll/verify 1"]);
    expect(r.requests[0]!.body).toEqual({ token: TOKEN, name: "Blue key", kind: "security_key" });
    expect(r.requests[1]!.body).toMatchObject({ token: TOKEN, name: "Blue key", response: { id: "bmV3LWtleQ", type: "public-key" } });
    expect(r.credentials.calls.map((c) => c.kind)).toEqual(["create"]);
    expect(calls).toEqual([]);
  });

  for (const code of ["staff_key_not_device_bound", "staff_key_not_user_verified"]) {
    test(`${code}: the Signal API drops the new credential when the relying party is the console's own`, async () => {
      const { signal, calls } = recordingSignal();
      const r = run(false, { status: 403, body: envelope(code) }, signal);
      expect(await r.result).toEqual({ ok: false, code, status: 403, cleanup: "signalled" });
      expect(calls).toEqual([{ rpId: "localhost", credentialId: "bmV3LWtleQ" }]);
    });

    test(`${code}: never while the relying party is shared with the app, where it could drop the app's passkeys`, async () => {
      const { signal, calls } = recordingSignal();
      const r = run(true, { status: 403, body: envelope(code) }, signal);
      expect(await r.result).toEqual({ ok: false, code, status: 403, cleanup: "by-hand" });
      expect(calls).toEqual([]);
    });

    test(`${code}: a browser without the call is told to delete the entry by hand`, async () => {
      expect(await run(false, { status: 403, body: envelope(code) }, undefined).result).toMatchObject({ cleanup: "by-hand" });
      expect(await run(false, { status: 403, body: envelope(code) }, {}).result).toMatchObject({ cleanup: "by-hand" });
      const failing: SignalApi = { signalUnknownCredential: async () => Promise.reject(new Error("no")) };
      expect(await run(false, { status: 403, body: envelope(code) }, failing).result).toMatchObject({ cleanup: "by-hand" });
    });
  }

  test("any other refusal leaves the password manager alone", async () => {
    for (const code of ["staff_key_refused", "staff_enrollment_invalid", "staff_key_limit", "challenge_expired"]) {
      const { signal, calls } = recordingSignal();
      const result = await run(false, { status: 400, body: envelope(code) }, signal).result;
      expect(result, code).toEqual({ ok: false, code, status: 400, cleanup: "none" });
      expect(calls).toEqual([]);
    }
  });

  test("a refused options request asks the browser nothing", async () => {
    const fake = fakeFetch({ "POST /api/staff/enroll/options": { status: 400, body: envelope("staff_enrollment_invalid") } });
    const credentials = fakeCredentials();
    const api = createStaffApi({ fetch: fake.fetch, cookie: () => "" });
    expect(await enrollKey({ api, credentials, signal: undefined }, { token: TOKEN, name: "Blue key", kind: "this_device" })).toEqual({
      ok: false,
      code: "staff_enrollment_invalid",
      status: 400,
      cleanup: "none",
    });
    expect(credentials.calls).toEqual([]);
  });

  test("a console that is off answers the options 404", async () => {
    const fake = fakeFetch({});
    const api = createStaffApi({ fetch: fake.fetch, cookie: () => "" });
    expect(await enrollKey({ api, credentials: fakeCredentials(), signal: undefined }, { token: TOKEN, name: "Blue key", kind: "this_device" })).toMatchObject({ ok: false, code: "not_found", status: 404 });
  });

  test("a prompt the person closed sends nothing to the API", async () => {
    const fake = fakeFetch({ "POST /api/staff/enroll/options": { status: 200, body: enrollOptions(false) } });
    const api = createStaffApi({ fetch: fake.fetch, cookie: () => "" });
    const closed = fakeCredentials({ create: async () => Promise.reject(Object.assign(new Error("closed"), { name: "NotAllowedError" })) });
    const result = await enrollKey({ api, credentials: closed, signal: undefined }, { token: TOKEN, name: "Blue key", kind: "this_device" });
    expect(result).toEqual({ ok: false, code: "ceremony_cancelled", status: 0, cleanup: "none" });
    expect(fake.requests.map((q) => q.url)).toEqual(["/api/staff/enroll/options"]);
  });
});
