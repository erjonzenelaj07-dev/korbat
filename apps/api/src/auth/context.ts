import type { AuthErrorCode, MemberState, MeProfile, Profile, StaffErrorCode } from "@korbat/contracts";
import type { Logger } from "pino";
import type { Config } from "../config";
import type { Mailer } from "../mail/mailer";
import { decodeKey, parseVersionedKey, type VersionedKey } from "./crypto";
import type { KeyValueStore } from "./kv";
import type { Lockout } from "./lockout";
import type { BreachChecker } from "./passwords";
import type { AuthRepo } from "./repo";
import type { Sessions } from "./sessions";
import type { TurnstileVerifier } from "./turnstile";
import type { VerificationProvider } from "./verify/provider";

export interface AuthConfig {
  appOrigin: string;
  /** Origins allowed to send cookie-authenticated state-changing requests. */
  allowedOrigins: string[];
  authHmacKey: Buffer;
  ipHashKey: Buffer;
  totpKey: VersionedKey;
  /** Keys TOTP_ENC_KEY replaced; still accepted for decryption. */
  totpPreviousKeys: VersionedKey[];
  /** Encrypts a signed-out notifier's name, address and mail token (3c design, section 6.1); see NOTIFIER_ENC_KEY in config.ts. */
  notifierKey: VersionedKey;
  /** Keys NOTIFIER_ENC_KEY replaced; still accepted for decryption. A contact is never encrypted again under the new key. */
  notifierPreviousKeys: VersionedKey[];
  termsVersion: string;
  /** How the client address is read; see TRUST_PROXY in config.ts. */
  trustProxy: "cloudflare" | "caddy" | "none";
  /** Who checks the phone number behind the verified badge; see VERIFY_PROVIDER in config.ts. With `off` the badge routes answer badge_unavailable. */
  verifyProvider: "off" | "dev" | "vonage";
  /** The relying party passkeys are bound to; see WEBAUTHN_RP_ID and WEBAUTHN_RP_NAME in config.ts. */
  webauthn: {
    rpId: string;
    rpName: string;
    /** The origins a ceremony's clientDataJSON may name. */
    origins: string[];
  };
  /**
   * The staff console (3a design, section 8): the only origin a staff ceremony's clientDataJSON may name and the relying
   * party staff keys are bound to, CONSOLE_ORIGIN and CONSOLE_RP_ID. Null while CONSOLE_ORIGIN is unset: the console is
   * off and no staff route is mounted.
   */
  console: { origin: string; rpId: string } | null;
  /**
   * 3f (design, section 10.2): the operator's Member State and the published contact point, HOME_STATE and CONTACT_POINT,
   * each null while unset. /api/staff/me carries both, since the console's page takes no build argument.
   */
  homeState: MemberState | null;
  contactPoint: string | null;
  /**
   * 3f (design, sections 7.15 and 10.7): REPORT_HOLD. While on (the default), a deletion's last step keeps the address of
   * an account whose report to the authorities is owed, for at most reportHoldDays, and the deletion mail says so; off
   * restores 1b's behaviour. Read in the auth module alone, at those two places.
   */
  reportHold: boolean;
}

