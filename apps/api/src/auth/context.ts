import type { AuthErrorCode, MeProfile, Profile } from "@korbat/contracts";
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

export interface AuthConfig {
  appOrigin: string;
  /** Origins allowed to send cookie-authenticated state-changing requests. */
  allowedOrigins: string[];
  authHmacKey: Buffer;
  ipHashKey: Buffer;
  totpKey: VersionedKey;
  /** Keys TOTP_ENC_KEY replaced; still accepted for decryption. */
  totpPreviousKeys: VersionedKey[];
  termsVersion: string;
  /** How the client address is read; see TRUST_PROXY in config.ts. */
  trustProxy: "cloudflare" | "caddy" | "none";
}

export function authConfigFrom(config: Config): AuthConfig {
  return {
    appOrigin: config.APP_ORIGIN,
    allowedOrigins: [config.APP_ORIGIN, ...config.TRUSTED_ORIGINS],
    authHmacKey: decodeKey(config.AUTH_HMAC_KEY),
    ipHashKey: decodeKey(config.IP_HASH_KEY),
    totpKey: parseVersionedKey(config.TOTP_ENC_KEY),
    totpPreviousKeys: config.TOTP_ENC_KEYS_PREVIOUS.map(parseVersionedKey),
    termsVersion: config.TERMS_VERSION,
    trustProxy: config.TRUST_PROXY,
  };
}

/** Public profiles live in the public schema, which the auth module cannot reach; the API supplies this. */
export interface ProfileStore {
  create(input: { id: string; handle: string; displayName: string }): Promise<{ ok: true; profile: Profile } | { ok: false; reason: "handle_taken" }>;
  /** The owner's view of their profile, which /me returns: the public facts plus the handle-change date and the badge. */
  find(id: string): Promise<MeProfile | null>;
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
  config: AuthConfig;
  log: Logger;
  now: () => Date;
}

/** Per-request facts the flows need. The IP is already hashed; the raw address never enters a flow. */
export interface RequestContext {
  ipHash: string;
  userAgent: string | undefined;
}

export type AuthErrorStatus = 400 | 401 | 403 | 409 | 429 | 503;

/** The auth codes plus the shared one the module also raises, as the social and media modules do: a well-formed request that asks for nothing, such as the current address as the new one. */
export type AuthErrorKind = AuthErrorCode | "invalid_request";

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
  invalid_request: "Some details are missing or invalid.",
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
  ) {
    super(message);
    this.name = "AuthError";
  }
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
