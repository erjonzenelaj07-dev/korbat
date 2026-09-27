import { describe, expect, test } from "vitest";
import {
  AuthenticationResponseJSON,
  PasskeyLabel,
  PasskeyListResponse,
  PasskeyName,
  PasskeyOptionsResponse,
  PasskeyRegisterOptionsRequest,
  PasskeyRegisterVerifyRequest,
  PasskeyRemoveLinkRequest,
  PasskeyRenameRequest,
  PasskeySignInVerifyRequest,
  PasskeyView,
  PasswordSigninRequest,
  RegistrationResponseJSON,
} from "../src/index";

const BELL = String.fromCharCode(7);
const NEWLINE = String.fromCharCode(10);
/** U+202E, the right-to-left override: invisible, and refused by the display-name rules. */
const RLO = String.fromCharCode(0x202e);

/** A base64url string of exactly n characters. */
const b64 = (n: number) => "A".repeat(n);

const at = "2026-09-25T10:00:00.000Z";
const token = "a".repeat(43);

/** What @simplewebauthn/browser's startRegistration returns for a platform passkey, trimmed to realistic sizes. */
const registration = {
  id: "q2Xx0w8bRk6nV8yQ0f2mUg",
  rawId: "q2Xx0w8bRk6nV8yQ0f2mUg",
  type: "public-key",
  response: { clientDataJSON: b64(200), attestationObject: b64(400), transports: ["internal", "hybrid"] },
  clientExtensionResults: { credProps: { rk: true } },
  authenticatorAttachment: "platform",
};

/** What startAuthentication returns for a discoverable passkey: the user handle is there. */
const assertion = {
  id: "q2Xx0w8bRk6nV8yQ0f2mUg",
  rawId: "q2Xx0w8bRk6nV8yQ0f2mUg",
  type: "public-key",
  response: { clientDataJSON: b64(200), authenticatorData: b64(50), signature: b64(96), userHandle: b64(43) },
  clientExtensionResults: {},
  authenticatorAttachment: "cross-platform",
};

const withResponse = <T extends { response: object }>(base: T, response: Record<string, unknown>) => ({ ...base, response: { ...base.response, ...response } });

describe("passkey names and labels", () => {
  test("follow the display-name rules: trimmed, 1 to 50 characters", () => {
    for (const schema of [PasskeyName, PasskeyLabel]) {
      expect(schema.parse("  Ada's phone ")).toBe("Ada's phone");
      expect(schema.parse("x".repeat(50))).toBe("x".repeat(50));
      expect(schema.safeParse("x".repeat(51)).success).toBe(false);
      expect(schema.safeParse("").success).toBe(false);
      expect(schema.safeParse("   ").success).toBe(false);
    }
  });

  test("refuse control characters and invisible direction characters", () => {
    for (const schema of [PasskeyName, PasskeyLabel]) {
      expect(schema.safeParse(`work${BELL}key`).success).toBe(false);
      expect(schema.safeParse(`work${NEWLINE}key`).success).toBe(false);
      expect(schema.safeParse(`work${RLO}key`).success).toBe(false);
    }
  });
});

describe("passkey views", () => {
  const view = {
    id: "3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a",
    name: "Work laptop",
    createdAt: at,
    lastUsedAt: at,
    synced: true,
    createdOn: "Chrome on Windows",
    current: true,
    isNew: false,
    suspended: false,
  };

  test("carry the name, the dates, the flags and the creating device", () => {
    expect(PasskeyView.parse(view)).toEqual(view);
    // A passkey never used since it was added, whose creating device is gone.
    const unused = { ...view, lastUsedAt: null, createdOn: null, current: false, isNew: true };
    expect(PasskeyView.parse(unused)).toEqual(unused);
  });

  test("need every field, with its type", () => {
    for (const key of Object.keys(view)) {
      const partial: Record<string, unknown> = { ...view };
      delete partial[key];
      expect(PasskeyView.safeParse(partial).success, key).toBe(false);
    }
    expect(PasskeyView.safeParse({ ...view, id: "nope" }).success).toBe(false);
    expect(PasskeyView.safeParse({ ...view, createdAt: "yesterday" }).success).toBe(false);
    expect(PasskeyView.safeParse({ ...view, suspended: "no" }).success).toBe(false);
  });

  test("the list holds views and may be empty", () => {
    expect(PasskeyListResponse.parse({ passkeys: [view] })).toEqual({ passkeys: [view] });
    expect(PasskeyListResponse.parse({ passkeys: [] })).toEqual({ passkeys: [] });
    expect(PasskeyListResponse.safeParse({}).success).toBe(false);
  });
});