export function authConfigFrom(config: Config): AuthConfig {
  return {
    appOrigin: config.APP_ORIGIN,
    allowedOrigins: [config.APP_ORIGIN, ...config.TRUSTED_ORIGINS],
    authHmacKey: decodeKey(config.AUTH_HMAC_KEY),
    ipHashKey: decodeKey(config.IP_HASH_KEY),
    totpKey: parseVersionedKey(config.TOTP_ENC_KEY),
    totpPreviousKeys: config.TOTP_ENC_KEYS_PREVIOUS.map(parseVersionedKey),
    notifierKey: parseVersionedKey(config.NOTIFIER_ENC_KEY),
    notifierPreviousKeys: config.NOTIFIER_ENC_KEYS_PREVIOUS.map(parseVersionedKey),
    termsVersion: config.TERMS_VERSION,
    trustProxy: config.TRUST_PROXY,
    verifyProvider: config.VERIFY_PROVIDER,
    webauthn: {
      rpId: config.WEBAUTHN_RP_ID,
      rpName: config.WEBAUTHN_RP_NAME,
      // A passkey ceremony run from a development origin (Expo's dev server, say) is accepted outside production only:
      // in production the web app is served from APP_ORIGIN, and no other origin may use its passkeys.
      origins: config.NODE_ENV === "production" ? [config.APP_ORIGIN] : [config.APP_ORIGIN, ...config.TRUSTED_ORIGINS],
    },
    // The configuration fills CONSOLE_RP_ID with the console's hostname whenever CONSOLE_ORIGIN is set.
    console: config.CONSOLE_ORIGIN === undefined ? null : { origin: config.CONSOLE_ORIGIN, rpId: config.CONSOLE_RP_ID! },
    // The configuration takes only a state whose facts the contracts hold, which is a member state's code.
    homeState: (config.HOME_STATE as MemberState | undefined) ?? null,
    contactPoint: config.CONTACT_POINT ?? null,
    reportHold: config.REPORT_HOLD === "on",
  };
}

/** Public profiles live in the public schema, which the auth module cannot reach; the API supplies this. */
export interface ProfileStore {
  /**
   * Writes the profile and the reservation of its handle. Refused with `handle_taken` when another profile holds or held the
   * handle, `handle_retired` when korbat retired it (3e), and `handle_reserved` when the database's guard of handles
   * refuses one of the placeholder's form that a caller let through.
   */
  create(input: { id: string; handle: string; displayName: string }): Promise<{ ok: true; profile: Profile } | { ok: false; reason: "handle_taken" | "handle_retired" | "handle_reserved" }>;
  /** The owner's view of their profile, which /me returns: the public facts plus the handle-change date, the badge and the Explore switch. */
  find(id: string): Promise<MeProfile | null>;
  /**
   * Sets or clears the badge (profiles.verified_at), which the auth module decides but cannot write itself. 3e: setting it
   * answers false when the one predicate refused the write (the account's suspension runs); clearing it always answers true.
   */
  setVerified(id: string, at: Date | null): Promise<boolean>;
  /** 3e: whether the account's suspension runs now, a plain read that startBadge asks first as a courtesy; the write decides. */
  suspended(id: string): Promise<boolean>;
}

export interface AuthDeps {
  repo: AuthRepo;
  kv: KeyValueStore;
  sessions: Sessions;
  lockout: Lockout;
  mailer: Mailer;
  turnstile: TurnstileVerifier;
  breachChecker: BreachChecker;
  profiles: ProfileStore;
  /** The phone verification provider behind the badge, or null when VERIFY_PROVIDER is off. */
  verify: VerificationProvider | null;
  config: AuthConfig;
  log: Logger;
  now: () => Date;
}

/** Per-request facts the flows need. The IP is already hashed; the raw address never enters a flow. */
export interface RequestContext {
  ipHash: string;
  userAgent: string | undefined;
}

/** A staff request's facts: those of any request, and its id, which the audit rows it writes carry (3a design, section 6). */
export interface StaffRequestContext extends RequestContext {
  requestId: string;
}

export type AuthErrorStatus = 400 | 401 | 403 | 404 | 409 | 429 | 503;

/**
 * The auth codes, the staff console's (the module owns staff keys and sessions, and the staff routes raise its codes as
 * AuthErrors, 3a design section 10), plus the shared one the module also raises, as the social and media modules do: a
 * well-formed request that asks for nothing, such as the current address as the new one.
 */
export type AuthErrorKind = AuthErrorCode | StaffErrorCode | "invalid_request" | "account_suspended";

