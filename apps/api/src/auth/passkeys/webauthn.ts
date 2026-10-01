import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@korbat/contracts";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type VerifiedAuthenticationResponse,
  type VerifiedRegistrationResponse,
} from "@simplewebauthn/server";
import { decodeAttestationObject, decodeClientDataJSON, isoBase64URL } from "@simplewebauthn/server/helpers";
import { AuthError } from "../context";
import { MINUTE } from "../limits";

// This is the only file that imports @simplewebauthn/server: everything the library decides passes through here, with
// korbat's settings pinned, and every library failure leaves as passkey_invalid.

export type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON };

/**
 * How long the browser's prompt may stay open: half the challenge's lifetime, so a modal prompt ends before its challenge
 * expires. Conditional mediation (autofill) ignores it; the app restarts that request itself.
 */
export const CEREMONY_TIMEOUT_MS = 5 * MINUTE;

/**
 * Ed25519, ES256 and RS256, pinned on the options and on the verification alike. The library's runtime default adds
 * ML-DSA (-48) on Node 24, which Node still marks experimental.
 */
export const SUPPORTED_ALGORITHMS: readonly number[] = [-8, -7, -257];

/** WebAuthn L3 caps credential ids at this many bytes and has the relying party refuse a longer one at registration; the library does not. */
export const MAX_CREDENTIAL_ID_BYTES = 1023;

/** The transports WebAuthn L3 defines, plus "cable", the older name of hybrid that some browsers still report. */
const KNOWN_TRANSPORTS = new Set(["usb", "nfc", "ble", "smart-card", "hybrid", "internal", "cable"]);
const MAX_TRANSPORTS = 5;

/** The contracts' bound on clientDataJSON, applied again here for callers that did not come through them. */
const MAX_CLIENT_DATA_CHARS = 4 * 1024;
/** Well above the 78 characters of a korbat challenge; anything longer is not one, and is not worth hashing. */
const MAX_CHALLENGE_CHARS = 128;

const invalid = () => new AuthError("passkey_invalid", 401);

/** A credential in an options list: its id as base64url and the transports it was registered with. */
export interface CredentialDescriptor {
  id: string;
  transports: string[];
}

/**
 * What a ceremony asks of user verification: "preferred" for 1c's passkeys, so security keys without a PIN still work,
 * and "required" for every staff ceremony (3a design, section 5). Verification itself never requires it: the flows read
 * the UV flag the authenticator reported, and the staff flows refuse a key without it with a code of its own.
 */
export type UserVerification = "preferred" | "required";

/** Only these two members reach the options JSON, whatever else the caller's objects carry. */
const descriptor = ({ id, transports }: CredentialDescriptor) => ({ id, transports });

/**
 * The challenge's own bytes. Given a string, the library would encode its UTF-8 text again, and the options (and so the
 * browser's client data) would carry a different string from the one korbat issued and checks.
 */
function challengeBytes(challenge: string): Uint8Array<ArrayBuffer> {
  const bytes = Uint8Array.from(Buffer.from(challenge, "base64url"));
  if (Buffer.from(bytes).toString("base64url") !== challenge) throw new Error("a WebAuthn challenge must be canonical base64url, as issueChallenge writes it");
  return bytes;
}

/**
 * Options for navigator.credentials.create: a discoverable credential (the passkey signs in without an email), user
 * verification as the caller asks (preferred unless told otherwise), no attestation, the pinned algorithms, and the
 * account's credentials listed so an authenticator that already holds one of them does not add another.
 */