describe("ceremony options", () => {
  test("registration options are asked for with the label the password manager shows", () => {
    expect(PasskeyRegisterOptionsRequest.parse({ label: " ada " })).toEqual({ label: "ada" });
    expect(PasskeyRegisterOptionsRequest.safeParse({}).success).toBe(false);
    expect(PasskeyRegisterOptionsRequest.safeParse({ label: `ada${BELL}` }).success).toBe(false);
  });

  test("the options come back as the library wrote them, with a base64url challenge", () => {
    const options = {
      challenge: b64(78),
      rp: { name: "korbat", id: "korbat.example" },
      user: { id: b64(43), name: "ada", displayName: "ada" },
      pubKeyCredParams: [{ alg: -8, type: "public-key" }],
      timeout: 300000,
      excludeCredentials: [],
      authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
      attestation: "none",
    };
    // Everything but the challenge passes through untouched: the browser library reads it, not korbat.
    expect(PasskeyOptionsResponse.parse({ options })).toEqual({ options });
    expect(PasskeyOptionsResponse.parse({ options: { challenge: "abc_-XYZ" } })).toEqual({ options: { challenge: "abc_-XYZ" } });
  });

  test("options without a base64url challenge, or that are not an object, are refused", () => {
    expect(PasskeyOptionsResponse.safeParse({ options: {} }).success).toBe(false);
    expect(PasskeyOptionsResponse.safeParse({ options: { challenge: "" } }).success).toBe(false);
    expect(PasskeyOptionsResponse.safeParse({ options: { challenge: "abc+/" } }).success).toBe(false);
    expect(PasskeyOptionsResponse.safeParse({ options: { challenge: "abc=" } }).success).toBe(false);
    expect(PasskeyOptionsResponse.safeParse({ options: "challenge" }).success).toBe(false);
    expect(PasskeyOptionsResponse.safeParse({ options: [b64(10)] }).success).toBe(false);
  });
});

