import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@korbat/contracts";
import { z } from "zod";
import { messageFor } from "./messages";

/**
 * The browser side of the staff ceremonies, without a WebAuthn library: the server library's JSON options become the
 * browser's (their binary members decoded from base64url), and the browser's credential becomes the JSON the contracts
 * describe. Whatever the options say, every ceremony asks for user verification and no attestation, and passes on no
 * extension but credProps: the console asks the key for nothing the design does not need.
 */

/** A ceremony that did not finish or could not be read, with the console's words for why. */
export class CeremonyError extends Error {
  readonly status = 0;
  constructor(readonly code: "ceremony_cancelled" | "key_already_registered" | "ceremony_refused" | "invalid_answer") {
    super(messageFor(code));
    this.name = "CeremonyError";
  }
}

/** The part of navigator.credentials the console calls; a test hands in its own. */
export interface CredentialsLike {
  create(options: { publicKey: PublicKeyCredentialCreationOptions }): Promise<unknown>;
  get(options: { publicKey: PublicKeyCredentialRequestOptions }): Promise<unknown>;
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const VALUE = new Map([...ALPHABET].map((char, index) => [char, index]));

/** Bytes as unpadded base64url, as the browser library and the server write every binary member. */
export function toBase64url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    const n = (bytes[i]! << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!;
    if (b1 !== undefined) out += ALPHABET[(n >> 6) & 63]!;
    if (b2 !== undefined) out += ALPHABET[n & 63]!;
  }
  return out;
}

/** Unpadded base64url as bytes; anything else (padding, + or /, an impossible length) is refused. */
export function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) throw new CeremonyError("invalid_answer");
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let at = 0;
  for (const char of text) {
    // Only the bits not yet written are kept, so the number never outgrows 24 bits.
    buffer = ((buffer << 6) | VALUE.get(char)!) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (buffer >> bits) & 0xff;
    }
  }
  return out;
}

const Base64url = z.string().regex(/^[A-Za-z0-9_-]+$/);
const Descriptor = z.object({ id: Base64url, type: z.literal("public-key"), transports: z.array(z.string()).max(8).optional() });

/** The registration options as @simplewebauthn/server writes them; only what the console passes on is read. */
const CreationOptionsJSON = z.object({
  challenge: Base64url,
  rp: z.object({ id: z.string().optional(), name: z.string() }),
  user: z.object({ id: Base64url, name: z.string(), displayName: z.string() }),
  pubKeyCredParams: z.array(z.object({ alg: z.number().int(), type: z.literal("public-key") })).min(1),
  timeout: z.number().int().positive().optional(),
  excludeCredentials: z.array(Descriptor).optional(),
  authenticatorSelection: z
    .object({
      authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
      residentKey: z.enum(["discouraged", "preferred", "required"]).optional(),
      requireResidentKey: z.boolean().optional(),
    })
    .optional(),
  extensions: z.object({ credProps: z.boolean().optional() }).optional(),
  hints: z.array(z.enum(["security-key", "client-device", "hybrid"])).optional(),
});

/** The assertion options as @simplewebauthn/server writes them. */
const RequestOptionsJSON = z.object({
  challenge: Base64url,
  rpId: z.string().optional(),
  timeout: z.number().int().positive().optional(),
  allowCredentials: z.array(Descriptor).optional(),
});

function parseOptions<T>(schema: z.ZodType<T>, json: unknown): T {
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new CeremonyError("invalid_answer");
  return parsed.data;
}

const descriptor = (d: z.infer<typeof Descriptor>): PublicKeyCredentialDescriptor => ({
  id: fromBase64url(d.id),
  type: "public-key",
  ...(d.transports ? { transports: d.transports as AuthenticatorTransport[] } : {}),
});

/** navigator.credentials.create's options from the enrolment's JSON options. */
export function creationOptionsFromJSON(json: unknown): PublicKeyCredentialCreationOptions {
  const o = parseOptions(CreationOptionsJSON, json);
  const options: PublicKeyCredentialCreationOptions & { hints?: string[] } = {
    challenge: fromBase64url(o.challenge),
    rp: o.rp,
    user: { id: fromBase64url(o.user.id), name: o.user.name, displayName: o.user.displayName },
    pubKeyCredParams: o.pubKeyCredParams,
    ...(o.timeout === undefined ? {} : { timeout: o.timeout }),
    excludeCredentials: (o.excludeCredentials ?? []).map(descriptor),
    // A staff key always verifies its user (3a design, section 2), whatever the options said.
    authenticatorSelection: { ...o.authenticatorSelection, userVerification: "required" },
    // The console asks for no attestation, so the key's make and model are never sent.
    attestation: "none",
    ...(o.extensions?.credProps === true ? { extensions: { credProps: true } } : {}),
    // The security-key hint, sent only for the "Register a security key" button; the browser reads it, TypeScript does not know it yet.
    ...(o.hints ? { hints: o.hints } : {}),
  };
  return options;
}