const MESSAGES: Record<AuthErrorKind, string> = {
  invalid_code: "That code is not valid. Check the latest email or request a new code.",
  code_expired: "That code has expired. Request a new one.",
  too_many_attempts: "Too many attempts. Request a new code.",
  invalid_credentials: "Email or password is incorrect.",
  mfa_required: "Two-factor authentication must be turned on first.",
  invalid_mfa_code: "That authentication code is not valid.",
  reauth_required: "Confirm it's you to continue.",
  csrf_failed: "This request could not be verified. Reload the page and try again.",
  turnstile_failed: "We could not verify that you are human. Try again.",
  disposable_email: "Disposable email addresses cannot be used.",
  age_requirement: "You must be at least 16 to use korbat.",
  terms_required: "Accept the current terms to continue.",
  handle_taken: "That handle is taken.",
  handle_invalid: "Handles are 3 to 20 characters: lowercase letters, numbers and underscores.",
  handle_reserved: "That handle is reserved.",
  password_too_short: "Passwords need at least 12 characters.",
  password_too_long: "Passwords can have at most 128 characters.",
  password_breached: "That password appears in known data breaches. Choose a different one.",
  password_check_unavailable: "We could not check that password right now. Try again in a moment.",
  staff_mfa_required: "Staff accounts must keep two-factor authentication on.",
  onboarding_required: "Choose a handle to finish setting up your account.",
  mail_unavailable: "We could not send the email. Try again in a moment.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  handle_cooldown: "Handles can change once every 30 days.",
  email_in_use: "That email address already belongs to an account.",
  phone_in_use: "That phone number is already verified on another account.",
  badge_unavailable: "Verification is not available on this korbat.",
  verify_unavailable: "We could not reach the verification service. Try again in a moment.",
  passkey_invalid: "That passkey did not work. Try again or use your email.",
  passkey_unsupported: "This passkey provider is not supported. Try another one.",
  // The cap of 10; the flow passes its own message, with the hours left, for the bound of 5 a day.
  passkey_limit: "You have 10 passkeys. Remove one to add another.",
  passkey_suspended: "This passkey was switched off because a copy of it may exist. Remove it and add a new one.",
  passkey_not_found: "That passkey is gone.",
  challenge_expired: "That took too long. Try again.",
  // 3e (design, section 9.5): a handle korbat retired, refused to everyone, its former holder included.
  handle_retired: "That handle was retired by korbat. Nobody can use it.",
  invalid_request: "Some details are missing or invalid.",
  // 3e (design, sections 7.2 and 9.8): the badge is a public mark a suspended account cannot ask for; the social module's code, shared.
  account_suspended: "Your account is suspended, so you cannot do this now.",
  // The staff console's (3a design, section 10). Where only the operator can help, they say so; none sends the person to
  // a remedy the console does not have, which is why the staff flows never answer a passkey_* code.
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

export function authErrorMessage(code: AuthErrorKind): string {
  return MESSAGES[code];
}

/** An expected, user-facing failure. The HTTP layer turns it into an ErrorEnvelope with this code and status. */
export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorKind,
    readonly status: AuthErrorStatus,
    message: string = MESSAGES[code],
    /** For rate limits: seconds until the window resets, sent as Retry-After. */
    readonly retryAfterSeconds?: number,
    /**
     * What the app needs beyond the code, sent as the envelope's `details`: for reauth_required, the level the action
     * asks for and the factor kinds the session proved in time (1c design, section 7.1).
     */
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * The code the database's guard of handles raised (3e design, section 6.2, profiles_handle_guard), however deeply the driver
 * error is wrapped: `handle_retired` or `handle_reserved` under SQLSTATE P0001, else null. The flows check both first, to
 * answer with a code; this is what a write that lost a race meets, and its caller answers the same.
 */
export function handleRefusal(err: unknown): "handle_retired" | "handle_reserved" | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === "object" && (current as { code?: unknown }).code === "P0001") {
      const message = (current as { message?: unknown }).message;
      return message === "handle_retired" || message === "handle_reserved" ? message : null;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/** True for a Postgres unique-constraint violation, however deeply the driver error is wrapped. */
export function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === "object" && (current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
