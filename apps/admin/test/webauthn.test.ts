import { randomBytes } from "node:crypto";
import { AuthenticationResponseJSON, RegistrationResponseJSON } from "@korbat/contracts";
import { describe, expect, test } from "vitest";
import {
  authenticationResponseToJSON,
  CeremonyError,
  ceremonyFailure,
  creationOptionsFromJSON,
  fromBase64url,
  registrationResponseToJSON,
  requestOptionsFromJSON,
  toBase64url,
} from "../src/webauthn";
import { enrollOptions, fakeAssertion, fakeAttestation, stepUpOptions } from "./fixtures";

/**
 * The console has no WebAuthn library: it turns the server library's JSON options into the browser's and the browser's
 * credential back into the JSON the contracts describe, with base64url of its own.
 */
const bytes = (view: BufferSource): Buffer => Buffer.from(view instanceof ArrayBuffer ? view : view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));

describe("base64url", () => {
  test("agrees with Node's on every length", () => {
    for (let length = 0; length < 70; length++) {
      const data = randomBytes(length);
      expect(toBase64url(new Uint8Array(data))).toBe(data.toString("base64url"));
      expect(Buffer.from(fromBase64url(data.toString("base64url")))).toEqual(data);
    }
  });

  test("refuses anything that is not unpadded base64url", () => {
    for (const text of ["a+b", "a/b", "ab==", "a b", "a", "%3C"]) expect(() => fromBase64url(text), text).toThrow();
  });
});

describe("options from the server's JSON", () => {
  test("registration: the challenge, the user handle and the excluded keys become bytes; the rest passes", () => {
    const json = enrollOptions(false).options;
    const options = creationOptionsFromJSON(json);
    expect(bytes(options.challenge)).toEqual(Buffer.from(json.challenge, "base64url"));
    expect(bytes(options.user.id)).toEqual(Buffer.alloc(32, 9));
    expect(options.user).toMatchObject({ name: "Blue key", displayName: "Blue key" });
    expect(options.rp).toEqual({ id: "localhost", name: "korbat" });
    expect(options.excludeCredentials?.map((c) => bytes(c.id).toString("base64url"))).toEqual(["b2xkLWtleQ"]);
    expect(options.pubKeyCredParams.map((p) => p.alg)).toEqual([-8, -7, -257]);
    expect(options.authenticatorSelection).toMatchObject({ residentKey: "required", userVerification: "required" });
    expect(options.attestation).toBe("none");
    expect((options as unknown as { hints: string[] }).hints).toEqual(["security-key"]);
  });

  test("registration always asks for user verification, whatever the options said", () => {
    const json = { ...enrollOptions(false).options, authenticatorSelection: { residentKey: "required", userVerification: "discouraged" } };
    expect(creationOptionsFromJSON(json).authenticatorSelection?.userVerification).toBe("required");
  });

  test("registration asks for no attestation and no extension but credProps, whatever the options said", () => {
    // An API under an attacker's control asking for the key's make and model, and for extensions the design never uses.
    const json = { ...enrollOptions(false).options, attestation: "direct", extensions: { credProps: true, largeBlob: { support: "required" }, prf: {} } };
    const options = creationOptionsFromJSON(json);
    expect(options.attestation).toBe("none");
    expect(options.extensions).toEqual({ credProps: true });
    // Without credProps in the options, no extension at all.
    const bare = creationOptionsFromJSON({ ...json, extensions: { largeBlob: { support: "required" } } });
    expect(bare.attestation).toBe("none");
    expect(bare.extensions).toBeUndefined();
  });

  test("an assertion passes on no extension, whatever the options said", () => {
    const json = { ...stepUpOptions("AAAA").options, extensions: { largeBlob: { read: true }, prf: { eval: { first: "AAAA" } }, appid: "https://evil.example" } };
    const options = requestOptionsFromJSON(json);
    expect(options.extensions).toBeUndefined();
    expect(Object.keys(options).sort()).toEqual(["allowCredentials", "challenge", "rpId", "timeout", "userVerification"]);
  });

  test("an assertion: the challenge and the allowed keys become bytes, and user verification is required", () => {
    const json = { ...stepUpOptions("AAAA").options, userVerification: "preferred" };
    const options = requestOptionsFromJSON(json);
    expect(bytes(options.challenge)).toEqual(Buffer.from("AAAA", "base64url"));
    expect(options.allowCredentials?.map((c) => bytes(c.id).toString("base64url"))).toEqual(["Y3JlZGVudGlhbC0x"]);
    expect(options.rpId).toBe("localhost");
    expect(options.userVerification).toBe("required");
  });

  test("options the console cannot read are refused", () => {
    expect(() => creationOptionsFromJSON({ challenge: "AAAA" })).toThrow(CeremonyError);
    expect(() => requestOptionsFromJSON({ challenge: "AAAA", allowCredentials: [{ id: "a+b", type: "public-key" }] })).toThrow(CeremonyError);
  });
});

describe("the browser's credential as JSON", () => {
  test("a registration matches the contracts' RegistrationResponseJSON", () => {
    const json = registrationResponseToJSON(fakeAttestation());
    expect(RegistrationResponseJSON.parse(json)).toEqual(json);
    expect(json).toMatchObject({ id: "bmV3LWtleQ", rawId: "bmV3LWtleQ", type: "public-key", response: { transports: ["usb", "nfc"] }, clientExtensionResults: { credProps: { rk: true } } });
    // The browser reported no attachment: the member is left out, as the contracts' schema allows, rather than sent as null.
    expect("authenticatorAttachment" in json).toBe(false);
  });

  test("an assertion matches the contracts' AuthenticationResponseJSON", () => {
    const json = authenticationResponseToJSON(fakeAssertion());
    expect(AuthenticationResponseJSON.parse(json)).toEqual(json);
    expect(json.response.signature).toBe(Buffer.from("signature").toString("base64url"));
    expect(json.response.userHandle).toBe(Buffer.from("user-handle").toString("base64url"));
    expect(json.authenticatorAttachment).toBe("cross-platform");
  });

  test("no credential, or one of another shape, is a ceremony that did not finish", () => {
    expect(() => authenticationResponseToJSON(null)).toThrow(CeremonyError);
    expect(() => authenticationResponseToJSON(fakeAttestation())).toThrow(CeremonyError);
    expect(() => registrationResponseToJSON(fakeAssertion())).toThrow(CeremonyError);
  });
});

describe("the browser's refusals", () => {
  const domError = (name: string) => Object.assign(new Error("x"), { name });

  test("each is worded by the console, never passed through", () => {
    expect(ceremonyFailure(domError("NotAllowedError")).code).toBe("ceremony_cancelled");
    expect(ceremonyFailure(domError("AbortError")).code).toBe("ceremony_cancelled");
    expect(ceremonyFailure(domError("InvalidStateError")).code).toBe("key_already_registered");
    expect(ceremonyFailure(domError("SecurityError")).code).toBe("ceremony_refused");
    expect(ceremonyFailure(domError("NotSupportedError")).code).toBe("ceremony_refused");
    expect(ceremonyFailure(new TypeError("x")).code).toBe("ceremony_refused");
  });
});