export async function registrationOptions(input: {
  rp: { id: string; name: string };
  /** The account's WebAuthn user handle (never its account id), and the label the password manager shows. */
  user: { id: Uint8Array; name: string; displayName: string };
  exclude: CredentialDescriptor[];
  challenge: string;
  userVerification?: UserVerification;
  /**
   * The security-key hint, for the enrolment's "Register a security key" button only. 14.0.2 sends a hint only through
   * preferredAuthenticatorType, which also sets cross-platform attachment and so hides Windows Hello: without it, no hint.
   */
  hint?: "securityKey";
}): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return generateRegistrationOptions({
    rpName: input.rp.name,
    rpID: input.rp.id,
    userName: input.user.name,
    userDisplayName: input.user.displayName,
    // 14.0.2 takes the user handle as bytes only; it refuses a string.
    userID: Uint8Array.from(input.user.id),
    challenge: challengeBytes(input.challenge),
    timeout: CEREMONY_TIMEOUT_MS,
    attestationType: "none",
    excludeCredentials: input.exclude.map(descriptor),
    // A new object on every call: the library writes requireResidentKey, and with a hint the attachment, into the object it is given.
    authenticatorSelection: { residentKey: "required", userVerification: input.userVerification ?? "preferred" },
    supportedAlgorithmIDs: [...SUPPORTED_ALGORITHMS],
    ...(input.hint ? { preferredAuthenticatorType: input.hint } : {}),
  });
}

/**
 * Options for navigator.credentials.get. Sign-in passes an empty allow list, so the options say nothing about any account
 * and the browser offers every passkey it holds for the RP; re-authentication lists the account's usable passkeys.
 */
export async function authenticationOptions(input: {
  rpId: string;
  allow: CredentialDescriptor[];
  challenge: string;
  userVerification?: UserVerification;
}): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({
    rpID: input.rpId,
    allowCredentials: input.allow.map(descriptor),
    challenge: challengeBytes(input.challenge),
    timeout: CEREMONY_TIMEOUT_MS,
    userVerification: input.userVerification ?? "preferred",
  });
}

/** The format and statement of an attestation object, or null when it is not a CBOR map holding a text format and a statement map. */
function attestationFormat(attestationObject: string): { fmt: string; attStmt: Map<unknown, unknown> } | null {
  try {
    const decoded: unknown = decodeAttestationObject(isoBase64URL.toBuffer(attestationObject));
    if (!(decoded instanceof Map)) return null;
    const fmt: unknown = decoded.get("fmt");
    const attStmt: unknown = decoded.get("attStmt");
    return typeof fmt === "string" && attStmt instanceof Map ? { fmt, attStmt } : null;
  } catch {
    return null;
  }
}

/** Known values only, each once, five at most: the library hands back whatever the client sent. */
function knownTransports(reported: unknown): string[] {
  if (!Array.isArray(reported)) return [];
  const kept: string[] = [];
  for (const transport of reported) {
    if (kept.length === MAX_TRANSPORTS) break;
    if (typeof transport === "string" && KNOWN_TRANSPORTS.has(transport) && !kept.includes(transport)) kept.push(transport);
  }
  return kept;
}

/** What korbat stores of a verified registration. */
export interface VerifiedRegistration {
  /** From the authenticator data, base64url; the library never compares it with the response's id, so the response's id is not used. */
  credentialId: string;
  /** The COSE public key as base64url, as auth.passkeys.public_key holds it. */
  publicKey: string;
  counter: number;
  transports: string[];
  aaguid: string;
  /** The BE flag: the key may be synced to the owner's other devices. */
  backupEligible: boolean;
  /** The BS flag: the key is backed up now. */
  backedUp: boolean;
  /** The UV flag. Only a passkey registered with it counts as two factors when a later sign-in is verified too. */
  userVerified: boolean;
}

/**
 * Verifies a registration response whose challenge the caller has already read and spent. The attestation format is
 * checked before the library sees the response: only `none`, or `packed` with no x5c chain (a self attestation), pass;
 * anything else is passkey_unsupported. The format comes from the client whatever the options asked for, and the library
 * fetches revocation lists, with no timeout or size limit, for the formats that carry certificates.
 */
