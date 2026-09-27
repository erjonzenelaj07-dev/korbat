import { z } from "zod";
import { DisplayName, EmailCode, OpaqueId, PasswordInput, PasswordSigninRequest, RecoveryCode, TotpCode } from "./auth";

/** base64url without padding, as the browser library encodes every binary member of a WebAuthn response. */
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** A base64url string of at most `max` characters, so a hostile client cannot hand the verifier an unbounded buffer. */
const base64url = (max: number) => z.string().min(1).max(max).regex(BASE64URL, "must be base64url without padding");

/**
 * A credential id as base64url. WebAuthn caps credential ids at 1023 bytes, which is 1364 characters; the
 * bound leaves room for that and the flows check the decoded length themselves.
 */
const CredentialId = base64url(1400);

/** The transports an authenticator reports ("internal", "hybrid", "usb", ...); the flows keep only the ones they know. */
const Transports = z.array(z.string().min(1).max(32)).max(8);

/** Extension outputs such as credProps; the library reads them, korbat does not. */
const ClientExtensionResults = z.record(z.string(), z.unknown());

/** Whether the authenticator is built into the device or roams; absent when the browser does not say. */
const AuthenticatorAttachment = z.enum(["platform", "cross-platform"]).optional();

/** What korbat calls a passkey in the Security list: the display-name rules (1 to 50 characters, no control or invisible characters). */
export const PasskeyName = DisplayName;

/**
 * The name the password manager shows for the passkey (the options' user.name and user.displayName), under the
 * display-name rules. The app prefills it with the handle; korbat puts it in the options and does not store it.
 */
export const PasskeyLabel = DisplayName;

/** One passkey of the account as the Security screen lists it: nothing that identifies the key itself. */
export const PasskeyView = z.object({
  id: z.uuid(),
  name: z.string(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
  /** Backed up, so the password manager syncs it to the owner's other devices. */
  synced: z.boolean(),
  /** The label of the device that added it; null once that device is gone. */
  createdOn: z.string().nullable(),
  /** This session was started with it. */
  current: z.boolean(),
  /** Added in the last 7 days, when "This wasn't me" is offered on it. */
  isNew: z.boolean(),
  /** Switched off after a sign-in used what looks like a copy of it; only removing it is left. */
  suspended: z.boolean(),
});
export type PasskeyView = z.infer<typeof PasskeyView>;

export const PasskeyListResponse = z.object({ passkeys: z.array(PasskeyView) });
export type PasskeyListResponse = z.infer<typeof PasskeyListResponse>;

export const PasskeyRegisterOptionsRequest = z.object({ label: PasskeyLabel });
export type PasskeyRegisterOptionsRequest = z.infer<typeof PasskeyRegisterOptionsRequest>;

/**
 * The options of a ceremony (registration, sign-in or re-authentication) as the server library wrote them. Only the
 * challenge is checked here: everything else passes through untouched to the browser library, which knows its shape.
 */
export const PasskeyOptionsResponse = z.object({ options: z.looseObject({ challenge: z.string().min(1).regex(BASE64URL, "must be base64url without padding") }) });
export type PasskeyOptionsResponse = z.infer<typeof PasskeyOptionsResponse>;

/**
 * The browser's answer to a registration ceremony. Members the browser library adds beside these (the public key, its
 * algorithm and a copy of the authenticator data) are dropped: the server reads all of them from the attestation object.
 */
export const RegistrationResponseJSON = z.object({
  id: CredentialId,
  rawId: CredentialId,
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: base64url(4 * 1024),
    attestationObject: base64url(64 * 1024),
    transports: Transports.optional(),
  }),
  clientExtensionResults: ClientExtensionResults,
  authenticatorAttachment: AuthenticatorAttachment,
});
export type RegistrationResponseJSON = z.infer<typeof RegistrationResponseJSON>;

/** The browser's answer to a sign-in or re-authentication ceremony. */
export const AuthenticationResponseJSON = z.object({
  id: CredentialId,
  rawId: CredentialId,
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: base64url(4 * 1024),
    authenticatorData: base64url(4 * 1024),
    signature: base64url(1024),
    /** The account's WebAuthn user handle; a discoverable passkey returns it, others may not. */
    userHandle: base64url(128).optional(),
  }),
  clientExtensionResults: ClientExtensionResults,
  authenticatorAttachment: AuthenticatorAttachment,
});
export type AuthenticationResponseJSON = z.infer<typeof AuthenticationResponseJSON>;

/** Without a name the flow calls the passkey after the platform it was added on. */
export const PasskeyRegisterVerifyRequest = z.object({ name: PasskeyName.optional(), response: RegistrationResponseJSON });
export type PasskeyRegisterVerifyRequest = z.infer<typeof PasskeyRegisterVerifyRequest>;

/**
 * A passkey sign-in carries the same device fields as a password sign-in, taken from its schema so the two cannot
 * drift apart: the device id the app created at install and the platform, which the API overrides to web for a browser.
 */
export const PasskeySignInVerifyRequest = PasswordSigninRequest.pick({ deviceId: true, platform: true }).extend({ response: AuthenticationResponseJSON });
export type PasskeySignInVerifyRequest = z.infer<typeof PasskeySignInVerifyRequest>;

export const PasskeyRenameRequest = z.object({ name: PasskeyName });
export type PasskeyRenameRequest = z.infer<typeof PasskeyRenameRequest>;

/** The token of the remove link that the passkey_added email carries. It is the only credential the removal needs. */
export const PasskeyRemoveLinkRequest = z.object({ token: OpaqueId });
export type PasskeyRemoveLinkRequest = z.infer<typeof PasskeyRemoveLinkRequest>;

/**
 * Re-authentication (1c design, section 7.2). It lives here rather than in auth.ts because its `passkey` variant carries an
 * AuthenticationResponseJSON; the password, TOTP, email and recovery variants read their fields from auth.ts. The `passkey`
 * response follows POST /api/auth/reauth/passkey/options, whose challenge is bound to the session's handle.
 */
export const ReauthRequest = z.discriminatedUnion("method", [
  z.object({ method: z.literal("password"), password: PasswordInput }),
  z.object({ method: z.literal("totp"), code: TotpCode }),
  z.object({ method: z.literal("email"), flowId: OpaqueId, code: EmailCode }),
  // A recovery code: only an account with TOTP holds any, and each works once.
  z.object({ method: z.literal("recovery"), recoveryCode: RecoveryCode }),
  z.object({ method: z.literal("passkey"), response: AuthenticationResponseJSON }),
]);
export type ReauthRequest = z.infer<typeof ReauthRequest>;
