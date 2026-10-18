import { StaffErrorCode } from "@korbat/contracts";
import { describe, expect, test } from "vitest";
import { ApiError, createStaffApi, readCookie } from "../src/api";
import { describeError, messageFor, STAFF_MESSAGES } from "../src/messages";
import { envelope, fakeFetch, makeMe, revokeAction, SESSION_HANDLE } from "./fixtures";

const CSRF = "__Host-korbat_staff_csrf";

/** An API client over a fake fetch, with the hooks the store sets recorded. */
function client(table: Parameters<typeof fakeFetch>[0], cookie = `__Host-korbat_csrf=app-token; ${CSRF}=staff-token`) {
  const fake = fakeFetch(table);
  const api = createStaffApi({ fetch: fake.fetch, cookie: () => cookie });
  const events: string[] = [];
  api.hooks.onSessionRequired = (carriedStaffCookie) => events.push(`session-required ${carriedStaffCookie ? "with" : "without"} the staff cookie`);
  api.hooks.onActivity = () => events.push("activity");
  return { api, requests: fake.requests, events };
}

describe("the fetch wrapper", () => {
  test("sends the activity mark only when the caller asks for it", async () => {
    const { api, requests } = client({ "GET /api/staff/me": { status: 200, body: makeMe() } });
    await api.me({ activity: true });
    await api.me({ activity: false });
    await api.me();
    expect(requests.map((r) => r.headers["x-staff-activity"])).toEqual(["1", undefined, undefined]);
  });

  test("echoes the staff CSRF cookie in x-staff-csrf, never the app's, and never the app's header", async () => {
    const { api, requests } = client({ "POST /api/staff/signout": { status: 204 } });
    await api.signOut({ activity: true });
    expect(requests[0]!.headers["x-staff-csrf"]).toBe("staff-token");
    expect(requests[0]!.headers["x-csrf-token"]).toBeUndefined();
    expect(requests[0]!.headers.authorization).toBeUndefined();
  });

  test("sends no CSRF header while there is no staff CSRF cookie", async () => {
    const { api, requests } = client({ "POST /api/staff/signin/options": { status: 200, body: { options: { challenge: "abc" } } } }, "__Host-korbat_csrf=app-token");
    await api.signInOptions({ activity: true });
    expect(requests[0]!.headers["x-staff-csrf"]).toBeUndefined();
  });

  test("reads a cookie by its exact name", () => {
    expect(readCookie(`a=1; ${CSRF}x=2; ${CSRF}=3`, CSRF)).toBe("3");
    expect(readCookie("", CSRF)).toBeUndefined();
    expect(readCookie(`${CSRF}=a%20b`, CSRF)).toBe("a b");
  });

  test("every request goes to its own path on the console's origin, with JSON bodies", async () => {
    const { api, requests } = client({
      "DELETE /api/staff/sessions/7e2d9a10-6c3b-4f5e-8a21-0d4c7b9e1f36": { status: 204 },
      "POST /api/staff/step-up/options": { status: 200, body: { options: { challenge: "abc" } } },
    });
    const action = revokeAction("7e2d9a10-6c3b-4f5e-8a21-0d4c7b9e1f36");
    await api.stepUpOptions(action, { activity: true });
    const stepUp = { id: "aWQ", rawId: "aWQ", type: "public-key" as const, response: { clientDataJSON: "Y2Q", authenticatorData: "YWQ", signature: "c2c" }, clientExtensionResults: {} };
    await api.revokeSession("7e2d9a10-6c3b-4f5e-8a21-0d4c7b9e1f36", { stepUp }, { activity: true });
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual(["POST /api/staff/step-up/options", "DELETE /api/staff/sessions/7e2d9a10-6c3b-4f5e-8a21-0d4c7b9e1f36"]);
    expect(requests[0]!.body).toEqual(action);
    expect(requests[0]!.headers["content-type"]).toBe("application/json");
    expect(requests[1]!.body).toEqual({ stepUp });
  });

  test("the audit reader's query: the filter, a cursor or a place", async () => {
    const page = { entries: [], nextCursor: null, copy: { lastPlace: null } };
    const { api, requests } = client({
      "GET /api/staff/audit": { status: 200, body: page },
      "GET /api/staff/audit?cursor=51": { status: 200, body: page },
      "GET /api/staff/audit?at=7": { status: 200, body: page },
      "GET /api/staff/audit?action=staff_sign_in&cursor=9": { status: 200, body: page },
    });
    await api.audit({});
    await api.audit({ cursor: 51 });
    await api.audit({ at: 7 });
    await api.audit({ action: "staff_sign_in", cursor: 9 });
    expect(requests.map((r) => r.url)).toEqual(["/api/staff/audit", "/api/staff/audit?cursor=51", "/api/staff/audit?at=7", "/api/staff/audit?action=staff_sign_in&cursor=9"]);
  });

  test("every answer is parsed with the contracts' schemas", async () => {
    const { api } = client({
      "GET /api/staff/me": { status: 200, body: { ...makeMe(), role: "user" } },
      "GET /api/staff/keys": { status: 200, body: { keys: [{ id: "not-a-uuid", name: "k", createdAt: "2026-10-01T09:00:00.000Z", lastUsedAt: null }] } },
      "GET /api/staff/sessions": { status: 200, body: { sessions: [] } },
    });
    // A role that opens no console, and a key whose id is no uuid, are not answers the console can show.
    await expect(api.me()).rejects.toMatchObject({ code: "invalid_answer" });
    await expect(api.keys()).rejects.toMatchObject({ code: "invalid_answer" });
    await expect(api.sessions()).resolves.toEqual({ sessions: [] });
  });

  test("an answer that is not JSON is no answer either", async () => {
    const api = createStaffApi({ fetch: async () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }), cookie: () => "" });
    await expect(api.me()).rejects.toMatchObject({ code: "invalid_answer" });
  });

  test("an error answer becomes an ApiError with the server's code and the console's own words", async () => {
    const { api } = client({ "POST /api/staff/signin/verify": { status: 403, body: envelope("staff_key_not_device_bound", "<b>the server's words</b>") } });
    const response = { id: "aWQ", rawId: "aWQ", type: "public-key" as const, response: { clientDataJSON: "Y2Q", authenticatorData: "YWQ", signature: "c2c" }, clientExtensionResults: {} };
    const err = await api.signInVerify({ response }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 403, code: "staff_key_not_device_bound", message: STAFF_MESSAGES.staff_key_not_device_bound });
  });

  test("a 404 without an envelope is not_found, a failed fetch is network, anything else unknown is internal", async () => {
    const notFound = createStaffApi({ fetch: async () => new Response("Not Found", { status: 404 }), cookie: () => "" });
    await expect(notFound.me()).rejects.toMatchObject({ status: 404, code: "not_found" });
    const down = createStaffApi({ fetch: async () => Promise.reject(new TypeError("Failed to fetch")), cookie: () => "" });
    await expect(down.me()).rejects.toMatchObject({ status: 0, code: "network" });
    const broken = createStaffApi({ fetch: async () => new Response("oops", { status: 502 }), cookie: () => "" });
    await expect(broken.me()).rejects.toMatchObject({ status: 502, code: "internal" });
  });

  test("staff_session_required calls the session hook, whichever request answered it", async () => {
    const { api, events } = client({ "GET /api/staff/keys": { status: 401, body: envelope("staff_session_required") } });
    await expect(api.keys({ activity: true })).rejects.toMatchObject({ code: "staff_session_required" });
    expect(events).toEqual(["session-required with the staff cookie"]);
  });

  test("the session hook is told whether the refused request carried the staff CSRF cookie, read before it was sent", async () => {
    // The answer clears the cookie, so only what the request carried can say that a sign-in had set it.
    let cookie = `${CSRF}=staff-token`;
    const fake = fakeFetch({
      "GET /api/staff/me": () => {
        cookie = "";
        return { status: 401, body: envelope("staff_session_required") };
      },
    });
    const api = createStaffApi({ fetch: fake.fetch, cookie: () => cookie });
    const told: boolean[] = [];
    api.hooks.onSessionRequired = (carriedStaffCookie) => told.push(carriedStaffCookie);
    await api.me({ activity: true }).catch(() => undefined);
    await api.me({ activity: true }).catch(() => undefined);
    expect(told).toEqual([true, false]);
  });

  test("the activity hook runs after a marked request succeeds, and after no other", async () => {
    const { api, events } = client({
      "GET /api/staff/me": [{ status: 200, body: makeMe() }, { status: 200, body: makeMe() }, { status: 403, body: envelope("csrf_failed") }],
    });
    await api.me({ activity: false });
    expect(events).toEqual([]);
    await api.me({ activity: true });
    expect(events).toEqual(["activity"]);
    await expect(api.me({ activity: true })).rejects.toMatchObject({ code: "csrf_failed" });
    expect(events).toEqual(["activity"]);
  });

  test("a session revocation answers nothing on success", async () => {
    const { api } = client({ [`DELETE /api/staff/sessions/${SESSION_HANDLE}`]: { status: 204 } });
    const stepUp = { id: "aWQ", rawId: "aWQ", type: "public-key" as const, response: { clientDataJSON: "Y2Q", authenticatorData: "YWQ", signature: "c2c" }, clientExtensionResults: {} };
    await expect(api.revokeSession(SESSION_HANDLE, { stepUp })).resolves.toBeUndefined();
  });
});