describe("the registration response", () => {
  test("accepts what the browser library returns", () => {
    expect(RegistrationResponseJSON.parse(registration)).toEqual(registration);
    const bare = { ...registration, response: { clientDataJSON: b64(200), attestationObject: b64(400) } };
    delete (bare as Record<string, unknown>).authenticatorAttachment;
    expect(RegistrationResponseJSON.parse(bare)).toEqual(bare);
  });

  test("drops the members korbat does not read, which the attestation object carries anyway", () => {
    const extra = withResponse(registration, { publicKey: b64(120), publicKeyAlgorithm: -7, authenticatorData: b64(160) });
    expect(RegistrationResponseJSON.parse({ ...extra, surprise: b64(10) })).toEqual(registration);
  });

  test("bounds the credential id at 1400 base64url characters", () => {
    for (const key of ["id", "rawId"] as const) {
      expect(RegistrationResponseJSON.safeParse({ ...registration, [key]: b64(1400) }).success, key).toBe(true);
      expect(RegistrationResponseJSON.safeParse({ ...registration, [key]: b64(1401) }).success, key).toBe(false);
      expect(RegistrationResponseJSON.safeParse({ ...registration, [key]: "" }).success, key).toBe(false);
    }
  });

  test("bounds clientDataJSON at 4 KiB and the attestation object at 64 KiB", () => {
    expect(RegistrationResponseJSON.safeParse(withResponse(registration, { clientDataJSON: b64(4096) })).success).toBe(true);
    expect(RegistrationResponseJSON.safeParse(withResponse(registration, { clientDataJSON: b64(4097) })).success).toBe(false);
    expect(RegistrationResponseJSON.safeParse(withResponse(registration, { attestationObject: b64(65536) })).success).toBe(true);
    expect(RegistrationResponseJSON.safeParse(withResponse(registration, { attestationObject: b64(65537) })).success).toBe(false);
  });

  test("takes at most 8 transports of at most 32 characters", () => {
    expect(RegistrationResponseJSON.safeParse(withResponse(registration, { transports: Array(8).fill("usb") })).success).toBe(true);
    expect(RegistrationResponseJSON.safeParse(withResponse(registration, { transports: Array(9).fill("usb") })).success).toBe(false);
    expect(RegistrationResponseJSON.safeParse(withResponse(registration, { transports: ["x".repeat(32)] })).success).toBe(true);
    expect(RegistrationResponseJSON.safeParse(withResponse(registration, { transports: ["x".repeat(33)] })).success).toBe(false);
    expect(RegistrationResponseJSON.safeParse(withResponse(registration, { transports: [""] })).success).toBe(false);
    expect(RegistrationResponseJSON.safeParse(withResponse(registration, { transports: "usb" })).success).toBe(false);
  });

  test("needs base64url, the public-key type, an extension-results object and a known attachment", () => {
    expect(RegistrationResponseJSON.safeParse({ ...registration, id: "q2Xx+w8b/k6nV8yQ" }).success).toBe(false);
    expect(RegistrationResponseJSON.safeParse(withResponse(registration, { attestationObject: `${b64(10)}=` })).success).toBe(false);
    expect(RegistrationResponseJSON.safeParse(withResponse(registration, { attestationObject: undefined })).success).toBe(false);
    expect(RegistrationResponseJSON.safeParse(withResponse(registration, { clientDataJSON: undefined })).success).toBe(false);
    expect(RegistrationResponseJSON.safeParse({ ...registration, type: "password" }).success).toBe(false);
    expect(RegistrationResponseJSON.safeParse({ ...registration, clientExtensionResults: undefined }).success).toBe(false);
    expect(RegistrationResponseJSON.safeParse({ ...registration, clientExtensionResults: "none" }).success).toBe(false);
    expect(RegistrationResponseJSON.safeParse({ ...registration, clientExtensionResults: [] }).success).toBe(false);
    expect(RegistrationResponseJSON.safeParse({ ...registration, authenticatorAttachment: "roaming" }).success).toBe(false);
    expect(RegistrationResponseJSON.safeParse({ ...registration, response: undefined }).success).toBe(false);
  });
});

describe("the authentication response", () => {
  test("accepts what the browser library returns, with or without a user handle", () => {
    expect(AuthenticationResponseJSON.parse(assertion)).toEqual(assertion);
    const { userHandle: _dropped, ...response } = assertion.response;
    expect(AuthenticationResponseJSON.parse({ ...assertion, response })).toEqual({ ...assertion, response });
  });

  test("bounds the credential id at 1400 base64url characters", () => {
    for (const key of ["id", "rawId"] as const) {
      expect(AuthenticationResponseJSON.safeParse({ ...assertion, [key]: b64(1400) }).success, key).toBe(true);
      expect(AuthenticationResponseJSON.safeParse({ ...assertion, [key]: b64(1401) }).success, key).toBe(false);
    }
  });

  test("bounds clientDataJSON and authenticatorData at 4 KiB, the signature at 1 KiB and the user handle at 128 characters", () => {
    const bounds = { clientDataJSON: 4096, authenticatorData: 4096, signature: 1024, userHandle: 128 };
    for (const [key, max] of Object.entries(bounds)) {
      expect(AuthenticationResponseJSON.safeParse(withResponse(assertion, { [key]: b64(max) })).success, key).toBe(true);
      expect(AuthenticationResponseJSON.safeParse(withResponse(assertion, { [key]: b64(max + 1) })).success, key).toBe(false);
      expect(AuthenticationResponseJSON.safeParse(withResponse(assertion, { [key]: "" })).success, key).toBe(false);
      expect(AuthenticationResponseJSON.safeParse(withResponse(assertion, { [key]: "ab/cd" })).success, key).toBe(false);
    }
  });

  test("needs the signature, the authenticator data and the public-key type", () => {
    expect(AuthenticationResponseJSON.safeParse(withResponse(assertion, { signature: undefined })).success).toBe(false);
    expect(AuthenticationResponseJSON.safeParse(withResponse(assertion, { authenticatorData: undefined })).success).toBe(false);
    expect(AuthenticationResponseJSON.safeParse({ ...assertion, type: "otp" }).success).toBe(false);
    expect(AuthenticationResponseJSON.safeParse({ ...assertion, clientExtensionResults: null }).success).toBe(false);
  });
});