export async function verifyRegistration(input: { response: RegistrationResponseJSON; expectedChallenge: string; origins: string[]; rpId: string }): Promise<VerifiedRegistration> {
  const format = attestationFormat(input.response.response.attestationObject);
  if (!format) throw invalid();
  if (!(format.fmt === "none" || (format.fmt === "packed" && !format.attStmt.has("x5c")))) throw new AuthError("passkey_unsupported", 400);

  let result: VerifiedRegistrationResponse;
  try {
    result = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: input.expectedChallenge,
      expectedOrigin: input.origins,
      expectedRPID: input.rpId,
      // User verification is never required here, so security keys without a PIN still work for passkeys; the flows read
      // the UV flag instead to decide what the passkey proves, and the staff flows refuse a key without it by its own code.
      requireUserVerification: false,
      supportedAlgorithmIDs: [...SUPPORTED_ALGORITHMS],
    });
  } catch {
    throw invalid();
  }
  if (!result.verified) throw invalid();
  const { credential, aaguid, credentialDeviceType, credentialBackedUp, userVerified } = result.registrationInfo;
  if (Buffer.from(credential.id, "base64url").length > MAX_CREDENTIAL_ID_BYTES) throw invalid();
  return {
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    transports: knownTransports(credential.transports),
    aaguid,
    backupEligible: credentialDeviceType === "multiDevice",
    backedUp: credentialBackedUp,
    userVerified,
  };
}

/** What an assertion proved: the counter to compare with the stored one, and the flags. */
export interface VerifiedAuthentication {
  newCounter: number;
  userVerified: boolean;
  backedUp: boolean;
  /** The BE flag as this assertion reported it: the staff flows refuse a key that reports it at any use (3a design, section 2). */
  backupEligible: boolean;
}

/**
 * Verifies an assertion against a stored passkey, whose challenge the caller has already read and spent. The library is
 * given a stored counter of 0, so it never refuses on a counter: it would do that before checking the signature, and an
 * unsigned response could then pass for a clone. The caller applies isCounterRegression once the signature has checked.
 */
export async function verifyAuthentication(input: {
  response: AuthenticationResponseJSON;
  expectedChallenge: string;
  origins: string[];
  rpId: string;
  /** The stored passkey: its credential id and COSE public key as base64url, and its transports. */
  credential: { id: string; publicKey: string; transports: string[] };
}): Promise<VerifiedAuthentication> {
  let result: VerifiedAuthenticationResponse;
  try {
    result = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: input.expectedChallenge,
      expectedOrigin: input.origins,
      expectedRPID: input.rpId,
      credential: { id: input.credential.id, publicKey: isoBase64URL.toBuffer(input.credential.publicKey), counter: 0, transports: input.credential.transports },
      requireUserVerification: false,
    });
  } catch {
    throw invalid();
  }
  if (!result.verified) throw invalid();
  const info = result.authenticationInfo;
  return { newCounter: info.newCounter, userVerified: info.userVerified, backedUp: info.credentialBackedUp, backupEligible: info.credentialDeviceType === "multiDevice" };
}

/**
 * WebAuthn L3, section 6.1.1: a signature counter that did not move past the stored one suggests a copy of the key.
 * Two zeros are not a regression: Apple passkeys, like other synced ones, always report 0.
 */
export function isCounterRegression(stored: number, next: number): boolean {
  return (next > 0 || stored > 0) && next <= stored;
}

/**
 * The challenge a ceremony's client data names. The flows run readChallenge and spendChallenge on it before any
 * verification, so a response to a forged, foreign or spent challenge never reaches the library.
 */
export function readResponseChallenge(response: { response: { clientDataJSON: string } }): string {
  const { clientDataJSON } = response.response;
  if (typeof clientDataJSON !== "string" || clientDataJSON.length > MAX_CLIENT_DATA_CHARS) throw invalid();
  let challenge: unknown;
  try {
    const clientData: unknown = decodeClientDataJSON(clientDataJSON);
    challenge = typeof clientData === "object" && clientData !== null ? (clientData as { challenge?: unknown }).challenge : undefined;
  } catch {
    throw invalid();
  }
  if (typeof challenge !== "string" || challenge.length === 0 || challenge.length > MAX_CHALLENGE_CHARS) throw invalid();
  return challenge;
}