/** navigator.credentials.get's options from a sign-in's or a step-up's JSON options. */
export function requestOptionsFromJSON(json: unknown): PublicKeyCredentialRequestOptions {
  const o = parseOptions(RequestOptionsJSON, json);
  return {
    challenge: fromBase64url(o.challenge),
    ...(o.rpId === undefined ? {} : { rpId: o.rpId }),
    ...(o.timeout === undefined ? {} : { timeout: o.timeout }),
    ...(o.allowCredentials === undefined ? {} : { allowCredentials: o.allowCredentials.map(descriptor) }),
    userVerification: "required",
  };
}

/** An ArrayBuffer or a view of one, as base64url; anything else is not a credential the console can read. */
function encode(value: unknown): string {
  if (value instanceof ArrayBuffer) return toBase64url(new Uint8Array(value));
  if (ArrayBuffer.isView(value)) return toBase64url(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  throw new CeremonyError("ceremony_refused");
}

interface CredentialShape {
  id: unknown;
  rawId: unknown;
  type: unknown;
  authenticatorAttachment?: unknown;
  response?: Record<string, unknown>;
  getClientExtensionResults?: () => unknown;
}

/** The members both kinds of credential share; null (a prompt that returned nothing) is a ceremony that did not finish. */
function common(credential: unknown) {
  if (credential === null || credential === undefined) throw new CeremonyError("ceremony_cancelled");
  const c = credential as CredentialShape;
  if (typeof c.id !== "string" || c.type !== "public-key" || typeof c.response !== "object" || c.response === null) throw new CeremonyError("ceremony_refused");
  const extensions = typeof c.getClientExtensionResults === "function" ? c.getClientExtensionResults() : {};
  // Left out when the browser did not say, as the contracts' schema allows; it never sends null.
  const attachment: { authenticatorAttachment?: "platform" | "cross-platform" } =
    c.authenticatorAttachment === "platform" || c.authenticatorAttachment === "cross-platform" ? { authenticatorAttachment: c.authenticatorAttachment } : {};
  return {
    head: { id: c.id, rawId: encode(c.rawId), type: "public-key" as const },
    response: c.response,
    clientExtensionResults: (typeof extensions === "object" && extensions !== null ? extensions : {}) as Record<string, unknown>,
    attachment,
  };
}

/** The browser's new credential as the contracts' RegistrationResponseJSON. */
export function registrationResponseToJSON(credential: unknown): RegistrationResponseJSON {
  const { head, response, clientExtensionResults, attachment } = common(credential);
  if (response.attestationObject === undefined) throw new CeremonyError("ceremony_refused");
  const getTransports = response.getTransports;
  const transports = typeof getTransports === "function" ? (getTransports.call(response) as unknown) : undefined;
  return {
    ...head,
    response: {
      clientDataJSON: encode(response.clientDataJSON),
      attestationObject: encode(response.attestationObject),
      ...(Array.isArray(transports) ? { transports: transports.filter((t): t is string => typeof t === "string").slice(0, 8) } : {}),
    },
    clientExtensionResults,
    ...attachment,
  };
}

/** The browser's assertion as the contracts' AuthenticationResponseJSON. */
export function authenticationResponseToJSON(credential: unknown): AuthenticationResponseJSON {
  const { head, response, clientExtensionResults, attachment } = common(credential);
  if (response.signature === undefined || response.authenticatorData === undefined) throw new CeremonyError("ceremony_refused");
  return {
    ...head,
    response: {
      clientDataJSON: encode(response.clientDataJSON),
      authenticatorData: encode(response.authenticatorData),
      signature: encode(response.signature),
      // A discoverable key returns the account's user handle; the API needs it at sign-in.
      ...(response.userHandle === null || response.userHandle === undefined ? {} : { userHandle: encode(response.userHandle) }),
    },
    clientExtensionResults,
    ...attachment,
  };
}

/** What a browser's refusal means, in the console's words; the browser's own message is never shown. */
export function ceremonyFailure(err: unknown): CeremonyError {
  if (err instanceof CeremonyError) return err;
  const name = err instanceof Error ? err.name : "";
  // The person closed the prompt, it timed out, or the page went away under it.
  if (name === "NotAllowedError" || name === "AbortError") return new CeremonyError("ceremony_cancelled");
  // An excluded credential matched: this key is already one of the account's staff keys (or, in development, a passkey).
  if (name === "InvalidStateError") return new CeremonyError("key_already_registered");
  // SecurityError (the address is not the relying party's, such as 127.0.0.1), NotSupportedError and anything else.
  return new CeremonyError("ceremony_refused");
}
