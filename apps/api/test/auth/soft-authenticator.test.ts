import { createHash, createPublicKey, createVerify, randomBytes } from "node:crypto";
import { AuthenticationResponseJSON, RegistrationResponseJSON } from "@korbat/contracts";
import { verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import { decodeAttestationObject, decodeClientDataJSON, isoBase64URL, isoCBOR, parseAuthenticatorData } from "@simplewebauthn/server/helpers";
import { describe, expect, test } from "vitest";
import { SoftAuthenticator, ZERO_AAGUID, type SoftFlags } from "./soft-authenticator";

const RP_ID = "localhost";
const ORIGIN = "http://localhost:8081";
const CHALLENGE = "c29mdC1hdXRoZW50aWNhdG9yLWNoYWxsZW5nZQ";
const USER_HANDLE = Buffer.alloc(32, 9);
const AAGUID = "adce0002-35bc-c60a-648b-0b25f1f05503";
const ALL: SoftFlags = { up: true, uv: true, be: true, bs: true };
const BARE: SoftFlags = { up: true, uv: false, be: false, bs: false };

const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest();

/** A COSE public key as the plain CBOR map it is, labels to values. */
const coseMap = (publicKey: Uint8Array) => isoCBOR.decodeFirst<Map<number, unknown>>(Uint8Array.from(publicKey));

/** A registration the library has verified, with the response it came from. */
async function registered(auth: SoftAuthenticator, flags: SoftFlags = ALL) {
  const response = auth.create({ rpId: RP_ID, challenge: CHALLENGE, origin: ORIGIN, userHandle: USER_HANDLE, flags });
  const result = await verifyRegistrationResponse({ response, expectedChallenge: CHALLENGE, expectedOrigin: ORIGIN, expectedRPID: RP_ID, requireUserVerification: false });
  if (!result.verified) throw new Error("the library refused the software authenticator's registration");
  return { response, info: result.registrationInfo };
}

/** The raw authenticator data inside a registration response's attestation object. */
function authDataOf(response: { response: { attestationObject: string } }) {
  return decodeAttestationObject(isoBase64URL.toBuffer(response.response.attestationObject)).get("authData");
}

describe("the software authenticator: registration", () => {
  test("produces a registration the library verifies, with the counter, AAGUID and flags the test chose", async () => {
    const auth = new SoftAuthenticator();
    const response = auth.create({ rpId: RP_ID, challenge: CHALLENGE, origin: ORIGIN, userHandle: USER_HANDLE, flags: ALL, counter: 3, aaguid: AAGUID });
    // The same shape the API's contract accepts, so HTTP tests can post it as it is.
    expect(RegistrationResponseJSON.parse(response)).toEqual(response);
    expect(response.id).toBe(response.rawId);
    expect(response.response.transports).toEqual(["internal", "hybrid"]);
    expect(decodeClientDataJSON(response.response.clientDataJSON)).toEqual({ type: "webauthn.create", challenge: CHALLENGE, origin: ORIGIN, crossOrigin: false });

    const result = await verifyRegistrationResponse({ response, expectedChallenge: CHALLENGE, expectedOrigin: ORIGIN, expectedRPID: RP_ID });
    expect(result.verified).toBe(true);
    const info = result.registrationInfo!;
    expect(info.fmt).toBe("none");
    expect(info.credential.id).toBe(response.id);
    expect(info.credential.counter).toBe(3);
    expect(info.aaguid).toBe(AAGUID);
    expect(info.userVerified).toBe(true);
    expect(info.credentialDeviceType).toBe("multiDevice");
    expect(info.credentialBackedUp).toBe(true);
  });

  test("clears the flags a test turns off: without UV the library verifies only when UV is not required", async () => {
    const auth = new SoftAuthenticator();
    const response = auth.create({ rpId: RP_ID, challenge: CHALLENGE, origin: ORIGIN, userHandle: USER_HANDLE, flags: BARE });
    const relaxed = await verifyRegistrationResponse({ response, expectedChallenge: CHALLENGE, expectedOrigin: ORIGIN, expectedRPID: RP_ID, requireUserVerification: false });
    expect(relaxed.verified).toBe(true);
    expect(relaxed.registrationInfo!.userVerified).toBe(false);
    expect(relaxed.registrationInfo!.credentialDeviceType).toBe("singleDevice");
    expect(relaxed.registrationInfo!.credentialBackedUp).toBe(false);
    expect(relaxed.registrationInfo!.aaguid).toBe(ZERO_AAGUID);
    await expect(verifyRegistrationResponse({ response, expectedChallenge: CHALLENGE, expectedOrigin: ORIGIN, expectedRPID: RP_ID })).rejects.toThrow(/User verification/);
  });

  test("signs a packed self attestation (no x5c) that the library verifies", async () => {
    const auth = new SoftAuthenticator();
    const response = auth.create({ rpId: RP_ID, challenge: CHALLENGE, origin: ORIGIN, userHandle: USER_HANDLE, flags: ALL, fmt: "packed" });
    const attStmt = decodeAttestationObject(isoBase64URL.toBuffer(response.response.attestationObject)).get("attStmt");
    expect(attStmt.get("alg")).toBe(-7);
    expect(attStmt.get("x5c")).toBeUndefined();
    const result = await verifyRegistrationResponse({ response, expectedChallenge: CHALLENGE, expectedOrigin: ORIGIN, expectedRPID: RP_ID });
    expect(result.verified).toBe(true);
    expect(result.registrationInfo!.fmt).toBe("packed");
  });

  test("writes the format and statement a test gives into the attestation object", () => {
    const auth = new SoftAuthenticator();
    const certificate = randomBytes(64);
    const response = auth.create({
      rpId: RP_ID,
      challenge: CHALLENGE,
      origin: ORIGIN,
      userHandle: USER_HANDLE,
      flags: ALL,
      fmt: "tpm",
      attStmt: new Map([["x5c", [certificate]]]),
    });
    const decoded = decodeAttestationObject(isoBase64URL.toBuffer(response.response.attestationObject));
    expect(decoded.get("fmt")).toBe("tpm");
    expect(Buffer.from(decoded.get("attStmt").get("x5c")![0]!).equals(certificate)).toBe(true);
  });

  test("lays the authenticator data out by hand as WebAuthn defines it, with the credential id and the ES256 COSE key", () => {
    const auth = new SoftAuthenticator();
    const credentialId = randomBytes(1024);
    const response = auth.create({ rpId: RP_ID, challenge: CHALLENGE, origin: ORIGIN, userHandle: USER_HANDLE, flags: { up: true, uv: false, be: true, bs: false }, counter: 258, aaguid: AAGUID, credentialId });
    const parsed = parseAuthenticatorData(authDataOf(response));
    expect(Buffer.from(parsed.rpIdHash).equals(sha256(RP_ID))).toBe(true);
    expect(parsed.flags).toMatchObject({ up: true, uv: false, be: true, bs: false, at: true, ed: false });
    expect(parsed.counter).toBe(258);
    expect(Buffer.from(parsed.aaguid!).toString("hex")).toBe(AAGUID.replace(/-/g, ""));
    expect(Buffer.from(parsed.credentialID!).equals(credentialId)).toBe(true);
    expect(response.id).toBe(credentialId.toString("base64url"));
    const cose = coseMap(parsed.credentialPublicKey!);
    // kty EC2, alg ES256, crv P-256, and 32-byte coordinates.
    expect([cose.get(1), cose.get(3), cose.get(-1)]).toEqual([2, -7, 1]);
    expect((cose.get(-2) as Uint8Array).byteLength).toBe(32);
    expect((cose.get(-3) as Uint8Array).byteLength).toBe(32);
  });
});

describe("the software authenticator: sign-in", () => {
  test("produces an assertion the library verifies against the registered key, with the counter and flags the test chose", async () => {
    const auth = new SoftAuthenticator();
    const { response: created, info } = await registered(auth);
    const response = auth.get({ credentialId: created.id, rpId: RP_ID, challenge: CHALLENGE, origin: ORIGIN, flags: { up: true, uv: true, be: true, bs: false }, counter: 9 });
    expect(AuthenticationResponseJSON.parse(response)).toEqual(response);
    expect(decodeClientDataJSON(response.response.clientDataJSON)).toEqual({ type: "webauthn.get", challenge: CHALLENGE, origin: ORIGIN, crossOrigin: false });
    const parsed = parseAuthenticatorData(isoBase64URL.toBuffer(response.response.authenticatorData));
    expect(parsed.flags).toMatchObject({ up: true, uv: true, be: true, bs: false, at: false, ed: false });
    expect(parsed.credentialID).toBeUndefined();

    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: CHALLENGE,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: { id: info.credential.id, publicKey: info.credential.publicKey, counter: 0 },
    });
    expect(result.verified).toBe(true);
    expect(result.authenticationInfo.newCounter).toBe(9);
    expect(result.authenticationInfo.userVerified).toBe(true);
    expect(result.authenticationInfo.credentialBackedUp).toBe(false);
  });

  test("signs with ES256 in DER over the authenticator data and the client data's hash", async () => {
    const auth = new SoftAuthenticator();
    const { response: created, info } = await registered(auth);
    const response = auth.get({ credentialId: created.id, rpId: RP_ID, challenge: CHALLENGE, origin: ORIGIN, flags: ALL, counter: 1 });
    const cose = coseMap(info.credential.publicKey);
    const coordinate = (label: number) => Buffer.from(cose.get(label) as Uint8Array).toString("base64url");
    const publicKey = createPublicKey({ key: { kty: "EC", crv: "P-256", x: coordinate(-2), y: coordinate(-3) }, format: "jwk" });
    const signature = isoBase64URL.toBuffer(response.response.signature);
    // A DER SEQUENCE, not the 64-byte raw form.
    expect(signature[0]).toBe(0x30);
    const signed = Buffer.concat([isoBase64URL.toBuffer(response.response.authenticatorData), sha256(isoBase64URL.toBuffer(response.response.clientDataJSON))]);
    expect(createVerify("sha256").update(signed).verify(publicKey, signature)).toBe(true);
  });

  test("a signature made with another credential's key does not verify", async () => {
    const auth = new SoftAuthenticator();
    const first = await registered(auth);
    const second = await registered(auth);
    const response = auth.get({ credentialId: first.response.id, rpId: RP_ID, challenge: CHALLENGE, origin: ORIGIN, flags: ALL, counter: 1 });
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: CHALLENGE,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: { id: first.info.credential.id, publicKey: second.info.credential.publicKey, counter: 0 },
    });
    expect(result.verified).toBe(false);
  });

  test("returns the user handle given at creation, none when told null, or the bytes it is given", async () => {
    const auth = new SoftAuthenticator();
    const { response: created } = await registered(auth, BARE);
    const base = { credentialId: created.id, rpId: RP_ID, challenge: CHALLENGE, origin: ORIGIN, flags: BARE, counter: 0 };
    expect(auth.get(base).response.userHandle).toBe(USER_HANDLE.toString("base64url"));
    expect("userHandle" in auth.get({ ...base, userHandle: null }).response).toBe(false);
    const other = Buffer.alloc(32, 1);
    expect(auth.get({ ...base, userHandle: other }).response.userHandle).toBe(other.toString("base64url"));
  });

  test("refuses to answer for a credential it does not hold", () => {
    const auth = new SoftAuthenticator();
    expect(() => auth.get({ credentialId: "AAAA", rpId: RP_ID, challenge: CHALLENGE, origin: ORIGIN, flags: ALL, counter: 0 })).toThrow(/holds no credential/);
  });
});