describe("passkey requests", () => {
  test("register verify takes the response and an optional name under the display-name rules", () => {
    expect(PasskeyRegisterVerifyRequest.parse({ response: registration })).toEqual({ response: registration });
    expect(PasskeyRegisterVerifyRequest.parse({ name: " Work laptop ", response: registration })).toEqual({ name: "Work laptop", response: registration });
    expect(PasskeyRegisterVerifyRequest.safeParse({ name: `Work${BELL}`, response: registration }).success).toBe(false);
    expect(PasskeyRegisterVerifyRequest.safeParse({ name: "x".repeat(51), response: registration }).success).toBe(false);
    expect(PasskeyRegisterVerifyRequest.safeParse({ name: "Work laptop" }).success).toBe(false);
    // An assertion is not a registration.
    expect(PasskeyRegisterVerifyRequest.safeParse({ response: assertion }).success).toBe(false);
  });

  test("sign-in verify takes the response plus exactly the device fields of the password sign-in", () => {
    const request = { response: assertion, deviceId: "d".repeat(22), platform: "web" };
    expect(PasskeySignInVerifyRequest.parse(request)).toEqual(request);
    expect(Object.keys(PasskeySignInVerifyRequest.shape).sort()).toEqual(["deviceId", "platform", "response"]);
    expect(PasskeySignInVerifyRequest.shape.deviceId).toBe(PasswordSigninRequest.shape.deviceId);
    expect(PasskeySignInVerifyRequest.shape.platform).toBe(PasswordSigninRequest.shape.platform);
    expect(PasskeySignInVerifyRequest.safeParse({ ...request, deviceId: "short" }).success).toBe(false);
    expect(PasskeySignInVerifyRequest.safeParse({ ...request, platform: "desktop" }).success).toBe(false);
    expect(PasskeySignInVerifyRequest.safeParse({ response: assertion, platform: "web" }).success).toBe(false);
    expect(PasskeySignInVerifyRequest.safeParse({ ...request, response: registration }).success).toBe(false);
  });

  test("rename takes a name under the display-name rules", () => {
    expect(PasskeyRenameRequest.parse({ name: " Phone " })).toEqual({ name: "Phone" });
    expect(PasskeyRenameRequest.safeParse({ name: `Pho${RLO}ne` }).success).toBe(false);
    expect(PasskeyRenameRequest.safeParse({ name: `Pho${NEWLINE}ne` }).success).toBe(false);
    expect(PasskeyRenameRequest.safeParse({}).success).toBe(false);
  });

  test("the remove link carries one opaque token", () => {
    expect(PasskeyRemoveLinkRequest.parse({ token })).toEqual({ token });
    expect(PasskeyRemoveLinkRequest.safeParse({ token: "a".repeat(42) }).success).toBe(false);
    expect(PasskeyRemoveLinkRequest.safeParse({ token: `${"a".repeat(42)}=` }).success).toBe(false);
    expect(PasskeyRemoveLinkRequest.safeParse({}).success).toBe(false);
  });
});
