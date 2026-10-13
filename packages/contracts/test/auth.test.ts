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
  SessionInfo,
  SessionsResponse,
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
  test("a listed session is named by its handle, a uuid that stays while its token rotates, and never by the token's hash", () => {
    const session = { id: userId, deviceLabel: "Chrome on Windows", platform: "web", createdAt: "2026-09-24T10:00:00.000Z", lastUsedAt: "2026-09-24T10:05:00.000Z", current: true };
    expect(SessionsResponse.parse({ sessions: [session, { ...session, id: "0b0e7c1a-5a53-4f0e-8a3f-2f6f8f5d9c11", platform: "ios", current: false }] }).sessions.map((s) => [s.id, s.current])).toEqual([
      [userId, true],
      ["0b0e7c1a-5a53-4f0e-8a3f-2f6f8f5d9c11", false],
    ]);
    // What the list carried before: sha256 of the token, which a rotation replaces, so a listed session could not be revoked after one.
    expect(SessionInfo.safeParse({ ...session, id: "a".repeat(64) }).success).toBe(false);
    expect(SessionInfo.safeParse({ ...session, id: "not-a-uuid" }).success).toBe(false);
    expect(SessionInfo.safeParse({ ...session, id: undefined }).success).toBe(false);
    expect(SessionInfo.safeParse({ ...session, platform: "desktop" }).success).toBe(false);
  });
  test("me response carries email, the count of passkeys and a nullable profile", () => {
    const me = {
      user: { id: userId, email: "a@b.io", role: "user", onboarded: false, mfaEnabled: false, hasPassword: false, passkeys: 0 },
      profile: null,
      standing: null,
    };
    expect(MeResponse.parse(me)).toEqual(me);
    // The count decides whether the app offers a passkey re-authentication and the suggestion card (1c design, section 9), so it is never left out.
    expect(MeResponse.parse({ ...me, user: { ...me.user, passkeys: 3 } }).user.passkeys).toBe(3);
    expect(MeResponse.safeParse({ ...me, user: { ...me.user, passkeys: undefined } }).success).toBe(false);
    expect(MeResponse.safeParse({ ...me, user: { ...me.user, passkeys: -1 } }).success).toBe(false);
    expect(MeResponse.safeParse({ ...me, user: { ...me.user, passkeys: 1.5 } }).success).toBe(false);
  });
  test("the own profile in the me response says when the handle last changed, whether the badge is held and whether the account's posts show in Explore", () => {
    const user = { id: userId, email: "a@b.io", role: "user", onboarded: true, mfaEnabled: false, hasPassword: false, passkeys: 0 };
    const profile = { id: userId, handle: "ada", displayName: "Ada", handleChangedAt: null, verified: false, showInExplore: true };
    expect(MeResponse.parse({ user, profile, standing: null })).toEqual({ user, profile, standing: null });
    expect(MeProfile.parse({ ...profile, handleChangedAt: "2026-09-24T10:00:00.000Z", verified: true }).verified).toBe(true);
    // The author's own switch (2c design, section 8), off as well as on.
    expect(MeProfile.parse({ ...profile, showInExplore: false }).showInExplore).toBe(false);
    // The three fields are facts the account and privacy screens rely on, so a profile without them is not a valid answer.
    expect(MeResponse.safeParse({ user, profile: { id: userId, handle: "ada", displayName: "Ada" }, standing: null }).success).toBe(false);
    expect(MeProfile.safeParse({ ...profile, handleChangedAt: "yesterday" }).success).toBe(false);
    expect(MeProfile.safeParse({ ...profile, verified: "yes" }).success).toBe(false);
    expect(MeProfile.safeParse({ ...profile, showInExplore: undefined }).success).toBe(false);
    expect(MeProfile.safeParse({ ...profile, showInExplore: "on" }).success).toBe(false);
  });
  test("every documented auth error code exists", () => {
    expect(AuthErrorCode.options).toHaveLength(35);
    // 3e (design, section 10.5): a handle korbat retired, refused to everyone, its former holder included.
    expect(AuthErrorCode.options).toContain("handle_retired");
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
