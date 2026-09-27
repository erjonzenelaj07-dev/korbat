import { createHash, createSign, generateKeyPairSync, randomBytes, type KeyObject } from "node:crypto";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@korbat/contracts";
import { isoCBOR } from "@simplewebauthn/server/helpers";

/** A value the library's CBOR encoder takes: maps (never plain objects), arrays, byte strings, text and numbers. */
export type CborValue = Parameters<typeof isoCBOR.encode>[0];

/** The authenticator data flags a test controls: user present, user verified, backup eligible, backed up. */
export interface SoftFlags {
  up: boolean;
  uv: boolean;
  be: boolean;
  bs: boolean;
}

/** The AAGUID most synced passkeys report: all zeros. */
export const ZERO_AAGUID = "00000000-0000-0000-0000-000000000000";

// Bits of the authenticator data's flags byte (WebAuthn L3, section 6.1). AT says attested credential data follows
// the counter, which is true at registration only.
const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_BE = 0x08;
const FLAG_BS = 0x10;
const FLAG_AT = 0x40;

// An ES256 public key as a COSE key (RFC 9053): the labels kty, alg, crv, x and y, and the values EC2, ES256, P-256.
const COSE_KTY = 1;
const COSE_ALG = 3;
const COSE_CRV = -1;
const COSE_X = -2;
const COSE_Y = -3;
const KTY_EC2 = 2;
const ALG_ES256 = -7;
const CRV_P256 = 1;

export interface SoftCreateInput {
  rpId: string;
  challenge: string;
  origin: string;
  /** The options' user.id: the account's WebAuthn user handle, which a discoverable passkey hands back at sign-in. */
  userHandle: Uint8Array;
  flags: SoftFlags;
  /** The attestation format; `none` unless the test names another. */
  fmt?: string;
  /** The attestation statement. Without one, `none` gets an empty map and `packed` a self attestation signed with the new key. */
  attStmt?: Map<string | number, CborValue>;
  /** The signature counter the authenticator data reports; 0 unless given. */
  counter?: number;
  /** The authenticator model; all zeros unless given. */
  aaguid?: string;
  /** The credential id; 32 random bytes unless the test needs particular ones (1024 of them, say). */
  credentialId?: Uint8Array;
  /** What the browser reports as the authenticator's transports; ["internal", "hybrid"] unless given. */
  transports?: string[];
}

export interface SoftGetInput {
  /** The credential id as base64url, as the registration response's id carried it. */
  credentialId: string;
  rpId: string;
  challenge: string;
  origin: string;
  flags: SoftFlags;
  counter: number;
  /**
   * The user handle the response returns: absent, the one given at creation (a discoverable passkey); null, none (as a
   * security key used with an allow list may answer); otherwise these bytes (another account's handle, say).
   */
  userHandle?: Uint8Array | null;
}

/** What the authenticator keeps of each credential it created. */
interface HeldCredential {
  privateKey: KeyObject;
  userHandle: Uint8Array;
}

const sha256 = (data: Uint8Array | string): Buffer => createHash("sha256").update(data).digest();
const base64url = (data: Uint8Array): string => Buffer.from(data).toString("base64url");

function flagsByte(flags: SoftFlags, attested: boolean): number {
  return (flags.up ? FLAG_UP : 0) | (flags.uv ? FLAG_UV : 0) | (flags.be ? FLAG_BE : 0) | (flags.bs ? FLAG_BS : 0) | (attested ? FLAG_AT : 0);
}

/** The signature counter: 4 bytes, big-endian. */
function counterBytes(counter: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(counter);
  return bytes;
}

function aaguidBytes(aaguid: string): Buffer {
  const hex = aaguid.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error(`not an AAGUID: ${aaguid}`);
  return Buffer.from(hex, "hex");
}

/** The client data a browser writes, byte for byte what the authenticator's signature covers through its hash. */
function clientData(type: "webauthn.create" | "webauthn.get", challenge: string, origin: string): Buffer {
  return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
}