describe("the console's words", () => {
  test("every staff code has the design's sentence", () => {
    expect(STAFF_MESSAGES).toEqual({
      staff_session_required: "Your staff session ended. Sign in with your staff key.",
      staff_key_invalid: "This key does not open the staff console. If it should, ask the operator to check your staff keys.",
      staff_key_suspended: "This staff key was switched off because a copy of it may exist. Ask the operator for a link to enrol a new one.",
      staff_key_limit: "This account has 5 staff keys. Ask the operator to revoke one before enrolling another.",
      staff_key_not_device_bound: "This key can be synced or copied, so it cannot be a staff key. Use a security key or a device-bound authenticator.",
      staff_key_not_user_verified: "This key did not ask for a PIN or fingerprint, so it cannot be a staff key. Set a PIN on it, or use another key.",
      staff_key_refused: "The browser's answer for this key could not be checked. Try again, or use another key; this link still works.",
      staff_enrollment_invalid: "This enrolment link has expired or was already used. Ask the operator for a new one.",
      staff_step_up_required: "Confirm this with your staff key.",
      staff_step_up_invalid: "That confirmation was for another action, was already used or could not be checked. Try again.",
    });
    expect(Object.keys(STAFF_MESSAGES).sort()).toEqual([...StaffErrorCode.options].sort());
  });

  test("the shared codes a staff route may answer have words of their own", () => {
    for (const code of ["challenge_expired", "rate_limited", "invalid_request", "not_found", "csrf_failed", "internal", "network", "invalid_answer"]) {
      expect(messageFor(code), code).not.toBe(messageFor("no_such_code"));
    }
  });

  test("never a passkey_* text, which sends people to the app's remedies", () => {
    for (const code of ["passkey_invalid", "passkey_unsupported", "passkey_suspended", "passkey_limit"]) {
      expect(messageFor(code)).toBe(messageFor("no_such_code"));
    }
    expect(messageFor("no_such_code")).not.toMatch(/passkey/i);
  });

  test("the server's own message is never shown", () => {
    expect(describeError(new ApiError(403, "staff_key_invalid", "<b>the server's words</b>"))).toBe(STAFF_MESSAGES.staff_key_invalid);
    expect(describeError(new Error("<b>anything</b>"))).toBe(messageFor("no_such_code"));
  });
});
