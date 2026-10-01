import { AuthErrorCode, StaffErrorCode } from "@korbat/contracts";
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

  test("every staff code has the wording of the 3a design (section 10), which the module raises as an AuthError", () => {
    const expected: Record<StaffErrorCode, string> = {
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
    };
    for (const code of StaffErrorCode.options) {
      expect(authErrorMessage(code), code).toBe(expected[code]);
      expect(new AuthError(code, 403).message, code).toBe(expected[code]);
    }
  });

  test("an AuthError carries the message of its code unless the flow gives its own", () => {
    expect(new AuthError("passkey_not_found", 404).message).toBe("That passkey is gone.");
    const daily = new AuthError("passkey_limit", 409, "You added 5 passkeys today. You can add another in about 3 hours.");
    expect(daily).toMatchObject({ code: "passkey_limit", status: 409, message: "You added 5 passkeys today. You can add another in about 3 hours." });
  });

  test("an AuthError can carry details for the app, such as the level a refusal asks for and the factors proven in time", () => {
    const refusal = new AuthError("reauth_required", 403, undefined, undefined, { level: 2, have: ["email"] });
    expect(refusal).toMatchObject({ code: "reauth_required", status: 403, message: "Confirm it's you to continue.", details: { level: 2, have: ["email"] } });
    expect(refusal.retryAfterSeconds).toBeUndefined();
    expect(new AuthError("rate_limited", 429, undefined, 60).details).toBeUndefined();
  });
});