/** ES256 over the authenticator data followed by the client data's SHA-256, DER-encoded as WebAuthn expects (Node's default for EC keys). */
function sign(privateKey: KeyObject, authData: Buffer, clientDataJSON: Buffer): Buffer {
  return createSign("sha256").update(Buffer.concat([authData, sha256(clientDataJSON)])).sign(privateKey);
}

function coseKey(publicKey: KeyObject): Uint8Array {
  const { x, y } = publicKey.export({ format: "jwk" });
  if (!x || !y) throw new Error("an EC public key exports x and y");
  return isoCBOR.encode(
    new Map<string | number, CborValue>([
      [COSE_KTY, KTY_EC2],
      [COSE_ALG, ALG_ES256],
      [COSE_CRV, CRV_P256],
      [COSE_X, Buffer.from(x, "base64url")],
      [COSE_Y, Buffer.from(y, "base64url")],
    ]),
  );
}

/**
 * A passkey provider in software for the tests: it holds ES256 key pairs from node:crypto and answers registration and
 * sign-in ceremonies with the JSON the browser library sends, built by hand (the authenticator data byte by byte, the
 * attestation object in CBOR through the server library's own encoder). Every input a hostile or unusual authenticator
 * could vary is under the test's control: the flags, the counter, the AAGUID, the credential id, the format and its
 * statement, the transports and the user handle.
 */
export class SoftAuthenticator {
  private readonly credentials = new Map<string, HeldCredential>();

  create(input: SoftCreateInput): RegistrationResponseJSON {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const credentialId = Buffer.from(input.credentialId ?? randomBytes(32));
    const id = base64url(credentialId);
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(credentialId.length);
    // rpIdHash (32), flags (1), counter (4), then the attested credential data: AAGUID (16), the id's length (2), the
    // id and the COSE public key.
    const authData = Buffer.concat([
      sha256(input.rpId),
      Buffer.from([flagsByte(input.flags, true)]),
      counterBytes(input.counter ?? 0),
      aaguidBytes(input.aaguid ?? ZERO_AAGUID),
      idLength,
      credentialId,
      coseKey(publicKey),
    ]);
    const clientDataJSON = clientData("webauthn.create", input.challenge, input.origin);
    const fmt = input.fmt ?? "none";
    // A packed self attestation (no x5c) is signed with the credential's own key over the same bytes as an assertion.
    const attStmt =
      input.attStmt ??
      (fmt === "packed"
        ? new Map<string | number, CborValue>([
            ["alg", ALG_ES256],
            ["sig", sign(privateKey, authData, clientDataJSON)],
          ])
        : new Map<string | number, CborValue>());
    const attestationObject = isoCBOR.encode(
      new Map<string | number, CborValue>([
        ["fmt", fmt],
        ["attStmt", attStmt],
        ["authData", authData],
      ]),
    );
    this.credentials.set(id, { privateKey, userHandle: Uint8Array.from(input.userHandle) });
    return {
      id,
      rawId: id,
      type: "public-key",
      response: {
        clientDataJSON: base64url(clientDataJSON),
        attestationObject: base64url(attestationObject),
        transports: input.transports ?? ["internal", "hybrid"],
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }

  get(input: SoftGetInput): AuthenticationResponseJSON {
    const held = this.credentials.get(input.credentialId);
    if (!held) throw new Error(`the software authenticator holds no credential ${input.credentialId}`);
    // No attested credential data at sign-in: rpIdHash, flags and counter only.
    const authData = Buffer.concat([sha256(input.rpId), Buffer.from([flagsByte(input.flags, false)]), counterBytes(input.counter)]);
    const clientDataJSON = clientData("webauthn.get", input.challenge, input.origin);
    const userHandle = input.userHandle === undefined ? held.userHandle : input.userHandle;
    return {
      id: input.credentialId,
      rawId: input.credentialId,
      type: "public-key",
      response: {
        clientDataJSON: base64url(clientDataJSON),
        authenticatorData: base64url(authData),
        signature: base64url(sign(held.privateKey, authData, clientDataJSON)),
        ...(userHandle === null ? {} : { userHandle: base64url(userHandle) }),
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }
}
